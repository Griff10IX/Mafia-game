# The Package Run (Snake) — leaderboard and score submit with in-game rewards
from datetime import datetime, timezone, timedelta
import uuid

from fastapi import Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any

from server import db, get_current_user, log_activity, log_respect_earned, _get_staff_user_ids
from routers.minigames.minigame_leaderboard import log_minigame_play


MAX_SCORE_ACCEPTED = 50_000
MAX_PLAYS_PER_HOUR = 10

# Per-submit caps for each reward type (prevent economy overflow)
# 75% reduction for beta
REWARD_CAPS = {
    "cash": 25_000,
    "respect": 500,
    "rank_points": 200,
    "bullets": 50,
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
        if inc.get("respect_points"):
            await log_respect_earned(user_id, inc["respect_points"], "snake")

    if jail_seconds:
        jail_until = datetime.now(timezone.utc) + timedelta(seconds=jail_seconds)
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"in_jail": True, "jail_until": jail_until.isoformat().replace("+00:00", "Z")}},
        )

    return applied


def register(router):
    # Config: rewards key and rules (for frontend display / single source of truth)
    REWARDS_AND_RULES = {
        "rewards": [
            {"key": "cash", "label": "Cash", "desc": "In-game money", "example": "$500 per pickup"},
            {"key": "respect", "label": "Respect", "desc": "Respect points", "example": "+5 per pickup"},
            {"key": "rank_points", "label": "Rank points", "desc": "Progress toward rank", "example": "+3 per pickup"},
            {"key": "bullets", "label": "Bullets", "desc": "Ammo", "example": "+10 per pickup"},
            {"key": "booze", "label": "Booze", "desc": "Speakeasy whiskey (Booze Run)", "example": "+1 per pickup"},
            {"key": "jail", "label": "Jail token", "desc": "Trap — avoid; sends you to jail", "example": "30 seconds jail per token"},
        ],
        "rules": [
            "Move with WASD or arrow keys. Collect packages to grow and earn rewards.",
            "Submit your score when you die to credit rewards (cash, respect, rank points, bullets, booze) to your account.",
            "Avoid the jail token — it reduces your score and adds jail time.",
            "Cops appear after 100 points. Don't hit them or you're pinched.",
            "Speed increases as you collect. Max 10 runs per hour.",
        ],
        "max_score_accepted": MAX_SCORE_ACCEPTED,
        "max_plays_per_hour": MAX_PLAYS_PER_HOUR,
    }

    @router.get("/snake/config")
    async def snake_config(current_user: dict = Depends(get_current_user)):
        """Returns rewards key and rules for the Package Run game."""
        return REWARDS_AND_RULES

    @router.get("/snake/leaderboard")
    async def snake_leaderboard(current_user: dict = Depends(get_current_user)):
        staff_ids = await _get_staff_user_ids()
        q = {"user_id": {"$nin": staff_ids}} if staff_ids else {}
        cursor = db.snake_scores.find(
            q,
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

        # Rate limit: N plays per hour (UTC) — atomic to prevent concurrent bypass
        now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now_dt.isoformat().replace("+00:00", "Z")
        hour_start = now_dt.replace(minute=0, second=0)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")
        reset_dt = hour_start + timedelta(hours=1)
        reset_iso = reset_dt.isoformat().replace("+00:00", "Z")
        uid = current_user["id"]

        result = await db.user_meta.update_one(
            {"user_id": uid, "snake_hour_start": hour_start_iso, "snake_hour_count": {"$lt": MAX_PLAYS_PER_HOUR}},
            {"$inc": {"snake_hour_count": 1}},
        )
        if result.modified_count == 0:
            result = await db.user_meta.update_one(
                {"user_id": uid, "snake_hour_start": {"$ne": hour_start_iso}},
                {"$set": {"snake_hour_start": hour_start_iso, "snake_hour_reset_at": reset_iso, "snake_hour_count": 1}},
                upsert=True,
            )
            if result.modified_count == 0 and result.upserted_id is None:
                remaining = max(0, int((reset_dt - now_dt).total_seconds()))
                raise HTTPException(
                    status_code=429,
                    detail=f"Hourly limit reached ({MAX_PLAYS_PER_HOUR} plays). Try again in {remaining}s.",
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
            await log_minigame_play(current_user["id"], current_user.get("username"), "snake", score)
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
