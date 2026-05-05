"""Live Keno limits in MongoDB `game_settings` (key `keno_max_bet`)."""

from __future__ import annotations

import time
from typing import Any, Optional

KENO_MAX_BET_SETTINGS_KEY = "keno_max_bet"
DEFAULT_KENO_MAX_BET = 5_000_000
_MIN = 1
_MAX = 10**15

_keno_max_bet_cache: Optional[tuple] = None  # (int, expires_at_monotonic)


def _coerce_max_bet(v: Any) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return DEFAULT_KENO_MAX_BET
    if n < _MIN or n > _MAX:
        return DEFAULT_KENO_MAX_BET
    return n


async def load_keno_max_bet(db, *, ttl_sec: float = 30.0) -> int:
    """Effective max bet for Keno play + public config. Cached briefly to reduce reads."""
    global _keno_max_bet_cache
    now = time.monotonic()
    if ttl_sec > 0 and _keno_max_bet_cache is not None:
        cached, exp = _keno_max_bet_cache
        if now < exp:
            return int(cached)

    doc = await db.game_settings.find_one({"key": KENO_MAX_BET_SETTINGS_KEY}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value")
    n = _coerce_max_bet(raw)
    if ttl_sec > 0:
        _keno_max_bet_cache = (n, now + ttl_sec)
    return n


def invalidate_keno_max_bet_cache() -> None:
    global _keno_max_bet_cache
    _keno_max_bet_cache = None
