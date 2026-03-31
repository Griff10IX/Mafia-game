"""
Configurable claim costs for casinos, airport, and armoury.

Persisted in MongoDB `game_settings` with key `claim_costs` (value: dict).
Gameplay merges stored values with DEFAULT_CLAIM_COSTS for missing/invalid keys.
"""

from __future__ import annotations

import time
from typing import Any, Dict, Optional

CLAIM_COSTS_SETTINGS_KEY = "claim_costs"

# Must match historical module defaults (see routers before DB-backed costs).
DEFAULT_CLAIM_COSTS: Dict[str, int] = {
    "dice_cash": 125_000_000,
    "dice_points": 0,
    "roulette": 250_000_000,
    "blackjack": 1_000_000_000,
    "horseracing": 500_000_000,
    "video_poker": 750_000_000,
    "airport": 175_000_000,
    "armoury": 200_000_000,
}

KNOWN_KEYS = frozenset(DEFAULT_CLAIM_COSTS.keys())
_MAX_COST = 10**15


def _coerce_non_negative_int(v: Any, default: int) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    if n < 0 or n > _MAX_COST:
        return default
    return n


def merge_claim_costs(raw: Optional[Dict[str, Any]]) -> Dict[str, int]:
    """Merge DB value dict with defaults; unknown keys ignored."""
    out = dict(DEFAULT_CLAIM_COSTS)
    if not raw or not isinstance(raw, dict):
        return out
    for k in KNOWN_KEYS:
        if k in raw:
            out[k] = _coerce_non_negative_int(raw.get(k), out[k])
    return out


_claim_costs_cache: Optional[tuple] = None  # (merged dict, expires_at_monotonic)


async def load_claim_costs(db, *, ttl_sec: float = 45.0) -> Dict[str, int]:
    """
    Effective claim costs. Uses short in-memory cache when ttl_sec > 0 to reduce reads on hot paths.
    Pass ttl_sec=0 to always read from DB (e.g. admin).
    """
    global _claim_costs_cache
    now = time.monotonic()
    if ttl_sec > 0 and _claim_costs_cache is not None:
        cached, exp = _claim_costs_cache
        if now < exp:
            return dict(cached)

    doc = await db.game_settings.find_one({"key": CLAIM_COSTS_SETTINGS_KEY}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value")
    merged = merge_claim_costs(raw if isinstance(raw, dict) else None)
    if ttl_sec > 0:
        _claim_costs_cache = (merged, now + ttl_sec)
    return dict(merged)


def invalidate_claim_costs_cache() -> None:
    global _claim_costs_cache
    _claim_costs_cache = None
