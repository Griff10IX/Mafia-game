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


class SnitchRequest(BaseModel):
    target_username: Optional[str] = None  # if None or "random", pick random online user


# ---------------------------------------------------------------------------

from server import (
    db,
    get_current_user,
    get_current_user_verified,
    get_rank_info,
    log_respect_earned,
    maybe_process_rank_up,
    send_notification,
    ADMIN_EMAILS,
    RANKS,
    STATES,
)
from routers.account.objectives import update_objectives_progress

logger = logging.getLogger(__name__)


def _safe_int(val, default: int = 0) -> int:
    """Coerce to int; return default on ValueError/TypeError (e.g. bad DB values)."""
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


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


# Jail bust difficulty: raw rates multiplied by this (1.0 = no penalty; was 0.9, raised slightly to make busting easier)
JAIL_BUST_DIFFICULTY_MULT = 0.95
# Rate can go down with failures but not below this floor
JAIL_BUST_RATE_FLOOR = 0.04  # 4% minimum
# Failure penalty: 0.1% per failure, capped so it doesn't drop by much
JAIL_BUST_FAILURE_PENALTY_PER = 0.001  # 0.1% per failed attempt
JAIL_BUST_MAX_FAILURE_PENALTY = 0.08   # cap total penalty at 8%


def _player_bust_success_rate(total_attempts: int, total_successes: int = 0) -> float:
    """Bust success rate from experience (attempts) and a small penalty for failures. Never goes below JAIL_BUST_RATE_FLOOR."""
    if total_attempts < 150:
        raw = 0.08  # 8% - New buster
    elif total_attempts < 350:
        raw = 0.14
    elif total_attempts < 700:
        raw = 0.22
    elif total_attempts < 1500:
        raw = 0.30
    elif total_attempts < 3000:
        raw = 0.40
    elif total_attempts < 5500:
        raw = 0.52
    elif total_attempts < 9500:
        raw = 0.64
    elif total_attempts < 14500:
        raw = 0.74
    elif total_attempts < 20000:
        raw = 0.84
    else:
        raw = 0.90  # Master buster
    base = raw * JAIL_BUST_DIFFICULTY_MULT
    failures = max(0, total_attempts - total_successes)
    penalty = min(failures * JAIL_BUST_FAILURE_PENALTY_PER, JAIL_BUST_MAX_FAILURE_PENALTY)
    rate = max(JAIL_BUST_RATE_FLOOR, base - penalty)
    return min(1.0, rate + 0.05)  # 5% easier: +5 pp success chance


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
                {"$set": {"in_jail": False, "jail_until": None, "snitch_attempted_this_term": False}, "$unset": {"auto_rank_next_run_at": ""}},
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
                {"$set": {"in_jail": False, "jail_until": None, "snitch_attempted_this_term": False}, "$unset": {"auto_rank_next_run_at": ""}},
            )
            continue
        real_players.append(p)
    npcs = await _get_jail_npcs()
    players_data = []
    for player in real_players:
        rank_id, rank_name = get_rank_info(player.get("rank_points", 0))
        reward_cash = int((player.get("bust_reward_cash") or 0) or 0)
        username = (player.get("username") or "").strip() or "?"
        players_data.append(
            {
                "username": username,
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
    players_data.sort(key=lambda x: int(x.get("bust_reward_cash") or 0), reverse=True)
    return {"players": players_data}


async def _record_bust_event(user_id: str, success: bool, profit: int, target_username: str = None, is_npc: bool = False):
    """Record a bust attempt for stats (today/week, profit). Called from _attempt_bust_impl so both manual and Auto Rank busts are counted."""
    now = datetime.now(timezone.utc)
    try:
        await db.bust_events.insert_one({
            "user_id": user_id,
            "at": now,
            "success": success,
            "profit": profit,
            "target_username": target_username or "",
            "is_npc": is_npc,
        })
    except Exception as e:
        logger.exception("Record bust event: %s", e)


# One-time respect_points rewards when total busts cross milestones (no limit; extended to 5M+)
BUST_MILESTONES = [
    100, 500, 1000, 2000, 5000,
    10_000, 25_000, 50_000, 100_000, 250_000,
    500_000, 1_000_000, 2_000_000, 5_000_000,
]
BUST_MILESTONE_REWARDS = {
    100: 10, 500: 25, 1000: 50, 2000: 100, 5000: 250,
    10_000: 500, 25_000: 1000, 50_000: 2000, 100_000: 4000, 250_000: 8000,
    500_000: 15_000, 1_000_000: 30_000, 2_000_000: 60_000, 5_000_000: 150_000,
}


async def _award_bust_milestones(user_id: str, new_total_busts: int, claimed: list) -> None:
    """If new_total_busts crosses any unclaimed milestone, award respect_points and mark claimed."""
    new_claimed = [m for m in BUST_MILESTONES if m <= new_total_busts and m not in claimed]
    if not new_claimed:
        return
    total_reward = sum(BUST_MILESTONE_REWARDS.get(m, 0) for m in new_claimed)
    try:
        await db.users.update_one(
            {"id": user_id},
            {"$inc": {"respect_points": total_reward}, "$addToSet": {"respect_points_bust_milestones_claimed": {"$each": new_claimed}}},
        )
        await log_respect_earned(user_id, total_reward, "jail_milestone")
        milestones_str = ", ".join(f"{m:,}" for m in sorted(new_claimed))
        await send_notification(
            user_id,
            "Jail bust milestone reached!",
            f"You reached jail bust milestones: {milestones_str}. You earned {total_reward:,} respect points.",
            "system",
            category="system",
        )
    except Exception as e:
        logger.exception("Award bust milestones: %s", e)


async def _attempt_bust_impl(current_user: dict, target_username: str) -> dict:
    """Attempt to bust target (NPC or player) out of jail. Returns dict with success, message, optional rank_points_earned, cash_reward, jail_time. On validation failure returns {success: False, error: str, error_code: int}."""
    target_name = (target_username or "").strip()
    username_ci = re.compile("^" + re.escape(target_name) + "$", re.IGNORECASE) if target_name else None
    if not username_ci:
        return {"success": False, "error": "Target username required", "error_code": 400}
    if current_user.get("in_jail"):
        return {"success": False, "error": "You cannot attempt a bust while you are in jail.", "error_code": 400}

    total_attempts = _safe_int(current_user.get("jail_bust_attempts"), 0)
    total_successes = _safe_int(current_user.get("jail_busts"), 0)
    player_success_rate = _player_bust_success_rate(total_attempts, total_successes)
    jailbust_bonus_until = current_user.get("jailbust_bonus_until")
    if jailbust_bonus_until:
        try:
            until = datetime.fromisoformat(jailbust_bonus_until.replace("Z", "+00:00"))
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) < until:
                player_success_rate = min(0.95, player_success_rate + 0.10)
        except Exception:
            pass

    npc = await db.jail_npcs.find_one({"username": username_ci}, {"_id": 0})
    if npc:
        success = random.random() < player_success_rate
        rank_points = 25
        now_utc = datetime.now(timezone.utc)
        xp_double_until = current_user.get("xp_double_until")
        if xp_double_until:
            try:
                until = datetime.fromisoformat(xp_double_until.replace("Z", "+00:00"))
                if until.tzinfo is None:
                    until = until.replace(tzinfo=timezone.utc)
                if now_utc < until:
                    rank_points = rank_points * 2
            except Exception:
                pass
        bust_reward_cash = _safe_int(npc.get("bust_reward_cash"), 0)
        if success:
            new_consec = _safe_int(current_user.get("current_consecutive_busts"), 0) + 1
            record = max(_safe_int(current_user.get("consecutive_busts_record"), 0), new_consec)
            rp_before = _safe_int(current_user.get("rank_points"), 0)
            updates = {"$inc": {"rank_points": rank_points, "jail_busts": 1, "jail_busts_npc": 1, "jail_bust_attempts": 1}, "$set": {"current_consecutive_busts": new_consec, "consecutive_busts_record": record}}
            if bust_reward_cash > 0:
                updates["$inc"]["money"] = bust_reward_cash
            await db.users.update_one({"id": current_user["id"]}, updates)
            try:
                await maybe_process_rank_up(current_user["id"], rp_before, rank_points, current_user.get("username", ""))
            except Exception as e:
                logger.exception("Rank-up notification (jail NPC bust): %s", e)
            npc_username = npc.get("username")
            if npc_username is not None:
                await db.jail_npcs.delete_one({"username": npc_username})
            _invalidate_jail_npcs_cache()
            try:
                await update_objectives_progress(current_user["id"], "busts", 1)
            except Exception:
                pass
            await _record_bust_event(current_user["id"], True, bust_reward_cash, target_username=target_username, is_npc=True)
            new_total = total_successes + 1
            claimed = current_user.get("respect_points_bust_milestones_claimed") or []
            new_claimed = [m for m in BUST_MILESTONES if m <= new_total and m not in claimed]
            respect_earned = sum(BUST_MILESTONE_REWARDS.get(m, 0) for m in new_claimed)
            await _award_bust_milestones(current_user["id"], new_total, claimed)
            msg = random.choice(JAIL_BUST_SUCCESS_MESSAGES).format(target_username=target_username)
            return {"success": True, "message": msg, "rank_points_earned": rank_points, "cash_reward": bust_reward_cash, "respect_points": respect_earned}
        jail_until = datetime.now(timezone.utc) + timedelta(seconds=30)
        next_attempts = total_attempts + 1
        go_to_jail = True
        jailbust_bonus_until = current_user.get("jailbust_bonus_until")
        if jailbust_bonus_until:
            try:
                until = datetime.fromisoformat(jailbust_bonus_until.replace("Z", "+00:00"))
                if until.tzinfo is None:
                    until = until.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) < until and random.random() < 0.5:
                    go_to_jail = False
            except Exception:
                pass
        if go_to_jail:
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$set": {"jail_bust_attempts": next_attempts, "in_jail": True, "jail_until": jail_until.isoformat(), "current_consecutive_busts": 0, "snitch_attempted_this_term": False}},
            )
        else:
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$set": {"jail_bust_attempts": next_attempts, "current_consecutive_busts": 0}},
            )
        await _record_bust_event(current_user["id"], False, 0, target_username=target_username, is_npc=True)
        return {"success": False, "message": random.choice(JAIL_BUST_FAIL_MESSAGES), "jail_time": 30 if go_to_jail else 0}

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
        xp_double_until = current_user.get("xp_double_until")
        if xp_double_until:
            try:
                until = datetime.fromisoformat(xp_double_until.replace("Z", "+00:00"))
                if until.tzinfo is None:
                    until = until.replace(tzinfo=timezone.utc)
                if now_utc < until:
                    rank_points = rank_points * 2
            except Exception:
                pass
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {"in_jail": False, "jail_until": None, "unbreakable_until": None, "snitch_attempted_this_term": False}, "$unset": {"auto_rank_next_run_at": ""}},
        )
        reward_cash = _safe_int(target.get("bust_reward_cash"), 0)
        target_money = _safe_int(target.get("money"), 0)
        base_pay = min(reward_cash, target_money) if reward_cash > 0 else 0
        cash_to_pay = base_pay
        jail_bust_perk_until = current_user.get("jail_bust_payout_perk_until")
        if jail_bust_perk_until and base_pay > 0:
            try:
                until = datetime.fromisoformat(jail_bust_perk_until.replace("Z", "+00:00"))
                if until.tzinfo is None:
                    until = until.replace(tzinfo=timezone.utc)
                if now_utc < until:
                    cash_to_pay = int(base_pay * 1.1)
            except Exception:
                pass
        if base_pay > 0:
            await db.users.update_one({"id": target["id"]}, {"$inc": {"money": -base_pay}})
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": cash_to_pay}})
        new_consec = _safe_int(current_user.get("current_consecutive_busts"), 0) + 1
        record = max(_safe_int(current_user.get("consecutive_busts_record"), 0), new_consec)
        rp_before = _safe_int(current_user.get("rank_points"), 0)
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
        await _record_bust_event(current_user["id"], True, cash_to_pay, target_username=target.get("username") or "", is_npc=False)
        new_total = total_successes + 1
        claimed = current_user.get("respect_points_bust_milestones_claimed") or []
        new_claimed = [m for m in BUST_MILESTONES if m <= new_total and m not in claimed]
        respect_earned = sum(BUST_MILESTONE_REWARDS.get(m, 0) for m in new_claimed)
        await _award_bust_milestones(current_user["id"], new_total, claimed)
        display_name = target.get("username") or target_username or "Unknown"
        msg = random.choice(JAIL_BUST_SUCCESS_MESSAGES).format(target_username=display_name)
        return {"success": True, "message": msg, "rank_points_earned": rank_points, "cash_reward": cash_to_pay, "respect_points": respect_earned}
    jail_until = datetime.now(timezone.utc) + timedelta(seconds=30)
    next_attempts = total_attempts + 1
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"jail_bust_attempts": next_attempts, "in_jail": True, "jail_until": jail_until.isoformat(), "current_consecutive_busts": 0, "snitch_attempted_this_term": False}},
    )
    await _record_bust_event(current_user["id"], False, 0, target_username=target.get("username") or "", is_npc=False)
    return {"success": False, "message": random.choice(JAIL_BUST_FAIL_MESSAGES), "jail_time": 30}


async def bust_out_of_jail(
    request: BustOutRequest, current_user: dict = Depends(get_current_user_verified)
):
    try:
        result = await _attempt_bust_impl(current_user, request.target_username or "")
    except Exception as e:
        logger.exception("Jail bust failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to process bust. Please try again.")
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
        return int(arr[0].get("profit", 0)) if arr else 0
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
    jail_until_iso = current_user.get("jail_until")
    if not jail_until_iso:
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"in_jail": False, "jail_until": None, "snitch_attempted_this_term": False}, "$unset": {"auto_rank_next_run_at": ""}},
        )
        return {"in_jail": False, **base}
    try:
        jail_until = datetime.fromisoformat(str(jail_until_iso).strip().replace("Z", "+00:00"))
        if jail_until.tzinfo is None:
            jail_until = jail_until.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"in_jail": False, "jail_until": None, "snitch_attempted_this_term": False}, "$unset": {"auto_rank_next_run_at": ""}},
        )
        return {"in_jail": False, **base}
    now = datetime.now(timezone.utc)
    if jail_until <= now:
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"in_jail": False, "jail_until": None, "snitch_attempted_this_term": False}, "$unset": {"auto_rank_next_run_at": ""}},
        )
        return {"in_jail": False, **base}
    seconds_remaining = int((jail_until - now).total_seconds())
    return {
        "in_jail": True,
        "jail_until": current_user["jail_until"],
        "seconds_remaining": seconds_remaining,
        **base,
    }


async def set_bust_reward(request: JailSetBustRewardRequest, current_user: dict = Depends(get_current_user_verified)):
    """Set the $ reward offered to whoever busts you out. 0 to clear."""
    amount = max(0, int(request.amount))
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"bust_reward_cash": amount}},
    )
    return {"message": f"Bust reward set to ${amount:,}" if amount else "Bust reward cleared.", "bust_reward_cash": amount}


async def leave_jail(current_user: dict = Depends(get_current_user_verified)):
    """Pay 3 points to leave jail immediately."""
    if not current_user.get("in_jail"):
        raise HTTPException(status_code=400, detail="You are not in jail")
    current_pts = int(current_user.get("points", 0) or 0)
    if current_pts < 3:
        raise HTTPException(status_code=400, detail="You need at least 3 points to leave jail")
    await db.users.update_one(
        {"id": current_user["id"]},
        {
            "$set": {"in_jail": False, "jail_until": None, "snitch_attempted_this_term": False},
            "$inc": {"points": -3},
            "$unset": {"auto_rank_next_run_at": ""},
        },
    )
    return {
        "success": True,
        "message": "You paid 3 points and left jail!",
        "points_spent": 3,
    }


# Snitch: when in jail, name someone (or pick random online). 10–20% success chance. On success you're released and they serve time; they can't be snitched on again for 5 mins.
SNITCH_JAIL_SECONDS = 45
SNITCH_SUCCESS_CHANCE_MIN = 0.10
SNITCH_SUCCESS_CHANCE_MAX = 0.20
SNITCH_IMMUNITY_MINUTES = 5


def _snitch_success_roll() -> bool:
    """Return True with a random chance between 10% and 20%."""
    chance = random.uniform(SNITCH_SUCCESS_CHANCE_MIN, SNITCH_SUCCESS_CHANCE_MAX)
    return random.random() < chance


async def _get_random_online_user(exclude_user_id: str):
    """Return one random user who is online, not in jail, not dead, not self, and not in snitch immunity (snitched on in last 5 mins)."""
    now = datetime.now(timezone.utc)
    five_min_ago = now - timedelta(minutes=5)
    cursor = db.users.find(
        {
            "id": {"$ne": exclude_user_id},
            "in_jail": {"$ne": True},
            "is_dead": {"$ne": True},
            "is_bodyguard": {"$ne": True},
            "is_npc": {"$ne": True},
            "anti_snitch": {"$ne": True},
            "$and": [
                {
                    "$or": [
                        {"snitched_on_until": {"$exists": False}},
                        {"snitched_on_until": None},
                        {"snitched_on_until": {"$lte": now.isoformat()}},
                    ]
                },
                {
                    "$or": [
                        {"last_seen": {"$gte": five_min_ago.isoformat()}},
                        {"forced_online_until": {"$gt": now.isoformat()}},
                        {"auto_rank_enabled": True},
                    ]
                },
            ],
        },
        {"_id": 0, "id": 1, "username": 1},
    )
    users = await cursor.to_list(100)
    if not users:
        return None
    return random.choice(users)


async def snitch(
    request: SnitchRequest,
    current_user: dict = Depends(get_current_user),
):
    """When in jail: snitch on a user (by username) or pick random online. On success you're released and they serve time. They get a notification that they were snitched on (not by whom). One attempt per jail term."""
    if not current_user.get("in_jail"):
        raise HTTPException(status_code=400, detail="You are not in jail")
    if current_user.get("snitch_attempted_this_term"):
        raise HTTPException(status_code=400, detail="You can only attempt to snitch once per jail term.")

    target_username = (request.target_username or "").strip()
    target = None

    if not target_username or target_username.lower() == "random":
        target = await _get_random_online_user(current_user["id"])
        if not target:
            raise HTTPException(
                status_code=400,
                detail="No online users available to snitch on. Enter a username or try again later.",
            )
    else:
        username_ci = re.compile("^" + re.escape(target_username) + "$", re.IGNORECASE)
        target = await db.users.find_one(
            {"username": username_ci},
            {"_id": 0, "id": 1, "username": 1, "in_jail": 1, "is_dead": 1, "is_bodyguard": 1, "snitched_on_until": 1, "anti_snitch": 1},
        )
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target["id"] == current_user["id"]:
            raise HTTPException(status_code=400, detail="You can't snitch on yourself")
        if target.get("anti_snitch"):
            raise HTTPException(status_code=400, detail="That user has Anti Snitch and cannot be snitched on.")
        if target.get("in_jail"):
            raise HTTPException(status_code=400, detail="That user is already in jail")
        if target.get("is_dead"):
            raise HTTPException(status_code=400, detail="That account is dead")
        if target.get("is_bodyguard"):
            raise HTTPException(status_code=400, detail="You can't snitch on that user")
        until_iso = target.get("snitched_on_until")
        if until_iso:
            try:
                until = datetime.fromisoformat(until_iso.replace("Z", "+00:00"))
                if until.tzinfo is None:
                    until = until.replace(tzinfo=timezone.utc)
                if until > datetime.now(timezone.utc):
                    raise HTTPException(
                        status_code=400,
                        detail="That user was recently snitched on and can't be snitched on again for 5 minutes.",
                    )
            except (ValueError, TypeError):
                pass

    # Mark attempt as used (one per jail term) before the roll
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"snitch_attempted_this_term": True}},
    )

    if not _snitch_success_roll():
        return {
            "success": False,
            "message": "The guards didn't buy it. You're still in jail.",
            "released": False,
        }

    now = datetime.now(timezone.utc)
    jail_until = now + timedelta(seconds=SNITCH_JAIL_SECONDS)
    snitch_immunity_until = now + timedelta(minutes=SNITCH_IMMUNITY_MINUTES)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"snitch_count": 1}, "$set": {"in_jail": False, "jail_until": None, "snitch_attempted_this_term": False}},
    )
    await db.users.update_one(
        {"id": target["id"]},
        {"$set": {"in_jail": True, "jail_until": jail_until.isoformat(), "snitched_on_until": snitch_immunity_until.isoformat(), "snitch_attempted_this_term": False}},
    )
    await send_notification(
        target["id"],
        "Snitched on",
        "Someone snitched on you to the guards. You've been sent to jail. They didn't tell you who.",
        "system",
        category="jail",
    )
    return {
        "success": True,
        "message": f"You snitched on {target['username']}. You're free; they're serving {SNITCH_JAIL_SECONDS} seconds.",
        "released": True,
        "target_username": target["username"],
        "target_jail_seconds": SNITCH_JAIL_SECONDS,
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
        "Razor Eddie", "Sticky Fingers Sal", "Cigar Box Tommy", "Mugsy Malone", "Black Hand Bruno",
    ]
    while True:
        try:
            await asyncio.sleep(random.randint(60, 120))
            current_npcs = await db.jail_npcs.count_documents({})
            if current_npcs < 10:
                npc_name = random.choice(npc_names)
                rank_names = [r["name"] for r in RANKS]
                weights = [30, 25, 20, 15, 10, 7, 5, 3, 2, 1, 1, 1, 1]
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
    router.add_api_route("/jail/snitch", snitch, methods=["POST"])
    router.add_api_route("/admin/npcs", get_admin_npcs, methods=["GET"])
    router.add_api_route("/admin/npcs/toggle", toggle_npcs, methods=["POST"])
    router.add_api_route("/npcs/list", list_npcs_for_attack, methods=["GET"])
