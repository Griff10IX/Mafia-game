# Crime endpoints: list crimes, commit crime
import asyncio
from collections import defaultdict
from typing import Dict, List, Optional
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
import secrets
_rng = secrets.SystemRandom()
import os
import sys
import logging
from fastapi import Depends, HTTPException

from utils.referral_ids import (
    apply_referrer_referral_increment,
    normalize_referred_by_ids,
    referral_pool_int,
    split_referral_pool,
    user_has_referrers,
)

logger = logging.getLogger(__name__)

# Serialize crime commits per user within this process (same pattern as family raid / stock buy locks).
# Multiple API workers do not share this — use Redis Redlock or MongoDB advisory docs if you scale horizontally.
_crime_commit_locks: Dict[str, asyncio.Lock] = {}
_crime_commit_locks_guard = asyncio.Lock()


async def _get_crime_commit_lock(user_id: str) -> asyncio.Lock:
    async with _crime_commit_locks_guard:
        if user_id not in _crime_commit_locks:
            _crime_commit_locks[user_id] = asyncio.Lock()
        return _crime_commit_locks[user_id]


# Progress bar: 25-92%. Success +6-8%. Fail -1-3%; once you've hit max, floor is 77% (never drop more than 15% from max)
CRIME_PROGRESS_MIN = 25
CRIME_PROGRESS_MAX = 92
CRIME_PROGRESS_GAIN_MIN = 6
CRIME_PROGRESS_GAIN_MAX = 8
CRIME_PROGRESS_DROP_PER_FAIL_MIN = 1
CRIME_PROGRESS_DROP_PER_FAIL_MAX = 3
CRIME_PROGRESS_MAX_DROP_FROM_PEAK = 15    # once hit 92%, can never go below 77%

# 10% harder: success roll uses this multiplier
CRIME_DIFFICULTY_MULT = 0.9

CRIME_SUCCESS_MESSAGES = [
    "Success! You earned ${reward:,} and {rank_points} rank points",
    "Clean score. ${reward:,} and {rank_points} rank points in your pocket.",
    "The job went smooth. You earned ${reward:,} and {rank_points} rank points.",
    "Nice work. ${reward:,} and {rank_points} rank points.",
    "No heat. You got away with ${reward:,} and {rank_points} rank points.",
    "Smooth run. ${reward:,} and {rank_points} rank points earned.",
    "Done. ${reward:,} and {rank_points} rank points.",
    "Clean getaway. ${reward:,} and {rank_points} rank points.",
    "Score. ${reward:,} and {rank_points} rank points.",
    "The take is yours. ${reward:,} and {rank_points} rank points.",
]
CRIME_SUCCESS_MESSAGES_CASH_ONLY = [
    "Success! You earned ${reward:,}.",
    "Clean score. ${reward:,} in your pocket.",
    "The job went smooth. You earned ${reward:,}.",
    "Nice work. You made ${reward:,}.",
    "No heat. You got away with ${reward:,}.",
    "Smooth run. ${reward:,} earned.",
    "Done. ${reward:,}.",
    "Clean getaway. ${reward:,}.",
    "Score. ${reward:,}.",
    "The take is yours: ${reward:,}.",
]
# 75% harder to earn respect from crimes (award 25% of base/milestone)
RESPECT_FROM_CRIMES_MULT = 0.25

# One-time respect_points rewards when total_crimes crosses milestones (same progression as busts)
CRIME_MILESTONES = [
    100, 500, 1000, 2000, 5000,
    10_000, 25_000, 50_000, 100_000, 250_000,
    500_000, 1_000_000, 2_000_000, 5_000_000,
]
CRIME_MILESTONE_REWARDS = {
    100: 10, 500: 25, 1000: 50, 2000: 100, 5000: 250,
    10_000: 500, 25_000: 1000, 50_000: 2000, 100_000: 4000, 250_000: 8000,
    500_000: 15_000, 1_000_000: 30_000, 2_000_000: 60_000, 5_000_000: 150_000,
}


async def _award_crime_milestones(user_id: str, new_total_crimes: int, claimed: list) -> None:
    """If new_total_crimes crosses any unclaimed milestone, award respect_points and mark claimed."""
    new_claimed = [m for m in CRIME_MILESTONES if m <= new_total_crimes and m not in claimed]
    if not new_claimed:
        return
    total_reward = sum(CRIME_MILESTONE_REWARDS.get(m, 0) for m in new_claimed)
    total_reward = int(total_reward * RESPECT_FROM_CRIMES_MULT)
    if total_reward <= 0:
        await db.users.update_one({"id": user_id}, {"$addToSet": {"respect_points_crime_milestones_claimed": {"$each": new_claimed}}})
        return
    try:
        await db.users.update_one(
            {"id": user_id},
            {"$inc": {"respect_points": total_reward}, "$addToSet": {"respect_points_crime_milestones_claimed": {"$each": new_claimed}}},
        )
        await log_respect_earned(user_id, total_reward, "crime_milestone")
        milestones_str = ", ".join(f"{m:,}" for m in sorted(new_claimed))
        await send_notification(
            user_id,
            "Crime milestone reached!",
            f"You reached crime milestones: {milestones_str}. You earned {total_reward:,} respect points.",
            "system",
            category="system",
        )
        from routers.game.achievements import log_badge_events
        await log_badge_events(user_id, "crimes", new_claimed)
    except Exception as e:
        logger.exception("Award crime milestones: %s", e)


CRIME_FAIL_MESSAGES = [
    "The job went sideways. Better luck next time.",
    "Someone talked. The heat was waiting — no score this time.",
    "Sloppy work. You got away clean but came up empty.",
    "Wrong place, wrong time. The mark got wise.",
    "You had to ditch the take and run. Next time.",
    "A flatfoot showed up. You slipped out with nothing.",
    "The setup fell apart. Live to score another day.",
    "Bad break. No payout this time.",
    "Something didn't feel right — you walked. Smart, but broke.",
    "The coppers were onto it. You got out with your skin, that's it.",
]


def _progress_from_attempts(crime_attempts: int) -> int:
    """Migrate old attempts-based progress to new bar value (25-92)."""
    if crime_attempts < 100:
        return 25
    elif crime_attempts < 300:
        return 25
    elif crime_attempts < 600:
        return 40
    elif crime_attempts < 1200:
        return 55
    elif crime_attempts < 2500:
        return 70
    elif crime_attempts < 5000:
        return 82
    else:
        return 92


def _parse_iso_datetime(val):
    """Parse datetime from DB (string with optional Z, or datetime object). Avoids 500 on Python < 3.11."""
    if val is None:
        return None
    if hasattr(val, "year"):
        return val
    s = str(val).strip().replace("Z", "+00:00")
    return datetime.fromisoformat(s)


async def _dedup_user_crimes(user_id: str, crime_id: str):
    """Remove duplicate user_crimes rows for one (user, crime), keeping the best row."""
    try:
        docs = await db.user_crimes.find(
            {"user_id": user_id, "crime_id": crime_id},
        ).to_list(500)
        if len(docs) <= 1:
            return
        best = max(docs, key=lambda r: int(r.get("attempts", 0) or 0))
        ids_to_delete = [d["_id"] for d in docs if d["_id"] != best["_id"]]
        if ids_to_delete:
            await db.user_crimes.delete_many({"_id": {"$in": ids_to_delete}})
            logger.info("Deduped user_crimes for user=%s crime=%s: removed %d duplicates", user_id, crime_id, len(ids_to_delete))
    except Exception as e:
        logger.warning("_dedup_user_crimes error: %s", e)


def _merge_user_crime_duplicate_rows(rows: list) -> Optional[dict]:
    """Multiple user_crimes for one crime_id: strictest cooldown (latest future until) + row with max attempts for progress."""
    if not rows:
        return None
    if len(rows) == 1:
        return rows[0]
    now = datetime.now(timezone.utc)
    base = max(rows, key=lambda r: int(r.get("attempts", 0) or 0))
    out = dict(base)
    strictest_iso = None
    strictest_dt = None
    for r in rows:
        iso = r.get("cooldown_until")
        if not iso:
            continue
        dt = _parse_iso_datetime(iso)
        if dt is None:
            continue
        if getattr(dt, "tzinfo", None) is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if dt > now:
            if strictest_dt is None or dt > strictest_dt:
                strictest_dt = dt
                strictest_iso = iso
    if strictest_iso is not None:
        out["cooldown_until"] = strictest_iso
    else:
        out.pop("cooldown_until", None)
    pmax_vals = [int(r["progress_max"]) for r in rows if r.get("progress_max") is not None]
    if pmax_vals:
        out["progress_max"] = max(pmax_vals)
    return out


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class CrimeResponse(BaseModel):
    id: str
    name: str
    description: str
    min_rank: int
    min_rank_name: Optional[str] = None
    reward_min: int
    reward_max: int
    cooldown_minutes: float
    crime_type: str
    can_commit: bool
    next_available: Optional[str]
    attempts: int = 0
    successes: int = 0
    progress: int = 25
    unlocked: bool = True
    prestige_required: Optional[int] = None
    prestige_bonus: Optional[dict] = None


class CommitCrimeResponse(BaseModel):
    success: bool
    message: str
    reward: Optional[int]
    next_available: str
    progress_after: Optional[int] = None
    respect_points: int = 0
    prestige_bonus_earned: Optional[dict] = None
    rank_points_earned: int = 0  # RP granted this commit (prestige crimes = 10 base before perks); 0 on fail


class CommitAllCrimesResponse(BaseModel):
    committed: int
    failed: int
    total_cash: int
    total_respect: int
    errors: list[str]


# Global molotov drop from any successful crime
# 0.1% (~1 in 1,000 successful crimes) for 1 molotov
MOLOTOV_GLOBAL_DROP_CHANCE = 0.001
MOLOTOV_GLOBAL_DROP_AMOUNT = 1

# Successful crime cash (main roll + prestige bonus cash) scaled after all other multipliers
CRIME_CASH_PAYOUT_MULT = 1.485  # ~35% above prior 1.10 (1.10 × 1.35)

# Extremely rare loot box piece drops from crimes
# Normal crimes: ~0.05% (1 in 2,000) per successful crime
# Prestige crimes: ~0.15% (1 in 667) per successful crime
LOOT_PIECE_CHANCE_NORMAL = 0.0005
LOOT_PIECE_CHANCE_PRESTIGE = 0.0015
LOOT_PIECE_AMOUNT = 1

CASINO_HEIST_ID = "crime8"
CASINO_HEIST_FAIL_JAIL_SECONDS = 90
CASINO_HEIST_BUST_DIFFICULTY_MULT = 2.0


# ---------------------------------------------------------------------------
# Game data init (called from server on startup)
# ---------------------------------------------------------------------------

# Prestige-exclusive crimes — one per level, unlocked cumulatively (P3 can do P1, P2, P3)
# P1-P3: 30% rare bonus drop on top of cash; P4-P5: guaranteed all reward types × multiplier (store points only P4–P5)
PRESTIGE_CRIMES = [
    {
        "id": "prestige_crime_1", "name": "The Syndicate Run",
        "description": "Trusted work for the Made — slip packages through the city unseen. A rare score awaits the careful.",
        "min_rank": 1, "reward_min": 1_000_000, "reward_max": 2_000_000,
        "cooldown_seconds": 1800, "cooldown_minutes": 30, "crime_type": "prestige",
        "prestige_required": 1,
        "prestige_bonus": {
            "rare_chance": 0.30,
            "cash": [200_000, 800_000],
            "respect_points": [5, 20],
            "booze": {"id": "moonshine", "min": 1, "max": 3},
        },
    },
    {
        "id": "prestige_crime_2", "name": "Contraband Courier",
        "description": "Move illegal goods across state lines. Earners know which routes to take — and what's in the crates.",
        "min_rank": 1, "reward_min": 2_000_000, "reward_max": 3_250_000,
        "cooldown_seconds": 3600, "cooldown_minutes": 60, "crime_type": "prestige",
        "prestige_required": 2,
        "prestige_bonus": {
            "rare_chance": 0.30,
            "booze": {"id": "moonshine", "min": 2, "max": 5},
            "bullets": [6, 19],
        },
    },
    {
        "id": "prestige_crime_3", "name": "Black Market Deal",
        "description": "Broker a deal between factions — the Capo knows every buyer. Rare rewards flow to those who close.",
        "min_rank": 1, "reward_min": 3_250_000, "reward_max": 4_500_000,
        "cooldown_seconds": 7200, "cooldown_minutes": 120, "crime_type": "prestige",
        "prestige_required": 3,
        "prestige_bonus": {
            "rare_chance": 0.30,
            "booze": {"id": "moonshine", "min": 2, "max": 5},
            "bullets": [6, 19],
            "molotovs": [1, 1],
        },
    },
    {
        "id": "prestige_crime_4", "name": "The Commission's Work",
        "description": "Direct orders from the Commission. The Don delivers, and the rewards are always waiting.",
        "min_rank": 1, "reward_min": 4_500_000, "reward_max": 5_750_000,
        "cooldown_seconds": 14400, "cooldown_minutes": 240, "crime_type": "prestige",
        "prestige_required": 4,
        "prestige_bonus": {
            "multiplier": 0.5,
            "cash": [800_000, 3_200_000],
            "respect_points": [10, 30],
            "booze": {"id": "moonshine", "min": 3, "max": 8},
            "bullets": [10, 25],
            "points": [2, 5],
            "molotovs": [1, 2],
        },
    },
    {
        "id": "prestige_crime_5", "name": "Godfather's Orders",
        "description": "Only the Godfather Legacy receives these calls. Every reward, full measure.",
        "min_rank": 1, "reward_min": 5_750_000, "reward_max": 7_000_000,
        "cooldown_seconds": 28800, "cooldown_minutes": 480, "crime_type": "prestige",
        "prestige_required": 5,
        "prestige_bonus": {
            "multiplier": 1.0,
            "cash": [800_000, 3_200_000],
            "respect_points": [10, 30],
            "booze": {"id": "moonshine", "min": 3, "max": 8},
            "bullets": [10, 25],
            "points": [2, 5],
            "molotovs": [2, 3],
        },
    },
]


# Fallback seed only when DB is empty and data/crimes.json is missing
CRIMES_SEED_FALLBACK = [
    {"id": "crime1", "name": "Pickpocket", "description": "Steal from unsuspecting citizens - quick cash", "min_rank": 1, "reward_min": 100, "reward_max": 400, "cooldown_seconds": 15, "cooldown_minutes": 0.25, "crime_type": "petty"},
    {"id": "crime2", "name": "Mug a Pedestrian", "description": "Rob someone on the street", "min_rank": 1, "reward_min": 300, "reward_max": 800, "cooldown_seconds": 30, "cooldown_minutes": 0.5, "crime_type": "petty"},
    {"id": "crime3", "name": "Bootlegging", "description": "Smuggle illegal alcohol", "min_rank": 3, "reward_min": 1000, "reward_max": 2000, "cooldown_seconds": 120, "cooldown_minutes": 2, "crime_type": "medium"},
    {"id": "crime4", "name": "Armed Robbery", "description": "Rob a local store at gunpoint", "min_rank": 4, "reward_min": 2000, "reward_max": 3000, "cooldown_seconds": 300, "cooldown_minutes": 5, "crime_type": "medium"},
    {"id": "crime5", "name": "Extortion", "description": "Shake down local businesses", "min_rank": 5, "reward_min": 3000, "reward_max": 4000, "cooldown_seconds": 600, "cooldown_minutes": 10, "crime_type": "medium"},
    {"id": "crime6", "name": "Jewelry Heist", "description": "Rob a jewelry store", "min_rank": 6, "reward_min": 4000, "reward_max": 5000, "cooldown_seconds": 900, "cooldown_minutes": 15, "crime_type": "major"},
    {"id": "crime7", "name": "Bank Heist", "description": "Rob a bank vault - high risk, high reward", "min_rank": 8, "reward_min": 5000, "reward_max": 6000, "cooldown_seconds": 1800, "cooldown_minutes": 30, "crime_type": "major"},
    {"id": "crime8", "name": "Casino Heist", "description": "Rob a casino - the big score", "min_rank": 10, "reward_min": 7000, "reward_max": 9000, "cooldown_seconds": 3600, "cooldown_minutes": 60, "crime_type": "major"},
]


# In-memory cache for crime definitions (static until server restart / init). Cleared when init_crimes_data runs.
_crimes_cache: Optional[List[dict]] = None


def _load_crimes_seed():
    """Load crimes seed from backend/data/crimes.json, or return CRIMES_SEED_FALLBACK."""
    import json
    _backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(_backend, "data", "crimes.json")
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                data = json.load(f)
            return data if isinstance(data, list) else CRIMES_SEED_FALLBACK
        except Exception as e:
            logger.warning("Failed to load data/crimes.json: %s; using fallback", e)
    return CRIMES_SEED_FALLBACK


async def init_crimes_data(db_instance):
    """Initialize crimes from DB: if collection is empty, seed from data/crimes.json (or fallback).

    Standard crimes (crime1–crime8): always sync reward_min/reward_max from the same seed so
    editing backend/data/crimes.json takes effect without a manual Mongo migration.
    """
    global _crimes_cache
    _crimes_cache = None  # invalidate cache so next request gets fresh data
    logger.info("🔄 Initializing crimes data...")
    crimes_count = await db_instance.crimes.count_documents({})
    if crimes_count == 0:
        seed = _load_crimes_seed()
        if seed:
            await db_instance.crimes.insert_many(seed)
            logger.info("Seeded %d crimes from data/crimes.json (or fallback)", len(seed))
    else:
        logger.info("Crimes already in DB (%d docs); skipping seed", crimes_count)

    seed = _load_crimes_seed()
    if seed:
        synced = 0
        for c in seed:
            cid = c.get("id")
            if cid not in {
                "crime1",
                "crime2",
                "crime3",
                "crime4",
                "crime5",
                "crime6",
                "crime7",
                "crime8",
            }:
                continue
            rmin = int(c.get("reward_min", 0) or 0)
            rmax = int(c.get("reward_max", 0) or 0)
            res = await db_instance.crimes.update_one(
                {"id": cid},
                {"$set": {"reward_min": rmin, "reward_max": rmax}},
            )
            if res.matched_count:
                synced += 1
        if synced:
            logger.info(
                "Synced reward_min/reward_max from crimes seed for %d standard crime(s)",
                synced,
            )


_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend not in sys.path:
    sys.path.insert(0, _backend)
from server import (
    db,
    get_current_user,
    get_current_user_verified,
    get_rank_info,
    user_prestige_rank_mult,
    get_effective_event,
    log_activity,
    log_respect_earned,
    maybe_process_rank_up,
    maybe_respect_points_drop,
    send_notification,
    RANKS,
)
from utils.location_climate import get_location_climate, rank_multiplier_for_actor, success_multiplier_for_actor
from routers.account.objectives import update_objectives_progress
from routers.kill.armoury import (
    TOKEN_CONFIG,
    TOKEN_TYPES_GLOBAL_RANDOM_DROP,
    TOKEN_GLOBAL_DROP_AMOUNT_MAX,
    TOKEN_GLOBAL_DROP_AMOUNT_MIN,
    TOKEN_GLOBAL_DROP_CHANCE,
)
from utils.game_pass_season_rp import apply_season_rp_mirror_to_update
from utils.point_provenance import log_points_event
from utils.rolling_event_stats import rolling_event_stats_pipeline, rolling_stats_response_from_doc
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_CRIMES


async def _crimes_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_CRIMES)


_crimes_rl_u = [Depends(_crimes_sustained_rl_user)]


async def get_crimes(current_user: dict = Depends(get_current_user)):
    global _crimes_cache
    if _crimes_cache is None:
        _crimes_cache = await db.crimes.find({}, {"_id": 0}).to_list(100)
    all_crimes = list(_crimes_cache) + PRESTIGE_CRIMES
    user_rank, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
    user_prestige = int(current_user.get("prestige_level") or 0)
    user_crimes_list = await db.user_crimes.find(
        {"user_id": current_user["id"], "crime_id": {"$in": [c["id"] for c in all_crimes]}},
        {"_id": 0, "crime_id": 1, "cooldown_until": 1, "attempts": 1, "successes": 1, "progress": 1, "progress_max": 1},
    ).to_list(5000)
    by_cid = defaultdict(list)
    for uc in user_crimes_list:
        by_cid[uc["crime_id"]].append(uc)
    user_crime_by_id = {cid: _merge_user_crime_duplicate_rows(lst) for cid, lst in by_cid.items()}
    result = []
    for crime in all_crimes:
        user_crime = user_crime_by_id.get(crime["id"])
        prestige_required = crime.get("prestige_required")
        prestige_locked = prestige_required is not None and user_prestige < prestige_required

        can_commit = crime["min_rank"] <= user_rank and not prestige_locked
        next_available = None
        if user_crime and "cooldown_until" in user_crime:
            cooldown_time = _parse_iso_datetime(user_crime["cooldown_until"])
            if cooldown_time and cooldown_time > datetime.now(timezone.utc):
                can_commit = False
                next_available = user_crime["cooldown_until"]

        attempts = int((user_crime or {}).get("attempts", 0) or 0)
        successes = int((user_crime or {}).get("successes", 0) or 0)
        stored = (user_crime or {}).get("progress")
        progress = (
            int(stored)
            if stored is not None and CRIME_PROGRESS_MIN <= int(stored) <= CRIME_PROGRESS_MAX
            else _progress_from_attempts(attempts)
        )

        unlocked = crime["min_rank"] <= user_rank and not prestige_locked
        min_rank_name = (
            f"Prestige {prestige_required}" if prestige_locked
            else next((r["name"] for r in RANKS if r["id"] == crime["min_rank"]), None)
        )
        cooldown_minutes = crime.get("cooldown_minutes")
        if cooldown_minutes is None and crime.get("cooldown_seconds") is not None:
            cooldown_minutes = float(crime["cooldown_seconds"]) / 60.0
        if cooldown_minutes is None:
            cooldown_minutes = 5.0
        crime_type = crime.get("crime_type") or "petty"
        # Do not expose prestige-exclusive crimes until rank + prestige requirements are met (reduces ID scraping).
        if crime_type == "prestige" and not unlocked:
            continue
        rmin = int(crime.get("reward_min", 0) or 0)
        rmax = int(crime.get("reward_max", 0) or 0)
        result.append(
            CrimeResponse(
                id=crime["id"],
                name=crime["name"],
                description=crime["description"],
                min_rank=crime["min_rank"],
                min_rank_name=min_rank_name,
                reward_min=int(rmin * CRIME_CASH_PAYOUT_MULT),
                reward_max=int(rmax * CRIME_CASH_PAYOUT_MULT),
                cooldown_minutes=float(cooldown_minutes),
                crime_type=crime_type,
                can_commit=can_commit,
                next_available=next_available,
                attempts=attempts,
                successes=successes,
                progress=progress,
                unlocked=unlocked,
                prestige_required=prestige_required,
                prestige_bonus=crime.get("prestige_bonus"),
            )
        )
    return result


async def commit_crime_locked(crime_id: str, current_user: dict, *, via_auto_rank: bool = False) -> CommitCrimeResponse:
    lock = await _get_crime_commit_lock(current_user["id"])
    async with lock:
        return await _commit_crime_impl(crime_id, current_user, via_auto_rank=via_auto_rank)


async def commit_crime(crime_id: str, current_user: dict = Depends(get_current_user_verified)):
    try:
        return await commit_crime_locked(crime_id, current_user)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("commit_crime failed: %s", e)
        raise HTTPException(status_code=500, detail="Something went wrong. Please try again.")


async def commit_all_crimes(current_user: dict = Depends(get_current_user_verified)):
    """Commit every currently-available non-prestige crime in one request."""
    if current_user.get("in_jail"):
        raise HTTPException(status_code=400, detail="You can't commit crimes while in jail.")
    crimes = await get_crimes(current_user)
    available_ids: list[str] = []
    for c in crimes:
        crime_id = c.get("id") if isinstance(c, dict) else getattr(c, "id", None)
        can_commit = c.get("can_commit") if isinstance(c, dict) else getattr(c, "can_commit", False)
        crime_type = c.get("crime_type") if isinstance(c, dict) else getattr(c, "crime_type", "")
        if crime_id and can_commit and crime_type != "prestige":
            available_ids.append(str(crime_id))

    committed = 0
    failed = 0
    total_cash = 0
    total_respect = 0
    errors: list[str] = []
    for crime_id in available_ids:
        try:
            res = await commit_crime_locked(crime_id, current_user)
            if bool(getattr(res, "success", False)):
                committed += 1
                total_cash += int(getattr(res, "reward", 0) or 0)
                total_respect += int(getattr(res, "respect_points", 0) or 0)
                rp_add = int(getattr(res, "rank_points_earned", 0) or 0)
                if rp_add:
                    current_user["rank_points"] = int(current_user.get("rank_points") or 0) + rp_add
            else:
                failed += 1
                msg = getattr(res, "message", "Failed") or "Failed"
                errors.append(f"{crime_id}: {msg}")
                # Casino heist fail jails the player; further commits in this batch would 400.
                if "jail" in str(msg).lower():
                    break
        except HTTPException as e:
            failed += 1
            d = e.detail
            if isinstance(d, str):
                detail_s = d
            elif isinstance(d, dict) and "message" in d:
                detail_s = str(d.get("message") or d)
            else:
                detail_s = str(d)
            errors.append(f"{crime_id}: {detail_s}")
            if "jail" in detail_s.lower():
                break
        except Exception:
            failed += 1
            errors.append(f"{crime_id}: Request failed")

    return {
        "committed": committed,
        "failed": failed,
        "total_cash": int(total_cash),
        "total_respect": int(total_respect),
        "errors": errors[:25],
    }


def _get_crime_by_id(crime_id: str):
    """Return crime doc — checks prestige crimes first, then DB cache."""
    for c in PRESTIGE_CRIMES:
        if c.get("id") == crime_id:
            return c
    if _crimes_cache is None:
        return None
    for c in _crimes_cache:
        if c.get("id") == crime_id:
            return c
    return None


def _apply_prestige_bonus(crime: dict, user: dict) -> dict:
    """Roll prestige bonus rewards for a prestige crime. Returns dict of earned extras (empty if none)."""
    bonus = crime.get("prestige_bonus")
    if not bonus:
        return {}
    earned = {}
    multiplier = bonus.get("multiplier")  # P4/P5: guaranteed at this multiplier
    rare_chance = bonus.get("rare_chance")  # P1-P3: random gate

    if multiplier is not None:
        # Guaranteed rewards scaled by multiplier
        trigger = True
        mult = float(multiplier)
    elif rare_chance is not None:
        trigger = _rng.random() < float(rare_chance)
        mult = 1.0
    else:
        return {}

    if not trigger:
        return {}

    if "cash" in bonus:
        lo, hi = bonus["cash"]
        earned["cash"] = max(1, int(_rng.randint(lo, hi) * mult))
    if "respect_points" in bonus:
        lo, hi = bonus["respect_points"]
        earned["respect_points"] = max(1, int(_rng.randint(lo, hi) * mult))
    if "booze" in bonus:
        b = bonus["booze"]
        amt = max(1, int(_rng.randint(b["min"], b["max"]) * mult))
        earned["booze"] = {"id": b["id"], "amount": amt}
    if "bullets" in bonus:
        lo, hi = bonus["bullets"]
        earned["bullets"] = max(1, int(_rng.randint(lo, hi) * mult))
    if "molotovs" in bonus:
        lo, hi = bonus["molotovs"]
        earned["molotovs"] = max(1, int(_rng.randint(lo, hi) * mult))
    if "points" in bonus:
        lo, hi = bonus["points"]
        earned["points"] = max(1, int(_rng.randint(lo, hi) * mult))
    return earned


async def _commit_crime_impl(crime_id: str, current_user: dict, *, via_auto_rank: bool = False):
    crime = _get_crime_by_id(crime_id)
    if not crime:
        crime = await db.crimes.find_one({"id": crime_id}, {"_id": 0})
    if not crime:
        raise HTTPException(status_code=404, detail="Crime not found")
    if current_user.get("in_jail"):
        raise HTTPException(status_code=400, detail="You can't commit crimes while in jail.")
    user_rank, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
    if crime["min_rank"] > user_rank:
        raise HTTPException(status_code=403, detail="Rank too low for this crime")
    prestige_required = crime.get("prestige_required")
    if prestige_required and int(current_user.get("prestige_level") or 0) < prestige_required:
        raise HTTPException(status_code=403, detail=f"Requires Prestige {prestige_required}")
    now = datetime.now(timezone.utc)
    cooldown_min = crime.get("cooldown_minutes", 5)
    _cd_seconds = crime.get("cooldown_seconds")
    if _cd_seconds is None:
        _cd_seconds = int(float(cooldown_min) * 60) if cooldown_min else 300
    else:
        _cd_seconds = int(float(_cd_seconds))
    cooldown_until = (now + timedelta(seconds=_cd_seconds)).isoformat()
    now_iso = now.isoformat()
    uid = current_user["id"]
    # find_one_and_update only updated one document. Duplicate user_crimes rows (from the old
    # upsert bug) each looked "off cooldown" in parallel — four rows => four commits. Claim with
    # update_many so every matching row gets the new cooldown in one write; only one request wins.
    await db.user_crimes.update_one(
        {"user_id": uid, "crime_id": crime_id},
        {"$setOnInsert": {"attempts": 0, "successes": 0}},
        upsert=True,
    )
    claim = await db.user_crimes.update_many(
        {
            "user_id": uid,
            "crime_id": crime_id,
            "$or": [
                {"cooldown_until": {"$exists": False}},
                {"cooldown_until": None},
                {"cooldown_until": {"$lte": now_iso}},
                {"cooldown_until": {"$lte": now}},
            ],
        },
        {"$set": {"cooldown_until": cooldown_until}},
    )
    if claim.matched_count == 0:
        raise HTTPException(status_code=400, detail="Crime on cooldown")
    user_crime = await db.user_crimes.find_one(
        {"user_id": uid, "crime_id": crime_id},
        {"_id": 0},
    )
    
    # PROGRESS BAR: 10-92%. Success +6-8%. Fail -1-3%; once hit 92%, floor is 77%
    stored = (user_crime or {}).get("progress")
    progress_max = (user_crime or {}).get("progress_max")
    crime_attempts = int((user_crime or {}).get("attempts", 0) or 0)
    progress = (
        int(stored)
        if stored is not None and CRIME_PROGRESS_MIN <= int(stored) <= CRIME_PROGRESS_MAX
        else _progress_from_attempts(crime_attempts)
    )
    if progress_max is not None:
        progress_max = int(progress_max)
    else:
        progress_max = max(progress, _progress_from_attempts(crime_attempts))
    _climate = get_location_climate()
    success_rate = (progress / 100.0) * CRIME_DIFFICULTY_MULT * success_multiplier_for_actor(
        current_user.get("current_state"), _climate
    )
    success = _rng.random() < min(1.0, success_rate)
    rank_points_earned_out = 0

    if success:
        gain = _rng.randint(CRIME_PROGRESS_GAIN_MIN, CRIME_PROGRESS_GAIN_MAX)
        progress_after = min(CRIME_PROGRESS_MAX, progress + gain)
        progress_max = max(progress_max, progress_after)
    else:
        drop = _rng.randint(
            CRIME_PROGRESS_DROP_PER_FAIL_MIN,
            CRIME_PROGRESS_DROP_PER_FAIL_MAX
        )
        floor = (
            max(CRIME_PROGRESS_MIN, CRIME_PROGRESS_MAX - CRIME_PROGRESS_MAX_DROP_FROM_PEAK)
            if progress_max >= CRIME_PROGRESS_MAX
            else CRIME_PROGRESS_MIN
        )
        progress_after = max(floor, progress - drop)

    if success:
        r_min = int(crime.get("reward_min", 0))
        r_max = int(crime.get("reward_max", 100))
        if r_max < r_min:
            r_max = r_min
        reward = _rng.randint(r_min, r_max)
        rank_points = (
            3 if crime["crime_type"] == "petty"
            else 5 if crime["crime_type"] == "medium"
            else 7 if crime["crime_type"] == "major"
            else 10 if crime["crime_type"] == "prestige"
            else 5
        )
        ev = await get_effective_event()
        reward = int(reward * ev.get("kill_cash", 1.0))
        rank_points = int(rank_points * ev.get("rank_points", 1.0))
        now_utc = datetime.now(timezone.utc)
        rp_perk_until = current_user.get("rp_perk_until")
        if rp_perk_until:
            try:
                until = datetime.fromisoformat(rp_perk_until.replace("Z", "+00:00"))
                if until.tzinfo is None:
                    until = until.replace(tzinfo=timezone.utc)
                if now_utc < until:
                    rank_points = int(rank_points * 1.1)
            except Exception:
                pass
        xp_crimes_until = current_user.get("xp_crimes_until")
        if xp_crimes_until:
            try:
                until = datetime.fromisoformat(xp_crimes_until.replace("Z", "+00:00"))
                if until.tzinfo is None:
                    until = until.replace(tzinfo=timezone.utc)
                if now_utc < until:
                    rank_points = rank_points * 2
            except Exception:
                pass
        # Prestige bonus: boost crime cash payout
        from server import get_prestige_bonus
        reward = int(reward * get_prestige_bonus(current_user)["crime_mult"])
        # Badge bonus: 0.1% per crimes badge; prestige: 0.5% boost per level
        try:
            from routers.game.achievements import get_badge_bonuses
            bb = await get_badge_bonuses(current_user.get("id") or "")
            reward = int(reward * (1 + bb.get("crimes", 0) * 0.001) * bb.get("prestige_badge_mult", 1))
        except Exception:
            pass
        from server import founding_member_income_mult
        _fm_cr = founding_member_income_mult(current_user)
        reward = int(reward * _fm_cr)
        rank_points = int(rank_points * _fm_cr)
        # Referred user: 10% higher crime cash payouts
        if user_has_referrers(current_user.get("referred_by")):
            reward = int(reward * 1.10)
        from server import rank_xp_pass_multiplier
        pass_mult = float(rank_xp_pass_multiplier(current_user))
        reward = int(reward * pass_mult)
        rank_points = int(rank_points * pass_mult)
        reward = int(reward * CRIME_CASH_PAYOUT_MULT)
        rank_points = max(1, int(rank_points * rank_multiplier_for_actor(current_user.get("current_state"), _climate)))
        rank_points_earned_out = int(rank_points)
        rp_before = int(current_user.get("rank_points") or 0)
        # Racket / illegal-business missions: crimes in the business's state (doc.state set at start)
        ib_crimes_in_state_inc = 0
        try:
            biz = await db.illegal_businesses.find_one(
                {"user_id": current_user["id"]},
                {"_id": 0, "state": 1},
            )
            if biz:
                bstate = (biz.get("state") or "").strip()
                here = (current_user.get("current_state") or "").strip()
                if bstate and here and bstate == here:
                    ib_crimes_in_state_inc = 1
        except Exception:
            pass
        inc = {
            "money": reward,
            "rank_points": rank_points,
            "total_crimes": 1,
            "crime_profit": reward,
        }
        if ib_crimes_in_state_inc:
            inc["illegal_business_crimes_in_state"] = ib_crimes_in_state_inc
        respect_drop = maybe_respect_points_drop()
        if respect_drop:
            inc["respect_points"] = max(0, int(respect_drop * RESPECT_FROM_CRIMES_MULT * _fm_cr * pass_mult))
        # Global ultra-rare molotov drop from any successful crime
        prestige_bonus_earned: Optional[dict] = None
        if _rng.random() < MOLOTOV_GLOBAL_DROP_CHANCE:
            inc["molotovs"] = inc.get("molotovs", 0) + MOLOTOV_GLOBAL_DROP_AMOUNT
            prestige_bonus_earned = {"molotovs": MOLOTOV_GLOBAL_DROP_AMOUNT}
        # Global ultra-rare loot box piece drop with slightly higher chance on prestige crimes
        loot_piece_chance = LOOT_PIECE_CHANCE_PRESTIGE if crime.get("crime_type") == "prestige" else LOOT_PIECE_CHANCE_NORMAL
        if _rng.random() < loot_piece_chance:
            inc["loot_box_pieces"] = inc.get("loot_box_pieces", 0) + LOOT_PIECE_AMOUNT
            if prestige_bonus_earned is None:
                prestige_bonus_earned = {"loot_box_pieces": LOOT_PIECE_AMOUNT}
            else:
                prestige_bonus_earned["loot_box_pieces"] = prestige_bonus_earned.get("loot_box_pieces", 0) + LOOT_PIECE_AMOUNT
        # Random armoury token drop (1 in 250); 1–3 of one type
        if _rng.random() < TOKEN_GLOBAL_DROP_CHANCE:
            token_type = _rng.choice(TOKEN_TYPES_GLOBAL_RANDOM_DROP)
            token_field = TOKEN_CONFIG[token_type]["count_field"]
            token_amt = _rng.randint(TOKEN_GLOBAL_DROP_AMOUNT_MIN, TOKEN_GLOBAL_DROP_AMOUNT_MAX)
            inc[token_field] = inc.get(token_field, 0) + token_amt
            if prestige_bonus_earned is None:
                prestige_bonus_earned = {"token": token_type, "token_amount": token_amt}
            else:
                prestige_bonus_earned["token"] = token_type
                prestige_bonus_earned["token_amount"] = token_amt
        await db.users.update_one(
            {"id": current_user["id"]},
            apply_season_rp_mirror_to_update({"$inc": inc}),
        )
        # Exploit check: flag impossible single-action gains (e.g. >$50M from one crime)
        try:
            import middleware.security as sec
            if getattr(sec, "DETECT_IMPOSSIBLE_GAIN", 0) > 0:
                prev = int(current_user.get("money") or 0)
                await sec.check_impossible_wealth_gain(
                    db, current_user["id"], current_user.get("username", "?"),
                    prev, prev + reward, "crime"
                )
        except Exception:
            pass
        # Referral: referrers split 10% of crime profit evenly (game-paid)
        _rb = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "referred_by": 1})
        ref_ids = normalize_referred_by_ids((_rb or current_user).get("referred_by"))
        if ref_ids and reward > 0:
            pool = referral_pool_int(reward, 0.10)
            for rid, amt in split_referral_pool(pool, ref_ids, self_id=current_user["id"]):
                if amt > 0:
                    await apply_referrer_referral_increment(
                        db, rid, {"money": amt, "referral_earnings_crime": amt}, context="crime"
                    )
        if inc.get("respect_points"):
            await log_respect_earned(current_user["id"], inc["respect_points"], "crimes")
        if inc.get("loot_box_pieces"):
            try:
                await db.economy_events.insert_one({
                    "at": now_utc.isoformat(),
                    "type": "loot_piece_drop",
                    "user_id": current_user["id"],
                    "username": current_user.get("username") or "",
                    "crime_id": crime.get("id"),
                    "crime_name": crime.get("name"),
                    "pieces": inc.get("loot_box_pieces"),
                })
            except Exception as e:
                logger.warning("economy_events loot_piece_drop insert: %s", e)

        # Prestige bonus rewards (separate update so they're always applied cleanly)
        if crime.get("prestige_bonus"):
            prestige_bonus_from_prestige = _apply_prestige_bonus(crime, current_user)
            if prestige_bonus_from_prestige:
                bonus_inc = {}
                if "cash" in prestige_bonus_from_prestige:
                    bonus_inc["money"] = int(prestige_bonus_from_prestige["cash"] * CRIME_CASH_PAYOUT_MULT)
                if "respect_points" in prestige_bonus_from_prestige:
                    bonus_inc["respect_points"] = prestige_bonus_from_prestige["respect_points"]
                if "bullets" in prestige_bonus_from_prestige:
                    bonus_inc["bullets"] = prestige_bonus_from_prestige["bullets"]
                if "molotovs" in prestige_bonus_from_prestige:
                    bonus_inc["molotovs"] = bonus_inc.get("molotovs", 0) + prestige_bonus_from_prestige["molotovs"]
                if "loot_box_pieces" in prestige_bonus_from_prestige:
                    bonus_inc["loot_box_pieces"] = bonus_inc.get("loot_box_pieces", 0) + prestige_bonus_from_prestige["loot_box_pieces"]
                if "points" in prestige_bonus_from_prestige:
                    bonus_inc["points"] = prestige_bonus_from_prestige["points"]
                if "booze" in prestige_bonus_from_prestige:
                    b = prestige_bonus_from_prestige["booze"]
                    bonus_inc[f"booze_carrying.{b['id']}"] = b["amount"]
                if bonus_inc:
                    await db.users.update_one({"id": current_user["id"]}, {"$inc": bonus_inc})
                    if bonus_inc.get("respect_points"):
                        await log_respect_earned(current_user["id"], bonus_inc["respect_points"], "crimes_prestige")
                    if bonus_inc.get("points", 0) > 0:
                        await log_points_event(db, user_id=current_user["id"], points=bonus_inc["points"], event_type="prestige_crime_bonus", event_ref=crime.get("id"), meta={"crime_name": crime.get("name")})
                # Merge prestige bonuses into the response dict (preserving any global molotov drop)
                if prestige_bonus_earned is None:
                    prestige_bonus_earned = dict(prestige_bonus_from_prestige)
                else:
                    for k, v in prestige_bonus_from_prestige.items():
                        if k in {"cash", "respect_points", "bullets", "points", "molotovs", "loot_box_pieces"}:
                            prestige_bonus_earned[k] = prestige_bonus_earned.get(k, 0) + v
                        elif k == "booze":
                            prestige_bonus_earned["booze"] = v

        new_total_crimes = (current_user.get("total_crimes") or 0) + 1
        claimed = current_user.get("respect_points_crime_milestones_claimed") or []
        new_claimed = [m for m in CRIME_MILESTONES if m <= new_total_crimes and m not in claimed]
        milestone_respect = sum(CRIME_MILESTONE_REWARDS.get(m, 0) for m in new_claimed)
        await _award_crime_milestones(current_user["id"], new_total_crimes, claimed)
        respect_earned = max(0, int((respect_drop or 0) * RESPECT_FROM_CRIMES_MULT)) + max(0, int(milestone_respect * RESPECT_FROM_CRIMES_MULT))
        try:
            await maybe_process_rank_up(current_user["id"], rp_before, rank_points, current_user.get("username", ""), user_prestige_rank_mult(current_user))
        except Exception as e:
            logger.exception("Rank-up notification (crimes): %s", e)
        await db.crime_earnings.insert_one(
            {"user_id": current_user["id"], "amount": reward, "at": now}
        )
        try:
            await update_objectives_progress(current_user["id"], "crimes", 1)
            city = (current_user.get("current_state") or "").strip()
            if city:
                await update_objectives_progress(current_user["id"], "crimes_in_city", 1, city=city)
        except Exception:
            pass
        if rank_points:
            message = _rng.choice(CRIME_SUCCESS_MESSAGES).format(reward=reward, rank_points=rank_points)
        else:
            message = _rng.choice(CRIME_SUCCESS_MESSAGES_CASH_ONLY).format(reward=reward)
    else:
        reward = None
        prestige_bonus_earned = None
        message = _rng.choice(CRIME_FAIL_MESSAGES)
        respect_earned = 0
        # Casino Heist fail: immediate 90s jail + temporary 2x harder bust-out.
        if str(crime.get("id") or "") == CASINO_HEIST_ID:
            jail_until_dt = now + timedelta(seconds=CASINO_HEIST_FAIL_JAIL_SECONDS)
            jail_until_iso = jail_until_dt.isoformat()
            await db.users.update_one(
                {"id": current_user["id"]},
                {
                    "$set": {
                        "in_jail": True,
                        "jail_until": jail_until_iso,
                        "snitch_attempted_this_term": False,
                        "jail_bust_harder_until": jail_until_iso,
                        "jail_bust_difficulty_mult": CASINO_HEIST_BUST_DIFFICULTY_MULT,
                    }
                },
            )
            message = (
                f"{message} You got caught in the heist and were jailed for "
                f"{CASINO_HEIST_FAIL_JAIL_SECONDS}s. Busting you out is 2x harder during this term."
            )
    # Track attempts, successes, progress (success +6-8%; fail -1-3%; once at 92% floor is 77%)
    set_fields = {
        "last_committed": now.isoformat(),
        "cooldown_until": cooldown_until,
        "progress": progress_after,
    }
    if progress_max is not None:
        set_fields["progress_max"] = progress_max
    # Absolute counts so update_many keeps duplicate rows in sync (no $inc across N dupes).
    set_fields["attempts"] = crime_attempts + 1
    set_fields["successes"] = int((user_crime or {}).get("successes", 0) or 0) + (1 if success else 0)
    await db.user_crimes.update_many(
        {"user_id": current_user["id"], "crime_id": crime_id},
        {"$set": set_fields},
    )
    await _dedup_user_crimes(current_user["id"], crime_id)
    # Lightweight per-crime event for analytics and anti-cheat (no public exposure).
    # Stored as a single small document per attempt.
    city = (current_user.get("current_state") or "").strip() or None
    await db.crime_events.insert_one(
        {
            "user_id": current_user["id"],
            "crime_id": crime_id,
            "crime_name": crime.get("name"),
            "crime_type": crime.get("crime_type") or "normal",
            "at": now,
            "success": success,
            "profit": int(reward or 0) if success and reward is not None else 0,
            "city": city,
        }
    )
    crime_details = {"crime_id": crime_id, "crime_name": crime.get("name"), "success": success, "reward": reward}
    if via_auto_rank:
        crime_details["via_auto_rank"] = True
    await log_activity(
        current_user["id"],
        current_user.get("username") or "?",
        "crime",
        crime_details,
    )
    return CommitCrimeResponse(
        success=success,
        message=message,
        reward=reward,
        next_available=cooldown_until,
        progress_after=progress_after,
        respect_points=respect_earned if success else 0,
        prestige_bonus_earned=prestige_bonus_earned if success else None,
        rank_points_earned=rank_points_earned_out,
    )


async def get_crime_stats(current_user: dict = Depends(get_current_user)):
    """Return crimes today/week, successful crimes, profit today / 24h / week."""
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    last_24h_start = now - timedelta(hours=24)
    seven_days_start = now - timedelta(days=7)
    pipeline = rolling_event_stats_pipeline(
        current_user["id"],
        seven_days_start=seven_days_start,
        today_start=today_start,
        last_24h_start=last_24h_start,
    )
    cursor = db.crime_events.aggregate(pipeline)
    result = await cursor.to_list(1)
    out = rolling_stats_response_from_doc(result[0] if result else None)
    out["profit_last_hour"] = out["profit_24h"]
    out["profit_last_7_days"] = out["profit_week"]
    return out


async def get_crime_logs(current_user: dict = Depends(get_current_user)):
    """Return recent crime events for the current user for use in the Crimes page log box."""
    docs = (
        await db.crime_events.find(
            {"user_id": current_user["id"]},
            {"_id": 0},
        )
        .sort("at", -1)
        .to_list(50)
    )
    return {"events": docs}


def register(router):
    router.add_api_route(
        "/crimes",
        get_crimes,
        methods=["GET"],
        response_model=List[CrimeResponse],
        dependencies=_crimes_rl_u,
    )
    router.add_api_route(
        "/crimes/stats",
        get_crime_stats,
        methods=["GET"],
        dependencies=_crimes_rl_u,
    )
    router.add_api_route(
        "/crimes/logs",
        get_crime_logs,
        methods=["GET"],
        dependencies=_crimes_rl_u,
    )
    router.add_api_route(
        "/crimes/{crime_id}/commit",
        commit_crime,
        methods=["POST"],
        response_model=CommitCrimeResponse,
    )
    router.add_api_route(
        "/crimes/commit-all",
        commit_all_crimes,
        methods=["POST"],
        response_model=CommitAllCrimesResponse,
    )
