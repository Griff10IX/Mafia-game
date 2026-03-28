# The Getaway - Endless runner mini-game
# Escape through city streets after a heist, avoiding cops and collecting cash
# Integrated with mini games weekly leaderboard

from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user, _get_staff_user_ids, _is_admin, log_activity, log_minigame_payout
from utils.minigame_run_session import (
    as_utc_started,
    claim_minigame_run_session,
    enforce_client_duration_for_claimed_session,
    release_minigame_run,
)

MAX_RUNS_PER_HOUR = 10
GETAWAY_GAME = "the_getaway"
# Server-side plausibility vs client-reported time.
# Real max: ~43 dist/sec at max speed 18; ~2-3 coins/sec collecting perfectly.
GETAWAY_MAX_M_PER_SEC = 55
GETAWAY_MAX_COINS_PER_SEC = 5
GETAWAY_DISTANCE_SLACK = 200
GETAWAY_COINS_SLACK = 30

# 75% reduction for beta
BASE_CASH = 3_750
BASE_RESPECT = 15
BONUS_PER_100M = 500
BONUS_RESPECT_PER_100M = 2
COIN_TO_CASH = 25
MIN_DISTANCE = 50
MAX_DISTANCE = 50000


class GetawayRunRequest(BaseModel):
    distance: int
    coins_collected: int
    time_seconds: int
    session_id: Optional[str] = None


def register(router):
    @router.post("/the-getaway/run")
    async def submit_getaway_run(body: GetawayRunRequest, current_user: dict = Depends(get_current_user)):
        """Submit a Getaway run. Awards cash/respect based on distance and coins collected."""
        distance = int(body.distance or 0)
        coins_collected = int(body.coins_collected or 0)
        time_seconds = int(body.time_seconds or 0)

        if distance < MIN_DISTANCE:
            raise HTTPException(status_code=400, detail="Run too short to count.")
        if distance > MAX_DISTANCE:
            raise HTTPException(status_code=400, detail="Invalid distance.")
        if coins_collected < 0 or coins_collected > 1000:
            raise HTTPException(status_code=400, detail="Invalid coins value.")
        if time_seconds < 5:
            raise HTTPException(status_code=400, detail="Game too short.")
        if time_seconds > 3600:
            raise HTTPException(status_code=400, detail="Game exceeded time limit.")

        now = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now.isoformat().replace("+00:00", "Z")
        hour_start = now.replace(minute=0, second=0, microsecond=0)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")

        uid = current_user["id"]

        skip_session = _is_admin(current_user)
        session_id = (body.session_id or "").strip()
        if not skip_session:
            if not session_id:
                raise HTTPException(status_code=400, detail="Start a run before submitting (missing session).")
            sess = await claim_minigame_run_session(
                db, user_id=uid, game=GETAWAY_GAME, session_id=session_id, now_dt=now
            )
            await enforce_client_duration_for_claimed_session(
                db,
                session_id=session_id,
                sess=sess,
                now_dt=now,
                client_duration_seconds=time_seconds,
                max_duration_cap=3600,
                slack_seconds=45,
            )
            started_at = as_utc_started(sess.get("started_at"))
            elapsed = max(0.0, (now - started_at).total_seconds())
            max_dist = int(elapsed * GETAWAY_MAX_M_PER_SEC) + GETAWAY_DISTANCE_SLACK
            max_coins = int(elapsed * GETAWAY_MAX_COINS_PER_SEC) + GETAWAY_COINS_SLACK
            if distance > max_dist or coins_collected > max_coins:
                await release_minigame_run(db, session_id)
                raise HTTPException(
                    status_code=400,
                    detail="Run stats do not match server session timing.",
                )

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
                if not skip_session and session_id:
                    await release_minigame_run(db, session_id)
                raise HTTPException(status_code=429, detail=f"Hourly run limit reached ({MAX_RUNS_PER_HOUR}). Try again later.")

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
        await log_minigame_payout(uid, current_user.get("username", "?"), "the_getaway", distance + (coins_collected * 50), {"money": cash, "respect_points": respect})

        try:
            from routers.minigames.minigame_leaderboard import log_minigame_play
            score = distance + (coins_collected * 50)
            await log_minigame_play(current_user["id"], current_user.get("username"), "the_getaway", score)
        except Exception:
            pass

        return {
            "message": "Clean getaway!",
            "ok": True,
            "distance": distance,
            "coins_collected": coins_collected,
        }

    @router.get("/the-getaway/leaderboard")
    async def get_getaway_leaderboard(current_user: dict = Depends(get_current_user)):
        """Get top 10 Getaway runs by distance."""
        staff_ids = await _get_staff_user_ids()
        staff_stage = [{"$match": {"user_id": {"$nin": staff_ids}}}] if staff_ids else []
        pipeline = staff_stage + [
            {"$sort": {"distance": -1, "coins_collected": -1}},
            {
                "$group": {
                    "_id": "$user_id",
                    "username": {"$first": "$username"},
                    "distance": {"$max": "$distance"},
                    "coins_collected": {"$first": "$coins_collected"},
                    "time_seconds": {"$first": "$time_seconds"},
                    "created_at": {"$first": "$created_at"},
                }
            },
            {"$sort": {"distance": -1, "coins_collected": -1}},
            {"$limit": 10},
            {
                "$project": {
                    "_id": 0,
                    "user_id": "$_id",
                    "username": 1,
                    "distance": 1,
                    "coins_collected": 1,
                    "time_seconds": 1,
                    "created_at": 1,
                }
            },
        ]
        rows = await db.the_getaway_runs.aggregate(pipeline).to_list(10)
        return {"leaderboard": rows}

    @router.get("/the-getaway/my-stats")
    async def get_my_getaway_stats(current_user: dict = Depends(get_current_user)):
        """Get current user's Getaway stats."""
        pipeline = [
            {"$match": {"user_id": current_user["id"]}},
            {
                "$group": {
                    "_id": None,
                    "total_runs": {"$sum": 1},
                    "best_distance": {"$max": "$distance"},
                    "avg_distance": {"$avg": "$distance"},
                    "total_coins": {"$sum": "$coins_collected"},
                    "total_cash_earned": {"$sum": "$cash"},
                }
            },
        ]
        rows = await db.the_getaway_runs.aggregate(pipeline).to_list(1)
        if not rows:
            return {"stats": {"total_runs": 0, "best_distance": None, "avg_distance": None, "total_coins": 0, "total_cash_earned": 0}}
        row = rows[0]
        return {
            "stats": {
                "total_runs": row.get("total_runs", 0),
                "best_distance": row.get("best_distance"),
                "avg_distance": round(row.get("avg_distance", 0), 1) if row.get("avg_distance") else None,
                "total_coins": row.get("total_coins", 0),
                "total_cash_earned": row.get("total_cash_earned", 0),
            }
        }
