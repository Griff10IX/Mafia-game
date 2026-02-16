# Auto Rank: background task that auto-commits crimes and GTA for users who bought it, sends results to Telegram
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

MIN_INTERVAL_SECONDS = 5
DEFAULT_INTERVAL_SECONDS = 2 * 60  # 2 minutes
GAME_CONFIG_ID = "auto_rank"
BUST_EVERY_5SEC_INTERVAL = 5
CRIMES_GTA_MIN_INTERVAL_WHEN_BUST_5SEC = 30  # 30 seconds when jail empty (bust-every-5s fallback)


async def get_auto_rank_interval_seconds(db) -> int:
    """Return configured interval (seconds) between full cycles. Min MIN_INTERVAL_SECONDS."""
    doc = await db.game_config.find_one({"id": GAME_CONFIG_ID}, {"_id": 0, "interval_seconds": 1})
    raw = doc.get("interval_seconds") if doc else None
    try:
        val = int(raw) if raw is not None else DEFAULT_INTERVAL_SECONDS
    except (TypeError, ValueError):
        val = DEFAULT_INTERVAL_SECONDS
    return max(MIN_INTERVAL_SECONDS, val)


async def get_auto_rank_enabled(db) -> bool:
    """Return whether the Auto Rank loop is allowed to run (start/stop). Default True."""
    doc = await db.game_config.find_one({"id": GAME_CONFIG_ID}, {"_id": 0, "enabled": 1})
    if doc is None:
        return True
    return doc.get("enabled", True)


def _parse_iso(s):
    if not s:
        return None
    if hasattr(s, "year"):
        return s
    try:
        return datetime.fromisoformat(str(s).strip().replace("Z", "+00:00"))
    except Exception:
        return None


async def _ensure_stats_since(db, user_id: str, now: datetime):
    """Set auto_rank_stats_since to now if not already set."""
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "auto_rank_stats_since": 1})
    if u and not u.get("auto_rank_stats_since"):
        await db.users.update_one({"id": user_id}, {"$set": {"auto_rank_stats_since": now.isoformat()}})


async def _update_auto_rank_stats_bust(db, user_id: str, cash: int, now: datetime):
    """Record one successful bust: increment total_busts, add cash, ensure stats_since."""
    await _ensure_stats_since(db, user_id, now)
    await db.users.update_one(
        {"id": user_id},
        {"$inc": {"auto_rank_total_busts": 1, "auto_rank_total_cash": cash}},
    )


async def _update_auto_rank_stats_crimes(db, user_id: str, count: int, cash: int, now: datetime):
    """Record crime run: increment total_crimes, add cash, ensure stats_since."""
    if count <= 0 and cash <= 0:
        return
    await _ensure_stats_since(db, user_id, now)
    await db.users.update_one(
        {"id": user_id},
        {"$inc": {"auto_rank_total_crimes": count, "auto_rank_total_cash": cash}},
    )


async def _update_auto_rank_stats_gta(db, user_id: str, car: dict, now: datetime):
    """Record one successful GTA: increment total_gtas, add car to best_cars (top 3 by value)."""
    await _ensure_stats_since(db, user_id, now)
    car_name = (car or {}).get("name") or "Car"
    car_value = int((car or {}).get("value", 0) or 0)
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "auto_rank_best_cars": 1})
    best = list((u or {}).get("auto_rank_best_cars") or [])
    best.append({"name": car_name, "value": car_value})
    best.sort(key=lambda x: x.get("value", 0), reverse=True)
    best = best[:3]
    await db.users.update_one(
        {"id": user_id},
        {
            "$inc": {"auto_rank_total_gtas": 1},
            "$set": {"auto_rank_best_cars": best},
        },
    )


async def _update_auto_rank_stats_booze(db, user_id: str, now: datetime, profit: int = 0):
    """Record one completed booze run (sell for profit)."""
    await _ensure_stats_since(db, user_id, now)
    await db.users.update_one(
        {"id": user_id},
        {"$inc": {"auto_rank_total_booze_runs": 1, "auto_rank_total_booze_profit": max(0, int(profit))}},
    )


async def _send_jail_notification(telegram_chat_id: str, username: str, reason: str, jail_seconds: int = 30, bot_token: Optional[str] = None):
    """Send an immediate Telegram when Auto Rank puts the user in jail (bust/crime/GTA failed). No-op if no chat_id."""
    if not (telegram_chat_id or "").strip():
        return
    from security import send_telegram_to_chat
    msg = f"**Auto Rank** — {username}\n\n🔒 You're in jail ({reason}). {jail_seconds}s."
    await send_telegram_to_chat(telegram_chat_id, msg, bot_token)


async def _run_booze_for_user(db, user_id: str, username: str, telegram_chat_id: str, bot_token: Optional[str], now: datetime, lines: list) -> bool:
    """Run one booze step: apply travel arrival, then sell if carrying else buy and start travel. Returns True if any action succeeded."""
    from server import STATES
    from routers.booze_run import (
        BOOZE_TYPES,
        _booze_round_trip_cities,
        _booze_prices_for_rotation,
        _booze_user_capacity,
        _booze_user_carrying_total,
        _booze_buy_impl,
        _booze_sell_impl,
    )
    from routers.airport import _start_travel_impl
    from security import send_telegram_to_chat

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return False
    # Apply travel arrival if due (we don't go through get_current_user in this loop)
    arrives_at = user.get("travel_arrives_at")
    if arrives_at:
        try:
            arrives_dt = _parse_iso(arrives_at)
            if arrives_dt and now >= arrives_dt:
                dest = user.get("traveling_to")
                if dest:
                    await db.users.update_one(
                        {"id": user_id},
                        {"$set": {"current_state": dest}, "$unset": {"traveling_to": "", "travel_arrives_at": ""}},
                    )
                    user = await db.users.find_one({"id": user_id}, {"_id": 0})
        except Exception:
            pass
    if not user:
        return False
    if user.get("in_jail"):
        return False
    if user.get("travel_arrives_at"):
        try:
            adt = _parse_iso(user["travel_arrives_at"])
            if adt and now < adt:
                return False
        except Exception:
            pass

    round_trip = _booze_round_trip_cities()
    if not round_trip or len(round_trip) < 2:
        return False
    city_a, city_b = round_trip[0], round_trip[1]
    current = (user.get("current_state") or "").strip()

    # If not at a round-trip city, travel to the buy city (city_a) first so we can start the run
    if current not in (city_a, city_b):
        travel_method = None
        first_custom = await db.user_cars.find_one({"user_id": user_id, "car_id": "car_custom"}, {"_id": 0, "id": 1})
        if first_custom:
            travel_method = "custom"
        else:
            first_car = await db.user_cars.find_one({"user_id": user_id}, {"_id": 0, "id": 1})
            if first_car:
                travel_method = first_car.get("id") or str(first_car.get("_id", ""))
        if travel_method:
            try:
                await _start_travel_impl(user, city_a, travel_method, airport_slot=None, booze_run=True)
                lines.append(f"**Booze** — Traveling to {city_a} to start run.")
                return True
            except Exception as e:
                logger.exception("Auto rank booze travel to buy city %s: %s", user_id, e)
        return False

    prices_map = _booze_prices_for_rotation()
    capacity = _booze_user_capacity(user)
    carrying = dict(user.get("booze_carrying") or {})
    carrying_total = _booze_user_carrying_total(carrying)
    money = int(user.get("money") or 0)
    idx_a = STATES.index(city_a) if city_a in STATES else 0
    idx_b = STATES.index(city_b) if city_b in STATES else 1

    has_success = False

    buy_location_by_booze = dict((user.get("booze_buy_location") or {}).items())

    if current == city_a:
        if carrying_total > 0:
            for bid, amt in list(carrying.items()):
                amt = int(amt or 0)
                if amt <= 0:
                    continue
                if buy_location_by_booze.get(bid) == city_a:
                    continue  # don't sell in same city we bought (must travel first)
                try:
                    out = await _booze_sell_impl(user, bid, amt)
                    if out.get("caught"):
                        await _send_jail_notification(telegram_chat_id, username, "booze sell bust", 20, bot_token)
                        return False
                    profit = out.get("profit") or 0
                    if out.get("is_run") and profit:
                        lines.append(f"**Booze** — Sold {amt} for ${profit:,} profit.")
                        await _update_auto_rank_stats_booze(db, user_id, now, profit)
                        has_success = True
                    user = await db.users.find_one({"id": user_id}, {"_id": 0})
                    if not user:
                        return has_success
                    carrying = dict(user.get("booze_carrying") or {})
                    buy_location_by_booze = dict((user.get("booze_buy_location") or {}).items())
                except Exception as e:
                    logger.exception("Auto rank booze sell %s: %s", user_id, e)
                    break
        else:
            best_profit = -1
            best_booze_id = None
            buy_price_a = 400
            for i, bt in enumerate(BOOZE_TYPES):
                pa = prices_map.get((idx_a, i), 400)
                pb = prices_map.get((idx_b, i), 400)
                if pb - pa > best_profit:
                    best_profit = pb - pa
                    best_booze_id = bt["id"]
                    buy_price_a = pa
            if best_booze_id and best_profit > 0 and buy_price_a > 0:
                amount = min(capacity, money // buy_price_a)
                if amount > 0:
                    try:
                        out = await _booze_buy_impl(user, best_booze_id, amount)
                        if out.get("caught"):
                            await _send_jail_notification(telegram_chat_id, username, "booze buy bust", 20, bot_token)
                            return False
                        user = await db.users.find_one({"id": user_id}, {"_id": 0})
                        if not user:
                            return True
                        travel_method = None
                        first_custom = await db.user_cars.find_one({"user_id": user_id, "car_id": "car_custom"}, {"_id": 0, "id": 1})
                        if first_custom:
                            travel_method = "custom"
                        else:
                            first_car = await db.user_cars.find_one({"user_id": user_id}, {"_id": 0, "id": 1})
                            if first_car:
                                travel_method = first_car.get("id") or str(first_car.get("_id", ""))
                        if travel_method:
                            await _start_travel_impl(user, city_b, travel_method, airport_slot=None, booze_run=True)
                            lines.append(f"**Booze** — Bought {amount} at {city_a}, traveling to {city_b}.")
                            has_success = True
                    except HTTPException:
                        pass
                    except Exception as e:
                        logger.exception("Auto rank booze buy/travel %s: %s", user_id, e)

    elif current == city_b:
        if carrying_total > 0:
            for bid, amt in list(carrying.items()):
                amt = int(amt or 0)
                if amt <= 0:
                    continue
                if buy_location_by_booze.get(bid) == city_b:
                    continue  # don't sell in same city we bought (must travel first)
                try:
                    out = await _booze_sell_impl(user, bid, amt)
                    if out.get("caught"):
                        await _send_jail_notification(telegram_chat_id, username, "booze sell bust", 20, bot_token)
                        return False
                    profit = out.get("profit") or 0
                    if out.get("is_run") and profit:
                        lines.append(f"**Booze** — Sold {amt} for ${profit:,} profit.")
                        await _update_auto_rank_stats_booze(db, user_id, now, profit)
                        has_success = True
                    user = await db.users.find_one({"id": user_id}, {"_id": 0})
                    if not user:
                        return has_success
                    carrying = dict(user.get("booze_carrying") or {})
                    buy_location_by_booze = dict((user.get("booze_buy_location") or {}).items())
                except Exception as e:
                    logger.exception("Auto rank booze sell %s: %s", user_id, e)
                    break
        else:
            best_profit = -1
            best_booze_id = None
            buy_price_b = 400
            for i, bt in enumerate(BOOZE_TYPES):
                pb = prices_map.get((idx_b, i), 400)
                pa = prices_map.get((idx_a, i), 400)
                if pa - pb > best_profit:
                    best_profit = pa - pb
                    best_booze_id = bt["id"]
                    buy_price_b = pb
            if best_booze_id and best_profit > 0 and buy_price_b > 0:
                amount = min(capacity, money // buy_price_b)
                if amount > 0:
                    try:
                        out = await _booze_buy_impl(user, best_booze_id, amount)
                        if out.get("caught"):
                            await _send_jail_notification(telegram_chat_id, username, "booze buy bust", 20, bot_token)
                            return False
                        user = await db.users.find_one({"id": user_id}, {"_id": 0})
                        if not user:
                            return True
                        travel_method = None
                        first_custom = await db.user_cars.find_one({"user_id": user_id, "car_id": "car_custom"}, {"_id": 0, "id": 1})
                        if first_custom:
                            travel_method = "custom"
                        else:
                            first_car = await db.user_cars.find_one({"user_id": user_id}, {"_id": 0, "id": 1})
                            if first_car:
                                travel_method = first_car.get("id") or str(first_car.get("_id", ""))
                        if travel_method:
                            await _start_travel_impl(user, city_a, travel_method, airport_slot=None, booze_run=True)
                            lines.append(f"**Booze** — Bought {amount} at {city_b}, traveling to {city_a}.")
                            has_success = True
                    except HTTPException:
                        pass
                    except Exception as e:
                        logger.exception("Auto rank booze buy/travel %s: %s", user_id, e)

    return has_success


async def _run_bust_only_for_user(user_id: str, username: str, telegram_chat_id: str, bot_token: Optional[str] = None):
    """Try one jail bust (regardless of whether user is in jail), send result to Telegram. Used by the 5-sec bust loop."""
    import server as srv
    from routers.jail import _attempt_bust_impl
    from security import send_telegram_to_chat

    db = srv.db
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return
    token = bot_token or (user.get("telegram_bot_token") or "").strip()
    bust_target_username = None
    npc = await db.jail_npcs.find_one({}, {"_id": 0, "username": 1})
    if npc:
        bust_target_username = npc.get("username")
    if not bust_target_username:
        jailed = await db.users.find_one(
            {"in_jail": True, "id": {"$ne": user_id}},
            {"_id": 0, "username": 1},
        )
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


async def _run_auto_rank_for_user(user_id: str, username: str, telegram_chat_id: str, bot_token: Optional[str] = None):
    """Commit all crimes that are off cooldown, then one GTA (if off cooldown); send summary to Telegram. When bust_every_5_sec, skip bust here and only run crimes+GTA every 5+ mins."""
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

    if not bust_every_5 and user.get("in_jail"):
        return

    lines = [f"**Auto Rank** — {username}", ""]
    has_success = False

    # Busts only run for users with "Jail bust every 5 seconds" on (via run_bust_5sec_loop). Main cycle does not do busts.

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return
    if user.get("in_jail"):
        if bust_every_5:
            await db.users.update_one(
                {"id": user_id},
                {"$set": {"auto_rank_last_crimes_gta_at": now.isoformat()}},
            )
        return

    run_crimes = user.get("auto_rank_crimes", True)
    run_gta = user.get("auto_rank_gta", True)
    if bust_every_5:
        run_crimes = True
        run_gta = True

    # --- Crimes: commit ALL that are off cooldown and rank-eligible (loop until none left) ---
    if run_crimes:
        crimes = await db.crimes.find({}, {"_id": 0, "id": 1, "name": 1, "min_rank": 1}).to_list(50)
        crime_success_count = 0
        crime_fail_count = 0
        crime_total_cash = 0
        crime_total_rp = 0  # 3 RP per successful crime
        while True:
            user = await db.users.find_one({"id": user_id}, {"_id": 0})
            if not user or user.get("in_jail"):
                break
            user_crimes = await db.user_crimes.find({"user_id": user_id}, {"_id": 0, "crime_id": 1, "cooldown_until": 1}).to_list(100)
            cooldown_by_crime = {uc["crime_id"]: _parse_iso(uc.get("cooldown_until")) for uc in user_crimes}
            rank_id, _ = get_rank_info(int(user.get("rank_points") or 0))
            available = [
                c for c in crimes
                if c["min_rank"] <= rank_id
                and (cooldown_by_crime.get(c["id"]) is None or cooldown_by_crime.get(c["id"]) <= now)
            ]
            if not available:
                break
            c = available[0]
            try:
                out = await _commit_crime_impl(c["id"], user)
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
            parts = [f"Committed {crime_success_count} crime(s)", f"earned ${crime_total_cash:,} and {crime_total_rp} RP"]
            lines.append("**Crimes** — " + ". ".join(parts) + ".")

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return
    if user.get("in_jail"):
        if bust_every_5:
            await db.users.update_one(
                {"id": user_id},
                {"$set": {"auto_rank_last_crimes_gta_at": now.isoformat()}},
            )
        return

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
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"auto_rank_last_crimes_gta_at": now.isoformat()}},
        )

    # --- Booze running: buy at one round-trip city, travel, sell at the other (when enabled) ---
    run_booze = user.get("auto_rank_booze", False)
    if run_booze:
        try:
            booze_success = await _run_booze_for_user(db, user_id, username, telegram_chat_id, bot_token, now, lines)
            if booze_success:
                has_success = True
        except Exception as e:
            logger.exception("Auto rank booze for %s: %s", user_id, e)

    if has_success and (telegram_chat_id or "").strip():
        lines.append("")
        await send_telegram_to_chat(telegram_chat_id, "\n".join(lines), token)


async def run_booze_arrivals():
    """Run booze for users who have just arrived (travel_arrives_at <= now) so they sell immediately after travel instead of waiting for the next full tick."""
    import server as srv
    from security import send_telegram_to_chat

    db = srv.db
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    cursor = db.users.find(
        {
            "auto_rank_enabled": True,
            "auto_rank_booze": True,
            "travel_arrives_at": {"$lte": now_iso},
            "in_jail": {"$ne": True},
        },
        {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1, "telegram_bot_token": 1},
    )
    users = await cursor.to_list(200)
    for u in users:
        chat_id = (u.get("telegram_chat_id") or "").strip()
        bot_token = (u.get("telegram_bot_token") or "").strip() or None
        lines = [f"**Auto Rank** — {u.get('username', '?')}", ""]
        try:
            has_success = await _run_booze_for_user(
                db, u["id"], u.get("username", "?"), chat_id, bot_token, now, lines
            )
            if has_success and len(lines) > 2 and chat_id:
                msg = "\n".join(lines)
                await send_telegram_to_chat(chat_id, msg, bot_token)
        except Exception as e:
            logger.exception("Auto rank booze arrival for user %s: %s", u.get("id"), e)
        await asyncio.sleep(0.2)


async def run_auto_rank_due_users():
    """Find users whose auto_rank_next_run_at is due (or unset), run each once, set their next_run_at = now + interval. Per-user cycles so everyone gets the interval they expect."""
    import server as srv
    db = srv.db
    now = datetime.now(timezone.utc)
    interval = await get_auto_rank_interval_seconds(db)
    cursor = db.users.find(
        {
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
    next_run = (now.timestamp() + interval)
    next_run_iso = datetime.fromtimestamp(next_run, tz=timezone.utc).isoformat()
    for u in users:
        chat_id = (u.get("telegram_chat_id") or "").strip()
        bot_token = (u.get("telegram_bot_token") or "").strip() or None
        try:
            await _run_auto_rank_for_user(u["id"], u.get("username", "?"), chat_id, bot_token)
        except Exception as e:
            logger.exception("Auto rank for user %s: %s", u.get("id"), e)
        await db.users.update_one(
            {"id": u["id"]},
            {"$set": {"auto_rank_next_run_at": next_run_iso}},
        )
        await asyncio.sleep(0.5)


async def run_bust_5sec_loop():
    """Background loop: every 5 sec, for users with auto_rank_bust_every_5_sec, try one jail bust (regardless of jail). Respects global enabled."""
    import server as srv
    db = srv.db
    await asyncio.sleep(15)  # Start shortly after main loop
    while True:
        if not await get_auto_rank_enabled(db):
            await asyncio.sleep(10)
            continue
        try:
            cursor = db.users.find(
                {
                    "auto_rank_enabled": True,
                    "auto_rank_bust_every_5_sec": True,
                },
                {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1, "telegram_bot_token": 1},
            )
            users = await cursor.to_list(500)
            for u in users:
                chat_id = (u.get("telegram_chat_id") or "").strip()
                bot_token = (u.get("telegram_bot_token") or "").strip()
                try:
                    bust_target_username = None
                    npc = await db.jail_npcs.find_one({}, {"_id": 0, "username": 1})
                    if npc:
                        bust_target_username = npc.get("username")
                    if not bust_target_username:
                        jailed = await db.users.find_one(
                            {"in_jail": True, "id": {"$ne": u["id"]}},
                            {"_id": 0, "username": 1},
                        )
                        if jailed:
                            bust_target_username = jailed.get("username")
                    if bust_target_username:
                        await _run_bust_only_for_user(u["id"], u.get("username", "?"), chat_id, bot_token or None)
                    else:
                        await _run_auto_rank_for_user(u["id"], u.get("username", "?"), chat_id, bot_token or None)
                except Exception as e:
                    logger.exception("Auto rank bust 5sec for user %s: %s", u.get("id"), e)
                await asyncio.sleep(0.3)
        except Exception as e:
            logger.exception("Bust 5sec cycle failed: %s", e)
        await asyncio.sleep(BUST_EVERY_5SEC_INTERVAL)


LOOP_WAKE_SECONDS = 15  # How often we check who's due for a run
OC_LOOP_INTERVAL_SECONDS = 60  # How often we check OC timer for auto-rank OC users
OC_RETRY_AFTER_AFFORD_SECONDS = 10 * 60  # 10 minutes if user can't afford an OC


async def run_auto_rank_oc_loop():
    """Background loop: every OC_LOOP_INTERVAL_SECONDS, for users with auto_rank_oc, run OC with NPC only when timer is ready. Skip if can't afford and retry in 10 min."""
    import server as srv
    from routers.oc import run_oc_heist_npc_only
    from security import send_telegram_to_chat

    db = srv.db
    await asyncio.sleep(90)  # Start after main loops
    while True:
        if not await get_auto_rank_enabled(db):
            await asyncio.sleep(10)
            continue
        now = datetime.now(timezone.utc)
        try:
            cursor = db.users.find(
                {
                    "auto_rank_enabled": True,
                    "auto_rank_oc": True,
                },
                {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1, "telegram_bot_token": 1, "auto_rank_oc_retry_at": 1},
            )
            users = await cursor.to_list(500)
            for u in users:
                retry_at = _parse_iso(u.get("auto_rank_oc_retry_at"))
                if retry_at and now < retry_at:
                    continue
                chat_id = (u.get("telegram_chat_id") or "").strip()
                bot_token = (u.get("telegram_bot_token") or "").strip() or None
                try:
                    result = await run_oc_heist_npc_only(u["id"])
                    if result.get("skipped_afford"):
                        retry_until = datetime.fromtimestamp(now.timestamp() + OC_RETRY_AFTER_AFFORD_SECONDS, tz=timezone.utc)
                        await db.users.update_one(
                            {"id": u["id"]},
                            {"$set": {"auto_rank_oc_retry_at": retry_until.isoformat()}},
                        )
                        continue
                    # Only send Telegram on success when user has chat_id
                    if chat_id and result.get("ran") is True and result.get("success") is True:
                        msg = f"**Auto Rank** — {u.get('username', '?')}\n\n**OC** — {result.get('message', 'Heist done')}."
                        await send_telegram_to_chat(chat_id, msg, bot_token)
                    if result.get("ran"):
                        await db.users.update_one(
                            {"id": u["id"]},
                            {"$unset": {"auto_rank_oc_retry_at": ""}},
                        )
                except Exception as e:
                    logger.exception("Auto rank OC for user %s: %s", u.get("id"), e)
                await asyncio.sleep(0.5)
        except Exception as e:
            logger.exception("Auto rank OC cycle failed: %s", e)
        await asyncio.sleep(OC_LOOP_INTERVAL_SECONDS)


async def run_auto_rank_loop():
    """Background loop: wake every LOOP_WAKE_SECONDS, process any user whose next_run_at is due. Each user has their own cycle (next run = now + interval)."""
    import server as srv
    db = srv.db
    await asyncio.sleep(60)  # Delay first run 1 min after startup
    while True:
        if not await get_auto_rank_enabled(db):
            await asyncio.sleep(10)
            continue
        try:
            await run_booze_arrivals()  # sell right after travel completes (no wait for next tick)
        except Exception as e:
            logger.exception("Auto rank booze arrivals failed: %s", e)
        try:
            await run_auto_rank_due_users()
        except Exception as e:
            logger.exception("Auto rank due-users run failed: %s", e)
        await asyncio.sleep(LOOP_WAKE_SECONDS)


def register(router):
    """Register auto-rank routes: /me for any user (preferences), interval/start/stop for admin."""
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
        """Get current user's Auto Rank preferences. Any authenticated user."""
        chat_id = (current_user.get("telegram_chat_id") or "").strip()
        return {
            "auto_rank_enabled": current_user.get("auto_rank_enabled", False),
            "auto_rank_crimes": current_user.get("auto_rank_crimes", True),
            "auto_rank_gta": current_user.get("auto_rank_gta", True),
            "auto_rank_bust_every_5_sec": current_user.get("auto_rank_bust_every_5_sec", False),
            "auto_rank_oc": current_user.get("auto_rank_oc", False),
            "auto_rank_booze": current_user.get("auto_rank_booze", False),
            "auto_rank_purchased": current_user.get("auto_rank_purchased", False) or current_user.get("auto_rank_enabled", False),
            "telegram_chat_id_set": bool(chat_id),
        }

    @router.get("/auto-rank/stats")
    async def get_auto_rank_stats(current_user: dict = Depends(get_current_user)):
        """Get current user's Auto Rank lifetime stats: busts, crimes, GTAs, cash, running time, best cars, booze runs, next OC at."""
        u = await db.users.find_one(
            {"id": current_user["id"]},
            {
                "_id": 0,
                "auto_rank_stats_since": 1,
                "auto_rank_total_busts": 1,
                "auto_rank_total_crimes": 1,
                "auto_rank_total_gtas": 1,
                "auto_rank_total_cash": 1,
                "auto_rank_best_cars": 1,
                "auto_rank_total_booze_runs": 1,
                "auto_rank_total_booze_profit": 1,
                "oc_cooldown_until": 1,
            },
        )
        now = datetime.now(timezone.utc)
        since = _parse_iso((u or {}).get("auto_rank_stats_since"))
        # One-time backfill: users with stats but no since (e.g. legacy) get since=now so "Running" shows and ticks
        has_activity = bool(
            (u or {}).get("auto_rank_total_busts")
            or (u or {}).get("auto_rank_total_crimes")
            or (u or {}).get("auto_rank_total_gtas")
            or (u or {}).get("auto_rank_total_booze_runs")
        )
        if not since and has_activity:
            now_iso = now.isoformat()
            await db.users.update_one({"id": current_user["id"]}, {"$set": {"auto_rank_stats_since": now_iso}})
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
    async def patch_my_preferences(
        body: MePreferencesBody,
        current_user: dict = Depends(get_current_user),
    ):
        """Update current user's Auto Rank preferences. Enable only if purchased (or already had it)."""
        user_id = current_user["id"]
        updates = {}
        if body.auto_rank_enabled is not None:
            can_enable = current_user.get("auto_rank_purchased") or current_user.get("auto_rank_enabled")
            if body.auto_rank_enabled and not can_enable:
                raise HTTPException(status_code=400, detail="Buy Auto Rank from the Store first (and set Telegram in Profile).")
            updates["auto_rank_enabled"] = body.auto_rank_enabled
        if body.auto_rank_crimes is not None:
            updates["auto_rank_crimes"] = body.auto_rank_crimes
        if body.auto_rank_gta is not None:
            updates["auto_rank_gta"] = body.auto_rank_gta
        if body.auto_rank_bust_every_5_sec is not None:
            updates["auto_rank_bust_every_5_sec"] = body.auto_rank_bust_every_5_sec
        if body.auto_rank_oc is not None:
            updates["auto_rank_oc"] = body.auto_rank_oc
        if body.auto_rank_booze is not None:
            updates["auto_rank_booze"] = body.auto_rank_booze
        if not updates:
            return {"message": "No changes", "auto_rank_enabled": current_user.get("auto_rank_enabled"), "auto_rank_crimes": current_user.get("auto_rank_crimes"), "auto_rank_gta": current_user.get("auto_rank_gta"), "auto_rank_bust_every_5_sec": current_user.get("auto_rank_bust_every_5_sec", False), "auto_rank_oc": current_user.get("auto_rank_oc", False), "auto_rank_booze": current_user.get("auto_rank_booze", False)}
        await db.users.update_one({"id": user_id}, {"$set": updates})
        updated = await db.users.find_one({"id": user_id}, {"_id": 0, "auto_rank_enabled": 1, "auto_rank_crimes": 1, "auto_rank_gta": 1, "auto_rank_bust_every_5_sec": 1, "auto_rank_oc": 1, "auto_rank_booze": 1})
        return {
            "message": "Preferences saved",
            "auto_rank_enabled": updated.get("auto_rank_enabled", False),
            "auto_rank_crimes": updated.get("auto_rank_crimes", True),
            "auto_rank_gta": updated.get("auto_rank_gta", True),
            "auto_rank_bust_every_5_sec": updated.get("auto_rank_bust_every_5_sec", False),
            "auto_rank_oc": updated.get("auto_rank_oc", False),
            "auto_rank_booze": updated.get("auto_rank_booze", False),
        }

    @router.get("/auto-rank/interval")
    async def get_interval(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        interval = await get_auto_rank_interval_seconds(db)
        enabled = await get_auto_rank_enabled(db)
        return {"interval_seconds": interval, "min_interval_seconds": MIN_INTERVAL_SECONDS, "enabled": enabled}

    @router.post("/auto-rank/start")
    async def start_auto_rank(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        await db.game_config.update_one(
            {"id": GAME_CONFIG_ID},
            {"$set": {"enabled": True}},
            upsert=True,
        )
        return {"enabled": True, "message": "Auto Rank started."}

    @router.post("/auto-rank/stop")
    async def stop_auto_rank(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        await db.game_config.update_one(
            {"id": GAME_CONFIG_ID},
            {"$set": {"enabled": False}},
            upsert=True,
        )
        return {"enabled": False, "message": "Auto Rank stopped. Current cycle will finish, then no new cycles until started."}

    @router.patch("/auto-rank/interval")
    async def set_interval(
        body: IntervalBody,
        current_user: dict = Depends(get_current_user),
    ):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        raw = body.interval_seconds
        try:
            val = int(raw) if raw is not None else DEFAULT_INTERVAL_SECONDS
        except (TypeError, ValueError):
            val = DEFAULT_INTERVAL_SECONDS
        interval = max(MIN_INTERVAL_SECONDS, val)
        await db.game_config.update_one(
            {"id": GAME_CONFIG_ID},
            {"$set": {"interval_seconds": interval}},
            upsert=True,
        )
        return {"interval_seconds": interval, "message": f"Auto Rank will run every {interval} seconds after each cycle."}

    class AdminUserUpdateBody(BaseModel):
        telegram_chat_id: Optional[str] = None
        telegram_bot_token: Optional[str] = None
        auto_rank_enabled: Optional[bool] = None

    @router.get("/admin/auto-rank/users")
    async def admin_list_auto_rank_users(current_user: dict = Depends(get_current_user)):
        """List alive users who have Auto Rank purchased. Admin only."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        cursor = db.users.find(
            {
                "is_dead": {"$ne": True},
                "$or": [
                    {"auto_rank_purchased": True},
                    {"auto_rank_enabled": True},
                ],
            },
            {"_id": 0, "id": 1, "username": 1, "auto_rank_enabled": 1, "auto_rank_crimes": 1, "auto_rank_gta": 1, "auto_rank_bust_every_5_sec": 1, "auto_rank_oc": 1, "auto_rank_booze": 1, "telegram_chat_id": 1, "telegram_bot_token": 1},
        )
        users = await cursor.to_list(500)
        return {
            "users": [
                {
                    "id": u.get("id"),
                    "username": u.get("username"),
                    "auto_rank_enabled": u.get("auto_rank_enabled", False),
                    "auto_rank_crimes": u.get("auto_rank_crimes", True),
                    "auto_rank_gta": u.get("auto_rank_gta", True),
                    "auto_rank_bust_every_5_sec": u.get("auto_rank_bust_every_5_sec", False),
                    "auto_rank_oc": u.get("auto_rank_oc", False),
                    "auto_rank_booze": u.get("auto_rank_booze", False),
                    "telegram_chat_id": u.get("telegram_chat_id") or "",
                    "telegram_bot_token": u.get("telegram_bot_token") or "",
                }
                for u in users
            ],
        }

    @router.patch("/admin/auto-rank/users/{username}")
    async def admin_update_auto_rank_user(
        username: str,
        body: AdminUserUpdateBody,
        current_user: dict = Depends(get_current_user),
    ):
        """Update a user's Auto Rank: set telegram_chat_id, telegram_bot_token, or enable/disable. Admin only."""
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
        if not updates:
            return {"message": "No changes", "username": target.get("username")}
        await db.users.update_one({"id": target["id"]}, {"$set": updates})
        updated = await db.users.find_one({"id": target["id"]}, {"_id": 0, "auto_rank_enabled": 1, "telegram_chat_id": 1, "telegram_bot_token": 1})
        return {
            "message": "Updated",
            "username": target.get("username"),
            "auto_rank_enabled": updated.get("auto_rank_enabled", False),
            "telegram_chat_id": updated.get("telegram_chat_id") or "",
            "telegram_bot_token": updated.get("telegram_bot_token") or "",
        }
