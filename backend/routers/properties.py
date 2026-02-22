# Properties endpoints: list, buy, collect income
# Progression: buy in order; first property pays least, last pays most. Must max previous to unlock next.
from datetime import datetime, timezone
from typing import List, Optional
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
    locked: bool = False
    required_property_name: Optional[str] = None


def _property_order(properties: list) -> list:
    """Return properties in progression order (first = worst pay, last = best)."""
    by_id = {p["id"]: p for p in properties}
    ordered = []
    next_id = None
    for _ in range(len(properties) + 1):
        if next_id is None:
            for p in properties:
                if p.get("required_property_id") is None:
                    ordered.append(p)
                    next_id = p["id"]
                    break
        else:
            for p in properties:
                if p.get("required_property_id") == next_id:
                    ordered.append(p)
                    next_id = p["id"]
                    break
            else:
                break
    # Append any not in chain (e.g. legacy props)
    for p in properties:
        if p not in ordered:
            ordered.append(p)
    return ordered


async def get_properties(current_user: dict = Depends(get_current_user)):
    properties = await db.properties.find({}, {"_id": 0}).to_list(100)
    properties = _property_order(properties)
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
        required_property_id = prop.get("required_property_id")
        required_property_name = None
        locked = False
        if required_property_id:
            req_prop = next((p for p in properties if p["id"] == required_property_id), None)
            required_property_name = req_prop["name"] if req_prop else required_property_id
            req_user = properties_map.get(required_property_id)
            if not req_user or req_user["level"] < (req_prop["max_level"] if req_prop else 0):
                locked = True
        # Effective income/hr = base * level (so upgrades show increased rate)
        effective_income_per_hour = prop["income_per_hour"] * level if owned and level >= 1 else prop["income_per_hour"]
        result.append(PropertyResponse(
            id=prop["id"],
            name=prop["name"],
            property_type=prop["property_type"],
            price=prop["price"],
            income_per_hour=effective_income_per_hour,
            max_level=prop["max_level"],
            owned=owned,
            level=level,
            available_income=available_income,
            locked=locked,
            required_property_name=required_property_name,
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
        # First-time buy: must have previous property at max level
        required_property_id = prop.get("required_property_id")
        if required_property_id:
            req_prop = await db.properties.find_one({"id": required_property_id}, {"_id": 0, "name": 1, "max_level": 1})
            req_user = await db.user_properties.find_one(
                {"user_id": current_user["id"], "property_id": required_property_id},
                {"_id": 0, "level": 1}
            )
            if not req_user or req_user["level"] < (req_prop["max_level"] if req_prop else 0):
                name = req_prop["name"] if req_prop else required_property_id
                raise HTTPException(
                    status_code=403,
                    detail=f"Max out {name} (reach max level) to unlock this property.",
                )
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
    import server as srv
    get_current_user = srv.get_current_user
    _user_owns_any_casino = srv._user_owns_any_casino
    _user_owns_any_property = srv._user_owns_any_property

    async def get_my_properties(current_user: dict = Depends(get_current_user)):
        """Return current user's one casino (if any) and one property (if any). Rule: max 1 casino, max 1 property."""
        user_id = current_user["id"]
        casino = await _user_owns_any_casino(user_id)
        property_ = await _user_owns_any_property(user_id)
        return {"casino": casino, "property": property_}

    router.add_api_route("/properties", get_properties, methods=["GET"], response_model=List[PropertyResponse])
    router.add_api_route("/properties/{property_id}/buy", buy_property, methods=["POST"])
    router.add_api_route("/properties/{property_id}/collect", collect_property_income, methods=["POST"])
    router.add_api_route("/my-properties", get_my_properties, methods=["GET"])
