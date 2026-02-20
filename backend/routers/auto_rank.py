# Auto Rank: background task that auto-commits crimes and GTA for users who bought it, sends results to Telegram
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

_auto_rank_config_cache: Optional[dict] = None
_auto_rank_config_cache_until: Optional[datetime] = None
AUTO_RANK_CONFIG_CACHE_SECONDS = 3

from fastapi import HTTPException, Query

logger = logging.getLogger(__name__)

MIN_INTERVAL_SECONDS = 5
# 5% slower: default 120 -> 126, loop wake 30 -> 32, bust 5 -> 6, OC 60 -> 63
DEFAULT_INTERVAL_SECONDS = 126  # was 2*60; 5% slower
GAME_CONFIG_ID = "auto_rank"
BUST_EVERY_5SEC_INTERVAL = 6  # was 5; 5% slower
CRIMES_GTA_MIN_INTERVAL_WHEN_BUST_5SEC = 32  # was 30; 5% slower
LOOP_WAKE_SECONDS = 32  # was 30; main loop (and booze no-car retry) 5% slower
OC_LOOP_INTERVAL_SECONDS = 63  # was 60; 5% slower
OC_RETRY_AFTER_AFFORD_SECONDS = 10 * 60


# ─── Config helpers ───────────────────────────────────────────────

def _invalidate_auto_rank_config_cache():
    global _auto_rank_config_cache, _auto_rank_config_cache_until
    _auto_rank_config_cache = None
    _auto_rank_config_cache_until = None


async def get_auto_rank_config(db) -> dict:
    global _auto_rank_config_cache, _auto_rank_config_cache_until
    now = datetime.now(timezone.utc)
    if _auto_rank_config_cache is not None and _auto_rank_config_cache_until is not None and now < _auto_rank_config_cache_until:
        return _auto_rank_config_cache
    doc = await db.game_config.find_one({"id": GAME_CONFIG_ID}, {"_id": 0, "enabled": 1, "interval_seconds": 1})
    if doc is None:
        config = {"enabled": True, "interval_seconds": DEFAULT_INTERVAL_SECONDS}
    else:
        try:
            interval = int(doc.get("interval_seconds")) if doc.get("interval_seconds") is not None else DEFAULT_INTERVAL_SECONDS
        except (TypeError, ValueError):
            interval = DEFAULT_INTERVAL_SECONDS
        config = {"enabled": doc.get("enabled", True), "interval_seconds": max(MIN_INTERVAL_SECONDS, interval)}
    _auto_rank_config_cache = config
    _auto_rank_config_cache_until = now + timedelta(seconds=AUTO_RANK_CONFIG_CACHE_SECONDS)
    return config


async def get_auto_rank_interval_seconds(db) -> int:
    return (await get_auto_rank_config(db))["interval_seconds"]


async def get_auto_rank_enabled(db) -> bool:
    return (await get_auto_rank_config(db))["enabled"]


# ─── Utility helpers ──────────────────────────────────────────────

def _parse_iso(s):
    if not s:
        return None
    if hasattr(s, "year"):
        return s
    try:
        return datetime.fromisoformat(str(s).strip().replace("Z", "+00:00"))
    except Exception:
        return None


async def _get_travel_method(db, user_id: str) -> Optional[str]:
    """Find the best travel method for a user: custom car first, then any car. Used for booze (cars only, no airport)."""
    custom = await db.user_cars.find_one({"user_id": user_id, "car_id": "car_custom"}, {"_id": 0, "id": 1})
    if custom:
        return "custom"
    car = await db.user_cars.find_one({"user_id": user_id}, {"_id": 0, "id": 1})
    if car:
        return car.get("id") or str(car.get("_id", ""))
    return None


async def _apply_overdue_travel(db, user_id: str, user: dict, now: datetime) -> dict:
    """If user has overdue travel, apply arrival and return refreshed user doc."""
    arrives_at = user.get("travel_arrives_at")
    traveling_to = user.get("traveling_to")
    if not arrives_at or not traveling_to:
        return user
    arrives_dt = _parse_iso(arrives_at)
    if not arrives_dt or now < arrives_dt:
        return user
    for _ in range(2):
        try:
            await db.users.update_one(
                {"id": user_id},
                {"$set": {"current_state": traveling_to}, "$unset": {"traveling_to": "", "travel_arrives_at": ""}},
            )
            user = await db.users.find_one({"id": user_id}, {"_id": 0})
            if not user or not user.get("travel_arrives_at"):
                break
        except Exception as e:
            logger.warning("Auto rank: arrival update failed for %s: %s", user_id, e)
    return user or {}


# ─── Stats helpers ────────────────────────────────────────────────

async def _ensure_stats_since(db, user_id: str, now: datetime):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "auto_rank_stats_since": 1})
    if u and not u.get("auto_rank_stats_since"):
        await db.users.update_one({"id": user_id}, {"$set": {"auto_rank_stats_since": now.isoformat()}})


async def _update_auto_rank_stats_bust(db, user_id: str, cash: int, now: datetime):
    await _ensure_stats_since(db, user_id, now)
    await db.users.update_one({"id": user_id}, {"$inc": {"auto_rank_total_busts": 1, "auto_rank_total_cash": cash}})


async def _update_auto_rank_stats_crimes(db, user_id: str, count: int, cash: int, now: datetime):
    if count <= 0 and cash <= 0:
        return
    await _ensure_stats_since(db, user_id, now)
    await db.users.update_one({"id": user_id}, {"$inc": {"auto_rank_total_crimes": count, "auto_rank_total_cash": cash}})


async def _update_auto_rank_stats_gta(db, user_id: str, car: dict, now: datetime):
    await _ensure_stats_since(db, user_id, now)
    car_name = (car or {}).get("name") or "Car"
    car_value = int((car or {}).get("value", 0) or 0)
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "auto_rank_best_cars": 1})
    best = list((u or {}).get("auto_rank_best_cars") or [])
    best.append({"name": car_name, "value": car_value})
    best.sort(key=lambda x: x.get("value", 0), reverse=True)
    await db.users.update_one({"id": user_id}, {"$inc": {"auto_rank_total_gtas": 1}, "$set": {"auto_rank_best_cars": best[:3]}})


async def _update_auto_rank_stats_booze(db, user_id: str, now: datetime, profit: int = 0):
    await _ensure_stats_since(db, user_id, now)
    await db.users.update_one({"id": user_id}, {"$inc": {"auto_rank_total_booze_runs": 1, "auto_rank_total_booze_profit": max(0, int(profit))}})


# ─── Telegram helper ──────────────────────────────────────────────

async def _send_jail_notification(telegram_chat_id: str, username: str, reason: str, jail_seconds: int = 30, bot_token: Optional[str] = None):
    if not (telegram_chat_id or "").strip():
        return
    from security import send_telegram_to_chat
    msg = f"**Auto Rank** — {username}\n\n🔒 You're in jail ({reason}). {jail_seconds}s."
    await send_telegram_to_chat(telegram_chat_id, msg, bot_token)


# ─── Booze running ────────────────────────────────────────────────

async def _booze_sell_at_city(db, user, user_id: str, username: str, telegram_chat_id: str, bot_token, now: datetime, lines: list):
    """Sell all carried booze that wasn't bought at the current city. Returns (has_success, user)."""
    from routers.booze_run import _booze_sell_impl

    carrying = dict(user.get("booze_carrying") or {})
    buy_locations = dict((user.get("booze_buy_location") or {}).items())
    current = (user.get("current_state") or "").strip()
    has_success = False

    for bid, amt in list(carrying.items()):
        amt = int(amt or 0)
        if amt <= 0:
            continue
        if buy_locations.get(bid) == current:
            continue
        try:
            out = await _booze_sell_impl(user, bid, amt)
            if out.get("caught"):
                await _send_jail_notification(telegram_chat_id, username, "booze sell bust", 20, bot_token)
                return False, None
            profit = out.get("profit") or 0
            if out.get("is_run") and profit:
                lines.append(f"**Booze** — Sold {amt} for ${profit:,} profit.")
                await _update_auto_rank_stats_booze(db, user_id, now, profit)
                has_success = True
            user = await db.users.find_one({"id": user_id}, {"_id": 0})
            if not user:
                return has_success, None
        except Exception as e:
            logger.exception("Auto rank booze sell %s: %s", user_id, e)
            break

    return has_success, user


async def _booze_buy_and_travel(db, user, user_id: str, username: str, telegram_chat_id: str, bot_token, now: datetime, lines: list, buy_city: str, sell_city: str, buy_idx: int, sell_idx: int):
    """Buy optimal booze at buy_city and travel to sell_city. Booze only uses cars (no airport). If no car, skip and retry next cycle (every 30s)."""
    from routers.booze_run import BOOZE_TYPES, _booze_prices_for_rotation, _booze_user_capacity, _booze_buy_impl
    from routers.airport import _start_travel_impl

    # Only use cars for booze; if no car, don't buy — will retry next loop (every 30s)
    travel_method = await _get_travel_method(db, user_id)
    if not travel_method:
        return False

    prices_map = _booze_prices_for_rotation()
    capacity = _booze_user_capacity(user)
    money = int(user.get("money") or 0)

    best_profit = -1
    best_booze_id = None
    best_buy_price = 400
    for i, bt in enumerate(BOOZE_TYPES):
        p_buy = prices_map.get((buy_idx, i), 400)
        p_sell = prices_map.get((sell_idx, i), 400)
        if p_sell - p_buy > best_profit:
            best_profit = p_sell - p_buy
            best_booze_id = bt["id"]
            best_buy_price = p_buy

    if not best_booze_id or best_profit <= 0 or best_buy_price <= 0:
        return False
    amount = min(capacity, money // best_buy_price)
    if amount <= 0:
        return False

    try:
        out = await _booze_buy_impl(user, best_booze_id, amount)
        if out.get("caught"):
            await _send_jail_notification(telegram_chat_id, username, "booze buy bust", 20, bot_token)
            return False
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user:
            return True
        await _start_travel_impl(user, sell_city, travel_method, airport_slot=None, booze_run=True)
        lines.append(f"**Booze** — Bought {amount} at {buy_city}, traveling to {sell_city}.")
        return True
    except HTTPException:
        pass
    except Exception as e:
        logger.exception("Auto rank booze buy/travel %s: %s", user_id, e)
    return False


async def _run_booze_for_user(db, user_id: str, username: str, telegram_chat_id: str, bot_token: Optional[str], now: datetime, lines: list) -> bool:
    """Run one booze step: apply travel arrival, then sell if carrying else buy and start travel."""
    from server import STATES
    from routers.booze_run import _booze_round_trip_cities, _booze_user_carrying_total
    from routers.airport import _start_travel_impl

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return False
    user = await _apply_overdue_travel(db, user_id, user, now)
    if not user or user.get("in_jail"):
        return False
    if user.get("travel_arrives_at"):
        adt = _parse_iso(user["travel_arrives_at"])
        if adt and now < adt:
            return False

    round_trip = _booze_round_trip_cities()
    if not round_trip or len(round_trip) < 2:
        return False
    city_a, city_b = round_trip[0], round_trip[1]
    current = (user.get("current_state") or "").strip()
    idx_a = STATES.index(city_a) if city_a in STATES else 0
    idx_b = STATES.index(city_b) if city_b in STATES else 1

    if current not in (city_a, city_b):
        travel_method = await _get_travel_method(db, user_id)
        if travel_method:
            try:
                await _start_travel_impl(user, city_a, travel_method, airport_slot=None, booze_run=True)
                lines.append(f"**Booze** — Traveling to {city_a} to start run.")
                return True
            except Exception as e:
                logger.exception("Auto rank booze travel to buy city %s: %s", user_id, e)
        return False

    carrying_total = _booze_user_carrying_total(dict(user.get("booze_carrying") or {}))
    other_city = city_b if current == city_a else city_a
    other_idx = idx_b if current == city_a else idx_a
    current_idx = idx_a if current == city_a else idx_b

    if carrying_total > 0:
        success, user = await _booze_sell_at_city(db, user, user_id, username, telegram_chat_id, bot_token, now, lines)
        return success
    else:
        return await _booze_buy_and_travel(db, user, user_id, username, telegram_chat_id, bot_token, now, lines, current, other_city, current_idx, other_idx)


# ─── Bust-only (5-sec loop) ──────────────────────────────────────

async def _run_bust_only_for_user(user_id: str, username: str, telegram_chat_id: str, bot_token: Optional[str] = None, bust_target_username: Optional[str] = None):
    """Try one jail bust, send result to Telegram."""
    import server as srv
    from routers.jail import _attempt_bust_impl
    from security import send_telegram_to_chat

    db = srv.db
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return
    token = bot_token or (user.get("telegram_bot_token") or "").strip()
    if bust_target_username is None:
        npc = await db.jail_npcs.find_one({}, {"_id": 0, "username": 1})
        if npc:
            bust_target_username = npc.get("username")
        if not bust_target_username:
            jailed = await db.users.find_one({"in_jail": True, "id": {"$ne": user_id}}, {"_id": 0, "username": 1})
            if jailed:
                bust_target_username = jailed.get("username")
    if not bust_target_username:
        return
    try:
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user:
            return
        bust_result = await _attempt_bust_impl(user, bust_target_username)
        if bust_result.get("error") or not bust_result.get("success"):
            return
        rp = bust_result.get("rank_points_earned") or 0
        cash = bust_result.get("cash_reward") or 0
        await _update_auto_rank_stats_bust(db, user_id, cash, datetime.now(timezone.utc))
        parts = [f"Busted {bust_target_username}! +{rp} RP"]
        if cash:
            parts.append(f"${cash:,}")
        if (telegram_chat_id or "").strip():
            msg = f"**Auto Rank** — {username}\n\n**Bust** — " + ". ".join(parts) + "."
            await send_telegram_to_chat(telegram_chat_id, msg, token)
    except Exception as e:
        logger.exception("Auto rank bust-only for %s: %s", user_id, e)


# ─── Main per-user cycle (crimes + GTA + booze) ──────────────────
# Auto rank abides the same timer rules as manual play:
# - Crimes: only commits crimes whose user_crimes.cooldown_until has passed (per-crime cooldown from crimes collection).
#   _commit_crime_impl also enforces cooldown and sets next cooldown_until from the crime's cooldown_seconds.
# - GTA: only runs when gta_cooldowns shows no active cooldown. _attempt_gta_impl enforces cooldown and sets
#   cooldown_until from the attempted option's cooldown (one attempt = all options on cooldown).
# - OC: run_oc_heist_npc_only checks oc_cooldown_until and returns without running if on cooldown.
# - Booze: uses same buy/sell/travel impls; travel duration and arrival are enforced there.
# - Jail: no cooldown per bust; success rate only. CRIMES_GTA_MIN_INTERVAL_WHEN_BUST_5SEC throttles how often we run crimes+GTA when bust-every-5sec is on.


async def _run_auto_rank_for_user(user_id: str, username: str, telegram_chat_id: str, bot_token: Optional[str] = None, crimes: Optional[list] = None):
    """Commit all crimes off cooldown, then one GTA (if off cooldown), then booze if enabled. Abides all game timer rules; impls enforce cooldowns. Send summary to Telegram."""
    import server as srv
    from routers.crimes import _commit_crime_impl
    from routers.gta import _attempt_gta_impl, GTA_OPTIONS
    from security import send_telegram_to_chat

    db = srv.db
    get_rank_info = srv.get_rank_info
    now = datetime.now(timezone.utc)
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return
    token = (bot_token or "").strip() or (user.get("telegram_bot_token") or "").strip()
    bust_every_5 = user.get("auto_rank_bust_every_5_sec", False)

    if bust_every_5:
        last_at = _parse_iso(user.get("auto_rank_last_crimes_gta_at"))
        if last_at and (now - last_at).total_seconds() < CRIMES_GTA_MIN_INTERVAL_WHEN_BUST_5SEC:
            return
        if user.get("in_jail"):
            return
    elif user.get("in_jail"):
        return

    lines = [f"**Auto Rank** — {username}", ""]
    has_success = False

    if user.get("in_jail"):
        if bust_every_5:
            await db.users.update_one({"id": user_id}, {"$set": {"auto_rank_last_crimes_gta_at": now.isoformat()}})
        return

    run_crimes = user.get("auto_rank_crimes", True) or bust_every_5
    run_gta = user.get("auto_rank_gta", True) or bust_every_5

    # --- Crimes: only those off cooldown (same rules as manual play; _commit_crime_impl also enforces) ---
    if run_crimes:
        if crimes is None:
            crimes = await db.crimes.find({}, {"_id": 0, "id": 1, "name": 1, "min_rank": 1}).to_list(50)
        crime_success_count = 0
        crime_fail_count = 0
        crime_total_cash = 0
        crime_total_rp = 0
        while True:
            user = await db.users.find_one({"id": user_id}, {"_id": 0})
            if not user or user.get("in_jail"):
                break
            user_crimes = await db.user_crimes.find({"user_id": user_id}, {"_id": 0, "crime_id": 1, "cooldown_until": 1}).to_list(100)
            cooldown_by_crime = {uc["crime_id"]: _parse_iso(uc.get("cooldown_until")) for uc in user_crimes}
            rank_id, _ = get_rank_info(int(user.get("rank_points") or 0))
            # Only crimes whose cooldown_until has passed (or never set); _commit_crime_impl will re-check and set next cooldown from crime's cooldown_seconds
            available = [
                c for c in crimes
                if c["min_rank"] <= rank_id
                and (cooldown_by_crime.get(c["id"]) is None or cooldown_by_crime.get(c["id"]) <= now)
            ]
            if not available:
                break
            try:
                out = await _commit_crime_impl(available[0]["id"], user)
                if out.success:
                    crime_success_count += 1
                    crime_total_cash += out.reward if out.reward is not None else 0
                    crime_total_rp += 3
                else:
                    crime_fail_count += 1
            except Exception as e:
                logger.exception("Auto rank crime for %s: %s", user_id, e)
                crime_fail_count += 1
                break
        if crime_success_count > 0:
            has_success = True
            await _update_auto_rank_stats_crimes(db, user_id, crime_success_count, crime_total_cash, now)
            lines.append(f"**Crimes** — Committed {crime_success_count} crime(s). earned ${crime_total_cash:,} and {crime_total_rp} RP.")

    # --- GTA ---
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return
    if user.get("in_jail"):
        if bust_every_5:
            await db.users.update_one({"id": user_id}, {"$set": {"auto_rank_last_crimes_gta_at": now.isoformat()}})
        return

    # --- GTA: only if global GTA cooldown has passed; _attempt_gta_impl enforces and sets cooldown from option's cooldown (60/90/120/180/240s) ---
    if run_gta:
        cooldown_doc = await db.gta_cooldowns.find_one({"user_id": user_id}, {"_id": 0, "cooldown_until": 1})
        until = _parse_iso(cooldown_doc.get("cooldown_until")) if cooldown_doc else None
        if not (until and until > now):
            rank_id, _ = get_rank_info(int(user.get("rank_points") or 0))
            for opt in GTA_OPTIONS:
                if rank_id < opt["min_rank"]:
                    continue
                try:
                    out = await _attempt_gta_impl(opt["id"], user)
                    if out.success:
                        has_success = True
                        car_name = out.car.get("name", "Car") if out.car else "Car"
                        await _update_auto_rank_stats_gta(db, user_id, out.car or {}, now)
                        lines.append(f"**GTA** — Success: {car_name}! +{out.rank_points_earned} RP.")
                    break
                except Exception as e:
                    logger.exception("Auto rank GTA for %s: %s", user_id, e)
                    break

    if bust_every_5:
        await db.users.update_one({"id": user_id}, {"$set": {"auto_rank_last_crimes_gta_at": now.isoformat()}})

    # --- Booze ---
    if user.get("auto_rank_booze", False):
        try:
            if await _run_booze_for_user(db, user_id, username, telegram_chat_id, bot_token, now, lines):
                has_success = True
        except Exception as e:
            logger.exception("Auto rank booze for %s: %s", user_id, e)

    if has_success and (telegram_chat_id or "").strip():
        lines.append("")
        await send_telegram_to_chat(telegram_chat_id, "\n".join(lines), token)


# ─── Background loops ─────────────────────────────────────────────

async def run_booze_arrivals():
    """Process booze users who have just arrived from travel so they sell immediately."""
    import server as srv
    from security import send_telegram_to_chat

    db = srv.db
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    stuck_jailed = db.users.find(
        {"auto_rank_purchased": True, "auto_rank_enabled": True, "auto_rank_booze": True, "in_jail": True, "travel_arrives_at": {"$lte": now_iso}, "traveling_to": {"$exists": True, "$ne": None}},
        {"_id": 0, "id": 1, "traveling_to": 1},
    )
    async for u in stuck_jailed:
        dest = (u.get("traveling_to") or "").strip()
        if dest:
            try:
                await db.users.update_one({"id": u["id"]}, {"$set": {"current_state": dest}, "$unset": {"traveling_to": "", "travel_arrives_at": ""}})
            except Exception as e:
                logger.warning("Auto rank booze cleanup: arrival update for jailed %s failed: %s", u.get("id"), e)

    cursor = db.users.find(
        {"auto_rank_purchased": True, "auto_rank_enabled": True, "auto_rank_booze": True, "travel_arrives_at": {"$lte": now_iso}, "in_jail": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1, "telegram_bot_token": 1},
    )
    users = await cursor.to_list(200)
    for u in users:
        chat_id = (u.get("telegram_chat_id") or "").strip()
        bot_token = (u.get("telegram_bot_token") or "").strip() or None
        lines = [f"**Auto Rank** — {u.get('username', '?')}", ""]
        try:
            has_success = await _run_booze_for_user(db, u["id"], u.get("username", "?"), chat_id, bot_token, now, lines)
            if has_success and len(lines) > 2 and chat_id:
                await send_telegram_to_chat(chat_id, "\n".join(lines), bot_token)
        except Exception as e:
            logger.exception("Auto rank booze arrival for user %s: %s", u.get("id"), e)
        await asyncio.sleep(0.2)


async def run_auto_rank_due_users(interval_seconds: Optional[int] = None):
    """Find users whose auto_rank_next_run_at is due, run each once, set next_run_at."""
    import server as srv
    db = srv.db
    now = datetime.now(timezone.utc)
    interval = interval_seconds if interval_seconds is not None else await get_auto_rank_interval_seconds(db)
    cursor = db.users.find(
        {
            "auto_rank_purchased": True,
            "auto_rank_enabled": True,
            "$or": [
                {"auto_rank_next_run_at": {"$exists": False}},
                {"auto_rank_next_run_at": None},
                {"auto_rank_next_run_at": {"$lte": now.isoformat()}},
            ],
        },
        {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1, "telegram_bot_token": 1},
    )
    users = await cursor.to_list(500)
    crimes = await db.crimes.find({}, {"_id": 0, "id": 1, "name": 1, "min_rank": 1}).to_list(50)
    next_run_iso = datetime.fromtimestamp(now.timestamp() + interval, tz=timezone.utc).isoformat()
    for u in users:
        chat_id = (u.get("telegram_chat_id") or "").strip()
        bot_token = (u.get("telegram_bot_token") or "").strip() or None
        try:
            await _run_auto_rank_for_user(u["id"], u.get("username", "?"), chat_id, bot_token, crimes=crimes)
        except Exception as e:
            logger.exception("Auto rank for user %s: %s", u.get("id"), e)
        await asyncio.sleep(0.5)
    if users:
        from pymongo import UpdateOne
        await db.users.bulk_write(
            [UpdateOne({"id": u["id"]}, {"$set": {"auto_rank_next_run_at": next_run_iso}}) for u in users],
            ordered=False,
        )


async def run_bust_5sec_loop():
    """Background loop: every 5 sec, for bust-every-5-sec users, try one jail bust."""
    import server as srv
    db = srv.db
    await asyncio.sleep(15)
    while True:
        if not await get_auto_rank_enabled(db):
            await asyncio.sleep(10)
            continue
        try:
            cursor = db.users.find(
                {"auto_rank_purchased": True, "auto_rank_enabled": True, "auto_rank_bust_every_5_sec": True},
                {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1, "telegram_bot_token": 1},
            )
            users = await cursor.to_list(500)
            bust_target_username = None
            npc = await db.jail_npcs.find_one({}, {"_id": 0, "username": 1})
            if npc:
                bust_target_username = npc.get("username")
            if not bust_target_username:
                jailed = await db.users.find_one({"in_jail": True}, {"_id": 0, "username": 1})
                if jailed:
                    bust_target_username = jailed.get("username")
            for u in users:
                chat_id = (u.get("telegram_chat_id") or "").strip()
                bot_token = (u.get("telegram_bot_token") or "").strip()
                try:
                    if bust_target_username and bust_target_username != u.get("username"):
                        await _run_bust_only_for_user(u["id"], u.get("username", "?"), chat_id, bot_token or None, bust_target_username=bust_target_username)
                    else:
                        await _run_auto_rank_for_user(u["id"], u.get("username", "?"), chat_id, bot_token or None)
                except Exception as e:
                    logger.exception("Auto rank bust 5sec for user %s: %s", u.get("id"), e)
                await asyncio.sleep(0.3)
        except Exception as e:
            logger.exception("Bust 5sec cycle failed: %s", e)
        await asyncio.sleep(BUST_EVERY_5SEC_INTERVAL)


async def run_auto_rank_oc_loop():
    """Background loop: for OC users, run OC with NPC only when timer is ready. run_oc_heist_npc_only enforces oc_cooldown_until (6h/4h) and sets next cooldown."""
    import server as srv
    from routers.oc import run_oc_heist_npc_only
    from security import send_telegram_to_chat

    db = srv.db
    await asyncio.sleep(90)
    while True:
        if not await get_auto_rank_enabled(db):
            await asyncio.sleep(10)
            continue
        now = datetime.now(timezone.utc)
        try:
            cursor = db.users.find(
                {"auto_rank_purchased": True, "auto_rank_enabled": True, "auto_rank_oc": True},
                {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1, "telegram_bot_token": 1, "auto_rank_oc_retry_at": 1},
            )
            users = await cursor.to_list(500)
            user_oc_list = await db.user_organised_crime.find(
                {"user_id": {"$in": [u["id"] for u in users]}},
                {"_id": 0, "user_id": 1, "selected_equipment": 1},
            ).to_list(500)
            user_oc_by_id = {doc["user_id"]: doc.get("selected_equipment", "basic") for doc in user_oc_list}
            for u in users:
                retry_at = _parse_iso(u.get("auto_rank_oc_retry_at"))
                if retry_at and now < retry_at:
                    continue
                chat_id = (u.get("telegram_chat_id") or "").strip()
                bot_token = (u.get("telegram_bot_token") or "").strip() or None
                selected_equipment = user_oc_by_id.get(u["id"], "basic")
                try:
                    result = await run_oc_heist_npc_only(u["id"], selected_equipment_override=selected_equipment)
                    if result.get("skipped_afford"):
                        retry_until = datetime.fromtimestamp(now.timestamp() + OC_RETRY_AFTER_AFFORD_SECONDS, tz=timezone.utc)
                        await db.users.update_one({"id": u["id"]}, {"$set": {"auto_rank_oc_retry_at": retry_until.isoformat()}})
                        continue
                    if chat_id and result.get("ran") is True and result.get("success") is True:
                        msg = f"**Auto Rank** — {u.get('username', '?')}\n\n**OC** — {result.get('message', 'Heist done')}."
                        await send_telegram_to_chat(chat_id, msg, bot_token)
                    if result.get("ran"):
                        await db.users.update_one({"id": u["id"]}, {"$unset": {"auto_rank_oc_retry_at": ""}})
                except Exception as e:
                    logger.exception("Auto rank OC for user %s: %s", u.get("id"), e)
                await asyncio.sleep(0.5)
        except Exception as e:
            logger.exception("Auto rank OC cycle failed: %s", e)
        await asyncio.sleep(OC_LOOP_INTERVAL_SECONDS)


async def run_auto_rank_loop():
    """Main background loop: process due users and booze arrivals."""
    import server as srv
    db = srv.db
    await asyncio.sleep(60)
    while True:
        config = await get_auto_rank_config(db)
        if not config["enabled"]:
            await asyncio.sleep(10)
            continue
        try:
            await run_booze_arrivals()
        except Exception as e:
            logger.exception("Auto rank booze arrivals failed: %s", e)
        try:
            await run_auto_rank_due_users(interval_seconds=config["interval_seconds"])
        except Exception as e:
            logger.exception("Auto rank due-users run failed: %s", e)
        await asyncio.sleep(LOOP_WAKE_SECONDS)


# ─── API routes ───────────────────────────────────────────────────

_PREFERENCE_FIELDS = ["auto_rank_enabled", "auto_rank_crimes", "auto_rank_gta", "auto_rank_bust_every_5_sec", "auto_rank_oc", "auto_rank_booze"]
_PREFERENCE_DEFAULTS = {"auto_rank_enabled": False, "auto_rank_crimes": True, "auto_rank_gta": True, "auto_rank_bust_every_5_sec": False, "auto_rank_oc": False, "auto_rank_booze": False}


def _extract_preferences(user: dict) -> dict:
    return {k: user.get(k, _PREFERENCE_DEFAULTS[k]) for k in _PREFERENCE_FIELDS}


def register(router):
    import server as srv
    from fastapi import Depends, HTTPException
    from pydantic import BaseModel

    db = srv.db
    get_current_user = srv.get_current_user
    _is_admin = srv._is_admin

    class IntervalBody(BaseModel):
        interval_seconds: Optional[int] = None

    class MePreferencesBody(BaseModel):
        auto_rank_enabled: Optional[bool] = None
        auto_rank_crimes: Optional[bool] = None
        auto_rank_gta: Optional[bool] = None
        auto_rank_bust_every_5_sec: Optional[bool] = None
        auto_rank_oc: Optional[bool] = None
        auto_rank_booze: Optional[bool] = None

    @router.get("/auto-rank/me")
    async def get_my_preferences(current_user: dict = Depends(get_current_user)):
        chat_id = (current_user.get("telegram_chat_id") or "").strip()
        prefs = _extract_preferences(current_user)
        prefs["auto_rank_purchased"] = current_user.get("auto_rank_purchased", False) or current_user.get("auto_rank_enabled", False)
        prefs["telegram_chat_id_set"] = bool(chat_id)
        return prefs

    @router.get("/auto-rank/stats")
    async def get_auto_rank_stats(current_user: dict = Depends(get_current_user)):
        u = await db.users.find_one(
            {"id": current_user["id"]},
            {"_id": 0, "auto_rank_stats_since": 1, "auto_rank_total_busts": 1, "auto_rank_total_crimes": 1, "auto_rank_total_gtas": 1, "auto_rank_total_cash": 1, "auto_rank_best_cars": 1, "auto_rank_total_booze_runs": 1, "auto_rank_total_booze_profit": 1, "oc_cooldown_until": 1},
        )
        now = datetime.now(timezone.utc)
        since = _parse_iso((u or {}).get("auto_rank_stats_since"))
        has_activity = bool((u or {}).get("auto_rank_total_busts") or (u or {}).get("auto_rank_total_crimes") or (u or {}).get("auto_rank_total_gtas") or (u or {}).get("auto_rank_total_booze_runs"))
        if not since and has_activity:
            await db.users.update_one({"id": current_user["id"]}, {"$set": {"auto_rank_stats_since": now.isoformat()}})
            since = now
        running_seconds = int((now - since).total_seconds()) if since and since <= now else 0
        best_cars = (u or {}).get("auto_rank_best_cars") or []
        oc_until = (u or {}).get("oc_cooldown_until")
        next_oc_at = None
        if oc_until:
            until_dt = _parse_iso(oc_until)
            if until_dt and until_dt > now:
                next_oc_at = oc_until
        return {
            "total_busts": int((u or {}).get("auto_rank_total_busts") or 0),
            "total_crimes": int((u or {}).get("auto_rank_total_crimes") or 0),
            "total_gtas": int((u or {}).get("auto_rank_total_gtas") or 0),
            "total_cash": int((u or {}).get("auto_rank_total_cash") or 0),
            "stats_since": (u or {}).get("auto_rank_stats_since"),
            "running_seconds": max(0, running_seconds),
            "best_cars": [{"name": c.get("name", "?"), "value": int(c.get("value", 0) or 0)} for c in best_cars],
            "total_booze_runs": int((u or {}).get("auto_rank_total_booze_runs") or 0),
            "total_booze_profit": int((u or {}).get("auto_rank_total_booze_profit") or 0),
            "next_oc_at": next_oc_at,
        }

    @router.patch("/auto-rank/me")
    async def patch_my_preferences(body: MePreferencesBody, current_user: dict = Depends(get_current_user)):
        user_id = current_user["id"]
        updates = {}
        if body.auto_rank_enabled is not None:
            can_enable = current_user.get("auto_rank_purchased") or current_user.get("auto_rank_enabled")
            if body.auto_rank_enabled and not can_enable:
                raise HTTPException(status_code=400, detail="Buy Auto Rank from the Store first.")
            updates["auto_rank_enabled"] = body.auto_rank_enabled
            if body.auto_rank_enabled is False:
                # Disabling Auto Rank also turns off all activity toggles
                for f in ["auto_rank_crimes", "auto_rank_gta", "auto_rank_bust_every_5_sec", "auto_rank_oc", "auto_rank_booze"]:
                    updates[f] = False
        for field in ["auto_rank_crimes", "auto_rank_gta", "auto_rank_bust_every_5_sec", "auto_rank_oc", "auto_rank_booze"]:
            val = getattr(body, field, None)
            if val is not None:
                updates[field] = val
        if not updates:
            return {"message": "No changes", **_extract_preferences(current_user)}
        op = {"$set": updates}
        if updates.get("auto_rank_enabled") is False:
            op["$unset"] = {"auto_rank_stats_since": ""}
        await db.users.update_one({"id": user_id}, op)
        updated = await db.users.find_one({"id": user_id}, {"_id": 0, **{f: 1 for f in _PREFERENCE_FIELDS}})
        return {"message": "Preferences saved", **_extract_preferences(updated)}

    @router.get("/auto-rank/interval")
    async def get_interval(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        config = await get_auto_rank_config(db)
        return {"interval_seconds": config["interval_seconds"], "min_interval_seconds": MIN_INTERVAL_SECONDS, "enabled": config["enabled"]}

    @router.post("/auto-rank/start")
    async def start_auto_rank(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        await db.game_config.update_one({"id": GAME_CONFIG_ID}, {"$set": {"enabled": True}}, upsert=True)
        _invalidate_auto_rank_config_cache()
        return {"enabled": True, "message": "Auto Rank started."}

    @router.post("/auto-rank/stop")
    async def stop_auto_rank(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        await db.game_config.update_one({"id": GAME_CONFIG_ID}, {"$set": {"enabled": False}}, upsert=True)
        _invalidate_auto_rank_config_cache()
        return {"enabled": False, "message": "Auto Rank stopped. Current cycle will finish, then no new cycles until started."}

    @router.patch("/auto-rank/interval")
    async def set_interval(body: IntervalBody, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        try:
            val = int(body.interval_seconds) if body.interval_seconds is not None else DEFAULT_INTERVAL_SECONDS
        except (TypeError, ValueError):
            val = DEFAULT_INTERVAL_SECONDS
        interval = max(MIN_INTERVAL_SECONDS, val)
        await db.game_config.update_one({"id": GAME_CONFIG_ID}, {"$set": {"interval_seconds": interval}}, upsert=True)
        _invalidate_auto_rank_config_cache()
        return {"interval_seconds": interval, "message": f"Auto Rank will run every {interval} seconds after each cycle."}

    class AdminUserUpdateBody(BaseModel):
        telegram_chat_id: Optional[str] = None
        telegram_bot_token: Optional[str] = None
        auto_rank_enabled: Optional[bool] = None

    @router.get("/admin/auto-rank/users")
    async def admin_list_auto_rank_users(
        online_only: bool = Query(False, description="If true, return only users currently online"),
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        now = datetime.now(timezone.utc)
        five_min_ago = now - timedelta(minutes=5)
        query = {"is_dead": {"$ne": True}, "$or": [{"auto_rank_purchased": True}, {"auto_rank_enabled": True}]}
        if online_only:
            query = {
                "is_dead": {"$ne": True},
                "$or": [{"auto_rank_purchased": True}, {"auto_rank_enabled": True}],
                "$and": [
                    {"$or": [
                        {"last_seen": {"$gte": five_min_ago.isoformat()}},
                        {"forced_online_until": {"$gt": now.isoformat()}},
                        {"auto_rank_enabled": True},
                    ]},
                ],
            }
        cursor = db.users.find(
            query,
            {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1, "telegram_bot_token": 1, "last_seen": 1, "forced_online_until": 1, **{f: 1 for f in _PREFERENCE_FIELDS}},
        )
        users = await cursor.to_list(500)

        def _is_online(u):
            if u.get("auto_rank_enabled"):
                return True
            ls = u.get("last_seen")
            if ls:
                try:
                    ts = datetime.fromisoformat(ls.replace("Z", "+00:00") if ls.endswith("Z") else ls)
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    if ts >= five_min_ago:
                        return True
                except Exception:
                    pass
            fu = u.get("forced_online_until")
            if fu:
                try:
                    ts = datetime.fromisoformat(fu.replace("Z", "+00:00") if fu.endswith("Z") else fu)
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    if ts > now:
                        return True
                except Exception:
                    pass
            return False

        return {
            "users": [
                {
                    "id": u.get("id"),
                    "username": u.get("username"),
                    "online": _is_online(u),
                    **_extract_preferences(u),
                    "telegram_chat_id": u.get("telegram_chat_id") or "",
                    "telegram_bot_token": u.get("telegram_bot_token") or "",
                }
                for u in users
            ],
        }

    @router.patch("/admin/auto-rank/users/{username}")
    async def admin_update_auto_rank_user(username: str, body: AdminUserUpdateBody, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        import re
        username_ci = re.compile("^" + re.escape(username.strip()) + "$", re.IGNORECASE) if username else None
        if not username_ci:
            raise HTTPException(status_code=400, detail="Username required")
        target = await db.users.find_one({"username": username_ci}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        updates = {}
        if body.telegram_chat_id is not None:
            updates["telegram_chat_id"] = (body.telegram_chat_id or "").strip() or None
        if body.telegram_bot_token is not None:
            updates["telegram_bot_token"] = (body.telegram_bot_token or "").strip() or None
        if body.auto_rank_enabled is not None:
            updates["auto_rank_enabled"] = body.auto_rank_enabled
            if body.auto_rank_enabled is False:
                for f in ["auto_rank_crimes", "auto_rank_gta", "auto_rank_bust_every_5_sec", "auto_rank_oc", "auto_rank_booze"]:
                    updates[f] = False
        if not updates:
            return {"message": "No changes", "username": target.get("username")}
        op = {"$set": updates}
        if updates.get("auto_rank_enabled") is False:
            op["$unset"] = {"auto_rank_stats_since": ""}
        await db.users.update_one({"id": target["id"]}, op)
        updated = await db.users.find_one({"id": target["id"]}, {"_id": 0, "auto_rank_enabled": 1, "telegram_chat_id": 1, "telegram_bot_token": 1})
        return {
            "message": "Updated",
            "username": target.get("username"),
            "auto_rank_enabled": updated.get("auto_rank_enabled", False),
            "telegram_chat_id": updated.get("telegram_chat_id") or "",
            "telegram_bot_token": updated.get("telegram_bot_token") or "",
        }

    _WIPE_STATS_FIELDS = [
        "auto_rank_stats_since", "auto_rank_total_busts", "auto_rank_total_crimes",
        "auto_rank_total_gtas", "auto_rank_total_cash", "auto_rank_best_cars",
        "auto_rank_total_booze_runs", "auto_rank_total_booze_profit",
    ]

    @router.post("/admin/auto-rank/wipe-stats")
    async def admin_wipe_auto_rank_stats(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        unset = {f: "" for f in _WIPE_STATS_FIELDS}
        result = await db.users.update_many({}, {"$unset": unset})
        return {"message": "All auto rank stats wiped", "modified_count": result.modified_count}
