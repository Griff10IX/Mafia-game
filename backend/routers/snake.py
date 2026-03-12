# The Package Run (Snake) — leaderboard and score submit with in-game rewards
from datetime import datetime, timezone, timedelta
import uuid

from fastapi import Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any

from server import db, get_current_user, log_activity


MAX_SCORE_ACCEPTED = 50_000
MAX_PLAYS_PER_HOUR = 15

# Per-submit caps for each reward type (prevent economy overflow)
REWARD_CAPS = {
    "cash": 100_000,
    "respect": 500,
    "rank_points": 200,
    "bullets": 200,
    "points": 500,
    "booze": 50,
}
# Default booze type for Package Run (Booze Run uses booze_carrying.{booze_id})
SNAKE_BOOZE_ID = "speakeasy_whiskey"
# Jail penalty: seconds in jail when user collected jail token(s)
SNAKE_JAIL_SECONDS = 30


class SnakeScoreRequest(BaseModel):
    score: int
    rewards: Optional[Dict[str, int]] = None


async def _apply_rewards(user_id: str, rewards: Dict[str, Any]) -> Dict[str, Any]:
    """Apply reward dict to user. Returns what was applied (for response). Clamps to REWARD_CAPS."""
    if not rewards or not isinstance(rewards, dict):
        return {}

    inc = {}
    jail_seconds = 0

    # cash -> money
    if "cash" in rewards:
        v = max(0, min(REWARD_CAPS["cash"], int(rewards.get("cash") or 0)))
        if v:
            inc["money"] = v

    # respect -> respect_points
    if "respect" in rewards:
        v = max(0, min(REWARD_CAPS["respect"], int(rewards.get("respect") or 0)))
        if v:
            inc["respect_points"] = v

    # rank_points
    if "rank_points" in rewards:
        v = max(0, min(REWARD_CAPS["rank_points"], int(rewards.get("rank_points") or 0)))
        if v:
            inc["rank_points"] = v

    # bullets
    if "bullets" in rewards:
        v = max(0, min(REWARD_CAPS["bullets"], int(rewards.get("bullets") or 0)))
        if v:
            inc["bullets"] = v

    # points (spendable)
    if "points" in rewards:
        v = max(0, min(REWARD_CAPS["points"], int(rewards.get("points") or 0)))
        if v:
            inc["points"] = v

    # booze -> booze_carrying.speakeasy_whiskey
    if "booze" in rewards:
        v = max(0, min(REWARD_CAPS["booze"], int(rewards.get("booze") or 0)))
        if v:
            inc[f"booze_carrying.{SNAKE_BOOZE_ID}"] = v

    # jail: negative — add jail time (each token = 30s)
    if "jail" in rewards:
        n = max(0, int(rewards.get("jail") or 0))
        if n:
            jail_seconds = n * SNAKE_JAIL_SECONDS

    applied = dict(inc)
    if jail_seconds:
        applied["jail_seconds"] = jail_seconds

    if inc:
        await db.users.update_one({"id": user_id}, {"$inc": inc})

    if jail_seconds:
        jail_until = datetime.now(timezone.utc) + timedelta(seconds=jail_seconds)
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"in_jail": True, "jail_until": jail_until.isoformat().replace("+00:00", "Z")}},
        )

    return applied


def register(router):
    @router.get("/snake/leaderboard")
    async def snake_leaderboard(current_user: dict = Depends(get_current_user)):
        cursor = db.snake_scores.find(
            {},
            {"_id": 0, "user_id": 1, "username": 1, "score": 1, "at": 1},
        ).sort([("score", -1), ("at", 1)]).limit(10)
        rows = await cursor.to_list(10)
        me_id = current_user.get("id")
        out = []
        for i, r in enumerate(rows):
            out.append({
                "user_id": r.get("user_id"),
                "username": r.get("username") or "?",
                "score": int(r.get("score") or 0),
                "at": r.get("at"),
                "is_me": r.get("user_id") == me_id,
            })
        return {"leaderboard": out}

    @router.post("/snake/score")
    async def snake_score(payload: SnakeScoreRequest, current_user: dict = Depends(get_current_user)):
        score = int(payload.score or 0)
        if score < 0:
            raise HTTPException(status_code=400, detail="Invalid score.")
        if score > MAX_SCORE_ACCEPTED:
            raise HTTPException(status_code=400, detail="Score too high.")

        # Rate limit: N plays per hour (UTC)
        now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now_dt.isoformat().replace("+00:00", "Z")
        hour_start = now_dt.replace(minute=0, second=0)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")
        reset_dt = hour_start + timedelta(hours=1)
        reset_iso = reset_dt.isoformat().replace("+00:00", "Z")

        meta = await db.user_meta.find_one(
            {"user_id": current_user["id"]},
            {"_id": 0, "snake_hour_start": 1, "snake_hour_count": 1},
        )
        meta_start = (meta or {}).get("snake_hour_start")
        meta_count = int((meta or {}).get("snake_hour_count") or 0)
        if meta_start == hour_start_iso:
            if meta_count >= MAX_PLAYS_PER_HOUR:
                remaining = max(0, int((reset_dt - now_dt).total_seconds()))
                raise HTTPException(
                    status_code=400,
                    detail=f"Hourly limit reached ({MAX_PLAYS_PER_HOUR} plays). Try again in {remaining}s.",
                )
            new_count = meta_count + 1
            await db.user_meta.update_one(
                {"user_id": current_user["id"]},
                {
                    "$setOnInsert": {"user_id": current_user["id"]},
                    "$set": {
                        "snake_hour_start": hour_start_iso,
                        "snake_hour_reset_at": reset_iso,
                        "snake_hour_count": new_count,
                    },
                },
                upsert=True,
            )
        else:
            await db.user_meta.update_one(
                {"user_id": current_user["id"]},
                {
                    "$setOnInsert": {"user_id": current_user["id"]},
                    "$set": {
                        "snake_hour_start": hour_start_iso,
                        "snake_hour_reset_at": reset_iso,
                        "snake_hour_count": 1,
                    },
                },
                upsert=True,
            )

        rewards = payload.rewards or {}
        rewards_applied = await _apply_rewards(current_user["id"], rewards)

        doc = {
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "username": current_user.get("username") or "?",
            "score": score,
            "rewards": rewards,
            "at": now_iso,
        }
        try:
            await db.snake_scores.insert_one(doc)
        except Exception:
            pass

        try:
            await log_activity(
                current_user["id"],
                f"Package Run score submitted: {score} pts.",
            )
        except Exception:
            pass

        return {
            "message": "Score submitted",
            "score": score,
            "rewards_applied": rewards_applied,
        }
