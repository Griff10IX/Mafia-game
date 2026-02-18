from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Request, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from motor.motor_asyncio import AsyncIOMotorClient
from bson.objectid import ObjectId
import os
import re
import logging
import logging.handlers
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr, field_validator
from typing import List, Optional, Dict, Union
import uuid
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
from jose import JWTError, jwt
import random
import math
import time
from urllib.parse import unquote
import httpx
import certifi

# Import security module (anti-cheat and monitoring)
import security as security_module

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
# Also load project root .env if present (e.g. when running from root)
load_dotenv(ROOT_DIR.parent / '.env')

# MongoDB connection (certifi CA bundle only needed for Atlas SSL, skip for localhost)
mongo_url = os.environ['MONGO_URL']
if 'mongodb+srv' in mongo_url or 'mongodb.net' in mongo_url:
    client = AsyncIOMotorClient(mongo_url, tlsCAFile=certifi.where())
else:
    client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def _get_jwt_secret():
    """Require JWT_SECRET_KEY to be set and not a placeholder. Fail startup otherwise."""
    secret = os.environ.get('JWT_SECRET_KEY', '').strip()
    placeholders = (
        '',
        'your-secret-key-change-in-production',
        'your-secret-key-here',
        'GENERATE_NEW_SECRET_HERE',
    )
    if not secret or secret in placeholders:
        logging.getLogger(__name__).error(
            'JWT_SECRET_KEY must be set in .env to a secure random value. '
            'Do not use the placeholder. Refusing to start.'
        )
        raise SystemExit(1)
    return secret

SECRET_KEY = _get_jwt_secret()
ALGORITHM = "HS256"
# Session length: 1 hour so mobile users stay logged in when returning to the app
ACCESS_TOKEN_EXPIRE_MINUTES = 60

security = HTTPBearer()

# Create the main app without a prefix
app = FastAPI()

# Security monitoring (imported after app creation)
from security import (
    check_request_spam,
    check_duplicate_request,
    check_negative_balance,
    check_impossible_wealth_gain,
    check_failed_attack_spam,
    get_security_summary,
    sanitize_username,
    validate_positive_int,
    send_telegram_alert,
    flush_telegram_alerts,
    flag_user_suspicious,
)


@app.get("/")
def root():
    """Root route so the service URL returns something instead of 404."""
    return {"message": "Mafia API", "docs": "/docs", "api": "/api"}


# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Constants
STATES = ["Chicago", "New York", "Las Vegas", "Atlantic City"]
# Rank is based on rank_points only; 20x harder than original scale. Godfather is the top rank.
RANKS = [
    {"id": 1, "name": "Rat", "required_points": 0},
    {"id": 2, "name": "Street Thug", "required_points": 250},
    {"id": 3, "name": "Hustler", "required_points": 1000},
    {"id": 4, "name": "Goon", "required_points": 3000},
    {"id": 5, "name": "Made Man", "required_points": 6000},
    {"id": 6, "name": "Capo", "required_points": 12000},
    {"id": 7, "name": "Underboss", "required_points": 24000},
    {"id": 8, "name": "Consigliere", "required_points": 50000},
    {"id": 9, "name": "Boss", "required_points": 100000},
    {"id": 10, "name": "Don", "required_points": 200000},
    {"id": 11, "name": "Godfather", "required_points": 400000},
]

# Prestige: 5 levels unlocked after reaching Godfather. Each level harder to rank through.
PRESTIGE_CONFIGS = {
    1: {"threshold_mult": 1.0,  "crime_mult": 1.10, "oc_mult": 1.10, "gta_rare_boost": 0.5,  "npc_mult": 1.10, "name": "Made",             "godfather_req": 400_000},
    2: {"threshold_mult": 1.5,  "crime_mult": 1.20, "oc_mult": 1.20, "gta_rare_boost": 1.0,  "npc_mult": 1.20, "name": "Earner",           "godfather_req": 600_000},
    3: {"threshold_mult": 2.25, "crime_mult": 1.30, "oc_mult": 1.30, "gta_rare_boost": 1.5,  "npc_mult": 1.30, "name": "Capo di Capi",     "godfather_req": 900_000},
    4: {"threshold_mult": 3.5,  "crime_mult": 1.40, "oc_mult": 1.40, "gta_rare_boost": 2.0,  "npc_mult": 1.40, "name": "The Don",          "godfather_req": 1_400_000},
    5: {"threshold_mult": 5.0,  "crime_mult": 1.50, "oc_mult": 1.50, "gta_rare_boost": 2.5,  "npc_mult": 1.50, "name": "Godfather Legacy", "godfather_req": 2_000_000},
}

def get_prestige_bonus(user: dict) -> dict:
    """Return stacking benefit multipliers for a user based on their prestige_level."""
    level = min(int(user.get("prestige_level") or 0), 5)
    if level == 0:
        return {"crime_mult": 1.0, "oc_mult": 1.0, "gta_rare_boost": 0.0, "npc_mult": 1.0}
    cfg = PRESTIGE_CONFIGS[level]
    return {k: cfg[k] for k in ("crime_mult", "oc_mult", "gta_rare_boost", "npc_mult")}

# Wealth ranks: based on cash on hand (ordered by min_money ascending)
WEALTH_RANKS = [
    {"id": 1, "name": "Broke", "min_money": 0},
    {"id": 2, "name": "Bum", "min_money": 1},
    {"id": 3, "name": "Very Poor", "min_money": 50_000},
    {"id": 4, "name": "Poor", "min_money": 200_000},
    {"id": 5, "name": "Rich", "min_money": 500_000},
    {"id": 6, "name": "Millionaire", "min_money": 1_000_000},
    {"id": 7, "name": "Extremely Rich", "min_money": 2_000_000},
    {"id": 8, "name": "Multi Millionaire", "min_money": 10_000_000},
    {"id": 9, "name": "Billionaire", "min_money": 1_000_000_000},
    {"id": 10, "name": "Multi Billionaire", "min_money": 10_000_000_000},
    {"id": 11, "name": "Trillionaire", "min_money": 1_000_000_000_000},
    {"id": 12, "name": "Multi Trillionaire", "min_money": 10_000_000_000_000},
]

# Banking
SWISS_BANK_LIMIT_START = 50_000_000
# Interest bank options (duration_hours -> interest_rate)
# Longer duration = better interest
BANK_INTEREST_OPTIONS = [
    {"hours": 3, "rate": 0.005},    # 0.5%
    {"hours": 6, "rate": 0.012},    # 1.2%
    {"hours": 12, "rate": 0.025},   # 2.5%
    {"hours": 24, "rate": 0.05},    # 5%
    {"hours": 48, "rate": 0.12},    # 12%
    {"hours": 72, "rate": 0.20},    # 20%
]

# Health & armour: health 0-100, armour 0-5. Bullets to kill clamped to [MIN_BULLETS_TO_KILL, MAX_BULLETS_TO_KILL]
DEFAULT_HEALTH = 100
MIN_BULLETS_TO_KILL = 5000
MAX_BULLETS_TO_KILL = 100000
ARMOUR_BASE_BULLETS = {0: 5000, 1: 25000, 2: 45000, 3: 65000, 4: 85000, 5: 100000}  # base before weapon/rank reduction
KILL_CASH_PERCENT = 0.25  # killer gets 25% of victim's cash
DEAD_ALIVE_POINTS_PERCENT = 0.25  # retrieved points from dead account (25%)

# Game-wide daily events (rotate by UTC date). Multipliers default 1.0 when not set.
# racket_cooldown: <1 = faster, >1 = longer; racket_payout: >1 = extra %, <1 = reduced %
# armour_weapon_cost: applies to armour shop and weapon purchases
GAME_EVENTS = [
    {"id": "double_rank", "name": "Double Rank Points", "message": "Double rank points today! Kills and GTA reward 2x rank.", "rank_points": 2.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "double_cash", "name": "Double Cash Rewards", "message": "Double cash rewards today! Kill loot is 2x.", "rank_points": 1.0, "kill_cash": 2.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "gta_double_chance", "name": "2x GTA Success Chance", "message": "2x GTA success chance today! Better odds on heists.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 2.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "bodyguard_half_price", "name": "Bodyguards 50% Off", "message": "Bodyguards 50% off today! Slots, hire, and armour upgrades.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 0.5, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "bodyguard_premium", "name": "Bodyguards 10% More", "message": "Bodyguard services 10% more expensive today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.1, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "racket_extra_payout", "name": "Rackets +10% Payouts", "message": "Family rackets pay 10% more today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.1, "armour_weapon_cost": 1.0},
    {"id": "racket_reduced_payout", "name": "Rackets -10% Payouts", "message": "Family rackets pay 10% less today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 0.9, "armour_weapon_cost": 1.0},
    {"id": "racket_faster_cooldown", "name": "Rackets 50% Faster", "message": "Racket cooldowns are half as long today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 0.5, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "racket_slower_cooldown", "name": "Rackets 50% Longer Cooldown", "message": "Racket cooldowns are 50% longer today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.5, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "racket_bonus_day", "name": "Racket Bonus Day", "message": "Rackets: +10% payouts and 25% faster cooldowns.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 0.75, "racket_payout": 1.1, "armour_weapon_cost": 1.0},
    {"id": "armour_weapon_half_price", "name": "Armour & Weapons 50% Off", "message": "Armour and weapons 50% off today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 0.5},
    {"id": "armour_weapon_premium", "name": "Armour & Weapons 10% More", "message": "Armour and weapons 10% more expensive today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.1},
]
NO_EVENT = {"id": "none", "name": "No event", "message": "", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0}

MULTIPLIER_KEYS = ["rank_points", "kill_cash", "gta_success", "bodyguard_cost", "racket_cooldown", "racket_payout", "armour_weapon_cost"]

def get_active_game_event():
    """Current game-wide event for today (UTC). Returns dict with id, name, message, and multiplier keys."""
    today = datetime.now(timezone.utc).date()
    epoch = datetime(2025, 1, 1, tzinfo=timezone.utc).date()
    days = (today - epoch).days
    idx = days % len(GAME_EVENTS)
    return GAME_EVENTS[idx].copy()

def get_combined_event():
    """Combine all GAME_EVENTS multipliers (product) for testing. Returns single event dict."""
    combined = {"id": "all_testing", "name": "All events (testing)", "message": "All event multipliers active for testing."}
    for key in MULTIPLIER_KEYS:
        prod = 1.0
        for ev in GAME_EVENTS:
            prod *= ev.get(key, 1.0)
        combined[key] = prod
    return combined

async def get_events_enabled() -> bool:
    """Whether daily game events are enabled (admin can disable). Default True if not set."""
    doc = await db.game_config.find_one({"id": "main"}, {"_id": 0, "events_enabled": 1})
    if doc is None:
        return True  # no doc = enabled; admin toggle will create doc
    return bool(doc.get("events_enabled", True))

async def get_all_events_for_testing() -> bool:
    """Whether all events are combined for testing (admin). Default False."""
    doc = await db.game_config.find_one({"id": "main"}, {"_id": 0, "all_events_for_testing": 1})
    return bool(doc.get("all_events_for_testing", False))

async def get_effective_event():
    """Current event multipliers if events enabled, else NO_EVENT. When all_events_for_testing, returns combined event. Never raises."""
    try:
        if not await get_events_enabled():
            return NO_EVENT.copy()
        if await get_all_events_for_testing():
            return get_combined_event()
        return get_active_game_event()
    except Exception:
        return NO_EVENT.copy()

# Armoury/weapons: production cost is paid to produce; sell price = production_cost * ARMOUR_WEAPON_MARGIN (35% profit)
ARMOUR_WEAPON_MARGIN = 1.35  # sell at 1.35× production cost → 35% profit per item

# Armour shop (5 tiers): first 3 cash, top 2 points (cost_* = production cost; players pay cost * ARMOUR_WEAPON_MARGIN)
ARMOUR_SETS = [
    {
        "level": 1,
        "name": "Padded Wool Overcoat",
        "description": "A heavy overcoat with extra padding — basic protection for street work.",
        "cost_money": 10000,
        "cost_points": None,
    },
    {
        "level": 2,
        "name": "Reinforced Leather Trench",
        "description": "Thick leather and stitched liners — tougher than it looks in a back alley.",
        "cost_money": 50000,
        "cost_points": None,
    },
    {
        "level": 3,
        "name": "Ballistic Silk Vest",
        "description": "Period-style silk vest used by some in the 1920s — rare and expensive.",
        "cost_money": 200000,
        "cost_points": None,
    },
    {
        "level": 4,
        "name": "Steel Plate Vest",
        "description": "Metal plates under clothing — heavy, but it can save your life.",
        "cost_money": None,
        "cost_points": 50,
    },
    {
        "level": 5,
        "name": "Custom Armored Suit",
        "description": "A bespoke armored setup for bosses — maximum protection.",
        "cost_money": None,
        "cost_points": 150,
    },
]

# Garage melt/scrap batch limits (upgradeable via Store)
DEFAULT_GARAGE_BATCH_LIMIT = 6
GARAGE_BATCH_UPGRADE_INCREMENT = 10
GARAGE_BATCH_UPGRADE_COST = 25
GARAGE_BATCH_LIMIT_MAX = 100

POINT_PACKAGES = {
    "starter": {"points": 100, "price": 4.99},
    "bronze": {"points": 250, "price": 9.99},
    "silver": {"points": 600, "price": 19.99},
    "gold": {"points": 1500, "price": 49.99},
    "platinum": {"points": 3500, "price": 99.99}
}

# Travel times based on car rarity (in seconds)
TRAVEL_TIMES = {
    "exclusive": 7,
    "legendary": 12,
    "ultra_rare": 18,
    "rare": 25,
    "uncommon": 35,
    "common": 45,
    "custom": 20,  # Custom car from points
    "airport": 0   # Airport (instant)
}

CARS = [
    # Common (difficulty 1) - 6 cars (images from public/images/gta/)
    {"id": "car1", "name": "Model T Ford", "rarity": "common", "min_difficulty": 1, "value": 500, "travel_bonus": 0, "image": "/images/gta/car1.jpg"},
    {"id": "car2", "name": "Chevrolet Series AB", "rarity": "common", "min_difficulty": 1, "value": 600, "travel_bonus": 5, "image": "/images/gta/car2.jpg"},
    {"id": "car3", "name": "Dodge Brothers", "rarity": "common", "min_difficulty": 1, "value": 700, "travel_bonus": 5, "image": "/images/gta/car3.jpg"},
    {"id": "car4", "name": "Ford Model A", "rarity": "common", "min_difficulty": 1, "value": 650, "travel_bonus": 5, "image": "/images/gta/car4.jpg"},
    {"id": "car5", "name": "Essex Coach", "rarity": "common", "min_difficulty": 1, "value": 550, "travel_bonus": 0, "image": "/images/gta/car5.jpg"},
    {"id": "car6", "name": "Durant Star", "rarity": "common", "min_difficulty": 1, "value": 600, "travel_bonus": 5, "image": "/images/gta/car6.jpg"},
    # Uncommon (difficulty 2) - 4 cars
    {"id": "car7", "name": "Oakland", "rarity": "uncommon", "min_difficulty": 2, "value": 1200, "travel_bonus": 10, "image": "/images/gta/car7.jpg"},
    {"id": "car8", "name": "Willys-Knight", "rarity": "uncommon", "min_difficulty": 2, "value": 1500, "travel_bonus": 10, "image": "/images/gta/car8.jpg"},
    {"id": "car9", "name": "Cadillac V-8", "rarity": "uncommon", "min_difficulty": 2, "value": 2000, "travel_bonus": 15, "image": "/images/gta/car9.jpg"},
    {"id": "car10", "name": "Buick Master Six", "rarity": "uncommon", "min_difficulty": 2, "value": 1800, "travel_bonus": 12, "image": "/images/gta/car10.jpg"},
    # Rare (difficulty 3) - 4 cars
    {"id": "car11", "name": "Packard Eight", "rarity": "rare", "min_difficulty": 3, "value": 3500, "travel_bonus": 20, "image": "/images/gta/car11.jpg"},
    {"id": "car12", "name": "Lincoln Model L", "rarity": "rare", "min_difficulty": 3, "value": 4000, "travel_bonus": 20, "image": "/images/gta/car12.jpg"},
    {"id": "car13", "name": "Pierce-Arrow", "rarity": "rare", "min_difficulty": 3, "value": 5000, "travel_bonus": 25, "image": "/images/gta/car13.jpg"},
    {"id": "car14", "name": "Stutz Bearcat", "rarity": "rare", "min_difficulty": 3, "value": 5500, "travel_bonus": 25, "image": "/images/gta/car14.jpg"},
    # Ultra Rare (difficulty 4) - 3 cars
    {"id": "car15", "name": "Duesenberg Model J", "rarity": "ultra_rare", "min_difficulty": 4, "value": 10000, "travel_bonus": 35, "image": "/images/gta/car15.jpeg"},
    {"id": "car16", "name": "Cord L-29", "rarity": "ultra_rare", "min_difficulty": 4, "value": 12000, "travel_bonus": 35, "image": "/images/gta/car16.jpg"},
    {"id": "car17", "name": "Auburn Speedster", "rarity": "ultra_rare", "min_difficulty": 4, "value": 15000, "travel_bonus": 40, "image": "/images/gta/car17.jpg"},
    # Legendary (difficulty 5) - 2 cars
    {"id": "car18", "name": "Bugatti Type 41 Royale", "rarity": "legendary", "min_difficulty": 5, "value": 25000, "travel_bonus": 50, "image": "/images/gta/car18.jpg"},
    {"id": "car19", "name": "Rolls-Royce Phantom II", "rarity": "legendary", "min_difficulty": 5, "value": 30000, "travel_bonus": 55, "image": "/images/gta/car19.jpg"},
    # Custom (store only) - just below exclusive
    {"id": "car_custom", "name": "Custom Car", "rarity": "custom", "min_difficulty": 5, "value": 40000, "travel_bonus": 55, "image": None},
    # Exclusive (admin only) - no custom image
    {"id": "car20", "name": "Al Capone's Armored Cadillac", "rarity": "exclusive", "min_difficulty": 5, "value": 50000, "travel_bonus": 60, "image": "/images/gta/car20.png"}
]

# Models (UserRegister, UserLogin, PasswordResetRequest, PasswordResetConfirm moved to routers/auth.py)
class UserResponse(BaseModel):
    id: str
    email: str
    username: str
    rank: int
    rank_name: str
    wealth_rank: int = 1
    wealth_rank_name: str = "Broke"
    wealth_rank_range: str = "$0"
    money: float
    points: int
    rank_points: int
    bodyguard_slots: int
    bullets: int
    health: int
    armour_level: int
    current_state: str
    total_kills: int
    total_deaths: int
    in_jail: bool
    jail_until: Optional[str]
    premium_rank_bar: bool
    has_silencer: bool = False
    custom_car_name: Optional[str]
    travels_this_hour: int
    extra_airmiles: int
    garage_batch_limit: int
    total_crimes: int
    crime_profit: int
    created_at: str
    swiss_balance: int = 0
    swiss_limit: int = SWISS_BANK_LIMIT_START
    oc_timer_reduced: bool = False
    crew_oc_timer_reduced: bool = False
    admin_ghost_mode: bool = False
    admin_acting_as_normal: bool = False
    casino_profit: int = 0  # $ from owned casino table
    property_profit: int = 0  # points from owned property (e.g. airport)
    has_casino_or_property: bool = False  # true if user owns a casino or property (airport, bullet factory, armory) — for menu visibility
    theme_preferences: Optional[Dict] = None  # saved theme (colour, font, etc.) for cross-device sync

class NotificationCreate(BaseModel):
    title: str
    message: str
    notification_type: str  # rank_up, reward, bodyguard, attack, system

class DeadAliveRetrieveRequest(BaseModel):
    dead_username: str
    dead_password: str

class AvatarUpdateRequest(BaseModel):
    avatar_data: str  # data URL: data:image/...;base64,...

class ThemePreferencesRequest(BaseModel):
    """Theme preferences (all optional). Omitted keys are left unchanged; send full object to replace."""
    colour_id: Optional[str] = None
    texture_id: Optional[str] = None
    button_colour_id: Optional[str] = None
    accent_line_colour_id: Optional[str] = None
    font_id: Optional[str] = None
    button_style_id: Optional[str] = None
    writing_colour_id: Optional[str] = None
    muted_writing_colour_id: Optional[str] = None
    toast_text_colour_id: Optional[str] = None
    text_style_id: Optional[str] = None
    custom_themes: Optional[List[Dict]] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

class HitlistAttemptNpcRequest(BaseModel):
    hitlist_id: str
    bullets_to_use: int


# EventsToggleRequest, AllEventsForTestingRequest -> routers/admin.py
# CheckoutRequest -> routers/payments.py

class CustomCarImageUpdate(BaseModel):
    image_url: Optional[str] = None  # URL for picture; empty or null to clear


class OnlineUsersResponse(BaseModel):
    total_online: int
    users: List[Dict]
    admin_online_color: Optional[str] = None

# Helper functions
def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    
    if user.get("is_dead"):
        raise HTTPException(
            status_code=403,
            detail="This account is dead and cannot be used. Create a new account and use Dead > Alive to retrieve points."
        )
    # If car travel has arrived, apply location and clear traveling state
    arrives_at = user.get("travel_arrives_at")
    if arrives_at:
        try:
            arrives_dt = datetime.fromisoformat(arrives_at.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) >= arrives_dt:
                destination = user.get("traveling_to")
                if destination:
                    await db.users.update_one(
                        {"id": user_id},
                        {"$set": {"current_state": destination}, "$unset": {"traveling_to": "", "travel_arrives_at": ""}}
                    )
                    user = await db.users.find_one({"id": user_id}, {"_id": 0})
        except Exception:
            pass
    return user

async def send_notification(user_id: str, title: str, message: str, notification_type: str, category: Optional[str] = None, **extra):
    """Send a notification to user's inbox. If category is set, user's notification_preferences can mute it."""
    if category:
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "notification_preferences": 1})
        prefs = (user or {}).get("notification_preferences") or {}
        if prefs.get(category) is False:
            return None
    notification = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "title": title,
        "message": message,
        "notification_type": notification_type,
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **extra,
    }
    await db.notifications.insert_one(notification)
    return notification


async def send_notification_to_family(family_id: str, title: str, message: str, notification_type: str, category: Optional[str] = None):
    """Notify every member of a family."""
    members = await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(100)
    for m in members:
        await send_notification(m["user_id"], title, message, notification_type, category=category, **{})


async def send_notification_to_all(title: str, message: str, notification_type: str = "system", category: Optional[str] = None):
    """Notify all users (e.g. new E-Games available). Respects each user's notification_preferences when category is set."""
    user_ids = await db.users.distinct("id")
    for uid in user_ids:
        await send_notification(uid, title, message, notification_type, category=category)


async def _family_war_start(family_a_id: str, family_b_id: str):
    """Start or ensure an active war between two families. Idempotent."""
    if not family_a_id or not family_b_id or family_a_id == family_b_id:
        return
    existing = await db.family_wars.find_one({
        "$or": [
            {"family_a_id": family_a_id, "family_b_id": family_b_id},
            {"family_a_id": family_b_id, "family_b_id": family_a_id},
        ],
        "status": {"$in": ["active", "truce_offered"]},
    })
    if existing:
        return
    fa = await db.families.find_one({"id": family_a_id}, {"_id": 0, "name": 1, "tag": 1})
    fb = await db.families.find_one({"id": family_b_id}, {"_id": 0, "name": 1, "tag": 1})
    family_a_name = (fa or {}).get("name") or (fa or {}).get("tag") or family_a_id
    family_b_name = (fb or {}).get("name") or (fb or {}).get("tag") or family_b_id
    now = datetime.now(timezone.utc).isoformat()
    await db.family_wars.insert_one({
        "id": str(uuid.uuid4()),
        "family_a_id": family_a_id,
        "family_b_id": family_b_id,
        "family_a_name": family_a_name,
        "family_b_name": family_b_name,
        "status": "active",
        "created_at": now,
        "ended_at": None,
    })
    await send_notification_to_family(
        family_a_id,
        "⚠️ Family War",
        "Your family is now at war. The war ends when one side has no living members or a truce is agreed.",
        "system",
    )
    await send_notification_to_family(
        family_b_id,
        "⚠️ Family War",
        "Your family is now at war. The war ends when one side has no living members or a truce is agreed.",
        "system",
    )


async def _family_war_check_wipe_and_award(victim_family_id: str):
    """If victim's family has no living members, end the war and award the winner."""
    if not victim_family_id:
        return
    war = await db.family_wars.find_one(
        {"$or": [{"family_a_id": victim_family_id}, {"family_b_id": victim_family_id}]},
        {"_id": 0},
    )
    if not war or war.get("status") not in ["active", "truce_offered"]:
        return
    members = await db.family_members.find({"family_id": victim_family_id}, {"_id": 0, "user_id": 1}).to_list(100)
    alive = 0
    for m in members:
        # Include 'id' in projection to ensure we get a non-empty dict when user exists
        u = await db.users.find_one({"id": m["user_id"]}, {"_id": 0, "id": 1, "is_dead": 1})
        if u and u.get("id") and not u.get("is_dead"):
            alive += 1
    if alive > 0:
        return
    winner_id = war["family_b_id"] if war["family_a_id"] == victim_family_id else war["family_a_id"]
    loser_id = victim_family_id
    now = datetime.now(timezone.utc).isoformat()
    loser_family = await db.families.find_one({"id": loser_id}, {"_id": 0, "name": 1, "tag": 1})
    winner_family = await db.families.find_one({"id": winner_id}, {"_id": 0, "name": 1, "tag": 1})
    winner_family_name = (winner_family or {}).get("name") or (winner_family or {}).get("tag") or winner_id
    loser_family_name = (loser_family or {}).get("name") or (loser_family or {}).get("tag") or loser_id
    if not winner_family:
        await db.family_wars.update_one(
            {"id": war["id"]},
            {"$set": {"status": "family_a_wins" if winner_id == war["family_a_id"] else "family_b_wins", "ended_at": now, "winner_family_id": winner_id, "loser_family_id": loser_id, "winner_family_name": winner_family_name, "loser_family_name": loser_family_name}},
        )
        return
    winner_boss_id = winner_family.get("boss_id")
    loser_rackets = (loser_family or {}).get("rackets") or {}
    winner_rackets = (winner_family.get("rackets") or {}).copy()
    prize_rackets = []
    for racket_id, state in loser_rackets.items():
        w_level = (winner_rackets.get(racket_id) or {}).get("level", 0)
        l_level = state.get("level", 0)
        if l_level > w_level:
            winner_rackets[racket_id] = {"level": l_level, "last_collected_at": state.get("last_collected_at")}
            racket_def = next((r for r in FAMILY_RACKETS if r["id"] == racket_id), None)
            prize_rackets.append({"racket_id": racket_id, "name": racket_def["name"] if racket_def else racket_id, "level": l_level})
    await db.families.update_one({"id": winner_id}, {"$set": {"rackets": winner_rackets}})
    loser_member_ids = [m["user_id"] for m in members]
    exclusive_cars = await db.user_cars.find({"user_id": {"$in": loser_member_ids}}).to_list(500)
    for uc in exclusive_cars:
        car_info = next((c for c in CARS if c.get("id") == uc.get("car_id")), None)
        if car_info and car_info.get("rarity") == "exclusive":
            # New id so old view-car link is dead; new owner keeps it private until listed or shown on profile
            await db.user_cars.update_one(
                {"_id": uc["_id"]},
                {
                    "$set": {"user_id": winner_boss_id, "id": str(uuid.uuid4())},
                    "$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""},
                },
            )
    prize_count = sum(1 for uc in exclusive_cars if next((c for c in CARS if c.get("id") == uc.get("car_id")), {}).get("rarity") == "exclusive")
    await db.family_wars.update_one(
        {"id": war["id"]},
        {"$set": {
            "status": "family_a_wins" if winner_id == war["family_a_id"] else "family_b_wins",
            "ended_at": now,
            "winner_family_id": winner_id,
            "loser_family_id": loser_id,
            "winner_family_name": winner_family_name,
            "loser_family_name": loser_family_name,
            "prize_exclusive_cars": prize_count,
            "prize_rackets": prize_rackets,
        }},
    )
    await send_notification_to_family(
        winner_id,
        "🏆 War Won",
        f"Your family won the war. You took the enemy's rackets and {prize_count} exclusive car(s) as prize.",
        "reward",
    )


async def _family_in_active_war(family_id: str) -> bool:
    """True if this family is in an active war (not ended by wipeout or truce)."""
    if not family_id:
        return False
    w = await db.family_wars.find_one(
        {"$or": [{"family_a_id": family_id}, {"family_b_id": family_id}], "status": {"$in": ["active", "truce_offered"]}},
        {"_id": 1},
    )
    return w is not None


async def _get_active_war_between(family_a_id: str, family_b_id: str):
    """Return the active/truce_offered war doc between two families, or None."""
    if not family_a_id or not family_b_id or family_a_id == family_b_id:
        return None
    return await db.family_wars.find_one(
        {"$or": [{"family_a_id": family_a_id, "family_b_id": family_b_id}, {"family_a_id": family_b_id, "family_b_id": family_a_id}], "status": {"$in": ["active", "truce_offered"]}},
        {"_id": 0},
    )


async def _get_active_war_for_family(family_id: str):
    """Return the active/truce_offered war doc that this family is in, or None."""
    if not family_id:
        return None
    return await db.family_wars.find_one(
        {"$or": [{"family_a_id": family_id}, {"family_b_id": family_id}], "status": {"$in": ["active", "truce_offered"]}},
        {"_id": 0},
    )


async def _record_war_stats_bodyguard_kill(war_id: str, attacker_id: str, attacker_family_id: str, target_id: str, target_family_id: str):
    """Record one bodyguard kill for this war: attacker +1 bodyguard_kills, target +1 bodyguards_lost."""
    if not war_id:
        return
    await db.family_war_stats.update_one(
        {"war_id": war_id, "user_id": attacker_id},
        {"$inc": {"bodyguard_kills": 1}, "$set": {"family_id": attacker_family_id or None}, "$setOnInsert": {"war_id": war_id, "user_id": attacker_id, "kills": 0, "deaths": 0, "bodyguards_lost": 0}},
        upsert=True,
    )
    await db.family_war_stats.update_one(
        {"war_id": war_id, "user_id": target_id},
        {"$inc": {"bodyguards_lost": 1}, "$set": {"family_id": target_family_id or None}, "$setOnInsert": {"war_id": war_id, "user_id": target_id, "kills": 0, "deaths": 0, "bodyguard_kills": 0}},
        upsert=True,
    )


async def _record_war_stats_player_kill(war_id: str, killer_id: str, killer_family_id: str, victim_id: str, victim_family_id: str):
    """Record one player kill for this war: killer +1 kills, victim +1 deaths."""
    if not war_id:
        return
    await db.family_war_stats.update_one(
        {"war_id": war_id, "user_id": killer_id},
        {"$inc": {"kills": 1}, "$set": {"family_id": killer_family_id or None}, "$setOnInsert": {"war_id": war_id, "user_id": killer_id, "bodyguard_kills": 0, "deaths": 0, "bodyguards_lost": 0}},
        upsert=True,
    )
    await db.family_war_stats.update_one(
        {"war_id": war_id, "user_id": victim_id},
        {"$inc": {"deaths": 1}, "$set": {"family_id": victim_family_id or None}, "$setOnInsert": {"war_id": war_id, "user_id": victim_id, "bodyguard_kills": 0, "kills": 0, "bodyguards_lost": 0}},
        upsert=True,
    )

def get_rank_info(rank_points: int, prestige_mult: float = 1.0):
    """Get rank based on rank_points, optionally scaled by prestige multiplier."""
    effective = int(rank_points / prestige_mult) if prestige_mult > 1.0 else rank_points
    for i in range(len(RANKS) - 1, -1, -1):
        if effective >= RANKS[i]["required_points"]:
            return RANKS[i]["id"], RANKS[i]["name"]
    return 1, RANKS[0]["name"]


def get_wealth_rank(money: int | float) -> tuple[int, str]:
    """Get wealth rank (1920s–1930s style) based on cash on hand. Returns (id, name)."""
    m = int(money) if money is not None else 0
    for i in range(len(WEALTH_RANKS) - 1, -1, -1):
        if m >= WEALTH_RANKS[i]["min_money"]:
            return WEALTH_RANKS[i]["id"], WEALTH_RANKS[i]["name"]
    return WEALTH_RANKS[0]["id"], WEALTH_RANKS[0]["name"]


def get_wealth_rank_range(money: int | float) -> str:
    """Return the wealth tier range string for tooltips, e.g. '$0', '$1 – $49,999', '$10,000,000,000,000+'."""
    m = int(money) if money is not None else 0
    for i in range(len(WEALTH_RANKS) - 1, -1, -1):
        if m >= WEALTH_RANKS[i]["min_money"]:
            min_m = WEALTH_RANKS[i]["min_money"]
            if i + 1 < len(WEALTH_RANKS):
                max_m = WEALTH_RANKS[i + 1]["min_money"] - 1
                if min_m >= max_m:
                    return f"${min_m:,}"
                return f"${min_m:,} – ${max_m:,}"
            return f"${min_m:,}+"
    return "$0"

# Bullet reward per rank up (flat 5000 bullets each time you rank up)
RANK_UP_BULLET_REWARD = 5000

async def check_and_process_rank_up(user_id: str, old_rank: int, new_rank: int, username: str = ""):
    """Process rank up: give bullets, send inbox notification."""
    if new_rank > old_rank:
        total_bullets = RANK_UP_BULLET_REWARD * (new_rank - old_rank)
        
        if total_bullets > 0:
            await db.users.update_one(
                {"id": user_id},
                {"$inc": {"bullets": total_bullets}}
            )
        
        # Get new rank name
        new_rank_name = RANKS[new_rank - 1]["name"] if new_rank <= len(RANKS) else "Unknown"
        
        # Send notification
        await send_notification(
            user_id,
            f"🎉 Ranked Up to {new_rank_name}!",
            f"Congratulations! You've reached {new_rank_name} (Rank {new_rank}). You've been rewarded with {total_bullets} bullets!",
            "rank_up",
            category="system",
        )
        
        return total_bullets
    return 0


async def maybe_process_rank_up(user_id: str, rank_points_before: int, rank_points_added: int, username: str = "", prestige_mult: float = 1.0):
    """If rank increased after adding rank_points_added to rank_points_before, grant rewards and send notification."""
    if rank_points_added <= 0:
        return
    new_total = rank_points_before + rank_points_added
    old_rank_id, _ = get_rank_info(rank_points_before, prestige_mult)
    new_rank_id, _ = get_rank_info(new_total, prestige_mult)
    if new_rank_id > old_rank_id:
        await check_and_process_rank_up(user_id, old_rank_id, new_rank_id, username)


# Auth and profile endpoints -> routers/auth.py, routers/profile.py
# Dead-alive, users/online -> routers/dead_alive.py, routers/users.py

# Stats endpoints -> routers/stats.py

ADMIN_EMAILS = ["admin@mafia.com", "boss@mafia.com", "jakeg_lfc2016@icloud.com"]


async def log_activity(user_id: str, username: str, action: str, details: dict):
    """Append to activity_log for admin monitoring (crimes, forum, etc.)."""
    try:
        await db.activity_log.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "username": username,
            "action": action,
            "details": details,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass


async def log_gambling(user_id: str, username: str, game_type: str, details: dict):
    """Append to gambling_log for admin anti-cheat monitoring."""
    try:
        await db.gambling_log.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "username": username,
            "game_type": game_type,
            "details": details,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass


def _is_admin(user: dict) -> bool:
    """True if user has admin email and is not currently acting as normal user."""
    return (user.get("email") or "") in ADMIN_EMAILS and not user.get("admin_acting_as_normal", False)

# Admin endpoints -> routers/admin.py

# Username lookup helpers
# NOTE: All username lookups should be case-insensitive to prevent issues with
# login, transfers, attacks, and other username-based operations.
# Use _username_pattern() for all username queries to ensure consistency.
def _find_user_by_username_case_insensitive(username_raw: str):
    """Return a find_one filter for users by username (case-insensitive match)."""
    raw = (username_raw or "").strip()
    if not raw:
        return None
    pattern = re.compile("^" + re.escape(raw) + "$", re.IGNORECASE)
    return {"username": pattern}

def _username_pattern(username: str):
    """
    Create case-insensitive regex pattern for username lookups.
    Use this for all username-based queries to ensure case-insensitive matching.
    """
    if not username:
        return None
    return re.compile("^" + re.escape(username.strip()) + "$", re.IGNORECASE)


async def _apply_kill_inflation_decay(user_id: str) -> float:
    """
    Inflation system:
    - Each kill increases inflation by ~2–4% (handled elsewhere).
    - If no kills happen, inflation decays by ~2–6% per hour.
    - No upper limit.
    """
    now = datetime.now(timezone.utc)
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "kill_inflation": 1, "kill_inflation_updated_at": 1})
    if not user:
        return 0.0

    inflation = float(user.get("kill_inflation", 0.0) or 0.0)
    updated_at_iso = user.get("kill_inflation_updated_at")
    if not updated_at_iso:
        await db.users.update_one({"id": user_id}, {"$set": {"kill_inflation_updated_at": now.isoformat()}})
        return inflation

    try:
        updated_at = datetime.fromisoformat(updated_at_iso)
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
    except Exception:
        await db.users.update_one({"id": user_id}, {"$set": {"kill_inflation_updated_at": now.isoformat()}})
        return inflation

    hours = int((now - updated_at).total_seconds() // 3600)
    if hours <= 0 or inflation <= 0:
        return inflation

    new_inflation = inflation
    for _ in range(hours):
        new_inflation = max(0.0, new_inflation - random.uniform(0.02, 0.06))

    if abs(new_inflation - inflation) > 1e-9:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"kill_inflation": new_inflation, "kill_inflation_updated_at": (updated_at + timedelta(hours=hours)).isoformat()}}
        )
    return new_inflation

async def _increase_kill_inflation_on_kill(user_id: str) -> float:
    """Increase inflation by 2–4% on a successful kill."""
    now = datetime.now(timezone.utc)
    inc = random.uniform(0.02, 0.04)
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "kill_inflation": 1})
    cur = float(user.get("kill_inflation", 0.0) or 0.0) if user else 0.0
    new = cur + inc
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"kill_inflation": new, "kill_inflation_updated_at": now.isoformat()}}
    )
    return new


# Payment endpoints -> routers/payments.py
# Giphy -> routers/giphy.py
# My-properties -> routers/properties.py

# ============ My Properties (1 casino + 1 property max) ============
async def _get_casino_property_profit(user_id: str):
    """Return (casino_profit_cash, property_profit_points, has_casino, has_property) for header display and menu visibility."""
    casino_cash = 0
    has_casino = False
    for _game_type, coll in [
        ("dice", db.dice_ownership),
        ("roulette", db.roulette_ownership),
        ("blackjack", db.blackjack_ownership),
        ("horseracing", db.horseracing_ownership),
        ("videopoker", db.videopoker_ownership),
    ]:
        doc = await coll.find_one({"owner_id": user_id}, {"_id": 0, "total_earnings": 1, "profit": 1})
        if doc:
            casino_cash = int(doc.get("total_earnings") or doc.get("profit") or 0)
            has_casino = True
            break
    prop = await _user_owns_any_property(user_id)
    property_pts = int(prop.get("total_earnings") or 0) if prop else 0
    has_property = prop is not None
    return (casino_cash, property_pts, has_casino, has_property)


async def _user_owns_any_casino(user_id: str):
    """Return first casino owned by user: {type, city, max_bet, buy_back_reward?, profit?} or None. Rule: 1 casino only. profit is $ (total_earnings or profit field)."""
    for game_type, coll in [
        ("dice", db.dice_ownership),
        ("roulette", db.roulette_ownership),
        ("blackjack", db.blackjack_ownership),
        ("horseracing", db.horseracing_ownership),
        ("videopoker", db.videopoker_ownership),
    ]:
        doc = await coll.find_one({"owner_id": user_id}, {"_id": 0, "city": 1, "max_bet": 1, "buy_back_reward": 1, "total_earnings": 1, "profit": 1})
        if doc:
            out = {"type": game_type, "city": doc.get("city"), "max_bet": doc.get("max_bet")}
            if doc.get("buy_back_reward") is not None:
                out["buy_back_reward"] = doc.get("buy_back_reward")
            profit_val = doc.get("total_earnings") if doc.get("total_earnings") is not None else doc.get("profit")
            out["profit"] = int(profit_val or 0)
            return out
    return None


from routers.dice import DICE_MAX_BET, DiceSellOnTradeRequest  # used by CASINO_GAMES and roulette/blackjack/horseracing sell-on-trade
from routers.roulette import ROULETTE_MAX_BET, RouletteClaimRequest, RouletteSetMaxBetRequest, RouletteSendToUserRequest  # CASINO_GAMES, blackjack/horseracing reuse these models
from routers.blackjack import BLACKJACK_MAX_BET  # CASINO_GAMES
from routers.horseracing import HORSERACING_MAX_BET  # CASINO_GAMES
from routers.slots import SLOTS_MAX_BET  # CASINO_GAMES
from routers.video_poker import VIDEO_POKER_MAX_BET  # CASINO_GAMES


async def _user_owns_any_property(user_id: str):
    """Return first property owned by user: {type, state, ...} or None. Rule: 1 property only (airport, bullet_factory, or armory). Add armory when armory.js/ownership exists."""
    doc = await db.airport_ownership.find_one({"owner_id": user_id}, {"_id": 0, "state": 1, "slot": 1, "price_per_travel": 1, "total_earnings": 1})
    if doc:
        return {"type": "airport", "state": doc.get("state"), "slot": doc.get("slot", 1), "price_per_travel": doc.get("price_per_travel"), "total_earnings": doc.get("total_earnings", 0)}
    doc = await db.bullet_factory.find_one({"owner_id": user_id}, {"_id": 0, "state": 1, "price_per_bullet": 1})
    if doc:
        return {"type": "bullet_factory", "state": doc.get("state"), "price_per_bullet": doc.get("price_per_bullet")}
    # TODO: when armory ownership exists, check db.armory_ownership (or similar) and return {"type": "armory", "state": ...}
    return None


# Crime endpoints -> see routers/crimes.py
# Register modular routers (crimes, gta, jail, attack, etc.)
from routers import crimes, gta, jail, oc, organised_crime, forum, entertainer, bullet_factory, objectives, attack, bank, families, weapons, bodyguards, airport, quicktrade, booze_run, dice, roulette, blackjack, horseracing, slots, video_poker, notifications, hitlist, properties, store, racket, leaderboard, armour, meta, user_progress, states, events, security_admin, sports_betting, auth, profile, admin, payments, stats, dead_alive, users, giphy, crack_safe, prestige
from routers.objectives import update_objectives_progress  # re-export for server.py callers (e.g. booze sell)
from routers.families import FAMILY_RACKETS  # used by _family_war_check_wipe_and_award and seed
from routers.bodyguards import _create_robot_bodyguard_user  # used by seed
from routers.booze_run import get_booze_rotation_interval_seconds, get_booze_rotation_index  # flash news
CASINO_GAMES = [
    {"id": "blackjack", "name": "Blackjack", "max_bet": BLACKJACK_MAX_BET},
    {"id": "horseracing", "name": "Horse Racing", "max_bet": HORSERACING_MAX_BET},
    {"id": "roulette", "name": "Roulette", "max_bet": ROULETTE_MAX_BET},
    {"id": "dice", "name": "Dice", "max_bet": DICE_MAX_BET},
    {"id": "slots", "name": "Slots", "max_bet": SLOTS_MAX_BET},
    {"id": "videopoker", "name": "Video Poker", "max_bet": VIDEO_POKER_MAX_BET},
]
crimes.register(api_router)
gta.register(api_router)
jail.register(api_router)
organised_crime.register(api_router)
oc.register(api_router)
forum.register(api_router)
entertainer.register(api_router)
bullet_factory.register(api_router)
objectives.register(api_router)
attack.register(api_router)
bank.register(api_router)
families.register(api_router)
weapons.register(api_router)
bodyguards.register(api_router)
airport.register(api_router)
quicktrade.register(api_router)
booze_run.register(api_router)
dice.register(api_router)
roulette.register(api_router)
blackjack.register(api_router)
horseracing.register(api_router)
slots.register(api_router)
video_poker.register(api_router)
notifications.register(api_router)
hitlist.register(api_router)
properties.register(api_router)
store.register(api_router)
racket.register(api_router)
leaderboard.register(api_router)
armour.register(api_router)
meta.register(api_router)
user_progress.register(api_router)
states.register(api_router)
events.register(api_router)
security_admin.register(api_router)
sports_betting.register(api_router)
auth.register(api_router)
profile.register(api_router)
admin.register(api_router)
payments.register(api_router)
stats.register(api_router)
dead_alive.register(api_router)
users.register(api_router)
giphy.register(api_router)
crack_safe.register(api_router)
prestige.register(api_router)
from routers import auto_rank as auto_rank_router
auto_rank_router.register(api_router)

app.include_router(api_router)

# CORS: with credentials=True you must list explicit origins (not "*").
# Set CORS_ORIGINS on Render to your Vercel URL, e.g. https://your-app.vercel.app
_cors_origins = [o.strip() for o in os.environ.get('CORS_ORIGINS', '*').split(',') if o.strip()]
_allow_credentials = bool(_cors_origins) and '*' not in _cors_origins
if not _cors_origins:
    _cors_origins = ['*']

class OPTIONSResponder(BaseHTTPMiddleware):
    """Ensure OPTIONS (CORS preflight) always returns 200 so login from Vercel works."""
    async def dispatch(self, request, call_next):
        if request.method == "OPTIONS":
            origin = request.headers.get("origin", "*")
            allow_origin = origin if (_allow_credentials and origin in _cors_origins) else (_cors_origins[0] if _cors_origins and _cors_origins != ['*'] else "*")
            headers = {
                "Access-Control-Allow-Origin": allow_origin,
                "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Origin",
                "Access-Control-Max-Age": "86400",
            }
            if _allow_credentials:
                headers["Access-Control-Allow-Credentials"] = "true"
            return Response(status_code=200, headers=headers)
        return await call_next(request)

# Import security middleware
try:
    from security_middleware import SecurityMiddleware
    app.add_middleware(SecurityMiddleware, db=db)
except ImportError:
    print("Warning: security_middleware.py not found - rate limiting disabled")

app.add_middleware(OPTIONSResponder)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=_allow_credentials,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Configure logging
# Configure logging with both file and console output
log_dir = ROOT_DIR / 'logs'
log_dir.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        # Console output
        logging.StreamHandler(),
        # File output (creates new file daily, keeps last 30 days)
        logging.handlers.TimedRotatingFileHandler(
            log_dir / 'server.log',
            when='midnight',
            interval=1,
            backupCount=30,
            encoding='utf-8'
        )
    ]
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_db():
    await init_game_data()
    from routers.profile import ensure_profile_indexes
    from ensure_indexes import ensure_all_indexes
    await ensure_profile_indexes(db)
    await ensure_all_indexes(db)
    from routers.jail import spawn_jail_npcs
    asyncio.create_task(spawn_jail_npcs())
    # Start security monitoring background task
    asyncio.create_task(security_module.security_monitor_task(db))

    async def entertainer_auto_create_cycle():
        # Run once shortly after startup so "Last run" isn't stuck on a pre-restart value
        await asyncio.sleep(30)
        try:
            await entertainer.run_auto_create_if_enabled()
        except Exception as e:
            logging.exception("Entertainer auto-create (startup): %s", e)
        # Then every 3 hours: wait 2h40m, roll open games, wait 20m, create next batch
        three_h = 3 * 3600
        twenty_min = 20 * 60
        while True:
            await asyncio.sleep(three_h - twenty_min)  # 2h 40m until roll time
            try:
                await entertainer.settle_open_games_now()
            except Exception as e:
                logging.exception("Entertainer settle open games: %s", e)
            await asyncio.sleep(twenty_min)  # 20 mins, then new batch
            try:
                await entertainer.run_auto_create_if_enabled()
            except Exception as e:
                logging.exception("Entertainer auto-create: %s", e)
    asyncio.create_task(entertainer_auto_create_cycle())
    # Auto Rank: auto-commit crimes + GTA for users who bought it; send results to Telegram
    from routers import auto_rank
    asyncio.create_task(auto_rank.run_auto_rank_loop())
    asyncio.create_task(auto_rank.run_bust_5sec_loop())
    asyncio.create_task(auto_rank.run_auto_rank_oc_loop())
    from routers import gta as gta_router
    asyncio.create_task(gta_router.run_dealer_replenish_loop())

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

async def init_game_data():
    """
    Initialize game data on server startup.
    NOTE: Be VERY careful with delete operations in this function as it runs on EVERY server restart!
    """
    from routers import crimes as crimes_router
    await crimes_router.init_crimes_data(db)

    logging.info("🔄 Initializing game data (weapons, properties...)...")
    weapons_count = await db.weapons.count_documents({})
    if weapons_count == 0:
        weapons = [
            {"id": "weapon1", "name": "Brass Knuckles", "description": "Street fighting tool", "damage": 5, "bullets_needed": 0, "rank_required": 1, "price_money": 100, "price_points": None},
            {"id": "weapon2", "name": "Colt Detective Special", "description": "Compact revolver", "damage": 15, "bullets_needed": 6, "rank_required": 2, "price_money": 500, "price_points": None},
            {"id": "weapon3", "name": "Smith & Wesson .38", "description": "Reliable revolver", "damage": 20, "bullets_needed": 6, "rank_required": 3, "price_money": 1000, "price_points": None},
            {"id": "weapon4", "name": "Colt M1911", "description": "Powerful semi-automatic pistol", "damage": 30, "bullets_needed": 7, "rank_required": 4, "price_money": 2500, "price_points": None},
            {"id": "weapon5", "name": "Sawed-off Shotgun", "description": "Devastating at close range", "damage": 50, "bullets_needed": 2, "rank_required": 5, "price_money": 5000, "price_points": None},
            {"id": "weapon6", "name": "Winchester Model 1897", "description": "Pump-action shotgun", "damage": 60, "bullets_needed": 5, "rank_required": 6, "price_money": 8000, "price_points": None},
            {"id": "weapon7", "name": "Thompson Submachine Gun", "description": "The iconic Tommy Gun", "damage": 80, "bullets_needed": 30, "rank_required": 7, "price_money": 15000, "price_points": None},
            {"id": "weapon8", "name": "BAR (Browning Automatic Rifle)", "description": "Heavy automatic rifle", "damage": 100, "bullets_needed": 20, "rank_required": 9, "price_money": 30000, "price_points": None},
            {"id": "weapon9", "name": "Luger P08", "description": "German precision pistol", "damage": 35, "bullets_needed": 8, "rank_required": 8, "price_money": 12000, "price_points": None},
            {"id": "weapon10", "name": "Chicago Typewriter Premium", "description": "Gold-plated Tommy Gun", "damage": 120, "bullets_needed": 50, "rank_required": 11, "price_money": None, "price_points": 500}
        ]
        await db.weapons.insert_many(weapons)
    
    properties_count = await db.properties.count_documents({})
    if properties_count == 0:
        # ECONOMY REBALANCE: Reduced income_per_hour by ~60% for healthier economy
        # PROGRESSION: Each property requires previous one to be maxed out (required_property_id)
        properties = [
            {"id": "prop1", "name": "Speakeasy", "property_type": "casino", "price": 5000, "income_per_hour": 50, "max_level": 10, "required_property_id": None},
            {"id": "prop2", "name": "Bullet Factory", "property_type": "factory", "price": 25000, "income_per_hour": 150, "max_level": 10, "required_property_id": "prop1"},
            {"id": "prop3", "name": "Underground Casino", "property_type": "casino", "price": 75000, "income_per_hour": 400, "max_level": 10, "required_property_id": "prop2"},
            {"id": "prop4", "name": "Luxury Casino", "property_type": "casino", "price": 250000, "income_per_hour": 1200, "max_level": 10, "required_property_id": "prop3"}
        ]
        await db.properties.insert_many(properties)
    
    logging.info("✅ Game data initialization complete (NO user data was modified)")
