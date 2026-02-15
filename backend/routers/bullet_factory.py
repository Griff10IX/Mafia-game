# Bullet Factory: one global factory, produces 3000 bullets/hour for owner. Others buy at owner's price; owner gets profit.
from datetime import datetime, timezone, timedelta
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import Depends, HTTPException
from pydantic import BaseModel
from server import db, get_current_user

BULLET_FACTORY_PRODUCTION_PER_HOUR = 3000
BULLET_FACTORY_MAX_HOURS_CAP = 24  # cap accumulated at 24h of production
BULLET_FACTORY_CLAIM_COST = 5_000_000  # $5M to claim (like claiming a casino)
BULLET_FACTORY_PRICE_MIN = 1
BULLET_FACTORY_PRICE_MAX = 100_000  # max $ per bullet


async def _get_or_create_factory():
    doc = await db.bullet_factory.find_one({}, {"_id": 0})
    if doc:
        return doc
    await db.bullet_factory.insert_one({
        "owner_id": None,
        "last_collected_at": None,
        "price_per_bullet": None,  # set by owner later
    })
    return await db.bullet_factory.find_one({}, {"_id": 0})


def _accumulated_bullets(factory: dict) -> int:
    if not factory.get("owner_id") or not factory.get("last_collected_at"):
        return 0
    try:
        last = datetime.fromisoformat(factory["last_collected_at"].replace("Z", "+00:00"))
    except Exception:
        return 0
    now = datetime.now(timezone.utc)
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    hours = (now - last).total_seconds() / 3600
    raw = int(hours * BULLET_FACTORY_PRODUCTION_PER_HOUR)
    cap = BULLET_FACTORY_PRODUCTION_PER_HOUR * BULLET_FACTORY_MAX_HOURS_CAP
    return min(raw, cap)


async def get_bullet_factory(current_user: dict = Depends(get_current_user)):
    """Status: production rate, owner, accumulated bullets, can_collect."""
    factory = await _get_or_create_factory()
    owner_id = factory.get("owner_id")
    owner_username = None
    if owner_id:
        user = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1})
        owner_username = user.get("username") if user else "?"
    accumulated = _accumulated_bullets(factory)
    is_owner = current_user["id"] == owner_id
    price = factory.get("price_per_bullet")
    can_buy = hasOwner and price is not None and price >= BULLET_FACTORY_PRICE_MIN and not is_owner and accumulated > 0
    return {
        "production_per_hour": BULLET_FACTORY_PRODUCTION_PER_HOUR,
        "claim_cost": BULLET_FACTORY_CLAIM_COST,
        "owner_id": owner_id,
        "owner_username": owner_username,
        "accumulated_bullets": accumulated,
        "can_collect": is_owner and accumulated > 0,
        "can_buy": can_buy,
        "price_per_bullet": price,
        "price_min": BULLET_FACTORY_PRICE_MIN,
        "price_max": BULLET_FACTORY_PRICE_MAX,
        "last_collected_at": factory.get("last_collected_at"),
        "is_owner": is_owner,
    }


async def claim_bullet_factory(current_user: dict = Depends(get_current_user)):
    """Pay to become the bullet factory owner (like claiming a casino)."""
    factory = await _get_or_create_factory()
    if factory.get("owner_id"):
        raise HTTPException(status_code=400, detail="Bullet factory already has an owner")
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
        {},
        {"$set": {"owner_id": current_user["id"], "last_collected_at": now}},
    )
    return {
        "message": "You now own the Bullet Factory. It produces 3,000 bullets per hour.",
        "owner_id": current_user["id"],
    }


async def collect_bullets(current_user: dict = Depends(get_current_user)):
    """Owner collects accumulated bullets."""
    factory = await _get_or_create_factory()
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the bullet factory")
    accumulated = _accumulated_bullets(factory)
    if accumulated <= 0:
        raise HTTPException(status_code=400, detail="No bullets to collect yet")
    now = datetime.now(timezone.utc).isoformat()
    await db.bullet_factory.update_one(
        {},
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


class SetPriceRequest(BaseModel):
    price_per_bullet: int


class BuyBulletsRequest(BaseModel):
    amount: int


async def set_price(
    request: SetPriceRequest,
    current_user: dict = Depends(get_current_user),
):
    """Owner sets the price per bullet (other players buy at this price; owner gets the profit)."""
    factory = await _get_or_create_factory()
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the bullet factory")
    price = request.price_per_bullet
    if price < BULLET_FACTORY_PRICE_MIN or price > BULLET_FACTORY_PRICE_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"Price must be between ${BULLET_FACTORY_PRICE_MIN} and ${BULLET_FACTORY_PRICE_MAX} per bullet",
        )
    await db.bullet_factory.update_one(
        {},
        {"$set": {"price_per_bullet": price}},
    )
    return {"message": f"Price set to ${price:,} per bullet", "price_per_bullet": price}


async def buy_bullets(
    request: BuyBulletsRequest,
    current_user: dict = Depends(get_current_user),
):
    """Buy bullets from the factory at the owner's price; owner receives the payment."""
    factory = await _get_or_create_factory()
    owner_id = factory.get("owner_id")
    if not owner_id:
        raise HTTPException(status_code=400, detail="Bullet factory has no owner")
    if owner_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Owner collects for free; use Collect instead")
    price = factory.get("price_per_bullet")
    if price is None or price < BULLET_FACTORY_PRICE_MIN:
        raise HTTPException(status_code=400, detail="Owner has not set a price yet")
    amount = request.amount
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    accumulated = _accumulated_bullets(factory)
    if amount > accumulated:
        raise HTTPException(
            status_code=400,
            detail=f"Factory only has {accumulated:,} bullets available",
        )
    total_cost = amount * price
    buyer_money = int(current_user.get("money") or 0)
    if buyer_money < total_cost:
        raise HTTPException(
            status_code=400,
            detail=f"You need ${total_cost:,} (${price:,} × {amount:,})",
        )
    # Advance last_collected_at so "accumulated" drops by amount (production continues from same clock)
    try:
        last = datetime.fromisoformat(factory["last_collected_at"].replace("Z", "+00:00"))
    except Exception:
        last = datetime.now(timezone.utc)
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    hours_consumed = amount / BULLET_FACTORY_PRODUCTION_PER_HOUR
    new_last = last + timedelta(seconds=hours_consumed * 3600)
    await db.bullet_factory.update_one(
        {},
        {"$set": {"last_collected_at": new_last.isoformat()}},
    )
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": -total_cost, "bullets": amount}},
    )
    await db.users.update_one(
        {"id": owner_id},
        {"$inc": {"money": total_cost}},
    )
    return {
        "message": f"Bought {amount:,} bullets for ${total_cost:,}",
        "amount": amount,
        "total_paid": total_cost,
        "new_bullets": (current_user.get("bullets") or 0) + amount,
    }


def register(router):
    router.add_api_route("/bullet-factory", get_bullet_factory, methods=["GET"])
    router.add_api_route("/bullet-factory/claim", claim_bullet_factory, methods=["POST"])
    router.add_api_route("/bullet-factory/collect", collect_bullets, methods=["POST"])
    router.add_api_route("/bullet-factory/set-price", set_price, methods=["POST"])
    router.add_api_route("/bullet-factory/buy", buy_bullets, methods=["POST"])
