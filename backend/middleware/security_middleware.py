# Security middleware for FastAPI
from datetime import datetime, timezone
from collections import defaultdict
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from fastapi import Request
import logging
import hashlib
import os
from urllib.parse import urlencode
import random
from jose import jwt, JWTError

from utils.ip_ban_check import client_ip_from_request, json_response_if_ip_banned

logger = logging.getLogger(__name__)

# When False: skip spam / duplicate-request / page-visit rate limits only.
# IP bans (ip_bans collection) are always enforced so admin bans take effect in production.
# Boot default on so GET (incl. F5 / polling) is covered by page-visit spam; set SECURITY_MIDDLEWARE_ENABLED=0/false/no to disable.
# Admin can still toggle the running process without restart.
_smw_raw = (os.environ.get("SECURITY_MIDDLEWARE_ENABLED") or "1").strip().lower()
SECURITY_MIDDLEWARE_ENABLED = _smw_raw in ("1", "true", "yes", "")

# Track consecutive 429 hits per user for escalating cooldowns (10-30s)
_user_429_hits: dict[str, list[float]] = defaultdict(list)
_COOLDOWN_WINDOW = 120  # seconds to track hits within
_COOLDOWN_MIN = 10
_COOLDOWN_MAX = 30


def _get_cooldown_seconds(user_id: str) -> int:
    """Escalating cooldown: more consecutive 429s in the window = longer cooldown (10-30s)."""
    now = datetime.now(timezone.utc).timestamp()
    cutoff = now - _COOLDOWN_WINDOW
    _user_429_hits[user_id] = [t for t in _user_429_hits[user_id] if t > cutoff]
    _user_429_hits[user_id].append(now)
    hits = len(_user_429_hits[user_id])
    if hits <= 1:
        return _COOLDOWN_MIN
    fraction = min((hits - 1) / 8.0, 1.0)
    return int(_COOLDOWN_MIN + fraction * (_COOLDOWN_MAX - _COOLDOWN_MIN))


class SecurityMiddleware(BaseHTTPMiddleware):
    """
    Middleware to check for spam and exploits on protected endpoints.
    Does NOT limit legitimate gameplay - only detects bot-like spam patterns.
    """
    
    def __init__(self, app, db):
        super().__init__(app)
        self.db = db
        # Import here to avoid circular dependency
        from middleware.security import check_page_request_spam, check_request_spam, check_duplicate_request
        self.check_page_request_spam = check_page_request_spam
        self.check_request_spam = check_request_spam
        self.check_duplicate_request = check_duplicate_request

    def _params_hash(self, request: Request) -> str:
        """Hash query params for duplicate request detection."""
        q = request.query_params
        if not q:
            return ""
        # Sort for consistent hashing
        pairs = sorted(q.items())
        raw = urlencode(pairs)
        return hashlib.md5(raw.encode()).hexdigest()[:16]

    def _client_ip(self, request: Request) -> str:
        return client_ip_from_request(request)

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        client_ip = self._client_ip(request)
        # IP ban: always on (not gated by SECURITY_MIDDLEWARE_ENABLED). No path whitelist.
        blocked = await json_response_if_ip_banned(self.db, client_ip)
        if blocked is not None:
            return blocked

        if not SECURITY_MIDDLEWARE_ENABLED:
            return await call_next(request)

        # Skip spam / rate-limit for certain paths (IP ban already applied above)
        # Exact matches for root/docs (avoid "/" matching everything via startswith)
        _skip_exact = {"/", "/docs", "/openapi.json"}
        _skip_prefix = [
            "/api/auth/",
            "/api/admin/",
            "/admin/",
        ]
        
        if path in _skip_exact or any(path.startswith(p) for p in _skip_prefix):
            return await call_next(request)
        
        # Try to extract user from JWT token
        current_user = None
        try:
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                token = auth_header.split(" ")[1]
                SECRET_KEY = os.getenv("JWT_SECRET_KEY")
                if not SECRET_KEY or SECRET_KEY in ("your-secret-key-here", "your-secret-key-change-in-production", "GENERATE_NEW_SECRET_HERE"):
                    raise ValueError("Invalid JWT secret")
                payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
                user_id = payload.get("sub")
                username = payload.get("username", "Unknown")
                if user_id:
                    current_user = {"id": user_id, "username": username}
        except (JWTError, Exception):
            pass  # If token invalid, just skip security checks
        
        if not current_user:
            # No user = unauthenticated request, skip checks
            return await call_next(request)
        
        user_id = current_user.get("id")
        username = current_user.get("username", "Unknown")
        
        try:
            referer = request.headers.get("referer") or request.headers.get("referrer") or ""
            spa_header = request.headers.get("x-current-path") or request.headers.get("X-Current-Path")
            # 1. Page-visit spam (sliding window per SPA path + user; includes GET)
            if await self.check_page_request_spam(
                user_id,
                username,
                self.db,
                api_path=path,
                spa_path_header=spa_header,
                method=request.method,
                referer=referer,
            ):
                cooldown = _get_cooldown_seconds(user_id)
                logger.warning(f"PAGE SPAM BLOCKED: {username} - {path} spa={spa_header!r} (cooldown {cooldown}s)")
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": f"Too many requests. Please wait {cooldown} seconds.",
                        "is_cooldown": True,
                        "cooldown_seconds": cooldown,
                    },
                )
            # 2. Request spam (mutating only; threshold in security.MAX_REQUESTS_PER_SECOND)
            if await self.check_request_spam(
                user_id, username, self.db,
                method=request.method,
                path=path,
                referer=referer,
            ):
                cooldown = _get_cooldown_seconds(user_id)
                logger.warning(f"SPAM BLOCKED: {username} - {path} (cooldown {cooldown}s)")
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": f"Too many requests. Please wait {cooldown} seconds.",
                        "is_cooldown": True,
                        "cooldown_seconds": cooldown,
                    }
                )
            # 3. Check duplicate requests (when enabled - reduces double-click exploits)
            if request.method not in ("GET", "HEAD", "OPTIONS"):
                import middleware.security as security_mod
                if getattr(security_mod, "DETECT_DUPLICATE_REQUESTS", False):
                    params_hash = self._params_hash(request)
                    if await self.check_duplicate_request(user_id, path, params_hash, self.db, username):
                        cooldown = _get_cooldown_seconds(user_id)
                        logger.warning(f"DUPLICATE REQUEST BLOCKED: {username} - {path} (cooldown {cooldown}s)")
                        return JSONResponse(
                            status_code=429,
                            content={
                                "detail": f"Duplicate request detected. Please wait {cooldown} seconds.",
                                "is_cooldown": True,
                                "cooldown_seconds": cooldown,
                            }
                        )
        except Exception as e:
            logger.exception(f"Security middleware error: {e}")
        
        # Process request
        response = await call_next(request)
        return response
