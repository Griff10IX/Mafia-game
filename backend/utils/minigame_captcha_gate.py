"""Optional Turnstile captcha before starting a minigame run (session start)."""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import HTTPException, Request

from utils.captcha_failure_log import log_captcha_turnstile_failure
from utils.captcha_turnstile import turnstile_secret, verify_turnstile_token
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


async def require_turnstile_for_minigame_start(
    db,
    *,
    request: Request,
    current_user: dict,
    captcha_token: Optional[str],
    is_admin: bool = False,
) -> None:
    """
    When main.minigame_turnstile_enabled is True and keys are configured, require a valid token.
    Pass is_admin=True for staff so they can test without solving a widget.
    """
    if is_admin:
        return

    main = await db.game_settings.find_one(
        {"_id": "main"},
        {"_id": 0, "minigame_turnstile_enabled": 1, "minigame_turnstile_site_key": 1},
    )
    enabled = bool(main.get("minigame_turnstile_enabled")) if main else False
    if not enabled:
        return

    site_key = (main.get("minigame_turnstile_site_key") or os.environ.get("TURNSTILE_SITE_KEY") or "").strip()
    secret = turnstile_secret()
    if not site_key or not secret:
        logger.warning("minigame_turnstile enabled but site key or TURNSTILE_SECRET_KEY missing")
        await log_captcha_turnstile_failure(
            db,
            request=request,
            current_user=current_user,
            reason="misconfigured",
            detail="minigame_turnstile enabled but site key or TURNSTILE_SECRET_KEY missing",
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
            current_user=current_user,
            reason="missing_token",
        )
        raise HTTPException(
            status_code=400,
            detail="Complete the captcha before starting a minigame.",
        )

    ip = _client_ip(request)
    vr = await verify_turnstile_token(secret=secret, response=raw, remote_ip=ip or None)
    if not vr.success:
        await log_captcha_turnstile_failure(
            db,
            request=request,
            current_user=current_user,
            reason="verify_failed",
            turnstile_error_codes=vr.error_codes,
            detail=vr.http_error,
        )
        raise HTTPException(status_code=400, detail="Captcha verification failed. Try again.")


async def require_turnstile_for_game_action(
    db,
    *,
    request: Request,
    current_user: dict,
    captcha_token: Optional[str],
    is_admin: bool = False,
) -> None:
    """
    When main.game_actions_turnstile_enabled is True and Turnstile keys are configured,
    require a valid token on selected gameplay POSTs (e.g. GTA melt, booze sell — not crime commits).
    Reuses the minigame public site key and TURNSTILE_SECRET_KEY.
    """
    if is_admin:
        return

    main = await db.game_settings.find_one(
        {"_id": "main"},
        {"_id": 0, "game_actions_turnstile_enabled": 1, "minigame_turnstile_site_key": 1},
    )
    enabled = bool(main.get("game_actions_turnstile_enabled")) if main else False
    if not enabled:
        return

    site_key = (main.get("minigame_turnstile_site_key") or os.environ.get("TURNSTILE_SITE_KEY") or "").strip()
    secret = turnstile_secret()
    if not site_key or not secret:
        logger.warning("game_actions_turnstile enabled but site key or TURNSTILE_SECRET_KEY missing")
        await log_captcha_turnstile_failure(
            db,
            request=request,
            current_user=current_user,
            reason="misconfigured",
            detail="game_actions_turnstile enabled but site key or TURNSTILE_SECRET_KEY missing",
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
            current_user=current_user,
            reason="missing_token",
        )
        raise HTTPException(
            status_code=400,
            detail="Complete the captcha before this action.",
        )

    ip = _client_ip(request)
    vr = await verify_turnstile_token(secret=secret, response=raw, remote_ip=ip or None)
    if not vr.success:
        await log_captcha_turnstile_failure(
            db,
            request=request,
            current_user=current_user,
            reason="verify_failed",
            turnstile_error_codes=vr.error_codes,
            detail=vr.http_error,
        )
        raise HTTPException(status_code=400, detail="Captcha verification failed. Try again.")
