"""Player self-exclusion from casino / sports wagering."""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from datetime import datetime, timezone
from typing import Any, Mapping, Optional, Set

from fastapi import HTTPException

GAMBLING_SELF_BAN_DURATIONS_HOURS = frozenset({12, 24, 48, 72})
_BAN_CODE_PREFIX = "gbc_"


def _ban_code_bucket_seconds() -> int:
    try:
        return max(900, int(os.getenv("GAMBLING_BAN_CODE_BUCKET_SECONDS", "7200") or "7200"))
    except Exception:
        return 7200


def _ban_code_secret() -> bytes:
    try:
        from server import SECRET_KEY
        secret = SECRET_KEY
    except Exception:
        secret = None
    return str(secret or "gambling-ban-code").encode("utf-8", "ignore")


def _ban_code_bucket(now: Optional[float] = None) -> int:
    return int((time.time() if now is None else now) // _ban_code_bucket_seconds())


def _ban_code_field_name(bucket: Optional[int] = None) -> str:
    b = _ban_code_bucket() if bucket is None else int(bucket)
    digest = hmac.new(_ban_code_secret(), f"gambling-ban-field:{b}".encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{_BAN_CODE_PREFIX}{digest[:16]}"


def _accepted_ban_code_field_names() -> Set[str]:
    b = _ban_code_bucket()
    return {_ban_code_field_name(b), _ban_code_field_name(b - 1)}


def _ban_code_value(user_id: str, bucket: Optional[int] = None) -> str:
    b = _ban_code_bucket() if bucket is None else int(bucket)
    digest = hmac.new(
        _ban_code_secret(),
        f"gambling-ban-value:{user_id}:{b}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return digest[:48]


def gambling_ban_code_payload(user_id: str) -> dict:
    name = _ban_code_field_name()
    return {
        "ban_code_name": name,
        "ban_code_bucket": _ban_code_bucket(),
        name: _ban_code_value(user_id),
    }


def valid_gambling_ban_code(user_id: str, submitted: Optional[str]) -> bool:
    s = (submitted or "").strip()
    if len(s) < 16:
        return False
    b = _ban_code_bucket()
    for candidate in (_ban_code_value(user_id, b), _ban_code_value(user_id, b - 1)):
        if hmac.compare_digest(candidate, s):
            return True
    return False


def submitted_gambling_ban_code(body: Optional[Mapping[str, Any]]) -> Optional[str]:
    data = body if isinstance(body, Mapping) else {}
    names = _accepted_ban_code_field_names()
    hinted = data.get("ban_code_name")
    if isinstance(hinted, str) and hinted in names:
        val = data.get(hinted)
        if isinstance(val, str) and len(val.strip()) >= 16:
            return val.strip()
    for name in names:
        val = data.get(name)
        if isinstance(val, str) and len(val.strip()) >= 16:
            return val.strip()
    legacy = data.get("ban_code")
    if isinstance(legacy, str) and len(legacy.strip()) >= 16:
        return legacy.strip()
    return None


def parse_gambling_self_ban_until(user: Optional[Mapping[str, Any]]) -> Optional[datetime]:
    if not user:
        return None
    until = user.get("gambling_self_ban_until")
    if not until:
        return None
    try:
        dt = datetime.fromisoformat(str(until).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def is_gambling_self_banned(user: Optional[Mapping[str, Any]], now: Optional[datetime] = None) -> bool:
    until = parse_gambling_self_ban_until(user)
    if until is None:
        return False
    n = now or datetime.now(timezone.utc)
    if n.tzinfo is None:
        n = n.replace(tzinfo=timezone.utc)
    return n < until


def gambling_self_ban_remaining_seconds(user: Optional[Mapping[str, Any]], now: Optional[datetime] = None) -> int:
    until = parse_gambling_self_ban_until(user)
    if until is None:
        return 0
    n = now or datetime.now(timezone.utc)
    if n.tzinfo is None:
        n = n.replace(tzinfo=timezone.utc)
    return max(0, int((until - n).total_seconds()))


def gambling_self_ban_status_payload(
    user: Optional[Mapping[str, Any]],
    now: Optional[datetime] = None,
    *,
    include_ban_code: bool = False,
) -> dict:
    n = now or datetime.now(timezone.utc)
    until = parse_gambling_self_ban_until(user)
    active = bool(until and n < until)
    remaining = gambling_self_ban_remaining_seconds(user, n) if active else 0
    out = {
        "active": active,
        "until": until.isoformat() if active and until else None,
        "remaining_seconds": remaining,
        "allowed_duration_hours": sorted(GAMBLING_SELF_BAN_DURATIONS_HOURS),
    }
    if include_ban_code:
        uid = str((user or {}).get("id") or "")
        if uid:
            out.update(gambling_ban_code_payload(uid))
    return out


def raise_if_gambling_self_banned(user: Optional[Mapping[str, Any]], now: Optional[datetime] = None) -> None:
    if not is_gambling_self_banned(user, now):
        return
    remaining = gambling_self_ban_remaining_seconds(user, now)
    hours = remaining // 3600
    mins = (remaining % 3600) // 60
    if hours > 0:
        left = f"{hours}h {mins}m"
    else:
        left = f"{max(1, mins)}m"
    raise HTTPException(
        status_code=403,
        detail=(
            f"You have an active gambling self-exclusion ({left} remaining). "
            "Casino and sports betting are blocked until it expires. "
            "You can still buy and sell points and use Quick Trade. "
            "Staff will not remove this ban."
        ),
    )
