# Battleships (Rum Runner) - Win tracking and leaderboard
# Integrated with mini games weekly leaderboard

from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user

MAX_WINS_PER_HOUR = 15

BASE_CASH = 25_000
BASE_RESPECT = 25
BONUS_PER_SHIP_SAVED = 5_000
BONUS_RESPECT_PER_SHIP = 5
MAX_TIME_SECONDS = 1800


class BattleshipsWinRequest(BaseModel):
    shots_fired: int
    ships_lost: int
    time_seconds: int


def register(router):
    @router.post("/battleships/win")
    async def submit_battleships_win(body: BattleshipsWinRequest, current_user: dict = Depends(get_current_user)):
        """Submit a Battleships win. Awards cash/respect and logs to mini games leaderboard."""
        shots_fired = int(body.shots_fired or 0)
        ships_lost = int(body.ships_lost or 0)
        time_seconds = int(body.time_seconds or 0)

        if shots_fired < 5:
            raise HTTPException(status_code=400, detail="Invalid game data.")
        if ships_lost < 0 or ships_lost > 8:
            raise HTTPException(status_code=400, detail="Invalid ships lost value.")
        if time_seconds < 10:
            raise HTTPException(status_code=400, detail="Game too short.")
        if time_seconds > MAX_TIME_SECONDS:
            raise HTTPException(status_code=400, detail="Game exceeded time limit.")

        now = datetime.now(timezone.utc)
        now_iso = now.isoformat().replace("+00:00", "Z")
        hour_start = now.replace(minute=0, second=0, microsecond=0)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")

        meta = await db.user_meta.find_one(
            {"user_id": current_user["id"]},
            {"_id": 0, "battleships_hour_start": 1, "battleships_hour_count": 1},
        )
        meta_start = (meta or {}).get("battleships_hour_start")
        meta_count = int((meta or {}).get("battleships_hour_count") or 0)

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
                "$set": {"battleships_hour_start": hour_start_iso, "battleships_hour_count": new_count},
            },
            upsert=True,
        )

        ships_saved = 5 - ships_lost
        cash = BASE_CASH + (ships_saved * BONUS_PER_SHIP_SAVED)
        respect = BASE_RESPECT + (ships_saved * BONUS_RESPECT_PER_SHIP)

        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"money": cash, "respect_points": respect}},
        )

        win_doc = {
            "user_id": current_user["id"],
            "username": current_user.get("username") or "?",
            "shots_fired": shots_fired,
            "ships_lost": ships_lost,
            "time_seconds": time_seconds,
            "cash": cash,
            "respect": respect,
            "created_at": now_iso,
        }
        await db.battleships_wins.insert_one(win_doc)

        try:
            from routers.minigame_leaderboard import log_minigame_play
            efficiency_score = max(1, (100 - shots_fired) * 10 + ships_saved * 50)
            await log_minigame_play(current_user["id"], current_user.get("username"), "battleships", efficiency_score)
        except Exception:
            pass

        return {
            "message": "Victory recorded!",
            "reward": {"cash": cash, "respect": respect},
            "shots_fired": shots_fired,
            "ships_lost": ships_lost,
        }

    @router.get("/battleships/leaderboard")
    async def get_battleships_leaderboard(current_user: dict = Depends(get_current_user)):
        """Get top 10 Battleships wins by fewest shots with no ships lost."""
        pipeline = [
            {"$sort": {"shots_fired": 1, "time_seconds": 1}},
            {
                "$group": {
                    "_id": "$user_id",
                    "username": {"$first": "$username"},
                    "shots_fired": {"$first": "$shots_fired"},
                    "ships_lost": {"$first": "$ships_lost"},
                    "time_seconds": {"$first": "$time_seconds"},
                    "created_at": {"$first": "$created_at"},
                }
            },
            {"$sort": {"shots_fired": 1, "time_seconds": 1}},
            {"$limit": 10},
            {
                "$project": {
                    "_id": 0,
                    "user_id": "$_id",
                    "username": 1,
                    "shots_fired": 1,
                    "ships_lost": 1,
                    "time_seconds": 1,
                    "created_at": 1,
                }
            },
        ]
        rows = await db.battleships_wins.aggregate(pipeline).to_list(10)
        return {"leaderboard": rows}

    @router.get("/battleships/my-stats")
    async def get_my_battleships_stats(current_user: dict = Depends(get_current_user)):
        """Get current user's Battleships stats."""
        pipeline = [
            {"$match": {"user_id": current_user["id"]}},
            {
                "$group": {
                    "_id": None,
                    "total_wins": {"$sum": 1},
                    "best_shots": {"$min": "$shots_fired"},
                    "avg_shots": {"$avg": "$shots_fired"},
                    "total_ships_lost": {"$sum": "$ships_lost"},
                    "perfect_games": {"$sum": {"$cond": [{"$eq": ["$ships_lost", 0]}, 1, 0]}},
                }
            },
        ]
        rows = await db.battleships_wins.aggregate(pipeline).to_list(1)
        if not rows:
            return {"stats": {"total_wins": 0, "best_shots": None, "avg_shots": None, "total_ships_lost": 0, "perfect_games": 0}}
        row = rows[0]
        return {
            "stats": {
                "total_wins": row.get("total_wins", 0),
                "best_shots": row.get("best_shots"),
                "avg_shots": round(row.get("avg_shots", 0), 1) if row.get("avg_shots") else None,
                "total_ships_lost": row.get("total_ships_lost", 0),
                "perfect_games": row.get("perfect_games", 0),
            }
        }
