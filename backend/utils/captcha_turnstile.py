"""Verify Cloudflare Turnstile tokens server-side (minigame start gate)."""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def verify_turnstile_token(
    *,
    secret: str,
    response: str,
    remote_ip: Optional[str] = None,
) -> bool:
    """
    Returns True if Turnstile accepts the token.
    `secret` is the server TURNSTILE_SECRET_KEY; `response` is the token from the widget.
    """
    if not secret or not (response or "").strip():
        return False
    data = {"secret": secret, "response": (response or "").strip()}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(TURNSTILE_VERIFY_URL, data=data)
        r.raise_for_status()
        body = r.json()
        if body.get("success"):
            return True
        err = body.get("error-codes") or []
        logger.info("Turnstile verification failed: %s", err)
        return False
    except Exception:
        logger.exception("Turnstile siteverify request failed")
        return False


def turnstile_secret() -> str:
    return (os.environ.get("TURNSTILE_SECRET_KEY") or "").strip()
