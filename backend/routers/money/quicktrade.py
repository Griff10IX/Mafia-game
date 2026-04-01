# Quick Trade: sell/buy points (with fee, hide_name limits), property listings and purchase
from datetime import datetime, timezone
from typing import Optional
import time
from pydantic import BaseModel

from fastapi import Depends, HTTPException
from bson.objectid import ObjectId

from server import db, get_current_user, get_rank_info, log_activity, CAPO_RANK_ID, _user_owns_any_property, send_notification
from routers.kill.armoury import TOKEN_CONFIG, TOKEN_TYPES
from utils.point_provenance import log_points_event

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

# Founding Member random drops still write `founding_tokens.*` for analytics, but these types also flow from
# Game Pass / store — they should remain listable on Quick Trade (referral + entertainer locks still apply).
_FOUNDING_LOCK_EXEMPT_COUNT_FIELDS = frozenset(
    {"melt_tokens", "travel_tokens", "properties_tokens", "jailbust_tokens"}
)

# Minimum total cash (USD) for a token Quick Trade listing when selling for money: $250,000 per token.
TOKEN_MIN_CASH_PER_TOKEN = 250_000


def _token_type_label(token_type: str) -> str:
    return (token_type or "").replace("_", " ").strip().title() or token_type


async def _notify_quicktrade_seller(seller_id: Optional[str], title: str, message: str) -> None:
    """Inbox the seller when a Quick Trade listing is bought or accepted."""
    if not seller_id:
        return
    try:
        await send_notification(seller_id, title, message, "quicktrade_sale", category="system")
    except Exception:
        pass


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
    # "points" = buyer pays pts; "money" = buyer pays cash (min $250k per token, server-enforced).
    price_currency: str = "points"
    price_points: int = 0
    price_money: int = 0


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
    fee = max(1, int(offer.points * 0.005))
    points_after_fee = offer.points - fee
    if points_after_fee <= 0:
        raise HTTPException(status_code=400, detail="Points are too low after fee. Minimum is 2 points.")
    result = await db.users.update_one(
        {"id": user_id, "points": {"$gte": offer.points}},
        {"$inc": {"points": -offer.points}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await log_points_event(db, user_id=user_id, points=-offer.points, event_type="quicktrade_create", meta={"direction": "sell", "listed_points": points_after_fee, "fee": fee, "cost": offer.cost})
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
    now = datetime.now(timezone.utc)
    offer = await db.trade_sell_offers.find_one_and_update(
        {"_id": ObjectId(offer_id), "status": "active"},
        {"$set": {"status": "completed", "buyer_id": buyer_id, "buyer_username": buyer_username, "completed_at": now}},
    )
    if not offer:
        raise HTTPException(status_code=400, detail="Offer no longer available")
    if offer["user_id"] == buyer_id:
        await db.trade_sell_offers.update_one(
            {"_id": ObjectId(offer_id)},
            {"$set": {"status": "active"}, "$unset": {"buyer_id": 1, "buyer_username": 1, "completed_at": 1}},
        )
        raise HTTPException(status_code=400, detail="Cannot accept your own offer")
    buyer = await db.users.find_one({"id": buyer_id})
    if not buyer:
        await db.trade_sell_offers.update_one(
            {"_id": ObjectId(offer_id)},
            {"$set": {"status": "active"}, "$unset": {"buyer_id": 1, "buyer_username": 1, "completed_at": 1}},
        )
        raise HTTPException(status_code=400, detail="Insufficient cash")
    result = await db.users.update_one(
        {"id": buyer_id, "money": {"$gte": offer["cost"]}},
        {"$inc": {"money": -offer["cost"], "points": offer["points"]}}
    )
    if result.modified_count == 0:
        await db.trade_sell_offers.update_one(
            {"_id": ObjectId(offer_id)},
            {"$set": {"status": "active"}, "$unset": {"buyer_id": 1, "buyer_username": 1, "completed_at": 1}},
        )
        raise HTTPException(status_code=400, detail="Insufficient cash")
    if offer["points"] != 0:
        await log_points_event(db, user_id=buyer_id, points=offer["points"], event_type="quicktrade_buy", meta={"offer_id": offer_id, "direction": "sell_offer_accepted", "cost_cash": offer["cost"]})
    await db.users.update_one({"id": offer["user_id"]}, {"$inc": {"money": offer["cost"]}})
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
    await _notify_quicktrade_seller(
        offer["user_id"],
        "Quick Trade: points sold",
        f"{buyer_username} bought your points listing: {int(offer['points']):,} points for ${int(offer['cost']):,} cash.",
    )
    return {"message": "Trade completed successfully", "points_received": offer["points"], "cost_paid": offer["cost"]}


async def cancel_sell_offer_delete(offer_id: str, current_user: dict = Depends(get_current_user)):
    """Cancel sell offer (DELETE) – refund points + fee."""
    user_id = current_user["id"]
    offer = await db.trade_sell_offers.find_one_and_update(
        {"_id": ObjectId(offer_id), "user_id": user_id, "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)}},
    )
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already cancelled")
    refund_amount = offer.get("original_points", offer["points"])
    await db.users.update_one({"id": user_id}, {"$inc": {"points": refund_amount}})
    if refund_amount != 0:
        await log_points_event(db, user_id=user_id, points=refund_amount, event_type="quicktrade_cancel", meta={"offer_id": offer_id, "direction": "sell_cancel", "fee_refunded": offer.get("fee", 0)})
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
    offer = await db.trade_sell_offers.find_one_and_update(
        {"_id": ObjectId(offer_id), "user_id": user_id, "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)}},
    )
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already cancelled")
    original_points = offer.get("original_points", offer["points"])
    await db.users.update_one({"id": user_id}, {"$inc": {"points": original_points}})
    if original_points != 0:
        await log_points_event(db, user_id=user_id, points=original_points, event_type="quicktrade_cancel", meta={"offer_id": offer_id, "direction": "sell_cancel"})
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
        cur = offer.get("price_currency") or "points"
        result.append({
            "id": str(offer["_id"]),
            "username": offer.get("username", "Anonymous"),
            "token_type": offer["token_type"],
            "quantity": offer["quantity"],
            "price_currency": cur,
            "price_points": int(offer.get("price_points") or 0),
            "price_money": int(offer.get("price_money") or 0),
            "created_at": offer.get("created_at"),
            "is_own": offer.get("user_id") == current_user["id"],
        })
    return result


async def get_my_token_balances(current_user: dict = Depends(get_current_user)):
    """Return per-token-type balances: total, unsellable (referral + entertainer + founding lock), sellable."""
    user_id = current_user["id"]
    projection = {"_id": 0, "referral_tokens": 1, "entertainer_tokens": 1, "founding_tokens": 1}
    for cfg in TOKEN_CONFIG.values():
        projection[cfg["count_field"]] = 1
    user = await db.users.find_one({"id": user_id}, projection)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    referral_tokens = user.get("referral_tokens") or {}
    entertainer_tokens = user.get("entertainer_tokens") or {}
    founding_tokens = user.get("founding_tokens") or {}
    result = {}
    for token_type in TOKEN_TYPES:
        field = TOKEN_CONFIG[token_type]["count_field"]
        total = int(user.get(field) or 0)
        referral = int(referral_tokens.get(field) or 0)
        entertainer = int(entertainer_tokens.get(field) or 0)
        founding_stored = int(founding_tokens.get(field) or 0)
        founding_lock = 0 if field in _FOUNDING_LOCK_EXEMPT_COUNT_FIELDS else founding_stored
        unsellable = referral + entertainer + founding_lock
        sellable = max(0, total - unsellable)
        result[token_type] = {
            "total": total,
            "referral": referral,
            "entertainer": entertainer,
            "founding": founding_stored,
            "founding_locks_trade": founding_lock,
            "unsellable": unsellable,
            "sellable": sellable,
        }
    return result


async def create_token_offer(offer: CreateTokenOffer, current_user: dict = Depends(get_current_user)):
    """Create a token sell offer. Deducts tokens from seller; buyer pays points or cash and receives tokens."""
    user_id = current_user["id"]
    username = current_user.get("username", "Unknown")
    if offer.token_type not in TOKEN_TYPES:
        raise HTTPException(status_code=400, detail="Invalid token type")
    if offer.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be positive")
    cur = (offer.price_currency or "points").strip().lower()
    if cur not in ("points", "money"):
        raise HTTPException(status_code=400, detail="price_currency must be 'points' or 'money'")
    price_points = int(offer.price_points or 0)
    price_money = int(offer.price_money or 0)
    if cur == "points":
        if price_points <= 0:
            raise HTTPException(status_code=400, detail="Price in points must be positive")
        price_money = 0
    else:
        min_cash = TOKEN_MIN_CASH_PER_TOKEN * offer.quantity
        if price_money < min_cash:
            raise HTTPException(
                status_code=400,
                detail=f"Minimum cash for this listing is ${min_cash:,} (${TOKEN_MIN_CASH_PER_TOKEN:,} per token × {offer.quantity})",
            )
        price_points = 0
    active_token_offers = await db.trade_token_offers.count_documents({"user_id": user_id, "status": "active"})
    if active_token_offers >= 10:
        raise HTTPException(status_code=400, detail="Maximum 10 token offers at once")
    field = TOKEN_CONFIG[offer.token_type]["count_field"]
    referral_key = f"referral_tokens.{field}"
    entertainer_key = f"entertainer_tokens.{field}"
    founding_key = f"founding_tokens.{field}"
    locked_parts = [
        {"$ifNull": ["$" + referral_key, 0]},
        {"$ifNull": ["$" + entertainer_key, 0]},
    ]
    if field not in _FOUNDING_LOCK_EXEMPT_COUNT_FIELDS:
        locked_parts.append({"$ifNull": ["$" + founding_key, 0]})
    result = await db.users.update_one(
        {
            "id": user_id,
            "$expr": {
                "$gte": [
                    {"$subtract": [{"$ifNull": ["$" + field, 0]}, {"$add": locked_parts}]},
                    offer.quantity,
                ]
            },
        },
        {"$inc": {field: -offer.quantity}},
    )
    if result.modified_count == 0:
        raise HTTPException(
            status_code=400,
            detail="Insufficient sellable tokens (referral, entertainer, and some founding bonus tokens cannot be sold on Quick Trade)",
        )
    new_offer = {
        "user_id": user_id,
        "username": username,
        "token_type": offer.token_type,
        "quantity": offer.quantity,
        "price_currency": cur,
        "price_points": price_points,
        "price_money": price_money,
        "status": "active",
        "created_at": datetime.now(timezone.utc),
    }
    result = await db.trade_token_offers.insert_one(new_offer)
    _invalidate_trade_caches()
    await log_activity(
        user_id,
        username,
        "quicktrade_token_offer",
        {
            "token_type": offer.token_type,
            "quantity": offer.quantity,
            "price_currency": cur,
            "price_points": price_points,
            "price_money": price_money,
        },
    )
    if cur == "money":
        return {
            "message": f"Token offer created: {offer.quantity} {offer.token_type} for ${price_money:,} cash",
            "offer_id": str(result.inserted_id),
        }
    return {"message": f"Token offer created: {offer.quantity} {offer.token_type} for {price_points} points", "offer_id": str(result.inserted_id)}


async def accept_token_offer(offer_id: str, current_user: dict = Depends(get_current_user)):
    """Buyer pays points or cash and receives tokens; seller receives points or cash."""
    buyer_id = current_user["id"]
    buyer_username = current_user.get("username", "Unknown")
    now = datetime.now(timezone.utc)
    offer = await db.trade_token_offers.find_one_and_update(
        {"_id": ObjectId(offer_id), "status": "active"},
        {"$set": {"status": "completed", "buyer_id": buyer_id, "buyer_username": buyer_username, "completed_at": now}},
    )
    if not offer:
        raise HTTPException(status_code=400, detail="Offer no longer available")
    if offer["user_id"] == buyer_id:
        await db.trade_token_offers.update_one(
            {"_id": ObjectId(offer_id)},
            {"$set": {"status": "active"}, "$unset": {"buyer_id": 1, "buyer_username": 1, "completed_at": 1}},
        )
        raise HTTPException(status_code=400, detail="Cannot accept your own offer")
    buyer = await db.users.find_one({"id": buyer_id})
    if not buyer:
        await db.trade_token_offers.update_one(
            {"_id": ObjectId(offer_id)},
            {"$set": {"status": "active"}, "$unset": {"buyer_id": 1, "buyer_username": 1, "completed_at": 1}},
        )
        raise HTTPException(status_code=400, detail="Buyer not found")
    token_type = offer["token_type"]
    field = TOKEN_CONFIG[token_type]["count_field"]
    currency = offer.get("price_currency") or "points"
    price_points = int(offer.get("price_points") or 0)
    price_money = int(offer.get("price_money") or 0)

    if currency == "money":
        if price_money <= 0:
            await db.trade_token_offers.update_one(
                {"_id": ObjectId(offer_id)},
                {"$set": {"status": "active"}, "$unset": {"buyer_id": 1, "buyer_username": 1, "completed_at": 1}},
            )
            raise HTTPException(status_code=400, detail="Invalid cash offer")
        result = await db.users.update_one(
            {"id": buyer_id, "money": {"$gte": float(price_money)}},
            {"$inc": {"money": -float(price_money), field: offer["quantity"]}},
        )
        if result.modified_count == 0:
            await db.trade_token_offers.update_one(
                {"_id": ObjectId(offer_id)},
                {"$set": {"status": "active"}, "$unset": {"buyer_id": 1, "buyer_username": 1, "completed_at": 1}},
            )
            raise HTTPException(status_code=400, detail="Insufficient cash")
        await db.users.update_one({"id": offer["user_id"]}, {"$inc": {"money": float(price_money)}})
        _invalidate_trade_caches()
        await log_activity(
            buyer_id,
            buyer_username,
            "quicktrade_accept_token",
            {
                "seller_id": offer["user_id"],
                "token_type": token_type,
                "quantity": offer["quantity"],
                "cash_paid": price_money,
                "price_currency": "money",
                "offer_id": offer_id,
            },
        )
        await _notify_quicktrade_seller(
            offer["user_id"],
            "Quick Trade: tokens sold",
            f"{buyer_username} bought your listing: {int(offer['quantity']):,}× {_token_type_label(token_type)} for ${price_money:,} cash.",
        )
        return {
            "message": "Trade completed",
            "token_type": token_type,
            "quantity": offer["quantity"],
            "price_currency": "money",
            "cash_paid": price_money,
        }

    # Points (legacy listings have no price_currency → treat as points)
    result = await db.users.update_one(
        {"id": buyer_id, "points": {"$gte": price_points}},
        {"$inc": {"points": -price_points, field: offer["quantity"]}},
    )
    if result.modified_count == 0:
        await db.trade_token_offers.update_one(
            {"_id": ObjectId(offer_id)},
            {"$set": {"status": "active"}, "$unset": {"buyer_id": 1, "buyer_username": 1, "completed_at": 1}},
        )
        raise HTTPException(status_code=400, detail="Insufficient points")
    if price_points != 0:
        await log_points_event(db, user_id=buyer_id, points=-price_points, event_type="quicktrade_item_shop", meta={"offer_id": offer_id, "token_type": token_type, "quantity": offer["quantity"]})
    await db.users.update_one({"id": offer["user_id"]}, {"$inc": {"points": price_points}})
    if price_points != 0:
        await log_points_event(db, user_id=offer["user_id"], points=price_points, event_type="quicktrade_sell", meta={"offer_id": offer_id, "token_type": token_type, "quantity": offer["quantity"]})
    _invalidate_trade_caches()
    await log_activity(
        buyer_id,
        buyer_username,
        "quicktrade_accept_token",
        {
            "seller_id": offer["user_id"],
            "token_type": token_type,
            "quantity": offer["quantity"],
            "points_paid": price_points,
            "price_currency": "points",
            "offer_id": offer_id,
        },
    )
    await _notify_quicktrade_seller(
        offer["user_id"],
        "Quick Trade: tokens sold",
        f"{buyer_username} bought your listing: {int(offer['quantity']):,}× {_token_type_label(token_type)} for {price_points:,} points.",
    )
    return {
        "message": "Trade completed",
        "token_type": token_type,
        "quantity": offer["quantity"],
        "price_currency": "points",
        "points_paid": price_points,
    }


async def cancel_token_offer(offer_id: str, current_user: dict = Depends(get_current_user)):
    """Cancel token offer and return tokens to seller."""
    user_id = current_user["id"]
    offer = await db.trade_token_offers.find_one_and_update(
        {"_id": ObjectId(offer_id), "user_id": user_id, "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)}},
    )
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already cancelled")
    field = TOKEN_CONFIG[offer["token_type"]]["count_field"]
    await db.users.update_one({"id": user_id}, {"$inc": {field: offer["quantity"]}})
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
    if points_after_fee <= 0:
        raise HTTPException(status_code=400, detail="Points are too low after fee. Minimum is 2 points.")
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
    now = datetime.now(timezone.utc)
    offer = await db.trade_buy_offers.find_one_and_update(
        {"_id": ObjectId(offer_id), "status": "active"},
        {"$set": {"status": "completed", "seller_id": seller_id, "seller_username": seller_username, "completed_at": now}},
    )
    if not offer:
        raise HTTPException(status_code=400, detail="Offer no longer available")
    if offer["user_id"] == seller_id:
        await db.trade_buy_offers.update_one(
            {"_id": ObjectId(offer_id)},
            {"$set": {"status": "active"}, "$unset": {"seller_id": 1, "seller_username": 1, "completed_at": 1}},
        )
        raise HTTPException(status_code=400, detail="Cannot accept your own offer")
    seller = await db.users.find_one({"id": seller_id})
    if not seller:
        await db.trade_buy_offers.update_one(
            {"_id": ObjectId(offer_id)},
            {"$set": {"status": "active"}, "$unset": {"seller_id": 1, "seller_username": 1, "completed_at": 1}},
        )
        raise HTTPException(status_code=400, detail="Insufficient points")
    result = await db.users.update_one(
        {"id": seller_id, "points": {"$gte": offer["points"]}},
        {"$inc": {"points": -offer["points"], "money": offer["offer"]}}
    )
    if result.modified_count == 0:
        await db.trade_buy_offers.update_one(
            {"_id": ObjectId(offer_id)},
            {"$set": {"status": "active"}, "$unset": {"seller_id": 1, "seller_username": 1, "completed_at": 1}},
        )
        raise HTTPException(status_code=400, detail="Insufficient points")
    if offer["points"] != 0:
        await log_points_event(db, user_id=seller_id, points=-offer["points"], event_type="quicktrade_sell", meta={"offer_id": offer_id, "direction": "buy_offer_accepted", "cash_received": offer["offer"]})
    await db.users.update_one({"id": offer["user_id"]}, {"$inc": {"points": offer["points"]}})
    if offer["points"] != 0:
        await log_points_event(db, user_id=offer["user_id"], points=offer["points"], event_type="quicktrade_buy", meta={"offer_id": offer_id, "direction": "buy_offer_fulfilled"})
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
    buyer_name = "[Anonymous]" if offer.get("hide_name") else (offer.get("username") or "Unknown")
    await _notify_quicktrade_seller(
        seller_id,
        "Quick Trade: buy offer filled",
        f"{buyer_name} bought your points via their buy offer: {int(offer['points']):,} points for ${int(offer['offer']):,} cash.",
    )
    return {"message": "Trade completed successfully", "points_sold": offer["points"], "cash_received": offer["offer"]}


async def cancel_buy_offer_delete(offer_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    offer = await db.trade_buy_offers.find_one_and_update(
        {"_id": ObjectId(offer_id), "user_id": user_id, "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)}},
    )
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already cancelled")
    await db.users.update_one({"id": user_id}, {"$inc": {"money": offer["offer"]}})
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
    offer = await db.trade_buy_offers.find_one_and_update(
        {"_id": ObjectId(offer_id), "user_id": user_id, "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)}},
    )
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found or already cancelled")
    await db.users.update_one({"id": user_id}, {"$inc": {"money": offer["offer"]}})
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
                "is_own": prop.get("owner_id") == current_user["id"],
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
    prop = await db.properties.find_one_and_update(
        {"_id": ObjectId(property_id), "for_sale": True},
        {"$set": {"for_sale": False}},
    )
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found or not for sale")
    if prop.get("owner_id") == buyer_id:
        await db.properties.update_one({"_id": ObjectId(property_id)}, {"$set": {"for_sale": True}})
        raise HTTPException(status_code=400, detail="Cannot buy your own property")
    _restore = lambda: db.properties.update_one({"_id": ObjectId(property_id)}, {"$set": {"for_sale": True}})
    prop_type = prop.get("type") or ""
    if prop_type.startswith("casino_") or prop_type == "airport" or prop_type == "bullet_factory":
        rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
        prestige_level = int(current_user.get("prestige_level") or 0)
        if rank_id < CAPO_RANK_ID and prestige_level < 1:
            await _restore()
            raise HTTPException(status_code=403, detail="You must be rank Capo or higher to buy a casino or property. Reach Capo to hold one.")
    buyer = await db.users.find_one({"id": buyer_id})
    if not buyer:
        await _restore()
        raise HTTPException(status_code=404, detail="User not found")
    sale_price = prop.get("sale_price", 0)
    if prop.get("type") == "airport":
        owned = await _user_owns_any_property(buyer_id)
        if owned:
            await _restore()
            raise HTTPException(status_code=400, detail="You may only own one property. Relinquish it first.")
    if prop.get("type") == "bullet_factory":
        owned = await _user_owns_any_property(buyer_id)
        if owned:
            await _restore()
            raise HTTPException(status_code=400, detail="You may only own one property. Relinquish it first.")
    result = await db.users.update_one(
        {"id": buyer_id, "points": {"$gte": sale_price}},
        {"$inc": {"points": -sale_price}}
    )
    if result.modified_count == 0:
        await _restore()
        raise HTTPException(status_code=400, detail="Insufficient points")
    if sale_price != 0:
        await log_points_event(db, user_id=buyer_id, points=-sale_price, event_type="quicktrade_property", meta={"property_id": property_id, "property_name": prop.get("name"), "property_type": prop.get("type")})
    if prop.get("owner_id"):
        await db.users.update_one({"id": prop["owner_id"]}, {"$inc": {"points": sale_price}})
        if sale_price != 0:
            await log_points_event(db, user_id=prop["owner_id"], points=sale_price, event_type="quicktrade_property", meta={"property_id": property_id, "property_name": prop.get("name"), "buyer_id": buyer_id})
        loc = prop.get("location") or prop.get("state")
        loc_suffix = f" ({loc})" if loc else ""
        await _notify_quicktrade_seller(
            prop["owner_id"],
            "Quick Trade: property sold",
            f"{buyer_username} bought your listing: {prop.get('name', 'Property')}{loc_suffix} for {sale_price:,} points.",
        )
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


async def cancel_property_listing(property_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    prop = await db.properties.find_one_and_update(
        {"_id": ObjectId(property_id), "owner_id": user_id, "for_sale": True},
        {"$set": {"for_sale": False, "cancelled_at": datetime.now(timezone.utc)}, "$unset": {"sale_price": 1}},
    )
    if not prop:
        raise HTTPException(status_code=404, detail="Property listing not found or already cancelled")
    _invalidate_trade_caches()
    return {"message": "Property listing cancelled", "property_name": prop.get("name", "Property")}


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
    router.add_api_route("/trade/property/{property_id}/cancel", cancel_property_listing, methods=["POST"])
    router.add_api_route("/trade/sell-offer/{offer_id}/cancel", cancel_sell_offer_post, methods=["POST"])
    router.add_api_route("/trade/buy-offer/{offer_id}/cancel", cancel_buy_offer_post, methods=["POST"])
    router.add_api_route("/trade/token-offers", get_token_offers, methods=["GET"])
    router.add_api_route("/trade/my-token-balances", get_my_token_balances, methods=["GET"])
    router.add_api_route("/trade/token-offer", create_token_offer, methods=["POST"])
    router.add_api_route("/trade/token-offer/{offer_id}/accept", accept_token_offer, methods=["POST"])
    router.add_api_route("/trade/token-offer/{offer_id}/cancel", cancel_token_offer, methods=["POST"])
