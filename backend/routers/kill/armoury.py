# Armoury: one per state (bullet factory + armour + weapons). Single ownership entity (db.bullet_factory).
# Owner can claim (pay), set bullet price; produces up to 5k bullets per day and can produce armour & weapons (pay per hour, stock accumulates).
# Bullets sold from factory stock; armour/weapons from armoury stock. Others buy at owner's price (or unowned price).
from datetime import datetime, timezone, timedelta
import os
import sys
import random
import time
from typing import Optional, List, Tuple, Dict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import Depends, HTTPException, Request, Body
from pydantic import BaseModel, ConfigDict
from bson.objectid import ObjectId

from server import db, get_current_user, get_effective_event, STATES, get_rank_info, CAPO_RANK_ID, maybe_auto_relinquish_below_capo, _is_admin, _username_pattern, ARMOUR_SETS, ARMOUR_WEAPON_MARGIN, get_effective_event, STATES, get_rank_info, CAPO_RANK_ID, maybe_auto_relinquish_below_capo, _is_admin, _username_pattern, ARMOUR_SETS, ARMOUR_WEAPON_MARGIN, _family_in_active_war, CARS, _get_staff_user_ids, send_notification, log_activity, log_minigame_payout
from utils.point_provenance import log_points_event
from utils.claim_costs import load_claim_costs
from utils.game_pass_micro_rewards import (
    micro_tier_from_rank_points,
    rewards_for_micro_tier,
    format_rewards_summary,
    REWARD_KEY_ORDER,
    REWARD_KEY_LABELS,
    MAX_MICRO_TIER,
    vip_rewards_after_free_dedupe,
)
from routers.game.store import _store_cost_inc
from routers.minigames.minigame_leaderboard import log_minigame_play
from utils.minigame_run_session import (
    claim_minigame_run_session,
    enforce_numeric_score_for_claimed_session,
    get_plays_left,
    utc_rate_limit_window,
    RATE_LIMIT_PERIOD_HOURS,
)
from utils.minigame_security import skip_minigame_session

# 5k bullets per 24h, effectively delivered every 20 mins (72 ticks per day)
BULLET_FACTORY_TOTAL_PER_24H = 5000
BULLET_FACTORY_UNOWNED_TOTAL_PER_24H = 1000  # unclaimed armoury: lower bullet stock cap
BULLET_FACTORY_TICK_MINUTES = 20
BULLET_FACTORY_PRODUCTION_PER_HOUR = BULLET_FACTORY_TOTAL_PER_24H / 24  # ~208.33
BULLET_FACTORY_MAX_HOURS_CAP = 24  # cap accumulated at 24h of production (5000 total)
BULLET_FACTORY_BUY_MAX_PER_PURCHASE = 5000  # max bullets per single purchase
BULLET_FACTORY_BUY_COOLDOWN_MINUTES = 15  # must wait this long between purchases
# Armoury claim cost: utils.claim_costs (key armoury)
BULLET_FACTORY_PRICE_MIN = 1
BULLET_FACTORY_PRICE_MAX = 100_000  # max $ per bullet (when owned)
# 75% reduction for beta
BULLET_FACTORY_UNOWNED_PRICE_MIN = 625
BULLET_FACTORY_UNOWNED_PRICE_MAX = 1000

# Armoury production: 5 per hour per armour/weapon; max 15 in stock per item (per level per weapon)
ARMOURY_ARMOUR_RATE_PER_HOUR = 5
ARMOURY_WEAPON_RATE_PER_HOUR = 5
ARMOURY_MAX_STOCK_PER_ITEM = 15

# Unclaimed armoury: only basic stock sold to players (tier 1 armour, weapon1)
ARMOURY_UNOWNED_ONLY_WEAPON_ID = "weapon1"

# Owner-set cash list price (pre-event mult) for money armour / money weapons; points tiers unchanged
ARMOURY_ITEM_MONEY_PRICE_MAX = 5_000_000


def _clamp_armoury_money_list_price(v: int) -> int:
    return max(1, min(ARMOURY_ITEM_MONEY_PRICE_MAX, int(v)))


def _armour_money_list_base(armour: dict) -> Optional[int]:
    cm = armour.get("cost_money")
    if cm is None:
        return None
    return int(cm * ARMOUR_WEAPON_MARGIN)


def _armour_money_override_list(factory: Optional[dict], level: int) -> Optional[int]:
    if not factory:
        return None
    d = factory.get("armour_sell_price_money") or {}
    v = d.get(str(level), d.get(level))
    if v is None:
        return None
    try:
        return _clamp_armoury_money_list_price(int(v))
    except (TypeError, ValueError):
        return None


def _effective_armour_money_sell(armour: dict, factory: Optional[dict], mult: float) -> int:
    base = _armour_money_list_base(armour)
    if base is None:
        return int(armour["cost_points"] * ARMOUR_WEAPON_MARGIN * mult)
    ov = _armour_money_override_list(factory, int(armour["level"]))
    list_pre_mult = ov if ov is not None else base
    return int(list_pre_mult * mult)


def _effective_armour_points_sell(armour: dict, mult: float) -> int:
    return int(armour["cost_points"] * ARMOUR_WEAPON_MARGIN * mult)


def _weapon_money_list_base(weapon: dict) -> Optional[int]:
    pm = weapon.get("price_money")
    if pm is None:
        return None
    return int(pm * ARMOUR_WEAPON_MARGIN)


def _weapon_money_override_list(factory: Optional[dict], weapon_id: str) -> Optional[int]:
    if not factory:
        return None
    d = factory.get("weapon_sell_price_money") or {}
    v = d.get(weapon_id)
    if v is None:
        return None
    try:
        return _clamp_armoury_money_list_price(int(v))
    except (TypeError, ValueError):
        return None


def _effective_weapon_money_sell(weapon: dict, factory: Optional[dict], mult: float) -> Optional[int]:
    if weapon.get("price_money") is None:
        return None
    base = _weapon_money_list_base(weapon)
    ov = _weapon_money_override_list(factory, weapon["id"])
    list_pre_mult = ov if ov is not None else (base or 0)
    return int(list_pre_mult * mult)

# Store: buy bullets with points (pack size -> points cost)
BULLET_PACKS = {5000: 100, 10000: 175, 50000: 775, 100000: 1525}  # matches store

# Consumable tokens: 1 token = 1 hour effect. Stackable up to max_stack_hours per type (24h cap).
TOKEN_DURATION_HOURS = 1
TOKEN_MAX_STACK_HOURS = 24
TOKEN_TYPES = (
    "xp_crimes",
    "xp_gta",
    # Auto-rank boost: affects both crimes+GTA durations simultaneously.
    "auto_rank_2h",
    "melt",
    "oc_reduced",
    "booze",
    "racket",
    "travel",
    "properties",
    "jailbust_bonus",
    # Rank-XP (£9.99) pass token: 24h window granted only when activated via Armoury/My Inventory.
    "rank_xp_pass",
)
# count_field: user doc key for token count
# until_field: active-until ISO timestamp
# duration_hours: effect duration per token (overrides global TOKEN_DURATION_HOURS)
# expiry_field: optional "token expiry" ISO timestamp (for unactivated tokens)
# max_stack_hours: cap when stacking (per-token stacking rules)
TOKEN_CONFIG = {
    "xp_crimes":     {"count_field": "xp_crimes_tokens",     "until_field": "xp_crimes_until",     "max_stack_hours": TOKEN_MAX_STACK_HOURS},
    "xp_gta":        {"count_field": "xp_gta_tokens",        "until_field": "xp_gta_until",        "max_stack_hours": TOKEN_MAX_STACK_HOURS},
    "auto_rank_2h":  {"count_field": "auto_rank_2h_tokens",  "until_field": "auto_rank_trial_until", "duration_hours": 2, "max_stack_hours": TOKEN_MAX_STACK_HOURS},
    "melt":          {"count_field": "melt_tokens",          "until_field": "melt_until",          "max_stack_hours": TOKEN_MAX_STACK_HOURS},
    "oc_reduced":    {"count_field": "oc_reduced_tokens",    "until_field": "oc_reduced_until",    "max_stack_hours": TOKEN_MAX_STACK_HOURS},
    "booze":         {"count_field": "booze_tokens",         "until_field": "booze_until",         "max_stack_hours": TOKEN_MAX_STACK_HOURS},
    "racket":        {"count_field": "racket_tokens",        "until_field": "racket_until",        "max_stack_hours": TOKEN_MAX_STACK_HOURS},
    "travel":        {"count_field": "travel_tokens",        "until_field": "travel_until",        "max_stack_hours": TOKEN_MAX_STACK_HOURS},
    "properties":    {"count_field": "properties_tokens",    "until_field": "properties_until",    "max_stack_hours": TOKEN_MAX_STACK_HOURS},
    "jailbust_bonus": {"count_field": "jailbust_tokens",     "until_field": "jailbust_bonus_until", "max_stack_hours": TOKEN_MAX_STACK_HOURS},
    # 24h multiplier window, only when the token is activated.
    "rank_xp_pass": {
        "count_field": "rank_xp_pass_tokens",
        "until_field": "rank_xp_pass_bonus_until",
        "duration_hours": 24,
        "expiry_field": "rank_xp_pass_token_expires_at",
        # Effect stacking is allowed (buy again after consuming); choose a large cap so stacking isn't artificially limited.
        "max_stack_hours": 8760,  # ~1 year
    },
}

# My Inventory: exchange 1× Auto Rank (2h) token → 2 random distinct 1h tokens from pool (no cash/points).
AUTO_RANK_EXCHANGE_POOL = (
    "xp_crimes",
    "xp_gta",
    "melt",
    "oc_reduced",
    "booze",
    "racket",
    "travel",
    "properties",
    "jailbust_bonus",
)
AUTO_RANK_EXCHANGE_TOKEN_COUNT = 2

async def _try_grant_rank_xp_pass_micro_tier(
    db,
    user_id: str,
    micro_tier: int,
    free_cash_last_micro_tier_granted: int = 0,
) -> Optional[dict]:
    """Attempt to grant one micro-tier reward set (atomic, cursor-based)."""
    try:
        t = int(micro_tier or 0)
    except Exception:
        return None
    if t <= 0:
        return None

    rewards = vip_rewards_after_free_dedupe(t, free_cash_last_micro_tier_granted)

    inc = {k: int(v) for k, v in rewards.items() if int(v or 0) > 0}
    if not inc:
        inc = {}

    updated = await db.users.update_one(
        {
            "id": user_id,
            "rank_xp_pass_rewards_granted": True,
            "$or": [
                {"rank_xp_pass_last_granted_micro_tier": {"$lt": t}},
                {"rank_xp_pass_last_granted_micro_tier": {"$exists": False}},
            ],
        },
        {
            "$set": {"rank_xp_pass_last_granted_micro_tier": t},
            **({"$inc": inc} if inc else {}),
        },
    )
    if updated.modified_count == 0:
        return None
    return rewards


async def _activate_rank_xp_pass_and_grant_cumulative_micro_tiers(
    db,
    user_id: str,
    tier_snapshot: int,
    free_cash_last_micro_tier_granted: int = 0,
) -> bool:
    """
    Activation grants rewards cumulatively for micro tiers 1..activation_micro.
    Cursor `rank_xp_pass_last_granted_micro_tier` is updated per micro tier.

    Uses max(purchase-time snapshot, live rank_points) so players who buy/activate after
    earning XP still get all tiers they have already reached (snapshot alone can be 0 or stale).
    """
    u0 = await db.users.find_one({"id": user_id}, {"_id": 0, "rank_points": 1})
    rp_live = int((u0 or {}).get("rank_points") or 0)
    snap = int(tier_snapshot or 0)
    effective_rp = max(snap, rp_live)
    activation_micro = micro_tier_from_rank_points(effective_rp)

    # Flip rewards_granted atomically so concurrent activations don't double-grant.
    updated = await db.users.update_one(
        {"id": user_id, "rank_xp_pass_rewards_granted": {"$ne": True}},
        {
            "$set": {
                "rank_xp_pass_rewards_granted": True,
                "rank_xp_pass_tier_snapshot": effective_rp,
                "rank_xp_pass_last_granted_micro_tier": 0,
            },
            "$unset": {"rank_xp_pass_pending_tier_snapshot": ""},
        },
    )
    if updated.modified_count == 0:
        return False

    next_rewards_cache = {}
    for t in range(1, max(0, activation_micro) + 1):
        applied = await _try_grant_rank_xp_pass_micro_tier(
            db,
            user_id=user_id,
            micro_tier=t,
            free_cash_last_micro_tier_granted=free_cash_last_micro_tier_granted,
        )
        if not applied:
            continue

        # Build next-tier reward summary for inbox messages.
        next_t = t + 1 if t < MAX_MICRO_TIER else None
        if next_t is None:
            next_summary = "Max tier reached"
            next_rewards = {}
        else:
            next_rewards = next_rewards_cache.get(next_t)
            if next_rewards is None:
                next_rewards = rewards_for_micro_tier(next_t)
                next_rewards_cache[next_t] = next_rewards
            next_summary = f"Tier {next_t} rewards: {format_rewards_summary(next_rewards)}"

        received_parts = []
        granted_keys = []
        for reward_key in REWARD_KEY_ORDER:
            amount = int(applied.get(reward_key) or 0)
            if amount <= 0:
                continue
            granted_keys.append(reward_key)
            if reward_key == "money":
                received_parts.append(f"${amount:,} cash")
            elif reward_key in ("bullets", "points", "respect_points"):
                received_parts.append(f"{amount:,} {REWARD_KEY_LABELS.get(reward_key, reward_key)}")
            else:
                received_parts.append(f"{amount:,}x {REWARD_KEY_LABELS.get(reward_key, reward_key)}")
        if received_parts:
            blob = "; ".join(received_parts)
            await send_notification(
                user_id,
                "Game Pass reward",
                f"You received {blob}. Next reward: {next_summary}.",
                "reward",
                tier_micro=t,
                next_tier=next_t,
                reward_keys=granted_keys,
            )

    return True

# Shooting range: weapon mastery 0-100%; at 100% = up to MASTERY_MAX_BULLET_REDUCTION_PCT fewer bullets in attack.
MASTERY_MAX_BULLET_REDUCTION_PCT = 10
MASTERY_AUTO_SIM_PCT_PER_CHUNK = 5  # +5% per "Train 5 min" chunk
MASTERY_COOLDOWN_MINUTES = 5  # min time between trains per weapon (auto_sim + 3D live submit)
BRASS_KNUCKLES_WEAPON_ID = "weapon1"  # exclude from shooting range (no bullets)
# Playing the 3D range: grant more mastery per hit than auto_sim (quicker mastery when you play)
MASTERY_PCT_PER_LIVE_HIT = 1  # 1% per hit when playing the 3D game (max 30 hits per submit)
MASTERY_LIVE_HITS_MAX_PER_REQUEST = 30
SHOOTING_RANGE_MAX_PLAYS_PER_HOUR = 10
# Store upgrade: extra plays/hour capped (see store.buy_shooting_range_bonus)
SHOOTING_RANGE_BONUS_STORE_MAX = 10
SHOOTING_RANGE_SESSION_GAME = "shooting_range"
SHOOTING_RANGE_ABS_SCORE_CAP = 99_999_999
SHOOTING_RANGE_SCORE_RATE = 5_000.0
SHOOTING_RANGE_SCORE_BUFFER = 2_000
SHOOTING_RANGE_MAX_SCORING_SECONDS = 300.0


class StateOptionalRequest(BaseModel):
    state: Optional[str] = None


class SetPriceRequest(BaseModel):
    price_per_bullet: int
    state: Optional[str] = None


class SetArmouryItemPricesRequest(BaseModel):
    """Cash list prices (pre-event mult) for money armour L1–3 and money weapons. Points tiers unchanged. Max per field: ARMOURY_ITEM_MONEY_PRICE_MAX."""
    state: Optional[str] = None
    armour_sell_price_money: Optional[Dict[str, Optional[int]]] = None
    weapon_sell_price_money: Optional[Dict[str, Optional[int]]] = None


class SendToUserRequest(BaseModel):
    target_username: str
    state: Optional[str] = None


class SellOnTradeRequest(BaseModel):
    points: int
    state: Optional[str] = None


class BuyBulletsRequest(BaseModel):
    amount: int
    state: Optional[str] = None


class StartArmourProductionRequest(BaseModel):
    level: int  # 1-5
    state: Optional[str] = None


class StartWeaponProductionRequest(BaseModel):
    weapon_id: str
    state: Optional[str] = None


class StateOptionalBody(BaseModel):
    state: Optional[str] = None


class UseTokenRequest(BaseModel):
    token_type: str  # one of TOKEN_TYPES (xp_crimes, xp_gta, melt, oc_reduced, booze, racket, travel, properties, jailbust_bonus)
    use_all: bool = False  # if True, use as many tokens as needed to reach max stack (or until count runs out)


class ExchangeAutoRankRequest(BaseModel):
    count: int = 1  # v1: must be 1 (one Auto Rank token consumed per exchange)


class ShootingRangeTrainRequest(BaseModel):
    weapon_id: str
    mode: str = "auto_sim"  # "auto_sim" | "live" (3D game)
    hits: Optional[int] = None  # for mode=live: number of hits in session (1..MASTERY_LIVE_HITS_MAX_PER_REQUEST)


class ShootingRangeScoreRequest(BaseModel):
    score: int
    session_id: Optional[str] = None


def _normalize_state(state: str) -> str:
    if not state or not (state or "").strip():
        return STATES[0] if STATES else ""
    s = (state or "").strip()
    for st in (STATES or []):
        if st and s.lower() == st.lower():
            return st
    return STATES[0] if STATES else ""


async def get_armoury_for_state(state: str):
    """Get factory for state after ticking armoury production. Used by armour/weapon buy to fulfill from armoury."""
    state = _normalize_state(state)
    if not state:
        return None
    factory = await _get_or_create_factory(state)
    factory = await _tick_armoury_production(state, factory)
    return factory


async def _get_or_create_factory(state: str):
    state = _normalize_state(state)
    if state:
        await maybe_auto_relinquish_below_capo(db.bullet_factory, {"state": state})
    doc = await db.bullet_factory.find_one({"state": state}, {"_id": 0})
    if doc:
        return doc
    # When unowned, production runs from now; price varies $2,500–$4,000
    unowned_price = random.randint(BULLET_FACTORY_UNOWNED_PRICE_MIN, BULLET_FACTORY_UNOWNED_PRICE_MAX)
    now = datetime.now(timezone.utc).isoformat()
    await db.bullet_factory.insert_one({
        "state": state,
        "owner_id": None,
        "owner_username": None,
        "last_collected_at": now,
        "price_per_bullet": None,
        "unowned_price": unowned_price,
    })
    return await db.bullet_factory.find_one({"state": state}, {"_id": 0})


def _parse_utc(s: Optional[str]):
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


async def _tick_armoury_production(state: str, factory: dict) -> dict:
    """Advance armour/weapon stock by elapsed time; update DB. Returns updated factory.
    Supports multi-production: armour_production_hours {level: hours}, weapon_production_hours {weapon_id: hours}.
    Migrates old single-production fields into the new structure on first tick.
    """
    now = datetime.now(timezone.utc)
    updates = {}
    # Migrate old single armour production into armour_production_hours
    if factory.get("armour_producing") and factory.get("armour_production_started_at"):
        level = int(factory.get("armour_production_level") or 1)
        hrs = float(factory.get("armour_production_hours_remaining") or 0)
        if hrs > 0:
            existing = dict(factory.get("armour_production_hours") or {})
            existing[str(level)] = existing.get(str(level), 0) + hrs
            updates["armour_production_hours"] = existing
            updates["armour_production_last_tick"] = factory["armour_production_started_at"]
        updates["armour_producing"] = False
        updates["armour_production_level"] = None
        updates["armour_production_started_at"] = None
        updates["armour_production_hours_remaining"] = None
    # Migrate old single weapon production into weapon_production_hours
    if factory.get("weapon_producing") and factory.get("weapon_production_started_at"):
        wid = factory.get("weapon_production_id") or ""
        if wid:
            hrs = float(factory.get("weapon_production_hours_remaining") or 0)
            if hrs > 0:
                existing = dict(factory.get("weapon_production_hours") or {})
                existing[wid] = existing.get(wid, 0) + hrs
                updates["weapon_production_hours"] = existing
                updates["weapon_production_last_tick"] = factory["weapon_production_started_at"]
        updates["weapon_producing"] = False
        updates["weapon_production_id"] = None
        updates["weapon_production_started_at"] = None
        updates["weapon_production_hours_remaining"] = None
    if updates:
        await db.bullet_factory.update_one({"state": state}, {"$set": updates})
        factory = {**factory, **updates}

    # Tick all armour levels that have hours remaining
    armour_hours = dict(factory.get("armour_production_hours") or {})
    last_armour = _parse_utc(factory.get("armour_production_last_tick")) or now
    elapsed_armour = (now - last_armour).total_seconds() / 3600
    if elapsed_armour > 0 and armour_hours:
        armour_stock = dict(factory.get("armour_stock") or {})
        any_armour_change = False
        for level_key, hours_remaining in list(armour_hours.items()):
            if hours_remaining <= 0:
                continue
            use_hours = min(elapsed_armour, hours_remaining)
            current = armour_stock.get(level_key, 0)
            room = ARMOURY_MAX_STOCK_PER_ITEM - current
            raw_units = int(use_hours * ARMOURY_ARMOUR_RATE_PER_HOUR)
            add_units = min(raw_units, room) if room > 0 else 0
            if add_units > 0:
                armour_stock[level_key] = current + add_units
                any_armour_change = True
            hours_used = add_units / ARMOURY_ARMOUR_RATE_PER_HOUR
            armour_hours[level_key] = max(0, hours_remaining - hours_used)
        armour_hours = {k: v for k, v in armour_hours.items() if v > 0}
        updates["armour_production_hours"] = armour_hours
        updates["armour_production_last_tick"] = now.isoformat()
        if any_armour_change:
            updates["armour_stock"] = armour_stock
        factory = {**factory, **updates}

    # Tick all weapons that have hours remaining
    weapon_hours = dict(factory.get("weapon_production_hours") or {})
    last_weapon = _parse_utc(factory.get("weapon_production_last_tick")) or now
    elapsed_weapon = (now - last_weapon).total_seconds() / 3600
    if elapsed_weapon > 0 and weapon_hours:
        weapon_stock = dict(factory.get("weapon_stock") or {})
        any_weapon_change = False
        for wid, hours_remaining in list(weapon_hours.items()):
            if hours_remaining <= 0:
                continue
            use_hours = min(elapsed_weapon, hours_remaining)
            current = weapon_stock.get(wid, 0)
            room = ARMOURY_MAX_STOCK_PER_ITEM - current
            raw_units = int(use_hours * ARMOURY_WEAPON_RATE_PER_HOUR)
            add_units = min(raw_units, room) if room > 0 else 0
            if add_units > 0:
                weapon_stock[wid] = current + add_units
                any_weapon_change = True
            hours_used = add_units / ARMOURY_WEAPON_RATE_PER_HOUR
            weapon_hours[wid] = max(0, hours_remaining - hours_used)
        weapon_hours = {k: v for k, v in weapon_hours.items() if v > 0}
        updates["weapon_production_hours"] = weapon_hours
        updates["weapon_production_last_tick"] = now.isoformat()
        if any_weapon_change:
            updates["weapon_stock"] = weapon_stock
        factory = {**factory, **updates}

    if updates:
        await db.bullet_factory.update_one({"state": state}, {"$set": updates})
    return factory


def _bullet_cap_24h(factory: dict) -> int:
    return BULLET_FACTORY_TOTAL_PER_24H if factory.get("owner_id") else BULLET_FACTORY_UNOWNED_TOTAL_PER_24H


def _bullet_production_per_hour(factory: dict) -> float:
    return _bullet_cap_24h(factory) / 24


def _accumulated_bullets(factory: dict) -> int:
    last = factory.get("last_collected_at")
    if not last:
        return 0
    last_dt = _parse_utc(last)
    if last_dt is None:
        return 0
    now = datetime.now(timezone.utc)
    hours = (now - last_dt).total_seconds() / 3600
    cap = _bullet_cap_24h(factory)
    rate = cap / 24
    raw = int(hours * rate)
    return min(raw, cap)


async def get_bullet_factory(
    state: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Status for one state (default: user's current state). Bullets + armoury production/stock."""
    state = _normalize_state(state or current_user.get("current_state"))
    cc = await load_claim_costs(db)
    factory = await _get_or_create_factory(state)
    owner_id = factory.get("owner_id")
    if owner_id:
        factory = await _tick_armoury_production(state, factory)
    owner_username = factory.get("owner_username")
    if owner_id and not owner_username:
        user = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1})
        owner_username = user.get("username") if user else "?"
    accumulated = _accumulated_bullets(factory)
    cap_24 = _bullet_cap_24h(factory)
    prod_per_hour = _bullet_production_per_hour(factory)
    buy_max = min(BULLET_FACTORY_BUY_MAX_PER_PURCHASE, cap_24)
    is_owner = str(current_user.get("id") or "") == str(owner_id or "")
    price = factory.get("price_per_bullet")
    unowned_price = factory.get("unowned_price")
    if unowned_price is None:
        unowned_price = random.randint(BULLET_FACTORY_UNOWNED_PRICE_MIN, BULLET_FACTORY_UNOWNED_PRICE_MAX)
    if owner_id:
        can_buy = price is not None and price >= BULLET_FACTORY_PRICE_MIN and not is_owner and accumulated > 0
        effective_price = price
    else:
        can_buy = accumulated > 0
        effective_price = unowned_price
    # Cooldown: when can this user buy again?
    next_buy_available_at = None
    buyer_doc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "last_bullet_factory_bought_at": 1})
    last_bought = (buyer_doc or {}).get("last_bullet_factory_bought_at")
    if last_bought:
        last_dt = _parse_utc(last_bought)
        if last_dt:
            next_ok = last_dt + timedelta(minutes=BULLET_FACTORY_BUY_COOLDOWN_MINUTES)
            if datetime.now(timezone.utc) < next_ok:
                next_buy_available_at = next_ok.isoformat()
    out = {
        "state": state,
        "production_per_hour": prod_per_hour,
        "production_per_24h": cap_24,
        "production_tick_minutes": BULLET_FACTORY_TICK_MINUTES,
        "claim_cost": cc["armoury"],
        "owner_id": owner_id,
        "owner_username": owner_username,
        "accumulated_bullets": accumulated,
        "can_buy": can_buy,
        "price_per_bullet": effective_price,
        "price_min": BULLET_FACTORY_PRICE_MIN,
        "price_max": BULLET_FACTORY_PRICE_MAX,
        "unowned_price_min": BULLET_FACTORY_UNOWNED_PRICE_MIN,
        "unowned_price_max": BULLET_FACTORY_UNOWNED_PRICE_MAX,
        "is_unowned": owner_id is None,
        "last_collected_at": factory.get("last_collected_at"),
        "is_owner": is_owner,
        "buy_max_per_purchase": buy_max,
        "buy_cooldown_minutes": BULLET_FACTORY_BUY_COOLDOWN_MINUTES,
        "next_buy_available_at": next_buy_available_at,
    }
    # Armoury (owner only): multi-production hours + produce-all costs
    if owner_id:
        out["owner_pending_profit"] = int(factory.get("owner_pending_profit") or 0)
        out["owner_pending_profit_points"] = int(factory.get("owner_pending_profit_points") or 0)
        armour_hrs = factory.get("armour_production_hours") or {}
        weapon_hrs = factory.get("weapon_production_hours") or {}
        out["armour_production_hours"] = armour_hrs
        out["weapon_production_hours"] = weapon_hrs
        out["armour_producing"] = bool(factory.get("armour_producing")) or any((armour_hrs.get(k) or 0) > 0 for k in ("1", "2", "3", "4", "5"))
        out["armour_production_level"] = factory.get("armour_production_level")
        out["armour_production_hours_remaining"] = sum(float(v) for v in (armour_hrs or {}).values())
        out["armour_stock"] = factory.get("armour_stock") or {}
        out["armour_rate_per_hour"] = ARMOURY_ARMOUR_RATE_PER_HOUR
        out["armour_max_stock"] = ARMOURY_MAX_STOCK_PER_ITEM
        out["weapon_producing"] = bool(factory.get("weapon_producing")) or any((weapon_hrs or {}).values())
        out["weapon_production_id"] = factory.get("weapon_production_id")
        out["weapon_production_hours_remaining"] = sum(float(v) for v in (weapon_hrs or {}).values())
        out["weapon_stock"] = factory.get("weapon_stock") or {}
        out["weapon_rate_per_hour"] = ARMOURY_WEAPON_RATE_PER_HOUR
        out["weapon_max_stock"] = ARMOURY_MAX_STOCK_PER_ITEM
        # Produce-all costs (1 hr each for every armour level / every weapon)
        out["produce_all_armour_cost_money"] = sum((a.get("cost_money") or 0) for a in ARMOUR_SETS) * ARMOURY_ARMOUR_RATE_PER_HOUR
        out["produce_all_armour_cost_points"] = sum((a.get("cost_points") or 0) for a in ARMOUR_SETS) * ARMOURY_ARMOUR_RATE_PER_HOUR
        weapons_for_cost = await db.weapons.find(
            {},
            {"_id": 0, "id": 1, "name": 1, "damage": 1, "price_money": 1, "price_points": 1, "loot_exclusive": 1},
        ).to_list(200)
        out["produce_all_weapons_cost_money"] = sum((w.get("price_money") or 0) for w in weapons_for_cost) * ARMOURY_WEAPON_RATE_PER_HOUR
        out["produce_all_weapons_cost_points"] = sum((w.get("price_points") or 0) for w in weapons_for_cost) * ARMOURY_WEAPON_RATE_PER_HOUR
        out["armour_produce_tier_costs"] = [
            {
                "level": a["level"],
                "cost_money": int((a.get("cost_money") or 0) * ARMOURY_ARMOUR_RATE_PER_HOUR),
                "cost_points": int((a.get("cost_points") or 0) * ARMOURY_ARMOUR_RATE_PER_HOUR),
            }
            for a in ARMOUR_SETS
        ]
        weapons_produce = [w for w in weapons_for_cost if not w.get("loot_exclusive")]
        weapons_produce.sort(key=lambda w: (int(w.get("damage") or 0), str(w.get("id") or "")))
        out["weapon_produce_costs"] = [
            {
                "id": w["id"],
                "name": w.get("name") or w["id"],
                "cost_money": int((w.get("price_money") or 0) * ARMOURY_WEAPON_RATE_PER_HOUR),
                "cost_points": int((w.get("price_points") or 0) * ARMOURY_WEAPON_RATE_PER_HOUR),
            }
            for w in weapons_produce
        ]
        out["armour_sell_price_money"] = factory.get("armour_sell_price_money") or {}
        out["weapon_sell_price_money"] = factory.get("weapon_sell_price_money") or {}
        out["armour_money_price_defaults"] = [
            {"level": a["level"], "name": a["name"], "default_list_money": int(a["cost_money"] * ARMOUR_WEAPON_MARGIN)}
            for a in ARMOUR_SETS if a.get("cost_money") is not None
        ]
        out["weapon_money_price_defaults"] = [
            {"id": w["id"], "name": w.get("name") or w["id"], "default_list_money": int(w["price_money"] * ARMOUR_WEAPON_MARGIN)}
            for w in weapons_produce
            if w.get("price_money") is not None
        ]
        out["armoury_item_money_price_max"] = ARMOURY_ITEM_MONEY_PRICE_MAX
    return out


async def get_bullet_factory_list(current_user: dict = Depends(get_current_user)):
    """List all states' bullet factories (for overview tables)."""
    result = []
    for state in STATES:
        factory = await _get_or_create_factory(state)
        owner_id = factory.get("owner_id")
        if owner_id:
            u = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1})
            owner_username = factory.get("owner_username") or (u.get("username") if u else "?")
        else:
            owner_username = None
        accumulated = _accumulated_bullets(factory)
        price = factory.get("price_per_bullet") if owner_id else factory.get("unowned_price")
        result.append({
            "state": state,
            "owner_id": owner_id,
            "owner_username": owner_username or "Unclaimed",
            "accumulated_bullets": accumulated,
            "price_per_bullet": price,
        })
    return {"factories": result}


async def _user_owns_any_property(user_id: str):
    """Check if user owns any property (airport or armoury). Max 1 per player. Armoury = bullet factory + armour + weapons (single ownership)."""
    doc = await db.airport_ownership.find_one({"owner_id": user_id}, {"_id": 0, "state": 1})
    if doc:
        return {"type": "airport", "state": doc.get("state")}
    doc = await db.bullet_factory.find_one({"owner_id": user_id}, {"_id": 0, "state": 1})
    if doc:
        return {"type": "bullet_factory", "state": doc.get("state")}
    return None


async def claim_bullet_factory(
    body: StateOptionalRequest = Body(default=StateOptionalRequest()),
    current_user: dict = Depends(get_current_user),
):
    """Pay to become the armoury owner in this state (bullets + armour + weapons). Max 1 property per player. Requires Capo or higher (or prestiged)."""
    rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
    prestige_level = int(current_user.get("prestige_level") or 0)
    if rank_id < CAPO_RANK_ID and prestige_level < 1:
        raise HTTPException(status_code=403, detail="You must be rank Capo or higher to claim the armoury. Reach Capo to hold one.")
    owned_prop = await _user_owns_any_property(current_user["id"])
    if owned_prop:
        raise HTTPException(status_code=400, detail="You may only own 1 property (airport or armoury). Relinquish it first (My Properties or States).")
    state = _normalize_state(body.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id"):
        raise HTTPException(status_code=400, detail="The armoury in this state already has an owner")
    cc = await load_claim_costs(db)
    claim_cost = cc["armoury"]
    now = datetime.now(timezone.utc).isoformat()
    result = await db.users.update_one(
        {"id": current_user["id"], "money": {"$gte": claim_cost}},
        {"$inc": {"money": -claim_cost}},
    )
    if result.modified_count == 0:
        raise HTTPException(
            status_code=400,
            detail=f"You need ${claim_cost:,} to claim the armoury",
        )
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {"owner_id": current_user["id"], "owner_username": current_user.get("username"), "last_collected_at": now}},
    )
    return {
        "message": f"You now own the armoury in {state} (bullets, armour & weapons). It produces up to 5,000 bullets per day.",
        "state": state,
        "owner_id": current_user["id"],
    }


async def collect_bullet_factory(
    body: StateOptionalRequest = Body(default=StateOptionalRequest()),
    current_user: dict = Depends(get_current_user),
):
    """Collect accumulated profit from bullet/armour/weapon sales into your cash and points."""
    state = _normalize_state(body.state or current_user.get("current_state"))
    # Atomically zero pending profit and return pre-update values to prevent double-collect
    old = await db.bullet_factory.find_one_and_update(
        {
            "state": state,
            "owner_id": current_user["id"],
            "$or": [{"owner_pending_profit": {"$gt": 0}}, {"owner_pending_profit_points": {"$gt": 0}}],
        },
        {"$set": {"owner_pending_profit": 0, "owner_pending_profit_points": 0}},
        projection={"_id": 0, "owner_pending_profit": 1, "owner_pending_profit_points": 1},
        return_document=False,
    )
    if not old:
        factory = await db.bullet_factory.find_one({"state": state}, {"_id": 0, "owner_id": 1})
        if not factory or factory.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
        return {
            "message": "No profit to collect. Sales are added here when players buy bullets, armour, or weapons from your armoury.",
            "state": state,
            "collected_money": 0,
            "collected_points": 0,
        }
    pending_money = int(old.get("owner_pending_profit") or 0)
    pending_points = int(old.get("owner_pending_profit_points") or 0)
    if pending_money > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": pending_money}})
    if pending_points > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": pending_points}})
        await log_points_event(db, user_id=current_user["id"], points=pending_points, event_type="armoury_claim_profit",
                               event_ref=f"state:{state}", meta={"state": state})
    return {
        "message": f"Collected ${pending_money:,} and {pending_points:,} points from armoury sales.",
        "state": state,
        "collected_money": pending_money,
        "collected_points": pending_points,
    }


async def start_armour_production(
    request: StartArmourProductionRequest,
    current_user: dict = Depends(get_current_user),
):
    """Owner pays for 1 hour of armour production; stock accumulates at ARMOURY_ARMOUR_RATE_PER_HOUR."""
    state = _normalize_state(request.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    level = int(request.level or 0)
    if level < 1 or level > 5:
        raise HTTPException(status_code=400, detail="Armour level must be 1–5")
    armour = next((a for a in ARMOUR_SETS if a["level"] == level), None)
    if not armour:
        raise HTTPException(status_code=404, detail="Armour level not found")
    # Cost for 1 hour = production cost per unit × rate per hour
    cost_money = armour.get("cost_money")
    cost_points = armour.get("cost_points")
    if cost_money is not None:
        pay = cost_money * ARMOURY_ARMOUR_RATE_PER_HOUR
        result = await db.users.update_one({"id": current_user["id"], "money": {"$gte": pay}}, {"$inc": {"money": -pay}})
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail=f"Insufficient cash. Need ${pay:,} for 1 hour of production.")
    elif cost_points is not None:
        pay = cost_points * ARMOURY_ARMOUR_RATE_PER_HOUR
        result = await db.users.update_one({"id": current_user["id"], "points": {"$gte": pay}}, {"$inc": {"points": -pay}})
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail=f"Insufficient points. Need {pay} for 1 hour of production.")
        await log_points_event(db, user_id=current_user["id"], points=-pay, event_type="armoury_produce_armour", meta={"level": level})
    else:
        raise HTTPException(status_code=400, detail="Armour level has no production cost")
    armour_hours = dict(factory.get("armour_production_hours") or {})
    key = str(level)
    current_hrs = float(armour_hours.get(key) or 0)
    if current_hrs > 0.01:
        raise HTTPException(status_code=400, detail="Cannot stack production. Wait for this level to finish, then produce again (1 hour at a time).")
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    armour_hours[key] = (armour_hours.get(key) or 0) + 1.0
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {
            "armour_production_hours": armour_hours,
            "armour_production_last_tick": now_iso,
        }},
    )
    return {
        "message": f"Started armour (level {level}) production. {ARMOURY_ARMOUR_RATE_PER_HOUR}/hour for 1 hour.",
        "state": state,
        "armour_production_level": level,
        "armour_production_hours_remaining": armour_hours.get(key, 0),
    }


async def start_weapon_production(
    request: StartWeaponProductionRequest,
    current_user: dict = Depends(get_current_user),
):
    """Owner pays for 1 hour of weapon production; stock accumulates at ARMOURY_WEAPON_RATE_PER_HOUR."""
    state = _normalize_state(request.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    weapon_id = (request.weapon_id or "").strip()
    if not weapon_id:
        raise HTTPException(status_code=400, detail="weapon_id required")
    weapon = await db.weapons.find_one({"id": weapon_id}, {"_id": 0, "price_money": 1, "price_points": 1, "name": 1, "loot_exclusive": 1})
    if not weapon:
        raise HTTPException(status_code=404, detail="Weapon not found")
    if weapon.get("loot_exclusive"):
        raise HTTPException(status_code=400, detail="Loot-exclusive weapons cannot be produced at the armoury")
    pm = weapon.get("price_money")
    pp = weapon.get("price_points")
    if pm is not None:
        pay = pm * ARMOURY_WEAPON_RATE_PER_HOUR
        result = await db.users.update_one({"id": current_user["id"], "money": {"$gte": pay}}, {"$inc": {"money": -pay}})
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail=f"Insufficient cash. Need ${pay:,} for 1 hour of production.")
    elif pp is not None:
        pay = pp * ARMOURY_WEAPON_RATE_PER_HOUR
        result = await db.users.update_one({"id": current_user["id"], "points": {"$gte": pay}}, {"$inc": {"points": -pay}})
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail=f"Insufficient points. Need {pay} for 1 hour of production.")
        await log_points_event(db, user_id=current_user["id"], points=-pay, event_type="armoury_produce_weapon", meta={"weapon_id": weapon_id})
    else:
        raise HTTPException(status_code=400, detail="Weapon has no production cost")
    weapon_hours = dict(factory.get("weapon_production_hours") or {})
    current_hrs = float(weapon_hours.get(weapon_id) or 0)
    if current_hrs > 0.01:
        raise HTTPException(status_code=400, detail="Cannot stack production. Wait for this weapon to finish, then produce again (1 hour at a time).")
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    weapon_hours[weapon_id] = (weapon_hours.get(weapon_id) or 0) + 1.0
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {
            "weapon_production_hours": weapon_hours,
            "weapon_production_last_tick": now_iso,
        }},
    )
    return {
        "message": f"Started {weapon.get('name', weapon_id)} production. {ARMOURY_WEAPON_RATE_PER_HOUR}/hour for 1 hour.",
        "state": state,
        "weapon_production_id": weapon_id,
        "weapon_production_hours_remaining": weapon_hours.get(weapon_id, 0),
    }


async def start_armour_production_all(
    request: Optional[StateOptionalBody] = Body(None),
    current_user: dict = Depends(get_current_user),
):
    """Owner pays for 1 hour of armour production for all levels that have no production queued (no stacking — only add when finished)."""
    state = _normalize_state((request.state if request else None) or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    armour_hours = dict(factory.get("armour_production_hours") or {})
    levels_to_add = [a for a in ARMOUR_SETS if float(armour_hours.get(str(a["level"])) or 0) <= 0.01]
    if not levels_to_add:
        raise HTTPException(status_code=400, detail="Cannot stack. All armour levels are still producing. Wait for them to finish, then use Produce all again (1 hr each).")
    total_money = sum((a.get("cost_money") or 0) for a in levels_to_add) * ARMOURY_ARMOUR_RATE_PER_HOUR
    total_points = sum((a.get("cost_points") or 0) for a in levels_to_add) * ARMOURY_ARMOUR_RATE_PER_HOUR
    filter_fields = {"id": current_user["id"]}
    inc_fields = {}
    if total_money > 0:
        filter_fields["money"] = {"$gte": total_money}
        inc_fields["money"] = -total_money
    if total_points > 0:
        filter_fields["points"] = {"$gte": total_points}
        inc_fields["points"] = -total_points
    if inc_fields:
        result = await db.users.update_one(filter_fields, {"$inc": inc_fields})
        if result.modified_count == 0:
            fresh = await db.users.find_one({"id": current_user["id"]}, {"money": 1, "points": 1})
            if total_money > 0 and (fresh.get("money") or 0) < total_money:
                raise HTTPException(status_code=400, detail=f"Insufficient cash. Need ${total_money:,} for 1 hr on {len(levels_to_add)} level(s).")
            raise HTTPException(status_code=400, detail=f"Insufficient points. Need {total_points} pts for 1 hr on {len(levels_to_add)} level(s).")
        if total_points > 0:
            await log_points_event(db, user_id=current_user["id"], points=-total_points, event_type="armoury_bulk_produce_armour")
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    for a in levels_to_add:
        key = str(a["level"])
        armour_hours[key] = (armour_hours.get(key) or 0) + 1.0
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {"armour_production_hours": armour_hours, "armour_production_last_tick": now_iso}},
    )
    return {
        "message": f"Started armour production (1 hr each for {len(levels_to_add)} level(s)). {ARMOURY_ARMOUR_RATE_PER_HOUR}/hr per level.",
        "state": state,
        "produce_all_armour_cost_money": total_money,
        "produce_all_armour_cost_points": total_points,
    }


async def start_weapon_production_all(
    request: Optional[StateOptionalBody] = Body(None),
    current_user: dict = Depends(get_current_user),
):
    """Owner pays for 1 hour of weapon production for all weapons that have no production queued (no stacking — only add when finished)."""
    state = _normalize_state((request.state if request else None) or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    weapons = await db.weapons.find({}, {"_id": 0, "id": 1, "price_money": 1, "price_points": 1, "loot_exclusive": 1}).to_list(200)
    weapon_hours = dict(factory.get("weapon_production_hours") or {})
    weapons_to_add = [w for w in weapons if w.get("id") and not w.get("loot_exclusive") and float(weapon_hours.get(w["id"]) or 0) <= 0.01]
    if not weapons_to_add:
        raise HTTPException(status_code=400, detail="Cannot stack. All weapons are still producing. Wait for them to finish, then use Produce all again (1 hr each).")
    total_money = sum((w.get("price_money") or 0) for w in weapons_to_add) * ARMOURY_WEAPON_RATE_PER_HOUR
    total_points = sum((w.get("price_points") or 0) for w in weapons_to_add) * ARMOURY_WEAPON_RATE_PER_HOUR
    filter_fields = {"id": current_user["id"]}
    inc_fields = {}
    if total_money > 0:
        filter_fields["money"] = {"$gte": total_money}
        inc_fields["money"] = -total_money
    if total_points > 0:
        filter_fields["points"] = {"$gte": total_points}
        inc_fields["points"] = -total_points
    if inc_fields:
        result = await db.users.update_one(filter_fields, {"$inc": inc_fields})
        if result.modified_count == 0:
            fresh = await db.users.find_one({"id": current_user["id"]}, {"money": 1, "points": 1})
            if total_money > 0 and (fresh.get("money") or 0) < total_money:
                raise HTTPException(status_code=400, detail=f"Insufficient cash. Need ${total_money:,} for 1 hr on {len(weapons_to_add)} weapon(s).")
            raise HTTPException(status_code=400, detail=f"Insufficient points. Need {total_points} pts for 1 hr on {len(weapons_to_add)} weapon(s).")
        if total_points > 0:
            await log_points_event(db, user_id=current_user["id"], points=-total_points, event_type="armoury_bulk_produce_weapon")
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    for w in weapons_to_add:
        wid = w["id"]
        weapon_hours[wid] = (weapon_hours.get(wid) or 0) + 1.0
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {"weapon_production_hours": weapon_hours, "weapon_production_last_tick": now_iso}},
    )
    return {
        "message": f"Started weapon production (1 hr each for {len(weapons_to_add)} weapon(s)). {ARMOURY_WEAPON_RATE_PER_HOUR}/hr per weapon.",
        "state": state,
        "produce_all_weapons_cost_money": total_money,
        "produce_all_weapons_cost_points": total_points,
    }


async def set_price(
    request: SetPriceRequest,
    current_user: dict = Depends(get_current_user),
):
    """Owner sets the price per bullet in this state."""
    state = _normalize_state(request.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the bullet factory in this state")
    price = request.price_per_bullet
    if price < BULLET_FACTORY_PRICE_MIN or price > BULLET_FACTORY_PRICE_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"Price must be between ${BULLET_FACTORY_PRICE_MIN} and ${BULLET_FACTORY_PRICE_MAX:,} per bullet",
        )
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {"price_per_bullet": price}},
    )
    return {"message": f"Price set to ${price:,} per bullet", "price_per_bullet": price, "state": state}


async def set_armoury_item_prices(
    request: SetArmouryItemPricesRequest,
    current_user: dict = Depends(get_current_user),
):
    """Owner sets cash list price (before event multiplier) per money armour tier and per money weapon. Points armour/weapons use fixed formula."""
    state = _normalize_state(request.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    weapons = await db.weapons.find(
        {},
        {"_id": 0, "id": 1, "price_money": 1, "price_points": 1, "loot_exclusive": 1},
    ).to_list(200)
    money_weapon_ids = {
        w["id"] for w in weapons
        if w.get("price_money") is not None and not w.get("loot_exclusive")
    }
    set_doc: dict = {}
    if request.armour_sell_price_money is not None:
        cur = dict(factory.get("armour_sell_price_money") or {})
        for k, v in request.armour_sell_price_money.items():
            try:
                lv = int(k)
            except (TypeError, ValueError):
                continue
            if lv not in (1, 2, 3):
                continue
            arm = next((a for a in ARMOUR_SETS if a["level"] == lv), None)
            if not arm or arm.get("cost_money") is None:
                continue
            if v is None:
                cur.pop(str(lv), None)
            else:
                cur[str(lv)] = _clamp_armoury_money_list_price(int(v))
        set_doc["armour_sell_price_money"] = cur
    if request.weapon_sell_price_money is not None:
        cur = dict(factory.get("weapon_sell_price_money") or {})
        for wid, v in request.weapon_sell_price_money.items():
            if wid not in money_weapon_ids:
                continue
            if v is None:
                cur.pop(wid, None)
            else:
                cur[wid] = _clamp_armoury_money_list_price(int(v))
        set_doc["weapon_sell_price_money"] = cur
    if not set_doc:
        raise HTTPException(status_code=400, detail="No price updates provided")
    await db.bullet_factory.update_one({"state": state}, {"$set": set_doc})
    return {"message": "Item prices updated", "state": state, **set_doc}


async def relinquish_bullet_factory(
    body: StateOptionalRequest = Body(default=StateOptionalRequest()),
    current_user: dict = Depends(get_current_user),
):
    """Relinquish ownership of the armoury in this state. It becomes unclaimed."""
    state = _normalize_state(body.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    await db.bullet_factory.update_one(
        {"state": state},
        {
            "$set": {"owner_id": None, "owner_username": None},
            "$unset": {"armour_sell_price_money": "", "weapon_sell_price_money": ""},
        },
    )
    return {"message": f"Armoury in {state} relinquished. It is now unclaimed.", "state": state}


async def bullet_factory_send_to_user(
    request: SendToUserRequest,
    current_user: dict = Depends(get_current_user),
):
    """Transfer armoury ownership to another user."""
    from server import _user_owns_any_property
    target_username = (request.target_username or "").strip()
    if not target_username:
        raise HTTPException(status_code=400, detail="Enter a username")
    state = _normalize_state(request.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    if factory.get("owner_id") != current_user["id"]:
        owned = await db.bullet_factory.find_one({"owner_id": current_user["id"]}, {"_id": 0, "state": 1})
        if not owned:
            raise HTTPException(status_code=403, detail="You do not own an armoury")
        state = _normalize_state(owned["state"])
        factory = await _get_or_create_factory(state)
        if factory.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    target_pattern = _username_pattern(target_username)
    target = await db.users.find_one({"username": target_pattern}, {"_id": 0, "id": 1, "username": 1, "rank_points": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot transfer to yourself")
    owned_prop = await _user_owns_any_property(target["id"])
    if owned_prop:
        raise HTTPException(status_code=400, detail="That user already owns a property (airport or armoury)")
    transfer_set = {"owner_id": target["id"], "owner_username": target.get("username", target_username), "total_earnings": 0}
    if get_rank_info(target.get("rank_points", 0))[0] < CAPO_RANK_ID:
        transfer_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
    await db.bullet_factory.update_one({"state": state}, {"$set": transfer_set})
    await log_activity(
        current_user["id"],
        current_user.get("username", "?"),
        "armoury_transfer",
        {"state": state, "to_user": target.get("username", target_username), "to_user_id": target["id"]},
    )
    return {"message": f"Armoury in {state} transferred to {target.get('username', target_username)}.", "state": state}


async def bullet_factory_sell_on_trade(
    request: SellOnTradeRequest,
    current_user: dict = Depends(get_current_user),
):
    """List the armoury on Quick Trade for points. Relinquishes ownership when listed (buyer gets it)."""
    if request.points < 0:
        raise HTTPException(status_code=400, detail="Points must be non-negative")
    state = _normalize_state(request.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    # Fallback: if UI/current_state is out of sync, resolve the actual owned armoury state.
    if factory.get("owner_id") != current_user["id"]:
        owned_factory = await db.bullet_factory.find_one({"owner_id": current_user["id"]}, {"_id": 0, "state": 1})
        owned_state = _normalize_state((owned_factory or {}).get("state"))
        if not owned_state:
            raise HTTPException(status_code=403, detail="You do not own an armoury")
        state = owned_state
        factory = await _get_or_create_factory(state)
        if factory.get("owner_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="You do not own the armoury in this state")
    # Check no existing listing for this state
    existing = await db.properties.find_one({"type": "bullet_factory", "state": state, "for_sale": True})
    if existing:
        raise HTTPException(status_code=400, detail="This armoury is already listed on Quick Trade. Cancel the listing first.")
    listing_id = ObjectId()
    listing = {
        "_id": listing_id,
        "id": str(listing_id),
        "type": "bullet_factory",
        "state": state,
        "location": state,
        "name": f"Armoury ({state})",
        "owner_id": current_user["id"],
        "owner_username": current_user.get("username", "Unknown"),
        "for_sale": True,
        "sale_price": request.points,
        "created_at": datetime.now(timezone.utc),
    }
    await db.properties.insert_one(listing)
    try:
        from routers.money.quicktrade import _invalidate_trade_caches
        _invalidate_trade_caches()
    except Exception:
        pass
    return {"message": f"Armoury ({state}) listed for {request.points:,} points on Quick Trade", "state": state}


async def buy_bullets(
    request: BuyBulletsRequest,
    current_user: dict = Depends(get_current_user),
):
    """Buy bullets from the factory in this state. When unowned, pay system price ($2,500–$4,000). When owned, pay owner's price. Max 3000 per purchase, once every 15 minutes."""
    state = _normalize_state(request.state or current_user.get("current_state"))
    factory = await _get_or_create_factory(state)
    owner_id = factory.get("owner_id")
    amount = request.amount
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if amount > BULLET_FACTORY_BUY_MAX_PER_PURCHASE:
        raise HTTPException(
            status_code=400,
            detail=f"You can only buy up to {BULLET_FACTORY_BUY_MAX_PER_PURCHASE:,} bullets at once from the factory",
        )
    accumulated = _accumulated_bullets(factory)
    if amount > accumulated:
        raise HTTPException(
            status_code=400,
            detail=f"Factory only has {accumulated:,} bullets available",
        )
    if owner_id:
        if owner_id == current_user["id"]:
            raise HTTPException(status_code=400, detail="You own this factory; bullets are sold to other players from stock.")
        price = factory.get("price_per_bullet")
        if price is None or price < BULLET_FACTORY_PRICE_MIN:
            raise HTTPException(status_code=400, detail="Owner has not set a price yet")
    else:
        price = factory.get("unowned_price") or random.randint(BULLET_FACTORY_UNOWNED_PRICE_MIN, BULLET_FACTORY_UNOWNED_PRICE_MAX)
    total_cost = amount * price
    now_iso = datetime.now(timezone.utc).isoformat()
    cooldown_threshold = (datetime.now(timezone.utc) - timedelta(minutes=BULLET_FACTORY_BUY_COOLDOWN_MINUTES)).isoformat()
    result = await db.users.update_one(
        {"id": current_user["id"], "money": {"$gte": total_cost},
         "$or": [
             {"last_bullet_factory_bought_at": {"$exists": False}},
             {"last_bullet_factory_bought_at": None},
             {"last_bullet_factory_bought_at": {"$lte": cooldown_threshold}},
         ]},
        {"$inc": {"money": -total_cost, "bullets": amount, "bullets_purchased_from_armoury": amount}, "$set": {"last_bullet_factory_bought_at": now_iso}},
    )
    if result.modified_count == 0:
        user_doc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "last_bullet_factory_bought_at": 1, "money": 1})
        last_bought = (user_doc or {}).get("last_bullet_factory_bought_at")
        if last_bought and last_bought > cooldown_threshold:
            last_dt = _parse_utc(last_bought)
            elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds() if last_dt else 0
            wait_mins = max(1, int((BULLET_FACTORY_BUY_COOLDOWN_MINUTES * 60 - elapsed) / 60) + 1)
            raise HTTPException(
                status_code=400,
                detail=f"You can only buy bullets from the factory once every {BULLET_FACTORY_BUY_COOLDOWN_MINUTES} minutes. Try again in {wait_mins} min.",
            )
        raise HTTPException(
            status_code=400,
            detail=f"You need ${total_cost:,} (${price:,} × {amount:,})",
        )
    last = _parse_utc(factory.get("last_collected_at"))
    if last is None:
        last = datetime.now(timezone.utc)
    prod_h = _bullet_production_per_hour(factory)
    hours_consumed = amount / prod_h if prod_h > 0 else 0
    new_last = last + timedelta(seconds=hours_consumed * 3600)
    await db.bullet_factory.update_one(
        {"state": state},
        {"$set": {"last_collected_at": new_last.isoformat()}},
    )
    if owner_id:
        await db.bullet_factory.update_one(
            {"state": state},
            {"$inc": {"owner_pending_profit": total_cost}},
        )
    await log_activity(current_user["id"], current_user.get("username", "?"), "armoury_buy_bullets", {"amount": amount, "cost": total_cost, "state": state})
    return {
        "message": f"Bought {amount:,} bullets for ${total_cost:,}",
        "amount": amount,
        "total_paid": total_cost,
        "new_bullets": (current_user.get("bullets") or 0) + amount,
        "state": state,
    }


CUSTOM_BULLETS_MAX = 250_000

def _calculate_bullet_cost(bullets: int) -> int:
    """Calculate cost for any bullet amount (matches frontend formula)."""
    if bullets < 5000:
        return max(1, int(bullets * 0.02))
    return 100 + ((bullets - 5000) * 75 + 4999) // 5000

async def store_buy_bullets(bullets: int, current_user: dict = Depends(get_current_user)):
    """Buy bullets from store: respect first at ceil(6.75 respect per point of price) via store._store_cost_inc, then points."""
    if bullets < 1 or bullets > CUSTOM_BULLETS_MAX:
        raise HTTPException(status_code=400, detail=f"Bullet amount must be between 1 and {CUSTOM_BULLETS_MAX:,}")
    cost = _calculate_bullet_cost(bullets)
    cost_used, inc, gte = _store_cost_inc(current_user, cost)
    if cost_used is None:
        raise HTTPException(status_code=400, detail="Insufficient points")
    inc["bullets"] = bullets
    gte_filter = {"id": current_user["id"]}
    gte_filter.update(gte)
    result = await db.users.update_one(gte_filter, {"$inc": inc})
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    return {"message": f"Bought {bullets:,} bullets for {cost_used} points", "bullets": bullets, "cost": cost_used}


async def admin_add_bullets(target_username: str, bullets: int, current_user: dict = Depends(get_current_user)):
    """Admin: add bullets to a user."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    if bullets <= 0:
        raise HTTPException(status_code=400, detail="Bullets must be greater than 0")
    username_pattern = _username_pattern(target_username)
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one(
        {"id": target["id"]},
        {"$inc": {"bullets": int(bullets)}}
    )
    return {"message": f"Added {int(bullets):,} bullets to {target_username}"}


# --- Armour ---

class ArmourBuyRequest(BaseModel):
    level: int  # 1-5
    state: Optional[str] = None  # armoury state to use for stock (must match the state whose stock is shown)


async def get_armour_options(request: Request, current_user: dict = Depends(get_current_user)):
    """List available armour sets. cost_* = production cost; effective_* = sell price (production * 1.35 * event). armoury_stock = produced stock in state's armoury. Optional ?state= for armoury stock (e.g. match bullet factory state)."""
    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    equipped_level = int(current_user.get("armour_level", 0) or 0)
    owned_max = int(current_user.get("armour_owned_level_max", equipped_level) or 0)
    money = float(current_user.get("money", 0) or 0)
    points = int(current_user.get("points", 0) or 0)
    state_param = (request.query_params.get("state") or "").strip()
    state = state_param or (current_user.get("current_state") or "").strip()
    factory = await get_armoury_for_state(state) if state else None
    armour_stock = (factory.get("armour_stock") or {}) if factory else {}
    factory_owner_id = factory.get("owner_id") if factory else None
    is_unowned_armoury = bool(factory and not factory_owner_id)
    rows = []
    for s in ARMOUR_SETS:
        cost_money = s.get("cost_money")
        cost_points = s.get("cost_points")
        if cost_money is not None:
            effective_money = _effective_armour_money_sell(s, factory, mult)
            effective_points = None
        else:
            effective_money = None
            effective_points = _effective_armour_points_sell(s, mult)
        affordable = True
        # Must buy tiers in order: can only buy level L if you already own level L-1
        if s["level"] > 1 and owned_max < s["level"] - 1:
            affordable = False
        if cost_money is not None and money < effective_money:
            affordable = False
        if cost_points is not None and points < effective_points:
            affordable = False
        unowned_restricted = is_unowned_armoury and s["level"] > 1
        if unowned_restricted:
            affordable = False
        level_key = str(s["level"])
        rows.append({
            "level": s["level"],
            "name": s["name"],
            "description": s["description"],
            "cost_money": cost_money,
            "cost_points": cost_points,
            "effective_cost_money": effective_money,
            "effective_cost_points": effective_points,
            "owned": owned_max >= s["level"],
            "equipped": equipped_level == s["level"],
            "affordable": affordable,
            "armoury_stock": int(armour_stock.get(level_key, 0) or 0),
            "unowned_restricted": unowned_restricted,
        })
    # Loot-exclusive armour (level 6) — always shown: owned → equip; not owned → grayed "Loot exclusive"
    from routers.money.loot_box import ARMOUR_LEVEL_6_NAME
    rows.append({
        "level": 6,
        "name": ARMOUR_LEVEL_6_NAME,
        "description": "Loot-exclusive steel plate vest — not sold anywhere.",
        "cost_money": None,
        "cost_points": None,
        "effective_cost_money": None,
        "effective_cost_points": None,
        "owned": owned_max >= 6,
        "equipped": equipped_level == 6,
        "affordable": False,
        "armoury_stock": 0,
        "loot_exclusive": True,
        "unowned_restricted": False,
    })
    return {
        "current_level": equipped_level,
        "owned_max": owned_max,
        "options": rows,
        "unowned_armoury": is_unowned_armoury,
    }


async def buy_armour(request: ArmourBuyRequest, current_user: dict = Depends(get_current_user)):
    level = int(request.level or 0)
    if level < 1 or level > 5:
        raise HTTPException(status_code=400, detail="Invalid armour level")
    equipped_level = int(current_user.get("armour_level", 0) or 0)
    owned_max = int(current_user.get("armour_owned_level_max", equipped_level) or 0)
    if level <= owned_max:
        raise HTTPException(status_code=400, detail="You already own this armour tier")
    # Must buy in order: can only buy level L if you already own level L-1
    if level > 1 and owned_max < level - 1:
        prev_name = next((a["name"] for a in ARMOUR_SETS if a["level"] == level - 1), f"Level {level - 1}")
        raise HTTPException(
            status_code=400,
            detail=f"You must buy armour tiers in order. Purchase {prev_name} (Lv.{level - 1}) first.",
        )
    armour = next((a for a in ARMOUR_SETS if a["level"] == level), None)
    if not armour:
        raise HTTPException(status_code=404, detail="Armour not found")
    state = (request.state or current_user.get("current_state") or "").strip()
    factory = await get_armoury_for_state(state) if state else None
    owner_id = factory.get("owner_id") if factory else None
    if factory and not owner_id and level != 1:
        raise HTTPException(
            status_code=400,
            detail="Unclaimed armoury only sells basic armour (level 1). Claim an armoury for higher tiers.",
        )
    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    if armour.get("cost_money") is not None:
        price = _effective_armour_money_sell(armour, factory, mult)
    else:
        price = _effective_armour_points_sell(armour, mult)
    currency_field = "money" if armour.get("cost_money") is not None else "points"
    insufficient_msg = "Insufficient cash" if currency_field == "money" else "Insufficient points"

    # Fulfill from armoury in same state if stock available (stock always decrements; owner gets 35% margin when buyer is not owner)
    state_key = factory.get("state") or _normalize_state(state) if factory else None
    if factory and state_key:
        if owner_id and owner_id != current_user["id"]:
            pay_result = await db.users.update_one(
                {"id": current_user["id"], currency_field: {"$gte": price}},
                {"$inc": {currency_field: -price}, "$set": {"armour_level": level, "armour_owned_level_max": max(owned_max, level)}},
            )
            if pay_result.modified_count == 0:
                raise HTTPException(status_code=400, detail=insufficient_msg)
            stock_result = await db.bullet_factory.update_one(
                {"state": state_key, f"armour_stock.{level}": {"$gt": 0}},
                {"$inc": {f"armour_stock.{level}": -1}},
            )
            if stock_result.modified_count == 1:
                if currency_field == "money":
                    await db.bullet_factory.update_one({"state": state_key}, {"$inc": {"owner_pending_profit": price}})
                else:
                    await db.bullet_factory.update_one({"state": state_key}, {"$inc": {"owner_pending_profit_points": price}})
                await log_activity(current_user["id"], current_user.get("username", "?"), "armoury_buy_armour", {"item": armour["name"], "level": level, "cost": price, "source": "armoury"})
                return {"message": f"Purchased {armour['name']} (Armour Lv.{level}) from armoury", "new_level": level}
            else:
                await db.users.update_one(
                    {"id": current_user["id"]},
                    {"$inc": {currency_field: price}},
                )
        else:
            stock_result = await db.bullet_factory.update_one(
                {"state": state_key, f"armour_stock.{level}": {"$gt": 0}},
                {"$inc": {f"armour_stock.{level}": -1}},
            )
            if stock_result.modified_count == 1:
                await db.users.update_one(
                    {"id": current_user["id"]},
                    {"$set": {"armour_level": level, "armour_owned_level_max": max(owned_max, level)}},
                )
                await log_activity(current_user["id"], current_user.get("username", "?"), "armoury_buy_armour", {"item": armour["name"], "level": level, "cost": price, "source": "armoury"})
                return {"message": f"Purchased {armour['name']} (Armour Lv.{level}) from armoury", "new_level": level}

    updates = {"$set": {"armour_level": level, "armour_owned_level_max": max(owned_max, level)}}
    updates["$inc"] = {currency_field: -price}
    result = await db.users.update_one({"id": current_user["id"], currency_field: {"$gte": price}}, updates)
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail=insufficient_msg)
    await log_activity(current_user["id"], current_user.get("username", "?"), "armoury_buy_armour", {"item": armour["name"], "level": level, "cost": price})
    return {"message": f"Purchased {armour['name']} (Armour Lv.{level})", "new_level": level}


async def equip_armour(request: ArmourBuyRequest, current_user: dict = Depends(get_current_user)):
    level = int(request.level or 0)
    owned_max = int(current_user.get("armour_owned_level_max", current_user.get("armour_level", 0) or 0) or 0)
    max_level = 6 if owned_max >= 6 else 5
    if level < 0 or level > max_level:
        raise HTTPException(status_code=400, detail="Invalid armour level")
    if level != 0 and level > owned_max:
        raise HTTPException(status_code=400, detail="You do not own this armour tier")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"armour_level": level}}
    )
    return {"message": "Armour equipped" if level else "Armour unequipped", "equipped_level": level}


async def unequip_armour(current_user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"armour_level": 0}}
    )
    return {"message": "Armour unequipped", "equipped_level": 0}


async def sell_armour(current_user: dict = Depends(get_current_user)):
    """Sell your highest owned armour tier for 50% of what you paid (sell price)."""
    owned_max = int(current_user.get("armour_owned_level_max", 0) or 0)
    if owned_max == 6:  # loot-exclusive Steel Plate Vest
        family_id = current_user.get("family_id")
        if family_id and await _family_in_active_war(family_id):
            raise HTTPException(status_code=403, detail="Loot-exclusive items cannot be sold during a family war")
    if owned_max < 1:
        raise HTTPException(status_code=400, detail="You have no armour to sell")
    armour = next((a for a in ARMOUR_SETS if a["level"] == owned_max), None)
    if not armour:
        raise HTTPException(status_code=404, detail="Armour tier not found")
    # Refund 50% of sell price (production * 1.35)
    sell_price_money = int(armour["cost_money"] * ARMOUR_WEAPON_MARGIN) if armour.get("cost_money") is not None else None
    sell_price_points = int(armour["cost_points"] * ARMOUR_WEAPON_MARGIN) if armour.get("cost_points") is not None else None
    refund_money = int(sell_price_money * 0.5) if sell_price_money is not None else None
    refund_points = int(sell_price_points * 0.5) if sell_price_points is not None else None
    new_owned_max = owned_max - 1
    equipped = int(current_user.get("armour_level", 0) or 0)
    updates = {"$set": {"armour_owned_level_max": new_owned_max}}
    if equipped == owned_max:
        updates["$set"]["armour_level"] = new_owned_max if new_owned_max > 0 else 0
    if refund_money is not None:
        updates["$inc"] = {"money": refund_money}
    elif refund_points is not None:
        updates["$inc"] = {"points": refund_points}
    await db.users.update_one({"id": current_user["id"]}, updates)
    if refund_points is not None and refund_points > 0:
        await log_points_event(db, user_id=current_user["id"], points=refund_points, event_type="armoury_sell_armour", meta={"item": armour.get("name")})
    msg = f"Sold {armour['name']} for "
    msg += f"${refund_money:,}" if refund_money is not None else f"{refund_points} points"
    return {"message": msg + " (50% of purchase price).", "refund_money": refund_money, "refund_points": refund_points}


# --- Weapons ---

# Per-user cache for GET /weapons (10s TTL); invalidate on equip/unequip/buy/sell
_get_weapons_cache: dict = {}  # user_id -> (result_list, expires_at)
_GET_WEAPONS_CACHE_TTL_SEC = 10
_GET_WEAPONS_CACHE_MAX_ENTRIES = 5000


def _invalidate_weapons_cache(user_id: str):
    _get_weapons_cache.pop(user_id, None)


class WeaponResponse(BaseModel):
    id: str
    name: str
    description: str
    damage: int
    bullets_needed: int
    rank_required: int
    price_money: Optional[int]
    price_points: Optional[int]
    effective_price_money: Optional[int] = None
    effective_price_points: Optional[int] = None
    owned: bool
    quantity: int
    equipped: bool = False
    locked: bool = False
    required_weapon_name: Optional[str] = None
    armoury_stock: int = 0  # produced stock in state's armoury (available to buy)
    loot_exclusive: bool = False


class WeaponBuyRequest(BaseModel):
    currency: str  # "money" or "points"
    state: Optional[str] = None  # armoury state to use for stock (must match the state whose stock is shown)


class WeaponEquipRequest(BaseModel):
    weapon_id: str


async def get_weapons(request: Request, current_user: dict = Depends(get_current_user)):
    uid = current_user["id"]
    state_param = (request.query_params.get("state") or "").strip()
    state = state_param or (current_user.get("current_state") or "").strip()
    use_cache = not state_param
    now = time.time()
    if use_cache and uid in _get_weapons_cache:
        payload, expires = _get_weapons_cache[uid]
        if now <= expires:
            return payload
    weapons = await db.weapons.find({}, {"_id": 0}).sort([("damage", 1), ("id", 1)]).to_list(100)
    weapons.sort(
        key=lambda w: (
            1 if w.get("loot_exclusive") else 0,
            int(w.get("damage") or 0),
            str(w.get("id") or ""),
        )
    )
    user_weapons = await db.user_weapons.find({"user_id": uid}, {"_id": 0}).to_list(100)
    weapons_map = {uw["weapon_id"]: uw["quantity"] for uw in user_weapons}
    equipped_weapon_id = current_user.get("equipped_weapon_id")
    if equipped_weapon_id and weapons_map.get(equipped_weapon_id, 0) <= 0:
        await db.users.update_one(
            {"id": uid},
            {"$set": {"equipped_weapon_id": None}}
        )
        equipped_weapon_id = None
    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    weapons_dict = {w["id"]: w for w in weapons}
    weapon_stock = {}
    unowned_armoury = False
    if state:
        factory = await get_armoury_for_state(state)
        if factory:
            weapon_stock = factory.get("weapon_stock") or {}
            unowned_armoury = not factory.get("owner_id")
    result = []
    for weapon in weapons:
        if weapon.get("loot_exclusive") and weapons_map.get(weapon["id"], 0) < 1:
            continue
        quantity = weapons_map.get(weapon["id"], 0)
        pm = weapon.get("price_money")
        pp = weapon.get("price_points")
        # price_* = production cost; sell price = production * 1.35 * event (35% margin)
        locked = False
        required_weapon_name = None
        try:
            weapon_num = int(weapon["id"].replace("weapon", "")) if weapon["id"].startswith("weapon") and weapon["id"][6:].isdigit() else 0
        except (ValueError, TypeError):
            weapon_num = 0
        if weapon_num > 1:
            prev_weapon_id = f"weapon{weapon_num - 1}"
            prev_weapon = weapons_dict.get(prev_weapon_id)
            if prev_weapon:
                required_weapon_name = prev_weapon["name"]
                prev_quantity = weapons_map.get(prev_weapon_id, 0)
                if prev_quantity < 1:
                    locked = True
        if unowned_armoury and weapon["id"] != ARMOURY_UNOWNED_ONLY_WEAPON_ID:
            locked = True
            required_weapon_name = "Claim an owned armoury for better weapons"
        armoury_stock = int(weapon_stock.get(weapon["id"], 0) or 0)
        ff = factory if state and factory else None
        efm = _effective_weapon_money_sell(weapon, ff, mult)
        efp = int(pp * ARMOUR_WEAPON_MARGIN * mult) if pp is not None else None
        result.append(WeaponResponse(
            id=weapon["id"],
            name=weapon["name"],
            description=weapon["description"],
            damage=weapon["damage"],
            bullets_needed=weapon["bullets_needed"],
            rank_required=weapon["rank_required"],
            price_money=pm,
            price_points=pp,
            effective_price_money=efm,
            effective_price_points=efp,
            owned=quantity > 0,
            quantity=quantity,
            equipped=(quantity > 0 and equipped_weapon_id == weapon["id"]),
            locked=locked,
            required_weapon_name=required_weapon_name,
            armoury_stock=armoury_stock,
            loot_exclusive=bool(weapon.get("loot_exclusive")),
        ))
    if use_cache:
        if len(_get_weapons_cache) >= _GET_WEAPONS_CACHE_MAX_ENTRIES:
            oldest = next(iter(_get_weapons_cache))
            _get_weapons_cache.pop(oldest, None)
        _get_weapons_cache[uid] = (result, now + _GET_WEAPONS_CACHE_TTL_SEC)
    return result


async def equip_weapon(request: WeaponEquipRequest, current_user: dict = Depends(get_current_user)):
    weapon_id = (request.weapon_id or "").strip()
    if not weapon_id:
        raise HTTPException(status_code=400, detail="Weapon id required")
    owned = await db.user_weapons.find_one(
        {"user_id": current_user["id"], "weapon_id": weapon_id, "quantity": {"$gt": 0}},
        {"_id": 0}
    )
    if not owned:
        raise HTTPException(status_code=400, detail="You do not own this weapon")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"equipped_weapon_id": weapon_id}}
    )
    _invalidate_weapons_cache(current_user["id"])
    return {"message": "Weapon equipped"}


async def unequip_weapon(current_user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"equipped_weapon_id": None}}
    )
    _invalidate_weapons_cache(current_user["id"])
    return {"message": "Weapon unequipped"}


async def buy_weapon(weapon_id: str, request: WeaponBuyRequest, current_user: dict = Depends(get_current_user)):
    weapon = await db.weapons.find_one({"id": weapon_id}, {"_id": 0})
    if not weapon:
        raise HTTPException(status_code=404, detail="Weapon not found")
    if weapon.get("loot_exclusive"):
        raise HTTPException(status_code=400, detail="This weapon is loot-exclusive and cannot be bought")
    weapon_num = int(weapon_id.replace("weapon", "")) if weapon_id.startswith("weapon") else 0
    if weapon_num > 1:
        prev_weapon_id = f"weapon{weapon_num - 1}"
        prev_weapon = await db.weapons.find_one({"id": prev_weapon_id}, {"_id": 0, "name": 1})
        if prev_weapon:
            user_has_prev = await db.user_weapons.find_one(
                {"user_id": current_user["id"], "weapon_id": prev_weapon_id, "quantity": {"$gte": 1}},
                {"_id": 0}
            )
            if not user_has_prev:
                raise HTTPException(
                    status_code=400,
                    detail=f"You must own {prev_weapon['name']} before buying this weapon"
                )
    state = (request.state or current_user.get("current_state") or "").strip()
    factory = await get_armoury_for_state(state) if state else None
    owner_id = factory.get("owner_id") if factory else None
    if factory and not owner_id and weapon_id != ARMOURY_UNOWNED_ONLY_WEAPON_ID:
        raise HTTPException(
            status_code=400,
            detail="Unclaimed armoury only sells Brass Knuckles. Claim an armoury for better weapons.",
        )
    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    currency = (request.currency or "").strip().lower()
    if currency not in ("money", "points"):
        raise HTTPException(status_code=400, detail="Invalid currency")
    if currency == "money":
        if weapon.get("price_money") is None:
            raise HTTPException(status_code=400, detail="This weapon can only be bought with points")
        pm = _effective_weapon_money_sell(weapon, factory, mult)
        if pm is None:
            raise HTTPException(status_code=400, detail="Invalid weapon price")
        price = pm
        insufficient_msg = "Insufficient money"
    else:
        if weapon.get("price_points") is None:
            raise HTTPException(status_code=400, detail="This weapon can only be bought with money")
        price = int(weapon["price_points"] * ARMOUR_WEAPON_MARGIN * mult)
        insufficient_msg = "Insufficient points"

    # Fulfill from armoury in same state if stock available (stock always decrements; owner gets 35% margin when buyer is not owner)
    state_key = factory.get("state") or _normalize_state(state) if factory else None
    if factory and state_key:
        needs_payment = owner_id and owner_id != current_user["id"]
        paid = False
        if needs_payment:
            pay_result = await db.users.update_one(
                {"id": current_user["id"], currency: {"$gte": price}},
                {"$inc": {currency: -price}},
            )
            if pay_result.modified_count == 0:
                raise HTTPException(status_code=400, detail=insufficient_msg)
            paid = True
        stock_result = await db.bullet_factory.update_one(
            {"state": state_key, f"weapon_stock.{weapon_id}": {"$gt": 0}},
            {"$inc": {f"weapon_stock.{weapon_id}": -1}},
        )
        if stock_result.modified_count == 1:
            if paid:
                if currency == "money":
                    await db.bullet_factory.update_one({"state": state_key}, {"$inc": {"owner_pending_profit": price}})
                else:
                    await db.bullet_factory.update_one({"state": state_key}, {"$inc": {"owner_pending_profit_points": price}})
            await db.user_weapons.update_one(
                {"user_id": current_user["id"], "weapon_id": weapon_id},
                {"$inc": {"quantity": 1}, "$set": {"acquired_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True,
            )
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$set": {"equipped_weapon_id": weapon_id}},
            )
            _invalidate_weapons_cache(current_user["id"])
            await log_activity(current_user["id"], current_user.get("username", "?"), "armoury_buy_weapon", {"weapon": weapon["name"], "cost": price, "source": "armoury"})
            return {"message": f"Successfully purchased {weapon['name']} from armoury"}
        elif paid:
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {currency: price}})

    result = await db.users.update_one(
        {"id": current_user["id"], currency: {"$gte": price}},
        {"$inc": {currency: -price}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail=insufficient_msg)
    await db.user_weapons.update_one(
        {"user_id": current_user["id"], "weapon_id": weapon_id},
        {"$inc": {"quantity": 1}, "$set": {"acquired_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"equipped_weapon_id": weapon_id}},
    )
    _invalidate_weapons_cache(current_user["id"])
    await log_activity(current_user["id"], current_user.get("username", "?"), "armoury_buy_weapon", {"weapon": weapon["name"], "cost": price})
    return {"message": f"Successfully purchased {weapon['name']}"}


async def sell_weapon(weapon_id: str, current_user: dict = Depends(get_current_user)):
    """Sell one unit of a weapon for 50% of its base purchase price. Refunds money or points (same as list price type)."""
    weapon = await db.weapons.find_one({"id": weapon_id}, {"_id": 0})
    if not weapon:
        raise HTTPException(status_code=404, detail="Weapon not found")
    uw = await db.user_weapons.find_one({"user_id": current_user["id"], "weapon_id": weapon_id}, {"_id": 0, "quantity": 1})
    quantity = (uw or {}).get("quantity", 0) or 0
    if quantity < 1:
        raise HTTPException(status_code=400, detail="You do not own this weapon")
    # Refund 50% of sell price (production * 1.35)
    sell_money = int(weapon["price_money"] * ARMOUR_WEAPON_MARGIN) if weapon.get("price_money") is not None else None
    sell_points = int(weapon["price_points"] * ARMOUR_WEAPON_MARGIN) if weapon.get("price_points") is not None else None
    refund_money = int(sell_money * 0.5) if sell_money is not None else None
    refund_points = int(sell_points * 0.5) if sell_points is not None else None
    if refund_money is None and refund_points is None:
        raise HTTPException(status_code=400, detail="Weapon has no sell value")
    if refund_money is not None:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": refund_money}})
        refund_points = None
    else:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": refund_points}})
    new_qty = quantity - 1
    if new_qty <= 0:
        await db.user_weapons.delete_one({"user_id": current_user["id"], "weapon_id": weapon_id})
        if current_user.get("equipped_weapon_id") == weapon_id:
            await db.users.update_one({"id": current_user["id"]}, {"$set": {"equipped_weapon_id": None}})
    else:
        await db.user_weapons.update_one(
            {"user_id": current_user["id"], "weapon_id": weapon_id},
            {"$inc": {"quantity": -1}}
        )
    _invalidate_weapons_cache(current_user["id"])
    msg = f"Sold 1× {weapon['name']} for "
    msg += f"${refund_money:,}" if refund_money is not None else f"{refund_points} points"
    return {"message": msg + " (50% of purchase price).", "refund_money": refund_money, "refund_points": refund_points}


async def _best_weapon_for_user(user_id: str, equipped_weapon_id: str | None = None) -> tuple[int, str]:
    """
    Return (damage, weapon_name) for combat.
    If equipped_weapon_id is provided and owned, use it; otherwise fall back to best owned.
    """
    user_weapons = await db.user_weapons.find({"user_id": user_id, "quantity": {"$gt": 0}}, {"_id": 0}).to_list(100)
    weapons_list = await db.weapons.find({}, {"_id": 0, "id": 1, "damage": 1, "name": 1}).to_list(200)
    owned_ids = {uw.get("weapon_id") for uw in user_weapons}
    if equipped_weapon_id and equipped_weapon_id in owned_ids:
        w = next((x for x in weapons_list if x.get("id") == equipped_weapon_id), None)
        if w:
            return int(w.get("damage", 5) or 5), (w.get("name") or "Weapon")
    best_damage = 5
    best_name = "Brass Knuckles"
    for uw in user_weapons:
        w = next((x for x in weapons_list if x.get("id") == uw.get("weapon_id")), None)
        dmg = int(w.get("damage", 0) or 0) if w else 0
        if dmg > best_damage:
            best_damage = dmg
            best_name = w.get("name") or best_name
    return best_damage, best_name


async def _get_weapon_mastery_pct(user_id: str, weapon_id: str | None) -> int:
    """Return 0-100 mastery for this user/weapon. Used by attack to apply bullet discount. Brass Knuckles excluded."""
    if not weapon_id or weapon_id == BRASS_KNUCKLES_WEAPON_ID:
        return 0
    doc = await db.user_weapon_mastery.find_one(
        {"user_id": user_id, "weapon_id": weapon_id},
        {"_id": 0, "mastery_pct": 1},
    )
    if not doc:
        return 0
    return min(100, max(0, int(doc.get("mastery_pct", 0) or 0)))


async def get_shooting_range_mastery(current_user: dict = Depends(get_current_user)):
    """Return mastery for all gun weapons (exclude Brass Knuckles). Sorted by damage (low→high). can_train if every *earlier* weapon the user *owns* is at 100% (unowned guns never block)."""
    now = datetime.now(timezone.utc)
    weapons_list = await db.weapons.find({}, {"_id": 0, "id": 1, "name": 1, "bullets_needed": 1, "damage": 1}).to_list(200)
    gun_weapons = [w for w in weapons_list if w.get("id") != BRASS_KNUCKLES_WEAPON_ID]
    gun_weapons.sort(key=lambda w: (int(w.get("damage") or 0), str(w.get("id") or "")))
    owned_rows = await db.user_weapons.find(
        {"user_id": current_user["id"], "quantity": {"$gt": 0}},
        {"_id": 0, "weapon_id": 1},
    ).to_list(200)
    owned_ids = {r["weapon_id"] for r in owned_rows if r.get("weapon_id")}
    mastery_docs = await db.user_weapon_mastery.find(
        {"user_id": current_user["id"], "weapon_id": {"$in": [w["id"] for w in gun_weapons]}},
        {"_id": 0, "weapon_id": 1, "mastery_pct": 1, "last_trained_at": 1},
    ).to_list(100)
    by_weapon = {d["weapon_id"]: {"mastery_pct": min(100, max(0, int(d.get("mastery_pct", 0) or 0))), "last_trained_at": d.get("last_trained_at")} for d in mastery_docs}
    result = {}
    for i, w in enumerate(gun_weapons):
        wid = w.get("id")
        if wid == BRASS_KNUCKLES_WEAPON_ID:
            continue
        info = by_weapon.get(wid, {"mastery_pct": 0, "last_trained_at": None})
        pct = info.get("mastery_pct") or 0
        last_raw = info.get("last_trained_at")
        next_train_at = None
        if last_raw:
            last_dt = _parse_utc(last_raw)
            if last_dt:
                cooldown_end = last_dt + timedelta(minutes=MASTERY_COOLDOWN_MINUTES)
                if cooldown_end > now:
                    next_train_at = cooldown_end.isoformat()
        can_train = True
        for j in range(i):
            prev_id = gun_weapons[j]["id"]
            if prev_id not in owned_ids:
                continue
            if ((by_weapon.get(prev_id) or {}).get("mastery_pct") or 0) < 100:
                can_train = False
                break
        result[wid] = {**info, "can_train": can_train, "next_train_at": next_train_at}
    return {"mastery": result, "weapons": [{"id": w["id"], "name": w.get("name", w["id"])} for w in gun_weapons]}


async def train_shooting_range(
    payload: ShootingRangeTrainRequest,
    current_user: dict = Depends(get_current_user),
):
    """Train one weapon (auto_sim chunk). User must own the weapon. Gun only (exclude Brass Knuckles). Earlier *owned* guns in damage order must be at 100% first (unowned guns do not block)."""
    weapon_id = (payload.weapon_id or "").strip()
    if not weapon_id:
        raise HTTPException(status_code=400, detail="weapon_id required")
    if weapon_id == BRASS_KNUCKLES_WEAPON_ID:
        raise HTTPException(status_code=400, detail="Brass Knuckles cannot be trained at the shooting range.")
    weapon = await db.weapons.find_one({"id": weapon_id}, {"_id": 0, "id": 1, "name": 1, "bullets_needed": 1})
    if not weapon or int(weapon.get("bullets_needed") or 0) <= 0:
        raise HTTPException(status_code=400, detail="Only guns can be trained at the shooting range.")
    owned = await db.user_weapons.find_one({"user_id": current_user["id"], "weapon_id": weapon_id, "quantity": {"$gt": 0}}, {"_id": 1})
    if not owned:
        raise HTTPException(status_code=400, detail="You must own this weapon to train it.")
    weapons_list = await db.weapons.find({}, {"_id": 0, "id": 1, "name": 1, "bullets_needed": 1, "damage": 1}).to_list(200)
    gun_weapons = [w for w in weapons_list if w.get("id") != BRASS_KNUCKLES_WEAPON_ID]
    gun_weapons.sort(key=lambda w: (int(w.get("damage") or 0), str(w.get("id") or "")))
    weapon_index = next((i for i, w in enumerate(gun_weapons) if w.get("id") == weapon_id), None)
    owned_rows = await db.user_weapons.find(
        {"user_id": current_user["id"], "quantity": {"$gt": 0}},
        {"_id": 0, "weapon_id": 1},
    ).to_list(200)
    owned_ids = {r["weapon_id"] for r in owned_rows if r.get("weapon_id")}
    if weapon_index is not None and weapon_index > 0:
        mastery_docs = await db.user_weapon_mastery.find(
            {"user_id": current_user["id"], "weapon_id": {"$in": [gun_weapons[j]["id"] for j in range(weapon_index)]}},
            {"_id": 0, "weapon_id": 1, "mastery_pct": 1},
        ).to_list(weapon_index)
        by_prev = {d["weapon_id"]: min(100, max(0, int(d.get("mastery_pct", 0) or 0))) for d in mastery_docs}
        for j in range(weapon_index):
            wid = gun_weapons[j]["id"]
            if wid not in owned_ids:
                continue
            if (by_prev.get(wid) or 0) < 100:
                prev_name = gun_weapons[j].get("name") or wid
                raise HTTPException(
                    status_code=400,
                    detail=f"Master {prev_name} first (100%) before training this weapon.",
                )
    if payload.mode not in ("auto_sim", "live"):
        raise HTTPException(status_code=400, detail="Use mode 'auto_sim' or 'live'.")
    # Turnstile: only on starting the 3D run (minigames/run-session/start); live train follows that session.
    now = datetime.now(timezone.utc)
    doc = await db.user_weapon_mastery.find_one({"user_id": current_user["id"], "weapon_id": weapon_id}, {"_id": 0, "mastery_pct": 1, "last_trained_at": 1})
    current_pct = min(100, max(0, int(doc.get("mastery_pct", 0) or 0))) if doc else 0

    if payload.mode == "live":
        hits = payload.hits if payload.hits is not None else 0
        if not (1 <= hits <= MASTERY_LIVE_HITS_MAX_PER_REQUEST):
            raise HTTPException(status_code=400, detail=f"hits must be 1–{MASTERY_LIVE_HITS_MAX_PER_REQUEST} for live mode.")
        last_raw = doc.get("last_trained_at") if doc else None
        if last_raw:
            last_dt = _parse_utc(last_raw)
            if last_dt and (now - last_dt).total_seconds() < MASTERY_COOLDOWN_MINUTES * 60:
                wait_sec = MASTERY_COOLDOWN_MINUTES * 60 - int((now - last_dt).total_seconds())
                raise HTTPException(
                    status_code=429,
                    detail=f"Wait {max(1, (wait_sec + 59) // 60)} min before playing the 3D range again (same as Train 5 min).",
                )
        add_pct = min(hits * MASTERY_PCT_PER_LIVE_HIT, 100 - current_pct)
    else:
        last_raw = doc.get("last_trained_at") if doc else None
        if last_raw:
            last_dt = _parse_utc(last_raw)
            if last_dt and (now - last_dt).total_seconds() < MASTERY_COOLDOWN_MINUTES * 60:
                wait_sec = MASTERY_COOLDOWN_MINUTES * 60 - int((now - last_dt).total_seconds())
                mm = max(1, (wait_sec + 59) // 60)
                ss = max(0, wait_sec % 60)
                raise HTTPException(
                    status_code=429,
                    detail=f"Wait {mm}m {ss}s before training this weapon again (5 min cooldown).",
                )
        add_pct = min(MASTERY_AUTO_SIM_PCT_PER_CHUNK, 100 - current_pct)

    if add_pct <= 0:
        return {"message": "Already at 100% mastery.", "mastery_pct": 100, "next_train_at": None}
    now_iso = now.isoformat()
    await db.user_weapon_mastery.update_one(
        {"user_id": current_user["id"], "weapon_id": weapon_id},
        {"$set": {"mastery_pct": current_pct + add_pct, "last_trained_at": now_iso}, "$setOnInsert": {"user_id": current_user["id"], "weapon_id": weapon_id}},
        upsert=True,
    )
    next_train_at = (now + timedelta(minutes=MASTERY_COOLDOWN_MINUTES)).isoformat() if payload.mode in ("auto_sim", "live") else None
    msg = f"+{add_pct}% mastery ({weapon.get('name', weapon_id)})." if payload.mode == "auto_sim" else f"+{add_pct}% mastery from {payload.hits} hits ({weapon.get('name', weapon_id)})."
    return {"message": msg, "mastery_pct": current_pct + add_pct, "next_train_at": next_train_at}


async def submit_shooting_range_score(request: ShootingRangeScoreRequest, current_user: dict = Depends(get_current_user)):
    """Record a shooting range run score for the leaderboard."""
    score = int(request.score) if request.score is not None else 0
    if score < 0:
        raise HTTPException(status_code=400, detail="score must be >= 0.")
    if score > SHOOTING_RANGE_ABS_SCORE_CAP:
        raise HTTPException(status_code=400, detail="score too high.")

    now_dt = datetime.now(timezone.utc).replace(microsecond=0)
    now_iso = now_dt.isoformat().replace("+00:00", "Z")
    hour_start, reset_dt = utc_rate_limit_window(now_dt)
    hour_start_iso = hour_start.isoformat().replace("+00:00", "Z")
    reset_iso = reset_dt.isoformat().replace("+00:00", "Z")

    uid = current_user["id"]
    bonus_plays = int(current_user.get("shooting_range_bonus_plays") or 0)
    hourly_limit = SHOOTING_RANGE_MAX_PLAYS_PER_HOUR + max(0, min(bonus_plays, SHOOTING_RANGE_BONUS_STORE_MAX))
    extra_plays = max(0, min(bonus_plays, SHOOTING_RANGE_BONUS_STORE_MAX))

    skip_session = skip_minigame_session(_is_admin(current_user))
    session_id = (request.session_id or "").strip()
    if not skip_session:
        if not session_id:
            raise HTTPException(status_code=400, detail="Start a run before submitting (missing session).")
        pl_gate = await get_plays_left(db, user_id=uid, game="shooting_range", extra_max=extra_plays)
        if pl_gate["plays_left"] == 0:
            raise HTTPException(
                status_code=400,
                detail=f"Play limit reached ({pl_gate['max_plays']} per {RATE_LIMIT_PERIOD_HOURS}h). Resets at {pl_gate['resets_at']}.",
            )
        sess = await claim_minigame_run_session(
            db, user_id=uid, game=SHOOTING_RANGE_SESSION_GAME, session_id=session_id, now_dt=now_dt
        )
        await enforce_numeric_score_for_claimed_session(
            db,
            session_id=session_id,
            sess=sess,
            now_dt=now_dt,
            score=score,
            max_score_cap=SHOOTING_RANGE_ABS_SCORE_CAP,
            rate_per_second=SHOOTING_RANGE_SCORE_RATE,
            buffer=SHOOTING_RANGE_SCORE_BUFFER,
            max_elapsed_seconds=SHOOTING_RANGE_MAX_SCORING_SECONDS,
        )

    result = await db.user_meta.update_one(
        {
            "user_id": uid,
            "shooting_range_hour_start": hour_start_iso,
            "shooting_range_hour_count": {"$lt": hourly_limit},
        },
        {
            "$inc": {"shooting_range_hour_count": 1},
            "$set": {"shooting_range_hour_reset_at": reset_iso},
        },
    )
    if result.modified_count == 0:
        result = await db.user_meta.update_one(
            {"user_id": uid, "shooting_range_hour_start": {"$ne": hour_start_iso}},
            {
                "$setOnInsert": {"user_id": uid},
                "$set": {
                    "shooting_range_hour_start": hour_start_iso,
                    "shooting_range_hour_reset_at": reset_iso,
                    "shooting_range_hour_count": 1,
                },
            },
            upsert=True,
        )
        if result.modified_count == 0 and result.upserted_id is None:
            remaining = max(0, int((reset_dt - now_dt).total_seconds()))
            raise HTTPException(
                status_code=400,
                detail=f"Play limit reached ({hourly_limit} per {RATE_LIMIT_PERIOD_HOURS}h). Try again in {remaining}s.",
            )

    doc = {
        "user_id": current_user["id"],
        "username": current_user.get("username") or "?",
        "score": score,
        "created_at": now_iso,
    }
    await db.shooting_range_scores.insert_one(doc)
    try:
        await log_minigame_play(current_user["id"], current_user.get("username"), "shooting_range", score)
    except Exception:
        pass
    await log_minigame_payout(current_user["id"], current_user.get("username", "?"), "shooting_range", score, {})
    plays_info = await get_plays_left(db, user_id=uid, game="shooting_range", extra_max=extra_plays)
    return {
        "message": "Score recorded.",
        "score": score,
        "plays_left": plays_info["plays_left"],
        "max_plays": plays_info["max_plays"],
        "resets_at": plays_info["resets_at"],
    }


async def get_shooting_range_leaderboard(period: str = "all", current_user: dict = Depends(get_current_user)):
    """Return top 10 shooting range scores with optional period filter and personal best."""
    staff_ids = await _get_staff_user_ids()
    query = {"user_id": {"$nin": staff_ids}} if staff_ids else {}
    now = datetime.now(timezone.utc)
    if period == "weekly":
        cutoff = (now - timedelta(days=7)).isoformat().replace("+00:00", "Z")
        query["created_at"] = {"$gte": cutoff}
    elif period == "today":
        cutoff = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat().replace("+00:00", "Z")
        query["created_at"] = {"$gte": cutoff}

    cursor = db.shooting_range_scores.find(
        query,
        {"_id": 0, "username": 1, "score": 1, "created_at": 1},
    ).sort([("score", -1), ("created_at", 1)]).limit(10)
    rows = await cursor.to_list(10)

    pb_doc = await db.shooting_range_scores.find_one(
        {"user_id": current_user["id"]},
        {"_id": 0, "score": 1},
        sort=[("score", -1)],
    )
    personal_best = pb_doc.get("score", 0) if pb_doc else 0

    return {
        "leaderboard": [{"rank": i + 1, "username": r.get("username", "?"), "score": r.get("score", 0)} for i, r in enumerate(rows)],
        "personal_best": personal_best,
    }


def _tokens_from_user(user: dict) -> dict:
    """Build tokens dict for inventory: count and active_until per token type."""
    now = datetime.now(timezone.utc)
    out = {}
    for t in TOKEN_TYPES:
        cfg = TOKEN_CONFIG.get(t)
        if not cfg:
            continue
        count_field = cfg["count_field"]
        until_field = cfg["until_field"]
        expiry_field = cfg.get("expiry_field")
        count = int(user.get(count_field) or 0)
        until_raw = user.get(until_field)
        active_until = None
        if until_raw:
            until = _parse_utc(until_raw)
            if until and until > now:
                active_until = until.isoformat()
        expires_at = None
        if expiry_field:
            expires_raw = user.get(expiry_field)
            if expires_raw:
                expires_dt = _parse_utc(expires_raw)
                if expires_dt:
                    expires_at = expires_dt.isoformat()
        out[t] = {"count": count, "active_until": active_until, "expires_at": expires_at}
    return out


def _parse_until(iso_str):
    """Parse ISO datetime; return timezone-aware datetime or None."""
    if not iso_str:
        return None
    if hasattr(iso_str, "year"):
        dt = iso_str
    else:
        try:
            dt = datetime.fromisoformat(str(iso_str).strip().replace("Z", "+00:00"))
        except Exception:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _format_boost_until_utc(dt: datetime) -> str:
    """Readable UTC time for toasts (no ISO/microsecond noise)."""
    if dt is None:
        return "—"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%d %b %Y · %H:%M UTC")


def _tokens_to_reach_stack_cap(user_doc: dict, token_type: str) -> Tuple[int, Optional[datetime]]:
    """How many tokens to consume and final until, without wasting tokens at stack cap."""
    cfg = TOKEN_CONFIG[token_type]
    count_field = cfg["count_field"]
    until_field = cfg["until_field"]
    duration_hours = cfg.get("duration_hours", TOKEN_DURATION_HOURS)
    max_stack_hours = cfg["max_stack_hours"]
    count = int(user_doc.get(count_field) or 0)
    if count < 1:
        return 0, None
    now = datetime.now(timezone.utc)
    cap_until = now + timedelta(hours=max_stack_hours)
    current_until = _parse_until(user_doc.get(until_field))
    baseline = current_until if current_until and current_until > now else now

    duration_seconds = int(timedelta(hours=duration_hours).total_seconds())
    if duration_seconds <= 0:
        return 0, None

    headroom_seconds = int((cap_until - baseline).total_seconds())
    if headroom_seconds < duration_seconds:
        return 0, None

    full_tokens_that_fit = headroom_seconds // duration_seconds
    to_use = min(count, full_tokens_that_fit)
    if to_use < 1:
        return 0, None

    return to_use, baseline + timedelta(seconds=duration_seconds * to_use)


async def use_consumable_token(req: UseTokenRequest, current_user: dict = Depends(get_current_user)):
    """Use one consumable token, or many with use_all (stack up to max_stack_hours without wasting)."""
    if req.token_type not in TOKEN_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid token_type. Use one of: {list(TOKEN_TYPES)}")
    cfg = TOKEN_CONFIG[req.token_type]
    count_field = cfg["count_field"]
    until_field = cfg["until_field"]
    duration_hours = cfg.get("duration_hours", TOKEN_DURATION_HOURS)
    max_stack_hours = cfg["max_stack_hours"]
    expiry_field = cfg.get("expiry_field")
    # Game Pass: JWT/current_user can be stale if Stripe webhook just updated the user — refresh before use.
    if req.token_type == "rank_xp_pass":
        fresh = await db.users.find_one(
            {"id": current_user["id"]},
            {
                "_id": 0,
                "rank_xp_pass_tokens": 1,
                "rank_xp_pass_token_expires_at": 1,
                "rank_xp_pass_pending_tier_snapshot": 1,
                "rank_xp_pass_tier_snapshot": 1,
                "rank_xp_pass_rewards_granted": 1,
                "rank_xp_pass_last_granted_micro_tier": 1,
                "rank_xp_pass_free_last_micro_tier_granted": 1,
            },
        )
        if fresh:
            current_user = {**current_user, **fresh}
    count = int(current_user.get(count_field) or 0)
    if count < 1:
        raise HTTPException(status_code=400, detail="No tokens of this type available.")

    # Special case: auto_rank_2h grants temporary Auto Rank access (stackable up to TOKEN_MAX_STACK_HOURS).
    if req.token_type == "auto_rank_2h":
        # Parse current temporary Auto Rank window.
        now = datetime.now(timezone.utc)
        existing_until = _parse_until(current_user.get("auto_rank_trial_until"))
        if existing_until and existing_until <= now:
            existing_until = None

        cap_until = now + timedelta(hours=max_stack_hours)
        duration_td = timedelta(hours=duration_hours)

        if req.use_all:
            to_use, sim_until = _tokens_to_reach_stack_cap(current_user, req.token_type)
            if to_use < 1 or sim_until is None:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot extend this boost further — already at the maximum stack duration.",
                )

            new_until_iso = sim_until.isoformat()
            set_updates = {
                "auto_rank_trial_until": new_until_iso,
                "auto_rank_enabled": True,
                "auto_rank_idle": False,
            }
            if not bool(current_user.get("auto_rank_purchased")):
                set_updates["auto_rank_purchased"] = True
                set_updates["auto_rank_trial"] = True
            result = await db.users.update_one(
                {"id": current_user["id"], count_field: {"$gte": to_use}},
                {
                    "$inc": {count_field: -to_use},
                    "$set": set_updates,
                },
            )
            if result.modified_count == 0:
                raise HTTPException(status_code=400, detail="No tokens available or race condition.")

            tokens = _tokens_from_user({
                **current_user,
                count_field: count - to_use,
                "auto_rank_trial_until": new_until_iso,
            })
            return {
                "message": (
                    f"Used {to_use} token(s). Auto Rank until {_format_boost_until_utc(sim_until)} "
                    f"(max {max_stack_hours}h stack)."
                ),
                "tokens": tokens,
            }

        # Use 1 token.
        if existing_until and existing_until > now:
            add_until = existing_until + duration_td
            new_until = min(add_until, cap_until)
            if new_until <= existing_until:
                raise HTTPException(
                    status_code=400,
                    detail=f"Already at the maximum Auto Rank stack ({max_stack_hours}h). Wait for it to expire or use 'Apply all' after it runs down.",
                )
            if new_until < add_until:
                raise HTTPException(
                    status_code=400,
                    detail="Using one token would exceed the stack cap and waste time. Use 'Apply all' to add only the tokens needed to reach the cap.",
                )
        else:
            new_until = now + timedelta(hours=min(duration_hours, max_stack_hours))
        new_until_iso = new_until.isoformat()
        set_updates = {
            "auto_rank_trial_until": new_until_iso,
            "auto_rank_enabled": True,
            "auto_rank_idle": False,
        }
        if not bool(current_user.get("auto_rank_purchased")):
            set_updates["auto_rank_purchased"] = True
            set_updates["auto_rank_trial"] = True

        result = await db.users.update_one(
            {"id": current_user["id"], count_field: {"$gte": 1}},
            {
                "$inc": {count_field: -1},
                "$set": set_updates,
            },
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail="No tokens available or race condition.")

        tokens = _tokens_from_user({
            **current_user,
            count_field: count - 1,
            "auto_rank_trial_until": new_until_iso,
        })
        return {
            "message": f"Auto Rank until {_format_boost_until_utc(new_until)} (2h per token).",
            "tokens": tokens,
        }

    # Rank-XP pass: enforce token expiry if token was not activated before expiry_field.
    if expiry_field:
        expires_dt = _parse_until(current_user.get(expiry_field))
        if expires_dt and expires_dt <= datetime.now(timezone.utc):
            # Expired unactivated token: remove it so the UI doesn't keep offering activation.
            unset_map = {expiry_field: "", until_field: ""}
            if req.token_type == "rank_xp_pass":
                unset_map["rank_xp_pass_pending_tier_snapshot"] = ""
                # Pending token can never be activated now, so it must not be considered “granted”.
                await db.users.update_one(
                    {"id": current_user["id"]},
                    {
                        "$set": {
                            count_field: 0,
                            "rank_xp_pass_rewards_granted": False,
                            "rank_xp_pass_last_granted_micro_tier": 0,
                            "rank_xp_pass_tier_snapshot": None,
                        },
                        "$unset": unset_map,
                    },
                )
            else:
                await db.users.update_one(
                    {"id": current_user["id"]},
                    {"$set": {count_field: 0}, "$unset": unset_map},
                )
            raise HTTPException(status_code=400, detail="Game Pass token has expired. Buy a new pass.")

    if req.use_all:
        n, new_until = _tokens_to_reach_stack_cap(current_user, req.token_type)
        if n < 1 or new_until is None:
            raise HTTPException(
                status_code=400,
                detail="Cannot extend this boost further — already at the maximum stack duration. Use tokens after it expires or wears down.",
            )
        new_until_iso = new_until.isoformat()
        result = await db.users.update_one(
            {"id": current_user["id"], count_field: {"$gte": n}},
            {
                "$inc": {count_field: -n},
                **(
                    {"$unset": {until_field: ""}}
                    if req.token_type == "rank_xp_pass"
                    else {"$set": {until_field: new_until_iso}}
                ),
                # Activation consumes the token(s); token expiry only matters for unactivated tokens.
                **(
                    {"$unset": {expiry_field: ""}}
                    if expiry_field and req.token_type != "rank_xp_pass"
                    else {}
                ),
            },
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail="No tokens of this type available or race condition.")
        new_count = count - n
        tokens = _tokens_from_user({
            **current_user,
            count_field: new_count,
            until_field: None if req.token_type == "rank_xp_pass" else new_until_iso,
            **(
                {"%s" % expiry_field: None}
                if expiry_field and req.token_type != "rank_xp_pass"
                else {}
            ),
        })

        pass_activated_now = False
        if req.token_type == "rank_xp_pass":
            tier_snapshot = current_user.get("rank_xp_pass_pending_tier_snapshot") or current_user.get("rank_xp_pass_tier_snapshot") or 0
            free_cash_last_micro = int(current_user.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
            pass_activated_now = await _activate_rank_xp_pass_and_grant_cumulative_micro_tiers(
                db,
                current_user["id"],
                tier_snapshot,
                free_cash_last_micro_tier_granted=free_cash_last_micro,
            )
        if req.token_type == "rank_xp_pass":
            if pass_activated_now:
                gp_msg_all = "Game Pass activated. Rewards granted."
            else:
                vip_row_all = await db.users.find_one(
                    {"id": current_user["id"]},
                    {"_id": 0, "rank_xp_pass_rewards_granted": 1},
                )
                if (vip_row_all or {}).get("rank_xp_pass_rewards_granted") is True:
                    gp_msg_all = (
                        "Game Pass was already active (rewards were granted when you purchased or on a prior activation). "
                        "This token was consumed."
                    )
                else:
                    gp_msg_all = "Game Pass already claimed."
        else:
            gp_msg_all = ""
        return {
            "message": (
                gp_msg_all
                if req.token_type == "rank_xp_pass"
                else f"Used {n} token(s). Boost until {_format_boost_until_utc(new_until)} (max {max_stack_hours}h stack)."
            ),
            "tokens": tokens,
        }

    now = datetime.now(timezone.utc)
    current_until = _parse_until(current_user.get(until_field))
    if current_until and current_until > now:
        # Stack: new expiry = min(current + duration_hours, now + max_stack_hours)
        add_until = current_until + timedelta(hours=duration_hours)
        cap_until = now + timedelta(hours=max_stack_hours)
        new_until = min(add_until, cap_until)
        if new_until <= current_until:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Already at the maximum stack ({max_stack_hours}h). Wait for this boost to expire, "
                    "or use 'Apply all' after it runs down."
                ),
            )
        # Do not consume a full token if it would only partially apply before hitting the cap (users lose time).
        if req.token_type != "rank_xp_pass" and new_until < add_until:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Using one token would exceed the {max_stack_hours}h cap and waste time. "
                    "Use 'Apply all' to add only the tokens needed to reach the cap without losing tokens."
                ),
            )
    else:
        new_until = now + timedelta(hours=min(duration_hours, max_stack_hours))
    new_until_iso = new_until.isoformat()
    result = await db.users.update_one(
        {"id": current_user["id"], count_field: {"$gte": 1}},
        {
            "$inc": {count_field: -1},
            **(
                {"$unset": {until_field: ""}}
                if req.token_type == "rank_xp_pass"
                else {"$set": {until_field: new_until_iso}}
            ),
            **(
                {"$unset": {expiry_field: ""}}
                if expiry_field and req.token_type != "rank_xp_pass"
                else {}
            ),
        },
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="No tokens of this type available or race condition.")
    tokens = _tokens_from_user({
        **current_user,
        count_field: count - 1,
        until_field: None if req.token_type == "rank_xp_pass" else new_until_iso,
        **(
            {"%s" % expiry_field: None}
            if expiry_field and req.token_type != "rank_xp_pass"
            else {}
        ),
    })

    pass_activated_now = False
    if req.token_type == "rank_xp_pass":
        tier_snapshot = current_user.get("rank_xp_pass_pending_tier_snapshot") or current_user.get("rank_xp_pass_tier_snapshot") or 0
        free_cash_last_micro = int(current_user.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
        pass_activated_now = await _activate_rank_xp_pass_and_grant_cumulative_micro_tiers(
            db,
            current_user["id"],
            tier_snapshot,
            free_cash_last_micro_tier_granted=free_cash_last_micro,
        )
    if req.token_type == "rank_xp_pass":
        if pass_activated_now:
            gp_msg = "Game Pass activated. Rewards granted."
        else:
            vip_row = await db.users.find_one(
                {"id": current_user["id"]},
                {"_id": 0, "rank_xp_pass_rewards_granted": 1},
            )
            if (vip_row or {}).get("rank_xp_pass_rewards_granted") is True:
                gp_msg = (
                    "Game Pass was already active (rewards were granted when you purchased or on a prior activation). "
                    "This token was consumed."
                )
            else:
                gp_msg = "Game Pass already claimed."
    else:
        gp_msg = ""
    return {
        "message": (
            gp_msg
            if req.token_type == "rank_xp_pass"
            else f"Used 1 token. Boost until {_format_boost_until_utc(new_until)} (max {max_stack_hours}h stack)."
        ),
        "tokens": tokens,
    }


async def exchange_auto_rank_tokens(req: ExchangeAutoRankRequest, current_user: dict = Depends(get_current_user)):
    """Burn 1× Auto Rank (2h) token for 2 random distinct other tokens (no cash/points)."""
    if int(req.count or 1) != 1:
        raise HTTPException(status_code=400, detail="Exchange exactly 1 Auto Rank (2h) token at a time.")
    pool = list(AUTO_RANK_EXCHANGE_POOL)
    for t in pool:
        if t not in TOKEN_CONFIG:
            raise HTTPException(status_code=500, detail="Exchange pool misconfigured.")
    if len(pool) < 2:
        raise HTTPException(status_code=500, detail="Exchange is unavailable.")
    k = min(AUTO_RANK_EXCHANGE_TOKEN_COUNT, len(pool))
    chosen = random.sample(pool, k)

    inc: Dict[str, int] = {"auto_rank_2h_tokens": -1}
    for t in chosen:
        cf = TOKEN_CONFIG[t]["count_field"]
        inc[cf] = inc.get(cf, 0) + 1

    uid = current_user["id"]
    result = await db.users.update_one({"id": uid, "auto_rank_2h_tokens": {"$gte": 1}}, {"$inc": inc})
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="No Auto Rank (2h) tokens available.")

    uname = (current_user.get("username") or "").strip() or "?"
    await log_activity(
        uid,
        uname,
        "inventory_auto_rank_exchange",
        {"granted_tokens": chosen, "granted_count": len(chosen)},
    )

    fresh = await db.users.find_one({"id": uid}, {"_id": 0})
    tokens = _tokens_from_user(fresh or {})
    n = len(chosen)
    return {
        "message": f"Traded 1 Auto Rank (2h) for {n} boost tokens.",
        "tokens": tokens,
        "exchange": {
            "consumed_auto_rank_2h": 1,
            "granted_tokens": [{"type": t, "amount": 1} for t in chosen],
        },
    }


async def get_inventory(request: Request, current_user: dict = Depends(get_current_user)):
    """Aggregate weapons, armour, loot exclusives, and consumable tokens for the My Inventory page."""
    weapons = await get_weapons(request, current_user)
    armour = await get_armour_options(request, current_user)
    uid = current_user["id"]
    exclusive_cars = []
    cars = await db.user_cars.find({"user_id": uid}, {"_id": 0, "car_id": 1, "id": 1}).to_list(100)
    cars_list = CARS or []
    for uc in cars:
        cinfo = next((c for c in cars_list if c.get("id") == uc.get("car_id")), None)
        if cinfo and cinfo.get("rarity") in ("loot_exclusive", "exclusive"):
            exclusive_cars.append({"id": uc.get("id"), "name": cinfo.get("name", "?"), "car_id": uc.get("car_id"), "rarity": cinfo.get("rarity", "loot_exclusive")})
    speakeasy = await db.exclusive_properties.find_one({"owner_id": uid, "type": "speakeasy"}, {"_id": 0, "last_speakeasy_collected_at": 1})
    speakeasy_info = None
    if speakeasy is not None:
        from datetime import datetime, timezone
        SPEAKEASY_DAILY_CASH = 25_000
        SPEAKEASY_DAILY_BULLETS = 25
        SPEAKEASY_COOLDOWN_HOURS = 24
        last_collected = speakeasy.get("last_speakeasy_collected_at")
        can_collect = True
        next_collect_at = None
        if last_collected:
            try:
                last_dt = datetime.fromisoformat(last_collected.replace("Z", "+00:00"))
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                next_dt = last_dt + __import__("datetime").timedelta(hours=SPEAKEASY_COOLDOWN_HOURS)
                now = datetime.now(timezone.utc)
                if now < next_dt:
                    can_collect = False
                    next_collect_at = next_dt.isoformat()
            except Exception:
                pass
        speakeasy_info = {
            "daily_cash": SPEAKEASY_DAILY_CASH,
            "daily_bullets": SPEAKEASY_DAILY_BULLETS,
            "cooldown_hours": SPEAKEASY_COOLDOWN_HOURS,
            "can_collect": can_collect,
            "next_collect_at": next_collect_at,
            "last_collected_at": last_collected,
        }
    tokens = _tokens_from_user(current_user)
    return {
        "weapons": [w.model_dump() if hasattr(w, "model_dump") else w for w in weapons],
        "armour": armour,
        "loot_exclusives": {
            "exclusive_cars": exclusive_cars,
            "has_speakeasy": speakeasy is not None,
            "speakeasy": speakeasy_info,
        },
        "tokens": tokens,
    }


def register(router):
    # Bullet factory routes
    router.add_api_route("/bullet-factory", get_bullet_factory, methods=["GET"])
    router.add_api_route("/bullet-factory/list", get_bullet_factory_list, methods=["GET"])
    router.add_api_route("/bullet-factory/claim", claim_bullet_factory, methods=["POST"])
    router.add_api_route("/bullet-factory/set-price", set_price, methods=["POST"])
    router.add_api_route("/bullet-factory/set-item-prices", set_armoury_item_prices, methods=["POST"])
    router.add_api_route("/bullet-factory/relinquish", relinquish_bullet_factory, methods=["POST"])
    router.add_api_route("/bullet-factory/send-to-user", bullet_factory_send_to_user, methods=["POST"])
    router.add_api_route("/bullet-factory/sell-on-trade", bullet_factory_sell_on_trade, methods=["POST"])
    router.add_api_route("/bullet-factory/collect", collect_bullet_factory, methods=["POST"])
    router.add_api_route("/bullet-factory/buy", buy_bullets, methods=["POST"])
    router.add_api_route("/bullet-factory/start-armour-production", start_armour_production, methods=["POST"])
    router.add_api_route("/bullet-factory/start-weapon-production", start_weapon_production, methods=["POST"])
    router.add_api_route("/bullet-factory/start-armour-production-all", start_armour_production_all, methods=["POST"])
    router.add_api_route("/bullet-factory/start-weapon-production-all", start_weapon_production_all, methods=["POST"])
    router.add_api_route("/store/buy-bullets", store_buy_bullets, methods=["POST"])
    router.add_api_route("/admin/add-bullets", admin_add_bullets, methods=["POST"])
    # Armour routes
    router.add_api_route("/armour/options", get_armour_options, methods=["GET"])
    router.add_api_route("/armour/buy", buy_armour, methods=["POST"])
    router.add_api_route("/armour/equip", equip_armour, methods=["POST"])
    router.add_api_route("/armour/unequip", unequip_armour, methods=["POST"])
    router.add_api_route("/armour/sell", sell_armour, methods=["POST"])
    # Weapons routes
    router.add_api_route("/weapons", get_weapons, methods=["GET"], response_model=List[WeaponResponse])
    router.add_api_route("/weapons/equip", equip_weapon, methods=["POST"])
    router.add_api_route("/weapons/unequip", unequip_weapon, methods=["POST"])
    router.add_api_route("/weapons/{weapon_id}/buy", buy_weapon, methods=["POST"])
    router.add_api_route("/weapons/{weapon_id}/sell", sell_weapon, methods=["POST"])
    router.add_api_route("/shooting-range/mastery", get_shooting_range_mastery, methods=["GET"])
    router.add_api_route("/shooting-range/train", train_shooting_range, methods=["POST"])
    router.add_api_route("/shooting-range/score", submit_shooting_range_score, methods=["POST"])
    router.add_api_route("/shooting-range/leaderboard", get_shooting_range_leaderboard, methods=["GET"])
    router.add_api_route("/inventory", get_inventory, methods=["GET"])
    router.add_api_route("/inventory/tokens/use", use_consumable_token, methods=["POST"])
    router.add_api_route("/inventory/tokens/exchange-auto-rank", exchange_auto_rank_tokens, methods=["POST"])
