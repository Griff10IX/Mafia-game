# Organised Crime: team heists (Driver, Weapons, Explosives, Hacker), 4 job types, 6h/4h cooldown
from datetime import datetime, timezone, timedelta
import random
import os
import sys
import logging
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
from server import db, get_current_user, get_effective_event

# Roles (team of 4)
OC_ROLES = [
    {"id": "driver", "name": "Driver"},
    {"id": "weapons", "name": "Weapons"},
    {"id": "explosives", "name": "Explosives"},
    {"id": "hacker", "name": "Hacker"},
]

# Jobs: harder = better rewards, lower success chance
OC_JOBS = [
    {"id": "country_bank", "name": "Country Bank", "success_rate": 0.65, "cash": 60_000, "rp": 120},
    {"id": "state_bank", "name": "State Bank", "success_rate": 0.50, "cash": 140_000, "rp": 280},
    {"id": "city_bank", "name": "City Bank", "success_rate": 0.35, "cash": 280_000, "rp": 560},
    {"id": "government_vault", "name": "Government Vault", "success_rate": 0.20, "cash": 550_000, "rp": 1100},
]

OC_COOLDOWN_HOURS = 6
OC_COOLDOWN_HOURS_REDUCED = 4
NPC_PAYOUT_MULTIPLIER = 0.35  # Each NPC gets 35% of a full share for total pool


class OCExecuteRequest(BaseModel):
    job_id: str
    driver: str   # "self" | "npc" | user_id
    weapons: str
    explosives: str
    hacker: str
    # Creator sets % cut per slot (must sum to 100). NPC slots get nothing.
    driver_pct: int = 25
    weapons_pct: int = 25
    explosives_pct: int = 25
    hacker_pct: int = 25


async def get_oc_config(current_user: dict = Depends(get_current_user)):
    """Return jobs and roles for Organised Crime."""
    return {"jobs": OC_JOBS, "roles": OC_ROLES}


async def get_oc_status(current_user: dict = Depends(get_current_user)):
    """Return cooldown and timer upgrade status."""
    has_timer_upgrade = bool(current_user.get("oc_timer_reduced", False))
    cooldown_hours = OC_COOLDOWN_HOURS_REDUCED if has_timer_upgrade else OC_COOLDOWN_HOURS
    cooldown_until = current_user.get("oc_cooldown_until")
    now = datetime.now(timezone.utc)
    if cooldown_until:
        until = _parse_iso_datetime(cooldown_until)
        if until and until <= now:
            cooldown_until = None
    return {
        "cooldown_until": cooldown_until,
        "cooldown_hours": cooldown_hours,
        "has_timer_upgrade": has_timer_upgrade,
    }


async def _resolve_slot(slot: str, current_user_id: str) -> str | None:
    """Return user_id or None for NPC. Accepts 'self', 'npc', or username/id."""
    s = (slot or "").strip()
    if not s or s.lower() == "npc":
        return None
    if s.lower() == "self":
        return current_user_id
    # Resolve by username or id
    u = await db.users.find_one(
        {"$or": [{"username": s}, {"id": s}]},
        {"_id": 0, "id": 1},
    )
    return u["id"] if u else None


async def execute_oc(
    request: OCExecuteRequest,
    current_user: dict = Depends(get_current_user),
):
    """Run an Organised Crime heist. Leader (current user) must fill all 4 slots (self, npc, or other user_id)."""
    job = next((j for j in OC_JOBS if j["id"] == request.job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Invalid job")

    uid = current_user["id"]
    pcts = [request.driver_pct, request.weapons_pct, request.explosives_pct, request.hacker_pct]
    if sum(pcts) != 100 or any(p < 0 or p > 100 for p in pcts):
        raise HTTPException(status_code=400, detail="Percentages must be 0–100 and sum to 100")
    slots = [request.driver, request.weapons, request.explosives, request.hacker]
    resolved = []
    for s in slots:
        r = await _resolve_slot(s, uid)
        resolved.append(r)
    if not any(r == uid for r in resolved):
        raise HTTPException(status_code=400, detail="You must fill at least one slot (use 'self')")

    # All 4 slots must be filled (self, npc, or valid user)
    user_ids = []
    for i, r in enumerate(resolved):
        slot_val = (slots[i] or "").strip().lower()
        if r is None:
            if slot_val not in ("", "npc"):
                raise HTTPException(status_code=400, detail=f"User not found: {slots[i]}")
            continue  # NPC
        if r == uid:
            user_ids.append(uid)
            continue
        other = await db.users.find_one({"id": r}, {"_id": 0, "id": 1, "is_dead": 1})
        if not other:
            raise HTTPException(status_code=400, detail=f"User not found: {slots[i]}")
        if other.get("is_dead"):
            raise HTTPException(status_code=400, detail="Cannot include dead players")
        user_ids.append(r)

    now = datetime.now(timezone.utc)
    has_timer_upgrade = bool(current_user.get("oc_timer_reduced", False))
    cooldown_hours = OC_COOLDOWN_HOURS_REDUCED if has_timer_upgrade else OC_COOLDOWN_HOURS
    cooldown_until = current_user.get("oc_cooldown_until")
    if cooldown_until:
        until = _parse_iso_datetime(cooldown_until)
        if until and until > now:
            secs = int((until - now).total_seconds())
            raise HTTPException(status_code=400, detail=f"OC cooldown: try again in {secs}s")

    ev = await get_effective_event()
    rank_mult = float(ev.get("rank_points", 1.0))
    cash_mult = float(ev.get("kill_cash", 1.0))
    success_rate = min(1.0, job["success_rate"])
    success = random.random() < success_rate

    new_cooldown_until = now + timedelta(hours=cooldown_hours)
    await db.users.update_one(
        {"id": uid},
        {"$set": {"oc_cooldown_until": new_cooldown_until.isoformat()}},
    )

    if not success:
        return {
            "success": False,
            "message": "The heist failed. No rewards.",
            "cooldown_until": new_cooldown_until.isoformat(),
        }

    # Pool size: NPC slots reduce total (NPC_PAYOUT_MULTIPLIER per NPC)
    num_humans = len(user_ids)
    num_npcs = 4 - num_humans
    total_shares = num_humans * 1.0 + num_npcs * NPC_PAYOUT_MULTIPLIER
    cash_pool = int(job["cash"] * (total_shares / 4.0) * cash_mult)
    rp_pool = int(job["rp"] * (total_shares / 4.0) * rank_mult)
    # Creator's % per slot: each human gets that slot's % of the pool; NPC slots get nothing
    cash_each = rp_each = 0
    for i, user_id in enumerate(resolved):
        if user_id is None:
            continue
        pct = pcts[i]
        cash_add = int(cash_pool * pct / 100)
        rp_add = int(rp_pool * pct / 100)
        if user_id == uid:
            cash_each += cash_add
            rp_each += rp_add
        await db.users.update_one(
            {"id": user_id},
            {
                "$inc": {
                    "money": cash_add,
                    "rank_points": rp_add,
                    "total_oc_heists": 1,
                }
            },
        )

    return {
        "success": True,
        "message": f"Heist successful! {job['name']}.",
        "cash_earned": cash_each,
        "rp_earned": rp_each,
        "cooldown_until": new_cooldown_until.isoformat(),
    }


def register(router):
    router.add_api_route("/oc/config", get_oc_config, methods=["GET"])
    router.add_api_route("/oc/status", get_oc_status, methods=["GET"])
    router.add_api_route("/oc/execute", execute_oc, methods=["POST"])
