# Casino Dice: config, play, claim, relinquish, set-max-bet, set-buy-back, reset-profit, sell-on-trade, buy-back, send-to-user
from datetime import datetime, timezone, timedelta
import re
import random
import math
import uuid
import time
from pydantic import BaseModel
from bson.objectid import ObjectId

from fastapi import Depends, HTTPException

from server import (
    db,
    get_current_user,
    STATES,
    log_gambling,
    get_wealth_rank,
    _user_owns_any_casino,
    _username_pattern,
)

# ----- Constants -----
DICE_SIDES_MIN = 2
DICE_SIDES_MAX = 5000
DICE_HOUSE_EDGE = 0.05  # 5% house edge
DICE_MAX_BET = 5_000_000
DICE_CLAIM_COST_POINTS = 0  # cost in points to claim a dice table (0 = free)

# ----- Models -----
class DicePlayRequest(BaseModel):
    stake: int
    sides: int
    chosen_number: int


class DiceClaimRequest(BaseModel):
    city: str


class DiceSetMaxBetRequest(BaseModel):
    city: str
    max_bet: int


class DiceSetBuyBackRequest(BaseModel):
    city: str
    amount: int


class DiceBuyBackAcceptRequest(BaseModel):
    offer_id: str


class DiceBuyBackRejectRequest(BaseModel):
    offer_id: str


class DiceSendToUserRequest(BaseModel):
    city: str
    target_username: str


class DiceSellOnTradeRequest(BaseModel):
    city: str
    points: int


# ----- Per-user cache for GET /casino/dice/ownership -----
_ownership_cache: dict = {}
_OWNERSHIP_TTL_SEC = 10
_OWNERSHIP_MAX_ENTRIES = 5000


def _invalidate_ownership_cache(user_id: str):
    _ownership_cache.pop(user_id, None)


def _normalize_city_for_dice(city_raw: str) -> str:
    """Return city normalized to one of STATES (case-insensitive match), or first state if no match."""
    if not (city_raw or "").strip():
        return STATES[0] if STATES else ""
    c = (city_raw or "").strip()
    for s in (STATES or []):
        if s and c.lower() == s.lower():
            return s
    return STATES[0] if STATES else c


async def _get_dice_ownership_doc(city: str):
    """Get dice ownership doc for a city (case-insensitive match). Returns (normalized_city, doc)."""
    if not city:
        return None, None
    pattern = re.compile(f"^{re.escape(city)}$", re.IGNORECASE)
    doc = await db.dice_ownership.find_one({"city": pattern}, {"_id": 0})
    if doc:
        return doc.get("city") or city, doc
    norm = _normalize_city_for_dice(city)
    doc = await db.dice_ownership.find_one({"city": norm}, {"_id": 0})
    if doc:
        return norm, doc
    return norm, None


def register(router):
    @router.get("/casino/dice/config")
    async def casino_dice_config(current_user: dict = Depends(get_current_user)):
        """Dice game config: sides range and default max bet."""
        return {
            "sides_min": DICE_SIDES_MIN,
            "sides_max": DICE_SIDES_MAX,
            "max_bet": DICE_MAX_BET,
        }

    @router.get("/casino/dice/ownership")
    async def casino_dice_ownership(current_user: dict = Depends(get_current_user)):
        """Current city's dice ownership and effective max_bet (owner's or default).
        Expired buy-back offers are auto-REJECTED (winner keeps ownership).
        """
        user_id = current_user["id"]
        now_ts = time.time()
        entry = _ownership_cache.get(user_id)
        if entry and (now_ts - entry["ts"]) < _OWNERSHIP_TTL_SEC:
            return entry["data"]
        now = datetime.now(timezone.utc)
        await db.dice_buy_back_offers.delete_many({
            "to_user_id": user_id,
            "expires_at": {"$lt": now.isoformat()},
        })
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city_for_dice(raw) if raw else (STATES[0] if STATES else "")
        if not city:
            out = {"current_city": None, "owner": None, "is_owner": False, "max_bet": DICE_MAX_BET, "buy_back_reward": None, "buy_back_offer": None}
            if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
                _ownership_cache[user_id] = {"ts": now_ts, "data": out}
            return out
        _, doc = await _get_dice_ownership_doc(city)
        if not doc:
            out = {"current_city": city, "owner": None, "is_owner": False, "max_bet": DICE_MAX_BET, "buy_back_reward": None, "buy_back_offer": None}
            if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
                _ownership_cache[user_id] = {"ts": now_ts, "data": out}
            return out
        owner_id = doc.get("owner_id")
        max_bet = doc.get("max_bet")
        if max_bet is None:
            max_bet = DICE_MAX_BET
        buy_back_reward = doc.get("buy_back_reward")
        is_owner = current_user["id"] == owner_id
        owner = None
        if owner_id:
            u = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1, "money": 1})
            if u:
                _, wealth_rank_name = get_wealth_rank(int((u.get("money") or 0) or 0))
                owner = {"user_id": owner_id, "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name}
        profit = int((doc.get("profit") or 0) or 0)
        active_offer = await db.dice_buy_back_offers.find_one(
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
            "current_city": city,
            "owner": owner,
            "is_owner": is_owner,
            "max_bet": max_bet,
            "buy_back_reward": buy_back_reward,
            "profit": profit if is_owner else None,
            "buy_back_offer": buy_back_offer,
        }
        if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
            _ownership_cache[user_id] = {"ts": now_ts, "data": out}
        return out

    @router.post("/casino/dice/play")
    async def casino_dice_play(request: DicePlayRequest, current_user: dict = Depends(get_current_user)):
        """Place a dice bet. Win if roll == chosen_number; payout = stake * sides * (1 - house_edge)."""
        _invalidate_ownership_cache(current_user["id"])
        raw_city = (current_user.get("current_state") or STATES[0] if STATES else "").strip()
        city = _normalize_city_for_dice(raw_city) if raw_city else (STATES[0] if STATES else "")
        if not city:
            raise HTTPException(status_code=400, detail="No current city")
        stake = max(0, int(request.stake))
        sides = max(DICE_SIDES_MIN, min(DICE_SIDES_MAX, int(request.sides)))
        actual_sides = math.ceil(sides * 1.05)  # 5% extra sides per game rules (e.g. 1000 -> 1050)
        chosen_raw = int(request.chosen_number)
        if chosen_raw < 1 or chosen_raw > actual_sides:
            raise HTTPException(status_code=400, detail=f"Chosen number must be between 1 and {actual_sides} (actual sides)")
        chosen = chosen_raw
        if stake <= 0:
            raise HTTPException(status_code=400, detail="Stake must be positive")
        stored_city, doc = await _get_dice_ownership_doc(city)
        db_city = stored_city or city
        max_bet = DICE_MAX_BET
        owner_id = None
        if doc:
            max_bet = doc.get("max_bet") if doc.get("max_bet") is not None else DICE_MAX_BET
            owner_id = doc.get("owner_id")
        if owner_id and owner_id == current_user["id"]:
            raise HTTPException(status_code=400, detail="You cannot play at your own table")
        if stake > max_bet:
            raise HTTPException(status_code=400, detail=f"Stake exceeds max bet ({max_bet})")
        player_money = int((current_user.get("money") or 0) or 0)
        if player_money < stake:
            raise HTTPException(status_code=400, detail="Not enough cash")
        payout_full = int(stake * sides * (1 - DICE_HOUSE_EDGE))
        roll = random.randint(1, actual_sides)
        win = roll == chosen
        if not win:
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -stake}})
            if owner_id:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": stake}})
                await db.dice_ownership.update_one({"city": db_city}, {"$inc": {"profit": stake}})
            await log_gambling(current_user["id"], current_user.get("username") or "?", "dice", {"city": city, "stake": stake, "sides": actual_sides, "chosen": chosen, "roll": roll, "win": False, "payout": 0})
            return {"roll": roll, "win": False, "payout": 0, "actual_payout": 0, "owner_paid": 0, "shortfall": 0, "ownership_transferred": False, "buy_back_offer": None}
        if not owner_id:
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": payout_full - stake}})
            await log_gambling(current_user["id"], current_user.get("username") or "?", "dice", {"city": city, "stake": stake, "sides": actual_sides, "chosen": chosen, "roll": roll, "win": True, "payout": payout_full})
            return {"roll": roll, "win": True, "payout": payout_full, "actual_payout": payout_full, "owner_paid": 0, "shortfall": 0, "ownership_transferred": False, "buy_back_offer": None}
        owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1, "username": 1})
        owner_money = int((owner.get("money") or 0) or 0)
        owner_username = owner.get("username") if owner else None
        actual_payout = min(payout_full, owner_money)
        shortfall = payout_full - actual_payout
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": actual_payout - stake}})
        await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_payout}})
        ownership_transferred = False
        buy_back_offer = None
        points_offered = int((doc or {}).get("buy_back_reward") or 0)
        if shortfall > 0:
            if points_offered <= 0:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": stake}})
                await db.dice_ownership.update_one({"city": db_city}, {"$inc": {"profit": stake - actual_payout}})
            else:
                ownership_transferred = True
                await db.dice_ownership.update_one({"city": db_city}, {"$set": {"owner_id": current_user["id"], "owner_username": current_user["username"]}})
                expires_at = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
                offer_id = str(uuid.uuid4())
                buy_back_doc = {
                    "id": offer_id,
                    "city": db_city,
                    "from_owner_id": owner_id,
                    "from_owner_username": owner_username,
                    "to_user_id": current_user["id"],
                    "to_username": current_user.get("username"),
                    "points_offered": points_offered,
                    "amount_shortfall": shortfall,
                    "owner_paid": actual_payout,
                    "expires_at": expires_at,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                await db.dice_buy_back_offers.insert_one(buy_back_doc)
                buy_back_offer = {"offer_id": offer_id, "points_offered": points_offered, "amount_shortfall": shortfall, "owner_paid": actual_payout, "expires_at": expires_at}
        else:
            await db.users.update_one({"id": owner_id}, {"$inc": {"money": stake}})
            await db.dice_ownership.update_one({"city": db_city}, {"$inc": {"profit": stake - actual_payout}})
        await log_gambling(current_user["id"], current_user.get("username") or "?", "dice", {"city": city, "stake": stake, "sides": actual_sides, "chosen": chosen, "roll": roll, "win": True, "payout": payout_full, "actual_payout": actual_payout, "shortfall": shortfall})
        return {"roll": roll, "win": True, "payout": payout_full, "actual_payout": actual_payout, "owner_paid": actual_payout, "shortfall": shortfall, "ownership_transferred": ownership_transferred, "buy_back_offer": buy_back_offer}

    @router.post("/casino/dice/claim")
    async def casino_dice_claim(request: DiceClaimRequest, current_user: dict = Depends(get_current_user)):
        """Claim ownership of the dice table in a city (cost in points). Max 1 casino per player."""
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_dice((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        owned = await _user_owns_any_casino(current_user["id"])
        if owned and (owned.get("type") != "dice" or owned.get("city") != city):
            raise HTTPException(status_code=400, detail="You may only own 1 casino. Relinquish it first (Casino or My Properties).")
        user_city = _normalize_city_for_dice((current_user.get("current_state") or "").strip())
        if user_city != city:
            raise HTTPException(status_code=400, detail="You must be in this city to claim the dice table")
        stored_city, existing = await _get_dice_ownership_doc(city)
        if existing and existing.get("owner_id"):
            raise HTTPException(status_code=400, detail="This table is already owned")
        points = int((current_user.get("points") or 0) or 0)
        if points < DICE_CLAIM_COST_POINTS:
            raise HTTPException(status_code=400, detail="Not enough points to claim")
        await db.dice_ownership.update_one(
            {"city": city},
            {"$set": {"owner_id": current_user["id"], "owner_username": current_user["username"], "max_bet": DICE_MAX_BET, "buy_back_reward": 0, "profit": 0}},
            upsert=True,
        )
        if DICE_CLAIM_COST_POINTS > 0:
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": -DICE_CLAIM_COST_POINTS}})
        return {"message": "You now own the dice table here."}

    @router.post("/casino/dice/relinquish")
    async def casino_dice_relinquish(request: DiceClaimRequest, current_user: dict = Depends(get_current_user)):
        """Relinquish ownership of the dice table in a city."""
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_dice((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_dice_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        await db.dice_ownership.update_one({"city": stored_city or city}, {"$set": {"owner_id": None, "owner_username": None}})
        return {"message": "You have relinquished the dice table."}

    @router.post("/casino/dice/set-max-bet")
    async def casino_dice_set_max_bet(request: DiceSetMaxBetRequest, current_user: dict = Depends(get_current_user)):
        """Set max bet for your dice table (owner only)."""
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_dice((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_dice_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        max_bet = max(0, int(request.max_bet))
        await db.dice_ownership.update_one({"city": stored_city or city}, {"$set": {"max_bet": max_bet}})
        return {"message": "Max bet updated."}

    @router.post("/casino/dice/set-buy-back-reward")
    async def casino_dice_set_buy_back_reward(request: DiceSetBuyBackRequest, current_user: dict = Depends(get_current_user)):
        """Set buy-back reward (points) offered when you cannot pay a win (owner only)."""
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_dice((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_dice_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        amount = max(0, int(request.amount))
        await db.dice_ownership.update_one({"city": stored_city or city}, {"$set": {"buy_back_reward": amount}})
        return {"message": "Buy-back reward updated."}

    @router.post("/casino/dice/reset-profit")
    async def casino_dice_reset_profit(request: DiceClaimRequest, current_user: dict = Depends(get_current_user)):
        """Reset profit/loss for your dice table to zero (owner only)."""
        city = _normalize_city_for_dice((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_dice_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        await db.dice_ownership.update_one({"city": stored_city or city}, {"$set": {"profit": 0}})
        return {"message": "Profit reset to zero."}

    @router.post("/casino/dice/sell-on-trade")
    async def casino_dice_sell_on_trade(request: DiceSellOnTradeRequest, current_user: dict = Depends(get_current_user)):
        """List your dice table for sale on Quick Trade (points only)."""
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_dice((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        if request.points <= 0:
            raise HTTPException(status_code=400, detail="Points must be positive")
        stored_city, doc = await _get_dice_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        casino_property = {
            "_id": ObjectId(),
            "type": "casino_dice",
            "location": city,
            "name": f"Dice Table ({city})",
            "owner_id": current_user["id"],
            "owner_username": current_user.get("username", "Unknown"),
            "for_sale": True,
            "sale_price": request.points,
            "created_at": datetime.now(timezone.utc)
        }
        await db.properties.insert_one(casino_property)
        return {"message": f"Dice table listed for {request.points:,} points on Quick Trade"}

    @router.post("/casino/dice/buy-back/accept")
    async def casino_dice_buy_back_accept(request: DiceBuyBackAcceptRequest, current_user: dict = Depends(get_current_user)):
        """Accept a buy-back offer: receive points and transfer ownership back to previous owner."""
        offer = await db.dice_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0})
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
        await db.dice_ownership.update_one({"city": city}, {"$set": {"owner_id": from_owner_id, "owner_username": from_user.get("username")}})
        await db.dice_buy_back_offers.delete_one({"id": request.offer_id})
        _invalidate_ownership_cache(current_user["id"])
        _invalidate_ownership_cache(from_owner_id)
        return {"message": "Accepted. You received the points and the table was returned to the previous owner."}

    @router.post("/casino/dice/buy-back/reject")
    async def casino_dice_buy_back_reject(request: DiceBuyBackRejectRequest, current_user: dict = Depends(get_current_user)):
        """Reject a buy-back offer: keep ownership."""
        offer = await db.dice_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0, "to_user_id": 1})
        if not offer or offer.get("to_user_id") != current_user["id"]:
            raise HTTPException(status_code=404, detail="Offer not found")
        await db.dice_buy_back_offers.delete_one({"id": request.offer_id})
        _invalidate_ownership_cache(current_user["id"])
        return {"message": "Rejected. You keep the casino."}

    @router.post("/casino/dice/send-to-user")
    async def casino_dice_send_to_user(request: DiceSendToUserRequest, current_user: dict = Depends(get_current_user)):
        """Transfer dice table ownership to another user (owner only)."""
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_dice((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_dice_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        target_username_pattern = _username_pattern(request.target_username.strip())
        target = await db.users.find_one({"username": target_username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.dice_ownership.update_one({"city": stored_city or city}, {"$set": {"owner_id": target["id"], "owner_username": target["username"]}})
        _invalidate_ownership_cache(target["id"])
        return {"message": "Ownership transferred."}
