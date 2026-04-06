# Casino Roulette: config, ownership, claim, relinquish, set-max-bet, send-to-user, sell-on-trade, spin, buy-back
from datetime import datetime, timezone, timedelta
import re
import secrets
_rng = secrets.SystemRandom()
import time
import uuid
from typing import Optional, Union
from pydantic import BaseModel
from bson.objectid import ObjectId

from fastapi import Depends, HTTPException

from utils.claim_costs import load_claim_costs
from utils.point_provenance import log_points_event
from utils.civilian_protection import cleanup_expired_buyback_offers_for_user, maybe_revoke_civilian_protection

from server import (
    db,
    get_current_user,
    get_current_user_verified,
    STATES,
    log_gambling,
    resolve_gambling_log_buy_back,
    get_rank_info,
    CAPO_RANK_ID,
    maybe_auto_relinquish_below_capo,
    CASINO_MIN_OWNER_MAX_BET,
    _user_owns_any_casino,
    _username_pattern,
    get_head_family_id_for_state,
    get_casino_caps,
    assert_casino_buy_back_within_points_balance,
    _ownership_display_profit,
    bump_user_biggest_casino_payout,
    get_wealth_rank,
    get_wealth_rank_range,
    send_notification,
)
from routers.casinos.dice import DiceSellOnTradeRequest
from utils.quicktrade_casino_cleanup import cancel_quicktrade_casino_listings_by_locations

# ----- Constants -----
ROULETTE_RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
ROULETTE_MAX_BET = 50_000_000
# Roulette claim cost: utils.claim_costs (key roulette)
ROULETTE_HOUSE_EDGE = 0.0005  # 0.05% house edge goes to owner
ROULETTE_DEFAULT_MAX_BET = 50_000_000
ROULETTE_ABSOLUTE_MAX_BET = 500_000_000

# ----- Models -----
class RouletteBetItem(BaseModel):
    type: str  # straight, red, black, even, odd, low, high, dozen, column
    selection: Optional[Union[int, str]] = None  # number 0-36 for straight; 1|2|3 for dozen/column; "red"|"black" etc.
    amount: int


class RouletteSpinRequest(BaseModel):
    bets: list


class RouletteClaimRequest(BaseModel):
    city: str


class RouletteSetMaxBetRequest(BaseModel):
    city: str
    max_bet: int


class RouletteSendToUserRequest(BaseModel):
    city: str
    target_username: str


class RouletteSetBuyBackRequest(BaseModel):
    city: Optional[str] = None
    amount: int


class RouletteBuyBackAcceptRequest(BaseModel):
    offer_id: str


class RouletteBuyBackRejectRequest(BaseModel):
    offer_id: str


# ----- Per-user cache for GET /casino/roulette/ownership -----
_ownership_cache: dict = {}
_OWNERSHIP_TTL_SEC = 10
_OWNERSHIP_MAX_ENTRIES = 5000


def _invalidate_ownership_cache(user_id: str):
    _ownership_cache.pop(user_id, None)


def _normalize_city_for_roulette(city_raw: str) -> str:
    """Normalize city name for roulette ownership (case-insensitive)."""
    if not city_raw:
        return ""
    city_lower = city_raw.strip().lower()
    for state in STATES:
        if state.lower() == city_lower:
            return state
    return ""


async def _get_roulette_ownership_doc(city: str):
    """Get roulette ownership doc by city (case-insensitive). Returns (stored_city, doc)."""
    if not city:
        return city, None
    norm = _normalize_city_for_roulette(city) or city
    if norm:
        await maybe_auto_relinquish_below_capo(db.roulette_ownership, {"city": norm}, reset_casino_max_bet=True)
    city_pattern = re.compile(f"^{re.escape(city)}$", re.IGNORECASE)
    doc = await db.roulette_ownership.find_one({"city": city_pattern})
    if doc:
        return doc.get("city", city), doc
    return city, None


def _roulette_check_bet_win(bet_type: str, selection, result: int) -> bool:
    """Check if a single roulette bet wins given the result number."""
    if result == 0:
        return bet_type == "straight" and int(selection) == 0
    if bet_type == "straight":
        return int(selection) == result
    elif bet_type == "red":
        return result in ROULETTE_RED
    elif bet_type == "black":
        return result not in ROULETTE_RED and result != 0
    elif bet_type == "even":
        return result % 2 == 0
    elif bet_type == "odd":
        return result % 2 == 1
    elif bet_type == "low":
        return 1 <= result <= 18
    elif bet_type == "high":
        return 19 <= result <= 36
    elif bet_type == "dozen":
        sel = int(selection)
        if sel == 1:
            return 1 <= result <= 12
        elif sel == 2:
            return 13 <= result <= 24
        elif sel == 3:
            return 25 <= result <= 36
    elif bet_type == "column":
        sel = int(selection)
        return result % 3 == (sel % 3)
    return False


def _roulette_get_multiplier(bet_type: str) -> int:
    """Returns the payout multiplier (includes stake) for a bet type."""
    if bet_type == "straight":
        return 36
    elif bet_type in ("dozen", "column"):
        return 3
    else:
        return 2


def register(router):
    @router.get("/casino/roulette/config")
    async def casino_roulette_config(current_user: dict = Depends(get_current_user_verified)):
        """Return roulette configuration (max bet)."""
        cc = await load_claim_costs(db)
        return {
            "max_bet": ROULETTE_MAX_BET,
            "claim_cost": cc["roulette"],
            "house_edge_percent": ROULETTE_HOUSE_EDGE * 100
        }

    @router.get("/casino/roulette/ownership")
    async def casino_roulette_ownership(current_user: dict = Depends(get_current_user_verified)):
        """Get roulette ownership for player's current city."""
        user_id = current_user.get("id") or ""
        now_ts = time.time()
        entry = _ownership_cache.get(user_id)
        if entry and (now_ts - entry["ts"]) < _OWNERSHIP_TTL_SEC:
            cc = await load_claim_costs(db)
            return {**entry["data"], "claim_cost": cc["roulette"]}
        now = datetime.now(timezone.utc)
        await cleanup_expired_buyback_offers_for_user(db, "roulette_buy_back_offers", user_id, now.isoformat())
        raw = (current_user.get("current_state") or "").strip()
        if not raw:
            raw = STATES[0] if STATES else "Chicago"
        city = _normalize_city_for_roulette(raw)
        if not city:
            city = STATES[0] if STATES else "Chicago"
        display_city = city or raw or "Chicago"
        stored_city, doc = await _get_roulette_ownership_doc(city)
        cc = await load_claim_costs(db)
        if not doc:
            out = {
                "current_city": display_city,
                "owner_id": None,
                "owner_name": None,
                "owner_wealth_rank_name": None,
                "owner_wealth_rank_color": None,
                "owner_wealth_rank_range": None,
                "is_owner": False,
                "is_unclaimed": True,
                "claim_cost": cc["roulette"],
                "max_bet": ROULETTE_DEFAULT_MAX_BET,
                "buy_back_reward": None,
                "buy_back_offer": None,
            }
            if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
                _ownership_cache[user_id] = {"ts": now_ts, "data": out}
            return out
        owner_id = doc.get("owner_id")
        owner_name = None
        owner_wealth_rank_name = None
        owner_wealth_rank_color = None
        owner_wealth_rank_range = None
        if owner_id:
            owner = await db.users.find_one({"id": owner_id}, {"username": 1, "money": 1})
            owner_name = owner.get("username") if owner else None
            if owner:
                _, owner_wealth_rank_name, owner_wealth_rank_color = get_wealth_rank(int((owner.get("money") or 0) or 0))
                owner_wealth_rank_range = get_wealth_rank_range(int((owner.get("money") or 0) or 0))
        is_owner = owner_id == current_user.get("id") or ""
        max_bet = doc.get("max_bet", ROULETTE_DEFAULT_MAX_BET)
        total_earnings = doc.get("total_earnings", 0)
        profit = _ownership_display_profit(doc)
        buy_back_reward = doc.get("buy_back_reward")
        # Check for active buy-back offer for this user
        active_offer = await db.roulette_buy_back_offers.find_one(
            {"to_user_id": user_id},
            {"_id": 0, "id": 1, "points_offered": 1, "amount_shortfall": 1, "owner_paid": 1, "expires_at": 1}
        )
        buy_back_offer = None
        if active_offer:
            try:
                exp_dt = datetime.fromisoformat((active_offer.get("expires_at") or "").replace("Z", "+00:00"))
                if exp_dt > now:
                    buy_back_offer = {
                        "offer_id": active_offer["id"],
                        "points_offered": int(active_offer.get("points_offered") or 0),
                        "amount_shortfall": int(active_offer.get("amount_shortfall") or 0),
                        "owner_paid": int(active_offer.get("owner_paid") or 0),
                        "expires_at": active_offer.get("expires_at"),
                    }
            except Exception:
                pass
        out = {
            "current_city": display_city,
            "owner_id": owner_id,
            "owner_name": owner_name,
            "owner_wealth_rank_name": owner_wealth_rank_name,
            "owner_wealth_rank_color": owner_wealth_rank_color,
            "owner_wealth_rank_range": owner_wealth_rank_range,
            "is_owner": is_owner,
            "is_unclaimed": owner_id is None,
            "claim_cost": cc["roulette"],
            "max_bet": max_bet,
            "total_earnings": total_earnings if is_owner else None,
            "profit": profit if is_owner else None,
            "buy_back_reward": buy_back_reward,
            "buy_back_offer": buy_back_offer,
        }
        if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
            _ownership_cache[user_id] = {"ts": now_ts, "data": out}
        return out

    @router.post("/casino/roulette/claim")
    async def casino_roulette_claim(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        """Claim ownership of an unclaimed roulette table. Max 1 casino per player. Requires Capo or higher (or prestiged)."""
        rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
        prestige_level = int(current_user.get("prestige_level") or 0)
        if rank_id < CAPO_RANK_ID and prestige_level < 1:
            raise HTTPException(status_code=403, detail="You must be rank Capo or higher to claim a casino. Reach Capo to hold one.")
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_roulette((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        owned = await _user_owns_any_casino(current_user.get("id") or "")
        if owned and (owned.get("type") != "roulette" or owned.get("city") != city):
            raise HTTPException(status_code=400, detail="You may only own 1 casino. Relinquish it first (Casino or My Properties).")
        stored_city, doc = await _get_roulette_ownership_doc(city)
        cc = await load_claim_costs(db)
        claim_cost = cc["roulette"]
        user = await db.users.find_one({"id": current_user.get("id") or ""})
        if not user or user.get("money", 0) < claim_cost:
            raise HTTPException(status_code=400, detail=f"You need ${claim_cost:,} to claim")
        res = await db.roulette_ownership.update_one(
            {"city": stored_city or city, "owner_id": None},
            {"$set": {"owner_id": current_user.get("id") or "", "owner_username": current_user.get("username") or "", "max_bet": ROULETTE_DEFAULT_MAX_BET, "buy_back_reward": 0}},
            upsert=True
        )
        if not res.modified_count and not res.upserted_id:
            raise HTTPException(status_code=400, detail="This table already has an owner")
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": -claim_cost}})
        await maybe_revoke_civilian_protection(db, current_user.get("id") or "", "casino_claim")
        await cancel_quicktrade_casino_listings_by_locations("casino_rlt", stored_city or city, city)
        return {"message": f"You now own the roulette table in {city}!"}

    @router.post("/casino/roulette/relinquish")
    async def casino_roulette_relinquish(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        """Give up ownership of a roulette table."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_roulette((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_roulette_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        await db.roulette_ownership.update_one(
            {"city": stored_city or city},
            {"$set": {"owner_id": None, "owner_username": None, "max_bet": CASINO_MIN_OWNER_MAX_BET}},
        )
        await cancel_quicktrade_casino_listings_by_locations("casino_rlt", stored_city or city, city)
        return {"message": "Ownership relinquished."}

    @router.post("/casino/roulette/reset-profit")
    async def casino_roulette_reset_profit(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        """Reset profit counter to zero (owner only)."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_roulette((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_roulette_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        await db.roulette_ownership.update_one({"city": stored_city or city}, {"$set": {"profit": 0}})
        return {"message": "Profit reset to zero."}

    @router.post("/casino/roulette/set-max-bet")
    async def casino_roulette_set_max_bet(request: RouletteSetMaxBetRequest, current_user: dict = Depends(get_current_user_verified)):
        """Set the max bet for your roulette table."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_roulette((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_roulette_ownership_doc(city)
        if not doc:
            raise HTTPException(status_code=404, detail="No roulette table found in this city")
        if doc.get("owner_id") != (current_user.get("id") or ""):
            raise HTTPException(status_code=403, detail="You do not own this table")
        global_cap, _ = await get_casino_caps()
        new_max = max(50_000, min(request.max_bet, global_cap))
        result = await db.roulette_ownership.update_one(
            {"city": stored_city or city},
            {"$set": {"max_bet": new_max}}
        )
        if result.modified_count == 0 and result.matched_count == 0:
            raise HTTPException(status_code=500, detail="Failed to update max bet")
        return {"message": f"Max bet set to ${new_max:,}", "max_bet": new_max}

    @router.post("/casino/roulette/set-buy-back-reward")
    async def casino_roulette_set_buy_back_reward(request: RouletteSetBuyBackRequest, current_user: dict = Depends(get_current_user_verified)):
        """Set the buy-back reward (points) offered if someone takes your roulette table."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        raw = (request.city or current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city_for_roulette(raw) if raw else (STATES[0] if STATES else "")
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_roulette_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        _, buyback_cap = await get_casino_caps()
        amount = max(0, min(int(request.amount), buyback_cap))
        await assert_casino_buy_back_within_points_balance(current_user["id"], amount)
        await db.roulette_ownership.update_one({"city": stored_city or city}, {"$set": {"buy_back_reward": amount}})
        return {"message": "Buy-back reward updated."}

    @router.post("/casino/roulette/buy-back/accept")
    async def casino_roulette_buy_back_accept(request: RouletteBuyBackAcceptRequest, current_user: dict = Depends(get_current_user_verified)):
        """Accept a buy-back offer: receive points and return the roulette table to the previous owner."""
        offer = await db.roulette_buy_back_offers.find_one_and_delete({"id": request.offer_id}, projection={"_id": 0})
        if not offer:
            raise HTTPException(status_code=404, detail="Offer not found or already claimed")
        if offer.get("to_user_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="Not your offer")
        expires = offer.get("expires_at")
        if expires:
            try:
                exp_dt = datetime.fromisoformat(expires.replace("Z", "+00:00"))
                if exp_dt < datetime.now(timezone.utc):
                    raise HTTPException(status_code=400, detail="Offer expired")
            except ValueError:
                pass
        city = offer.get("city")
        from_owner_id = offer.get("from_owner_id")
        points_offered = int(offer.get("points_offered") or 0)
        if points_offered <= 0:
            raise HTTPException(status_code=400, detail="Invalid offer (0 points)")
        from_user = await db.users.find_one({"id": from_owner_id}, {"_id": 0, "points": 1, "username": 1})
        if not from_user or int(from_user.get("points") or 0) < points_offered:
            raise HTTPException(status_code=400, detail="Previous owner does not have enough points")
        debit_result = await db.users.update_one(
            {"id": from_owner_id, "points": {"$gte": points_offered}},
            {"$inc": {"points": -points_offered}},
        )
        if debit_result.modified_count == 0:
            raise HTTPException(status_code=400, detail="Previous owner does not have enough points")
        await log_points_event(db, user_id=from_owner_id, points=-points_offered, event_type="casino_roulette", event_ref=f"buyback:{request.offer_id}", meta={"action": "buyback_deduct", "city": city, "offer_id": request.offer_id})
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"points": points_offered}})
        await log_points_event(db, user_id=current_user.get("id") or "", points=points_offered, event_type="casino_roulette", event_ref=f"buyback:{request.offer_id}", meta={"action": "buyback_credit", "city": city, "offer_id": request.offer_id})
        from_username = from_user.get("username") if from_user else None
        # Reset max_bet to 0 when ownership returns - owner must set it again
        await db.roulette_ownership.update_one({"city": city}, {"$set": {"owner_id": from_owner_id, "owner_username": from_username, "max_bet": 0}})
        cnorm = _normalize_city_for_roulette(str(city or "").strip()) if city else ""
        await cancel_quicktrade_casino_listings_by_locations("casino_rlt", city, cnorm or None)
        _invalidate_ownership_cache(current_user.get("id") or "")
        _invalidate_ownership_cache(from_owner_id)
        await resolve_gambling_log_buy_back(request.offer_id, "accepted", points_offered)
        return {"message": "Accepted. You received the points and the table was returned to the previous owner."}

    @router.post("/casino/roulette/buy-back/reject")
    async def casino_roulette_buy_back_reject(request: RouletteBuyBackRejectRequest, current_user: dict = Depends(get_current_user_verified)):
        """Reject a buy-back offer: keep the roulette table."""
        offer = await db.roulette_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0, "to_user_id": 1})
        if not offer or offer.get("to_user_id") != current_user.get("id") or "":
            raise HTTPException(status_code=404, detail="Offer not found")
        await db.roulette_buy_back_offers.delete_one({"id": request.offer_id})
        _invalidate_ownership_cache(current_user.get("id") or "")
        await resolve_gambling_log_buy_back(request.offer_id, "rejected", 0)
        await maybe_revoke_civilian_protection(db, current_user.get("id") or "", "casino_buyback_reject")
        return {"message": "Rejected. You keep the casino."}

    @router.post("/casino/roulette/send-to-user")
    async def casino_roulette_send_to_user(request: RouletteSendToUserRequest, current_user: dict = Depends(get_current_user_verified)):
        """Transfer roulette table ownership to another user."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_roulette((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_roulette_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        target_username_pattern = _username_pattern(request.target_username.strip())
        target = await db.users.find_one({"username": target_username_pattern}, {"_id": 0, "id": 1, "username": 1, "rank_points": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        send_set = {
            "owner_id": target.get("id") or "",
            "owner_username": target.get("username") or "",
            "max_bet": CASINO_MIN_OWNER_MAX_BET,
        }
        if get_rank_info(target.get("rank_points", 0))[0] < CAPO_RANK_ID:
            send_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
        await db.roulette_ownership.update_one({"city": stored_city or city}, {"$set": send_set})
        await cancel_quicktrade_casino_listings_by_locations("casino_rlt", stored_city or city, city)
        _invalidate_ownership_cache(target.get("id") or "")
        await maybe_revoke_civilian_protection(db, target.get("id") or "", "received_casino_transfer")
        loc = stored_city or city
        sender_name = (current_user.get("username") or "").strip() or "?"
        await send_notification(
            target.get("id") or "",
            "Casino transferred",
            f"{sender_name} sent you the roulette table in {loc}.",
            "reward",
        )
        return {"message": "Ownership transferred."}

    @router.post("/casino/roulette/sell-on-trade")
    async def casino_roulette_sell_on_trade(request: DiceSellOnTradeRequest, current_user: dict = Depends(get_current_user_verified)):
        """List your roulette table for sale on Quick Trade (points only)."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_roulette((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        if request.points <= 0:
            raise HTTPException(status_code=400, detail="Points must be positive")
        stored_city, doc = await _get_roulette_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        listing_id = ObjectId()
        casino_property = {
            "_id": listing_id,
            "id": str(listing_id),
            "type": "casino_rlt",
            "location": city,
            "name": f"Roulette Table ({city})",
            "owner_id": current_user.get("id") or "",
            "owner_username": current_user.get("username", "Unknown"),
            "for_sale": True,
            "sale_price": request.points,
            "created_at": datetime.now(timezone.utc)
        }
        await db.properties.insert_one(casino_property)
        return {"message": f"Roulette table listed for {request.points:,} points on Quick Trade"}

    @router.post("/casino/roulette/spin")
    async def casino_roulette_spin(request: RouletteSpinRequest, current_user: dict = Depends(get_current_user_verified)):
        """Spin the roulette wheel with the provided bets."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        bets = request.bets or []
        if not bets:
            raise HTTPException(status_code=400, detail="No bets provided")
        city = _normalize_city_for_roulette(current_user.get("current_state", ""))
        stored_city, ownership_doc = await _get_roulette_ownership_doc(city) if city else (city, None)
        owner_id = ownership_doc.get("owner_id") if ownership_doc else None
        max_bet = ownership_doc.get("max_bet", ROULETTE_DEFAULT_MAX_BET) if ownership_doc else ROULETTE_DEFAULT_MAX_BET
        if owner_id and owner_id == current_user.get("id"):
            raise HTTPException(status_code=400, detail="You cannot gamble at your own roulette table")
        total_stake = 0
        validated_bets = []
        for b in bets:
            bet_type = b.get("type", "").lower()
            selection = b.get("selection")
            amount = int(b.get("amount", 0))
            if amount <= 0:
                raise HTTPException(status_code=400, detail="Bet amount must be positive")
            if bet_type == "straight":
                sel_int = int(selection)
                if not (0 <= sel_int <= 36):
                    raise HTTPException(status_code=400, detail=f"Invalid straight bet: {selection}")
                selection = sel_int
            elif bet_type in ("dozen", "column"):
                sel_int = int(selection)
                if sel_int not in (1, 2, 3):
                    raise HTTPException(status_code=400, detail=f"Invalid {bet_type} selection: {selection}")
                selection = sel_int
            elif bet_type not in ("red", "black", "even", "odd", "low", "high"):
                raise HTTPException(status_code=400, detail=f"Unknown bet type: {bet_type}")
            total_stake += amount
            validated_bets.append({"type": bet_type, "selection": selection, "amount": amount})
        if total_stake > max_bet:
            raise HTTPException(status_code=400, detail=f"Total bet exceeds max of ${max_bet:,}")
        debit_res = await db.users.find_one_and_update(
            {"id": current_user.get("id") or "", "money": {"$gte": total_stake}},
            {"$inc": {"money": -total_stake}},
        )
        if not debit_res:
            raise HTTPException(status_code=400, detail="Not enough money")
        result = _rng.randint(0, 36)
        total_payout = 0
        for bet in validated_bets:
            if _roulette_check_bet_win(bet["type"], bet["selection"], result):
                multiplier = _roulette_get_multiplier(bet["type"])
                total_payout += bet["amount"] * multiplier
        win = total_payout > 0
        # Final payout actually credited to player for this spin.
        # Keep this defined across all branches so loss paths never crash.
        settled_payout = total_payout
        shortfall = 0
        ownership_transferred = False
        buy_back_offer = None
        actual_payout = total_payout if win else 0
        head_family_id = await get_head_family_id_for_state(stored_city or city)
        edge = int(total_stake * ROULETTE_HOUSE_EDGE)
        if not win:
            if head_family_id and edge > 0:
                await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge, "state_head_income.roulette": edge}})
            if owner_id:
                owner_take = max(0, total_stake - (edge if head_family_id else 0))
                if owner_take > 0:
                    await db.users.update_one({"id": owner_id}, {"$inc": {"money": owner_take}})
                await db.roulette_ownership.update_one(
                    {"city": stored_city or city},
                    {"$inc": {"total_earnings": total_stake, "profit": owner_take}},
                )
                _invalidate_ownership_cache(owner_id)
        elif not owner_id:
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": total_payout}})
        else:
            # Check if owner can afford to pay
            owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1, "username": 1})
            owner_money = int(((owner or {}).get("money") or 0) or 0)
            owner_username = (owner or {}).get("username")
            net_cost = total_payout - total_stake
            if head_family_id and edge > 0:
                net_cost += edge
                await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge, "state_head_income.roulette": edge}})
                # State-head tax comes out of owner's net (floor at 0)
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": -edge}})
            actual_payout = min(total_payout, owner_money + total_stake)
            settled_payout = actual_payout
            shortfall = total_payout - actual_payout
            actual_net_cost = actual_payout - total_stake
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": actual_payout}})
            if actual_net_cost > 0:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_net_cost, "total_casino_payouts": actual_net_cost}})
                # Track biggest payout for owner
                await bump_user_biggest_casino_payout(owner_id, actual_net_cost)
            await db.roulette_ownership.update_one(
                {"city": stored_city or city},
                {"$inc": {"total_earnings": -actual_net_cost, "profit": -(actual_net_cost + (edge if head_family_id else 0))}}
            )
            _invalidate_ownership_cache(owner_id)
            buy_back_reward = int((ownership_doc or {}).get("buy_back_reward") or 0)
            if shortfall > 0:
                # Owner can't pay full amount - transfer ownership
                ownership_transferred = True
                roulette_owner_set = {"owner_id": current_user.get("id") or "", "owner_username": current_user.get("username") or ""}
                if get_rank_info(current_user.get("rank_points", 0))[0] < CAPO_RANK_ID:
                    roulette_owner_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
                await db.roulette_ownership.update_one({"city": stored_city or city}, {"$set": roulette_owner_set})
                await cancel_quicktrade_casino_listings_by_locations("casino_rlt", stored_city or city, city)
                # Track casino won/lost stats
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"casinos_seized": 1}})
                await db.users.update_one({"id": owner_id}, {"$inc": {"casinos_lost": 1}})
                # Create buy-back offer if owner has set a reward; otherwise state head gets the stake (same as dice/horseracing)
                if buy_back_reward > 0:
                    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
                    offer_id = str(uuid.uuid4())
                    await db.roulette_buy_back_offers.insert_one({
                        "id": offer_id,
                        "city": stored_city or city,
                        "from_owner_id": owner_id,
                        "from_owner_username": owner_username,
                        "to_user_id": current_user.get("id") or "",
                        "to_username": current_user.get("username"),
                        "points_offered": buy_back_reward,
                        "amount_shortfall": shortfall,
                        "owner_paid": actual_payout,
                        "expires_at": expires_at,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })
                    buy_back_offer = {"offer_id": offer_id, "points_offered": buy_back_reward, "amount_shortfall": shortfall, "owner_paid": actual_payout, "expires_at": expires_at}
                elif head_family_id and edge > 0:
                    await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge, "state_head_income.roulette": edge}})
        r_details = {
            "city": stored_city or city,
            "total_stake": total_stake,
            "result": result,
            "total_payout": total_payout,
            "win": win,
            "bets": [{"type": b["type"], "selection": b["selection"], "amount": b["amount"]} for b in validated_bets],
            "payout": total_payout,
        }
        if win and owner_id:
            r_details["actual_payout"] = actual_payout
            r_details["shortfall"] = shortfall
            r_details["ownership_transferred"] = ownership_transferred
            if ownership_transferred:
                if buy_back_offer and buy_back_offer.get("offer_id"):
                    r_details["buy_back_offer_id"] = buy_back_offer["offer_id"]
                    r_details["buy_back_points_offered"] = int(buy_back_offer.get("points_offered") or 0)
                    r_details["buy_back_outcome"] = "pending"
                else:
                    r_details["buy_back_points_offered"] = 0
                    r_details["buy_back_outcome"] = "not_offered"
        await log_gambling(
            current_user.get("id") or "",
            current_user.get("username") or "?",
            "roulette",
            r_details,
        )
        return {
            "result": result,
            "win": win,
            "total_payout": settled_payout,
            "total_stake": total_stake,
            "owner_cut": edge if (head_family_id or owner_id) else 0,
            "ownership_transferred": ownership_transferred if win and owner_id else False,
            "shortfall": shortfall if win and owner_id else 0,
            "buy_back_offer": buy_back_offer if win and owner_id else None,
        }
