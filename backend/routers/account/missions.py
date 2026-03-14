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
    get_prestige_bonus,
    log_respect_earned,
    maybe_process_rank_up,
    send_notification,
    STATES,
    RANKS,
    CARS,
)
from routers.money.booze_run import BOOZE_TYPES
from routers.kill.armoury import TOKEN_TYPES, TOKEN_CONFIG
import random

# Single first mission: no districts/cities
FIRST_MISSION_ID = "m_first"
SECOND_MISSION_ID = "m_second"
THIRD_MISSION_ID = "m_third"
FOURTH_MISSION_ID = "m_fourth"
COMMON_CAR_REWARD_ID = "car1"
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
        "reward_respect": 2,
        "reward_tribute": 1_000,
        "reward_tribute_daily": 25_000,
        "reward_respect_daily": 1,
        "reward_tribute_bullets_daily": 125,
        "reward_car_id": COMMON_CAR_REWARD_ID,
        "reward_token": "random",
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
        "reward_respect": 3,
        "reward_respect_daily": 5,
        "reward_tribute": 2_000,
        "reward_car_ids": ["car7", "car2"],
        "reward_bullets": 2_500,
        "reward_tribute_bullets_daily": 250,
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
        "reward_cash_immediate": 150_000,
        "reward_points": 0,
        "reward_respect": 5,
        "reward_tribute": 3_000,
        "reward_tribute_daily": 250_000,
        "reward_respect_daily": 10,
        "reward_tribute_bullets_daily": 150,
        "reward_token": "random",
        "difficulty": 3,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": FOURTH_MISSION_ID,
        "city": "Start",
        "area": "—",
        "order": 3,
        "type": "special",
        "requirements": {
            "uncommon_cars_stolen": 5,
            "hitlist_npc_kills": 7,
            "jail_busts": 15,
            "bullets_purchased_armoury": 500,
            "bullets_melted": 5000,
            "deposit_interest": 1_000_000,
        },
        "title": "Big League",
        "description": "Steal 5 uncommon cars. Kill 7 hitlist NPCs. Bust 15 from jail (NPC or player). Buy 500 bullets from the armoury. Melt 5,000 bullets. Add $1,000,000 to the interest bank.",
        "reward_money": 1_000_000,
        "reward_cash_immediate": 1_000_000,
        "reward_points": 50,
        "reward_respect": 10,
        "reward_tribute": 5_000,
        "reward_tribute_daily": 1_500_000,
        "reward_respect_daily": 50,
        "reward_tribute_bullets_daily": 1_500,
        "difficulty": 4,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    # Missions 5–25: progressive difficulty and rewards (tokens start at m_5)
    {"id": "m_5", "city": "Start", "area": "—", "order": 4, "type": "special", "requirements": {"crimes": 800, "jail_busts": 30, "gta": 25, "booze_sells": 50}, "title": "Street Boss", "description": "Commit 800 crimes. Bust 30 from jail. Steal 25 cars. Do 50 booze runs.", "reward_cash_immediate": 250_000, "reward_points": 75, "reward_respect": 8, "reward_tribute": 10_000, "reward_tribute_daily": 500_000, "reward_respect_daily": 15, "reward_tribute_bullets_daily": 250, "reward_tribute_tokens_daily": 1, "reward_bullets": 5_000, "reward_token": "random", "difficulty": 5, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_6", "city": "Start", "area": "—", "order": 5, "type": "special", "requirements": {"bullets_melted": 10_000, "bullets_purchased_armoury": 800, "uncommon_cars_scrapped": 8, "cars_melted": 5}, "title": "Arms Dealer", "description": "Melt 10,000 bullets. Buy 800 from the armoury. Scrap 8 uncommon cars. Melt 5 cars.", "reward_cash_immediate": 400_000, "reward_points": 80, "reward_respect": 10, "reward_tribute": 15_000, "reward_tribute_daily": 750_000, "reward_respect_daily": 18, "reward_tribute_bullets_daily": 400, "reward_bullets": 8_000, "difficulty": 6, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_7", "city": "Start", "area": "—", "order": 6, "type": "special", "requirements": {"hitlist_npc_kills": 15, "jail_busts": 50, "uncommon_cars_stolen": 10, "deposit_interest": 2_500_000}, "title": "Clean Up", "description": "Kill 15 hitlist NPCs. Bust 50 from jail. Steal 10 uncommon cars. Add $2.5M to the interest bank.", "reward_cash_immediate": 600_000, "reward_points": 100, "reward_respect": 12, "reward_tribute": 25_000, "reward_tribute_daily": 1_000_000, "reward_respect_daily": 22, "reward_tribute_bullets_daily": 500, "reward_tribute_tokens_daily": 1, "reward_token": "random", "difficulty": 7, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_8", "city": "Start", "area": "—", "order": 7, "type": "special", "requirements": {"crimes": 1500, "gta": 50, "booze_sells": 100}, "title": "Territory", "description": "Commit 1,500 crimes. Steal 50 cars. Do 100 booze runs.", "reward_cash_immediate": 900_000, "reward_points": 120, "reward_respect": 15, "reward_tribute": 40_000, "reward_tribute_daily": 1_500_000, "reward_respect_daily": 28, "reward_tribute_bullets_daily": 600, "reward_bullets": 10_000, "difficulty": 8, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_9", "city": "Start", "area": "—", "order": 8, "type": "special", "requirements": {"jail_busts": 80, "bullets_melted": 20_000, "uncommon_cars_scrapped": 15, "deposit_interest": 5_000_000}, "title": "Heavy Hitter", "description": "Bust 80 from jail. Melt 20,000 bullets. Scrap 15 uncommon cars. Add $5M to the interest bank.", "reward_cash_immediate": 1_200_000, "reward_points": 140, "reward_respect": 18, "reward_tribute": 60_000, "reward_tribute_daily": 2_000_000, "reward_respect_daily": 35, "reward_tribute_bullets_daily": 800, "reward_tribute_tokens_daily": 1, "reward_token": "random", "difficulty": 9, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_10", "city": "Start", "area": "—", "order": 9, "type": "special", "requirements": {"crimes": 2500, "hitlist_npc_kills": 25, "uncommon_cars_stolen": 20, "bullets_purchased_armoury": 1500}, "title": "Capo", "description": "Commit 2,500 crimes. Kill 25 hitlist NPCs. Steal 20 uncommon cars. Buy 1,500 bullets from the armoury.", "reward_cash_immediate": 1_500_000, "reward_points": 160, "reward_respect": 22, "reward_tribute": 80_000, "reward_tribute_daily": 2_500_000, "reward_respect_daily": 42, "reward_tribute_bullets_daily": 1_000, "reward_tribute_tokens_daily": 1, "reward_bullets": 15_000, "difficulty": 10, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_11", "city": "Start", "area": "—", "order": 10, "type": "special", "requirements": {"booze_sells": 150, "gta": 80, "cars_melted": 15, "deposit_interest": 10_000_000}, "title": "Empire Builder", "description": "Do 150 booze runs. Steal 80 cars. Melt 15 cars. Add $10M to the interest bank.", "reward_cash_immediate": 2_000_000, "reward_points": 180, "reward_respect": 26, "reward_tribute": 100_000, "reward_tribute_daily": 3_000_000, "reward_respect_daily": 50, "reward_tribute_bullets_daily": 1_200, "reward_tribute_tokens_daily": 1, "reward_token": "random", "difficulty": 11, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_12", "city": "Start", "area": "—", "order": 11, "type": "special", "requirements": {"crimes": 4000, "jail_busts": 120, "bullets_melted": 35_000}, "title": "Enforcer", "description": "Commit 4,000 crimes. Bust 120 from jail. Melt 35,000 bullets.", "reward_cash_immediate": 2_500_000, "reward_points": 200, "reward_respect": 30, "reward_tribute": 130_000, "reward_tribute_daily": 3_500_000, "reward_respect_daily": 58, "reward_tribute_bullets_daily": 1_500, "reward_tribute_tokens_daily": 1, "reward_bullets": 20_000, "difficulty": 12, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_13", "city": "Start", "area": "—", "order": 12, "type": "special", "requirements": {"hitlist_npc_kills": 40, "uncommon_cars_stolen": 35, "uncommon_cars_scrapped": 25, "deposit_interest": 20_000_000}, "title": "Wheelman", "description": "Kill 40 hitlist NPCs. Steal 35 uncommon cars. Scrap 25 uncommon cars. Add $20M to the interest bank.", "reward_cash_immediate": 3_000_000, "reward_points": 220, "reward_respect": 35, "reward_tribute": 170_000, "reward_tribute_daily": 4_000_000, "reward_respect_daily": 65, "reward_tribute_bullets_daily": 1_800, "reward_tribute_tokens_daily": 2, "reward_token": "random", "difficulty": 13, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_14", "city": "Start", "area": "—", "order": 13, "type": "special", "requirements": {"crimes": 6000, "gta": 120, "booze_sells": 200, "bullets_purchased_armoury": 2500}, "title": "Underboss", "description": "Commit 6,000 crimes. Steal 120 cars. Do 200 booze runs. Buy 2,500 bullets from the armoury.", "reward_cash_immediate": 3_500_000, "reward_points": 250, "reward_respect": 40, "reward_tribute": 200_000, "reward_tribute_daily": 4_500_000, "reward_respect_daily": 72, "reward_tribute_bullets_daily": 2_000, "reward_tribute_tokens_daily": 2, "reward_bullets": 25_000, "difficulty": 14, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_15", "city": "Start", "area": "—", "order": 14, "type": "special", "requirements": {"jail_busts": 180, "deposit_interest": 35_000_000, "cars_melted": 25}, "title": "Consigliere", "description": "Bust 180 from jail. Add $35M to the interest bank. Melt 25 cars.", "reward_cash_immediate": 4_000_000, "reward_points": 280, "reward_respect": 45, "reward_tribute": 250_000, "reward_tribute_daily": 5_000_000, "reward_respect_daily": 80, "reward_tribute_bullets_daily": 2_500, "reward_tribute_tokens_daily": 2, "reward_token": "random", "difficulty": 15, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_16", "city": "Start", "area": "—", "order": 15, "type": "special", "requirements": {"crimes": 9000, "hitlist_npc_kills": 60, "bullets_melted": 60_000, "uncommon_cars_scrapped": 40}, "title": "War Chief", "description": "Commit 9,000 crimes. Kill 60 hitlist NPCs. Melt 60,000 bullets. Scrap 40 uncommon cars.", "reward_cash_immediate": 5_000_000, "reward_points": 320, "reward_respect": 52, "reward_tribute": 320_000, "reward_tribute_daily": 5_500_000, "reward_respect_daily": 90, "reward_tribute_bullets_daily": 3_000, "reward_tribute_tokens_daily": 2, "reward_bullets": 30_000, "difficulty": 16, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_17", "city": "Start", "area": "—", "order": 16, "type": "special", "requirements": {"gta": 180, "uncommon_cars_stolen": 55, "booze_sells": 300, "deposit_interest": 50_000_000}, "title": "Kingpin", "description": "Steal 180 cars. Steal 55 uncommon cars. Do 300 booze runs. Add $50M to the interest bank.", "reward_cash_immediate": 6_000_000, "reward_points": 360, "reward_respect": 58, "reward_tribute": 400_000, "reward_tribute_daily": 6_000_000, "reward_respect_daily": 100, "reward_tribute_bullets_daily": 3_500, "reward_tribute_tokens_daily": 3, "reward_token": "random", "difficulty": 17, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_18", "city": "Start", "area": "—", "order": 17, "type": "special", "requirements": {"crimes": 12000, "jail_busts": 250, "bullets_purchased_armoury": 4000}, "title": "Street General", "description": "Commit 12,000 crimes. Bust 250 from jail. Buy 4,000 bullets from the armoury.", "reward_cash_immediate": 7_000_000, "reward_points": 400, "reward_respect": 65, "reward_tribute": 480_000, "reward_tribute_daily": 6_500_000, "reward_respect_daily": 110, "reward_tribute_bullets_daily": 4_000, "reward_tribute_tokens_daily": 3, "reward_bullets": 40_000, "difficulty": 18, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_19", "city": "Start", "area": "—", "order": 18, "type": "special", "requirements": {"hitlist_npc_kills": 90, "deposit_interest": 75_000_000, "uncommon_cars_scrapped": 60, "cars_melted": 40}, "title": "Shadow Don", "description": "Kill 90 hitlist NPCs. Add $75M to the interest bank. Scrap 60 uncommon cars. Melt 40 cars.", "reward_cash_immediate": 8_000_000, "reward_points": 450, "reward_respect": 72, "reward_tribute": 580_000, "reward_tribute_daily": 7_000_000, "reward_respect_daily": 120, "reward_tribute_bullets_daily": 4_500, "reward_tribute_tokens_daily": 3, "reward_token": "random", "difficulty": 19, "unlocks_city": None, "character_id": None, "is_boss": False},
    {"id": "m_20", "city": "Start", "area": "—", "order": 19, "type": "special", "requirements": {"crimes": 16000, "gta": 250, "booze_sells": 400, "jail_busts": 350}, "title": "Boss of Bosses", "description": "Commit 16,000 crimes. Steal 250 cars. Do 400 booze runs. Bust 350 from jail.", "reward_cash_immediate": 10_000_000, "reward_points": 500, "reward_respect": 80, "reward_tribute": 700_000, "reward_tribute_daily": 8_000_000, "reward_respect_daily": 135, "reward_tribute_bullets_daily": 5_000, "reward_tribute_tokens_daily": 4, "reward_bullets": 50_000, "difficulty": 20, "unlocks_city": None, "character_id": None, "is_boss": True},
    {"id": "m_21", "city": "Start", "area": "—", "order": 20, "type": "special", "requirements": {"bullets_melted": 100_000, "uncommon_cars_stolen": 90, "deposit_interest": 100_000_000}, "title": "Legend", "description": "Melt 100,000 bullets. Steal 90 uncommon cars. Add $100M to the interest bank.", "reward_cash_immediate": 12_000_000, "reward_points": 550, "reward_respect": 88, "reward_tribute": 850_000, "reward_tribute_daily": 9_000_000, "reward_respect_daily": 150, "reward_tribute_bullets_daily": 5_500, "reward_tribute_tokens_daily": 4, "reward_token": "random", "difficulty": 21, "unlocks_city": None, "character_id": None, "is_boss": True},
    {"id": "m_22", "city": "Start", "area": "—", "order": 21, "type": "special", "requirements": {"crimes": 22000, "hitlist_npc_kills": 120, "jail_busts": 450, "bullets_purchased_armoury": 6000}, "title": "Empire", "description": "Commit 22,000 crimes. Kill 120 hitlist NPCs. Bust 450 from jail. Buy 6,000 bullets from the armoury.", "reward_cash_immediate": 15_000_000, "reward_points": 600, "reward_respect": 96, "reward_tribute": 1_000_000, "reward_tribute_daily": 10_000_000, "reward_respect_daily": 165, "reward_tribute_bullets_daily": 6_000, "reward_tribute_tokens_daily": 5, "reward_bullets": 60_000, "difficulty": 22, "unlocks_city": None, "character_id": None, "is_boss": True},
    {"id": "m_23", "city": "Start", "area": "—", "order": 22, "type": "special", "requirements": {"gta": 350, "uncommon_cars_scrapped": 85, "booze_sells": 500, "deposit_interest": 150_000_000}, "title": "Dynasty", "description": "Steal 350 cars. Scrap 85 uncommon cars. Do 500 booze runs. Add $150M to the interest bank.", "reward_cash_immediate": 18_000_000, "reward_points": 650, "reward_respect": 105, "reward_tribute": 1_200_000, "reward_tribute_daily": 11_000_000, "reward_respect_daily": 180, "reward_tribute_bullets_daily": 6_500, "reward_tribute_tokens_daily": 5, "reward_token": "random", "difficulty": 23, "unlocks_city": None, "character_id": None, "is_boss": True},
    {"id": "m_24", "city": "Start", "area": "—", "order": 23, "type": "special", "requirements": {"crimes": 30000, "jail_busts": 600, "cars_melted": 60, "hitlist_npc_kills": 150}, "title": "Immortal", "description": "Commit 30,000 crimes. Bust 600 from jail. Melt 60 cars. Kill 150 hitlist NPCs.", "reward_cash_immediate": 22_000_000, "reward_points": 700, "reward_respect": 115, "reward_tribute": 1_500_000, "reward_tribute_daily": 12_000_000, "reward_respect_daily": 200, "reward_tribute_bullets_daily": 7_000, "reward_tribute_tokens_daily": 6, "reward_bullets": 75_000, "difficulty": 24, "unlocks_city": None, "character_id": None, "is_boss": True},
    {"id": "m_25", "city": "Start", "area": "—", "order": 24, "type": "special", "requirements": {"uncommon_cars_stolen": 125, "deposit_interest": 250_000_000, "bullets_melted": 150_000, "booze_sells": 750, "gta": 500}, "title": "Godfather", "description": "Steal 125 uncommon cars. Add $250M to the interest bank. Melt 150,000 bullets. Do 750 booze runs. Steal 500 cars.", "reward_cash_immediate": 30_000_000, "reward_points": 800, "reward_respect": 130, "reward_tribute": 2_000_000, "reward_tribute_daily": 15_000_000, "reward_respect_daily": 250, "reward_tribute_bullets_daily": 10_000, "reward_tribute_tokens_daily": 8, "reward_bullets": 100_000, "reward_token": "random", "difficulty": 25, "unlocks_city": None, "character_id": None, "is_boss": True},
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
    if req_key == "uncommon_cars_stolen":
        return int(user.get("uncommon_cars_stolen") or 0)
    if req_key == "deposit_interest":
        return int(user.get("total_interest_deposited") or 0)
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
        # Cap displayed progress at target so we show e.g. 200/200 not 202/200
        display = min(current, target)
        if key == "rank_id":
            rank_name = next((r["name"] for r in RANKS if r["id"] == target), str(target))
            parts.append(f"Reach {rank_name}: {display}/{target}" if not met else f"Reach {rank_name}: done")
        elif key == "hitlist_npc_kills":
            parts.append(f"{display}/{target} hitlist NPC kills")
        elif key == "money_earned":
            parts.append(f"${display:,} / ${target:,} earned")
        elif key == "booze_sells":
            parts.append(f"{display}/{target} booze runs")
        elif key == "jail_busts":
            parts.append(f"{display}/{target} jail busts")
        elif key == "jail_busts_npc":
            parts.append(f"Bust 1 NPC from jail: {display}/1")
        elif key == "gta":
            parts.append(f"{display}/{target} cars stolen")
        elif key == "crimes":
            parts.append(f"{display}/{target} crimes")
        elif key == "crime_profit":
            parts.append(f"${display:,} / ${target:,} crime profit")
        elif key == "snitch_count":
            parts.append(f"Snitch on someone (in jail): {display}/{target}")
        elif key == "cars_melted":
            parts.append(f"{display}/{target} cars melted")
        elif key == "bullets_melted":
            parts.append(f"{display}/{target} bullets melted")
        elif key == "bullets_purchased_armoury":
            parts.append(f"{display}/{target} bullets from armoury")
        elif key == "uncommon_cars_scrapped":
            parts.append(f"{display}/{target} uncommon cars scrapped")
        elif key == "uncommon_cars_stolen":
            parts.append(f"{display}/{target} uncommon cars stolen")
        elif key == "deposit_interest":
            parts.append(f"${display:,} / ${target:,} to interest bank")
        else:
            parts.append(f"{display}/{target}")
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
            "reward_respect_daily": m.get("reward_respect_daily", 0),
            "reward_points": m.get("reward_points", 0),
            "reward_respect": m.get("reward_respect", 0),
            "reward_tribute": m.get("reward_tribute", 0),
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
            "reward_respect_daily": m.get("reward_respect_daily", 0),
            "reward_points": m.get("reward_points", 0),
            "reward_respect": m.get("reward_respect", 0),
            "reward_tribute": m.get("reward_tribute", 0),
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
    tribute_loot_box_pieces = int(current_user.get("tribute_loot_box_pieces") or 0)
    tribute_respect = int(current_user.get("tribute_respect") or 0)
    tribute_doc = await db.game_config.find_one({"id": TRIBUTE_DEPOSIT_CONFIG_ID}, {"_id": 0, "deposit_utc_hour": 1})
    deposit_hour = int(tribute_doc.get("deposit_utc_hour") or TRIBUTE_DEPOSIT_UTC_HOUR) % 24 if tribute_doc else TRIBUTE_DEPOSIT_UTC_HOUR
    next_deposit_iso, deposit_time_label = _next_tribute_deposit_utc(deposit_hour)
    has_mission_1 = FIRST_MISSION_ID in completed_ids
    has_mission_2 = SECOND_MISSION_ID in completed_ids
    has_mission_3 = THIRD_MISSION_ID in completed_ids
    has_mission_4 = FOURTH_MISSION_ID in completed_ids
    # Calculate total daily tokens based on completed missions
    daily_tokens_total = 0
    for mid in completed_ids:
        m = next((x for x in MISSIONS if x["id"] == mid), None)
        if m:
            daily_tokens_total += int(m.get("reward_tribute_tokens_daily") or 0)
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
        "daily_tribute_tokens_total": daily_tokens_total,
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
    mult = float(get_prestige_bonus(current_user).get("mission_reward_mult") or 1.0)
    reward_money = int((mission.get("reward_money") or 0) * mult)
    reward_cash_immediate = int((mission.get("reward_cash_immediate") or 0) * mult)
    reward_points = int((mission.get("reward_points") or 0) * mult)
    reward_respect = int((mission.get("reward_respect") or 0) * mult)
    reward_tribute = int((mission.get("reward_tribute") or 0) * mult)
    reward_car_id = (mission.get("reward_car_id") or "").strip() or None
    reward_car_ids = mission.get("reward_car_ids") or []
    reward_booze = mission.get("reward_booze")
    reward_bullets = int((mission.get("reward_bullets") or 0) * mult)
    reward_loot_box_pieces = int((mission.get("reward_loot_box_pieces") or 0) * mult)
    reward_token = mission.get("reward_token")
    unlocks_city = mission.get("unlocks_city")

    tribute_bank_inc = reward_money + reward_tribute

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
    if isinstance(reward_booze, dict) and reward_booze:
        booze_ids = [b["id"] for b in BOOZE_TYPES]
        for bid, amt in reward_booze.items():
            if bid in booze_ids and amt and int(amt) > 0:
                update.setdefault("$inc", {})[f"booze_carrying.{bid}"] = int(amt)
                update.setdefault("$set", {})[f"booze_carrying_cost.{bid}"] = 0
    token_awarded = None
    if reward_token:
        if reward_token == "random":
            token_awarded = random.choice(TOKEN_TYPES)
        elif reward_token in TOKEN_TYPES:
            token_awarded = reward_token
        if token_awarded:
            token_field = TOKEN_CONFIG[token_awarded]["count_field"]
            update.setdefault("$inc", {})[token_field] = 1
    if unlocks_city:
        update.setdefault("$set", {})["unlocked_maps_up_to"] = unlocks_city

    await db.users.update_one({"id": user_id}, update)
    if reward_respect:
        await log_respect_earned(user_id, reward_respect, "missions")

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
        "reward_respect": reward_respect,
        "reward_tribute": reward_tribute,
        "reward_car_id": reward_car_id,
        "reward_car_ids": reward_car_ids,
        "reward_booze": reward_booze if isinstance(reward_booze, dict) else None,
        "reward_bullets": reward_bullets,
        "reward_loot_box_pieces": reward_loot_box_pieces,
        "unlocked_city": unlocks_city,
    }


async def collect_tribute(current_user: dict = Depends(get_current_user)):
    """Collect accumulated tribute (cash, bullets, loot box pieces, respect, tokens) into balance. All daily rewards stack until collected."""
    user_id = current_user["id"]
    bank = int(current_user.get("tribute_bank") or 0)
    bullets = int(current_user.get("tribute_bullets") or 0)
    loot_pieces = int(current_user.get("tribute_loot_box_pieces") or 0)
    respect = int(current_user.get("tribute_respect") or 0)
    tokens = int(current_user.get("tribute_tokens") or 0)
    if bank <= 0 and bullets <= 0 and loot_pieces <= 0 and respect <= 0 and tokens <= 0:
        return {
            "collected": 0, "collected_bullets": 0, "collected_loot_box_pieces": 0, "collected_respect": 0, "collected_tokens": 0,
            "tribute_bank": 0, "tribute_bullets": 0, "tribute_loot_box_pieces": 0, "tribute_respect": 0, "tribute_tokens": 0,
            "message": "No tribute to collect",
        }
    update = {"$set": {}}
    if bank > 0:
        update["$inc"] = update.get("$inc", {})
        update["$inc"]["money"] = bank
        update["$set"]["tribute_bank"] = 0
    if bullets > 0:
        update["$inc"] = update.get("$inc", {})
        update["$inc"]["bullets"] = bullets
        update["$set"]["tribute_bullets"] = 0
    if loot_pieces > 0:
        update["$inc"] = update.get("$inc", {})
        update["$inc"]["loot_box_pieces"] = loot_pieces
        update["$set"]["tribute_loot_box_pieces"] = 0
    if respect > 0:
        update["$inc"] = update.get("$inc", {})
        update["$inc"]["respect_points"] = respect
        update["$set"]["tribute_respect"] = 0
    # For tokens, grant random tokens from the pool
    tokens_awarded = {}
    if tokens > 0:
        update["$inc"] = update.get("$inc", {})
        update["$set"]["tribute_tokens"] = 0
        for _ in range(tokens):
            token_type = random.choice(TOKEN_TYPES)
            token_field = TOKEN_CONFIG[token_type]["count_field"]
            update["$inc"][token_field] = update["$inc"].get(token_field, 0) + 1
            tokens_awarded[token_type] = tokens_awarded.get(token_type, 0) + 1
    await db.users.update_one({"id": user_id}, update)
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


# Derived from MISSIONS for map/tribute info (single source of truth)
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
# Loot box pieces in daily tribute: base for all users, extra for mission 2 completers
DAILY_TRIBUTE_LOOT_BOX_PIECES = int(os.environ.get("DAILY_TRIBUTE_LOOT_BOX_PIECES", "1"))
MISSION_2_DAILY_LOOT_BOX_PIECES = int(os.environ.get("MISSION_2_DAILY_LOOT_BOX_PIECES", "1"))


async def run_daily_tribute_deposit():
    """
    Credit DAILY_TRIBUTE_AMOUNT to every user's tribute_bank once per day at deposit_utc_hour (UTC).
    Deposit time and "already ran today" are stored in game_config (id=tribute_deposit): deposit_utc_hour, last_run_utc_date.
    We atomically claim the run for today (set last_run_utc_date only when not already today) so a restart or multiple workers cannot double-pay.
    For each mission, users who completed it get that mission's reward_tribute_daily, reward_respect_daily,
    reward_tribute_bullets_daily, and reward_tribute_tokens_daily (random tokens). Mission 2 also gets extra loot_box_pieces.
    """
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    doc = await db.game_config.find_one({"id": TRIBUTE_DEPOSIT_CONFIG_ID}, {"_id": 0, "deposit_utc_hour": 1, "last_run_utc_date": 1})
    deposit_hour = int(doc.get("deposit_utc_hour") or TRIBUTE_DEPOSIT_UTC_HOUR) % 24 if doc else TRIBUTE_DEPOSIT_UTC_HOUR
    if now.hour != deposit_hour:
        return
    # Atomic claim: only update last_run_utc_date if it is not already today (prevents double-pay on restart or multiple workers)
    claim_filter = {
        "id": TRIBUTE_DEPOSIT_CONFIG_ID,
        "$or": [{"last_run_utc_date": {"$ne": today}}, {"last_run_utc_date": {"$exists": False}}],
    }
    claim_result = await db.game_config.update_one(claim_filter, {"$set": {"last_run_utc_date": today}}, upsert=True)
    if claim_result.modified_count == 0 and claim_result.upserted_id is None:
        return  # already ran today
    # All daily rewards stack in tribute buckets until user collects (cash, bullets, respect, loot)
    result = await db.users.update_many(
        {},
        {"$inc": {"tribute_bank": DAILY_TRIBUTE_AMOUNT, "tribute_loot_box_pieces": DAILY_TRIBUTE_LOOT_BOX_PIECES}},
    )
    counts = {}
    for m in MISSIONS:
        mid = m.get("id")
        cash = int(m.get("reward_tribute_daily") or 0)
        respect = int(m.get("reward_respect_daily") or 0)
        bullets = int(m.get("reward_tribute_bullets_daily") or 0)
        tokens = int(m.get("reward_tribute_tokens_daily") or 0)
        inc = {}
        if cash:
            inc["tribute_bank"] = cash
        if respect:
            inc["tribute_respect"] = respect
        if bullets:
            inc["tribute_bullets"] = bullets
        if tokens:
            inc["tribute_tokens"] = tokens
        if mid == "m_second":
            inc["tribute_loot_box_pieces"] = MISSION_2_DAILY_LOOT_BOX_PIECES
        if not inc:
            continue
        r = await db.users.update_many(
            {"mission_completions": {"$elemMatch": {"mission_id": mid}}},
            {"$inc": inc},
        )
        counts[mid] = r.modified_count
    
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
        "Daily tribute deposit: %s cash + %s loot to %d users; per-mission bonuses %s; completed_it tokens to %d users at %s UTC",
        DAILY_TRIBUTE_AMOUNT,
        DAILY_TRIBUTE_LOOT_BOX_PIECES,
        result.modified_count,
        counts,
        completed_it_result.modified_count,
        today,
    )


def register(router):
    router.add_api_route("/missions", get_missions, methods=["GET"])
    router.add_api_route("/missions/map", get_missions_map, methods=["GET"])
    router.add_api_route("/missions/complete", complete_mission, methods=["POST"])
    router.add_api_route("/missions/collect-tribute", collect_tribute, methods=["POST"])
    router.add_api_route("/missions/characters", get_missions_characters, methods=["GET"])