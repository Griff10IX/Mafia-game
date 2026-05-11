"""Verify Cloudflare Turnstile tokens server-side (minigame start gate)."""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


@dataclass
class TurnstileVerifyResult:
    success: bool
    error_codes: List[str] = field(default_factory=list)
    http_error: Optional[str] = None
    hostname: Optional[str] = None
    action: Optional[str] = None
    cdata: Optional[str] = None
    challenge_ts: Optional[str] = None


async def verify_turnstile_token(
    *,
    secret: str,
    response: str,
    remote_ip: Optional[str] = None,
) -> TurnstileVerifyResult:
    """
    Returns structured result for admin logging and gating.
    `secret` is the server TURNSTILE_SECRET_KEY; `response` is the token from the widget.
    """
    if not secret or not (response or "").strip():
        return TurnstileVerifyResult(success=False, error_codes=["missing-secret-or-response"])
    data = {"secret": secret, "response": (response or "").strip()}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(TURNSTILE_VERIFY_URL, data=data)
        r.raise_for_status()
        body = r.json()
        if body.get("success"):
            return TurnstileVerifyResult(
                success=True,
                hostname=str(body.get("hostname") or "")[:255] or None,
                action=str(body.get("action") or "")[:128] or None,
                cdata=str(body.get("cdata") or "")[:255] or None,
                challenge_ts=str(body.get("challenge_ts") or "")[:80] or None,
            )
        err = body.get("error-codes") or []
        codes = [str(x) for x in err] if isinstance(err, list) else [str(err)]
        logger.info("Turnstile verification failed: %s", codes)
        return TurnstileVerifyResult(
            success=False,
            error_codes=codes,
            hostname=str(body.get("hostname") or "")[:255] or None,
            action=str(body.get("action") or "")[:128] or None,
            cdata=str(body.get("cdata") or "")[:255] or None,
            challenge_ts=str(body.get("challenge_ts") or "")[:80] or None,
        )
    except Exception as ex:
        logger.exception("Turnstile siteverify request failed")
        return TurnstileVerifyResult(success=False, error_codes=["request-error"], http_error=str(ex)[:200])


def turnstile_secret() -> str:
    return (os.environ.get("TURNSTILE_SECRET_KEY") or "").strip()
