# Battleships (Rum Runner) - Win tracking and leaderboard
# Integrated with mini games weekly leaderboard

from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user, _get_staff_user_ids, _is_admin
from utils.minigame_run_session import (
    claim_minigame_run_session,
    enforce_client_duration_for_claimed_session,
    release_minigame_run,
)

BATTLESHIPS_GAME = "battleships"

MAX_WINS_PER_HOUR = 10

# 75% reduction for beta
BASE_CASH = 6_250
BASE_RESPECT = 25
BONUS_PER_SHIP_SAVED = 1_250
BONUS_RESPECT_PER_SHIP = 5
MAX_TIME_SECONDS = 1800


class BattleshipsWinRequest(BaseModel):
    shots_fired: int
    ships_lost: int
    time_seconds: int
    fleet_size: int = 5
    difficulty: str = "normal"
    session_id: Optional[str] = None


def register(router):
    @router.post("/battleships/win")
    async def submit_battleships_win(body: BattleshipsWinRequest, current_user: dict = Depends(get_current_user)):
        """Submit a Battleships win. Awards cash/respect and logs to mini games leaderboard."""
        shots_fired = int(body.shots_fired or 0)
        ships_lost = int(body.ships_lost or 0)
        time_seconds = int(body.time_seconds or 0)
        fleet_size = max(2, min(8, int(body.fleet_size or 5)))
        difficulty = body.difficulty if body.difficulty in ("easy", "normal", "hard") else "normal"

        if shots_fired < fleet_size:
            raise HTTPException(status_code=400, detail="Invalid game data.")
        if ships_lost < 0 or ships_lost > fleet_size:
            raise HTTPException(status_code=400, detail="Invalid ships lost value.")
        if time_seconds < 10:
            raise HTTPException(status_code=400, detail="Game too short.")
        if time_seconds > MAX_TIME_SECONDS:
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
                raise HTTPException(status_code=400, detail="Start a game before submitting (missing session).")
            sess = await claim_minigame_run_session(
                db, user_id=uid, game=BATTLESHIPS_GAME, session_id=session_id, now_dt=now
            )
            await enforce_client_duration_for_claimed_session(
                db,
                session_id=session_id,
                sess=sess,
                now_dt=now,
                client_duration_seconds=time_seconds,
                max_duration_cap=MAX_TIME_SECONDS,
                slack_seconds=45,
            )

        result = await db.user_meta.update_one(
            {"user_id": uid, "battleships_hour_start": hour_start_iso, "battleships_hour_count": {"$lt": MAX_WINS_PER_HOUR}},
            {"$inc": {"battleships_hour_count": 1}},
        )
        if result.modified_count == 0:
            result = await db.user_meta.update_one(
                {"user_id": uid, "battleships_hour_start": {"$ne": hour_start_iso}},
                {"$set": {"battleships_hour_start": hour_start_iso, "battleships_hour_count": 1}},
                upsert=True,
            )
            if result.modified_count == 0 and result.upserted_id is None:
                if not skip_session and session_id:
                    await release_minigame_run(db, session_id)
                raise HTTPException(status_code=429, detail=f"Hourly win limit reached ({MAX_WINS_PER_HOUR}). Try again later.")

        ships_saved = fleet_size - ships_lost
        diff_mult = {"easy": 0.6, "normal": 1.0, "hard": 1.5}.get(difficulty, 1.0)
        fleet_mult = fleet_size / 5.0
        cash = int((BASE_CASH + (ships_saved * BONUS_PER_SHIP_SAVED)) * diff_mult * fleet_mult)
        respect = int((BASE_RESPECT + (ships_saved * BONUS_RESPECT_PER_SHIP)) * diff_mult * fleet_mult)

        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"money": cash, "respect_points": respect}},
        )

        win_doc = {
            "user_id": current_user["id"],
            "username": current_user.get("username") or "?",
            "shots_fired": shots_fired,
            "ships_lost": ships_lost,
            "fleet_size": fleet_size,
            "difficulty": difficulty,
            "time_seconds": time_seconds,
            "cash": cash,
            "respect": respect,
            "created_at": now_iso,
        }
        await db.battleships_wins.insert_one(win_doc)

        try:
            from routers.minigames.minigame_leaderboard import log_minigame_play
            total_enemy_cells = sum([5,4,4,3,3,3,2,2][:fleet_size])
            accuracy_pct = (total_enemy_cells / max(1, shots_fired)) * 100
            efficiency_score = max(1, int(accuracy_pct * 10 + ships_saved * 50 * diff_mult))
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
        staff_ids = await _get_staff_user_ids()
        staff_stage = [{"$match": {"user_id": {"$nin": staff_ids}}}] if staff_ids else []
        pipeline = staff_stage + [
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
                    "total_cash": {"$sum": {"$ifNull": ["$cash", 0]}},
                    "total_respect": {"$sum": {"$ifNull": ["$respect", 0]}},
                    "best_time": {"$min": "$time_seconds"},
                }
            },
        ]
        rows = await db.battleships_wins.aggregate(pipeline).to_list(1)
        if not rows:
            return {"stats": {"total_wins": 0, "best_shots": None, "avg_shots": None, "total_ships_lost": 0, "perfect_games": 0, "total_cash": 0, "total_respect": 0, "best_time": None}}
        row = rows[0]
        return {
            "stats": {
                "total_wins": row.get("total_wins", 0),
                "best_shots": row.get("best_shots"),
                "avg_shots": round(row.get("avg_shots", 0), 1) if row.get("avg_shots") else None,
                "total_ships_lost": row.get("total_ships_lost", 0),
                "perfect_games": row.get("perfect_games", 0),
                "total_cash": row.get("total_cash", 0),
                "total_respect": row.get("total_respect", 0),
                "best_time": row.get("best_time"),
            }
        }
