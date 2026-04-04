# Casino Horse Racing (racetrack): config, ownership, claim, relinquish, set-max-bet, set-buy-back, send-to-user, sell-on-trade, race, history, buy-back
from datetime import datetime, timezone, timedelta
import re
import secrets
_rng = secrets.SystemRandom()
import time
import uuid
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
    get_rank_info,
    CAPO_RANK_ID,
    maybe_auto_relinquish_below_capo,
    log_gambling,
    resolve_gambling_log_buy_back,
    _user_owns_any_casino,
    _username_pattern,
    get_head_family_id_for_state,
    get_casino_caps,
    assert_casino_buy_back_within_points_balance,
    _ownership_display_profit,
    bump_user_biggest_casino_payout,
)
from routers.casinos.roulette import RouletteClaimRequest, RouletteSetMaxBetRequest, RouletteSendToUserRequest
from routers.casinos.dice import DiceSellOnTradeRequest

# ----- Constants -----
HORSERACING_MAX_BET = 10_000_000
# Horse racing claim cost: utils.claim_costs (key horseracing)
HORSERACING_ABSOLUTE_MAX_BET = 50_000_000  # owner can set max_bet up to this
HORSERACING_HOUSE_EDGE = 0.0005  # 0.05%
HORSERACING_HORSES = [
    {"id": 1, "name": "Thunder Bolt", "odds": 1},
    {"id": 2, "name": "Midnight Runner", "odds": 2},
    {"id": 3, "name": "Golden Star", "odds": 4},
    {"id": 4, "name": "Shadow Fox", "odds": 6},
    {"id": 5, "name": "Storm Chaser", "odds": 12},
    {"id": 6, "name": "Dark Horse", "odds": 20},
    {"id": 7, "name": "Wild Card", "odds": 40},
]
HORSERACING_HISTORY_MAX = 20

# ----- Models -----
class HorseRacingBetRequest(BaseModel):
    horse_id: int
    bet: int


class HorseRacingSetBuyBackRequest(BaseModel):
    city: str
    amount: int


class HorseRacingBuyBackAcceptRequest(BaseModel):
    offer_id: str


class HorseRacingBuyBackRejectRequest(BaseModel):
    offer_id: str


# ----- Per-user cache for GET /casino/horseracing/ownership -----
_ownership_cache: dict = {}
_OWNERSHIP_TTL_SEC = 10
_OWNERSHIP_MAX_ENTRIES = 5000


def _invalidate_ownership_cache(user_id: str):
    _ownership_cache.pop(user_id, None)


def _normalize_city_for_horseracing(city_raw: str) -> str:
    if not city_raw:
        return ""
    city_lower = city_raw.strip().lower()
    for state in STATES:
        if state.lower() == city_lower:
            return state
    return ""


async def _get_horseracing_ownership_doc(city: str):
    if not city:
        return city, None
    norm = _normalize_city_for_horseracing(city) or city
    if norm:
        await maybe_auto_relinquish_below_capo(db.horseracing_ownership, {"city": norm})
    pattern = re.compile(f"^{re.escape(city)}$", re.IGNORECASE)
    doc = await db.horseracing_ownership.find_one({"city": pattern})
    if doc:
        return doc.get("city", city), doc
    return city, None


def _horseracing_pick_winner() -> dict:
    """Pick a winner weighted by inverse odds (realistic: win chance matches implied probability from odds)."""
    horses = list(HORSERACING_HORSES)
    if not horses:
        return None
    # Weight = 1/odds so win probability matches real bookmaking (e.g. evens ~48%, 2:1 ~24%)
    weights = [1.0 / max(1, h.get("odds") or 1) for h in horses]
    total = sum(weights)
    if total <= 0:
        return _rng.choice(horses)
    r = _rng.uniform(0, total)
    acc = 0
    for h, w in zip(horses, weights):
        acc += w
        if r <= acc:
            return h
    return horses[-1]


def _horseracing_finish_order(winner_id: int):
    """
    Return finish_pcts (list of 7 floats, one per horse in HORSERACING_HORSES order).
    Winner is at 100. Some races are neck-and-neck (small gaps), some are blowouts (large gaps).
    """
    horses = list(HORSERACING_HORSES)
    winner = next((h for h in horses if h["id"] == winner_id), horses[0])
    others = [h for h in horses if h["id"] != winner_id]
    # 2nd–7th: order by inverse-odds (better horses tend to finish ahead), with randomness
    # Sort 2nd–7th by weighted random: better (lower odds) horses tend to finish ahead
    order_others = sorted(
        others,
        key=lambda h: (_rng.random() * 0.4 + 1.0 / max(1, h.get("odds") or 1)),
        reverse=True,
    )
    finish_order_ids = [winner["id"]] + [h["id"] for h in order_others]

    # Race closeness: ~15% neck-and-neck, ~55% medium, ~30% blowout
    r = _rng.random()
    if r < 0.15:
        margins = [_rng.uniform(0.2, 0.8) for _ in range(6)]
    elif r < 0.70:
        margins = [_rng.uniform(0.8, 2.8) for _ in range(6)]
    else:
        margins = [_rng.uniform(3, 12) for _ in range(6)]

    positions = [100.0]
    for m in margins:
        positions.append(positions[-1] - m)
    # Clamp so last place is still on screen (e.g. >= 45)
    min_pos = min(45, positions[-1])
    if positions[-1] < min_pos:
        step = (positions[0] - min_pos) / 6
        positions = [100.0 - i * step for i in range(7)]

    id_to_pct = dict(zip(finish_order_ids, positions))
    finish_pcts = [id_to_pct.get(h["id"], 50.0) for h in horses]
    photo_finish = len(positions) >= 2 and (positions[0] - positions[1]) < 1.0
    return finish_pcts, finish_order_ids, photo_finish


def register(router):
    @router.get("/casino/horseracing/config")
    async def casino_horseracing_config(current_user: dict = Depends(get_current_user_verified)):
        """Horse racing config: horses, max_bet (from ownership or default), claim_cost, house_edge."""
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city_for_horseracing(raw) if raw else (STATES[0] if STATES else "")
        _, doc = await _get_horseracing_ownership_doc(city) if city else (None, None)
        max_bet = doc.get("max_bet", HORSERACING_MAX_BET) if doc else HORSERACING_MAX_BET
        cc = await load_claim_costs(db)
        return {
            "horses": list(HORSERACING_HORSES),
            "max_bet": max_bet,
            "house_edge": HORSERACING_HOUSE_EDGE,
            "claim_cost": cc["horseracing"],
        }

    @router.get("/casino/horseracing/ownership")
    async def casino_horseracing_ownership(current_user: dict = Depends(get_current_user_verified)):
        """Current city's track ownership: owner, is_owner, claim_cost, max_bet, buy_back_reward, buy_back_offer."""
        user_id = current_user.get("id") or ""
        now_ts = time.time()
        entry = _ownership_cache.get(user_id)
        if entry and (now_ts - entry["ts"]) < _OWNERSHIP_TTL_SEC:
            cc = await load_claim_costs(db)
            return {**entry["data"], "claim_cost": cc["horseracing"]}
        now = datetime.now(timezone.utc)
        await cleanup_expired_buyback_offers_for_user(db, "horseracing_buy_back_offers", user_id, now.isoformat())
        raw = (current_user.get("current_state") or "").strip()
        city = _normalize_city_for_horseracing(raw) if raw else (STATES[0] if STATES else "Chicago")
        display_city = city or raw or "Chicago"
        stored_city, doc = await _get_horseracing_ownership_doc(city)
        cc = await load_claim_costs(db)
        if not doc:
            out = {
                "current_city": display_city,
                "owner_id": None,
                "owner_name": None,
                "is_owner": False,
                "is_unclaimed": True,
                "claim_cost": cc["horseracing"],
                "max_bet": HORSERACING_MAX_BET,
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
        max_bet = doc.get("max_bet", HORSERACING_MAX_BET)
        total_earnings = doc.get("total_earnings", 0)
        profit = _ownership_display_profit(doc)
        buy_back_reward = doc.get("buy_back_reward")
        # Check for active buyback offer for this user
        active_offer = await db.horseracing_buy_back_offers.find_one(
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
            "claim_cost": cc["horseracing"],
            "max_bet": max_bet,
            "buy_back_reward": buy_back_reward,
            "total_earnings": total_earnings if is_owner else None,
            "profit": profit if is_owner else None,
            "buy_back_offer": buy_back_offer,
        }
        if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
            _ownership_cache[user_id] = {"ts": now_ts, "data": out}
        return out

    @router.post("/casino/horseracing/claim")
    async def casino_horseracing_claim(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
        prestige_level = int(current_user.get("prestige_level") or 0)
        if rank_id < CAPO_RANK_ID and prestige_level < 1:
            raise HTTPException(status_code=403, detail="You must be rank Capo or higher to claim a casino. Reach Capo to hold one.")
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_horseracing((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        owned = await _user_owns_any_casino(current_user.get("id") or "")
        if owned and (owned.get("type") != "horseracing" or owned.get("city") != city):
            raise HTTPException(status_code=400, detail="You may only own 1 casino. Relinquish it first (Casino or My Properties).")
        stored_city, doc = await _get_horseracing_ownership_doc(city)
        cc = await load_claim_costs(db)
        claim_cost = cc["horseracing"]
        user = await db.users.find_one({"id": current_user.get("id") or ""})
        if not user or user.get("money", 0) < claim_cost:
            raise HTTPException(status_code=400, detail=f"You need ${claim_cost:,} to claim")
        res = await db.horseracing_ownership.update_one(
            {"city": stored_city or city, "owner_id": None},
            {"$set": {"owner_id": current_user.get("id") or "", "owner_username": current_user.get("username") or "", "max_bet": HORSERACING_MAX_BET, "buy_back_reward": 0}},
            upsert=True,
        )
        if not res.modified_count and not res.upserted_id:
            raise HTTPException(status_code=400, detail="This track already has an owner")
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": -claim_cost}})
        await maybe_revoke_civilian_protection(db, current_user.get("id") or "", "casino_claim")
        return {"message": f"You now own the race track in {city}!"}

    @router.post("/casino/horseracing/relinquish")
    async def casino_horseracing_relinquish(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_horseracing((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_horseracing_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this track")
        await db.horseracing_ownership.update_one({"city": stored_city or city}, {"$set": {"owner_id": None, "owner_username": None}})
        return {"message": "Ownership relinquished."}

    @router.post("/casino/horseracing/reset-profit")
    async def casino_horseracing_reset_profit(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        """Reset profit counter to zero (owner only)."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_horseracing((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_horseracing_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this track")
        await db.horseracing_ownership.update_one({"city": stored_city or city}, {"$set": {"profit": 0}})
        return {"message": "Profit reset to zero."}

    @router.post("/casino/horseracing/set-max-bet")
    async def casino_horseracing_set_max_bet(request: RouletteSetMaxBetRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_horseracing((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_horseracing_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this track")
        global_cap, _ = await get_casino_caps()
        new_max = max(50_000, min(request.max_bet, global_cap))
        await db.horseracing_ownership.update_one({"city": stored_city or city}, {"$set": {"max_bet": new_max}})
        return {"message": f"Max bet set to ${new_max:,}"}

    @router.post("/casino/horseracing/set-buy-back-reward")
    async def casino_horseracing_set_buy_back_reward(request: HorseRacingSetBuyBackRequest, current_user: dict = Depends(get_current_user_verified)):
        """Set buy-back reward (points) offered when you cannot pay a win (owner only)."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_horseracing((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_horseracing_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this track")
        _, buyback_cap = await get_casino_caps()
        amount = max(0, min(int(request.amount), buyback_cap))
        await assert_casino_buy_back_within_points_balance(current_user["id"], amount)
        await db.horseracing_ownership.update_one({"city": stored_city or city}, {"$set": {"buy_back_reward": amount}})
        return {"message": "Buy-back reward updated."}

    @router.post("/casino/horseracing/buy-back/accept")
    async def casino_horseracing_buy_back_accept(request: HorseRacingBuyBackAcceptRequest, current_user: dict = Depends(get_current_user_verified)):
        """Accept a buy-back offer: receive points and transfer ownership back to previous owner."""
        offer = await db.horseracing_buy_back_offers.find_one_and_delete({"id": request.offer_id}, projection={"_id": 0})
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
        await log_points_event(db, user_id=from_owner_id, points=-points_offered, event_type="casino_horseracing", event_ref=f"buyback:{request.offer_id}", meta={"action": "buyback_deduct", "city": city, "offer_id": request.offer_id})
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"points": points_offered}})
        await log_points_event(db, user_id=current_user.get("id") or "", points=points_offered, event_type="casino_horseracing", event_ref=f"buyback:{request.offer_id}", meta={"action": "buyback_credit", "city": city, "offer_id": request.offer_id})
        # Reset max_bet to 0 when ownership returns - owner must set it again
        await db.horseracing_ownership.update_one({"city": city}, {"$set": {"owner_id": from_owner_id, "owner_username": from_user.get("username"), "max_bet": 0}})
        _invalidate_ownership_cache(current_user.get("id") or "")
        _invalidate_ownership_cache(from_owner_id)
        await resolve_gambling_log_buy_back(request.offer_id, "accepted", points_offered)
        return {"message": "Accepted. You received the points and the track was returned to the previous owner."}

    @router.post("/casino/horseracing/buy-back/reject")
    async def casino_horseracing_buy_back_reject(request: HorseRacingBuyBackRejectRequest, current_user: dict = Depends(get_current_user_verified)):
        """Reject a buy-back offer: keep ownership."""
        offer = await db.horseracing_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0, "to_user_id": 1})
        if not offer or offer.get("to_user_id") != current_user.get("id") or "":
            raise HTTPException(status_code=404, detail="Offer not found")
        await db.horseracing_buy_back_offers.delete_one({"id": request.offer_id})
        _invalidate_ownership_cache(current_user.get("id") or "")
        await resolve_gambling_log_buy_back(request.offer_id, "rejected", 0)
        await maybe_revoke_civilian_protection(db, current_user.get("id") or "", "casino_buyback_reject")
        return {"message": "Rejected. You keep the track."}

    @router.post("/casino/horseracing/send-to-user")
    async def casino_horseracing_send_to_user(request: RouletteSendToUserRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_horseracing((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_horseracing_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this track")
        target_username_pattern = _username_pattern(request.target_username.strip())
        target = await db.users.find_one({"username": target_username_pattern}, {"_id": 0, "id": 1, "username": 1, "rank_points": 1})
        if not target or (target.get("id") or "") == (current_user.get("id") or ""):
            raise HTTPException(status_code=400, detail="Invalid target user")
        send_set = {"owner_id": target.get("id") or "", "owner_username": target.get("username") or ""}
        if get_rank_info(target.get("rank_points", 0))[0] < CAPO_RANK_ID:
            send_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
        await db.horseracing_ownership.update_one({"city": stored_city or city}, {"$set": send_set})
        _invalidate_ownership_cache(target.get("id") or "")
        await maybe_revoke_civilian_protection(db, target.get("id") or "", "received_casino_transfer")
        return {"message": f"Track ownership transferred to {target.get('username', '?')}."}

    @router.post("/casino/horseracing/sell-on-trade")
    async def casino_horseracing_sell_on_trade(request: DiceSellOnTradeRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city_for_horseracing((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        if request.points <= 0:
            raise HTTPException(status_code=400, detail="Points must be positive")
        stored_city, doc = await _get_horseracing_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this track")
        listing_id = ObjectId()
        casino_property = {
            "_id": listing_id,
            "id": str(listing_id),
            "type": "casino_horseracing",
            "location": city,
            "name": f"Horse Racing Track ({city})",
            "owner_id": current_user.get("id") or "",
            "owner_username": current_user.get("username", "Unknown"),
            "for_sale": True,
            "sale_price": request.points,
            "created_at": datetime.now(timezone.utc)
        }
        await db.properties.insert_one(casino_property)
        return {"message": f"Horse racing track listed for {request.points:,} points on Quick Trade"}

    @router.post("/casino/horseracing/race")
    async def casino_horseracing_race(request: HorseRacingBetRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city_for_horseracing(raw) if raw else (STATES[0] if STATES else "")
        stored_city, doc = await _get_horseracing_ownership_doc(city) if city else (None, None)
        max_bet = doc.get("max_bet", HORSERACING_MAX_BET) if doc else HORSERACING_MAX_BET
        owner_id = doc.get("owner_id") if doc else None
        if owner_id and owner_id == current_user.get("id"):
            raise HTTPException(status_code=400, detail="You cannot bet at your own track")
        horse_id = int(request.horse_id)
        bet = int(request.bet or 0)
        if bet < 1:
            raise HTTPException(status_code=400, detail="Bet must be at least 1")
        if bet > max_bet:
            raise HTTPException(status_code=400, detail=f"Max bet is ${max_bet:,}")
        horse = next((h for h in HORSERACING_HORSES if h["id"] == horse_id), None)
        if not horse:
            raise HTTPException(status_code=400, detail="Invalid horse")
        debit_res = await db.users.find_one_and_update(
            {"id": current_user.get("id") or "", "money": {"$gte": bet}},
            {"$inc": {"money": -bet}},
        )
        if not debit_res:
            raise HTTPException(status_code=400, detail="Insufficient cash")
        user_money = int((debit_res.get("money") or 0) or 0)
        winner = _horseracing_pick_winner()
        won = winner["id"] == horse_id
        ownership_transferred = False
        buy_back_offer = None
        actual_payout = 0
        shortfall = 0
        points_offered = 0
        if won:
            payout = int(bet * (1 + horse["odds"]) * (1.0 - HORSERACING_HOUSE_EDGE))
            payout = max(payout, bet)
        else:
            payout = 0
        new_money = user_money - bet
        if not owner_id:
            head_family_id = await get_head_family_id_for_state(stored_city or city) if (stored_city or city) else None
            if won:
                new_money += payout
                if head_family_id:
                    edge = int(bet * (1 + horse["odds"]) * HORSERACING_HOUSE_EDGE)
                    if edge > 0:
                        await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge, "state_head_income.horseracing": edge}})
            else:
                if head_family_id:
                    edge_lose = int(bet * HORSERACING_HOUSE_EDGE)
                    if edge_lose > 0:
                        await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose, "state_head_income.horseracing": edge_lose}})
            if won:
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": payout}})
        else:
            head_family_id = await get_head_family_id_for_state(stored_city or city) if (stored_city or city) else None
            if won:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": bet}})
                owner_after_bet = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1, "username": 1})
                owner_username = (owner_after_bet or {}).get("username")
                debit_ok = await db.users.update_one(
                    {"id": owner_id, "money": {"$gte": payout}},
                    {"$inc": {"money": -payout, "total_casino_payouts": payout}},
                )
                if debit_ok.modified_count > 0:
                    actual_payout = payout
                    shortfall = 0
                else:
                    owner_now = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1})
                    available = max(0, int((owner_now or {}).get("money", 0)))
                    actual_payout = available
                    shortfall = payout - actual_payout
                    if actual_payout > 0:
                        await db.users.update_one(
                            {"id": owner_id, "money": {"$gte": actual_payout}},
                            {"$inc": {"money": -actual_payout, "total_casino_payouts": actual_payout}},
                        )
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": actual_payout}})
                # Track biggest payout for owner
                await bump_user_biggest_casino_payout(owner_id, actual_payout)
                edge = int(bet * (1 + horse["odds"]) * HORSERACING_HOUSE_EDGE) if head_family_id else 0
                if head_family_id and edge > 0:
                    await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge, "state_head_income.horseracing": edge}})
                    await db.users.update_one({"id": owner_id}, {"$inc": {"money": -edge}})
                await db.horseracing_ownership.update_one(
                    {"city": stored_city or city},
                    {"$inc": {"profit": (bet - actual_payout) - (edge if head_family_id else 0)}}
                )
                _invalidate_ownership_cache(owner_id)
                new_money = user_money - bet + actual_payout
                points_offered = int((doc or {}).get("buy_back_reward") or 0)
                if shortfall > 0:
                    ownership_transferred = True
                    hr_owner_set = {"owner_id": current_user.get("id") or "", "owner_username": current_user.get("username") or ""}
                    if get_rank_info(current_user.get("rank_points", 0))[0] < CAPO_RANK_ID:
                        hr_owner_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
                    await db.horseracing_ownership.update_one({"city": stored_city or city}, {"$set": hr_owner_set})
                    # Track casino won/lost stats
                    await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"casinos_seized": 1}})
                    await db.users.update_one({"id": owner_id}, {"$inc": {"casinos_lost": 1}})
                    if points_offered <= 0:
                        # No buyback offer - ownership transferred with no offer. Profit already updated above; only route tax to family if state head.
                        if head_family_id:
                            edge_lose = int(bet * HORSERACING_HOUSE_EDGE)
                            if edge_lose > 0:
                                await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose, "state_head_income.horseracing": edge_lose}})
                    else:
                        # Create buyback offer
                        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
                        offer_id = str(uuid.uuid4())
                        buy_back_doc = {
                            "id": offer_id,
                            "city": stored_city or city,
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
                        await db.horseracing_buy_back_offers.insert_one(buy_back_doc)
                        buy_back_offer = {"offer_id": offer_id, "points_offered": points_offered, "amount_shortfall": shortfall, "owner_paid": actual_payout, "expires_at": expires_at}
                elif head_family_id:
                    edge = int(bet * (1 + horse["odds"]) * HORSERACING_HOUSE_EDGE)
                    if edge > 0:
                        await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge, "state_head_income.horseracing": edge}})
                        await db.users.update_one({"id": owner_id}, {"$inc": {"money": -edge}})
            else:
                if head_family_id:
                    edge_lose = int(bet * HORSERACING_HOUSE_EDGE)
                    if edge_lose > 0:
                        await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_lose, "state_head_income.horseracing": edge_lose}})
                else:
                    await db.users.update_one({"id": owner_id}, {"$inc": {"money": bet}})
                    await db.horseracing_ownership.update_one(
                        {"city": stored_city or city},
                        {"$inc": {"total_earnings": bet, "profit": bet}}
                    )
                    _invalidate_ownership_cache(owner_id)
                if head_family_id and owner_id:
                    owner_take = max(0, bet - edge_lose)
                    if owner_take > 0:
                        await db.users.update_one({"id": owner_id}, {"$inc": {"money": owner_take}})
                    await db.horseracing_ownership.update_one(
                        {"city": stored_city or city},
                        {"$inc": {"total_earnings": bet, "profit": owner_take}}
                    )
                    _invalidate_ownership_cache(owner_id)
        history_entry = {
            "bet": bet,
            "horse_id": horse_id,
            "horse_name": horse["name"],
            "won": won,
            "payout": payout if won else 0,
            "winner_name": winner["name"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.update_one(
            {"id": current_user.get("id") or ""},
            {"$push": {"horseracing_history": {"$each": [history_entry], "$slice": -HORSERACING_HISTORY_MAX}}}
        )
        hr_details = {
            "city": city,
            "bet": bet,
            "horse_id": horse_id,
            "horse_name": horse["name"],
            "odds": horse.get("odds"),
            "won": won,
            "payout": payout if won else 0,
            "winner_name": winner["name"],
        }
        if owner_id and won:
            hr_details["payout"] = payout
            hr_details["actual_payout"] = actual_payout
            hr_details["shortfall"] = shortfall
            hr_details["ownership_transferred"] = ownership_transferred
            if ownership_transferred:
                if buy_back_offer and buy_back_offer.get("offer_id"):
                    hr_details["buy_back_offer_id"] = buy_back_offer["offer_id"]
                    hr_details["buy_back_points_offered"] = points_offered
                    hr_details["buy_back_outcome"] = "pending"
                else:
                    hr_details["buy_back_points_offered"] = 0
                    hr_details["buy_back_outcome"] = "not_offered"
        elif owner_id:
            hr_details["ownership_transferred"] = False
        await log_gambling(
            current_user.get("id") or "",
            current_user.get("username") or "?",
            "horseracing",
            hr_details,
        )
        finish_pcts, finish_order_ids, photo_finish = _horseracing_finish_order(winner["id"])
        result = {
            "winner_id": winner["id"],
            "horses": list(HORSERACING_HORSES),
            "finish_pcts": finish_pcts,
            "finish_order": finish_order_ids,
            "photo_finish": photo_finish,
            "won": won,
            "payout": payout,
            "winner_name": winner["name"],
            "new_balance": new_money,
        }
        # Add buyback info if ownership was transferred
        if owner_id and won:
            result["ownership_transferred"] = ownership_transferred
            result["buy_back_offer"] = buy_back_offer
        return result

    @router.get("/casino/horseracing/history")
    async def casino_horseracing_history(current_user: dict = Depends(get_current_user_verified)):
        user = await db.users.find_one({"id": current_user.get("id") or ""}, {"_id": 0, "horseracing_history": 1})
        history = (user.get("horseracing_history") or [])[:HORSERACING_HISTORY_MAX]
        return {"history": list(reversed(history))}
