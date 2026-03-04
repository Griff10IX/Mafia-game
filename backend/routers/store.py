# Store endpoints: rank bar, silencer, OC timer, garage batch, booze capacity, bullets, custom car, send points
from datetime import datetime, timezone
import uuid
from pydantic import BaseModel, field_validator

from fastapi import Depends, HTTPException, Query


def _store_cost_inc(current_user: dict, points_cost: int):
    """Return (cost_used, $inc dict). Use respect points if user has enough (5× cost), else use points. Raises if insufficient."""
    cost_respect = points_cost * 5
    respect_balance = current_user.get("respect_points") or 0
    points_balance = current_user.get("points") or 0
    if respect_balance >= cost_respect:
        return cost_respect, {"respect_points": -cost_respect, "lifetime_respect_points_spent": cost_respect}
    if points_balance >= points_cost:
        return points_cost, {"points": -points_cost, "lifetime_points_spent": points_cost}
    raise HTTPException(status_code=400, detail=f"Insufficient balance. Need {points_cost} pts or {cost_respect} respect points.")

from server import (
    db,
    get_current_user,
    get_current_user_verified,
    send_notification,
    _username_pattern,
    _is_admin,
    DEFAULT_GARAGE_BATCH_LIMIT,
    GARAGE_BATCH_UPGRADE_COST,
    GARAGE_BATCH_UPGRADE_INCREMENT,
    GARAGE_BATCH_LIMIT_MAX,
)
from routers.booze_run import (
    _booze_user_capacity,
    BOOZE_CAPACITY_UPGRADE_COST,
    BOOZE_CAPACITY_UPGRADE_AMOUNT,
    BOOZE_CAPACITY_BONUS_MAX,
)

# Store-only constants
SILENCER_COST_POINTS = 150
ANTI_SNITCH_COST_POINTS = 120
OC_TIMER_COST_POINTS = 300
CREW_OC_TIMER_COST_POINTS = 350  # Family Crew OC: 6h cooldown instead of 8h
AUTO_RANK_COST_POINTS = 200  # Auto Rank: auto-commit crimes + GTAs, results to Telegram
BULLET_PACKS = {5000: 500, 10000: 1000, 50000: 5000, 100000: 10000}
CUSTOM_CAR_COST = 500
BUY_HEALTH_COST_POINTS = 15
FULL_HEALTH = 100


class CustomCarPurchase(BaseModel):
    car_name: str


class SendPointsRequest(BaseModel):
    to_username: str
    amount: int

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v):
        if v is None or v < 1:
            raise ValueError("Amount must be at least 1")
        return v


async def buy_premium_rank_bar(
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("premium_rank_bar", False):
        raise HTTPException(status_code=400, detail="You already own the premium rank bar")
    cost = 50
    cost_used, inc = _store_cost_inc(current_user, cost)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": inc, "$set": {"premium_rank_bar": True}}
    )
    return {"message": "Premium rank bar purchased!", "cost": cost_used}


async def buy_silencer(
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("has_silencer", False):
        raise HTTPException(status_code=400, detail="You already own a silencer")
    cost_used, inc = _store_cost_inc(current_user, SILENCER_COST_POINTS)
    owned = await db.user_weapons.find_one({"user_id": current_user["id"], "quantity": {"$gt": 0}}, {"_id": 0})
    if not owned:
        raise HTTPException(status_code=400, detail="You need at least one weapon to use a silencer")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": inc, "$set": {"has_silencer": True}}
    )
    return {"message": "Silencer purchased! Fewer witness statements will go out when you kill.", "cost": cost_used}


async def buy_anti_snitch(
    current_user: dict = Depends(get_current_user),
):
    """Purchase Anti Snitch: you cannot be snitched on by other players in jail."""
    if current_user.get("anti_snitch", False):
        raise HTTPException(status_code=400, detail="You already have Anti Snitch")
    cost_used, inc = _store_cost_inc(current_user, ANTI_SNITCH_COST_POINTS)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": inc, "$set": {"anti_snitch": True}},
    )
    return {"message": "Anti Snitch purchased! You cannot be snitched on.", "cost": cost_used}


async def buy_oc_timer(
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("oc_timer_reduced", False):
        raise HTTPException(status_code=400, detail="You already have the reduced OC timer (4h)")
    cost_used, inc = _store_cost_inc(current_user, OC_TIMER_COST_POINTS)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": inc, "$set": {"oc_timer_reduced": True}}
    )
    return {"message": "OC timer reduced! Heist cooldown is now 4 hours.", "cost": cost_used}


async def buy_crew_oc_timer(
    current_user: dict = Depends(get_current_user),
):
    """Crew OC (family): when you commit, cooldown is 6h instead of 8h."""
    if current_user.get("crew_oc_timer_reduced", False):
        raise HTTPException(status_code=400, detail="You already have the Crew OC timer (6h)")
    cost_used, inc = _store_cost_inc(current_user, CREW_OC_TIMER_COST_POINTS)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": inc, "$set": {"crew_oc_timer_reduced": True}}
    )
    return {"message": "Crew OC timer purchased! When you commit, family Crew OC cooldown is 6h instead of 8h.", "cost": cost_used}


async def upgrade_garage_batch_limit(
    current_user: dict = Depends(get_current_user),
):
    current_limit = current_user.get("garage_batch_limit", DEFAULT_GARAGE_BATCH_LIMIT)
    if current_limit >= GARAGE_BATCH_LIMIT_MAX:
        raise HTTPException(status_code=400, detail="Garage batch limit already maxed")
    cost_used, inc = _store_cost_inc(current_user, GARAGE_BATCH_UPGRADE_COST)
    new_limit = min(GARAGE_BATCH_LIMIT_MAX, current_limit + GARAGE_BATCH_UPGRADE_INCREMENT)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": inc, "$set": {"garage_batch_limit": new_limit}}
    )
    return {"message": f"Garage batch limit upgraded to {new_limit}", "new_limit": new_limit, "cost": cost_used}


async def buy_booze_capacity(
    current_user: dict = Depends(get_current_user),
):
    cost_used, inc = _store_cost_inc(current_user, BOOZE_CAPACITY_UPGRADE_COST)
    current_bonus = min(current_user.get("booze_capacity_bonus", 0), BOOZE_CAPACITY_BONUS_MAX)
    if current_bonus >= BOOZE_CAPACITY_BONUS_MAX:
        raise HTTPException(status_code=400, detail="Booze capacity bonus is already at the maximum (1000)")
    add_bonus = min(BOOZE_CAPACITY_UPGRADE_AMOUNT, BOOZE_CAPACITY_BONUS_MAX - current_bonus)
    inc["booze_capacity_bonus"] = add_bonus
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": inc}
    )
    new_capacity = _booze_user_capacity({**current_user, "booze_capacity_bonus": current_bonus + add_bonus})
    return {"message": f"+{add_bonus} booze capacity for {cost_used} points", "new_capacity": new_capacity, "capacity_bonus": current_bonus + add_bonus, "capacity_bonus_max": BOOZE_CAPACITY_BONUS_MAX}


async def store_buy_bullets(
    bullets: int,
    current_user: dict = Depends(get_current_user),
):
    cost = BULLET_PACKS.get(bullets)
    if cost is None:
        raise HTTPException(status_code=400, detail=f"Invalid bullet pack. Choose from: {', '.join(str(k) for k in BULLET_PACKS)}")
    cost_used, inc = _store_cost_inc(current_user, cost)
    inc["bullets"] = bullets
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": inc}
    )
    return {"message": f"Bought {bullets:,} bullets for {cost_used} points", "bullets": bullets, "cost": cost_used}


async def buy_auto_rank(
    current_user: dict = Depends(get_current_user),
):
    """Purchase Auto Rank; user enables it themselves on the Auto Rank page. Telegram is optional (for notifications)."""
    if current_user.get("auto_rank_purchased", False):
        raise HTTPException(status_code=400, detail="You already purchased Auto Rank")
    cost_used, inc = _store_cost_inc(current_user, AUTO_RANK_COST_POINTS)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": inc, "$set": {"auto_rank_purchased": True}}
    )
    return {
        "message": "Auto Rank purchased! Go to Auto Rank to enable it and choose which activities to run.",
        "cost": cost_used,
    }


async def buy_health(
    current_user: dict = Depends(get_current_user),
):
    """Restore health to 100% for 15 points (or 75 respect points)."""
    current_health = float(current_user.get("health", FULL_HEALTH))
    if current_health >= FULL_HEALTH:
        raise HTTPException(status_code=400, detail="You already have full health")
    cost_used, inc = _store_cost_inc(current_user, BUY_HEALTH_COST_POINTS)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": inc, "$set": {"health": FULL_HEALTH}}
    )
    return {"message": "Full health restored!", "health": FULL_HEALTH, "cost": cost_used}


async def buy_custom_car(
    request: CustomCarPurchase,
    current_user: dict = Depends(get_current_user),
):
    if not request.car_name or len(request.car_name) < 2 or len(request.car_name) > 30:
        raise HTTPException(status_code=400, detail="Car name must be 2-30 characters")
    cost_used, inc = _store_cost_inc(current_user, CUSTOM_CAR_COST)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": inc}
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
        f"You've purchased a custom car named '{request.car_name}' for {cost_used} points!",
        "reward"
    )
    return {"message": f"Custom car '{request.car_name}' purchased for {cost_used} points"}


async def send_points(request: SendPointsRequest, current_user: dict = Depends(get_current_user_verified)):
    """Send points to another player. Logged in points_transfers (last 10 visible to user, 500 to admin)."""
    to_username = (request.to_username or "").strip()
    if not to_username or len(to_username) < 2:
        raise HTTPException(status_code=400, detail="Enter a valid username")
    amount = int(request.amount)
    if amount < 1:
        raise HTTPException(status_code=400, detail="Amount must be at least 1")
    sender_id = current_user["id"]
    sender_username = (current_user.get("username") or "").strip() or "?"
    my_points = int(current_user.get("points") or 0)
    if my_points < amount:
        raise HTTPException(status_code=400, detail=f"Insufficient points (have {my_points:,})")
    pattern = _username_pattern(to_username)
    recipient = await db.users.find_one({"username": pattern}, {"_id": 0, "id": 1, "username": 1})
    if not recipient:
        raise HTTPException(status_code=404, detail="User not found")
    if recipient["id"] == sender_id:
        raise HTTPException(status_code=400, detail="You cannot send points to yourself")
    recipient_username = (recipient.get("username") or "").strip() or "?"
    now = datetime.now(timezone.utc).isoformat()
    transfer_id = str(uuid.uuid4())
    await db.points_transfers.insert_one({
        "id": transfer_id,
        "from_user_id": sender_id,
        "from_username": sender_username,
        "to_user_id": recipient["id"],
        "to_username": recipient_username,
        "amount": amount,
        "created_at": now,
    })
    await db.users.update_one({"id": sender_id}, {"$inc": {"points": -amount}})
    await db.users.update_one({"id": recipient["id"]}, {"$inc": {"points": amount}})
    await send_notification(
        recipient["id"],
        "Points received",
        f"{sender_username} sent you {amount:,} points.",
        "reward",
    )
    return {
        "message": f"Sent {amount:,} points to {recipient_username}",
        "transfer_id": transfer_id,
        "amount": amount,
        "to_username": recipient_username,
    }


async def get_my_points_transfers(current_user: dict = Depends(get_current_user)):
    """Last 10 points transfers where current user is sender or recipient."""
    uid = current_user["id"]
    cursor = db.points_transfers.find(
        {"$or": [{"from_user_id": uid}, {"to_user_id": uid}]},
        {"_id": 0, "id": 1, "from_user_id": 1, "from_username": 1, "to_user_id": 1, "to_username": 1, "amount": 1, "created_at": 1},
    ).sort("created_at", -1).limit(10)
    items = await cursor.to_list(10)
    return {"transfers": items}


async def admin_points_transfers(
    limit: int = Query(500, ge=1, le=1000),
    current_user: dict = Depends(get_current_user),
):
    """Admin: last N points transfers (default 500)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    cursor = db.points_transfers.find(
        {},
        {"_id": 0, "id": 1, "from_user_id": 1, "from_username": 1, "to_user_id": 1, "to_username": 1, "amount": 1, "created_at": 1},
    ).sort("created_at", -1).limit(limit)
    items = await cursor.to_list(limit)
    return {"transfers": items, "count": len(items)}


def register(router):
    router.add_api_route("/store/buy-rank-bar", buy_premium_rank_bar, methods=["POST"])
    router.add_api_route("/store/buy-auto-rank", buy_auto_rank, methods=["POST"])
    router.add_api_route("/store/buy-silencer", buy_silencer, methods=["POST"])
    router.add_api_route("/store/buy-anti-snitch", buy_anti_snitch, methods=["POST"])
    router.add_api_route("/store/buy-oc-timer", buy_oc_timer, methods=["POST"])
    router.add_api_route("/store/buy-crew-oc-timer", buy_crew_oc_timer, methods=["POST"])
    router.add_api_route("/store/upgrade-garage-batch", upgrade_garage_batch_limit, methods=["POST"])
    router.add_api_route("/store/buy-booze-capacity", buy_booze_capacity, methods=["POST"])
    router.add_api_route("/store/buy-bullets", store_buy_bullets, methods=["POST"])
    router.add_api_route("/store/buy-health", buy_health, methods=["POST"])
    router.add_api_route("/store/buy-custom-car", buy_custom_car, methods=["POST"])
    router.add_api_route("/store/send-points", send_points, methods=["POST"])
    router.add_api_route("/store/points-transfers", get_my_points_transfers, methods=["GET"])
    router.add_api_route("/store/points-transfers/admin", admin_points_transfers, methods=["GET"])
