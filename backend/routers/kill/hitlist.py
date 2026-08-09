# Hitlist endpoints: place bounties, list, buy off (self/other), reveal, NPCs
from datetime import datetime, timezone, timedelta
import logging
import re
import random
import uuid
from typing import Optional
from pydantic import BaseModel

from fastapi import Depends, HTTPException, Request

from utils.point_provenance import log_points_event
from utils.family_perks import family_perk_modifiers
from utils.hitlist_resolution import resolve_user_hitlist_kill
from utils.civilian_protection import maybe_revoke_civilian_protection, require_protection_revoke_confirm
from server import (
    db,
    get_current_user,
    send_notification,
    log_activity,
    RANKS,
    STATES,
    DEFAULT_HEALTH,
)
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_HITLIST

logger = logging.getLogger(__name__)


async def _hitlist_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_HITLIST)


_hitlist_rl_u = [Depends(_hitlist_sustained_rl_user)]


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


# Request models (used only by hitlist)
class HitlistAddRequest(BaseModel):
    target_username: str
    target_type: str  # "user" | "bodyguards"
    reward_type: Optional[str] = None  # "cash" | "points" when using single reward
    reward_amount: Optional[int] = None  # when using single reward
    reward_cash: Optional[int] = 0  # optional: cash reward (can combine with reward_points)
    reward_points: Optional[int] = 0  # optional: points reward (can combine with reward_cash)
    hidden: bool = False


class HitlistBuyOffUserRequest(BaseModel):
    target_username: str


# Constants
HITLIST_HIDDEN_MULTIPLIER = 1.5  # 50% extra for hidden
HITLIST_BUY_OFF_MULTIPLIER = 1.5  # pay bounty amount + 50% per entry (cash or points, same as placed)
HITLIST_REVEAL_COST_POINTS = 5000
# Max practice NPCs **on the board at once** per placer (same numbers as former "per 3h window" + store bonus).
HITLIST_NPC_MAX_PER_WINDOW = 3
HITLIST_NPC_STORE_BONUS_SLOTS_MAX = 3  # base 3 + max 3 from store = 6
HITLIST_NPC_MAX_AGE = timedelta(hours=48)  # stale practice NPCs drop off so slots free up

HITLIST_NPC_NAMES = [
    "Tony the Rat", "Vinny the Snake", "Lucky Lou", "Mad Dog Mike",
    "Scarface Sam", "Big Al", "Johnny Two-Times", "Knuckles McGee",
    "Frankie the Fist", "Lefty Louie", "Joey Bananas", "Paulie Walnuts",
]

# 75% reduction for beta; points replaced with respect_points
HITLIST_NPC_TEMPLATES = [
    {"id": "npc_1", "rank": 2, "rewards": {"cash": 100_000, "booze": {"bathtub_gin": 15}, "respect_points": 25}},
    {"id": "npc_2", "rank": 4, "rewards": {"cash": 200_000, "respect_points": 50}},
    {"id": "npc_3", "rank": 5, "rewards": {"rank_points": 120, "respect_points": 30}},
    {"id": "npc_4", "rank": 3, "rewards": {"cash": 150_000, "booze": {"moonshine": 25}, "respect_points": 20}},
    {"id": "npc_5", "rank": 6, "rewards": {"respect_points": 75, "rank_points": 90}},
    {"id": "npc_6", "rank": 6, "rewards": {"cash": 250_000, "booze": {"rum_runners": 20}, "respect_points": 40}},
    {"id": "npc_7", "rank": 5, "rewards": {"cash": 500_000, "respect_points": 60}},
    {"id": "npc_8", "rank": 8, "rewards": {"rank_points": 225, "respect_points": 100}},
    {"id": "npc_9", "rank": 3, "rewards": {"cash": 400_000, "booze": {"speakeasy_whiskey": 10, "needle_beer": 10}, "respect_points": 15}},
    {"id": "npc_10", "rank": 7, "rewards": {"cash": 500_000, "booze": {"jamaica_ginger": 30}, "respect_points": 50}},
]


async def _hitlist_npc_max_per_window_for_user(user: dict) -> int:
    bonus = int((user or {}).get("hitlist_npc_bonus_slots") or 0)
    bonus = max(0, min(HITLIST_NPC_STORE_BONUS_SLOTS_MAX, bonus))
    n = HITLIST_NPC_MAX_PER_WINDOW + bonus
    fid = (user or {}).get("family_id")
    if fid:
        rpm = await family_perk_modifiers(db, str(fid).strip())
        n += int(rpm.get("hitlist_npc_slots") or 0)
    return n


async def _hitlist_npc_active_on_board_count(placer_id: str) -> int:
    return await db.hitlist.count_documents({"placer_id": placer_id, "target_type": "npc"})


async def _expire_stale_hitlist_npcs(*, placer_id: Optional[str] = None) -> int:
    """Remove practice NPCs older than 48h (hitlist row + attack searches; mark NPC user dead). Returns count removed."""
    query: dict = {"target_type": "npc"}
    if placer_id:
        query["placer_id"] = placer_id
    cutoff = datetime.now(timezone.utc) - HITLIST_NPC_MAX_AGE
    expired = []
    async for doc in db.hitlist.find(query, {"_id": 0, "id": 1, "target_id": 1, "created_at": 1}):
        created = _parse_iso_datetime(doc.get("created_at"))
        if created is None or created <= cutoff:
            expired.append(doc)
    if not expired:
        return 0
    now_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    removed = 0
    for doc in expired:
        hitlist_id = (doc.get("id") or "").strip()
        target_id = (doc.get("target_id") or "").strip()
        if hitlist_id:
            res = await db.hitlist.delete_one({"id": hitlist_id, "target_type": "npc"})
            if res.deleted_count:
                removed += 1
        elif target_id:
            res = await db.hitlist.delete_many({"target_id": target_id, "target_type": "npc"})
            removed += int(res.deleted_count or 0)
        if target_id:
            try:
                await db.attacks.delete_many({"target_id": target_id})
            except Exception:
                logger.exception("expire hitlist npc: attacks delete failed target_id=%s", target_id)
            try:
                await db.users.update_one(
                    {"id": target_id, "is_npc": True},
                    {"$set": {"is_dead": True, "dead_at": now_iso, "health": 0}},
                )
            except Exception:
                logger.exception("expire hitlist npc: mark dead failed target_id=%s", target_id)
    return removed


async def hitlist_add(
    request: HitlistAddRequest,
    req: Request,
    current_user: dict = Depends(get_current_user),
):
    """Place a bounty on a user or their bodyguards. Cash and/or points; optional hidden (+50% cost). Can place on yourself."""
    require_protection_revoke_confirm(current_user, reason="hitlist_add", request=req)
    target_username = (request.target_username or "").strip()
    if not target_username:
        raise HTTPException(status_code=400, detail="Target username required")
    target_type = (request.target_type or "").strip().lower()
    if target_type not in ("user", "bodyguards"):
        raise HTTPException(status_code=400, detail="target_type must be 'user' or 'bodyguards'")
    hidden = bool(request.hidden)
    mult = HITLIST_HIDDEN_MULTIPLIER if hidden else 1.0

    reward_cash = max(0, int(request.reward_cash or 0))
    reward_points = max(0, int(request.reward_points or 0))
    use_dual = reward_cash > 0 or reward_points > 0

    if use_dual:
        cost_cash = int(reward_cash * mult)
        cost_points = int(reward_points * mult)
        if cost_cash > 0 and (current_user.get("money") or 0) < cost_cash:
            raise HTTPException(status_code=400, detail=f"Insufficient cash (need ${cost_cash:,})")
        if cost_points > 0 and (current_user.get("points") or 0) < cost_points:
            raise HTTPException(status_code=400, detail=f"Insufficient points (need {cost_points:,})")
        if reward_cash < 1 and reward_points < 1:
            raise HTTPException(status_code=400, detail="Enter at least one reward (cash and/or points)")
    else:
        reward_type = (request.reward_type or "").strip().lower()
        if reward_type not in ("cash", "points"):
            raise HTTPException(status_code=400, detail="reward_type must be 'cash' or 'points'")
        reward_amount = int(request.reward_amount or 0)
        if reward_amount < 1:
            raise HTTPException(status_code=400, detail="Reward amount must be at least 1")
        cost_cash = int(reward_amount * mult) if reward_type == "cash" else 0
        cost_points = int(reward_amount * mult) if reward_type == "points" else 0
        if cost_cash > 0 and (current_user.get("money") or 0) < cost_cash:
            raise HTTPException(status_code=400, detail=f"Insufficient cash (need ${cost_cash:,})")
        if cost_points > 0 and (current_user.get("points") or 0) < cost_points:
            raise HTTPException(status_code=400, detail=f"Insufficient points (need {cost_points:,})")

    # Case-insensitive username lookup
    import re
    username_pattern = re.compile("^" + re.escape(target_username.strip()) + "$", re.IGNORECASE)
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1, "is_dead": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    if target.get("is_dead"):
        raise HTTPException(status_code=400, detail="Cannot place bounty on a dead account")
    if target_type == "bodyguards":
        bgs = await db.bodyguards.find({"user_id": target["id"]}, {"_id": 0}).to_list(10)
        if not any(b.get("bodyguard_user_id") or b.get("is_robot") for b in bgs):
            raise HTTPException(status_code=400, detail="Target has no bodyguards")

    now = datetime.now(timezone.utc)
    updates = {}
    gte_filter = {"id": current_user["id"]}
    if cost_cash > 0:
        updates["$inc"] = updates.get("$inc") or {}
        updates["$inc"]["money"] = -cost_cash
        gte_filter["money"] = {"$gte": cost_cash}
    if cost_points > 0:
        updates["$inc"] = updates.get("$inc") or {}
        updates["$inc"]["points"] = -cost_points
        gte_filter["points"] = {"$gte": cost_points}
    if updates:
        deduct_result = await db.users.update_one(gte_filter, updates)
        if deduct_result.modified_count == 0:
            raise HTTPException(status_code=400, detail="Insufficient funds")
        if cost_points > 0:
            await log_points_event(db, user_id=current_user["id"], points=-cost_points, event_type="hitlist_place_bounty",
                                   event_ref=f"target:{target['id']}", meta={"target_username": target.get("username")})

    inserted = []
    if use_dual:
        if reward_cash > 0:
            hitlist_id = str(uuid.uuid4())
            await db.hitlist.insert_one({
                "id": hitlist_id,
                "target_id": target["id"],
                "target_username": target["username"],
                "target_type": target_type,
                "placer_id": current_user["id"],
                "placer_username": current_user.get("username") or "",
                "reward_type": "cash",
                "reward_amount": reward_cash,
                "hidden": hidden,
                "created_at": now.isoformat(),
            })
            inserted.append(f"${reward_cash:,} cash")
        if reward_points > 0:
            hitlist_id = str(uuid.uuid4())
            await db.hitlist.insert_one({
                "id": hitlist_id,
                "target_id": target["id"],
                "target_username": target["username"],
                "target_type": target_type,
                "placer_id": current_user["id"],
                "placer_username": current_user.get("username") or "",
                "reward_type": "points",
                "reward_amount": reward_points,
                "hidden": hidden,
                "created_at": now.isoformat(),
            })
            inserted.append(f"{reward_points:,} pts")
        msg = f"Bounty placed on {target['username']} ({target_type}): " + " + ".join(inserted) + (" (hidden)" if hidden else "")
    else:
        reward_type = (request.reward_type or "").strip().lower()
        reward_amount = int(request.reward_amount or 0)
        hitlist_id = str(uuid.uuid4())
        await db.hitlist.insert_one({
            "id": hitlist_id,
            "target_id": target["id"],
            "target_username": target["username"],
            "target_type": target_type,
            "placer_id": current_user["id"],
            "placer_username": current_user.get("username") or "",
            "reward_type": reward_type,
            "reward_amount": reward_amount,
            "hidden": hidden,
            "created_at": now.isoformat(),
        })
        msg = f"Bounty placed on {target['username']} ({target_type}) for {reward_amount} {reward_type}" + (" (hidden)" if hidden else "")
    await log_activity(
        current_user["id"],
        current_user.get("username") or "?",
        "hitlist_add",
        {"target_username": target["username"], "target_type": target_type, "reward_cash": reward_cash, "reward_points": reward_points, "hidden": hidden},
    )
    now_iso = now.isoformat()
    if use_dual:
        await db.hitlist_bodyguard_events.insert_one({
            "at": now_iso,
            "type": "hitlist_placed",
            "placer_id": current_user["id"],
            "placer_username": current_user.get("username") or "",
            "target_id": target["id"],
            "target_username": target["username"],
            "target_type": target_type,
            "reward_cash": reward_cash,
            "reward_points": reward_points,
            "hidden": hidden,
        })
    else:
        await db.hitlist_bodyguard_events.insert_one({
            "at": now_iso,
            "type": "hitlist_placed",
            "placer_id": current_user["id"],
            "placer_username": current_user.get("username") or "",
            "target_id": target["id"],
            "target_username": target["username"],
            "target_type": target_type,
            "reward_type": (request.reward_type or "").strip().lower(),
            "reward_amount": int(request.reward_amount or 0),
            "hidden": hidden,
        })
    await maybe_revoke_civilian_protection(db, current_user["id"], "hitlist_add")
    return {"message": msg}


async def hitlist_npc_status(current_user: dict = Depends(get_current_user)):
    """Practice NPCs: cap = how many of your NPC rows are still on the hitlist; kill one or wait 48h expiry to free a slot."""
    uid = current_user["id"]
    await _expire_stale_hitlist_npcs(placer_id=uid)
    max_on_board = await _hitlist_npc_max_per_window_for_user(current_user)
    active = await _hitlist_npc_active_on_board_count(uid)
    can_add = active < max_on_board
    return {
        "can_add": can_add,
        "active_on_board": active,
        "max_on_board": max_on_board,
        "adds_used_in_window": active,
        "max_per_window": max_on_board,
        "npc_max_age_hours": int(HITLIST_NPC_MAX_AGE.total_seconds() // 3600),
        "next_add_at": None,
        "seconds_until_next_slot": None,
        "window_next_frees_at": None,
        "seconds_until_window_frees": None,
    }


async def hitlist_add_npc(current_user: dict = Depends(get_current_user)):
    """Add a random NPC to the hitlist. At most N practice NPCs on the board at once (N=3 base, up to 6 with store). Expires after 48h."""
    now = datetime.now(timezone.utc)
    now_iso = now.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    uid = current_user["id"]
    await _expire_stale_hitlist_npcs(placer_id=uid)
    max_on_board = await _hitlist_npc_max_per_window_for_user(current_user)
    active = await _hitlist_npc_active_on_board_count(uid)
    if active >= max_on_board:
        raise HTTPException(
            status_code=400,
            detail=(
                f"You already have {active} practice NPC(s) on the board (max {max_on_board}). "
                "Kill one from Attack, or wait for one to expire after 48 hours."
            ),
        )
    template = random.choice(HITLIST_NPC_TEMPLATES)
    hitlist_id = str(uuid.uuid4())
    npc_user_id = str(uuid.uuid4())
    rewards = {k: v for k, v in (template.get("rewards") or {}).items() if k != "bullets"}
    rank_id = max(1, min(template.get("rank", 1), len(RANKS)))
    rank_points = RANKS[rank_id - 1]["required_points"]
    rank_name = RANKS[rank_id - 1]["name"]
    base_name = random.choice(HITLIST_NPC_NAMES)
    npc_username = f"{base_name} (NPC) #{hitlist_id[:8]}"
    npc_state = random.choice(STATES)
    await db.users.insert_one({
        "id": npc_user_id,
        "username": npc_username,
        "email": f"npc.{npc_user_id}@hitlist.local",
        "password_hash": "",
        "is_npc": True,
        "is_dead": False,
        "rank_points": rank_points,
        "money": 0,
        "points": 0,
        "bullets": 0,
        "health": DEFAULT_HEALTH,
        "armour_level": 0,
        "current_state": npc_state,
        "total_kills": 0,
        "total_deaths": 0,
        "created_at": now_iso,
    })
    await db.hitlist.insert_one({
        "id": hitlist_id,
        "target_id": npc_user_id,
        "target_username": npc_username,
        "target_type": "npc",
        "placer_id": current_user["id"],
        "placer_username": current_user.get("username") or "",
        "reward_type": "npc",
        "reward_amount": 0,
        "hidden": False,
        "npc_rank": rank_id,
        "npc_template_id": template.get("id", ""),
        "npc_rewards": dict(rewards),
        "created_at": now_iso,
    })

    from routers.kill.attack import insert_attack_search_row

    await insert_attack_search_row(
        db,
        attacker=current_user,
        target={
            "id": npc_user_id,
            "username": npc_username,
            "current_state": npc_state,
            "is_npc": True,
            "is_bodyguard": False,
        },
        note="Automatic search for hitlist npc",
        source="hitlist_npc",
    )

    reward_labels = {"rank_points": "XP", "bullets": "Bullets", "respect_points": "Respect", "cash": "Cash", "points": "Points"}
    reward_parts = []
    for k, v in rewards.items():
        if not v or k == "booze":
            continue
        label = reward_labels.get(k, k.replace("_", " ").title())
        formatted_val = f"{v:,}" if isinstance(v, (int, float)) else str(v)
        reward_parts.append(f"{formatted_val} {label}")
    reward_desc = ", ".join(reward_parts) or "various"
    if isinstance(rewards.get("booze"), dict) and rewards["booze"]:
        reward_desc += ", Booze"
    await log_activity(
        current_user["id"],
        current_user.get("username") or "?",
        "hitlist_add_npc",
        {"npc_username": npc_username, "hitlist_id": hitlist_id, "rank_name": rank_name, "npc_template_id": template.get("id", "")},
    )
    await db.hitlist_bodyguard_events.insert_one({
        "at": now_iso,
        "type": "hitlist_placed_npc",
        "placer_id": current_user["id"],
        "placer_username": current_user.get("username") or "",
        "npc_user_id": npc_user_id,
        "npc_username": npc_username,
        "npc_rank": rank_id,
        "npc_template_id": template.get("id", ""),
    })
    return {"message": f"Added {base_name} (NPC) — {rank_name}. Rewards: {reward_desc}. Attack them from the Attack page.", "hitlist_id": hitlist_id}


async def hitlist_list(current_user: dict = Depends(get_current_user)):
    """List public hitlist entries (user bounties) + only this user's NPC entries. NPCs are personal per placer.
    Never expose placer_id or target_id in response (privacy: prevent correlating placers with other data)."""
    user_id = current_user["id"]
    await _expire_stale_hitlist_npcs(placer_id=user_id)
    active_user_entries = await db.hitlist.find(
        {"target_type": {"$in": ["user", "bodyguards"]}},
        {"_id": 0, "target_id": 1},
    ).to_list(500)
    target_ids = list({e.get("target_id") for e in active_user_entries if e.get("target_id")})
    if target_ids:
        dead_targets = await db.users.find(
            {"id": {"$in": target_ids}, "is_dead": True},
            {"_id": 0, "id": 1, "username": 1, "killed_by_user_id": 1, "killed_by_username": 1},
        ).to_list(500)
        for dead in dead_targets:
            dead_id = dead.get("id")
            killer_id = (dead.get("killed_by_user_id") or "").strip()
            if not dead_id:
                continue
            if killer_id:
                await resolve_user_hitlist_kill(
                    db,
                    killer_id=killer_id,
                    killer_username=(dead.get("killed_by_username") or "Unknown"),
                    victim_id=dead_id,
                    victim_username=(dead.get("username") or "Unknown"),
                )
            else:
                await db.hitlist.delete_many({"target_id": dead_id, "target_type": {"$in": ["user", "bodyguards"]}})
    query = {"$or": [
        {"target_type": {"$ne": "npc"}},
        {"target_type": "npc", "placer_id": user_id},
    ]}
    cursor = db.hitlist.find(query, {"_id": 0}).sort("reward_amount", -1).sort("created_at", -1).limit(200)
    items = []
    async for doc in cursor:
        # Build response from allowed fields only; never include placer_id or target_id
        item = {
            "id": doc.get("id") or str(uuid.uuid4()),
            "target_username": doc.get("target_username") or "",
            "target_type": doc.get("target_type") or "user",
            "reward_type": doc.get("reward_type") or "cash",
            "reward_amount": int(doc.get("reward_amount") or 0),
            "placer_username": None if doc.get("hidden") else (doc.get("placer_username") or "Unknown"),
            "created_at": doc.get("created_at"),
        }
        if doc.get("target_type") == "npc":
            item["npc_rank"] = doc.get("npc_rank", 1)
            raw_rewards = doc.get("npc_rewards") or {}
            # Bullets are no longer granted for practice NPCs — hide from UI even on older rows.
            item["npc_rewards"] = {k: v for k, v in raw_rewards.items() if k != "bullets"}
            created = _parse_iso_datetime(doc.get("created_at"))
            if created is not None:
                item["expires_at"] = (created + HITLIST_NPC_MAX_AGE).replace(microsecond=0).isoformat().replace("+00:00", "Z")
            item["npc_max_age_hours"] = int(HITLIST_NPC_MAX_AGE.total_seconds() // 3600)
        items.append(item)
    return {"items": items}


async def hitlist_me(current_user: dict = Depends(get_current_user)):
    """Whether current user is on the hitlist (count, total bounty); and if they paid to reveal, who placed them.
    'who' shows actual placer usernames once revealed (hidden contracts only hide on the public list)."""
    user_id = current_user["id"]
    entries = await db.hitlist.find({"target_id": user_id}, {"_id": 0}).to_list(100)
    count = len(entries)
    total_cash = sum(int(e.get("reward_amount") or 0) for e in entries if e.get("reward_type") == "cash")
    total_points = sum(int(e.get("reward_amount") or 0) for e in entries if e.get("reward_type") == "points")
    buy_off_cash = int(sum(int(e.get("reward_amount") or 0) * HITLIST_BUY_OFF_MULTIPLIER for e in entries if e.get("reward_type") == "cash"))
    buy_off_points = int(sum(int(e.get("reward_amount") or 0) * HITLIST_BUY_OFF_MULTIPLIER for e in entries if e.get("reward_type") == "points"))
    revealed = current_user.get("hitlist_revealed") is True
    who = []
    if revealed:
        # Once you paid to reveal, show actual placer names (hidden only hides on public list, not from the target who paid).
        who = [
            {"placer_username": e.get("placer_username") or "Unknown", "reward_type": e.get("reward_type"), "reward_amount": e.get("reward_amount", 0), "target_type": e.get("target_type"), "created_at": e.get("created_at")}
            for e in entries
        ]
    return {
        "on_hitlist": count > 0,
        "count": count,
        "total_cash": total_cash,
        "total_points": total_points,
        "buy_off_cash": buy_off_cash,
        "buy_off_points": buy_off_points,
        "revealed": revealed,
        "who": who,
    }


async def hitlist_buy_off(current_user: dict = Depends(get_current_user)):
    """Pay to remove all bounties on yourself. Cost = (each bounty amount + 50%) in the same currency (cash or points)."""
    user_id = current_user["id"]
    entries = await db.hitlist.find({"target_id": user_id}, {"_id": 0}).to_list(100)
    if not entries:
        raise HTTPException(status_code=400, detail="You are not on the hitlist")
    cost_cash = int(sum(int(e.get("reward_amount") or 0) * HITLIST_BUY_OFF_MULTIPLIER for e in entries if e.get("reward_type") == "cash"))
    cost_points = int(sum(int(e.get("reward_amount") or 0) * HITLIST_BUY_OFF_MULTIPLIER for e in entries if e.get("reward_type") == "points"))
    updates = {}
    gte_filter = {"id": user_id}
    if cost_cash > 0:
        updates["$inc"] = updates.get("$inc") or {}
        updates["$inc"]["money"] = -cost_cash
        gte_filter["money"] = {"$gte": cost_cash}
    if cost_points > 0:
        updates["$inc"] = updates.get("$inc") or {}
        updates["$inc"]["points"] = -cost_points
        gte_filter["points"] = {"$gte": cost_points}
    if updates:
        deduct_result = await db.users.update_one(gte_filter, updates)
        if deduct_result.modified_count == 0:
            if cost_cash > 0:
                raise HTTPException(status_code=400, detail=f"Insufficient cash (need ${cost_cash:,})")
            raise HTTPException(status_code=400, detail=f"Insufficient points (need {cost_points:,})")
        if cost_points > 0:
            await log_points_event(db, user_id=user_id, points=-cost_points, event_type="hitlist_buyoff", event_ref="self")
    res = await db.hitlist.delete_many({"target_id": user_id})
    cost_parts = []
    if cost_cash > 0:
        cost_parts.append(f"${cost_cash:,} cash")
    if cost_points > 0:
        cost_parts.append(f"{cost_points:,} pts")
    cost_str = ", ".join(cost_parts)
    try:
        await send_notification(
            user_id,
            "🛡️ Bought off hitlist",
            f"You bought yourself off the hitlist. {res.deleted_count} bounty(ies) removed. Cost paid: {cost_str}. You're no longer on the hitlist.",
            "hitlist_buyoff",
            buyoff_count=res.deleted_count,
            cost_cash=cost_cash,
            cost_points=cost_points,
            buyer_username=current_user.get("username") or "You",
        )
    except Exception as e:
        logger.exception("Hitlist buy-off notification: %s", e)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.hitlist_bodyguard_events.insert_one({
        "at": now_iso,
        "type": "hitlist_buy_off_self",
        "user_id": user_id,
        "username": current_user.get("username") or "",
        "deleted_count": res.deleted_count,
        "cost_cash": cost_cash,
        "cost_points": cost_points,
    })
    await log_activity(
        current_user["id"],
        current_user.get("username") or "?",
        "hitlist_buy_off",
        {"deleted_count": res.deleted_count, "cost_cash": cost_cash, "cost_points": cost_points},
    )
    return {"message": f"Removed {res.deleted_count} bounty(ies). Cost: {cost_str}.", "deleted": res.deleted_count}


async def hitlist_buy_off_user(request: HitlistBuyOffUserRequest, current_user: dict = Depends(get_current_user)):
    """Pay to remove all bounties on another user (or their bodyguards). Same cost rule: bounty + 50% per entry."""
    target_username = (request.target_username or "").strip()
    if not target_username:
        raise HTTPException(status_code=400, detail="Target username required")
    username_pattern = re.compile("^" + re.escape(target_username) + "$", re.IGNORECASE)
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "id": 1, "username": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Use the Buy Off button for yourself")
    entries = await db.hitlist.find(
        {"target_id": target["id"], "target_type": {"$in": ["user", "bodyguards"]}},
        {"_id": 0, "reward_type": 1, "reward_amount": 1}
    ).to_list(100)
    if not entries:
        raise HTTPException(status_code=400, detail="That user is not on the hitlist")
    cost_cash = int(sum(int(e.get("reward_amount") or 0) * HITLIST_BUY_OFF_MULTIPLIER for e in entries if e.get("reward_type") == "cash"))
    cost_points = int(sum(int(e.get("reward_amount") or 0) * HITLIST_BUY_OFF_MULTIPLIER for e in entries if e.get("reward_type") == "points"))
    updates = {}
    gte_filter = {"id": current_user["id"]}
    if cost_cash > 0:
        updates["$inc"] = updates.get("$inc") or {}
        updates["$inc"]["money"] = -cost_cash
        gte_filter["money"] = {"$gte": cost_cash}
    if cost_points > 0:
        updates["$inc"] = updates.get("$inc") or {}
        updates["$inc"]["points"] = -cost_points
        gte_filter["points"] = {"$gte": cost_points}
    if updates:
        deduct_result = await db.users.update_one(gte_filter, updates)
        if deduct_result.modified_count == 0:
            if cost_cash > 0:
                raise HTTPException(status_code=400, detail=f"Insufficient cash (need ${cost_cash:,})")
            raise HTTPException(status_code=400, detail=f"Insufficient points (need {cost_points:,})")
        if cost_points > 0:
            await log_points_event(db, user_id=current_user["id"], points=-cost_points, event_type="hitlist_buyoff",
                                   event_ref=f"target:{target['id']}", meta={"target_username": target.get("username")})
    res = await db.hitlist.delete_many({"target_id": target["id"], "target_type": {"$in": ["user", "bodyguards"]}})
    cost_parts = []
    if cost_cash > 0:
        cost_parts.append(f"${cost_cash:,} cash")
    if cost_points > 0:
        cost_parts.append(f"{cost_points:,} pts")
    cost_str = ", ".join(cost_parts)
    buyer_username = current_user.get("username") or "Someone"
    try:
        await send_notification(
            target["id"],
            "🛡️ Bought off hitlist",
            f"{buyer_username} bought you off the hitlist. {res.deleted_count} bounty(ies) removed. They paid: {cost_str}. You're no longer on the hitlist.",
            "hitlist_buyoff",
            buyoff_count=res.deleted_count,
            cost_cash=cost_cash,
            cost_points=cost_points,
            buyer_username=buyer_username,
        )
    except Exception as e:
        logger.exception("Hitlist buy-off-user notification: %s", e)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.hitlist_bodyguard_events.insert_one({
        "at": now_iso,
        "type": "hitlist_buy_off_user",
        "buyer_id": current_user["id"],
        "buyer_username": current_user.get("username") or "",
        "target_id": target["id"],
        "target_username": target["username"],
        "deleted_count": res.deleted_count,
        "cost_cash": cost_cash,
        "cost_points": cost_points,
    })
    await log_activity(
        current_user["id"],
        current_user.get("username") or "?",
        "hitlist_buy_off_user",
        {"target_username": target["username"], "deleted_count": res.deleted_count, "cost_cash": cost_cash, "cost_points": cost_points},
    )
    return {"message": f"Removed all bounties on {target['username']}. Cost: {cost_str}.", "deleted": res.deleted_count}


async def hitlist_reveal(current_user: dict = Depends(get_current_user)):
    """Pay 5000 points to see who placed bounties on you. One-time; stored on user.
    Once revealed, you see real placer usernames (hidden only hides on the public board)."""
    user_id = current_user["id"]
    if current_user.get("hitlist_revealed") is True:
        entries = await db.hitlist.find({"target_id": user_id}, {"_id": 0}).to_list(100)
        # Once revealed, show actual placer names (hidden only affects public list).
        who = [{"placer_username": e.get("placer_username") or "Unknown", "reward_type": e.get("reward_type"), "reward_amount": e.get("reward_amount", 0), "target_type": e.get("target_type"), "created_at": e.get("created_at")} for e in entries]
        return {"message": "Already revealed.", "who": who}
    cost = HITLIST_REVEAL_COST_POINTS
    reveal_result = await db.users.update_one(
        {"id": user_id, "points": {"$gte": cost}},
        {"$set": {"hitlist_revealed": True}, "$inc": {"points": -cost}},
    )
    if reveal_result.modified_count == 0:
        raise HTTPException(status_code=400, detail=f"Insufficient points (need {cost})")
    await log_points_event(db, user_id=user_id, points=-cost, event_type="hitlist_reveal")
    entries = await db.hitlist.find({"target_id": user_id}, {"_id": 0}).to_list(100)
    # Show actual placer names; hidden only affects public list, not the target who paid to reveal.
    who = [{"placer_username": e.get("placer_username") or "Unknown", "reward_type": e.get("reward_type"), "reward_amount": e.get("reward_amount", 0), "target_type": e.get("target_type"), "created_at": e.get("created_at")} for e in entries]
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.hitlist_bodyguard_events.insert_one({
        "at": now_iso,
        "type": "hitlist_reveal",
        "user_id": user_id,
        "username": current_user.get("username") or "",
        "cost_points": cost,
        "entries_count": len(entries),
    })
    await log_activity(
        current_user["id"],
        current_user.get("username") or "?",
        "hitlist_reveal",
        {"cost_points": cost, "entries_count": len(entries)},
    )
    return {"message": f"Paid {cost} points. Here is who hitlisted you.", "who": who}


def register(router):
    router.add_api_route("/hitlist/add", hitlist_add, methods=["POST"])
    router.add_api_route("/hitlist/npc-status", hitlist_npc_status, methods=["GET"], dependencies=_hitlist_rl_u)
    router.add_api_route("/hitlist/add-npc", hitlist_add_npc, methods=["POST"])
    router.add_api_route("/hitlist/list", hitlist_list, methods=["GET"], dependencies=_hitlist_rl_u)
    router.add_api_route("/hitlist/me", hitlist_me, methods=["GET"], dependencies=_hitlist_rl_u)
    router.add_api_route("/hitlist/buy-off", hitlist_buy_off, methods=["POST"])
    router.add_api_route("/hitlist/buy-off-user", hitlist_buy_off_user, methods=["POST"])
    router.add_api_route("/hitlist/reveal", hitlist_reveal, methods=["POST"])
