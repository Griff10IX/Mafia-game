# Quick Trade: sell/buy points (with fee, hide_name limits), property listings and purchase
from datetime import datetime, timezone
from typing import Optional
import time
from pydantic import BaseModel

from fastapi import Depends, HTTPException
from bson.objectid import ObjectId

from server import db, get_current_user, get_rank_info, log_activity, CAPO_RANK_ID, _user_owns_any_property
from routers.kill.armoury import TOKEN_CONFIG, TOKEN_TYPES

# Cache for list endpoints (short TTL; invalidate on any mutation)
_sell_offers_cache: Optional[tuple] = None
_sell_offers_ts: float = 0
_buy_offers_cache: Optional[tuple] = None
_buy_offers_ts: float = 0
_token_offers_cache: Optional[tuple] = None
_token_offers_ts: float = 0
_properties_cache: Optional[tuple] = None
_properties_ts: float = 0
_LIST_TTL_SEC = 5


def _invalidate_trade_caches():
    global _sell_offers_cache, _sell_offers_ts, _buy_offers_cache, _buy_offers_ts, _token_offers_cache, _token_offers_ts, _properties_cache, _properties_ts
    _sell_offers_cache = None
    _sell_offers_ts = 0
    _buy_offers_cache = None
    _buy_offers_ts = 0
    _token_offers_cache = None
    _token_offers_ts = 0
    _properties_cache = None
    _properties_ts = 0


async def cancel_offers_on_death(user_id: str):
    """
    When a user dies: cancel all their active sell, buy, and token offers.
    No refunds — points (sell), money (buy), and tokens (token offers) are removed from the game economy.
    """
    now = datetime.now(timezone.utc)
    await db.trade_sell_offers.update_many(
        {"user_id": user_id, "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": now}},
    )
    await db.trade_buy_offers.update_many(
        {"user_id": user_id, "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": now}},
    )
    token_offers = await db.trade_token_offers.find({"user_id": user_id, "status": "active"}).to_list(100)
    for offer in token_offers:
        field = TOKEN_CONFIG.get(offer["token_type"], {}).get("count_field")
        if field:
            await db.users.update_one({"id": user_id}, {"$inc": {field: offer["quantity"]}})
    await db.trade_token_offers.update_many(
        {"user_id": user_id, "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": now}},
    )
    _invalidate_trade_caches()


class CreateSellOffer(BaseModel):
    points: int
    cost: int
    hide_name: bool = False


class CreateBuyOffer(BaseModel):
    points: int
    offer: int
    hide_name: bool = False


class CreateTokenOffer(BaseModel):
    token_type: str
    quantity: int
    price_points: int


# ----- Sell offers -----
async def get_sell_offers(current_user: dict = Depends(get_current_user)):
    """List active sell offers. Does not expose user_id; uses opaque group_key for grouping same-seller offers."""
    global _sell_offers_cache, _sell_offers_ts
    now = time.monotonic()
    if _sell_offers_cache is not None and now <= _sell_offers_ts + _LIST_TTL_SEC:
        raw_list = _sell_offers_cache
    else:
        try:
            raw_list = await db.trade_sell_offers.find({"status": "active"}).sort("created_at", -1).to_list(length=100)
            _sell_offers_cache = raw_list
            _sell_offers_ts = now
        except Exception as e:
            print(f"Error fetching sell offers: {e}")
            return []
    uid_to_key = {}
    next_key = [0]
    result = []
    for offer in raw_list:
        uid = offer.get("user_id")
        hide = offer.get("hide_name", False)
        group_key_tuple = (uid, hide)
        if group_key_tuple not in uid_to_key:
            uid_to_key[group_key_tuple] = f"g{next_key[0]}"
            next_key[0] += 1
        group_key = uid_to_key[group_key_tuple]
        result.append({
            "id": str(offer["_id"]),
            "username": offer.get("username", "Anonymous") if not offer.get("hide_name") else "[Anonymous]",
            "group_key": group_key,
            "points": offer["points"],
            "money": offer["cost"],
            "hide_name": offer.get("hide_name", False),
            "created_at": offer.get("created_at"),
            "is_own": uid == current_user["id"],
        })
    return result


async def create_sell_offer(offer: CreateSellOffer, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    username = current_user.get("username", "Unknown")
    if offer.points <= 0 or offer.cost <= 0:
        raise HTTPException(status_code=400, detail="Points and cost must be positive")
    active_offers = await db.trade_sell_offers.count_documents({"user_id": user_id, "status": "active"})
    if active_offers >= 10:
        raise HTTPException(status_code=400, detail="Maximum 10 offers at once (normal + anonymous combined)")
    if offer.hide_name:
        hidden_count = await db.trade_sell_offers.count_documents({"user_id": user_id, "status": "active", "hide_name": True})
        if hidden_count >= 5:
            raise HTTPException(status_code=400, detail="Maximum 5 anonymous offers allowed")
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
    try:
        await db.trade_events.insert_one(
            {
                "id": str(result.inserted_id),
                "type": "sell_offer_created",
                "user_id": user_id,
                "username": username,
                "points": points_after_fee,
                "original_points": offer.points,
                "fee": fee,
                "money": offer.cost,
                "direction": "sell",
                "at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass
    _invalidate_trade_caches()
    await log_activity(
        user_id,
        username,
        "quicktrade_sell_offer",
        {"points": points_after_fee, "original_points": offer.points, "cost": offer.cost, "fee": fee, "hide_name": offer.hide_name},
    )
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
    if not buyer:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    result = await db.users.update_one(
        {"id": buyer_id, "money": {"$gte": offer["cost"]}},
        {"$inc": {"money": -offer["cost"], "points": offer["points"]}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    await db.users.update_one({"id": offer["user_id"]}, {"$inc": {"money": offer["cost"]}})
    await db.trade_sell_offers.update_one(
        {"_id": ObjectId(offer_id)},
        {"$set": {"status": "completed", "buyer_id": buyer_id, "buyer_username": buyer_username, "completed_at": datetime.now(timezone.utc)}}
    )
    _invalidate_trade_caches()
    await log_activity(
        buyer_id,
        buyer_username,
        "quicktrade_accept_sell",
        {"seller_id": offer["user_id"], "points_received": offer["points"], "cost_paid": offer["cost"], "offer_id": offer_id},
    )
    try:
        await db.trade_events.insert_one(
            {
                "id": str(offer_id),
                "type": "sell_offer_accepted",
                "seller_id": offer["user_id"],
                "seller_username": offer.get("username"),
                "buyer_id": buyer_id,
                "buyer_username": buyer_username,
                "points": offer["points"],
                "money": offer["cost"],
                "direction": "sell",
                "at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass
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
    try:
        await db.trade_events.insert_one(
            {
                "id": str(offer_id),
                "type": "sell_offer_cancelled",
                "user_id": user_id,
                "points": refund_amount,
                "fee": offer.get("fee", 0),
                "direction": "sell",
                "at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass
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
    try:
        await db.trade_events.insert_one(
            {
                "id": str(offer_id),
                "type": "sell_offer_cancelled",
                "user_id": user_id,
                "points": original_points,
                "direction": "sell",
                "at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass
    return {"message": f"Offer cancelled. {original_points} points refunded (including fee)"}


# ----- Token offers (points only: seller lists tokens, buyer pays points) -----
async def get_token_offers(current_user: dict = Depends(get_current_user)):
    """List active token sell offers. Buyer pays points and receives tokens."""
    global _token_offers_cache, _token_offers_ts
    now = time.monotonic()
    if _token_offers_cache is not None and now <= _token_offers_ts + _LIST_TTL_SEC:
        raw_list = _token_offers_cache
    else:
        try:
            raw_list = await db.trade_token_offers.find({"status": "active"}).sort("created_at", -1).to_list(length=100)
            _token_offers_cache = raw_list
            _token_offers_ts = now
        except Exception as e:
            print(f"Error fetching token offers: {e}")
            return []
    result = []
    for offer in raw_list:
        result.append({
            "id": str(offer["_id"]),
            "username": offer.get("username", "Anonymous"),
            "token_type": offer["token_type"],
            "quantity": offer["quantity"],
            "price_points": offer["price_points"],
            "created_at": offer.get("created_at"),
            "is_own": offer.get("user_id") == current_user["id"],
        })
    return result


async def get_my_token_balances(current_user: dict = Depends(get_current_user)):
    """Return per-token-type balances: total, referral (cannot be sold), and sellable for Quick Trade."""
    user_id = current_user["id"]
    projection = {"_id": 0, "referral_tokens": 1}
    for cfg in TOKEN_CONFIG.values():
        projection[cfg["count_field"]] = 1
    user = await db.users.find_one({"id": user_id}, projection)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    referral_tokens = user.get("referral_tokens") or {}
    result = {}
    for token_type in TOKEN_TYPES:
        field = TOKEN_CONFIG[token_type]["count_field"]
        total = int(user.get(field) or 0)
        referral = int(referral_tokens.get(field) or 0)
        sellable = max(0, total - referral)
        result[token_type] = {"total": total, "referral": referral, "sellable": sellable}
    return result


async def create_token_offer(offer: CreateTokenOffer, current_user: dict = Depends(get_current_user)):
    """Create a token sell offer. Deducts tokens from seller; buyer will pay points and receive tokens."""
    user_id = current_user["id"]
    username = current_user.get("username", "Unknown")
    if offer.token_type not in TOKEN_TYPES:
        raise HTTPException(status_code=400, detail="Invalid token type")
    if offer.quantity <= 0 or offer.price_points <= 0:
        raise HTTPException(status_code=400, detail="Quantity and price must be positive")
    active_token_offers = await db.trade_token_offers.count_documents({"user_id": user_id, "status": "active"})
    if active_token_offers >= 10:
        raise HTTPException(status_code=400, detail="Maximum 10 token offers at once")
    field = TOKEN_CONFIG[offer.token_type]["count_field"]
    user = await db.users.find_one({"id": user_id}, {"_id": 0, field: 1, "referral_tokens": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    have = int(user.get(field) or 0)
    referral_count = int((user.get("referral_tokens") or {}).get(field) or 0)
    sellable = max(0, have - referral_count)
    if sellable < offer.quantity:
        raise HTTPException(status_code=400, detail="Insufficient sellable tokens (referral tokens cannot be sold on Quick Trade)")
    await db.users.update_one({"id": user_id}, {"$inc": {field: -offer.quantity}})
    new_offer = {
        "user_id": user_id,
        "username": username,
        "token_type": offer.token_type,
        "quantity": offer.quantity,
        "price_points": offer.price_points,
        "status": "active",
        "created_at": datetime.now(timezone.utc),
    }
    result = await db.trade_token_offers.insert_one(new_offer)
    _invalidate_trade_caches()
    await log_activity(user_id, username, "quicktrade_token_offer", {"token_type": offer.token_type, "quantity": offer.quantity, "price_points": offer.price_points})
    return {"message": f"Token offer created: {offer.quantity} {offer.token_type} for {offer.price_points} points", "offer_id": str(result.inserted_id)}


async def accept_token_offer(offer_id: str, current_user: dict = Depends(get_current_user)):
    """Buyer pays points and receives tokens; seller receives points."""
    buyer_id = current_user["id"]
    buyer_username = current_user.get("username", "Unknown")
    offer = await db.trade_token_offers.find_one({"_id": ObjectId(offer_id), "status": "active"})
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already completed")
    if offer["user_id"] == buyer_id:
        raise HTTPException(status_code=400, detail="Cannot accept your own offer")
    buyer = await db.users.find_one({"id": buyer_id})
    if not buyer:
        raise HTTPException(status_code=400, detail="Insufficient points")
    token_type = offer["token_type"]
    field = TOKEN_CONFIG[token_type]["count_field"]
    result = await db.users.update_one(
        {"id": buyer_id, "points": {"$gte": offer["price_points"]}},
        {"$inc": {"points": -offer["price_points"], field: offer["quantity"]}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await db.users.update_one({"id": offer["user_id"]}, {"$inc": {"points": offer["price_points"]}})
    await db.trade_token_offers.update_one(
        {"_id": ObjectId(offer_id)},
        {"$set": {"status": "completed", "buyer_id": buyer_id, "buyer_username": buyer_username, "completed_at": datetime.now(timezone.utc)}},
    )
    _invalidate_trade_caches()
    await log_activity(
        buyer_id,
        buyer_username,
        "quicktrade_accept_token",
        {"seller_id": offer["user_id"], "token_type": token_type, "quantity": offer["quantity"], "points_paid": offer["price_points"], "offer_id": offer_id},
    )
    return {"message": "Trade completed", "token_type": token_type, "quantity": offer["quantity"], "points_paid": offer["price_points"]}


async def cancel_token_offer(offer_id: str, current_user: dict = Depends(get_current_user)):
    """Cancel token offer and return tokens to seller."""
    user_id = current_user["id"]
    offer = await db.trade_token_offers.find_one({"_id": ObjectId(offer_id), "user_id": user_id, "status": "active"})
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already completed")
    field = TOKEN_CONFIG[offer["token_type"]]["count_field"]
    await db.users.update_one({"id": user_id}, {"$inc": {field: offer["quantity"]}})
    await db.trade_token_offers.update_one(
        {"_id": ObjectId(offer_id)},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)}},
    )
    _invalidate_trade_caches()
    return {"message": f"Offer cancelled. {offer['quantity']} {offer['token_type']} token(s) returned."}


# ----- Buy offers -----
async def get_buy_offers(current_user: dict = Depends(get_current_user)):
    """List active buy offers. Does not expose user_id; uses opaque group_key for grouping same-buyer offers."""
    global _buy_offers_cache, _buy_offers_ts
    now = time.monotonic()
    if _buy_offers_cache is not None and now <= _buy_offers_ts + _LIST_TTL_SEC:
        raw_list = _buy_offers_cache
    else:
        try:
            raw_list = await db.trade_buy_offers.find({"status": "active"}).sort("created_at", -1).to_list(length=100)
            _buy_offers_cache = raw_list
            _buy_offers_ts = now
        except Exception as e:
            print(f"Error fetching buy offers: {e}")
            return []
    uid_to_key = {}
    next_key = [0]
    result = []
    for offer in raw_list:
        uid = offer.get("user_id")
        hide = offer.get("hide_name", False)
        group_key_tuple = (uid, hide)
        if group_key_tuple not in uid_to_key:
            uid_to_key[group_key_tuple] = f"g{next_key[0]}"
            next_key[0] += 1
        group_key = uid_to_key[group_key_tuple]
        result.append({
            "id": str(offer["_id"]),
            "username": offer.get("username", "Anonymous") if not offer.get("hide_name") else "[Anonymous]",
            "group_key": group_key,
            "points": offer["points"],
            "cost": offer["offer"],
            "hide_name": offer.get("hide_name", False),
            "created_at": offer.get("created_at"),
            "is_own": uid == current_user["id"],
        })
    return result


async def create_buy_offer(offer: CreateBuyOffer, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    username = current_user.get("username", "Unknown")
    if offer.points <= 0 or offer.offer <= 0:
        raise HTTPException(status_code=400, detail="Points and offer must be positive")
    active_offers = await db.trade_buy_offers.count_documents({"user_id": user_id, "status": "active"})
    if active_offers >= 10:
        raise HTTPException(status_code=400, detail="Maximum 10 offers at once (normal + anonymous combined)")
    if offer.hide_name:
        hidden_count = await db.trade_buy_offers.count_documents({"user_id": user_id, "status": "active", "hide_name": True})
        if hidden_count >= 5:
            raise HTTPException(status_code=400, detail="Maximum 5 anonymous offers allowed")
    else:
        non_hidden_count = await db.trade_buy_offers.count_documents({"user_id": user_id, "status": "active", "hide_name": False})
        if non_hidden_count >= 10:
            raise HTTPException(status_code=400, detail="Maximum 10 regular offers allowed")
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    fee = max(1, int(offer.points * 0.005))
    points_after_fee = offer.points - fee
    result = await db.users.update_one(
        {"id": user_id, "money": {"$gte": offer.offer}},
        {"$inc": {"money": -offer.offer}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient cash")
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
    await log_activity(
        user_id,
        username,
        "quicktrade_buy_offer",
        {"points": points_after_fee, "original_points": offer.points, "offer": offer.offer, "fee": fee, "hide_name": offer.hide_name},
    )
    try:
        await db.trade_events.insert_one(
            {
                "id": str(result.inserted_id),
                "type": "buy_offer_created",
                "user_id": user_id,
                "username": username,
                "points": points_after_fee,
                "original_points": offer.points,
                "fee": fee,
                "money": offer.offer,
                "direction": "buy",
                "at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass
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
    if not seller:
        raise HTTPException(status_code=400, detail="Insufficient points")
    result = await db.users.update_one(
        {"id": seller_id, "points": {"$gte": offer["points"]}},
        {"$inc": {"points": -offer["points"], "money": offer["offer"]}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await db.users.update_one({"id": offer["user_id"]}, {"$inc": {"points": offer["points"]}})
    await db.trade_buy_offers.update_one(
        {"_id": ObjectId(offer_id)},
        {"$set": {"status": "completed", "seller_id": seller_id, "seller_username": seller_username, "completed_at": datetime.now(timezone.utc)}}
    )
    _invalidate_trade_caches()
    await log_activity(
        seller_id,
        seller_username,
        "quicktrade_accept_buy",
        {"buyer_id": offer["user_id"], "points_sold": offer["points"], "cash_received": offer["offer"], "offer_id": offer_id},
    )
    try:
        await db.trade_events.insert_one(
            {
                "id": str(offer_id),
                "type": "buy_offer_accepted",
                "buyer_id": offer["user_id"],
                "buyer_username": offer.get("username"),
                "seller_id": seller_id,
                "seller_username": seller_username,
                "points": offer["points"],
                "money": offer["offer"],
                "direction": "buy",
                "at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass
    return {"message": "Trade completed successfully", "points_sold": offer["points"], "cash_received": offer["offer"]}


async def cancel_buy_offer_delete(offer_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    offer = await db.trade_buy_offers.find_one({"_id": ObjectId(offer_id), "user_id": user_id, "status": "active"})
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already completed")
    await db.users.update_one({"id": user_id}, {"$inc": {"money": offer["offer"]}})
    await db.trade_buy_offers.update_one(
        {"_id": ObjectId(offer_id)},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)}}
    )
    _invalidate_trade_caches()
    try:
        await db.trade_events.insert_one(
            {
                "id": str(offer_id),
                "type": "buy_offer_cancelled",
                "user_id": user_id,
                "points": offer["points"],
                "fee": offer.get("fee", 0),
                "direction": "buy",
                "at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass
    return {"message": f"Offer cancelled. ${offer['offer']:,} refunded"}


async def cancel_buy_offer_post(offer_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    offer = await db.trade_buy_offers.find_one({"_id": ObjectId(offer_id), "status": "active"})
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already completed")
    if offer["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="You can only cancel your own offers")
    await db.users.update_one({"id": user_id}, {"$inc": {"money": offer["offer"]}})
    await db.trade_buy_offers.update_one(
        {"_id": ObjectId(offer_id)},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)}}
    )
    _invalidate_trade_caches()
    try:
        await db.trade_events.insert_one(
            {
                "id": str(offer_id),
                "type": "buy_offer_cancelled",
                "user_id": user_id,
                "points": offer["points"],
                "direction": "buy",
                "at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass
    return {"message": f"Offer cancelled. ${offer['offer']:,} refunded"}


# ----- Properties -----
async def get_properties_for_sale(current_user: dict = Depends(get_current_user)):
    global _properties_cache, _properties_ts
    now = time.monotonic()
    if _properties_cache is not None and now <= _properties_ts + _LIST_TTL_SEC:
        return _properties_cache
    try:
        properties = await db.properties.find({"for_sale": True, "type": {"$ne": "casino_slots"}}).sort("created_at", -1).to_list(length=100)
        result = []
        for prop in properties:
            result.append({
                "id": str(prop["_id"]),
                "location": prop.get("location", "Unknown"),
                "property_name": prop.get("name", "Property"),
                "owner": prop.get("owner_username", "Unknown"),
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
    if prop_type.startswith("casino_") or prop_type == "airport" or prop_type == "bullet_factory":
        rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
        prestige_level = int(current_user.get("prestige_level") or 0)
        if rank_id < CAPO_RANK_ID and prestige_level < 1:
            raise HTTPException(status_code=403, detail="You must be rank Capo or higher to buy a casino or property. Reach Capo to hold one.")
    buyer = await db.users.find_one({"id": buyer_id})
    if not buyer:
        raise HTTPException(status_code=404, detail="User not found")
    sale_price = prop.get("sale_price", 0)
    if prop.get("type") == "airport":
        owned = await _user_owns_any_property(buyer_id)
        if owned:
            raise HTTPException(status_code=400, detail="You may only own one property. Relinquish it first.")
    if prop.get("type") == "bullet_factory":
        owned = await _user_owns_any_property(buyer_id)
        if owned:
            raise HTTPException(status_code=400, detail="You may only own one property. Relinquish it first.")
    result = await db.users.update_one(
        {"id": buyer_id, "points": {"$gte": sale_price}},
        {"$inc": {"points": -sale_price}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
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
    elif prop_type == "bullet_factory":
        state = prop.get("state")
        if state is not None:
            await db.bullet_factory.update_one(
                {"state": state},
                {"$set": {"owner_id": buyer_id, "owner_username": buyer_username}},
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
    router.add_api_route("/trade/token-offers", get_token_offers, methods=["GET"])
    router.add_api_route("/trade/my-token-balances", get_my_token_balances, methods=["GET"])
    router.add_api_route("/trade/token-offer", create_token_offer, methods=["POST"])
    router.add_api_route("/trade/token-offer/{offer_id}/accept", accept_token_offer, methods=["POST"])
    router.add_api_route("/trade/token-offer/{offer_id}/cancel", cancel_token_offer, methods=["POST"])
