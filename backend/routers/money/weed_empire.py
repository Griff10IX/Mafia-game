"""Weed Business Empire — standalone grow / sell / raid loop (staff-preview gated)."""
from __future__ import annotations

import asyncio
import logging
import math
import secrets
import uuid
import hashlib
import hmac
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from server import SECRET_KEY, _is_admin, db, get_current_user, log_activity, send_notification
from utils.store_item_flags import require_store_item_allowed
from utils.weed_empire_catalog import (
    BASE_STREET_PRICE_PER_OZ,
    DAILY_CAP_BONUS_MAX_TIERS,
    DAILY_SELL_CAP_POINTS_COST,
    DAILY_SELL_CAP_STEP_USD,
    DAILY_SELL_CAP_USD,
    DAILY_WITHDRAW_CAP_USD,
    EQUIPMENT_BY_ID,
    EQUIPMENT_CATEGORIES,
    HOUSE_BY_TIER,
    HOUSES,
    MAX_DEALERS_LEVEL,
    MIN_BUSINESS_CASH_RESERVE,
    SAFETY_BANK_MAX_UNITS,
    SAFETY_BANK_UNIT_CAPACITY,
    SAFETY_BANK_UNIT_COST,
    SAFETY_BANK_UNLOCK_POINTS,
    SOIL_CHARGE_PER_PLANT,
    START_BUSINESS_CASH,
    STRAIN_BY_ID,
    STRAINS,
    active_light_class,
    aggregate_stats,
    apply_grower_xp,
    assert_can_upgrade_equipment,
    curing_minutes,
    daily_cap_bonus_tiers,
    daily_sell_cap_for_farm,
    dealer_drip_fraction,
    dealers_upgrade_cost,
    equipment_level_cost,
    equipment_shop_entries,
    grams_to_oz,
    grower_progress,
    market_price_per_oz,
    rarity_xp_mult,
    safety_bank_capacity,
    safety_bank_capacity_units,
    safety_bank_unlocked,
    shop_status_for_farm,
    unit_to_grams,
)
from utils.weed_empire_exclusive_strains import (
    EXCLUSIVE_STRAIN_MIN_GROWER_LEVEL,
    apply_exclusive_stat_bonuses,
    exclusive_buffs_public,
    get_owned_exclusive_strain_ids,
    is_exclusive_strain_id,
    maybe_claim_acapulco_gold_daily,
)
from utils.game_pass_weed_strains import (
    GP_GIRL_SCOUT_COOKIES,
    GP_GORILLA_GLUE,
    GP_PURPLE_PUNCH,
    GP_RAID_SUCCESS_MULT_WHEN_PLANTED,
    GP_UPGRADE_COST_MULT,
    GP_WEDDING_CAKE,
    GP_WITHDRAW_MULT_ACTIVE_VIP,
    GP_WITHDRAW_MULT_PERMANENT,
    farm_has_strain_planted,
    game_pass_buffs_public,
    is_game_pass_strain_id,
    owned_game_pass_strain_ids,
)
from utils.game_pass_micro_rewards import vip_game_pass_entitlement_active

logger = logging.getLogger(__name__)
_rng = secrets.SystemRandom()

# Serialize farm writes per user within a process (sell/status race + click spam).
_weed_farm_locks: Dict[str, asyncio.Lock] = {}
_weed_farm_locks_guard = asyncio.Lock()

FEATURE_ID = "weed_empire"
# Audit / exploit heuristics (generous — flags spam-sold cash, not normal play).
_WEED_AUDIT_MAX_YIELD_G = max(float(s.get("yield_g_max") or 30) for s in STRAINS) * 4.0
_WEED_AUDIT_MAX_USD_PER_HARVEST = int((_WEED_AUDIT_MAX_YIELD_G / 28.0) * BASE_STREET_PRICE_PER_OZ * 3.0)
WATER_INTERVAL_HOURS = 1.5
FEED_INTERVAL_HOURS = 2.5
# Irrigation equipment unlocks automation (hand → drip → auto).
AUTO_WATER_IRRIGATION_LEVEL = 5
AUTO_FEED_IRRIGATION_LEVEL = 8
MAX_HEAT = 100.0
MIN_RAID_GROWER_LEVEL = 5  # cannot raid until Grower Lv 5
MIN_RAID_TARGET_GROWER_LEVEL = 5  # cannot be raided until Grower Lv 5
RAID_PER_TARGET_COOLDOWN_HOURS = 3
RAID_GLOBAL_COOLDOWN_HOURS = RAID_PER_TARGET_COOLDOWN_HOURS  # legacy alias
RAID_CASH_STEAL_CAP = 1_000_000
RAID_CASH_STEAL_FRAC = 0.12
# Security shop lanes that drive raid defence / fail chance.
SECURITY_EQUIPMENT_IDS = (
    "security",
    "stash_containers",
    "vault_locks",
    "motion_grid",
    "guard_dogs",
    "faraday",
)
RAID_SUCCESS_MAX = 0.75  # soft farms / no security
RAID_SUCCESS_AT_MAX_SECURITY = 0.25  # 75% fail when every security lane is maxed
RAID_SUCCESS_FLOOR = 0.18
HEAT_BUST_THRESHOLD = 95.0
HEAT_BUST_SUSTAIN_SECONDS = 600  # 10 continuous minutes at high heat
HEAT_BUST_JAIL_SECONDS = 300  # 5 minutes
BUST_RAID_IMMUNE_HOURS = 6  # cannot be raided by anyone after a heat bust
# Passive heat: 3–8% of the meter per hour; gear/grower bias which end of the band.
HEAT_PASSIVE_MIN_PER_HOUR = 3.0
HEAT_PASSIVE_MAX_PER_HOUR = 8.0
# Full cool-off — middle ground: ~$2k + $125/pt (heat 50 ≈ $8.3k, heat 100 ≈ $14.5k).
COOL_OFF_BASE_COST = 2_000
COOL_OFF_COST_PER_HEAT = 125
ASSISTANT_MAX_WORKERS = 2
ASSISTANT_HIRE_COSTS = (1_250_000, 2_500_000)  # 1st / 2nd worker
ASSISTANT_HIRE_COST = ASSISTANT_HIRE_COSTS[0]  # legacy alias
ASSISTANT_PROFIT_SHARE = 0.25
ASSISTANT_MODES = ("harvest", "cool_heat", "sell_dealer", "plant")
ASSISTANT_TICK_SECONDS = 45
ASSISTANT_COOL_HEAT_PER_TICK = 6.0
ASSISTANT_COOL_COST_PER_POINT = 70  # cheaper drip than manual full clear
ASSISTANT_DEFAULT_PLANT_STRAIN = "northern_lights"
ASSISTANT_DEFAULT_PLANT_SOIL = "soil_conventional"
ASSISTANT_PLANT_SOIL_TYPES = ("soil_conventional", "soil_organic", "coco")
ASSISTANT_SOIL_EQUIP_IDS = {
    "soil_conventional": "soil_conventional",
    "soil_organic": "soil_organic",
    "coco": "coco_medium",
}
WEED_ACTION_CODE_PREFIX = "we_"
WEED_ACTION_CODE_BUCKET_SECONDS = 7200
CLEANLINESS_SAFE_PCT = 30.0
CLEANLINESS_BASE_DECAY_PER_HOUR = 0.25
CLEANLINESS_ACTIVE_PLOT_DECAY_PER_HOUR = 0.45
CLEAN_ROOM_BASE_COST = 3_500
CLEAN_ROOM_HOUSE_TIER_COST = 4_000
CLEAN_ROOM_ACTIVE_PLOT_COST = 900
MITE_RISK_INTERVAL_HOURS = 1.0
MITE_BASE_RISK_CHANCE = 0.08
MITE_MAX_DIRT_RISK_CHANCE = 0.22
MITE_ACTIVE_PLOT_RISK_CHANCE = 0.01
MITE_NEW_INFESTATION_PCT = 12.0
MITE_EXISTING_GROWTH_PCT = 2.0
MITE_QUALITY_DRAIN_PER_HOUR = 0.6
MITE_MAX_HARVEST_YIELD_PENALTY_PCT = 35.0
MITE_TREATMENT_BASE_COST = 2_000
MITE_TREATMENT_COST_PER_PCT = 65
MITE_TREATMENT_BASE_EFFECT_PCT = 55.0

router = APIRouter(prefix="/weed-empire", tags=["weed-empire"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime] = None) -> str:
    return (dt or _utcnow()).isoformat()


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        # Always return timezone-aware UTC so comparisons with _utcnow() never TypeError
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt
    except Exception:
        return None


def _utc_date_str(dt: Optional[datetime] = None) -> str:
    return (dt or _utcnow()).strftime("%Y-%m-%d")


def _empty_plot() -> Dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "state": "empty",
        "strain_id": None,
        "planted_at": None,
        "last_watered_at": None,
        "last_fed_at": None,
        "quality": 50.0,
        "soil_type": None,
        "medium": None,
        "yield_g": 0.0,
        "stage": "empty",
        "progress": 0.0,
        "mite_infestation_pct": 0.0,
        "mite_infested": False,
        "last_mite_treated_at": None,
        "last_mite_risk_at": None,
        "last_mite_damage_at": None,
    }


def _default_farm(user_id: str) -> Dict[str, Any]:
    house = HOUSE_BY_TIER[0]
    plots = [_empty_plot() for _ in range(int(house["plots"]))]
    return {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "house_tier": 0,
        "plots": plots,
        "equipment": {"lights_cfl": 1, "pots": 1, "soil_conventional": 1, "tents": 1, "irrigation": 1, "nutes_base": 1},
        "soil_stock": {"soil_conventional": 4},
        "business_cash": START_BUSINESS_CASH,
        "daily_sold_usd": 0,
        "daily_sold_utc_date": _utc_date_str(),
        "daily_withdrawn_usd": 0,
        "daily_withdrawn_utc_date": _utc_date_str(),
        "lifetime_sold_usd": 0,
        "grower_level": 1,
        "grower_xp": 0,
        "stash": {},  # strain_id -> grams cured
        "curing": [],  # {id, strain_id, grams, quality, started_at, ready_at}
        "heat": 5.0,
        "last_heat_tick_at": _iso(),
        "cleanliness_pct": 100.0,
        "last_cleanliness_tick_at": _iso(),
        "unlocks": ["ditch_weed", "schwag", "northern_lights", "white_widow"],
        "raid_last_by_target": {},  # target_user_id -> last raid ISO (per-target cooldown)
        "raid_available_at": None,  # legacy global field; unused for cooldown
        "raid_stats": {"raids_won": 0, "raids_lost": 0, "times_raided": 0},
        "dealers_level": 0,
        "stolen_equipment": [],  # [{category_id, level, name}] — attacker inventory
        "equipment_rebuy": {},  # category_id -> saved level after raid steal (rebuy restores it)
        "last_equipment_stolen": None,  # {category_id, level, at, name} — recovery if rebuy map lost
        "assistants": [],  # up to ASSISTANT_MAX_WORKERS worker dicts
        # Legacy single-assistant fields kept in sync for older clients / saves
        "assistant_hired": False,
        "assistant_enabled": False,
        "assistant_mode": "harvest",
        "assistant_level": 1,
        "assistant_last_tick_at": None,
        "assistant_last_run": None,
        "heat_high_since": None,
        "last_bust_at": None,
        "bust_restart_seed": False,
        "raid_immune_until": None,
        "daily_cap_bonus_tiers": 0,
        "safety_bank_unlocked": False,
        "safety_bank_cash": 0,
        "safety_bank_capacity_units": 0,
        "missions": {"harvest_count": 0, "sell_count": 0, "raid_wins": 0},
        "sabotage_unlocked": False,
        "created_at": _iso(),
        "updated_at": _iso(),
    }


async def _require_access(user: dict) -> None:
    await require_store_item_allowed(db, FEATURE_ID, user)


async def _attach_exclusive_owned(farm: dict) -> dict:
    """Load exclusive + Game Pass strain ownership onto farm for sync helpers."""
    uid = farm.get("user_id") or ""
    try:
        farm["_exclusive_owned_ids"] = await get_owned_exclusive_strain_ids(db, uid)
    except Exception:
        farm["_exclusive_owned_ids"] = set()
    try:
        u = await db.users.find_one(
            {"id": uid},
            {
                "_id": 0,
                "game_pass_weed_strain_ids": 1,
                "rank_xp_pass_rewards_granted": 1,
                "rank_xp_pass_token_expires_at": 1,
                "loot_reclaimable_passive_ids": 1,
            },
        )
        farm["_gp_owned_ids"] = owned_game_pass_strain_ids(u)
        farm["_gp_active_vip"] = vip_game_pass_entitlement_active(u or {})
        farm["_loot_reclaimable_passive_ids"] = list((u or {}).get("loot_reclaimable_passive_ids") or [])
    except Exception:
        farm["_gp_owned_ids"] = set()
        farm["_gp_active_vip"] = False
        farm["_loot_reclaimable_passive_ids"] = []
    return farm


async def _get_or_create_farm(user_id: str) -> Dict[str, Any]:
    farm = await db.weed_farms.find_one({"user_id": user_id}, {"_id": 0})
    if farm:
        migration: Dict[str, Any] = {}
        # Migrate missing grower and cleanliness fields without retroactive decay.
        if farm.get("grower_level") is None:
            farm["grower_level"] = 1
            farm["grower_xp"] = int(farm.get("grower_xp") or 0)
            migration.update({"grower_level": 1, "grower_xp": farm["grower_xp"]})
        if farm.get("cleanliness_pct") is None:
            farm["cleanliness_pct"] = 100.0
            migration["cleanliness_pct"] = 100.0
        if not farm.get("last_cleanliness_tick_at"):
            farm["last_cleanliness_tick_at"] = _iso()
            migration["last_cleanliness_tick_at"] = farm["last_cleanliness_tick_at"]
        # Unlock used to leave capacity at 0 — grant starter $25M so deposit works.
        if farm.get("safety_bank_unlocked") and safety_bank_capacity_units(farm) <= 0:
            farm["safety_bank_capacity_units"] = 1
            migration["safety_bank_capacity_units"] = 1
        if migration:
            await db.weed_farms.update_one({"user_id": user_id}, {"$set": migration})
        await _attach_exclusive_owned(farm)
        now = _utcnow()
        farm = _tick_environment(farm, _stats(farm), now)
        await db.weed_farms.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "plots": farm.get("plots") or [],
                    "cleanliness_pct": farm["cleanliness_pct"],
                    "last_cleanliness_tick_at": farm["last_cleanliness_tick_at"],
                }
            },
        )
        return farm
    doc = _default_farm(user_id)
    await db.weed_farms.insert_one(dict(doc))
    await _attach_exclusive_owned(doc)
    return doc


def _house(farm: dict) -> Dict[str, Any]:
    return HOUSE_BY_TIER.get(int(farm.get("house_tier") or 0)) or HOUSE_BY_TIER[0]


def _equipment_rebuy_map(farm: dict) -> Dict[str, int]:
    raw = farm.get("equipment_rebuy") if isinstance(farm.get("equipment_rebuy"), dict) else {}
    out: Dict[str, int] = {}
    for k, v in raw.items():
        try:
            lvl = int(v or 0)
        except (TypeError, ValueError):
            continue
        if lvl > 0 and k:
            out[str(k)] = lvl
    # Recover saved level from last raid steal if rebuy map was lost
    last = farm.get("last_equipment_stolen")
    if isinstance(last, dict):
        cid = str(last.get("category_id") or "").strip()
        try:
            lvl = int(last.get("level") or 0)
        except (TypeError, ValueError):
            lvl = 0
        if cid and lvl > 0:
            owned = int((_equip_levels(farm).get(cid) or 0))
            if owned < lvl:
                out[cid] = max(int(out.get(cid) or 0), lvl)
    return out


def _equip_levels(farm: dict) -> Dict[str, int]:
    raw = farm.get("equipment") or {}
    out: Dict[str, int] = {}
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        try:
            lvl = int(v or 0)
        except (TypeError, ValueError):
            continue
        if lvl > 0:
            out[str(k)] = lvl
    return out


def _auto_equip_stolen_inventory(farm: dict) -> bool:
    """Install stolen gear the house can hold; absorb same/lower duplicates. Returns True if mutated."""
    inv = list(farm.get("stolen_equipment") or [])
    if not inv:
        return False
    house_max = int(_house(farm).get("max_equip_tier") or 100)
    house_tier = int(farm.get("house_tier") or 0)
    equip = dict(farm.get("equipment") or {})
    kept: list = []
    mutated = False
    items = [x for x in inv if isinstance(x, dict)]
    if len(items) != len(inv):
        mutated = True
    # Highest level first so upgrades land before duplicate scrap.
    items.sort(key=lambda it: int(it.get("level") or 0), reverse=True)
    for item in items:
        cat_id = str(item.get("category_id") or "")
        try:
            lvl = int(item.get("level") or 0)
        except (TypeError, ValueError):
            mutated = True
            continue
        cat = EQUIPMENT_BY_ID.get(cat_id)
        if not cat or lvl <= 0:
            mutated = True
            continue
        if house_tier < int(cat.get("min_house_tier") or 0) or lvl > house_max:
            kept.append(
                {
                    "category_id": cat_id,
                    "level": lvl,
                    "name": item.get("name") or cat.get("name") or cat_id,
                }
            )
            continue
        cur = int(equip.get(cat_id) or 0)
        if lvl > cur:
            equip[cat_id] = lvl
        mutated = True
    if not mutated:
        return False
    farm["equipment"] = equip
    farm["stolen_equipment"] = kept
    return True


def _stats(farm: dict) -> Dict[str, float]:
    stats = aggregate_stats(_equip_levels(farm), _house(farm))
    return apply_exclusive_stat_bonuses(
        stats,
        owned_ids=set(farm.get("_exclusive_owned_ids") or []),
        grower_level=int(farm.get("grower_level") or 1),
    )


def _market_price_bonus(farm: dict) -> float:
    return float(_stats(farm).get("market_mult_bonus") or 1.0)


def _raid_last_by_target_map(farm: dict) -> Dict[str, str]:
    raw = farm.get("raid_last_by_target")
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if k and v}


def _raid_available_at_for_target(
    farm: dict, target_user_id: str, now: Optional[datetime] = None
) -> Optional[datetime]:
    """When this attacker can raid this target again (None = ready now)."""
    last = _parse_iso(_raid_last_by_target_map(farm).get(str(target_user_id or "")))
    if not last:
        return None
    ready = last + timedelta(hours=RAID_PER_TARGET_COOLDOWN_HOURS)
    now = now or _utcnow()
    return ready if ready > now else None


def _defender_raid_immune_until(farm: dict, now: Optional[datetime] = None) -> Optional[datetime]:
    """After a heat bust, target cannot be raided until this time (None = not protected)."""
    until = _parse_iso(farm.get("raid_immune_until"))
    if until is None:
        return None
    now = now or _utcnow()
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return until if until > now else None


def _mark_raid_against_target(farm: dict, target_user_id: str, now: Optional[datetime] = None) -> str:
    """Record a raid attempt against target; returns ISO when that target is raidable again."""
    now = now or _utcnow()
    tid = str(target_user_id or "")
    by = _raid_last_by_target_map(farm)
    by[tid] = _iso(now)
    # Drop stale entries so the map cannot grow forever
    cutoff = now - timedelta(hours=RAID_PER_TARGET_COOLDOWN_HOURS * 2)
    pruned: Dict[str, str] = {}
    for key, ts in by.items():
        dt = _parse_iso(ts)
        if not dt:
            continue
        if key == tid or dt >= cutoff:
            pruned[key] = ts if key != tid else _iso(now)
    farm["raid_last_by_target"] = pruned
    farm["raid_available_at"] = None  # clear legacy global lock
    return _iso(now + timedelta(hours=RAID_PER_TARGET_COOLDOWN_HOURS))


def _security_upgrade_progress(farm: dict) -> Dict[str, Any]:
    """How complete the security equipment tree is (0–1 fill across all lanes)."""
    levels = _equip_levels(farm)
    total_max = 0
    total_owned = 0
    lanes = []
    for cid in SECURITY_EQUIPMENT_IDS:
        cat = EQUIPMENT_BY_ID.get(cid)
        if not cat:
            continue
        mx = max(1, int(cat.get("max_level") or 1))
        owned = max(0, min(mx, int(levels.get(cid) or 0)))
        total_max += mx
        total_owned += owned
        lanes.append(
            {
                "category_id": cid,
                "name": cat.get("name") or cid,
                "owned_level": owned,
                "max_level": mx,
            }
        )
    fill = (total_owned / total_max) if total_max else 0.0
    return {
        "lanes": lanes,
        "lane_count": len(lanes),
        "owned_levels": total_owned,
        "max_levels": total_max,
        "fill": round(fill, 4),
        "fully_upgraded": fill >= 0.999,
    }


def _raid_success_chance(attacker: dict, defender: dict) -> float:
    """Attacker success rate. Full defender security → 25% success (75% fail)."""
    atk_stats = _stats(attacker)
    dfn_stats = _stats(defender)
    atk_power = (
        22.0
        + float(atk_stats.get("raid_defence") or 0) * 0.2
        + int(attacker.get("house_tier") or 0) * 4
        + max(1, int(attacker.get("grower_level") or 1)) * 0.35
    )
    dfn_power = (
        28.0
        + float(dfn_stats.get("raid_defence") or 0) * 1.05
        + float(dfn_stats.get("stash_security") or 0) * 0.7
        + int(defender.get("house_tier") or 0) * 5
        + max(1, int(defender.get("grower_level") or 1)) * 0.25
    )
    raw = atk_power / max(1.0, atk_power + dfn_power)
    sec = _security_upgrade_progress(defender)
    fill = float(sec.get("fill") or 0.0)
    # Cap slides from 75% (no security) → 25% (all security maxed).
    success_cap = RAID_SUCCESS_MAX - fill * (RAID_SUCCESS_MAX - RAID_SUCCESS_AT_MAX_SECURITY)
    if fill >= 0.999:
        chance = RAID_SUCCESS_AT_MAX_SECURITY
    else:
        chance = float(min(success_cap, max(RAID_SUCCESS_FLOOR, raw)))
    # Girl Scout Cookies: −5% success while planted on defender farm.
    gp_owned = set(defender.get("_gp_owned_ids") or [])
    if GP_GIRL_SCOUT_COOKIES in gp_owned and farm_has_strain_planted(defender, GP_GIRL_SCOUT_COOKIES):
        chance = float(chance) * GP_RAID_SUCCESS_MULT_WHEN_PLANTED
    return float(min(success_cap if fill < 0.999 else RAID_SUCCESS_AT_MAX_SECURITY, max(RAID_SUCCESS_FLOOR, chance)))


def _empty_assistant_worker() -> Dict[str, Any]:
    return {
        "hired": False,
        "enabled": False,
        "mode": "harvest",
        "level": 1,
        "last_tick_at": None,
        "last_run": None,
        "plant_strain_id": ASSISTANT_DEFAULT_PLANT_STRAIN,
        "plant_soil_type": ASSISTANT_DEFAULT_PLANT_SOIL,
    }


def _normalize_plant_soil(soil_type: Optional[str]) -> str:
    soil = (soil_type or ASSISTANT_DEFAULT_PLANT_SOIL).strip()
    return soil if soil in ASSISTANT_PLANT_SOIL_TYPES else ASSISTANT_DEFAULT_PLANT_SOIL


def _normalize_plant_strain(strain_id: Optional[str]) -> str:
    sid = (strain_id or ASSISTANT_DEFAULT_PLANT_STRAIN).strip()
    if sid in STRAIN_BY_ID:
        return sid
    if "ditch_weed" in STRAIN_BY_ID:
        return "ditch_weed"
    return ASSISTANT_DEFAULT_PLANT_STRAIN


def _assistant_hire_cost(hired_count: int) -> Optional[int]:
    if hired_count >= ASSISTANT_MAX_WORKERS:
        return None
    if hired_count < len(ASSISTANT_HIRE_COSTS):
        return int(ASSISTANT_HIRE_COSTS[hired_count])
    return int(ASSISTANT_HIRE_COSTS[-1])


def _ensure_assistants(farm: dict) -> List[Dict[str, Any]]:
    """Normalize assistants list (migrates legacy single-assistant fields)."""
    workers = farm.get("assistants")
    if not isinstance(workers, list):
        workers = []
    # Migrate legacy one-worker save
    if not workers and farm.get("assistant_hired"):
        workers = [
            {
                "hired": True,
                "enabled": bool(farm.get("assistant_enabled")),
                "mode": str(farm.get("assistant_mode") or "harvest"),
                "level": max(1, int(farm.get("assistant_level") or 1)),
                "last_tick_at": farm.get("assistant_last_tick_at"),
                "last_run": farm.get("assistant_last_run"),
            }
        ]
    # Pad / trim to max slots
    out: List[Dict[str, Any]] = []
    for i in range(ASSISTANT_MAX_WORKERS):
        if i < len(workers) and isinstance(workers[i], dict):
            w = dict(workers[i])
            mode = str(w.get("mode") or "harvest")
            if mode not in ASSISTANT_MODES:
                mode = "harvest"
            out.append(
                {
                    "hired": bool(w.get("hired")),
                    "enabled": bool(w.get("enabled")),
                    "mode": mode,
                    "level": max(1, int(w.get("level") or 1)),
                    "last_tick_at": w.get("last_tick_at"),
                    "last_run": w.get("last_run"),
                    "plant_strain_id": _normalize_plant_strain(w.get("plant_strain_id")),
                    "plant_soil_type": _normalize_plant_soil(w.get("plant_soil_type")),
                }
            )
        else:
            out.append(_empty_assistant_worker())
    farm["assistants"] = out
    _sync_legacy_assistant_fields(farm)
    return out


def _sync_legacy_assistant_fields(farm: dict) -> None:
    workers = farm.get("assistants") or []
    hired = [w for w in workers if w.get("hired")]
    primary = hired[0] if hired else None
    farm["assistant_hired"] = bool(primary)
    farm["assistant_enabled"] = bool(primary.get("enabled")) if primary else False
    farm["assistant_mode"] = str((primary or {}).get("mode") or "harvest")
    farm["assistant_level"] = max(1, int((primary or {}).get("level") or 1))
    farm["assistant_last_tick_at"] = (primary or {}).get("last_tick_at")
    farm["assistant_last_run"] = (primary or {}).get("last_run")


def _assistant_public(farm: dict) -> Dict[str, Any]:
    workers = _ensure_assistants(farm)
    hired_count = sum(1 for w in workers if w.get("hired"))
    next_cost = _assistant_hire_cost(hired_count)
    public_workers = []
    for idx, w in enumerate(workers):
        public_workers.append(
            {
                "slot": idx,
                "hired": bool(w.get("hired")),
                "enabled": bool(w.get("enabled")),
                "mode": w.get("mode") or "harvest",
                "level": max(1, int(w.get("level") or 1)),
                "last_run": w.get("last_run"),
                "plant_strain_id": _normalize_plant_strain(w.get("plant_strain_id")),
                "plant_soil_type": _normalize_plant_soil(w.get("plant_soil_type")),
                "label": f"Worker {idx + 1}",
            }
        )
    primary = next((w for w in public_workers if w["hired"]), None) or public_workers[0]
    return {
        "max_workers": ASSISTANT_MAX_WORKERS,
        "hired_count": hired_count,
        "can_hire": next_cost is not None,
        "hire_cost": next_cost,
        "hire_costs": list(ASSISTANT_HIRE_COSTS),
        "profit_share": ASSISTANT_PROFIT_SHARE,
        "modes": list(ASSISTANT_MODES),
        "workers": public_workers,
        "dealers_level": int(farm.get("dealers_level") or 0),
        "max_dealers_level": MAX_DEALERS_LEVEL,
        # Legacy single-worker shape (first hired / slot 0)
        "hired": bool(primary and primary["hired"]),
        "enabled": bool(primary and primary["enabled"]),
        "mode": (primary or {}).get("mode") or "harvest",
        "level": max(1, int((primary or {}).get("level") or 1)),
        "last_run": (primary or {}).get("last_run"),
    }


def _soil_bag_purchase_cost(farm: dict, soil_type: str) -> Tuple[int, int]:
    """Return (unit_cost for 1 bag, bag_units added). Raises ValueError if soil line locked."""
    cat_id = ASSISTANT_SOIL_EQUIP_IDS.get(soil_type)
    if not cat_id:
        raise ValueError("Invalid soil/medium")
    cat = EQUIPMENT_BY_ID.get(cat_id)
    if not cat:
        raise ValueError("Invalid soil/medium")
    if int(_equip_levels(farm).get(cat_id) or 0) < 1:
        raise ValueError("Unlock this soil line in the equipment shop first")
    lvl = max(1, int(_equip_levels(farm).get(cat_id) or 1))
    bag_units = int(cat.get("bag_units") or 4)
    unit_cost = max(200, min(12_000, equipment_level_cost(cat, lvl) // 10))
    return unit_cost, bag_units


def _ensure_soil_charge(farm: dict, soil_type: str) -> Tuple[bool, int, Optional[str]]:
    """
    Ensure at least SOIL_CHARGE_PER_PLANT in stock; auto-buy one bag from business cash if needed.
    Returns (ok, cash_spent, error_message).
    """
    stock = dict(farm.get("soil_stock") or {})
    key = soil_type if soil_type != "coco" else "coco"
    if int(stock.get(key) or 0) >= SOIL_CHARGE_PER_PLANT:
        farm["soil_stock"] = stock
        return True, 0, None
    try:
        bag_cost, bag_units = _soil_bag_purchase_cost(farm, soil_type)
    except ValueError as e:
        return False, 0, str(e)
    cash = int(farm.get("business_cash") or 0)
    if bag_cost > cash:
        return False, 0, "Not enough weed business cash for soil"
    farm["business_cash"] = cash - bag_cost
    stock[key] = int(stock.get(key) or 0) + bag_units
    farm["soil_stock"] = stock
    return True, bag_cost, None


def _assistant_strain_allowed(farm: dict, strain_id: str) -> Optional[str]:
    """Return error message if strain cannot be planted, else None. May add unlocks."""
    strain = STRAIN_BY_ID.get(strain_id)
    if not strain:
        return "Unknown strain"
    unlocks = set(farm.get("unlocks") or [])
    if is_exclusive_strain_id(strain_id) or strain.get("loot_exclusive"):
        owned = set(farm.get("_exclusive_owned_ids") or [])
        if strain_id not in owned:
            return "You do not own this exclusive loot strain"
        if int(farm.get("grower_level") or 1) < EXCLUSIVE_STRAIN_MIN_GROWER_LEVEL:
            return f"Grower Level {EXCLUSIVE_STRAIN_MIN_GROWER_LEVEL}+ required to plant exclusive strains"
        return None
    if is_game_pass_strain_id(strain_id) or strain.get("game_pass_strain"):
        owned_gp = set(farm.get("_gp_owned_ids") or [])
        if strain_id not in owned_gp:
            return "Unlock this strain from VIP Game Pass first"
        return None
    if strain_id not in unlocks and int(strain.get("unlock_house_tier") or 0) > int(farm.get("house_tier") or 0):
        return "Strain not unlocked"
    if strain_id not in unlocks and int(strain.get("unlock_house_tier") or 0) <= int(farm.get("house_tier") or 0):
        unlocks.add(strain_id)
        farm["unlocks"] = list(unlocks)
    return None


def _assistant_plant_basics_ok(farm: dict) -> Optional[str]:
    if not _equip_levels(farm).get("pots") and not _equip_levels(farm).get("hydro_system"):
        return "Need pots or a hydro system"
    if not any(
        _equip_levels(farm).get(k)
        for k in ("lights_cfl", "lights_led", "lights_hps", "lights_quantum", "lights_uv", "lights_bar_led")
    ):
        return "Need lights installed"
    return None


def _assistant_plant_one(farm: dict, strain_id: str, soil_type: str, now: datetime) -> Dict[str, Any]:
    """
    Plant one empty plot using business cash for seed (+ auto-buy soil if needed).
    Returns {ok, spent_seed, spent_soil, plot_id?, error?}.
    """
    basics = _assistant_plant_basics_ok(farm)
    if basics:
        return {"ok": False, "spent_seed": 0, "spent_soil": 0, "error": basics}
    err = _assistant_strain_allowed(farm, strain_id)
    if err:
        return {"ok": False, "spent_seed": 0, "spent_soil": 0, "error": err}
    soil_type = _normalize_plant_soil(soil_type)
    strain = STRAIN_BY_ID[strain_id]
    seed_cost = int(strain.get("seed_cost") or 0)
    cash = int(farm.get("business_cash") or 0)
    if seed_cost > cash:
        return {"ok": False, "spent_seed": 0, "spent_soil": 0, "error": "Not enough weed business cash for seeds"}

    plots = list(farm.get("plots") or [])
    empty_idx = next(
        (
            i
            for i, p in enumerate(plots)
            if p.get("state") in ("empty", "dead", None)
            or (
                not p.get("strain_id")
                and p.get("state") not in ("growing", "harvest_ready")
                and p.get("stage") not in ("seedling", "veg", "flower", "harvest_ready", "growing")
            )
        ),
        None,
    )
    if empty_idx is None:
        return {"ok": False, "spent_seed": 0, "spent_soil": 0, "error": "No empty plots"}

    ok_soil, soil_spent, soil_err = _ensure_soil_charge(farm, soil_type)
    if not ok_soil:
        return {"ok": False, "spent_seed": 0, "spent_soil": 0, "error": soil_err or "Need soil"}

    # Re-check cash after possible soil purchase
    cash = int(farm.get("business_cash") or 0)
    if seed_cost > cash:
        return {
            "ok": False,
            "spent_seed": 0,
            "spent_soil": soil_spent,
            "error": "Not enough weed business cash for seeds",
        }

    stock = dict(farm.get("soil_stock") or {})
    stock_key = soil_type if soil_type != "coco" else "coco"
    if int(stock.get(stock_key) or 0) < SOIL_CHARGE_PER_PLANT:
        return {"ok": False, "spent_seed": 0, "spent_soil": soil_spent, "error": "Need soil/medium"}
    stock[stock_key] = int(stock.get(stock_key) or 0) - SOIL_CHARGE_PER_PLANT
    farm["soil_stock"] = stock
    farm["business_cash"] = cash - seed_cost

    stats = _stats(farm)
    p = plots[empty_idx]
    base_q = 48.0 + (8.0 if soil_type == "soil_organic" else 0.0)
    plots[empty_idx] = {
        **_empty_plot(),
        "id": p["id"],
        "state": "growing",
        "strain_id": strain_id,
        "planted_at": _iso(now),
        "last_watered_at": _iso(now),
        "last_fed_at": _iso(now),
        "quality": min(float(stats.get("quality_ceiling") or 55), base_q),
        "soil_type": soil_type,
        "medium": soil_type,
        "stage": "seedling",
        "progress": 0.0,
        "mite_infestation_pct": 0.0,
        "mite_infested": False,
        "last_mite_treated_at": None,
        "last_mite_risk_at": _iso(now),
        "last_mite_damage_at": _iso(now),
    }
    farm["plots"] = plots
    return {
        "ok": True,
        "spent_seed": seed_cost,
        "spent_soil": soil_spent,
        "plot_id": p["id"],
    }


def _run_one_assistant_job(farm: dict, worker: dict, now: datetime) -> Dict[str, Any]:
    """Run one worker's job once. Mutates farm + worker."""
    mode = str(worker.get("mode") or "harvest")
    if mode not in ASSISTANT_MODES:
        mode = "harvest"
        worker["mode"] = mode
    worker["last_tick_at"] = _iso(now)
    stats = _stats(farm)
    summary: Dict[str, Any] = {"mode": mode, "at": _iso(now)}

    if mode == "harvest":
        farm_ref = _tick_environment(farm, stats, now)
        plots = [_tick_plot(dict(p), farm_ref, stats, now) for p in (farm_ref.get("plots") or [])]
        harvested = 0
        grams_total = 0.0
        for i, p in enumerate(plots):
            if p.get("stage") != "harvest_ready" and p.get("state") != "harvest_ready":
                continue
            try:
                empty, info = _harvest_ready_plot(farm_ref, p, stats, now)
                plots[i] = empty
                harvested += 1
                grams_total += float(info.get("grams") or 0)
            except Exception:
                continue
        farm["plots"] = plots
        summary.update(
            {
                "message": f"Harvested {harvested} plot{'s' if harvested != 1 else ''}",
                "plots": harvested,
                "grams": round(grams_total, 2),
            }
        )
    elif mode == "cool_heat":
        heat = float(farm.get("heat") or 0)
        drop = min(ASSISTANT_COOL_HEAT_PER_TICK, heat)
        if drop <= 0:
            summary["message"] = "Heat already cool"
            summary["heat_drop"] = 0
        else:
            cost = int(math.ceil(drop * ASSISTANT_COOL_COST_PER_POINT))
            cash = int(farm.get("business_cash") or 0)
            if cost > cash:
                drop = cash / max(1.0, ASSISTANT_COOL_COST_PER_POINT)
                cost = cash
            if drop > 0 and cost >= 0:
                farm["business_cash"] = cash - cost
                farm["heat"] = max(0.0, heat - drop)
                _track_heat_for_bust(farm, now)
                summary.update(
                    {
                        "message": f"Heat −{drop:.0f}",
                        "heat_drop": round(drop, 1),
                        "cost": cost,
                    }
                )
            else:
                summary["message"] = "Need business cash to cool heat"
                summary["heat_drop"] = 0
    elif mode == "sell_dealer":
        if int(farm.get("dealers_level") or 0) < 1:
            summary["message"] = "Unlock dealers first"
        else:
            try:
                sold = _dealer_sell_stash(farm, assistant_share=True)
                summary.update(
                    {
                        "message": (
                            f"Sold ${sold['payout']:,} "
                            f"(you ${sold['farm_gain']:,}, assistant 25% ${sold['assistant_cut']:,})"
                        ),
                        **sold,
                    }
                )
            except ValueError as e:
                summary["message"] = str(e)
    elif mode == "plant":
        strain_id = _normalize_plant_strain(worker.get("plant_strain_id"))
        soil_type = _normalize_plant_soil(worker.get("plant_soil_type"))
        worker["plant_strain_id"] = strain_id
        worker["plant_soil_type"] = soil_type
        planted = 0
        spent_seed = 0
        spent_soil = 0
        last_err: Optional[str] = None
        empty_before = sum(
            1
            for p in (farm.get("plots") or [])
            if (p.get("state") in ("empty", "dead", None) or not p.get("strain_id"))
            and (p.get("state") not in ("growing", "harvest_ready"))
        )
        # Fill every empty plot we can afford this tick
        while True:
            result = _assistant_plant_one(farm, strain_id, soil_type, now)
            if not result.get("ok"):
                last_err = str(result.get("error") or "Could not plant")
                spent_soil += int(result.get("spent_soil") or 0)
                # Unplantable loadout (revoked GP / missing exclusive / locked) → fall back
                # so the worker is not stuck failing every tick.
                if last_err in (
                    "Strain not unlocked",
                    "You do not own this exclusive loot strain",
                    "Unlock this strain from VIP Game Pass first",
                    "Unknown strain",
                ) or (
                    "Grower Level" in last_err and "exclusive" in last_err.lower()
                ):
                    fallback = _normalize_plant_strain("ditch_weed")
                    if fallback != strain_id:
                        worker["plant_strain_id"] = fallback
                        strain_id = fallback
                        last_err = f"{last_err} · loadout reset to {(STRAIN_BY_ID.get(fallback) or {}).get('name') or fallback}"
                break
            planted += 1
            spent_seed += int(result.get("spent_seed") or 0)
            spent_soil += int(result.get("spent_soil") or 0)
            # Safety: never loop forever if plot state fails to update
            if planted >= max(1, empty_before + 2):
                last_err = "Stopped after filling available plots"
                break
        strain_name = (STRAIN_BY_ID.get(strain_id) or {}).get("name") or strain_id
        total = spent_seed + spent_soil
        if planted > 0:
            msg = (
                f"Planted {planted}× {strain_name} "
                f"({soil_type.replace('_', ' ')}) · spent ${total:,}"
            )
            # Explain why remaining empties weren't filled this tick
            if last_err and last_err not in ("No empty plots", "Stopped after filling available plots"):
                msg = f"{msg} · stopped: {last_err}"
            summary.update(
                {
                    "message": msg,
                    "plots": planted,
                    "spent_seed": spent_seed,
                    "spent_soil": spent_soil,
                    "strain_id": strain_id,
                    "soil_type": soil_type,
                    "stop_reason": last_err,
                }
            )
        else:
            summary.update(
                {
                    "message": last_err or "Nothing to plant",
                    "plots": 0,
                    "spent_seed": spent_seed,
                    "spent_soil": spent_soil,
                    "strain_id": strain_id,
                    "soil_type": soil_type,
                    "stop_reason": last_err,
                }
            )
    worker["last_run"] = summary
    return summary


def _run_assistant_tick(farm: dict, now: datetime) -> Optional[Dict[str, Any]]:
    """Lazy tick for all hired+enabled workers. Each has its own mode."""
    workers = _ensure_assistants(farm)
    runs: List[Dict[str, Any]] = []
    for idx, worker in enumerate(workers):
        if not worker.get("hired") or not worker.get("enabled"):
            continue
        last = _parse_iso(worker.get("last_tick_at"))
        if last and (now - last).total_seconds() < ASSISTANT_TICK_SECONDS:
            continue
        summary = _run_one_assistant_job(farm, worker, now)
        summary["slot"] = idx
        summary["label"] = f"Worker {idx + 1}"
        runs.append(summary)
    farm["assistants"] = workers
    _sync_legacy_assistant_fields(farm)
    if not runs:
        return None
    if len(runs) == 1:
        return runs[0]
    return {
        "at": _iso(now),
        "message": " · ".join(f"{r.get('label')}: {r.get('message')}" for r in runs),
        "runs": runs,
    }


def _harvest_ready_plot(farm: dict, plot: dict, stats: dict, now: datetime) -> Tuple[dict, Dict[str, Any]]:
    """Harvest one ready plot into curing. Mutates farm fields; returns (new_empty_plot, info)."""
    strain = STRAIN_BY_ID.get(plot.get("strain_id") or "")
    if not strain:
        raise ValueError("Invalid plant")
    q = float(plot.get("quality") or 50) / 100.0
    y_min = float(strain.get("yield_g_min") or 10)
    y_max = float(strain.get("yield_g_max") or 20)
    base = y_min + (y_max - y_min) * q
    grams = base * float(stats.get("yield_mult") or 1.0)
    if plot.get("soil_type") == "soil_organic":
        grams *= 1.05
    mite_yield_penalty_pct = _mite_yield_penalty_pct(plot)
    grams *= 1.0 - mite_yield_penalty_pct / 100.0
    grams = round(max(1.0, grams), 2)
    trim_lvl = int(_equip_levels(farm).get("trimmers") or 0)
    cure_lvl = int(_equip_levels(farm).get("curing") or 0)
    cure_minutes = curing_minutes(grams, cure_lvl)
    batch = {
        "id": str(uuid.uuid4()),
        "strain_id": strain["id"],
        "grams": grams,
        "quality": float(plot.get("quality") or 50),
        "started_at": _iso(now),
        "ready_at": _iso(now + timedelta(minutes=cure_minutes)),
        "curing_minutes": round(cure_minutes, 2),
    }
    curing = list(farm.get("curing") or [])
    curing.append(batch)
    curing = _merge_curing_batches(curing, cure_lvl)
    farm["curing"] = curing
    missions = dict(farm.get("missions") or {})
    missions["harvest_count"] = int(missions.get("harvest_count") or 0) + 1
    if missions["harvest_count"] >= 10:
        farm["sabotage_unlocked"] = True
    farm["missions"] = missions
    xp_amt = int(25 * rarity_xp_mult(str(strain.get("rarity") or "common")))
    xp_fields, leveled, new_lvl = apply_grower_xp(farm, xp_amt)
    farm.update(xp_fields)
    empty = _empty_plot()
    empty["id"] = plot["id"]
    return empty, {
        "grams": grams,
        "trim_level": trim_lvl,
        "mite_yield_penalty_pct": round(mite_yield_penalty_pct, 2),
        "xp_gained": xp_amt,
        "leveled_up": leveled,
        "grower_level": new_lvl,
        "strain_id": strain["id"],
    }


def _dealer_sell_stash(farm: dict, *, assistant_share: bool = False) -> Dict[str, Any]:
    """Move stash via dealer path. Returns payout summary. Mutates farm."""
    farm = _ensure_daily_cap(farm)
    lvl = int(farm.get("dealers_level") or 0)
    if lvl < 1:
        raise ValueError("Unlock dealers by selling 5 times")
    stash = dict(farm.get("stash") or {})
    if not stash:
        raise ValueError("No stash for dealers")
    drip = dealer_drip_fraction(lvl)
    total_payout = 0
    for sid, grams in list(stash.items()):
        take = round(float(grams) * drip, 2)
        if take < 1:
            continue
        strain = STRAIN_BY_ID.get(sid)
        if not strain:
            continue
        oz = grams_to_oz(take)
        price = market_price_per_oz(
            strain,
            house_tier=int(farm.get("house_tier") or 0),
            dealers_level=lvl,
            sold_today_usd=float(farm.get("daily_sold_usd") or 0) + total_payout,
            heat=float(farm.get("heat") or 0),
            dealer_cut=0.9,
            daily_sell_cap=daily_sell_cap_for_farm(farm),
        ) * _market_price_bonus(farm)
        pay = int(math.floor(price * oz))
        remaining = daily_sell_cap_for_farm(farm) - int(farm.get("daily_sold_usd") or 0) - total_payout
        if remaining <= 0:
            break
        if pay > remaining:
            take *= remaining / pay
            pay = remaining
        stash[sid] = round(float(grams) - take, 4)
        if stash[sid] <= 0:
            stash.pop(sid, None)
        total_payout += pay
    if total_payout <= 0:
        raise ValueError("Dealers found nothing worth moving today")
    farm["stash"] = stash
    farm["daily_sold_usd"] = int(farm.get("daily_sold_usd") or 0) + total_payout
    farm["lifetime_sold_usd"] = int(farm.get("lifetime_sold_usd") or 0) + total_payout
    assistant_cut = 0
    farm_gain = total_payout
    if assistant_share:
        assistant_cut = int(math.floor(total_payout * ASSISTANT_PROFIT_SHARE))
        farm_gain = total_payout - assistant_cut
    farm["business_cash"] = int(farm.get("business_cash") or 0) + farm_gain
    return {
        "payout": total_payout,
        "farm_gain": farm_gain,
        "assistant_cut": assistant_cut,
        "dealers_level": lvl,
        "drip_fraction": drip,
    }


def _apply_heat_bust(farm: dict, user_id: str, now: datetime) -> Dict[str, Any]:
    """Punish farm on sustained high heat. Does NOT touch exclusive / Game Pass ownership."""
    soft = GP_PURPLE_PUNCH in set(farm.get("_gp_owned_ids") or [])
    tier = max(0, int(farm.get("house_tier") or 0) - 1)
    farm["house_tier"] = tier
    cash_before = max(0, int(farm.get("business_cash") or 0))
    if soft:
        farm["business_cash"] = cash_before // 2
    else:
        farm["business_cash"] = 0
    equip = dict(farm.get("equipment") or {})
    halved: Dict[str, int] = {}
    for k, v in equip.items():
        nv = max(0, int(v or 0) // 2)
        if nv > 0:
            halved[k] = nv
    # Ensure starter lights survive so farm is playable
    if not halved.get("lights_cfl") and not any(
        (EQUIPMENT_BY_ID.get(cid) or {}).get("light_class") for cid in halved
    ):
        halved["lights_cfl"] = 1
    for starter in ("pots", "soil_conventional", "tents", "irrigation", "nutes_base"):
        if starter not in halved:
            halved[starter] = 1
    farm["equipment"] = halved
    farm["stolen_equipment"] = []
    if soft:
        stash = dict(farm.get("stash") or {})
        farm["stash"] = {
            sid: round(float(g or 0) * 0.5, 4)
            for sid, g in stash.items()
            if float(g or 0) * 0.5 >= 0.01
        }
        curing = []
        for batch in farm.get("curing") or []:
            if not isinstance(batch, dict):
                continue
            grams = round(float(batch.get("grams") or 0) * 0.5, 4)
            if grams < 0.01:
                continue
            curing.append({**batch, "grams": grams})
        farm["curing"] = curing
    else:
        farm["stash"] = {}
        farm["curing"] = []
    farm["heat"] = 5.0
    farm["heat_high_since"] = None
    farm["last_heat_tick_at"] = _iso(now)
    farm["last_bust_at"] = _iso(now)
    farm["bust_restart_seed"] = True
    farm["raid_immune_until"] = _iso(now + timedelta(hours=BUST_RAID_IMMUNE_HOURS))
    farm["cleanliness_pct"] = 100.0
    farm["last_cleanliness_tick_at"] = _iso(now)
    # Heat scare — all workers flee; player must rehire after release.
    workers = _ensure_assistants(farm)
    assistant_fled = any(bool(w.get("hired")) for w in workers)
    farm["assistants"] = [_empty_assistant_worker() for _ in range(ASSISTANT_MAX_WORKERS)]
    if assistant_fled:
        farm["assistants"][0]["last_run"] = {
            "mode": None,
            "at": _iso(now),
            "message": "Crew fled after the bust — rehire required",
        }
    _sync_legacy_assistant_fields(farm)
    # Keep unlocks + grower level; exclusives / GP strains are ownership elsewhere.
    plots = [_empty_plot() for _ in range(int(_house(farm).get("plots") or 2))]
    farm["plots"] = plots
    farm = _sync_plot_count(farm)
    return {
        "house_tier": tier,
        "jail_seconds": HEAT_BUST_JAIL_SECONDS,
        "raid_immune_hours": BUST_RAID_IMMUNE_HOURS,
        "raid_immune_until": farm["raid_immune_until"],
        "restart_seed": True,
        "assistant_fled": assistant_fled,
        "soft_bust": soft,
        "business_cash_kept": int(farm.get("business_cash") or 0) if soft else 0,
    }


async def _jail_user_for_bust(user_id: str, now: datetime) -> str:
    """Jail 5 minutes for heat bust — unbustable for the full term (no friend bust / bailout)."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    else:
        now = now.astimezone(timezone.utc)
    jail_until = now + timedelta(seconds=HEAT_BUST_JAIL_SECONDS)
    jail_iso = jail_until.isoformat()
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "in_jail": True,
                "jail_until": jail_iso,
                "unbreakable_until": jail_iso,
                "snitch_attempted_this_term": False,
            },
            "$unset": {"auto_rank_next_run_at": ""},
        },
    )
    return jail_iso


def _track_heat_for_bust(farm: dict, now: datetime) -> Optional[Dict[str, Any]]:
    """If heat stayed ≥95 for 10 minutes, return bust payload (caller applies)."""
    heat = float(farm.get("heat") or 0)
    if heat >= HEAT_BUST_THRESHOLD:
        since = _parse_iso(farm.get("heat_high_since"))
        if since is None:
            farm["heat_high_since"] = _iso(now)
            return None
        if (now - since).total_seconds() >= HEAT_BUST_SUSTAIN_SECONDS:
            return {"bust": True}
        return None
    farm["heat_high_since"] = None
    return None


async def _maybe_apply_bust_and_assistant(
    farm: dict,
    user_id: str,
    *,
    username: str = "",
) -> Tuple[dict, Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """Run assistant tick + heat-bust check. Returns (farm, assistant_run, bust_info)."""
    now = _utcnow()
    await _attach_exclusive_owned(farm)
    assistant_run = _run_assistant_tick(farm, now)
    bust_info = None
    pending = _track_heat_for_bust(farm, now)
    if pending and pending.get("bust"):
        bust_detail = _apply_heat_bust(farm, user_id, now)
        jail_iso = await _jail_user_for_bust(user_id, now)
        bust_info = {**bust_detail, "jail_until": jail_iso}
        try:
            await send_notification(
                user_id,
                "Weed Empire bust",
                "Heat cooked your operation. You're in jail for 5 minutes (unbustable — nobody can bust you out). "
                f"Raid-protected for {BUST_RAID_IMMUNE_HOURS} hours. Safety Deposit cash is kept. "
                "Farm downgraded. Your assistant fled and must be rehired. Exclusive strain ownership is safe. "
                "Plant a free ditch weed seed when you're out.",
                "system",
                category="missions",
            )
        except Exception:
            pass
        try:
            await log_activity(
                user_id,
                username or "?",
                "weed_empire_bust",
                {
                    "house_tier": bust_detail.get("house_tier"),
                    "jail_until": jail_iso,
                },
            )
        except Exception:
            pass
    return farm, assistant_run, bust_info


def _ensure_daily_cap(farm: dict) -> dict:
    today = _utc_date_str()
    if farm.get("daily_sold_utc_date") != today:
        farm["daily_sold_utc_date"] = today
        farm["daily_sold_usd"] = 0
    if farm.get("daily_withdrawn_utc_date") != today:
        farm["daily_withdrawn_utc_date"] = today
        farm["daily_withdrawn_usd"] = 0
    return farm


def _daily_withdraw_cap(farm: dict) -> int:
    """Effective daily withdraw cap (Wedding Cake Game Pass strain + Distributor's Badge)."""
    base = int(DAILY_WITHDRAW_CAP_USD)
    gp = set(farm.get("_gp_owned_ids") or [])
    if GP_WEDDING_CAKE in gp:
        mult = GP_WITHDRAW_MULT_ACTIVE_VIP if farm.get("_gp_active_vip") else GP_WITHDRAW_MULT_PERMANENT
        base = int(round(base * mult))
    try:
        from utils.loot_reclaimable_passives import BUFF_WEED_WITHDRAW, get_reclaimable_passive_mults_from_user

        user_stub = {"loot_reclaimable_passive_ids": farm.get("_loot_reclaimable_passive_ids") or []}
        wmult = float(get_reclaimable_passive_mults_from_user(user_stub).get(BUFF_WEED_WITHDRAW) or 1.0)
        if wmult > 1.001:
            base = int(round(base * wmult))
    except Exception:
        pass
    return base


def _upgrade_cost_mult(farm: dict) -> float:
    if GP_GORILLA_GLUE in set(farm.get("_gp_owned_ids") or []):
        return float(GP_UPGRADE_COST_MULT)
    return 1.0


def _scaled_upgrade_cost(farm: dict, raw_cost: int) -> int:
    cost = max(0, int(raw_cost or 0))
    mult = _upgrade_cost_mult(farm)
    if mult >= 0.999:
        return cost
    return max(1, int(round(cost * mult))) if cost > 0 else 0


def _withdrawable_cash(farm: dict) -> int:
    """Cash that can leave the farm now (reserve + daily withdraw cap)."""
    farm = _ensure_daily_cap(farm)
    cash = int(farm.get("business_cash") or 0)
    after_reserve = max(0, cash - MIN_BUSINESS_CASH_RESERVE)
    withdrawn = int(farm.get("daily_withdrawn_usd") or 0)
    remaining_cap = max(0, _daily_withdraw_cap(farm) - withdrawn)
    return min(after_reserve, remaining_cap)


def _grow_hours_needed(strain: dict, stats: dict, preferred_ok: bool) -> float:
    base = float(strain.get("base_grow_hours") or 4.0)
    speed = float(stats.get("grow_speed_mult") or 1.0)
    hours = base / max(0.35, speed)
    if preferred_ok:
        hours *= 0.95
    return max(0.75, hours)


def _plot_stage(planted_at: datetime, hours_needed: float, now: datetime) -> Tuple[str, float]:
    elapsed = max(0.0, (now - planted_at).total_seconds() / 3600.0)
    progress = min(1.0, elapsed / max(0.01, hours_needed))
    if progress >= 1.0:
        return "harvest_ready", 1.0
    if progress >= 0.7:
        return "flower", progress
    if progress >= 0.35:
        return "veg", progress
    return "seedling", progress


def _care_intervals(stats: dict) -> Tuple[float, float]:
    water_need = WATER_INTERVAL_HOURS / max(0.5, float(stats.get("water_interval_mult") or 1.0))
    feed_need = FEED_INTERVAL_HOURS / max(0.5, float(stats.get("feed_efficiency") or 1.0))
    return water_need, feed_need


def _auto_flags(farm: dict) -> Tuple[bool, bool]:
    irrig = int(_equip_levels(farm).get("irrigation") or 0)
    return irrig >= AUTO_WATER_IRRIGATION_LEVEL, irrig >= AUTO_FEED_IRRIGATION_LEVEL


def _active_plot_count(farm: dict) -> int:
    return sum(1 for p in (farm.get("plots") or []) if p.get("state") in ("growing", "harvest_ready"))


def _scavenged_seed_available(farm: dict) -> bool:
    starter = STRAIN_BY_ID.get("ditch_weed") or {}
    seed_cost = int(starter.get("seed_cost") or 0)
    return (
        _active_plot_count(farm) == 0
        and (
            int(farm.get("business_cash") or 0) < seed_cost
            or int((farm.get("soil_stock") or {}).get("soil_conventional") or 0) < SOIL_CHARGE_PER_PLANT
        )
    )


def _cleanliness_decay_per_hour(farm: dict, stats: dict) -> float:
    active = _active_plot_count(farm)
    reduction = min(0.48, max(0.0, 1.0 - float(stats.get("cleanliness_decay_mult") or 1.0)))
    raw = CLEANLINESS_BASE_DECAY_PER_HOUR + CLEANLINESS_ACTIVE_PLOT_DECAY_PER_HOUR * active
    return raw * (1.0 - reduction)


def _mite_resistance(stats: dict) -> float:
    return min(0.72, max(0.0, float(stats.get("mite_resistance") or 0.0)))


def _mite_treatment_effect_pct(stats: dict) -> float:
    bonus = max(0.0, float(stats.get("mite_treatment_bonus") or 0.0))
    return min(95.0, MITE_TREATMENT_BASE_EFFECT_PCT + bonus)


def _mite_yield_penalty_pct(plot: dict) -> float:
    infestation = min(100.0, max(0.0, float(plot.get("mite_infestation_pct") or 0.0)))
    return MITE_MAX_HARVEST_YIELD_PENALTY_PCT * infestation / 100.0


def _mite_treatment_cost(plot: dict) -> int:
    infestation = min(100.0, max(0.0, float(plot.get("mite_infestation_pct") or 0.0)))
    return MITE_TREATMENT_BASE_COST + int(math.ceil(infestation * MITE_TREATMENT_COST_PER_PCT))


def _clean_room_cost(farm: dict) -> int:
    return (
        CLEAN_ROOM_BASE_COST
        + int(farm.get("house_tier") or 0) * CLEAN_ROOM_HOUSE_TIER_COST
        + _active_plot_count(farm) * CLEAN_ROOM_ACTIVE_PLOT_COST
    )


def _cool_off_cost(heat: float) -> int:
    """Business-cash cost to fully clear current heat (middle-ground pricing)."""
    h = max(0.0, min(MAX_HEAT, float(heat or 0)))
    if h < 0.5:
        return 0
    return int(round(COOL_OFF_BASE_COST + h * COOL_OFF_COST_PER_HEAT))


def _heat_hotness(farm: dict, stats: dict) -> float:
    """0.0 = coolest farms (near 3%/hr), 1.0 = hottest (near 8%/hr)."""
    mult = float(stats.get("heat_gain_mult") or 1.0)
    # climate/LA Conf pull mult down; hot lights push it up
    hotness = (mult - 0.25) / 1.15
    hotness = max(0.0, min(1.0, hotness))
    grower = max(1, int(farm.get("grower_level") or 1))
    grower_relief = min(0.28, (grower - 1) * 0.014)
    house_decay = float(_house(farm).get("heat_decay") or 0.5)
    house_relief = min(0.12, max(0.0, (house_decay - 0.5) / 1.5) * 0.12)
    return max(0.0, hotness - grower_relief - house_relief)


def _passive_heat_rate_band(farm: dict, stats: dict) -> Tuple[float, float]:
    """Equipment/grower-biased sub-band inside 3–8%/hr."""
    hotness = _heat_hotness(farm, stats)
    lo = HEAT_PASSIVE_MIN_PER_HOUR + hotness * 3.5  # 3.0 → 6.5
    hi = HEAT_PASSIVE_MIN_PER_HOUR + 1.25 + hotness * 3.75  # 4.25 → 8.0
    hi = min(HEAT_PASSIVE_MAX_PER_HOUR, hi)
    lo = max(HEAT_PASSIVE_MIN_PER_HOUR, min(lo, hi))
    return round(lo, 2), round(hi, 2)


def _roll_passive_heat_rate(farm: dict, stats: dict) -> float:
    lo, hi = _passive_heat_rate_band(farm, stats)
    return float(_rng.uniform(lo, hi))


def _tick_passive_heat(farm: dict, stats: dict, now: datetime) -> dict:
    """Raise heat 3–8% per hour (gear/level biased random band)."""
    last = _parse_iso(farm.get("last_heat_tick_at"))
    if last is None:
        farm["last_heat_tick_at"] = _iso(now)
        lo, hi = _passive_heat_rate_band(farm, stats)
        farm["heat_gain_rate_band"] = [lo, hi]
        return farm
    elapsed = max(0.0, (now - last).total_seconds() / 3600.0)
    if elapsed < (1.0 / 120.0):
        return farm
    remaining = elapsed
    gain = 0.0
    last_rate = HEAT_PASSIVE_MIN_PER_HOUR
    while remaining > 1e-9:
        chunk = min(1.0, remaining)
        last_rate = _roll_passive_heat_rate(farm, stats)
        gain += last_rate * chunk
        remaining -= chunk
    farm["heat"] = min(MAX_HEAT, max(0.0, float(farm.get("heat") or 0) + gain))
    farm["last_heat_tick_at"] = _iso(now)
    lo, hi = _passive_heat_rate_band(farm, stats)
    farm["heat_gain_rate_band"] = [lo, hi]
    farm["heat_gain_last_rate"] = round(last_rate, 2)
    return farm


def _deterministic_mite_roll(farm: dict, plot: dict, interval_at: datetime) -> float:
    key = f"{farm.get('id')}:{plot.get('id')}:{interval_at.isoformat()}".encode("utf-8")
    digest = hashlib.sha256(key).digest()
    return int.from_bytes(digest[:8], "big") / float(2**64)


def _clear_plot_mites(plot: dict) -> None:
    plot["mite_infestation_pct"] = 0.0
    plot["mite_infested"] = False
    plot.setdefault("last_mite_treated_at", None)
    plot["last_mite_risk_at"] = None
    plot["last_mite_damage_at"] = None


def _tick_environment(farm: dict, stats: dict, now: datetime) -> dict:
    farm = _tick_passive_heat(farm, stats, now)
    last_clean = _parse_iso(farm.get("last_cleanliness_tick_at")) or now
    elapsed_hours = max(0.0, (now - last_clean).total_seconds() / 3600.0)
    decay_rate = _cleanliness_decay_per_hour(farm, stats)
    cleanliness_before = min(100.0, max(0.0, float(farm.get("cleanliness_pct", 100.0))))
    cleanliness = max(0.0, cleanliness_before - elapsed_hours * decay_rate)
    farm["cleanliness_pct"] = round(cleanliness, 2)
    farm["last_cleanliness_tick_at"] = _iso(now)

    active_count = _active_plot_count(farm)
    resistance = _mite_resistance(stats)
    dirty_severity = max(0.0, (CLEANLINESS_SAFE_PCT - cleanliness) / CLEANLINESS_SAFE_PCT)
    risk_chance = min(
        0.65,
        (
            MITE_BASE_RISK_CHANCE
            + dirty_severity * MITE_MAX_DIRT_RISK_CHANCE
            + max(0, active_count - 1) * MITE_ACTIVE_PLOT_RISK_CHANCE
        )
        * (1.0 - resistance),
    )

    plots = []
    for source in (farm.get("plots") or []):
        plot = dict(source)
        plot.setdefault("last_mite_treated_at", None)
        if plot.get("state") not in ("growing", "harvest_ready"):
            _clear_plot_mites(plot)
            plots.append(plot)
            continue

        infestation = min(100.0, max(0.0, float(plot.get("mite_infestation_pct") or 0.0)))
        last_risk = _parse_iso(plot.get("last_mite_risk_at")) or now
        if cleanliness >= CLEANLINESS_SAFE_PCT:
            last_risk = now
        else:
            dirty_started_at = last_clean
            if cleanliness_before >= CLEANLINESS_SAFE_PCT and decay_rate > 0:
                hours_until_dirty = (cleanliness_before - CLEANLINESS_SAFE_PCT) / decay_rate
                dirty_started_at = min(now, last_clean + timedelta(hours=hours_until_dirty))
            last_risk = max(last_risk, dirty_started_at)
            interval_seconds = MITE_RISK_INTERVAL_HOURS * 3600.0
            intervals = min(168, int(max(0.0, (now - last_risk).total_seconds()) // interval_seconds))
            for step in range(1, intervals + 1):
                interval_at = last_risk + timedelta(hours=step * MITE_RISK_INTERVAL_HOURS)
                if _deterministic_mite_roll(farm, plot, interval_at) < risk_chance:
                    increase = MITE_NEW_INFESTATION_PCT if infestation <= 0 else MITE_EXISTING_GROWTH_PCT
                    infestation = min(100.0, infestation + increase * (1.0 - resistance))
            if intervals:
                last_risk = now if intervals >= 168 else last_risk + timedelta(hours=intervals)

        last_damage = _parse_iso(plot.get("last_mite_damage_at")) or now
        damage_hours = max(0.0, (now - last_damage).total_seconds() / 3600.0)
        quality_drain = damage_hours * MITE_QUALITY_DRAIN_PER_HOUR * (infestation / 100.0)
        if quality_drain > 0:
            plot["quality"] = max(0.0, float(plot.get("quality") or 50.0) - quality_drain)
        plot["mite_infestation_pct"] = round(infestation, 2)
        plot["mite_infested"] = infestation > 0
        plot["last_mite_risk_at"] = _iso(last_risk)
        plot["last_mite_damage_at"] = _iso(now)
        plot["mite_quality_drain_applied"] = round(quality_drain, 3)
        plots.append(plot)
    farm["plots"] = plots
    return farm


def _meter_pct(hours_since: float, interval: float) -> float:
    """100 = just tended; 0 = fully due."""
    if interval <= 0:
        return 0.0
    return max(0.0, min(100.0, (1.0 - hours_since / interval) * 100.0))


def _tick_plot(plot: dict, farm: dict, stats: dict, now: datetime) -> dict:
    if plot.get("state") in (None, "empty", "dead"):
        _clear_plot_mites(plot)
        plot["stage"] = plot.get("state") or "empty"
        plot["progress"] = 0.0
        plot["water_pct"] = 0
        plot["feed_pct"] = 0
        plot["water_hours_left"] = 0
        plot["feed_hours_left"] = 0
        plot["needs_water"] = False
        plot["needs_feed"] = False
        return plot
    strain = STRAIN_BY_ID.get(plot.get("strain_id") or "")
    if not strain:
        plot["state"] = "dead"
        plot["stage"] = "dead"
        _clear_plot_mites(plot)
        return plot

    planted = _parse_iso(plot.get("planted_at"))
    if not planted:
        return plot

    light = active_light_class(_equip_levels(farm))
    pref = (strain.get("preferred_light") or "either").lower()
    preferred_ok = pref == "either" or pref == light or (pref == "hps" and light in ("hps", "quantum")) or (
        pref == "led" and light in ("led", "quantum")
    )

    auto_water, auto_feed = _auto_flags(farm)
    water_need, feed_need = _care_intervals(stats)

    # Auto systems top up before neglect checks (when interval is nearly due).
    last_w = _parse_iso(plot.get("last_watered_at")) or planted
    last_f = _parse_iso(plot.get("last_fed_at")) or planted
    hours_since_w = (now - last_w).total_seconds() / 3600.0
    hours_since_f = (now - last_f).total_seconds() / 3600.0
    if auto_water and hours_since_w >= water_need * 0.85:
        plot["last_watered_at"] = _iso(now)
        last_w = now
        hours_since_w = 0.0
        plot["quality"] = min(100.0, float(plot.get("quality") or 50) + 0.5)
        plot["auto_watered"] = True
    if auto_feed and hours_since_f >= feed_need * 0.85:
        plot["last_fed_at"] = _iso(now)
        last_f = now
        hours_since_f = 0.0
        plot["quality"] = min(100.0, float(plot.get("quality") or 50) + 0.5)
        plot["auto_fed"] = True

    quality = float(plot.get("quality") or 50.0)
    water_overdue = hours_since_w > water_need * 1.35
    feed_overdue = hours_since_f > feed_need * 1.5
    neglect = (1 if water_overdue else 0) + (1 if feed_overdue else 0)
    if neglect:
        quality -= 4.0 * neglect
    if water_overdue and hours_since_w > water_need * 3.0:
        plot["state"] = "dead"
        plot["stage"] = "dead"
        plot["quality"] = max(0.0, quality)
        plot["water_pct"] = 0
        plot["feed_pct"] = _meter_pct(hours_since_f, feed_need)
        plot["needs_water"] = True
        plot["needs_feed"] = feed_overdue
        _clear_plot_mites(plot)
        return plot

    hours_needed = _grow_hours_needed(strain, stats, preferred_ok)
    if neglect:
        hours_needed *= 1.0 + 0.25 * neglect

    stage, progress = _plot_stage(planted, hours_needed, now)
    ceiling = float(stats.get("quality_ceiling") or 55.0)
    quality = min(ceiling, max(5.0, quality))
    plot["quality"] = round(quality, 1)
    plot["stage"] = stage
    plot["progress"] = round(progress, 4)
    plot["state"] = "harvest_ready" if stage == "harvest_ready" else "growing"
    plot["hours_needed"] = round(hours_needed, 2)
    plot["hours_elapsed"] = round((now - planted).total_seconds() / 3600.0, 2)
    plot["hours_to_harvest"] = round(max(0.0, hours_needed - plot["hours_elapsed"]), 2)
    plot["water_pct"] = round(_meter_pct(hours_since_w, water_need), 1)
    plot["feed_pct"] = round(_meter_pct(hours_since_f, feed_need), 1)
    plot["water_hours_left"] = round(max(0.0, water_need - hours_since_w), 2)
    plot["feed_hours_left"] = round(max(0.0, feed_need - hours_since_f), 2)
    plot["water_interval_hours"] = round(water_need, 2)
    plot["feed_interval_hours"] = round(feed_need, 2)
    plot["needs_water"] = water_overdue or plot["water_pct"] <= 25
    plot["needs_feed"] = feed_overdue or plot["feed_pct"] <= 25
    yield_penalty = _mite_yield_penalty_pct(plot)
    plot["mite_quality_drain_per_hour"] = round(
        MITE_QUALITY_DRAIN_PER_HOUR * float(plot.get("mite_infestation_pct") or 0.0) / 100.0, 4
    )
    plot["mite_yield_penalty_pct"] = round(yield_penalty, 2)
    plot["mite_yield_mult"] = round(1.0 - yield_penalty / 100.0, 4)
    plot["mite_treatment_cost"] = _mite_treatment_cost(plot) if plot.get("mite_infested") else 0
    return plot


def _merge_curing_batches(curing: list, cure_level: int = 0) -> list:
    """One curing row per strain_id — combine grams (weighted quality), keep earliest start / latest ready."""
    by_strain: Dict[str, dict] = {}
    order: List[str] = []
    for raw in curing or []:
        sid = str((raw or {}).get("strain_id") or "")
        grams = float((raw or {}).get("grams") or 0)
        if not sid or grams <= 0:
            continue
        if sid not in by_strain:
            by_strain[sid] = dict(raw)
            by_strain[sid]["grams"] = round(grams, 2)
            order.append(sid)
            continue
        dest = by_strain[sid]
        old_g = float(dest.get("grams") or 0)
        new_g = old_g + grams
        old_q = float(dest.get("quality") or 50)
        add_q = float((raw or {}).get("quality") or 50)
        dest["quality"] = round((old_q * old_g + add_q * grams) / new_g, 1) if new_g > 0 else old_q
        dest["grams"] = round(new_g, 2)
        a = _parse_iso(dest.get("started_at"))
        b = _parse_iso((raw or {}).get("started_at"))
        if a and b and b < a:
            dest["started_at"] = (raw or {}).get("started_at")
        elif not a and b:
            dest["started_at"] = (raw or {}).get("started_at")
        ra = _parse_iso(dest.get("ready_at"))
        rb = _parse_iso((raw or {}).get("ready_at"))
        if ra and rb and rb > ra:
            dest["ready_at"] = (raw or {}).get("ready_at")
        elif not ra and rb:
            dest["ready_at"] = (raw or {}).get("ready_at")
    out = []
    for sid in order:
        batch = by_strain[sid]
        mins = curing_minutes(float(batch.get("grams") or 0), cure_level)
        batch["curing_minutes"] = round(mins, 2)
        out.append(batch)
    return out


def _tick_curing(farm: dict, now: datetime) -> dict:
    cure_level = int(_equip_levels(farm).get("curing") or 0)
    curing = _merge_curing_batches(list(farm.get("curing") or []), cure_level)
    stash = dict(farm.get("stash") or {})
    still = []
    for raw_batch in curing:
        batch = dict(raw_batch)
        ready_at = _parse_iso(batch.get("ready_at"))
        started_at = _parse_iso(batch.get("started_at"))
        minutes = curing_minutes(float(batch.get("grams") or 0), cure_level)
        expected_ready_at = started_at + timedelta(minutes=minutes) if started_at else None
        if expected_ready_at and (not ready_at or ready_at > expected_ready_at):
            ready_at = expected_ready_at
            batch["ready_at"] = _iso(expected_ready_at)
        batch["curing_minutes"] = round(minutes, 2)
        if ready_at and now >= ready_at:
            sid = str(batch.get("strain_id") or "")
            grams = float(batch.get("grams") or 0)
            if sid and grams > 0:
                stash[sid] = round(float(stash.get(sid) or 0) + grams, 2)
        else:
            still.append(batch)
    farm["curing"] = still
    farm["stash"] = stash
    return farm


def _sync_plot_count(farm: dict) -> dict:
    house = _house(farm)
    want = int(house["plots"])
    plots = list(farm.get("plots") or [])
    while len(plots) < want:
        plots.append(_empty_plot())
    if len(plots) > want:
        # Prefer dropping empty plots from the end
        kept = [p for p in plots if p.get("state") not in ("empty", None)]
        empties = [p for p in plots if p.get("state") in ("empty", None)]
        plots = (kept + empties)[:want]
    farm["plots"] = plots
    return farm


def _public_farm(farm: dict, *, username: str = "", apply_curing_tick: bool = True) -> Dict[str, Any]:
    now = _utcnow()
    farm = _ensure_daily_cap(dict(farm))
    farm = _sync_plot_count(farm)
    stats = _stats(farm)
    farm = _tick_environment(farm, stats, now)
    plots = [_tick_plot(dict(p), farm, stats, now) for p in (farm.get("plots") or [])]
    # Persist auto-tend timestamps back onto farm plots
    farm["plots"] = plots
    if apply_curing_tick:
        farm = _tick_curing(farm, now)
    light = active_light_class(_equip_levels(farm))
    house = _house(farm)
    sold = int(farm.get("daily_sold_usd") or 0)
    withdrawn_today = int(farm.get("daily_withdrawn_usd") or 0)
    market_bonus = float(stats.get("market_mult_bonus") or 1.0)
    sell_cap = daily_sell_cap_for_farm(farm)
    cap_tiers = daily_cap_bonus_tiers(farm)
    bank_cap = safety_bank_capacity(farm)
    bank_units = safety_bank_capacity_units(farm)
    bank_cash = max(0, int(farm.get("safety_bank_cash") or 0))
    street_prices = {
        strain["id"]: round(
            market_price_per_oz(
                strain,
                house_tier=int(farm.get("house_tier") or 0),
                dealers_level=int(farm.get("dealers_level") or 0),
                sold_today_usd=sold,
                heat=float(farm.get("heat") or 0),
                daily_sell_cap=sell_cap,
            )
            * market_bonus,
            2,
        )
        for strain in STRAINS
    }
    owned_exclusive = set(farm.get("_exclusive_owned_ids") or [])
    exclusive_owned = exclusive_buffs_public(
        owned_exclusive,
        grower_level=int(farm.get("grower_level") or 1),
    )
    owned_gp = set(farm.get("_gp_owned_ids") or [])
    gp_strains = game_pass_buffs_public(
        owned_gp,
        active_vip=bool(farm.get("_gp_active_vip")),
    )
    auto_water, auto_feed = _auto_flags(farm)
    irrig_lvl = int(_equip_levels(farm).get("irrigation") or 0)
    gp = grower_progress(farm)
    raid_immune_until = _defender_raid_immune_until(farm, now)
    # Heal / recover raid rebuy map before shop status (lost map or last-steal recovery)
    healed_rebuy = _equipment_rebuy_map(farm)
    farm["equipment_rebuy"] = healed_rebuy
    shop = shop_status_for_farm(
        farm,
        house_tier=int(farm.get("house_tier") or 0),
        house_max_equip_tier=int(house.get("max_equip_tier") or 20),
        equipment_levels=_equip_levels(farm),
    )
    cost_mult = _upgrade_cost_mult(farm)
    if cost_mult < 0.999:
        for row in shop:
            if not isinstance(row, dict):
                continue
            nc = row.get("next_cost")
            if nc is not None:
                try:
                    row["next_cost"] = _scaled_upgrade_cost(farm, int(nc))
                except (TypeError, ValueError):
                    pass
    return {
        "id": farm.get("id"),
        "user_id": farm.get("user_id"),
        "username": username,
        "house": house,
        "house_tier": int(farm.get("house_tier") or 0),
        "plots": plots,
        "equipment": _equip_levels(farm),
        "equipment_shop_status": shop,
        "soil_stock": farm.get("soil_stock") or {},
        "business_cash": int(farm.get("business_cash") or 0),
        "business_cash_reserve": MIN_BUSINESS_CASH_RESERVE,
        "withdrawable_cash": _withdrawable_cash(farm),
        "daily_withdraw_cap": _daily_withdraw_cap(farm),
        "daily_withdrawn_usd": withdrawn_today,
        "daily_withdraw_remaining": max(0, _daily_withdraw_cap(farm) - withdrawn_today),
        "daily_sold_usd": sold,
        "daily_sold_cap": sell_cap,
        "daily_sold_remaining": max(0, sell_cap - sold),
        "daily_sell_cap_base": DAILY_SELL_CAP_USD,
        "daily_sell_cap_step": DAILY_SELL_CAP_STEP_USD,
        "daily_cap_bonus_tiers": cap_tiers,
        "daily_cap_bonus_max_tiers": DAILY_CAP_BONUS_MAX_TIERS,
        "daily_cap_next_cost_points": (
            None if cap_tiers >= DAILY_CAP_BONUS_MAX_TIERS else DAILY_SELL_CAP_POINTS_COST
        ),
        "lifetime_sold_usd": int(farm.get("lifetime_sold_usd") or 0),
        "stash": dict(farm.get("stash") or {}),
        "curing": list(farm.get("curing") or []),
        "updated_at": farm.get("updated_at"),
        "street_price_per_oz": street_prices,
        "heat": round(float(farm.get("heat") or 0), 1),
        "heat_gain_rate_min": HEAT_PASSIVE_MIN_PER_HOUR,
        "heat_gain_rate_max": HEAT_PASSIVE_MAX_PER_HOUR,
        "heat_gain_rate_band": list(farm.get("heat_gain_rate_band") or _passive_heat_rate_band(farm, stats)),
        "heat_gain_last_rate": farm.get("heat_gain_last_rate"),
        "cool_off_cost": _cool_off_cost(float(farm.get("heat") or 0)),
        "last_heat_tick_at": farm.get("last_heat_tick_at"),
        "cleanliness_pct": round(float(farm.get("cleanliness_pct", 100.0)), 2),
        "last_cleanliness_tick_at": farm.get("last_cleanliness_tick_at"),
        "cleanliness": {
            "pct": round(float(farm.get("cleanliness_pct", 100.0)), 2),
            "safe_at_or_above_pct": CLEANLINESS_SAFE_PCT,
            "is_safe": float(farm.get("cleanliness_pct", 100.0)) >= CLEANLINESS_SAFE_PCT,
            "decay_per_hour": round(_cleanliness_decay_per_hour(farm, stats), 4),
            "clean_room_cost": _clean_room_cost(farm),
            "active_plots": _active_plot_count(farm),
            "pest_ipm_level": int(_equip_levels(farm).get("pest_ipm") or 0),
            "mite_resistance_pct": round(_mite_resistance(stats) * 100.0, 2),
            "mite_risk_interval_hours": MITE_RISK_INTERVAL_HOURS,
            "mite_quality_drain_max_per_hour": MITE_QUALITY_DRAIN_PER_HOUR,
            "mite_harvest_yield_penalty_cap_pct": MITE_MAX_HARVEST_YIELD_PENALTY_PCT,
            "mite_treatment_effect_pct": round(_mite_treatment_effect_pct(stats), 2),
        },
        "unlocks": list(farm.get("unlocks") or []),
        "exclusive_strains": exclusive_owned,
        "exclusive_strain_ids": sorted(owned_exclusive),
        "exclusive_min_grower_level": EXCLUSIVE_STRAIN_MIN_GROWER_LEVEL,
        "game_pass_strains": gp_strains,
        "game_pass_strain_ids": sorted(owned_gp),
        "upgrade_cost_mult": _upgrade_cost_mult(farm),
        "stats": {k: round(float(v), 4) if isinstance(v, float) else v for k, v in stats.items()},
        "active_light_class": light,
        "raid_stats": farm.get("raid_stats") or {},
        "raid_available_at": None,
        "raid_ready": True,
        "raid_cooldown_hours": RAID_PER_TARGET_COOLDOWN_HOURS,
        "raid_cooldown_scope": "per_target",
        "security": _security_upgrade_progress(farm),
        "raid_success_at_max_security": RAID_SUCCESS_AT_MAX_SECURITY,
        "raid_success_max": RAID_SUCCESS_MAX,
        "dealers_level": int(farm.get("dealers_level") or 0),
        "max_dealers_level": MAX_DEALERS_LEVEL,
        "dealers_upgrade_cost": (
            _scaled_upgrade_cost(farm, dealers_upgrade_cost(int(farm.get("dealers_level") or 0)))
            if 1 <= int(farm.get("dealers_level") or 0) < MAX_DEALERS_LEVEL
            else None
        ),
        "dealer_drip_fraction": dealer_drip_fraction(int(farm.get("dealers_level") or 0)),
        "stolen_equipment": list(farm.get("stolen_equipment") or []),
        "equipment_rebuy": dict(farm.get("equipment_rebuy") or {}),
        "last_equipment_stolen": farm.get("last_equipment_stolen"),
        "assistant": _assistant_public(farm),
        "heat_high_since": farm.get("heat_high_since"),
        "heat_bust_threshold": HEAT_BUST_THRESHOLD,
        "last_bust_at": farm.get("last_bust_at"),
        "bust_restart_seed": bool(farm.get("bust_restart_seed")),
        "bust_raid_immune_hours": BUST_RAID_IMMUNE_HOURS,
        "raid_immune_until": _iso(raid_immune_until) if raid_immune_until else None,
        "raid_immune": raid_immune_until is not None,
        "missions": farm.get("missions") or {},
        "sabotage_unlocked": bool(farm.get("sabotage_unlocked")),
        "auto_water": auto_water,
        "auto_feed": auto_feed,
        "irrigation_level": irrig_lvl,
        "auto_water_at_irrigation": AUTO_WATER_IRRIGATION_LEVEL,
        "auto_feed_at_irrigation": AUTO_FEED_IRRIGATION_LEVEL,
        "scavenged_seed_available": _scavenged_seed_available(farm) or bool(farm.get("bust_restart_seed")),
        "scavenged_strain_id": "ditch_weed",
        "scavenged_soil_type": "soil_conventional",
        "safety_bank_unlocked": safety_bank_unlocked(farm),
        "safety_bank_cash": bank_cash,
        "safety_bank_capacity": bank_cap,
        "safety_bank_capacity_units": bank_units,
        "safety_bank_unit_capacity": SAFETY_BANK_UNIT_CAPACITY,
        "safety_bank_unit_cost": SAFETY_BANK_UNIT_COST,
        "safety_bank_max_units": SAFETY_BANK_MAX_UNITS,
        "safety_bank_unlock_points": SAFETY_BANK_UNLOCK_POINTS,
        "safety_bank_can_expand": safety_bank_unlocked(farm) and bank_units < SAFETY_BANK_MAX_UNITS,
        **gp,
        "staff_preview": True,
    }


async def _weed_farm_lock(user_id: str) -> asyncio.Lock:
    uid = str(user_id or "")
    async with _weed_farm_locks_guard:
        lock = _weed_farm_locks.get(uid)
        if lock is None:
            lock = asyncio.Lock()
            _weed_farm_locks[uid] = lock
        return lock


async def _save_farm(
    farm: dict,
    update: Dict[str, Any],
    *,
    expected_updated_at: Optional[str] = None,
) -> bool:
    """Persist farm fields. When ``expected_updated_at`` is set, refuse stale overwrites.

    Returns False if optimistic concurrency check failed (another writer won).
    """
    update = dict(update)
    update["updated_at"] = _iso()
    filt: Dict[str, Any] = {"user_id": farm["user_id"]}
    if expected_updated_at is not None:
        filt["updated_at"] = expected_updated_at
    res = await db.weed_farms.update_one(filt, {"$set": update})
    if expected_updated_at is not None and int(res.matched_count or 0) == 0:
        return False
    farm.update(update)
    return True


def _spend(farm: dict, cost: int) -> None:
    cash = int(farm.get("business_cash") or 0)
    if cost > cash:
        raise HTTPException(status_code=400, detail="Not enough weed business cash")
    farm["business_cash"] = cash - cost


def _add_heat(farm: dict, amount: float) -> None:
    mult = float(_stats(farm).get("heat_gain_mult") or 1.0)
    farm["heat"] = min(MAX_HEAT, max(0.0, float(farm.get("heat") or 0) + amount * max(0.05, mult)))


def _weed_action_code_bucket(now: Optional[float] = None) -> int:
    return int((time.time() if now is None else now) // WEED_ACTION_CODE_BUCKET_SECONDS)


def _weed_action_code_field_name(bucket: int) -> str:
    secret = str(SECRET_KEY or "weed-action-code").encode("utf-8", "ignore")
    digest = hmac.new(secret, f"weed-action-field:{bucket}".encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{WEED_ACTION_CODE_PREFIX}{digest[:16]}"


def _weed_action_code_token(user_id: str, bucket: int) -> str:
    secret = str(SECRET_KEY or "weed-action-code").encode("utf-8", "ignore")
    return hmac.new(
        secret,
        f"weed-action-token:{user_id}:{bucket}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _weed_action_code_payload(user_id: str) -> Dict[str, Any]:
    bucket = _weed_action_code_bucket()
    name = _weed_action_code_field_name(bucket)
    return {
        "action_code_name": name,
        "action_code_bucket": bucket,
        name: _weed_action_code_token(str(user_id or ""), bucket),
    }


async def _require_weed_action_code(request: Request, current_user: dict) -> None:
    try:
        raw = await request.json()
        body = raw if isinstance(raw, dict) else {}
    except Exception:
        body = {}
    current_bucket = _weed_action_code_bucket()
    accepted = {
        _weed_action_code_field_name(current_bucket): current_bucket,
        _weed_action_code_field_name(current_bucket - 1): current_bucket - 1,
    }
    hinted = body.get("action_code_name")
    submitted = body.get(hinted) if isinstance(hinted, str) and hinted in accepted else None
    bucket = accepted.get(hinted) if isinstance(hinted, str) else None
    if not isinstance(submitted, str):
        for name, candidate_bucket in accepted.items():
            value = body.get(name)
            if isinstance(value, str):
                submitted = value
                bucket = candidate_bucket
                break
    expected = _weed_action_code_token(str(current_user.get("id") or ""), int(bucket or current_bucket))
    if isinstance(submitted, str) and secrets.compare_digest(submitted.strip(), expected):
        return
    logger.warning(
        "Weed action rejected: missing/invalid hidden code user=%s path=%s",
        current_user.get("id"),
        request.url.path,
    )
    raise HTTPException(
        status_code=400,
        detail="Security code expired or missing. Refresh Weed Empire and try again. Do not use bots or automated tools.",
    )


# ---- Requests ----
MAX_BULK_PLOTS = 64


def _resolve_plot_ids(*, plot_id: Optional[str] = None, plot_ids: Optional[List[str]] = None) -> List[str]:
    """Accept single plot_id and/or plot_ids; dedupe while preserving order."""
    out: List[str] = []
    seen = set()
    for raw in list(plot_ids or []) + ([plot_id] if plot_id else []):
        pid = str(raw or "").strip()
        if not pid or pid in seen:
            continue
        seen.add(pid)
        out.append(pid)
        if len(out) >= MAX_BULK_PLOTS:
            break
    if not out:
        raise HTTPException(status_code=400, detail="No plots selected")
    return out


class PlantBody(BaseModel):
    plot_id: Optional[str] = None
    plot_ids: Optional[List[str]] = None
    strain_id: str
    soil_type: str = "soil_conventional"


class PlotActionBody(BaseModel):
    plot_id: Optional[str] = None
    plot_ids: Optional[List[str]] = None


class SellBody(BaseModel):
    strain_id: str
    amount: float = Field(..., gt=0)
    unit: str = "oz"


class WithdrawBody(BaseModel):
    amount: int = Field(..., gt=0)


class SafetyBankAmountBody(BaseModel):
    amount: int = Field(..., gt=0)


class UpgradeEquipBody(BaseModel):
    category_id: str


class BuySoilBody(BaseModel):
    soil_type: str = "soil_conventional"
    bags: int = Field(1, ge=1, le=50)


class UpgradeHouseBody(BaseModel):
    target_tier: int


class UnlockStrainBody(BaseModel):
    strain_id: str


class RaidBody(BaseModel):
    target_user_id: str
    sabotage: bool = False


class DealerSellBody(BaseModel):
    pass


class AssistantModeBody(BaseModel):
    mode: str
    slot: int = Field(0, ge=0, le=7)


class AssistantEnabledBody(BaseModel):
    enabled: bool = True
    slot: int = Field(0, ge=0, le=7)


class AssistantPlantPrefsBody(BaseModel):
    slot: int = Field(0, ge=0, le=7)
    strain_id: str
    soil_type: str = ASSISTANT_DEFAULT_PLANT_SOIL


class EquipStolenBody(BaseModel):
    index: int = Field(0, ge=0)


# ---- Routes ----
async def _gate(user: dict = Depends(get_current_user)):
    await _require_access(user)
    return user


@router.get("/ready-count")
async def weed_ready_count(current_user: dict = Depends(_gate)):
    """
    Lightweight nav badge: how many plots are ready to harvest right now.
    Does not create a farm or persist ticks (read-only estimate).
    """
    farm = await db.weed_farms.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not farm:
        return {"ready_count": 0}
    await _attach_exclusive_owned(farm)
    now = _utcnow()
    farm = _tick_environment(farm, _stats(farm), now)
    stats = _stats(farm)
    ready = 0
    for p in farm.get("plots") or []:
        if (p or {}).get("state") not in ("growing", "harvest_ready"):
            continue
        ticked = _tick_plot(dict(p), farm, stats, now)
        if ticked.get("state") == "harvest_ready" or ticked.get("stage") == "harvest_ready":
            ready += 1
    return {"ready_count": int(ready)}


@router.get("/status")
async def weed_status(current_user: dict = Depends(_gate)):
    lock = await _weed_farm_lock(current_user["id"])
    async with lock:
        farm = await _get_or_create_farm(current_user["id"])
        expected_at = farm.get("updated_at")
        daily_exclusive = await maybe_claim_acapulco_gold_daily(
            db,
            user_id=current_user["id"],
            farm=farm,
            grower_level=int(farm.get("grower_level") or 1),
            owned_ids=set(farm.get("_exclusive_owned_ids") or []),
        )
        farm, assistant_run, bust_info = await _maybe_apply_bust_and_assistant(
            farm,
            current_user["id"],
            username=current_user.get("username") or "",
        )
        _auto_equip_stolen_inventory(farm)
        # Persist lazy ticks — never overwrite a concurrent sell/raid write.
        pub = _public_farm(farm, username=current_user.get("username") or "")
        save_fields = {
            "plots": pub["plots"],
            "curing": pub["curing"],
            "stash": pub["stash"],
            "daily_sold_usd": pub["daily_sold_usd"],
            "daily_sold_utc_date": farm.get("daily_sold_utc_date") or _utc_date_str(),
            "lifetime_sold_usd": farm.get("lifetime_sold_usd"),
            "business_cash": farm.get("business_cash"),
            "heat": pub["heat"],
            "heat_high_since": farm.get("heat_high_since"),
            "last_heat_tick_at": farm.get("last_heat_tick_at"),
            "cleanliness_pct": pub["cleanliness_pct"],
            "last_cleanliness_tick_at": pub["last_cleanliness_tick_at"],
            "exclusive_acapulco_gold_claimed_utc": farm.get("exclusive_acapulco_gold_claimed_utc"),
            "assistants": farm.get("assistants"),
            "assistant_hired": farm.get("assistant_hired"),
            "assistant_enabled": farm.get("assistant_enabled"),
            "assistant_mode": farm.get("assistant_mode"),
            "assistant_last_tick_at": farm.get("assistant_last_tick_at"),
            "assistant_last_run": farm.get("assistant_last_run"),
            "assistant_level": farm.get("assistant_level"),
            "equipment": farm.get("equipment"),
            "stolen_equipment": farm.get("stolen_equipment"),
            "house_tier": farm.get("house_tier"),
            "bust_restart_seed": farm.get("bust_restart_seed"),
            "last_bust_at": farm.get("last_bust_at"),
            "raid_immune_until": farm.get("raid_immune_until"),
            "equipment_rebuy": farm.get("equipment_rebuy"),
            "last_equipment_stolen": farm.get("last_equipment_stolen"),
            "missions": farm.get("missions"),
            "sabotage_unlocked": farm.get("sabotage_unlocked"),
            "grower_level": farm.get("grower_level"),
            "grower_xp": farm.get("grower_xp"),
            "soil_stock": farm.get("soil_stock"),
            "unlocks": farm.get("unlocks"),
        }
        saved = await _save_farm(
            farm,
            save_fields,
            expected_updated_at=expected_at,
        )
        if not saved:
            # Another writer (usually sell) won — re-read so UI does not restore stash.
            farm = await _get_or_create_farm(current_user["id"])
            pub = _public_farm(farm, username=current_user.get("username") or "")
        out = {
            "farm": pub,
            "catalog": {
                "houses": HOUSES,
                "strains": STRAINS,
                "equipment_categories": EQUIPMENT_CATEGORIES,
                "equipment_shop": equipment_shop_entries(),
                "start_business_cash": START_BUSINESS_CASH,
                "daily_sell_cap": daily_sell_cap_for_farm(farm),
                "daily_sell_cap_base": DAILY_SELL_CAP_USD,
                "daily_sell_cap_step": DAILY_SELL_CAP_STEP_USD,
                "daily_cap_bonus_max_tiers": DAILY_CAP_BONUS_MAX_TIERS,
                "daily_sell_cap_points_cost": DAILY_SELL_CAP_POINTS_COST,
                "daily_withdraw_cap": DAILY_WITHDRAW_CAP_USD,
                "safety_bank_unlock_points": SAFETY_BANK_UNLOCK_POINTS,
                "safety_bank_unit_capacity": SAFETY_BANK_UNIT_CAPACITY,
                "safety_bank_unit_cost": SAFETY_BANK_UNIT_COST,
                "safety_bank_max_units": SAFETY_BANK_MAX_UNITS,
                "max_dealers_level": MAX_DEALERS_LEVEL,
                "assistant_hire_cost": ASSISTANT_HIRE_COST,
                "units": {"g": 1, "oz": 28, "lb": 448, "kg": 1000},
                "cleanliness_safe_pct": CLEANLINESS_SAFE_PCT,
                "mite_harvest_yield_penalty_cap_pct": MITE_MAX_HARVEST_YIELD_PENALTY_PCT,
                "exclusive_min_grower_level": EXCLUSIVE_STRAIN_MIN_GROWER_LEVEL,
            },
            **_weed_action_code_payload(current_user["id"]),
        }
        if daily_exclusive:
            out["exclusive_daily_cash"] = daily_exclusive
        if assistant_run:
            out["assistant_run"] = assistant_run
        if bust_info:
            out["bust"] = bust_info
        return out


@router.get("/catalog")
async def weed_catalog(current_user: dict = Depends(_gate)):
    return {
        "houses": HOUSES,
        "strains": STRAINS,
        "equipment_categories": EQUIPMENT_CATEGORIES,
        "equipment_shop_count": len(equipment_shop_entries()),
        "daily_sell_cap_base": DAILY_SELL_CAP_USD,
        "daily_sell_cap_step": DAILY_SELL_CAP_STEP_USD,
        "daily_cap_bonus_max_tiers": DAILY_CAP_BONUS_MAX_TIERS,
        "daily_sell_cap_points_cost": DAILY_SELL_CAP_POINTS_COST,
        "daily_withdraw_cap": DAILY_WITHDRAW_CAP_USD,
        "safety_bank_unlock_points": SAFETY_BANK_UNLOCK_POINTS,
        "safety_bank_unit_capacity": SAFETY_BANK_UNIT_CAPACITY,
        "safety_bank_unit_cost": SAFETY_BANK_UNIT_COST,
        "safety_bank_max_units": SAFETY_BANK_MAX_UNITS,
    }


@router.post("/plant")
async def weed_plant(body: PlantBody, http_request: Request, current_user: dict = Depends(_gate)):
    target_ids = _resolve_plot_ids(plot_id=body.plot_id, plot_ids=body.plot_ids)
    farm = await _get_or_create_farm(current_user["id"])
    farm = _sync_plot_count(farm)
    stats = _stats(farm)
    now = _utcnow()

    strain = STRAIN_BY_ID.get(body.strain_id)
    if not strain:
        raise HTTPException(status_code=404, detail="Unknown strain")
    unlocks = set(farm.get("unlocks") or [])
    if is_exclusive_strain_id(body.strain_id) or strain.get("loot_exclusive"):
        owned = set(farm.get("_exclusive_owned_ids") or [])
        if body.strain_id not in owned:
            raise HTTPException(status_code=400, detail="You do not own this exclusive loot strain")
        if int(farm.get("grower_level") or 1) < EXCLUSIVE_STRAIN_MIN_GROWER_LEVEL:
            raise HTTPException(
                status_code=400,
                detail=f"Grower Level {EXCLUSIVE_STRAIN_MIN_GROWER_LEVEL}+ required to plant exclusive strains",
            )
    elif is_game_pass_strain_id(body.strain_id) or strain.get("game_pass_strain"):
        owned_gp = set(farm.get("_gp_owned_ids") or [])
        if body.strain_id not in owned_gp:
            raise HTTPException(status_code=400, detail="Unlock this strain from VIP Game Pass first")
    else:
        if body.strain_id not in unlocks and int(strain.get("unlock_house_tier") or 0) > int(farm.get("house_tier") or 0):
            raise HTTPException(status_code=400, detail="Strain not unlocked")
        if body.strain_id not in unlocks and int(strain.get("unlock_house_tier") or 0) <= int(farm.get("house_tier") or 0):
            unlocks.add(body.strain_id)
            farm["unlocks"] = list(unlocks)

    soil_type = (body.soil_type or "soil_conventional").strip()
    if soil_type not in ("soil_conventional", "soil_organic", "coco"):
        raise HTTPException(status_code=400, detail="Invalid soil/medium")
    stock = dict(farm.get("soil_stock") or {})
    scavenged_seed = (
        (
            _scavenged_seed_available(farm)
            or bool(farm.get("bust_restart_seed"))
        )
        and body.strain_id == "ditch_weed"
        and soil_type == "soil_conventional"
    )
    if scavenged_seed:
        if len(target_ids) > 1:
            raise HTTPException(status_code=400, detail="Scavenged seed can only plant one pot")
        await _require_weed_action_code(http_request, current_user)
    if not _equip_levels(farm).get("pots") and not _equip_levels(farm).get("hydro_system"):
        raise HTTPException(status_code=400, detail="Need pots or a hydro system")
    if not any(
        _equip_levels(farm).get(k)
        for k in ("lights_cfl", "lights_led", "lights_hps", "lights_quantum", "lights_uv", "lights_bar_led")
    ):
        raise HTTPException(status_code=400, detail="Need lights installed")

    plots = list(farm.get("plots") or [])
    by_id = {p.get("id"): i for i, p in enumerate(plots)}
    plantable: List[int] = []
    for pid in target_ids:
        idx = by_id.get(pid)
        if idx is None:
            raise HTTPException(status_code=404, detail="Plot not found")
        if plots[idx].get("state") not in ("empty", "dead", None):
            raise HTTPException(status_code=400, detail="One or more selected pots are not empty")
        plantable.append(idx)

    count = len(plantable)
    seed_cost = int(strain.get("seed_cost") or 0)
    if not scavenged_seed:
        need_soil = SOIL_CHARGE_PER_PLANT * count
        if int(stock.get(soil_type) or 0) < need_soil:
            raise HTTPException(
                status_code=400,
                detail=f"Need {need_soil} soil charges for {count} pots (buy soil/medium first)",
            )
        _spend(farm, seed_cost * count)
        stock[soil_type] = int(stock.get(soil_type) or 0) - need_soil
    farm["soil_stock"] = stock

    base_q = 48.0 + (8.0 if soil_type == "soil_organic" else 0.0)
    q_ceiling = float(stats.get("quality_ceiling") or 55)
    for idx in plantable:
        p = plots[idx]
        plots[idx] = {
            **_empty_plot(),
            "id": p["id"],
            "state": "growing",
            "strain_id": body.strain_id,
            "planted_at": _iso(now),
            "last_watered_at": _iso(now),
            "last_fed_at": _iso(now),
            "quality": min(q_ceiling, base_q),
            "soil_type": soil_type,
            "medium": soil_type,
            "stage": "seedling",
            "progress": 0.0,
            "mite_infestation_pct": 0.0,
            "mite_infested": False,
            "last_mite_treated_at": None,
            "last_mite_risk_at": _iso(now),
            "last_mite_damage_at": _iso(now),
        }

    farm["plots"] = plots
    if scavenged_seed:
        farm["bust_restart_seed"] = False
    await _save_farm(
        farm,
        {
            "plots": plots,
            "business_cash": farm["business_cash"],
            "soil_stock": stock,
            "unlocks": farm.get("unlocks"),
            "bust_restart_seed": farm.get("bust_restart_seed"),
        },
    )
    return {
        "ok": True,
        "farm": _public_farm(farm, username=current_user.get("username") or ""),
        "fx": "plant",
        "scavenged_seed": scavenged_seed,
        "planted": count,
    }


async def _tend(plot_ids: List[str], kind: str, current_user: dict) -> dict:
    farm = await _get_or_create_farm(current_user["id"])
    now = _utcnow()
    plots = list(farm.get("plots") or [])
    by_id = {p.get("id"): i for i, p in enumerate(plots)}
    tended = 0
    for pid in plot_ids:
        idx = by_id.get(pid)
        if idx is None:
            raise HTTPException(status_code=404, detail="Plot not found")
        p = plots[idx]
        if p.get("state") not in ("growing", "harvest_ready"):
            continue
        if kind == "water":
            plots[idx] = {**p, "last_watered_at": _iso(now), "quality": min(100.0, float(p.get("quality") or 50) + 1.5)}
        else:
            plots[idx] = {**p, "last_fed_at": _iso(now), "quality": min(100.0, float(p.get("quality") or 50) + 2.0)}
        tended += 1
    if tended < 1:
        raise HTTPException(status_code=400, detail="Nothing to tend on selected pots")
    farm["plots"] = plots
    await _save_farm(farm, {"plots": plots})
    return {
        "ok": True,
        "farm": _public_farm(farm, username=current_user.get("username") or ""),
        "fx": "water" if kind == "water" else "feed",
        "tended": tended,
    }


@router.post("/water")
async def weed_water(body: PlotActionBody, current_user: dict = Depends(_gate)):
    return await _tend(_resolve_plot_ids(plot_id=body.plot_id, plot_ids=body.plot_ids), "water", current_user)


@router.post("/feed")
async def weed_feed(body: PlotActionBody, current_user: dict = Depends(_gate)):
    return await _tend(_resolve_plot_ids(plot_id=body.plot_id, plot_ids=body.plot_ids), "feed", current_user)


@router.post("/harvest")
async def weed_harvest(body: PlotActionBody, http_request: Request, current_user: dict = Depends(_gate)):
    await _require_weed_action_code(http_request, current_user)
    target_ids = set(_resolve_plot_ids(plot_id=body.plot_id, plot_ids=body.plot_ids))
    farm = await _get_or_create_farm(current_user["id"])
    stats = _stats(farm)
    now = _utcnow()
    farm = _tick_environment(farm, stats, now)
    plots = [_tick_plot(dict(p), farm, stats, now) for p in (farm.get("plots") or [])]

    total_grams = 0.0
    total_xp = 0
    harvested = 0
    leveled_up = False
    grower_level = int(farm.get("grower_level") or 1)
    last_info: Dict[str, Any] = {}
    for i, p in enumerate(plots):
        if p.get("id") not in target_ids:
            continue
        if p.get("stage") != "harvest_ready" and p.get("state") != "harvest_ready":
            continue
        empty, info = _harvest_ready_plot(farm, p, stats, now)
        plots[i] = empty
        harvested += 1
        total_grams += float(info.get("grams") or 0)
        total_xp += int(info.get("xp_gained") or 0)
        if info.get("leveled_up"):
            leveled_up = True
        grower_level = int(info.get("grower_level") or grower_level)
        last_info = info
    if harvested < 1:
        raise HTTPException(status_code=400, detail="No selected pots are ready to harvest")
    farm["plots"] = plots
    _track_heat_for_bust(farm, now)
    await _save_farm(
        farm,
        {
            "plots": plots,
            "curing": farm.get("curing"),
            "missions": farm.get("missions"),
            "heat": farm["heat"],
            "heat_high_since": farm.get("heat_high_since"),
            "sabotage_unlocked": farm.get("sabotage_unlocked"),
            "cleanliness_pct": farm["cleanliness_pct"],
            "last_cleanliness_tick_at": farm["last_cleanliness_tick_at"],
            "grower_level": farm.get("grower_level"),
            "grower_xp": farm.get("grower_xp"),
        },
    )
    return {
        "ok": True,
        "grams": round(total_grams, 2),
        "harvested": harvested,
        "trim_level": last_info.get("trim_level"),
        "mite_yield_penalty_pct": last_info.get("mite_yield_penalty_pct"),
        "fx": "harvest_trim",
        "xp_gained": total_xp,
        "leveled_up": leveled_up,
        "grower_level": grower_level,
        "farm": _public_farm(farm, username=current_user.get("username") or ""),
    }


@router.post("/clean-room")
async def weed_clean_room(current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    now = _utcnow()
    stats = _stats(farm)
    farm = _tick_environment(farm, stats, now)
    cost = _clean_room_cost(farm)
    _spend(farm, cost)
    farm["cleanliness_pct"] = 100.0
    farm["last_cleanliness_tick_at"] = _iso(now)
    await _save_farm(
        farm,
        {
            "business_cash": farm["business_cash"],
            "cleanliness_pct": farm["cleanliness_pct"],
            "last_cleanliness_tick_at": farm["last_cleanliness_tick_at"],
            "plots": farm["plots"],
        },
    )
    return {
        "ok": True,
        "cost": cost,
        "farm": _public_farm(farm, username=current_user.get("username") or ""),
        "fx": "clean_room",
    }


@router.post("/treat-mites")
async def weed_treat_mites(body: PlotActionBody, current_user: dict = Depends(_gate)):
    target_ids = _resolve_plot_ids(plot_id=body.plot_id, plot_ids=body.plot_ids)
    farm = await _get_or_create_farm(current_user["id"])
    now = _utcnow()
    stats = _stats(farm)
    farm = _tick_environment(farm, stats, now)
    plots = list(farm.get("plots") or [])
    by_id = {p.get("id"): i for i, p in enumerate(plots)}
    effect_pct = _mite_treatment_effect_pct(stats)
    total_cost = 0
    treated = 0
    last_remaining = 0.0
    for pid in target_ids:
        idx = by_id.get(pid)
        if idx is None:
            raise HTTPException(status_code=404, detail="Plot not found")
        plot = plots[idx]
        if plot.get("state") not in ("growing", "harvest_ready"):
            continue
        infestation = float(plot.get("mite_infestation_pct") or 0.0)
        if infestation <= 0:
            continue
        cost = _mite_treatment_cost(plot)
        _spend(farm, cost)
        total_cost += cost
        remaining = max(0.0, infestation * (1.0 - effect_pct / 100.0))
        if remaining < 1.0:
            remaining = 0.0
        last_remaining = remaining
        plots[idx] = {
            **plot,
            "mite_infestation_pct": round(remaining, 2),
            "mite_infested": remaining > 0,
            "last_mite_treated_at": _iso(now),
            "last_mite_damage_at": _iso(now),
        }
        treated += 1
    if treated < 1:
        raise HTTPException(status_code=400, detail="No spider mites on selected pots")
    farm["plots"] = plots
    await _save_farm(
        farm,
        {
            "business_cash": farm["business_cash"],
            "plots": plots,
            "cleanliness_pct": farm["cleanliness_pct"],
            "last_cleanliness_tick_at": farm["last_cleanliness_tick_at"],
        },
    )
    return {
        "ok": True,
        "cost": total_cost,
        "treated": treated,
        "treatment_effect_pct": round(effect_pct, 2),
        "remaining_infestation_pct": round(last_remaining, 2),
        "farm": _public_farm(farm, username=current_user.get("username") or ""),
        "fx": "treat_mites",
    }


@router.post("/sell")
async def weed_sell(body: SellBody, http_request: Request, current_user: dict = Depends(_gate)):
    await _require_weed_action_code(http_request, current_user)
    lock = await _weed_farm_lock(current_user["id"])
    async with lock:
        farm = await _get_or_create_farm(current_user["id"])
        expected_at = farm.get("updated_at")
        farm = _ensure_daily_cap(farm)
        farm = _tick_curing(farm, _utcnow())
        strain = STRAIN_BY_ID.get(body.strain_id)
        if not strain:
            raise HTTPException(status_code=404, detail="Unknown strain")
        try:
            grams = unit_to_grams(body.amount, body.unit)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        stash = dict(farm.get("stash") or {})
        have = float(stash.get(body.strain_id) or 0)
        # UI shows/steps 0.1g — clamp when request rounds slightly above true stash.
        if grams > have + 1e-6:
            if grams <= round(have, 1) + 1e-9 and grams <= have + 0.05:
                grams = have
            else:
                raise HTTPException(status_code=400, detail="Not enough stash")

        oz = grams_to_oz(grams)
        price_per_oz = market_price_per_oz(
            strain,
            house_tier=int(farm.get("house_tier") or 0),
            dealers_level=int(farm.get("dealers_level") or 0),
            sold_today_usd=float(farm.get("daily_sold_usd") or 0),
            heat=float(farm.get("heat") or 0),
            daily_sell_cap=daily_sell_cap_for_farm(farm),
        ) * _market_price_bonus(farm)
        # Bulk sweetener for lb/kg
        u = body.unit.lower()
        if u in ("lb", "lbs", "pound", "pounds"):
            price_per_oz *= 1.03
        elif u in ("kg", "kilo", "kilos"):
            price_per_oz *= 1.05
        payout = int(math.floor(price_per_oz * oz))
        if payout <= 0:
            # Tiny dust sales still clear stash for at least $1 if anything is sold.
            if have > 0 and grams >= have - 1e-6:
                payout = 1
                grams = have
                oz = grams_to_oz(grams)
            else:
                raise HTTPException(status_code=400, detail="Sale too small")

        remaining = daily_sell_cap_for_farm(farm) - int(farm.get("daily_sold_usd") or 0)
        if payout > remaining:
            if remaining <= 0:
                raise HTTPException(status_code=400, detail="Daily sell cap reached")
            grams *= remaining / payout
            oz = grams_to_oz(grams)
            payout = remaining

        stash[body.strain_id] = round(have - grams, 4)
        if stash[body.strain_id] < 0.01:
            stash.pop(body.strain_id, None)
        farm["stash"] = stash
        farm["business_cash"] = int(farm.get("business_cash") or 0) + payout
        farm["daily_sold_usd"] = int(farm.get("daily_sold_usd") or 0) + payout
        farm["lifetime_sold_usd"] = int(farm.get("lifetime_sold_usd") or 0) + payout
        missions = dict(farm.get("missions") or {})
        missions["sell_count"] = int(missions.get("sell_count") or 0) + 1
        farm["missions"] = missions
        _add_heat(farm, min(3.5, 0.25 + oz * 0.04))
        _track_heat_for_bust(farm, _utcnow())

        # Dealer passive unlock nudge
        if missions["sell_count"] >= 5 and int(farm.get("dealers_level") or 0) == 0:
            farm["dealers_level"] = 1

        xp_amt = max(5, int(8 * oz * rarity_xp_mult(str(strain.get("rarity") or "common"))))
        xp_fields, leveled, new_lvl = apply_grower_xp(farm, xp_amt)
        farm.update(xp_fields)

        saved = await _save_farm(
            farm,
            {
                "stash": stash,
                "curing": farm.get("curing") or [],
                "business_cash": farm["business_cash"],
                "daily_sold_usd": farm["daily_sold_usd"],
                "daily_sold_utc_date": farm["daily_sold_utc_date"],
                "lifetime_sold_usd": farm["lifetime_sold_usd"],
                "heat": farm["heat"],
                "heat_high_since": farm.get("heat_high_since"),
                "missions": missions,
                "dealers_level": farm.get("dealers_level"),
                **xp_fields,
            },
            expected_updated_at=expected_at,
        )
        if not saved:
            raise HTTPException(status_code=409, detail="Sell conflict — refresh and try again")

        event = {
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "username": current_user.get("username") or "",
            "strain_id": body.strain_id,
            "grams_sold": round(grams, 4),
            "payout": payout,
            "xp_gained": xp_amt,
            "unit": body.unit,
            "amount": body.amount,
            "stash_before": round(have, 4),
            "stash_after": round(float(stash.get(body.strain_id) or 0), 4),
            "created_at": _utcnow(),
        }
        try:
            await db.weed_sell_events.insert_one(dict(event))
        except Exception:
            logger.exception("weed_sell_events insert failed")
        try:
            await log_activity(
                current_user["id"],
                current_user.get("username") or "?",
                "weed_empire_sell",
                {
                    "strain_id": body.strain_id,
                    "grams": round(grams, 2),
                    "payout": payout,
                    "xp": xp_amt,
                    "stash_before": round(have, 2),
                    "stash_after": round(float(stash.get(body.strain_id) or 0), 2),
                },
            )
        except Exception:
            pass

        # Re-read DB + skip curing re-tick so response stash matches what was saved
        # (avoids UI showing pre-sell stash until a full refresh).
        fresh = await db.weed_farms.find_one({"user_id": current_user["id"]}, {"_id": 0})
        if fresh:
            await _attach_exclusive_owned(fresh)
            farm = fresh
        return {
            "ok": True,
            "payout": payout,
            "effective_price_per_oz": round(price_per_oz, 2),
            "grams_sold": round(grams, 2),
            "xp_gained": xp_amt,
            "leveled_up": leveled,
            "grower_level": new_lvl,
            "farm": _public_farm(
                farm,
                username=current_user.get("username") or "",
                apply_curing_tick=False,
            ),
        }


@router.post("/buy-soil")
async def weed_buy_soil(body: BuySoilBody, current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    soil_type = body.soil_type.strip()
    cat_id = {
        "soil_conventional": "soil_conventional",
        "soil_organic": "soil_organic",
        "coco": "coco_medium",
    }.get(soil_type)
    if not cat_id:
        raise HTTPException(status_code=400, detail="Invalid soil type")
    cat = EQUIPMENT_BY_ID[cat_id]
    lvl = max(1, int(_equip_levels(farm).get(cat_id) or 1))
    # Must own at least level 1 of that soil line
    if int(_equip_levels(farm).get(cat_id) or 0) < 1:
        raise HTTPException(status_code=400, detail="Unlock this soil line in the equipment shop first")
    bag_units = int(cat.get("bag_units") or 4)
    # Soil is a consumable — scale with gear a bit, but hard-cap so late levels stay fair.
    unit_cost = max(200, min(12_000, equipment_level_cost(cat, lvl) // 10))
    cost = unit_cost * int(body.bags)
    _spend(farm, cost)
    stock = dict(farm.get("soil_stock") or {})
    key = soil_type if soil_type != "coco" else "coco"
    stock[key] = int(stock.get(key) or 0) + bag_units * int(body.bags)
    farm["soil_stock"] = stock
    await _save_farm(farm, {"business_cash": farm["business_cash"], "soil_stock": stock})
    return {"ok": True, "farm": _public_farm(farm, username=current_user.get("username") or ""), "added": bag_units * body.bags}


@router.post("/upgrade-equipment")
async def weed_upgrade_equip(body: UpgradeEquipBody, current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    cat = EQUIPMENT_BY_ID.get(body.category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Unknown equipment")
    house = _house(farm)
    house_tier = int(farm.get("house_tier") or 0)
    grower_level = max(1, int(farm.get("grower_level") or 1))
    equip_levels = _equip_levels(farm)
    cur = int(equip_levels.get(body.category_id) or 0)
    rebuy = _equipment_rebuy_map(farm)
    farm["equipment_rebuy"] = rebuy
    try:
        pending_rebuy = int(rebuy.get(body.category_id) or 0)
    except (TypeError, ValueError):
        pending_rebuy = 0

    # Raid steal recovery: pay level-1 fee, restore saved upgrade level
    # (also works if they bought Lv1 by mistake — pending still restores full level)
    if pending_rebuy > cur:
        house_max = int(house.get("max_equip_tier") or 20)
        if house_tier < int(cat.get("min_house_tier") or 0):
            raise HTTPException(status_code=400, detail=f"Need house tier {cat.get('min_house_tier')}+")
        if pending_rebuy > house_max:
            raise HTTPException(status_code=400, detail=f"Upgrade house for gear Lv {pending_rebuy}+")
        cost = _scaled_upgrade_cost(farm, equipment_level_cost(cat, 1))
        _spend(farm, cost)
        equip = dict(farm.get("equipment") or {})
        equip[body.category_id] = pending_rebuy
        farm["equipment"] = equip
        rebuy.pop(body.category_id, None)
        farm["equipment_rebuy"] = rebuy
        last = farm.get("last_equipment_stolen")
        if isinstance(last, dict) and str(last.get("category_id") or "") == body.category_id:
            farm["last_equipment_stolen"] = None
        await _save_farm(
            farm,
            {
                "business_cash": farm["business_cash"],
                "equipment": equip,
                "equipment_rebuy": rebuy,
                "last_equipment_stolen": farm.get("last_equipment_stolen"),
            },
        )
        return {
            "ok": True,
            "category_id": body.category_id,
            "level": pending_rebuy,
            "cost": cost,
            "rebought": True,
            "yield_hint": (cat.get("stats_per_level") or {}).get("yield_mult"),
            "farm": _public_farm(farm, username=current_user.get("username") or ""),
        }

    try:
        nxt = assert_can_upgrade_equipment(
            cat,
            owned_level=cur,
            house_tier=house_tier,
            grower_level=grower_level,
            equipment_levels=equip_levels,
            house_max_equip_tier=int(house.get("max_equip_tier") or 20),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    cost = _scaled_upgrade_cost(farm, equipment_level_cost(cat, nxt))
    _spend(farm, cost)
    equip = dict(farm.get("equipment") or {})
    equip[body.category_id] = nxt
    farm["equipment"] = equip
    # Never clear a higher saved raid level while still below it
    if body.category_id in rebuy and nxt >= int(rebuy.get(body.category_id) or 0):
        rebuy.pop(body.category_id, None)
        farm["equipment_rebuy"] = rebuy
    stock = dict(farm.get("soil_stock") or {})
    stock_key = cat.get("consumable_stock_key")
    if stock_key and nxt == 1:
        stock[stock_key] = int(stock.get(stock_key) or 0) + int(cat.get("bag_units") or 4)
        farm["soil_stock"] = stock
    await _save_farm(
        farm,
        {
            "business_cash": farm["business_cash"],
            "equipment": equip,
            "soil_stock": farm.get("soil_stock"),
            "equipment_rebuy": farm.get("equipment_rebuy"),
        },
    )
    return {
        "ok": True,
        "category_id": body.category_id,
        "level": nxt,
        "cost": cost,
        "yield_hint": (cat.get("stats_per_level") or {}).get("yield_mult"),
        "farm": _public_farm(farm, username=current_user.get("username") or ""),
    }


@router.post("/upgrade-house")
async def weed_upgrade_house(body: UpgradeHouseBody, current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    cur = int(farm.get("house_tier") or 0)
    target = int(body.target_tier)
    if target != cur + 1:
        raise HTTPException(status_code=400, detail="Upgrade one tier at a time")
    house = HOUSE_BY_TIER.get(target)
    if not house:
        raise HTTPException(status_code=400, detail="Invalid house tier")
    cost = _scaled_upgrade_cost(farm, int(house.get("cost") or 0))
    _spend(farm, cost)
    farm["house_tier"] = target
    farm = _sync_plot_count(farm)
    # Auto-unlock strains for new tier (never loot exclusives / Game Pass strains)
    unlocks = set(farm.get("unlocks") or [])
    for s in STRAINS:
        if s.get("loot_exclusive") or s.get("game_pass_strain"):
            continue
        if int(s.get("unlock_house_tier") or 0) <= target:
            unlocks.add(s["id"])
    farm["unlocks"] = list(unlocks)
    _auto_equip_stolen_inventory(farm)
    await _save_farm(
        farm,
        {
            "business_cash": farm["business_cash"],
            "house_tier": target,
            "plots": farm["plots"],
            "unlocks": farm["unlocks"],
            "equipment": farm.get("equipment"),
            "stolen_equipment": farm.get("stolen_equipment"),
        },
    )
    return {"ok": True, "farm": _public_farm(farm, username=current_user.get("username") or "")}


@router.post("/unlock-strain")
async def weed_unlock_strain(body: UnlockStrainBody, current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    strain = STRAIN_BY_ID.get(body.strain_id)
    if not strain:
        raise HTTPException(status_code=404, detail="Unknown strain")
    if strain.get("loot_exclusive") or is_exclusive_strain_id(body.strain_id):
        raise HTTPException(status_code=400, detail="Exclusive strains come from loot boxes (or PvP kill), not the shop")
    if strain.get("game_pass_strain") or is_game_pass_strain_id(body.strain_id):
        raise HTTPException(status_code=400, detail="Game Pass strains unlock from VIP Game Pass rewards, not the shop")
    if int(strain.get("unlock_house_tier") or 0) > int(farm.get("house_tier") or 0):
        raise HTTPException(status_code=400, detail="House tier too low")
    unlocks = set(farm.get("unlocks") or [])
    if body.strain_id in unlocks:
        return {"ok": True, "farm": _public_farm(farm, username=current_user.get("username") or "")}
    cost = int(strain.get("seed_cost") or 0) * 3
    _spend(farm, cost)
    unlocks.add(body.strain_id)
    farm["unlocks"] = list(unlocks)
    await _save_farm(farm, {"business_cash": farm["business_cash"], "unlocks": farm["unlocks"]})
    return {"ok": True, "farm": _public_farm(farm, username=current_user.get("username") or "")}


@router.post("/cool-off")
async def weed_cool_off(current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    heat = float(farm.get("heat") or 0)
    cost = _cool_off_cost(heat)
    if cost <= 0 or heat < 0.5:
        return {"ok": True, "farm": _public_farm(farm, username=current_user.get("username") or ""), "cleared": 0}
    _spend(farm, cost)
    cleared = heat
    farm["heat"] = 0.0
    farm["heat_high_since"] = None
    await _save_farm(
        farm,
        {
            "business_cash": farm["business_cash"],
            "heat": farm["heat"],
            "heat_high_since": None,
            "last_heat_tick_at": farm.get("last_heat_tick_at"),
        },
    )
    return {
        "ok": True,
        "cleared": round(cleared, 1),
        "cost": cost,
        "farm": _public_farm(farm, username=current_user.get("username") or ""),
    }


@router.post("/withdraw")
async def weed_withdraw(body: WithdrawBody, current_user: dict = Depends(_gate)):
    """Move weed business cash to personal money. Must leave $50k; $250M daily withdraw cap."""
    lock = await _weed_farm_lock(current_user["id"])
    async with lock:
        farm = await _get_or_create_farm(current_user["id"])
        farm = _ensure_daily_cap(farm)
        expected_at = farm.get("updated_at")
        cash = int(farm.get("business_cash") or 0)
        after_reserve = max(0, cash - MIN_BUSINESS_CASH_RESERVE)
        withdrawn_today = int(farm.get("daily_withdrawn_usd") or 0)
        withdraw_cap = _daily_withdraw_cap(farm)
        remaining_cap = max(0, withdraw_cap - withdrawn_today)
        withdrawable = min(after_reserve, remaining_cap)
        amount = int(body.amount)
        if cash <= MIN_BUSINESS_CASH_RESERVE:
            raise HTTPException(
                status_code=400,
                detail=f"Must keep at least ${MIN_BUSINESS_CASH_RESERVE:,} in the farm. Current: ${cash:,}.",
            )
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
        if remaining_cap <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"Daily withdraw cap reached (${withdraw_cap:,}). Resets at UTC midnight.",
            )
        if amount > remaining_cap:
            raise HTTPException(
                status_code=400,
                detail=f"Daily withdraw remaining: ${remaining_cap:,} of ${withdraw_cap:,}.",
            )
        if amount > after_reserve:
            raise HTTPException(
                status_code=400,
                detail=f"Can withdraw up to ${after_reserve:,} (must leave ${MIN_BUSINESS_CASH_RESERVE:,}).",
            )
        if amount > withdrawable:
            raise HTTPException(
                status_code=400,
                detail=f"Can withdraw up to ${withdrawable:,} right now.",
            )
        farm["business_cash"] = cash - amount
        farm["daily_withdrawn_usd"] = withdrawn_today + amount
        farm["daily_withdrawn_utc_date"] = farm.get("daily_withdrawn_utc_date") or _utc_date_str()
        saved = await _save_farm(
            farm,
            {
                "business_cash": farm["business_cash"],
                "daily_withdrawn_usd": farm["daily_withdrawn_usd"],
                "daily_withdrawn_utc_date": farm["daily_withdrawn_utc_date"],
            },
            expected_updated_at=expected_at,
        )
        if not saved:
            raise HTTPException(status_code=409, detail="Withdraw conflict — refresh and try again")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": amount}})
        try:
            await log_activity(
                current_user["id"],
                current_user.get("username") or "",
                "weed_empire_withdraw",
                {
                    "amount": amount,
                    "business_cash_remaining": farm["business_cash"],
                    "daily_withdrawn_usd": farm["daily_withdrawn_usd"],
                },
            )
        except Exception:
            pass
        return {
            "ok": True,
            "withdrawn": amount,
            "business_cash": farm["business_cash"],
            "daily_withdrawn_usd": farm["daily_withdrawn_usd"],
            "daily_withdraw_remaining": max(0, _daily_withdraw_cap(farm) - int(farm["daily_withdrawn_usd"])),
            "farm": _public_farm(farm, username=current_user.get("username") or "", apply_curing_tick=False),
        }


@router.post("/safety-bank/expand")
async def weed_safety_bank_expand(current_user: dict = Depends(_gate)):
    """Spend $10M weed business cash to add +$25M Safety Deposit capacity."""
    lock = await _weed_farm_lock(current_user["id"])
    async with lock:
        farm = await _get_or_create_farm(current_user["id"])
        if not safety_bank_unlocked(farm):
            raise HTTPException(
                status_code=400,
                detail=f"Unlock Safety Deposit in the Points Store first ({SAFETY_BANK_UNLOCK_POINTS} pts)",
            )
        units = safety_bank_capacity_units(farm)
        if units >= SAFETY_BANK_MAX_UNITS:
            raise HTTPException(status_code=400, detail="Safety Deposit is at max capacity")
        _spend(farm, SAFETY_BANK_UNIT_COST)
        farm["safety_bank_capacity_units"] = units + 1
        await _save_farm(
            farm,
            {
                "business_cash": farm["business_cash"],
                "safety_bank_capacity_units": farm["safety_bank_capacity_units"],
                "safety_bank_unlocked": True,
            },
        )
        return {
            "ok": True,
            "added_capacity": SAFETY_BANK_UNIT_CAPACITY,
            "cost": SAFETY_BANK_UNIT_COST,
            "farm": _public_farm(farm, username=current_user.get("username") or ""),
        }


@router.post("/safety-bank/deposit")
async def weed_safety_bank_deposit(body: SafetyBankAmountBody, current_user: dict = Depends(_gate)):
    lock = await _weed_farm_lock(current_user["id"])
    async with lock:
        farm = await _get_or_create_farm(current_user["id"])
        if not safety_bank_unlocked(farm):
            raise HTTPException(status_code=400, detail="Unlock Safety Deposit in the Points Store first")
        amount = int(body.amount)
        cash = int(farm.get("business_cash") or 0)
        bank = max(0, int(farm.get("safety_bank_cash") or 0))
        cap = safety_bank_capacity(farm)
        free = max(0, cap - bank)
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
        if cap <= 0:
            raise HTTPException(status_code=400, detail="Expand Safety Deposit capacity first ($10M business cash → +$25M)")
        if amount > cash:
            raise HTTPException(status_code=400, detail="Not enough weed business cash")
        if amount > free:
            raise HTTPException(status_code=400, detail=f"Only ${free:,} free capacity in the Safety Deposit")
        farm["business_cash"] = cash - amount
        farm["safety_bank_cash"] = bank + amount
        await _save_farm(
            farm,
            {
                "business_cash": farm["business_cash"],
                "safety_bank_cash": farm["safety_bank_cash"],
                "safety_bank_unlocked": True,
                "safety_bank_capacity_units": farm.get("safety_bank_capacity_units") or 0,
            },
        )
        return {
            "ok": True,
            "deposited": amount,
            "farm": _public_farm(farm, username=current_user.get("username") or ""),
        }


@router.post("/safety-bank/withdraw")
async def weed_safety_bank_withdraw(body: SafetyBankAmountBody, current_user: dict = Depends(_gate)):
    """Move cash from Safety Deposit back to weed business cash (not personal money)."""
    lock = await _weed_farm_lock(current_user["id"])
    async with lock:
        farm = await _get_or_create_farm(current_user["id"])
        if not safety_bank_unlocked(farm):
            raise HTTPException(status_code=400, detail="Unlock Safety Deposit in the Points Store first")
        amount = int(body.amount)
        bank = max(0, int(farm.get("safety_bank_cash") or 0))
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
        if amount > bank:
            raise HTTPException(status_code=400, detail="Not enough cash in the Safety Deposit")
        farm["safety_bank_cash"] = bank - amount
        farm["business_cash"] = int(farm.get("business_cash") or 0) + amount
        await _save_farm(
            farm,
            {
                "business_cash": farm["business_cash"],
                "safety_bank_cash": farm["safety_bank_cash"],
            },
        )
        return {
            "ok": True,
            "withdrawn": amount,
            "farm": _public_farm(farm, username=current_user.get("username") or ""),
        }


@router.get("/raid/targets")
async def weed_raid_targets(current_user: dict = Depends(_gate)):
    me = current_user["id"]
    my_farm = await _get_or_create_farm(me)
    now = _utcnow()
    if int(my_farm.get("grower_level") or 1) < MIN_RAID_GROWER_LEVEL:
        return {
            "targets": [],
            "sabotage_unlocked": bool(my_farm.get("sabotage_unlocked")),
            "raid_unlocked": False,
            "raid_ready": False,
            "raid_available_at": None,
            "raid_cooldown_hours": RAID_PER_TARGET_COOLDOWN_HOURS,
            "raid_cooldown_scope": "per_target",
            "required_grower_level": MIN_RAID_GROWER_LEVEL,
            "required_target_grower_level": MIN_RAID_TARGET_GROWER_LEVEL,
        }
    cursor = db.weed_farms.find(
        {
            "user_id": {"$ne": me},
            "grower_level": {"$gte": MIN_RAID_TARGET_GROWER_LEVEL},
        },
        {
            "_id": 0,
            "user_id": 1,
            "house_tier": 1,
            "grower_level": 1,
            "heat": 1,
            "business_cash": 1,
            "equipment": 1,
            "stash": 1,
            "raid_immune_until": 1,
            "last_bust_at": 1,
        },
    )
    targets = []
    async for f in cursor:
        uid = f.get("user_id")
        if not uid:
            continue
        try:
            u = await db.users.find_one(
                {"id": uid, "is_dead": {"$ne": True}},
                {"_id": 0, "username": 1},
            )
            if not u:
                continue
            stash_raw = f.get("stash") or {}
            stash_g = 0.0
            if isinstance(stash_raw, dict):
                for v in stash_raw.values():
                    try:
                        stash_g += float(v or 0)
                    except (TypeError, ValueError):
                        continue
            sec = _security_upgrade_progress(f)
            est_chance = _raid_success_chance(my_farm, f)
            target_ready_at = _raid_available_at_for_target(my_farm, uid, now)
            immune_until = _defender_raid_immune_until(f, now)
            targets.append(
                {
                    "user_id": uid,
                    "username": u.get("username") or "Unknown",
                    "house_tier": int(f.get("house_tier") or 0),
                    "grower_level": int(f.get("grower_level") or 1),
                    "heat": float(f.get("heat") or 0),
                    "stash_grams": round(stash_g, 1),
                    "equip_count": len(f.get("equipment") or {}) if isinstance(f.get("equipment"), dict) else 0,
                    "security_fill": sec.get("fill"),
                    "security_fully_upgraded": bool(sec.get("fully_upgraded")),
                    "raid_success_chance": round(est_chance, 3),
                    "raid_ready": target_ready_at is None and immune_until is None,
                    "raid_available_at": _iso(target_ready_at) if target_ready_at else None,
                    "raid_immune": immune_until is not None,
                    "raid_immune_until": _iso(immune_until) if immune_until else None,
                }
            )
        except Exception:
            logging.exception("weed raid target skip user_id=%s", uid)
            continue
        if len(targets) >= 40:
            break
    return {
        "targets": targets,
        "sabotage_unlocked": bool(my_farm.get("sabotage_unlocked")),
        "raid_unlocked": True,
        "raid_ready": True,
        "raid_available_at": None,
        "raid_cooldown_hours": RAID_PER_TARGET_COOLDOWN_HOURS,
        "raid_cooldown_scope": "per_target",
        "bust_raid_immune_hours": BUST_RAID_IMMUNE_HOURS,
        "required_grower_level": MIN_RAID_GROWER_LEVEL,
        "required_target_grower_level": MIN_RAID_TARGET_GROWER_LEVEL,
    }


@router.post("/raid")
async def weed_raid(body: RaidBody, http_request: Request, current_user: dict = Depends(_gate)):
    await _require_weed_action_code(http_request, current_user)
    attacker_id = current_user["id"]
    defender_id = (body.target_user_id or "").strip()
    if not defender_id or defender_id == attacker_id:
        raise HTTPException(status_code=400, detail="Invalid target")
    defender_user = await db.users.find_one(
        {"id": defender_id, "is_dead": {"$ne": True}},
        {"_id": 0, "id": 1},
    )
    if not defender_user:
        raise HTTPException(status_code=404, detail="Target is dead or unavailable")

    now = _utcnow()
    atk = await _get_or_create_farm(attacker_id)
    if int(atk.get("grower_level") or 1) < MIN_RAID_GROWER_LEVEL:
        raise HTTPException(status_code=400, detail="Reach Grower Level 5 before raiding other growers")
    target_ready_at = _raid_available_at_for_target(atk, defender_id, now)
    if target_ready_at is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Already raided this grower — available again at {target_ready_at.isoformat()}",
        )

    dfn = await db.weed_farms.find_one({"user_id": defender_id}, {"_id": 0})
    if not dfn:
        raise HTTPException(status_code=404, detail="Target has no weed business")
    await _attach_exclusive_owned(dfn)
    if int(dfn.get("grower_level") or 1) < MIN_RAID_TARGET_GROWER_LEVEL:
        raise HTTPException(status_code=400, detail="Growers below level 5 are protected from raids")
    immune_until = _defender_raid_immune_until(dfn, now)
    if immune_until is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Target is raid-protected after a heat bust until {immune_until.isoformat()} "
                f"({BUST_RAID_IMMUNE_HOURS}h after bust)"
            ),
        )

    chance = _raid_success_chance(atk, dfn)
    success = _rng.random() < chance
    sec_progress = _security_upgrade_progress(dfn)

    next_ready = _mark_raid_against_target(atk, defender_id, now)
    stolen = {"stash": {}, "cash": 0, "equipment": None, "scrap_cash": 0, "grams_total": 0.0}
    sabotage_note = None

    if not success:
        fine = min(int(atk.get("business_cash") or 0), 2_500)
        atk["business_cash"] = int(atk.get("business_cash") or 0) - fine
        _add_heat(atk, 2.5)
        rs = dict(atk.get("raid_stats") or {})
        rs["raids_lost"] = int(rs.get("raids_lost") or 0) + 1
        atk["raid_stats"] = rs
        await _save_farm(
            atk,
            {
                "raid_last_by_target": atk.get("raid_last_by_target"),
                "raid_available_at": None,
                "business_cash": atk["business_cash"],
                "heat": atk["heat"],
                "raid_stats": rs,
            },
        )
        try:
            await send_notification(
                defender_id,
                "Weed Empire",
                f"{current_user.get('username') or 'Someone'} tried to raid your grow and failed.",
                "system",
                category="missions",
            )
        except Exception:
            pass
        return {
            "ok": False,
            "success": False,
            "fine": fine,
            "success_chance": round(chance, 3),
            "defender_security_fill": sec_progress.get("fill"),
            "target_user_id": defender_id,
            "raid_available_at": next_ready,
            "raid_cooldown_scope": "per_target",
            "farm": _public_farm(atk, username=current_user.get("username") or ""),
        }

    # Success: steal 100% defender stash (exclusive grams move; ownership does not)
    dfn_stash = dict(dfn.get("stash") or {})
    grams_total = 0.0
    for sid, grams in list(dfn_stash.items()):
        take = round(float(grams), 2)
        if take <= 0:
            continue
        grams_total += take
        stolen["stash"][sid] = take
        atk_stash = dict(atk.get("stash") or {})
        atk_stash[sid] = float(atk_stash.get(sid) or 0) + take
        atk["stash"] = atk_stash
    dfn_stash = {}
    stolen["grams_total"] = round(grams_total, 2)

    cash_take = min(
        int(dfn.get("business_cash") or 0),
        max(0, int((dfn.get("business_cash") or 0) * RAID_CASH_STEAL_FRAC)),
        RAID_CASH_STEAL_CAP,
    )
    if cash_take > 0:
        dfn["business_cash"] = int(dfn.get("business_cash") or 0) - cash_take
        atk["business_cash"] = int(atk.get("business_cash") or 0) + cash_take
        stolen["cash"] = cash_take

    # Steal one equipment piece — defender keeps upgrade level (must rebuy to reinstall)
    dfn_equip = dict(dfn.get("equipment") or {})
    stealable = [(k, int(v)) for k, v in dfn_equip.items() if int(v or 0) > 0 and k != "lights_cfl"]
    if not stealable:
        stealable = [(k, int(v)) for k, v in dfn_equip.items() if int(v or 0) > 0]
    if stealable:
        stealable.sort(
            key=lambda kv: kv[1]
            * equipment_level_cost(
                EQUIPMENT_BY_ID.get(kv[0]) or {"base_cost": 1000, "cost_growth": 1.2},
                max(1, kv[1]),
            ),
            reverse=True,
        )
        cat_id, lvl = stealable[0]
        dfn_equip.pop(cat_id, None)
        dfn["equipment"] = dfn_equip
        rebuy = _equipment_rebuy_map(dfn)
        rebuy[cat_id] = max(int(rebuy.get(cat_id) or 0), int(lvl))
        dfn["equipment_rebuy"] = rebuy
        dfn["last_equipment_stolen"] = {
            "category_id": cat_id,
            "level": int(lvl),
            "at": _iso(now),
            "name": (EQUIPMENT_BY_ID.get(cat_id) or {}).get("name") or cat_id,
        }
        equip_name = (EQUIPMENT_BY_ID.get(cat_id) or {}).get("name") or cat_id
        stolen["equipment"] = {
            "category_id": cat_id,
            "level": lvl,
            "name": equip_name,
            "defender_keeps_level": True,
        }
        inv = list(atk.get("stolen_equipment") or [])
        inv.append({"category_id": cat_id, "level": int(lvl), "name": equip_name})
        atk["stolen_equipment"] = inv
        _auto_equip_stolen_inventory(atk)
        still_stored = any(
            isinstance(x, dict)
            and str(x.get("category_id") or "") == cat_id
            and int(x.get("level") or 0) == int(lvl)
            for x in (atk.get("stolen_equipment") or [])
        )
        stolen["equipment"]["installed"] = not still_stored
        stolen["equipment"]["stored"] = still_stored

    if body.sabotage and atk.get("sabotage_unlocked"):
        dfn["heat"] = min(MAX_HEAT, float(dfn.get("heat") or 0) + 20)
        sabotage_note = "Heat spiked on their grow."

    dfn["stash"] = dfn_stash
    drs = dict(dfn.get("raid_stats") or {})
    drs["times_raided"] = int(drs.get("times_raided") or 0) + 1
    dfn["raid_stats"] = drs
    ars = dict(atk.get("raid_stats") or {})
    ars["raids_won"] = int(ars.get("raids_won") or 0) + 1
    atk["raid_stats"] = ars
    missions = dict(atk.get("missions") or {})
    missions["raid_wins"] = int(missions.get("raid_wins") or 0) + 1
    atk["missions"] = missions
    _add_heat(atk, 3.5)

    await _save_farm(
        atk,
        {
            "raid_last_by_target": atk.get("raid_last_by_target"),
            "raid_available_at": None,
            "stash": atk.get("stash"),
            "business_cash": atk["business_cash"],
            "equipment": atk.get("equipment"),
            "stolen_equipment": atk.get("stolen_equipment"),
            "raid_stats": ars,
            "missions": missions,
            "heat": atk["heat"],
        },
    )
    await db.weed_farms.update_one(
        {"user_id": defender_id},
        {
            "$set": {
                "stash": dfn_stash,
                "business_cash": dfn.get("business_cash"),
                "equipment": dfn.get("equipment"),
                "equipment_rebuy": dfn.get("equipment_rebuy") or {},
                "last_equipment_stolen": dfn.get("last_equipment_stolen"),
                "heat": dfn.get("heat"),
                "raid_stats": drs,
                "updated_at": _iso(),
            }
        },
    )

    equip_name = (stolen.get("equipment") or {}).get("name") or "gear"
    equip_lvl = (stolen.get("equipment") or {}).get("level")
    try:
        await send_notification(
            defender_id,
            "Weed Empire raid",
            (
                f"{current_user.get('username') or 'A rival'} raided your grow: "
                f"stole {stolen['grams_total']:.0f}g stash, ${stolen['cash']:,}"
                + (
                    f", and took your {equip_name}"
                    + (f" (Lv {equip_lvl})" if equip_lvl else "")
                    + " — rebuy it in Equipment to restore the same level."
                    if stolen.get("equipment")
                    else "."
                )
                + (f" {sabotage_note}" if sabotage_note else "")
            ),
            "system",
            category="missions",
        )
    except Exception:
        pass

    return {
        "ok": True,
        "success": True,
        "stolen": stolen,
        "sabotage": sabotage_note,
        "success_chance": round(chance, 3),
        "defender_security_fill": sec_progress.get("fill"),
        "target_user_id": defender_id,
        "raid_available_at": next_ready,
        "raid_cooldown_scope": "per_target",
        "farm": _public_farm(atk, username=current_user.get("username") or ""),
    }


@router.post("/stolen-equipment/equip")
async def weed_equip_stolen(body: EquipStolenBody, current_user: dict = Depends(_gate)):
    """Equip one stolen slot (and auto-equip any other pieces the house can hold)."""
    farm = await _get_or_create_farm(current_user["id"])
    inv = list(farm.get("stolen_equipment") or [])
    if body.index < 0 or body.index >= len(inv):
        raise HTTPException(status_code=400, detail="No stolen gear at that slot")
    item = inv[body.index] if isinstance(inv[body.index], dict) else {}
    cat_id = str(item.get("category_id") or "")
    try:
        lvl = int(item.get("level") or 0)
    except (TypeError, ValueError):
        lvl = 0
    cat = EQUIPMENT_BY_ID.get(cat_id)
    if not cat or lvl <= 0:
        inv.pop(body.index)
        farm["stolen_equipment"] = inv
        await _save_farm(farm, {"stolen_equipment": inv})
        raise HTTPException(status_code=400, detail="Invalid stolen gear")
    house_max = int(_house(farm).get("max_equip_tier") or 100)
    if int(farm.get("house_tier") or 0) < int(cat.get("min_house_tier") or 0):
        raise HTTPException(status_code=400, detail="House too small for this gear")
    if lvl > house_max:
        raise HTTPException(status_code=400, detail="Upgrade house for this gear level")
    _auto_equip_stolen_inventory(farm)
    await _save_farm(
        farm,
        {"equipment": farm.get("equipment"), "stolen_equipment": farm.get("stolen_equipment")},
    )
    equip_lvl = int((farm.get("equipment") or {}).get(cat_id) or 0)
    return {
        "ok": True,
        "equipped": {"category_id": cat_id, "level": equip_lvl, "name": cat.get("name") or cat_id},
        "farm": _public_farm(farm, username=current_user.get("username") or ""),
    }


@router.post("/dealers/sell")
async def weed_dealer_sell(
    http_request: Request,
    body: Optional[DealerSellBody] = None,
    current_user: dict = Depends(_gate),
):
    """Passive drip sell via dealers (counts toward daily cap)."""
    await _require_weed_action_code(http_request, current_user)
    lock = await _weed_farm_lock(current_user["id"])
    async with lock:
        farm = await _get_or_create_farm(current_user["id"])
        expected_at = farm.get("updated_at")
        try:
            result = _dealer_sell_stash(farm, assistant_share=False)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        saved = await _save_farm(
            farm,
            {
                "stash": farm.get("stash"),
                "business_cash": farm["business_cash"],
                "daily_sold_usd": farm["daily_sold_usd"],
                "daily_sold_utc_date": farm["daily_sold_utc_date"],
                "lifetime_sold_usd": farm["lifetime_sold_usd"],
            },
            expected_updated_at=expected_at,
        )
        if not saved:
            raise HTTPException(status_code=409, detail="Sell conflict — refresh and try again")
        fresh = await db.weed_farms.find_one({"user_id": current_user["id"]}, {"_id": 0})
        if fresh:
            await _attach_exclusive_owned(fresh)
            farm = fresh
        return {
            "ok": True,
            "payout": result["payout"],
            "farm": _public_farm(
                farm,
                username=current_user.get("username") or "",
                apply_curing_tick=False,
            ),
        }


@router.post("/upgrade-dealers")
async def weed_upgrade_dealers(current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    lvl = int(farm.get("dealers_level") or 0)
    if lvl < 1:
        raise HTTPException(status_code=400, detail="Unlock dealers first")
    if lvl >= MAX_DEALERS_LEVEL:
        raise HTTPException(status_code=400, detail="Dealers maxed")
    cost = _scaled_upgrade_cost(farm, dealers_upgrade_cost(lvl))
    _spend(farm, cost)
    farm["dealers_level"] = lvl + 1
    await _save_farm(farm, {"business_cash": farm["business_cash"], "dealers_level": farm["dealers_level"]})
    return {"ok": True, "farm": _public_farm(farm, username=current_user.get("username") or "")}


@router.post("/assistant/hire")
async def weed_assistant_hire(current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    workers = _ensure_assistants(farm)
    hired_count = sum(1 for w in workers if w.get("hired"))
    cost = _assistant_hire_cost(hired_count)
    if cost is None:
        return {"ok": True, "farm": _public_farm(farm, username=current_user.get("username") or "")}
    # Fill first empty slot
    slot = next((i for i, w in enumerate(workers) if not w.get("hired")), None)
    if slot is None:
        raise HTTPException(status_code=400, detail="Crew is full")
    _spend(farm, cost)
    workers[slot] = {
        "hired": True,
        "enabled": True,
        "mode": "harvest",
        "level": 1,
        "last_tick_at": None,
        "last_run": None,
        "plant_strain_id": ASSISTANT_DEFAULT_PLANT_STRAIN,
        "plant_soil_type": ASSISTANT_DEFAULT_PLANT_SOIL,
    }
    farm["assistants"] = workers
    _sync_legacy_assistant_fields(farm)
    await _save_farm(
        farm,
        {
            "business_cash": farm["business_cash"],
            "assistants": workers,
            "assistant_hired": farm["assistant_hired"],
            "assistant_enabled": farm["assistant_enabled"],
            "assistant_mode": farm["assistant_mode"],
            "assistant_level": farm["assistant_level"],
        },
    )
    return {"ok": True, "farm": _public_farm(farm, username=current_user.get("username") or "")}


@router.post("/assistant/mode")
async def weed_assistant_mode(body: AssistantModeBody, current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    workers = _ensure_assistants(farm)
    slot = int(body.slot or 0)
    if slot < 0 or slot >= len(workers) or not workers[slot].get("hired"):
        raise HTTPException(status_code=400, detail="Hire that worker first")
    mode = (body.mode or "").strip()
    if mode not in ASSISTANT_MODES:
        raise HTTPException(status_code=400, detail="Invalid assistant mode")
    if mode == "sell_dealer" and int(farm.get("dealers_level") or 0) < 1:
        raise HTTPException(status_code=400, detail="Unlock dealers before sell-to-dealer mode")
    workers[slot]["mode"] = mode
    # Mode change: allow an immediate job (don't wait out the prior tick cooldown)
    workers[slot]["last_tick_at"] = None
    farm["assistants"] = workers
    _sync_legacy_assistant_fields(farm)
    await _attach_exclusive_owned(farm)
    now = _utcnow()
    assistant_run = None
    if workers[slot].get("enabled"):
        summary = _run_one_assistant_job(farm, workers[slot], now)
        summary["slot"] = slot
        summary["label"] = f"Worker {slot + 1}"
        assistant_run = summary
        farm["assistants"] = workers
        _sync_legacy_assistant_fields(farm)
    await _save_farm(
        farm,
        {
            "assistants": workers,
            "assistant_mode": farm["assistant_mode"],
            "assistant_last_tick_at": farm.get("assistant_last_tick_at"),
            "assistant_last_run": farm.get("assistant_last_run"),
            "plots": farm.get("plots"),
            "business_cash": farm.get("business_cash"),
            "soil_stock": farm.get("soil_stock"),
            "heat": farm.get("heat"),
            "heat_high_since": farm.get("heat_high_since"),
            "stash": farm.get("stash"),
            "curing": farm.get("curing"),
            "daily_sold_usd": farm.get("daily_sold_usd"),
            "daily_sold_utc_date": farm.get("daily_sold_utc_date"),
            "lifetime_sold_usd": farm.get("lifetime_sold_usd"),
            "missions": farm.get("missions"),
            "grower_level": farm.get("grower_level"),
            "grower_xp": farm.get("grower_xp"),
            "unlocks": farm.get("unlocks"),
            "cleanliness_pct": farm.get("cleanliness_pct"),
            "last_cleanliness_tick_at": farm.get("last_cleanliness_tick_at"),
            "sabotage_unlocked": farm.get("sabotage_unlocked"),
        },
    )
    return {
        "ok": True,
        "farm": _public_farm(farm, username=current_user.get("username") or ""),
        "assistant_run": assistant_run,
    }


@router.post("/assistant/enabled")
async def weed_assistant_enabled(body: AssistantEnabledBody, current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    workers = _ensure_assistants(farm)
    slot = int(body.slot or 0)
    if slot < 0 or slot >= len(workers) or not workers[slot].get("hired"):
        raise HTTPException(status_code=400, detail="Hire that worker first")
    workers[slot]["enabled"] = bool(body.enabled)
    assistant_run = None
    if body.enabled:
        workers[slot]["last_tick_at"] = None
        farm["assistants"] = workers
        await _attach_exclusive_owned(farm)
        now = _utcnow()
        summary = _run_one_assistant_job(farm, workers[slot], now)
        summary["slot"] = slot
        summary["label"] = f"Worker {slot + 1}"
        assistant_run = summary
    farm["assistants"] = workers
    _sync_legacy_assistant_fields(farm)
    await _save_farm(
        farm,
        {
            "assistants": workers,
            "assistant_enabled": farm["assistant_enabled"],
            "assistant_last_tick_at": farm.get("assistant_last_tick_at"),
            "assistant_last_run": farm.get("assistant_last_run"),
            "plots": farm.get("plots"),
            "business_cash": farm.get("business_cash"),
            "soil_stock": farm.get("soil_stock"),
            "heat": farm.get("heat"),
            "heat_high_since": farm.get("heat_high_since"),
            "stash": farm.get("stash"),
            "curing": farm.get("curing"),
            "daily_sold_usd": farm.get("daily_sold_usd"),
            "daily_sold_utc_date": farm.get("daily_sold_utc_date"),
            "lifetime_sold_usd": farm.get("lifetime_sold_usd"),
            "missions": farm.get("missions"),
            "grower_level": farm.get("grower_level"),
            "grower_xp": farm.get("grower_xp"),
            "unlocks": farm.get("unlocks"),
            "cleanliness_pct": farm.get("cleanliness_pct"),
            "last_cleanliness_tick_at": farm.get("last_cleanliness_tick_at"),
            "sabotage_unlocked": farm.get("sabotage_unlocked"),
        },
    )
    return {
        "ok": True,
        "farm": _public_farm(farm, username=current_user.get("username") or ""),
        "assistant_run": assistant_run,
    }


@router.post("/assistant/plant-prefs")
async def weed_assistant_plant_prefs(body: AssistantPlantPrefsBody, current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    await _attach_exclusive_owned(farm)
    workers = _ensure_assistants(farm)
    slot = int(body.slot or 0)
    if slot < 0 or slot >= len(workers) or not workers[slot].get("hired"):
        raise HTTPException(status_code=400, detail="Hire that worker first")
    strain_id = _normalize_plant_strain(body.strain_id)
    soil_type = _normalize_plant_soil(body.soil_type)
    err = _assistant_strain_allowed(farm, strain_id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    try:
        _soil_bag_purchase_cost(farm, soil_type)
    except ValueError as e:
        # Allow conventional even if somehow locked — plant will surface error
        if soil_type != "soil_conventional":
            raise HTTPException(status_code=400, detail=str(e))
    workers[slot]["plant_strain_id"] = strain_id
    workers[slot]["plant_soil_type"] = soil_type
    assistant_run = None
    # Prefs change while plant mode is on → fill empties now with the new loadout
    if workers[slot].get("enabled") and str(workers[slot].get("mode") or "") == "plant":
        workers[slot]["last_tick_at"] = None
        farm["assistants"] = workers
        now = _utcnow()
        summary = _run_one_assistant_job(farm, workers[slot], now)
        summary["slot"] = slot
        summary["label"] = f"Worker {slot + 1}"
        assistant_run = summary
    farm["assistants"] = workers
    _sync_legacy_assistant_fields(farm)
    await _save_farm(
        farm,
        {
            "assistants": workers,
            "unlocks": farm.get("unlocks"),
            "assistant_last_tick_at": farm.get("assistant_last_tick_at"),
            "assistant_last_run": farm.get("assistant_last_run"),
            "plots": farm.get("plots"),
            "business_cash": farm.get("business_cash"),
            "soil_stock": farm.get("soil_stock"),
            "heat": farm.get("heat"),
            "heat_high_since": farm.get("heat_high_since"),
        },
    )
    return {
        "ok": True,
        "farm": _public_farm(farm, username=current_user.get("username") or ""),
        "assistant_run": assistant_run,
    }


# ---------------------------------------------------------------------------
# Admin: sell-spam audit + clawback
# ---------------------------------------------------------------------------
_DEFAULT_WEED_EQUIPMENT = {
    "lights_cfl": 1,
    "pots": 1,
    "soil_conventional": 1,
    "tents": 1,
    "irrigation": 1,
    "nutes_base": 1,
}


def _weed_farm_suspicion(farm: dict) -> Dict[str, Any]:
    missions = farm.get("missions") or {}
    harvests = int(missions.get("harvest_count") or 0)
    sells = int(missions.get("sell_count") or 0)
    lifetime = int(farm.get("lifetime_sold_usd") or 0)
    cash = int(farm.get("business_cash") or 0)
    level = int(farm.get("grower_level") or 1)
    expected_cap = max(1, harvests) * _WEED_AUDIT_MAX_USD_PER_HARVEST
    flags: List[str] = []
    if harvests > 0 and lifetime > expected_cap:
        flags.append("lifetime_sold_over_harvest_cap")
    if harvests == 0 and lifetime >= 250_000:
        flags.append("sold_without_harvests")
    if sells > max(5, harvests * 3):
        flags.append("sell_count_vs_harvests")
    if cash >= 1_000_000 and level <= 6 and harvests < 15:
        flags.append("high_cash_low_progress")
    if lifetime >= 2_000_000 and harvests < 25:
        flags.append("high_lifetime_low_harvests")
    score = len(flags) * 10
    if lifetime > expected_cap and harvests > 0:
        score += min(50, int((lifetime / expected_cap - 1) * 20))
    return {
        "suspicious": bool(flags),
        "score": score,
        "flags": flags,
        "harvest_count": harvests,
        "sell_count": sells,
        "lifetime_sold_usd": lifetime,
        "expected_lifetime_cap_usd": expected_cap,
        "business_cash": cash,
        "grower_level": level,
        "dealers_level": int(farm.get("dealers_level") or 0),
        "house_tier": int(farm.get("house_tier") or 0),
        "equipment": dict(farm.get("equipment") or {}),
        "stash_grams": round(sum(float(v or 0) for v in (farm.get("stash") or {}).values()), 2),
    }


class WeedClawbackBody(BaseModel):
    dry_run: bool = True
    reset_cash: bool = True
    reset_xp: bool = True
    reset_equipment: bool = True
    reset_dealers: bool = True
    reset_sold_stats: bool = True
    reset_house: bool = False
    wipe_stash: bool = False
    cash_to: Optional[int] = None  # default START_BUSINESS_CASH when reset_cash


async def _admin_resolve_user(user_id_or_username: str) -> dict:
    raw = (user_id_or_username or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Username required")
    u = await db.users.find_one({"id": raw}, {"_id": 0, "id": 1, "username": 1})
    if not u:
        import re as _re

        pat = {"$regex": f"^{_re.escape(raw)}$", "$options": "i"}
        u = await db.users.find_one({"username": pat}, {"_id": 0, "id": 1, "username": 1})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return u


@router.get("/admin/sell-audit")
async def weed_admin_sell_audit(
    current_user: dict = Depends(get_current_user),
    min_score: int = Query(10, ge=0, le=200),
    limit: int = Query(100, ge=1, le=500),
):
    """List farms that look like they benefited from sell spam (heuristic)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    rows: List[Dict[str, Any]] = []
    cursor = db.weed_farms.find({}, {"_id": 0})
    async for farm in cursor:
        sus = _weed_farm_suspicion(farm)
        if not sus["suspicious"] or sus["score"] < min_score:
            continue
        uid = farm.get("user_id")
        user = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1}) if uid else None
        # Burst sell events (after fix logging) — same strain within 3s
        burst = 0
        try:
            since = _utcnow() - timedelta(days=14)
            evs = (
                await db.weed_sell_events.find(
                    {"user_id": uid, "created_at": {"$gte": since}},
                    {"_id": 0, "created_at": 1, "payout": 1, "grams_sold": 1},
                )
                .sort("created_at", 1)
                .to_list(500)
            )
            for i in range(1, len(evs)):
                a = evs[i - 1].get("created_at")
                b = evs[i].get("created_at")
                if a and b and (b - a).total_seconds() <= 3:
                    burst += 1
            if burst >= 3:
                sus["flags"].append("rapid_sell_events")
                sus["score"] += 15
                sus["suspicious"] = True
            sus["recent_sell_events"] = len(evs)
            sus["rapid_pairs"] = burst
        except Exception:
            sus["recent_sell_events"] = 0
            sus["rapid_pairs"] = 0
        rows.append(
            {
                "user_id": uid,
                "username": (user or {}).get("username") or farm.get("username") or uid,
                **sus,
            }
        )
    rows.sort(key=lambda r: (-int(r.get("score") or 0), -int(r.get("lifetime_sold_usd") or 0)))
    return {
        "ok": True,
        "count": len(rows[:limit]),
        "heuristic": {
            "max_usd_per_harvest": _WEED_AUDIT_MAX_USD_PER_HARVEST,
            "note": "Flags are heuristics — confirm before clawback. Past exploit may lack sell event logs.",
        },
        "suspects": rows[:limit],
    }


@router.get("/admin/farm/{user_id_or_username}")
async def weed_admin_farm(user_id_or_username: str, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    u = await _admin_resolve_user(user_id_or_username)
    farm = await db.weed_farms.find_one({"user_id": u["id"]}, {"_id": 0})
    if not farm:
        raise HTTPException(status_code=404, detail="No weed farm for this user")
    events = (
        await db.weed_sell_events.find({"user_id": u["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(50)
    )
    for ev in events:
        if isinstance(ev.get("created_at"), datetime):
            ev["created_at"] = ev["created_at"].isoformat()
    return {
        "ok": True,
        "username": u.get("username"),
        "user_id": u["id"],
        "suspicion": _weed_farm_suspicion(farm),
        "farm": _public_farm(farm, username=u.get("username") or ""),
        "recent_sells": events,
    }


@router.post("/admin/clawback/{user_id_or_username}")
async def weed_admin_clawback(
    user_id_or_username: str,
    body: WeedClawbackBody,
    current_user: dict = Depends(get_current_user),
):
    """Reset exploit gains: business cash / grower XP / equipment / sold stats (preview with dry_run)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    u = await _admin_resolve_user(user_id_or_username)
    lock = await _weed_farm_lock(u["id"])
    async with lock:
        farm = await db.weed_farms.find_one({"user_id": u["id"]}, {"_id": 0})
        if not farm:
            raise HTTPException(status_code=404, detail="No weed farm for this user")
        before = {
            "business_cash": int(farm.get("business_cash") or 0),
            "grower_level": int(farm.get("grower_level") or 1),
            "grower_xp": int(farm.get("grower_xp") or 0),
            "lifetime_sold_usd": int(farm.get("lifetime_sold_usd") or 0),
            "daily_sold_usd": int(farm.get("daily_sold_usd") or 0),
            "dealers_level": int(farm.get("dealers_level") or 0),
            "house_tier": int(farm.get("house_tier") or 0),
            "equipment": dict(farm.get("equipment") or {}),
            "missions": dict(farm.get("missions") or {}),
            "stash_grams": round(sum(float(v or 0) for v in (farm.get("stash") or {}).values()), 2),
        }
        set_fields: Dict[str, Any] = {}
        changes: List[str] = []
        if body.reset_cash:
            target = START_BUSINESS_CASH if body.cash_to is None else max(0, int(body.cash_to))
            set_fields["business_cash"] = target
            changes.append(f"business_cash {before['business_cash']} → {target}")
        if body.reset_xp:
            set_fields["grower_level"] = 1
            set_fields["grower_xp"] = 0
            changes.append(f"grower Lv{before['grower_level']} xp{before['grower_xp']} → Lv1 xp0")
        if body.reset_equipment:
            set_fields["equipment"] = dict(_DEFAULT_WEED_EQUIPMENT)
            changes.append("equipment → starter levels")
        if body.reset_dealers:
            set_fields["dealers_level"] = 0
            changes.append(f"dealers_level {before['dealers_level']} → 0")
        if body.reset_sold_stats:
            set_fields["lifetime_sold_usd"] = 0
            set_fields["daily_sold_usd"] = 0
            set_fields["daily_sold_utc_date"] = _utc_date_str()
            missions = dict(farm.get("missions") or {})
            missions["sell_count"] = 0
            set_fields["missions"] = missions
            changes.append("lifetime/daily sold + sell_count cleared")
        if body.reset_house:
            set_fields["house_tier"] = 0
            changes.append(f"house_tier {before['house_tier']} → 0")
        if body.wipe_stash:
            set_fields["stash"] = {}
            set_fields["curing"] = []
            changes.append("stash + curing wiped")
        if not set_fields:
            raise HTTPException(status_code=400, detail="No clawback options selected")
        preview = {
            "username": u.get("username"),
            "user_id": u["id"],
            "before": before,
            "changes": changes,
            "set_fields": {k: (dict(v) if isinstance(v, dict) else v) for k, v in set_fields.items()},
            "suspicion": _weed_farm_suspicion(farm),
        }
        if body.dry_run:
            return {"ok": True, "dry_run": True, "preview": preview, "message": "Dry run — no changes applied"}
        await db.weed_farms.update_one({"user_id": u["id"]}, {"$set": {**set_fields, "updated_at": _iso()}})
        try:
            await log_activity(
                current_user.get("id") or "",
                current_user.get("username") or "?",
                "admin_weed_empire_clawback",
                {
                    "target_user_id": u["id"],
                    "target_username": u.get("username"),
                    "changes": changes,
                    "before": before,
                },
            )
        except Exception:
            pass
        fresh = await db.weed_farms.find_one({"user_id": u["id"]}, {"_id": 0})
        return {
            "ok": True,
            "dry_run": False,
            "preview": preview,
            "farm": _public_farm(fresh, username=u.get("username") or "") if fresh else None,
            "message": f"Clawback applied for {u.get('username')}",
        }


@router.post("/admin/reset-all-heat")
async def weed_admin_reset_all_heat(
    current_user: dict = Depends(get_current_user),
    dry_run: bool = Query(False, description="Count only; do not write"),
    confirm: bool = Query(False, description="Must be true to apply (when not dry_run)"),
):
    """
    Set every weed farm's heat to 0 and clear bust timers.
    Use after rolling out the new passive heat / bust system so existing farms start clean.
    """
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")

    match = {"heat": {"$gt": 0}}
    high_match = {"heat_high_since": {"$ne": None}}
    hot_count = await db.weed_farms.count_documents(match)
    bust_timer_count = await db.weed_farms.count_documents(high_match)
    total_farms = await db.weed_farms.count_documents({})

    if dry_run or not confirm:
        return {
            "ok": True,
            "dry_run": True,
            "total_farms": total_farms,
            "farms_with_heat": hot_count,
            "farms_with_bust_timer": bust_timer_count,
            "message": (
                f"Would clear heat on ~{hot_count} farm(s) and bust timers on ~{bust_timer_count}. "
                "Call again with confirm=true to apply."
            ),
        }

    now_iso = _iso()
    res = await db.weed_farms.update_many(
        {},
        {
            "$set": {
                "heat": 0.0,
                "heat_high_since": None,
                "last_heat_tick_at": now_iso,
                "updated_at": now_iso,
            }
        },
    )
    try:
        await log_activity(
            current_user.get("id") or "",
            current_user.get("username") or "?",
            "admin_weed_empire_reset_all_heat",
            {
                "matched": int(res.matched_count or 0),
                "modified": int(res.modified_count or 0),
                "farms_with_heat_before": hot_count,
                "farms_with_bust_timer_before": bust_timer_count,
            },
        )
    except Exception:
        pass
    return {
        "ok": True,
        "dry_run": False,
        "total_farms": total_farms,
        "farms_with_heat_before": hot_count,
        "farms_with_bust_timer_before": bust_timer_count,
        "matched": int(res.matched_count or 0),
        "modified": int(res.modified_count or 0),
        "message": f"Heat cleared for {int(res.modified_count or 0)} farm(s).",
    }


def register(api_router: APIRouter) -> None:
    api_router.include_router(router)
