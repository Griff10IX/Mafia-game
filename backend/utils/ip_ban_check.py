"""Shared IP ban enforcement (SecurityMiddleware + get_current_user).

Ensures banned IPs are blocked before account-locked / other auth-derived 403s.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse

from utils.ip_normalize import normalize_ip_string

logger = logging.getLogger(__name__)

IP_BAN_DETAIL = "Your IP has been banned from this server."
IP_BAN_CODE = "ip_banned"
_REASON_MAX = 400
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def client_ip_from_request(request: Request) -> str:
    """Same resolution as SecurityMiddleware (CF-Connecting-IP, X-Forwarded-For, then client)."""
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


def sanitize_ip_ban_reason(raw: Any) -> str:
    s = str(raw or "")
    s = _TAG_RE.sub("", s)
    s = s.replace("\r", " ").replace("\n", " ")
    s = _WS_RE.sub(" ", s).strip()
    if len(s) > _REASON_MAX:
        s = s[:_REASON_MAX].rstrip()
    return s


def ip_ban_payload(ban: Optional[dict] = None) -> Dict[str, Any]:
    """Public 403 body. String `detail` kept for existing clients; no staff/IP fields."""
    out: Dict[str, Any] = {
        "detail": IP_BAN_DETAIL,
        "code": IP_BAN_CODE,
    }
    reason = sanitize_ip_ban_reason((ban or {}).get("reason"))
    if reason:
        out["reason"] = reason
    expires_at = (ban or {}).get("expires_at")
    if expires_at:
        out["expires_at"] = str(expires_at)
    return out


async def active_ip_ban(db, client_ip: str) -> Optional[dict]:
    """Active ban doc for this IP, or None. Deactivates expired bans."""
    if not client_ip:
        return None
    try:
        ban = await db.ip_bans.find_one(
            {"ip": client_ip, "active": True},
            {"_id": 0, "expires_at": 1, "reason": 1},
        )
        if not ban:
            return None
        expires_at = ban.get("expires_at")
        if expires_at:
            try:
                exp = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) >= exp:
                    await db.ip_bans.update_many(
                        {"ip": client_ip, "active": True},
                        {"$set": {"active": False}},
                    )
                    return None
            except Exception:
                return ban
        return ban
    except Exception as e:
        logger.warning("IP ban check failed: %s", e)
        return None


async def json_response_if_ip_banned(db, client_ip: str) -> Optional[JSONResponse]:
    """Return 403 JSON if this IP is actively banned; None if allowed."""
    ban = await active_ip_ban(db, client_ip)
    if not ban:
        return None
    return JSONResponse(status_code=403, content=ip_ban_payload(ban))


async def raise_http_if_ip_banned(db, request: Request) -> None:
    """403 with IP ban payload if client IP is banned (before account_locked and other user checks)."""
    ban = await active_ip_ban(db, client_ip_from_request(request))
    if ban is None:
        return
    # FastAPI wraps this as {"detail": <payload>}; parseIpBanFromError accepts both shapes.
    raise HTTPException(status_code=403, detail=ip_ban_payload(ban))
