# Family Run — endless runner minigame
from datetime import datetime, timezone, timedelta
import uuid

from fastapi import Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any

from server import db, get_current_user, log_activity, log_respect_earned, _get_staff_user_ids
from routers.minigames.minigame_leaderboard import log_minigame_play


MAX_SCORE_ACCEPTED = 100_000
MAX_PLAYS_PER_HOUR = 10

REWARD_CAPS = {
    "cash": 10_000,
    "respect": 50,
}


class FamilyRunScoreRequest(BaseModel):
    score: int
    coins: Optional[int] = 0


async def _apply_rewards(user_id: str, score: int, coins: int) -> Dict[str, Any]:
    """Calculate and apply rewards based on distance and coins collected."""
    inc = {}
    
    # Cash: $10 per 100m + coin bonuses
    cash_from_distance = min(REWARD_CAPS["cash"], (score // 100) * 10)
    cash_from_coins = min(2000, coins // 10)  # $1 per 10 coin value
    total_cash = cash_from_distance + cash_from_coins
    if total_cash > 0:
        inc["money"] = total_cash

    # Respect: 1 per 200m
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
        """Get top 10 Family Run scores."""
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

    @router.post("/family-run/score")
    async def family_run_score(payload: FamilyRunScoreRequest, current_user: dict = Depends(get_current_user)):
        """Submit a Family Run score and receive rewards."""
        score = int(payload.score or 0)
        coins = int(payload.coins or 0)
        
        if score < 0:
            raise HTTPException(status_code=400, detail="Invalid score.")
        if score > MAX_SCORE_ACCEPTED:
            raise HTTPException(status_code=400, detail="Score too high.")

        # Rate limit: N plays per hour
        now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now_dt.isoformat().replace("+00:00", "Z")
        hour_start = now_dt.replace(minute=0, second=0)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")
        reset_dt = hour_start + timedelta(hours=1)
        reset_iso = reset_dt.isoformat().replace("+00:00", "Z")

        uid = current_user["id"]

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
                    detail=f"Hourly limit reached ({MAX_PLAYS_PER_HOUR} plays). Try again in {remaining}s.",
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
                f"Family Run score: {score}m",
            )
        except Exception:
            pass

        return {
            "message": "Score submitted",
            "score": score,
            "coins": coins,
            "rewards_applied": rewards_applied,
        }
