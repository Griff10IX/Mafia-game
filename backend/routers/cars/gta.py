# GTA endpoints: options, attempt, garage, melt
import asyncio
import logging
import secrets
import time
from datetime import datetime, timezone, timedelta
_rng = secrets.SystemRandom()
import uuid
from typing import List, Optional, Dict, Any, Tuple
from fastapi import Depends, HTTPException, Query, Request
from bson.objectid import ObjectId
from pydantic import BaseModel
from pymongo import ReturnDocument, UpdateOne

from utils.family_perks import family_perk_modifiers
from utils.game_pass_micro_rewards import apply_game_pass_wait_seconds
from utils.garage_dealership import (
    GARAGE_DEALERSHIP_CLAIM_COST_POINTS,
    GARAGE_DEALERSHIP_ID,
    DEALER_OWNER_STOCK_FEE_RATE,
    DEALER_OWNER_STOCK_MAX_PER_MODEL,
    DEALER_OWNER_STOCK_DEFAULT_TARGET,
    DEALER_OWNER_STOCKABLE_RARITIES,
    dealership_sale_profit,
    dealer_owner_profit_cut,
    p2p_owner_profit_cut,
    get_garage_dealership,
    credit_garage_dealership_profit,
    debit_garage_dealership_profit,
    user_owns_garage_dealership,
    cancel_garage_dealership_quicktrade_listings,
    dealership_auto_stock_defaults,
    maybe_auto_relinquish_dealership_stack_conflict,
    dealership_stack_conflict_status,
)
from utils.global_property_owner_shares import load_global_property_owner_shares

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

# Post-attempt bookkeeping (events, logs, objectives, milestones) runs after the HTTP response.
_gta_bookkeeping_locks: Dict[str, asyncio.Lock] = {}
_gta_bookkeeping_tasks: set = set()


async def _get_gta_garage_lock(user_id: str) -> asyncio.Lock:
    uid = user_id or ""
    async with _gta_garage_locks_guard:
        if uid not in _gta_garage_locks:
            _gta_garage_locks[uid] = asyncio.Lock()
        return _gta_garage_locks[uid]


def _spawn_gta_bookkeeping(user_id: str, coro_factory) -> None:
    """Run coro_factory() in the background, serialized per user."""
    lock = _gta_bookkeeping_locks.setdefault(user_id or "", asyncio.Lock())

    async def _runner():
        async with lock:
            try:
                await coro_factory()
            except Exception:
                logger.exception("gta post-attempt bookkeeping failed user_id=%s", user_id)

    task = asyncio.create_task(_runner())
    _gta_bookkeeping_tasks.add(task)
    task.add_done_callback(_gta_bookkeeping_tasks.discard)


# ---------------------------------------------------------------------------
# GTA options and request/response models
# ---------------------------------------------------------------------------

# Cooldowns in seconds. First GTA 60s, then scale up. Unlock by rank.
# Option success_rate is legacy; live steal chance uses progress → 55% / 65% caps.
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
    # Garage Melt/Scrap rarity ticks. Server-enforced so exclusives cannot melt when unticked.
    rarity_ids: Optional[List[str]] = None


class GTABuyCarRequest(BaseModel):
    car_id: str


class GTABuyCarBulkItem(BaseModel):
    car_id: str
    quantity: int = 1


class GTABuyCarsBulkRequest(BaseModel):
    car_ids: Optional[List[str]] = None  # legacy: 1 each
    items: Optional[List[GTABuyCarBulkItem]] = None


DEALER_BUY_BULK_MAX = 200


class GTAListCarRequest(BaseModel):
    user_car_id: str
    price: int


class GTADelistCarRequest(BaseModel):
    user_car_id: str


class GTABuyListedCarRequest(BaseModel):
    user_car_id: str


class DealershipSendToUserRequest(BaseModel):
    target_username: str


class DealershipSellOnTradeRequest(BaseModel):
    points: int


class DealershipStockRequest(BaseModel):
    rarity: str
    target_per_model: int = DEALER_OWNER_STOCK_DEFAULT_TARGET
    pay_from: str = "cash"  # cash | profit


class DealershipAutoStockRequest(BaseModel):
    enabled: bool
    rarity: Optional[str] = None
    target_per_model: int = DEALER_OWNER_STOCK_DEFAULT_TARGET


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
    cooldown_until: Optional[str] = None


# ---------------------------------------------------------------------------
# Progress and messages
# ---------------------------------------------------------------------------

from server import (
    db,
    get_current_user,
    get_current_user_verified,
    _is_admin,
    get_rank_info,
    user_prestige_rank_mult,
    get_effective_event,
    get_prestige_bonus,
    founding_member_income_mult,
    rank_xp_pass_multiplier,
    maybe_process_rank_up,
    maybe_respect_points_drop,
    log_activity,
    log_melt_event,
    log_respect_earned,
    send_notification,
    RANKS,
    CARS,
    TRAVEL_TIMES,
    travel_seconds_for_car,
    MELT_VALUE_PER_BULLET,
    MELT_BULLETS_VALUE_MULT_NUM,
    MELT_BULLETS_VALUE_MULT_DEN,
    DEFAULT_GARAGE_BATCH_LIMIT,
    GARAGE_BATCH_LIMIT_MAX,
    CustomCarImageUpdate,
    CAPO_RANK_ID,
    _family_in_active_war,
    _username_pattern,
    maybe_auto_relinquish_below_capo,
    _user_owns_any_property,
)
from routers.account.objectives import update_objectives_progress
from routers.admin.airport import _invalidate_travel_info_cache
from routers.game.achievements import badge_bonuses_from_user
from routers.game.families import resolve_family_id
from utils.family_vault_log import log_family_vault_tx
from utils.game_pass_season_rp import apply_season_rp_mirror_to_update, rank_points_in_update
from utils.location_climate import get_location_climate, rank_multiplier_for_actor, success_multiplier_for_actor
from utils.rolling_event_stats import (
    fetch_rolling_event_stats,
    invalidate_rolling_event_stats_cache,
)

# Family members in an active war cannot liquidate exclusive / loot-exclusive cars (list, scrap, melt).
EXCLUSIVE_CAR_WAR_LOCK_DETAIL = (
    "Exclusive and loot-exclusive cars are locked while your family is at war. "
    "You cannot sell, scrap, or melt them until the war ends; they can still transfer if you are killed in PvP."
)
GARAGE_DEALERSHIP_WAR_LOCK_DETAIL = (
    "You cannot transfer or list your car dealership on Quick Trade while your family is at war."
)
GARAGE_DEALERSHIP_PROPERTY_CONFLICT_DETAIL = (
    "You already own an airport or armoury. Relinquish it before claiming the car dealership."
)
GARAGE_DEALERSHIP_TRANSFER_TARGET_CONFLICT_DETAIL = (
    "That player already owns an airport or armoury and cannot hold the car dealership."
)
from utils.minigame_captcha_gate import require_turnstile_for_game_action
from utils.civilian_protection import (
    is_civilian_protected,
    maybe_revoke_civilian_protection,
    raise_if_civilian_protected_asset_recipient,
    require_protection_revoke_confirm,
)
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_GTA


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


def _normalize_user_car_instance_id(raw) -> str:
    """user_cars.id is a string UUID; never pass uuid.UUID (Atlas logs those as $uuid / misses string index)."""
    if raw is None:
        return ""
    if isinstance(raw, uuid.UUID):
        return str(raw)
    s = str(raw).strip()
    if len(s) >= 2 and s[0] == "{" and s[-1] == "}":
        s = s[1:-1]
    return s


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

# Al Capone exclusive (car20): admin can release into GTA pool; only 1 in game at a time; very rare drop on any GTA tier
GTA_EXCLUSIVE_CAR_ID = "car20"
GTA_EXCLUSIVE_POOL_CONFIG_ID = "gta_exclusive"
# Per-success chance ≈ w/(1+w) for scaled weight w (see tier-neutral exclusive scaling below); ~1 in 167k when w = 0.000006
GTA_EXCLUSIVE_DROP_WEIGHT_DEFAULT = 0.000006
GTA_EXCLUSIVE_DROP_WEIGHT_MIN = 0.0000001
GTA_EXCLUSIVE_DROP_WEIGHT_MAX = 0.05
# When the heist pool includes legendary cars, this fraction of *successful* steals roll legendary (then uniform over those models).
GTA_LEGENDARY_STEAL_CHANCE = 1 / 50
# Non-legendary pool: base weights (rare / ultra_rare intentionally below common). Prestige/perk adds slope * rare_boost on top.
GTA_NON_LEGENDARY_RARITY_BASE_WEIGHT = {
    "common": 1.0,
    "uncommon": 0.88,
    "rare": 0.28,
    "ultra_rare": 0.14,
}
GTA_NON_LEGENDARY_RARITY_BOOST_SLOPE = {
    "common": 0.0,
    "uncommon": 0.45,
    "rare": 0.55,
    "ultra_rare": 0.70,
}
# Street Parking (difficulty 1) rolls uncommon/rare too, but leaner than the global
# weights: with 6 common / 4 uncommon / 4 rare cars this lands ~65% / ~26.5% / ~8.5%.
GTA_STREET_PARKING_RARITY_BASE_WEIGHT = {
    "common": 1.0,
    "uncommon": 0.61,
    "rare": 0.19,
}
# Difficulty-1 options can steal cars up to this catalog min_difficulty (pulls uncommon + rare in).
GTA_STREET_PARKING_MAX_CAR_DIFFICULTY = 3
# Residential Area (difficulty 2) also rolls rare, richer than Street Parking but leaner
# than difficulty-3 options: with 6 common / 4 uncommon / 4 rare this lands ~60% / ~30.4% / ~9.6%.
GTA_RESIDENTIAL_RARITY_BASE_WEIGHT = {
    "common": 1.0,
    "uncommon": 0.76,
    "rare": 0.24,
}
GTA_RESIDENTIAL_MAX_CAR_DIFFICULTY = 3
# Better heists pay better rank points on top of car rarity.
GTA_DIFFICULTY_RANK_POINTS_MULT = {1: 1.0, 2: 1.25, 3: 1.5, 4: 1.75, 5: 2.0}
REFERRED_USER_GTA_RARE_BOOST = 0.10  # GTA rare car weight boost for referred signups (pairs with ~10% copy)
FOUNDING_MEMBER_GTA_RARE_BOOST = 0.15  # Founding Member: extra weight toward rarer cars


def _gta_non_legendary_roll_weight(
    rarity: Optional[str],
    rare_boost: float,
    base_weights: Optional[Dict[str, float]] = None,
) -> float:
    r = (rarity or "common").strip() or "common"
    weights = base_weights if base_weights is not None else GTA_NON_LEGENDARY_RARITY_BASE_WEIGHT
    base = weights.get(r)
    if base is None:
        base = 1.0
    slope = GTA_NON_LEGENDARY_RARITY_BOOST_SLOPE.get(r, 0.0)
    w = base + slope * max(rare_boost, 0.0)
    return max(w, 0.001)


def _gta_pool_max_car_difficulty(option_difficulty: int) -> int:
    """Difficulty-1/2 options roll bonus uncommon/rare tiers; others use their own difficulty."""
    d = int(option_difficulty or 1)
    if d == 1:
        return GTA_STREET_PARKING_MAX_CAR_DIFFICULTY
    if d == 2:
        return GTA_RESIDENTIAL_MAX_CAR_DIFFICULTY
    return d


_GTA_RARITY_SORT_ORDER = {"common": 0, "uncommon": 1, "rare": 2, "ultra_rare": 3, "legendary": 4}


def _gta_possible_cars_for_option(option: dict) -> List[dict]:
    """Public list of cars this option can steal (matches the attempt pool filter; no odds exposed)."""
    max_difficulty = _gta_pool_max_car_difficulty(option.get("difficulty", 1))
    cars = [
        c
        for c in CARS
        if c["min_difficulty"] <= max_difficulty
        and c["rarity"] != "exclusive"
        and c.get("rarity") not in ("loot_exclusive", "vip_exclusive")
        and c.get("id") != "car_custom"
    ]
    cars.sort(key=lambda c: (_GTA_RARITY_SORT_ORDER.get(c.get("rarity") or "common", 0), c.get("value", 0)))
    return [
        {
            "id": c["id"],
            "name": c["name"],
            "rarity": c["rarity"],
            "value": c.get("value", 0),
            "image": c.get("image"),
        }
        for c in cars
    ]


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

# Al Capone (car20) exists at most once globally; nav polls were counting user_cars on every GTA page load.
_CAR20_OWNED_COUNT_CACHE_SEC = 12.0
_car20_owned_count_cache: Dict[str, Any] = {"t": 0.0, "n": None}


def invalidate_car20_owned_count_cache() -> None:
    _car20_owned_count_cache["n"] = None


async def _count_car20_owned(*, refresh: bool = False) -> int:
    """Cached global count of Al Capone copies (0 or 1 in normal operation)."""
    now = time.monotonic()
    if not refresh and _car20_owned_count_cache["n"] is not None:
        if now - float(_car20_owned_count_cache["t"]) < _CAR20_OWNED_COUNT_CACHE_SEC:
            return int(_car20_owned_count_cache["n"])
    n = await db.user_cars.count_documents({"car_id": GTA_EXCLUSIVE_CAR_ID})
    _car20_owned_count_cache["n"] = n
    _car20_owned_count_cache["t"] = now
    return n


async def _gta_exclusive_pool_released_from_config() -> bool:
    """Read pool flag only — no user_cars scan (for nav/badge polls)."""
    doc = await db.game_config.find_one(
        {"id": GTA_EXCLUSIVE_POOL_CONFIG_ID},
        {"_id": 0, "released": 1},
    )
    return bool((doc or {}).get("released"))


async def _sync_gta_exclusive_pool_release_state() -> bool:
    """
    Keep GTA exclusive pool release in sync with ownership.
    - If any copy exists: released=False.
    - If no copies exist: released=True (auto-reopen pool).
    Call after ownership changes (melt/transfer/admin), not on every GTA attempt or nav poll.
    """
    existing_count = await _count_car20_owned(refresh=True)
    should_release = existing_count == 0
    await db.game_config.update_one(
        {"id": GTA_EXCLUSIVE_POOL_CONFIG_ID},
        {"$set": {"released": should_release}},
        upsert=True,
    )
    return should_release


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

# Steal chance caps: progress bar maps up to NO_PERKS; events/climate can raise to WITH_PERKS.
GTA_SUCCESS_CAP_NO_PERKS = 0.55
GTA_SUCCESS_CAP_WITH_PERKS = 0.65
# Legacy name kept for any imports; no longer applied as a post-progress multiplier.
GTA_DIFFICULTY_MULT = 1.0


def _gta_base_success_from_progress(progress: int) -> float:
    """Map progress bar (MIN..MAX) to steal chance, peaking at 55% with no perk multipliers."""
    p = max(GTA_PROGRESS_MIN, min(GTA_PROGRESS_MAX, int(progress)))
    span = GTA_PROGRESS_MAX - GTA_PROGRESS_MIN
    if span <= 0:
        return float(GTA_SUCCESS_CAP_NO_PERKS)
    t = (p - GTA_PROGRESS_MIN) / float(span)
    low = GTA_PROGRESS_MIN / 100.0
    high = float(GTA_SUCCESS_CAP_NO_PERKS)
    return low + t * (high - low)


def _gta_final_success_chance(
    progress: int,
    *,
    event_mult: float = 1.0,
    climate_mult: float = 1.0,
) -> float:
    """Effective steal probability: base from progress, then event/climate, hard-capped at 65%."""
    base = _gta_base_success_from_progress(progress)
    em = max(0.0, float(event_mult if event_mult is not None else 1.0))
    cm = max(0.0, float(climate_mult if climate_mult is not None else 1.0))
    return min(float(GTA_SUCCESS_CAP_WITH_PERKS), max(0.0, base * em * cm))

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
    user_rank, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
    option_ids = [o["id"] for o in GTA_OPTIONS]
    cooldown_doc, user_gta_list, ev = await asyncio.gather(
        db.gta_cooldowns.find_one(
            {"user_id": current_user.get("id") or ""},
            {"_id": 0, "cooldown_until": 1},
        ),
        db.user_gta.find(
            {"user_id": current_user.get("id") or "", "option_id": {"$in": option_ids}},
            {"_id": 0, "option_id": 1, "attempts": 1, "successes": 1, "progress": 1, "progress_max": 1},
        ).to_list(len(option_ids)),
        get_effective_event(),
    )
    gta_cd_off = 0
    try:
        rpm = await family_perk_modifiers(db, current_user.get("family_id"))
        gta_cd_off = int(rpm.get("gta_seconds_off") or 0)
    except Exception:
        pass
    _climate = get_location_climate()
    climate_mult = success_multiplier_for_actor(current_user.get("current_state"), _climate)
    event_mult = float((ev or {}).get("gta_success", 1.0) or 1.0)
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
        base_chance = _gta_base_success_from_progress(progress)
        final_chance = _gta_final_success_chance(
            progress, event_mult=event_mult, climate_mult=climate_mult
        )

        row = dict(opt)
        row["unlocked"] = user_rank >= opt["min_rank"]
        row["min_rank_name"] = next(
            (r["name"] for r in RANKS if r["id"] == opt["min_rank"]),
            f"Rank {opt['min_rank']}",
        )
        row["cooldown"] = apply_game_pass_wait_seconds(max(1, int(opt["cooldown"]) - gta_cd_off), current_user)
        row["jail_time"] = apply_game_pass_wait_seconds(int(opt["jail_time"]), current_user)
        row["cooldown_until"] = global_cooldown_until
        row["attempts"] = attempts
        row["successes"] = successes
        row["progress"] = progress
        row["success_chance"] = int(round(final_chance * 100))
        row["success_chance_base"] = int(round(base_chance * 100))
        row["possible_cars"] = _gta_possible_cars_for_option(opt)
        result.append(row)
    return result


async def get_gta_playable_count(current_user: dict = Depends(get_current_user)):
    """Nav/badge: playable tier count + exclusive-in-pool (same bundle Layout used to fetch as two GETs)."""
    now = datetime.now(timezone.utc)
    user_rank, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
    released, cooldown_doc = await asyncio.gather(
        _gta_exclusive_pool_released_from_config(),
        db.gta_cooldowns.find_one(
            {"user_id": current_user.get("id") or ""},
            {"_id": 0, "cooldown_until": 1},
        ),
    )
    if cooldown_doc:
        until = _parse_iso_datetime(cooldown_doc.get("cooldown_until"))
        if until and until > now:
            return {"playable_count": 0, "exclusive_in_pool": bool(released)}
    playable = sum(1 for opt in GTA_OPTIONS if user_rank >= opt["min_rank"])
    return {"playable_count": playable, "exclusive_in_pool": bool(released)}


_GTA_SKIP_STOLEN_RARITY_FIELDS = {
    "common": "stolen_common",
    "uncommon": "stolen_uncommon",
    "rare": "stolen_rare",
    "ultra_rare": "stolen_ultra_rare",
    "legendary": "stolen_legendary",
    "exclusive": "stolen_exclusive",
    "loot_exclusive": "stolen_exclusive",
    "vip_exclusive": "stolen_exclusive",
    "custom": "stolen_custom",
}


async def _attempt_gta_impl(
    option_id: str,
    current_user: dict,
    caller_updates_total_gta: bool = False,
    *,
    used_gta_skip: bool = False,
) -> GTAAttemptResponse:
    """Run one GTA attempt. Caller must ensure option exists, user rank OK, and cooldown passed. Used by route and auto_rank.
    When caller_updates_total_gta is True (e.g. auto_rank), total_gta is not incremented here; the caller does it for leaderboard consistency.
    used_gta_skip: True when the caller already burned a GTA cooldown skip for this attempt."""
    option = next((o for o in GTA_OPTIONS if o["id"] == option_id), None)
    if not option:
        raise ValueError(f"Invalid GTA option: {option_id}")
    now = datetime.now(timezone.utc)
    uid = current_user.get("id") or ""
    now_iso = now.isoformat()
    gta_cd_off = 0
    try:
        rpm = await family_perk_modifiers(db, current_user.get("family_id"))
        gta_cd_off = int(rpm.get("gta_seconds_off") or 0)
    except Exception:
        pass
    cd_sec = max(1, int(option["cooldown"]) - gta_cd_off)
    cd_sec = apply_game_pass_wait_seconds(cd_sec, current_user)
    cooldown_until = now + timedelta(seconds=cd_sec)
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
                from utils.cooldown_skip import has_skip_credit, consume_skip_credit

                # Fresh credits — Auto Rank may have just activated a held token.
                fresh = await db.users.find_one(
                    {"id": uid},
                    {"_id": 0, "cooldown_skip_gta_credits": 1},
                )
                credit_user = {**(current_user or {}), **(fresh or {})}
                if has_skip_credit(credit_user, "gta") and await consume_skip_credit(db, uid, "gta"):
                    used_gta_skip = True
                    await db.gta_cooldowns.update_one(
                        {"user_id": uid},
                        {"$set": {"cooldown_until": cooldown_iso}},
                    )
                else:
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
    _climate = get_location_climate()
    gta_rate = _gta_final_success_chance(
        progress,
        event_mult=float((ev or {}).get("gta_success", 1.0) or 1.0),
        climate_mult=success_multiplier_for_actor(current_user.get("current_state"), _climate),
    )
    success = _rng.random() < gta_rate
    
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
    deferred_ops: list = []

    async def _post_attempt_common():
        try:
            from utils.tutorial import mark_tutorial_gta_done

            await mark_tutorial_gta_done(db, current_user.get("id") or "")
        except Exception:
            logging.exception("tutorial gta mark failed user_id=%s", current_user.get("id"))

    deferred_ops.append(_post_attempt_common)

    def _spawn_and_return(resp: GTAAttemptResponse) -> GTAAttemptResponse:
        resp.cooldown_until = cooldown_iso

        async def _run():
            for op in deferred_ops:
                await op()

        _spawn_gta_bookkeeping(uid, _run)
        return resp

    if success:
        # Store-bought custom car template — not a GTA steal reward (would look like random garage dupes).
        pool_max_difficulty = _gta_pool_max_car_difficulty(option["difficulty"])
        _option_difficulty = int(option["difficulty"])
        pool_weight_override = (
            GTA_STREET_PARKING_RARITY_BASE_WEIGHT if _option_difficulty == 1
            else GTA_RESIDENTIAL_RARITY_BASE_WEIGHT if _option_difficulty == 2
            else None
        )
        pool_cars = [
            c
            for c in CARS
            if c["min_difficulty"] <= pool_max_difficulty
            and c["rarity"] != "exclusive"
            and c.get("rarity") not in ("loot_exclusive", "vip_exclusive")
            and c.get("id") != "car_custom"
        ]
        if not pool_cars:
            pool_cars = [c for c in CARS if c["min_difficulty"] == 1]
        # Optional: Al Capone exclusive in pool (admin-released, only 1 in game; odds vs non-exclusive same on every tier)
        exclusive_car = next((c for c in CARS if c.get("id") == GTA_EXCLUSIVE_CAR_ID), None)
        exclusive_drop_weight = GTA_EXCLUSIVE_DROP_WEIGHT_DEFAULT
        exclusive_in_roll = False
        if exclusive_car:
            config = await db.game_config.find_one(
                {"id": GTA_EXCLUSIVE_POOL_CONFIG_ID},
                {"_id": 0, "released": 1, "drop_weight": 1},
            )
            if config and config.get("released"):
                exclusive_drop_weight = float((config or {}).get("drop_weight") or GTA_EXCLUSIVE_DROP_WEIGHT_DEFAULT)
                exclusive_drop_weight = max(GTA_EXCLUSIVE_DROP_WEIGHT_MIN, min(GTA_EXCLUSIVE_DROP_WEIGHT_MAX, exclusive_drop_weight))
                if await _count_car20_owned() == 0:
                    exclusive_in_roll = True
        # Auto-rank attempts should only roll exclusive while user is actively online.
        # Manual GTA attempts are not affected.
        if caller_updates_total_gta and exclusive_in_roll:
            active_for_exclusive = False
            now_for_active = datetime.now(timezone.utc)
            ls_raw = current_user.get("last_seen")
            ls_dt = _parse_iso_datetime(ls_raw) if ls_raw else None
            if ls_dt and (now_for_active - ls_dt).total_seconds() <= 300:
                active_for_exclusive = True
            fu_raw = current_user.get("forced_online_until")
            fu_dt = _parse_iso_datetime(fu_raw) if fu_raw else None
            if fu_dt and fu_dt > now_for_active:
                active_for_exclusive = True
            if not active_for_exclusive:
                exclusive_in_roll = False
        # Prestige / badge rare boost from in-memory user (no extra DB reads).
        _fm_gta = founding_member_income_mult(current_user)
        _rare_boost = get_prestige_bonus(current_user)["gta_rare_boost"]
        try:
            bb = badge_bonuses_from_user(current_user)
            _rare_boost += bb.get("gta", 0) * 0.001 * bb.get("prestige_badge_mult", 1)
        except Exception:
            pass
        # Referred user: extra weight toward rarer cars (see REFERRED_USER_GTA_RARE_BOOST)
        if user_has_referrers(current_user.get("referred_by")):
            _rare_boost += REFERRED_USER_GTA_RARE_BOOST
        if _fm_gta > 1.0:
            _rare_boost += FOUNDING_MEMBER_GTA_RARE_BOOST
        gta_rare_perk = int(current_user.get("gta_rare_drop_perk_attempts_remaining") or 0)
        if gta_rare_perk > 0:
            _rare_boost = max(_rare_boost, 1.0)
        legendary_cars = [c for c in pool_cars if (c.get("rarity") or "") == "legendary"]
        non_legendary_cars = [c for c in pool_cars if (c.get("rarity") or "") != "legendary"]
        if legendary_cars and _rng.random() < GTA_LEGENDARY_STEAL_CHANCE:
            car = _rng.choice(legendary_cars)
        else:
            base_pool = non_legendary_cars if non_legendary_cars else pool_cars
            # Scale exclusive weight by sum of non-exclusive weights so P(exclusive | success) = w/(1+w) for all tiers
            pool_weights = [
                _gta_non_legendary_roll_weight(c.get("rarity"), _rare_boost, pool_weight_override)
                for c in base_pool
            ]
            weight_sum = float(sum(pool_weights))
            if exclusive_in_roll and weight_sum > 0:
                ex_w = exclusive_drop_weight * weight_sum
                car = _rng.choices(base_pool + [exclusive_car], weights=pool_weights + [ex_w], k=1)[0]
            else:
                car = _rng.choices(base_pool, weights=pool_weights, k=1)[0]
        # Stolen car damage: custom/exclusive cars are always pristine.
        if _is_damage_immune_car(car.get("id"), car.get("rarity")):
            damage_percent = 0
        elif _rng.random() < 0.08:
            damage_percent = _rng.randint(0, 14)
        else:
            damage_percent = _rng.randint(15, 77)
        rank_points_map = {
            "common": 9,
            "uncommon": 24,
            "rare": 54,
            "ultra_rare": 105,
            "legendary": 180,
            "exclusive": 300,
        }
        rank_points = rank_points_map.get(car["rarity"], 3)
        rank_points = int(
            rank_points * GTA_DIFFICULTY_RANK_POINTS_MULT.get(int(option["difficulty"]), 1.0)
        )
        _ev_rp_mult = float(ev.get("rank_points", 1.0) or 1.0)
        _we_bonus_rp = 0
        if _ev_rp_mult > 1.0:
            _pre_rp = rank_points
            rank_points = int(rank_points * _ev_rp_mult)
            _we_bonus_rp = rank_points - _pre_rp
        else:
            rank_points = int(rank_points * _ev_rp_mult)
        now_utc = datetime.now(timezone.utc)
        rp_perk_until = _parse_iso_datetime(current_user.get("rp_perk_until"))
        if rp_perk_until and now_utc < rp_perk_until:
            rank_points = int(rank_points * 1.1)
        _xp_token_bonus = 0
        xp_gta_until = _parse_iso_datetime(current_user.get("xp_gta_until"))
        if xp_gta_until and now_utc < xp_gta_until:
            _xp_token_bonus = int(rank_points)  # the doubled slice equals the pre-double RP
            rank_points = rank_points * 2
        _gta_succ_mult = float(ev.get("gta_success", 1.0) or 1.0)
        pass_mult = float(rank_xp_pass_multiplier(current_user))
        rank_points = int(rank_points * pass_mult)
        rank_points = max(1, int(rank_points * rank_multiplier_for_actor(current_user.get("current_state"), _climate)))
        new_gta_uc_id = str(uuid.uuid4())
        car_acquired_at = datetime.now(timezone.utc).isoformat()
        await db.user_cars.insert_one(
            {
                "id": new_gta_uc_id,
                "user_id": current_user.get("id") or "",
                "car_id": car["id"],
                "car_name": car["name"],
                "acquired_at": car_acquired_at,
                "damage_percent": damage_percent,
            }
        )
        # If the Al Capone exclusive was just won, auto-disable pool release (must stay sync).
        if (car.get("id") or "") == GTA_EXCLUSIVE_CAR_ID:
            invalidate_car20_owned_count_cache()
            _car20_owned_count_cache["n"] = 1
            _car20_owned_count_cache["t"] = time.monotonic()
            await db.game_config.update_one(
                {"id": GTA_EXCLUSIVE_POOL_CONFIG_ID},
                {"$set": {"released": False}},
                upsert=True,
            )
        if (car.get("rarity") or "") in _MARKET_EXCLUSIVE_RARITIES:
            await maybe_revoke_civilian_protection(db, current_user.get("id") or "", "exclusive_car")
        _invalidate_travel_info_cache(current_user.get("id") or "")
        rp_before = int(current_user.get("rank_points") or 0)
        rp_granted = int(rank_points * _fm_gta)
        gta_inc = {"money": int(car["value"] * _fm_gta * pass_mult), "rank_points": rp_granted}
        if not caller_updates_total_gta:
            gta_inc["total_gta"] = 1
        if (car.get("rarity") or "").strip().lower() == "uncommon":
            gta_inc["uncommon_cars_stolen"] = 1
        if gta_rare_perk > 0:
            gta_inc["gta_rare_drop_perk_attempts_remaining"] = -1
        respect_drop = maybe_respect_points_drop()
        respect_from_drop = 0
        if respect_drop:
            respect_from_drop = max(0, int(respect_drop * RESPECT_FROM_GTA_MULT * _fm_gta * pass_mult))
            gta_inc["respect_points"] = respect_from_drop
        gta_update = apply_season_rp_mirror_to_update({"$inc": gta_inc}, user=current_user)
        await db.users.update_one(
            {"id": current_user.get("id") or ""},
            gta_update,
        )
        new_total_gta = (current_user.get("total_gta") or 0) + 1
        claimed = current_user.get("respect_points_gta_milestones_claimed") or []
        new_claimed = [m for m in GTA_MILESTONES if m <= new_total_gta and m not in claimed]
        milestone_respect = sum(GTA_MILESTONE_REWARDS.get(m, 0) for m in new_claimed)
        respect_earned = max(0, int((respect_drop or 0) * RESPECT_FROM_GTA_MULT * _fm_gta)) + max(
            0, int(milestone_respect * RESPECT_FROM_GTA_MULT * _fm_gta)
        )
        car_rarity = (car.get("rarity") or "common").strip().lower()
        car_is_market_exclusive = car_rarity in _MARKET_EXCLUSIVE_RARITIES

        async def _post_success_bookkeeping():
            if _xp_token_bonus:
                try:
                    from utils.token_perk_stats import bump_token_perk_stats

                    await bump_token_perk_stats(
                        db, current_user.get("id") or "", "xp_gta", bonus_rp=_xp_token_bonus, uses=1
                    )
                except Exception:
                    pass
            try:
                from utils.world_event_stats import bump_world_event_stats

                _we_fields: dict = {}
                if _we_bonus_rp:
                    _we_fields["bonus_rp"] = _we_bonus_rp
                if _gta_succ_mult > 1.0:
                    _we_fields["gta_boosted"] = 1
                if _we_fields:
                    _we_fields["uses"] = 1
                    await bump_world_event_stats(db, current_user.get("id") or "", **_we_fields)
            except Exception:
                pass
            if respect_from_drop:
                await log_respect_earned(current_user.get("id") or "", respect_from_drop, "gta")
            await _award_gta_milestones(
                current_user.get("id") or "", new_total_gta, claimed, bonus_mult=_fm_gta
            )
            try:
                await maybe_process_rank_up(
                    current_user.get("id") or "",
                    rp_before,
                    rank_points_in_update(gta_update),
                    current_user.get("username", ""),
                    user_prestige_rank_mult(current_user),
                )
            except Exception as e:
                logger.exception("Rank-up notification (GTA): %s", e)
            try:
                await update_objectives_progress(current_user.get("id") or "", "gta", 1)
            except Exception:
                pass
            if used_gta_skip:
                try:
                    from utils.token_perk_stats import bump_token_perk_stats

                    rarity_field = _GTA_SKIP_STOLEN_RARITY_FIELDS.get(car_rarity)
                    if rarity_field:
                        await bump_token_perk_stats(
                            db, current_user.get("id") or "", "cooldown_skip_gta", **{rarity_field: 1}
                        )
                except Exception:
                    pass
            if car_is_market_exclusive:
                try:
                    from utils.exclusive_car_events import log_exclusive_car_event

                    await log_exclusive_car_event(
                        db,
                        event_type="gta_won",
                        car_id=car.get("id"),
                        user_car_id=new_gta_uc_id,
                        to_user_id=current_user.get("id"),
                        to_username=current_user.get("username"),
                        car_name=car.get("name"),
                    )
                except Exception:
                    logger.exception("exclusive car event log failed user_id=%s", current_user.get("id"))

        deferred_ops.append(_post_success_bookkeeping)
        msg = _rng.choice(GTA_SUCCESS_MESSAGES).format(car_name=car["name"])
        return _spawn_and_return(
            GTAAttemptResponse(
                success=True,
                message=msg,
                car=car,
                jailed=False,
                jail_until=None,
                rank_points_earned=rp_granted,
                progress_after=progress_after,
                respect_points=respect_earned,
            )
        )
    # Failure: sometimes caught (jail), sometimes get away (no car, no jail)
    caught = _rng.random() < GTA_CAUGHT_CHANCE
    if caught:
        jail_sec = apply_game_pass_wait_seconds(int(option["jail_time"]), current_user)
        jail_until = datetime.now(timezone.utc) + timedelta(seconds=jail_sec)
        await db.users.update_one(
            {"id": current_user.get("id") or ""},
            {"$set": {"in_jail": True, "jail_until": jail_until.isoformat(), "snitch_attempted_this_term": False}},
        )
        fail_msg = _rng.choice(GTA_FAIL_CAUGHT_MESSAGES).format(seconds=jail_sec)
        return _spawn_and_return(
            GTAAttemptResponse(
                success=False,
                message=fail_msg,
                car=None,
                jailed=True,
                jail_until=jail_until.isoformat(),
                rank_points_earned=0,
                progress_after=progress_after,
                respect_points=0,
            )
        )
    fail_msg = _rng.choice(GTA_FAIL_ESCAPED_MESSAGES)
    return _spawn_and_return(
        GTAAttemptResponse(
            success=False,
            message=fail_msg,
            car=None,
            jailed=False,
            jail_until=None,
            rank_points_earned=0,
            progress_after=progress_after,
            respect_points=0,
        )
    )


async def attempt_gta_locked(
    option_id: str,
    current_user: dict,
    caller_updates_total_gta: bool = False,
    *,
    used_gta_skip: bool = False,
) -> GTAAttemptResponse:
    """HTTP route and auto_rank: serialize GTA attempts with melt/scrap for this user."""
    lock = await _get_gta_garage_lock(current_user.get("id") or "")
    async with lock:
        return await _attempt_gta_impl(
            option_id,
            current_user,
            caller_updates_total_gta=caller_updates_total_gta,
            used_gta_skip=used_gta_skip,
        )


async def melt_cars_locked(
    user: dict,
    car_ids: list,
    action: str,
    *,
    manual_garage: bool = False,
    allowed_rarities: Optional[set] = None,
) -> dict:
    """HTTP route and auto_rank: serialize melt/scrap with GTA for this user."""
    lock = await _get_gta_garage_lock(user.get("id") or "")
    async with lock:
        return await _melt_cars_impl(
            user,
            car_ids,
            action,
            manual_garage=manual_garage,
            allowed_rarities=allowed_rarities,
        )


async def attempt_gta(
    request: GTAAttemptRequest,
    req: Request,
    current_user: dict = Depends(get_current_user_verified),
):
    # Exclusive drops strip new-account protection — only confirm when Al Capone is actually in the GTA pool.
    if is_civilian_protected(current_user):
        exclusive_stealable = False
        try:
            if await _gta_exclusive_pool_released_from_config() and await _count_car20_owned() == 0:
                exclusive_stealable = True
        except Exception:
            logger.exception("gta exclusive-pool check for protection confirm failed")
        if exclusive_stealable:
            require_protection_revoke_confirm(current_user, reason="exclusive_car", request=req)
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
    rank_id, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
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
        used_gta_skip = False
        if cooldown_doc:
            until = _parse_iso_datetime(cooldown_doc.get("cooldown_until"))
            if until and until > now:
                from utils.cooldown_skip import has_skip_credit, consume_skip_credit

                if has_skip_credit(current_user, "gta"):
                    if await consume_skip_credit(db, current_user.get("id") or "", "gta"):
                        used_gta_skip = True
                        await db.gta_cooldowns.update_one(
                            {"user_id": current_user.get("id") or ""},
                            {"$set": {"cooldown_until": now.isoformat()}},
                        )
                    else:
                        secs = int((until - now).total_seconds())
                        raise HTTPException(
                            status_code=400, detail=f"GTA cooldown: try again in {secs}s"
                        )
                else:
                    secs = int((until - now).total_seconds())
                    raise HTTPException(
                        status_code=400, detail=f"GTA cooldown: try again in {secs}s"
                    )
        result = await _attempt_gta_impl(
            request.option_id, current_user, used_gta_skip=used_gta_skip
        )
        now = datetime.now(timezone.utc)
        success = getattr(result, "success", False)
        profit = int((result.car.get("value", 0) or 0)) if (getattr(result, "car", None) and success) else 0
        option = next((o for o in GTA_OPTIONS if o["id"] == request.option_id), None)
        car = getattr(result, "car", None)
        jailed = getattr(result, "jailed", False)
        jail_seconds = apply_game_pass_wait_seconds(int(option["jail_time"]), current_user) if (option and jailed) else None
        uid = current_user.get("id") or ""
        event_doc = {
            "user_id": uid,
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
        activity_details = {
            "option": (option or {}).get("name", request.option_id),
            "success": success,
            "car": car.get("name") if car else None,
            "jailed": jailed,
        }

        async def _post_route_bookkeeping():
            gta_event_result = await db.gta_events.insert_one(event_doc)
            invalidate_rolling_event_stats_cache("gta_events", uid)
            if success:
                try:
                    from utils.family_daily_tasks import record_family_daily_activity

                    await record_family_daily_activity(
                        db,
                        uid,
                        "gta",
                        source_id=f"gta:{gta_event_result.inserted_id}",
                        now=now,
                    )
                except Exception:
                    logging.exception("Family daily GTA progress failed user_id=%s", uid)
            await log_activity(
                uid,
                current_user.get("username", "?"),
                "gta_attempt",
                activity_details,
            )

        _spawn_gta_bookkeeping(uid, _post_route_bookkeeping)
        return result


async def get_gta_stats(current_user: dict = Depends(get_current_user)):
    """Return GTAs today/week, successful GTAs, profit today / 24h / week."""
    return await fetch_rolling_event_stats(
        db.gta_events, current_user.get("id") or "", collection_name="gta_events"
    )


MELT_BULLETS_COOLDOWN_SECONDS = 45  # Only 1 car can be melted for bullets every 45s. Scrap has no cooldown.
# Applied once to the sum of bullets from a melt (all rarities), after per-car math (+25% vs previous payout).
MELT_BULLETS_TOTAL_PAYOUT_MULT_NUM = 125
MELT_BULLETS_TOTAL_PAYOUT_MULT_DEN = 100

# Newest-first cap for normal garage rows. Custom + exclusive + loot-exclusive catalog ids are merged
# separately (GARAGE_SPECIAL_ROWS_MAX) so immune types are not dropped; this limit still bounds plain rows.
GARAGE_FETCH_LIMIT = 250_000
# Catalog exclusives / loot exclusives (not car_custom). Kept separate from customs so 500+ immune cars
# never crowd out every `car_custom` row (customs are fetched in their own slice up to GARAGE_FETCH_LIMIT).
GARAGE_SPECIAL_ROWS_MAX = 500
_MARKET_EXCLUSIVE_RARITIES = frozenset({"exclusive", "loot_exclusive", "vip_exclusive"})
_CUSTOM_IMAGE_CAR_IDS = frozenset({"car_custom", "car22"})
_DEALERSHIP_RARITIES = frozenset({"common", "uncommon", "rare", "ultra_rare", "legendary"})
_VALID_GARAGE_RARITIES = frozenset(
    {"common", "uncommon", "rare", "ultra_rare", "legendary", "custom", "loot_exclusive", "exclusive", "vip_exclusive"}
)


def _normalize_melt_allowed_rarities(raw: Optional[List[str]]) -> Optional[set]:
    if raw is None:
        return None
    out = set()
    for x in raw:
        s = _normalize_garage_rarity_str(x)
        if s in _VALID_GARAGE_RARITIES:
            out.add(s)
    return out


def _melt_should_skip_rarity(rarity: object, allowed: Optional[set], *, manual_garage: bool) -> bool:
    """Skip cars the player did not tick. Legacy garage clients: never melt exclusives."""
    r = _normalize_garage_rarity_str(rarity)
    if allowed is not None:
        return r not in allowed
    return bool(manual_garage and r in _MARKET_EXCLUSIVE_RARITIES)


def _normalize_garage_rarity_str(raw: object) -> str:
    if raw is None:
        return "common"
    s = str(raw).strip().lower().replace(" ", "_").replace("-", "_")
    if s == "lootexclusive":
        s = "loot_exclusive"
    if s == "vipexclusive":
        s = "vip_exclusive"
    if s == "ultrarare":
        s = "ultra_rare"
    return s if s in _VALID_GARAGE_RARITIES else "common"


def _chop_shop_seal_applies(car_id: Optional[str], rarity_hint: Optional[str] = None) -> bool:
    """Chop-Shop Seal +20% scrap cash: dealership tiers only (not exclusive / VIP / custom)."""
    if car_id in _CUSTOM_IMAGE_CAR_IDS:
        return False
    rarity = (rarity_hint or "").strip().lower().replace(" ", "_").replace("-", "_")
    if rarity == "ultrarare":
        rarity = "ultra_rare"
    return rarity in _DEALERSHIP_RARITIES


def _is_damage_immune_car(car_id: Optional[str], rarity_hint: Optional[str] = None) -> bool:
    """Custom + exclusive cars should always have 0 damage."""
    if car_id == "car_custom":
        return True
    rarity = (rarity_hint or "").strip().lower()
    if not rarity and car_id:
        car_info = next((c for c in CARS if c.get("id") == car_id), None)
        rarity = str((car_info or {}).get("rarity") or "").strip().lower()
    return rarity in ("exclusive", "loot_exclusive", "vip_exclusive")


def _effective_catalog_value_for_melt_bullets(
    catalog_value: int,
    damage_percent: Any,
    car_id: Optional[str],
    rarity_hint: Optional[str],
) -> int:
    """Melt-for-bullets uses catalog value scaled down by damage (linear). Immune cars use full value."""
    v = max(0, int(catalog_value or 0))
    if v <= 0 or _is_damage_immune_car(car_id, rarity_hint):
        return v
    try:
        d = float(damage_percent or 0)
    except (TypeError, ValueError):
        d = 0.0
    d = min(100.0, max(0.0, d))
    return max(0, int(v * (100.0 - d) / 100.0))


def _damage_immune_car_ids() -> List[str]:
    ids = [c.get("id") for c in CARS if _is_damage_immune_car(c.get("id"), c.get("rarity")) and c.get("id")]
    return list(dict.fromkeys(ids))


def _garage_entry_from_user_car(user_car: Dict[str, Any]) -> Optional[dict]:
    """Build one garage row. Includes catalog miss fallback so owned cars still show (e.g. loot exclusives if CARS out of sync)."""
    car_id = user_car.get("car_id")
    if not car_id:
        return None
    user_car_id = user_car.get("id") or str(user_car.get("_id", ""))
    car_info = next((c for c in CARS if c.get("id") == car_id), None)
    if car_info:
        display_name = (user_car.get("custom_name") or user_car.get("car_name")) if car_id == "car_custom" else (user_car.get("car_name") or car_info.get("name"))
        damage = 0 if _is_damage_immune_car(car_id, car_info.get("rarity")) else min(100, max(0, float(user_car.get("damage_percent", 0))))
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
        if car_id in _CUSTOM_IMAGE_CAR_IDS and user_car.get("custom_image_url"):
            entry["image"] = user_car.get("custom_image_url")
        if user_car.get("listed_for_sale"):
            entry["listed_for_sale"] = True
            entry["sale_price"] = user_car.get("sale_price")
            entry["listed_at"] = user_car.get("listed_at")
        try:
            from utils.exclusive_car_weekly_loot import weekly_loot_pieces_for_car

            weekly_loot = weekly_loot_pieces_for_car(car_id, car_info.get("rarity"))
            if weekly_loot > 0:
                entry["weekly_loot_pieces"] = weekly_loot
        except Exception:
            pass
        return entry
    display_name = user_car.get("car_name") or user_car.get("custom_name") or str(car_id)
    rarity = _normalize_garage_rarity_str(user_car.get("rarity"))
    damage = 0 if _is_damage_immune_car(car_id, rarity) else min(100, max(0, float(user_car.get("damage_percent", 0))))
    try:
        value = int(user_car.get("value") or 0)
    except (TypeError, ValueError):
        value = 0
    entry = {
        "user_car_id": user_car_id,
        "car_id": car_id,
        "car_name": display_name,
        "name": display_name,
        "acquired_at": user_car.get("acquired_at"),
        "damage_percent": damage,
        "rarity": rarity,
        "value": value,
        "min_rank": int(user_car.get("min_rank") or 1),
        "min_difficulty": int(user_car.get("min_difficulty") or 1),
        "travel_bonus": int(user_car.get("travel_bonus") or 0),
        "image": str(user_car.get("image") or ""),
    }
    if user_car.get("listed_for_sale"):
        entry["listed_for_sale"] = True
        entry["sale_price"] = user_car.get("sale_price")
        entry["listed_at"] = user_car.get("listed_at")
    return entry


def _user_car_row_dedupe_key(uc: dict) -> str:
    return str(uc.get("id") or uc.get("_id") or "")


async def get_garage(current_user: dict = Depends(get_current_user)):
    uid = current_user.get("id") or ""
    await db.user_cars.update_many(
        {
            "user_id": uid,
            "car_id": {"$in": _damage_immune_car_ids()},
            "damage_percent": {"$gt": 0},
        },
        {"$set": {"damage_percent": 0}},
    )
    always_car_ids = [cid for cid in _damage_immune_car_ids() if cid]
    if always_car_ids:
        immune_catalog_ids = [cid for cid in always_car_ids if cid != "car_custom"]
        main_rows = await db.user_cars.find({"user_id": uid, "car_id": {"$nin": always_car_ids}}).sort(
            "acquired_at", -1
        ).to_list(GARAGE_FETCH_LIMIT)
        if immune_catalog_ids:
            extra_rows = await db.user_cars.find({"user_id": uid, "car_id": {"$in": immune_catalog_ids}}).sort(
                "acquired_at", -1
            ).to_list(GARAGE_SPECIAL_ROWS_MAX)
        else:
            extra_rows = []
        custom_rows = await db.user_cars.find({"user_id": uid, "car_id": "car_custom"}).sort(
            "acquired_at", -1
        ).to_list(GARAGE_FETCH_LIMIT)
    else:
        main_rows = await db.user_cars.find({"user_id": uid}).sort("acquired_at", -1).to_list(GARAGE_FETCH_LIMIT)
        extra_rows = []
        custom_rows = []
    seen: set[str] = set()
    cars: List[dict] = []
    for uc in main_rows:
        k = _user_car_row_dedupe_key(uc)
        if not k or k in seen:
            continue
        seen.add(k)
        cars.append(uc)
    for uc in extra_rows:
        k = _user_car_row_dedupe_key(uc)
        if not k or k in seen:
            continue
        seen.add(k)
        cars.append(uc)
    for uc in custom_rows:
        k = _user_car_row_dedupe_key(uc)
        if not k or k in seen:
            continue
        seen.add(k)
        cars.append(uc)
    user_doc = await db.users.find_one(
        {"id": uid},
        {"_id": 0, "melt_bullets_cooldown_until": 1},
    )
    melt_bullets_cooldown_until = user_doc.get("melt_bullets_cooldown_until") if user_doc else None
    car_details = []
    for user_car in cars:
        entry = _garage_entry_from_user_car(user_car)
        if entry:
            car_details.append(entry)
    return {"cars": car_details, "melt_bullets_cooldown_until": melt_bullets_cooldown_until}


async def get_recent_stolen(current_user: dict = Depends(get_current_user)):
    """Last 10 cars stolen (by acquired_at desc) for the GTA page. Same shape as garage entries."""
    await db.user_cars.update_many(
        {
            "user_id": current_user.get("id") or "",
            "car_id": {"$in": _damage_immune_car_ids()},
            "damage_percent": {"$gt": 0},
        },
        {"$set": {"damage_percent": 0}},
    )
    cursor = (
        db.user_cars.find({"user_id": current_user.get("id") or ""})
        .sort("acquired_at", -1)
        .limit(10)
    )
    cars = await cursor.to_list(10)
    car_details = []
    for user_car in cars:
        entry = _garage_entry_from_user_car(user_car)
        if entry:
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


async def _melt_cars_impl(
    user: dict,
    car_ids: list,
    action: str,
    *,
    manual_garage: bool = False,
    allowed_rarities: Optional[set] = None,
):
    """Core melt logic. Returns dict with success/melted_count/etc. On bullets cooldown returns {success: False, cooldown: True, detail: ...}."""
    now = datetime.now(timezone.utc)
    action = (action or "").strip().lower()
    if action not in ("bullets", "cash"):
        return {"success": False, "message": "Invalid action"}
    # Garage: honor full selection (capped). Auto Rank / internal: upgraded batch limit only.
    if manual_garage:
        batch_cap = GARAGE_BATCH_LIMIT_MAX
    else:
        batch_cap = effective_garage_batch_limit(user)
    car_ids = list(car_ids or [])[:batch_cap]
    limit = len(car_ids)
    if limit < 1:
        return {"success": False, "message": "No cars selected"}
    owner = _user_car_owner_clause(user.get("id"))
    # Prefer DB-resolved crew (membership row) so melt rewards still apply if users.family_id is stale/missing.
    family_id = await resolve_family_id(user.get("id") or "") or (str(user.get("family_id") or "").strip() or None)
    in_war = family_id and await _family_in_active_war(family_id)

    pre_docs = await db.user_cars.find(
        {**owner, "id": {"$in": list(car_ids)}, "listed_for_sale": {"$ne": True}},
    ).to_list(limit)
    cars_by_id = {d.get("id"): d for d in pre_docs if d.get("id")}

    if in_war:
        for raw_id in car_ids[:limit]:
            uc = cars_by_id.get(raw_id)
            if not uc:
                continue
            car_info = next((c for c in CARS if c.get("id") == uc.get("car_id")), None)
            if car_info and car_info.get("rarity") in _MARKET_EXCLUSIVE_RARITIES:
                return {
                    "success": False,
                    "message": EXCLUSIVE_CAR_WAR_LOCK_DETAIL,
                    "exclusive_war_lock": True,
                }

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
    melted_car20 = False
    melted_exclusive_cars: list = []
    for car_id in car_ids:
        if processed >= limit:
            break
        owned_filter = {**owner, "id": car_id, "listed_for_sale": {"$ne": True}}
        candidate = cars_by_id.get(car_id)
        if not candidate:
            try:
                owned_filter = {**owner, "_id": ObjectId(car_id), "listed_for_sale": {"$ne": True}}
                candidate = await db.user_cars.find_one(owned_filter)
            except Exception:
                candidate = None
        if not candidate:
            continue
        model_id = candidate.get("car_id")
        car_info = next((c for c in CARS if c.get("id") == model_id), None)
        rarity_hint = (car_info or {}).get("rarity") if car_info else candidate.get("rarity")
        if _melt_should_skip_rarity(rarity_hint, allowed_rarities, manual_garage=manual_garage):
            continue
        deleted_car = await db.user_cars.find_one_and_delete(owned_filter)
        if deleted_car:
            if model_id == GTA_EXCLUSIVE_CAR_ID:
                melted_car20 = True
            if car_info:
                rarity_l = (car_info.get("rarity") or "").strip().lower()
                if rarity_l in _MARKET_EXCLUSIVE_RARITIES:
                    melted_exclusive_cars.append(
                        {
                            "car_id": model_id,
                            "user_car_id": deleted_car.get("id"),
                            "car_name": car_info.get("name") or model_id,
                            "rarity": rarity_l,
                        }
                    )
                if car_info.get("rarity") == "uncommon":
                    uncommon_count += 1
                catalog_value = int(car_info.get("value", 0) or 0)
                if action == "bullets":
                    rarity = (car_info.get("rarity") or "").strip().lower()
                    car_value = _effective_catalog_value_for_melt_bullets(
                        catalog_value,
                        deleted_car.get("damage_percent", 0),
                        model_id,
                        car_info.get("rarity"),
                    )
                    melt_value = (car_value * MELT_BULLETS_VALUE_MULT_NUM) // MELT_BULLETS_VALUE_MULT_DEN
                    car_bullets = melt_value // MELT_VALUE_PER_BULLET
                    if car_info.get("rarity") == "common":
                        if car_bullets < 5:
                            car_bullets = 5
                        elif car_bullets > 7:
                            car_bullets = 7
                    if rarity not in _MARKET_EXCLUSIVE_RARITIES:
                        # +25% bullets for all but exclusive / loot_exclusive / vip_exclusive (floor-rounded).
                        car_bullets = (int(car_bullets) * 125) // 100
                    total_bullets += car_bullets
                else:
                    car_cash = int(catalog_value * 0.5)
                    if _chop_shop_seal_applies(model_id, car_info.get("rarity")):
                        try:
                            from utils.loot_reclaimable_passives import (
                                BUFF_CAR_SELL,
                                get_reclaimable_passive_mults_from_user,
                            )

                            car_cash = int(
                                car_cash
                                * float(get_reclaimable_passive_mults_from_user(user).get(BUFF_CAR_SELL) or 1.0)
                            )
                        except Exception:
                            pass
                    total_value += car_cash
                deleted_count += 1
                processed += 1
            else:
                await db.user_cars.insert_one(deleted_car)
                processed += 1
    if melted_car20:
        await _sync_gta_exclusive_pool_release_state()
    if melted_exclusive_cars:
        try:
            from utils.exclusive_car_events import log_exclusive_car_event

            melt_event = "melted" if action == "bullets" else "scraped"
            for row in melted_exclusive_cars:
                await log_exclusive_car_event(
                    db,
                    event_type=melt_event,
                    car_id=row["car_id"],
                    user_car_id=row.get("user_car_id"),
                    from_user_id=user.get("id"),
                    from_username=user.get("username") or "",
                    car_name=row.get("car_name"),
                    extra={
                        "action": action,
                        "source": "garage_ui" if manual_garage else "auto_rank_or_internal",
                        "rarity": row.get("rarity"),
                    },
                )
        except Exception:
            logger.exception("Failed to log exclusive melt/scrap")
        if any((row.get("rarity") or "") == "loot_exclusive" for row in melted_exclusive_cars):
            try:
                from routers.money.loot_box import resync_loot_exclusive_claimed_counts_from_live

                await resync_loot_exclusive_claimed_counts_from_live()
            except Exception:
                logger.exception("Failed to return melted loot exclusive to loot pool")
    if deleted_count > 0:
        if action == "bullets":
            total_bullets = (int(total_bullets or 0) * MELT_BULLETS_TOTAL_PAYOUT_MULT_NUM) // MELT_BULLETS_TOTAL_PAYOUT_MULT_DEN
        try:
            from utils.family_daily_tasks import record_family_daily_activity

            # Daily crew objective counts bullets earned from melts (cash melts don't progress it).
            await record_family_daily_activity(
                db,
                user.get("id") or "",
                "car_melt",
                int(total_bullets or 0) if action == "bullets" else 0,
                source_id=f"car-melt:{user.get('id')}:{now.isoformat()}:{action}:{','.join(sorted(car_ids[:limit]))}",
                now=now,
            )
        except Exception:
            logging.exception("Family daily car melt progress failed user_id=%s", user.get("id"))
        if action == "bullets":
            base_cooldown = int(MELT_BULLETS_COOLDOWN_SECONDS * 0.5) if melt_token_active else MELT_BULLETS_COOLDOWN_SECONDS
            cooldown_seconds = base_cooldown * deleted_count
            if melt_token_active:
                try:
                    from utils.token_perk_stats import bump_token_perk_stats
                    await bump_token_perk_stats(
                        db,
                        user.get("id") or "",
                        "melt",
                        cooldown_saved_sec=(MELT_BULLETS_COOLDOWN_SECONDS - base_cooldown) * deleted_count,
                        cars_melted=deleted_count,
                        uses=1,
                    )
                except Exception:
                    pass
            # Badge bonus: 0.1% per bullets melted badge reduces cooldown (min 50%); prestige: 0.5% boost per level
            try:
                from routers.game.achievements import get_badge_bonuses
                bb = await get_badge_bonuses(user.get("id") or "")
                bullets_mult = max(0.5, 1 - bb.get("bullets_melted", 0) * 0.001 * bb.get("prestige_badge_mult", 1))
                cooldown_seconds = int(cooldown_seconds * bullets_mult)
            except Exception:
                pass
            try:
                rpm = await family_perk_modifiers(db, family_id)
                ms = int(rpm.get("melt_seconds_off") or 0)
                if ms > 0:
                    cooldown_seconds = max(1, cooldown_seconds - ms)
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
            melt_progress_user_set: Dict[str, object] = {}
            if family_id:
                fam = await db.families.find_one(
                    {"id": family_id, "wiped": {"$ne": True}},
                    {"_id": 0, "melt_treasury_pct": 1, "melt_reward_tiers": 1, "treasury": 1, "name": 1},
                )
                if fam:
                    individual_rewards = []
                    projected_family_cut = 0
                    payout_entries: List[Tuple[int, int]] = []
                    prog_map: Dict[str, int] = {}
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
                            prog_user = await db.users.find_one(
                                {"id": user["id"]},
                                {"_id": 0, "family_melt_tier_progress": 1, "family_melt_progress_family_id": 1},
                            )
                            prog_map = {}
                            if (prog_user or {}).get("family_melt_progress_family_id") == family_id:
                                raw_p = (prog_user or {}).get("family_melt_tier_progress") or {}
                                if isinstance(raw_p, dict):
                                    for k, v in raw_p.items():
                                        try:
                                            prog_map[str(k)] = int(v)
                                        except Exception:
                                            pass
                            # Per tier: carry remainder across melts; this melt adds projected_family_cut toward each tier's threshold.
                            payout_entries = []
                            for t in valid_tiers:
                                tb = int(t["threshold_bullets"])
                                rm = int(t["reward_money"])
                                if tb <= 0 or rm <= 0:
                                    continue
                                key = str(tb)
                                old_p = int(prog_map.get(key, 0) or 0)
                                total_b = old_p + projected_family_cut
                                hits = total_b // tb
                                for _ in range(hits):
                                    payout_entries.append((tb, rm))
                            individual_rewards = [rm for (_tb, rm) in payout_entries]
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
                    paid_by_tb: Dict[int, int] = {}
                    if melt_reward_paid > 0 and payout_entries:
                        rem_pay = int(melt_reward_paid)
                        for tb_hit, rm_hit in payout_entries:
                            if rem_pay >= rm_hit:
                                rem_pay -= rm_hit
                                paid_by_tb[tb_hit] = paid_by_tb.get(tb_hit, 0) + 1
                            else:
                                break
                    if (
                        configured_pct > 0
                        and base_total_bullets > 0
                        and valid_tiers
                        and projected_family_cut > 0
                    ):
                        new_prog: Dict[str, int] = {}
                        for t in valid_tiers:
                            tb = int(t["threshold_bullets"])
                            if tb <= 0:
                                continue
                            key = str(tb)
                            old_p = int(prog_map.get(key, 0) or 0)
                            total_b = old_p + projected_family_cut
                            hpaid = paid_by_tb.get(tb, 0)
                            new_prog[key] = total_b - hpaid * tb
                        melt_progress_user_set = {
                            "family_melt_tier_progress": new_prog,
                            "family_melt_progress_family_id": family_id,
                        }
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
                    "$set": {
                        "melt_bullets_cooldown_until": cooldown_until.isoformat(),
                        **melt_progress_user_set,
                    },
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
        # Referral: referrers split 10% of garage scrap profit (game-paid)
        _rb = await db.users.find_one({"id": user["id"]}, {"_id": 0, "referred_by": 1})
        ref_ids = normalize_referred_by_ids((_rb or user).get("referred_by"))
        if ref_ids and total_value > 0:
            pool = referral_pool_int(total_value, 0.10)
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
    requested = len(body.car_ids)
    if body.manual_garage:
        max_in = GARAGE_BATCH_LIMIT_MAX
    else:
        max_in = effective_garage_batch_limit(current_user)
    if requested > max_in:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Too many cars in one request ({requested:,}; max {max_in} per melt). "
                "Select all still works — melt processes up to 100 cars per click."
            ),
        )
    result = await melt_cars_locked(
        current_user,
        body.car_ids,
        body.action,
        manual_garage=body.manual_garage,
        allowed_rarities=_normalize_melt_allowed_rarities(body.rarity_ids),
    )
    if result.get("exclusive_war_lock"):
        raise HTTPException(status_code=403, detail=result.get("message") or EXCLUSIVE_CAR_WAR_LOCK_DETAIL)
    if result.get("cooldown"):
        raise HTTPException(status_code=400, detail=result.get("detail", "Melt on cooldown"))
    if not result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=result.get("message") or result.get("detail") or "No cars were processed",
        )
    return result


# Dealer: buy cars for cash (price = value * multiplier). Custom, exclusive, and loot_exclusive are not for sale.
# Stock per model and price multiplier vary by rarity: rarer = less stock, more overpriced.
DEALER_EXCLUDED_IDS = {"car_custom", "car20", "car22"}
# Replenish at random intervals so restocks are spread throughout the day
DEALER_REPLENISH_MIN_SEC = 1 * 3600   # 1 hour
DEALER_REPLENISH_MAX_SEC = 4 * 3600   # 4 hours
DEALER_AUTO_STOCK_INTERVAL_SEC = 5 * 60  # owner auto-stock checks every 5 minutes
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
# Max dealer stock per car model by rarity (sellable tiers capped at 5 each; custom/exclusive not sold)
DEALER_STOCK_MAX_BY_RARITY = {
    "common": 5,
    "uncommon": 5,
    "rare": 5,
    "ultra_rare": 5,
    "legendary": 5,
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
# Applied after rarity multiplier: dealer_price = int(value * rarity_mult * GLOBAL). +50% vs prior 9.0 baseline.
DEALER_PRICE_GLOBAL_MULTIPLIER = 13.5


def _dealer_max_stock(car_info: dict) -> int:
    r = car_info.get("rarity") or "common"
    return DEALER_STOCK_MAX_BY_RARITY.get(r, 5)


def _dealer_price_multiplier(car_info: dict) -> float:
    r = car_info.get("rarity") or "common"
    return DEALER_PRICE_MULTIPLIER_BY_RARITY.get(r, 1.35) * DEALER_PRICE_GLOBAL_MULTIPLIER


def _dealer_sellable_cars() -> List[dict]:
    return [
        c
        for c in CARS
        if c.get("id") not in DEALER_EXCLUDED_IDS and c.get("rarity") not in ("loot_exclusive", "vip_exclusive")
    ]


def _normalize_owner_stock_rarity(rarity: str) -> str:
    r = (rarity or "").strip().lower()
    if r not in DEALER_OWNER_STOCKABLE_RARITIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid rarity. Choose one of: {', '.join(DEALER_OWNER_STOCKABLE_RARITIES)}",
        )
    return r


def _owner_stock_target_per_model(raw: int) -> int:
    try:
        n = int(raw or 0)
    except (TypeError, ValueError):
        n = DEALER_OWNER_STOCK_DEFAULT_TARGET
    return max(1, min(n, DEALER_OWNER_STOCK_MAX_PER_MODEL))


def _owner_stock_unit_fee(catalog_value: int) -> int:
    return max(0, int(int(catalog_value or 0) * DEALER_OWNER_STOCK_FEE_RATE))


async def _dealer_stock_counts_by_rarity() -> Dict[str, int]:
    pipeline = [{"$group": {"_id": "$car_id", "count": {"$sum": 1}}}]
    rows = await db.dealer_stock.aggregate(pipeline).to_list(200)
    car_by_id = {c.get("id"): c for c in CARS}
    out: Dict[str, int] = {r: 0 for r in DEALER_OWNER_STOCKABLE_RARITIES}
    for row in rows:
        car = car_by_id.get(row.get("_id"))
        if not car:
            continue
        r = car.get("rarity") or "common"
        if r in out:
            out[r] += int(row.get("count") or 0)
    return out


async def _owner_stock_plan(rarity: str, target_per_model: int) -> Tuple[List[Dict[str, Any]], int, int]:
    """Return lines to insert and total stocking fee (catalog value × fee rate × units)."""
    target = _owner_stock_target_per_model(target_per_model)
    lines: List[Dict[str, Any]] = []
    total_fee = 0
    total_units = 0
    for car in _dealer_sellable_cars():
        if (car.get("rarity") or "common") != rarity:
            continue
        car_id = car.get("id")
        count = await db.dealer_stock.count_documents({"car_id": car_id})
        need = max(0, target - int(count or 0))
        if need <= 0:
            continue
        unit_fee = _owner_stock_unit_fee(int(car.get("value") or 0))
        line_fee = unit_fee * need
        lines.append(
            {
                "car_id": car_id,
                "car_name": car.get("name") or car_id,
                "units": need,
                "unit_fee": unit_fee,
                "fee": line_fee,
                "target_per_model": target,
                "current_stock": int(count or 0),
            }
        )
        total_fee += line_fee
        total_units += need
    return lines, total_fee, total_units


async def _owner_stock_plan_within_budget(
    rarity: str, target_per_model: int, budget: int
) -> Tuple[List[Dict[str, Any]], int, int]:
    """Stock up toward target using only the cash budget (round-robin across models)."""
    target = _owner_stock_target_per_model(target_per_model)
    remaining = max(0, int(budget or 0))
    if remaining <= 0:
        return [], 0, 0
    pending: List[Dict[str, Any]] = []
    for car in _dealer_sellable_cars():
        if (car.get("rarity") or "common") != rarity:
            continue
        car_id = car.get("id")
        count = await db.dealer_stock.count_documents({"car_id": car_id})
        need = max(0, target - int(count or 0))
        unit_fee = _owner_stock_unit_fee(int(car.get("value") or 0))
        if need <= 0 or unit_fee <= 0:
            continue
        pending.append(
            {
                "car": car,
                "car_id": car_id,
                "need": need,
                "unit_fee": unit_fee,
                "added": 0,
            }
        )
    if not pending:
        return [], 0, 0
    total_fee = 0
    total_units = 0
    while remaining > 0:
        progressed = False
        for item in pending:
            if item["added"] >= item["need"]:
                continue
            fee = int(item["unit_fee"])
            if fee > remaining:
                continue
            item["added"] += 1
            remaining -= fee
            total_fee += fee
            total_units += 1
            progressed = True
        if not progressed:
            break
    lines: List[Dict[str, Any]] = []
    for item in pending:
        added = int(item["added"] or 0)
        if added <= 0:
            continue
        unit_fee = int(item["unit_fee"])
        car = item["car"]
        lines.append(
            {
                "car_id": item["car_id"],
                "car_name": car.get("name") or item["car_id"],
                "units": added,
                "unit_fee": unit_fee,
                "fee": unit_fee * added,
                "target_per_model": target,
                "current_stock": max(0, target - int(item["need"]) + added),
            }
        )
    return lines, total_fee, total_units


async def _insert_owner_stock_lines(lines: List[Dict[str, Any]]) -> int:
    now = datetime.now(timezone.utc).isoformat()
    to_insert = []
    for line in lines:
        car_id = line.get("car_id")
        for _ in range(int(line.get("units") or 0)):
            to_insert.append({"car_id": car_id, "added_at": now, "owner_stocked": True})
    if not to_insert:
        return 0
    await db.dealer_stock.insert_many(to_insert)
    return len(to_insert)


def _dealership_stock_status_payload(dealership: dict, stock_by_rarity: Dict[str, int]) -> dict:
    stack_conflict = dealership_stack_conflict_status(dealership)
    return {
        "stock_fee_rate_pct": int(DEALER_OWNER_STOCK_FEE_RATE * 100),
        "stock_max_per_model": DEALER_OWNER_STOCK_MAX_PER_MODEL,
        "stock_default_target": DEALER_OWNER_STOCK_DEFAULT_TARGET,
        "stockable_rarities": list(DEALER_OWNER_STOCKABLE_RARITIES),
        "stock_by_rarity": stock_by_rarity,
        "stack_conflict": stack_conflict,
        "auto_stock": {
            "enabled": bool(dealership.get("auto_stock_enabled")),
            "rarity": dealership.get("auto_stock_rarity"),
            "target_per_model": int(dealership.get("auto_stock_target") or DEALER_OWNER_STOCK_DEFAULT_TARGET),
        },
    }


async def _maybe_auto_relinquish_dealership() -> None:
    await maybe_auto_relinquish_below_capo(db.garage_dealership, {"id": GARAGE_DEALERSHIP_ID})
    await maybe_auto_relinquish_dealership_stack_conflict(db)


async def _run_dealer_owner_auto_stock() -> Dict[str, Any]:
    """Top up owner-configured rarity from pending profit (partial fills when profit is low)."""
    dealership = await get_garage_dealership(db)
    owner_id = dealership.get("owner_id")
    if not owner_id or not dealership.get("auto_stock_enabled"):
        return {"stocked": 0, "fee": 0, "reason": "disabled"}
    rarity = (dealership.get("auto_stock_rarity") or "").strip().lower()
    if rarity not in DEALER_OWNER_STOCKABLE_RARITIES:
        return {"stocked": 0, "fee": 0, "reason": "invalid_rarity"}
    target = int(dealership.get("auto_stock_target") or DEALER_OWNER_STOCK_DEFAULT_TARGET)
    pending_profit = int(dealership.get("owner_pending_profit") or 0)
    if pending_profit <= 0:
        return {"stocked": 0, "fee": 0, "reason": "no_profit"}
    lines, total_fee, total_units = await _owner_stock_plan_within_budget(rarity, target, pending_profit)
    if not lines or total_fee <= 0 or total_units <= 0:
        return {"stocked": 0, "fee": 0, "reason": "at_target_or_cannot_afford_unit"}
    if not await debit_garage_dealership_profit(db, total_fee):
        return {"stocked": 0, "fee": 0, "reason": "insufficient_profit"}
    inserted = await _insert_owner_stock_lines(lines)
    if inserted <= 0:
        await credit_garage_dealership_profit(db, total_fee)
        return {"stocked": 0, "fee": 0, "reason": "insert_failed"}
    await log_activity(
        owner_id,
        dealership.get("owner_username") or "?",
        "garage_dealership_auto_stock",
        {"rarity": rarity, "units": inserted, "fee": total_fee, "target_per_model": _owner_stock_target_per_model(target)},
    )
    return {"stocked": inserted, "fee": total_fee, "reason": "ok"}


async def _fill_dealer_stock_full() -> None:
    """Insert max stock per sellable model (full dealer inventory). Caller must only run when collection is empty."""
    now = datetime.now(timezone.utc).isoformat()
    to_insert = []
    for c in CARS:
        if c.get("id") in DEALER_EXCLUDED_IDS or c.get("rarity") in ("loot_exclusive", "vip_exclusive"):
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


async def _dealer_after_sale_restock(_car_id: str, _car_info: dict) -> None:
    """If the dealer lot is completely empty, re-seed all models. Do not top up per sale — that kept every model at max (e.g. always 5); partial restock runs on the replenish loop."""
    total = await db.dealer_stock.count_documents({})
    if total == 0:
        await _fill_dealer_stock_full()


async def get_cars_for_sale(current_user: dict = Depends(get_current_user)):
    """List dealer cars: one row per model with in_stock count. Excludes custom and exclusive. Any rank can buy."""
    await _maybe_auto_relinquish_dealership()
    pipeline = [{"$group": {"_id": "$car_id", "count": {"$sum": 1}}}]
    counts = await db.dealer_stock.aggregate(pipeline).to_list(100)
    stock_by_car = {d["_id"]: d["count"] for d in counts}
    out = []
    for c in CARS:
        if c.get("id") in DEALER_EXCLUDED_IDS or c.get("rarity") in ("loot_exclusive", "vip_exclusive"):
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
    dealership = await get_garage_dealership(db)
    owner_shares = await load_global_property_owner_shares(db)
    owner_id = dealership.get("owner_id")
    owner_username = dealership.get("owner_username")
    uid = current_user.get("id") or ""
    is_owner = bool(owner_id and owner_id == uid)
    stock_by_rarity = await _dealer_stock_counts_by_rarity()
    dealership_payload = {
        "owner_id": owner_id,
        "owner_username": owner_username,
        "is_owner": is_owner,
        "claim_cost_points": GARAGE_DEALERSHIP_CLAIM_COST_POINTS,
        "owner_pending_profit": int(dealership.get("owner_pending_profit") or 0) if is_owner else None,
        "dealer_owner_profit_share_pct": owner_shares["dealer_owner_profit_share_pct"],
        "player_sale_owner_profit_share_pct": owner_shares["player_sale_owner_profit_share_pct"],
    }
    if is_owner:
        family_id = await resolve_family_id(uid)
        dealership_payload["transfer_locked_war"] = bool(family_id and await _family_in_active_war(family_id))
        dealership_payload.update(_dealership_stock_status_payload(dealership, stock_by_rarity))
    elif not owner_id and uid:
        if await _user_owns_any_property(uid):
            dealership_payload["claim_blocked"] = GARAGE_DEALERSHIP_PROPERTY_CONFLICT_DETAIL
    return {
        "cars": out,
        "dealership": dealership_payload,
    }


# Per-process pacing: rapid "buy all" from the dealer was hammering Mongo (writes + restock).
_dealer_buy_last_mon: Dict[str, float] = {}
_dealer_buy_interval_guard = asyncio.Lock()
DEALER_BUY_MIN_INTERVAL_SEC = 0.45


async def _enforce_dealer_buy_min_interval(user_id: str) -> None:
    if not user_id:
        return
    now = time.monotonic()
    async with _dealer_buy_interval_guard:
        prev = _dealer_buy_last_mon.get(user_id)
        if prev is not None and (now - prev) < DEALER_BUY_MIN_INTERVAL_SEC:
            gap = DEALER_BUY_MIN_INTERVAL_SEC - (now - prev)
            retry_after = max(1, int(gap + 0.999))
            raise HTTPException(
                status_code=429,
                detail={
                    "message": "Slow down between dealer purchases.",
                    "cooldown_seconds": retry_after,
                    "suppress_global_cooldown": True,
                },
                headers={"Retry-After": str(retry_after)},
            )
        _dealer_buy_last_mon[user_id] = now


async def buy_car(
    request: GTABuyCarRequest, current_user: dict = Depends(get_current_user_verified)
):
    """Purchase one car from the dealer for cash. Removes one from dealer stock."""
    await _enforce_dealer_buy_min_interval(current_user.get("id") or "")
    car_info = next((c for c in CARS if c.get("id") == request.car_id), None)
    if not car_info:
        raise HTTPException(status_code=400, detail="Car not found")
    if car_info.get("id") in DEALER_EXCLUDED_IDS or car_info.get("rarity") in ("loot_exclusive", "vip_exclusive"):
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
    await _dealer_after_sale_restock(request.car_id, car_info)
    catalog_value = int(car_info.get("value", 0))
    profit = dealership_sale_profit(price, catalog_value)
    dealership = await get_garage_dealership(db)
    if dealership.get("owner_id") and profit > 0:
        owner_shares = await load_global_property_owner_shares(db)
        await credit_garage_dealership_profit(db, dealer_owner_profit_cut(profit, owner_shares))
        try:
            await _run_dealer_owner_auto_stock()
        except Exception:
            logger.exception("Dealer auto-stock after sale")
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
    buy_inc = {"cars_purchased_from_dealership": 1}
    _rarity = (car_info.get("rarity") or "").strip().lower()
    if _rarity in ("uncommon", "rare", "ultra_rare", "legendary"):
        buy_inc[f"cars_purchased_dealership_{_rarity}"] = 1
    await db.users.update_one(
        {"id": current_user.get("id") or ""},
        {"$inc": buy_inc},
    )
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


async def buy_cars_bulk(
    request: GTABuyCarsBulkRequest, current_user: dict = Depends(get_current_user_verified)
):
    """Purchase many dealer cars in one request (no per-car rate limit). Supports quantity per model."""
    uid = current_user.get("id") or ""
    username = current_user.get("username") or "?"

    qty_by_car: Dict[str, int] = {}
    if request.items:
        for item in request.items:
            cid = str(item.car_id or "").strip()
            if not cid:
                continue
            qty = int(item.quantity or 1)
            if qty < 1:
                raise HTTPException(status_code=400, detail="Quantity must be at least 1")
            qty_by_car[cid] = qty_by_car.get(cid, 0) + qty
    elif request.car_ids:
        for cid in request.car_ids:
            c = str(cid or "").strip()
            if c:
                qty_by_car[c] = qty_by_car.get(c, 0) + 1
    else:
        raise HTTPException(status_code=400, detail="No cars selected")

    total_units = sum(qty_by_car.values())
    if total_units <= 0:
        raise HTTPException(status_code=400, detail="No cars selected")
    if total_units > DEALER_BUY_BULK_MAX:
        raise HTTPException(status_code=400, detail=f"Max {DEALER_BUY_BULK_MAX} cars per bulk purchase")

    lines: List[Dict[str, Any]] = []
    total_price = 0
    for car_id, quantity in qty_by_car.items():
        car_info = next((c for c in CARS if c.get("id") == car_id), None)
        if not car_info:
            raise HTTPException(status_code=400, detail=f"Car not found: {car_id}")
        if car_info.get("id") in DEALER_EXCLUDED_IDS or car_info.get("rarity") in ("loot_exclusive", "vip_exclusive"):
            raise HTTPException(status_code=400, detail=f"That car is not for sale: {car_info.get('name') or car_id}")
        price = int(car_info.get("value", 0) * _dealer_price_multiplier(car_info))
        catalog_value = int(car_info.get("value", 0))
        unit_profit = dealership_sale_profit(price, catalog_value)
        lines.append({
            "car_id": car_id,
            "car_info": car_info,
            "price": price,
            "profit": unit_profit,
            "requested": quantity,
        })
        total_price += price * quantity

    pay_result = await db.users.update_one(
        {"id": uid, "money": {"$gte": total_price}},
        {"$inc": {"money": -total_price}},
    )
    if pay_result.modified_count == 0:
        raise HTTPException(status_code=400, detail=f"Insufficient money. Need ${total_price:,}.")

    bought_lines: List[Dict[str, Any]] = []
    shortfalls: List[Dict[str, Any]] = []
    for line in lines:
        car_id = line["car_id"]
        requested = int(line["requested"])
        price = int(line["price"])
        stock_docs = await db.dealer_stock.find({"car_id": car_id}).limit(requested).to_list(requested)
        bought_count = len(stock_docs)
        if bought_count < requested:
            shortfalls.append({"car_id": car_id, "requested": requested, "bought": bought_count})
        if stock_docs:
            ids = [d["_id"] for d in stock_docs]
            await db.dealer_stock.delete_many({"_id": {"$in": ids}})
            for _ in range(bought_count):
                bought_lines.append(line)

    if not bought_lines:
        await db.users.update_one({"id": uid}, {"$inc": {"money": total_price}})
        raise HTTPException(status_code=400, detail="All selected cars are out of stock. Try again in a moment.")

    refund = 0
    for line in lines:
        car_id = line["car_id"]
        requested = int(line["requested"])
        bought = sum(1 for bl in bought_lines if bl["car_id"] == car_id)
        if bought < requested:
            refund += int(line["price"]) * (requested - bought)
    if refund > 0:
        await db.users.update_one({"id": uid}, {"$inc": {"money": refund}})

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    user_car_docs = []
    transfer_docs = []
    for line in bought_lines:
        car_info = line["car_info"]
        price = int(line["price"])
        user_car_id = str(uuid.uuid4())
        user_car_docs.append({
            "id": user_car_id,
            "user_id": uid,
            "car_id": line["car_id"],
            "car_name": car_info.get("name"),
            "acquired_at": now_iso,
            "damage_percent": 0,
        })
        transfer_docs.append({
            "id": str(uuid.uuid4()),
            "from_user_id": uid,
            "from_username": username,
            "to_user_id": "__dealer__",
            "to_username": "Dealer",
            "amount": price,
            "created_at": now_iso,
            "car_name": car_info.get("name"),
            "transfer_type": "car_purchase",
        })

    await db.user_cars.insert_many(user_car_docs)
    if bought_lines:
        buy_inc = {"cars_purchased_from_dealership": len(bought_lines)}
        for line in bought_lines:
            _rarity = (line["car_info"].get("rarity") or "").strip().lower()
            if _rarity in ("uncommon", "rare", "ultra_rare", "legendary"):
                key = f"cars_purchased_dealership_{_rarity}"
                buy_inc[key] = int(buy_inc.get(key) or 0) + 1
        await db.users.update_one(
            {"id": uid},
            {"$inc": buy_inc},
        )
    if transfer_docs:
        await db.money_transfers.insert_many(transfer_docs)

    owner_profit_total = sum(int(l["profit"]) for l in bought_lines if int(l["profit"]) > 0)
    dealership = await get_garage_dealership(db)
    if dealership.get("owner_id") and owner_profit_total > 0:
        owner_shares = await load_global_property_owner_shares(db)
        await credit_garage_dealership_profit(db, dealer_owner_profit_cut(owner_profit_total, owner_shares))
        try:
            await _run_dealer_owner_auto_stock()
        except Exception:
            logger.exception("Dealer auto-stock after bulk sale")

    await _dealer_after_sale_restock("", {})
    _invalidate_travel_info_cache(uid)
    try:
        from routers.money.bank import _invalidate_overview_cache
        _invalidate_overview_cache(uid)
    except Exception:
        pass

    spent = sum(int(l["price"]) for l in bought_lines)
    out_of_stock_car_ids = [s["car_id"] for s in shortfalls if int(s.get("bought") or 0) == 0]
    await log_activity(
        uid,
        username,
        "garage_buy_cars_bulk",
        {
            "count": len(bought_lines),
            "spent": spent,
            "car_ids": [l["car_id"] for l in bought_lines],
            "shortfalls": shortfalls,
            "out_of_stock": out_of_stock_car_ids,
        },
    )

    msg = f"Purchased {len(bought_lines)} car{'s' if len(bought_lines) != 1 else ''} for ${spent:,}"
    if shortfalls:
        partial = [s for s in shortfalls if int(s.get("bought") or 0) > 0]
        if partial:
            msg += f" ({len(partial)} model{'s' if len(partial) != 1 else ''} partially filled — not charged for missing stock)"
        elif out_of_stock_car_ids:
            msg += f" ({len(out_of_stock_car_ids)} out of stock — not charged)"
    return {
        "success": True,
        "message": msg,
        "purchased_count": len(bought_lines),
        "spent": spent,
        "out_of_stock_car_ids": out_of_stock_car_ids,
        "shortfalls": shortfalls,
    }


# ----- Player-to-player car marketplace (list your car, buy other players' cars) -----
async def get_marketplace_listings(current_user: dict = Depends(get_current_user)):
    """List all listed player cars (cash). Includes your own listings so Buy Cars rarity filters stay accurate; you cannot buy your own listing (see buy_listed_car)."""
    buyer_id = current_user.get("id") or ""
    cursor = db.user_cars.find(
        {"listed_for_sale": True},
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
        car_id = uc.get("car_id")
        damage = 0 if _is_damage_immune_car(car_id, car_info.get("rarity")) else min(100, max(0, float(uc.get("damage_percent", 0))))
        is_own = (uc.get("user_id") or "") == buyer_id
        # Public marketplace response: expose only seller_username, never raw seller_id
        out.append({
            "user_car_id": listing_id,
            "seller_username": "You" if is_own else (seller or {}).get("username", "?"),
            "is_own_listing": bool(is_own),
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
    list_uc_id = _normalize_user_car_instance_id(request.user_car_id)
    user_car = await db.user_cars.find_one(
        {"user_id": current_user.get("id") or "", "id": list_uc_id}
    ) if list_uc_id else None
    if not user_car and list_uc_id:
        try:
            user_car = await db.user_cars.find_one(
                {"user_id": current_user.get("id") or "", "_id": ObjectId(list_uc_id)}
            )
        except Exception:
            user_car = None
    if not user_car:
        raise HTTPException(status_code=404, detail="Car not found in your garage")
    if user_car.get("listed_for_sale"):
        raise HTTPException(status_code=400, detail="Car is already listed")
    list_family_id = await resolve_family_id(current_user.get("id") or "")
    if list_family_id and await _family_in_active_war(list_family_id):
        car_info = next((c for c in CARS if c.get("id") == user_car.get("car_id")), None)
        if car_info and car_info.get("rarity") in _MARKET_EXCLUSIVE_RARITIES:
            raise HTTPException(status_code=403, detail=EXCLUSIVE_CAR_WAR_LOCK_DETAIL)
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
    car_info = next((c for c in CARS if c.get("id") == user_car.get("car_id")), None)
    if car_info and car_info.get("rarity") in _MARKET_EXCLUSIVE_RARITIES:
        from utils.exclusive_car_events import log_exclusive_car_event

        await log_exclusive_car_event(
            db,
            event_type="market_listed",
            car_id=user_car.get("car_id"),
            user_car_id=user_car.get("id") or request.user_car_id,
            from_user_id=current_user.get("id"),
            from_username=current_user.get("username"),
            price=request.price,
            car_name=car_info.get("name"),
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
    car_info = next((c for c in CARS if c.get("id") == user_car.get("car_id")), None)
    await log_activity(current_user.get("id", ""), current_user.get("username", "?"), "gta_delist", {"car_id": user_car.get("car_id")})
    if car_info and car_info.get("rarity") in _MARKET_EXCLUSIVE_RARITIES:
        from utils.exclusive_car_events import log_exclusive_car_event

        await log_exclusive_car_event(
            db,
            event_type="market_delisted",
            car_id=user_car.get("car_id"),
            user_car_id=user_car.get("id") or request.user_car_id,
            from_user_id=current_user.get("id"),
            from_username=current_user.get("username"),
            car_name=car_info.get("name"),
        )
    return {"message": "Car delisted"}


async def buy_listed_car(
    request: GTABuyListedCarRequest, current_user: dict = Depends(get_current_user_verified)
):
    """Buy a car listed by another player (pay cash to seller)."""
    buyer_id = current_user.get("id") or ""
    # Atomically claim the car before payment to prevent double-buy race condition
    listed_car_id = _normalize_user_car_instance_id(request.user_car_id)
    claim_filter = {"id": listed_car_id, "listed_for_sale": True, "user_id": {"$ne": buyer_id}}
    user_car = await db.user_cars.find_one_and_update(
        claim_filter,
        {"$set": {"listed_for_sale": False, "user_id": buyer_id}, "$unset": {"sale_price": "", "listed_at": ""}},
    )
    if not user_car:
        try:
            claim_filter_oid = {"_id": ObjectId(listed_car_id), "listed_for_sale": True, "user_id": {"$ne": buyer_id}}
            user_car = await db.user_cars.find_one_and_update(
                claim_filter_oid,
                {"$set": {"listed_for_sale": False, "user_id": buyer_id}, "$unset": {"sale_price": "", "listed_at": ""}},
            )
        except Exception:
            user_car = None
    if not user_car:
        # Distinguish self-buy from unavailable
        maybe_car = await db.user_cars.find_one({"id": listed_car_id, "listed_for_sale": True}) if listed_car_id else None
        if not maybe_car and listed_car_id:
            try:
                maybe_car = await db.user_cars.find_one({"_id": ObjectId(listed_car_id), "listed_for_sale": True})
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
    if car_info and car_info.get("rarity") in _MARKET_EXCLUSIVE_RARITIES:
        seller_family_id = await resolve_family_id(seller_id)
        if seller_family_id and await _family_in_active_war(seller_family_id):
            await _rollback_car()
            raise HTTPException(
                status_code=403,
                detail=(
                    "Cannot buy this listing — the seller's family is at war. "
                    "Exclusive and loot-exclusive cars cannot be sold on the market until the war ends."
                ),
            )
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
    catalog_value = int((car_info or {}).get("value", 0))
    profit = dealership_sale_profit(price, catalog_value)
    dealership = await get_garage_dealership(db)
    owner_cut = 0
    if dealership.get("owner_id") and profit > 0:
        owner_shares = await load_global_property_owner_shares(db)
        owner_cut = p2p_owner_profit_cut(profit, owner_shares)
        await credit_garage_dealership_profit(db, owner_cut)
        try:
            await _run_dealer_owner_auto_stock()
        except Exception:
            logger.exception("Dealer auto-stock after listing sale")
    seller_payout = max(0, price - owner_cut)
    # Ownership already transferred by find_one_and_update; pay seller
    await db.users.update_one({"id": seller_id}, {"$inc": {"money": seller_payout}})
    # Same mission counters as NPC dealer stock — Buy Cars page includes player listings.
    buy_inc = {"cars_purchased_from_dealership": 1}
    _rarity = ((car_info or {}).get("rarity") or "").strip().lower()
    if _rarity in ("uncommon", "rare", "ultra_rare", "legendary"):
        buy_inc[f"cars_purchased_dealership_{_rarity}"] = 1
    await db.users.update_one({"id": buyer_id}, {"$inc": buy_inc})
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
        "amount": seller_payout,
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
    if car_info and car_info.get("rarity") in _MARKET_EXCLUSIVE_RARITIES:
        from utils.exclusive_car_events import log_exclusive_car_event

        await log_exclusive_car_event(
            db,
            event_type="market_sale",
            car_id=user_car.get("car_id"),
            user_car_id=user_car.get("id"),
            from_user_id=seller_id,
            from_username=(seller or {}).get("username"),
            to_user_id=buyer_id,
            to_username=current_user.get("username"),
            price=price,
            car_name=car_name,
        )
    return {
        "message": f"Purchased {car_name} from seller for ${price:,}",
        "car_id": user_car.get("car_id"),
        "user_car_id": user_car.get("id"),
    }


# Repair cost = (damage% / 100) * (car value * fraction) — 100% damage = fraction of value
REPAIR_COST_FRACTION = 0.6


def _repair_car_query_from_user_car(user_car: dict, uid: str) -> dict:
    if user_car.get("_id") is not None:
        return {"_id": user_car["_id"]}
    return {"user_id": uid, "id": user_car.get("id")}


def _repair_cost_for_catalog_car(user_car: dict, car_info: Optional[dict]) -> int:
    """Cash repair cost for one garage row; 0 if not billable (listed, immune, no damage, unknown catalog)."""
    if not car_info:
        return 0
    if user_car.get("listed_for_sale"):
        return 0
    if _is_damage_immune_car(user_car.get("car_id"), car_info.get("rarity")):
        return 0
    damage = min(100, max(0, float(user_car.get("damage_percent", 0))))
    if damage <= 0:
        return 0
    value = int(car_info.get("value", 0))
    return max(1, round((damage / 100) * value * REPAIR_COST_FRACTION))


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
    car_info = next((c for c in CARS if c.get("id") == user_car.get("car_id")), None)
    if not car_info:
        raise HTTPException(status_code=400, detail="Car type not found")
    if _is_damage_immune_car(user_car.get("car_id"), car_info.get("rarity")):
        damage = 0.0
    else:
        damage = min(100, max(0, float(user_car.get("damage_percent", 0))))
    if damage <= 0:
        return {"message": "No repair needed", "damage_percent": 0}
    value = int(car_info.get("value", 0))
    cost = max(1, round((damage / 100) * value * REPAIR_COST_FRACTION))
    result = await db.users.update_one(
        {"id": current_user.get("id") or "", "money": {"$gte": cost}},
        {"$inc": {"money": -cost}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail=f"Insufficient money. Repair costs ${cost:,}.")
    q = _repair_car_query_from_user_car(user_car, current_user.get("id") or "")
    await db.user_cars.update_one(q, {"$set": {"damage_percent": 0}})
    await log_activity(current_user.get("id", ""), current_user.get("username", "?"), "gta_repair", {"car": car_info.get("name"), "cost": cost})
    return {
        "message": f"Repaired for ${cost:,}. Damage 0%.",
        "damage_percent": 0,
        "cost": cost,
    }


async def repair_all_cars(current_user: dict = Depends(get_current_user_verified)):
    """Repair every damaged, unlisted, non-immune car in one payment (same per-car formula as repair-car)."""
    uid = current_user.get("id") or ""
    lock = await _get_gta_garage_lock(uid)
    async with lock:
        await db.user_cars.update_many(
            {
                "user_id": uid,
                "car_id": {"$in": _damage_immune_car_ids()},
                "damage_percent": {"$gt": 0},
            },
            {"$set": {"damage_percent": 0}},
        )
        rows = await db.user_cars.find({"user_id": uid}).to_list(GARAGE_FETCH_LIMIT)
        repairs: List[Tuple[dict, int]] = []
        total = 0
        for uc in rows:
            car_info = next((c for c in CARS if c.get("id") == uc.get("car_id")), None)
            cost = _repair_cost_for_catalog_car(uc, car_info)
            if cost <= 0:
                continue
            repairs.append((_repair_car_query_from_user_car(uc, uid), cost))
            total += cost
        if total == 0 or not repairs:
            return {"message": "No damaged cars to repair.", "total_cost": 0, "repaired_count": 0}
        deduct = await db.users.update_one(
            {"id": uid, "money": {"$gte": total}},
            {"$inc": {"money": -total}},
        )
        if deduct.modified_count == 0:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient money. Repair all costs ${total:,}.",
            )
        try:
            ops = [UpdateOne(q, {"$set": {"damage_percent": 0}}) for q, _ in repairs]
            await db.user_cars.bulk_write(ops, ordered=False)
        except Exception:
            logger.exception("repair_all bulk_write failed user=%s", uid)
            await db.users.update_one({"id": uid}, {"$inc": {"money": total}})
            raise HTTPException(status_code=500, detail="Repair failed; money was refunded.")
        repaired_count = len(repairs)
        await log_activity(
            uid,
            current_user.get("username") or "?",
            "gta_repair_all",
            {"repaired_count": repaired_count, "total_cost": total},
        )
        return {
            "message": f"Repaired {repaired_count} car(s) for ${total:,}.",
            "total_cost": total,
            "repaired_count": repaired_count,
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
        out["travel_time"] = travel_seconds_for_car(car.get("id"), rarity, 45)
    return out


async def _is_car_on_owner_profile(db, owner_id: str, user_car_id: str) -> bool:
    """True if this car is pinned on the owner's public profile."""
    owner = await db.users.find_one(
        {"id": owner_id},
        {"_id": 0, "profile_show_cars": 1, "profile_car_ids": 1, "profile_featured_car_id": 1},
    )
    if not owner or not owner.get("profile_show_cars"):
        return False
    car_ids = owner.get("profile_car_ids") or (
        [owner["profile_featured_car_id"]] if owner.get("profile_featured_car_id") else []
    )
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
    if user_car.get("car_id") not in _CUSTOM_IMAGE_CAR_IDS:
        raise HTTPException(status_code=400, detail="Only custom or VIP Pass cars can have a custom picture")

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
    car_instance_id = _normalize_user_car_instance_id(id)
    user_car = await db.user_cars.find_one({"id": car_instance_id}) if car_instance_id else None
    if not user_car and car_instance_id:
        try:
            user_car = await db.user_cars.find_one({"_id": ObjectId(car_instance_id)})
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
    travel_time = (
        TRAVEL_TIMES.get("custom", 12)
        if car_id == "car_custom"
        else travel_seconds_for_car(car_id, rarity, 45)
    )
    damage_percent = 0 if _is_damage_immune_car(car_id, rarity) else min(100, max(0, float(user_car.get("damage_percent", 0))))
    name = user_car.get("custom_name") or user_car.get("car_name") or car_info.get("name")
    image = car_info.get("image")
    if car_id in _CUSTOM_IMAGE_CAR_IDS and user_car.get("custom_image_url"):
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
    try:
        from utils.exclusive_car_weekly_loot import weekly_loot_pieces_for_car, weekly_loot_breakdown_for_user

        weekly_loot = weekly_loot_pieces_for_car(car_id, rarity)
        if weekly_loot > 0:
            out["weekly_loot_pieces"] = weekly_loot
        if owner_id == (current_user.get("id") or ""):
            breakdown = await weekly_loot_breakdown_for_user(db, owner_id)
            if int(breakdown.get("pieces") or 0) > 0:
                out["weekly_loot_pieces_total"] = int(breakdown["pieces"])
                out["weekly_loot_pieces_cap"] = int(breakdown.get("cap") or 128)
            if car_id == "car24":
                from utils.loot_exclusive_540k import (
                    FAST_TRAVELS_PER_DAY,
                    WEEKLY_MISSION_SKIP,
                    WEEKLY_ROBOT_HIRES,
                    WHEEL_FREE_PER_DAY,
                    fast_travels_remaining,
                )

                user_doc = await db.users.find_one(
                    {"id": owner_id},
                    {"_id": 0, "car24_fast_travel_day": 1, "car24_fast_travels_today": 1},
                )
                out["fast_travels_per_day"] = FAST_TRAVELS_PER_DAY
                out["fast_travels_remaining"] = fast_travels_remaining(user_doc)
                out["extra_wheel_free_spins_per_day"] = WHEEL_FREE_PER_DAY
                out["weekly_mission_skip_tokens"] = WEEKLY_MISSION_SKIP
                out["weekly_robot_bodyguard_hire_tokens"] = WEEKLY_ROBOT_HIRES
    except Exception:
        pass
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
                if c.get("id") in DEALER_EXCLUDED_IDS or c.get("rarity") in ("loot_exclusive", "vip_exclusive"):
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
            await _run_dealer_owner_auto_stock()
        except Exception as e:
            logger.exception("Dealer replenish loop: %s", e)
        delay = _rng.uniform(DEALER_REPLENISH_MIN_SEC, DEALER_REPLENISH_MAX_SEC)
        await asyncio.sleep(delay)


async def run_dealer_auto_stock_loop():
    """Run owner auto-stock frequently (partial fills from pending profit)."""
    await asyncio.sleep(90)
    while True:
        try:
            await _run_dealer_owner_auto_stock()
        except Exception as e:
            logger.exception("Dealer auto-stock loop: %s", e)
        await asyncio.sleep(DEALER_AUTO_STOCK_INTERVAL_SEC)


async def get_gta_exclusive_pool_status(current_user: dict = Depends(get_current_user)):
    """Return whether the Al Capone exclusive is currently in the GTA car pool (any authenticated user)."""
    released = await _gta_exclusive_pool_released_from_config()
    return {"exclusive_in_pool": bool(released)}


async def get_garage_dealership_status(current_user: dict = Depends(get_current_user)):
    """Ownership status for the global car dealership (Buy Cars dealer)."""
    await _maybe_auto_relinquish_dealership()
    dealership = await get_garage_dealership(db)
    owner_shares = await load_global_property_owner_shares(db)
    uid = current_user.get("id") or ""
    owner_id = dealership.get("owner_id")
    is_owner = bool(owner_id and owner_id == uid)
    family_id = await resolve_family_id(uid) if is_owner else None
    transfer_locked_war = bool(is_owner and family_id and await _family_in_active_war(family_id))
    stock_by_rarity = await _dealer_stock_counts_by_rarity() if is_owner else {}
    payload = {
        "owner_id": owner_id,
        "owner_username": dealership.get("owner_username"),
        "is_owner": is_owner,
        "claim_cost_points": GARAGE_DEALERSHIP_CLAIM_COST_POINTS,
        "owner_pending_profit": int(dealership.get("owner_pending_profit") or 0) if is_owner else None,
        "dealer_owner_profit_share_pct": owner_shares["dealer_owner_profit_share_pct"],
        "player_sale_owner_profit_share_pct": owner_shares["player_sale_owner_profit_share_pct"],
        "transfer_locked_war": transfer_locked_war,
    }
    if is_owner:
        payload.update(_dealership_stock_status_payload(dealership, stock_by_rarity))
    return payload


async def estimate_garage_dealership_stock(
    rarity: str = Query(...),
    target_per_model: int = Query(DEALER_OWNER_STOCK_DEFAULT_TARGET),
    current_user: dict = Depends(get_current_user),
):
    """Preview owner stocking cost before paying."""
    uid = current_user.get("id") or ""
    dealership = await get_garage_dealership(db)
    if dealership.get("owner_id") != uid:
        raise HTTPException(status_code=403, detail="You do not own the car dealership")
    r = _normalize_owner_stock_rarity(rarity)
    target = _owner_stock_target_per_model(target_per_model)
    lines, total_fee, total_units = await _owner_stock_plan(r, target)
    return {
        "rarity": r,
        "target_per_model": target,
        "lines": lines,
        "total_units": total_units,
        "total_fee": total_fee,
        "fee_rate_pct": int(DEALER_OWNER_STOCK_FEE_RATE * 100),
    }


async def stock_garage_dealership(
    request: DealershipStockRequest,
    current_user: dict = Depends(get_current_user),
):
    """Pay a stocking fee to fill dealer models of a rarity up to target per model."""
    uid = current_user.get("id") or ""
    dealership = await get_garage_dealership(db)
    if dealership.get("owner_id") != uid:
        raise HTTPException(status_code=403, detail="You do not own the car dealership")
    r = _normalize_owner_stock_rarity(request.rarity)
    target = _owner_stock_target_per_model(request.target_per_model)
    pay_from = (request.pay_from or "cash").strip().lower()
    if pay_from not in ("cash", "profit"):
        raise HTTPException(status_code=400, detail="pay_from must be cash or profit")
    lines, total_fee, total_units = await _owner_stock_plan(r, target)
    if not lines or total_units <= 0:
        return {
            "message": f"No stocking needed — {r.replace('_', ' ')} models are already at {target} or above.",
            "total_units": 0,
            "total_fee": 0,
        }
    if pay_from == "cash":
        pay_result = await db.users.update_one(
            {"id": uid, "money": {"$gte": total_fee}},
            {"$inc": {"money": -total_fee}},
        )
        if pay_result.modified_count == 0:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient cash. Stocking fee is ${total_fee:,} ({int(DEALER_OWNER_STOCK_FEE_RATE * 100)}% of catalog value × {total_units} cars).",
            )
        try:
            from routers.money.bank import _invalidate_overview_cache
            _invalidate_overview_cache(uid)
        except Exception:
            pass
    elif not await debit_garage_dealership_profit(db, total_fee):
        pending = int(dealership.get("owner_pending_profit") or 0)
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient pending profit (${pending:,}). Need ${total_fee:,} to stock {total_units} cars.",
        )
    inserted = await _insert_owner_stock_lines(lines)
    await log_activity(
        uid,
        current_user.get("username") or "?",
        "garage_dealership_stock",
        {"rarity": r, "units": inserted, "fee": total_fee, "pay_from": pay_from, "target_per_model": target},
    )
    return {
        "message": f"Stocked {inserted} {r.replace('_', ' ')} car{'s' if inserted != 1 else ''} for ${total_fee:,}.",
        "total_units": inserted,
        "total_fee": total_fee,
        "target_per_model": target,
        "pay_from": pay_from,
    }


async def configure_garage_dealership_auto_stock(
    request: DealershipAutoStockRequest,
    current_user: dict = Depends(get_current_user),
):
    """Enable/disable automatic rarity stocking paid from pending profit."""
    uid = current_user.get("id") or ""
    dealership = await get_garage_dealership(db)
    if dealership.get("owner_id") != uid:
        raise HTTPException(status_code=403, detail="You do not own the car dealership")
    if request.enabled:
        if not (request.rarity or "").strip():
            raise HTTPException(status_code=400, detail="Choose a rarity for auto-stock")
        r = _normalize_owner_stock_rarity(request.rarity)
        target = _owner_stock_target_per_model(request.target_per_model)
        await db.garage_dealership.update_one(
            {"id": GARAGE_DEALERSHIP_ID, "owner_id": uid},
            {
                "$set": {
                    "auto_stock_enabled": True,
                    "auto_stock_rarity": r,
                    "auto_stock_target": target,
                }
            },
        )
        run_result = await _run_dealer_owner_auto_stock()
        msg = (
            f"Auto-stock enabled: keep {r.replace('_', ' ')} models at {target} each "
            f"({int(DEALER_OWNER_STOCK_FEE_RATE * 100)}% catalog fee, paid from pending profit as it builds)."
        )
        stocked = int(run_result.get("stocked") or 0)
        fee = int(run_result.get("fee") or 0)
        if stocked > 0:
            msg += f" Stocked {stocked} car{'s' if stocked != 1 else ''} now (${fee:,} from profit)."
        elif run_result.get("reason") == "no_profit":
            msg += " No pending profit yet — cars will stock automatically when sales profit accumulates."
        elif run_result.get("reason") == "at_target_or_cannot_afford_unit":
            msg += " Already at target, or profit is below the cheapest unit fee for this rarity."
        return {
            "message": msg,
            "auto_stock": {"enabled": True, "rarity": r, "target_per_model": target},
            "auto_stock_run": run_result,
        }
    await db.garage_dealership.update_one(
        {"id": GARAGE_DEALERSHIP_ID, "owner_id": uid},
        {"$set": dealership_auto_stock_defaults()},
    )
    return {"message": "Auto-stock disabled.", "auto_stock": dealership_auto_stock_defaults()}


async def claim_garage_dealership(current_user: dict = Depends(get_current_user_verified)):
    """Pay points to become owner of the car dealership."""
    rank_id, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
    prestige_level = int(current_user.get("prestige_level") or 0)
    if rank_id < CAPO_RANK_ID and prestige_level < 1:
        raise HTTPException(
            status_code=403,
            detail="You must be rank Capo or higher to claim the car dealership. Reach Capo to hold one.",
        )
    uid = current_user.get("id") or ""
    if await user_owns_garage_dealership(db, uid):
        raise HTTPException(status_code=400, detail="You already own the car dealership")
    if await _user_owns_any_property(uid):
        raise HTTPException(status_code=400, detail=GARAGE_DEALERSHIP_PROPERTY_CONFLICT_DETAIL)
    dealership = await get_garage_dealership(db)
    if dealership.get("owner_id"):
        raise HTTPException(status_code=400, detail="The car dealership already has an owner")
    cost = GARAGE_DEALERSHIP_CLAIM_COST_POINTS
    result = await db.users.update_one(
        {"id": uid, "points": {"$gte": cost}},
        {"$inc": {"points": -cost, "lifetime_points_spent": cost}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail=f"Insufficient points. Need {cost:,} points.")
    claim_set = {
        "owner_id": uid,
        "owner_username": current_user.get("username") or "?",
        **dealership_auto_stock_defaults(),
    }
    if rank_id < CAPO_RANK_ID:
        claim_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
    claim_result = await db.garage_dealership.update_one(
        {"id": GARAGE_DEALERSHIP_ID, "owner_id": None},
        {"$set": claim_set},
    )
    if claim_result.modified_count == 0:
        await db.users.update_one({"id": uid}, {"$inc": {"points": cost, "lifetime_points_spent": -cost}})
        raise HTTPException(status_code=400, detail="Someone else claimed the dealership first. Try again.")
    try:
        from utils.point_provenance import log_points_event
        await log_points_event(db, user_id=uid, points=-cost, event_type="garage_dealership_claim", meta={"cost": cost})
    except Exception:
        pass
    await log_activity(uid, current_user.get("username") or "?", "garage_dealership_claim", {"cost_points": cost})
    return {"message": f"You now own the car dealership ({cost:,} points).", "cost_points": cost}


async def collect_garage_dealership(current_user: dict = Depends(get_current_user)):
    """Collect pending cash profit from dealership sales."""
    uid = current_user.get("id") or ""
    await _maybe_auto_relinquish_dealership()
    old = await db.garage_dealership.find_one_and_update(
        {"id": GARAGE_DEALERSHIP_ID, "owner_id": uid, "owner_pending_profit": {"$gt": 0}},
        {"$set": {"owner_pending_profit": 0}},
        projection={"_id": 0, "owner_pending_profit": 1},
        return_document=False,
    )
    if not old:
        dealership = await get_garage_dealership(db)
        if dealership.get("owner_id") != uid:
            raise HTTPException(status_code=403, detail="You do not own the car dealership")
        return {"message": "No profit to collect yet.", "collected_money": 0}
    pending = int(old.get("owner_pending_profit") or 0)
    if pending > 0:
        await db.users.update_one({"id": uid}, {"$inc": {"money": pending}})
        try:
            from routers.money.bank import _invalidate_overview_cache
            _invalidate_overview_cache(uid)
        except Exception:
            pass
    return {"message": f"Collected ${pending:,} from dealership sales.", "collected_money": pending}


async def relinquish_garage_dealership(current_user: dict = Depends(get_current_user)):
    """Relinquish car dealership ownership."""
    uid = current_user.get("id") or ""
    dealership = await get_garage_dealership(db)
    if dealership.get("owner_id") != uid:
        raise HTTPException(status_code=403, detail="You do not own the car dealership")
    pending = int(dealership.get("owner_pending_profit") or 0)
    if pending > 0:
        await db.users.update_one({"id": uid}, {"$inc": {"money": pending}})
        try:
            from routers.money.bank import _invalidate_overview_cache
            _invalidate_overview_cache(uid)
        except Exception:
            pass
    await db.garage_dealership.update_one(
        {"id": GARAGE_DEALERSHIP_ID, "owner_id": uid},
        {"$set": {"owner_id": None, "owner_username": None, "owner_pending_profit": 0, **dealership_auto_stock_defaults()}, "$unset": {"stack_conflict_acquired_at": ""}},
    )
    await log_activity(uid, current_user.get("username") or "?", "garage_dealership_relinquish", {})
    return {"message": "Car dealership relinquished. It is now unclaimed."}


async def garage_dealership_send_to_user(
    request: DealershipSendToUserRequest,
    current_user: dict = Depends(get_current_user),
):
    """Transfer car dealership ownership to another player."""
    target_username = (request.target_username or "").strip()
    if not target_username:
        raise HTTPException(status_code=400, detail="Enter a username")
    uid = current_user.get("id") or ""
    family_id = await resolve_family_id(uid)
    if family_id and await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail=GARAGE_DEALERSHIP_WAR_LOCK_DETAIL)
    await _maybe_auto_relinquish_dealership()
    dealership = await get_garage_dealership(db)
    if dealership.get("owner_id") != uid:
        raise HTTPException(status_code=403, detail="You do not own the car dealership")
    target = await db.users.find_one(
        {"username": _username_pattern(target_username)},
        {"_id": 0, "id": 1, "username": 1, "rank_points": 1},
    )
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["id"] == uid:
        raise HTTPException(status_code=400, detail="Cannot transfer to yourself")
    await raise_if_civilian_protected_asset_recipient(db, target["id"])
    if await user_owns_garage_dealership(db, target["id"]):
        raise HTTPException(status_code=400, detail="That user already owns the car dealership")
    if await _user_owns_any_property(target["id"]):
        raise HTTPException(status_code=400, detail=GARAGE_DEALERSHIP_TRANSFER_TARGET_CONFLICT_DETAIL)
    transfer_set = {
        "owner_id": target["id"],
        "owner_username": target.get("username", target_username),
        **dealership_auto_stock_defaults(),
    }
    tgt_rank = get_rank_info(target.get("rank_points", 0), user_prestige_rank_mult(target))[0]
    unset_fields: Dict[str, str] = {"stack_conflict_acquired_at": ""}
    if tgt_rank < CAPO_RANK_ID:
        transfer_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
    else:
        unset_fields["below_capo_acquired_at"] = ""
    await db.garage_dealership.update_one(
        {"id": GARAGE_DEALERSHIP_ID, "owner_id": uid},
        {"$set": transfer_set, "$unset": unset_fields},
    )
    await cancel_garage_dealership_quicktrade_listings(db)
    await log_activity(
        uid,
        current_user.get("username") or "?",
        "garage_dealership_transfer",
        {"to_user": target.get("username", target_username), "to_user_id": target["id"]},
    )
    sender_name = (current_user.get("username") or "").strip() or "?"
    await send_notification(
        target["id"],
        "Car dealership transferred",
        f"{sender_name} sent you the car dealership.",
        "reward",
    )
    await maybe_revoke_civilian_protection(db, target["id"], "received_property_transfer")
    return {"message": f"Car dealership transferred to {target.get('username', target_username)}."}


async def garage_dealership_sell_on_trade(
    request: DealershipSellOnTradeRequest,
    current_user: dict = Depends(get_current_user),
):
    """List the car dealership on Quick Trade for points."""
    pts = int(request.points or 0)
    if pts <= 0:
        raise HTTPException(status_code=400, detail="Points must be positive")
    uid = current_user.get("id") or ""
    family_id = await resolve_family_id(uid)
    if family_id and await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail=GARAGE_DEALERSHIP_WAR_LOCK_DETAIL)
    await _maybe_auto_relinquish_dealership()
    dealership = await get_garage_dealership(db)
    if dealership.get("owner_id") != uid:
        raise HTTPException(status_code=403, detail="You do not own the car dealership")
    existing = await db.properties.find_one({"type": "garage_dealership", "for_sale": True})
    if existing:
        raise HTTPException(status_code=400, detail="The car dealership is already listed on Quick Trade. Cancel that listing first.")
    listing_id = ObjectId()
    listing = {
        "_id": listing_id,
        "id": str(listing_id),
        "type": "garage_dealership",
        "name": "Car Dealership",
        "owner_id": uid,
        "owner_username": current_user.get("username", "Unknown"),
        "for_sale": True,
        "sale_price": pts,
        "created_at": datetime.now(timezone.utc),
    }
    await db.properties.insert_one(listing)
    try:
        from routers.money.quicktrade import _invalidate_trade_caches
        _invalidate_trade_caches()
    except Exception:
        pass
    return {"message": f"Car Dealership listed for {pts:,} points on Quick Trade"}


async def _gta_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_GTA)


_gta_rl_u = [Depends(_gta_sustained_rl_user)]


def register(router):
    router.add_api_route("/gta/options", get_gta_options, methods=["GET"], dependencies=_gta_rl_u)
    router.add_api_route("/gta/playable-count", get_gta_playable_count, methods=["GET"], dependencies=_gta_rl_u)
    router.add_api_route("/gta/exclusive-pool-status", get_gta_exclusive_pool_status, methods=["GET"], dependencies=_gta_rl_u)
    router.add_api_route("/gta/car/{car_id}", get_car, methods=["GET"], dependencies=_gta_rl_u)
    router.add_api_route(
        "/gta/attempt",
        attempt_gta,
        methods=["POST"],
        response_model=GTAAttemptResponse,
    )
    router.add_api_route("/gta/stats", get_gta_stats, methods=["GET"], dependencies=_gta_rl_u)
    router.add_api_route("/gta/garage", get_garage, methods=["GET"], dependencies=_gta_rl_u)
    router.add_api_route("/gta/recent-stolen", get_recent_stolen, methods=["GET"], dependencies=_gta_rl_u)
    router.add_api_route("/gta/melt", melt_cars, methods=["POST"])
    router.add_api_route("/gta/cars-for-sale", get_cars_for_sale, methods=["GET"], dependencies=_gta_rl_u)
    router.add_api_route("/gta/buy-car", buy_car, methods=["POST"])
    router.add_api_route("/gta/buy-cars-bulk", buy_cars_bulk, methods=["POST"])
    router.add_api_route("/gta/marketplace", get_marketplace_listings, methods=["GET"], dependencies=_gta_rl_u)
    router.add_api_route("/gta/list-car", list_car, methods=["POST"])
    router.add_api_route("/gta/delist-car", delist_car, methods=["POST"])
    router.add_api_route("/gta/buy-listed-car", buy_listed_car, methods=["POST"])
    router.add_api_route("/gta/dealership", get_garage_dealership_status, methods=["GET"], dependencies=_gta_rl_u)
    router.add_api_route("/gta/dealership/stock-estimate", estimate_garage_dealership_stock, methods=["GET"], dependencies=_gta_rl_u)
    router.add_api_route("/gta/dealership/stock", stock_garage_dealership, methods=["POST"])
    router.add_api_route("/gta/dealership/auto-stock", configure_garage_dealership_auto_stock, methods=["POST"])
    router.add_api_route("/gta/dealership/claim", claim_garage_dealership, methods=["POST"])
    router.add_api_route("/gta/dealership/collect", collect_garage_dealership, methods=["POST"])
    router.add_api_route("/gta/dealership/relinquish", relinquish_garage_dealership, methods=["POST"])
    router.add_api_route("/gta/dealership/send-to-user", garage_dealership_send_to_user, methods=["POST"])
    router.add_api_route("/gta/dealership/sell-on-trade", garage_dealership_sell_on_trade, methods=["POST"])
    router.add_api_route("/gta/repair-car", repair_car, methods=["POST"])
    router.add_api_route("/gta/repair-all", repair_all_cars, methods=["POST"])
    router.add_api_route("/gta/custom-car/{user_car_id}", update_custom_car_image, methods=["PATCH"])
    router.add_api_route("/gta/view-car", get_view_car, methods=["GET"], dependencies=_gta_rl_u)