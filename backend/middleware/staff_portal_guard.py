# When STAFF_PORTAL_PASSWORD is set, require X-Staff-Portal-Token on /api/.../admin/... (except bootstrap paths).
import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from utils.staff_access_audit import decode_jwt_bearer_user, is_staff_tool_api_path, record_staff_route_forbidden
from utils.staff_portal import (
    is_staff_portal_exempt_path,
    staff_portal_password_configured,
    verify_staff_portal_token,
)

logger = logging.getLogger(__name__)

_STAFF_PORTAL_403_DETAIL = "Staff portal: unlock required. Enter the staff password to continue."


class StaffPortalGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not staff_portal_password_configured():
            return await call_next(request)
        if request.method.upper() == "OPTIONS":
            return await call_next(request)
        path = request.url.path
        if not is_staff_tool_api_path(path):
            return await call_next(request)
        if is_staff_portal_exempt_path(path):
            return await call_next(request)
        user_id, username, email = decode_jwt_bearer_user(request)
        if not user_id:
            return await call_next(request)
        portal = (request.headers.get("X-Staff-Portal-Token") or "").strip()
        device_hdr = (request.headers.get("X-Staff-Portal-Device-Id") or "").strip()[:80]
        if verify_staff_portal_token(portal, user_id, device_hdr):
            return await call_next(request)
        path_full = path
        q = request.url.query
        if q:
            path_full = f"{path}?{q}"[:2048]
        try:
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
                inbox_note="Cause: staff portal unlock required (password session missing or expired).",
            )
        except Exception:
            logger.exception("StaffPortalGuardMiddleware staff_access audit/notify failed")
        return JSONResponse(
            status_code=403,
            content={"detail": _STAFF_PORTAL_403_DETAIL},
        )
