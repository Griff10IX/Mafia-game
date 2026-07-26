# Travel (info, travel, buy-airmiles) and Airports (list, claim, set-price, transfer, sell-on-trade)
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, Set
import asyncio
import hashlib
import hmac
import os
import random
import time
from pydantic import BaseModel, ConfigDict

from fastapi import Depends, HTTPException, Request
from bson.objectid import ObjectId

from utils.claim_costs import load_claim_costs
from utils.point_provenance import log_points_event
from utils.civilian_protection import raise_if_civilian_protected_asset_recipient

from server import (
    db,
    get_current_user,
    STATES,
    CARS,
    TRAVEL_TIMES,
    travel_seconds_for_car,
    SECRET_KEY,
    get_rank_info,
    user_prestige_rank_mult,
    CAPO_RANK_ID,
)
from routers.money.booze_run import _booze_user_carrying_total
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_TRAVEL
from utils.location_climate import get_location_climate


async def _travel_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_TRAVEL)


_travel_rl_u = [Depends(_travel_sustained_rl_user)]

# Constants (moved from server)
AIRPORT_COST = 10
AIRPORT_PRICE_MIN = 10
AIRPORT_PRICE_MAX = 30
AIRPORT_SLOTS_PER_STATE = 1
# Airport claim cost: utils.claim_costs (key airport)
MAX_TRAVELS_PER_HOUR = 15
EXTRA_AIRMILES_COST = 25
MAX_EXTRA_AIRMILES = 50

# Travel token: car/custom travel time multiplier (airport stays instant; airport *points* discount is separate)
TRAVEL_TOKEN_CAR_TIME_FACTOR = 0.9
TRAVEL_TOKEN_CAR_TIME_MIN = 3
# Travel must account for large garages so fastest options/custom aren't skipped.
USER_CARS_FETCH_LIMIT = 5000
TRAVEL_CUSTOM_ROWS_MAX = 20
TRAVEL_IMMUNE_ROWS_MAX = 50
_TRAVEL_CODE_PREFIX = "tc_"

# Catalog ids for rarities that must always appear in /travel/info (bulk query is capped).
_TRAVEL_ALWAYS_INCLUDE_CAR_IDS = frozenset(
    c["id"]
    for c in (CARS or [])
    if c.get("rarity") in ("exclusive", "loot_exclusive", "vip_exclusive")
)


def _travel_code_bucket_seconds() -> int:
    try:
        return max(900, int(os.getenv("TRAVEL_CODE_BUCKET_SECONDS", "7200") or "7200"))
    except Exception:
        return 7200


def _travel_code_bucket(now: Optional[float] = None) -> int:
    return int((time.time() if now is None else now) // _travel_code_bucket_seconds())


def _travel_code_field_name(bucket: Optional[int] = None) -> str:
    b = _travel_code_bucket() if bucket is None else int(bucket)
    secret = str(SECRET_KEY or "travel-code").encode("utf-8", "ignore")
    digest = hmac.new(secret, f"travel-code-field:{b}".encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{_TRAVEL_CODE_PREFIX}{digest[:16]}"


def _accepted_travel_code_field_names() -> Set[str]:
    b = _travel_code_bucket()
    return {_travel_code_field_name(b), _travel_code_field_name(b - 1)}


def _travel_code_value(user_id: str, bucket: Optional[int] = None) -> str:
    b = _travel_code_bucket() if bucket is None else int(bucket)
    secret = str(SECRET_KEY or "travel-code").encode("utf-8", "ignore")
    digest = hmac.new(secret, f"travel-code-value:{user_id}:{b}".encode("utf-8"), hashlib.sha256).hexdigest()
    return digest[:48]


def _travel_code_payload(user_id: str) -> Dict[str, Any]:
    name = _travel_code_field_name()
    return {
        "travel_code_name": name,
        "travel_code_bucket": _travel_code_bucket(),
        name: _travel_code_value(user_id),
    }


def _valid_travel_code(user_id: str, submitted: Optional[str]) -> bool:
    s = (submitted or "").strip()
    if len(s) < 16:
        return False
    b = _travel_code_bucket()
    for candidate in (_travel_code_value(user_id, b), _travel_code_value(user_id, b - 1)):
        if hmac.compare_digest(candidate, s):
            return True
    return False


async def _submitted_travel_code(payload: "TravelRequest", req: Request) -> Optional[str]:
    body: Dict[str, Any] = {}
    try:
        raw = await req.json()
        if isinstance(raw, dict):
            body = raw
    except Exception:
        body = {}

    names = _accepted_travel_code_field_names()
    hinted = body.get("travel_code_name")
    if isinstance(hinted, str) and hinted in names:
        val = body.get(hinted)
        if isinstance(val, str) and len(val.strip()) >= 16:
            return val.strip()
    for name in names:
        val = body.get(name)
        if isinstance(val, str) and len(val.strip()) >= 16:
            return val.strip()
    legacy = (payload.travel_code or "").strip()
    return legacy if len(legacy) >= 16 else None


async def _fetch_travel_user_cars(user_id: str) -> tuple[list, list, list]:
    """Bulk capped rows plus dedicated fetches for custom / exclusive cars (same idea as garage)."""
    immune_ids = list(_TRAVEL_ALWAYS_INCLUDE_CAR_IDS)
    exclude_ids = immune_ids + ["car_custom"]
    main_coro = db.user_cars.find({"user_id": user_id, "car_id": {"$nin": exclude_ids}}).to_list(USER_CARS_FETCH_LIMIT)
    custom_coro = db.user_cars.find({"user_id": user_id, "car_id": "car_custom"}).to_list(TRAVEL_CUSTOM_ROWS_MAX)
    if immune_ids:
        immune_coro = db.user_cars.find({"user_id": user_id, "car_id": {"$in": immune_ids}}).to_list(TRAVEL_IMMUNE_ROWS_MAX)
        main_rows, custom_rows, immune_rows = await asyncio.gather(main_coro, custom_coro, immune_coro)
    else:
        main_rows, custom_rows = await asyncio.gather(main_coro, custom_coro)
        immune_rows = []
    return main_rows, custom_rows, immune_rows


def _user_car_merge_key(uc: dict) -> str:
    return str(uc.get("id") or uc.get("_id") or "")


def _merge_user_cars_for_travel(bulk: list, extras: list) -> list:
    """Dedupe by user car id; extras (exclusive / loot-exclusive) win if missing from capped bulk fetch."""
    seen: set[str] = set()
    out: list = []
    for uc in bulk:
        k = _user_car_merge_key(uc)
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(uc)
    for uc in extras:
        k = _user_car_merge_key(uc)
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(uc)
    return out


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


def _travel_token_active(user: dict, now_utc: datetime) -> bool:
    travel_until = user.get("travel_until")
    if not travel_until:
        return False
    until = _parse_iso_datetime(travel_until)
    return bool(until and now_utc < until)


def _effective_car_travel_seconds(
    base_seconds: int,
    user: dict,
    now_utc: datetime,
    crew_travel_reduction_seconds: int = 0,
) -> int:
    """Base TRAVEL_TIMES seconds for car/custom; applies travel token when active, then family airport-crew flat seconds off (same perk as timed airport travel)."""
    if base_seconds <= 0:
        return base_seconds
    try:
        red = max(0, int(crew_travel_reduction_seconds or 0))
    except (TypeError, ValueError):
        red = 0
    if _travel_token_active(user, now_utc):
        t = max(TRAVEL_TOKEN_CAR_TIME_MIN, int(base_seconds * TRAVEL_TOKEN_CAR_TIME_FACTOR))
    else:
        t = base_seconds
    return max(0, t - red)


def _effective_airport_points(
    listed_price: int,
    user: dict,
    now_utc: datetime,
    user_owns_any_airport: bool,
    family_crew_points_discount: bool = False,
) -> int:
    """Points charged for airport travel; same order as _start_travel_impl (owner 5%, family crew 10%, perk 10%, travel token 10%)."""
    p = max(AIRPORT_PRICE_MIN, min(int(listed_price), AIRPORT_PRICE_MAX))
    if user_owns_any_airport:
        p = max(1, round(p * 0.95))
    if family_crew_points_discount:
        p = max(1, round(p * 0.9))
    airport_perk_until = user.get("airport_cost_perk_until")
    if airport_perk_until:
        until = _parse_iso_datetime(airport_perk_until)
        if until and now_utc < until:
            p = max(1, round(p * 0.9))
    if _travel_token_active(user, now_utc):
        p = max(1, round(p * 0.9))
    return p


# Per-user cache for GET /travel/info
_travel_info_cache: dict = {}
_TRAVEL_INFO_TTL_SEC = 5
_TRAVEL_INFO_MAX_ENTRIES = 5000

# Short TTL cache for GET /airports (all states)
_airports_list_cache: Optional[dict] = None
_airports_list_cache_ts: float = 0
_AIRPORTS_LIST_TTL_SEC = 20


def _invalidate_travel_info_cache(user_id: str):
    _travel_info_cache.pop(user_id, None)


async def invalidate_travel_info_cache_for_family(family_id: str):
    """Clear per-user travel info cache for all members (e.g. after airport crew perk change)."""
    if not (family_id or "").strip():
        return
    members = await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(200)
    for m in members:
        uid = m.get("user_id")
        if uid is None:
            continue
        _travel_info_cache.pop(str(uid), None)
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "boss_id": 1})
    bid = (fam or {}).get("boss_id")
    if bid is not None:
        _travel_info_cache.pop(str(bid), None)


def _invalidate_airports_list_cache():
    global _airports_list_cache, _airports_list_cache_ts
    _airports_list_cache = None
    _airports_list_cache_ts = 0


# ----- Models -----
class TravelRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    destination: str
    travel_method: str  # car_id or "airport"
    airport_slot: Optional[int] = None  # 1-4 when travel_method == "airport"
    # When true, applies booze-run car damage (0.3% / leg) and allows car travel while carrying booze (same as Auto Rank booze).
    booze_run: bool = False
    travel_code: Optional[str] = None


class AirportClaimRequest(BaseModel):
    state: str
    slot: int


class AirportSetPriceRequest(BaseModel):
    state: str
    slot: int
    price_per_travel: int


class AirportTransferRequest(BaseModel):
    state: str
    slot: int
    target_username: str


class AirportSellRequest(BaseModel):
    state: str
    slot: int
    points: int


# ----- Travel routes -----
async def get_travel_status(current_user: dict = Depends(get_current_user)):
    """Lightweight status for layout poll: traveling, seconds_remaining, destination. Returns 200 so layout can show travel countdown."""
    traveling_to = current_user.get("traveling_to")
    travel_arrives_at = current_user.get("travel_arrives_at")
    seconds_remaining = None
    if travel_arrives_at and traveling_to:
        arrives_dt = _parse_iso_datetime(travel_arrives_at)
        if arrives_dt:
            secs = max(0, int((arrives_dt - datetime.now(timezone.utc)).total_seconds()))
            seconds_remaining = secs if secs > 0 else None
    traveling = seconds_remaining is not None and seconds_remaining > 0
    return {
        "traveling": traveling,
        "seconds_remaining": seconds_remaining if traveling else 0,
        "destination": traveling_to if traveling else (current_user.get("current_state") or ""),
        "current_state": current_user.get("current_state") or "",
    }


async def get_travel_info(current_user: dict = Depends(get_current_user)):
    uid = current_user.get("id")
    now = time.monotonic()
    if uid in _travel_info_cache:
        payload, expires = _travel_info_cache[uid]
        if now <= expires:
            return payload

    reset_time = current_user.get("travel_reset_time")
    if reset_time:
        reset_dt = _parse_iso_datetime(reset_time)
        if reset_dt and datetime.now(timezone.utc) - reset_dt > timedelta(hours=1):
            await db.users.update_one(
                {"id": uid},
                {"$set": {"travels_this_hour": 0, "travel_reset_time": datetime.now(timezone.utc).isoformat()}}
            )
            current_user["travels_this_hour"] = 0

    now_utc = datetime.now(timezone.utc)
    from routers.game.families import family_airport_crew_perk_context

    current_state_for_load = current_user.get("current_state", STATES[0] if STATES else "")
    crew_ctx, user_car_rows, user_owns_any_airport, _existing_airport_rows = await asyncio.gather(
        family_airport_crew_perk_context(current_user),
        _fetch_travel_user_cars(uid),
        db.airport_ownership.find_one({"owner_id": uid}, {"_id": 1}),
        db.airport_ownership.find({"state": current_state_for_load}, {"_id": 0}).to_list(AIRPORT_SLOTS_PER_STATE * 2),
    )
    user_cars_bulk, custom_cars, immune_cars = user_car_rows
    family_crew_pts = bool(crew_ctx.get("family_airport_points_discount"))
    fam_time_red = int(crew_ctx.get("family_airport_travel_reduction_seconds") or 0)
    airport_time_effective = max(0, TRAVEL_TIMES["airport"] - fam_time_red)
    user_cars = _merge_user_cars_for_travel(user_cars_bulk, immune_cars)
    cars_with_travel_times = []
    for uc in user_cars:
        car_info = next((c for c in CARS if c["id"] == uc["car_id"]), None)
        if car_info:
            base_time = travel_seconds_for_car(car_info.get("id"), car_info.get("rarity"), 45)
            travel_time = _effective_car_travel_seconds(base_time, current_user, now_utc, fam_time_red)
            user_car_id = uc.get("id") or str(uc["_id"])
            name = car_info["name"]
            image = car_info.get("image", "")
            # VIP Pass car supports garage custom name/image (same as store custom car).
            if car_info.get("id") == "car22" or car_info.get("rarity") == "vip_exclusive":
                name = (uc.get("custom_name") or "").strip() or name
                image = (uc.get("custom_image_url") or "").strip() or image
            damage_percent = min(100, max(0, float(uc.get("damage_percent", 0))))
            # Damage-immune rarities never block travel from wear.
            if car_info.get("rarity") in ("exclusive", "loot_exclusive", "vip_exclusive"):
                damage_percent = 0
            cars_with_travel_times.append({
                "user_car_id": user_car_id,
                "car_id": car_info["id"],
                "name": name,
                "rarity": car_info["rarity"],
                "travel_time": travel_time,
                "image": image,
                "damage_percent": damage_percent,
                "can_travel": damage_percent < 100,
            })

    # Sort by effective travel time ascending (fastest first) so best cars show first in destination cards
    cars_with_travel_times.sort(key=lambda c: (c["travel_time"], c.get("name", "")))

    custom_car = None
    # If a user has multiple custom rows, prefer a usable one (lowest damage).
    first_custom = None
    if custom_cars:
        custom_cars_sorted = sorted(
            custom_cars,
            key=lambda uc: min(100, max(0, float(uc.get("damage_percent", 0))))
        )
        first_custom = next((uc for uc in custom_cars_sorted if min(100, max(0, float(uc.get("damage_percent", 0)))) < 100), None) or custom_cars_sorted[0]
    if first_custom:
        custom_damage = min(100, max(0, float(first_custom.get("damage_percent", 0))))
        custom_car = {
            "name": first_custom.get("custom_name") or "Custom Car",
            "travel_time": _effective_car_travel_seconds(TRAVEL_TIMES["custom"], current_user, now_utc, fam_time_red),
            "image": first_custom.get("custom_image_url") or "",
            "damage_percent": custom_damage,
            "can_travel": custom_damage < 100,
        }

    max_travels = MAX_TRAVELS_PER_HOUR + current_user.get("extra_airmiles", 0)
    current_state = current_user.get("current_state", STATES[0] if STATES else "")
    traveling_to = current_user.get("traveling_to")
    travel_arrives_at = current_user.get("travel_arrives_at")
    seconds_remaining = None
    if travel_arrives_at and traveling_to:
        arrives_dt = _parse_iso_datetime(travel_arrives_at)
        if arrives_dt:
            secs = max(0, int((arrives_dt - datetime.now(timezone.utc)).total_seconds()))
            seconds_remaining = secs if secs > 0 else None

    carrying_booze = _booze_user_carrying_total(current_user.get("booze_carrying") or {}) > 0

    # `user_owns_any_airport` and the existing airport slots were already fetched in the gather() above.
    by_slot = {int(d.get("slot") or 0): d for d in _existing_airport_rows}
    missing_slots = [s for s in range(1, AIRPORT_SLOTS_PER_STATE + 1) if s not in by_slot]
    if missing_slots:
        try:
            await db.airport_ownership.insert_many(
                [
                    {
                        "state": current_state,
                        "slot": s,
                        "owner_id": None,
                        "owner_username": None,
                        "price_per_travel": AIRPORT_COST,
                    }
                    for s in missing_slots
                ],
                ordered=False,
            )
        except Exception:
            pass
        for s in missing_slots:
            by_slot[s] = {
                "state": current_state,
                "slot": s,
                "owner_id": None,
                "owner_username": None,
                "price_per_travel": AIRPORT_COST,
            }

    airports = []
    for slot in range(1, AIRPORT_SLOTS_PER_STATE + 1):
        doc = by_slot.get(slot) or {}
        price = max(AIRPORT_PRICE_MIN, min(doc.get("price_per_travel") or AIRPORT_COST, AIRPORT_PRICE_MAX))
        you_own = doc.get("owner_id") == uid
        effective_price = _effective_airport_points(
            price, current_user, now_utc, bool(user_owns_any_airport), family_crew_pts
        )
        airports.append({
            "slot": slot,
            "owner_username": doc.get("owner_username") or "Unclaimed",
            "price_per_travel": price,
            "effective_price": effective_price,
            "you_own": you_own,
        })

    airport_cost_display = _effective_airport_points(
        AIRPORT_COST, current_user, now_utc, bool(user_owns_any_airport), family_crew_pts
    )
    if airports:
        airport_cost_display = airports[0].get("effective_price", airport_cost_display)

    payload = {
        "current_location": current_state,
        "traveling_to": traveling_to if seconds_remaining is not None and seconds_remaining > 0 else None,
        "travel_seconds_remaining": seconds_remaining,
        "destinations": [s for s in STATES if s != current_state],
        "travels_this_hour": current_user.get("travels_this_hour", 0),
        "max_travels": max_travels,
        "airport_cost": airport_cost_display,
        "airport_time": airport_time_effective,
        "user_gets_airport_discount": bool(user_owns_any_airport),
        "family_airport_points_discount": family_crew_pts,
        "family_airport_travel_reduction_seconds": fam_time_red,
        "airports": airports,
        "extra_airmiles_cost": EXTRA_AIRMILES_COST,
        "cars": cars_with_travel_times,
        "custom_car": custom_car,
        "user_points": current_user.get("points", 0),
        "carrying_booze": carrying_booze,
        "travel_boost_applies_to_car_times": _travel_token_active(current_user, now_utc),
        "location_climate": get_location_climate(now_utc),
        **_travel_code_payload(uid),
    }

    if len(_travel_info_cache) >= _TRAVEL_INFO_MAX_ENTRIES:
        oldest = next(iter(_travel_info_cache))
        _travel_info_cache.pop(oldest, None)
    _travel_info_cache[uid] = (payload, now + _TRAVEL_INFO_TTL_SEC)
    return payload


# Booze run: 0.3% damage per run. Custom and exclusive take no damage.
BOOZE_RUN_DAMAGE_PERCENT = 0.3


async def _start_travel_impl(
    user: dict,
    destination: str,
    travel_method: str,
    airport_slot: Optional[int] = None,
    booze_run: bool = False,
) -> dict:
    """Start travel for user (by user dict). Returns {message, travel_time, destination} or raises HTTPException. Used by travel() and auto_rank booze. If booze_run=True, damage is 0.3%% per run and custom/exclusive cars take no damage."""
    # Block all travel (manual, attack, auto-rank booze, etc.) while casino hands are unfinished.
    from routers.casinos.blackjack import user_has_blocking_singleplayer_blackjack
    from routers.casinos.mp_blackjack import user_in_active_mp_blackjack_game
    from routers.casinos.video_poker import user_has_active_video_poker_game

    uid = user.get("id")
    if await user_has_blocking_singleplayer_blackjack(uid):
        raise HTTPException(
            status_code=400,
            detail="Finish your blackjack hand before traveling.",
        )
    if await user_in_active_mp_blackjack_game(uid):
        raise HTTPException(
            status_code=400,
            detail="Finish or leave your multiplayer blackjack game before traveling.",
        )
    if await user_has_active_video_poker_game(uid):
        raise HTTPException(
            status_code=400,
            detail="Finish your video poker hand before traveling.",
        )
    if booze_run and travel_method == "airport":
        raise HTTPException(status_code=400, detail="Booze runs can only use a car, not airport.")
    if destination not in STATES:
        raise HTTPException(status_code=400, detail="Invalid destination")
    if user.get("is_npc") and user.get("is_bodyguard"):
        raise HTTPException(status_code=400, detail="Robot bodyguards cannot travel.")
    now_utc = datetime.now(timezone.utc)
    current_location = user.get("current_state")
    if user.get("travel_arrives_at"):
        arrives_dt = _parse_iso_datetime(user.get("travel_arrives_at"))
        if arrives_dt and now_utc >= arrives_dt:
            current_location = user.get("traveling_to") or current_location
    if destination == current_location:
        raise HTTPException(status_code=400, detail="Already at this location")
    if user.get("travel_arrives_at"):
        arrives_dt = _parse_iso_datetime(user.get("travel_arrives_at"))
        if arrives_dt and now_utc < arrives_dt:
            from utils.cooldown_skip import has_skip_credit, consume_skip_credit

            if has_skip_credit(user, "booze") and await consume_skip_credit(db, user.get("id") or "", "booze"):
                dest = user.get("traveling_to") or user.get("current_state")
                await db.users.update_one(
                    {"id": user.get("id") or ""},
                    {"$set": {"current_state": dest}, "$unset": {"traveling_to": "", "travel_arrives_at": ""}},
                )
                user = await db.users.find_one({"id": user.get("id") or ""}, {"_id": 0})
                current_location = (user or {}).get("current_state")
            else:
                raise HTTPException(status_code=400, detail="You are already traveling. Wait for arrival.")

    travel_time = 45
    method_name = "Walking"
    car_to_damage = None  # user_car doc to apply travel damage (2–4%) when travel_time > 0

    from routers.game.families import family_airport_crew_perk_context

    crew_ctx = await family_airport_crew_perk_context(user)
    family_crew_pts = bool(crew_ctx.get("family_airport_points_discount"))
    fam_time_red = int(crew_ctx.get("family_airport_travel_reduction_seconds") or 0)

    if travel_method == "airport":
        # Airport limit (travels per hour) applies only to airport; car travel is unlimited
        if not booze_run:
            max_travels = MAX_TRAVELS_PER_HOUR + user.get("extra_airmiles", 0)
            if user.get("travels_this_hour", 0) >= max_travels:
                raise HTTPException(status_code=400, detail="Travel limit reached. Buy extra airmiles or wait.")
        if _booze_user_carrying_total(user.get("booze_carrying") or {}) > 0:
            raise HTTPException(status_code=400, detail="Cannot use airport while carrying booze. Use a car.")
        slot = airport_slot if airport_slot is not None else 1
        if slot < 1 or slot > AIRPORT_SLOTS_PER_STATE:
            raise HTTPException(status_code=400, detail=f"Invalid airport slot (1–{AIRPORT_SLOTS_PER_STATE})")
        airport_doc = await db.airport_ownership.find_one({"state": current_location, "slot": slot}, {"_id": 0})
        if not airport_doc:
            await db.airport_ownership.insert_one({"state": current_location, "slot": slot, "owner_id": None, "owner_username": None, "price_per_travel": AIRPORT_COST})
            airport_doc = await db.airport_ownership.find_one({"state": current_location, "slot": slot}, {"_id": 0})
        listed = max(AIRPORT_PRICE_MIN, min(airport_doc.get("price_per_travel") or AIRPORT_COST, AIRPORT_PRICE_MAX))
        user_owns_any_airport = await db.airport_ownership.find_one({"owner_id": user["id"]}, {"_id": 1})
        airport_price = _effective_airport_points(
            listed, user, now_utc, bool(user_owns_any_airport), family_crew_pts
        )
        owner_id = airport_doc.get("owner_id")
        travel_time = max(0, TRAVEL_TIMES["airport"] - fam_time_red)
        method_name = f"Airport #{slot}"
        result = await db.users.update_one(
            {"id": user["id"], "points": {"$gte": airport_price}},
            {"$inc": {"points": -airport_price}},
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail=f"Insufficient points for airport ({airport_price} pts)")
        if _travel_token_active(user, now_utc):
            try:
                from utils.token_perk_stats import bump_token_perk_stats
                _no_token_price = _effective_airport_points(
                    listed, {**user, "travel_until": None}, now_utc, bool(user_owns_any_airport), family_crew_pts
                )
                await bump_token_perk_stats(
                    db, user["id"], "travel", points_saved=max(0, _no_token_price - airport_price), uses=1
                )
            except Exception:
                pass
        await log_points_event(
            db,
            user_id=user["id"],
            points=-airport_price,
            event_type="airport_travel",
            event_ref=f"airport:{current_location}:{slot}",
            meta={"state": current_location, "slot": slot, "destination": destination},
        )
        if owner_id:
            await db.users.update_one({"id": owner_id}, {"$inc": {"points": airport_price}})
            await log_points_event(
                db,
                user_id=owner_id,
                points=airport_price,
                event_type="airport_owner_income",
                event_ref=f"airport:{current_location}:{slot}",
                meta={"state": current_location, "slot": slot, "traveller_id": user["id"]},
            )
            await db.airport_ownership.update_one(
                {"state": current_location, "slot": slot},
                {"$inc": {"total_earnings": airport_price}}
            )
    elif travel_method == "custom":
        custom_rows = await db.user_cars.find(
            {"user_id": user["id"], "car_id": "car_custom"}
        ).to_list(20)
        first_custom = None
        if custom_rows:
            custom_rows_sorted = sorted(
                custom_rows,
                key=lambda uc: min(100, max(0, float(uc.get("damage_percent", 0))))
            )
            first_custom = next((uc for uc in custom_rows_sorted if min(100, max(0, float(uc.get("damage_percent", 0)))) < 100), None) or custom_rows_sorted[0]
        if not first_custom:
            raise HTTPException(status_code=400, detail="You don't own a custom car")
        if min(100, max(0, float(first_custom.get("damage_percent", 0)))) >= 100:
            raise HTTPException(status_code=400, detail="That car is too damaged to travel. Repair or scrap it in the garage.")
        travel_time = TRAVEL_TIMES["custom"]
        method_name = first_custom.get("custom_name") or "Custom Car"
        # Custom car never takes damage (manual or booze)
        car_to_damage = None
    else:
        user_car = await db.user_cars.find_one(
            {"id": travel_method, "user_id": user["id"]},
        )
        if not user_car:
            try:
                user_car = await db.user_cars.find_one(
                    {"_id": ObjectId(travel_method), "user_id": user["id"]},
                )
            except Exception:
                user_car = None
        if not user_car:
            raise HTTPException(status_code=400, detail="Car not found")
        if min(100, max(0, float(user_car.get("damage_percent", 0)))) >= 100:
            raise HTTPException(status_code=400, detail="That car is too damaged to travel. Repair or scrap it in the garage.")
        car_info = next((c for c in CARS if c["id"] == user_car["car_id"]), None)
        if car_info:
            travel_time = travel_seconds_for_car(car_info.get("id"), car_info.get("rarity"), 45)
            method_name = car_info["name"]
            if car_info.get("id") == "car22" or car_info.get("rarity") == "vip_exclusive":
                method_name = (user_car.get("custom_name") or "").strip() or method_name
        # Custom, exclusive, loot_exclusive, and VIP Pass cars never take damage (manual or booze)
        if car_info and car_info.get("rarity") in ("exclusive", "loot_exclusive", "vip_exclusive"):
            car_to_damage = None
        else:
            car_to_damage = user_car

    if travel_method != "airport" and travel_time > 0:
        _base_car_seconds = travel_time
        travel_time = _effective_car_travel_seconds(travel_time, user, now_utc, fam_time_red)
        if _travel_token_active(user, now_utc):
            try:
                from utils.token_perk_stats import bump_token_perk_stats
                _no_token_time = _effective_car_travel_seconds(
                    _base_car_seconds, {**user, "travel_until": None}, now_utc, fam_time_red
                )
                await bump_token_perk_stats(
                    db, user["id"], "travel", time_saved_sec=max(0, _no_token_time - travel_time), uses=1
                )
            except Exception:
                pass

    # Only count airport travel against the hourly limit; car travel is unlimited
    inc_travels = {} if booze_run or travel_method != "airport" else {"travels_this_hour": 1}
    arrives_at = None
    if travel_time <= 0:
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"current_state": destination}, **({"$inc": inc_travels} if inc_travels else {})}
        )
    else:
        arrives_at = (now_utc + timedelta(seconds=travel_time)).isoformat()
        update = {"$set": {"traveling_to": destination, "travel_arrives_at": arrives_at}}
        if inc_travels:
            update["$inc"] = inc_travels
        await db.users.update_one({"id": user["id"]}, update)
        if car_to_damage:
            current_damage = min(100, max(0, float(car_to_damage.get("damage_percent", 0))))
            if booze_run:
                add_damage = BOOZE_RUN_DAMAGE_PERCENT  # 0.3% per run
            else:
                add_damage = random.randint(2, 4)
            new_damage = round(min(100, current_damage + add_damage), 1)
            if car_to_damage.get("_id") is not None:
                q = {"_id": car_to_damage["_id"]}
            else:
                q = {"user_id": user["id"], "id": car_to_damage.get("id")}
            await db.user_cars.update_one(q, {"$set": {"damage_percent": new_damage}})

    _invalidate_travel_info_cache(user["id"])
    out = {
        "message": f"Traveling to {destination} via {method_name}",
        "travel_time": travel_time,
        "destination": destination,
    }
    if travel_time > 0 and arrives_at:
        out["travel_arrives_at"] = arrives_at
    else:
        out["current_state"] = destination
    return out


async def travel(request: TravelRequest, req: Request, current_user: dict = Depends(get_current_user)):
    # Only block when Auto Rank is actually on; stale auto_rank_booze after trial expiry must not lock travel.
    if current_user.get("auto_rank_booze") and current_user.get("auto_rank_enabled"):
        raise HTTPException(
            status_code=400,
            detail="Manual travel is disabled while Auto Rank booze running is on. Turn off booze running in Auto Rank to travel.",
        )
    submitted_code = await _submitted_travel_code(request, req)
    if not _valid_travel_code(current_user.get("id") or "", submitted_code):
        try:
            from utils.staff_bot_client_alert import maybe_notify_staff_travel_code_fail

            await maybe_notify_staff_travel_code_fail(
                db=db,
                request=req,
                user_id=current_user.get("id") or "",
                username=current_user.get("username") or "",
                destination=request.destination,
                travel_method=request.travel_method,
                airport_slot=request.airport_slot,
                source="travel",
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=400,
            detail={
                "code": "travel_code_invalid",
                "detail": "Travel refreshed. Reload travel options and try again.",
            },
        )
    return await _start_travel_impl(
        current_user,
        request.destination,
        request.travel_method,
        request.airport_slot,
        booze_run=bool(request.booze_run),
    )


async def buy_extra_airmiles(current_user: dict = Depends(get_current_user)):
    if int(current_user.get("points") or 0) < EXTRA_AIRMILES_COST:
        raise HTTPException(status_code=400, detail="Insufficient points")
    current_airmiles = int(current_user.get("extra_airmiles", 0) or 0)
    if current_airmiles >= MAX_EXTRA_AIRMILES:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_EXTRA_AIRMILES} extra airmiles already purchased")
    to_add = min(5, MAX_EXTRA_AIRMILES - current_airmiles)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -EXTRA_AIRMILES_COST, "extra_airmiles": to_add}}
    )
    await log_points_event(
        db,
        user_id=current_user["id"],
        points=-EXTRA_AIRMILES_COST,
        event_type="airport_airmiles",
        event_ref=f"airmiles:{to_add}",
        meta={"airmiles_purchased": to_add, "new_total": current_airmiles + to_add},
    )
    new_total = current_airmiles + to_add
    _invalidate_travel_info_cache(current_user["id"])
    return {"message": f"Purchased {to_add} extra airmiles for {EXTRA_AIRMILES_COST} points. Total: {new_total}/{MAX_EXTRA_AIRMILES}"}


# ----- Airport routes -----
async def list_airports(current_user: dict = Depends(get_current_user)):
    global _airports_list_cache, _airports_list_cache_ts
    now = time.monotonic()
    if _airports_list_cache is not None and now <= _airports_list_cache_ts + _AIRPORTS_LIST_TTL_SEC:
        return _airports_list_cache
    cc = await load_claim_costs(db)
    result = []
    for state in STATES:
        for slot in range(1, AIRPORT_SLOTS_PER_STATE + 1):
            doc = await db.airport_ownership.find_one({"state": state, "slot": slot}, {"_id": 0})
            if not doc:
                await db.airport_ownership.insert_one({"state": state, "slot": slot, "owner_id": None, "owner_username": None, "price_per_travel": AIRPORT_COST})
                doc = await db.airport_ownership.find_one({"state": state, "slot": slot}, {"_id": 0})
            price = max(AIRPORT_PRICE_MIN, min(doc.get("price_per_travel") or AIRPORT_COST, AIRPORT_PRICE_MAX))
            result.append({"state": state, "slot": slot, "owner_username": doc.get("owner_username") or "Unclaimed", "price_per_travel": price})
    payload = {"airports": result, "claim_cost": cc["airport"]}
    _airports_list_cache = payload
    _airports_list_cache_ts = now
    return payload


async def claim_airport(req: AirportClaimRequest, current_user: dict = Depends(get_current_user)):
    from server import _user_owns_airport, maybe_auto_relinquish_below_capo  # lazy import to avoid circular dependency
    rank_id, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
    prestige_level = int(current_user.get("prestige_level") or 0)
    if rank_id < CAPO_RANK_ID and prestige_level < 1:
        raise HTTPException(status_code=403, detail="You must be rank Capo or higher to claim a property (airport). Reach Capo to hold one.")
    if req.state not in STATES:
        raise HTTPException(status_code=400, detail="Invalid state")
    if req.slot < 1 or req.slot > AIRPORT_SLOTS_PER_STATE:
        raise HTTPException(status_code=400, detail=f"Slot must be 1–{AIRPORT_SLOTS_PER_STATE}")
    existing_air = await _user_owns_airport(current_user["id"])
    if existing_air and existing_air.get("state") != req.state:
        raise HTTPException(
            status_code=400,
            detail="You already hold an airport in another state. Relinquish it first, or claim another slot in that same state.",
        )
    user_location = (current_user.get("current_state") or "").strip()
    if user_location != req.state:
        raise HTTPException(status_code=400, detail=f"You must be in {req.state} to claim this airport. Travel there first.")
    await maybe_auto_relinquish_below_capo(db.airport_ownership, {"state": req.state, "slot": req.slot})
    doc = await db.airport_ownership.find_one({"state": req.state, "slot": req.slot}, {"_id": 0})
    if not doc:
        await db.airport_ownership.insert_one({"state": req.state, "slot": req.slot, "owner_id": None, "owner_username": None, "price_per_travel": AIRPORT_COST})
        doc = await db.airport_ownership.find_one({"state": req.state, "slot": req.slot}, {"_id": 0})
    if doc.get("owner_id"):
        raise HTTPException(status_code=400, detail="This airport slot is already owned")
    cc = await load_claim_costs(db)
    claim_cost = cc["airport"]
    user = await db.users.find_one({"id": current_user["id"]})
    if not user or user.get("money", 0) < claim_cost:
        raise HTTPException(status_code=400, detail=f"You need ${claim_cost:,} to claim an airport")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -claim_cost}})
    await db.airport_ownership.update_one(
        {"state": req.state, "slot": req.slot},
        {"$set": {"owner_id": current_user["id"], "owner_username": current_user.get("username"), "price_per_travel": AIRPORT_COST, "total_earnings": 0}}
    )
    _invalidate_airports_list_cache()
    _invalidate_travel_info_cache(current_user["id"])
    return {"message": f"You now own Airport #{req.slot} in {req.state}. Set price ({AIRPORT_PRICE_MIN}–{AIRPORT_PRICE_MAX} pts) and earn points when players fly from here. You get 5% off at all airports.", "state": req.state, "slot": req.slot}


async def set_airport_price(req: AirportSetPriceRequest, current_user: dict = Depends(get_current_user)):
    from server import maybe_auto_relinquish_below_capo  # lazy import to avoid circular dependency
    if req.state not in STATES:
        raise HTTPException(status_code=400, detail="Invalid state")
    if req.slot < 1 or req.slot > AIRPORT_SLOTS_PER_STATE:
        raise HTTPException(status_code=400, detail=f"Slot must be 1–{AIRPORT_SLOTS_PER_STATE}")
    if req.price_per_travel < AIRPORT_PRICE_MIN or req.price_per_travel > AIRPORT_PRICE_MAX:
        raise HTTPException(status_code=400, detail=f"Price must be {AIRPORT_PRICE_MIN}–{AIRPORT_PRICE_MAX} points per travel")
    await maybe_auto_relinquish_below_capo(db.airport_ownership, {"state": req.state, "slot": req.slot})
    doc = await db.airport_ownership.find_one({"state": req.state, "slot": req.slot}, {"_id": 0})
    if not doc or doc.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this airport slot")
    await db.airport_ownership.update_one(
        {"state": req.state, "slot": req.slot},
        {"$set": {"price_per_travel": req.price_per_travel}}
    )
    _invalidate_airports_list_cache()
    return {"message": f"Airport #{req.slot} in {req.state} set to {req.price_per_travel} points per travel", "state": req.state, "slot": req.slot, "price_per_travel": req.price_per_travel}


async def airport_transfer(req: AirportTransferRequest, current_user: dict = Depends(get_current_user)):
    from server import maybe_auto_relinquish_below_capo, _user_owns_airport, _username_pattern  # lazy import to avoid circular dependency
    if req.state not in STATES:
        raise HTTPException(status_code=400, detail="Invalid state")
    if req.slot < 1 or req.slot > AIRPORT_SLOTS_PER_STATE:
        raise HTTPException(status_code=400, detail=f"Slot must be 1–{AIRPORT_SLOTS_PER_STATE}")
    await maybe_auto_relinquish_below_capo(db.airport_ownership, {"state": req.state, "slot": req.slot})
    doc = await db.airport_ownership.find_one({"state": req.state, "slot": req.slot}, {"_id": 0})
    if not doc or doc.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this airport slot")
    target_username = (req.target_username or "").strip()
    if not target_username:
        raise HTTPException(status_code=400, detail="Enter a username")
    target_username_pattern = _username_pattern(target_username)
    if not target_username_pattern:
        raise HTTPException(status_code=404, detail="User not found")
    target = await db.users.find_one({"username": target_username_pattern}, {"_id": 0, "id": 1, "username": 1, "rank_points": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot transfer to yourself")
    await raise_if_civilian_protected_asset_recipient(db, target["id"])
    if await _user_owns_airport(target["id"]):
        raise HTTPException(status_code=400, detail="That user already owns an airport")
    airport_set = {"owner_id": target["id"], "owner_username": target.get("username", target_username), "total_earnings": 0}
    if get_rank_info(target.get("rank_points", 0), user_prestige_rank_mult(target))[0] < CAPO_RANK_ID:
        airport_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
    await db.airport_ownership.update_one(
        {"state": req.state, "slot": req.slot},
        {"$set": airport_set}
    )
    _invalidate_airports_list_cache()
    _invalidate_travel_info_cache(current_user["id"])
    _invalidate_travel_info_cache(target["id"])
    return {"message": f"Airport #{req.slot} in {req.state} transferred to {target.get('username', target_username)}"}


async def airport_sell_on_trade(req: AirportSellRequest, current_user: dict = Depends(get_current_user)):
    from server import maybe_auto_relinquish_below_capo  # lazy import to avoid circular dependency
    if req.state not in STATES:
        raise HTTPException(status_code=400, detail="Invalid state")
    if req.slot < 1 or req.slot > AIRPORT_SLOTS_PER_STATE:
        raise HTTPException(status_code=400, detail=f"Slot must be 1–{AIRPORT_SLOTS_PER_STATE}")
    if req.points < 0:
        raise HTTPException(status_code=400, detail="Points must be non-negative")
    await maybe_auto_relinquish_below_capo(db.airport_ownership, {"state": req.state, "slot": req.slot})
    doc = await db.airport_ownership.find_one({"state": req.state, "slot": req.slot}, {"_id": 0})
    if not doc or doc.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this airport slot")
    listing_id = ObjectId()
    listing = {
        "_id": listing_id,
        "id": str(listing_id),
        "type": "airport",
        "state": req.state,
        "slot": req.slot,
        "location": f"{req.state} #{req.slot}",
        "name": f"Airport #{req.slot} ({req.state})",
        "owner_id": current_user["id"],
        "owner_username": current_user.get("username", "Unknown"),
        "for_sale": True,
        "sale_price": req.points,
        "created_at": datetime.now(timezone.utc),
    }
    await db.properties.insert_one(listing)
    return {"message": f"Airport #{req.slot} in {req.state} listed for {req.points:,} points on Quick Trade"}


def register(router):
    # /travel/info and /travel/status are read-only and 5-20s server-cached; the cache itself acts as the rate
    # limit. Removing the sustained-RL gate eliminates the 429 retries that caused the 4-5s "Loading travel
    # options..." freeze on the Kill page travel modal under high traffic. Mutating routes (POST /travel,
    # claim, set-price, transfer, sell) keep their existing protections.
    router.add_api_route("/travel/status", get_travel_status, methods=["GET"])
    router.add_api_route("/travel/info", get_travel_info, methods=["GET"])
    router.add_api_route("/travel", travel, methods=["POST"])
    router.add_api_route("/travel/buy-airmiles", buy_extra_airmiles, methods=["POST"])
    router.add_api_route("/airports", list_airports, methods=["GET"], dependencies=_travel_rl_u)
    router.add_api_route("/airports/claim", claim_airport, methods=["POST"])
    router.add_api_route("/airports/set-price", set_airport_price, methods=["POST"])
    router.add_api_route("/airports/transfer", airport_transfer, methods=["POST"])
    router.add_api_route("/airports/sell-on-trade", airport_sell_on_trade, methods=["POST"])
