"""Public hitlist bounty: at most three NPCs a UTC day, one at a time.

A tick every two minutes reads one state row. The spawn itself is one atomic
claim so two API workers cannot add two bounties. No search is written for
every player. The killer of one bounty is blocked from the next only.
"""
from __future__ import annotations

import asyncio
import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from pymongo import ReturnDocument

logger = logging.getLogger(__name__)

STATE_ID = "hitlist_bounty"
MAX_PER_DAY = 3
MAX_AGE = timedelta(hours=4)
TICK_SECONDS = 120
# First bounty of a day, and the gap after each one.
_FIRST_DELAY = (20 * 60, 3 * 3600)
_NEXT_DELAY = (20 * 60, 4 * 3600)

# Weights sum to 10_000. Ultra rare open is 2.5%, mission skips are 5%.
# The other eight split the rest.
_POOL = (
    ("points", 1156, 500, 1500),
    ("cash", 1156, 1_000_000_000, 3_000_000_000),
    ("wof_spins", 1156, 1, 3),
    ("respect", 1157, 2000, 3000),
    ("robot_bg", 1156, 1, 2),
    ("bullets", 1156, 5000, 15_000),
    ("crack_safe", 1156, 10, 20),
    ("lottery", 1157, 50, 200),
    ("ultra_loot", 250, 1, 1),
    ("mission_skip", 500, 1, 3),
)

_INC_FIELD = {
    "points": "points",
    "cash": "money",
    "wof_spins": "wheel_bonus_free_spins",
    "respect": "respect_points",
    "robot_bg": "robot_bodyguard_hire_tokens",
    "bullets": "bullets",
    "crack_safe": "crack_safe_free_attempts",
    "ultra_loot": "loot_box_free_ultra_opens",
    "mission_skip": "mission_skip_tokens",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse(val) -> Optional[datetime]:
    if val is None:
        return None
    if hasattr(val, "year"):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _reward_text(kind: str, amount: int) -> str:
    n = int(amount)
    if kind == "points":
        return f"{n:,} points"
    if kind == "cash":
        return f"${n:,}"
    if kind == "wof_spins":
        return f"{n} Wheel of Fortune free spin" + ("s" if n != 1 else "")
    if kind == "respect":
        return f"{n:,} respect"
    if kind == "robot_bg":
        return f"{n} robot bodyguard token" + ("s" if n != 1 else "")
    if kind == "bullets":
        return f"{n:,} bullets"
    if kind == "crack_safe":
        return f"{n} free Crack the Safe attempts"
    if kind == "lottery":
        return f"{n} lottery tickets"
    if kind == "ultra_loot":
        return "1 ultra rare loot box open"
    if kind == "mission_skip":
        return f"{n} mission skip token" + ("s" if n != 1 else "")
    return f"{n} {kind}"


def roll_bounty_rewards() -> list:
    """One, two, or three different rewards. Rare rows keep their stated odds."""
    pool = list(_POOL)
    count = random.randint(1, 3)
    picked = []
    for _ in range(count):
        if not pool:
            break
        total = sum(row[1] for row in pool)
        roll = random.randint(1, total)
        upto = 0
        chosen = pool[-1]
        for row in pool:
            upto += row[1]
            if roll <= upto:
                chosen = row
                break
        pool = [row for row in pool if row[0] != chosen[0]]
        lo, hi = chosen[2], chosen[3]
        picked.append({"kind": chosen[0], "amount": random.randint(lo, hi)})
    return picked


async def is_open_bounty_for(db, target_id: str, user_id: str) -> bool:
    """True when this user may hunt the live bounty. Raises if they must sit it out."""
    row = await db.hitlist.find_one(
        {"target_id": target_id, "target_type": "bounty"},
        {"_id": 0, "blocked_user_id": 1},
    )
    if not row:
        return False
    if str(row.get("blocked_user_id") or "") == str(user_id or ""):
        raise HTTPException(
            status_code=400,
            detail="You have to sit this bounty out. You can take the one after it.",
        )
    return True


async def _expire_bounty(db, row: dict) -> None:
    hitlist_id = (row.get("id") or "").strip()
    target_id = (row.get("target_id") or "").strip()
    now_iso = _iso(_now())
    if hitlist_id:
        await db.hitlist.delete_one({"id": hitlist_id, "target_type": "bounty"})
    if target_id:
        await db.users.update_one(
            {"id": target_id, "is_npc": True},
            {"$set": {"is_dead": True, "dead_at": now_iso, "health": 0}},
        )
        try:
            await db.attacks.delete_many({"target_id": target_id})
        except Exception:
            logger.exception("bounty expire: attacks delete failed")
    username = (row.get("target_username") or "").strip()
    if username:
        try:
            from routers.kill.attack import clear_kill_favorites_for_usernames

            await clear_kill_favorites_for_usernames([username])
        except Exception:
            logger.exception("bounty expire: clear favorites failed")


async def _create_bounty(db, blocked_user_id: Optional[str]) -> str:
    from server import DEFAULT_HEALTH, RANKS, STATES
    from routers.kill.hitlist import HITLIST_NPC_NAMES, HITLIST_NPC_TEMPLATES

    now_iso = _iso(_now())
    hitlist_id = str(uuid.uuid4())
    npc_user_id = str(uuid.uuid4())
    template = random.choice(HITLIST_NPC_TEMPLATES)
    rank_id = max(1, min(int(template.get("rank") or 1), len(RANKS)))
    rank_points = RANKS[rank_id - 1]["required_points"]
    base_name = random.choice(HITLIST_NPC_NAMES)
    username = f"{base_name} (Bounty) #{hitlist_id[:6]}"
    state = random.choice(STATES)
    rewards = roll_bounty_rewards()
    await db.users.insert_one(
        {
            "id": npc_user_id,
            "username": username,
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
            "current_state": state,
            "total_kills": 0,
            "total_deaths": 0,
            "created_at": now_iso,
        }
    )
    await db.hitlist.insert_one(
        {
            "id": hitlist_id,
            "target_id": npc_user_id,
            "target_username": username,
            "target_type": "bounty",
            "placer_username": "Bounty",
            "reward_type": "bounty",
            "reward_amount": 0,
            "hidden": False,
            "location": state,
            "blocked_user_id": (blocked_user_id or "") or None,
            "rewards": rewards,
            "created_at": now_iso,
        }
    )
    logger.info("hitlist bounty spawned id=%s location=%s", hitlist_id[:8], state)
    return hitlist_id


async def hitlist_bounty_tick(db) -> None:
    now = _now()
    today = now.date().isoformat()
    state = await db.hitlist_bounty_state.find_one({"_id": STATE_ID})
    if not state:
        delay = random.randint(*_FIRST_DELAY)
        await db.hitlist_bounty_state.update_one(
            {"_id": STATE_ID},
            {
                "$setOnInsert": {
                    "day": today,
                    "spawned_count": 0,
                    "next_spawn_at": _iso(now + timedelta(seconds=delay)),
                    "active_hitlist_id": None,
                    "sit_out_user_id": None,
                }
            },
            upsert=True,
        )
        return

    if str(state.get("day") or "") != today:
        delay = random.randint(*_FIRST_DELAY)
        await db.hitlist_bounty_state.update_one(
            {"_id": STATE_ID, "day": state.get("day")},
            {
                "$set": {
                    "day": today,
                    "spawned_count": 0,
                    "next_spawn_at": _iso(now + timedelta(seconds=delay)),
                }
            },
        )
        return

    active_id = state.get("active_hitlist_id")
    if active_id == "pending":
        pending_at = _parse(state.get("pending_at"))
        if pending_at and now - pending_at < timedelta(minutes=5):
            return
        await db.hitlist_bounty_state.update_one(
            {"_id": STATE_ID, "active_hitlist_id": "pending", "spawned_count": {"$gt": 0}},
            {"$inc": {"spawned_count": -1}, "$set": {"active_hitlist_id": None}},
        )
        return
    if active_id:
        row = await db.hitlist.find_one(
            {"id": active_id, "target_type": "bounty"},
            {"_id": 0, "id": 1, "target_id": 1, "target_username": 1, "created_at": 1},
        )
        if not row:
            await db.hitlist_bounty_state.update_one(
                {"_id": STATE_ID, "active_hitlist_id": active_id},
                {"$set": {"active_hitlist_id": None}},
            )
            return
        created = _parse(row.get("created_at"))
        if created is None or now - created >= MAX_AGE:
            await _expire_bounty(db, row)
            await db.hitlist_bounty_state.update_one(
                {"_id": STATE_ID, "active_hitlist_id": active_id},
                {"$set": {"active_hitlist_id": None}},
            )
        return

    if int(state.get("spawned_count") or 0) >= MAX_PER_DAY:
        return
    nxt = _parse(state.get("next_spawn_at"))
    if nxt and now < nxt:
        return

    claimed = await db.hitlist_bounty_state.find_one_and_update(
        {
            "_id": STATE_ID,
            "day": today,
            "spawned_count": {"$lt": MAX_PER_DAY},
            "active_hitlist_id": None,
            "next_spawn_at": {"$lte": _iso(now)},
        },
        {"$inc": {"spawned_count": 1}, "$set": {"active_hitlist_id": "pending", "pending_at": _iso(now)}},
        return_document=ReturnDocument.AFTER,
    )
    if not claimed:
        return
    try:
        hitlist_id = await _create_bounty(db, claimed.get("sit_out_user_id"))
    except Exception:
        await db.hitlist_bounty_state.update_one(
            {"_id": STATE_ID, "active_hitlist_id": "pending"},
            {"$inc": {"spawned_count": -1}, "$set": {"active_hitlist_id": None}},
        )
        raise
    gap = random.randint(*_NEXT_DELAY)
    await db.hitlist_bounty_state.update_one(
        {"_id": STATE_ID, "active_hitlist_id": "pending"},
        {
            "$set": {
                "active_hitlist_id": hitlist_id,
                "sit_out_user_id": None,
                "next_spawn_at": _iso(now + timedelta(seconds=gap)),
            }
        },
    )


async def settle_bounty_kill(db, *, killer_id: str, killer_username: str, victim_id: str):
    """Grant a bounty once. Returns (message, rewards dict) or None if this was not a bounty."""
    entry = await db.hitlist.find_one_and_delete(
        {"target_id": victim_id, "target_type": "bounty"},
        projection={"_id": 0, "id": 1, "rewards": 1, "target_username": 1},
    )
    if not entry:
        return None

    rewards = [r for r in (entry.get("rewards") or []) if isinstance(r, dict)]
    inc: dict[str, int] = {}
    lottery_n = 0
    for row in rewards:
        kind = str(row.get("kind") or "")
        amount = int(row.get("amount") or 0)
        if amount <= 0:
            continue
        if kind == "lottery":
            lottery_n += amount
            continue
        field = _INC_FIELD.get(kind)
        if field:
            inc[field] = int(inc.get(field) or 0) + amount
    if inc:
        await db.users.update_one({"id": killer_id}, {"$inc": inc})
    if inc.get("points"):
        try:
            from utils.point_provenance import log_points_event

            await log_points_event(
                db,
                user_id=killer_id,
                points=int(inc["points"]),
                event_type="hitlist_bounty",
            )
        except Exception:
            logger.exception("bounty points log failed")
    if inc.get("respect_points"):
        try:
            from server import log_respect_earned

            await log_respect_earned(killer_id, int(inc["respect_points"]), "hitlist_bounty")
        except Exception:
            logger.exception("bounty respect log failed")
    if lottery_n:
        try:
            from routers.money.lottery import grant_complimentary_lottery_tickets

            await grant_complimentary_lottery_tickets(killer_id, killer_username, lottery_n)
        except Exception:
            logger.exception("bounty lottery tickets failed")
            rewards = [r for r in rewards if r.get("kind") != "lottery"]

    now_iso = _iso(_now())
    await db.users.update_one(
        {"id": victim_id, "is_npc": True},
        {"$set": {"is_dead": True, "dead_at": now_iso, "health": 0, "money": 0}, "$inc": {"total_deaths": 1}},
    )
    try:
        await db.attacks.delete_many({"target_id": victim_id})
    except Exception:
        logger.exception("bounty kill: attacks delete failed")

    await db.hitlist_bounty_state.update_one(
        {"_id": STATE_ID},
        {
            "$set": {"sit_out_user_id": killer_id, "active_hitlist_id": None},
            "$setOnInsert": {
                "day": _now().date().isoformat(),
                "spawned_count": 0,
                "next_spawn_at": _iso(_now()),
            },
        },
        upsert=True,
    )

    parts = [_reward_text(str(r.get("kind") or ""), int(r.get("amount") or 0)) for r in rewards if int(r.get("amount") or 0) > 0]
    name = entry.get("target_username") or "the bounty"
    message = f"You killed {name}! You got: " + (", ".join(parts) if parts else "nothing") + ". You sit the next bounty out."
    try:
        from server import send_notification

        await send_notification(
            killer_id,
            "Hitlist bounty",
            message,
            "system",
            always_deliver=True,
        )
    except Exception:
        logger.exception("bounty inbox failed")
    try:
        from utils.daily_contests import record_contest_progress

        await record_contest_progress(db, killer_id, "hitlist", 1)
    except Exception:
        logger.exception("bounty contest progress failed")
    try:
        from server import log_activity

        await log_activity(
            killer_id,
            killer_username or "?",
            "hitlist_bounty_kill",
            {"victim_id": victim_id, "rewards": rewards},
        )
    except Exception:
        logger.exception("bounty activity log failed")

    payload = {str(r.get("kind") or ""): int(r.get("amount") or 0) for r in rewards}
    return message, payload


async def run_hitlist_bounty_loop() -> None:
    import server as srv

    db = srv.db
    await asyncio.sleep(45)
    while True:
        try:
            await hitlist_bounty_tick(db)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("hitlist bounty loop")
        await asyncio.sleep(TICK_SECONDS)
