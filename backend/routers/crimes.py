# Crime endpoints: list crimes, commit crime
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
import random
import os
import sys
import logging
from fastapi import Depends, HTTPException

logger = logging.getLogger(__name__)


# Progress bar: 10-92%. Success +6-8%. Fail -1-3%; once you've hit max, floor is 77% (never drop more than 15% from max)
CRIME_PROGRESS_MIN = 10
CRIME_PROGRESS_MAX = 92
CRIME_PROGRESS_GAIN_MIN = 6
CRIME_PROGRESS_GAIN_MAX = 8
CRIME_PROGRESS_DROP_PER_FAIL_MIN = 1
CRIME_PROGRESS_DROP_PER_FAIL_MAX = 3
CRIME_PROGRESS_MAX_DROP_FROM_PEAK = 15    # once hit 92%, can never go below 77%

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
    """Migrate old attempts-based progress to new bar value (10-92)."""
    if crime_attempts < 100:
        return 10
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
    progress: int = 10
    unlocked: bool = True


class CommitCrimeResponse(BaseModel):
    success: bool
    message: str
    reward: Optional[int]
    next_available: str
    progress_after: Optional[int] = None


# ---------------------------------------------------------------------------
# Game data init (called from server on startup)
# ---------------------------------------------------------------------------

CRIMES_SEED = [
    {"id": "crime1", "name": "Pickpocket", "description": "Steal from unsuspecting citizens - quick cash", "min_rank": 1, "reward_min": 20, "reward_max": 60, "cooldown_seconds": 15, "cooldown_minutes": 0.25, "crime_type": "petty"},
    {"id": "crime2", "name": "Mug a Pedestrian", "description": "Rob someone on the street", "min_rank": 1, "reward_min": 40, "reward_max": 120, "cooldown_seconds": 30, "cooldown_minutes": 0.5, "crime_type": "petty"},
    {"id": "crime3", "name": "Bootlegging", "description": "Smuggle illegal alcohol", "min_rank": 3, "reward_min": 200, "reward_max": 500, "cooldown_seconds": 120, "cooldown_minutes": 2, "crime_type": "medium"},
    {"id": "crime4", "name": "Armed Robbery", "description": "Rob a local store at gunpoint", "min_rank": 4, "reward_min": 800, "reward_max": 1800, "cooldown_seconds": 300, "cooldown_minutes": 5, "crime_type": "medium"},
    {"id": "crime5", "name": "Extortion", "description": "Shake down local businesses", "min_rank": 5, "reward_min": 2000, "reward_max": 4500, "cooldown_seconds": 600, "cooldown_minutes": 10, "crime_type": "medium"},
    {"id": "crime6", "name": "Jewelry Heist", "description": "Rob a jewelry store", "min_rank": 6, "reward_min": 4000, "reward_max": 9000, "cooldown_seconds": 900, "cooldown_minutes": 15, "crime_type": "major"},
    {"id": "crime7", "name": "Bank Heist", "description": "Rob a bank vault - high risk, high reward", "min_rank": 8, "reward_min": 18000, "reward_max": 50000, "cooldown_seconds": 1800, "cooldown_minutes": 30, "crime_type": "major"},
    {"id": "crime8", "name": "Casino Heist", "description": "Rob a casino - the big score", "min_rank": 10, "reward_min": 70000, "reward_max": 180000, "cooldown_seconds": 3600, "cooldown_minutes": 60, "crime_type": "major"},
]


# In-memory cache for crime definitions (static until server restart / init). Cleared when init_crimes_data runs.
_crimes_cache: Optional[List[dict]] = None


async def init_crimes_data(db_instance):
    """Initialize crimes collection on server startup. SAFETY: Only updates crimes collection (game config), not user data."""
    global _crimes_cache
    _crimes_cache = None  # invalidate cache so next request gets fresh data
    logger.info("🔄 Initializing crimes data...")
    await db_instance.crimes.delete_many({})
    await db_instance.crimes.insert_many(CRIMES_SEED)


_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend not in sys.path:
    sys.path.insert(0, _backend)
from server import (
    db,
    get_current_user,
    get_rank_info,
    get_effective_event,
    log_activity,
    maybe_process_rank_up,
    RANKS,
)
from routers.objectives import update_objectives_progress


async def get_crimes(current_user: dict = Depends(get_current_user)):
    global _crimes_cache
    if _crimes_cache is None:
        _crimes_cache = await db.crimes.find({}, {"_id": 0}).to_list(100)
    crimes = _crimes_cache
    user_rank, _ = get_rank_info(current_user.get("rank_points", 0))
    user_crimes_list = await db.user_crimes.find(
        {"user_id": current_user["id"], "crime_id": {"$in": [c["id"] for c in crimes]}},
        {"_id": 0, "crime_id": 1, "cooldown_until": 1, "attempts": 1, "successes": 1, "progress": 1, "progress_max": 1},
    ).to_list(len(crimes))
    user_crime_by_id = {uc["crime_id"]: uc for uc in user_crimes_list}
    result = []
    for crime in crimes:
        user_crime = user_crime_by_id.get(crime["id"])
        can_commit = crime["min_rank"] <= user_rank
        next_available = None
        if user_crime and "cooldown_until" in user_crime:
            cooldown_time = _parse_iso_datetime(user_crime["cooldown_until"])
            if cooldown_time and cooldown_time > datetime.now(timezone.utc):
                can_commit = False
                next_available = user_crime["cooldown_until"]
        
        # Get skill stats and progress bar for this crime
        attempts = int((user_crime or {}).get("attempts", 0) or 0)
        successes = int((user_crime or {}).get("successes", 0) or 0)
        stored = (user_crime or {}).get("progress")
        progress = (
            int(stored)
            if stored is not None and CRIME_PROGRESS_MIN <= int(stored) <= CRIME_PROGRESS_MAX
            else _progress_from_attempts(attempts)
        )
        
        unlocked = crime["min_rank"] <= user_rank
        min_rank_name = next((r["name"] for r in RANKS if r["id"] == crime["min_rank"]), None)
        result.append(
            CrimeResponse(
                id=crime["id"],
                name=crime["name"],
                description=crime["description"],
                min_rank=crime["min_rank"],
                min_rank_name=min_rank_name,
                reward_min=crime["reward_min"],
                reward_max=crime["reward_max"],
                cooldown_minutes=crime["cooldown_minutes"],
                crime_type=crime["crime_type"],
                can_commit=can_commit,
                next_available=next_available,
                attempts=attempts,
                successes=successes,
                progress=progress,
                unlocked=unlocked,
            )
        )
    return result


async def commit_crime(crime_id: str, current_user: dict = Depends(get_current_user)):
    try:
        return await _commit_crime_impl(crime_id, current_user)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("commit_crime failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Server error: {e!s}")


def _get_crime_by_id(crime_id: str):
    """Return crime doc from cache if available, else None (caller may fall back to DB)."""
    if _crimes_cache is None:
        return None
    for c in _crimes_cache:
        if c.get("id") == crime_id:
            return c
    return None


async def _commit_crime_impl(crime_id: str, current_user: dict):
    crime = _get_crime_by_id(crime_id)
    if not crime:
        crime = await db.crimes.find_one({"id": crime_id}, {"_id": 0})
    if not crime:
        raise HTTPException(status_code=404, detail="Crime not found")
    if current_user.get("in_jail"):
        raise HTTPException(status_code=400, detail="You can't commit crimes while in jail.")
    user_rank, _ = get_rank_info(current_user.get("rank_points", 0))
    if crime["min_rank"] > user_rank:
        raise HTTPException(status_code=403, detail="Rank too low for this crime")
    user_crime = await db.user_crimes.find_one(
        {"user_id": current_user["id"], "crime_id": crime_id},
        {"_id": 0},
    )
    now = datetime.now(timezone.utc)
    if user_crime and "cooldown_until" in user_crime:
        cooldown_time = _parse_iso_datetime(user_crime["cooldown_until"])
        if cooldown_time and cooldown_time > now:
            raise HTTPException(
                status_code=400,
                detail=f"Crime on cooldown until {user_crime['cooldown_until']}",
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
    success_rate = progress / 100.0
    success = random.random() < success_rate

    if success:
        gain = random.randint(CRIME_PROGRESS_GAIN_MIN, CRIME_PROGRESS_GAIN_MAX)
        progress_after = min(CRIME_PROGRESS_MAX, progress + gain)
        progress_max = max(progress_max, progress_after)
    else:
        drop = random.randint(
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
        reward = random.randint(r_min, r_max)
        rank_points = (
            3
            if crime["crime_type"] == "petty"
            else 7
            if crime["crime_type"] == "medium"
            else 15
        )
        ev = await get_effective_event()
        reward = int(reward * ev.get("kill_cash", 1.0))
        rank_points = int(rank_points * ev.get("rank_points", 1.0))
        rp_before = int(current_user.get("rank_points") or 0)
        await db.users.update_one(
            {"id": current_user["id"]},
            {
                "$inc": {
                    "money": reward,
                    "rank_points": rank_points,
                    "total_crimes": 1,
                    "crime_profit": reward,
                }
            },
        )
        try:
            await maybe_process_rank_up(current_user["id"], rp_before, rank_points, current_user.get("username", ""))
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
        message = random.choice(CRIME_SUCCESS_MESSAGES).format(reward=reward, rank_points=rank_points)
    else:
        reward = None
        message = random.choice(CRIME_FAIL_MESSAGES)
    cooldown_min = crime.get("cooldown_minutes", 5)
    cooldown_seconds = crime.get("cooldown_seconds")
    if cooldown_seconds is None:
        cooldown_seconds = int(float(cooldown_min) * 60) if cooldown_min else 300
    else:
        cooldown_seconds = int(float(cooldown_seconds))
    cooldown_until = (now + timedelta(seconds=cooldown_seconds)).isoformat()
    # Track attempts, successes, progress (success +6-8%; fail -1-3%; once at 92% floor is 77%)
    set_fields = {
        "last_committed": now.isoformat(),
        "cooldown_until": cooldown_until,
        "progress": progress_after,
    }
    if progress_max is not None:
        set_fields["progress_max"] = progress_max
    await db.user_crimes.update_one(
        {"user_id": current_user["id"], "crime_id": crime_id},
        {
            "$set": set_fields,
            "$inc": {"attempts": 1, "successes": 1 if success else 0}
        },
        upsert=True,
    )
    await db.crime_events.insert_one(
        {"user_id": current_user["id"], "at": now, "success": success, "profit": reward if success and reward is not None else 0}
    )
    await log_activity(
        current_user["id"],
        current_user.get("username") or "?",
        "crime",
        {"crime_id": crime_id, "crime_name": crime.get("name"), "success": success, "reward": reward},
    )
    return CommitCrimeResponse(
        success=success,
        message=message,
        reward=reward,
        next_available=cooldown_until,
        progress_after=progress_after,
    )


async def get_crime_stats(current_user: dict = Depends(get_current_user)):
    """Return crimes today/week, successful crimes, profit today / 24h / week."""
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    last_24h_start = now - timedelta(hours=24)
    seven_days_start = now - timedelta(days=7)
    pipeline = [
        {"$match": {"user_id": current_user["id"]}},
        {
            "$facet": {
                "today": [
                    {"$match": {"at": {"$gte": today_start}}},
                    {"$group": {"_id": None, "count": {"$sum": 1}, "successes": {"$sum": {"$cond": ["$success", 1, 0]}}, "profit": {"$sum": "$profit"}}},
                ],
                "last_24h": [
                    {"$match": {"at": {"$gte": last_24h_start}}},
                    {"$group": {"_id": None, "profit": {"$sum": "$profit"}}},
                ],
                "last_7_days": [
                    {"$match": {"at": {"$gte": seven_days_start}}},
                    {"$group": {"_id": None, "count": {"$sum": 1}, "successes": {"$sum": {"$cond": ["$success", 1, 0]}}, "profit": {"$sum": "$profit"}}},
                ],
            }
        },
    ]
    cursor = db.crime_events.aggregate(pipeline)
    result = await cursor.to_list(1)
    doc = result[0] if result else {}
    def _today():
        arr = doc.get("today") or []
        return arr[0] if arr else {"count": 0, "successes": 0, "profit": 0}
    def _24h():
        arr = doc.get("last_24h") or []
        return int(arr[0]["profit"]) if arr else 0
    def _week():
        arr = doc.get("last_7_days") or []
        return arr[0] if arr else {"count": 0, "successes": 0, "profit": 0}
    t, w = _today(), _week()
    return {
        "count_today": int(t.get("count", 0)),
        "count_week": int(w.get("count", 0)),
        "success_today": int(t.get("successes", 0)),
        "success_week": int(w.get("successes", 0)),
        "profit_today": int(t.get("profit", 0)),
        "profit_24h": _24h(),
        "profit_week": int(w.get("profit", 0)),
        "profit_last_hour": _24h(),  # backward compat
        "profit_last_7_days": int(w.get("profit", 0)),
    }


def register(router):
    router.add_api_route(
        "/crimes",
        get_crimes,
        methods=["GET"],
        response_model=List[CrimeResponse],
    )
    router.add_api_route(
        "/crimes/stats",
        get_crime_stats,
        methods=["GET"],
    )
    router.add_api_route(
        "/crimes/{crime_id}/commit",
        commit_crime,
        methods=["POST"],
        response_model=CommitCrimeResponse,
    )
