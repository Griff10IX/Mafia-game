# Crime endpoints: list crimes, commit crime
from typing import List
from datetime import datetime, timezone, timedelta
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


_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend not in sys.path:
    sys.path.insert(0, _backend)
from server import (
    db,
    get_current_user,
    get_rank_info,
    get_effective_event,
    log_activity,
    CrimeResponse,
    CommitCrimeResponse,
)


async def get_crimes(current_user: dict = Depends(get_current_user)):
    crimes = await db.crimes.find({}, {"_id": 0}).to_list(100)
    user_rank, _ = get_rank_info(current_user.get("rank_points", 0))
    result = []
    for crime in crimes:
        user_crime = await db.user_crimes.find_one(
            {"user_id": current_user["id"], "crime_id": crime["id"]},
            {"_id": 0},
        )
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
        result.append(
            CrimeResponse(
                id=crime["id"],
                name=crime["name"],
                description=crime["description"],
                min_rank=crime["min_rank"],
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


async def _commit_crime_impl(crime_id: str, current_user: dict):
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
        message = f"Success! You earned ${reward:,} and {rank_points} rank points"
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


def register(router):
    router.add_api_route(
        "/crimes",
        get_crimes,
        methods=["GET"],
        response_model=List[CrimeResponse],
    )
    router.add_api_route(
        "/crimes/{crime_id}/commit",
        commit_crime,
        methods=["POST"],
        response_model=CommitCrimeResponse,
    )
