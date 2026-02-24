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

# City order for map progression (same as STATES)
CITY_ORDER = list(STATES) if STATES else ["Chicago", "New York", "Las Vegas", "Atlantic City"]

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
# MISSION DEFINITIONS
#
# Requirement types:
#   crimes           – cumulative total_crimes on user
#   crime_profit     – cumulative crime_profit on user
#   hitlist_npc_kills– cumulative hitlist_npc_kills on user
#   gta              – cumulative total_gta on user
#   jail_busts       – cumulative jail_busts on user
#   booze_sells      – cumulative booze_runs_count on user
#   rank_id          – current rank id (from rank_points)
#   money_earned     – cumulative total_money_earned on user (NOT current balance!)
#   complete_missions– list of mission ids that must be completed (boss missions only)
#
# NOTE: earn_money was renamed to money_earned and now checks total_money_earned
# (a cumulative counter) instead of current balance. This prevents missions from
# becoming impossible if the player spends their money.
#
# Boss missions are the ONLY missions that depend on other missions being done first.
# Every other mission only checks cumulative player stats and can be attempted
# in any order, in parallel, without blocking each other.
# ─────────────────────────────────────────────────────────────────────────────

MISSIONS = [
    # ── CHICAGO ──────────────────────────────────────────────────────────────
    # Districts: The Loop, South Side, West Side, North Side, Near North, Stockyards
    {
        "id": "m_chicago_start",
        "city": "Chicago",
        "area": "The Loop",
        "order": 0,
        "type": "starter",
        "requirements": {"crimes": 0},
        "title": "Meet the Fixer",
        "description": "The outfit runs this city. Report to the Fixer in The Loop — he'll put you to work.",
        "reward_money": 100,
        "reward_points": 2,
        "difficulty": 1,
        "unlocks_city": None,
        "character_id": "char_chicago_fixer",
        "is_boss": False,
    },
    {
        "id": "m_chicago_crimes",
        "city": "Chicago",
        "area": "The Loop",
        "order": 1,
        "type": "crime_count",
        "requirements": {"crimes": 5},
        "title": "Prove Your Nerve",
        "description": "Commit 5 crimes. The outfit wants to see you can handle the heat.",
        "reward_money": 500,
        "reward_points": 10,
        "difficulty": 2,
        "unlocks_city": None,
        "character_id": "char_chicago_fixer",
        "is_boss": False,
    },
    {
        "id": "m_chicago_earn",
        "city": "Chicago",
        "area": "West Side",
        "order": 2,
        "type": "money_earned",
        "requirements": {"money_earned": 1000},
        "title": "Show Me the Money",
        "description": "Earn $1,000 total from crimes. The Bookkeeper wants to see you can make it rain.",
        "reward_money": 300,
        "reward_points": 5,
        "difficulty": 3,
        "unlocks_city": None,
        "character_id": "char_chicago_bookkeeper",
        "is_boss": False,
    },
    {
        "id": "m_chicago_attacks",
        "city": "Chicago",
        "area": "South Side",
        "order": 3,
        "type": "hitlist_npc_kills",
        "requirements": {"hitlist_npc_kills": 2},
        "title": "Collect a Debt",
        "description": "Kill 2 hitlist NPCs. Add them from the Hitlist, then take them out. Someone's behind on a debt.",
        "reward_money": 400,
        "reward_points": 8,
        "difficulty": 4,
        "unlocks_city": None,
        "character_id": "char_chicago_enforcer",
        "is_boss": False,
    },
    {
        "id": "m_chicago_north",
        "city": "Chicago",
        "area": "North Side",
        "order": 4,
        "type": "crime_count",
        "requirements": {"crimes": 8},
        "title": "North Side Heat",
        "description": "Run 8 jobs up north. They need to know who runs this town.",
        "reward_money": 450,
        "reward_points": 8,
        "difficulty": 4,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": "m_chicago_near_north",
        "city": "Chicago",
        "area": "Near North",
        "order": 5,
        "type": "money_earned",
        "requirements": {"money_earned": 2500},
        "title": "Near North Take",
        "description": "Earn $2,500 total. The big players are watching.",
        "reward_money": 600,
        "reward_points": 10,
        "difficulty": 5,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": "m_chicago_stockyards",
        "city": "Chicago",
        "area": "Stockyards",
        "order": 6,
        "type": "hitlist_npc_kills",
        "requirements": {"hitlist_npc_kills": 4},
        "title": "Stockyards Muscle",
        "description": "Kill 4 hitlist NPCs from the Hitlist. Show them we own the yards.",
        "reward_money": 550,
        "reward_points": 9,
        "reward_bullets": 50,
        "difficulty": 5,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        # BOSS: only unlocks after all 7 Chicago missions complete
        "id": "m_chicago_boss",
        "city": "Chicago",
        "area": "The Loop",
        "order": 99,
        "type": "special",
        "requirements": {
            "complete_missions": [
                "m_chicago_start", "m_chicago_crimes", "m_chicago_earn",
                "m_chicago_attacks", "m_chicago_north", "m_chicago_near_north",
                "m_chicago_stockyards",
            ],
            "complete_missions_min_count": 7,  # ALL 7 must be done
        },
        "title": "See the Old Man",
        "description": "Complete every job across Chicago. The Old Man doesn't see just anyone — finish the list first, then report to him for your ticket to New York.",
        "reward_money": 1000,
        "reward_points": 20,
        "difficulty": 9,
        "unlocks_city": "New York",
        "character_id": "char_chicago_boss",
        "is_boss": True,
    },

    # ── NEW YORK ──────────────────────────────────────────────────────────────
    # Districts: Financial District, Chinatown, Greenwich Village, Midtown,
    #            Upper West Side, Upper East Side, Harlem, Bronx, Brooklyn Heights,
    #            Williamsburg, Queens, Staten Island
    {
        "id": "m_ny_smuggle",
        "city": "New York",
        "area": "Brooklyn Heights",
        "order": 1,
        "type": "booze_sells",
        "requirements": {"booze_sells": 3},
        "title": "Run the Route",
        "description": "Complete 3 booze run deliveries. We need a driver who doesn't ask questions.",
        "reward_money": 600,
        "reward_points": 12,
        "reward_booze": {"bathtub_gin": 15, "moonshine": 10},
        "difficulty": 3,
        "unlocks_city": None,
        "character_id": "char_ny_smuggler",
        "is_boss": False,
    },
    {
        "id": "m_ny_busts",
        "city": "New York",
        "area": "Financial District",
        "order": 2,
        "type": "jail_busts",
        "requirements": {"jail_busts": 2},
        "title": "Spring Him",
        "description": "Bust 2 players or NPCs out of jail. The Mouthpiece needs them on the street.",
        "reward_money": 500,
        "reward_points": 10,
        "difficulty": 4,
        "unlocks_city": None,
        "character_id": "char_ny_mouthpiece",
        "is_boss": False,
    },
    {
        "id": "m_ny_gta",
        "city": "New York",
        "area": "Williamsburg",
        "order": 3,
        "type": "gta_count",
        "requirements": {"gta": 3},
        "title": "Three Cars by Friday",
        "description": "Steal 3 cars. The Mechanic needs wheels.",
        "reward_money": 700,
        "reward_points": 14,
        "reward_car_id": "car2",
        "difficulty": 4,
        "unlocks_city": None,
        "character_id": "char_ny_mechanic",
        "is_boss": False,
    },
    {
        "id": "m_ny_chinatown",
        "city": "New York",
        "area": "Chinatown",
        "order": 4,
        "type": "crime_count",
        "requirements": {"crimes": 10},
        "title": "Chinatown Run",
        "description": "Ten jobs in Chinatown. Keep the tongs in line.",
        "reward_money": 650,
        "reward_points": 12,
        "difficulty": 5,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": "m_ny_greenwich",
        "city": "New York",
        "area": "Greenwich Village",
        "order": 5,
        "type": "money_earned",
        "requirements": {"money_earned": 3000},
        "title": "Village Vig",
        "description": "Earn $3,000 total. The artists pay up or they leave.",
        "reward_money": 700,
        "reward_points": 12,
        "difficulty": 5,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": "m_ny_upper_west",
        "city": "New York",
        "area": "Upper West Side",
        "order": 6,
        "type": "jail_busts",
        "requirements": {"jail_busts": 3},
        "title": "West Side Spring",
        "description": "Bust 3 out of jail. The Upper West needs our people back.",
        "reward_money": 600,
        "reward_points": 11,
        "difficulty": 5,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": "m_ny_upper_east",
        "city": "New York",
        "area": "Upper East Side",
        "order": 7,
        "type": "crime_count",
        "requirements": {"crimes": 12},
        "title": "East Side Take",
        "description": "Twelve jobs on the Upper East. The money's there if you're bold.",
        "reward_money": 800,
        "reward_points": 14,
        "difficulty": 6,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": "m_ny_harlem",
        "city": "New York",
        "area": "Harlem",
        "order": 8,
        "type": "hitlist_npc_kills",
        "requirements": {"hitlist_npc_kills": 5},
        "title": "Harlem Rules",
        "description": "Kill 5 hitlist NPCs from the Hitlist. Show them who runs the numbers.",
        "reward_money": 750,
        "reward_points": 13,
        "difficulty": 6,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": "m_ny_bronx",
        "city": "New York",
        "area": "Bronx",
        "order": 9,
        "type": "gta_count",
        "requirements": {"gta": 5},
        "title": "Bronx Wheels",
        "description": "Steal 5 cars in the Bronx. The Mechanic's buyers are waiting.",
        "reward_money": 850,
        "reward_points": 14,
        "difficulty": 6,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": "m_ny_queens",
        "city": "New York",
        "area": "Queens",
        "order": 10,
        "type": "booze_sells",
        "requirements": {"booze_sells": 5},
        "title": "Queens Delivery",
        "description": "Five booze runs into Queens. The route's hot but the payoff's worth it.",
        "reward_money": 900,
        "reward_points": 15,
        "difficulty": 7,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": "m_ny_staten",
        "city": "New York",
        "area": "Staten Island",
        "order": 11,
        "type": "money_earned",
        "requirements": {"money_earned": 5000},
        "title": "Staten Island Score",
        "description": "Earn $5,000 total. Quiet but profitable.",
        "reward_money": 950,
        "reward_points": 16,
        "difficulty": 7,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        # BOSS: requires 8 of 11 NY missions (player can skip 3 harder ones)
        "id": "m_ny_boss",
        "city": "New York",
        "area": "Midtown",
        "order": 99,
        "type": "special",
        "requirements": {
            "complete_missions": [
                "m_ny_smuggle", "m_ny_busts", "m_ny_gta", "m_ny_chinatown",
                "m_ny_greenwich", "m_ny_upper_west", "m_ny_upper_east",
                "m_ny_harlem", "m_ny_bronx", "m_ny_queens", "m_ny_staten",
            ],
            "complete_missions_min_count": 8,  # 8 of 11 — some flexibility
        },
        "title": "NY Boss",
        "description": "Prove yourself across New York. Report to the NY Boss when 8 district jobs are done — he'll get you to Vegas.",
        "reward_money": 1500,
        "reward_points": 25,
        "difficulty": 9,
        "unlocks_city": "Las Vegas",
        "character_id": "char_ny_boss",
        "is_boss": True,
    },

    # ── LAS VEGAS ─────────────────────────────────────────────────────────────
    # Districts: The Strip, Downtown, Paradise, Summerlin, Henderson,
    #            North Las Vegas, Arts District, Boulder Strip
    {
        "id": "m_vegas_earn",
        "city": "Las Vegas",
        "area": "Summerlin",
        "order": 1,
        "type": "money_earned",
        "requirements": {"money_earned": 10000},
        "title": "Earn Your Share",
        "description": "Earn $10,000 total. We're building something big out here.",
        "reward_money": 1000,
        "reward_points": 15,
        "difficulty": 4,
        "unlocks_city": None,
        "character_id": "char_vegas_builder",
        "is_boss": False,
    },
    {
        "id": "m_vegas_crimes",
        "city": "Las Vegas",
        "area": "The Strip",
        "order": 2,
        "type": "crime_count",
        "requirements": {"crimes": 15},
        "title": "High Stakes",
        "description": "Commit 15 crimes. The house always wins — unless you're with us.",
        "reward_money": 800,
        "reward_points": 12,
        "difficulty": 6,
        "unlocks_city": None,
        "character_id": "char_vegas_gambler",
        "is_boss": False,
    },
    {
        "id": "m_vegas_paradise",
        "city": "Las Vegas",
        "area": "Paradise",
        "order": 3,
        "type": "crime_profit",
        "requirements": {"crime_profit": 8000},
        "title": "Paradise Take",
        "description": "Earn $8,000 total from crimes. The strip's shadow pays well.",
        "reward_money": 1100,
        "reward_points": 14,
        "difficulty": 6,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": "m_vegas_henderson",
        "city": "Las Vegas",
        "area": "Henderson",
        "order": 4,
        "type": "crime_count",
        "requirements": {"crimes": 20},
        "title": "Henderson Heat",
        "description": "Twenty jobs in Henderson. They need to know the outfit runs the valley.",
        "reward_money": 1200,
        "reward_points": 15,
        "difficulty": 7,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": "m_vegas_north",
        "city": "Las Vegas",
        "area": "North Las Vegas",
        "order": 5,
        "type": "hitlist_npc_kills",
        "requirements": {"hitlist_npc_kills": 6},
        "title": "North Vegas Muscle",
        "description": "Kill 6 hitlist NPCs from the Hitlist. Rough territory but we're taking it.",
        "reward_money": 1000,
        "reward_points": 13,
        "difficulty": 6,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": "m_vegas_arts",
        "city": "Las Vegas",
        "area": "Arts District",
        "order": 6,
        "type": "crime_profit",
        "requirements": {"crime_profit": 6000},
        "title": "Arts District Score",
        "description": "Pull in $6,000 total from crime. The galleries have deep pockets.",
        "reward_money": 950,
        "reward_points": 12,
        "difficulty": 5,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        "id": "m_vegas_boulder",
        "city": "Las Vegas",
        "area": "Boulder Strip",
        "order": 7,
        "type": "money_earned",
        "requirements": {"money_earned": 25000},
        "title": "Boulder Strip Bank",
        "description": "Earn $25,000 total. The Boulder crowd plays for keeps.",
        "reward_money": 1500,
        "reward_points": 16,
        "difficulty": 7,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        # BOSS: requires 5 of 7 Vegas missions
        "id": "m_vegas_boss",
        "city": "Las Vegas",
        "area": "Downtown",
        "order": 99,
        "type": "special",
        "requirements": {
            "complete_missions": [
                "m_vegas_earn", "m_vegas_crimes", "m_vegas_paradise",
                "m_vegas_henderson", "m_vegas_north", "m_vegas_arts", "m_vegas_boulder",
            ],
            "complete_missions_min_count": 5,  # 5 of 7
        },
        "title": "Vegas Boss",
        "description": "Five jobs across Vegas done. The Boss will see you now — and if you impress him, Atlantic City is next.",
        "reward_money": 2000,
        "reward_points": 30,
        "difficulty": 9,
        "unlocks_city": "Atlantic City",
        "character_id": "char_vegas_boss",
        "is_boss": True,
    },

    # ── ATLANTIC CITY ─────────────────────────────────────────────────────────
    # Districts: Boardwalk, Marina District, Inlet, Chelsea
    {
        "id": "m_ac_rank",
        "city": "Atlantic City",
        "area": "Boardwalk",
        "order": 1,
        "type": "rank",
        "requirements": {"rank_id": 3},
        "title": "Prove You're Made",
        "description": "Reach Hustler rank. Last stop — show the Shore Boss you're made.",
        "reward_money": 1500,
        "reward_points": 20,
        "difficulty": 7,
        "unlocks_city": None,
        "character_id": "char_ac_shore_boss",
        "is_boss": False,
    },
    {
        "id": "m_ac_busts",
        "city": "Atlantic City",
        "area": "Marina District",
        "order": 2,
        "type": "jail_busts",
        "requirements": {"jail_busts": 5},
        "title": "Keep the Heat Off",
        "description": "Bust 5 people out of jail. Pay the right people, keep the law off our backs.",
        "reward_money": 1200,
        "reward_points": 18,
        "difficulty": 7,
        "unlocks_city": None,
        "character_id": "char_ac_cop",
        "is_boss": False,
    },
    {
        "id": "m_ac_inlet",
        "city": "Atlantic City",
        "area": "Inlet",
        "order": 3,
        "type": "crime_count",
        "requirements": {"crimes": 18},
        "title": "Inlet Jobs",
        "description": "Eighteen jobs in the Inlet. The docks are ours.",
        "reward_money": 1100,
        "reward_points": 16,
        "difficulty": 6,
        "unlocks_city": None,
        "character_id": None,
        "is_boss": False,
    },
    {
        # BOSS: requires all 3 AC missions
        "id": "m_ac_commission",
        "city": "Atlantic City",
        "area": "Chelsea",
        "order": 99,
        "type": "special",
        "requirements": {
            "complete_missions": ["m_ac_rank", "m_ac_busts", "m_ac_inlet"],
            "complete_missions_min_count": 3,  # ALL 3 must be done
        },
        "title": "The Commission",
        "description": "All three district jobs on the shore are done. You've earned your seat at the table — report to the Commission in Chelsea.",
        "reward_money": 3000,
        "reward_points": 50,
        "difficulty": 10,
        "unlocks_city": None,
        "character_id": "char_ac_commission",
        "is_boss": True,
    },
]

# Lookup mission id -> title
MISSION_ID_TO_TITLE = {m["id"]: m["title"] for m in MISSIONS}

# ─────────────────────────────────────────────────────────────────────────────
# CHARACTERS
# ─────────────────────────────────────────────────────────────────────────────

MISSION_CHARACTERS = [
    {"id": "char_chicago_fixer", "name": "The Fixer", "city": "Chicago", "area": "The Loop", "role": "fixer",
     "dialogue_intro": "The outfit's always looking for reliable people. You want in? Show me what you can do.",
     "dialogue_mission_offer": "Commit five jobs. No questions. Come back when it's done.",
     "dialogue_in_progress": "Come back when it's done.",
     "dialogue_complete": "You're good. Go see the Bookkeeper on the West Side — he'll have more work."},
    {"id": "char_chicago_bookkeeper", "name": "The Bookkeeper", "city": "Chicago", "area": "West Side", "role": "bookkeeper",
     "dialogue_intro": "I don't care about names. I care about numbers. Show me you can make money.",
     "dialogue_mission_offer": "Earn a grand from the street. Bring the vig. Then we talk.",
     "dialogue_in_progress": "No vig, no talk. Get to work.",
     "dialogue_complete": "You'll do. The Enforcer on the South Side needs someone with nerve. Go."},
    {"id": "char_chicago_enforcer", "name": "The Enforcer", "city": "Chicago", "area": "South Side", "role": "enforcer",
     "dialogue_intro": "Someone's behind on a debt. I need a reminder delivered. You in?",
     "dialogue_mission_offer": "Win two fights. No excuses. Then the Old Man might see you.",
     "dialogue_in_progress": "Two. Not one. Come back when you're done.",
     "dialogue_complete": "You've got a mean streak. The Old Man wants to see you. The Loop."},
    {"id": "char_chicago_boss", "name": "The Old Man", "city": "Chicago", "area": "The Loop", "role": "boss",
     "dialogue_intro": "You've done good work. Finish everything across the city and I'll get you a ticket to New York.",
     "dialogue_mission_offer": "All seven jobs. Every district. Come back when the ledger's clean.",
     "dialogue_in_progress": "Not yet. Finish the list. All of it.",
     "dialogue_complete": "You're ready. New York's waiting. Don't disappoint me."},
    {"id": "char_ny_smuggler", "name": "The Smuggler", "city": "New York", "area": "Brooklyn Heights", "role": "smuggler",
     "dialogue_intro": "We need a driver. Run the route, don't ask questions. You in?",
     "dialogue_mission_offer": "Three deliveries. Booze. Get it done.",
     "dialogue_in_progress": "Run the route. Come back when you're done.",
     "dialogue_complete": "Good. The Mouthpiece might have work for you."},
    {"id": "char_ny_mouthpiece", "name": "The Mouthpiece", "city": "New York", "area": "Financial District", "role": "mouthpiece",
     "dialogue_intro": "One of ours is in the can. I need him out. You do the heavy lifting.",
     "dialogue_mission_offer": "Bust two out. Jail. You know the drill.",
     "dialogue_in_progress": "Two. Then we talk.",
     "dialogue_complete": "The Mechanic needs wheels. Williamsburg. Go."},
    {"id": "char_ny_mechanic", "name": "The Mechanic", "city": "New York", "area": "Williamsburg", "role": "mechanic",
     "dialogue_intro": "We need three cars by Friday. Clean jobs. You in?",
     "dialogue_mission_offer": "Steal three cars. Bring them in. That's it.",
     "dialogue_in_progress": "Three cars. Friday.",
     "dialogue_complete": "You're solid. The Boss wants to see you. Midtown."},
    {"id": "char_ny_boss", "name": "NY Boss", "city": "New York", "area": "Midtown", "role": "boss",
     "dialogue_intro": "Vegas is next. Do eight jobs across the boroughs first.",
     "dialogue_mission_offer": "Eight districts. Then I'll look at you.",
     "dialogue_in_progress": "Not enough. Keep working.",
     "dialogue_complete": "You're ready for Vegas. Don't look back."},
    {"id": "char_vegas_builder", "name": "The Builder", "city": "Las Vegas", "area": "Summerlin", "role": "builder",
     "dialogue_intro": "We're putting something big out here. Earn your share.",
     "dialogue_mission_offer": "Earn ten grand. Show me you're serious.",
     "dialogue_in_progress": "Ten thousand. Then we talk.",
     "dialogue_complete": "The Gambler has more work. The Strip."},
    {"id": "char_vegas_gambler", "name": "The Gambler", "city": "Las Vegas", "area": "The Strip", "role": "gambler",
     "dialogue_intro": "The house always wins. Unless you're with us. Prove it.",
     "dialogue_mission_offer": "Fifteen jobs. Crimes. Then the Boss sees you.",
     "dialogue_in_progress": "Fifteen. No less.",
     "dialogue_complete": "You're in. The Boss. Downtown."},
    {"id": "char_vegas_boss", "name": "Vegas Boss", "city": "Las Vegas", "area": "Downtown", "role": "boss",
     "dialogue_intro": "Atlantic City's the last stop. Finish five jobs here first.",
     "dialogue_mission_offer": "Five district jobs. Then I'll get you to the shore.",
     "dialogue_in_progress": "Not yet.",
     "dialogue_complete": "Atlantic City. The Shore Boss is waiting."},
    {"id": "char_ac_shore_boss", "name": "The Shore Boss", "city": "Atlantic City", "area": "Boardwalk", "role": "shore_boss",
     "dialogue_intro": "Last stop. Prove you're made.",
     "dialogue_mission_offer": "Reach Hustler. Then we talk.",
     "dialogue_in_progress": "Hustler. That's the bar.",
     "dialogue_complete": "You're made. The Cop in the Marina District has one more test. Then the Commission."},
    {"id": "char_ac_cop", "name": "The Corrupt Cop", "city": "Atlantic City", "area": "Marina District", "role": "cop",
     "dialogue_intro": "Keep the heat off. Pay the right people. Bust five out of jail.",
     "dialogue_mission_offer": "Bust five. Then the Commission will see you.",
     "dialogue_in_progress": "Five busts. Go.",
     "dialogue_complete": "You're in. The Commission. They're waiting."},
    {"id": "char_ac_commission", "name": "The Commission", "city": "Atlantic City", "area": "Chelsea", "role": "boss",
     "dialogue_intro": "All the shore jobs are done. Finish the list and you're one of us.",
     "dialogue_mission_offer": "All three. Shore Boss, Cop, the Inlet. Then come to me.",
     "dialogue_in_progress": "Not yet. Finish the list.",
     "dialogue_complete": "You're made. Welcome to the Commission."},
]


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _user_unlocked_cities(user: dict) -> List[str]:
    """Return list of cities the user has unlocked (in order). Default: Chicago only."""
    up_to = (user.get("unlocked_maps_up_to") or "").strip() or "Chicago"
    out = []
    for c in CITY_ORDER:
        out.append(c)
        if c == up_to:
            break
    return out


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
    if req_key == "rank_id":
        rp = int(user.get("rank_points") or 0)
        mult = float(user.get("prestige_rank_multiplier") or 1.0)
        rid, _ = get_rank_info(rp, mult)
        return rid
    if req_key == "booze_sells":
        return int(user.get("booze_runs_count") or 0)
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

    for key, target in req.items():
        current = _get_user_progress_value(user, key)
        if key == "rank_id":
            rank_name = next((r["name"] for r in RANKS if r["id"] == target), str(target))
            progress = {"current": current, "target": target, "description": f"Reach {rank_name}"}
        elif key == "hitlist_npc_kills":
            progress = {"current": current, "target": target, "description": f"{current}/{target} hitlist NPC kills"}
        elif key == "money_earned":
            progress = {"current": current, "target": target, "description": f"${current:,} / ${target:,} earned total"}
        elif key == "booze_sells":
            progress = {"current": current, "target": target, "description": f"{current}/{target} booze runs"}
        elif key == "jail_busts":
            progress = {"current": current, "target": target, "description": f"{current}/{target} jail busts"}
        elif key == "gta":
            progress = {"current": current, "target": target, "description": f"{current}/{target} cars stolen"}
        elif key == "crimes":
            progress = {"current": current, "target": target, "description": f"{current}/{target} crimes"}
        elif key == "crime_profit":
            progress = {"current": current, "target": target, "description": f"${current:,} / ${target:,} crime profit"}
        else:
            progress = {"current": current, "target": target, "description": f"{current}/{target}"}
        met = current >= target
        return met, progress

    # starter type — always met
    return True, {"current": 0, "target": 0, "description": "Always available"}


# ─────────────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────────────

async def get_missions(current_user: dict = Depends(get_current_user), city: Optional[str] = None):
    """List missions for unlocked cities with completion status and progress."""
    unlocked = _user_unlocked_cities(current_user)
    completed_ids = _user_completed_mission_ids(current_user)
    missions_out = []
    for m in MISSIONS:
        if m["city"] not in unlocked:
            continue
        if city and m["city"] != city:
            continue
        met, progress = _check_mission_requirements(current_user, m)
        unlocked = _mission_unlocked_by_previous(m, completed_ids)
        requirements_met_final = met and unlocked
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
            "reward_points": m.get("reward_points", 0),
            "reward_car_id": m.get("reward_car_id"),
            "reward_booze": m.get("reward_booze"),
            "reward_bullets": m.get("reward_bullets", 0),
            "unlocks_city": m.get("unlocks_city"),
            "character_id": m.get("character_id"),
            "difficulty": m.get("difficulty", 5),
            "is_boss": m.get("is_boss", False),
            "completed": m["id"] in completed_ids,
            "unlocked": unlocked,
            "previous_mission_title": prev.get("title") if prev and not unlocked else None,
            "requirements_met": requirements_met_final,
            "progress": progress,
        })
    missions_out.sort(key=lambda x: (
        CITY_ORDER.index(x["city"]) if x["city"] in CITY_ORDER else 999,
        # Boss missions always sort last within their city
        1 if x.get("is_boss") else 0,
        x["order"],
    ))
    return {"missions": missions_out, "unlocked_cities": unlocked}


async def get_missions_map(current_user: dict = Depends(get_current_user)):
    """Map state: current city, unlocked cities, areas and missions per city."""
    unlocked = _user_unlocked_cities(current_user)
    current_city = (current_user.get("current_state") or "").strip() or "Chicago"
    if current_city not in CITY_ORDER:
        current_city = CITY_ORDER[0] if CITY_ORDER else "Chicago"
    completed_ids = _user_completed_mission_ids(current_user)
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
        unlocked = _mission_unlocked_by_previous(m, completed_ids)
        requirements_met_final = met and unlocked
        prev = _previous_mission(m)
        entry = {
            "id": m["id"],
            "area": m["area"],
            "order": m["order"],
            "type": m["type"],
            "title": m["title"],
            "description": m["description"],
            "reward_money": m.get("reward_money", 0),
            "reward_points": m.get("reward_points", 0),
            "reward_car_id": m.get("reward_car_id"),
            "reward_booze": m.get("reward_booze"),
            "reward_bullets": m.get("reward_bullets", 0),
            "unlocks_city": m.get("unlocks_city"),
            "character_id": m.get("character_id"),
            "difficulty": m.get("difficulty", 5),
            "is_boss": m.get("is_boss", False),
            "completed": m["id"] in completed_ids,
            "unlocked": unlocked,
            "previous_mission_title": prev.get("title") if prev and not unlocked else None,
            "requirements_met": requirements_met_final,
            "progress": progress,
        }
        by_city[m["city"]]["areas"][area].append(entry)
        by_city[m["city"]]["missions"].append(entry)
    for c in by_city:
        for area in by_city[c]["areas"]:
            by_city[c]["areas"][area].sort(key=lambda x: (1 if x.get("is_boss") else 0, x["order"]))
    tribute_bank = int(current_user.get("tribute_bank") or 0)
    next_deposit_iso, deposit_time_label = _next_tribute_deposit_utc()
    return {
        "current_city": current_city,
        "unlocked_cities": unlocked,
        "cities": list(unlocked),
        "by_city": by_city,
        "tribute_bank": tribute_bank,
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
    reward_points = int(mission.get("reward_points") or 0)
    reward_car_id = (mission.get("reward_car_id") or "").strip() or None
    reward_booze = mission.get("reward_booze")
    reward_bullets = int(mission.get("reward_bullets") or 0)
    unlocks_city = mission.get("unlocks_city")

    completion_doc = {"mission_id": mission_id, "completed_at": datetime.now(timezone.utc).isoformat()}
    update = {"$push": {"mission_completions": completion_doc}}
    if reward_money:
        update.setdefault("$inc", {})["tribute_bank"] = reward_money
    if reward_points:
        update.setdefault("$inc", {})["rank_points"] = reward_points
    if reward_bullets:
        update.setdefault("$inc", {})["bullets"] = reward_bullets
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
        "reward_points": reward_points,
        "reward_car_id": reward_car_id,
        "reward_booze": reward_booze if isinstance(reward_booze, dict) else None,
        "reward_bullets": reward_bullets,
        "unlocked_city": unlocks_city,
    }


async def collect_tribute(current_user: dict = Depends(get_current_user)):
    """Collect accumulated tribute bank into cash."""
    user_id = current_user["id"]
    bank = int(current_user.get("tribute_bank") or 0)
    if bank <= 0:
        return {"collected": 0, "tribute_bank": 0, "message": "No tribute to collect"}
    await db.users.update_one(
        {"id": user_id},
        {"$inc": {"money": bank}, "$set": {"tribute_bank": 0}},
    )
    return {"collected": bank, "tribute_bank": 0, "message": f"Collected {bank} cash"}


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


async def run_daily_tribute_deposit():
    """
    Credit DAILY_TRIBUTE_AMOUNT to every user's tribute_bank once per day at TRIBUTE_DEPOSIT_UTC_HOUR (UTC).
    Idempotent: uses game_config last_run_utc_date so we only run once per calendar day.
    Call from a background ticker (e.g. every 60s) so the deposit happens at the configured hour.
    """
    now = datetime.now(timezone.utc)
    if now.hour != TRIBUTE_DEPOSIT_UTC_HOUR:
        return
    today = now.date().isoformat()
    doc = await db.game_config.find_one({"id": TRIBUTE_DEPOSIT_CONFIG_ID}, {"_id": 0, "last_run_utc_date": 1})
    if doc and doc.get("last_run_utc_date") == today:
        return
    result = await db.users.update_many({}, {"$inc": {"tribute_bank": DAILY_TRIBUTE_AMOUNT}})
    await db.game_config.update_one(
        {"id": TRIBUTE_DEPOSIT_CONFIG_ID},
        {"$set": {"last_run_utc_date": today}},
        upsert=True,
    )
    logging.getLogger(__name__).info(
        "Daily tribute deposit: credited %s to %d users at %s UTC",
        DAILY_TRIBUTE_AMOUNT,
        result.modified_count,
        today,
    )


def register(router):
    router.add_api_route("/missions", get_missions, methods=["GET"])
    router.add_api_route("/missions/map", get_missions_map, methods=["GET"])
    router.add_api_route("/missions/complete", complete_mission, methods=["POST"])
    router.add_api_route("/missions/collect-tribute", collect_tribute, methods=["POST"])
    router.add_api_route("/missions/characters", get_missions_characters, methods=["GET"])