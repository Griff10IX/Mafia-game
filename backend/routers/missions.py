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
    maybe_process_rank_up,
    send_notification,
    STATES,
    RANKS,
    CARS,
)
from routers.booze_run import BOOZE_TYPES

# Single first mission: no districts/cities
FIRST_MISSION_ID = "m_first"
SECOND_MISSION_ID = "m_second"
THIRD_MISSION_ID = "m_third"
COMMON_CAR_REWARD_ID = "car1"
CITY_ORDER = ["Start"]  # single "city" for list/map compatibility

# Daily tribute deposit: hour (0–23) in UTC when tribute enters the bank each day (e.g. territory cut).
# Mission completion rewards still add to tribute_bank immediately; this is for daily scheduled deposit.
TRIBUTE_DEPOSIT_UTC_HOUR = int(os.environ.get("TRIBUTE_DEPOSIT_UTC_HOUR", "17"))  # 5 PM UTC default
# Amount (cash) added to each user's tribute_bank once per day at that hour. Configurable via env.
DAILY_TRIBUTE_AMOUNT = int(os.environ.get("DAILY_TRIBUTE_AMOUNT", "500"))
TRIBUTE_DEPOSIT_CONFIG_ID = "tribute_deposit"


def _next_tribute_deposit_utc():
    """Next occurrence of TRIBUTE_DEPOSIT_UTC_HOUR (UTC). Returns (next_iso, daily_time_label e.g. '5:00 PM UTC')."""
    now = datetime.now(timezone.utc)
    h = TRIBUTE_DEPOSIT_UTC_HOUR % 24
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
# MISSION DEFINITIONS – single first mission (no districts)
# Requirements: crimes (total_crimes), jail_busts_npc (bust 1 NPC from jail)
# ─────────────────────────────────────────────────────────────────────────────

MISSIONS = [
    {
        "id": FIRST_MISSION_ID,
        "city": "Start",
        "area": "—",
        "order": 0,
        "type": "starter",
        "requirements": {"crimes": 15, "jail_busts_npc": 1},
        "title": "Prove Yourself",
        "description": "Commit 15 crimes and bust 1 NPC from jail. The outfit wants to see what you're made of.",
        "reward_money": 50_000,
        "reward_points": 50,
        "reward_car_id": COMMON_CAR_REWARD_ID,
        "difficulty": 1,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": "m_second",
        "city": "Start",
        "area": "—",
        "order": 1,
        "type": "special",
        "requirements": {
            "in_state": "New York",
            "jail_busts": 2,
            "crimes": 200,
            "cars_melted": 1,
        },
        "title": "New York Run",
        "description": "Travel to New York. Bust 2 people from jail (NPC or player). Commit 200 crimes. Melt 1 car.",
        "reward_cash_immediate": 50_000,
        "reward_tribute_daily": 100_000,
        "reward_car_ids": ["car7", "car2"],
        "reward_bullets": 2_500,
        "reward_tribute_bullets_daily": 100,
        "reward_loot_box_pieces": 1,
        "difficulty": 2,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": THIRD_MISSION_ID,
        "city": "Start",
        "area": "—",
        "order": 2,
        "type": "special",
        "requirements": {
            "booze_sells": 25,
            "crimes": 150,
            "gta": 10,
            "jail_busts": 15,
            "bullets_melted": 5000,
            "bullets_purchased_armoury": 300,
            "uncommon_cars_scrapped": 3,
        },
        "title": "Making Moves",
        "description": "Do 25 booze runs. Commit 150 crimes. Steal 10 cars. Bust 15 from jail. Melt 5,000 bullets (from cars). Buy 300 bullets from the armoury. Scrap 3 uncommon cars.",
        "reward_money": 0,
        "reward_cash_immediate": 0,
        "reward_points": 0,
        "difficulty": 3,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
]  # end MISSIONS list

# Lookup mission id -> title
MISSION_ID_TO_TITLE = {m["id"]: m["title"] for m in MISSIONS}

# ─────────────────────────────────────────────────────────────────────────────
# CHARACTERS
# ─────────────────────────────────────────────────────────────────────────────

MISSION_CHARACTERS = []


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

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


def _mission_unlocked_by_previous(mission: dict, completed_ids: set) -> bool:
    """True if this mission is unlocked by progression (previous mission in same city completed)."""
    prev = _previous_mission(mission)
    return prev is None or prev["id"] in completed_ids


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
        return int(user.get("total_kills") or 0)
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
    if req_key == "bullets_melted":
        return int(user.get("bullets_melted") or 0)
    if req_key == "bullets_purchased_armoury":
        return int(user.get("bullets_purchased_from_armoury") or 0)
    if req_key == "uncommon_cars_scrapped":
        return int(user.get("uncommon_cars_scrapped") or 0)
    return 0


def _check_mission_requirements(user: dict, mission: dict) -> tuple[bool, Dict[str, Any]]:
    """Return (met: bool, progress: dict with current/target/description)."""
    req = mission.get("requirements") or {}
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
            progress["description"] = (
                f"Complete {progress['target'] - len(done)} more: "
                + ", ".join(shown)
                + (f"… +{more} more" if more > 0 else "")
            )
        else:
            progress["description"] = f"{len(done)}/{progress['target']} missions complete"
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
        else:
            current = _get_user_progress_value(user, key)
        met = current >= target
        if met:
            met_count += 1
        if key == "rank_id":
            rank_name = next((r["name"] for r in RANKS if r["id"] == target), str(target))
            parts.append(f"Reach {rank_name}: {current}/{target}" if not met else f"Reach {rank_name}: done")
        elif key == "hitlist_npc_kills":
            parts.append(f"{current}/{target} hitlist NPC kills")
        elif key == "money_earned":
            parts.append(f"${current:,} / ${target:,} earned")
        elif key == "booze_sells":
            parts.append(f"{current}/{target} booze runs")
        elif key == "jail_busts":
            parts.append(f"{current}/{target} jail busts")
        elif key == "jail_busts_npc":
            parts.append(f"Bust 1 NPC from jail: {current}/1")
        elif key == "gta":
            parts.append(f"{current}/{target} cars stolen")
        elif key == "crimes":
            parts.append(f"{current}/{target} crimes")
        elif key == "crime_profit":
            parts.append(f"${current:,} / ${target:,} crime profit")
        elif key == "snitch_count":
            parts.append(f"Snitch on someone (in jail): {current}/{target}")
        elif key == "cars_melted":
            parts.append(f"{current}/{target} cars melted")
        elif key == "bullets_melted":
            parts.append(f"{current}/{target} bullets melted")
        elif key == "bullets_purchased_armoury":
            parts.append(f"{current}/{target} bullets from armoury")
        elif key == "uncommon_cars_scrapped":
            parts.append(f"{current}/{target} uncommon cars scrapped")
        else:
            parts.append(f"{current}/{target}")
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
    # Ensure second mission baselines exist (crimes and jail_busts only count after mission 2 unlocks)
    if FIRST_MISSION_ID in completed_ids and current_user.get("mission_2_crimes_baseline") is None:
        c_baseline = int(current_user.get("total_crimes") or 0)
        j_baseline = int(current_user.get("jail_busts") or 0)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"mission_2_crimes_baseline": c_baseline, "mission_2_jail_busts_baseline": j_baseline}},
        )
        current_user["mission_2_crimes_baseline"] = c_baseline
        current_user["mission_2_jail_busts_baseline"] = j_baseline
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
        }
        await db.users.update_one({"id": current_user["id"]}, {"$set": m3_set})
        current_user.update(m3_set)
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
            "reward_tribute_daily": m.get("reward_tribute_daily", 0),
            "reward_points": m.get("reward_points", 0),
            "reward_car_id": m.get("reward_car_id"),
            "reward_car_ids": m.get("reward_car_ids") or [],
            "reward_booze": m.get("reward_booze"),
            "reward_bullets": m.get("reward_bullets", 0),
            "reward_tribute_bullets_daily": m.get("reward_tribute_bullets_daily", 0),
            "reward_loot_box_pieces": m.get("reward_loot_box_pieces", 0),
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
        await send_notification(
            current_user["id"],
            "Prove Yourself",
            "The outfit wants to see what you're made of. Commit 15 crimes and bust 1 NPC from jail. Reward: $50,000, 1 common car, and 50 rank points. Check Missions to track progress and claim your reward.",
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
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"mission_2_crimes_baseline": c_baseline, "mission_2_jail_busts_baseline": j_baseline}},
        )
        current_user["mission_2_crimes_baseline"] = c_baseline
        current_user["mission_2_jail_busts_baseline"] = j_baseline
    if SECOND_MISSION_ID in completed_ids and current_user.get("mission_3_crimes_baseline") is None:
        m3_set = {
            "mission_3_crimes_baseline": int(current_user.get("total_crimes") or 0),
            "mission_3_jail_busts_baseline": int(current_user.get("jail_busts") or 0),
            "mission_3_gta_baseline": int(current_user.get("total_gta") or 0),
            "mission_3_booze_sells_baseline": int(current_user.get("booze_runs_count") or 0),
            "mission_3_bullets_melted_baseline": int(current_user.get("bullets_melted") or 0),
            "mission_3_bullets_purchased_armoury_baseline": int(current_user.get("bullets_purchased_from_armoury") or 0),
            "mission_3_uncommon_cars_scrapped_baseline": int(current_user.get("uncommon_cars_scrapped") or 0),
        }
        await db.users.update_one({"id": current_user["id"]}, {"$set": m3_set})
        current_user.update(m3_set)
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
        entry = {
            "id": m["id"],
            "area": m["area"],
            "order": m["order"],
            "type": m["type"],
            "title": m["title"],
            "description": m["description"],
            "reward_money": m.get("reward_money", 0),
            "reward_cash_immediate": m.get("reward_cash_immediate", 0),
            "reward_tribute_daily": m.get("reward_tribute_daily", 0),
            "reward_points": m.get("reward_points", 0),
            "reward_car_id": m.get("reward_car_id"),
            "reward_car_ids": m.get("reward_car_ids") or [],
            "reward_booze": m.get("reward_booze"),
            "reward_bullets": m.get("reward_bullets", 0),
            "reward_tribute_bullets_daily": m.get("reward_tribute_bullets_daily", 0),
            "reward_loot_box_pieces": m.get("reward_loot_box_pieces", 0),
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
    next_deposit_iso, deposit_time_label = _next_tribute_deposit_utc()
    return {
        "current_city": current_city,
        "unlocked_cities": unlocked,
        "cities": list(unlocked),
        "by_city": by_city,
        "tribute_bank": tribute_bank,
        "tribute_bullets": tribute_bullets,
        "tribute_deposit_daily_at": deposit_time_label,
        "next_tribute_deposit_at": next_deposit_iso,
    }


class CompleteMissionRequest(BaseModel):
    mission_id: str


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
    reward_money = int(mission.get("reward_money") or 0)
    reward_cash_immediate = int(mission.get("reward_cash_immediate") or 0)
    reward_points = int(mission.get("reward_points") or 0)
    reward_car_id = (mission.get("reward_car_id") or "").strip() or None
    reward_car_ids = mission.get("reward_car_ids") or []
    reward_booze = mission.get("reward_booze")
    reward_bullets = int(mission.get("reward_bullets") or 0)
    reward_loot_box_pieces = int(mission.get("reward_loot_box_pieces") or 0)
    unlocks_city = mission.get("unlocks_city")

    completion_doc = {"mission_id": mission_id, "completed_at": datetime.now(timezone.utc).isoformat()}
    update = {"$push": {"mission_completions": completion_doc}}
    if mission_id == FIRST_MISSION_ID:
        update.setdefault("$set", {})["mission_2_crimes_baseline"] = int(current_user.get("total_crimes") or 0)
        update.setdefault("$set", {})["mission_2_jail_busts_baseline"] = int(current_user.get("jail_busts") or 0)
    if mission_id == SECOND_MISSION_ID:
        update.setdefault("$set", {})["mission_3_crimes_baseline"] = int(current_user.get("total_crimes") or 0)
        update.setdefault("$set", {})["mission_3_jail_busts_baseline"] = int(current_user.get("jail_busts") or 0)
        update.setdefault("$set", {})["mission_3_gta_baseline"] = int(current_user.get("total_gta") or 0)
        update.setdefault("$set", {})["mission_3_booze_sells_baseline"] = int(current_user.get("booze_runs_count") or 0)
        update.setdefault("$set", {})["mission_3_bullets_melted_baseline"] = int(current_user.get("bullets_melted") or 0)
        update.setdefault("$set", {})["mission_3_bullets_purchased_armoury_baseline"] = int(current_user.get("bullets_purchased_from_armoury") or 0)
        update.setdefault("$set", {})["mission_3_uncommon_cars_scrapped_baseline"] = int(current_user.get("uncommon_cars_scrapped") or 0)
    if reward_money:
        update.setdefault("$inc", {})["tribute_bank"] = reward_money
    if reward_cash_immediate:
        update.setdefault("$inc", {})["money"] = reward_cash_immediate
    if reward_points:
        update.setdefault("$inc", {})["rank_points"] = reward_points
    if reward_bullets:
        update.setdefault("$inc", {})["bullets"] = reward_bullets
    if reward_loot_box_pieces:
        update.setdefault("$inc", {})["loot_box_pieces"] = reward_loot_box_pieces
    if isinstance(reward_booze, dict) and reward_booze:
        booze_ids = [b["id"] for b in BOOZE_TYPES]
        for bid, amt in reward_booze.items():
            if bid in booze_ids and amt and int(amt) > 0:
                update.setdefault("$inc", {})[f"booze_carrying.{bid}"] = int(amt)
                update.setdefault("$set", {})[f"booze_carrying_cost.{bid}"] = 0
    if unlocks_city:
        update.setdefault("$set", {})["unlocked_maps_up_to"] = unlocks_city

    await db.users.update_one({"id": user_id}, update)

    if reward_car_id and next((c for c in CARS if c.get("id") == reward_car_id), None):
        await db.user_cars.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "car_id": reward_car_id,
            "acquired_at": datetime.now(timezone.utc).isoformat(),
        })
    for cid in reward_car_ids:
        if isinstance(cid, str) and next((c for c in CARS if c.get("id") == cid), None):
            await db.user_cars.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "car_id": cid,
                "acquired_at": datetime.now(timezone.utc).isoformat(),
            })

    try:
        if reward_points:
            rp_before = int(current_user.get("rank_points") or 0)
            await maybe_process_rank_up(user_id, rp_before, reward_points, current_user.get("username", ""))
    except Exception:
        pass

    if unlocks_city:
        await send_notification(
            user_id,
            "Missions",
            f"You've unlocked {unlocks_city}. The map is yours.",
            "system",
            category="missions",
        )

    return {
        "completed": True,
        "mission_id": mission_id,
        "reward_money": reward_money,
        "reward_cash_immediate": reward_cash_immediate,
        "reward_points": reward_points,
        "reward_car_id": reward_car_id,
        "reward_car_ids": reward_car_ids,
        "reward_booze": reward_booze if isinstance(reward_booze, dict) else None,
        "reward_bullets": reward_bullets,
        "reward_loot_box_pieces": reward_loot_box_pieces,
        "unlocked_city": unlocks_city,
    }


async def collect_tribute(current_user: dict = Depends(get_current_user)):
    """Collect accumulated tribute bank (cash) and tribute bullets into balance."""
    user_id = current_user["id"]
    bank = int(current_user.get("tribute_bank") or 0)
    bullets = int(current_user.get("tribute_bullets") or 0)
    if bank <= 0 and bullets <= 0:
        return {"collected": 0, "collected_bullets": 0, "tribute_bank": 0, "tribute_bullets": 0, "message": "No tribute to collect"}
    update = {"$set": {}}
    if bank > 0:
        update["$inc"] = update.get("$inc", {})
        update["$inc"]["money"] = bank
        update["$set"]["tribute_bank"] = 0
    if bullets > 0:
        update["$inc"] = update.get("$inc", {})
        update["$inc"]["bullets"] = bullets
        update["$set"]["tribute_bullets"] = 0
    await db.users.update_one({"id": user_id}, update)
    msg = []
    if bank > 0:
        msg.append(f"${bank:,} cash")
    if bullets > 0:
        msg.append(f"{bullets:,} bullets")
    return {"collected": bank, "collected_bullets": bullets, "tribute_bank": 0, "tribute_bullets": 0, "message": f"Collected {' and '.join(msg)}"}


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


MISSION_2_DAILY_CASH = 100_000
MISSION_2_DAILY_BULLETS = 100


async def run_daily_tribute_deposit():
    """
    Credit DAILY_TRIBUTE_AMOUNT to every user's tribute_bank once per day at TRIBUTE_DEPOSIT_UTC_HOUR (UTC).
    Users who completed mission 2 (m_second) also get MISSION_2_DAILY_CASH to tribute_bank and MISSION_2_DAILY_BULLETS to tribute_bullets.
    Idempotent: uses game_config last_run_utc_date so we only run once per calendar day.
    """
    now = datetime.now(timezone.utc)
    if now.hour != TRIBUTE_DEPOSIT_UTC_HOUR:
        return
    today = now.date().isoformat()
    doc = await db.game_config.find_one({"id": TRIBUTE_DEPOSIT_CONFIG_ID}, {"_id": 0, "last_run_utc_date": 1})
    if doc and doc.get("last_run_utc_date") == today:
        return
    result = await db.users.update_many({}, {"$inc": {"tribute_bank": DAILY_TRIBUTE_AMOUNT}})
    result2 = await db.users.update_many(
        {"mission_completions": {"$elemMatch": {"mission_id": "m_second"}}},
        {"$inc": {"tribute_bank": MISSION_2_DAILY_CASH, "tribute_bullets": MISSION_2_DAILY_BULLETS}},
    )
    await db.game_config.update_one(
        {"id": TRIBUTE_DEPOSIT_CONFIG_ID},
        {"$set": {"last_run_utc_date": today}},
        upsert=True,
    )
    logging.getLogger(__name__).info(
        "Daily tribute deposit: %s cash to %d users; mission 2 bonus (%s cash + %s bullets) to %d users at %s UTC",
        DAILY_TRIBUTE_AMOUNT,
        result.modified_count,
        MISSION_2_DAILY_CASH,
        MISSION_2_DAILY_BULLETS,
        result2.modified_count,
        today,
    )


def register(router):
    router.add_api_route("/missions", get_missions, methods=["GET"])
    router.add_api_route("/missions/map", get_missions_map, methods=["GET"])
    router.add_api_route("/missions/complete", complete_mission, methods=["POST"])
    router.add_api_route("/missions/collect-tribute", collect_tribute, methods=["POST"])
    router.add_api_route("/missions/characters", get_missions_characters, methods=["GET"])