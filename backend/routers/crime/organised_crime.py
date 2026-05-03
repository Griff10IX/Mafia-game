# Organised Crime endpoints: equipment, heists, team management
import logging
from datetime import datetime, timezone, timedelta
import secrets
_rng = secrets.SystemRandom()
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

from server import (
    db,
    get_current_user,
    get_current_user_verified,
    get_rank_info,
    user_prestige_rank_mult,
    log_respect_earned,
    maybe_process_rank_up,
    maybe_respect_points_drop,
    founding_member_income_mult,
)
from utils.game_pass_season_rp import apply_season_rp_mirror_to_update

# Equipment tiers for Organised Crime (reduced for beta)
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
        "cost": 25_000,
        "success_bonus": 0.10,
        "description": "+10% - Better explosives, faster getaway car"
    },
    {
        "id": "professional",
        "name": "Nitroglycerin & Duesenberg",
        "cost": 43_750,
        "success_bonus": 0.20,
        "description": "+20% - Pro safecracking, luxury getaway vehicle"
    },
    {
        "id": "elite",
        "name": "Tommy Gun & Armored Cadillac",
        "cost": 56_250,
        "success_bonus": 0.30,
        "description": "+30% - Heavy firepower, bulletproof transport"
    },
    {
        "id": "master",
        "name": "C4 & Custom Roadster",
        "cost": 62_500,
        "success_bonus": 0.40,
        "description": "+40% - Military-grade explosives, race-tuned machine"
    }
]

# Organised crime: success from job base_success_rate + equipment success_bonus (capped 92%). Rest is fail or jail.
OC_JAIL_CHANCE_ON_FAIL = 0.50  # Of failures, half go to jail

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
    "Like clockwork. ${reward:,} and {rank_points} rank points.",
    "The vault was yours. ${reward:,} and {rank_points} rank points.",
    "Nobody saw a thing. ${reward:,} and {rank_points} rank points.",
    "Perfect execution. ${reward:,} and {rank_points} rank points.",
    "The crew delivered. ${reward:,} and {rank_points} rank points.",
]
OC_HEIST_SUCCESS_MESSAGES_CASH_ONLY = [
    "Heist successful! You earned ${reward:,}!",
    "Clean score. ${reward:,}.",
    "The job went smooth. You earned ${reward:,}!",
    "No heat. ${reward:,} in your pocket.",
    "Done. ${reward:,} earned.",
    "Smooth run. You got ${reward:,}!",
    "The take is yours: ${reward:,}!",
    "Heist successful. ${reward:,}.",
    "Score. ${reward:,}.",
    "You got away clean with ${reward:,}!",
    "Like clockwork. ${reward:,}.",
    "The vault was yours: ${reward:,}.",
    "Nobody saw a thing. ${reward:,}.",
    "Perfect execution. ${reward:,}.",
    "The crew delivered. ${reward:,}.",
]
OC_HEIST_FAIL_CAUGHT_MESSAGES = [
    "Heist failed and you got caught! {jail_time}s jail (unbreakable for 60s).",
    "Busted! The heat was waiting. {jail_time}s in the slammer (unbreakable 60s).",
    "No getaway. They threw the book at you — {jail_time}s jail (unbreakable 60s).",
    "The job blew up. You're in the can for {jail_time}s (unbreakable 60s).",
    "Wrong place, wrong time. {jail_time}s behind bars (unbreakable 60s).",
    "They had the block covered. {jail_time}s in lockup (unbreakable 60s).",
    "Heist failed — you're caught. {jail_time}s jail (unbreakable 60s).",
    "The feds were onto you. Enjoy {jail_time}s in the clink (unbreakable 60s).",
    "No clean escape. {jail_time}s in the joint (unbreakable 60s).",
    "Blown cover. {jail_time}s in the slammer (unbreakable 60s).",
    "Someone talked. {jail_time}s in the pen (unbreakable 60s).",
    "Cops were already there. {jail_time}s jail (unbreakable 60s).",
    "Alarm tripped — no way out. {jail_time}s behind bars (unbreakable 60s).",
    "They had your picture. {jail_time}s in the can (unbreakable 60s).",
    "Getaway car didn't start. {jail_time}s in lockup (unbreakable 60s).",
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
    "Safe cracked wrong — nothing inside. You left before the law showed.",
    "Inside man didn't show. You called it off and slipped away.",
    "Too many eyes. You aborted and disappeared.",
    "Alarm went early. You ran with nothing.",
    "Double-crossed. You got out with your life, not the cash.",
]

# Heist jobs with different risk/reward (reduced for beta)
HEIST_JOBS = [
    {
        "id": "country_bank",
        "name": "Country Bank",
        "base_success_rate": 0.65,
        "reward": 131_250,
        "rank_points": 120,
        "jail_time": 45,
        "jail_chance": 0.05,
        "min_rank": 2,
        "setup_cost": 62_500
    },
    {
        "id": "state_bank",
        "name": "State Bank",
        "base_success_rate": 0.50,
        "reward": 162_500,
        "rank_points": 360,
        "jail_time": 60,
        "jail_chance": 0.08,
        "min_rank": 4,
        "setup_cost": 62_500
    },
    {
        "id": "city_bank",
        "name": "City Bank",
        "base_success_rate": 0.35,
        "reward": 237_500,
        "rank_points": 960,
        "jail_time": 75,
        "jail_chance": 0.12,
        "min_rank": 6,
        "setup_cost": 62_500
    },
    {
        "id": "government_vault",
        "name": "Government Vault",
        "base_success_rate": 0.20,
        "reward": 343_750,
        "rank_points": 1920,
        "jail_time": 90,
        "jail_chance": 0.15,
        "min_rank": 8,
        "setup_cost": 62_500
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
    current_user: dict = Depends(get_current_user_verified)
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
    user_rank, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
    
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
    current_user: dict = Depends(get_current_user_verified)
):
    """Run an organised crime heist."""
    if current_user.get("in_jail"):
        raise HTTPException(status_code=400, detail="You can't run heists while in jail")
    
    # Find the job
    job = next((j for j in HEIST_JOBS if j["id"] == request.job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Heist job not found")
    
    # Check rank requirement
    user_rank, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
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
    
    # Validate team (must have all 4 roles filled)
    if not all(role in request.team for role in TEAM_ROLES):
        raise HTTPException(
            status_code=400,
            detail="Team must have all roles: driver, weapons, explosives, inside man"
        )
    
    result = await db.users.update_one(
        {"id": current_user["id"], "money": {"$gte": total_cost}},
        {"$inc": {"money": -total_cost}},
    )
    if result.modified_count == 0:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough money. Need ${total_cost:,} (${job['setup_cost']:,} setup + ${equipment['cost']:,} equipment)"
        )
    
    # Success chance from job base + equipment bonus (capped 92%); ensures equipment always helps
    success_rate = min(0.92, job["base_success_rate"] + equipment["success_bonus"])
    success = _rng.random() < success_rate
    
    now = datetime.now(timezone.utc)
    
    if success:
        # Success - award money and rank points
        money_reward = int(job.get("reward") or 0)
        rp_before = int(current_user.get("rank_points") or 0)
        rp_added = int(job.get("rank_points") or 0)
        oc_inc = {
            "money": money_reward,
            "rank_points": rp_added,
            "total_heists": 1,
            "successful_heists": 1
        }
        respect_drop = maybe_respect_points_drop()
        if respect_drop:
            oc_inc["respect_points"] = respect_drop
        await db.users.update_one(
            {"id": current_user["id"]},
            apply_season_rp_mirror_to_update({"$inc": oc_inc}),
        )
        if oc_inc.get("respect_points"):
            await log_respect_earned(current_user["id"], oc_inc["respect_points"], "oc")
        try:
            await maybe_process_rank_up(current_user["id"], rp_before, rp_added, current_user.get("username", ""), user_prestige_rank_mult(current_user))
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
        
        if rp_added:
            msg = _rng.choice(OC_HEIST_SUCCESS_MESSAGES).format(
                reward=money_reward, rank_points=rp_added
            )
        else:
            msg = _rng.choice(OC_HEIST_SUCCESS_MESSAGES_CASH_ONLY).format(reward=money_reward)
        return HeistResponse(
            success=True,
            message=msg,
            reward=money_reward,
            rank_points=rp_added,
            jailed=False
        )
    
    else:
        # Failure — 50% jail, 50% escape
        goes_to_jail = _rng.random() < OC_JAIL_CHANCE_ON_FAIL
        
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
            jail_time_sec = int(job.get("jail_time", 45))
            jail_until = now + timedelta(seconds=jail_time_sec)
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
            
            msg = _rng.choice(OC_HEIST_FAIL_CAUGHT_MESSAGES).format(jail_time=jail_time_sec)
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
            msg = _rng.choice(OC_HEIST_FAIL_ESCAPED_MESSAGES)
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
