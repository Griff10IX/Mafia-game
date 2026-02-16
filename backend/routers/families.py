# Families: list, create, join, leave, kick, roles, treasury, rackets, crew OC, war stats/truce/history
from datetime import datetime, timezone, timedelta
import asyncio
import logging
import random
import uuid
import os
import sys
from typing import Optional, Dict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import Depends, HTTPException, Body
from pydantic import BaseModel

from server import (
    db,
    get_current_user,
    get_effective_event,
    RANKS,
    send_notification,
    send_notification_to_family,
    maybe_process_rank_up,
)

# ============ Constants ============
MAX_FAMILIES = 10
FAMILY_ROLES = ["boss", "underboss", "consigliere", "capo", "soldier", "associate"]
FAMILY_ROLE_LIMITS = {"boss": 1, "underboss": 1, "consigliere": 1, "capo": 4, "soldier": 15, "associate": 30}
FAMILY_ROLE_ORDER = {"boss": 0, "underboss": 1, "consigliere": 2, "capo": 3, "soldier": 4, "associate": 5}

FAMILY_RACKETS = [
    {"id": "protection", "name": "Protection Racket", "cooldown_hours": 6, "base_income": 400, "description": "Extortion from businesses"},
    {"id": "gambling", "name": "Gambling Operation", "cooldown_hours": 12, "base_income": 550, "description": "Numbers & bookmaking"},
    {"id": "loansharking", "name": "Loan Sharking", "cooldown_hours": 24, "base_income": 700, "description": "High-interest loans"},
    {"id": "labour", "name": "Labour Racketeering", "cooldown_hours": 8, "base_income": 850, "description": "Union kickbacks"},
    {"id": "distillery", "name": "Distillery", "cooldown_hours": 10, "base_income": 1000, "description": "Bootleg liquor production"},
    {"id": "warehouse", "name": "Warehouse", "cooldown_hours": 8, "base_income": 1150, "description": "Storage and distribution"},
    {"id": "restaurant_bar", "name": "Restaurant & Bar", "cooldown_hours": 6, "base_income": 1300, "description": "Front and steady income"},
    {"id": "funeral_home", "name": "Funeral Home", "cooldown_hours": 12, "base_income": 1450, "description": "Respectable front"},
    {"id": "garment_shop", "name": "Garment Shop", "cooldown_hours": 9, "base_income": 1600, "description": "Garment district operations"},
]
RACKET_UPGRADE_COST = 50_000
RACKET_UNLOCK_COST = 100_000
RACKET_MAX_LEVEL = 5
FAMILY_RACKET_ATTACK_BASE_SUCCESS = 0.70
FAMILY_RACKET_ATTACK_LEVEL_PENALTY = 0.10
FAMILY_RACKET_ATTACK_MIN_SUCCESS = 0.10
FAMILY_RACKET_ATTACK_REVENUE_PCT = 0.25
FAMILY_RACKET_ATTACK_MAX_PER_CREW = 2
FAMILY_RACKET_ATTACK_CREW_WINDOW_HOURS = 3

CREW_OC_COOLDOWN_HOURS = 8
CREW_OC_COOLDOWN_HOURS_REDUCED = 6
CREW_OC_REWARD_RP = 80
CREW_OC_REWARD_CASH = 40_000
CREW_OC_REWARD_BULLETS = 100
CREW_OC_REWARD_POINTS = 3
CREW_OC_REWARD_BOOZE = 10
CREW_OC_TREASURY_LUMP = 200_000

FAMILY_RACKET_RAID_SUCCESS_MESSAGES = [
    "Raid successful! Took ${amount:,} from {family_name}'s {racket_name}.",
    "Clean score. ${amount:,} from {family_name}'s racket.",
    "You hit their {racket_name}. ${amount:,} to your treasury.",
    "Raid successful. ${amount:,} from {family_name}.",
    "The take: ${amount:,} from {family_name}'s {racket_name}.",
    "No heat. ${amount:,} from their {racket_name}.",
    "Done. ${amount:,} taken from {family_name}.",
    "Smooth run. ${amount:,} from {family_name}'s racket.",
    "Score. ${amount:,} from {family_name}'s {racket_name}.",
    "Raid paid off. ${amount:,}.",
]
FAMILY_RACKET_RAID_FAIL_MESSAGES = [
    "Raid failed.",
    "No dice. {family_name}'s {racket_name} held.",
    "They were ready. Raid failed.",
    "The crew at {family_name} pushed back. No take.",
    "Raid blown. {family_name}'s racket didn't give.",
    "Wrong move. Raid failed.",
    "Their muscle held the line. No score.",
    "Raid failed. {family_name} was buttoned up.",
    "No score. Try again when the heat's off.",
    "The raid didn't stick. No payout.",
]

FAMILY_RACKET_COLLECT_SUCCESS_MESSAGES = [
    "Collected ${income:,}", "Your cut: ${income:,}", "Racket paid out. ${income:,} to the family.",
    "Collected ${income:,} from the racket.", "The take: ${income:,}.", "Payout collected. ${income:,}.",
    "${income:,} in the bag.", "Racket income: ${income:,}.", "Collected ${income:,}. Clean.", "Your share: ${income:,}.",
]


# ============ Request models ============
class FamilyCreateRequest(BaseModel):
    name: str
    tag: str


class FamilyJoinRequest(BaseModel):
    family_id: str


class FamilyKickRequest(BaseModel):
    user_id: str


class FamilyRoleRequest(BaseModel):
    user_id: str
    role: str


class FamilyDepositRequest(BaseModel):
    amount: int


class FamilyWithdrawRequest(BaseModel):
    amount: int


class FamilyAttackRacketRequest(BaseModel):
    family_id: str
    racket_id: str


class FamilyCrewOCSetFeeRequest(BaseModel):
    fee: int


class FamilyCrewOCApplyRequest(BaseModel):
    family_id: str


class WarTruceRequest(BaseModel):
    war_id: str


# ============ Helpers ============
def _racket_income_and_cooldown(racket_id: str, level: int, ev: dict):
    r = next((x for x in FAMILY_RACKETS if x["id"] == racket_id), None)
    if not r or level <= 0:
        return 0, 0
    base_income = r["base_income"] * level
    cooldown = r["cooldown_hours"]
    payout_mult = ev.get("racket_payout", 1.0)
    cooldown_mult = ev.get("racket_cooldown", 1.0)
    return int(base_income * payout_mult), cooldown * cooldown_mult


def _racket_previous_id(racket_id: str):
    ids = [x["id"] for x in FAMILY_RACKETS]
    if racket_id not in ids:
        return None
    i = ids.index(racket_id)
    return ids[i - 1] if i > 0 else None


async def cleanup_dead_families():
    """Remove families where all members are dead or don't exist. Transfer assets to war winners."""
    families = await db.families.find({}, {"_id": 0}).to_list(50)
    for fam in families:
        family_id = fam["id"]
        members = await db.family_members.find({"family_id": family_id}, {"_id": 0}).to_list(100)
        living_count = 0
        for m in members:
            user = await db.users.find_one({"id": m["user_id"]}, {"_id": 0, "id": 1, "is_dead": 1})
            if user and user.get("id") and not user.get("is_dead", False):
                living_count += 1
        if living_count == 0:
            active_wars = await db.family_wars.find({
                "$or": [{"family_a_id": family_id}, {"family_b_id": family_id}],
                "status": {"$in": ["active", "truce_offered"]}
            }, {"_id": 0}).to_list(10)
            now = datetime.now(timezone.utc).isoformat()
            rackets = fam.get("rackets") or {}
            treasury = fam.get("treasury", 0)
            assets_transferred = False
            for active_war in active_wars:
                winner_id = active_war["family_b_id"] if active_war["family_a_id"] == family_id else active_war["family_a_id"]
                loser_id = family_id
                war_status = "family_a_wins" if winner_id == active_war["family_a_id"] else "family_b_wins"
                prize_rackets_list = []
                prize_treasury = 0
                if not assets_transferred:
                    if rackets:
                        winner_fam = await db.families.find_one({"id": winner_id}, {"_id": 0, "rackets": 1, "boss_id": 1})
                        winner_rackets = (winner_fam or {}).get("rackets") or {}
                        for racket_id, state in rackets.items():
                            level = state.get("level", 0)
                            if level > 0:
                                existing = winner_rackets.get(racket_id, {}).get("level", 0)
                                if level > existing:
                                    winner_rackets[racket_id] = {"level": level, "last_collected_at": None}
                                    racket_def = next((r for r in FAMILY_RACKETS if r["id"] == racket_id), None)
                                    prize_rackets_list.append({
                                        "racket_id": racket_id,
                                        "name": racket_def["name"] if racket_def else racket_id,
                                        "level": level
                                    })
                        await db.families.update_one({"id": winner_id}, {"$set": {"rackets": winner_rackets}})
                    if treasury > 0:
                        await db.families.update_one({"id": winner_id}, {"$inc": {"treasury": treasury}})
                        prize_treasury = treasury
                    await send_notification_to_family(
                        winner_id,
                        "🏆 WAR VICTORY!",
                        f"The enemy family {fam['name']} has been destroyed! You've captured their rackets and ${treasury:,} from their treasury.",
                        "system"
                    )
                    assets_transferred = True
                winner_fam_doc = await db.families.find_one({"id": winner_id}, {"_id": 0, "name": 1, "tag": 1})
                winner_family_name = (winner_fam_doc or {}).get("name") or (winner_fam_doc or {}).get("tag") or winner_id
                loser_family_name = fam.get("name") or fam.get("tag") or loser_id
                await db.family_wars.update_one(
                    {"id": active_war["id"]},
                    {"$set": {
                        "status": war_status,
                        "winner_family_id": winner_id,
                        "loser_family_id": loser_id,
                        "winner_family_name": winner_family_name,
                        "loser_family_name": loser_family_name,
                        "ended_at": now,
                        "prize_rackets": prize_rackets_list if prize_rackets_list else None,
                        "prize_treasury": prize_treasury
                    }}
                )
            await db.family_members.delete_many({"family_id": family_id})
            await db.families.delete_one({"id": family_id})


_family_raid_locks: Dict[tuple, asyncio.Lock] = {}
_family_raid_locks_guard = asyncio.Lock()


async def _get_family_raid_lock(attacker_family_id: str, target_family_id: str) -> asyncio.Lock:
    key = (attacker_family_id, target_family_id)
    async with _family_raid_locks_guard:
        if key not in _family_raid_locks:
            _family_raid_locks[key] = asyncio.Lock()
        return _family_raid_locks[key]


# ============ Routes ============
async def families_list(current_user: dict = Depends(get_current_user)):
    await cleanup_dead_families()
    cursor = db.families.find({}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "treasury": 1})
    fams = await cursor.to_list(MAX_FAMILIES * 2)
    out = []
    for f in fams:
        members = await db.family_members.find({"family_id": f["id"]}, {"_id": 0, "user_id": 1}).to_list(100)
        living_count = 0
        for m in members:
            user = await db.users.find_one({"id": m["user_id"]}, {"_id": 0, "id": 1, "is_dead": 1})
            if user and user.get("id") and not user.get("is_dead", False):
                living_count += 1
        if living_count > 0:
            out.append({
                "id": f["id"], "name": f["name"], "tag": f["tag"],
                "member_count": living_count, "treasury": f.get("treasury", 0),
            })
    return out


async def families_config(current_user: dict = Depends(get_current_user)):
    return {
        "max_families": MAX_FAMILIES,
        "roles": FAMILY_ROLES,
        "racket_max_level": RACKET_MAX_LEVEL,
        "rackets": FAMILY_RACKETS,
        "racket_upgrade_cost": RACKET_UPGRADE_COST,
        "racket_unlock_cost": RACKET_UNLOCK_COST,
    }


async def families_my(current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        return {"family": None, "members": [], "rackets": [], "my_role": None}
    fam = await db.families.find_one({"id": family_id}, {"_id": 0})
    if not fam:
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_id": None, "family_role": None}})
        return {"family": None, "members": [], "rackets": [], "my_role": None}
    members_docs = await db.family_members.find({"family_id": family_id}, {"_id": 0}).to_list(100)
    my_role = current_user.get("family_role")
    my_member = next((m for m in members_docs if m["user_id"] == current_user["id"]), None)
    if my_member and my_member.get("role"):
        my_role = str(my_member["role"]).strip().lower() or my_role
        if my_role and current_user.get("family_role") != my_role:
            await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_role": my_role}})
    if my_role:
        my_role = str(my_role).strip().lower()
    ev = await get_effective_event()
    members = []
    for m in members_docs:
        u = await db.users.find_one({"id": m["user_id"]}, {"_id": 0, "username": 1, "rank": 1})
        rank_name = "—"
        if u:
            rid = u.get("rank", 1)
            rn = next((x["name"] for x in RANKS if x.get("id") == rid), str(rid))
            rank_name = rn
        members.append({
            "user_id": m["user_id"],
            "username": (u or {}).get("username", "?"),
            "role": str(m.get("role", "")).strip().lower() or "associate",
            "rank_name": rank_name,
        })
    rackets_raw = fam.get("rackets") or {}
    rackets = []
    now = datetime.now(timezone.utc)
    racket_ids_ordered = [x["id"] for x in FAMILY_RACKETS]
    for idx, r in enumerate(FAMILY_RACKETS):
        try:
            rid = r["id"]
            state = rackets_raw.get(rid) or {}
            level = int(state.get("level", 0) or 0)
            locked = level <= 0
            prev_id = racket_ids_ordered[idx - 1] if idx > 0 else None
            required_racket_name = None
            can_unlock = False
            if locked and prev_id:
                required_racket_name = next((x["name"] for x in FAMILY_RACKETS if x["id"] == prev_id), prev_id)
                prev_level = int((rackets_raw.get(prev_id) or {}).get("level", 0) or 0)
                can_unlock = prev_level >= RACKET_MAX_LEVEL
            elif locked and idx == 0:
                can_unlock = True
            last_at = state.get("last_collected_at")
            income_per, cooldown_h = _racket_income_and_cooldown(rid, level, ev)
            next_collect_at = None
            if last_at and level > 0 and cooldown_h > 0:
                try:
                    last_dt = datetime.fromisoformat(str(last_at).replace("Z", "+00:00"))
                    next_dt = last_dt + timedelta(hours=cooldown_h)
                    next_collect_at = next_dt.isoformat() if next_dt > now else None
                except Exception:
                    next_collect_at = None
            if next_collect_at is None and level > 0:
                next_collect_at = now.isoformat()
            rackets.append({
                "id": rid, "name": r["name"], "description": r.get("description", ""),
                "level": level, "locked": locked, "required_racket_name": required_racket_name, "can_unlock": can_unlock,
                "unlock_cost": RACKET_UNLOCK_COST if locked else None,
                "cooldown_hours": r["cooldown_hours"], "effective_cooldown_hours": cooldown_h,
                "income_per_collect": income_per, "effective_income_per_collect": income_per,
                "next_collect_at": next_collect_at,
            })
        except Exception:
            continue
    crew_oc_applications = []
    if family_id:
        app_cursor = db.family_crew_oc_applications.find({"family_id": family_id}, {"_id": 0}).sort("created_at", -1)
        crew_oc_applications = await app_cursor.to_list(50)
    return {
        "family": {
            "id": fam["id"], "name": fam["name"], "tag": fam["tag"],
            "treasury": fam.get("treasury", 0), "crew_oc_cooldown_until": fam.get("crew_oc_cooldown_until"),
            "crew_oc_join_fee": int(fam.get("crew_oc_join_fee") or 0),
            "crew_oc_forum_topic_id": fam.get("crew_oc_forum_topic_id"),
        },
        "members": members, "rackets": rackets, "my_role": my_role,
        "crew_oc_committer_has_timer": bool(current_user.get("crew_oc_timer_reduced", False)),
        "crew_oc_applications": crew_oc_applications,
    }


async def families_lookup(tag: str = None, current_user: dict = Depends(get_current_user)):
    if not tag or not str(tag).strip():
        raise HTTPException(status_code=400, detail="tag required")
    tag = str(tag).strip().upper()
    fam = await db.families.find_one({"$or": [{"tag": tag}, {"id": tag}]}, {"_id": 0})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    members_docs = await db.family_members.find({"family_id": fam["id"]}, {"_id": 0}).to_list(100)
    members = []
    for m in members_docs:
        u = await db.users.find_one({"id": m["user_id"]}, {"_id": 0, "username": 1, "rank": 1})
        rank_name = "—"
        if u and RANKS:
            rank_name = next((x["name"] for x in RANKS if x.get("id") == u.get("rank", 1)), str(u.get("rank", 1)))
        members.append({"user_id": m["user_id"], "username": (u or {}).get("username", "?"), "role": m["role"], "rank_name": rank_name})
    rackets_raw = fam.get("rackets") or {}
    rackets = []
    for r in FAMILY_RACKETS:
        state = rackets_raw.get(r["id"]) or {}
        level = state.get("level", 0)
        if level > 0:
            rackets.append({"id": r["id"], "name": r["name"], "level": level})
    my_role = None
    if current_user.get("family_id") == fam["id"]:
        my_role = current_user.get("family_role")
    crew_oc_join_fee = int(fam.get("crew_oc_join_fee") or 0)
    crew_oc_cooldown_until = fam.get("crew_oc_cooldown_until")
    crew_oc_forum_topic_id = fam.get("crew_oc_forum_topic_id")
    crew_oc_application = None
    app = await db.family_crew_oc_applications.find_one(
        {"family_id": fam["id"], "user_id": current_user["id"]},
        {"_id": 0, "status": 1, "amount_paid": 1},
    )
    if app:
        crew_oc_application = {"status": app.get("status"), "amount_paid": int(app.get("amount_paid") or 0)}
    accepted_apps = await db.family_crew_oc_applications.find(
        {"family_id": fam["id"], "status": "accepted"},
        {"_id": 0, "username": 1},
    ).to_list(50)
    crew_oc_crew = [{"username": m["username"], "is_family_member": True} for m in members]
    crew_oc_crew += [{"username": a.get("username") or "?", "is_family_member": False} for a in accepted_apps]
    return {
        "id": fam["id"], "name": fam["name"], "tag": fam["tag"], "treasury": fam.get("treasury", 0),
        "member_count": len(members), "members": members, "rackets": rackets, "my_role": my_role,
        "crew_oc_join_fee": crew_oc_join_fee, "crew_oc_cooldown_until": crew_oc_cooldown_until,
        "crew_oc_forum_topic_id": crew_oc_forum_topic_id,
        "crew_oc_application": crew_oc_application, "crew_oc_crew": crew_oc_crew,
    }


async def families_create(request: FamilyCreateRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_id"):
        raise HTTPException(status_code=400, detail="Already in a family")
    name = (request.name or "").strip()[:30]
    tag = (request.tag or "").strip().upper().replace(" ", "")[:4]
    if len(name) < 2 or len(tag) < 2:
        raise HTTPException(status_code=400, detail="Name and tag must be at least 2 characters")
    count = await db.families.count_documents({})
    if count >= MAX_FAMILIES:
        raise HTTPException(status_code=400, detail="Maximum number of families reached")
    if await db.families.find_one({"$or": [{"name": name}, {"tag": tag}]}):
        raise HTTPException(status_code=400, detail="Name or tag already taken")
    family_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    first_racket_id = FAMILY_RACKETS[0]["id"]
    await db.families.insert_one({
        "id": family_id, "name": name, "tag": tag, "boss_id": current_user["id"],
        "treasury": 0, "created_at": now,
        "rackets": {first_racket_id: {"level": 1, "last_collected_at": None}},
    })
    await db.family_members.insert_one({
        "id": str(uuid.uuid4()), "family_id": family_id, "user_id": current_user["id"],
        "role": "boss", "joined_at": now,
    })
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_id": family_id, "family_role": "boss"}})
    return {"message": "Family created", "family_id": family_id}


async def families_join(request: FamilyJoinRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_id"):
        raise HTTPException(status_code=400, detail="Already in a family")
    fam = await db.families.find_one({"id": request.family_id}, {"_id": 0})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    count = await db.family_members.count_documents({"family_id": request.family_id})
    if count >= sum(FAMILY_ROLE_LIMITS.values()):
        raise HTTPException(status_code=400, detail="Family is full")
    now = datetime.now(timezone.utc).isoformat()
    await db.family_members.insert_one({
        "id": str(uuid.uuid4()), "family_id": request.family_id, "user_id": current_user["id"],
        "role": "associate", "joined_at": now,
    })
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_id": request.family_id, "family_role": "associate"}})
    return {"message": "Joined family"}


async def families_leave(current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "boss_id": 1})
    if fam and fam.get("boss_id") == current_user["id"]:
        raise HTTPException(status_code=400, detail="Boss must transfer leadership or dissolve family first")
    await db.family_members.delete_one({"family_id": family_id, "user_id": current_user["id"]})
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_id": None, "family_role": None}})
    return {"message": "Left family"}


async def families_kick(request: FamilyKickRequest, current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Boss or Underboss can kick")
    if request.user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot kick yourself")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": request.user_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.get("role") == "boss":
        raise HTTPException(status_code=400, detail="Cannot kick the Boss")
    await db.family_members.delete_one({"family_id": family_id, "user_id": request.user_id})
    await db.users.update_one({"id": request.user_id}, {"$set": {"family_id": None, "family_role": None}})
    return {"message": "Member kicked"}


async def families_assign_role(request: FamilyRoleRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") != "boss":
        raise HTTPException(status_code=403, detail="Only Boss can assign roles")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if request.role not in FAMILY_ROLES or request.role == "boss":
        raise HTTPException(status_code=400, detail="Invalid role")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": request.user_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    counts = await db.family_members.aggregate([
        {"$match": {"family_id": family_id}},
        {"$group": {"_id": "$role", "c": {"$sum": 1}}},
    ]).to_list(20)
    by_role = {x["_id"]: x["c"] for x in counts}
    limit = FAMILY_ROLE_LIMITS.get(request.role, 0)
    if limit and (by_role.get(request.role) or 0) >= limit and member.get("role") != request.role:
        raise HTTPException(status_code=400, detail=f"Role {request.role} limit reached")
    await db.family_members.update_one({"family_id": family_id, "user_id": request.user_id}, {"$set": {"role": request.role}})
    await db.users.update_one({"id": request.user_id}, {"$set": {"family_role": request.role}})
    if request.role == "boss":
        await db.families.update_one({"id": family_id}, {"$set": {"boss_id": request.user_id}})
        await db.family_members.update_one({"family_id": family_id, "user_id": current_user["id"]}, {"$set": {"role": "underboss"}})
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_role": "underboss"}})
    return {"message": "Role updated"}


async def families_deposit(request: FamilyDepositRequest, current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Invalid amount")
    money = int(current_user.get("money", 0) or 0)
    if money < amount:
        raise HTTPException(status_code=400, detail="Not enough cash")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -amount}})
    await db.families.update_one({"id": family_id}, {"$inc": {"treasury": amount}})
    return {"message": "Deposited to treasury"}


async def families_withdraw(request: FamilyWithdrawRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Invalid amount")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1})
    treasury = int((fam or {}).get("treasury", 0) or 0)
    if treasury < amount:
        raise HTTPException(status_code=400, detail="Not enough treasury")
    await db.families.update_one({"id": family_id}, {"$inc": {"treasury": -amount}})
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": amount}})
    return {"message": "Withdrew from treasury"}


async def families_crew_oc_set_fee(request: FamilyCrewOCSetFeeRequest, current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can set Crew OC fee")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fee = int(request.fee or 0)
    if fee < 0:
        raise HTTPException(status_code=400, detail="Fee cannot be negative")
    await db.families.update_one({"id": family_id}, {"$set": {"crew_oc_join_fee": fee}})
    return {"message": "Crew OC join fee updated.", "fee": fee}


async def families_crew_oc_advertise(current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can advertise Crew OC")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "name": 1, "tag": 1, "crew_oc_forum_topic_id": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    if fam.get("crew_oc_forum_topic_id"):
        raise HTTPException(status_code=400, detail="Family already has a Crew OC topic. Go to Forum → Crew OC to find it.")
    topic_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    title = f"Crew OC: {fam.get('name')} [{fam.get('tag')}]"
    content = f"Apply here to join {fam.get('name')} [{fam.get('tag')}] for their next Crew OC run. Set your join fee in Families → Crew OC."
    doc = {
        "id": topic_id, "title": title, "content": content, "category": "crew_oc",
        "crew_oc_family_id": family_id, "author_id": current_user["id"],
        "author_username": current_user.get("username") or "?", "created_at": now, "updated_at": now,
        "views": 0, "is_sticky": False, "is_important": False, "is_locked": False,
    }
    await db.forum_topics.insert_one(doc)
    await db.families.update_one({"id": family_id}, {"$set": {"crew_oc_forum_topic_id": topic_id}})
    return {"message": "Crew OC topic created.", "topic_id": topic_id, "title": title}


async def families_crew_oc_apply(request: FamilyCrewOCApplyRequest, current_user: dict = Depends(get_current_user)):
    family_id = (request.family_id or "").strip()
    if not family_id:
        raise HTTPException(status_code=400, detail="family_id required")
    uid = current_user["id"]
    if current_user.get("family_id") == family_id:
        raise HTTPException(status_code=400, detail="You are already in this family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "name": 1, "tag": 1, "crew_oc_join_fee": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    fee = int(fam.get("crew_oc_join_fee") or 0)
    existing = await db.family_crew_oc_applications.find_one({"family_id": family_id, "user_id": uid}, {"_id": 0, "status": 1})
    if existing:
        raise HTTPException(status_code=400, detail=f"You already applied (status: {existing.get('status')})")
    now = datetime.now(timezone.utc).isoformat()
    application_id = str(uuid.uuid4())
    if fee > 0:
        money = int(current_user.get("money") or 0)
        if money < fee:
            raise HTTPException(status_code=400, detail=f"Join fee is ${fee:,}. You need ${fee - money:,} more cash.")
        await db.users.update_one({"id": uid}, {"$inc": {"money": -fee}})
        await db.families.update_one({"id": family_id}, {"$inc": {"treasury": fee}})
        await db.family_crew_oc_applications.insert_one({
            "id": application_id, "family_id": family_id, "user_id": uid,
            "username": current_user.get("username") or "?", "status": "accepted", "amount_paid": fee, "created_at": now,
        })
        await send_notification(uid, "Crew OC – You're in", f"You paid ${fee:,} and joined {fam.get('name')} [{fam.get('tag')}] Crew OC for their next run.", "reward", category="crew_oc")
        await send_notification_to_family(family_id, "Crew OC – New crew member", f"{current_user.get('username') or '?'} paid ${fee:,} and joined your Crew OC for the next run.", "reward", category="oc_invites")
        return {"message": "You paid and joined the crew. You'll get rewards when they commit.", "status": "accepted", "amount_paid": fee}
    await db.family_crew_oc_applications.insert_one({
        "id": application_id, "family_id": family_id, "user_id": uid,
        "username": current_user.get("username") or "?", "status": "pending", "amount_paid": 0, "created_at": now,
    })
    await send_notification_to_family(family_id, "Crew OC – New application", f"{current_user.get('username') or '?'} applied to join your Crew OC. Accept or reject in Families → Crew OC.", "system", category="oc_invites")
    return {"message": "Application sent. The family will accept or reject.", "status": "pending"}


async def families_crew_oc_applications(current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    role = (current_user.get("family_role") or "").strip().lower()
    apps = await db.family_crew_oc_applications.find({"family_id": family_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"applications": apps, "can_manage": role in ("boss", "underboss", "capo")}


async def families_crew_oc_accept(application_id: str, current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    app = await db.family_crew_oc_applications.find_one({"id": application_id, "family_id": family_id}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Application already processed")
    await db.family_crew_oc_applications.update_one({"id": application_id}, {"$set": {"status": "accepted"}})
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "name": 1, "tag": 1})
    fam_name = (fam or {}).get("name") or (fam or {}).get("tag") or "the family"
    await send_notification(app["user_id"], "Crew OC – Accepted", f"Your application to join {fam_name} Crew OC was accepted. You'll get rewards when they commit.", "reward", category="crew_oc")
    return {"message": "Application accepted."}


async def families_crew_oc_reject(application_id: str, current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    app = await db.family_crew_oc_applications.find_one({"id": application_id, "family_id": family_id}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Application already processed")
    await db.family_crew_oc_applications.update_one({"id": application_id}, {"$set": {"status": "rejected"}})
    return {"message": "Application rejected."}


async def families_crew_oc_commit(current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can commit Crew OC")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1, "crew_oc_cooldown_until": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    now = datetime.now(timezone.utc)
    cooldown_until = fam.get("crew_oc_cooldown_until")
    if cooldown_until:
        try:
            until = datetime.fromisoformat(str(cooldown_until).replace("Z", "+00:00"))
            if until > now:
                secs = int((until - now).total_seconds())
                raise HTTPException(status_code=400, detail=f"Crew OC on cooldown. Try again in {secs}s")
        except HTTPException:
            raise
        except Exception:
            pass
    has_timer = bool(current_user.get("crew_oc_timer_reduced", False))
    cooldown_hours = CREW_OC_COOLDOWN_HOURS_REDUCED if has_timer else CREW_OC_COOLDOWN_HOURS
    new_cooldown_until = now + timedelta(hours=cooldown_hours)
    members = await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(100)
    member_ids = [m["user_id"] for m in members]
    accepted = await db.family_crew_oc_applications.find({"family_id": family_id, "status": "accepted"}, {"_id": 0, "user_id": 1}).to_list(50)
    accepted_ids = [a["user_id"] for a in accepted]
    roster_ids = list(dict.fromkeys(member_ids + accepted_ids))
    living = await db.users.find({"id": {"$in": roster_ids}, "is_dead": {"$ne": True}}, {"_id": 0, "id": 1, "rank_points": 1, "username": 1}).to_list(100)
    living_ids = [u["id"] for u in living]
    if not living_ids:
        raise HTTPException(status_code=400, detail="No living crew members")
    for u in living:
        uid = u["id"]
        rp_before = int(u.get("rank_points") or 0)
        await db.users.update_one({"id": uid}, {"$inc": {"rank_points": CREW_OC_REWARD_RP, "money": CREW_OC_REWARD_CASH, "bullets": CREW_OC_REWARD_BULLETS, "points": CREW_OC_REWARD_POINTS, "booze": CREW_OC_REWARD_BOOZE}})
        try:
            await maybe_process_rank_up(uid, rp_before, CREW_OC_REWARD_RP, u.get("username", ""))
        except Exception:
            logging.exception("Rank-up notification (Crew OC)")
    await db.families.update_one({"id": family_id}, {"$inc": {"treasury": CREW_OC_TREASURY_LUMP}, "$set": {"crew_oc_cooldown_until": new_cooldown_until.isoformat()}})
    await db.family_crew_oc_applications.delete_many({"family_id": family_id})
    for uid in living_ids:
        await send_notification(uid, "Crew OC committed", f"Your crew committed Organised Crime. You received +{CREW_OC_REWARD_RP} RP, +${CREW_OC_REWARD_CASH:,} cash, +{CREW_OC_REWARD_BULLETS} bullets, +{CREW_OC_REWARD_POINTS} points, +{CREW_OC_REWARD_BOOZE} booze. Treasury +${CREW_OC_TREASURY_LUMP:,}.", "reward", category="crew_oc")
    return {"message": "Crew OC committed. All crew rewarded.", "crew_oc_cooldown_until": new_cooldown_until.isoformat(), "cooldown_hours": cooldown_hours}


async def families_racket_collect(racket_id: str, current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1, "rackets": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    rackets = (fam.get("rackets") or {}).copy()
    state = rackets.get(racket_id) or {}
    level = state.get("level", 0)
    if level <= 0:
        raise HTTPException(status_code=400, detail="Racket not active")
    r_def = next((x for x in FAMILY_RACKETS if x["id"] == racket_id), None)
    if not r_def:
        raise HTTPException(status_code=404, detail="Racket not found")
    ev = await get_effective_event()
    income, cooldown_h = _racket_income_and_cooldown(racket_id, level, ev)
    last_at = state.get("last_collected_at")
    now = datetime.now(timezone.utc)
    if last_at:
        try:
            last_dt = datetime.fromisoformat(last_at.replace("Z", "+00:00"))
            if (last_dt + timedelta(hours=cooldown_h)) > now:
                raise HTTPException(status_code=400, detail="Racket on cooldown")
        except HTTPException:
            raise
        except Exception:
            pass
    now_iso = now.isoformat()
    rackets[racket_id] = {**state, "level": level, "last_collected_at": now_iso}
    await db.families.update_one({"id": family_id}, {"$set": {"rackets": rackets}, "$inc": {"treasury": income}})
    msg = random.choice(FAMILY_RACKET_COLLECT_SUCCESS_MESSAGES).format(income=income)
    return {"message": msg, "amount": income}


async def families_racket_unlock(racket_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1, "rackets": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    if racket_id not in [x["id"] for x in FAMILY_RACKETS]:
        raise HTTPException(status_code=404, detail="Racket not found")
    rackets = (fam.get("rackets") or {}).copy()
    state = rackets.get(racket_id) or {}
    level = state.get("level", 0)
    if level >= 1:
        raise HTTPException(status_code=400, detail="Racket already unlocked")
    prev_id = _racket_previous_id(racket_id)
    if prev_id:
        prev_level = (rackets.get(prev_id) or {}).get("level", 0)
        if prev_level < RACKET_MAX_LEVEL:
            prev_name = next((r["name"] for r in FAMILY_RACKETS if r["id"] == prev_id), prev_id)
            raise HTTPException(status_code=400, detail=f"Fully upgrade {prev_name} (level {RACKET_MAX_LEVEL}) before unlocking this racket")
    treasury = int((fam.get("treasury") or 0) or 0)
    if treasury < RACKET_UNLOCK_COST:
        raise HTTPException(status_code=400, detail=f"Not enough treasury (need ${RACKET_UNLOCK_COST:,})")
    rackets[racket_id] = {"level": 1, "last_collected_at": None}
    await db.families.update_one({"id": family_id}, {"$set": {"rackets": rackets}, "$inc": {"treasury": -RACKET_UNLOCK_COST}})
    return {"message": "Racket unlocked"}


async def families_racket_upgrade(racket_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1, "rackets": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    if racket_id not in [x["id"] for x in FAMILY_RACKETS]:
        raise HTTPException(status_code=404, detail="Racket not found")
    rackets = (fam.get("rackets") or {}).copy()
    state = rackets.get(racket_id) or {}
    level = state.get("level", 0)
    if level <= 0:
        raise HTTPException(status_code=400, detail="Unlock this racket first (previous racket must be fully upgraded)")
    if level >= RACKET_MAX_LEVEL:
        raise HTTPException(status_code=400, detail="Racket already max level")
    treasury = int((fam.get("treasury") or 0) or 0)
    if treasury < RACKET_UPGRADE_COST:
        raise HTTPException(status_code=400, detail="Not enough treasury")
    rackets[racket_id] = {**state, "level": level + 1, "last_collected_at": state.get("last_collected_at")}
    await db.families.update_one({"id": family_id}, {"$set": {"rackets": rackets}, "$inc": {"treasury": -RACKET_UPGRADE_COST}})
    return {"message": f"Upgraded to level {level + 1}"}


async def families_racket_attack_targets(debug: bool = False, current_user: dict = Depends(get_current_user)):
    my_family_id = current_user.get("family_id")
    if not my_family_id:
        return {"targets": []}
    all_other = await db.families.find({"id": {"$ne": my_family_id}}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "treasury": 1, "rackets": 1}).to_list(50)
    ev = await get_effective_event()
    targets = []
    for fam in all_other:
        rackets = fam.get("rackets") or {}
        racket_list = []
        for rid, state in rackets.items():
            lv = state.get("level", 0)
            if lv < 1:
                continue
            r_def = next((x for x in FAMILY_RACKETS if x["id"] == rid), None)
            income, cooldown_h = _racket_income_and_cooldown(rid, lv, ev)
            potential_take = int(income * FAMILY_RACKET_ATTACK_REVENUE_PCT)
            success_chance = max(FAMILY_RACKET_ATTACK_MIN_SUCCESS, FAMILY_RACKET_ATTACK_BASE_SUCCESS - lv * FAMILY_RACKET_ATTACK_LEVEL_PENALTY)
            success_chance_pct = int(round(success_chance * 100))
            racket_list.append({"racket_id": rid, "racket_name": r_def["name"] if r_def else rid, "level": lv, "potential_take": potential_take, "success_chance_pct": success_chance_pct})
        if racket_list:
            window_start = datetime.now(timezone.utc) - timedelta(hours=FAMILY_RACKET_ATTACK_CREW_WINDOW_HOURS)
            raids_on_crew = await db.family_racket_attacks.count_documents({"attacker_family_id": my_family_id, "target_family_id": fam["id"], "last_at": {"$gte": window_start.isoformat()}})
            raids_used = min(raids_on_crew, FAMILY_RACKET_ATTACK_MAX_PER_CREW)
            raids_remaining = max(0, FAMILY_RACKET_ATTACK_MAX_PER_CREW - raids_used)
            targets.append({"family_id": fam["id"], "family_name": fam["name"], "family_tag": fam["tag"], "treasury": fam.get("treasury", 0), "rackets": racket_list, "raids_used": raids_used, "raids_remaining": raids_remaining})
    return {"targets": targets}


async def families_attack_racket(request: FamilyAttackRacketRequest, current_user: dict = Depends(get_current_user)):
    my_family_id = current_user.get("family_id")
    if not my_family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    target_fam = await db.families.find_one({"id": request.family_id}, {"_id": 0, "name": 1, "tag": 1, "treasury": 1, "rackets": 1})
    if not target_fam or request.family_id == my_family_id:
        raise HTTPException(status_code=404, detail="Family not found")
    state = (target_fam.get("rackets") or {}).get(request.racket_id) or {}
    level = state.get("level", 0)
    if level < 1:
        raise HTTPException(status_code=400, detail="Racket not active")
    lock = await _get_family_raid_lock(my_family_id, request.family_id)
    async with lock:
        window_start = datetime.now(timezone.utc) - timedelta(hours=FAMILY_RACKET_ATTACK_CREW_WINDOW_HOURS)
        raids_on_crew = await db.family_racket_attacks.count_documents({"attacker_family_id": my_family_id, "target_family_id": request.family_id, "last_at": {"$gte": window_start.isoformat()}})
        if raids_on_crew >= FAMILY_RACKET_ATTACK_MAX_PER_CREW:
            raise HTTPException(status_code=400, detail="Only 2 raids per family every 3 hours. You've used your raids on this crew.")
        ev = await get_effective_event()
        income_per, _ = _racket_income_and_cooldown(request.racket_id, level, ev)
        take = int(income_per * FAMILY_RACKET_ATTACK_REVENUE_PCT)
        success_chance = max(FAMILY_RACKET_ATTACK_MIN_SUCCESS, FAMILY_RACKET_ATTACK_BASE_SUCCESS - level * FAMILY_RACKET_ATTACK_LEVEL_PENALTY)
        success = random.random() < success_chance
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.family_racket_attacks.insert_one({"attacker_family_id": my_family_id, "target_family_id": request.family_id, "target_racket_id": request.racket_id, "last_at": now_iso})
        r_def = next((x for x in FAMILY_RACKETS if x["id"] == request.racket_id), None)
        racket_name = r_def["name"] if r_def else request.racket_id
        family_name = target_fam.get("name") or "Enemy"
        if success and take > 0:
            treasury = int((target_fam.get("treasury") or 0) or 0)
            actual = min(take, treasury)
            if actual > 0:
                await db.families.update_one({"id": request.family_id}, {"$inc": {"treasury": -actual}})
                await db.families.update_one({"id": my_family_id}, {"$inc": {"treasury": actual}})
            msg = random.choice(FAMILY_RACKET_RAID_SUCCESS_MESSAGES).format(amount=actual, family_name=family_name, racket_name=racket_name)
            return {"success": True, "message": msg, "amount": actual}
        fail_msg = random.choice(FAMILY_RACKET_RAID_FAIL_MESSAGES).format(family_name=family_name, racket_name=racket_name)
        return {"success": False, "message": fail_msg, "amount": 0}


async def families_war_stats(current_user: dict = Depends(get_current_user)):
    my_family_id = current_user.get("family_id")
    if not my_family_id:
        return {"wars": []}
    wars = await db.family_wars.find({"$or": [{"family_a_id": my_family_id}, {"family_b_id": my_family_id}], "status": {"$in": ["active", "truce_offered"]}}, {"_id": 0}).to_list(10)
    out = []
    for w in wars:
        other_id = w["family_b_id"] if w["family_a_id"] == my_family_id else w["family_a_id"]
        other_fam = await db.families.find_one({"id": other_id}, {"_id": 0, "name": 1, "tag": 1})
        other_name = (other_fam or {}).get("name", "?")
        other_tag = (other_fam or {}).get("tag", "?")
        stats_docs = await db.family_war_stats.find({"war_id": w["id"]}, {"_id": 0}).to_list(200)
        by_user = {s["user_id"]: s for s in stats_docs}
        usernames = {}
        for uid in by_user:
            u = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1, "family_id": 1})
            usernames[uid] = (u or {}).get("username", "?")
            fid = (u or {}).get("family_id")
            if fid:
                f = await db.families.find_one({"id": fid}, {"_id": 0, "name": 1, "tag": 1})
            else:
                f = None
            by_user[uid]["family_id"] = fid
            by_user[uid]["family_name"] = (f or {}).get("name", "?")
            by_user[uid]["family_tag"] = (f or {}).get("tag", "?")
            by_user[uid]["username"] = usernames[uid]
            by_user[uid]["impact"] = (by_user[uid].get("kills") or 0) + (by_user[uid].get("bodyguard_kills") or 0)
        top_bg = sorted(by_user.values(), key=lambda x: (-(x.get("bodyguard_kills") or 0), x.get("username", "")))[:10]
        top_lost = sorted(by_user.values(), key=lambda x: (-(x.get("bodyguards_lost") or 0), x.get("username", "")))[:10]
        mvp = sorted(by_user.values(), key=lambda x: (-(x.get("impact") or 0), x.get("username", "")))[:10]
        top_killers = sorted(by_user.values(), key=lambda x: (-(x.get("kills") or 0), x.get("username", "")))[:10]
        family_totals = {}
        for fid in (w["family_a_id"], w["family_b_id"]):
            members = [e for e in by_user.values() if e.get("family_id") == fid]
            family_totals[fid] = {"kills": sum(e.get("kills") or 0 for e in members), "deaths": sum(e.get("deaths") or 0 for e in members), "bodyguard_kills": sum(e.get("bodyguard_kills") or 0 for e in members), "bodyguards_lost": sum(e.get("bodyguards_lost") or 0 for e in members)}
        my_totals = family_totals.get(my_family_id) or {"kills": 0, "deaths": 0, "bodyguard_kills": 0, "bodyguards_lost": 0}
        other_totals = family_totals.get(other_id) or {"kills": 0, "deaths": 0, "bodyguard_kills": 0, "bodyguards_lost": 0}
        out.append({"war": {"id": w["id"], "family_a_id": w["family_a_id"], "family_b_id": w["family_b_id"], "status": w["status"], "other_family_id": other_id, "other_family_name": other_name, "other_family_tag": other_tag, "truce_offered_by_family_id": w.get("truce_offered_by_family_id")}, "stats": {"my_family_totals": my_totals, "other_family_totals": other_totals, "top_bodyguard_killers": top_bg, "top_bodyguards_lost": top_lost, "top_killers": top_killers, "mvp": mvp}})
    return {"wars": out}


async def families_war_truce_offer(request: WarTruceRequest, current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Boss or Underboss can offer truce")
    war = await db.family_wars.find_one({"id": request.war_id}, {"_id": 0})
    if not war or war.get("status") != "active":
        raise HTTPException(status_code=404, detail="War not found or not active")
    if family_id not in (war["family_a_id"], war["family_b_id"]):
        raise HTTPException(status_code=403, detail="Not your war")
    await db.family_wars.update_one({"id": request.war_id}, {"$set": {"status": "truce_offered", "truce_offered_by_family_id": family_id}})
    await send_notification_to_family(war["family_a_id"] if war["family_b_id"] == family_id else war["family_b_id"], "Truce offered", "The enemy family has offered a truce. Boss or Underboss can accept.", "system")
    return {"message": "Truce offered"}


async def families_war_truce_accept(request: WarTruceRequest, current_user: dict = Depends(get_current_user)):
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Boss or Underboss can accept truce")
    war = await db.family_wars.find_one({"id": request.war_id}, {"_id": 0})
    if not war or war.get("status") != "truce_offered":
        raise HTTPException(status_code=404, detail="War not found or no truce offered")
    if family_id not in (war["family_a_id"], war["family_b_id"]):
        raise HTTPException(status_code=403, detail="Not your war")
    if war.get("truce_offered_by_family_id") == family_id:
        raise HTTPException(status_code=400, detail="You offered the truce; the other side must accept")
    now = datetime.now(timezone.utc).isoformat()
    await db.family_wars.update_one({"id": request.war_id}, {"$set": {"status": "truce", "ended_at": now}})
    await send_notification_to_family(war["family_a_id"], "🤝 Truce accepted", "The war has ended by truce.", "system")
    await send_notification_to_family(war["family_b_id"], "🤝 Truce accepted", "The war has ended by truce.", "system")
    return {"message": "Truce accepted. War ended."}


async def families_wars_history(current_user: dict = Depends(get_current_user)):
    wars = await db.family_wars.find({}, {"_id": 0}).sort("created_at", -1).limit(10).to_list(10)
    family_ids = set()
    for w in wars:
        family_ids.add(w.get("family_a_id"))
        family_ids.add(w.get("family_b_id"))
    family_map = {}
    if family_ids:
        for f in await db.families.find({"id": {"$in": list(family_ids)}}, {"_id": 0, "id": 1, "name": 1, "tag": 1}).to_list(20):
            family_map[f["id"]] = f
    out = []
    for w in wars:
        fa = family_map.get(w.get("family_a_id"), {})
        fb = family_map.get(w.get("family_b_id"), {})
        winner_id = w.get("winner_family_id")
        winner_fam = family_map.get(winner_id, {}) if winner_id else {}
        out.append({"id": w["id"], "family_a_id": w["family_a_id"], "family_b_id": w["family_b_id"], "family_a_name": fa.get("name", "?"), "family_a_tag": fa.get("tag", "?"), "family_b_name": fb.get("name", "?"), "family_b_tag": fb.get("tag", "?"), "status": w.get("status", "active"), "winner_family_id": winner_id, "winner_family_name": winner_fam.get("name", "?"), "ended_at": w.get("ended_at"), "prize_exclusive_cars": w.get("prize_exclusive_cars"), "prize_rackets": w.get("prize_rackets") or []})
    return {"wars": out}


def register(router):
    router.add_api_route("/families", families_list, methods=["GET"])
    router.add_api_route("/families/config", families_config, methods=["GET"])
    router.add_api_route("/families/my", families_my, methods=["GET"])
    router.add_api_route("/families/lookup", families_lookup, methods=["GET"])
    router.add_api_route("/families", families_create, methods=["POST"])
    router.add_api_route("/families/join", families_join, methods=["POST"])
    router.add_api_route("/families/leave", families_leave, methods=["POST"])
    router.add_api_route("/families/kick", families_kick, methods=["POST"])
    router.add_api_route("/families/assign-role", families_assign_role, methods=["POST"])
    router.add_api_route("/families/deposit", families_deposit, methods=["POST"])
    router.add_api_route("/families/withdraw", families_withdraw, methods=["POST"])
    router.add_api_route("/families/crew-oc/set-fee", families_crew_oc_set_fee, methods=["POST"])
    router.add_api_route("/families/crew-oc/advertise", families_crew_oc_advertise, methods=["POST"])
    router.add_api_route("/families/crew-oc/apply", families_crew_oc_apply, methods=["POST"])
    router.add_api_route("/families/crew-oc/applications", families_crew_oc_applications, methods=["GET"])
    router.add_api_route("/families/crew-oc/applications/{application_id}/accept", families_crew_oc_accept, methods=["POST"])
    router.add_api_route("/families/crew-oc/applications/{application_id}/reject", families_crew_oc_reject, methods=["POST"])
    router.add_api_route("/families/crew-oc/commit", families_crew_oc_commit, methods=["POST"])
    router.add_api_route("/families/rackets/{racket_id}/collect", families_racket_collect, methods=["POST"])
    router.add_api_route("/families/rackets/{racket_id}/unlock", families_racket_unlock, methods=["POST"])
    router.add_api_route("/families/rackets/{racket_id}/upgrade", families_racket_upgrade, methods=["POST"])
    router.add_api_route("/families/racket-attack-targets", families_racket_attack_targets, methods=["GET"])
    router.add_api_route("/families/attack-racket", families_attack_racket, methods=["POST"])
    router.add_api_route("/families/war/stats", families_war_stats, methods=["GET"])
    router.add_api_route("/families/war/truce/offer", families_war_truce_offer, methods=["POST"])
    router.add_api_route("/families/war/truce/accept", families_war_truce_accept, methods=["POST"])
    router.add_api_route("/families/wars/history", families_wars_history, methods=["GET"])
