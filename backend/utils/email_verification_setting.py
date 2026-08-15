"""Admin toggle: require email verification to play and for new signups."""
from __future__ import annotations

import time
from typing import Any, Optional, Tuple

SETTING_KEY = "require_email_verification"
DEFAULT_REQUIRED = True
_CACHE_TTL_SEC = 30.0

_cache: Tuple[float, bool] = (0.0, DEFAULT_REQUIRED)


def invalidate_require_email_verification_cache() -> None:
    global _cache
    _cache = (0.0, DEFAULT_REQUIRED)


async def require_email_verification_enabled(db: Any) -> bool:
    """True when unverified players are locked out of play and new signups must verify."""
    global _cache
    now = time.monotonic()
    cached_at, cached_val = _cache
    if cached_at and (now - cached_at) < _CACHE_TTL_SEC:
        return cached_val
    try:
        doc = await db.game_settings.find_one({"key": SETTING_KEY}, {"_id": 0, "value": 1})
        if doc is None:
            val = DEFAULT_REQUIRED
        else:
            val = bool(doc.get("value"))
    except Exception:
        val = DEFAULT_REQUIRED
    _cache = (now, val)
    return val
