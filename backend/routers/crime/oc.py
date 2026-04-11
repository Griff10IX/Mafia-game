# Organised Crime: team heists (Driver, Weapons, Explosives, Inside Man), 4 job types, 6h/4h cooldown
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict
import secrets
_rng = secrets.SystemRandom()
import re
import os
import sys
import logging
import uuid
from fastapi import Depends, HTTPException
from pydantic import BaseModel

from utils.referral_ids import (
    apply_referrer_referral_increment,
    normalize_referred_by_ids,
    referral_pool_int,
    split_referral_pool,
)

logger = logging.getLogger(__name__)


def _parse_iso_datetime(val):
    if val is None:
        return None
    if hasattr(val, "year"):
        if val.tzinfo is None:
            return val.replace(tzinfo=timezone.utc)
        return val
    try:
        s = str(val).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend not in sys.path:
    sys.path.insert(0, _backend)
from server import db, get_current_user, get_effective_event, log_activity, maybe_process_rank_up, send_notification, user_prestige_rank_mult
from utils.point_provenance import log_points_event

# Roles (team of 4)
OC_ROLES = [
    {"id": "driver", "name": "Driver"},
    {"id": "weapons", "name": "Weapons"},
    {"id": "explosives", "name": "Explosives"},
    {"id": "hacker", "name": "Inside Man"},
]

# Setup cost paid by creator when running (equipment is the only cost now)
OC_SETUP_COST = 0

# Organised crime: 50% success; rest is fail or jail.
OC_SUCCESS_RATE = 0.50
OC_JAIL_CHANCE_ON_FAIL = 0.50
OC_JAIL_SECONDS_TEAM = 60  # Creator goes to jail on failed/jail outcome

# Jobs: cash = total pool on success (split by team). Success chance is fixed 50%.
# Reduced for beta
OC_JOBS = [
    {"id": "country_bank", "name": "Country Bank", "success_rate": 0.50, "cash": 137_500, "rp": 120},
    {"id": "state_bank", "name": "State Bank", "success_rate": 0.50, "cash": 175_000, "rp": 280},
    {"id": "city_bank", "name": "City Bank", "success_rate": 0.50, "cash": 237_500, "rp": 560},
    {"id": "government_vault", "name": "Government Vault", "success_rate": 0.50, "cash": 343_750, "rp": 1100},
]

# Equipment (must match organised_crime EQUIPMENT_TIERS): used to boost success rate when running heist
OC_EQUIPMENT_BY_ID = {
    "basic": {"cost": 0, "success_bonus": 0.0},
    "upgraded": {"cost": 25_000, "success_bonus": 0.10},
    "professional": {"cost": 43_750, "success_bonus": 0.20},
    "elite": {"cost": 56_250, "success_bonus": 0.30},
    "master": {"cost": 62_500, "success_bonus": 0.40},
}

OC_COOLDOWN_HOURS = 6
OC_COOLDOWN_HOURS_REDUCED = 4
NPC_PAYOUT_MULTIPLIER = 0.35  # Each NPC gets 35% of a full share for total pool
OC_INVITE_EXPIRY_MINUTES = 5
ROLE_KEYS = ["driver", "weapons", "explosives", "hacker"]


def _oc_role_display_name(role_id: str) -> str:
    """Human-readable role label for notifications (e.g. hacker → Inside Man)."""
    rid = (role_id or "").strip()
    for r in OC_ROLES:
        if r.get("id") == rid:
            return str(r.get("name") or rid)
    return rid.replace("_", " ").title() if rid else ""


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
    "Like clockwork. {job_name}.",
    "The vault was yours. {job_name}.",
    "Nobody saw a thing. {job_name}.",
    "Perfect execution. {job_name}.",
    "The crew delivered. {job_name}.",
]
# Varied failure messages (escaped, no jail)
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
    "Inside man didn't show. You called it off and slipped away.",
    "Too many eyes. You aborted and disappeared.",
    "Alarm went early. You ran with nothing.",
    "Double-crossed. You got out with your life, not the cash.",
]
# Varied jail messages (caught)
OC_TEAM_HEIST_JAIL_MESSAGES = [
    "Heist failed and you got caught! {jail_time}s jail (unbreakable 60s).",
    "Busted! The heat was waiting. {jail_time}s in the slammer (unbreakable 60s).",
    "No getaway. They threw the book at you — {jail_time}s jail (unbreakable 60s).",
    "The job blew up. You're in the can for {jail_time}s (unbreakable 60s).",
    "They had the block covered. {jail_time}s in lockup (unbreakable 60s).",
    "The feds were onto you. Enjoy {jail_time}s in the clink (unbreakable 60s).",
    "Someone talked. {jail_time}s in the pen (unbreakable 60s).",
    "Cops were already there. {jail_time}s jail (unbreakable 60s).",
    "Alarm tripped — no way out. {jail_time}s behind bars (unbreakable 60s).",
    "Getaway car didn't start. {jail_time}s in lockup (unbreakable 60s).",
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
    user_oc = await db.user_organised_crime.find_one({"user_id": current_user["id"]}, {"_id": 0, "selected_equipment": 1})
    selected_id = (user_oc or {}).get("selected_equipment", "basic")
    equip = OC_EQUIPMENT_BY_ID.get(selected_id, OC_EQUIPMENT_BY_ID["basic"])
    equip_cost = equip["cost"]
    oc_reduced = _oc_reduced_active(current_user)
    jobs_out = []
    for j in OC_JOBS:
        total = OC_SETUP_COST + equip_cost
        if oc_reduced:
            total = int(total * 0.8)
        jobs_out.append({**j, "setup_cost": OC_SETUP_COST, "total_cost": total})
    return {"jobs": jobs_out, "roles": OC_ROLES, "setup_cost": OC_SETUP_COST, "equipment_cost": equip_cost}


async def buy_oc_timer(current_user: dict = Depends(get_current_user)):
    """Reduce Organised Crime heist cooldown from 6 hours to 4 hours. One-time purchase."""
    if current_user.get("oc_timer_reduced", False):
        raise HTTPException(status_code=400, detail="You already have the reduced OC timer (4h)")
    oc_result = await db.users.update_one(
        {"id": current_user["id"], "points": {"$gte": OC_TIMER_COST_POINTS}},
        {"$inc": {"points": -OC_TIMER_COST_POINTS}, "$set": {"oc_timer_reduced": True}},
    )
    if oc_result.modified_count == 0:
        raise HTTPException(status_code=400, detail=f"Insufficient points (need {OC_TIMER_COST_POINTS})")
    await log_points_event(db, user_id=current_user["id"], points=-OC_TIMER_COST_POINTS, event_type="oc_timer_skip", event_ref=current_user["id"], meta={})
    return {"message": "OC timer reduced! Heist cooldown is now 4 hours.", "cost": OC_TIMER_COST_POINTS}


def _oc_reduced_active(user: dict) -> bool:
    """True if oc_reduced token is active (shorter cooldown, lower setup cost, higher payout)."""
    until_raw = user.get("oc_reduced_until")
    if not until_raw:
        return False
    until = _parse_iso_datetime(until_raw)
    return until is not None and datetime.now(timezone.utc) < until


async def get_oc_status(current_user: dict = Depends(get_current_user)):
    """Return cooldown, timer upgrade, and pending heist/invites (creator)."""
    has_timer_upgrade = bool(current_user.get("oc_timer_reduced", False))
    oc_reduced = _oc_reduced_active(current_user)
    cooldown_hours = OC_COOLDOWN_HOURS_REDUCED if (has_timer_upgrade or oc_reduced) else OC_COOLDOWN_HOURS
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
        "total_oc_heists": int(current_user.get("total_oc_heists") or 0),
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
        invite_ids_to_expire = []
        for inv in invites:
            exp = inv.get("expires_at")
            if exp:
                try:
                    exp_dt = _parse_iso_datetime(exp)
                    if exp_dt and exp_dt <= now and inv.get("status") == "pending":
                        invite_ids_to_expire.append(inv["id"])
                except Exception:
                    pass
        if invite_ids_to_expire:
            await db.oc_invites.update_many(
                {"id": {"$in": invite_ids_to_expire}},
                {"$set": {"status": "expired"}},
            )
            expired_set = set(invite_ids_to_expire)
            for inv in invites:
                if inv.get("id") in expired_set:
                    inv["status"] = "expired"
        for inv in invites:
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
        role_name = _oc_role_display_name(role)
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
    now = datetime.now(timezone.utc)
    exp = _parse_iso_datetime(inv.get("expires_at"))
    if exp and exp <= now:
        await db.oc_invites.update_one({"id": invite_id}, {"$set": {"status": "expired"}})
        raise HTTPException(status_code=400, detail="Invite expired")
    res = await db.oc_invites.update_one(
        {"id": invite_id, "target_id": current_user["id"], "status": "pending"},
        {"$set": {"status": "accepted"}},
    )
    if res.modified_count == 0:
        latest = await db.oc_invites.find_one({"id": invite_id}, {"_id": 0, "status": 1})
        raise HTTPException(status_code=400, detail=f"Invite already {(latest or {}).get('status', 'updated')}")
    await log_activity(current_user["id"], current_user.get("username", "?"), "oc_invite_accept", {"invite_id": invite_id})
    return {"message": "You accepted the heist invite. The creator can run the heist when everyone has accepted."}


async def oc_invite_decline(invite_id: str, current_user: dict = Depends(get_current_user)):
    """Invited user declines the OC invite."""
    inv = await db.oc_invites.find_one({"id": invite_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invite not found")
    if inv.get("target_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not your invite")
    res = await db.oc_invites.update_one(
        {"id": invite_id, "target_id": current_user["id"], "status": "pending"},
        {"$set": {"status": "declined"}},
    )
    if res.modified_count == 0:
        latest = await db.oc_invites.find_one({"id": invite_id}, {"_id": 0, "status": 1})
        raise HTTPException(status_code=400, detail=f"Invite already {(latest or {}).get('status', 'updated')}")
    await log_activity(current_user["id"], current_user.get("username", "?"), "oc_invite_decline", {"invite_id": invite_id})
    return {"message": "You declined the heist invite."}


async def oc_invite_cancel(invite_id: str, current_user: dict = Depends(get_current_user)):
    """Creator cancels an invite and clears that slot (so they can re-invite or use NPC)."""
    inv = await db.oc_invites.find_one({"id": invite_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invite not found")
    if inv.get("creator_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not your invite")
    role = inv.get("role")
    pending_id = inv.get("pending_heist_id")
    res = await db.oc_invites.update_one(
        {"id": invite_id, "creator_id": current_user["id"], "status": {"$in": ["pending", "expired"]}},
        {"$set": {"status": "cancelled"}},
    )
    if res.modified_count == 0:
        latest = await db.oc_invites.find_one({"id": invite_id}, {"_id": 0, "status": 1})
        raise HTTPException(status_code=400, detail=f"Can only cancel pending/expired invites (current: {(latest or {}).get('status', 'unknown')})")
    if pending_id and role:
        await db.oc_pending_heists.update_one(
            {"id": pending_id},
            {"$set": {role: None}},
        )
    return {"message": "Invite cancelled. You can assign someone else or use NPC for that slot."}


class OCPendingSlotRequest(BaseModel):
    role: str  # driver, weapons, explosives, hacker (display: Inside Man)
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
        return {"message": f"{_oc_role_display_name(request.role)} set to NPC."}
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
        f"{current_user.get('username') or 'Someone'} invited you to an Organised Crime heist as {_oc_role_display_name(request.role)} ({job_name}). Accept or decline in your inbox. Expires in {OC_INVITE_EXPIRY_MINUTES} min.",
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
    oc_reduced = _oc_reduced_active(current_user)
    from server import rank_xp_pass_multiplier
    pass_mult = float(rank_xp_pass_multiplier(current_user))
    cooldown_hours = OC_COOLDOWN_HOURS_REDUCED if (has_timer_upgrade or oc_reduced) else OC_COOLDOWN_HOURS
    user_oc = await db.user_organised_crime.find_one({"user_id": uid}, {"_id": 0, "selected_equipment": 1})
    selected_id = (user_oc or {}).get("selected_equipment", "basic")
    equip = OC_EQUIPMENT_BY_ID.get(selected_id, OC_EQUIPMENT_BY_ID["basic"])
    total_cost = OC_SETUP_COST + equip["cost"]
    if oc_reduced:
        total_cost = int(total_cost * 0.8)
    new_cooldown_until = now + timedelta(hours=cooldown_hours)
    result = await db.users.update_one(
        {"id": uid, "money": {"$gte": total_cost},
         "$or": [
             {"oc_cooldown_until": {"$exists": False}},
             {"oc_cooldown_until": None},
             {"oc_cooldown_until": {"$lte": now.isoformat()}},
         ]},
        {"$inc": {"money": -total_cost}, "$set": {"oc_cooldown_until": new_cooldown_until.isoformat()}},
    )
    if result.modified_count == 0:
        fresh = await db.users.find_one({"id": uid}, {"_id": 0, "money": 1, "oc_cooldown_until": 1})
        if fresh:
            cd = fresh.get("oc_cooldown_until")
            if cd:
                until = _parse_iso_datetime(cd)
                if until and until > now:
                    secs = int((until - now).total_seconds())
                    return {"success": False, "message": f"OC cooldown: try again in {secs}s", "cooldown_until": cd}
        return {
            "success": False,
            "message": f"Not enough money. Need ${total_cost:,}",
            "cooldown_until": None,
            "skipped_afford": True,
        }
    ev = await get_effective_event()
    rank_mult = float(ev.get("rank_points", 1.0))
    cash_mult = float(ev.get("kill_cash", 1.0))
    success = _rng.random() < OC_SUCCESS_RATE
    if not success:
        goes_to_jail = _rng.random() < OC_JAIL_CHANCE_ON_FAIL
        if goes_to_jail:
            jail_until = now + timedelta(seconds=OC_JAIL_SECONDS_TEAM)
            unbreakable_until = now + timedelta(seconds=60)
            await db.users.update_one(
                {"id": uid},
                {"$set": {"in_jail": True, "jail_until": jail_until.isoformat(), "unbreakable_until": unbreakable_until.isoformat(), "snitch_attempted_this_term": False}},
            )
            msg = _rng.choice(OC_TEAM_HEIST_JAIL_MESSAGES).format(jail_time=OC_JAIL_SECONDS_TEAM)
            return {
                "success": False,
                "message": msg,
                "cooldown_until": new_cooldown_until.isoformat(),
                "jailed": True,
                "jail_until": jail_until.isoformat(),
            }
        return {
            "success": False,
            "message": _rng.choice(OC_TEAM_HEIST_FAIL_MESSAGES),
            "cooldown_until": new_cooldown_until.isoformat(),
        }
    user_ids = [r for r in resolved if r is not None]
    num_humans = len(user_ids)
    num_npcs = 4 - num_humans
    total_shares = num_humans * 1.0 + num_npcs * NPC_PAYOUT_MULTIPLIER
    cash_pool = int(job["cash"] * (total_shares / 4.0) * cash_mult)
    rp_pool = int(job["rp"] * (total_shares / 4.0) * rank_mult)
    if oc_reduced:
        cash_pool = int(cash_pool * 1.1)
        rp_pool = int(rp_pool * 1.1)
    # Prestige bonus: boost OC cash payout for the initiating user
    from server import get_prestige_bonus
    _prestige_user = await db.users.find_one({"id": uid}, {"_id": 0, "prestige_level": 1})
    _oc_mult = get_prestige_bonus(_prestige_user or {})["oc_mult"]
    cash_pool = int(cash_pool * _oc_mult)
    # Badge bonus: 0.1% per OC heists badge; prestige: 0.5% boost per level
    try:
        from routers.game.achievements import get_badge_bonuses
        bb = await get_badge_bonuses(uid)
        oc_badge_mult = (1 + bb.get("oc_heists", 0) * 0.001) * bb.get("prestige_badge_mult", 1)
        cash_pool = int(cash_pool * oc_badge_mult)
        rp_pool = int(rp_pool * oc_badge_mult)
    except Exception:
        pass
    user_map = {}
    if user_ids:
        users_raw = await db.users.find(
            {"id": {"$in": user_ids}},
            {"_id": 0, "id": 1, "rank_points": 1, "username": 1, "prestige_rank_multiplier": 1},
        ).to_list(10)
        user_map = {u["id"]: u for u in users_raw}
    cash_each = rp_each = 0
    for i, user_id in enumerate(resolved):
        pct = pcts[i]
        cash_add = int(cash_pool * pct / 100)
        rp_add = int(rp_pool * pct / 100)
        if user_id == uid:
            cash_add = int(cash_add * pass_mult)
            rp_add = int(rp_add * pass_mult)
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
                    user_prestige_rank_mult(user_map.get(user_id)),
                )
            except Exception as e:
                logger.exception("Rank-up notification (team OC): %s", e)
    # Referral: referrers split 10% of OC profit for heist runner (game-paid)
    if cash_each > 0:
        uid_doc = await db.users.find_one({"id": uid}, {"_id": 0, "referred_by": 1})
        ref_ids = normalize_referred_by_ids((uid_doc or {}).get("referred_by"))
        if ref_ids:
            pool = referral_pool_int(cash_each, 0.10)
            for rid, amt in split_referral_pool(pool, ref_ids, self_id=uid):
                if amt > 0:
                    await apply_referrer_referral_increment(
                        db, rid, {"money": amt, "referral_earnings_oc": amt}, context="oc"
                    )
    msg = _rng.choice(OC_TEAM_HEIST_SUCCESS_MESSAGES).format(job_name=job["name"])
    return {
        "success": True,
        "message": msg,
        "cash_earned": cash_each,
        "rp_earned": rp_each,
        "cooldown_until": new_cooldown_until.isoformat(),
    }


async def run_oc_heist_npc_only(user_id: str, selected_equipment_override: Optional[str] = None) -> dict:
    """Run one OC heist with self + 3 NPCs if timer is ready and user can afford a job. For Auto Rank. Returns ran, success, message, cooldown_until, skipped_afford, and on run: job_id/job_name; on success: cash_earned, rp_earned; on fail: optional jailed, jail_until. When selected_equipment_override is set (e.g. from OC loop), skip user_organised_crime lookup."""
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "id": 1, "oc_cooldown_until": 1, "money": 1, "oc_timer_reduced": 1, "oc_reduced_until": 1},
    )
    if not user:
        return {"ran": False, "success": False, "message": "User not found", "skipped_afford": False}
    now = datetime.now(timezone.utc)
    cooldown_until = user.get("oc_cooldown_until")
    if cooldown_until:
        until = _parse_iso_datetime(cooldown_until)
        if until and until > now:
            return {"ran": False, "success": False, "message": "Cooldown active", "cooldown_until": cooldown_until, "skipped_afford": False}
    oc_reduced = _oc_reduced_active(user)
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
        if oc_reduced:
            total_cost = int(total_cost * 0.8)
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
        "cash_earned": result.get("cash_earned"),
        "rp_earned": result.get("rp_earned"),
        "jailed": result.get("jailed"),
        "jail_until": result.get("jail_until"),
        "job_id": best_job.get("id"),
        "job_name": best_job.get("name"),
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
        invite_docs = await db.oc_invites.find(
            {"pending_heist_id": request.pending_heist_id},
            {"_id": 0},
        ).to_list(20)
        invite_by_role: Dict[str, dict] = {d.get("role"): d for d in invite_docs if d.get("role")}
        for i, role in enumerate(ROLE_KEYS):
            val = (pending.get(role) or "").strip() if isinstance(pending.get(role), str) else None
            if not val:
                raise HTTPException(status_code=400, detail=f"Slot {role} is empty. Clear expired invites or assign NPC.")
            if (val or "").lower() == "self":
                resolved[i] = uid
            elif (val or "").lower() == "npc":
                resolved[i] = None
            else:
                inv = invite_by_role.get(role)
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
        other_ids = [r for r in resolved if r is not None and r != uid]
        others_map: Dict[str, dict] = {}
        if other_ids:
            async for o in db.users.find(
                {"id": {"$in": other_ids}},
                {"_id": 0, "id": 1, "is_dead": 1},
            ):
                others_map[o["id"]] = o
        for i, r in enumerate(resolved):
            slot_val = (slots_raw[i] or "").strip().lower()
            if r is None:
                if slot_val not in ("", "npc"):
                    raise HTTPException(status_code=400, detail=f"User not found: {slots_raw[i]}")
                continue
            if r != uid:
                other = others_map.get(r)
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
    if result.get("jailed"):
        out["jailed"] = True
        out["jail_until"] = result.get("jail_until")
    if result.get("success"):
        out["cash_earned"] = result.get("cash_earned", 0)
        out["rp_earned"] = result.get("rp_earned", 0)
    await log_activity(uid, current_user.get("username", "?"), "oc_execute", {
        "job": job_id, "success": result.get("success", False),
        "cash": result.get("cash_earned", 0), "rp": result.get("rp_earned", 0),
    })
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
