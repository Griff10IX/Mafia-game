# Weapons endpoints: list, equip, unequip, buy, sell; combat helper _best_weapon_for_user
from datetime import datetime, timezone
from typing import List, Optional
import time
from pydantic import BaseModel

from fastapi import Depends, HTTPException

from server import db, get_current_user, get_effective_event, ARMOUR_WEAPON_MARGIN


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


class WeaponBuyRequest(BaseModel):
    currency: str  # "money" or "points"


class WeaponEquipRequest(BaseModel):
    weapon_id: str


async def get_weapons(current_user: dict = Depends(get_current_user)):
    uid = current_user["id"]
    now = time.time()
    if uid in _get_weapons_cache:
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
    state = (current_user.get("current_state") or "").strip()
    weapon_stock = {}
    if state:
        from routers.bullet_factory import get_armoury_for_state
        factory = await get_armoury_for_state(state)
        if factory:
            weapon_stock = factory.get("weapon_stock") or {}
    result = []
    for weapon in weapons:
        quantity = weapons_map.get(weapon["id"], 0)
        pm = weapon.get("price_money")
        pp = weapon.get("price_points")
        # price_* = production cost; sell price = production * 1.35 * event (35% margin)
        locked = False
        required_weapon_name = None
        weapon_num = int(weapon["id"].replace("weapon", "")) if weapon["id"].startswith("weapon") else 0
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
        ))
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

    # Fulfill from armoury in same state if available (owner gets 35% margin)
    from routers.bullet_factory import get_armoury_for_state
    state = (current_user.get("current_state") or "").strip()
    factory = await get_armoury_for_state(state) if state else None
    weapon_stock = factory.get("weapon_stock") or {}
    owner_id = factory.get("owner_id") if factory else None
    if owner_id and owner_id != current_user["id"] and weapon_stock.get(weapon_id, 0) >= 1:
        weapon_stock = dict(weapon_stock)
        weapon_stock[weapon_id] = weapon_stock[weapon_id] - 1
        if weapon_stock[weapon_id] <= 0:
            del weapon_stock[weapon_id]
        await db.bullet_factory.update_one(
            {"state": factory.get("state")},
            {"$set": {"weapon_stock": weapon_stock}},
        )
        if currency == "money":
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -price}})
            await db.users.update_one({"id": owner_id}, {"$inc": {"money": price}})
        else:
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": -price}})
            await db.users.update_one({"id": owner_id}, {"$inc": {"points": price}})
        await db.user_weapons.update_one(
            {"user_id": current_user["id"], "weapon_id": weapon_id},
            {"$inc": {"quantity": 1}, "$set": {"acquired_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
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


def register(router):
    router.add_api_route("/weapons", get_weapons, methods=["GET"], response_model=List[WeaponResponse])
    router.add_api_route("/weapons/equip", equip_weapon, methods=["POST"])
    router.add_api_route("/weapons/unequip", unequip_weapon, methods=["POST"])
    router.add_api_route("/weapons/{weapon_id}/buy", buy_weapon, methods=["POST"])
    router.add_api_route("/weapons/{weapon_id}/sell", sell_weapon, methods=["POST"])
