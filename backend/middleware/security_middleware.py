# Security middleware for FastAPI — IP ban enforcement + optional global per-user request cap.
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request
import logging

from utils.ip_ban_check import client_ip_from_request, json_response_if_ip_banned
from middleware.request_logging import _extract_user_from_request
from middleware.user_request_pace import check_user_request_pace

logger = logging.getLogger(__name__)


class SecurityMiddleware(BaseHTTPMiddleware):
    """Runs before routes: blocks banned IPs; optional per-user request cap when enabled in admin."""

    def __init__(self, app, db):
        super().__init__(app)
        self.db = db

    def _client_ip(self, request: Request) -> str:
        return client_ip_from_request(request)

    async def dispatch(self, request: Request, call_next):
        client_ip = self._client_ip(request)
        blocked = await json_response_if_ip_banned(self.db, client_ip)
        if blocked is not None:
            return blocked
        path = request.url.path
        if path.startswith("/api/"):
            user_id, _ = _extract_user_from_request(request)
            if user_id:
                paced = await check_user_request_pace(self.db, user_id, path)
                if paced is not None:
                    return paced
        return await call_next(request)
