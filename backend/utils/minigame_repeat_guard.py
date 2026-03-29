"""Throttle identical minigame claim payloads (anti-bot grinding with hard-coded results)."""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Sequence, Union

from fastapi import HTTPException
from pymongo import ReturnDocument

from utils.minigame_run_session import utc_rate_limit_window, RATE_LIMIT_PERIOD_HOURS

# Same window as hourly play limits; max times you may submit the *exact* same result tuple.
DEFAULT_MAX_IDENTICAL_PER_WINDOW = 6


def _fingerprint(parts: Sequence[Union[str, int, float]]) -> str:
    raw = "|".join(str(p) for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:48]


async def check_identical_payload_spam(
    db,
    *,
    user_id: str,
    game: str,
    parts: Sequence[Union[str, int, float]],
    now: datetime,
    max_identical: int = DEFAULT_MAX_IDENTICAL_PER_WINDOW,
    period_hours: int = RATE_LIMIT_PERIOD_HOURS,
) -> None:
    """Raise HTTPException if user repeats the same claim payload too often in the UTC rate window."""
    window_start, _ = utc_rate_limit_window(now, period_hours=period_hours)
    window_id = window_start.isoformat().replace("+00:00", "Z")
    fp = _fingerprint(parts)
    now_iso = now.replace(microsecond=0).isoformat().replace("+00:00", "Z")

    doc = await db.minigame_identical_claims.find_one_and_update(
        {"user_id": user_id, "game": game, "fp": fp, "window_id": window_id},
        {"$inc": {"n": 1}, "$set": {"updated_at": now_iso}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    n = int((doc or {}).get("n") or 0)
    if n > max_identical:
        raise HTTPException(
            status_code=400,
            detail="Too many identical game results in a short period. If this is a mistake, try again later or vary your run.",
        )
