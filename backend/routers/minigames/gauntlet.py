# Flappy Gangster (Flappy-style) — cash and respect rewards by score. Infinite levels; caps per run.
from datetime import datetime, timezone, timedelta
import uuid

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from server import db, get_current_user, log_activity, log_minigame_payout, log_respect_earned, _get_staff_user_ids
from routers.minigames.minigame_leaderboard import log_minigame_play
from utils.minigame_run_session import (
    as_utc_started,
    claim_minigame_run_session,
    get_plays_left,
    max_numeric_score_for_session,
    release_minigame_run,
    start_minigame_run,
    utc_rate_limit_window,
    RATE_LIMIT_PERIOD_HOURS,
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
MAX_RESPECT_PER_CLAIM = 300

# Beyond tier 50: every gate adds this cash (until cap) and 2 respect (until cap)
CASH_PER_GATE_AFTER_50 = 500  # 75% reduction
RESPECT_PER_GATE_AFTER_50 = 2

# Reject only absurd client-reported scores. Per-run cash/respect are still capped by _get_reward.
# Anti-cheat is enforce_numeric_score_for_claimed_session (elapsed × max gates/sec + buffer).
MAX_SCORE_SANITY = 100_000
MAX_PLAYS_PER_HOUR = 10

# Pipe-rate caps per speed×difficulty combination (real gameplay caps ~0.5-0.88 gates/sec).
# { speed_id: { difficulty_id: max_gates_per_second } }
_SPEED_MULTS = {"slow": 0.7, "normal": 1.0, "fast": 1.4}
_DIFF_SPEED_MULTS = {"easy": 0.85, "normal": 1.0, "hard": 1.25, "insane": 1.65}
_BASE_SPAWN_TICKS = 95
_TICK_MS = 1000 / 60

def _max_rate_for_mode(speed: str, difficulty: str) -> float:
    """Max plausible gates/sec for a given speed + difficulty, with 80% headroom."""
    sm = _SPEED_MULTS.get(speed, 1.0)
    spawn_ticks = max(40, round(_BASE_SPAWN_TICKS / sm))
    spawn_sec = spawn_ticks * _TICK_MS / 1000.0
    real_rate = 1.0 / spawn_sec
    return real_rate * 1.35  # modest buffer; score is still capped by session timing

# Fallback if mode lookup fails
MAX_GATES_PER_SECOND = 1.5
SCORE_TIME_BUFFER = 4
MIN_PLAY_SECONDS = 3

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
        raw_score = int(payload.score or 0)
        if raw_score < 0:
            raise HTTPException(status_code=400, detail="Invalid score.")
        if raw_score > MAX_SCORE_SANITY:
            raise HTTPException(status_code=400, detail="Score outside allowed range.")

        now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now_dt.isoformat().replace("+00:00", "Z")
        hour_start, reset_dt = utc_rate_limit_window(now_dt)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")
        reset_iso = reset_dt.isoformat().replace("+00:00", "Z")
        uid = current_user["id"]

        session_id = (payload.session_id or "").strip()
        if not session_id:
            raise HTTPException(status_code=400, detail="Start a run before claiming (missing session).")
        sess = await claim_minigame_run_session(
            db, user_id=uid, game=GAUNTLET_GAME_SLUG, session_id=session_id, now_dt=now_dt
        )

        started_at = as_utc_started(sess.get("started_at"))
        elapsed = max(0.0, (now_dt - started_at).total_seconds())
        if elapsed < MIN_PLAY_SECONDS:
            await release_minigame_run(db, session_id)
            raise HTTPException(status_code=400, detail="Game too short.")

        sess_meta = sess.get("meta") or {}
        sess_speed = sess_meta.get("speed", "normal")
        sess_diff = sess_meta.get("difficulty", "normal")
        claim_speed = (payload.speed or "normal").strip()
        claim_diff = (payload.difficulty or "normal").strip()
        if claim_speed != sess_speed or claim_diff != sess_diff:
            await release_minigame_run(db, session_id)
            raise HTTPException(status_code=400, detail="Speed/difficulty mismatch with session.")

        rate = _max_rate_for_mode(sess_speed, sess_diff)
        max_allowed = max_numeric_score_for_session(
            sess,
            now_dt=now_dt,
            max_score_cap=MAX_SCORE_SANITY,
            rate_per_second=rate,
            buffer=SCORE_TIME_BUFFER,
        )
        # Authoritative score: client-reported value cannot exceed physics bound for this session duration.
        score = min(raw_score, max_allowed)

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
                if session_id:
                    await release_minigame_run(db, session_id)
                raise HTTPException(
                    status_code=429,
                    detail=f"Play limit reached ({MAX_PLAYS_PER_HOUR} per {RATE_LIMIT_PERIOD_HOURS}h). Try again in {remaining}s.",
                )

        meta_after = await db.user_meta.find_one({"user_id": uid}, {"_id": 0, "gauntlet_hour_count": 1})
        plays_left = max(0, MAX_PLAYS_PER_HOUR - int((meta_after or {}).get("gauntlet_hour_count") or 0))

        reward = _get_reward(score)
        cash = int(reward["cash"] or 0)
        respect = int(reward["respect"] or 0)

        async def _bump_best() -> int:
            await db.user_meta.update_one(
                {"user_id": uid},
                {"$max": {"gauntlet_best_score": score}, "$setOnInsert": {"user_id": uid}},
                upsert=True,
            )
            doc = await db.user_meta.find_one({"user_id": uid}, {"_id": 0, "gauntlet_best_score": 1})
            return int((doc or {}).get("gauntlet_best_score") or 0)

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
            best_out = await _bump_best()
            return {
                "ok": True,
                "score": score,
                "cash": 0,
                "respect": 0,
                "best_score": best_out,
                "plays_left": plays_left,
                "resets_at": reset_iso,
            }

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
        best_out = await _bump_best()
        payout_rewards = {"money": cash, "respect_points": respect}
        try:
            await log_activity(current_user["id"], current_user.get("username", "?"), "minigame_gauntlet", {"score": score, "cash": cash, "respect": respect})
        except Exception:
            pass
        try:
            await log_minigame_payout(current_user["id"], current_user.get("username", "?"), "gauntlet", score, payout_rewards)
        except Exception:
            pass

        return {
            "ok": True,
            "score": score,
            "cash": cash,
            "respect": respect,
            "best_score": best_out,
            "plays_left": plays_left,
            "resets_at": reset_iso,
        }
