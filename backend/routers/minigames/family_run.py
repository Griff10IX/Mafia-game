# Family Run — endless runner with server-verified re-sim
from datetime import datetime, timezone
import secrets
import uuid
from typing import Any, Dict, List, Optional, Union

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from server import db, get_current_user, log_activity, log_minigame_payout, log_respect_earned, _get_staff_user_ids, _is_admin
from utils.minigame_captcha_gate import require_turnstile_for_minigame_start
from utils.minigame_security import skip_minigame_session
from routers.minigames.minigame_leaderboard import log_minigame_play
from utils.minigame_run_session import (
    as_utc_started,
    claim_minigame_run_session,
    get_plays_left,
    start_minigame_run,
    utc_rate_limit_window,
    RATE_LIMIT_PERIOD_HOURS,
)
from utils.family_run_sim import MAX_FRAMES, MAX_SCORE_SANITY, normalize_inputs, simulate_family_run


MAX_PLAYS_PER_HOUR = 10
MIN_PLAY_SECONDS = 3
FAMILY_RUN_GAME = "family_run"

REWARD_CAPS = {
    "cash": 10_000,
    "respect": 50,
}


class FamilyRunStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    captcha_token: Optional[str] = None


class FamilyRunScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Display-only; payouts use server re-sim.
    score: Optional[int] = 0
    coins: Optional[int] = 0
    session_id: Optional[str] = None
    inputs: List[Union[Dict[str, Any], List[Any]]] = Field(default_factory=list)
    ticks: Optional[int] = None


async def _apply_rewards(user_id: str, score: int, coins: int) -> Dict[str, Any]:
    inc = {}
    cash_from_distance = min(REWARD_CAPS["cash"], (score // 100) * 10)
    cash_from_coins = min(2000, coins // 10)
    total_cash = cash_from_distance + cash_from_coins
    if total_cash > 0:
        inc["money"] = total_cash
    respect = min(REWARD_CAPS["respect"], score // 200)
    if respect > 0:
        inc["respect_points"] = respect
    applied = dict(inc)
    if inc:
        await db.users.update_one({"id": user_id}, {"$inc": inc})
        if inc.get("respect_points"):
            await log_respect_earned(user_id, inc["respect_points"], "family_run")
    return applied


def register(router):
    @router.get("/family-run/leaderboard")
    async def family_run_leaderboard(current_user: dict = Depends(get_current_user)):
        staff_ids = await _get_staff_user_ids()
        q = {"user_id": {"$nin": staff_ids}} if staff_ids else {}
        cursor = db.family_run_scores.find(
            q,
            {"_id": 0, "user_id": 1, "username": 1, "score": 1, "at": 1},
        ).sort([("score", -1), ("at", 1)]).limit(10)
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

    @router.post("/family-run/start")
    async def family_run_start(
        body: FamilyRunStartRequest,
        request: Request,
        current_user: dict = Depends(get_current_user),
    ):
        await require_turnstile_for_minigame_start(
            db,
            request=request,
            current_user=current_user,
            captcha_token=body.captcha_token,
            is_admin=_is_admin(current_user),
        )
        seed = secrets.token_hex(16)
        resp = await start_minigame_run(
            db,
            user_id=current_user["id"],
            game=FAMILY_RUN_GAME,
            meta={"seed": seed},
        )
        resp["seed"] = seed
        return resp

    @router.post("/family-run/score")
    async def family_run_score(payload: FamilyRunScoreRequest, current_user: dict = Depends(get_current_user)):
        now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now_dt.isoformat().replace("+00:00", "Z")
        hour_start, reset_dt = utc_rate_limit_window(now_dt)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")
        reset_iso = reset_dt.isoformat().replace("+00:00", "Z")
        uid = current_user["id"]

        skip_session = skip_minigame_session(_is_admin(current_user))
        session_id = (payload.session_id or "").strip()

        try:
            normalize_inputs(payload.inputs or [])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e) or "Invalid inputs.") from e

        if not skip_session:
            if not session_id:
                raise HTTPException(status_code=400, detail="Start a game before submitting (missing session).")
            pl = await get_plays_left(db, user_id=uid, game=FAMILY_RUN_GAME)
            if pl["plays_left"] == 0:
                raise HTTPException(
                    status_code=429,
                    detail=f"Play limit reached ({pl['max_plays']} per {RATE_LIMIT_PERIOD_HOURS}h). Resets at {pl['resets_at']}.",
                )
            sess = await claim_minigame_run_session(
                db, user_id=uid, game=FAMILY_RUN_GAME, session_id=session_id, now_dt=now_dt
            )
            started_at = as_utc_started(sess.get("started_at"))
            elapsed = max(0.0, (now_dt - started_at).total_seconds())
            if elapsed < MIN_PLAY_SECONDS:
                raise HTTPException(status_code=400, detail="Game too short.")

            sess_meta = sess.get("meta") if isinstance(sess.get("meta"), dict) else {}
            seed = str(sess_meta.get("seed") or "").strip()
            if not seed:
                raise HTTPException(status_code=400, detail="Run seed missing; start a new run.")

            ticks = payload.ticks
            try:
                ticks_i = int(ticks) if ticks is not None else MAX_FRAMES
            except (TypeError, ValueError):
                ticks_i = MAX_FRAMES
            ticks_i = max(1, min(MAX_FRAMES, ticks_i))

            try:
                sim = simulate_family_run(seed=seed, inputs=payload.inputs or [], ticks=ticks_i)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e) or "Invalid inputs.") from e
            score = int(sim.get("score") or 0)
            coins = int(sim.get("coins") or 0)
        else:
            raise HTTPException(status_code=400, detail="Start a verified run before submitting.")

        if score < 0 or score > MAX_SCORE_SANITY:
            raise HTTPException(status_code=400, detail="Score outside allowed range.")

        result = await db.user_meta.update_one(
            {"user_id": uid, "family_run_hour_start": hour_start_iso, "family_run_hour_count": {"$lt": MAX_PLAYS_PER_HOUR}},
            {"$inc": {"family_run_hour_count": 1}},
        )
        if result.modified_count == 0:
            result = await db.user_meta.update_one(
                {"user_id": uid, "family_run_hour_start": {"$ne": hour_start_iso}},
                {"$set": {"family_run_hour_start": hour_start_iso, "family_run_hour_reset_at": reset_iso, "family_run_hour_count": 1}},
                upsert=True,
            )
            if result.modified_count == 0 and result.upserted_id is None:
                remaining = max(0, int((reset_dt - now_dt).total_seconds()))
                raise HTTPException(
                    status_code=429,
                    detail=f"Play limit reached ({MAX_PLAYS_PER_HOUR} per {RATE_LIMIT_PERIOD_HOURS}h). Try again in {remaining}s.",
                )

        rewards_applied = await _apply_rewards(current_user["id"], score, coins)

        doc = {
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "username": current_user.get("username") or "?",
            "score": score,
            "coins": coins,
            "at": now_iso,
        }
        try:
            await db.family_run_scores.insert_one(doc)
        except Exception:
            pass

        try:
            await log_minigame_play(current_user["id"], current_user.get("username"), "family_run", score)
        except Exception:
            pass

        try:
            await log_activity(
                current_user["id"],
                current_user.get("username", "?"),
                "minigame_family_run",
                {"score": score, "coins": coins, **rewards_applied},
            )
        except Exception:
            pass

        try:
            await log_minigame_payout(current_user["id"], current_user.get("username", "?"), "family_run", score, rewards_applied)
        except Exception:
            pass

        plays_info = await get_plays_left(db, user_id=current_user["id"], game=FAMILY_RUN_GAME)
        return {
            "ok": True,
            "score": score,
            "coins": coins,
            "plays_left": plays_info["plays_left"],
            "max_plays": plays_info["max_plays"],
            "resets_at": plays_info["resets_at"],
        }
