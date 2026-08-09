# Whack-A-Copper — minigame
# Integrated with mini games weekly leaderboard. Scores are server-verified via hit re-sim.

from datetime import datetime, timezone
import secrets
from typing import List, Optional

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from server import db, get_current_user, _get_staff_user_ids, _is_admin, log_activity, log_minigame_payout
from utils.minigame_captcha_gate import require_turnstile_for_minigame_start
from utils.minigame_security import skip_minigame_session
from utils.minigame_run_session import (
    as_utc_started,
    claim_minigame_run_session,
    get_plays_left,
    start_minigame_run,
    utc_rate_limit_window,
    RATE_LIMIT_PERIOD_HOURS,
)
from utils.whack_a_copper_sim import (
    MAX_SCORE_SANITY,
    normalize_hits,
    simulate_whack_a_copper,
    validate_settings,
)

MAX_PLAYS_PER_HOUR = 10
MIN_PLAY_SECONDS = 3
WHACK_GAME = "whack_a_copper"
MIN_SCORE_FOR_REWARD = 100
CASH_PER_10_POINTS = 1  # $1 per 10 score


class WhackACopperStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    diff: Optional[str] = "medium"
    duration: Optional[int] = 30
    gridSize: Optional[int] = 9
    livesMode: Optional[int] = 3
    captcha_token: Optional[str] = None


class WhackHit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    t_ms: int
    hole: int


class WhackACopperScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Client score is display-only; rewards/leaderboard use server re-sim from hits.
    score: Optional[int] = 0
    session_id: Optional[str] = None
    hits: List[WhackHit] = Field(default_factory=list)
    diff: Optional[str] = None
    duration: Optional[int] = None
    gridSize: Optional[int] = None
    livesMode: Optional[int] = None


def register(router):
    @router.post("/whack-a-copper/start")
    async def whack_a_copper_start(
        body: WhackACopperStartRequest,
        request: Request,
        current_user: dict = Depends(get_current_user),
    ):
        """Open a seeded run; claims must reference session_id and submit hits."""
        await require_turnstile_for_minigame_start(
            db,
            request=request,
            current_user=current_user,
            captcha_token=body.captcha_token,
            is_admin=_is_admin(current_user),
        )
        try:
            settings = validate_settings(
                diff=body.diff,
                duration=body.duration,
                grid_size=body.gridSize,
                lives_mode=body.livesMode,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e) or "Invalid settings.") from e

        seed = secrets.token_hex(16)
        meta = {
            "seed": seed,
            "diff": settings["diff"],
            "duration": str(settings["duration"]),
            "gridSize": str(settings["gridSize"]),
            "livesMode": str(settings["livesMode"]),
        }
        resp = await start_minigame_run(
            db,
            user_id=current_user["id"],
            game=WHACK_GAME,
            meta=meta,
        )
        resp["seed"] = seed
        resp["diff"] = settings["diff"]
        resp["duration"] = settings["duration"]
        resp["gridSize"] = settings["gridSize"]
        resp["livesMode"] = settings["livesMode"]
        return resp

    @router.post("/whack-a-copper/score")
    async def whack_a_copper_score(
        payload: WhackACopperScoreRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Submit hits for a Whack-A-Copper run; server re-sim determines score/rewards."""
        now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now_dt.isoformat().replace("+00:00", "Z")
        hour_start, reset_dt = utc_rate_limit_window(now_dt)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")

        uid = current_user["id"]
        skip_session = skip_minigame_session(_is_admin(current_user))
        session_id = (payload.session_id or "").strip()

        raw_hits = [{"t_ms": h.t_ms, "hole": h.hole} for h in (payload.hits or [])]

        if not skip_session:
            if not session_id:
                raise HTTPException(status_code=400, detail="Start a run before submitting (missing session).")

            # Early structural check (hole upper bound tightened after meta load)
            try:
                normalize_hits(raw_hits, grid_size=12)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e) or "Invalid hits.") from e

            pl = await get_plays_left(db, user_id=uid, game=WHACK_GAME)
            if pl["plays_left"] == 0:
                raise HTTPException(
                    status_code=429,
                    detail=f"Play limit reached ({pl['max_plays']} per {RATE_LIMIT_PERIOD_HOURS}h). Resets at {pl['resets_at']}.",
                )
            sess = await claim_minigame_run_session(
                db, user_id=uid, game=WHACK_GAME, session_id=session_id, now_dt=now_dt
            )
            started_at = as_utc_started(sess.get("started_at"))
            elapsed = max(0.0, (now_dt - started_at).total_seconds())
            if elapsed < MIN_PLAY_SECONDS:
                raise HTTPException(status_code=400, detail="Game too short.")

            sess_meta = sess.get("meta") if isinstance(sess.get("meta"), dict) else {}
            seed = str(sess_meta.get("seed") or "").strip()
            if not seed:
                raise HTTPException(status_code=400, detail="Run seed missing; start a new run.")

            try:
                settings = validate_settings(
                    diff=sess_meta.get("diff"),
                    duration=sess_meta.get("duration"),
                    grid_size=sess_meta.get("gridSize"),
                    lives_mode=sess_meta.get("livesMode"),
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e) or "Invalid run settings.") from e

            if payload.diff is not None and str(payload.diff).strip() and str(payload.diff).strip().lower() != settings["diff"]:
                raise HTTPException(status_code=400, detail="Difficulty does not match this run.")
            if payload.duration is not None and int(payload.duration) != int(settings["duration"]):
                raise HTTPException(status_code=400, detail="Duration does not match this run.")
            if payload.gridSize is not None and int(payload.gridSize) != int(settings["gridSize"]):
                raise HTTPException(status_code=400, detail="Grid size does not match this run.")
            if payload.livesMode is not None and int(payload.livesMode) != int(settings["livesMode"]):
                raise HTTPException(status_code=400, detail="Lives mode does not match this run.")

            try:
                normalize_hits(raw_hits, grid_size=int(settings["gridSize"]))
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e) or "Invalid hits.") from e

            try:
                sim = simulate_whack_a_copper(
                    seed=seed,
                    hits=raw_hits,
                    diff=settings["diff"],
                    duration=settings["duration"],
                    grid_size=settings["gridSize"],
                    lives_mode=settings["livesMode"],
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e) or "Invalid hits.") from e
            score = int(sim.get("score") or 0)
        else:
            # Admin session-skip path: no seed available — do not accept client score.
            score = 0

        if score < 0 or score > MAX_SCORE_SANITY:
            raise HTTPException(status_code=400, detail="Score outside allowed range.")

        result = await db.user_meta.update_one(
            {"user_id": uid, "whack_a_copper_hour_start": hour_start_iso, "whack_a_copper_hour_count": {"$lt": MAX_PLAYS_PER_HOUR}},
            {"$inc": {"whack_a_copper_hour_count": 1}},
        )
        if result.modified_count == 0:
            result = await db.user_meta.update_one(
                {"user_id": uid, "whack_a_copper_hour_start": {"$ne": hour_start_iso}},
                {"$set": {"whack_a_copper_hour_start": hour_start_iso, "whack_a_copper_hour_count": 1}},
                upsert=True,
            )
            if result.modified_count == 0 and result.upserted_id is None:
                remaining = max(0, int((reset_dt - now_dt).total_seconds()))
                raise HTTPException(
                    status_code=429,
                    detail=f"Play limit reached ({MAX_PLAYS_PER_HOUR} per {RATE_LIMIT_PERIOD_HOURS}h). Try again in {remaining}s.",
                )

        cash = 0
        if score >= MIN_SCORE_FOR_REWARD:
            cash = min(5000, (score // 10) * CASH_PER_10_POINTS)

        if cash > 0:
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": {"money": cash}},
            )

        doc = {
            "user_id": current_user["id"],
            "username": current_user.get("username") or "?",
            "score": score,
            "cash": cash,
            "at": now_iso,
        }
        try:
            await db.whack_a_copper_scores.insert_one(doc)
        except Exception:
            pass

        await log_activity(uid, current_user.get("username", "?"), "minigame_whack", {
            "score": score, "cash": cash,
        })
        await log_minigame_payout(uid, current_user.get("username", "?"), "whack_a_copper", score, {"money": cash})

        try:
            from routers.minigames.minigame_leaderboard import log_minigame_play
            await log_minigame_play(
                current_user["id"],
                current_user.get("username"),
                "whack_a_copper",
                score,
            )
        except Exception:
            pass

        plays_info = await get_plays_left(db, user_id=uid, game=WHACK_GAME)
        return {
            "ok": True,
            "score": score,
            "cash": cash,
            "plays_left": plays_info["plays_left"],
            "max_plays": plays_info["max_plays"],
            "resets_at": plays_info["resets_at"],
        }

    @router.get("/whack-a-copper/leaderboard")
    async def whack_a_copper_leaderboard(current_user: dict = Depends(get_current_user)):
        """Get top 10 Whack-A-Copper scores."""
        staff_ids = await _get_staff_user_ids()
        q = {"user_id": {"$nin": staff_ids}} if staff_ids else {}
        cursor = (
            db.whack_a_copper_scores.find(
                q,
                {"_id": 0, "user_id": 1, "username": 1, "score": 1, "at": 1},
            )
            .sort([("score", -1), ("at", 1)])
            .limit(10)
        )
        rows = await cursor.to_list(10)
        me_id = current_user.get("id")
        out = []
        for r in rows:
            out.append({
                "user_id": r.get("user_id"),
                "username": r.get("username") or "?",
                "score": int(r.get("score") or 0),
                "at": r.get("at"),
                "is_me": r.get("user_id") == me_id,
            })
        return {"leaderboard": out}
