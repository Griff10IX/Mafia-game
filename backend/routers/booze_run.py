# Booze Run: config, buy, sell, capacity upgrade; rotation helpers for flash news
from datetime import datetime, timezone, timedelta
from typing import Optional
import time
import random
from pydantic import BaseModel

from fastapi import Depends, HTTPException

from server import (
    db,
    get_current_user,
    get_rank_info,
    STATES,
    TRAVEL_TIMES,
    _is_admin,
)

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
BOOZE_CAPACITY_UPGRADE_COST = 30
BOOZE_CAPACITY_UPGRADE_AMOUNT = 100
BOOZE_CAPACITY_BONUS_MAX = 1000
BOOZE_RUN_HISTORY_MAX = 10
BOOZE_RUN_JAIL_CHANCE_MIN = 0.02
BOOZE_RUN_JAIL_CHANCE_MAX = 0.06
BOOZE_RUN_JAIL_SECONDS = 20

# Per-user cache for GET /booze-run/config
_config_cache: dict = {}
_CONFIG_TTL_SEC = 10
_CONFIG_MAX_ENTRIES = 5000


def _invalidate_config_cache(user_id: str):
    _config_cache.pop(user_id, None)


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
    return out


def _booze_daily_estimate_rough(capacity: int, prices_map: dict) -> int:
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
    secs_per_run = 2 * TRAVEL_TIMES.get("custom", 20)
    jail_per_action = (BOOZE_RUN_JAIL_CHANCE_MIN + BOOZE_RUN_JAIL_CHANCE_MAX) / 2
    jail_per_run = 1 - (1 - jail_per_action) ** 2
    jail_seconds = BOOZE_RUN_JAIL_SECONDS
    expected_secs_per_run = secs_per_run + jail_per_run * jail_seconds
    runs_per_24h = 86400 / expected_secs_per_run
    successful_run_rate = (1 - jail_per_action) ** 2
    profitable_runs = runs_per_24h * successful_run_rate
    return int(profitable_runs * capacity * profit_per_unit)


def _booze_user_capacity(current_user: dict) -> int:
    rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
    capacity_from_rank = BOOZE_CAPACITY_BASE_RANK1 + (rank_id - 1) * BOOZE_CAPACITY_EXTRA_PER_RANK
    bonus = min(current_user.get("booze_capacity_bonus", 0), BOOZE_CAPACITY_BONUS_MAX)
    return max(1, capacity_from_rank + bonus)


def _booze_user_carrying_total(carrying: dict) -> int:
    return sum(int(v) for v in (carrying or {}).values())


def _booze_user_in_jail(user: dict) -> bool:
    if not user.get("in_jail"):
        return False
    jail_until_iso = user.get("jail_until")
    if not jail_until_iso:
        return False
    jail_until = datetime.fromisoformat(jail_until_iso.replace("Z", "+00:00"))
    if jail_until.tzinfo is None:
        jail_until = jail_until.replace(tzinfo=timezone.utc)
    return jail_until > datetime.now(timezone.utc)


# ----- Models -----
class BoozeBuyRequest(BaseModel):
    booze_id: str
    amount: int


class BoozeSellRequest(BaseModel):
    booze_id: str
    amount: int


class AdminBoozeRotationRequest(BaseModel):
    seconds: Optional[int] = None


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
    cost = price * amount
    if user.get("money", 0) < cost:
        raise HTTPException(status_code=400, detail="Insufficient money")
    carrying = dict(user.get("booze_carrying") or {})
    capacity = _booze_user_capacity(user)
    current_carry = _booze_user_carrying_total(carrying)
    if current_carry + amount > capacity:
        raise HTTPException(status_code=400, detail=f"Over capacity (max {capacity} units)")
    jail_chance = random.uniform(BOOZE_RUN_JAIL_CHANCE_MIN, BOOZE_RUN_JAIL_CHANCE_MAX)
    if random.random() < jail_chance:
        jail_until = datetime.now(timezone.utc) + timedelta(seconds=BOOZE_RUN_JAIL_SECONDS)
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"in_jail": True, "jail_until": jail_until.isoformat()}, "$unset": {"booze_carrying": "", "booze_carrying_cost": ""}},
        )
        _invalidate_config_cache(user["id"])
        return {
            "message": "Busted! Prohibition agents got you. You're going to jail.",
            "caught": True,
            "jail_until": jail_until.isoformat(),
            "jail_seconds": BOOZE_RUN_JAIL_SECONDS,
        }
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
    await db.users.update_one(
        {"id": user["id"]},
        {
            "$inc": {"money": -cost, f"booze_carrying.{booze_id}": amount, f"booze_carrying_cost.{booze_id}": cost},
            "$set": {f"booze_buy_location.{booze_id}": current_state},
            "$push": {"booze_run_history": {"$each": [history_entry], "$position": 0, "$slice": BOOZE_RUN_HISTORY_MAX}},
        }
    )
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
    jail_chance = random.uniform(BOOZE_RUN_JAIL_CHANCE_MIN, BOOZE_RUN_JAIL_CHANCE_MAX)
    if random.random() < jail_chance:
        jail_until = datetime.now(timezone.utc) + timedelta(seconds=BOOZE_RUN_JAIL_SECONDS)
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"in_jail": True, "jail_until": jail_until.isoformat()}, "$unset": {"booze_carrying": "", "booze_carrying_cost": ""}},
        )
        _invalidate_config_cache(user["id"])
        return {
            "message": "Busted! Prohibition agents got you. You're going to jail.",
            "caught": True,
            "jail_until": jail_until.isoformat(),
            "jail_seconds": BOOZE_RUN_JAIL_SECONDS,
        }
    revenue = price * amount
    total_cost_stored = int(carrying_cost.get(booze_id, 0))
    cost_of_sold = (total_cost_stored * amount // have) if have else 0
    profit = revenue - cost_of_sold
    new_val = have - amount
    booze_name = BOOZE_TYPES[booze_index]["name"]
    buy_location = (user.get("booze_buy_location") or {}).get(booze_id)
    is_run = buy_location is not None and buy_location != current_state
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
        updates["$inc"]["booze_runs_count"] = 1
        updates["$set"] = {"booze_profit_today_date": today_utc}
    if new_val == 0:
        updates.setdefault("$unset", {})[f"booze_carrying.{booze_id}"] = ""
        updates["$unset"][f"booze_carrying_cost.{booze_id}"] = ""
        updates["$unset"][f"booze_buy_location.{booze_id}"] = ""
    else:
        updates["$inc"][f"booze_carrying.{booze_id}"] = -amount
        updates["$inc"][f"booze_carrying_cost.{booze_id}"] = -cost_of_sold
    await db.users.update_one({"id": user["id"]}, updates)
    if is_run:
        try:
            from routers.objectives import update_objectives_progress
            await update_objectives_progress(user["id"], "booze_runs", 1)
        except Exception:
            pass
    _invalidate_config_cache(user["id"])
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
    prices_at_location = []
    for i, bt in enumerate(BOOZE_TYPES):
        price = prices_map.get((loc_index, i), 400)
        prices_at_location.append({
            "booze_id": bt["id"],
            "name": bt["name"],
            "buy_price": price,
            "sell_price": price,
            "carrying": int(carrying.get(bt["id"], 0)),
        })
    all_prices = {}
    for loc_i, state in enumerate(STATES):
        all_prices[state] = [
            {"booze_id": BOOZE_TYPES[b]["id"], "name": BOOZE_TYPES[b]["name"], "buy_price": prices_map.get((loc_i, b), 400), "sell_price": prices_map.get((loc_i, b), 400)}
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
    daily_estimate_rough = _booze_daily_estimate_rough(capacity, prices_map)

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
        "rotation_ends_at": _booze_rotation_ends_at(),
        "rotation_hours": BOOZE_ROTATION_HOURS,
        "rotation_seconds": _booze_rotation_override_seconds,
        "round_trip_cities": _booze_round_trip_cities(),
        "profit_today": profit_today,
        "profit_total": profit_total,
        "runs_count": runs_count,
        "history": history,
        "daily_estimate_rough": daily_estimate_rough,
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
    if current_user["points"] < BOOZE_CAPACITY_UPGRADE_COST:
        raise HTTPException(status_code=400, detail="Insufficient points")
    current_bonus = min(current_user.get("booze_capacity_bonus", 0), BOOZE_CAPACITY_BONUS_MAX)
    if current_bonus >= BOOZE_CAPACITY_BONUS_MAX:
        raise HTTPException(status_code=400, detail="Booze capacity bonus is already at the maximum (1000)")
    add_bonus = min(BOOZE_CAPACITY_UPGRADE_AMOUNT, BOOZE_CAPACITY_BONUS_MAX - current_bonus)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -BOOZE_CAPACITY_UPGRADE_COST, "booze_capacity_bonus": add_bonus}}
    )
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


def register(router):
    router.add_api_route("/booze-run/config", booze_run_config, methods=["GET"])
    router.add_api_route("/booze-run/buy", booze_run_buy, methods=["POST"])
    router.add_api_route("/booze-run/sell", booze_run_sell, methods=["POST"])
    router.add_api_route("/store/buy-booze-capacity", buy_booze_capacity, methods=["POST"])
    router.add_api_route("/admin/booze-rotation", admin_get_booze_rotation, methods=["GET"])
    router.add_api_route("/admin/booze-rotation", admin_set_booze_rotation, methods=["POST"])
