# When STAFF_PORTAL_PASSWORD is set, require X-Staff-Portal-Token on /api/.../admin/... (except bootstrap paths).
import logging
import os

from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from utils.staff_access_audit import is_staff_tool_api_path
from utils.staff_portal import (
    is_staff_portal_exempt_path,
    staff_portal_password_configured,
    verify_staff_portal_token,
)

logger = logging.getLogger(__name__)

_STAFF_PORTAL_403_DETAIL = "Staff portal: unlock required. Enter the staff password to continue."


def _bearer_sub(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    secret = (os.environ.get("JWT_SECRET_KEY") or "").strip()
    if not secret:
        return None
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        uid = payload.get("sub")
        s = str(uid).strip() if uid is not None else ""
        return s or None
    except (JWTError, Exception):
        return None


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
        user_id = _bearer_sub(request)
        if not user_id:
            return await call_next(request)
        portal = (request.headers.get("X-Staff-Portal-Token") or "").strip()
        if verify_staff_portal_token(portal, user_id):
            return await call_next(request)
        return JSONResponse(
            status_code=403,
            content={"detail": _STAFF_PORTAL_403_DETAIL},
        )
