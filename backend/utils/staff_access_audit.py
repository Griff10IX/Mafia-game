# Log HTTP 403 responses on /api/.../admin/... routes; notify full admins (inbox), throttled per user+path.
import logging
import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Coroutine, Optional

logger = logging.getLogger(__name__)

COLLECTION = "staff_access_denials"
NOTIFY_COOLDOWN_SEC = int((os.environ.get("STAFF_ACCESS_DENIAL_NOTIFY_COOLDOWN_SEC") or "900").strip() or "900")


def is_staff_tool_api_path(path: str) -> bool:
    """True if URL path looks like a staff/admin tool under /api (matches segment 'admin')."""
    if not path.startswith("/api/"):
        return False
    return bool(re.search(r"/admin(?:/|$)", path))


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
    get_admin_user_ids: Callable[..., Coroutine[Any, Any, list]],
) -> None:
    """Persist denial row; inbox-notify each admin at most once per (user_id, path) per cooldown window."""
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    uid = (user_id or "").strip() or None
    uname = (username or "").strip() or "?"
    em = (email or "").strip() or ""
    ip = (client_ip or "").strip() or ""

    doc = {
        "id": str(uuid.uuid4()),
        "created_at": now_iso,
        "method": (method or "").upper()[:16],
        "path": path_with_query[:2048],
        "user_id": uid,
        "username": uname,
        "email": em,
        "client_ip": ip,
        "admin_notified": False,
    }

    try:
        await db[COLLECTION].insert_one(doc)
    except Exception:
        logger.exception("staff_access_denials insert failed path=%s", path_with_query[:120])
        return

    if not uid:
        return

    cutoff = (now - timedelta(seconds=max(60, NOTIFY_COOLDOWN_SEC))).isoformat()
    try:
        prev = await db[COLLECTION].find_one(
            {
                "user_id": uid,
                "path": path_with_query[:2048],
                "admin_notified": True,
                "created_at": {"$gte": cutoff},
            },
            {"_id": 1},
        )
    except Exception:
        prev = None
    if prev and prev.get("_id") != doc["id"]:
        # Another row already triggered notify recently — still logged above.
        return

    try:
        admin_ids = await get_admin_user_ids(database=db)
    except Exception:
        logger.exception("get_admin_user_ids failed for staff access notify")
        return
    if not admin_ids:
        return

    title = "Staff tool access denied (403)"
    body = (
        f"{doc['method']} {path_with_query}\n\n"
        f"User: {uname} (id {uid})\n"
        f"Email: {em or '—'}\n"
        f"IP: {ip or '—'}\n\n"
        f"A signed-in account without permission tried this admin/mod endpoint."
    )
    for aid in admin_ids:
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
