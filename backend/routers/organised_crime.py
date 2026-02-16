# Organised Crime endpoints: equipment, heists, team management
import logging
from datetime import datetime, timezone, timedelta
import random
import uuid
from typing import Optional
from fastapi import Depends, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

import os
import sys
_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend not in sys.path:
    sys.path.insert(0, _backend)

from server import db, get_current_user, get_rank_info, maybe_process_rank_up

# Equipment tiers for Organised Crime
EQUIPMENT_TIERS = [
    {
        "id": "basic",
        "name": "Model T & Crowbar",
        "cost": 0,
        "success_bonus": 0.0,
        "description": "Basic car, simple tools - no bonuses"
    },
    {
        "id": "upgraded",
        "name": "Dynamite & V8 Ford",
        "cost": 400_000,
        "success_bonus": 0.10,
        "description": "+10% - Better explosives, faster getaway car"
    },
    {
        "id": "professional",
        "name": "Nitroglycerin & Duesenberg",
        "cost": 700_000,
        "success_bonus": 0.20,
        "description": "+20% - Pro safecracking, luxury getaway vehicle"
    },
    {
        "id": "elite",
        "name": "Tommy Gun & Armored Cadillac",
        "cost": 900_000,
        "success_bonus": 0.30,
        "description": "+30% - Heavy firepower, bulletproof transport"
    },
    {
        "id": "master",
        "name": "C4 & Custom Roadster",
        "cost": 1_000_000,
        "success_bonus": 0.40,
        "description": "+40% - Military-grade explosives, race-tuned machine"
    }
]

# Varied success messages for heist
OC_HEIST_SUCCESS_MESSAGES = [
    "Heist successful! You earned ${reward:,} and {rank_points} rank points!",
    "Clean score. ${reward:,} and {rank_points} rank points.",
    "The job went smooth. You earned ${reward:,} and {rank_points} rank points!",
    "No heat. ${reward:,} and {rank_points} rank points in your pocket.",
    "Done. ${reward:,} and {rank_points} rank points earned.",
    "Smooth run. You got ${reward:,} and {rank_points} rank points!",
    "The take is yours. ${reward:,} and {rank_points} rank points!",
    "Heist successful. ${reward:,} and {rank_points} rank points.",
    "Score. ${reward:,} and {rank_points} rank points.",
    "You got away clean. ${reward:,} and {rank_points} rank points!",
]
# Varied failure messages (like crimes / GTA / jail / rackets)
OC_HEIST_FAIL_CAUGHT_MESSAGES = [
    "Heist failed and you got caught! {jail_time}s jail (unbreakable for 60s)",
    "Busted! The heat was waiting. {jail_time}s in the slammer (unbreakable 60s).",
    "No getaway. They threw the book at you — {jail_time}s jail (unbreakable 60s).",
    "The job blew up. You're in the can for {jail_time}s (unbreakable 60s).",
    "Wrong place, wrong time. {jail_time}s behind bars (unbreakable 60s).",
    "They had the block covered. {jail_time}s in lockup (unbreakable 60s).",
    "Heist failed — you're caught. {jail_time}s jail (unbreakable 60s).",
    "The feds were onto you. Enjoy {jail_time}s in the clink (unbreakable 60s).",
    "No clean escape. {jail_time}s in the joint (unbreakable 60s).",
    "Blown cover. {jail_time}s in the slammer (unbreakable 60s).",
]
OC_HEIST_FAIL_ESCAPED_MESSAGES = [
    "Heist failed, but you escaped!",
    "No score — the job fell through. You got away clean.",
    "The heist went sideways. You slipped out with nothing.",
    "Wrong move. You bailed in time — no rewards, no cuffs.",
    "Something spooked the crew. You escaped empty-handed.",
    "The job blew up. You got away, but came up empty.",
    "No dice. You melted into the crowd with nothing.",
    "Heist failed. You're free, but the take is gone.",
    "The heat was too much. You walked with your skin, that's it.",
    "Clean getaway, but no payout. Live to heist another day.",
]

# Heist jobs with different risk/reward
HEIST_JOBS = [
    {
        "id": "country_bank",
        "name": "Country Bank",
        "base_success_rate": 0.65,
        "reward": 1_800_000,  # With best equipment (2M cost), 92% success = profitable
        "rank_points": 120,
        "jail_time": 45,  # 45 seconds
        "jail_chance": 0.05,  # 5% chance of jail on failure
        "min_rank": 1,
        "setup_cost": 1_000_000
    },
    {
        "id": "state_bank",
        "name": "State Bank",
        "base_success_rate": 0.50,
        "reward": 2_600_000,  # Higher risk, higher reward
        "rank_points": 360,
        "jail_time": 60,  # 1 minute
        "jail_chance": 0.08,  # 8% chance of jail on failure
        "min_rank": 3,
        "setup_cost": 1_000_000
    },
    {
        "id": "city_bank",
        "name": "City Bank",
        "base_success_rate": 0.35,
        "reward": 3_800_000,  # Even higher risk/reward
        "rank_points": 960,
        "jail_time": 75,  # 1 min 15 sec
        "jail_chance": 0.12,  # 12% chance of jail on failure
        "min_rank": 5,
        "setup_cost": 1_000_000
    },
    {
        "id": "government_vault",
        "name": "Government Vault",
        "base_success_rate": 0.20,
        "reward": 5_500_000,  # Maximum risk/reward
        "rank_points": 1920,
        "jail_time": 90,  # 1 min 30 sec (max)
        "jail_chance": 0.15,  # 15% chance of jail on failure
        "min_rank": 7,
        "setup_cost": 1_000_000
    }
]

TEAM_ROLES = ["driver", "weapons", "explosives", "hacker"]


class BuyEquipmentRequest(BaseModel):
    equipment_id: str


class RunHeistRequest(BaseModel):
    job_id: str
    team: dict  # {"driver": "user_id" or "npc", "weapons": ..., etc}


class HeistResponse(BaseModel):
    success: bool
    message: str
    reward: Optional[int] = None
    rank_points: Optional[int] = None
    jailed: bool = False
    jail_until: Optional[str] = None
    unbreakable: bool = False


async def get_equipment(current_user: dict = Depends(get_current_user)):
    """Get available equipment tiers and user's selected equipment."""
    user_equipment = await db.user_organised_crime.find_one(
        {"user_id": current_user["id"]},
        {"_id": 0}
    )
    
    selected_equipment = (user_equipment or {}).get("selected_equipment", "basic")
    
    result = []
    for equip in EQUIPMENT_TIERS:
        result.append({
            **equip,
            "selected": equip["id"] == selected_equipment,
            "can_afford": current_user.get("money", 0) >= equip["cost"]
        })
    
    return {
        "equipment": result,
        "selected_equipment": selected_equipment,
        "note": "Equipment is consumed per heist and charged when heist runs"
    }


async def select_equipment(
    request: BuyEquipmentRequest,
    current_user: dict = Depends(get_current_user)
):
    """Select equipment for next heist (equipment is consumed per heist)."""
    equipment = next((e for e in EQUIPMENT_TIERS if e["id"] == request.equipment_id), None)
    if not equipment:
        raise HTTPException(status_code=404, detail="Equipment not found")
    
    # Store selected equipment for next heist (not charged until heist runs)
    await db.user_organised_crime.update_one(
        {"user_id": current_user["id"]},
        {
            "$set": {
                "selected_equipment": equipment["id"],
                "selected_at": datetime.now(timezone.utc).isoformat()
            }
        },
        upsert=True
    )
    
    return {
        "success": True,
        "message": f"Selected {equipment['name']} for next heist!",
        "equipment": equipment,
        "note": f"Equipment cost (${equipment['cost']:,}) will be charged when heist runs"
    }


async def get_heist_jobs(current_user: dict = Depends(get_current_user)):
    """Get available heist jobs."""
    user_rank, _ = get_rank_info(current_user.get("rank_points", 0))
    
    # Get user's selected equipment for bonus calculation
    user_equipment = await db.user_organised_crime.find_one(
        {"user_id": current_user["id"]},
        {"_id": 0}
    )
    equipment_tier = (user_equipment or {}).get("selected_equipment", "basic")
    equipment = next((e for e in EQUIPMENT_TIERS if e["id"] == equipment_tier), EQUIPMENT_TIERS[0])
    
    result = []
    for job in HEIST_JOBS:
        final_success_rate = min(0.92, job["base_success_rate"] + equipment["success_bonus"])
        total_cost = job["setup_cost"] + equipment["cost"]
        
        result.append({
            **job,
            "unlocked": user_rank >= job["min_rank"],
            "final_success_rate": final_success_rate,
            "equipment_bonus": equipment["success_bonus"],
            "total_cost": total_cost
        })
    
    return {
        "jobs": result,
        "selected_equipment": equipment
    }


async def run_heist(
    request: RunHeistRequest,
    current_user: dict = Depends(get_current_user)
):
    """Run an organised crime heist."""
    if current_user.get("in_jail"):
        raise HTTPException(status_code=400, detail="You can't run heists while in jail")
    
    # Find the job
    job = next((j for j in HEIST_JOBS if j["id"] == request.job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Heist job not found")
    
    # Check rank requirement
    user_rank, _ = get_rank_info(current_user.get("rank_points", 0))
    if user_rank < job["min_rank"]:
        raise HTTPException(
            status_code=403,
            detail=f"Requires rank {job['min_rank']}"
        )
    
    # Get user's selected equipment
    user_equipment = await db.user_organised_crime.find_one(
        {"user_id": current_user["id"]},
        {"_id": 0}
    )
    equipment_tier = (user_equipment or {}).get("selected_equipment", "basic")
    equipment = next((e for e in EQUIPMENT_TIERS if e["id"] == equipment_tier), EQUIPMENT_TIERS[0])
    
    # Calculate total cost (setup + equipment)
    total_cost = job["setup_cost"] + equipment["cost"]
    
    # Check if user can afford total cost
    if current_user.get("money", 0) < total_cost:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough money. Need ${total_cost:,} (${job['setup_cost']:,} setup + ${equipment['cost']:,} equipment)"
        )
    
    # Validate team (must have all 4 roles filled)
    if not all(role in request.team for role in TEAM_ROLES):
        raise HTTPException(
            status_code=400,
            detail="Team must have all roles: driver, weapons, explosives, hacker"
        )
    
    # Deduct total cost (setup + equipment consumed)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": -total_cost}}
    )
    
    # Calculate success rate
    success_rate = min(0.92, job["base_success_rate"] + equipment["success_bonus"])
    success = random.random() < success_rate
    
    now = datetime.now(timezone.utc)
    
    if success:
        # Success - award money and rank points
        rp_before = int(current_user.get("rank_points") or 0)
        rp_added = int(job.get("rank_points") or 0)
        await db.users.update_one(
            {"id": current_user["id"]},
            {
                "$inc": {
                    "money": job["reward"],
                    "rank_points": rp_added,
                    "total_heists": 1,
                    "successful_heists": 1
                }
            }
        )
        try:
            await maybe_process_rank_up(current_user["id"], rp_before, rp_added, current_user.get("username", ""))
        except Exception as e:
            logger.exception("Rank-up notification (OC): %s", e)
        
        # Track heist stats
        await db.user_organised_crime.update_one(
            {"user_id": current_user["id"]},
            {
                "$inc": {"total_heists": 1, "successful_heists": 1},
                "$set": {"last_heist": now.isoformat()}
            },
            upsert=True
        )
        
        msg = random.choice(OC_HEIST_SUCCESS_MESSAGES).format(
            reward=job["reward"], rank_points=job["rank_points"]
        )
        return HeistResponse(
            success=True,
            message=msg,
            reward=job["reward"],
            rank_points=job["rank_points"],
            jailed=False
        )
    
    else:
        # Failure - chance of jail
        goes_to_jail = random.random() < job["jail_chance"]
        
        # Track failed heist
        await db.user_organised_crime.update_one(
            {"user_id": current_user["id"]},
            {
                "$inc": {"total_heists": 1},
                "$set": {"last_heist": now.isoformat()}
            },
            upsert=True
        )
        
        if goes_to_jail:
            # UNBREAKABLE JAIL for 60 seconds
            jail_until = now + timedelta(seconds=job["jail_time"])
            unbreakable_until = now + timedelta(seconds=60)
            
            await db.users.update_one(
                {"id": current_user["id"]},
                {
                    "$set": {
                        "in_jail": True,
                        "jail_until": jail_until.isoformat(),
                        "unbreakable_until": unbreakable_until.isoformat()
                    }
                }
            )
            
            msg = random.choice(OC_HEIST_FAIL_CAUGHT_MESSAGES).format(jail_time=job["jail_time"])
            return HeistResponse(
                success=False,
                message=msg,
                jailed=True,
                jail_until=jail_until.isoformat(),
                unbreakable=True
            )
        
        else:
            # Failed but escaped
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": {"total_heists": 1}}
            )
            msg = random.choice(OC_HEIST_FAIL_ESCAPED_MESSAGES)
            return HeistResponse(
                success=False,
                message=msg,
                jailed=False
            )


def register(router):
    """Register organised crime routes."""
    router.add_api_route("/organised-crime/equipment", get_equipment, methods=["GET"])
    router.add_api_route("/organised-crime/equipment/select", select_equipment, methods=["POST"])
    router.add_api_route("/organised-crime/jobs", get_heist_jobs, methods=["GET"])
    router.add_api_route(
        "/organised-crime/heist",
        run_heist,
        methods=["POST"],
        response_model=HeistResponse
    )
