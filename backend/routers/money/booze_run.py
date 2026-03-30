# Booze Run: config, buy, sell, capacity upgrade; rotation helpers for flash news
from datetime import datetime, timezone, timedelta
from typing import Optional
import time
import secrets
_rng = secrets.SystemRandom()
from pydantic import BaseModel

from fastapi import Depends, HTTPException

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
    STATES,
    _is_admin,
    log_activity,
    _staff_exclude_user_filter,
)


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
BOOZE_CAPACITY_EXTRA_PER_RANK = 25
BOOZE_CAPACITY_UPGRADE_COST = 100
BOOZE_CAPACITY_UPGRADE_AMOUNT = 25
BOOZE_CAPACITY_BONUS_MAX = 1000
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

# Per-user cache for GET /booze-run/config
_config_cache: dict = {}
_CONFIG_TTL_SEC = 10
_CONFIG_MAX_ENTRIES = 5000

_booze_top_profit_leader_cache_until: float = 0.0
_booze_top_profit_leader_cache_ids: frozenset[str] = frozenset()

# Admin overrides (None = use BOOZE_RUN_JAIL_CHANCE_MIN / MAX). In-memory like rotation override.
_booze_jail_min_override: Optional[float] = None
_booze_jail_max_override: Optional[float] = None

# Global listed-price multiplier (buy & sell use same listed price before booze token discount on buy).
# Persisted in game_settings _id=booze_run_globals; loaded at server startup.
BOOZE_GLOBALS_DOC_ID = "booze_run_globals"
BOOZE_LISTED_PRICE_MULT_MIN = 0.01  # up to 99% off vs full rotation prices
BOOZE_LISTED_PRICE_MULT_MAX = 1.0
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
    """Restore listed_price_mult after process restart."""
    global _booze_listed_price_mult
    try:
        doc = await db.game_settings.find_one({"_id": BOOZE_GLOBALS_DOC_ID}, {"_id": 0, "listed_price_mult": 1})
        if doc and doc.get("listed_price_mult") is not None:
            _booze_listed_price_mult = float(doc["listed_price_mult"])
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


def _booze_round_trip_cities():
    unordered_pairs = [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)]
    idx = _booze_rotation_index()
    i, j = unordered_pairs[idx % len(unordered_pairs)]
    return [STATES[i], STATES[j]]


def _booze_prices_for_rotation():
    idx = _booze_rotation_index()
    n_locs = 4
    n_booze = len(BOOZE_TYPES)
    out = {}
    for loc_i in range(n_locs):
        for booze_i in range(n_booze):
            base = 200 + (loc_i * 85) + (booze_i * 72) + (idx % 19) * 23
            base += ((idx * 7 + loc_i * 11 + booze_i * 13) % 67) - 33
            price = min(2000, max(100, base))
            out[(loc_i, booze_i)] = price
    unordered_pairs = [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)]
    locA, locB = unordered_pairs[idx % len(unordered_pairs)]
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
    unordered_pairs = [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)]
    idx = _booze_rotation_index()
    locA, locB = unordered_pairs[idx % len(unordered_pairs)]
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


def _booze_user_capacity(current_user: dict) -> int:
    rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
    capacity_from_rank = BOOZE_CAPACITY_BASE_RANK1 + (rank_id - 1) * BOOZE_CAPACITY_EXTRA_PER_RANK
    bonus = min(current_user.get("booze_capacity_bonus", 0), BOOZE_CAPACITY_BONUS_MAX)
    capacity = max(1, capacity_from_rank + bonus)
    # "Completed it" perk: 2x booze capacity
    if current_user.get("completed_it_booze_capacity"):
        capacity = capacity * 2
    return capacity


def _booze_user_carrying_total(carrying: dict) -> int:
    return sum(int(v) for v in (carrying or {}).values())


async def _booze_top_profit_leader_ids_cached() -> frozenset[str]:
    """User ids ranked #1–#3 by booze_run_profit_total among real runners (excl. staff), for server-side tuning only."""
    global _booze_top_profit_leader_cache_until, _booze_top_profit_leader_cache_ids
    now = time.monotonic()
    if now < _booze_top_profit_leader_cache_until and _booze_top_profit_leader_cache_ids:
        return _booze_top_profit_leader_cache_ids
    match = {
        "is_npc": {"$ne": True},
        "$or": [{"booze_runs_count": {"$gt": 0}}, {"booze_jail_count": {"$gt": 0}}],
        **_staff_exclude_user_filter(),
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
    today_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
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
async def _booze_buy_impl(user: dict, booze_id: str, amount: int) -> dict:
    """Perform buy for given user (by id). Returns response dict or raises HTTPException. Updates DB."""
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
    booze_until = _parse_iso_datetime(user.get("booze_until"))
    if booze_until and datetime.now(timezone.utc) < booze_until:
        price = max(1, int(price * 0.9))
    cost = price * amount
    carrying = dict(user.get("booze_carrying") or {})
    capacity = _booze_user_capacity(user)
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
        await log_activity(
            user.get("id", ""),
            user.get("username", ""),
            "booze_jail",
            {"phase": "buy", "inventory_loss_basis": loss_basis},
        )
        jail_at = datetime.now(timezone.utc).isoformat()
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
            "$push": {"booze_run_history": {"$each": [history_entry], "$position": 0, "$slice": BOOZE_RUN_HISTORY_MAX}},
        }
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient money")
    new_carrying = carrying.get(booze_id, 0) + amount
    _invalidate_config_cache(user["id"])
    return {"message": f"Purchased {amount} {booze_name}", "new_carrying": new_carrying, "spent": cost}


async def _booze_sell_impl(user: dict, booze_id: str, amount: int) -> dict:
    """Perform sell for given user. Returns response dict or raises HTTPException. Updates DB."""
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
    carrying = dict(user.get("booze_carrying") or {})
    carrying_cost = dict(user.get("booze_carrying_cost") or {})
    have = int(carrying.get(booze_id, 0))
    if have < amount:
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
        await log_activity(
            user.get("id", ""),
            user.get("username", ""),
            "booze_jail",
            {"phase": "sell", "inventory_loss_basis": loss_basis},
        )
        jail_at = datetime.now(timezone.utc).isoformat()
        try:
            await db.economy_events.insert_one(
                {
                    "at": jail_at,
                    "type": "booze_run_jail",
                    "user_id": user["id"],
                    "username": user.get("username") or "",
                    "phase": "sell",
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
    revenue = price * amount
    total_cost_stored = int(carrying_cost.get(booze_id, 0))
    cost_of_sold = (total_cost_stored * amount // have) if have else 0
    profit = revenue - cost_of_sold
    # Badge bonus: 0.1% per booze runs badge (applied when is_run); prestige: 0.5% boost per level
    buy_location = (user.get("booze_buy_location") or {}).get(booze_id)
    is_run = buy_location is not None and buy_location != current_state
    if is_run:
        try:
            from routers.game.achievements import get_badge_bonuses
            bb = await get_badge_bonuses(user.get("id") or "")
            profit = int(profit * (1 + bb.get("booze_runs", 0) * 0.001) * bb.get("prestige_badge_mult", 1))
        except Exception:
            pass
        profit = max(0, int(profit * BOOZE_RUN_PROFIT_MULT))
        revenue = cost_of_sold + profit
    new_val = have - amount
    booze_name = BOOZE_TYPES[booze_index]["name"]
    today_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
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
    updates = {
        "$inc": {"money": revenue},
        "$push": {"booze_run_history": {"$each": [history_entry], "$position": 0, "$slice": BOOZE_RUN_HISTORY_MAX}},
    }
    if is_run:
        updates["$inc"] = updates.get("$inc", {})
        updates["$inc"]["booze_profit_today"] = profit
        updates["$inc"]["booze_profit_total"] = profit
        updates["$inc"]["booze_run_profit_total"] = profit
        updates["$inc"]["booze_runs_count"] = 1
        updates["$inc"][f"booze_profit_by_type.{booze_id}"] = profit
        updates["$set"] = {"booze_profit_today_date": today_utc}
    if new_val == 0:
        updates.setdefault("$unset", {})[f"booze_carrying.{booze_id}"] = ""
        updates["$unset"][f"booze_carrying_cost.{booze_id}"] = ""
        updates["$unset"][f"booze_buy_location.{booze_id}"] = ""
    else:
        updates["$inc"][f"booze_carrying.{booze_id}"] = -amount
        updates["$inc"][f"booze_carrying_cost.{booze_id}"] = -cost_of_sold
    sell_result = await db.users.update_one(
        {"id": user["id"], f"booze_carrying.{booze_id}": {"$gte": amount}},
        updates,
    )
    if sell_result.modified_count == 0:
        raise HTTPException(status_code=400, detail=f"Insufficient booze to sell")
    if is_run:
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.economy_events.insert_one({
            "at": now_iso,
            "type": "booze_run_sell",
            "user_id": user["id"],
            "username": user.get("username") or "",
            "booze_id": booze_id,
            "booze_name": booze_name,
            "amount": amount,
            "revenue": revenue,
            "profit": profit,
        })
    if is_run:
        try:
            from routers.account.objectives import update_objectives_progress
            await update_objectives_progress(user["id"], "booze_runs", 1)
        except Exception:
            pass
        # Referral: referrers split 2% of booze profit (game-paid)
        _rb = await db.users.find_one({"id": user["id"]}, {"_id": 0, "referred_by": 1})
        ref_ids = normalize_referred_by_ids((_rb or user).get("referred_by"))
        if ref_ids and profit > 0:
            pool = referral_pool_int(profit, 0.02)
            for rid, amt in split_referral_pool(pool, ref_ids, self_id=user["id"]):
                if amt > 0:
                    await apply_referrer_referral_increment(
                        db, rid, {"money": amt, "referral_earnings_booze": amt}, context="booze_run"
                    )
    _invalidate_config_cache(user["id"])
    await log_activity(user.get("id", ""), user.get("username", ""), "booze_sell", {"booze": booze_name, "amount": amount, "revenue": revenue, "profit": profit})
    return {"message": f"Sold {amount} {booze_name}", "revenue": revenue, "profit": profit, "new_carrying": new_val, "is_run": is_run}


# ----- Routes -----
async def booze_run_config(current_user: dict = Depends(get_current_user)):
    global _config_cache
    uid = current_user.get("id")
    now = time.monotonic()
    if uid in _config_cache:
        payload, expires = _config_cache[uid]
        if now <= expires:
            return payload

    current_state = current_user.get("current_state", STATES[0] if STATES else "")
    loc_index = STATES.index(current_state) if current_state in STATES else 0
    prices_map = _booze_prices_for_rotation()
    carrying = current_user.get("booze_carrying") or {}
    rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
    capacity_from_rank = BOOZE_CAPACITY_BASE_RANK1 + (rank_id - 1) * BOOZE_CAPACITY_EXTRA_PER_RANK
    capacity = _booze_user_capacity(current_user)
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
    today_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    profit_today = current_user.get("booze_profit_today", 0)
    profit_today_date = current_user.get("booze_profit_today_date")
    if profit_today_date != today_utc:
        profit_today = 0
    profit_total = current_user.get("booze_profit_total", 0)
    runs_count = current_user.get("booze_runs_count", 0)
    history = (current_user.get("booze_run_history") or [])[:BOOZE_RUN_HISTORY_MAX]
    capacity_bonus = min(current_user.get("booze_capacity_bonus", 0), BOOZE_CAPACITY_BONUS_MAX)
    from routers.account.auto_rank import booze_travel_seconds_per_leg

    travel_leg_sec = await booze_travel_seconds_per_leg(db, uid)
    daily_estimate_rough = _booze_daily_estimate_rough(capacity, prices_map, travel_leg_sec)

    _lpm = get_booze_listed_price_mult()
    payload = {
        "locations": list(STATES),
        "booze_types": list(BOOZE_TYPES),
        "current_location": current_state,
        "prices_at_location": prices_at_location,
        "all_prices_by_location": all_prices,
        "carrying": carrying,
        "capacity": capacity,
        "capacity_from_rank": capacity_from_rank,
        "capacity_extra_per_rank": BOOZE_CAPACITY_EXTRA_PER_RANK,
        "capacity_bonus": capacity_bonus,
        "capacity_bonus_max": BOOZE_CAPACITY_BONUS_MAX,
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
        "booze_boost_active": booze_boost_active,
    }
    if len(_config_cache) >= _CONFIG_MAX_ENTRIES:
        oldest = next(iter(_config_cache))
        _config_cache.pop(oldest, None)
    _config_cache[uid] = (payload, now + _CONFIG_TTL_SEC)
    return payload


async def booze_run_buy(request: BoozeBuyRequest, current_user: dict = Depends(get_current_user)):
    return await _booze_buy_impl(current_user, request.booze_id, request.amount)


async def booze_run_sell(request: BoozeSellRequest, current_user: dict = Depends(get_current_user)):
    return await _booze_sell_impl(current_user, request.booze_id, request.amount)


async def buy_booze_capacity(current_user: dict = Depends(get_current_user)):
    if int(current_user.get("points") or 0) < BOOZE_CAPACITY_UPGRADE_COST:
        raise HTTPException(status_code=400, detail="Insufficient points")
    current_bonus = min(current_user.get("booze_capacity_bonus", 0), BOOZE_CAPACITY_BONUS_MAX)
    if current_bonus >= BOOZE_CAPACITY_BONUS_MAX:
        raise HTTPException(status_code=400, detail="Booze capacity bonus is already at the maximum (1000)")
    add_bonus = min(BOOZE_CAPACITY_UPGRADE_AMOUNT, BOOZE_CAPACITY_BONUS_MAX - current_bonus)
    result = await db.users.update_one(
        {"id": current_user["id"], "points": {"$gte": BOOZE_CAPACITY_UPGRADE_COST}},
        {"$inc": {"points": -BOOZE_CAPACITY_UPGRADE_COST, "booze_capacity_bonus": add_bonus}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    new_capacity = _booze_user_capacity({**current_user, "booze_capacity_bonus": current_bonus + add_bonus})
    _invalidate_config_cache(current_user["id"])
    return {"message": f"+{add_bonus} booze capacity for {BOOZE_CAPACITY_UPGRADE_COST} points", "new_capacity": new_capacity, "capacity_bonus": current_bonus + add_bonus, "capacity_bonus_max": BOOZE_CAPACITY_BONUS_MAX}


async def admin_get_booze_rotation(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    return {"rotation_seconds": _booze_rotation_override_seconds, "normal_hours": BOOZE_ROTATION_HOURS}


async def admin_set_booze_rotation(request: AdminBoozeRotationRequest, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    global _booze_rotation_override_seconds
    sec = request.seconds
    if sec is None or sec <= 0:
        _booze_rotation_override_seconds = None
        return {"message": "Booze rotation reset to normal (3 hours)", "rotation_seconds": None}
    if sec < 5 or sec > 86400:
        raise HTTPException(status_code=400, detail="seconds must be between 5 and 86400 (1 day)")
    _booze_rotation_override_seconds = sec
    return {"message": f"Booze rotation set to {sec} seconds", "rotation_seconds": sec}


async def admin_get_booze_jail_chances(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
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


async def admin_get_booze_listed_price(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    m = get_booze_listed_price_mult()
    return {
        "listed_price_mult": m,
        "percent_off": round((1.0 - m) * 100.0, 4) if m < 1.0 else 0.0,
        "min_mult": BOOZE_LISTED_PRICE_MULT_MIN,
        "max_mult": BOOZE_LISTED_PRICE_MULT_MAX,
    }


async def admin_set_booze_listed_price(request: AdminBoozeListedPriceRequest, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    global _booze_listed_price_mult
    if request.reset:
        mult = 1.0
    elif request.delta_percent_off is not None:
        d = float(request.delta_percent_off)
        cur = get_booze_listed_price_mult()
        cur_pct = (1.0 - cur) * 100.0
        new_pct = cur_pct + d
        new_pct = max(0.0, min(99.0, new_pct))
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
        {"$set": {"listed_price_mult": mult, "updated_at": now_iso}},
        upsert=True,
    )
    _invalidate_all_booze_config_cache()
    pct = round((1.0 - mult) * 100.0, 4) if mult < 1.0 else 0.0
    log_extra = {"listed_price_mult": mult, "percent_off": pct}
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
        "percent_off": pct,
    }


async def admin_set_booze_jail_chances(request: AdminBoozeJailChanceRequest, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    global _booze_jail_min_override, _booze_jail_max_override
    if request.reset:
        _booze_jail_min_override = None
        _booze_jail_max_override = None
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
    return {
        "message": "Booze jail chances updated.",
        "effective_jail_chance_min": lo,
        "effective_jail_chance_max": hi,
        "override_jail_chance_min": _booze_jail_min_override,
        "override_jail_chance_max": _booze_jail_max_override,
    }


def register(router):
    router.add_api_route("/booze-run/config", booze_run_config, methods=["GET"])
    router.add_api_route("/booze-run/buy", booze_run_buy, methods=["POST"])
    router.add_api_route("/booze-run/sell", booze_run_sell, methods=["POST"])
    # buy-booze-capacity route is registered in store.py (uses respect-first logic)
    router.add_api_route("/admin/booze-rotation", admin_get_booze_rotation, methods=["GET"])
    router.add_api_route("/admin/booze-rotation", admin_set_booze_rotation, methods=["POST"])
    router.add_api_route("/admin/booze-jail-chances", admin_get_booze_jail_chances, methods=["GET"])
    router.add_api_route("/admin/booze-jail-chances", admin_set_booze_jail_chances, methods=["POST"])
    router.add_api_route("/admin/booze-listed-price", admin_get_booze_listed_price, methods=["GET"])
    router.add_api_route("/admin/booze-listed-price", admin_set_booze_listed_price, methods=["POST"])
