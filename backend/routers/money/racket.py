# Racket (property extortion) endpoints: extort, targets
from datetime import datetime, timezone, timedelta
import secrets
_rng = secrets.SystemRandom()
from pydantic import BaseModel

from fastapi import Depends, HTTPException

from server import db, get_current_user, log_activity, maybe_process_rank_up, user_prestige_rank_mult
from utils.game_pass_season_rp import apply_season_rp_mirror_to_update, rank_points_in_update


class ProtectionRacketRequest(BaseModel):
    target_username: str
    property_id: str


PROPERTY_ATTACK_BASE_SUCCESS = 0.70
PROPERTY_ATTACK_LEVEL_PENALTY = 0.10  # per defender level
PROPERTY_ATTACK_MIN_SUCCESS = 0.10
PROPERTY_ATTACK_REVENUE_PCT = 0.25  # 25% of revenue (12h worth)
PROPERTY_ATTACK_HOURS = 12
RACKET_AUTO_RANK_TOKEN_CHANCE = 0.20
RACKET_AUTO_RANK_TOKEN_MIN = 1
RACKET_AUTO_RANK_TOKEN_MAX = 1


async def extort_property(request: ProtectionRacketRequest, current_user: dict = Depends(get_current_user)):
    # Case-insensitive username lookup
    import re
    username_pattern = re.compile("^" + re.escape(request.target_username.strip()) + "$", re.IGNORECASE)
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0, "money": 1, "id": 1, "username": 1, "is_dead": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    if target.get("is_dead"):
        raise HTTPException(status_code=400, detail="Target is dead")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot attack your own properties")
    target_property = await db.user_properties.find_one(
        {"user_id": target["id"], "property_id": request.property_id},
        {"_id": 0}
    )
    if not target_property:
        raise HTTPException(status_code=404, detail="Target doesn't own this property")
    prop = await db.properties.find_one({"id": request.property_id}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    now = datetime.now(timezone.utc)
    cooldown_threshold = (now - timedelta(hours=2)).isoformat()
    extortion_filter = {"extorter_id": current_user["id"], "target_id": target["id"], "property_id": request.property_id}
    claim = await db.extortions.find_one_and_update(
        {**extortion_filter,
         "$or": [
             {"timestamp": {"$exists": False}},
             {"timestamp": None},
             {"timestamp": {"$lte": cooldown_threshold}},
         ]},
        {"$set": {"timestamp": now.isoformat()}},
    )
    if claim is None:
        existing = await db.extortions.find_one(extortion_filter, {"_id": 1})
        if existing:
            raise HTTPException(status_code=400, detail="Must wait 2 hours between attacks on the same property")
        ins = await db.extortions.update_one(
            extortion_filter,
            {"$setOnInsert": {"timestamp": now.isoformat()}},
            upsert=True,
        )
        if ins.upserted_id is None:
            raise HTTPException(status_code=400, detail="Must wait 2 hours between attacks on the same property")
    defender_level = target_property.get("level", 1)
    success_chance = max(PROPERTY_ATTACK_MIN_SUCCESS, PROPERTY_ATTACK_BASE_SUCCESS - defender_level * PROPERTY_ATTACK_LEVEL_PENALTY)
    success = _rng.random() < success_chance
    if success:
        revenue_12h = prop["income_per_hour"] * defender_level * PROPERTY_ATTACK_HOURS
        extortion_amount = int(revenue_12h * PROPERTY_ATTACK_REVENUE_PCT)
        extortion_amount = max(1, extortion_amount)
        target_money = int(target.get("money", 0) or 0)
        if target_money < extortion_amount:
            extortion_amount = target_money
        rank_points = 0
        if extortion_amount > 0:
            result = await db.users.update_one(
                {"id": target["id"], "money": {"$gte": extortion_amount}},
                {"$inc": {"money": -extortion_amount}}
            )
            if result.modified_count == 0:
                extortion_amount = 0
            else:
                rank_points = _rng.randint(2, 6)
                rp_before = int(current_user.get("rank_points") or 0)
                racket_update = apply_season_rp_mirror_to_update(
                    {"$inc": {"money": extortion_amount, "rank_points": rank_points}},
                    user=current_user,
                )
                await db.users.update_one(
                    {"id": current_user["id"]},
                    racket_update,
                )
                try:
                    await maybe_process_rank_up(
                        current_user["id"],
                        rp_before,
                        rank_points_in_update(racket_update),
                        current_user.get("username", ""),
                        user_prestige_rank_mult(current_user),
                    )
                except Exception:
                    pass
        await db.extortions.update_one(
            extortion_filter,
            {"$set": {"amount": extortion_amount}},
        )
        auto_rank_tokens_awarded = 0
        if _rng.random() < RACKET_AUTO_RANK_TOKEN_CHANCE:
            auto_rank_tokens_awarded = _rng.randint(RACKET_AUTO_RANK_TOKEN_MIN, RACKET_AUTO_RANK_TOKEN_MAX)
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"auto_rank_2h_tokens": auto_rank_tokens_awarded}})
        await log_activity(current_user["id"], current_user.get("username", "?"), "racket_extort", {
            "target": target["username"], "property": prop["name"], "amount": extortion_amount, "auto_rank_2h_tokens": auto_rank_tokens_awarded,
        })
        bonus_msg = f" Bonus: +{auto_rank_tokens_awarded} Auto Rank 2h token." if auto_rank_tokens_awarded > 0 else ""
        return {
            "success": True,
            "message": f"Raid successful! You took ${extortion_amount:,} ({PROPERTY_ATTACK_REVENUE_PCT*100:.0f}% of revenue) from {target['username']}'s {prop['name']}.{bonus_msg}",
            "amount": extortion_amount,
            "rank_points_earned": rank_points,
            "auto_rank_2h_tokens_awarded": auto_rank_tokens_awarded,
        }
    return {
        "success": False,
        "message": f"Raid failed. {prop['name']} is well defended (level {defender_level}). Try again in 2 hours.",
        "amount": 0,
        "rank_points_earned": 0,
    }


async def get_racket_targets(current_user: dict = Depends(get_current_user)):
    users_with_properties = await db.user_properties.distinct("user_id")
    alive = {u["id"] for u in await db.users.find({"id": {"$in": users_with_properties}, "is_dead": {"$ne": True}}, {"_id": 0, "id": 1}).to_list(100)}
    targets = []
    for user_id in users_with_properties:
        if user_id == current_user["id"] or user_id not in alive:
            continue
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1, "current_state": 1})
        if not user:
            continue
        properties = await db.user_properties.find({"user_id": user_id}, {"_id": 0}).to_list(100)
        property_details = []
        for up in properties:
            prop = await db.properties.find_one({"id": up["property_id"]}, {"_id": 0})
            if prop:
                level = up.get("level", 1)
                revenue_12h = prop["income_per_hour"] * level * PROPERTY_ATTACK_HOURS
                potential_take = int(revenue_12h * PROPERTY_ATTACK_REVENUE_PCT)
                success_chance = max(PROPERTY_ATTACK_MIN_SUCCESS, PROPERTY_ATTACK_BASE_SUCCESS - level * PROPERTY_ATTACK_LEVEL_PENALTY)
                property_details.append({
                    "property_id": up["property_id"],
                    "property_name": prop["name"],
                    "level": level,
                    "potential_take": potential_take,
                    "success_chance_pct": int(round(success_chance * 100)),
                })
        if property_details:
            targets.append({
                "username": user["username"],
                "location": user.get("current_state") or "—",
                "properties": property_details,
            })
    return {"targets": targets[:25]}


def register(router):
    router.add_api_route("/racket/extort", extort_property, methods=["POST"])
    router.add_api_route("/racket/targets", get_racket_targets, methods=["GET"])
