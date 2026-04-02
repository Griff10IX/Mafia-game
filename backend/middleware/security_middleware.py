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

# When False: skip spam / duplicate-request / per-endpoint rate limits only.
# IP bans (ip_bans collection) are always enforced so admin bans take effect in production.
SECURITY_MIDDLEWARE_ENABLED = False

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
        from middleware.security import check_endpoint_rate_limit, check_request_spam, check_duplicate_request
        self.check_endpoint_rate_limit = check_endpoint_rate_limit
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
            "/api/auth/login",
            "/api/auth/register",
            "/api/auth/me",
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
            # 1. Check for request spam (10+ req/sec)
            referer = request.headers.get("referer") or request.headers.get("referrer") or ""
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
            # 2. Check duplicate requests (when enabled - reduces double-click exploits)
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
            # 3. Endpoint rate limits: soft block has no short punitive cooldown; only hard lockout uses long 15–30s
            if request.method not in ("GET", "HEAD", "OPTIONS"):
                rl_out = await self.check_endpoint_rate_limit(path, user_id, username, self.db)
                if rl_out.blocked:
                    cd = rl_out.cooldown_seconds
                    hard = rl_out.is_hard_cooldown_response
                    logger.warning(
                        "RATE LIMIT: %s - %s (cooldown %ss%s)",
                        username,
                        path,
                        cd,
                        ", hard lockout" if hard else "",
                    )
                    if hard:
                        msg = f"Too many repeated rate limits. Please wait {cd} seconds."
                        content = {
                            "detail": msg,
                            "is_cooldown": True,
                            "cooldown_seconds": cd,
                            "endpoint_rate_limit_hard": True,
                        }
                    else:
                        content = {
                            "detail": "Rate limit exceeded. Please slow down.",
                            "is_cooldown": False,
                            "cooldown_seconds": 0,
                            "endpoint_rate_limit_hard": False,
                        }
                    return JSONResponse(status_code=429, content=content)

        except Exception as e:
            logger.exception(f"Security middleware error: {e}")
        
        # Process request
        response = await call_next(request)
        return response
