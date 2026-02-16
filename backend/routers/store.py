# Store endpoints: rank bar, silencer, OC timer, garage batch, booze capacity, bullets, custom car
from datetime import datetime, timezone
import uuid
from pydantic import BaseModel

from fastapi import Depends, HTTPException

from server import (
    db,
    get_current_user,
    send_notification,
    _booze_user_capacity,
    DEFAULT_GARAGE_BATCH_LIMIT,
    GARAGE_BATCH_UPGRADE_COST,
    GARAGE_BATCH_UPGRADE_INCREMENT,
    GARAGE_BATCH_LIMIT_MAX,
    BOOZE_CAPACITY_UPGRADE_COST,
    BOOZE_CAPACITY_UPGRADE_AMOUNT,
    BOOZE_CAPACITY_BONUS_MAX,
)

# Store-only constants
SILENCER_COST_POINTS = 150
OC_TIMER_COST_POINTS = 300
CREW_OC_TIMER_COST_POINTS = 350  # Family Crew OC: 6h cooldown instead of 8h
BULLET_PACKS = {5000: 500, 10000: 1000, 50000: 5000, 100000: 10000}
CUSTOM_CAR_COST = 500


class CustomCarPurchase(BaseModel):
    car_name: str


async def buy_premium_rank_bar(current_user: dict = Depends(get_current_user)):
    if current_user.get("premium_rank_bar", False):
        raise HTTPException(status_code=400, detail="You already own the premium rank bar")
    cost = 50
    if current_user["points"] < cost:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -cost}, "$set": {"premium_rank_bar": True}}
    )
    return {"message": "Premium rank bar purchased!", "cost": cost}


async def buy_silencer(current_user: dict = Depends(get_current_user)):
    if current_user.get("has_silencer", False):
        raise HTTPException(status_code=400, detail="You already own a silencer")
    if (current_user.get("points") or 0) < SILENCER_COST_POINTS:
        raise HTTPException(status_code=400, detail=f"Insufficient points (need {SILENCER_COST_POINTS})")
    owned = await db.user_weapons.find_one({"user_id": current_user["id"], "quantity": {"$gt": 0}}, {"_id": 0})
    if not owned:
        raise HTTPException(status_code=400, detail="You need at least one weapon to use a silencer")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -SILENCER_COST_POINTS}, "$set": {"has_silencer": True}}
    )
    return {"message": "Silencer purchased! Fewer witness statements will go out when you kill.", "cost": SILENCER_COST_POINTS}


async def buy_oc_timer(current_user: dict = Depends(get_current_user)):
    if current_user.get("oc_timer_reduced", False):
        raise HTTPException(status_code=400, detail="You already have the reduced OC timer (4h)")
    if (current_user.get("points") or 0) < OC_TIMER_COST_POINTS:
        raise HTTPException(status_code=400, detail=f"Insufficient points (need {OC_TIMER_COST_POINTS})")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -OC_TIMER_COST_POINTS}, "$set": {"oc_timer_reduced": True}}
    )
    return {"message": "OC timer reduced! Heist cooldown is now 4 hours.", "cost": OC_TIMER_COST_POINTS}


async def buy_crew_oc_timer(current_user: dict = Depends(get_current_user)):
    """Crew OC (family): when you commit, cooldown is 6h instead of 8h."""
    if current_user.get("crew_oc_timer_reduced", False):
        raise HTTPException(status_code=400, detail="You already have the Crew OC timer (6h)")
    if (current_user.get("points") or 0) < CREW_OC_TIMER_COST_POINTS:
        raise HTTPException(status_code=400, detail=f"Insufficient points (need {CREW_OC_TIMER_COST_POINTS})")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -CREW_OC_TIMER_COST_POINTS}, "$set": {"crew_oc_timer_reduced": True}}
    )
    return {"message": "Crew OC timer purchased! When you commit, family Crew OC cooldown is 6h instead of 8h.", "cost": CREW_OC_TIMER_COST_POINTS}


async def upgrade_garage_batch_limit(current_user: dict = Depends(get_current_user)):
    current_limit = current_user.get("garage_batch_limit", DEFAULT_GARAGE_BATCH_LIMIT)
    if current_limit >= GARAGE_BATCH_LIMIT_MAX:
        raise HTTPException(status_code=400, detail="Garage batch limit already maxed")
    if current_user["points"] < GARAGE_BATCH_UPGRADE_COST:
        raise HTTPException(status_code=400, detail="Insufficient points")
    new_limit = min(GARAGE_BATCH_LIMIT_MAX, current_limit + GARAGE_BATCH_UPGRADE_INCREMENT)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -GARAGE_BATCH_UPGRADE_COST}, "$set": {"garage_batch_limit": new_limit}}
    )
    return {"message": f"Garage batch limit upgraded to {new_limit}", "new_limit": new_limit, "cost": GARAGE_BATCH_UPGRADE_COST}


async def buy_booze_capacity(current_user: dict = Depends(get_current_user)):
    if current_user["points"] < BOOZE_CAPACITY_UPGRADE_COST:
        raise HTTPException(status_code=400, detail="Insufficient points")
    current_bonus = min(current_user.get("booze_capacity_bonus", 0), BOOZE_CAPACITY_BONUS_MAX)
    if current_bonus >= BOOZE_CAPACITY_BONUS_MAX:
        raise HTTPException(status_code=400, detail="Booze capacity bonus is already at the maximum (1000)")
    add_bonus = min(BOOZE_CAPACITY_UPGRADE_AMOUNT, BOOZE_CAPACITY_BONUS_MAX - current_bonus)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -BOOZE_CAPACITY_UPGRADE_COST, "booze_capacity_bonus": add_bonus}}
    )
    new_capacity = _booze_user_capacity({**current_user, "booze_capacity_bonus": current_bonus + add_bonus})
    return {"message": f"+{add_bonus} booze capacity for {BOOZE_CAPACITY_UPGRADE_COST} points", "new_capacity": new_capacity, "capacity_bonus": current_bonus + add_bonus, "capacity_bonus_max": BOOZE_CAPACITY_BONUS_MAX}


async def store_buy_bullets(bullets: int, current_user: dict = Depends(get_current_user)):
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


async def buy_custom_car(request: CustomCarPurchase, current_user: dict = Depends(get_current_user)):
    if current_user["points"] < CUSTOM_CAR_COST:
        raise HTTPException(status_code=400, detail="Insufficient points")
    if not request.car_name or len(request.car_name) < 2 or len(request.car_name) > 30:
        raise HTTPException(status_code=400, detail="Car name must be 2-30 characters")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -CUSTOM_CAR_COST}}
    )
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"custom_car_name": request.car_name}}
    )
    await db.user_cars.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "car_id": "car_custom",
        "custom_name": request.car_name,
        "custom_image_url": None,
        "acquired_at": datetime.now(timezone.utc).isoformat(),
    })
    await send_notification(
        current_user["id"],
        "🚗 Custom Car Purchased",
        f"You've purchased a custom car named '{request.car_name}' for {CUSTOM_CAR_COST} points!",
        "reward"
    )
    return {"message": f"Custom car '{request.car_name}' purchased for {CUSTOM_CAR_COST} points"}


def register(router):
    router.add_api_route("/store/buy-rank-bar", buy_premium_rank_bar, methods=["POST"])
    router.add_api_route("/store/buy-silencer", buy_silencer, methods=["POST"])
    router.add_api_route("/store/buy-oc-timer", buy_oc_timer, methods=["POST"])
    router.add_api_route("/store/buy-crew-oc-timer", buy_crew_oc_timer, methods=["POST"])
    router.add_api_route("/store/upgrade-garage-batch", upgrade_garage_batch_limit, methods=["POST"])
    router.add_api_route("/store/buy-booze-capacity", buy_booze_capacity, methods=["POST"])
    router.add_api_route("/store/buy-bullets", store_buy_bullets, methods=["POST"])
    router.add_api_route("/store/buy-custom-car", buy_custom_car, methods=["POST"])
