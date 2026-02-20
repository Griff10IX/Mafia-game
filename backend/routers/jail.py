# Jail endpoints: list players (incl. jail NPCs), bust out, status; NPC admin & list; jail NPC spawner
import asyncio
import logging
import re
import random
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import Depends, HTTPException
from pydantic import BaseModel

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class BustOutRequest(BaseModel):
    target_username: str


class JailSetBustRewardRequest(BaseModel):
    amount: int  # $ reward for whoever busts you out (0 to clear)


class NPCToggleRequest(BaseModel):
    enabled: bool
    count: int


# ---------------------------------------------------------------------------

from server import (
    db,
    get_current_user,
    get_rank_info,
    maybe_process_rank_up,
    ADMIN_EMAILS,
    RANKS,
    STATES,
)
from routers.objectives import update_objectives_progress

logger = logging.getLogger(__name__)

# Varied success messages when bust succeeds
JAIL_BUST_SUCCESS_MESSAGES = [
    "Successfully busted out {target_username}!",
    "Clean breakout. {target_username} is free!",
    "You got them out. {target_username} is on the street.",
    "Bust successful! {target_username} is out.",
    "No heat. {target_username} is clear.",
    "Done. {target_username} busted out!",
    "Smooth work. {target_username} is free.",
    "You sprung {target_username}!",
    "Breakout complete. {target_username} is out.",
    "The screws never saw you. {target_username} is free.",
]
# Varied failure messages when bust attempt fails and you get caught (like crimes / GTA / rackets)
JAIL_BUST_FAIL_MESSAGES = [
    "Bust failed! You got caught and sent to jail.",
    "The guards were onto you. You're in the slammer for 30 seconds.",
    "No dice — they nabbed you at the gate. Enjoy the clink.",
    "Bust blown. The screws got you. 30 seconds in lockup.",
    "Wrong move. You're behind bars now. Better luck next time.",
    "They were waiting. Bust failed — 30 seconds in jail.",
    "The heat was too much. You're in the can.",
    "No breakout this time. You got caught. 30 seconds.",
    "The guards had the block covered. Bust failed — see you in 30s.",
    "Sloppy work. They threw you in. 30 seconds to think it over.",
]


# Jail busts a bit harder: raw rates multiplied by this (0.9 = 10% less success)
JAIL_BUST_DIFFICULTY_MULT = 0.9


def _player_bust_success_rate(total_attempts: int) -> float:
    """Calculate player bust success rate based on experience (total attempts, not just successes). Softer curve: higher base rates, lower thresholds for max 90%. Then multiplied by JAIL_BUST_DIFFICULTY_MULT."""
    if total_attempts < 150:
        raw = 0.06  # 6% - Everyone starts here
    elif total_attempts < 350:
        raw = 0.12
    elif total_attempts < 700:
        raw = 0.20
    elif total_attempts < 1500:
        raw = 0.28
    elif total_attempts < 3000:
        raw = 0.38
    elif total_attempts < 5500:
        raw = 0.50
    elif total_attempts < 9500:
        raw = 0.62
    elif total_attempts < 14500:
        raw = 0.72
    elif total_attempts < 20000:
        raw = 0.82
    else:
        raw = 0.90  # Master buster
    return raw * JAIL_BUST_DIFFICULTY_MULT


# Cache for jail NPCs list (invalidated when spawn adds or bust removes an NPC)
_jail_npcs_cache: Optional[List[dict]] = None


def _invalidate_jail_npcs_cache():
    global _jail_npcs_cache
    _jail_npcs_cache = None


async def _get_jail_npcs():
    """Return jail NPCs list, using cache when valid."""
    global _jail_npcs_cache
    if _jail_npcs_cache is not None:
        return _jail_npcs_cache
    _jail_npcs_cache = await db.jail_npcs.find({}, {"_id": 0}).to_list(20)
    return _jail_npcs_cache


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
    npcs = await _get_jail_npcs()
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
                "rp_reward": 15,
                "bust_reward_cash": reward_cash,
            }
        )
    for npc in npcs:
        bust_reward_cash = int((npc.get("bust_reward_cash") or 0) or 0)
        players_data.append(
            {
                "username": npc["username"],
                "rank_name": npc.get("rank_name", "Goon"),
                "is_npc": True,
                "rp_reward": 25,
                "bust_reward_cash": bust_reward_cash,
            }
        )
    return {"players": players_data}


async def _record_bust_event(user_id: str, success: bool, profit: int):
    """Record a bust attempt for stats (today/week, profit). Called from _attempt_bust_impl so both manual and Auto Rank busts are counted."""
    now = datetime.now(timezone.utc)
    try:
        await db.bust_events.insert_one({"user_id": user_id, "at": now, "success": success, "profit": profit})
    except Exception as e:
        logger.exception("Record bust event: %s", e)


async def _attempt_bust_impl(current_user: dict, target_username: str) -> dict:
    """Attempt to bust target (NPC or player) out of jail. Returns dict with success, message, optional rank_points_earned, cash_reward, jail_time. On validation failure returns {success: False, error: str, error_code: int}."""
    target_name = (target_username or "").strip()
    username_ci = re.compile("^" + re.escape(target_name) + "$", re.IGNORECASE) if target_name else None
    if not username_ci:
        return {"success": False, "error": "Target username required", "error_code": 400}

    total_attempts = int(current_user.get("jail_bust_attempts", 0) or 0)
    player_success_rate = _player_bust_success_rate(total_attempts)

    npc = await db.jail_npcs.find_one({"username": username_ci}, {"_id": 0})
    if npc:
        success = random.random() < player_success_rate
        rank_points = 25
        bust_reward_cash = int((npc.get("bust_reward_cash") or 0) or 0)
        if success:
            new_consec = (current_user.get("current_consecutive_busts") or 0) + 1
            record = max((current_user.get("consecutive_busts_record") or 0), new_consec)
            rp_before = int(current_user.get("rank_points") or 0)
            updates = {"$inc": {"rank_points": rank_points, "jail_busts": 1, "jail_bust_attempts": 1}, "$set": {"current_consecutive_busts": new_consec, "consecutive_busts_record": record}}
            if bust_reward_cash > 0:
                updates["$inc"]["money"] = bust_reward_cash
            await db.users.update_one({"id": current_user["id"]}, updates)
            try:
                await maybe_process_rank_up(current_user["id"], rp_before, rank_points, current_user.get("username", ""))
            except Exception as e:
                logger.exception("Rank-up notification (jail NPC bust): %s", e)
            await db.jail_npcs.delete_one({"username": npc["username"]})
            _invalidate_jail_npcs_cache()
            try:
                await update_objectives_progress(current_user["id"], "busts", 1)
            except Exception:
                pass
            await _record_bust_event(current_user["id"], True, bust_reward_cash)
            msg = random.choice(JAIL_BUST_SUCCESS_MESSAGES).format(target_username=target_username)
            return {"success": True, "message": msg, "rank_points_earned": rank_points, "cash_reward": bust_reward_cash}
        jail_until = datetime.now(timezone.utc) + timedelta(seconds=30)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"jail_bust_attempts": 1}, "$set": {"in_jail": True, "jail_until": jail_until.isoformat(), "current_consecutive_busts": 0}},
        )
        await _record_bust_event(current_user["id"], False, 0)
        return {"success": False, "message": random.choice(JAIL_BUST_FAIL_MESSAGES), "jail_time": 30}

    target = await db.users.find_one({"username": username_ci}, {"_id": 0})
    if not target:
        return {"success": False, "error": "Target user not found", "error_code": 404}
    if target["id"] == current_user["id"]:
        return {"success": False, "error": "You cannot bust yourself out. Ask another player for help.", "error_code": 400}
    if not target.get("in_jail"):
        return {"success": False, "error": "Target is not in jail", "error_code": 400}
    if target.get("unbreakable_until"):
        try:
            unbreakable_time = datetime.fromisoformat(target["unbreakable_until"])
            if unbreakable_time > datetime.now(timezone.utc):
                remaining = int((unbreakable_time - datetime.now(timezone.utc)).total_seconds())
                return {"success": False, "error": f"This player cannot be busted out for {remaining}s (high security lockdown)", "error_code": 400}
        except (ValueError, TypeError):
            pass

    success = random.random() < player_success_rate
    if success:
        rank_points = 15
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {"in_jail": False, "jail_until": None, "unbreakable_until": None}},
        )
        reward_cash = int((target.get("bust_reward_cash") or 0) or 0)
        target_money = int((target.get("money") or 0) or 0)
        cash_to_pay = min(reward_cash, target_money) if reward_cash > 0 else 0
        if cash_to_pay > 0:
            await db.users.update_one({"id": target["id"]}, {"$inc": {"money": -cash_to_pay}})
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": cash_to_pay}})
        new_consec = (current_user.get("current_consecutive_busts") or 0) + 1
        record = max((current_user.get("consecutive_busts_record") or 0), new_consec)
        rp_before = int(current_user.get("rank_points") or 0)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"rank_points": rank_points, "jail_busts": 1, "jail_bust_attempts": 1}, "$set": {"current_consecutive_busts": new_consec, "consecutive_busts_record": record}},
        )
        try:
            await maybe_process_rank_up(current_user["id"], rp_before, rank_points, current_user.get("username", ""))
        except Exception as e:
            logger.exception("Rank-up notification (jail player bust): %s", e)
        try:
            await update_objectives_progress(current_user["id"], "busts", 1)
        except Exception:
            pass
        await _record_bust_event(current_user["id"], True, cash_to_pay)
        msg = random.choice(JAIL_BUST_SUCCESS_MESSAGES).format(target_username=target["username"])
        return {"success": True, "message": msg, "rank_points_earned": rank_points, "cash_reward": cash_to_pay}
    jail_until = datetime.now(timezone.utc) + timedelta(seconds=30)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"jail_bust_attempts": 1}, "$set": {"in_jail": True, "jail_until": jail_until.isoformat(), "current_consecutive_busts": 0}},
    )
    await _record_bust_event(current_user["id"], False, 0)
    return {"success": False, "message": random.choice(JAIL_BUST_FAIL_MESSAGES), "jail_time": 30}


async def bust_out_of_jail(
    request: BustOutRequest, current_user: dict = Depends(get_current_user)
):
    result = await _attempt_bust_impl(current_user, request.target_username or "")
    if result.get("error"):
        raise HTTPException(status_code=result.get("error_code", 400), detail=result["error"])
    # bust_events are recorded inside _attempt_bust_impl (so Auto Rank busts are counted too)
    return result


async def get_jail_stats(current_user: dict = Depends(get_current_user)):
    """Return busts today/week, successful busts, profit today / 24h / week."""
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
    cursor = db.bust_events.aggregate(pipeline)
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
        "Dutch Schultz", "Waxey Gordon", "Legs Diamond", "Machine Gun Jack",
        "Nails Morton", "Bugs Moran", "Diamond Joe", "Broadway Charlie",
        "Pretty Amberg", "Mad Dog Coll", "Big Jim Colosimo", "Jake the Barber",
        "Trigger Mike", "Three-Finger Brown", "Sleepy Sam", "Cockeyed Lou",
        "Bottles Capone", "Fats McCarthy", "Greasy Thumb Guzik", "Terrible Tommy",
        "The Enforcer", "Ice Pick Willie", "Slippery Sal", "Cement Charlie",
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
                    rank_name = random.choices(rank_names, weights=weights, k=1)[0]
                    # Cash reward scales with rank (ECONOMY REBALANCE: reduced by ~80%, now lower than crimes)
                    rank_index = rank_names.index(rank_name) if rank_name in rank_names else 0
                    cash_min = 1_000 + rank_index * 1_500
                    cash_max = 3_000 + rank_index * 2_500
                    bust_reward_cash = random.randint(cash_min, cash_max)
                    await db.jail_npcs.insert_one({
                        "username": npc_name,
                        "rank_name": rank_name,
                        "bust_reward_cash": bust_reward_cash,
                        "spawned_at": datetime.now(timezone.utc).isoformat(),
                    })
                    _invalidate_jail_npcs_cache()
        except Exception as e:
            logger.error(f"Error spawning jail NPC: {e}")
            await asyncio.sleep(60)


def register(router):
    router.add_api_route("/jail/players", get_jailed_players, methods=["GET"])
    router.add_api_route("/jail/bust", bust_out_of_jail, methods=["POST"])
    router.add_api_route("/jail/stats", get_jail_stats, methods=["GET"])
    router.add_api_route("/jail/status", get_jail_status, methods=["GET"])
    router.add_api_route("/jail/set-bust-reward", set_bust_reward, methods=["POST"])
    router.add_api_route("/jail/leave", leave_jail, methods=["POST"])
    router.add_api_route("/admin/npcs", get_admin_npcs, methods=["GET"])
    router.add_api_route("/admin/npcs/toggle", toggle_npcs, methods=["POST"])
    router.add_api_route("/npcs/list", list_npcs_for_attack, methods=["GET"])
