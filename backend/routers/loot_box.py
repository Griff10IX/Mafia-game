# Loot box: 100 pieces = 1 open. Box gives 1-2, 1-3, or 1-5 prizes by rarity. Exclusives very rare (~2%); standard rewards common.
import logging
import random
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any, Tuple

from fastapi import Depends, HTTPException, Body
from pydantic import BaseModel

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import (
    db,
    get_current_user,
    send_notification,
    _is_admin,
    CARS,
    ARMOUR_BASE_BULLETS,
)
from routers.armoury import _invalidate_weapons_cache

logger = logging.getLogger(__name__)

LOOT_BOX_PIECES_PER_OPEN = 100
EXCLUSIVE_CHANCE = 0.02
EXCLUSIVE_CAP_PER_TYPE = 3
LOOT_EXCLUSIVE_WEAPON_ID = "weapon_loot"
LOOT_EXCLUSIVE_CAR_ID = "car21"
ARMOUR_LEVEL_6_NAME = "Steel Plate Bulletproof Vest (1922)"

GAME_SETTINGS_LOOT_COUNTS_KEY = "loot_exclusive_counts"
PERK_DURATION_HOURS = 24
GTA_RARE_DROP_PERK_ATTEMPTS = 100

# Box quality: how many prizes (1-2, 1-3, or 1-5). Weights: common 55%, uncommon 32%, rare 13%
BOX_QUALITY_ROLL = [
    ("common", 0.55, (1, 2)),
    ("uncommon", 0.32, (1, 3)),
    ("rare", 0.13, (1, 5)),
]

STANDARD_CAR_RARITIES = ("common", "uncommon", "rare", "ultra_rare")
STANDARD_REWARD_WEIGHTS = [
    ("points", 1),
    ("rank_points", 1),
    ("cash", 1),
    ("cars", 1),
    ("bullets", 1),
    ("perk", 1),
]
PERK_TYPES = [
    "property_income_10",
    "rp_10",
    "jail_bust_10",
    "airport_cost",
    "gta_rare_100",
]
PERK_LABELS = {
    "property_income_10": "10% property income for 24h",
    "rp_10": "10% extra RP for 24h",
    "jail_bust_10": "10% jail bust payout for 24h",
    "airport_cost": "Reduced airport cost for 24h",
    "gta_rare_100": "Increased GTA rare drop for 100 attempts",
}


async def _get_claimed_counts():
    doc = await db.game_settings.find_one({"key": GAME_SETTINGS_LOOT_COUNTS_KEY}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value") or {}
    return {
        "weapon": min(EXCLUSIVE_CAP_PER_TYPE, int(raw.get("weapon") or 0)),
        "car": min(EXCLUSIVE_CAP_PER_TYPE, int(raw.get("car") or 0)),
        "armour": min(EXCLUSIVE_CAP_PER_TYPE, int(raw.get("armour") or 0)),
        "property": min(EXCLUSIVE_CAP_PER_TYPE, int(raw.get("property") or 0)),
    }


async def _increment_claimed_count(typ: str):
    await db.game_settings.update_one(
        {"key": GAME_SETTINGS_LOOT_COUNTS_KEY},
        {
            "$inc": {f"value.{typ}": 1},
            "$setOnInsert": {"value": {"weapon": 0, "car": 0, "armour": 0, "property": 0}},
        },
        upsert=True,
    )


async def _user_has_loot_exclusive_weapon(user_id: str) -> bool:
    uw = await db.user_weapons.find_one({"user_id": user_id, "weapon_id": LOOT_EXCLUSIVE_WEAPON_ID, "quantity": {"$gte": 1}}, {"_id": 1})
    return uw is not None


async def _user_has_loot_exclusive_car(user_id: str) -> bool:
    uc = await db.user_cars.find_one({"user_id": user_id, "car_id": LOOT_EXCLUSIVE_CAR_ID}, {"_id": 1})
    return uc is not None


async def _user_has_armour_6(user_id: str) -> bool:
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "armour_level": 1, "armour_owned_level_max": 1})
    if not u:
        return False
    return int(u.get("armour_level") or 0) >= 6 or int(u.get("armour_owned_level_max") or 0) >= 6


async def _user_has_exclusive_property(user_id: str) -> bool:
    doc = await db.exclusive_properties.find_one({"owner_id": user_id}, {"_id": 1})
    return doc is not None


class LootBoxOpenRequest(BaseModel):
    tier: Optional[str] = "standard"


async def get_loot_box_status(current_user: dict = Depends(get_current_user)):
    pieces = int(current_user.get("loot_box_pieces") or 0)
    claimed = await _get_claimed_counts()
    return {
        "loot_box_pieces": pieces,
        "claimed_counts": claimed,
    }


def _roll_box_quality() -> Tuple[str, int]:
    """Roll box quality and return (quality_name, num_prizes). Prizes: common 1-2, uncommon 1-3, rare 1-5."""
    r = random.random()
    acc = 0.0
    for name, prob, (lo, hi) in BOX_QUALITY_ROLL:
        acc += prob
        if r <= acc:
            return (name, random.randint(lo, hi))
    name, _, (lo, hi) = BOX_QUALITY_ROLL[-1]
    return (name, random.randint(lo, hi))


async def open_loot_box(
    body: LootBoxOpenRequest = Body(default=LootBoxOpenRequest()),
    current_user: dict = Depends(get_current_user),
):
    cost = LOOT_BOX_PIECES_PER_OPEN
    user_id = current_user["id"]
    is_admin_test = _is_admin(current_user)
    if is_admin_test:
        res = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "loot_box_pieces": 1})
        new_pieces = int(res.get("loot_box_pieces") or 0) if res else 0
    else:
        res = await db.users.find_one_and_update(
            {"id": user_id, "loot_box_pieces": {"$gte": cost}},
            {"$inc": {"loot_box_pieces": -cost}},
            projection={"_id": 0, "id": 1, "loot_box_pieces": 1},
            return_document=True,
        )
        if not res:
            raise HTTPException(status_code=400, detail="Not enough loot box pieces (need 100)")
        new_pieces = int(res.get("loot_box_pieces") or 0)

    box_quality, num_prizes = _roll_box_quality()
    rewards: List[Dict[str, Any]] = []
    merged_inc: Dict[str, int] = {}
    merged_set: Dict[str, Any] = {}
    now = datetime.now(timezone.utc)

    for _ in range(num_prizes):
        claimed = await _get_claimed_counts()
        roll = random.random()
        if roll < EXCLUSIVE_CHANCE:
            available = []
            if claimed["weapon"] < EXCLUSIVE_CAP_PER_TYPE and not await _user_has_loot_exclusive_weapon(user_id):
                available.append("weapon")
            if claimed["car"] < EXCLUSIVE_CAP_PER_TYPE and not await _user_has_loot_exclusive_car(user_id):
                available.append("car")
            if claimed["armour"] < EXCLUSIVE_CAP_PER_TYPE and not await _user_has_armour_6(user_id):
                available.append("armour")
            if claimed["property"] < EXCLUSIVE_CAP_PER_TYPE and not await _user_has_exclusive_property(user_id):
                available.append("property")
            if available:
                typ = random.choice(available)
                if typ == "weapon":
                    await db.user_weapons.update_one(
                        {"user_id": user_id, "weapon_id": LOOT_EXCLUSIVE_WEAPON_ID},
                        {"$inc": {"quantity": 1}, "$set": {"acquired_at": now.isoformat()}},
                        upsert=True,
                    )
                    await _increment_claimed_count("weapon")
                    _invalidate_weapons_cache(user_id)
                    w = await db.weapons.find_one({"id": LOOT_EXCLUSIVE_WEAPON_ID}, {"_id": 0, "name": 1})
                    name = (w or {}).get("name") or "Colt Monitor"
                    new_claimed = await _get_claimed_counts()
                    if new_claimed["weapon"] >= EXCLUSIVE_CAP_PER_TYPE:
                        await send_notification(user_id, "Loot box", f"The last exclusive weapon ({name}) has been claimed!", "system")
                    rewards.append({"type": "weapon", "name": name, "id": LOOT_EXCLUSIVE_WEAPON_ID, "rarity": "loot_exclusive"})
                    continue
                if typ == "car":
                    car_info = next((c for c in CARS if c.get("id") == LOOT_EXCLUSIVE_CAR_ID), None)
                    if car_info:
                        await db.user_cars.insert_one({
                            "id": str(uuid.uuid4()),
                            "user_id": user_id,
                            "car_id": LOOT_EXCLUSIVE_CAR_ID,
                            "car_name": car_info.get("name", "1930 Cadillac V-16 Armored"),
                            "acquired_at": now.isoformat(),
                            "damage_percent": 0,
                        })
                        await _increment_claimed_count("car")
                        new_claimed = await _get_claimed_counts()
                        if new_claimed["car"] >= EXCLUSIVE_CAP_PER_TYPE:
                            await send_notification(user_id, "Loot box", f"The last exclusive car ({car_info.get('name')}) has been claimed!", "system")
                        rewards.append({
                            "type": "car",
                            "name": car_info.get("name"),
                            "id": LOOT_EXCLUSIVE_CAR_ID,
                            "rarity": "loot_exclusive",
                        })
                        continue
                if typ == "armour":
                    await db.users.update_one(
                        {"id": user_id},
                        {"$set": {"armour_level": 6, "armour_owned_level_max": 6}},
                    )
                    await _increment_claimed_count("armour")
                    new_claimed = await _get_claimed_counts()
                    if new_claimed["armour"] >= EXCLUSIVE_CAP_PER_TYPE:
                        await send_notification(user_id, "Loot box", f"The last exclusive armour ({ARMOUR_LEVEL_6_NAME}) has been claimed!", "system")
                    rewards.append({"type": "armour", "name": ARMOUR_LEVEL_6_NAME, "level": 6, "rarity": "loot_exclusive"})
                    continue
                if typ == "property":
                    await db.exclusive_properties.insert_one({
                        "id": str(uuid.uuid4()),
                        "type": "speakeasy",
                        "owner_id": user_id,
                        "claimed_at": now.isoformat(),
                    })
                    await _increment_claimed_count("property")
                    new_claimed = await _get_claimed_counts()
                    if new_claimed["property"] >= EXCLUSIVE_CAP_PER_TYPE:
                        await send_notification(user_id, "Loot box", "The last Speakeasy has been claimed!", "system")
                    rewards.append({"type": "property", "name": "Speakeasy", "rarity": "loot_exclusive"})
                    continue

        # Standard reward
        weights = [w for _, w in STANDARD_REWARD_WEIGHTS]
        total_w = sum(weights)
        r = random.random() * total_w
        acc = 0
        chosen = STANDARD_REWARD_WEIGHTS[0][0]
        for name, w in STANDARD_REWARD_WEIGHTS:
            acc += w
            if r <= acc:
                chosen = name
                break

        if chosen == "points":
            amount = random.choice([10, 30, 50]) if random.random() < 0.6 else random.randint(1, 200)
            amount = min(200, amount)
            merged_inc["points"] = merged_inc.get("points", 0) + amount
            rewards.append({"type": "points", "amount": amount, "rarity": "standard"})
        elif chosen == "rank_points":
            amount = random.randint(100, 5000)
            merged_inc["rank_points"] = merged_inc.get("rank_points", 0) + amount
            rewards.append({"type": "rank_points", "amount": amount, "rarity": "standard"})
        elif chosen == "cash":
            amount = random.randint(100_000, 25_000_000)
            merged_inc["money"] = merged_inc.get("money", 0) + amount
            rewards.append({"type": "cash", "amount": amount, "rarity": "standard"})
        elif chosen == "cars":
            pool = [c for c in CARS if c.get("rarity") in STANDARD_CAR_RARITIES]
            if not pool:
                pool = [c for c in CARS if c.get("id") != LOOT_EXCLUSIVE_CAR_ID and c.get("rarity") != "loot_exclusive"]
            count = random.randint(2, 5)
            items = []
            for _ in range(count):
                car = random.choice(pool)
                await db.user_cars.insert_one({
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "car_id": car["id"],
                    "car_name": car.get("name", car["id"]),
                    "acquired_at": now.isoformat(),
                    "damage_percent": random.randint(0, 30),
                })
                items.append({"name": car.get("name", car["id"]), "rarity": car.get("rarity", "common")})
            rewards.append({"type": "cars", "count": count, "items": items, "rarity": "standard"})
        elif chosen == "bullets":
            amount = random.randint(50, 10_000)
            merged_inc["bullets"] = merged_inc.get("bullets", 0) + amount
            rewards.append({"type": "bullets", "amount": amount, "rarity": "standard"})
        else:
            perk = random.choice(PERK_TYPES)
            until_iso = (now + timedelta(hours=PERK_DURATION_HOURS)).isoformat()
            if perk == "property_income_10":
                merged_set["property_income_perk_until"] = until_iso
            elif perk == "rp_10":
                merged_set["rp_perk_until"] = until_iso
            elif perk == "jail_bust_10":
                merged_set["jail_bust_payout_perk_until"] = until_iso
            elif perk == "airport_cost":
                merged_set["airport_cost_perk_until"] = until_iso
            else:
                merged_set["gta_rare_drop_perk_attempts_remaining"] = GTA_RARE_DROP_PERK_ATTEMPTS
            rewards.append({
                "type": "perk",
                "name": PERK_LABELS.get(perk, perk),
                "rarity": "standard",
            })

    if merged_inc or merged_set:
        update = {}
        if merged_inc:
            update["$inc"] = merged_inc
        if merged_set:
            update["$set"] = merged_set
        await db.users.update_one({"id": user_id}, update)

    return {
        "rewards": rewards,
        "box_quality": box_quality,
        "prizes_count": len(rewards),
        "new_pieces": new_pieces,
        "claimed_counts": await _get_claimed_counts(),
    }


SPEAKEASY_DAILY_CASH = 100_000
SPEAKEASY_DAILY_BULLETS = 100
SPEAKEASY_COOLDOWN_HOURS = 24


async def collect_speakeasy(current_user: dict = Depends(get_current_user)):
    """Collect daily Speakeasy perk if user owns an exclusive property (Speakeasy). Once per 24h."""
    user_id = current_user["id"]
    ep = await db.exclusive_properties.find_one({"owner_id": user_id, "type": "speakeasy"}, {"_id": 0, "last_speakeasy_collected_at": 1})
    if not ep:
        raise HTTPException(status_code=400, detail="You do not own a Speakeasy")
    now = datetime.now(timezone.utc)
    last = ep.get("last_speakeasy_collected_at")
    if last:
        try:
            last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            if (now - last_dt).total_seconds() < SPEAKEASY_COOLDOWN_HOURS * 3600:
                raise HTTPException(status_code=400, detail="Speakeasy daily collection is on cooldown (once per 24 hours)")
        except HTTPException:
            raise
        except Exception:
            pass
    await db.users.update_one(
        {"id": user_id},
        {"$inc": {"money": SPEAKEASY_DAILY_CASH, "bullets": SPEAKEASY_DAILY_BULLETS}},
    )
    await db.exclusive_properties.update_one(
        {"owner_id": user_id, "type": "speakeasy"},
        {"$set": {"last_speakeasy_collected_at": now.isoformat()}},
    )
    return {
        "message": f"Collected ${SPEAKEASY_DAILY_CASH:,} and {SPEAKEASY_DAILY_BULLETS} bullets from your Speakeasy.",
        "cash": SPEAKEASY_DAILY_CASH,
        "bullets": SPEAKEASY_DAILY_BULLETS,
    }


def register(router):
    router.add_api_route("/loot-box/status", get_loot_box_status, methods=["GET"])
    router.add_api_route("/loot-box/open", open_loot_box, methods=["POST"])
    router.add_api_route("/loot-box/speakeasy/collect", collect_speakeasy, methods=["POST"])
