"""
Global hot/cold travel cities: rotate every PERIOD_SECONDS (UTC).
Same assignment for all players; no DB. Used by crimes, GTA, jail bust, and UI payloads.
"""
from __future__ import annotations

import random
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from utils.config import STATES

PERIOD_SECONDS = 3 * 3600
RNG_SEED_SALT = 7919
RNG_SEED_OFFSET = 1337

HOT_SUCCESS_MULT = 1.05
COLD_SUCCESS_MULT = 0.95
HOT_RANK_MULT = 1.05
COLD_RANK_MULT = 0.95

# Jail bust rates are already high after badges; cap after climate so we never hit certainty.
JAIL_BUST_CLIMATE_CAP = 0.99


def normalize_state(name: Optional[str]) -> Optional[str]:
    if not name or not isinstance(name, str):
        return None
    s = name.strip()
    for st in STATES or []:
        if s == st:
            return st
    return None


def get_location_climate(now: Optional[datetime] = None) -> Dict[str, Any]:
    """
    Returns hot, cold (distinct cities when len(STATES) >= 2), period bounds (ISO UTC),
    by_city map, period_index for debugging.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    states = list(STATES or [])
    ts = now.timestamp()
    period_idx = int(ts // PERIOD_SECONDS)
    period_start = datetime.fromtimestamp(period_idx * PERIOD_SECONDS, tz=timezone.utc)
    period_end = period_start + timedelta(seconds=PERIOD_SECONDS)

    if len(states) < 2:
        by_city = {s: "neutral" for s in states}
        return {
            "hot": None,
            "cold": None,
            "period_started_at": period_start.isoformat(),
            "period_ends_at": period_end.isoformat(),
            "period_index": period_idx,
            "by_city": by_city,
        }

    rng = random.Random(period_idx * RNG_SEED_SALT + RNG_SEED_OFFSET)
    shuffled = states[:]
    rng.shuffle(shuffled)
    hot, cold = shuffled[0], shuffled[1]
    by_city = {s: "neutral" for s in states}
    by_city[hot] = "hot"
    by_city[cold] = "cold"

    return {
        "hot": hot,
        "cold": cold,
        "period_started_at": period_start.isoformat(),
        "period_ends_at": period_end.isoformat(),
        "period_index": period_idx,
        "by_city": by_city,
    }


def success_multiplier_for_actor(current_state: Optional[str], climate: Optional[Dict[str, Any]] = None) -> float:
    c = climate or get_location_climate()
    n = normalize_state(current_state)
    if not n:
        return 1.0
    if n == c.get("hot"):
        return HOT_SUCCESS_MULT
    if n == c.get("cold"):
        return COLD_SUCCESS_MULT
    return 1.0


def rank_multiplier_for_actor(current_state: Optional[str], climate: Optional[Dict[str, Any]] = None) -> float:
    c = climate or get_location_climate()
    n = normalize_state(current_state)
    if not n:
        return 1.0
    if n == c.get("hot"):
        return HOT_RANK_MULT
    if n == c.get("cold"):
        return COLD_RANK_MULT
    return 1.0


def jail_bust_rate_after_climate(base_rate: float, current_state: Optional[str], climate: Optional[Dict[str, Any]] = None) -> float:
    """Multiply bust success probability by hot/cold; clamp to JAIL_BUST_CLIMATE_CAP."""
    m = success_multiplier_for_actor(current_state, climate)
    return min(JAIL_BUST_CLIMATE_CAP, max(0.0, float(base_rate) * m))
