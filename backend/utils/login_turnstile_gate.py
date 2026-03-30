"""Optional Cloudflare Turnstile before /auth/login (public)."""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import HTTPException, Request

from utils.captcha_failure_log import log_captcha_turnstile_failure
from utils.captcha_turnstile import turnstile_secret, verify_turnstile_token
from utils.ip_normalize import normalize_ip_string

logger = logging.getLogger(__name__)

_ANON_USER: dict = {}


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


def login_turnstile_effective_config(main: Optional[dict]) -> tuple[bool, str]:
    """
    Returns (effective_enabled, site_key_for_client).
    effective is True only when flag on, site key present, and TURNSTILE_SECRET_KEY set.
    """
    if not main or not bool(main.get("login_turnstile_enabled")):
        return False, ""
    site_key = (main.get("minigame_turnstile_site_key") or os.environ.get("TURNSTILE_SITE_KEY") or "").strip()
    secret_ok = bool((os.environ.get("TURNSTILE_SECRET_KEY") or "").strip())
    if not site_key or not secret_ok:
        return False, ""
    return True, site_key


async def require_turnstile_for_login(
    db,
    *,
    request: Request,
    captcha_token: Optional[str],
) -> None:
    """
    When main.login_turnstile_enabled is True and keys are configured, require a valid token.
    Staff route must not call this.
    """
    main = await db.game_settings.find_one(
        {"_id": "main"},
        {
            "_id": 0,
            "login_turnstile_enabled": 1,
            "minigame_turnstile_site_key": 1,
        },
    )
    if not main or not bool(main.get("login_turnstile_enabled")):
        return

    site_key = (main.get("minigame_turnstile_site_key") or os.environ.get("TURNSTILE_SITE_KEY") or "").strip()
    secret = turnstile_secret()
    if not site_key or not secret:
        logger.warning("login_turnstile enabled but site key or TURNSTILE_SECRET_KEY missing")
        await log_captcha_turnstile_failure(
            db,
            request=request,
            current_user=_ANON_USER,
            reason="misconfigured",
            detail="login_turnstile enabled but site key or TURNSTILE_SECRET_KEY missing",
        )
        raise HTTPException(
            status_code=503,
            detail="Captcha is enabled but the server is not fully configured (TURNSTILE_SECRET_KEY and site key).",
        )

    raw = (captcha_token or "").strip()
    if not raw:
        await log_captcha_turnstile_failure(
            db,
            request=request,
            current_user=_ANON_USER,
            reason="missing_token",
        )
        raise HTTPException(
            status_code=400,
            detail="Complete the captcha before logging in.",
        )

    ip = _client_ip(request)
    vr = await verify_turnstile_token(secret=secret, response=raw, remote_ip=ip or None)
    if not vr.success:
        await log_captcha_turnstile_failure(
            db,
            request=request,
            current_user=_ANON_USER,
            reason="verify_failed",
            turnstile_error_codes=vr.error_codes,
            detail=vr.http_error,
        )
        raise HTTPException(status_code=400, detail="Captcha verification failed. Try again.")
