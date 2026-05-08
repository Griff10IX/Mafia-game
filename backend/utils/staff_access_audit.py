# Log staff-gated API denials and sensitive auth attempts; inbox-notify admins and moderators (throttled).
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Coroutine, Optional

from jose import jwt
from jose.exceptions import ExpiredSignatureError, JWTError

from utils.jwt_env import is_jwt_secret_placeholder, jwt_secret_from_env

logger = logging.getLogger(__name__)

COLLECTION = "staff_access_denials"
NOTIFY_COOLDOWN_SEC = int((os.environ.get("STAFF_ACCESS_DENIAL_NOTIFY_COOLDOWN_SEC") or "900").strip() or "900")

# Explicit staff tool API families (avoid broad "/admin" matching that can catch non-critical admin-named endpoints).
_STAFF_TOOL_API_PREFIXES = (
    "/api/admin",
    "/api/help-desk/admin-message",
    "/api/notifications/admin",
    "/api/casino/mp-poker/tournaments/admin-settings",
)
_STAFF_TOOL_API_EXACT_EXCLUDE = frozenset(
    {
        # Client-side toast telemetry can be high-volume/noisy; do not emit staff denial inbox alerts for it.
        "/api/admin/toast-events/ingest",
    }
)


def is_staff_tool_api_path(path: str) -> bool:
    """True if URL path is in an explicit staff-gated API family (plus staff portal unlock helper)."""
    raw = (path or "").split("?")[0].rstrip("/") or ""
    if not raw.startswith("/api/"):
        return False
    if raw in _STAFF_TOOL_API_EXACT_EXCLUDE:
        return False
    for pfx in _STAFF_TOOL_API_PREFIXES:
        if raw == pfx or raw.startswith(f"{pfx}/"):
            return True
    # Staff-only auth helpers (same abuse surface as admin tools)
    if raw == "/api/auth/staff-portal-unlock":
        return True
    return False


# Staff-capable users (admin list email or moderator) must use POST /auth/login-staff so JWT includes staff_issued.
_STAFF_JWT_ISSUED_EXEMPT_PATHS = frozenset(
    {
        "/api/auth/staff-flags",
        "/api/admin/whoami",
        "/api/admin/tool-access/report-spa-unauthorized",
        "/api/auth/staff-portal-unlock",
    }
)


def path_requires_staff_issued_jwt(path: str) -> bool:
    """True if this API path needs a staff-login-issued JWT when the user is admin-listed or a moderator."""
    norm = (path or "").split("?")[0].rstrip("/") or ""
    if norm in _STAFF_JWT_ISSUED_EXEMPT_PATHS:
        return False
    return is_staff_tool_api_path(norm)


def decode_jwt_bearer_user(request) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Decode Authorization Bearer JWT for staff-access logging (sub, username, email).

    If the token is only expired (signature still valid), decodes without exp verification
    so staff can still be notified which account attempted the request.
    """
    try:
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return None, None, None
        token = auth_header.split(" ", 1)[1].strip()
        secret = jwt_secret_from_env()
        if is_jwt_secret_placeholder(secret):
            return None, None, None
        try:
            payload = jwt.decode(token, secret, algorithms=["HS256"])
        except ExpiredSignatureError:
            payload = jwt.decode(token, secret, algorithms=["HS256"], options={"verify_exp": False})
        uid = payload.get("sub")
        uid_s = str(uid).strip() if uid is not None else None
        username = (payload.get("username") or "").strip() or None
        email = (payload.get("email") or "").strip() or None
        return (uid_s or None, username, email)
    except (JWTError, Exception):
        return None, None, None


async def _persist_denial_and_notify_staff(
    db,
    *,
    method: str,
    path_for_log: str,
    user_id: Optional[str],
    username: Optional[str],
    email: Optional[str],
    client_ip: Optional[str],
    throttle_path_key: str,
    title: str,
    body: str,
    send_notification: Callable[..., Coroutine[Any, Any, Any]],
    get_notify_user_ids: Callable[..., Coroutine[Any, Any, list]],
) -> None:
    """Insert staff_access_denials row; inbox-notify (throttled per user + throttle_path_key)."""
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    uid = (user_id or "").strip() or None
    uname = (username or "").strip() or "?"
    em = (email or "").strip() or ""
    ip = (client_ip or "").strip() or ""
    tkey = (throttle_path_key or path_for_log)[:2048]

    doc = {
        "id": str(uuid.uuid4()),
        "created_at": now_iso,
        "method": (method or "").upper()[:16],
        "path": path_for_log[:2048],
        "notify_throttle_key": tkey[:2048],
        "user_id": uid,
        "username": uname,
        "email": em,
        "client_ip": ip,
        "admin_notified": False,
    }

    try:
        await db[COLLECTION].insert_one(doc)
    except Exception:
        logger.exception("staff_access_denials insert failed path=%s", path_for_log[:120])
        return

    if not uid:
        return

    cutoff = (now - timedelta(seconds=max(60, NOTIFY_COOLDOWN_SEC))).isoformat()
    try:
        prev = await db[COLLECTION].find_one(
            {
                "user_id": uid,
                "notify_throttle_key": tkey,
                "admin_notified": True,
                "created_at": {"$gte": cutoff},
            },
            {"_id": 1},
        )
    except Exception:
        prev = None
    if prev and prev.get("_id") != doc["id"]:
        return

    try:
        recipient_ids = await get_notify_user_ids(database=db)
    except Exception:
        logger.exception("get_notify_user_ids failed for staff access notify")
        return
    if not recipient_ids:
        return

    for aid in recipient_ids:
        if not aid or str(aid) == uid:
            continue
        try:
            await send_notification(
                str(aid),
                title,
                body,
                "system",
                category="system",
            )
        except Exception:
            logger.warning("staff denial notify failed admin_id=%s", aid)

    try:
        await db[COLLECTION].update_one({"id": doc["id"]}, {"$set": {"admin_notified": True}})
    except Exception:
        pass


async def record_staff_spa_unauthorized_visit(
    db,
    *,
    spa_path: Optional[str],
    user_id: Optional[str],
    username: Optional[str],
    email: Optional[str],
    client_ip: Optional[str],
    send_notification: Callable[..., Coroutine[Any, Any, Any]],
    get_notify_user_ids: Callable[..., Coroutine[Any, Any, list]],
) -> bool:
    """Persist + inbox staff when a signed-in non-staff account loads /staffrole/admin in the SPA (browser route; not gated by staff API 403). Throttled like other denials."""
    uid = (user_id or "").strip() or None
    if not uid:
        return False
    now = datetime.now(timezone.utc)
    tkey = f"spa_staff_admin_url:{uid}"
    dedupe_sec = max(60, SPA_UNAUTHORIZED_REPORT_DEDUPE_SEC)
    try:
        recent = await db[COLLECTION].find_one(
            {
                "user_id": uid,
                "notify_throttle_key": tkey,
                "created_at": {"$gte": (now - timedelta(seconds=dedupe_sec)).isoformat()},
            },
            {"_id": 1},
        )
    except Exception:
        recent = None
    if recent:
        return False
    path_for_log = ((spa_path or "").strip() or "/staffrole/admin")[:2048]
    title = "Non-staff user opened Admin Tools URL"
    body = (
        "A signed-in account without mod/admin access loaded the in-game Admin Tools route in the browser.\n\n"
        f"SPA path: {path_for_log}\n"
        f"User: {(username or '').strip() or '?'} (id {uid})\n"
        f"Email: {(email or '').strip() or '—'}\n"
        f"IP: {(client_ip or '').strip() or '—'}\n\n"
        "They were redirected away; this is often a bookmark, pasted link, or curiosity."
    )
    await _persist_denial_and_notify_staff(
        db,
        method="POST",
        path_for_log=path_for_log,
        user_id=uid,
        username=username,
        email=email,
        client_ip=client_ip,
        throttle_path_key=tkey,
        title=title,
        body=body,
        send_notification=send_notification,
        get_notify_user_ids=get_notify_user_ids,
    )
    return True


async def record_staff_route_forbidden(
    db,
    *,
    method: str,
    path_with_query: str,
    user_id: Optional[str],
    username: Optional[str],
    email: Optional[str],
    client_ip: Optional[str],
    send_notification: Callable[..., Coroutine[Any, Any, Any]],
    get_notify_user_ids: Callable[..., Coroutine[Any, Any, list]],
    inbox_note: Optional[str] = None,
    http_status: int = 403,
) -> None:
    """Persist HTTP denial on staff routes; notify admins + moderators (throttled per user+path)."""
    title = f"Staff tool access denied ({http_status})"
    body = (
        f"{(method or '').upper()[:16]} {path_with_query}\n\n"
        f"User: {(username or '').strip() or '?'} (id {(user_id or '').strip() or '—'})\n"
        f"Email: {(email or '').strip() or '—'}\n"
        f"IP: {(client_ip or '').strip() or '—'}\n\n"
        f"A signed-in account hit this admin/mod endpoint without permission (or session rejected)."
    )
    note = (inbox_note or "").strip()
    if note:
        body = f"{body}\n\n{note}"
    await _persist_denial_and_notify_staff(
        db,
        method=method,
        path_for_log=path_with_query,
        user_id=user_id,
        username=username,
        email=email,
        client_ip=client_ip,
        throttle_path_key=path_with_query[:2048],
        title=title,
        body=body,
        send_notification=send_notification,
        get_notify_user_ids=get_notify_user_ids,
    )


async def record_staff_auth_gate_event(
    db,
    *,
    kind: str,
    path_label: str,
    user_id: Optional[str],
    username: Optional[str],
    email: Optional[str],
    client_ip: Optional[str],
    send_notification: Callable[..., Coroutine[Any, Any, Any]],
    get_notify_user_ids: Callable[..., Coroutine[Any, Any, list]],
    detail: Optional[str] = None,
) -> None:
    """Notify staff on sensitive login routing (e.g. mod using public login URL). Throttled per user + kind."""
    uid = (user_id or "").strip() or None
    if not uid:
        return
    k = (kind or "unknown").strip()[:120] or "unknown"
    throttle_path_key = f"auth:{k}:{uid}"
    path_for_log = path_label[:1900]
    d = (detail or "").strip()
    body = (
        f"Event: {k}\n"
        f"Path: {path_label}\n\n"
        f"User: {(username or '').strip() or '?'} (id {uid})\n"
        f"Email: {(email or '').strip() or '—'}\n"
        f"IP: {(client_ip or '').strip() or '—'}\n"
    )
    if d:
        body = f"{body}\n{d}\n"
    title = "Staff account login / access attempt"
    await _persist_denial_and_notify_staff(
        db,
        method="POST",
        path_for_log=path_for_log,
        user_id=uid,
        username=username,
        email=email,
        client_ip=client_ip,
        throttle_path_key=throttle_path_key,
        title=title,
        body=body,
        send_notification=send_notification,
        get_notify_user_ids=get_notify_user_ids,
    )
