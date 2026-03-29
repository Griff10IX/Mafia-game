# Minesweeper - Win tracking and leaderboard (fastest times)
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
    get_plays_left,
    release_minigame_run,
    utc_rate_limit_window,
    RATE_LIMIT_PERIOD_HOURS,
)

MINESWEEPER_GAME = "minesweeper"

VALID_DIFFICULTIES = ["snitch", "capo", "godfather"]

# 75% reduction for beta
DIFFICULTY_CONFIG = {
    "snitch": {"base_cash": 1_250, "base_respect": 5, "points": 15, "max_time": 600, "min_time": 5},
    "capo": {"base_cash": 3_750, "base_respect": 15, "points": 30, "max_time": 1200, "min_time": 15},
    "godfather": {"base_cash": 12_500, "base_respect": 50, "points": 60, "max_time": 1800, "min_time": 30},
}

MAX_WINS_PER_HOUR = 10


class MinesweeperWinRequest(BaseModel):
    difficulty: str
    time_seconds: int
    session_id: Optional[str] = None


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

        now = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now.isoformat().replace("+00:00", "Z")
        hour_start, _ = utc_rate_limit_window(now)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")

        uid = current_user["id"]

        skip_session = _is_admin(current_user)
        session_id = (body.session_id or "").strip()
        if not skip_session:
            if not session_id:
                raise HTTPException(status_code=400, detail="Start a game before submitting (missing session).")
            sess = await claim_minigame_run_session(
                db, user_id=uid, game=MINESWEEPER_GAME, session_id=session_id, now_dt=now
            )

            sess_meta = sess.get("meta") or {}
            sess_diff = sess_meta.get("difficulty", "")
            if sess_diff and sess_diff != difficulty:
                await release_minigame_run(db, session_id)
                raise HTTPException(status_code=400, detail="Difficulty mismatch with session.")

            started_at = as_utc_started(sess.get("started_at"))
            elapsed = max(0.0, (now - started_at).total_seconds())
            min_time = cfg.get("min_time", 5)
            if elapsed < min_time:
                await release_minigame_run(db, session_id)
                raise HTTPException(status_code=400, detail="Game too short for this difficulty.")

            await enforce_client_duration_for_claimed_session(
                db,
                session_id=session_id,
                sess=sess,
                now_dt=now,
                client_duration_seconds=time_seconds,
                max_duration_cap=int(cfg["max_time"]),
                slack_seconds=45,
            )

        result = await db.user_meta.update_one(
            {"user_id": uid, "minesweeper_hour_start": hour_start_iso, "minesweeper_hour_count": {"$lt": MAX_WINS_PER_HOUR}},
            {"$inc": {"minesweeper_hour_count": 1}},
        )
        if result.modified_count == 0:
            result = await db.user_meta.update_one(
                {"user_id": uid, "minesweeper_hour_start": {"$ne": hour_start_iso}},
                {"$set": {"minesweeper_hour_start": hour_start_iso, "minesweeper_hour_count": 1}},
                upsert=True,
            )
            if result.modified_count == 0 and result.upserted_id is None:
                if not skip_session and session_id:
                    await release_minigame_run(db, session_id)
                raise HTTPException(
                    status_code=429,
                    detail=f"Win limit reached ({MAX_WINS_PER_HOUR} per {RATE_LIMIT_PERIOD_HOURS}h). Try again later.",
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

        await log_activity(uid, current_user.get("username", "?"), "minigame_minesweeper", {
            "difficulty": difficulty, "time_seconds": time_seconds, "cash": cash, "respect": respect,
        })
        await log_minigame_payout(uid, current_user.get("username", "?"), "minesweeper", max(1, cfg["max_time"] - time_seconds), {"money": cash, "respect_points": respect})

        try:
            from routers.minigames.minigame_leaderboard import log_minigame_play
            score = max(1, cfg["max_time"] - time_seconds)
            await log_minigame_play(current_user["id"], current_user.get("username"), "minesweeper", score)
        except Exception:
            pass

        plays_info = await get_plays_left(db, user_id=uid, game=MINESWEEPER_GAME)
        return {
            "ok": True,
            "time_seconds": time_seconds,
            "difficulty": difficulty,
            "plays_left": plays_info["plays_left"],
            "max_plays": plays_info["max_plays"],
            "resets_at": plays_info["resets_at"],
        }

    @router.get("/minesweeper/leaderboard")
    async def get_minesweeper_leaderboard(current_user: dict = Depends(get_current_user)):
        """Get top 10 fastest Minesweeper wins across all difficulties."""
        staff_ids = await _get_staff_user_ids()
        staff_stage = [{"$match": {"user_id": {"$nin": staff_ids}}}] if staff_ids else []
        pipeline = staff_stage + [
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
