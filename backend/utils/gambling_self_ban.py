"""Player self-exclusion from casino / sports wagering."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping, Optional

from fastapi import HTTPException

GAMBLING_SELF_BAN_DURATIONS_HOURS = frozenset({12, 24, 48, 72})


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


def gambling_self_ban_status_payload(user: Optional[Mapping[str, Any]], now: Optional[datetime] = None) -> dict:
    n = now or datetime.now(timezone.utc)
    until = parse_gambling_self_ban_until(user)
    active = bool(until and n < until)
    remaining = gambling_self_ban_remaining_seconds(user, n) if active else 0
    return {
        "active": active,
        "until": until.isoformat() if active and until else None,
        "remaining_seconds": remaining,
        "allowed_duration_hours": sorted(GAMBLING_SELF_BAN_DURATIONS_HOURS),
    }


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
