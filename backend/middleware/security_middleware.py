# Security middleware for FastAPI — IP ban enforcement only (Phase 0: app rate limiting removed).
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request
import logging

from utils.ip_ban_check import client_ip_from_request, json_response_if_ip_banned

logger = logging.getLogger(__name__)


class SecurityMiddleware(BaseHTTPMiddleware):
    """Runs before routes: blocks banned IPs; no request throttling."""

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
        return await call_next(request)
