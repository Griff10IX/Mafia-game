# GTA endpoints: options, attempt, garage, melt
import asyncio
import logging
from datetime import datetime, timezone, timedelta
import random
import uuid
from typing import List, Optional, Dict
from fastapi import Depends, HTTPException, Query
from bson.objectid import ObjectId
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# GTA options and request/response models
# ---------------------------------------------------------------------------

# Cooldowns: min 30s (easiest), best option 3-4 min (legendary). Unlock by rank.
GTA_OPTIONS = [
    {"id": "easy", "name": "Street Parking", "success_rate": 0.85, "jail_time": 10, "difficulty": 1, "cooldown": 30, "min_rank": 4},
    {"id": "medium", "name": "Residential Area", "success_rate": 0.65, "jail_time": 20, "difficulty": 2, "cooldown": 90, "min_rank": 5},
    {"id": "hard", "name": "Downtown District", "success_rate": 0.45, "jail_time": 35, "difficulty": 3, "cooldown": 150, "min_rank": 6},
    {"id": "expert", "name": "Luxury Garage", "success_rate": 0.30, "jail_time": 50, "difficulty": 4, "cooldown": 210, "min_rank": 7},
    {"id": "legendary", "name": "Private Estate", "success_rate": 0.18, "jail_time": 60, "difficulty": 5, "cooldown": 240, "min_rank": 8},
]


class GTAAttemptRequest(BaseModel):
    option_id: str


class GTAMeltRequest(BaseModel):
    car_ids: List[str]
    action: str  # "bullets" or "cash"


class GTABuyCarRequest(BaseModel):
    car_id: str


class GTAListCarRequest(BaseModel):
    user_car_id: str
    price: int


class GTADelistCarRequest(BaseModel):
    user_car_id: str


class GTABuyListedCarRequest(BaseModel):
    user_car_id: str


class GTARepairCarRequest(BaseModel):
    user_car_id: str


class GTAAttemptResponse(BaseModel):
    success: bool
    message: str
    car: Optional[Dict]
    jailed: bool
    jail_until: Optional[str]
    rank_points_earned: int
    progress_after: Optional[int] = None


# ---------------------------------------------------------------------------
# Progress and messages
# ---------------------------------------------------------------------------

from server import (
    db,
    get_current_user,
    get_rank_info,
    get_effective_event,
    maybe_process_rank_up,
    RANKS,
    CARS,
    TRAVEL_TIMES,
    DEFAULT_GARAGE_BATCH_LIMIT,
)
from routers.objectives import update_objectives_progress


# Progress bar: 10-92%. Success +3-5%. Fail -1-3%; once hit 92%, floor is 77% (same as crimes)
GTA_PROGRESS_MIN = 10
GTA_PROGRESS_MAX = 92
GTA_PROGRESS_GAIN_MIN = 3
GTA_PROGRESS_GAIN_MAX = 5
GTA_PROGRESS_DROP_PER_FAIL_MIN = 1
GTA_PROGRESS_DROP_PER_FAIL_MAX = 3
GTA_PROGRESS_MAX_DROP_FROM_PEAK = 15

# On GTA failure, this chance you get caught (jail); otherwise you get away with no car
GTA_CAUGHT_CHANCE = 0.5

GTA_SUCCESS_MESSAGES = [
    "Success! You stole a {car_name}!",
    "Clean getaway. You got the {car_name}!",
    "No heat. The {car_name} is yours.",
    "Smooth run. You stole a {car_name}!",
    "Done. You're rolling in a {car_name}.",
    "Score. The {car_name} is in your garage.",
    "Nice work. You nabbed a {car_name}!",
    "The take: a {car_name}. You're clear.",
    "You got away with the {car_name}!",
    "Wheels acquired. {car_name}.",
]

GTA_FAIL_CAUGHT_MESSAGES = [
    "Busted! The cops got you — {seconds}s in the slammer.",
    "Caught red-handed. {seconds}s behind bars.",
    "The feds were waiting. Enjoy the next {seconds}s in jail.",
    "You didn't make the getaway. {seconds}s in the clink.",
    "Wrong car, wrong cop. {seconds}s to think it over.",
    "They ran your plates. See you in {seconds}s.",
    "The heat was on your tail. {seconds}s in the can.",
    "Blown cover. {seconds}s in the joint.",
    "No clean escape this time. {seconds}s in lockup.",
    "They had the road blocked. {seconds}s in the slammer.",
]

GTA_FAIL_ESCAPED_MESSAGES = [
    "No score — you had to ditch the car and run. At least you're free.",
    "The job fell through. You got away clean, but empty-handed.",
    "Wrong mark. You bailed in time; no car, no cuffs.",
    "Something spooked you. You walked away with nothing.",
    "The engine wouldn't turn over. You slipped out before the heat came.",
    "Bad timing. You left the ride and melted into the crowd.",
    "No dice this time. You got away — next run might be the one.",
    "The target was hot. You skipped the take and stayed free.",
    "Clean getaway, but no wheels. Live to steal another day.",
    "You had to abort. No car, but no jail either.",
]


def _gta_progress_from_attempts(gta_attempts: int) -> int:
    """Migrate old attempts-based progress to bar value (10-92)."""
    if gta_attempts < 100:
        return 10
    elif gta_attempts < 300:
        return 25
    elif gta_attempts < 600:
        return 40
    elif gta_attempts < 1200:
        return 55
    elif gta_attempts < 2500:
        return 70
    elif gta_attempts < 5000:
        return 82
    else:
        return 92


async def get_gta_options(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    user_rank, _ = get_rank_info(current_user.get("rank_points", 0))
    option_ids = [o["id"] for o in GTA_OPTIONS]
    cooldown_doc, user_gta_list = await asyncio.gather(
        db.gta_cooldowns.find_one(
            {"user_id": current_user["id"]},
            {"_id": 0, "cooldown_until": 1},
        ),
        db.user_gta.find(
            {"user_id": current_user["id"], "option_id": {"$in": option_ids}},
            {"_id": 0, "option_id": 1, "attempts": 1, "successes": 1, "progress": 1, "progress_max": 1},
        ).to_list(len(option_ids)),
    )
    global_cooldown_until = None
    if cooldown_doc:
        until = datetime.fromisoformat(cooldown_doc["cooldown_until"])
        if until > now:
            global_cooldown_until = cooldown_doc["cooldown_until"]
    user_gta_by_id = {ug["option_id"]: ug for ug in user_gta_list}
    result = []
    for opt in GTA_OPTIONS:
        user_gta = user_gta_by_id.get(opt["id"])
        attempts = int((user_gta or {}).get("attempts", 0) or 0)
        successes = int((user_gta or {}).get("successes", 0) or 0)
        stored = (user_gta or {}).get("progress")
        progress = (
            int(stored)
            if stored is not None and GTA_PROGRESS_MIN <= int(stored) <= GTA_PROGRESS_MAX
            else _gta_progress_from_attempts(attempts)
        )
        
        row = dict(opt)
        row["unlocked"] = user_rank >= opt["min_rank"]
        row["min_rank_name"] = next(
            (r["name"] for r in RANKS if r["id"] == opt["min_rank"]),
            f"Rank {opt['min_rank']}",
        )
        row["cooldown_until"] = global_cooldown_until
        row["attempts"] = attempts
        row["successes"] = successes
        row["progress"] = progress
        result.append(row)
    return result


async def _attempt_gta_impl(option_id: str, current_user: dict) -> GTAAttemptResponse:
    """Run one GTA attempt. Caller must ensure option exists, user rank OK, and cooldown passed. Used by route and auto_rank."""
    option = next((o for o in GTA_OPTIONS if o["id"] == option_id), None)
    if not option:
        raise ValueError(f"Invalid GTA option: {option_id}")
    now = datetime.now(timezone.utc)
    cooldown_doc = await db.gta_cooldowns.find_one(
        {"user_id": current_user["id"]},
        {"_id": 0, "cooldown_until": 1},
    )
    if cooldown_doc:
        until = datetime.fromisoformat(cooldown_doc["cooldown_until"])
        if until > now:
            secs = int((until - now).total_seconds())
            raise HTTPException(
                status_code=400, detail=f"GTA cooldown: try again in {secs}s"
            )
    
    # PROGRESS BAR: 10-92%. Success +3-5%. Fail -1-3%; once hit 92%, floor 77%
    user_gta = await db.user_gta.find_one(
        {"user_id": current_user["id"], "option_id": option["id"]},
        {"_id": 0},
    )
    gta_attempts = int((user_gta or {}).get("attempts", 0) or 0)
    stored = (user_gta or {}).get("progress")
    progress_max = (user_gta or {}).get("progress_max")
    progress = (
        int(stored)
        if stored is not None and GTA_PROGRESS_MIN <= int(stored) <= GTA_PROGRESS_MAX
        else _gta_progress_from_attempts(gta_attempts)
    )
    if progress_max is not None:
        progress_max = int(progress_max)
    else:
        progress_max = max(progress, _gta_progress_from_attempts(gta_attempts))
    
    ev = await get_effective_event()
    success_rate = progress / 100.0
    gta_rate = success_rate * ev.get("gta_success", 1.0)
    success = random.random() < min(1.0, gta_rate)
    
    if success:
        gain = random.randint(GTA_PROGRESS_GAIN_MIN, GTA_PROGRESS_GAIN_MAX)
        progress_after = min(GTA_PROGRESS_MAX, progress + gain)
        progress_max = max(progress_max, progress_after)
    else:
        drop = random.randint(
            GTA_PROGRESS_DROP_PER_FAIL_MIN,
            GTA_PROGRESS_DROP_PER_FAIL_MAX
        )
        floor = (
            max(GTA_PROGRESS_MIN, GTA_PROGRESS_MAX - GTA_PROGRESS_MAX_DROP_FROM_PEAK)
            if progress_max >= GTA_PROGRESS_MAX
            else GTA_PROGRESS_MIN
        )
        progress_after = max(floor, progress - drop)
    
    cooldown_until = now + timedelta(seconds=option["cooldown"])
    await db.gta_cooldowns.delete_many({"user_id": current_user["id"]})
    await db.gta_cooldowns.insert_one(
        {"user_id": current_user["id"], "cooldown_until": cooldown_until.isoformat()}
    )
    
    set_fields = {
        "last_attempted": now.isoformat(),
        "progress": progress_after,
    }
    if progress_max is not None:
        set_fields["progress_max"] = progress_max
    await db.user_gta.update_one(
        {"user_id": current_user["id"], "option_id": option["id"]},
        {"$set": set_fields, "$inc": {"attempts": 1, "successes": 1 if success else 0}},
        upsert=True,
    )
    
    if success:
        available_cars = [
            c
            for c in CARS
            if c["min_difficulty"] <= option["difficulty"]
            and c["rarity"] != "exclusive"
        ]
        if not available_cars:
            available_cars = [c for c in CARS if c["min_difficulty"] == 1]
        car = random.choice(available_cars)
        # Stolen car damage: 15–77% common; 0–14% uncommon but possible
        if random.random() < 0.08:
            damage_percent = random.randint(0, 14)
        else:
            damage_percent = random.randint(15, 77)
        rank_points_map = {
            "common": 5,
            "uncommon": 10,
            "rare": 20,
            "ultra_rare": 40,
            "legendary": 100,
        }
        rank_points = rank_points_map.get(car["rarity"], 5)
        rank_points = int(rank_points * ev.get("rank_points", 1.0))
        await db.user_cars.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": current_user["id"],
                "car_id": car["id"],
                "car_name": car["name"],
                "acquired_at": datetime.now(timezone.utc).isoformat(),
                "damage_percent": damage_percent,
            }
        )
        rp_before = int(current_user.get("rank_points") or 0)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"money": car["value"], "rank_points": rank_points, "total_gta": 1}},
        )
        try:
            await maybe_process_rank_up(current_user["id"], rp_before, rank_points, current_user.get("username", ""))
        except Exception as e:
            logger.exception("Rank-up notification (GTA): %s", e)
        try:
            await update_objectives_progress(current_user["id"], "gta", 1)
        except Exception:
            pass
        msg = random.choice(GTA_SUCCESS_MESSAGES).format(car_name=car["name"])
        return GTAAttemptResponse(
            success=True,
            message=msg,
            car=car,
            jailed=False,
            jail_until=None,
            rank_points_earned=rank_points,
            progress_after=progress_after,
        )
    # Failure: sometimes caught (jail), sometimes get away (no car, no jail)
    caught = random.random() < GTA_CAUGHT_CHANCE
    if caught:
        jail_until = datetime.now(timezone.utc) + timedelta(seconds=option["jail_time"])
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"in_jail": True, "jail_until": jail_until.isoformat()}},
        )
        fail_msg = random.choice(GTA_FAIL_CAUGHT_MESSAGES).format(seconds=option["jail_time"])
        return GTAAttemptResponse(
            success=False,
            message=fail_msg,
            car=None,
            jailed=True,
            jail_until=jail_until.isoformat(),
            rank_points_earned=0,
            progress_after=progress_after,
        )
    fail_msg = random.choice(GTA_FAIL_ESCAPED_MESSAGES)
    return GTAAttemptResponse(
        success=False,
        message=fail_msg,
        car=None,
        jailed=False,
        jail_until=None,
        rank_points_earned=0,
        progress_after=progress_after,
    )


async def attempt_gta(
    request: GTAAttemptRequest, current_user: dict = Depends(get_current_user)
):
    if current_user.get("in_jail"):
        jail_time = datetime.fromisoformat(current_user["jail_until"])
        if jail_time > datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="You are in jail!")
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"in_jail": False, "jail_until": None}},
        )
    option = next((o for o in GTA_OPTIONS if o["id"] == request.option_id), None)
    if not option:
        raise HTTPException(status_code=404, detail="Invalid GTA option")
    rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
    if rank_id < option["min_rank"]:
        rank_name = next(
            (r["name"] for r in RANKS if r["id"] == option["min_rank"]),
            f"Rank {option['min_rank']}",
        )
        raise HTTPException(
            status_code=403,
            detail=f"Requires {rank_name} (rank {option['min_rank']})",
        )
    now = datetime.now(timezone.utc)
    cooldown_doc = await db.gta_cooldowns.find_one(
        {"user_id": current_user["id"]},
        {"_id": 0, "cooldown_until": 1},
    )
    if cooldown_doc:
        until = datetime.fromisoformat(cooldown_doc["cooldown_until"])
        if until > now:
            secs = int((until - now).total_seconds())
            raise HTTPException(
                status_code=400, detail=f"GTA cooldown: try again in {secs}s"
            )
    result = await _attempt_gta_impl(request.option_id, current_user)
    now = datetime.now(timezone.utc)
    success = getattr(result, "success", False)
    profit = int((result.car.get("value", 0) or 0)) if (getattr(result, "car", None) and success) else 0
    await db.gta_events.insert_one(
        {"user_id": current_user["id"], "at": now, "success": success, "profit": profit}
    )
    return result


async def get_gta_stats(current_user: dict = Depends(get_current_user)):
    """Return GTAs today/week, successful GTAs, profit today / 24h / week."""
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    last_24h_start = now - timedelta(hours=24)
    seven_days_start = now - timedelta(days=7)
    pipeline = [
        {"$match": {"user_id": current_user["id"]}},
        {
            "$facet": {
                "today": [
                    {"$match": {"at": {"$gte": today_start}}},
                    {"$group": {"_id": None, "count": {"$sum": 1}, "successes": {"$sum": {"$cond": ["$success", 1, 0]}}, "profit": {"$sum": "$profit"}}},
                ],
                "last_24h": [
                    {"$match": {"at": {"$gte": last_24h_start}}},
                    {"$group": {"_id": None, "profit": {"$sum": "$profit"}}},
                ],
                "last_7_days": [
                    {"$match": {"at": {"$gte": seven_days_start}}},
                    {"$group": {"_id": None, "count": {"$sum": 1}, "successes": {"$sum": {"$cond": ["$success", 1, 0]}}, "profit": {"$sum": "$profit"}}},
                ],
            }
        },
    ]
    cursor = db.gta_events.aggregate(pipeline)
    result = await cursor.to_list(1)
    doc = result[0] if result else {}
    def _today():
        arr = doc.get("today") or []
        return arr[0] if arr else {"count": 0, "successes": 0, "profit": 0}
    def _24h():
        arr = doc.get("last_24h") or []
        return int(arr[0]["profit"]) if arr else 0
    def _week():
        arr = doc.get("last_7_days") or []
        return arr[0] if arr else {"count": 0, "successes": 0, "profit": 0}
    t, w = _today(), _week()
    return {
        "count_today": int(t.get("count", 0)),
        "count_week": int(w.get("count", 0)),
        "success_today": int(t.get("successes", 0)),
        "success_week": int(w.get("successes", 0)),
        "profit_today": int(t.get("profit", 0)),
        "profit_24h": _24h(),
        "profit_week": int(w.get("profit", 0)),
    }


MELT_BULLETS_COOLDOWN_SECONDS = 45  # Only 1 car can be melted for bullets every 45s. Scrap has no cooldown.


async def get_garage(current_user: dict = Depends(get_current_user)):
    cars = await db.user_cars.find({"user_id": current_user["id"]}).to_list(1000)
    user_doc = await db.users.find_one(
        {"id": current_user["id"]},
        {"_id": 0, "melt_bullets_cooldown_until": 1},
    )
    melt_bullets_cooldown_until = user_doc.get("melt_bullets_cooldown_until") if user_doc else None
    car_details = []
    for user_car in cars:
        car_id = user_car.get("car_id")
        if not car_id:
            continue
        car_info = next((c for c in CARS if c["id"] == car_id), None)
        if car_info:
            user_car_id = user_car.get("id") or str(user_car.get("_id", ""))
            entry = {
                "user_car_id": user_car_id,
                "car_id": car_id,
                "car_name": user_car.get("car_name"),
                "acquired_at": user_car.get("acquired_at"),
                "damage_percent": min(100, max(0, float(user_car.get("damage_percent", 0)))),
                **car_info,
            }
            if user_car.get("listed_for_sale"):
                entry["listed_for_sale"] = True
                entry["sale_price"] = user_car.get("sale_price")
                entry["listed_at"] = user_car.get("listed_at")
            car_details.append(entry)
    return {"cars": car_details, "melt_bullets_cooldown_until": melt_bullets_cooldown_until}


async def get_recent_stolen(current_user: dict = Depends(get_current_user)):
    """Last 10 cars stolen (by acquired_at desc) for the GTA page. Same shape as garage entries."""
    cursor = (
        db.user_cars.find({"user_id": current_user["id"]})
        .sort("acquired_at", -1)
        .limit(10)
    )
    cars = await cursor.to_list(10)
    car_details = []
    for user_car in cars:
        car_id = user_car.get("car_id")
        if not car_id:
            continue
        car_info = next((c for c in CARS if c["id"] == car_id), None)
        if car_info:
            user_car_id = user_car.get("id") or str(user_car.get("_id", ""))
            entry = {
                "user_car_id": user_car_id,
                "car_id": car_id,
                "car_name": user_car.get("car_name"),
                "acquired_at": user_car.get("acquired_at"),
                "damage_percent": min(100, max(0, float(user_car.get("damage_percent", 0)))),
                **car_info,
            }
            car_details.append(entry)
    return {"cars": car_details}


def _parse_melt_cooldown(iso_str):
    if not iso_str:
        return None
    if hasattr(iso_str, "year"):
        return iso_str
    try:
        s = str(iso_str).strip().replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except Exception:
        return None


async def melt_cars(
    request: GTAMeltRequest, current_user: dict = Depends(get_current_user)
):
    if not request.car_ids:
        raise HTTPException(status_code=400, detail="No cars selected")
    now = datetime.now(timezone.utc)

    if request.action == "bullets":
        # Bullets: up to garage_batch_limit cars per request; then 45s cooldown per car melted
        user_doc = await db.users.find_one(
            {"id": current_user["id"]},
            {"_id": 0, "melt_bullets_cooldown_until": 1},
        )
        cooldown_until = _parse_melt_cooldown((user_doc or {}).get("melt_bullets_cooldown_until"))
        if cooldown_until and now < cooldown_until:
            secs = int((cooldown_until - now).total_seconds())
            raise HTTPException(
                status_code=400,
                detail=f"Melt for bullets on cooldown. Next melt in {secs}s.",
            )
        batch_limit = current_user.get("garage_batch_limit", DEFAULT_GARAGE_BATCH_LIMIT)
        if len(request.car_ids) > batch_limit:
            raise HTTPException(
                status_code=400,
                detail=f"You can only melt up to {batch_limit} cars at a time. Upgrade your limit in the Store.",
            )
        limit = min(batch_limit, len(request.car_ids))
    else:
        # Scrap (cash): no cooldown, batch limit applies
        limit = current_user.get("garage_batch_limit", DEFAULT_GARAGE_BATCH_LIMIT)
        if len(request.car_ids) > limit:
            raise HTTPException(
                status_code=400,
                detail=f"You can only scrap up to {limit} cars at a time. Upgrade your limit in the Store.",
            )
        limit = len(request.car_ids)

    total_value = 0
    total_bullets = 0
    deleted_count = 0
    processed = 0
    for car_id in request.car_ids:
        if processed >= limit:
            break
        user_car = await db.user_cars.find_one(
            {"user_id": current_user["id"], "id": car_id}
        )
        if not user_car:
            try:
                user_car = await db.user_cars.find_one(
                    {"user_id": current_user["id"], "_id": ObjectId(car_id)}
                )
            except Exception:
                user_car = None
        if not user_car:
            user_car = await db.user_cars.find_one(
                {"user_id": current_user["id"], "car_id": car_id}
            )
        if user_car:
            if user_car.get("listed_for_sale"):
                continue  # cannot melt/scrap a listed car; must delist first
            model_id = user_car["car_id"]
            car_info = next((c for c in CARS if c["id"] == model_id), None)
            if car_info:
                if request.action == "bullets":
                    total_bullets += int(car_info["value"] / 10)
                else:
                    total_value += int(car_info["value"] * 0.5)
                if user_car.get("_id") is not None:
                    await db.user_cars.delete_one({"_id": user_car["_id"]})
                elif user_car.get("id") is not None:
                    await db.user_cars.delete_one(
                        {"user_id": current_user["id"], "id": user_car["id"]}
                    )
                else:
                    await db.user_cars.delete_one(
                        {
                            "user_id": current_user["id"],
                            "car_id": model_id,
                            "acquired_at": user_car.get("acquired_at"),
                        }
                    )
                deleted_count += 1
                processed += 1
    if deleted_count > 0:
        if request.action == "bullets":
            cooldown_seconds = MELT_BULLETS_COOLDOWN_SECONDS * deleted_count
            cooldown_until = now + timedelta(seconds=cooldown_seconds)
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": {"bullets": total_bullets}, "$set": {"melt_bullets_cooldown_until": cooldown_until.isoformat()}},
            )
            return {
                "success": True,
                "melted_count": deleted_count,
                "total_bullets": total_bullets,
                "message": f"Melted {deleted_count} car(s) for {total_bullets} bullets. Next melt in {cooldown_seconds}s.",
                "melt_bullets_cooldown_until": cooldown_until.isoformat(),
            }
        await db.users.update_one(
            {"id": current_user["id"]}, {"$inc": {"money": total_value}}
        )
        return {
            "success": True,
            "scrapped_count": deleted_count,
            "total_value": total_value,
            "message": f"Scrapped {deleted_count} car(s) for ${total_value:,}",
        }
    return {"success": False, "message": "No cars were processed"}


# Dealer: buy cars for cash (price = value * multiplier). Custom and exclusive are not for sale.
# Dealer has limited stock per model; one document in dealer_stock = one car available. Replenishes over time.
DEALER_PRICE_MULTIPLIER = 1.2
DEALER_EXCLUDED_IDS = {"car_custom", "car20"}
DEALER_STOCK_MAX_PER_CAR = 2
DEALER_REPLENISH_INTERVAL_SECONDS = 2 * 3600  # 2 hours


async def _ensure_dealer_stock_seeded():
    """If dealer_stock is empty, seed 2 of each car (except excluded)."""
    n = await db.dealer_stock.count_documents({})
    if n > 0:
        return
    now = datetime.now(timezone.utc).isoformat()
    to_insert = []
    for c in CARS:
        if c.get("id") in DEALER_EXCLUDED_IDS:
            continue
        for _ in range(DEALER_STOCK_MAX_PER_CAR):
            to_insert.append({"car_id": c["id"], "added_at": now})
    if to_insert:
        await db.dealer_stock.insert_many(to_insert)


async def get_cars_for_sale(current_user: dict = Depends(get_current_user)):
    """List cars available to buy from the dealer (cash). One row per dealer stock slot. Excludes custom and exclusive."""
    await _ensure_dealer_stock_seeded()
    rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
    cursor = db.dealer_stock.find({}, {"_id": 1, "car_id": 1})
    slots = await cursor.to_list(5000)
    out = []
    for slot in slots:
        c = next((x for x in CARS if x.get("id") == slot.get("car_id")), None)
        if not c or c.get("id") in DEALER_EXCLUDED_IDS:
            continue
        price = int(c.get("value", 0) * DEALER_PRICE_MULTIPLIER)
        min_rank = c.get("min_difficulty", 1)
        out.append({
            **{k: v for k, v in c.items()},
            "dealer_price": price,
            "min_rank": min_rank,
            "can_buy": rank_id >= min_rank,
            "dealer_slot_id": str(slot["_id"]),
        })
    return {"cars": out}


async def buy_car(
    request: GTABuyCarRequest, current_user: dict = Depends(get_current_user)
):
    """Purchase one car from the dealer for cash. Removes one from dealer stock."""
    car_info = next((c for c in CARS if c.get("id") == request.car_id), None)
    if not car_info:
        raise HTTPException(status_code=400, detail="Car not found")
    if car_info.get("id") in DEALER_EXCLUDED_IDS:
        raise HTTPException(status_code=400, detail="That car is not for sale")
    # Remove one from dealer stock (so it disappears from listing)
    result = await db.dealer_stock.delete_one({"car_id": request.car_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=400, detail="That car is out of stock. Dealer restocks in 1–2 hours.")
    rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
    if rank_id < car_info.get("min_difficulty", 1):
        raise HTTPException(status_code=400, detail="Rank too low to buy this car")
    price = int(car_info.get("value", 0) * DEALER_PRICE_MULTIPLIER)
    if current_user.get("money", 0) < price:
        raise HTTPException(status_code=400, detail=f"Insufficient money. Need ${price:,}.")
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "car_id": request.car_id,
        "car_name": car_info.get("name"),
        "acquired_at": now.isoformat(),
        "damage_percent": 0,
    }
    await db.user_cars.insert_one(doc)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": -price}},
    )
    return {
        "success": True,
        "message": f"Purchased {car_info.get('name')} for ${price:,}",
        "car_id": request.car_id,
        "user_car_id": doc["id"],
    }


# ----- Player-to-player car marketplace (list your car, buy other players' cars) -----
async def get_marketplace_listings(current_user: dict = Depends(get_current_user)):
    """List cars that other players have listed for sale (cash). Excludes current user's own listings."""
    cursor = db.user_cars.find(
        {"listed_for_sale": True, "user_id": {"$ne": current_user["id"]}},
        {"_id": 1, "id": 1, "user_id": 1, "car_id": 1, "car_name": 1, "sale_price": 1, "listed_at": 1, "damage_percent": 1},
    ).sort("listed_at", -1)
    listings = await cursor.to_list(200)
    out = []
    for uc in listings:
        car_info = next((c for c in CARS if c.get("id") == uc.get("car_id")), None)
        if not car_info:
            continue
        seller = await db.users.find_one({"id": uc["user_id"]}, {"_id": 0, "username": 1})
        listing_id = uc.get("id") or str(uc.get("_id", ""))
        out.append({
            "user_car_id": listing_id,
            "seller_id": uc["user_id"],
            "seller_username": seller.get("username", "?"),
            "car_id": uc.get("car_id"),
            "name": uc.get("car_name") or car_info.get("name"),
            "value": car_info.get("value", 0),
            "rarity": car_info.get("rarity", "common"),
            "image": car_info.get("image"),
            "sale_price": uc.get("sale_price", 0),
            "listed_at": uc.get("listed_at"),
            "damage_percent": min(100, max(0, float(uc.get("damage_percent", 0)))),
        })
    return {"listings": out}


async def list_car(
    request: GTAListCarRequest, current_user: dict = Depends(get_current_user)
):
    """List one of your cars for sale on the marketplace (other players can buy for cash)."""
    if request.price <= 0:
        raise HTTPException(status_code=400, detail="Price must be positive")
    user_car = await db.user_cars.find_one(
        {"user_id": current_user["id"], "id": request.user_car_id}
    )
    if not user_car:
        try:
            user_car = await db.user_cars.find_one(
                {"user_id": current_user["id"], "_id": ObjectId(request.user_car_id)}
            )
        except Exception:
            user_car = None
    if not user_car:
        raise HTTPException(status_code=404, detail="Car not found in your garage")
    if user_car.get("listed_for_sale"):
        raise HTTPException(status_code=400, detail="Car is already listed")
    now = datetime.now(timezone.utc).isoformat()
    if user_car.get("_id") is not None:
        q = {"_id": user_car["_id"]}
    else:
        q = {"user_id": current_user["id"], "id": user_car.get("id")}
    await db.user_cars.update_one(q, {"$set": {"listed_for_sale": True, "sale_price": request.price, "listed_at": now}})
    return {"message": f"Listed for ${request.price:,}", "sale_price": request.price}


async def delist_car(
    request: GTADelistCarRequest, current_user: dict = Depends(get_current_user)
):
    """Remove your car from the marketplace."""
    user_car = await db.user_cars.find_one(
        {"user_id": current_user["id"], "id": request.user_car_id}
    )
    if not user_car:
        try:
            user_car = await db.user_cars.find_one(
                {"user_id": current_user["id"], "_id": ObjectId(request.user_car_id)}
            )
        except Exception:
            user_car = None
    if not user_car:
        raise HTTPException(status_code=404, detail="Car not found in your garage")
    if not user_car.get("listed_for_sale"):
        raise HTTPException(status_code=400, detail="Car is not listed")
    if user_car.get("_id") is not None:
        q = {"_id": user_car["_id"]}
    else:
        q = {"user_id": current_user["id"], "id": user_car.get("id")}
    await db.user_cars.update_one(q, {"$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""}})
    return {"message": "Car delisted"}


async def buy_listed_car(
    request: GTABuyListedCarRequest, current_user: dict = Depends(get_current_user)
):
    """Buy a car listed by another player (pay cash to seller)."""
    buyer_id = current_user["id"]
    user_car = await db.user_cars.find_one(
        {"id": request.user_car_id, "listed_for_sale": True}
    )
    if not user_car:
        try:
            user_car = await db.user_cars.find_one(
                {"_id": ObjectId(request.user_car_id), "listed_for_sale": True}
            )
        except Exception:
            user_car = None
    if not user_car:
        raise HTTPException(status_code=404, detail="Listing not found or no longer available")
    seller_id = user_car.get("user_id")
    if seller_id == buyer_id:
        raise HTTPException(status_code=400, detail="Cannot buy your own listing")
    price = int(user_car.get("sale_price") or 0)
    if price <= 0:
        raise HTTPException(status_code=400, detail="Invalid listing")
    buyer = await db.users.find_one({"id": buyer_id})
    if not buyer or buyer.get("money", 0) < price:
        raise HTTPException(status_code=400, detail=f"Insufficient money. Need ${price:,}.")
    car_info = next((c for c in CARS if c.get("id") == user_car.get("car_id")), None)
    car_name = (car_info or {}).get("name") or user_car.get("car_name") or "Car"
    if user_car.get("_id") is not None:
        q = {"_id": user_car["_id"]}
    else:
        q = {"id": user_car.get("id")}
    await db.user_cars.update_one(
        q,
        {"$set": {"user_id": buyer_id}, "$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""}},
    )
    await db.users.update_one({"id": buyer_id}, {"$inc": {"money": -price}})
    await db.users.update_one({"id": seller_id}, {"$inc": {"money": price}})
    return {
        "message": f"Purchased {car_name} from seller for ${price:,}",
        "car_id": user_car.get("car_id"),
        "user_car_id": user_car.get("id"),
    }


# Repair cost = (damage% / 100) * (car value * 0.2) — 100% damage = 20% of value
REPAIR_COST_FRACTION = 0.2


async def repair_car(
    request: GTARepairCarRequest, current_user: dict = Depends(get_current_user)
):
    """Repair a car in the garage (pay cash to set damage to 0)."""
    user_car = await db.user_cars.find_one(
        {"user_id": current_user["id"], "id": request.user_car_id}
    )
    if not user_car:
        try:
            user_car = await db.user_cars.find_one(
                {"user_id": current_user["id"], "_id": ObjectId(request.user_car_id)}
            )
        except Exception:
            user_car = None
    if not user_car:
        raise HTTPException(status_code=404, detail="Car not found in your garage")
    damage = min(100, max(0, float(user_car.get("damage_percent", 0))))
    if damage <= 0:
        return {"message": "No repair needed", "damage_percent": 0}
    car_info = next((c for c in CARS if c.get("id") == user_car.get("car_id")), None)
    if not car_info:
        raise HTTPException(status_code=400, detail="Car type not found")
    value = int(car_info.get("value", 0))
    cost = max(1, round((damage / 100) * value * REPAIR_COST_FRACTION))
    if current_user.get("money", 0) < cost:
        raise HTTPException(status_code=400, detail=f"Insufficient money. Repair costs ${cost:,}.")
    if user_car.get("_id") is not None:
        q = {"_id": user_car["_id"]}
    else:
        q = {"user_id": current_user["id"], "id": user_car.get("id")}
    await db.user_cars.update_one(q, {"$set": {"damage_percent": 0}})
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -cost}})
    return {
        "message": f"Repaired for ${cost:,}. Damage 0%.",
        "damage_percent": 0,
        "cost": cost,
    }


async def get_car(car_id: str, current_user: dict = Depends(get_current_user)):
    """Return full car details by id (for profile page)."""
    car = next((c for c in CARS if c.get("id") == car_id), None)
    if not car:
        raise HTTPException(status_code=404, detail="Car not found")
    out = dict(car)
    # Add travel_time (seconds) so profile can show how long this car takes to travel
    rarity = car.get("rarity") or "common"
    if car.get("id") == "car_custom":
        out["travel_time"] = TRAVEL_TIMES.get("custom", 20)
    else:
        out["travel_time"] = TRAVEL_TIMES.get(rarity, 45)
    return out


async def get_view_car(
    id: str = Query(..., alias="id", description="Personal car instance id (user_car_id)"),
    current_user: dict = Depends(get_current_user),
):
    """Return a specific car instance by its personal id (user_car_id). Own car: full details. Others: only if listed for sale."""
    user_car = await db.user_cars.find_one({"id": id})
    if not user_car:
        try:
            user_car = await db.user_cars.find_one({"_id": ObjectId(id)})
        except Exception:
            user_car = None
    if not user_car:
        raise HTTPException(status_code=404, detail="Car not found")
    car_info = next((c for c in CARS if c.get("id") == user_car.get("car_id")), None)
    if not car_info:
        raise HTTPException(status_code=404, detail="Car not found")
    owner_id = user_car.get("user_id")
    # Non-owners can only see a car by id when it's public: listed for sale (or later: displayed on profile)
    rarity = car_info.get("rarity") or "common"
    travel_time = TRAVEL_TIMES.get("custom", 20) if car_info.get("id") == "car_custom" else TRAVEL_TIMES.get(rarity, 45)
    damage_percent = min(100, max(0, float(user_car.get("damage_percent", 0))))
    name = user_car.get("car_name") or car_info.get("name")
    image = car_info.get("image")
    if user_car.get("car_id") == "car_custom" and user_car.get("custom_image_url"):
        image = user_car.get("custom_image_url")
    out = {
        **{k: v for k, v in car_info.items()},
        "user_car_id": user_car.get("id"),
        "name": name,
        "image": image,
        "damage_percent": damage_percent,
        "travel_time": travel_time,
        "value": car_info.get("value", 0),
    }
    if owner_id == current_user["id"]:
        out["owner"] = "you"
        out["listed_for_sale"] = bool(user_car.get("listed_for_sale"))
        out["sale_price"] = user_car.get("sale_price")
    else:
        if not user_car.get("listed_for_sale"):
            raise HTTPException(status_code=404, detail="Car not found")
        seller = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1})
        out["owner"] = "listing"
        out["seller_username"] = (seller or {}).get("username", "?")
        out["sale_price"] = user_car.get("sale_price")
        out["listed_for_sale"] = True
    return out


async def run_dealer_replenish_loop():
    """Every DEALER_REPLENISH_INTERVAL_SECONDS, top up dealer stock so each car_id has up to DEALER_STOCK_MAX_PER_CAR."""
    import server as srv
    await asyncio.sleep(60)  # delay first run after startup
    while True:
        try:
            db = srv.db
            await _ensure_dealer_stock_seeded()
            now = datetime.now(timezone.utc).isoformat()
            for c in CARS:
                if c.get("id") in DEALER_EXCLUDED_IDS:
                    continue
                car_id = c["id"]
                count = await db.dealer_stock.count_documents({"car_id": car_id})
                need = max(0, DEALER_STOCK_MAX_PER_CAR - count)
                if need > 0:
                    await db.dealer_stock.insert_many([{"car_id": car_id, "added_at": now} for _ in range(need)])
        except Exception as e:
            logger.exception("Dealer replenish loop: %s", e)
        await asyncio.sleep(DEALER_REPLENISH_INTERVAL_SECONDS)


def register(router):
    router.add_api_route("/gta/options", get_gta_options, methods=["GET"])
    router.add_api_route("/gta/car/{car_id}", get_car, methods=["GET"])
    router.add_api_route(
        "/gta/attempt",
        attempt_gta,
        methods=["POST"],
        response_model=GTAAttemptResponse,
    )
    router.add_api_route("/gta/stats", get_gta_stats, methods=["GET"])
    router.add_api_route("/gta/garage", get_garage, methods=["GET"])
    router.add_api_route("/gta/recent-stolen", get_recent_stolen, methods=["GET"])
    router.add_api_route("/gta/melt", melt_cars, methods=["POST"])
    router.add_api_route("/gta/cars-for-sale", get_cars_for_sale, methods=["GET"])
    router.add_api_route("/gta/buy-car", buy_car, methods=["POST"])
    router.add_api_route("/gta/marketplace", get_marketplace_listings, methods=["GET"])
    router.add_api_route("/gta/list-car", list_car, methods=["POST"])
    router.add_api_route("/gta/delist-car", delist_car, methods=["POST"])
    router.add_api_route("/gta/buy-listed-car", buy_listed_car, methods=["POST"])
    router.add_api_route("/gta/repair-car", repair_car, methods=["POST"])
    router.add_api_route("/gta/view-car", get_view_car, methods=["GET"])