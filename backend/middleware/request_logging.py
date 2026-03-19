# Request logging middleware: log API requests with authenticated username
import logging
import os
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from jose import jwt, JWTError

logger = logging.getLogger(__name__)

REQUEST_LOGGING_ENABLED = (os.environ.get("REQUEST_LOGGING_ENABLED") or "1").strip().lower() in ("1", "true", "yes")

_SKIP_PATHS = {
    "/",
    "/docs",
    "/openapi.json",
    "/favicon.ico",
}
_SKIP_PREFIXES = [
    "/api/game-chat/messages",
    "/api/notifications",
    "/api/travel/status",
    "/api/auto-rank/cron",
    "/api/auto-rank/cron-bust",
    "/static",
    "/health",
]


def _should_skip(path: str) -> bool:
    if path in _SKIP_PATHS:
        return True
    return any(path.startswith(p) for p in _SKIP_PREFIXES)


def _extract_user_from_request(request: Request) -> tuple[str | None, str | None]:
    """Extract user_id and username from JWT. Returns (user_id, username)."""
    try:
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return None, None
        token = auth_header.split(" ")[1]
        secret = os.getenv("JWT_SECRET_KEY")
        if not secret or secret in ("your-secret-key-here", "your-secret-key-change-in-production", "GENERATE_NEW_SECRET_HERE"):
            return None, None
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        user_id = payload.get("sub")
        username = payload.get("username") or ""
        return user_id, username
    except (JWTError, Exception):
        return None, None


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log each API request with method, path, and authenticated username."""

    async def dispatch(self, request: Request, call_next):
        if not REQUEST_LOGGING_ENABLED:
            return await call_next(request)

        path = request.url.path
        if _should_skip(path):
            return await call_next(request)

        response = await call_next(request)

        method = request.method
        user_id, username = _extract_user_from_request(request)
        user_label = username if username else (user_id if user_id else "anonymous")
        status = response.status_code

        logger.info("API %s %s %s | user=%s", method, path, status, user_label)
        return response
