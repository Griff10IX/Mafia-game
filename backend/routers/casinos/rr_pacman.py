# Road Runner Pac-Man arcade: runs, campaign progress, leaderboards and daily rewards.
# Admin-only while RR_PACMAN_ADMIN_ONLY is true.
from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from server import db, get_current_user_verified, require_admin_verified

logger = logging.getLogger(__name__)

RR_PACMAN_ADMIN_ONLY = True
_auth = require_admin_verified if RR_PACMAN_ADMIN_ONLY else get_current_user_verified

CAMPAIGN_LEVELS = 35
LEVELS_PER_WORLD = 5
RUN_MAX_AGE = timedelta(hours=3)
SKIN_UNLOCKS = {"mafia": 15, "cop": 25}
SKINS = ("classic", "mafia", "cop", "gold")
SYSTEM_AI_AVATAR = "/images/system-ai-profile.jpg?v=5"

# Each tier pays once per UTC day, based on the day's best endless score.
DAILY_TIERS = [
    {"score": 10_000, "points": 100, "bullets": 1_000},
    {"score": 30_000, "points": 250, "bullets": 3_000},
    {"score": 60_000, "points": 500, "bullets": 7_500},
    {"score": 100_000, "points": 1_000, "bullets": 15_000},
]
DAILY_TOP3 = [
    {"points": 2_500, "bullets": 25_000},
    {"points": 1_500, "bullets": 15_000},
    {"points": 1_000, "bullets": 10_000},
]

# Plausibility limits (mirror src/pages/Arcade/rrPacman/tuning.js scoring).
MAX_SEEDS_PER_LEVEL = 300
MAX_ENEMY_POINTS = 1_600
MAX_BONUS_POINTS = 10_000
BOSS_POINTS_PER_WORLD = 5_000
BOSS_HIT_POINTS = 1_000
BOSS_HP = 3
MAX_SEEDS_PER_SECOND = 15


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class StartRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    mode: str = Field(pattern="^(endless|campaign)$")
    level: int = Field(default=1, ge=1, le=CAMPAIGN_LEVELS)


class FinishRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    run_token: str = Field(min_length=10, max_length=80)
    score: int = Field(ge=0, le=50_000_000)
    level_reached: int = Field(ge=1, le=10_000)
    seeds_eaten: int = Field(ge=0)
    bags_eaten: int = Field(ge=0)
    enemies_eaten: int = Field(ge=0)
    bonus_items: int = Field(ge=0)
    boss_kills: int = Field(ge=0)
    lives_lost: int = Field(ge=0, le=100)
    cleared: bool = False
    stars: int = Field(default=0, ge=0, le=3)


class SkinRequest(BaseModel):
    skin: str


async def _progress(user_id: str) -> Dict[str, Any]:
    doc = await db.rr_pacman_progress.find_one({"user_id": user_id}, {"_id": 0})
    return doc or {"user_id": user_id, "stars": {}, "unlocked": 1, "skins": ["classic"], "skin": "classic", "best_score": 0}


def _public_progress(p: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "stars": p.get("stars") or {},
        "unlocked": int(p.get("unlocked") or 1),
        "skins": p.get("skins") or ["classic"],
        "skin": p.get("skin") or "classic",
        "best_score": int(p.get("best_score") or 0),
    }


def _boss_levels_between(start: int, end: int) -> int:
    return sum(1 for lv in range(start, end + 1) if lv % 5 == 0)


def _validate(run: Dict[str, Any], req: FinishRequest, elapsed_s: float) -> Optional[str]:
    start_level = int(run.get("level") or 1)
    if req.level_reached < start_level:
        return "level"
    if run["mode"] == "campaign" and req.level_reached != start_level:
        return "level"
    played = req.level_reached - start_level + 1
    bosses = _boss_levels_between(start_level, req.level_reached)
    if req.seeds_eaten > played * MAX_SEEDS_PER_LEVEL:
        return "seeds"
    if req.enemies_eaten > (played - bosses) * 16:
        return "enemies"
    if req.bonus_items > (played - bosses) * 2:
        return "bonus"
    if req.boss_kills > bosses:
        return "boss"
    if req.bags_eaten > played * 4 + bosses * 40:
        return "bags"
    if req.seeds_eaten > max(1.0, elapsed_s) * MAX_SEEDS_PER_SECOND:
        return "speed"
    max_world = 7
    base = (
        req.seeds_eaten * 10
        + req.bags_eaten * 50
        + req.enemies_eaten * MAX_ENEMY_POINTS
        + req.bonus_items * MAX_BONUS_POINTS
        + bosses * BOSS_HIT_POINTS * BOSS_HP
        + req.boss_kills * BOSS_POINTS_PER_WORLD * max_world
    )
    if req.score > base * 2:
        return "score"
    return None


async def _grant(user_id: str, points: int, bullets: int, event_type: str, origin_ref: str, meta: Dict[str, Any]) -> None:
    before = await db.users.find_one_and_update(
        {"id": user_id},
        {"$inc": {"points": points, "bullets": bullets}},
        projection={"_id": 0, "points": 1},
        return_document=ReturnDocument.BEFORE,
    )
    if not before:
        return
    pts_before = int(before.get("points") or 0)
    try:
        await db.point_ledger_events.insert_one({
            "id": str(uuid.uuid4()),
            "event_type": event_type,
            "user_id": user_id,
            "points": points,
            "lot_id": None,
            "origin_ref": origin_ref,
            "root_purchase_ref": None,
            "meta": {"bullets": bullets, **meta},
            "created_at": _now_iso(),
            "wallet_points_before": pts_before,
            "wallet_points_after": pts_before + points,
            "source": "rr_pacman",
        })
    except Exception:
        logger.exception("rr_pacman ledger write failed for %s (%s)", user_id, origin_ref)


async def _claim_daily_tiers(user_id: str, day: str, best: int) -> List[Dict[str, Any]]:
    paid = []
    for i, tier in enumerate(DAILY_TIERS):
        if best < tier["score"]:
            break
        claimed = await db.rr_pacman_daily.find_one_and_update(
            {"user_id": user_id, "day": day, "claimed": {"$ne": i}},
            {"$addToSet": {"claimed": i}},
        )
        if not claimed:
            continue
        await _grant(user_id, tier["points"], tier["bullets"], "rr_pacman_daily_tier", f"rr_pacman_tier:{user_id}:{day}:{i}", {"tier": i, "score": tier["score"]})
        paid.append({"tier": i, **tier})
    return paid


async def _settle_yesterday() -> None:
    day = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    try:
        await db.rr_pacman_settlements.insert_one({"_id": day, "settled_at": _now_iso()})
    except DuplicateKeyError:
        return
    top = await db.rr_pacman_daily.find({"day": day, "best": {"$gt": 0}}, {"_id": 0}).sort("best", -1).limit(3).to_list(3)
    for place, row in enumerate(top):
        prize = DAILY_TOP3[place]
        await _grant(row["user_id"], prize["points"], prize["bullets"], "rr_pacman_daily_top3", f"rr_pacman_top3:{day}:{place + 1}", {"place": place + 1, "score": row["best"], "day": day})
        try:
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": row["user_id"],
                "title": f"Road Runner Pac-Man: #{place + 1} yesterday",
                "message": (
                    f"{row.get('username') or 'Player'},\n\nThis is the System AI.\n\n"
                    f"You finished #{place + 1} on yesterday's Road Runner Pac-Man board with {row['best']:,} points.\n\n"
                    f"Reward: {prize['points']:,} points and {prize['bullets']:,} bullets, already on your account.\n\n— System AI"
                ),
                "notification_type": "system",
                "category": "system",
                "read": False,
                "created_at": _now_iso(),
                "system_ai": True,
                "avatar_url": SYSTEM_AI_AVATAR,
            })
        except Exception:
            logger.exception("rr_pacman top3 inbox failed for %s", row["user_id"])


async def _leaderboards() -> Dict[str, Any]:
    day = _today()
    daily = await db.rr_pacman_daily.find({"day": day, "best": {"$gt": 0}}, {"_id": 0, "username": 1, "best": 1, "user_id": 1}).sort("best", -1).limit(20).to_list(20)
    all_time = await db.rr_pacman_progress.find({"best_score": {"$gt": 0}}, {"_id": 0, "username": 1, "best_score": 1, "user_id": 1}).sort("best_score", -1).limit(20).to_list(20)
    return {
        "day": day,
        "daily": [{"username": r.get("username") or "Player", "score": int(r["best"]), "user_id": r["user_id"]} for r in daily],
        "all_time": [{"username": r.get("username") or "Player", "score": int(r["best_score"]), "user_id": r["user_id"]} for r in all_time],
    }


def register(router):
    @router.get("/arcade/rr-pacman/config")
    async def rr_pacman_config(current_user: dict = Depends(_auth)):
        await _settle_yesterday()
        uid = current_user["id"]
        p = await _progress(uid)
        daily = await db.rr_pacman_daily.find_one({"user_id": uid, "day": _today()}, {"_id": 0}) or {}
        return {
            "admin_only": RR_PACMAN_ADMIN_ONLY,
            "progress": _public_progress(p),
            "today_best": int(daily.get("best") or 0),
            "claimed_tiers": daily.get("claimed") or [],
            "tiers": DAILY_TIERS,
            "top3_prizes": DAILY_TOP3,
            "skin_unlocks": SKIN_UNLOCKS,
        }

    @router.post("/arcade/rr-pacman/start")
    async def rr_pacman_start(req: StartRequest, current_user: dict = Depends(_auth)):
        uid = current_user["id"]
        level = req.level if req.mode == "campaign" else 1
        if req.mode == "campaign":
            p = await _progress(uid)
            if level > int(p.get("unlocked") or 1):
                raise HTTPException(status_code=400, detail="That stage is still locked")
        token = secrets.token_urlsafe(24)
        await db.rr_pacman_runs.insert_one({
            "token": token, "user_id": uid, "mode": req.mode, "level": level,
            "started_at": datetime.now(timezone.utc), "used": False,
        })
        return {"run_token": token, "mode": req.mode, "level": level}

    @router.post("/arcade/rr-pacman/finish")
    async def rr_pacman_finish(req: FinishRequest, current_user: dict = Depends(_auth)):
        uid = current_user["id"]
        run = await db.rr_pacman_runs.find_one_and_update(
            {"token": req.run_token, "user_id": uid, "used": False},
            {"$set": {"used": True, "finished_at": datetime.now(timezone.utc)}},
        )
        if not run:
            raise HTTPException(status_code=400, detail="Run already submitted or not found")
        started = run["started_at"]
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        elapsed = datetime.now(timezone.utc) - started
        if elapsed > RUN_MAX_AGE:
            raise HTTPException(status_code=400, detail="Run expired")
        reason = _validate(run, req, elapsed.total_seconds())
        if reason:
            await db.rr_pacman_runs.update_one({"token": req.run_token}, {"$set": {"rejected": reason, "payload": req.model_dump()}})
            logger.warning("rr_pacman run rejected (%s) for %s: %s", reason, uid, req.model_dump())
            return {"accepted": False, "reason": reason}

        await db.rr_pacman_runs.update_one({"token": req.run_token}, {"$set": {"payload": req.model_dump()}})
        username = current_user.get("username") or "Player"
        p = await _progress(uid)
        out: Dict[str, Any] = {"accepted": True, "score": req.score, "rewards": [], "new_best": False, "new_skins": []}
        if run["mode"] == "endless":
            day = _today()
            await db.rr_pacman_daily.update_one(
                {"user_id": uid, "day": day},
                {"$max": {"best": req.score}, "$set": {"username": username}, "$setOnInsert": {"claimed": []}},
                upsert=True,
            )
            daily = await db.rr_pacman_daily.find_one({"user_id": uid, "day": day}, {"_id": 0, "best": 1})
            out["rewards"] = await _claim_daily_tiers(uid, day, int(daily.get("best") or 0))
            out["new_best"] = req.score > int(p.get("best_score") or 0)
            await db.rr_pacman_progress.update_one(
                {"user_id": uid},
                {"$max": {"best_score": req.score}, "$set": {"username": username},
                 "$setOnInsert": {"stars": {}, "unlocked": 1, "skins": ["classic"], "skin": "classic"}},
                upsert=True,
            )
        elif req.cleared:
            level = int(run["level"])
            stars = 1 if req.lives_lost > 0 else max(1, min(3, req.stars))
            stars_map = dict(p.get("stars") or {})
            stars_map[str(level)] = max(int(stars_map.get(str(level)) or 0), stars)
            unlocked = min(CAMPAIGN_LEVELS, max(int(p.get("unlocked") or 1), level + 1))
            skins = list(p.get("skins") or ["classic"])
            for skin, need in SKIN_UNLOCKS.items():
                if level >= need and skin not in skins:
                    skins.append(skin)
                    out["new_skins"].append(skin)
            if "gold" not in skins and all(int(stars_map.get(str(lv)) or 0) >= 3 for lv in range(1, CAMPAIGN_LEVELS + 1)):
                skins.append("gold")
                out["new_skins"].append("gold")
            await db.rr_pacman_progress.update_one(
                {"user_id": uid},
                {"$set": {"stars": stars_map, "unlocked": unlocked, "skins": skins, "username": username},
                 "$setOnInsert": {"skin": "classic", "best_score": 0}},
                upsert=True,
            )
            out.update({"stars": stars, "unlocked": unlocked})
        out["progress"] = _public_progress(await _progress(uid))
        return out

    @router.post("/arcade/rr-pacman/skin")
    async def rr_pacman_skin(req: SkinRequest, current_user: dict = Depends(_auth)):
        if req.skin not in SKINS:
            raise HTTPException(status_code=400, detail="Unknown skin")
        p = await _progress(current_user["id"])
        if req.skin not in (p.get("skins") or ["classic"]):
            raise HTTPException(status_code=400, detail="Skin not unlocked yet")
        await db.rr_pacman_progress.update_one(
            {"user_id": current_user["id"]},
            {"$set": {"skin": req.skin},
             "$setOnInsert": {"stars": {}, "unlocked": 1, "skins": ["classic"], "best_score": 0, "username": current_user.get("username")}},
            upsert=True,
        )
        return {"skin": req.skin}

    @router.get("/arcade/rr-pacman/leaderboard")
    async def rr_pacman_leaderboard(current_user: dict = Depends(_auth)):
        await _settle_yesterday()
        return await _leaderboards()
