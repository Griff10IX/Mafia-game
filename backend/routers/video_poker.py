# Casino Video Poker (Jacks or Better): config, ownership, claim, relinquish, set-max-bet, send-to-user, sell-on-trade, deal, draw, game, history
from datetime import datetime, timezone
import re
import random
import time
from collections import Counter
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
VIDEO_POKER_MAX_BET = 50_000_000
VIDEO_POKER_DEFAULT_MAX_BET = 50_000_000
VIDEO_POKER_ABSOLUTE_MAX_BET = 500_000_000
VIDEO_POKER_CLAIM_COST = 500_000_000
VIDEO_POKER_HISTORY_MAX = 10

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
    async def casino_videopoker_config(current_user: dict = Depends(get_current_user)):
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city(raw) if raw else (STATES[0] if STATES else "")
        _, doc = await _get_ownership_doc(city) if city else (None, None)
        max_bet = doc.get("max_bet", VIDEO_POKER_DEFAULT_MAX_BET) if doc else VIDEO_POKER_DEFAULT_MAX_BET
        return {
            "max_bet": max_bet,
            "claim_cost": VIDEO_POKER_CLAIM_COST,
            "pay_table": PAY_TABLE,
            "hand_names": HAND_NAMES,
        }

    @router.get("/casino/videopoker/ownership")
    async def casino_videopoker_ownership(current_user: dict = Depends(get_current_user)):
        user_id = current_user["id"]
        now_ts = time.time()
        entry = _ownership_cache.get(user_id)
        if entry and (now_ts - entry["ts"]) < _OWNERSHIP_TTL_SEC:
            return entry["data"]
        raw = (current_user.get("current_state") or "").strip()
        city = _normalize_city(raw) if raw else (STATES[0] if STATES else "Chicago")
        display_city = city or raw or "Chicago"
        stored_city, doc = await _get_ownership_doc(city)
        if not doc:
            out = {
                "current_city": display_city,
                "owner_id": None,
                "owner_name": None,
                "is_owner": False,
                "is_unclaimed": True,
                "claim_cost": VIDEO_POKER_CLAIM_COST,
                "max_bet": VIDEO_POKER_DEFAULT_MAX_BET,
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
        max_bet = doc.get("max_bet", VIDEO_POKER_DEFAULT_MAX_BET)
        total_earnings = doc.get("total_earnings", 0)
        profit = int((doc.get("profit") or 0) or 0)
        out = {
            "current_city": display_city,
            "owner_id": owner_id,
            "owner_name": owner_name,
            "is_owner": is_owner,
            "is_unclaimed": owner_id is None,
            "claim_cost": VIDEO_POKER_CLAIM_COST,
            "max_bet": max_bet,
            "total_earnings": total_earnings if is_owner else None,
            "profit": profit if is_owner else None,
        }
        if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
            _ownership_cache[user_id] = {"ts": now_ts, "data": out}
        return out

    @router.post("/casino/videopoker/claim")
    async def casino_videopoker_claim(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user)):
        rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
        if rank_id < CAPO_RANK_ID:
            raise HTTPException(status_code=403, detail="You must be rank Capo or higher to claim a casino. Reach Capo to hold one.")
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        owned = await _user_owns_any_casino(current_user["id"])
        if owned and (owned.get("type") != "videopoker" or owned.get("city") != city):
            raise HTTPException(status_code=400, detail="You may only own 1 casino. Relinquish it first (Casino or My Properties).")
        stored_city, doc = await _get_ownership_doc(city)
        if doc and doc.get("owner_id"):
            raise HTTPException(status_code=400, detail="This table already has an owner")
        user = await db.users.find_one({"id": current_user["id"]})
        if not user or user.get("money", 0) < VIDEO_POKER_CLAIM_COST:
            raise HTTPException(status_code=400, detail=f"You need ${VIDEO_POKER_CLAIM_COST:,} to claim")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -VIDEO_POKER_CLAIM_COST}})
        await db.videopoker_ownership.update_one(
            {"city": stored_city or city},
            {"$set": {"owner_id": current_user["id"], "owner_username": current_user["username"], "max_bet": VIDEO_POKER_DEFAULT_MAX_BET, "total_earnings": 0, "profit": 0}},
            upsert=True,
        )
        return {"message": f"You now own the video poker table in {city}!"}

    @router.post("/casino/videopoker/relinquish")
    async def casino_videopoker_relinquish(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        await db.videopoker_ownership.update_one({"city": stored_city or city}, {"$set": {"owner_id": None, "owner_username": None}})
        return {"message": "Ownership relinquished."}

    @router.post("/casino/videopoker/set-max-bet")
    async def casino_videopoker_set_max_bet(request: RouletteSetMaxBetRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        new_max = max(1_000_000, min(request.max_bet, VIDEO_POKER_ABSOLUTE_MAX_BET))
        await db.videopoker_ownership.update_one({"city": stored_city or city}, {"$set": {"max_bet": new_max}})
        return {"message": f"Max bet set to ${new_max:,}"}

    @router.post("/casino/videopoker/send-to-user")
    async def casino_videopoker_send_to_user(request: RouletteSendToUserRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        target_username_pattern = _username_pattern(request.target_username.strip())
        target = await db.users.find_one({"username": target_username_pattern}, {"_id": 0, "id": 1, "username": 1, "rank_points": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        send_set = {"owner_id": target["id"], "owner_username": target.get("username")}
        if get_rank_info(target.get("rank_points", 0))[0] < CAPO_RANK_ID:
            send_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
        await db.videopoker_ownership.update_one({"city": stored_city or city}, {"$set": send_set})
        _invalidate_ownership_cache(target["id"])
        return {"message": "Ownership transferred."}

    @router.post("/casino/videopoker/sell-on-trade")
    async def casino_videopoker_sell_on_trade(request: DiceSellOnTradeRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        if request.points <= 0:
            raise HTTPException(status_code=400, detail="Points must be positive")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        casino_property = {
            "_id": ObjectId(),
            "type": "casino_videopoker",
            "location": city,
            "name": f"Video Poker Table ({city})",
            "owner_id": current_user["id"],
            "owner_username": current_user.get("username", "Unknown"),
            "for_sale": True,
            "sale_price": request.points,
            "created_at": datetime.now(timezone.utc),
        }
        await db.properties.insert_one(casino_property)
        return {"message": f"Video Poker table listed for {request.points:,} points on Quick Trade"}

    @router.get("/casino/videopoker/game")
    async def casino_videopoker_game(current_user: dict = Depends(get_current_user)):
        """Get the current active game (if any) for page refresh."""
        game = await db.videopoker_games.find_one({"user_id": current_user["id"]}, {"_id": 0, "deck": 0})
        if not game:
            return {"active": False}
        return {"active": True, "bet": game.get("bet"), "hand": game.get("hand"), "status": game.get("status", "deal")}

    @router.post("/casino/videopoker/deal")
    async def casino_videopoker_deal(request: VideoPokerDealRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        if current_user.get("in_jail"):
            raise HTTPException(status_code=400, detail="You are in jail!")
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city(raw) if raw else (STATES[0] if STATES else "")
        if not city:
            raise HTTPException(status_code=400, detail="No current city")
        stored_city, doc = await _get_ownership_doc(city)
        max_bet = doc.get("max_bet", VIDEO_POKER_DEFAULT_MAX_BET) if doc else VIDEO_POKER_DEFAULT_MAX_BET
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
        existing = await db.videopoker_games.find_one({"user_id": current_user["id"]})
        if existing:
            raise HTTPException(status_code=400, detail="Finish your current game first")
        deck = _make_deck()
        random.shuffle(deck)
        hand = [deck.pop() for _ in range(5)]
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -bet}})
        await db.videopoker_games.insert_one({
            "user_id": current_user["id"],
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
    async def casino_videopoker_draw(request: VideoPokerDrawRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        game = await db.videopoker_games.find_one({"user_id": current_user["id"]})
        if not game:
            raise HTTPException(status_code=400, detail="No active game")
        if game.get("status") != "deal":
            raise HTTPException(status_code=400, detail="Game not in deal phase")
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

        user = await db.users.find_one({"id": current_user["id"]})
        shortfall = 0

        if payout == 0:
            if owner_id:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": bet}})
                await db.videopoker_ownership.update_one({"city": city}, {"$inc": {"total_earnings": bet, "profit": bet}})
        elif payout == bet:
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": payout}})
        else:
            profit_portion = payout - bet
            if owner_id:
                owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1})
                owner_money = int((owner.get("money") or 0) or 0)
                actual_owner_pay = min(profit_portion, owner_money)
                shortfall = profit_portion - actual_owner_pay
                actual_payout = bet + actual_owner_pay
                await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": actual_payout}})
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_owner_pay}})
                await db.videopoker_ownership.update_one({"city": city}, {"$inc": {"profit": -actual_owner_pay}})
                payout = actual_payout
            else:
                await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": payout}})

        updated_user = await db.users.find_one({"id": current_user["id"]})
        new_balance = (updated_user.get("money", 0) or 0)

        await _settle_and_save_history(
            current_user["id"], current_user.get("username"), city, bet, hand_key, hand_name, payout, hand
        )

        return {
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

    @router.get("/casino/videopoker/history")
    async def casino_videopoker_history(current_user: dict = Depends(get_current_user)):
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "videopoker_history": 1})
        history = (user.get("videopoker_history") or [])[:VIDEO_POKER_HISTORY_MAX]
        return {"history": history}
