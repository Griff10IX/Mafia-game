"""Loot-exclusive Safehouse property — ownership, hide window, reward collects."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple
import uuid

SAFEHOUSE_TYPE = "safehouse"
SAFEHOUSE_NAME = "Safehouse"
SAFEHOUSE_IMAGE = "/images/properties/safehouse/hero.png"

# Secret loot gate (never expose in public UI / update log).
SAFEHOUSE_MIN_OPENS = 10
SAFEHOUSE_CHANCE = 0.025
SAFEHOUSE_CAP = 1

SAFEHOUSE_HIDE_HOURS = 3
SAFEHOUSE_WEEKLY_CASH = 150_000_000
SAFEHOUSE_WEEKLY_RESPECT = 5_000
SAFEHOUSE_INTERVAL_DAYS = 3
SAFEHOUSE_INTERVAL_ROBOT_BG_TOKENS = 1
SAFEHOUSE_INTERVAL_MISSION_TOKENS = 1
SAFEHOUSE_INTERVAL_LOOT_PIECES = 100
# While hide is active: max robot bodyguard hires allowed (attacks blocked entirely).
SAFEHOUSE_HIDE_ROBOT_HIRE_MAX = 1


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(raw: Any) -> Optional[datetime]:
    if not raw:
        return None
    try:
        if isinstance(raw, datetime):
            dt = raw
        else:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def utc_day_key(now: Optional[datetime] = None) -> str:
    return (now or _utcnow()).astimezone(timezone.utc).strftime("%Y-%m-%d")


def utc_week_key(now: Optional[datetime] = None) -> str:
    dt = (now or _utcnow()).astimezone(timezone.utc)
    iso = dt.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


async def count_live_safehouse(db) -> int:
    n = int(
        await db.exclusive_properties.count_documents(
            {"type": SAFEHOUSE_TYPE, "owner_id": {"$nin": [None, ""]}}
        )
    )
    return min(SAFEHOUSE_CAP, max(0, n))


async def get_safehouse_doc(db, *, owner_id: Optional[str] = None, require_owner: bool = False):
    q: Dict[str, Any] = {"type": SAFEHOUSE_TYPE}
    if owner_id:
        q["owner_id"] = owner_id
    elif require_owner:
        q["owner_id"] = {"$nin": [None, ""]}
    return await db.exclusive_properties.find_one(q)


async def user_has_safehouse(db, user_id: str) -> bool:
    if not user_id:
        return False
    doc = await db.exclusive_properties.find_one(
        {"type": SAFEHOUSE_TYPE, "owner_id": user_id},
        {"_id": 1},
    )
    return doc is not None


async def is_safehouse_hidden(db, user_id: str, *, now: Optional[datetime] = None) -> bool:
    if not user_id:
        return False
    doc = await get_safehouse_doc(db, owner_id=user_id)
    if not doc:
        return False
    until = _parse_iso(doc.get("safehouse_hide_until"))
    if not until:
        return False
    return (now or _utcnow()) < until


async def raise_if_safehouse_blocks_combat(db, user_id: str) -> None:
    """Block searching / shooting while the player is inside their Safehouse."""
    from fastapi import HTTPException

    if await is_safehouse_hidden(db, user_id):
        raise HTTPException(
            status_code=400,
            detail="You are in your Safehouse — you cannot search or attack anyone until you leave (hide ends).",
        )


async def safehouse_robot_hire_allowed(db, user_id: str) -> Tuple[bool, str]:
    """While hide is active, only SAFEHOUSE_HIDE_ROBOT_HIRE_MAX robot hires are allowed."""
    if not await is_safehouse_hidden(db, user_id):
        return True, ""
    doc = await get_safehouse_doc(db, owner_id=user_id)
    used = int((doc or {}).get("safehouse_hide_robot_hires") or 0)
    if used >= SAFEHOUSE_HIDE_ROBOT_HIRE_MAX:
        return False, (
            f"While in your Safehouse you can only hire {SAFEHOUSE_HIDE_ROBOT_HIRE_MAX} robot bodyguard. "
            "Wait until hide ends to hire more."
        )
    return True, ""


async def record_safehouse_robot_hire(db, user_id: str) -> None:
    """Increment robot-hire counter for the active hide window (no-op if not hidden)."""
    if not await is_safehouse_hidden(db, user_id):
        return
    await db.exclusive_properties.update_one(
        {"type": SAFEHOUSE_TYPE, "owner_id": user_id},
        {"$inc": {"safehouse_hide_robot_hires": 1}},
    )


async def grant_safehouse(
    db,
    user_id: str,
    *,
    now: Optional[datetime] = None,
    source: str = "loot_box",
) -> Dict[str, Any]:
    """Grant unique Safehouse to user. Returns {ok, reason?, id?}."""
    now = now or _utcnow()
    if await user_has_safehouse(db, user_id):
        return {"ok": False, "reason": "already_owns"}
    if await count_live_safehouse(db) >= SAFEHOUSE_CAP:
        return {"ok": False, "reason": "cap"}

    # Reclaim orphaned doc if present, else insert.
    orphan = await db.exclusive_properties.find_one(
        {"type": SAFEHOUSE_TYPE, "$or": [{"owner_id": None}, {"owner_id": ""}]}
    )
    doc_id = str(uuid.uuid4())
    base = {
        "id": doc_id,
        "type": SAFEHOUSE_TYPE,
        "owner_id": user_id,
        "claimed_at": now.isoformat(),
        "source": source,
        "safehouse_hide_until": None,
        "safehouse_hide_day": None,
        "last_weekly_week": None,
        "last_interval_at": None,
    }
    if orphan:
        doc_id = orphan.get("id") or doc_id
        base["id"] = doc_id
        await db.exclusive_properties.update_one(
            {"_id": orphan["_id"]},
            {"$set": base},
        )
    else:
        await db.exclusive_properties.insert_one(base)

    await db.users.update_one(
        {"id": user_id},
        {"$set": {"profile_show_safehouse": True}},
    )
    return {"ok": True, "id": doc_id}


async def return_safehouse_to_pool(db, *, owner_id: str) -> bool:
    """On death: clear owner so it can drop from loot again."""
    res = await db.exclusive_properties.update_one(
        {"type": SAFEHOUSE_TYPE, "owner_id": owner_id},
        {
            "$set": {"owner_id": None},
            "$unset": {
                "safehouse_hide_until": "",
                "safehouse_hide_day": "",
                "last_weekly_week": "",
                "last_interval_at": "",
            },
        },
    )
    if res.modified_count:
        await db.users.update_one(
            {"id": owner_id},
            {"$set": {"profile_show_safehouse": False}},
        )
        return True
    return False


async def activate_hide(db, user_id: str, *, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or _utcnow()
    day = utc_day_key(now)
    doc = await get_safehouse_doc(db, owner_id=user_id)
    if not doc:
        return {"ok": False, "reason": "not_owned"}
    if (doc.get("safehouse_hide_day") or "") == day:
        until = _parse_iso(doc.get("safehouse_hide_until"))
        if until and now < until:
            return {"ok": False, "reason": "already_active", "hide_until": until.isoformat()}
        return {"ok": False, "reason": "already_used_today"}
    until = now + timedelta(hours=SAFEHOUSE_HIDE_HOURS)
    await db.exclusive_properties.update_one(
        {"type": SAFEHOUSE_TYPE, "owner_id": user_id},
        {
            "$set": {
                "safehouse_hide_until": until.isoformat(),
                "safehouse_hide_day": day,
                "safehouse_hide_robot_hires": 0,
            }
        },
    )
    return {"ok": True, "hide_until": until.isoformat(), "hide_hours": SAFEHOUSE_HIDE_HOURS}


def _inventory_payload(doc: dict, *, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or _utcnow()
    hide_until = _parse_iso(doc.get("safehouse_hide_until"))
    hide_active = bool(hide_until and now < hide_until)
    day = utc_day_key(now)
    hide_used_today = (doc.get("safehouse_hide_day") or "") == day
    week = utc_week_key(now)
    can_weekly = (doc.get("last_weekly_week") or "") != week
    last_interval = _parse_iso(doc.get("last_interval_at"))
    can_interval = True
    next_interval_at = None
    if last_interval:
        next_dt = last_interval + timedelta(days=SAFEHOUSE_INTERVAL_DAYS)
        if now < next_dt:
            can_interval = False
            next_interval_at = next_dt.isoformat()
    return {
        "name": SAFEHOUSE_NAME,
        "image": SAFEHOUSE_IMAGE,
        "hide_hours": SAFEHOUSE_HIDE_HOURS,
        "hide_active": hide_active,
        "hide_until": hide_until.isoformat() if hide_until and hide_active else None,
        "can_activate_hide": (not hide_active) and (not hide_used_today),
        "hide_used_today": hide_used_today and not hide_active,
        "robot_hires_while_hidden": int(doc.get("safehouse_hide_robot_hires") or 0) if hide_active else 0,
        "robot_hires_max_while_hidden": SAFEHOUSE_HIDE_ROBOT_HIRE_MAX,
        "weekly_cash": SAFEHOUSE_WEEKLY_CASH,
        "weekly_respect": SAFEHOUSE_WEEKLY_RESPECT,
        "can_collect_weekly": can_weekly,
        "interval_days": SAFEHOUSE_INTERVAL_DAYS,
        "interval_robot_bg_tokens": SAFEHOUSE_INTERVAL_ROBOT_BG_TOKENS,
        "interval_mission_tokens": SAFEHOUSE_INTERVAL_MISSION_TOKENS,
        "interval_loot_pieces": SAFEHOUSE_INTERVAL_LOOT_PIECES,
        "can_collect_interval": can_interval,
        "next_interval_at": next_interval_at,
        "can_collect": can_weekly or can_interval,
    }


async def inventory_info(db, user_id: str) -> Optional[Dict[str, Any]]:
    doc = await get_safehouse_doc(db, owner_id=user_id)
    if not doc:
        return None
    return _inventory_payload(doc)


async def collect_rewards(db, user_id: str, *, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Collect due weekly and/or 3-day rewards. Idempotent per windows."""
    from server import log_respect_earned

    now = now or _utcnow()
    doc = await get_safehouse_doc(db, owner_id=user_id)
    if not doc:
        return {"ok": False, "reason": "not_owned"}

    info = _inventory_payload(doc, now=now)
    if not info["can_collect"]:
        return {"ok": False, "reason": "cooldown", "info": info}

    money = 0
    respect = 0
    robot_tokens = 0
    mission_tokens = 0
    loot_pieces = 0
    sets: Dict[str, Any] = {}
    incs: Dict[str, int] = {}

    if info["can_collect_weekly"]:
        money = SAFEHOUSE_WEEKLY_CASH
        respect = SAFEHOUSE_WEEKLY_RESPECT
        incs["money"] = money
        incs["respect_points"] = respect
        sets["last_weekly_week"] = utc_week_key(now)

    if info["can_collect_interval"]:
        robot_tokens = SAFEHOUSE_INTERVAL_ROBOT_BG_TOKENS
        mission_tokens = SAFEHOUSE_INTERVAL_MISSION_TOKENS
        loot_pieces = SAFEHOUSE_INTERVAL_LOOT_PIECES
        incs["robot_bodyguard_hire_tokens"] = robot_tokens
        incs["mission_skip_tokens"] = mission_tokens
        incs["loot_box_pieces"] = loot_pieces
        sets["last_interval_at"] = now.isoformat()

    if sets:
        await db.exclusive_properties.update_one(
            {"type": SAFEHOUSE_TYPE, "owner_id": user_id},
            {"$set": sets},
        )
    if incs:
        await db.users.update_one({"id": user_id}, {"$inc": incs})
    if respect > 0:
        try:
            await log_respect_earned(user_id, respect, "safehouse_weekly")
        except Exception:
            pass

    return {
        "ok": True,
        "money": money,
        "respect_points": respect,
        "robot_bodyguard_hire_tokens": robot_tokens,
        "mission_skip_tokens": mission_tokens,
        "loot_box_pieces": loot_pieces,
        "info": await inventory_info(db, user_id),
    }


async def try_roll_safehouse(
    db,
    *,
    user_id: str,
    open_total_after: int,
    paid_tier: Optional[str] = None,
    now: Optional[datetime] = None,
    rng,
) -> Optional[Dict[str, Any]]:
    """Secret Ultra Rare roll after min opens. Odds/min-opens are server-only."""
    now = now or _utcnow()
    if (paid_tier or "").strip().lower() != "ultra_rare":
        return None
    # Per-user: first SAFEHOUSE_MIN_OPENS opens (any tier) never grant Safehouse.
    if int(open_total_after) <= int(SAFEHOUSE_MIN_OPENS):
        return None
    if rng.random() >= float(SAFEHOUSE_CHANCE):
        return None
    if await user_has_safehouse(db, user_id):
        return None
    if await count_live_safehouse(db) >= SAFEHOUSE_CAP:
        return None
    res = await grant_safehouse(db, user_id, now=now, source="loot_box")
    if not res.get("ok"):
        return None
    return {
        "type": "property",
        "name": SAFEHOUSE_NAME,
        "id": SAFEHOUSE_TYPE,
        "image": SAFEHOUSE_IMAGE,
        "rarity": "loot_exclusive",
        "reward_tier": "loot_exclusive",
    }
