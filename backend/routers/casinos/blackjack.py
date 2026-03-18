# Casino Blackjack: config, ownership, claim, relinquish, set-max-bet, set-buy-back, buy-back, send-to-user, sell-on-trade, start, hit, stand, history
from datetime import datetime, timezone, timedelta
import re
import secrets
_rng = secrets.SystemRandom()
import uuid
import time
from typing import Optional
from pydantic import BaseModel, field_validator
from bson.objectid import ObjectId

from fastapi import Depends, HTTPException

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
)
from routers.casinos.roulette import RouletteClaimRequest, RouletteSetMaxBetRequest, RouletteSendToUserRequest
from routers.casinos.dice import DiceSellOnTradeRequest

# ----- Constants -----
BLACKJACK_MAX_BET = 50_000_000
BLACKJACK_DEFAULT_MAX_BET = 50_000_000
BLACKJACK_ABSOLUTE_MAX_BET = 500_000_000
BLACKJACK_CLAIM_COST = 500_000_000  # $500M to claim table
BLACKJACK_HOUSE_EDGE = 0.0005  # 0.05% of bet to owner when player loses
BLACKJACK_HISTORY_MAX = 10
BLACKJACK_GAME_TIMEOUT_SECONDS = 600  # Unfinished game auto-stands and finishes after this

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


def _blackjack_game_is_stale(game: dict) -> bool:
    """True if game was created more than BLACKJACK_GAME_TIMEOUT_SECONDS ago."""
    created = game.get("created_at")
    if not created:
        return True
    try:
        if isinstance(created, str):
            dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
        else:
            dt = created
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds() >= BLACKJACK_GAME_TIMEOUT_SECONDS
    except Exception:
        return True


async def _blackjack_auto_finish_game(game: dict, current_user: dict):
    """Settle an in-progress game as if player stood (dealer to 17, result, pay/collect, history, remove game)."""
    claimed = await db.blackjack_games.find_one_and_delete({"user_id": current_user.get("id") or ""})
    if not claimed:
        return
    game = claimed
    bj_city = game.get("city")
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
        head_family_id = await get_head_family_id_for_state(bj_city) if bj_city else None
        edge_lose = int(bet * BLACKJACK_HOUSE_EDGE) if head_family_id else 0
        if head_family_id and edge_lose > 0:
            await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose, "state_head_income.blackjack": edge_lose}})
        if owner_id:
            owner_take = max(0, bet - edge_lose)
            if owner_take > 0:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": owner_take}})
            await db.blackjack_ownership.update_one(
                {"city": bj_city},
                {"$inc": {"total_earnings": owner_take, "profit": owner_take}},
            )
            _invalidate_ownership_cache(owner_id)
    else:
        result = "push"
        payout = bet
    if payout > 0:
        if owner_id and result in ("win", "dealer_bust"):
            owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1, "username": 1})
            owner_money = int(((owner or {}).get("money") or 0) or 0)
            actual_owner_pay = min(bet, owner_money)
            shortfall = bet - actual_owner_pay
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": bet + actual_owner_pay}})
            await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_owner_pay, "total_casino_payouts": actual_owner_pay}})
            await db.users.update_one({"id": owner_id, "biggest_casino_payout": {"$lt": actual_owner_pay}}, {"$set": {"biggest_casino_payout": actual_owner_pay}})
            stored_city_bj, doc_bj = await _get_blackjack_ownership_doc(bj_city)
            buy_back_reward = int((doc_bj or {}).get("buy_back_reward") or 0)
            if shortfall > 0:
                bj_owner_set = {"owner_id": current_user.get("id") or "", "owner_username": current_user.get("username")}
                if get_rank_info(current_user.get("rank_points", 0))[0] < CAPO_RANK_ID:
                    bj_owner_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
                await db.blackjack_ownership.update_one({"city": stored_city_bj or bj_city}, {"$set": bj_owner_set})
                if buy_back_reward > 0:
                    owner_username = (owner or {}).get("username")
                    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
                    offer_id = str(uuid.uuid4())
                    await db.blackjack_buy_back_offers.insert_one({
                        "id": offer_id,
                        "city": stored_city_bj or bj_city,
                        "from_owner_id": owner_id,
                        "to_user_id": current_user.get("id") or "",
                        "points_offered": buy_back_reward,
                        "amount_shortfall": shortfall,
                        "owner_paid": actual_owner_pay,
                        "expires_at": expires_at,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })
                    await db.blackjack_ownership.update_one(
                        {"city": stored_city_bj or bj_city},
                        {"$inc": {"total_earnings": -actual_owner_pay, "profit": -actual_owner_pay}},
                    )
                else:
                    await db.blackjack_ownership.update_one(
                        {"city": stored_city_bj or bj_city},
                        {"$inc": {"total_earnings": -actual_owner_pay, "profit": -actual_owner_pay}},
                    )
            else:
                await db.blackjack_ownership.update_one(
                    {"city": stored_city_bj or bj_city},
                    {"$inc": {"total_earnings": -actual_owner_pay, "profit": -actual_owner_pay}},
                )
            _invalidate_ownership_cache(owner_id)
        else:
            if not owner_id and result in ("win", "dealer_bust"):
                head_family_id = await get_head_family_id_for_state(bj_city) if bj_city else None
                if head_family_id:
                    edge = int(bet * BLACKJACK_HOUSE_EDGE)
                    if edge > 0:
                        await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge, "state_head_income.blackjack": edge}})
                    payout = bet * 2 - edge
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": payout}})
    await _blackjack_settle_and_save_history(
        current_user.get("id") or "", current_user.get("username"), bj_city, bet, result, payout, player_hand, dealer_hand, player_total, dealer_total
    )


def register(router):
    @router.get("/casino/blackjack/config")
    async def casino_blackjack_config(current_user: dict = Depends(get_current_user_verified)):
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city_for_blackjack(raw) if raw else (STATES[0] if STATES else "")
        _, doc = await _get_blackjack_ownership_doc(city) if city else (None, None)
        max_bet = doc.get("max_bet", BLACKJACK_DEFAULT_MAX_BET) if doc else BLACKJACK_DEFAULT_MAX_BET
        return {"max_bet": max_bet, "claim_cost": BLACKJACK_CLAIM_COST, "house_edge": BLACKJACK_HOUSE_EDGE}

    @router.get("/casino/blackjack/current-game")
    async def casino_blackjack_current_game(current_user: dict = Depends(get_current_user_verified)):
        """Return in-progress game so the UI can show it; if game is older than timeout, auto-stand and return hasGame: false."""
        game = await db.blackjack_games.find_one({"user_id": current_user.get("id") or ""})
        if not game:
            return {"hasGame": False}
        if _blackjack_game_is_stale(game):
            await _blackjack_auto_finish_game(game, current_user)
            return {"hasGame": False}
        player_hand = list(game.get("player_hand") or [])
        dealer_hand = list(game.get("dealer_hand") or [])
        player_total = _blackjack_hand_total(player_hand)
        dealer_visible = dealer_hand[0] if len(dealer_hand) > 0 else None
        dealer_visible_total = _blackjack_hand_total([dealer_visible]) if dealer_visible else 0
        dealer_hidden_count = max(0, len(dealer_hand) - 1)
        can_hit = player_total < 21 and dealer_hidden_count > 0
        return {
            "hasGame": True,
            "status": "playing",
            "bet": game.get("bet", 0),
            "player_hand": player_hand,
            "dealer_hand": dealer_hand,
            "player_total": player_total,
            "dealer_visible_total": dealer_visible_total,
            "dealer_hidden_count": dealer_hidden_count,
            "can_hit": can_hit,
            "can_stand": True,
            "created_at": game.get("created_at"),
            "timeout_seconds": BLACKJACK_GAME_TIMEOUT_SECONDS,
        }

    @router.get("/casino/blackjack/ownership")
    async def casino_blackjack_ownership(current_user: dict = Depends(get_current_user_verified)):
        """Current city's blackjack ownership. Expired buy-back offers are auto-REJECTED."""
        user_id = current_user.get("id") or ""
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
        is_owner = owner_id == current_user.get("id") or ""
        max_bet = doc.get("max_bet", BLACKJACK_DEFAULT_MAX_BET)
        total_earnings = doc.get("total_earnings", 0)
        profit = int((doc.get("profit") or 0) or 0)
        buy_back_reward = doc.get("buy_back_reward")
        active_offer = await db.blackjack_buy_back_offers.find_one(
            {"to_user_id": current_user.get("id") or ""},
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
    async def casino_blackjack_claim(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
        prestige_level = int(current_user.get("prestige_level") or 0)
        if rank_id < CAPO_RANK_ID and prestige_level < 1:
            raise HTTPException(status_code=403, detail="You must be rank Capo or higher to claim a casino. Reach Capo to hold one.")
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_blackjack((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        owned = await _user_owns_any_casino(current_user.get("id") or "")
        if owned and (owned.get("type") != "blackjack" or owned.get("city") != city):
            raise HTTPException(status_code=400, detail="You may only own 1 casino. Relinquish it first (Casino or My Properties).")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        user = await db.users.find_one({"id": current_user.get("id") or ""})
        if not user or user.get("money", 0) < BLACKJACK_CLAIM_COST:
            raise HTTPException(status_code=400, detail=f"You need ${BLACKJACK_CLAIM_COST:,} to claim")
        res = await db.blackjack_ownership.update_one(
            {"city": stored_city or city, "owner_id": None},
            {"$set": {"owner_id": current_user.get("id") or "", "owner_username": current_user.get("username") or "", "max_bet": BLACKJACK_DEFAULT_MAX_BET, "buy_back_reward": 0}},
            upsert=True,
        )
        if not res.modified_count and not res.upserted_id:
            raise HTTPException(status_code=400, detail="This table already has an owner")
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": -BLACKJACK_CLAIM_COST}})
        return {"message": f"You now own the blackjack table in {city}!"}

    @router.post("/casino/blackjack/relinquish")
    async def casino_blackjack_relinquish(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_blackjack((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        await db.blackjack_ownership.update_one({"city": stored_city or city}, {"$set": {"owner_id": None, "owner_username": None}})
        return {"message": "Ownership relinquished."}

    @router.post("/casino/blackjack/reset-profit")
    async def casino_blackjack_reset_profit(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        """Reset profit counter to zero (owner only)."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_blackjack((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        await db.blackjack_ownership.update_one({"city": stored_city or city}, {"$set": {"profit": 0}})
        return {"message": "Profit reset to zero."}

    @router.post("/casino/blackjack/set-max-bet")
    async def casino_blackjack_set_max_bet(request: RouletteSetMaxBetRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_blackjack((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        global_cap, _ = await get_casino_caps()
        new_max = max(1_000_000, min(request.max_bet, global_cap))
        await db.blackjack_ownership.update_one({"city": stored_city or city}, {"$set": {"max_bet": new_max}})
        return {"message": f"Max bet set to ${new_max:,}"}

    @router.post("/casino/blackjack/set-buy-back-reward")
    async def casino_blackjack_set_buy_back_reward(request: BlackjackSetBuyBackRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        raw = (request.city or current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city_for_blackjack(raw) if raw else (STATES[0] if STATES else "")
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        _, buyback_cap = await get_casino_caps()
        amount = max(0, min(int(request.amount), buyback_cap))
        await db.blackjack_ownership.update_one({"city": stored_city or city}, {"$set": {"buy_back_reward": amount}})
        return {"message": "Buy-back reward updated."}

    @router.post("/casino/blackjack/buy-back/accept")
    async def casino_blackjack_buy_back_accept(request: BlackjackBuyBackAcceptRequest, current_user: dict = Depends(get_current_user_verified)):
        offer = await db.blackjack_buy_back_offers.find_one_and_delete({"id": request.offer_id}, projection={"_id": 0})
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
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"points": points_offered}})
        from_username = from_user.get("username") if from_user else None
        # Reset max_bet to 0 when ownership returns - owner must set it again
        await db.blackjack_ownership.update_one({"city": city}, {"$set": {"owner_id": from_owner_id, "owner_username": from_username, "max_bet": 0}})
        _invalidate_ownership_cache(current_user.get("id") or "")
        _invalidate_ownership_cache(from_owner_id)
        return {"message": "Accepted. You received the points and the table was returned to the previous owner."}

    @router.post("/casino/blackjack/buy-back/reject")
    async def casino_blackjack_buy_back_reject(request: BlackjackBuyBackRejectRequest, current_user: dict = Depends(get_current_user_verified)):
        offer = await db.blackjack_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0, "to_user_id": 1})
        if not offer or offer.get("to_user_id") != current_user.get("id") or "":
            raise HTTPException(status_code=404, detail="Offer not found")
        await db.blackjack_buy_back_offers.delete_one({"id": request.offer_id})
        _invalidate_ownership_cache(current_user.get("id") or "")
        return {"message": "Rejected. You keep the casino."}

    @router.post("/casino/blackjack/send-to-user")
    async def casino_blackjack_send_to_user(request: RouletteSendToUserRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_blackjack((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        target_username_pattern = _username_pattern(request.target_username.strip())
        target = await db.users.find_one({"username": target_username_pattern}, {"_id": 0, "id": 1, "username": 1, "rank_points": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        send_set = {"owner_id": target.get("id") or "", "owner_username": target.get("username") or ""}
        if get_rank_info(target.get("rank_points", 0))[0] < CAPO_RANK_ID:
            send_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
        await db.blackjack_ownership.update_one({"city": stored_city or city}, {"$set": send_set})
        _invalidate_ownership_cache(target.get("id") or "")
        return {"message": "Ownership transferred."}

    @router.post("/casino/blackjack/sell-on-trade")
    async def casino_blackjack_sell_on_trade(request: DiceSellOnTradeRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_blackjack((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        if request.points <= 0:
            raise HTTPException(status_code=400, detail="Points must be positive")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        casino_property = {
            "_id": ObjectId(),
            "type": "casino_blackjack",
            "location": city,
            "name": f"Blackjack Table ({city})",
            "owner_id": current_user.get("id") or "",
            "owner_username": current_user.get("username", "Unknown"),
            "for_sale": True,
            "sale_price": request.points,
            "created_at": datetime.now(timezone.utc)
        }
        await db.properties.insert_one(casino_property)
        return {"message": f"Blackjack table listed for {request.points:,} points on Quick Trade"}

    @router.post("/casino/blackjack/start")
    async def casino_blackjack_start(request: BlackjackStartRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city_for_blackjack(raw) if raw else (STATES[0] if STATES else "")
        if not city:
            raise HTTPException(status_code=400, detail="No current city")
        stored_city, doc = await _get_blackjack_ownership_doc(city)
        max_bet = doc.get("max_bet", BLACKJACK_DEFAULT_MAX_BET) if doc else BLACKJACK_DEFAULT_MAX_BET
        owner_id = doc.get("owner_id") if doc else None
        if owner_id and owner_id == current_user.get("id"):
            raise HTTPException(status_code=400, detail="You cannot play at your own table")
        bet = max(0, int(request.bet))
        if bet <= 0:
            raise HTTPException(status_code=400, detail="Bet must be positive")
        if bet > max_bet:
            raise HTTPException(status_code=400, detail=f"Bet exceeds max ${max_bet:,}")
        existing = await db.blackjack_games.find_one({"user_id": current_user.get("id") or ""})
        if existing:
            if _blackjack_game_is_stale(existing):
                await _blackjack_auto_finish_game(existing, current_user)
            else:
                raise HTTPException(status_code=400, detail="Finish your current game first")
        debit_res = await db.users.find_one_and_update(
            {"id": current_user.get("id") or "", "money": {"$gte": bet}},
            {"$inc": {"money": -bet}},
            return_document=False,
        )
        if not debit_res:
            raise HTTPException(status_code=400, detail="Not enough money")
        user = debit_res
        deck = _blackjack_make_deck()
        _rng.shuffle(deck)
        player_hand = [deck.pop(), deck.pop()]
        dealer_hand = [deck.pop(), deck.pop()]
        player_total = _blackjack_hand_total(player_hand)
        dealer_total = _blackjack_hand_total(dealer_hand)
        dealer_hidden = 1
        status = "playing"
        can_hit = True
        can_stand = True
        if _blackjack_is_blackjack(player_hand):
            if _blackjack_is_blackjack(dealer_hand):
                payout = bet
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": payout}})
                await _blackjack_settle_and_save_history(
                    current_user.get("id") or "", current_user.get("username"), city, bet, "push", payout, player_hand, dealer_hand, player_total, dealer_total
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
                owner_money = int(((owner or {}).get("money") or 0) or 0)
                actual_owner_pay = min(owner_pay, owner_money)
                actual_payout = bet + actual_owner_pay
                shortfall = owner_pay - actual_owner_pay
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": actual_payout}})
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_owner_pay, "total_casino_payouts": actual_owner_pay}})
                await db.users.update_one({"id": owner_id, "biggest_casino_payout": {"$lt": actual_owner_pay}}, {"$set": {"biggest_casino_payout": actual_owner_pay}})
                buy_back_reward = int((doc or {}).get("buy_back_reward") or 0)
                if shortfall > 0:
                    ownership_transferred = True
                    bj_owner_set = {"owner_id": current_user.get("id") or "", "owner_username": current_user.get("username")}
                    if get_rank_info(current_user.get("rank_points", 0))[0] < CAPO_RANK_ID:
                        bj_owner_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
                    await db.blackjack_ownership.update_one({"city": stored_city or city}, {"$set": bj_owner_set})
                    # Track casino seizure stats
                    await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"casinos_seized": 1}})
                    await db.users.update_one({"id": owner_id}, {"$inc": {"casinos_lost": 1}})
                    if buy_back_reward <= 0:
                        await db.blackjack_ownership.update_one(
                            {"city": stored_city or city},
                            {"$inc": {"total_earnings": -actual_owner_pay, "profit": -actual_owner_pay}},
                        )
                    else:
                        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
                        offer_id = str(uuid.uuid4())
                        await db.blackjack_buy_back_offers.insert_one({
                            "id": offer_id,
                            "city": stored_city or city,
                            "from_owner_id": owner_id,
                            "to_user_id": current_user.get("id") or "",
                            "points_offered": buy_back_reward,
                            "amount_shortfall": shortfall,
                            "owner_paid": actual_owner_pay,
                            "expires_at": expires_at,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        })
                        buy_back_offer = {"offer_id": offer_id, "points_offered": buy_back_reward, "amount_shortfall": shortfall, "owner_paid": actual_owner_pay, "expires_at": expires_at}
                        await db.blackjack_ownership.update_one(
                            {"city": stored_city or city},
                            {"$inc": {"total_earnings": -actual_owner_pay, "profit": -actual_owner_pay}},
                        )
                else:
                    await db.blackjack_ownership.update_one(
                        {"city": stored_city or city},
                        {"$inc": {"total_earnings": -actual_owner_pay, "profit": -actual_owner_pay}},
                    )
                _invalidate_ownership_cache(owner_id)
            else:
                # No owner: house edge to state head (like dice)
                head_family_id = await get_head_family_id_for_state(stored_city or city)
                if head_family_id:
                    edge = int(owner_pay * BLACKJACK_HOUSE_EDGE)
                    if edge > 0:
                        await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge, "state_head_income.blackjack": edge}})
                    actual_payout = bet + owner_pay - edge
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": actual_payout}})
            await _blackjack_settle_and_save_history(
                current_user.get("id") or "", current_user.get("username"), city, bet, "blackjack", actual_payout, player_hand, dealer_hand, player_total, dealer_total
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
            head_family_id = await get_head_family_id_for_state(stored_city or city)
            edge_lose = int(bet * BLACKJACK_HOUSE_EDGE) if head_family_id else 0
            if head_family_id and edge_lose > 0:
                await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose, "state_head_income.blackjack": edge_lose}})
            if owner_id:
                owner_take = max(0, bet - edge_lose)
                if owner_take > 0:
                    await db.users.update_one({"id": owner_id}, {"$inc": {"money": owner_take}})
                await db.blackjack_ownership.update_one(
                    {"city": stored_city or city},
                    {"$inc": {"total_earnings": owner_take, "profit": owner_take}},
                )
                _invalidate_ownership_cache(owner_id)
            await _blackjack_settle_and_save_history(
                current_user.get("id") or "", current_user.get("username"), city, bet, "lose", 0, player_hand, dealer_hand, player_total, dealer_total
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
            "user_id": current_user.get("id") or "",
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
    async def casino_blackjack_hit(current_user: dict = Depends(get_current_user_verified)):
        game = await db.blackjack_games.find_one({"user_id": current_user.get("id") or ""})
        if not game:
            raise HTTPException(status_code=400, detail="No active game")
        if _blackjack_game_is_stale(game):
            await _blackjack_auto_finish_game(game, current_user)
            raise HTTPException(status_code=400, detail="Game timed out and was auto-completed.")
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
            user = await db.users.find_one({"id": current_user.get("id") or ""})
            new_balance = (user.get("money", 0) or 0)
            bj_city = game.get("city")
            head_family_id = await get_head_family_id_for_state(bj_city) if bj_city else None
            edge_lose = int(bet * BLACKJACK_HOUSE_EDGE) if head_family_id else 0
            if head_family_id and edge_lose > 0:
                await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose, "state_head_income.blackjack": edge_lose}})
            if owner_id:
                owner_take = max(0, bet - edge_lose)
                if owner_take > 0:
                    await db.users.update_one({"id": owner_id}, {"$inc": {"money": owner_take}})
                await db.blackjack_ownership.update_one(
                    {"city": bj_city},
                    {"$inc": {"total_earnings": owner_take, "profit": owner_take}},
                )
                _invalidate_ownership_cache(owner_id)
            await _blackjack_settle_and_save_history(
                current_user.get("id") or "", current_user.get("username"), game.get("city"), bet, "bust", 0, player_hand, game.get("dealer_hand", []), player_total, _blackjack_hand_total(game.get("dealer_hand", []))
            )
            await db.blackjack_games.delete_one({"user_id": current_user.get("id") or ""})
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
            {"user_id": current_user.get("id") or ""},
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
    async def casino_blackjack_stand(current_user: dict = Depends(get_current_user_verified)):
        game = await db.blackjack_games.find_one_and_delete({"user_id": current_user.get("id") or ""})
        if not game:
            raise HTTPException(status_code=400, detail="No active game")
        if _blackjack_game_is_stale(game):
            await _blackjack_auto_finish_game(game, current_user)
            raise HTTPException(status_code=400, detail="Game timed out and was auto-completed.")
        bj_city = game.get("city")
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
            head_family_id = await get_head_family_id_for_state(bj_city) if bj_city else None
            edge_lose = int(bet * BLACKJACK_HOUSE_EDGE) if head_family_id else 0
            if head_family_id and edge_lose > 0:
                await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose, "state_head_income.blackjack": edge_lose}})
            if owner_id:
                owner_take = max(0, bet - edge_lose)
                if owner_take > 0:
                    await db.users.update_one({"id": owner_id}, {"$inc": {"money": owner_take}})
                await db.blackjack_ownership.update_one(
                    {"city": bj_city},
                    {"$inc": {"total_earnings": owner_take, "profit": owner_take}},
                )
                _invalidate_ownership_cache(owner_id)
        else:
            result = "push"
            payout = bet
        shortfall = 0
        buy_back_offer = None
        ownership_transferred = False
        if payout > 0:
            if owner_id and result in ("win", "dealer_bust"):
                owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1})
                owner_money = int(((owner or {}).get("money") or 0) or 0)
                actual_owner_pay = min(bet, owner_money)
                shortfall = bet - actual_owner_pay
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": bet + actual_owner_pay}})
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_owner_pay, "total_casino_payouts": actual_owner_pay}})
                await db.users.update_one({"id": owner_id, "biggest_casino_payout": {"$lt": actual_owner_pay}}, {"$set": {"biggest_casino_payout": actual_owner_pay}})
                stored_city_bj, doc_bj = await _get_blackjack_ownership_doc(bj_city)
                buy_back_reward = int((doc_bj or {}).get("buy_back_reward") or 0)
                if shortfall > 0:
                    ownership_transferred = True
                    bj_owner_set2 = {"owner_id": current_user.get("id") or "", "owner_username": current_user.get("username")}
                    if get_rank_info(current_user.get("rank_points", 0))[0] < CAPO_RANK_ID:
                        bj_owner_set2["below_capo_acquired_at"] = datetime.now(timezone.utc)
                    await db.blackjack_ownership.update_one({"city": stored_city_bj or bj_city}, {"$set": bj_owner_set2})
                    # Track casino seizure stats
                    await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"casinos_seized": 1}})
                    await db.users.update_one({"id": owner_id}, {"$inc": {"casinos_lost": 1}})
                    if buy_back_reward <= 0:
                        await db.blackjack_ownership.update_one(
                            {"city": stored_city_bj or bj_city},
                            {"$inc": {"total_earnings": -actual_owner_pay, "profit": -actual_owner_pay}},
                        )
                    else:
                        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
                        offer_id = str(uuid.uuid4())
                        await db.blackjack_buy_back_offers.insert_one({
                            "id": offer_id,
                            "city": stored_city_bj or bj_city,
                            "from_owner_id": owner_id,
                            "to_user_id": current_user.get("id") or "",
                            "points_offered": buy_back_reward,
                            "amount_shortfall": shortfall,
                            "owner_paid": actual_owner_pay,
                            "expires_at": expires_at,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        })
                        buy_back_offer = {"offer_id": offer_id, "points_offered": buy_back_reward, "amount_shortfall": shortfall, "owner_paid": actual_owner_pay, "expires_at": expires_at}
                        await db.blackjack_ownership.update_one(
                            {"city": stored_city_bj or bj_city},
                            {"$inc": {"total_earnings": -actual_owner_pay, "profit": -actual_owner_pay}},
                        )
                else:
                    await db.blackjack_ownership.update_one(
                        {"city": stored_city_bj or bj_city},
                        {"$inc": {"total_earnings": -actual_owner_pay, "profit": -actual_owner_pay}},
                    )
                _invalidate_ownership_cache(owner_id)
                payout = bet + actual_owner_pay
            else:
                # No owner or push: state head gets house edge on win (like dice)
                if not owner_id and result in ("win", "dealer_bust"):
                    head_family_id = await get_head_family_id_for_state(bj_city) if bj_city else None
                    if head_family_id:
                        edge = int(bet * BLACKJACK_HOUSE_EDGE)
                        if edge > 0:
                            await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge, "state_head_income.blackjack": edge}})
                        payout = bet * 2 - edge
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": payout}})
        user = await db.users.find_one({"id": current_user.get("id") or ""})
        new_balance = (user.get("money", 0) or 0)
        await _blackjack_settle_and_save_history(
            current_user.get("id") or "", current_user.get("username"), bj_city, bet, result, payout, player_hand, dealer_hand, player_total, dealer_total
        )
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
    async def casino_blackjack_history(current_user: dict = Depends(get_current_user_verified)):
        user = await db.users.find_one({"id": current_user.get("id") or ""}, {"_id": 0, "blackjack_history": 1})
        history = (user.get("blackjack_history") or [])[:BLACKJACK_HISTORY_MAX]
        return {"history": history}
