# Bodyguards: list, armour upgrade, slot buy, hire, invite/accept/decline; admin clear/generate
from datetime import datetime, timezone, timedelta
from typing import List, Optional
import asyncio
import logging
import time
import uuid
import random
from pydantic import BaseModel

from fastapi import Depends, HTTPException, Query
from pymongo import UpdateOne
from utils.point_provenance import log_points_event

logger = logging.getLogger(__name__)


def _parse_iso_datetime(val):
    """Parse datetime from DB (string with optional Z, or datetime object). Return None if missing/invalid."""
    if val is None:
        return None
    if hasattr(val, "year"):
        return val.replace(tzinfo=timezone.utc) if val.tzinfo is None else val
    if not isinstance(val, str):
        return None
    try:
        s = val.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except Exception:
        return None


from server import (
    db,
    get_current_user,
    get_effective_event,
    log_activity,
    send_notification,
    get_rank_info,
    user_prestige_rank_mult,
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
# Robot bodyguards are always Made Man or above (rank id 5 = Made Man in server.RANKS)
ROBOT_BODYGUARD_MIN_RANK_ID = 5
BODYGUARD_ARMOUR_UPGRADE_COSTS = {0: 50, 1: 100, 2: 200, 3: 400, 4: 800}

# Human bodyguard one-time hire cost is 25% cheaper than robot (deducted from inviter when invite is accepted)
BODYGUARD_HUMAN_HIRE_DISCOUNT = 0.75  # 75% of robot price
# Cooldown between dropping bodyguards (owner can only drop once per period)
BODYGUARD_DROP_COOLDOWN_SECONDS = 110  # TODO: change back to 3 hours (10800) after testing

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
    until = _parse_iso_datetime(until_iso)
    if until is None or datetime.now(timezone.utc) > until:
        return 0
    return int(user.get("bodyguard_inflation_level") or 0)


# Per-user cache for GET /bodyguards
_bodyguards_cache: dict = {}
_BODYGUARDS_CACHE_TTL_SEC = 10
_BODYGUARDS_CACHE_MAX_ENTRIES = 5000

# Per-user lock: all hire requests for the same user are serialized so each sees fresh DB state
_hire_locks: dict = {}
_hire_locks_meta_lock = asyncio.Lock()


async def _hire_lock(user_id: str):
    async with _hire_locks_meta_lock:
        if user_id not in _hire_locks:
            _hire_locks[user_id] = asyncio.Lock()
        return _hire_locks[user_id]


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
    hire_cost: int = 0  # one-time points paid when hired (robot or human)
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


class AdminReplaceRobotBodyguardsRequest(BaseModel):
    """Swap only robot NPC bodyguards for new identities (human bodyguards unchanged). For compromised accounts."""
    target_username: str


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
        "Frankie Yale", "Angelo Genna", "Jack McGurn", "Rocco Fischetti",
        "Owney Madden", "Dutch Anderson", "Frank Scalise", "Joe Profaci",
        "Tony Galento", "Joe Aiello", "Tommy Lucchese", "Nick Civella",
        "Albert Tannenbaum", "Augie Pisano", "Frankie Carbo", "Ciro Terranova",
        "Nicola Gentile", "Louis Buchalter", "Abe Reles", "Harry Greenberg",
    ]
    base = _camelize(random.choice(robot_names))
    ranks_made_man_plus = [r for r in RANKS if r["id"] >= ROBOT_BODYGUARD_MIN_RANK_ID]
    rank = random.choice(ranks_made_man_plus) if ranks_made_man_plus else RANKS[-1]
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
        # Random spawn city once at hire; robots cannot travel (see airport + get_current_user).
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
        until = _parse_iso_datetime(until_iso)
        if until and until > datetime.now(timezone.utc):
            window_ends_at = until_iso
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
        guard_ids = list(
            {
                b["bodyguard_user_id"]
                for b in bodyguards
                if b.get("bodyguard_user_id")
            }
        )
        guard_users_map = {}
        if guard_ids:
            async for u in db.users.find(
                {"id": {"$in": guard_ids}},
                {"_id": 0, "id": 1, "username": 1, "rank_points": 1, "armour_level": 1},
            ):
                guard_users_map[u["id"]] = u
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
                    bg_user = guard_users_map.get(guard_id)
                    username_bg = bg_user.get("username", "Unknown") if bg_user else "Unknown"
                    if bg_user:
                        _, rank_name = get_rank_info(int(bg_user.get("rank_points", 0) or 0), user_prestige_rank_mult(bg_user))
                    armour_level = int(bg_user.get("armour_level", 0) or 0) if bg_user else 0
                else:
                    if bg.get("bodyguard_user_id"):
                        bg_user = guard_users_map.get(bg["bodyguard_user_id"])
                        username_bg = bg_user.get("username") if bg_user else None
                        if bg_user:
                            _, rank_name = get_rank_info(int(bg_user.get("rank_points", 0) or 0), user_prestige_rank_mult(bg_user))
                    username_bg = username_bg or bg.get("robot_name") or f"Robot Guard #{i + 1}"
                    armour_level = int(bg.get("armour_level", 0) or 0)
                result.append(BodyguardResponse(
                    slot_number=i + 1,
                    is_robot=is_robot,
                    bodyguard_username=username_bg,
                    bodyguard_rank_name=rank_name,
                    armour_level=armour_level,
                    hired_at=bg.get("hired_at") or None,
                    hire_cost=int(bg.get("hire_cost") or 0),
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
                    hire_cost=0,
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
        else:
            payload["bodyguard_for"] = None
        # Total profit from being a bodyguard (all-time payouts received), shown whether or not currently under contract
        profit_cursor = db.bodyguard_payouts.aggregate([
            {"$match": {"guard_id": uid}},
            {"$group": {"_id": None, "points": {"$sum": "$payment_points"}, "money": {"$sum": "$payment_money"}}},
        ])
        profit_list = await profit_cursor.to_list(length=1)
        if profit_list:
            payload["bodyguard_profit"] = {"points": int(profit_list[0].get("points") or 0), "money": float(profit_list[0].get("money") or 0)}
        else:
            payload["bodyguard_profit"] = {"points": 0, "money": 0.0}
        _bodyguards_cache[uid] = (payload, now + _BODYGUARDS_CACHE_TTL_SEC)
        logger.info("get_bodyguards success uid=%s slots=%d", uid, len(result))
        return payload
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("get_bodyguards error uid=%s: %s", uid, e)
        raise HTTPException(status_code=500, detail="Bodyguards load failed. Please try again.")


async def get_bodyguards_stats(current_user: dict = Depends(get_current_user)):
    """Return lifetime bodyguard stats and longest surviving (of current guards)."""
    uid = current_user["id"]
    total_hired = int(current_user.get("bodyguard_lifetime_hires") or 0)
    human_hired = await db.bodyguard_invites.count_documents({"inviter_id": uid, "status": "accepted"})
    total_spent_hires = int(current_user.get("bodyguard_lifetime_spent_hires") or 0)
    total_spent_upgrades = int(current_user.get("bodyguard_lifetime_spent_upgrades") or 0)
    bodyguards = await db.bodyguards.find(
        {"user_id": uid},
        {"_id": 0, "slot_number": 1, "hired_at": 1, "bodyguard_user_id": 1, "is_robot": 1, "robot_name": 1},
    ).to_list(10)
    human_guard_ids = list({b["bodyguard_user_id"] for b in bodyguards if b.get("bodyguard_user_id")})
    human_names = {}
    if human_guard_ids:
        async for u in db.users.find(
            {"id": {"$in": human_guard_ids}},
            {"_id": 0, "id": 1, "username": 1},
        ):
            human_names[u["id"]] = u.get("username", "Unknown")
    longest_surviving_seconds = None
    longest_surviving_name = None
    now = datetime.now(timezone.utc)
    for bg in bodyguards:
        if not bg.get("hired_at") or not (bg.get("bodyguard_user_id") or bg.get("is_robot")):
            continue
        hired_at = _parse_iso_datetime(bg.get("hired_at"))
        if hired_at is None:
            continue
        secs = int((now - hired_at).total_seconds())
        if secs < 0:
            secs = 0
        if longest_surviving_seconds is None or secs > longest_surviving_seconds:
            longest_surviving_seconds = secs
            if bg.get("is_robot") and bg.get("robot_name"):
                longest_surviving_name = bg.get("robot_name", "Robot")
            elif bg.get("bodyguard_user_id"):
                gid = bg["bodyguard_user_id"]
                longest_surviving_name = human_names.get(gid, "Unknown")
            else:
                longest_surviving_name = "Bodyguard"
    return {
        "total_hired": total_hired,
        "human_hired": human_hired,
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
    new_level = cur_level + 1
    upgrade_result = await db.users.update_one(
        {"id": current_user["id"], "points": {"$gte": cost}},
        {"$inc": {"points": -cost, "bodyguard_lifetime_spent_upgrades": cost, "lifetime_points_spent": cost}},
    )
    if upgrade_result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await log_points_event(db, user_id=current_user["id"], points=-cost, event_type="bodyguard_armour_upgrade",
                           event_ref=f"slot:{slot}", meta={"slot": slot, "new_level": new_level})
    await db.bodyguards.update_one(
        {"user_id": current_user["id"], "slot_number": slot},
        {"$set": {"armour_level": new_level}}
    )
    await db.users.update_one({"id": bg["bodyguard_user_id"]}, {"$set": {"armour_level": new_level}})
    _invalidate_bodyguards_cache(current_user["id"])
    await db.hitlist_bodyguard_events.insert_one({
        "at": datetime.now(timezone.utc),
        "type": "bodyguard_armour_upgrade",
        "owner_id": current_user["id"],
        "owner_username": current_user.get("username") or "",
        "slot": slot,
        "new_level": new_level,
        "cost": cost,
    })
    return {"message": f"Upgraded bodyguard armour to level {new_level} for {cost} points", "armour_level": new_level, "cost": cost}


async def buy_bodyguard_slot(current_user: dict = Depends(get_current_user)):
    if await db.bodyguards.find_one({"bodyguard_user_id": current_user["id"], "is_robot": False}, {"_id": 1}):
        raise HTTPException(
            status_code=400,
            detail="You cannot hire bodyguards while you're working as one. Ask your client to drop you first.",
        )
    slots = int(current_user.get("bodyguard_slots") or 0)
    if slots >= 4:
        raise HTTPException(status_code=400, detail="All bodyguard slots already purchased")
    ev = await get_effective_event()
    cost = int(BODYGUARD_SLOT_COSTS[slots] * ev.get("bodyguard_cost", 1.0))
    slot_result = await db.users.update_one(
        {"id": current_user["id"], "points": {"$gte": cost}},
        {"$inc": {"points": -cost, "bodyguard_slots": 1, "lifetime_points_spent": cost}},
    )
    if slot_result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await log_points_event(db, user_id=current_user["id"], points=-cost, event_type="bodyguard_slot_buy", meta={"cost": cost})
    await db.hitlist_bodyguard_events.insert_one({
        "at": datetime.now(timezone.utc),
        "type": "bodyguard_slot_bought",
        "user_id": current_user["id"],
        "username": current_user.get("username") or "",
        "cost": cost,
        "slots_after": current_user["bodyguard_slots"] + 1,
    })
    _invalidate_bodyguards_cache(current_user["id"])
    return {"message": f"Bodyguard slot purchased for {cost} points"}


async def hire_bodyguard(request: BodyguardHireRequest, current_user: dict = Depends(get_current_user)):
    is_robot = request.is_robot
    async with await _hire_lock(current_user["id"]):
        return await _do_hire_bodyguard(request.slot, is_robot, current_user)


async def _do_hire_bodyguard(slot: int, is_robot: bool, current_user: dict):
    if await db.bodyguards.find_one({"bodyguard_user_id": current_user["id"], "is_robot": False}, {"_id": 1}):
        raise HTTPException(
            status_code=400,
            detail="You cannot hire bodyguards while you're working as one. Ask your client to drop you first.",
        )
    if not is_robot:
        raise HTTPException(status_code=400, detail="Human bodyguards are temporarily disabled. Use robot bodyguards.")
    fresh = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "bodyguard_slots": 1})
    slots = int((fresh or {}).get("bodyguard_slots") or 0)
    existing_bgs = await db.bodyguards.find(
        {"user_id": current_user["id"]},
        {"_id": 0, "slot_number": 1}
    ).to_list(10)
    occupied = {b["slot_number"] for b in existing_bgs}
    slot = next((s for s in range(1, 5) if s not in occupied), None)
    if slot is None:
        raise HTTPException(status_code=400, detail="All bodyguard slots are full")
    unlock_next_slot = slot > slots
    ev = await get_effective_event()
    event_cost_mult = ev.get("bodyguard_cost", 1.0)
    base_cost = BODYGUARD_SLOT_COSTS[slot - 1]
    # Bodyguard inflation: each hire within 3h adds % (0%, 2%, 5%, 7%, 12%, 17%, ...)
    user_inflation = await db.users.find_one(
        {"id": current_user["id"]},
        {"_id": 0, "bodyguard_inflation_until": 1, "bodyguard_inflation_level": 1}
    )
    user_for_inflation = user_inflation or {}
    inflation_level = _bodyguard_inflation_level_now(user_for_inflation)
    inflation_mult = 1.0 + _bodyguard_inflation_percent_for_level(inflation_level)
    total_cost = int(base_cost * event_cost_mult * inflation_mult)
    now = datetime.now(timezone.utc)
    window_end = now + timedelta(hours=BODYGUARD_INFLATION_HOURS)
    inc_doc = {
        "points": -total_cost,
        "bodyguard_lifetime_hires": 1,
        "bodyguard_lifetime_spent_hires": total_cost,
        "lifetime_points_spent": total_cost,
    }
    if unlock_next_slot:
        inc_doc["bodyguard_slots"] = 1
    update_op = {
        "$inc": inc_doc,
        "$set": {
            "bodyguard_inflation_until": window_end.isoformat(),
            "bodyguard_inflation_level": inflation_level + 1,
        },
    }
    hire_result = await db.users.update_one(
        {"id": current_user["id"], "points": {"$gte": total_cost}},
        update_op,
    )
    if hire_result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    hire_meta = {
        "slot": slot,
        "is_robot": is_robot,
        "cost": total_cost,
        "inflation_level_before": inflation_level,
        "inflation_mult": inflation_mult,
        "event_bodyguard_cost_mult": event_cost_mult,
        "base_slot_cost": base_cost,
    }
    await log_points_event(
        db, user_id=current_user["id"], points=-total_cost, event_type="bodyguard_hire",
        event_ref=f"slot:{slot}", meta=hire_meta,
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
        "hire_cost": total_cost,
    }
    await db.bodyguards.insert_one(bodyguard_doc)
    await db.hitlist_bodyguard_events.insert_one({
        "at": datetime.now(timezone.utc),
        "type": "bodyguard_hired",
        "owner_id": current_user["id"],
        "owner_username": current_user.get("username") or "",
        "slot": slot,
        "is_robot": is_robot,
        "hire_cost": total_cost,
        "bodyguard_username": robot_name if is_robot else None,
        "inflation_level_before": inflation_level,
        "inflation_mult": inflation_mult,
        "event_bodyguard_cost_mult": event_cost_mult,
        "base_slot_cost": base_cost,
    })
    name_part = robot_name if is_robot else "a human bodyguard"
    msg = f"You hired {name_part} for {total_cost} points (slot {slot}/4). Past hires show here — max 4 at once."
    asyncio.create_task(send_notification(
        current_user["id"],
        "🛡️ Bodyguard Hired",
        msg,
        "bodyguard"
    ))
    _invalidate_bodyguards_cache(current_user["id"])
    await log_activity(current_user["id"], current_user.get("username", "?"), "bodyguard_hire", {
        "slot": slot, "is_robot": is_robot, "cost": total_cost, "name": robot_name,
    })
    return {"message": f"{'Robot bodyguard ' + robot_name if is_robot else 'Human bodyguard slot'} hired for {total_cost} points", "bodyguard_name": robot_name}


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
    await db.hitlist_bodyguard_events.insert_one({
        "at": datetime.now(timezone.utc),
        "type": "bodyguard_invite_sent",
        "inviter_id": current_user["id"],
        "inviter_username": current_user.get("username") or "",
        "invitee_id": target["id"],
        "invitee_username": target["username"],
    })
    await send_notification(
        target["id"],
        "🛡️ Bodyguard Offer",
        f"{current_user.get('username') or 'Someone'} wants to hire you as a bodyguard: {pay_str}.",
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
    try:
        return await _do_accept_bodyguard_invite(invite_id, current_user)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("accept_bodyguard_invite error: %s", e)
        raise HTTPException(status_code=400, detail="Accept failed. Please try again.")


async def _do_accept_bodyguard_invite(invite_id: str, current_user: dict):
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
            detail="You can only be a bodyguard for one person at a time.",
        )
    # You cannot accept if you own bodyguards (robots or humans) - must drop them first
    owned_filled = await db.bodyguards.count_documents({
        "user_id": current_user["id"],
        "$or": [
            {"bodyguard_user_id": {"$exists": True, "$ne": None}},
            {"is_robot": True},
        ],
    })
    if owned_filled > 0:
        raise HTTPException(
            status_code=400,
            detail="You must drop your bodyguards before accepting to work as someone else's bodyguard.",
        )
    inviter = await db.users.find_one({"id": invite["inviter_id"]}, {"_id": 0})
    if not inviter:
        raise HTTPException(status_code=400, detail="Inviter no longer exists")
    bodyguards = await db.bodyguards.find({"user_id": inviter["id"]}).to_list(10)
    empty_slot = None
    for i in range(1, 5):
        slot_bg = next((b for b in bodyguards if b.get("slot_number") == i), None)
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
    event_bodyguard_cost_mult = float(ev.get("bodyguard_cost", 1.0))
    robot_cost = int(base_cost * event_bodyguard_cost_mult * inflation_mult)
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
                "lifetime_points_spent": human_hire_cost,
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
    human_hire_meta = {
        "guard_username": current_user.get("username"),
        "is_robot": False,
        "slot": empty_slot,
        "inflation_level_before": inflation_level,
        "inflation_mult": inflation_mult,
        "event_bodyguard_cost_mult": event_bodyguard_cost_mult,
        "base_slot_cost": base_cost,
        "robot_equivalent_cost": robot_cost,
        "human_discount_mult": BODYGUARD_HUMAN_HIRE_DISCOUNT,
    }
    await log_points_event(
        db, user_id=inviter["id"], points=-human_hire_cost, event_type="bodyguard_hire",
        event_ref=f"human:{current_user['id']}", meta=human_hire_meta,
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
    pay_money_val = float(invite.get("payment_money") or pay_money or 0)
    today_str = now.date().isoformat()
    set_doc = {
        "id": str(uuid.uuid4()),
        "owner_username": inviter.get("username"),
        "bodyguard_user_id": current_user["id"],
        "is_robot": False,
        "payment_points": pay_pts,
        "payment_money": pay_money_val,
        "payout_weekday": int(invite.get("payout_weekday", 0)),
        "last_payout_date": None,
        "hired_at": now.isoformat(),
        "hire_cost": human_hire_cost,
    }
    if end_time:
        set_doc["contract_end"] = end_time.isoformat()
    # First week's pay: pay the bodyguard now; set last_payout_date only when we actually pay so weekly/test payout can run if we didn't
    if pay_pts > 0 or pay_money_val > 0:
        first_pay = await db.users.update_one(
            {"id": inviter["id"], "points": {"$gte": pay_pts}, "money": {"$gte": pay_money_val}},
            {"$inc": {"points": -pay_pts, "money": -pay_money}},
        )
        if first_pay.modified_count == 1:
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": {"points": pay_pts, "money": pay_money_val}},
            )
            if pay_pts > 0:
                await log_points_event(db, user_id=inviter["id"], points=-pay_pts, event_type="bodyguard_pay_debit",
                                       event_ref=f"guard:{current_user['id']}", meta={"guard_username": current_user.get("username")})
                await log_points_event(db, user_id=current_user["id"], points=pay_pts, event_type="bodyguard_pay_credit",
                                       event_ref=f"owner:{inviter['id']}", meta={"owner_username": inviter.get("username")})
            set_doc["last_payout_date"] = today_str
            # Avoid duplicate key: (owner_id, slot_number, payout_date) is unique. After admin clear, an old record may exist for this slot+date.
            existing_payout = await db.bodyguard_payouts.find_one(
                {"owner_id": inviter["id"], "slot_number": empty_slot, "payout_date": today_str},
                {"_id": 1},
            )
            if existing_payout:
                await db.bodyguard_payouts.update_one(
                    {"owner_id": inviter["id"], "slot_number": empty_slot, "payout_date": today_str},
                    {"$set": {"guard_id": current_user["id"], "payment_points": pay_pts, "payment_money": pay_money_val}},
                )
            else:
                await db.bodyguard_payouts.insert_one({
                    "id": str(uuid.uuid4()),
                    "owner_id": inviter["id"],
                    "slot_number": empty_slot,
                    "guard_id": current_user["id"],
                    "payout_date": today_str,
                    "payment_points": pay_pts,
                    "payment_money": pay_money_val,
                    "created_at": now.isoformat(),
                })
            pay_msg = []
            if pay_pts:
                pay_msg.append(f"{pay_pts} pts")
            if pay_money_val:
                pay_msg.append(f"${pay_money_val:,.0f}")
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
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"is_bodyguard": True, "bodyguard_owner_id": inviter["id"]}},
    )
    await db.bodyguard_invites.update_one(
        {"id": invite_id},
        {"$set": {"status": "accepted"}}
    )
    await db.hitlist_bodyguard_events.insert_one({
        "at": datetime.now(timezone.utc),
        "type": "bodyguard_invite_accepted",
        "inviter_id": inviter["id"],
        "inviter_username": inviter.get("username") or "",
        "invitee_id": current_user["id"],
        "invitee_username": current_user.get("username") or "",
        "slot": empty_slot,
        "hire_cost": human_hire_cost,
        "inflation_level_before": inflation_level,
        "inflation_mult": inflation_mult,
        "event_bodyguard_cost_mult": event_bodyguard_cost_mult,
        "base_slot_cost": base_cost,
    })
    await send_notification(
        inviter["id"],
        "🛡️ Bodyguard Accepted",
        f"{current_user['username']} has accepted your bodyguard offer! {human_hire_cost} pts hire cost deducted (25% off robot price).",
        "bodyguard"
    )
    await send_notification(
        current_user["id"],
        "🛡️ Bodyguard Accepted",
        f"You're now {inviter.get('username', '?')}'s bodyguard. They paid {human_hire_cost} pts upfront (25% off robot price).",
        "bodyguard",
    )
    _invalidate_bodyguards_cache(current_user["id"])
    _invalidate_bodyguards_cache(inviter["id"])
    return {"message": f"You are now {inviter['username']}'s bodyguard"}


async def decline_bodyguard_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    invite = await db.bodyguard_invites.find_one({"id": invite_id, "invitee_id": current_user["id"], "status": "pending"}, {"_id": 0, "inviter_id": 1, "inviter_username": 1})
    result = await db.bodyguard_invites.update_one(
        {"id": invite_id, "invitee_id": current_user["id"], "status": "pending"},
        {"$set": {"status": "declined"}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite:
        await db.hitlist_bodyguard_events.insert_one({
            "at": datetime.now(timezone.utc),
            "type": "bodyguard_invite_declined",
            "inviter_id": invite.get("inviter_id"),
            "inviter_username": invite.get("inviter_username") or "",
            "invitee_id": current_user["id"],
            "invitee_username": current_user.get("username") or "",
        })
    return {"message": "Invite declined"}


async def cancel_bodyguard_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    """Inviter cancels a pending invite they sent."""
    invite = await db.bodyguard_invites.find_one({"id": invite_id, "inviter_id": current_user["id"], "status": "pending"}, {"_id": 0, "invitee_id": 1, "invitee_username": 1})
    result = await db.bodyguard_invites.update_one(
        {"id": invite_id, "inviter_id": current_user["id"], "status": "pending"},
        {"$set": {"status": "cancelled"}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite:
        await db.hitlist_bodyguard_events.insert_one({
            "at": datetime.now(timezone.utc),
            "type": "bodyguard_invite_cancelled",
            "inviter_id": current_user["id"],
            "inviter_username": current_user.get("username") or "",
            "invitee_id": invite.get("invitee_id"),
            "invitee_username": invite.get("invitee_username") or "",
        })
    return {"message": "Invite cancelled"}


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
    # Only delete robot bodyguard users; human bodyguards are real player accounts
    res_robots = await db.users.delete_many({"is_bodyguard": True, "is_npc": True, "bodyguard_owner_id": target["id"]})
    # Release human bodyguards (clear flags, do not delete)
    res_humans = await db.users.update_many(
        {"is_bodyguard": True, "bodyguard_owner_id": target["id"]},
        {"$unset": {"is_bodyguard": "", "bodyguard_owner_id": ""}},
    )
    _invalidate_bodyguards_cache(target["id"])
    return {
        "message": f"Cleared bodyguards for {target_username} (removed {res_bg.deleted_count} bodyguard record(s), {res_robots.deleted_count} robot user(s), {res_humans.modified_count} human bodyguard(s) released)",
        "deleted_bodyguards": res_bg.deleted_count,
        "deleted_robot_users": res_robots.deleted_count,
        "released_human_bodyguards": res_humans.modified_count,
    }


async def admin_drop_all_human_bodyguards(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    res = await db.bodyguards.delete_many({"is_robot": {"$ne": True}})
    # Clear bodyguard flags from human bodyguards (real players) so they can use their accounts normally
    res_humans = await db.users.update_many(
        {"is_bodyguard": True, "is_npc": {"$ne": True}},
        {"$unset": {"is_bodyguard": "", "bodyguard_owner_id": ""}},
    )
    return {
        "message": f"Dropped all human bodyguards ({res.deleted_count} slot(s) cleared, {res_humans.modified_count} human(s) released)",
        "deleted_count": res.deleted_count,
        "released_human_bodyguards": res_humans.modified_count,
    }


async def admin_drop_all_bodyguards(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    res = await db.bodyguards.delete_many({})
    # Only delete robot bodyguard users (is_npc=True); human bodyguards are real player accounts
    res_robots = await db.users.delete_many({"is_bodyguard": True, "is_npc": True})
    # Clear bodyguard flags from human bodyguards so they can log in normally again
    res_humans = await db.users.update_many(
        {"is_bodyguard": True},
        {"$unset": {"is_bodyguard": "", "bodyguard_owner_id": ""}},
    )
    _bodyguards_cache.clear()
    return {
        "message": f"Dropped ALL bodyguards ({res.deleted_count} slot(s) cleared, {res_robots.deleted_count} robot user(s) deleted, {res_humans.modified_count} human bodyguard(s) released)",
        "deleted_bodyguards": res.deleted_count,
        "deleted_robot_users": res_robots.deleted_count,
        "released_human_bodyguards": res_humans.modified_count,
    }


async def admin_replace_robot_bodyguards_hacked(
    request: AdminReplaceRobotBodyguardsRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Replace each robot bodyguard with a new NPC (new username / user id).
    Preserves slot numbers, armour_level, and hire_cost. Does not touch human bodyguards or empty slots.
    """
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    target_username = (request.target_username or "").strip()
    if not target_username:
        raise HTTPException(status_code=400, detail="Target username required")
    username_pattern = _username_pattern(target_username)
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "current_state": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    owner_id = target["id"]
    owner_name = target.get("username") or "?"
    owner_state = target.get("current_state") or "Chicago"

    robots = await db.bodyguards.find({"user_id": owner_id, "is_robot": True}, {"_id": 0}).to_list(10)
    if not robots:
        return {
            "message": f"No robot bodyguards on {target_username} — nothing to replace",
            "replaced": 0,
            "slots": [],
        }

    robots_sorted = sorted(robots, key=lambda b: int(b.get("slot_number") or 0))
    old_meta = []
    old_robot_user_ids = []
    for b in robots_sorted:
        uid = b.get("bodyguard_user_id")
        if uid:
            old_robot_user_ids.append(str(uid))
        old_meta.append(
            {
                "slot": b.get("slot_number"),
                "old_robot_user_id": uid,
                "old_robot_name": b.get("robot_name"),
                "armour_level": int(b.get("armour_level") or 0),
                "hire_cost": int(b.get("hire_cost") or 0),
            }
        )

    await db.bodyguards.delete_many({"user_id": owner_id, "is_robot": True})
    if old_robot_user_ids:
        await db.users.delete_many({"id": {"$in": old_robot_user_ids}, "is_npc": True, "is_bodyguard": True})

    now_iso = datetime.now(timezone.utc).isoformat()
    replaced = []
    for prev in old_meta:
        slot = int(prev["slot"] or 0)
        if slot < 1 or slot > 4:
            continue
        armour = min(5, max(0, int(prev.get("armour_level") or 0)))
        hire_cost = int(prev.get("hire_cost") or 0)
        robot_user_id, robot_username = await _create_robot_bodyguard_user(target)
        await db.users.update_one(
            {"id": robot_user_id},
            {"$set": {"current_state": owner_state, "armour_level": armour}},
        )
        await db.bodyguards.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": owner_id,
                "owner_username": owner_name,
                "slot_number": slot,
                "is_robot": True,
                "robot_name": robot_username,
                "bodyguard_user_id": robot_user_id,
                "health": 100,
                "armour_level": armour,
                "hired_at": now_iso,
                "hire_cost": hire_cost,
            }
        )
        replaced.append(
            {
                "slot": slot,
                "new_robot_username": robot_username,
                "new_robot_user_id": robot_user_id,
                "armour_level": armour,
            }
        )

    try:
        await db.hitlist_bodyguard_events.insert_one(
            {
                "at": datetime.now(timezone.utc),
                "type": "admin_robot_bodyguards_replaced",
                "owner_id": owner_id,
                "owner_username": owner_name,
                "admin_id": current_user.get("id"),
                "admin_username": current_user.get("username") or "",
                "count": len(replaced),
                "previous": old_meta,
                "new_usernames": [r["new_robot_username"] for r in replaced],
            }
        )
    except Exception:
        logger.exception("hitlist_bodyguard_events admin_robot_bodyguards_replaced failed")

    await log_activity(
        current_user.get("id") or "?",
        current_user.get("username") or "?",
        "admin_replace_robot_bodyguards",
        {"target_username": target_username, "target_id": owner_id, "replaced_count": len(replaced)},
    )
    _invalidate_bodyguards_cache(owner_id)
    return {
        "message": f"Replaced {len(replaced)} robot bodyguard(s) for {target_username} (new NPC identities; human slots unchanged)",
        "replaced": len(replaced),
        "slots": replaced,
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
        await db.users.delete_many({"is_bodyguard": True, "is_npc": True, "bodyguard_owner_id": target["id"]})
        await db.users.update_many(
            {"is_bodyguard": True, "bodyguard_owner_id": target["id"]},
            {"$unset": {"is_bodyguard": "", "bodyguard_owner_id": ""}},
        )
    desired_slots = max(int(target.get("bodyguard_slots", 0) or 0), count)
    desired_slots = min(4, desired_slots)
    if desired_slots != (int(target.get("bodyguard_slots", 0) or 0)):
        await db.users.update_one({"id": target["id"]}, {"$set": {"bodyguard_slots": desired_slots}})
    created = 0
    intervals_between_ms = []
    t_prev = time.perf_counter()
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
        t_now = time.perf_counter()
        intervals_between_ms.append(round((t_now - t_prev) * 1000, 3))
        t_prev = t_now
    _invalidate_bodyguards_cache(target["id"])
    payload = {"message": f"Generated {created} robot bodyguard(s) for {target_username}", "created": created, "count_requested": count}
    if intervals_between_ms:
        payload["intervals_between_robot_bodyguards_ms"] = intervals_between_ms
    return payload


async def admin_sync_robot_bodyguard_locations(
    dry_run: bool = Query(False, description="If true, only report counts and samples; no DB writes."),
    current_user: dict = Depends(get_current_user),
):
    """One-time / maintenance: set each robot bodyguard's current_state to their owner's current_state (valid STATES only)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")

    stats = {
        "dry_run": dry_run,
        "robots_scanned": 0,
        "updated": 0,
        "unchanged": 0,
        "skipped_no_owner": 0,
        "skipped_owner_invalid_state": 0,
    }
    samples: List[dict] = []
    bulk: List[UpdateOne] = []

    cursor = db.users.find(
        {
            "is_npc": True,
            "is_bodyguard": True,
            "bodyguard_owner_id": {"$exists": True, "$nin": [None, ""]},
        },
        {"_id": 0, "id": 1, "username": 1, "current_state": 1, "bodyguard_owner_id": 1},
    )
    async for robot in cursor:
        stats["robots_scanned"] += 1
        raw_oid = robot.get("bodyguard_owner_id")
        owner_id = str(raw_oid).strip() if raw_oid is not None else ""
        if not owner_id:
            stats["skipped_no_owner"] += 1
            continue
        owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "current_state": 1, "username": 1})
        if not owner:
            stats["skipped_no_owner"] += 1
            continue
        own_st = owner.get("current_state")
        if own_st not in STATES:
            stats["skipped_owner_invalid_state"] += 1
            continue
        prev = robot.get("current_state")
        if prev == own_st:
            stats["unchanged"] += 1
            continue
        stats["updated"] += 1
        if len(samples) < 25:
            samples.append(
                {
                    "robot_username": robot.get("username"),
                    "owner_username": owner.get("username"),
                    "from": prev,
                    "to": own_st,
                }
            )
        if not dry_run:
            bulk.append(UpdateOne({"id": robot["id"]}, {"$set": {"current_state": own_st}}))
            if len(bulk) >= 500:
                await db.users.bulk_write(bulk, ordered=False)
                bulk = []

    if bulk:
        await db.users.bulk_write(bulk, ordered=False)

    action = "Would update" if dry_run else "Updated"
    return {
        "message": (
            f"{action} {stats['updated']} robot bodyguard location(s); "
            f"{stats['unchanged']} already correct; "
            f"{stats['skipped_no_owner']} skipped (missing owner); "
            f"{stats['skipped_owner_invalid_state']} skipped (owner has no valid city)."
        ),
        **stats,
        "samples": samples,
    }


async def admin_get_bodyguard_hire_intervals(
    target_username: str,
    current_user: dict = Depends(get_current_user),
):
    """Admin-only: Return time between robot bodyguard hires (ms) for a target user."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    username_pattern = _username_pattern((target_username or "").strip())
    if not username_pattern:
        raise HTTPException(status_code=400, detail="Target username required")
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    bodyguards = await db.bodyguards.find(
        {"user_id": target["id"]},
        {"_id": 0, "slot_number": 1, "is_robot": 1, "hired_at": 1},
    ).to_list(10)
    robots = [b for b in bodyguards if b.get("is_robot") and b.get("hired_at")]
    robots.sort(key=lambda b: _parse_iso_datetime(b["hired_at"]) or datetime.min.replace(tzinfo=timezone.utc))
    intervals_ms = []
    for i in range(1, len(robots)):
        t1 = _parse_iso_datetime(robots[i - 1]["hired_at"])
        t2 = _parse_iso_datetime(robots[i]["hired_at"])
        if t1 and t2:
            delta_ms = (t2 - t1).total_seconds() * 1000
            intervals_ms.append(round(delta_ms, 3))
    total_ms = round(sum(intervals_ms), 3) if intervals_ms else 0
    total_seconds = round(total_ms / 1000, 3)
    return {
        "username": target.get("username"),
        "robot_count": len(robots),
        "intervals_between_robot_bodyguards_ms": intervals_ms,
        "total_ms": total_ms,
        "total_seconds": total_seconds,
    }


async def admin_reset_bodyguard_cooldown(current_user: dict = Depends(get_current_user)):
    """Admin-only: Reset the bodyguard drop cooldown timer for yourself."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$unset": {"bodyguard_last_drop_at": ""}}
    )
    _invalidate_bodyguards_cache(current_user["id"])
    return {"message": "Bodyguard drop cooldown reset. You can drop a bodyguard now."}


async def admin_seed_human_bodyguards(current_user: dict = Depends(get_current_user)):
    """Admin-only: Clear all robots and create 4 human bodyguards for testing.
    Creates dummy human users as bodyguards if they don't exist."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    admin_id = current_user["id"]
    
    # Clear all existing bodyguards (robots and humans) for admin
    await db.bodyguards.delete_many({"user_id": admin_id})
    await db.users.delete_many({"is_bodyguard": True, "is_npc": True, "bodyguard_owner_id": admin_id})
    await db.users.update_many(
        {"is_bodyguard": True, "bodyguard_owner_id": admin_id},
        {"$unset": {"is_bodyguard": "", "bodyguard_owner_id": ""}},
    )
    
    # Ensure admin has 4 slots
    await db.users.update_one({"id": admin_id}, {"$set": {"bodyguard_slots": 4}})
    
    now = datetime.now(timezone.utc)
    created = 0
    
    # Create 4 human bodyguards
    for slot in range(1, 5):
        # Create or find a dummy human bodyguard user
        guard_username = f"TestGuard{slot}"
        guard_user = await db.users.find_one({"username": guard_username}, {"_id": 0, "id": 1})
        
        if not guard_user:
            # Create a new dummy user
            guard_id = str(uuid.uuid4())
            await db.users.insert_one({
                "id": guard_id,
                "username": guard_username,
                "email": f"testguard{slot}@test.local",
                "password_hash": "disabled",
                "created_at": now.isoformat(),
                "rank_points": 100,
                "money": 10000,
                "points": 100,
                "health": 100,
                "current_state": current_user.get("current_state", "New York"),
                "is_bodyguard": True,
                "bodyguard_owner_id": admin_id,
            })
        else:
            guard_id = guard_user["id"]
            # Mark existing user as bodyguard
            await db.users.update_one(
                {"id": guard_id},
                {"$set": {"is_bodyguard": True, "bodyguard_owner_id": admin_id}}
            )
        
        # Create bodyguard slot
        await db.bodyguards.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": admin_id,
            "owner_username": current_user.get("username"),
            "slot_number": slot,
            "is_robot": False,
            "bodyguard_user_id": guard_id,
            "bodyguard_username": guard_username,
            "health": 100,
            "armour_level": 0,
            "payment_points": 10,
            "payment_money": 1000,
            "payout_weekday": 0,
            "last_payout_date": None,
            "hired_at": now.isoformat(),
            "hire_cost": 100,
        })
        created += 1
    
    _invalidate_bodyguards_cache(admin_id)
    return {
        "message": f"Cleared all bodyguards and created {created} human bodyguards for testing",
        "created": created,
        "bodyguards": ["TestGuard1", "TestGuard2", "TestGuard3", "TestGuard4"],
    }


async def admin_seed_random_bodyguards(current_user: dict = Depends(get_current_user)):
    """Admin-only: Clear all bodyguards and create 4 random bodyguards (mix of robots and humans).
    The mix is random - could be 2R/2H, 1H/3R, alternating R-H-H-R, etc."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    admin_id = current_user["id"]
    
    # Clear all existing bodyguards (robots and humans) for admin
    await db.bodyguards.delete_many({"user_id": admin_id})
    # Remove robot users only; release human bodyguards (clear flags)
    await db.users.delete_many({"is_bodyguard": True, "is_npc": True, "bodyguard_owner_id": admin_id})
    await db.users.update_many(
        {"is_bodyguard": True, "bodyguard_owner_id": admin_id},
        {"$unset": {"is_bodyguard": "", "bodyguard_owner_id": ""}},
    )
    
    # Ensure admin has 4 slots
    await db.users.update_one({"id": admin_id}, {"$set": {"bodyguard_slots": 4}})
    
    now = datetime.now(timezone.utc)
    
    # Generate random mix: pick how many humans (0-4), rest are robots
    # To ensure variety, we'll pick a random pattern
    patterns = [
        [True, True, False, False],     # 2 robots, 2 humans (R-R-H-H)
        [False, False, True, True],     # 2 humans, 2 robots (H-H-R-R)
        [True, False, True, False],     # alternating R-H-R-H
        [False, True, False, True],     # alternating H-R-H-R
        [True, False, False, True],     # R-H-H-R
        [False, True, True, False],     # H-R-R-H
        [True, True, True, False],      # 3 robots, 1 human
        [False, True, True, True],      # 1 human, 3 robots
        [True, False, False, False],    # 1 robot, 3 humans
        [False, False, False, True],    # 3 humans, 1 robot
    ]
    pattern = random.choice(patterns)
    
    created_info = []
    human_counter = 0
    robot_counter = 0
    
    for slot in range(1, 5):
        is_robot = pattern[slot - 1]
        
        if is_robot:
            robot_counter += 1
            # Create robot bodyguard (similar to normal hire)
            guard_id = str(uuid.uuid4())
            guard_username = f"RobotGuard_{admin_id[:8]}_{slot}"
            await db.users.insert_one({
                "id": guard_id,
                "username": guard_username,
                "email": f"robot_{slot}_{admin_id[:8]}@bot.local",
                "password_hash": "disabled",
                "created_at": now.isoformat(),
                "rank_points": 0,
                "money": 0,
                "points": 0,
                "health": 100,
                "current_state": current_user.get("current_state", "New York"),
                "is_bodyguard": True,
                "bodyguard_owner_id": admin_id,
            })
            await db.bodyguards.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": admin_id,
                "owner_username": current_user.get("username"),
                "slot_number": slot,
                "is_robot": True,
                "bodyguard_user_id": guard_id,
                "bodyguard_username": guard_username,
                "health": 100,
                "armour_level": 0,
                "hired_at": now.isoformat(),
                "hire_cost": 100,
            })
            created_info.append(f"Slot {slot}: Robot ({guard_username})")
        else:
            human_counter += 1
            # Create human bodyguard
            guard_username = f"TestHuman{human_counter}"
            guard_user = await db.users.find_one({"username": guard_username}, {"_id": 0, "id": 1})
            
            if not guard_user:
                guard_id = str(uuid.uuid4())
                await db.users.insert_one({
                    "id": guard_id,
                    "username": guard_username,
                    "email": f"testhuman{human_counter}@test.local",
                    "password_hash": "disabled",
                    "created_at": now.isoformat(),
                    "rank_points": 100,
                    "money": 10000,
                    "points": 100,
                    "health": 100,
                    "current_state": current_user.get("current_state", "New York"),
                    "is_bodyguard": True,
                    "bodyguard_owner_id": admin_id,
                })
            else:
                guard_id = guard_user["id"]
                await db.users.update_one(
                    {"id": guard_id},
                    {"$set": {"is_bodyguard": True, "bodyguard_owner_id": admin_id}}
                )
            
            await db.bodyguards.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": admin_id,
                "owner_username": current_user.get("username"),
                "slot_number": slot,
                "is_robot": False,
                "bodyguard_user_id": guard_id,
                "bodyguard_username": guard_username,
                "health": 100,
                "armour_level": 0,
                "payment_points": 10,
                "payment_money": 1000,
                "payout_weekday": 0,
                "last_payout_date": None,
                "hired_at": now.isoformat(),
                "hire_cost": 100,
            })
            created_info.append(f"Slot {slot}: Human ({guard_username})")
    
    _invalidate_bodyguards_cache(admin_id)
    
    pattern_str = "-".join("R" if r else "H" for r in pattern)
    return {
        "message": f"Created 4 random bodyguards: {robot_counter} robot(s), {human_counter} human(s). Pattern: {pattern_str}",
        "pattern": pattern_str,
        "robots": robot_counter,
        "humans": human_counter,
        "slots": created_info,
    }


# ----- Weekly payout (human bodyguards) -----
# bodyguard_payouts: one doc per (owner_id, slot_number, payout_date) for audit and crash safety.
# Unique index on (owner_id, slot_number, payout_date) prevents double-pay; we check it before paying.


async def run_bodyguard_weekly_payout(database, test_run: bool = False):
    """Run once per day; on each bodyguard's payout_weekday, pay them and record in bodyguard_payouts.
    If test_run=True (admin test), pay all eligible human bodyguards regardless of payout_weekday."""
    import logging
    log = logging.getLogger(__name__)
    now = datetime.now(timezone.utc)
    today_str = now.date().isoformat()
    weekday = now.weekday()  # 0=Monday, 6=Sunday
    query = {
        "is_robot": False,
        "bodyguard_user_id": {"$exists": True, "$ne": None},
    }
    if not test_run:
        query["payout_weekday"] = weekday
    cursor = database.bodyguards.find(query)
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
        # Skip if we already paid today (by date). In test_run, only trust bodyguard_payouts so we can fix docs that had last_payout_date set without actual pay
        if last == today_str and not test_run:
            continue
        contract_end = bg.get("contract_end")
        if contract_end:
            end = _parse_iso_datetime(contract_end)
            if end is not None and now >= end:
                continue
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
        if pay_pts:
            await log_points_event(database, user_id=owner_id, points=-pay_pts, event_type="bodyguard_weekly_pay_debit",
                                   event_ref=f"guard:{guard_id}", meta={"slot": slot_number})
            await log_points_event(database, user_id=guard_id, points=pay_pts, event_type="bodyguard_weekly_pay_credit",
                                   event_ref=f"owner:{owner_id}", meta={"slot": slot_number})
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
    """Owner drops a bodyguard (robot or human) from a slot. Payments stop; the slot becomes empty. Once every 3 hours (shared cooldown for all types)."""
    if slot < 1 or slot > 4:
        raise HTTPException(status_code=400, detail="Invalid slot")
    now = datetime.now(timezone.utc)
    cooldown_threshold = (now - timedelta(seconds=BODYGUARD_DROP_COOLDOWN_SECONDS)).isoformat()
    cooldown_claim = await db.users.find_one_and_update(
        {"id": current_user["id"],
         "$or": [
             {"bodyguard_last_drop_at": {"$exists": False}},
             {"bodyguard_last_drop_at": None},
             {"bodyguard_last_drop_at": {"$lte": cooldown_threshold}},
         ]},
        {"$set": {"bodyguard_last_drop_at": now.isoformat()}},
        projection={"_id": 0, "id": 1},
    )
    if not cooldown_claim:
        owner_doc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "bodyguard_last_drop_at": 1})
        last_drop = _parse_iso_datetime((owner_doc or {}).get("bodyguard_last_drop_at")) if owner_doc else None
        secs_left = int(BODYGUARD_DROP_COOLDOWN_SECONDS - (now - last_drop).total_seconds()) if last_drop else BODYGUARD_DROP_COOLDOWN_SECONDS
        raise HTTPException(
            status_code=429,
            detail=f"You can only drop a bodyguard once every {BODYGUARD_DROP_COOLDOWN_SECONDS} seconds. Try again in {max(1, secs_left)} seconds.",
        )
    bg = await db.bodyguards.find_one(
        {"user_id": current_user["id"], "slot_number": slot},
        {"_id": 0, "bodyguard_user_id": 1, "is_robot": 1},
    )
    if not bg:
        await db.users.update_one({"id": current_user["id"]}, {"$unset": {"bodyguard_last_drop_at": ""}})
        raise HTTPException(status_code=404, detail="No bodyguard in that slot")
    guard_id = bg.get("bodyguard_user_id")
    if not guard_id:
        await db.users.update_one({"id": current_user["id"]}, {"$unset": {"bodyguard_last_drop_at": ""}})
        raise HTTPException(status_code=400, detail="Slot is already empty")
    is_robot = bg.get("is_robot", False)
    guard_user = await db.users.find_one({"id": guard_id}, {"_id": 0, "username": 1})
    guard_name = guard_user.get("username", "?") if guard_user else "?"

    if is_robot:
        # Robot: delete the bodyguard slot doc and the robot user record entirely (is_npc ensures we never delete real players)
        await db.bodyguards.delete_one({"user_id": current_user["id"], "slot_number": slot})
        await db.users.delete_one({"id": guard_id, "is_bodyguard": True, "is_npc": True})
    else:
        # Human: delete the bodyguard slot doc, remove bodyguard flags from user
        await db.bodyguards.delete_one({"user_id": current_user["id"], "slot_number": slot})
        await db.users.update_one(
            {"id": guard_id},
            {"$unset": {"is_bodyguard": "", "bodyguard_owner_id": ""}},
        )
        # Notify only human bodyguards (robots don't need notifications)
        await send_notification(
            guard_id,
            "🛡️ Bodyguard Dropped",
            f"{current_user.get('username', '?')} has dropped you as their bodyguard. You are no longer under contract.",
            "bodyguard",
        )

    now = datetime.now(timezone.utc)
    await db.hitlist_bodyguard_events.insert_one({
        "at": now,
        "type": "bodyguard_dropped",
        "owner_id": current_user["id"],
        "owner_username": current_user.get("username") or "",
        "guard_id": guard_id,
        "guard_username": guard_name,
        "slot": slot,
        "is_robot": is_robot,
    })
    # Shift higher slots down to fill the gap (slot 4 -> 3, 3 -> 2, etc.)
    # Process from lowest to highest to avoid conflicts
    for higher_slot in range(slot + 1, 5):
        await db.bodyguards.update_one(
            {"user_id": current_user["id"], "slot_number": higher_slot},
            {"$set": {"slot_number": higher_slot - 1}},
        )

    _invalidate_bodyguards_cache(current_user["id"])
    if not is_robot:
        _invalidate_bodyguards_cache(guard_id)
    guard_type = "robot" if is_robot else "human"
    await log_activity(current_user["id"], current_user.get("username", "?"), "bodyguard_drop", {
        "slot": slot, "guard": guard_name, "type": guard_type,
    })
    return {"message": f"Dropped {guard_name} ({guard_type}) from slot {slot}. You can drop again in {BODYGUARD_DROP_COOLDOWN_SECONDS} seconds."}


async def admin_test_bodyguard_payout(current_user: dict = Depends(get_current_user)):
    """Admin-only: run the weekly bodyguard payout job once (for testing). Pays all eligible human bodyguards regardless of payout day. Returns how many were paid."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    paid = await run_bodyguard_weekly_payout(db, test_run=True)
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
    router.add_api_route("/bodyguards/invites/{invite_id}/cancel", cancel_bodyguard_invite, methods=["POST"])
    router.add_api_route("/bodyguards/drop", drop_bodyguard, methods=["POST"])
    router.add_api_route("/admin/bodyguards/clear", admin_clear_bodyguards, methods=["POST"])
    router.add_api_route("/admin/bodyguards/test-payout", admin_test_bodyguard_payout, methods=["POST"])
    router.add_api_route("/admin/bodyguards/drop-all-human", admin_drop_all_human_bodyguards, methods=["POST"])
    router.add_api_route("/admin/bodyguards/drop-all", admin_drop_all_bodyguards, methods=["POST"])
    router.add_api_route("/admin/bodyguards/generate", admin_generate_bodyguards, methods=["POST"])
    router.add_api_route("/admin/bodyguards/replace-robots-hacked", admin_replace_robot_bodyguards_hacked, methods=["POST"])
    router.add_api_route("/admin/bodyguards/sync-robot-locations", admin_sync_robot_bodyguard_locations, methods=["POST"])
    router.add_api_route("/admin/bodyguards/seed-humans", admin_seed_human_bodyguards, methods=["POST"])
    router.add_api_route("/admin/bodyguards/seed-random", admin_seed_random_bodyguards, methods=["POST"])
    router.add_api_route("/admin/bodyguards/reset-cooldown", admin_reset_bodyguard_cooldown, methods=["POST"])
    router.add_api_route("/admin/bodyguards/hire-intervals", admin_get_bodyguard_hire_intervals, methods=["GET"])
