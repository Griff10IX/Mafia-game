# Server-side run sessions for minigames: blocks trivial DevTools replay of score/claim without /start.
from datetime import datetime, timezone, timedelta
import uuid
from typing import Any, Dict, Optional

from fastapi import HTTPException
from pymongo import ReturnDocument

from utils.minigame_security import validate_minigame_session_id

SESSION_MAX_MINUTES = 45

# All entries below: max plays per UTC-aligned window (not per calendar hour).
RATE_LIMIT_PERIOD_HOURS = 2
DEFAULT_PLAYS_PER_WINDOW = 10


def utc_rate_limit_window(now_dt: datetime, *, period_hours: int = RATE_LIMIT_PERIOD_HOURS) -> tuple[datetime, datetime]:
    """Return (window_start, reset_at) in UTC. Window starts on even hour boundaries (0,2,4,...) when period_hours=2."""
    now_floor = now_dt.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    h = now_floor.hour
    block_h = (h // period_hours) * period_hours
    window_start = now_floor.replace(hour=block_h)
    reset_dt = window_start + timedelta(hours=period_hours)
    return window_start, reset_dt


GAME_HOURLY_LIMITS: Dict[str, Dict[str, Any]] = {
    "snake":          {"start_field": "snake_hour_start",          "count_field": "snake_hour_count",          "base_max": 10},
    "gauntlet":       {"start_field": "gauntlet_hour_start",       "count_field": "gauntlet_hour_count",       "base_max": 10},
    "the_getaway":    {"start_field": "getaway_hour_start",        "count_field": "getaway_hour_count",        "base_max": 10},
    "family_run":     {"start_field": "family_run_hour_start",     "count_field": "family_run_hour_count",     "base_max": 10},
    "whack_a_copper": {"start_field": "whack_a_copper_hour_start", "count_field": "whack_a_copper_hour_count", "base_max": 10},
    "mafia_rpg":      {"start_field": "mafia_rpg_hour_start",      "count_field": "mafia_rpg_hour_count",      "base_max": 10},
    "minesweeper":    {"start_field": "minesweeper_hour_start",    "count_field": "minesweeper_hour_count",    "base_max": 10},
    "battleships":    {"start_field": "battleships_hour_start",    "count_field": "battleships_hour_count",    "base_max": 10},
    "shooting_range": {"start_field": "shooting_range_hour_start", "count_field": "shooting_range_hour_count", "base_max": 10},
}


async def get_plays_left(db, *, user_id: str, game: str, extra_max: int = 0) -> dict:
    """Return plays_left, max_plays, resets_at for the game's rate-limit window (see RATE_LIMIT_PERIOD_HOURS)."""
    cfg = GAME_HOURLY_LIMITS.get(game)
    if not cfg:
        return {"plays_left": -1, "max_plays": -1, "resets_at": None}

    now_dt = datetime.now(timezone.utc).replace(microsecond=0)
    hour_start, reset_dt = utc_rate_limit_window(now_dt)
    hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")
    reset_iso = reset_dt.isoformat().replace("+00:00", "Z")

    max_plays = cfg["base_max"] + max(0, extra_max)
    meta = await db.user_meta.find_one(
        {"user_id": user_id},
        {"_id": 0, cfg["start_field"]: 1, cfg["count_field"]: 1},
    )
    meta_start = (meta or {}).get(cfg["start_field"])
    count = int((meta or {}).get(cfg["count_field"]) or 0) if meta_start == hour_start_iso else 0
    plays_left = max(0, max_plays - count)
    return {"plays_left": plays_left, "max_plays": max_plays, "resets_at": reset_iso}


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
    extra_max: int = 0,
    skip_limit_check: bool = False,
) -> dict:
    if not skip_limit_check:
        info = await get_plays_left(db, user_id=user_id, game=game, extra_max=extra_max)
        if info["plays_left"] == 0:
            raise HTTPException(
                status_code=429,
                detail=f"Play limit reached ({info['max_plays']} per {RATE_LIMIT_PERIOD_HOURS}h). Resets at {info['resets_at']}.",
            )

    now_dt = datetime.now(timezone.utc).replace(microsecond=0)
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

    resp: Dict[str, Any] = {
        "session_id": sid,
        "expires_at": expires.isoformat().replace("+00:00", "Z"),
    }
    if not skip_limit_check:
        resp["plays_left"] = info["plays_left"]
        resp["max_plays"] = info["max_plays"]
        resp["resets_at"] = info["resets_at"]
    return resp


async def release_minigame_run(db, session_id: str) -> None:
    """Reset a session's claimed flag so the same session_id can be claimed again.

    Do **not** call this after `claim_minigame_run_session` has succeeded and validation
    fails (too short, score mismatch, rate limit, etc.). Doing so lets bots retry the same
    `session_id` until wall-clock checks pass. Failed post-claim validation must leave the
    session consumed (claimed=True).

    Legitimate uses are rare (e.g. legacy tooling); prefer leaving sessions single-use.
    """
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
    now_dt = now_dt or datetime.now(timezone.utc).replace(microsecond=0)
    now_iso = now_dt.isoformat().replace("+00:00", "Z")
    sid = validate_minigame_session_id(session_id)
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
    max_elapsed_seconds: Optional[float] = None,
) -> int:
    """Upper bound on plausible score from server session start → claim time.

    max_elapsed_seconds: if set, caps wall-clock elapsed so AFK waits cannot inflate
    the allowed score (anti-exploit). Per-game constants should reflect realistic max run length.
    """
    started = as_utc_started(sess.get("started_at"))
    elapsed = max(0.0, (now_dt - started).total_seconds())
    if max_elapsed_seconds is not None:
        elapsed = min(elapsed, float(max_elapsed_seconds))
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
    max_elapsed_seconds: Optional[float] = None,
) -> None:
    """Reject only absurd scores vs per-game cap. Session stays consumed on failure (no release).

    Elapsed-time / rate-based bounds are not applied (Turnstile + run session cover bot abuse).
    rate_per_second, buffer, max_elapsed_seconds are kept for call-site compatibility.
    """
    if score > max_score_cap:
        raise HTTPException(status_code=400, detail="Score outside allowed range.")


async def enforce_client_duration_for_claimed_session(
    db,
    *,
    session_id: str,
    sess: dict,
    now_dt: datetime,
    client_duration_seconds: int,
    max_duration_cap: int,
    slack_seconds: int = 45,
    symmetric: bool = False,
) -> None:
    """Basic duration sanity only; session stays consumed on failure.

    Wall-clock comparison vs server session is not applied (Turnstile + run session).
    slack_seconds / symmetric are kept for call-site compatibility.
    """
    if client_duration_seconds < 1:
        raise HTTPException(status_code=400, detail="Invalid play duration.")
    if client_duration_seconds > max_duration_cap:
        raise HTTPException(status_code=400, detail="Play duration too long.")
