# Racing: bootleg runs / road races (1920s-30s). Choose from historical cars, create/join races, fill with NPCs, simulate, rewards, leaderboard, comps.
#
# System design:
# - Max 18 racing teams; create for $25M (name + colour) or kill a team owner to take theirs.
# - Each day: 2 automated races (morning + evening) with your team/car/upgrades; you get a notification before they start and can watch live. (Scheduler/cron TBD.)
# - 7-day weeks: after 7 days, top 5 teams get good rewards, rest get lesser; then full reset (upgrades, crew bank). Leaderboard winner gets +5% bonus per repeat win, capped at 20%.
# - Seasons last 2 months: after a season, total reset of everything racing (teams cleared, all progress reset).
from datetime import datetime, timezone, timedelta
from pathlib import Path
import asyncio
import json
import os
import random
import re
import uuid
import hashlib
import time
from typing import Optional, List, Dict, Any
from fastapi import Depends, HTTPException, Header

from .racing_lap_engine import (
    LapEngineConfig,
    InteractiveLapResult,
    qual_lap_time,
    run_interactive_lap_turn,
)
from pydantic import BaseModel
from pymongo import UpdateOne

from server import db, get_current_user_verified, get_current_user, maybe_process_rank_up, send_notification, log_gambling, _is_admin

# ---------- Constants ----------
def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _agent_debug_log(location: str, hypothesis_id: str, message: str, data: dict) -> None:
    try:
        log_path = Path(__file__).resolve().parents[3] / "debug-a98925.log"
        line = json.dumps(
            {
                "sessionId": "a98925",
                "location": location,
                "hypothesisId": hypothesis_id,
                "message": message,
                "data": data,
                "timestamp": int(time.time() * 1000),
            }
        )
        with log_path.open("a", encoding="utf-8") as _f:
            _f.write(line + "\n")
    except Exception:
        pass

# Racing cars: 4–5 historically accurate (1920s–30s). Choose one, no purchase. id, name, base_speed, base_grip, image
RACING_CARS: List[dict] = [
    {"id": "ford_model_t_racer", "name": "Ford Model T Racer", "base_speed": 10, "base_grip": 0.92, "image": "/images/gta/car1.jpg"},
    {"id": "packard_734", "name": "Packard 734", "base_speed": 14, "base_grip": 0.88, "image": "/images/gta/car11.jpg"},
    {"id": "stutz_bearcat", "name": "Stutz Bearcat", "base_speed": 18, "base_grip": 0.85, "image": "/images/gta/car14.jpg"},
    {"id": "miller_91", "name": "Miller 91", "base_speed": 22, "base_grip": 0.78, "image": "/images/gta/car15.jpeg"},
    {"id": "duesenberg_model_j", "name": "Duesenberg Model J", "base_speed": 26, "base_grip": 0.82, "image": "/images/gta/car18.jpg"},
]

TRACKS: List[dict] = [
    {"id": "chicago_board", "name": "Chicago Board Track", "reward_mult": 1.0,
     "lap_base": 24, "km": 3.1, "corners": 10, "corner_severity": 0.3, "track_width": 1.0,
     "sectors": [
         {"kind": "straight", "weight": 0.38, "drs": True},
         {"kind": "corner", "weight": 0.34, "drs": False},
         {"kind": "straight", "weight": 0.28, "drs": True},
     ]},
    {"id": "daytona_beach", "name": "Daytona Beach Road Course", "reward_mult": 1.2,
     "lap_base": 28, "km": 4.2, "corners": 6, "corner_severity": 0.35, "track_width": 1.1},
    {"id": "roosevelt", "name": "Roosevelt Raceway", "reward_mult": 1.1,
     "lap_base": 26, "km": 2.8, "corners": 18, "corner_severity": 0.55, "track_width": 0.85},
    {"id": "indianapolis", "name": "Indianapolis Motor Speedway", "reward_mult": 1.3,
     "lap_base": 30, "km": 4.6, "corners": 4, "corner_severity": 0.25, "track_width": 1.2},
    {"id": "boardwalk", "name": "Boardwalk Circuit", "reward_mult": 1.15,
     "lap_base": 27, "km": 3.4, "corners": 22, "corner_severity": 0.6, "track_width": 0.8},
    {"id": "lakeside", "name": "Lakeside Park", "reward_mult": 1.1,
     "lap_base": 28, "km": 3.8, "corners": 14, "corner_severity": 0.4, "track_width": 0.95},
    {"id": "harbor", "name": "Harbor Front", "reward_mult": 1.05,
     "lap_base": 25, "km": 3.0, "corners": 24, "corner_severity": 0.65, "track_width": 0.75},
    {"id": "mountain", "name": "Mountain Pass", "reward_mult": 1.25,
     "lap_base": 32, "km": 4.8, "corners": 22, "corner_severity": 0.6, "track_width": 0.85},
    {"id": "brooklands", "name": "Brooklands Banking", "reward_mult": 1.35,
     "lap_base": 42, "km": 6.4, "corners": 8, "corner_severity": 0.3, "track_width": 1.15},
    {"id": "monza", "name": "Monza Autodromo", "reward_mult": 1.4,
     "lap_base": 52, "km": 8.0, "corners": 14, "corner_severity": 0.5, "track_width": 1.0},
    {"id": "lemans", "name": "Le Mans Sarthe", "reward_mult": 1.5,
     "lap_base": 65, "km": 10.7, "corners": 16, "corner_severity": 0.45, "track_width": 1.05},
    {"id": "avus", "name": "AVUS Speedway", "reward_mult": 1.45,
     "lap_base": 58, "km": 12.0, "corners": 4, "corner_severity": 0.2, "track_width": 1.1},
    {"id": "targa", "name": "Targa Florio", "reward_mult": 1.6,
     "lap_base": 80, "km": 14.5, "corners": 32, "corner_severity": 0.8, "track_width": 0.7},
]

RACING_NPCS: List[dict] = [
    {"id": "npc_smokey", "name": "Smokey Joe", "base_speed_offset": -1},
    {"id": "npc_ace", "name": "Ace Johnson", "base_speed_offset": 0},
    {"id": "npc_whiskey", "name": "The Whiskey Runner", "base_speed_offset": 1},
    {"id": "npc_bigmike", "name": "Big Mike", "base_speed_offset": -2},
    {"id": "npc_lucky", "name": "Lucky Lou", "base_speed_offset": 0},
    {"id": "npc_fast_eddie", "name": "Fast Eddie", "base_speed_offset": 2},
    {"id": "npc_phantom", "name": "The Phantom", "base_speed_offset": 1},
    {"id": "npc_duke", "name": "Duke Malone", "base_speed_offset": -1},
    {"id": "npc_slick", "name": "Slick Sam", "base_speed_offset": 0},
    {"id": "npc_rusty", "name": "Rusty Wheeler", "base_speed_offset": -2},
]

# ---------- Driver Pool ----------
def _driver_tier(d: dict) -> str:
    avg = (d["skill"] + d["consistency"] + d["racecraft"] + d["wet_ability"] + d["tire_management"]) / 5
    if avg >= 82:
        return "platinum"
    if avg >= 68:
        return "gold"
    if avg >= 52:
        return "silver"
    return "bronze"

_RAW_DRIVERS = [
    {"id": "drv_marcello",    "name": "Tommy 'Leadfoot' Marcello",   "skill": 92, "consistency": 88, "racecraft": 85, "wet_ability": 70, "tire_management": 65, "aggression": 75, "salary_per_race": 14000},
    {"id": "drv_costa",       "name": "Vinnie 'The Wheel' Costa",    "skill": 88, "consistency": 82, "racecraft": 90, "wet_ability": 78, "tire_management": 72, "aggression": 60, "salary_per_race": 13000},
    {"id": "drv_oleary",      "name": "Seamus O'Leary",              "skill": 55, "consistency": 90, "racecraft": 50, "wet_ability": 92, "tire_management": 88, "aggression": 25, "salary_per_race": 7500},
    {"id": "drv_bellini",     "name": "Carlo 'Iron Hands' Bellini",  "skill": 85, "consistency": 75, "racecraft": 88, "wet_ability": 60, "tire_management": 55, "aggression": 85, "salary_per_race": 11000},
    {"id": "drv_kowalski",    "name": "Stan Kowalski",               "skill": 60, "consistency": 65, "racecraft": 55, "wet_ability": 50, "tire_management": 70, "aggression": 40, "salary_per_race": 3000},
    {"id": "drv_dupont",      "name": "Jacques Dupont",              "skill": 78, "consistency": 80, "racecraft": 72, "wet_ability": 85, "tire_management": 78, "aggression": 35, "salary_per_race": 9500},
    {"id": "drv_rossi",       "name": "Enzo 'The Ghost' Rossi",      "skill": 90, "consistency": 70, "racecraft": 92, "wet_ability": 65, "tire_management": 50, "aggression": 88, "salary_per_race": 14500},
    {"id": "drv_murphy",      "name": "Red Murphy",                  "skill": 45, "consistency": 55, "racecraft": 42, "wet_ability": 48, "tire_management": 60, "aggression": 30, "salary_per_race": 800},
    {"id": "drv_zhang",       "name": "Henry Zhang",                 "skill": 70, "consistency": 72, "racecraft": 68, "wet_ability": 74, "tire_management": 80, "aggression": 45, "salary_per_race": 6500},
    {"id": "drv_santos",      "name": "Miguel 'Quick' Santos",       "skill": 82, "consistency": 60, "racecraft": 78, "wet_ability": 55, "tire_management": 45, "aggression": 80, "salary_per_race": 9000},
    {"id": "drv_novak",       "name": "Josef Novak",                 "skill": 65, "consistency": 85, "racecraft": 60, "wet_ability": 62, "tire_management": 90, "aggression": 20, "salary_per_race": 5500},
    {"id": "drv_romano",      "name": "Sal 'The Cannon' Romano",     "skill": 94, "consistency": 65, "racecraft": 80, "wet_ability": 72, "tire_management": 48, "aggression": 90, "salary_per_race": 15000},
    {"id": "drv_petrov",      "name": "Nikolai Petrov",              "skill": 72, "consistency": 78, "racecraft": 70, "wet_ability": 88, "tire_management": 75, "aggression": 50, "salary_per_race": 7000},
    {"id": "drv_burke",       "name": "Jimmy Burke",                 "skill": 48, "consistency": 50, "racecraft": 45, "wet_ability": 42, "tire_management": 55, "aggression": 65, "salary_per_race": 1200},
    {"id": "drv_moretti",     "name": "Aldo 'Silk' Moretti",         "skill": 80, "consistency": 92, "racecraft": 75, "wet_ability": 68, "tire_management": 88, "aggression": 30, "salary_per_race": 11500},
    {"id": "drv_oconnor",     "name": "Paddy O'Connor",              "skill": 58, "consistency": 62, "racecraft": 55, "wet_ability": 90, "tire_management": 58, "aggression": 35, "salary_per_race": 3500},
    {"id": "drv_fischer",     "name": "Klaus Fischer",               "skill": 75, "consistency": 82, "racecraft": 78, "wet_ability": 72, "tire_management": 70, "aggression": 55, "salary_per_race": 8000},
    {"id": "drv_garcia",      "name": "Luis 'El Rayo' Garcia",       "skill": 88, "consistency": 58, "racecraft": 85, "wet_ability": 45, "tire_management": 40, "aggression": 85, "salary_per_race": 10000},
    {"id": "drv_thompson",    "name": "Hank Thompson",               "skill": 42, "consistency": 48, "racecraft": 40, "wet_ability": 44, "tire_management": 50, "aggression": 55, "salary_per_race": 500},
    {"id": "drv_valentino",   "name": "Marco Valentino",             "skill": 86, "consistency": 84, "racecraft": 82, "wet_ability": 80, "tire_management": 82, "aggression": 50, "salary_per_race": 13500},
    {"id": "drv_wong",        "name": "Charlie Wong",                "skill": 68, "consistency": 70, "racecraft": 65, "wet_ability": 60, "tire_management": 72, "aggression": 40, "salary_per_race": 5000},
    {"id": "drv_brennan",     "name": "Mick 'Rainstorm' Brennan",    "skill": 62, "consistency": 68, "racecraft": 58, "wet_ability": 95, "tire_management": 60, "aggression": 30, "salary_per_race": 4500},
    {"id": "drv_deluca",      "name": "Frankie DeLuca",              "skill": 50, "consistency": 58, "racecraft": 52, "wet_ability": 46, "tire_management": 65, "aggression": 70, "salary_per_race": 2000},
    {"id": "drv_hartmann",    "name": "Otto Hartmann",               "skill": 78, "consistency": 76, "racecraft": 80, "wet_ability": 70, "tire_management": 68, "aggression": 60, "salary_per_race": 8500},
    {"id": "drv_sullivan",    "name": "Benny 'Brakes' Sullivan",     "skill": 55, "consistency": 75, "racecraft": 48, "wet_ability": 52, "tire_management": 92, "aggression": 22, "salary_per_race": 3800},
    {"id": "drv_conti",       "name": "Luca Conti",                  "skill": 74, "consistency": 70, "racecraft": 72, "wet_ability": 68, "tire_management": 74, "aggression": 45, "salary_per_race": 6000},
    {"id": "drv_kelly",       "name": "Ace Kelly",                   "skill": 40, "consistency": 42, "racecraft": 44, "wet_ability": 40, "tire_management": 45, "aggression": 60, "salary_per_race": 500},
    {"id": "drv_bianchi",     "name": "Gianni 'Monsoon' Bianchi",    "skill": 70, "consistency": 66, "racecraft": 64, "wet_ability": 93, "tire_management": 62, "aggression": 38, "salary_per_race": 6500},
    {"id": "drv_watts",       "name": "Dizzy Watts",                 "skill": 52, "consistency": 45, "racecraft": 50, "wet_ability": 48, "tire_management": 42, "aggression": 88, "salary_per_race": 1500},
    {"id": "drv_caruso",      "name": "Dominic 'The Don' Caruso",    "skill": 95, "consistency": 90, "racecraft": 88, "wet_ability": 82, "tire_management": 78, "aggression": 65, "salary_per_race": 15000},
]
DRIVER_POOL: List[dict] = [{**d, "tier": _driver_tier(d)} for d in _RAW_DRIVERS]

def _get_driver(driver_id: str) -> Optional[dict]:
    for d in DRIVER_POOL:
        if d["id"] == driver_id:
            return d
    return None

# ---------- R&D Tree ----------
RND_PATHS = {
    "speed": {
        "name": "Speed",
        "description": "Raw pace and straight-line performance",
        "tiers": [
            {"tier": 1, "options": [
                {"id": "turbo_intake", "name": "Turbo Intake", "cost": 50000, "research_hours": 2, "bonus": {"speed_pct": 0.03}, "desc": "+3% straight-line speed"},
                {"id": "exhaust_tune", "name": "Exhaust Tune", "cost": 45000, "research_hours": 2, "bonus": {"speed_pct": 0.025, "engine_wear_reduction": 0.01}, "desc": "+2.5% speed, -1% engine wear"},
            ]},
            {"tier": 2, "options": [
                {"id": "straight_line_kit", "name": "Straight-Line Kit", "cost": 120000, "research_hours": 3, "bonus": {"speed_pct": 0.04}, "desc": "+4% top speed"},
                {"id": "corner_exit_boost", "name": "Corner Exit Boost", "cost": 110000, "research_hours": 3, "bonus": {"speed_pct": 0.02, "grip_pct": 0.02}, "desc": "+2% speed, +2% grip"},
            ]},
            {"tier": 3, "options": [
                {"id": "aero_kit_adv", "name": "Advanced Aero Kit", "cost": 250000, "research_hours": 4, "bonus": {"speed_pct": 0.05, "grip_penalty": 0.01}, "desc": "+5% speed, -1% grip"},
                {"id": "streamline_body", "name": "Streamline Body", "cost": 230000, "research_hours": 4, "bonus": {"speed_pct": 0.035, "tyre_wear_reduction": 0.02}, "desc": "+3.5% speed, -2% tyre wear"},
            ]},
            {"tier": 4, "options": [
                {"id": "forced_induction", "name": "Forced Induction", "cost": 500000, "research_hours": 5, "bonus": {"speed_pct": 0.06}, "desc": "+6% raw speed"},
                {"id": "lightweight_pistons", "name": "Lightweight Pistons", "cost": 480000, "research_hours": 5, "bonus": {"speed_pct": 0.04, "acceleration_pct": 0.03}, "desc": "+4% speed, +3% acceleration"},
            ]},
            {"tier": 5, "options": [
                {"id": "supercharger", "name": "Supercharger", "cost": 1000000, "research_hours": 6, "bonus": {"speed_pct": 0.08}, "desc": "+8% speed (ultimate)"},
                {"id": "twin_turbo", "name": "Twin Turbo System", "cost": 950000, "research_hours": 6, "bonus": {"speed_pct": 0.06, "overtaking_pct": 0.03}, "desc": "+6% speed, +3% overtake chance"},
            ]},
        ],
    },
    "reliability": {
        "name": "Reliability",
        "description": "Engine longevity and consistency",
        "tiers": [
            {"tier": 1, "options": [
                {"id": "engine_hardening", "name": "Engine Hardening", "cost": 40000, "research_hours": 2, "bonus": {"engine_wear_reduction": 0.04}, "desc": "-4% engine wear per race"},
                {"id": "belt_upgrade", "name": "Belt Upgrade", "cost": 35000, "research_hours": 2, "bonus": {"engine_wear_reduction": 0.03, "dnf_reduction": 0.02}, "desc": "-3% wear, -2% DNF risk"},
            ]},
            {"tier": 2, "options": [
                {"id": "cooling_duct", "name": "Cooling Duct", "cost": 100000, "research_hours": 3, "bonus": {"engine_wear_reduction": 0.05, "speed_pct": 0.01}, "desc": "-5% wear, +1% speed"},
                {"id": "oil_system", "name": "Oil System", "cost": 90000, "research_hours": 3, "bonus": {"engine_wear_reduction": 0.06}, "desc": "-6% engine wear"},
            ]},
            {"tier": 3, "options": [
                {"id": "reinforced_block", "name": "Reinforced Block", "cost": 200000, "research_hours": 4, "bonus": {"engine_wear_reduction": 0.07, "dnf_reduction": 0.04}, "desc": "-7% wear, -4% DNF risk"},
                {"id": "heat_management", "name": "Heat Management", "cost": 220000, "research_hours": 4, "bonus": {"engine_wear_reduction": 0.05, "tyre_wear_reduction": 0.03}, "desc": "-5% wear, -3% tyre wear"},
            ]},
            {"tier": 4, "options": [
                {"id": "ceramic_coating", "name": "Ceramic Coating", "cost": 450000, "research_hours": 5, "bonus": {"engine_wear_reduction": 0.08, "speed_pct": 0.02}, "desc": "-8% wear, +2% speed"},
                {"id": "titanium_internals", "name": "Titanium Internals", "cost": 470000, "research_hours": 5, "bonus": {"engine_wear_reduction": 0.10}, "desc": "-10% engine wear"},
            ]},
            {"tier": 5, "options": [
                {"id": "indestructible_engine", "name": "Indestructible Engine", "cost": 900000, "research_hours": 6, "bonus": {"engine_wear_reduction": 0.15, "dnf_reduction": 0.08}, "desc": "-15% wear, -8% DNF risk"},
                {"id": "perpetual_motion", "name": "Perpetual Motion", "cost": 950000, "research_hours": 6, "bonus": {"engine_wear_reduction": 0.12, "speed_pct": 0.03}, "desc": "-12% wear, +3% speed"},
            ]},
        ],
    },
    "handling": {
        "name": "Handling",
        "description": "Cornering, tyre management, and wet performance",
        "tiers": [
            {"tier": 1, "options": [
                {"id": "soft_springs", "name": "Soft Springs", "cost": 45000, "research_hours": 2, "bonus": {"grip_pct": 0.03}, "desc": "+3% grip"},
                {"id": "sway_bars", "name": "Sway Bars", "cost": 42000, "research_hours": 2, "bonus": {"grip_pct": 0.02, "tyre_wear_reduction": 0.02}, "desc": "+2% grip, -2% tyre wear"},
            ]},
            {"tier": 2, "options": [
                {"id": "toe_angle", "name": "Toe Angle Tuning", "cost": 105000, "research_hours": 3, "bonus": {"grip_pct": 0.04}, "desc": "+4% corner grip"},
                {"id": "camber_adjust", "name": "Camber Adjustment", "cost": 100000, "research_hours": 3, "bonus": {"grip_pct": 0.025, "wet_grip_pct": 0.03}, "desc": "+2.5% grip, +3% wet grip"},
            ]},
            {"tier": 3, "options": [
                {"id": "active_diff", "name": "Active Differential", "cost": 240000, "research_hours": 4, "bonus": {"grip_pct": 0.05, "overtaking_pct": 0.02}, "desc": "+5% grip, +2% overtake"},
                {"id": "traction_control", "name": "Traction Control", "cost": 220000, "research_hours": 4, "bonus": {"grip_pct": 0.03, "tyre_wear_reduction": 0.04}, "desc": "+3% grip, -4% tyre wear"},
            ]},
            {"tier": 4, "options": [
                {"id": "rain_channels", "name": "Rain Channels", "cost": 460000, "research_hours": 5, "bonus": {"wet_grip_pct": 0.08, "grip_pct": 0.02}, "desc": "+8% wet grip, +2% grip"},
                {"id": "ground_effect", "name": "Ground Effect", "cost": 480000, "research_hours": 5, "bonus": {"grip_pct": 0.06}, "desc": "+6% corner grip"},
            ]},
            {"tier": 5, "options": [
                {"id": "active_suspension", "name": "Active Suspension", "cost": 1000000, "research_hours": 6, "bonus": {"grip_pct": 0.08, "tyre_wear_reduction": 0.05}, "desc": "+8% grip, -5% tyre wear"},
                {"id": "all_conditions", "name": "All-Conditions Package", "cost": 950000, "research_hours": 6, "bonus": {"grip_pct": 0.05, "wet_grip_pct": 0.10, "tyre_wear_reduction": 0.03}, "desc": "+5% grip, +10% wet grip, -3% wear"},
            ]},
        ],
    },
}

# ---------- Championship ----------
CHAMPIONSHIP_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]  # F1-style for P1-P10

CHAMPIONSHIP_REWARDS = {
    1: {"cash": 5000000, "bonus_pct": 5},
    2: {"cash": 3000000, "bonus_pct": 3},
    3: {"cash": 1500000, "bonus_pct": 2},
    4: {"cash": 750000, "bonus_pct": 0},
    5: {"cash": 500000, "bonus_pct": 0},
}

RACE_CALENDAR_TRACKS = [
    "chicago_board", "daytona_beach", "roosevelt", "indianapolis",
    "boardwalk", "lakeside", "harbor", "mountain",
    "brooklands", "monza", "lemans", "avus", "targa",
]
RACES_PER_DAY = 2
GP_TIMES = ["10:00", "20:00"]  # UTC times for automated GPs

MAX_GRID = 8
MIN_GRID = 2
RACE_LOBBY_COUNTDOWN_SEC = 45
ENTRY_FEE_MIN = 0
ENTRY_FEE_MAX = 5_000_000
REWARD_POOL_PCT = 0.9
REWARD_BY_POSITION = [0.40, 0.25, 0.15, 0.10, 0.05, 0.03, 0.02, 0.00]
# When entry_fee is 0, use this base pool so crew bank still grows; scaled so ~2–3 races can afford cheapest upgrades (e.g. 20k–30k)
RACING_BASE_CASH_POOL = 50_000
# Crew bank debt limit: players can go this far negative when paying for essentials (repair, tyres)
CREW_BANK_DEBT_LIMIT = -50_000
RANK_POINTS_BY_POSITION = [15, 10, 6, 4, 2, 1, 0, 0]
RACING_REP_BY_POSITION = [5, 3, 2, 1, 0, 0, 0, 0]

SPONSOR_TIERS = [
    {"min_rep": 0,   "name": "None",             "income_per_race": 0},
    {"min_rep": 10,  "name": "Local Garage",      "income_per_race": 500},
    {"min_rep": 25,  "name": "City Motors",        "income_per_race": 1500},
    {"min_rep": 50,  "name": "State Auto Group",   "income_per_race": 3500},
    {"min_rep": 100, "name": "National Racing Co.", "income_per_race": 7500},
    {"min_rep": 200, "name": "Grand Prix Alliance", "income_per_race": 15000},
]

def _get_sponsor(racing_rep: int) -> dict:
    best = SPONSOR_TIERS[0]
    for t in SPONSOR_TIERS:
        if racing_rep >= t["min_rep"]:
            best = t
    return best

LAPS_PRIZE_SCALE_BASE = 3  # base laps for prize calculation; longer races scale up

# Cost formulas for 1–100: _crew_upgrade_cost(level), _car_engine_tires_cost(next_level) used below
CREW_BONUS_PER_LEVEL = 0.001  # was 0.02 * 5 / 100 (mechanic: +2% speed per level at old max 5)
# Engine wear: per race %, repair cost per %, replace cost. At high wear, risk of speed limit or DNF during race.
ENGINE_WEAR_PER_RACE = 8
ENGINE_WEAR_MAX = 100
ENGINE_REPAIR_COST_PER_PCT = 400
ENGINE_REPLACE_COST = 75000
ENGINE_RISK_THRESHOLD = 75  # wear >= this: chance per lap of issues
ENGINE_DNF_CHANCE_PER_LAP_AT_100 = 0.12  # at 100% wear, ~12% per lap to DNF
ENGINE_SPEED_PENALTY_AT_RISK = 0.85  # speed mult when "engine issues" but no DNF
# Tyre stock: per compound, cost per set, initial stock for new players
TYRE_STOCK_INITIAL = 5
TYRE_COST_SOFT = 800
TYRE_COST_MEDIUM = 500
TYRE_COST_HARD = 400
TYRE_COST_INTER = 650
TYRE_COST_FULL_WET = 900
# Trade-offs: engine +power -grip, tires +grip -power, aero +speed -grip, reliability -wear -power (scaled for max 100)
ENGINE_POWER_PER_LEVEL = 0.002   # was 0.04 * 5 / 100
ENGINE_GRIP_PENALTY_PER_LEVEL = 0.0015  # was 0.03 * 5 / 100
TIRES_GRIP_PER_LEVEL = 0.0025    # was 0.05 * 5 / 100
TIRES_POWER_PENALTY_PER_LEVEL = 0.001  # was 0.02 * 5 / 100
AERO_SPEED_PER_LEVEL = 0.0009   # was 0.03 * 3 / 100
AERO_GRIP_PENALTY_PER_LEVEL = 0.0006  # was 0.02 * 3 / 100
RELIABILITY_WEAR_REDUCTION_PER_LEVEL = 0.0024  # was 0.08 * 3 / 100
RELIABILITY_POWER_PENALTY_PER_LEVEL = 0.0006  # was 0.02 * 3 / 100
WINS_FOR_AERO_RELIABILITY = 1
WINS_FOR_CHAMPIONSHIP_UPGRADE = 3
CHAMPIONSHIP_UPGRADE_COST = 350000
# 13 upgradable car stats total; all can be upgraded to 100 — global cap allows full max
RACING_UPGRADE_GLOBAL_CAP = 1300  # 13 * 100
MAX_CREW_LEVEL = 100  # mechanic, pit
# 12 crew upgrades total; all can be upgraded to 100
RACING_CREW_GLOBAL_CAP = 1200  # 12 * 100
# New crew types: (key_suffix, max_level, cost_base). Cost = cost_base * (1 + (current + 1) * 0.08)
CREW_EXTRA_TYPES = [
    ("strategist", 100, 40000),
    ("spotter", 100, 35000),
    ("engineer", 100, 45000),
    ("tyre_tech", 100, 38000),
    ("fuel_tech", 100, 30000),
    ("data_analyst", 100, 28000),
    ("physio", 100, 25000),
    ("logistics", 100, 26000),
    ("morale", 100, 32000),
    ("tactician", 100, 30000),
]
_CREW_LABELS = {"strategist": "Strategist", "spotter": "Spotter", "engineer": "Engineer", "tyre_tech": "Tyre Tech", "fuel_tech": "Fuel Tech", "data_analyst": "Data Analyst", "physio": "Physio", "logistics": "Logistics", "morale": "Morale", "tactician": "Tactician"}
_CREW_DESCS = {"strategist": "Optimises pit window — pushes tyres harder before pitting", "spotter": "Avoids contact damage — 15% dodge chance per level", "engineer": "Better car setup — +0.8% grip per level", "tyre_tech": "Reduces tyre wear rate — 6% less degradation per level", "fuel_tech": "Fuel efficiency — reduces fuel weight penalty", "data_analyst": "Qualifying specialist — +1.2% quali pace per level", "physio": "Driver consistency — reduces random lap variance", "logistics": "Reduces tyre wear — 3% less degradation per level", "morale": "Team spirit — +0.5% pace when running in top half", "tactician": "Wet weather specialist — +1.5% pace in rain/snow"}
RACING_TEAM_CREATE_COST = 25_000_000  # $25M to create a racing team (name + colour)
CREW_BANK_START = 50_000  # Starting crew bank when creating a team
MAX_RACING_TEAMS = 18  # Only 18 teams total; kill a team owner to take their team
MAX_CAR_UPGRADE_LEVEL = 100  # engine, tires
MAX_AERO_LEVEL = 100
MAX_RELIABILITY_LEVEL = 100
MAX_BRAKES_LEVEL = 100
MAX_GEARBOX_LEVEL = 100
MAX_COOLING_LEVEL = 100
MAX_WEIGHT_LEVEL = 100
WINS_FOR_WEIGHT = 2
MAX_FUEL_LEVEL = 100
MAX_SUSPENSION_LEVEL = 100
# Per-level effects scaled so 100 levels ≈ same total as old max (e.g. 3 levels): new = old * old_max / 100
SUSPENSION_GRIP_PER_LEVEL = 0.0009   # was 0.03 * 3
SUSPENSION_SPEED_PENALTY_PER_LEVEL = 0.00045  # was 0.015 * 3
WINS_FOR_SUSPENSION = 1
SUSPENSION_COST_BASE = 35000
MAX_OVERTAKING_LEVEL = 100
OVERTAKING_GRIP_PENALTY_PER_LEVEL = 0.0003   # was 0.01 * 3
OVERTAKING_CHANCE_PER_LEVEL = 0.0012  # was 0.04 * 3
WINS_FOR_OVERTAKING = 1
OVERTAKING_COST_BASE = 32000
MAX_ACCELERATION_LEVEL = 100
ACCELERATION_TOP_SPEED_PENALTY_PER_LEVEL = 0.00045  # was 0.015 * 3
ACCELERATION_BONUS_PER_LEVEL = 0.0006  # was 0.02 * 3
WINS_FOR_ACCELERATION = 1
ACCELERATION_COST_BASE = 33000
# New stats: brakes +grip -power, gearbox +speed -grip, cooling -engine wear, weight +speed +grip, fuel +power, suspension, overtaking, acceleration (all scaled for max 100)
BRAKES_GRIP_PER_LEVEL = 0.0008   # was 0.02 * 4
BRAKES_POWER_PENALTY_PER_LEVEL = 0.0004  # was 0.01 * 4
GEARBOX_SPEED_PER_LEVEL = 0.0008   # was 0.02 * 4
GEARBOX_GRIP_PENALTY_PER_LEVEL = 0.0004  # was 0.01 * 4
COOLING_WEAR_REDUCTION_PER_LEVEL = 0.0015  # was 0.05 * 3
WEIGHT_SPEED_PER_LEVEL = 0.0003   # was 0.01 * 3
WEIGHT_GRIP_PER_LEVEL = 0.0003
FUEL_POWER_PER_LEVEL = 0.0006   # was 0.02 * 3
# Cost per level for new types (crew bank). Cost formula: cost_base * (1 + (current + 1) * 0.1)
BRAKES_GEARBOX_COST_BASE = 30000
COOLING_COST_BASE = 25000
WEIGHT_COST_BASE = 45000
FUEL_COST_BASE = 35000
NUM_LAPS_MIN = 2
NUM_LAPS_MAX = 20
INTERACTIVE_LAP_DEADLINE_SEC = 30
# If no client sends green-flag (crash/refresh), open lap-1 decision window automatically after this many seconds from race start.
INTERACTIVE_PRE_GREEN_FALLBACK_SEC = 300
TIRE_WEAR_PER_LAP = 18
# Pit a lap before tires are gone: ~18 wear/lap → pit when below 50 so next lap wouldn't kill tires
TIRE_PIT_THRESHOLD = 50
PIT_PENALTY_FACTOR_BASE = 0.68  # base speed multiplier when pitting (lose time that lap)
PIT_PENALTY_IMPROVEMENT_PER_LEVEL = 0.002  # was 0.04 * 5 / 100; max 100 → 0.68 + 0.20 = 0.88

# Season/week: 2 races per day (morning/evening), 7-day weeks, top 5 get good rewards, then full reset; leaderboard winner +5% per repeat win (cap 20%). Seasons = 2 months, then total reset.
RACING_SEASON_DURATION_DAYS = 60
RACING_WEEK_DURATION_DAYS = 7
RACING_TOP_TEAMS_GOOD_REWARDS = 5
RACING_LEADERBOARD_WINNER_BONUS_PCT = 0.05
RACING_LEADERBOARD_WINNER_BONUS_CAP_PCT = 0.20
RACING_AUTOMATED_RACES_PER_DAY = 2  # morning + evening (cron/scheduler)

# Tyre compounds: wear_mult (per lap), grip_mult (lap score)
TYRE_COMPOUNDS = [
    {"id": "soft", "name": "Soft", "wear_mult": 1.45, "grip_mult": 1.06},
    {"id": "medium", "name": "Medium", "wear_mult": 1.0, "grip_mult": 1.0},
    {"id": "hard", "name": "Hard", "wear_mult": 0.65, "grip_mult": 0.96},
    {"id": "inter", "name": "Intermediate", "wear_mult": 1.1, "grip_mult": 1.02, "wet_grip_bonus": 0.12},
    {"id": "full_wet", "name": "Full Wet", "wear_mult": 1.3, "grip_mult": 0.98, "wet_grip_bonus": 0.22},
]

# Weather: affects tire wear and grip/speed. Set when race starts (random).
WEATHER_TYPES = [
    {"id": "clear", "name": "Clear", "tire_wear_mult": 1.0, "speed_mult": 1.0, "grip_mult": 1.0},
    {"id": "rain", "name": "Rain", "tire_wear_mult": 1.55, "speed_mult": 0.90, "grip_mult": 0.88},
    {"id": "snow", "name": "Snow", "tire_wear_mult": 2.0, "speed_mult": 0.82, "grip_mult": 0.78},
    {"id": "very_hot", "name": "Very hot", "tire_wear_mult": 1.45, "speed_mult": 0.95, "grip_mult": 0.95},
    {"id": "night", "name": "Night", "tire_wear_mult": 1.05, "speed_mult": 0.97, "grip_mult": 0.98},
]

def _get_weather(weather_id: str) -> dict:
    for w in WEATHER_TYPES:
        if w.get("id") == weather_id:
            return w
    return WEATHER_TYPES[0]

DEFAULT_PROFILE = {
    "mechanic_level": 0,
    "pit_level": 0,
    "racing_rep": 0,
    "wins": 0,
    "races_completed": 0,
    "selected_racing_car_id": None,
    "tyre_stock_soft": TYRE_STOCK_INITIAL,
    "tyre_stock_medium": TYRE_STOCK_INITIAL,
    "tyre_stock_hard": TYRE_STOCK_INITIAL,
    "tyre_stock_inter": 0,
    "tyre_stock_full_wet": 0,
    "crew_bank": 0,
    "hired_driver_id": None,
    "rnd_researched": [],
    "rnd_active": None,
}
for _suffix, _max, _ in CREW_EXTRA_TYPES:
    DEFAULT_PROFILE[f"{_suffix}_level"] = 0


def _crew_upgrade_cost(level: int) -> int:
    """Cost to upgrade mechanic/pit from level to level+1 (levels 0..99)."""
    return int(50000 * (1 + (level + 1) * 0.05))


def _car_engine_tires_cost(next_combined_level: int) -> int:
    """Cost to upgrade engine or tires when new combined (engine+tires) level is next_combined_level (1..200)."""
    return int(20000 * (1 + next_combined_level * 0.08))


# Profile/frontend: cost arrays for display (mechanic/pit 0->1..99->100; engine+tires combined 1..200)
CREW_UPGRADE_COSTS = [_crew_upgrade_cost(l) for l in range(100)]
CAR_UPGRADE_COSTS = [_car_engine_tires_cost(i) for i in range(1, 201)]


# Simulation-only per-level effects (scaled for max 100 so total effect matches old max)
PIT_THRESHOLD_PER_LEVEL = 0.125      # pit_level contribution to pit threshold (was 2.5 * 5 / 100)
STRATEGIST_PIT_OFFSET_PER_LEVEL = 0.09   # strategist reduces threshold (was 3 * 3 / 100)
PIT_RANDOM_THRESHOLD_PER_LEVEL = 0.1    # 55 + pit_level * x (was 2 * 5 / 100)
FUEL_WEIGHT_PENALTY_PER_LEVEL = 0.0003  # fuel_lvl reduces weight penalty (was 0.01 * 3 / 100)
FUEL_TECH_WEIGHT_PER_LEVEL = 0.0001     # fuel_tech (was 0.005 * 2 / 100)
CORNER_GRIP_BRAKES_PER_LEVEL = 0.0012   # brakes (was 0.03 * 4 / 100)
CORNER_GRIP_AERO_PER_LEVEL = 0.0006     # aero (was 0.02 * 3 / 100)
CORNER_GRIP_SUSP_PER_LEVEL = 0.0012     # suspension (was 0.04 * 3 / 100)
COOLING_SPEED_PENALTY_AT_RISK_PER_LEVEL = 0.0015  # cooling reduces engine-issue penalty (was 0.05 * 3 / 100)
COOLING_DNF_RISK_REDUCTION_PER_LEVEL = 0.006  # cooling reduces DNF chance (was 0.20 * 3 / 100)
TACTICIAN_WET_PACE_PER_LEVEL = 0.0003  # tactician in wet (was 0.015 * 2 / 100)
MORALE_TOP_HALF_PACE_PER_LEVEL = 0.0001  # morale (was 0.005 * 2 / 100)
SPOTTER_DODGE_CHANCE_PER_LEVEL = 0.0045  # spotter dodge (was 0.15 * 3 / 100)
TYRE_TECH_WEAR_REDUCTION_PER_LEVEL = 0.0018   # tyre_tech (was 0.06 * 3 / 100)
LOGISTICS_WEAR_REDUCTION_PER_LEVEL = 0.0006   # logistics (was 0.03 * 2 / 100)
ENGINEER_GRIP_PER_LEVEL = 0.00024   # engineer grip in _effective_speed_and_grip (was 0.008 * 3 / 100)
PHYSIO_VARIANCE_REDUCTION_PER_LEVEL = 0.0001  # physio (was 0.005 * 2 / 100)
DATA_ANALYST_QUALLI_PER_LEVEL = 0.00024  # data_analyst quali (was 0.012 * 2 / 100)


def _build_lap_engine_config() -> LapEngineConfig:
    return LapEngineConfig(
        tire_wear_per_lap=TIRE_WEAR_PER_LAP,
        tire_pit_threshold=TIRE_PIT_THRESHOLD,
        pit_threshold_per_level=PIT_THRESHOLD_PER_LEVEL,
        strategist_pit_offset_per_level=STRATEGIST_PIT_OFFSET_PER_LEVEL,
        pit_random_threshold_per_level=PIT_RANDOM_THRESHOLD_PER_LEVEL,
        pit_penalty_factor_base=PIT_PENALTY_FACTOR_BASE,
        pit_penalty_improvement_per_level=PIT_PENALTY_IMPROVEMENT_PER_LEVEL,
        fuel_weight_penalty_per_level=FUEL_WEIGHT_PENALTY_PER_LEVEL,
        fuel_tech_weight_per_level=FUEL_TECH_WEIGHT_PER_LEVEL,
        corner_grip_brakes_per_level=CORNER_GRIP_BRAKES_PER_LEVEL,
        corner_grip_aero_per_level=CORNER_GRIP_AERO_PER_LEVEL,
        corner_grip_susp_per_level=CORNER_GRIP_SUSP_PER_LEVEL,
        cooling_speed_penalty_at_risk_per_level=COOLING_SPEED_PENALTY_AT_RISK_PER_LEVEL,
        cooling_dnf_risk_reduction_per_level=COOLING_DNF_RISK_REDUCTION_PER_LEVEL,
        tactician_wet_pace_per_level=TACTICIAN_WET_PACE_PER_LEVEL,
        morale_top_half_pace_per_level=MORALE_TOP_HALF_PACE_PER_LEVEL,
        spotter_dodge_chance_per_level=SPOTTER_DODGE_CHANCE_PER_LEVEL,
        tyre_tech_wear_reduction_per_level=TYRE_TECH_WEAR_REDUCTION_PER_LEVEL,
        logistics_wear_reduction_per_level=LOGISTICS_WEAR_REDUCTION_PER_LEVEL,
        acceleration_bonus_per_level=ACCELERATION_BONUS_PER_LEVEL,
        overtaking_chance_per_level=OVERTAKING_CHANCE_PER_LEVEL,
        reliability_wear_reduction_per_level=RELIABILITY_WEAR_REDUCTION_PER_LEVEL,
        cooling_wear_reduction_per_level=COOLING_WEAR_REDUCTION_PER_LEVEL,
        engine_wear_per_race_divisor=ENGINE_WEAR_PER_RACE,
        engine_risk_threshold=ENGINE_RISK_THRESHOLD,
        engine_wear_max=ENGINE_WEAR_MAX,
        engine_dnf_chance_per_lap_at_100=ENGINE_DNF_CHANCE_PER_LAP_AT_100,
        engine_speed_penalty_at_risk=ENGINE_SPEED_PENALTY_AT_RISK,
        max_crew_level=MAX_CREW_LEVEL,
        tire_compounds=TYRE_COMPOUNDS,
        get_weather=_get_weather,
    )


# ---------- Pydantic ----------
class CreateRaceRequest(BaseModel):
    track_id: str
    entry_fee: int = 0
    max_grid: int = 6
    laps: int = 3
    tyre_compound: str = "medium"  # soft, medium, hard
    weather_id: Optional[str] = None  # clear, rain, snow, very_hot; if omitted, random at create
    interactive: bool = True


class JoinRaceRequest(BaseModel):
    racing_car_instance_id: str
    tyre_compound: str = "medium"  # soft, medium, hard


class RaceDecisionRequest(BaseModel):
    push_level: int = 3
    pit_this_lap: bool = False
    pit_compound: str = "medium"
    defend: bool = False
    pace_mode: Optional[str] = None  # push | normal | conserve
    reaction_ms: Optional[int] = None  # lap 1 launch; lower = better


class UpgradeCrewRequest(BaseModel):
    crew_type: str


class UpgradeCarRequest(BaseModel):
    racing_car_instance_id: str
    upgrade_type: str = "engine"  # engine | tires | aero | reliability | championship | brakes | gearbox | cooling | weight | fuel | suspension | overtaking | acceleration


class BuyRacingCarRequest(BaseModel):
    racing_car_id: str


class SetSelectedCarRequest(BaseModel):
    racing_car_instance_id: Optional[str] = None
    racing_car_id: Optional[str] = None


class RepairEngineRequest(BaseModel):
    racing_car_instance_id: str
    target_wear: Optional[float] = None  # default 0 = full repair


class ReplaceEngineRequest(BaseModel):
    racing_car_instance_id: str


class BuyTyresRequest(BaseModel):
    compound: str = "medium"  # soft, medium, hard
    quantity: int = 1


class CompleteRaceRequest(BaseModel):
    result_order: Optional[List[str]] = None
    dnf_ids: Optional[List[str]] = None


class PlaceRaceBetRequest(BaseModel):
    race_id: str
    entrant_id: str  # the participant user_id being bet on to win
    stake: int


class RaceChallengeCreateRequest(BaseModel):
    target_username: str
    track_id: str
    stake: int = 0
    laps: int = 3
    weather_id: Optional[str] = None


class HireDriverRequest(BaseModel):
    driver_id: str


class FireDriverRequest(BaseModel):
    pass


class RndResearchRequest(BaseModel):
    path_id: str
    node_id: str


class AssignDriverRequest(BaseModel):
    driver_id: str


class CreateRacingTeamRequest(BaseModel):
    name: str
    color: str  # hex e.g. "#e82020" or "e82020"


def _require_racing_team(prof: Optional[dict]) -> None:
    """Raise 403 if profile has no racing team (team_name)."""
    if not prof or not (prof.get("team_name") or "").strip():
        raise HTTPException(
            status_code=403,
            detail=f"Create a racing team first. Cost: ${RACING_TEAM_CREATE_COST:,}. Name your team and choose a colour.",
        )


def _total_crew_levels(prof: dict) -> int:
    """Sum of all 12 crew upgrade levels for global cap."""
    total = int(prof.get("mechanic_level") or 0) + int(prof.get("pit_level") or 0)
    for suffix, _, _ in CREW_EXTRA_TYPES:
        total += int(prof.get(f"{suffix}_level") or 0)
    return total


def _get_racing_car(car_id: str) -> Optional[dict]:
    for c in RACING_CARS:
        if c.get("id") == car_id:
            return c
    return None


def _car_tier_index(car_id: str) -> int:
    """Index 0..len(RACING_CARS)-1 for similar-level NPC selection."""
    for i, c in enumerate(RACING_CARS):
        if c.get("id") == car_id:
            return i
    return 0


def _total_upgrade_levels(up: dict, doc: Optional[dict] = None) -> int:
    """Sum of all 13 car upgrade levels for global cap. doc = user_racing_car for engine/tires fallback."""
    engine = int(up.get("engine_level") or (doc or {}).get("engine_level") or 0)
    tires = int(up.get("tires_level") or (doc or {}).get("tires_level") or 0)
    aero = int(up.get("aero_level") or 0)
    reliability = int(up.get("reliability_level") or 0)
    championship = 1 if up.get("championship_upgrade") else 0
    brakes = int(up.get("brakes_level") or 0)
    gearbox = int(up.get("gearbox_level") or 0)
    cooling = int(up.get("cooling_level") or 0)
    weight = int(up.get("weight_level") or 0)
    fuel = int(up.get("fuel_level") or 0)
    suspension = int(up.get("suspension_level") or 0)
    overtaking = int(up.get("overtaking_level") or 0)
    acceleration = int(up.get("acceleration_level") or 0)
    return engine + tires + aero + reliability + championship + brakes + gearbox + cooling + weight + fuel + suspension + overtaking + acceleration


def _effective_speed_and_grip_display(entrant: dict, profile: Optional[dict], upgrades_map: Dict[str, dict]) -> tuple:
    """Deterministic (speed, grip) for replay display, no random."""
    car_def = _get_racing_car(entrant.get("racing_car_id") or "")
    base_speed = float(car_def.get("base_speed", 10)) if car_def else 10
    base_grip = float(car_def.get("base_grip", 0.85)) if car_def else 0.85
    offset = entrant.get("npc_speed_offset") or 0
    base_speed += offset
    up = upgrades_map.get(entrant.get("racing_car_instance_id") or entrant.get("id") or "") or {}
    engine = int(up.get("engine_level") or 0)
    tires = int(up.get("tires_level") or 0)
    aero = int(up.get("aero_level") or 0)
    reliability = int(up.get("reliability_level") or 0)
    brakes = int(up.get("brakes_level") or 0)
    gearbox = int(up.get("gearbox_level") or 0)
    weight = int(up.get("weight_level") or 0)
    fuel = int(up.get("fuel_level") or 0)
    suspension = int(up.get("suspension_level") or 0)
    overtaking = int(up.get("overtaking_level") or 0)
    acceleration = int(up.get("acceleration_level") or 0)
    championship = bool(up.get("championship_upgrade") or profile and profile.get("championship_upgrade_purchased"))
    speed = base_speed * (
        1.0
        + engine * ENGINE_POWER_PER_LEVEL
        - tires * TIRES_POWER_PENALTY_PER_LEVEL
        + aero * AERO_SPEED_PER_LEVEL
        - reliability * RELIABILITY_POWER_PENALTY_PER_LEVEL
        - brakes * BRAKES_POWER_PENALTY_PER_LEVEL
        + fuel * FUEL_POWER_PER_LEVEL
        + weight * WEIGHT_SPEED_PER_LEVEL
        - suspension * SUSPENSION_SPEED_PENALTY_PER_LEVEL
        - acceleration * ACCELERATION_TOP_SPEED_PENALTY_PER_LEVEL
    )
    speed *= 1.0 + gearbox * GEARBOX_SPEED_PER_LEVEL
    grip = base_grip + tires * TIRES_GRIP_PER_LEVEL - engine * ENGINE_GRIP_PENALTY_PER_LEVEL - aero * AERO_GRIP_PENALTY_PER_LEVEL
    grip = grip + brakes * BRAKES_GRIP_PER_LEVEL - gearbox * GEARBOX_GRIP_PENALTY_PER_LEVEL + weight * WEIGHT_GRIP_PER_LEVEL + suspension * SUSPENSION_GRIP_PER_LEVEL - overtaking * OVERTAKING_GRIP_PENALTY_PER_LEVEL
    if championship:
        speed *= 1.02
        grip = min(1.0, grip * 1.02)
    if profile and not entrant.get("is_npc"):
        mechanic = int(profile.get("mechanic_level") or 0)
        speed *= 1.0 + mechanic * CREW_BONUS_PER_LEVEL
        engineer_lvl = int(profile.get("engineer_level") or 0)
        if engineer_lvl > 0:
            grip += engineer_lvl * 0.008
    return (max(1.0, speed), max(0.5, min(1.0, grip)))


def _get_track(track_id: str) -> Optional[dict]:
    for t in TRACKS:
        if t.get("id") == track_id:
            return t
    return None


RACING_META_ID = "global"

# Automated daily races: same pattern as Auto Rank (in-process ticker or cron with X-Cron-Secret)
RACING_AUTOMATED_MORNING_HOUR = 8   # UTC
RACING_AUTOMATED_EVENING_HOUR = 20  # UTC
RACING_NOTIFY_MINUTES_BEFORE = 5
RACING_TICKER_SLEEP_SECONDS = 60


async def _ensure_racing_meta() -> dict:
    """Get or create the single racing_meta doc (season/week boundaries, leaderboard winner bonus)."""
    meta = await db.racing_meta.find_one({"id": RACING_META_ID}, {"_id": 0})
    if meta:
        return meta
    now = datetime.now(timezone.utc)
    doc = {
        "id": RACING_META_ID,
        "season_start_utc": now.isoformat().replace("+00:00", "Z"),
        "week_start_utc": now.isoformat().replace("+00:00", "Z"),
        "last_week_winner_id": None,
        "leaderboard_bonus_pct": 0.0,
        "last_automated_notify_slot_utc": None,
        "last_automated_race_slot_utc": None,
    }
    await db.racing_meta.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def _check_racing_week_and_season() -> None:
    """If season or week has ended, run reset and advance boundaries. Called from get_racing_profile."""
    meta = await _ensure_racing_meta()
    now = datetime.now(timezone.utc)
    try:
        season_start = datetime.fromisoformat(meta["season_start_utc"].replace("Z", "+00:00"))
        week_start = datetime.fromisoformat(meta["week_start_utc"].replace("Z", "+00:00"))
    except (KeyError, ValueError):
        return
    season_end = season_start + timedelta(days=RACING_SEASON_DURATION_DAYS)
    week_end = week_start + timedelta(days=RACING_WEEK_DURATION_DAYS)

    if now >= season_end:
        # Atomic advance: only one request wins
        now_iso = now.isoformat().replace("+00:00", "Z")
        res = await db.racing_meta.update_one(
            {"id": RACING_META_ID, "season_start_utc": meta["season_start_utc"]},
            {"$set": {"season_start_utc": now_iso, "week_start_utc": now_iso, "last_week_winner_id": None, "leaderboard_bonus_pct": 0.0}},
        )
        if res.modified_count == 0:
            return
        await db.racing_profiles.update_many(
            {},
            {"$unset": {"team_name": "", "team_color": ""}, "$set": {"mechanic_level": 0, "pit_level": 0, "crew_bank": 0, **{f"{s}_level": 0 for s, _, _ in CREW_EXTRA_TYPES}}},
        )
        await db.user_racing_cars.update_many(
            {},
            {"$set": {"engine_level": 0, "tires_level": 0, "engine_wear": 0}},
        )
        await db.racing_upgrades.delete_many({})
        return

    if now >= week_end:
        now_iso = now.isoformat().replace("+00:00", "Z")
        res = await db.racing_meta.update_one(
            {"id": RACING_META_ID, "week_start_utc": meta["week_start_utc"]},
            {"$set": {"week_start_utc": now_iso}},
        )
        if res.modified_count == 0:
            return
        # Payout end-of-week leaderboard rewards to top 5
        WEEK_REWARDS = [100000, 60000, 40000, 25000, 15000]
        top_profs = await db.racing_profiles.find({}, {"_id": 0, "user_id": 1, "wins": 1}).sort("wins", -1).limit(5).to_list(5)
        for i, tp in enumerate(top_profs):
            reward = WEEK_REWARDS[i] if i < len(WEEK_REWARDS) else 0
            if reward > 0 and tp.get("user_id"):
                await db.users.update_one({"id": tp["user_id"]}, {"$inc": {"money": reward}})
                await send_notification(tp["user_id"], f"🏆 Weekly racing leaderboard #{i+1}! Earned ${reward:,}", "racing_weekly_reward")
        await db.racing_profiles.update_many(
            {},
            {"$set": {"mechanic_level": 0, "pit_level": 0, "crew_bank": 0, **{f"{s}_level": 0 for s, _, _ in CREW_EXTRA_TYPES}}},
        )
        await db.user_racing_cars.update_many(
            {},
            {"$set": {"engine_level": 0, "tires_level": 0, "engine_wear": 0}},
        )
        await db.racing_upgrades.delete_many({})


async def _ensure_racing_profile(user_id: str) -> dict:
    prof = await db.racing_profiles.find_one({"user_id": user_id}, {"_id": 0})
    if prof:
        return prof
    doc = {"user_id": user_id, **DEFAULT_PROFILE}
    await db.racing_profiles.insert_one(doc)
    # Return a copy without _id (Motor may add _id to doc in place; ObjectId is not JSON-serializable)
    return {k: v for k, v in doc.items() if k != "_id"}


async def _deduct_crew_bank(user_id: str, cost: int, allow_debt: bool = False) -> None:
    """Deduct cost from racing crew bank.
    If allow_debt=True, allows balance to go negative (down to CREW_BANK_DEBT_LIMIT).
    """
    if cost <= 0:
        return
    prof = await db.racing_profiles.find_one({"user_id": user_id}, {"_id": 0, "crew_bank": 1})
    bank = int((prof or {}).get("crew_bank") or 0)
    new_balance = bank - cost

    if allow_debt:
        if new_balance < CREW_BANK_DEBT_LIMIT:
            raise HTTPException(status_code=400, detail=f"Debt limit reached (${CREW_BANK_DEBT_LIMIT:,}). Win races to pay off debt.")
    else:
        if bank < cost:
            raise HTTPException(status_code=400, detail="Insufficient crew bank (race to earn more)")

    await db.racing_profiles.update_one({"user_id": user_id}, {"$inc": {"crew_bank": -cost}})


async def _pay_driver_salary_from_user_then_crew(user_id: str, salary: int) -> int:
    """Pay hired-driver salary from character cash first; remainder from crew bank (debt allowed).
    Returns the amount taken from crew bank (0 if fully paid from cash)."""
    salary = int(salary or 0)
    if salary <= 0:
        return 0
    user_doc = await db.users.find_one({"id": user_id}, {"_id": 0, "money": 1})
    um = max(0, int((user_doc or {}).get("money") or 0))
    from_cash = min(um, salary)
    remainder = salary - from_cash
    if from_cash > 0:
        await db.users.update_one({"id": user_id}, {"$inc": {"money": -from_cash}})
    if remainder > 0:
        await _deduct_crew_bank(user_id, remainder, allow_debt=True)
    return remainder


async def _get_user_racing_car(user_id: str, instance_id: str) -> Optional[dict]:
    doc = await db.user_racing_cars.find_one({"user_id": user_id, "id": instance_id}, {"_id": 0})
    return doc


def _get_rnd_bonuses(profile: dict) -> dict:
    researched = profile.get("rnd_researched") or []
    bonuses = {
        "speed_pct": 0, "grip_pct": 0, "wet_grip_pct": 0,
        "engine_wear_reduction": 0, "tyre_wear_reduction": 0,
        "dnf_reduction": 0, "overtaking_pct": 0,
        "acceleration_pct": 0, "grip_penalty": 0,
    }
    for path in RND_PATHS.values():
        for tier in path["tiers"]:
            for opt in tier["options"]:
                if opt["id"] in researched:
                    for k, v in opt["bonus"].items():
                        bonuses[k] = bonuses.get(k, 0) + v
    return bonuses


def _effective_speed_and_grip(entrant: dict, profile: Optional[dict], upgrades_map: Dict[str, dict]) -> tuple:
    """Returns (effective_speed, effective_grip) with upgrade trade-offs: engine, tires, aero, reliability, brakes, gearbox, weight, fuel."""
    car_def = _get_racing_car(entrant.get("racing_car_id") or "")
    base_speed = float(car_def.get("base_speed", 10)) if car_def else 10
    base_grip = float(car_def.get("base_grip", 0.85)) if car_def else 0.85
    offset = entrant.get("npc_speed_offset") or 0
    base_speed += offset
    up = upgrades_map.get(entrant.get("racing_car_instance_id") or entrant.get("id") or "") or {}
    engine = int(up.get("engine_level") or 0)
    tires = int(up.get("tires_level") or 0)
    aero = int(up.get("aero_level") or 0)
    reliability = int(up.get("reliability_level") or 0)
    brakes = int(up.get("brakes_level") or 0)
    gearbox = int(up.get("gearbox_level") or 0)
    weight = int(up.get("weight_level") or 0)
    fuel = int(up.get("fuel_level") or 0)
    suspension = int(up.get("suspension_level") or 0)
    overtaking = int(up.get("overtaking_level") or 0)
    acceleration = int(up.get("acceleration_level") or 0)
    championship = bool(up.get("championship_upgrade"))
    speed = base_speed * (
        1.0
        + engine * ENGINE_POWER_PER_LEVEL
        - tires * TIRES_POWER_PENALTY_PER_LEVEL
        + aero * AERO_SPEED_PER_LEVEL
        - reliability * RELIABILITY_POWER_PENALTY_PER_LEVEL
        - brakes * BRAKES_POWER_PENALTY_PER_LEVEL
        + fuel * FUEL_POWER_PER_LEVEL
        + weight * WEIGHT_SPEED_PER_LEVEL
        - suspension * SUSPENSION_SPEED_PENALTY_PER_LEVEL
        - acceleration * ACCELERATION_TOP_SPEED_PENALTY_PER_LEVEL
    )
    speed *= 1.0 + gearbox * GEARBOX_SPEED_PER_LEVEL
    grip = base_grip + tires * TIRES_GRIP_PER_LEVEL - engine * ENGINE_GRIP_PENALTY_PER_LEVEL - aero * AERO_GRIP_PENALTY_PER_LEVEL
    grip = grip + brakes * BRAKES_GRIP_PER_LEVEL - gearbox * GEARBOX_GRIP_PENALTY_PER_LEVEL + weight * WEIGHT_GRIP_PER_LEVEL + suspension * SUSPENSION_GRIP_PER_LEVEL - overtaking * OVERTAKING_GRIP_PENALTY_PER_LEVEL
    if championship:
        speed *= 1.02
        grip = min(1.0, grip * 1.02)
    if profile and not entrant.get("is_npc"):
        mechanic = int(profile.get("mechanic_level") or 0)
        speed *= 1.0 + mechanic * CREW_BONUS_PER_LEVEL
        engineer_lvl = int(profile.get("engineer_level") or 0)
        if engineer_lvl > 0:
            grip += engineer_lvl * ENGINEER_GRIP_PER_LEVEL
        physio_lvl = int(profile.get("physio_level") or 0)
        rng_range = max(0.01, 0.03 - physio_lvl * PHYSIO_VARIANCE_REDUCTION_PER_LEVEL)
        speed *= 0.985 + random.random() * rng_range
    else:
        speed *= 0.985 + random.random() * 0.03
    speed = max(1.0, speed)
    grip = max(0.5, min(1.0, grip))
    return (speed, grip)


def _effective_speed(entrant: dict, profile: Optional[dict], upgrades_map: Dict[str, dict]) -> float:
    s, _ = _effective_speed_and_grip(entrant, profile, upgrades_map)
    return s


class _SeededRandom:
    """Temporarily seed Python's global RNG for deterministic sims."""

    def __init__(self, seed: str):
        self.seed = seed
        self._state = None

    def __enter__(self):
        try:
            self._state = random.getstate()
        except Exception:
            self._state = None
        random.seed(self.seed)
        return self

    def __exit__(self, exc_type, exc, tb):
        if self._state is not None:
            try:
                random.setstate(self._state)
            except Exception:
                pass
        return False


def _run_race_simulation(entrants: List[dict], profile_by_user: Dict[str, dict], upgrades_map: Dict[str, dict]) -> List[str]:
    ids = [e.get("user_id") or e.get("id") for e in entrants]
    speeds = [_effective_speed(e, profile_by_user.get((e.get("user_id") or e.get("id")) or ""), upgrades_map) for e in entrants]
    pairs = list(zip(ids, speeds))
    random.shuffle(pairs)
    pairs.sort(key=lambda x: -x[1])
    return [p[0] for p in pairs]


def _run_race_simulation_laps(
    entrants: List[dict],
    profile_by_user: Dict[str, dict],
    upgrades_map: Dict[str, dict],
    num_laps: int,
    weather_id: str = "clear",
    engine_wear_by_entrant: Optional[Dict[str, float]] = None,
    track: Optional[dict] = None,
) -> tuple:
    """Run lap-by-lap simulation with tire wear, pit stops, weather, contact damage, optional engine DNF/speed limit.
    Uses split straight/corner performance model weighted by track geometry.
    Returns (lap_results, result_order, pit_stops, tire_wear_after_lap, dnf_ids, incidents)."""
    engine_wear_by_entrant = engine_wear_by_entrant or {}
    weather = _get_weather(weather_id)
    tire_wear_mult = float(weather.get("tire_wear_mult", 1.0))
    speed_mult = float(weather.get("speed_mult", 1.0))
    ids = [e.get("user_id") or e.get("id") for e in entrants]
    tire_wear = {eid: 100.0 for eid in ids}
    lap_results: List[List[str]] = []
    pit_stops: List[Dict[str, Any]] = []
    tire_wear_after_lap: Dict[str, List[float]] = {eid: [100.0] for eid in ids}
    dnf_ids: List[str] = []
    damage_map: Dict[str, float] = {eid: 0.0 for eid in ids}
    incidents: List[Dict[str, Any]] = []

    track = track or {}
    corners = int(track.get("corners") or 10)
    corner_severity = float(track.get("corner_severity") or 0.4)
    is_wet = weather_id in ("rain", "snow")
    corner_weight = min(0.6, corners * corner_severity * 0.015)
    if is_wet:
        corner_weight = min(0.75, corner_weight * 1.35)

    crew_cache: Dict[str, dict] = {}
    driver_cache: Dict[str, dict] = {}
    for e in entrants:
        eid = e.get("user_id") or e.get("id")
        prof = profile_by_user.get(eid) or {}
        crew_cache[eid] = {
            "strategist": int(prof.get("strategist_level") or 0),
            "spotter": int(prof.get("spotter_level") or 0),
            "tyre_tech": int(prof.get("tyre_tech_level") or 0),
            "fuel_tech": int(prof.get("fuel_tech_level") or 0),
            "data_analyst": int(prof.get("data_analyst_level") or 0),
            "logistics": int(prof.get("logistics_level") or 0),
            "morale": int(prof.get("morale_level") or 0),
            "tactician": int(prof.get("tactician_level") or 0),
        }
        if e.get("is_npc"):
            driver_cache[eid] = {
                "skill": random.randint(50, 70),
                "consistency": random.randint(50, 70),
                "racecraft": random.randint(50, 70),
                "wet_ability": random.randint(50, 70),
                "tire_management": random.randint(50, 70),
                "aggression": random.randint(30, 60),
            }
        else:
            drv_id = prof.get("hired_driver_id")
            drv = _get_driver(drv_id) if drv_id else None
            if drv:
                driver_cache[eid] = {
                    "skill": drv["skill"],
                    "consistency": drv["consistency"],
                    "racecraft": drv["racecraft"],
                    "wet_ability": drv["wet_ability"],
                    "tire_management": drv["tire_management"],
                    "aggression": drv["aggression"],
                }
            else:
                driver_cache[eid] = {
                    "skill": 50, "consistency": 50, "racecraft": 50,
                    "wet_ability": 50, "tire_management": 50, "aggression": 40,
                }

    rnd_cache: Dict[str, dict] = {}
    for e in entrants:
        eid = e.get("user_id") or e.get("id")
        if not e.get("is_npc"):
            rnd_cache[eid] = _get_rnd_bonuses(profile_by_user.get(eid) or {})
        else:
            rnd_cache[eid] = _get_rnd_bonuses({})

    def _compound_wear_mult(entrant: dict) -> float:
        cid = (entrant.get("tyre_compound") or "medium").lower()
        for c in TYRE_COMPOUNDS:
            if c.get("id") == cid:
                return float(c.get("wear_mult", 1.0))
        return 1.0

    def _compound_grip_mult(entrant: dict) -> float:
        cid = (entrant.get("tyre_compound") or "medium").lower()
        for c in TYRE_COMPOUNDS:
            if c.get("id") == cid:
                mult = float(c.get("grip_mult", 1.0))
                if is_wet and c.get("wet_grip_bonus"):
                    mult += float(c.get("wet_grip_bonus", 0))
                return mult
        return 1.0

    def _get_upgrades(entrant: dict) -> dict:
        return upgrades_map.get(entrant.get("racing_car_instance_id") or entrant.get("id") or "") or {}

    for lap in range(1, num_laps + 1):
        engine_issue_this_lap: Dict[str, bool] = {}
        for eid, wear in engine_wear_by_entrant.items():
            if eid in dnf_ids:
                continue
            if wear < ENGINE_RISK_THRESHOLD:
                continue
            entrant = next((e for e in entrants if (e.get("user_id") or e.get("id")) == eid), None)
            up_eng = _get_upgrades(entrant) if entrant else {}
            cooling = int(up_eng.get("cooling_level") or 0)
            cooling_risk_mult = max(0.4, 1.0 - cooling * COOLING_DNF_RISK_REDUCTION_PER_LEVEL)
            rnd_b = rnd_cache.get(eid, {})
            dnf_chance = (wear - ENGINE_RISK_THRESHOLD) / (ENGINE_WEAR_MAX - ENGINE_RISK_THRESHOLD) * ENGINE_DNF_CHANCE_PER_LAP_AT_100
            dnf_chance *= (1.0 - rnd_b.get("dnf_reduction", 0))
            if random.random() < (dnf_chance * cooling_risk_mult):
                dnf_ids.append(eid)
                engine_issue_this_lap[eid] = True

        pitting = set()
        for eid in ids:
            if eid in dnf_ids:
                continue
            prof = profile_by_user.get(eid) or {}
            pit_level = min(MAX_CREW_LEVEL, int(prof.get("pit_level") or 0))
            strategist = crew_cache.get(eid, {}).get("strategist", 0)
            pit_threshold = min(65, TIRE_PIT_THRESHOLD + pit_level * PIT_THRESHOLD_PER_LEVEL - strategist * STRATEGIST_PIT_OFFSET_PER_LEVEL)
            if tire_wear[eid] < pit_threshold:
                pitting.add(eid)
            elif lap > 1 and lap < num_laps and random.random() < 0.12 and tire_wear[eid] < (55 + pit_level * PIT_RANDOM_THRESHOLD_PER_LEVEL):
                pitting.add(eid)
        for eid in pitting:
            pit_stops.append({"lap": lap, "entrant_id": eid})

        lap_speeds = []
        for e in entrants:
            eid = e.get("user_id") or e.get("id")
            if eid in dnf_ids:
                lap_speeds.append((eid, 0.0))
                continue
            speed_val, grip_val = _effective_speed_and_grip(e, profile_by_user.get(eid) or {}, upgrades_map)
            rnd_b = rnd_cache.get(eid, {})
            speed_val *= (1.0 + rnd_b.get("speed_pct", 0))
            grip_val *= (1.0 + rnd_b.get("grip_pct", 0) - rnd_b.get("grip_penalty", 0))
            grip_val = max(0.5, min(1.0, grip_val))
            wear = engine_wear_by_entrant.get(eid) or 0
            if wear >= ENGINE_RISK_THRESHOLD:
                up = _get_upgrades(e)
                cooling = int(up.get("cooling_level") or 0)
                penalty = min(1.0, ENGINE_SPEED_PENALTY_AT_RISK + cooling * COOLING_SPEED_PENALTY_AT_RISK_PER_LEVEL)
                speed_val *= penalty
            up_fuel = _get_upgrades(e)
            fuel_lvl = int(up_fuel.get("fuel_level") or 0)
            crew = crew_cache.get(eid, {})
            fuel_tech = crew.get("fuel_tech", 0)
            base_weight_penalty = 0.03 * ((num_laps - lap + 1) / max(1, num_laps))
            weight_penalty = max(0.0, base_weight_penalty - fuel_lvl * FUEL_WEIGHT_PENALTY_PER_LEVEL - fuel_tech * FUEL_TECH_WEIGHT_PER_LEVEL)
            fuel_weight_mult = 1.0 + weight_penalty
            tire_factor = max(0.3, (tire_wear[eid] / 100.0) ** 1.2)
            compound_mult = _compound_grip_mult(e)

            up = _get_upgrades(e)
            brakes = int(up.get("brakes_level") or 0)
            aero = int(up.get("aero_level") or 0)
            susp = int(up.get("suspension_level") or 0)
            accel_lvl = int(up.get("acceleration_level") or 0)

            straight_perf = (speed_val * tire_factor * speed_mult) / fuel_weight_mult
            corner_grip_bonus = compound_mult + brakes * CORNER_GRIP_BRAKES_PER_LEVEL + aero * CORNER_GRIP_AERO_PER_LEVEL + susp * CORNER_GRIP_SUSP_PER_LEVEL
            corner_perf = (grip_val * tire_factor * corner_grip_bonus * speed_mult) / fuel_weight_mult

            combined = straight_perf * (1.0 - corner_weight) + corner_perf * corner_weight
            accel_bonus = accel_lvl * ACCELERATION_BONUS_PER_LEVEL + rnd_b.get("acceleration_pct", 0)
            if accel_lvl > 0 and random.random() < 0.15:
                combined *= 1.0 + accel_bonus

            drv_stats = driver_cache.get(eid, {})
            drv_skill = drv_stats.get("skill", 50)
            drv_consistency = drv_stats.get("consistency", 50)
            drv_wet = drv_stats.get("wet_ability", 50)
            combined *= 1.0 + (drv_skill - 50) * 0.002
            variance_scale = max(0.2, 1.0 - drv_consistency * 0.008)
            combined += random.uniform(-0.5, 0.5) * variance_scale
            if is_wet:
                combined *= 1.0 + (drv_wet - 50) * 0.003
                combined *= (1.0 + rnd_b.get("wet_grip_pct", 0))

            tactician = crew.get("tactician", 0)
            if is_wet and tactician > 0:
                combined *= 1.0 + tactician * TACTICIAN_WET_PACE_PER_LEVEL

            morale = crew.get("morale", 0)
            if morale > 0 and lap_results:
                last_lap = lap_results[-1]
                pos_idx = last_lap.index(eid) if eid in last_lap else len(last_lap)
                if pos_idx < len(ids) // 2:
                    combined *= 1.0 + morale * MORALE_TOP_HALF_PACE_PER_LEVEL

            if damage_map.get(eid, 0) > 0:
                combined *= (1.0 - damage_map[eid])
            if eid in pitting:
                ent_prof = profile_by_user.get(eid) or {}
                ent_pit_level = min(MAX_CREW_LEVEL, int(ent_prof.get("pit_level") or 0))
                pit_factor = PIT_PENALTY_FACTOR_BASE + ent_pit_level * PIT_PENALTY_IMPROVEMENT_PER_LEVEL
                combined *= pit_factor
            lap_speeds.append((eid, combined))

        random.shuffle(lap_speeds)
        lap_speeds.sort(key=lambda x: -x[1])
        order = [x[0] for x in lap_speeds]
        speed_by_id = {eid: s for eid, s in lap_speeds}
        for i in range(len(order) - 1):
            car_ahead, car_behind = order[i], order[i + 1]
            entrant_behind = next((e for e in entrants if (e.get("user_id") or e.get("id")) == car_behind), None)
            up_behind = _get_upgrades(entrant_behind) if entrant_behind else {}
            ovt = int(up_behind.get("overtaking_level") or 0)
            if ovt <= 0:
                continue
            sa, sb = speed_by_id.get(car_ahead, 0), speed_by_id.get(car_behind, 0)
            if sa <= 0 or sb <= 0:
                continue
            closeness = abs(sa - sb) / max(sa, sb)
            behind_drv = driver_cache.get(car_behind, {})
            rnd_b_behind = rnd_cache.get(car_behind, {})
            overtake_prob = ovt * OVERTAKING_CHANCE_PER_LEVEL + behind_drv.get("racecraft", 50) * 0.0008 + behind_drv.get("aggression", 40) * 0.0003 + rnd_b_behind.get("overtaking_pct", 0)
            if closeness < 0.04 and random.random() < overtake_prob:
                order[i], order[i + 1] = order[i + 1], order[i]
        lap_results.append(order)

        active_ids = [eid for eid in ids if eid not in dnf_ids]
        for i in range(len(active_ids)):
            for j in range(i + 1, len(active_ids)):
                eid_a, eid_b = active_ids[i], active_ids[j]
                score_a = next((s for e, s in lap_speeds if e == eid_a), 0)
                score_b = next((s for e, s in lap_speeds if e == eid_b), 0)
                if score_a <= 0 or score_b <= 0:
                    continue
                closeness = abs(score_a - score_b) / max(score_a, score_b)
                if closeness > 0.05:
                    continue
                aggr_a = driver_cache.get(eid_a, {}).get("aggression", 40)
                aggr_b = driver_cache.get(eid_b, {}).get("aggression", 40)
                avg_aggression = (aggr_a + aggr_b) / 2
                contact_chance = corner_severity * 0.08 * (1.0 + avg_aggression * 0.005)
                if random.random() < contact_chance:
                    victim = random.choice([eid_a, eid_b])
                    spotter = crew_cache.get(victim, {}).get("spotter", 0)
                    if spotter > 0 and random.random() < spotter * SPOTTER_DODGE_CHANCE_PER_LEVEL:
                        continue
                    dmg = random.uniform(0.02, 0.08)
                    damage_map[victim] = min(0.25, damage_map.get(victim, 0) + dmg)
                    incidents.append({"lap": lap, "entrant_ids": [eid_a, eid_b], "damaged": victim, "damage_pct": round(dmg * 100, 1)})

        for e in entrants:
            eid = e.get("user_id") or e.get("id")
            if eid in dnf_ids:
                continue
            up = _get_upgrades(e)
            rel = int(up.get("reliability_level") or 0)
            rnd_b = rnd_cache.get(eid, {})
            wear_mult_rel = max(0.5, 1.0 - rel * RELIABILITY_WEAR_REDUCTION_PER_LEVEL)
            if eid in pitting:
                tire_wear[eid] = 100.0
            else:
                crew = crew_cache.get(eid, {})
                tyre_tech = crew.get("tyre_tech", 0)
                logistics = crew.get("logistics", 0)
                comp_wear = _compound_wear_mult(e)
                crew_wear_reduction = 1.0 - tyre_tech * TYRE_TECH_WEAR_REDUCTION_PER_LEVEL - logistics * LOGISTICS_WEAR_REDUCTION_PER_LEVEL
                wear_this_lap = (TIRE_WEAR_PER_LAP + random.uniform(-2, 2)) * tire_wear_mult * comp_wear * wear_mult_rel * max(0.7, crew_wear_reduction)
                wear_this_lap *= (1.0 - rnd_b.get("tyre_wear_reduction", 0))
                drv_tire_mgmt = driver_cache.get(eid, {}).get("tire_management", 50)
                wear_this_lap *= max(0.7, 1.0 - drv_tire_mgmt * 0.003)
                tire_wear[eid] = max(0, tire_wear[eid] - wear_this_lap)
            tire_wear_after_lap[eid].append(round(tire_wear[eid], 1))

    if lap_results:
        last_order = lap_results[-1]
        finishers = [eid for eid in last_order if eid not in dnf_ids]
        result_order = finishers + dnf_ids
    else:
        result_order = ids
    return lap_results, result_order, pit_stops, tire_wear_after_lap, dnf_ids, incidents


def _run_qualifying(
    entrants: List[dict],
    profile_by_user: Dict[str, dict],
    upgrades_map: Dict[str, dict],
    track: Optional[dict] = None,
    weather_id: str = "clear",
) -> tuple:
    """One-lap qualifying: sector-weighted pace + tyre compound + seeded variance."""
    cfg = _build_lap_engine_config()
    lap_times = []
    track = track or {}
    lap_base = float(track.get("lap_base") or 90.0)
    is_wet = weather_id in ("rain", "snow")
    for e in entrants:
        eid = e.get("user_id") or e.get("id")
        speed_val, grip_val = _effective_speed_and_grip_display(
            e, profile_by_user.get(eid) or {}, upgrades_map
        )
        compound_mult = 1.0
        for c in TYRE_COMPOUNDS:
            if c.get("id") == (e.get("tyre_compound") or "medium"):
                compound_mult = float(c.get("grip_mult", 1.0))
                if is_wet and c.get("wet_grip_bonus"):
                    compound_mult += float(c.get("wet_grip_bonus", 0))
                break
        up = upgrades_map.get(e.get("racing_car_instance_id") or e.get("id") or "") or {}
        brakes = int(up.get("brakes_level") or 0)
        aero = int(up.get("aero_level") or 0)
        susp = int(up.get("suspension_level") or 0)
        corner_grip_bonus = (
            compound_mult
            + brakes * CORNER_GRIP_BRAKES_PER_LEVEL
            + aero * CORNER_GRIP_AERO_PER_LEVEL
            + susp * CORNER_GRIP_SUSP_PER_LEVEL
        )
        prof = profile_by_user.get(eid) or {}
        data_analyst = int(prof.get("data_analyst_level") or 0)
        if data_analyst > 0 and not e.get("is_npc"):
            speed_val *= 1.0 + data_analyst * DATA_ANALYST_QUALLI_PER_LEVEL
        tactician_q = int(prof.get("tactician_level") or 0)
        if is_wet and tactician_q > 0 and not e.get("is_npc"):
            grip_val *= 1.0 + tactician_q * TACTICIAN_WET_PACE_PER_LEVEL
        grip_val = max(0.5, min(1.0, grip_val))
        qual_noise = random.uniform(-0.45, 0.45)
        lap_time = qual_lap_time(
            cfg,
            lap_base,
            speed_val,
            grip_val,
            compound_mult,
            corner_grip_bonus,
            weather_id,
            track,
            qual_noise,
        )
        lap_times.append((eid, lap_time))
    random.shuffle(lap_times)
    lap_times.sort(key=lambda x: (x[1], x[0]))
    qualifying_order = [x[0] for x in lap_times]
    qualifying_results = [{"entrant_id": eid, "lap_time": round(t, 3)} for eid, t in lap_times]
    return qualifying_order, qualifying_results


# ---------- Championship Helpers ----------

def _generate_championship_season() -> dict:
    """Create a new championship season document with a 26-race calendar (2 per day, cycling 13 tracks)."""
    now = datetime.now(timezone.utc)
    month_str = now.strftime("%Y_%m")
    season_id = f"season_{month_str}"
    season_name = f"Season {now.month} - {now.strftime('%B %Y')}"
    calendar = []
    for i in range(26):
        track_id = RACE_CALENDAR_TRACKS[i % len(RACE_CALENDAR_TRACKS)]
        track_def = _get_track(track_id)
        day_offset = i // RACES_PER_DAY
        slot_index = i % RACES_PER_DAY
        gp_time = GP_TIMES[slot_index] if slot_index < len(GP_TIMES) else GP_TIMES[0]
        hour, minute = int(gp_time.split(":")[0]), int(gp_time.split(":")[1])
        scheduled = (now + timedelta(days=day_offset)).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        )
        calendar.append({
            "round": i + 1,
            "track_id": track_id,
            "track_name": track_def.get("name") if track_def else track_id,
            "scheduled_at": scheduled.isoformat().replace("+00:00", "Z"),
            "race_id": None,
            "completed": False,
        })
    end_date = now + timedelta(days=14)
    return {
        "_id": season_id,
        "season_name": season_name,
        "start_date": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "end_date": end_date.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "race_calendar": calendar,
        "driver_standings": {},
        "constructor_standings": {},
        "status": "active",
    }


async def _ensure_active_championship() -> dict:
    """Get current active championship, auto-creating one if none exists."""
    champ = await db.racing_championships.find_one({"status": "active"})
    if champ:
        return champ
    doc = _generate_championship_season()
    try:
        await db.racing_championships.insert_one(doc)
    except Exception:
        champ = await db.racing_championships.find_one({"status": "active"})
        if champ:
            return champ
    return await db.racing_championships.find_one({"_id": doc["_id"]}) or doc


async def _award_championship_points(race_id: str, result_order: list, dnf_ids: list, participants: list):
    """After a race completes, check if it's a championship race and award points."""
    champ = await db.racing_championships.find_one({"status": "active"})
    if not champ:
        return

    calendar = champ.get("race_calendar") or []
    matched_round = None
    for entry in calendar:
        if entry.get("race_id") == race_id and not entry.get("completed"):
            matched_round = entry
            break

    if not matched_round:
        return

    driver_standings = dict(champ.get("driver_standings") or {})
    constructor_standings = dict(champ.get("constructor_standings") or {})

    scoring_rows: List[tuple] = []
    for i, entrant_id in enumerate(result_order):
        if entrant_id in (dnf_ids or []):
            continue
        points = CHAMPIONSHIP_POINTS[i] if i < len(CHAMPIONSHIP_POINTS) else 0
        if points == 0:
            continue
        entrant = next((p for p in participants if (p.get("user_id") or p.get("id")) == entrant_id), None)
        if not entrant or entrant.get("is_npc"):
            continue
        uid = entrant.get("user_id")
        if not uid:
            continue
        scoring_rows.append((i, uid))

    uids = list({uid for _, uid in scoring_rows})
    profiles_by_uid: Dict[str, dict] = {}
    users_by_uid: Dict[str, dict] = {}
    if uids:
        async for p in db.racing_profiles.find(
            {"user_id": {"$in": uids}},
            {"_id": 0, "user_id": 1, "team_name": 1, "team_color": 1},
        ):
            profiles_by_uid[p["user_id"]] = p
        async for u in db.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "username": 1}):
            users_by_uid[u["id"]] = u

    for i, uid in scoring_rows:
        points = CHAMPIONSHIP_POINTS[i] if i < len(CHAMPIONSHIP_POINTS) else 0
        prof = profiles_by_uid.get(uid)
        user = users_by_uid.get(uid)
        driver_name = (user or {}).get("username") or "?"
        team_name = (prof or {}).get("team_name") or "?"
        team_color = (prof or {}).get("team_color") or "#888888"
        position = i + 1

        if uid not in driver_standings:
            driver_standings[uid] = {"points": 0, "wins": 0, "podiums": 0, "races": 0, "driver_name": driver_name, "team_name": team_name}
        ds = driver_standings[uid]
        ds["points"] = ds.get("points", 0) + points
        ds["races"] = ds.get("races", 0) + 1
        ds["driver_name"] = driver_name
        ds["team_name"] = team_name
        if position == 1:
            ds["wins"] = ds.get("wins", 0) + 1
        if position <= 3:
            ds["podiums"] = ds.get("podiums", 0) + 1

        if uid not in constructor_standings:
            constructor_standings[uid] = {"points": 0, "wins": 0, "team_name": team_name, "team_color": team_color}
        cs = constructor_standings[uid]
        cs["points"] = cs.get("points", 0) + points
        cs["team_name"] = team_name
        cs["team_color"] = team_color
        if position == 1:
            cs["wins"] = cs.get("wins", 0) + 1

    matched_round["completed"] = True

    await db.racing_championships.update_one(
        {"_id": champ["_id"]},
        {"$set": {
            "race_calendar": calendar,
            "driver_standings": driver_standings,
            "constructor_standings": constructor_standings,
        }},
    )

    await _check_championship_end(champ["_id"])


async def _check_championship_end(championship_id: str):
    """If all calendar races are completed, mark championship as done, award rewards, auto-create next."""
    champ = await db.racing_championships.find_one({"_id": championship_id})
    if not champ or champ.get("status") != "active":
        return

    calendar = champ.get("race_calendar") or []
    if not all(entry.get("completed") for entry in calendar):
        return

    driver_standings = champ.get("driver_standings") or {}
    sorted_drivers = sorted(
        driver_standings.items(),
        key=lambda x: (-x[1].get("points", 0), -x[1].get("wins", 0)),
    )

    for rank_idx, (uid, stats) in enumerate(sorted_drivers):
        position = rank_idx + 1
        reward = CHAMPIONSHIP_REWARDS.get(position)
        if not reward:
            continue
        cash = reward.get("cash", 0)
        if cash > 0:
            await db.users.update_one({"id": uid}, {"$inc": {"money": cash}})
        try:
            driver_name = stats.get("driver_name", "?")
            await send_notification(
                uid,
                f"🏆 Championship P{position}! Earned ${cash:,}",
                f"Congratulations {driver_name}! You finished P{position} in {champ.get('season_name', 'the championship')}.",
                "system",
                category="racing",
            )
        except Exception:
            pass

    await db.racing_championships.update_one(
        {"_id": championship_id},
        {"$set": {"status": "completed"}},
    )

    new_season = _generate_championship_season()
    try:
        await db.racing_championships.insert_one(new_season)
    except Exception:
        pass


async def _get_next_championship_round() -> Optional[dict]:
    """Get the next unplayed round from the active championship calendar."""
    champ = await db.racing_championships.find_one({"status": "active"})
    if not champ:
        return None
    for entry in (champ.get("race_calendar") or []):
        if not entry.get("completed") and not entry.get("race_id"):
            return entry
    return None


async def _link_race_to_championship(race_id: str, round_num: int):
    """Link a created race to a championship calendar round."""
    champ = await db.racing_championships.find_one({"status": "active"})
    if not champ:
        return
    calendar = champ.get("race_calendar") or []
    for entry in calendar:
        if entry.get("round") == round_num:
            entry["race_id"] = race_id
            break
    await db.racing_championships.update_one(
        {"_id": champ["_id"]},
        {"$set": {"race_calendar": calendar}},
    )


# ---------- Endpoints ----------
async def get_racing_cars(current_user: dict = Depends(get_current_user)):
    return {"cars": RACING_CARS}


async def get_racing_tracks(current_user: dict = Depends(get_current_user)):
    return {"tracks": TRACKS}


async def get_racing_profile(current_user: dict = Depends(get_current_user_verified)):
    await _check_racing_week_and_season()
    prof = await _ensure_racing_profile(current_user["id"])
    meta = await _ensure_racing_meta()
    try:
        _ws = datetime.fromisoformat(meta["week_start_utc"].replace("Z", "+00:00"))
        _ss = datetime.fromisoformat(meta["season_start_utc"].replace("Z", "+00:00"))
        week_ends_utc = (_ws + timedelta(days=RACING_WEEK_DURATION_DAYS)).isoformat().replace("+00:00", "Z")
        season_ends_utc = (_ss + timedelta(days=RACING_SEASON_DURATION_DAYS)).isoformat().replace("+00:00", "Z")
    except (KeyError, ValueError):
        week_ends_utc = None
        season_ends_utc = None
    # Ensure tyre stock and crew_bank exist for existing users (one-time default)
    for key in ("tyre_stock_soft", "tyre_stock_medium", "tyre_stock_hard", "tyre_stock_inter", "tyre_stock_full_wet"):
        if prof.get(key) is None:
            default_val = TYRE_STOCK_INITIAL if key in ("tyre_stock_soft", "tyre_stock_medium", "tyre_stock_hard") else 0
            await db.racing_profiles.update_one(
                {"user_id": current_user["id"]},
                {"$set": {key: default_val}},
            )
            prof[key] = TYRE_STOCK_INITIAL
    if prof.get("crew_bank") is None:
        await db.racing_profiles.update_one(
            {"user_id": current_user["id"]},
            {"$set": {"crew_bank": 0}},
        )
        prof["crew_bank"] = 0
    owned = await db.user_racing_cars.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(100)
    # One instance per user: if none, create one with first car (no purchase)
    if not owned:
        first_car = RACING_CARS[0]
        instance_id = str(uuid.uuid4())
        await db.user_racing_cars.insert_one({
            "id": instance_id,
            "user_id": current_user["id"],
            "racing_car_id": first_car.get("id"),
            "engine_level": 0,
            "tires_level": 0,
            "engine_wear": 0,
            "acquired_at": _now_iso(),
        })
        await db.racing_profiles.update_one(
            {"user_id": current_user["id"]},
            {"$set": {"selected_racing_car_id": instance_id}},
            upsert=True,
        )
        prof["selected_racing_car_id"] = instance_id
        owned = [{"id": instance_id, "user_id": current_user["id"], "racing_car_id": first_car.get("id"), "engine_level": 0, "tires_level": 0, "engine_wear": 0, "car_name": first_car.get("name")}]
    # If multiple (legacy), use only the selected one as "owned" for display
    selected_id = prof.get("selected_racing_car_id")
    if selected_id and len(owned) > 1:
        owned = [o for o in owned if o.get("id") == selected_id] or owned[:1]
    elif not selected_id and owned:
        await db.racing_profiles.update_one({"user_id": current_user["id"]}, {"$set": {"selected_racing_car_id": owned[0].get("id")}}, upsert=True)
        prof["selected_racing_car_id"] = owned[0].get("id")
    for o in owned:
        car_def = _get_racing_car(o.get("racing_car_id") or "")
        o["car_name"] = car_def.get("name") if car_def else (o.get("racing_car_id") or "?")
        o.setdefault("engine_wear", 0)
    upgrades = {}
    for o in owned:
        uid = o.get("id")
        if uid:
            up = await db.racing_upgrades.find_one({"user_id": current_user["id"], "racing_car_instance_id": uid}, {"_id": 0})
            base = {"engine_level": o.get("engine_level", 0), "tires_level": o.get("tires_level", 0)}
            if up:
                base.update(up)
            upgrades[uid] = base
    for o in owned:
        entrant = {"racing_car_id": o.get("racing_car_id"), "racing_car_instance_id": o.get("id")}
        s, g = _effective_speed_and_grip_display(entrant, prof, upgrades)
        o["effective_speed"] = round(s, 1)
        o["effective_grip"] = round(g * 100, 0)
        o["upgrade_levels_used"] = _total_upgrade_levels(upgrades.get(o["id"]) or {}, o)
    result = {
        "profile": prof,
        "owned_cars": owned,
        "upgrades": upgrades,
        "crew_costs": CREW_UPGRADE_COSTS,
        "max_crew_level": MAX_CREW_LEVEL,
        "crew_levels_used": _total_crew_levels(prof),
        "crew_global_cap": RACING_CREW_GLOBAL_CAP,
        "crew_tradeoffs": {
            "mechanic": {"label": "Mechanic", "max": MAX_CREW_LEVEL, "costs": CREW_UPGRADE_COSTS, "desc": "+2% speed per level"},
            "pit": {"label": "Pit Crew", "max": MAX_CREW_LEVEL, "costs": CREW_UPGRADE_COSTS, "desc": "Faster pit stops — less time lost per stop (+4% speed recovery/level)"},
            **{suffix: {"label": _CREW_LABELS.get(suffix, suffix.title()), "max": max_lvl, "cost_base": cost_base, "desc": _CREW_DESCS.get(suffix, "")} for suffix, max_lvl, cost_base in CREW_EXTRA_TYPES},
        },
        "car_upgrade_costs": CAR_UPGRADE_COSTS,
        "max_car_upgrade_level": MAX_CAR_UPGRADE_LEVEL,
        "global_upgrade_cap": RACING_UPGRADE_GLOBAL_CAP,
        "upgrade_tradeoffs": {
            "engine": {"positive": "+4% straight power", "negative": "−3% grip (slower cornering)", "per_level": True, "max": MAX_CAR_UPGRADE_LEVEL},
            "tires": {"positive": "+5% grip (faster cornering, less off-track)", "negative": "−2% power", "per_level": True, "max": MAX_CAR_UPGRADE_LEVEL},
            "aero": {"positive": "+3% straight speed, +corner downforce", "negative": "−2% grip", "unlock": f"{WINS_FOR_AERO_RELIABILITY}+ win(s)", "per_level": True, "max": MAX_AERO_LEVEL},
            "reliability": {"positive": "−8% tyre wear", "negative": "−2% power", "unlock": f"{WINS_FOR_AERO_RELIABILITY}+ win(s)", "per_level": True, "max": MAX_RELIABILITY_LEVEL},
            "championship": {"positive": "+2% speed & grip", "negative": "—", "unlock": f"{WINS_FOR_CHAMPIONSHIP_UPGRADE}+ wins", "cost": CHAMPIONSHIP_UPGRADE_COST},
            "brakes": {"positive": "+2% grip (faster cornering)", "negative": "−1% power", "per_level": True, "max": MAX_BRAKES_LEVEL, "cost_base": BRAKES_GEARBOX_COST_BASE},
            "gearbox": {"positive": "+2% straight speed", "negative": "−1% grip (slower cornering)", "per_level": True, "max": MAX_GEARBOX_LEVEL, "cost_base": BRAKES_GEARBOX_COST_BASE},
            "cooling": {"positive": "−5% engine wear, lower DNF risk", "negative": "—", "per_level": True, "max": MAX_COOLING_LEVEL, "cost_base": COOLING_COST_BASE},
            "weight": {"positive": "+1% speed & grip", "negative": "—", "unlock": f"{WINS_FOR_WEIGHT}+ wins", "per_level": True, "max": MAX_WEIGHT_LEVEL, "cost_base": WEIGHT_COST_BASE},
            "fuel": {"positive": "+2% power, less fuel-weight penalty", "negative": "—", "per_level": True, "max": MAX_FUEL_LEVEL, "cost_base": FUEL_COST_BASE},
            "suspension": {"positive": "+3% corner grip, +4% corner pace", "negative": "−1.5% straight speed", "unlock": f"{WINS_FOR_SUSPENSION}+ win(s)", "per_level": True, "max": MAX_SUSPENSION_LEVEL, "cost_base": SUSPENSION_COST_BASE},
            "overtaking": {"positive": "Chance to gain a position when close to car ahead", "negative": "−1% grip per level", "unlock": f"{WINS_FOR_OVERTAKING}+ win(s)", "per_level": True, "max": MAX_OVERTAKING_LEVEL, "cost_base": OVERTAKING_COST_BASE},
            "acceleration": {"positive": "+2% pace in acceleration phases", "negative": "−1.5% top speed per level", "unlock": f"{WINS_FOR_ACCELERATION}+ win(s)", "per_level": True, "max": MAX_ACCELERATION_LEVEL, "cost_base": ACCELERATION_COST_BASE},
        },
        "tyre_compounds": TYRE_COMPOUNDS,
        "wins": int(prof.get("wins") or 0),
        "tyre_stock_soft": int(prof.get("tyre_stock_soft") or TYRE_STOCK_INITIAL),
        "tyre_stock_medium": int(prof.get("tyre_stock_medium") or TYRE_STOCK_INITIAL),
        "tyre_stock_hard": int(prof.get("tyre_stock_hard") or TYRE_STOCK_INITIAL),
        "tyre_stock_inter": int(prof.get("tyre_stock_inter") or 0),
        "tyre_stock_full_wet": int(prof.get("tyre_stock_full_wet") or 0),
        "tyre_costs": {"soft": TYRE_COST_SOFT, "medium": TYRE_COST_MEDIUM, "hard": TYRE_COST_HARD, "inter": TYRE_COST_INTER, "full_wet": TYRE_COST_FULL_WET},
        "engine_repair_cost_per_pct": ENGINE_REPAIR_COST_PER_PCT,
        "engine_replace_cost": ENGINE_REPLACE_COST,
        "crew_bank_debt_limit": CREW_BANK_DEBT_LIMIT,
        "racing_team_create_cost": RACING_TEAM_CREATE_COST,
        "max_racing_teams": MAX_RACING_TEAMS,
        "racing_team_count": await db.racing_profiles.count_documents({"team_name": {"$exists": True, "$ne": None, "$ne": ""}}),
        "racing_week_ends_utc": week_ends_utc,
        "racing_season_ends_utc": season_ends_utc,
        "free_engine_repair_available": (prof.get("free_engine_repair_used_season_start_utc") or "") != (meta.get("season_start_utc") or ""),
        "next_automated_race_utc": _next_automated_race_utc(),
        "sponsor": _get_sponsor(int(prof.get("racing_rep") or 0)),
        "sponsor_tiers": SPONSOR_TIERS,
        "championship_points": 0,
        "championship_position": None,
    }
    try:
        champ = await db.racing_championships.find_one({"status": "active"})
        if champ:
            ds = (champ.get("driver_standings") or {}).get(current_user["id"])
            if ds:
                result["championship_points"] = ds.get("points", 0)
                sorted_d = sorted(
                    champ.get("driver_standings", {}).items(),
                    key=lambda x: (-x[1].get("points", 0), -x[1].get("wins", 0)),
                )
                for idx, (uid, _) in enumerate(sorted_d):
                    if uid == current_user["id"]:
                        result["championship_position"] = idx + 1
                        break
    except Exception:
        pass
    return result


async def buy_racing_car(body: BuyRacingCarRequest, current_user: dict = Depends(get_current_user_verified)):
    """Deprecated: cars are chosen, not bought. Kept for backward compatibility; no-op or redirect to select."""
    raise HTTPException(status_code=410, detail="Racing cars are chosen, not bought. Use select-car with racing_car_id.")


async def set_selected_car(body: SetSelectedCarRequest, current_user: dict = Depends(get_current_user_verified)):
    racing_car_id = (body.racing_car_id or "").strip()
    instance_id = (body.racing_car_instance_id or "").strip()
    if racing_car_id:
        car_def = _get_racing_car(racing_car_id)
        if not car_def:
            raise HTTPException(status_code=404, detail="Racing car not found")
        # Find or create single instance for user
        existing = await db.user_racing_cars.find_one({"user_id": current_user["id"]}, {"_id": 0})
        if existing:
            await db.user_racing_cars.update_one(
                {"user_id": current_user["id"], "id": existing["id"]},
                {"$set": {"racing_car_id": racing_car_id}},
            )
            instance_id = existing["id"]
        else:
            instance_id = str(uuid.uuid4())
            await db.user_racing_cars.insert_one({
                "id": instance_id,
                "user_id": current_user["id"],
                "racing_car_id": racing_car_id,
                "engine_level": 0,
                "tires_level": 0,
                "engine_wear": 0,
                "acquired_at": _now_iso(),
            })
        await _ensure_racing_profile(current_user["id"])
        await db.racing_profiles.update_one(
            {"user_id": current_user["id"]},
            {"$set": {"selected_racing_car_id": instance_id}},
            upsert=True,
        )
        return {"message": "Selected car updated", "selected_racing_car_id": instance_id}
    if not instance_id:
        raise HTTPException(status_code=400, detail="Provide racing_car_id or racing_car_instance_id")
    doc = await _get_user_racing_car(current_user["id"], instance_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Racing car not found")
    car_def = _get_racing_car(doc.get("racing_car_id") or "")
    if not car_def:
        raise HTTPException(status_code=400, detail="Invalid car")
    await _ensure_racing_profile(current_user["id"])
    await db.racing_profiles.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"selected_racing_car_id": instance_id}},
        upsert=True,
    )
    return {"message": "Selected car updated", "selected_racing_car_id": instance_id}


async def upgrade_crew(body: UpgradeCrewRequest, current_user: dict = Depends(get_current_user_verified)):
    crew_type = (body.crew_type or "").strip().lower()
    prof = await _ensure_racing_profile(current_user["id"])

    if crew_type in ("mechanic", "pit"):
        key = "mechanic_level" if crew_type == "mechanic" else "pit_level"
        current = int(prof.get(key) or 0)
        if current >= MAX_CREW_LEVEL:
            raise HTTPException(status_code=400, detail="Max level reached")
        if _total_crew_levels(prof) >= RACING_CREW_GLOBAL_CAP:
            raise HTTPException(status_code=400, detail=f"Crew cap reached ({RACING_CREW_GLOBAL_CAP} total levels)")
        cost = CREW_UPGRADE_COSTS[current] if current < len(CREW_UPGRADE_COSTS) else _crew_upgrade_cost(current)
        await _deduct_crew_bank(current_user["id"], cost)
        await db.racing_profiles.update_one({"user_id": current_user["id"]}, {"$set": {key: current + 1}}, upsert=True)
        return {"message": f"{crew_type} upgraded to level {current + 1}", "new_level": current + 1}

    for suffix, max_lvl, cost_base in CREW_EXTRA_TYPES:
        if crew_type == suffix:
            key = f"{suffix}_level"
            current = int(prof.get(key) or 0)
            if current >= max_lvl:
                raise HTTPException(status_code=400, detail=f"Max {suffix} level reached")
            if _total_crew_levels(prof) >= RACING_CREW_GLOBAL_CAP:
                raise HTTPException(status_code=400, detail=f"Crew cap reached ({RACING_CREW_GLOBAL_CAP} total levels)")
            cost = int(cost_base * (1 + (current + 1) * 0.08))
            await _deduct_crew_bank(current_user["id"], cost)
            await db.racing_profiles.update_one({"user_id": current_user["id"]}, {"$set": {key: current + 1}}, upsert=True)
            return {"message": f"{suffix} upgraded to level {current + 1}", "new_level": current + 1}

    raise HTTPException(
        status_code=400,
        detail="crew_type must be mechanic, pit, strategist, spotter, engineer, tyre_tech, fuel_tech, data_analyst, physio, logistics, morale, or tactician",
    )


async def upgrade_car_part(body: UpgradeCarRequest, current_user: dict = Depends(get_current_user_verified)):
    instance_id = (body.racing_car_instance_id or "").strip()
    upgrade_type = (getattr(body, "upgrade_type", None) or "engine").strip().lower()
    doc = await _get_user_racing_car(current_user["id"], instance_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Racing car not found")
    prof = await _ensure_racing_profile(current_user["id"])
    wins = int(prof.get("wins") or 0)

    if upgrade_type == "championship":
        if wins < WINS_FOR_CHAMPIONSHIP_UPGRADE:
            raise HTTPException(status_code=400, detail=f"Championship upgrade requires {WINS_FOR_CHAMPIONSHIP_UPGRADE}+ wins")
        if prof.get("championship_upgrade_purchased"):
            raise HTTPException(status_code=400, detail="Championship upgrade already purchased")
        await _deduct_crew_bank(current_user["id"], CHAMPIONSHIP_UPGRADE_COST)
        await db.racing_profiles.update_one({"user_id": current_user["id"]}, {"$set": {"championship_upgrade_purchased": True}}, upsert=True)
        up = await db.racing_upgrades.find_one({"user_id": current_user["id"], "racing_car_instance_id": instance_id}, {"_id": 0})
        up_data = (up or {}).copy()
        up_data["engine_level"] = up_data.get("engine_level") or doc.get("engine_level") or 0
        up_data["tires_level"] = up_data.get("tires_level") or doc.get("tires_level") or 0
        up_data["championship_upgrade"] = True
        await db.racing_upgrades.update_one(
            {"user_id": current_user["id"], "racing_car_instance_id": instance_id},
            {"$set": up_data},
            upsert=True,
        )
        return {"message": "Championship upgrade purchased", "championship_upgrade": True}

    if upgrade_type in ("aero", "reliability"):
        if wins < WINS_FOR_AERO_RELIABILITY:
            raise HTTPException(status_code=400, detail=f"Aero/Reliability upgrades require {WINS_FOR_AERO_RELIABILITY}+ win(s)")
        up = await db.racing_upgrades.find_one({"user_id": current_user["id"], "racing_car_instance_id": instance_id}, {"_id": 0})
        up_data = dict(up) if up else {}
        up_data.setdefault("engine_level", doc.get("engine_level") or 0)
        up_data.setdefault("tires_level", doc.get("tires_level") or 0)
        key = "aero_level" if upgrade_type == "aero" else "reliability_level"
        max_lvl = MAX_AERO_LEVEL if upgrade_type == "aero" else MAX_RELIABILITY_LEVEL
        current = int(up_data.get(key) or 0)
        if current >= max_lvl:
            raise HTTPException(status_code=400, detail=f"Max {upgrade_type} level reached")
        if _total_upgrade_levels(up_data, doc) >= RACING_UPGRADE_GLOBAL_CAP:
            raise HTTPException(status_code=400, detail=f"Global upgrade cap reached ({RACING_UPGRADE_GLOBAL_CAP} total levels)")
        cost = int(40000 * (1 + (current + 1) * 0.1))
        await _deduct_crew_bank(current_user["id"], cost)
        up_data[key] = current + 1
        await db.racing_upgrades.update_one(
            {"user_id": current_user["id"], "racing_car_instance_id": instance_id},
            {"$set": up_data},
            upsert=True,
        )
        return {"message": f"{upgrade_type} upgraded", key: current + 1}

    if upgrade_type in ("brakes", "gearbox", "cooling", "weight", "fuel", "suspension", "overtaking", "acceleration"):
        up = await db.racing_upgrades.find_one({"user_id": current_user["id"], "racing_car_instance_id": instance_id}, {"_id": 0})
        up_data = dict(up) if up else {}
        up_data.setdefault("engine_level", doc.get("engine_level") or 0)
        up_data.setdefault("tires_level", doc.get("tires_level") or 0)
        if upgrade_type == "weight" and wins < WINS_FOR_WEIGHT:
            raise HTTPException(status_code=400, detail=f"Weight upgrade requires {WINS_FOR_WEIGHT}+ wins")
        if upgrade_type == "suspension" and wins < WINS_FOR_SUSPENSION:
            raise HTTPException(status_code=400, detail=f"Suspension upgrade requires {WINS_FOR_SUSPENSION}+ win(s)")
        if upgrade_type == "overtaking" and wins < WINS_FOR_OVERTAKING:
            raise HTTPException(status_code=400, detail=f"Overtaking upgrade requires {WINS_FOR_OVERTAKING}+ win(s)")
        if upgrade_type == "acceleration" and wins < WINS_FOR_ACCELERATION:
            raise HTTPException(status_code=400, detail=f"Acceleration upgrade requires {WINS_FOR_ACCELERATION}+ win(s)")
        key = f"{upgrade_type}_level"
        max_lvl_map = {
            "brakes": MAX_BRAKES_LEVEL,
            "gearbox": MAX_GEARBOX_LEVEL,
            "cooling": MAX_COOLING_LEVEL,
            "weight": MAX_WEIGHT_LEVEL,
            "fuel": MAX_FUEL_LEVEL,
            "suspension": MAX_SUSPENSION_LEVEL,
            "overtaking": MAX_OVERTAKING_LEVEL,
            "acceleration": MAX_ACCELERATION_LEVEL,
        }
        max_lvl = max_lvl_map[upgrade_type]
        current = int(up_data.get(key) or 0)
        if current >= max_lvl:
            raise HTTPException(status_code=400, detail=f"Max {upgrade_type} level reached")
        if _total_upgrade_levels(up_data, doc) >= RACING_UPGRADE_GLOBAL_CAP:
            raise HTTPException(status_code=400, detail=f"Global upgrade cap reached ({RACING_UPGRADE_GLOBAL_CAP} total levels)")
        cost_map = {
            "brakes": int(BRAKES_GEARBOX_COST_BASE * (1 + (current + 1) * 0.1)),
            "gearbox": int(BRAKES_GEARBOX_COST_BASE * (1 + (current + 1) * 0.1)),
            "cooling": int(COOLING_COST_BASE * (1 + (current + 1) * 0.1)),
            "weight": int(WEIGHT_COST_BASE * (1 + (current + 1) * 0.1)),
            "fuel": int(FUEL_COST_BASE * (1 + (current + 1) * 0.1)),
            "suspension": int(SUSPENSION_COST_BASE * (1 + (current + 1) * 0.1)),
            "overtaking": int(OVERTAKING_COST_BASE * (1 + (current + 1) * 0.1)),
            "acceleration": int(ACCELERATION_COST_BASE * (1 + (current + 1) * 0.1)),
        }
        cost = cost_map[upgrade_type]
        await _deduct_crew_bank(current_user["id"], cost)
        up_data[key] = current + 1
        await db.racing_upgrades.update_one(
            {"user_id": current_user["id"], "racing_car_instance_id": instance_id},
            {"$set": up_data},
            upsert=True,
        )
        return {"message": f"{upgrade_type} upgraded", key: current + 1}

    # engine or tires (default)
    engine = int(doc.get("engine_level") or 0)
    tires = int(doc.get("tires_level") or 0)
    up = await db.racing_upgrades.find_one({"user_id": current_user["id"], "racing_car_instance_id": instance_id}, {"_id": 0})
    up_data = dict(up) if up else {}
    up_data.setdefault("engine_level", engine)
    up_data.setdefault("tires_level", tires)
    if upgrade_type == "engine":
        if engine >= MAX_CAR_UPGRADE_LEVEL:
            raise HTTPException(status_code=400, detail="Max engine level reached")
        up_data["engine_level"] = engine + 1
        if _total_upgrade_levels(up_data, None) > RACING_UPGRADE_GLOBAL_CAP:
            raise HTTPException(status_code=400, detail=f"Global upgrade cap reached ({RACING_UPGRADE_GLOBAL_CAP} total levels)")
        next_level = engine + tires + 1
        cost = _car_engine_tires_cost(next_level)
        await _deduct_crew_bank(current_user["id"], cost)
        await db.user_racing_cars.update_one(
            {"user_id": current_user["id"], "id": instance_id},
            {"$set": {"engine_level": engine + 1}},
        )
        if up:
            up_data["engine_level"] = engine + 1
            await db.racing_upgrades.update_one(
                {"user_id": current_user["id"], "racing_car_instance_id": instance_id},
                {"$set": {"engine_level": engine + 1}},
                upsert=True,
            )
        return {"message": "Car upgraded", "engine_level": engine + 1, "tires_level": tires}
    # tires
    if tires >= MAX_CAR_UPGRADE_LEVEL:
        raise HTTPException(status_code=400, detail="Max tires level reached")
    up_data["tires_level"] = tires + 1
    if _total_upgrade_levels(up_data, None) > RACING_UPGRADE_GLOBAL_CAP:
        raise HTTPException(status_code=400, detail=f"Global upgrade cap reached ({RACING_UPGRADE_GLOBAL_CAP} total levels)")
    next_level = engine + tires + 1
    cost = _car_engine_tires_cost(next_level)
    await _deduct_crew_bank(current_user["id"], cost)
    await db.user_racing_cars.update_one(
        {"user_id": current_user["id"], "id": instance_id},
        {"$set": {"tires_level": tires + 1}},
    )
    if up:
        up_data["tires_level"] = tires + 1
        await db.racing_upgrades.update_one(
            {"user_id": current_user["id"], "racing_car_instance_id": instance_id},
            {"$set": {"tires_level": tires + 1}},
            upsert=True,
        )
    return {"message": "Car upgraded", "engine_level": engine, "tires_level": tires + 1}


async def repair_engine(body: RepairEngineRequest, current_user: dict = Depends(get_current_user_verified)):
    """Repair engine wear down to target_wear (default 0). One free repair per season; after that, cost from crew bank."""
    instance_id = (body.racing_car_instance_id or "").strip()
    doc = await _get_user_racing_car(current_user["id"], instance_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Racing car not found")
    current_wear = float(doc.get("engine_wear") or 0)
    target = 0.0 if body.target_wear is None else max(0, min(ENGINE_WEAR_MAX, float(body.target_wear)))
    if current_wear <= target:
        raise HTTPException(status_code=400, detail="Engine wear already at or below target")
    cost = int((current_wear - target) * ENGINE_REPAIR_COST_PER_PCT)
    if cost < 1:
        raise HTTPException(status_code=400, detail="Nothing to repair")

    meta = await _ensure_racing_meta()
    prof = await _ensure_racing_profile(current_user["id"])
    season_start = meta.get("season_start_utc") or ""
    free_used_season = prof.get("free_engine_repair_used_season_start_utc")
    free_repair_available = free_used_season != season_start

    if free_repair_available:
        cost = 0
        await db.racing_profiles.update_one(
            {"user_id": current_user["id"]},
            {"$set": {"free_engine_repair_used_season_start_utc": season_start}},
        )
    else:
        await _deduct_crew_bank(current_user["id"], cost, allow_debt=True)

    await db.user_racing_cars.update_one(
        {"user_id": current_user["id"], "id": instance_id},
        {"$set": {"engine_wear": round(target, 1)}},
    )
    return {"message": "Engine repaired", "engine_wear": target, "cost": cost, "free_repair": free_repair_available}


async def replace_engine(body: ReplaceEngineRequest, current_user: dict = Depends(get_current_user_verified)):
    """Replace engine (resets wear to 0) for a fixed cost."""
    instance_id = (body.racing_car_instance_id or "").strip()
    doc = await _get_user_racing_car(current_user["id"], instance_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Racing car not found")
    await _deduct_crew_bank(current_user["id"], ENGINE_REPLACE_COST, allow_debt=True)
    await db.user_racing_cars.update_one(
        {"user_id": current_user["id"], "id": instance_id},
        {"$set": {"engine_wear": 0}},
    )
    return {"message": "Engine replaced", "engine_wear": 0, "cost": ENGINE_REPLACE_COST}


async def buy_tyres(body: BuyTyresRequest, current_user: dict = Depends(get_current_user_verified)):
    """Buy tyre sets (soft, medium, hard) to add to stock."""
    compound = (body.compound or "medium").strip().lower()
    if compound not in ("soft", "medium", "hard", "inter", "full_wet"):
        raise HTTPException(status_code=400, detail="compound must be soft, medium, hard, inter, or full_wet")
    quantity = max(1, min(20, int(body.quantity or 1)))
    cost_map = {"soft": TYRE_COST_SOFT, "medium": TYRE_COST_MEDIUM, "hard": TYRE_COST_HARD, "inter": TYRE_COST_INTER, "full_wet": TYRE_COST_FULL_WET}
    cost = cost_map[compound] * quantity
    await _deduct_crew_bank(current_user["id"], cost, allow_debt=True)
    await _ensure_racing_profile(current_user["id"])
    from pymongo import ReturnDocument
    updated = await db.racing_profiles.find_one_and_update(
        {"user_id": current_user["id"]},
        {"$inc": {f"tyre_stock_{compound}": quantity}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
        projection={f"tyre_stock_{compound}": 1},
    )
    new_stock = int(updated.get(f"tyre_stock_{compound}") or 0)
    return {"message": f"Bought {quantity} {compound} tyre set(s)", "tyre_stock": new_stock, "cost": cost}


async def create_racing_team(body: CreateRacingTeamRequest, current_user: dict = Depends(get_current_user_verified)):
    """Create a racing team for $25M: name + colour. Required before creating/joining/starting races. Max 18 teams; if cap reached, kill a team owner to take theirs."""
    prof = await _ensure_racing_profile(current_user["id"])
    if (prof.get("team_name") or "").strip():
        raise HTTPException(status_code=400, detail="You already have a racing team")
    # Cap: only 18 teams total
    team_count = await db.racing_profiles.count_documents({"team_name": {"$exists": True, "$ne": None, "$ne": ""}})
    if team_count >= MAX_RACING_TEAMS:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {MAX_RACING_TEAMS} racing teams. Kill a team owner to take their team.",
        )
    name = (body.name or "").strip()[:50]
    if not name:
        raise HTTPException(status_code=400, detail="Team name is required")
    raw = (body.color or "").strip()
    if raw.startswith("#"):
        raw = raw[1:]
    if len(raw) != 6 or not all(c in "0123456789abcdefABCDEF" for c in raw):
        raise HTTPException(status_code=400, detail="Colour must be a hex code (e.g. #e82020 or e82020)")
    color = "#" + raw.upper()
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    user_money = int(user.get("money") or 0)
    if user_money < RACING_TEAM_CREATE_COST:
        raise HTTPException(
            status_code=400,
            detail=f"You need ${RACING_TEAM_CREATE_COST:,} to create a racing team. You have ${user_money:,}.",
        )
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -RACING_TEAM_CREATE_COST}})
    await db.racing_profiles.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"team_name": name, "team_color": color, "crew_bank": CREW_BANK_START}},
        upsert=True,
    )
    return {"message": "Racing team created", "team_name": name, "team_color": color, "crew_bank": CREW_BANK_START}


async def create_race(body: CreateRaceRequest, current_user: dict = Depends(get_current_user_verified)):
    track_id = (body.track_id or "").strip()
    track = _get_track(track_id)
    if not track:
        raise HTTPException(status_code=400, detail="Invalid track")
    entry_fee = max(ENTRY_FEE_MIN, min(ENTRY_FEE_MAX, int(body.entry_fee or 0)))
    max_grid = max(MIN_GRID, min(MAX_GRID, int(body.max_grid or 6)))
    num_laps = max(NUM_LAPS_MIN, min(NUM_LAPS_MAX, int(body.laps or 3)))
    prof = await _ensure_racing_profile(current_user["id"])
    _require_racing_team(prof)
    selected_id = prof.get("selected_racing_car_id")
    if not selected_id:
        raise HTTPException(status_code=400, detail="Select a racing car first")
    car_doc = await _get_user_racing_car(current_user["id"], selected_id)
    if not car_doc:
        raise HTTPException(status_code=400, detail="Selected racing car not found")
    engine_wear = float(car_doc.get("engine_wear") or 0)
    if engine_wear >= ENGINE_WEAR_MAX:
        raise HTTPException(status_code=400, detail="Engine at 100% wear. Repair or replace engine before racing.")
    compound = (body.tyre_compound or "medium").strip().lower()
    tyre_stock = int(prof.get(f"tyre_stock_{compound}") or 0)
    if tyre_stock < 1:
        raise HTTPException(status_code=400, detail=f"No {compound} tyres in stock. Buy tyres in My ride.")
    if entry_fee > 0:
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
        if int(user.get("money") or 0) < entry_fee:
            raise HTTPException(status_code=400, detail="Insufficient cash for entry fee")
    race_id = str(uuid.uuid4())
    now = _now_iso()
    # Weather: use provided or random (set once so creator can see it when selecting tyres)
    if body.weather_id and any(w.get("id") == body.weather_id for w in WEATHER_TYPES):
        weather = _get_weather(body.weather_id)
    else:
        weather = random.choice(WEATHER_TYPES)
    weather_id = weather.get("id", "clear")
    weather_name = weather.get("name", "Clear")
    doc = {
        "id": race_id,
        "track_id": track_id,
        "track_name": track.get("name"),
        "entry_fee": entry_fee,
        "max_grid": max_grid,
        "state": "open",
        "created_by": current_user["id"],
        "created_at": now,
        "started_at": None,
        "completed_at": None,
        "weather": weather_id,
        "weather_name": weather_name,
        "participants": [
            {
                "user_id": current_user["id"],
                "username": current_user.get("username") or "?",
                "racing_car_id": car_doc.get("racing_car_id"),
                "racing_car_instance_id": car_doc.get("id"),
                "car_name": next((c.get("name") for c in RACING_CARS if c.get("id") == car_doc.get("racing_car_id")), "?"),
                "is_npc": False,
                "tyre_compound": (body.tyre_compound or "medium").strip().lower(),
            }
        ],
        "result_order": None,
        "reward_mult": track.get("reward_mult", 1.0),
        "laps": num_laps,
        "lobby_ends_at": (datetime.now(timezone.utc) + timedelta(seconds=RACE_LOBBY_COUNTDOWN_SEC)).isoformat().replace("+00:00", "Z"),
        "interactive": bool(getattr(body, "interactive", True)),
    }
    await db.racing_races.insert_one(doc)
    if entry_fee > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -entry_fee}})
    # Return a copy without _id (insert_one may add _id to doc in place; ObjectId is not JSON-serializable)
    race_response = {k: v for k, v in doc.items() if k != "_id"}
    return {"message": "Race created", "race_id": race_id, "race": race_response}


async def get_open_races(current_user: dict = Depends(get_current_user_verified)):
    now = datetime.now(timezone.utc)
    cursor = db.racing_races.find(
        {"state": "open", "lobby_ends_at": {"$gt": now.isoformat()}},
        {"_id": 0}
    ).sort("created_at", -1).limit(50)
    races = await cursor.to_list(50)
    return {"races": races}


async def get_race(race_id: str, current_user: dict = Depends(get_current_user_verified)):
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    return {"race": race}


async def join_race(race_id: str, body: JoinRaceRequest, current_user: dict = Depends(get_current_user_verified)):
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    if race.get("state") != "open":
        raise HTTPException(status_code=400, detail="Race not open for join")
    if any(p.get("user_id") == current_user["id"] for p in (race.get("participants") or [])):
        raise HTTPException(status_code=400, detail="Already in this race")
    participants = race.get("participants") or []
    if len(participants) >= int(race.get("max_grid") or MAX_GRID):
        raise HTTPException(status_code=400, detail="Race is full")
    instance_id = (body.racing_car_instance_id or "").strip()
    car_doc = await _get_user_racing_car(current_user["id"], instance_id)
    if not car_doc:
        raise HTTPException(status_code=404, detail="Racing car not found")
    engine_wear = float(car_doc.get("engine_wear") or 0)
    if engine_wear >= ENGINE_WEAR_MAX:
        raise HTTPException(status_code=400, detail="Engine at 100% wear. Repair or replace engine before racing.")
    compound = (body.tyre_compound or "medium").strip().lower() if hasattr(body, "tyre_compound") else "medium"
    prof = await _ensure_racing_profile(current_user["id"])
    _require_racing_team(prof)
    for key in ("tyre_stock_soft", "tyre_stock_medium", "tyre_stock_hard", "tyre_stock_inter", "tyre_stock_full_wet"):
        if prof.get(key) is None:
            default_val = TYRE_STOCK_INITIAL if key in ("tyre_stock_soft", "tyre_stock_medium", "tyre_stock_hard") else 0
            await db.racing_profiles.update_one({"user_id": current_user["id"]}, {"$set": {key: default_val}})
            prof[key] = default_val
    tyre_stock = int(prof.get(f"tyre_stock_{compound}") or 0)
    if tyre_stock < 1:
        raise HTTPException(status_code=400, detail=f"No {compound} tyres in stock. Buy tyres in My ride.")
    entry_fee = int(race.get("entry_fee") or 0)
    if entry_fee > 0:
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
        if int(user.get("money") or 0) < entry_fee:
            raise HTTPException(status_code=400, detail="Insufficient cash for entry fee")
    participants.append({
        "user_id": current_user["id"],
        "username": current_user.get("username") or "?",
        "racing_car_id": car_doc.get("racing_car_id"),
        "racing_car_instance_id": car_doc.get("id"),
        "car_name": next((c.get("name") for c in RACING_CARS if c.get("id") == car_doc.get("racing_car_id")), "?"),
        "is_npc": False,
        "tyre_compound": (body.tyre_compound or "medium").strip().lower() if hasattr(body, "tyre_compound") else "medium",
    })
    await db.racing_races.update_one(
        {"id": race_id},
        {"$set": {"participants": participants}},
    )
    if entry_fee > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -entry_fee}})
    return {"message": "Joined race", "participants": participants}


async def _start_race_internal(race_id: str) -> dict:
    """Fill NPCs, run qualifying, set state running. Used by start_race and by automated daily races. Caller must ensure race exists and state is 'open'."""
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    if race.get("state") != "open":
        raise HTTPException(status_code=400, detail="Race already started or completed")
    participants = list(race.get("participants") or [])
    max_grid = int(race.get("max_grid") or MAX_GRID)
    track = _get_track(race.get("track_id") or "")
    reward_mult = float(track.get("reward_mult", 1.0)) if track else 1.0
    entry_fee = int(race.get("entry_fee") or 0)
    player_tier = 0
    player_engine = 0
    player_tires = 0
    for p in participants:
        if p.get("is_npc"):
            continue
        inst_id = p.get("racing_car_instance_id")
        if inst_id:
            car_doc = await db.user_racing_cars.find_one({"user_id": p.get("user_id"), "id": inst_id}, {"_id": 0})
            if car_doc:
                player_tier = _car_tier_index(car_doc.get("racing_car_id") or "")
                player_engine = int(car_doc.get("engine_level") or 0)
                player_tires = int(car_doc.get("tires_level") or 0)
        break
    npcs_to_add = max_grid - len(participants)
    competitive_offsets = [-1, 0, 0, 0, 1, 1, 1, 2, 2][: max(1, npcs_to_add)]
    while len(competitive_offsets) < npcs_to_add:
        competitive_offsets.append(random.choice([0, 1, 2]))
    random.shuffle(competitive_offsets)
    initial_count = len(participants)
    npc_slot = 0
    shuffled_npcs = list(RACING_NPCS)
    random.shuffle(shuffled_npcs)
    while len(participants) < max_grid:
        npc = shuffled_npcs[npc_slot % len(shuffled_npcs)]
        offset = competitive_offsets[len(participants) - initial_count]
        tier = max(0, min(len(RACING_CARS) - 1, player_tier + random.randint(-1, 1)))
        car_def = RACING_CARS[tier]
        engine_level = max(0, min(MAX_CAR_UPGRADE_LEVEL, player_engine + random.randint(-1, 1)))
        tires_level = max(0, min(MAX_CAR_UPGRADE_LEVEL, player_tires + random.randint(-1, 1)))
        used = engine_level + tires_level
        cap_left = max(0, RACING_UPGRADE_GLOBAL_CAP - used)
        aero_level = min(MAX_AERO_LEVEL, random.randint(0, min(MAX_AERO_LEVEL, cap_left)))
        used += aero_level
        cap_left = max(0, RACING_UPGRADE_GLOBAL_CAP - used)
        reliability_level = min(MAX_RELIABILITY_LEVEL, random.randint(0, min(MAX_RELIABILITY_LEVEL, cap_left)))
        used += reliability_level
        cap_left = max(0, RACING_UPGRADE_GLOBAL_CAP - used)
        brakes_level = min(MAX_BRAKES_LEVEL, random.randint(0, min(MAX_BRAKES_LEVEL, cap_left)))
        used += brakes_level
        cap_left = max(0, RACING_UPGRADE_GLOBAL_CAP - used)
        gearbox_level = min(MAX_GEARBOX_LEVEL, random.randint(0, min(MAX_GEARBOX_LEVEL, cap_left)))
        used += gearbox_level
        cap_left = max(0, RACING_UPGRADE_GLOBAL_CAP - used)
        cooling_level = min(MAX_COOLING_LEVEL, random.randint(0, min(MAX_COOLING_LEVEL, cap_left)))
        used += cooling_level
        cap_left = max(0, RACING_UPGRADE_GLOBAL_CAP - used)
        weight_level = min(MAX_WEIGHT_LEVEL, random.randint(0, min(MAX_WEIGHT_LEVEL, cap_left)))
        used += weight_level
        cap_left = max(0, RACING_UPGRADE_GLOBAL_CAP - used)
        fuel_level = min(MAX_FUEL_LEVEL, random.randint(0, min(MAX_FUEL_LEVEL, cap_left)))
        npc_id = f"{npc['id']}_{npc_slot}"
        tyre = random.choice(["soft", "medium", "hard"])
        npc_slot += 1
        participants.append({
            "id": npc_id,
            "username": npc.get("name"),
            "racing_car_id": car_def.get("id"),
            "racing_car_instance_id": None,
            "car_name": car_def.get("name"),
            "is_npc": True,
            "npc_speed_offset": int(offset),
            "engine_level": engine_level,
            "tires_level": tires_level,
            "aero_level": aero_level,
            "reliability_level": reliability_level,
            "brakes_level": brakes_level,
            "gearbox_level": gearbox_level,
            "cooling_level": cooling_level,
            "weight_level": weight_level,
            "fuel_level": fuel_level,
            "tyre_compound": tyre,
        })
    profile_by_user = {}
    upgrades_map = {}
    human_uids: List[str] = []
    inst_pairs: List[tuple] = []
    seen_pairs = set()
    for p in participants:
        if p.get("is_npc"):
            eid = p.get("id")
            upgrades_map[eid] = {
                "engine_level": p.get("engine_level", 0),
                "tires_level": p.get("tires_level", 0),
                "aero_level": p.get("aero_level", 0),
                "reliability_level": p.get("reliability_level", 0),
                "brakes_level": p.get("brakes_level", 0),
                "gearbox_level": p.get("gearbox_level", 0),
                "cooling_level": p.get("cooling_level", 0),
                "weight_level": p.get("weight_level", 0),
                "fuel_level": p.get("fuel_level", 0),
            }
            continue
        uid = p.get("user_id")
        if uid:
            human_uids.append(uid)
        inst_id = p.get("racing_car_instance_id")
        if inst_id and uid:
            pair = (uid, inst_id)
            if pair not in seen_pairs:
                seen_pairs.add(pair)
                inst_pairs.append(pair)

    unique_uids = list(dict.fromkeys(human_uids))
    if unique_uids:
        async for prof in db.racing_profiles.find({"user_id": {"$in": unique_uids}}, {"_id": 0}):
            if prof:
                profile_by_user[prof["user_id"]] = prof

    car_by_pair: Dict[tuple, dict] = {}
    up_by_pair: Dict[tuple, dict] = {}
    if inst_pairs:
        or_cars = [{"user_id": u, "id": inst} for u, inst in inst_pairs]
        async for car_doc in db.user_racing_cars.find({"$or": or_cars}, {"_id": 0}):
            car_by_pair[(car_doc["user_id"], car_doc["id"])] = car_doc
        or_ups = [{"user_id": u, "racing_car_instance_id": inst} for u, inst in inst_pairs]
        async for up in db.racing_upgrades.find({"$or": or_ups}, {"_id": 0}):
            up_by_pair[(up["user_id"], up["racing_car_instance_id"])] = up

    for p in participants:
        if p.get("is_npc"):
            continue
        uid = p.get("user_id")
        inst_id = p.get("racing_car_instance_id")
        if not inst_id or not uid:
            continue
        up = up_by_pair.get((uid, inst_id))
        car_doc = car_by_pair.get((uid, inst_id))
        base = {"engine_level": (car_doc or {}).get("engine_level", 0), "tires_level": (car_doc or {}).get("tires_level", 0)}
        if up:
            base.update(up)
        upgrades_map[inst_id] = base
    num_laps = max(NUM_LAPS_MIN, min(NUM_LAPS_MAX, int(race.get("laps") or 3)))
    if race.get("weather") and any(w.get("id") == race.get("weather") for w in WEATHER_TYPES):
        weather = _get_weather(race["weather"])
    else:
        weather = random.choice(WEATHER_TYPES)
    weather_id = weather.get("id", "clear")
    engine_wear_by_entrant: Dict[str, float] = {}
    tyre_prof_bulk: List[UpdateOne] = []
    if not race.get("is_automated"):
        for p in participants:
            if p.get("is_npc"):
                continue
            uid = p.get("user_id")
            inst_id = p.get("racing_car_instance_id")
            if not inst_id:
                continue
            car_doc = car_by_pair.get((uid, inst_id))
            wear = float(car_doc.get("engine_wear") or 0) if car_doc else 0
            engine_wear_by_entrant[uid] = wear
            if wear >= ENGINE_WEAR_MAX:
                raise HTTPException(status_code=400, detail="A participant's engine is at 100% wear. They must repair or replace before the race.")
            compound = (p.get("tyre_compound") or "medium").strip().lower()
            prof = profile_by_user.get(uid)
            if prof is not None:
                set_missing = {}
                for key in ("tyre_stock_soft", "tyre_stock_medium", "tyre_stock_hard"):
                    if prof.get(key) is None:
                        set_missing[key] = TYRE_STOCK_INITIAL
                        prof[key] = TYRE_STOCK_INITIAL
                if set_missing:
                    tyre_prof_bulk.append(UpdateOne({"user_id": uid}, {"$set": set_missing}))
                stock = int(prof.get(f"tyre_stock_{compound}") or 0)
                if stock < 1:
                    raise HTTPException(status_code=400, detail=f"Not enough {compound} tyres in stock for a participant. Buy tyres before the race.")
        if tyre_prof_bulk:
            await db.racing_profiles.bulk_write(tyre_prof_bulk, ordered=False)
    # Deterministic qualifying so grid is stable and fair for a given race_id.
    with _SeededRandom(f"qualifying:{race_id}"):
        qualifying_order, qualifying_results = _run_qualifying(participants, profile_by_user, upgrades_map, track, weather_id)
    id_to_p = {(p.get("user_id") or p.get("id")): p for p in participants}
    participants = [id_to_p[eid] for eid in qualifying_order if eid in id_to_p]
    for p in participants:
        prof = profile_by_user.get(p.get("user_id") or p.get("id")) if not p.get("is_npc") else None
        s, g = _effective_speed_and_grip_display(p, prof, upgrades_map)
        p["effective_speed"] = round(s, 2)
        p["effective_grip"] = round(g, 2)
        p["pit_level"] = int(prof.get("pit_level") or 0) if prof else 0
        up = upgrades_map.get(p.get("racing_car_instance_id") or p.get("id"))
        p["reliability_level"] = int(up.get("reliability_level") or 0) if up else 0
        p["overtaking_level"] = int(up.get("overtaking_level") or 0) if up else 0
    if race.get("interactive"):
        return await _start_interactive_race(
            race_id, race, participants, profile_by_user, upgrades_map,
            engine_wear_by_entrant, num_laps, weather_id, weather,
            qualifying_order, qualifying_results, track,
        )
    # Pre-compute race simulation so live replay matches final results
    with _SeededRandom(f"race:{race_id}"):
        lap_results, result_order, pit_stops, tire_wear_after_lap, sim_dnf_ids, sim_incidents = _run_race_simulation_laps(
            participants, profile_by_user, upgrades_map, num_laps, weather_id=weather_id, engine_wear_by_entrant=engine_wear_by_entrant, track=track
        )
    dnf_ids_list = list(sim_dnf_ids or [])
    now = _now_iso()
    await db.racing_races.update_one(
        {"id": race_id},
        {"$set": {
            "state": "running",
            "participants": participants,
            "qualifying_order": qualifying_order,
            "qualifying_results": qualifying_results,
            "upgrades_snapshot": upgrades_map,
            "engine_wear_snapshot": engine_wear_by_entrant,
            "laps": num_laps,
            "weather": weather_id,
            "weather_name": weather.get("name", "Clear"),
            "started_at": now,
            "result_order": result_order,
            "lap_results": lap_results,
            "pit_stops": pit_stops,
            "tire_wear_after_lap": tire_wear_after_lap,
            "dnf_ids": dnf_ids_list,
            "incidents": sim_incidents,
            "rewards": None,
            "completed_at": None,
        }},
    )
    race["state"] = "running"
    race["participants"] = participants
    race["qualifying_order"] = qualifying_order
    race["qualifying_results"] = qualifying_results
    race["upgrades_snapshot"] = upgrades_map
    race["engine_wear_snapshot"] = engine_wear_by_entrant
    race["laps"] = num_laps
    race["weather"] = weather_id
    race["weather_name"] = weather.get("name", "Clear")
    race["started_at"] = now
    race["result_order"] = result_order
    race["lap_results"] = lap_results
    race["pit_stops"] = pit_stops
    race["tire_wear_after_lap"] = tire_wear_after_lap
    race["dnf_ids"] = dnf_ids_list
    race["rewards"] = None
    race["completed_at"] = None
    return race


async def start_race(race_id: str, current_user: dict = Depends(get_current_user_verified)):
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    prof = await _ensure_racing_profile(current_user["id"])
    _require_racing_team(prof)
    if race.get("state") != "open":
        raise HTTPException(status_code=400, detail="Race already started or completed")
    race = await _start_race_internal(race_id)
    return {"message": "Race started — run it live", "race": race}


async def _create_automated_race(slot_label: str) -> Optional[str]:
    """Create one automated race with all team owners as participants, fill NPCs, start. Returns race_id or None if not enough participants."""
    profiles_cursor = db.racing_profiles.find(
        {"team_name": {"$exists": True, "$ne": None, "$ne": ""}},
        {"_id": 0, "user_id": 1, "selected_racing_car_id": 1, "tyre_stock_soft": 1, "tyre_stock_medium": 1, "tyre_stock_hard": 1},
    )
    profiles = await profiles_cursor.to_list(MAX_RACING_TEAMS)
    participants = []
    default_racing_car = RACING_CARS[0] if RACING_CARS else {"id": "model_t", "name": "Ford Model T Racer"}
    
    for prof in profiles:
        uid = prof.get("user_id")
        if not uid:
            continue
        user = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1})
        username = (user or {}).get("username") or "?"
        
        # Find or create a car for the user
        car_id = prof.get("selected_racing_car_id")
        car_doc = None
        if car_id:
            car_doc = await db.user_racing_cars.find_one({"user_id": uid, "id": car_id}, {"_id": 0})
        if not car_doc:
            car_doc = await db.user_racing_cars.find_one({"user_id": uid}, {"_id": 0})
        if not car_doc:
            # Auto-create a default car for the user so they can participate
            new_car_id = str(uuid.uuid4())
            car_doc = {
                "id": new_car_id,
                "user_id": uid,
                "racing_car_id": default_racing_car.get("id"),
                "engine_wear": 0,
                "created_at": _now_iso(),
            }
            await db.user_racing_cars.insert_one(car_doc)
            await db.racing_profiles.update_one({"user_id": uid}, {"$set": {"selected_racing_car_id": new_car_id}})
        
        # Auto-repair engine if at 100% wear for automated races
        if float(car_doc.get("engine_wear") or 0) >= ENGINE_WEAR_MAX:
            await db.user_racing_cars.update_one({"user_id": uid, "id": car_doc.get("id")}, {"$set": {"engine_wear": 50}})
            car_doc["engine_wear"] = 50
        
        # Find available tyres or give free medium tyres
        compound = "medium"
        has_tyres = False
        for key in ("tyre_stock_medium", "tyre_stock_soft", "tyre_stock_hard"):
            stock = int(prof.get(key) or 0)
            if stock >= 1:
                compound = key.replace("tyre_stock_", "")
                has_tyres = True
                break
        
        if not has_tyres:
            # Give 3 free medium tyres for automated race participation
            await db.racing_profiles.update_one({"user_id": uid}, {"$inc": {"tyre_stock_medium": 3}})
            compound = "medium"
        
        car_name = next((c.get("name") for c in RACING_CARS if c.get("id") == car_doc.get("racing_car_id")), default_racing_car.get("name", "?"))
        participants.append({
            "user_id": uid,
            "username": username,
            "racing_car_id": car_doc.get("racing_car_id"),
            "racing_car_instance_id": car_doc.get("id"),
            "car_name": car_name,
            "is_npc": False,
            "tyre_compound": compound,
        })
    
    if len(participants) < MIN_GRID:
        return None
    championship_round = await _get_next_championship_round()
    if championship_round:
        track = _get_track(championship_round.get("track_id")) or random.choice(TRACKS)
    else:
        track = random.choice(TRACKS)
    weather = random.choice(WEATHER_TYPES)
    num_laps = max(NUM_LAPS_MIN, min(NUM_LAPS_MAX, 5))
    race_id = str(uuid.uuid4())
    if championship_round:
        await _link_race_to_championship(race_id, championship_round.get("round"))
    now = _now_iso()
    created_by = participants[0]["user_id"]
    doc = {
        "id": race_id,
        "track_id": track.get("id"),
        "track_name": track.get("name"),
        "entry_fee": 0,
        "max_grid": MAX_GRID,
        "state": "open",
        "created_by": created_by,
        "created_at": now,
        "started_at": None,
        "completed_at": None,
        "weather": weather.get("id", "clear"),
        "weather_name": weather.get("name", "Clear"),
        "participants": participants,
        "result_order": None,
        "reward_mult": track.get("reward_mult", 1.0),
        "laps": num_laps,
        "lobby_ends_at": now,
        "is_automated": True,
    }
    await db.racing_races.insert_one(doc)
    race = await _start_race_internal(race_id)
    # _start_race_internal already ran the simulation and stored result_order,
    # lap_results, pit_stops, dnf_ids, etc. on the race doc. Use those directly.
    sim_result_order = race.get("result_order") or []
    sim_dnf_ids = race.get("dnf_ids") or []
    participants_after = list(race.get("participants") or [])
    body = CompleteRaceRequest(result_order=sim_result_order, dnf_ids=sim_dnf_ids)
    creator = next((p for p in participants_after if not p.get("is_npc")), participants_after[0])
    mock_user = {"id": creator.get("user_id") or creator.get("id"), "username": creator.get("username", "?")}
    await complete_race(race_id, body, mock_user)
    return race_id


async def run_racing_automated_races_once() -> dict:
    """Single pass: send 'racing in 5 min' notifications and/or create+start morning/evening races. Used by in-process ticker or cron."""
    meta = await _ensure_racing_meta()
    now = datetime.now(timezone.utc)
    slots = [
        ("morning", RACING_AUTOMATED_MORNING_HOUR),
        ("evening", RACING_AUTOMATED_EVENING_HOUR),
    ]
    for slot_name, hour in slots:
        slot_dt = now.replace(hour=hour, minute=0, second=0, microsecond=0)
        slot_iso = slot_dt.isoformat().replace("+00:00", "Z")
        notify_dt = slot_dt - timedelta(minutes=RACING_NOTIFY_MINUTES_BEFORE)
        if now >= notify_dt and ((meta.get("last_automated_notify_slot_utc") or "") or " ") < slot_iso:
            cursor = db.racing_profiles.find(
                {"team_name": {"$exists": True, "$ne": None, "$ne": ""}},
                {"_id": 0, "user_id": 1},
            )
            team_user_ids = [p["user_id"] for p in await cursor.to_list(MAX_RACING_TEAMS) if p.get("user_id")]
            for uid in team_user_ids:
                try:
                    await send_notification(
                        uid,
                        "🏁 Racing in 5 minutes",
                        f"The {slot_name} automated race starts in 5 minutes. Open Racing to watch live.",
                        "system",
                        category="racing",
                    )
                except Exception:
                    pass
            await db.racing_meta.update_one(
                {"id": RACING_META_ID},
                {"$set": {"last_automated_notify_slot_utc": slot_iso}},
            )
            meta["last_automated_notify_slot_utc"] = slot_iso
        if now >= slot_dt and ((meta.get("last_automated_race_slot_utc") or "") or " ") < slot_iso:
            created_race_id = await _create_automated_race(slot_name)
            if created_race_id:
                race_doc = await db.racing_races.find_one({"id": created_race_id}, {"_id": 0, "participants": 1})
                parts = (race_doc or {}).get("participants") or []
                for p in parts:
                    if p.get("is_npc"):
                        continue
                    uid = p.get("user_id")
                    try:
                        await send_notification(
                            uid,
                            f"🏁 {slot_name.capitalize()} race started",
                            "Your automated race is live. Open Racing to watch.",
                            "system",
                            category="racing",
                        )
                    except Exception:
                        pass
            await db.racing_meta.update_one(
                {"id": RACING_META_ID},
                {"$set": {"last_automated_race_slot_utc": slot_iso}},
            )
            meta["last_automated_race_slot_utc"] = slot_iso
    return {"ok": True}


async def run_racing_automated_race_ticker():
    """Background loop: every minute run automated races pass (notify + create races at configured times)."""
    import logging
    log = logging.getLogger(__name__)
    while True:
        try:
            await run_racing_automated_races_once()
        except Exception as e:
            log.exception("Racing automated ticker: %s", e)
        await asyncio.sleep(RACING_TICKER_SLEEP_SECONDS)


async def complete_race(race_id: str, body: CompleteRaceRequest, current_user: dict = Depends(get_current_user_verified)):
    """Called by client when the live race finishes. Backend computes the official result_order/dnf_ids."""
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    if race.get("state") != "running":
        raise HTTPException(status_code=400, detail="Race is not in progress")
    participants = list(race.get("participants") or [])
    expected_ids = {(p.get("user_id") or p.get("id")) for p in participants}
    # Only allow a participant (non-NPC) to finalize a race
    if current_user.get("id") not in expected_ids:
        raise HTTPException(status_code=403, detail="You are not a participant in this race")

    # Use pre-computed results stored at race start time
    track = _get_track(race.get("track_id") or "")
    reward_mult = float(track.get("reward_mult", 1.0)) if track else 1.0
    entry_fee = int(race.get("entry_fee") or 0)
    num_laps = max(NUM_LAPS_MIN, min(NUM_LAPS_MAX, int(race.get("laps") or 3)))
    weather_id = (race.get("weather") or "clear")

    result_order = race.get("result_order")
    lap_results = race.get("lap_results")
    pit_stops = race.get("pit_stops")
    tire_wear_after_lap = race.get("tire_wear_after_lap")
    dnf_ids: List[str] = list(race.get("dnf_ids") or [])

    # Use live result from client when provided (so results screen matches what the user saw)
    if body.result_order and set(body.result_order) == expected_ids and len(body.result_order) == len(expected_ids):
        result_order = list(body.result_order)
        if body.dnf_ids is not None:
            dnf_ids = [eid for eid in body.dnf_ids if eid in expected_ids]

    profile_by_user: Dict[str, dict] = {}

    # Fallback: re-compute if pre-computed results are missing (older races started before this change)
    if not result_order:
        upgrades_map: Dict[str, dict] = (race.get("upgrades_snapshot") or {}) if isinstance(race.get("upgrades_snapshot"), dict) else {}
        engine_wear_by_entrant: Dict[str, float] = (race.get("engine_wear_snapshot") or {}) if isinstance(race.get("engine_wear_snapshot"), dict) else {}
        if not upgrades_map:
            for p in participants:
                if p.get("is_npc"):
                    eid = p.get("id")
                    upgrades_map[eid] = {
                        "engine_level": p.get("engine_level", 0),
                        "tires_level": p.get("tires_level", 0),
                        "aero_level": p.get("aero_level", 0),
                        "reliability_level": p.get("reliability_level", 0),
                        "brakes_level": p.get("brakes_level", 0),
                        "gearbox_level": p.get("gearbox_level", 0),
                        "cooling_level": p.get("cooling_level", 0),
                        "weight_level": p.get("weight_level", 0),
                        "fuel_level": p.get("fuel_level", 0),
                    }
                    continue
                uid = p.get("user_id")
                if uid and uid not in profile_by_user:
                    prof = await db.racing_profiles.find_one({"user_id": uid}, {"_id": 0})
                    if prof:
                        profile_by_user[uid] = prof
                inst_id = p.get("racing_car_instance_id")
                if inst_id and inst_id not in upgrades_map:
                    up = await db.racing_upgrades.find_one({"user_id": uid, "racing_car_instance_id": inst_id}, {"_id": 0})
                    car_doc = await db.user_racing_cars.find_one({"user_id": uid, "id": inst_id}, {"_id": 0})
                    base = {"engine_level": (car_doc or {}).get("engine_level", 0), "tires_level": (car_doc or {}).get("tires_level", 0)}
                    if up:
                        base.update(up)
                    upgrades_map[inst_id] = base
        if not engine_wear_by_entrant:
            for p in participants:
                if p.get("is_npc"):
                    continue
                uid = p.get("user_id")
                inst_id = p.get("racing_car_instance_id")
                if uid and inst_id:
                    car_doc = await db.user_racing_cars.find_one({"user_id": uid, "id": inst_id}, {"_id": 0, "engine_wear": 1})
                    engine_wear_by_entrant[uid] = float(car_doc.get("engine_wear") or 0) if car_doc else 0.0
        with _SeededRandom(f"race:{race_id}"):
            lap_results, result_order, pit_stops, tire_wear_after_lap, sim_dnf_ids, sim_incidents = _run_race_simulation_laps(
                participants, profile_by_user, upgrades_map, num_laps, weather_id=weather_id, engine_wear_by_entrant=engine_wear_by_entrant, track=track
            )
        dnf_ids = list(sim_dnf_ids or [])
    # Load profiles for sponsor income calculation (needed for rewards)
    for p in participants:
        if p.get("is_npc"):
            continue
        uid = p.get("user_id")
        if uid and uid not in profile_by_user:
            prof = await db.racing_profiles.find_one({"user_id": uid}, {"_id": 0})
            if prof:
                profile_by_user[uid] = prof
    pot = entry_fee * len(participants) * REWARD_POOL_PCT
    if pot < RACING_BASE_CASH_POOL:
        pot = RACING_BASE_CASH_POOL
    lap_scale = max(1.0, num_laps / LAPS_PRIZE_SCALE_BASE) if num_laps > LAPS_PRIZE_SCALE_BASE else 1.0
    pot = int(pot * lap_scale)
    rewards = []
    for i, entrant_id in enumerate(result_order):
        position = i + 1
        entrant = next((x for x in participants if (x.get("user_id") or x.get("id")) == entrant_id), None)
        is_dnf = entrant_id in dnf_ids
        if entrant:
            entrant["dnf"] = is_dnf
        pct = REWARD_BY_POSITION[i] if i < len(REWARD_BY_POSITION) else 0
        cash = 0 if is_dnf else int(pot * pct * reward_mult)
        rp = 0 if is_dnf else (RANK_POINTS_BY_POSITION[i] if i < len(RANK_POINTS_BY_POSITION) else 0)
        rep = 0 if is_dnf else (RACING_REP_BY_POSITION[i] if i < len(RACING_REP_BY_POSITION) else 0)
        sponsor_income = 0
        driver_salary = 0
        net_crew_bank = 0
        if entrant and not entrant.get("is_npc"):
            uid = entrant.get("user_id")
            prof_for_sponsor = profile_by_user.get(uid) or {}
            sponsor = _get_sponsor(int(prof_for_sponsor.get("racing_rep") or 0))
            sponsor_income = int(sponsor.get("income_per_race", 0) or 0) if not is_dnf else 0
            hired_drv_id = prof_for_sponsor.get("hired_driver_id")
            if hired_drv_id:
                hired_drv = _get_driver(hired_drv_id)
                if hired_drv:
                    driver_salary = int(hired_drv.get("salary_per_race", 0) or 0)
            crew_credit = int(cash) + sponsor_income
            if not is_dnf:
                await db.users.update_one({"id": uid}, {"$inc": {"rank_points": rp}})
                await db.racing_profiles.update_one(
                    {"user_id": uid},
                    {"$inc": {"racing_rep": rep, "races_completed": 1, "wins": 1 if position == 1 else 0, "crew_bank": crew_credit}},
                    upsert=True,
                )
                try:
                    rp_before = int((await db.users.find_one({"id": uid}, {"rank_points": 1}) or {}).get("rank_points", 0)) - rp
                    await maybe_process_rank_up(uid, rp_before, rp, entrant.get("username", ""))
                except Exception:
                    pass
                from_crew = await _pay_driver_salary_from_user_then_crew(uid, driver_salary)
                net_crew_bank = crew_credit - from_crew
            else:
                await db.racing_profiles.update_one(
                    {"user_id": uid},
                    {"$inc": {"races_completed": 1}},
                    upsert=True,
                )
                from_crew = await _pay_driver_salary_from_user_then_crew(uid, driver_salary)
                net_crew_bank = -from_crew
            inst_id = entrant.get("racing_car_instance_id")
            if inst_id:
                car = await db.user_racing_cars.find_one({"user_id": uid, "id": inst_id}, {"_id": 0, "engine_wear": 1})
                if car is not None:
                    current_wear = float(car.get("engine_wear") or 0)
                    up = await db.racing_upgrades.find_one({"user_id": uid, "racing_car_instance_id": inst_id}, {"_id": 0, "cooling_level": 1})
                    cooling = int((up or {}).get("cooling_level") or 0)
                    wear_mult = 1.0 - cooling * COOLING_WEAR_REDUCTION_PER_LEVEL
                    added_wear = ENGINE_WEAR_PER_RACE * max(0, wear_mult)
                    new_wear = min(ENGINE_WEAR_MAX, current_wear + added_wear)
                    await db.user_racing_cars.update_one(
                        {"user_id": uid, "id": inst_id},
                        {"$set": {"engine_wear": round(new_wear, 1)}},
                    )
            compound = (entrant.get("tyre_compound") or "medium").strip().lower()
            await db.racing_profiles.update_one(
                {"user_id": uid},
                {"$inc": {f"tyre_stock_{compound}": -1}},
                upsert=True,
            )
        rewards.append({
            "entrant_id": entrant_id,
            "position": position,
            "cash": cash,
            "rank_points": rp,
            "racing_rep": rep,
            "dnf": is_dnf,
            "sponsor_income": sponsor_income,
            "driver_salary": driver_salary,
            "net_crew_bank": net_crew_bank,
        })
    now = _now_iso()
    await db.racing_races.update_one(
        {"id": race_id},
        {"$set": {
            "state": "completed",
            "participants": participants,
            "result_order": result_order,
            "completed_at": now,
            "rewards": rewards,
            "dnf_ids": dnf_ids,
            "lap_results": lap_results,
            "pit_stops": pit_stops,
            "tire_wear_after_lap": tire_wear_after_lap,
        }},
    )
    race["state"] = "completed"
    race["participants"] = participants
    race["result_order"] = result_order
    race["completed_at"] = now
    race["rewards"] = rewards
    race["dnf_ids"] = dnf_ids
    race["lap_results"] = lap_results
    race["pit_stops"] = pit_stops
    race["tire_wear_after_lap"] = tire_wear_after_lap
    winner_id = result_order[0] if result_order else None
    if winner_id and winner_id not in dnf_ids:
        asyncio.create_task(_settle_race_bets(race_id, winner_id))
    else:
        asyncio.create_task(_refund_race_bets(race_id))
    asyncio.create_task(_update_track_records(race_id, race.get("track_id") or "", lap_results, participants))
    asyncio.create_task(_award_championship_points(race_id, result_order, dnf_ids, participants))

    h2h_stake = int(race.get("h2h_stake") or 0)
    challenge_id = race.get("challenge_id")
    if h2h_stake > 0 and challenge_id:
        total_pot = h2h_stake * 2
        if winner_id and winner_id not in dnf_ids:
            await db.users.update_one({"id": winner_id}, {"$inc": {"money": total_pot}})
            winner_p = next((p for p in participants if (p.get("user_id") or p.get("id")) == winner_id), None)
            winner_name = (winner_p or {}).get("username", "?")
        else:
            p_ids = [p.get("user_id") for p in participants if not p.get("is_npc") and p.get("user_id")]
            for pid in p_ids:
                await db.users.update_one({"id": pid}, {"$inc": {"money": h2h_stake}})
            winner_name = "Draw (stakes returned)"
        await db.racing_challenges.update_one(
            {"id": challenge_id},
            {"$set": {"state": "completed", "winner_id": winner_id, "completed_at": _now_iso()}},
        )
        for p in participants:
            uid = p.get("user_id")
            if uid and not p.get("is_npc"):
                await send_notification(uid, f"H2H race finished! {winner_name} wins ${total_pot:,}!", "racing_challenge_result")

    return {"message": "Race completed", "race": race}


async def get_championship(current_user: dict = Depends(get_current_user_verified)):
    """Get current active championship with calendar, standings, and next race info."""
    champ = await _ensure_active_championship()
    calendar = champ.get("race_calendar") or []
    next_race = None
    for entry in calendar:
        if not entry.get("completed"):
            next_race = entry
            break
    completed_races = sum(1 for e in calendar if e.get("completed"))
    driver_standings = champ.get("driver_standings") or {}
    sorted_drivers = sorted(
        driver_standings.items(),
        key=lambda x: (-x[1].get("points", 0), -x[1].get("wins", 0)),
    )
    my_position = None
    for i, (uid, _) in enumerate(sorted_drivers):
        if uid == current_user["id"]:
            my_position = i + 1
            break
    safe_champ = {k: v for k, v in champ.items() if k != "_id"}
    safe_champ["championship_id"] = champ.get("_id")
    return {
        "championship": safe_champ,
        "next_race": next_race,
        "completed_races": completed_races,
        "total_races": len(calendar),
        "my_championship_position": my_position,
    }


async def get_championship_standings(current_user: dict = Depends(get_current_user_verified)):
    """Detailed championship standings sorted by points."""
    champ = await _ensure_active_championship()
    driver_standings = champ.get("driver_standings") or {}
    constructor_standings = champ.get("constructor_standings") or {}

    sorted_drivers = sorted(
        [{"user_id": uid, **data} for uid, data in driver_standings.items()],
        key=lambda x: (-x.get("points", 0), -x.get("wins", 0)),
    )
    for i, d in enumerate(sorted_drivers):
        d["position"] = i + 1

    sorted_constructors = sorted(
        [{"user_id": uid, **data} for uid, data in constructor_standings.items()],
        key=lambda x: (-x.get("points", 0), -x.get("wins", 0)),
    )
    for i, c in enumerate(sorted_constructors):
        c["position"] = i + 1

    my_driver = next((d for d in sorted_drivers if d["user_id"] == current_user["id"]), None)
    my_constructor = next((c for c in sorted_constructors if c["user_id"] == current_user["id"]), None)

    return {
        "driver_standings": sorted_drivers,
        "constructor_standings": sorted_constructors,
        "my_driver_standing": my_driver,
        "my_constructor_standing": my_constructor,
        "season_name": champ.get("season_name"),
        "status": champ.get("status"),
    }


async def get_racing_leaderboard(current_user: dict = Depends(get_current_user), limit: int = 50):
    limit = min(limit, 100)
    cursor = db.racing_profiles.find({}, {"_id": 0, "user_id": 1, "wins": 1, "racing_rep": 1, "races_completed": 1}).sort("wins", -1).limit(limit)
    profs = await cursor.to_list(limit)
    user_ids = [p["user_id"] for p in profs]
    users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1}).to_list(len(user_ids))
    by_id = {u["id"]: u for u in users}
    out = []
    for i, p in enumerate(profs):
        u = by_id.get(p["user_id"]) or {}
        out.append({
            "rank": i + 1,
            "user_id": p["user_id"],
            "username": u.get("username") or "?",
            "wins": int(p.get("wins") or 0),
            "racing_rep": int(p.get("racing_rep") or 0),
            "races_completed": int(p.get("races_completed") or 0),
        })
    return {"leaderboard": out}


async def get_racing_comps(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    cursor = db.racing_comps.find(
        {"start_at": {"$lte": now}, "end_at": {"$gt": now}},
        {"_id": 0}
    ).sort("end_at", 1).limit(20)
    comps = await cursor.to_list(20)
    if not comps:
        # Seed one default comp so "Race comps" has content
        comp_id = str(uuid.uuid4())
        start_at = now
        end_at = now + timedelta(days=7)
        seed_comp = {
            "id": comp_id,
            "name": "Chicago Board Track Weekly",
            "track_id": "chicago_board",
            "entry_fee": 5000,
            "start_at": start_at.isoformat().replace("+00:00", "Z"),
            "end_at": end_at.isoformat().replace("+00:00", "Z"),
        }
        await db.racing_comps.insert_one(seed_comp.copy())
        # Use a clean dict for response (insert_one may add _id to the passed dict in place)
        comps = [
            {"id": comp_id, "name": seed_comp["name"], "track_id": seed_comp["track_id"], "entry_fee": seed_comp["entry_fee"], "start_at": seed_comp["start_at"], "end_at": seed_comp["end_at"]}
        ]
    return {"comps": comps}


async def enter_racing_comp(comp_id: str, body: JoinRaceRequest, current_user: dict = Depends(get_current_user_verified)):
    comp = await db.racing_comps.find_one({"id": comp_id}, {"_id": 0})
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    now = datetime.now(timezone.utc)
    start_at = datetime.fromisoformat((comp.get("start_at") or "").replace("Z", "+00:00")) if comp.get("start_at") else None
    end_at = datetime.fromisoformat((comp.get("end_at") or "").replace("Z", "+00:00")) if comp.get("end_at") else None
    if start_at and now < start_at:
        raise HTTPException(status_code=400, detail="Competition has not started")
    if end_at and now > end_at:
        raise HTTPException(status_code=400, detail="Competition has ended")
    existing = await db.racing_comp_entries.find_one({"comp_id": comp_id, "user_id": current_user["id"]})
    if existing:
        raise HTTPException(status_code=400, detail="Already entered")
    instance_id = (body.racing_car_instance_id or "").strip()
    car_doc = await _get_user_racing_car(current_user["id"], instance_id)
    if not car_doc:
        raise HTTPException(status_code=404, detail="Racing car not found")
    entry_fee = int(comp.get("entry_fee") or 0)
    if entry_fee > 0:
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
        if int(user.get("money") or 0) < entry_fee:
            raise HTTPException(status_code=400, detail="Insufficient cash")
    await db.racing_comp_entries.insert_one({
        "id": str(uuid.uuid4()),
        "comp_id": comp_id,
        "user_id": current_user["id"],
        "username": current_user.get("username") or "?",
        "racing_car_instance_id": instance_id,
        "racing_car_id": car_doc.get("racing_car_id"),
        "entered_at": _now_iso(),
    })
    if entry_fee > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -entry_fee}})
    return {"message": "Entered competition"}


def _next_automated_race_utc() -> str:
    """Compute the next automated race time (morning or evening, whichever is soonest)."""
    now = datetime.now(timezone.utc)
    candidates = []
    for hour in (RACING_AUTOMATED_MORNING_HOUR, RACING_AUTOMATED_EVENING_HOUR):
        slot = now.replace(hour=hour, minute=0, second=0, microsecond=0)
        if slot <= now:
            slot += timedelta(days=1)
        candidates.append(slot)
    nxt = min(candidates)
    return nxt.isoformat().replace("+00:00", "Z")


async def get_latest_automated_race(current_user: dict = Depends(get_current_user_verified)):
    """Return the user's most recent automated race (completed)."""
    uid = current_user["id"]
    race = await db.racing_races.find_one(
        {"is_automated": True, "state": "completed", "participants.user_id": uid},
        {"_id": 0},
        sort=[("completed_at", -1)],
    )
    if not race:
        return {"race": None, "next_automated_race_utc": _next_automated_race_utc()}
    return {"race": race, "next_automated_race_utc": _next_automated_race_utc()}


# ---------- Racing Bets ----------

def _compute_race_odds(participants: list) -> Dict[str, float]:
    """Generate odds per entrant based on car effective_speed/grip and racing_rep."""
    scores = {}
    for p in participants:
        speed = float(p.get("effective_speed") or p.get("speed") or 50)
        grip = float(p.get("effective_grip") or p.get("grip") or 50)
        rep = float(p.get("racing_rep") or 0)
        scores[p.get("user_id") or p.get("id")] = speed + grip * 0.8 + rep * 0.3
    total = sum(scores.values()) or 1
    odds = {}
    for eid, sc in scores.items():
        raw_prob = sc / total
        fair_odds = 1.0 / max(raw_prob, 0.01)
        odds[eid] = round(max(1.15, min(fair_odds * 0.92, 25.0)), 2)
    return odds


async def get_race_bet_odds(race_id: str, current_user: dict = Depends(get_current_user)):
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    participants = list(race.get("participants") or [])
    odds = _compute_race_odds(participants)
    entrants = []
    for p in participants:
        eid = p.get("user_id") or p.get("id")
        entrants.append({
            "entrant_id": eid,
            "username": p.get("username") or p.get("name") or "?",
            "car_name": p.get("car_name") or "?",
            "odds": odds.get(eid, 2.0),
        })
    return {"race_id": race_id, "entrants": entrants, "state": race.get("state")}


async def place_race_bet(payload: PlaceRaceBetRequest, current_user: dict = Depends(get_current_user_verified)):
    race_id = (payload.race_id or "").strip()
    entrant_id = (payload.entrant_id or "").strip()
    stake = int(payload.stake or 0)
    if stake <= 0:
        raise HTTPException(status_code=400, detail="Stake must be > 0")

    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    if race.get("state") != "open":
        raise HTTPException(status_code=400, detail="Bets only accepted while race is open")

    participants = list(race.get("participants") or [])
    valid_ids = {(p.get("user_id") or p.get("id")) for p in participants}
    if entrant_id not in valid_ids:
        raise HTTPException(status_code=400, detail="Invalid entrant")
    if entrant_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot bet on yourself")

    odds = _compute_race_odds(participants)
    entrant_odds = odds.get(entrant_id, 2.0)

    bet_id = str(uuid.uuid4())
    result = await db.users.update_one(
        {"id": current_user["id"], "money": {"$gte": stake}},
        {"$inc": {"money": -stake}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient cash")

    entrant_info = next((p for p in participants if (p.get("user_id") or p.get("id")) == entrant_id), {})
    await db.racing_bets.insert_one({
        "id": bet_id, "user_id": current_user["id"],
        "race_id": race_id, "entrant_id": entrant_id,
        "entrant_username": entrant_info.get("username") or entrant_info.get("name") or "?",
        "odds": entrant_odds, "stake": stake, "status": "open",
        "created_at": _now_iso(),
    })
    await log_gambling(
        current_user["id"], current_user.get("username") or "?", "racing_bet",
        {"bet_id": bet_id, "race_id": race_id, "entrant_id": entrant_id, "odds": entrant_odds, "stake": stake},
    )
    who = entrant_info.get("username") or entrant_info.get("name") or "?"
    return {"message": f"Bet ${stake:,} on {who} at {entrant_odds}x", "bet_id": bet_id}


async def list_race_bets(current_user: dict = Depends(get_current_user_verified)):
    open_bets = await db.racing_bets.find(
        {"user_id": current_user["id"], "status": "open"}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    settled = await db.racing_bets.find(
        {"user_id": current_user["id"], "status": {"$in": ["won", "lost", "refunded"]}}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return {"open": open_bets, "settled": settled}


async def _settle_race_bets(race_id: str, winner_id: str):
    now = _now_iso()
    bets = await db.racing_bets.find({"race_id": race_id, "status": "open"}, {"_id": 0}).to_list(2000)
    for bet in bets:
        won = bet.get("entrant_id") == winner_id
        status = "won" if won else "lost"
        res = await db.racing_bets.update_one(
            {"id": bet["id"], "status": "open"},
            {"$set": {"status": status, "settled_at": now}}
        )
        if res.modified_count > 0 and won:
            payout = int(int(bet.get("stake") or 0) * float(bet.get("odds") or 1.0))
            if payout > 0:
                await db.users.update_one({"id": bet["user_id"]}, {"$inc": {"money": payout}})
        u = await db.users.find_one({"id": bet["user_id"]}, {"_id": 0, "username": 1})
        await log_gambling(
            bet["user_id"], (u or {}).get("username", "?"), "racing_bet_settle",
            {"bet_id": bet["id"], "race_id": race_id, "status": status, "settled_at": now},
        )


async def _refund_race_bets(race_id: str):
    now = _now_iso()
    bets = await db.racing_bets.find({"race_id": race_id, "status": "open"}, {"_id": 0}).to_list(2000)
    for bet in bets:
        res = await db.racing_bets.update_one(
            {"id": bet["id"], "status": "open"},
            {"$set": {"status": "refunded", "settled_at": now}}
        )
        if res.modified_count > 0:
            stake = int(bet.get("stake") or 0)
            if stake > 0:
                await db.users.update_one({"id": bet["user_id"]}, {"$inc": {"money": stake}})


# ---------- Head-to-Head Challenges ----------

async def create_race_challenge(payload: RaceChallengeCreateRequest, current_user: dict = Depends(get_current_user_verified)):
    target_name = (payload.target_username or "").strip()
    if not target_name:
        raise HTTPException(status_code=400, detail="Target username required")
    safe = re.escape(target_name)
    target = await db.users.find_one({"username": {"$regex": f"^{safe}$", "$options": "i"}}, {"_id": 0, "id": 1, "username": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Player not found")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot challenge yourself")

    track = _get_track(payload.track_id)
    if not track:
        raise HTTPException(status_code=400, detail="Invalid track")
    stake = max(0, min(ENTRY_FEE_MAX, int(payload.stake or 0)))
    laps = max(NUM_LAPS_MIN, min(NUM_LAPS_MAX, int(payload.laps or 3)))
    weather_id = (payload.weather_id or "").strip().lower() or "clear"
    weather = _get_weather(weather_id)

    if stake > 0:
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
        if int((user or {}).get("money") or 0) < stake:
            raise HTTPException(status_code=400, detail="Insufficient cash for stake")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -stake}})

    challenge_id = str(uuid.uuid4())
    doc = {
        "id": challenge_id,
        "challenger_id": current_user["id"],
        "challenger_username": current_user.get("username") or "?",
        "target_id": target["id"],
        "target_username": target["username"],
        "track_id": payload.track_id,
        "track_name": track.get("name", payload.track_id),
        "stake": stake,
        "laps": laps,
        "weather": weather_id,
        "weather_name": weather.get("name", "Clear"),
        "state": "pending",
        "created_at": _now_iso(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat().replace("+00:00", "Z"),
    }
    await db.racing_challenges.insert_one(doc)
    doc.pop("_id", None)

    await send_notification(target["id"], f"⚔ {current_user.get('username','?')} challenges you to a race on {track.get('name','')}! Stake: ${stake:,}", "racing_challenge")
    return {"message": f"Challenge sent to {target['username']}", "challenge_id": challenge_id, "challenge": doc}


async def list_race_challenges(current_user: dict = Depends(get_current_user_verified)):
    incoming = await db.racing_challenges.find(
        {"target_id": current_user["id"], "state": "pending"}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    outgoing = await db.racing_challenges.find(
        {"challenger_id": current_user["id"], "state": "pending"}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    completed = await db.racing_challenges.find(
        {"$or": [{"challenger_id": current_user["id"]}, {"target_id": current_user["id"]}], "state": "completed"},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20)
    return {"incoming": incoming, "outgoing": outgoing, "completed": completed}


async def accept_race_challenge(challenge_id: str, current_user: dict = Depends(get_current_user_verified)):
    ch = await db.racing_challenges.find_one({"id": challenge_id, "state": "pending"}, {"_id": 0})
    if not ch:
        raise HTTPException(status_code=404, detail="Challenge not found or already resolved")
    if ch["target_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not your challenge to accept")

    stake = int(ch.get("stake") or 0)
    if stake > 0:
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
        if int((user or {}).get("money") or 0) < stake:
            raise HTTPException(status_code=400, detail="Insufficient cash for stake")
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -stake}})

    # Build minimal participants
    ch_prof = await _ensure_racing_profile(ch["challenger_id"])
    tgt_prof = await _ensure_racing_profile(current_user["id"])
    ch_car = await db.user_racing_cars.find_one({"user_id": ch["challenger_id"], "id": ch_prof.get("selected_racing_car_id")}, {"_id": 0})
    tgt_car = await db.user_racing_cars.find_one({"user_id": current_user["id"], "id": tgt_prof.get("selected_racing_car_id")}, {"_id": 0})

    participants = [
        {
            "user_id": ch["challenger_id"], "username": ch.get("challenger_username", "?"),
            "car_name": (ch_car or {}).get("car_name", "?"), "is_npc": False,
            "racing_car_instance_id": ch_prof.get("selected_racing_car_id"),
            "speed": float((ch_car or {}).get("effective_speed") or 50),
            "grip": float((ch_car or {}).get("effective_grip") or 0.5),
            "tyre_compound": "medium",
        },
        {
            "user_id": current_user["id"], "username": current_user.get("username", "?"),
            "car_name": (tgt_car or {}).get("car_name", "?"), "is_npc": False,
            "racing_car_instance_id": tgt_prof.get("selected_racing_car_id"),
            "speed": float((tgt_car or {}).get("effective_speed") or 50),
            "grip": float((tgt_car or {}).get("effective_grip") or 0.5),
            "tyre_compound": "medium",
        },
    ]

    race_id = str(uuid.uuid4())
    track = _get_track(ch["track_id"])
    weather_id = ch.get("weather") or "clear"
    num_laps = ch.get("laps") or 3
    weather = _get_weather(weather_id)

    race_doc = {
        "id": race_id, "track_id": ch["track_id"], "track_name": ch.get("track_name", ""),
        "entry_fee": 0, "max_grid": 2, "state": "open",
        "created_by": ch["challenger_id"], "created_at": _now_iso(),
        "weather": weather_id, "weather_name": weather.get("name", "Clear"),
        "participants": participants, "laps": num_laps,
        "challenge_id": challenge_id, "is_h2h": True,
        "interactive": True,
        "lobby_ends_at": _now_iso(),
        "reward_mult": (track or {}).get("reward_mult", 1.0),
        "h2h_stake": stake,
    }

    await db.racing_races.insert_one(race_doc)
    race_doc.pop("_id", None)

    started_race = await _start_race_internal(race_id)

    await db.racing_challenges.update_one(
        {"id": challenge_id},
        {"$set": {"state": "in_progress", "race_id": race_id, "accepted_at": _now_iso()}}
    )

    await send_notification(
        ch["challenger_id"],
        f"🏁 {current_user.get('username','?')} accepted your race challenge! Race is live — make your decisions!",
        "racing_challenge_accepted",
    )

    return {"message": "Challenge accepted — race is live!", "race": started_race or race_doc, "race_id": race_id}


async def decline_race_challenge(challenge_id: str, current_user: dict = Depends(get_current_user_verified)):
    ch = await db.racing_challenges.find_one({"id": challenge_id, "state": "pending"}, {"_id": 0})
    if not ch:
        raise HTTPException(status_code=404, detail="Challenge not found")
    if ch["target_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not your challenge")

    stake = int(ch.get("stake") or 0)
    if stake > 0:
        await db.users.update_one({"id": ch["challenger_id"]}, {"$inc": {"money": stake}})

    await db.racing_challenges.update_one({"id": challenge_id}, {"$set": {"state": "declined", "declined_at": _now_iso()}})
    await send_notification(ch["challenger_id"], f"{current_user.get('username','?')} declined your race challenge.", "racing_challenge_declined")
    return {"message": "Challenge declined"}


# ---------- Race History & Stats ----------

async def get_race_history(current_user: dict = Depends(get_current_user_verified), limit: int = 30):
    """Return the player's recent completed races."""
    limit = min(limit, 100)
    races = await db.racing_races.find(
        {"state": "completed", "participants.user_id": current_user["id"]},
        {"_id": 0, "id": 1, "track_id": 1, "track_name": 1, "weather": 1, "laps": 1,
         "completed_at": 1, "result_order": 1, "rewards": 1, "dnf_ids": 1, "participants": 1}
    ).sort("completed_at", -1).limit(limit).to_list(limit)

    history = []
    for race in races:
        result_order = race.get("result_order") or []
        rewards = race.get("rewards") or []
        my_reward = next((r for r in rewards if r.get("entrant_id") == current_user["id"]), None)
        position = my_reward.get("position") if my_reward else None
        cash = my_reward.get("cash", 0) if my_reward else 0
        is_dnf = current_user["id"] in (race.get("dnf_ids") or [])
        num_entrants = len(race.get("participants") or [])
        history.append({
            "race_id": race["id"],
            "track_id": race.get("track_id"),
            "track_name": race.get("track_name") or race.get("track_id"),
            "weather": race.get("weather"),
            "laps": race.get("laps"),
            "completed_at": race.get("completed_at"),
            "position": position,
            "cash": cash,
            "dnf": is_dnf,
            "num_entrants": num_entrants,
        })
    return {"history": history}


async def get_race_track_records(current_user: dict = Depends(get_current_user)):
    """Return best lap times per track (global and personal)."""
    records = {}
    for track in TRACKS:
        tid = track["id"]
        global_best = await db.racing_records.find_one(
            {"track_id": tid, "type": "global"}, {"_id": 0}
        )
        personal_best = await db.racing_records.find_one(
            {"track_id": tid, "type": "personal", "user_id": current_user["id"]}, {"_id": 0}
        )
        records[tid] = {
            "track_name": track.get("name", tid),
            "global_best_lap": global_best.get("best_lap") if global_best else None,
            "global_holder": global_best.get("username") if global_best else None,
            "personal_best_lap": personal_best.get("best_lap") if personal_best else None,
        }
    return {"records": records}


async def _update_track_records(race_id: str, track_id: str, lap_results: list, participants: list):
    """After a race completes, update global and personal lap records."""
    global_rec = await db.racing_records.find_one({"track_id": track_id, "type": "global"}, {"_id": 0})
    human_eids = []
    for entrant_laps in lap_results:
        eid = entrant_laps.get("entrant_id")
        entrant = next((p for p in participants if (p.get("user_id") or p.get("id")) == eid), None)
        if entrant and not entrant.get("is_npc") and eid:
            human_eids.append(eid)
    human_eids = list(dict.fromkeys(human_eids))
    personal_by_uid: Dict[str, dict] = {}
    if human_eids:
        async for doc in db.racing_records.find(
            {"track_id": track_id, "type": "personal", "user_id": {"$in": human_eids}},
            {"_id": 0},
        ):
            personal_by_uid[doc["user_id"]] = doc

    for entrant_laps in lap_results:
        eid = entrant_laps.get("entrant_id")
        laps = entrant_laps.get("laps") or []
        entrant = next((p for p in participants if (p.get("user_id") or p.get("id")) == eid), None)
        username = (entrant.get("username") or entrant.get("name") or "?") if entrant else "?"
        is_npc = bool(entrant.get("is_npc")) if entrant else True
        for lap_data in laps:
            lap_time = float(lap_data.get("time") or lap_data.get("lap_time") or 999)
            if lap_time <= 0 or lap_time >= 999:
                continue
            # Global record (one in-memory read per lap; refresh after beat)
            if not global_rec or lap_time < float(global_rec.get("best_lap") or 999):
                best = round(lap_time, 3)
                await db.racing_records.update_one(
                    {"track_id": track_id, "type": "global"},
                    {"$set": {"best_lap": best, "user_id": eid, "username": username,
                              "race_id": race_id, "set_at": _now_iso()}},
                    upsert=True,
                )
                global_rec = {
                    "best_lap": best, "user_id": eid, "username": username,
                    "race_id": race_id, "set_at": _now_iso(),
                }
            # Personal record (skip NPCs)
            if not is_npc and eid:
                personal_rec = personal_by_uid.get(eid)
                if not personal_rec or lap_time < float(personal_rec.get("best_lap") or 999):
                    best = round(lap_time, 3)
                    await db.racing_records.update_one(
                        {"track_id": track_id, "type": "personal", "user_id": eid},
                        {"$set": {"best_lap": best, "username": username,
                                  "race_id": race_id, "set_at": _now_iso()}},
                        upsert=True,
                    )
                    personal_by_uid[eid] = {
                        "best_lap": best, "user_id": eid, "username": username,
                        "race_id": race_id, "set_at": _now_iso(),
                    }


async def get_race_season_stats(current_user: dict = Depends(get_current_user_verified)):
    """Return player's stats for the current season."""
    prof = await _ensure_racing_profile(current_user["id"])
    meta = await db.racing_meta.find_one({"id": "main"}, {"_id": 0})
    season_start = None
    if meta:
        try:
            season_start = datetime.fromisoformat(meta.get("season_start_utc", "")).replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            pass

    match_filter = {"state": "completed", "participants.user_id": current_user["id"]}
    if season_start:
        match_filter["completed_at"] = {"$gte": season_start.isoformat().replace("+00:00", "Z")}

    races = await db.racing_races.find(match_filter, {
        "_id": 0, "rewards": 1, "dnf_ids": 1
    }).to_list(5000)

    wins = 0
    podiums = 0
    dnfs = 0
    total_earnings = 0
    total_races = len(races)

    for race in races:
        rewards = race.get("rewards") or []
        my_reward = next((r for r in rewards if r.get("entrant_id") == current_user["id"]), None)
        if my_reward:
            pos = my_reward.get("position", 99)
            if pos == 1:
                wins += 1
            if pos <= 3:
                podiums += 1
            total_earnings += int(my_reward.get("cash") or 0)
        if current_user["id"] in (race.get("dnf_ids") or []):
            dnfs += 1

    return {
        "season_stats": {
            "total_races": total_races,
            "wins": wins,
            "podiums": podiums,
            "dnfs": dnfs,
            "total_earnings": total_earnings,
            "racing_rep": int(prof.get("racing_rep") or 0),
        }
    }


# ---------- Driver Endpoints ----------

async def get_driver_market(current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_racing_profile(current_user["id"])
    _require_racing_team(prof)
    hired_ids_cursor = db.racing_profiles.find(
        {"hired_driver_id": {"$ne": None}},
        {"_id": 0, "hired_driver_id": 1},
    )
    hired_docs = await hired_ids_cursor.to_list(200)
    hired_set = {d["hired_driver_id"] for d in hired_docs if d.get("hired_driver_id")}
    pool = []
    for d in DRIVER_POOL:
        pool.append({**d, "hired": d["id"] in hired_set})
    return {"drivers": pool}


async def hire_driver(body: HireDriverRequest, current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_racing_profile(current_user["id"])
    _require_racing_team(prof)
    if prof.get("hired_driver_id"):
        raise HTTPException(status_code=400, detail="You already have a driver. Fire your current driver first.")
    driver = _get_driver(body.driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found in pool")
    already = await db.racing_profiles.find_one(
        {"hired_driver_id": body.driver_id, "user_id": {"$ne": current_user["id"]}},
        {"_id": 0, "user_id": 1},
    )
    if already:
        raise HTTPException(status_code=400, detail="This driver is already hired by another team")
    await db.racing_profiles.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"hired_driver_id": body.driver_id}},
    )
    return {"message": f"Hired {driver['name']}", "driver": driver}


async def fire_driver(current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_racing_profile(current_user["id"])
    _require_racing_team(prof)
    if not prof.get("hired_driver_id"):
        raise HTTPException(status_code=400, detail="You don't have a driver to fire")
    old_driver = _get_driver(prof["hired_driver_id"])
    await db.racing_profiles.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"hired_driver_id": None}},
    )
    name = old_driver["name"] if old_driver else "Unknown"
    return {"message": f"Fired {name}"}


async def get_my_driver(current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_racing_profile(current_user["id"])
    driver_id = prof.get("hired_driver_id")
    if not driver_id:
        return {"driver": None}
    driver = _get_driver(driver_id)
    return {"driver": driver}


# ---------- Interactive Race Mode ----------


def _build_sim_caches(
    entrants: List[dict], profile_by_user: Dict[str, dict],
) -> tuple:
    """Build crew_cache and driver_cache for simulation.  Call inside a seeded RNG context for NPC consistency."""
    crew_cache: Dict[str, dict] = {}
    driver_cache: Dict[str, dict] = {}
    for e in entrants:
        eid = e.get("user_id") or e.get("id")
        prof = profile_by_user.get(eid) or {}
        crew_cache[eid] = {
            "strategist": int(prof.get("strategist_level") or 0),
            "spotter": int(prof.get("spotter_level") or 0),
            "tyre_tech": int(prof.get("tyre_tech_level") or 0),
            "fuel_tech": int(prof.get("fuel_tech_level") or 0),
            "data_analyst": int(prof.get("data_analyst_level") or 0),
            "logistics": int(prof.get("logistics_level") or 0),
            "morale": int(prof.get("morale_level") or 0),
            "tactician": int(prof.get("tactician_level") or 0),
        }
        if e.get("is_npc"):
            driver_cache[eid] = {
                "skill": random.randint(50, 70),
                "consistency": random.randint(50, 70),
                "racecraft": random.randint(50, 70),
                "wet_ability": random.randint(50, 70),
                "tire_management": random.randint(50, 70),
                "aggression": random.randint(30, 60),
            }
        else:
            drv_id = prof.get("hired_driver_id")
            drv = _get_driver(drv_id) if drv_id else None
            if drv:
                driver_cache[eid] = {
                    "skill": drv["skill"],
                    "consistency": drv["consistency"],
                    "racecraft": drv["racecraft"],
                    "wet_ability": drv["wet_ability"],
                    "tire_management": drv["tire_management"],
                    "aggression": drv["aggression"],
                }
            else:
                driver_cache[eid] = {
                    "skill": 50, "consistency": 50, "racecraft": 50,
                    "wet_ability": 50, "tire_management": 50, "aggression": 40,
                }
    return crew_cache, driver_cache


async def _start_interactive_race(
    race_id: str, race: dict, participants: List[dict],
    profile_by_user: Dict[str, dict], upgrades_map: Dict[str, dict],
    engine_wear_by_entrant: Dict[str, float], num_laps: int,
    weather_id: str, weather: dict, qualifying_order: list,
    qualifying_results: list, track: Optional[dict],
) -> dict:
    """Set up interactive race state instead of running the full simulation."""
    with _SeededRandom(f"interactive_init:{race_id}"):
        crew_cache, driver_cache = _build_sim_caches(participants, profile_by_user)

    car_states: Dict[str, dict] = {}
    for i, p in enumerate(participants):
        eid = p.get("user_id") or p.get("id")
        car_states[eid] = {
            "tyre_wear": 100.0,
            "engine_wear": float(engine_wear_by_entrant.get(eid) or 0),
            "damage": 0.0,
            "dnf": False,
            "compound": (p.get("tyre_compound") or "medium").lower(),
            "push_level": 3,
            "last_lap_time": None,
            "position": i + 1,
            "fuel_pct": 100.0,
        }

    now = _now_iso()

    safe_profiles = {}
    for k, v in profile_by_user.items():
        safe_profiles[k] = {fk: fv for fk, fv in v.items() if fk != "_id"}

    update_fields = {
        "state": "running",
        "mode": "interactive",
        "participants": participants,
        "qualifying_order": qualifying_order,
        "qualifying_results": qualifying_results,
        "upgrades_snapshot": upgrades_map,
        "engine_wear_snapshot": engine_wear_by_entrant,
        "profile_snapshot": safe_profiles,
        "driver_snapshot": driver_cache,
        "crew_snapshot": crew_cache,
        "laps": num_laps,
        "current_lap": 0,
        "total_laps": num_laps,
        "lap_deadline": None,
        "car_states": car_states,
        "decisions": {},
        "lap_results": [],
        "pit_stops": [],
        "incidents": [],
        "dnf_ids": [],
        "weather": weather_id,
        "weather_name": weather.get("name", "Clear"),
        "started_at": now,
        "result_order": None,
        "rewards": None,
        "completed_at": None,
        "race_events": [],
        "gaps_to_ahead": {},
        "safety_car_laps_remaining": 0,
        "lap_times_by_lap": [],
    }

    await db.racing_races.update_one({"id": race_id}, {"$set": update_fields})
    race_out = dict(race)
    race_out.update(update_fields)
    return race_out


def _run_one_interactive_lap(
    lap_num: int,
    total_laps: int,
    entrants: List[dict],
    profile_by_user: Dict[str, dict],
    upgrades_map: Dict[str, dict],
    car_states: Dict[str, dict],
    decisions: Dict[str, dict],
    weather_id: str,
    track: Optional[dict],
    crew_cache: Dict[str, dict],
    driver_cache: Dict[str, dict],
    prior_lap_results: List[List[str]],
    race_id: str,
    prev_gaps_to_ahead: Dict[str, float],
    safety_car_laps_remaining: int,
) -> InteractiveLapResult:
    cfg = _build_lap_engine_config()
    cfg.engine_wear_per_race_divisor = ENGINE_WEAR_PER_RACE / max(1, total_laps)

    rnd_cache: Dict[str, dict] = {}
    for e in entrants:
        eid = e.get("user_id") or e.get("id")
        rnd_cache[eid] = (
            _get_rnd_bonuses({}) if e.get("is_npc") else _get_rnd_bonuses(profile_by_user.get(eid) or {})
        )

    for e in entrants:
        eid = e.get("user_id") or e.get("id")
        if car_states.get(eid, {}).get("dnf"):
            continue
        speed_val, grip_val = _effective_speed_and_grip(e, profile_by_user.get(eid) or {}, upgrades_map)
        rnd_b = rnd_cache[eid]
        speed_val *= 1.0 + rnd_b.get("speed_pct", 0)
        grip_val *= 1.0 + rnd_b.get("grip_pct", 0) - rnd_b.get("grip_penalty", 0)
        grip_val = max(0.5, min(1.0, grip_val))
        car_states[eid]["_lap_speed_base"] = speed_val
        car_states[eid]["_lap_grip_base"] = grip_val
        car_states[eid]["_rnd"] = rnd_b

    seed = int(hashlib.sha256(f"{race_id}:{lap_num}:interactive_lap".encode()).hexdigest()[:16], 16)
    rng = random.Random(seed)

    dec_copy: Dict[str, Any] = {}
    for k, v in (decisions or {}).items():
        dec_copy[k] = dict(v) if isinstance(v, dict) else v
    for e in entrants:
        eid = e.get("user_id") or e.get("id")
        if e.get("is_npc"):
            continue
        d = dec_copy.get(eid)
        if isinstance(d, dict) and d.get("pace_mode"):
            pm = str(d["pace_mode"]).strip().lower()
            if pm in ("push", "normal", "conserve"):
                d["pace_mode"] = pm

    return run_interactive_lap_turn(
        cfg,
        lap_num,
        total_laps,
        entrants,
        profile_by_user,
        upgrades_map,
        car_states,
        dec_copy,
        weather_id,
        track,
        crew_cache,
        driver_cache,
        prior_lap_results,
        race_id,
        prev_gaps_to_ahead or {},
        int(safety_car_laps_remaining or 0),
        rng,
    )


async def _advance_one_lap(race: dict) -> Optional[dict]:
    """Advance an interactive race by one lap.  Returns updated race or None if already advanced."""
    race_id = race["id"]
    current_lap = int(race.get("current_lap") or 0)
    total_laps = int(race.get("total_laps") or race.get("laps") or 3)

    if current_lap >= total_laps:
        return None

    new_lap = current_lap + 1
    participants = list(race.get("participants") or [])
    profile_by_user = race.get("profile_snapshot") or {}
    upgrades_map = race.get("upgrades_snapshot") or {}
    car_states = {k: dict(v) for k, v in (race.get("car_states") or {}).items()}
    decisions_raw = race.get("decisions") or {}
    weather_id = race.get("weather") or "clear"
    track = _get_track(race.get("track_id") or "")
    crew_cache = race.get("crew_snapshot") or {}
    driver_cache = race.get("driver_snapshot") or {}
    prior_lap_results = list(race.get("lap_results") or [])

    prev_gaps = dict(race.get("gaps_to_ahead") or {})
    sc_rem = int(race.get("safety_car_laps_remaining") or 0)
    lap_res = _run_one_interactive_lap(
        new_lap,
        total_laps,
        participants,
        profile_by_user,
        upgrades_map,
        car_states,
        decisions_raw,
        weather_id,
        track,
        crew_cache,
        driver_cache,
        prior_lap_results,
        race_id,
        prev_gaps,
        sc_rem,
    )
    lap_order = lap_res.order
    new_pit_stops = lap_res.new_pit_stops
    new_incidents = lap_res.new_incidents
    updated_cs = lap_res.car_states
    new_dnfs = lap_res.new_dnfs

    w = _get_weather(lap_res.weather_id)
    race_events = list(race.get("race_events") or [])
    for ev in lap_res.lap_events:
        ev2 = dict(ev)
        ev2["lap"] = new_lap
        race_events.append(ev2)
    lap_times_by_lap = list(race.get("lap_times_by_lap") or [])
    lap_times_by_lap.append(lap_res.lap_time_sec)

    all_lap_results = prior_lap_results + [lap_order]
    all_pit_stops = list(race.get("pit_stops") or []) + new_pit_stops
    all_incidents = list(race.get("incidents") or []) + new_incidents
    all_dnf_ids = list(dict.fromkeys(list(race.get("dnf_ids") or []) + new_dnfs))

    is_final = new_lap >= total_laps

    if is_final:
        finishers = [eid for eid in lap_order if eid not in all_dnf_ids]
        result_order = finishers + all_dnf_ids

        update = {
            "current_lap": new_lap,
            "car_states": updated_cs,
            "decisions": {},
            "lap_results": all_lap_results,
            "pit_stops": all_pit_stops,
            "incidents": all_incidents,
            "dnf_ids": all_dnf_ids,
            "result_order": result_order,
            "lap_deadline": None,
            "weather": lap_res.weather_id,
            "weather_name": w.get("name", "Clear"),
            "gaps_to_ahead": lap_res.gaps_to_ahead,
            "safety_car_laps_remaining": lap_res.safety_car_laps_remaining,
            "race_events": race_events,
            "lap_times_by_lap": lap_times_by_lap,
        }

        res = await db.racing_races.update_one(
            {"id": race_id, "current_lap": current_lap, "state": "running"},
            {"$set": update},
        )
        if res.modified_count == 0:
            return None

        creator = next((p for p in participants if not p.get("is_npc")), participants[0] if participants else None)
        if creator:
            mock_user = {"id": creator.get("user_id") or creator.get("id"), "username": creator.get("username", "?")}
            body = CompleteRaceRequest(result_order=result_order, dnf_ids=all_dnf_ids)
            await complete_race(race_id, body, mock_user)

        for p in participants:
            if p.get("is_npc"):
                continue
            uid = p.get("user_id")
            cs = updated_cs.get(uid)
            inst_id = p.get("racing_car_instance_id")
            if cs and inst_id:
                final_wear = round(min(ENGINE_WEAR_MAX, float(cs.get("engine_wear") or 0)), 1)
                await db.user_racing_cars.update_one(
                    {"user_id": uid, "id": inst_id},
                    {"$set": {"engine_wear": final_wear}},
                )

        return await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    else:
        deadline = (datetime.now(timezone.utc) + timedelta(seconds=INTERACTIVE_LAP_DEADLINE_SEC)).isoformat().replace("+00:00", "Z")

        update = {
            "current_lap": new_lap,
            "car_states": updated_cs,
            "decisions": {},
            "lap_results": all_lap_results,
            "pit_stops": all_pit_stops,
            "incidents": all_incidents,
            "dnf_ids": all_dnf_ids,
            "lap_deadline": deadline,
            "weather": lap_res.weather_id,
            "weather_name": w.get("name", "Clear"),
            "gaps_to_ahead": lap_res.gaps_to_ahead,
            "safety_car_laps_remaining": lap_res.safety_car_laps_remaining,
            "race_events": race_events,
            "lap_times_by_lap": lap_times_by_lap,
        }

        res = await db.racing_races.update_one(
            {"id": race_id, "current_lap": current_lap, "state": "running"},
            {"$set": update},
        )
        if res.modified_count == 0:
            return None

        return await db.racing_races.find_one({"id": race_id}, {"_id": 0})


def _seconds_since_started_utc(race: dict) -> Optional[float]:
    sa = race.get("started_at")
    if not sa:
        return None
    try:
        s = str(sa).replace("Z", "+00:00")
        t = datetime.fromisoformat(s)
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t).total_seconds()
    except (ValueError, TypeError, OSError):
        return None


async def _open_interactive_lap1_decision_window(race_id: str) -> bool:
    """Arm lap-1 deadline (current_lap still 0). Clears decisions so nothing resolves before green."""
    deadline = (
        datetime.now(timezone.utc) + timedelta(seconds=INTERACTIVE_LAP_DEADLINE_SEC)
    ).isoformat().replace("+00:00", "Z")
    res = await db.racing_races.update_one(
        {
            "id": race_id,
            "mode": "interactive",
            "state": "running",
            "current_lap": 0,
            "lap_deadline": None,
        },
        {"$set": {"lap_deadline": deadline, "decisions": {}}},
    )
    return res.modified_count > 0


async def _maybe_auto_green_interactive(race_id: str) -> None:
    """After a timeout, open lap-1 window if clients never signaled green (disconnect / old client)."""
    race = await db.racing_races.find_one(
        {"id": race_id, "mode": "interactive", "state": "running"},
        {"_id": 0, "current_lap": 1, "lap_deadline": 1, "started_at": 1},
    )
    if not race:
        return
    if int(race.get("current_lap") or 0) != 0:
        return
    if race.get("lap_deadline"):
        return
    age = _seconds_since_started_utc(race)
    if age is None or age < INTERACTIVE_PRE_GREEN_FALLBACK_SEC:
        return
    await _open_interactive_lap1_decision_window(race_id)


async def _maybe_advance_interactive_lap(race_id: str):
    """Advance when lap deadline passed OR every living human entrant has submitted a decision."""
    race = await db.racing_races.find_one(
        {"id": race_id, "mode": "interactive", "state": "running"}, {"_id": 0},
    )
    if not race:
        return
    deadline = race.get("lap_deadline")
    if not deadline:
        return

    now = datetime.now(timezone.utc)
    try:
        dl = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        dl = None

    deadline_passed = dl is not None and now >= dl

    participants = race.get("participants") or []
    decisions = race.get("decisions") or {}
    dnf_ids = set(race.get("dnf_ids") or [])
    humans_alive: List[str] = []
    for p in participants:
        if p.get("is_npc"):
            continue
        eid = p.get("user_id") or p.get("id")
        if eid and eid not in dnf_ids:
            humans_alive.append(eid)
    all_humans_submitted = (
        len(humans_alive) > 0 and all(hid in decisions for hid in humans_alive)
    )

    if deadline_passed or all_humans_submitted:
        await _advance_one_lap(race)


async def submit_race_decision(
    race_id: str, body: RaceDecisionRequest,
    current_user: dict = Depends(get_current_user_verified),
):
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    if race.get("mode") != "interactive":
        raise HTTPException(status_code=400, detail="Race is not interactive")
    if race.get("state") != "running":
        raise HTTPException(status_code=400, detail="Race is not in progress")

    current_lap = int(race.get("current_lap") or 0)
    total_laps = int(race.get("total_laps") or race.get("laps") or 3)
    if current_lap >= total_laps:
        raise HTTPException(status_code=400, detail="Race already finished")
    if current_lap == 0 and not race.get("lap_deadline"):
        raise HTTPException(
            status_code=400,
            detail="Lap decision window opens after lights out (green flag)",
        )

    participants = race.get("participants") or []
    entrant_id = None
    for p in participants:
        if p.get("user_id") == current_user["id"] and not p.get("is_npc"):
            entrant_id = p["user_id"]
            break
    if not entrant_id:
        raise HTTPException(status_code=403, detail="You are not a participant in this race")

    cs = (race.get("car_states") or {}).get(entrant_id, {})
    if cs.get("dnf"):
        raise HTTPException(status_code=400, detail="Your car has DNF'd")

    pm = (body.pace_mode or "").strip().lower() or None
    if pm is not None and pm not in ("push", "normal", "conserve"):
        pm = None
    decision = {
        "push_level": max(1, min(5, int(body.push_level or 3))),
        "pit_this_lap": bool(body.pit_this_lap),
        "pit_compound": (body.pit_compound or "medium").strip().lower(),
        "defend": bool(body.defend),
        "pace_mode": pm,
        "reaction_ms": int(body.reaction_ms) if body.reaction_ms is not None else None,
    }

    await db.racing_races.update_one(
        {"id": race_id, "state": "running"},
        {"$set": {f"decisions.{entrant_id}": decision}},
    )

    await _maybe_advance_interactive_lap(race_id)
    return {"message": "Decision submitted", "decision": decision}


async def signal_interactive_green_flag(
    race_id: str,
    current_user: dict = Depends(get_current_user_verified),
):
    """Client calls when formation + countdown finish so lap-1 decision timer starts (sync with canvas)."""
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    if race.get("mode") != "interactive":
        raise HTTPException(status_code=400, detail="Race is not interactive")
    if race.get("state") != "running":
        raise HTTPException(status_code=400, detail="Race is not in progress")

    if int(race.get("current_lap") or 0) != 0:
        race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
        return {"opened": False, "reason": "past_formation", "race": race}
    if race.get("lap_deadline"):
        race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
        return {"opened": False, "reason": "already_armed", "race": race}

    participants = race.get("participants") or []
    entrant_ok = any(
        not p.get("is_npc") and (p.get("user_id") or p.get("id")) == current_user["id"]
        for p in participants
    )
    if not entrant_ok:
        raise HTTPException(status_code=403, detail="You are not a participant in this race")

    opened = await _open_interactive_lap1_decision_window(race_id)
    await _maybe_advance_interactive_lap(race_id)
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    return {"opened": bool(opened), "reason": "armed" if opened else "already_armed", "race": race}


async def advance_race_lap(
    race_id: str,
    current_user: dict = Depends(get_current_user_verified),
):
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    if race.get("mode") != "interactive":
        raise HTTPException(status_code=400, detail="Race is not interactive")
    if race.get("state") != "running":
        raise HTTPException(status_code=400, detail="Race is not in progress")

    await _maybe_auto_green_interactive(race_id)
    await _maybe_advance_interactive_lap(race_id)
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    return {"race": race}


async def get_race_live(
    race_id: str,
    current_user: dict = Depends(get_current_user_verified),
):
    """Poll interactive race state. Any email-verified user may call (entrants and spectators)."""
    race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    if race.get("mode") != "interactive":
        raise HTTPException(status_code=400, detail="Race is not interactive")

    cl_before = int(race.get("current_lap") or 0)
    tl_live = int(race.get("total_laps") or race.get("laps") or 3)
    if race.get("state") == "running":
        await _maybe_auto_green_interactive(race_id)
        await _maybe_advance_interactive_lap(race_id)
        race = await db.racing_races.find_one({"id": race_id}, {"_id": 0})
    cl_after = int((race or {}).get("current_lap") or 0)
    _agent_debug_log(
        "racing.py:get_race_live",
        "H1-H2",
        "live_after_maybe_advance",
        {
            "race_id": race_id,
            "cl_before": cl_before,
            "cl_after": cl_after,
            "delta": cl_after - cl_before,
            "total_laps": tl_live,
            "state": (race or {}).get("state"),
        },
    )

    my_decision = (race.get("decisions") or {}).get(current_user["id"])
    track = _get_track(race.get("track_id") or "")

    return {
        "mode": "interactive",
        "status": race.get("state"),
        "current_lap": race.get("current_lap"),
        "total_laps": race.get("total_laps") or race.get("laps"),
        "lap_deadline": race.get("lap_deadline"),
        "qualifying_order": race.get("qualifying_order") or [],
        "qualifying_results": race.get("qualifying_results") or [],
        "car_states": race.get("car_states"),
        "lap_results": race.get("lap_results"),
        "pit_stops": race.get("pit_stops"),
        "incidents": race.get("incidents"),
        "dnf_ids": race.get("dnf_ids"),
        "race_events": race.get("race_events") or [],
        "gaps_to_ahead": race.get("gaps_to_ahead") or {},
        "safety_car_laps_remaining": race.get("safety_car_laps_remaining") or 0,
        "weather": race.get("weather"),
        "track": track,
        "my_decision": my_decision,
        "participants": race.get("participants"),
        "rewards": race.get("rewards"),
    }


async def get_rnd_tree(current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_racing_profile(current_user["id"])
    researched = set(prof.get("rnd_researched") or [])
    active = prof.get("rnd_active")

    tree = {}
    for path_id, path_def in RND_PATHS.items():
        tiers_out = []
        for tier_def in path_def["tiers"]:
            tier_num = tier_def["tier"]
            prev_tier_done = tier_num == 1
            if tier_num > 1:
                prev_tier = next((t for t in path_def["tiers"] if t["tier"] == tier_num - 1), None)
                if prev_tier:
                    prev_tier_done = any(o["id"] in researched for o in prev_tier["options"])
            same_tier_done = any(o["id"] in researched for o in tier_def["options"])
            options_out = []
            for opt in tier_def["options"]:
                options_out.append({
                    **opt,
                    "researched": opt["id"] in researched,
                    "researching": bool(active and active.get("node_id") == opt["id"]),
                    "available": prev_tier_done and not same_tier_done,
                })
            tiers_out.append({"tier": tier_num, "options": options_out})
        tree[path_id] = {
            "name": path_def["name"],
            "description": path_def["description"],
            "tiers": tiers_out,
        }

    return {
        "tree": tree,
        "active_research": active,
        "researched": list(researched),
    }


async def start_rnd_research(body: RndResearchRequest, current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_racing_profile(current_user["id"])
    _require_racing_team(prof)

    if body.path_id not in RND_PATHS:
        raise HTTPException(status_code=400, detail="Invalid R&D path")
    path_def = RND_PATHS[body.path_id]

    node = None
    node_tier = None
    for tier_def in path_def["tiers"]:
        for opt in tier_def["options"]:
            if opt["id"] == body.node_id:
                node = opt
                node_tier = tier_def["tier"]
                break
        if node:
            break
    if not node:
        raise HTTPException(status_code=400, detail="Unknown R&D node")

    researched = set(prof.get("rnd_researched") or [])

    if node["id"] in researched:
        raise HTTPException(status_code=400, detail="Already researched")

    if prof.get("rnd_active"):
        raise HTTPException(status_code=400, detail="Research already in progress — wait for it to complete")

    same_tier = next((t for t in path_def["tiers"] if t["tier"] == node_tier), None)
    if same_tier and any(o["id"] in researched for o in same_tier["options"]):
        raise HTTPException(status_code=400, detail="Already researched a node in this tier — only 1 choice per tier")

    if node_tier > 1:
        prev_tier = next((t for t in path_def["tiers"] if t["tier"] == node_tier - 1), None)
        if prev_tier and not any(o["id"] in researched for o in prev_tier["options"]):
            raise HTTPException(status_code=400, detail="Must complete previous tier first")

    cost = node["cost"]
    bank = int(prof.get("crew_bank") or 0)
    if bank < cost:
        raise HTTPException(status_code=400, detail=f"Not enough crew bank (need ${cost:,}, have ${bank:,})")

    now = datetime.now(timezone.utc)
    completes_at = now + timedelta(hours=node["research_hours"])
    rnd_active = {
        "node_id": node["id"],
        "path_id": body.path_id,
        "started_at": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "completes_at": completes_at.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }

    await db.racing_profiles.update_one(
        {"user_id": current_user["id"]},
        {"$inc": {"crew_bank": -cost}, "$set": {"rnd_active": rnd_active}},
    )

    return {"ok": True, "rnd_active": rnd_active, "cost": cost}


async def get_rnd_status(current_user: dict = Depends(get_current_user_verified)):
    prof = await _ensure_racing_profile(current_user["id"])
    active = prof.get("rnd_active")

    if active and active.get("completes_at"):
        completes_at = datetime.fromisoformat(active["completes_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) >= completes_at:
            node_id = active["node_id"]
            await db.racing_profiles.update_one(
                {"user_id": current_user["id"]},
                {"$push": {"rnd_researched": node_id}, "$set": {"rnd_active": None}},
            )
            active = None
            prof = await db.racing_profiles.find_one({"user_id": current_user["id"]}, {"_id": 0})

    researched = prof.get("rnd_researched") or []
    bonuses = _get_rnd_bonuses(prof)

    return {
        "active": active,
        "researched": researched,
        "bonuses": bonuses,
    }


async def admin_clear_crew_bank_debt(current_user: dict = Depends(get_current_user_verified)):
    """Admin: set every negative crew_bank to 0 (does not touch positive balances)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    res = await db.racing_profiles.update_many(
        {"crew_bank": {"$lt": 0}},
        [{"$set": {"crew_bank": 0}}],
    )
    return {
        "message": f"Cleared crew bank debt on {res.modified_count} racing profile(s).",
        "modified_count": res.modified_count,
    }


async def admin_wipe_all_teams(current_user: dict = Depends(get_current_user_verified)):
    """Admin tool: wipe ALL racing teams, profiles, cars, upgrades, races, championships, and R&D. Full reset."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")

    del_profiles = await db.racing_profiles.delete_many({})
    del_cars = await db.user_racing_cars.delete_many({})
    del_upgrades = await db.racing_upgrades.delete_many({})
    del_races = await db.racing_races.delete_many({})
    del_bets = await db.racing_bets.delete_many({})
    del_challenges = await db.racing_challenges.delete_many({})
    del_comps = await db.racing_comps.delete_many({})
    del_champs = await db.racing_championships.delete_many({})

    return {
        "message": "All racing data wiped",
        "deleted": {
            "profiles": del_profiles.deleted_count,
            "cars": del_cars.deleted_count,
            "upgrades": del_upgrades.deleted_count,
            "races": del_races.deleted_count,
            "bets": del_bets.deleted_count,
            "challenges": del_challenges.deleted_count,
            "comps": del_comps.deleted_count,
            "championships": del_champs.deleted_count,
        },
    }


def register(router):
    router.add_api_route("/racing/cars", get_racing_cars, methods=["GET"])
    router.add_api_route("/racing/tracks", get_racing_tracks, methods=["GET"])
    router.add_api_route("/racing/profile", get_racing_profile, methods=["GET"])
    router.add_api_route("/racing/profile/select-car", set_selected_car, methods=["POST"])
    router.add_api_route("/racing/team/create", create_racing_team, methods=["POST"])
    router.add_api_route("/racing/crew/upgrade", upgrade_crew, methods=["POST"])
    router.add_api_route("/racing/car/upgrade", upgrade_car_part, methods=["POST"])
    router.add_api_route("/racing/engine/repair", repair_engine, methods=["POST"])
    router.add_api_route("/racing/engine/replace", replace_engine, methods=["POST"])
    router.add_api_route("/racing/tyres/buy", buy_tyres, methods=["POST"])
    router.add_api_route("/racing/races", create_race, methods=["POST"])
    router.add_api_route("/racing/races/open", get_open_races, methods=["GET"])
    router.add_api_route("/racing/races/{race_id}", get_race, methods=["GET"])
    router.add_api_route("/racing/races/{race_id}/join", join_race, methods=["POST"])
    router.add_api_route("/racing/races/{race_id}/start", start_race, methods=["POST"])
    router.add_api_route("/racing/races/{race_id}/complete", complete_race, methods=["POST"])
    router.add_api_route("/racing/races/{race_id}/decision", submit_race_decision, methods=["POST"])
    router.add_api_route("/racing/races/{race_id}/advance-lap", advance_race_lap, methods=["POST"])
    router.add_api_route("/racing/races/{race_id}/green-flag", signal_interactive_green_flag, methods=["POST"])
    router.add_api_route("/racing/races/{race_id}/live", get_race_live, methods=["GET"])
    router.add_api_route("/racing/leaderboard", get_racing_leaderboard, methods=["GET"])
    router.add_api_route("/racing/championship", get_championship, methods=["GET"])
    router.add_api_route("/racing/championship/standings", get_championship_standings, methods=["GET"])
    router.add_api_route("/racing/comps", get_racing_comps, methods=["GET"])
    router.add_api_route("/racing/comps/{comp_id}/enter", enter_racing_comp, methods=["POST"])
    router.add_api_route("/racing/automated/latest", get_latest_automated_race, methods=["GET"])
    router.add_api_route("/racing/bets/place", place_race_bet, methods=["POST"])
    router.add_api_route("/racing/bets", list_race_bets, methods=["GET"])
    router.add_api_route("/racing/races/{race_id}/odds", get_race_bet_odds, methods=["GET"])
    router.add_api_route("/racing/history", get_race_history, methods=["GET"])
    router.add_api_route("/racing/records", get_race_track_records, methods=["GET"])
    router.add_api_route("/racing/season-stats", get_race_season_stats, methods=["GET"])
    router.add_api_route("/racing/challenges", list_race_challenges, methods=["GET"])
    router.add_api_route("/racing/challenges/create", create_race_challenge, methods=["POST"])
    router.add_api_route("/racing/challenges/{challenge_id}/accept", accept_race_challenge, methods=["POST"])
    router.add_api_route("/racing/challenges/{challenge_id}/decline", decline_race_challenge, methods=["POST"])
    router.add_api_route("/racing/drivers/market", get_driver_market, methods=["GET"])
    router.add_api_route("/racing/drivers/hire", hire_driver, methods=["POST"])
    router.add_api_route("/racing/drivers/fire", fire_driver, methods=["POST"])
    router.add_api_route("/racing/drivers/mine", get_my_driver, methods=["GET"])
    router.add_api_route("/racing/rnd/tree", get_rnd_tree, methods=["GET"])
    router.add_api_route("/racing/rnd/research", start_rnd_research, methods=["POST"])
    router.add_api_route("/racing/rnd/status", get_rnd_status, methods=["GET"])
    router.add_api_route("/racing/admin/clear-crew-bank-debt", admin_clear_crew_bank_debt, methods=["POST"])
    router.add_api_route("/racing/admin/wipe-all-teams", admin_wipe_all_teams, methods=["POST"])

    # Cron: automated daily races (same X-Cron-Secret as Auto Rank)
    cron_secret = (os.environ.get("CRON_SECRET") or "").strip()

    async def verify_racing_cron_secret(x_cron_secret: Optional[str] = Header(None, alias="X-Cron-Secret")):
        if not cron_secret:
            return
        if (x_cron_secret or "").strip() != cron_secret:
            raise HTTPException(status_code=403, detail="Invalid cron secret")

    async def cron_automated_races(_: None = Depends(verify_racing_cron_secret)):
        """Cron endpoint: run automated races pass (notify + create morning/evening races). Call every minute when RACING_USE_CRON=1. Header: X-Cron-Secret: <CRON_SECRET>."""
        return await run_racing_automated_races_once()

    router.add_api_route("/racing/cron/automated-races", cron_automated_races, methods=["POST"])
