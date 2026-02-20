# Bullet Factory / Armoury: one per state. Bullets 3000/hour; owner can also produce armour & weapons (pay per hour, stock accumulates).
# Owner can claim (pay), set price. Bullets are sold from factory stock (no collect); others buy at owner's price (or unowned price).
# Armoury: owner clicks "Produce" for armour or weapons, pays production cost for 1 hour; stock accumulates at rate/hour.
from datetime import datetime, timezone, timedelta
import os
import sys
import random

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import Depends, HTTPException, Body
from pydantic import BaseModel
from typing import Optional

from server import db, get_current_user, STATES, _is_admin, _username_pattern, ARMOUR_SETS

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
BULLET_PACKS = {5000: 500, 10000: 1000, 50000: 5000, 100000: 10000}


class StateOptionalRequest(BaseModel):
    state: Optional[str] = None


class SetPriceRequest(BaseModel):
    price_per_bullet: int
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


def _normalize_state(state: str) -> str:
    if not state or state not in STATES:
        return STATES[0] if STATES else ""
    return state


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
    is_owner = current_user["id"] == owner_id
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
    """Check if user owns any property (airport, bullet factory, or armory). Max 1 per player. Add armory when armory ownership exists."""
    from server import db
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
    """Pay to become the bullet factory owner in this state. Max 1 property per player."""
    owned_prop = await _user_owns_any_property(current_user["id"])
    if owned_prop:
        raise HTTPException(status_code=400, detail="You may only own 1 property (airport or bullet factory). Relinquish it first (My Properties or States).")
    state = _normalize_state(body.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id"):
        raise HTTPException(status_code=400, detail="Bullet factory in this state already has an owner")
    user_money = int(current_user.get("money") or 0)
    if user_money < BULLET_FACTORY_CLAIM_COST:
        raise HTTPException(
            status_code=400,
            detail=f"You need ${BULLET_FACTORY_CLAIM_COST:,} to claim the Bullet Factory",
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
        "message": f"You now own the Bullet Factory in {state}. It produces 3,000 bullets per hour.",
        "state": state,
        "owner_id": current_user["id"],
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
    weapon = await db.weapons.find_one({"id": weapon_id}, {"_id": 0, "price_money": 1, "price_points": 1, "name": 1})
    if not weapon:
        raise HTTPException(status_code=404, detail="Weapon not found")
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
    weapons = await db.weapons.find({}, {"_id": 0, "id": 1, "price_money": 1, "price_points": 1}).to_list(200)
    weapon_hours = dict(factory.get("weapon_production_hours") or {})
    weapons_to_add = [w for w in weapons if w.get("id") and float(weapon_hours.get(w["id"]) or 0) <= 0.01]
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
    last_bought = user_doc.get("last_bullet_factory_bought_at")
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
        {"$inc": {"money": -total_cost, "bullets": amount}, "$set": {"last_bullet_factory_bought_at": now_iso}},
    )
    if owner_id:
        await db.users.update_one(
            {"id": owner_id},
            {"$inc": {"money": total_cost}},
        )
    return {
        "message": f"Bought {amount:,} bullets for ${total_cost:,}",
        "amount": amount,
        "total_paid": total_cost,
        "new_bullets": (current_user.get("bullets") or 0) + amount,
        "state": state,
    }


async def store_buy_bullets(bullets: int, current_user: dict = Depends(get_current_user)):
    """Buy bullets with points (store)."""
    cost = BULLET_PACKS.get(bullets)
    if cost is None:
        raise HTTPException(status_code=400, detail=f"Invalid bullet pack. Choose from: {', '.join(str(k) for k in BULLET_PACKS)}")
    if current_user["points"] < cost:
        raise HTTPException(status_code=400, detail=f"Insufficient points. Need {cost}, have {current_user['points']}")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -cost, "bullets": bullets}}
    )
    return {"message": f"Bought {bullets:,} bullets for {cost} points", "bullets": bullets, "cost": cost}


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


def register(router):
    router.add_api_route("/bullet-factory", get_bullet_factory, methods=["GET"])
    router.add_api_route("/bullet-factory/list", get_bullet_factory_list, methods=["GET"])
    router.add_api_route("/bullet-factory/claim", claim_bullet_factory, methods=["POST"])
    router.add_api_route("/bullet-factory/set-price", set_price, methods=["POST"])
    router.add_api_route("/bullet-factory/buy", buy_bullets, methods=["POST"])
    router.add_api_route("/bullet-factory/start-armour-production", start_armour_production, methods=["POST"])
    router.add_api_route("/bullet-factory/start-weapon-production", start_weapon_production, methods=["POST"])
    router.add_api_route("/bullet-factory/start-armour-production-all", start_armour_production_all, methods=["POST"])
    router.add_api_route("/bullet-factory/start-weapon-production-all", start_weapon_production_all, methods=["POST"])
    router.add_api_route("/store/buy-bullets", store_buy_bullets, methods=["POST"])
    router.add_api_route("/admin/add-bullets", admin_add_bullets, methods=["POST"])
