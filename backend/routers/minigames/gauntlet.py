# Flappy Gangster (Flappy-style) — cash and respect rewards by score. Infinite levels; caps per run.
from datetime import datetime, timezone
import secrets
import uuid

from fastapi import Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from typing import List, Optional

from server import db, get_current_user, log_activity, log_minigame_payout, log_respect_earned, _get_staff_user_ids, _is_admin
from utils.game_timezone import game_week_range_utc
from utils.gauntlet_sim import normalize_flaps, simulate_gauntlet
from utils.minigame_captcha_gate import require_turnstile_for_minigame_start
from routers.minigames.minigame_leaderboard import log_minigame_play
from utils.minigame_run_session import (
    as_utc_started,
    claim_minigame_run_session,
    get_plays_left,
    start_minigame_run,
    utc_rate_limit_window,
    RATE_LIMIT_PERIOD_HOURS,
)


# Base tiers (score threshold -> cash, respect for that tier only; cumulative applied in _get_reward)
# 75% reduction for beta
REWARD_TIERS = [
    {"score": 25, "cash": 63, "respect": 0, "label": "Street Punk"},
    {"score": 50, "cash": 250, "respect": 5, "label": "Corner Boy"},
    {"score": 100, "cash": 625, "respect": 10, "label": "Made Man"},
    {"score": 200, "cash": 1_500, "respect": 15, "label": "Underboss"},
    {"score": 350, "cash": 3_125, "respect": 25, "label": "Capo"},
    {"score": 500, "cash": 6_250, "respect": 40, "label": "Don"},
]

# Caps per single run (infinite levels, but one claim cannot exceed these)
MAX_CASH_PER_CLAIM = 250_000  # 75% reduction
MAX_RESPECT_PER_CLAIM = 300

CASH_PER_GATE_AFTER_MAX = 500  # 75% reduction
RESPECT_PER_GATE_AFTER_MAX = 1

# Reject only absurd client-reported scores. Per-run cash/respect are still capped by _get_reward.
MAX_SCORE_SANITY = 100_000
MAX_PLAYS_PER_HOUR = 10

MIN_PLAY_SECONDS = 3

GAUNTLET_GAME_SLUG = "gauntlet"


def _dt_to_iso_z(dt: datetime) -> str:
    """Same canonical string as gauntlet_scores.at on insert (ISO Z, no microseconds)."""
    d = dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return d.replace(microsecond=0).isoformat().replace("+00:00", "Z")


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

    if score > 500:
        extra_gates = score - 500
        cash += min(MAX_CASH_PER_CLAIM - cash, extra_gates * CASH_PER_GATE_AFTER_MAX)
        respect += min(MAX_RESPECT_PER_CLAIM - respect, extra_gates * RESPECT_PER_GATE_AFTER_MAX)

    cash = min(MAX_CASH_PER_CLAIM, cash)
    respect = min(MAX_RESPECT_PER_CLAIM, respect)
    return {"cash": cash, "respect": respect, "label": label, "tier": tier, "score": score}


class GauntletStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    theme: Optional[str] = None
    speed: Optional[str] = None
    difficulty: Optional[str] = None
    captcha_token: Optional[str] = None


class GauntletClaimRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Client score is display-only; rewards/leaderboard use server re-sim from flaps.
    score: Optional[int] = 0
    session_id: Optional[str] = None
    flaps: List[int] = Field(default_factory=list)
    theme: Optional[str] = None
    speed: Optional[str] = None
    difficulty: Optional[str] = None


async def _gauntlet_best_score_for_user(user_id: str) -> int:
    """Best gate score for unlocks: user_meta (authoritative) plus max from score history if present."""
    doc = await db.user_meta.find_one({"user_id": user_id}, {"_id": 0, "gauntlet_best_score": 1})
    meta_best = int((doc or {}).get("gauntlet_best_score") or 0)
    try:
        rows = await db.gauntlet_scores.find({"user_id": user_id}, {"_id": 0, "score": 1}).sort("score", -1).limit(1).to_list(1)
        hist_best = int(rows[0]["score"]) if rows else 0
    except Exception:
        hist_best = 0
    return max(meta_best, hist_best)


def register(router):
    @router.get("/gauntlet/me")
    async def gauntlet_me(current_user: dict = Depends(get_current_user)):
        """Personal best gate score (for character/theme unlocks) and plays window (optional for UI)."""
        uid = current_user["id"]
        best = await _gauntlet_best_score_for_user(uid)
        pl = await get_plays_left(db, user_id=uid, game=GAUNTLET_GAME_SLUG)
        return {
            "best_score": best,
            "plays_left": pl.get("plays_left"),
            "max_plays": pl.get("max_plays"),
            "resets_at": pl.get("resets_at"),
        }

    @router.get("/gauntlet/leaderboard")
    async def gauntlet_leaderboard(
        period: str = Query("weekly", description="weekly (Mon 00:00 UK) or alltime"),
        current_user: dict = Depends(get_current_user),
    ):
        p = (period or "weekly").lower()
        now_dt = datetime.now(timezone.utc)
        staff_ids = await _get_staff_user_ids()
        staff_match = {"user_id": {"$nin": staff_ids}} if staff_ids else {}
        if p == "weekly":
            ws, we = game_week_range_utc(now_dt)
            ws_iso = _dt_to_iso_z(ws)
            we_iso = _dt_to_iso_z(we)
            match = {"at": {"$gte": ws_iso, "$lt": we_iso}, **staff_match}
            pipeline = [
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
    async def gauntlet_start(
        body: GauntletStartRequest,
        request: Request,
        current_user: dict = Depends(get_current_user),
    ):
        """Open a server-timed run; claims must reference the returned session_id."""
        await require_turnstile_for_minigame_start(
            db,
            request=request,
            current_user=current_user,
            captcha_token=body.captcha_token,
            is_admin=_is_admin(current_user),
        )
        meta = {}
        if body.theme:
            meta["theme"] = (body.theme or "")[:64]
        if body.speed:
            meta["speed"] = (body.speed or "")[:32]
        if body.difficulty:
            meta["difficulty"] = (body.difficulty or "")[:32]
        seed = secrets.token_hex(16)
        meta["seed"] = seed
        resp = await start_minigame_run(
            db,
            user_id=current_user["id"],
            game=GAUNTLET_GAME_SLUG,
            meta=meta,
        )
        resp["seed"] = seed
        return resp

    @router.post("/gauntlet/claim")
    async def gauntlet_claim(payload: GauntletClaimRequest, current_user: dict = Depends(get_current_user)):
        now_dt = datetime.now(timezone.utc).replace(microsecond=0)
        now_iso = now_dt.isoformat().replace("+00:00", "Z")
        hour_start, reset_dt = utc_rate_limit_window(now_dt)
        hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")
        reset_iso = reset_dt.isoformat().replace("+00:00", "Z")
        uid = current_user["id"]

        session_id = (payload.session_id or "").strip()
        if not session_id:
            raise HTTPException(status_code=400, detail="Start a run before claiming (missing session).")

        try:
            flaps = normalize_flaps(payload.flaps or [])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e) or "Invalid flaps.") from e

        plays_gate = await get_plays_left(db, user_id=uid, game=GAUNTLET_GAME_SLUG)
        if plays_gate["plays_left"] == 0:
            raise HTTPException(
                status_code=429,
                detail=f"Play limit reached ({plays_gate['max_plays']} per {RATE_LIMIT_PERIOD_HOURS}h). Resets at {plays_gate['resets_at']}.",
            )

        sess = await claim_minigame_run_session(
            db, user_id=uid, game=GAUNTLET_GAME_SLUG, session_id=session_id, now_dt=now_dt
        )

        started_at = as_utc_started(sess.get("started_at"))
        elapsed = max(0.0, (now_dt - started_at).total_seconds())
        if elapsed < MIN_PLAY_SECONDS:
            raise HTTPException(status_code=400, detail="Game too short.")

        sess_meta = sess.get("meta") if isinstance(sess.get("meta"), dict) else {}
        seed = str(sess_meta.get("seed") or "").strip()
        if not seed:
            raise HTTPException(status_code=400, detail="Run seed missing; start a new run.")

        speed = str(sess_meta.get("speed") or "normal")
        difficulty = str(sess_meta.get("difficulty") or "normal")
        if payload.speed is not None and str(payload.speed).strip() and str(payload.speed).strip() != speed:
            raise HTTPException(status_code=400, detail="Speed does not match this run.")
        if payload.difficulty is not None and str(payload.difficulty).strip() and str(payload.difficulty).strip() != difficulty:
            raise HTTPException(status_code=400, detail="Difficulty does not match this run.")

        try:
            sim = simulate_gauntlet(
                seed=seed,
                flaps=flaps,
                speed=speed,
                difficulty=difficulty,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e) or "Invalid flaps.") from e

        score = int(sim.get("score") or 0)
        if score < 0 or score > MAX_SCORE_SANITY:
            raise HTTPException(status_code=400, detail="Score outside allowed range.")

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
