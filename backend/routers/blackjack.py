# Casino Blackjack: config, ownership, claim, relinquish, set-max-bet, set-buy-back, buy-back, send-to-user, sell-on-trade, start, hit, stand, history
from datetime import datetime, timezone, timedelta
import re
import random
import uuid
import time
from typing import Optional
from pydantic import BaseModel, field_validator
from bson.objectid import ObjectId

from fastapi import Depends, HTTPException

from server import (
    db,
    get_current_user,
    STATES,
    get_rank_info,
    CAPO_RANK_ID,
    maybe_auto_relinquish_below_capo,
    _user_owns_any_casino,
    _username_pattern,
    log_gambling,
)
from routers.roulette import RouletteClaimRequest, RouletteSetMaxBetRequest, RouletteSendToUserRequest
from routers.dice import DiceSellOnTradeRequest

# ----- Constants -----
BLACKJACK_MAX_BET = 50_000_000
BLACKJACK_DEFAULT_MAX_BET = 50_000_000
BLACKJACK_ABSOLUTE_MAX_BET = 500_000_000
BLACKJACK_CLAIM_COST = 500_000_000  # $500M to claim table
BLACKJACK_HOUSE_EDGE = 0.02  # 2% of bet to owner when player loses
BLACKJACK_HISTORY_MAX = 10

BLACKJACK_SUITS = ["H", "D", "C", "S"]
BLACKJACK_VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]

# ----- Models -----
class BlackjackSetBuyBackRequest(BaseModel):
    amount: int
    city: Optional[str] = None


class BlackjackBuyBackAcceptRequest(BaseModel):
    offer_id: str


class BlackjackBuyBackRejectRequest(BaseModel):
    offer_id: str


class BlackjackStartRequest(BaseModel):
    bet: int

    @field_validator("bet", mode="before")
    @classmethod
    def coerce_bet(cls, v):
        if v is None:
            return 0
        if isinstance(v, str):
            return int(v.strip() or 0)
        return int(v)


# ----- Per-user cache for GET /casino/blackjack/ownership -----
_ownership_cache: dict = {}
_OWNERSHIP_TTL_SEC = 10
_OWNERSHIP_MAX_ENTRIES = 5000


def _invalidate_ownership_cache(user_id: str):
    _ownership_cache.pop(user_id, None)


def _blackjack_make_deck():
    return [{"suit": s, "value": v} for s in BLACKJACK_SUITS for v in BLACKJACK_VALUES]


def _blackjack_hand_total(hand):
    total = 0
    aces = 0
    for c in hand:
        v = c.get("value")
        if v == "A":
            aces += 1
            total += 11
        elif v in ("K", "Q", "J"):
            total += 10
        else:
            total += int(v) if v else 0
    while total > 21 and aces:
        total -= 10
        aces -= 1
    return total


def _blackjack_is_blackjack(hand):
    return len(hand) == 2 and _blackjack_hand_total(hand) == 21


def _normalize_city_for_blackjack(city_raw: str) -> str:
    if not city_raw:
        return ""
    city_lower = city_raw.strip().lower()
    for state in STATES:
        if state.lower() == city_lower:
            return state
    return ""


async def _get_blackjack_ownership_doc(city: str):
    if not city:
        return city, None
    norm = _normalize_city_for_blackjack(city) or city
    if norm:
        await maybe_auto_relinquish_below_capo(db.blackjack_ownership, {"city": norm})
    pattern = re.compile(f"^{re.escape(city)}$", re.IGNORECASE)
    doc = await db.blackjack_ownership.find_one({"city": pattern})
    if doc:
        return doc.get("city", city), doc
    return city, None


def _blackjack_dealer_visible_total(hand):
    if not hand or len(hand) < 2:
        return None
    first = hand[0]
    v = first.get("value")
    if v == "A":
        return 11
    if v in ("K", "Q", "J"):
        return 10
    return int(v) if v else 0


async def _blackjack_settle_and_save_history(user_id: str, username: str, city: str, bet: int, result: str, payout: int, player_hand: list, dealer_hand: list, player_total: int, dealer_total: int):
    await db.blackjack_games.delete_many({"user_id": user_id})
    history_entry = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "bet": bet,
        "result": result,
        "payout": payout,
        "player_hand": player_hand,
        "dealer_hand": dealer_hand,
        "player_total": player_total,
        "dealer_total": dealer_total,
    }
    await db.users.update_one(
        {"id": user_id},
        {"$push": {"blackjack_history": {"$each": [history_entry], "$position": 0, "$slice": BLACKJACK_HISTORY_MAX}}}
    )
    await log_gambling(user_id, username or "?", "blackjack", {"city": city, "bet": bet, "result": result, "payout": payout, "player_total": player_total, "dealer_total": dealer_total})


def register(router):
    @router.get("/casino/blackjack/config")
    async def casino_blackjack_config(current_user: dict = Depends(get_current_user)):
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city_for_blackjack(raw) if raw else (STATES[0] if STATES else "")
        _, doc = await _get_blackjack_ownership_doc(city) if city else (None, None)
        max_bet = doc.get("max_bet", BLACKJACK_DEFAULT_MAX_BET) if doc else BLACKJACK_DEFAULT_MAX_BET
        return {"max_bet": max_bet, "claim_cost": BLACKJACK_CLAIM_COST}

    @router.get("/casino/blackjack/ownership")
    async def casino_blackjack_ownership(current_user: dict = Depends(get_current_user)):
        """Current city's blackjack ownership. Expired buy-back offers are auto-REJECTED."""
        user_id = current_user["id"]
        now_ts = time.time()
        entry = _ownership_cache.get(user_id)
        if entry and (now_ts - entry["ts"]) < _OWNERSHIP_TTL_SEC:
            return entry["data"]
        now = datetime.now(timezone.utc)
        await db.blackjack_buy_back_offers.delete_many({
            "to_user_id": user_id,
            "expires_at": {"$lt": now.isoformat()},
        })
        raw = (current_user.get("current_state") or "").strip()
        city = _normalize_city_for_blackjack(raw) if raw else (STATES[0] if STATES else "Chicago")
        display_city = city or raw or "Chicago"
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        if not doc:
            out = {
                "current_city": display_city,
                "owner_id": None,
                "owner_name": None,
                "is_owner": False,
                "is_unclaimed": True,
                "claim_cost": BLACKJACK_CLAIM_COST,
                "max_bet": BLACKJACK_DEFAULT_MAX_BET,
                "buy_back_reward": None,
                "buy_back_offer": None,
            }
            if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
                _ownership_cache[user_id] = {"ts": now_ts, "data": out}
            return out
        owner_id = doc.get("owner_id")
        owner_name = None
        if owner_id:
            u = await db.users.find_one({"id": owner_id}, {"username": 1})
            owner_name = u.get("username") if u else None
        is_owner = owner_id == current_user["id"]
        max_bet = doc.get("max_bet", BLACKJACK_DEFAULT_MAX_BET)
        total_earnings = doc.get("total_earnings", 0)
        profit = int((doc.get("profit") or 0) or 0)
        buy_back_reward = doc.get("buy_back_reward")
        active_offer = await db.blackjack_buy_back_offers.find_one(
            {"to_user_id": current_user["id"]},
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
            "is_owner": is_owner,
            "is_unclaimed": owner_id is None,
            "claim_cost": BLACKJACK_CLAIM_COST,
            "max_bet": max_bet,
            "total_earnings": total_earnings if is_owner else None,
            "profit": profit if is_owner else None,
            "buy_back_reward": buy_back_reward if is_owner else None,
            "buy_back_offer": buy_back_offer,
        }
        if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
            _ownership_cache[user_id] = {"ts": now_ts, "data": out}
        return out

    @router.post("/casino/blackjack/claim")
    async def casino_blackjack_claim(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user)):
        rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
        if rank_id < CAPO_RANK_ID:
            raise HTTPException(status_code=403, detail="You must be rank Capo or higher to claim a casino. Reach Capo to hold one.")
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_blackjack((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        owned = await _user_owns_any_casino(current_user["id"])
        if owned and (owned.get("type") != "blackjack" or owned.get("city") != city):
            raise HTTPException(status_code=400, detail="You may only own 1 casino. Relinquish it first (Casino or My Properties).")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        if doc and doc.get("owner_id"):
            raise HTTPException(status_code=400, detail="This table already has an owner")
        user = await db.users.find_one({"id": current_user["id"]})
        if not user or user.get("money", 0) < BLACKJACK_CLAIM_COST:
            raise HTTPException(status_code=400, detail=f"You need ${BLACKJACK_CLAIM_COST:,} to claim")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -BLACKJACK_CLAIM_COST}})
        await db.blackjack_ownership.update_one(
            {"city": stored_city or city},
            {"$set": {"owner_id": current_user["id"], "owner_username": current_user["username"], "max_bet": BLACKJACK_DEFAULT_MAX_BET, "total_earnings": 0, "profit": 0, "buy_back_reward": 0}},
            upsert=True,
        )
        return {"message": f"You now own the blackjack table in {city}!"}

    @router.post("/casino/blackjack/relinquish")
    async def casino_blackjack_relinquish(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_blackjack((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        await db.blackjack_ownership.update_one({"city": stored_city or city}, {"$set": {"owner_id": None, "owner_username": None}})
        return {"message": "Ownership relinquished."}

    @router.post("/casino/blackjack/set-max-bet")
    async def casino_blackjack_set_max_bet(request: RouletteSetMaxBetRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_blackjack((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        new_max = max(1_000_000, min(request.max_bet, BLACKJACK_ABSOLUTE_MAX_BET))
        await db.blackjack_ownership.update_one({"city": stored_city or city}, {"$set": {"max_bet": new_max}})
        return {"message": f"Max bet set to ${new_max:,}"}

    @router.post("/casino/blackjack/set-buy-back-reward")
    async def casino_blackjack_set_buy_back_reward(request: BlackjackSetBuyBackRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        raw = (request.city or current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city_for_blackjack(raw) if raw else (STATES[0] if STATES else "")
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        amount = max(0, int(request.amount))
        await db.blackjack_ownership.update_one({"city": stored_city or city}, {"$set": {"buy_back_reward": amount}})
        return {"message": "Buy-back reward updated."}

    @router.post("/casino/blackjack/buy-back/accept")
    async def casino_blackjack_buy_back_accept(request: BlackjackBuyBackAcceptRequest, current_user: dict = Depends(get_current_user)):
        offer = await db.blackjack_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0})
        if not offer:
            raise HTTPException(status_code=404, detail="Offer not found")
        if offer.get("to_user_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not your offer")
        expires = offer.get("expires_at")
        if expires:
            try:
                if datetime.fromisoformat(expires.replace("Z", "+00:00")) < datetime.now(timezone.utc):
                    raise HTTPException(status_code=400, detail="Offer expired")
            except Exception:
                pass
        city = offer.get("city")
        from_owner_id = offer.get("from_owner_id")
        points_offered = int(offer.get("points_offered") or 0)
        if not city or not from_owner_id:
            raise HTTPException(status_code=400, detail="Invalid offer")
        from_user = await db.users.find_one({"id": from_owner_id}, {"_id": 0, "points": 1, "username": 1})
        from_points = int((from_user.get("points") or 0) or 0)
        if from_points < points_offered:
            raise HTTPException(status_code=400, detail="Previous owner does not have enough points")
        await db.users.update_one({"id": from_owner_id}, {"$inc": {"points": -points_offered}})
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": points_offered}})
        from_username = from_user.get("username") if from_user else None
        await db.blackjack_ownership.update_one({"city": city}, {"$set": {"owner_id": from_owner_id, "owner_username": from_username}})
        await db.blackjack_buy_back_offers.delete_one({"id": request.offer_id})
        _invalidate_ownership_cache(current_user["id"])
        _invalidate_ownership_cache(from_owner_id)
        return {"message": "Accepted. You received the points and the table was returned to the previous owner."}

    @router.post("/casino/blackjack/buy-back/reject")
    async def casino_blackjack_buy_back_reject(request: BlackjackBuyBackRejectRequest, current_user: dict = Depends(get_current_user)):
        offer = await db.blackjack_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0, "to_user_id": 1})
        if not offer or offer.get("to_user_id") != current_user["id"]:
            raise HTTPException(status_code=404, detail="Offer not found")
        await db.blackjack_buy_back_offers.delete_one({"id": request.offer_id})
        _invalidate_ownership_cache(current_user["id"])
        return {"message": "Rejected. You keep the casino."}

    @router.post("/casino/blackjack/send-to-user")
    async def casino_blackjack_send_to_user(request: RouletteSendToUserRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_blackjack((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        target_username_pattern = _username_pattern(request.target_username.strip())
        target = await db.users.find_one({"username": target_username_pattern}, {"_id": 0, "id": 1, "username": 1, "rank_points": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        send_set = {"owner_id": target["id"], "owner_username": target.get("username")}
        if get_rank_info(target.get("rank_points", 0))[0] < CAPO_RANK_ID:
            send_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
        await db.blackjack_ownership.update_one({"city": stored_city or city}, {"$set": send_set})
        _invalidate_ownership_cache(target["id"])
        return {"message": "Ownership transferred."}

    @router.post("/casino/blackjack/sell-on-trade")
    async def casino_blackjack_sell_on_trade(request: DiceSellOnTradeRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_blackjack((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        if request.points <= 0:
            raise HTTPException(status_code=400, detail="Points must be positive")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        casino_property = {
            "_id": ObjectId(),
            "type": "casino_blackjack",
            "location": city,
            "name": f"Blackjack Table ({city})",
            "owner_id": current_user["id"],
            "owner_username": current_user.get("username", "Unknown"),
            "for_sale": True,
            "sale_price": request.points,
            "created_at": datetime.now(timezone.utc)
        }
        await db.properties.insert_one(casino_property)
        return {"message": f"Blackjack table listed for {request.points:,} points on Quick Trade"}

    @router.post("/casino/blackjack/start")
    async def casino_blackjack_start(request: BlackjackStartRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        if current_user.get("in_jail"):
            raise HTTPException(status_code=400, detail="You are in jail!")
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city_for_blackjack(raw) if raw else (STATES[0] if STATES else "")
        if not city:
            raise HTTPException(status_code=400, detail="No current city")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        max_bet = doc.get("max_bet", BLACKJACK_DEFAULT_MAX_BET) if doc else BLACKJACK_DEFAULT_MAX_BET
        owner_id = doc.get("owner_id") if doc else None
        if owner_id and owner_id == current_user["id"]:
            raise HTTPException(status_code=400, detail="You cannot play at your own table")
        bet = max(0, int(request.bet))
        if bet <= 0:
            raise HTTPException(status_code=400, detail="Bet must be positive")
        if bet > max_bet:
            raise HTTPException(status_code=400, detail=f"Bet exceeds max ${max_bet:,}")
        user = await db.users.find_one({"id": current_user["id"]})
        if not user or user.get("money", 0) < bet:
            raise HTTPException(status_code=400, detail="Not enough money")
        existing = await db.blackjack_games.find_one({"user_id": current_user["id"]})
        if existing:
            raise HTTPException(status_code=400, detail="Finish your current game first")
        deck = _blackjack_make_deck()
        random.shuffle(deck)
        player_hand = [deck.pop(), deck.pop()]
        dealer_hand = [deck.pop(), deck.pop()]
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -bet}})
        player_total = _blackjack_hand_total(player_hand)
        dealer_total = _blackjack_hand_total(dealer_hand)
        dealer_hidden = 1
        status = "playing"
        can_hit = True
        can_stand = True
        if _blackjack_is_blackjack(player_hand):
            if _blackjack_is_blackjack(dealer_hand):
                payout = bet
                await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": payout}})
                await _blackjack_settle_and_save_history(
                    current_user["id"], current_user.get("username"), city, bet, "push", payout, player_hand, dealer_hand, player_total, dealer_total
                )
                return {
                    "status": "done",
                    "bet": bet,
                    "player_hand": player_hand,
                    "dealer_hand": dealer_hand,
                    "player_total": player_total,
                    "dealer_total": dealer_total,
                    "result": "push",
                    "payout": payout,
                    "new_balance": user.get("money", 0) - bet + payout,
                    "can_hit": False,
                    "can_stand": False,
                    "dealer_hidden_count": 0,
                    "dealer_visible_total": _blackjack_dealer_visible_total(dealer_hand),
                }
            owner_pay = int(bet * 3 / 2)
            payout_full = bet + owner_pay
            actual_payout = payout_full
            shortfall = 0
            buy_back_offer = None
            ownership_transferred = False
            if owner_id:
                owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1})
                owner_money = int((owner.get("money") or 0) or 0)
                actual_owner_pay = min(owner_pay, owner_money)
                actual_payout = bet + actual_owner_pay
                shortfall = owner_pay - actual_owner_pay
                await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": actual_payout}})
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_owner_pay}})
                buy_back_reward = int((doc or {}).get("buy_back_reward") or 0)
                if shortfall > 0:
                    if buy_back_reward <= 0:
                        await db.blackjack_ownership.update_one({"city": stored_city or city}, {"$inc": {"profit": -actual_owner_pay}})
                    else:
                        ownership_transferred = True
                        bj_owner_set = {"owner_id": current_user["id"], "owner_username": current_user.get("username")}
                        if get_rank_info(current_user.get("rank_points", 0))[0] < CAPO_RANK_ID:
                            bj_owner_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
                        await db.blackjack_ownership.update_one({"city": stored_city or city}, {"$set": bj_owner_set})
                        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
                        offer_id = str(uuid.uuid4())
                        await db.blackjack_buy_back_offers.insert_one({
                            "id": offer_id,
                            "city": stored_city or city,
                            "from_owner_id": owner_id,
                            "to_user_id": current_user["id"],
                            "points_offered": buy_back_reward,
                            "amount_shortfall": shortfall,
                            "owner_paid": actual_owner_pay,
                            "expires_at": expires_at,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        })
                        buy_back_offer = {"offer_id": offer_id, "points_offered": buy_back_reward, "amount_shortfall": shortfall, "owner_paid": actual_owner_pay, "expires_at": expires_at}
                else:
                    await db.blackjack_ownership.update_one({"city": stored_city or city}, {"$inc": {"profit": -owner_pay}})
            else:
                await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": actual_payout}})
            await _blackjack_settle_and_save_history(
                current_user["id"], current_user.get("username"), city, bet, "blackjack", actual_payout, player_hand, dealer_hand, player_total, dealer_total
            )
            new_balance = (user.get("money", 0) or 0) - bet + actual_payout
            return {
                "status": "done",
                "bet": bet,
                "player_hand": player_hand,
                "dealer_hand": dealer_hand,
                "player_total": player_total,
                "dealer_total": dealer_total,
                "result": "blackjack",
                "payout": actual_payout,
                "new_balance": new_balance,
                "can_hit": False,
                "can_stand": False,
                "dealer_hidden_count": 0,
                "dealer_visible_total": _blackjack_dealer_visible_total(dealer_hand),
                "shortfall": shortfall,
                "buy_back_offer": buy_back_offer,
                "ownership_transferred": ownership_transferred,
            }
        if _blackjack_is_blackjack(dealer_hand):
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": 0}})
            if owner_id:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": bet}})
                await db.blackjack_ownership.update_one({"city": stored_city or city}, {"$inc": {"total_earnings": bet, "profit": bet}})
            await _blackjack_settle_and_save_history(
                current_user["id"], current_user.get("username"), city, bet, "lose", 0, player_hand, dealer_hand, player_total, dealer_total
            )
            return {
                "status": "done",
                "bet": bet,
                "player_hand": player_hand,
                "dealer_hand": dealer_hand,
                "player_total": player_total,
                "dealer_total": dealer_total,
                "result": "lose",
                "payout": 0,
                "new_balance": user.get("money", 0) - bet,
                "can_hit": False,
                "can_stand": False,
                "dealer_hidden_count": 0,
                "dealer_visible_total": 10,
            }
        await db.blackjack_games.insert_one({
            "user_id": current_user["id"],
            "city": stored_city or city,
            "bet": bet,
            "player_hand": player_hand,
            "dealer_hand": dealer_hand,
            "deck": deck,
            "status": status,
            "owner_id": owner_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        return {
            "status": status,
            "bet": bet,
            "player_hand": player_hand,
            "dealer_hand": dealer_hand,
            "player_total": player_total,
            "dealer_visible_total": _blackjack_dealer_visible_total(dealer_hand),
            "dealer_hidden_count": dealer_hidden,
            "can_hit": can_hit,
            "can_stand": can_stand,
        }

    @router.post("/casino/blackjack/hit")
    async def casino_blackjack_hit(current_user: dict = Depends(get_current_user)):
        game = await db.blackjack_games.find_one({"user_id": current_user["id"]})
        if not game:
            raise HTTPException(status_code=400, detail="No active game")
        deck = game.get("deck") or []
        player_hand = list(game.get("player_hand") or [])
        if not deck:
            raise HTTPException(status_code=400, detail="Invalid game state")
        card = deck.pop()
        player_hand.append(card)
        player_total = _blackjack_hand_total(player_hand)
        if player_total > 21:
            bet = game.get("bet", 0)
            owner_id = game.get("owner_id")
            user = await db.users.find_one({"id": current_user["id"]})
            new_balance = (user.get("money", 0) or 0)
            if owner_id:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": bet}})
                await db.blackjack_ownership.update_one(
                    {"city": game.get("city")},
                    {"$inc": {"total_earnings": bet, "profit": bet}}
                )
            await _blackjack_settle_and_save_history(
                current_user["id"], current_user.get("username"), game.get("city"), bet, "bust", 0, player_hand, game.get("dealer_hand", []), player_total, _blackjack_hand_total(game.get("dealer_hand", []))
            )
            await db.blackjack_games.delete_one({"user_id": current_user["id"]})
            return {
                "status": "player_bust",
                "bet": bet,
                "player_hand": player_hand,
                "dealer_hand": game.get("dealer_hand", []),
                "player_total": player_total,
                "dealer_total": _blackjack_hand_total(game.get("dealer_hand", [])),
                "result": "bust",
                "payout": 0,
                "new_balance": new_balance,
                "can_hit": False,
                "can_stand": False,
                "dealer_hidden_count": game.get("dealer_hidden_count", 1),
                "dealer_visible_total": _blackjack_dealer_visible_total(game.get("dealer_hand", [])),
            }
        await db.blackjack_games.update_one(
            {"user_id": current_user["id"]},
            {"$set": {"player_hand": player_hand, "deck": deck}}
        )
        return {
            "status": "playing",
            "bet": game.get("bet"),
            "player_hand": player_hand,
            "dealer_hand": game.get("dealer_hand", []),
            "player_total": player_total,
            "dealer_visible_total": _blackjack_dealer_visible_total(game.get("dealer_hand", [])),
            "dealer_hidden_count": 1,
            "can_hit": True,
            "can_stand": True,
        }

    @router.post("/casino/blackjack/stand")
    async def casino_blackjack_stand(current_user: dict = Depends(get_current_user)):
        game = await db.blackjack_games.find_one({"user_id": current_user["id"]})
        if not game:
            raise HTTPException(status_code=400, detail="No active game")
        deck = list(game.get("deck") or [])
        player_hand = list(game.get("player_hand") or [])
        dealer_hand = list(game.get("dealer_hand") or [])
        bet = game.get("bet", 0)
        owner_id = game.get("owner_id")
        dealer_total = _blackjack_hand_total(dealer_hand)
        while dealer_total < 17 and deck:
            card = deck.pop()
            dealer_hand.append(card)
            dealer_total = _blackjack_hand_total(dealer_hand)
        player_total = _blackjack_hand_total(player_hand)
        if dealer_total > 21:
            result = "dealer_bust"
            payout = bet * 2
        elif player_total > dealer_total:
            result = "win"
            payout = bet * 2
        elif player_total < dealer_total:
            result = "lose"
            payout = 0
            if owner_id:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": bet}})
                await db.blackjack_ownership.update_one({"city": game.get("city")}, {"$inc": {"total_earnings": bet, "profit": bet}})
        else:
            result = "push"
            payout = bet
        bj_city = game.get("city")
        shortfall = 0
        buy_back_offer = None
        ownership_transferred = False
        if payout > 0:
            if owner_id and result in ("win", "dealer_bust"):
                owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1})
                owner_money = int((owner.get("money") or 0) or 0)
                actual_owner_pay = min(bet, owner_money)
                shortfall = bet - actual_owner_pay
                await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": bet + actual_owner_pay}})
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_owner_pay}})
                stored_city_bj, doc_bj = await _get_blackjack_ownership_doc(bj_city)
                buy_back_reward = int((doc_bj or {}).get("buy_back_reward") or 0)
                if shortfall > 0:
                    if buy_back_reward <= 0:
                        await db.blackjack_ownership.update_one({"city": stored_city_bj or bj_city}, {"$inc": {"profit": -actual_owner_pay}})
                    else:
                        ownership_transferred = True
                        bj_owner_set2 = {"owner_id": current_user["id"], "owner_username": current_user.get("username")}
                        if get_rank_info(current_user.get("rank_points", 0))[0] < CAPO_RANK_ID:
                            bj_owner_set2["below_capo_acquired_at"] = datetime.now(timezone.utc)
                        await db.blackjack_ownership.update_one({"city": stored_city_bj or bj_city}, {"$set": bj_owner_set2})
                        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
                        offer_id = str(uuid.uuid4())
                        await db.blackjack_buy_back_offers.insert_one({
                            "id": offer_id,
                            "city": stored_city_bj or bj_city,
                            "from_owner_id": owner_id,
                            "to_user_id": current_user["id"],
                            "points_offered": buy_back_reward,
                            "amount_shortfall": shortfall,
                            "owner_paid": actual_owner_pay,
                            "expires_at": expires_at,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        })
                        buy_back_offer = {"offer_id": offer_id, "points_offered": buy_back_reward, "amount_shortfall": shortfall, "owner_paid": actual_owner_pay, "expires_at": expires_at}
                else:
                    await db.blackjack_ownership.update_one({"city": stored_city_bj or bj_city}, {"$inc": {"profit": -bet}})
                payout = bet + actual_owner_pay
        else:
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": payout}})
        user = await db.users.find_one({"id": current_user["id"]})
        new_balance = (user.get("money", 0) or 0)
        await _blackjack_settle_and_save_history(
            current_user["id"], current_user.get("username"), bj_city, bet, result, payout, player_hand, dealer_hand, player_total, dealer_total
        )
        await db.blackjack_games.delete_one({"user_id": current_user["id"]})
        return {
            "status": "done",
            "bet": bet,
            "player_hand": player_hand,
            "dealer_hand": dealer_hand,
            "player_total": player_total,
            "dealer_total": dealer_total,
            "result": result,
            "payout": payout,
            "new_balance": new_balance,
            "can_hit": False,
            "can_stand": False,
            "dealer_hidden_count": 0,
            "dealer_visible_total": dealer_total,
            "shortfall": shortfall,
            "buy_back_offer": buy_back_offer,
            "ownership_transferred": ownership_transferred,
        }

    @router.get("/casino/blackjack/history")
    async def casino_blackjack_history(current_user: dict = Depends(get_current_user)):
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "blackjack_history": 1})
        history = (user.get("blackjack_history") or [])[:BLACKJACK_HISTORY_MAX]
        return {"history": history}
