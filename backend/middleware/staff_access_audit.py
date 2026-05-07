# After response: record 403 on /api/.../admin/... and notify staff (see utils/staff_access_audit).
import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from utils.staff_access_audit import decode_jwt_bearer_user, is_staff_tool_api_path, record_staff_route_forbidden

logger = logging.getLogger(__name__)


class StaffAccessAuditMiddleware(BaseHTTPMiddleware):
    """On 401/403 for staff-like API paths, append audit row and optionally inbox all admins + moderators."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        try:
            if response.status_code not in (401, 403):
                return response
            if request.method.upper() == "OPTIONS":
                return response
            path = request.url.path
            if not is_staff_tool_api_path(path):
                return response
            path_full = path
            q = request.url.query
            if q:
                path_full = f"{path}?{q}"[:2048]
            user_id, username, email = decode_jwt_bearer_user(request)
            if not user_id:
                return response
            cf_ip = (request.headers.get("cf-connecting-ip") or "").strip()
            xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
            client_host = ""
            if request.client:
                client_host = (request.client.host or "").strip()
            client_ip = cf_ip or xff or client_host

            from server import db, send_notification, _get_staff_user_ids

            await record_staff_route_forbidden(
                db,
                method=request.method,
                path_with_query=path_full,
                user_id=user_id,
                username=username or None,
                email=email or None,
                client_ip=client_ip or None,
                send_notification=send_notification,
                get_notify_user_ids=_get_staff_user_ids,
                http_status=response.status_code,
            )
        except Exception:
            logger.exception("StaffAccessAuditMiddleware failed")
        return response
