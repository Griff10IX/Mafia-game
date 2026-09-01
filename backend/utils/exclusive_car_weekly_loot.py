"""Weekly loot-box pieces from exclusive / loot-exclusive cars.

Unique catalog models stack (copies of the same car do not). Cap 128/week
(Cadillac exclusive 10, loot exclusive Cadillac 18, Model SJ 25, 540K 75).
VIP Pass cars are not included.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set

from pymongo import ReturnDocument

from utils.exclusive_car_id_rotate import (
    ROTATE_RARITIES,
    exclusive_car_id_rotate_week,
    rotate_catalog_car_ids,
)

logger = logging.getLogger(__name__)

# Per unique catalog car_id. Faster / rarer cars pay more.
WEEKLY_LOOT_PIECES_BY_CAR_ID = {
    "car20": 10,  # exclusive Cadillac (7s)
    "car21": 18,  # loot exclusive Cadillac (5s)
    "car23": 25,  # Model SJ (2s)
    "car24": 75,  # 540K Special Roadster (2s + 25× 1s/day)
}
# Future exclusive / loot exclusive models: by catalog travel seconds.
WEEKLY_LOOT_FALLBACK_BY_MAX_SECONDS = (
    (2, 25),
    (5, 18),
    (7, 10),
)
WEEKLY_LOOT_FALLBACK_DEFAULT = 10
WEEKLY_LOOT_PIECES_MAX = 128
USER_WEEK_FIELD = "exclusive_car_loot_week"


def weekly_loot_pieces_for_car(car_id: Optional[str], rarity: Optional[str] = None) -> int:
    """Pieces this catalog model generates each week (0 if not exclusive / loot exclusive)."""
    cid = (car_id or "").strip()
    if not cid:
        return 0
    from server import CARS, travel_seconds_for_car

    info = next((c for c in CARS if c.get("id") == cid), None)
    r = (rarity or (info or {}).get("rarity") or "").strip().lower()
    if not info or r not in ROTATE_RARITIES:
        return 0
    if cid in WEEKLY_LOOT_PIECES_BY_CAR_ID:
        return int(WEEKLY_LOOT_PIECES_BY_CAR_ID[cid])
    secs = int(travel_seconds_for_car(info.get("id"), info.get("rarity"), 45))
    for max_secs, pieces in WEEKLY_LOOT_FALLBACK_BY_MAX_SECONDS:
        if secs <= max_secs:
            return int(pieces)
    return int(WEEKLY_LOOT_FALLBACK_DEFAULT)


def weekly_loot_pieces_for_car_ids(car_ids: Iterable[str]) -> int:
    seen: Set[str] = set()
    total = 0
    for raw in car_ids or []:
        cid = str(raw or "").strip()
        if not cid or cid in seen:
            continue
        seen.add(cid)
        n = weekly_loot_pieces_for_car(cid)
        if n > 0:
            total += n
    return min(int(WEEKLY_LOOT_PIECES_MAX), int(total))


def weekly_loot_breakdown(car_ids: Iterable[str]) -> Dict[str, Any]:
    from server import CARS

    names = {c["id"]: c.get("name") or c["id"] for c in CARS if c.get("id")}
    seen: Set[str] = set()
    cars: List[dict] = []
    raw_total = 0
    for raw in car_ids or []:
        cid = str(raw or "").strip()
        if not cid or cid in seen:
            continue
        n = weekly_loot_pieces_for_car(cid)
        if n <= 0:
            continue
        seen.add(cid)
        raw_total += n
        cars.append({"car_id": cid, "name": names.get(cid, cid), "pieces": n})
    capped = min(int(WEEKLY_LOOT_PIECES_MAX), int(raw_total))
    return {
        "pieces": capped,
        "raw_pieces": raw_total,
        "cap": WEEKLY_LOOT_PIECES_MAX,
        "capped": raw_total > WEEKLY_LOOT_PIECES_MAX,
        "cars": cars,
        "week": exclusive_car_id_rotate_week(),
    }


async def weekly_loot_breakdown_for_user(db, user_id: str) -> Dict[str, Any]:
    catalog_ids = rotate_catalog_car_ids()
    out = weekly_loot_breakdown([])
    if not catalog_ids or not user_id:
        return out
    rows = await db.user_cars.find(
        {"user_id": user_id, "car_id": {"$in": catalog_ids}},
        {"_id": 0, "car_id": 1},
    ).to_list(200)
    breakdown = weekly_loot_breakdown([r.get("car_id") for r in (rows or [])])
    return breakdown


async def credit_exclusive_car_weekly_loot(db) -> Dict[str, Any]:
    """Credit living owners once per UTC ISO week. Cars granted later this week wait until next Monday."""
    week = exclusive_car_id_rotate_week()
    catalog_ids = rotate_catalog_car_ids()
    if not catalog_ids:
        return {"week": week, "credited": 0, "pieces": 0}

    by_user: Dict[str, Set[str]] = {}
    cursor = db.user_cars.find(
        {"car_id": {"$in": catalog_ids}},
        {"_id": 0, "user_id": 1, "car_id": 1},
    )
    async for uc in cursor:
        uid = str(uc.get("user_id") or "")
        cid = str(uc.get("car_id") or "")
        if not uid or not cid:
            continue
        by_user.setdefault(uid, set()).add(cid)
    if not by_user:
        return {"week": week, "credited": 0, "pieces": 0}

    from server import send_notification

    credited = 0
    pieces_total = 0
    eligible = await db.users.find(
        {
            "id": {"$in": list(by_user.keys())},
            "is_dead": {"$ne": True},
            "is_npc": {"$ne": True},
            USER_WEEK_FIELD: {"$ne": week},
        },
        {"_id": 0, "id": 1, "username": 1},
    ).to_list(5000)

    now = datetime.now(timezone.utc).isoformat()
    for user in eligible:
        uid = user.get("id") or ""
        owned_ids = by_user.get(uid) or set()
        amount = weekly_loot_pieces_for_car_ids(owned_ids)
        if amount <= 0:
            continue
        from utils.loot_exclusive_540k import (
            CAR_ID as CAR24_ID,
            WEEKLY_MISSION_SKIP,
            WEEKLY_ROBOT_HIRES,
        )

        owns_540k = CAR24_ID in owned_ids
        inc: Dict[str, int] = {"loot_box_pieces": amount}
        if owns_540k:
            inc["mission_skip_tokens"] = int(WEEKLY_MISSION_SKIP)
            inc["robot_bodyguard_hire_tokens"] = int(WEEKLY_ROBOT_HIRES)
        after = await db.users.find_one_and_update(
            {"id": uid, USER_WEEK_FIELD: {"$ne": week}},
            {
                "$inc": inc,
                "$set": {
                    USER_WEEK_FIELD: week,
                    "exclusive_car_loot_last_amount": amount,
                    "exclusive_car_loot_last_at": now,
                },
            },
            return_document=ReturnDocument.AFTER,
        )
        if not after:
            continue
        credited += 1
        pieces_total += amount
        try:
            await db.economy_events.insert_one(
                {
                    "at": now,
                    "type": "exclusive_car_weekly_loot",
                    "user_id": uid,
                    "username": user.get("username") or "",
                    "pieces": amount,
                    "week": week,
                    "car_ids": sorted(by_user.get(uid) or []),
                }
            )
        except Exception as e:
            logger.warning("exclusive_car_weekly_loot economy_events: %s", e)
        try:
            cap_note = " (weekly cap)" if amount >= WEEKLY_LOOT_PIECES_MAX else ""
            extra = ""
            if owns_540k:
                extra = " Your 540K also paid 1 Mission Skip and 3 Free Robot Bodyguard hires."
            await send_notification(
                uid,
                "Exclusive car loot",
                f"Your exclusive cars generated {amount:,} loot box piece{'s' if amount != 1 else ''} this week{cap_note}.{extra}",
                "loot",
            )
        except Exception as e:
            logger.warning("exclusive_car_weekly_loot notify: %s", e)

    if credited:
        logger.info("Exclusive car weekly loot: %s players, %s pieces, week=%s", credited, pieces_total, week)
    return {"week": week, "credited": credited, "pieces": pieces_total}


async def run_exclusive_car_weekly_loot_loop():
    import server as srv

    await asyncio.sleep(95)
    while True:
        try:
            await credit_exclusive_car_weekly_loot(srv.db)
        except Exception:
            logger.exception("Exclusive car weekly loot loop")
        await asyncio.sleep(60)
