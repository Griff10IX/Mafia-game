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
GAME_SETTINGS_LOOT_RARITY_KEY = "loot_box_rarity"
PERK_DURATION_HOURS = 24

# Default rarity config (admin can override via game_settings)
DEFAULT_RARITY_CONFIG = {
    "exclusive_chance": 0.02,
    "common_pct": 55,
    "uncommon_pct": 32,
    "rare_pct": 13,
}
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


def _stacked_perk_until(merged_set: Dict[str, Any], user: dict, field_name: str, now: datetime) -> str:
    """Return new expiry ISO for a time-based perk, stacking on existing if still active."""
    base_iso = merged_set.get(field_name) or user.get(field_name)
    if not base_iso:
        return (now + timedelta(hours=PERK_DURATION_HOURS)).isoformat()
    try:
        until = datetime.fromisoformat(base_iso.replace("Z", "+00:00"))
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        if until > now:
            return (until + timedelta(hours=PERK_DURATION_HOURS)).isoformat()
    except Exception:
        pass
    return (now + timedelta(hours=PERK_DURATION_HOURS)).isoformat()


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


async def _get_loot_rarity_config() -> Dict[str, Any]:
    """Return current loot box rarity config (exclusive_chance 0-1, common_pct, uncommon_pct, rare_pct). Uses defaults if not set."""
    doc = await db.game_settings.find_one({"key": GAME_SETTINGS_LOOT_RARITY_KEY}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value") or {}
    def pct(key: str, default: int) -> float:
        try:
            v = raw.get(key)
            return max(0, min(100, float(v))) / 100.0 if v is not None else default / 100.0
        except (TypeError, ValueError):
            return default / 100.0
    def chance(key: str, default: float) -> float:
        try:
            v = raw.get(key)
            return max(0.0, min(1.0, float(v))) if v is not None else default
        except (TypeError, ValueError):
            return default
    return {
        "exclusive_chance": chance("exclusive_chance", DEFAULT_RARITY_CONFIG["exclusive_chance"]),
        "common_pct": int(round((raw.get("common_pct") if raw.get("common_pct") is not None else DEFAULT_RARITY_CONFIG["common_pct"]) or 0)),
        "uncommon_pct": int(round((raw.get("uncommon_pct") if raw.get("uncommon_pct") is not None else DEFAULT_RARITY_CONFIG["uncommon_pct"]) or 0)),
        "rare_pct": int(round((raw.get("rare_pct") if raw.get("rare_pct") is not None else DEFAULT_RARITY_CONFIG["rare_pct"]) or 0)),
    }


async def _set_loot_rarity_config(config: Dict[str, Any]) -> None:
    """Persist loot box rarity config to game_settings."""
    value = {
        "exclusive_chance": max(0.0, min(1.0, float(config.get("exclusive_chance", DEFAULT_RARITY_CONFIG["exclusive_chance"])))),
        "common_pct": max(0, min(100, int(config.get("common_pct", DEFAULT_RARITY_CONFIG["common_pct"])))),
        "uncommon_pct": max(0, min(100, int(config.get("uncommon_pct", DEFAULT_RARITY_CONFIG["uncommon_pct"])))),
        "rare_pct": max(0, min(100, int(config.get("rare_pct", DEFAULT_RARITY_CONFIG["rare_pct"])))),
    }
    await db.game_settings.update_one(
        {"key": GAME_SETTINGS_LOOT_RARITY_KEY},
        {"$set": {"value": value}},
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


class LootBoxRarityAdminUpdate(BaseModel):
    """Admin-only: set loot box rarity (percent 0–100). exclusive_chance_pct = chance per prize for exclusive (e.g. 2 = 2%)."""
    exclusive_chance_pct: Optional[float] = None
    common_pct: Optional[int] = None
    uncommon_pct: Optional[int] = None
    rare_pct: Optional[int] = None


def _active_rewards_from_user(user: dict) -> List[Dict[str, Any]]:
    """Build list of currently active loot perks (can stack). Each has type for page filtering."""
    now = datetime.now(timezone.utc)
    active = []
    # Time-based perks
    for key, perk_type, label in [
        ("property_income_perk_until", "property_income_10", PERK_LABELS["property_income_10"]),
        ("rp_perk_until", "rp_10", PERK_LABELS["rp_10"]),
        ("jail_bust_payout_perk_until", "jail_bust_10", PERK_LABELS["jail_bust_10"]),
        ("airport_cost_perk_until", "airport_cost", PERK_LABELS["airport_cost"]),
    ]:
        until_iso = user.get(key)
        if not until_iso:
            continue
        try:
            until = datetime.fromisoformat(until_iso.replace("Z", "+00:00"))
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            if now < until:
                active.append({"type": perk_type, "name": label, "expires_at": until_iso})
        except Exception:
            pass
    # Attempts-based perk
    attempts = int(user.get("gta_rare_drop_perk_attempts_remaining") or 0)
    if attempts > 0:
        active.append({
            "type": "gta_rare_100",
            "name": PERK_LABELS["gta_rare_100"],
            "attempts_remaining": attempts,
        })
    return active


async def get_loot_box_status(current_user: dict = Depends(get_current_user)):
    pieces = int(current_user.get("loot_box_pieces") or 0)
    claimed = await _get_claimed_counts()
    active_rewards = _active_rewards_from_user(current_user)
    last_10_wins = list(current_user.get("loot_box_recent") or [])[-10:]
    last_10_wins.reverse()  # newest first for display
    return {
        "loot_box_pieces": pieces,
        "claimed_counts": claimed,
        "active_rewards": active_rewards,
        "last_10_wins": last_10_wins,
    }


async def get_loot_box_rarity_admin(current_user: dict = Depends(get_current_user)):
    """Admin only: return current loot box rarity config for the admin UI (exclusive % and box quality %)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    config = await _get_loot_rarity_config()
    return {
        "exclusive_chance_pct": round(config["exclusive_chance"] * 100, 2),
        "common_pct": config["common_pct"],
        "uncommon_pct": config["uncommon_pct"],
        "rare_pct": config["rare_pct"],
    }


async def set_loot_box_rarity_admin(
    body: LootBoxRarityAdminUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Admin only: update loot box rarity (percent 0–100). exclusive_chance_pct = chance per prize for exclusive (e.g. 2 = 2%)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    config = await _get_loot_rarity_config()
    if body.exclusive_chance_pct is not None:
        x = float(body.exclusive_chance_pct)
        config["exclusive_chance"] = 1.0 if x >= 100 else max(0.0, min(100.0, x)) / 100.0
    if body.common_pct is not None:
        config["common_pct"] = max(0, min(100, int(body.common_pct)))
    if body.uncommon_pct is not None:
        config["uncommon_pct"] = max(0, min(100, int(body.uncommon_pct)))
    if body.rare_pct is not None:
        config["rare_pct"] = max(0, min(100, int(body.rare_pct)))
    await _set_loot_rarity_config(config)
    return {
        "message": "Loot box rarity updated",
        "exclusive_chance_pct": round(config["exclusive_chance"] * 100, 2),
        "common_pct": config["common_pct"],
        "uncommon_pct": config["uncommon_pct"],
        "rare_pct": config["rare_pct"],
    }


def _roll_box_quality_from_config(config: Dict[str, Any]) -> Tuple[str, int]:
    """Roll box quality from config (common_pct, uncommon_pct, rare_pct). Returns (quality_name, num_prizes). Prizes: common 1-2, uncommon 1-3, rare 1-5."""
    c = config.get("common_pct") or 0
    u = config.get("uncommon_pct") or 0
    r = config.get("rare_pct") or 0
    total = c + u + r
    if total <= 0:
        c, u, r = 55, 32, 13
        total = 100
    probs = [(c / total, (1, 2)), (u / total, (1, 3)), (r / total, (1, 5))]
    names = ["common", "uncommon", "rare"]
    roll = random.random()
    acc = 0.0
    for i, (p, (lo, hi)) in enumerate(probs):
        acc += p
        if roll <= acc:
            return (names[i], random.randint(lo, hi))
    return ("rare", random.randint(1, 5))


async def open_loot_box(
    body: LootBoxOpenRequest = Body(default=LootBoxOpenRequest()),
    current_user: dict = Depends(get_current_user),
):
    cost = LOOT_BOX_PIECES_PER_OPEN
    user_id = current_user["id"]
    raw_pieces = current_user.get("loot_box_pieces")
    logger.info(
        "Loot box open attempt user_id=%s loot_box_pieces=%s (type=%s)",
        user_id,
        raw_pieces,
        type(raw_pieces).__name__,
    )
    is_admin_test = _is_admin(current_user)
    if is_admin_test:
        res = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "loot_box_pieces": 1})
        new_pieces = int(res.get("loot_box_pieces") or 0) if res else 0
    else:
        # Type-safe: match even when loot_box_pieces is stored as string (e.g. "1000001"); normalize and deduct atomically
        try:
            res = await db.users.find_one_and_update(
                {
                    "id": user_id,
                    "$expr": {
                        "$gte": [
                            {"$convert": {"input": "$loot_box_pieces", "to": "long", "onError": 0, "onNull": 0}},
                            cost,
                        ]
                    },
                },
                [
                    {
                        "$set": {
                            "loot_box_pieces": {
                                "$max": [
                                    0,
                                    {
                                        "$subtract": [
                                            {"$convert": {"input": "$loot_box_pieces", "to": "long", "onError": 0, "onNull": 0}},
                                            cost,
                                        ]
                                    },
                                ]
                            }
                        }
                    }
                ],
                projection={"_id": 0, "id": 1, "loot_box_pieces": 1},
                return_document=True,
            )
        except Exception as e:
            logger.exception("Loot box open (find_one_and_update) user_id=%s: %s", user_id, e)
            raise HTTPException(
                status_code=400,
                detail=f"Not enough loot box pieces (need 100) or deduct failed: {type(e).__name__}: {e!s}",
            )
        if not res:
            logger.warning("Loot box open: no document updated for user_id=%s (pieces may be < 100 or wrong type)", user_id)
            raise HTTPException(status_code=400, detail="Not enough loot box pieces (need 100)")
        new_pieces = int(res.get("loot_box_pieces") or 0)

    try:
        rarity_config = await _get_loot_rarity_config()
        box_quality, num_prizes = _roll_box_quality_from_config(rarity_config)
        rewards: List[Dict[str, Any]] = []
        merged_inc: Dict[str, int] = {}
        merged_set: Dict[str, Any] = {}
        now = datetime.now(timezone.utc)

        exclusive_chance = rarity_config.get("exclusive_chance") or EXCLUSIVE_CHANCE
        chosen_standard_types: set = set()  # diversify: avoid same type twice in one open
        for _ in range(num_prizes):
            claimed = await _get_claimed_counts()
            roll = random.random()
            if roll < exclusive_chance:
                available = []
                if claimed["weapon"] < EXCLUSIVE_CAP_PER_TYPE and not await _user_has_loot_exclusive_weapon(user_id):
                    available.append("weapon")
                if claimed["car"] < EXCLUSIVE_CAP_PER_TYPE and not await _user_has_loot_exclusive_car(user_id):
                    available.append("car")
                if claimed["armour"] < EXCLUSIVE_CAP_PER_TYPE and not await _user_has_armour_6(user_id):
                    available.append("armour")
                if claimed["property"] < EXCLUSIVE_CAP_PER_TYPE and not await _user_has_exclusive_property(user_id):
                    available.append("property")
                # Admin at 100% exclusive: if nothing available (cap or already have), still grant an exclusive for testing (skip property if user already has one to avoid duplicate key)
                if is_admin_test and exclusive_chance >= 1.0 and not available:
                    available = ["weapon", "car", "armour"]
                    if not await _user_has_exclusive_property(user_id):
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

            # Standard reward — diversify: prefer types not yet chosen this open
            available = [(name, w) for name, w in STANDARD_REWARD_WEIGHTS if name not in chosen_standard_types]
            if not available:
                available = list(STANDARD_REWARD_WEIGHTS)
            weights = [w for _, w in available]
            total_w = sum(weights)
            r = random.random() * total_w
            acc = 0
            chosen = available[0][0]
            for name, w in available:
                acc += w
                if r <= acc:
                    chosen = name
                    break
            chosen_standard_types.add(chosen)

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
                if not pool:
                    # No cars available (e.g. CARS empty); give cash instead
                    amount = random.randint(100_000, 25_000_000)
                    merged_inc["money"] = merged_inc.get("money", 0) + amount
                    rewards.append({"type": "cash", "amount": amount, "rarity": "standard"})
                else:
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
                if perk == "property_income_10":
                    merged_set["property_income_perk_until"] = _stacked_perk_until(merged_set, current_user, "property_income_perk_until", now)
                elif perk == "rp_10":
                    merged_set["rp_perk_until"] = _stacked_perk_until(merged_set, current_user, "rp_perk_until", now)
                elif perk == "jail_bust_10":
                    merged_set["jail_bust_payout_perk_until"] = _stacked_perk_until(merged_set, current_user, "jail_bust_payout_perk_until", now)
                elif perk == "airport_cost":
                    merged_set["airport_cost_perk_until"] = _stacked_perk_until(merged_set, current_user, "airport_cost_perk_until", now)
                else:
                    merged_inc["gta_rare_drop_perk_attempts_remaining"] = merged_inc.get("gta_rare_drop_perk_attempts_remaining", 0) + GTA_RARE_DROP_PERK_ATTEMPTS
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

        # Append to last-10 wins (newest at end; frontend can reverse for display)
        win_entry = {
            "opened_at": now.isoformat(),
            "box_quality": box_quality,
            "prizes_count": len(rewards),
            "rewards": rewards,
        }
        await db.users.update_one(
            {"id": user_id},
            {"$push": {"loot_box_recent": {"$each": [win_entry], "$slice": -10}}},
        )

        return {
            "rewards": rewards,
            "box_quality": box_quality,
            "prizes_count": len(rewards),
            "new_pieces": new_pieces,
            "claimed_counts": await _get_claimed_counts(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Loot box open (rewards) user_id=%s: %s", user_id, e)
        raise HTTPException(
            status_code=500,
            detail=f"Loot box open failed: {type(e).__name__}: {e!s}",
        )


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
    router.add_api_route("/loot-box/admin/rarity", get_loot_box_rarity_admin, methods=["GET"])
    router.add_api_route("/loot-box/admin/rarity", set_loot_box_rarity_admin, methods=["POST"])
