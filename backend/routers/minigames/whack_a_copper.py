# Whack-A-Copper — minigame
# Integrated with mini games weekly leaderboard

from datetime import datetime, timezone, timedelta

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user

MAX_PLAYS_PER_HOUR = 10
MAX_SCORE_ACCEPTED = 50_000
MIN_SCORE_FOR_REWARD = 100
CASH_PER_10_POINTS = 1  # $1 per 10 score


class WhackACopperScoreRequest(BaseModel):
    score: int


def register(router):
    @router.post("/whack-a-copper/score")
    async def whack_a_copper_score(
        payload: WhackACopperScoreRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Submit a Whack-A-Copper score and receive rewards. Logs to mini games leaderboard."""
        score = int(payload.score or 0)

        if score < 0:
            raise HTTPException(status_code=400, detail="Invalid score.")
        if score > MAX_SCORE_ACCEPTED:
            raise HTTPException(status_code=400, detail="Score too high.")

        now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now_dt.isoformat().replace("+00:00", "Z")
        hour_start = now_dt.replace(minute=0, second=0)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")
        reset_dt = hour_start + timedelta(hours=1)

        meta = await db.user_meta.find_one(
            {"user_id": current_user["id"]},
            {"_id": 0, "whack_a_copper_hour_start": 1, "whack_a_copper_hour_count": 1},
        )
        meta_start = (meta or {}).get("whack_a_copper_hour_start")
        meta_count = int((meta or {}).get("whack_a_copper_hour_count") or 0)

        if meta_start == hour_start_iso:
            if meta_count >= MAX_PLAYS_PER_HOUR:
                remaining = max(0, int((reset_dt - now_dt).total_seconds()))
                raise HTTPException(
                    status_code=400,
                    detail=f"Hourly limit reached ({MAX_PLAYS_PER_HOUR} plays). Try again in {remaining}s.",
                )
            new_count = meta_count + 1
        else:
            new_count = 1

        await db.user_meta.update_one(
            {"user_id": current_user["id"]},
            {
                "$setOnInsert": {"user_id": current_user["id"]},
                "$set": {
                    "whack_a_copper_hour_start": hour_start_iso,
                    "whack_a_copper_hour_count": new_count,
                },
            },
            upsert=True,
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

        return {
            "message": "Score submitted",
            "score": score,
            "cash": cash,
        }

    @router.get("/whack-a-copper/leaderboard")
    async def whack_a_copper_leaderboard(current_user: dict = Depends(get_current_user)):
        """Get top 10 Whack-A-Copper scores."""
        cursor = (
            db.whack_a_copper_scores.find(
                {},
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
