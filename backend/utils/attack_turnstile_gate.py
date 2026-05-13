"""Attack-page-only Turnstile gate with short-lived nonce binding."""
from __future__ import annotations

import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, FrozenSet, List, Optional

from fastapi import HTTPException, Request

from utils.captcha_failure_log import log_captcha_turnstile_failure
from utils.captcha_turnstile import turnstile_secret, verify_turnstile_token
from utils.ip_normalize import normalize_ip_string

logger = logging.getLogger(__name__)

ATTACK_TURNSTILE_NONCES_COLLECTION = "attack_turnstile_nonces"
ATTACK_TURNSTILE_DEFAULT_MODE = "execute_only"
ATTACK_TURNSTILE_DEFAULT_ENFORCE = "off"
ATTACK_TURNSTILE_NONCE_TTL_SECONDS = 180
ATTACK_TURNSTILE_RISK_SCORE_THRESHOLD = 35
ATTACK_TURNSTILE_VALID_MODES = {"execute_only", "search_and_execute", "risk_based"}
ATTACK_TURNSTILE_VALID_ENFORCE = {"off", "log_only", "enforce"}
ATTACK_TURNSTILE_TARGET_USERNAMES_MAX = 200
ATTACK_TURNSTILE_TARGET_USERNAME_MAX_LEN = 80


def _attack_turnstile_target_usernames_lower(raw: Any) -> FrozenSet[str]:
    """Lowercased usernames from stored list or string; used for rollout scoping."""
    parts: List[str] = []
    if raw is None:
        return frozenset()
    if isinstance(raw, str):
        parts = [p.strip() for p in re.split(r"[\s,;|]+", raw) if p.strip()]
    elif isinstance(raw, list):
        parts = [str(p).strip() for p in raw if str(p).strip()]
    else:
        return frozenset()
    seen: set[str] = set()
    out: List[str] = []
    for p in parts[:ATTACK_TURNSTILE_TARGET_USERNAMES_MAX]:
        if len(p) > ATTACK_TURNSTILE_TARGET_USERNAME_MAX_LEN:
            p = p[: ATTACK_TURNSTILE_TARGET_USERNAME_MAX_LEN]
        sl = p.lower()
        if sl in seen:
            continue
        seen.add(sl)
        out.append(sl)
    return frozenset(out)


def attack_turnstile_target_usernames_list_for_admin(raw: Any) -> List[str]:
    """Deduped display list for admin settings (case-insensitive uniqueness)."""
    if raw is None:
        return []
    if isinstance(raw, str):
        parts = [p.strip() for p in re.split(r"[\s,;|]+", raw) if p.strip()]
    elif isinstance(raw, list):
        parts = [str(p).strip() for p in raw if str(p).strip()]
    else:
        return []
    seen: set[str] = set()
    out: List[str] = []
    for p in parts[:ATTACK_TURNSTILE_TARGET_USERNAMES_MAX]:
        if len(p) > ATTACK_TURNSTILE_TARGET_USERNAME_MAX_LEN:
            p = p[:ATTACK_TURNSTILE_TARGET_USERNAME_MAX_LEN]
        sl = p.lower()
        if sl in seen:
            continue
        seen.add(sl)
        out.append(p)
    return out


def _env_disabled() -> bool:
    return (os.environ.get("ATTACK_TURNSTILE_DISABLED") or "").strip().lower() in ("1", "true", "yes", "on")


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


def _clean_mode(raw: Any) -> str:
    mode = str(raw or ATTACK_TURNSTILE_DEFAULT_MODE).strip().lower()
    return mode if mode in ATTACK_TURNSTILE_VALID_MODES else ATTACK_TURNSTILE_DEFAULT_MODE


def _clean_enforce(raw: Any) -> str:
    val = str(raw or ATTACK_TURNSTILE_DEFAULT_ENFORCE).strip().lower()
    if val in ("enabled", "on", "true", "1"):
        return "enforce"
    return val if val in ATTACK_TURNSTILE_VALID_ENFORCE else ATTACK_TURNSTILE_DEFAULT_ENFORCE


async def attack_turnstile_config(db, *, current_user: Optional[dict] = None) -> Dict[str, Any]:
    main = await db.game_settings.find_one(
        {"_id": "main"},
        {
            "_id": 0,
            "attack_turnstile_enabled": 1,
            "attack_turnstile_master_disabled": 1,
            "attack_turnstile_mode": 1,
            "attack_turnstile_enforce": 1,
            "attack_turnstile_target_usernames": 1,
            "minigame_turnstile_site_key": 1,
        },
    )
    main = main or {}
    site_key = (main.get("minigame_turnstile_site_key") or os.environ.get("TURNSTILE_SITE_KEY") or "").strip()
    configured = bool(site_key and turnstile_secret())
    master_disabled = bool(main.get("attack_turnstile_master_disabled")) or _env_disabled()
    enabled = bool(main.get("attack_turnstile_enabled")) and not master_disabled
    enforce = _clean_enforce(main.get("attack_turnstile_enforce"))
    if enforce == "off":
        enabled = False
    targets_lc = _attack_turnstile_target_usernames_lower(main.get("attack_turnstile_target_usernames"))
    target_rollout = bool(targets_lc)
    if target_rollout and current_user is not None:
        uname_lc = ((current_user.get("username") or "").strip().lower())[:ATTACK_TURNSTILE_TARGET_USERNAME_MAX_LEN]
        if uname_lc not in targets_lc:
            enabled = False
    return {
        "enabled": enabled,
        "configured": configured,
        "site_key": site_key if enabled and configured else "",
        "mode": _clean_mode(main.get("attack_turnstile_mode")),
        "enforce": enforce,
        "master_disabled": master_disabled,
        "env_disabled": _env_disabled(),
        "nonce_ttl_seconds": ATTACK_TURNSTILE_NONCE_TTL_SECONDS,
        "risk_score_threshold": ATTACK_TURNSTILE_RISK_SCORE_THRESHOLD,
        "target_rollout_active": target_rollout,
    }


def attack_turnstile_required_for_action(config: Dict[str, Any], *, action: str, risk_score: int = 0) -> bool:
    if not config.get("enabled"):
        return False
    mode = _clean_mode(config.get("mode"))
    if action == "execute":
        return mode in ("execute_only", "search_and_execute") or (mode == "risk_based" and int(risk_score or 0) >= ATTACK_TURNSTILE_RISK_SCORE_THRESHOLD)
    if action == "search":
        return mode == "search_and_execute" or (mode == "risk_based" and int(risk_score or 0) >= ATTACK_TURNSTILE_RISK_SCORE_THRESHOLD)
    return False


async def issue_attack_turnstile_nonce(db, *, current_user: dict, action: str, risk_score: int = 0) -> Dict[str, Any]:
    cfg = await attack_turnstile_config(db, current_user=current_user)
    action = (action or "").strip().lower()
    if action not in ("search", "execute"):
        raise HTTPException(status_code=400, detail="Invalid attack Turnstile action")
    required = attack_turnstile_required_for_action(cfg, action=action, risk_score=risk_score)
    if not required:
        return {"required": False, **cfg}
    if not cfg.get("configured"):
        if cfg.get("enforce") == "enforce":
            raise HTTPException(status_code=503, detail="Attack captcha is enabled but Turnstile keys are not configured.")
        return {"required": False, "misconfigured": True, **cfg}
    now = datetime.now(timezone.utc)
    nonce = secrets.token_urlsafe(24)
    await db[ATTACK_TURNSTILE_NONCES_COLLECTION].insert_one(
        {
            "id": str(uuid.uuid4()),
            "nonce": nonce,
            "user_id": str(current_user.get("id") or ""),
            "username": (current_user.get("username") or "")[:120],
            "action": action,
            "created_at": now,
            "expires_at": now + timedelta(seconds=ATTACK_TURNSTILE_NONCE_TTL_SECONDS),
        }
    )
    return {"required": True, "nonce": nonce, **cfg}


async def _consume_nonce(db, *, user_id: str, action: str, nonce: str) -> tuple[bool, str]:
    raw = (nonce or "").strip()
    if len(raw) < 16:
        return False, "missing_nonce"
    now = datetime.now(timezone.utc)
    row = await db[ATTACK_TURNSTILE_NONCES_COLLECTION].find_one_and_update(
        {
            "nonce": raw,
            "user_id": str(user_id or ""),
            "action": action,
            "consumed_at": {"$exists": False},
            "expires_at": {"$gt": now},
        },
        {"$set": {"consumed_at": now}},
    )
    if not row:
        return False, "nonce_invalid_or_replayed"
    return True, ""


async def require_attack_turnstile(
    db,
    *,
    request: Request,
    current_user: dict,
    action: str,
    captcha_token: Optional[str],
    captcha_nonce: Optional[str],
    risk_score: int = 0,
) -> Dict[str, Any]:
    cfg = await attack_turnstile_config(db, current_user=current_user)
    action = (action or "").strip().lower()
    if action not in ("search", "execute"):
        return {"required": False, "allowed": True, "reason": "invalid_action"}
    required = attack_turnstile_required_for_action(cfg, action=action, risk_score=risk_score)
    if not required:
        return {"required": False, "allowed": True, "reason": "not_required", "config": cfg}

    enforce = _clean_enforce(cfg.get("enforce"))
    if not cfg.get("configured"):
        await log_captcha_turnstile_failure(
            db,
            request=request,
            current_user=current_user,
            reason="misconfigured",
            detail="attack_turnstile enabled but site key or TURNSTILE_SECRET_KEY missing",
        )
        if enforce == "enforce":
            raise HTTPException(status_code=503, detail="Attack captcha is enabled but the server is not fully configured.")
        return {"required": True, "allowed": True, "reason": "misconfigured", "config": cfg}

    raw_token = (captcha_token or "").strip()
    raw_nonce = (captcha_nonce or "").strip()
    if not raw_token:
        await log_captcha_turnstile_failure(db, request=request, current_user=current_user, reason="missing_token", detail=f"attack_{action}")
        if enforce == "enforce":
            raise HTTPException(status_code=400, detail="Complete the security check before using the attack page.")
        return {"required": True, "allowed": True, "reason": "missing_token", "config": cfg}

    ok_nonce, nonce_reason = await _consume_nonce(db, user_id=str(current_user.get("id") or ""), action=action, nonce=raw_nonce)
    if not ok_nonce:
        await log_captcha_turnstile_failure(db, request=request, current_user=current_user, reason=nonce_reason, detail=f"attack_{action}")
        if enforce == "enforce":
            raise HTTPException(status_code=400, detail="Security check expired. Try again.")
        return {"required": True, "allowed": True, "reason": nonce_reason, "config": cfg}

    expected_cf_action = f"attack_{action}"
    vr = await verify_turnstile_token(secret=turnstile_secret(), response=raw_token, remote_ip=_client_ip(request) or None)
    if not vr.success:
        await log_captcha_turnstile_failure(
            db,
            request=request,
            current_user=current_user,
            reason="verify_failed",
            turnstile_error_codes=vr.error_codes,
            detail=vr.http_error or expected_cf_action,
        )
        if enforce == "enforce":
            raise HTTPException(status_code=400, detail="Security check failed. Try again.")
        return {"required": True, "allowed": True, "reason": "verify_failed", "config": cfg}

    meta_failures = []
    if vr.action != expected_cf_action:
        meta_failures.append(f"action:{vr.action or 'missing'}")
    if vr.cdata != raw_nonce:
        meta_failures.append("cdata_mismatch")
    if meta_failures:
        await log_captcha_turnstile_failure(
            db,
            request=request,
            current_user=current_user,
            reason="metadata_mismatch",
            detail=",".join(meta_failures)[:500],
        )
        if enforce == "enforce":
            raise HTTPException(status_code=400, detail="Security check did not match this attack action. Try again.")

    return {
        "required": True,
        "allowed": True,
        "reason": "verified" if not meta_failures else "metadata_mismatch",
        "config": cfg,
        "turnstile": {
            "hostname": vr.hostname,
            "action": vr.action,
            "cdata": vr.cdata,
            "challenge_ts": vr.challenge_ts,
        },
    }
