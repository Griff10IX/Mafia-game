# Attack endpoints: search, status, list, delete, travel, bullets/calc, inflation, execute, attempts
from typing import List, Optional, Dict
from datetime import datetime, timezone, timedelta
import math
import random
import uuid
import os
import sys
import logging
from fastapi import Depends, HTTPException
from pydantic import BaseModel, field_validator

logger = logging.getLogger(__name__)

_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend not in sys.path:
    sys.path.insert(0, _backend)
from server import (
    db,
    get_current_user,
    RANKS,
    STATES,
    CARS,
    ARMOUR_BASE_BULLETS,
    MIN_BULLETS_TO_KILL,
    DEFAULT_HEALTH,
    KILL_CASH_PERCENT,
    ADMIN_EMAILS,
    CAPO_RANK_ID,
    get_rank_info,
    get_effective_event,
    send_notification,
    send_notification_to_family,
    maybe_process_rank_up,
    _find_user_by_username_case_insensitive,
    _apply_kill_inflation_decay,
    _increase_kill_inflation_on_kill,
    _get_active_war_between,
    _get_active_war_for_family,
    _record_war_stats_player_kill,
    _family_war_start,
    _family_war_check_wipe_and_award,
    _user_owns_any_casino,
    _user_owns_any_property,
)
from routers.booze_run import BOOZE_TYPES
from routers.objectives import update_objectives_progress
from routers.armoury import _best_weapon_for_user
from routers.families import resolve_family_id


# ---------------------------------------------------------------------------
# Vendetta bodyguard-kill recording (inline — avoids cross-module ID mismatches)
# ---------------------------------------------------------------------------
async def _record_vendetta_bg_kill(
    killer_id: str, killer_fid: str, owner_id: str, owner_doc: dict,
    bg_username: str = None, bullets_used: int = 0, bg_hire_cost: int = 0,
):
    """
    Record a bodyguard kill into family_war_stats when the two players are in an active war.
    killer_fid   : killer's family_id (from current_user, already in hand)
    owner_doc    : the bodyguard owner's users doc (contains family_id)
    bg_username  : the bodyguard NPC/player's own username
    bullets_used : bullets fired in this attack
    bg_hire_cost : points paid when the BG was hired (stored in bodyguard doc)
    """
    try:
        # Resolve killer family — use the hint, fall back to fresh DB look-up
        k_fid = killer_fid
        if not k_fid:
            k_fid = await resolve_family_id(killer_id)

        # Resolve owner family — doc first, then DB look-up, then families.boss_id
        o_fid = (owner_doc or {}).get("family_id")
        if not o_fid:
            ou = await db.users.find_one({"id": owner_id}, {"_id": 0, "family_id": 1})
            o_fid = (ou or {}).get("family_id")
        if not o_fid:
            om = await db.family_members.find_one({"user_id": owner_id}, {"_id": 0, "family_id": 1})
            o_fid = (om or {}).get("family_id")
        if not o_fid:
            of_ = await db.families.find_one({"boss_id": owner_id}, {"_id": 0, "id": 1})
            o_fid = (of_ or {}).get("id")

        if not k_fid or not o_fid:
            logger.info("Vendetta BG kill skipped: k_fid=%s o_fid=%s", k_fid, o_fid)
            return
        if k_fid == o_fid:
            logger.info("Vendetta BG kill skipped: same family %s", k_fid)
            return

        # Find war directly between these two families (both orderings)
        war = await db.family_wars.find_one(
            {
                "$or": [
                    {"family_a_id": k_fid, "family_b_id": o_fid},
                    {"family_a_id": o_fid, "family_b_id": k_fid},
                ],
                "status": {"$in": ["active", "truce_offered"]},
            },
            {"_id": 0, "id": 1},
        )
        if not war:
            logger.info("Vendetta BG kill skipped: no war between %s and %s", k_fid, o_fid)
            return

        war_id = war["id"]
        # $set always writes family_id so it is correct even if the doc already existed
        await db.family_war_stats.update_one(
            {"war_id": war_id, "user_id": killer_id},
            {
                "$inc": {"bodyguard_kills": 1},
                "$set": {"family_id": k_fid},
                "$setOnInsert": {"war_id": war_id, "user_id": killer_id, "kills": 0, "deaths": 0, "bodyguards_lost": 0},
            },
            upsert=True,
        )
        await db.family_war_stats.update_one(
            {"war_id": war_id, "user_id": owner_id},
            {
                "$inc": {"bodyguards_lost": 1},
                "$set": {"family_id": o_fid},
                "$setOnInsert": {"war_id": war_id, "user_id": owner_id, "kills": 0, "deaths": 0, "bodyguard_kills": 0},
            },
            upsert=True,
        )
        logger.info("Vendetta BG kill recorded: war=%s killer=%s(%s) owner=%s(%s)", war_id, killer_id, k_fid, owner_id, o_fid)
        # Write to the war kill feed so the War Info tab can display individual events
        try:
            ku = await db.users.find_one({"id": killer_id}, {"_id": 0, "username": 1})
            await db.war_kill_feed.insert_one({
                "id": str(uuid.uuid4()),
                "war_id": war_id,
                "kill_type": "bodyguard",
                "killer_id": killer_id,
                "killer_username": (ku or {}).get("username", "?"),
                "killer_family_id": k_fid,
                "victim_id": owner_id,
                "victim_family_id": o_fid,
                "bg_username": bg_username,            # the bodyguard NPC's own name
                "bg_owner_username": (owner_doc or {}).get("username"),  # who hired/owns the BG
                "bullets_used": int(bullets_used or 0),
                "bg_hire_cost": int(bg_hire_cost or 0),
                "cash_taken": 0,
                "props_taken": 0,
                "cars_taken": 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception as feed_exc:
            logger.exception("War kill feed (BG): %s", feed_exc)
    except Exception as exc:
        logger.exception("Vendetta BG kill error: %s", exc)


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class AttackSearchRequest(BaseModel):
    target_username: str
    note: Optional[str] = None

class AttackSearchResponse(BaseModel):
    attack_id: str
    status: str
    message: str
    estimated_completion: str

class AttackStatusResponse(BaseModel):
    attack_id: str
    status: str
    target_username: str
    location_state: Optional[str]
    can_travel: bool
    can_attack: bool
    message: str

class AttackIdRequest(BaseModel):
    attack_id: str

class AttackDeleteRequest(BaseModel):
    attack_ids: List[str]

class AttackExecuteRequest(BaseModel):
    attack_id: str
    death_message: Optional[str] = None
    make_public: bool = False
    bullets_to_use: Optional[int] = None

    @field_validator("bullets_to_use", mode="before")
    @classmethod
    def coerce_bullets_to_use(cls, v):
        if v is None or v == "":
            return None
        if isinstance(v, (int, float)):
            return int(v) if v > 0 else None
        if isinstance(v, str):
            try:
                n = int(v)
                return n if n > 0 else None
            except (ValueError, TypeError):
                return None
        return None

class AttackExecuteResponse(BaseModel):
    success: bool
    message: str
    rewards: Optional[Dict]
    first_bodyguard: Optional[Dict] = None

class BulletCalcRequest(BaseModel):
    target_username: str

# ---------------------------------------------------------------------------
# Pure helpers (no db)
# ---------------------------------------------------------------------------

def _bullets_to_kill(
    target_armour_level: int,
    target_rank_id: int,
    attacker_weapon_damage: int,
    attacker_rank_id: int,
) -> int:
    arm = min(max(0, int(target_armour_level or 0)), 5)
    tr = min(max(1, int(target_rank_id or 1)), 11)
    ar = min(max(1, int(attacker_rank_id or 1)), 11)
    dmg = max(5, int(attacker_weapon_damage or 5))
    base = ARMOUR_BASE_BULLETS.get(arm, MIN_BULLETS_TO_KILL)
    gap = max(0, tr - ar)
    rank_factor = 1.0 + (tr - 1) * 0.20
    gap_factor = 1.0 + gap * 0.60
    weapon_factor = 1.0 + (dmg / 140.0)
    attacker_factor = 1.0 + (ar - 1) * 0.05
    needed_raw = (base * rank_factor * gap_factor) / weapon_factor / attacker_factor
    return max(1, int(math.ceil(needed_raw)))

def _bullets_to_kill_breakdown(
    target_armour_level: int,
    target_rank_id: int,
    attacker_weapon_damage: int,
    attacker_rank_id: int,
) -> dict:
    arm = min(max(0, int(target_armour_level or 0)), 5)
    tr = min(max(1, int(target_rank_id or 1)), 11)
    ar = min(max(1, int(attacker_rank_id or 1)), 11)
    dmg = max(5, int(attacker_weapon_damage or 5))
    base = ARMOUR_BASE_BULLETS.get(arm, MIN_BULLETS_TO_KILL)
    gap = max(0, tr - ar)
    rank_factor = 1.0 + (tr - 1) * 0.20
    gap_factor = 1.0 + gap * 0.60
    weapon_factor = 1.0 + (dmg / 140.0)
    attacker_factor = 1.0 + (ar - 1) * 0.05
    needed_raw = (base * rank_factor * gap_factor) / weapon_factor / attacker_factor
    needed_before_clamp = int(math.ceil(needed_raw))
    bullets_required = max(1, needed_before_clamp)
    return {
        "base_from_armour": base,
        "rank_factor": round(rank_factor, 3),
        "gap_factor": round(gap_factor, 3),
        "weapon_factor": round(weapon_factor, 3),
        "attacker_factor": round(attacker_factor, 3),
        "rank_gap": gap,
        "needed_raw": needed_raw,
        "needed_before_clamp": needed_before_clamp,
        "bullets_required": bullets_required,
    }

# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------

async def search_target(request: AttackSearchRequest, current_user: dict = Depends(get_current_user)):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    await db.attacks.delete_many({"attacker_id": current_user["id"], "search_started": {"$lte": cutoff.isoformat()}})
    user_filter = _find_user_by_username_case_insensitive(request.target_username)
    if not user_filter:
        raise HTTPException(status_code=400, detail="Target username required")
    target = await db.users.find_one(user_filter, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    if target.get("email") in ADMIN_EMAILS:
        raise HTTPException(status_code=404, detail="Target user not found")
    if target.get("is_dead"):
        raise HTTPException(status_code=400, detail="That account is dead and cannot be attacked")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot attack yourself")
    if target.get("is_npc") and not target.get("is_bodyguard"):
        hitlist_npc = await db.hitlist.find_one(
            {"target_id": target["id"], "target_type": "npc", "placer_id": current_user["id"]},
            {"_id": 1}
        )
        if not hitlist_npc:
            raise HTTPException(status_code=400, detail="You can only attack NPCs you added to your hitlist")
    now = datetime.now(timezone.utc)
    override_minutes = current_user.get("search_minutes_override")
    if override_minutes is not None:
        try:
            override_minutes = int(override_minutes)
        except Exception:
            override_minutes = None
    if override_minutes is None or override_minutes <= 0:
        config = await db.game_config.find_one({"id": "main"}, {"_id": 0, "default_search_minutes": 1})
        default_mins = config and config.get("default_search_minutes")
        if default_mins is not None:
            try:
                override_minutes = int(default_mins)
            except Exception:
                override_minutes = None
    search_duration = int(override_minutes) if override_minutes and override_minutes > 0 else random.randint(120, 180)
    found_at = now + timedelta(minutes=search_duration)
    expires_at = now + timedelta(hours=24)
    attack_id = str(uuid.uuid4())
    note = (request.note or "").strip()
    note = note[:80] if note else None
    target_state = target.get("current_state") if target.get("current_state") in STATES else random.choice(STATES)
    await db.attacks.insert_one({
        "id": attack_id,
        "attacker_id": current_user["id"],
        "attacker_username": current_user["username"],
        "target_id": target["id"],
        "target_username": target["username"],
        "note": note,
        "status": "searching",
        "search_started": now.isoformat(),
        "found_at": found_at.isoformat(),
        "expires_at": expires_at.isoformat(),
        "planned_location_state": target_state,
        "location_state": None,
        "result": None,
        "rewards": None
    })
    return AttackSearchResponse(
        attack_id=attack_id,
        status="searching",
        message=f"Searching for {request.target_username}...",
        estimated_completion=found_at.isoformat()
    )

async def get_attack_status(current_user: dict = Depends(get_current_user)):
    attack = await db.attacks.find_one(
        {"attacker_id": current_user["id"], "status": {"$in": ["searching", "found", "traveling"]}},
        {"_id": 0}
    )
    if not attack:
        raise HTTPException(status_code=404, detail="No active attack")
    # If target is dead or is a bodyguard who was killed (e.g. by someone else), remove this search and return 404
    if attack.get("target_id"):
        target_user = await db.users.find_one({"id": attack["target_id"]}, {"_id": 0, "is_dead": 1, "is_bodyguard": 1})
        if target_user:
            if target_user.get("is_dead"):
                await db.attacks.delete_one({"id": attack["id"], "attacker_id": current_user["id"]})
                raise HTTPException(status_code=404, detail="No active attack")
            if target_user.get("is_bodyguard"):
                still_bg = await db.bodyguards.find_one({"bodyguard_user_id": attack["target_id"]}, {"_id": 1})
                if not still_bg:
                    await db.attacks.delete_one({"id": attack["id"], "attacker_id": current_user["id"]})
                    raise HTTPException(status_code=404, detail="No active attack")
    now = datetime.now(timezone.utc)
    found_time = datetime.fromisoformat(attack["found_at"])
    if attack["status"] == "searching" and now >= found_time:
        target_user = await db.users.find_one({"id": attack["target_id"]}, {"_id": 0, "current_state": 1})
        new_location = (target_user.get("current_state") if target_user and target_user.get("current_state") in STATES else None) or attack.get("planned_location_state") or random.choice(STATES)
        await db.attacks.update_one(
            {"id": attack["id"]},
            {"$set": {"status": "found", "location_state": new_location}}
        )
        attack["status"] = "found"
        attack["location_state"] = new_location
    can_travel = attack["status"] == "found" and attack.get("location_state") and current_user["current_state"] != attack["location_state"]
    can_attack = attack["status"] == "found" and attack.get("location_state") and current_user["current_state"] == attack["location_state"]
    message = ""
    if attack["status"] == "searching":
        message = "Searching..."
    elif attack["status"] == "found":
        message = f"Target found in {attack['location_state']}! You are in the same location. Ready to attack!" if can_attack else f"Target found in {attack['location_state']}! Travel there to attack."
    return AttackStatusResponse(
        attack_id=attack["id"],
        status=attack["status"],
        target_username=attack["target_username"],
        location_state=attack.get("location_state"),
        can_travel=can_travel,
        can_attack=can_attack,
        message=message
    )

async def list_attacks(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=24)
    await db.attacks.delete_many({"attacker_id": current_user["id"], "expires_at": {"$lte": now.isoformat()}})
    attacks = await db.attacks.find(
        {"attacker_id": current_user["id"], "status": {"$in": ["searching", "found"]}},
        {"_id": 0}
    ).sort("search_started", -1).to_list(50)
    items = []
    for attack in attacks:
        # Remove searches for dead targets (players or bodyguards; e.g. someone else killed them)
        if attack.get("target_id"):
            target_user = await db.users.find_one({"id": attack["target_id"]}, {"_id": 0, "is_dead": 1, "is_bodyguard": 1})
            if target_user:
                if target_user.get("is_dead"):
                    await db.attacks.delete_one({"id": attack["id"], "attacker_id": current_user["id"]})
                    continue
                # Bodyguard no longer in bodyguards collection (killed, record deleted)
                if target_user.get("is_bodyguard"):
                    still_bg = await db.bodyguards.find_one({"bodyguard_user_id": attack["target_id"]}, {"_id": 1})
                    if not still_bg:
                        await db.attacks.delete_one({"id": attack["id"], "attacker_id": current_user["id"]})
                        continue
        if not attack.get("expires_at"):
            started_iso = attack.get("search_started") or attack.get("found_at")
            try:
                started = datetime.fromisoformat(started_iso) if started_iso else None
                if started and started.tzinfo is None:
                    started = started.replace(tzinfo=timezone.utc)
            except Exception:
                started = None
            if started and started <= cutoff:
                await db.attacks.delete_one({"id": attack["id"], "attacker_id": current_user["id"]})
                continue
            if started:
                await db.attacks.update_one(
                    {"id": attack["id"], "attacker_id": current_user["id"]},
                    {"$set": {"expires_at": (started + timedelta(hours=24)).isoformat()}}
                )
        if attack["status"] == "searching":
            found_time = datetime.fromisoformat(attack["found_at"])
            if now >= found_time:
                target_user = await db.users.find_one({"id": attack["target_id"]}, {"_id": 0, "current_state": 1})
                new_location = (target_user.get("current_state") if target_user and target_user.get("current_state") in STATES else None) or attack.get("planned_location_state") or random.choice(STATES)
                await db.attacks.update_one({"id": attack["id"]}, {"$set": {"status": "found", "location_state": new_location}})
                attack["status"] = "found"
                attack["location_state"] = new_location
        can_travel = attack["status"] == "found" and attack.get("location_state") and current_user["current_state"] != attack["location_state"]
        can_attack = attack["status"] == "found" and attack.get("location_state") and current_user["current_state"] == attack["location_state"]
        msg = "Searching..." if attack["status"] == "searching" else (
            f"Target found in {attack['location_state']}! You are in the same location. Ready to attack!" if can_attack
            else f"Target found in {attack['location_state']}! Travel there to attack."
        )
        item = {
            "attack_id": attack["id"],
            "status": attack["status"],
            "target_username": attack["target_username"],
            "note": attack.get("note"),
            "location_state": attack.get("location_state") if attack["status"] == "found" else None,
            "search_started": attack.get("search_started"),
            "found_at": attack.get("found_at"),
            "expires_at": attack.get("expires_at"),
            "can_travel": can_travel,
            "can_attack": can_attack,
            "message": msg
        }
        if attack["status"] == "found" and attack.get("target_id"):
            target_bgs = await db.bodyguards.find({"user_id": attack["target_id"]}, {"_id": 0}).to_list(10)
            if target_bgs:
                first_bg = max(target_bgs, key=lambda b: b.get("slot_number", 0))
                search_username = None
                display_name = first_bg.get("robot_name") or "bodyguard"
                if first_bg.get("bodyguard_user_id"):
                    bg_user = await db.users.find_one({"id": first_bg["bodyguard_user_id"]}, {"_id": 0, "username": 1})
                    if bg_user:
                        search_username = bg_user.get("username")
                        if not first_bg.get("robot_name"):
                            display_name = search_username
                slot_n = first_bg.get("slot_number")
                item["first_bodyguard"] = {"display_name": display_name, "search_username": search_username, "slot_number": slot_n}
                item["bodyguard_count"] = len(target_bgs)
        items.append(item)
    return {"attacks": items}

async def delete_attacks(request: AttackDeleteRequest, current_user: dict = Depends(get_current_user)):
    ids = [x for x in (request.attack_ids or []) if isinstance(x, str) and x.strip()]
    ids = list(dict.fromkeys(ids))
    if not ids:
        raise HTTPException(status_code=400, detail="No attack ids provided")
    res = await db.attacks.delete_many({"attacker_id": current_user["id"], "id": {"$in": ids}})
    return {"message": f"Deleted {res.deleted_count} search(es)", "deleted": res.deleted_count}

async def travel_to_target(request: AttackIdRequest, current_user: dict = Depends(get_current_user)):
    attack = await db.attacks.find_one(
        {"attacker_id": current_user["id"], "status": "found", "id": request.attack_id},
        {"_id": 0}
    )
    if not attack:
        raise HTTPException(status_code=404, detail="No target found to travel to")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"current_state": attack["location_state"]}}
    )
    return {"message": f"Traveled to {attack['location_state']}"}

async def calc_bullets(request: BulletCalcRequest, current_user: dict = Depends(get_current_user)):
    user_filter = _find_user_by_username_case_insensitive(request.target_username)
    if not user_filter:
        raise HTTPException(status_code=400, detail="Target username required")
    target = await db.users.find_one(user_filter, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    if target.get("is_dead"):
        raise HTTPException(status_code=400, detail="Target is dead")
    attacker_rank_id, attacker_rank_name = get_rank_info(current_user.get("rank_points", 0))
    target_rank_id, target_rank_name = get_rank_info(target.get("rank_points", 0))
    target_armour = int(target.get("armour_level", 0) or 0)
    inflation = await _apply_kill_inflation_decay(current_user["id"])
    best_damage, best_weapon_name = await _best_weapon_for_user(current_user["id"], current_user.get("equipped_weapon_id"))
    breakdown = _bullets_to_kill_breakdown(target_armour, target_rank_id, best_damage, attacker_rank_id)
    bullets_base = int(breakdown["bullets_required"])
    bullets_required = int(math.ceil(bullets_base * (1.0 + inflation)))
    return {
        "target_username": target["username"],
        "target_rank": target_rank_id,
        "target_rank_name": target_rank_name,
        "target_armour_level": target_armour,
        "attacker_rank": attacker_rank_id,
        "attacker_rank_name": attacker_rank_name,
        "weapon_name": best_weapon_name,
        "weapon_damage": best_damage,
        "bullets_required": bullets_required,
        "bullets_base": bullets_base,
        "inflation": inflation,
        "inflation_pct": int(round(inflation * 100)),
        "needed_before_clamp": breakdown["needed_before_clamp"],
    }

async def get_attack_inflation(current_user: dict = Depends(get_current_user)):
    inflation = await _apply_kill_inflation_decay(current_user["id"])
    return {"inflation": inflation, "inflation_pct": int(round(inflation * 100))}

async def execute_attack(request: AttackExecuteRequest, current_user: dict = Depends(get_current_user)):
    attack = await db.attacks.find_one(
        {"attacker_id": current_user["id"], "status": "found", "id": request.attack_id},
        {"_id": 0}
    )
    if not attack:
        raise HTTPException(status_code=404, detail="No active attack to execute")
    target_location = attack.get("location_state")
    if not target_location:
        raise HTTPException(status_code=400, detail="Target location unknown; cannot attack.")
    # Re-fetch attacker location from DB so we never use stale state (e.g. after instant travel)
    attacker_row = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "current_state": 1})
    attacker_location = (attacker_row or {}).get("current_state") or ""
    if attacker_location != target_location:
        raise HTTPException(status_code=400, detail="You must be in the target's location to attack or bodyguard-check. Travel there first.")
    target = await db.users.find_one({"id": attack["target_id"]}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    if target.get("is_dead"):
        raise HTTPException(status_code=400, detail="Target is already dead")
    target_armour = target.get("armour_level", 0)
    attacker_rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
    target_rank_id, _ = get_rank_info(target.get("rank_points", 0))
    attacker_bullets = current_user.get("bullets", 0)
    best_damage, best_weapon_name = await _best_weapon_for_user(current_user["id"], current_user.get("equipped_weapon_id"))
    inflation = await _apply_kill_inflation_decay(current_user["id"])
    bullets_base = _bullets_to_kill(target_armour, target_rank_id, best_damage, attacker_rank_id)
    bullets_required = int(math.ceil(bullets_base * (1.0 + inflation)))
    if attacker_bullets <= 0:
        raise HTTPException(status_code=400, detail="You need bullets to attack.")
    target_bodyguards = await db.bodyguards.find({"user_id": target["id"]}, {"_id": 0}).to_list(10)
    if target_bodyguards:
        first_bg = max(target_bodyguards, key=lambda b: b.get("slot_number", 0))
        display_name = first_bg.get("robot_name") or "bodyguard"
        search_username = None
        if first_bg.get("bodyguard_user_id"):
            bg_user = await db.users.find_one({"id": first_bg["bodyguard_user_id"]}, {"_id": 0, "username": 1})
            if bg_user:
                search_username = bg_user.get("username")
                if not first_bg.get("robot_name"):
                    display_name = search_username
        slot_n = first_bg.get("slot_number")
        target_name = target["username"]
        slot_msg = f" in slot {slot_n}" if slot_n else ""
        if search_username:
            return AttackExecuteResponse(
                success=False,
                message=f"{target_name} has a bodyguard{slot_msg} called {display_name}. You need to kill them first.",
                rewards=None,
                first_bodyguard={"display_name": display_name, "search_username": search_username, "slot_number": slot_n},
            )
        return AttackExecuteResponse(
            success=False,
            message=f"{target_name} has a bodyguard{slot_msg}. You need to kill them first.",
            rewards=None,
            first_bodyguard={"display_name": display_name or "bodyguard", "search_username": None, "slot_number": slot_n},
        )
    target_name = target["username"]
    target_health = float(target.get("health", DEFAULT_HEALTH))
    if not request.bullets_to_use or request.bullets_to_use < 1:
        raise HTTPException(status_code=400, detail="You must enter how many bullets to use (at least 1).")
    bullets_used = min(request.bullets_to_use, attacker_bullets, bullets_required)
    health_dealt_pct = (bullets_used / bullets_required) * 100.0
    killed = health_dealt_pct >= target_health
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"bullets": -bullets_used}})
    attempt_base = {
        "id": str(uuid.uuid4()),
        "attacker_id": current_user["id"],
        "attacker_username": current_user["username"],
        "target_id": target["id"],
        "target_username": target_name,
        "attack_id": attack["id"],
        "location_state": attack.get("location_state"),
        "bullets_used": int(bullets_used),
        "bullets_required": int(bullets_required),
        "bullets_base": int(bullets_base),
        "inflation_pct": int(round(inflation * 100)),
        "target_armour_level": int(target_armour or 0),
        "target_rank_id": int(target_rank_id or 1),
        "attacker_rank_id": int(attacker_rank_id or 1),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if killed:
        death_message = (request.death_message or "").strip()
        make_public = bool(request.make_public)
        await _increase_kill_inflation_on_kill(current_user["id"])
        killer_id = current_user["id"]
        victim_id = target["id"]
        if target.get("is_npc"):
            hitlist_entry = await db.hitlist.find_one({"target_id": victim_id, "target_type": "npc"}, {"_id": 0, "npc_rewards": 1})
            if hitlist_entry:
                rewards = hitlist_entry.get("npc_rewards") or {}
                rp_added = int(rewards.get("rank_points", 0) or 0)
                inc = {"money": int(rewards.get("cash", 0) or 0), "points": int(rewards.get("points", 0) or 0), "rank_points": rp_added, "bullets": int(rewards.get("bullets", 0) or 0), "total_kills": 1, "hitlist_npc_kills": 1}
                booze = rewards.get("booze")
                if isinstance(booze, dict) and booze:
                    booze_ids = [b["id"] for b in BOOZE_TYPES]
                    for bid, amt in booze.items():
                        if bid in booze_ids and amt and int(amt) > 0:
                            inc[f"booze_carrying.{bid}"] = int(amt)
                            inc[f"booze_carrying_cost.{bid}"] = 0
                # Prestige bonus: boost NPC hitlist kill cash and points rewards
                from server import get_prestige_bonus as _get_prestige_bonus
                _npc_mult = _get_prestige_bonus(current_user)["npc_mult"]
                inc["money"] = int(inc.get("money", 0) * _npc_mult)
                inc["points"] = int(inc.get("points", 0) * _npc_mult)
                if inc:
                    rp_before = int(current_user.get("rank_points") or 0)
                    await db.users.update_one({"id": killer_id}, {"$inc": inc})
                    if rp_added > 0:
                        try:
                            await maybe_process_rank_up(killer_id, rp_before, rp_added, current_user.get("username", ""))
                        except Exception as e:
                            logging.exception("Rank-up notification (hitlist NPC): %s", e)
                car_id = (rewards.get("car_id") or "").strip()
                if car_id and next((c for c in CARS if c.get("id") == car_id), None):
                    await db.user_cars.insert_one({"id": str(uuid.uuid4()), "user_id": killer_id, "car_id": car_id, "acquired_at": datetime.now(timezone.utc).isoformat()})
                await db.hitlist.delete_one({"target_id": victim_id, "target_type": "npc"})
                try:
                    await update_objectives_progress(killer_id, "hitlist_npc_kills", 1)
                except Exception:
                    pass
                now_iso = datetime.now(timezone.utc).isoformat()
                await db.users.update_one({"id": victim_id}, {"$set": {"is_dead": True, "dead_at": now_iso, "money": 0, "health": 0}, "$inc": {"total_deaths": 1}})
                await db.attacks.delete_many({"target_id": victim_id})
                reward_parts = []
                if inc.get("money"): reward_parts.append(f"${inc['money']:,} cash")
                if inc.get("points"): reward_parts.append(f"{inc['points']} pts")
                if inc.get("rank_points"): reward_parts.append(f"{inc['rank_points']} RP")
                if inc.get("bullets"): reward_parts.append(f"{inc['bullets']} bullets")
                if car_id: reward_parts.append("a car")
                if isinstance(booze, dict) and booze: reward_parts.append("booze")
                success_message = f"You killed {target_name}! (NPC) You got: " + ", ".join(reward_parts) + "."
                try:
                    await db.attack_attempts.insert_one({
                        **attempt_base,
                        "outcome": "killed",
                        "death_message": death_message or None,
                        "make_public": False,
                        "rewards": rewards,
                        "target_health_before": target_health,
                        "target_health_after": 0.0,
                        "is_npc_kill": True,
                    })
                except Exception:
                    pass
                await send_notification(killer_id, "Hitlist NPC kill", success_message, "attack", category="attacks")
                # If this NPC was a bodyguard (e.g. robot), do bodyguard cleanup and record vendetta war stats
                if target.get("is_bodyguard"):
                    victim_as_bodyguard = await db.bodyguards.find({"bodyguard_user_id": victim_id}, {"_id": 0, "id": 1, "user_id": 1, "hire_cost": 1}).to_list(10)
                    # Fallback: robot user doc has bodyguard_owner_id if bodyguard collection doc missing
                    if not victim_as_bodyguard and target.get("bodyguard_owner_id"):
                        victim_as_bodyguard = [{"id": None, "user_id": target["bodyguard_owner_id"], "hire_cost": 0}]
                    for bg in victim_as_bodyguard:
                        owner_id = bg["user_id"]
                        owner_doc = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1, "family_id": 1})
                        bg_hire_cost = int(bg.get("hire_cost") or 0)
                        delete_criteria = {"user_id": owner_id, "bodyguard_user_id": victim_id}
                        if bg.get("id"):
                            await db.bodyguards.delete_one({"id": bg["id"]})
                        else:
                            await db.bodyguards.delete_one(delete_criteria)
                        await db.users.update_one({"id": owner_id}, {"$inc": {"bodyguard_slots": -1}})
                        await db.users.update_one({"id": owner_id, "bodyguard_slots": {"$lt": 0}}, {"$set": {"bodyguard_slots": 0}})
                        await _record_vendetta_bg_kill(
                            killer_id, current_user.get("family_id"), owner_id, owner_doc,
                            bg_username=target_name, bullets_used=bullets_used, bg_hire_cost=bg_hire_cost,
                        )
                        remaining = await db.bodyguards.find({"user_id": owner_id}, {"_id": 0, "id": 1, "slot_number": 1}).sort("slot_number", 1).to_list(10)
                        for i, b in enumerate(remaining, 1):
                            if b["slot_number"] != i:
                                update_criteria = {"id": b["id"]} if b.get("id") else {"user_id": owner_id, "slot_number": b["slot_number"]}
                                await db.bodyguards.update_one(update_criteria, {"$set": {"slot_number": i}})
                return AttackExecuteResponse(success=True, message=success_message, rewards=rewards)
        victim_money = int(target.get("money", 0))
        cash_loot = int(victim_money * KILL_CASH_PERCENT)
        rank_points = 25
        ev = await get_effective_event()
        cash_loot = int(cash_loot * ev.get("kill_cash", 1.0))
        rank_points = int(rank_points * ev.get("rank_points", 1.0))
        victim_cars = await db.user_cars.find({"user_id": victim_id}).to_list(500)
        victim_props = await db.user_properties.find({"user_id": victim_id}, {"_id": 0, "property_id": 1}).to_list(100)
        victim_cars_count = len(victim_cars)
        victim_props_count = len(victim_props)
        exclusive_car_count = 0
        for uc in victim_cars:
            car_info = next((c for c in CARS if c["id"] == uc.get("car_id")), None)
            if car_info and car_info.get("rarity") == "exclusive":
                exclusive_car_count += 1
        prop_names = []
        for up in victim_props:
            p = await db.properties.find_one({"id": up["property_id"]}, {"_id": 0, "name": 1})
            if p:
                prop_names.append(p["name"])
        killer_doc = await db.users.find_one({"id": killer_id}, {"_id": 0, "rank_points": 1, "username": 1})
        killer_rp_before = int((killer_doc or {}).get("rank_points") or 0)
        await db.users.update_one(
            {"id": killer_id},
            {"$inc": {"money": cash_loot, "total_kills": 1, "rank_points": rank_points}}
        )
        try:
            await maybe_process_rank_up(killer_id, killer_rp_before, rank_points, (killer_doc or {}).get("username", ""))
        except Exception as e:
            logging.exception("Rank-up notification (kill): %s", e)
        # Transfer cars to killer; only exclusives get a new id so old view-car links are dead
        for uc in victim_cars:
            car_info = next((c for c in CARS if c.get("id") == uc.get("car_id")), None)
            is_exclusive = car_info and car_info.get("rarity") == "exclusive"
            if is_exclusive:
                await db.user_cars.update_one(
                    {"_id": uc["_id"]},
                    {
                        "$set": {"user_id": killer_id, "id": str(uuid.uuid4())},
                        "$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""},
                    },
                )
            else:
                await db.user_cars.update_one(
                    {"_id": uc["_id"]},
                    {"$set": {"user_id": killer_id}, "$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""}},
                )
        await db.user_properties.update_many({"user_id": victim_id}, {"$set": {"user_id": killer_id}})
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"id": victim_id},
            {"$set": {"is_dead": True, "dead_at": now_iso, "points_at_death": target.get("points", 0), "money_at_death": target.get("money", 0), "money": 0, "health": 0}, "$inc": {"total_deaths": 1}}
        )
        try:
            from routers.families import maybe_promote_after_boss_death
            await maybe_promote_after_boss_death(victim_id)
        except Exception as e:
            logging.exception("Promote after boss death: %s", e)
        # Transfer victim's casino ownership to killer (or release if killer already has one)
        killer_owns_casino = await _user_owns_any_casino(killer_id)
        casino_colls = [
            ("dice", db.dice_ownership),
            ("roulette", db.roulette_ownership),
            ("blackjack", db.blackjack_ownership),
            ("horseracing", db.horseracing_ownership),
            ("videopoker", db.videopoker_ownership),
        ]
        killer_username = (current_user.get("username") or "").strip()
        transferred_one = False
        transferred_casino_type = None
        casino_set = {"owner_id": killer_id, "owner_username": killer_username}
        if attacker_rank_id < CAPO_RANK_ID:
            casino_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
        for _game_type, coll in casino_colls:
            if killer_owns_casino:
                await coll.update_many(
                    {"owner_id": victim_id},
                    {"$set": {"owner_id": None, "owner_username": None}},
                )
            elif not transferred_one:
                res = await coll.update_one(
                    {"owner_id": victim_id},
                    {"$set": casino_set},
                )
                if res.modified_count:
                    transferred_one = True
                    transferred_casino_type = _game_type
        if not killer_owns_casino and transferred_one:
            for _game_type, coll in casino_colls:
                await coll.update_many(
                    {"owner_id": victim_id},
                    {"$set": {"owner_id": None, "owner_username": None}},
                )
        # Transfer victim's airport to killer (or release if killer already has a property)
        killer_owns_property = await _user_owns_any_property(killer_id)
        victim_airport = await db.airport_ownership.find_one({"owner_id": victim_id}, {"_id": 0, "state": 1, "slot": 1})
        transferred_airport = False
        if victim_airport:
            if killer_owns_property:
                await db.airport_ownership.update_many(
                    {"owner_id": victim_id},
                    {"$set": {"owner_id": None, "owner_username": None}},
                )
            else:
                airport_set = {"owner_id": killer_id, "owner_username": killer_username}
                if attacker_rank_id < CAPO_RANK_ID:
                    airport_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
                res = await db.airport_ownership.update_one(
                    {"owner_id": victim_id},
                    {"$set": airport_set},
                )
                if res.modified_count:
                    transferred_airport = True
                await db.airport_ownership.update_many(
                    {"owner_id": victim_id},
                    {"$set": {"owner_id": None, "owner_username": None}},
                )
        victim_as_bodyguard = await db.bodyguards.find({"bodyguard_user_id": victim_id}, {"_id": 0, "id": 1, "user_id": 1, "hire_cost": 1}).to_list(10)
        if not victim_as_bodyguard and target.get("is_bodyguard") and target.get("bodyguard_owner_id"):
            victim_as_bodyguard = [{"id": None, "user_id": target["bodyguard_owner_id"], "hire_cost": 0}]
        bodyguard_owner_username = None
        for bg in victim_as_bodyguard:
            owner_id = bg["user_id"]
            owner_doc = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1, "family_id": 1})
            if owner_doc:
                bodyguard_owner_username = owner_doc.get("username")
            bg_hire_cost = int(bg.get("hire_cost") or 0)
            delete_criteria = {"user_id": owner_id, "bodyguard_user_id": victim_id}
            if bg.get("id"):
                await db.bodyguards.delete_one({"id": bg["id"]})
            else:
                await db.bodyguards.delete_one(delete_criteria)
            await db.users.update_one({"id": owner_id}, {"$inc": {"bodyguard_slots": -1}})
            await db.users.update_one({"id": owner_id, "bodyguard_slots": {"$lt": 0}}, {"$set": {"bodyguard_slots": 0}})
            await _record_vendetta_bg_kill(
                killer_id, current_user.get("family_id"), owner_id, owner_doc,
                bg_username=target_name, bullets_used=bullets_used, bg_hire_cost=bg_hire_cost,
            )
            remaining = await db.bodyguards.find({"user_id": owner_id}, {"_id": 0, "id": 1, "slot_number": 1}).sort("slot_number", 1).to_list(10)
            for i, b in enumerate(remaining, 1):
                if b["slot_number"] != i:
                    update_criteria = {"id": b["id"]} if b.get("id") else {"user_id": owner_id, "slot_number": b["slot_number"]}
                    await db.bodyguards.update_one(update_criteria, {"$set": {"slot_number": i}})
        is_victim_bodyguard = bool(target.get("is_bodyguard"))
        attempt_base["is_bodyguard_kill"] = is_victim_bodyguard
        if is_victim_bodyguard and bodyguard_owner_username:
            attempt_base["bodyguard_owner_username"] = bodyguard_owner_username
        success_message = f"You killed {target_name}! You got ${cash_loot:,}"
        extras = []
        if victim_props_count:
            p = f"their {victim_props_count} propert{'y' if victim_props_count == 1 else 'ies'}"
            if prop_names:
                p += f" ({', '.join(prop_names)})"
            extras.append(p)
        if victim_cars_count:
            c = f"their {victim_cars_count} car{'s' if victim_cars_count != 1 else ''}"
            if exclusive_car_count:
                c += f" (including {'an' if exclusive_car_count == 1 else exclusive_car_count} exclusive car{'s' if exclusive_car_count != 1 else ''})"
            extras.append(c)
        if transferred_casino_type:
            names = {"dice": "Dice", "roulette": "Roulette", "blackjack": "Blackjack", "horseracing": "Horse Racing", "videopoker": "Video Poker"}
            extras.append(f"their casino table ({names.get(transferred_casino_type, transferred_casino_type)})")
        if transferred_airport:
            extras.append("their airport")
        if extras:
            success_message += ", " + ", ".join(extras) + "."
        else:
            success_message += " and their assets."
        if death_message:
            success_message += f' Death message: "{death_message}"'
        if make_public:
            try:
                await db.public_kills.insert_one({
                    "id": str(uuid.uuid4()),
                    "killer_id": current_user["id"],
                    "killer_username": current_user["username"],
                    "victim_id": victim_id,
                    "victim_username": target_name,
                    "death_message": death_message or None,
                    "bullets_used": bullets_used,
                    "bullets_required": bullets_required,
                    "make_public": True,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception:
                pass
        await db.attacks.delete_many({"target_id": victim_id})
        await send_notification(killer_id, "Kill", success_message, "attack", category="attacks")
        max_statements = max(0, min(6, 7 - (best_damage // 20)))
        if current_user.get("has_silencer"):
            max_statements = max(0, max_statements - 2)
        number_to_send = random.randint(0, max_statements)
        if number_to_send > 0:
            location = attack.get("location_state") or "Unknown"
            time_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            victim_label = f"bodyguard {target_name}" if target.get("is_bodyguard") else target_name
            witness_msg = f"{current_user.get('username') or 'Someone'} killed {victim_label}. Weapon: {best_weapon_name}. Bullets used: {bullets_used:,}. Location: {location}. Time: {time_str}."
            all_user_ids = await db.users.find(
                {"is_dead": {"$ne": True}, "is_npc": {"$ne": True}, "is_bodyguard": {"$ne": True}, "id": {"$ne": killer_id}},
                {"_id": 0, "id": 1}
            ).to_list(5000)
            recipient_ids = [u["id"] for u in all_user_ids]
            if recipient_ids:
                to_send = min(number_to_send, len(recipient_ids))
                for uid in random.sample(recipient_ids, to_send):
                    await send_notification(uid, "Witness statement", witness_msg, "attack", category="attacks")
        killer_family_id = await resolve_family_id(killer_id) or current_user.get("family_id")
        killer_family_id = str(killer_family_id).strip() if killer_family_id else None
        victim_family_id = target.get("family_id")
        if victim_family_id:
            try:
                if killer_family_id:
                    war = await _get_active_war_between(killer_family_id, victim_family_id)
                else:
                    war = await _get_active_war_for_family(victim_family_id)
                if war and war.get("id"):
                    await _record_war_stats_player_kill(war["id"], killer_id, killer_family_id, victim_id, victim_family_id)
                    try:
                        await db.war_kill_feed.insert_one({
                            "id": str(uuid.uuid4()),
                            "war_id": war["id"],
                            "kill_type": "player",
                            "killer_id": killer_id,
                            "killer_username": current_user.get("username", "?"),
                            "killer_family_id": killer_family_id,
                            "victim_id": victim_id,
                            "victim_username": target_name,
                            "victim_family_id": victim_family_id,
                            "bg_username": None,
                            "bg_owner_username": None,
                            "bullets_used": int(bullets_used or 0),
                            "bg_hire_cost": 0,
                            "cash_taken": cash_loot,
                            "props_taken": victim_props_count,
                            "cars_taken": victim_cars_count,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        })
                    except Exception as feed_exc:
                        logging.exception("War kill feed (player): %s", feed_exc)
            except Exception as e:
                logging.exception("War stats record on kill: %s", e)
        if victim_family_id:
            try:
                await send_notification_to_family(
                    victim_family_id,
                    "💀 Family Member Killed",
                    f"{target_name} was killed by {current_user['username']}.",
                    "attack",
                )
                target_role = (target.get("family_role") or "").lower()
                if target_role in ("boss", "underboss", "consigliere"):
                    if killer_family_id:
                        await _family_war_start(killer_family_id, victim_family_id)
                await _family_war_check_wipe_and_award(victim_family_id)
            except Exception as e:
                logging.exception("Family notify/war on kill: %s", e)
        try:
            await db.attack_attempts.insert_one({
                **attempt_base,
                "outcome": "killed",
                "death_message": death_message or None,
                "make_public": make_public,
                "rewards": {"money": cash_loot, "rank_points": rank_points, "cars_taken": victim_cars_count, "properties_taken": victim_props_count},
                "target_health_before": target_health,
                "target_health_after": 0.0,
            })
        except Exception:
            pass
        return AttackExecuteResponse(
            success=True,
            message=success_message,
            rewards={"money": cash_loot, "rank_points": rank_points, "cars_taken": victim_cars_count, "properties_taken": victim_props_count, "exclusive_cars": exclusive_car_count}
        )
    else:
        new_health = max(0.0, target_health - health_dealt_pct)
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {"health": new_health}}
        )
        await db.attacks.update_one(
            {"id": attack["id"]},
            {"$set": {"last_attack_result": "damaged", "last_attack_at": datetime.now(timezone.utc).isoformat()}}
        )
        health_pct_str = f"{health_dealt_pct:.1f}" if health_dealt_pct != int(health_dealt_pct) else str(int(health_dealt_pct))
        fail_message = f'You failed to kill {target_name}. You used {bullets_used:,} bullets — they only lost {health_pct_str}% health.'
        try:
            await db.attack_attempts.insert_one({
                **attempt_base,
                "outcome": "failed",
                "death_message": None,
                "make_public": False,
                "rewards": None,
                "target_health_before": target_health,
                "target_health_after": new_health,
                "health_dealt_pct": float(health_dealt_pct),
                "message": fail_message,
            })
        except Exception:
            pass
        return AttackExecuteResponse(success=False, message=fail_message, rewards=None)

async def get_attack_attempts(current_user: dict = Depends(get_current_user)):
    docs = await db.attack_attempts.find(
        {"$or": [{"attacker_id": current_user["id"]}, {"target_id": current_user["id"]}]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    for d in docs:
        d["direction"] = "outgoing" if d.get("attacker_id") == current_user["id"] else "incoming"
        if d.get("is_bodyguard_kill") and not d.get("bodyguard_owner_username"):
            target_user = await db.users.find_one({"id": d.get("target_id")}, {"_id": 0, "is_bodyguard": 1, "bodyguard_owner_id": 1})
            if target_user and target_user.get("bodyguard_owner_id"):
                owner = await db.users.find_one({"id": target_user["bodyguard_owner_id"]}, {"_id": 0, "username": 1})
                if owner:
                    d["bodyguard_owner_username"] = owner.get("username")
    return {"attempts": docs}


def register(router):
    router.add_api_route("/attack/search", search_target, methods=["POST"], response_model=AttackSearchResponse)
    router.add_api_route("/attack/status", get_attack_status, methods=["GET"], response_model=AttackStatusResponse)
    router.add_api_route("/attack/list", list_attacks, methods=["GET"])
    router.add_api_route("/attack/delete", delete_attacks, methods=["POST"])
    router.add_api_route("/attack/travel", travel_to_target, methods=["POST"])
    router.add_api_route("/attack/bullets/calc", calc_bullets, methods=["POST"])
    router.add_api_route("/attack/inflation", get_attack_inflation, methods=["GET"])
    router.add_api_route("/attack/execute", execute_attack, methods=["POST"], response_model=AttackExecuteResponse)
    router.add_api_route("/attack/attempts", get_attack_attempts, methods=["GET"])
