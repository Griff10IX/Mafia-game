# Bodyguards: list, armour upgrade, slot buy, hire, invite/accept/decline; admin clear/generate
from datetime import datetime, timezone, timedelta
from typing import List, Optional
import asyncio
import logging
import time
import uuid
import random
from pydantic import BaseModel

from fastapi import Depends, HTTPException

logger = logging.getLogger(__name__)

from server import (
    db,
    get_current_user,
    get_effective_event,
    send_notification,
    get_rank_info,
    RANKS,
    STATES,
    get_password_hash,
    DEFAULT_HEALTH,
    DEFAULT_GARAGE_BATCH_LIMIT,
    _is_admin,
    _username_pattern,
)

# Constants (moved from server)
BODYGUARD_SLOT_COSTS = [75, 150, 300, 450]
BODYGUARD_ARMOUR_UPGRADE_COSTS = {0: 50, 1: 100, 2: 200, 3: 400, 4: 800}

# Human bodyguard one-time hire cost is 25% cheaper than robot (deducted from inviter when invite is accepted)
BODYGUARD_HUMAN_HIRE_DISCOUNT = 0.75  # 75% of robot price
# Cooldown between dropping human bodyguards (owner can only drop once per period)
BODYGUARD_DROP_COOLDOWN_HOURS = 3

# Bodyguard inflation: each purchase starts/resets a 3h timer; buying again before it expires adds % (2, 5, 7, 12, 17, 22, ...)
BODYGUARD_INFLATION_HOURS = 3
# First 4 levels: 2%, 5%, 7%, 12%; then +5% per level (17%, 22%, 27%, ...)
BODYGUARD_INFLATION_PERCENTS_FIRST = [0.02, 0.05, 0.07, 0.12]
BODYGUARD_INFLATION_EXTRA_PER_LEVEL = 0.05  # after level 4


def _bodyguard_inflation_percent_for_level(level: int) -> float:
    """Return inflation as decimal (e.g. 0.12 for 12%) for level >= 1. Level 0 = 0%. No cap; keeps increasing past 12%."""
    if level < 1:
        return 0.0
    if level <= len(BODYGUARD_INFLATION_PERCENTS_FIRST):
        return BODYGUARD_INFLATION_PERCENTS_FIRST[level - 1]
    return BODYGUARD_INFLATION_PERCENTS_FIRST[-1] + (level - len(BODYGUARD_INFLATION_PERCENTS_FIRST)) * BODYGUARD_INFLATION_EXTRA_PER_LEVEL


def _bodyguard_inflation_level_now(user: dict) -> int:
    """Return current inflation level (0 = first hire in window, 1 = second within 3h, ...). Resets when window expires."""
    until_iso = user.get("bodyguard_inflation_until")
    if not until_iso:
        return 0
    try:
        until = datetime.fromisoformat(until_iso.replace("Z", "+00:00"))
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > until:
            return 0
    except Exception:
        return 0
    return int(user.get("bodyguard_inflation_level") or 0)


# Per-user cache for GET /bodyguards
_bodyguards_cache: dict = {}
_BODYGUARDS_CACHE_TTL_SEC = 10
_BODYGUARDS_CACHE_MAX_ENTRIES = 5000


def _invalidate_bodyguards_cache(user_id: str):
    _bodyguards_cache.pop(user_id, None)


# ----- Models -----
class BodyguardResponse(BaseModel):
    slot_number: int
    is_robot: bool
    bodyguard_username: Optional[str]
    bodyguard_rank_name: Optional[str] = None
    armour_level: int = 0
    hired_at: Optional[str]
    payment_points: int = 0
    payment_money: int = 0
    payout_weekday: Optional[int] = None  # 0=Monday, 6=Sunday


class BodyguardInviteRequest(BaseModel):
    target_username: str
    payment_points: int = 0  # points per week to bodyguard
    payment_money: int = 0   # money per week to bodyguard (in-game $)
    payout_weekday: int = 0  # 0=Monday, 6=Sunday; pay runs on this day each week (UTC)
    duration_hours: int = 168  # contract length (default 1 week); 0 = indefinite


class BodyguardHireRequest(BaseModel):
    slot: int
    is_robot: bool


class AdminBodyguardsGenerateRequest(BaseModel):
    target_username: str
    count: int = 1  # 1..4
    replace_existing: bool = True


# ----- Helpers -----
def _camelize(name: str) -> str:
    parts = []
    for ch in (name or ""):
        if ch.isalnum() or ch == " ":
            parts.append(ch)
    cleaned = "".join(parts)
    tokens = [t for t in cleaned.replace("_", " ").split(" ") if t]
    return "".join(t[:1].upper() + t[1:] for t in tokens)


async def _create_robot_bodyguard_user(owner_user: dict) -> tuple[str, str]:
    """Create a unique robot user record. Returns (user_id, username). 1920s–30s American mafia style."""
    robot_names = [
        "Al Capone", "Lucky Luciano", "Frank Nitti", "Johnny Torrio", "Bugsy Siegel",
        "Meyer Lansky", "Vito Genovese", "Joe Masseria", "Salvatore Maranzano", "Dutch Schultz",
        "Waxey Gordon", "Legs Diamond", "Vincent Coll", "Frank Costello", "Albert Anastasia",
        "Joe Adonis", "Tony Accardo", "Paul Ricca", "Jake Guzik", "Machine Gun Jack",
        "Scarface Al", "Big Jim Colosimo", "Diamond Joe", "Nails Morton", "Bugs Moran",
        "Lefty Louie", "Tony the Rat", "Mad Dog Coll", "Pretty Amberg", "Broadway Charlie",
    ]
    base = _camelize(random.choice(robot_names))
    rank = random.choice(RANKS)
    rank_points = random.randint(int(rank["required_points"]), int(rank["required_points"]) + 500)
    username = None
    for _ in range(80):
        suffix = random.randint(100000, 9999999)
        candidate = f"{base}{suffix}"
        exists = await db.users.find_one({"username": candidate}, {"_id": 0, "id": 1})
        if not exists:
            username = candidate
            break
    if not username:
        raise HTTPException(status_code=500, detail="Failed to generate unique robot name")
    robot_user_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    robot_doc = {
        "id": robot_user_id,
        "email": f"{username.lower()}@robot.mafia",
        "username": username,
        "password_hash": get_password_hash(str(uuid.uuid4())),
        "rank": int(rank["id"]),
        "money": 0.0,
        "points": 0,
        "rank_points": int(rank_points),
        "bodyguard_slots": 0,
        "bullets": 0,
        "avatar_url": None,
        "jail_busts": 0,
        "jail_bust_attempts": 0,
        "garage_batch_limit": DEFAULT_GARAGE_BATCH_LIMIT,
        "total_crimes": 0,
        "crime_profit": 0,
        "total_gta": 0,
        "total_oc_heists": 0,
        "oc_timer_reduced": False,
        "current_state": random.choice(STATES) if STATES else "Chicago",
        "total_kills": 0,
        "total_deaths": 0,
        "in_jail": False,
        "jail_until": None,
        "premium_rank_bar": False,
        "custom_car_name": None,
        "travels_this_hour": 0,
        "travel_reset_time": now_iso,
        "extra_airmiles": 0,
        "health": DEFAULT_HEALTH,
        "armour_level": 0,
        "armour_owned_level_max": 0,
        "equipped_weapon_id": None,
        "kill_inflation": 0.0,
        "kill_inflation_updated_at": now_iso,
        "is_dead": False,
        "dead_at": None,
        "points_at_death": None,
        "retrieval_used": False,
        "mission_completions": [],
        "unlocked_maps_up_to": "Chicago",
        "last_seen": now_iso,
        "created_at": now_iso,
        "is_npc": True,
        "is_bodyguard": True,
        "bodyguard_owner_id": owner_user["id"],
    }
    await db.users.insert_one(robot_doc)
    return robot_user_id, username


# ----- Routes -----
async def get_bodyguards_hire_inflation(current_user: dict = Depends(get_current_user)):
    """Return current robot hire inflation % and when the 3h window resets, so the frontend can show cost and countdown."""
    user = await db.users.find_one(
        {"id": current_user["id"]},
        {"_id": 0, "bodyguard_inflation_until": 1, "bodyguard_inflation_level": 1},
    )
    user = user or {}
    level = _bodyguard_inflation_level_now(user)
    pct = round(_bodyguard_inflation_percent_for_level(level) * 100)
    until_iso = user.get("bodyguard_inflation_until")
    window_ends_at = None
    if until_iso:
        try:
            until = datetime.fromisoformat(until_iso.replace("Z", "+00:00"))
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            if until > datetime.now(timezone.utc):
                window_ends_at = until_iso
        except Exception:
            pass
    return {"next_hire_inflation_pct": pct, "inflation_window_ends_at": window_ends_at}


async def get_bodyguards(current_user: dict = Depends(get_current_user)):
    global _bodyguards_cache
    uid = current_user.get("id")
    username = current_user.get("username", "?")
    logger.info("get_bodyguards start uid=%s username=%s", uid, username)
    try:
        now = time.monotonic()
        if uid in _bodyguards_cache:
            payload, expires = _bodyguards_cache[uid]
            if now <= expires:
                logger.debug("get_bodyguards cache hit uid=%s", uid)
                return payload
        bodyguards = await db.bodyguards.find({"user_id": uid}, {"_id": 0}).to_list(10)
        logger.debug("get_bodyguards found %d raw slots for uid=%s", len(bodyguards), uid)
        result = []
        for i in range(4):
            bg = next((b for b in bodyguards if b.get("slot_number") == i + 1), None)
            if bg and (bg.get("bodyguard_user_id") or bg.get("is_robot")):
                username_bg = None
                rank_name = None
                is_robot = bg.get("is_robot", False)
                if not is_robot and bg.get("bodyguard_user_id"):
                    # Human: armour is always the guard's actual user armour (never from the slot doc)
                    guard_id = bg["bodyguard_user_id"]
                    bg_user = await db.users.find_one(
                        {"id": guard_id},
                        {"_id": 0, "username": 1, "rank_points": 1, "armour_level": 1}
                    )
                    username_bg = bg_user["username"] if bg_user else "Unknown"
                    if bg_user:
                        _, rank_name = get_rank_info(int(bg_user.get("rank_points", 0) or 0))
                    armour_level = int(bg_user.get("armour_level", 0) or 0) if bg_user else 0
                else:
                    if bg.get("bodyguard_user_id"):
                        bg_user = await db.users.find_one(
                            {"id": bg["bodyguard_user_id"]},
                            {"_id": 0, "username": 1, "rank_points": 1}
                        )
                        username_bg = bg_user["username"] if bg_user else None
                        if bg_user:
                            _, rank_name = get_rank_info(int(bg_user.get("rank_points", 0) or 0))
                    username_bg = username_bg or bg.get("robot_name") or f"Robot Guard #{i + 1}"
                    armour_level = int(bg.get("armour_level", 0) or 0)
                result.append(BodyguardResponse(
                    slot_number=i + 1,
                    is_robot=is_robot,
                    bodyguard_username=username_bg,
                    bodyguard_rank_name=rank_name,
                    armour_level=armour_level,
                    hired_at=bg.get("hired_at") or None,
                    payment_points=int(bg.get("payment_points") or 0),
                    payment_money=int(bg.get("payment_money") or 0),
                    payout_weekday=bg.get("payout_weekday"),
                ))
            else:
                result.append(BodyguardResponse(
                    slot_number=i + 1,
                    is_robot=False,
                    bodyguard_username=None,
                    bodyguard_rank_name=None,
                    armour_level=0,
                    hired_at=None,
                    payment_points=0,
                    payment_money=0,
                    payout_weekday=None,
                ))
        if len(_bodyguards_cache) >= _BODYGUARDS_CACHE_MAX_ENTRIES:
            oldest = next(iter(_bodyguards_cache))
            _bodyguards_cache.pop(oldest, None)
        payload = {"bodyguards": result}
        user_doc = await db.users.find_one({"id": uid}, {"_id": 0, "bodyguard_last_drop_at": 1})
        payload["bodyguard_last_drop_at"] = user_doc.get("bodyguard_last_drop_at") if user_doc else None
        as_guard = await db.bodyguards.find_one(
            {"bodyguard_user_id": uid, "is_robot": False},
            {"_id": 0, "user_id": 1},
        )
        if as_guard:
            owner = await db.users.find_one({"id": as_guard["user_id"]}, {"_id": 0, "id": 1, "username": 1})
            if owner:
                payload["bodyguard_for"] = {"owner_id": owner["id"], "owner_username": owner.get("username") or "?"}
            else:
                payload["bodyguard_for"] = {"owner_id": as_guard["user_id"], "owner_username": "?"}
            # Total profit from being a bodyguard (all-time payouts received)
            profit_cursor = db.bodyguard_payouts.aggregate([
                {"$match": {"guard_id": uid}},
                {"$group": {"_id": None, "points": {"$sum": "$payment_points"}, "money": {"$sum": "$payment_money"}}},
            ])
            profit_list = await profit_cursor.to_list(length=1)
            if profit_list:
                payload["bodyguard_profit"] = {"points": int(profit_list[0].get("points") or 0), "money": float(profit_list[0].get("money") or 0)}
            else:
                payload["bodyguard_profit"] = {"points": 0, "money": 0.0}
        else:
            payload["bodyguard_for"] = None
            payload["bodyguard_profit"] = None
        _bodyguards_cache[uid] = (payload, now + _BODYGUARDS_CACHE_TTL_SEC)
        logger.info("get_bodyguards success uid=%s slots=%d", uid, len(result))
        return payload
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("get_bodyguards error uid=%s: %s", uid, e)
        raise HTTPException(status_code=500, detail=f"Bodyguards load failed: {type(e).__name__}: {str(e)}")


async def get_bodyguards_stats(current_user: dict = Depends(get_current_user)):
    """Return lifetime bodyguard stats and longest surviving (of current guards)."""
    uid = current_user["id"]
    total_hired = int(current_user.get("bodyguard_lifetime_hires") or 0)
    total_spent_hires = int(current_user.get("bodyguard_lifetime_spent_hires") or 0)
    total_spent_upgrades = int(current_user.get("bodyguard_lifetime_spent_upgrades") or 0)
    bodyguards = await db.bodyguards.find(
        {"user_id": uid},
        {"_id": 0, "slot_number": 1, "hired_at": 1, "bodyguard_user_id": 1, "is_robot": 1, "robot_name": 1},
    ).to_list(10)
    longest_surviving_seconds = None
    longest_surviving_name = None
    now = datetime.now(timezone.utc)
    for bg in bodyguards:
        if not bg.get("hired_at") or not (bg.get("bodyguard_user_id") or bg.get("is_robot")):
            continue
        try:
            hired_at = datetime.fromisoformat(bg["hired_at"].replace("Z", "+00:00"))
            if hired_at.tzinfo is None:
                hired_at = hired_at.replace(tzinfo=timezone.utc)
            secs = int((now - hired_at).total_seconds())
            if secs < 0:
                secs = 0
            if longest_surviving_seconds is None or secs > longest_surviving_seconds:
                longest_surviving_seconds = secs
                if bg.get("is_robot") and bg.get("robot_name"):
                    longest_surviving_name = bg["robot_name"]
                elif bg.get("bodyguard_user_id"):
                    u = await db.users.find_one(
                        {"id": bg["bodyguard_user_id"]},
                        {"_id": 0, "username": 1},
                    )
                    longest_surviving_name = u["username"] if u else "Unknown"
                else:
                    longest_surviving_name = "Bodyguard"
        except Exception:
            continue
    return {
        "total_hired": total_hired,
        "total_spent_hires": total_spent_hires,
        "total_spent_upgrades": total_spent_upgrades,
        "longest_surviving_seconds": longest_surviving_seconds,
        "longest_surviving_name": longest_surviving_name,
    }


async def upgrade_bodyguard_armour(slot: int, current_user: dict = Depends(get_current_user)):
    if slot < 1 or slot > 4:
        raise HTTPException(status_code=400, detail="Invalid slot")
    bg = await db.bodyguards.find_one({"user_id": current_user["id"], "slot_number": slot}, {"_id": 0})
    if not bg or not bg.get("bodyguard_user_id"):
        raise HTTPException(status_code=404, detail="No bodyguard in that slot")
    if not bg.get("is_robot"):
        raise HTTPException(status_code=400, detail="Human bodyguards use their own armour; it cannot be upgraded")
    cur_level = int(bg.get("armour_level", 0) or 0)
    if cur_level >= 5:
        raise HTTPException(status_code=400, detail="Bodyguard armour is already maxed")
    ev = await get_effective_event()
    cost = int(BODYGUARD_ARMOUR_UPGRADE_COSTS.get(cur_level, 0) * ev.get("bodyguard_cost", 1.0))
    if cost <= 0:
        raise HTTPException(status_code=400, detail="Invalid armour upgrade cost")
    if int(current_user.get("points", 0) or 0) < cost:
        raise HTTPException(status_code=400, detail="Insufficient points")
    new_level = cur_level + 1
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -cost, "bodyguard_lifetime_spent_upgrades": cost}},
    )
    await db.bodyguards.update_one(
        {"user_id": current_user["id"], "slot_number": slot},
        {"$set": {"armour_level": new_level}}
    )
    await db.users.update_one({"id": bg["bodyguard_user_id"]}, {"$set": {"armour_level": new_level}})
    _invalidate_bodyguards_cache(current_user["id"])
    return {"message": f"Upgraded bodyguard armour to level {new_level} for {cost} points", "armour_level": new_level, "cost": cost}


async def buy_bodyguard_slot(current_user: dict = Depends(get_current_user)):
    if await db.bodyguards.find_one({"bodyguard_user_id": current_user["id"], "is_robot": False}, {"_id": 1}):
        raise HTTPException(
            status_code=400,
            detail="You cannot hire bodyguards while you're working as one. Ask your client to drop you first.",
        )
    if current_user["bodyguard_slots"] >= 4:
        raise HTTPException(status_code=400, detail="All bodyguard slots already purchased")
    ev = await get_effective_event()
    cost = int(BODYGUARD_SLOT_COSTS[current_user["bodyguard_slots"]] * ev.get("bodyguard_cost", 1.0))
    if current_user["points"] < cost:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -cost, "bodyguard_slots": 1}}
    )
    _invalidate_bodyguards_cache(current_user["id"])
    return {"message": f"Bodyguard slot purchased for {cost} points"}


async def hire_bodyguard(request: BodyguardHireRequest, current_user: dict = Depends(get_current_user)):
    slot = request.slot
    is_robot = request.is_robot
    if await db.bodyguards.find_one({"bodyguard_user_id": current_user["id"], "is_robot": False}, {"_id": 1}):
        raise HTTPException(
            status_code=400,
            detail="You cannot hire bodyguards while you're working as one. Ask your client to drop you first.",
        )
    if not is_robot:
        raise HTTPException(status_code=400, detail="Human bodyguards are temporarily disabled. Use robot bodyguards.")
    if slot < 1 or slot > 4:
        raise HTTPException(status_code=400, detail="Invalid bodyguard slot")
    existing = await db.bodyguards.find_one(
        {"user_id": current_user["id"], "slot_number": slot},
        {"_id": 0}
    )
    if existing:
        raise HTTPException(status_code=400, detail="Slot already occupied")
    ev = await get_effective_event()
    base_cost = BODYGUARD_SLOT_COSTS[slot - 1]
    # Bodyguard inflation: each hire within 3h adds % (0%, 2%, 5%, 7%, 12%, 17%, ...)
    user_inflation = await db.users.find_one(
        {"id": current_user["id"]},
        {"_id": 0, "bodyguard_inflation_until": 1, "bodyguard_inflation_level": 1}
    )
    user_for_inflation = user_inflation or {}
    inflation_level = _bodyguard_inflation_level_now(user_for_inflation)
    inflation_mult = 1.0 + _bodyguard_inflation_percent_for_level(inflation_level)
    cost = int(base_cost * ev.get("bodyguard_cost", 1.0) * inflation_mult)
    if current_user["points"] < cost:
        raise HTTPException(status_code=400, detail="Insufficient points")
    now = datetime.now(timezone.utc)
    window_end = now + timedelta(hours=BODYGUARD_INFLATION_HOURS)
    await db.users.update_one(
        {"id": current_user["id"]},
        {
            "$inc": {
                "points": -cost,
                "bodyguard_lifetime_hires": 1,
                "bodyguard_lifetime_spent_hires": cost,
            },
            "$set": {
                "bodyguard_inflation_until": window_end.isoformat(),
                "bodyguard_inflation_level": inflation_level + 1,
            },
        },
    )
    robot_name = None
    robot_user_id = None
    if is_robot:
        robot_user_id, robot_name = await _create_robot_bodyguard_user(current_user)
    bodyguard_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "owner_username": current_user.get("username"),
        "slot_number": slot,
        "is_robot": is_robot,
        "robot_name": robot_name,
        "bodyguard_user_id": robot_user_id if is_robot else None,
        "health": 100,
        "armour_level": 0,
        "hired_at": datetime.now(timezone.utc).isoformat(),
        "hire_cost": cost,
    }
    await db.bodyguards.insert_one(bodyguard_doc)
    asyncio.create_task(send_notification(
        current_user["id"],
        "🛡️ Bodyguard Hired",
        f"You've hired {robot_name if is_robot else 'a human bodyguard slot'} for {cost} points.",
        "bodyguard"
    ))
    _invalidate_bodyguards_cache(current_user["id"])
    return {"message": f"{'Robot bodyguard ' + robot_name if is_robot else 'Human bodyguard slot'} hired for {cost} points", "bodyguard_name": robot_name}


def _weekday_name(weekday: int) -> str:
    return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][weekday % 7]


async def invite_bodyguard(request: BodyguardInviteRequest, current_user: dict = Depends(get_current_user)):
    if await db.bodyguards.find_one({"bodyguard_user_id": current_user["id"], "is_robot": False}, {"_id": 1}):
        raise HTTPException(
            status_code=400,
            detail="You cannot hire bodyguards while you're working as one. Ask your client to drop you first.",
        )
    username_pattern = _username_pattern((request.target_username or "").strip())
    if not username_pattern:
        raise HTTPException(status_code=400, detail="Target username required")
    if (request.payment_points or 0) < 0 or (request.payment_money or 0) < 0:
        raise HTTPException(status_code=400, detail="Payment amounts cannot be negative")
    if (request.payment_points or 0) == 0 and (request.payment_money or 0) == 0:
        raise HTTPException(status_code=400, detail="Enter at least one of payment_points or payment_money per week")
    payout_weekday = int(request.payout_weekday or 0)
    if payout_weekday < 0 or payout_weekday > 6:
        raise HTTPException(status_code=400, detail="payout_weekday must be 0 (Monday) to 6 (Sunday)")
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot invite yourself")
    bodyguards = await db.bodyguards.find({"user_id": current_user["id"]}).to_list(10)
    filled_slots = len([b for b in bodyguards if b.get("bodyguard_user_id") or b.get("is_robot")])
    if filled_slots >= 4:
        raise HTTPException(status_code=400, detail="No available bodyguard slots")
    existing = await db.bodyguard_invites.find_one({
        "inviter_id": current_user["id"],
        "invitee_id": target["id"],
        "status": "pending"
    })
    if existing:
        raise HTTPException(status_code=400, detail="Already have pending invite to this user")
    invite_id = str(uuid.uuid4())
    pay_parts = []
    if request.payment_points:
        pay_parts.append(f"{request.payment_points} pts")
    if request.payment_money:
        pay_parts.append(f"${request.payment_money:,}")
    pay_str = " + ".join(pay_parts) + f"/week (paid {_weekday_name(payout_weekday)}s)"
    await db.bodyguard_invites.insert_one({
        "id": invite_id,
        "inviter_id": current_user["id"],
        "inviter_username": current_user["username"],
        "invitee_id": target["id"],
        "invitee_username": target["username"],
        "payment_points": int(request.payment_points or 0),
        "payment_money": int(request.payment_money or 0),
        "payout_weekday": payout_weekday,
        "duration_hours": int(request.duration_hours or 168),
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    await send_notification(
        target["id"],
        "🛡️ Bodyguard Offer",
        f"{current_user['username']} wants to hire you as a bodyguard: {pay_str}.",
        "bodyguard"
    )
    return {"message": f"Bodyguard invite sent to {target['username']}"}


async def get_bodyguard_invites(current_user: dict = Depends(get_current_user)):
    sent = await db.bodyguard_invites.find(
        {"inviter_id": current_user["id"], "status": "pending"},
        {"_id": 0}
    ).to_list(20)
    received = await db.bodyguard_invites.find(
        {"invitee_id": current_user["id"], "status": "pending"},
        {"_id": 0}
    ).to_list(20)
    return {"sent": sent, "received": received}


async def accept_bodyguard_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    invite = await db.bodyguard_invites.find_one({"id": invite_id, "invitee_id": current_user["id"], "status": "pending"}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    # You can only be a bodyguard for one person at a time
    already_guard = await db.bodyguards.find_one(
        {"bodyguard_user_id": current_user["id"], "is_robot": False},
        {"_id": 1},
    )
    if already_guard:
        raise HTTPException(
            status_code=400,
            detail="You can only be a bodyguard for one person at a time. Ask your current client to drop you first.",
        )
    inviter = await db.users.find_one({"id": invite["inviter_id"]}, {"_id": 0})
    if not inviter:
        raise HTTPException(status_code=400, detail="Inviter no longer exists")
    bodyguards = await db.bodyguards.find({"user_id": inviter["id"]}).to_list(10)
    empty_slot = None
    for i in range(1, 5):
        slot_bg = next((b for b in bodyguards if b["slot_number"] == i), None)
        if not slot_bg or (not slot_bg.get("bodyguard_user_id") and not slot_bg.get("is_robot")):
            empty_slot = i
            break
    if not empty_slot:
        raise HTTPException(status_code=400, detail="Inviter has no available slots")
    # One-time hire cost (25% cheaper than robot), deducted from inviter when bodyguard accepts
    ev = await get_effective_event()
    base_cost = BODYGUARD_SLOT_COSTS[empty_slot - 1]
    inviter_inflation = await db.users.find_one(
        {"id": inviter["id"]},
        {"_id": 0, "points": 1, "bodyguard_inflation_until": 1, "bodyguard_inflation_level": 1},
    )
    inviter_for_cost = inviter_inflation or {}
    inflation_level = _bodyguard_inflation_level_now(inviter_for_cost)
    inflation_mult = 1.0 + _bodyguard_inflation_percent_for_level(inflation_level)
    robot_cost = int(base_cost * ev.get("bodyguard_cost", 1.0) * inflation_mult)
    human_hire_cost = max(1, int(robot_cost * BODYGUARD_HUMAN_HIRE_DISCOUNT))
    if (inviter_for_cost.get("points") or 0) < human_hire_cost:
        raise HTTPException(
            status_code=400,
            detail=f"Inviter does not have enough points for the hire cost ({human_hire_cost} pts, 25% off robot price)",
        )
    now = datetime.now(timezone.utc)
    window_end = now + timedelta(hours=BODYGUARD_INFLATION_HOURS)
    # Deduct from inviter and advance their inflation (same as hiring a robot)
    inviter_update_result = await db.users.update_one(
        {"id": inviter["id"], "points": {"$gte": human_hire_cost}},
        {
            "$inc": {
                "points": -human_hire_cost,
                "bodyguard_lifetime_hires": 1,
                "bodyguard_lifetime_spent_hires": human_hire_cost,
            },
            "$set": {
                "bodyguard_inflation_until": window_end.isoformat(),
                "bodyguard_inflation_level": inflation_level + 1,
            },
        },
    )
    if inviter_update_result.modified_count == 0:
        raise HTTPException(
            status_code=400,
            detail=f"Inviter does not have enough points for the hire cost ({human_hire_cost} pts, 25% off robot price)",
        )
    duration_hours = int(invite.get("duration_hours") or 168)
    end_time = now + timedelta(hours=duration_hours) if duration_hours > 0 else None
    pay_pts = int(invite.get("payment_points") or 0)
    pay_money = int(invite.get("payment_money") or 0)
    if pay_pts == 0 and pay_money == 0 and invite.get("payment_amount"):
        if invite.get("payment_type") == "points":
            pay_pts = int(invite["payment_amount"])
        else:
            pay_money = int(invite["payment_amount"])
    set_doc = {
        "bodyguard_user_id": current_user["id"],
        "is_robot": False,
        "payment_points": pay_pts,
        "payment_money": pay_money,
        "payout_weekday": int(invite.get("payout_weekday", 0)),
        "last_payout_date": None,
        "hired_at": now.isoformat(),
        "hire_cost": human_hire_cost,
    }
    if end_time:
        set_doc["contract_end"] = end_time.isoformat()
    # First week's pay: pay the bodyguard now; set last_payout_date so next auto-pay is in one week
    today_str = now.date().isoformat()
    set_doc["last_payout_date"] = today_str
    if pay_pts > 0 or pay_money > 0:
        first_pay = await db.users.update_one(
            {"id": inviter["id"], "points": {"$gte": pay_pts}, "money": {"$gte": pay_money}},
            {"$inc": {"points": -pay_pts, "money": -pay_money}},
        )
        if first_pay.modified_count == 1:
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": {"points": pay_pts, "money": pay_money}},
            )
            pay_msg = []
            if pay_pts:
                pay_msg.append(f"{pay_pts} pts")
            if pay_money:
                pay_msg.append(f"${pay_money:,.0f}")
            if pay_msg:
                await send_notification(
                    current_user["id"],
                    "🛡️ First week pay",
                    f"First week bodyguard pay from {inviter.get('username', '?')}: " + " + ".join(pay_msg),
                    "bodyguard",
                )
    await db.bodyguards.update_one(
        {"user_id": inviter["id"], "slot_number": empty_slot},
        {"$set": set_doc, "$unset": {"armour_level": ""}},
        upsert=True
    )
    await db.bodyguard_invites.update_one(
        {"id": invite_id},
        {"$set": {"status": "accepted"}}
    )
    await send_notification(
        inviter["id"],
        "🛡️ Bodyguard Accepted",
        f"{current_user['username']} has accepted your bodyguard offer! {human_hire_cost} pts hire cost deducted (25% off robot price).",
        "bodyguard"
    )
    _invalidate_bodyguards_cache(current_user["id"])
    _invalidate_bodyguards_cache(inviter["id"])
    return {"message": f"You are now {inviter['username']}'s bodyguard"}


async def decline_bodyguard_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.bodyguard_invites.update_one(
        {"id": invite_id, "invitee_id": current_user["id"], "status": "pending"},
        {"$set": {"status": "declined"}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Invite not found")
    return {"message": "Invite declined"}


# ----- Admin -----
async def admin_clear_bodyguards(target_username: str, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    username_pattern = _username_pattern(target_username)
    if not username_pattern:
        raise HTTPException(status_code=404, detail="User not found")
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    res_bg = await db.bodyguards.delete_many({"user_id": target["id"]})
    res_robots = await db.users.delete_many({"is_bodyguard": True, "bodyguard_owner_id": target["id"]})
    _invalidate_bodyguards_cache(target["id"])
    return {
        "message": f"Cleared bodyguards for {target_username} (removed {res_bg.deleted_count} bodyguard record(s), {res_robots.deleted_count} robot user(s))",
        "deleted_bodyguards": res_bg.deleted_count,
        "deleted_robot_users": res_robots.deleted_count,
    }


async def admin_drop_all_human_bodyguards(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    res = await db.bodyguards.delete_many({"is_robot": {"$ne": True}})
    return {"message": f"Dropped all human bodyguards ({res.deleted_count} slot(s) cleared)", "deleted_count": res.deleted_count}


async def admin_drop_all_bodyguards(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    res = await db.bodyguards.delete_many({})
    res_robots = await db.users.delete_many({"is_bodyguard": True})
    _bodyguards_cache.clear()
    return {
        "message": f"Dropped ALL bodyguards ({res.deleted_count} slot(s) cleared, {res_robots.deleted_count} robot user(s) deleted)",
        "deleted_bodyguards": res.deleted_count,
        "deleted_robot_users": res_robots.deleted_count
    }


async def admin_generate_bodyguards(request: AdminBodyguardsGenerateRequest, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    target_username = (request.target_username or "").strip()
    if not target_username:
        raise HTTPException(status_code=400, detail="Target username required")
    count = int(request.count or 1)
    if count < 1 or count > 4:
        raise HTTPException(status_code=400, detail="Count must be between 1 and 4")
    username_pattern = _username_pattern(target_username)
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if request.replace_existing:
        await db.bodyguards.delete_many({"user_id": target["id"]})
        await db.users.delete_many({"is_bodyguard": True, "bodyguard_owner_id": target["id"]})
    desired_slots = max(int(target.get("bodyguard_slots", 0) or 0), count)
    desired_slots = min(4, desired_slots)
    if desired_slots != (int(target.get("bodyguard_slots", 0) or 0)):
        await db.users.update_one({"id": target["id"]}, {"$set": {"bodyguard_slots": desired_slots}})
    created = 0
    for slot in range(1, count + 1):
        exists = await db.bodyguards.find_one({"user_id": target["id"], "slot_number": slot}, {"_id": 0, "id": 1})
        if exists:
            continue
        robot_user_id, robot_username = await _create_robot_bodyguard_user(target)
        await db.bodyguards.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": target["id"],
            "owner_username": target.get("username"),
            "slot_number": slot,
            "is_robot": True,
            "robot_name": robot_username,
            "bodyguard_user_id": robot_user_id,
            "health": 100,
            "armour_level": 0,
            "hired_at": datetime.now(timezone.utc).isoformat()
        })
        created += 1
    _invalidate_bodyguards_cache(target["id"])
    return {"message": f"Generated {created} robot bodyguard(s) for {target_username}", "created": created, "count_requested": count}


# ----- Weekly payout (human bodyguards) -----
# bodyguard_payouts: one doc per (owner_id, slot_number, payout_date) for audit and crash safety.
# Unique index on (owner_id, slot_number, payout_date) prevents double-pay; we check it before paying.


async def run_bodyguard_weekly_payout(database):
    """Run once per day; on each bodyguard's payout_weekday, pay them and record in bodyguard_payouts."""
    import logging
    log = logging.getLogger(__name__)
    now = datetime.now(timezone.utc)
    today_str = now.date().isoformat()
    weekday = now.weekday()  # 0=Monday, 6=Sunday
    cursor = database.bodyguards.find({
        "is_robot": False,
        "bodyguard_user_id": {"$exists": True, "$ne": None},
        "payout_weekday": weekday,
    })
    paid = 0
    async for bg in cursor:
        owner_id = bg["user_id"]
        slot_number = bg["slot_number"]
        # Skip if we already have a payout record for this slot+date (idempotent; survives server restart)
        existing = await database.bodyguard_payouts.find_one(
            {"owner_id": owner_id, "slot_number": slot_number, "payout_date": today_str},
            {"_id": 1},
        )
        if existing:
            # Ensure bodyguard doc has last_payout_date in case it was missed after a crash
            await database.bodyguards.update_one(
                {"user_id": owner_id, "slot_number": slot_number},
                {"$set": {"last_payout_date": today_str}},
            )
            continue
        last = bg.get("last_payout_date")
        if last == today_str:
            continue
        contract_end = bg.get("contract_end")
        if contract_end:
            try:
                end = datetime.fromisoformat(contract_end.replace("Z", "+00:00"))
                if end.tzinfo is None:
                    end = end.replace(tzinfo=timezone.utc)
                if now >= end:
                    continue
            except Exception:
                pass
        guard_id = bg["bodyguard_user_id"]
        # If the human bodyguard was killed, payments are cancelled — don't pay dead users
        guard_user = await database.users.find_one({"id": guard_id}, {"_id": 0, "is_dead": 1})
        if guard_user and guard_user.get("is_dead"):
            continue
        pay_pts = int(bg.get("payment_points") or 0)
        pay_money = float(bg.get("payment_money") or 0)
        if pay_pts <= 0 and pay_money <= 0:
            await database.bodyguards.update_one(
                {"user_id": owner_id, "slot_number": slot_number},
                {"$set": {"last_payout_date": today_str}},
            )
            continue
        owner = await database.users.find_one({"id": owner_id}, {"_id": 0, "points": 1, "money": 1})
        if not owner:
            continue
        pts = int(owner.get("points") or 0)
        money = float(owner.get("money") or 0)
        if (pay_pts and pts < pay_pts) or (pay_money and money < pay_money):
            log.warning("Bodyguard weekly payout skipped: owner %s insufficient balance (need %s pts, %s $)", owner_id, pay_pts, pay_money)
            continue
        # Do the transfer
        updates_owner = {"$inc": {}}
        if pay_pts:
            updates_owner["$inc"]["points"] = -pay_pts
        if pay_money:
            updates_owner["$inc"]["money"] = -pay_money
        if updates_owner["$inc"]:
            await database.users.update_one({"id": owner_id}, updates_owner)
        updates_guard = {"$inc": {}}
        if pay_pts:
            updates_guard["$inc"]["points"] = pay_pts
        if pay_money:
            updates_guard["$inc"]["money"] = pay_money
        if updates_guard["$inc"]:
            await database.users.update_one({"id": guard_id}, updates_guard)
        paid += 1
        try:
            await database.bodyguards.update_one(
                {"user_id": owner_id, "slot_number": slot_number},
                {"$set": {"last_payout_date": today_str}},
            )
            await database.bodyguard_payouts.insert_one({
                "id": str(uuid.uuid4()),
                "owner_id": owner_id,
                "slot_number": slot_number,
                "guard_id": guard_id,
                "payout_date": today_str,
                "payment_points": pay_pts,
                "payment_money": pay_money,
                "created_at": now.isoformat(),
            })
            _invalidate_bodyguards_cache(owner_id)
            _invalidate_bodyguards_cache(guard_id)
            if pay_pts or pay_money:
                await send_notification(
                    guard_id,
                    "🛡️ Bodyguard Pay",
                    f"Weekly bodyguard pay: {pay_pts} pts, ${pay_money:,.0f}" if pay_pts and pay_money else (f"{pay_pts} pts" if pay_pts else f"${pay_money:,.0f}"),
                    "bodyguard",
                )
        except Exception as e:
            log.warning("Bodyguard payout transfer succeeded but record/notify failed for owner=%s slot=%s: %s", owner_id, slot_number, e)
    if paid:
        log.info("Bodyguard weekly payout: %d paid (weekday=%s)", paid, weekday)
    return paid


async def drop_bodyguard(slot: int, current_user: dict = Depends(get_current_user)):
    """Owner drops a human bodyguard from a slot. Payments stop; the slot becomes empty. Once every 3 hours."""
    if slot < 1 or slot > 4:
        raise HTTPException(status_code=400, detail="Invalid slot")
    # Cooldown: only one drop per BODYGUARD_DROP_COOLDOWN_HOURS
    owner_doc = await db.users.find_one(
        {"id": current_user["id"]},
        {"_id": 0, "bodyguard_last_drop_at": 1},
    )
    if owner_doc and owner_doc.get("bodyguard_last_drop_at"):
        try:
            last_drop = datetime.fromisoformat(owner_doc["bodyguard_last_drop_at"].replace("Z", "+00:00"))
            if last_drop.tzinfo is None:
                last_drop = last_drop.replace(tzinfo=timezone.utc)
            elapsed = (datetime.now(timezone.utc) - last_drop).total_seconds()
            if elapsed < BODYGUARD_DROP_COOLDOWN_HOURS * 3600:
                mins_left = int((BODYGUARD_DROP_COOLDOWN_HOURS * 3600 - elapsed) / 60)
                raise HTTPException(
                    status_code=429,
                    detail=f"You can only drop a bodyguard once every {BODYGUARD_DROP_COOLDOWN_HOURS} hours. Try again in {mins_left} minutes.",
                )
        except HTTPException:
            raise
        except Exception:
            pass
    bg = await db.bodyguards.find_one(
        {"user_id": current_user["id"], "slot_number": slot},
        {"_id": 0, "bodyguard_user_id": 1, "is_robot": 1},
    )
    if not bg:
        raise HTTPException(status_code=404, detail="No bodyguard in that slot")
    if bg.get("is_robot"):
        raise HTTPException(status_code=400, detail="Cannot drop a robot; use admin clear if needed")
    guard_id = bg.get("bodyguard_user_id")
    if not guard_id:
        raise HTTPException(status_code=400, detail="Slot is already empty")
    guard_user = await db.users.find_one({"id": guard_id}, {"_id": 0, "username": 1})
    guard_name = guard_user.get("username", "?") if guard_user else "?"
    await db.bodyguards.update_one(
        {"user_id": current_user["id"], "slot_number": slot},
        {
            "$set": {
                "bodyguard_user_id": None,
                "payment_points": 0,
                "payment_money": 0,
                "payout_weekday": None,
                "last_payout_date": None,
            },
            "$unset": {"contract_end": "", "hired_at": "", "hire_cost": ""},
        },
    )
    await send_notification(
        guard_id,
        "🛡️ Bodyguard Dropped",
        f"{current_user.get('username', '?')} has dropped you as their bodyguard. You are no longer under contract.",
        "bodyguard",
    )
    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"bodyguard_last_drop_at": now.isoformat()}},
    )
    _invalidate_bodyguards_cache(current_user["id"])
    _invalidate_bodyguards_cache(guard_id)
    return {"message": f"Dropped {guard_name} from slot {slot}. Payments cancelled. You can drop again in {BODYGUARD_DROP_COOLDOWN_HOURS} hours."}


async def admin_test_bodyguard_payout(current_user: dict = Depends(get_current_user)):
    """Admin-only: run the weekly bodyguard payout job once (for testing). Returns how many were paid."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    paid = await run_bodyguard_weekly_payout(db)
    return {"message": f"Test payout run: {paid} bodyguard(s) paid", "paid_count": paid}


def register(router):
    router.add_api_route("/bodyguards/inflation", get_bodyguards_hire_inflation, methods=["GET"])
    router.add_api_route("/bodyguards/stats", get_bodyguards_stats, methods=["GET"])
    router.add_api_route("/bodyguards", get_bodyguards, methods=["GET"])
    router.add_api_route("/bodyguards/armour/upgrade", upgrade_bodyguard_armour, methods=["POST"])
    router.add_api_route("/bodyguards/slot/buy", buy_bodyguard_slot, methods=["POST"])
    router.add_api_route("/bodyguards/hire", hire_bodyguard, methods=["POST"])
    router.add_api_route("/bodyguards/invite", invite_bodyguard, methods=["POST"])
    router.add_api_route("/bodyguards/invites", get_bodyguard_invites, methods=["GET"])
    router.add_api_route("/bodyguards/invites/{invite_id}/accept", accept_bodyguard_invite, methods=["POST"])
    router.add_api_route("/bodyguards/invites/{invite_id}/decline", decline_bodyguard_invite, methods=["POST"])
    router.add_api_route("/bodyguards/drop", drop_bodyguard, methods=["POST"])
    router.add_api_route("/admin/bodyguards/clear", admin_clear_bodyguards, methods=["POST"])
    router.add_api_route("/admin/bodyguards/test-payout", admin_test_bodyguard_payout, methods=["POST"])
    router.add_api_route("/admin/bodyguards/drop-all-human", admin_drop_all_human_bodyguards, methods=["POST"])
    router.add_api_route("/admin/bodyguards/drop-all", admin_drop_all_bodyguards, methods=["POST"])
    router.add_api_route("/admin/bodyguards/generate", admin_generate_bodyguards, methods=["POST"])
