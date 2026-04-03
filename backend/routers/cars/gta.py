# GTA endpoints: options, attempt, garage, melt
import asyncio
import logging
import secrets
from datetime import datetime, timezone, timedelta
_rng = secrets.SystemRandom()
import uuid
from typing import List, Optional, Dict
from fastapi import Depends, HTTPException, Query, Request
from bson.objectid import ObjectId
from pydantic import BaseModel
from pymongo import ReturnDocument

from utils.referral_ids import (
    apply_referrer_referral_increment,
    normalize_referred_by_ids,
    referral_pool_int,
    split_referral_pool,
    user_has_referrers,
)

logger = logging.getLogger(__name__)

# One mutex per user for GTA attempts + melt/scrap (garage mutations). Same limitation as crime locks: single process only.
_gta_garage_locks: Dict[str, asyncio.Lock] = {}
_gta_garage_locks_guard = asyncio.Lock()


async def _get_gta_garage_lock(user_id: str) -> asyncio.Lock:
    uid = user_id or ""
    async with _gta_garage_locks_guard:
        if uid not in _gta_garage_locks:
            _gta_garage_locks[uid] = asyncio.Lock()
        return _gta_garage_locks[uid]


# ---------------------------------------------------------------------------
# GTA options and request/response models
# ---------------------------------------------------------------------------

# Cooldowns in seconds. First GTA 60s, then scale up. Unlock by rank. (10% harder: success_rate * 0.9)
GTA_OPTIONS = [
    {"id": "easy", "name": "Street Parking", "success_rate": 0.81, "jail_time": 8, "difficulty": 1, "cooldown": 60, "min_rank": 3},
    {"id": "medium", "name": "Residential Area", "success_rate": 0.70, "jail_time": 15, "difficulty": 2, "cooldown": 90, "min_rank": 4},
    {"id": "hard", "name": "Downtown District", "success_rate": 0.54, "jail_time": 25, "difficulty": 3, "cooldown": 120, "min_rank": 5},
    {"id": "expert", "name": "Luxury Garage", "success_rate": 0.41, "jail_time": 40, "difficulty": 4, "cooldown": 180, "min_rank": 6},
    {"id": "legendary", "name": "Private Estate", "success_rate": 0.25, "jail_time": 50, "difficulty": 5, "cooldown": 240, "min_rank": 7},
]


class GTAAttemptRequest(BaseModel):
    option_id: str


class GTAMeltRequest(BaseModel):
    car_ids: List[str]
    action: str  # "bullets" or "cash"
    captcha_token: Optional[str] = None
    # True = Garage: process all selected car_ids (cap GARAGE_BATCH_LIMIT_MAX) with only `action`. False = Auto Rank batch rules.
    manual_garage: bool = True


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
    respect_points: int = 0


# ---------------------------------------------------------------------------
# Progress and messages
# ---------------------------------------------------------------------------

from server import (
    db,
    get_current_user,
    get_current_user_verified,
    _is_admin,
    get_rank_info,
    get_effective_event,
    maybe_process_rank_up,
    maybe_respect_points_drop,
    log_activity,
    log_melt_event,
    log_respect_earned,
    send_notification,
    RANKS,
    CARS,
    TRAVEL_TIMES,
    MELT_VALUE_PER_BULLET,
    MELT_BULLETS_VALUE_MULT_NUM,
    MELT_BULLETS_VALUE_MULT_DEN,
    DEFAULT_GARAGE_BATCH_LIMIT,
    GARAGE_BATCH_LIMIT_MAX,
    CustomCarImageUpdate,
    _family_in_active_war,
)
from routers.account.objectives import update_objectives_progress
from routers.admin.airport import _invalidate_travel_info_cache
from routers.game.families import resolve_family_id
from utils.family_vault_log import log_family_vault_tx
from utils.minigame_captcha_gate import require_turnstile_for_game_action


def effective_garage_batch_limit(user: dict) -> int:
    """Melt/scrap batch size from user doc (Store garage upgrade). Never None/0; caps at GARAGE_BATCH_LIMIT_MAX."""
    raw = (user or {}).get("garage_batch_limit")
    if raw is None:
        return DEFAULT_GARAGE_BATCH_LIMIT
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_GARAGE_BATCH_LIMIT
    if n <= 0:
        return DEFAULT_GARAGE_BATCH_LIMIT
    return min(n, GARAGE_BATCH_LIMIT_MAX)


def _user_car_owner_clause(user_id) -> dict:
    """Match user_cars.user_id whether stored as str or int (Mongo type-strict)."""
    out = []
    if user_id is None:
        return {"user_id": "__none__"}
    s = str(user_id).strip()
    if s:
        out.append(s)
    if isinstance(user_id, int):
        out.append(user_id)
    elif isinstance(user_id, str) and user_id.isdigit():
        try:
            out.append(int(user_id))
        except ValueError:
            pass
    out = list(dict.fromkeys(out))
    if not out:
        return {"user_id": "__none__"}
    if len(out) == 1:
        return {"user_id": out[0]}
    return {"user_id": {"$in": out}}
from utils.image_upload_security import (
    CAR_IMAGE_MAX_DATA_URL_BYTES,
    validate_custom_car_image_value,
)


# 75% harder to earn respect from GTAs (award 25% of base/milestone)
RESPECT_FROM_GTA_MULT = 0.25

# Al Capone exclusive (car20): admin can release into GTA pool; only 1 in game at a time; very rare drop
GTA_EXCLUSIVE_CAR_ID = "car20"
GTA_EXCLUSIVE_POOL_CONFIG_ID = "gta_exclusive"
GTA_EXCLUSIVE_DROP_WEIGHT_DEFAULT = 0.000006  # ~1 in 167k relative to weight-1.0 cars when all cars in pool
GTA_EXCLUSIVE_DROP_WEIGHT_MIN = 0.0000001
GTA_EXCLUSIVE_DROP_WEIGHT_MAX = 0.05
REFERRED_USER_GTA_RARE_BOOST = 0.15  # Slight GTA rare car weight boost for users who signed up with a referral
FOUNDING_MEMBER_GTA_RARE_BOOST = 0.025  # Founding Member: extra weight toward rarer cars

# One-time respect_points rewards when total_gta crosses milestones (same progression as busts/crimes)
GTA_MILESTONES = [
    100, 500, 1000, 2000, 5000,
    10_000, 25_000, 50_000, 100_000, 250_000,
    500_000, 1_000_000, 2_000_000, 5_000_000,
]
GTA_MILESTONE_REWARDS = {
    100: 10, 500: 25, 1000: 50, 2000: 100, 5000: 250,
    10_000: 500, 25_000: 1000, 50_000: 2000, 100_000: 4000, 250_000: 8000,
    500_000: 15_000, 1_000_000: 30_000, 2_000_000: 60_000, 5_000_000: 150_000,
}


async def _award_gta_milestones(user_id: str, new_total_gta: int, claimed: list, bonus_mult: float = 1.0) -> None:
    """If new_total_gta crosses any unclaimed milestone, award respect_points and mark claimed."""
    new_claimed = [m for m in GTA_MILESTONES if m <= new_total_gta and m not in claimed]
    if not new_claimed:
        return
    total_reward = sum(GTA_MILESTONE_REWARDS.get(m, 0) for m in new_claimed)
    total_reward = int(total_reward * RESPECT_FROM_GTA_MULT * max(0.0, float(bonus_mult or 1.0)))
    if total_reward <= 0:
        await db.users.update_one({"id": user_id}, {"$addToSet": {"respect_points_gta_milestones_claimed": {"$each": new_claimed}}})
        return
    try:
        await db.users.update_one(
            {"id": user_id},
            {"$inc": {"respect_points": total_reward}, "$addToSet": {"respect_points_gta_milestones_claimed": {"$each": new_claimed}}},
        )
        await log_respect_earned(user_id, total_reward, "gta_milestone")
        milestones_str = ", ".join(f"{m:,}" for m in sorted(new_claimed))
        await send_notification(
            user_id,
            "GTA milestone reached!",
            f"You reached GTA milestones: {milestones_str}. You earned {total_reward:,} respect points.",
            "system",
            category="system",
        )
        from routers.game.achievements import log_badge_events
        await log_badge_events(user_id, "gta", new_claimed)
    except Exception as e:
        logger.exception("Award GTA milestones: %s", e)


# Progress bar: 25-92%. Start higher, gain more on success, lose less on fail (similar to crimes)
GTA_PROGRESS_MIN = 25
GTA_PROGRESS_MAX = 92
GTA_PROGRESS_GAIN_MIN = 4
GTA_PROGRESS_GAIN_MAX = 6
GTA_PROGRESS_DROP_PER_FAIL_MIN = 1
GTA_PROGRESS_DROP_PER_FAIL_MAX = 2
GTA_PROGRESS_MAX_DROP_FROM_PEAK = 12

# On GTA failure, this chance you get caught (jail); otherwise you get away with no car
GTA_CAUGHT_CHANCE = 0.4

# 10% harder: success roll uses this multiplier (0.9 = 10% less success chance)
GTA_DIFFICULTY_MULT = 0.9

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


def _parse_iso_datetime(val):
    """Parse datetime from DB (string with optional Z, or datetime object)."""
    if val is None:
        return None
    if hasattr(val, "year"):
        return val.replace(tzinfo=timezone.utc) if val.tzinfo is None else val
    try:
        s = str(val).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except Exception:
        return None


def _gta_progress_from_attempts(gta_attempts: int) -> int:
    """Migrate old attempts-based progress to bar value (25-92). New users start at 25%."""
    if gta_attempts < 50:
        return GTA_PROGRESS_MIN
    elif gta_attempts < 200:
        return 35
    elif gta_attempts < 400:
        return 50
    elif gta_attempts < 800:
        return 62
    elif gta_attempts < 1600:
        return 74
    elif gta_attempts < 3500:
        return 85
    else:
        return GTA_PROGRESS_MAX


async def get_gta_options(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    user_rank, _ = get_rank_info(current_user.get("rank_points", 0))
    option_ids = [o["id"] for o in GTA_OPTIONS]
    cooldown_doc, user_gta_list = await asyncio.gather(
        db.gta_cooldowns.find_one(
            {"user_id": current_user.get("id") or ""},
            {"_id": 0, "cooldown_until": 1},
        ),
        db.user_gta.find(
            {"user_id": current_user.get("id") or "", "option_id": {"$in": option_ids}},
            {"_id": 0, "option_id": 1, "attempts": 1, "successes": 1, "progress": 1, "progress_max": 1},
        ).to_list(len(option_ids)),
    )
    global_cooldown_until = None
    if cooldown_doc:
        until = _parse_iso_datetime(cooldown_doc.get("cooldown_until"))
        if until and until > now:
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


async def _attempt_gta_impl(option_id: str, current_user: dict, caller_updates_total_gta: bool = False) -> GTAAttemptResponse:
    """Run one GTA attempt. Caller must ensure option exists, user rank OK, and cooldown passed. Used by route and auto_rank.
    When caller_updates_total_gta is True (e.g. auto_rank), total_gta is not incremented here; the caller does it for leaderboard consistency."""
    option = next((o for o in GTA_OPTIONS if o["id"] == option_id), None)
    if not option:
        raise ValueError(f"Invalid GTA option: {option_id}")
    now = datetime.now(timezone.utc)
    uid = current_user.get("id") or ""
    now_iso = now.isoformat()
    cooldown_until = now + timedelta(seconds=option["cooldown"])
    cooldown_iso = cooldown_until.isoformat()

    claimed = await db.gta_cooldowns.update_one(
        {"user_id": uid, "cooldown_until": {"$lte": now_iso}},
        {"$set": {"cooldown_until": cooldown_iso}},
    )
    if claimed.modified_count == 0:
        first = await db.gta_cooldowns.update_one(
            {"user_id": uid},
            {"$setOnInsert": {"cooldown_until": cooldown_iso}},
            upsert=True,
        )
        if first.upserted_id is None and first.modified_count == 0:
            existing = await db.gta_cooldowns.find_one(
                {"user_id": uid}, {"_id": 0, "cooldown_until": 1}
            )
            cd_until = _parse_iso_datetime((existing or {}).get("cooldown_until"))
            if cd_until and cd_until > now:
                secs = int((cd_until - now).total_seconds())
                raise HTTPException(
                    status_code=400, detail=f"GTA cooldown: try again in {secs}s"
                )
    
    # PROGRESS BAR: 10-92%. Success +3-5%. Fail -1-3%; once hit 92%, floor 77%
    user_gta = await db.user_gta.find_one(
        {"user_id": current_user.get("id") or "", "option_id": option["id"]},
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
    gta_rate = success_rate * ev.get("gta_success", 1.0) * GTA_DIFFICULTY_MULT
    success = _rng.random() < min(1.0, gta_rate)
    
    if success:
        gain = _rng.randint(GTA_PROGRESS_GAIN_MIN, GTA_PROGRESS_GAIN_MAX)
        progress_after = min(GTA_PROGRESS_MAX, progress + gain)
        progress_max = max(progress_max, progress_after)
    else:
        drop = _rng.randint(
            GTA_PROGRESS_DROP_PER_FAIL_MIN,
            GTA_PROGRESS_DROP_PER_FAIL_MAX
        )
        floor = (
            max(GTA_PROGRESS_MIN, GTA_PROGRESS_MAX - GTA_PROGRESS_MAX_DROP_FROM_PEAK)
            if progress_max >= GTA_PROGRESS_MAX
            else GTA_PROGRESS_MIN
        )
        progress_after = max(floor, progress - drop)
    
    set_fields = {
        "last_attempted": now.isoformat(),
        "progress": progress_after,
    }
    if progress_max is not None:
        set_fields["progress_max"] = progress_max
    await db.user_gta.update_one(
        {"user_id": current_user.get("id") or "", "option_id": option["id"]},
        {"$set": set_fields, "$inc": {"attempts": 1, "successes": 1 if success else 0}},
        upsert=True,
    )
    
    if success:
        available_cars = [
            c
            for c in CARS
            if c["min_difficulty"] <= option["difficulty"]
            and c["rarity"] != "exclusive"
            and c.get("rarity") != "loot_exclusive"
        ]
        if not available_cars:
            available_cars = [c for c in CARS if c["min_difficulty"] == 1]
        # Optional: Al Capone exclusive in pool (admin-released, only 1 in game, very rare)
        exclusive_car = next((c for c in CARS if c.get("id") == GTA_EXCLUSIVE_CAR_ID), None)
        if exclusive_car and option["difficulty"] >= (exclusive_car.get("min_difficulty") or 5):
            config = await db.game_config.find_one(
                {"id": GTA_EXCLUSIVE_POOL_CONFIG_ID},
                {"_id": 0, "released": 1, "drop_weight": 1},
            )
            if config and config.get("released"):
                count = await db.user_cars.count_documents({"car_id": GTA_EXCLUSIVE_CAR_ID})
                if count == 0:
                    available_cars = list(available_cars) + [exclusive_car]
            exclusive_drop_weight = float((config or {}).get("drop_weight") or GTA_EXCLUSIVE_DROP_WEIGHT_DEFAULT)
            exclusive_drop_weight = max(GTA_EXCLUSIVE_DROP_WEIGHT_MIN, min(GTA_EXCLUSIVE_DROP_WEIGHT_MAX, exclusive_drop_weight))
        else:
            exclusive_drop_weight = GTA_EXCLUSIVE_DROP_WEIGHT_DEFAULT
        # Prestige bonus and loot-box GTA rare perk: weight rarer cars more heavily
        from server import get_prestige_bonus, founding_member_income_mult
        _fm_gta = founding_member_income_mult(current_user)
        _gta_prestige_user = await db.users.find_one({"id": current_user.get("id") or ""}, {"_id": 0, "prestige_level": 1})
        _rare_boost = get_prestige_bonus(_gta_prestige_user or {})["gta_rare_boost"]
        # Badge bonus: 0.1% per GTA badge; prestige: 0.5% boost per level
        try:
            from routers.game.achievements import get_badge_bonuses
            bb = await get_badge_bonuses(current_user.get("id") or "")
            _rare_boost += bb.get("gta", 0) * 0.001 * bb.get("prestige_badge_mult", 1)
        except Exception:
            pass
        # Referred user: slight GTA rare car boost
        if user_has_referrers(current_user.get("referred_by")):
            _rare_boost += REFERRED_USER_GTA_RARE_BOOST
        if _fm_gta > 1.0:
            _rare_boost += FOUNDING_MEMBER_GTA_RARE_BOOST
        gta_rare_perk = int(current_user.get("gta_rare_drop_perk_attempts_remaining") or 0)
        if gta_rare_perk > 0:
            _rare_boost = max(_rare_boost, 1.0)
        if _rare_boost > 0:
            _rarity_weights = {"common": 1.0, "uncommon": 1.0 + _rare_boost * 0.5, "rare": 1.0 + _rare_boost, "ultra_rare": 1.0 + _rare_boost * 1.5, "legendary": 1.0 + _rare_boost * 2.0, "exclusive": exclusive_drop_weight}
            _weights = [_rarity_weights.get(c.get("rarity", "common"), 1.0) for c in available_cars]
            car = _rng.choices(available_cars, weights=_weights, k=1)[0]
        else:
            if exclusive_car and available_cars and available_cars[-1].get("id") == GTA_EXCLUSIVE_CAR_ID:
                _weights = [1.0] * (len(available_cars) - 1) + [exclusive_drop_weight]
                car = _rng.choices(available_cars, weights=_weights, k=1)[0]
            else:
                car = _rng.choice(available_cars)
        # Stolen car damage: 15–77% common; 0–14% uncommon but possible
        if _rng.random() < 0.08:
            damage_percent = _rng.randint(0, 14)
        else:
            damage_percent = _rng.randint(15, 77)
        rank_points_map = {
            "common": 5,
            "uncommon": 10,
            "rare": 20,
            "ultra_rare": 40,
            "legendary": 100,
            "exclusive": 100,
        }
        rank_points = rank_points_map.get(car["rarity"], 5)
        rank_points = int(rank_points * ev.get("rank_points", 1.0))
        now_utc = datetime.now(timezone.utc)
        rp_perk_until = _parse_iso_datetime(current_user.get("rp_perk_until"))
        if rp_perk_until and now_utc < rp_perk_until:
            rank_points = int(rank_points * 1.1)
        xp_gta_until = _parse_iso_datetime(current_user.get("xp_gta_until"))
        if xp_gta_until and now_utc < xp_gta_until:
            rank_points = rank_points * 2
        from server import rank_xp_pass_multiplier
        pass_mult = float(rank_xp_pass_multiplier(current_user))
        rank_points = int(rank_points * pass_mult)
        gta_rare_perk = int(current_user.get("gta_rare_drop_perk_attempts_remaining") or 0)
        if gta_rare_perk > 0:
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"gta_rare_drop_perk_attempts_remaining": -1}})
        await db.user_cars.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": current_user.get("id") or "",
                "car_id": car["id"],
                "car_name": car["name"],
                "acquired_at": datetime.now(timezone.utc).isoformat(),
                "damage_percent": damage_percent,
            }
        )
        _invalidate_travel_info_cache(current_user.get("id") or "")
        rp_before = int(current_user.get("rank_points") or 0)
        rp_granted = int(rank_points * _fm_gta)
        gta_inc = {"money": int(car["value"] * _fm_gta * pass_mult), "rank_points": rp_granted}
        if not caller_updates_total_gta:
            gta_inc["total_gta"] = 1
        if (car.get("rarity") or "").strip().lower() == "uncommon":
            gta_inc["uncommon_cars_stolen"] = 1
        respect_drop = maybe_respect_points_drop()
        if respect_drop:
            gta_inc["respect_points"] = max(0, int(respect_drop * RESPECT_FROM_GTA_MULT * _fm_gta * pass_mult))
        await db.users.update_one(
            {"id": current_user.get("id") or ""},
            {"$inc": gta_inc},
        )
        if gta_inc.get("respect_points"):
            await log_respect_earned(current_user.get("id") or "", gta_inc["respect_points"], "gta")
        new_total_gta = (current_user.get("total_gta") or 0) + 1
        claimed = current_user.get("respect_points_gta_milestones_claimed") or []
        new_claimed = [m for m in GTA_MILESTONES if m <= new_total_gta and m not in claimed]
        milestone_respect = sum(GTA_MILESTONE_REWARDS.get(m, 0) for m in new_claimed)
        await _award_gta_milestones(current_user.get("id") or "", new_total_gta, claimed, bonus_mult=_fm_gta)
        respect_earned = max(0, int((respect_drop or 0) * RESPECT_FROM_GTA_MULT * _fm_gta)) + max(0, int(milestone_respect * RESPECT_FROM_GTA_MULT * _fm_gta))
        try:
            await maybe_process_rank_up(current_user.get("id") or "", rp_before, rp_granted, current_user.get("username", ""))
        except Exception as e:
            logger.exception("Rank-up notification (GTA): %s", e)
        try:
            await update_objectives_progress(current_user.get("id") or "", "gta", 1)
        except Exception:
            pass
        msg = _rng.choice(GTA_SUCCESS_MESSAGES).format(car_name=car["name"])
        return GTAAttemptResponse(
            success=True,
            message=msg,
            car=car,
            jailed=False,
            jail_until=None,
            rank_points_earned=rp_granted,
            progress_after=progress_after,
            respect_points=respect_earned,
        )
    # Failure: sometimes caught (jail), sometimes get away (no car, no jail)
    caught = _rng.random() < GTA_CAUGHT_CHANCE
    if caught:
        jail_until = datetime.now(timezone.utc) + timedelta(seconds=option["jail_time"])
        await db.users.update_one(
            {"id": current_user.get("id") or ""},
            {"$set": {"in_jail": True, "jail_until": jail_until.isoformat(), "snitch_attempted_this_term": False}},
        )
        fail_msg = _rng.choice(GTA_FAIL_CAUGHT_MESSAGES).format(seconds=option["jail_time"])
        return GTAAttemptResponse(
            success=False,
            message=fail_msg,
            car=None,
            jailed=True,
            jail_until=jail_until.isoformat(),
            rank_points_earned=0,
            progress_after=progress_after,
            respect_points=0,
        )
    fail_msg = _rng.choice(GTA_FAIL_ESCAPED_MESSAGES)
    return GTAAttemptResponse(
        success=False,
        message=fail_msg,
        car=None,
        jailed=False,
        jail_until=None,
        rank_points_earned=0,
        progress_after=progress_after,
        respect_points=0,
    )


async def attempt_gta_locked(
    option_id: str,
    current_user: dict,
    caller_updates_total_gta: bool = False,
) -> GTAAttemptResponse:
    """HTTP route and auto_rank: serialize GTA attempts with melt/scrap for this user."""
    lock = await _get_gta_garage_lock(current_user.get("id") or "")
    async with lock:
        return await _attempt_gta_impl(
            option_id, current_user, caller_updates_total_gta=caller_updates_total_gta
        )


async def melt_cars_locked(user: dict, car_ids: list, action: str, *, manual_garage: bool = False) -> dict:
    """HTTP route and auto_rank: serialize melt/scrap with GTA for this user."""
    lock = await _get_gta_garage_lock(user.get("id") or "")
    async with lock:
        return await _melt_cars_impl(user, car_ids, action, manual_garage=manual_garage)


async def attempt_gta(
    request: GTAAttemptRequest, current_user: dict = Depends(get_current_user_verified)
):
    if current_user.get("in_jail"):
        jail_until_raw = current_user.get("jail_until")
        jail_time = _parse_iso_datetime(jail_until_raw) if jail_until_raw else None
        if jail_time and jail_time > datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="You are in jail!")
        await db.users.update_one(
            {"id": current_user.get("id") or ""},
            {"$set": {"in_jail": False, "jail_until": None}, "$unset": {"auto_rank_next_run_at": ""}},
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
    lock = await _get_gta_garage_lock(current_user.get("id") or "")
    async with lock:
        now = datetime.now(timezone.utc)
        cooldown_doc = await db.gta_cooldowns.find_one(
            {"user_id": current_user.get("id") or ""},
            {"_id": 0, "cooldown_until": 1},
        )
        if cooldown_doc:
            until = _parse_iso_datetime(cooldown_doc.get("cooldown_until"))
            if until and until > now:
                secs = int((until - now).total_seconds())
                raise HTTPException(
                    status_code=400, detail=f"GTA cooldown: try again in {secs}s"
                )
        result = await _attempt_gta_impl(request.option_id, current_user)
        now = datetime.now(timezone.utc)
        success = getattr(result, "success", False)
        profit = int((result.car.get("value", 0) or 0)) if (getattr(result, "car", None) and success) else 0
        option = next((o for o in GTA_OPTIONS if o["id"] == request.option_id), None)
        car = getattr(result, "car", None)
        jailed = getattr(result, "jailed", False)
        jail_seconds = int(option["jail_time"]) if (option and jailed) else None
        event_doc = {
            "user_id": current_user.get("id") or "",
            "username": current_user.get("username") or "",
            "at": now,
            "success": success,
            "profit": profit,
            "option_id": request.option_id,
            "option_name": (option or {}).get("name") or request.option_id,
            "car_id": car.get("id") if car else None,
            "car_name": car.get("name") if car else None,
            "car_value": int(car.get("value", 0)) if car else 0,
            "jailed": jailed,
            "jail_seconds": jail_seconds,
        }
        await db.gta_events.insert_one(event_doc)
        await log_activity(current_user.get("id", ""), current_user.get("username", "?"), "gta_attempt", {
            "option": (option or {}).get("name", request.option_id), "success": success,
            "car": car.get("name") if car else None, "jailed": jailed,
        })
        return result


async def get_gta_stats(current_user: dict = Depends(get_current_user)):
    """Return GTAs today/week, successful GTAs, profit today / 24h / week."""
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    last_24h_start = now - timedelta(hours=24)
    seven_days_start = now - timedelta(days=7)
    pipeline = [
        {"$match": {"user_id": current_user.get("id") or ""}},
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
        return int(arr[0].get("profit", 0)) if arr else 0
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
    cars = await db.user_cars.find({"user_id": current_user.get("id") or ""}).to_list(1000)
    user_doc = await db.users.find_one(
        {"id": current_user.get("id") or ""},
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
            display_name = (user_car.get("custom_name") or user_car.get("car_name")) if car_id == "car_custom" else (user_car.get("car_name") or car_info.get("name"))
            # Custom cars never have damage
            damage = 0 if car_id == "car_custom" else min(100, max(0, float(user_car.get("damage_percent", 0))))
            entry = {
                "user_car_id": user_car_id,
                "car_id": car_id,
                "car_name": display_name,
                "acquired_at": user_car.get("acquired_at"),
                "damage_percent": damage,
                **car_info,
            }
            if car_id == "car_custom":
                entry["name"] = display_name or car_info.get("name")
            if car_id == "car_custom" and user_car.get("custom_image_url"):
                entry["image"] = user_car.get("custom_image_url")
            if user_car.get("listed_for_sale"):
                entry["listed_for_sale"] = True
                entry["sale_price"] = user_car.get("sale_price")
                entry["listed_at"] = user_car.get("listed_at")
            car_details.append(entry)
    return {"cars": car_details, "melt_bullets_cooldown_until": melt_bullets_cooldown_until}


async def get_recent_stolen(current_user: dict = Depends(get_current_user)):
    """Last 10 cars stolen (by acquired_at desc) for the GTA page. Same shape as garage entries."""
    cursor = (
        db.user_cars.find({"user_id": current_user.get("id") or ""})
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
            display_name = (user_car.get("custom_name") or user_car.get("car_name") or car_info.get("name") or "Car") if car_id == "car_custom" else (user_car.get("car_name") or car_info.get("name") or "Car")
            # Custom cars never have damage
            damage = 0 if car_id == "car_custom" else min(100, max(0, float(user_car.get("damage_percent", 0))))
            entry = {
                "user_car_id": user_car_id,
                "car_id": car_id,
                "car_name": display_name,
                "acquired_at": user_car.get("acquired_at"),
                "damage_percent": damage,
                **car_info,
            }
            if car_id == "car_custom":
                entry["name"] = display_name
            if car_id == "car_custom" and user_car.get("custom_image_url"):
                entry["image"] = user_car.get("custom_image_url")
            car_details.append(entry)
    return {"cars": car_details}


def _parse_melt_cooldown(iso_str):
    """Parse cooldown / melt_until timestamps; always timezone-aware (UTC) for safe comparison with now."""
    if not iso_str:
        return None
    if hasattr(iso_str, "year"):
        dt = iso_str
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    try:
        s = str(iso_str).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except Exception:
        return None


async def _melt_cars_impl(user: dict, car_ids: list, action: str, *, manual_garage: bool = False):
    """Core melt logic. Returns dict with success/melted_count/etc. On bullets cooldown returns {success: False, cooldown: True, detail: ...}."""
    now = datetime.now(timezone.utc)
    action = (action or "").strip().lower()
    if action not in ("bullets", "cash"):
        return {"success": False, "message": "Invalid action"}
    # Garage: honor full selection (capped). Auto Rank / internal: upgraded batch limit only.
    if manual_garage:
        limit = min(len(car_ids), GARAGE_BATCH_LIMIT_MAX)
    else:
        limit = min(effective_garage_batch_limit(user), len(car_ids))
    owner = _user_car_owner_clause(user.get("id"))
    # Prefer DB-resolved crew (membership row) so melt rewards still apply if users.family_id is stale/missing.
    family_id = await resolve_family_id(user.get("id") or "") or (str(user.get("family_id") or "").strip() or None)
    in_war = family_id and await _family_in_active_war(family_id)

    # Bullets melt: claim cooldown atomically before deleting cars (parallel POSTs used to share the same read).
    claimed_bullets_melt = False
    prev_user_before_bullets_claim = None

    if action == "bullets":
        now_iso = now.isoformat()
        # Upper-bound CD so the claim blocks other requests until this melt finishes; final $set may shorten.
        pessimistic_until = (now + timedelta(seconds=MELT_BULLETS_COOLDOWN_SECONDS * max(1, limit))).isoformat()
        prev_user_before_bullets_claim = await db.users.find_one_and_update(
            {
                "id": user["id"],
                "$or": [
                    {"melt_bullets_cooldown_until": {"$exists": False}},
                    {"melt_bullets_cooldown_until": None},
                    {"melt_bullets_cooldown_until": {"$lte": now_iso}},
                ],
            },
            {"$set": {"melt_bullets_cooldown_until": pessimistic_until}},
            projection={"_id": 0, "melt_bullets_cooldown_until": 1, "melt_until": 1},
            return_document=ReturnDocument.BEFORE,
        )
        if prev_user_before_bullets_claim is None:
            existing = await db.users.find_one(
                {"id": user["id"]},
                {"_id": 0, "melt_bullets_cooldown_until": 1},
            )
            cd = _parse_melt_cooldown((existing or {}).get("melt_bullets_cooldown_until"))
            if cd and now < cd:
                secs = int((cd - now).total_seconds())
                return {
                    "success": False,
                    "cooldown": True,
                    "detail": f"Melt for bullets on cooldown. Next melt in {secs}s.",
                }
            return {"success": False, "cooldown": True, "detail": "Melt for bullets on cooldown."}
        claimed_bullets_melt = True
        melt_until = _parse_melt_cooldown(prev_user_before_bullets_claim.get("melt_until"))
        melt_token_active = bool(melt_until and now < melt_until)

    total_value = 0
    total_bullets = 0
    deleted_count = 0
    uncommon_count = 0
    processed = 0
    for car_id in car_ids:
        if processed >= limit:
            break
        deleted_car = None
        delete_filter = {**owner, "id": car_id, "listed_for_sale": {"$ne": True}}
        deleted_car = await db.user_cars.find_one_and_delete(delete_filter)
        if not deleted_car:
            try:
                delete_filter = {**owner, "_id": ObjectId(car_id), "listed_for_sale": {"$ne": True}}
                deleted_car = await db.user_cars.find_one_and_delete(delete_filter)
            except Exception:
                pass
        if deleted_car:
            model_id = deleted_car["car_id"]
            car_info = next((c for c in CARS if c["id"] == model_id), None)
            if in_war and car_info and car_info.get("rarity") in ("exclusive", "loot_exclusive"):
                await db.user_cars.insert_one(deleted_car)
                continue
            if car_info:
                if car_info.get("rarity") == "uncommon":
                    uncommon_count += 1
                car_value = int(car_info.get("value", 0) or 0)
                if action == "bullets":
                    rarity = (car_info.get("rarity") or "").strip().lower()
                    melt_value = (car_value * MELT_BULLETS_VALUE_MULT_NUM) // MELT_BULLETS_VALUE_MULT_DEN
                    car_bullets = melt_value // MELT_VALUE_PER_BULLET
                    if car_info.get("rarity") == "common":
                        if car_bullets < 2:
                            car_bullets = 2
                        elif car_bullets > 3:
                            car_bullets = 3
                    if rarity not in ("exclusive", "loot_exclusive"):
                        # +25% bullets for all but exclusive / loot_exclusive (floor-rounded).
                        car_bullets = (int(car_bullets) * 125) // 100
                    total_bullets += car_bullets
                else:
                    total_value += int(car_value * 0.5)
                deleted_count += 1
                processed += 1
            else:
                await db.user_cars.insert_one(deleted_car)
                processed += 1
    if deleted_count > 0:
        if action == "bullets":
            base_cooldown = int(MELT_BULLETS_COOLDOWN_SECONDS * 0.5) if melt_token_active else MELT_BULLETS_COOLDOWN_SECONDS
            cooldown_seconds = base_cooldown * deleted_count
            # Badge bonus: 0.1% per bullets melted badge reduces cooldown (min 50%); prestige: 0.5% boost per level
            try:
                from routers.game.achievements import get_badge_bonuses
                bb = await get_badge_bonuses(user.get("id") or "")
                bullets_mult = max(0.5, 1 - bb.get("bullets_melted", 0) * 0.001 * bb.get("prestige_badge_mult", 1))
                cooldown_seconds = int(cooldown_seconds * bullets_mult)
            except Exception:
                pass
            cooldown_until = now + timedelta(seconds=cooldown_seconds)
            base_total_bullets = int(total_bullets or 0)
            family_cut = 0
            player_bullets = base_total_bullets
            melt_reward_due = 0
            melt_reward_paid = 0
            melt_reward_hits_due = 0
            melt_reward_hits_paid = 0
            melt_pct_applied = 0
            family_treasury_bullets_after = None
            if family_id:
                fam = await db.families.find_one(
                    {"id": family_id, "wiped": {"$ne": True}},
                    {"_id": 0, "melt_treasury_pct": 1, "melt_reward_tiers": 1, "treasury": 1, "name": 1},
                )
                if fam:
                    individual_rewards = []
                    configured_pct = max(0, min(50, int(fam.get("melt_treasury_pct") or 0)))
                    tiers_raw = fam.get("melt_reward_tiers") or []
                    valid_tiers = []
                    for tier in tiers_raw:
                        try:
                            threshold = int((tier or {}).get("threshold_bullets") or 0)
                            reward = int((tier or {}).get("reward_money") or 0)
                        except Exception:
                            continue
                        if threshold >= 1000 and threshold % 1000 == 0 and reward > 0:
                            valid_tiers.append({"threshold_bullets": threshold, "reward_money": reward})
                    if configured_pct > 0 and base_total_bullets > 0 and valid_tiers:
                        projected_family_cut = (base_total_bullets * configured_pct) // 100
                        if projected_family_cut > 0:
                            individual_rewards = []
                            for t in valid_tiers:
                                tb = int(t["threshold_bullets"])
                                rm = int(t["reward_money"])
                                if tb > 0:
                                    hits = projected_family_cut // tb
                                    for _ in range(hits):
                                        individual_rewards.append(rm)
                            melt_reward_hits_due = len(individual_rewards)
                            melt_reward_due = sum(individual_rewards)
                    if melt_reward_due > 0:
                        # Fresh treasury read + retry: stale reads or concurrent spends used to fail the atomic debit and zero the whole payout.
                        melt_reward_paid = 0
                        melt_reward_hits_paid = 0
                        for _attempt in range(2):
                            fam_pay = await db.families.find_one(
                                {"id": family_id, "wiped": {"$ne": True}},
                                {"_id": 0, "treasury": 1},
                            )
                            treasury_balance = int((fam_pay or {}).get("treasury") or 0)
                            affordable = []
                            remaining = treasury_balance
                            for reward_amount in individual_rewards:
                                if remaining >= reward_amount:
                                    affordable.append(reward_amount)
                                    remaining -= reward_amount
                            candidate = sum(affordable)
                            if candidate <= 0:
                                break
                            payout_res = await db.families.update_one(
                                {"id": family_id, "treasury": {"$gte": candidate}},
                                {"$inc": {"treasury": -candidate}},
                            )
                            if payout_res.modified_count > 0:
                                melt_reward_paid = candidate
                                melt_reward_hits_paid = len(affordable)
                                break
                        if melt_reward_paid < melt_reward_due:
                            await db.families.update_one({"id": family_id}, {"$set": {"melt_treasury_pct": 0}})
                    if configured_pct > 0 and base_total_bullets > 0:
                        melt_pct_applied = configured_pct
                        family_cut = (base_total_bullets * configured_pct) // 100
                        player_bullets = base_total_bullets - family_cut
                        if family_cut > 0:
                            await db.families.update_one(
                                {"id": family_id},
                                {"$inc": {"treasury_bullets": family_cut}},
                            )
                            fam_after = await db.families.find_one(
                                {"id": family_id},
                                {"_id": 0, "treasury_bullets": 1},
                            )
                            family_treasury_bullets_after = int((fam_after or {}).get("treasury_bullets") or 0)
            await db.users.update_one(
                {"id": user["id"]},
                {
                    "$inc": {
                        "bullets": player_bullets,
                        "money": melt_reward_paid,
                        "bullets_melted": player_bullets,
                        "family_bullets_melted": family_cut,
                        "family_melt_reward_money_earned": melt_reward_paid,
                        "family_melt_reward_hits": melt_reward_hits_paid,
                        "cars_melted": deleted_count,
                        "uncommon_cars_scrapped": uncommon_count,
                    },
                    "$set": {"melt_bullets_cooldown_until": cooldown_until.isoformat()},
                },
            )
            await log_melt_event(user["id"], player_bullets)
            if family_id and (family_cut > 0 or melt_reward_paid > 0):
                await log_family_vault_tx(
                    db,
                    family_id,
                    "gta_melt",
                    user["id"],
                    user.get("username") or "?",
                    cash_delta=-melt_reward_paid,
                    bullets_delta=family_cut,
                    meta={
                        "melt_reward_hits_paid": melt_reward_hits_paid,
                        "melt_reward_hits_due": melt_reward_hits_due,
                        "melt_treasury_pct": melt_pct_applied,
                    },
                )
            if melt_reward_paid > 0:
                updated_user = await db.users.find_one(
                    {"id": user["id"]},
                    {"_id": 0, "family_melt_reward_money_earned": 1},
                )
                total_melt_earned = int((updated_user or {}).get("family_melt_reward_money_earned") or 0)
                fam_name = (fam or {}).get("name") or "your family"
                notif_msg = (
                    f"You earned ${melt_reward_paid:,} from {fam_name}'s treasury for melting "
                    f"({melt_reward_hits_paid} reward hit{'s' if melt_reward_hits_paid != 1 else ''}). "
                    f"Total earned from melt rewards: ${total_melt_earned:,}."
                )
                if melt_reward_paid < melt_reward_due:
                    notif_msg += " Treasury ran out — family melt % has been reset to 0%."
                await send_notification(
                    user["id"],
                    "Family Melt Reward",
                    notif_msg,
                    "family",
                    category="family",
                )
            await log_activity(
                user["id"],
                user.get("username") or "?",
                "garage_melt",
                {
                    "action": "bullets",
                    "manual_garage": manual_garage,
                    "source": "garage_ui" if manual_garage else "auto_rank_or_internal",
                    "family_id": family_id,
                    "melted_count": deleted_count,
                    "total_bullets": player_bullets,
                    "base_total_bullets": base_total_bullets,
                    "family_cut_bullets": family_cut,
                    "melt_treasury_pct": melt_pct_applied,
                    "melt_reward_due": melt_reward_due,
                    "melt_reward_paid": melt_reward_paid,
                    "melt_reward_hits_paid": melt_reward_hits_paid,
                    "car_ids": car_ids[:limit],
                },
            )
            # Referral: referrers split 10% of player-earned bullets (post family cut).
            _rb = await db.users.find_one({"id": user["id"]}, {"_id": 0, "referred_by": 1})
            ref_ids = normalize_referred_by_ids((_rb or user).get("referred_by"))
            if ref_ids and player_bullets > 0:
                pool = referral_pool_int(player_bullets, 0.10)
                for rid, amt in split_referral_pool(pool, ref_ids, self_id=user["id"]):
                    if amt > 0:
                        await apply_referrer_referral_increment(
                            db, rid, {"bullets": amt, "referral_earnings_melt_bullets": amt}, context="gta_melt"
                        )
            msg = (
                f"Melted {deleted_count} car(s): {base_total_bullets} total bullets "
                f"-> you kept {player_bullets}"
            )
            if family_cut > 0:
                msg += f", family got {family_cut}"
            msg += f". Next melt in {cooldown_seconds}s."
            if melt_reward_paid > 0:
                msg += f" + ${melt_reward_paid:,} family reward ({melt_reward_hits_paid}/{melt_reward_hits_due} hit{'s' if melt_reward_hits_due != 1 else ''})."
            if melt_reward_due > 0 and melt_reward_paid < melt_reward_due:
                msg += " Treasury couldn't cover all rewards; family melt % reset to 0%."
            return {
                "success": True,
                "melted_count": deleted_count,
                "total_bullets": base_total_bullets,
                "player_bullets": player_bullets,
                "base_total_bullets": base_total_bullets,
                "family_cut_bullets": family_cut,
                "family_treasury_bullets_after": family_treasury_bullets_after,
                "melt_treasury_pct": melt_pct_applied,
                "melt_reward_paid": melt_reward_paid,
                "melt_reward_hits_paid": melt_reward_hits_paid,
                "message": msg,
                "melt_bullets_cooldown_until": cooldown_until.isoformat(),
            }
        await db.users.update_one(
            {"id": user["id"]}, {"$inc": {"money": total_value, "cars_melted": deleted_count, "uncommon_cars_scrapped": uncommon_count}}
        )
        await log_activity(
            user["id"],
            user.get("username") or "?",
            "garage_scrap",
            {
                "action": "cash",
                "manual_garage": manual_garage,
                "source": "garage_ui" if manual_garage else "auto_rank_or_internal",
                "scrapped_count": deleted_count,
                "total_value": total_value,
                "car_ids": car_ids[:limit],
            },
        )
        # Referral: referrers split 5% of garage scrap profit (game-paid)
        _rb = await db.users.find_one({"id": user["id"]}, {"_id": 0, "referred_by": 1})
        ref_ids = normalize_referred_by_ids((_rb or user).get("referred_by"))
        if ref_ids and total_value > 0:
            pool = referral_pool_int(total_value, 0.05)
            for rid, amt in split_referral_pool(pool, ref_ids, self_id=user["id"]):
                if amt > 0:
                    await apply_referrer_referral_increment(
                        db, rid, {"money": amt, "referral_earnings_garage_scrap": amt}, context="gta_scrap"
                    )
        return {
            "success": True,
            "scrapped_count": deleted_count,
            "total_value": total_value,
            "message": f"Scrapped {deleted_count} car(s) for ${total_value:,}",
        }
    if claimed_bullets_melt and prev_user_before_bullets_claim is not None:
        old_cd = prev_user_before_bullets_claim.get("melt_bullets_cooldown_until")
        if old_cd:
            await db.users.update_one(
                {"id": user["id"]},
                {"$set": {"melt_bullets_cooldown_until": old_cd}},
            )
        else:
            await db.users.update_one(
                {"id": user["id"]},
                {"$unset": {"melt_bullets_cooldown_until": ""}},
            )
    return {"success": False, "message": "No cars were processed"}


async def melt_cars(
    body: GTAMeltRequest,
    http_request: Request,
    current_user: dict = Depends(get_current_user_verified),
):
    await require_turnstile_for_game_action(
        db,
        request=http_request,
        current_user=current_user,
        captcha_token=body.captcha_token,
        is_admin=_is_admin(current_user),
    )
    if not body.car_ids:
        raise HTTPException(status_code=400, detail="No cars selected")
    if (body.action or "").strip().lower() not in ("bullets", "cash"):
        raise HTTPException(status_code=400, detail='action must be "bullets" or "cash"')
    result = await melt_cars_locked(
        current_user,
        body.car_ids,
        body.action,
        manual_garage=body.manual_garage,
    )
    if result.get("cooldown"):
        raise HTTPException(status_code=400, detail=result.get("detail", "Melt on cooldown"))
    return result


# Dealer: buy cars for cash (price = value * multiplier). Custom, exclusive, and loot_exclusive are not for sale.
# Stock per model and price multiplier vary by rarity: rarer = less stock, more overpriced.
DEALER_EXCLUDED_IDS = {"car_custom", "car20"}
# Replenish at random intervals so restocks are spread throughout the day
DEALER_REPLENISH_MIN_SEC = 1 * 3600   # 1 hour
DEALER_REPLENISH_MAX_SEC = 4 * 3600   # 4 hours
# Chance to restock this cycle (rarer = less often; sometimes high rarities don't stock)
DEALER_RESTOCK_CHANCE_BY_RARITY = {
    "common": 1.0,
    "uncommon": 0.9,
    "rare": 0.75,
    "ultra_rare": 0.5,
    "legendary": 0.4,
    "custom": 0.0,
    "exclusive": 0.0,
}
# Max dealer stock per car model by rarity (rarer = scarcer)
DEALER_STOCK_MAX_BY_RARITY = {
    "common": 2,
    "uncommon": 2,
    "rare": 2,
    "ultra_rare": 1,
    "legendary": 1,
    "custom": 0,
    "exclusive": 0,
}
# Price multiplier by rarity (rarer = more overpriced)
DEALER_PRICE_MULTIPLIER_BY_RARITY = {
    "common": 1.35,
    "uncommon": 1.55,
    "rare": 1.8,
    "ultra_rare": 2.1,
    "legendary": 2.4,
    "custom": 1.2,
    "exclusive": 1.2,
}


def _dealer_max_stock(car_info: dict) -> int:
    r = car_info.get("rarity") or "common"
    return DEALER_STOCK_MAX_BY_RARITY.get(r, 2)


def _dealer_price_multiplier(car_info: dict) -> float:
    r = car_info.get("rarity") or "common"
    return DEALER_PRICE_MULTIPLIER_BY_RARITY.get(r, 1.35)


async def _fill_dealer_stock_full() -> None:
    """Insert max stock per sellable model (full dealer inventory). Caller must only run when collection is empty."""
    now = datetime.now(timezone.utc).isoformat()
    to_insert = []
    for c in CARS:
        if c.get("id") in DEALER_EXCLUDED_IDS or c.get("rarity") == "loot_exclusive":
            continue
        max_stock = _dealer_max_stock(c)
        for _ in range(max_stock):
            to_insert.append({"car_id": c["id"], "added_at": now})
    if to_insert:
        await db.dealer_stock.insert_many(to_insert)


async def _ensure_dealer_stock_seeded():
    """If dealer_stock is empty, seed stock per car by rarity (except excluded)."""
    n = await db.dealer_stock.count_documents({})
    if n > 0:
        return
    await _fill_dealer_stock_full()


async def _dealer_full_restock_if_dealer_empty() -> None:
    """After a sale: only when the dealer has zero cars left in total, refill the full lot (all models to max)."""
    if await db.dealer_stock.count_documents({}) > 0:
        return
    await _fill_dealer_stock_full()


async def get_cars_for_sale(current_user: dict = Depends(get_current_user)):
    """List dealer cars: one row per model with in_stock count. Excludes custom and exclusive. Any rank can buy."""
    pipeline = [{"$group": {"_id": "$car_id", "count": {"$sum": 1}}}]
    counts = await db.dealer_stock.aggregate(pipeline).to_list(100)
    stock_by_car = {d["_id"]: d["count"] for d in counts}
    out = []
    for c in CARS:
        if c.get("id") in DEALER_EXCLUDED_IDS or c.get("rarity") == "loot_exclusive":
            continue
        car_id = c.get("id")
        in_stock = stock_by_car.get(car_id, 0)
        price = int(c.get("value", 0) * _dealer_price_multiplier(c))
        out.append({
            **{k: v for k, v in c.items()},
            "dealer_price": price,
            "in_stock": in_stock,
            "can_buy": in_stock > 0,
        })
    return {"cars": out}


async def buy_car(
    request: GTABuyCarRequest, current_user: dict = Depends(get_current_user_verified)
):
    """Purchase one car from the dealer for cash. Removes one from dealer stock."""
    car_info = next((c for c in CARS if c.get("id") == request.car_id), None)
    if not car_info:
        raise HTTPException(status_code=400, detail="Car not found")
    if car_info.get("id") in DEALER_EXCLUDED_IDS or car_info.get("rarity") == "loot_exclusive":
        raise HTTPException(status_code=400, detail="That car is not for sale")
    price = int(car_info.get("value", 0) * _dealer_price_multiplier(car_info))
    result = await db.users.update_one(
        {"id": current_user.get("id") or "", "money": {"$gte": price}},
        {"$inc": {"money": -price}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail=f"Insufficient money. Need ${price:,}.")
    result = await db.dealer_stock.delete_one({"car_id": request.car_id})
    if result.deleted_count == 0:
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": price}})
        raise HTTPException(status_code=400, detail="That car is out of stock. Try again in a moment.")
    await _dealer_full_restock_if_dealer_empty()
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user.get("id") or "",
        "car_id": request.car_id,
        "car_name": car_info.get("name"),
        "acquired_at": now.isoformat(),
        "damage_percent": 0,
    }
    await db.user_cars.insert_one(doc)
    _invalidate_travel_info_cache(current_user.get("id") or "")
    now_iso = now.isoformat()
    await db.money_transfers.insert_one({
        "id": str(uuid.uuid4()),
        "from_user_id": current_user.get("id") or "",
        "from_username": current_user.get("username") or "",
        "to_user_id": "__dealer__",
        "to_username": "Dealer",
        "amount": price,
        "created_at": now_iso,
        "car_name": car_info.get("name"),
        "transfer_type": "car_purchase",
    })
    try:
        from routers.money.bank import _invalidate_overview_cache
        _invalidate_overview_cache(current_user.get("id") or "")
    except Exception:
        pass
    await log_activity(
        current_user.get("id") or "",
        current_user.get("username") or "?",
        "garage_buy_car",
        {"car_id": request.car_id, "car_name": car_info.get("name"), "price": price, "source": "dealer"},
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
        {"listed_for_sale": True, "user_id": {"$ne": current_user.get("id") or ""}},
        {"_id": 1, "id": 1, "user_id": 1, "car_id": 1, "car_name": 1, "custom_name": 1, "sale_price": 1, "listed_at": 1, "damage_percent": 1},
    ).sort("listed_at", -1)
    listings = await cursor.to_list(200)
    seller_ids = list({uc["user_id"] for uc in listings if uc.get("user_id")})
    seller_map = {}
    if seller_ids:
        async for u in db.users.find(
            {"id": {"$in": seller_ids}},
            {"_id": 0, "id": 1, "username": 1},
        ):
            seller_map[u["id"]] = u
    out = []
    for uc in listings:
        car_info = next((c for c in CARS if c.get("id") == uc.get("car_id")), None)
        if not car_info:
            continue
        display_name = (uc.get("custom_name") or uc.get("car_name") or car_info.get("name")) if uc.get("car_id") == "car_custom" else (uc.get("car_name") or car_info.get("name"))
        seller = seller_map.get(uc.get("user_id") or "")
        listing_id = uc.get("id") or str(uc.get("_id", ""))
        # Custom cars never have damage
        car_id = uc.get("car_id")
        damage = 0 if car_id == "car_custom" else min(100, max(0, float(uc.get("damage_percent", 0))))
        # Public marketplace response: expose only seller_username, never raw seller_id
        out.append({
            "user_car_id": listing_id,
            "seller_username": (seller or {}).get("username", "?"),
            "car_id": car_id,
            "name": display_name,
            "value": car_info.get("value", 0),
            "rarity": car_info.get("rarity", "common"),
            "image": car_info.get("image"),
            "sale_price": uc.get("sale_price", 0),
            "listed_at": uc.get("listed_at"),
            "damage_percent": damage,
        })
    return {"listings": out}


async def list_car(
    request: GTAListCarRequest, current_user: dict = Depends(get_current_user_verified)
):
    """List one of your cars for sale on the marketplace (other players can buy for cash)."""
    if request.price <= 0:
        raise HTTPException(status_code=400, detail="Price must be positive")
    user_car = await db.user_cars.find_one(
        {"user_id": current_user.get("id") or "", "id": request.user_car_id}
    )
    if not user_car:
        try:
            user_car = await db.user_cars.find_one(
                {"user_id": current_user.get("id") or "", "_id": ObjectId(request.user_car_id)}
            )
        except Exception:
            user_car = None
    if not user_car:
        raise HTTPException(status_code=404, detail="Car not found in your garage")
    if user_car.get("listed_for_sale"):
        raise HTTPException(status_code=400, detail="Car is already listed")
    family_id = current_user.get("family_id")
    if family_id and await _family_in_active_war(family_id):
        car_info = next((c for c in CARS if c.get("id") == user_car.get("car_id")), None)
        if car_info and car_info.get("rarity") in ("exclusive", "loot_exclusive"):
            raise HTTPException(status_code=403, detail="Exclusive and loot-exclusive cars cannot be sold during a family war")
    now = datetime.now(timezone.utc).isoformat()
    if user_car.get("_id") is not None:
        q = {"_id": user_car["_id"]}
    else:
        q = {"user_id": current_user.get("id") or "", "id": user_car.get("id")}
    await db.user_cars.update_one(q, {"$set": {"listed_for_sale": True, "sale_price": request.price, "listed_at": now}})
    await log_activity(
        current_user.get("id") or "",
        current_user.get("username") or "?",
        "garage_list_car",
        {"user_car_id": request.user_car_id, "car_id": user_car.get("car_id"), "car_name": user_car.get("car_name"), "sale_price": request.price},
    )
    return {"message": f"Listed for ${request.price:,}", "sale_price": request.price}


async def delist_car(
    request: GTADelistCarRequest, current_user: dict = Depends(get_current_user_verified)
):
    """Remove your car from the marketplace."""
    user_car = await db.user_cars.find_one(
        {"user_id": current_user.get("id") or "", "id": request.user_car_id}
    )
    if not user_car:
        try:
            user_car = await db.user_cars.find_one(
                {"user_id": current_user.get("id") or "", "_id": ObjectId(request.user_car_id)}
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
        q = {"user_id": current_user.get("id") or "", "id": user_car.get("id")}
    await db.user_cars.update_one(q, {"$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""}})
    await log_activity(current_user.get("id", ""), current_user.get("username", "?"), "gta_delist", {"car_id": user_car.get("car_id")})
    return {"message": "Car delisted"}


async def buy_listed_car(
    request: GTABuyListedCarRequest, current_user: dict = Depends(get_current_user_verified)
):
    """Buy a car listed by another player (pay cash to seller)."""
    buyer_id = current_user.get("id") or ""
    # Atomically claim the car before payment to prevent double-buy race condition
    claim_filter = {"id": request.user_car_id, "listed_for_sale": True, "user_id": {"$ne": buyer_id}}
    user_car = await db.user_cars.find_one_and_update(
        claim_filter,
        {"$set": {"listed_for_sale": False, "user_id": buyer_id}, "$unset": {"sale_price": "", "listed_at": ""}},
    )
    if not user_car:
        try:
            claim_filter_oid = {"_id": ObjectId(request.user_car_id), "listed_for_sale": True, "user_id": {"$ne": buyer_id}}
            user_car = await db.user_cars.find_one_and_update(
                claim_filter_oid,
                {"$set": {"listed_for_sale": False, "user_id": buyer_id}, "$unset": {"sale_price": "", "listed_at": ""}},
            )
        except Exception:
            user_car = None
    if not user_car:
        # Distinguish self-buy from unavailable
        maybe_car = await db.user_cars.find_one({"id": request.user_car_id, "listed_for_sale": True})
        if not maybe_car:
            try:
                maybe_car = await db.user_cars.find_one({"_id": ObjectId(request.user_car_id), "listed_for_sale": True})
            except Exception:
                pass
        if maybe_car and maybe_car.get("user_id") == buyer_id:
            raise HTTPException(status_code=400, detail="Cannot buy your own listing")
        raise HTTPException(status_code=400, detail="Car no longer available")
    seller_id = user_car.get("user_id")
    rollback_q = {"_id": user_car["_id"]} if user_car.get("_id") else {"id": user_car.get("id")}

    def _rollback_car():
        return db.user_cars.update_one(
            rollback_q,
            {"$set": {"user_id": seller_id, "listed_for_sale": True, "sale_price": int(user_car.get("sale_price") or 0), "listed_at": user_car.get("listed_at")}},
        )

    car_info = next((c for c in CARS if c.get("id") == user_car.get("car_id")), None)
    if car_info and car_info.get("rarity") in ("exclusive", "loot_exclusive"):
        seller_family_id = await resolve_family_id(seller_id)
        if seller_family_id and await _family_in_active_war(seller_family_id):
            await _rollback_car()
            raise HTTPException(status_code=403, detail="Cannot buy — seller's family is at war; exclusive cars cannot be sold during war")
    price = int(user_car.get("sale_price") or 0)
    if price <= 0:
        await _rollback_car()
        raise HTTPException(status_code=400, detail="Invalid listing")
    buyer = await db.users.find_one({"id": buyer_id})
    if not buyer:
        await _rollback_car()
        raise HTTPException(status_code=400, detail=f"Insufficient money. Need ${price:,}.")
    result = await db.users.update_one(
        {"id": buyer_id, "money": {"$gte": price}},
        {"$inc": {"money": -price}},
    )
    if result.modified_count == 0:
        await _rollback_car()
        raise HTTPException(status_code=400, detail=f"Insufficient money. Need ${price:,}.")
    car_name = (user_car.get("custom_name") or user_car.get("car_name") or (car_info or {}).get("name") or "Car") if (user_car.get("car_id") == "car_custom") else ((car_info or {}).get("name") or user_car.get("car_name") or "Car")
    # Ownership already transferred by find_one_and_update; pay seller
    await db.users.update_one({"id": seller_id}, {"$inc": {"money": price}})
    seller = await db.users.find_one({"id": seller_id}, {"_id": 0, "username": 1})
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.economy_events.insert_one({
        "at": now_iso,
        "type": "car_trade",
        "buyer_id": buyer_id,
        "buyer_username": current_user.get("username") or "",
        "seller_id": seller_id,
        "seller_username": (seller or {}).get("username") or "?",
        "user_car_id": user_car.get("id"),
        "car_id": user_car.get("car_id"),
        "car_name": car_name,
        "price": price,
    })
    await db.money_transfers.insert_one({
        "id": str(uuid.uuid4()),
        "from_user_id": buyer_id,
        "from_username": current_user.get("username") or "",
        "to_user_id": seller_id,
        "to_username": (seller or {}).get("username") or "?",
        "amount": price,
        "created_at": now_iso,
        "car_name": car_name,
        "transfer_type": "car_trade",
    })
    try:
        from routers.money.bank import _invalidate_overview_cache
        _invalidate_overview_cache(buyer_id)
        _invalidate_overview_cache(seller_id)
    except Exception:
        pass
    await log_activity(
        buyer_id,
        current_user.get("username") or "?",
        "garage_buy_listed_car",
        {"car_id": user_car.get("car_id"), "car_name": car_name, "price": price, "seller_id": seller_id, "seller_username": (seller or {}).get("username", "?")},
    )
    return {
        "message": f"Purchased {car_name} from seller for ${price:,}",
        "car_id": user_car.get("car_id"),
        "user_car_id": user_car.get("id"),
    }


# Repair cost = (damage% / 100) * (car value * fraction) — 100% damage = fraction of value
REPAIR_COST_FRACTION = 0.6


async def repair_car(
    request: GTARepairCarRequest, current_user: dict = Depends(get_current_user_verified)
):
    """Repair a car in the garage (pay cash to set damage to 0)."""
    user_car = await db.user_cars.find_one(
        {"user_id": current_user.get("id") or "", "id": request.user_car_id}
    )
    if not user_car:
        try:
            user_car = await db.user_cars.find_one(
                {"user_id": current_user.get("id") or "", "_id": ObjectId(request.user_car_id)}
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
    result = await db.users.update_one(
        {"id": current_user.get("id") or "", "money": {"$gte": cost}},
        {"$inc": {"money": -cost}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail=f"Insufficient money. Repair costs ${cost:,}.")
    if user_car.get("_id") is not None:
        q = {"_id": user_car["_id"]}
    else:
        q = {"user_id": current_user.get("id") or "", "id": user_car.get("id")}
    await db.user_cars.update_one(q, {"$set": {"damage_percent": 0}})
    await log_activity(current_user.get("id", ""), current_user.get("username", "?"), "gta_repair", {"car": car_info.get("name"), "cost": cost})
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
        out["travel_time"] = TRAVEL_TIMES.get("custom", 12)
    else:
        out["travel_time"] = TRAVEL_TIMES.get(rarity, 45)
    return out


async def _is_car_on_owner_profile(db, owner_id: str, user_car_id: str) -> bool:
    """Return True only if this specific car is in the owner's explicitly selected profile cars list."""
    owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "profile_show_cars": 1, "profile_car_ids": 1, "profile_featured_car_id": 1})
    if not owner or not owner.get("profile_show_cars"):
        return False
    car_ids = owner.get("profile_car_ids") or ([owner["profile_featured_car_id"]] if owner.get("profile_featured_car_id") else [])
    return user_car_id in car_ids


async def update_custom_car_image(
    user_car_id: str,
    request: CustomCarImageUpdate,
    current_user: dict = Depends(get_current_user_verified),
):
    """Update the custom car picture URL for a user's custom car (car_id car_custom)."""
    user_car = await db.user_cars.find_one(
        {"user_id": current_user.get("id") or "", "id": user_car_id}
    )
    if not user_car:
        try:
            user_car = await db.user_cars.find_one(
                {"user_id": current_user.get("id") or "", "_id": ObjectId(user_car_id)}
            )
        except Exception:
            user_car = None
    if not user_car:
        raise HTTPException(status_code=404, detail="Car not found in your garage")
    if user_car.get("car_id") != "car_custom":
        raise HTTPException(status_code=400, detail="Only custom cars can have a custom picture")

    value = (request.image_url or "").strip() or None

    if value is not None:
        # Size check for data URLs
        if value.lower().startswith("data:") and len(value) > CAR_IMAGE_MAX_DATA_URL_BYTES:
            raise HTTPException(status_code=400, detail="Image too large. Use a smaller image.")
        is_valid, error_msg = await validate_custom_car_image_value(value)
        if not is_valid:
            raise HTTPException(status_code=400, detail=error_msg)

    if user_car.get("_id") is not None:
        q = {"_id": user_car["_id"]}
    else:
        q = {"user_id": current_user.get("id") or "", "id": user_car.get("id")}

    if value is None:
        await db.user_cars.update_one(q, {"$unset": {"custom_image_url": ""}})
    else:
        await db.user_cars.update_one(q, {"$set": {"custom_image_url": value}})
    return {"message": "Picture updated"}


async def get_view_car(
    id: str = Query(..., alias="id", description="Personal car instance id (user_car_id)"),
    current_user: dict = Depends(get_current_user),
):
    """Return a specific car instance by its personal id (user_car_id). Own car: full details. Others: if listed for sale or shown on profile."""
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
    car_id = user_car.get("car_id")
    rarity = car_info.get("rarity") or "common"
    travel_time = TRAVEL_TIMES.get("custom", 12) if car_id == "car_custom" else TRAVEL_TIMES.get(rarity, 45)
    # Custom cars never have damage
    damage_percent = 0 if car_id == "car_custom" else min(100, max(0, float(user_car.get("damage_percent", 0))))
    name = user_car.get("custom_name") or user_car.get("car_name") or car_info.get("name")
    image = car_info.get("image")
    if car_id == "car_custom" and user_car.get("custom_image_url"):
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
    if owner_id == current_user.get("id") or "":
        out["owner"] = "you"
        out["listed_for_sale"] = bool(user_car.get("listed_for_sale"))
        out["sale_price"] = user_car.get("sale_price")
        user_doc = await db.users.find_one({"id": current_user.get("id") or ""}, {"_id": 0, "profile_featured_car_id": 1, "profile_show_cars": 1, "profile_car_ids": 1})
        car_ids_on_profile = (user_doc or {}).get("profile_car_ids") or ([(user_doc or {}).get("profile_featured_car_id")] if (user_doc or {}).get("profile_featured_car_id") else [])
        out["profile_car_ids"] = car_ids_on_profile
        out["featured_on_profile"] = user_car.get("id") in car_ids_on_profile
        out["show_cars_on_profile"] = (user_doc or {}).get("profile_show_cars", False)
    else:
        if user_car.get("listed_for_sale"):
            seller = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1})
            out["owner"] = "listing"
            out["seller_username"] = (seller or {}).get("username", "?")
            out["sale_price"] = user_car.get("sale_price")
            out["listed_for_sale"] = True
        else:
            on_profile = await _is_car_on_owner_profile(db, owner_id, user_car.get("id"))
            if not on_profile:
                raise HTTPException(status_code=404, detail="Car not found")
            seller = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1})
            out["owner"] = "profile"
            out["seller_username"] = (seller or {}).get("username", "?")
            out["listed_for_sale"] = False
    return out


async def run_dealer_replenish_loop():
    """Replenish dealer stock every 1-4h. Sold-out models always refill; partial stock may skip (rarer = less often)."""
    import server as srv
    await asyncio.sleep(60)  # delay first run after startup
    while True:
        try:
            db = srv.db
            now = datetime.now(timezone.utc).isoformat()
            for c in CARS:
                if c.get("id") in DEALER_EXCLUDED_IDS or c.get("rarity") == "loot_exclusive":
                    continue
                car_id = c["id"]
                max_stock = _dealer_max_stock(c)
                count = await db.dealer_stock.count_documents({"car_id": car_id})
                need = max(0, max_stock - count)
                if need <= 0:
                    continue
                # Sold out: always restock next cycle (no RNG skip). Partial stock: rarer models may skip topping up.
                r = c.get("rarity") or "common"
                if count > 0:
                    restock_chance = DEALER_RESTOCK_CHANCE_BY_RARITY.get(r, 0.8)
                    if _rng.random() > restock_chance:
                        continue
                await db.dealer_stock.insert_many([{"car_id": car_id, "added_at": now} for _ in range(need)])
        except Exception as e:
            logger.exception("Dealer replenish loop: %s", e)
        delay = _rng.uniform(DEALER_REPLENISH_MIN_SEC, DEALER_REPLENISH_MAX_SEC)
        await asyncio.sleep(delay)


async def get_gta_exclusive_pool_status(current_user: dict = Depends(get_current_user)):
    """Return whether the Al Capone exclusive is currently in the GTA car pool (any authenticated user)."""
    doc = await db.game_config.find_one({"id": GTA_EXCLUSIVE_POOL_CONFIG_ID}, {"_id": 0, "released": 1})
    return {"exclusive_in_pool": bool(doc.get("released") if doc else False)}


def register(router):
    router.add_api_route("/gta/options", get_gta_options, methods=["GET"])
    router.add_api_route("/gta/exclusive-pool-status", get_gta_exclusive_pool_status, methods=["GET"])
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
    router.add_api_route("/gta/custom-car/{user_car_id}", update_custom_car_image, methods=["PATCH"])
    router.add_api_route("/gta/view-car", get_view_car, methods=["GET"])