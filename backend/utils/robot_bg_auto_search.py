"""Monthly subscription: auto-maintain Attack searches for the buyer's own robot bodyguards."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

ROBOT_BG_AUTO_SEARCH_COST = 10_000
ROBOT_BG_AUTO_SEARCH_DAYS = 30
ROBOT_BG_AUTO_SEARCH_RENEW_THRESHOLD_HOURS = 3
ROBOT_BG_AUTO_SEARCH_NOTE = "Auto robot bodyguard search"
ROBOT_BG_AUTO_SEARCH_TICKER_INTERVAL_SEC = 15 * 60
ROBOT_BG_AUTO_SEARCH_PAGE_SYNC_THROTTLE_SEC = 90

_robot_bg_auto_search_page_sync_at: Dict[str, float] = {}


def _parse_iso_utc(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def robot_bg_auto_search_active(user: dict, now: Optional[datetime] = None) -> bool:
    until = _parse_iso_utc(user.get("robot_bg_auto_search_until"))
    if not until:
        return False
    ref = now or datetime.now(timezone.utc)
    return until > ref


def extend_robot_bg_auto_search_until(current_until: Optional[str], now: Optional[datetime] = None) -> str:
    ref = now or datetime.now(timezone.utc)
    parsed = _parse_iso_utc(current_until)
    base = parsed if parsed and parsed > ref else ref
    return (base + timedelta(days=ROBOT_BG_AUTO_SEARCH_DAYS)).isoformat()


async def list_owned_robot_targets(db, owner_id: str) -> List[dict]:
    rows = await db.bodyguards.find(
        {"user_id": owner_id, "is_robot": True, "bodyguard_user_id": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0, "bodyguard_user_id": 1, "slot_number": 1, "robot_name": 1},
    ).sort("slot_number", 1).to_list(10)
    if not rows:
        return []
    guard_ids = [r["bodyguard_user_id"] for r in rows if r.get("bodyguard_user_id")]
    users_map: Dict[str, dict] = {}
    async for u in db.users.find(
        {"id": {"$in": guard_ids}},
        {"_id": 0, "id": 1, "username": 1, "current_state": 1, "is_npc": 1, "is_bodyguard": 1, "is_dead": 1},
    ):
        users_map[u["id"]] = u
    targets: List[dict] = []
    for row in rows:
        gid = row.get("bodyguard_user_id")
        if not gid:
            continue
        target = users_map.get(gid)
        if not target or target.get("is_dead"):
            continue
        if not target.get("is_bodyguard"):
            continue
        targets.append(target)
    return targets


async def _should_renew_robot_search(
    db,
    *,
    owner_id: str,
    target_id: str,
    now: datetime,
    threshold: timedelta,
) -> tuple[bool, str]:
    attacks = await db.attacks.find(
        {
            "attacker_id": owner_id,
            "target_id": target_id,
            "status": {"$in": ["searching", "found"]},
        },
        {"_id": 0, "id": 1, "status": 1, "expires_at": 1, "search_started": 1},
    ).to_list(50)
    live: List[dict] = []
    stale_ids: List[str] = []
    for a in attacks:
        exp = _parse_iso_utc(a.get("expires_at"))
        if exp is None:
            started = _parse_iso_utc(a.get("search_started"))
            if started:
                exp = started + timedelta(hours=24)
        if exp and exp <= now:
            stale_ids.append(a["id"])
            continue
        live.append(a)
    if stale_ids:
        await db.attacks.delete_many({"attacker_id": owner_id, "id": {"$in": stale_ids}})
    if not live:
        return True, "no_active_row"
    if any(a.get("status") == "searching" for a in live):
        return False, "already_searching"
    latest_expiry: Optional[datetime] = None
    for a in live:
        exp = _parse_iso_utc(a.get("expires_at"))
        if exp is None:
            started = _parse_iso_utc(a.get("search_started"))
            if started:
                exp = started + timedelta(hours=24)
        if exp and (latest_expiry is None or exp > latest_expiry):
            latest_expiry = exp
    if latest_expiry is None:
        return True, "missing_expiry"
    if latest_expiry > now + threshold:
        return False, "not_within_threshold"
    return True, "renew"


async def maybe_auto_search_robots_for_user(db, owner: dict) -> dict:
    """Start or renew searches for owned robots when subscription is active."""
    from routers.kill.attack import insert_attack_search_row

    owner_id = owner.get("id") or ""
    summary: Dict[str, Any] = {
        "owner_id": owner_id,
        "searched": 0,
        "skipped": 0,
        "details": [],
    }
    if not owner_id or owner.get("is_dead"):
        summary["skipped_reason"] = "dead_or_missing"
        return summary
    if not robot_bg_auto_search_active(owner):
        summary["skipped_reason"] = "subscription_inactive"
        return summary

    now = datetime.now(timezone.utc)
    threshold = timedelta(hours=ROBOT_BG_AUTO_SEARCH_RENEW_THRESHOLD_HOURS)
    targets = await list_owned_robot_targets(db, owner_id)
    if not targets:
        summary["skipped_reason"] = "no_robots"
        return summary

    for target in targets:
        tid = target["id"]
        uname = target.get("username") or "?"
        should, reason = await _should_renew_robot_search(
            db, owner_id=owner_id, target_id=tid, now=now, threshold=threshold
        )
        if not should:
            summary["skipped"] += 1
            summary["details"].append({"target_username": uname, "action": "skip", "reason": reason})
            continue
        row = await insert_attack_search_row(
            db,
            attacker=owner,
            target=target,
            note=ROBOT_BG_AUTO_SEARCH_NOTE,
            source="robot_bg_auto",
        )
        if row:
            summary["searched"] += 1
            summary["details"].append({"target_username": uname, "action": "search", "attack_id": row.get("attack_id")})
        else:
            summary["skipped"] += 1
            summary["details"].append({"target_username": uname, "action": "skip", "reason": "search_cap"})
    return summary


async def maybe_sync_robot_bg_searches_for_owner(db, owner: dict) -> Optional[dict]:
    """Throttled sync on page load — renews missing robot searches if ticker/cron is down."""
    if not robot_bg_auto_search_active(owner):
        return None
    owner_id = owner.get("id") or ""
    if not owner_id:
        return None
    import time

    now = time.monotonic()
    last = _robot_bg_auto_search_page_sync_at.get(owner_id, 0.0)
    if now - last < ROBOT_BG_AUTO_SEARCH_PAGE_SYNC_THROTTLE_SEC:
        return None
    _robot_bg_auto_search_page_sync_at[owner_id] = now
    summary = await maybe_auto_search_robots_for_user(db, owner)
    if summary.get("searched"):
        try:
            from routers.kill.attack import _attack_list_cache_invalidate

            _attack_list_cache_invalidate(owner_id)
        except Exception:
            logger.exception("robot_bg_auto_search cache invalidate failed owner=%s", owner_id)
        logger.info(
            "robot_bg_auto_search page sync owner=%s searched=%s skipped=%s",
            owner_id,
            summary.get("searched"),
            summary.get("skipped"),
        )
    return summary


async def run_robot_bg_auto_search_cron(db) -> dict:
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    subscribers = await db.users.find(
        {
            "robot_bg_auto_search_until": {"$gt": now_iso},
            "is_dead": {"$ne": True},
        },
        {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "robot_bg_auto_search_until": 1, "search_minutes_override": 1},
    ).to_list(5000)
    totals = {"users": len(subscribers), "searched": 0, "skipped": 0, "user_summaries": []}
    for user in subscribers:
        try:
            s = await maybe_auto_search_robots_for_user(db, user)
            totals["searched"] += int(s.get("searched") or 0)
            totals["skipped"] += int(s.get("skipped") or 0)
            if s.get("searched") or s.get("skipped"):
                totals["user_summaries"].append(s)
        except Exception:
            logger.exception("robot_bg_auto_search user=%s", user.get("id"))
    return totals


async def run_robot_bg_auto_search_ticker(db) -> None:
    while True:
        try:
            await run_robot_bg_auto_search_cron(db)
        except Exception:
            logger.exception("robot_bg_auto_search ticker")
        await asyncio.sleep(ROBOT_BG_AUTO_SEARCH_TICKER_INTERVAL_SEC)
