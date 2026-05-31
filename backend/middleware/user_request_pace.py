# Global per-user authenticated request cap (optional via game_settings.main).
import logging
import time
from collections import defaultdict, deque
from typing import Optional

from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

_SETTINGS_CACHE: dict = {"t": 0.0, "enabled": False, "limit": 15}
_SETTINGS_CACHE_TTL_SEC = 5.0
_WINDOW_SEC = 1.0
_DEFAULT_LIMIT = 15

_user_windows: dict[str, deque] = defaultdict(deque)
_MAX_TRACKED_USERS = 20_000


def invalidate_user_request_pace_settings_cache() -> None:
    _SETTINGS_CACHE["t"] = 0.0


async def load_user_request_pace_settings(db) -> tuple[bool, int]:
    now = time.monotonic()
    if now - float(_SETTINGS_CACHE["t"]) < _SETTINGS_CACHE_TTL_SEC:
        return bool(_SETTINGS_CACHE["enabled"]), int(_SETTINGS_CACHE["limit"])
    doc = await db.game_settings.find_one(
        {"_id": "main"},
        {"_id": 0, "user_request_pace_enabled": 1, "user_request_pace_limit": 1},
    )
    enabled = bool((doc or {}).get("user_request_pace_enabled"))
    try:
        limit = int((doc or {}).get("user_request_pace_limit") or _DEFAULT_LIMIT)
    except (TypeError, ValueError):
        limit = _DEFAULT_LIMIT
    limit = max(5, min(100, limit))
    _SETTINGS_CACHE["t"] = now
    _SETTINGS_CACHE["enabled"] = enabled
    _SETTINGS_CACHE["limit"] = limit
    return enabled, limit


async def check_user_request_pace(db, user_id: str, path: str) -> Optional[JSONResponse]:
    """Return 429 JSONResponse when user exceeds rolling req/s cap; None if allowed."""
    if not user_id:
        return None
    if path.startswith("/api/admin/") or path.startswith("/api/auth/login"):
        return None
    enabled, limit = await load_user_request_pace_settings(db)
    if not enabled:
        return None
    now = time.time()
    if user_id not in _user_windows and len(_user_windows) >= _MAX_TRACKED_USERS:
        _user_windows.pop(next(iter(_user_windows)), None)
    q = _user_windows[user_id]
    while q and now - q[0] > _WINDOW_SEC:
        q.popleft()
    if len(q) >= limit:
        logger.info("user_request_pace 429 uid=%s path=%s count=%s limit=%s", user_id, path, len(q), limit)
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests — slow down.", "cooldown_seconds": 5},
            headers={"Retry-After": "5"},
        )
    q.append(now)
    return None
