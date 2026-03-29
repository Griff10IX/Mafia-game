"""Persist Turnstile / minigame captcha failures for admin review."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import Request

from utils.ip_normalize import normalize_ip_string

logger = logging.getLogger(__name__)


def _client_ip(request: Request) -> str:
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        n = normalize_ip_string(cf_ip)
        if n:
            return n
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        n = normalize_ip_string(forwarded)
        if n:
            return n
    if request.client:
        return normalize_ip_string(request.client.host or "") or ""
    return ""

CAPTCHA_TURNSTILE_FAILURES_COLLECTION = "captcha_turnstile_failures"


async def log_captcha_turnstile_failure(
    db,
    *,
    request: Request,
    current_user: dict,
    reason: str,
    turnstile_error_codes: Optional[List[str]] = None,
    detail: Optional[str] = None,
) -> None:
    """
    Best-effort insert; never raises to callers (captcha path must stay reliable).

    reason: missing_token | verify_failed | misconfigured
    """
    try:
        uid = current_user.get("id")
        ua = (request.headers.get("user-agent") or "")[:500]
        path = request.url.path if request.url else ""
        method = request.method or ""
        ip = _client_ip(request)[:64]
        doc: Dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "user_id": str(uid) if uid is not None else "",
            "username": (current_user.get("username") or "")[:120],
            "reason": (reason or "")[:64],
            "path": path[:300],
            "method": method[:16],
            "ip": ip,
            "user_agent": ua,
            "turnstile_error_codes": [str(x)[:80] for x in (turnstile_error_codes or [])][:20],
            "detail": (detail or "")[:500] if detail else None,
        }
        await db[CAPTCHA_TURNSTILE_FAILURES_COLLECTION].insert_one(doc)
    except Exception:
        logger.exception("captcha_turnstile_failure log insert failed")
