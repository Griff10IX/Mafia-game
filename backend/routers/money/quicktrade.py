# Quick Trade: sell/buy points (with fee, hide_name limits), property listings and purchase
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import time
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from fastapi import Depends, HTTPException
from bson.objectid import ObjectId

from server import (
    db,
    get_current_user,
    get_rank_info,
    user_prestige_rank_mult,
    log_activity,
    CAPO_RANK_ID,
    CASINO_MIN_OWNER_MAX_BET,
    _user_owns_airport,
    _user_owns_bullet_factory,
    _user_owns_garage_dealership,
    send_notification,
    _is_admin,
    refund_casino_buy_back_escrow_points,
    refund_and_delete_buy_back_offers_matching,
)
from routers.kill.armoury import TOKEN_CONFIG, TOKEN_TYPES
from utils.point_provenance import log_points_event
from utils.civilian_protection import maybe_revoke_civilian_protection
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_QUICKTRADE
from utils.quicktrade_casino_cleanup import cancel_quicktrade_casino_listings_by_locations


async def _quicktrade_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_QUICKTRADE)


_quicktrade_rl_u = [Depends(_quicktrade_sustained_rl_user)]

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


async def _notify_quicktrade_inbox(user_id: Optional[str], title: str, message: str, notification_type: str = "quicktrade_sale") -> None:
    """Deliver a Quick Trade message to the user's notification inbox (respects notification_preferences.quicktrade)."""
    if not user_id:
        return
    try:
        await send_notification(user_id, title, message, notification_type, category="quicktrade")
    except Exception:
        pass


def _same_user_id(a, b) -> bool:
    """Compare user ids from JWT vs Mongo (string vs ObjectId safe)."""
    if a is None or b is None:
        return False
    return str(a) == str(b)


def _qt_list_username(offer: dict, viewer: dict) -> str:
    """Public list label: hide_name masks username unless viewer is admin (not acting as normal)."""
    hide = bool(offer.get("hide_name"))
    real = offer.get("username") or "Anonymous"
    if hide and not _is_admin(viewer):
        return "[Anonymous]"
    return real


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


async def _log_qt_sell_offer_accept_transfers(
    *,
    seller_id: str,
    seller_username: str,
    buyer_id: str,
    buyer_username: str,
    points_amount: int,
    cash_amount: int,
    seller_hide_name: bool,
    created_at_iso: str,
) -> None:
    """Points + cash ledger rows for someone buying a sell listing (Store + Bank history)."""
    if points_amount <= 0 and cash_amount <= 0:
        return
    seller_un = (seller_username or "?").strip() or "?"
    buyer_un = (buyer_username or "?").strip() or "?"
    bu, su = await asyncio.gather(
        db.users.find_one({"id": buyer_id}, {"_id": 0, "points": 1, "money": 1}),
        db.users.find_one({"id": seller_id}, {"_id": 0, "points": 1, "money": 1}),
    )
    buyer_pts_after = int((bu or {}).get("points") or 0)
    seller_pts_after = int((su or {}).get("points") or 0)
    buyer_money_after = int((bu or {}).get("money") or 0)
    seller_money_after = int((su or {}).get("money") or 0)
    if points_amount > 0:
        rp_before = buyer_pts_after - points_amount
        await db.points_transfers.insert_one({
            "id": str(uuid.uuid4()),
            "from_user_id": seller_id,
            "from_username": seller_un,
            "to_user_id": buyer_id,
            "to_username": buyer_un,
            "amount": points_amount,
            "created_at": created_at_iso,
            "sender_points_before": seller_pts_after,
            "sender_points_after": seller_pts_after,
            "recipient_points_before": rp_before,
            "recipient_points_after": buyer_pts_after,
            "qt_anonymize_from": bool(seller_hide_name),
            "qt_anonymize_to": False,
        })
    if cash_amount > 0:
        await db.money_transfers.insert_one({
            "id": str(uuid.uuid4()),
            "from_user_id": buyer_id,
            "from_username": buyer_un,
            "to_user_id": seller_id,
            "to_username": seller_un,
            "amount": cash_amount,
            "created_at": created_at_iso,
            "sender_money_before": buyer_money_after + cash_amount,
            "sender_money_after": buyer_money_after,
            "recipient_money_before": seller_money_after - cash_amount,
            "recipient_money_after": seller_money_after,
            "transfer_kind": "quicktrade",
            "qt_anonymize_from": False,
            "qt_anonymize_to": bool(seller_hide_name),
        })
    try:
        from routers.money.bank import _invalidate_overview_cache

        _invalidate_overview_cache(buyer_id)
        _invalidate_overview_cache(seller_id)
    except Exception:
        pass


async def _log_qt_buy_offer_accept_transfers(
    *,
    buyer_id: str,
    buyer_username: str,
    seller_id: str,
    seller_username: str,
    points_amount: int,
    cash_amount: int,
    buyer_hide_name: bool,
    created_at_iso: str,
) -> None:
    """Points + cash ledger rows for seller filling a buy offer (Store + Bank history)."""
    if points_amount <= 0 and cash_amount <= 0:
        return
    seller_un = (seller_username or "?").strip() or "?"
    buyer_un = (buyer_username or "?").strip() or "?"
    bu, su = await asyncio.gather(
        db.users.find_one({"id": buyer_id}, {"_id": 0, "points": 1, "money": 1}),
        db.users.find_one({"id": seller_id}, {"_id": 0, "points": 1, "money": 1}),
    )
    buyer_pts_after = int((bu or {}).get("points") or 0)
    seller_pts_after = int((su or {}).get("points") or 0)
    buyer_money_after = int((bu or {}).get("money") or 0)
    seller_money_after = int((su or {}).get("money") or 0)
    if points_amount > 0:
        rp_before = buyer_pts_after - points_amount
        sp_before = seller_pts_after + points_amount
        await db.points_transfers.insert_one({
            "id": str(uuid.uuid4()),
            "from_user_id": seller_id,
            "from_username": seller_un,
            "to_user_id": buyer_id,
            "to_username": buyer_un,
            "amount": points_amount,
            "created_at": created_at_iso,
            "sender_points_before": sp_before,
            "sender_points_after": seller_pts_after,
            "recipient_points_before": rp_before,
            "recipient_points_after": buyer_pts_after,
            "qt_anonymize_from": False,
            "qt_anonymize_to": bool(buyer_hide_name),
        })
    if cash_amount > 0:
        await db.money_transfers.insert_one({
            "id": str(uuid.uuid4()),
            "from_user_id": buyer_id,
            "from_username": buyer_un,
            "to_user_id": seller_id,
            "to_username": seller_un,
            "amount": cash_amount,
            "created_at": created_at_iso,
            "sender_money_before": buyer_money_after,
            "sender_money_after": buyer_money_after,
            "recipient_money_before": seller_money_after - cash_amount,
            "recipient_money_after": seller_money_after,
            "transfer_kind": "quicktrade",
            "qt_anonymize_from": bool(buyer_hide_name),
            "qt_anonymize_to": False,
        })
    try:
        from routers.money.bank import _invalidate_overview_cache

        _invalidate_overview_cache(buyer_id)
        _invalidate_overview_cache(seller_id)
    except Exception:
        pass


async def cancel_offers_on_death(user_id: str):
    """
    When a user dies: cancel all their active sell, buy, and token offers.
    Sell listings: refund points (same amounts as manual cancel — original_points, including fee).
    Buy listings: refund escrowed cash (the ``offer`` field).
    Token listings: return tokens to the user's inventory.
    """
    now = datetime.now(timezone.utc)
    # One offer at a time: cancel in DB before refund so a retry after a crash cannot double-refund.
    while True:
        offer = await db.trade_sell_offers.find_one_and_update(
            {"user_id": user_id, "status": "active"},
            {"$set": {"status": "cancelled", "cancelled_at": now}},
        )
        if not offer:
            break
        pts = int(offer.get("original_points") or offer.get("points") or 0)
        if pts != 0:
            await db.users.update_one({"id": user_id}, {"$inc": {"points": pts}})
            try:
                await log_points_event(
                    db,
                    user_id=user_id,
                    points=pts,
                    event_type="quicktrade_cancel",
                    meta={
                        "direction": "sell_cancel_on_death",
                        "offer_id": str(offer.get("_id", "")),
                        "fee_refunded": int(offer.get("fee") or 0),
                    },
                )
            except Exception:
                pass
        try:
            await db.trade_events.insert_one(
                {
                    "id": str(offer.get("_id", "")),
                    "type": "sell_offer_cancelled",
                    "user_id": user_id,
                    "username": offer.get("username") or "?",
                    "points": pts,
                    "fee": offer.get("fee", 0),
                    "direction": "sell",
                    "reason": "death",
                    "at": now,
                }
            )
        except Exception:
            pass

    while True:
        offer = await db.trade_buy_offers.find_one_and_update(
            {"user_id": user_id, "status": "active"},
            {"$set": {"status": "cancelled", "cancelled_at": now}},
        )
        if not offer:
            break
        cash = int(offer.get("offer") or 0)
        if cash != 0:
            await db.users.update_one({"id": user_id}, {"$inc": {"money": cash}})
        try:
            await db.trade_events.insert_one(
                {
                    "id": str(offer.get("_id", "")),
                    "type": "buy_offer_cancelled",
                    "user_id": user_id,
                    "username": offer.get("username") or "?",
                    "points": offer.get("points", 0),
                    "fee": offer.get("fee", 0),
                    "direction": "buy",
                    "reason": "death",
                    "at": now,
                }
            )
        except Exception:
            pass
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
            "username": _qt_list_username(offer, current_user),
            "group_key": group_key,
            "points": offer["points"],
            "money": offer["cost"],
            "hide_name": offer.get("hide_name", False),
            "created_at": offer.get("created_at"),
            "is_own": _same_user_id(uid, current_user.get("id")),
        })
    return result


async def create_sell_offer(offer: CreateSellOffer, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    username = current_user.get("username", "Unknown")
    if offer.points <= 0 or offer.cost <= 0:
        raise HTTPException(status_code=400, detail="Points and cost must be positive")
    per_point = offer.cost / offer.points
    if per_point < 50_000:
        raise HTTPException(status_code=400, detail="Minimum price is $50,000 per point")
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
    try:
        await _log_qt_sell_offer_accept_transfers(
            seller_id=offer["user_id"],
            seller_username=(offer.get("username") or "Unknown"),
            buyer_id=buyer_id,
            buyer_username=buyer_username,
            points_amount=int(offer.get("points") or 0),
            cash_amount=int(offer.get("cost") or 0),
            seller_hide_name=bool(offer.get("hide_name")),
            created_at_iso=now.isoformat(),
        )
    except Exception:
        logger.exception("quicktrade accept_sell_offer transfer ledger failed offer_id=%s", offer_id)
    _invalidate_trade_caches()
    _seller_u = (offer.get("username") or "Unknown").strip() or "Unknown"
    _pts = int(offer.get("points") or 0)
    _cash = int(offer.get("cost") or 0)
    _admin_summary = f"{buyer_username} bought {_seller_u}'s sell listing for ${_cash:,} cash → {_pts:,} points."
    await log_activity(
        buyer_id,
        buyer_username,
        "quicktrade_accept_sell",
        {
            "seller_id": offer["user_id"],
            "seller_username": _seller_u,
            "buyer_username": buyer_username,
            "points": _pts,
            "cash": _cash,
            "points_received": _pts,
            "cost_paid": _cash,
            "offer_id": offer_id,
            "seller_listed_anonymous": bool(offer.get("hide_name")),
            "admin_summary": _admin_summary,
            "audit_cash": _cash,
        },
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
    await _notify_quicktrade_inbox(
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
                "username": offer.get("username") or current_user.get("username") or "Unknown",
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
                "username": offer.get("username") or current_user.get("username") or "Unknown",
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
            "is_own": _same_user_id(offer.get("user_id"), current_user.get("id")),
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
        await _notify_quicktrade_inbox(
            offer["user_id"],
            "Quick Trade: tokens sold",
            f"{buyer_username} bought your listing: {int(offer['quantity']):,}× {_token_type_label(token_type)} for ${price_money:,} cash.",
        )
        try:
            await db.trade_events.insert_one(
                {
                    "id": str(offer_id),
                    "type": "token_offer_accepted",
                    "direction": "token",
                    "seller_id": offer["user_id"],
                    "seller_username": offer.get("username"),
                    "buyer_id": buyer_id,
                    "buyer_username": buyer_username,
                    "token_type": token_type,
                    "quantity": int(offer["quantity"]),
                    "price_currency": "money",
                    "points": 0,
                    "money": int(price_money),
                    "at": datetime.now(timezone.utc),
                }
            )
        except Exception:
            pass
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
    await _notify_quicktrade_inbox(
        offer["user_id"],
        "Quick Trade: tokens sold",
        f"{buyer_username} bought your listing: {int(offer['quantity']):,}× {_token_type_label(token_type)} for {price_points:,} points.",
    )
    try:
        await db.trade_events.insert_one(
            {
                "id": str(offer_id),
                "type": "token_offer_accepted",
                "direction": "token",
                "seller_id": offer["user_id"],
                "seller_username": offer.get("username"),
                "buyer_id": buyer_id,
                "buyer_username": buyer_username,
                "token_type": token_type,
                "quantity": int(offer["quantity"]),
                "price_currency": "points",
                "points": int(price_points),
                "money": 0,
                "at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass
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
            "username": _qt_list_username(offer, current_user),
            "group_key": group_key,
            "points": offer["points"],
            "cost": offer["offer"],
            "hide_name": offer.get("hide_name", False),
            "created_at": offer.get("created_at"),
            "is_own": _same_user_id(uid, current_user.get("id")),
        })
    return result


async def create_buy_offer(offer: CreateBuyOffer, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    username = current_user.get("username", "Unknown")
    if offer.points <= 0 or offer.offer <= 0:
        raise HTTPException(status_code=400, detail="Points and offer must be positive")
    per_point = offer.offer / offer.points
    if per_point < 50_000:
        raise HTTPException(status_code=400, detail="Minimum price is $50,000 per point")
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
    try:
        await _log_qt_buy_offer_accept_transfers(
            buyer_id=offer["user_id"],
            buyer_username=(offer.get("username") or "Unknown"),
            seller_id=seller_id,
            seller_username=seller_username,
            points_amount=int(offer.get("points") or 0),
            cash_amount=int(offer.get("offer") or 0),
            buyer_hide_name=bool(offer.get("hide_name")),
            created_at_iso=now.isoformat(),
        )
    except Exception:
        logger.exception("quicktrade accept_buy_offer transfer ledger failed offer_id=%s", offer_id)
    _invalidate_trade_caches()
    _buyer_real = (offer.get("username") or "Unknown").strip() or "Unknown"
    _buyer_disp = "[Anonymous]" if offer.get("hide_name") else _buyer_real
    _b_pts = int(offer.get("points") or 0)
    _b_cash = int(offer.get("offer") or 0)
    _buy_admin_summary = f"{seller_username} sold {_b_pts:,} points into {_buyer_disp}'s buy order for ${_b_cash:,} cash."
    await log_activity(
        seller_id,
        seller_username,
        "quicktrade_accept_buy",
        {
            "buyer_id": offer["user_id"],
            "buyer_username": _buyer_real,
            "buyer_display": _buyer_disp,
            "seller_username": seller_username,
            "points": _b_pts,
            "cash": _b_cash,
            "points_sold": _b_pts,
            "cash_received": _b_cash,
            "offer_id": offer_id,
            "admin_summary": _buy_admin_summary,
            "audit_cash": _b_cash,
        },
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
    buyer_disp = "[Anonymous]" if offer.get("hide_name") else (offer.get("username") or "Unknown")
    await _notify_quicktrade_inbox(
        offer["user_id"],
        "Quick Trade: buy offer filled",
        f"{seller_username} filled your buy offer. You received {int(offer['points']):,} points; they received your ${int(offer['offer']):,} cash.",
        notification_type="quicktrade_buy_filled",
    )
    await _notify_quicktrade_inbox(
        seller_id,
        "Quick Trade: buy order completed",
        f"You sold {int(offer['points']):,} points for ${int(offer['offer']):,} cash (filled {buyer_disp}'s buy offer).",
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
                "username": offer.get("username") or current_user.get("username") or "Unknown",
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
                "username": offer.get("username") or current_user.get("username") or "Unknown",
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
    """List properties for sale. Cache is per-listing data only; is_own is computed per viewer (never cache is_own)."""
    global _properties_cache, _properties_ts
    now = time.monotonic()
    me = current_user.get("id")
    if _properties_cache is None or now > _properties_ts + _LIST_TTL_SEC:
        try:
            properties = await db.properties.find({"for_sale": True, "type": {"$ne": "casino_slots"}}).sort("created_at", -1).to_list(length=100)
            cached = []
            for prop in properties:
                cached.append({
                    "id": str(prop["_id"]),
                    "location": prop.get("location", "Unknown"),
                    "property_name": prop.get("name", "Property"),
                    "owner": prop.get("owner_username", "Unknown"),
                    "_owner_id": prop.get("owner_id"),
                    "points": prop.get("sale_price", 0),
                    "created_at": prop.get("created_at"),
                })
            _properties_cache = cached
            _properties_ts = now
        except Exception as e:
            print(f"Error fetching properties: {e}")
            return []
    out = []
    for row in _properties_cache or []:
        oid = row.get("_owner_id")
        out.append({
            "id": row["id"],
            "location": row["location"],
            "property_name": row["property_name"],
            "owner": row["owner"],
            "is_own": _same_user_id(oid, me),
            "points": row["points"],
            "created_at": row.get("created_at"),
        })
    return out


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
    if prop_type.startswith("casino_") or prop_type in ("airport", "bullet_factory", "garage_dealership"):
        rank_id, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
        prestige_level = int(current_user.get("prestige_level") or 0)
        if rank_id < CAPO_RANK_ID and prestige_level < 1:
            await _restore()
            raise HTTPException(status_code=403, detail="You must be rank Capo or higher to buy a casino or property. Reach Capo to hold one.")
    buyer = await db.users.find_one({"id": buyer_id})
    if not buyer:
        await _restore()
        raise HTTPException(status_code=404, detail="User not found")
    if (prop.get("type") or "") == "family":
        from routers.game.families import validate_family_quicktrade_buy

        try:
            await validate_family_quicktrade_buy(prop, buyer)
        except HTTPException:
            await _restore()
            raise
    sale_price = prop.get("sale_price", 0)
    if prop.get("type") == "airport":
        if await _user_owns_airport(buyer_id):
            await _restore()
            raise HTTPException(status_code=400, detail="You already own an airport. Relinquish it first.")
    if prop.get("type") == "bullet_factory":
        if await _user_owns_bullet_factory(buyer_id):
            await _restore()
            raise HTTPException(status_code=400, detail="You already own an armoury. Relinquish it first.")
    if prop.get("type") == "garage_dealership":
        if await _user_owns_garage_dealership(buyer_id):
            await _restore()
            raise HTTPException(status_code=400, detail="You already own the car dealership. Relinquish it first.")
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
        await _notify_quicktrade_inbox(
            prop["owner_id"],
            "Quick Trade: property sold",
            f"{buyer_username} bought your listing: {prop.get('name', 'Property')}{loc_suffix} for {sale_price:,} points.",
        )
    prop_type = prop.get("type")
    seller_id = prop.get("owner_id")
    if prop_type == "casino_dice":
        city = prop.get("location")
        if city:
            if seller_id:
                sdoc = await db.dice_ownership.find_one({"city": city}, {"buy_back_points_held": 1})
                held = int((sdoc or {}).get("buy_back_points_held") or 0)
                await refund_casino_buy_back_escrow_points(
                    seller_id, held, event_type="casino_dice", meta={"city": city, "reason": "quicktrade_sale"}
                )
                await refund_and_delete_buy_back_offers_matching(
                    "dice_buy_back_offers",
                    {"city": city},
                    points_event_type="casino_dice",
                    meta_base={"city": city, "reason": "quicktrade_sale"},
                )
            await db.dice_ownership.update_one(
                {"city": city},
                {
                    "$set": {
                        "owner_id": buyer_id,
                        "owner_username": buyer_username,
                        "max_bet": CASINO_MIN_OWNER_MAX_BET,
                        "buy_back_reward": 0,
                        "buy_back_points_held": 0,
                    }
                },
                upsert=True,
            )
    elif prop_type == "casino_rlt":
        city = prop.get("location")
        if city:
            if seller_id:
                sdoc = await db.roulette_ownership.find_one({"city": city}, {"buy_back_points_held": 1})
                held = int((sdoc or {}).get("buy_back_points_held") or 0)
                await refund_casino_buy_back_escrow_points(
                    seller_id, held, event_type="casino_roulette", meta={"city": city, "reason": "quicktrade_sale"}
                )
                await refund_and_delete_buy_back_offers_matching(
                    "roulette_buy_back_offers",
                    {"city": city},
                    points_event_type="casino_roulette",
                    meta_base={"city": city, "reason": "quicktrade_sale"},
                )
            await db.roulette_ownership.update_one(
                {"city": city},
                {
                    "$set": {
                        "owner_id": buyer_id,
                        "owner_username": buyer_username,
                        "max_bet": CASINO_MIN_OWNER_MAX_BET,
                        "buy_back_reward": 0,
                        "buy_back_points_held": 0,
                    }
                },
                upsert=True,
            )
    elif prop_type == "casino_blackjack":
        city = prop.get("location")
        if city:
            if seller_id:
                sdoc = await db.blackjack_ownership.find_one({"city": city}, {"buy_back_points_held": 1})
                held = int((sdoc or {}).get("buy_back_points_held") or 0)
                await refund_casino_buy_back_escrow_points(
                    seller_id, held, event_type="casino_blackjack", meta={"city": city, "reason": "quicktrade_sale"}
                )
                await refund_and_delete_buy_back_offers_matching(
                    "blackjack_buy_back_offers",
                    {"city": city},
                    points_event_type="casino_blackjack",
                    meta_base={"city": city, "reason": "quicktrade_sale"},
                )
            await db.blackjack_ownership.update_one(
                {"city": city},
                {
                    "$set": {
                        "owner_id": buyer_id,
                        "owner_username": buyer_username,
                        "max_bet": CASINO_MIN_OWNER_MAX_BET,
                        "buy_back_reward": 0,
                        "buy_back_points_held": 0,
                    }
                },
                upsert=True,
            )
    elif prop_type == "casino_horseracing":
        city = prop.get("location")
        if city:
            if seller_id:
                sdoc = await db.horseracing_ownership.find_one({"city": city}, {"buy_back_points_held": 1})
                held = int((sdoc or {}).get("buy_back_points_held") or 0)
                await refund_casino_buy_back_escrow_points(
                    seller_id, held, event_type="casino_horseracing", meta={"city": city, "reason": "quicktrade_sale"}
                )
                await refund_and_delete_buy_back_offers_matching(
                    "horseracing_buy_back_offers",
                    {"city": city},
                    points_event_type="casino_horseracing",
                    meta_base={"city": city, "reason": "quicktrade_sale"},
                )
            await db.horseracing_ownership.update_one(
                {"city": city},
                {
                    "$set": {
                        "owner_id": buyer_id,
                        "owner_username": buyer_username,
                        "max_bet": CASINO_MIN_OWNER_MAX_BET,
                        "buy_back_reward": 0,
                        "buy_back_points_held": 0,
                    }
                },
                upsert=True,
            )
    elif prop_type == "casino_videopoker":
        city = prop.get("location")
        if city:
            if seller_id:
                sdoc = await db.videopoker_ownership.find_one({"city": city}, {"buy_back_points_held": 1})
                held = int((sdoc or {}).get("buy_back_points_held") or 0)
                await refund_casino_buy_back_escrow_points(
                    seller_id, held, event_type="casino_video_poker", meta={"city": city, "reason": "quicktrade_sale"}
                )
                await refund_and_delete_buy_back_offers_matching(
                    "videopoker_buy_back_offers",
                    {"city": city},
                    points_event_type="casino_video_poker",
                    meta_base={"city": city, "reason": "quicktrade_sale"},
                )
            await db.videopoker_ownership.update_one(
                {"city": city},
                {
                    "$set": {
                        "owner_id": buyer_id,
                        "owner_username": buyer_username,
                        "max_bet": CASINO_MIN_OWNER_MAX_BET,
                        "buy_back_reward": 0,
                        "buy_back_points_held": 0,
                    }
                },
                upsert=True,
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
    elif prop_type == "garage_dealership":
        from utils.garage_dealership import GARAGE_DEALERSHIP_ID
        await db.garage_dealership.update_one(
            {"id": GARAGE_DEALERSHIP_ID},
            {"$set": {"owner_id": buyer_id, "owner_username": buyer_username}},
            upsert=True,
        )
    elif prop_type == "family":
        from routers.game.families import complete_family_quicktrade_sale

        await complete_family_quicktrade_sale(
            family_id=str(prop.get("family_id") or ""),
            seller_id=str(seller_id or ""),
            buyer_id=buyer_id,
            buyer_username=buyer_username,
        )
    # Remove any duplicate/stale casino rows for this slot (only `for_sale: true` docs; purchased row was already marked not for sale).
    if (prop_type or "").startswith("casino_"):
        loc = prop.get("location")
        if loc:
            await cancel_quicktrade_casino_listings_by_locations(prop_type, loc, loc)
    try:
        await db.trade_events.insert_one(
            {
                "id": str(property_id),
                "type": "property_purchase",
                "direction": "property",
                "seller_id": prop.get("owner_id"),
                "seller_username": prop.get("owner_username"),
                "buyer_id": buyer_id,
                "buyer_username": buyer_username,
                "property_name": prop.get("name"),
                "points": int(sale_price or 0),
                "money": 0,
                "at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass
    await db.properties.delete_one({"_id": ObjectId(property_id)})
    _invalidate_trade_caches()
    await maybe_revoke_civilian_protection(db, buyer_id, "received_property_transfer")
    return {"message": "Property purchased successfully", "property_name": prop.get("name", "Property"), "points_spent": sale_price}


async def cancel_property_listing(property_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    oid = ObjectId(property_id)
    prop = await db.properties.find_one({"_id": oid, "for_sale": True})
    if not prop:
        raise HTTPException(status_code=404, detail="Property listing not found or already cancelled")
    allowed = _same_user_id(prop.get("owner_id"), user_id)
    if not allowed and prop.get("type") == "family" and prop.get("family_id"):
        fam = await db.families.find_one({"id": prop["family_id"]}, {"_id": 0, "boss_id": 1})
        if fam and _same_user_id(fam.get("boss_id"), user_id):
            allowed = True
    if not allowed:
        raise HTTPException(status_code=404, detail="Property listing not found or already cancelled")
    await db.properties.update_one(
        {"_id": oid},
        {"$set": {"for_sale": False, "cancelled_at": datetime.now(timezone.utc)}, "$unset": {"sale_price": 1}},
    )
    _invalidate_trade_caches()
    return {"message": "Property listing cancelled", "property_name": prop.get("name", "Property")}


def _admin_cancel_reason_meta(actor_user_id: str, reason: Optional[str]) -> Dict[str, Any]:
    meta: Dict[str, Any] = {"admin_cancel": True, "actor_user_id": str(actor_user_id or "")}
    if reason and str(reason).strip():
        meta["reason"] = str(reason).strip()[:500]
    return meta


async def force_cancel_sell_offer_by_id(
    offer_id: str,
    *,
    actor_user_id: str,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Cancel any active sell offer; refund full deducted points to lister. Raises ValueError on bad id / not found."""
    try:
        oid = ObjectId(offer_id)
    except Exception as exc:
        raise ValueError("Invalid offer id") from exc
    now = datetime.now(timezone.utc)
    offer = await db.trade_sell_offers.find_one_and_update(
        {"_id": oid, "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": now}},
    )
    if not offer:
        raise ValueError("Sell offer not found or already cancelled")
    user_id = offer["user_id"]
    original_points = int(offer.get("original_points", offer["points"]) or 0)
    await db.users.update_one({"id": user_id}, {"$inc": {"points": original_points}})
    if original_points != 0:
        am = _admin_cancel_reason_meta(actor_user_id, reason)
        am.update({"offer_id": offer_id, "direction": "sell_cancel"})
        await log_points_event(db, user_id=user_id, points=original_points, event_type="quicktrade_cancel", meta=am)
    _invalidate_trade_caches()
    try:
        await db.trade_events.insert_one(
            {
                "id": str(offer_id),
                "type": "sell_offer_cancelled",
                "user_id": user_id,
                "username": offer.get("username") or "Unknown",
                "points": original_points,
                "fee": offer.get("fee", 0),
                "direction": "sell",
                "at": now,
                **_admin_cancel_reason_meta(actor_user_id, reason),
            }
        )
    except Exception:
        pass
    return {
        "ok": True,
        "kind": "sell",
        "offer_id": offer_id,
        "user_id": user_id,
        "refunded_points": original_points,
    }


async def force_cancel_buy_offer_by_id(
    offer_id: str,
    *,
    actor_user_id: str,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Cancel any active buy offer; refund escrowed cash. Raises ValueError on bad id / not found."""
    try:
        oid = ObjectId(offer_id)
    except Exception as exc:
        raise ValueError("Invalid offer id") from exc
    now = datetime.now(timezone.utc)
    offer = await db.trade_buy_offers.find_one_and_update(
        {"_id": oid, "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": now}},
    )
    if not offer:
        raise ValueError("Buy offer not found or already cancelled")
    user_id = offer["user_id"]
    cash = int(offer.get("offer") or 0)
    await db.users.update_one({"id": user_id}, {"$inc": {"money": cash}})
    _invalidate_trade_caches()
    try:
        await db.trade_events.insert_one(
            {
                "id": str(offer_id),
                "type": "buy_offer_cancelled",
                "user_id": user_id,
                "username": offer.get("username") or "Unknown",
                "points": offer.get("points"),
                "fee": offer.get("fee", 0),
                "direction": "buy",
                "cash_refunded": cash,
                "at": now,
                **_admin_cancel_reason_meta(actor_user_id, reason),
            }
        )
    except Exception:
        pass
    return {"ok": True, "kind": "buy", "offer_id": offer_id, "user_id": user_id, "refunded_cash": cash}


async def force_cancel_token_offer_by_id(
    offer_id: str,
    *,
    actor_user_id: str,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Cancel any active token offer; return tokens to seller. Raises ValueError on bad id / not found / bad type."""
    try:
        oid = ObjectId(offer_id)
    except Exception as exc:
        raise ValueError("Invalid offer id") from exc
    now = datetime.now(timezone.utc)
    offer = await db.trade_token_offers.find_one_and_update(
        {"_id": oid, "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": now}},
    )
    if not offer:
        raise ValueError("Token offer not found or already cancelled")
    token_type = offer.get("token_type")
    cfg = TOKEN_CONFIG.get(token_type) or {}
    field = cfg.get("count_field")
    if not field:
        raise ValueError("Unknown token type on offer")
    user_id = offer["user_id"]
    qty = int(offer.get("quantity") or 0)
    await db.users.update_one({"id": user_id}, {"$inc": {field: qty}})
    _invalidate_trade_caches()
    try:
        await db.trade_events.insert_one(
            {
                "id": str(offer_id),
                "type": "token_offer_cancelled",
                "user_id": user_id,
                "token_type": token_type,
                "quantity": qty,
                "at": now,
                **_admin_cancel_reason_meta(actor_user_id, reason),
            }
        )
    except Exception:
        pass
    return {
        "ok": True,
        "kind": "token",
        "offer_id": offer_id,
        "user_id": user_id,
        "token_type": token_type,
        "quantity_returned": qty,
    }


async def force_cancel_property_listing_by_id(
    property_id: str,
    *,
    actor_user_id: str,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Unlist any active Quick Trade property row (admin). Raises ValueError if invalid id or not listed."""
    try:
        oid = ObjectId(property_id)
    except Exception as exc:
        raise ValueError("Invalid property id") from exc
    now = datetime.now(timezone.utc)
    prop = await db.properties.find_one_and_update(
        {"_id": oid, "for_sale": True},
        {"$set": {"for_sale": False, "cancelled_at": now}, "$unset": {"sale_price": 1}},
    )
    if not prop:
        raise ValueError("Property listing not found or already cancelled")
    _invalidate_trade_caches()
    try:
        await db.trade_events.insert_one(
            {
                "id": str(property_id),
                "type": "property_listing_cancelled",
                "user_id": prop.get("owner_id"),
                "property_name": prop.get("name"),
                "at": now,
                **_admin_cancel_reason_meta(actor_user_id, reason),
            }
        )
    except Exception:
        pass
    return {
        "ok": True,
        "kind": "property",
        "property_id": property_id,
        "owner_id": prop.get("owner_id"),
        "property_name": prop.get("name", "Property"),
    }


_CASINO_QUICKTRADE_TYPES = (
    "casino_blackjack",
    "casino_dice",
    "casino_rlt",
    "casino_horseracing",
    "casino_videopoker",
)


def _property_created_sort_key(prop: Dict[str, Any]) -> tuple:
    """Sort key for newest-first: use with sorted(..., reverse=True)."""
    c = prop.get("created_at")
    ts = 0.0
    if c is not None:
        if hasattr(c, "timestamp"):
            try:
                ts = float(c.timestamp())
            except Exception:
                ts = 0.0
        elif isinstance(c, str):
            try:
                ts = float(datetime.fromisoformat(c.replace("Z", "+00:00")).timestamp())
            except Exception:
                ts = 0.0
    oid = prop.get("_id")
    oid_part = str(oid) if oid is not None else ""
    return (ts, oid_part)


async def admin_quicktrade_deduplicate_casino_listings(
    *,
    actor_user_id: str,
    dry_run: bool = False,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """
    For each (casino type, city, owner) with more than one active Quick Trade row, keep the newest listing
    and admin-cancel the rest (same unlist behaviour as cancel-property).
    """
    actor = str(actor_user_id or "").strip()
    if not actor:
        raise ValueError("actor_user_id required")
    docs = await db.properties.find(
        {"for_sale": True, "type": {"$in": list(_CASINO_QUICKTRADE_TYPES)}},
        {"_id": 1, "type": 1, "location": 1, "owner_id": 1, "sale_price": 1, "name": 1, "owner_username": 1, "created_at": 1},
    ).to_list(3000)
    groups: Dict[tuple, List[dict]] = {}
    for p in docs:
        t = str(p.get("type") or "").strip()
        loc = str(p.get("location") or "").strip()
        oid = str(p.get("owner_id") or "").strip()
        if not t or not loc or not oid:
            continue
        key = (t, loc, oid)
        groups.setdefault(key, []).append(p)
    dedupe_reason = (reason or "").strip() or "admin dedupe duplicate casino Quick Trade listings"
    cancelled: List[Dict[str, Any]] = []
    kept: List[Dict[str, Any]] = []
    duplicate_groups = 0
    for key, rows in groups.items():
        if len(rows) <= 1:
            continue
        duplicate_groups += 1
        rows_sorted = sorted(rows, key=_property_created_sort_key, reverse=True)
        winner = rows_sorted[0]
        losers = rows_sorted[1:]
        kept.append(
            {
                "property_id": str(winner["_id"]),
                "type": winner.get("type"),
                "location": winner.get("location"),
                "owner_id": winner.get("owner_id"),
                "owner_username": winner.get("owner_username"),
                "sale_price": winner.get("sale_price"),
                "name": winner.get("name"),
            }
        )
        for p in losers:
            pid = str(p["_id"])
            entry = {
                "property_id": pid,
                "type": p.get("type"),
                "location": p.get("location"),
                "owner_id": p.get("owner_id"),
                "owner_username": p.get("owner_username"),
                "sale_price": p.get("sale_price"),
                "name": p.get("name"),
            }
            if dry_run:
                entry["dry_run"] = True
                cancelled.append(entry)
            else:
                await force_cancel_property_listing_by_id(pid, actor_user_id=actor, reason=dedupe_reason)
                cancelled.append(entry)
    return {
        "ok": True,
        "dry_run": dry_run,
        "duplicate_groups": duplicate_groups,
        "cancelled_count": len(cancelled),
        "kept_count": len(kept),
        "cancelled": cancelled,
        "kept": kept,
    }


def _serialize_offer_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(doc)
    oid = out.pop("_id", None)
    if oid is not None:
        out["id"] = str(oid)
    for k, v in list(out.items()):
        if hasattr(v, "isoformat"):
            try:
                out[k] = v.isoformat()
            except Exception:
                pass
    return out


async def admin_quicktrade_overview(
    *,
    exclude_user_ids: Optional[List[str]] = None,
    top_users_limit: int = 10,
) -> Dict[str, Any]:
    """Global Quick Trade stats for admin dashboard."""
    excl = exclude_user_ids or []
    match_active: Dict[str, Any] = {"status": "active"}
    match_active_excl = dict(match_active)
    if excl:
        match_active_excl["user_id"] = {"$nin": excl}

    sell_agg = await db.trade_sell_offers.aggregate(
        [
            {"$match": match_active_excl},
            {"$group": {"_id": None, "count": {"$sum": 1}, "points_escrow": {"$sum": {"$ifNull": ["$original_points", "$points"]}}}},
        ]
    ).to_list(1)
    buy_agg = await db.trade_buy_offers.aggregate(
        [
            {"$match": match_active_excl},
            {"$group": {"_id": None, "count": {"$sum": 1}, "cash_escrow": {"$sum": {"$ifNull": ["$offer", 0]}}}},
        ]
    ).to_list(1)
    token_count = await db.trade_token_offers.count_documents(match_active_excl)
    prop_match: Dict[str, Any] = {"for_sale": True, "type": {"$ne": "casino_slots"}}
    if excl:
        prop_match["owner_id"] = {"$nin": excl}
    prop_count = await db.properties.count_documents(prop_match)

    s0 = sell_agg[0] if sell_agg else {}
    b0 = buy_agg[0] if buy_agg else {}

    # Top users by approximate "locked" value: sell points + buy cash (scaled 1:1 for sort key only)
    pipeline_top: List[Dict[str, Any]] = [
        {"$match": {"status": "active"}},
        {
            "$group": {
                "_id": "$user_id",
                "sell_points": {"$sum": {"$ifNull": ["$original_points", "$points"]}},
                "sell_n": {"$sum": 1},
            }
        },
    ]
    if excl:
        pipeline_top[0]["$match"]["user_id"] = {"$nin": excl}
    sell_by_user = await db.trade_sell_offers.aggregate(pipeline_top).to_list(200)
    buy_by_user = await db.trade_buy_offers.aggregate(
        [
            {"$match": {"status": "active", **({"user_id": {"$nin": excl}} if excl else {})}},
            {"$group": {"_id": "$user_id", "cash": {"$sum": {"$ifNull": ["$offer", 0]}}, "buy_n": {"$sum": 1}}},
        ]
    ).to_list(200)
    token_by_user = await db.trade_token_offers.aggregate(
        [
            {"$match": {"status": "active", **({"user_id": {"$nin": excl}} if excl else {})}},
            {"$group": {"_id": "$user_id", "token_n": {"$sum": 1}}},
        ]
    ).to_list(200)
    uid_scores: Dict[str, Dict[str, Any]] = {}
    for row in sell_by_user:
        uid = str(row["_id"] or "")
        if not uid:
            continue
        uid_scores.setdefault(uid, {"user_id": uid, "sell_offers": 0, "buy_offers": 0, "token_offers": 0, "sell_points_escrow": 0, "buy_cash_escrow": 0, "score": 0})
        uid_scores[uid]["sell_offers"] = int(row.get("sell_n") or 0)
        uid_scores[uid]["sell_points_escrow"] = int(row.get("sell_points") or 0)
    for row in buy_by_user:
        uid = str(row["_id"] or "")
        if not uid:
            continue
        uid_scores.setdefault(uid, {"user_id": uid, "sell_offers": 0, "buy_offers": 0, "token_offers": 0, "sell_points_escrow": 0, "buy_cash_escrow": 0, "score": 0})
        uid_scores[uid]["buy_offers"] = int(row.get("buy_n") or 0)
        uid_scores[uid]["buy_cash_escrow"] = int(row.get("cash") or 0)
    for row in token_by_user:
        uid = str(row["_id"] or "")
        if not uid:
            continue
        uid_scores.setdefault(uid, {"user_id": uid, "sell_offers": 0, "buy_offers": 0, "token_offers": 0, "sell_points_escrow": 0, "buy_cash_escrow": 0, "score": 0})
        uid_scores[uid]["token_offers"] = int(row.get("token_n") or 0)
    for u in uid_scores.values():
        u["score"] = u["sell_points_escrow"] + u["buy_cash_escrow"] // 1_000_000
    top_users = sorted(uid_scores.values(), key=lambda x: (-x["score"], -x["sell_points_escrow"], -x["buy_cash_escrow"]))[: max(0, top_users_limit)]

    unames = {}
    if top_users:
        ids = [x["user_id"] for x in top_users]
        async for u in db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "username": 1}):
            unames[str(u.get("id"))] = u.get("username") or "?"
    for u in top_users:
        u["username"] = unames.get(u["user_id"], "?")

    return {
        "sell_offers_active": int(s0.get("count") or 0),
        "sell_points_escrow": int(s0.get("points_escrow") or 0),
        "buy_offers_active": int(b0.get("count") or 0),
        "buy_cash_escrow": int(b0.get("cash_escrow") or 0),
        "token_offers_active": int(token_count),
        "property_listings_active": int(prop_count),
        "top_users": top_users,
    }


async def admin_quicktrade_user_detail(user_id: str) -> Dict[str, Any]:
    """All active Quick Trade rows for one user (admin)."""
    uid = (user_id or "").strip()
    if not uid:
        return {"user_id": "", "sell_offers": [], "buy_offers": [], "token_offers": [], "property_listings": []}
    sell = await db.trade_sell_offers.find({"user_id": uid, "status": "active"}).sort("created_at", -1).to_list(100)
    buy = await db.trade_buy_offers.find({"user_id": uid, "status": "active"}).sort("created_at", -1).to_list(100)
    tok = await db.trade_token_offers.find({"user_id": uid, "status": "active"}).sort("created_at", -1).to_list(100)
    props = await db.properties.find({"owner_id": uid, "for_sale": True, "type": {"$ne": "casino_slots"}}).sort("created_at", -1).to_list(50)
    return {
        "user_id": uid,
        "sell_offers": [_serialize_offer_doc(x) for x in sell],
        "buy_offers": [_serialize_offer_doc(x) for x in buy],
        "token_offers": [_serialize_offer_doc(x) for x in tok],
        "property_listings": [_serialize_offer_doc(x) for x in props],
    }


async def admin_quicktrade_cancel_all_for_user(
    user_id: str,
    *,
    actor_user_id: str,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Cancel every active Quick Trade listing for user_id with normal refunds."""
    uid = (user_id or "").strip()
    cancelled = {"sell": 0, "buy": 0, "token": 0, "property": 0}
    errors: List[str] = []
    sell_ids = await db.trade_sell_offers.distinct("_id", {"user_id": uid, "status": "active"})
    for sid in sell_ids:
        try:
            await force_cancel_sell_offer_by_id(str(sid), actor_user_id=actor_user_id, reason=reason)
            cancelled["sell"] += 1
        except ValueError as e:
            errors.append(f"sell {sid}: {e}")
    buy_ids = await db.trade_buy_offers.distinct("_id", {"user_id": uid, "status": "active"})
    for bid in buy_ids:
        try:
            await force_cancel_buy_offer_by_id(str(bid), actor_user_id=actor_user_id, reason=reason)
            cancelled["buy"] += 1
        except ValueError as e:
            errors.append(f"buy {bid}: {e}")
    tok_ids = await db.trade_token_offers.distinct("_id", {"user_id": uid, "status": "active"})
    for tid in tok_ids:
        try:
            await force_cancel_token_offer_by_id(str(tid), actor_user_id=actor_user_id, reason=reason)
            cancelled["token"] += 1
        except ValueError as e:
            errors.append(f"token {tid}: {e}")
    prop_ids = await db.properties.distinct(
        "_id",
        {"owner_id": uid, "for_sale": True, "type": {"$ne": "casino_slots"}},
    )
    for pid in prop_ids:
        try:
            await force_cancel_property_listing_by_id(str(pid), actor_user_id=actor_user_id, reason=reason)
            cancelled["property"] += 1
        except ValueError as e:
            errors.append(f"property {pid}: {e}")
    return {"ok": len(errors) == 0, "user_id": uid, "cancelled": cancelled, "errors": errors}


def register(router):
    router.add_api_route("/trade/sell-offers", get_sell_offers, methods=["GET"], dependencies=_quicktrade_rl_u)
    router.add_api_route("/trade/buy-offers", get_buy_offers, methods=["GET"], dependencies=_quicktrade_rl_u)
    router.add_api_route("/trade/sell-offer", create_sell_offer, methods=["POST"])
    router.add_api_route("/trade/buy-offer", create_buy_offer, methods=["POST"])
    router.add_api_route("/trade/sell-offer/{offer_id}/accept", accept_sell_offer, methods=["POST"])
    router.add_api_route("/trade/buy-offer/{offer_id}/accept", accept_buy_offer, methods=["POST"])
    router.add_api_route("/trade/sell-offer/{offer_id}", cancel_sell_offer_delete, methods=["DELETE"])
    router.add_api_route("/trade/buy-offer/{offer_id}", cancel_buy_offer_delete, methods=["DELETE"])
    router.add_api_route("/trade/properties", get_properties_for_sale, methods=["GET"], dependencies=_quicktrade_rl_u)
    router.add_api_route("/trade/property/{property_id}/accept", buy_property, methods=["POST"])
    router.add_api_route("/trade/property/{property_id}/cancel", cancel_property_listing, methods=["POST"])
    router.add_api_route("/trade/sell-offer/{offer_id}/cancel", cancel_sell_offer_post, methods=["POST"])
    router.add_api_route("/trade/buy-offer/{offer_id}/cancel", cancel_buy_offer_post, methods=["POST"])
    router.add_api_route("/trade/token-offers", get_token_offers, methods=["GET"], dependencies=_quicktrade_rl_u)
    router.add_api_route("/trade/my-token-balances", get_my_token_balances, methods=["GET"], dependencies=_quicktrade_rl_u)
    router.add_api_route("/trade/token-offer", create_token_offer, methods=["POST"])
    router.add_api_route("/trade/token-offer/{offer_id}/accept", accept_token_offer, methods=["POST"])
    router.add_api_route("/trade/token-offer/{offer_id}/cancel", cancel_token_offer, methods=["POST"])
