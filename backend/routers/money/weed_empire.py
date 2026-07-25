"""Weed Business Empire — standalone grow / sell / raid loop (staff-preview gated)."""
from __future__ import annotations

import logging
import math
import secrets
import uuid
import hashlib
import hmac
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from server import SECRET_KEY, db, get_current_user, send_notification
from utils.store_item_flags import require_store_item_allowed
from utils.weed_empire_catalog import (
    DAILY_SELL_CAP_USD,
    EQUIPMENT_BY_ID,
    EQUIPMENT_CATEGORIES,
    HOUSE_BY_TIER,
    HOUSES,
    SOIL_CHARGE_PER_PLANT,
    START_BUSINESS_CASH,
    STRAIN_BY_ID,
    STRAINS,
    active_light_class,
    aggregate_stats,
    apply_grower_xp,
    assert_can_upgrade_equipment,
    curing_minutes,
    equipment_level_cost,
    equipment_shop_entries,
    grams_to_oz,
    grower_progress,
    market_price_per_oz,
    rarity_xp_mult,
    shop_status_for_farm,
    unit_to_grams,
)

logger = logging.getLogger(__name__)
_rng = secrets.SystemRandom()

FEATURE_ID = "weed_empire"
WATER_INTERVAL_HOURS = 1.5
FEED_INTERVAL_HOURS = 2.5
# Irrigation equipment unlocks automation (hand → drip → auto).
AUTO_WATER_IRRIGATION_LEVEL = 5
AUTO_FEED_IRRIGATION_LEVEL = 8
MAX_HEAT = 100.0
MIN_RAID_GROWER_LEVEL = 2
MIN_RAID_TARGET_GROWER_LEVEL = 2
WEED_ACTION_CODE_PREFIX = "we_"
WEED_ACTION_CODE_BUCKET_SECONDS = 7200
CLEANLINESS_SAFE_PCT = 30.0
CLEANLINESS_BASE_DECAY_PER_HOUR = 0.25
CLEANLINESS_ACTIVE_PLOT_DECAY_PER_HOUR = 0.45
CLEAN_ROOM_BASE_COST = 4_000
CLEAN_ROOM_HOUSE_TIER_COST = 2_500
CLEAN_ROOM_ACTIVE_PLOT_COST = 750
MITE_RISK_INTERVAL_HOURS = 1.0
MITE_BASE_RISK_CHANCE = 0.08
MITE_MAX_DIRT_RISK_CHANCE = 0.22
MITE_ACTIVE_PLOT_RISK_CHANCE = 0.01
MITE_NEW_INFESTATION_PCT = 12.0
MITE_EXISTING_GROWTH_PCT = 2.0
MITE_QUALITY_DRAIN_PER_HOUR = 0.6
MITE_MAX_HARVEST_YIELD_PENALTY_PCT = 35.0
MITE_TREATMENT_BASE_COST = 2_500
MITE_TREATMENT_COST_PER_PCT = 50
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
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
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
        "lifetime_sold_usd": 0,
        "grower_level": 1,
        "grower_xp": 0,
        "stash": {},  # strain_id -> grams cured
        "curing": [],  # {id, strain_id, grams, quality, started_at, ready_at}
        "heat": 5.0,
        "cleanliness_pct": 100.0,
        "last_cleanliness_tick_at": _iso(),
        "unlocks": ["ditch_weed", "schwag", "northern_lights", "white_widow"],
        "raid_last_by_target": {},  # defender_id -> utc date
        "raid_stats": {"raids_won": 0, "raids_lost": 0, "times_raided": 0},
        "dealers_level": 0,
        "missions": {"harvest_count": 0, "sell_count": 0, "raid_wins": 0},
        "sabotage_unlocked": False,
        "created_at": _iso(),
        "updated_at": _iso(),
    }


async def _require_access(user: dict) -> None:
    await require_store_item_allowed(db, FEATURE_ID, user)


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
        if migration:
            await db.weed_farms.update_one({"user_id": user_id}, {"$set": migration})
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
    return doc


def _house(farm: dict) -> Dict[str, Any]:
    return HOUSE_BY_TIER.get(int(farm.get("house_tier") or 0)) or HOUSE_BY_TIER[0]


def _equip_levels(farm: dict) -> Dict[str, int]:
    raw = farm.get("equipment") or {}
    return {str(k): int(v or 0) for k, v in raw.items() if int(v or 0) > 0}


def _stats(farm: dict) -> Dict[str, float]:
    return aggregate_stats(_equip_levels(farm), _house(farm))


def _ensure_daily_cap(farm: dict) -> dict:
    today = _utc_date_str()
    if farm.get("daily_sold_utc_date") != today:
        farm["daily_sold_utc_date"] = today
        farm["daily_sold_usd"] = 0
    return farm


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


def _tick_curing(farm: dict, now: datetime) -> dict:
    curing = list(farm.get("curing") or [])
    stash = dict(farm.get("stash") or {})
    still = []
    cure_level = int(_equip_levels(farm).get("curing") or 0)
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
                stash[sid] = float(stash.get(sid) or 0) + grams
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


def _public_farm(farm: dict, *, username: str = "") -> Dict[str, Any]:
    now = _utcnow()
    farm = _ensure_daily_cap(dict(farm))
    farm = _sync_plot_count(farm)
    stats = _stats(farm)
    farm = _tick_environment(farm, stats, now)
    plots = [_tick_plot(dict(p), farm, stats, now) for p in (farm.get("plots") or [])]
    # Persist auto-tend timestamps back onto farm plots
    farm["plots"] = plots
    farm = _tick_curing(farm, now)
    light = active_light_class(_equip_levels(farm))
    house = _house(farm)
    sold = int(farm.get("daily_sold_usd") or 0)
    street_prices = {
        strain["id"]: round(
            market_price_per_oz(
                strain,
                house_tier=int(farm.get("house_tier") or 0),
                dealers_level=int(farm.get("dealers_level") or 0),
                sold_today_usd=sold,
                heat=float(farm.get("heat") or 0),
            ),
            2,
        )
        for strain in STRAINS
    }
    auto_water, auto_feed = _auto_flags(farm)
    irrig_lvl = int(_equip_levels(farm).get("irrigation") or 0)
    gp = grower_progress(farm)
    shop = shop_status_for_farm(
        farm,
        house_tier=int(farm.get("house_tier") or 0),
        house_max_equip_tier=int(house.get("max_equip_tier") or 20),
        equipment_levels=_equip_levels(farm),
    )
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
        "daily_sold_usd": sold,
        "daily_sold_cap": DAILY_SELL_CAP_USD,
        "daily_sold_remaining": max(0, DAILY_SELL_CAP_USD - sold),
        "lifetime_sold_usd": int(farm.get("lifetime_sold_usd") or 0),
        "stash": farm.get("stash") or {},
        "curing": farm.get("curing") or [],
        "street_price_per_oz": street_prices,
        "heat": round(float(farm.get("heat") or 0), 1),
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
        "stats": {k: round(float(v), 4) if isinstance(v, float) else v for k, v in stats.items()},
        "active_light_class": light,
        "raid_stats": farm.get("raid_stats") or {},
        "dealers_level": int(farm.get("dealers_level") or 0),
        "missions": farm.get("missions") or {},
        "sabotage_unlocked": bool(farm.get("sabotage_unlocked")),
        "auto_water": auto_water,
        "auto_feed": auto_feed,
        "irrigation_level": irrig_lvl,
        "auto_water_at_irrigation": AUTO_WATER_IRRIGATION_LEVEL,
        "auto_feed_at_irrigation": AUTO_FEED_IRRIGATION_LEVEL,
        "scavenged_seed_available": _scavenged_seed_available(farm),
        "scavenged_strain_id": "ditch_weed",
        "scavenged_soil_type": "soil_conventional",
        **gp,
        "staff_preview": True,
    }


async def _save_farm(farm: dict, update: Dict[str, Any]) -> Dict[str, Any]:
    update = dict(update)
    update["updated_at"] = _iso()
    await db.weed_farms.update_one({"user_id": farm["user_id"]}, {"$set": update})
    farm.update(update)
    return farm


def _spend(farm: dict, cost: int) -> None:
    cash = int(farm.get("business_cash") or 0)
    if cost > cash:
        raise HTTPException(status_code=400, detail="Not enough weed business cash")
    farm["business_cash"] = cash - cost


def _add_heat(farm: dict, amount: float) -> None:
    farm["heat"] = min(MAX_HEAT, max(0.0, float(farm.get("heat") or 0) + amount))


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
class PlantBody(BaseModel):
    plot_id: str
    strain_id: str
    soil_type: str = "soil_conventional"


class PlotActionBody(BaseModel):
    plot_id: str


class SellBody(BaseModel):
    strain_id: str
    amount: float = Field(..., gt=0)
    unit: str = "oz"


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


# ---- Routes ----
async def _gate(user: dict = Depends(get_current_user)):
    await _require_access(user)
    return user


@router.get("/status")
async def weed_status(current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    # Persist lazy ticks
    pub = _public_farm(farm, username=current_user.get("username") or "")
    await _save_farm(
        farm,
        {
            "plots": pub["plots"],
            "curing": pub["curing"],
            "stash": pub["stash"],
            "daily_sold_usd": pub["daily_sold_usd"],
            "daily_sold_utc_date": farm.get("daily_sold_utc_date") or _utc_date_str(),
            "heat": pub["heat"],
            "cleanliness_pct": pub["cleanliness_pct"],
            "last_cleanliness_tick_at": pub["last_cleanliness_tick_at"],
        },
    )
    return {
        "farm": pub,
        "catalog": {
            "houses": HOUSES,
            "strains": STRAINS,
            "equipment_categories": EQUIPMENT_CATEGORIES,
            "equipment_shop": equipment_shop_entries(),
            "start_business_cash": START_BUSINESS_CASH,
            "daily_sell_cap": DAILY_SELL_CAP_USD,
            "units": {"g": 1, "oz": 28, "lb": 448, "kg": 1000},
            "cleanliness_safe_pct": CLEANLINESS_SAFE_PCT,
            "mite_harvest_yield_penalty_cap_pct": MITE_MAX_HARVEST_YIELD_PENALTY_PCT,
        },
        **_weed_action_code_payload(current_user["id"]),
    }


@router.get("/catalog")
async def weed_catalog(current_user: dict = Depends(_gate)):
    return {
        "houses": HOUSES,
        "strains": STRAINS,
        "equipment_categories": EQUIPMENT_CATEGORIES,
        "equipment_shop_count": len(equipment_shop_entries()),
        "daily_sell_cap": DAILY_SELL_CAP_USD,
    }


@router.post("/plant")
async def weed_plant(body: PlantBody, http_request: Request, current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    farm = _sync_plot_count(farm)
    stats = _stats(farm)
    now = _utcnow()

    strain = STRAIN_BY_ID.get(body.strain_id)
    if not strain:
        raise HTTPException(status_code=404, detail="Unknown strain")
    unlocks = set(farm.get("unlocks") or [])
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
        _scavenged_seed_available(farm)
        and body.strain_id == "ditch_weed"
        and soil_type == "soil_conventional"
    )
    if scavenged_seed:
        await _require_weed_action_code(http_request, current_user)
    if int(stock.get(soil_type) or 0) < SOIL_CHARGE_PER_PLANT and not scavenged_seed:
        raise HTTPException(status_code=400, detail="Buy soil/medium first")
    if not _equip_levels(farm).get("pots") and not _equip_levels(farm).get("hydro_system"):
        raise HTTPException(status_code=400, detail="Need pots or a hydro system")
    if not any(_equip_levels(farm).get(k) for k in ("lights_cfl", "lights_led", "lights_hps", "lights_quantum")):
        raise HTTPException(status_code=400, detail="Need lights installed")

    seed_cost = int(strain.get("seed_cost") or 0)
    if not scavenged_seed:
        _spend(farm, seed_cost)
    if not scavenged_seed and int(stock.get(soil_type) or 0) >= SOIL_CHARGE_PER_PLANT:
        stock[soil_type] = int(stock.get(soil_type) or 0) - SOIL_CHARGE_PER_PLANT
    farm["soil_stock"] = stock

    plots = list(farm.get("plots") or [])
    found = False
    for i, p in enumerate(plots):
        if p.get("id") == body.plot_id:
            if p.get("state") not in ("empty", "dead", None):
                raise HTTPException(status_code=400, detail="Plot is not empty")
            base_q = 48.0 + (8.0 if soil_type == "soil_organic" else 0.0)
            plots[i] = {
                **_empty_plot(),
                "id": p["id"],
                "state": "growing",
                "strain_id": body.strain_id,
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
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Plot not found")

    farm["plots"] = plots
    _add_heat(farm, 1.5)
    await _save_farm(
        farm,
        {
            "plots": plots,
            "business_cash": farm["business_cash"],
            "soil_stock": stock,
            "heat": farm["heat"],
            "unlocks": farm.get("unlocks"),
        },
    )
    return {
        "ok": True,
        "farm": _public_farm(farm, username=current_user.get("username") or ""),
        "fx": "plant",
        "scavenged_seed": scavenged_seed,
    }


async def _tend(plot_id: str, kind: str, current_user: dict) -> dict:
    farm = await _get_or_create_farm(current_user["id"])
    now = _utcnow()
    plots = list(farm.get("plots") or [])
    for i, p in enumerate(plots):
        if p.get("id") != plot_id:
            continue
        if p.get("state") not in ("growing", "harvest_ready"):
            raise HTTPException(status_code=400, detail="Nothing to tend")
        if kind == "water":
            plots[i] = {**p, "last_watered_at": _iso(now), "quality": min(100.0, float(p.get("quality") or 50) + 1.5)}
            fx = "water"
        else:
            plots[i] = {**p, "last_fed_at": _iso(now), "quality": min(100.0, float(p.get("quality") or 50) + 2.0)}
            fx = "feed"
        farm["plots"] = plots
        await _save_farm(farm, {"plots": plots})
        return {"ok": True, "farm": _public_farm(farm, username=current_user.get("username") or ""), "fx": fx}
    raise HTTPException(status_code=404, detail="Plot not found")


@router.post("/water")
async def weed_water(body: PlotActionBody, current_user: dict = Depends(_gate)):
    return await _tend(body.plot_id, "water", current_user)


@router.post("/feed")
async def weed_feed(body: PlotActionBody, current_user: dict = Depends(_gate)):
    return await _tend(body.plot_id, "feed", current_user)


@router.post("/harvest")
async def weed_harvest(body: PlotActionBody, http_request: Request, current_user: dict = Depends(_gate)):
    await _require_weed_action_code(http_request, current_user)
    farm = await _get_or_create_farm(current_user["id"])
    stats = _stats(farm)
    now = _utcnow()
    farm = _tick_environment(farm, stats, now)
    plots = [_tick_plot(dict(p), farm, stats, now) for p in (farm.get("plots") or [])]

    for i, p in enumerate(plots):
        if p.get("id") != body.plot_id:
            continue
        if p.get("stage") != "harvest_ready" and p.get("state") != "harvest_ready":
            raise HTTPException(status_code=400, detail="Plant not ready")
        strain = STRAIN_BY_ID.get(p.get("strain_id") or "")
        if not strain:
            raise HTTPException(status_code=400, detail="Invalid plant")
        q = float(p.get("quality") or 50) / 100.0
        y_min = float(strain.get("yield_g_min") or 10)
        y_max = float(strain.get("yield_g_max") or 20)
        base = y_min + (y_max - y_min) * q
        grams = base * float(stats.get("yield_mult") or 1.0)
        if p.get("soil_type") == "soil_organic":
            grams *= 1.05
        mite_yield_penalty_pct = _mite_yield_penalty_pct(p)
        grams *= 1.0 - mite_yield_penalty_pct / 100.0
        grams = round(max(1.0, grams), 2)
        trim_lvl = int(_equip_levels(farm).get("trimmers") or 0)
        cure_lvl = int(_equip_levels(farm).get("curing") or 0)
        cure_minutes = curing_minutes(grams, cure_lvl)
        batch = {
            "id": str(uuid.uuid4()),
            "strain_id": strain["id"],
            "grams": grams,
            "quality": float(p.get("quality") or 50),
            "started_at": _iso(now),
            "ready_at": _iso(now + timedelta(minutes=cure_minutes)),
            "curing_minutes": round(cure_minutes, 2),
        }
        curing = list(farm.get("curing") or [])
        curing.append(batch)
        plots[i] = _empty_plot()
        plots[i]["id"] = p["id"]
        missions = dict(farm.get("missions") or {})
        missions["harvest_count"] = int(missions.get("harvest_count") or 0) + 1
        if missions["harvest_count"] >= 10:
            farm["sabotage_unlocked"] = True
        farm["plots"] = plots
        farm["curing"] = curing
        farm["missions"] = missions
        _add_heat(farm, 2.0)
        xp_amt = int(25 * rarity_xp_mult(str(strain.get("rarity") or "common")))
        xp_fields, leveled, new_lvl = apply_grower_xp(farm, xp_amt)
        farm.update(xp_fields)
        await _save_farm(
            farm,
            {
                "plots": plots,
                "curing": curing,
                "missions": missions,
                "heat": farm["heat"],
                "sabotage_unlocked": farm.get("sabotage_unlocked"),
                "cleanliness_pct": farm["cleanliness_pct"],
                "last_cleanliness_tick_at": farm["last_cleanliness_tick_at"],
                **xp_fields,
            },
        )
        return {
            "ok": True,
            "grams": grams,
            "trim_level": trim_lvl,
            "mite_yield_penalty_pct": round(mite_yield_penalty_pct, 2),
            "fx": "harvest_trim",
            "xp_gained": xp_amt,
            "leveled_up": leveled,
            "grower_level": new_lvl,
            "farm": _public_farm(farm, username=current_user.get("username") or ""),
        }
    raise HTTPException(status_code=404, detail="Plot not found")


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
    farm = await _get_or_create_farm(current_user["id"])
    now = _utcnow()
    stats = _stats(farm)
    farm = _tick_environment(farm, stats, now)
    plots = list(farm.get("plots") or [])
    for i, plot in enumerate(plots):
        if plot.get("id") != body.plot_id:
            continue
        if plot.get("state") not in ("growing", "harvest_ready"):
            raise HTTPException(status_code=400, detail="No living plant to treat")
        infestation = float(plot.get("mite_infestation_pct") or 0.0)
        if infestation <= 0:
            raise HTTPException(status_code=400, detail="This plant has no spider mites")
        cost = _mite_treatment_cost(plot)
        _spend(farm, cost)
        effect_pct = _mite_treatment_effect_pct(stats)
        remaining = max(0.0, infestation * (1.0 - effect_pct / 100.0))
        if remaining < 1.0:
            remaining = 0.0
        plots[i] = {
            **plot,
            "mite_infestation_pct": round(remaining, 2),
            "mite_infested": remaining > 0,
            "last_mite_treated_at": _iso(now),
            "last_mite_damage_at": _iso(now),
        }
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
            "cost": cost,
            "treatment_effect_pct": round(effect_pct, 2),
            "remaining_infestation_pct": round(remaining, 2),
            "farm": _public_farm(farm, username=current_user.get("username") or ""),
            "fx": "treat_mites",
        }
    raise HTTPException(status_code=404, detail="Plot not found")


@router.post("/sell")
async def weed_sell(body: SellBody, http_request: Request, current_user: dict = Depends(_gate)):
    await _require_weed_action_code(http_request, current_user)
    farm = await _get_or_create_farm(current_user["id"])
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
    if grams > have + 1e-6:
        raise HTTPException(status_code=400, detail="Not enough stash")

    oz = grams_to_oz(grams)
    price_per_oz = market_price_per_oz(
        strain,
        house_tier=int(farm.get("house_tier") or 0),
        dealers_level=int(farm.get("dealers_level") or 0),
        sold_today_usd=float(farm.get("daily_sold_usd") or 0),
        heat=float(farm.get("heat") or 0),
    )
    # Bulk sweetener for lb/kg
    u = body.unit.lower()
    if u in ("lb", "lbs", "pound", "pounds"):
        price_per_oz *= 1.03
    elif u in ("kg", "kilo", "kilos"):
        price_per_oz *= 1.05
    payout = int(math.floor(price_per_oz * oz))
    if payout <= 0:
        raise HTTPException(status_code=400, detail="Sale too small")

    remaining = DAILY_SELL_CAP_USD - int(farm.get("daily_sold_usd") or 0)
    if payout > remaining:
        if remaining <= 0:
            raise HTTPException(status_code=400, detail="Daily cap $100M reached")
        grams *= remaining / payout
        oz = grams_to_oz(grams)
        payout = remaining

    stash[body.strain_id] = round(have - grams, 4)
    if stash[body.strain_id] <= 0:
        stash.pop(body.strain_id, None)
    farm["stash"] = stash
    farm["business_cash"] = int(farm.get("business_cash") or 0) + payout
    farm["daily_sold_usd"] = int(farm.get("daily_sold_usd") or 0) + payout
    farm["lifetime_sold_usd"] = int(farm.get("lifetime_sold_usd") or 0) + payout
    missions = dict(farm.get("missions") or {})
    missions["sell_count"] = int(missions.get("sell_count") or 0) + 1
    farm["missions"] = missions
    _add_heat(farm, min(12.0, 1.0 + oz * 0.15))

    # Dealer passive unlock nudge
    if missions["sell_count"] >= 5 and int(farm.get("dealers_level") or 0) == 0:
        farm["dealers_level"] = 1

    xp_amt = max(5, int(8 * oz * rarity_xp_mult(str(strain.get("rarity") or "common"))))
    xp_fields, leveled, new_lvl = apply_grower_xp(farm, xp_amt)
    farm.update(xp_fields)

    await _save_farm(
        farm,
        {
            "stash": stash,
            "business_cash": farm["business_cash"],
            "daily_sold_usd": farm["daily_sold_usd"],
            "daily_sold_utc_date": farm["daily_sold_utc_date"],
            "lifetime_sold_usd": farm["lifetime_sold_usd"],
            "heat": farm["heat"],
            "missions": missions,
            "dealers_level": farm.get("dealers_level"),
            **xp_fields,
        },
    )
    return {
        "ok": True,
        "payout": payout,
        "effective_price_per_oz": round(price_per_oz, 2),
        "grams_sold": round(grams, 2),
        "xp_gained": xp_amt,
        "leveled_up": leveled,
        "grower_level": new_lvl,
        "farm": _public_farm(farm, username=current_user.get("username") or ""),
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
    unit_cost = max(200, equipment_level_cost(cat, lvl) // 8)
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
    cost = equipment_level_cost(cat, nxt)
    _spend(farm, cost)
    equip = dict(farm.get("equipment") or {})
    equip[body.category_id] = nxt
    farm["equipment"] = equip
    stock = dict(farm.get("soil_stock") or {})
    stock_key = cat.get("consumable_stock_key")
    if stock_key and nxt == 1:
        stock[stock_key] = int(stock.get(stock_key) or 0) + int(cat.get("bag_units") or 4)
        farm["soil_stock"] = stock
    await _save_farm(
        farm,
        {"business_cash": farm["business_cash"], "equipment": equip, "soil_stock": farm.get("soil_stock")},
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
    cost = int(house.get("cost") or 0)
    _spend(farm, cost)
    farm["house_tier"] = target
    farm = _sync_plot_count(farm)
    # Auto-unlock strains for new tier
    unlocks = set(farm.get("unlocks") or [])
    for s in STRAINS:
        if int(s.get("unlock_house_tier") or 0) <= target:
            unlocks.add(s["id"])
    farm["unlocks"] = list(unlocks)
    await _save_farm(
        farm,
        {"business_cash": farm["business_cash"], "house_tier": target, "plots": farm["plots"], "unlocks": farm["unlocks"]},
    )
    return {"ok": True, "farm": _public_farm(farm, username=current_user.get("username") or "")}


@router.post("/unlock-strain")
async def weed_unlock_strain(body: UnlockStrainBody, current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    strain = STRAIN_BY_ID.get(body.strain_id)
    if not strain:
        raise HTTPException(status_code=404, detail="Unknown strain")
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
    cost = 5_000 + int(float(farm.get("heat") or 0) * 200)
    _spend(farm, cost)
    farm["heat"] = max(0.0, float(farm.get("heat") or 0) - 25.0)
    await _save_farm(farm, {"business_cash": farm["business_cash"], "heat": farm["heat"]})
    return {"ok": True, "farm": _public_farm(farm, username=current_user.get("username") or "")}


@router.get("/raid/targets")
async def weed_raid_targets(current_user: dict = Depends(_gate)):
    me = current_user["id"]
    today = _utc_date_str()
    my_farm = await _get_or_create_farm(me)
    if int(my_farm.get("grower_level") or 1) < MIN_RAID_GROWER_LEVEL:
        return {
            "targets": [],
            "sabotage_unlocked": bool(my_farm.get("sabotage_unlocked")),
            "raid_unlocked": False,
            "required_grower_level": MIN_RAID_GROWER_LEVEL,
        }
    already = dict(my_farm.get("raid_last_by_target") or {})
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
        },
    )
    targets = []
    async for f in cursor:
        uid = f.get("user_id")
        if not uid:
            continue
        if already.get(uid) == today:
            continue
        u = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1})
        if not u:
            continue
        stash_g = sum(float(v or 0) for v in (f.get("stash") or {}).values())
        targets.append(
            {
                "user_id": uid,
                "username": u.get("username") or "Unknown",
                "house_tier": int(f.get("house_tier") or 0),
                "grower_level": int(f.get("grower_level") or 1),
                "heat": float(f.get("heat") or 0),
                "stash_grams": round(stash_g, 1),
                "equip_count": len(f.get("equipment") or {}),
            }
        )
        if len(targets) >= 40:
            break
    return {
        "targets": targets,
        "sabotage_unlocked": bool(my_farm.get("sabotage_unlocked")),
        "raid_unlocked": True,
        "required_grower_level": MIN_RAID_GROWER_LEVEL,
    }


@router.post("/raid")
async def weed_raid(body: RaidBody, http_request: Request, current_user: dict = Depends(_gate)):
    await _require_weed_action_code(http_request, current_user)
    attacker_id = current_user["id"]
    defender_id = (body.target_user_id or "").strip()
    if not defender_id or defender_id == attacker_id:
        raise HTTPException(status_code=400, detail="Invalid target")

    today = _utc_date_str()
    atk = await _get_or_create_farm(attacker_id)
    if int(atk.get("grower_level") or 1) < MIN_RAID_GROWER_LEVEL:
        raise HTTPException(status_code=400, detail="Reach Grower Level 2 before raiding other growers")
    already = dict(atk.get("raid_last_by_target") or {})
    if already.get(defender_id) == today:
        raise HTTPException(status_code=400, detail="Already raided this grower today")

    dfn = await db.weed_farms.find_one({"user_id": defender_id}, {"_id": 0})
    if not dfn:
        raise HTTPException(status_code=404, detail="Target has no weed business")
    if int(dfn.get("grower_level") or 1) < MIN_RAID_TARGET_GROWER_LEVEL:
        raise HTTPException(status_code=400, detail="Growers below level 2 are protected from raids")

    atk_stats = _stats(atk)
    dfn_stats = _stats(dfn)
    atk_power = 20 + float(atk_stats.get("raid_defence") or 0) * 0.3 + int(atk.get("house_tier") or 0) * 5
    dfn_power = 25 + float(dfn_stats.get("raid_defence") or 0) + float(dfn_stats.get("stash_security") or 0) * 0.5 + int(dfn.get("house_tier") or 0) * 8
    # Roll
    chance = atk_power / max(1.0, atk_power + dfn_power)
    success = _rng.random() < min(0.75, max(0.2, chance))

    already[defender_id] = today
    atk["raid_last_by_target"] = already
    stolen = {"stash": {}, "cash": 0, "equipment": None, "scrap_cash": 0}
    sabotage_note = None

    if not success:
        fine = min(int(atk.get("business_cash") or 0), 2_500)
        atk["business_cash"] = int(atk.get("business_cash") or 0) - fine
        _add_heat(atk, 5)
        rs = dict(atk.get("raid_stats") or {})
        rs["raids_lost"] = int(rs.get("raids_lost") or 0) + 1
        atk["raid_stats"] = rs
        await _save_farm(
            atk,
            {
                "raid_last_by_target": already,
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
            "farm": _public_farm(atk, username=current_user.get("username") or ""),
        }

    # Success loot
    dfn_stash = dict(dfn.get("stash") or {})
    for sid, grams in list(dfn_stash.items()):
        take = round(float(grams) * 0.25, 2)
        if take <= 0:
            continue
        dfn_stash[sid] = round(float(grams) - take, 4)
        if dfn_stash[sid] <= 0:
            dfn_stash.pop(sid, None)
        stolen["stash"][sid] = take
        atk_stash = dict(atk.get("stash") or {})
        atk_stash[sid] = float(atk_stash.get(sid) or 0) + take
        atk["stash"] = atk_stash

    cash_take = min(int(dfn.get("business_cash") or 0), max(0, int((dfn.get("business_cash") or 0) * 0.08)), 250_000)
    if cash_take > 0:
        dfn["business_cash"] = int(dfn.get("business_cash") or 0) - cash_take
        atk["business_cash"] = int(atk.get("business_cash") or 0) + cash_take
        stolen["cash"] = cash_take

    # Steal one equipment piece (not house)
    dfn_equip = dict(dfn.get("equipment") or {})
    stealable = [(k, int(v)) for k, v in dfn_equip.items() if int(v or 0) > 0 and k != "lights_cfl"]
    if not stealable:
        stealable = [(k, int(v)) for k, v in dfn_equip.items() if int(v or 0) > 0]
    if stealable:
        stealable.sort(key=lambda kv: kv[1] * equipment_level_cost(EQUIPMENT_BY_ID.get(kv[0]) or {"base_cost": 1000, "cost_growth": 1.2}, max(1, kv[1])), reverse=True)
        cat_id, lvl = stealable[0]
        # Remove from defender (must rebuy)
        dfn_equip.pop(cat_id, None)
        dfn["equipment"] = dfn_equip
        stolen["equipment"] = {"category_id": cat_id, "level": lvl, "name": (EQUIPMENT_BY_ID.get(cat_id) or {}).get("name") or cat_id}
        atk_equip = dict(atk.get("equipment") or {})
        cur = int(atk_equip.get(cat_id) or 0)
        house_max = int(_house(atk).get("max_equip_tier") or 20)
        cat = EQUIPMENT_BY_ID.get(cat_id)
        if cat and cur < lvl and int(atk.get("house_tier") or 0) >= int(cat.get("min_house_tier") or 0) and lvl <= house_max:
            atk_equip[cat_id] = max(cur, lvl)
            atk["equipment"] = atk_equip
        else:
            scrap = equipment_level_cost(cat or {"base_cost": 1000, "cost_growth": 1.25}, max(1, lvl)) // 3
            atk["business_cash"] = int(atk.get("business_cash") or 0) + scrap
            stolen["scrap_cash"] = scrap

    if body.sabotage and atk.get("sabotage_unlocked"):
        # Spike defender heat only (plants stay)
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
    _add_heat(atk, 8)

    await _save_farm(
        atk,
        {
            "raid_last_by_target": already,
            "stash": atk.get("stash"),
            "business_cash": atk["business_cash"],
            "equipment": atk.get("equipment"),
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
                "heat": dfn.get("heat"),
                "raid_stats": drs,
                "updated_at": _iso(),
            }
        },
    )

    equip_name = (stolen.get("equipment") or {}).get("name") or "gear"
    try:
        await send_notification(
            defender_id,
            "Weed Empire raid",
            (
                f"{current_user.get('username') or 'A rival'} raided your grow: "
                f"stole stock, ${stolen['cash']:,}, and {equip_name}. Re-buy stolen equipment in the shop."
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
        "farm": _public_farm(atk, username=current_user.get("username") or ""),
    }


@router.post("/dealers/sell")
async def weed_dealer_sell(
    http_request: Request,
    body: Optional[DealerSellBody] = None,
    current_user: dict = Depends(_gate),
):
    """Passive drip sell via dealers (counts toward daily cap)."""
    await _require_weed_action_code(http_request, current_user)
    farm = await _get_or_create_farm(current_user["id"])
    lvl = int(farm.get("dealers_level") or 0)
    if lvl < 1:
        raise HTTPException(status_code=400, detail="Unlock dealers by selling 5 times")
    farm = _ensure_daily_cap(farm)
    stash = dict(farm.get("stash") or {})
    if not stash:
        raise HTTPException(status_code=400, detail="No stash for dealers")
    # Sell up to 10% of each strain
    total_payout = 0
    for sid, grams in list(stash.items()):
        take = round(float(grams) * (0.08 + 0.02 * lvl), 2)
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
        )
        pay = int(math.floor(price * oz))
        remaining = DAILY_SELL_CAP_USD - int(farm.get("daily_sold_usd") or 0) - total_payout
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
        raise HTTPException(status_code=400, detail="Dealers found nothing worth moving today")
    farm["stash"] = stash
    farm["business_cash"] = int(farm.get("business_cash") or 0) + total_payout
    farm["daily_sold_usd"] = int(farm.get("daily_sold_usd") or 0) + total_payout
    farm["lifetime_sold_usd"] = int(farm.get("lifetime_sold_usd") or 0) + total_payout
    await _save_farm(
        farm,
        {
            "stash": stash,
            "business_cash": farm["business_cash"],
            "daily_sold_usd": farm["daily_sold_usd"],
            "daily_sold_utc_date": farm["daily_sold_utc_date"],
            "lifetime_sold_usd": farm["lifetime_sold_usd"],
        },
    )
    return {"ok": True, "payout": total_payout, "farm": _public_farm(farm, username=current_user.get("username") or "")}


@router.post("/upgrade-dealers")
async def weed_upgrade_dealers(current_user: dict = Depends(_gate)):
    farm = await _get_or_create_farm(current_user["id"])
    lvl = int(farm.get("dealers_level") or 0)
    if lvl < 1:
        raise HTTPException(status_code=400, detail="Unlock dealers first")
    if lvl >= 5:
        raise HTTPException(status_code=400, detail="Dealers maxed")
    cost = 25_000 * (lvl + 1)
    _spend(farm, cost)
    farm["dealers_level"] = lvl + 1
    await _save_farm(farm, {"business_cash": farm["business_cash"], "dealers_level": farm["dealers_level"]})
    return {"ok": True, "farm": _public_farm(farm, username=current_user.get("username") or "")}


def register(api_router: APIRouter) -> None:
    api_router.include_router(router)
