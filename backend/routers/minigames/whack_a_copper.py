# Whack-A-Copper — minigame
# Integrated with mini games weekly leaderboard

from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user, _get_staff_user_ids, _is_admin, log_activity, log_minigame_payout
from utils.minigame_run_session import (
    as_utc_started,
    claim_minigame_run_session,
    enforce_numeric_score_for_claimed_session,
    release_minigame_run,
)

MAX_PLAYS_PER_HOUR = 10
MAX_SCORE_ACCEPTED = 50_000
WHACK_RATE = 20.0
WHACK_BUFFER = 15
MIN_PLAY_SECONDS = 3
WHACK_GAME = "whack_a_copper"
MIN_SCORE_FOR_REWARD = 100
CASH_PER_10_POINTS = 1  # $1 per 10 score


class WhackACopperScoreRequest(BaseModel):
    score: int
    session_id: Optional[str] = None


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

        uid = current_user["id"]

        skip_session = _is_admin(current_user)
        session_id = (payload.session_id or "").strip()
        if not skip_session:
            if not session_id:
                raise HTTPException(status_code=400, detail="Start a run before submitting (missing session).")
            sess = await claim_minigame_run_session(
                db, user_id=uid, game=WHACK_GAME, session_id=session_id, now_dt=now_dt
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
                rate_per_second=WHACK_RATE,
                buffer=WHACK_BUFFER,
            )

        result = await db.user_meta.update_one(
            {"user_id": uid, "whack_a_copper_hour_start": hour_start_iso, "whack_a_copper_hour_count": {"$lt": MAX_PLAYS_PER_HOUR}},
            {"$inc": {"whack_a_copper_hour_count": 1}},
        )
        if result.modified_count == 0:
            result = await db.user_meta.update_one(
                {"user_id": uid, "whack_a_copper_hour_start": {"$ne": hour_start_iso}},
                {"$set": {"whack_a_copper_hour_start": hour_start_iso, "whack_a_copper_hour_count": 1}},
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

        await log_activity(uid, current_user.get("username", "?"), "minigame_whack", {
            "score": score, "cash": cash,
        })
        await log_minigame_payout(uid, current_user.get("username", "?"), "whack_a_copper", score, {"money": cash})

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
            "ok": True,
            "score": score,
        }

    @router.get("/whack-a-copper/leaderboard")
    async def whack_a_copper_leaderboard(current_user: dict = Depends(get_current_user)):
        """Get top 10 Whack-A-Copper scores."""
        staff_ids = await _get_staff_user_ids()
        q = {"user_id": {"$nin": staff_ids}} if staff_ids else {}
        cursor = (
            db.whack_a_copper_scores.find(
                q,
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
