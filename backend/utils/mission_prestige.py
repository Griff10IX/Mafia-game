"""One mission-ladder prestige. Passives turn on only after that second ladder is finished."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

REQ_MULT = 2
REWARD_MULT = 2
KILL_BULLET_MULT = 1.25
ROBOT_COST_MULT = 0.75
WHEEL_FREE_PER_DAY = 5
WEEKLY_POINTS = 5_000

STARTED_FIELD = "mission_prestige_started_at"
COMPLETE_FIELD = "mission_prestige_complete_at"
POINTS_WEEK_FIELD = "mission_prestige_points_week"
WHEEL_DAY_FIELD = "mission_prestige_wheel_day"
WHEEL_TODAY_FIELD = "mission_prestige_wheel_today"


def passives_on(user: Optional[dict]) -> bool:
    return bool((user or {}).get(COMPLETE_FIELD))


def utc_day_key(now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc).date().isoformat()


def wheel_free_remaining(user: Optional[dict], now: Optional[datetime] = None) -> int:
    user = user or {}
    if not passives_on(user):
        return 0
    if (user.get(WHEEL_DAY_FIELD) or "") != utc_day_key(now):
        return WHEEL_FREE_PER_DAY
    used = int(user.get(WHEEL_TODAY_FIELD) or 0)
    return max(0, WHEEL_FREE_PER_DAY - used)


def consume_wheel_free(user: Optional[dict], now: Optional[datetime] = None) -> Tuple[Dict[str, Any], Dict[str, int], Dict[str, Any]]:
    """Returns ($set, $inc, extra filter) for one prestige daily free wheel spin."""
    today = utc_day_key(now)
    user = user or {}
    if (user.get(WHEEL_DAY_FIELD) or "") != today:
        return {WHEEL_DAY_FIELD: today, WHEEL_TODAY_FIELD: 1}, {}, {}
    return (
        {},
        {WHEEL_TODAY_FIELD: 1},
        {WHEEL_DAY_FIELD: today, WHEEL_TODAY_FIELD: {"$lt": WHEEL_FREE_PER_DAY}},
    )


def robot_listed_cost(listed_cost: int, user: Optional[dict]) -> int:
    cost = int(listed_cost or 0)
    if cost <= 0 or not passives_on(user):
        return cost
    return max(1, int(round(cost * ROBOT_COST_MULT)))
