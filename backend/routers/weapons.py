# Weapons endpoints: list, equip, unequip, buy, sell
from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel

from fastapi import Depends, HTTPException

from server import db, get_current_user, get_effective_event


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


class WeaponBuyRequest(BaseModel):
    currency: str  # "money" or "points"


class WeaponEquipRequest(BaseModel):
    weapon_id: str


async def get_weapons(current_user: dict = Depends(get_current_user)):
    weapons = await db.weapons.find({}, {"_id": 0}).to_list(100)
    user_weapons = await db.user_weapons.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(100)
    weapons_map = {uw["weapon_id"]: uw["quantity"] for uw in user_weapons}
    equipped_weapon_id = current_user.get("equipped_weapon_id")
    if equipped_weapon_id and weapons_map.get(equipped_weapon_id, 0) <= 0:
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"equipped_weapon_id": None}}
        )
        equipped_weapon_id = None
    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    result = []
    for weapon in weapons:
        quantity = weapons_map.get(weapon["id"], 0)
        pm = weapon.get("price_money")
        pp = weapon.get("price_points")
        result.append(WeaponResponse(
            id=weapon["id"],
            name=weapon["name"],
            description=weapon["description"],
            damage=weapon["damage"],
            bullets_needed=weapon["bullets_needed"],
            rank_required=weapon["rank_required"],
            price_money=pm,
            price_points=pp,
            effective_price_money=int(pm * mult) if pm is not None else None,
            effective_price_points=int(pp * mult) if pp is not None else None,
            owned=quantity > 0,
            quantity=quantity,
            equipped=(quantity > 0 and equipped_weapon_id == weapon["id"])
        ))
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
    return {"message": "Weapon equipped"}


async def unequip_weapon(current_user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"equipped_weapon_id": None}}
    )
    return {"message": "Weapon unequipped"}


async def buy_weapon(weapon_id: str, request: WeaponBuyRequest, current_user: dict = Depends(get_current_user)):
    weapon = await db.weapons.find_one({"id": weapon_id}, {"_id": 0})
    if not weapon:
        raise HTTPException(status_code=404, detail="Weapon not found")
    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    currency = (request.currency or "").strip().lower()
    if currency not in ("money", "points"):
        raise HTTPException(status_code=400, detail="Invalid currency")
    if currency == "money":
        if weapon.get("price_money") is None:
            raise HTTPException(status_code=400, detail="This weapon can only be bought with points")
        cost = int(weapon["price_money"] * mult)
        if current_user["money"] < cost:
            raise HTTPException(status_code=400, detail="Insufficient money")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -cost}})
    elif currency == "points":
        if weapon.get("price_points") is None:
            raise HTTPException(status_code=400, detail="This weapon can only be bought with money")
        cost = int(weapon["price_points"] * mult)
        if current_user["points"] < cost:
            raise HTTPException(status_code=400, detail="Insufficient points")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": -cost}})
    await db.user_weapons.update_one(
        {"user_id": current_user["id"], "weapon_id": weapon_id},
        {"$inc": {"quantity": 1}, "$set": {"acquired_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": f"Successfully purchased {weapon['name']}"}


async def sell_weapon(weapon_id: str, current_user: dict = Depends(get_current_user)):
    """Sell one unit of a weapon for 50% of its base purchase price."""
    weapon = await db.weapons.find_one({"id": weapon_id}, {"_id": 0})
    if not weapon:
        raise HTTPException(status_code=404, detail="Weapon not found")
    uw = await db.user_weapons.find_one({"user_id": current_user["id"], "weapon_id": weapon_id}, {"_id": 0, "quantity": 1})
    quantity = (uw or {}).get("quantity", 0) or 0
    if quantity < 1:
        raise HTTPException(status_code=400, detail="You do not own this weapon")
    refund_money = int(weapon["price_money"] * 0.5) if weapon.get("price_money") is not None else None
    refund_points = int(weapon["price_points"] * 0.5) if weapon.get("price_points") is not None else None
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
    msg = f"Sold 1× {weapon['name']} for "
    msg += f"${refund_money:,}" if refund_money is not None else f"{refund_points} points"
    return {"message": msg + " (50% of purchase price).", "refund_money": refund_money, "refund_points": refund_points}


def register(router):
    router.add_api_route("/weapons", get_weapons, methods=["GET"], response_model=List[WeaponResponse])
    router.add_api_route("/weapons/equip", equip_weapon, methods=["POST"])
    router.add_api_route("/weapons/unequip", unequip_weapon, methods=["POST"])
    router.add_api_route("/weapons/{weapon_id}/buy", buy_weapon, methods=["POST"])
    router.add_api_route("/weapons/{weapon_id}/sell", sell_weapon, methods=["POST"])
