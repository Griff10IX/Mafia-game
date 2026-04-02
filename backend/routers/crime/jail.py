# Jail endpoints: list players (incl. jail NPCs), bust out, status; NPC admin & list; jail NPC spawner
import asyncio
import logging
import re
import secrets
_rng = secrets.SystemRandom()
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
    log_activity,
    log_respect_earned,
    maybe_process_rank_up,
    send_notification,
    ADMIN_EMAILS,
    RANKS,
    STATES,
)
from routers.account.objectives import update_objectives_progress
from utils.point_provenance import log_points_event

logger = logging.getLogger(__name__)


def _safe_int(val, default: int = 0) -> int:
    """Coerce to int; return default on ValueError/TypeError (e.g. bad DB values)."""
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


MOD_DEFAULT_ONLINE_COLOR = "#1e3a5f"
HDO_ONLINE_COLOR = "#166534"


async def _get_mod_default_online_color_jail():
    doc = await db.game_settings.find_one({"key": "mod_default_online_color"}, {"_id": 0, "value": 1})
    raw = (doc.get("value") or MOD_DEFAULT_ONLINE_COLOR) if doc else MOD_DEFAULT_ONLINE_COLOR
    if not isinstance(raw, str) or not raw.strip():
        return MOD_DEFAULT_ONLINE_COLOR
    raw = raw.strip()
    return raw if raw.startswith("#") and len(raw) <= 9 else MOD_DEFAULT_ONLINE_COLOR


def _jail_row_online_styling(
    user: dict,
    admin_online_color: str,
    mod_default_online_color: str,
) -> Optional[dict]:
    """Username colours for jail list: same sources as /users/online (admin global, mod custom or default). Ghost staff omitted."""
    is_admin = user.get("email") in ADMIN_EMAILS
    is_mod = bool(user.get("is_moderator"))
    is_hdo = bool(user.get("is_help_desk_operator"))
    if (is_admin or is_mod) and user.get("admin_ghost_mode"):
        return None

    online_color = None
    if is_admin:
        online_color = admin_online_color
    elif is_mod:
        raw = (user.get("mod_online_color") or "").strip()
        if raw and raw.startswith("#") and len(raw) <= 9:
            online_color = raw
        if online_color is None:
            online_color = mod_default_online_color
    elif is_hdo:
        online_color = HDO_ONLINE_COLOR

    return {
        "is_admin": is_admin,
        "is_moderator": is_mod,
        "online_color": online_color,
    }


def _jailbust_bonus_active(user: dict) -> bool:
    raw = user.get("jailbust_bonus_until")
    if not raw:
        return False
    try:
        until = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) < until
    except Exception:
        return False


def _jailbust_failed_bust_avoids_jail(user: dict) -> bool:
    """While jailbust token is active, a failed bust has a 50% chance to avoid the 30s jail penalty."""
    if not _jailbust_bonus_active(user):
        return False
    return _rng.random() < 0.5


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

# Failure messages when bust fails but user avoids the 30s jail penalty (e.g. jailbust token effect).
JAIL_BUST_FAIL_AVOID_JAIL_MESSAGES = [
    "Bust failed — but you slipped away before they could cuff you.",
    "Close call. Bust failed, but you avoided the 30-second jail penalty.",
    "They spotted you, but you got away. No jail time this time.",
    "Bust failed — you managed to escape the guards.",
    "Bad timing. Bust failed, but you stayed out of jail.",
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
    five_min_ago = now - timedelta(minutes=5)
    ten_min_ago = now - timedelta(minutes=10)
    admin_color_doc = await db.game_settings.find_one({"key": "admin_online_color"}, {"_id": 0, "value": 1})
    admin_online_color = (admin_color_doc.get("value") or "#a78bfa") if admin_color_doc else "#a78bfa"
    if not isinstance(admin_online_color, str) or not admin_online_color.strip():
        admin_online_color = "#a78bfa"
    admin_online_color = admin_online_color.strip()
    mod_default_online_color = await _get_mod_default_online_color_jail()

    real_players_raw = await db.users.find(
        {"in_jail": True},
        {
            "_id": 0,
            "username": 1,
            "id": 1,
            "rank_points": 1,
            "prestige_rank_multiplier": 1,
            "jail_until": 1,
            "bust_reward_cash": 1,
            "money": 1,
            "email": 1,
            "is_moderator": 1,
            "is_help_desk_operator": 1,
            "mod_online_color": 1,
            "admin_ghost_mode": 1,
        },
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
            jail_until = datetime.fromisoformat(str(jail_until_iso).replace("Z", "+00:00"))
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
    hitlist_totals = {}
    if real_players:
        user_ids = [p["id"] for p in real_players if p.get("id") is not None]
        if user_ids:
            hitlist_entries = await db.hitlist.find(
                {"target_id": {"$in": user_ids}, "target_type": {"$in": ["user", "bodyguards"]}},
                {"_id": 0, "target_id": 1, "reward_type": 1, "reward_amount": 1},
            ).to_list(1000)
            for e in hitlist_entries:
                tid = e.get("target_id")
                if tid is None:
                    continue
                tkey = str(tid)
                if tkey not in hitlist_totals:
                    hitlist_totals[tkey] = [0, 0]
                if e.get("reward_type") == "cash":
                    hitlist_totals[tkey][0] += int(e.get("reward_amount") or 0)
                elif e.get("reward_type") == "points":
                    hitlist_totals[tkey][1] += int(e.get("reward_amount") or 0)

    players_data = []
    for player in real_players:
        _rp = int(player.get("rank_points") or 0)
        _prestige_mult = float(player.get("prestige_rank_multiplier") or 1.0)
        _rank_id, rank_name = get_rank_info(_rp, _prestige_mult)
        is_admin = player.get("email") in ADMIN_EMAILS
        is_mod = bool(player.get("is_moderator"))
        is_hdo = bool(player.get("is_help_desk_operator"))
        if is_admin:
            rank_name = "Admin"
        elif is_mod:
            rank_name = "Moderator"
        elif is_hdo:
            rank_name = f"(HDO) {rank_name}"
        stored = _safe_int(player.get("bust_reward_cash"), 0)
        on_hand = _safe_int(player.get("money"), 0)
        reward_cash = min(stored, on_hand) if stored > 0 else 0
        username = (player.get("username") or "").strip() or "?"
        styling = _jail_row_online_styling(player, admin_online_color, mod_default_online_color)
        if styling is None:
            continue
        players_data.append(
            {
                "username": username,
                "rank_name": rank_name,
                "is_self": player["id"] == current_user["id"],
                "rp_reward": 15,
                "bust_reward_cash": reward_cash,
                **styling,
            }
        )
    for npc in npcs:
        bust_reward_cash = int((npc.get("bust_reward_cash") or 0) or 0)
        players_data.append(
            {
                "username": npc["username"],
                "rank_name": npc.get("rank_name", "Goon"),
                "rp_reward": 25,
                "bust_reward_cash": bust_reward_cash,
            }
        )
    players_data.sort(key=lambda x: int(x.get("bust_reward_cash") or 0), reverse=True)
    return {
        "players": players_data,
        "admin_online_color": admin_online_color,
        "mod_default_online_color": mod_default_online_color,
    }


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
        from routers.game.achievements import log_badge_events
        await log_badge_events(user_id, "jail_busts", new_claimed)
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
    # Badge bonus: 0.1% per jail busts badge; prestige: 0.5% boost per level
    try:
        from routers.game.achievements import get_badge_bonuses
        bb = await get_badge_bonuses(current_user.get("id") or "")
        player_success_rate = min(0.95, player_success_rate + bb.get("jail_busts", 0) * 0.001 * bb.get("prestige_badge_mult", 1))
    except Exception:
        pass
    if _jailbust_bonus_active(current_user):
        player_success_rate = min(0.95, player_success_rate + 0.10)

    npc = await db.jail_npcs.find_one({"username": username_ci}, {"_id": 0})
    if npc:
        success = _rng.random() < player_success_rate
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
            npc_username = npc.get("username")
            claimed_npc = None
            if npc_username is not None:
                claimed_npc = await db.jail_npcs.find_one_and_delete({"username": npc_username})
            if not claimed_npc:
                return {"success": False, "message": "That inmate was already busted out.", "jail_time": 0}
            _invalidate_jail_npcs_cache()
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
            msg = _rng.choice(JAIL_BUST_SUCCESS_MESSAGES).format(target_username=target_username)
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
                if datetime.now(timezone.utc) < until and _rng.random() < 0.5:
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
        msg = _rng.choice(JAIL_BUST_FAIL_MESSAGES if go_to_jail else JAIL_BUST_FAIL_AVOID_JAIL_MESSAGES)
        return {"success": False, "message": msg, "jail_time": 30 if go_to_jail else 0}

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

    success = _rng.random() < player_success_rate
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
        released = await db.users.find_one_and_update(
            {"id": target["id"], "in_jail": True},
            {"$set": {"in_jail": False, "jail_until": None, "unbreakable_until": None, "snitch_attempted_this_term": False}, "$unset": {"auto_rank_next_run_at": ""}},
        )
        if not released:
            return {"success": False, "error": "Target is no longer in jail", "error_code": 400}
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
            pay_result = await db.users.update_one(
                {"id": target["id"], "money": {"$gte": base_pay}},
                {"$inc": {"money": -base_pay}},
            )
            if pay_result.modified_count == 0:
                base_pay = 0
                cash_to_pay = 0
            else:
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
        msg = _rng.choice(JAIL_BUST_SUCCESS_MESSAGES).format(target_username=display_name)
        return {"success": True, "message": msg, "rank_points_earned": rank_points, "cash_reward": cash_to_pay, "respect_points": respect_earned}
    jail_until = datetime.now(timezone.utc) + timedelta(seconds=30)
    next_attempts = total_attempts + 1
    go_to_jail = not _jailbust_failed_bust_avoids_jail(current_user)
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
    await _record_bust_event(current_user["id"], False, 0, target_username=target.get("username") or "", is_npc=False)
    msg = _rng.choice(JAIL_BUST_FAIL_MESSAGES if go_to_jail else JAIL_BUST_FAIL_AVOID_JAIL_MESSAGES)
    return {"success": False, "message": msg, "jail_time": 30 if go_to_jail else 0}


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
    await log_activity(current_user["id"], current_user.get("username", "?"), "jail_bust", {
        "target": request.target_username, "success": result.get("success", False),
        "cash_reward": result.get("cash_reward", 0), "rp": result.get("rank_points_earned", 0),
    })
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
    stored_reward = _safe_int(current_user.get("bust_reward_cash"), 0)
    on_hand = _safe_int(current_user.get("money"), 0)
    bust_reward_cash = min(stored_reward, on_hand) if stored_reward > 0 else 0
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
    """Set the $ reward offered to whoever busts you out. 0 to clear. Cannot exceed cash on hand (same pool debited on bust). Not while in jail."""
    if current_user.get("in_jail"):
        raise HTTPException(status_code=400, detail="You cannot change your bust reward while in jail.")
    amount = max(0, int(request.amount))
    fresh = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    balance = _safe_int((fresh or {}).get("money"), 0)
    if amount > balance:
        raise HTTPException(
            status_code=400,
            detail=f"Bust reward cannot exceed your cash on hand (${balance:,}). You offered ${amount:,}.",
        )
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"bust_reward_cash": amount}},
    )
    return {"message": f"Bust reward set to ${amount:,}" if amount else "Bust reward cleared.", "bust_reward_cash": amount}


async def leave_jail(current_user: dict = Depends(get_current_user_verified)):
    """Pay 3 points to leave jail immediately."""
    if not current_user.get("in_jail"):
        raise HTTPException(status_code=400, detail="You are not in jail")
    result = await db.users.update_one(
        {"id": current_user["id"], "in_jail": True, "points": {"$gte": 3}},
        {
            "$set": {"in_jail": False, "jail_until": None, "snitch_attempted_this_term": False},
            "$inc": {"points": -3},
            "$unset": {"auto_rank_next_run_at": ""},
        },
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="You need at least 3 points to leave jail")
    await log_points_event(db, user_id=current_user["id"], points=-3, event_type="jail_leave", event_ref=current_user["id"], meta={"points_spent": 3})
    await log_activity(current_user["id"], current_user.get("username", "?"), "jail_leave", {"points_spent": 3})
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
    chance = _rng.uniform(SNITCH_SUCCESS_CHANCE_MIN, SNITCH_SUCCESS_CHANCE_MAX)
    return _rng.random() < chance


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
    return _rng.choice(users)


async def snitch(
    request: SnitchRequest,
    current_user: dict = Depends(get_current_user),
):
    """When in jail: snitch on a user (by username) or pick random online. On success you're released and they serve time. They get a notification that they were snitched on (not by whom). One attempt per jail term."""
    if not current_user.get("in_jail"):
        raise HTTPException(status_code=400, detail="You are not in jail")

    claimed = await db.users.find_one_and_update(
        {
            "id": current_user["id"],
            "in_jail": True,
            "$or": [
                {"snitch_attempted_this_term": {"$ne": True}},
                {"snitch_attempted_this_term": {"$exists": False}},
            ],
        },
        {"$set": {"snitch_attempted_this_term": True}},
    )
    if not claimed:
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
    await log_activity(current_user["id"], current_user.get("username", "?"), "jail_snitch", {
        "target": target["username"], "jail_seconds": SNITCH_JAIL_SECONDS,
    })
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
    raise HTTPException(status_code=410, detail="Deprecated: NPC seeding tools have been removed")


async def toggle_npcs(request: NPCToggleRequest, current_user: dict = Depends(get_current_user)):
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    raise HTTPException(status_code=410, detail="Deprecated: NPC seeding tools have been removed")


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
            await asyncio.sleep(_rng.randint(60, 120))
            current_npcs = await db.jail_npcs.count_documents({})
            if current_npcs < 10:
                npc_name = _rng.choice(npc_names)
                rank_names = [r["name"] for r in RANKS]
                weights = [30, 25, 20, 15, 10, 7, 5, 3, 2, 1, 1, 1, 1]
                existing = await db.jail_npcs.find_one({"username": npc_name})
                if not existing:
                    rank_name = _rng.choices(rank_names, weights=weights, k=1)[0]
                    # Cash reward scales with rank (low for beta - few hundred max)
                    rank_index = rank_names.index(rank_name) if rank_name in rank_names else 0
                    cash_min = 50 + rank_index * 30
                    cash_max = 150 + rank_index * 50
                    bust_reward_cash = _rng.randint(cash_min, cash_max)
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
