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
    GTA_OPTIONS,
    DEFAULT_GARAGE_BATCH_LIMIT,
    GTAAttemptRequest,
    GTAAttemptResponse,
    GTAMeltRequest,
)


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
        row = dict(opt)
        row["unlocked"] = user_rank >= opt["min_rank"]
        row["min_rank_name"] = next(
            (r["name"] for r in RANKS if r["id"] == opt["min_rank"]),
            f"Rank {opt['min_rank']}",
        )
        row["cooldown_until"] = global_cooldown_until
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
    ev = await get_effective_event()
    gta_rate = option["success_rate"] * ev.get("gta_success", 1.0)
    success = random.random() < min(1.0, gta_rate)
    cooldown_until = now + timedelta(seconds=option["cooldown"])
    await db.gta_cooldowns.delete_many({"user_id": current_user["id"]})
    await db.gta_cooldowns.insert_one(
        {"user_id": current_user["id"], "cooldown_until": cooldown_until.isoformat()}
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
        return GTAAttemptResponse(
            success=True,
            message=f"Success! You stole a {car['name']}!",
            car=car,
            jailed=False,
            jail_until=None,
            rank_points_earned=rank_points,
        )
    jail_until = datetime.now(timezone.utc) + timedelta(seconds=option["jail_time"])
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"in_jail": True, "jail_until": jail_until.isoformat()}},
    )
    return GTAAttemptResponse(
        success=False,
        message=f"Caught! You're going to jail for {option['jail_time']} seconds.",
        car=None,
        jailed=True,
        jail_until=jail_until.isoformat(),
        rank_points_earned=0,
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
    return dict(car)


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
