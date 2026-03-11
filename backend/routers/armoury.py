# Armoury: one per state (bullet factory + armour + weapons). Single ownership entity (db.bullet_factory).
# Owner can claim (pay), set bullet price; produces up to 5k bullets per day and can produce armour & weapons (pay per hour, stock accumulates).
# Bullets sold from factory stock; armour/weapons from armoury stock. Others buy at owner's price (or unowned price).
from datetime import datetime, timezone, timedelta
import os
import sys
import random
import time
from typing import Optional, List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import Depends, HTTPException, Request, Body
from pydantic import BaseModel
from bson.objectid import ObjectId

from server import db, get_current_user, get_effective_event, STATES, get_rank_info, CAPO_RANK_ID, maybe_auto_relinquish_below_capo, _is_admin, _username_pattern, ARMOUR_SETS, ARMOUR_WEAPON_MARGIN, get_effective_event, STATES, get_rank_info, CAPO_RANK_ID, maybe_auto_relinquish_below_capo, _is_admin, _username_pattern, ARMOUR_SETS, ARMOUR_WEAPON_MARGIN, _family_in_active_war, CARS
from routers.store import _store_cost_inc

# 5k bullets per 24h, effectively delivered every 20 mins (72 ticks per day)
BULLET_FACTORY_TOTAL_PER_24H = 5000
BULLET_FACTORY_TICK_MINUTES = 20
BULLET_FACTORY_PRODUCTION_PER_HOUR = BULLET_FACTORY_TOTAL_PER_24H / 24  # ~208.33
BULLET_FACTORY_MAX_HOURS_CAP = 24  # cap accumulated at 24h of production (5000 total)
BULLET_FACTORY_BUY_MAX_PER_PURCHASE = 5000  # max bullets per single purchase
BULLET_FACTORY_BUY_COOLDOWN_MINUTES = 15  # must wait this long between purchases
BULLET_FACTORY_CLAIM_COST = 5_000_000  # $5M to claim (like claiming a casino)
BULLET_FACTORY_PRICE_MIN = 1
BULLET_FACTORY_PRICE_MAX = 100_000  # max $ per bullet (when owned)
BULLET_FACTORY_UNOWNED_PRICE_MIN = 2500
BULLET_FACTORY_UNOWNED_PRICE_MAX = 4000

# Armoury production: 5 per hour per armour/weapon; max 15 in stock per item (per level per weapon)
ARMOURY_ARMOUR_RATE_PER_HOUR = 5
ARMOURY_WEAPON_RATE_PER_HOUR = 5
ARMOURY_MAX_STOCK_PER_ITEM = 15

# Store: buy bullets with points (pack size -> points cost)
BULLET_PACKS = {5000: 100, 10000: 175, 50000: 775, 100000: 1525}  # matches store

# Consumable tokens: 1 token = 1 hour effect. Types: xp_double (double XP from crimes/GTA/jailbusts), jailbust_bonus (+10% bust success).
TOKEN_TYPES = ("xp_double", "jailbust_bonus")
TOKEN_DURATION_HOURS = 1

# Shooting range: weapon mastery 0-100%; at 100% = up to MASTERY_MAX_BULLET_REDUCTION_PCT fewer bullets in attack.
MASTERY_MAX_BULLET_REDUCTION_PCT = 10
MASTERY_AUTO_SIM_PCT_PER_CHUNK = 5  # +5% per "Train 5 min" chunk
MASTERY_COOLDOWN_MINUTES = 5  # min time between auto_sim trains per weapon
BRASS_KNUCKLES_WEAPON_ID = "weapon1"  # exclude from shooting range (no bullets)
# Playing the 3D range: grant more mastery per hit than auto_sim (quicker mastery when you play)
MASTERY_PCT_PER_LIVE_HIT = 1  # 1% per hit when playing the 3D game (max 30 hits per submit)
MASTERY_LIVE_HITS_MAX_PER_REQUEST = 30


class StateOptionalRequest(BaseModel):
    state: Optional[str] = None


class SetPriceRequest(BaseModel):
    price_per_bullet: int
    state: Optional[str] = None


class SellOnTradeRequest(BaseModel):
    points: int
    state: Optional[str] = None


class BuyBulletsRequest(BaseModel):
    amount: int
    state: Optional[str] = None


class StartArmourProductionRequest(BaseModel):
    level: int  # 1-5
    state: Optional[str] = None


class StartWeaponProductionRequest(BaseModel):
    weapon_id: str
    state: Optional[str] = None


class StateOptionalBody(BaseModel):
    state: Optional[str] = None


class UseTokenRequest(BaseModel):
    token_type: str  # "xp_double" | "jailbust_bonus"


class ShootingRangeTrainRequest(BaseModel):
    weapon_id: str
    mode: str = "auto_sim"  # "auto_sim" | "live" (3D game)
    hits: Optional[int] = None  # for mode=live: number of hits in session (1..MASTERY_LIVE_HITS_MAX_PER_REQUEST)


def _normalize_state(state: str) -> str:
    if not state or not (state or "").strip():
        return STATES[0] if STATES else ""
    s = (state or "").strip()
    for st in (STATES or []):
        if st and s.lower() == st.lower():
            return st
    return STATES[0] if STATES else ""


async def get_armoury_for_state(state: str):
    """Get factory for state after ticking armoury production. Used by armour/weapon buy to fulfill from armoury."""
    state = _normalize_state(state)
    if not state:
        return None
    factory = await _get_or_create_factory(state)
    factory = await _tick_armoury_production(state, factory)
    return factory


async def _get_or_create_factory(state: str):
    state = _normalize_state(state)
    if state:
        await maybe_auto_relinquish_below_capo(db.bullet_factory, {"state": state})
    doc = await db.bullet_factory.find_one({"state": state}, {"_id": 0})
    if doc:
        return doc
    # When unowned, production runs from now; price varies $2,500–$4,000
    unowned_price = random.randint(BULLET_FACTORY_UNOWNED_PRICE_MIN, BULLET_FACTORY_UNOWNED_PRICE_MAX)
    now = datetime.now(timezone.utc).isoformat()
    await db.bullet_factory.insert_one({
        "state": state,
        "owner_id": None,
        "owner_username": None,
        "last_collected_at": now,
        "price_per_bullet": None,
        "unowned_price": unowned_price,
    })
    return await db.bullet_factory.find_one({"state": state}, {"_id": 0})


def _parse_utc(s: Optional[str]):
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


async def _tick_armoury_production(state: str, factory: dict) -> dict:
    """Advance armour/weapon stock by elapsed time; update DB. Returns updated factory.
    Supports multi-production: armour_production_hours {level: hours}, weapon_production_hours {weapon_id: hours}.
    Migrates old single-production fields into the new structure on first tick.
    """
    now = datetime.now(timezone.utc)
    updates = {}
    # Migrate old single armour production into armour_production_hours
    if factory.get("armour_producing") and factory.get("armour_production_started_at"):
        level = int(factory.get("armour_production_level") or 1)
        hrs = float(factory.get("armour_production_hours_remaining") or 0)
        if hrs > 0:
            existing = dict(factory.get("armour_production_hours") or {})
            existing[str(level)] = existing.get(str(level), 0) + hrs
            updates["armour_production_hours"] = existing
            updates["armour_production_last_tick"] = factory["armour_production_started_at"]
        updates["armour_producing"] = False
        updates["armour_production_level"] = None
        updates["armour_production_started_at"] = None
        updates["armour_production_hours_remaining"] = None
    # Migrate old single weapon production into weapon_production_hours
    if factory.get("weapon_producing") and factory.get("weapon_production_started_at"):
        wid = factory.get("weapon_production_id") or ""
        if wid:
            hrs = float(factory.get("weapon_production_hours_remaining") or 0)
            if hrs > 0:
                existing = dict(factory.get("weapon_production_hours") or {})
                existing[wid] = existing.get(wid, 0) + hrs
                updates["weapon_production_hours"] = existing
                updates["weapon_production_last_tick"] = factory["weapon_production_started_at"]
        updates["weapon_producing"] = False
        updates["weapon_production_id"] = None
        updates["weapon_production_started_at"] = None
        updates["weapon_production_hours_remaining"] = None
    if updates:
        await db.bullet_factory.update_one({"state": state}, {"$set": updates})
        factory = {**factory, **updates}

    # Tick all armour levels that have hours remaining
    armour_hours = dict(factory.get("armour_production_hours") or {})
    last_armour = _parse_utc(factory.get("armour_production_last_tick")) or now
    elapsed_armour = (now - last_armour).total_seconds() / 3600
    if elapsed_armour > 0 and armour_hours:
        armour_stock = dict(factory.get("armour_stock") or {})
        any_armour_change = False
        for level_key, hours_remaining in list(armour_hours.items()):
            if hours_remaining <= 0:
                continue
            use_hours = min(elapsed_armour, hours_remaining)
            current = armour_stock.get(level_key, 0)
            room = ARMOURY_MAX_STOCK_PER_ITEM - current
            raw_units = int(use_hours * ARMOURY_ARMOUR_RATE_PER_HOUR)
            add_units = min(raw_units, room) if room > 0 else 0
            if add_units > 0:
                armour_stock[level_key] = current + add_units
                any_armour_change = True
            hours_used = add_units / ARMOURY_ARMOUR_RATE_PER_HOUR
            armour_hours[level_key] = max(0, hours_remaining - hours_used)
        armour_hours = {k: v for k, v in armour_hours.items() if v > 0}
        updates["armour_production_hours"] = armour_hours
        updates["armour_production_last_tick"] = now.isoformat()
        if any_armour_change:
            updates["armour_stock"] = armour_stock
        factory = {**factory, **updates}

    # Tick all weapons that have hours remaining
    weapon_hours = dict(factory.get("weapon_production_hours") or {})
    last_weapon = _parse_utc(factory.get("weapon_production_last_tick")) or now
    elapsed_weapon = (now - last_weapon).total_seconds() / 3600
    if elapsed_weapon > 0 and weapon_hours:
        weapon_stock = dict(factory.get("weapon_stock") or {})
        any_weapon_change = False
        for wid, hours_remaining in list(weapon_hours.items()):
            if hours_remaining <= 0:
                continue
            use_hours = min(elapsed_weapon, hours_remaining)
            current = weapon_stock.get(wid, 0)
            room = ARMOURY_MAX_STOCK_PER_ITEM - current
            raw_units = int(use_hours * ARMOURY_WEAPON_RATE_PER_HOUR)
            add_units = min(raw_units, room) if room > 0 else 0
            if add_units > 0:
                weapon_stock[wid] = current + add_units
                any_weapon_change = True
            hours_used = add_units / ARMOURY_WEAPON_RATE_PER_HOUR
            weapon_hours[wid] = max(0, hours_remaining - hours_used)
        weapon_hours = {k: v for k, v in weapon_hours.items() if v > 0}
        updates["weapon_production_hours"] = weapon_hours
        updates["weapon_production_last_tick"] = now.isoformat()
        if any_weapon_change:
            updates["weapon_stock"] = weapon_stock
        factory = {**factory, **updates}

    if updates:
        await db.bullet_factory.update_one({"state": state}, {"$set": updates})
    return factory


def _accumulated_bullets(factory: dict) -> int:
    last = factory.get("last_collected_at")
    if not last:
        return 0
    try:
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
    except Exception:
        return 0
    now = datetime.now(timezone.utc)
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=timezone.utc)
    hours = (now - last_dt).total_seconds() / 3600
    raw = int(hours * BULLET_FACTORY_PRODUCTION_PER_HOUR)
    return min(raw, BULLET_FACTORY_TOTAL_PER_24H)


async def get_bullet_factory(
    state: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Status for one state (default: user's current state). Bullets + armoury production/stock."""
    state = _normalize_state(state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    owner_id = factory.get("owner_id")
    if owner_id:
        factory = await _tick_armoury_production(state, factory)
    owner_username = factory.get("owner_username")
    if owner_id and not owner_username:
        user = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1})
        owner_username = user.get("username") if user else "?"
    accumulated = _accumulated_bullets(factory)
    is_owner = str(current_user.get("id") or "") == str(owner_id or "")
    price = factory.get("price_per_bullet")
    unowned_price = factory.get("unowned_price")
    if unowned_price is None:
        unowned_price = random.randint(BULLET_FACTORY_UNOWNED_PRICE_MIN, BULLET_FACTORY_UNOWNED_PRICE_MAX)
    if owner_id:
        can_buy = price is not None and price >= BULLET_FACTORY_PRICE_MIN and not is_owner and accumulated > 0
        effective_price = price
    else:
        can_buy = accumulated > 0
        effective_price = unowned_price
    # Cooldown: when can this user buy again?
    next_buy_available_at = None
    buyer_doc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "last_bullet_factory_bought_at": 1})
    last_bought = (buyer_doc or {}).get("last_bullet_factory_bought_at")
    if last_bought:
        try:
            last_dt = datetime.fromisoformat(last_bought.replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            next_ok = last_dt + timedelta(minutes=BULLET_FACTORY_BUY_COOLDOWN_MINUTES)
            if datetime.now(timezone.utc) < next_ok:
                next_buy_available_at = next_ok.isoformat()
        except Exception:
            pass
    out = {
        "state": state,
        "production_per_hour": BULLET_FACTORY_PRODUCTION_PER_HOUR,
        "production_per_24h": BULLET_FACTORY_TOTAL_PER_24H,
        "production_tick_minutes": BULLET_FACTORY_TICK_MINUTES,
        "claim_cost": BULLET_FACTORY_CLAIM_COST,
        "owner_id": owner_id,
        "owner_username": owner_username,
        "accumulated_bullets": accumulated,
        "can_buy": can_buy,
        "price_per_bullet": effective_price,
        "price_min": BULLET_FACTORY_PRICE_MIN,
        "price_max": BULLET_FACTORY_PRICE_MAX,
        "unowned_price_min": BULLET_FACTORY_UNOWNED_PRICE_MIN,
        "unowned_price_max": BULLET_FACTORY_UNOWNED_PRICE_MAX,
        "is_unowned": owner_id is None,
        "last_collected_at": factory.get("last_collected_at"),
        "is_owner": is_owner,
        "buy_max_per_purchase": BULLET_FACTORY_BUY_MAX_PER_PURCHASE,
        "buy_cooldown_minutes": BULLET_FACTORY_BUY_COOLDOWN_MINUTES,
        "next_buy_available_at": next_buy_available_at,
    }
    # Armoury (owner only): multi-production hours + produce-all costs
    if owner_id:
        out["owner_pending_profit"] = int(factory.get("owner_pending_profit") or 0)
        out["owner_pending_profit_points"] = int(factory.get("owner_pending_profit_points") or 0)
        armour_hrs = factory.get("armour_production_hours") or {}
        weapon_hrs = factory.get("weapon_production_hours") or {}
        out["armour_production_hours"] = armour_hrs
        out["weapon_production_hours"] = weapon_hrs
        out["armour_producing"] = bool(factory.get("armour_producing")) or any((armour_hrs.get(k) or 0) > 0 for k in ("1", "2", "3", "4", "5"))
        out["armour_production_level"] = factory.get("armour_production_level")
        out["armour_production_hours_remaining"] = sum(float(v) for v in (armour_hrs or {}).values())
        out["armour_stock"] = factory.get("armour_stock") or {}
        out["armour_rate_per_hour"] = ARMOURY_ARMOUR_RATE_PER_HOUR
        out["armour_max_stock"] = ARMOURY_MAX_STOCK_PER_ITEM
        out["weapon_producing"] = bool(factory.get("weapon_producing")) or any((weapon_hrs or {}).values())
        out["weapon_production_id"] = factory.get("weapon_production_id")
        out["weapon_production_hours_remaining"] = sum(float(v) for v in (weapon_hrs or {}).values())
        out["weapon_stock"] = factory.get("weapon_stock") or {}
        out["weapon_rate_per_hour"] = ARMOURY_WEAPON_RATE_PER_HOUR
        out["weapon_max_stock"] = ARMOURY_MAX_STOCK_PER_ITEM
        # Produce-all costs (1 hr each for every armour level / every weapon)
        out["produce_all_armour_cost_money"] = sum((a.get("cost_money") or 0) for a in ARMOUR_SETS) * ARMOURY_ARMOUR_RATE_PER_HOUR
        out["produce_all_armour_cost_points"] = sum((a.get("cost_points") or 0) for a in ARMOUR_SETS) * ARMOURY_ARMOUR_RATE_PER_HOUR
        weapons_for_cost = await db.weapons.find({}, {"_id": 0, "price_money": 1, "price_points": 1}).to_list(200)
        out["produce_all_weapons_cost_money"] = sum((w.get("price_money") or 0) for w in weapons_for_cost) * ARMOURY_WEAPON_RATE_PER_HOUR
        out["produce_all_weapons_cost_points"] = sum((w.get("price_points") or 0) for w in weapons_for_cost) * ARMOURY_WEAPON_RATE_PER_HOUR
    return out


async def get_bullet_factory_list(current_user: dict = Depends(get_current_user)):
    """List all states' bullet factories (for overview tables)."""
    result = []
    for state in STATES:
        factory = await _get_or_create_factory(state)
        owner_id = factory.get("owner_id")
        if owner_id:
            u = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1})
            owner_username = factory.get("owner_username") or (u.get("username") if u else "?")
        else:
            owner_username = None
        accumulated = _accumulated_bullets(factory)
        price = factory.get("price_per_bullet") if owner_id else factory.get("unowned_price")
        result.append({
            "state": state,
            "owner_id": owner_id,
            "owner_username": owner_username or "Unclaimed",
            "accumulated_bullets": accumulated,
            "price_per_bullet": price,
        })
    return {"factories": result}


async def _user_owns_any_property(user_id: str):
    """Check if user owns any property (airport or armoury). Max 1 per player. Armoury = bullet factory + armour + weapons (single ownership)."""
    doc = await db.airport_ownership.find_one({"owner_id": user_id}, {"_id": 0, "state": 1})
    if doc:
        return {"type": "airport", "state": doc.get("state")}
    doc = await db.bullet_factory.find_one({"owner_id": user_id}, {"_id": 0, "state": 1})
    if doc:
        return {"type": "bullet_factory", "state": doc.get("state")}
    return None


async def claim_bullet_factory(
    body: StateOptionalRequest = Body(default=StateOptionalRequest()),
    current_user: dict = Depends(get_current_user),
):
    """Pay to become the armoury owner in this state (bullets + armour + weapons). Max 1 property per player. Requires Capo or higher."""
    rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
    if rank_id < CAPO_RANK_ID:
        raise HTTPException(status_code=403, detail="You must be rank Capo or higher to claim the armoury. Reach Capo to hold one.")
    owned_prop = await _user_owns_any_property(current_user["id"])
    if owned_prop:
        raise HTTPException(status_code=400, detail="You may only own 1 property (airport or armoury). Relinquish it first (My Properties or States).")
    state = _normalize_state(body.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id"):
        raise HTTPException(status_code=400, detail="The armoury in this state already has an owner")
    user_money = int(current_user.get("money") or 0)
    if user_money < BULLET_FACTORY_CLAIM_COST:
        raise HTTPException(
            status_code=400,
            detail=f"You need ${BULLET_FACTORY_CLAIM_COST:,} to claim the armoury",
        )
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": -BULLET_FACTORY_CLAIM_COST}},
    )
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {"owner_id": current_user["id"], "owner_username": current_user.get("username"), "last_collected_at": now}},
    )
    return {
        "message": f"You now own the armoury in {state} (bullets, armour & weapons). It produces up to 5,000 bullets per day.",
        "state": state,
        "owner_id": current_user["id"],
    }


async def collect_bullet_factory(
    body: StateOptionalRequest = Body(default=StateOptionalRequest()),
    current_user: dict = Depends(get_current_user),
):
    """Collect accumulated profit from bullet/armour/weapon sales into your cash and points."""
    state = _normalize_state(body.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    pending_money = int(factory.get("owner_pending_profit") or 0)
    pending_points = int(factory.get("owner_pending_profit_points") or 0)
    if pending_money <= 0 and pending_points <= 0:
        return {
            "message": "No profit to collect. Sales are added here when players buy bullets, armour, or weapons from your armoury.",
            "state": state,
            "collected_money": 0,
            "collected_points": 0,
        }
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {"owner_pending_profit": 0, "owner_pending_profit_points": 0}},
    )
    if pending_money > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": pending_money}})
    if pending_points > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": pending_points}})
    return {
        "message": f"Collected ${pending_money:,} and {pending_points:,} points from armoury sales.",
        "state": state,
        "collected_money": pending_money,
        "collected_points": pending_points,
    }


async def start_armour_production(
    request: StartArmourProductionRequest,
    current_user: dict = Depends(get_current_user),
):
    """Owner pays for 1 hour of armour production; stock accumulates at ARMOURY_ARMOUR_RATE_PER_HOUR."""
    state = _normalize_state(request.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    level = int(request.level or 0)
    if level < 1 or level > 5:
        raise HTTPException(status_code=400, detail="Armour level must be 1–5")
    armour = next((a for a in ARMOUR_SETS if a["level"] == level), None)
    if not armour:
        raise HTTPException(status_code=404, detail="Armour level not found")
    # Cost for 1 hour = production cost per unit × rate per hour
    cost_money = armour.get("cost_money")
    cost_points = armour.get("cost_points")
    if cost_money is not None:
        pay = cost_money * ARMOURY_ARMOUR_RATE_PER_HOUR
        if (current_user.get("money") or 0) < pay:
            raise HTTPException(status_code=400, detail=f"Insufficient cash. Need ${pay:,} for 1 hour of production.")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -pay}})
    elif cost_points is not None:
        pay = cost_points * ARMOURY_ARMOUR_RATE_PER_HOUR
        if (current_user.get("points") or 0) < pay:
            raise HTTPException(status_code=400, detail=f"Insufficient points. Need {pay} for 1 hour of production.")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": -pay}})
    else:
        raise HTTPException(status_code=400, detail="Armour level has no production cost")
    armour_hours = dict(factory.get("armour_production_hours") or {})
    key = str(level)
    current_hrs = float(armour_hours.get(key) or 0)
    if current_hrs > 0.01:
        raise HTTPException(status_code=400, detail="Cannot stack production. Wait for this level to finish, then produce again (1 hour at a time).")
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    armour_hours[key] = (armour_hours.get(key) or 0) + 1.0
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {
            "armour_production_hours": armour_hours,
            "armour_production_last_tick": now_iso,
        }},
    )
    return {
        "message": f"Started armour (level {level}) production. {ARMOURY_ARMOUR_RATE_PER_HOUR}/hour for 1 hour.",
        "state": state,
        "armour_production_level": level,
        "armour_production_hours_remaining": armour_hours.get(key, 0),
    }


async def start_weapon_production(
    request: StartWeaponProductionRequest,
    current_user: dict = Depends(get_current_user),
):
    """Owner pays for 1 hour of weapon production; stock accumulates at ARMOURY_WEAPON_RATE_PER_HOUR."""
    state = _normalize_state(request.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    weapon_id = (request.weapon_id or "").strip()
    if not weapon_id:
        raise HTTPException(status_code=400, detail="weapon_id required")
    weapon = await db.weapons.find_one({"id": weapon_id}, {"_id": 0, "price_money": 1, "price_points": 1, "name": 1, "loot_exclusive": 1})
    if not weapon:
        raise HTTPException(status_code=404, detail="Weapon not found")
    if weapon.get("loot_exclusive"):
        raise HTTPException(status_code=400, detail="Loot-exclusive weapons cannot be produced at the armoury")
    pm = weapon.get("price_money")
    pp = weapon.get("price_points")
    if pm is not None:
        pay = pm * ARMOURY_WEAPON_RATE_PER_HOUR
        if (current_user.get("money") or 0) < pay:
            raise HTTPException(status_code=400, detail=f"Insufficient cash. Need ${pay:,} for 1 hour of production.")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -pay}})
    elif pp is not None:
        pay = pp * ARMOURY_WEAPON_RATE_PER_HOUR
        if (current_user.get("points") or 0) < pay:
            raise HTTPException(status_code=400, detail=f"Insufficient points. Need {pay} for 1 hour of production.")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": -pay}})
    else:
        raise HTTPException(status_code=400, detail="Weapon has no production cost")
    weapon_hours = dict(factory.get("weapon_production_hours") or {})
    current_hrs = float(weapon_hours.get(weapon_id) or 0)
    if current_hrs > 0.01:
        raise HTTPException(status_code=400, detail="Cannot stack production. Wait for this weapon to finish, then produce again (1 hour at a time).")
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    weapon_hours[weapon_id] = (weapon_hours.get(weapon_id) or 0) + 1.0
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {
            "weapon_production_hours": weapon_hours,
            "weapon_production_last_tick": now_iso,
        }},
    )
    return {
        "message": f"Started {weapon.get('name', weapon_id)} production. {ARMOURY_WEAPON_RATE_PER_HOUR}/hour for 1 hour.",
        "state": state,
        "weapon_production_id": weapon_id,
        "weapon_production_hours_remaining": weapon_hours.get(weapon_id, 0),
    }


async def start_armour_production_all(
    request: Optional[StateOptionalBody] = Body(None),
    current_user: dict = Depends(get_current_user),
):
    """Owner pays for 1 hour of armour production for all levels that have no production queued (no stacking — only add when finished)."""
    state = _normalize_state((request.state if request else None) or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    armour_hours = dict(factory.get("armour_production_hours") or {})
    levels_to_add = [a for a in ARMOUR_SETS if float(armour_hours.get(str(a["level"])) or 0) <= 0.01]
    if not levels_to_add:
        raise HTTPException(status_code=400, detail="Cannot stack. All armour levels are still producing. Wait for them to finish, then use Produce all again (1 hr each).")
    total_money = sum((a.get("cost_money") or 0) for a in levels_to_add) * ARMOURY_ARMOUR_RATE_PER_HOUR
    total_points = sum((a.get("cost_points") or 0) for a in levels_to_add) * ARMOURY_ARMOUR_RATE_PER_HOUR
    if total_money > 0 and (current_user.get("money") or 0) < total_money:
        raise HTTPException(status_code=400, detail=f"Insufficient cash. Need ${total_money:,} for 1 hr on {len(levels_to_add)} level(s).")
    if total_points > 0 and (current_user.get("points") or 0) < total_points:
        raise HTTPException(status_code=400, detail=f"Insufficient points. Need {total_points} pts for 1 hr on {len(levels_to_add)} level(s).")
    if total_money > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -total_money}})
    if total_points > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": -total_points}})
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    for a in levels_to_add:
        key = str(a["level"])
        armour_hours[key] = (armour_hours.get(key) or 0) + 1.0
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {"armour_production_hours": armour_hours, "armour_production_last_tick": now_iso}},
    )
    return {
        "message": f"Started armour production (1 hr each for {len(levels_to_add)} level(s)). {ARMOURY_ARMOUR_RATE_PER_HOUR}/hr per level.",
        "state": state,
        "produce_all_armour_cost_money": total_money,
        "produce_all_armour_cost_points": total_points,
    }


async def start_weapon_production_all(
    request: Optional[StateOptionalBody] = Body(None),
    current_user: dict = Depends(get_current_user),
):
    """Owner pays for 1 hour of weapon production for all weapons that have no production queued (no stacking — only add when finished)."""
    state = _normalize_state((request.state if request else None) or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    weapons = await db.weapons.find({}, {"_id": 0, "id": 1, "price_money": 1, "price_points": 1, "loot_exclusive": 1}).to_list(200)
    weapon_hours = dict(factory.get("weapon_production_hours") or {})
    weapons_to_add = [w for w in weapons if w.get("id") and not w.get("loot_exclusive") and float(weapon_hours.get(w["id"]) or 0) <= 0.01]
    if not weapons_to_add:
        raise HTTPException(status_code=400, detail="Cannot stack. All weapons are still producing. Wait for them to finish, then use Produce all again (1 hr each).")
    total_money = sum((w.get("price_money") or 0) for w in weapons_to_add) * ARMOURY_WEAPON_RATE_PER_HOUR
    total_points = sum((w.get("price_points") or 0) for w in weapons_to_add) * ARMOURY_WEAPON_RATE_PER_HOUR
    if total_money > 0 and (current_user.get("money") or 0) < total_money:
        raise HTTPException(status_code=400, detail=f"Insufficient cash. Need ${total_money:,} for 1 hr on {len(weapons_to_add)} weapon(s).")
    if total_points > 0 and (current_user.get("points") or 0) < total_points:
        raise HTTPException(status_code=400, detail=f"Insufficient points. Need {total_points} pts for 1 hr on {len(weapons_to_add)} weapon(s).")
    if total_money > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -total_money}})
    if total_points > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": -total_points}})
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    for w in weapons_to_add:
        wid = w["id"]
        weapon_hours[wid] = (weapon_hours.get(wid) or 0) + 1.0
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {"weapon_production_hours": weapon_hours, "weapon_production_last_tick": now_iso}},
    )
    return {
        "message": f"Started weapon production (1 hr each for {len(weapons_to_add)} weapon(s)). {ARMOURY_WEAPON_RATE_PER_HOUR}/hr per weapon.",
        "state": state,
        "produce_all_weapons_cost_money": total_money,
        "produce_all_weapons_cost_points": total_points,
    }


async def set_price(
    request: SetPriceRequest,
    current_user: dict = Depends(get_current_user),
):
    """Owner sets the price per bullet in this state."""
    state = _normalize_state(request.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the bullet factory in this state")
    price = request.price_per_bullet
    if price < BULLET_FACTORY_PRICE_MIN or price > BULLET_FACTORY_PRICE_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"Price must be between ${BULLET_FACTORY_PRICE_MIN} and ${BULLET_FACTORY_PRICE_MAX:,} per bullet",
        )
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {"price_per_bullet": price}},
    )
    return {"message": f"Price set to ${price:,} per bullet", "price_per_bullet": price, "state": state}


async def relinquish_bullet_factory(
    body: StateOptionalRequest = Body(default=StateOptionalRequest()),
    current_user: dict = Depends(get_current_user),
):
    """Relinquish ownership of the armoury in this state. It becomes unclaimed."""
    state = _normalize_state(body.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {"owner_id": None, "owner_username": None}},
    )
    return {"message": f"Armoury in {state} relinquished. It is now unclaimed.", "state": state}


async def bullet_factory_sell_on_trade(
    request: SellOnTradeRequest,
    current_user: dict = Depends(get_current_user),
):
    """List the armoury on Quick Trade for points. Relinquishes ownership when listed (buyer gets it)."""
    if request.points < 0:
        raise HTTPException(status_code=400, detail="Points must be non-negative")
    state = _normalize_state(request.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    # Check no existing listing for this state
    existing = await db.properties.find_one({"type": "bullet_factory", "state": state, "for_sale": True})
    if existing:
        raise HTTPException(status_code=400, detail="This armoury is already listed on Quick Trade. Cancel the listing first.")
    listing = {
        "_id": ObjectId(),
        "type": "bullet_factory",
        "state": state,
        "location": state,
        "name": f"Armoury ({state})",
        "owner_id": current_user["id"],
        "owner_username": current_user.get("username", "Unknown"),
        "for_sale": True,
        "sale_price": request.points,
        "created_at": datetime.now(timezone.utc),
    }
    await db.properties.insert_one(listing)
    try:
        from routers.quicktrade import _invalidate_trade_caches
        _invalidate_trade_caches()
    except Exception:
        pass
    return {"message": f"Armoury ({state}) listed for {request.points:,} points on Quick Trade", "state": state}


async def buy_bullets(
    request: BuyBulletsRequest,
    current_user: dict = Depends(get_current_user),
):
    """Buy bullets from the factory in this state. When unowned, pay system price ($2,500–$4,000). When owned, pay owner's price. Max 3000 per purchase, once every 15 minutes."""
    state = _normalize_state(request.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    owner_id = factory.get("owner_id")
    amount = request.amount
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if amount > BULLET_FACTORY_BUY_MAX_PER_PURCHASE:
        raise HTTPException(
            status_code=400,
            detail=f"You can only buy up to {BULLET_FACTORY_BUY_MAX_PER_PURCHASE:,} bullets at once from the factory",
        )
    # 15-minute cooldown between purchases
    user_doc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "last_bullet_factory_bought_at": 1})
    last_bought = (user_doc or {}).get("last_bullet_factory_bought_at")
    if last_bought:
        try:
            last_dt = datetime.fromisoformat(last_bought.replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds()
            if elapsed < BULLET_FACTORY_BUY_COOLDOWN_MINUTES * 60:
                wait_mins = max(0, int((BULLET_FACTORY_BUY_COOLDOWN_MINUTES * 60 - elapsed) / 60) + 1)
                raise HTTPException(
                    status_code=400,
                    detail=f"You can only buy bullets from the factory once every {BULLET_FACTORY_BUY_COOLDOWN_MINUTES} minutes. Try again in {wait_mins} min.",
                )
        except Exception:
            pass
    accumulated = _accumulated_bullets(factory)
    if amount > accumulated:
        raise HTTPException(
            status_code=400,
            detail=f"Factory only has {accumulated:,} bullets available",
        )
    if owner_id:
        if owner_id == current_user["id"]:
            raise HTTPException(status_code=400, detail="You own this factory; bullets are sold to other players from stock.")
        price = factory.get("price_per_bullet")
        if price is None or price < BULLET_FACTORY_PRICE_MIN:
            raise HTTPException(status_code=400, detail="Owner has not set a price yet")
    else:
        price = factory.get("unowned_price") or random.randint(BULLET_FACTORY_UNOWNED_PRICE_MIN, BULLET_FACTORY_UNOWNED_PRICE_MAX)
    total_cost = amount * price
    buyer_money = int(current_user.get("money") or 0)
    if buyer_money < total_cost:
        raise HTTPException(
            status_code=400,
            detail=f"You need ${total_cost:,} (${price:,} × {amount:,})",
        )
    # Advance last_collected_at so accumulated drops by amount
    try:
        last = datetime.fromisoformat(factory["last_collected_at"].replace("Z", "+00:00"))
    except Exception:
        last = datetime.now(timezone.utc)
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    hours_consumed = amount / BULLET_FACTORY_PRODUCTION_PER_HOUR
    new_last = last + timedelta(seconds=hours_consumed * 3600)
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {"last_collected_at": new_last.isoformat()}},
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": -total_cost, "bullets": amount, "bullets_purchased_from_armoury": amount}, "$set": {"last_bullet_factory_bought_at": now_iso}},
    )
    if owner_id:
        await db.bullet_factory.update_one(
            {"state": state},
            {"$inc": {"owner_pending_profit": total_cost}},
        )
    return {
        "message": f"Bought {amount:,} bullets for ${total_cost:,}",
        "amount": amount,
        "total_paid": total_cost,
        "new_bullets": (current_user.get("bullets") or 0) + amount,
        "state": state,
    }


async def store_buy_bullets(bullets: int, current_user: dict = Depends(get_current_user)):
    """Buy bullets from store: use respect points first (5 respect = 1 point), then points."""
    cost = BULLET_PACKS.get(bullets)
    if cost is None:
        raise HTTPException(status_code=400, detail=f"Invalid bullet pack. Choose from: {', '.join(str(k) for k in BULLET_PACKS)}")
    cost_used, inc = _store_cost_inc(current_user, cost)
    inc["bullets"] = bullets
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": inc},
    )
    return {"message": f"Bought {bullets:,} bullets for {cost_used} points", "bullets": bullets, "cost": cost_used}


async def admin_add_bullets(target_username: str, bullets: int, current_user: dict = Depends(get_current_user)):
    """Admin: add bullets to a user."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    if bullets <= 0:
        raise HTTPException(status_code=400, detail="Bullets must be greater than 0")
    username_pattern = _username_pattern(target_username)
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one(
        {"id": target["id"]},
        {"$inc": {"bullets": int(bullets)}}
    )
    return {"message": f"Added {int(bullets):,} bullets to {target_username}"}


# --- Armour ---

class ArmourBuyRequest(BaseModel):
    level: int  # 1-5
    state: Optional[str] = None  # armoury state to use for stock (must match the state whose stock is shown)


async def get_armour_options(request: Request, current_user: dict = Depends(get_current_user)):
    """List available armour sets. cost_* = production cost; effective_* = sell price (production * 1.35 * event). armoury_stock = produced stock in state's armoury. Optional ?state= for armoury stock (e.g. match bullet factory state)."""
    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    equipped_level = int(current_user.get("armour_level", 0) or 0)
    owned_max = int(current_user.get("armour_owned_level_max", equipped_level) or 0)
    money = float(current_user.get("money", 0) or 0)
    points = int(current_user.get("points", 0) or 0)
    state_param = (request.query_params.get("state") or "").strip()
    state = state_param or (current_user.get("current_state") or "").strip()
    factory = await get_armoury_for_state(state) if state else None
    armour_stock = (factory.get("armour_stock") or {}) if factory else {}
    rows = []
    for s in ARMOUR_SETS:
        cost_money = s.get("cost_money")
        cost_points = s.get("cost_points")
        # Sell price = production cost * 35% margin, then event multiplier
        effective_money = int(cost_money * ARMOUR_WEAPON_MARGIN * mult) if cost_money is not None else None
        effective_points = int(cost_points * ARMOUR_WEAPON_MARGIN * mult) if cost_points is not None else None
        affordable = True
        # Must buy tiers in order: can only buy level L if you already own level L-1
        if s["level"] > 1 and owned_max < s["level"] - 1:
            affordable = False
        if effective_money is not None and money < effective_money:
            affordable = False
        if effective_points is not None and points < effective_points:
            affordable = False
        level_key = str(s["level"])
        rows.append({
            "level": s["level"],
            "name": s["name"],
            "description": s["description"],
            "cost_money": cost_money,
            "cost_points": cost_points,
            "effective_cost_money": effective_money,
            "effective_cost_points": effective_points,
            "owned": owned_max >= s["level"],
            "equipped": equipped_level == s["level"],
            "affordable": affordable,
            "armoury_stock": int(armour_stock.get(level_key, 0) or 0),
        })
    # Loot-exclusive armour (level 6) — always shown: owned → equip; not owned → grayed "Loot exclusive"
    from routers.loot_box import ARMOUR_LEVEL_6_NAME
    rows.append({
        "level": 6,
        "name": ARMOUR_LEVEL_6_NAME,
        "description": "Loot-exclusive steel plate vest — not sold anywhere.",
        "cost_money": None,
        "cost_points": None,
        "effective_cost_money": None,
        "effective_cost_points": None,
        "owned": owned_max >= 6,
        "equipped": equipped_level == 6,
        "affordable": False,
        "armoury_stock": 0,
        "loot_exclusive": True,
    })
    return {"current_level": equipped_level, "owned_max": owned_max, "options": rows}


async def buy_armour(request: ArmourBuyRequest, current_user: dict = Depends(get_current_user)):
    level = int(request.level or 0)
    if level < 1 or level > 5:
        raise HTTPException(status_code=400, detail="Invalid armour level")
    equipped_level = int(current_user.get("armour_level", 0) or 0)
    owned_max = int(current_user.get("armour_owned_level_max", equipped_level) or 0)
    if level <= owned_max:
        raise HTTPException(status_code=400, detail="You already own this armour tier")
    # Must buy in order: can only buy level L if you already own level L-1
    if level > 1 and owned_max < level - 1:
        prev_name = next((a["name"] for a in ARMOUR_SETS if a["level"] == level - 1), f"Level {level - 1}")
        raise HTTPException(
            status_code=400,
            detail=f"You must buy armour tiers in order. Purchase {prev_name} (Lv.{level - 1}) first.",
        )
    armour = next((a for a in ARMOUR_SETS if a["level"] == level), None)
    if not armour:
        raise HTTPException(status_code=404, detail="Armour not found")
    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    price = int(armour["cost_money"] * ARMOUR_WEAPON_MARGIN * mult) if armour.get("cost_money") is not None else int(armour["cost_points"] * ARMOUR_WEAPON_MARGIN * mult)
    if armour.get("cost_money") is not None:
        if current_user.get("money", 0) < price:
            raise HTTPException(status_code=400, detail="Insufficient cash")
    else:
        if current_user.get("points", 0) < price:
            raise HTTPException(status_code=400, detail="Insufficient points")

    # Fulfill from armoury in same state if stock available (stock always decrements; owner gets 35% margin when buyer is not owner)
    state = (request.state or current_user.get("current_state") or "").strip()
    factory = await get_armoury_for_state(state) if state else None
    armour_stock = (factory.get("armour_stock") or {}) if factory else {}
    owner_id = factory.get("owner_id") if factory else None
    has_stock = armour_stock.get(str(level), 0) >= 1
    if factory and has_stock:
        armour_stock = dict(armour_stock)
        armour_stock[str(level)] = armour_stock[str(level)] - 1
        if armour_stock[str(level)] <= 0:
            del armour_stock[str(level)]
        state_key = factory.get("state") or _normalize_state(state)
        await db.bullet_factory.update_one(
            {"state": state_key},
            {"$set": {"armour_stock": armour_stock}},
        )
        if owner_id and owner_id != current_user["id"]:
            if armour.get("cost_money") is not None:
                await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -price}, "$set": {"armour_level": level, "armour_owned_level_max": max(owned_max, level)}})
                await db.bullet_factory.update_one({"state": state_key}, {"$inc": {"owner_pending_profit": price}})
            else:
                await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": -price}, "$set": {"armour_level": level, "armour_owned_level_max": max(owned_max, level)}})
                await db.bullet_factory.update_one({"state": state_key}, {"$inc": {"owner_pending_profit_points": price}})
        else:
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$set": {"armour_level": level, "armour_owned_level_max": max(owned_max, level)}},
            )
        return {"message": f"Purchased {armour['name']} (Armour Lv.{level}) from armoury", "new_level": level}

    updates = {"$set": {"armour_level": level, "armour_owned_level_max": max(owned_max, level)}}
    if armour.get("cost_money") is not None:
        updates["$inc"] = {"money": -price}
    else:
        updates["$inc"] = {"points": -price}
    await db.users.update_one({"id": current_user["id"]}, updates)
    return {"message": f"Purchased {armour['name']} (Armour Lv.{level})", "new_level": level}


async def equip_armour(request: ArmourBuyRequest, current_user: dict = Depends(get_current_user)):
    level = int(request.level or 0)
    owned_max = int(current_user.get("armour_owned_level_max", current_user.get("armour_level", 0) or 0) or 0)
    max_level = 6 if owned_max >= 6 else 5
    if level < 0 or level > max_level:
        raise HTTPException(status_code=400, detail="Invalid armour level")
    if level != 0 and level > owned_max:
        raise HTTPException(status_code=400, detail="You do not own this armour tier")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"armour_level": level}}
    )
    return {"message": "Armour equipped" if level else "Armour unequipped", "equipped_level": level}


async def unequip_armour(current_user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"armour_level": 0}}
    )
    return {"message": "Armour unequipped", "equipped_level": 0}


async def sell_armour(current_user: dict = Depends(get_current_user)):
    """Sell your highest owned armour tier for 50% of what you paid (sell price)."""
    owned_max = int(current_user.get("armour_owned_level_max", 0) or 0)
    if owned_max == 6:  # loot-exclusive Steel Plate Vest
        family_id = current_user.get("family_id")
        if family_id and await _family_in_active_war(family_id):
            raise HTTPException(status_code=403, detail="Loot-exclusive items cannot be sold during a family war")
    if owned_max < 1:
        raise HTTPException(status_code=400, detail="You have no armour to sell")
    armour = next((a for a in ARMOUR_SETS if a["level"] == owned_max), None)
    if not armour:
        raise HTTPException(status_code=404, detail="Armour tier not found")
    # Refund 50% of sell price (production * 1.35)
    sell_price_money = int(armour["cost_money"] * ARMOUR_WEAPON_MARGIN) if armour.get("cost_money") is not None else None
    sell_price_points = int(armour["cost_points"] * ARMOUR_WEAPON_MARGIN) if armour.get("cost_points") is not None else None
    refund_money = int(sell_price_money * 0.5) if sell_price_money is not None else None
    refund_points = int(sell_price_points * 0.5) if sell_price_points is not None else None
    new_owned_max = owned_max - 1
    equipped = int(current_user.get("armour_level", 0) or 0)
    updates = {"$set": {"armour_owned_level_max": new_owned_max}}
    if equipped == owned_max:
        updates["$set"]["armour_level"] = new_owned_max if new_owned_max > 0 else 0
    if refund_money is not None:
        updates["$inc"] = {"money": refund_money}
    elif refund_points is not None:
        updates["$inc"] = {"points": refund_points}
    await db.users.update_one({"id": current_user["id"]}, updates)
    msg = f"Sold {armour['name']} for "
    msg += f"${refund_money:,}" if refund_money is not None else f"{refund_points} points"
    return {"message": msg + " (50% of purchase price).", "refund_money": refund_money, "refund_points": refund_points}


# --- Weapons ---

# Per-user cache for GET /weapons (10s TTL); invalidate on equip/unequip/buy/sell
_get_weapons_cache: dict = {}  # user_id -> (result_list, expires_at)
_GET_WEAPONS_CACHE_TTL_SEC = 10
_GET_WEAPONS_CACHE_MAX_ENTRIES = 5000


def _invalidate_weapons_cache(user_id: str):
    _get_weapons_cache.pop(user_id, None)


class WeaponResponse(BaseModel):
    id: str
    name: str
    description: str
    damage: int
    bullets_needed: int
    rank_required: int
    price_money: Optional[int]
    price_points: Optional[int]
    effective_price_money: Optional[int] = None
    effective_price_points: Optional[int] = None
    owned: bool
    quantity: int
    equipped: bool = False
    locked: bool = False
    required_weapon_name: Optional[str] = None
    armoury_stock: int = 0  # produced stock in state's armoury (available to buy)
    loot_exclusive: bool = False


class WeaponBuyRequest(BaseModel):
    currency: str  # "money" or "points"
    state: Optional[str] = None  # armoury state to use for stock (must match the state whose stock is shown)


class WeaponEquipRequest(BaseModel):
    weapon_id: str


async def get_weapons(request: Request, current_user: dict = Depends(get_current_user)):
    uid = current_user["id"]
    state_param = (request.query_params.get("state") or "").strip()
    state = state_param or (current_user.get("current_state") or "").strip()
    use_cache = not state_param
    now = time.time()
    if use_cache and uid in _get_weapons_cache:
        payload, expires = _get_weapons_cache[uid]
        if now <= expires:
            return payload
    weapons = await db.weapons.find({}, {"_id": 0}).to_list(100)
    user_weapons = await db.user_weapons.find({"user_id": uid}, {"_id": 0}).to_list(100)
    weapons_map = {uw["weapon_id"]: uw["quantity"] for uw in user_weapons}
    equipped_weapon_id = current_user.get("equipped_weapon_id")
    if equipped_weapon_id and weapons_map.get(equipped_weapon_id, 0) <= 0:
        await db.users.update_one(
            {"id": uid},
            {"$set": {"equipped_weapon_id": None}}
        )
        equipped_weapon_id = None
    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    weapons_dict = {w["id"]: w for w in weapons}
    weapon_stock = {}
    if state:
        factory = await get_armoury_for_state(state)
        if factory:
            weapon_stock = factory.get("weapon_stock") or {}
    result = []
    for weapon in weapons:
        if weapon.get("loot_exclusive") and weapons_map.get(weapon["id"], 0) < 1:
            continue
        quantity = weapons_map.get(weapon["id"], 0)
        pm = weapon.get("price_money")
        pp = weapon.get("price_points")
        # price_* = production cost; sell price = production * 1.35 * event (35% margin)
        locked = False
        required_weapon_name = None
        try:
            weapon_num = int(weapon["id"].replace("weapon", "")) if weapon["id"].startswith("weapon") and weapon["id"][6:].isdigit() else 0
        except (ValueError, TypeError):
            weapon_num = 0
        if weapon_num > 1:
            prev_weapon_id = f"weapon{weapon_num - 1}"
            prev_weapon = weapons_dict.get(prev_weapon_id)
            if prev_weapon:
                required_weapon_name = prev_weapon["name"]
                prev_quantity = weapons_map.get(prev_weapon_id, 0)
                if prev_quantity < 1:
                    locked = True
        armoury_stock = int(weapon_stock.get(weapon["id"], 0) or 0)
        result.append(WeaponResponse(
            id=weapon["id"],
            name=weapon["name"],
            description=weapon["description"],
            damage=weapon["damage"],
            bullets_needed=weapon["bullets_needed"],
            rank_required=weapon["rank_required"],
            price_money=pm,
            price_points=pp,
            effective_price_money=int(pm * ARMOUR_WEAPON_MARGIN * mult) if pm is not None else None,
            effective_price_points=int(pp * ARMOUR_WEAPON_MARGIN * mult) if pp is not None else None,
            owned=quantity > 0,
            quantity=quantity,
            equipped=(quantity > 0 and equipped_weapon_id == weapon["id"]),
            locked=locked,
            required_weapon_name=required_weapon_name,
            armoury_stock=armoury_stock,
            loot_exclusive=bool(weapon.get("loot_exclusive")),
        ))
    if use_cache:
        if len(_get_weapons_cache) >= _GET_WEAPONS_CACHE_MAX_ENTRIES:
            oldest = next(iter(_get_weapons_cache))
            _get_weapons_cache.pop(oldest, None)
        _get_weapons_cache[uid] = (result, now + _GET_WEAPONS_CACHE_TTL_SEC)
    return result


async def equip_weapon(request: WeaponEquipRequest, current_user: dict = Depends(get_current_user)):
    weapon_id = (request.weapon_id or "").strip()
    if not weapon_id:
        raise HTTPException(status_code=400, detail="Weapon id required")
    owned = await db.user_weapons.find_one(
        {"user_id": current_user["id"], "weapon_id": weapon_id, "quantity": {"$gt": 0}},
        {"_id": 0}
    )
    if not owned:
        raise HTTPException(status_code=400, detail="You do not own this weapon")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"equipped_weapon_id": weapon_id}}
    )
    _invalidate_weapons_cache(current_user["id"])
    return {"message": "Weapon equipped"}


async def unequip_weapon(current_user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"equipped_weapon_id": None}}
    )
    _invalidate_weapons_cache(current_user["id"])
    return {"message": "Weapon unequipped"}


async def buy_weapon(weapon_id: str, request: WeaponBuyRequest, current_user: dict = Depends(get_current_user)):
    weapon = await db.weapons.find_one({"id": weapon_id}, {"_id": 0})
    if not weapon:
        raise HTTPException(status_code=404, detail="Weapon not found")
    if weapon.get("loot_exclusive"):
        raise HTTPException(status_code=400, detail="This weapon is loot-exclusive and cannot be bought")
    weapon_num = int(weapon_id.replace("weapon", "")) if weapon_id.startswith("weapon") else 0
    if weapon_num > 1:
        prev_weapon_id = f"weapon{weapon_num - 1}"
        prev_weapon = await db.weapons.find_one({"id": prev_weapon_id}, {"_id": 0, "name": 1})
        if prev_weapon:
            user_has_prev = await db.user_weapons.find_one(
                {"user_id": current_user["id"], "weapon_id": prev_weapon_id, "quantity": {"$gte": 1}},
                {"_id": 0}
            )
            if not user_has_prev:
                raise HTTPException(
                    status_code=400,
                    detail=f"You must own {prev_weapon['name']} before buying this weapon"
                )
    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    currency = (request.currency or "").strip().lower()
    if currency not in ("money", "points"):
        raise HTTPException(status_code=400, detail="Invalid currency")
    if currency == "money":
        if weapon.get("price_money") is None:
            raise HTTPException(status_code=400, detail="This weapon can only be bought with points")
        price = int(weapon["price_money"] * ARMOUR_WEAPON_MARGIN * mult)
        if current_user.get("money", 0) < price:
            raise HTTPException(status_code=400, detail="Insufficient money")
    else:
        if weapon.get("price_points") is None:
            raise HTTPException(status_code=400, detail="This weapon can only be bought with money")
        price = int(weapon["price_points"] * ARMOUR_WEAPON_MARGIN * mult)
        if current_user.get("points", 0) < price:
            raise HTTPException(status_code=400, detail="Insufficient points")

    # Fulfill from armoury in same state if stock available (stock always decrements; owner gets 35% margin when buyer is not owner)
    state = (request.state or current_user.get("current_state") or "").strip()
    factory = await get_armoury_for_state(state) if state else None
    weapon_stock = (factory.get("weapon_stock") or {}) if factory else {}
    owner_id = factory.get("owner_id") if factory else None
    has_stock = weapon_stock.get(weapon_id, 0) >= 1
    if factory and has_stock:
        weapon_stock = dict(weapon_stock)
        weapon_stock[weapon_id] = weapon_stock[weapon_id] - 1
        if weapon_stock[weapon_id] <= 0:
            del weapon_stock[weapon_id]
        state_key = factory.get("state") or _normalize_state(state)
        await db.bullet_factory.update_one(
            {"state": state_key},
            {"$set": {"weapon_stock": weapon_stock}},
        )
        if owner_id and owner_id != current_user["id"]:
            if currency == "money":
                await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -price}})
                await db.bullet_factory.update_one({"state": state_key}, {"$inc": {"owner_pending_profit": price}})
            else:
                await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": -price}})
                await db.bullet_factory.update_one({"state": state_key}, {"$inc": {"owner_pending_profit_points": price}})
        await db.user_weapons.update_one(
            {"user_id": current_user["id"], "weapon_id": weapon_id},
            {"$inc": {"quantity": 1}, "$set": {"acquired_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"equipped_weapon_id": weapon_id}},
        )
        _invalidate_weapons_cache(current_user["id"])
        return {"message": f"Successfully purchased {weapon['name']} from armoury"}

    if currency == "money":
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -price}})
    else:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": -price}})
    await db.user_weapons.update_one(
        {"user_id": current_user["id"], "weapon_id": weapon_id},
        {"$inc": {"quantity": 1}, "$set": {"acquired_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"equipped_weapon_id": weapon_id}},
    )
    _invalidate_weapons_cache(current_user["id"])
    return {"message": f"Successfully purchased {weapon['name']}"}


async def sell_weapon(weapon_id: str, current_user: dict = Depends(get_current_user)):
    """Sell one unit of a weapon for 50% of its base purchase price. Refunds money or points (same as list price type)."""
    weapon = await db.weapons.find_one({"id": weapon_id}, {"_id": 0})
    if not weapon:
        raise HTTPException(status_code=404, detail="Weapon not found")
    uw = await db.user_weapons.find_one({"user_id": current_user["id"], "weapon_id": weapon_id}, {"_id": 0, "quantity": 1})
    quantity = (uw or {}).get("quantity", 0) or 0
    if quantity < 1:
        raise HTTPException(status_code=400, detail="You do not own this weapon")
    # Refund 50% of sell price (production * 1.35)
    sell_money = int(weapon["price_money"] * ARMOUR_WEAPON_MARGIN) if weapon.get("price_money") is not None else None
    sell_points = int(weapon["price_points"] * ARMOUR_WEAPON_MARGIN) if weapon.get("price_points") is not None else None
    refund_money = int(sell_money * 0.5) if sell_money is not None else None
    refund_points = int(sell_points * 0.5) if sell_points is not None else None
    if refund_money is None and refund_points is None:
        raise HTTPException(status_code=400, detail="Weapon has no sell value")
    if refund_money is not None:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": refund_money}})
        refund_points = None
    else:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": refund_points}})
    new_qty = quantity - 1
    if new_qty <= 0:
        await db.user_weapons.delete_one({"user_id": current_user["id"], "weapon_id": weapon_id})
        if current_user.get("equipped_weapon_id") == weapon_id:
            await db.users.update_one({"id": current_user["id"]}, {"$set": {"equipped_weapon_id": None}})
    else:
        await db.user_weapons.update_one(
            {"user_id": current_user["id"], "weapon_id": weapon_id},
            {"$inc": {"quantity": -1}}
        )
    _invalidate_weapons_cache(current_user["id"])
    msg = f"Sold 1× {weapon['name']} for "
    msg += f"${refund_money:,}" if refund_money is not None else f"{refund_points} points"
    return {"message": msg + " (50% of purchase price).", "refund_money": refund_money, "refund_points": refund_points}


async def _best_weapon_for_user(user_id: str, equipped_weapon_id: str | None = None) -> tuple[int, str]:
    """
    Return (damage, weapon_name) for combat.
    If equipped_weapon_id is provided and owned, use it; otherwise fall back to best owned.
    """
    user_weapons = await db.user_weapons.find({"user_id": user_id, "quantity": {"$gt": 0}}, {"_id": 0}).to_list(100)
    weapons_list = await db.weapons.find({}, {"_id": 0, "id": 1, "damage": 1, "name": 1}).to_list(200)
    owned_ids = {uw.get("weapon_id") for uw in user_weapons}
    if equipped_weapon_id and equipped_weapon_id in owned_ids:
        w = next((x for x in weapons_list if x.get("id") == equipped_weapon_id), None)
        if w:
            return int(w.get("damage", 5) or 5), (w.get("name") or "Weapon")
    best_damage = 5
    best_name = "Brass Knuckles"
    for uw in user_weapons:
        w = next((x for x in weapons_list if x.get("id") == uw.get("weapon_id")), None)
        dmg = int(w.get("damage", 0) or 0) if w else 0
        if dmg > best_damage:
            best_damage = dmg
            best_name = w.get("name") or best_name
    return best_damage, best_name


async def _get_weapon_mastery_pct(user_id: str, weapon_id: str | None) -> int:
    """Return 0-100 mastery for this user/weapon. Used by attack to apply bullet discount. Brass Knuckles excluded."""
    if not weapon_id or weapon_id == BRASS_KNUCKLES_WEAPON_ID:
        return 0
    doc = await db.user_weapon_mastery.find_one(
        {"user_id": user_id, "weapon_id": weapon_id},
        {"_id": 0, "mastery_pct": 1},
    )
    return min(100, max(0, int(doc.get("mastery_pct", 0) or 0)))


async def get_shooting_range_mastery(current_user: dict = Depends(get_current_user)):
    """Return mastery for all gun weapons (exclude Brass Knuckles) for current user."""
    weapons_list = await db.weapons.find({}, {"_id": 0, "id": 1, "name": 1, "bullets_needed": 1}).to_list(200)
    gun_weapons = [w for w in weapons_list if w.get("id") != BRASS_KNUCKLES_WEAPON_ID]
    mastery_docs = await db.user_weapon_mastery.find(
        {"user_id": current_user["id"], "weapon_id": {"$in": [w["id"] for w in gun_weapons]}},
        {"_id": 0, "weapon_id": 1, "mastery_pct": 1, "last_trained_at": 1},
    ).to_list(100)
    by_weapon = {d["weapon_id"]: {"mastery_pct": min(100, max(0, int(d.get("mastery_pct", 0) or 0))), "last_trained_at": d.get("last_trained_at")} for d in mastery_docs}
    result = {}
    for w in gun_weapons:
        wid = w.get("id")
        if wid == BRASS_KNUCKLES_WEAPON_ID:
            continue
        result[wid] = by_weapon.get(wid, {"mastery_pct": 0, "last_trained_at": None})
    return {"mastery": result, "weapons": [{"id": w["id"], "name": w.get("name", w["id"])} for w in gun_weapons]}


async def train_shooting_range(request: ShootingRangeTrainRequest, current_user: dict = Depends(get_current_user)):
    """Train one weapon (auto_sim chunk). User must own the weapon. Gun only (exclude Brass Knuckles)."""
    weapon_id = (request.weapon_id or "").strip()
    if not weapon_id:
        raise HTTPException(status_code=400, detail="weapon_id required")
    if weapon_id == BRASS_KNUCKLES_WEAPON_ID:
        raise HTTPException(status_code=400, detail="Brass Knuckles cannot be trained at the shooting range.")
    weapon = await db.weapons.find_one({"id": weapon_id}, {"_id": 0, "id": 1, "name": 1, "bullets_needed": 1})
    if not weapon or int(weapon.get("bullets_needed") or 0) <= 0:
        raise HTTPException(status_code=400, detail="Only guns can be trained at the shooting range.")
    owned = await db.user_weapons.find_one({"user_id": current_user["id"], "weapon_id": weapon_id, "quantity": {"$gt": 0}}, {"_id": 1})
    if not owned:
        raise HTTPException(status_code=400, detail="You must own this weapon to train it.")
    if request.mode not in ("auto_sim", "live"):
        raise HTTPException(status_code=400, detail="Use mode 'auto_sim' or 'live'.")
    now = datetime.now(timezone.utc)
    doc = await db.user_weapon_mastery.find_one({"user_id": current_user["id"], "weapon_id": weapon_id}, {"_id": 0, "mastery_pct": 1, "last_trained_at": 1})
    current_pct = min(100, max(0, int(doc.get("mastery_pct", 0) or 0))) if doc else 0

    if request.mode == "live":
        hits = request.hits if request.hits is not None else 0
        if not (1 <= hits <= MASTERY_LIVE_HITS_MAX_PER_REQUEST):
            raise HTTPException(status_code=400, detail=f"hits must be 1–{MASTERY_LIVE_HITS_MAX_PER_REQUEST} for live mode.")
        add_pct = min(hits * MASTERY_PCT_PER_LIVE_HIT, 100 - current_pct)
    else:
        last = doc.get("last_trained_at") if doc else None
        if last:
            try:
                last_dt = datetime.fromisoformat(last.replace("Z", "+00:00")) if isinstance(last, str) else last
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                if (now - last_dt).total_seconds() < MASTERY_COOLDOWN_MINUTES * 60:
                    wait_sec = MASTERY_COOLDOWN_MINUTES * 60 - int((now - last_dt).total_seconds())
                    raise HTTPException(status_code=429, detail=f"Wait {max(1, wait_sec // 60)} min before training this weapon again.")
            except HTTPException:
                raise
            except Exception:
                pass
        add_pct = min(MASTERY_AUTO_SIM_PCT_PER_CHUNK, 100 - current_pct)

    if add_pct <= 0:
        return {"message": "Already at 100% mastery.", "mastery_pct": 100, "next_train_at": None}
    now_iso = now.isoformat()
    await db.user_weapon_mastery.update_one(
        {"user_id": current_user["id"], "weapon_id": weapon_id},
        {"$set": {"mastery_pct": current_pct + add_pct, "last_trained_at": now_iso}, "$setOnInsert": {"user_id": current_user["id"], "weapon_id": weapon_id}},
        upsert=True,
    )
    next_train_at = (now + timedelta(minutes=MASTERY_COOLDOWN_MINUTES)).isoformat() if request.mode == "auto_sim" else None
    msg = f"+{add_pct}% mastery ({weapon.get('name', weapon_id)})." if request.mode == "auto_sim" else f"+{add_pct}% mastery from {request.hits} hits ({weapon.get('name', weapon_id)})."
    return {"message": msg, "mastery_pct": current_pct + add_pct, "next_train_at": next_train_at}


def _tokens_from_user(user: dict) -> dict:
    """Build tokens dict for inventory: count and active_until per token type."""
    now = datetime.now(timezone.utc)
    field_count = {"xp_double": "xp_double_tokens", "jailbust_bonus": "jailbust_tokens"}
    field_until = {"xp_double": "xp_double_until", "jailbust_bonus": "jailbust_bonus_until"}
    out = {}
    for t in TOKEN_TYPES:
        count = int(user.get(field_count[t]) or 0)
        until_raw = user.get(field_until[t])
        active_until = None
        if until_raw:
            try:
                until = datetime.fromisoformat(until_raw.replace("Z", "+00:00"))
                if until.tzinfo is None:
                    until = until.replace(tzinfo=timezone.utc)
                if until > now:
                    active_until = until.isoformat()
            except Exception:
                pass
        out[t] = {"count": count, "active_until": active_until}
    return out


async def use_consumable_token(req: UseTokenRequest, current_user: dict = Depends(get_current_user)):
    """Use one consumable token (e.g. xp_double, jailbust_bonus). Sets active effect for 1 hour and decrements count."""
    if req.token_type not in TOKEN_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid token_type. Use one of: {list(TOKEN_TYPES)}")
    count_field = "xp_double_tokens" if req.token_type == "xp_double" else "jailbust_tokens"
    until_field = "xp_double_until" if req.token_type == "xp_double" else "jailbust_bonus_until"
    count = int(current_user.get(count_field) or 0)
    if count < 1:
        raise HTTPException(status_code=400, detail="No tokens of this type available.")
    now = datetime.now(timezone.utc)
    expiry = now + timedelta(hours=TOKEN_DURATION_HOURS)
    result = await db.users.update_one(
        {"id": current_user["id"], count_field: {"$gte": 1}},
        {"$inc": {count_field: -1}, "$set": {until_field: expiry.isoformat()}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="No tokens of this type available or race condition.")
    tokens = _tokens_from_user({
        **current_user,
        count_field: count - 1,
        until_field: expiry.isoformat(),
    })
    return {
        "message": f"Token used. Effect active for {TOKEN_DURATION_HOURS} hour(s).",
        "tokens": tokens,
    }


async def get_inventory(request: Request, current_user: dict = Depends(get_current_user)):
    """Aggregate weapons, armour, loot exclusives, and consumable tokens for the My Inventory page."""
    weapons = await get_weapons(request, current_user)
    armour = await get_armour_options(request, current_user)
    uid = current_user["id"]
    exclusive_cars = []
    cars = await db.user_cars.find({"user_id": uid}, {"_id": 0, "car_id": 1, "id": 1}).to_list(100)
    cars_list = CARS or []
    for uc in cars:
        cinfo = next((c for c in cars_list if c.get("id") == uc.get("car_id")), None)
        if cinfo and cinfo.get("rarity") in ("loot_exclusive", "exclusive"):
            exclusive_cars.append({"id": uc.get("id"), "name": cinfo.get("name", "?"), "car_id": uc.get("car_id"), "rarity": cinfo.get("rarity", "loot_exclusive")})
    speakeasy = await db.exclusive_properties.find_one({"owner_id": uid, "type": "speakeasy"}, {"_id": 1})
    tokens = _tokens_from_user(current_user)
    return {
        "weapons": [w.model_dump() if hasattr(w, "model_dump") else w for w in weapons],
        "armour": armour,
        "loot_exclusives": {
            "exclusive_cars": exclusive_cars,
            "has_speakeasy": speakeasy is not None,
        },
        "tokens": tokens,
    }


def register(router):
    # Bullet factory routes
    router.add_api_route("/bullet-factory", get_bullet_factory, methods=["GET"])
    router.add_api_route("/bullet-factory/list", get_bullet_factory_list, methods=["GET"])
    router.add_api_route("/bullet-factory/claim", claim_bullet_factory, methods=["POST"])
    router.add_api_route("/bullet-factory/set-price", set_price, methods=["POST"])
    router.add_api_route("/bullet-factory/relinquish", relinquish_bullet_factory, methods=["POST"])
    router.add_api_route("/bullet-factory/sell-on-trade", bullet_factory_sell_on_trade, methods=["POST"])
    router.add_api_route("/bullet-factory/collect", collect_bullet_factory, methods=["POST"])
    router.add_api_route("/bullet-factory/buy", buy_bullets, methods=["POST"])
    router.add_api_route("/bullet-factory/start-armour-production", start_armour_production, methods=["POST"])
    router.add_api_route("/bullet-factory/start-weapon-production", start_weapon_production, methods=["POST"])
    router.add_api_route("/bullet-factory/start-armour-production-all", start_armour_production_all, methods=["POST"])
    router.add_api_route("/bullet-factory/start-weapon-production-all", start_weapon_production_all, methods=["POST"])
    router.add_api_route("/store/buy-bullets", store_buy_bullets, methods=["POST"])
    router.add_api_route("/admin/add-bullets", admin_add_bullets, methods=["POST"])
    # Armour routes
    router.add_api_route("/armour/options", get_armour_options, methods=["GET"])
    router.add_api_route("/armour/buy", buy_armour, methods=["POST"])
    router.add_api_route("/armour/equip", equip_armour, methods=["POST"])
    router.add_api_route("/armour/unequip", unequip_armour, methods=["POST"])
    router.add_api_route("/armour/sell", sell_armour, methods=["POST"])
    # Weapons routes
    router.add_api_route("/weapons", get_weapons, methods=["GET"], response_model=List[WeaponResponse])
    router.add_api_route("/weapons/equip", equip_weapon, methods=["POST"])
    router.add_api_route("/weapons/unequip", unequip_weapon, methods=["POST"])
    router.add_api_route("/weapons/{weapon_id}/buy", buy_weapon, methods=["POST"])
    router.add_api_route("/weapons/{weapon_id}/sell", sell_weapon, methods=["POST"])
    router.add_api_route("/shooting-range/mastery", get_shooting_range_mastery, methods=["GET"])
    router.add_api_route("/shooting-range/train", train_shooting_range, methods=["POST"])
    router.add_api_route("/inventory", get_inventory, methods=["GET"])
    router.add_api_route("/inventory/tokens/use", use_consumable_token, methods=["POST"])
