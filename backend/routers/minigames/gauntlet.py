# Flappy Gangster (Flappy-style) — cash and respect rewards by score. Infinite levels; caps per run.
from datetime import datetime, timezone, timedelta
import uuid

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from server import db, get_current_user, log_activity, log_respect_earned, _get_staff_user_ids, _is_admin
from routers.minigames.minigame_leaderboard import log_minigame_play
from utils.minigame_run_session import (
    claim_minigame_run_session,
    enforce_numeric_score_for_claimed_session,
    release_minigame_run,
    start_minigame_run,
)


# Base tiers (score threshold -> cash, respect for that tier only; cumulative applied in _get_reward)
# 75% reduction for beta
REWARD_TIERS = [
    {"score": 1, "cash": 63, "respect": 5, "label": "Street Punk"},
    {"score": 5, "cash": 250, "respect": 5, "label": "Corner Boy"},
    {"score": 10, "cash": 625, "respect": 10, "label": "Made Man"},
    {"score": 20, "cash": 1_500, "respect": 20, "label": "Underboss"},
    {"score": 35, "cash": 3_125, "respect": 20, "label": "Capo"},
    {"score": 50, "cash": 6_250, "respect": 40, "label": "Don"},
]

# Caps per single run (infinite levels, but one claim cannot exceed these)
MAX_CASH_PER_CLAIM = 250_000  # 75% reduction
MAX_RESPECT_PER_CLAIM = 1_000

# Beyond tier 50: every gate adds this cash (until cap) and 2 respect (until cap)
CASH_PER_GATE_AFTER_50 = 500  # 75% reduction
RESPECT_PER_GATE_AFTER_50 = 2

# Basic sanity limits (frontend is not trusted). Highest score-gated unlock in the client is 750 gates;
# real runs can go higher, but values like 9999 are trivial API spoofing (old cap was 10_000).
MAX_SCORE_ACCEPTED = 2_000
MAX_PLAYS_PER_HOUR = 10

# Run sessions: claim must use session_id from POST /gauntlet/start (or /minigames/run-session/start).
MAX_GATES_PER_SECOND = 10.0
SCORE_TIME_BUFFER = 15

GAUNTLET_GAME_SLUG = "gauntlet"


def _get_reward(score: int) -> dict:
    """Compute cash and respect for any score; apply caps. Returns label from highest tier reached."""
    score = max(0, int(score))
    cash = 0
    respect = 0
    label = "Nobody"
    tier = -1

    for i, t in enumerate(REWARD_TIERS):
        if score >= int(t["score"]):
            cash += int(t["cash"])
            respect += int(t["respect"])
            label = str(t["label"])
            tier = i

    # Beyond 50 gates: infinite progression (capped)
    if score > 50:
        extra_gates = score - 50
        cash += min(MAX_CASH_PER_CLAIM - cash, extra_gates * CASH_PER_GATE_AFTER_50)
        respect += min(MAX_RESPECT_PER_CLAIM - respect, extra_gates * RESPECT_PER_GATE_AFTER_50)

    cash = min(MAX_CASH_PER_CLAIM, cash)
    respect = min(MAX_RESPECT_PER_CLAIM, respect)
    return {"cash": cash, "respect": respect, "label": label, "tier": tier, "score": score}


class GauntletStartRequest(BaseModel):
    theme: Optional[str] = None
    speed: Optional[str] = None
    difficulty: Optional[str] = None


class GauntletClaimRequest(BaseModel):
    score: int
    session_id: Optional[str] = None
    theme: Optional[str] = None
    speed: Optional[str] = None
    difficulty: Optional[str] = None


def register(router):
    @router.get("/gauntlet/leaderboard")
    async def gauntlet_leaderboard(
        period: str = Query("weekly", description="weekly (Mon UTC) or alltime"),
        current_user: dict = Depends(get_current_user),
    ):
        p = (period or "weekly").lower()
        now_dt = datetime.now(timezone.utc)
        staff_ids = await _get_staff_user_ids()
        staff_match = {"user_id": {"$nin": staff_ids}} if staff_ids else {}
        if p == "weekly":
            d = now_dt.date()
            days_since_monday = (d.weekday()) % 7
            week_start = datetime(d.year, d.month, d.day, tzinfo=timezone.utc) - timedelta(days=days_since_monday)
            match = {"_ts": {"$gte": week_start}, **staff_match}
            pipeline = [
                {"$addFields": {"_ts": {"$toDate": "$at"}}},
                {"$match": match},
                {"$group": {"_id": "$user_id", "best_score": {"$max": "$score"}, "username": {"$last": "$username"}}},
                {"$sort": {"best_score": -1}},
                {"$limit": 10},
            ]
            rows = await db.gauntlet_scores.aggregate(pipeline).to_list(10)
            out = [{"rank": i + 1, "user_id": r.get("_id"), "username": r.get("username") or "?", "score": int(r.get("best_score") or 0)} for i, r in enumerate(rows)]
        else:
            cursor = db.gauntlet_scores.find(staff_match, {"_id": 0}).sort([("score", -1), ("at", 1)]).limit(10)
            rows = await cursor.to_list(10)
            out = [{"rank": i + 1, "user_id": r.get("user_id"), "username": r.get("username") or "?", "score": int(r.get("score") or 0), "at": r.get("at")} for i, r in enumerate(rows)]
        return {"period": p, "top10": out}

    @router.post("/gauntlet/start")
    async def gauntlet_start(body: GauntletStartRequest, current_user: dict = Depends(get_current_user)):
        """Open a server-timed run; claims must reference the returned session_id."""
        meta = {}
        if body.theme:
            meta["theme"] = (body.theme or "")[:64]
        if body.speed:
            meta["speed"] = (body.speed or "")[:32]
        if body.difficulty:
            meta["difficulty"] = (body.difficulty or "")[:32]
        return await start_minigame_run(
            db,
            user_id=current_user["id"],
            game=GAUNTLET_GAME_SLUG,
            meta=meta or None,
        )

    @router.post("/gauntlet/claim")
    async def gauntlet_claim(payload: GauntletClaimRequest, current_user: dict = Depends(get_current_user)):
        score = int(payload.score or 0)
        if score < 0:
            raise HTTPException(status_code=400, detail="Invalid score.")
        if score > MAX_SCORE_ACCEPTED:
            raise HTTPException(status_code=400, detail="Score too high to claim.")

        now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now_dt.isoformat().replace("+00:00", "Z")
        hour_start = now_dt.replace(minute=0, second=0)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")
        reset_dt = hour_start + timedelta(hours=1)
        reset_iso = reset_dt.isoformat().replace("+00:00", "Z")
        uid = current_user["id"]

        skip_session = _is_admin(current_user)
        session_id = (payload.session_id or "").strip()
        sess = None
        if not skip_session:
            if not session_id:
                raise HTTPException(status_code=400, detail="Start a run before claiming (missing session).")
            sess = await claim_minigame_run_session(
                db, user_id=uid, game=GAUNTLET_GAME_SLUG, session_id=session_id, now_dt=now_dt
            )
            await enforce_numeric_score_for_claimed_session(
                db,
                session_id=session_id,
                sess=sess,
                now_dt=now_dt,
                score=score,
                max_score_cap=MAX_SCORE_ACCEPTED,
                rate_per_second=MAX_GATES_PER_SECOND,
                buffer=SCORE_TIME_BUFFER,
            )

        result = await db.user_meta.update_one(
            {"user_id": uid, "gauntlet_hour_start": hour_start_iso, "gauntlet_hour_count": {"$lt": MAX_PLAYS_PER_HOUR}},
            {"$inc": {"gauntlet_hour_count": 1}},
        )
        if result.modified_count == 0:
            result = await db.user_meta.update_one(
                {"user_id": uid, "gauntlet_hour_start": {"$ne": hour_start_iso}},
                {"$set": {"gauntlet_hour_start": hour_start_iso, "gauntlet_hour_reset_at": reset_iso, "gauntlet_hour_count": 1}},
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

        meta_after = await db.user_meta.find_one({"user_id": uid}, {"_id": 0, "gauntlet_hour_count": 1})
        plays_left = max(0, MAX_PLAYS_PER_HOUR - int((meta_after or {}).get("gauntlet_hour_count") or 0))

        reward = _get_reward(score)
        cash = int(reward["cash"] or 0)
        respect = int(reward["respect"] or 0)
        if cash <= 0 and respect <= 0:
            try:
                await db.gauntlet_scores.insert_one(
                    {"id": str(uuid.uuid4()), "user_id": current_user["id"], "username": current_user.get("username") or "?", "score": score, "cash": 0, "respect": 0, "at": now_iso}
                )
            except Exception:
                pass
            try:
                await log_minigame_play(current_user["id"], current_user.get("username"), "gauntlet", score)
            except Exception:
                pass
            return {"cash_awarded": 0, "respect_awarded": 0, "label": reward["label"], "tier": reward["tier"], "plays_left": plays_left, "resets_at": reset_iso}

        updates = {}
        if cash > 0:
            updates["money"] = cash
        if respect > 0:
            updates["respect_points"] = respect
        if updates:
            await db.users.update_one({"id": current_user["id"]}, {"$inc": updates})
            if respect > 0:
                await log_respect_earned(current_user["id"], respect, "gauntlet")
        try:
            await db.gauntlet_scores.insert_one(
                {"id": str(uuid.uuid4()), "user_id": current_user["id"], "username": current_user.get("username") or "?", "score": score, "cash": cash, "respect": respect, "at": now_iso}
            )
        except Exception:
            pass
        try:
            await log_minigame_play(current_user["id"], current_user.get("username"), "gauntlet", score)
        except Exception:
            pass
        await db.user_meta.update_one(
            {"user_id": current_user["id"]},
            {"$set": {"gauntlet_last_claim_at": now_iso, "gauntlet_last_score": score, "gauntlet_last_cash": cash, "gauntlet_last_respect": respect}},
            upsert=True,
        )
        try:
            await log_activity(current_user["id"], f"Claimed ${cash:,} and {respect} respect from Flappy Gangster (score {score}).")
        except Exception:
            pass

        user_doc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1, "respect_points": 1})
        return {
            "cash_awarded": cash,
            "respect_awarded": respect,
            "label": reward["label"],
            "tier": reward["tier"],
            "score": score,
            "money": int((user_doc or {}).get("money") or 0),
            "plays_left": plays_left,
            "resets_at": reset_iso,
        }
