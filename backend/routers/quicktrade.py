# Quick Trade: sell/buy points (with fee, hide_name limits), property listings and purchase
from datetime import datetime, timezone
from typing import Optional
import time
from pydantic import BaseModel

from fastapi import Depends, HTTPException
from bson.objectid import ObjectId

from server import db, get_current_user, get_rank_info, CAPO_RANK_ID, _user_owns_any_property

# Cache for list endpoints (short TTL; invalidate on any mutation)
_sell_offers_cache: Optional[tuple] = None
_sell_offers_ts: float = 0
_buy_offers_cache: Optional[tuple] = None
_buy_offers_ts: float = 0
_properties_cache: Optional[tuple] = None
_properties_ts: float = 0
_LIST_TTL_SEC = 5


def _invalidate_trade_caches():
    global _sell_offers_cache, _sell_offers_ts, _buy_offers_cache, _buy_offers_ts, _properties_cache, _properties_ts
    _sell_offers_cache = None
    _sell_offers_ts = 0
    _buy_offers_cache = None
    _buy_offers_ts = 0
    _properties_cache = None
    _properties_ts = 0


class CreateSellOffer(BaseModel):
    points: int
    cost: int
    hide_name: bool = False


class CreateBuyOffer(BaseModel):
    points: int
    offer: int
    hide_name: bool = False


# ----- Sell offers -----
async def get_sell_offers(current_user: dict = Depends(get_current_user)):
    global _sell_offers_cache, _sell_offers_ts
    now = time.monotonic()
    if _sell_offers_cache is not None and now <= _sell_offers_ts + _LIST_TTL_SEC:
        payload = _sell_offers_cache
        # Recompute is_own per user
        return [{**o, "is_own": o["user_id"] == current_user["id"]} for o in payload]
    try:
        offers = await db.trade_sell_offers.find({"status": "active"}).sort("created_at", -1).to_list(length=100)
        result = []
        for offer in offers:
            result.append({
                "id": str(offer["_id"]),
                "username": offer.get("username", "Anonymous") if not offer.get("hide_name") else "[Anonymous]",
                "user_id": offer["user_id"],
                "points": offer["points"],
                "money": offer["cost"],
                "hide_name": offer.get("hide_name", False),
                "created_at": offer.get("created_at"),
                "is_own": offer["user_id"] == current_user["id"]
            })
        _sell_offers_cache = result
        _sell_offers_ts = now
        return result
    except Exception as e:
        print(f"Error fetching sell offers: {e}")
        return []


async def create_sell_offer(offer: CreateSellOffer, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    username = current_user.get("username", "Unknown")
    if offer.points <= 0 or offer.cost <= 0:
        raise HTTPException(status_code=400, detail="Points and cost must be positive")
    active_offers = await db.trade_sell_offers.count_documents({"user_id": user_id, "status": "active"})
    if offer.hide_name:
        hidden_count = await db.trade_sell_offers.count_documents({"user_id": user_id, "status": "active", "hide_name": True})
        if hidden_count >= 5:
            raise HTTPException(status_code=400, detail="Maximum 5 hidden offers allowed")
    else:
        non_hidden_count = await db.trade_sell_offers.count_documents({"user_id": user_id, "status": "active", "hide_name": False})
        if non_hidden_count >= 10:
            raise HTTPException(status_code=400, detail="Maximum 10 regular offers allowed")
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("points", 0) < offer.points:
        raise HTTPException(status_code=400, detail="Insufficient points")
    fee = max(1, int(offer.points * 0.005))
    points_after_fee = offer.points - fee
    await db.users.update_one({"id": user_id}, {"$inc": {"points": -offer.points}})
    new_offer = {
        "user_id": user_id,
        "username": username,
        "points": points_after_fee,
        "original_points": offer.points,
        "fee": fee,
        "cost": offer.cost,
        "hide_name": offer.hide_name,
        "status": "active",
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.trade_sell_offers.insert_one(new_offer)
    _invalidate_trade_caches()
    return {"message": f"Sell offer created! ({points_after_fee} points after {fee} point fee)", "offer_id": str(result.inserted_id)}


async def accept_sell_offer(offer_id: str, current_user: dict = Depends(get_current_user)):
    buyer_id = current_user["id"]
    buyer_username = current_user.get("username", "Unknown")
    offer = await db.trade_sell_offers.find_one({"_id": ObjectId(offer_id), "status": "active"})
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already completed")
    if offer["user_id"] == buyer_id:
        raise HTTPException(status_code=400, detail="Cannot accept your own offer")
    buyer = await db.users.find_one({"id": buyer_id})
    if not buyer or buyer.get("cash", 0) < offer["cost"]:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    await db.users.update_one({"id": buyer_id}, {"$inc": {"cash": -offer["cost"], "points": offer["points"]}})
    await db.users.update_one({"id": offer["user_id"]}, {"$inc": {"cash": offer["cost"]}})
    await db.trade_sell_offers.update_one(
        {"_id": ObjectId(offer_id)},
        {"$set": {"status": "completed", "buyer_id": buyer_id, "buyer_username": buyer_username, "completed_at": datetime.now(timezone.utc)}}
    )
    _invalidate_trade_caches()
    return {"message": "Trade completed successfully", "points_received": offer["points"], "cost_paid": offer["cost"]}


async def cancel_sell_offer_delete(offer_id: str, current_user: dict = Depends(get_current_user)):
    """Cancel sell offer (DELETE) – refund points + fee."""
    user_id = current_user["id"]
    offer = await db.trade_sell_offers.find_one({"_id": ObjectId(offer_id), "user_id": user_id, "status": "active"})
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already completed")
    refund_amount = offer.get("original_points", offer["points"])
    await db.users.update_one({"id": user_id}, {"$inc": {"points": refund_amount}})
    await db.trade_sell_offers.update_one(
        {"_id": ObjectId(offer_id)},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)}}
    )
    _invalidate_trade_caches()
    return {"message": f"Offer cancelled. {refund_amount} points refunded (including {offer.get('fee', 0)} point fee)"}


async def cancel_sell_offer_post(offer_id: str, current_user: dict = Depends(get_current_user)):
    """Cancel sell offer (POST /cancel) – refund points + fee."""
    user_id = current_user["id"]
    offer = await db.trade_sell_offers.find_one({"_id": ObjectId(offer_id), "status": "active"})
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already completed")
    if offer["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="You can only cancel your own offers")
    original_points = offer.get("original_points", offer["points"])
    await db.users.update_one({"id": user_id}, {"$inc": {"points": original_points}})
    await db.trade_sell_offers.update_one(
        {"_id": ObjectId(offer_id)},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)}}
    )
    _invalidate_trade_caches()
    return {"message": f"Offer cancelled. {original_points} points refunded (including fee)"}


# ----- Buy offers -----
async def get_buy_offers(current_user: dict = Depends(get_current_user)):
    global _buy_offers_cache, _buy_offers_ts
    now = time.monotonic()
    if _buy_offers_cache is not None and now <= _buy_offers_ts + _LIST_TTL_SEC:
        payload = _buy_offers_cache
        return [{**o, "is_own": o["user_id"] == current_user["id"]} for o in payload]
    try:
        offers = await db.trade_buy_offers.find({"status": "active"}).sort("created_at", -1).to_list(length=100)
        result = []
        for offer in offers:
            result.append({
                "id": str(offer["_id"]),
                "username": offer.get("username", "Anonymous") if not offer.get("hide_name") else "[Anonymous]",
                "user_id": offer["user_id"],
                "points": offer["points"],
                "cost": offer["offer"],
                "hide_name": offer.get("hide_name", False),
                "created_at": offer.get("created_at"),
                "is_own": offer["user_id"] == current_user["id"]
            })
        _buy_offers_cache = result
        _buy_offers_ts = now
        return result
    except Exception as e:
        print(f"Error fetching buy offers: {e}")
        return []


async def create_buy_offer(offer: CreateBuyOffer, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    username = current_user.get("username", "Unknown")
    if offer.points <= 0 or offer.offer <= 0:
        raise HTTPException(status_code=400, detail="Points and offer must be positive")
    if offer.hide_name:
        hidden_count = await db.trade_buy_offers.count_documents({"user_id": user_id, "status": "active", "hide_name": True})
        if hidden_count >= 5:
            raise HTTPException(status_code=400, detail="Maximum 5 hidden offers allowed")
    else:
        non_hidden_count = await db.trade_buy_offers.count_documents({"user_id": user_id, "status": "active", "hide_name": False})
        if non_hidden_count >= 10:
            raise HTTPException(status_code=400, detail="Maximum 10 regular offers allowed")
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("cash", 0) < offer.offer:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    fee = max(1, int(offer.points * 0.005))
    points_after_fee = offer.points - fee
    await db.users.update_one({"id": user_id}, {"$inc": {"cash": -offer.offer}})
    new_offer = {
        "user_id": user_id,
        "username": username,
        "points": points_after_fee,
        "original_points": offer.points,
        "fee": fee,
        "offer": offer.offer,
        "hide_name": offer.hide_name,
        "status": "active",
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.trade_buy_offers.insert_one(new_offer)
    _invalidate_trade_caches()
    return {"message": f"Buy offer created! ({points_after_fee} points after {fee} point fee)", "offer_id": str(result.inserted_id)}


async def accept_buy_offer(offer_id: str, current_user: dict = Depends(get_current_user)):
    seller_id = current_user["id"]
    seller_username = current_user.get("username", "Unknown")
    offer = await db.trade_buy_offers.find_one({"_id": ObjectId(offer_id), "status": "active"})
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already completed")
    if offer["user_id"] == seller_id:
        raise HTTPException(status_code=400, detail="Cannot accept your own offer")
    seller = await db.users.find_one({"id": seller_id})
    if not seller or seller.get("points", 0) < offer["points"]:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await db.users.update_one({"id": seller_id}, {"$inc": {"points": -offer["points"], "cash": offer["offer"]}})
    await db.users.update_one({"id": offer["user_id"]}, {"$inc": {"points": offer["points"]}})
    await db.trade_buy_offers.update_one(
        {"_id": ObjectId(offer_id)},
        {"$set": {"status": "completed", "seller_id": seller_id, "seller_username": seller_username, "completed_at": datetime.now(timezone.utc)}}
    )
    _invalidate_trade_caches()
    return {"message": "Trade completed successfully", "points_sold": offer["points"], "cash_received": offer["offer"]}


async def cancel_buy_offer_delete(offer_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    offer = await db.trade_buy_offers.find_one({"_id": ObjectId(offer_id), "user_id": user_id, "status": "active"})
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already completed")
    await db.users.update_one({"id": user_id}, {"$inc": {"cash": offer["offer"]}})
    await db.trade_buy_offers.update_one(
        {"_id": ObjectId(offer_id)},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)}}
    )
    _invalidate_trade_caches()
    return {"message": f"Offer cancelled. ${offer['offer']:,} refunded"}


async def cancel_buy_offer_post(offer_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    offer = await db.trade_buy_offers.find_one({"_id": ObjectId(offer_id), "status": "active"})
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already completed")
    if offer["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="You can only cancel your own offers")
    await db.users.update_one({"id": user_id}, {"$inc": {"cash": offer["offer"]}})
    await db.trade_buy_offers.update_one(
        {"_id": ObjectId(offer_id)},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)}}
    )
    _invalidate_trade_caches()
    return {"message": f"Offer cancelled. ${offer['offer']:,} refunded"}


# ----- Properties -----
async def get_properties_for_sale(current_user: dict = Depends(get_current_user)):
    global _properties_cache, _properties_ts
    now = time.monotonic()
    if _properties_cache is not None and now <= _properties_ts + _LIST_TTL_SEC:
        return _properties_cache
    try:
        properties = await db.properties.find({"for_sale": True}).sort("created_at", -1).to_list(length=100)
        result = []
        for prop in properties:
            result.append({
                "id": str(prop["_id"]),
                "location": prop.get("location", "Unknown"),
                "property_name": prop.get("name", "Property"),
                "owner": prop.get("owner_username", "Unknown"),
                "owner_id": str(prop.get("owner_id", "")),
                "points": prop.get("sale_price", 0),
                "created_at": prop.get("created_at")
            })
        _properties_cache = result
        _properties_ts = now
        return result
    except Exception as e:
        print(f"Error fetching properties: {e}")
        return []


async def buy_property(property_id: str, current_user: dict = Depends(get_current_user)):
    buyer_id = current_user["id"]
    buyer_username = current_user.get("username", "Unknown")
    prop = await db.properties.find_one({"_id": ObjectId(property_id), "for_sale": True})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found or not for sale")
    if prop.get("owner_id") == buyer_id:
        raise HTTPException(status_code=400, detail="Cannot buy your own property")
    prop_type = prop.get("type") or ""
    if prop_type.startswith("casino_") or prop_type == "airport":
        rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
        if rank_id < CAPO_RANK_ID:
            raise HTTPException(status_code=403, detail="You must be rank Capo or higher to buy a casino or property. Reach Capo to hold one.")
    buyer = await db.users.find_one({"id": buyer_id})
    if not buyer:
        raise HTTPException(status_code=404, detail="User not found")
    sale_price = prop.get("sale_price", 0)
    if buyer.get("points", 0) < sale_price:
        raise HTTPException(status_code=400, detail="Insufficient points")
    if prop.get("type") == "airport":
        owned = await _user_owns_any_property(buyer_id)
        if owned:
            raise HTTPException(status_code=400, detail="You may only own one property. Relinquish it first.")
    await db.users.update_one({"id": buyer_id}, {"$inc": {"points": -sale_price}})
    if prop.get("owner_id"):
        await db.users.update_one({"id": prop["owner_id"]}, {"$inc": {"points": sale_price}})
    prop_type = prop.get("type")
    if prop_type == "casino_dice":
        city = prop.get("location")
        if city:
            await db.dice_ownership.update_one(
                {"city": city},
                {"$set": {"owner_id": buyer_id, "owner_username": buyer_username}},
                upsert=True
            )
    elif prop_type == "casino_rlt":
        city = prop.get("location")
        if city:
            await db.roulette_ownership.update_one(
                {"city": city},
                {"$set": {"owner_id": buyer_id, "owner_username": buyer_username}},
                upsert=True
            )
    elif prop_type == "casino_blackjack":
        city = prop.get("location")
        if city:
            await db.blackjack_ownership.update_one(
                {"city": city},
                {"$set": {"owner_id": buyer_id, "owner_username": buyer_username}},
                upsert=True
            )
    elif prop_type == "casino_horseracing":
        city = prop.get("location")
        if city:
            await db.horseracing_ownership.update_one(
                {"city": city},
                {"$set": {"owner_id": buyer_id, "owner_username": buyer_username}},
                upsert=True
            )
    elif prop_type == "casino_videopoker":
        city = prop.get("location")
        if city:
            await db.videopoker_ownership.update_one(
                {"city": city},
                {"$set": {"owner_id": buyer_id, "owner_username": buyer_username}},
                upsert=True
            )
    elif prop_type == "airport":
        state = prop.get("state")
        slot = prop.get("slot")
        if state is not None and slot is not None:
            await db.airport_ownership.update_one(
                {"state": state, "slot": slot},
                {"$set": {"owner_id": buyer_id, "owner_username": buyer_username, "total_earnings": 0}},
                upsert=True
            )
    await db.properties.delete_one({"_id": ObjectId(property_id)})
    _invalidate_trade_caches()
    return {"message": "Property purchased successfully", "property_name": prop.get("name", "Property"), "points_spent": sale_price}


def register(router):
    router.add_api_route("/trade/sell-offers", get_sell_offers, methods=["GET"])
    router.add_api_route("/trade/buy-offers", get_buy_offers, methods=["GET"])
    router.add_api_route("/trade/sell-offer", create_sell_offer, methods=["POST"])
    router.add_api_route("/trade/buy-offer", create_buy_offer, methods=["POST"])
    router.add_api_route("/trade/sell-offer/{offer_id}/accept", accept_sell_offer, methods=["POST"])
    router.add_api_route("/trade/buy-offer/{offer_id}/accept", accept_buy_offer, methods=["POST"])
    router.add_api_route("/trade/sell-offer/{offer_id}", cancel_sell_offer_delete, methods=["DELETE"])
    router.add_api_route("/trade/buy-offer/{offer_id}", cancel_buy_offer_delete, methods=["DELETE"])
    router.add_api_route("/trade/properties", get_properties_for_sale, methods=["GET"])
    router.add_api_route("/trade/property/{property_id}/accept", buy_property, methods=["POST"])
    router.add_api_route("/trade/sell-offer/{offer_id}/cancel", cancel_sell_offer_post, methods=["POST"])
    router.add_api_route("/trade/buy-offer/{offer_id}/cancel", cancel_buy_offer_post, methods=["POST"])
