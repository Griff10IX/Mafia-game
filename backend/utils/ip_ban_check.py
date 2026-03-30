"""Shared IP ban enforcement (SecurityMiddleware + get_current_user).

Ensures banned IPs are blocked before account-locked / other auth-derived 403s.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse

from utils.ip_normalize import normalize_ip_string

logger = logging.getLogger(__name__)

IP_BAN_DETAIL = "Your IP has been banned from this server."


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


async def json_response_if_ip_banned(db, client_ip: str) -> Optional[JSONResponse]:
    """Return 403 JSON if this IP is actively banned; None if allowed. Deactivates expired bans."""
    if not client_ip:
        return None
    try:
        ban = await db.ip_bans.find_one(
            {"ip": client_ip, "active": True},
            {"_id": 0, "expires_at": 1},
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
                return JSONResponse(status_code=403, content={"detail": IP_BAN_DETAIL})
            return JSONResponse(status_code=403, content={"detail": IP_BAN_DETAIL})
        return JSONResponse(status_code=403, content={"detail": IP_BAN_DETAIL})
    except Exception as e:
        logger.warning("IP ban check failed: %s", e)
        return None


async def raise_http_if_ip_banned(db, request: Request) -> None:
    """403 with IP ban message if client IP is banned (runs before account_locked and other user checks)."""
    resp = await json_response_if_ip_banned(db, client_ip_from_request(request))
    if resp is not None:
        raise HTTPException(status_code=403, detail=IP_BAN_DETAIL)
