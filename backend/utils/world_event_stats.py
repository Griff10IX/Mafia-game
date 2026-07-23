"""Lifetime world-event benefit counters shown on Account → Game Events.

Stored on the user doc as world_event_stats.<field> — best-effort,
never raises so it can be called from any hot path.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Fields exposed to /events/active → my_gains (and Game Events UI).
STATS_FIELDS = (
    "bonus_rp",
    "bonus_cash",
    "saved_cash",
    "saved_points",
    "gta_boosted",
    "cooldown_seconds_saved",
    "uses",
)


async def bump_world_event_stats(db, user_id: str, **fields) -> None:
    """$inc numeric benefit fields from active world events, e.g.
    await bump_world_event_stats(db, uid, bonus_rp=12, bonus_cash=500, uses=1)."""
    uid = (user_id or "").strip()
    if not uid:
        return
    inc: Dict[str, int] = {}
    for k, v in fields.items():
        try:
            n = int(v)
        except (TypeError, ValueError):
            continue
        if n:
            inc[f"world_event_stats.{k}"] = n
    if not inc:
        return
    try:
        await db.users.update_one({"id": uid}, {"$inc": inc})
    except Exception as e:
        logger.debug("world event stats %s: %s", uid, e)


async def bump_world_event_discount(
    db,
    user_id: str,
    *,
    base_cost: Any,
    paid_cost: Any,
    currency: str = "cash",
) -> None:
    """Record savings when a cost multiplier < 1 reduced what the player paid."""
    try:
        base = int(base_cost or 0)
        paid = int(paid_cost or 0)
    except (TypeError, ValueError):
        return
    saved = max(0, base - paid)
    if not saved:
        return
    field = "saved_points" if currency in ("points", "pts", "point") else "saved_cash"
    await bump_world_event_stats(db, user_id, **{field: saved, "uses": 1})


def world_event_bonus_delta(base: Any, mult: Any) -> int:
    """Extra amount when applying a >1 multiplier: int(base * mult) - base."""
    try:
        b = int(base or 0)
        m = float(mult or 1.0)
    except (TypeError, ValueError):
        return 0
    if b <= 0 or m <= 1.0:
        return 0
    return max(0, int(b * m) - b)


def world_event_saved_delta(base: Any, mult: Any) -> int:
    """Cash/points saved when applying a <1 cost multiplier: base - int(base * mult)."""
    try:
        b = int(base or 0)
        m = float(mult or 1.0)
    except (TypeError, ValueError):
        return 0
    if b <= 0 or m >= 1.0 or m <= 0:
        return 0
    return max(0, b - int(b * m))


def serialize_world_event_stats(raw: Optional[dict]) -> Dict[str, int]:
    """Shape returned to the Game Events UI."""
    s = raw if isinstance(raw, dict) else {}
    return {k: int(s.get(k) or 0) for k in STATS_FIELDS}
