# Jail endpoints: list players (incl. jail NPCs), bust out, status; NPC admin & list; jail NPC spawner
import asyncio
import logging
import random
import uuid
from datetime import datetime, timezone, timedelta
from fastapi import Depends, HTTPException

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import (
    db,
    get_current_user,
    get_rank_info,
    BustOutRequest,
    JailSetBustRewardRequest,
    ADMIN_EMAILS,
    NPCToggleRequest,
    RANKS,
    STATES,
)

logger = logging.getLogger(__name__)

# NPC bust success by rank (higher rank = harder to bust)
NPC_BUST_SUCCESS_BY_RANK_NAME = {
    "Street Thug": 0.75,
    "Hustler": 0.70,
    "Goon": 0.65,
    "Made Man": 0.60,
    "Capo": 0.55,
    "Underboss": 0.50,
    "Consigliere": 0.45,
    "Boss": 0.40,
    "Don": 0.35,
    "Godfather": 0.30,
    "The Commission": 0.25,
}


def _npc_bust_success_rate(npc_rank_name: str | None) -> float:
    return NPC_BUST_SUCCESS_BY_RANK_NAME.get(npc_rank_name or "", 0.5)


async def get_jailed_players(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    real_players_raw = await db.users.find(
        {"in_jail": True},
        {"_id": 0, "username": 1, "id": 1, "rank_points": 1, "jail_until": 1, "bust_reward_cash": 1},
    ).to_list(50)
    real_players = []
    for p in real_players_raw:
        jail_until_iso = p.get("jail_until")
        if not jail_until_iso:
            await db.users.update_one(
                {"id": p["id"]},
                {"$set": {"in_jail": False, "jail_until": None}},
            )
            continue
        try:
            jail_until = datetime.fromisoformat(jail_until_iso)
            if jail_until.tzinfo is None:
                jail_until = jail_until.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if jail_until <= now:
            await db.users.update_one(
                {"id": p["id"]},
                {"$set": {"in_jail": False, "jail_until": None}},
            )
            continue
        real_players.append(p)
    npcs = await db.jail_npcs.find({}, {"_id": 0}).to_list(20)
    players_data = []
    for player in real_players:
        rank_id, rank_name = get_rank_info(player.get("rank_points", 0))
        reward_cash = int((player.get("bust_reward_cash") or 0) or 0)
        players_data.append(
            {
                "username": player["username"],
                "rank_name": rank_name,
                "is_npc": False,
                "is_self": player["id"] == current_user["id"],
                "bust_success_rate": 70,
                "rp_reward": 15,
                "bust_reward_cash": reward_cash,
            }
        )
    for npc in npcs:
        npc_rate = _npc_bust_success_rate(npc.get("rank_name"))
        players_data.append(
            {
                "username": npc["username"],
                "rank_name": npc.get("rank_name", "Goon"),
                "is_npc": True,
                "bust_success_rate": int(round(npc_rate * 100)),
                "rp_reward": 25,
                "bust_reward_cash": 0,
            }
        )
    return {"players": players_data}


async def bust_out_of_jail(
    request: BustOutRequest, current_user: dict = Depends(get_current_user)
):
    npc = await db.jail_npcs.find_one(
        {"username": request.target_username}, {"_id": 0}
    )
    if npc:
        success_rate = _npc_bust_success_rate(npc.get("rank_name"))
        success = random.random() < success_rate
        rank_points = 25
        if success:
            new_consec = (current_user.get("current_consecutive_busts") or 0) + 1
            record = max((current_user.get("consecutive_busts_record") or 0), new_consec)
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": {"rank_points": rank_points, "jail_busts": 1}, "$set": {"current_consecutive_busts": new_consec, "consecutive_busts_record": record}},
            )
            await db.jail_npcs.delete_one({"username": request.target_username})
            return {
                "success": True,
                "message": f"Successfully busted out {request.target_username}!",
                "rank_points_earned": rank_points,
            }
        jail_until = datetime.now(timezone.utc) + timedelta(seconds=30)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"in_jail": True, "jail_until": jail_until.isoformat(), "current_consecutive_busts": 0}},
        )
        return {
            "success": False,
            "message": "Bust failed! You got caught and sent to jail.",
            "jail_time": 30,
        }
    target = await db.users.find_one(
        {"username": request.target_username}, {"_id": 0}
    )
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    if target["id"] == current_user["id"]:
        raise HTTPException(
            status_code=400,
            detail="You cannot bust yourself out. Ask another player for help.",
        )
    if not target.get("in_jail"):
        raise HTTPException(status_code=400, detail="Target is not in jail")
    success = random.random() < 0.7
    if success:
        rank_points = 15
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {"in_jail": False, "jail_until": None}},
        )
        reward_cash = int((target.get("bust_reward_cash") or 0) or 0)
        target_money = int((target.get("money") or 0) or 0)
        cash_to_pay = min(reward_cash, target_money) if reward_cash > 0 else 0
        if cash_to_pay > 0:
            await db.users.update_one({"id": target["id"]}, {"$inc": {"money": -cash_to_pay}})
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": cash_to_pay}})
        new_consec = (current_user.get("current_consecutive_busts") or 0) + 1
        record = max((current_user.get("consecutive_busts_record") or 0), new_consec)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"rank_points": rank_points, "jail_busts": 1}, "$set": {"current_consecutive_busts": new_consec, "consecutive_busts_record": record}},
        )
        return {
            "success": True,
            "message": f"Successfully busted out {target['username']}!",
            "rank_points_earned": rank_points,
            "cash_reward": cash_to_pay,
        }
    jail_until = datetime.now(timezone.utc) + timedelta(seconds=30)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"in_jail": True, "jail_until": jail_until.isoformat(), "current_consecutive_busts": 0}},
    )
    return {
        "success": False,
        "message": "Bust failed! You got caught and sent to jail.",
        "jail_time": 30,
    }


async def get_jail_status(current_user: dict = Depends(get_current_user)):
    jail_busts = int((current_user.get("jail_busts") or 0) or 0)
    bust_reward_cash = int((current_user.get("bust_reward_cash") or 0) or 0)
    current_consecutive_busts = int((current_user.get("current_consecutive_busts") or 0) or 0)
    consecutive_busts_record = int((current_user.get("consecutive_busts_record") or 0) or 0)
    base = {
        "jail_busts": jail_busts,
        "bust_reward_cash": bust_reward_cash,
        "current_consecutive_busts": current_consecutive_busts,
        "consecutive_busts_record": consecutive_busts_record,
    }
    if not current_user.get("in_jail"):
        return {"in_jail": False, **base}
    jail_until = datetime.fromisoformat(current_user["jail_until"])
    now = datetime.now(timezone.utc)
    if jail_until <= now:
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"in_jail": False, "jail_until": None}},
        )
        return {"in_jail": False, **base}
    seconds_remaining = int((jail_until - now).total_seconds())
    return {
        "in_jail": True,
        "jail_until": current_user["jail_until"],
        "seconds_remaining": seconds_remaining,
        **base,
    }


async def set_bust_reward(request: JailSetBustRewardRequest, current_user: dict = Depends(get_current_user)):
    """Set the $ reward offered to whoever busts you out. 0 to clear."""
    amount = max(0, int(request.amount))
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"bust_reward_cash": amount}},
    )
    return {"message": f"Bust reward set to ${amount:,}" if amount else "Bust reward cleared.", "bust_reward_cash": amount}


async def leave_jail(current_user: dict = Depends(get_current_user)):
    """Pay 3 points to leave jail immediately."""
    if not current_user.get("in_jail"):
        raise HTTPException(status_code=400, detail="You are not in jail")
    current_pts = int(current_user.get("points", 0) or 0)
    if current_pts < 3:
        raise HTTPException(status_code=400, detail="You need at least 3 points to leave jail")
    await db.users.update_one(
        {"id": current_user["id"]},
        {
            "$set": {"in_jail": False, "jail_until": None},
            "$inc": {"points": -3},
        },
    )
    return {
        "success": True,
        "message": "You paid 3 points and left jail!",
        "points_spent": 3,
    }


async def get_admin_npcs(current_user: dict = Depends(get_current_user)):
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    npcs = await db.test_npcs.find({}, {"_id": 0}).to_list(100)
    settings = await db.game_settings.find_one({"key": "npcs_enabled"}, {"_id": 0})
    return {
        "npcs": npcs,
        "npcs_enabled": settings.get("value", False) if settings else False,
        "npc_count": len(npcs),
    }


async def toggle_npcs(request: NPCToggleRequest, current_user: dict = Depends(get_current_user)):
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    await db.game_settings.update_one(
        {"key": "npcs_enabled"},
        {"$set": {"value": request.enabled}},
        upsert=True,
    )
    if request.enabled and request.count > 0:
        npc_first = ["Big", "Mad", "Lucky", "Fast", "Iron", "Steel", "Crazy", "Silent", "Golden", "Diamond"]
        npc_last = ["Tony", "Mike", "Sal", "Vinny", "Frank", "Lou", "Carlo", "Marco", "Rico", "Dom"]
        await db.test_npcs.delete_many({})
        npcs_to_create = []
        for i in range(min(request.count, 50)):
            rank_idx = random.randint(0, len(RANKS) - 1)
            rank = RANKS[rank_idx]
            npc = {
                "id": str(uuid.uuid4()),
                "username": f"{random.choice(npc_first)} {random.choice(npc_last)} #{i+1}",
                "rank": rank["id"],
                "rank_name": rank["name"],
                "rank_points": random.randint(rank["required_points"], rank["required_points"] + 500),
                "money": random.randint(1000, 10000000),
                "current_state": random.choice(STATES),
                "in_jail": random.random() < 0.2,
                "bullets": random.randint(0, 1000),
                "is_npc": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            npcs_to_create.append(npc)
        if npcs_to_create:
            await db.test_npcs.insert_many(npcs_to_create)
        return {"message": f"NPCs enabled. Created {len(npcs_to_create)} test NPCs."}
    elif not request.enabled:
        await db.test_npcs.delete_many({})
        return {"message": "NPCs disabled and cleared."}
    return {"message": "NPCs setting updated"}


async def list_npcs_for_attack(current_user: dict = Depends(get_current_user)):
    """Get NPCs that can be attacked (same state, not in jail)."""
    settings = await db.game_settings.find_one({"key": "npcs_enabled"}, {"_id": 0})
    if not settings or not settings.get("value"):
        return {"npcs": [], "enabled": False}
    npcs = await db.test_npcs.find(
        {"current_state": current_user["current_state"], "in_jail": False},
        {"_id": 0},
    ).to_list(20)
    return {"npcs": npcs, "enabled": True}


async def spawn_jail_npcs():
    """Background task to spawn NPCs in jail every 1-2 minutes. Call from app startup."""
    npc_names = [
        "Tony the Rat", "Vinny the Snake", "Lucky Lou", "Mad Dog Mike",
        "Scarface Sam", "Big Al", "Johnny Two-Times", "Knuckles McGee",
        "Frankie the Fist", "Lefty Louie", "Joey Bananas", "Paulie Walnuts",
    ]
    while True:
        try:
            await asyncio.sleep(random.randint(60, 120))
            current_npcs = await db.jail_npcs.count_documents({})
            if current_npcs < 5:
                npc_name = random.choice(npc_names)
                rank_names = [r["name"] for r in RANKS]
                weights = [30, 25, 20, 15, 10, 7, 5, 3, 2, 1, 1]
                existing = await db.jail_npcs.find_one({"username": npc_name})
                if not existing:
                    await db.jail_npcs.insert_one({
                        "username": npc_name,
                        "rank_name": random.choices(rank_names, weights=weights, k=1)[0],
                        "spawned_at": datetime.now(timezone.utc).isoformat(),
                    })
        except Exception as e:
            logger.error(f"Error spawning jail NPC: {e}")
            await asyncio.sleep(60)


def register(router):
    router.add_api_route("/jail/players", get_jailed_players, methods=["GET"])
    router.add_api_route("/jail/bust", bust_out_of_jail, methods=["POST"])
    router.add_api_route("/jail/status", get_jail_status, methods=["GET"])
    router.add_api_route("/jail/set-bust-reward", set_bust_reward, methods=["POST"])
    router.add_api_route("/jail/leave", leave_jail, methods=["POST"])
    router.add_api_route("/admin/npcs", get_admin_npcs, methods=["GET"])
    router.add_api_route("/admin/npcs/toggle", toggle_npcs, methods=["POST"])
    router.add_api_route("/npcs/list", list_npcs_for_attack, methods=["GET"])
