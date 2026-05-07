# Extra gate for /api/.../admin/... routes: env STAFF_PORTAL_PASSWORD + short-lived JWT (X-Staff-Portal-Token).
from __future__ import annotations

import hashlib
import hmac
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

from jose import JWTError, jwt

logger = logging.getLogger(__name__)

_STAFF_PORTAL_TYP = "staff_portal"


def staff_portal_password_configured() -> bool:
    return bool((os.environ.get("STAFF_PORTAL_PASSWORD") or "").strip())


def staff_portal_session_minutes() -> int:
    try:
        m = int((os.environ.get("STAFF_PORTAL_SESSION_MINUTES") or "30").strip())
    except ValueError:
        m = 30
    return max(5, min(m, 12 * 60))


def _secret_alg():
    import server as srv

    return srv.SECRET_KEY, srv.ALGORITHM


def create_staff_portal_token(user_id: str) -> str:
    sk, alg = _secret_alg()
    minutes = staff_portal_session_minutes()
    exp = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    return jwt.encode(
        {"sub": str(user_id), "typ": _STAFF_PORTAL_TYP, "exp": exp},
        sk,
        algorithm=alg,
    )


def verify_staff_portal_token(portal_jwt: str, user_id: str) -> bool:
    if not portal_jwt or not user_id:
        return False
    try:
        sk, alg = _secret_alg()
        payload = jwt.decode(portal_jwt, sk, algorithms=[alg])
    except JWTError:
        return False
    if payload.get("typ") != _STAFF_PORTAL_TYP:
        return False
    return str(payload.get("sub") or "") == str(user_id)


def staff_portal_password_matches(given: str) -> bool:
    expected = (os.environ.get("STAFF_PORTAL_PASSWORD") or "").strip()
    if not expected:
        return False
    a = (given or "").encode("utf-8")
    b = expected.encode("utf-8")
    try:
        return hmac.compare_digest(
            hashlib.sha256(a).digest(),
            hashlib.sha256(b).digest(),
        )
    except Exception:
        return False


# Paths that must work without X-Staff-Portal-Token (bootstrap + SPA staff flags).
_STAFF_PORTAL_EXEMPT_PATHS = frozenset(
    {
        "/api/admin/check",
        "/api/admin/whoami",
        "/api/auth/staff-portal-unlock",
    }
)


def _norm_path(path: str) -> str:
    return (path or "").split("?")[0].rstrip("/") or ""


def is_staff_portal_exempt_path(path: str) -> bool:
    return _norm_path(path) in _STAFF_PORTAL_EXEMPT_PATHS
