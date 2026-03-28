# Server-side run sessions for minigames: blocks trivial DevTools replay of score/claim without /start.
from datetime import datetime, timezone, timedelta
import uuid
from typing import Any, Dict, Optional

from fastapi import HTTPException
from pymongo import ReturnDocument

SESSION_MAX_MINUTES = 45


def as_utc_started(started: Any) -> datetime:
    if started is None:
        return datetime.now(timezone.utc)
    if isinstance(started, datetime):
        if started.tzinfo is None:
            return started.replace(tzinfo=timezone.utc)
        return started.astimezone(timezone.utc)
    return datetime.now(timezone.utc)


async def start_minigame_run(
    db,
    *,
    user_id: str,
    game: str,
    meta: Optional[Dict[str, Any]] = None,
) -> dict:
    now_dt = datetime.now(timezone.utc)
    sid = str(uuid.uuid4())
    expires = now_dt + timedelta(minutes=SESSION_MAX_MINUTES)
    doc: Dict[str, Any] = {
        "id": sid,
        "user_id": user_id,
        "game": game,
        "started_at": now_dt,
        "expires_at": expires,
        "claimed": False,
    }
    if meta:
        safe: Dict[str, str] = {}
        for k, v in list(meta.items())[:12]:
            if v is None:
                continue
            safe[str(k)[:32]] = str(v)[:128]
        doc["meta"] = safe
    await db.minigame_run_sessions.insert_one(doc)
    return {
        "session_id": sid,
        "expires_at": expires.isoformat().replace("+00:00", "Z"),
    }


async def release_minigame_run(db, session_id: str) -> None:
    if not session_id:
        return
    await db.minigame_run_sessions.update_one(
        {"id": session_id},
        {"$set": {"claimed": False}, "$unset": {"claimed_at": ""}},
    )


async def assert_active_minigame_run_session(
    db,
    *,
    user_id: str,
    game: str,
    session_id: str,
    now_dt: Optional[datetime] = None,
) -> dict:
    """Valid session, not expired, not claimed — does not mark claimed (for games that submit multiple times per run)."""
    now_dt = now_dt or datetime.now(timezone.utc).replace(microsecond=0)
    sid = (session_id or "").strip()
    if not sid:
        raise HTTPException(
            status_code=400,
            detail="Missing run session. Start the game from the game screen first.",
        )
    sess = await db.minigame_run_sessions.find_one(
        {
            "id": sid,
            "user_id": user_id,
            "game": game,
            "claimed": False,
            "expires_at": {"$gte": now_dt},
        }
    )
    if not sess:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired run session. Start a new game.",
        )
    return sess


async def claim_minigame_run_session(
    db,
    *,
    user_id: str,
    game: str,
    session_id: str,
    now_dt: Optional[datetime] = None,
) -> dict:
    if not (session_id or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Missing run session. Start the game from the game screen first.",
        )
    now_dt = now_dt or datetime.now(timezone.utc).replace(microsecond=0)
    now_iso = now_dt.isoformat().replace("+00:00", "Z")
    sid = session_id.strip()
    sess = await db.minigame_run_sessions.find_one_and_update(
        {
            "id": sid,
            "user_id": user_id,
            "game": game,
            "claimed": False,
            "expires_at": {"$gte": now_dt},
        },
        {"$set": {"claimed": True, "claimed_at": now_iso}},
        return_document=ReturnDocument.BEFORE,
    )
    if not sess:
        raise HTTPException(
            status_code=400,
            detail="Invalid, expired, or already used run session. Start a new game.",
        )
    return sess


def max_numeric_score_for_session(
    sess: dict,
    *,
    now_dt: datetime,
    max_score_cap: int,
    rate_per_second: float,
    buffer: int,
) -> int:
    started = as_utc_started(sess.get("started_at"))
    elapsed = max(0.0, (now_dt - started).total_seconds())
    max_for_time = int(elapsed * rate_per_second) + buffer
    return min(max_score_cap, max_for_time)


async def enforce_numeric_score_for_claimed_session(
    db,
    *,
    session_id: str,
    sess: dict,
    now_dt: datetime,
    score: int,
    max_score_cap: int,
    rate_per_second: float,
    buffer: int,
) -> None:
    max_allowed = max_numeric_score_for_session(
        sess,
        now_dt=now_dt,
        max_score_cap=max_score_cap,
        rate_per_second=rate_per_second,
        buffer=buffer,
    )
    if score > max_allowed:
        await release_minigame_run(db, session_id)
        raise HTTPException(status_code=400, detail="Score does not match server run timing.")


async def enforce_client_duration_for_claimed_session(
    db,
    *,
    session_id: str,
    sess: dict,
    now_dt: datetime,
    client_duration_seconds: int,
    max_duration_cap: int,
    slack_seconds: int = 45,
) -> None:
    if client_duration_seconds < 1:
        await release_minigame_run(db, session_id)
        raise HTTPException(status_code=400, detail="Invalid play duration.")
    if client_duration_seconds > max_duration_cap:
        await release_minigame_run(db, session_id)
        raise HTTPException(status_code=400, detail="Play duration too long.")
    started = as_utc_started(sess.get("started_at"))
    elapsed = max(0.0, (now_dt - started).total_seconds())
    if client_duration_seconds > elapsed + slack_seconds:
        await release_minigame_run(db, session_id)
        raise HTTPException(
            status_code=400,
            detail="Reported play time does not match server session.",
        )
