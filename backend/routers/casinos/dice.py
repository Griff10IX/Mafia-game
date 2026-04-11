# Casino Dice: config, play, claim, relinquish, set-max-bet, set-buy-back, reset-profit, sell-on-trade, buy-back, send-to-user
from datetime import datetime, timezone, timedelta
import math
import re
import secrets
_rng = secrets.SystemRandom()

import uuid
import time
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
    get_wealth_rank,
    get_wealth_rank_range,
    get_rank_info,
    user_prestige_rank_mult,
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
    notify_casino_seizure,
    send_notification,
)
from utils.quicktrade_casino_cleanup import cancel_quicktrade_casino_listings_by_locations

# ----- Constants -----
DICE_SIDES_MIN = 2
# Max nominal sides (payout multiplier base); player cannot enter more than this.
DICE_SIDES_MAX = 2500
DICE_HOUSE_EDGE = 0.0005  # 0.05% house edge
DICE_MAX_BET = 5_000_000          # default max bet for new tables
DICE_ABSOLUTE_MAX_BET = 500_000_000  # hard ceiling owners can set up to
DICE_BUY_BACK_EXPIRY_MINUTES = 10
# Dice claim costs: utils.claim_costs.DEFAULT_CLAIM_COSTS (dice_cash, dice_points); override via game_settings key claim_costs
DICE_SIDES_BONUS_MULT = 1.05  # roll uses ceil(nominal * 1.05) dice faces, capped below
# Max dice faces / max number you can pick: ⌈DICE_SIDES_MAX × 1.05⌉ (e.g. 2500 → 2625).
DICE_ROLL_FACES_CAP = math.ceil(DICE_SIDES_MAX * DICE_SIDES_BONUS_MULT)


def _actual_dice_sides(nominal: int) -> int:
    """Roll range 1..N where N = min(DICE_ROLL_FACES_CAP, ceil(nominal * 1.05)). Player may pick any integer in that range."""
    n = int(nominal)
    if n < DICE_SIDES_MIN:
        return DICE_SIDES_MIN
    return min(DICE_ROLL_FACES_CAP, math.ceil(n * DICE_SIDES_BONUS_MULT))


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
    norm = _normalize_city_for_dice(city)
    await maybe_auto_relinquish_below_capo(db.dice_ownership, {"city": norm}, reset_casino_max_bet=True)
    pattern = re.compile(f"^{re.escape(city)}$", re.IGNORECASE)
    doc = await db.dice_ownership.find_one({"city": pattern}, {"_id": 0})
    if doc:
        return doc.get("city") or city, doc
    doc = await db.dice_ownership.find_one({"city": norm}, {"_id": 0})
    if doc:
        return norm, doc
    return norm, None


def register(router):
    @router.get("/casino/dice/config")
    async def casino_dice_config(current_user: dict = Depends(get_current_user_verified)):
        """Dice game config: sides range, default max bet, house edge (state head tax)."""
        cc = await load_claim_costs(db)
        return {
            "sides_min": DICE_SIDES_MIN,
            "sides_max": DICE_SIDES_MAX,
            "roll_faces_max": DICE_ROLL_FACES_CAP,
            "max_bet": DICE_MAX_BET,
            "house_edge": DICE_HOUSE_EDGE,
            "sides_bonus_mult": DICE_SIDES_BONUS_MULT,
            "claim_cost": cc["dice_cash"],
            "claim_cost_points": cc["dice_points"],
        }

    @router.get("/casino/dice/ownership")
    async def casino_dice_ownership(current_user: dict = Depends(get_current_user_verified)):
        """Current city's dice ownership and effective max_bet (owner's or default).
        Expired buy-back offers are auto-REJECTED (winner keeps ownership).
        """
        user_id = current_user.get("id") or ""
        now_ts = time.time()
        entry = _ownership_cache.get(user_id)
        if entry and (now_ts - entry["ts"]) < _OWNERSHIP_TTL_SEC:
            return entry["data"]
        now = datetime.now(timezone.utc)
        await cleanup_expired_buyback_offers_for_user(db, "dice_buy_back_offers", user_id, now.isoformat())
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
        is_owner = (current_user.get("id") or "") == owner_id
        owner = None
        if owner_id:
            u = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1, "money": 1})
            if u:
                _, wealth_rank_name, wealth_rank_color = get_wealth_rank(int((u.get("money") or 0) or 0))
                wealth_rank_range = get_wealth_rank_range(int((u.get("money") or 0) or 0))
                # Public casino ownership view: expose owner username + wealth rank only, never raw user_id
                owner = {
                    "username": u.get("username") or "?",
                    "wealth_rank_name": wealth_rank_name,
                    "wealth_rank_color": wealth_rank_color,
                    "wealth_rank_range": wealth_rank_range,
                }
        profit = _ownership_display_profit(doc)
        active_offer = await db.dice_buy_back_offers.find_one(
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
    async def casino_dice_play(request: DicePlayRequest, current_user: dict = Depends(get_current_user_verified)):
        """Place a dice bet. Win if roll == chosen_number; roll is 1..actual_sides (ceil(sides*1.05), capped). chosen_number may be any value in that same range. Payout = stake * sides * (1 - house_edge)."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        raw_city = (current_user.get("current_state") or STATES[0] if STATES else "").strip()
        city = _normalize_city_for_dice(raw_city) if raw_city else (STATES[0] if STATES else "")
        if not city:
            raise HTTPException(status_code=400, detail="No current city")
        stake = max(0, int(request.stake))
        sides = max(DICE_SIDES_MIN, min(DICE_SIDES_MAX, int(request.sides)))
        actual_sides = _actual_dice_sides(sides)
        chosen_raw = int(request.chosen_number)
        if chosen_raw < 1 or chosen_raw > actual_sides:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Prediction must be between 1 and {actual_sides} "
                    f"(⌈{sides}×{DICE_SIDES_BONUS_MULT}⌉ dice faces, cap {DICE_ROLL_FACES_CAP}; nominal sides max {DICE_SIDES_MAX})"
                ),
            )
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
        if owner_id and owner_id == current_user.get("id"):
            raise HTTPException(status_code=400, detail="You cannot play at your own table")
        if stake > max_bet:
            raise HTTPException(status_code=400, detail=f"Stake exceeds max bet ({max_bet})")
        debit_result = await db.users.find_one_and_update(
            {"id": current_user.get("id") or "", "money": {"$gte": stake}},
            {"$inc": {"money": -stake}},
            return_document=False,
        )
        if not debit_result:
            raise HTTPException(status_code=400, detail="Not enough cash")
        player_money = int((debit_result.get("money") or 0) or 0)
        payout_full = int(stake * sides * (1 - DICE_HOUSE_EDGE))
        roll = _rng.randint(1, actual_sides)
        win = roll == chosen
        head_family_id = await get_head_family_id_for_state(db_city)
        if not win:
            edge_lose = int(stake * DICE_HOUSE_EDGE)
            if head_family_id and edge_lose > 0:
                await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose, "state_head_income.dice": edge_lose}})
            if owner_id:
                owner_take = max(0, stake - (edge_lose if head_family_id else 0))
                if owner_take > 0:
                    await db.users.update_one({"id": owner_id}, {"$inc": {"money": owner_take}})
                await db.dice_ownership.update_one({"city": db_city}, {"$inc": {"profit": owner_take}})
                _invalidate_ownership_cache(owner_id)
            await log_gambling(current_user.get("id") or "", current_user.get("username") or "?", "dice", {"city": city, "stake": stake, "sides": sides, "actual_sides": actual_sides, "chosen": chosen, "roll": roll, "win": False, "payout": 0})
            return {"roll": roll, "win": False, "payout": 0, "actual_payout": 0, "owner_paid": 0, "shortfall": 0, "ownership_transferred": False, "buy_back_offer": None, "nominal_sides": sides, "actual_sides": actual_sides}
        if not owner_id:
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": payout_full}})
            await log_gambling(current_user.get("id") or "", current_user.get("username") or "?", "dice", {"city": city, "stake": stake, "sides": sides, "actual_sides": actual_sides, "chosen": chosen, "roll": roll, "win": True, "payout": payout_full})
            return {"roll": roll, "win": True, "payout": payout_full, "actual_payout": payout_full, "owner_paid": 0, "shortfall": 0, "ownership_transferred": False, "buy_back_offer": None, "nominal_sides": sides, "actual_sides": actual_sides}
        owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1, "username": 1})
        owner_money = int(((owner or {}).get("money") or 0) or 0)
        owner_username = (owner or {}).get("username")
        actual_payout = min(payout_full, owner_money)
        shortfall = payout_full - actual_payout
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": actual_payout}})
        await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_payout, "total_casino_payouts": actual_payout}})
        # Track biggest payout for owner
        await bump_user_biggest_casino_payout(owner_id, actual_payout)
        ownership_transferred = False
        buy_back_offer = None
        points_offered = int((doc or {}).get("buy_back_reward") or 0)
        edge = int(stake * sides * DICE_HOUSE_EDGE)
        edge_lose = int(stake * DICE_HOUSE_EDGE) if head_family_id else 0
        if shortfall > 0:
            ownership_transferred = True
            dice_owner_set = {"owner_id": current_user.get("id") or "", "owner_username": current_user.get("username") or ""}
            if get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))[0] < CAPO_RANK_ID:
                dice_owner_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
            await db.dice_ownership.update_one({"city": db_city}, {"$set": dice_owner_set})
            await cancel_quicktrade_casino_listings_by_locations("casino_dice", db_city, city)
            # Track casino seizure stats
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"casinos_seized": 1}})
            await db.users.update_one({"id": owner_id}, {"$inc": {"casinos_lost": 1}})
            await notify_casino_seizure(
                former_owner_id=owner_id,
                former_owner_username=owner_username,
                winner_user_id=current_user.get("id") or "",
                winner_username=current_user.get("username") or "?",
                venue_label="dice table",
                location_label=city,
                full_payout_to_winner=payout_full,
                actual_payout_to_winner=actual_payout,
                shortfall=shortfall,
                buy_back_points=points_offered,
            )
            if points_offered <= 0:
                if head_family_id:
                    if edge_lose > 0:
                        await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose, "state_head_income.dice": edge_lose}})
                else:
                    await db.users.update_one({"id": owner_id}, {"$inc": {"money": stake}})
                    await db.dice_ownership.update_one({"city": db_city}, {"$inc": {"profit": stake - actual_payout}})
                    _invalidate_ownership_cache(owner_id)
            else:
                expires_at = (datetime.now(timezone.utc) + timedelta(minutes=DICE_BUY_BACK_EXPIRY_MINUTES)).isoformat()
                offer_id = str(uuid.uuid4())
                buy_back_doc = {
                    "id": offer_id,
                    "city": db_city,
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
                await db.dice_buy_back_offers.insert_one(buy_back_doc)
                buy_back_offer = {"offer_id": offer_id, "points_offered": points_offered, "amount_shortfall": shortfall, "owner_paid": actual_payout, "expires_at": expires_at}
            await db.dice_ownership.update_one(
                {"city": db_city},
                {"$inc": {"profit": (stake - actual_payout) - (edge_lose if head_family_id else 0)}},
            )
            _invalidate_ownership_cache(owner_id)
        else:
            if head_family_id:
                await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge, "state_head_income.dice": edge}})
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": stake - edge}})
            else:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": stake}})
            await db.dice_ownership.update_one(
                {"city": db_city},
                {"$inc": {"profit": (stake - actual_payout) - (edge if head_family_id else 0)}},
            )
            _invalidate_ownership_cache(owner_id)
        dice_details = {
            "city": city,
            "stake": stake,
            "sides": sides,
            "actual_sides": actual_sides,
            "chosen": chosen,
            "roll": roll,
            "win": True,
            "payout": payout_full,
            "actual_payout": actual_payout,
            "shortfall": shortfall,
            "ownership_transferred": ownership_transferred,
        }
        if ownership_transferred:
            if buy_back_offer and buy_back_offer.get("offer_id"):
                dice_details["buy_back_offer_id"] = buy_back_offer["offer_id"]
                dice_details["buy_back_points_offered"] = points_offered
                dice_details["buy_back_outcome"] = "pending"
            else:
                dice_details["buy_back_points_offered"] = 0
                dice_details["buy_back_outcome"] = "not_offered"
        await log_gambling(current_user.get("id") or "", current_user.get("username") or "?", "dice", dice_details)
        return {"roll": roll, "win": True, "payout": payout_full, "actual_payout": actual_payout, "owner_paid": actual_payout, "shortfall": shortfall, "ownership_transferred": ownership_transferred, "buy_back_offer": buy_back_offer, "nominal_sides": sides, "actual_sides": actual_sides}

    @router.post("/casino/dice/claim")
    async def casino_dice_claim(request: DiceClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        """Claim ownership of the dice table in a city (cost in points). Max 1 casino per player. Requires Capo or higher (or prestiged)."""
        rank_id, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
        prestige_level = int(current_user.get("prestige_level") or 0)
        if rank_id < CAPO_RANK_ID and prestige_level < 1:
            raise HTTPException(status_code=403, detail="You must be rank Capo or higher to claim a casino. Reach Capo to hold one.")
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_dice((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        owned = await _user_owns_any_casino(current_user.get("id") or "")
        if owned and (owned.get("type") != "dice" or owned.get("city") != city):
            raise HTTPException(status_code=400, detail="You may only own 1 casino. Relinquish it first (Casino or My Properties).")
        user_city = _normalize_city_for_dice((current_user.get("current_state") or "").strip())
        if user_city != city:
            raise HTTPException(status_code=400, detail="You must be in this city to claim the dice table")
        stored_city, existing = await _get_dice_ownership_doc(city)
        cc = await load_claim_costs(db)
        cash_cost = cc["dice_cash"]
        pts_cost = cc["dice_points"]
        db_city = stored_city or city
        debit_filter = {"id": current_user.get("id") or "", "money": {"$gte": cash_cost}}
        debit_inc = {"money": -cash_cost}
        if pts_cost > 0:
            debit_filter["points"] = {"$gte": pts_cost}
            debit_inc["points"] = -pts_cost
        debit_result = await db.users.find_one_and_update(debit_filter, {"$inc": debit_inc})
        if not debit_result:
            raise HTTPException(status_code=400, detail=f"You need ${cash_cost:,} cash" + (f" and {pts_cost:,} points" if pts_cost > 0 else "") + " to claim")
        res = await db.dice_ownership.update_one(
            {"city": db_city, "owner_id": None},
            {
                "$set": {
                    "city": db_city,
                    "owner_id": current_user.get("id") or "",
                    "owner_username": current_user.get("username") or "",
                    "buy_back_reward": 0,
                },
                "$setOnInsert": {"max_bet": DICE_MAX_BET},
            },
            upsert=True,
        )
        if res.matched_count == 0 and res.upserted_id is None:
            refund_inc = {"money": cash_cost}
            if pts_cost > 0:
                refund_inc["points"] = pts_cost
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": refund_inc})
            raise HTTPException(status_code=400, detail="This table is already owned")
        if pts_cost > 0:
            await log_points_event(db, user_id=current_user.get("id") or "", points=-pts_cost, event_type="casino_dice", event_ref=f"claim:{city}", meta={"action": "claim_cost", "city": city})
        await maybe_revoke_civilian_protection(db, current_user.get("id") or "", "casino_claim")
        await cancel_quicktrade_casino_listings_by_locations("casino_dice", db_city, city)
        return {"message": f"You now own the dice table in {city}!"}

    @router.post("/casino/dice/relinquish")
    async def casino_dice_relinquish(request: DiceClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        """Relinquish ownership of the dice table in a city."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_dice((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_dice_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        await db.dice_ownership.update_one(
            {"city": stored_city or city},
            {"$set": {"owner_id": None, "owner_username": None, "max_bet": CASINO_MIN_OWNER_MAX_BET}},
        )
        # Remove pending buy-back offers for this holder/city after relinquish.
        await db.dice_buy_back_offers.delete_many(
            {"city": stored_city or city, "to_user_id": current_user.get("id") or ""}
        )
        await cancel_quicktrade_casino_listings_by_locations("casino_dice", stored_city or city, city)
        return {"message": "You have relinquished the dice table."}

    @router.post("/casino/dice/set-max-bet")
    async def casino_dice_set_max_bet(request: DiceSetMaxBetRequest, current_user: dict = Depends(get_current_user_verified)):
        """Set max bet for your dice table (owner only)."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_dice((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_dice_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        global_cap, _ = await get_casino_caps()
        max_bet = max(50_000, min(int(request.max_bet), global_cap))
        await db.dice_ownership.update_one({"city": stored_city or city}, {"$set": {"max_bet": max_bet}})
        return {"message": f"Max bet set to ${max_bet:,}"}

    @router.post("/casino/dice/set-buy-back-reward")
    async def casino_dice_set_buy_back_reward(request: DiceSetBuyBackRequest, current_user: dict = Depends(get_current_user_verified)):
        """Set buy-back reward (points) offered when you cannot pay a win (owner only)."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_dice((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_dice_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        _, buyback_cap = await get_casino_caps()
        amount = max(0, min(int(request.amount), buyback_cap))
        await assert_casino_buy_back_within_points_balance(current_user["id"], amount)
        await db.dice_ownership.update_one({"city": stored_city or city}, {"$set": {"buy_back_reward": amount}})
        return {"message": "Buy-back reward updated."}

    @router.post("/casino/dice/reset-profit")
    async def casino_dice_reset_profit(request: DiceClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        """Reset profit/loss for your dice table to zero (owner only)."""
        city = _normalize_city_for_dice((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_dice_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        await db.dice_ownership.update_one({"city": stored_city or city}, {"$set": {"profit": 0}})
        return {"message": "Profit reset to zero."}

    @router.post("/casino/dice/sell-on-trade")
    async def casino_dice_sell_on_trade(request: DiceSellOnTradeRequest, current_user: dict = Depends(get_current_user_verified)):
        """List your dice table for sale on Quick Trade (points only)."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_dice((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        if request.points <= 0:
            raise HTTPException(status_code=400, detail="Points must be positive")
        stored_city, doc = await _get_dice_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        listing_id = ObjectId()
        casino_property = {
            "_id": listing_id,
            "id": str(listing_id),
            "type": "casino_dice",
            "location": city,
            "name": f"Dice Table ({city})",
            "owner_id": current_user.get("id") or "",
            "owner_username": current_user.get("username", "Unknown"),
            "for_sale": True,
            "sale_price": request.points,
            "created_at": datetime.now(timezone.utc)
        }
        await db.properties.insert_one(casino_property)
        return {"message": f"Dice table listed for {request.points:,} points on Quick Trade"}

    @router.post("/casino/dice/buy-back/accept")
    async def casino_dice_buy_back_accept(request: DiceBuyBackAcceptRequest, current_user: dict = Depends(get_current_user_verified)):
        """Accept a buy-back offer: receive points and transfer ownership back to previous owner."""
        offer = await db.dice_buy_back_offers.find_one_and_delete({"id": request.offer_id}, projection={"_id": 0})
        if not offer:
            raise HTTPException(status_code=404, detail="Offer not found or already claimed")
        if offer.get("to_user_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="Not your offer")
        expires = offer.get("expires_at")
        if expires:
            try:
                if datetime.fromisoformat(expires.replace("Z", "+00:00")) < datetime.now(timezone.utc):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Offer expired ({DICE_BUY_BACK_EXPIRY_MINUTES} minute window).",
                    )
            except HTTPException:
                raise
            except ValueError:
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
            raise HTTPException(status_code=400, detail="Previous owner no longer has enough points for buy-back.")
        await log_points_event(db, user_id=from_owner_id, points=-points_offered, event_type="casino_dice", event_ref=f"buyback:{request.offer_id}", meta={"action": "buyback_deduct", "city": city, "offer_id": request.offer_id})
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"points": points_offered}})
        await log_points_event(db, user_id=current_user.get("id") or "", points=points_offered, event_type="casino_dice", event_ref=f"buyback:{request.offer_id}", meta={"action": "buyback_credit", "city": city, "offer_id": request.offer_id})
        # Reset max_bet to 0 when ownership returns - owner must set it again
        await db.dice_ownership.update_one({"city": city}, {"$set": {"owner_id": from_owner_id, "owner_username": from_user.get("username"), "max_bet": 0}})
        cnorm = _normalize_city_for_dice(str(city or "").strip()) if city else ""
        await cancel_quicktrade_casino_listings_by_locations("casino_dice", city, cnorm or None)
        _invalidate_ownership_cache(current_user.get("id") or "")
        _invalidate_ownership_cache(from_owner_id)
        await resolve_gambling_log_buy_back(request.offer_id, "accepted", points_offered)
        return {"message": "Accepted. You received the points and the table was returned to the previous owner."}

    @router.post("/casino/dice/buy-back/reject")
    async def casino_dice_buy_back_reject(request: DiceBuyBackRejectRequest, current_user: dict = Depends(get_current_user_verified)):
        """Reject a buy-back offer: keep ownership."""
        offer = await db.dice_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0, "to_user_id": 1})
        if not offer or offer.get("to_user_id") != current_user.get("id") or "":
            raise HTTPException(status_code=404, detail="Offer not found")
        await db.dice_buy_back_offers.delete_one({"id": request.offer_id})
        _invalidate_ownership_cache(current_user.get("id") or "")
        await resolve_gambling_log_buy_back(request.offer_id, "rejected", 0)
        await maybe_revoke_civilian_protection(db, current_user.get("id") or "", "casino_buyback_reject")
        return {"message": "Rejected. You keep the casino."}

    @router.post("/casino/dice/send-to-user")
    async def casino_dice_send_to_user(request: DiceSendToUserRequest, current_user: dict = Depends(get_current_user_verified)):
        """Transfer dice table ownership to another user (owner only)."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_dice((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_dice_ownership_doc(city)
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
        if get_rank_info(target.get("rank_points", 0), user_prestige_rank_mult(target))[0] < CAPO_RANK_ID:
            send_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
        await db.dice_ownership.update_one({"city": stored_city or city}, {"$set": send_set})
        await cancel_quicktrade_casino_listings_by_locations("casino_dice", stored_city or city, city)
        _invalidate_ownership_cache(target.get("id") or "")
        await maybe_revoke_civilian_protection(db, target.get("id") or "", "received_casino_transfer")
        loc = stored_city or city
        sender_name = (current_user.get("username") or "").strip() or "?"
        await send_notification(
            target.get("id") or "",
            "Casino transferred",
            f"{sender_name} sent you the dice table in {loc}.",
            "reward",
        )
        return {"message": "Ownership transferred."}
