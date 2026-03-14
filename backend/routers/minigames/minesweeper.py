# Minesweeper - Win tracking and leaderboard (fastest times)
# Integrated with mini games weekly leaderboard

from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user

VALID_DIFFICULTIES = ["snitch", "capo", "godfather"]

# 75% reduction for beta
DIFFICULTY_CONFIG = {
    "snitch": {"base_cash": 1_250, "base_respect": 5, "points": 15, "max_time": 600},
    "capo": {"base_cash": 3_750, "base_respect": 15, "points": 30, "max_time": 1200},
    "godfather": {"base_cash": 12_500, "base_respect": 50, "points": 60, "max_time": 1800},
}

MAX_WINS_PER_HOUR = 20


class MinesweeperWinRequest(BaseModel):
    difficulty: str
    time_seconds: int


def register(router):
    @router.post("/minesweeper/win")
    async def submit_minesweeper_win(body: MinesweeperWinRequest, current_user: dict = Depends(get_current_user)):
        """Submit a Minesweeper win. Awards cash/respect and logs to mini games leaderboard."""
        difficulty = (body.difficulty or "").lower().strip()
        if difficulty not in VALID_DIFFICULTIES:
            raise HTTPException(status_code=400, detail=f"Invalid difficulty. Must be one of: {VALID_DIFFICULTIES}")

        time_seconds = int(body.time_seconds or 0)
        if time_seconds < 1:
            raise HTTPException(status_code=400, detail="Invalid time.")

        cfg = DIFFICULTY_CONFIG[difficulty]
        if time_seconds > cfg["max_time"]:
            raise HTTPException(status_code=400, detail="Time exceeds maximum for this difficulty.")

        now = datetime.now(timezone.utc)
        now_iso = now.isoformat().replace("+00:00", "Z")
        hour_start = now.replace(minute=0, second=0, microsecond=0)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")

        meta = await db.user_meta.find_one(
            {"user_id": current_user["id"]},
            {"_id": 0, "minesweeper_hour_start": 1, "minesweeper_hour_count": 1},
        )
        meta_start = (meta or {}).get("minesweeper_hour_start")
        meta_count = int((meta or {}).get("minesweeper_hour_count") or 0)

        if meta_start == hour_start_iso:
            if meta_count >= MAX_WINS_PER_HOUR:
                raise HTTPException(status_code=400, detail=f"Hourly win limit reached ({MAX_WINS_PER_HOUR}). Try again later.")
            new_count = meta_count + 1
        else:
            new_count = 1

        await db.user_meta.update_one(
            {"user_id": current_user["id"]},
            {
                "$setOnInsert": {"user_id": current_user["id"]},
                "$set": {"minesweeper_hour_start": hour_start_iso, "minesweeper_hour_count": new_count},
            },
            upsert=True,
        )

        cash = cfg["base_cash"]
        respect = cfg["base_respect"]

        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"money": cash, "respect_points": respect}},
        )

        win_doc = {
            "user_id": current_user["id"],
            "username": current_user.get("username") or "?",
            "difficulty": difficulty,
            "time_seconds": time_seconds,
            "cash": cash,
            "respect": respect,
            "created_at": now_iso,
        }
        await db.minesweeper_wins.insert_one(win_doc)

        try:
            from routers.minigames.minigame_leaderboard import log_minigame_play
            score = max(1, cfg["max_time"] - time_seconds)
            await log_minigame_play(current_user["id"], current_user.get("username"), "minesweeper", score)
        except Exception:
            pass

        return {
            "message": "Win recorded!",
            "reward": {"cash": cash, "respect": respect},
            "time_seconds": time_seconds,
            "difficulty": difficulty,
        }

    @router.get("/minesweeper/leaderboard")
    async def get_minesweeper_leaderboard(current_user: dict = Depends(get_current_user)):
        """Get top 10 fastest Minesweeper wins across all difficulties."""
        pipeline = [
            {"$sort": {"time_seconds": 1}},
            {
                "$group": {
                    "_id": {"user_id": "$user_id", "difficulty": "$difficulty"},
                    "username": {"$first": "$username"},
                    "time_seconds": {"$first": "$time_seconds"},
                    "created_at": {"$first": "$created_at"},
                }
            },
            {"$sort": {"time_seconds": 1}},
            {"$limit": 10},
            {
                "$project": {
                    "_id": 0,
                    "user_id": "$_id.user_id",
                    "difficulty": "$_id.difficulty",
                    "username": 1,
                    "time_seconds": 1,
                    "created_at": 1,
                }
            },
        ]
        rows = await db.minesweeper_wins.aggregate(pipeline).to_list(10)
        return {"leaderboard": rows}

    @router.get("/minesweeper/my-stats")
    async def get_my_minesweeper_stats(current_user: dict = Depends(get_current_user)):
        """Get current user's best times per difficulty."""
        pipeline = [
            {"$match": {"user_id": current_user["id"]}},
            {
                "$group": {
                    "_id": "$difficulty",
                    "best_time": {"$min": "$time_seconds"},
                    "total_wins": {"$sum": 1},
                }
            },
        ]
        rows = await db.minesweeper_wins.aggregate(pipeline).to_list(10)
        by_difficulty = {r["_id"]: {"best_time": r["best_time"], "total_wins": r["total_wins"]} for r in rows}
        return {"stats": by_difficulty}
