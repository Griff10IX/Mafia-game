# Travel (info, travel, buy-airmiles) and Airports (list, claim, set-price, transfer, sell-on-trade)
from datetime import datetime, timezone, timedelta
from typing import Optional
import random
import time
from pydantic import BaseModel

from fastapi import Depends, HTTPException
from bson.objectid import ObjectId

from server import (
    db,
    get_current_user,
    STATES,
    CARS,
    TRAVEL_TIMES,
    _user_owns_any_property,
    _username_pattern,
)
from routers.booze_run import _booze_user_carrying_total

# Constants (moved from server)
AIRPORT_COST = 10
AIRPORT_PRICE_MIN = 10
AIRPORT_PRICE_MAX = 30
AIRPORT_SLOTS_PER_STATE = 1
MAX_TRAVELS_PER_HOUR = 15
EXTRA_AIRMILES_COST = 25
MAX_EXTRA_AIRMILES = 50

# Per-user cache for GET /travel/info
_travel_info_cache: dict = {}
_TRAVEL_INFO_TTL_SEC = 10
_TRAVEL_INFO_MAX_ENTRIES = 5000

# Short TTL cache for GET /airports (all states)
_airports_list_cache: Optional[dict] = None
_airports_list_cache_ts: float = 0
_AIRPORTS_LIST_TTL_SEC = 20


def _invalidate_travel_info_cache(user_id: str):
    _travel_info_cache.pop(user_id, None)


def _invalidate_airports_list_cache():
    global _airports_list_cache, _airports_list_cache_ts
    _airports_list_cache = None
    _airports_list_cache_ts = 0


# ----- Models -----
class TravelRequest(BaseModel):
    destination: str
    travel_method: str  # car_id or "airport"
    airport_slot: Optional[int] = None  # 1-4 when travel_method == "airport"


class AirportClaimRequest(BaseModel):
    state: str
    slot: int


class AirportSetPriceRequest(BaseModel):
    state: str
    slot: int
    price_per_travel: int


class AirportTransferRequest(BaseModel):
    state: str
    slot: int
    target_username: str


class AirportSellRequest(BaseModel):
    state: str
    slot: int
    points: int


# ----- Travel routes -----
async def get_travel_status(current_user: dict = Depends(get_current_user)):
    """Lightweight status for layout poll: traveling, seconds_remaining, destination. Returns 200 so layout can show travel countdown."""
    traveling_to = current_user.get("traveling_to")
    travel_arrives_at = current_user.get("travel_arrives_at")
    seconds_remaining = None
    if travel_arrives_at and traveling_to:
        try:
            arrives_dt = datetime.fromisoformat(travel_arrives_at.replace("Z", "+00:00"))
            secs = max(0, int((arrives_dt - datetime.now(timezone.utc)).total_seconds()))
            seconds_remaining = secs if secs > 0 else None
        except Exception:
            pass
    traveling = seconds_remaining is not None and seconds_remaining > 0
    return {
        "traveling": traveling,
        "seconds_remaining": seconds_remaining if traveling else 0,
        "destination": traveling_to if traveling else (current_user.get("current_state") or ""),
        "current_state": current_user.get("current_state") or "",
    }


async def get_travel_info(current_user: dict = Depends(get_current_user)):
    uid = current_user.get("id")
    now = time.monotonic()
    if uid in _travel_info_cache:
        payload, expires = _travel_info_cache[uid]
        if now <= expires:
            return payload

    reset_time = current_user.get("travel_reset_time")
    if reset_time:
        try:
            reset_dt = datetime.fromisoformat(reset_time.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) - reset_dt > timedelta(hours=1):
                await db.users.update_one(
                    {"id": uid},
                    {"$set": {"travels_this_hour": 0, "travel_reset_time": datetime.now(timezone.utc).isoformat()}}
                )
                current_user["travels_this_hour"] = 0
        except Exception:
            pass

    user_cars = await db.user_cars.find({"user_id": uid}).to_list(50)
    cars_with_travel_times = []
    for uc in user_cars:
        car_info = next((c for c in CARS if c["id"] == uc["car_id"]), None)
        if car_info:
            travel_time = TRAVEL_TIMES.get(car_info["rarity"], 45)
            user_car_id = uc.get("id") or str(uc["_id"])
            name = car_info["name"]
            image = car_info.get("image", "")
            damage_percent = min(100, max(0, float(uc.get("damage_percent", 0))))
            if uc.get("car_id") == "car_custom":
                if uc.get("custom_name"):
                    name = uc["custom_name"]
                if uc.get("custom_image_url"):
                    image = uc["custom_image_url"]
            cars_with_travel_times.append({
                "user_car_id": user_car_id,
                "car_id": car_info["id"],
                "name": name,
                "rarity": car_info["rarity"],
                "travel_time": travel_time,
                "image": image,
                "damage_percent": damage_percent,
                "can_travel": damage_percent < 100,
            })

    # Sort by travel time ascending (fastest first) so exclusive/ultra_rare/legendary show first
    cars_with_travel_times.sort(key=lambda c: (c["travel_time"], c.get("name", "")))

    custom_car = None
    first_custom = next((uc for uc in user_cars if uc.get("car_id") == "car_custom"), None)
    if first_custom:
        custom_damage = min(100, max(0, float(first_custom.get("damage_percent", 0))))
        custom_car = {
            "name": first_custom.get("custom_name") or "Custom Car",
            "travel_time": TRAVEL_TIMES["custom"],
            "image": first_custom.get("custom_image_url") or "",
            "damage_percent": custom_damage,
            "can_travel": custom_damage < 100,
        }

    max_travels = MAX_TRAVELS_PER_HOUR + current_user.get("extra_airmiles", 0)
    current_state = current_user.get("current_state", STATES[0] if STATES else "")
    traveling_to = current_user.get("traveling_to")
    travel_arrives_at = current_user.get("travel_arrives_at")
    seconds_remaining = None
    if travel_arrives_at and traveling_to:
        try:
            arrives_dt = datetime.fromisoformat(travel_arrives_at.replace("Z", "+00:00"))
            secs = max(0, int((arrives_dt - datetime.now(timezone.utc)).total_seconds()))
            seconds_remaining = secs if secs > 0 else None
        except Exception:
            pass

    carrying_booze = _booze_user_carrying_total(current_user.get("booze_carrying") or {}) > 0
    user_owns_any_airport = await db.airport_ownership.find_one({"owner_id": uid}, {"_id": 1})
    airports = []
    for slot in range(1, AIRPORT_SLOTS_PER_STATE + 1):
        doc = await db.airport_ownership.find_one({"state": current_state, "slot": slot}, {"_id": 0})
        if not doc:
            await db.airport_ownership.insert_one({"state": current_state, "slot": slot, "owner_id": None, "owner_username": None, "price_per_travel": AIRPORT_COST})
            doc = await db.airport_ownership.find_one({"state": current_state, "slot": slot}, {"_id": 0})
        price = max(AIRPORT_PRICE_MIN, min(doc.get("price_per_travel") or AIRPORT_COST, AIRPORT_PRICE_MAX))
        you_own = doc.get("owner_id") == uid
        airports.append({"slot": slot, "owner_username": doc.get("owner_username") or "Unclaimed", "price_per_travel": price, "you_own": you_own})

    airport_cost_display = AIRPORT_COST
    if airports:
        first_price = airports[0].get("price_per_travel") or AIRPORT_COST
        airport_cost_display = max(1, round(first_price * 0.95)) if user_owns_any_airport else first_price

    payload = {
        "current_location": current_state,
        "traveling_to": traveling_to if seconds_remaining is not None and seconds_remaining > 0 else None,
        "travel_seconds_remaining": seconds_remaining,
        "destinations": [s for s in STATES if s != current_state],
        "travels_this_hour": current_user.get("travels_this_hour", 0),
        "max_travels": max_travels,
        "airport_cost": airport_cost_display,
        "airport_time": TRAVEL_TIMES["airport"],
        "user_gets_airport_discount": bool(user_owns_any_airport),
        "airports": airports,
        "extra_airmiles_cost": EXTRA_AIRMILES_COST,
        "cars": cars_with_travel_times,
        "custom_car": custom_car,
        "user_points": current_user.get("points", 0),
        "carrying_booze": carrying_booze,
    }

    if len(_travel_info_cache) >= _TRAVEL_INFO_MAX_ENTRIES:
        oldest = next(iter(_travel_info_cache))
        _travel_info_cache.pop(oldest, None)
    _travel_info_cache[uid] = (payload, now + _TRAVEL_INFO_TTL_SEC)
    return payload


# Booze run: 0.3% damage per run. Custom and exclusive take no damage.
BOOZE_RUN_DAMAGE_PERCENT = 0.3


async def _start_travel_impl(
    user: dict,
    destination: str,
    travel_method: str,
    airport_slot: Optional[int] = None,
    booze_run: bool = False,
) -> dict:
    """Start travel for user (by user dict). Returns {message, travel_time, destination} or raises HTTPException. Used by travel() and auto_rank booze. If booze_run=True, damage is 0.3%% per run and custom/exclusive cars take no damage."""
    if booze_run and travel_method == "airport":
        raise HTTPException(status_code=400, detail="Booze runs can only use a car, not airport.")
    if destination not in STATES:
        raise HTTPException(status_code=400, detail="Invalid destination")
    now_utc = datetime.now(timezone.utc)
    current_location = user.get("current_state")
    if user.get("travel_arrives_at"):
        try:
            arrives_dt = datetime.fromisoformat(user["travel_arrives_at"].replace("Z", "+00:00"))
            if now_utc >= arrives_dt:
                current_location = user.get("traveling_to") or current_location
        except Exception:
            pass
    if destination == current_location:
        raise HTTPException(status_code=400, detail="Already at this location")
    if user.get("travel_arrives_at"):
        try:
            arrives_dt = datetime.fromisoformat(user["travel_arrives_at"].replace("Z", "+00:00"))
            if now_utc < arrives_dt:
                raise HTTPException(status_code=400, detail="You are already traveling. Wait for arrival.")
        except HTTPException:
            raise
        except Exception:
            pass

    # Travel limit applies to airport/manual travel; booze runs (car only) are exempt so auto rank can run
    if not booze_run:
        max_travels = MAX_TRAVELS_PER_HOUR + user.get("extra_airmiles", 0)
        if user.get("travels_this_hour", 0) >= max_travels:
            raise HTTPException(status_code=400, detail="Travel limit reached. Buy extra airmiles or wait.")

    travel_time = 45
    method_name = "Walking"
    car_to_damage = None  # user_car doc to apply travel damage (2–4%) when travel_time > 0

    if travel_method == "airport":
        if _booze_user_carrying_total(user.get("booze_carrying") or {}) > 0:
            raise HTTPException(status_code=400, detail="Cannot use airport while carrying booze. Use a car.")
        slot = airport_slot if airport_slot is not None else 1
        if slot < 1 or slot > AIRPORT_SLOTS_PER_STATE:
            raise HTTPException(status_code=400, detail=f"Invalid airport slot (1–{AIRPORT_SLOTS_PER_STATE})")
        airport_doc = await db.airport_ownership.find_one({"state": current_location, "slot": slot}, {"_id": 0})
        if not airport_doc:
            await db.airport_ownership.insert_one({"state": current_location, "slot": slot, "owner_id": None, "owner_username": None, "price_per_travel": AIRPORT_COST})
            airport_doc = await db.airport_ownership.find_one({"state": current_location, "slot": slot}, {"_id": 0})
        airport_price = max(AIRPORT_PRICE_MIN, min(airport_doc.get("price_per_travel") or AIRPORT_COST, AIRPORT_PRICE_MAX))
        user_owns_any_airport = await db.airport_ownership.find_one({"owner_id": user["id"]}, {"_id": 1})
        if user_owns_any_airport:
            airport_price = max(1, round(airport_price * 0.95))
        owner_id = airport_doc.get("owner_id")
        if user.get("points", 0) < airport_price:
            raise HTTPException(status_code=400, detail=f"Insufficient points for airport ({airport_price} pts)")
        travel_time = TRAVEL_TIMES["airport"]
        method_name = f"Airport #{slot}"
        await db.users.update_one({"id": user["id"]}, {"$inc": {"points": -airport_price}})
        if owner_id:
            await db.users.update_one({"id": owner_id}, {"$inc": {"points": airport_price}})
            await db.airport_ownership.update_one(
                {"state": current_location, "slot": slot},
                {"$inc": {"total_earnings": airport_price}}
            )
    elif travel_method == "custom":
        first_custom = await db.user_cars.find_one(
            {"user_id": user["id"], "car_id": "car_custom"},
            sort=[("acquired_at", 1)]
        )
        if not first_custom:
            raise HTTPException(status_code=400, detail="You don't own a custom car")
        if min(100, max(0, float(first_custom.get("damage_percent", 0)))) >= 100:
            raise HTTPException(status_code=400, detail="That car is too damaged to travel. Repair or scrap it in the garage.")
        travel_time = TRAVEL_TIMES["custom"]
        method_name = first_custom.get("custom_name") or "Custom Car"
        # Custom car never takes damage (manual or booze)
        car_to_damage = None
    else:
        user_car = await db.user_cars.find_one(
            {"id": travel_method, "user_id": user["id"]},
            {"_id": 0}
        )
        if not user_car:
            try:
                user_car = await db.user_cars.find_one(
                    {"_id": ObjectId(travel_method), "user_id": user["id"]},
                    {"_id": 0}
                )
            except Exception:
                user_car = None
        if not user_car:
            raise HTTPException(status_code=400, detail="Car not found")
        if min(100, max(0, float(user_car.get("damage_percent", 0)))) >= 100:
            raise HTTPException(status_code=400, detail="That car is too damaged to travel. Repair or scrap it in the garage.")
        car_info = next((c for c in CARS if c["id"] == user_car["car_id"]), None)
        if car_info:
            travel_time = TRAVEL_TIMES.get(car_info["rarity"], 45)
            method_name = car_info["name"]
        # Custom and exclusive cars never take damage (manual or booze)
        if car_info and car_info.get("rarity") == "exclusive":
            car_to_damage = None
        else:
            car_to_damage = user_car

    inc_travels = {} if booze_run else {"travels_this_hour": 1}
    if travel_time <= 0:
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"current_state": destination}, **({"$inc": inc_travels} if inc_travels else {})}
        )
    else:
        arrives_at = (now_utc + timedelta(seconds=travel_time)).isoformat()
        update = {"$set": {"traveling_to": destination, "travel_arrives_at": arrives_at}}
        if inc_travels:
            update["$inc"] = inc_travels
        await db.users.update_one({"id": user["id"]}, update)
        if car_to_damage:
            current_damage = min(100, max(0, float(car_to_damage.get("damage_percent", 0))))
            if booze_run:
                add_damage = BOOZE_RUN_DAMAGE_PERCENT  # 0.3% per run
            else:
                add_damage = random.randint(2, 4)
            new_damage = round(min(100, current_damage + add_damage), 1)
            if car_to_damage.get("_id") is not None:
                q = {"_id": car_to_damage["_id"]}
            else:
                q = {"user_id": user["id"], "id": car_to_damage.get("id")}
            await db.user_cars.update_one(q, {"$set": {"damage_percent": new_damage}})

    _invalidate_travel_info_cache(user["id"])
    return {
        "message": f"Traveling to {destination} via {method_name}",
        "travel_time": travel_time,
        "destination": destination
    }


async def travel(request: TravelRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("auto_rank_booze"):
        raise HTTPException(
            status_code=400,
            detail="Manual travel is disabled while Auto Rank booze running is on. Turn off booze running in Auto Rank to travel.",
        )
    return await _start_travel_impl(
        current_user,
        request.destination,
        request.travel_method,
        request.airport_slot,
    )


async def buy_extra_airmiles(current_user: dict = Depends(get_current_user)):
    if current_user["points"] < EXTRA_AIRMILES_COST:
        raise HTTPException(status_code=400, detail="Insufficient points")
    current_airmiles = int(current_user.get("extra_airmiles", 0) or 0)
    if current_airmiles >= MAX_EXTRA_AIRMILES:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_EXTRA_AIRMILES} extra airmiles already purchased")
    to_add = min(5, MAX_EXTRA_AIRMILES - current_airmiles)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -EXTRA_AIRMILES_COST, "extra_airmiles": to_add}}
    )
    new_total = current_airmiles + to_add
    _invalidate_travel_info_cache(current_user["id"])
    return {"message": f"Purchased {to_add} extra airmiles for {EXTRA_AIRMILES_COST} points. Total: {new_total}/{MAX_EXTRA_AIRMILES}"}


# ----- Airport routes -----
async def list_airports(current_user: dict = Depends(get_current_user)):
    global _airports_list_cache, _airports_list_cache_ts
    now = time.monotonic()
    if _airports_list_cache is not None and now <= _airports_list_cache_ts + _AIRPORTS_LIST_TTL_SEC:
        return _airports_list_cache
    result = []
    for state in STATES:
        for slot in range(1, AIRPORT_SLOTS_PER_STATE + 1):
            doc = await db.airport_ownership.find_one({"state": state, "slot": slot}, {"_id": 0})
            if not doc:
                await db.airport_ownership.insert_one({"state": state, "slot": slot, "owner_id": None, "owner_username": None, "price_per_travel": AIRPORT_COST})
                doc = await db.airport_ownership.find_one({"state": state, "slot": slot}, {"_id": 0})
            price = max(AIRPORT_PRICE_MIN, min(doc.get("price_per_travel") or AIRPORT_COST, AIRPORT_PRICE_MAX))
            result.append({"state": state, "slot": slot, "owner_username": doc.get("owner_username") or "Unclaimed", "price_per_travel": price})
    payload = {"airports": result}
    _airports_list_cache = payload
    _airports_list_cache_ts = now
    return payload


async def claim_airport(req: AirportClaimRequest, current_user: dict = Depends(get_current_user)):
    if req.state not in STATES:
        raise HTTPException(status_code=400, detail="Invalid state")
    if req.slot < 1 or req.slot > AIRPORT_SLOTS_PER_STATE:
        raise HTTPException(status_code=400, detail=f"Slot must be 1–{AIRPORT_SLOTS_PER_STATE}")
    owned_prop = await _user_owns_any_property(current_user["id"])
    if owned_prop and (owned_prop.get("type") != "airport" or owned_prop.get("state") != req.state):
        raise HTTPException(status_code=400, detail="You may only own 1 property (airport or bullet factory). Relinquish it first (My Properties or States).")
    user_location = (current_user.get("current_state") or "").strip()
    if user_location != req.state:
        raise HTTPException(status_code=400, detail=f"You must be in {req.state} to claim this airport. Travel there first.")
    doc = await db.airport_ownership.find_one({"state": req.state, "slot": req.slot}, {"_id": 0})
    if not doc:
        await db.airport_ownership.insert_one({"state": req.state, "slot": req.slot, "owner_id": None, "owner_username": None, "price_per_travel": AIRPORT_COST})
        doc = await db.airport_ownership.find_one({"state": req.state, "slot": req.slot}, {"_id": 0})
    if doc.get("owner_id"):
        raise HTTPException(status_code=400, detail="This airport slot is already owned")
    await db.airport_ownership.update_one(
        {"state": req.state, "slot": req.slot},
        {"$set": {"owner_id": current_user["id"], "owner_username": current_user.get("username"), "price_per_travel": AIRPORT_COST, "total_earnings": 0}}
    )
    _invalidate_airports_list_cache()
    _invalidate_travel_info_cache(current_user["id"])
    return {"message": f"You now own Airport #{req.slot} in {req.state}. Set price ({AIRPORT_PRICE_MIN}–{AIRPORT_PRICE_MAX} pts) and earn points when players fly from here. You get 5% off at all airports.", "state": req.state, "slot": req.slot}


async def set_airport_price(req: AirportSetPriceRequest, current_user: dict = Depends(get_current_user)):
    if req.state not in STATES:
        raise HTTPException(status_code=400, detail="Invalid state")
    if req.slot < 1 or req.slot > AIRPORT_SLOTS_PER_STATE:
        raise HTTPException(status_code=400, detail=f"Slot must be 1–{AIRPORT_SLOTS_PER_STATE}")
    if req.price_per_travel < AIRPORT_PRICE_MIN or req.price_per_travel > AIRPORT_PRICE_MAX:
        raise HTTPException(status_code=400, detail=f"Price must be {AIRPORT_PRICE_MIN}–{AIRPORT_PRICE_MAX} points per travel")
    doc = await db.airport_ownership.find_one({"state": req.state, "slot": req.slot}, {"_id": 0})
    if not doc or doc.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this airport slot")
    await db.airport_ownership.update_one(
        {"state": req.state, "slot": req.slot},
        {"$set": {"price_per_travel": req.price_per_travel}}
    )
    _invalidate_airports_list_cache()
    return {"message": f"Airport #{req.slot} in {req.state} set to {req.price_per_travel} points per travel", "state": req.state, "slot": req.slot, "price_per_travel": req.price_per_travel}


async def airport_transfer(req: AirportTransferRequest, current_user: dict = Depends(get_current_user)):
    if req.state not in STATES:
        raise HTTPException(status_code=400, detail="Invalid state")
    if req.slot < 1 or req.slot > AIRPORT_SLOTS_PER_STATE:
        raise HTTPException(status_code=400, detail=f"Slot must be 1–{AIRPORT_SLOTS_PER_STATE}")
    doc = await db.airport_ownership.find_one({"state": req.state, "slot": req.slot}, {"_id": 0})
    if not doc or doc.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this airport slot")
    target_username = (req.target_username or "").strip()
    if not target_username:
        raise HTTPException(status_code=400, detail="Enter a username")
    target_username_pattern = _username_pattern(target_username)
    if not target_username_pattern:
        raise HTTPException(status_code=404, detail="User not found")
    target = await db.users.find_one({"username": target_username_pattern}, {"_id": 0, "id": 1, "username": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot transfer to yourself")
    owned = await _user_owns_any_property(target["id"])
    if owned:
        raise HTTPException(status_code=400, detail="That user already owns a property")
    await db.airport_ownership.update_one(
        {"state": req.state, "slot": req.slot},
        {"$set": {"owner_id": target["id"], "owner_username": target.get("username", target_username), "total_earnings": 0}}
    )
    _invalidate_airports_list_cache()
    _invalidate_travel_info_cache(current_user["id"])
    _invalidate_travel_info_cache(target["id"])
    return {"message": f"Airport #{req.slot} in {req.state} transferred to {target.get('username', target_username)}"}


async def airport_sell_on_trade(req: AirportSellRequest, current_user: dict = Depends(get_current_user)):
    if req.state not in STATES:
        raise HTTPException(status_code=400, detail="Invalid state")
    if req.slot < 1 or req.slot > AIRPORT_SLOTS_PER_STATE:
        raise HTTPException(status_code=400, detail=f"Slot must be 1–{AIRPORT_SLOTS_PER_STATE}")
    if req.points < 0:
        raise HTTPException(status_code=400, detail="Points must be non-negative")
    doc = await db.airport_ownership.find_one({"state": req.state, "slot": req.slot}, {"_id": 0})
    if not doc or doc.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this airport slot")
    listing = {
        "_id": ObjectId(),
        "type": "airport",
        "state": req.state,
        "slot": req.slot,
        "location": f"{req.state} #{req.slot}",
        "name": f"Airport #{req.slot} ({req.state})",
        "owner_id": current_user["id"],
        "owner_username": current_user.get("username", "Unknown"),
        "for_sale": True,
        "sale_price": req.points,
        "created_at": datetime.now(timezone.utc),
    }
    await db.properties.insert_one(listing)
    return {"message": f"Airport #{req.slot} in {req.state} listed for {req.points:,} points on Quick Trade"}


def register(router):
    router.add_api_route("/travel/status", get_travel_status, methods=["GET"])
    router.add_api_route("/travel/info", get_travel_info, methods=["GET"])
    router.add_api_route("/travel", travel, methods=["POST"])
    router.add_api_route("/travel/buy-airmiles", buy_extra_airmiles, methods=["POST"])
    router.add_api_route("/airports", list_airports, methods=["GET"])
    router.add_api_route("/airports/claim", claim_airport, methods=["POST"])
    router.add_api_route("/airports/set-price", set_airport_price, methods=["POST"])
    router.add_api_route("/airports/transfer", airport_transfer, methods=["POST"])
    router.add_api_route("/airports/sell-on-trade", airport_sell_on_trade, methods=["POST"])
