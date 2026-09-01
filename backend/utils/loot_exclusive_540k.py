"""Loot exclusive Mercedes-Benz 540K (car24) perks.

Drop rate for Ultra Rare opens lives only in loot_box.py — never expose it in
public loot APIs, scarcity, reward catalogs, or player notifications.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

CAR_ID = "car24"
FAST_TRAVELS_PER_DAY = 25
FAST_TRAVEL_SECONDS = 1
WHEEL_FREE_PER_DAY = 2
WEEKLY_MISSION_SKIP = 1
WEEKLY_ROBOT_HIRES = 3
WEEKLY_LOOT_PIECES = 75

USER_FAST_DAY_FIELD = "car24_fast_travel_day"
USER_FAST_TODAY_FIELD = "car24_fast_travels_today"
USER_WHEEL_DAY_FIELD = "car24_wheel_free_day"
USER_WHEEL_TODAY_FIELD = "car24_wheel_free_today"


def utc_day_key(now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc).date().isoformat()


def fast_travels_remaining(user: Optional[dict], now: Optional[datetime] = None) -> int:
    user = user or {}
    if (user.get(USER_FAST_DAY_FIELD) or "") != utc_day_key(now):
        return FAST_TRAVELS_PER_DAY
    used = int(user.get(USER_FAST_TODAY_FIELD) or 0)
    return max(0, FAST_TRAVELS_PER_DAY - used)


def preview_catalog_seconds(car_id: Optional[str], catalog_seconds: int, user: Optional[dict], now: Optional[datetime] = None) -> int:
    """Travel-info preview: 1s while daily 540K quota remains, else catalog seconds."""
    if (car_id or "").strip() != CAR_ID:
        return int(catalog_seconds)
    if fast_travels_remaining(user, now) > 0:
        return FAST_TRAVEL_SECONDS
    return int(catalog_seconds)


def consume_fast_travel(
    car_id: Optional[str],
    catalog_seconds: int,
    user: Optional[dict],
    now: Optional[datetime] = None,
) -> Tuple[int, Dict[str, Any], Dict[str, int]]:
    """On travel start: consume one 1s slot if available. Returns (seconds, $set, $inc)."""
    if (car_id or "").strip() != CAR_ID:
        return int(catalog_seconds), {}, {}
    today = utc_day_key(now)
    user = user or {}
    if fast_travels_remaining(user, now) <= 0:
        return int(catalog_seconds), {}, {}
    if (user.get(USER_FAST_DAY_FIELD) or "") != today:
        return FAST_TRAVEL_SECONDS, {USER_FAST_DAY_FIELD: today, USER_FAST_TODAY_FIELD: 1}, {}
    return FAST_TRAVEL_SECONDS, {}, {USER_FAST_TODAY_FIELD: 1}


def wheel_free_remaining(user: Optional[dict], now: Optional[datetime] = None) -> int:
    user = user or {}
    if (user.get(USER_WHEEL_DAY_FIELD) or "") != utc_day_key(now):
        return WHEEL_FREE_PER_DAY
    used = int(user.get(USER_WHEEL_TODAY_FIELD) or 0)
    return max(0, WHEEL_FREE_PER_DAY - used)


def consume_wheel_free(user: Optional[dict], now: Optional[datetime] = None) -> Tuple[Dict[str, Any], Dict[str, int], Dict[str, Any]]:
    """Returns ($set, $inc, extra $filt) for one 540K daily free wheel spin."""
    today = utc_day_key(now)
    user = user or {}
    if (user.get(USER_WHEEL_DAY_FIELD) or "") != today:
        return {USER_WHEEL_DAY_FIELD: today, USER_WHEEL_TODAY_FIELD: 1}, {}, {}
    return (
        {},
        {USER_WHEEL_TODAY_FIELD: 1},
        {USER_WHEEL_DAY_FIELD: today, USER_WHEEL_TODAY_FIELD: {"$lt": WHEEL_FREE_PER_DAY}},
    )


async def user_owns(db, user_id: str) -> bool:
    uid = (user_id or "").strip()
    if not uid:
        return False
    row = await db.user_cars.find_one({"user_id": uid, "car_id": CAR_ID}, {"_id": 1})
    return row is not None
