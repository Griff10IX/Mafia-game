# GTA endpoints: options, attempt, garage, melt
from datetime import datetime, timezone, timedelta
import random
import uuid
from fastapi import Depends, HTTPException
from bson.objectid import ObjectId

from server import (
    db,
    get_current_user,
    get_rank_info,
    get_effective_event,
    RANKS,
    CARS,
    TRAVEL_TIMES,
    GTA_OPTIONS,
    DEFAULT_GARAGE_BATCH_LIMIT,
    update_objectives_progress,
    GTAAttemptRequest,
    GTAAttemptResponse,
    GTAMeltRequest,
)


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
    cooldown_doc = await db.gta_cooldowns.find_one(
        {"user_id": current_user["id"]},
        {"_id": 0, "cooldown_until": 1},
    )
    global_cooldown_until = None
    if cooldown_doc:
        until = datetime.fromisoformat(cooldown_doc["cooldown_until"])
        if until > now:
            global_cooldown_until = cooldown_doc["cooldown_until"]
    result = []
    for opt in GTA_OPTIONS:
        user_gta = await db.user_gta.find_one(
            {"user_id": current_user["id"], "option_id": opt["id"]},
            {"_id": 0},
        )
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
            }
        )
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"money": car["value"], "rank_points": rank_points, "total_gta": 1}},
        )
        try:
            await update_objectives_progress(current_user["id"], "gta", 1)
        except Exception:
            pass
        return GTAAttemptResponse(
            success=True,
            message=f"Success! You stole a {car['name']}!",
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


async def get_garage(current_user: dict = Depends(get_current_user)):
    cars = await db.user_cars.find({"user_id": current_user["id"]}).to_list(1000)
    car_details = []
    for user_car in cars:
        car_id = user_car.get("car_id")
        if not car_id:
            continue
        car_info = next((c for c in CARS if c["id"] == car_id), None)
        if car_info:
            user_car_id = user_car.get("id") or str(user_car.get("_id", ""))
            car_details.append(
                {
                    "user_car_id": user_car_id,
                    "car_id": car_id,
                    "car_name": user_car.get("car_name"),
                    "acquired_at": user_car.get("acquired_at"),
                    **car_info,
                }
            )
    return {"cars": car_details}


async def melt_cars(
    request: GTAMeltRequest, current_user: dict = Depends(get_current_user)
):
    if not request.car_ids:
        raise HTTPException(status_code=400, detail="No cars selected")
    limit = current_user.get("garage_batch_limit", DEFAULT_GARAGE_BATCH_LIMIT)
    if len(request.car_ids) > limit:
        raise HTTPException(
            status_code=400,
            detail=f"You can only melt/scrap {limit} cars at a time. Upgrade your limit in the Store.",
        )
    total_value = 0
    total_bullets = 0
    deleted_count = 0
    for car_id in request.car_ids:
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
    if deleted_count > 0:
        if request.action == "bullets":
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": {"bullets": total_bullets}},
            )
            return {
                "success": True,
                "melted_count": deleted_count,
                "total_bullets": total_bullets,
                "message": f"Melted {deleted_count} car(s) for {total_bullets} bullets",
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


def register(router):
    router.add_api_route("/gta/options", get_gta_options, methods=["GET"])
    router.add_api_route("/gta/car/{car_id}", get_car, methods=["GET"])
    router.add_api_route(
        "/gta/attempt",
        attempt_gta,
        methods=["POST"],
        response_model=GTAAttemptResponse,
    )
    router.add_api_route("/gta/garage", get_garage, methods=["GET"])
    router.add_api_route("/gta/melt", melt_cars, methods=["POST"])
