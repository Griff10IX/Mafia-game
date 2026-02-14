# Armour endpoints: options, buy, equip, unequip, sell
from pydantic import BaseModel

from fastapi import Depends, HTTPException

from server import db, get_current_user, get_effective_event, ARMOUR_SETS


class ArmourBuyRequest(BaseModel):
    level: int  # 1-5


async def get_armour_options(current_user: dict = Depends(get_current_user)):
    """List available armour sets and affordability. Costs use event multiplier when set."""
    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    equipped_level = int(current_user.get("armour_level", 0) or 0)
    owned_max = int(current_user.get("armour_owned_level_max", equipped_level) or 0)
    money = float(current_user.get("money", 0) or 0)
    points = int(current_user.get("points", 0) or 0)
    rows = []
    for s in ARMOUR_SETS:
        cost_money = s.get("cost_money")
        cost_points = s.get("cost_points")
        effective_money = int(cost_money * mult) if cost_money is not None else None
        effective_points = int(cost_points * mult) if cost_points is not None else None
        affordable = True
        if effective_money is not None and money < effective_money:
            affordable = False
        if effective_points is not None and points < effective_points:
            affordable = False
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
    armour = next((a for a in ARMOUR_SETS if a["level"] == level), None)
    if not armour:
        raise HTTPException(status_code=404, detail="Armour not found")
    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    updates = {"$set": {"armour_level": level, "armour_owned_level_max": max(owned_max, level)}}
    if armour.get("cost_money") is not None:
        cost = int(armour["cost_money"] * mult)
        if current_user.get("money", 0) < cost:
            raise HTTPException(status_code=400, detail="Insufficient cash")
        updates["$inc"] = {"money": -cost}
    elif armour.get("cost_points") is not None:
        cost = int(armour["cost_points"] * mult)
        if current_user.get("points", 0) < cost:
            raise HTTPException(status_code=400, detail="Insufficient points")
        updates["$inc"] = {"points": -cost}
    else:
        raise HTTPException(status_code=500, detail="Armour cost misconfigured")
    await db.users.update_one({"id": current_user["id"]}, updates)
    return {"message": f"Purchased {armour['name']} (Armour Lv.{level})", "new_level": level}


async def equip_armour(request: ArmourBuyRequest, current_user: dict = Depends(get_current_user)):
    level = int(request.level or 0)
    if level < 0 or level > 5:
        raise HTTPException(status_code=400, detail="Invalid armour level")
    owned_max = int(current_user.get("armour_owned_level_max", current_user.get("armour_level", 0) or 0) or 0)
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
    """Sell your highest owned armour tier for 50% of its base purchase price."""
    owned_max = int(current_user.get("armour_owned_level_max", 0) or 0)
    if owned_max < 1:
        raise HTTPException(status_code=400, detail="You have no armour to sell")
    armour = next((a for a in ARMOUR_SETS if a["level"] == owned_max), None)
    if not armour:
        raise HTTPException(status_code=404, detail="Armour tier not found")
    refund_money = int(armour["cost_money"] * 0.5) if armour.get("cost_money") is not None else None
    refund_points = int(armour["cost_points"] * 0.5) if armour.get("cost_points") is not None else None
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


def register(router):
    router.add_api_route("/armour/options", get_armour_options, methods=["GET"])
    router.add_api_route("/armour/buy", buy_armour, methods=["POST"])
    router.add_api_route("/armour/equip", equip_armour, methods=["POST"])
    router.add_api_route("/armour/unequip", unequip_armour, methods=["POST"])
    router.add_api_route("/armour/sell", sell_armour, methods=["POST"])
