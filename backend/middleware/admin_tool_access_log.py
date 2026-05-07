# After response: record successful 2xx calls to audited staff API routes (excluding noisy paths).
import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from utils.admin_tool_access_log import record_admin_tool_api_event, should_log_successful_staff_tool_request
from utils.staff_access_audit import decode_jwt_bearer_user

logger = logging.getLogger(__name__)


class AdminToolAccessLogMiddleware(BaseHTTPMiddleware):
    """On 2xx for staff-gated API paths, append admin_tool_access_events row (Bearer user only)."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        try:
            if request.method.upper() == "OPTIONS":
                return response
            if response.status_code < 200 or response.status_code >= 300:
                return response
            path = request.url.path
            if not should_log_successful_staff_tool_request(path):
                return response
            user_id, username, email = decode_jwt_bearer_user(request)
            if not user_id:
                return response
            from server import db

            await record_admin_tool_api_event(
                db,
                user_id=user_id,
                username=username,
                email=email,
                method=request.method,
                path=path,
                status_code=response.status_code,
                request=request,
            )
        except Exception:
            logger.exception("AdminToolAccessLogMiddleware failed")
        return response
