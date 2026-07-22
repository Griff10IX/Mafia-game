# Auto Rank: background task that auto-commits crimes and GTA for users who bought it, sends results to Telegram
import asyncio
import hmac
import logging
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Ensure backend/.env is loaded (e.g. when process cwd is not the backend dir)
try:
    from dotenv import load_dotenv
    _backend_dir = Path(__file__).resolve().parent.parent
    load_dotenv(_backend_dir / ".env")
except Exception:
    pass

_auto_rank_config_cache: Optional[dict] = None
_auto_rank_config_cache_until: Optional[datetime] = None
AUTO_RANK_CONFIG_CACHE_SECONDS = 3

from fastapi import HTTPException, Query

logger = logging.getLogger(__name__)

MIN_INTERVAL_SECONDS = 5
DEFAULT_INTERVAL_SECONDS = 5  # run each user every 5s (same as jail busts; min 5s)
GAME_CONFIG_ID = "auto_rank"
MIN_BUST_INTERVAL_SECONDS = 1
DEFAULT_BUST_INTERVAL_SECONDS = 5  # jail bust loop: run every 5 seconds
BUST_EVERY_5SEC_INTERVAL = 5  # fallback when config not used (do not change without updating UI labels)
LOOP_WAKE_SECONDS = 2  # frequent wake so booze arrivals (and sells) processed within ~2s; only remaining delay = travel time
AUTO_RANK_CRIME_COMMIT_INTERVAL_SEC = 5  # pause between consecutive auto-rank crime commits (same user, one cycle)
MIN_OC_INTERVAL_SECONDS = 10
DEFAULT_OC_INTERVAL_SECONDS = 63  # was 60; 5% slower
OC_LOOP_INTERVAL_SECONDS = 63  # fallback when config not used
OC_RETRY_AFTER_AFFORD_SECONDS = 10 * 60
AUTO_RANK_IDLE_TIMEOUT_SECONDS = 24 * 60 * 60  # 24 hours - trial/token users pause if no real activity
_AUTO_RANK_IDLE_CHECK_PROJECTION = {
    "auto_rank_permanent": 1,
    "auto_rank_purchased": 1,
    "auto_rank_trial": 1,
    "auto_rank_email_entitlement": 1,
}


def _auto_rank_env_int(key: str, default: int, lo: int = 1, hi: Optional[int] = None) -> int:
    try:
        v = int((os.environ.get(key) or "").strip() or default)
    except (TypeError, ValueError):
        v = default
    v = max(lo, v)
    if hi is not None:
        v = min(hi, v)
    return v


# Cap parallel crime/GTA/booze work per wake (was up to 30 via asyncio.gather); lowers CPU/Mongo spikes.
AUTO_RANK_MAX_CONCURRENT = _auto_rank_env_int("AUTO_RANK_MAX_CONCURRENT", 8, 1, 64)
# Max due users handled per booze-arrivals / main-loop wake; remainder stay due for the next wake (~2s).
AUTO_RANK_MAX_DUE_PER_WAKE = _auto_rank_env_int("AUTO_RANK_MAX_DUE_PER_WAKE", 40, 1, 500)


async def _gather_with_concurrency(coroutines: list, limit: int):
    """Run awaitables with a semaphore so at most ``limit`` run at once."""
    if not coroutines:
        return []
    lim = max(1, min(int(limit), 128))
    sem = asyncio.Semaphore(lim)

    async def _run(c):
        async with sem:
            return await c

    return await asyncio.gather(*(_run(c) for c in coroutines))


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
    doc = await db.game_config.find_one(
        {"id": GAME_CONFIG_ID},
        {"_id": 0, "enabled": 1, "interval_seconds": 1, "interval_bust_seconds": 1, "interval_oc_seconds": 1},
    )
    if doc is None:
        config = {
            "enabled": True,
            "interval_seconds": DEFAULT_INTERVAL_SECONDS,
            "interval_bust_seconds": DEFAULT_BUST_INTERVAL_SECONDS,
            "interval_oc_seconds": DEFAULT_OC_INTERVAL_SECONDS,
        }
    else:
        try:
            interval = int(doc.get("interval_seconds")) if doc.get("interval_seconds") is not None else DEFAULT_INTERVAL_SECONDS
        except (TypeError, ValueError):
            interval = DEFAULT_INTERVAL_SECONDS
        try:
            bust = int(doc.get("interval_bust_seconds")) if doc.get("interval_bust_seconds") is not None else DEFAULT_BUST_INTERVAL_SECONDS
        except (TypeError, ValueError):
            bust = DEFAULT_BUST_INTERVAL_SECONDS
        try:
            oc = int(doc.get("interval_oc_seconds")) if doc.get("interval_oc_seconds") is not None else DEFAULT_OC_INTERVAL_SECONDS
        except (TypeError, ValueError):
            oc = DEFAULT_OC_INTERVAL_SECONDS
        config = {
            "enabled": doc.get("enabled", True),
            "interval_seconds": max(MIN_INTERVAL_SECONDS, interval),
            "interval_bust_seconds": max(MIN_BUST_INTERVAL_SECONDS, bust),
            "interval_oc_seconds": max(MIN_OC_INTERVAL_SECONDS, oc),
        }
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


def _auto_rank_trial_active(user: dict, now: Optional[datetime] = None) -> bool:
    """True while a timed Auto Rank window (2h tokens, founding trial, etc.) is still running."""
    if _user_has_permanent_auto_rank(user):
        return False
    until = _parse_iso(user.get("auto_rank_trial_until"))
    if until is None:
        return False
    now = now or datetime.now(timezone.utc)
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    return until > now


def _user_has_permanent_auto_rank(user: dict) -> bool:
    """Store/admin permanent unlock (not founding trial or 2h token window)."""
    if not user:
        return False
    if user.get("auto_rank_permanent"):
        return True
    return bool(user.get("auto_rank_purchased")) and not bool(user.get("auto_rank_trial"))


async def _detect_store_permanent_auto_rank(db, user_id: str) -> bool:
    if not user_id:
        return False
    try:
        ev = await db.point_ledger_events.find_one(
            {"user_id": user_id, "event_type": "spend_store", "origin_ref": "buy-auto-rank", "points": {"$lt": 0}},
            {"_id": 1},
        )
        return ev is not None
    except Exception:
        return False


async def _resolve_permanent_auto_rank(db, user: dict, *, heal: bool = False) -> tuple:
    """Return (is_permanent, user_doc). heal=True fixes trial flags on confirmed store buyers."""
    if not user:
        return False, user
    uid = user.get("id")
    if _user_has_permanent_auto_rank(user):
        if heal and uid and (user.get("auto_rank_trial") or user.get("auto_rank_trial_until")):
            await db.users.update_one(
                {"id": uid},
                {
                    "$set": {"auto_rank_permanent": True, "auto_rank_trial": False, "auto_rank_purchased": True},
                    "$unset": {"auto_rank_trial_until": ""},
                },
            )
            user = {**user, "auto_rank_permanent": True, "auto_rank_trial": False, "auto_rank_trial_until": None}
        elif heal and uid and not user.get("auto_rank_permanent"):
            await db.users.update_one({"id": uid}, {"$set": {"auto_rank_permanent": True}})
            user = {**user, "auto_rank_permanent": True}
        return True, user
    if user.get("auto_rank_purchased") and user.get("auto_rank_trial") and uid:
        if await _detect_store_permanent_auto_rank(db, uid):
            if heal:
                await db.users.update_one(
                    {"id": uid},
                    {
                        "$set": {"auto_rank_permanent": True, "auto_rank_trial": False, "auto_rank_purchased": True},
                        "$unset": {"auto_rank_trial_until": ""},
                    },
                )
                user = {**user, "auto_rank_permanent": True, "auto_rank_trial": False, "auto_rank_trial_until": None}
            return True, user
    return False, user


def _user_has_auto_rank_access(user: dict) -> bool:
    """May use Auto Rank (enable master switch). Permanent store purchase or active timed trial."""
    if _user_has_permanent_auto_rank(user):
        return True
    return _auto_rank_trial_active(user)


def _mongo_auto_rank_subscriber_clause(now: Optional[datetime] = None) -> dict:
    """MongoDB filter: permanent Auto Rank purchase or active timed trial (matches _user_has_auto_rank_access)."""
    now = now or datetime.now(timezone.utc)
    now_iso = now.isoformat()
    return {
        "$or": [
            {"auto_rank_permanent": True},
            {"auto_rank_purchased": True, "auto_rank_trial": {"$ne": True}},
            {"auto_rank_trial_until": {"$gt": now_iso}},
        ]
    }


async def _expire_auto_rank_trials(db):
    """Disable auto rank when a timed trial window ends (does not remove permanent store purchase)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    _trial_off = {
        "auto_rank_enabled": False,
        "auto_rank_trial": False,
        "auto_rank_crimes": False,
        "auto_rank_gta": False,
        "auto_rank_bust_every_5_sec": False,
        "auto_rank_oc": False,
        "auto_rank_booze": False,
        "auto_rank_melt": False,
        "auto_rank_scrap": False,
    }
    result = await db.users.update_many(
        {"auto_rank_trial": True, "auto_rank_trial_until": {"$lte": now_iso}, "auto_rank_permanent": {"$ne": True}},
        {"$set": {**_trial_off, "auto_rank_purchased": False}, "$unset": {"auto_rank_trial_until": ""}},
    )
    legacy = await db.users.update_many(
        {
            "auto_rank_trial_until": {"$lte": now_iso, "$exists": True, "$nin": [None, ""]},
            "auto_rank_purchased": {"$ne": True},
            "auto_rank_trial": {"$ne": True},
        },
        {"$set": _trial_off, "$unset": {"auto_rank_trial_until": ""}},
    )
    modified = int(result.modified_count or 0) + int(legacy.modified_count or 0)
    if modified:
        logger.info("Auto rank: expired %d timed trial(s)", modified)


def _is_car_usable(uc: dict) -> bool:
    """True if car has damage < 100 (or no damage field)."""
    dmg = uc.get("damage_percent")
    if dmg is None:
        return True
    try:
        return float(dmg) < 100
    except (TypeError, ValueError):
        return True


async def _booze_garage_travel_leg_seconds(db, user_id: str) -> tuple[Optional[str], int, Optional[str]]:
    """Travel method id, seconds per leg, and display name for fastest usable garage car.

    Uses the same exclusive/VIP dedicated fetch as /travel/info so large garages do not drop car22.
    """
    import server as srv
    from routers.admin.airport import _fetch_travel_user_cars, _merge_user_cars_for_travel

    CARS = getattr(srv, "CARS", None) or []
    TRAVEL_TIMES = getattr(srv, "TRAVEL_TIMES", None) or {}
    default_leg = int(TRAVEL_TIMES.get("common", 45))
    user_id = (user_id or "").strip()
    if not user_id:
        return None, default_leg, None

    bulk, custom_rows, immune_rows = await _fetch_travel_user_cars(user_id)
    all_cars = _merge_user_cars_for_travel(bulk, immune_rows)
    # Customs are fetched separately (same as Travel); include them for booze method selection.
    seen = {str(uc.get("id") or uc.get("_id") or "") for uc in all_cars}
    for uc in custom_rows:
        k = str(uc.get("id") or uc.get("_id") or "")
        if k and k not in seen:
            seen.add(k)
            all_cars.append(uc)

    usable = [uc for uc in all_cars if _is_car_usable(uc)]
    if not usable:
        return None, default_leg, None

    best_method: Optional[str] = None
    best_name: Optional[str] = None
    best_time = 999
    for uc in usable:
        if uc.get("car_id") == "car_custom":
            travel_time = int(TRAVEL_TIMES.get("custom", 12))
            method = "custom"
            name = (uc.get("custom_name") or "").strip() or "Custom Car"
        else:
            car_info = next((c for c in CARS if c.get("id") == uc.get("car_id")), None)
            rarity = (car_info or {}).get("rarity", "common")
            travel_time = int(TRAVEL_TIMES.get(rarity, 45) if car_info else 45)
            method = uc.get("id") or str(uc.get("_id", ""))
            if not method:
                continue
            name = (car_info or {}).get("name") or "Car"
            if uc.get("car_id") == "car22" or rarity == "vip_exclusive":
                name = (uc.get("custom_name") or "").strip() or name
        if travel_time < best_time:
            best_time = travel_time
            best_method = method
            best_name = name
    if not best_method:
        return None, default_leg, None
    return best_method, int(best_time), best_name


async def booze_travel_seconds_per_leg(db, user_id: str) -> int:
    """Seconds per one-way leg; booze round-trip uses 2× this (matches garage car selection for booze / auto-rank)."""
    _, secs, _ = await _booze_garage_travel_leg_seconds(db, user_id)
    return secs


async def booze_travel_leg_info(db, user_id: str) -> dict:
    """Seconds + display name of the car used for booze / Auto Rank travel estimates."""
    _method, secs, name = await _booze_garage_travel_leg_seconds(db, user_id)
    return {"seconds": int(secs), "car_name": name}


async def _get_travel_method(db, user_id: str) -> Optional[str]:
    """Find the fastest travel method for a user (cars only, no airport)."""
    mid, _, _ = await _booze_garage_travel_leg_seconds(db, user_id)
    return mid


async def _get_booze_protected_car_ids(db, user_id: str) -> set:
    """Return user_car ids that booze run uses, so melt/scrap must not touch them."""
    method = await _get_travel_method(db, user_id)
    if not method:
        return set()
    if method == "custom":
        # Fastest travel is car_custom — do not block melting/scrapping it; booze will use the next-fastest car.
        return set()
    return {method}


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
    await _inc_successful_busts_today(db, user_id, now, 1)
    if cash:
        await _inc_failed_today(db, user_id, "auto_rank_bust_cash_today", "auto_rank_bust_cash_date", now, int(cash))


async def _update_auto_rank_stats_crimes(db, user_id: str, count: int, cash: int, now: datetime):
    if count <= 0 and cash <= 0:
        return
    await _ensure_stats_since(db, user_id, now)
    await db.users.update_one({"id": user_id}, {"$inc": {"auto_rank_total_crimes": count, "auto_rank_total_cash": cash}})
    if count > 0:
        await _inc_successful_crimes_today(db, user_id, now, count)
    if cash:
        await _inc_failed_today(db, user_id, "auto_rank_crime_cash_today", "auto_rank_crime_cash_date", now, int(cash))


async def _inc_auto_rank_skip_stats(
    db,
    user_id: str,
    now: datetime,
    *,
    kind: str,
    used: int = 0,
    cash: int = 0,
):
    """Track Auto Rank cooldown-skip usage for the status panel (UTC day)."""
    if used <= 0 and cash <= 0:
        return
    today = _today_utc(now)
    used_field = f"auto_rank_skip_{kind}_used_today"
    cash_field = f"auto_rank_skip_{kind}_cash_today"
    date_field = f"auto_rank_skip_{kind}_date"
    u = await db.users.find_one({"id": user_id}, {"_id": 0, date_field: 1})
    if (u or {}).get(date_field) != today:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {date_field: today, used_field: max(0, int(used)), cash_field: max(0, int(cash))}},
        )
    else:
        inc = {}
        if used:
            inc[used_field] = int(used)
        if cash:
            inc[cash_field] = int(cash)
        if inc:
            await db.users.update_one({"id": user_id}, {"$inc": inc})


async def _update_auto_rank_stats_gta(db, user_id: str, car: dict, now: datetime, option_id: Optional[str] = None, option_name: Optional[str] = None):
    """Record one auto-rank GTA: update stats, total_gta (for leaderboard), and gta_events (for weekly leaderboard)."""
    await _ensure_stats_since(db, user_id, now)
    car_name = (car or {}).get("name") or "Car"
    car_value = int((car or {}).get("value", 0) or 0)
    car_id = (car or {}).get("id")
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "auto_rank_best_cars": 1, "username": 1})
    best = list((u or {}).get("auto_rank_best_cars") or [])
    best.append({"name": car_name, "value": car_value})
    best.sort(key=lambda x: x.get("value", 0), reverse=True)
    await db.users.update_one(
        {"id": user_id},
        {"$inc": {"auto_rank_total_gtas": 1, "total_gta": 1}, "$set": {"auto_rank_best_cars": best[:3]}},
    )
    await _inc_successful_gtas_today(db, user_id, now, 1)
    if car_value > 0:
        await _inc_failed_today(db, user_id, "auto_rank_gta_value_today", "auto_rank_gta_value_date", now, car_value)
    # Insert gta_event so weekly leaderboard and stats include auto-rank GTAs
    try:
        event_doc = {
            "user_id": user_id,
            "username": (u or {}).get("username") or "",
            "at": now,
            "success": True,
            "profit": car_value,
            "option_id": option_id or "",
            "option_name": option_name or "",
            "car_id": car_id,
            "car_name": car_name,
            "car_value": car_value,
            "jailed": False,
            "jail_seconds": None,
        }
        await db.gta_events.insert_one(event_doc)
    except Exception:
        pass


async def _update_auto_rank_stats_booze(db, user_id: str, now: datetime, profit: int = 0):
    """Record Auto Rank booze stats. Do not increment booze_run_profit_total here — _booze_sell_impl already does."""
    await _ensure_stats_since(db, user_id, now)
    await db.users.update_one({"id": user_id}, {"$inc": {"auto_rank_total_booze_runs": 1, "auto_rank_total_booze_profit": int(profit)}})
    await _inc_failed_today(db, user_id, "auto_rank_booze_runs_today", "auto_rank_booze_runs_date", now, 1)
    if profit:
        await _inc_failed_today(db, user_id, "auto_rank_booze_profit_today", "auto_rank_booze_profit_date", now, int(profit))


async def _update_auto_rank_stats_melt(db, user_id: str, melted_count: int = 0, total_bullets: int = 0, scrapped_count: int = 0, total_cash: int = 0):
    """Record melt (bullets) and/or scrap (cash) stats from auto rank."""
    if melted_count <= 0 and scrapped_count <= 0:
        return
    now = datetime.now(timezone.utc)
    today = _today_utc(now)
    await _ensure_stats_since(db, user_id, now)
    inc = {}
    updates = {}
    if melted_count > 0:
        inc["auto_rank_total_cars_melted"] = melted_count
        inc["auto_rank_total_bullets_from_melt"] = total_bullets
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "auto_rank_bullets_from_melt_date": 1, "auto_rank_bullets_from_melt_today": 1, "auto_rank_cars_melted_today": 1, "auto_rank_cars_melted_date": 1})
        if (u or {}).get("auto_rank_bullets_from_melt_date") != today:
            updates["auto_rank_bullets_from_melt_today"] = total_bullets
            updates["auto_rank_bullets_from_melt_date"] = today
        else:
            inc["auto_rank_bullets_from_melt_today"] = total_bullets
        if (u or {}).get("auto_rank_cars_melted_date") != today:
            updates["auto_rank_cars_melted_today"] = melted_count
            updates["auto_rank_cars_melted_date"] = today
        else:
            inc["auto_rank_cars_melted_today"] = melted_count
    if scrapped_count > 0:
        inc["auto_rank_total_cars_scrapped"] = scrapped_count
        inc["auto_rank_total_cash_from_scrap"] = total_cash
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "auto_rank_cash_from_scrap_date": 1, "auto_rank_cars_scrapped_date": 1})
        if (u or {}).get("auto_rank_cash_from_scrap_date") != today:
            updates["auto_rank_cash_from_scrap_today"] = total_cash
            updates["auto_rank_cash_from_scrap_date"] = today
        else:
            inc["auto_rank_cash_from_scrap_today"] = total_cash
        if (u or {}).get("auto_rank_cars_scrapped_date") != today:
            updates["auto_rank_cars_scrapped_today"] = scrapped_count
            updates["auto_rank_cars_scrapped_date"] = today
        else:
            inc["auto_rank_cars_scrapped_today"] = scrapped_count
    if inc or updates:
        op = {}
        if inc:
            op["$inc"] = inc
        if updates:
            op["$set"] = updates
        await db.users.update_one({"id": user_id}, op)


def _today_utc(now: datetime) -> str:
    from utils.game_timezone import game_today_date_str

    return game_today_date_str(now)


async def _inc_failed_today(db, user_id: str, field: str, date_field: str, now: datetime, count: int = 1):
    """Increment today's fail count by count; reset if date changed."""
    u = await db.users.find_one({"id": user_id}, {"_id": 0, date_field: 1, field: 1})
    today = _today_utc(now)
    if not u or u.get(date_field) != today:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {field: count, date_field: today}},
        )
    else:
        await db.users.update_one({"id": user_id}, {"$inc": {field: count}})


async def _inc_successful_busts_today(db, user_id: str, now: datetime, count: int = 1):
    """Increment today's successful bust count; reset if date changed."""
    await _inc_failed_today(db, user_id, "auto_rank_successful_busts_today", "auto_rank_successful_busts_date", now, count)


async def _inc_successful_crimes_today(db, user_id: str, now: datetime, count: int = 1):
    """Increment today's successful crime count; reset if date changed."""
    await _inc_failed_today(db, user_id, "auto_rank_successful_crimes_today", "auto_rank_successful_crimes_date", now, count)


async def _inc_successful_gtas_today(db, user_id: str, now: datetime, count: int = 1):
    """Increment today's successful GTA count; reset if date changed."""
    await _inc_failed_today(db, user_id, "auto_rank_successful_gtas_today", "auto_rank_successful_gtas_date", now, count)


async def _set_last_activity(db, user_id: str, activity: str, now: datetime):
    """Record last auto-rank activity for UI (e.g. crimes, gta, bust, booze_sell, booze_travel)."""
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"auto_rank_last_activity": activity, "auto_rank_last_activity_at": now.isoformat()}},
    )


def _is_user_idle(user: dict, now: datetime) -> bool:
    """Check if user has been inactive (no real activity) for more than AUTO_RANK_IDLE_TIMEOUT_SECONDS.
    Returns True if idle (should skip auto-rank), False if active."""
    last_seen = user.get("last_seen")
    if not last_seen:
        return False  # No last_seen = treat as active (new user)
    last_seen_dt = _parse_iso(last_seen)
    if not last_seen_dt:
        return False
    elapsed = (now - last_seen_dt).total_seconds()
    return elapsed > AUTO_RANK_IDLE_TIMEOUT_SECONDS


_IDLE_SAVE_FIELDS = ["auto_rank_crimes", "auto_rank_gta", "auto_rank_bust_every_5_sec", "auto_rank_oc", "auto_rank_booze", "auto_rank_melt", "auto_rank_scrap"]


async def _set_user_idle(db, user_id: str, username: str = "?"):
    """Set user to idle: save current preferences, disable all tasks, set auto_rank_idle=True."""
    # Fetch current preferences to save them
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "auto_rank_idle": 1, **{k: 1 for k in _IDLE_SAVE_FIELDS}}
    )
    if not user or user.get("auto_rank_idle"):
        return  # Already idle or user not found
    
    # Save current preferences before disabling
    saved_prefs = {f"auto_rank_idle_saved_{k}": _auto_rank_task_enabled(user, k) for k in _IDLE_SAVE_FIELDS}
    # Disable all task toggles while idle
    disabled_prefs = {k: False for k in _IDLE_SAVE_FIELDS}
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"auto_rank_idle": True, **saved_prefs, **disabled_prefs}}
    )
    logger.info("Auto rank: user %s went idle (no activity for 24h) - tasks disabled, prefs saved", username)


def _is_staff(user: dict) -> bool:
    """Check if user is admin or moderator (staff never go auto_rank_idle)."""
    import server as srv
    email = (user.get("email") or "").lower()
    is_admin = email in srv.ADMIN_EMAILS
    is_mod = bool(user.get("is_moderator"))
    return is_admin or is_mod


def _auto_rank_idle_exempt(user: dict) -> bool:
    """Permanent Auto Rank (store points or email-tied) and staff never pause after 24h inactivity."""
    if _is_staff(user):
        return True
    if _user_has_permanent_auto_rank(user):
        return True
    if user.get("auto_rank_email_entitlement"):
        return True
    return False


def _should_apply_auto_rank_idle(user: dict, now: datetime) -> bool:
    if _auto_rank_idle_exempt(user):
        return False
    return _is_user_idle(user, now)


async def wake_auto_rank_if_idle(db, user_id: str):
    """Clear idle pause when the user returns. Do not resurrect old module toggles."""
    unset_fields = {f"auto_rank_idle_saved_{k}": "" for k in _IDLE_SAVE_FIELDS}
    unset_fields["auto_rank_next_run_at"] = ""
    result = await db.users.update_one(
        {"id": user_id, "auto_rank_idle": True},
        {"$set": {"auto_rank_idle": False}, "$unset": unset_fields},
    )
    if result.modified_count:
        logger.info("Auto rank: user %s woke up from idle (module toggles unchanged)", user_id)


async def _wake_permanent_auto_rank_if_idle(db) -> None:
    """Clear stale idle flag for permanent buyers without re-enabling saved module toggles."""
    unset_fields = {f"auto_rank_idle_saved_{k}": "" for k in _IDLE_SAVE_FIELDS}
    unset_fields["auto_rank_next_run_at"] = ""
    await db.users.update_many(
        {
            "auto_rank_idle": True,
            "$or": [
                {"auto_rank_permanent": True},
                {"auto_rank_email_entitlement": True},
                {"auto_rank_purchased": True, "auto_rank_trial": {"$ne": True}},
            ],
        },
        {"$set": {"auto_rank_idle": False}, "$unset": unset_fields},
    )


# ─── Telegram helper ──────────────────────────────────────────────

def _auto_rank_telegram_notify(user: Optional[dict]) -> bool:
    """True unless the user explicitly turned off Auto Rank Telegram push notifications."""
    if not user:
        return True
    v = user.get("auto_rank_telegram_notify", True)
    if v is False or v == 0:
        return False
    if isinstance(v, str) and v.strip().lower() in ("false", "0", "no", "off"):
        return False
    return True


def _format_crime_prestige_bonus_telegram(bonus: Optional[dict]) -> Optional[str]:
    """One short line for Telegram: prestige crime extras (cash, booze, bullets, etc.)."""
    if not bonus or not isinstance(bonus, dict):
        return None
    parts: list[str] = []
    if bonus.get("cash"):
        try:
            parts.append(f"${int(bonus['cash']):,} bonus cash")
        except (TypeError, ValueError):
            pass
    if bonus.get("respect_points") is not None:
        try:
            parts.append(f"+{int(bonus['respect_points'])} respect")
        except (TypeError, ValueError):
            pass
    if bonus.get("bullets") is not None:
        try:
            parts.append(f"+{int(bonus['bullets'])} bullets")
        except (TypeError, ValueError):
            pass
    if bonus.get("points") is not None:
        try:
            parts.append(f"+{int(bonus['points'])} points")
        except (TypeError, ValueError):
            pass
    if bonus.get("molotovs") is not None:
        try:
            parts.append(f"+{int(bonus['molotovs'])} molotovs")
        except (TypeError, ValueError):
            pass
    if bonus.get("loot_box_pieces") is not None:
        try:
            parts.append(f"+{int(bonus['loot_box_pieces'])} loot piece(s)")
        except (TypeError, ValueError):
            pass
    bo = bonus.get("booze")
    if isinstance(bo, dict) and bo.get("amount"):
        parts.append(f"+{bo.get('amount')} {bo.get('id', 'booze')}")
    if bonus.get("token"):
        parts.append(f"token: {bonus['token']}")
    return " · ".join(parts) if parts else None


async def _send_jail_notification(
    telegram_chat_id: str,
    username: str,
    reason: str,
    jail_seconds: int = 30,
    bot_token: Optional[str] = None,
    *,
    notify: bool = True,
):
    if not notify or not (telegram_chat_id or "").strip():
        return
    from middleware.security import send_telegram_to_chat
    msg = f"**Auto Rank** — {username}\n\n🔒 You're in jail ({reason}). {jail_seconds}s."
    await send_telegram_to_chat(telegram_chat_id, msg, bot_token, username=username)


def _format_auto_rank_oc_telegram(username: str, result: dict) -> str:
    """Build OC outcome text for Telegram (success/fail, payouts, flavor message)."""
    uname = username or "?"
    job = (result.get("job_name") or result.get("job_id") or "Heist").strip() or "Heist"
    if result.get("success"):
        cash = int(result.get("cash_earned") or 0)
        rp = int(result.get("rp_earned") or 0)
        flavor = (result.get("message") or "").strip()
        parts = [
            f"**Auto Rank** — {uname}",
            "",
            f"**OC** — **Success** · {job}",
            f"Cash: **${cash:,}**  ·  Rank pts: **{rp:,}**",
        ]
        if flavor:
            parts.append(flavor)
        return "\n".join(parts)
    flavor = (result.get("message") or "The heist failed.").strip()
    parts = [
        f"**Auto Rank** — {uname}",
        "",
        f"**OC** — **Failed** · {job}",
        flavor,
        "Cash: **$0**  ·  Rank pts: **0**",
    ]
    if result.get("jailed"):
        parts.append("**Jailed** (cooldown still applied).")
    return "\n".join(parts)


# ─── Booze running ────────────────────────────────────────────────

async def _booze_sell_at_city(db, user, user_id: str, username: str, telegram_chat_id: str, bot_token, now: datetime, lines: list):
    """Sell all carried booze that wasn't bought at the current city. Returns (has_success, user).
    Booze from racket/missions (no buy_location) is sold for cash first so the cycle can proceed to normal runs."""
    from routers.money.booze_run import _booze_sell_impl

    carrying = dict(user.get("booze_carrying") or {})
    buy_locations = dict((user.get("booze_buy_location") or {}).items())
    current = (user.get("current_state") or "").strip()
    has_success = False
    total_profit = 0

    for bid, amt in list(carrying.items()):
        amt = int(amt or 0)
        if amt <= 0:
            continue
        if buy_locations.get(bid) == current:
            continue
        try:
            out = await _booze_sell_impl(user, bid, amt, via_auto_rank=True)
            if out.get("caught"):
                await _send_jail_notification(
                    telegram_chat_id, username, "booze sell bust", 20, bot_token, notify=_auto_rank_telegram_notify(user)
                )
                user = await db.users.find_one({"id": user_id}, {"_id": 0})
                return False, user
            profit = out.get("profit") or 0
            if out.get("is_run"):
                total_profit += profit
                lines.append(f"**Booze** — Sold {amt} for ${profit:,} profit.")
            else:
                revenue = out.get("revenue") or 0
                lines.append(f"**Booze** — Sold {amt} misc booze for ${revenue:,}.")
            has_success = True
            user = await db.users.find_one({"id": user_id}, {"_id": 0})
            if not user:
                break
        except HTTPException as he:
            logger.info("Auto rank booze sell %s: %s", user_id, he.detail)
            break
        except Exception as e:
            logger.exception("Auto rank booze sell %s: %s", user_id, e)
            break

    if has_success and total_profit > 0:
        await _update_auto_rank_stats_booze(db, user_id, now, total_profit)
    return has_success, user


async def _booze_buy_and_travel(db, user, user_id: str, username: str, telegram_chat_id: str, bot_token, now: datetime, lines: list, buy_city: str, sell_city: str, buy_idx: int, sell_idx: int):
    """Buy optimal booze at buy_city and travel to sell_city. Booze only uses cars (no airport). If no car, skip and retry next cycle (every 5s). Capacity matches live Booze Run (prestige total cap, rank slice, store/family bonuses, Completed It)."""
    from routers.money.booze_run import (
        BOOZE_TYPES,
        _booze_prices_for_rotation,
        _booze_user_capacity,
        _booze_user_carrying_total,
        _booze_buy_impl,
        _booze_vip_pass_car_owned,
        _family_booze_cargo_extra,
    )
    from routers.admin.airport import _start_travel_impl

    travel_method = await _get_travel_method(db, user_id)
    if not travel_method:
        logger.info("Auto rank booze %s: no working car for buy+travel", user_id)
        return False

    prices_map = _booze_prices_for_rotation()
    fam_extra = await _family_booze_cargo_extra(user.get("family_id"))
    vip_car = await _booze_vip_pass_car_owned(db, user_id)
    capacity = _booze_user_capacity(user, family_cargo_bonus=fam_extra, vip_pass_car_owned=vip_car)
    carrying_now = _booze_user_carrying_total(dict(user.get("booze_carrying") or {}))
    room = max(0, capacity - carrying_now)
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
        logger.info("Auto rank booze %s: no profitable booze route (best_profit=%s)", user_id, best_profit)
        return False
    if room <= 0:
        logger.info("Auto rank booze %s: no cargo room (%s/%s)", user_id, carrying_now, capacity)
        return False
    amount = min(room, money // best_buy_price)
    if amount <= 0:
        logger.info("Auto rank booze %s: insufficient money ($%s) for buy (price=$%s)", user_id, money, best_buy_price)
        return False

    try:
        out = await _booze_buy_impl(user, best_booze_id, amount, via_auto_rank=True)
        if out.get("caught"):
            await _send_jail_notification(
                telegram_chat_id, username, "booze buy bust", 20, bot_token, notify=_auto_rank_telegram_notify(user)
            )
            return False
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user:
            return True
        await _start_travel_impl(user, sell_city, travel_method, airport_slot=None, booze_run=True)
        lines.append(f"**Booze** — Bought {amount} at {buy_city}, traveling to {sell_city}.")
        return True
    except HTTPException as he:
        logger.warning("Auto rank booze %s: buy/travel failed: %s", user_id, he.detail)
    except Exception as e:
        logger.exception("Auto rank booze buy/travel %s: %s", user_id, e)
    return False


async def _run_booze_for_user(db, user_id: str, username: str, telegram_chat_id: str, bot_token: Optional[str], now: datetime, lines: list) -> bool:
    """Run booze: arrive/skip travel, sell, buy+travel. With skip tokens on, up to AUTO_RANK_SKIP_BATCH travel skips."""
    from server import STATES
    from routers.money.booze_run import _booze_round_trip_cities, _booze_user_carrying_total
    from routers.admin.airport import _start_travel_impl
    from utils.cooldown_skip import consume_skip_credit

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        logger.info("Auto rank booze %s: user not found", user_id)
        return False
    from utils.booze_intake_gate import booze_intake_blocked

    if booze_intake_blocked(user):
        return False
    user = await _apply_overdue_travel(db, user_id, user, now)
    if not user or user.get("in_jail"):
        logger.info("Auto rank booze %s: in jail or missing after travel apply", user_id)
        return False

    booze_skips_used = 0
    any_ok = False

    async def _try_skip_mid_travel() -> bool:
        """If mid-travel, burn a skip to land (when allowed). True = landed / not traveling."""
        nonlocal user, booze_skips_used
        if not user or not user.get("travel_arrives_at"):
            return True
        adt = _parse_iso(user["travel_arrives_at"])
        wall = datetime.now(timezone.utc)
        if adt and wall >= adt:
            user = await _apply_overdue_travel(db, user_id, user, wall)
            return bool(user) and not user.get("travel_arrives_at")
        if user.get("auto_rank_use_skip_tokens") is not True:
            return False
        if booze_skips_used >= AUTO_RANK_SKIP_BATCH or not _can_use_skip(user, "booze"):
            return False
        dest = (user.get("traveling_to") or "").strip()
        ok, user = await _ensure_skip_credit(db, user_id, user, "booze")
        if not (ok and dest and await consume_skip_credit(db, user_id, "booze")):
            return False
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"current_state": dest}, "$unset": {"traveling_to": "", "travel_arrives_at": ""}},
        )
        user = await db.users.find_one({"id": user_id}, {"_id": 0}) or user
        booze_skips_used += 1
        lines.append(f"**Booze** — Skipped the drive to {dest}.")
        return True

    # Initial mid-travel: skip once or wait
    if user.get("travel_arrives_at"):
        adt = _parse_iso(user["travel_arrives_at"])
        if adt and now < adt:
            if not await _try_skip_mid_travel():
                return False

    round_trip = _booze_round_trip_cities()
    if not round_trip or len(round_trip) < 2:
        logger.warning("Auto rank booze %s: no round trip cities available", user_id)
        return False
    city_a, city_b = round_trip[0], round_trip[1]

    current = (user.get("current_state") or "").strip()
    if current not in (city_a, city_b):
        travel_method = await _get_travel_method(db, user_id)
        if travel_method:
            try:
                await _start_travel_impl(user, city_a, travel_method, airport_slot=None, booze_run=True)
                await _set_last_activity(db, user_id, "booze_travel", now)
                lines.append(f"**Booze** — Traveling to {city_a} to start run.")
                # If skips remain, land immediately and continue the sell/buy loop below
                user = await db.users.find_one({"id": user_id}, {"_id": 0}) or user
                if not await _try_skip_mid_travel():
                    return True
                any_ok = True
            except HTTPException as he:
                logger.info("Auto rank booze %s: travel to %s failed: %s", user_id, city_a, he.detail)
                return False
            except Exception as e:
                logger.exception("Auto rank booze travel to buy city %s: %s", user_id, e)
                return False
        else:
            logger.info("Auto rank booze %s: at %s (not in %s/%s), no working car to travel", user_id, current, city_a, city_b)
            return False

    # Sell / buy / skip-travel loop (up to batch travel skips)
    max_rounds = AUTO_RANK_SKIP_BATCH + 1
    for _round in range(max_rounds):
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user:
            break
        if user.get("in_jail"):
            if user.get("auto_rank_use_skip_tokens") is True:
                freed, user = await _auto_rank_try_jail_bailout(db, user_id, user, lines)
                if not freed:
                    break
            else:
                break
        use_skips = user.get("auto_rank_use_skip_tokens") is True
        if user.get("travel_arrives_at"):
            if not await _try_skip_mid_travel():
                break
            user = await db.users.find_one({"id": user_id}, {"_id": 0}) or user

        current = (user.get("current_state") or "").strip()
        if current not in (city_a, city_b):
            break
        idx_a = STATES.index(city_a) if city_a in STATES else 0
        idx_b = STATES.index(city_b) if city_b in STATES else 1
        other_city = city_b if current == city_a else city_a
        other_idx = idx_b if current == city_a else idx_a
        current_idx = idx_a if current == city_a else idx_b
        carrying_total = _booze_user_carrying_total(dict(user.get("booze_carrying") or {}))

        if carrying_total > 0:
            success, user = await _booze_sell_at_city(db, user, user_id, username, telegram_chat_id, bot_token, now, lines)
            if success:
                any_ok = True
                await _set_last_activity(db, user_id, "booze_sell", now)
            if not success:
                user = user or await db.users.find_one({"id": user_id}, {"_id": 0})
                if user and user.get("in_jail") and user.get("auto_rank_use_skip_tokens") is True:
                    freed, user = await _auto_rank_try_jail_bailout(db, user_id, user, lines)
                    if freed:
                        continue
                if user and not user.get("in_jail"):
                    # Wrong city for sell — travel to other city
                    travel_method = await _get_travel_method(db, user_id)
                    if travel_method:
                        try:
                            await _start_travel_impl(user, other_city, travel_method, airport_slot=None, booze_run=True)
                            await _set_last_activity(db, user_id, "booze_travel", now)
                            lines.append(f"**Booze** — Traveling to {other_city} to sell.")
                            any_ok = True
                            user = await db.users.find_one({"id": user_id}, {"_id": 0}) or user
                            if await _try_skip_mid_travel():
                                continue
                        except HTTPException:
                            pass
                        except Exception as e:
                            logger.exception("Auto rank booze travel to sell city %s: %s", user_id, e)
                break
            user = await db.users.find_one({"id": user_id}, {"_id": 0})
            if not user or user.get("in_jail"):
                if user and user.get("in_jail") and user.get("auto_rank_use_skip_tokens") is True:
                    freed, user = await _auto_rank_try_jail_bailout(db, user_id, user, lines)
                    if freed:
                        continue
                break
            carrying_after = _booze_user_carrying_total(dict(user.get("booze_carrying") or {}))
            current_after = (user.get("current_state") or "").strip()
            if carrying_after == 0 and current_after in (city_a, city_b):
                other_after = city_b if current_after == city_a else city_a
                cur_idx = STATES.index(current_after) if current_after in STATES else 0
                oth_idx = STATES.index(other_after) if other_after in STATES else 1
                did_buy = await _booze_buy_and_travel(
                    db, user, user_id, username, telegram_chat_id, bot_token, now, lines,
                    current_after, other_after, cur_idx, oth_idx,
                )
                if did_buy:
                    any_ok = True
                    await _set_last_activity(db, user_id, "booze_travel", now)
                    user = await db.users.find_one({"id": user_id}, {"_id": 0}) or user
                    if use_skips and booze_skips_used < AUTO_RANK_SKIP_BATCH and await _try_skip_mid_travel():
                        continue
                break
            break
        else:
            did_buy = await _booze_buy_and_travel(
                db, user, user_id, username, telegram_chat_id, bot_token, now, lines,
                current, other_city, current_idx, other_idx,
            )
            if did_buy:
                any_ok = True
                await _set_last_activity(db, user_id, "booze_travel", now)
                user = await db.users.find_one({"id": user_id}, {"_id": 0}) or user
                if use_skips and booze_skips_used < AUTO_RANK_SKIP_BATCH and await _try_skip_mid_travel():
                    continue
            break

    if booze_skips_used > 0:
        await _inc_auto_rank_skip_stats(db, user_id, now, kind="booze", used=booze_skips_used, cash=0)
        try:
            from utils.token_perk_stats import bump_token_perk_stats
            await bump_token_perk_stats(db, user_id, "cooldown_skip_booze", uses=booze_skips_used, via_auto_rank=booze_skips_used)
        except Exception:
            pass
        if booze_skips_used > 1:
            lines.append(f"**Booze** — Used {booze_skips_used} travel skips this cycle.")
    return any_ok


# ─── Bust-only (5-sec loop) ──────────────────────────────────────

async def _run_bust_only_for_user(user_id: str, username: str, telegram_chat_id: str, bot_token: Optional[str] = None, bust_target_username: Optional[str] = None):
    """Try one jail bust, send result to Telegram."""
    import server as srv
    from routers.crime.jail import _attempt_bust_impl, _npc_visible_to_user_filter, try_spawn_private_jail_cell
    from middleware.security import send_telegram_to_chat

    db = srv.db
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return
    if user.get("in_jail"):
        return
    token = bot_token or (user.get("telegram_bot_token") or "").strip()
    if bust_target_username is None:
        npc = await db.jail_npcs.find_one(
            _npc_visible_to_user_filter(user_id),
            {"_id": 0, "username": 1},
        )
        if npc:
            bust_target_username = npc.get("username")
        if not bust_target_username:
            jailed = await db.users.find_one({"in_jail": True, "id": {"$ne": user_id}}, {"_id": 0, "username": 1})
            if jailed:
                bust_target_username = jailed.get("username")
        if not bust_target_username:
            spawned, _, _ = await try_spawn_private_jail_cell(user_id)
            if spawned:
                user = await db.users.find_one({"id": user_id}, {"_id": 0})
                if not user or user.get("in_jail"):
                    return
                npc2 = await db.jail_npcs.find_one(
                    _npc_visible_to_user_filter(user_id),
                    {"_id": 0, "username": 1},
                )
                if npc2:
                    bust_target_username = (npc2.get("username") or "").strip() or None
    if not bust_target_username:
        return
    try:
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user or user.get("in_jail"):
            return
        bust_result = await _attempt_bust_impl(user, bust_target_username)
        if bust_result.get("error"):
            # bust_cooldown = jail min interval between attempts; not a failed bust for stats.
            if not bust_result.get("bust_cooldown"):
                now = datetime.now(timezone.utc)
                await _inc_failed_today(db, user_id, "auto_rank_failed_busts_today", "auto_rank_failed_busts_date", now)
            return
        if not bust_result.get("success"):
            now = datetime.now(timezone.utc)
            await _inc_failed_today(db, user_id, "auto_rank_failed_busts_today", "auto_rank_failed_busts_date", now)
            return
        now = datetime.now(timezone.utc)
        rp = bust_result.get("rank_points_earned") or 0
        cash = bust_result.get("cash_reward") or 0
        respect = bust_result.get("respect_points") or 0
        await _update_auto_rank_stats_bust(db, user_id, cash, now)
        await _set_last_activity(db, user_id, "bust", now)
        parts = [f"Busted {bust_target_username}! +{rp} RP"]
        if cash:
            parts.append(f"${cash:,}")
        if respect:
            parts.append(f"+{respect} respect")
        chat_id = (telegram_chat_id or "").strip()
        if chat_id and _auto_rank_telegram_notify(user):
            msg = f"**Auto Rank** — {username}\n\n**Bust** — " + ". ".join(parts) + "."
            try:
                await send_telegram_to_chat(chat_id, msg, token, username=username)
            except Exception as e:
                logger.warning("Auto rank bust Telegram send for %s failed (bust completed): %s", user_id, e)
    except Exception as e:
        logger.exception("Auto rank bust-only for %s: %s", user_id, e)


# ─── Main per-user cycle (crimes + GTA + booze) ──────────────────
# Auto rank abides the same timer rules as manual play:
# - Crimes: only commits crimes whose user_crimes.cooldown_until has passed (per-crime cooldown from crimes collection).
#   commit_crime_locked serializes per user; _commit_crime_impl enforces cooldown and sets cooldown_until.
#   Consecutive crimes in one cycle wait AUTO_RANK_CRIME_COMMIT_INTERVAL_SEC between commits.
# - GTA: only runs when gta_cooldowns shows no active cooldown. attempt_gta_locked serializes; impl sets
#   cooldown_until from the attempted option's cooldown (one attempt = all options on cooldown).
# - OC: run_oc_heist_npc_only checks oc_cooldown_until and returns without running if on cooldown.
# - Booze: uses same buy/sell/travel impls; travel duration and arrival are enforced there.
# - Jail: bust attempts are limited to once per JAIL_BUST_MIN_INTERVAL_SEC (see jail.py). When bust-every-5-sec is on, cron-bust still runs busts; main cycle also runs crimes/GTA/melt/scrap if those toggles are on.


async def _run_auto_rank_for_user(user_id: str, username: str, telegram_chat_id: Optional[str] = None, bot_token: Optional[str] = None, crimes: Optional[list] = None):
    """Commit all crimes off cooldown, then one GTA (if off cooldown), then melt (if enabled), then booze if enabled. Abides all game timer rules; impls enforce cooldowns. Telegram is optional; if not set, actions still run and no notifications are sent."""
    import server as srv
    from routers.crime.crimes import commit_crime_locked
    from routers.cars.gta import attempt_gta_locked, melt_cars_locked, effective_garage_batch_limit, GTA_OPTIONS
    CARS = getattr(srv, "CARS", None) or []
    from middleware.security import send_telegram_to_chat

    db = srv.db
    get_rank_info = srv.get_rank_info
    user_prestige_rank_mult = srv.user_prestige_rank_mult
    now = datetime.now(timezone.utc)
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return
    if user.get("is_dead"):
        return
    chat_id = (telegram_chat_id or "").strip()
    token = (bot_token or "").strip() or (user.get("telegram_bot_token") or "").strip()
    lines = [f"**Auto Rank** — {username}", ""]
    user = await _auto_disable_skip_tokens_if_empty(db, user_id, user)
    if user.get("in_jail"):
        if user.get("auto_rank_use_skip_tokens") is True:
            freed, user = await _auto_rank_try_jail_bailout(db, user_id, user, lines)
            if not freed:
                return
        else:
            return

    has_success = False
    respect_before = int(user.get("respect_points") or 0)
    use_skips = user.get("auto_rank_use_skip_tokens") is True
    skip_crime_used = 0
    skip_gta_used = 0

    # --- Crimes: only those off cooldown (same rules as manual play; _commit_crime_impl also enforces) ---
    if _auto_rank_task_enabled(user, "auto_rank_crimes"):
        if crimes is None or (isinstance(crimes, list) and len(crimes) == 0):
            crimes = await db.crimes.find(
                {},
                {"_id": 0, "id": 1, "name": 1, "min_rank": 1, "prestige_required": 1, "crime_type": 1},
            ).to_list(100)
        else:
            # Cron/batch passes a preloaded list (often id+name+min_rank only) — still need a mutable copy + prestige merge.
            crimes = list(crimes)
        # Prestige crimes are code-defined; DB may omit them. Cron must merge too (non-empty batch list skipped the old branch).
        try:
            from routers.crime.crimes import PRESTIGE_CRIMES
            existing_ids = {c.get("id") for c in crimes if c.get("id")}
            for pc in (PRESTIGE_CRIMES or []):
                if pc.get("id") and pc.get("id") not in existing_ids:
                    crimes.append(
                        {
                            "id": pc.get("id"),
                            "name": pc.get("name"),
                            "min_rank": pc.get("min_rank", 1),
                            "prestige_required": pc.get("prestige_required"),
                            "crime_type": pc.get("crime_type", "prestige"),
                        }
                    )
        except Exception:
            pass
        allowed_crime_ids = user.get("auto_rank_crime_ids")
        if isinstance(allowed_crime_ids, list) and len(allowed_crime_ids) > 0:
            allowed_set = set(allowed_crime_ids)
            crimes = [c for c in crimes if c.get("id") in allowed_set]
        crime_success_count = 0
        crime_fail_count = 0
        crime_total_cash = 0
        crime_total_rp = 0
        crime_skip_cash = 0
        crime_names: list[str] = []
        crime_extra_summaries: list[str] = []
        _first_crime_in_cycle = True
        while True:
            user = await db.users.find_one({"id": user_id}, {"_id": 0})
            if not user:
                break
            if user.get("in_jail"):
                if user.get("auto_rank_use_skip_tokens") is True:
                    freed, user = await _auto_rank_try_jail_bailout(db, user_id, user, lines)
                    if not freed:
                        break
                else:
                    break
            use_skips = user.get("auto_rank_use_skip_tokens") is True
            user_crimes = await db.user_crimes.find({"user_id": user_id}, {"_id": 0, "crime_id": 1, "cooldown_until": 1}).to_list(5000)
            cooldown_by_crime = {uc["crime_id"]: _parse_iso(uc.get("cooldown_until")) for uc in user_crimes}
            rank_id, _ = get_rank_info(int(user.get("rank_points") or 0), user_prestige_rank_mult(user))
            user_prestige = int(user.get("prestige_level") or 0)
            # Only crimes whose cooldown_until has passed (or never set); skip tokens can unlock on-cooldown ones.
            available = []
            for c in crimes:
                try:
                    min_rank = int(c.get("min_rank") or 1)
                except (TypeError, ValueError):
                    min_rank = 1
                cid = c.get("id")
                if not cid:
                    continue
                prestige_required = c.get("prestige_required")
                try:
                    prestige_required = int(prestige_required) if prestige_required is not None else None
                except (TypeError, ValueError):
                    prestige_required = None
                if prestige_required is not None and user_prestige < prestige_required:
                    continue
                if min_rank > rank_id:
                    continue
                until = cooldown_by_crime.get(cid)
                if until is not None and until > now:
                    if (
                        not use_skips
                        or skip_crime_used >= AUTO_RANK_SKIP_BATCH
                        or not _can_use_skip(user, "crime")
                    ):
                        continue
                available.append(c)
            # Ready crimes first (don't burn skips while something is free), then prestige, then lower ranks.
            def _crime_sort_key(x):
                until = cooldown_by_crime.get(x.get("id"))
                needs_skip = 1 if (until is not None and until > now) else 0
                is_p = str(x.get("crime_type") or "").lower() == "prestige"
                try:
                    min_r = int(x.get("min_rank") or 1)
                except (TypeError, ValueError):
                    min_r = 1
                pr = x.get("prestige_required")
                try:
                    pr_i = int(pr) if pr is not None else 0
                except (TypeError, ValueError):
                    pr_i = 0
                if is_p:
                    return (needs_skip, 0, pr_i, min_r, x.get("id") or "")
                return (needs_skip, 1, min_r, 0, x.get("id") or "")
            available.sort(key=_crime_sort_key)
            if not available:
                break
            try:
                chosen = available[0]
                until = cooldown_by_crime.get(chosen.get("id"))
                used_skip_this = False
                needs_skip = until is not None and until > now
                # Ready crimes keep the 5s pacing; skip burns stay in a tight batch of 5.
                if not _first_crime_in_cycle and not needs_skip:
                    await asyncio.sleep(AUTO_RANK_CRIME_COMMIT_INTERVAL_SEC)
                _first_crime_in_cycle = False
                if needs_skip:
                    if skip_crime_used >= AUTO_RANK_SKIP_BATCH:
                        break
                    ok, user = await _ensure_skip_credit(db, user_id, user, "crime")
                    if not ok:
                        break
                    used_skip_this = True
                    user = await db.users.find_one({"id": user_id}, {"_id": 0}) or user
                out = await commit_crime_locked(chosen["id"], user, via_auto_rank=True)
                if used_skip_this:
                    skip_crime_used += 1
                if out.success:
                    crime_success_count += 1
                    cash_got = out.reward if out.reward is not None else 0
                    crime_total_cash += cash_got
                    if used_skip_this:
                        crime_skip_cash += cash_got
                    crime_total_rp += int(getattr(out, "rank_points_earned", 0) or 0)
                    crime_names.append(str(chosen.get("name") or chosen.get("id") or "?"))
                    extra = _format_crime_prestige_bonus_telegram(getattr(out, "prestige_bonus_earned", None))
                    if extra:
                        crime_extra_summaries.append(extra)
                else:
                    crime_fail_count += 1
            except HTTPException:
                # Normal "can't do that" (e.g. in_jail, cooldown) — act like user, stop crimes
                break
            except Exception as e:
                logger.exception("Auto rank crime for %s: %s", user_id, e)
                crime_fail_count += 1
                break
        if crime_success_count > 0:
            has_success = True
            await _update_auto_rank_stats_crimes(db, user_id, crime_success_count, crime_total_cash, now)
            if skip_crime_used > 0:
                await _inc_auto_rank_skip_stats(
                    db, user_id, now, kind="crime", used=skip_crime_used, cash=crime_skip_cash
                )
            await _set_last_activity(db, user_id, "crimes", now)
            names_part = ""
            if crime_names:
                disp = ", ".join(crime_names[:6])
                if len(crime_names) > 6:
                    disp += f" (+{len(crime_names) - 6} more)"
                names_part = f" — {disp}"
            skip_note = f" ({skip_crime_used} skip{'s' if skip_crime_used != 1 else ''})" if skip_crime_used else ""
            lines.append(
                f"**Crimes** — Committed {crime_success_count} crime(s){names_part}{skip_note}. "
                f"Earned ${crime_total_cash:,} and {crime_total_rp} rank points."
            )
            if crime_extra_summaries:
                uniq = []
                for s in crime_extra_summaries:
                    if s and s not in uniq:
                        uniq.append(s)
                if uniq:
                    lines.append("**Crime bonuses** — " + " | ".join(uniq[:8]))
        if crime_fail_count > 0:
            await _inc_failed_today(db, user_id, "auto_rank_failed_crimes_today", "auto_rank_failed_crimes_date", now, crime_fail_count)
        if _auto_rank_task_enabled(user, "auto_rank_crimes") and crime_success_count == 0 and crime_fail_count == 0:
            logger.debug("Auto rank user %s: 0 crimes this cycle (all on cooldown or none available)", user_id)

    # --- GTA ---
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return
    if user.get("in_jail"):
        if user.get("auto_rank_use_skip_tokens") is True:
            freed, user = await _auto_rank_try_jail_bailout(db, user_id, user, lines)
            if not freed:
                await _auto_disable_skip_tokens_if_empty(db, user_id, user)
                return
        else:
            await _auto_disable_skip_tokens_if_empty(db, user_id, user)
            return
    use_skips = user.get("auto_rank_use_skip_tokens") is True

    # --- GTA: up to AUTO_RANK_SKIP_BATCH skipped attempts per cycle when skips on. ---
    if _auto_rank_task_enabled(user, "auto_rank_gta"):
        gta_success_count = 0
        gta_fail_count = 0
        gta_names: list[str] = []
        skip_gta_used = 0
        _first_gta_in_cycle = True
        while True:
            user = await db.users.find_one({"id": user_id}, {"_id": 0})
            if not user:
                break
            if user.get("in_jail"):
                if user.get("auto_rank_use_skip_tokens") is True:
                    freed, user = await _auto_rank_try_jail_bailout(db, user_id, user, lines)
                    if not freed:
                        break
                else:
                    break
            use_skips = user.get("auto_rank_use_skip_tokens") is True
            wall_now = datetime.now(timezone.utc)
            cooldown_doc = await db.gta_cooldowns.find_one({"user_id": user_id}, {"_id": 0, "cooldown_until": 1})
            until = _parse_iso(cooldown_doc.get("cooldown_until")) if cooldown_doc else None
            on_cooldown = bool(until and until > wall_now)
            will_use_skip = False
            if on_cooldown:
                if (
                    not use_skips
                    or skip_gta_used >= AUTO_RANK_SKIP_BATCH
                    or not _can_use_skip(user, "gta")
                ):
                    break
                ok, user = await _ensure_skip_credit(db, user_id, user, "gta")
                if not ok:
                    break
                will_use_skip = True
            elif not _first_gta_in_cycle and not use_skips:
                break
            rank_id, _ = get_rank_info(int(user.get("rank_points") or 0), user_prestige_rank_mult(user))
            unlocked = [opt for opt in GTA_OPTIONS if rank_id >= opt["min_rank"]]
            allowed_gta_ids = user.get("auto_rank_gta_option_ids")
            if isinstance(allowed_gta_ids, list) and len(allowed_gta_ids) > 0:
                allowed_set = set(allowed_gta_ids)
                unlocked = [opt for opt in unlocked if opt.get("id") in allowed_set]
            if not unlocked:
                break
            try:
                # Keep skip batches snappy; natural (non-skip) pacing stays on the cycle interval.
                if not _first_gta_in_cycle and not will_use_skip:
                    await asyncio.sleep(AUTO_RANK_CRIME_COMMIT_INTERVAL_SEC)
                _first_gta_in_cycle = False
                next_index = int(user.get("auto_rank_next_gta_option_index") or 0) % max(1, len(unlocked))
                opt = unlocked[next_index]
                # Refresh credits onto user for _attempt_gta_impl skip consume
                user = await db.users.find_one({"id": user_id}, {"_id": 0}) or user
                out = await attempt_gta_locked(opt["id"], user, caller_updates_total_gta=True)
                await db.users.update_one(
                    {"id": user_id},
                    {"$set": {"auto_rank_next_gta_option_index": (next_index + 1) % len(unlocked)}},
                )
                if will_use_skip:
                    skip_gta_used += 1
                if out.success:
                    has_success = True
                    gta_success_count += 1
                    car_name = out.car.get("name", "Car") if out.car else "Car"
                    gta_names.append(car_name)
                    await _update_auto_rank_stats_gta(
                        db, user_id, out.car or {}, wall_now, option_id=opt.get("id"), option_name=opt.get("name")
                    )
                    await _set_last_activity(db, user_id, "gta", wall_now)
                else:
                    gta_fail_count += 1
                    await _inc_failed_today(db, user_id, "auto_rank_failed_gtas_today", "auto_rank_failed_gtas_date", wall_now)
                    if getattr(out, "jailed", False) and use_skips:
                        user = await db.users.find_one({"id": user_id}, {"_id": 0}) or user
                        if user.get("in_jail"):
                            freed, user = await _auto_rank_try_jail_bailout(db, user_id, user, lines)
                            if not freed:
                                break
            except HTTPException:
                break
            except Exception as e:
                logger.exception("Auto rank GTA for %s: %s", user_id, e)
                gta_fail_count += 1
                await _inc_failed_today(db, user_id, "auto_rank_failed_gtas_today", "auto_rank_failed_gtas_date", wall_now)
                break
            if not use_skips:
                break
            if skip_gta_used >= AUTO_RANK_SKIP_BATCH:
                break
        if gta_success_count > 0 or skip_gta_used > 0:
            if skip_gta_used:
                await _inc_auto_rank_skip_stats(db, user_id, now, kind="gta", used=skip_gta_used, cash=0)
                try:
                    from utils.token_perk_stats import bump_token_perk_stats
                    await bump_token_perk_stats(
                        db, user_id, "cooldown_skip_gta", uses=skip_gta_used, via_auto_rank=skip_gta_used
                    )
                except Exception:
                    pass
            if gta_success_count > 0:
                names_part = ", ".join(gta_names[:6])
                if len(gta_names) > 6:
                    names_part += f" (+{len(gta_names) - 6} more)"
                skip_note = f" ({skip_gta_used} skip{'s' if skip_gta_used != 1 else ''})" if skip_gta_used else ""
                lines.append(
                    f"**GTA** — Success ×{gta_success_count}: {names_part}.{skip_note}"
                )

    # --- Melt ---
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return
    if user.get("in_jail"):
        if user.get("auto_rank_use_skip_tokens") is True:
            freed, user = await _auto_rank_try_jail_bailout(db, user_id, user, lines)
            if not freed:
                await _auto_disable_skip_tokens_if_empty(db, user_id, user)
                return
        else:
            await _auto_disable_skip_tokens_if_empty(db, user_id, user)
            return
    total_batch_limit = effective_garage_batch_limit(user)
    used_in_melt = 0  # shared cap across melt + timed scrap
    if _auto_rank_task_enabled(user, "auto_rank_melt"):
        melt_action_ids = user.get("auto_rank_melt_action_ids") or []
        melt_rarity_ids = user.get("auto_rank_melt_rarity_ids") or []
        if isinstance(melt_action_ids, list) and len(melt_action_ids) > 0:
            # No rarities selected = don't melt/scrap any cars (ids must match CARS[].rarity, same as garage)
            allowed_melt_rarities = set(melt_rarity_ids) if isinstance(melt_rarity_ids, list) and len(melt_rarity_ids) > 0 else set()
            allowed_melt_rarities = {r for r in allowed_melt_rarities if r in MELT_RARITIES}
            scrap_rarity_ids = user.get("auto_rank_scrap_rarity_ids") or []
            allowed_scrap_rarities = set(scrap_rarity_ids) if isinstance(scrap_rarity_ids, list) and len(scrap_rarity_ids) > 0 else set()
            allowed_scrap_rarities = {r for r in allowed_scrap_rarities if r in SCRAP_RARITIES}
            batch_limit = total_batch_limit
            booze_protected = await _get_booze_protected_car_ids(db, user_id) if user.get("auto_rank_booze") else set()

            async def _eligible_rows_for_rarities(allowed_set: set):
                cars_cursor = db.user_cars.find({"user_id": user_id})
                user_cars = await cars_cursor.to_list(1000)
                rows = []
                for uc in user_cars:
                    if uc.get("listed_for_sale"):
                        continue
                    ucid = uc.get("id") or str(uc.get("_id", ""))
                    if ucid and ucid in booze_protected:
                        continue
                    car_id = uc.get("car_id")
                    car_info = next((c for c in (CARS or []) if c.get("id") == car_id), None)
                    if not car_info:
                        continue
                    rarity = car_info.get("rarity") or "common"
                    if rarity not in allowed_set:
                        continue
                    rows.append({"user_car_id": ucid, "value": int(car_info.get("value") or 0)})
                rows.sort(key=lambda x: x["value"], reverse=True)
                return rows

            eligible = await _eligible_rows_for_rarities(allowed_melt_rarities)
            melted_this_cycle = 0  # cap total melted per single-action loop at batch_limit
            car_ids = [e["user_car_id"] for e in eligible[:max(0, batch_limit - melted_this_cycle)]]
            actions = [a for a in melt_action_ids if a in ("bullets", "cash")]
            if len(actions) == 2:
                # Both bullets and cash: split one batch pool 50/50 (odd count → first half gets one extra)
                bullets_eligible = await _eligible_rows_for_rarities(allowed_melt_rarities)
                cash_eligible = await _eligible_rows_for_rarities(allowed_scrap_rarities) if allowed_scrap_rarities else []
                n_bullets = max(0, (batch_limit + 1) // 2)
                n_cash = max(0, batch_limit - n_bullets)
                car_ids_bullets = [e["user_car_id"] for e in bullets_eligible[:n_bullets]]
                car_ids_cash = [e["user_car_id"] for e in cash_eligible[:n_cash]]
                melt_count = 0
                melt_bullets_total = 0
                scrap_count = 0
                scrap_total_value = 0
                bullets_cooldown_detail = None
                try:
                    if car_ids_bullets:
                        result_b = await melt_cars_locked(user, car_ids_bullets, "bullets", manual_garage=False)
                        if not result_b.get("cooldown") and result_b.get("success"):
                            mc = result_b.get("melted_count", 0) or 0
                            melted_this_cycle += mc
                            melt_count += mc
                            has_success = True
                            await _set_last_activity(db, user_id, "melt", now)
                            tb = result_b.get("total_bullets", 0) or 0
                            melt_bullets_total = tb
                            await _update_auto_rank_stats_melt(db, user_id, melted_count=mc, total_bullets=melt_bullets_total)
                        elif result_b.get("cooldown"):
                            bullets_cooldown_detail = result_b.get("detail") or "Melt for bullets is on cooldown."
                    if car_ids_cash:
                        result_c = await melt_cars_locked(user, car_ids_cash, "cash", manual_garage=False)
                        if result_c.get("success"):
                            mc = result_c.get("scrapped_count", 0) or 0
                            melted_this_cycle += mc
                            scrap_count += mc
                            has_success = True
                            await _set_last_activity(db, user_id, "melt", now)
                            tv = result_c.get("total_value", 0) or 0
                            scrap_total_value = tv
                            await _update_auto_rank_stats_melt(db, user_id, scrapped_count=mc, total_cash=scrap_total_value)
                except Exception as e:
                    logger.exception("Auto rank melt for %s: %s", user_id, e)
                parts = []
                if melt_count > 0:
                    parts.append(f"Melted {melt_count} car(s) for {melt_bullets_total} bullets")
                elif car_ids_bullets:
                    if bullets_cooldown_detail:
                        parts.append(f"Melted 0 car(s) ({bullets_cooldown_detail})")
                    else:
                        parts.append("Melted 0 car(s) (no eligible cars in your selected Melt rarities)")
                else:
                    parts.append("Melted 0 car(s) (no available cars matched your selected Melt rarities)")
                if scrap_count > 0:
                    parts.append(f"Scrapped {scrap_count} car(s) for ${scrap_total_value:,}")
                elif car_ids_cash:
                    parts.append("Scrapped 0 car(s) (no eligible cars in your selected Scrap rarities)")
                else:
                    parts.append("Scrapped 0 car(s) (no available cars matched your selected Scrap rarities)")
                if parts:
                    lines.append("**Melt/Scrap** — You have Melt/Scrap selected (50/50): " + " · ".join(parts) + ".")
            else:
                # Single action (or only one of bullets/cash): use full batch per action, re-fetch between
                for action in melt_action_ids:
                    if action not in ("bullets", "cash"):
                        continue
                    if melted_this_cycle >= batch_limit or not car_ids:
                        break
                    car_ids = car_ids[:max(0, batch_limit - melted_this_cycle)]
                    if not car_ids:
                        break
                    try:
                        result = await melt_cars_locked(user, car_ids, action, manual_garage=False)
                        if result.get("cooldown"):
                            continue  # skip bullets this cycle, still try cash
                        if result.get("success"):
                            mc = result.get("melted_count", 0) or result.get("scrapped_count", 0)
                            melted_this_cycle += mc
                            has_success = True
                            await _set_last_activity(db, user_id, "melt", now)
                            if action == "bullets":
                                tb = result.get("total_bullets", 0)
                                lines.append(f"**Melt** — Melted {mc} car(s) for {tb} bullets.")
                                await _update_auto_rank_stats_melt(db, user_id, melted_count=mc, total_bullets=tb)
                            else:
                                tv = result.get("total_value", 0)
                                lines.append(f"**Melt** — Scrapped {mc} car(s) for ${tv:,}.")
                                await _update_auto_rank_stats_melt(db, user_id, scrapped_count=mc, total_cash=tv)
                            # Re-fetch eligible cars for next action (previous were deleted); cap by batch limit
                            eligible = await _eligible_rows_for_rarities(
                                allowed_melt_rarities if action == "bullets" else allowed_scrap_rarities
                            )
                            car_ids = [e["user_car_id"] for e in eligible[:max(0, batch_limit - melted_this_cycle)]]
                    except Exception as e:
                        logger.exception("Auto rank melt for %s: %s", user_id, e)
            used_in_melt = melted_this_cycle

    # --- Scrap (separate from melt: runs every 2 min, uses scrap rarities) ---
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "auto_rank_next_scrap_at": 1, "auto_rank_scrap_rarity_ids": 1, "in_jail": 1},
    )
    if not user:
        return
    if user.get("in_jail"):
        return
    if _auto_rank_task_enabled(user, "auto_rank_scrap"):
        scrap_rarity_ids = user.get("auto_rank_scrap_rarity_ids") or []
        allowed_scrap_rarities = set(scrap_rarity_ids) if isinstance(scrap_rarity_ids, list) and len(scrap_rarity_ids) > 0 else set()
        allowed_scrap_rarities = {r for r in allowed_scrap_rarities if r in SCRAP_RARITIES}
        if allowed_scrap_rarities:
            next_scrap_at = _parse_iso(user.get("auto_rank_next_scrap_at"))
            if next_scrap_at is None or now >= next_scrap_at:
                user = await db.users.find_one({"id": user_id}, {"_id": 0})
                if not user or user.get("in_jail"):
                    return
                remaining = max(0, total_batch_limit - used_in_melt)
                booze_protected = await _get_booze_protected_car_ids(db, user_id) if user.get("auto_rank_booze") else set()
                cars_cursor = db.user_cars.find({"user_id": user_id})
                user_cars = await cars_cursor.to_list(1000)
                eligible = []
                for uc in user_cars:
                    if uc.get("listed_for_sale"):
                        continue
                    ucid = uc.get("id") or str(uc.get("_id", ""))
                    if ucid and ucid in booze_protected:
                        continue
                    car_info = next((c for c in (CARS or []) if c.get("id") == uc.get("car_id")), None)
                    if not car_info:
                        continue
                    rarity = car_info.get("rarity") or "common"
                    if rarity not in allowed_scrap_rarities:
                        continue
                    value = int(car_info.get("value") or 0)
                    eligible.append({"user_car_id": ucid, "value": value})
                eligible.sort(key=lambda x: x["value"], reverse=True)
                car_ids = [e["user_car_id"] for e in eligible[:remaining]]
                if not car_ids:
                    next_scrap_dt = now + timedelta(seconds=SCRAP_INTERVAL_SECONDS)
                    await db.users.update_one(
                        {"id": user_id},
                        {"$set": {"auto_rank_next_scrap_at": next_scrap_dt.isoformat()}},
                    )
                else:
                    try:
                        result = await melt_cars_locked(user, car_ids, "cash", manual_garage=False)
                        if result.get("success"):
                            mc = result.get("scrapped_count", 0)
                            tv = result.get("total_value", 0)
                            has_success = True
                            await _set_last_activity(db, user_id, "melt", now)
                            lines.append(
                                f"**Scrap** — Scrapped {mc} car(s) for ${tv:,}. (garage cap remaining: {remaining}/{total_batch_limit})"
                            )
                            await _update_auto_rank_stats_melt(db, user_id, scrapped_count=mc, total_cash=tv)
                        next_scrap_dt = now + timedelta(seconds=SCRAP_INTERVAL_SECONDS)
                        await db.users.update_one(
                            {"id": user_id},
                            {"$set": {"auto_rank_next_scrap_at": next_scrap_dt.isoformat()}},
                        )
                    except Exception as e:
                        logger.exception("Auto rank scrap for %s: %s", user_id, e)

    # --- Distillery auto-aging / throttled collect (before booze run) ---
    try:
        from routers.money.illegal_business import distillery_process_automation

        await distillery_process_automation(user_id)
    except Exception as e:
        logger.exception("Auto rank distillery_process_automation %s: %s", user_id, e)

    # --- Booze ---
    # Refetch user: scrap block uses minimal projection that omits auto_rank_booze
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return
    if user.get("in_jail"):
        if user.get("auto_rank_use_skip_tokens") is True:
            freed, user = await _auto_rank_try_jail_bailout(db, user_id, user, lines)
            if not freed:
                await _auto_disable_skip_tokens_if_empty(db, user_id, user)
                return
        else:
            await _auto_disable_skip_tokens_if_empty(db, user_id, user)
            return
    if _auto_rank_task_enabled(user, "auto_rank_booze") and not user.get("passive_booze_paused"):
        try:
            if await _run_booze_for_user(db, user_id, username, chat_id, bot_token, now, lines):
                has_success = True
        except HTTPException as he:
            logger.info("Auto rank booze for %s: %s", user_id, he.detail)
        except Exception as e:
            logger.exception("Auto rank booze for %s: %s", user_id, e)

    # After skips burned this cycle, auto-disable + inbox summary if inventory is empty.
    user = await db.users.find_one({"id": user_id}, {"_id": 0}) or user
    user = await _auto_disable_skip_tokens_if_empty(db, user_id, user)

    if has_success and chat_id and _auto_rank_telegram_notify(user):
        user_after = await db.users.find_one({"id": user_id}, {"_id": 0, "respect_points": 1})
        respect_after = int((user_after or {}).get("respect_points") or 0)
        respect_gained = max(0, respect_after - respect_before)
        if respect_gained > 0:
            lines.append(f"**Respect** — +{respect_gained} respect points.")
        lines.append("")
        try:
            await send_telegram_to_chat(chat_id, "\n".join(lines), token or None, username=username)
        except Exception as e:
            logger.warning("Auto rank Telegram send for %s failed (run completed): %s", user_id, e)


# ─── Background loops ─────────────────────────────────────────────

async def run_booze_arrivals():
    """Process booze users who have just arrived from travel so they sell immediately."""
    import server as srv
    from middleware.security import send_telegram_to_chat

    db = srv.db
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    stuck_jailed = db.users.find(
        {**_mongo_auto_rank_subscriber_clause(now), "auto_rank_enabled": True, "auto_rank_booze": True, "in_jail": True, "travel_arrives_at": {"$lte": now_iso}, "traveling_to": {"$exists": True, "$ne": None}, "is_dead": {"$ne": True}},
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
        {**_mongo_auto_rank_subscriber_clause(now), "auto_rank_enabled": True, "auto_rank_booze": True, "travel_arrives_at": {"$lte": now_iso}, "in_jail": {"$ne": True}, "is_dead": {"$ne": True}, "auto_rank_idle": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1, "telegram_bot_token": 1, "auto_rank_telegram_notify": 1, "last_seen": 1, "email": 1, "is_moderator": 1, **_AUTO_RANK_IDLE_CHECK_PROJECTION},
    )
    users = await cursor.to_list(200)

    # Check each user for idle status and filter out those who should be idle
    active_users = []
    for u in users:
        if _should_apply_auto_rank_idle(u, now):
            await _set_user_idle(db, u["id"], u.get("username", u["id"]))
        else:
            active_users.append(u)
    users = active_users

    async def run_one(u):
        chat_id = (u.get("telegram_chat_id") or "").strip()
        bot_token = (u.get("telegram_bot_token") or "").strip() or None
        lines = [f"**Auto Rank** — {u.get('username', '?')}", ""]
        try:
            has_success = await _run_booze_for_user(db, u["id"], u.get("username", "?"), chat_id, bot_token, now, lines)
            refreshed = await db.users.find_one({"id": u["id"]}, {"_id": 0}) or u
            await _auto_disable_skip_tokens_if_empty(db, u["id"], refreshed)
            if has_success and len(lines) > 2 and chat_id and _auto_rank_telegram_notify(u):
                try:
                    await send_telegram_to_chat(chat_id, "\n".join(lines), bot_token, username=u.get("username", "?"))
                except Exception as e:
                    logger.warning("Auto rank booze arrival Telegram send for %s failed: %s", u.get("id"), e)
        except HTTPException:
            pass
        except Exception as e:
            logger.exception("Auto rank booze arrival for user %s: %s", u.get("id"), e)

    if users:
        await _gather_with_concurrency([run_one(u) for u in users], AUTO_RANK_MAX_CONCURRENT)


async def run_auto_rank_due_users(interval_seconds: Optional[int] = None, cycle_start: Optional[datetime] = None):
    """Find users whose auto_rank_next_run_at is due, run each once, set next_run_at.
    Use cycle_start (e.g. when the loop iteration began) for scheduling the next run so that
    delays from run_booze_arrivals() don't stretch the effective interval.
    Skips users who have been inactive for 24+ hours (auto_rank_idle)."""
    import server as srv
    db = srv.db
    now = datetime.now(timezone.utc)
    idle_cutoff = (now - timedelta(seconds=AUTO_RANK_IDLE_TIMEOUT_SECONDS)).isoformat()
    interval = interval_seconds if interval_seconds is not None else await get_auto_rank_interval_seconds(db)
    cap = AUTO_RANK_MAX_DUE_PER_WAKE
    cursor = (
        db.users.find(
            {
                "$and": [
                    _mongo_auto_rank_subscriber_clause(now),
                    {
                        "auto_rank_enabled": True,
                        "in_jail": {"$ne": True},
                        "is_dead": {"$ne": True},
                        "auto_rank_idle": {"$ne": True},
                        "$or": [
                            {"auto_rank_next_run_at": {"$exists": False}},
                            {"auto_rank_next_run_at": None},
                            {"auto_rank_next_run_at": {"$lte": now.isoformat()}},
                        ],
                    },
                ],
            },
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "telegram_chat_id": 1,
                "telegram_bot_token": 1,
                "last_seen": 1,
                "email": 1,
                "is_moderator": 1,
                "last_seen_country": 1,
                "last_request_ip": 1,
                "last_login_ip": 1,
                **_AUTO_RANK_IDLE_CHECK_PROJECTION,
            },
        )
        .sort("auto_rank_next_run_at", 1)
        .limit(cap)
    )
    users = await cursor.to_list(cap)
    
    # Check each user for idle status and filter out those who should be idle
    active_users = []
    for u in users:
        if _should_apply_auto_rank_idle(u, now):
            await _set_user_idle(db, u["id"], u.get("username", u["id"]))
        else:
            active_users.append(u)
    users = active_users
    if users:
        logger.info("Auto rank: running cycle for %d due user(s) (crimes/GTA/booze)", len(users))
    crimes = await db.crimes.find(
        {},
        {"_id": 0, "id": 1, "name": 1, "min_rank": 1, "prestige_required": 1, "crime_type": 1},
    ).to_list(100)
    if not crimes:
        logger.warning("Auto rank: crimes collection empty; each user will try to load crimes in-run")

    # Serialize IP→country lookups (ip-api free tier); cache hits stay fast inside get_or_fetch_ip_geodata.
    country_fill_sem = asyncio.Semaphore(1)

    async def run_one(u):
        chat_id = (u.get("telegram_chat_id") or "").strip()
        bot_token = (u.get("telegram_bot_token") or "").strip() or None
        try:
            from utils.ip_enrichment import maybe_fill_last_seen_country_for_auto_rank

            async with country_fill_sem:
                await maybe_fill_last_seen_country_for_auto_rank(db, u)
        except Exception:
            logger.debug(
                "Auto rank: last_seen_country backfill skipped for %s",
                u.get("id"),
                exc_info=True,
            )
        try:
            await _run_auto_rank_for_user(u["id"], u.get("username", "?"), chat_id, bot_token, crimes=crimes if crimes else None)
        except Exception as e:
            logger.exception("Auto rank for user %s: %s", u.get("id"), e)

    if users:
        from pymongo import UpdateOne

        batch_size = 30
        for i in range(0, len(users), batch_size):
            batch = users[i : i + batch_size]
            batch_start = datetime.now(timezone.utc)
            await _gather_with_concurrency([run_one(u) for u in batch], AUTO_RANK_MAX_CONCURRENT)
            clock = datetime.now(timezone.utc)
            anchor = cycle_start if cycle_start is not None else batch_start
            next_run_dt = max(anchor + timedelta(seconds=interval), clock)
            next_run_iso = next_run_dt.isoformat()
            await db.users.bulk_write(
                [UpdateOne({"id": u["id"]}, {"$set": {"auto_rank_next_run_at": next_run_iso}}) for u in batch],
                ordered=False,
            )


async def run_bust_5sec_once():
    """Single pass: for bust-every-5-sec users, try one jail bust each. Target pool = NPCs + jailed players (random pick so both can be busted).
    Skips users who have been inactive for 24+ hours (auto_rank_idle)."""
    import random
    import server as srv
    from routers.crime.jail import _global_jail_npc_filter

    db = srv.db
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    # Release anyone whose jail time just expired; clear next_run_at so they're immediately due for crimes/GTA
    await db.users.update_many(
        {"in_jail": True, "jail_until": {"$lte": now_iso}},
        {"$set": {"in_jail": False, "jail_until": None, "snitch_attempted_this_term": False}, "$unset": {"auto_rank_next_run_at": ""}},
    )
    if not await get_auto_rank_enabled(db):
        return
    try:
        cursor = db.users.find(
            {**_mongo_auto_rank_subscriber_clause(now), "auto_rank_enabled": True, "auto_rank_bust_every_5_sec": True, "in_jail": {"$ne": True}, "is_dead": {"$ne": True}, "auto_rank_idle": {"$ne": True}},
            {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1, "telegram_bot_token": 1, "last_seen": 1, "email": 1, "is_moderator": 1, **_AUTO_RANK_IDLE_CHECK_PROJECTION},
        )
        users = await cursor.to_list(500)
        
        # Check each user for idle status and filter out those who should be idle
        active_users = []
        for u in users:
            if _should_apply_auto_rank_idle(u, now):
                await _set_user_idle(db, u["id"], u.get("username", u["id"]))
            else:
                active_users.append(u)
        users = active_users
        buster_user_ids = {u["id"] for u in users}
        targets = []
        async for npc in db.jail_npcs.find(_global_jail_npc_filter(), {"_id": 0, "username": 1}):
            un = (npc.get("username") or "").strip()
            if un:
                targets.append(un)
        async for jailed in db.users.find({"in_jail": True}, {"_id": 0, "username": 1, "id": 1}):
            if jailed.get("id") not in buster_user_ids:
                un = (jailed.get("username") or "").strip()
                if un:
                    targets.append(un)
        bust_target_username = random.choice(targets) if targets else None
        async def run_one(u):
            chat_id = (u.get("telegram_chat_id") or "").strip()
            bot_token = (u.get("telegram_bot_token") or "").strip()
            try:
                if bust_target_username and bust_target_username != u.get("username"):
                    await _run_bust_only_for_user(u["id"], u.get("username", "?"), chat_id, bot_token or None, bust_target_username=bust_target_username)
                elif bust_target_username:
                    await _run_auto_rank_for_user(u["id"], u.get("username", "?"), chat_id, bot_token or None)
                else:
                    # No shared NPC / jailed target: each user may spawn a private cell and bust (see _run_bust_only_for_user).
                    await _run_bust_only_for_user(u["id"], u.get("username", "?"), chat_id, bot_token or None, bust_target_username=None)
            except Exception as e:
                logger.exception("Auto rank bust 5sec for user %s: %s", u.get("id"), e)

        if users:
            await _gather_with_concurrency([run_one(u) for u in users], AUTO_RANK_MAX_CONCURRENT)
    except Exception as e:
        logger.exception("Bust 5sec cycle failed: %s", e)


async def run_bust_5sec_loop():
    """Background loop: every N sec (config interval_bust_seconds), for bust-every-5-sec users, try one jail bust."""
    import server as srv
    db = srv.db
    while True:
        await run_bust_5sec_once()
        config = await get_auto_rank_config(db)
        interval = config.get("interval_bust_seconds") or BUST_EVERY_5SEC_INTERVAL
        await asyncio.sleep(max(1, interval))


async def run_auto_rank_oc_once():
    """Single pass: for OC users, run OC with NPC when timer ready. Used by cron or loop.
    Skips users who have been inactive for 24+ hours (auto_rank_idle)."""
    import server as srv
    from routers.crime.oc import run_oc_heist_npc_only
    from middleware.security import send_telegram_to_chat

    db = srv.db
    if not await get_auto_rank_enabled(db):
        return
    now = datetime.now(timezone.utc)
    try:
        cursor = db.users.find(
            {**_mongo_auto_rank_subscriber_clause(now), "auto_rank_enabled": True, "auto_rank_oc": True, "in_jail": {"$ne": True}, "is_dead": {"$ne": True}, "auto_rank_idle": {"$ne": True}},
            {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1, "telegram_bot_token": 1, "auto_rank_telegram_notify": 1, "auto_rank_oc_retry_at": 1, "last_seen": 1, "email": 1, "is_moderator": 1, **_AUTO_RANK_IDLE_CHECK_PROJECTION},
        )
        users = await cursor.to_list(500)
        
        # Check each user for idle status and filter out those who should be idle
        active_users = []
        for u in users:
            if _should_apply_auto_rank_idle(u, now):
                await _set_user_idle(db, u["id"], u.get("username", u["id"]))
            else:
                active_users.append(u)
        users = active_users
        
        user_oc_list = await db.user_organised_crime.find(
            {"user_id": {"$in": [u["id"] for u in users]}},
            {"_id": 0, "user_id": 1, "selected_equipment": 1},
        ).to_list(500)
        user_oc_by_id = {doc["user_id"]: doc.get("selected_equipment", "basic") for doc in user_oc_list}
        to_run = [u for u in users if not ((r := _parse_iso(u.get("auto_rank_oc_retry_at"))) and now < r)]

        async def run_one(u):
            chat_id = (u.get("telegram_chat_id") or "").strip()
            bot_token = (u.get("telegram_bot_token") or "").strip() or None
            selected_equipment = user_oc_by_id.get(u["id"], "basic")
            try:
                result = await run_oc_heist_npc_only(u["id"], selected_equipment_override=selected_equipment)
                if result.get("skipped_afford"):
                    retry_until = datetime.fromtimestamp(now.timestamp() + OC_RETRY_AFTER_AFFORD_SECONDS, tz=timezone.utc)
                    await db.users.update_one({"id": u["id"]}, {"$set": {"auto_rank_oc_retry_at": retry_until.isoformat()}})
                    return
                if chat_id and _auto_rank_telegram_notify(u) and result.get("ran") is True:
                    msg = _format_auto_rank_oc_telegram(u.get("username") or "?", result)
                    try:
                        await send_telegram_to_chat(chat_id, msg, bot_token, username=u.get("username", "?"))
                    except Exception as e:
                        logger.warning("Auto rank OC Telegram send for %s failed: %s", u.get("id"), e)
                if result.get("ran"):
                    await db.users.update_one({"id": u["id"]}, {"$unset": {"auto_rank_oc_retry_at": ""}})
            except Exception as e:
                logger.exception("Auto rank OC for user %s: %s", u.get("id"), e)

        if to_run:
            await _gather_with_concurrency([run_one(u) for u in to_run], AUTO_RANK_MAX_CONCURRENT)
    except Exception as e:
        logger.exception("Auto rank OC cycle failed: %s", e)


async def run_auto_rank_oc_loop():
    """Background loop: for OC users, run OC with NPC only when timer is ready."""
    import server as srv
    db = srv.db
    while True:
        await run_auto_rank_oc_once()
        config = await get_auto_rank_config(db)
        interval = config.get("interval_oc_seconds") or OC_LOOP_INTERVAL_SECONDS
        await asyncio.sleep(max(1, interval))


async def run_auto_rank_loop():
    """Main background loop: process due users and booze arrivals."""
    import server as srv
    db = srv.db
    while True:
        config = await get_auto_rank_config(db)
        if not config["enabled"]:
            await asyncio.sleep(2)
            continue
        await _expire_auto_rank_trials(db)
        try:
            await _wake_permanent_auto_rank_if_idle(db)
        except Exception as e:
            logger.warning("Auto rank loop: wake permanent idle users failed: %s", e)
        cycle_start = datetime.now(timezone.utc)
        try:
            await run_booze_arrivals()
        except Exception as e:
            logger.exception("Auto rank booze arrivals failed: %s", e)
        try:
            await run_auto_rank_due_users(interval_seconds=config["interval_seconds"], cycle_start=cycle_start)
        except Exception as e:
            logger.exception("Auto rank due-users run failed: %s", e)
        await asyncio.sleep(LOOP_WAKE_SECONDS)


async def run_auto_rank_cron_cycle():
    """
    Full Auto Rank cycle: booze arrivals, due users (crimes/GTA), bust pass, OC pass.
    Call from cron (e.g. every 2 min) when AUTO_RANK_USE_CRON=1; no in-process loops are started.
    """
    import server as srv
    db = srv.db
    config = await get_auto_rank_config(db)
    if not config["enabled"]:
        logger.info("Auto rank cron: skipped (auto_rank disabled in game settings)")
        return {"ok": True, "skipped": "auto_rank disabled"}
    await _expire_auto_rank_trials(db)
    try:
        await _wake_permanent_auto_rank_if_idle(db)
    except Exception as e:
        logger.warning("Auto rank: wake permanent idle users failed: %s", e)
    cycle_start = datetime.now(timezone.utc)
    try:
        await run_booze_arrivals()
    except Exception as e:
        logger.exception("Auto rank cron booze arrivals: %s", e)
    try:
        await run_auto_rank_due_users(interval_seconds=config["interval_seconds"], cycle_start=cycle_start)
    except Exception as e:
        logger.exception("Auto rank cron due-users: %s", e)
    try:
        await run_bust_5sec_once()
    except Exception as e:
        logger.exception("Auto rank cron bust: %s", e)
    try:
        await run_auto_rank_oc_once()
    except Exception as e:
        logger.exception("Auto rank cron OC: %s", e)
    return {"ok": True}


# ─── API routes ───────────────────────────────────────────────────

_PREFERENCE_FIELDS = [
    "auto_rank_enabled",
    "auto_rank_crimes",
    "auto_rank_gta",
    "auto_rank_bust_every_5_sec",
    "auto_rank_oc",
    "auto_rank_booze",
    "auto_rank_melt",
    "auto_rank_scrap",
    "auto_rank_telegram_notify",
    "auto_rank_use_skip_tokens",
]
_PREFERENCE_DEFAULTS = {
    "auto_rank_enabled": False,
    "auto_rank_crimes": False,
    "auto_rank_gta": False,
    "auto_rank_bust_every_5_sec": False,
    "auto_rank_oc": False,
    "auto_rank_booze": False,
    "auto_rank_melt": False,
    "auto_rank_scrap": False,
    "auto_rank_telegram_notify": True,
    "auto_rank_use_skip_tokens": False,
}

# Max skips burned per type (crime / GTA / booze) in one Auto Rank user cycle.
AUTO_RANK_SKIP_BATCH = 5
# Back-compat alias for older references / tests.
AUTO_RANK_CRIME_SKIP_CAP = AUTO_RANK_SKIP_BATCH

_SKIP_TOKEN_COUNT_FIELDS = {
    "crime": "cooldown_skip_crime_tokens",
    "gta": "cooldown_skip_gta_tokens",
    "booze": "cooldown_skip_booze_tokens",
    "properties": "cooldown_skip_properties_tokens",
}


async def _auto_rank_try_jail_bailout(db, user_id: str, user: dict, lines: list) -> Tuple[bool, dict]:
    """Spend one jail bailout token if possible. Returns (freed, refreshed_user)."""
    from routers.crime.jail import JAIL_BAILOUT_DAILY_CAP, _invalidate_all_jail_players_cache

    if not user or not user.get("in_jail"):
        return True, user or {}
    if int(user.get("jail_bailout_tokens") or 0) < 1:
        return False, user
    unbreakable = user.get("unbreakable_until")
    if unbreakable:
        try:
            ub = datetime.fromisoformat(str(unbreakable).replace("Z", "+00:00"))
            if ub.tzinfo is None:
                ub = ub.replace(tzinfo=timezone.utc)
            if ub > datetime.now(timezone.utc):
                return False, user
        except Exception:
            pass
    today = datetime.now(timezone.utc).date().isoformat()
    uses_today = int(user.get("jail_bailout_uses_today") or 0)
    if user.get("jail_bailout_day") == today and uses_today >= JAIL_BAILOUT_DAILY_CAP:
        return False, user
    # Path may appear in $set or $inc, never both (Mongo conflict on day rollover / first use).
    set_doc = {
        "in_jail": False,
        "jail_until": None,
        "snitch_attempted_this_term": False,
        "jail_bailout_day": today,
    }
    inc_doc = {"jail_bailout_tokens": -1}
    if user.get("jail_bailout_day") != today:
        set_doc["jail_bailout_uses_today"] = 1
    else:
        inc_doc["jail_bailout_uses_today"] = 1
    result = await db.users.update_one(
        {"id": user_id, "in_jail": True, "jail_bailout_tokens": {"$gte": 1}},
        {
            "$set": set_doc,
            "$inc": inc_doc,
            "$unset": {"auto_rank_next_run_at": ""},
        },
    )
    if result.modified_count == 0:
        return False, user
    try:
        _invalidate_all_jail_players_cache()
    except Exception:
        pass
    try:
        from utils.token_perk_stats import bump_token_perk_stats

        await bump_token_perk_stats(db, user_id, "jail_bailout", uses=1, via_auto_rank=1)
    except Exception:
        pass
    try:
        now = datetime.now(timezone.utc)
        await _inc_failed_today(
            db, user_id, "auto_rank_bailout_used_today", "auto_rank_bailout_date", now, 1
        )
    except Exception:
        pass
    refreshed = await db.users.find_one({"id": user_id}, {"_id": 0}) or user
    lines.append("**Jail** — Used a bailout token to get out.")
    return True, refreshed


def _can_use_skip(user: Optional[dict], kind: str) -> bool:
    """True if user already has a skip credit or can activate a held token (daily cap applies)."""
    if not user:
        return False
    from utils.cooldown_skip import has_skip_credit, can_activate_cooldown_skip_token

    if has_skip_credit(user, kind):
        return True
    token_field = _SKIP_TOKEN_COUNT_FIELDS.get(kind)
    if not token_field or int(user.get(token_field) or 0) < 1:
        return False
    return can_activate_cooldown_skip_token(user, kind)


def _has_any_usable_ar_skip(user: Optional[dict]) -> bool:
    """True if Crime, GTA, or Booze has a usable skip (token/credit under daily cap)."""
    return (
        _can_use_skip(user, "crime")
        or _can_use_skip(user, "gta")
        or _can_use_skip(user, "booze")
    )


def _fmt_skip_inbox_money(n: int) -> str:
    return f"${int(n):,}"


def _build_skip_tokens_depleted_inbox_message(user: dict) -> str:
    """Plain-text inbox summary matching Auto Rank Daily skips & bailouts cards."""
    now = datetime.now(timezone.utc)
    today = _today_utc(now)
    from utils.cooldown_skip import cooldown_skip_uses_today, cooldown_skip_daily_cap
    from routers.crime.jail import JAIL_BAILOUT_DAILY_CAP

    def _ar_today(used_field: str, date_field: str, cash_field: Optional[str] = None) -> Tuple[int, int]:
        used = int(user.get(used_field) or 0) if user.get(date_field) == today else 0
        cash = int(user.get(cash_field) or 0) if cash_field and user.get(date_field) == today else 0
        return used, cash

    crime_used, crime_cash = _ar_today(
        "auto_rank_skip_crime_used_today", "auto_rank_skip_crime_date", "auto_rank_skip_crime_cash_today"
    )
    gta_used, _ = _ar_today("auto_rank_skip_gta_used_today", "auto_rank_skip_gta_date")
    booze_used, booze_cash = _ar_today(
        "auto_rank_skip_booze_used_today", "auto_rank_skip_booze_date", "auto_rank_skip_booze_cash_today"
    )
    bailout_used = (
        int(user.get("auto_rank_bailout_used_today") or 0) if user.get("auto_rank_bailout_date") == today else 0
    )

    perk = user.get("token_perk_stats") if isinstance(user.get("token_perk_stats"), dict) else {}
    crime_perk = perk.get("cooldown_skip_crime") if isinstance(perk.get("cooldown_skip_crime"), dict) else {}
    gta_perk = perk.get("cooldown_skip_gta") if isinstance(perk.get("cooldown_skip_gta"), dict) else {}
    booze_perk = perk.get("cooldown_skip_booze") if isinstance(perk.get("cooldown_skip_booze"), dict) else {}
    bailout_perk = perk.get("jail_bailout") if isinstance(perk.get("jail_bailout"), dict) else {}

    crime_held = int(user.get("cooldown_skip_crime_tokens") or 0)
    gta_held = int(user.get("cooldown_skip_gta_tokens") or 0)
    booze_held = int(user.get("cooldown_skip_booze_tokens") or 0)
    bailout_held = int(user.get("jail_bailout_tokens") or 0)
    crime_left = max(0, cooldown_skip_daily_cap("crime") - cooldown_skip_uses_today(user, "crime"))
    gta_left = max(0, cooldown_skip_daily_cap("gta") - cooldown_skip_uses_today(user, "gta"))
    booze_left = max(0, cooldown_skip_daily_cap("booze") - cooldown_skip_uses_today(user, "booze"))
    bailout_uses_today = (
        int(user.get("jail_bailout_uses_today") or 0) if user.get("jail_bailout_day") == today else 0
    )
    bailout_left = max(0, JAIL_BAILOUT_DAILY_CAP - bailout_uses_today)

    lines = [
        "Crime, GTA, and Booze skips are all empty or at daily cap.",
        "Use cooldown skip tokens has been turned off.",
        "",
        "── Crime skip ──",
        f"Held: {crime_held:,}",
        f"AR used today: {crime_used:,}",
        f"Cash from skips: {_fmt_skip_inbox_money(crime_cash)}",
        f"Left today: {crime_left:,}",
        f"Lifetime cash: {_fmt_skip_inbox_money(int(crime_perk.get('cash_earned') or 0))}",
        "",
        "── GTA skip ──",
        f"Held: {gta_held:,}",
        f"AR used today: {gta_used:,}",
        f"Left today: {gta_left:,}",
        f"Lifetime uses: {int(gta_perk.get('uses') or 0):,}",
    ]
    stolen_bits = []
    for field, label in (
        ("stolen_legendary", "legendary"),
        ("stolen_ultra_rare", "ultra rare"),
        ("stolen_rare", "rare"),
        ("stolen_uncommon", "uncommon"),
        ("stolen_common", "common"),
        ("stolen_exclusive", "exclusive"),
        ("stolen_custom", "custom"),
    ):
        n = int(gta_perk.get(field) or 0)
        if n > 0:
            stolen_bits.append(f"{n:,} {label}")
    if stolen_bits:
        lines.append(f"Stolen via skips: {', '.join(stolen_bits)}")
    lines.extend([
        "",
        "── Booze travel skip ──",
        f"Held: {booze_held:,}",
        f"AR used today: {booze_used:,}",
        f"Profit from skips: {_fmt_skip_inbox_money(booze_cash)}",
        f"Left today: {booze_left:,}",
        f"Lifetime profit: {_fmt_skip_inbox_money(int(booze_perk.get('profit_cash') or 0))}",
        "",
        "── Jail bailout ──",
        f"Held: {bailout_held:,}",
        f"AR used today: {bailout_used:,}",
        f"Left today: {bailout_left:,}",
        f"Life (AR): {int(bailout_perk.get('via_auto_rank') or 0):,}",
        f"Life (all): {int(bailout_perk.get('uses') or 0):,}",
        "",
        "Buy more Crime / GTA / Booze skip tokens in the Points Store to turn the toggle on again.",
        "Open Auto Rank",
    ])
    return "\n".join(lines)


async def _notify_skip_tokens_depleted(user_id: str, user: dict) -> None:
    """Send one inbox summary when Auto Rank auto-disables skip tokens."""
    try:
        import server as srv

        await srv.send_notification(
            user_id,
            "Auto Rank — skip tokens depleted",
            _build_skip_tokens_depleted_inbox_message(user),
            "system",
            category="system",
            always_deliver=True,
            message_link_to="/account/autorank",
            message_link_label="Open Auto Rank",
        )
    except Exception:
        logger.exception("Auto Rank skip-depleted inbox notify failed for %s", user_id)


async def _auto_disable_skip_tokens_if_empty(db, user_id: str, user: dict) -> dict:
    """Turn off auto_rank_use_skip_tokens when Crime+GTA+Booze all have 0 usable skips.

    When the toggle actually flips off, send a one-shot inbox summary of skips used/gained.
    """
    if not user or user.get("auto_rank_use_skip_tokens") is not True:
        return user or {}
    if _has_any_usable_ar_skip(user):
        return user
    result = await db.users.update_one(
        {"id": user_id, "auto_rank_use_skip_tokens": True},
        {"$set": {"auto_rank_use_skip_tokens": False}},
    )
    user = dict(user)
    user["auto_rank_use_skip_tokens"] = False
    if result.modified_count:
        fresh = await db.users.find_one({"id": user_id}, {"_id": 0}) or user
        fresh = dict(fresh)
        fresh["auto_rank_use_skip_tokens"] = False
        await _notify_skip_tokens_depleted(user_id, fresh)
        return fresh
    return user


async def _ensure_skip_credit(db, user_id: str, user: dict, kind: str) -> Tuple[bool, dict]:
    """Ensure one skip credit is available for kind, auto-activating a held token if needed.

    Returns (ok, refreshed_user). Does not consume the credit — callers / commit paths do that.
    """
    from utils.cooldown_skip import (
        has_skip_credit,
        can_activate_cooldown_skip_token,
        activation_inc_fields,
    )

    if not user or not user_id:
        return False, user or {}
    if has_skip_credit(user, kind):
        return True, user
    token_field = _SKIP_TOKEN_COUNT_FIELDS.get(kind)
    if not token_field or int(user.get(token_field) or 0) < 1:
        return False, user
    if not can_activate_cooldown_skip_token(user, kind):
        return False, user
    inc, set_doc = activation_inc_fields(kind, user)
    inc[token_field] = -1
    r = await db.users.update_one(
        {"id": user_id, token_field: {"$gte": 1}},
        {"$inc": inc, "$set": set_doc},
    )
    if r.modified_count != 1:
        return False, user
    refreshed = await db.users.find_one({"id": user_id}, {"_id": 0}) or user
    return has_skip_credit(refreshed, kind), refreshed


def _auto_rank_task_enabled(user: Optional[dict], field: str) -> bool:
    """Module toggles are opt-in only — missing/legacy fields must not run."""
    if not user:
        return False
    if user.get("auto_rank_enabled") is not True:
        return False
    if user.get("auto_rank_idle") is True:
        return False
    return user.get(field) is True

MELT_OPTIONS = [
    {"id": "bullets", "name": "Melt for Bullets"},
    {"id": "cash", "name": "Scrap for Cash"},
]
MELT_RARITIES = ["common", "uncommon", "rare", "ultra_rare", "legendary", "custom", "loot_exclusive", "exclusive"]
SCRAP_RARITIES = list(MELT_RARITIES)
SCRAP_INTERVAL_SECONDS = 120  # Scrap (when run separately) runs once every 2 minutes


def _extract_preferences(user: dict) -> dict:
    if not user:
        return dict(_PREFERENCE_DEFAULTS)
    out = dict(_PREFERENCE_DEFAULTS)
    out["auto_rank_enabled"] = user.get("auto_rank_enabled") is True
    out["auto_rank_telegram_notify"] = user.get("auto_rank_telegram_notify") is not False
    out["auto_rank_use_skip_tokens"] = user.get("auto_rank_use_skip_tokens") is True
    for k in _PREFERENCE_FIELDS:
        if k in ("auto_rank_enabled", "auto_rank_telegram_notify", "auto_rank_use_skip_tokens"):
            continue
        out[k] = _auto_rank_task_enabled(user, k)
    return out


def _format_duration_hms(seconds: Optional[int]) -> Optional[str]:
    if seconds is None or seconds < 0:
        return None
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    parts: List[str] = []
    if h:
        parts.append(f"{h}h")
    if m:
        parts.append(f"{m}m")
    if s or not parts:
        parts.append(f"{s}s")
    return " ".join(parts)


def _build_auto_rank_diagnostics(doc: dict, *, global_enabled: bool) -> Dict[str, Any]:
    """Human-readable blockers and cron eligibility for admin inspect."""
    now = datetime.now(timezone.utc)
    blockers: List[str] = []
    warnings: List[str] = []
    notes: List[str] = []

    has_access = _user_has_auto_rank_access(doc)
    purchased = bool(doc.get("auto_rank_purchased"))
    trial_flag = bool(doc.get("auto_rank_trial"))
    is_permanent = _user_has_permanent_auto_rank(doc)
    trial_active = _auto_rank_trial_active(doc, now)
    trial_until = _parse_iso(doc.get("auto_rank_trial_until"))

    if is_permanent:
        access_type = "permanent"
    elif trial_active:
        access_type = "trial_active"
    elif trial_flag or trial_until:
        access_type = "trial_expired"
    elif purchased:
        access_type = "purchased_legacy"
    else:
        access_type = "none"

    trial_seconds_remaining = None
    if not is_permanent and trial_until and trial_until > now:
        trial_seconds_remaining = int((trial_until - now).total_seconds())

    auto_rank_2h_tokens = int(doc.get("auto_rank_2h_tokens") or 0)
    staff = _is_staff(doc)
    idle_exempt = _auto_rank_idle_exempt(doc)
    last_seen = doc.get("last_seen")
    last_seen_hours_ago = None
    hours_until_idle = None
    would_go_idle_now = False
    if last_seen:
        ls = _parse_iso(last_seen)
        if ls:
            elapsed_h = (now - ls).total_seconds() / 3600
            last_seen_hours_ago = round(elapsed_h, 2)
            remaining_s = AUTO_RANK_IDLE_TIMEOUT_SECONDS - (now - ls).total_seconds()
            hours_until_idle = round(max(0, remaining_s) / 3600, 2) if remaining_s > 0 else 0
            would_go_idle_now = _should_apply_auto_rank_idle(doc, now)

    if not has_access:
        if access_type == "trial_expired":
            blockers.append("Trial expired — auto rank access removed")
        else:
            blockers.append("No Auto Rank purchase or active trial")

    if not doc.get("auto_rank_enabled"):
        blockers.append("Master switch off (auto_rank_enabled=false)")
    elif doc.get("auto_rank_idle"):
        blockers.append("Auto Rank idle — no site activity for 24h+ (visit any page to wake)")

    if not global_enabled:
        blockers.append("Global Auto Rank loop disabled (admin must Start loop)")

    if doc.get("is_dead"):
        blockers.append("Account is dead")

    in_jail = bool(doc.get("in_jail"))
    jail_until_dt = _parse_iso(doc.get("jail_until"))
    jail_active = in_jail and jail_until_dt and jail_until_dt > now
    if jail_active:
        blockers.append("In jail — main crime/GTA/OC/booze cycles paused")

    active_tasks = [k for k in _IDLE_SAVE_FIELDS if _auto_rank_task_enabled(doc, k)]
    if doc.get("auto_rank_enabled") and not doc.get("auto_rank_idle") and not active_tasks:
        warnings.append("Enabled but all task toggles are off — nothing to run")

    if staff:
        notes.append("Staff account — exempt from 24h idle pause")
    elif idle_exempt:
        notes.append("Permanent Auto Rank — exempt from 24h idle pause")
    elif last_seen_hours_ago is not None and not doc.get("auto_rank_idle") and hours_until_idle is not None and hours_until_idle < 6:
        warnings.append(
            f"Will go idle in ~{hours_until_idle}h if user does not visit the site (last seen {last_seen_hours_ago}h ago)"
        )

    base_cron_ok = (
        has_access
        and doc.get("auto_rank_enabled")
        and not doc.get("is_dead")
        and not doc.get("auto_rank_idle")
        and not jail_active
        and global_enabled
    )

    next_run_dt = _parse_iso(doc.get("auto_rank_next_run_at"))
    main_cycle_due = base_cron_ok and (not next_run_dt or next_run_dt <= now)
    bust_loop_ok = base_cron_ok and doc.get("auto_rank_bust_every_5_sec")
    oc_loop_ok = base_cron_ok and doc.get("auto_rank_oc")
    oc_retry_dt = _parse_iso(doc.get("auto_rank_oc_retry_at"))
    oc_retry_waiting = bool(oc_retry_dt and oc_retry_dt > now)
    if oc_loop_ok and oc_retry_waiting:
        warnings.append(f"OC enabled but retry backoff until {doc.get('auto_rank_oc_retry_at')}")

    next_run_in_seconds = None
    if next_run_dt and next_run_dt > now:
        next_run_in_seconds = int((next_run_dt - now).total_seconds())
        if base_cron_ok and active_tasks:
            notes.append(f"Main cycle scheduled in {_format_duration_hms(next_run_in_seconds)}")

    if blockers:
        status = "blocked"
        summary = blockers[0]
    elif not active_tasks and doc.get("auto_rank_enabled"):
        status = "idle_tasks"
        summary = "Enabled but no tasks selected"
    elif main_cycle_due or bust_loop_ok or (oc_loop_ok and not oc_retry_waiting):
        status = "running"
        summary = "Should be running in cron loops"
    elif base_cron_ok and next_run_in_seconds:
        status = "waiting"
        summary = f"Waiting for next cycle ({_format_duration_hms(next_run_in_seconds)})"
    else:
        status = "inactive"
        summary = "Not actively cycling"

    recommendations: List[str] = []
    if doc.get("auto_rank_idle"):
        recommendations.append("User should visit any game page once to restore saved task toggles")
    if access_type == "trial_expired":
        recommendations.append("Grant permanent AR from Admin or user redeems a 2h token from Store")
    if not global_enabled:
        recommendations.append("Start global loop from Auto Rank admin section")
    if auto_rank_2h_tokens > 0 and access_type in ("none", "trial_expired"):
        recommendations.append(f"User has {auto_rank_2h_tokens} unused 2h token(s) — redeem from Store")

    return {
        "status": status,
        "summary": summary,
        "access_type": access_type,
        "auto_rank_has_access": has_access,
        "auto_rank_permanent": is_permanent,
        "trial_active": trial_active,
        "trial_seconds_remaining": trial_seconds_remaining,
        "trial_until": doc.get("auto_rank_trial_until"),
        "auto_rank_2h_tokens": auto_rank_2h_tokens,
        "staff_exempt_from_idle": staff,
        "idle_exempt": idle_exempt,
        "last_seen_hours_ago": last_seen_hours_ago,
        "idle_threshold_hours": AUTO_RANK_IDLE_TIMEOUT_SECONDS / 3600,
        "hours_until_idle": hours_until_idle,
        "would_go_idle_without_visit": would_go_idle_now,
        "global_loop_enabled": global_enabled,
        "active_task_toggles": active_tasks,
        "cron": {
            "main_cycle_due": main_cycle_due,
            "bust_loop_eligible": bust_loop_ok,
            "oc_loop_eligible": oc_loop_ok and not oc_retry_waiting,
            "oc_retry_at": doc.get("auto_rank_oc_retry_at") if oc_retry_waiting else None,
            "next_run_in_seconds": next_run_in_seconds,
        },
        "blockers": blockers,
        "warnings": warnings,
        "notes": notes,
        "recommendations": recommendations,
    }


async def _auto_rank_selection_labels_for_inspect(db, u: dict) -> dict:
    """Resolve crime/GTA/melt/scrap selection IDs to human-readable labels for admin inspect."""
    crime_ids = u.get("auto_rank_crime_ids") if isinstance(u.get("auto_rank_crime_ids"), list) else []
    gta_ids = u.get("auto_rank_gta_option_ids") if isinstance(u.get("auto_rank_gta_option_ids"), list) else []
    melt_action_ids = u.get("auto_rank_melt_action_ids") if isinstance(u.get("auto_rank_melt_action_ids"), list) else []
    melt_rarity_ids = u.get("auto_rank_melt_rarity_ids") if isinstance(u.get("auto_rank_melt_rarity_ids"), list) else []
    scrap_rarity_ids = u.get("auto_rank_scrap_rarity_ids") if isinstance(u.get("auto_rank_scrap_rarity_ids"), list) else []

    id_to_name: dict = {}
    try:
        crimes = await db.crimes.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(120)
        for c in crimes or []:
            cid = c.get("id")
            if cid:
                id_to_name[str(cid)] = (c.get("name") or cid) or cid
    except Exception:
        crimes = []
    try:
        from routers.crime.crimes import PRESTIGE_CRIMES
        for pc in PRESTIGE_CRIMES or []:
            pid = pc.get("id")
            if pid and str(pid) not in id_to_name:
                id_to_name[str(pid)] = (pc.get("name") or pid) or pid
    except Exception:
        pass

    crime_rows = [{"id": str(cid), "name": id_to_name.get(str(cid), str(cid))} for cid in crime_ids]

    gta_rows: List[dict] = []
    try:
        from routers.cars.gta import GTA_OPTIONS
        gta_map = {str(o.get("id", "")): (o.get("name") or o.get("id")) for o in (GTA_OPTIONS or []) if o.get("id")}
        for gid in gta_ids:
            sg = str(gid)
            gta_rows.append({"id": sg, "name": gta_map.get(sg, sg)})
    except Exception:
        for gid in gta_ids:
            gta_rows.append({"id": str(gid), "name": str(gid)})

    melt_action_map = {str(x["id"]): x["name"] for x in MELT_OPTIONS}
    melt_action_rows = [{"id": str(mid), "name": melt_action_map.get(str(mid), str(mid))} for mid in melt_action_ids]

    def _rarity_label(r: Any) -> str:
        if not isinstance(r, str):
            return str(r)
        return r.replace("_", " ").title()

    return {
        "crimes": crime_rows,
        "gta_options": gta_rows,
        "melt_actions": melt_action_rows,
        "melt_rarities": [{"id": str(r), "name": _rarity_label(r)} for r in melt_rarity_ids],
        "scrap_rarities": [{"id": str(r), "name": _rarity_label(r)} for r in scrap_rarity_ids],
    }


def register(router):
    import server as srv
    from fastapi import Depends, Header, HTTPException, Request
    from pydantic import BaseModel
    from middleware.security import send_telegram_to_chat
    import middleware.security as security_module

    db = srv.db
    get_current_user = srv.get_current_user
    _is_admin = srv._is_admin
    _is_moderator = srv._is_moderator
    require_admin_or_mod = srv.require_admin_or_mod
    require_staff_issued_if_staff_capable = srv.require_staff_issued_if_staff_capable
    cron_secret = (os.environ.get("CRON_SECRET") or "").strip()
    telegram_webhook_secret = (os.environ.get("TELEGRAM_WEBHOOK_SECRET") or "").strip()
    game_bot_token = (getattr(security_module, "TELEGRAM_BOT_TOKEN", None) or "").strip()

    async def verify_cron_secret(x_cron_secret: Optional[str] = Header(None, alias="X-Cron-Secret")):
        if not cron_secret:
            raise HTTPException(status_code=503, detail="Cron not configured (CRON_SECRET unset)")
        received = (x_cron_secret or "").strip()
        if received != cron_secret:
            logger.warning(
                "Cron auth failed: X-Cron-Secret mismatch (len received=%s, expected=%s). Check crontab/curl uses same CRON_SECRET as backend .env.",
                len(received),
                len(cron_secret),
            )
            raise HTTPException(status_code=403, detail="Invalid cron secret")

    @router.post("/auto-rank/cron")
    async def cron_auto_rank(_: None = Depends(verify_cron_secret)):
        """Cron endpoint: run one Auto Rank cycle (booze arrivals + due users + OC). Call every 5s when AUTO_RANK_USE_CRON=1 (same as jail busts). Header: X-Cron-Secret: <CRON_SECRET>."""
        result = await run_auto_rank_cron_cycle()
        return result

    @router.post("/auto-rank/cron-bust")
    async def cron_auto_rank_bust(_: None = Depends(verify_cron_secret)):
        """Cron endpoint: run only the jail bust pass. Call every 5 seconds when AUTO_RANK_USE_CRON=1 so bust-every-5-sec users get a bust every 5s. Use with main /auto-rank/cron at 5s. Header: X-Cron-Secret: <CRON_SECRET>."""
        try:
            await run_bust_5sec_once()
        except Exception as e:
            logger.exception("Auto rank cron-bust failed: %s", e)
        return {"ok": True}

    @router.get("/auto-rank/cron-intervals")
    async def get_cron_intervals(_: None = Depends(verify_cron_secret)):
        """Return admin-configured intervals for cron tickers. Auth: X-Cron-Secret only. Tickers use this so admin settings control call frequency."""
        config = await get_auto_rank_config(db)
        return {
            "interval_seconds": config["interval_seconds"],
            "interval_bust_seconds": config.get("interval_bust_seconds") or DEFAULT_BUST_INTERVAL_SECONDS,
            "interval_oc_seconds": config.get("interval_oc_seconds") or DEFAULT_OC_INTERVAL_SECONDS,
        }

    @router.post("/auto-rank/telegram-webhook")
    async def telegram_webhook(request: Request):
        """Telegram bot webhook: receive commands from users who have Telegram set for Auto Rank. Commands: /start, /autorank, /summary, /enable, /disable."""
        if telegram_webhook_secret:
            secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") or ""
            if not hmac.compare_digest(secret.strip(), telegram_webhook_secret):
                raise HTTPException(status_code=403, detail="Invalid webhook secret")
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON")
        message = (body or {}).get("message") or {}
        chat = message.get("chat") or {}
        chat_id = chat.get("id")
        text = ((message.get("text") or "").strip() or "").lower()
        chat_id_str = str(chat_id) if chat_id is not None else ""
        logger.info("Telegram webhook received chat_id=%s text=%s", chat_id_str, (text or "")[:80])
        if chat_id is None or not text:
            return {"ok": True}
        try:
            # /start — always reply so user sees the bot is alive and knows what to do
            if text in ("/start", "start"):
                start_user = await db.users.find_one(
                    {"telegram_chat_id": chat_id_str},
                    {"_id": 0, "username": 1, "auto_rank_purchased": 1, "auto_rank_enabled": 1},
                )
                if start_user and (start_user.get("auto_rank_purchased") or start_user.get("auto_rank_enabled")):
                    reply = f"Hi {start_user.get('username', 'there')}! Use /autorank for your Auto Rank summary. Commands: /autorank /summary /enable /disable."
                    await send_telegram_to_chat(chat_id_str, reply, game_bot_token or None, username=start_user.get("username"))
                else:
                    reply = "Welcome! Link your Chat ID in the game (Profile → Telegram). Get your ID from @userinfobot. Then use /autorank for your Auto Rank summary."
                    await send_telegram_to_chat(chat_id_str, reply, game_bot_token or None)
                return {"ok": True}
        except Exception as e:
            logger.exception("Telegram /start handler: %s", e)
            return {"ok": True}

        try:
            user = await db.users.find_one(
                {"telegram_chat_id": chat_id_str},
                {"_id": 0, "id": 1, "username": 1, "auto_rank_purchased": 1, "auto_rank_enabled": 1, **{f: 1 for f in _PREFERENCE_FIELDS}, "auto_rank_total_busts": 1, "auto_rank_total_crimes": 1, "auto_rank_total_gtas": 1, "auto_rank_total_cash": 1, "auto_rank_total_booze_runs": 1, "auto_rank_total_booze_profit": 1, "auto_rank_stats_since": 1, "in_jail": 1, "jail_until": 1, "auto_rank_next_run_at": 1, "activity_detail": 1},
            )
            if not user:
                reply = "Link your Telegram first: set your Chat ID in Profile → Telegram (Auto Rank). Get your Chat ID from @userinfobot. Then message this bot again."
                await send_telegram_to_chat(chat_id_str, reply, game_bot_token or None)
                return {"ok": True}
            has_autorank = user.get("auto_rank_purchased") or user.get("auto_rank_enabled")
            if not has_autorank:
                reply = "Auto Rank is not active on your account. Enable it in game (Store / Auto Rank) first."
                await send_telegram_to_chat(chat_id_str, reply, game_bot_token or None, username=user.get("username"))
                return {"ok": True}

            reply = None
            if text in ("/autorank", "/summary", "autorank", "summary"):
                stats = await _get_auto_rank_stats_impl(db, user)
                lines = [
                    f"Auto Rank — {user.get('username', '?')}",
                    "",
                    "On" if user.get("auto_rank_enabled") else "Off",
                    f"Crimes: {'on' if user.get('auto_rank_crimes') else 'off'} · GTA: {'on' if user.get('auto_rank_gta') else 'off'} · Melt: {'on' if user.get('auto_rank_melt') else 'off'} · Scrap: {'on' if user.get('auto_rank_scrap') else 'off'}",
                    f"Bust 5s: {'on' if user.get('auto_rank_bust_every_5_sec') else 'off'} · OC: {'on' if user.get('auto_rank_oc') else 'off'} · Booze: {'on' if user.get('auto_rank_booze') else 'off'}",
                    f"TG alerts: {'on' if _auto_rank_telegram_notify(user) else 'off'} (game → Auto Rank)",
                    f"Skip tokens: {'on' if user.get('auto_rank_use_skip_tokens') is True else 'off'}",
                    "",
                    f"Total: {stats.get('total_crimes', 0)} crimes, {stats.get('total_gtas', 0)} GTAs, {stats.get('total_busts', 0)} busts",
                    f"Cash: ${stats.get('total_cash', 0):,} · Booze: {stats.get('total_booze_runs', 0)} runs (${stats.get('total_booze_profit', 0):,})",
                ]
                melted = stats.get("total_cars_melted", 0) or 0
                scrapped = stats.get("total_cars_scrapped", 0) or 0
                bullets = stats.get("total_bullets_from_melt", 0) or 0
                scrap_cash = stats.get("total_cash_from_scrap", 0) or 0
                if melted or scrapped or bullets or scrap_cash:
                    melt_parts = []
                    if melted:
                        melt_parts.append(f"{melted} melted")
                    if bullets:
                        melt_parts.append(f"{bullets} bullets")
                    if scrapped:
                        melt_parts.append(f"{scrapped} scrapped")
                    if scrap_cash:
                        melt_parts.append(f"${scrap_cash:,} scrap")
                    lines.append("Melt: " + " · ".join(melt_parts))
                lines.extend([
                    "",
                    f"Running: {stats.get('running_seconds', 0) // 60} min",
                ])
                if stats.get("in_jail"):
                    lines.append("In jail — cycles paused.")
                elif stats.get("activity_detail"):
                    lines.append(stats["activity_detail"])
                reply = "\n".join(lines)
            else:
                parts = text.split()
                cmd = (parts[0] or "").lstrip("/")
                target = (parts[1] or "").strip() if len(parts) > 1 else ""
                key_map = {"all": "auto_rank_enabled", "crimes": "auto_rank_crimes", "gta": "auto_rank_gta", "bust": "auto_rank_bust_every_5_sec", "oc": "auto_rank_oc", "booze": "auto_rank_booze", "melt": "auto_rank_melt", "scrap": "auto_rank_scrap"}
                field = key_map.get(target) if target else None
                if cmd == "enable" and field:
                    updates = {field: True}
                    if field == "auto_rank_enabled":
                        pass
                    else:
                        updates["auto_rank_enabled"] = True
                    await db.users.update_one({"id": user["id"]}, {"$set": updates})
                    name = target if target != "all" else "Auto Rank"
                    reply = f"{name} enabled."
                elif cmd == "disable" and field:
                    updates = {field: False}
                    if field == "auto_rank_enabled":
                        updates["auto_rank_crimes"] = False
                        updates["auto_rank_gta"] = False
                        updates["auto_rank_bust_every_5_sec"] = False
                        updates["auto_rank_oc"] = False
                        updates["auto_rank_booze"] = False
                        updates["auto_rank_melt"] = False
                        updates["passive_booze_paused"] = True
                    op = {"$set": updates}
                    if field == "auto_rank_enabled":
                        op["$unset"] = {"auto_rank_stats_since": ""}
                    await db.users.update_one({"id": user["id"]}, op)
                    name = target if target != "all" else "Auto Rank"
                    reply = f"{name} disabled."
                else:
                    reply = "Commands: /autorank or /summary — stats. /enable or /disable plus: all, crimes, gta, bust, oc, booze, melt, scrap. Example: /disable bust"

            if reply:
                await send_telegram_to_chat(chat_id_str, reply, game_bot_token or None, username=user.get("username"))
            return {"ok": True}
        except Exception as e:
            logger.exception("Telegram webhook handler: %s", e)
            return {"ok": True}

    @router.get("/admin/auto-rank/telegram-webhook-status")
    async def admin_telegram_webhook_status(current_user: dict = Depends(get_current_user)):
        """Admin: get current Telegram webhook URL and pending update count. Use to verify bot receives commands."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        info = await security_module.get_telegram_webhook_info()
        base_from_env = (os.environ.get("TELEGRAM_WEBHOOK_BASE_URL") or os.environ.get("BASE_URL") or "").strip().rstrip("/")
        expected_url = (base_from_env + "/api/auto-rank/telegram-webhook") if base_from_env else ""
        return {
            "webhook_info": info,
            "expected_url_if_base_set": expected_url or None,
            "TELEGRAM_WEBHOOK_BASE_URL_or_BASE_URL_set": bool(base_from_env),
            "hint": "If url is empty, set TELEGRAM_WEBHOOK_BASE_URL or BASE_URL and restart (or call POST /admin/auto-rank/telegram-webhook-register). Message the SAME bot (game bot) that has this webhook; set your Chat ID in Profile → Telegram.",
        }

    @router.post("/admin/auto-rank/telegram-webhook-register")
    async def admin_telegram_webhook_register(current_user: dict = Depends(get_current_user)):
        """Admin: register webhook with Telegram now (no restart). Uses TELEGRAM_WEBHOOK_BASE_URL or BASE_URL from env."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        base = (os.environ.get("TELEGRAM_WEBHOOK_BASE_URL") or os.environ.get("BASE_URL") or "").strip().rstrip("/")
        if not base:
            raise HTTPException(status_code=400, detail="Set TELEGRAM_WEBHOOK_BASE_URL or BASE_URL in .env first")
        url = base + "/api/auto-rank/telegram-webhook"
        ok = await security_module.set_telegram_webhook(url, secret_token=os.environ.get("TELEGRAM_WEBHOOK_SECRET") or None)
        if not ok:
            raise HTTPException(status_code=502, detail="setWebhook failed; check server logs and TELEGRAM_BOT_TOKEN")
        await security_module.set_telegram_bot_commands()
        return {"message": "Webhook and command menu registered.", "url": url}

    class IntervalBody(BaseModel):
        interval_seconds: Optional[int] = None
        interval_bust_seconds: Optional[int] = None
        interval_oc_seconds: Optional[int] = None

    class MePreferencesBody(BaseModel):
        auto_rank_enabled: Optional[bool] = None
        auto_rank_crimes: Optional[bool] = None
        auto_rank_gta: Optional[bool] = None
        auto_rank_bust_every_5_sec: Optional[bool] = None
        auto_rank_oc: Optional[bool] = None
        auto_rank_booze: Optional[bool] = None
        auto_rank_melt: Optional[bool] = None
        auto_rank_scrap: Optional[bool] = None
        auto_rank_telegram_notify: Optional[bool] = None
        auto_rank_use_skip_tokens: Optional[bool] = None
        passive_booze_paused: Optional[bool] = None
        auto_rank_crime_ids: Optional[list] = None
        auto_rank_gta_option_ids: Optional[list] = None
        auto_rank_melt_action_ids: Optional[list] = None
        auto_rank_melt_rarity_ids: Optional[list] = None
        auto_rank_scrap_rarity_ids: Optional[list] = None
        auto_rank_trial_dismissed: Optional[bool] = None
        robot_bg_auto_search_enabled: Optional[bool] = None

    from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_AUTO_RANK

    async def _auto_rank_me_rl_user(current_user: dict = Depends(get_current_user)):
        await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_AUTO_RANK)

    @router.get("/auto-rank/me", dependencies=[Depends(_auto_rank_me_rl_user)])
    async def get_my_preferences(current_user: dict = Depends(get_current_user)):
        try:
            user_id = (current_user or {}).get("id", "?")
            await _expire_auto_rank_trials(db)
            user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0}) or current_user
            if user.get("email_verified") and (user.get("email") or "").strip():
                try:
                    from utils.auto_rank_email_entitlement import sync_auto_rank_email_entitlement_to_user

                    if await sync_auto_rank_email_entitlement_to_user(db, user.get("id"), user.get("email")):
                        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0}) or user
                except Exception:
                    pass
            _, user = await _resolve_permanent_auto_rank(db, user, heal=True)
            chat_id = (user.get("telegram_chat_id") or "").strip()
            prefs = _extract_preferences(user)
            prefs["auto_rank_purchased"] = bool(user.get("auto_rank_purchased"))
            prefs["auto_rank_permanent"] = _user_has_permanent_auto_rank(user)
            prefs["auto_rank_has_access"] = _user_has_auto_rank_access(user)
            prefs["auto_rank_trial"] = bool(user.get("auto_rank_trial"))
            prefs["auto_rank_trial_until"] = user.get("auto_rank_trial_until")
            prefs["auto_rank_trial_dismissed"] = bool(user.get("auto_rank_trial_dismissed"))
            prefs["telegram_chat_id_set"] = bool(chat_id)
            prefs["auto_rank_crime_ids"] = user.get("auto_rank_crime_ids") or []
            prefs["auto_rank_gta_option_ids"] = user.get("auto_rank_gta_option_ids") or []
            prefs["auto_rank_melt_action_ids"] = user.get("auto_rank_melt_action_ids") or []
            prefs["auto_rank_melt_rarity_ids"] = user.get("auto_rank_melt_rarity_ids") or []
            prefs["auto_rank_scrap"] = _auto_rank_task_enabled(user, "auto_rank_scrap")
            prefs["auto_rank_scrap_rarity_ids"] = user.get("auto_rank_scrap_rarity_ids") or []
            from utils.auto_rank_email_entitlement import email_has_auto_rank_entitlement

            email_norm = (user.get("email") or "").strip()
            prefs["auto_rank_email_entitled"] = bool(
                user.get("auto_rank_email_entitlement") or await email_has_auto_rank_entitlement(db, email_norm)
            )
            prefs["auto_rank_stripe_purchasable"] = bool(
                user.get("email_verified")
                and email_norm
                and not prefs["auto_rank_email_entitled"]
            )
            prefs["passive_booze_paused"] = bool(user.get("passive_booze_paused"))
            from utils.robot_bg_auto_search import robot_bg_auto_search_active, robot_bg_auto_search_enabled

            prefs["robot_bg_auto_search_subscription_active"] = robot_bg_auto_search_active(user)
            prefs["robot_bg_auto_search_enabled"] = robot_bg_auto_search_enabled(user)
            prefs["robot_bg_auto_search_until"] = user.get("robot_bg_auto_search_until")
            logger.debug("Auto rank GET /me ok user_id=%s", user_id)
            return prefs
        except Exception as e:
            logger.exception("Auto rank GET /me failed: %s", e)
            raise

    @router.get("/auto-rank/settings")
    async def get_settings_options(current_user: dict = Depends(get_current_user)):
        """Return crimes, GTA options, and melt options for the settings tab, plus current selection."""
        try:
            from routers.cars.gta import GTA_OPTIONS
            crimes = await db.crimes.find(
                {},
                {"_id": 0, "id": 1, "name": 1, "min_rank": 1, "prestige_required": 1, "crime_type": 1},
            ).sort("min_rank", 1).to_list(100)
            # Ensure prestige crimes appear as selectable options even if they aren't stored in db.crimes
            try:
                from routers.crime.crimes import PRESTIGE_CRIMES
                existing_ids = {c.get("id") for c in crimes if c.get("id")}
                for pc in (PRESTIGE_CRIMES or []):
                    if pc.get("id") and pc.get("id") not in existing_ids:
                        crimes.append(
                            {
                                "id": pc.get("id"),
                                "name": pc.get("name"),
                                "min_rank": pc.get("min_rank", 1),
                                "prestige_required": pc.get("prestige_required"),
                                "crime_type": pc.get("crime_type", "prestige"),
                            }
                        )
                crimes.sort(key=lambda x: (int(x.get("prestige_required") or 0) > 0, int(x.get("prestige_required") or 0), int(x.get("min_rank") or 1), x.get("id") or ""))
            except Exception:
                pass
            gta_options = [{"id": o.get("id", ""), "name": o.get("name", ""), "min_rank": o.get("min_rank", 0)} for o in (GTA_OPTIONS or [])]
            melt_options = {"actions": MELT_OPTIONS, "rarities": [{"id": r, "name": r.replace("_", " ").title()} for r in MELT_RARITIES], "scrap_rarities": [{"id": r, "name": r.replace("_", " ").title()} for r in SCRAP_RARITIES]}
            u = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "auto_rank_crime_ids": 1, "auto_rank_gta_option_ids": 1, "auto_rank_melt_action_ids": 1, "auto_rank_melt_rarity_ids": 1, "auto_rank_scrap_rarity_ids": 1})
            crime_ids = u.get("auto_rank_crime_ids") if isinstance(u.get("auto_rank_crime_ids"), list) else []
            gta_ids = u.get("auto_rank_gta_option_ids") if isinstance(u.get("auto_rank_gta_option_ids"), list) else []
            melt_action_ids = u.get("auto_rank_melt_action_ids") if isinstance(u.get("auto_rank_melt_action_ids"), list) else []
            melt_rarity_ids = u.get("auto_rank_melt_rarity_ids") if isinstance(u.get("auto_rank_melt_rarity_ids"), list) else []
            scrap_rarity_ids = u.get("auto_rank_scrap_rarity_ids") if isinstance(u.get("auto_rank_scrap_rarity_ids"), list) else []
            logger.debug("Auto rank GET /settings ok user_id=%s", current_user.get("id", "?"))
            return {"crimes": crimes or [], "gta_options": gta_options, "melt_options": melt_options, "auto_rank_crime_ids": crime_ids, "auto_rank_gta_option_ids": gta_ids, "auto_rank_melt_action_ids": melt_action_ids, "auto_rank_melt_rarity_ids": melt_rarity_ids, "auto_rank_scrap_rarity_ids": scrap_rarity_ids}
        except Exception as e:
            logger.exception("Auto rank GET /settings failed: %s", e)
            raise

    @router.get("/auto-rank/stats")
    async def get_auto_rank_stats(current_user: dict = Depends(get_current_user)):
        try:
            out = await _get_auto_rank_stats_impl(db, current_user)
            logger.debug("Auto rank GET /stats ok user_id=%s", current_user.get("id", "?"))
            return out
        except Exception as e:
            logger.exception("Auto rank GET /stats failed: %s", e)
            raise

    async def _get_auto_rank_stats_impl(db, current_user: dict):
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
                "auto_rank_total_cars_melted": 1,
                "auto_rank_total_bullets_from_melt": 1,
                "auto_rank_total_cars_scrapped": 1,
                "auto_rank_total_cash_from_scrap": 1,
                "oc_cooldown_until": 1,
                "in_jail": 1,
                "jail_until": 1,
                "auto_rank_next_run_at": 1,
                "auto_rank_booze": 1,
                "auto_rank_crimes": 1,
                "auto_rank_gta": 1,
                "auto_rank_melt": 1,
                "auto_rank_oc": 1,
                "auto_rank_bust_every_5_sec": 1,
                "travel_arrives_at": 1,
                "traveling_to": 1,
                "current_state": 1,
                "booze_carrying": 1,
                "auto_rank_last_activity": 1,
                "auto_rank_last_activity_at": 1,
                "auto_rank_failed_crimes_today": 1,
                "auto_rank_failed_crimes_date": 1,
                "auto_rank_failed_gtas_today": 1,
                "auto_rank_failed_gtas_date": 1,
                "auto_rank_failed_busts_today": 1,
                "auto_rank_failed_busts_date": 1,
                "auto_rank_successful_busts_today": 1,
                "auto_rank_successful_busts_date": 1,
                "auto_rank_successful_crimes_today": 1,
                "auto_rank_successful_crimes_date": 1,
                "auto_rank_successful_gtas_today": 1,
                "auto_rank_successful_gtas_date": 1,
                "auto_rank_bullets_from_melt_today": 1,
                "auto_rank_bullets_from_melt_date": 1,
                "auto_rank_cars_melted_today": 1,
                "auto_rank_cars_melted_date": 1,
                "auto_rank_cars_scrapped_today": 1,
                "auto_rank_cars_scrapped_date": 1,
                "auto_rank_cash_from_scrap_today": 1,
                "auto_rank_cash_from_scrap_date": 1,
                "auto_rank_booze_runs_today": 1,
                "auto_rank_booze_runs_date": 1,
                "auto_rank_booze_profit_today": 1,
                "auto_rank_booze_profit_date": 1,
                "auto_rank_crime_cash_today": 1,
                "auto_rank_crime_cash_date": 1,
                "auto_rank_gta_value_today": 1,
                "auto_rank_gta_value_date": 1,
                "auto_rank_bust_cash_today": 1,
                "auto_rank_bust_cash_date": 1,
                "auto_rank_idle": 1,
                "last_seen": 1,
                "auto_rank_scrap": 1,
                "auto_rank_next_scrap_at": 1,
                "auto_rank_use_skip_tokens": 1,
                "cooldown_skip_crime_tokens": 1,
                "cooldown_skip_crime_credits": 1,
                "cooldown_skip_gta_tokens": 1,
                "cooldown_skip_gta_credits": 1,
                "cooldown_skip_booze_tokens": 1,
                "cooldown_skip_booze_credits": 1,
                "cooldown_skip_day": 1,
                "cooldown_skip_uses_today_crime": 1,
                "cooldown_skip_uses_today_gta": 1,
                "cooldown_skip_uses_today_booze": 1,
                "auto_rank_skip_crime_used_today": 1,
                "auto_rank_skip_crime_cash_today": 1,
                "auto_rank_skip_crime_date": 1,
                "auto_rank_skip_gta_used_today": 1,
                "auto_rank_skip_gta_cash_today": 1,
                "auto_rank_skip_gta_date": 1,
                "auto_rank_skip_booze_used_today": 1,
                "auto_rank_skip_booze_cash_today": 1,
                "auto_rank_skip_booze_date": 1,
                "token_perk_stats": 1,
                "jail_bailout_tokens": 1,
                "jail_bailout_uses_today": 1,
                "jail_bailout_day": 1,
                "auto_rank_bailout_used_today": 1,
                "auto_rank_bailout_date": 1,
            },
        )
        now = datetime.now(timezone.utc)
        since = _parse_iso((u or {}).get("auto_rank_stats_since"))
        has_activity = bool((u or {}).get("auto_rank_total_busts") or (u or {}).get("auto_rank_total_crimes") or (u or {}).get("auto_rank_total_gtas") or (u or {}).get("auto_rank_total_booze_runs") or (u or {}).get("auto_rank_total_cars_melted") or (u or {}).get("auto_rank_total_cars_scrapped"))
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
        in_jail = bool((u or {}).get("in_jail"))
        jail_seconds_remaining = None
        jail_until_iso = None
        if in_jail:
            jail_until_dt = _parse_iso((u or {}).get("jail_until"))
            if jail_until_dt and jail_until_dt > now:
                jail_seconds_remaining = int((jail_until_dt - now).total_seconds())
                jail_until_iso = (u or {}).get("jail_until")
            else:
                # Jail time expired; clear in_jail and next_run_at so Auto Rank runs immediately
                await db.users.update_one(
                    {"id": current_user["id"]},
                    {"$set": {"in_jail": False, "jail_until": None, "snitch_attempted_this_term": False}, "$unset": {"auto_rank_next_run_at": ""}},
                )
                in_jail = False
        next_run_at = None
        next_run_dt = _parse_iso((u or {}).get("auto_rank_next_run_at"))
        if next_run_dt and next_run_dt > now:
            next_run_at = (u or {}).get("auto_rank_next_run_at")
        config = await get_auto_rank_config(db)
        interval_seconds = config["interval_seconds"]
        interval_bust_seconds = config.get("interval_bust_seconds") or DEFAULT_BUST_INTERVAL_SECONDS
        interval_oc_seconds = config.get("interval_oc_seconds") or DEFAULT_OC_INTERVAL_SECONDS
        user_id = current_user["id"]
        next_crime_at = None
        crime_until_list = []
        async for uc in db.user_crimes.find({"user_id": user_id}, {"_id": 0, "cooldown_until": 1}):
            until_dt = _parse_iso(uc.get("cooldown_until"))
            if until_dt and until_dt > now:
                crime_until_list.append(uc.get("cooldown_until"))
        if crime_until_list:
            crime_until_list.sort()
            next_crime_at = crime_until_list[0]
        next_gta_at = None
        gta_doc = await db.gta_cooldowns.find_one({"user_id": user_id}, {"_id": 0, "cooldown_until": 1})
        if gta_doc:
            gta_until = _parse_iso(gta_doc.get("cooldown_until"))
            if gta_until and gta_until > now:
                next_gta_at = gta_doc.get("cooldown_until")
        next_booze_arrival_at = None
        if (u or {}).get("auto_rank_booze") and (u or {}).get("travel_arrives_at") and not in_jail:
            arr = _parse_iso((u or {}).get("travel_arrives_at"))
            if arr and arr > now:
                next_booze_arrival_at = (u or {}).get("travel_arrives_at")
        today = _today_utc(now)
        failed_crimes_today = int((u or {}).get("auto_rank_failed_crimes_today") or 0) if (u or {}).get("auto_rank_failed_crimes_date") == today else 0
        failed_gtas_today = int((u or {}).get("auto_rank_failed_gtas_today") or 0) if (u or {}).get("auto_rank_failed_gtas_date") == today else 0
        failed_busts_today = int((u or {}).get("auto_rank_failed_busts_today") or 0) if (u or {}).get("auto_rank_failed_busts_date") == today else 0
        successful_busts_today = int((u or {}).get("auto_rank_successful_busts_today") or 0) if (u or {}).get("auto_rank_successful_busts_date") == today else 0
        successful_crimes_today = int((u or {}).get("auto_rank_successful_crimes_today") or 0) if (u or {}).get("auto_rank_successful_crimes_date") == today else 0
        successful_gtas_today = int((u or {}).get("auto_rank_successful_gtas_today") or 0) if (u or {}).get("auto_rank_successful_gtas_date") == today else 0
        bullets_from_melt_today = int((u or {}).get("auto_rank_bullets_from_melt_today") or 0) if (u or {}).get("auto_rank_bullets_from_melt_date") == today else 0
        cars_melted_today = int((u or {}).get("auto_rank_cars_melted_today") or 0) if (u or {}).get("auto_rank_cars_melted_date") == today else 0
        cars_scrapped_today = int((u or {}).get("auto_rank_cars_scrapped_today") or 0) if (u or {}).get("auto_rank_cars_scrapped_date") == today else 0
        cash_from_scrap_today = int((u or {}).get("auto_rank_cash_from_scrap_today") or 0) if (u or {}).get("auto_rank_cash_from_scrap_date") == today else 0
        booze_runs_today = int((u or {}).get("auto_rank_booze_runs_today") or 0) if (u or {}).get("auto_rank_booze_runs_date") == today else 0
        booze_profit_today = int((u or {}).get("auto_rank_booze_profit_today") or 0) if (u or {}).get("auto_rank_booze_profit_date") == today else 0
        crime_cash_today = int((u or {}).get("auto_rank_crime_cash_today") or 0) if (u or {}).get("auto_rank_crime_cash_date") == today else 0
        gta_value_today = int((u or {}).get("auto_rank_gta_value_today") or 0) if (u or {}).get("auto_rank_gta_value_date") == today else 0
        bust_cash_today = int((u or {}).get("auto_rank_bust_cash_today") or 0) if (u or {}).get("auto_rank_bust_cash_date") == today else 0
        attempted_busts_today = successful_busts_today + failed_busts_today
        skip_crime_used_today = int((u or {}).get("auto_rank_skip_crime_used_today") or 0) if (u or {}).get("auto_rank_skip_crime_date") == today else 0
        skip_crime_cash_today = int((u or {}).get("auto_rank_skip_crime_cash_today") or 0) if (u or {}).get("auto_rank_skip_crime_date") == today else 0
        skip_gta_used_today = int((u or {}).get("auto_rank_skip_gta_used_today") or 0) if (u or {}).get("auto_rank_skip_gta_date") == today else 0
        skip_booze_used_today = int((u or {}).get("auto_rank_skip_booze_used_today") or 0) if (u or {}).get("auto_rank_skip_booze_date") == today else 0
        skip_booze_cash_today = int((u or {}).get("auto_rank_skip_booze_cash_today") or 0) if (u or {}).get("auto_rank_skip_booze_date") == today else 0
        bailout_used_today = int((u or {}).get("auto_rank_bailout_used_today") or 0) if (u or {}).get("auto_rank_bailout_date") == today else 0
        from utils.cooldown_skip import cooldown_skip_uses_today, cooldown_skip_daily_cap
        from routers.crime.jail import JAIL_BAILOUT_DAILY_CAP
        use_skip_tokens = (u or {}).get("auto_rank_use_skip_tokens") is True
        crime_tokens = int((u or {}).get("cooldown_skip_crime_tokens") or 0)
        crime_credits = int((u or {}).get("cooldown_skip_crime_credits") or 0)
        gta_tokens = int((u or {}).get("cooldown_skip_gta_tokens") or 0)
        gta_credits = int((u or {}).get("cooldown_skip_gta_credits") or 0)
        booze_tokens = int((u or {}).get("cooldown_skip_booze_tokens") or 0)
        booze_credits = int((u or {}).get("cooldown_skip_booze_credits") or 0)
        bailout_tokens = int((u or {}).get("jail_bailout_tokens") or 0)
        bailout_uses_today = (
            int((u or {}).get("jail_bailout_uses_today") or 0)
            if (u or {}).get("jail_bailout_day") == today
            else 0
        )
        if use_skip_tokens and not _has_any_usable_ar_skip(u or {}):
            u = await _auto_disable_skip_tokens_if_empty(db, current_user["id"], u or {})
            use_skip_tokens = False
        can_skip_crime = use_skip_tokens and _can_use_skip(u or {}, "crime")
        can_skip_gta = use_skip_tokens and _can_use_skip(u or {}, "gta")
        can_skip_booze = use_skip_tokens and _can_use_skip(u or {}, "booze")
        perk = ((u or {}).get("token_perk_stats") or {}) if isinstance((u or {}).get("token_perk_stats"), dict) else {}
        crime_perk = perk.get("cooldown_skip_crime") if isinstance(perk.get("cooldown_skip_crime"), dict) else {}
        gta_perk = perk.get("cooldown_skip_gta") if isinstance(perk.get("cooldown_skip_gta"), dict) else {}
        booze_perk = perk.get("cooldown_skip_booze") if isinstance(perk.get("cooldown_skip_booze"), dict) else {}
        bailout_perk = perk.get("jail_bailout") if isinstance(perk.get("jail_bailout"), dict) else {}
        is_idle = bool((u or {}).get("auto_rank_idle"))
        activity_detail = None
        if is_idle:
            activity_detail = "Idle — no activity for 24h (will wake on next page visit)"
        elif in_jail:
            if use_skip_tokens and bailout_tokens > 0 and bailout_uses_today < JAIL_BAILOUT_DAILY_CAP:
                activity_detail = "In jail — Auto Rank will use a bailout token"
            elif use_skip_tokens:
                activity_detail = "In jail — no usable bailout tokens (cycles paused)"
            else:
                activity_detail = "In jail — cycles paused"
        elif (u or {}).get("travel_arrives_at") and (u or {}).get("auto_rank_booze"):
            activity_detail = "Travelling (booze)"
        elif (u or {}).get("auto_rank_booze") and (u or {}).get("booze_carrying") and (u or {}).get("current_state"):
            carrying = (u or {}).get("booze_carrying") or {}
            if sum(int(v or 0) for v in carrying.values()) > 0:
                activity_detail = "Selling booze"
        if activity_detail is None:
            bust_5 = bool((u or {}).get("auto_rank_bust_every_5_sec"))
            crimes = bool((u or {}).get("auto_rank_crimes"))
            gta = bool((u or {}).get("auto_rank_gta"))
            oc = bool((u or {}).get("auto_rank_oc"))
            booze = bool((u or {}).get("auto_rank_booze"))
            melt = bool((u or {}).get("auto_rank_melt"))
            scrap = bool((u or {}).get("auto_rank_scrap"))
            if bust_5 and not crimes and not gta and not oc and not booze and not melt and not scrap:
                activity_detail = "Jail busting every 5s"
            else:
                parts = []
                if bust_5:
                    parts.append("busts 5s")
                if crimes:
                    parts.append("crimes")
                if gta:
                    parts.append("GTA")
                if melt:
                    parts.append("melt")
                if scrap:
                    parts.append("scrap")
                if oc:
                    parts.append("OC")
                if booze:
                    parts.append("booze")
                activity_detail = "Running cycle (" + " / ".join(parts) + ")" if parts else "Idle"
        last_activity = (u or {}).get("auto_rank_last_activity")
        last_activity_at = (u or {}).get("auto_rank_last_activity_at")
        global_loop_enabled = await get_auto_rank_enabled(db)
        return {
            "global_loop_enabled": global_loop_enabled,
            "total_busts": int((u or {}).get("auto_rank_total_busts") or 0),
            "total_crimes": int((u or {}).get("auto_rank_total_crimes") or 0),
            "total_gtas": int((u or {}).get("auto_rank_total_gtas") or 0),
            "total_cash": int((u or {}).get("auto_rank_total_cash") or 0) + int((u or {}).get("auto_rank_total_booze_profit") or 0) + int((u or {}).get("auto_rank_total_cash_from_scrap") or 0),
            "stats_since": (u or {}).get("auto_rank_stats_since"),
            "running_seconds": max(0, running_seconds),
            "best_cars": [{"name": c.get("name", "?"), "value": int(c.get("value", 0) or 0)} for c in (best_cars or []) if isinstance(c, dict)],
            "total_booze_runs": int((u or {}).get("auto_rank_total_booze_runs") or 0),
            "total_booze_profit": int((u or {}).get("auto_rank_total_booze_profit") or 0),
            "total_cars_melted": int((u or {}).get("auto_rank_total_cars_melted") or 0),
            "total_bullets_from_melt": int((u or {}).get("auto_rank_total_bullets_from_melt") or 0),
            "total_cars_scrapped": int((u or {}).get("auto_rank_total_cars_scrapped") or 0),
            "total_cash_from_scrap": int((u or {}).get("auto_rank_total_cash_from_scrap") or 0),
            "next_oc_at": next_oc_at,
            "in_jail": in_jail,
            "jail_seconds_remaining": jail_seconds_remaining,
            "jail_until": jail_until_iso,
            "auto_rank_next_run_at": next_run_at,
            "next_scrap_at": (u or {}).get("auto_rank_next_scrap_at") if _parse_iso((u or {}).get("auto_rank_next_scrap_at")) and _parse_iso((u or {}).get("auto_rank_next_scrap_at")) > now else None,
            "interval_seconds": interval_seconds,
            "interval_scrap_seconds": SCRAP_INTERVAL_SECONDS,
            "interval_bust_seconds": interval_bust_seconds,
            "interval_oc_seconds": interval_oc_seconds,
            "next_crime_at": None if can_skip_crime else next_crime_at,
            "next_gta_at": None if can_skip_gta else next_gta_at,
            "next_booze_arrival_at": None if (can_skip_booze and next_booze_arrival_at) else next_booze_arrival_at,
            "crime_skips_ready": can_skip_crime,
            "gta_skips_ready": can_skip_gta,
            "booze_skips_ready": can_skip_booze,
            "auto_rank_use_skip_tokens": use_skip_tokens,
            "has_usable_ar_skips": _has_any_usable_ar_skip(u or {}),
            "skip_tokens": {
                "crime": {
                    "tokens": crime_tokens,
                    "credits": crime_credits,
                    "uses_today": cooldown_skip_uses_today(u or {}, "crime"),
                    "daily_cap": cooldown_skip_daily_cap("crime"),
                    "auto_rank_used_today": skip_crime_used_today,
                    "auto_rank_cash_today": skip_crime_cash_today,
                    "lifetime_cash": int(crime_perk.get("cash_earned") or 0),
                    "lifetime_uses": int(crime_perk.get("uses") or 0),
                },
                "gta": {
                    "tokens": gta_tokens,
                    "credits": gta_credits,
                    "uses_today": cooldown_skip_uses_today(u or {}, "gta"),
                    "daily_cap": cooldown_skip_daily_cap("gta"),
                    "auto_rank_used_today": skip_gta_used_today,
                    "lifetime_uses": int(gta_perk.get("uses") or 0),
                    "stolen_legendary": int(gta_perk.get("stolen_legendary") or 0),
                    "stolen_ultra_rare": int(gta_perk.get("stolen_ultra_rare") or 0),
                    "stolen_rare": int(gta_perk.get("stolen_rare") or 0),
                    "stolen_uncommon": int(gta_perk.get("stolen_uncommon") or 0),
                    "stolen_common": int(gta_perk.get("stolen_common") or 0),
                    "stolen_exclusive": int(gta_perk.get("stolen_exclusive") or 0),
                    "stolen_custom": int(gta_perk.get("stolen_custom") or 0),
                },
                "booze": {
                    "tokens": booze_tokens,
                    "credits": booze_credits,
                    "uses_today": cooldown_skip_uses_today(u or {}, "booze"),
                    "daily_cap": cooldown_skip_daily_cap("booze"),
                    "auto_rank_used_today": skip_booze_used_today,
                    "auto_rank_cash_today": skip_booze_cash_today,
                    "lifetime_profit": int(booze_perk.get("profit_cash") or 0),
                    "lifetime_uses": int(booze_perk.get("uses") or 0),
                },
                "bailout": {
                    "tokens": bailout_tokens,
                    "uses_today": bailout_uses_today,
                    "daily_cap": JAIL_BAILOUT_DAILY_CAP,
                    "auto_rank_used_today": bailout_used_today,
                    "lifetime_uses": int(bailout_perk.get("uses") or 0),
                    "lifetime_via_auto_rank": int(bailout_perk.get("via_auto_rank") or 0),
                    "will_auto_bail": bool(
                        use_skip_tokens
                        and bailout_tokens > 0
                        and bailout_uses_today < JAIL_BAILOUT_DAILY_CAP
                    ),
                },
            },
            "activity_detail": activity_detail,
            "last_activity": last_activity,
            "last_activity_at": last_activity_at,
            "failed_crimes_today": failed_crimes_today,
            "failed_gtas_today": failed_gtas_today,
            "failed_busts_today": failed_busts_today,
            "successful_crimes_today": successful_crimes_today,
            "successful_gtas_today": successful_gtas_today,
            "successful_busts_today": successful_busts_today,
            "bullets_from_melt_today": bullets_from_melt_today,
            "cars_melted_today": cars_melted_today,
            "cars_scrapped_today": cars_scrapped_today,
            "cash_from_scrap_today": cash_from_scrap_today,
            "booze_runs_today": booze_runs_today,
            "booze_profit_today": booze_profit_today,
            "crime_cash_today": crime_cash_today,
            "gta_value_today": gta_value_today,
            "bust_cash_today": bust_cash_today,
            "attempted_busts_today": attempted_busts_today,
            "auto_rank_idle": is_idle,
        }

    @router.patch("/auto-rank/me")
    async def patch_my_preferences(body: MePreferencesBody, current_user: dict = Depends(get_current_user)):
        user_id = current_user["id"]
        await _expire_auto_rank_trials(db)
        user_row = await db.users.find_one({"id": user_id}, {"_id": 0}) or current_user
        updates = {}
        if body.auto_rank_enabled is not None:
            if body.auto_rank_enabled and not _user_has_auto_rank_access(user_row):
                raise HTTPException(status_code=400, detail="Buy Auto Rank from the Store or activate a token first.")
            updates["auto_rank_enabled"] = body.auto_rank_enabled
            if body.auto_rank_enabled:
                # When enabling, clear idle state so auto-rank runs immediately
                updates["auto_rank_idle"] = False
            elif body.auto_rank_enabled is False:
                # Stop passive distillery booze when Auto Rank is turned off (user can resume on Distillery)
                updates["passive_booze_paused"] = True
                # Persist all task toggles off — UI shows them off while master is off; leaving them true
                # in DB made crimes/GTA run again when the user re-enabled Auto Rank.
                for f in _IDLE_SAVE_FIELDS:
                    updates[f] = False
        for field in ["auto_rank_crimes", "auto_rank_gta", "auto_rank_bust_every_5_sec", "auto_rank_oc", "auto_rank_booze", "auto_rank_melt", "auto_rank_scrap"]:
            val = getattr(body, field, None)
            if val is not None:
                master_will_be_on = (
                    body.auto_rank_enabled is True
                    if body.auto_rank_enabled is not None
                    else bool(user_row.get("auto_rank_enabled"))
                )
                if val and not master_will_be_on:
                    raise HTTPException(status_code=400, detail="Turn on Enable Auto Rank first, or turn this off while Auto Rank is paused.")
                updates[field] = val
        if body.auto_rank_telegram_notify is not None:
            updates["auto_rank_telegram_notify"] = bool(body.auto_rank_telegram_notify)
        if body.auto_rank_use_skip_tokens is not None:
            want_skips = bool(body.auto_rank_use_skip_tokens)
            if want_skips and not _has_any_usable_ar_skip(user_row):
                raise HTTPException(
                    status_code=400,
                    detail="No usable Crime / GTA / Booze skip tokens — buy some in the Points Store first.",
                )
            updates["auto_rank_use_skip_tokens"] = want_skips
        if body.passive_booze_paused is not None:
            updates["passive_booze_paused"] = bool(body.passive_booze_paused)
            if body.passive_booze_paused:
                updates["auto_rank_booze"] = False
        if body.auto_rank_crime_ids is not None:
            updates["auto_rank_crime_ids"] = [str(x) for x in body.auto_rank_crime_ids] if body.auto_rank_crime_ids else []
        if body.auto_rank_gta_option_ids is not None:
            updates["auto_rank_gta_option_ids"] = [str(x) for x in body.auto_rank_gta_option_ids] if body.auto_rank_gta_option_ids else []
        if body.auto_rank_melt_action_ids is not None:
            updates["auto_rank_melt_action_ids"] = [str(x) for x in body.auto_rank_melt_action_ids] if body.auto_rank_melt_action_ids else []
        if body.auto_rank_melt_rarity_ids is not None:
            updates["auto_rank_melt_rarity_ids"] = [str(x) for x in body.auto_rank_melt_rarity_ids] if body.auto_rank_melt_rarity_ids else []
        if body.auto_rank_scrap_rarity_ids is not None:
            updates["auto_rank_scrap_rarity_ids"] = [str(x) for x in body.auto_rank_scrap_rarity_ids] if body.auto_rank_scrap_rarity_ids else []
        # Enforce: same rarity cannot be selected in both lists.
        if "auto_rank_melt_rarity_ids" in updates and "auto_rank_scrap_rarity_ids" in updates:
            melt_ids = updates.get("auto_rank_melt_rarity_ids") or []
            scrap_ids = updates.get("auto_rank_scrap_rarity_ids") or []
            scrap_set = set(scrap_ids)
            melt_ids = [x for x in melt_ids if x not in scrap_set]
            melt_set = set(melt_ids)
            scrap_ids = [x for x in scrap_ids if x not in melt_set]
            updates["auto_rank_melt_rarity_ids"] = melt_ids
            updates["auto_rank_scrap_rarity_ids"] = scrap_ids
        if body.auto_rank_trial_dismissed is not None:
            updates["auto_rank_trial_dismissed"] = bool(body.auto_rank_trial_dismissed)
        if body.robot_bg_auto_search_enabled is not None:
            from utils.robot_bg_auto_search import robot_bg_auto_search_active

            if body.robot_bg_auto_search_enabled and not robot_bg_auto_search_active(user_row):
                raise HTTPException(
                    status_code=400,
                    detail="Buy Robot Auto-Search from the Points Store first (Upgrades tab).",
                )
            updates["robot_bg_auto_search_enabled"] = bool(body.robot_bg_auto_search_enabled)
        if not updates:
            return {"message": "No changes", **_extract_preferences(current_user)}
        op = {"$set": updates}
        if updates.get("auto_rank_enabled") is False:
            op["$unset"] = {"auto_rank_stats_since": ""}
        await db.users.update_one({"id": user_id}, op)
        updated = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, **{f: 1 for f in _PREFERENCE_FIELDS}, "auto_rank_crime_ids": 1, "auto_rank_gta_option_ids": 1, "auto_rank_melt_action_ids": 1, "auto_rank_melt_rarity_ids": 1, "auto_rank_scrap_rarity_ids": 1, "passive_booze_paused": 1, "robot_bg_auto_search_enabled": 1, "robot_bg_auto_search_until": 1},
        )
        out = {"message": "Preferences saved", **_extract_preferences(updated)}
        out["auto_rank_has_access"] = _user_has_auto_rank_access(updated or {})
        out["auto_rank_purchased"] = bool((updated or {}).get("auto_rank_purchased"))
        out["auto_rank_crime_ids"] = updated.get("auto_rank_crime_ids") if isinstance(updated.get("auto_rank_crime_ids"), list) else []
        out["auto_rank_gta_option_ids"] = updated.get("auto_rank_gta_option_ids") if isinstance(updated.get("auto_rank_gta_option_ids"), list) else []
        out["auto_rank_melt_action_ids"] = updated.get("auto_rank_melt_action_ids") if isinstance(updated.get("auto_rank_melt_action_ids"), list) else []
        out["auto_rank_melt_rarity_ids"] = updated.get("auto_rank_melt_rarity_ids") if isinstance(updated.get("auto_rank_melt_rarity_ids"), list) else []
        out["auto_rank_scrap_rarity_ids"] = updated.get("auto_rank_scrap_rarity_ids") if isinstance(updated.get("auto_rank_scrap_rarity_ids"), list) else []
        out["passive_booze_paused"] = bool((updated or {}).get("passive_booze_paused"))
        from utils.robot_bg_auto_search import robot_bg_auto_search_active, robot_bg_auto_search_enabled

        out["robot_bg_auto_search_subscription_active"] = robot_bg_auto_search_active(updated or {})
        out["robot_bg_auto_search_enabled"] = robot_bg_auto_search_enabled(updated or {})
        out["robot_bg_auto_search_until"] = (updated or {}).get("robot_bg_auto_search_until")
        return out

    @router.get("/auto-rank/interval")
    async def get_interval(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        require_staff_issued_if_staff_capable(current_user)
        config = await get_auto_rank_config(db)
        return {
            "interval_seconds": config["interval_seconds"],
            "interval_bust_seconds": config.get("interval_bust_seconds") or DEFAULT_BUST_INTERVAL_SECONDS,
            "interval_oc_seconds": config.get("interval_oc_seconds") or DEFAULT_OC_INTERVAL_SECONDS,
            "min_interval_seconds": MIN_INTERVAL_SECONDS,
            "min_bust_interval_seconds": MIN_BUST_INTERVAL_SECONDS,
            "min_oc_interval_seconds": MIN_OC_INTERVAL_SECONDS,
            "enabled": config["enabled"],
        }

    @router.post("/auto-rank/start")
    async def start_auto_rank(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        require_staff_issued_if_staff_capable(current_user)
        await db.game_config.update_one({"id": GAME_CONFIG_ID}, {"$set": {"enabled": True}}, upsert=True)
        _invalidate_auto_rank_config_cache()
        return {"enabled": True, "message": "Auto Rank started."}

    @router.post("/auto-rank/stop")
    async def stop_auto_rank(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        require_staff_issued_if_staff_capable(current_user)
        await db.game_config.update_one({"id": GAME_CONFIG_ID}, {"$set": {"enabled": False}}, upsert=True)
        _invalidate_auto_rank_config_cache()
        return {"enabled": False, "message": "Auto Rank stopped. Current cycle will finish, then no new cycles until started."}

    @router.patch("/auto-rank/interval")
    async def set_interval(body: IntervalBody, current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        require_staff_issued_if_staff_capable(current_user)
        updates = {}
        if body.interval_seconds is not None:
            try:
                val = int(body.interval_seconds)
            except (TypeError, ValueError):
                val = DEFAULT_INTERVAL_SECONDS
            updates["interval_seconds"] = max(MIN_INTERVAL_SECONDS, val)
        if body.interval_bust_seconds is not None:
            try:
                val = int(body.interval_bust_seconds)
            except (TypeError, ValueError):
                val = DEFAULT_BUST_INTERVAL_SECONDS
            updates["interval_bust_seconds"] = max(MIN_BUST_INTERVAL_SECONDS, val)
        if body.interval_oc_seconds is not None:
            try:
                val = int(body.interval_oc_seconds)
            except (TypeError, ValueError):
                val = DEFAULT_OC_INTERVAL_SECONDS
            updates["interval_oc_seconds"] = max(MIN_OC_INTERVAL_SECONDS, val)
        if not updates:
            config = await get_auto_rank_config(db)
            return {
                "interval_seconds": config["interval_seconds"],
                "interval_bust_seconds": config.get("interval_bust_seconds") or DEFAULT_BUST_INTERVAL_SECONDS,
                "interval_oc_seconds": config.get("interval_oc_seconds") or DEFAULT_OC_INTERVAL_SECONDS,
                "message": "No changes (send interval_seconds, interval_bust_seconds, and/or interval_oc_seconds).",
            }
        await db.game_config.update_one({"id": GAME_CONFIG_ID}, {"$set": updates}, upsert=True)
        _invalidate_auto_rank_config_cache()
        config = await get_auto_rank_config(db)
        main_s = config["interval_seconds"]
        bust_s = config.get("interval_bust_seconds") or DEFAULT_BUST_INTERVAL_SECONDS
        oc_s = config.get("interval_oc_seconds") or DEFAULT_OC_INTERVAL_SECONDS
        use_cron = (os.environ.get("AUTO_RANK_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
        msg = f"Intervals: main {main_s}s, bust {bust_s}s, OC {oc_s}s."
        if use_cron:
            msg += " With cron: call POST /api/auto-rank/cron every main interval (cron-cycle-ticker.py) and POST /api/auto-rank/cron-bust every bust interval (cron-bust-ticker.py)."
        return {
            "interval_seconds": main_s,
            "interval_bust_seconds": bust_s,
            "interval_oc_seconds": oc_s,
            "message": msg,
        }

    class AdminUserUpdateBody(BaseModel):
        telegram_chat_id: Optional[str] = None
        telegram_bot_token: Optional[str] = None
        auto_rank_enabled: Optional[bool] = None

    @router.get("/admin/auto-rank/user-inspect")
    async def admin_auto_rank_user_inspect(
        user_id: Optional[str] = Query(None, description="Exact user id"),
        username: Optional[str] = Query(None, description="Exact username (case-insensitive)"),
        current_user: dict = Depends(require_admin_or_mod),
    ):
        """Admin/mod: full Auto Rank preferences, booze/travel snapshot, selection labels, and live stats for one user."""
        import re

        uid = (user_id or "").strip()
        uname = (username or "").strip()
        if not uid and not uname:
            uid = current_user["id"]
        q: Dict[str, Any] = {}
        if uid:
            q["id"] = uid
        else:
            q["username"] = re.compile("^" + re.escape(uname) + "$", re.IGNORECASE)

        idle_saved_proj = {f"auto_rank_idle_saved_{k}": 1 for k in _IDLE_SAVE_FIELDS}
        proj = {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "is_moderator": 1,
            "last_seen": 1,
            "forced_online_until": 1,
            "is_dead": 1,
            "in_jail": 1,
            "jail_until": 1,
            "auto_rank_purchased": 1,
            "auto_rank_permanent": 1,
            "auto_rank_trial": 1,
            "auto_rank_trial_until": 1,
            "auto_rank_trial_dismissed": 1,
            "auto_rank_2h_tokens": 1,
            "auto_rank_email_entitlement": 1,
            "registration_freed_email_from_user_id": 1,
            "founding_rewards_claimed": 1,
            "email_verified": 1,
            "auto_rank_next_run_at": 1,
            "auto_rank_oc_retry_at": 1,
            "auto_rank_last_activity": 1,
            "auto_rank_last_activity_at": 1,
            **{f: 1 for f in _PREFERENCE_FIELDS},
            "auto_rank_crime_ids": 1,
            "auto_rank_gta_option_ids": 1,
            "auto_rank_melt_action_ids": 1,
            "auto_rank_melt_rarity_ids": 1,
            "auto_rank_scrap_rarity_ids": 1,
            "auto_rank_idle": 1,
            **idle_saved_proj,
            "telegram_chat_id": 1,
            "telegram_bot_token": 1,
            "current_state": 1,
            "traveling_to": 1,
            "travel_arrives_at": 1,
            "booze_carrying": 1,
            "presence_simulator_auto_rank_managed": 1,
            "presence_simulator_auto_rank_prev": 1,
        }
        doc = await db.users.find_one(q, proj)
        if not doc:
            raise HTTPException(status_code=404, detail="User not found")

        _, doc = await _resolve_permanent_auto_rank(db, doc, heal=False)

        from utils.auto_rank_entitlement_provenance import build_auto_rank_entitlement_provenance

        provenance = await build_auto_rank_entitlement_provenance(db, doc)

        stats = await _get_auto_rank_stats_impl(db, doc)
        selection_labels = await _auto_rank_selection_labels_for_inspect(db, doc)
        global_enabled = await get_auto_rank_enabled(db)
        diagnostics = _build_auto_rank_diagnostics(doc, global_enabled=global_enabled)

        saved_on_idle: Dict[str, Any] = {}
        for k in _IDLE_SAVE_FIELDS:
            sk = f"auto_rank_idle_saved_{k}"
            if sk in doc:
                saved_on_idle[k] = doc.get(sk)

        presence: Dict[str, Any] = {}
        if doc.get("presence_simulator_auto_rank_managed"):
            presence["managed"] = doc.get("presence_simulator_auto_rank_managed")
        if doc.get("presence_simulator_auto_rank_prev"):
            presence["prev_snapshot"] = doc.get("presence_simulator_auto_rank_prev")

        return {
            "user": {
                "id": doc.get("id"),
                "username": doc.get("username"),
                "email": doc.get("email"),
                "email_verified": bool(doc.get("email_verified")),
                "last_seen": doc.get("last_seen"),
                "forced_online_until": doc.get("forced_online_until"),
                "is_dead": doc.get("is_dead"),
                "in_jail": doc.get("in_jail"),
                "jail_until": doc.get("jail_until"),
                "staff_exempt_from_idle": diagnostics.get("staff_exempt_from_idle"),
            },
            "purchase": {
                "auto_rank_purchased": bool(doc.get("auto_rank_purchased")),
                "auto_rank_permanent": bool(doc.get("auto_rank_permanent")),
                "auto_rank_trial": bool(doc.get("auto_rank_trial")),
                "auto_rank_trial_until": doc.get("auto_rank_trial_until"),
                "auto_rank_trial_dismissed": bool(doc.get("auto_rank_trial_dismissed")),
                "auto_rank_2h_tokens": int(doc.get("auto_rank_2h_tokens") or 0),
                "auto_rank_email_entitlement": bool(doc.get("auto_rank_email_entitlement")),
            },
            "entitlement_provenance": provenance,
            "diagnostics": diagnostics,
            "preferences": _extract_preferences(doc),
            "selection_ids": {
                "auto_rank_crime_ids": doc.get("auto_rank_crime_ids") if isinstance(doc.get("auto_rank_crime_ids"), list) else [],
                "auto_rank_gta_option_ids": doc.get("auto_rank_gta_option_ids") if isinstance(doc.get("auto_rank_gta_option_ids"), list) else [],
                "auto_rank_melt_action_ids": doc.get("auto_rank_melt_action_ids") if isinstance(doc.get("auto_rank_melt_action_ids"), list) else [],
                "auto_rank_melt_rarity_ids": doc.get("auto_rank_melt_rarity_ids") if isinstance(doc.get("auto_rank_melt_rarity_ids"), list) else [],
                "auto_rank_scrap_rarity_ids": doc.get("auto_rank_scrap_rarity_ids") if isinstance(doc.get("auto_rank_scrap_rarity_ids"), list) else [],
            },
            "selection_labels": selection_labels,
            "idle": {
                "auto_rank_idle": bool(doc.get("auto_rank_idle")),
                "saved_on_idle": saved_on_idle,
            },
            "telegram": {
                "telegram_chat_id": doc.get("telegram_chat_id") or "",
                "telegram_bot_token": doc.get("telegram_bot_token") or "",
            },
            "booze_travel": {
                "current_state": doc.get("current_state"),
                "traveling_to": doc.get("traveling_to"),
                "travel_arrives_at": doc.get("travel_arrives_at"),
                "booze_carrying": doc.get("booze_carrying"),
            },
            "presence_simulator": presence if presence else None,
            "stats": stats,
        }

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
                        # Only count auto_rank_enabled as online if NOT idle
                        {"$and": [{"auto_rank_enabled": True}, {"auto_rank_idle": {"$ne": True}}]},
                    ]},
                ],
            }
        cursor = db.users.find(
            query,
            {"_id": 0, "id": 1, "username": 1, "telegram_chat_id": 1, "telegram_bot_token": 1, "last_seen": 1, "forced_online_until": 1, "auto_rank_idle": 1, **{f: 1 for f in _PREFERENCE_FIELDS}},
        )
        users = await cursor.to_list(500)

        def _is_online(u):
            # If idle, auto-rank is paused so not really "online" from auto-rank perspective
            if u.get("auto_rank_idle"):
                # But still check last_seen for real activity
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
                return False
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
                    "auto_rank_idle": bool(u.get("auto_rank_idle")),
                    **_extract_preferences(u),
                    "telegram_chat_id": u.get("telegram_chat_id") or "",
                    "telegram_bot_token": u.get("telegram_bot_token") or "",
                }
                for u in users
            ],
        }

    @router.post("/admin/auto-rank/users/{username}/wipe-telegram")
    async def admin_wipe_user_telegram(username: str, current_user: dict = Depends(get_current_user)):
        """Admin: clear telegram_chat_id and telegram_bot_token for a user. Use when chat_id is invalid (e.g. chat not found)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        import re
        username_ci = re.compile("^" + re.escape(username.strip()) + "$", re.IGNORECASE) if username else None
        if not username_ci:
            raise HTTPException(status_code=400, detail="Username required")
        target = await db.users.find_one({"username": username_ci}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await db.users.update_one(
            {"id": target["id"]},
            {"$unset": {"telegram_chat_id": "", "telegram_bot_token": ""}},
        )
        return {"message": "Telegram cleared", "username": target.get("username")}

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
        from middleware.security import is_valid_telegram_bot_token
        updates = {}
        if body.telegram_chat_id is not None:
            updates["telegram_chat_id"] = (body.telegram_chat_id or "").strip() or None
        if body.telegram_bot_token is not None:
            val = (body.telegram_bot_token or "").strip() or None
            if val and not is_valid_telegram_bot_token(val):
                raise HTTPException(status_code=400, detail="Invalid bot token. Use only the token from @BotFather (format: 123456789:ABCdef...), not the full message.")
            updates["telegram_bot_token"] = val
        if body.auto_rank_enabled is not None:
            updates["auto_rank_enabled"] = body.auto_rank_enabled
            if body.auto_rank_enabled is False:
                for f in ["auto_rank_crimes", "auto_rank_gta", "auto_rank_bust_every_5_sec", "auto_rank_oc", "auto_rank_booze"]:
                    updates[f] = False
                updates["passive_booze_paused"] = True
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
        "auto_rank_last_activity", "auto_rank_last_activity_at",
        "auto_rank_failed_crimes_today", "auto_rank_failed_crimes_date",
        "auto_rank_failed_gtas_today", "auto_rank_failed_gtas_date",
        "auto_rank_failed_busts_today", "auto_rank_failed_busts_date",
        "auto_rank_successful_busts_today", "auto_rank_successful_busts_date",
    ]

    @router.post("/admin/auto-rank/wipe-stats")
    async def admin_wipe_auto_rank_stats(current_user: dict = Depends(get_current_user)):
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin only")
        unset = {f: "" for f in _WIPE_STATS_FIELDS}
        result = await db.users.update_many({}, {"$unset": unset})
        return {"message": "All auto rank stats wiped", "modified_count": result.modified_count}
