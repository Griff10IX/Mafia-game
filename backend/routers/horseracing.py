# Casino Horse Racing (racetrack): config, ownership, claim, relinquish, set-max-bet, send-to-user, sell-on-trade, race, history
from datetime import datetime, timezone
import re
import random
import time
from pydantic import BaseModel
from bson.objectid import ObjectId

from fastapi import Depends, HTTPException

from server import (
    db,
    get_current_user,
    STATES,
    _user_owns_any_casino,
    _username_pattern,
)
from routers.roulette import RouletteClaimRequest, RouletteSetMaxBetRequest, RouletteSendToUserRequest
from routers.dice import DiceSellOnTradeRequest

# ----- Constants -----
HORSERACING_MAX_BET = 10_000_000
HORSERACING_CLAIM_COST = 500_000_000  # $500M to claim track (per city)
HORSERACING_ABSOLUTE_MAX_BET = 50_000_000  # owner can set max_bet up to this
HORSERACING_HOUSE_EDGE = 0.05
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
    pattern = re.compile(f"^{re.escape(city)}$", re.IGNORECASE)
    doc = await db.horseracing_ownership.find_one({"city": pattern})
    if doc:
        return doc.get("city", city), doc
    return city, None


def _horseracing_pick_winner() -> dict:
    """Pick a winner weighted by inverse odds (evens = favourite wins much more often)."""
    horses = list(HORSERACING_HORSES)
    if not horses:
        return None
    # Weight = 1/odds so evens (1) has highest, 2:1 half that, etc. Evens then ~48% vs ~38% with 1/(odds+1).
    weights = [1.0 / max(1, h.get("odds") or 1) for h in horses]
    total = sum(weights)
    if total <= 0:
        return random.choice(horses)
    r = random.uniform(0, total)
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
        key=lambda h: (random.random() * 0.4 + 1.0 / max(1, h.get("odds") or 1)),
        reverse=True,
    )
    finish_order_ids = [winner["id"]] + [h["id"] for h in order_others]

    # Race closeness: ~35% neck-and-neck, ~45% medium, ~20% blowout
    r = random.random()
    if r < 0.35:
        margins = [random.uniform(0.15, 0.7) for _ in range(6)]
    elif r < 0.80:
        margins = [random.uniform(0.8, 2.5) for _ in range(6)]
    else:
        margins = [random.uniform(3, 10) for _ in range(6)]

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
    async def casino_horseracing_config(current_user: dict = Depends(get_current_user)):
        """Horse racing config: horses, max_bet (from ownership or default), claim_cost, house_edge."""
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city_for_horseracing(raw) if raw else (STATES[0] if STATES else "")
        _, doc = await _get_horseracing_ownership_doc(city) if city else (None, None)
        max_bet = doc.get("max_bet", HORSERACING_MAX_BET) if doc else HORSERACING_MAX_BET
        return {
            "horses": list(HORSERACING_HORSES),
            "max_bet": max_bet,
            "house_edge": HORSERACING_HOUSE_EDGE,
            "claim_cost": HORSERACING_CLAIM_COST,
        }

    @router.get("/casino/horseracing/ownership")
    async def casino_horseracing_ownership(current_user: dict = Depends(get_current_user)):
        """Current city's track ownership: owner, is_owner, claim_cost, max_bet."""
        user_id = current_user["id"]
        now_ts = time.time()
        entry = _ownership_cache.get(user_id)
        if entry and (now_ts - entry["ts"]) < _OWNERSHIP_TTL_SEC:
            return entry["data"]
        raw = (current_user.get("current_state") or "").strip()
        city = _normalize_city_for_horseracing(raw) if raw else (STATES[0] if STATES else "Chicago")
        display_city = city or raw or "Chicago"
        stored_city, doc = await _get_horseracing_ownership_doc(city)
        if not doc:
            out = {
                "current_city": display_city,
                "owner_id": None,
                "owner_name": None,
                "is_owner": False,
                "is_unclaimed": True,
                "claim_cost": HORSERACING_CLAIM_COST,
                "max_bet": HORSERACING_MAX_BET,
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
        max_bet = doc.get("max_bet", HORSERACING_MAX_BET)
        total_earnings = doc.get("total_earnings", 0)
        profit = int((doc.get("profit") or 0) or 0)
        out = {
            "current_city": display_city,
            "owner_id": owner_id,
            "owner_name": owner_name,
            "is_owner": is_owner,
            "is_unclaimed": owner_id is None,
            "claim_cost": HORSERACING_CLAIM_COST,
            "max_bet": max_bet,
            "total_earnings": total_earnings if is_owner else None,
            "profit": profit if is_owner else None,
        }
        if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
            _ownership_cache[user_id] = {"ts": now_ts, "data": out}
        return out

    @router.post("/casino/horseracing/claim")
    async def casino_horseracing_claim(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_horseracing((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        owned = await _user_owns_any_casino(current_user["id"])
        if owned and (owned.get("type") != "horseracing" or owned.get("city") != city):
            raise HTTPException(status_code=400, detail="You may only own 1 casino. Relinquish it first (Casino or My Properties).")
        stored_city, doc = await _get_horseracing_ownership_doc(city)
        if doc and doc.get("owner_id"):
            raise HTTPException(status_code=400, detail="This track already has an owner")
        user = await db.users.find_one({"id": current_user["id"]})
        if not user or user.get("money", 0) < HORSERACING_CLAIM_COST:
            raise HTTPException(status_code=400, detail=f"You need ${HORSERACING_CLAIM_COST:,} to claim")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -HORSERACING_CLAIM_COST}})
        await db.horseracing_ownership.update_one(
            {"city": stored_city or city},
            {"$set": {"owner_id": current_user["id"], "owner_username": current_user["username"], "max_bet": HORSERACING_MAX_BET, "total_earnings": 0, "profit": 0}},
            upsert=True,
        )
        return {"message": f"You now own the race track in {city}!"}

    @router.post("/casino/horseracing/relinquish")
    async def casino_horseracing_relinquish(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_horseracing((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_horseracing_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this track")
        await db.horseracing_ownership.update_one({"city": stored_city or city}, {"$set": {"owner_id": None, "owner_username": None}})
        return {"message": "Ownership relinquished."}

    @router.post("/casino/horseracing/set-max-bet")
    async def casino_horseracing_set_max_bet(request: RouletteSetMaxBetRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_horseracing((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_horseracing_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this track")
        new_max = max(1_000_000, min(request.max_bet, HORSERACING_ABSOLUTE_MAX_BET))
        await db.horseracing_ownership.update_one({"city": stored_city or city}, {"$set": {"max_bet": new_max}})
        return {"message": f"Max bet set to ${new_max:,}"}

    @router.post("/casino/horseracing/send-to-user")
    async def casino_horseracing_send_to_user(request: RouletteSendToUserRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_horseracing((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_horseracing_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this track")
        target_username_pattern = _username_pattern(request.target_username.strip())
        target = await db.users.find_one({"username": target_username_pattern}, {"_id": 0, "id": 1, "username": 1})
        if not target or target["id"] == current_user["id"]:
            raise HTTPException(status_code=400, detail="Invalid target user")
        await db.horseracing_ownership.update_one({"city": stored_city or city}, {"$set": {"owner_id": target["id"], "owner_username": target.get("username")}})
        _invalidate_ownership_cache(target["id"])
        return {"message": f"Track ownership transferred to {target.get('username', '?')}."}

    @router.post("/casino/horseracing/sell-on-trade")
    async def casino_horseracing_sell_on_trade(request: DiceSellOnTradeRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        city = _normalize_city_for_horseracing((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        if request.points <= 0:
            raise HTTPException(status_code=400, detail="Points must be positive")
        stored_city, doc = await _get_horseracing_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own this track")
        casino_property = {
            "_id": ObjectId(),
            "type": "casino_horseracing",
            "location": city,
            "name": f"Horse Racing Track ({city})",
            "owner_id": current_user["id"],
            "owner_username": current_user.get("username", "Unknown"),
            "for_sale": True,
            "sale_price": request.points,
            "created_at": datetime.now(timezone.utc)
        }
        await db.properties.insert_one(casino_property)
        return {"message": f"Horse racing track listed for {request.points:,} points on Quick Trade"}

    @router.post("/casino/horseracing/race")
    async def casino_horseracing_race(request: HorseRacingBetRequest, current_user: dict = Depends(get_current_user)):
        _invalidate_ownership_cache(current_user["id"])
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city_for_horseracing(raw) if raw else (STATES[0] if STATES else "")
        stored_city, doc = await _get_horseracing_ownership_doc(city) if city else (None, None)
        max_bet = doc.get("max_bet", HORSERACING_MAX_BET) if doc else HORSERACING_MAX_BET
        owner_id = doc.get("owner_id") if doc else None
        if owner_id and owner_id == current_user["id"]:
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
        user_money = int(current_user.get("money") or 0)
        if user_money < bet:
            raise HTTPException(status_code=400, detail="Insufficient cash")
        winner = _horseracing_pick_winner()
        won = winner["id"] == horse_id
        if won:
            payout = int(bet * (1 + horse["odds"]) * (1.0 - HORSERACING_HOUSE_EDGE))
            payout = max(payout, bet)
        else:
            payout = 0
        new_money = user_money - bet
        if not owner_id:
            if won:
                new_money += payout
            await db.users.update_one({"id": current_user["id"]}, {"$set": {"money": new_money}})
        else:
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -bet}})
            if won:
                owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1})
                owner_money = int((owner.get("money") or 0) or 0)
                actual_payout = min(payout, owner_money)
                shortfall = payout - actual_payout
                await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": actual_payout}})
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_payout}})
                await db.horseracing_ownership.update_one(
                    {"city": stored_city or city},
                    {"$inc": {"profit": -actual_payout}}
                )
                new_money = user_money - bet + actual_payout
                if shortfall > 0:
                    await db.horseracing_ownership.update_one(
                        {"city": stored_city or city},
                        {"$set": {"owner_id": None, "owner_username": None}}
                    )
            else:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": bet}})
                await db.horseracing_ownership.update_one(
                    {"city": stored_city or city},
                    {"$inc": {"total_earnings": bet, "profit": bet}}
                )
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
            {"id": current_user["id"]},
            {"$push": {"horseracing_history": {"$each": [history_entry], "$slice": -HORSERACING_HISTORY_MAX}}}
        )
        finish_pcts, finish_order_ids, photo_finish = _horseracing_finish_order(winner["id"])
        return {
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

    @router.get("/casino/horseracing/history")
    async def casino_horseracing_history(current_user: dict = Depends(get_current_user)):
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "horseracing_history": 1})
        history = (user.get("horseracing_history") or [])[:HORSERACING_HISTORY_MAX]
        return {"history": list(reversed(history))}
