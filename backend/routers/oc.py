# Organised Crime: team heists (Driver, Weapons, Explosives, Hacker), 4 job types, 6h/4h cooldown
from datetime import datetime, timezone, timedelta
from typing import Optional
import random
import re
import os
import sys
import logging
import uuid
from fastapi import Depends, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)


def _parse_iso_datetime(val):
    if val is None:
        return None
    if hasattr(val, "year"):
        return val
    s = str(val).strip().replace("Z", "+00:00")
    return datetime.fromisoformat(s)


_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend not in sys.path:
    sys.path.insert(0, _backend)
from server import db, get_current_user, get_effective_event, maybe_process_rank_up, send_notification

# Roles (team of 4)
OC_ROLES = [
    {"id": "driver", "name": "Driver"},
    {"id": "weapons", "name": "Weapons"},
    {"id": "explosives", "name": "Explosives"},
    {"id": "hacker", "name": "Hacker"},
]

# Setup cost paid by creator when running (so reward always exceeds cost even when split)
OC_SETUP_COST = 1_000_000

# Jobs: harder = better rewards, lower success chance. Cash = total pool on success (split by team).
# Every job reward > OC_SETUP_COST + max equipment cost (2M) so the run is always profitable on success.
OC_JOBS = [
    {"id": "country_bank", "name": "Country Bank", "success_rate": 0.65, "cash": 2_200_000, "rp": 120},
    {"id": "state_bank", "name": "State Bank", "success_rate": 0.50, "cash": 2_800_000, "rp": 280},
    {"id": "city_bank", "name": "City Bank", "success_rate": 0.35, "cash": 3_800_000, "rp": 560},
    {"id": "government_vault", "name": "Government Vault", "success_rate": 0.20, "cash": 5_500_000, "rp": 1100},
]

# Equipment (must match organised_crime EQUIPMENT_TIERS): used to boost success rate when running heist
OC_EQUIPMENT_BY_ID = {
    "basic": {"cost": 0, "success_bonus": 0.0},
    "upgraded": {"cost": 400_000, "success_bonus": 0.10},
    "professional": {"cost": 700_000, "success_bonus": 0.20},
    "elite": {"cost": 900_000, "success_bonus": 0.30},
    "master": {"cost": 1_000_000, "success_bonus": 0.40},
}

OC_COOLDOWN_HOURS = 6
OC_COOLDOWN_HOURS_REDUCED = 4
NPC_PAYOUT_MULTIPLIER = 0.35  # Each NPC gets 35% of a full share for total pool
OC_INVITE_EXPIRY_MINUTES = 5
ROLE_KEYS = ["driver", "weapons", "explosives", "hacker"]

# Store: one-time purchase to reduce heist cooldown from 6h to 4h
OC_TIMER_COST_POINTS = 300

# Varied success messages for team heist
OC_TEAM_HEIST_SUCCESS_MESSAGES = [
    "Heist successful! {job_name}.",
    "Clean score. {job_name}.",
    "The job went smooth. {job_name}.",
    "No heat. {job_name} — payout split.",
    "Done. {job_name}.",
    "Smooth run. {job_name}.",
    "The take is in. {job_name}.",
    "Heist successful. {job_name}.",
    "Score. {job_name}.",
    "You got away clean. {job_name}.",
]
# Varied failure messages for team heist (like crimes / GTA / jail / rackets)
OC_TEAM_HEIST_FAIL_MESSAGES = [
    "The heist failed. No rewards.",
    "No score — the job went sideways. No rewards.",
    "The crew came up empty. Heist failed.",
    "Wrong move. The take was a no-go. No rewards.",
    "Something blew up. Heist failed — no payout.",
    "The heat was too much. No rewards this time.",
    "Heist failed. The team got away clean but empty-handed.",
    "No dice. The job fell through. No rewards.",
    "The heist blew up. No payout.",
    "Clean getaway, but no score. No rewards.",
]


class OCExecuteRequest(BaseModel):
    job_id: str
    driver: str   # "self" | "npc" | user_id / username
    weapons: str
    explosives: str
    hacker: str
    driver_pct: int = 25
    weapons_pct: int = 25
    explosives_pct: int = 25
    hacker_pct: int = 25
    pending_heist_id: str | None = None  # when running from pending invites


class OCSendInvitesRequest(BaseModel):
    job_id: str
    driver: str
    weapons: str
    explosives: str
    hacker: str
    driver_pct: int = 25
    weapons_pct: int = 25
    explosives_pct: int = 25
    hacker_pct: int = 25


async def get_oc_config(current_user: dict = Depends(get_current_user)):
    """Return jobs and roles for Organised Crime."""
    return {"jobs": OC_JOBS, "roles": OC_ROLES}


async def buy_oc_timer(current_user: dict = Depends(get_current_user)):
    """Reduce Organised Crime heist cooldown from 6 hours to 4 hours. One-time purchase."""
    if current_user.get("oc_timer_reduced", False):
        raise HTTPException(status_code=400, detail="You already have the reduced OC timer (4h)")
    if (current_user.get("points") or 0) < OC_TIMER_COST_POINTS:
        raise HTTPException(status_code=400, detail=f"Insufficient points (need {OC_TIMER_COST_POINTS})")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -OC_TIMER_COST_POINTS}, "$set": {"oc_timer_reduced": True}},
    )
    return {"message": "OC timer reduced! Heist cooldown is now 4 hours.", "cost": OC_TIMER_COST_POINTS}


async def get_oc_status(current_user: dict = Depends(get_current_user)):
    """Return cooldown, timer upgrade, and pending heist/invites (creator)."""
    has_timer_upgrade = bool(current_user.get("oc_timer_reduced", False))
    cooldown_hours = OC_COOLDOWN_HOURS_REDUCED if has_timer_upgrade else OC_COOLDOWN_HOURS
    cooldown_until = current_user.get("oc_cooldown_until")
    now = datetime.now(timezone.utc)
    if cooldown_until:
        until = _parse_iso_datetime(cooldown_until)
        if until and until <= now:
            cooldown_until = None
    out = {
        "cooldown_until": cooldown_until,
        "cooldown_hours": cooldown_hours,
        "has_timer_upgrade": has_timer_upgrade,
        "pending_heist": None,
        "pending_invites": [],
    }
    # Creator's pending heist (one per user)
    pending = await db.oc_pending_heists.find_one(
        {"creator_id": current_user["id"]},
        {"_id": 0}
    )
    if pending:
        out["pending_heist"] = {
            "id": pending["id"],
            "job_id": pending["job_id"],
            "driver": pending.get("driver"),
            "weapons": pending.get("weapons"),
            "explosives": pending.get("explosives"),
            "hacker": pending.get("hacker"),
            "driver_pct": pending.get("driver_pct", 25),
            "weapons_pct": pending.get("weapons_pct", 25),
            "explosives_pct": pending.get("explosives_pct", 25),
            "hacker_pct": pending.get("hacker_pct", 25),
        }
        invites = await db.oc_invites.find(
            {"pending_heist_id": pending["id"]},
            {"_id": 0, "id": 1, "role": 1, "target_username": 1, "status": 1, "expires_at": 1}
        ).to_list(10)
        for inv in invites:
            exp = inv.get("expires_at")
            if exp:
                try:
                    exp_dt = _parse_iso_datetime(exp)
                    if exp_dt and exp_dt <= now and inv.get("status") == "pending":
                        await db.oc_invites.update_one({"id": inv["id"]}, {"$set": {"status": "expired"}})
                        inv["status"] = "expired"
                except Exception:
                    pass
            out["pending_invites"].append({
                "invite_id": inv["id"],
                "role": inv.get("role"),
                "target_username": inv.get("target_username"),
                "status": inv.get("status", "pending"),
                "expires_at": inv.get("expires_at"),
            })
    return out


async def _resolve_slot(slot: str, current_user_id: str) -> str | None:
    """Return user_id or None for NPC. Accepts 'self', 'npc', or username/id."""
    s = (slot or "").strip()
    if not s or s.lower() == "npc":
        return None
    if s.lower() == "self":
        return current_user_id
    u = await db.users.find_one(
        {"$or": [{"username": s}, {"id": s}]},
        {"_id": 0, "id": 1},
    )
    return u["id"] if u else None


def _slot_is_invite(slot_val: str, uid: str) -> bool:
    """True if slot is another user (username), not self or npc."""
    s = (slot_val or "").strip().lower()
    if not s or s == "npc" or s == "self":
        return False
    return True


async def send_invites_oc(
    request: OCSendInvitesRequest,
    current_user: dict = Depends(get_current_user),
):
    """Create a pending heist and send inbox invites to each invited player. They must accept in inbox."""
    job = next((j for j in OC_JOBS if j["id"] == request.job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Invalid job")
    uid = current_user["id"]
    pcts = [request.driver_pct, request.weapons_pct, request.explosives_pct, request.hacker_pct]
    if sum(pcts) != 100 or any(p < 0 or p > 100 for p in pcts):
        raise HTTPException(status_code=400, detail="Percentages must be 0–100 and sum to 100")
    slots_raw = [request.driver, request.weapons, request.explosives, request.hacker]
    if not any((s or "").strip().lower() == "self" for s in slots_raw):
        raise HTTPException(status_code=400, detail="You must fill at least one slot (self)")
    # Require at least one invite slot
    invite_slots = []
    for i, role in enumerate(ROLE_KEYS):
        val = (slots_raw[i] or "").strip()
        if _slot_is_invite(val, uid):
            invite_slots.append((role, val))
    if not invite_slots:
        raise HTTPException(status_code=400, detail="No invite slots: add at least one username to invite")
    # Resolve usernames to user_ids and validate
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(minutes=OC_INVITE_EXPIRY_MINUTES)).isoformat()
    # If creator already has a pending heist, remove it (replace with new one)
    await db.oc_pending_heists.delete_many({"creator_id": uid})
    await db.oc_invites.delete_many({"creator_id": uid})
    pending_id = str(uuid.uuid4())
    doc = {
        "id": pending_id,
        "creator_id": uid,
        "job_id": request.job_id,
        "driver": (request.driver or "").strip() or None,
        "weapons": (request.weapons or "").strip() or None,
        "explosives": (request.explosives or "").strip() or None,
        "hacker": (request.hacker or "").strip() or None,
        "driver_pct": request.driver_pct,
        "weapons_pct": request.weapons_pct,
        "explosives_pct": request.explosives_pct,
        "hacker_pct": request.hacker_pct,
        "created_at": now.isoformat(),
    }
    await db.oc_pending_heists.insert_one(doc)
    job_name = job["name"]
    creator_username = current_user.get("username") or "Someone"
    invites_out = []
    for role, username in invite_slots:
        uname = (username or "").strip()
        username_ci = re.compile("^" + re.escape(uname) + "$", re.IGNORECASE) if uname else None
        criteria = [{"id": username}]
        if username_ci:
            criteria.append({"username": username_ci})
        target = await db.users.find_one(
            {"$or": criteria},
            {"_id": 0, "id": 1, "username": 1, "is_dead": 1},
        )
        if not target:
            await db.oc_pending_heists.delete_many({"id": pending_id})
            await db.oc_invites.delete_many({"pending_heist_id": pending_id})
            raise HTTPException(status_code=400, detail=f"User not found: {username}")
        if target.get("is_dead"):
            await db.oc_pending_heists.delete_many({"id": pending_id})
            await db.oc_invites.delete_many({"pending_heist_id": pending_id})
            raise HTTPException(status_code=400, detail="Cannot invite dead players")
        target_id = target["id"]
        invite_id = str(uuid.uuid4())
        await db.oc_invites.insert_one({
            "id": invite_id,
            "pending_heist_id": pending_id,
            "creator_id": uid,
            "creator_username": creator_username,
            "role": role,
            "target_id": target_id,
            "target_username": target.get("username") or username,
            "status": "pending",
            "created_at": now.isoformat(),
            "expires_at": expires_at,
        })
        role_name = role.replace("_", " ").capitalize()
        msg = f"{creator_username} invited you to an Organised Crime heist as {role_name} ({job_name}). Accept or decline in your inbox. Expires in {OC_INVITE_EXPIRY_MINUTES} min."
        await send_notification(
            target_id,
            "OC Heist invite",
            msg,
            "system",
            category="oc_invites",
            oc_invite_id=invite_id,
            oc_role=role,
            oc_job_name=job_name,
        )
        invites_out.append({"role": role, "target_username": target.get("username"), "invite_id": invite_id, "expires_at": expires_at})
    return {
        "status": "pending_invites",
        "message": "Invites sent. Check status; run heist when all have accepted or clear slots.",
        "pending_heist_id": pending_id,
        "invites": invites_out,
    }


async def oc_invite_accept(invite_id: str, current_user: dict = Depends(get_current_user)):
    """Invited user accepts the OC invite."""
    inv = await db.oc_invites.find_one({"id": invite_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invite not found")
    if inv.get("target_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not your invite")
    if inv.get("status") != "pending":
        raise HTTPException(status_code=400, detail=f"Invite already {inv.get('status')}")
    now = datetime.now(timezone.utc)
    exp = _parse_iso_datetime(inv.get("expires_at"))
    if exp and exp <= now:
        await db.oc_invites.update_one({"id": invite_id}, {"$set": {"status": "expired"}})
        raise HTTPException(status_code=400, detail="Invite expired")
    await db.oc_invites.update_one({"id": invite_id}, {"$set": {"status": "accepted"}})
    return {"message": "You accepted the heist invite. The creator can run the heist when everyone has accepted."}


async def oc_invite_decline(invite_id: str, current_user: dict = Depends(get_current_user)):
    """Invited user declines the OC invite."""
    inv = await db.oc_invites.find_one({"id": invite_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invite not found")
    if inv.get("target_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not your invite")
    if inv.get("status") != "pending":
        raise HTTPException(status_code=400, detail=f"Invite already {inv.get('status')}")
    await db.oc_invites.update_one({"id": invite_id}, {"$set": {"status": "declined"}})
    return {"message": "You declined the heist invite."}


async def oc_invite_cancel(invite_id: str, current_user: dict = Depends(get_current_user)):
    """Creator cancels an invite and clears that slot (so they can re-invite or use NPC)."""
    inv = await db.oc_invites.find_one({"id": invite_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invite not found")
    if inv.get("creator_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not your invite")
    if inv.get("status") not in ("pending", "expired"):
        raise HTTPException(status_code=400, detail="Can only cancel pending or expired invites")
    role = inv.get("role")
    pending_id = inv.get("pending_heist_id")
    await db.oc_invites.update_one({"id": invite_id}, {"$set": {"status": "cancelled"}})
    if pending_id and role:
        await db.oc_pending_heists.update_one(
            {"id": pending_id},
            {"$set": {role: None}},
        )
    return {"message": "Invite cancelled. You can assign someone else or use NPC for that slot."}


class OCPendingSlotRequest(BaseModel):
    role: str  # driver, weapons, explosives, hacker
    value: str  # "npc" or username to invite


async def oc_pending_set_slot(
    request: OCPendingSlotRequest,
    current_user: dict = Depends(get_current_user),
):
    """After clearing an invite, set a slot to NPC or send a new invite (username)."""
    if request.role not in ROLE_KEYS:
        raise HTTPException(status_code=400, detail="Invalid role")
    pending = await db.oc_pending_heists.find_one({"creator_id": current_user["id"]}, {"_id": 0})
    if not pending:
        raise HTTPException(status_code=400, detail="No pending heist. Send invites first.")
    val = (request.value or "").strip()
    if not val:
        raise HTTPException(status_code=400, detail="Set value to 'npc' or a username")
    if val.lower() == "npc":
        await db.oc_pending_heists.update_one(
            {"id": pending["id"]},
            {"$set": {request.role: "npc"}},
        )
        return {"message": f"{request.role} set to NPC."}
    # New invite
    target = await db.users.find_one(
        {"$or": [{"username": val}, {"id": val}]},
        {"_id": 0, "id": 1, "username": 1, "is_dead": 1},
    )
    if not target:
        raise HTTPException(status_code=400, detail=f"User not found: {val}")
    if target.get("is_dead"):
        raise HTTPException(status_code=400, detail="Cannot invite dead players")
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(minutes=OC_INVITE_EXPIRY_MINUTES)).isoformat()
    invite_id = str(uuid.uuid4())
    job = next((j for j in OC_JOBS if j["id"] == pending["job_id"]), None)
    job_name = job["name"] if job else "Heist"
    await db.oc_invites.insert_one({
        "id": invite_id,
        "pending_heist_id": pending["id"],
        "creator_id": current_user["id"],
        "creator_username": current_user.get("username") or "Someone",
        "role": request.role,
        "target_id": target["id"],
        "target_username": target.get("username") or val,
        "status": "pending",
        "created_at": now.isoformat(),
        "expires_at": expires_at,
    })
    await db.oc_pending_heists.update_one(
        {"id": pending["id"]},
        {"$set": {request.role: target.get("username") or val}},
    )
    await send_notification(
        target["id"],
        "OC Heist invite",
        f"{current_user.get('username') or 'Someone'} invited you to an Organised Crime heist as {request.role.replace('_', ' ').capitalize()} ({job_name}). Accept or decline in your inbox. Expires in {OC_INVITE_EXPIRY_MINUTES} min.",
        "system",
        category="oc_invites",
        oc_invite_id=invite_id,
        oc_role=request.role,
        oc_job_name=job_name,
    )
    return {"message": f"Invite sent to {target.get('username') or val}.", "invite_id": invite_id}


async def _execute_oc_heist_core(uid: str, job: dict, resolved: list, pcts: list) -> dict:
    """Run one OC heist: cooldown check, charge, roll, set cooldown, apply rewards. Caller must have validated job and resolved. Returns result dict."""
    now = datetime.now(timezone.utc)
    current_user = await db.users.find_one({"id": uid}, {"_id": 0})
    if not current_user:
        return {"success": False, "message": "User not found", "cooldown_until": None}
    has_timer_upgrade = bool(current_user.get("oc_timer_reduced", False))
    cooldown_hours = OC_COOLDOWN_HOURS_REDUCED if has_timer_upgrade else OC_COOLDOWN_HOURS
    cooldown_until = current_user.get("oc_cooldown_until")
    if cooldown_until:
        until = _parse_iso_datetime(cooldown_until)
        if until and until > now:
            secs = int((until - now).total_seconds())
            return {"success": False, "message": f"OC cooldown: try again in {secs}s", "cooldown_until": cooldown_until}
    user_oc = await db.user_organised_crime.find_one({"user_id": uid}, {"_id": 0, "selected_equipment": 1})
    selected_id = (user_oc or {}).get("selected_equipment", "basic")
    equip = OC_EQUIPMENT_BY_ID.get(selected_id, OC_EQUIPMENT_BY_ID["basic"])
    total_cost = OC_SETUP_COST + equip["cost"]
    creator_money = int(current_user.get("money") or 0)
    if creator_money < total_cost:
        return {
            "success": False,
            "message": f"Not enough money. Need ${total_cost:,}",
            "cooldown_until": None,
            "skipped_afford": True,
        }
    await db.users.update_one({"id": uid}, {"$inc": {"money": -total_cost}})
    ev = await get_effective_event()
    rank_mult = float(ev.get("rank_points", 1.0))
    cash_mult = float(ev.get("kill_cash", 1.0))
    success_rate = min(0.92, job["success_rate"] + equip["success_bonus"])
    success = random.random() < success_rate
    new_cooldown_until = now + timedelta(hours=cooldown_hours)
    await db.users.update_one(
        {"id": uid},
        {"$set": {"oc_cooldown_until": new_cooldown_until.isoformat()}},
    )
    if not success:
        return {
            "success": False,
            "message": random.choice(OC_TEAM_HEIST_FAIL_MESSAGES),
            "cooldown_until": new_cooldown_until.isoformat(),
        }
    user_ids = [r for r in resolved if r is not None]
    num_humans = len(user_ids)
    num_npcs = 4 - num_humans
    total_shares = num_humans * 1.0 + num_npcs * NPC_PAYOUT_MULTIPLIER
    cash_pool = int(job["cash"] * (total_shares / 4.0) * cash_mult)
    rp_pool = int(job["rp"] * (total_shares / 4.0) * rank_mult)
    # Prestige bonus: boost OC cash payout for the initiating user
    from server import get_prestige_bonus
    _prestige_user = await db.users.find_one({"id": uid}, {"_id": 0, "prestige_level": 1})
    _oc_mult = get_prestige_bonus(_prestige_user or {})["oc_mult"]
    cash_pool = int(cash_pool * _oc_mult)
    user_map = {}
    if user_ids:
        users_raw = await db.users.find(
            {"id": {"$in": user_ids}},
            {"_id": 0, "id": 1, "rank_points": 1, "username": 1},
        ).to_list(10)
        user_map = {u["id"]: u for u in users_raw}
    cash_each = rp_each = 0
    for i, user_id in enumerate(resolved):
        pct = pcts[i]
        cash_add = int(cash_pool * pct / 100)
        rp_add = int(rp_pool * pct / 100)
        if user_id is None:
            cash_each += cash_add
            rp_each += rp_add
            continue
        if user_id == uid:
            cash_each += cash_add
            rp_each += rp_add
        rp_before = int((user_map.get(user_id) or {}).get("rank_points") or 0)
        await db.users.update_one(
            {"id": user_id},
            {"$inc": {"money": cash_add, "rank_points": rp_add, "total_oc_heists": 1}},
        )
        if rp_add > 0:
            try:
                await maybe_process_rank_up(
                    user_id,
                    rp_before,
                    rp_add,
                    (user_map.get(user_id) or {}).get("username", ""),
                )
            except Exception as e:
                logger.exception("Rank-up notification (team OC): %s", e)
    msg = random.choice(OC_TEAM_HEIST_SUCCESS_MESSAGES).format(job_name=job["name"])
    return {
        "success": True,
        "message": msg,
        "cash_earned": cash_each,
        "rp_earned": rp_each,
        "cooldown_until": new_cooldown_until.isoformat(),
    }


async def run_oc_heist_npc_only(user_id: str, selected_equipment_override: Optional[str] = None) -> dict:
    """Run one OC heist with self + 3 NPCs if timer is ready and user can afford a job. For Auto Rank. Returns {ran, success, message, cooldown_until, skipped_afford}. When selected_equipment_override is set (e.g. from OC loop), skip user_organised_crime lookup."""
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "id": 1, "oc_cooldown_until": 1, "money": 1, "oc_timer_reduced": 1},
    )
    if not user:
        return {"ran": False, "success": False, "message": "User not found", "skipped_afford": False}
    now = datetime.now(timezone.utc)
    cooldown_until = user.get("oc_cooldown_until")
    if cooldown_until:
        until = _parse_iso_datetime(cooldown_until)
        if until and until > now:
            return {"ran": False, "success": False, "message": "Cooldown active", "cooldown_until": cooldown_until, "skipped_afford": False}
    if selected_equipment_override is not None:
        selected_id = selected_equipment_override
    else:
        user_oc = await db.user_organised_crime.find_one({"user_id": user_id}, {"_id": 0, "selected_equipment": 1})
        selected_id = (user_oc or {}).get("selected_equipment", "basic")
    equip = OC_EQUIPMENT_BY_ID.get(selected_id, OC_EQUIPMENT_BY_ID["basic"])
    money = int(user.get("money") or 0)
    best_job = None
    for job in reversed(OC_JOBS):
        total_cost = OC_SETUP_COST + equip["cost"]
        if money >= total_cost:
            best_job = job
            break
    if not best_job:
        return {"ran": False, "success": False, "message": "Cannot afford any job", "skipped_afford": True}
    resolved = [user_id, None, None, None]
    pcts = [25, 25, 25, 25]
    result = await _execute_oc_heist_core(user_id, best_job, resolved, pcts)
    if result.get("skipped_afford"):
        return {"ran": False, "success": False, "message": result.get("message", "Cannot afford"), "skipped_afford": True}
    return {
        "ran": True,
        "success": result.get("success", False),
        "message": result.get("message", ""),
        "cooldown_until": result.get("cooldown_until"),
        "skipped_afford": False,
    }


async def execute_oc(
    request: OCExecuteRequest,
    current_user: dict = Depends(get_current_user),
):
    """Run an Organised Crime heist. Use pending_heist_id when running after invites accepted; else slots must be self/npc only."""
    uid = current_user["id"]
    now = datetime.now(timezone.utc)
    job_id = request.job_id
    pcts = [request.driver_pct, request.weapons_pct, request.explosives_pct, request.hacker_pct]
    slots_raw = [request.driver, request.weapons, request.explosives, request.hacker]
    resolved = None

    if request.pending_heist_id:
        # Run from pending heist; unaccepted invite slots are treated as NPC (auto-join)
        pending = await db.oc_pending_heists.find_one({"id": request.pending_heist_id, "creator_id": uid}, {"_id": 0})
        if not pending:
            raise HTTPException(status_code=404, detail="Pending heist not found")
        job_id = pending["job_id"]
        pcts = [pending.get("driver_pct", 25), pending.get("weapons_pct", 25), pending.get("explosives_pct", 25), pending.get("hacker_pct", 25)]
        resolved = [None, None, None, None]
        for i, role in enumerate(ROLE_KEYS):
            val = (pending.get(role) or "").strip() if isinstance(pending.get(role), str) else None
            if not val:
                raise HTTPException(status_code=400, detail=f"Slot {role} is empty. Clear expired invites or assign NPC.")
            if (val or "").lower() == "self":
                resolved[i] = uid
            elif (val or "").lower() == "npc":
                resolved[i] = None
            else:
                inv = await db.oc_invites.find_one({"pending_heist_id": request.pending_heist_id, "role": role}, {"_id": 0})
                if inv and inv.get("status") == "accepted":
                    resolved[i] = inv.get("target_id")
                else:
                    resolved[i] = None  # Unaccepted invite = treat as NPC (auto-join)
        job = next((j for j in OC_JOBS if j["id"] == job_id), None)
        if not job:
            raise HTTPException(status_code=404, detail="Invalid job")
        # Consume pending heist
        await db.oc_pending_heists.delete_one({"id": request.pending_heist_id})
        await db.oc_invites.delete_many({"pending_heist_id": request.pending_heist_id})
    else:
        # Immediate run: no usernames allowed (must use send-invites first)
        job = next((j for j in OC_JOBS if j["id"] == job_id), None)
        if not job:
            raise HTTPException(status_code=404, detail="Invalid job")
        if sum(pcts) != 100 or any(p < 0 or p > 100 for p in pcts):
            raise HTTPException(status_code=400, detail="Percentages must be 0–100 and sum to 100")
        for s in slots_raw:
            if _slot_is_invite(s, uid):
                raise HTTPException(status_code=400, detail="You invited a player. Use Send invites, then Run heist when they accept (or clear the slot).")
        resolved = []
        for s in slots_raw:
            r = await _resolve_slot(s, uid)
            resolved.append(r)
        if not any(r == uid for r in resolved):
            raise HTTPException(status_code=400, detail="You must fill at least one slot (use 'self')")
        for i, r in enumerate(resolved):
            slot_val = (slots_raw[i] or "").strip().lower()
            if r is None:
                if slot_val not in ("", "npc"):
                    raise HTTPException(status_code=400, detail=f"User not found: {slots_raw[i]}")
                continue
            if r != uid:
                other = await db.users.find_one({"id": r}, {"_id": 0, "id": 1, "is_dead": 1})
                if not other:
                    raise HTTPException(status_code=400, detail=f"User not found: {slots_raw[i]}")
                if other.get("is_dead"):
                    raise HTTPException(status_code=400, detail="Cannot include dead players")

    result = await _execute_oc_heist_core(uid, job, resolved, pcts)
    if result.get("skipped_afford"):
        raise HTTPException(status_code=400, detail=result.get("message", "Not enough money"))
    if not result.get("success") and result.get("cooldown_until") and "cooldown" in (result.get("message") or ""):
        raise HTTPException(status_code=400, detail=result.get("message", "OC cooldown"))
    out = {"success": result.get("success", False), "message": result.get("message", ""), "cooldown_until": result.get("cooldown_until")}
    if result.get("success"):
        out["cash_earned"] = result.get("cash_earned", 0)
        out["rp_earned"] = result.get("rp_earned", 0)
    return out


def register(router):
    router.add_api_route("/oc/config", get_oc_config, methods=["GET"])
    router.add_api_route("/store/buy-oc-timer", buy_oc_timer, methods=["POST"])
    router.add_api_route("/oc/status", get_oc_status, methods=["GET"])
    router.add_api_route("/oc/send-invites", send_invites_oc, methods=["POST"])
    router.add_api_route("/oc/invite/{invite_id}/accept", oc_invite_accept, methods=["POST"])
    router.add_api_route("/oc/invite/{invite_id}/decline", oc_invite_decline, methods=["POST"])
    router.add_api_route("/oc/invite/{invite_id}/cancel", oc_invite_cancel, methods=["POST"])
    router.add_api_route("/oc/pending/set-slot", oc_pending_set_slot, methods=["POST"])
    router.add_api_route("/oc/execute", execute_oc, methods=["POST"])
