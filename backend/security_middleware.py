# Security middleware for FastAPI
from datetime import datetime, timezone
from collections import defaultdict
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from fastapi import Request
import logging
import hashlib
import os
import random
from jose import jwt, JWTError

logger = logging.getLogger(__name__)

# Master toggle - when False the entire security middleware is bypassed (off by default)
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
        from security import check_endpoint_rate_limit, check_request_spam, check_duplicate_request
        self.check_endpoint_rate_limit = check_endpoint_rate_limit
        self.check_request_spam = check_request_spam
        self.check_duplicate_request = check_duplicate_request
    
    def _client_ip(self, request: Request) -> str:
        # Cloudflare provides real IP in CF-Connecting-IP
        cf_ip = request.headers.get("cf-connecting-ip")
        if cf_ip:
            return cf_ip.strip()
        # Fallback to X-Forwarded-For (nginx or other proxies)
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if request.client:
            return request.client.host or ""
        return ""

    async def dispatch(self, request: Request, call_next):
        if not SECURITY_MIDDLEWARE_ENABLED:
            return await call_next(request)

        path = request.url.path
        # IP ban: blocked from accessing the server at all (checked first, no path skip)
        client_ip = self._client_ip(request)
        if client_ip:
            try:
                ban = await self.db.ip_bans.find_one(
                    {"ip": client_ip, "active": True},
                    {"_id": 0, "expires_at": 1},
                )
                if ban:
                    expires_at = ban.get("expires_at")
                    if expires_at:
                        try:
                            exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                            if exp.tzinfo is None:
                                exp = exp.replace(tzinfo=timezone.utc)
                            if datetime.now(timezone.utc) >= exp:
                                await self.db.ip_bans.update_many(
                                    {"ip": client_ip, "active": True},
                                    {"$set": {"active": False}},
                                )
                            else:
                                return JSONResponse(
                                    status_code=403,
                                    content={"detail": "Your IP has been banned from this server."},
                                )
                        except Exception:
                            return JSONResponse(
                                status_code=403,
                                content={"detail": "Your IP has been banned from this server."},
                            )
                    else:
                        return JSONResponse(
                            status_code=403,
                            content={"detail": "Your IP has been banned from this server."},
                        )
            except Exception as e:
                logger.warning("IP ban check failed: %s", e)

        # Skip security checks for certain paths
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
            if await self.check_request_spam(user_id, username, self.db):
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
            # 2. Check endpoint-specific rate limits (if enabled for this endpoint)
            # Only for state-changing methods so GETs (e.g. dice config/ownership) can load in parallel.
            if request.method not in ("GET", "HEAD", "OPTIONS") and await self.check_endpoint_rate_limit(path, user_id, username, self.db):
                cooldown = _get_cooldown_seconds(user_id)
                logger.warning(f"RATE LIMIT: {username} - {path} (cooldown {cooldown}s)")
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": f"Rate limit exceeded. Please wait {cooldown} seconds.",
                        "is_cooldown": True,
                        "cooldown_seconds": cooldown,
                    }
                )
            
        except Exception as e:
            logger.exception(f"Security middleware error: {e}")
        
        # Process request
        response = await call_next(request)
        return response
