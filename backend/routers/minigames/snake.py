# The Package Run (Snake) — leaderboard and score submit with server-calculated rewards
from datetime import datetime, timezone, timedelta
import uuid

from fastapi import Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any

from server import db, get_current_user, log_activity, log_respect_earned, _get_staff_user_ids, _is_admin
from routers.minigames.minigame_leaderboard import log_minigame_play
from utils.minigame_run_session import (
    as_utc_started,
    claim_minigame_run_session,
    enforce_numeric_score_for_claimed_session,
    release_minigame_run,
)


MAX_SCORE_ACCEPTED = 50_000
MAX_PLAYS_PER_HOUR = 10
SNAKE_SCORE_RATE_PER_SEC = 15.0
SNAKE_SCORE_BUFFER = 20
MIN_PLAY_SECONDS = 3
SNAKE_GAME = "snake"

SNAKE_BOOZE_ID = "speakeasy_whiskey"


class SnakeScoreRequest(BaseModel):
    score: int
    session_id: Optional[str] = None
    rewards: Optional[Dict[str, int]] = None


def _rewards_from_score(score: int) -> Dict[str, int]:
    """Server-authoritative reward calculation based on score. Client rewards dict is ignored."""
    s = max(0, score)
    return {
        "money": min(25_000, s * 5),
        "respect_points": min(500, s // 20),
        "rank_points": min(200, s // 50),
        "bullets": min(50, s // 100),
    }


async def _apply_rewards(user_id: str, score: int) -> Dict[str, Any]:
    """Calculate and apply rewards from score. Returns what was applied."""
    inc = _rewards_from_score(score)
    inc = {k: v for k, v in inc.items() if v > 0}

    applied = dict(inc)

    if inc:
        await db.users.update_one({"id": user_id}, {"$inc": inc})
        if inc.get("respect_points"):
            await log_respect_earned(user_id, inc["respect_points"], "snake")

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

        now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now_dt.isoformat().replace("+00:00", "Z")
        hour_start = now_dt.replace(minute=0, second=0)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")
        reset_dt = hour_start + timedelta(hours=1)
        reset_iso = reset_dt.isoformat().replace("+00:00", "Z")
        uid = current_user["id"]

        skip_session = _is_admin(current_user)
        session_id = (payload.session_id or "").strip()
        if not skip_session:
            if not session_id:
                raise HTTPException(status_code=400, detail="Start a game before submitting (missing session).")
            sess = await claim_minigame_run_session(
                db, user_id=uid, game=SNAKE_GAME, session_id=session_id, now_dt=now_dt
            )
            started_at = as_utc_started(sess.get("started_at"))
            elapsed = max(0.0, (now_dt - started_at).total_seconds())
            if elapsed < MIN_PLAY_SECONDS:
                await release_minigame_run(db, session_id)
                raise HTTPException(status_code=400, detail="Game too short.")
            await enforce_numeric_score_for_claimed_session(
                db,
                session_id=session_id,
                sess=sess,
                now_dt=now_dt,
                score=score,
                max_score_cap=MAX_SCORE_ACCEPTED,
                rate_per_second=SNAKE_SCORE_RATE_PER_SEC,
                buffer=SNAKE_SCORE_BUFFER,
            )

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
                if not skip_session and session_id:
                    await release_minigame_run(db, session_id)
                raise HTTPException(
                    status_code=429,
                    detail=f"Hourly limit reached ({MAX_PLAYS_PER_HOUR} plays). Try again in {remaining}s.",
                )

        rewards_applied = await _apply_rewards(current_user["id"], score)

        doc = {
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "username": current_user.get("username") or "?",
            "score": score,
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
            "ok": True,
            "score": score,
        }
