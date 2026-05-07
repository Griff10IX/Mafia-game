# Successful staff/admin API usage and SPA shell opens — persisted for auditing (see middleware/admin_tool_access_log.py).
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

COLLECTION = "admin_tool_access_events"

_LOG_EXEMPT_EXACT = frozenset(
    {
        "/api/admin/check",
        "/api/admin/whoami",
        "/api/admin/presence",
        "/api/admin/presence/heartbeat",
        "/api/admin/tool-access-audit",
        "/api/admin/tool-access/shell-open",
    }
)


def client_ip_from_request(request) -> str:
    cf = (request.headers.get("cf-connecting-ip") or "").strip()
    xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    host = ""
    if request.client:
        host = (request.client.host or "").strip()
    return (cf or xff or host)[:45]


def should_log_successful_staff_tool_request(path: str) -> bool:
    from utils.staff_access_audit import is_staff_tool_api_path

    raw = (path or "").split("?")[0].rstrip("/") or ""
    if raw in _LOG_EXEMPT_EXACT:
        return False
    return is_staff_tool_api_path(raw)


async def record_admin_tool_api_event(
    db,
    *,
    user_id: str,
    username: Optional[str],
    email: Optional[str],
    method: str,
    path: str,
    status_code: int,
    request,
) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "created_at": now_iso,
        "kind": "api",
        "user_id": str(user_id).strip(),
        "username": ((username or "?").strip() or "?")[:200],
        "email": ((email or "").strip())[:320],
        "method": (method or "").upper()[:16],
        "path": ((path or "").split("?")[0])[:2048],
        "status_code": int(status_code),
        "client_ip": client_ip_from_request(request),
    }
    try:
        await db[COLLECTION].insert_one(doc)
    except Exception:
        logger.exception("admin_tool_access_events insert failed path=%s", (path or "")[:120])


async def record_shell_open_event(
    db,
    *,
    user_id: str,
    username: str,
    email: str,
    client_ip: str,
    route_path: Optional[str],
) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    rp = (route_path or "").strip()[:500] or "/staffrole/admin"
    doc = {
        "id": str(uuid.uuid4()),
        "created_at": now_iso,
        "kind": "shell_open",
        "user_id": str(user_id).strip(),
        "username": (username or "?")[:200],
        "email": (email or "")[:320],
        "method": "SPA",
        "path": rp,
        "status_code": 200,
        "client_ip": (client_ip or "")[:45],
    }
    try:
        await db[COLLECTION].insert_one(doc)
    except Exception:
        logger.exception("admin_tool_access_events shell_open insert failed")
