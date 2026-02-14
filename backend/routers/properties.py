# Properties endpoints: list, buy, collect income
from datetime import datetime, timezone
from typing import List
from pydantic import BaseModel

from fastapi import Depends, HTTPException

from server import db, get_current_user


class PropertyResponse(BaseModel):
    id: str
    name: str
    property_type: str
    price: int
    income_per_hour: int
    max_level: int
    owned: bool
    level: int
    available_income: float


async def get_properties(current_user: dict = Depends(get_current_user)):
    properties = await db.properties.find({}, {"_id": 0}).to_list(100)
    user_properties = await db.user_properties.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(100)
    properties_map = {up["property_id"]: up for up in user_properties}
    result = []
    for prop in properties:
        user_prop = properties_map.get(prop["id"])
        owned = user_prop is not None
        level = user_prop["level"] if owned else 0
        available_income = 0.0
        if owned and "last_collected" in user_prop:
            last_collected = datetime.fromisoformat(user_prop["last_collected"])
            hours_passed = (datetime.now(timezone.utc) - last_collected).total_seconds() / 3600
            available_income = min(hours_passed * prop["income_per_hour"] * level, prop["income_per_hour"] * level * 24)
        result.append(PropertyResponse(
            id=prop["id"],
            name=prop["name"],
            property_type=prop["property_type"],
            price=prop["price"],
            income_per_hour=prop["income_per_hour"],
            max_level=prop["max_level"],
            owned=owned,
            level=level,
            available_income=available_income
        ))
    return result


async def buy_property(property_id: str, current_user: dict = Depends(get_current_user)):
    prop = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    user_prop = await db.user_properties.find_one(
        {"user_id": current_user["id"], "property_id": property_id},
        {"_id": 0}
    )
    if user_prop:
        if user_prop["level"] >= prop["max_level"]:
            raise HTTPException(status_code=400, detail="Property already at max level")
        cost = prop["price"] * (user_prop["level"] + 1)
    else:
        cost = prop["price"]
    if current_user["money"] < cost:
        raise HTTPException(status_code=400, detail="Insufficient money")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": -cost}}
    )
    if user_prop:
        await db.user_properties.update_one(
            {"user_id": current_user["id"], "property_id": property_id},
            {"$inc": {"level": 1}}
        )
    else:
        await db.user_properties.insert_one({
            "user_id": current_user["id"],
            "property_id": property_id,
            "level": 1,
            "last_collected": datetime.now(timezone.utc).isoformat()
        })
    return {"message": f"Successfully purchased/upgraded {prop['name']}"}


async def collect_property_income(property_id: str, current_user: dict = Depends(get_current_user)):
    prop = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    user_prop = await db.user_properties.find_one(
        {"user_id": current_user["id"], "property_id": property_id},
        {"_id": 0}
    )
    if not user_prop:
        raise HTTPException(status_code=404, detail="You don't own this property")
    last_collected = datetime.fromisoformat(user_prop["last_collected"])
    hours_passed = (datetime.now(timezone.utc) - last_collected).total_seconds() / 3600
    income = min(hours_passed * prop["income_per_hour"] * user_prop["level"], prop["income_per_hour"] * user_prop["level"] * 24)
    if income < 1:
        raise HTTPException(status_code=400, detail="No income to collect yet")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": income}}
    )
    await db.user_properties.update_one(
        {"user_id": current_user["id"], "property_id": property_id},
        {"$set": {"last_collected": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": f"Collected ${income:,.2f}"}


def register(router):
    router.add_api_route("/properties", get_properties, methods=["GET"], response_model=List[PropertyResponse])
    router.add_api_route("/properties/{property_id}/buy", buy_property, methods=["POST"])
    router.add_api_route("/properties/{property_id}/collect", collect_property_income, methods=["POST"])
