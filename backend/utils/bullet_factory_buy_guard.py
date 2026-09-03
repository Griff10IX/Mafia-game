"""Bullet factory buy ticket + 6h lock only for definite script clients.

Hidden rotating field (same idea as kill execute code). Players never type it.
Wrong/missing token from a real browser: reload. Do not lock.
6h lock only for known script User-Agents (curl, python-requests, etc.) or empty UA.
"""
from __future__ import annotations

import hmac
import hashlib
import logging
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Mapping, Optional, Set, Tuple

from utils.jwt_env import jwt_secret_from_env
from utils.login_user_agent import login_user_agent_blocked, obvious_script_client

logger = logging.getLogger(__name__)

GHOSTFACE_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
LOCK_HOURS = 6
TICKET_TTL_SECONDS = 45 * 60
TICKET_FIELD = "bf_lot_ticket"
TICKET_AT_FIELD = "bf_lot_ticket_at"
CODE_FIELD = "bf_buy_code"
CODE_AT_FIELD = "bf_buy_code_at"
LOCK_FIELD = "bullet_factory_bot_buy_until"

_BUY_CODE_PREFIX = "bfc_"
_HINT_PREFIX = "bfn_"
_BUY_CODE_NAME_KEY = "buy_code_name"
_HONEYPOT_KEYS = ("buy_code",)

_RELOAD_DETAIL = "Reload the factory and try again."
_LOCKED_DETAIL = "You can't buy factory bullets right now. Try again later."


def is_definite_script_ua(headers: Mapping[str, str]) -> Tuple[bool, str]:
    """True only for known automation UAs / empty UA. Not missing Sec-Fetch or short UA shape."""
    ua = ""
    for k, v in headers.items():
        if k.lower() == "user-agent":
            ua = (v or "").strip()
            break
    blocked, reason = login_user_agent_blocked(ua)
    if blocked and (reason == "empty_user_agent" or reason.startswith("marker:")):
        return True, reason
    return False, ""


def is_definite_block_reason(reason: str) -> bool:
    r = (reason or "").strip()
    return r == "empty_user_agent" or r.startswith("marker:")


def factory_client_blocked(headers: Mapping[str, str]) -> Tuple[bool, str]:
    """True if this request is not a normal browser fetch. Used on factory GET (no ticket) and buy."""
    return obvious_script_client(headers)


def _parse_utc(iso) -> Optional[datetime]:
    if not iso:
        return None
    if isinstance(iso, datetime):
        dt = iso
    else:
        try:
            dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        except Exception:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def factory_buy_lock_until(db, user_id: str) -> Optional[datetime]:
    if not user_id:
        return None
    u = await db.users.find_one({"id": user_id}, {"_id": 0, LOCK_FIELD: 1})
    until = _parse_utc((u or {}).get(LOCK_FIELD))
    if until and datetime.now(timezone.utc) < until:
        return until
    return None


async def apply_factory_buy_lock(db, user_id: Optional[str], *, reason: str = "") -> None:
    if not user_id or user_id == GHOSTFACE_ID or user_id == "system_ai":
        return
    until = datetime.now(timezone.utc) + timedelta(hours=LOCK_HOURS)
    await db.users.update_one(
        {"id": user_id},
        {"$set": {LOCK_FIELD: until.isoformat()}},
    )
    logger.warning("bullet factory 6h buy lock user=%s reason=%s until=%s", user_id, reason, until.isoformat())


async def maybe_lock_factory_buy_from_request(db, request, reason: str) -> None:
    if not is_definite_block_reason(reason):
        return
    try:
        from utils.staff_bot_client_alert import decode_bearer_sub

        uid = decode_bearer_sub(request.headers.get("authorization"))
        await apply_factory_buy_lock(db, uid, reason=reason)
    except Exception:
        logger.exception("factory buy lock from request failed")


def _buy_code_bucket_seconds() -> int:
    try:
        return max(900, int(os.getenv("FACTORY_BUY_CODE_BUCKET_SECONDS", "7200") or "7200"))
    except Exception:
        return 7200


def buy_code_bucket(now: Optional[float] = None) -> int:
    return int((time.time() if now is None else now) // _buy_code_bucket_seconds())


def buy_code_field_name(bucket: Optional[int] = None) -> str:
    b = buy_code_bucket() if bucket is None else int(bucket)
    secret = str(jwt_secret_from_env() or "factory-buy-code").encode("utf-8", "ignore")
    digest = hmac.new(secret, f"factory-buy-field:{b}".encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{_BUY_CODE_PREFIX}{digest[:16]}"


def buy_code_hint_key(bucket: Optional[int] = None) -> str:
    b = buy_code_bucket() if bucket is None else int(bucket)
    secret = str(jwt_secret_from_env() or "factory-buy-code").encode("utf-8", "ignore")
    digest = hmac.new(secret, f"factory-buy-hint:{b}".encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{_HINT_PREFIX}{digest[:12]}"


def accepted_buy_code_field_names() -> Set[str]:
    b = buy_code_bucket()
    return {buy_code_field_name(b), buy_code_field_name(b - 1)}


def accepted_buy_code_hint_keys() -> Set[str]:
    b = buy_code_bucket()
    return {buy_code_hint_key(b), buy_code_hint_key(b - 1)}


def buy_code_payload(token: str) -> Dict[str, Any]:
    name = buy_code_field_name()
    hint = buy_code_hint_key()
    return {
        hint: name,
        name: token,
    }


def honeypot_filled(body: Mapping[str, Any]) -> bool:
    if not isinstance(body, dict):
        return False
    for key in _HONEYPOT_KEYS:
        val = body.get(key)
        if isinstance(val, str) and val.strip():
            return True
    return False


def submitted_rotating_buy_token(body: Mapping[str, Any]) -> Optional[str]:
    if not isinstance(body, dict):
        return None
    names = accepted_buy_code_field_names()
    for hint_key in accepted_buy_code_hint_keys():
        hinted = body.get(hint_key)
        if isinstance(hinted, str) and hinted in names:
            val = body.get(hinted)
            if isinstance(val, str) and len(val.strip()) >= 16:
                return val.strip()
    hinted = body.get(_BUY_CODE_NAME_KEY)
    if isinstance(hinted, str) and hinted in names:
        val = body.get(hinted)
        if isinstance(val, str) and len(val.strip()) >= 16:
            return val.strip()
    for name in names:
        val = body.get(name)
        if isinstance(val, str) and len(val.strip()) >= 16:
            return val.strip()
    return None


async def issue_lot_ticket(db, user_id: str) -> str:
    gate = await issue_buy_gate(db, user_id)
    return gate["lot_ticket"]


async def issue_buy_gate(db, user_id: str) -> dict:
    """Fresh hidden ticket. Rotates every factory page load. Not shown to players."""
    token = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {TICKET_FIELD: token, TICKET_AT_FIELD: now},
            "$unset": {CODE_FIELD: "", CODE_AT_FIELD: ""},
        },
    )
    return {"lot_ticket": token}


async def check_lot_ticket(db, user_id: str, token: Optional[str]) -> Optional[str]:
    """Return fail reason or None if the ticket is valid. Does not consume or lock."""
    got = (token or "").strip()
    if not got:
        return "missing"
    u = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, TICKET_FIELD: 1, TICKET_AT_FIELD: 1},
    )
    stored = str((u or {}).get(TICKET_FIELD) or "")
    if not stored:
        return "invalid"
    try:
        match = secrets.compare_digest(stored, got)
    except Exception:
        match = False
    if not match:
        return "invalid"
    issued = _parse_utc((u or {}).get(TICKET_AT_FIELD))
    age = (datetime.now(timezone.utc) - issued).total_seconds() if issued else None
    if age is None or age > TICKET_TTL_SECONDS:
        return "expired"
    return None
