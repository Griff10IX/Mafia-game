"""Auto events and Auto missions. One action per wake, sharing the existing Auto Rank cycle."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

AUTO_EVENTS_COST_POINTS = 2000
_CONTEST_CACHE: Dict[str, Any] = {"at": 0.0, "type_id": "", "name": ""}
_CACHE_SECONDS = 60

_ACTION_FOR_KEY = {
    "crimes": "crime",
    "crime_profit": "crime",
    "money_earned": "crime",
    "rank_id": "crime",
    "jail_busts": "bust",
    "jail_busts_npc": "bust",
    "gta": "gta",
    "uncommon_cars_stolen": "gta",
    "cars_melted": "melt",
    "bullets_melted": "melt",
    "uncommon_cars_scrapped": "scrap",
    "cars_purchased_dealership": "buy_uncommon",
    "cars_purchased_dealership_uncommon": "buy_uncommon",
    "cars_purchased_dealership_rare": "buy_rare",
    "cars_purchased_dealership_ultra_rare": "buy_ultra_rare",
    "cars_purchased_dealership_legendary": "buy_legendary",
    "hitlist_npc_kills": "hitlist",
    "attacks": "hitlist",
    "booze_sells": "booze",
    "in_state": "travel",
    "bullets_purchased_armoury": "bullets",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


async def cached_live_contest(db) -> Dict[str, str]:
    now = time.monotonic()
    if _CONTEST_CACHE["type_id"] and (now - float(_CONTEST_CACHE["at"])) < _CACHE_SECONDS:
        return {"type_id": _CONTEST_CACHE["type_id"], "name": _CONTEST_CACHE["name"]}
    from utils.daily_contests import CONTEST_TYPES, ensure_active_contest

    event = await ensure_active_contest(db)
    type_id = str((event or {}).get("type_id") or "")
    name = str((event or {}).get("name") or (CONTEST_TYPES.get(type_id) or {}).get("name") or type_id)
    _CONTEST_CACHE["at"] = now
    _CONTEST_CACHE["type_id"] = type_id
    _CONTEST_CACHE["name"] = name
    return {"type_id": type_id, "name": name}


def _event_ids(user: dict) -> List[str]:
    raw = user.get("auto_rank_event_ids")
    if not isinstance(raw, list):
        return []
    return [str(x) for x in raw if str(x).strip()]


def managers_enabled(user: dict, live_type: str) -> tuple[bool, bool]:
    if not user.get("auto_rank_events_unlocked") or not user.get("auto_rank_enabled"):
        return False, False
    ids = set(_event_ids(user))
    event_on = bool(live_type and live_type in ids and live_type != "mission")
    mission_on = bool(user.get("auto_rank_missions_enabled")) or (live_type == "mission" and "mission" in ids)
    return event_on, mission_on


async def consume_manager_wake(db, user: dict) -> bool:
    """True when this wake was used by a manager and the normal cycle should not also run."""
    if not user or not user.get("id"):
        return False
    try:
        live = await cached_live_contest(db)
    except Exception:
        logger.exception("auto events contest cache")
        return False
    event_on, mission_on = managers_enabled(user, live.get("type_id") or "")
    if not event_on and not mission_on:
        return False
    seq = []
    if event_on:
        seq.append("event")
    if mission_on:
        seq.append("mission")
    seq.append("normal")
    slot = int(user.get("auto_rank_manager_slot") or 0)
    kind = seq[slot % len(seq)]
    await db.users.update_one({"id": user["id"]}, {"$inc": {"auto_rank_manager_slot": 1}})
    if kind == "normal":
        return False
    try:
        if kind == "event":
            did = await _run_event(db, user, live.get("type_id") or "")
        else:
            did = await _run_mission(db, user)
    except Exception:
        logger.exception("auto rank manager %s for %s", kind, user.get("id"))
        return False
    return bool(did)


async def _run_event(db, user: dict, type_id: str) -> bool:
    if type_id == "crime":
        return await _one_crime(db, user)
    if type_id == "gta":
        return await _one_gta(db, user)
    if type_id == "crime_gta":
        step = int(user.get("auto_rank_street_step") or 0) % 2
        await db.users.update_one({"id": user["id"]}, {"$set": {"auto_rank_street_step": (step + 1) % 2}})
        return await (_one_crime(db, user) if step == 0 else _one_gta(db, user))
    if type_id == "melt":
        return await _one_melt(db, user)
    if type_id == "jailbust":
        return await _one_bust(user)
    if type_id == "booze":
        return await _one_booze(db, user)
    if type_id == "racket":
        return await _one_racket(db, user)
    if type_id == "oc":
        return await _one_oc(user)
    if type_id == "hitlist":
        return await _hitlist_batch(db, user, remaining=None)
    if type_id == "property":
        return await _one_property(db, user)
    if type_id == "grave":
        return await _one_grave(user)
    return False


async def _run_mission(db, user: dict) -> bool:
    from routers.account.missions import (
        _build_mission_completion_reward_update,
        _car_display_name,
        _check_mission_requirements,
        _current_open_mission,
        _mission_completion_reward_mult,
        _run_mission_completion_side_effects,
    )
    from server import apply_season_rp_mirror_to_update, rank_points_in_update, send_notification

    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or user
    mission = _current_open_mission(fresh)
    if not mission:
        return False
    met, progress = _check_mission_requirements(fresh, mission)
    if met:
        return await _claim_mission(
            db, fresh, mission,
            _build_mission_completion_reward_update,
            _car_display_name,
            _mission_completion_reward_mult,
            _run_mission_completion_side_effects,
            apply_season_rp_mirror_to_update,
            rank_points_in_update,
            send_notification,
        )
    unmet = list((progress or {}).get("unmet_keys") or [])
    actionable = [k for k in unmet if k in _ACTION_FOR_KEY]
    if not actionable:
        return False
    start = int(fresh.get("auto_rank_mission_line") or 0) % len(actionable)
    await db.users.update_one({"id": fresh["id"]}, {"$set": {"auto_rank_mission_line": start + 1}})
    for offset in range(len(actionable)):
        key = actionable[(start + offset) % len(actionable)]
        action = _ACTION_FOR_KEY[key]
        try:
            if action == "crime" and await _one_crime(db, fresh):
                return True
            if action == "bust" and await _one_bust(fresh):
                return True
            if action == "gta" and await _one_gta(db, fresh):
                return True
            if action == "melt" and await _one_melt(db, fresh):
                return True
            if action == "scrap" and await _one_scrap_uncommon(db, fresh):
                return True
            if action.startswith("buy_") and await _buy_rarity(fresh, action.replace("buy_", "")):
                return True
            if action == "hitlist":
                remaining = _hitlist_remaining(fresh, mission, key)
                if await _hitlist_batch(db, fresh, remaining=remaining):
                    return True
            if action == "booze" and await _one_booze(db, fresh):
                return True
            if action == "travel" and await _travel_to(fresh, (mission.get("requirements") or {}).get("in_state")):
                return True
            if action == "bullets" and fresh.get("auto_rank_events_buy_bullets") and await _buy_bullets(fresh, 1000):
                return True
        except HTTPException:
            continue
        except Exception:
            logger.exception("auto mission line %s for %s", key, fresh.get("id"))
            continue
    return False


def _hitlist_remaining(user: dict, mission: dict, key: str) -> Optional[int]:
    from routers.account.missions import _get_user_progress_value

    target = (mission.get("requirements") or {}).get(key)
    try:
        target_n = int(target)
    except (TypeError, ValueError):
        return None
    baselines = (user.get("mission_baselines") or {}).get(mission.get("id")) or {}
    total = _get_user_progress_value(user, key if key != "attacks" else "hitlist_npc_kills")
    base = baselines.get("hitlist_npc_kills" if key == "attacks" else key)
    if base is None:
        base = 0 if key == "hitlist_npc_kills" else total
    current = max(0, int(total) - int(base))
    return max(0, target_n - current)


async def _claim_mission(db, user, mission, build, car_name, mult_fn, side_fx, season_fn, rp_in, notify) -> bool:
    mission_id = mission["id"]
    mult = mult_fn(user)
    update, meta = build(user, mission_id, mission, mult, include_mission_completion_push=True, include_next_mission_baseline=True)
    mission_update = season_fn(update, user=user)
    result = await db.users.update_one(
        {"id": user["id"], "mission_completions.mission_id": {"$ne": mission_id}},
        mission_update,
    )
    if result.modified_count == 0:
        return False
    await side_fx(user["id"], user, mission_id, meta, rp_awarded=rp_in(mission_update))
    try:
        from utils.daily_contests import record_contest_progress

        await record_contest_progress(db, user["id"], "mission", 1)
    except Exception:
        pass
    cars = [car_name(cid) for cid in (meta.get("granted_car_ids") or [])]
    rewards = {
        "cash": int(meta.get("reward_cash_immediate") or 0),
        "tribute": int(meta.get("reward_money") or 0) + int(meta.get("reward_tribute") or 0),
        "points": int(meta.get("reward_points") or 0),
        "respect": int(meta.get("reward_respect") or 0),
        "cars": cars,
        "booze": meta.get("reward_booze") or None,
        "bullets": int(meta.get("reward_bullets") or 0),
        "loot_pieces": int(meta.get("reward_loot_box_pieces") or 0),
        "auto_rank_hours": int(meta.get("reward_auto_rank_2h") or 0) * 2,
        "city": meta.get("unlocks_city") or "",
    }
    title = mission.get("title") or mission_id
    entry = {"at": _now_iso(), "mission_id": mission_id, "mission_name": title, "rewards": rewards}
    await db.users.update_one(
        {"id": user["id"]},
        {"$push": {"auto_rank_mission_rewards": {"$each": [entry], "$slice": -20}}},
    )
    parts = []
    if rewards["cash"]:
        parts.append(f"${rewards['cash']:,} cash")
    if rewards["tribute"]:
        parts.append(f"${rewards['tribute']:,} tribute")
    if rewards["points"]:
        parts.append(f"{rewards['points']:,} rank points")
    if rewards["respect"]:
        parts.append(f"{rewards['respect']:,} respect")
    if cars:
        parts.append(", ".join(cars))
    if rewards["bullets"]:
        parts.append(f"{rewards['bullets']:,} bullets")
    if rewards["loot_pieces"]:
        parts.append(f"{rewards['loot_pieces']:,} loot pieces")
    if rewards["auto_rank_hours"]:
        parts.append(f"{rewards['auto_rank_hours']}h Auto Rank")
    if rewards["city"]:
        parts.append(f"unlocked {rewards['city']}")
    body = f"{title} is complete."
    if parts:
        body += " You received " + ", ".join(parts) + "."
    try:
        await notify(user["id"], "Mission complete", body, "system", category="missions", always_deliver=True)
    except Exception:
        logger.exception("auto mission notify %s", user.get("id"))
    return True


async def _one_crime(db, user: dict) -> bool:
    from routers.crime.crimes import PRESTIGE_CRIMES, commit_crime_locked
    from server import get_rank_info, user_prestige_rank_mult

    crimes = await db.crimes.find({}, {"_id": 0, "id": 1, "name": 1, "min_rank": 1, "prestige_required": 1}).to_list(100)
    existing = {c.get("id") for c in crimes}
    for pc in PRESTIGE_CRIMES or []:
        if pc.get("id") and pc.get("id") not in existing:
            crimes.append(pc)
    allowed = user.get("auto_rank_crime_ids")
    if isinstance(allowed, list) and allowed:
        allow = set(allowed)
        crimes = [c for c in crimes if c.get("id") in allow]
    rank_id, _ = get_rank_info(int(user.get("rank_points") or 0), user_prestige_rank_mult(user))
    prestige = int(user.get("prestige_level") or 0)
    now = datetime.now(timezone.utc)
    cooldowns = {
        uc["crime_id"]: uc.get("cooldown_until")
        for uc in await db.user_crimes.find({"user_id": user["id"]}, {"_id": 0, "crime_id": 1, "cooldown_until": 1}).to_list(500)
    }
    for c in crimes:
        cid = c.get("id")
        if not cid:
            continue
        try:
            if int(c.get("min_rank") or 1) > rank_id:
                continue
        except (TypeError, ValueError):
            continue
        pr = c.get("prestige_required")
        if pr is not None and prestige < int(pr):
            continue
        until_raw = cooldowns.get(cid)
        if until_raw:
            try:
                until = datetime.fromisoformat(str(until_raw).replace("Z", "+00:00"))
                if until.tzinfo is None:
                    until = until.replace(tzinfo=timezone.utc)
                if until > now:
                    continue
            except Exception:
                pass
        await commit_crime_locked(cid, user, via_auto_rank=True)
        return True
    return False


async def _one_gta(db, user: dict) -> bool:
    from routers.cars.gta import GTA_OPTIONS, attempt_gta_locked
    from server import get_rank_info, user_prestige_rank_mult

    rank_id, _ = get_rank_info(int(user.get("rank_points") or 0), user_prestige_rank_mult(user))
    unlocked = [opt for opt in (GTA_OPTIONS or []) if rank_id >= int(opt.get("min_rank") or 0)]
    allowed = user.get("auto_rank_gta_option_ids")
    if isinstance(allowed, list) and allowed:
        allow = set(allowed)
        unlocked = [opt for opt in unlocked if opt.get("id") in allow]
    if not unlocked:
        return False
    cooldown = await db.gta_cooldowns.find_one({"user_id": user["id"]}, {"_id": 0, "cooldown_until": 1})
    if cooldown and cooldown.get("cooldown_until"):
        try:
            until = datetime.fromisoformat(str(cooldown["cooldown_until"]).replace("Z", "+00:00"))
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            if until > datetime.now(timezone.utc):
                return False
        except Exception:
            pass
    idx = int(user.get("auto_rank_next_gta_option_index") or 0) % len(unlocked)
    opt = unlocked[idx]
    await attempt_gta_locked(opt["id"], user, caller_updates_total_gta=True)
    await db.users.update_one({"id": user["id"]}, {"$set": {"auto_rank_next_gta_option_index": (idx + 1) % len(unlocked)}})
    return True


async def _one_melt(db, user: dict) -> bool:
    return await _melt_one(db, user, action="bullets", rarity=None)


async def _one_scrap_uncommon(db, user: dict) -> bool:
    return await _melt_one(db, user, action="cash", rarity="uncommon")


async def _melt_one(db, user: dict, *, action: str, rarity: Optional[str]) -> bool:
    from routers.cars.gta import CARS, melt_cars_locked

    rows = await db.user_cars.find({"user_id": user["id"]}, {"_id": 0, "id": 1, "car_id": 1, "listed_for_sale": 1}).to_list(200)
    catalog = {c.get("id"): c for c in (CARS or [])}
    for uc in rows:
        if uc.get("listed_for_sale") or not uc.get("id"):
            continue
        info = catalog.get(uc.get("car_id")) or {}
        if rarity and (info.get("rarity") or "") != rarity:
            continue
        result = await melt_cars_locked(user, [uc["id"]], action, manual_garage=False, allowed_rarities={rarity} if rarity else None)
        return bool(result.get("success"))
    return False


async def _one_bust(user: dict) -> bool:
    from routers.account.auto_rank import _run_bust_only_for_user

    before = int(user.get("jail_busts") or 0)
    await _run_bust_only_for_user(user["id"], user.get("username") or "?", (user.get("telegram_chat_id") or "").strip(), (user.get("telegram_bot_token") or "").strip() or None)
    fresh = await __import__("server").db.users.find_one({"id": user["id"]}, {"_id": 0, "jail_busts": 1})
    return int((fresh or {}).get("jail_busts") or 0) > before


async def _one_booze(db, user: dict) -> bool:
    from routers.account.auto_rank import _run_booze_for_user

    lines: List[str] = []
    return bool(await _run_booze_for_user(db, user["id"], user.get("username") or "?", (user.get("telegram_chat_id") or "").strip(), (user.get("telegram_bot_token") or "").strip() or None, datetime.now(timezone.utc), lines))


async def _one_oc(user: dict) -> bool:
    from routers.crime.oc import run_oc_heist_npc_only

    result = await run_oc_heist_npc_only(user["id"])
    return bool((result or {}).get("ran"))


async def _one_racket(db, user: dict) -> bool:
    from routers.game.families import families_racket_collect

    family_id = (user.get("family_id") or "").strip()
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "rackets": 1}) if family_id else None
    rackets = (fam or {}).get("rackets") or {}
    for racket_id, state in rackets.items():
        if int((state or {}).get("level") or 0) <= 0:
            continue
        try:
            await families_racket_collect(racket_id, user)
            return True
        except HTTPException:
            continue
    return False


async def _one_property(db, user: dict) -> bool:
    from routers.money.properties import collect_property_income_impl

    owned = await db.user_properties.find_one({"user_id": user["id"]}, {"_id": 0, "property_id": 1})
    if not owned or not owned.get("property_id"):
        return False
    await collect_property_income_impl(owned["property_id"], user)
    return True


async def _one_grave(user: dict) -> bool:
    endpoint = _route_endpoint("/grave-robber/attempt")
    start = _route_endpoint("/grave-robber/start-run")
    if endpoint is None:
        return False
    try:
        await endpoint(user)
        return True
    except HTTPException as exc:
        detail = str(getattr(exc, "detail", "") or "")
        if start is not None and ("start" in detail.lower() or "run" in detail.lower()):
            try:
                await start(user)
                await endpoint(user)
                return True
            except HTTPException:
                return False
        return False


def _route_endpoint(suffix: str):
    import server as srv

    for route in getattr(srv, "app", None).routes if getattr(srv, "app", None) else []:
        path = getattr(route, "path", "") or ""
        if path.endswith(suffix):
            return getattr(route, "endpoint", None)
    return None


async def _travel_to(user: dict, state: Optional[str]) -> bool:
    dest = (state or "").strip()
    if not dest or (user.get("current_state") or "").strip() == dest:
        return False
    if user.get("travel_arrives_at"):
        return False
    from routers.account.auto_rank import _get_travel_method
    from routers.admin.airport import _start_travel_impl
    import server as srv

    method = await _get_travel_method(srv.db, user["id"])
    if not method:
        return False
    await _start_travel_impl(user, dest, method, airport_slot=None, booze_run=False)
    return True


async def _buy_rarity(user: dict, rarity: str) -> bool:
    from routers.cars.gta import CARS, DEALER_EXCLUDED_IDS, buy_car
    import server as srv

    counts = await srv.db.dealer_stock.aggregate([{"$group": {"_id": "$car_id", "count": {"$sum": 1}}}]).to_list(100)
    stocked = {d["_id"] for d in counts if int(d.get("count") or 0) > 0}
    cars = [
        c for c in (CARS or [])
        if c.get("id") in stocked
        and (c.get("rarity") or "") == rarity
        and c.get("id") not in DEALER_EXCLUDED_IDS
        and c.get("rarity") not in ("loot_exclusive", "vip_exclusive")
    ]
    if not cars:
        return False
    cars.sort(key=lambda c: int(c.get("value") or 0))

    class _Req:
        car_id = cars[0]["id"]

    await buy_car(_Req(), user)
    return True


async def _buy_bullets(user: dict, amount: int) -> bool:
    from routers.kill.armoury import buy_bullets_for_auto_rank

    await buy_bullets_for_auto_rank(user, amount)
    return True


async def _hitlist_batch(db, user: dict, remaining: Optional[int]) -> bool:
    """Fill empty practice slots, or shoot every ready NPC in this city. Never a real player."""
    from routers.kill.attack import (
        AttackExecuteRequest,
        _AUTO_RANK_ATTACK,
        _hunt_location_when_search_timer_fires,
        compute_bullets_required,
        execute_attack,
    )
    from routers.kill.hitlist import _hitlist_npc_active_on_board_count, _hitlist_npc_max_per_window_for_user, hitlist_add_npc

    if remaining is not None and remaining <= 0:
        return False
    uid = user["id"]
    now = datetime.now(timezone.utc)
    rows = await db.attacks.find(
        {"attacker_id": uid, "status": {"$in": ["searching", "found"]}, "search_source": "hitlist_npc"},
        {"_id": 0},
    ).to_list(20)
    ready = []
    for row in rows:
        target = await db.users.find_one({"id": row.get("target_id")}, {"_id": 0})
        if not target or not target.get("is_npc") or target.get("is_bodyguard") or target.get("is_dead"):
            continue
        hit = await db.hitlist.find_one(
            {"target_id": target["id"], "target_type": "npc", "placer_id": uid},
            {"_id": 1},
        )
        if not hit:
            continue
        status = row.get("status")
        found_raw = row.get("found_at")
        found_at = None
        if found_raw:
            try:
                found_at = datetime.fromisoformat(str(found_raw).replace("Z", "+00:00"))
                if found_at.tzinfo is None:
                    found_at = found_at.replace(tzinfo=timezone.utc)
            except Exception:
                found_at = None
        if status == "searching" and found_at and now >= found_at:
            location = _hunt_location_when_search_timer_fires(target, row)
            await db.attacks.update_one({"id": row["id"]}, {"$set": {"status": "found", "location_state": location}})
            row["status"] = "found"
            row["location_state"] = location
        if row.get("status") == "found" and (row.get("location_state") or "") == (user.get("current_state") or ""):
            ready.append((row, target))
    if ready:
        if remaining is not None:
            ready = ready[:remaining]
        costs = []
        for row, target in ready:
            try:
                shot = await compute_bullets_required(user, target)
                costs.append((row, int(shot["bullets_required"])))
            except HTTPException:
                continue
        needed = sum(c for _, c in costs)
        have = int(user.get("bullets") or 0)
        if needed > have:
            if not user.get("auto_rank_events_buy_bullets"):
                return False
            try:
                await _buy_bullets(user, needed - have)
            except HTTPException:
                return False
            fresh = await db.users.find_one({"id": uid}, {"_id": 0, "bullets": 1, "current_state": 1}) or {}
            user = {**user, "bullets": int(fresh.get("bullets") or 0), "current_state": fresh.get("current_state") or user.get("current_state")}
        shot_any = False
        token = _AUTO_RANK_ATTACK.set(True)
        try:
            for row, cost in costs:
                if int(user.get("bullets") or 0) < cost:
                    break
                req = _internal_request()
                body = AttackExecuteRequest(attack_id=row["id"], bullets_to_use=cost, use_molotovs=False)
                try:
                    out = await execute_attack(body, req, user)
                except HTTPException:
                    continue
                if getattr(out, "success", False):
                    shot_any = True
                    user["bullets"] = int(user.get("bullets") or 0) - cost
        finally:
            _AUTO_RANK_ATTACK.reset(token)
        return shot_any
    if any(r.get("status") in ("searching", "found") for r in rows):
        # Searches are still running, or found NPCs are in another city. Travel once if one is found elsewhere.
        for row in rows:
            if row.get("status") == "found" and row.get("location_state") and row.get("location_state") != user.get("current_state"):
                return await _travel_to(user, row.get("location_state"))
        return False
    cap = await _hitlist_npc_max_per_window_for_user(user)
    active = await _hitlist_npc_active_on_board_count(uid)
    free = max(0, cap - active)
    if remaining is not None:
        free = min(free, remaining)
    if free <= 0:
        return False
    added = 0
    for _ in range(free):
        try:
            await hitlist_add_npc(user)
            added += 1
        except HTTPException:
            break
    return added > 0


def _internal_request():
    from starlette.requests import Request

    scope = {
        "type": "http",
        "asgi": {"spec_version": "2.3", "version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/attack/execute",
        "raw_path": b"/api/attack/execute",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 0),
        "server": ("127.0.0.1", 80),
    }

    async def receive():
        return {"type": "http.request", "body": b"{}", "more_body": False}

    return Request(scope, receive)


async def note_contest_payouts(db, type_id: str, name: str, rankings: List[dict]) -> None:
    paid = [r for r in rankings if r.get("prize_label") and r.get("user_id")]
    if not paid:
        return
    uids = [r["user_id"] for r in paid]
    by_id = {r["user_id"]: r for r in paid}
    cursor = db.users.find(
        {"id": {"$in": uids}},
        {"_id": 0, "id": 1, "auto_rank_events_unlocked": 1, "auto_rank_enabled": 1, "auto_rank_event_ids": 1},
    )
    async for u in cursor:
        if not u.get("auto_rank_events_unlocked") or not u.get("auto_rank_enabled"):
            continue
        if type_id not in _event_ids(u):
            continue
        row = by_id.get(u["id"]) or {}
        entry = {
            "at": _now_iso(),
            "type_id": type_id,
            "name": name,
            "place": int(row.get("rank") or 0),
            "prize_label": row.get("prize_label") or "",
        }
        await db.users.update_one(
            {"id": u["id"]},
            {"$push": {"auto_rank_event_rewards": {"$each": [entry], "$slice": -20}}},
        )


def public_manager_fields(user: dict, live: Optional[Dict[str, str]] = None) -> dict:
    ids = _event_ids(user)
    rewards = user.get("auto_rank_event_rewards") if isinstance(user.get("auto_rank_event_rewards"), list) else []
    missions = user.get("auto_rank_mission_rewards") if isinstance(user.get("auto_rank_mission_rewards"), list) else []
    live = live or {}
    live_type = live.get("type_id") or ""
    return {
        "auto_rank_events_unlocked": bool(user.get("auto_rank_events_unlocked")),
        "auto_rank_event_ids": ids,
        "auto_rank_missions_enabled": bool(user.get("auto_rank_missions_enabled")),
        "auto_rank_events_buy_bullets": bool(user.get("auto_rank_events_buy_bullets")),
        "auto_rank_events_cost": AUTO_EVENTS_COST_POINTS,
        "auto_rank_live_event_id": live_type,
        "auto_rank_live_event_name": live.get("name") or "",
        "auto_rank_event_rewards": list(reversed(rewards[-20:])),
        "auto_rank_mission_rewards": list(reversed(missions[-20:])),
    }
