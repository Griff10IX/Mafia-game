# Famiglia / Mafia RPG — canvas minigame session submit + leaderboard
# Weekly points via minigame_plays; all-time top scores in mafia_rpg_scores

from datetime import datetime, timezone, timedelta
import uuid
from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user, log_activity, _get_staff_user_ids, _is_admin
from utils.minigame_run_session import (
    claim_minigame_run_session,
    enforce_numeric_score_for_claimed_session,
    release_minigame_run,
)

MAX_PLAYS_PER_HOUR = 10
MAFIA_RPG_GAME = "mafia_rpg"
MAFIA_COMPOSITE_RATE = 2_000.0
MAFIA_COMPOSITE_BUFFER = 5_000
MAX_RESPECT = 100
MAX_MISSIONS = 100
MAX_TOTAL_EARNED = 50_000_000
MAX_COMPOSITE = 2_000_000


class MafiaRpgSessionRequest(BaseModel):
    respect: int = 0
    missions_complete: int = 0
    total_earned: int = 0
    session_id: Optional[str] = None


def _composite_score(respect: int, missions: int, earned: int) -> int:
    r = max(0, min(MAX_RESPECT, int(respect or 0)))
    m = max(0, min(MAX_MISSIONS, int(missions or 0)))
    e = max(0, min(MAX_TOTAL_EARNED, int(earned or 0)))
    raw = r * 5_000 + m * 12_000 + e // 400
    return min(MAX_COMPOSITE, int(raw))


def register(router):
    @router.post("/mafia-rpg/session")
    async def mafia_rpg_session(
        payload: MafiaRpgSessionRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Submit session stats (respect, missions, lifetime earned). Rate-limited; logs weekly mini-game points."""
        respect = int(payload.respect or 0)
        missions = int(payload.missions_complete or 0)
        earned = int(payload.total_earned or 0)

        if respect < 0 or missions < 0 or earned < 0:
            raise HTTPException(status_code=400, detail="Invalid stats.")

        score = _composite_score(respect, missions, earned)

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
                raise HTTPException(status_code=400, detail="Start a session before submitting (missing session).")
            sess = await claim_minigame_run_session(
                db, user_id=uid, game=MAFIA_RPG_GAME, session_id=session_id, now_dt=now_dt
            )
            await enforce_numeric_score_for_claimed_session(
                db,
                session_id=session_id,
                sess=sess,
                now_dt=now_dt,
                score=score,
                max_score_cap=MAX_COMPOSITE,
                rate_per_second=MAFIA_COMPOSITE_RATE,
                buffer=MAFIA_COMPOSITE_BUFFER,
            )

        result = await db.user_meta.update_one(
            {
                "user_id": uid,
                "mafia_rpg_hour_start": hour_start_iso,
                "mafia_rpg_hour_count": {"$lt": MAX_PLAYS_PER_HOUR},
            },
            {"$inc": {"mafia_rpg_hour_count": 1}},
        )
        if result.modified_count == 0:
            result = await db.user_meta.update_one(
                {"user_id": uid, "mafia_rpg_hour_start": {"$ne": hour_start_iso}},
                {
                    "$set": {
                        "mafia_rpg_hour_start": hour_start_iso,
                        "mafia_rpg_hour_count": 1,
                    }
                },
                upsert=True,
            )
            if result.modified_count == 0 and result.upserted_id is None:
                remaining = max(0, int((reset_dt - now_dt).total_seconds()))
                if not skip_session and session_id:
                    await release_minigame_run(db, session_id)
                raise HTTPException(
                    status_code=429,
                    detail=f"Hourly limit reached ({MAX_PLAYS_PER_HOUR} submits). Try again in {remaining}s.",
                )

        cash = min(8_000, max(0, score // 2_000))
        if cash > 0:
            await db.users.update_one({"id": uid}, {"$inc": {"money": cash}})

        doc = {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "username": current_user.get("username") or "?",
            "score": score,
            "respect": max(0, min(MAX_RESPECT, respect)),
            "missions_complete": max(0, min(MAX_MISSIONS, missions)),
            "total_earned": max(0, min(MAX_TOTAL_EARNED, earned)),
            "cash_reward": cash,
            "at": now_iso,
        }
        try:
            await db.mafia_rpg_scores.insert_one(doc)
        except Exception:
            pass

        try:
            from routers.minigames.minigame_leaderboard import log_minigame_play

            await log_minigame_play(
                uid,
                current_user.get("username"),
                "mafia_rpg",
                score,
            )
        except Exception:
            pass

        try:
            await log_activity(
                uid,
                f"Famiglia session — score {score} (missions {missions}, respect {respect})",
            )
        except Exception:
            pass

        return {
            "ok": True,
            "score": score,
        }

    @router.get("/mafia-rpg/leaderboard")
    async def mafia_rpg_leaderboard(current_user: dict = Depends(get_current_user)):
        """Top 10 Famiglia composite scores."""
        staff_ids = await _get_staff_user_ids()
        q = {"user_id": {"$nin": staff_ids}} if staff_ids else {}
        cursor = (
            db.mafia_rpg_scores.find(
                q,
                {
                    "_id": 0,
                    "user_id": 1,
                    "username": 1,
                    "score": 1,
                    "respect": 1,
                    "missions_complete": 1,
                    "total_earned": 1,
                    "at": 1,
                },
            )
            .sort([("score", -1), ("at", 1)])
            .limit(10)
        )
        rows = await cursor.to_list(10)
        me_id = current_user.get("id")
        out = []
        for r in rows:
            out.append(
                {
                    "user_id": r.get("user_id"),
                    "username": r.get("username") or "?",
                    "score": int(r.get("score") or 0),
                    "respect": int(r.get("respect") or 0),
                    "missions_complete": int(r.get("missions_complete") or 0),
                    "total_earned": int(r.get("total_earned") or 0),
                    "at": r.get("at"),
                    "is_me": r.get("user_id") == me_id,
                }
            )
        return {"leaderboard": out}
