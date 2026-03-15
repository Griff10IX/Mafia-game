# The Getaway - Endless runner mini-game
# Escape through city streets after a heist, avoiding cops and collecting cash
# Integrated with mini games weekly leaderboard

from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user

MAX_RUNS_PER_HOUR = 10

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

        now = datetime.now(timezone.utc)
        now_iso = now.isoformat().replace("+00:00", "Z")
        hour_start = now.replace(minute=0, second=0, microsecond=0)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")

        meta = await db.user_meta.find_one(
            {"user_id": current_user["id"]},
            {"_id": 0, "getaway_hour_start": 1, "getaway_hour_count": 1},
        )
        meta_start = (meta or {}).get("getaway_hour_start")
        meta_count = int((meta or {}).get("getaway_hour_count") or 0)

        if meta_start == hour_start_iso:
            if meta_count >= MAX_RUNS_PER_HOUR:
                raise HTTPException(status_code=400, detail=f"Hourly run limit reached ({MAX_RUNS_PER_HOUR}). Try again later.")
            new_count = meta_count + 1
        else:
            new_count = 1

        await db.user_meta.update_one(
            {"user_id": current_user["id"]},
            {
                "$setOnInsert": {"user_id": current_user["id"]},
                "$set": {"getaway_hour_start": hour_start_iso, "getaway_hour_count": new_count},
            },
            upsert=True,
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

        try:
            from routers.minigames.minigame_leaderboard import log_minigame_play
            score = distance + (coins_collected * 50)
            await log_minigame_play(current_user["id"], current_user.get("username"), "the_getaway", score)
        except Exception:
            pass

        return {
            "message": "Clean getaway!",
            "reward": {"cash": cash, "respect": respect},
            "distance": distance,
            "coins_collected": coins_collected,
        }

    @router.get("/the-getaway/leaderboard")
    async def get_getaway_leaderboard(current_user: dict = Depends(get_current_user)):
        """Get top 10 Getaway runs by distance."""
        pipeline = [
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
