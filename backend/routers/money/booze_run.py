# Booze Run: config, buy, sell, capacity upgrade; rotation helpers for flash news
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional
import asyncio
import logging
import time
import secrets
_rng = secrets.SystemRandom()
logger = logging.getLogger(__name__)
from pydantic import BaseModel

from fastapi import Depends, HTTPException, Request

from utils.game_timezone import game_today_date_str
from utils.referral_ids import (
    apply_referrer_referral_increment,
    normalize_referred_by_ids,
    referral_pool_int,
    split_referral_pool,
)

from server import (
    db,
    get_current_user,
    get_rank_info,
    user_prestige_rank_mult,
    STATES,
    GODFATHER_RANK_ID,
    _is_admin,
    log_activity,
    require_admin,
    staff_exclude_users_match,
)
from utils.minigame_captcha_gate import require_turnstile_for_game_action
from utils.point_provenance import log_points_event
from utils.family_perks import family_perk_modifiers, FAMILY_PERK_BOOZE_BONUS_CAP
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_BOOZE


async def _booze_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_BOOZE)


_booze_rl_u = [Depends(_booze_sustained_rl_user)]

_booze_bookkeeping_locks: Dict[str, asyncio.Lock] = {}
_booze_bookkeeping_tasks: set = set()


def _spawn_booze_bookkeeping(user_id: str, coro_factory) -> None:
    """Run coro_factory() in the background, serialized per user."""
    lock = _booze_bookkeeping_locks.setdefault(user_id or "", asyncio.Lock())

    async def _runner():
        async with lock:
            try:
                await coro_factory()
            except Exception:
                logger.exception("booze post-sell bookkeeping failed user_id=%s", user_id)

    task = asyncio.create_task(_runner())
    _booze_bookkeeping_tasks.add(task)
    task.add_done_callback(_booze_bookkeeping_tasks.discard)


def _parse_iso_datetime(s):
    """Parse ISO datetime string safely; return timezone-aware datetime or None."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None

# ----- Constants -----
BOOZE_ROTATION_HOURS = 3
_booze_rotation_override_seconds: Optional[int] = None

BOOZE_TYPES = [
    {"id": "bathtub_gin", "name": "Bathtub Gin"},
    {"id": "moonshine", "name": "Moonshine"},
    {"id": "rum_runners", "name": "Rum Runner's Rum"},
    {"id": "speakeasy_whiskey", "name": "Speakeasy Whiskey"},
    {"id": "needle_beer", "name": "Needle Beer"},
    {"id": "jamaica_ginger", "name": "Jamaica Ginger"},
]

BOOZE_CAPACITY_BASE_RANK1 = 50
BOOZE_CAPACITY_UPGRADE_COST = 100
BOOZE_CAPACITY_UPGRADE_AMOUNT = 25
BOOZE_CAPACITY_BONUS_MAX = 1000
# Max total booze cargo at Godfather (prestige 0..5): rank + Points Store bonus + family perk combined.
BOOZE_GODFATHER_TOTAL_CARGO_BY_PRESTIGE = (1600, 1800, 2000, 2300, 2500, 3000)
# Backwards-compatible alias (same tuple).
BOOZE_GODFATHER_CARGO_BY_PRESTIGE = BOOZE_GODFATHER_TOTAL_CARGO_BY_PRESTIGE
BOOZE_RUN_HISTORY_MAX = 10
BOOZE_RUN_JAIL_CHANCE_MIN = 0.05
BOOZE_RUN_JAIL_CHANCE_MAX = 0.15
BOOZE_RUN_JAIL_SECONDS = 20
# Top 3 non-staff users by lifetime booze_run_profit_total (same ordering as admin leaders): small extra bust chance.
# Not exposed to clients; cached briefly to limit DB reads.
BOOZE_TOP_PROFIT_LEADER_COUNT = 3
BOOZE_TOP_PROFIT_LEADER_CACHE_SEC = 90.0
BOOZE_TOP_LEADER_JAIL_BONUS = 0.035  # added to the rolled probability for that action (e.g. 10% -> 13.5%)
BOOZE_TOP_LEADER_JAIL_CHANCE_CAP = 0.22  # ceiling after bonus
# Multiplier on net profit for a completed run (buy city ≠ sell city); stats, cash, referrals, economy_events.
BOOZE_RUN_PROFIT_MULT = 0.75
# Flat rank XP for a real trip (buy city ≠ sell city); once per cargo batch — see booze_run_rp_granted.
BOOZE_RUN_TRIP_RANK_POINTS = 10

# Per-user cache for GET /booze-run/config
_config_cache: dict = {}
_CONFIG_TTL_SEC = 10
_CONFIG_MAX_ENTRIES = 5000

_booze_top_profit_leader_cache_until: float = 0.0
_booze_top_profit_leader_cache_ids: frozenset[str] = frozenset()

# Admin overrides (None = use BOOZE_RUN_JAIL_CHANCE_MIN / MAX). Persisted in game_settings booze_run_globals.
_booze_jail_min_override: Optional[float] = None
_booze_jail_max_override: Optional[float] = None

# Global listed-price multiplier (buy & sell use same listed price before booze token discount on buy).
# game_settings _id=booze_run_globals also stores rotation_seconds and jail_chance_min/max overrides.
BOOZE_GLOBALS_DOC_ID = "booze_run_globals"
BOOZE_LISTED_PRICE_MULT_MIN = 0.01  # up to 99% off vs full rotation prices
# Above 1.0 = premium vs rotation baseline (e.g. 1.1 = +10%). Capped for safety.
BOOZE_LISTED_PRICE_MULT_MAX = 1.5
# Nudge math uses "percent off" (positive = discount). Negative = premium above baseline; cap matches mult max.
BOOZE_LISTED_PREMIUM_MAX_PCT = (BOOZE_LISTED_PRICE_MULT_MAX - 1.0) * 100.0  # 50 → mult ≤ 1.5
BOOZE_LISTED_DISCOUNT_MAX_PCT = 99.0
_booze_listed_price_mult: float = 1.0


def _invalidate_config_cache(user_id: str):
    _config_cache.pop(user_id, None)


def _invalidate_all_booze_config_cache():
    _config_cache.clear()


def get_booze_listed_price_mult() -> float:
    """Effective multiplier on rotation listed prices (1.0 = no change). Clamped to BOOZE_LISTED_PRICE_MULT_*."""
    m = float(_booze_listed_price_mult)
    return max(BOOZE_LISTED_PRICE_MULT_MIN, min(BOOZE_LISTED_PRICE_MULT_MAX, m))


async def load_booze_globals_from_db():
    """Restore listed_price_mult, rotation override, and jail overrides after process restart."""
    global _booze_listed_price_mult, _booze_rotation_override_seconds, _booze_jail_min_override, _booze_jail_max_override
    try:
        doc = await db.game_settings.find_one(
            {"$or": [{"_id": BOOZE_GLOBALS_DOC_ID}, {"key": BOOZE_GLOBALS_DOC_ID}]},
            {
                "_id": 0,
                "listed_price_mult": 1,
                "rotation_seconds": 1,
                "jail_chance_min": 1,
                "jail_chance_max": 1,
            },
        )
        if doc:
            if doc.get("listed_price_mult") is not None:
                _booze_listed_price_mult = float(doc["listed_price_mult"])
            else:
                _booze_listed_price_mult = 1.0
            rs = doc.get("rotation_seconds")
            if rs is not None and int(rs) > 0:
                _booze_rotation_override_seconds = int(rs)
            else:
                _booze_rotation_override_seconds = None
            jm = doc.get("jail_chance_min")
            jx = doc.get("jail_chance_max")
            _booze_jail_min_override = float(jm) if jm is not None else None
            _booze_jail_max_override = float(jx) if jx is not None else None
            if _booze_jail_min_override is not None and not (0.0 <= _booze_jail_min_override <= 1.0):
                _booze_jail_min_override = None
            if _booze_jail_max_override is not None and not (0.0 <= _booze_jail_max_override <= 1.0):
                _booze_jail_max_override = None
            if (
                _booze_jail_min_override is not None
                and _booze_jail_max_override is not None
                and _booze_jail_min_override > _booze_jail_max_override
            ):
                _booze_jail_min_override, _booze_jail_max_override = _booze_jail_max_override, _booze_jail_min_override
    except Exception:
        pass
    _booze_listed_price_mult = get_booze_listed_price_mult()


# ----- Rotation (exported for server flash news) -----
def get_booze_rotation_interval_seconds():
    global _booze_rotation_override_seconds
    if _booze_rotation_override_seconds is not None and _booze_rotation_override_seconds > 0:
        return _booze_rotation_override_seconds
    return BOOZE_ROTATION_HOURS * 3600


def get_booze_rotation_index():
    return int(datetime.now(timezone.utc).timestamp() // get_booze_rotation_interval_seconds())


def _booze_rotation_interval_seconds():
    return get_booze_rotation_interval_seconds()


def _booze_rotation_index():
    return get_booze_rotation_index()


def _booze_rotation_ends_at():
    idx = _booze_rotation_index()
    end_ts = (idx + 1) * _booze_rotation_interval_seconds()
    return datetime.fromtimestamp(end_ts, tz=timezone.utc).isoformat()


def _booze_city_pairs() -> list:
    """Unordered city index pairs for the current STATES list (adapts when cities are disabled)."""
    n = len(STATES or [])
    if n < 2:
        return []
    return [(i, j) for i in range(n) for j in range(i + 1, n)]


def _booze_round_trip_cities():
    pairs = _booze_city_pairs()
    if not pairs:
        return []
    idx = _booze_rotation_index()
    i, j = pairs[idx % len(pairs)]
    return [STATES[i], STATES[j]]


def _booze_prices_for_rotation():
    idx = _booze_rotation_index()
    n_locs = max(1, len(STATES or []))
    n_booze = len(BOOZE_TYPES)
    out = {}
    for loc_i in range(n_locs):
        for booze_i in range(n_booze):
            # Stable spine by city + product; small per-window drift only (avoids huge jumps when idx ticks).
            spine = 200 + (loc_i * 85) + (booze_i * 72)
            slow = ((idx * 13 + loc_i * 29 + booze_i * 37) % 53) - 26  # about ±26
            micro = ((idx * 3 + loc_i * 5 + booze_i * 7) % 17) - 8  # about ±8
            base = spine + slow + micro
            price = min(2000, max(100, base))
            out[(loc_i, booze_i)] = price
    pairs = _booze_city_pairs()
    if not pairs:
        mult = get_booze_listed_price_mult()
        if mult < 1.0:
            for k in list(out.keys()):
                out[k] = max(100, min(2000, int(round(out[k] * mult))))
        return out
    locA, locB = pairs[idx % len(pairs)]
    profit_min = 40
    booze_ab = idx % n_booze
    price_a_ab = out[(locA, booze_ab)]
    price_b_ab = out[(locB, booze_ab)]
    if price_b_ab <= price_a_ab + profit_min:
        price_b_ab = min(2000, price_a_ab + profit_min + (idx % 60))
        out[(locB, booze_ab)] = price_b_ab
    booze_ba = (idx + 1) % n_booze
    price_b_ba = out[(locB, booze_ba)]
    price_a_ba = out[(locA, booze_ba)]
    if price_a_ba <= price_b_ba + profit_min:
        price_a_ba = min(2000, price_b_ba + profit_min + (idx % 60))
        out[(locA, booze_ba)] = price_a_ba
    mult = get_booze_listed_price_mult()
    if mult < 1.0:
        for k in list(out.keys()):
            out[k] = max(100, min(2000, int(round(out[k] * mult))))
    return out


def _effective_jail_chance_bounds() -> tuple[float, float]:
    """Current buy/sell bust probability range (uniform roll per leg)."""
    lo = BOOZE_RUN_JAIL_CHANCE_MIN if _booze_jail_min_override is None else float(_booze_jail_min_override)
    hi = BOOZE_RUN_JAIL_CHANCE_MAX if _booze_jail_max_override is None else float(_booze_jail_max_override)
    lo = max(0.0, min(1.0, lo))
    hi = max(0.0, min(1.0, hi))
    if lo > hi:
        lo, hi = hi, lo
    return lo, hi


def _booze_daily_estimate_rough(capacity: int, prices_map: dict, secs_per_leg: int) -> int:
    if capacity <= 0:
        return 0
    pairs = _booze_city_pairs()
    if not pairs:
        return 0
    idx = _booze_rotation_index()
    locA, locB = pairs[idx % len(pairs)]
    n_booze = len(BOOZE_TYPES)
    best_ab = max(
        prices_map.get((locB, i), 400) - prices_map.get((locA, i), 400)
        for i in range(n_booze)
    )
    best_ba = max(
        prices_map.get((locA, i), 400) - prices_map.get((locB, i), 400)
        for i in range(n_booze)
    )
    profit_per_unit = max(best_ab, best_ba, 1)
    leg = max(1, int(secs_per_leg))
    secs_per_run = 2 * leg
    j_lo, j_hi = _effective_jail_chance_bounds()
    jail_per_action = (j_lo + j_hi) / 2
    jail_per_run = 1 - (1 - jail_per_action) ** 2
    jail_seconds = BOOZE_RUN_JAIL_SECONDS
    expected_secs_per_run = secs_per_run + jail_per_run * jail_seconds
    runs_per_24h = 86400 / expected_secs_per_run
    successful_run_rate = (1 - jail_per_action) ** 2
    profitable_runs = runs_per_24h * successful_run_rate
    return int(profitable_runs * capacity * profit_per_unit * BOOZE_RUN_PROFIT_MULT)


def _booze_prestige_level_clamped(user: Optional[dict]) -> int:
    return max(0, min(5, int((user or {}).get("prestige_level") or 0)))


def _booze_godfather_total_cargo_cap(prestige_level: int) -> int:
    pl = max(0, min(5, int(prestige_level or 0)))
    return int(BOOZE_GODFATHER_TOTAL_CARGO_BY_PRESTIGE[pl])


def _booze_godfather_rank_only_at_top(prestige_level: int) -> int:
    """Rank-only slice at Godfather so max store + family + rank hits the prestige total cap."""
    total = _booze_godfather_total_cargo_cap(prestige_level)
    floor = int(BOOZE_CAPACITY_BASE_RANK1)
    raw = int(total) - int(BOOZE_CAPACITY_BONUS_MAX) - int(FAMILY_PERK_BOOZE_BONUS_CAP)
    return max(floor, raw)


def _booze_rank_base_capacity(rank_id: int, prestige_level: int) -> int:
    floor = int(BOOZE_CAPACITY_BASE_RANK1)
    god_rank_only = _booze_godfather_rank_only_at_top(prestige_level)
    r = max(1, min(int(rank_id or 1), int(GODFATHER_RANK_ID)))
    span = int(GODFATHER_RANK_ID) - 1
    if span <= 0:
        return max(1, floor)
    return floor + int(round((god_rank_only - floor) * (r - 1) / span))


def _booze_user_capacity_sync(current_user: dict, *, family_cargo_bonus: int = 0, vip_pass_car_owned: bool = False) -> int:
    rank_id, _ = get_rank_info(int(current_user.get("rank_points") or 0), user_prestige_rank_mult(current_user))
    pl = _booze_prestige_level_clamped(current_user)
    capacity_from_rank = _booze_rank_base_capacity(rank_id, pl)
    bonus = min(int(current_user.get("booze_capacity_bonus") or 0), BOOZE_CAPACITY_BONUS_MAX)
    fb = max(0, min(FAMILY_PERK_BOOZE_BONUS_CAP, int(family_cargo_bonus or 0)))
    subtotal = capacity_from_rank + bonus + fb
    cap_total = _booze_godfather_total_cargo_cap(pl)
    subtotal = min(int(subtotal), int(cap_total))
    subtotal = max(1, subtotal)
    if current_user.get("completed_it_booze_capacity"):
        subtotal = min(int(cap_total) * 2, int(subtotal) * 2)
    # VIP Pass car: +50% cargo while owned. Apply after other caps so the perk is real even at
    # Godfather max (do not re-clamp to cap_total — that made VIP a no-op for maxed accounts).
    if vip_pass_car_owned:
        subtotal = max(1, int(subtotal * 1.5))
    return int(subtotal)


def _booze_user_capacity(current_user: dict, *, family_cargo_bonus: int = 0, vip_pass_car_owned: bool = False) -> int:
    return _booze_user_capacity_sync(
        current_user,
        family_cargo_bonus=family_cargo_bonus,
        vip_pass_car_owned=vip_pass_car_owned,
    )


async def _booze_vip_pass_car_owned(db, user_id: str) -> bool:
    from utils.game_pass_vip_car import user_owns_game_pass_vip_car

    return await user_owns_game_pass_vip_car(db, user_id or "")


async def _family_booze_cargo_extra(family_id) -> int:
    if not family_id:
        return 0
    rpm = await family_perk_modifiers(db, str(family_id).strip())
    return max(0, min(FAMILY_PERK_BOOZE_BONUS_CAP, int(rpm.get("booze_cargo_bonus") or 0)))


def _booze_carrying_dict(raw) -> dict:
    """Normalize booze_carrying to canonical booze_id -> int amounts."""
    if not isinstance(raw, dict):
        return {}
    out: dict = {}
    name_to_id = {b["name"].lower(): b["id"] for b in BOOZE_TYPES}
    id_set = {b["id"] for b in BOOZE_TYPES}
    for k, v in raw.items():
        key = str(k).strip()
        if not key:
            continue
        try:
            amt = int(v or 0)
        except (TypeError, ValueError):
            continue
        if amt <= 0:
            continue
        bid = key if key in id_set else name_to_id.get(key.lower())
        if not bid:
            continue
        out[bid] = out.get(bid, 0) + amt
    return out


def _booze_carrying_amount(carrying: dict, booze_id: str) -> int:
    return int(_booze_carrying_dict(carrying).get(booze_id, 0))


def _booze_user_carrying_total(carrying) -> int:
    return sum(_booze_carrying_dict(carrying).values())


async def _booze_reload_user_trade_state(user: dict) -> dict:
    """Fresh booze inventory from DB (avoids stale auth snapshot / worker cache drift)."""
    uid = (user or {}).get("id")
    if not uid:
        return user
    fresh = await db.users.find_one(
        {"id": uid},
        {
            "_id": 0,
            "booze_carrying": 1,
            "booze_carrying_cost": 1,
            "booze_buy_location": 1,
            "booze_run_rp_granted": 1,
            "current_state": 1,
            "money": 1,
            "in_jail": 1,
            "jail_until": 1,
            "booze_until": 1,
            "booze_profit_today": 1,
            "booze_profit_today_date": 1,
            "booze_profit_total": 1,
            "booze_runs_count": 1,
            "booze_run_history": 1,
            "username": 1,
            "family_id": 1,
            "booze_capacity_bonus": 1,
            "rank_points": 1,
            "prestige_level": 1,
            "referred_by": 1,
            # Badge tiers for sell-path badge_bonuses_from_user (no extra DB round-trip).
            "total_crimes": 1,
            "total_gta": 1,
            "jail_busts": 1,
            "total_kills": 1,
            "total_oc_heists": 1,
            "bullets_melted": 1,
            "hitlist_npc_kills": 1,
            "robot_bodyguard_kills": 1,
            "total_kills_excludes_npc_v1": 1,
        },
    )
    if not fresh:
        return user
    return {**user, **fresh}


def _booze_overlay_live_config(payload: dict, current_user: dict, prices_map: dict) -> dict:
    """Merge per-user inventory/stats into a cached config payload (carrying must never be stale)."""
    out = dict(payload)
    current_state = current_user.get("current_state", STATES[0] if STATES else "")
    loc_index = STATES.index(current_state) if current_state in STATES else 0
    carrying = _booze_carrying_dict(current_user.get("booze_carrying"))
    booze_until = _parse_iso_datetime(current_user.get("booze_until"))
    booze_boost_active = bool(booze_until and datetime.now(timezone.utc) < booze_until)

    def _buy_price(listed: int) -> int:
        return max(1, int(listed * 0.9)) if booze_boost_active else listed

    prices_at_location = []
    for i, bt in enumerate(BOOZE_TYPES):
        listed = prices_map.get((loc_index, i), 400)
        prices_at_location.append({
            "booze_id": bt["id"],
            "name": bt["name"],
            "buy_price": _buy_price(listed),
            "sell_price": listed,
            "carrying": int(carrying.get(bt["id"], 0)),
        })
    today_utc = game_today_date_str()
    profit_today = current_user.get("booze_profit_today", 0)
    profit_today_date = current_user.get("booze_profit_today_date")
    if profit_today_date != today_utc:
        profit_today = 0
    out.update({
        "current_location": current_state,
        "prices_at_location": prices_at_location,
        "carrying": carrying,
        "booze_buy_location": dict(current_user.get("booze_buy_location") or {}),
        "carrying_total": _booze_user_carrying_total(carrying),
        "profit_today": profit_today,
        "profit_total": current_user.get("booze_profit_total", 0),
        "runs_count": current_user.get("booze_runs_count", 0),
        "history": (current_user.get("booze_run_history") or [])[:BOOZE_RUN_HISTORY_MAX],
        "booze_boost_active": booze_boost_active,
    })
    return out


async def _booze_top_profit_leader_ids_cached() -> frozenset[str]:
    """User ids ranked #1–#3 by booze_run_profit_total among real runners (excl. staff), for server-side tuning only."""
    global _booze_top_profit_leader_cache_until, _booze_top_profit_leader_cache_ids
    now = time.monotonic()
    if now < _booze_top_profit_leader_cache_until and _booze_top_profit_leader_cache_ids:
        return _booze_top_profit_leader_cache_ids
    match = {
        "is_npc": {"$ne": True},
        "$or": [{"booze_runs_count": {"$gt": 0}}, {"booze_jail_count": {"$gt": 0}}],
        **(await staff_exclude_users_match()),
    }
    cursor = (
        db.users.find(match, {"_id": 0, "id": 1})
        .sort("booze_run_profit_total", -1)
        .limit(BOOZE_TOP_PROFIT_LEADER_COUNT)
    )
    rows = await cursor.to_list(BOOZE_TOP_PROFIT_LEADER_COUNT)
    ids = frozenset((r.get("id") or "").strip() for r in rows if (r.get("id") or "").strip())
    _booze_top_profit_leader_cache_ids = ids
    _booze_top_profit_leader_cache_until = now + BOOZE_TOP_PROFIT_LEADER_CACHE_SEC
    return ids


async def _booze_roll_jail(user_id: str) -> bool:
    """Single buy or sell leg: True = caught (jail)."""
    lo, hi = _effective_jail_chance_bounds()
    jail_chance = _rng.uniform(lo, hi)
    uid = (user_id or "").strip()
    if uid:
        try:
            if uid in await _booze_top_profit_leader_ids_cached():
                jail_chance = min(BOOZE_TOP_LEADER_JAIL_CHANCE_CAP, jail_chance + BOOZE_TOP_LEADER_JAIL_BONUS)
        except Exception:
            pass
    return _rng.random() < jail_chance


def _booze_user_in_jail(user: dict) -> bool:
    if not user.get("in_jail"):
        return False
    jail_until = _parse_iso_datetime(user.get("jail_until"))
    if not jail_until:
        return False
    return jail_until > datetime.now(timezone.utc)


def _booze_confiscation_profit_updates(user: dict) -> tuple[dict, dict, int]:
    """When inventory is seized (jail), subtract carrying cost basis from profit stats (same fields as successful runs)."""
    carrying_cost = dict(user.get("booze_carrying_cost") or {})
    total = sum(int(v) for v in carrying_cost.values())
    if total <= 0:
        return {}, {}, 0
    today_utc = game_today_date_str()
    profit_today = int(user.get("booze_profit_today") or 0)
    if user.get("booze_profit_today_date") != today_utc:
        profit_today = 0
    inc: dict = {
        "booze_profit_total": -total,
        "booze_run_profit_total": -total,
    }
    for bid, c in carrying_cost.items():
        c = int(c)
        if c:
            inc[f"booze_profit_by_type.{bid}"] = -c
    set_doc = {
        "booze_profit_today": profit_today - total,
        "booze_profit_today_date": today_utc,
    }
    return inc, set_doc, total


# ----- Models -----
class BoozeBuyRequest(BaseModel):
    booze_id: str
    amount: int


class BoozeSellRequest(BaseModel):
    booze_id: str
    amount: int
    captcha_token: Optional[str] = None


class AdminBoozeRotationRequest(BaseModel):
    seconds: Optional[int] = None


class AdminBoozeJailChanceRequest(BaseModel):
    """Set overrides; omit a field to leave it unchanged. Use reset=true to clear both overrides."""

    reset: bool = False
    jail_chance_min: Optional[float] = None
    jail_chance_max: Optional[float] = None


class AdminBoozeListedPriceRequest(BaseModel):
    """Listed prices: reset=true, or delta_percent_off (nudge current discount), or percent_off / listed_price_mult (absolute)."""

    reset: bool = False
    delta_percent_off: Optional[float] = None
    percent_off: Optional[float] = None
    listed_price_mult: Optional[float] = None


# ----- Internal impls (for auto-rank) -----
async def _booze_buy_impl(user: dict, booze_id: str, amount: int, *, via_auto_rank: bool = False) -> dict:
    """Perform buy for given user (by id). Returns response dict or raises HTTPException. Updates DB."""
    from utils.booze_intake_gate import raise_if_booze_intake_blocked

    user = await _booze_reload_user_trade_state(user)
    raise_if_booze_intake_blocked(user)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if _booze_user_in_jail(user):
        raise HTTPException(status_code=400, detail="You are in jail!")
    booze_ids = [b["id"] for b in BOOZE_TYPES]
    if booze_id not in booze_ids:
        raise HTTPException(status_code=400, detail="Invalid booze type")
    current_state = user.get("current_state", STATES[0] if STATES else "")
    loc_index = STATES.index(current_state) if current_state in STATES else 0
    booze_index = booze_ids.index(booze_id)
    prices_map = _booze_prices_for_rotation()
    price = prices_map.get((loc_index, booze_index), 400)
    base_price = price
    booze_until = _parse_iso_datetime(user.get("booze_until"))
    booze_token_live = bool(booze_until and datetime.now(timezone.utc) < booze_until)
    if booze_token_live:
        price = max(1, int(price * 0.9))
    cost = price * amount
    carrying = _booze_carrying_dict(user.get("booze_carrying"))
    fam_extra = await _family_booze_cargo_extra(user.get("family_id"))
    vip_car = await _booze_vip_pass_car_owned(db, user.get("id") or "")
    capacity = _booze_user_capacity(user, family_cargo_bonus=fam_extra, vip_pass_car_owned=vip_car)
    current_carry = _booze_user_carrying_total(carrying)
    if current_carry + amount > capacity:
        raise HTTPException(status_code=400, detail=f"Over capacity (max {capacity} units)")
    jail_chance = _rng.uniform(BOOZE_RUN_JAIL_CHANCE_MIN, BOOZE_RUN_JAIL_CHANCE_MAX)
    if _rng.random() < jail_chance:
        jail_until = datetime.now(timezone.utc) + timedelta(seconds=BOOZE_RUN_JAIL_SECONDS)
        inc_loss, set_loss, loss_basis = _booze_confiscation_profit_updates(user)
        await db.users.update_one(
            {"id": user["id"]},
            {
                "$set": {
                    "in_jail": True,
                    "jail_until": jail_until.isoformat(),
                    "snitch_attempted_this_term": False,
                    **set_loss,
                },
                "$inc": {"booze_jail_count": 1, **inc_loss},
                "$unset": {"booze_carrying": "", "booze_carrying_cost": ""},
            },
        )
        _invalidate_config_cache(user["id"])
        _bj = {"phase": "buy", "inventory_loss_basis": loss_basis}
        if via_auto_rank:
            _bj["via_auto_rank"] = True
        await log_activity(
            user.get("id", ""),
            user.get("username", ""),
            "booze_jail",
            _bj,
        )
        jail_at = datetime.now(timezone.utc)
        try:
            await db.economy_events.insert_one(
                {
                    "at": jail_at,
                    "type": "booze_run_jail",
                    "user_id": user["id"],
                    "username": user.get("username") or "",
                    "phase": "buy",
                    "inventory_loss_basis": int(loss_basis or 0),
                }
            )
        except Exception:
            pass
        out = {
            "message": "Busted! Prohibition agents got you. You're going to jail.",
            "caught": True,
            "jail_until": jail_until.isoformat(),
            "jail_seconds": BOOZE_RUN_JAIL_SECONDS,
        }
        if loss_basis > 0:
            out["inventory_loss_basis"] = loss_basis
        return out
    booze_name = BOOZE_TYPES[booze_index]["name"]
    history_entry = {
        "at": datetime.now(timezone.utc).isoformat(),
        "action": "buy",
        "booze_name": booze_name,
        "amount": amount,
        "unit_price": price,
        "total": cost,
        "location": current_state,
    }
    result = await db.users.update_one(
        {"id": user["id"], "money": {"$gte": cost}},
        {
            "$inc": {"money": -cost, f"booze_carrying.{booze_id}": amount, f"booze_carrying_cost.{booze_id}": cost},
            "$set": {f"booze_buy_location.{booze_id}": current_state},
            "$unset": {f"booze_run_rp_granted.{booze_id}": ""},
            "$push": {"booze_run_history": {"$each": [history_entry], "$position": 0, "$slice": BOOZE_RUN_HISTORY_MAX}},
        }
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient money")
    if booze_token_live and base_price > price:
        try:
            from utils.token_perk_stats import bump_token_perk_stats
            await bump_token_perk_stats(db, user["id"], "booze", saved_cash=(base_price - price) * amount, uses=1)
        except Exception:
            pass
    new_carrying = carrying.get(booze_id, 0) + amount
    _invalidate_config_cache(user["id"])
    return {"message": f"Purchased {amount} {booze_name}", "new_carrying": new_carrying, "spent": cost}


async def _booze_sell_impl(
    user: dict,
    booze_id: str,
    amount: int,
    *,
    via_auto_rank: bool = False,
    via_distillery_collect: bool = False,
    illegal_business_id: Optional[str] = None,
    distillery_cash_mult: float = 1.0,
) -> dict:
    """Perform sell for given user. Returns response dict or raises HTTPException. Updates DB.

    When ``illegal_business_id`` is set (only with ``via_distillery_collect``), revenue is credited
    to that illegal business vault instead of hand ``money``.
    """
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    user = await _booze_reload_user_trade_state(user)
    ib_vault_id = (illegal_business_id or "").strip() or None
    if ib_vault_id and not via_distillery_collect:
        raise HTTPException(status_code=400, detail="Racket vault payout is only valid for distillery collect sells.")
    if _booze_user_in_jail(user):
        raise HTTPException(status_code=400, detail="You are in jail!")
    booze_ids = [b["id"] for b in BOOZE_TYPES]
    if booze_id not in booze_ids:
        raise HTTPException(status_code=400, detail="Invalid booze type")
    current_state = user.get("current_state", STATES[0] if STATES else "")
    loc_index = STATES.index(current_state) if current_state in STATES else 0
    booze_index = booze_ids.index(booze_id)
    prices_map = _booze_prices_for_rotation()
    price = prices_map.get((loc_index, booze_index), 400)
    carrying = _booze_carrying_dict(user.get("booze_carrying"))
    carrying_cost = dict(user.get("booze_carrying_cost") or {})
    have = _booze_carrying_amount(carrying, booze_id)
    if have < amount:
        total_loaded = _booze_user_carrying_total(carrying)
        if total_loaded > 0 and have == 0:
            raise HTTPException(
                status_code=400,
                detail=f"Only carrying 0 units of this liquor ({total_loaded} total loaded — refresh the page)",
            )
        raise HTTPException(status_code=400, detail=f"Only carrying {have} units")
    if await _booze_roll_jail(user.get("id", "")):
        jail_until = datetime.now(timezone.utc) + timedelta(seconds=BOOZE_RUN_JAIL_SECONDS)
        inc_loss, set_loss, loss_basis = _booze_confiscation_profit_updates(user)
        await db.users.update_one(
            {"id": user["id"]},
            {
                "$set": {
                    "in_jail": True,
                    "jail_until": jail_until.isoformat(),
                    "snitch_attempted_this_term": False,
                    **set_loss,
                },
                "$inc": {"booze_jail_count": 1, **inc_loss},
                "$unset": {"booze_carrying": "", "booze_carrying_cost": ""},
            },
        )
        _invalidate_config_cache(user["id"])
        _bj = {"phase": "sell", "inventory_loss_basis": loss_basis}
        if via_auto_rank:
            _bj["via_auto_rank"] = True
        if via_distillery_collect:
            _bj["via_distillery_collect"] = True
        jail_at = datetime.now(timezone.utc)
        uid_jail = user.get("id", "")
        uname_jail = user.get("username", "")
        loss_basis_i = int(loss_basis or 0)

        async def _post_jail_bookkeeping():
            await log_activity(uid_jail, uname_jail, "booze_jail", _bj)
            try:
                await db.economy_events.insert_one(
                    {
                        "at": jail_at,
                        "type": "booze_run_jail",
                        "user_id": uid_jail,
                        "username": uname_jail or "",
                        "phase": "sell",
                        "inventory_loss_basis": loss_basis_i,
                    }
                )
            except Exception:
                pass

        _spawn_booze_bookkeeping(uid_jail, _post_jail_bookkeeping)
        out = {
            "message": "Busted! Prohibition agents got you. You're going to jail.",
            "caught": True,
            "jail_until": jail_until.isoformat(),
            "jail_seconds": BOOZE_RUN_JAIL_SECONDS,
            "booze_id": booze_id,
            "new_carrying": 0,
            "carrying_cleared": True,
        }
        if loss_basis > 0:
            out["inventory_loss_basis"] = loss_basis
        return out
    revenue = price * amount
    total_cost_stored = int(carrying_cost.get(booze_id, 0))
    cost_of_sold = (total_cost_stored * amount // have) if have else 0
    profit = revenue - cost_of_sold
    # Badge bonus: 0.1% per booze runs badge (applied when is_run); prestige: 0.5% boost per level
    buy_location = (user.get("booze_buy_location") or {}).get(booze_id)
    is_run = buy_location is not None and buy_location != current_state
    if is_run:
        try:
            from routers.game.achievements import badge_bonuses_from_user
            bb = badge_bonuses_from_user(user)
            profit = int(profit * (1 + bb.get("booze_runs", 0) * 0.001) * bb.get("prestige_badge_mult", 1))
        except Exception:
            pass
        profit = max(0, int(profit * BOOZE_RUN_PROFIT_MULT))
        revenue = cost_of_sold + profit
    if via_distillery_collect and distillery_cash_mult > 1.0:
        revenue = int(revenue * distillery_cash_mult)
    new_val = have - amount
    booze_name = BOOZE_TYPES[booze_index]["name"]
    today_utc = game_today_date_str()
    profit_today = user.get("booze_profit_today", 0)
    profit_today_date = user.get("booze_profit_today_date")
    if profit_today_date != today_utc:
        profit_today = 0
    history_entry = {
        "at": datetime.now(timezone.utc).isoformat(),
        "action": "sell",
        "booze_name": booze_name,
        "amount": amount,
        "unit_price": price,
        "total": revenue,
        "profit": profit if is_run else None,
        "location": current_state,
        "is_run": is_run,
    }
    if ib_vault_id:
        history_entry["racket_vault"] = True
    inc_user: Dict[str, Any] = {}
    if not ib_vault_id:
        inc_user["money"] = int(revenue)
    if is_run:
        inc_user["booze_profit_total"] = profit
        inc_user["booze_run_profit_total"] = profit
        inc_user["booze_runs_count"] = 1
        inc_user[f"booze_profit_by_type.{booze_id}"] = profit
    push_hist = {"$each": [history_entry], "$position": 0, "$slice": BOOZE_RUN_HISTORY_MAX}
    set_fields: Dict[str, Any] = {}
    unset_fields: Dict[str, Any] = {}
    if is_run:
        set_fields["booze_profit_today_date"] = today_utc
        if profit_today_date != today_utc:
            set_fields["booze_profit_today"] = profit
        else:
            inc_user["booze_profit_today"] = profit
    # Trip RP once per cargo batch (buy city ≠ sell city); same-city / repeat partial sells = 0
    rp_granted = 0
    rp_before = 0
    granted_map = user.get("booze_run_rp_granted") or {}
    already_rp = bool(granted_map.get(booze_id)) if isinstance(granted_map, dict) else False
    if is_run and not already_rp:
        rp_granted = int(BOOZE_RUN_TRIP_RANK_POINTS)
        inc_user["rank_points"] = rp_granted
        set_fields[f"booze_run_rp_granted.{booze_id}"] = True
        try:
            rp_before = int(user.get("rank_points") or 0)
        except (TypeError, ValueError):
            rp_before = 0
    if new_val == 0:
        unset_fields.update({
            f"booze_carrying.{booze_id}": "",
            f"booze_carrying_cost.{booze_id}": "",
            f"booze_buy_location.{booze_id}": "",
            f"booze_run_rp_granted.{booze_id}": "",
        })
        updates: Dict[str, Any] = {
            "$push": {"booze_run_history": push_hist},
            "$unset": unset_fields,
        }
        if inc_user:
            updates["$inc"] = inc_user
        if set_fields:
            # Don't leave grant flag set if we're clearing the batch
            set_fields.pop(f"booze_run_rp_granted.{booze_id}", None)
            if set_fields:
                updates["$set"] = set_fields
    else:
        inc_user[f"booze_carrying.{booze_id}"] = -amount
        inc_user[f"booze_carrying_cost.{booze_id}"] = -cost_of_sold
        updates = {"$push": {"booze_run_history": push_hist}, "$inc": inc_user}
        if set_fields:
            updates["$set"] = set_fields
    if rp_granted > 0:
        from utils.game_pass_season_rp import apply_season_rp_mirror_to_update, rank_points_in_update
        updates = apply_season_rp_mirror_to_update(updates, user=user)
        try:
            rp_awarded = int(rank_points_in_update(updates)) or rp_granted
        except Exception:
            rp_awarded = rp_granted
    else:
        rp_awarded = 0
    sell_result = await db.users.update_one(
        {"id": user["id"], f"booze_carrying.{booze_id}": {"$gte": amount}},
        updates,
    )
    if sell_result.modified_count == 0:
        raise HTTPException(status_code=400, detail=f"Insufficient booze to sell")
    if ib_vault_id:
        biz_res = await db.illegal_businesses.update_one(
            {"id": ib_vault_id, "user_id": user.get("id")},
            {"$inc": {"vault": int(revenue), "vault_lifetime_earned": max(0, int(revenue))}},
        )
        if biz_res.modified_count == 0:
            logger.warning(
                "booze_sell racket vault credit failed; crediting hand cash instead (business %s user %s)",
                ib_vault_id,
                user.get("id"),
            )
            await db.users.update_one({"id": user["id"]}, {"$inc": {"money": int(revenue)}})
    _invalidate_config_cache(user["id"])
    _bs = {"booze": booze_name, "amount": amount, "revenue": revenue, "profit": profit}
    if rp_awarded > 0:
        _bs["rank_points"] = rp_awarded
    if via_auto_rank:
        _bs["via_auto_rank"] = True
    if via_distillery_collect:
        _bs["via_distillery_collect"] = True
    if ib_vault_id:
        _bs["illegal_business_id"] = ib_vault_id
    uid_sell = user.get("id", "")
    uname_sell = user.get("username", "")
    ref_ids = normalize_referred_by_ids(user.get("referred_by"))
    booze_event_at = datetime.now(timezone.utc)

    async def _post_sell_bookkeeping():
        await log_activity(uid_sell, uname_sell, "booze_sell", _bs)
        if rp_awarded > 0:
            try:
                from server import maybe_process_rank_up

                await maybe_process_rank_up(
                    uid_sell,
                    rp_before,
                    rp_awarded,
                    uname_sell,
                    user_prestige_rank_mult(user),
                )
            except Exception:
                logger.exception("Rank-up notification (booze run): %s", uid_sell)
        if not is_run:
            return
        booze_event_result = await db.economy_events.insert_one({
            "at": booze_event_at,
            "type": "booze_run_sell",
            "user_id": uid_sell,
            "username": uname_sell or "",
            "booze_id": booze_id,
            "booze_name": booze_name,
            "amount": amount,
            "revenue": revenue,
            "profit": profit,
        })
        try:
            from utils.family_daily_tasks import record_family_daily_activity

            await record_family_daily_activity(
                db,
                uid_sell,
                "booze_run",
                source_id=f"booze-run:{booze_event_result.inserted_id}",
                now=booze_event_at,
            )
        except Exception:
            logger.exception("Family daily booze progress failed user_id=%s", uid_sell)
        try:
            from routers.account.objectives import update_objectives_progress
            await update_objectives_progress(uid_sell, "booze_runs", 1)
        except Exception:
            pass
        if ref_ids and profit > 0:
            pool = referral_pool_int(profit, 0.10)
            for rid, amt in split_referral_pool(pool, ref_ids, self_id=uid_sell):
                if amt > 0:
                    await apply_referrer_referral_increment(
                        db, rid, {"money": amt, "referral_earnings_booze": amt}, context="booze_run"
                    )

    _spawn_booze_bookkeeping(uid_sell, _post_sell_bookkeeping)
    carrying_total = _booze_user_carrying_total(carrying) - amount
    return {
        "message": f"Sold {amount} {booze_name}",
        "revenue": revenue,
        "profit": profit,
        "new_carrying": new_val,
        "booze_id": booze_id,
        "carrying_total": max(0, int(carrying_total)),
        "is_run": is_run,
        "rank_points_earned": int(rp_awarded) if rp_awarded else 0,
    }


# ----- Routes -----
async def booze_run_config(current_user: dict = Depends(get_current_user)):
    global _config_cache
    uid = current_user.get("id")
    now = time.monotonic()
    if uid in _config_cache:
        payload, expires = _config_cache[uid]
        if now <= expires:
            prices_map = _booze_prices_for_rotation()
            return _booze_overlay_live_config(payload, current_user, prices_map)

    current_state = current_user.get("current_state", STATES[0] if STATES else "")
    loc_index = STATES.index(current_state) if current_state in STATES else 0
    prices_map = _booze_prices_for_rotation()
    carrying = _booze_carrying_dict(current_user.get("booze_carrying"))
    rank_id, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
    pl = _booze_prestige_level_clamped(current_user)
    godfather_total_cap = _booze_godfather_total_cargo_cap(pl)
    godfather_rank_only = _booze_godfather_rank_only_at_top(pl)
    capacity_from_rank = _booze_rank_base_capacity(rank_id, pl)
    rank_span = max(1, int(GODFATHER_RANK_ID) - 1)
    capacity_extra_per_rank_display = int(
        round((godfather_rank_only - int(BOOZE_CAPACITY_BASE_RANK1)) / rank_span)
    )
    fam_extra = await _family_booze_cargo_extra(current_user.get("family_id"))
    vip_car = await _booze_vip_pass_car_owned(db, uid or "")
    capacity = _booze_user_capacity(current_user, family_cargo_bonus=fam_extra, vip_pass_car_owned=vip_car)
    booze_until = _parse_iso_datetime(current_user.get("booze_until"))
    booze_boost_active = bool(booze_until and datetime.now(timezone.utc) < booze_until)

    def _buy_price(listed: int) -> int:
        return max(1, int(listed * 0.9)) if booze_boost_active else listed

    prices_at_location = []
    for i, bt in enumerate(BOOZE_TYPES):
        listed = prices_map.get((loc_index, i), 400)
        prices_at_location.append({
            "booze_id": bt["id"],
            "name": bt["name"],
            "buy_price": _buy_price(listed),
            "sell_price": listed,
            "carrying": int(carrying.get(bt["id"], 0)),
        })
    all_prices = {}
    for loc_i, state in enumerate(STATES):
        all_prices[state] = [
            {
                "booze_id": BOOZE_TYPES[b]["id"],
                "name": BOOZE_TYPES[b]["name"],
                "buy_price": _buy_price(prices_map.get((loc_i, b), 400)),
                "sell_price": prices_map.get((loc_i, b), 400),
            }
            for b in range(len(BOOZE_TYPES))
        ]
    today_utc = game_today_date_str()
    profit_today = current_user.get("booze_profit_today", 0)
    profit_today_date = current_user.get("booze_profit_today_date")
    if profit_today_date != today_utc:
        profit_today = 0
    profit_total = current_user.get("booze_profit_total", 0)
    runs_count = current_user.get("booze_runs_count", 0)
    history = (current_user.get("booze_run_history") or [])[:BOOZE_RUN_HISTORY_MAX]
    capacity_bonus = min(current_user.get("booze_capacity_bonus", 0), BOOZE_CAPACITY_BONUS_MAX)
    from routers.account.auto_rank import booze_travel_leg_info

    travel_info = await booze_travel_leg_info(db, uid)
    travel_leg_sec = int(travel_info.get("seconds") or 45)
    travel_car_name = travel_info.get("car_name")
    daily_estimate_rough = _booze_daily_estimate_rough(capacity, prices_map, travel_leg_sec)

    _lpm = get_booze_listed_price_mult()
    payload = {
        "locations": list(STATES),
        "booze_types": list(BOOZE_TYPES),
        "current_location": current_state,
        "prices_at_location": prices_at_location,
        "all_prices_by_location": all_prices,
        "carrying": carrying,
        "booze_buy_location": dict(current_user.get("booze_buy_location") or {}),
        "capacity": capacity,
        "capacity_from_rank": capacity_from_rank,
        "prestige_level": pl,
        "cargo_godfather_cap": godfather_total_cap,
        "cargo_godfather_rank_only": godfather_rank_only,
        "cargo_rank_min": BOOZE_CAPACITY_BASE_RANK1,
        "cargo_derived_absolute_max": godfather_total_cap,
        "capacity_extra_per_rank": capacity_extra_per_rank_display,
        "capacity_bonus": capacity_bonus,
        "capacity_bonus_max": BOOZE_CAPACITY_BONUS_MAX,
        "family_cargo_bonus": fam_extra,
        "vip_pass_car_bonus": vip_car,
        "carrying_total": _booze_user_carrying_total(carrying),
        "listed_price_global_mult": _lpm,
        "listed_price_global_percent_off": round((1.0 - _lpm) * 100.0, 2) if _lpm < 1.0 else 0.0,
        "rotation_ends_at": _booze_rotation_ends_at(),
        "rotation_hours": BOOZE_ROTATION_HOURS,
        "rotation_seconds": _booze_rotation_override_seconds,
        "round_trip_cities": _booze_round_trip_cities(),
        "profit_today": profit_today,
        "profit_total": profit_total,
        "runs_count": runs_count,
        "history": history,
        "daily_estimate_rough": daily_estimate_rough,
        "travel_leg_seconds": travel_leg_sec,
        "travel_car_name": travel_car_name,
        "booze_boost_active": booze_boost_active,
    }
    if len(_config_cache) >= _CONFIG_MAX_ENTRIES:
        oldest = next(iter(_config_cache))
        _config_cache.pop(oldest, None)
    _config_cache[uid] = (payload, now + _CONFIG_TTL_SEC)
    return payload


async def booze_run_buy(request: BoozeBuyRequest, current_user: dict = Depends(get_current_user)):
    return await _booze_buy_impl(current_user, request.booze_id, request.amount)


async def booze_run_sell(
    body: BoozeSellRequest,
    http_request: Request,
    current_user: dict = Depends(get_current_user),
):
    await require_turnstile_for_game_action(
        db,
        request=http_request,
        current_user=current_user,
        captcha_token=body.captcha_token,
        is_admin=_is_admin(current_user),
    )
    return await _booze_sell_impl(current_user, body.booze_id, body.amount)


async def booze_run_skip_run(current_user: dict = Depends(get_current_user)):
    """One-tap best-profit booze run: picks the most profitable direction on this rotation's
    route, drives there instantly (1 skip credit per drive; tokens auto-activate when credits
    run out), buys the best-margin booze, skips the drive back, and sells everything.
    Bust risk applies at every phase, same as a manual run."""
    from utils.cooldown_skip import (
        has_skip_credit,
        consume_skip_credit,
        can_activate_cooldown_skip_token,
        activation_inc_fields,
    )
    from utils.booze_intake_gate import raise_if_booze_intake_blocked
    from routers.account.auto_rank import _get_travel_method
    from routers.admin.airport import _start_travel_impl

    uid = current_user.get("id") or ""
    user = await db.users.find_one({"id": uid}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    raise_if_booze_intake_blocked(user)
    if _booze_user_in_jail(user):
        raise HTTPException(status_code=400, detail="You are in jail!")

    now = datetime.now(timezone.utc)
    steps: list = []
    credits_used = 0

    async def _ensure_skip_credit() -> bool:
        """True when a credit is available, auto-activating a held token if needed (daily cap applies)."""
        nonlocal user
        if has_skip_credit(user, "booze"):
            return True
        if int(user.get("cooldown_skip_booze_tokens") or 0) < 1:
            return False
        if not can_activate_cooldown_skip_token(user, "booze"):
            return False
        inc, set_doc = activation_inc_fields("booze", user)
        inc["cooldown_skip_booze_tokens"] = -1
        r = await db.users.update_one(
            {"id": uid, "cooldown_skip_booze_tokens": {"$gte": 1}},
            {"$inc": inc, "$set": set_doc},
        )
        if r.modified_count != 1:
            return False
        user = await db.users.find_one({"id": uid}, {"_id": 0})
        return has_skip_credit(user, "booze")

    async def _arrive_now(dest_state: str):
        await db.users.update_one(
            {"id": uid},
            {"$set": {"current_state": dest_state}, "$unset": {"traveling_to": "", "travel_arrives_at": ""}},
        )

    async def _skip_drive_to(dest_city: str):
        """Start a real booze-run travel (car checks, damage, casino blocks) then fast-forward it."""
        nonlocal user, credits_used
        if not await _ensure_skip_credit():
            raise HTTPException(
                status_code=400,
                detail="Out of Booze Travel Skip tokens/credits (or you hit the daily cap).",
            )
        travel_method = await _get_travel_method(db, uid)
        if not travel_method:
            raise HTTPException(status_code=400, detail="You need a working car to run booze.")
        await _start_travel_impl(user, dest_city, travel_method, airport_slot=None, booze_run=True)
        if not await consume_skip_credit(db, uid, "booze"):
            raise HTTPException(
                status_code=400,
                detail="Skip credit was used up — travel started normally, wait for arrival.",
            )
        credits_used += 1
        await _arrive_now(dest_city)
        steps.append(f"Skipped the drive to {dest_city}")
        user = await db.users.find_one({"id": uid}, {"_id": 0})

    # Resolve any pending travel first: overdue legs land for free, active legs cost a credit.
    if user.get("travel_arrives_at") and user.get("traveling_to"):
        arrives = _parse_iso_datetime(user.get("travel_arrives_at"))
        if arrives and now < arrives:
            if not await _ensure_skip_credit() or not await consume_skip_credit(db, uid, "booze"):
                raise HTTPException(
                    status_code=400,
                    detail="You're mid-travel and out of skip tokens/credits.",
                )
            credits_used += 1
            steps.append(f"Skipped the current drive to {user['traveling_to']}")
        await _arrive_now(user["traveling_to"])
        user = await db.users.find_one({"id": uid}, {"_id": 0})

    round_trip = _booze_round_trip_cities()
    if not round_trip or len(round_trip) != 2:
        raise HTTPException(status_code=400, detail="No booze route available right now.")
    city_a, city_b = round_trip
    current_state = (user.get("current_state") or "").strip()
    prices = _booze_prices_for_rotation()

    def _best_margin(buy_city: str, sell_city: str):
        """(margin, booze, buy_price) for the best booze on buy_city -> sell_city."""
        bi_ = STATES.index(buy_city) if buy_city in STATES else 0
        si_ = STATES.index(sell_city) if sell_city in STATES else 0
        best = None
        for booze_i, booze in enumerate(BOOZE_TYPES):
            buy_p = int(prices.get((bi_, booze_i), 400))
            margin = int(prices.get((si_, booze_i), 400)) - buy_p
            if best is None or margin > best[0]:
                best = (margin, booze, buy_p)
        return best

    def _cargo_value_at(city: str, cargo: dict) -> int:
        ci = STATES.index(city) if city in STATES else 0
        booze_ids = [b["id"] for b in BOOZE_TYPES]
        return sum(
            int(prices.get((ci, booze_ids.index(bid)), 400)) * int(amt or 0)
            for bid, amt in cargo.items()
            if bid in booze_ids
        )

    carrying = _booze_carrying_dict(user.get("booze_carrying"))
    spent = 0
    bought_label = None
    if _booze_user_carrying_total(carrying) > 0:
        # Already loaded from an earlier leg: just sell wherever the cargo is worth more.
        sell_city = city_a if _cargo_value_at(city_a, carrying) >= _cargo_value_at(city_b, carrying) else city_b
        steps.append("Already carrying cargo — selling it at the better city")
    else:
        # Pick the most profitable direction; tie-break to the one starting where we already are.
        best_ab = _best_margin(city_a, city_b)
        best_ba = _best_margin(city_b, city_a)
        candidates = []
        if best_ab and best_ab[0] > 0:
            candidates.append((best_ab[0], 1 if current_state == city_a else 0, city_a, city_b, best_ab[1], best_ab[2]))
        if best_ba and best_ba[0] > 0:
            candidates.append((best_ba[0], 1 if current_state == city_b else 0, city_b, city_a, best_ba[1], best_ba[2]))
        if not candidates:
            raise HTTPException(status_code=400, detail="No profitable route right now — wait for the next rotation.")
        candidates.sort(reverse=True)
        _, _, buy_city, sell_city, booze, buy_price = candidates[0]

        if current_state != buy_city:
            await _skip_drive_to(buy_city)
            current_state = buy_city

        fam_extra = await _family_booze_cargo_extra(user.get("family_id"))
        vip_car = await _booze_vip_pass_car_owned(db, uid)
        capacity = _booze_user_capacity(user, family_cargo_bonus=fam_extra, vip_pass_car_owned=vip_car)
        amount = min(int(capacity), int(user.get("money") or 0) // max(1, buy_price))
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Not enough cash (or cargo space) to buy booze.")
        buy_res = await _booze_buy_impl(user, booze["id"], amount)
        if buy_res.get("caught"):
            return {**buy_res, "phase": "buy", "steps": steps, "credits_used": credits_used}
        spent = int(buy_res.get("spent") or 0)
        bought_label = f"{amount} {booze['name']}"
        steps.append(f"Bought {bought_label} in {buy_city} for ${spent:,}")
        user = await db.users.find_one({"id": uid}, {"_id": 0})

    if (user.get("current_state") or "").strip() != sell_city:
        await _skip_drive_to(sell_city)

    # Sell phase: everything in the trunk, one booze type at a time.
    carrying = _booze_carrying_dict(user.get("booze_carrying"))
    total_revenue = 0
    total_profit = 0
    total_rp = 0
    sold_units = 0
    for booze in BOOZE_TYPES:
        amt = int(carrying.get(booze["id"]) or 0)
        if amt <= 0:
            continue
        sell_res = await _booze_sell_impl(user, booze["id"], amt)
        if sell_res.get("caught"):
            return {**sell_res, "phase": "sell", "steps": steps, "credits_used": credits_used}
        total_revenue += int(sell_res.get("revenue") or 0)
        total_profit += int(sell_res.get("profit") or 0)
        total_rp += int(sell_res.get("rank_points_earned") or 0)
        sold_units += amt
        user = await db.users.find_one({"id": uid}, {"_id": 0}) or user
    if sold_units:
        steps.append(f"Sold {sold_units} units in {sell_city} for ${total_revenue:,}")
        if total_rp > 0:
            steps.append(f"+{total_rp} rank points")
    _invalidate_config_cache(uid)
    # Lifetime earnings for the My Inventory token card.
    try:
        from utils.token_perk_stats import bump_token_perk_stats
        await bump_token_perk_stats(
            db, uid, "cooldown_skip_booze",
            profit_cash=total_profit, runs=1, uses=credits_used,
        )
    except Exception:
        pass
    await log_activity(uid, user.get("username", ""), "booze_skip_run", {
        "bought": bought_label, "sold_units": sold_units, "revenue": total_revenue,
        "profit": total_profit, "credits_used": credits_used, "sell_city": sell_city,
        "rank_points": total_rp,
    })
    return {
        "success": True,
        "caught": False,
        "message": f"Run complete — sold {sold_units} units in {sell_city} (+${total_profit:,} profit)",
        "steps": steps,
        "spent": spent,
        "revenue": total_revenue,
        "profit": total_profit,
        "credits_used": credits_used,
        "location": sell_city,
        "rank_points_earned": total_rp,
    }


async def buy_booze_capacity(current_user: dict = Depends(get_current_user)):
    if int(current_user.get("points") or 0) < BOOZE_CAPACITY_UPGRADE_COST:
        raise HTTPException(status_code=400, detail="Insufficient points")
    current_bonus = min(current_user.get("booze_capacity_bonus", 0), BOOZE_CAPACITY_BONUS_MAX)
    if current_bonus >= BOOZE_CAPACITY_BONUS_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"Booze capacity bonus is already at the maximum ({BOOZE_CAPACITY_BONUS_MAX})",
        )
    add_bonus = min(BOOZE_CAPACITY_UPGRADE_AMOUNT, BOOZE_CAPACITY_BONUS_MAX - current_bonus)
    result = await db.users.update_one(
        {"id": current_user["id"], "points": {"$gte": BOOZE_CAPACITY_UPGRADE_COST}},
        {"$inc": {"points": -BOOZE_CAPACITY_UPGRADE_COST, "booze_capacity_bonus": add_bonus}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await log_points_event(db, user_id=current_user["id"], points=-BOOZE_CAPACITY_UPGRADE_COST, event_type="booze_upgrade", meta={"add_bonus": add_bonus, "new_bonus": current_bonus + add_bonus})
    fam_extra = await _family_booze_cargo_extra(current_user.get("family_id"))
    vip_car = await _booze_vip_pass_car_owned(db, current_user.get("id") or "")
    new_capacity = _booze_user_capacity(
        {**current_user, "booze_capacity_bonus": current_bonus + add_bonus},
        family_cargo_bonus=fam_extra,
        vip_pass_car_owned=vip_car,
    )
    _invalidate_config_cache(current_user["id"])
    return {"message": f"+{add_bonus} booze capacity for {BOOZE_CAPACITY_UPGRADE_COST} points", "new_capacity": new_capacity, "capacity_bonus": current_bonus + add_bonus, "capacity_bonus_max": BOOZE_CAPACITY_BONUS_MAX}


async def admin_get_booze_rotation(current_user: dict = Depends(require_admin)):
    return {"rotation_seconds": _booze_rotation_override_seconds, "normal_hours": BOOZE_ROTATION_HOURS}


async def admin_set_booze_rotation(request: AdminBoozeRotationRequest, current_user: dict = Depends(require_admin)):
    global _booze_rotation_override_seconds
    sec = request.seconds
    if sec is None or sec <= 0:
        _booze_rotation_override_seconds = None
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.game_settings.update_one(
            {"_id": BOOZE_GLOBALS_DOC_ID},
            {
                "$set": {
                    "rotation_seconds": None,
                    "updated_at": now_iso,
                    "key": BOOZE_GLOBALS_DOC_ID,
                }
            },
            upsert=True,
        )
        _invalidate_all_booze_config_cache()
        return {"message": "Booze rotation reset to normal (3 hours)", "rotation_seconds": None}
    if sec < 5 or sec > 86400:
        raise HTTPException(status_code=400, detail="seconds must be between 5 and 86400 (1 day)")
    _booze_rotation_override_seconds = sec
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.game_settings.update_one(
        {"_id": BOOZE_GLOBALS_DOC_ID},
        {
            "$set": {
                "rotation_seconds": sec,
                "updated_at": now_iso,
                "key": BOOZE_GLOBALS_DOC_ID,
            }
        },
        upsert=True,
    )
    _invalidate_all_booze_config_cache()
    return {"message": f"Booze rotation set to {sec} seconds", "rotation_seconds": sec}


async def admin_get_booze_jail_chances(current_user: dict = Depends(require_admin)):
    lo, hi = _effective_jail_chance_bounds()
    return {
        "default_jail_chance_min": BOOZE_RUN_JAIL_CHANCE_MIN,
        "default_jail_chance_max": BOOZE_RUN_JAIL_CHANCE_MAX,
        "effective_jail_chance_min": lo,
        "effective_jail_chance_max": hi,
        "override_jail_chance_min": _booze_jail_min_override,
        "override_jail_chance_max": _booze_jail_max_override,
        "jail_seconds": BOOZE_RUN_JAIL_SECONDS,
        "top_leader_extra_probability": BOOZE_TOP_LEADER_JAIL_BONUS,
        "top_leader_probability_cap_after_extra": BOOZE_TOP_LEADER_JAIL_CHANCE_CAP,
    }


async def admin_get_booze_listed_price(current_user: dict = Depends(require_admin)):
    m = get_booze_listed_price_mult()
    return {
        "listed_price_mult": m,
        "percent_off": round((1.0 - m) * 100.0, 4) if m < 1.0 else 0.0,
        "percent_premium": round((m - 1.0) * 100.0, 4) if m > 1.0 else 0.0,
        "min_mult": BOOZE_LISTED_PRICE_MULT_MIN,
        "max_mult": BOOZE_LISTED_PRICE_MULT_MAX,
    }


async def admin_set_booze_listed_price(request: AdminBoozeListedPriceRequest, current_user: dict = Depends(require_admin)):
    global _booze_listed_price_mult
    if request.reset:
        mult = 1.0
    elif request.delta_percent_off is not None:
        d = float(request.delta_percent_off)
        cur = get_booze_listed_price_mult()
        cur_pct = (1.0 - cur) * 100.0
        new_pct = cur_pct + d
        # Negative percent_off = premium above rotation (e.g. −1 → mult 1.01). Was clamped at 0, so +1% nudge did nothing at full price.
        new_pct = max(-BOOZE_LISTED_PREMIUM_MAX_PCT, min(BOOZE_LISTED_DISCOUNT_MAX_PCT, new_pct))
        mult = 1.0 - new_pct / 100.0
    elif request.percent_off is not None:
        po = float(request.percent_off)
        if po < 0 or po > 99:
            raise HTTPException(status_code=400, detail="percent_off must be between 0 and 99 (100 would zero all prices)")
        mult = 1.0 - po / 100.0
    elif request.listed_price_mult is not None:
        mult = float(request.listed_price_mult)
        if mult < BOOZE_LISTED_PRICE_MULT_MIN or mult > BOOZE_LISTED_PRICE_MULT_MAX:
            raise HTTPException(
                status_code=400,
                detail=f"listed_price_mult must be between {BOOZE_LISTED_PRICE_MULT_MIN} and {BOOZE_LISTED_PRICE_MULT_MAX}",
            )
    else:
        raise HTTPException(
            status_code=400,
            detail="Provide delta_percent_off, percent_off, listed_price_mult, or reset=true",
        )
    mult = max(BOOZE_LISTED_PRICE_MULT_MIN, min(BOOZE_LISTED_PRICE_MULT_MAX, mult))
    _booze_listed_price_mult = mult
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.game_settings.update_one(
        {"_id": BOOZE_GLOBALS_DOC_ID},
        {
            "$set": {
                "listed_price_mult": mult,
                "updated_at": now_iso,
                # Stable key for game_settings (sparse unique index on key allows _id-only docs; this doc is keyed)
                "key": BOOZE_GLOBALS_DOC_ID,
            }
        },
        upsert=True,
    )
    _invalidate_all_booze_config_cache()
    pct_off = round((1.0 - mult) * 100.0, 4) if mult < 1.0 else 0.0
    pct_prem = round((mult - 1.0) * 100.0, 4) if mult > 1.0 else 0.0
    log_extra = {"listed_price_mult": mult, "percent_off": pct_off, "percent_premium": pct_prem}
    if request.delta_percent_off is not None:
        log_extra["delta_percent_off"] = float(request.delta_percent_off)
    await log_activity(
        current_user.get("id", ""),
        current_user.get("username", ""),
        "admin_booze_listed_price",
        log_extra,
    )
    return {
        "message": "Booze listed prices updated (applies to all locations this rotation).",
        "listed_price_mult": mult,
        "percent_off": pct_off,
        "percent_premium": pct_prem,
    }


async def admin_set_booze_jail_chances(request: AdminBoozeJailChanceRequest, current_user: dict = Depends(require_admin)):
    global _booze_jail_min_override, _booze_jail_max_override
    now_iso = datetime.now(timezone.utc).isoformat()
    if request.reset:
        _booze_jail_min_override = None
        _booze_jail_max_override = None
        await db.game_settings.update_one(
            {"_id": BOOZE_GLOBALS_DOC_ID},
            {
                "$set": {
                    "jail_chance_min": None,
                    "jail_chance_max": None,
                    "updated_at": now_iso,
                    "key": BOOZE_GLOBALS_DOC_ID,
                }
            },
            upsert=True,
        )
        lo, hi = _effective_jail_chance_bounds()
        return {
            "message": "Booze jail chance overrides cleared (using code defaults).",
            "effective_jail_chance_min": lo,
            "effective_jail_chance_max": hi,
            "override_jail_chance_min": None,
            "override_jail_chance_max": None,
        }
    if request.jail_chance_min is not None:
        v = float(request.jail_chance_min)
        if v < 0 or v > 1:
            raise HTTPException(status_code=400, detail="jail_chance_min must be between 0 and 1")
        _booze_jail_min_override = v
    if request.jail_chance_max is not None:
        v = float(request.jail_chance_max)
        if v < 0 or v > 1:
            raise HTTPException(status_code=400, detail="jail_chance_max must be between 0 and 1")
        _booze_jail_max_override = v
    lo, hi = _effective_jail_chance_bounds()
    if lo > hi:
        raise HTTPException(status_code=400, detail="jail_chance_min must be <= jail_chance_max")
    await db.game_settings.update_one(
        {"_id": BOOZE_GLOBALS_DOC_ID},
        {
            "$set": {
                "jail_chance_min": _booze_jail_min_override,
                "jail_chance_max": _booze_jail_max_override,
                "updated_at": now_iso,
                "key": BOOZE_GLOBALS_DOC_ID,
            }
        },
        upsert=True,
    )
    return {
        "message": "Booze jail chances updated.",
        "effective_jail_chance_min": lo,
        "effective_jail_chance_max": hi,
        "override_jail_chance_min": _booze_jail_min_override,
        "override_jail_chance_max": _booze_jail_max_override,
    }


def register(router):
    router.add_api_route("/booze-run/config", booze_run_config, methods=["GET"], dependencies=_booze_rl_u)
    router.add_api_route("/booze-run/buy", booze_run_buy, methods=["POST"])
    router.add_api_route("/booze-run/sell", booze_run_sell, methods=["POST"])
    router.add_api_route("/booze-run/skip-run", booze_run_skip_run, methods=["POST"])
    # buy-booze-capacity route is registered in store.py (uses respect-first logic)
    router.add_api_route("/admin/booze-rotation", admin_get_booze_rotation, methods=["GET"])
    router.add_api_route("/admin/booze-rotation", admin_set_booze_rotation, methods=["POST"])
    router.add_api_route("/admin/booze-jail-chances", admin_get_booze_jail_chances, methods=["GET"])
    router.add_api_route("/admin/booze-jail-chances", admin_set_booze_jail_chances, methods=["POST"])
    router.add_api_route("/admin/booze-listed-price", admin_get_booze_listed_price, methods=["GET"])
    router.add_api_route("/admin/booze-listed-price", admin_set_booze_listed_price, methods=["POST"])
