# Missions: 2D map progression, stat-based and character-linked missions (1920s–30s mafia)
from fastapi import Depends, HTTPException, Body
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import logging
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import (
    db,
    get_current_user,
    get_rank_info,
    user_prestige_rank_mult,
    get_prestige_bonus,
    log_respect_earned,
    log_activity,
    maybe_process_rank_up,
    send_notification,
    STATES,
    RANKS,
    CARS,
    founding_member_income_mult,
)
from routers.money.booze_run import BOOZE_TYPES
from routers.kill.armoury import TOKEN_CONFIG
from utils.missions_extended import (
    build_missions,
    MISSION_RANDOM_TOKEN_TYPES,
    TOTAL_TRIBUTE_LOOT_BOX_PIECES_DAILY,
)
from utils.mission_loot_daily import daily_loot_for_completed_ids, ensure_mission_loot_daily_backfill
from utils.mission_rp_backfill import (
    MISSION_RP_BACKFILL_FLAG,
    compute_mission_rp_backfill_credit,
)
from pymongo.errors import DuplicateKeyError
import random

from utils.game_pass_season_rp import apply_season_rp_mirror_to_update, rank_points_in_update
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_MISSIONS
from utils.booze_intake_gate import booze_intake_blocked


async def _missions_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_MISSIONS)


_missions_rl_u = [Depends(_missions_sustained_rl_user)]

# Single first mission: no districts/cities
FIRST_MISSION_ID = "m_first"
SECOND_MISSION_ID = "m_second"
THIRD_MISSION_ID = "m_third"
FOURTH_MISSION_ID = "m_fourth"
CITY_ORDER = ["Start"]  # single "city" for list/map compatibility

# Daily tribute deposit: hour (0–23) in UTC when tribute enters the bank each day (e.g. territory cut).
# Mission completion rewards still add to tribute_bank immediately; this is for daily scheduled deposit.
TRIBUTE_DEPOSIT_UTC_HOUR = int(os.environ.get("TRIBUTE_DEPOSIT_UTC_HOUR", "17"))  # 5 PM UTC default
# Amount (cash) added to each user's tribute_bank once per day at that hour. Configurable via env.
DAILY_TRIBUTE_AMOUNT = int(os.environ.get("DAILY_TRIBUTE_AMOUNT", "500"))
TRIBUTE_DEPOSIT_CONFIG_ID = "tribute_deposit"


def _next_tribute_deposit_utc(deposit_utc_hour: Optional[int] = None):
    """Next occurrence of deposit hour (UTC). Returns (next_iso, daily_time_label e.g. '5:00 PM UTC'). Uses deposit_utc_hour if provided, else TRIBUTE_DEPOSIT_UTC_HOUR env."""
    now = datetime.now(timezone.utc)
    h = (int(deposit_utc_hour) if deposit_utc_hour is not None else TRIBUTE_DEPOSIT_UTC_HOUR) % 24
    today_at = now.replace(hour=h, minute=0, second=0, microsecond=0)
    if now >= today_at:
        next_at = today_at + timedelta(days=1)
    else:
        next_at = today_at
    am_pm = "PM" if h >= 12 else "AM"
    hour12 = h % 12 or 12
    time_label = f"{hour12}:00 {am_pm} UTC"
    return next_at.isoformat(), time_label

# ─────────────────────────────────────────────────────────────────────────────
# MISSION DEFINITIONS (100 missions): built at EOF via build_missions() to avoid
# circular import (server imports this module before it finishes loading).
# ─────────────────────────────────────────────────────────────────────────────

MISSIONS: List[Dict[str, Any]] = []
MISSION_ID_TO_TITLE: Dict[str, str] = {}

# ─────────────────────────────────────────────────────────────────────────────
# CHARACTERS
# ─────────────────────────────────────────────────────────────────────────────

MISSION_CHARACTERS = []


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _car_display_name(car_id: str) -> str:
    if not isinstance(car_id, str) or not car_id:
        return car_id or ""
    c = next((x for x in CARS if x.get("id") == car_id), None)
    return (c.get("name") or car_id) if c else car_id


def _user_unlocked_cities(user: dict) -> List[str]:
    """Single first mission: no city progression."""
    return ["Start"]


def _user_completed_mission_ids(user: dict) -> set:
    comp = user.get("mission_completions") or []
    return {x.get("mission_id") for x in comp if x.get("mission_id")}


def _previous_mission(mission: dict):
    """Mission in same city with highest order still less than this one, or None."""
    city = mission.get("city")
    order = mission.get("order", 0)
    candidates = [m for m in MISSIONS if m.get("city") == city and m.get("order", 0) < order]
    if not candidates:
        return None
    return max(candidates, key=lambda m: m.get("order", 0))


def _next_mission_same_city(mission: dict):
    """Next mission in same city (higher order), or None."""
    city = mission.get("city")
    order = mission.get("order", 0)
    candidates = [m for m in MISSIONS if m.get("city") == city and m.get("order", 0) > order]
    if not candidates:
        return None
    return min(candidates, key=lambda m: m.get("order", 0))


def _stat_requirement_keys(mission: dict) -> List[str]:
    """Requirement keys that map to cumulative user stats (not location / meta)."""
    return [
        k
        for k in (mission.get("requirements") or {})
        if k not in ("in_state", "complete_missions")
    ]


def _baseline_snapshot_for_mission(user: dict, mission: dict) -> Dict[str, int]:
    """Snapshot current stat totals when a mission unlocks (progress counts only new activity)."""
    return {k: _get_user_progress_value(user, k) for k in _stat_requirement_keys(mission)}


# Mid-ladder / new dealership ledgers: missing baseline key → 0 so lifetime buys count.
_DEALERSHIP_MISSION_LEDGER_KEYS = frozenset({
    "cars_purchased_dealership",
    "cars_purchased_dealership_uncommon",
    "cars_purchased_dealership_rare",
    "cars_purchased_dealership_ultra_rare",
    "cars_purchased_dealership_legendary",
})


async def _ensure_extended_mission_baselines(user: dict) -> None:
    """Persist mission_baselines.<id> for unlocked missions (lazy backfill / first visit).

    Also merges newly-added requirement keys into existing snaps. Without that, a missing key
    falls back to ``total`` on every request and progress stays stuck at 0 forever.
    """
    completed = _user_completed_mission_ids(user)
    uid = user.get("id")
    if not uid:
        return
    mb = user.get("mission_baselines") or {}
    to_set: Dict[str, Dict[str, int]] = {}
    for m in MISSIONS:
        mid = m["id"]
        if mid in completed:
            continue
        if not _mission_unlocked_by_previous(m, completed):
            continue
        if mid == FIRST_MISSION_ID:
            continue
        needed_all = _stat_requirement_keys(m)
        # m2/m3 keep flat baselines for classic stats; only store dealership keys in mission_baselines.
        if mid in (SECOND_MISSION_ID, THIRD_MISSION_ID):
            needed = [k for k in needed_all if k.startswith("cars_purchased_dealership")]
        else:
            needed = needed_all
        if not needed:
            continue
        existing = mb.get(mid)
        if not existing:
            if mid in (SECOND_MISSION_ID, THIRD_MISSION_ID):
                snap = {}
                for k in needed:
                    snap[k] = 0 if k in _DEALERSHIP_MISSION_LEDGER_KEYS else _get_user_progress_value(user, k)
            else:
                snap = _baseline_snapshot_for_mission(user, m)
            if snap:
                to_set[mid] = snap
            continue
        # Existing snap — fill any new requirement keys that were added after unlock.
        snap = dict(existing)
        changed = False
        for k in needed:
            if k in snap:
                continue
            if k in _DEALERSHIP_MISSION_LEDGER_KEYS:
                snap[k] = 0
            else:
                snap[k] = _get_user_progress_value(user, k)
            changed = True
        if changed:
            to_set[mid] = snap
    if not to_set:
        return
    set_payload = {f"mission_baselines.{mid}": snap for mid, snap in to_set.items()}
    await db.users.update_one({"id": uid}, {"$set": set_payload})
    user.setdefault("mission_baselines", {})
    user["mission_baselines"].update(to_set)


def _mission_unlocked_by_previous(mission: dict, completed_ids: set) -> bool:
    """True if this mission is unlocked by progression (previous mission in same city completed)."""
    prev = _previous_mission(mission)
    return prev is None or prev["id"] in completed_ids


def _current_open_mission(user: dict) -> Optional[dict]:
    """First unlocked incomplete mission (same priority as Missions UI current)."""
    completed = _user_completed_mission_ids(user)
    unlocked_cities = set(_user_unlocked_cities(user) or [])
    candidates: List[dict] = []
    for m in MISSIONS:
        if m["id"] in completed:
            continue
        if m.get("city") not in unlocked_cities:
            continue
        if not _mission_unlocked_by_previous(m, completed):
            continue
        candidates.append(m)
    if not candidates:
        return None
    candidates.sort(
        key=lambda x: (
            CITY_ORDER.index(x["city"]) if x.get("city") in CITY_ORDER else 999,
            1 if x.get("is_boss") else 0,
            int(x.get("order") or 0),
        )
    )
    return candidates[0]


def _get_user_progress_value(user: dict, req_key: str) -> int:
    """
    Map a requirement key to the user's current stat value.
    NOTE: money_earned uses total_money_earned (cumulative), NOT current balance.
    This prevents earn-type missions from becoming impossible if the player spends money.
    """
    if req_key == "crimes":
        return int(user.get("total_crimes") or 0)
    if req_key == "crime_profit":
        return int(user.get("crime_profit") or 0)
    if req_key == "attacks":
        # Missions include NPC targets: total_kills (players + robot bodyguards) + hitlist NPC kills.
        try:
            tk = int(user.get("total_kills") or 0)
            hn = int(user.get("hitlist_npc_kills") or 0)
        except (TypeError, ValueError):
            return 0
        return max(0, tk + hn)
    if req_key == "hitlist_npc_kills":
        return int(user.get("hitlist_npc_kills") or 0)
    if req_key == "money_earned":
        # cumulative total — never goes down
        return int(user.get("total_money_earned") or 0)
    if req_key == "gta":
        return int(user.get("total_gta") or 0)
    if req_key == "jail_busts":
        return int(user.get("jail_busts") or 0)
    if req_key == "jail_busts_npc":
        return int(user.get("jail_busts_npc") or 0)
    if req_key == "rank_id":
        rp = int(user.get("rank_points") or 0)
        mult = float(user.get("prestige_rank_multiplier") or 1.0)
        rid, _ = get_rank_info(rp, mult)
        return rid
    if req_key == "booze_sells":
        return int(user.get("booze_runs_count") or 0)
    if req_key == "snitch_count":
        return int(user.get("snitch_count") or 0)
    if req_key == "cars_melted":
        return int(user.get("cars_melted") or 0)
    if req_key == "cars_purchased_dealership":
        return int(user.get("cars_purchased_from_dealership") or 0)
    if req_key.startswith("cars_purchased_dealership_"):
        return int(user.get(req_key) or 0)
    if req_key == "bullets_melted":
        return int(user.get("bullets_melted") or 0)
    if req_key == "bullets_purchased_armoury":
        return int(user.get("bullets_purchased_from_armoury") or 0)
    if req_key == "uncommon_cars_scrapped":
        return int(user.get("uncommon_cars_scrapped") or 0)
    if req_key == "uncommon_cars_stolen":
        return int(user.get("uncommon_cars_stolen") or 0)
    if req_key == "deposit_interest":
        return int(user.get("total_interest_deposited") or 0)
    return 0


def _check_mission_requirements(user: dict, mission: dict) -> tuple[bool, Dict[str, Any]]:
    """Return (met: bool, progress: dict with current/target/description)."""
    req = dict(mission.get("requirements") or {})
    try:
        from utils.loot_reclaimable_passives import BUFF_MISSION_REQ, get_reclaimable_passive_mults_from_user

        rmult = float(get_reclaimable_passive_mults_from_user(user).get(BUFF_MISSION_REQ) or 1.0)
        if rmult < 0.999:
            eased = {}
            for k, v in req.items():
                if k in ("in_state", "complete_missions") or isinstance(v, (str, list, bool)):
                    eased[k] = v
                elif isinstance(v, (int, float)):
                    eased[k] = max(1, int(round(int(v) * rmult)))
                else:
                    eased[k] = v
            req = eased
    except Exception:
        pass
    comp = _user_completed_mission_ids(user)
    progress = {}

    if "complete_missions" in req:
        needed_list = list(req["complete_missions"])
        needed = set(needed_list)
        done = comp & needed
        min_count = req.get("complete_missions_min_count")
        if min_count is not None:
            met = len(done) >= int(min_count)
            progress["target"] = int(min_count)
        else:
            met = needed <= done
            progress["target"] = len(needed)
        progress["current"] = len(done)
        missing = [MISSION_ID_TO_TITLE.get(mid, mid) for mid in needed_list if mid not in done]
        if missing:
            shown = missing[:3]
            more = len(missing) - 3
            need_n = progress["target"] - len(done)
            progress["description"] = (
                f"Complete {need_n:,} more: "
                + ", ".join(shown)
                + (f"… +{more:,} more" if more > 0 else "")
            )
        else:
            progress["description"] = f"{len(done):,}/{progress['target']:,} missions complete"
        return met, progress

    # Multiple simple requirements: all must be met (e.g. crimes + jail_busts_npc + in_state)
    met_count = 0
    parts = []
    for key, target in req.items():
        if key == "in_state":
            met = (user.get("current_state") or "").strip() == target
            if met:
                met_count += 1
            parts.append(f"Be in {target}: done" if met else f"Be in {target}: travel there")
            continue
        if key == "crimes" and mission.get("id") == FIRST_MISSION_ID:
            total = int(user.get("total_crimes") or 0)
            baseline = user.get("mission_1_crimes_baseline")
            if baseline is None:
                baseline = total
            current = max(0, total - baseline)
        elif key == "crimes" and mission.get("id") == SECOND_MISSION_ID:
            total = int(user.get("total_crimes") or 0)
            baseline = user.get("mission_2_crimes_baseline")
            if baseline is None:
                baseline = total
            current = max(0, total - baseline)
        elif key == "jail_busts" and mission.get("id") == SECOND_MISSION_ID:
            total = int(user.get("jail_busts") or 0)
            baseline = user.get("mission_2_jail_busts_baseline")
            if baseline is None:
                baseline = total
            current = max(0, total - baseline)
        elif key == "cars_melted" and mission.get("id") == SECOND_MISSION_ID:
            total = int(user.get("cars_melted") or 0)
            baseline = user.get("mission_2_cars_melted_baseline")
            if baseline is None:
                baseline = total
            current = max(0, total - baseline)
        elif isinstance(key, str) and key.startswith("cars_purchased_dealership"):
            total = _get_user_progress_value(user, key)
            baselines_m = (user.get("mission_baselines") or {}).get(mission.get("id")) or {}
            b = baselines_m.get(key)
            if b is None:
                b = 0 if key in _DEALERSHIP_MISSION_LEDGER_KEYS else total
            current = max(0, total - int(b))
        elif mission.get("id") == THIRD_MISSION_ID and key in (
            "crimes", "jail_busts", "gta", "booze_sells", "bullets_melted",
            "bullets_purchased_armoury", "uncommon_cars_scrapped",
        ):
            total_key = {
                "crimes": "total_crimes",
                "jail_busts": "jail_busts",
                "gta": "total_gta",
                "booze_sells": "booze_runs_count",
                "bullets_melted": "bullets_melted",
                "bullets_purchased_armoury": "bullets_purchased_from_armoury",
                "uncommon_cars_scrapped": "uncommon_cars_scrapped",
            }[key]
            baseline_key = {
                "crimes": "mission_3_crimes_baseline",
                "jail_busts": "mission_3_jail_busts_baseline",
                "gta": "mission_3_gta_baseline",
                "booze_sells": "mission_3_booze_sells_baseline",
                "bullets_melted": "mission_3_bullets_melted_baseline",
                "bullets_purchased_armoury": "mission_3_bullets_purchased_armoury_baseline",
                "uncommon_cars_scrapped": "mission_3_uncommon_cars_scrapped_baseline",
            }[key]
            total = int(user.get(total_key) or 0)
            baseline = user.get(baseline_key)
            if baseline is None:
                baseline = total
            current = max(0, total - baseline)
        elif mission.get("id") not in (FIRST_MISSION_ID, SECOND_MISSION_ID, THIRD_MISSION_ID):
            total = _get_user_progress_value(user, key)
            baselines_m = (user.get("mission_baselines") or {}).get(mission.get("id")) or {}
            b = baselines_m.get(key)
            if b is None:
                b = total
            current = max(0, total - int(b))
        else:
            current = _get_user_progress_value(user, key)
        met = current >= target
        if met:
            met_count += 1
        # Cap displayed progress at target so we show e.g. 200/200 not 202/200
        display = min(current, target)
        if key == "rank_id":
            rank_name = next((r["name"] for r in RANKS if r["id"] == target), str(target))
            parts.append(
                f"Reach {rank_name}: {display:,}/{target:,}" if not met else f"Reach {rank_name}: done"
            )
        elif key == "hitlist_npc_kills":
            parts.append(f"{display:,}/{target:,} hitlist NPC kills")
        elif key == "money_earned":
            parts.append(f"${display:,} / ${target:,} earned")
        elif key == "booze_sells":
            parts.append(f"{display:,}/{target:,} booze runs")
        elif key == "jail_busts":
            parts.append(f"{display:,}/{target:,} jail busts")
        elif key == "jail_busts_npc":
            parts.append(f"Bust 1 NPC from jail: {display:,}/1")
        elif key == "gta":
            parts.append(f"{display:,}/{target:,} cars stolen")
        elif key == "crimes":
            parts.append(f"{display:,}/{target:,} crimes")
        elif key == "crime_profit":
            parts.append(f"${display:,} / ${target:,} crime profit")
        elif key == "snitch_count":
            parts.append(f"Snitch on someone (in jail): {display:,}/{target:,}")
        elif key == "cars_melted":
            parts.append(f"{display:,}/{target:,} cars melted")
        elif key == "cars_purchased_dealership":
            parts.append(f"{display:,}/{target:,} cars from dealership")
        elif key == "cars_purchased_dealership_uncommon":
            parts.append(f"{display:,}/{target:,} uncommon from dealership")
        elif key == "cars_purchased_dealership_rare":
            parts.append(f"{display:,}/{target:,} rare from dealership")
        elif key == "cars_purchased_dealership_ultra_rare":
            parts.append(f"{display:,}/{target:,} ultra rare from dealership")
        elif key == "cars_purchased_dealership_legendary":
            parts.append(f"{display:,}/{target:,} legendary from dealership")
        elif key == "bullets_melted":
            parts.append(f"{display:,}/{target:,} bullets melted")
        elif key == "bullets_purchased_armoury":
            parts.append(f"{display:,}/{target:,} bullets from armoury")
        elif key == "uncommon_cars_scrapped":
            parts.append(f"{display:,}/{target:,} uncommon cars scrapped")
        elif key == "uncommon_cars_stolen":
            parts.append(f"{display:,}/{target:,} uncommon cars stolen")
        elif key == "deposit_interest":
            parts.append(f"${display:,} / ${target:,} to interest bank")
        else:
            parts.append(f"{display:,}/{target:,}")
    progress = {"current": met_count, "target": len(req), "description": " · ".join(parts)}
    return met_count >= len(req), progress


# ─────────────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────────────

async def get_missions(current_user: dict = Depends(get_current_user), city: Optional[str] = None):
    """List missions for unlocked cities with completion status and progress."""
    unlocked = _user_unlocked_cities(current_user)
    completed_ids = _user_completed_mission_ids(current_user)
    # Ensure first mission crimes baseline exists (so crimes count only after mission started)
    if FIRST_MISSION_ID not in completed_ids and current_user.get("mission_1_crimes_baseline") is None:
        baseline = int(current_user.get("total_crimes") or 0)
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"mission_1_crimes_baseline": baseline}})
        current_user["mission_1_crimes_baseline"] = baseline
    # Ensure second mission baselines exist (crimes, jail busts, cars melted count only after mission 2 unlocks)
    if FIRST_MISSION_ID in completed_ids and current_user.get("mission_2_crimes_baseline") is None:
        c_baseline = int(current_user.get("total_crimes") or 0)
        j_baseline = int(current_user.get("jail_busts") or 0)
        melt_baseline = int(current_user.get("cars_melted") or 0)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {
                "mission_2_crimes_baseline": c_baseline,
                "mission_2_jail_busts_baseline": j_baseline,
                "mission_2_cars_melted_baseline": melt_baseline,
                "mission_2_cars_purchased_dealership_baseline": int(current_user.get("cars_purchased_from_dealership") or 0),
            }},
        )
        current_user["mission_2_crimes_baseline"] = c_baseline
        current_user["mission_2_jail_busts_baseline"] = j_baseline
        current_user["mission_2_cars_melted_baseline"] = melt_baseline
        current_user["mission_2_cars_purchased_dealership_baseline"] = int(current_user.get("cars_purchased_from_dealership") or 0)
    elif FIRST_MISSION_ID in completed_ids and current_user.get("mission_2_cars_purchased_dealership_baseline") is None:
        deal_b = int(current_user.get("cars_purchased_from_dealership") or 0)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"mission_2_cars_purchased_dealership_baseline": deal_b}},
        )
        current_user["mission_2_cars_purchased_dealership_baseline"] = deal_b
    # Ensure third mission baselines exist (all counts from when mission 3 unlocks)
    if SECOND_MISSION_ID in completed_ids and current_user.get("mission_3_crimes_baseline") is None:
        m3_set = {
            "mission_3_crimes_baseline": int(current_user.get("total_crimes") or 0),
            "mission_3_jail_busts_baseline": int(current_user.get("jail_busts") or 0),
            "mission_3_gta_baseline": int(current_user.get("total_gta") or 0),
            "mission_3_booze_sells_baseline": int(current_user.get("booze_runs_count") or 0),
            "mission_3_bullets_melted_baseline": int(current_user.get("bullets_melted") or 0),
            "mission_3_bullets_purchased_armoury_baseline": int(current_user.get("bullets_purchased_from_armoury") or 0),
            "mission_3_uncommon_cars_scrapped_baseline": int(current_user.get("uncommon_cars_scrapped") or 0),
            "mission_3_cars_purchased_dealership_baseline": int(current_user.get("cars_purchased_from_dealership") or 0),
        }
        await db.users.update_one({"id": current_user["id"]}, {"$set": m3_set})
        current_user.update(m3_set)
    elif SECOND_MISSION_ID in completed_ids and current_user.get("mission_3_cars_purchased_dealership_baseline") is None:
        deal_b = int(current_user.get("cars_purchased_from_dealership") or 0)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"mission_3_cars_purchased_dealership_baseline": deal_b}},
        )
        current_user["mission_3_cars_purchased_dealership_baseline"] = deal_b
    await _ensure_extended_mission_baselines(current_user)
    current_user = await _maybe_mission_loot_backfill(current_user)
    current_user = await _maybe_mission_rp_backfill(current_user)
    missions_out = []
    for m in MISSIONS:
        if m["city"] not in unlocked:
            continue
        if city and m["city"] != city:
            continue
        met, progress = _check_mission_requirements(current_user, m)
        mission_unlocked = _mission_unlocked_by_previous(m, completed_ids)
        requirements_met_final = met and mission_unlocked
        prev = _previous_mission(m)
        tribute_cash_mult = 1.0
        try:
            from utils.loot_reclaimable_passives import BUFF_TRIBUTE_CASH, get_reclaimable_passive_mults_from_user

            tribute_cash_mult = float(
                get_reclaimable_passive_mults_from_user(current_user).get(BUFF_TRIBUTE_CASH) or 1.0
            )
        except Exception:
            pass
        reward_tribute_daily_out = int(round(int(m.get("reward_tribute_daily") or 0) * tribute_cash_mult))
        reward_tribute_out = int(round(int(m.get("reward_tribute") or 0) * tribute_cash_mult))
        missions_out.append({
            "id": m["id"],
            "city": m["city"],
            "area": m["area"],
            "order": m["order"],
            "type": m["type"],
            "title": m["title"],
            "description": m["description"],
            "reward_money": m.get("reward_money", 0),
            "reward_cash_immediate": m.get("reward_cash_immediate", 0),
            "reward_tribute_daily": reward_tribute_daily_out,
            "reward_respect_daily": m.get("reward_respect_daily", 0),
            "reward_points": m.get("reward_points", 0),
            "reward_respect": m.get("reward_respect", 0),
            "reward_tribute": reward_tribute_out,
            "reward_car_id": m.get("reward_car_id"),
            "reward_car_ids": m.get("reward_car_ids") or [],
            "reward_booze": m.get("reward_booze"),
            "reward_bullets": m.get("reward_bullets", 0),
            "reward_tribute_bullets_daily": m.get("reward_tribute_bullets_daily", 0),
            "reward_tribute_loot_box_pieces_daily": m.get("reward_tribute_loot_box_pieces_daily", 0),
            "reward_tribute_auto_rank_2h_daily": m.get("reward_tribute_auto_rank_2h_daily", 0),
            "reward_loot_box_pieces": m.get("reward_loot_box_pieces", 0),
            "reward_auto_rank_2h": m.get("reward_auto_rank_2h", 0),
            "unlocks_city": m.get("unlocks_city"),
            "character_id": m.get("character_id"),
            "difficulty": m.get("difficulty", 5),
            "is_boss": m.get("is_boss", False),
            "completed": m["id"] in completed_ids,
            "unlocked": mission_unlocked,
            "previous_mission_title": prev.get("title") if prev and not mission_unlocked else None,
            "requirements_met": requirements_met_final,
            "progress": progress,
        })
    missions_out.sort(key=lambda x: (CITY_ORDER.index(x["city"]) if x["city"] in CITY_ORDER else 999, 1 if x.get("is_boss") else 0, x["order"]))
    # Send inbox notification once: "Prove yourself" mission offer (if not yet completed and not yet sent)
    completed_ids = _user_completed_mission_ids(current_user)
    if FIRST_MISSION_ID not in completed_ids and not current_user.get("first_mission_notification_sent"):
        m_first = MISSION_BY_ID.get(FIRST_MISSION_ID) or {}
        first_money = int(m_first.get("reward_money") or 0)
        first_rp = int(m_first.get("reward_points") or 0)
        await send_notification(
            current_user["id"],
            "Prove Yourself",
            (
                "The outfit wants to see what you're made of. Commit 15 crimes and bust 1 NPC from jail. "
                f"Reward: ${first_money:,}, 1 common car, and {first_rp:,} rank points. "
                "Check Missions to track progress and claim your reward."
            ),
            "system",
            category="missions",
        )
        baseline = int(current_user.get("total_crimes") or 0)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"first_mission_notification_sent": True, "mission_1_crimes_baseline": baseline}},
        )
    return {"missions": missions_out, "unlocked_cities": unlocked}


async def get_missions_map(current_user: dict = Depends(get_current_user)):
    """Map state: current city, unlocked cities, areas and missions per city (single mission, no districts)."""
    unlocked = _user_unlocked_cities(current_user)
    current_city = "Start"
    completed_ids = _user_completed_mission_ids(current_user)
    if FIRST_MISSION_ID not in completed_ids and current_user.get("mission_1_crimes_baseline") is None:
        baseline = int(current_user.get("total_crimes") or 0)
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"mission_1_crimes_baseline": baseline}})
        current_user["mission_1_crimes_baseline"] = baseline
    if FIRST_MISSION_ID in completed_ids and current_user.get("mission_2_crimes_baseline") is None:
        c_baseline = int(current_user.get("total_crimes") or 0)
        j_baseline = int(current_user.get("jail_busts") or 0)
        melt_baseline = int(current_user.get("cars_melted") or 0)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {
                "mission_2_crimes_baseline": c_baseline,
                "mission_2_jail_busts_baseline": j_baseline,
                "mission_2_cars_melted_baseline": melt_baseline,
                "mission_2_cars_purchased_dealership_baseline": int(current_user.get("cars_purchased_from_dealership") or 0),
            }},
        )
        current_user["mission_2_crimes_baseline"] = c_baseline
        current_user["mission_2_jail_busts_baseline"] = j_baseline
        current_user["mission_2_cars_melted_baseline"] = melt_baseline
        current_user["mission_2_cars_purchased_dealership_baseline"] = int(current_user.get("cars_purchased_from_dealership") or 0)
    elif FIRST_MISSION_ID in completed_ids and current_user.get("mission_2_cars_purchased_dealership_baseline") is None:
        deal_b = int(current_user.get("cars_purchased_from_dealership") or 0)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"mission_2_cars_purchased_dealership_baseline": deal_b}},
        )
        current_user["mission_2_cars_purchased_dealership_baseline"] = deal_b
    if SECOND_MISSION_ID in completed_ids and current_user.get("mission_3_crimes_baseline") is None:
        m3_set = {
            "mission_3_crimes_baseline": int(current_user.get("total_crimes") or 0),
            "mission_3_jail_busts_baseline": int(current_user.get("jail_busts") or 0),
            "mission_3_gta_baseline": int(current_user.get("total_gta") or 0),
            "mission_3_booze_sells_baseline": int(current_user.get("booze_runs_count") or 0),
            "mission_3_bullets_melted_baseline": int(current_user.get("bullets_melted") or 0),
            "mission_3_bullets_purchased_armoury_baseline": int(current_user.get("bullets_purchased_from_armoury") or 0),
            "mission_3_uncommon_cars_scrapped_baseline": int(current_user.get("uncommon_cars_scrapped") or 0),
            "mission_3_cars_purchased_dealership_baseline": int(current_user.get("cars_purchased_from_dealership") or 0),
        }
        await db.users.update_one({"id": current_user["id"]}, {"$set": m3_set})
        current_user.update(m3_set)
    elif SECOND_MISSION_ID in completed_ids and current_user.get("mission_3_cars_purchased_dealership_baseline") is None:
        deal_b = int(current_user.get("cars_purchased_from_dealership") or 0)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"mission_3_cars_purchased_dealership_baseline": deal_b}},
        )
        current_user["mission_3_cars_purchased_dealership_baseline"] = deal_b
    await _ensure_extended_mission_baselines(current_user)
    current_user = await _maybe_mission_loot_backfill(current_user)
    current_user = await _maybe_mission_rp_backfill(current_user)
    by_city = {}
    for m in MISSIONS:
        if m["city"] not in unlocked:
            continue
        if m["city"] not in by_city:
            by_city[m["city"]] = {"areas": {}, "missions": []}
        area = m.get("area") or "—"
        if area not in by_city[m["city"]]["areas"]:
            by_city[m["city"]]["areas"][area] = []
        met, progress = _check_mission_requirements(current_user, m)
        mission_unlocked = _mission_unlocked_by_previous(m, completed_ids)
        requirements_met_final = met and mission_unlocked
        prev = _previous_mission(m)
        tribute_cash_mult = 1.0
        try:
            from utils.loot_reclaimable_passives import BUFF_TRIBUTE_CASH, get_reclaimable_passive_mults_from_user

            tribute_cash_mult = float(
                get_reclaimable_passive_mults_from_user(current_user).get(BUFF_TRIBUTE_CASH) or 1.0
            )
        except Exception:
            pass
        entry = {
            "id": m["id"],
            "area": m["area"],
            "order": m["order"],
            "type": m["type"],
            "title": m["title"],
            "description": m["description"],
            "reward_money": m.get("reward_money", 0),
            "reward_cash_immediate": m.get("reward_cash_immediate", 0),
            "reward_tribute_daily": int(round(int(m.get("reward_tribute_daily") or 0) * tribute_cash_mult)),
            "reward_respect_daily": m.get("reward_respect_daily", 0),
            "reward_points": m.get("reward_points", 0),
            "reward_respect": m.get("reward_respect", 0),
            "reward_tribute": int(round(int(m.get("reward_tribute") or 0) * tribute_cash_mult)),
            "reward_car_id": m.get("reward_car_id"),
            "reward_car_ids": m.get("reward_car_ids") or [],
            "reward_booze": m.get("reward_booze"),
            "reward_bullets": m.get("reward_bullets", 0),
            "reward_tribute_bullets_daily": m.get("reward_tribute_bullets_daily", 0),
            "reward_tribute_loot_box_pieces_daily": m.get("reward_tribute_loot_box_pieces_daily", 0),
            "reward_tribute_auto_rank_2h_daily": m.get("reward_tribute_auto_rank_2h_daily", 0),
            "reward_loot_box_pieces": m.get("reward_loot_box_pieces", 0),
            "reward_auto_rank_2h": m.get("reward_auto_rank_2h", 0),
            "unlocks_city": m.get("unlocks_city"),
            "character_id": m.get("character_id"),
            "difficulty": m.get("difficulty", 5),
            "is_boss": m.get("is_boss", False),
            "completed": m["id"] in completed_ids,
            "unlocked": mission_unlocked,
            "previous_mission_title": prev.get("title") if prev and not mission_unlocked else None,
            "requirements_met": requirements_met_final,
            "progress": progress,
        }
        by_city[m["city"]]["areas"][area].append(entry)
        by_city[m["city"]]["missions"].append(entry)
    for c in by_city:
        for area in by_city[c]["areas"]:
            by_city[c]["areas"][area].sort(key=lambda x: (1 if x.get("is_boss") else 0, x["order"]))
    tribute_bank = int(current_user.get("tribute_bank") or 0)
    tribute_bullets = int(current_user.get("tribute_bullets") or 0)
    tribute_loot_box_pieces = int(current_user.get("tribute_loot_box_pieces") or 0)
    tribute_respect = int(current_user.get("tribute_respect") or 0)
    tribute_doc = await db.game_config.find_one({"id": TRIBUTE_DEPOSIT_CONFIG_ID}, {"_id": 0, "deposit_utc_hour": 1})
    deposit_hour = int(tribute_doc.get("deposit_utc_hour") or TRIBUTE_DEPOSIT_UTC_HOUR) % 24 if tribute_doc else TRIBUTE_DEPOSIT_UTC_HOUR
    next_deposit_iso, deposit_time_label = _next_tribute_deposit_utc(deposit_hour)
    has_mission_1 = FIRST_MISSION_ID in completed_ids
    has_mission_2 = SECOND_MISSION_ID in completed_ids
    has_mission_3 = THIRD_MISSION_ID in completed_ids
    has_mission_4 = FOURTH_MISSION_ID in completed_ids
    # Totals mirror run_daily_tribute_deposit for this user (all completed missions, not just m1–m4).
    daily_tokens_total = 0
    daily_auto_rank_2h_tokens_total = 0
    daily_cash_total = DAILY_TRIBUTE_AMOUNT
    daily_bullets_total = 0
    daily_respect_total = 0
    daily_loot_total = _daily_tribute_loot_for_completed(completed_ids)
    for mid in completed_ids:
        m = next((x for x in MISSIONS if x["id"] == mid), None)
        if not m:
            continue
        daily_tokens_total += int(m.get("reward_tribute_tokens_daily") or 0)
        daily_auto_rank_2h_tokens_total += int(m.get("reward_tribute_auto_rank_2h_daily") or 0)
        daily_cash_total += int(m.get("reward_tribute_daily") or 0)
        daily_bullets_total += int(m.get("reward_tribute_bullets_daily") or 0)
        daily_respect_total += int(m.get("reward_respect_daily") or 0)
    tribute_tokens = int(current_user.get("tribute_tokens") or 0)
    return {
        "current_city": current_city,
        "unlocked_cities": unlocked,
        "cities": list(unlocked),
        "by_city": by_city,
        "tribute_bank": tribute_bank,
        "tribute_bullets": tribute_bullets,
        "tribute_loot_box_pieces": tribute_loot_box_pieces,
        "tribute_respect": tribute_respect,
        "tribute_tokens": tribute_tokens,
        "tribute_deposit_daily_at": deposit_time_label,
        "next_tribute_deposit_at": next_deposit_iso,
        "daily_tribute_cash_base": DAILY_TRIBUTE_AMOUNT,
        "daily_tribute_loot_box_pieces_base": DAILY_TRIBUTE_LOOT_BOX_PIECES,
        "daily_tribute_loot_box_pieces_ladder_max": TOTAL_TRIBUTE_LOOT_BOX_PIECES_DAILY,
        "daily_tribute_cash_total": daily_cash_total,
        "daily_tribute_bullets_total": daily_bullets_total,
        "daily_tribute_respect_total": daily_respect_total,
        "daily_tribute_loot_box_pieces_total": daily_loot_total,
        "daily_tribute_tokens_total": daily_tokens_total,
        "daily_tribute_auto_rank_2h_tokens_total": daily_auto_rank_2h_tokens_total,
        "completed_it_daily_tokens_perk": bool(current_user.get("completed_it_daily_tokens")),
        "has_mission_1_bonus": has_mission_1,
        "daily_tribute_cash_mission1": MISSION_1_DAILY_CASH,
        "daily_tribute_bullets_mission1": MISSION_1_DAILY_BULLETS,
        "daily_respect_mission1": MISSION_1_DAILY_RESPECT,
        "has_mission_2_bonus": has_mission_2,
        "daily_tribute_cash_mission2": MISSION_2_DAILY_CASH,
        "daily_tribute_bullets_mission2": MISSION_2_DAILY_BULLETS,
        "daily_respect_mission2": MISSION_2_DAILY_RESPECT,
        "daily_tribute_loot_box_pieces_mission2": MISSION_2_DAILY_LOOT_BOX_PIECES,
        "has_mission_3_bonus": has_mission_3,
        "daily_tribute_cash_mission3": MISSION_3_DAILY_CASH,
        "daily_tribute_bullets_mission3": MISSION_3_DAILY_BULLETS,
        "daily_respect_mission3": MISSION_3_DAILY_RESPECT,
        "has_mission_4_bonus": has_mission_4,
        "daily_tribute_cash_mission4": MISSION_4_DAILY_CASH,
        "daily_tribute_bullets_mission4": MISSION_4_DAILY_BULLETS,
        "daily_respect_mission4": MISSION_4_DAILY_RESPECT,
    }


class CompleteMissionRequest(BaseModel):
    mission_id: str


def _mission_completion_reward_mult(current_user: dict) -> float:
    from server import rank_xp_pass_multiplier

    return (
        float(get_prestige_bonus(current_user).get("mission_reward_mult") or 1.0)
        * founding_member_income_mult(current_user)
        * float(rank_xp_pass_multiplier(current_user))
    )


def _build_mission_completion_reward_update(
    current_user: dict,
    mission_id: str,
    mission: dict,
    mult: float,
    *,
    include_mission_completion_push: bool,
    include_next_mission_baseline: bool,
) -> tuple[dict, dict]:
    reward_money = int((mission.get("reward_money") or 0) * mult)
    reward_cash_immediate = int((mission.get("reward_cash_immediate") or 0) * mult)
    reward_points = int((mission.get("reward_points") or 0) * mult)
    reward_respect = int((mission.get("reward_respect") or 0) * mult)
    reward_tribute = int((mission.get("reward_tribute") or 0) * mult)
    try:
        from utils.loot_reclaimable_passives import BUFF_TRIBUTE_CASH, get_reclaimable_passive_mults_from_user

        reward_tribute = int(
            round(
                reward_tribute
                * float(get_reclaimable_passive_mults_from_user(current_user).get(BUFF_TRIBUTE_CASH) or 1.0)
            )
        )
    except Exception:
        pass
    reward_car_id = (mission.get("reward_car_id") or "").strip() or None
    reward_car_ids = mission.get("reward_car_ids") or []
    reward_booze = mission.get("reward_booze")
    reward_bullets = int((mission.get("reward_bullets") or 0) * mult)
    reward_loot_box_pieces = int((mission.get("reward_loot_box_pieces") or 0) * mult)
    reward_auto_rank_2h = int(mission.get("reward_auto_rank_2h") or 0)
    reward_token = mission.get("reward_token")
    unlocks_city = mission.get("unlocks_city")

    tribute_bank_inc = reward_money + reward_tribute

    update: Dict[str, Any] = {}
    if include_mission_completion_push:
        completion_doc = {"mission_id": mission_id, "completed_at": datetime.now(timezone.utc).isoformat()}
        update["$push"] = {"mission_completions": completion_doc}
    if include_next_mission_baseline:
        nxt = _next_mission_same_city(mission)
        if nxt and nxt["id"] not in (FIRST_MISSION_ID, SECOND_MISSION_ID, THIRD_MISSION_ID):
            snap = _baseline_snapshot_for_mission(current_user, nxt)
            if snap:
                update.setdefault("$set", {})[f"mission_baselines.{nxt['id']}"] = snap
    if mission_id == FIRST_MISSION_ID:
        update.setdefault("$set", {})["mission_2_crimes_baseline"] = int(current_user.get("total_crimes") or 0)
        update.setdefault("$set", {})["mission_2_jail_busts_baseline"] = int(current_user.get("jail_busts") or 0)
        update.setdefault("$set", {})["mission_2_cars_melted_baseline"] = int(current_user.get("cars_melted") or 0)
        update.setdefault("$set", {})["mission_2_cars_purchased_dealership_baseline"] = int(current_user.get("cars_purchased_from_dealership") or 0)
    if mission_id == SECOND_MISSION_ID:
        update.setdefault("$set", {})["mission_3_crimes_baseline"] = int(current_user.get("total_crimes") or 0)
        update.setdefault("$set", {})["mission_3_jail_busts_baseline"] = int(current_user.get("jail_busts") or 0)
        update.setdefault("$set", {})["mission_3_gta_baseline"] = int(current_user.get("total_gta") or 0)
        update.setdefault("$set", {})["mission_3_booze_sells_baseline"] = int(current_user.get("booze_runs_count") or 0)
        update.setdefault("$set", {})["mission_3_bullets_melted_baseline"] = int(current_user.get("bullets_melted") or 0)
        update.setdefault("$set", {})["mission_3_bullets_purchased_armoury_baseline"] = int(current_user.get("bullets_purchased_from_armoury") or 0)
        update.setdefault("$set", {})["mission_3_uncommon_cars_scrapped_baseline"] = int(current_user.get("uncommon_cars_scrapped") or 0)
        update.setdefault("$set", {})["mission_3_cars_purchased_dealership_baseline"] = int(current_user.get("cars_purchased_from_dealership") or 0)
    if tribute_bank_inc:
        update.setdefault("$inc", {})["tribute_bank"] = tribute_bank_inc
    if reward_respect:
        update.setdefault("$inc", {})["respect_points"] = reward_respect
    if reward_cash_immediate:
        update.setdefault("$inc", {})["money"] = reward_cash_immediate
    if reward_points:
        update.setdefault("$inc", {})["rank_points"] = reward_points
    if reward_bullets:
        update.setdefault("$inc", {})["bullets"] = reward_bullets
    if reward_loot_box_pieces:
        update.setdefault("$inc", {})["tribute_loot_box_pieces"] = reward_loot_box_pieces
    if reward_auto_rank_2h:
        update.setdefault("$inc", {})["auto_rank_2h_tokens"] = reward_auto_rank_2h
    if isinstance(reward_booze, dict) and reward_booze and not booze_intake_blocked(current_user):
        booze_ids = [b["id"] for b in BOOZE_TYPES]
        for bid, amt in reward_booze.items():
            if bid in booze_ids and amt and int(amt) > 0:
                update.setdefault("$inc", {})[f"booze_carrying.{bid}"] = int(amt)
                update.setdefault("$set", {})[f"booze_carrying_cost.{bid}"] = 0
    token_awarded = None
    tokens_awarded_list: List[str] = []
    if reward_token:
        inc_tok = update.setdefault("$inc", {})
        if reward_token == "random":
            for _ in range(2):
                tt = random.choice(MISSION_RANDOM_TOKEN_TYPES)
                tokens_awarded_list.append(tt)
                k = TOKEN_CONFIG[tt]["count_field"]
                inc_tok[k] = inc_tok.get(k, 0) + 1
            token_awarded = tokens_awarded_list[0] if tokens_awarded_list else None
        elif reward_token in MISSION_RANDOM_TOKEN_TYPES:
            token_awarded = reward_token
            token_field = TOKEN_CONFIG[token_awarded]["count_field"]
            inc_tok[token_field] = inc_tok.get(token_field, 0) + 1
    if unlocks_city:
        update.setdefault("$set", {})["unlocked_maps_up_to"] = unlocks_city

    granted_car_ids: List[str] = []
    if reward_car_id:
        granted_car_ids.append(reward_car_id)
    for cid in reward_car_ids:
        if isinstance(cid, str) and cid and cid not in granted_car_ids:
            granted_car_ids.append(cid)

    meta = {
        "reward_money": reward_money,
        "reward_cash_immediate": reward_cash_immediate,
        "reward_points": reward_points,
        "reward_respect": reward_respect,
        "reward_tribute": reward_tribute,
        "reward_car_id": reward_car_id,
        "reward_car_ids": reward_car_ids,
        "reward_booze": reward_booze if isinstance(reward_booze, dict) else None,
        "reward_bullets": reward_bullets,
        "reward_loot_box_pieces": reward_loot_box_pieces,
        "reward_auto_rank_2h": reward_auto_rank_2h,
        "unlocks_city": unlocks_city,
        "token_awarded": token_awarded,
        "tokens_awarded_list": tokens_awarded_list,
        "granted_car_ids": granted_car_ids,
    }
    return update, meta


async def _run_mission_completion_side_effects(
    user_id: str,
    current_user: dict,
    mission_id: str,
    meta: dict,
    *,
    rp_awarded: int | None = None,
) -> None:
    reward_respect = int(meta.get("reward_respect") or 0)
    if reward_respect:
        await log_respect_earned(user_id, reward_respect, "missions")

    reward_points = int(rp_awarded if rp_awarded is not None else meta.get("reward_points") or 0)
    try:
        if reward_points:
            rp_before = int(current_user.get("rank_points") or 0)
            await maybe_process_rank_up(
                user_id,
                rp_before,
                reward_points,
                current_user.get("username", ""),
                user_prestige_rank_mult(current_user),
            )
    except Exception:
        pass

    unlocks_city = meta.get("unlocks_city")
    if unlocks_city:
        await send_notification(
            user_id,
            "Missions",
            f"You've unlocked {unlocks_city}. The map is yours.",
            "system",
            category="missions",
        )


async def complete_mission(
    request: CompleteMissionRequest = Body(...),
    current_user: dict = Depends(get_current_user),
):
    """Check requirements and mark mission complete, granting rewards."""
    mission_id = (request.mission_id or "").strip()
    if not mission_id:
        raise HTTPException(status_code=400, detail="mission_id required")
    mission = next((m for m in MISSIONS if m["id"] == mission_id), None)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    unlocked = _user_unlocked_cities(current_user)
    if mission["city"] not in unlocked:
        raise HTTPException(status_code=403, detail="City not unlocked")
    completed_ids = _user_completed_mission_ids(current_user)
    if mission_id in completed_ids:
        raise HTTPException(status_code=400, detail="Mission already completed")
    met, _ = _check_mission_requirements(current_user, mission)
    if not met:
        raise HTTPException(status_code=400, detail="Requirements not met")
    if not _mission_unlocked_by_previous(mission, completed_ids):
        prev = _previous_mission(mission)
        prev_title = prev.get("title", "the previous mission") if prev else "the previous mission"
        raise HTTPException(status_code=400, detail=f"Complete {prev_title} first")

    user_id = current_user["id"]
    mult = _mission_completion_reward_mult(current_user)
    update, meta = _build_mission_completion_reward_update(
        current_user,
        mission_id,
        mission,
        mult,
        include_mission_completion_push=True,
        include_next_mission_baseline=True,
    )
    mission_update = apply_season_rp_mirror_to_update(update, user=current_user)
    result = await db.users.update_one(
        {"id": user_id, "mission_completions.mission_id": {"$ne": mission_id}},
        mission_update,
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Mission already completed")
    await _run_mission_completion_side_effects(
        user_id,
        current_user,
        mission_id,
        meta,
        rp_awarded=rank_points_in_update(mission_update),
    )

    reward_car_names = [_car_display_name(cid) for cid in meta["granted_car_ids"]]

    return {
        "completed": True,
        "mission_id": mission_id,
        "reward_money": meta["reward_money"],
        "reward_cash_immediate": meta["reward_cash_immediate"],
        "reward_points": meta["reward_points"],
        "reward_respect": meta["reward_respect"],
        "reward_tribute": meta["reward_tribute"],
        "reward_car_id": meta["reward_car_id"],
        "reward_car_ids": meta["reward_car_ids"],
        "reward_car_names": reward_car_names,
        "reward_booze": meta["reward_booze"],
        "reward_bullets": meta["reward_bullets"],
        "reward_loot_box_pieces": meta["reward_loot_box_pieces"],
        "reward_auto_rank_2h": meta["reward_auto_rank_2h"],
        "unlocked_city": meta["unlocks_city"],
    }


async def skip_current_mission(current_user: dict = Depends(get_current_user)):
    """Spend one Mission Skip token to complete the current open mission (full rewards)."""
    user_id = current_user.get("id") or ""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if int(current_user.get("mission_skip_tokens") or 0) < 1:
        raise HTTPException(status_code=400, detail="No Mission Skip tokens")

    mission = _current_open_mission(current_user)
    if not mission:
        raise HTTPException(status_code=400, detail="No open mission to skip")
    mission_id = mission["id"]
    unlocked = _user_unlocked_cities(current_user)
    if mission["city"] not in unlocked:
        raise HTTPException(status_code=403, detail="City not unlocked")

    consumed = await db.users.update_one(
        {"id": user_id, "mission_skip_tokens": {"$gte": 1}},
        {"$inc": {"mission_skip_tokens": -1}},
    )
    if consumed.modified_count != 1:
        raise HTTPException(status_code=400, detail="No Mission Skip tokens")

    try:
        mult = _mission_completion_reward_mult(current_user)
        update, meta = _build_mission_completion_reward_update(
            current_user,
            mission_id,
            mission,
            mult,
            include_mission_completion_push=True,
            include_next_mission_baseline=True,
        )
        mission_update = apply_season_rp_mirror_to_update(update, user=current_user)
        result = await db.users.update_one(
            {"id": user_id, "mission_completions.mission_id": {"$ne": mission_id}},
            mission_update,
        )
        if result.modified_count == 0:
            await db.users.update_one({"id": user_id}, {"$inc": {"mission_skip_tokens": 1}})
            raise HTTPException(status_code=400, detail="Mission already completed")
        await _run_mission_completion_side_effects(
            user_id,
            current_user,
            mission_id,
            meta,
            rp_awarded=rank_points_in_update(mission_update),
        )
    except HTTPException:
        raise
    except Exception:
        await db.users.update_one({"id": user_id}, {"$inc": {"mission_skip_tokens": 1}})
        raise

    try:
        await log_activity(
            user_id,
            current_user.get("username") or "?",
            "mission_skip",
            {"mission_id": mission_id, "title": mission.get("title")},
        )
    except Exception:
        pass

    reward_car_names = [_car_display_name(cid) for cid in meta["granted_car_ids"]]
    refreshed = await db.users.find_one({"id": user_id}, {"_id": 0, "mission_skip_tokens": 1}) or {}
    return {
        "completed": True,
        "skipped": True,
        "mission_id": mission_id,
        "title": mission.get("title"),
        "mission_skip_tokens": int(refreshed.get("mission_skip_tokens") or 0),
        "reward_money": meta["reward_money"],
        "reward_cash_immediate": meta["reward_cash_immediate"],
        "reward_points": meta["reward_points"],
        "reward_respect": meta["reward_respect"],
        "reward_tribute": meta["reward_tribute"],
        "reward_car_id": meta["reward_car_id"],
        "reward_car_ids": meta["reward_car_ids"],
        "reward_car_names": reward_car_names,
        "reward_booze": meta["reward_booze"],
        "reward_bullets": meta["reward_bullets"],
        "reward_loot_box_pieces": meta["reward_loot_box_pieces"],
        "reward_auto_rank_2h": meta["reward_auto_rank_2h"],
        "unlocked_city": meta["unlocks_city"],
    }


async def collect_tribute(current_user: dict = Depends(get_current_user)):
    """Collect accumulated tribute (cash, bullets, loot box pieces, respect, tokens) into balance. All daily rewards stack until collected."""
    user_id = current_user["id"]
    empty_response = {
        "collected": 0, "collected_bullets": 0, "collected_loot_box_pieces": 0, "collected_respect": 0, "collected_tokens": 0,
        "tribute_bank": 0, "tribute_bullets": 0, "tribute_loot_box_pieces": 0, "tribute_respect": 0, "tribute_tokens": 0,
        "message": "No tribute to collect",
    }
    old_user = await db.users.find_one_and_update(
        {"id": user_id, "$or": [
            {"tribute_bank": {"$gt": 0}},
            {"tribute_bullets": {"$gt": 0}},
            {"tribute_loot_box_pieces": {"$gt": 0}},
            {"tribute_respect": {"$gt": 0}},
            {"tribute_tokens": {"$gt": 0}},
        ]},
        {"$set": {"tribute_bank": 0, "tribute_bullets": 0, "tribute_loot_box_pieces": 0, "tribute_respect": 0, "tribute_tokens": 0}},
    )
    if not old_user:
        return empty_response
    bank = int(old_user.get("tribute_bank") or 0)
    bullets = int(old_user.get("tribute_bullets") or 0)
    loot_pieces = int(old_user.get("tribute_loot_box_pieces") or 0)
    respect = int(old_user.get("tribute_respect") or 0)
    tokens = int(old_user.get("tribute_tokens") or 0)
    if bank <= 0 and bullets <= 0 and loot_pieces <= 0 and respect <= 0 and tokens <= 0:
        return empty_response
    inc = {}
    if bank > 0:
        inc["money"] = bank
    if bullets > 0:
        inc["bullets"] = bullets
    if loot_pieces > 0:
        inc["loot_box_pieces"] = loot_pieces
    if respect > 0:
        inc["respect_points"] = respect
    tokens_awarded = {}
    if tokens > 0:
        for _ in range(tokens):
            token_type = random.choice(MISSION_RANDOM_TOKEN_TYPES)
            token_field = TOKEN_CONFIG[token_type]["count_field"]
            inc[token_field] = inc.get(token_field, 0) + 1
            tokens_awarded[token_type] = tokens_awarded.get(token_type, 0) + 1
    if inc:
        await db.users.update_one({"id": user_id}, {"$inc": inc})
    if respect > 0:
        await log_respect_earned(user_id, respect, "missions_tribute")
    msg = []
    if bank > 0:
        msg.append(f"${bank:,} cash")
    if bullets > 0:
        msg.append(f"{bullets:,} bullets")
    if loot_pieces > 0:
        msg.append(f"{loot_pieces} loot box piece(s)")
    if respect > 0:
        msg.append(f"{respect} respect")
    if tokens > 0:
        msg.append(f"{tokens} token(s)")
    return {
        "collected": bank,
        "collected_bullets": bullets,
        "collected_loot_box_pieces": loot_pieces,
        "collected_respect": respect,
        "collected_tokens": tokens,
        "tokens_awarded": tokens_awarded,
        "tribute_bank": 0,
        "tribute_bullets": 0,
        "tribute_loot_box_pieces": 0,
        "tribute_respect": 0,
        "tribute_tokens": 0,
        "message": f"Collected {' and '.join(msg)}",
    }


async def get_missions_characters(current_user: dict = Depends(get_current_user), city: Optional[str] = None):
    """Return mission characters for the map (optionally filtered by city)."""
    unlocked = _user_unlocked_cities(current_user)
    out = []
    for c in MISSION_CHARACTERS:
        if c["city"] not in unlocked:
            continue
        if city and c["city"] != city:
            continue
        out.append({
            "id": c["id"],
            "name": c["name"],
            "city": c["city"],
            "area": c["area"],
            "role": c["role"],
            "dialogue_intro": c.get("dialogue_intro"),
            "dialogue_mission_offer": c.get("dialogue_mission_offer"),
            "dialogue_in_progress": c.get("dialogue_in_progress"),
            "dialogue_complete": c.get("dialogue_complete"),
        })
    return {"characters": out}


# Loot box pieces in daily tribute: per completed mission only (see reward_tribute_loot_box_pieces_daily).
DAILY_TRIBUTE_LOOT_BOX_PIECES = 0
MISSION_2_DAILY_LOOT_BOX_PIECES = 0

# Filled when MISSIONS loads at EOF (see register() block below)
MISSION_1_DAILY_CASH = 0
MISSION_1_DAILY_RESPECT = 0
MISSION_1_DAILY_BULLETS = 0
MISSION_2_DAILY_CASH = 0
MISSION_2_DAILY_BULLETS = 0
MISSION_2_DAILY_RESPECT = 0
MISSION_3_DAILY_CASH = 0
MISSION_3_DAILY_RESPECT = 0
MISSION_3_DAILY_BULLETS = 0
MISSION_4_DAILY_CASH = 0
MISSION_4_DAILY_RESPECT = 0
MISSION_4_DAILY_BULLETS = 0


async def run_daily_tribute_deposit():
    """
    Credit DAILY_TRIBUTE_AMOUNT to every user's tribute_bank once per day at deposit_utc_hour (UTC).
    Deposit time and "already ran today" are stored in game_config (id=tribute_deposit): deposit_utc_hour, last_run_utc_date.
    We atomically claim the run for today (set last_run_utc_date only when not already today) so a restart or multiple workers cannot double-pay.
    For each mission, users who completed it get that mission's reward_tribute_daily, reward_respect_daily,
    reward_tribute_bullets_daily, reward_tribute_loot_box_pieces_daily, and reward_tribute_tokens_daily (random tokens).
    """
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    doc = await db.game_config.find_one({"id": TRIBUTE_DEPOSIT_CONFIG_ID}, {"_id": 0, "deposit_utc_hour": 1, "last_run_utc_date": 1})
    deposit_hour = int(doc.get("deposit_utc_hour") or TRIBUTE_DEPOSIT_UTC_HOUR) % 24 if doc else TRIBUTE_DEPOSIT_UTC_HOUR
    if now.hour != deposit_hour:
        return
    # Ensure row exists ($setOnInsert only). Do NOT upsert the "claim" update: when last_run_utc_date is already
    # `today`, that filter matches zero docs and upsert would try to insert a second {id: tribute_deposit} → E11000.
    try:
        await db.game_config.update_one(
            {"id": TRIBUTE_DEPOSIT_CONFIG_ID},
            {
                "$setOnInsert": {
                    "id": TRIBUTE_DEPOSIT_CONFIG_ID,
                    "deposit_utc_hour": TRIBUTE_DEPOSIT_UTC_HOUR,
                }
            },
            upsert=True,
        )
    except DuplicateKeyError:
        pass
    # Atomic claim: only set last_run when not already today (no upsert — row guaranteed above).
    claim_filter = {
        "id": TRIBUTE_DEPOSIT_CONFIG_ID,
        "$or": [
            {"last_run_utc_date": {"$exists": False}},
            {"last_run_utc_date": None},
            {"last_run_utc_date": {"$ne": today}},
        ],
    }
    claim_result = await db.game_config.update_one(claim_filter, {"$set": {"last_run_utc_date": today}})
    if claim_result.modified_count == 0:
        return  # already ran today or lost a claim race
    # All daily rewards stack in tribute buckets until user collects (cash, bullets, respect, loot from missions).
    result = await db.users.update_many(
        {},
        {"$inc": {"tribute_bank": DAILY_TRIBUTE_AMOUNT}},
    )
    counts = {}
    for m in MISSIONS:
        mid = m.get("id")
        cash = int(m.get("reward_tribute_daily") or 0)
        respect = int(m.get("reward_respect_daily") or 0)
        bullets = int(m.get("reward_tribute_bullets_daily") or 0)
        loot = int(m.get("reward_tribute_loot_box_pieces_daily") or 0)
        tokens = int(m.get("reward_tribute_tokens_daily") or 0)
        auto_rank_tokens = int(m.get("reward_tribute_auto_rank_2h_daily") or 0)
        inc_shared = {}
        if respect:
            inc_shared["tribute_respect"] = respect
        if bullets:
            inc_shared["tribute_bullets"] = bullets
        if loot:
            inc_shared["tribute_loot_box_pieces"] = loot
        if tokens:
            inc_shared["tribute_tokens"] = tokens
        if auto_rank_tokens:
            inc_shared["auto_rank_2h_tokens"] = auto_rank_tokens
        if not cash and not inc_shared:
            continue
        completed_filter = {"mission_completions": {"$elemMatch": {"mission_id": mid}}}
        modified = 0
        if cash:
            # Tribute Medallion: +10% daily tribute cash for holders only
            cash_boosted = int(round(cash * 1.10))
            r_plain = await db.users.update_many(
                {
                    **completed_filter,
                    "loot_reclaimable_passive_ids": {"$nin": ["tribute_medallion"]},
                },
                {"$inc": {**inc_shared, "tribute_bank": cash}},
            )
            r_medal = await db.users.update_many(
                {
                    **completed_filter,
                    "loot_reclaimable_passive_ids": "tribute_medallion",
                },
                {"$inc": {**inc_shared, "tribute_bank": cash_boosted}},
            )
            modified = int(r_plain.modified_count or 0) + int(r_medal.modified_count or 0)
        else:
            r = await db.users.update_many(completed_filter, {"$inc": inc_shared})
            modified = int(r.modified_count or 0)
        counts[mid] = modified
    
    # "Completed it" perk: Award 5 of each token type daily
    completed_it_token_inc = {
        "xp_crimes_tokens": 5,
        "xp_gta_tokens": 5,
        "melt_tokens": 5,
        "oc_reduced_tokens": 5,
        "booze_tokens": 5,
        "racket_tokens": 5,
        "travel_tokens": 5,
        "properties_tokens": 5,
        "jailbust_tokens": 5,
    }
    completed_it_result = await db.users.update_many(
        {"completed_it_daily_tokens": True},
        {"$inc": completed_it_token_inc},
    )
    
    logging.getLogger(__name__).info(
        "Daily tribute deposit: %s cash to %d users; per-mission bonuses %s; completed_it tokens to %d users at %s UTC",
        DAILY_TRIBUTE_AMOUNT,
        result.modified_count,
        counts,
        completed_it_result.modified_count,
        today,
    )


def register(router):
    router.add_api_route("/missions", get_missions, methods=["GET"], dependencies=_missions_rl_u)
    router.add_api_route("/missions/map", get_missions_map, methods=["GET"], dependencies=_missions_rl_u)
    router.add_api_route("/missions/complete", complete_mission, methods=["POST"])
    router.add_api_route("/missions/skip", skip_current_mission, methods=["POST"])
    router.add_api_route("/missions/collect-tribute", collect_tribute, methods=["POST"])
    router.add_api_route("/missions/characters", get_missions_characters, methods=["GET"], dependencies=_missions_rl_u)


# Load mission table after router registration (avoids circular import with server).
MISSIONS = build_missions()
MISSION_BY_ID = {m["id"]: m for m in MISSIONS}
MISSION_ID_TO_TITLE = {m["id"]: m["title"] for m in MISSIONS}
_def_m1 = next((m for m in MISSIONS if m.get("id") == FIRST_MISSION_ID), {})
_def_m2 = next((m for m in MISSIONS if m.get("id") == "m_second"), {})
_def_m3 = next((m for m in MISSIONS if m.get("id") == THIRD_MISSION_ID), {})
_def_m4 = next((m for m in MISSIONS if m.get("id") == FOURTH_MISSION_ID), {})
MISSION_1_DAILY_CASH = int(_def_m1.get("reward_tribute_daily") or 0)
MISSION_1_DAILY_RESPECT = int(_def_m1.get("reward_respect_daily") or 0)
MISSION_1_DAILY_BULLETS = int(_def_m1.get("reward_tribute_bullets_daily") or 0)
MISSION_2_DAILY_CASH = int(_def_m2.get("reward_tribute_daily") or 0)
MISSION_2_DAILY_BULLETS = int(_def_m2.get("reward_tribute_bullets_daily") or 0)
MISSION_2_DAILY_RESPECT = int(_def_m2.get("reward_respect_daily") or 0)
MISSION_3_DAILY_CASH = int(_def_m3.get("reward_tribute_daily") or 0)
MISSION_3_DAILY_RESPECT = int(_def_m3.get("reward_respect_daily") or 0)
MISSION_3_DAILY_BULLETS = int(_def_m3.get("reward_tribute_bullets_daily") or 0)
MISSION_4_DAILY_CASH = int(_def_m4.get("reward_tribute_daily") or 0)
MISSION_4_DAILY_RESPECT = int(_def_m4.get("reward_respect_daily") or 0)
MISSION_4_DAILY_BULLETS = int(_def_m4.get("reward_tribute_bullets_daily") or 0)
MISSION_2_DAILY_LOOT_BOX_PIECES = int(_def_m2.get("reward_tribute_loot_box_pieces_daily") or 0)


def _daily_tribute_loot_for_completed(completed_ids: set) -> int:
    return daily_loot_for_completed_ids(completed_ids, MISSION_BY_ID)


async def _maybe_mission_loot_backfill(current_user: dict) -> dict:
    completed_ids = _user_completed_mission_ids(current_user)
    credited = await ensure_mission_loot_daily_backfill(
        db,
        current_user,
        mission_by_id=MISSION_BY_ID,
        completed_ids=completed_ids,
    )
    if not credited:
        return current_user
    fresh = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    return fresh or current_user


async def _maybe_mission_rp_backfill(current_user: dict) -> dict:
    """One-time remaining RP for missions completed under the old weighted table."""
    if current_user.get(MISSION_RP_BACKFILL_FLAG):
        return current_user
    uid = current_user.get("id")
    if not uid:
        return current_user
    completed_ids = _user_completed_mission_ids(current_user)
    mult = _mission_completion_reward_mult(current_user)
    credit = compute_mission_rp_backfill_credit(
        current_user,
        mission_by_id=MISSION_BY_ID,
        mult=mult,
        completed_ids=completed_ids,
    )
    update: Dict[str, Any] = {"$set": {MISSION_RP_BACKFILL_FLAG: True}}
    if credit > 0:
        update["$inc"] = {"rank_points": credit}
        update = apply_season_rp_mirror_to_update(update, user=current_user)
        credit = rank_points_in_update(update)
    res = await db.users.update_one(
        {"id": uid, MISSION_RP_BACKFILL_FLAG: {"$ne": True}},
        update,
    )
    if res.matched_count == 0:
        return current_user
    if credit > 0:
        await send_notification(
            uid,
            "Mission RP adjustment",
            (
                f"Mission rank point rewards were increased. You've been credited {credit:,} rank points "
                "for missions you already completed under the old rewards. This adjustment is one-time."
            ),
            "system",
            category="missions",
        )
        try:
            rp_before = int(current_user.get("rank_points") or 0)
            await maybe_process_rank_up(
                uid,
                rp_before,
                credit,
                current_user.get("username", ""),
                user_prestige_rank_mult(current_user),
            )
        except Exception:
            pass
    fresh = await db.users.find_one({"id": uid}, {"_id": 0})
    return fresh or current_user


def mission_ladder_missions() -> List[Dict[str, Any]]:
    """Linear ladder order (matches unlock chain within Start)."""
    return sorted(
        MISSIONS,
        key=lambda m: (
            CITY_ORDER.index(m["city"]) if m.get("city") in CITY_ORDER else 999,
            1 if m.get("is_boss") else 0,
            m.get("order", 0),
        ),
    )


def infer_next_mission_display_index(completed_ids: set) -> int:
    """1-based story step of next incomplete mission (order field), or 101 if all 100 are done."""
    for m in sorted(MISSIONS, key=lambda x: x.get("order", 0)):
        if m["id"] not in completed_ids:
            return int(m.get("order", 0)) + 1
    return 101


def display_index_for_mission_id(mid: str) -> Optional[int]:
    m = next((x for x in MISSIONS if x["id"] == mid), None)
    if not m:
        return None
    return int(m.get("order", 0)) + 1


async def ensure_mission_chain_baselines(user: dict) -> None:
    """Ensure mission_1..3 canned baselines exist (same rules as get_missions / map)."""
    uid = user.get("id")
    if not uid:
        return
    completed_ids = _user_completed_mission_ids(user)
    mset: Dict[str, Any] = {}
    if FIRST_MISSION_ID not in completed_ids and user.get("mission_1_crimes_baseline") is None:
        mset["mission_1_crimes_baseline"] = int(user.get("total_crimes") or 0)
    if FIRST_MISSION_ID in completed_ids and user.get("mission_2_crimes_baseline") is None:
        mset["mission_2_crimes_baseline"] = int(user.get("total_crimes") or 0)
        mset["mission_2_jail_busts_baseline"] = int(user.get("jail_busts") or 0)
        mset["mission_2_cars_melted_baseline"] = int(user.get("cars_melted") or 0)
        mset["mission_2_cars_purchased_dealership_baseline"] = int(user.get("cars_purchased_from_dealership") or 0)
    elif FIRST_MISSION_ID in completed_ids and user.get("mission_2_cars_purchased_dealership_baseline") is None:
        mset["mission_2_cars_purchased_dealership_baseline"] = int(user.get("cars_purchased_from_dealership") or 0)
    if SECOND_MISSION_ID in completed_ids and user.get("mission_3_crimes_baseline") is None:
        mset["mission_3_crimes_baseline"] = int(user.get("total_crimes") or 0)
        mset["mission_3_jail_busts_baseline"] = int(user.get("jail_busts") or 0)
        mset["mission_3_gta_baseline"] = int(user.get("total_gta") or 0)
        mset["mission_3_booze_sells_baseline"] = int(user.get("booze_runs_count") or 0)
        mset["mission_3_bullets_melted_baseline"] = int(user.get("bullets_melted") or 0)
        mset["mission_3_bullets_purchased_armoury_baseline"] = int(user.get("bullets_purchased_from_armoury") or 0)
        mset["mission_3_uncommon_cars_scrapped_baseline"] = int(user.get("uncommon_cars_scrapped") or 0)
        mset["mission_3_cars_purchased_dealership_baseline"] = int(user.get("cars_purchased_from_dealership") or 0)
    elif SECOND_MISSION_ID in completed_ids and user.get("mission_3_cars_purchased_dealership_baseline") is None:
        mset["mission_3_cars_purchased_dealership_baseline"] = int(user.get("cars_purchased_from_dealership") or 0)
    if mset:
        await db.users.update_one({"id": uid}, {"$set": mset})
        user.update(mset)


async def _admin_tribute_snapshot(user: dict, completed_ids: set) -> Dict[str, Any]:
    tribute_doc = await db.game_config.find_one({"id": TRIBUTE_DEPOSIT_CONFIG_ID}, {"_id": 0, "deposit_utc_hour": 1})
    deposit_hour = int(tribute_doc.get("deposit_utc_hour") or TRIBUTE_DEPOSIT_UTC_HOUR) % 24 if tribute_doc else TRIBUTE_DEPOSIT_UTC_HOUR
    next_deposit_iso, deposit_time_label = _next_tribute_deposit_utc(deposit_hour)
    has_mission_1 = FIRST_MISSION_ID in completed_ids
    has_mission_2 = SECOND_MISSION_ID in completed_ids
    has_mission_3 = THIRD_MISSION_ID in completed_ids
    has_mission_4 = FOURTH_MISSION_ID in completed_ids
    daily_tokens_total = 0
    daily_auto_rank_2h_tokens_total = 0
    daily_cash_total = DAILY_TRIBUTE_AMOUNT
    daily_bullets_total = 0
    daily_respect_total = 0
    daily_loot_total = _daily_tribute_loot_for_completed(completed_ids)
    for mid in completed_ids:
        m = next((x for x in MISSIONS if x["id"] == mid), None)
        if not m:
            continue
        daily_tokens_total += int(m.get("reward_tribute_tokens_daily") or 0)
        daily_auto_rank_2h_tokens_total += int(m.get("reward_tribute_auto_rank_2h_daily") or 0)
        daily_cash_total += int(m.get("reward_tribute_daily") or 0)
        daily_bullets_total += int(m.get("reward_tribute_bullets_daily") or 0)
        daily_respect_total += int(m.get("reward_respect_daily") or 0)
    return {
        "tribute_bank": int(user.get("tribute_bank") or 0),
        "tribute_bullets": int(user.get("tribute_bullets") or 0),
        "tribute_loot_box_pieces": int(user.get("tribute_loot_box_pieces") or 0),
        "tribute_respect": int(user.get("tribute_respect") or 0),
        "tribute_tokens": int(user.get("tribute_tokens") or 0),
        "tribute_deposit_daily_at": deposit_time_label,
        "next_tribute_deposit_at": next_deposit_iso,
        "daily_tribute_cash_base": DAILY_TRIBUTE_AMOUNT,
        "daily_tribute_loot_box_pieces_base": DAILY_TRIBUTE_LOOT_BOX_PIECES,
        "daily_tribute_loot_box_pieces_ladder_max": TOTAL_TRIBUTE_LOOT_BOX_PIECES_DAILY,
        "daily_tribute_cash_total": daily_cash_total,
        "daily_tribute_bullets_total": daily_bullets_total,
        "daily_tribute_respect_total": daily_respect_total,
        "daily_tribute_loot_box_pieces_total": daily_loot_total,
        "daily_tribute_tokens_total": daily_tokens_total,
        "daily_tribute_auto_rank_2h_tokens_total": daily_auto_rank_2h_tokens_total,
        "completed_it_daily_tokens_perk": bool(user.get("completed_it_daily_tokens")),
        "has_mission_1_bonus": has_mission_1,
        "has_mission_2_bonus": has_mission_2,
        "has_mission_3_bonus": has_mission_3,
        "has_mission_4_bonus": has_mission_4,
    }


async def admin_missions_payload_for_user(user: dict) -> Dict[str, Any]:
    """Read-only summary for staff tools (caller enforces admin)."""
    await ensure_mission_chain_baselines(user)
    await _ensure_extended_mission_baselines(user)
    completed_ids = _user_completed_mission_ids(user)
    ladder = mission_ladder_missions()
    next_idx = infer_next_mission_display_index(completed_ids)
    completions_out = []
    raw_comp = user.get("mission_completions") or []
    for row in raw_comp:
        mid = row.get("mission_id")
        if not mid:
            continue
        disp = display_index_for_mission_id(mid)
        completions_out.append(
            {
                "mission_id": mid,
                "display_index": disp,
                "title": MISSION_ID_TO_TITLE.get(mid, mid),
                "completed_at": row.get("completed_at"),
            }
        )
    completions_out.sort(key=lambda x: (x["display_index"] is None, x["display_index"] or 0))
    active = None
    if 1 <= next_idx <= 100:
        m = ladder[next_idx - 1]
        met, progress = _check_mission_requirements(user, m)
        mission_unlocked = _mission_unlocked_by_previous(m, completed_ids)
        active = {
            "display_index": next_idx,
            "id": m["id"],
            "title": m.get("title"),
            "order": m.get("order"),
            "difficulty": m.get("difficulty"),
            "requirements_met": met and mission_unlocked,
            "unlocked": mission_unlocked,
            "progress": progress,
        }
    tribute = await _admin_tribute_snapshot(user, completed_ids)
    return {
        "user_id": user.get("id"),
        "username": user.get("username"),
        "missions_completed_count": len(completed_ids),
        "next_mission_display": next_idx,
        "all_missions_complete": next_idx == 101,
        "active_mission": active,
        "completions": completions_out,
        "tribute": tribute,
    }


async def admin_apply_mission_progress(
    user_id: str,
    next_mission_display: int,
    *,
    grant_skipped_rewards: bool = True,
) -> Dict[str, Any]:
    """
    Set ladder progress so the next mission to complete is `next_mission_display` (1..100),
    or 101 when all missions should be marked complete. When advancing the ladder, optionally
    grants the same completion rewards as normal play for each newly completed mission
    (`grant_skipped_rewards`, default True). Going backward does not remove granted rewards.
    """
    if next_mission_display < 1 or next_mission_display > 101:
        raise HTTPException(status_code=400, detail="next_mission_display must be 1-101 (101 = all missions complete)")
    user_before = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user_before:
        raise HTTPException(status_code=404, detail="User not found")
    old_completed = _user_completed_mission_ids(user_before)
    ladder = mission_ladder_missions()
    now_iso = datetime.now(timezone.utc).isoformat()
    if next_mission_display <= 100:
        to_complete = ladder[: next_mission_display - 1]
    else:
        to_complete = ladder[:]
    new_completed_ids = {m["id"] for m in to_complete}
    newly_ordered = [m["id"] for m in ladder if m["id"] in new_completed_ids and m["id"] not in old_completed]

    if grant_skipped_rewards and newly_ordered:
        for mid in newly_ordered:
            mission = next((m for m in MISSIONS if m["id"] == mid), None)
            if not mission:
                continue
            u = await db.users.find_one({"id": user_id}, {"_id": 0})
            if not u:
                raise HTTPException(status_code=404, detail="User not found")
            mult = _mission_completion_reward_mult(u)
            update, meta = _build_mission_completion_reward_update(
                u,
                mid,
                mission,
                mult,
                include_mission_completion_push=False,
                include_next_mission_baseline=False,
            )
            if update:
                mission_bulk_update = apply_season_rp_mirror_to_update(update, user=u)
                await db.users.update_one({"id": user_id}, mission_bulk_update)
                await _run_mission_completion_side_effects(
                    user_id,
                    u,
                    mid,
                    meta,
                    rp_awarded=rank_points_in_update(mission_bulk_update),
                )

    new_completions = [{"mission_id": m["id"], "completed_at": now_iso} for m in to_complete]
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"mission_completions": new_completions}, "$unset": {"mission_baselines": ""}},
    )
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not fresh:
        raise HTTPException(status_code=404, detail="User not found")
    await ensure_mission_chain_baselines(fresh)
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not fresh:
        raise HTTPException(status_code=404, detail="User not found")
    await _ensure_extended_mission_baselines(fresh)
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not fresh:
        raise HTTPException(status_code=404, detail="User not found")
    return await admin_missions_payload_for_user(fresh)