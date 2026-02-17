# Bullet Factory / Armoury: one per state. Bullets 3000/hour; owner can also produce armour & weapons (pay per hour, stock accumulates).
# Owner can claim (pay), set price, collect bullets. Others buy at owner's price (or unowned price).
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

BULLET_FACTORY_PRODUCTION_PER_HOUR = 3000
BULLET_FACTORY_MAX_HOURS_CAP = 24  # cap accumulated at 24h of production
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


async def _tick_armoury_production(state: str, factory: dict) -> dict:
    """Advance armour/weapon stock by elapsed time; update DB. Returns updated factory."""
    now = datetime.now(timezone.utc)
    updates = {}
    # Armour
    if factory.get("armour_producing") and factory.get("armour_production_started_at"):
        try:
            started = datetime.fromisoformat(factory["armour_production_started_at"].replace("Z", "+00:00"))
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            hours_remaining = float(factory.get("armour_production_hours_remaining") or 0)
            elapsed_hours = (now - started).total_seconds() / 3600
            use_hours = min(elapsed_hours, hours_remaining)
            if use_hours > 0:
                level = int(factory.get("armour_production_level") or 1)
                armour_stock = dict(factory.get("armour_stock") or {})
                key = str(level)
                current = armour_stock.get(key, 0)
                room = ARMOURY_MAX_STOCK_PER_ITEM - current
                raw_units = int(use_hours * ARMOURY_ARMOUR_RATE_PER_HOUR)
                add_units = min(raw_units, room) if room > 0 else 0
                if add_units > 0:
                    armour_stock[key] = current + add_units
                    updates["armour_stock"] = armour_stock
                hours_used = add_units / ARMOURY_ARMOUR_RATE_PER_HOUR
                hours_remaining -= hours_used
                updates["armour_production_hours_remaining"] = max(0, hours_remaining)
                if hours_remaining <= 0:
                    updates["armour_producing"] = False
            updates["armour_production_started_at"] = now.isoformat()
        except Exception:
            pass
    # Weapon
    if factory.get("weapon_producing") and factory.get("weapon_production_started_at"):
        try:
            started = datetime.fromisoformat(factory["weapon_production_started_at"].replace("Z", "+00:00"))
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            hours_remaining = float(factory.get("weapon_production_hours_remaining") or 0)
            elapsed_hours = (now - started).total_seconds() / 3600
            use_hours = min(elapsed_hours, hours_remaining)
            if use_hours > 0:
                wid = factory.get("weapon_production_id") or ""
                weapon_stock = dict(factory.get("weapon_stock") or {})
                current = weapon_stock.get(wid, 0)
                room = ARMOURY_MAX_STOCK_PER_ITEM - current
                raw_units = int(use_hours * ARMOURY_WEAPON_RATE_PER_HOUR)
                add_units = min(raw_units, room) if room > 0 else 0
                if add_units > 0:
                    weapon_stock[wid] = current + add_units
                    updates["weapon_stock"] = weapon_stock
                hours_used = add_units / ARMOURY_WEAPON_RATE_PER_HOUR
                hours_remaining -= hours_used
                updates["weapon_production_hours_remaining"] = max(0, hours_remaining)
                if hours_remaining <= 0:
                    updates["weapon_producing"] = False
            updates["weapon_production_started_at"] = now.isoformat()
        except Exception:
            pass
    if updates:
        await db.bullet_factory.update_one({"state": state}, {"$set": updates})
        factory = {**factory, **updates}
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
    cap = BULLET_FACTORY_PRODUCTION_PER_HOUR * BULLET_FACTORY_MAX_HOURS_CAP
    return min(raw, cap)


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
    out = {
        "state": state,
        "production_per_hour": BULLET_FACTORY_PRODUCTION_PER_HOUR,
        "claim_cost": BULLET_FACTORY_CLAIM_COST,
        "owner_id": owner_id,
        "owner_username": owner_username,
        "accumulated_bullets": accumulated,
        "can_collect": is_owner and accumulated > 0,
        "can_buy": can_buy,
        "price_per_bullet": effective_price,
        "price_min": BULLET_FACTORY_PRICE_MIN,
        "price_max": BULLET_FACTORY_PRICE_MAX,
        "unowned_price_min": BULLET_FACTORY_UNOWNED_PRICE_MIN,
        "unowned_price_max": BULLET_FACTORY_UNOWNED_PRICE_MAX,
        "is_unowned": owner_id is None,
        "last_collected_at": factory.get("last_collected_at"),
        "is_owner": is_owner,
    }
    # Armoury (owner only)
    if owner_id:
        out["armour_producing"] = bool(factory.get("armour_producing"))
        out["armour_production_level"] = factory.get("armour_production_level")
        out["armour_production_hours_remaining"] = float(factory.get("armour_production_hours_remaining") or 0)
        out["armour_stock"] = factory.get("armour_stock") or {}
        out["armour_rate_per_hour"] = ARMOURY_ARMOUR_RATE_PER_HOUR
        out["armour_max_stock"] = ARMOURY_MAX_STOCK_PER_ITEM
        out["weapon_producing"] = bool(factory.get("weapon_producing"))
        out["weapon_production_id"] = factory.get("weapon_production_id")
        out["weapon_production_hours_remaining"] = float(factory.get("weapon_production_hours_remaining") or 0)
        out["weapon_stock"] = factory.get("weapon_stock") or {}
        out["weapon_rate_per_hour"] = ARMOURY_WEAPON_RATE_PER_HOUR
        out["weapon_max_stock"] = ARMOURY_MAX_STOCK_PER_ITEM
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


async def collect_bullets(
    body: StateOptionalRequest = Body(default=StateOptionalRequest()),
    current_user: dict = Depends(get_current_user),
):
    """Owner collects accumulated bullets in this state."""
    state = _normalize_state(body.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the bullet factory in this state")
    accumulated = _accumulated_bullets(factory)
    if accumulated <= 0:
        raise HTTPException(status_code=400, detail="No bullets to collect yet")
    now = datetime.now(timezone.utc).isoformat()
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {"last_collected_at": now}},
    )
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"bullets": accumulated}},
    )
    return {
        "message": f"Collected {accumulated:,} bullets",
        "collected": accumulated,
        "new_total": (current_user.get("bullets") or 0) + accumulated,
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
    now = datetime.now(timezone.utc).isoformat()
    armour_stock = dict(factory.get("armour_stock") or {})
    hours_remaining = float(factory.get("armour_production_hours_remaining") or 0) + 1.0
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {
            "armour_producing": True,
            "armour_production_level": level,
            "armour_production_started_at": now,
            "armour_production_hours_remaining": hours_remaining,
            "armour_stock": armour_stock,
        }},
    )
    return {
        "message": f"Started armour (level {level}) production. {ARMOURY_ARMOUR_RATE_PER_HOUR}/hour for the next {int(hours_remaining)} hour(s).",
        "state": state,
        "armour_production_level": level,
        "armour_production_hours_remaining": hours_remaining,
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
    now = datetime.now(timezone.utc).isoformat()
    weapon_stock = dict(factory.get("weapon_stock") or {})
    hours_remaining = float(factory.get("weapon_production_hours_remaining") or 0) + 1.0
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {
            "weapon_producing": True,
            "weapon_production_id": weapon_id,
            "weapon_production_started_at": now,
            "weapon_production_hours_remaining": hours_remaining,
            "weapon_stock": weapon_stock,
        }},
    )
    return {
        "message": f"Started {weapon.get('name', weapon_id)} production. {ARMOURY_WEAPON_RATE_PER_HOUR}/hour for the next {int(hours_remaining)} hour(s).",
        "state": state,
        "weapon_production_id": weapon_id,
        "weapon_production_hours_remaining": hours_remaining,
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
    """Buy bullets from the factory in this state. When unowned, pay system price ($2,500–$4,000). When owned, pay owner's price."""
    state = _normalize_state(request.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    owner_id = factory.get("owner_id")
    amount = request.amount
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    accumulated = _accumulated_bullets(factory)
    if amount > accumulated:
        raise HTTPException(
            status_code=400,
            detail=f"Factory only has {accumulated:,} bullets available",
        )
    if owner_id:
        if owner_id == current_user["id"]:
            raise HTTPException(status_code=400, detail="Owner collects for free; use Collect instead")
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
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": -total_cost, "bullets": amount}},
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
    router.add_api_route("/bullet-factory/collect", collect_bullets, methods=["POST"])
    router.add_api_route("/bullet-factory/set-price", set_price, methods=["POST"])
    router.add_api_route("/bullet-factory/buy", buy_bullets, methods=["POST"])
    router.add_api_route("/bullet-factory/start-armour-production", start_armour_production, methods=["POST"])
    router.add_api_route("/bullet-factory/start-weapon-production", start_weapon_production, methods=["POST"])
    router.add_api_route("/store/buy-bullets", store_buy_bullets, methods=["POST"])
    router.add_api_route("/admin/add-bullets", admin_add_bullets, methods=["POST"])
