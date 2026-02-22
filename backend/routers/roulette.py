# Casino Roulette: config, ownership, claim, relinquish, set-max-bet, send-to-user, sell-on-trade, spin
from datetime import datetime, timezone
import re
import random
import time
from typing import Optional, Union
from pydantic import BaseModel
from bson.objectid import ObjectId

from fastapi import Depends, HTTPException

from server import (
    db,
    get_current_user,
    STATES,
    log_gambling,
    get_rank_info,
    CAPO_RANK_ID,
    maybe_auto_relinquish_below_capo,
    _user_owns_any_casino,
    _username_pattern,
)
from routers.dice import DiceSellOnTradeRequest

# ----- Constants -----
ROULETTE_RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
ROULETTE_MAX_BET = 50_000_000
ROULETTE_CLAIM_COST = 500_000_000  # 500M to claim
ROULETTE_HOUSE_EDGE = 0.027  # 2.7% house edge goes to owner
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
        await maybe_auto_relinquish_below_capo(db.roulette_ownership, {"city": norm})
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
    async def casino_roulette_config(current_user: dict = Depends(get_current_user)):
        """Return roulette configuration (max bet)."""
        return {
            "max_bet": ROULETTE_MAX_BET,
            "claim_cost": ROULETTE_CLAIM_COST,
            "house_edge_percent": ROULETTE_HOUSE_EDGE * 100
        }

    @router.get("/casino/roulette/ownership")
    async def casino_roulette_ownership(current_user: dict = Depends(get_current_user)):
        """Get roulette ownership for player's current city."""
        user_id = current_user["id"]
        now_ts = time.time()
        entry = _ownership_cache.get(user_id)
        if entry and (now_ts - entry["ts"]) < _OWNERSHIP_TTL_SEC:
            return entry["data"]
        raw = (current_user.get("current_state") or "").strip()
        if not raw:
            raw = STATES[0] if STATES else "Chicago"
        city = _normalize_city_for_roulette(raw)
        if not city:
            city = STATES[0] if STATES else "Chicago"
        display_city = city or raw or "Chicago"
        stored_city, doc = await _get_roulette_ownership_doc(city)
        if not doc:
            out = {
                "current_city": display_city,
                "owner_id": None,
                "owner_name": None,
                "is_owner": False,
                "is_unclaimed": True,
                "claim_cost": ROULETTE_CLAIM_COST,
                "max_bet": ROULETTE_DEFAULT_MAX_BET
            }
            if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
                _ownership_cache[user_id] = {"ts": now_ts, "data": out}
            return out
        owner_id = doc.get("owner_id")
        owner_name = None
        if owner_id:
            owner = await db.users.find_one({"id": owner_id}, {"username": 1})
            owner_name = owner.get("username") if owner else None
        is_owner = owner_id == current_user["id"]
        max_bet = doc.get("max_bet", ROULETTE_DEFAULT_MAX_BET)
        total_earnings = doc.get("total_earnings", 0)
        profit = int((doc.get("profit") or total_earnings or 0) or 0)
        out = {
            "current_city": display_city,
            "owner_id": owner_id,
            "owner_name": owner_name,
            "is_owner": is_owner,
            "is_unclaimed": owner_id is None,
            "claim_cost": ROULETTE_CLAIM_COST,
            "max_bet": max_bet,
            "total_earnings": total_earnings if is_owner else None,
            "profit": profit if is_owner else None
        }
        if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
            _ownership_cache[user_id] = {"ts": now_ts, "data": out}
        return out

    @router.post("/casino/roulette/claim")
    async def casino_roulette_claim(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user)):
        """Claim ownership of an unclaimed roulette table. Max 1 casino per player. Requires Capo or higher."""
        rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
        if rank_id < CAPO_RANK_ID:
            raise HTTPException(status_code=403, detail="You must be rank Capo or higher to claim a casino. Reach Capo to hold one.")
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_roulette((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        owned = await _user_owns_any_casino(current_user["id"])
        if owned and (owned.get("type") != "roulette" or owned.get("city") != city):
            raise HTTPException(status_code=400, detail="You may only own 1 casino. Relinquish it first (Casino or My Properties).")
        stored_city, doc = await _get_roulette_ownership_doc(city)
        if doc and doc.get("owner_id"):
            raise HTTPException(status_code=400, detail="This table already has an owner")
        user = await db.users.find_one({"id": current_user["id"]})
        if not user or user.get("money", 0) < ROULETTE_CLAIM_COST:
            raise HTTPException(status_code=400, detail=f"You need ${ROULETTE_CLAIM_COST:,} to claim")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -ROULETTE_CLAIM_COST}})
        await db.roulette_ownership.update_one(
            {"city": stored_city or city},
            {"$set": {"owner_id": current_user["id"], "owner_username": current_user["username"], "max_bet": ROULETTE_DEFAULT_MAX_BET, "total_earnings": 0}},
            upsert=True
        )
        return {"message": f"You now own the roulette table in {city}!"}

    @router.post("/casino/roulette/relinquish")
    async def casino_roulette_relinquish(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user)):
        """Give up ownership of a roulette table."""
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_roulette((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_roulette_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        await db.roulette_ownership.update_one({"city": stored_city or city}, {"$set": {"owner_id": None, "owner_username": None}})
        return {"message": "Ownership relinquished."}

    @router.post("/casino/roulette/set-max-bet")
    async def casino_roulette_set_max_bet(request: RouletteSetMaxBetRequest, current_user: dict = Depends(get_current_user)):
        """Set the max bet for your roulette table."""
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_roulette((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_roulette_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        new_max = max(1_000_000, min(request.max_bet, ROULETTE_ABSOLUTE_MAX_BET))
        await db.roulette_ownership.update_one({"city": stored_city or city}, {"$set": {"max_bet": new_max}})
        return {"message": f"Max bet set to ${new_max:,}"}

    @router.post("/casino/roulette/send-to-user")
    async def casino_roulette_send_to_user(request: RouletteSendToUserRequest, current_user: dict = Depends(get_current_user)):
        """Transfer roulette table ownership to another user."""
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_roulette((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_roulette_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        target_username_pattern = _username_pattern(request.target_username.strip())
        target = await db.users.find_one({"username": target_username_pattern}, {"_id": 0, "id": 1, "username": 1, "rank_points": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        send_set = {"owner_id": target["id"], "owner_username": target["username"]}
        if get_rank_info(target.get("rank_points", 0))[0] < CAPO_RANK_ID:
            send_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
        await db.roulette_ownership.update_one({"city": stored_city or city}, {"$set": send_set})
        _invalidate_ownership_cache(target["id"])
        return {"message": "Ownership transferred."}

    @router.post("/casino/roulette/sell-on-trade")
    async def casino_roulette_sell_on_trade(request: DiceSellOnTradeRequest, current_user: dict = Depends(get_current_user)):
        """List your roulette table for sale on Quick Trade (points only)."""
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_roulette((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        if request.points <= 0:
            raise HTTPException(status_code=400, detail="Points must be positive")
        stored_city, doc = await _get_roulette_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this table")
        casino_property = {
            "_id": ObjectId(),
            "type": "casino_rlt",
            "location": city,
            "name": f"Roulette Table ({city})",
            "owner_id": current_user["id"],
            "owner_username": current_user.get("username", "Unknown"),
            "for_sale": True,
            "sale_price": request.points,
            "created_at": datetime.now(timezone.utc)
        }
        await db.properties.insert_one(casino_property)
        return {"message": f"Roulette table listed for {request.points:,} points on Quick Trade"}

    @router.post("/casino/roulette/spin")
    async def casino_roulette_spin(request: RouletteSpinRequest, current_user: dict = Depends(get_current_user)):
        """Spin the roulette wheel with the provided bets."""
        _invalidate_ownership_cache(current_user["id"])
        bets = request.bets or []
        if not bets:
            raise HTTPException(status_code=400, detail="No bets provided")
        city = _normalize_city_for_roulette(current_user.get("current_state", ""))
        stored_city, ownership_doc = await _get_roulette_ownership_doc(city) if city else (city, None)
        owner_id = ownership_doc.get("owner_id") if ownership_doc else None
        max_bet = ownership_doc.get("max_bet", ROULETTE_DEFAULT_MAX_BET) if ownership_doc else ROULETTE_DEFAULT_MAX_BET
        if owner_id and owner_id == current_user["id"]:
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
        user = await db.users.find_one({"id": current_user["id"]})
        if not user or user.get("money", 0) < total_stake:
            raise HTTPException(status_code=400, detail="Not enough money")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -total_stake}})
        result = random.randint(0, 36)
        total_payout = 0
        for bet in validated_bets:
            if _roulette_check_bet_win(bet["type"], bet["selection"], result):
                multiplier = _roulette_get_multiplier(bet["type"])
                total_payout += bet["amount"] * multiplier
        if total_payout > 0:
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": total_payout}})
        owner_cut = 0
        if owner_id:
            owner_cut = int(total_stake * ROULETTE_HOUSE_EDGE)
            if owner_cut > 0:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": owner_cut}})
                await db.roulette_ownership.update_one(
                    {"city": stored_city or city},
                    {"$inc": {"total_earnings": owner_cut}}
                )
        win = total_payout > 0
        await log_gambling(
            current_user["id"],
            current_user.get("username") or "?",
            "roulette",
            {
                "city": stored_city or city,
                "total_stake": total_stake,
                "result": result,
                "total_payout": total_payout,
                "win": win,
                "bets": [{"type": b["type"], "selection": b["selection"], "amount": b["amount"]} for b in validated_bets],
            },
        )
        return {
            "result": result,
            "win": win,
            "total_payout": total_payout,
            "total_stake": total_stake,
            "owner_cut": owner_cut
        }
