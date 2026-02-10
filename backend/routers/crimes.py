# Crime endpoints: list crimes, commit crime
from typing import List
from datetime import datetime, timezone, timedelta
import random
from fastapi import Depends, HTTPException

import sys; sys.path.insert(0, "/app/backend"); from server import (
    db,
    get_current_user,
    get_rank_info,
    get_effective_event,
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
            cooldown_time = datetime.fromisoformat(user_crime["cooldown_until"])
            if cooldown_time > datetime.now(timezone.utc):
                can_commit = False
                next_available = user_crime["cooldown_until"]
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
            )
        )
    return result


async def commit_crime(crime_id: str, current_user: dict = Depends(get_current_user)):
    crime = await db.crimes.find_one({"id": crime_id}, {"_id": 0})
    if not crime:
        raise HTTPException(status_code=404, detail="Crime not found")
    user_rank, _ = get_rank_info(current_user.get("rank_points", 0))
    if crime["min_rank"] > user_rank:
        raise HTTPException(status_code=403, detail="Rank too low for this crime")
    user_crime = await db.user_crimes.find_one(
        {"user_id": current_user["id"], "crime_id": crime_id},
        {"_id": 0},
    )
    now = datetime.now(timezone.utc)
    if user_crime and "cooldown_until" in user_crime:
        cooldown_time = datetime.fromisoformat(user_crime["cooldown_until"])
        if cooldown_time > now:
            raise HTTPException(
                status_code=400,
                detail=f"Crime on cooldown until {user_crime['cooldown_until']}",
            )
    success_rate = (
        0.7
        if crime["crime_type"] == "petty"
        else 0.5
        if crime["crime_type"] == "medium"
        else 0.3
    )
    success = random.random() < success_rate
    if success:
        reward = random.randint(crime["reward_min"], crime["reward_max"])
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
        message = "Crime failed! Better luck next time."
    cooldown_seconds = crime.get(
        "cooldown_seconds", crime.get("cooldown_minutes", 5) * 60
    )
    cooldown_until = (now + timedelta(seconds=cooldown_seconds)).isoformat()
    await db.user_crimes.update_one(
        {"user_id": current_user["id"], "crime_id": crime_id},
        {"$set": {"last_committed": now.isoformat(), "cooldown_until": cooldown_until}},
        upsert=True,
    )
    return CommitCrimeResponse(
        success=success,
        message=message,
        reward=reward,
        next_available=cooldown_until,
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
