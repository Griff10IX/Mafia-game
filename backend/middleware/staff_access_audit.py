# After response: record 403 on /api/.../admin/... and notify admins (see utils/staff_access_audit).
import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from jose import jwt, JWTError

from utils.staff_access_audit import is_staff_tool_api_path, record_staff_route_forbidden

logger = logging.getLogger(__name__)


def _decode_jwt_user(request: Request) -> tuple[str | None, str | None, str | None]:
    try:
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return None, None, None
        token = auth_header.split(" ", 1)[1].strip()
        import os

        secret = os.getenv("JWT_SECRET_KEY")
        if not secret or secret in (
            "your-secret-key-here",
            "your-secret-key-change-in-production",
            "GENERATE_NEW_SECRET_HERE",
        ):
            return None, None, None
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        uid = payload.get("sub")
        uid_s = str(uid).strip() if uid is not None else None
        username = (payload.get("username") or "").strip() or None
        email = (payload.get("email") or "").strip() or None
        return (uid_s or None, username, email)
    except (JWTError, Exception):
        return None, None, None


class StaffAccessAuditMiddleware(BaseHTTPMiddleware):
    """On 403 for staff-like API paths, append audit row and optionally inbox all admins."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        try:
            if response.status_code != 403:
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
            user_id, username, email = _decode_jwt_user(request)
            if not user_id:
                return response
            cf_ip = (request.headers.get("cf-connecting-ip") or "").strip()
            xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
            client_host = ""
            if request.client:
                client_host = (request.client.host or "").strip()
            client_ip = cf_ip or xff or client_host

            from server import db, send_notification, _get_admin_user_ids

            await record_staff_route_forbidden(
                db,
                method=request.method,
                path_with_query=path_full,
                user_id=user_id,
                username=username or None,
                email=email or None,
                client_ip=client_ip or None,
                send_notification=send_notification,
                get_admin_user_ids=_get_admin_user_ids,
            )
        except Exception:
            logger.exception("StaffAccessAuditMiddleware failed")
        return response
