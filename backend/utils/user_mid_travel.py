"""Detect in-progress timed travel (user has not yet arrived at destination)."""
from datetime import datetime, timezone
from typing import Any, Mapping, Optional

from fastapi import HTTPException


def user_mid_travel(user: Optional[Mapping[str, Any]]) -> bool:
    """True when traveling_to is set and travel_arrives_at is still in the future."""
    if not user:
        return False
    if not user.get("traveling_to"):
        return False
    raw = user.get("travel_arrives_at")
    if not raw:
        return False
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) < dt
    except Exception:
        return False


def raise_if_user_mid_travel(user: Optional[Mapping[str, Any]], *, detail: Optional[str] = None) -> None:
    if user_mid_travel(user):
        raise HTTPException(
            status_code=400,
            detail=detail or "You are still traveling. Wait until you arrive before playing casino games.",
        )
