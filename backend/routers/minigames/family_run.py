# Family Run — endless runner minigame
from datetime import datetime, timezone
import uuid

from fastapi import Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any

from server import db, get_current_user, log_activity, log_minigame_payout, log_respect_earned, _get_staff_user_ids, _is_admin
from routers.minigames.minigame_leaderboard import log_minigame_play
from utils.minigame_run_session import (
    as_utc_started,
    claim_minigame_run_session,
    enforce_numeric_score_for_claimed_session,
    get_plays_left,
    release_minigame_run,
    utc_rate_limit_window,
    RATE_LIMIT_PERIOD_HOURS,
)


MAX_SCORE_ACCEPTED = 100_000
MAX_PLAYS_PER_HOUR = 10
FAMILY_RUN_RATE = 50.0
FAMILY_RUN_BUFFER = 20
MIN_PLAY_SECONDS = 3
MAX_COINS_PER_SECOND = 5.0
COINS_SLACK = 10
FAMILY_RUN_GAME = "family_run"

REWARD_CAPS = {
    "cash": 10_000,
    "respect": 50,
}


class FamilyRunScoreRequest(BaseModel):
    score: int
    coins: Optional[int] = 0
    session_id: Optional[str] = None


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

        now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now_dt.isoformat().replace("+00:00", "Z")
        hour_start, reset_dt = utc_rate_limit_window(now_dt)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")
        reset_iso = reset_dt.isoformat().replace("+00:00", "Z")

        uid = current_user["id"]

        skip_session = _is_admin(current_user)
        session_id = (payload.session_id or "").strip()
        if not skip_session:
            if not session_id:
                raise HTTPException(status_code=400, detail="Start a game before submitting (missing session).")
            sess = await claim_minigame_run_session(
                db, user_id=uid, game=FAMILY_RUN_GAME, session_id=session_id, now_dt=now_dt
            )
            started_at = as_utc_started(sess.get("started_at"))
            elapsed = max(0.0, (now_dt - started_at).total_seconds())
            if elapsed < MIN_PLAY_SECONDS:
                await release_minigame_run(db, session_id)
                raise HTTPException(status_code=400, detail="Game too short.")
            max_coins = int(elapsed * MAX_COINS_PER_SECOND) + COINS_SLACK
            if coins > max_coins:
                await release_minigame_run(db, session_id)
                raise HTTPException(status_code=400, detail="Coins do not match session timing.")
            await enforce_numeric_score_for_claimed_session(
                db,
                session_id=session_id,
                sess=sess,
                now_dt=now_dt,
                score=score,
                max_score_cap=MAX_SCORE_ACCEPTED,
                rate_per_second=FAMILY_RUN_RATE,
                buffer=FAMILY_RUN_BUFFER,
            )

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
                if not skip_session and session_id:
                    await release_minigame_run(db, session_id)
                raise HTTPException(
                    status_code=429,
                    detail=f"Play limit reached ({MAX_PLAYS_PER_HOUR} per {RATE_LIMIT_PERIOD_HOURS}h). Try again in {remaining}s.",
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
                current_user.get("username", "?"),
                "minigame_family_run",
                {"score": score, "coins": coins, **rewards_applied},
            )
        except Exception:
            pass

        try:
            await log_minigame_payout(current_user["id"], current_user.get("username", "?"), "family_run", score, rewards_applied)
        except Exception:
            pass

        plays_info = await get_plays_left(db, user_id=current_user["id"], game=FAMILY_RUN_GAME)
        return {
            "ok": True,
            "score": score,
            "coins": coins,
            "plays_left": plays_info["plays_left"],
            "max_plays": plays_info["max_plays"],
            "resets_at": plays_info["resets_at"],
        }
