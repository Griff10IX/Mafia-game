# Illegal business (1920s–30s mafia): one per player, Capo+, raid formula, guards/security, missions, killer choice on death
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
import uuid
import random
import logging
from pydantic import BaseModel

from fastapi import Depends, HTTPException

from server import (
    db,
    get_current_user,
    get_rank_info,
    get_effective_event,
    get_prestige_bonus,
    log_respect_earned,
    send_notification,
    STATES,
    RANKS,
    CAPO_RANK_ID,
)
from routers.kill.armoury import TOKEN_CONFIG, TOKEN_TYPES

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
ILLEGAL_BUSINESS_TYPES = [
    {"id": "stolen_goods_fence", "name": "Stolen goods fence", "description": "Buying and selling hot merchandise.", "produces_booze": False},
    {"id": "booze_making", "name": "Booze making", "description": "Still / distillery. Cash and passive booze.", "produces_booze": True},
    {"id": "speakeasy", "name": "Speakeasy", "description": "Hidden bar, entertainment, clientele.", "produces_booze": False},
    {"id": "numbers_racket", "name": "Numbers racket", "description": "Illegal lottery / policy racket.", "produces_booze": False},
    {"id": "protection_racket", "name": "Protection racket", "description": "Protection payments from local businesses.", "produces_booze": False},
]

START_COST_CASH = 12_500  # 75% reduction for beta
START_COST_POINTS = 0
INCOME_PER_HOUR_BASE = 500  # 75% reduction for beta
INCOME_CAP_HOURS_BASE = 24
BOOZE_PER_HOUR_BASE = 5
BOOZE_CAP_HOURS_BASE = 24
GUARD_SLOTS_INITIAL = 2
SECURITY_LEVEL_INITIAL = 0

# Security upgrades: buy in order at escalating prices (no mission gates).
SECURITY_UPGRADES = [
    {"id": "reinforced_door", "name": "Reinforced door", "defence_weight": 8},
    {"id": "vault", "name": "Vault / safe", "defence_weight": 12},
    {"id": "lookout", "name": "Lookout", "defence_weight": 10},
    {"id": "bouncers", "name": "Bouncers", "defence_weight": 15},
    {"id": "alarm_wire", "name": "Alarm wire", "defence_weight": 9},
    {"id": "bribed_cop", "name": "Bribed beat cop", "defence_weight": 14},
    {"id": "thompson", "name": "Thompson in the back", "defence_weight": 18},
    {"id": "iron_bars", "name": "Iron bars on windows", "defence_weight": 7},
    {"id": "guard_dog", "name": "Guard dog", "defence_weight": 11},
    {"id": "spotlight", "name": "Spotlight at the door", "defence_weight": 6},
    {"id": "safe_room", "name": "Safe room", "defence_weight": 16},
    {"id": "wire_taps", "name": "Wire taps (early warning)", "defence_weight": 10},
    {"id": "armoured_desk", "name": "Armoured desk", "defence_weight": 8},
    {"id": "back_exit", "name": "Hidden back exit", "defence_weight": 9},
    {"id": "panic_button", "name": "Panic button to the family", "defence_weight": 13},
    # Tier 3–4 (indices 15–34)
    {"id": "reinforced_door_2", "name": "Heavy reinforced door", "defence_weight": 10},
    {"id": "vault_2", "name": "Secondary vault", "defence_weight": 14},
    {"id": "lookout_2", "name": "Rooftop lookout", "defence_weight": 12},
    {"id": "bouncers_2", "name": "Extra bouncers", "defence_weight": 16},
    {"id": "alarm_2", "name": "Perimeter alarm", "defence_weight": 11},
    {"id": "bribed_cop_2", "name": "Second beat cop", "defence_weight": 15},
    {"id": "thompson_2", "name": "Second Thompson", "defence_weight": 19},
    {"id": "iron_bars_2", "name": "Reinforced bars", "defence_weight": 8},
    {"id": "guard_dog_2", "name": "Second guard dog", "defence_weight": 12},
    {"id": "spotlight_2", "name": "Rear spotlight", "defence_weight": 7},
    {"id": "safe_room_2", "name": "Reinforced safe room", "defence_weight": 18},
    {"id": "wire_taps_2", "name": "Extended wire taps", "defence_weight": 11},
    {"id": "armoured_desk_2", "name": "Double armoured desk", "defence_weight": 9},
    {"id": "back_exit_2", "name": "Second back exit", "defence_weight": 10},
    {"id": "panic_button_2", "name": "Backup panic line", "defence_weight": 14},
    {"id": "reinforced_door_3", "name": "Bank-grade door", "defence_weight": 11},
    {"id": "vault_3", "name": "Main vault upgrade", "defence_weight": 15},
    {"id": "lookout_3", "name": "Street lookouts", "defence_weight": 13},
    {"id": "bouncers_3", "name": "Elite bouncers", "defence_weight": 17},
    {"id": "alarm_3", "name": "Full building alarm", "defence_weight": 12},
    {"id": "bribed_cop_3", "name": "Sergeant on payroll", "defence_weight": 16},
    {"id": "thompson_3", "name": "Thompson squad", "defence_weight": 20},
    {"id": "iron_bars_3", "name": "Steel cage", "defence_weight": 9},
    {"id": "guard_dog_3", "name": "K-9 unit", "defence_weight": 13},
    {"id": "spotlight_3", "name": "Full perimeter lights", "defence_weight": 8},
    {"id": "safe_room_3", "name": "Bunker safe room", "defence_weight": 19},
    {"id": "wire_taps_3", "name": "City-wide taps", "defence_weight": 12},
    {"id": "armoured_desk_3", "name": "Vault desk", "defence_weight": 10},
    {"id": "back_exit_3", "name": "Tunnel exit", "defence_weight": 11},
    {"id": "panic_button_3", "name": "Family rapid response", "defence_weight": 15},
    {"id": "reinforced_door_4", "name": "Bunker door", "defence_weight": 12},
    {"id": "vault_4", "name": "Underground vault", "defence_weight": 16},
    {"id": "lookout_4", "name": "24/7 watch", "defence_weight": 14},
    {"id": "bouncers_4", "name": "Armoured bouncers", "defence_weight": 18},
]
# Cost for security upgrade at index i: base + step * i (gradually higher).
# 75% reduction for beta
SECURITY_UPGRADE_BASE_CASH = 6_250
SECURITY_UPGRADE_STEP_CASH = 5_000
SECURITY_UPGRADE_BASE_POINTS = 5
SECURITY_UPGRADE_STEP_POINTS = 8
SECURITY_UPGRADE_IDS = [u["id"] for u in SECURITY_UPGRADES]

# Guard hire: cost per slot; armour/weapon 0..base_max + mission unlocks (cap at 20).
# 75% reduction for beta
GUARD_HIRE_COST_CASH = 2_500
GUARD_HIRE_COST_POINTS = 5
GUARD_SLOTS_MAX = 1000
# Cost to add one more guard slot: base * (mult ** (current_slots - GUARD_SLOTS_INITIAL)).
GUARD_SLOT_BASE_CASH = 12_500  # 75% reduction
GUARD_SLOT_BASE_POINTS = 10
GUARD_SLOT_MULT = 1.5
GUARD_ARMOUR_MAX = 20
GUARD_WEAPON_MAX = 20
GUARD_WEAPON_BASE_MAX = 3  # missions add +1 via guard_weapon_max_unlock on business

# Raid
RAID_COOLDOWN_HOURS = 12
RAID_DAILY_LIMIT = 5
RAID_LOOT_PERCENT = 0.25  # attacker gets 25% of target's uncollected income (capped)
RAID_VARIANCE = 0.15  # random +/- 15% on strength for drama
DEFENDER_BASE_STRENGTH = 10
ATTACKER_BASE_STRENGTH = 5
GUARD_STRENGTH_PER_LEVEL = 4  # armour_level + weapon_level each contribute
SECURITY_WEIGHT = 1.0  # defence = DEFENDER_BASE + sum(guard_strength) + security_level * weight per upgrade

# Collect anti-spam: extras only when at least 1 min accumulated
MIN_COLLECT_HOURS_FOR_EXTRAS = 1 / 60
# Extras (bullets, respect, points, loot pieces) cooldown: once every few hours
RACKET_EXTRAS_COOLDOWN_HOURS = 3

# Death / killer reward
MAX_INCOME_BOOST_PERCENT = 20
INCOME_BOOST_PER_KILL_PERCENT = 2
MODERATELY_UPGRADED_LEVEL = 2
MODERATELY_UPGRADED_SECURITY = 1

# Missions (fairly hard). requirements map keys: crimes_in_state, collections, raids_won, guards_weapon_3, security_level, rank_id, etc.
ILLEGAL_BUSINESS_MISSIONS = [
    {"id": "ibm_1", "order": 1, "title": "Prove the operation", "story": "The Commissioner wants a cut—prove you can run the block.",
     "how_to_complete": "Reach Capo rank and complete 100 crimes in total.",
     "requirements": {"crimes": 100, "rank_id": CAPO_RANK_ID}, "rewards": {"points": 2}},
    {"id": "ibm_2", "order": 2, "title": "Expand the take", "story": "Word on the street: you need more muscle before the big boys notice.",
     "how_to_complete": "Collect from your business 5 times and reach security level 1 (buy 1 upgrade).",
     "requirements": {"collections": 5, "security_level": 1}, "rewards": {"income_mult": 1.1, "points": 3, "cash": 5_000}},
    {"id": "ibm_3", "order": 3, "title": "Hit back", "story": "They hit you once. Show them you hit harder.",
     "how_to_complete": "Win 3 raids.",
     "requirements": {"raids_won": 3}, "rewards": {"points": 3, "jailbust_tokens": 1}},
    {"id": "ibm_4", "order": 4, "title": "Heavy security", "story": "A vault keeps the take safe. Get one.",
     "how_to_complete": "Reach security level 3 (buy 3 upgrades).",
     "requirements": {"security_level": 3}, "rewards": {"guard_weapon_max": 1, "points": 5}},
    {"id": "ibm_5", "order": 5, "title": "Territory boss", "story": "Run 500 crimes in your business state. Own the block.",
     "how_to_complete": "Complete 500 crimes in your business state.",
     "requirements": {"crimes_in_state": 500}, "rewards": {"income_mult": 1.2, "points": 5, "cash": 15_000}},
    {"id": "ibm_6", "order": 6, "title": "Widening the net", "story": "More crimes, more respect. Push to 250 total.",
     "how_to_complete": "Complete 250 crimes in total.",
     "requirements": {"crimes": 250}, "rewards": {"points": 4}},
    {"id": "ibm_7", "order": 7, "title": "Bigger take", "story": "The operation is growing. Show it in the books.",
     "how_to_complete": "Collect from your business 15 times.",
     "requirements": {"collections": 15}, "rewards": {"income_mult": 1.1, "points": 5, "cash": 10_000, "xp_crimes_tokens": 1}},
    {"id": "ibm_8", "order": 8, "title": "Raid veteran", "story": "You've hit enough joints to know the score.",
     "how_to_complete": "Win 5 raids.",
     "requirements": {"raids_won": 5}, "rewards": {"points": 5}},
    {"id": "ibm_9", "order": 9, "title": "Fortress", "story": "Lock it down. Get to five security upgrades.",
     "how_to_complete": "Reach security level 5 (buy 5 upgrades).",
     "requirements": {"security_level": 5}, "rewards": {"guard_weapon_max": 1, "points": 8}},
    {"id": "ibm_10", "order": 10, "title": "State kingpin", "story": "Run 1,000 crimes in your business state.",
     "how_to_complete": "Complete 1,000 crimes in your business state.",
     "requirements": {"crimes_in_state": 1000}, "rewards": {"income_mult": 1.15, "points": 10, "cash": 25_000}},
    {"id": "ibm_11", "order": 11, "title": "Crime lord", "story": "500 crimes total. The family notices.",
     "how_to_complete": "Complete 500 crimes in total.",
     "requirements": {"crimes": 500}, "rewards": {"points": 8}},
    {"id": "ibm_12", "order": 12, "title": "Money machine", "story": "The operation is a well-oiled machine now.",
     "how_to_complete": "Collect from your business 50 times and reach security level 10.",
     "requirements": {"collections": 50, "security_level": 10}, "rewards": {"income_mult": 1.2, "points": 10, "cash": 50_000}},
    {"id": "ibm_13", "order": 13, "title": "Raid master", "story": "Ten successful hits. You're the one they fear.",
     "how_to_complete": "Win 10 raids.",
     "requirements": {"raids_won": 10}, "rewards": {"income_mult": 1.1, "points": 10}},
    {"id": "ibm_14", "order": 14, "title": "Maximum security", "story": "Every upgrade. Nobody gets in.",
     "how_to_complete": "Reach security level 15 (buy all upgrades).",
     "requirements": {"security_level": 15}, "rewards": {"guard_weapon_max": 1, "income_mult": 1.1, "points": 15}},
    {"id": "ibm_15", "order": 15, "title": "Empire", "story": "2,500 crimes in your state. You own the block.",
     "how_to_complete": "Complete 2,500 crimes in your business state.",
     "requirements": {"crimes_in_state": 2500}, "rewards": {"income_mult": 1.25, "points": 20, "cash": 100_000}},
]

# Default booze type for booze_making passive output (first BOOZE_TYPES id)
def _default_booze_type_id():
    from routers.money.booze_run import BOOZE_TYPES
    return BOOZE_TYPES[0]["id"] if BOOZE_TYPES else "bathtub_gin"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _user_rank_id(user: dict) -> int:
    rp = int(user.get("rank_points") or 0)
    mult = float(user.get("prestige_rank_multiplier") or 1.0)
    rid, _ = get_rank_info(rp, mult)
    return rid


def _business_defender_strength(business: dict, guards: List[dict]) -> float:
    base = DEFENDER_BASE_STRENGTH
    guard_sum = 0
    for g in guards:
        armour = int(g.get("armour_level") or 0)
        weapon = int(g.get("weapon_level") or 0)
        guard_sum += (armour + weapon) * GUARD_STRENGTH_PER_LEVEL
    security_level = int(business.get("security_level") or 0)
    upgrades = business.get("security_upgrades") or []
    if isinstance(upgrades, dict):
        upgrade_count = sum(upgrades.values()) if isinstance(next(iter(upgrades.values()), 0), (int, float)) else len(upgrades)
    else:
        upgrade_count = len(upgrades) if isinstance(upgrades, list) else security_level
    security_value = sum(
        SECURITY_UPGRADES[i].get("defence_weight", 10)
        for i in range(min(upgrade_count, len(SECURITY_UPGRADES)))
    )
    if security_value == 0 and security_level > 0:
        security_value = security_level * 10
    return base + guard_sum + security_value


def _attacker_strength(user: dict) -> float:
    """Use character rank + weapon/armour as raiding crew (plan option B)."""
    base = ATTACKER_BASE_STRENGTH
    rank_id = _user_rank_id(user)
    rank_contrib = rank_id * 6
    armour = int(user.get("armour_level") or 0)
    weapon_contrib = 0
    # Equipped weapon: check user_weapons for equipped or best
    uw = user.get("equipped_weapon_id") or user.get("weapon_id")
    if uw:
        weapon_contrib = 8
    return base + rank_contrib + (armour * 4) + weapon_contrib


def _raid_win_probability(attacker_str: float, defender_str: float) -> float:
    variance = 1.0 + random.uniform(-RAID_VARIANCE, RAID_VARIANCE)
    a = attacker_str * variance
    d = max(1.0, defender_str)
    return a / (a + d)


def _is_moderately_upgraded(business: dict) -> bool:
    level = int(business.get("level") or 1)
    security_level = int(business.get("security_level") or 0)
    upgrades = business.get("security_upgrades") or []
    if isinstance(upgrades, list):
        upgrade_count = len(upgrades)
    elif isinstance(upgrades, dict):
        upgrade_count = sum(1 for v in (upgrades.values() or []) if v)
    else:
        upgrade_count = security_level
    return level >= MODERATELY_UPGRADED_LEVEL and (security_level >= MODERATELY_UPGRADED_SECURITY or upgrade_count >= 1)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class StartBusinessRequest(BaseModel):
    type_id: str
    name: Optional[str] = None


class RaidRequest(BaseModel):
    target_username: str
    state: Optional[str] = None


class ClaimKillRewardRequest(BaseModel):
    victim_id: str
    choice: str  # "cash" | "income_boost"


class HireGuardRequest(BaseModel):
    slot_number: int
    armour_level: int = 0
    weapon_level: int = 0


class PatchBusinessRequest(BaseModel):
    name: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
async def get_illegal_business_types(current_user: dict = Depends(get_current_user)):
    """Return available business types (for start screen when user has no business)."""
    return {"types": ILLEGAL_BUSINESS_TYPES}


async def get_illegal_business(current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    guards = await db.illegal_business_guards.find({"business_id": business["id"]}, {"_id": 0}).sort("slot_number", 1).to_list(20)
    completions = current_user.get("illegal_business_mission_completions") or []
    completed_ids = {c.get("mission_id") for c in completions if c.get("mission_id")}
    pending_rewards = current_user.get("pending_illegal_business_rewards") or []
    type_info = next((t for t in ILLEGAL_BUSINESS_TYPES if t["id"] == business.get("type_id")), {})
    missions_progress = []
    for m in sorted(ILLEGAL_BUSINESS_MISSIONS, key=lambda x: x["order"]):
        req = m.get("requirements") or {}
        cur = {}
        if "crimes" in req:
            cur["crimes"] = int(current_user.get("total_crimes") or 0)
        if "rank_id" in req:
            cur["rank_id"] = _user_rank_id(current_user)
        if "security_level" in req and business:
            cur["security_level"] = len(business.get("security_upgrades") or [])
        if "raids_won" in req:
            cur["raids_won"] = int(current_user.get("illegal_business_raids_won") or 0)
        if "crimes_in_state" in req:
            cur["crimes_in_state"] = int(current_user.get("illegal_business_crimes_in_state") or 0)
        if "collections" in req:
            cur["collections"] = int(current_user.get("illegal_business_collections") or 0)
        missions_progress.append({"mission": m, "completed": m["id"] in completed_ids, "current": cur, "target": req})
    # Build security upgrades list (no mission locks; cost computed by index)
    security_upgrades_with_lock = []
    for i, u in enumerate(SECURITY_UPGRADES):
        entry = dict(u)
        entry["cost_cash"] = SECURITY_UPGRADE_BASE_CASH + SECURITY_UPGRADE_STEP_CASH * i
        entry["cost_points"] = SECURITY_UPGRADE_BASE_POINTS + SECURITY_UPGRADE_STEP_POINTS * i
        entry["locked"] = False
        entry["unlock_mission_title"] = None
        security_upgrades_with_lock.append(entry)
    slots = int(business.get("guard_slots") or GUARD_SLOTS_INITIAL)
    if slots < GUARD_SLOTS_MAX:
        exp = slots - GUARD_SLOTS_INITIAL
        next_guard_slot_cash = int(GUARD_SLOT_BASE_CASH * (GUARD_SLOT_MULT ** exp))
        next_guard_slot_points = int(GUARD_SLOT_BASE_POINTS * (GUARD_SLOT_MULT ** exp))
    else:
        next_guard_slot_cash = None
        next_guard_slot_points = None
    return {
        "business": business,
        "guards": guards,
        "type_info": type_info,
        "missions_completed": list(completed_ids),
        "missions": missions_progress,
        "pending_kill_rewards": pending_rewards,
        "available_types": ILLEGAL_BUSINESS_TYPES,
        "security_upgrades_list": security_upgrades_with_lock,
        "next_guard_slot_cost_cash": next_guard_slot_cash,
        "next_guard_slot_cost_points": next_guard_slot_points,
    }


async def start_illegal_business(req: StartBusinessRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("is_dead"):
        raise HTTPException(status_code=400, detail="You're dead. Retrieve your soul first.")
    rank_id = _user_rank_id(current_user)
    if rank_id < CAPO_RANK_ID:
        raise HTTPException(status_code=403, detail="Only Capo or higher can own an illegal business.")
    existing = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 1})
    if existing:
        raise HTTPException(status_code=400, detail="You already have an illegal business.")
    type_id = (req.type_id or "").strip()
    type_def = next((t for t in ILLEGAL_BUSINESS_TYPES if t["id"] == type_id), None)
    if not type_def:
        raise HTTPException(status_code=400, detail="Invalid business type.")
    money = int(current_user.get("money") or 0)
    points = int(current_user.get("points") or 0)
    if money < START_COST_CASH:
        raise HTTPException(status_code=400, detail=f"Need ${START_COST_CASH:,} to start.")
    if points < START_COST_POINTS:
        pass  # no points required by default
    state = (current_user.get("current_state") or STATES[0]).strip()
    if state not in STATES:
        state = STATES[0]
    now = datetime.now(timezone.utc)
    business_id = str(uuid.uuid4())
    name = (req.name or type_def["name"] or "The Racket").strip()[:80]
    doc = {
        "id": business_id,
        "user_id": current_user["id"],
        "name": name or type_def["name"],
        "type_id": type_id,
        "state": state,
        "level": 1,
        "income_per_hour": INCOME_PER_HOUR_BASE,
        "income_cap_hours": INCOME_CAP_HOURS_BASE,
        "last_collected_at": now.isoformat(),
        "guard_slots": GUARD_SLOTS_INITIAL,
        "security_level": 0,
        "security_upgrades": [],
        "total_spent": START_COST_CASH + START_COST_POINTS * 1000,
        "created_at": now.isoformat(),
        "customizations": {},
    }
    if type_def.get("produces_booze"):
        doc["booze_per_hour"] = BOOZE_PER_HOUR_BASE
        doc["booze_cap_hours"] = BOOZE_CAP_HOURS_BASE
        doc["last_collected_booze_at"] = now.isoformat()
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": -START_COST_CASH, "points": -START_COST_POINTS}},
    )
    await db.illegal_businesses.insert_one(doc)
    return {"message": f"You've taken over a joint in {state}.", "business_id": business_id}


async def collect_illegal_business(current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    now = datetime.now(timezone.utc)
    last_raw = business.get("last_collected_at")
    try:
        last = datetime.fromisoformat(last_raw.replace("Z", "+00:00")) if last_raw else now
    except Exception:
        last = now
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    hours = max(0.0, (now - last).total_seconds() / 3600)
    income_per_hour = int(business.get("income_per_hour") or INCOME_PER_HOUR_BASE)
    cap_hours = int(business.get("income_cap_hours") or INCOME_CAP_HOURS_BASE)
    level = int(business.get("level") or 1)
    level_mult = 1.0 + 0.02 * max(0, level - 1)
    boost_pct = int(current_user.get("illegal_business_income_boost_percent") or 0)
    income_per_hour_eff = income_per_hour * level_mult * (1.0 + boost_pct / 100.0)
    income = min(hours * income_per_hour_eff, income_per_hour_eff * cap_hours)
    income = round(income, 2)
    ev = await get_effective_event()
    prestige = get_prestige_bonus(current_user)
    income = round(income * float(ev.get("racket_payout", 1.0)) * float(prestige.get("illegal_business_mult", 1.0)), 2)
    racket_until = current_user.get("racket_until")
    if racket_until:
        try:
            until = datetime.fromisoformat(racket_until.replace("Z", "+00:00"))
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            if now < until:
                income = round(income * 1.2, 2)
        except Exception:
            pass
    if income < 0.01:
        raise HTTPException(status_code=400, detail="No take to collect yet.")
    updates = {"last_collected_at": now.isoformat()}
    security_level = len(business.get("security_upgrades") or []) or int(business.get("security_level") or 0)
    ib_mult = float(prestige.get("illegal_business_mult", 1.0))
    # Extras (bullets, respect, points, loot) only when enough time accumulated and cooldown passed
    last_extras = business.get("last_extras_collected_at")
    extras_cooldown_passed = True
    if last_extras:
        try:
            last_dt = datetime.fromisoformat(last_extras.replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            extras_cooldown_passed = (now - last_dt).total_seconds() >= RACKET_EXTRAS_COOLDOWN_HOURS * 3600
        except Exception:
            pass
    grant_extras = hours >= MIN_COLLECT_HOURS_FOR_EXTRAS and extras_cooldown_passed
    if grant_extras:
        updates["last_extras_collected_at"] = now.isoformat()
    respect_earned = min(100, max(0, int(income * 0.001 * ib_mult))) if grant_extras else 0
    bullets_earned = max(1, int((1 + min(level + security_level, 9)) * ib_mult)) if grant_extras else 0
    points_earned = int((random.randint(1, 5) if level >= 3 else 0) * ib_mult) if grant_extras else 0
    loot_pieces_earned = (random.randint(1, 2) if random.random() < 0.05 else 0) if grant_extras else 0
    inc = {"money": income, "illegal_business_collections": 1}
    if respect_earned > 0:
        inc["respect_points"] = respect_earned
    if bullets_earned > 0:
        inc["bullets"] = bullets_earned
    if points_earned > 0:
        inc["points"] = points_earned
    if loot_pieces_earned > 0:
        inc["loot_box_pieces"] = loot_pieces_earned
    # Ultra-rare token drop (0.001% = 1 in 100,000) - same as crimes
    if random.random() < 0.00001:
        token_type = random.choice(TOKEN_TYPES)
        field = TOKEN_CONFIG[token_type]["count_field"]
        inc[field] = inc.get(field, 0) + 1
    booze_earned = 0
    if business.get("type_id") == "booze_making" and business.get("booze_per_hour"):
        last_booze = business.get("last_collected_booze_at")
        try:
            last_b = datetime.fromisoformat(last_booze.replace("Z", "+00:00")) if last_booze else last
        except Exception:
            last_b = last
        if last_b.tzinfo is None:
            last_b = last_b.replace(tzinfo=timezone.utc)
        hours_booze = max(0.0, (now - last_b).total_seconds() / 3600)
        bph = int(business.get("booze_per_hour") or BOOZE_PER_HOUR_BASE)
        bcap = int(business.get("booze_cap_hours") or BOOZE_CAP_HOURS_BASE)
        booze_earned = min(int(hours_booze * bph), bph * bcap)
        if booze_earned > 0:
            updates["last_collected_booze_at"] = now.isoformat()
            default_booze_id = _default_booze_type_id()
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": {f"booze_carrying.{default_booze_id}": booze_earned}},
            )
    await db.users.update_one({"id": current_user["id"]}, {"$inc": inc})
    if respect_earned > 0:
        await log_respect_earned(current_user["id"], respect_earned, "illegal_business")
    await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": updates})
    msg = f"The till's been cleared. ${income:,.2f}"
    if booze_earned:
        msg += f" and {booze_earned} booze."
    token_earned = {t: inc.get(TOKEN_CONFIG[t]["count_field"], 0) for t in TOKEN_TYPES}
    any_tokens = sum(token_earned.values())
    if respect_earned or bullets_earned or points_earned or loot_pieces_earned or any_tokens:
        extras = []
        if respect_earned: extras.append(f"{respect_earned} respect")
        if bullets_earned: extras.append(f"{bullets_earned} bullets")
        if points_earned: extras.append(f"{points_earned} points")
        if loot_pieces_earned: extras.append(f"{loot_pieces_earned} loot piece(s)")
        for t in TOKEN_TYPES:
            n = token_earned.get(t, 0)
            if n:
                extras.append(f"{n} {t.replace('_', ' ').title()} token(s)")
        if extras:
            msg += " " + ", ".join(extras) + "."
    return {
        "message": msg,
        "cash": income,
        "booze": booze_earned,
        "respect_points": respect_earned,
        "bullets": bullets_earned,
        "points": points_earned,
        "loot_box_pieces": loot_pieces_earned,
        "tokens_earned": token_earned,
    }


async def get_illegal_business_missions(current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    completions = current_user.get("illegal_business_mission_completions") or []
    completed_ids = {c.get("mission_id") for c in completions if c.get("mission_id")}
    progress = []
    for m in sorted(ILLEGAL_BUSINESS_MISSIONS, key=lambda x: x["order"]):
        req = m.get("requirements") or {}
        cur = {}
        if "crimes" in req:
            cur["crimes"] = int(current_user.get("total_crimes") or 0)
        if "rank_id" in req:
            cur["rank_id"] = _user_rank_id(current_user)
        if "security_level" in req and business:
            cur["security_level"] = len(business.get("security_upgrades") or [])
        if "raids_won" in req:
            cur["raids_won"] = int(current_user.get("illegal_business_raids_won") or 0)
        if "crimes_in_state" in req:
            cur["crimes_in_state"] = int(current_user.get("illegal_business_crimes_in_state") or 0)
        if "collections" in req:
            cur["collections"] = int(current_user.get("illegal_business_collections") or 0)
        progress.append({"mission": m, "completed": m["id"] in completed_ids, "current": cur, "target": req})
    return {"missions": progress}


async def complete_illegal_business_mission(mission_id: str, current_user: dict = Depends(get_current_user)):
    mission = next((m for m in ILLEGAL_BUSINESS_MISSIONS if m["id"] == mission_id), None)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found.")
    completions = current_user.get("illegal_business_mission_completions") or []
    if any(c.get("mission_id") == mission_id for c in completions):
        raise HTTPException(status_code=400, detail="Mission already completed.")
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You need an illegal business.")
    req = mission.get("requirements") or {}
    met = True
    for key, target in req.items():
        if key == "crimes":
            cur = int(current_user.get("total_crimes") or 0)
        elif key == "rank_id":
            cur = _user_rank_id(current_user)
        elif key == "security_level":
            cur = len(business.get("security_upgrades") or [])
        elif key == "raids_won":
            cur = int(current_user.get("illegal_business_raids_won") or 0)
        elif key == "crimes_in_state":
            cur = int(current_user.get("illegal_business_crimes_in_state") or 0)
        elif key == "collections":
            cur = int(current_user.get("illegal_business_collections") or 0)
        else:
            cur = 0
        if cur < target:
            met = False
            break
    if not met:
        raise HTTPException(status_code=400, detail="Requirements not met.")
    rewards = mission.get("rewards") or {}
    now = datetime.now(timezone.utc).isoformat()
    update_business = {}
    if "income_mult" in rewards:
        mult = float(rewards["income_mult"])
        iph = int(business.get("income_per_hour") or INCOME_PER_HOUR_BASE)
        update_business["$set"] = update_business.get("$set") or {}
        update_business["$set"]["income_per_hour"] = int(iph * mult)
    if "guard_weapon_max" in rewards:
        update_business["$set"] = update_business.get("$set") or {}
        update_business["$set"]["guard_weapon_max_unlock"] = int(business.get("guard_weapon_max_unlock") or 0) + 1
    if update_business:
        await db.illegal_businesses.update_one({"id": business["id"]}, update_business)
    user_updates = {"$push": {"illegal_business_mission_completions": {"mission_id": mission_id, "completed_at": now}}}
    if rewards.get("points"):
        user_updates["$inc"] = user_updates.get("$inc") or {}
        user_updates["$inc"]["points"] = int(rewards["points"])
    if rewards.get("cash"):
        user_updates["$inc"] = user_updates.get("$inc") or {}
        user_updates["$inc"]["money"] = int(rewards["cash"])
    for token_type in TOKEN_TYPES:
        field = TOKEN_CONFIG[token_type]["count_field"]
        if rewards.get(field):
            user_updates["$inc"] = user_updates.get("$inc") or {}
            user_updates["$inc"][field] = int(rewards[field])
    await db.users.update_one({"id": current_user["id"]}, user_updates)
    return {"message": mission.get("story", "Mission complete.")}


async def get_illegal_business_guards(current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    slots = int(business.get("guard_slots") or GUARD_SLOTS_INITIAL)
    limit = min(2000, max(slots + 100, 500))
    guards = await db.illegal_business_guards.find({"business_id": business["id"]}, {"_id": 0}).sort("slot_number", 1).to_list(limit)
    return {"guards": guards, "guard_slots": slots}


async def buy_guard_slot(current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    slots = int(business.get("guard_slots") or GUARD_SLOTS_INITIAL)
    if slots >= GUARD_SLOTS_MAX:
        raise HTTPException(status_code=400, detail="Maximum guard slots reached.")
    exp = slots - GUARD_SLOTS_INITIAL
    cost_cash = int(GUARD_SLOT_BASE_CASH * (GUARD_SLOT_MULT ** exp))
    cost_points = int(GUARD_SLOT_BASE_POINTS * (GUARD_SLOT_MULT ** exp))
    money = int(current_user.get("money") or 0)
    points = int(current_user.get("points") or 0)
    if money < cost_cash or points < cost_points:
        raise HTTPException(status_code=400, detail=f"Need ${cost_cash:,} and {cost_points} points to buy another slot.")
    total_spent = int(business.get("total_spent") or 0) + cost_cash + cost_points * 1000
    await db.illegal_businesses.update_one(
        {"id": business["id"]},
        {"$inc": {"guard_slots": 1}, "$set": {"total_spent": total_spent}},
    )
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -cost_cash, "points": -cost_points}})
    return {"message": "Another slot on the door.", "guard_slots": slots + 1}


async def hire_illegal_business_guard(req: HireGuardRequest, current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    slots = int(business.get("guard_slots") or GUARD_SLOTS_INITIAL)
    existing = await db.illegal_business_guards.find({"business_id": business["id"]}, {"_id": 0}).to_list(slots + 1)
    if len(existing) >= slots:
        raise HTTPException(status_code=400, detail="No guard slots left. Buy another slot to add more guards.")
    slot = req.slot_number
    if slot < 1 or slot > slots:
        raise HTTPException(status_code=400, detail="Invalid slot.")
    if any(g.get("slot_number") == slot for g in existing):
        raise HTTPException(status_code=400, detail="Slot already filled.")
    unlock = int(business.get("guard_weapon_max_unlock") or 0)
    effective_max = min(GUARD_WEAPON_MAX, GUARD_WEAPON_BASE_MAX + unlock)
    armour = max(0, min(effective_max, req.armour_level))
    weapon = max(0, min(effective_max, req.weapon_level))
    cost_cash = GUARD_HIRE_COST_CASH
    cost_points = GUARD_HIRE_COST_POINTS
    money = int(current_user.get("money") or 0)
    points = int(current_user.get("points") or 0)
    if money < cost_cash or points < cost_points:
        raise HTTPException(status_code=400, detail=f"Need ${cost_cash:,} and {cost_points} points to hire.")
    guard_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    guard_doc = {
        "id": guard_id,
        "business_id": business["id"],
        "user_id": current_user["id"],
        "slot_number": slot,
        "armour_level": armour,
        "weapon_level": weapon,
        "hired_at": now,
        "hire_cost": cost_cash + cost_points * 1000,
    }
    await db.illegal_business_guards.insert_one(guard_doc)
    total_spent = int(business.get("total_spent") or 0) + cost_cash + cost_points * 1000
    await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": {"total_spent": total_spent}})
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -cost_cash, "points": -cost_points}})
    return {"message": "Another pair of hands on the door.", "guard_id": guard_id}


async def upgrade_security(upgrade_id: str, current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    upgrades_done = business.get("security_upgrades") or []
    if not isinstance(upgrades_done, list):
        upgrades_done = list(upgrades_done) if isinstance(upgrades_done, dict) else []
    idx = next((i for i, u in enumerate(SECURITY_UPGRADES) if u["id"] == upgrade_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Upgrade not found.")
    if idx < len(upgrades_done):
        raise HTTPException(status_code=400, detail="Already have this upgrade.")
    if idx > len(upgrades_done):
        raise HTTPException(status_code=400, detail="Unlock previous upgrades first.")
    cost_cash = SECURITY_UPGRADE_BASE_CASH + SECURITY_UPGRADE_STEP_CASH * idx
    cost_points = SECURITY_UPGRADE_BASE_POINTS + SECURITY_UPGRADE_STEP_POINTS * idx
    up_def = SECURITY_UPGRADES[idx]
    money = int(current_user.get("money") or 0)
    points = int(current_user.get("points") or 0)
    if money < cost_cash or points < cost_points:
        raise HTTPException(status_code=400, detail=f"Need ${cost_cash:,} and {cost_points} points.")
    new_list = list(upgrades_done) + [upgrade_id]
    total_spent = int(business.get("total_spent") or 0) + cost_cash + cost_points * 1000
    await db.illegal_businesses.update_one(
        {"id": business["id"]},
        {"$set": {"security_upgrades": new_list, "security_level": len(new_list), "total_spent": total_spent}},
    )
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -cost_cash, "points": -cost_points}})
    return {"message": f"{up_def['name']} installed.", "security_level": len(new_list)}


async def patch_illegal_business(req: PatchBusinessRequest, current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    updates = {}
    if req.name is not None:
        updates["name"] = (req.name or business.get("name") or "The Racket").strip()[:80]
    if updates:
        await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": updates})
    return {"message": "Updated."}


async def raid_illegal_business(req: RaidRequest, current_user: dict = Depends(get_current_user)):
    target_user = await db.users.find_one({"username": {"$regex": f"^{req.target_username.strip()}$", "$options": "i"}}, {"_id": 0, "id": 1, "username": 1})
    if not target_user:
        raise HTTPException(status_code=404, detail="Target not found.")
    target_id = target_user["id"]
    if target_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="You can't raid yourself.")
    business = await db.illegal_businesses.find_one({"user_id": target_id}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=400, detail="Target has no illegal business.")
    state = (req.state or business.get("state") or "").strip()
    if state and business.get("state") != state:
        raise HTTPException(status_code=400, detail="Target's business is in a different state.")
    # Cooldown: raid_cooldowns: { target_id: last_raid_at }
    cooldowns = current_user.get("illegal_business_raid_cooldowns") or {}
    last = cooldowns.get(target_id)
    if last:
        try:
            last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - last_dt).total_seconds() < RAID_COOLDOWN_HOURS * 3600:
                raise HTTPException(status_code=400, detail=f"Raid cooldown. Try again in {RAID_COOLDOWN_HOURS}h.")
        except Exception:
            pass
    # Daily limit
    today_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    raid_count_today = int(current_user.get("illegal_business_raids_today") or 0)
    raid_date = current_user.get("illegal_business_raids_date")
    if raid_date != today_key:
        raid_count_today = 0
    if raid_count_today >= RAID_DAILY_LIMIT:
        raise HTTPException(status_code=400, detail=f"Daily raid limit ({RAID_DAILY_LIMIT}) reached.")
    guards = await db.illegal_business_guards.find({"business_id": business["id"]}, {"_id": 0}).to_list(2000)
    defender_str = _business_defender_strength(business, guards)
    attacker_str = _attacker_strength(current_user)
    win_prob = _raid_win_probability(attacker_str, defender_str)
    won = random.random() < win_prob
    now = datetime.now(timezone.utc).isoformat()
    cooldowns_new = dict(cooldowns)
    cooldowns_new[target_id] = now
    update_user = {
        "illegal_business_raid_cooldowns": cooldowns_new,
        "illegal_business_raids_date": today_key,
        "illegal_business_raids_today": raid_count_today + 1,
    }
    loot_cash = 0
    loot_points = 0
    loot_cash_credited = 0
    if won:
        last_c = business.get("last_collected_at")
        try:
            last_dt = datetime.fromisoformat(last_c.replace("Z", "+00:00")) if last_c else datetime.now(timezone.utc)
        except Exception:
            last_dt = datetime.now(timezone.utc)
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
        hours = max(0.0, (datetime.now(timezone.utc) - last_dt).total_seconds() / 3600)
        iph = int(business.get("income_per_hour") or INCOME_PER_HOUR_BASE)
        cap = int(business.get("income_cap_hours") or INCOME_CAP_HOURS_BASE)
        available = min(hours * iph, iph * cap)
        loot_cash = int(available * RAID_LOOT_PERCENT)
        loot_cash_credited = loot_cash
        if loot_cash > 0:
            ev = await get_effective_event()
            prestige = get_prestige_bonus(current_user)
            loot_cash_credited = int(loot_cash * float(ev.get("racket_payout", 1.0)) * float(prestige.get("illegal_business_mult", 1.0)))
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": loot_cash_credited}})
            hours_to_skip = loot_cash / iph if iph else 0
            if hours_to_skip > 0:
                new_last = last_dt + timedelta(hours=hours_to_skip)
                await db.illegal_businesses.update_one(
                    {"id": business["id"]},
                    {"$set": {"last_collected_at": new_last.isoformat()}},
                )
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"illegal_business_raids_won": 1}})
        await send_notification(current_user["id"], "Raid", f"You hit the place. Took ${loot_cash_credited:,}.", "attack", category="attacks")
        await send_notification(target_id, "Raid", f"Your joint was hit. You lost ${loot_cash:,}.", "attack", category="attacks")
    else:
        await send_notification(current_user["id"], "Raid", "They were ready—you got nothing.", "attack", category="attacks")
        await send_notification(target_id, "Raid", "Someone tried to hit your joint. They were turned away.", "attack", category="attacks")
    if raid_date != today_key:
        update_user["illegal_business_raids_today"] = 1
    else:
        update_user["illegal_business_raids_today"] = raid_count_today + 1
    await db.users.update_one({"id": current_user["id"]}, {"$set": update_user})
    return {
        "success": won,
        "loot_cash": loot_cash_credited if won else loot_cash,
        "loot_points": loot_points,
        "message": f"You hit the place. Took ${loot_cash_credited:,}." if won else "They were ready—you got nothing.",
        "target_username": target_user.get("username"),
    }


async def raid_random_illegal_business(current_user: dict = Depends(get_current_user)):
    """Pick a random eligible target (has business, not self) and run the same raid flow. Cooldown and daily limit apply."""
    # Daily limit check first
    today_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    raid_count_today = int(current_user.get("illegal_business_raids_today") or 0)
    raid_date = current_user.get("illegal_business_raids_date")
    if raid_date != today_key:
        raid_count_today = 0
    if raid_count_today >= RAID_DAILY_LIMIT:
        raise HTTPException(status_code=400, detail=f"Daily raid limit ({RAID_DAILY_LIMIT}) reached.")
    # Random business other than current user
    pipeline = [
        {"$match": {"user_id": {"$ne": current_user["id"]}}},
        {"$sample": 1},
    ]
    cursor = db.illegal_businesses.aggregate(pipeline)
    result = await cursor.to_list(1)
    if not result:
        raise HTTPException(status_code=404, detail="No other players with a business to raid.")
    business = result[0]
    target_id = business["user_id"]
    target_user = await db.users.find_one({"id": target_id}, {"_id": 0, "id": 1, "username": 1})
    if not target_user:
        raise HTTPException(status_code=404, detail="Target not found.")
    req = RaidRequest(target_username=target_user["username"], state=business.get("state"))
    return await raid_illegal_business(req, current_user)


async def claim_kill_reward(req: ClaimKillRewardRequest, current_user: dict = Depends(get_current_user)):
    pending = current_user.get("pending_illegal_business_rewards") or []
    entry = next((p for p in pending if p.get("victim_id") == req.victim_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="No pending reward for this victim.")
    choice = (req.choice or "").strip().lower()
    if choice not in ("cash", "income_boost"):
        raise HTTPException(status_code=400, detail="Choice must be 'cash' or 'income_boost'.")
    total_spent = int(entry.get("total_spent") or 0)
    moderately_upgraded = bool(entry.get("moderately_upgraded"))
    if choice == "income_boost" and not moderately_upgraded:
        raise HTTPException(status_code=400, detail="Victim's business was not moderately upgraded. Take cash instead.")
    new_pending = [p for p in pending if p.get("victim_id") != req.victim_id]
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"pending_illegal_business_rewards": new_pending}},
    )
    if choice == "cash":
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": total_spent}})
        return {"message": f"Took ${total_spent:,} from the late owner's operation.", "cash": total_spent, "income_boost": None}
    else:
        current_boost = int(current_user.get("illegal_business_income_boost_percent") or 0)
        new_boost = min(MAX_INCOME_BOOST_PERCENT, current_boost + INCOME_BOOST_PER_KILL_PERCENT)
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"illegal_business_income_boost_percent": new_boost}})
        return {"message": f"Income boost +{INCOME_BOOST_PER_KILL_PERCENT}%. Total: {new_boost}%.", "cash": 0, "income_boost": new_boost}


def register(router):
    router.add_api_route("/illegal-business/types", get_illegal_business_types, methods=["GET"])
    router.add_api_route("/illegal-business", get_illegal_business, methods=["GET"])
    router.add_api_route("/illegal-business/start", start_illegal_business, methods=["POST"])
    router.add_api_route("/illegal-business/collect", collect_illegal_business, methods=["POST"])
    router.add_api_route("/illegal-business/missions", get_illegal_business_missions, methods=["GET"])
    router.add_api_route("/illegal-business/missions/{mission_id}/complete", complete_illegal_business_mission, methods=["POST"])
    router.add_api_route("/illegal-business/guards", get_illegal_business_guards, methods=["GET"])
    router.add_api_route("/illegal-business/guards/buy-slot", buy_guard_slot, methods=["POST"])
    router.add_api_route("/illegal-business/guards/hire", hire_illegal_business_guard, methods=["POST"])
    router.add_api_route("/illegal-business/security/upgrade/{upgrade_id}", upgrade_security, methods=["POST"])
    router.add_api_route("/illegal-business", patch_illegal_business, methods=["PATCH"])
    router.add_api_route("/illegal-business/raid", raid_illegal_business, methods=["POST"])
    router.add_api_route("/illegal-business/raid/random", raid_random_illegal_business, methods=["POST"])
    router.add_api_route("/illegal-business/claim-kill-reward", claim_kill_reward, methods=["POST"])
