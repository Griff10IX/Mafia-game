# The Getaway — endless runner with server-verified re-sim

import logging
from datetime import datetime, timezone
import secrets
from typing import Any, Dict, List, Optional, Union

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from server import db, get_current_user, _get_staff_user_ids, _is_admin, log_activity, log_minigame_payout
from routers.minigames.minigame_leaderboard import log_minigame_play
from utils.minigame_captcha_gate import require_turnstile_for_minigame_start
from utils.minigame_security import skip_minigame_session
from utils.minigame_repeat_guard import check_identical_payload_spam
from utils.minigame_run_session import (
    as_utc_started,
    claim_minigame_run_session,
    get_plays_left,
    start_minigame_run,
    utc_rate_limit_window,
    RATE_LIMIT_PERIOD_HOURS,
)
from utils.getaway_sim import (
    MAX_DISTANCE_SANITY,
    MAX_FRAMES,
    normalize_inputs,
    simulate_getaway,
    validate_preset,
)

MAX_RUNS_PER_HOUR = 10
GETAWAY_GAME = "the_getaway"
MIN_PLAY_SECONDS = 5
MIN_DISTANCE = 50

BASE_CASH = 3_750
BASE_RESPECT = 15
BONUS_PER_100M = 500
BONUS_RESPECT_PER_100M = 2
COIN_TO_CASH = 25
logger = logging.getLogger(__name__)


class GetawayStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    speed_preset: Optional[str] = "normal"
    captcha_token: Optional[str] = None


class GetawayRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Display-only; payouts use server re-sim.
    distance: Optional[int] = 0
    coins_collected: Optional[int] = 0
    time_seconds: Optional[int] = 0
    session_id: Optional[str] = None
    inputs: List[Union[Dict[str, Any], List[Any]]] = Field(default_factory=list)
    ticks: Optional[int] = None
    speed_preset: Optional[str] = None


def register(router):
    @router.post("/the-getaway/start")
    async def getaway_start(
        body: GetawayStartRequest,
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
        try:
            preset = validate_preset(body.speed_preset)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e) or "Invalid preset.") from e

        seed = secrets.token_hex(16)
        meta = {"seed": seed, "speed_preset": preset["id"]}
        resp = await start_minigame_run(
            db,
            user_id=current_user["id"],
            game=GETAWAY_GAME,
            meta=meta,
        )
        resp["seed"] = seed
        resp["speed_preset"] = preset["id"]
        return resp

    @router.post("/the-getaway/run")
    async def submit_getaway_run(body: GetawayRunRequest, current_user: dict = Depends(get_current_user)):
        now = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now.isoformat().replace("+00:00", "Z")
        hour_start, _ = utc_rate_limit_window(now)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")
        uid = current_user["id"]

        skip_session = skip_minigame_session(_is_admin(current_user))
        session_id = (body.session_id or "").strip()

        try:
            normalize_inputs(body.inputs or [])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e) or "Invalid inputs.") from e

        if not skip_session:
            if not session_id:
                raise HTTPException(status_code=400, detail="Start a run before submitting (missing session).")
            pl = await get_plays_left(db, user_id=uid, game=GETAWAY_GAME)
            if pl["plays_left"] == 0:
                raise HTTPException(
                    status_code=429,
                    detail=f"Run limit reached ({pl['max_plays']} per {RATE_LIMIT_PERIOD_HOURS}h). Resets at {pl['resets_at']}.",
                )
            sess = await claim_minigame_run_session(
                db, user_id=uid, game=GETAWAY_GAME, session_id=session_id, now_dt=now
            )
            started_at = as_utc_started(sess.get("started_at"))
            elapsed = max(0.0, (now - started_at).total_seconds())
            if elapsed < MIN_PLAY_SECONDS:
                raise HTTPException(status_code=400, detail="Game too short.")

            sess_meta = sess.get("meta") if isinstance(sess.get("meta"), dict) else {}
            seed = str(sess_meta.get("seed") or "").strip()
            if not seed:
                raise HTTPException(status_code=400, detail="Run seed missing; start a new run.")

            try:
                preset = validate_preset(sess_meta.get("speed_preset"))
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e) or "Invalid run settings.") from e

            if body.speed_preset is not None and str(body.speed_preset).strip() and str(body.speed_preset).strip().lower() != preset["id"]:
                raise HTTPException(status_code=400, detail="Speed preset mismatch with session.")

            try:
                ticks_i = int(body.ticks) if body.ticks is not None else MAX_FRAMES
            except (TypeError, ValueError):
                ticks_i = MAX_FRAMES
            ticks_i = max(1, min(MAX_FRAMES, ticks_i))

            try:
                sim = simulate_getaway(
                    seed=seed,
                    inputs=body.inputs or [],
                    preset_id=preset["id"],
                    ticks=ticks_i,
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e) or "Invalid inputs.") from e

            distance = int(sim.get("distance") or 0)
            coins_collected = int(sim.get("coins") or 0)
            time_seconds = int(elapsed)

            if distance < MIN_DISTANCE:
                raise HTTPException(status_code=400, detail="Run too short to count.")
            if distance > MAX_DISTANCE_SANITY:
                raise HTTPException(status_code=400, detail="Invalid distance.")

            await check_identical_payload_spam(
                db,
                user_id=uid,
                game=GETAWAY_GAME,
                parts=(distance, coins_collected, time_seconds),
                now=now,
            )
        else:
            raise HTTPException(status_code=400, detail="Start a verified run before submitting.")

        result = await db.user_meta.update_one(
            {"user_id": uid, "getaway_hour_start": hour_start_iso, "getaway_hour_count": {"$lt": MAX_RUNS_PER_HOUR}},
            {"$inc": {"getaway_hour_count": 1}},
        )
        if result.modified_count == 0:
            result = await db.user_meta.update_one(
                {"user_id": uid, "getaway_hour_start": {"$ne": hour_start_iso}},
                {"$set": {"getaway_hour_start": hour_start_iso, "getaway_hour_count": 1}},
                upsert=True,
            )
            if result.modified_count == 0 and result.upserted_id is None:
                raise HTTPException(
                    status_code=429,
                    detail=f"Run limit reached ({MAX_RUNS_PER_HOUR} per {RATE_LIMIT_PERIOD_HOURS}h). Try again later.",
                )

        distance_bonus = (distance // 100) * BONUS_PER_100M
        coin_bonus = coins_collected * COIN_TO_CASH
        cash = BASE_CASH + distance_bonus + coin_bonus
        respect_bonus = (distance // 100) * BONUS_RESPECT_PER_100M
        respect = BASE_RESPECT + respect_bonus

        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"money": cash, "respect_points": respect}},
        )

        run_doc = {
            "user_id": current_user["id"],
            "username": current_user.get("username") or "?",
            "distance": distance,
            "coins_collected": coins_collected,
            "time_seconds": time_seconds,
            "cash": cash,
            "respect": respect,
            "created_at": now_iso,
        }
        await db.the_getaway_runs.insert_one(run_doc)

        await log_activity(uid, current_user.get("username", "?"), "minigame_getaway", {
            "distance": distance, "coins": coins_collected, "cash": cash, "respect": respect,
        })
        await log_minigame_payout(
            uid,
            current_user.get("username", "?"),
            "the_getaway",
            distance + (coins_collected * 50),
            {"money": cash, "respect_points": respect},
        )

        try:
            score = distance + (coins_collected * 50)
            await log_minigame_play(current_user["id"], current_user.get("username"), "the_getaway", score)
        except Exception as e:
            logger.warning("the_getaway: failed to log minigame leaderboard play: %s", e)

        plays_info = await get_plays_left(db, user_id=uid, game=GETAWAY_GAME)
        return {
            "message": "Clean getaway!",
            "ok": True,
            "distance": distance,
            "coins_collected": coins_collected,
            "time_seconds": time_seconds,
            "cash": cash,
            "respect": respect,
            "plays_left": plays_info["plays_left"],
            "max_plays": plays_info["max_plays"],
            "resets_at": plays_info["resets_at"],
        }

    @router.get("/the-getaway/leaderboard")
    async def get_getaway_leaderboard(current_user: dict = Depends(get_current_user)):
        staff_ids = await _get_staff_user_ids()
        staff_stage = [{"$match": {"user_id": {"$nin": staff_ids}}}] if staff_ids else []
        pipeline = staff_stage + [
            {"$sort": {"distance": -1, "created_at": 1}},
            {
                "$group": {
                    "_id": "$user_id",
                    "username": {"$first": "$username"},
                    "distance": {"$first": "$distance"},
                    "coins_collected": {"$first": "$coins_collected"},
                    "created_at": {"$first": "$created_at"},
                }
            },
            {"$sort": {"distance": -1}},
            {"$limit": 10},
            {
                "$project": {
                    "_id": 0,
                    "user_id": "$_id",
                    "username": 1,
                    "distance": 1,
                    "coins_collected": 1,
                    "created_at": 1,
                }
            },
        ]
        rows = await db.the_getaway_runs.aggregate(pipeline).to_list(10)
        return {"leaderboard": rows}

    @router.get("/the-getaway/my-stats")
    async def get_my_getaway_stats(current_user: dict = Depends(get_current_user)):
        pipeline = [
            {"$match": {"user_id": current_user["id"]}},
            {
                "$group": {
                    "_id": None,
                    "total_runs": {"$sum": 1},
                    "best_distance": {"$max": "$distance"},
                    "total_distance": {"$sum": "$distance"},
                    "total_coins": {"$sum": "$coins_collected"},
                    "total_cash": {"$sum": {"$ifNull": ["$cash", 0]}},
                }
            },
        ]
        rows = await db.the_getaway_runs.aggregate(pipeline).to_list(1)
        if not rows:
            return {"stats": {"total_runs": 0, "best_distance": 0, "total_distance": 0, "total_coins": 0, "total_cash": 0}}
        row = rows[0]
        return {
            "stats": {
                "total_runs": row.get("total_runs", 0),
                "best_distance": row.get("best_distance", 0),
                "total_distance": row.get("total_distance", 0),
                "total_coins": row.get("total_coins", 0),
                "total_cash": row.get("total_cash", 0),
            }
        }
