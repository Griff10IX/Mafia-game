# Casino Video Poker (Jacks or Better): config, ownership, claim, relinquish, set-max-bet, set-buy-back, send-to-user, sell-on-trade, deal, draw, game, history, buy-back
from datetime import datetime, timezone, timedelta
import re
import secrets
_rng = secrets.SystemRandom()
import time
import uuid
from collections import Counter
from typing import Optional
from pydantic import BaseModel, field_validator
from bson.objectid import ObjectId

from fastapi import Depends, HTTPException

from utils.claim_costs import load_claim_costs
from utils.point_provenance import log_points_event

from server import (
    db,
    get_current_user,
    get_current_user_verified,
    STATES,
    get_rank_info,
    CAPO_RANK_ID,
    maybe_auto_relinquish_below_capo,
    _user_owns_any_casino,
    _username_pattern,
    log_gambling,
    get_head_family_id_for_state,
    get_casino_caps,
    _ownership_display_profit,
    bump_user_biggest_casino_payout,
)
from routers.casinos.roulette import RouletteClaimRequest, RouletteSetMaxBetRequest, RouletteSendToUserRequest
from routers.casinos.dice import DiceSellOnTradeRequest

# ----- Constants -----
VIDEO_POKER_MAX_BET = 50_000_000
VIDEO_POKER_DEFAULT_MAX_BET = 50_000_000
VIDEO_POKER_ABSOLUTE_MAX_BET = 500_000_000
# Video poker claim cost: utils.claim_costs (key video_poker)
VIDEO_POKER_HISTORY_MAX = 10
VIDEO_POKER_HOUSE_EDGE = 0.0005  # 0.05% of profit to house (state head when no owner), like dice

SUITS = ["H", "D", "C", "S"]
VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
VALUE_RANK = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14}

# 9/6 Jacks or Better pay table (total return per unit bet)
PAY_TABLE = {
    "royal_flush": 250,
    "straight_flush": 50,
    "four_of_a_kind": 25,
    "full_house": 9,
    "flush": 6,
    "straight": 4,
    "three_of_a_kind": 3,
    "two_pair": 2,
    "jacks_or_better": 1,
}

HAND_NAMES = {
    "royal_flush": "Royal Flush",
    "straight_flush": "Straight Flush",
    "four_of_a_kind": "Four of a Kind",
    "full_house": "Full House",
    "flush": "Flush",
    "straight": "Straight",
    "three_of_a_kind": "Three of a Kind",
    "two_pair": "Two Pair",
    "jacks_or_better": "Jacks or Better",
    "nothing": "Nothing",
}


# ----- Models -----
class VideoPokerDealRequest(BaseModel):
    bet: int

    @field_validator("bet", mode="before")
    @classmethod
    def coerce_bet(cls, v):
        if v is None:
            return 0
        if isinstance(v, str):
            return int(v.strip() or 0)
        return int(v)


class VideoPokerDrawRequest(BaseModel):
    holds: list  # list of 0-based indices to hold (e.g. [0, 2, 4])


class VideoPokerSetBuyBackRequest(BaseModel):
    city: str
    amount: int


class VideoPokerBuyBackAcceptRequest(BaseModel):
    offer_id: str


class VideoPokerBuyBackRejectRequest(BaseModel):
    offer_id: str


# ----- Per-user cache for GET /casino/videopoker/ownership -----
_ownership_cache: dict = {}
_OWNERSHIP_TTL_SEC = 10
_OWNERSHIP_MAX_ENTRIES = 5000


def _invalidate_ownership_cache(user_id: str):
    _ownership_cache.pop(user_id, None)


def _normalize_city(city_raw: str) -> str:
    if not city_raw:
        return ""
    city_lower = city_raw.strip().lower()
    for state in STATES:
        if state.lower() == city_lower:
            return state
    return ""


async def _get_ownership_doc(city: str):
    if not city:
        return city, None
    norm = _normalize_city(city) or city
    if norm:
        await maybe_auto_relinquish_below_capo(db.videopoker_ownership, {"city": norm})
    pattern = re.compile(f"^{re.escape(city)}$", re.IGNORECASE)
    doc = await db.videopoker_ownership.find_one({"city": pattern})
    if doc:
        return doc.get("city", city), doc
    return city, None


def _make_deck():
    return [{"suit": s, "value": v} for s in SUITS for v in VALUES]


def _evaluate_hand(hand):
    """Evaluate a 5-card poker hand. Returns (hand_rank_key, display_name, multiplier)."""
    values = [c["value"] for c in hand]
    suits = [c["suit"] for c in hand]
    nums = sorted([VALUE_RANK[v] for v in values])

    counts = Counter(nums)
    count_vals = sorted(counts.values(), reverse=True)

    is_flush = len(set(suits)) == 1
    is_straight = False
    if len(set(nums)) == 5:
        if nums[-1] - nums[0] == 4:
            is_straight = True
        elif nums == [2, 3, 4, 5, 14]:
            is_straight = True

    if is_flush and is_straight:
        if set(nums) == {10, 11, 12, 13, 14}:
            key = "royal_flush"
        else:
            key = "straight_flush"
    elif count_vals == [4, 1]:
        key = "four_of_a_kind"
    elif count_vals == [3, 2]:
        key = "full_house"
    elif is_flush:
        key = "flush"
    elif is_straight:
        key = "straight"
    elif count_vals == [3, 1, 1]:
        key = "three_of_a_kind"
    elif count_vals == [2, 2, 1]:
        key = "two_pair"
    elif count_vals == [2, 1, 1, 1]:
        pair_value = [v for v, c in counts.items() if c == 2][0]
        if pair_value >= 11:
            key = "jacks_or_better"
        else:
            key = "nothing"
    else:
        key = "nothing"

    multiplier = PAY_TABLE.get(key, 0)
    return key, HAND_NAMES.get(key, key), multiplier


async def _settle_and_save_history(user_id: str, username: str, city: str, bet: int, hand_key: str, hand_name: str, payout: int, hand: list):
    await db.videopoker_games.delete_many({"user_id": user_id})
    history_entry = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "bet": bet,
        "hand_key": hand_key,
        "hand_name": hand_name,
        "payout": payout,
        "hand": hand,
    }
    await db.users.update_one(
        {"id": user_id},
        {"$push": {"videopoker_history": {"$each": [history_entry], "$position": 0, "$slice": VIDEO_POKER_HISTORY_MAX}}}
    )
    await log_gambling(user_id, username or "?", "videopoker", {"city": city, "bet": bet, "hand_key": hand_key, "hand_name": hand_name, "payout": payout})


def register(router):
    @router.get("/casino/videopoker/config")
    async def casino_videopoker_config(current_user: dict = Depends(get_current_user_verified)):
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city(raw) if raw else (STATES[0] if STATES else "")
        _, doc = await _get_ownership_doc(city) if city else (None, None)
        max_bet = doc.get("max_bet", VIDEO_POKER_DEFAULT_MAX_BET) if doc else VIDEO_POKER_DEFAULT_MAX_BET
        cc = await load_claim_costs(db)
        return {
            "max_bet": max_bet,
            "claim_cost": cc["video_poker"],
            "house_edge": VIDEO_POKER_HOUSE_EDGE,
            "pay_table": PAY_TABLE,
            "hand_names": HAND_NAMES,
        }

    @router.get("/casino/videopoker/ownership")
    async def casino_videopoker_ownership(current_user: dict = Depends(get_current_user_verified)):
        """Current city's video poker ownership: owner, is_owner, claim_cost, max_bet, buy_back_reward, buy_back_offer."""
        user_id = current_user.get("id") or ""
        now_ts = time.time()
        entry = _ownership_cache.get(user_id)
        if entry and (now_ts - entry["ts"]) < _OWNERSHIP_TTL_SEC:
            return entry["data"]
        now = datetime.now(timezone.utc)
        # Clean up expired buyback offers for this user
        await db.videopoker_buy_back_offers.delete_many({
            "to_user_id": user_id,
            "expires_at": {"$lt": now.isoformat()},
        })
        raw = (current_user.get("current_state") or "").strip()
        city = _normalize_city(raw) if raw else (STATES[0] if STATES else "Chicago")
        display_city = city or raw or "Chicago"
        stored_city, doc = await _get_ownership_doc(city)
        cc = await load_claim_costs(db)
        if not doc:
            out = {
                "current_city": display_city,
                "owner_id": None,
                "owner_name": None,
                "is_owner": False,
                "is_unclaimed": True,
                "claim_cost": cc["video_poker"],
                "max_bet": VIDEO_POKER_DEFAULT_MAX_BET,
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
        is_owner = owner_id == current_user.get("id") or ""
        max_bet = doc.get("max_bet", VIDEO_POKER_DEFAULT_MAX_BET)
        total_earnings = doc.get("total_earnings", 0)
        profit = _ownership_display_profit(doc)
        buy_back_reward = doc.get("buy_back_reward")
        # Check for active buyback offer for this user
        active_offer = await db.videopoker_buy_back_offers.find_one(
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
            "is_owner": is_owner,
            "is_unclaimed": owner_id is None,
            "claim_cost": cc["video_poker"],
            "max_bet": max_bet,
            "buy_back_reward": buy_back_reward,
            "total_earnings": total_earnings if is_owner else None,
            "profit": profit if is_owner else None,
            "buy_back_offer": buy_back_offer,
        }
        if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
            _ownership_cache[user_id] = {"ts": now_ts, "data": out}
        return out

    @router.post("/casino/videopoker/claim")
    async def casino_videopoker_claim(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
        prestige_level = int(current_user.get("prestige_level") or 0)
        if rank_id < CAPO_RANK_ID and prestige_level < 1:
            raise HTTPException(status_code=403, detail="You must be rank Capo or higher to claim a casino. Reach Capo to hold one.")
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        owned = await _user_owns_any_casino(current_user.get("id") or "")
        if owned and (owned.get("type") != "videopoker" or owned.get("city") != city):
            raise HTTPException(status_code=400, detail="You may only own 1 casino. Relinquish it first (Casino or My Properties).")
        stored_city, doc = await _get_ownership_doc(city)
        cc = await load_claim_costs(db)
        claim_cost = cc["video_poker"]
        user = await db.users.find_one({"id": current_user.get("id") or ""})
        if not user or user.get("money", 0) < claim_cost:
            raise HTTPException(status_code=400, detail=f"You need ${claim_cost:,} to claim")
        res = await db.videopoker_ownership.update_one(
            {"city": stored_city or city, "owner_id": None},
            {"$set": {"owner_id": current_user.get("id") or "", "owner_username": current_user.get("username") or "", "max_bet": VIDEO_POKER_DEFAULT_MAX_BET, "buy_back_reward": 0}},
            upsert=True,
        )
        if not res.modified_count and not res.upserted_id:
            raise HTTPException(status_code=400, detail="This table already has an owner")
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": -claim_cost}})
        return {"message": f"You now own the video poker table in {city}!"}

    @router.post("/casino/videopoker/relinquish")
    async def casino_videopoker_relinquish(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        await db.videopoker_ownership.update_one({"city": stored_city or city}, {"$set": {"owner_id": None, "owner_username": None}})
        return {"message": "Ownership relinquished."}

    @router.post("/casino/videopoker/reset-profit")
    async def casino_videopoker_reset_profit(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        """Reset profit counter to zero (owner only)."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        await db.videopoker_ownership.update_one({"city": stored_city or city}, {"$set": {"profit": 0}})
        return {"message": "Profit reset to zero."}

    @router.post("/casino/videopoker/set-max-bet")
    async def casino_videopoker_set_max_bet(request: RouletteSetMaxBetRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        global_cap, _ = await get_casino_caps()
        new_max = max(1_000_000, min(request.max_bet, global_cap))
        await db.videopoker_ownership.update_one({"city": stored_city or city}, {"$set": {"max_bet": new_max}})
        return {"message": f"Max bet set to ${new_max:,}"}

    @router.post("/casino/videopoker/set-buy-back-reward")
    async def casino_videopoker_set_buy_back_reward(request: VideoPokerSetBuyBackRequest, current_user: dict = Depends(get_current_user_verified)):
        """Set buy-back reward (points) offered when you cannot pay a win (owner only)."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        _, buyback_cap = await get_casino_caps()
        amount = max(0, min(int(request.amount), buyback_cap))
        await db.videopoker_ownership.update_one({"city": stored_city or city}, {"$set": {"buy_back_reward": amount}})
        return {"message": "Buy-back reward updated."}

    @router.post("/casino/videopoker/buy-back/accept")
    async def casino_videopoker_buy_back_accept(request: VideoPokerBuyBackAcceptRequest, current_user: dict = Depends(get_current_user_verified)):
        """Accept a buy-back offer: receive points and transfer ownership back to previous owner."""
        offer = await db.videopoker_buy_back_offers.find_one_and_delete({"id": request.offer_id}, projection={"_id": 0})
        if not offer:
            raise HTTPException(status_code=404, detail="Offer not found or already claimed")
        if offer.get("to_user_id") != current_user.get("id") or "":
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
        if not from_user:
            raise HTTPException(status_code=400, detail="Previous owner not found")
        deduct_res = await db.users.find_one_and_update(
            {"id": from_owner_id, "points": {"$gte": points_offered}},
            {"$inc": {"points": -points_offered}},
        )
        if not deduct_res:
            raise HTTPException(status_code=400, detail="Previous owner does not have enough points")
        await log_points_event(db, user_id=from_owner_id, points=-points_offered, event_type="casino_video_poker", event_ref=f"buyback:{request.offer_id}", meta={"action": "buyback_deduct", "city": city, "offer_id": request.offer_id})
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"points": points_offered}})
        await log_points_event(db, user_id=current_user.get("id") or "", points=points_offered, event_type="casino_video_poker", event_ref=f"buyback:{request.offer_id}", meta={"action": "buyback_credit", "city": city, "offer_id": request.offer_id})
        # Reset max_bet to 0 when ownership returns - owner must set it again
        await db.videopoker_ownership.update_one({"city": city}, {"$set": {"owner_id": from_owner_id, "owner_username": from_user.get("username"), "max_bet": 0}})
        _invalidate_ownership_cache(current_user.get("id") or "")
        _invalidate_ownership_cache(from_owner_id)
        return {"message": "Accepted. You received the points and the table was returned to the previous owner."}

    @router.post("/casino/videopoker/buy-back/reject")
    async def casino_videopoker_buy_back_reject(request: VideoPokerBuyBackRejectRequest, current_user: dict = Depends(get_current_user_verified)):
        """Reject a buy-back offer: keep ownership."""
        offer = await db.videopoker_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0, "to_user_id": 1})
        if not offer or offer.get("to_user_id") != current_user.get("id") or "":
            raise HTTPException(status_code=404, detail="Offer not found")
        await db.videopoker_buy_back_offers.delete_one({"id": request.offer_id})
        _invalidate_ownership_cache(current_user.get("id") or "")
        return {"message": "Rejected. You keep the table."}

    @router.post("/casino/videopoker/send-to-user")
    async def casino_videopoker_send_to_user(request: RouletteSendToUserRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        target_username_pattern = _username_pattern(request.target_username.strip())
        target = await db.users.find_one({"username": target_username_pattern}, {"_id": 0, "id": 1, "username": 1, "rank_points": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        send_set = {"owner_id": target.get("id") or "", "owner_username": target.get("username")}
        if get_rank_info(target.get("rank_points", 0))[0] < CAPO_RANK_ID:
            send_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
        await db.videopoker_ownership.update_one({"city": stored_city or city}, {"$set": send_set})
        _invalidate_ownership_cache(target.get("id") or "")
        return {"message": "Ownership transferred."}

    @router.post("/casino/videopoker/sell-on-trade")
    async def casino_videopoker_sell_on_trade(request: DiceSellOnTradeRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        if request.points <= 0:
            raise HTTPException(status_code=400, detail="Points must be positive")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        listing_id = ObjectId()
        casino_property = {
            "_id": listing_id,
            "id": str(listing_id),
            "type": "casino_videopoker",
            "location": city,
            "name": f"Video Poker Table ({city})",
            "owner_id": current_user.get("id") or "",
            "owner_username": current_user.get("username", "Unknown"),
            "for_sale": True,
            "sale_price": request.points,
            "created_at": datetime.now(timezone.utc),
        }
        await db.properties.insert_one(casino_property)
        return {"message": f"Video Poker table listed for {request.points:,} points on Quick Trade"}

    @router.get("/casino/videopoker/game")
    async def casino_videopoker_game(current_user: dict = Depends(get_current_user_verified)):
        """Get the current active game (if any) for page refresh."""
        game = await db.videopoker_games.find_one({"user_id": current_user.get("id") or ""}, {"_id": 0, "deck": 0})
        if not game:
            return {"active": False}
        return {"active": True, "bet": game.get("bet"), "hand": game.get("hand"), "status": game.get("status", "deal")}

    @router.post("/casino/videopoker/deal")
    async def casino_videopoker_deal(request: VideoPokerDealRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city(raw) if raw else (STATES[0] if STATES else "")
        if not city:
            raise HTTPException(status_code=400, detail="No current city")
        stored_city, doc = await _get_ownership_doc(city)
        max_bet = doc.get("max_bet", VIDEO_POKER_DEFAULT_MAX_BET) if doc else VIDEO_POKER_DEFAULT_MAX_BET
        owner_id = doc.get("owner_id") if doc else None
        if owner_id and owner_id == current_user.get("id"):
            raise HTTPException(status_code=400, detail="You cannot play at your own table")
        bet = max(0, int(request.bet))
        if bet <= 0:
            raise HTTPException(status_code=400, detail="Bet must be positive")
        if bet > max_bet:
            raise HTTPException(status_code=400, detail=f"Bet exceeds max ${max_bet:,}")
        debit_res = await db.users.find_one_and_update(
            {"id": current_user.get("id") or "", "money": {"$gte": bet}},
            {"$inc": {"money": -bet}},
        )
        if not debit_res:
            raise HTTPException(status_code=400, detail="Not enough money")
        existing = await db.videopoker_games.find_one({"user_id": current_user.get("id") or ""})
        if existing:
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": bet}})
            raise HTTPException(status_code=400, detail="Finish your current game first")
        deck = _make_deck()
        _rng.shuffle(deck)
        hand = [deck.pop() for _ in range(5)]
        if owner_id:
            await db.users.update_one({"id": owner_id}, {"$inc": {"money": bet}})
        await db.videopoker_games.insert_one({
            "user_id": current_user.get("id") or "",
            "city": stored_city or city,
            "bet": bet,
            "hand": hand,
            "deck": deck,
            "status": "deal",
            "owner_id": owner_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        return {"status": "deal", "bet": bet, "hand": hand}

    @router.post("/casino/videopoker/draw")
    async def casino_videopoker_draw(request: VideoPokerDrawRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        game = await db.videopoker_games.find_one_and_delete(
            {"user_id": current_user.get("id") or "", "status": "deal"}
        )
        if not game:
            raise HTTPException(status_code=400, detail="No active game or already settled")
        deck = list(game.get("deck") or [])
        hand = list(game.get("hand") or [])
        bet = game.get("bet", 0)
        owner_id = game.get("owner_id")
        city = game.get("city", "")

        holds = set()
        for h in (request.holds or []):
            idx = int(h)
            if 0 <= idx <= 4:
                holds.add(idx)

        for i in range(5):
            if i not in holds and deck:
                hand[i] = deck.pop()

        hand_key, hand_name, multiplier = _evaluate_hand(hand)
        payout = bet * multiplier

        user = await db.users.find_one({"id": current_user.get("id") or ""})
        shortfall = 0

        if payout == 0:
            head_family_id = await get_head_family_id_for_state(city) if city else None
            if owner_id:
                if head_family_id:
                    edge_lose = int(bet * VIDEO_POKER_HOUSE_EDGE)
                    if edge_lose > 0:
                        await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose, "state_head_income.videopoker": edge_lose}})
                    await db.users.update_one({"id": owner_id}, {"$inc": {"money": -edge_lose}})
                    await db.videopoker_ownership.update_one({"city": city}, {"$inc": {"total_earnings": bet, "profit": max(0, bet - edge_lose)}})
                    _invalidate_ownership_cache(owner_id)
                else:
                    await db.videopoker_ownership.update_one({"city": city}, {"$inc": {"total_earnings": bet, "profit": bet}})
                    _invalidate_ownership_cache(owner_id)
            elif head_family_id:
                edge_lose = int(bet * VIDEO_POKER_HOUSE_EDGE)
                if edge_lose > 0:
                    await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose, "state_head_income.videopoker": edge_lose}})
        elif payout == bet:
            if owner_id:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": -bet}})
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": payout}})
        else:
            profit_portion = payout - bet
            ownership_transferred = False
            buy_back_offer = None
            if owner_id:
                owner_doc = await db.videopoker_ownership.find_one({"city": city}, {"_id": 0, "buy_back_reward": 1})
                points_offered = int((owner_doc or {}).get("buy_back_reward") or 0)
                owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1, "username": 1})
                owner_money = int(((owner or {}).get("money") or 0) or 0)
                owner_username = (owner or {}).get("username")
                actual_payout = min(payout, owner_money)
                shortfall = payout - actual_payout
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": actual_payout}})
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_payout, "total_casino_payouts": actual_payout}})
                # Track biggest payout for owner
                await bump_user_biggest_casino_payout(owner_id, actual_payout)
                await db.videopoker_ownership.update_one({"city": city}, {"$inc": {"profit": bet - actual_payout}})
                _invalidate_ownership_cache(owner_id)
                payout = actual_payout
                if shortfall > 0:
                    ownership_transferred = True
                    vp_owner_set = {"owner_id": current_user.get("id") or "", "owner_username": current_user.get("username") or ""}
                    if get_rank_info(current_user.get("rank_points", 0))[0] < CAPO_RANK_ID:
                        vp_owner_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
                    await db.videopoker_ownership.update_one({"city": city}, {"$set": vp_owner_set})
                    # Track casino won/lost stats
                    await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"casinos_seized": 1}})
                    await db.users.update_one({"id": owner_id}, {"$inc": {"casinos_lost": 1}})
                    if points_offered <= 0:
                        head_family_id = await get_head_family_id_for_state(city) if city else None
                        if head_family_id:
                            edge_lose = int(bet * VIDEO_POKER_HOUSE_EDGE)
                            if edge_lose > 0:
                                await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose, "state_head_income.videopoker": edge_lose}})
                    else:
                        # Create buyback offer
                        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
                        offer_id = str(uuid.uuid4())
                        buy_back_doc = {
                            "id": offer_id,
                            "city": city,
                            "from_owner_id": owner_id,
                            "from_owner_username": owner_username,
                            "to_user_id": current_user.get("id") or "",
                            "to_username": current_user.get("username"),
                            "points_offered": points_offered,
                            "amount_shortfall": shortfall,
                            "owner_paid": actual_payout,
                            "expires_at": expires_at,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }
                        await db.videopoker_buy_back_offers.insert_one(buy_back_doc)
                        buy_back_offer = {"offer_id": offer_id, "points_offered": points_offered, "amount_shortfall": shortfall, "owner_paid": actual_payout, "expires_at": expires_at}
            else:
                head_family_id = await get_head_family_id_for_state(city) if city else None
                if head_family_id and profit_portion > 0:
                    edge = int(profit_portion * VIDEO_POKER_HOUSE_EDGE)
                    if edge > 0:
                        await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge, "state_head_income.videopoker": edge}})
                    payout = bet + profit_portion - edge
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": payout}})

        updated_user = await db.users.find_one({"id": current_user.get("id") or ""})
        new_balance = (updated_user.get("money", 0) or 0)

        await _settle_and_save_history(
            current_user.get("id") or "", current_user.get("username"), city, bet, hand_key, hand_name, payout, hand
        )

        result = {
            "status": "done",
            "bet": bet,
            "hand": hand,
            "hand_key": hand_key,
            "hand_name": hand_name,
            "multiplier": multiplier,
            "payout": payout,
            "new_balance": new_balance,
            "shortfall": shortfall,
        }
        # Add buyback info if ownership was transferred
        if owner_id and payout > bet and shortfall > 0:
            result["ownership_transferred"] = ownership_transferred
            result["buy_back_offer"] = buy_back_offer
        return result

    @router.get("/casino/videopoker/history")
    async def casino_videopoker_history(current_user: dict = Depends(get_current_user_verified)):
        user = await db.users.find_one({"id": current_user.get("id") or ""}, {"_id": 0, "videopoker_history": 1})
        history = (user.get("videopoker_history") or [])[:VIDEO_POKER_HISTORY_MAX]
        return {"history": history}
