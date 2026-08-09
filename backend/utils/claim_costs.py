"""
Configurable claim costs for casinos, airport, and armoury.

Persisted in MongoDB `game_settings` with key `claim_costs` (value: dict).
Gameplay merges stored values with DEFAULT_CLAIM_COSTS for missing/invalid keys.
"""

from __future__ import annotations

import time
from typing import Any, Dict, Optional

CLAIM_COSTS_SETTINGS_KEY = "claim_costs"
# One-shot: zero casino table claim cash/points (airport / armoury unchanged).
CASINO_CLAIMS_FREE_MIGRATION_KEY = "casino_claims_free_v1"

# Casino tables: free to claim when unowned. Airport / armoury keep cash costs.
DEFAULT_CLAIM_COSTS: Dict[str, int] = {
    "dice_cash": 0,
    "dice_points": 0,
    "roulette": 0,
    "blackjack": 0,
    "horseracing": 0,
    "video_poker": 0,
    "airport": 175_000_000,
    "armoury": 200_000_000,
}

CASINO_CLAIM_COST_KEYS = frozenset(
    ("dice_cash", "dice_points", "roulette", "blackjack", "horseracing", "video_poker")
)

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


async def ensure_casino_claim_costs_free(db) -> None:
    """
    Idempotent migration: set casino claim costs to $0 / 0 pts in game_settings.
    Leaves airport and armoury costs alone. Safe to call on every startup.
    """
    try:
        flag = await db.game_settings.find_one(
            {"key": CASINO_CLAIMS_FREE_MIGRATION_KEY},
            {"_id": 0, "value": 1},
        )
        if flag and flag.get("value"):
            return
        doc = await db.game_settings.find_one(
            {"key": CLAIM_COSTS_SETTINGS_KEY},
            {"_id": 0, "value": 1},
        )
        raw = dict((doc or {}).get("value") or {}) if isinstance((doc or {}).get("value"), dict) else {}
        for k in CASINO_CLAIM_COST_KEYS:
            raw[k] = 0
        merged = merge_claim_costs(raw)
        await db.game_settings.update_one(
            {"key": CLAIM_COSTS_SETTINGS_KEY},
            {"$set": {"key": CLAIM_COSTS_SETTINGS_KEY, "value": merged}},
            upsert=True,
        )
        await db.game_settings.update_one(
            {"key": CASINO_CLAIMS_FREE_MIGRATION_KEY},
            {"$set": {"key": CASINO_CLAIMS_FREE_MIGRATION_KEY, "value": True}},
            upsert=True,
        )
        invalidate_claim_costs_cache()
    except Exception:
        # Startup must not fail if settings write races; next boot retries.
        pass
