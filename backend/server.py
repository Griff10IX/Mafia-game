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
SECRET_KEY = os.environ.get('JWT_SECRET_KEY', 'your-secret-key-change-in-production')
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

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

# Armour shop (5 tiers): first 3 cash, top 2 points
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

# Models
class UserRegister(BaseModel):
    email: EmailStr
    username: str
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class PasswordResetRequest(BaseModel):
    email: EmailStr

class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str

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

class SportsBetPlaceRequest(BaseModel):
    event_id: str
    option_id: str
    stake: int


class SportsBetCancelRequest(BaseModel):
    bet_id: str


class HitlistAttemptNpcRequest(BaseModel):
    hitlist_id: str
    bullets_to_use: int


class EventsToggleRequest(BaseModel):
    enabled: bool

class AllEventsForTestingRequest(BaseModel):
    enabled: bool

class CheckoutRequest(BaseModel):
    package_id: str
    origin_url: str

class CustomCarImageUpdate(BaseModel):
    image_url: Optional[str] = None  # URL for picture; empty or null to clear


class OnlineUsersResponse(BaseModel):
    total_online: int
    users: List[Dict]

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
    exclusive_cars = await db.user_cars.find({"user_id": {"$in": loser_member_ids}}, {"_id": 0}).to_list(500)
    for uc in exclusive_cars:
        car_info = next((c for c in CARS if c.get("id") == uc.get("car_id")), None)
        if car_info and car_info.get("rarity") == "exclusive":
            await db.user_cars.update_one(
                {"id": uc.get("id")},
                {"$set": {"user_id": winner_boss_id}},
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
        {"$setOnInsert": {"war_id": war_id, "user_id": attacker_id, "family_id": attacker_family_id or None, "bodyguard_kills": 0, "bodyguards_lost": 0, "kills": 0, "deaths": 0}, "$inc": {"bodyguard_kills": 1}},
        upsert=True,
    )
    await db.family_war_stats.update_one(
        {"war_id": war_id, "user_id": target_id},
        {"$setOnInsert": {"war_id": war_id, "user_id": target_id, "family_id": target_family_id or None, "bodyguard_kills": 0, "bodyguards_lost": 0, "kills": 0, "deaths": 0}, "$inc": {"bodyguards_lost": 1}},
        upsert=True,
    )


async def _record_war_stats_player_kill(war_id: str, killer_id: str, killer_family_id: str, victim_id: str, victim_family_id: str):
    """Record one player kill for this war: killer +1 kills, victim +1 deaths."""
    if not war_id:
        return
    await db.family_war_stats.update_one(
        {"war_id": war_id, "user_id": killer_id},
        {"$setOnInsert": {"war_id": war_id, "user_id": killer_id, "family_id": killer_family_id or None, "bodyguard_kills": 0, "bodyguards_lost": 0, "kills": 0, "deaths": 0}, "$inc": {"kills": 1}},
        upsert=True,
    )
    await db.family_war_stats.update_one(
        {"war_id": war_id, "user_id": victim_id},
        {"$setOnInsert": {"war_id": war_id, "user_id": victim_id, "family_id": victim_family_id or None, "bodyguard_kills": 0, "bodyguards_lost": 0, "kills": 0, "deaths": 0}, "$inc": {"deaths": 1}},
        upsert=True,
    )

def get_rank_info(rank_points: int):
    """Get rank based on rank_points only"""
    for i in range(len(RANKS) - 1, -1, -1):
        if rank_points >= RANKS[i]["required_points"]:
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


async def maybe_process_rank_up(user_id: str, rank_points_before: int, rank_points_added: int, username: str = ""):
    """If rank increased after adding rank_points_added to rank_points_before, grant rewards and send notification."""
    if rank_points_added <= 0:
        return
    new_total = rank_points_before + rank_points_added
    old_rank_id, _ = get_rank_info(rank_points_before)
    new_rank_id, _ = get_rank_info(new_total)
    if new_rank_id > old_rank_id:
        await check_and_process_rank_up(user_id, old_rank_id, new_rank_id, username)


def _client_ip(request: Request) -> str:
    """Get client IP (supports X-Forwarded-For behind proxy)."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host or ""
    return ""


# Auth endpoints
@api_router.post("/auth/register")
async def register(user_data: UserRegister, request: Request):
    try:
        # Case-insensitive checks for existing email/username
        email_pattern = re.compile("^" + re.escape(user_data.email.strip()) + "$", re.IGNORECASE)
        username_pattern = re.compile("^" + re.escape(user_data.username.strip()) + "$", re.IGNORECASE)
        existing = await db.users.find_one({"$or": [{"email": email_pattern}, {"username": username_pattern}]}, {"_id": 0})
        if existing:
            if existing.get("is_dead"):
                # Dead account — free up the email/username so they can re-register
                await db.users.update_one(
                    {"id": existing["id"]},
                    {"$set": {
                        "email": f"dead_{existing['id']}@deleted",
                        "username": f"dead_{existing['id'][:8]}",
                    }}
                )
            else:
                raise HTTPException(status_code=400, detail="Email or username already registered")
        
        user_id = str(uuid.uuid4())
        user_doc = {
            "id": user_id,
            "email": str(user_data.email.strip().lower()),  # Store email in lowercase
            "username": str(user_data.username.strip()),  # Preserve username case
            "password_hash": get_password_hash(user_data.password),
            "rank": 1,
            "money": 1000.0,
            "points": 0,
            "rank_points": 0,
            "bodyguard_slots": 0,
            "bullets": 0,
            "avatar_url": None,
            "jail_busts": 0,
            "jail_bust_attempts": 0,
            "garage_batch_limit": DEFAULT_GARAGE_BATCH_LIMIT,
            "total_crimes": 0,
            "crime_profit": 0,
            "total_gta": 0,
            "total_oc_heists": 0,
            "oc_timer_reduced": False,
            "current_state": "Chicago",
            "swiss_balance": 0,
            "swiss_limit": SWISS_BANK_LIMIT_START,
            "total_kills": 0,
            "total_deaths": 0,
            "in_jail": False,
            "jail_until": None,
            "premium_rank_bar": False,
            "has_silencer": False,
            "custom_car_name": None,
            "travels_this_hour": 0,
            "travel_reset_time": datetime.now(timezone.utc).isoformat(),
            "extra_airmiles": 0,
            "health": DEFAULT_HEALTH,
            "armour_level": 0,
            "armour_owned_level_max": 0,
            "equipped_weapon_id": None,
            "kill_inflation": 0.0,  # +% bullets required (e.g. 0.10 = +10%)
            "kill_inflation_updated_at": datetime.now(timezone.utc).isoformat(),
            "is_dead": False,
            "dead_at": None,
            "points_at_death": None,
            "retrieval_used": False,
            "last_seen": datetime.now(timezone.utc).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "registration_ip": _client_ip(request),
            "login_ips": [_client_ip(request)] if _client_ip(request) else [],
        }
        
        # Insert the user document
        result = await db.users.insert_one(user_doc.copy())
        
        # Create token
        token = create_access_token({"sub": user_id})
        
        # Return response without ObjectId - create clean dict
        user_response = {
            "id": user_doc["id"],
            "email": user_doc["email"],
            "username": user_doc["username"],
            "rank": user_doc["rank"],
            "money": user_doc["money"],
            "points": user_doc["points"],
            "bodyguard_slots": user_doc["bodyguard_slots"],
            "current_state": user_doc["current_state"],
            "total_kills": user_doc["total_kills"],
            "total_deaths": user_doc["total_deaths"],
            "created_at": user_doc["created_at"]
        }
        
        return {"token": token, "user": user_response}
    except Exception as e:
        logging.error(f"Registration error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")

@api_router.post("/auth/login")
async def login(user_data: UserLogin, request: Request):
    # Case-insensitive email lookup
    email_pattern = re.compile("^" + re.escape(user_data.email.strip()) + "$", re.IGNORECASE)
    user = await db.users.find_one({"email": email_pattern}, {"_id": 0})
    if not user or not verify_password(user_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("is_dead"):
        raise HTTPException(
            status_code=403,
            detail="This account is dead and cannot be used. Create a new account. You may retrieve a portion of your points via Dead > Alive."
        )
    # Track login IP for cheat detection
    ip = _client_ip(request)
    if ip:
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"last_login_ip": ip}, "$addToSet": {"login_ips": ip}},
        )
        doc = await db.users.find_one({"id": user["id"]}, {"_id": 0, "login_ips": 1})
        ips = doc.get("login_ips") or []
        if len(ips) > 20:
            await db.users.update_one({"id": user["id"]}, {"$set": {"login_ips": ips[-20:]}})
    token = create_access_token({"sub": user["id"]})
    return {"token": token, "user": {k: v for k, v in user.items() if k not in ("password_hash", "is_dead", "dead_at", "points_at_death", "retrieval_used")}}

@api_router.post("/auth/password-reset/request")
async def request_password_reset(data: PasswordResetRequest):
    """
    Request a password reset. Generates a token that expires in 1 hour.
    NOTE: In production, this should send an email with the reset link.
    For now, it returns the token in the response for testing.
    """
    # Case-insensitive email lookup
    email_pattern = re.compile("^" + re.escape(data.email.strip()) + "$", re.IGNORECASE)
    user = await db.users.find_one({"email": email_pattern}, {"_id": 0, "id": 1, "email": 1, "username": 1})
    
    # Always return success even if email not found (security best practice)
    if not user:
        return {
            "message": "If an account exists with that email, a password reset link has been sent.",
            "token": None  # Don't reveal that user doesn't exist
        }
    
    # Generate secure reset token
    reset_token = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    
    # Store reset token in database
    await db.password_resets.insert_one({
        "token": reset_token,
        "user_id": user["id"],
        "email": user["email"],
        "username": user["username"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": expires_at.isoformat(),
        "used": False
    })
    
    # TODO: Send email with reset link
    # For now, return the token in the response (remove this in production)
    return {
        "message": "If an account exists with that email, a password reset link has been sent.",
        "token": reset_token,  # REMOVE THIS IN PRODUCTION - only for testing
        "expires_in_minutes": 60
    }

@api_router.post("/auth/password-reset/confirm")
async def confirm_password_reset(data: PasswordResetConfirm):
    """Reset password using a valid reset token."""
    # Find the reset token
    reset_record = await db.password_resets.find_one({"token": data.token}, {"_id": 0})
    
    if not reset_record:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    
    if reset_record.get("used"):
        raise HTTPException(status_code=400, detail="This reset token has already been used")
    
    # Check if token is expired
    expires_at = datetime.fromisoformat(reset_record["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=400, detail="Reset token has expired")
    
    # Validate new password
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    
    # Update user's password
    new_password_hash = get_password_hash(data.new_password)
    await db.users.update_one(
        {"id": reset_record["user_id"]},
        {"$set": {"password_hash": new_password_hash}}
    )
    
    # Mark token as used
    await db.password_resets.update_one(
        {"token": data.token},
        {"$set": {"used": True, "used_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"message": "Password has been reset successfully. You can now login with your new password."}

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    # Update last_seen
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"last_seen": datetime.now(timezone.utc).isoformat()}}
    )
    
    rank_id, rank_name = get_rank_info(current_user.get("rank_points", 0))
    if current_user.get("email") in ADMIN_EMAILS:
        rank_name = "Admin"
    wealth_id, wealth_name = get_wealth_rank(current_user.get("money", 0))
    wealth_range = get_wealth_rank_range(current_user.get("money", 0))
    casino_cash, property_pts, has_casino, has_property = await _get_casino_property_profit(current_user["id"])
    return UserResponse(
        id=current_user["id"],
        email=current_user["email"],
        username=current_user["username"],
        rank=rank_id,
        rank_name=rank_name,
        wealth_rank=wealth_id,
        wealth_rank_name=wealth_name,
        wealth_rank_range=wealth_range,
        money=current_user["money"],
        points=current_user["points"],
        rank_points=current_user.get("rank_points", 0),
        bodyguard_slots=current_user["bodyguard_slots"],
        bullets=current_user.get("bullets", 0),
        health=current_user.get("health", DEFAULT_HEALTH),
        armour_level=current_user.get("armour_level", 0),
        current_state=current_user["current_state"],
        total_kills=current_user["total_kills"],
        total_deaths=current_user["total_deaths"],
        in_jail=current_user.get("in_jail", False),
        jail_until=current_user.get("jail_until"),
        premium_rank_bar=current_user.get("premium_rank_bar", False),
        has_silencer=current_user.get("has_silencer", False),
        custom_car_name=current_user.get("custom_car_name"),
        travels_this_hour=current_user.get("travels_this_hour", 0),
        extra_airmiles=current_user.get("extra_airmiles", 0),
        garage_batch_limit=current_user.get("garage_batch_limit", DEFAULT_GARAGE_BATCH_LIMIT),
        total_crimes=current_user.get("total_crimes", 0),
        crime_profit=int(current_user.get("crime_profit", 0) or 0),
        created_at=current_user["created_at"],
        swiss_balance=int(current_user.get("swiss_balance", 0) or 0),
        swiss_limit=int(current_user.get("swiss_limit", SWISS_BANK_LIMIT_START) or SWISS_BANK_LIMIT_START),
        oc_timer_reduced=bool(current_user.get("oc_timer_reduced", False)),
        crew_oc_timer_reduced=bool(current_user.get("crew_oc_timer_reduced", False)),
        admin_ghost_mode=bool(current_user.get("admin_ghost_mode", False)),
        admin_acting_as_normal=bool(current_user.get("admin_acting_as_normal", False)),
        casino_profit=casino_cash,
        property_profit=property_pts,
        has_casino_or_property=has_casino or has_property,
        theme_preferences=current_user.get("theme_preferences"),
    )

@api_router.get("/users/{username}/profile")
async def get_user_profile(username: str, current_user: dict = Depends(get_current_user)):
    """View a user's profile (requires auth)."""
    username_pattern = _username_pattern(username)
    user = await db.users.find_one({"username": username_pattern}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    rank_id, rank_name = get_rank_info(user.get("rank_points", 0))
    if user.get("email") in ADMIN_EMAILS:
        rank_name = "Admin"
    wealth_id, wealth_name = get_wealth_rank(user.get("money", 0))
    is_dead = bool(user.get("is_dead"))
    online = False
    last_seen = user.get("last_seen")
    if (not is_dead) and last_seen:
        try:
            ls = datetime.fromisoformat(last_seen)
            if ls.tzinfo is None:
                ls = ls.replace(tzinfo=timezone.utc)
            online = ls >= (datetime.now(timezone.utc) - timedelta(minutes=5))
        except Exception:
            online = False
    if (not is_dead) and (not online):
        forced_until = user.get("forced_online_until")
        if forced_until:
            try:
                fu = datetime.fromisoformat(forced_until)
                if fu.tzinfo is None:
                    fu = fu.replace(tzinfo=timezone.utc)
                online = datetime.now(timezone.utc) < fu
            except Exception:
                pass
    if user.get("email") in ADMIN_EMAILS and user.get("admin_ghost_mode"):
        online = False
    wealth_range = get_wealth_rank_range(user.get("money", 0))
    user_id = user["id"]

    # Family name (Crew)
    family_name = None
    if user.get("family_id"):
        fam = await db.families.find_one({"id": user["family_id"]}, {"_id": 0, "name": 1})
        if fam:
            family_name = fam.get("name")

    # Honours: leaderboard rankings for this user (rank in each stat)
    async def _rank_for_field(field: str, value: int) -> int:
        if value is None:
            value = 0
        n_better = await db.users.count_documents({
            "is_dead": {"$ne": True},
            "is_bodyguard": {"$ne": True},
            field: {"$gt": value},
        })
        return n_better + 1

    kills_rank = await _rank_for_field("total_kills", int(user.get("total_kills") or 0))
    crimes_rank = await _rank_for_field("total_crimes", int(user.get("total_crimes") or 0))
    gta_rank = await _rank_for_field("total_gta", int(user.get("total_gta") or 0))
    jail_rank = await _rank_for_field("jail_busts", int(user.get("jail_busts") or 0))
    rank_points_rank = await _rank_for_field("rank_points", int(user.get("rank_points") or 0))
    honours = [
        {"rank": rank_points_rank, "label": "Most Rank Points Earned"},
        {"rank": kills_rank, "label": "Most Kills"},
        {"rank": crimes_rank, "label": "Most Crimes Committed"},
        {"rank": gta_rank, "label": "Most GTAs Committed"},
        {"rank": jail_rank, "label": "Most Jail Busts"},
    ]

    # Casinos owned by this user: dice, roulette, blackjack, horseracing (city, max_bet, buy_back_reward where applicable)
    owned_casinos = []
    for game_type, coll in [
        ("dice", db.dice_ownership),
        ("roulette", db.roulette_ownership),
        ("blackjack", db.blackjack_ownership),
        ("horseracing", db.horseracing_ownership),
    ]:
        cursor = coll.find(
            {"owner_id": user_id},
            {"_id": 0, "city": 1, "max_bet": 1, "buy_back_reward": 1},
        )
        async for d in cursor:
            item = {"type": game_type, "city": d.get("city", "?"), "max_bet": int(d.get("max_bet") or 0)}
            if d.get("buy_back_reward") is not None:
                item["buy_back_reward"] = int(d.get("buy_back_reward") or 0)
            owned_casinos.append(item)

    # Property (airport or bullet factory; max one per user)
    property_ = await _user_owns_any_property(user_id)
    if property_ and user_id != current_user.get("id") and property_.get("type") == "airport":
        property_ = {k: v for k, v in property_.items() if k != "total_earnings"}

    # Inbox: received = notifications for this user (we don't track sent per user)
    messages_received = await db.notifications.count_documents({"user_id": user_id})
    messages_sent = 0

    out = {
        "id": user_id,
        "username": user["username"],
        "rank": rank_id,
        "rank_name": rank_name,
        "wealth_rank": wealth_id,
        "wealth_rank_name": wealth_name,
        "wealth_rank_range": wealth_range,
        "kills": user.get("total_kills", 0),
        "jail_busts": user.get("jail_busts", 0),
        "created_at": user.get("created_at"),
        "avatar_url": user.get("avatar_url"),
        "is_dead": is_dead,
        "is_npc": bool(user.get("is_npc")),
        "is_bodyguard": bool(user.get("is_bodyguard")),
        "online": online,
        "last_seen": last_seen,
        "family_name": family_name,
        "honours": honours,
        "owned_casinos": owned_casinos,
        "property": property_,
        "messages_sent": messages_sent,
        "messages_received": messages_received,
    }
    if current_user.get("email") in ADMIN_EMAILS:
        today_utc = datetime.now(timezone.utc).date().isoformat()
        booze_today = user.get("booze_profit_today", 0) if user.get("booze_profit_today_date") == today_utc else 0
        out["admin_stats"] = {
            "money": int(user.get("money") or 0),
            "points": int(user.get("points") or 0),
            "bullets": int(user.get("bullets") or 0),
            "booze_profit_today": booze_today,
            "booze_profit_total": int(user.get("booze_profit_total") or 0),
            "rank_points": int(user.get("rank_points") or 0),
            "current_state": user.get("current_state") or "—",
            "in_jail": bool(user.get("in_jail")),
        }
    return out

@api_router.post("/profile/avatar")
async def update_avatar(request: AvatarUpdateRequest, current_user: dict = Depends(get_current_user)):
    """Update your avatar (stored as a data URL)."""
    avatar = (request.avatar_data or "").strip()
    if not avatar.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="Avatar must be an image data URL (data:image/...)")
    if len(avatar) > 250_000:
        raise HTTPException(status_code=400, detail="Avatar too large. Use a smaller image.")

    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"avatar_url": avatar}}
    )
    return {"message": "Avatar updated"}

@api_router.get("/profile/theme")
async def get_profile_theme(current_user: dict = Depends(get_current_user)):
    """Get current user's theme preferences (for cross-device sync). Returns defaults if never set."""
    prefs = current_user.get("theme_preferences") or {}
    return {"theme_preferences": prefs}


@api_router.patch("/profile/theme")
async def update_profile_theme(request: ThemePreferencesRequest, current_user: dict = Depends(get_current_user)):
    """Save theme preferences to DB so they sync across devices. Only provided keys are updated. Null = clear (e.g. reset to default)."""
    updates = request.model_dump(exclude_unset=True)  # include None so reset can clear button/accent
    if not updates:
        return {"message": "No theme updates", "theme_preferences": current_user.get("theme_preferences") or {}}
    key_map = {
        "colour_id": "colourId",
        "texture_id": "textureId",
        "button_colour_id": "buttonColourId",
        "accent_line_colour_id": "accentLineColourId",
        "font_id": "fontId",
        "button_style_id": "buttonStyleId",
        "writing_colour_id": "writingColourId",
        "muted_writing_colour_id": "mutedWritingColourId",
        "toast_text_colour_id": "toastTextColourId",
        "text_style_id": "textStyleId",
        "custom_themes": "customThemes",
    }
    stored = {key_map.get(k, k): v for k, v in updates.items()}
    new_prefs = {**(current_user.get("theme_preferences") or {}), **stored}
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"theme_preferences": new_prefs}},
    )
    return {"message": "Theme saved", "theme_preferences": new_prefs}


@api_router.post("/profile/change-password")
async def change_password(request: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    """Change password for the logged-in user. Requires current password."""
    if len(request.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "password_hash": 1})
    if not user or not verify_password(request.current_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"password_hash": get_password_hash(request.new_password)}}
    )
    return {"message": "Password changed successfully"}

@api_router.post("/dead-alive/retrieve")
async def dead_alive_retrieve(request: DeadAliveRetrieveRequest, current_user: dict = Depends(get_current_user)):
    """Retrieve a % of points from a dead account into your current account. One-time per dead account."""
    # Case-insensitive username lookup
    username_pattern = _username_pattern(request.dead_username)
    dead_user = await db.users.find_one({"username": username_pattern}, {"_id": 0})
    if not dead_user:
        raise HTTPException(status_code=404, detail="No account found with that username")
    if not dead_user.get("is_dead"):
        raise HTTPException(status_code=400, detail="That account is not dead. Only dead accounts can be retrieved.")
    if dead_user.get("retrieval_used"):
        raise HTTPException(status_code=400, detail="Points from that dead account have already been retrieved.")
    if not verify_password(request.dead_password, dead_user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid password for that account")
    points_at_death = dead_user.get("points_at_death", 0)
    if points_at_death <= 0:
        raise HTTPException(status_code=400, detail="That account had no points to retrieve")
    retrieved = int(points_at_death * DEAD_ALIVE_POINTS_PERCENT)
    retrieved = max(1, retrieved)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": retrieved}}
    )
    await db.users.update_one(
        {"id": dead_user["id"]},
        {"$set": {"retrieval_used": True}}
    )
    return {
        "message": f"Retrieved {retrieved} points from your dead account ({dead_user['username']}). One-time retrieval complete.",
        "points_retrieved": retrieved
    }

# Online Users endpoint
@api_router.get("/users/online", response_model=OnlineUsersResponse)
async def get_online_users(current_user: dict = Depends(get_current_user)):
    # Users online in last 5 minutes OR forced-online window (exclude dead accounts)
    now = datetime.now(timezone.utc)
    five_min_ago = now - timedelta(minutes=5)
    users = await db.users.find(
        {
            "is_dead": {"$ne": True},
            "is_bodyguard": {"$ne": True},
            "$or": [
                {"last_seen": {"$gte": five_min_ago.isoformat()}},
                {"forced_online_until": {"$gt": now.isoformat()}},
            ],
        },
        {"_id": 0, "password_hash": 0}
    ).to_list(100)
    
    users_data = []
    for user in users:
        if user.get("email") in ADMIN_EMAILS and user.get("admin_ghost_mode"):
            continue
        rank_id, rank_name = get_rank_info(user.get("rank_points", 0))
        if user.get("email") in ADMIN_EMAILS:
            rank_name = "Admin"
        users_data.append({
            "username": user["username"],
            "rank": rank_id,
            "rank_name": rank_name,
            "location": user["current_state"],
            "in_jail": user.get("in_jail", False)
        })
    
    return OnlineUsersResponse(total_online=len(users_data), users=users_data)

# Stats endpoints
@api_router.get("/stats/overview")
async def get_stats_overview(
    users_only_kills: bool = True,
    current_user: dict = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)

    total_users = await db.users.count_documents({})
    alive_users = await db.users.count_documents({"is_dead": {"$ne": True}})
    dead_users = max(0, total_users - alive_users)

    # Totals across all users (includes dead accounts for historical totals)
    totals = await db.users.aggregate([
        {
            "$group": {
                "_id": None,
                "money_total": {"$sum": {"$ifNull": ["$money", 0]}},
                "points_total": {"$sum": {"$ifNull": ["$points", 0]}},
                "swiss_total": {"$sum": {"$ifNull": ["$swiss_balance", 0]}},
                "total_crimes": {"$sum": {"$ifNull": ["$total_crimes", 0]}},
                "total_gta": {"$sum": {"$ifNull": ["$total_gta", 0]}},
                "total_jail_busts": {"$sum": {"$ifNull": ["$jail_busts", 0]}},
            }
        }
    ]).to_list(1)
    totals_doc = totals[0] if totals else {}

    # Interest bank: total principal + interest in unclaimed deposits
    interest_agg = await db.bank_deposits.aggregate([
        {"$match": {"claimed_at": None}},
        {"$group": {"_id": None, "total": {"$sum": {"$add": [{"$ifNull": ["$principal", 0]}, {"$ifNull": ["$interest_amount", 0]}]}}}}
    ]).to_list(1)
    interest_bank_total = int(interest_agg[0].get("total", 0) or 0) if interest_agg else 0

    # Vehicle stats
    total_vehicles = await db.user_cars.count_documents({})
    car_counts = await db.user_cars.aggregate([
        {"$group": {"_id": "$car_id", "count": {"$sum": 1}}}
    ]).to_list(100)
    car_by_id = {c.get("id"): c for c in CARS}
    exclusive_vehicles = 0
    rare_vehicles = 0
    for cc in car_counts:
        car_id = cc.get("_id")
        cnt = int(cc.get("count", 0) or 0)
        info = car_by_id.get(car_id) or {}
        rarity = info.get("rarity")
        if rarity == "exclusive":
            exclusive_vehicles += cnt
        if rarity in ("rare", "ultra_rare", "legendary", "exclusive"):
            rare_vehicles += cnt

    # Rank breakdown (alive/dead) using current rank_points (fast enough for typical sizes)
    rank_stats_map: dict[int, dict] = {}
    rank_meta = [(r["id"], r["name"]) for r in RANKS]
    for rid, rname in rank_meta:
        rank_stats_map[int(rid)] = {"rank_id": int(rid), "rank_name": rname, "alive": 0, "dead": 0}

    users_for_rank = await db.users.find(
        {},
        {"_id": 0, "rank_points": 1, "is_dead": 1}
    ).to_list(50000)
    for u in users_for_rank:
        rid, _ = get_rank_info(int(u.get("rank_points", 0) or 0))
        bucket = rank_stats_map.get(int(rid))
        if not bucket:
            continue
        if u.get("is_dead"):
            bucket["dead"] += 1
        else:
            bucket["alive"] += 1

    rank_stats = [rank_stats_map[r["id"]] for r in RANKS]

    # Recent kills (show ALL kills), but only show the killer's name when it was marked public.
    attempts = await db.attack_attempts.find(
        {"outcome": "killed"},
        {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    recent_kills = []
    for a in attempts:
        killer = await db.users.find_one(
            {"id": a.get("attacker_id")},
            {"_id": 0, "is_npc": 1, "rank_points": 1, "username": 1}
        )
        victim = await db.users.find_one(
            {"id": a.get("target_id")},
            {"_id": 0, "is_npc": 1, "rank_points": 1}
        )

        if users_only_kills and (bool(killer and killer.get("is_npc")) or bool(victim and victim.get("is_npc"))):
            continue

        # Prefer rank stored on the attempt record (stable even if user doc changes)
        victim_rank_name = None
        tr_id = a.get("target_rank_id")
        if tr_id is not None:
            try:
                tr_id_int = int(tr_id)
                victim_rank_name = next((r.get("name") for r in RANKS if int(r.get("id", 0) or 0) == tr_id_int), None)
            except Exception:
                victim_rank_name = None
        if victim_rank_name is None and victim:
            _, victim_rank_name = get_rank_info(int(victim.get("rank_points", 0) or 0))

        is_public = bool(a.get("make_public"))
        killer_username = a.get("attacker_username") if is_public else None
        victim_username = a.get("target_username")
        if not victim_username:
            continue

        recent_kills.append({
            "id": a.get("id") or a.get("attack_id") or str(uuid.uuid4()),
            "victim_username": victim_username,
            "victim_rank_name": victim_rank_name,
            "killer_username": killer_username,
            "is_public": is_public,
            "created_at": a.get("created_at"),
        })

        if len(recent_kills) >= 15:
            break

    top_dead = await db.users.find(
        {"is_dead": True},
        {"_id": 0, "username": 1, "total_kills": 1, "rank_points": 1, "dead_at": 1}
    ).sort("total_kills", -1).limit(20).to_list(20)
    top_dead_users = []
    for u in top_dead:
        rid, rname = get_rank_info(int(u.get("rank_points", 0) or 0))
        top_dead_users.append({
            "username": u.get("username"),
            "total_kills": int(u.get("total_kills", 0) or 0),
            "rank_name": rname,
            "dead_at": u.get("dead_at"),
        })

    return {
        "generated_at": now.isoformat(),
        "game_capital": {
            "total_cash": int(totals_doc.get("money_total", 0) or 0),
            "swiss_total": int(totals_doc.get("swiss_total", 0) or 0),
            "interest_bank_total": interest_bank_total,
            "points_total": int(totals_doc.get("points_total", 0) or 0),
        },
        "user_stats": {
            "total_users": int(total_users),
            "alive_users": int(alive_users),
            "dead_users": int(dead_users),
            "total_crimes": int(totals_doc.get("total_crimes", 0) or 0),
            "total_gta": int(totals_doc.get("total_gta", 0) or 0),
            "total_jail_busts": int(totals_doc.get("total_jail_busts", 0) or 0),
            "bullets_melted_total": 0,
        },
        "vehicle_stats": {
            "total_vehicles": int(total_vehicles),
            "exclusive_vehicles": int(exclusive_vehicles),
            "rare_vehicles": int(rare_vehicles),
        },
        "rank_stats": rank_stats,
        "recent_kills": recent_kills,
        "top_dead_users": top_dead_users,
    }

# ---- Sports Betting (live games / results) ----
async def _sports_ensure_seed_events():
    """No seed events - all events are added by admin from live API templates."""
    pass


@api_router.get("/sports-betting/events")
async def sports_betting_events(current_user: dict = Depends(get_current_user)):
    """List open events (live games) for betting."""
    await _sports_ensure_seed_events()
    now = datetime.now(timezone.utc)
    cursor = db.sports_events.find(
        {"status": "open"},
        {"_id": 0, "id": 1, "name": 1, "category": 1, "start_time": 1, "options": 1, "is_special": 1},
    ).sort("start_time", 1)
    events = await cursor.to_list(50)
    result = []
    close_betting_minutes = 10
    for e in events:
        st = e.get("start_time")
        try:
            start_dt = datetime.fromisoformat(st.replace("Z", "+00:00")) if st else now
        except Exception:
            start_dt = now
        betting_closes_at = start_dt - timedelta(minutes=close_betting_minutes)
        betting_open = now < betting_closes_at
        if now < start_dt:
            status = "upcoming"
        elif now < start_dt + timedelta(hours=3):
            status = "in_play"
        else:
            status = "finished"
        result.append({
            "id": e["id"],
            "name": e.get("name", "?"),
            "category": e.get("category", "—"),
            "start_time": st,
            "start_time_display": start_dt.strftime("%d-%m-%Y - %H:%M"),
            "options": e.get("options") or [],
            "is_special": bool(e.get("is_special")),
            "betting_open": betting_open,
            "status": status,
        })
    return {"events": result}


@api_router.post("/sports-betting/bet")
async def sports_betting_place(request: SportsBetPlaceRequest, current_user: dict = Depends(get_current_user)):
    """Place a bet on an event option."""
    event_id = (request.event_id or "").strip()
    option_id = (request.option_id or "").strip()
    stake = int(request.stake or 0)
    if not event_id or not option_id:
        raise HTTPException(status_code=400, detail="event_id and option_id required")
    if stake <= 0:
        raise HTTPException(status_code=400, detail="Stake must be greater than 0")
    ev = await db.sports_events.find_one({"id": event_id, "status": "open"}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found or closed")
    st = ev.get("start_time")
    try:
        start_dt = datetime.fromisoformat(st.replace("Z", "+00:00")) if st else datetime.now(timezone.utc)
    except Exception:
        start_dt = datetime.now(timezone.utc)
    if datetime.now(timezone.utc) >= start_dt - timedelta(minutes=10):
        raise HTTPException(status_code=400, detail="Betting closed (closes 10 min before start)")
    opt = next((o for o in (ev.get("options") or []) if o.get("id") == option_id), None)
    if not opt:
        raise HTTPException(status_code=400, detail="Invalid option")
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    money = int(user.get("money", 0) or 0)
    if stake > money:
        raise HTTPException(status_code=400, detail="Insufficient cash")
    now = datetime.now(timezone.utc).isoformat()
    bet_id = str(uuid.uuid4())
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -stake}})
    await db.sports_bets.insert_one({
        "id": bet_id,
        "user_id": current_user["id"],
        "event_id": event_id,
        "event_name": ev.get("name", "?"),
        "option_id": option_id,
        "option_name": opt.get("name", "?"),
        "odds": float(opt.get("odds", 1)),
        "stake": stake,
        "status": "open",
        "created_at": now,
    })
    await log_gambling(current_user["id"], current_user.get("username") or "?", "sports_bet", {"bet_id": bet_id, "event_name": ev.get("name"), "option_name": opt.get("name"), "odds": float(opt.get("odds", 1)), "stake": stake, "status": "open"})
    return {"message": f"Bet placed: ${stake:,} on {opt.get('name')}", "bet_id": bet_id}


@api_router.get("/sports-betting/my-bets")
async def sports_betting_my_bets(current_user: dict = Depends(get_current_user)):
    """User's open and closed bets."""
    open_bets = await db.sports_bets.find(
        {"user_id": current_user["id"], "status": "open"},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    closed_bets = await db.sports_bets.find(
        {"user_id": current_user["id"], "status": {"$in": ["won", "lost"]}},
        {"_id": 0},
    ).sort("settled_at", -1).to_list(50)
    return {
        "open": [{"id": b["id"], "event_name": b.get("event_name"), "option_name": b.get("option_name"), "odds": b.get("odds"), "stake": b.get("stake"), "created_at": b.get("created_at")} for b in open_bets],
        "closed": [{"id": b["id"], "event_name": b.get("event_name"), "option_name": b.get("option_name"), "odds": b.get("odds"), "stake": b.get("stake"), "status": b.get("status"), "created_at": b.get("created_at"), "settled_at": b.get("settled_at")} for b in closed_bets],
    }


@api_router.post("/sports-betting/cancel-bet")
async def sports_betting_cancel_bet(request: SportsBetCancelRequest, current_user: dict = Depends(get_current_user)):
    """Cancel one open bet and refund the stake."""
    bet_id = (request.bet_id or "").strip()
    if not bet_id:
        raise HTTPException(status_code=400, detail="bet_id required")
    bet = await db.sports_bets.find_one({"id": bet_id, "user_id": current_user["id"], "status": "open"}, {"_id": 0, "stake": 1})
    if not bet:
        raise HTTPException(status_code=404, detail="Bet not found or already settled")
    stake = int(bet.get("stake") or 0)
    now = datetime.now(timezone.utc).isoformat()
    await db.sports_bets.update_one({"id": bet_id}, {"$set": {"status": "cancelled", "settled_at": now}})
    if stake > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": stake}})
    return {"message": f"Bet cancelled. ${stake:,} refunded.", "refunded": stake}


@api_router.post("/sports-betting/cancel-all-bets")
async def sports_betting_cancel_all_bets(current_user: dict = Depends(get_current_user)):
    """Cancel all open bets for the current user and refund all stakes."""
    cursor = db.sports_bets.find({"user_id": current_user["id"], "status": "open"}, {"_id": 0, "id": 1, "stake": 1})
    bets = await cursor.to_list(100)
    if not bets:
        return {"message": "No open bets to cancel.", "refunded": 0, "cancelled_count": 0}
    total_refund = 0
    now = datetime.now(timezone.utc).isoformat()
    for b in bets:
        stake = int(b.get("stake") or 0)
        await db.sports_bets.update_one({"id": b["id"]}, {"$set": {"status": "cancelled", "settled_at": now}})
        total_refund += stake
    if total_refund > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": total_refund}})
    return {"message": f"All {len(bets)} bet(s) cancelled. ${total_refund:,} refunded.", "refunded": total_refund, "cancelled_count": len(bets)}


@api_router.get("/sports-betting/stats")
async def sports_betting_stats(current_user: dict = Depends(get_current_user)):
    """User's betting statistics."""
    pipeline = [
        {"$match": {"user_id": current_user["id"], "status": {"$in": ["won", "lost"]}}},
        {"$group": {"_id": None, "total_stake": {"$sum": "$stake"}, "won_count": {"$sum": {"$cond": [{"$eq": ["$status", "won"]}, 1, 0]}}, "lost_count": {"$sum": {"$cond": [{"$eq": ["$status", "lost"]}, 1, 0]}}}},
    ]
    agg = await db.sports_bets.aggregate(pipeline).to_list(1)
    doc = agg[0] if agg else {}
    total_stake = int(doc.get("total_stake", 0) or 0)
    won_count = int(doc.get("won_count", 0) or 0)
    lost_count = int(doc.get("lost_count", 0) or 0)
    total_placed = won_count + lost_count
    # Profit: won bets pay stake * odds, lost = -stake. We don't store payout; profit = (won_count * avg) - total_stake approx. Use sum of (stake*odds - stake) for won and -stake for lost.
    won_stake = await db.sports_bets.aggregate([
        {"$match": {"user_id": current_user["id"], "status": "won"}},
        {"$group": {"_id": None, "sum": {"$sum": {"$multiply": ["$stake", "$odds"]}}}},
    ]).to_list(1)
    lost_stake = await db.sports_bets.aggregate([
        {"$match": {"user_id": current_user["id"], "status": "lost"}},
        {"$group": {"_id": None, "sum": {"$sum": "$stake"}}},
    ]).to_list(1)
    winnings = int((won_stake[0].get("sum", 0) or 0)) if won_stake else 0
    losses = int((lost_stake[0].get("sum", 0) or 0)) if lost_stake else 0
    profit_loss = winnings - losses
    win_pct = round(100 * won_count / total_placed, 1) if total_placed else 0
    all_placed = await db.sports_bets.count_documents({"user_id": current_user["id"]})
    return {
        "total_bets_placed": all_placed,
        "total_bets_won": won_count,
        "total_bets_lost": lost_count,
        "win_pct": win_pct,
        "profit_loss": profit_loss,
    }


@api_router.get("/sports-betting/recent-results")
async def sports_betting_recent_results(current_user: dict = Depends(get_current_user)):
    """Last 25 settled bet results (live results)."""
    cursor = db.sports_bets.find(
        {"user_id": current_user["id"], "status": {"$in": ["won", "lost"]}},
        {"_id": 0, "option_name": 1, "odds": 1, "status": 1, "settled_at": 1, "created_at": 1},
    ).sort("settled_at", -1).limit(25)
    rows = await cursor.to_list(25)
    return {
        "results": [
            {"betting_option": b.get("option_name", "—"), "odds": b.get("odds"), "result": b.get("status", "—"), "date": b.get("settled_at") or b.get("created_at")}
            for b in rows
        ],
    }


class SportsSettleEventRequest(BaseModel):
    event_id: str
    winning_option_id: str


class AdminAddSportsEventRequest(BaseModel):
    template_id: str


class AdminCancelEventRequest(BaseModel):
    event_id: str


class AdminCustomEventOption(BaseModel):
    name: str
    odds: Optional[float] = 2.0


class AdminAddCustomSportsEventRequest(BaseModel):
    name: str
    category: str  # Football, UFC, Boxing, Formula 1
    options: List[AdminCustomEventOption]  # at least 2


# Live sports data cache - all templates from APIs only (no hardcoded events)
_sports_live_cache = {"football": [], "ufc": [], "boxing": [], "f1": [], "updated_at": 0.0}
SPORTS_LIVE_CACHE_TTL = 6 * 3600  # 6 hours

# The Odds API (the-odds-api.com) - set THE_ODDS_API_KEY for Football, MMA, Boxing (F1 later)
ODDS_API_BASE = "https://api.the-odds-api.com/v4"
# Sport keys: soccer_epl, soccer_spain_la_liga, soccer_germany_bundesliga, mma_mixed_martial_arts, boxing_boxing

# TheSportsDB league ids: 4328=Premier League, 4335=La Liga, 4443=UFC, 4445=Boxing
THESPORTSDB_LEAGUE_PREMIER = 4328
THESPORTSDB_LEAGUE_LALIGA = 4335
THESPORTSDB_LEAGUE_UFC = 4443
THESPORTSDB_LEAGUE_BOXING = 4445


def _odds_api_key():
    return os.environ.get("THE_ODDS_API_KEY", "").strip()


def _parse_commence_time(commence_time) -> str | None:
    """Convert Odds API commence_time (ISO string or Unix timestamp) to ISO string."""
    if commence_time is None:
        return None
    if isinstance(commence_time, (int, float)):
        try:
            dt = datetime.fromtimestamp(int(commence_time), tz=timezone.utc)
            return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")
        except (ValueError, OSError):
            return None
    s = (commence_time or "").strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    except Exception:
        return None


def _parse_odds_event(event: dict, category: str, three_way: bool) -> dict | None:
    """Parse one event from The Odds API into our template shape. three_way=True for soccer (home/draw/away)."""
    event_id = (event.get("id") or "").strip()
    home = (event.get("home_team") or "").strip()
    away = (event.get("away_team") or "").strip()
    if not home or not away or not event_id:
        return None
    bookmakers = event.get("bookmakers") or []
    outcomes = []
    for b in bookmakers:
        for m in (b.get("markets") or []):
            if (m.get("key") or "").lower() == "h2h":
                outcomes = m.get("outcomes") or []
                break
        if outcomes:
            break
    if not outcomes:
        return None
    # Build options: for soccer expect 3 (home, draw, away) in order home/draw/away; for MMA/boxing 2
    options = []
    for o in outcomes:
        name = (o.get("name") or "").strip()
        if not name:
            continue
        try:
            price = float(o.get("price") or 2.0)
        except (TypeError, ValueError):
            price = 2.0
        opt_id = name.lower().replace(" ", "_").replace(".", "")[:24]
        options.append({"id": opt_id, "name": name, "odds": round(price, 2)})
    if three_way:
        if len(options) != 3:
            return None
        # Order as home, draw, away; each outcome used once
        used = set()
        ordered = []
        for candidate in [home, "Draw", away]:
            for i, o in enumerate(options):
                if i in used:
                    continue
                n = (o.get("name") or "").strip()
                if candidate == "Draw" and "draw" in n.lower():
                    ordered.append(o)
                    used.add(i)
                    break
                if n == candidate:
                    ordered.append(o)
                    used.add(i)
                    break
        if len(ordered) == 3:
            options = ordered
    elif len(options) != 2:
        return None
    name = "%s vs %s" % (home, away)
    start_time = _parse_commence_time(event.get("commence_time"))
    out = {
        "id": "odds_%s_%s" % (category.lower()[:3], event_id[:16]),
        "name": name,
        "category": category,
        "options": options,
    }
    if start_time:
        out["start_time"] = start_time
    return out


async def _fetch_odds_api_soccer() -> list:
    """Fetch soccer (Football) from The Odds API. Returns list of templates with home/draw/away."""
    key = _odds_api_key()
    if not key:
        return []
    out = []
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            for sport_key in ("soccer_epl", "soccer_spain_la_liga", "soccer_germany_bundesliga"):
                r = await client.get(
                    "%s/sports/%s/odds" % (ODDS_API_BASE, sport_key),
                    params={"apiKey": key, "regions": "uk", "markets": "h2h", "oddsFormat": "decimal"},
                )
                if r.status_code != 200:
                    continue
                events = r.json()
                if not isinstance(events, list):
                    continue
                for ev in events[:12]:
                    parsed = _parse_odds_event(ev, "Football", three_way=True)
                    if parsed:
                        out.append(parsed)
    except Exception:
        pass
    return out


async def _fetch_odds_api_mma() -> list:
    """Fetch MMA (UFC) from The Odds API. Two outcomes per event."""
    key = _odds_api_key()
    if not key:
        return []
    out = []
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(
                "%s/sports/mma_mixed_martial_arts/odds" % ODDS_API_BASE,
                params={"apiKey": key, "regions": "uk", "markets": "h2h", "oddsFormat": "decimal"},
            )
            if r.status_code != 200:
                return []
            events = r.json()
            if not isinstance(events, list):
                return []
            for ev in events[:15]:
                parsed = _parse_odds_event(ev, "UFC", three_way=False)
                if parsed:
                    out.append(parsed)
    except Exception:
        pass
    return out


async def _fetch_odds_api_boxing() -> list:
    """Fetch Boxing from The Odds API. Two outcomes per event."""
    key = _odds_api_key()
    if not key:
        return []
    out = []
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(
                "%s/sports/boxing_boxing/odds" % ODDS_API_BASE,
                params={"apiKey": key, "regions": "uk", "markets": "h2h", "oddsFormat": "decimal"},
            )
            if r.status_code != 200:
                return []
            events = r.json()
            if not isinstance(events, list):
                return []
            for ev in events[:15]:
                parsed = _parse_odds_event(ev, "Boxing", three_way=False)
                if parsed:
                    out.append(parsed)
    except Exception:
        pass
    return out


async def _fetch_football_events_football_data_org() -> list:
    """Fetch fixtures from football-data.org v4 (better source). Requires env FOOTBALL_DATA_ORG_TOKEN (free at football-data.org)."""
    token = os.environ.get("FOOTBALL_DATA_ORG_TOKEN", "").strip()
    if not token:
        return []
    out = []
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            for code in ("PL", "PD", "BL1"):
                r = await client.get(
                    "https://api.football-data.org/v4/competitions/%s/matches" % code,
                    headers={"X-Auth-Token": token},
                )
                if r.status_code != 200:
                    continue
                data = r.json()
                matches = data.get("matches") or []
                count = 0
                for i, m in enumerate(matches):
                    if count >= 15:
                        break
                    status = (m.get("status") or "").upper()
                    if status not in ("SCHEDULED", "TIMED"):
                        continue
                    ht = (m.get("homeTeam") or {}).get("name") or ""
                    at = (m.get("awayTeam") or {}).get("name") or ""
                    if not ht or not at:
                        continue
                    count += 1
                    name = "%s vs %s" % (ht, at)
                    opt_h = ht.lower().replace(" ", "_").replace(".", "")[:20]
                    opt_a = at.lower().replace(" ", "_").replace(".", "")[:20]
                    comp = (m.get("competition") or {}).get("name") or code
                    if comp and comp != code:
                        name = "%s: %s" % (comp, name)
                    odds = m.get("odds") or {}
                    try:
                        home_odds = float(odds.get("homeWin") or 2.1)
                        draw_odds = float(odds.get("draw") or 3.3)
                        away_odds = float(odds.get("awayWin") or 3.2)
                    except (TypeError, ValueError):
                        home_odds, draw_odds, away_odds = 2.1, 3.3, 3.2
                    out.append({
                        "id": "football_fdo_%s_%s" % (code, count - 1),
                        "name": name,
                        "category": "Football",
                        "options": [
                            {"id": "home_" + opt_h, "name": ht, "odds": round(home_odds, 2)},
                            {"id": "draw", "name": "Draw", "odds": round(draw_odds, 2)},
                            {"id": "away_" + opt_a, "name": at, "odds": round(away_odds, 2)},
                        ],
                    })
    except Exception:
        pass
    return out


async def _fetch_football_events_thesportsdb() -> list:
    """Fallback: football fixtures from TheSportsDB (no token). Tries eventsseason and eventsnextleague."""
    out = []
    year = datetime.now(timezone.utc).year
    league_ids = [(THESPORTSDB_LEAGUE_PREMIER, "Premier League"), (THESPORTSDB_LEAGUE_LALIGA, "La Liga")]
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            for league_id, _ in league_ids:
                for endpoint, params in [
                    ("eventsseason.php", {"id": league_id, "s": year}),
                    ("eventsseason.php", {"id": league_id, "s": year - 1}),
                    ("eventsnextleague.php", {"id": league_id}),
                ]:
                    try:
                        r = await client.get(
                            "https://www.thesportsdb.com/api/v1/json/123/" + endpoint,
                            params=params,
                        )
                        if r.status_code != 200:
                            continue
                        data = r.json()
                        events = (data.get("events") or [])[:25]
                        for i, e in enumerate(events):
                            sport = (e.get("strSport") or "").lower()
                            if sport not in ("soccer", "football", "") and "league" not in (e.get("strLeague") or "").lower():
                                continue
                            name = (e.get("strEvent") or "").strip()
                            home = (e.get("strHomeTeam") or "").strip()
                            away = (e.get("strAwayTeam") or "").strip()
                            if not home or not away:
                                continue
                            if not name:
                                name = "%s vs %s" % (home, away)
                            status = (e.get("strStatus") or "").lower()
                            if "finished" in status or "result" in status or status == "match finished":
                                continue
                            opt_h = home.lower().replace(" ", "_").replace(".", "")[:20]
                            opt_a = away.lower().replace(" ", "_").replace(".", "")[:20]
                            out.append({
                                "id": "football_tsdb_%s_%s" % (league_id, len(out)),
                                "name": name,
                                "category": "Football",
                                "options": [
                                    {"id": "home_" + opt_h, "name": home, "odds": round(2.0 + random.uniform(0.2, 1.2), 2)},
                                    {"id": "draw", "name": "Draw", "odds": round(3.0 + random.uniform(0.1, 0.6), 2)},
                                    {"id": "away_" + opt_a, "name": away, "odds": round(2.0 + random.uniform(0.2, 1.2), 2)},
                                ],
                            })
                        if out:
                            break
                    except Exception:
                        continue
                    if out:
                        break
                if len(out) >= 20:
                    break
    except Exception:
        pass
    return out[:30]


async def _fetch_football_events() -> list:
    """Football: prefer The Odds API (THE_ODDS_API_KEY), then football-data.org, else TheSportsDB."""
    if _odds_api_key():
        events = await _fetch_odds_api_soccer()
        if events:
            return events
    events = await _fetch_football_events_football_data_org()
    if not events:
        events = await _fetch_football_events_thesportsdb()
    return events


async def _fetch_boxing_events() -> list:
    """Boxing: prefer The Odds API (THE_ODDS_API_KEY), else TheSportsDB."""
    if _odds_api_key():
        events = await _fetch_odds_api_boxing()
        if events:
            return events
    try:
        year = datetime.now(timezone.utc).year
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://www.thesportsdb.com/api/v1/json/123/eventsseason.php",
                params={"id": THESPORTSDB_LEAGUE_BOXING, "s": year},
            )
            if r.status_code != 200:
                return []
            data = r.json()
            events = (data.get("events") or [])[:15]
            out = []
            for i, e in enumerate(events):
                name = (e.get("strEvent") or "").strip() or "Boxing %s" % (i + 1)
                home = (e.get("strHomeTeam") or "").strip()
                away = (e.get("strAwayTeam") or "").strip()
                if not home or not away:
                    if " vs " in name:
                        parts = name.split(" vs ", 1)
                        away = (parts[1].strip() if len(parts) > 1 else "").strip()
                        first = (parts[0].strip() if parts else "")
                        bits = first.split()
                        home = bits[-1] if bits else "Fighter A"
                        if not away:
                            away = "Fighter B"
                    else:
                        home = home or "Fighter A"
                        away = away or "Fighter B"
                opt_id_h = home.lower().replace(" ", "_").replace(".", "")[:24]
                opt_id_a = away.lower().replace(" ", "_").replace(".", "")[:24]
                out.append({
                    "id": "boxing_live_%s" % i,
                    "name": name,
                    "category": "Boxing",
                    "options": [
                        {"id": opt_id_h, "name": home, "odds": 1.9},
                        {"id": opt_id_a, "name": away, "odds": 1.95},
                    ],
                })
            return out
    except Exception:
        return []


async def _fetch_f1_drivers() -> list:
    """Fetch current F1 drivers: try f1api.dev first, fallback to Ergast."""
    # 1) Open F1 API (f1api.dev)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://f1api.dev/api/current/drivers",
                headers={"Accept": "application/json"},
            )
            if r.status_code == 200:
                data = r.json()
                raw = (data.get("drivers") or [])[:20]
                if raw:
                    out = []
                    for i, d in enumerate(raw):
                        driver_id = (d.get("driverId") or "d%s" % i).lower().replace(" ", "_").replace("-", "_")
                        first = (d.get("name") or "").strip()
                        last = (d.get("surname") or "").strip()
                        name = "%s %s" % (first, last).strip() or "Driver %s" % (i + 1)
                        out.append({
                            "driver_id": driver_id,
                            "name": name,
                            "option": {"id": driver_id, "name": name, "odds": round(2.0 + (i * 0.2), 2)},
                        })
                    return out
    except Exception:
        pass
    # 2) Fallback: Ergast API
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://ergast.com/api/f1/2025/drivers.json",
                headers={"Accept": "application/json"},
            )
            if r.status_code != 200:
                return []
            data = r.json()
            driver_table = (data.get("MRData") or {}).get("DriverTable") or {}
            raw = (driver_table.get("Drivers") or [])[:20]
            out = []
            for i, d in enumerate(raw):
                driver_id = (d.get("driverId") or "d%s" % i).lower().replace(" ", "_")
                given = (d.get("givenName") or "").strip()
                family = (d.get("familyName") or "").strip()
                name = "%s %s" % (given, family).strip() or "Driver %s" % (i + 1)
                out.append({
                    "driver_id": driver_id,
                    "name": name,
                    "option": {"id": driver_id, "name": name, "odds": round(2.0 + (i * 0.2), 2)},
                })
            return out
    except Exception:
        return []


async def _fetch_ufc_events() -> list:
    """UFC: prefer The Odds API (THE_ODDS_API_KEY), else TheSportsDB."""
    if _odds_api_key():
        events = await _fetch_odds_api_mma()
        if events:
            return events
    try:
        year = datetime.now(timezone.utc).year
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://www.thesportsdb.com/api/v1/json/123/eventsseason.php",
                params={"id": THESPORTSDB_LEAGUE_UFC, "s": year},
            )
            if r.status_code != 200:
                return []
            data = r.json()
            events = (data.get("events") or [])[:15]
            out = []
            for i, e in enumerate(events):
                sport = (e.get("strSport") or "").lower()
                if sport != "fighting" and "ufc" not in (e.get("strLeague") or "").lower():
                    continue
                name = (e.get("strEvent") or "").strip() or "UFC Fight %s" % (i + 1)
                home = (e.get("strHomeTeam") or "").strip()
                away = (e.get("strAwayTeam") or "").strip()
                if not home or not away:
                    # Parse "Event Name Fighter1 vs Fighter2" or "UFC 311 Makhachev vs Moicano"
                    if " vs " in name:
                        parts = name.split(" vs ", 1)
                        # Take last part as "Fighter2", first part may contain event title - take last two words as fighters if needed
                        away = (parts[1].strip() if len(parts) > 1 else "").strip()
                        first = (parts[0].strip() if parts else "")
                        # e.g. "UFC 311 Makhachev" -> Makhachev, "UFC Fight Night 250 Adesanya" -> Adesanya
                        bits = first.split()
                        home = bits[-1] if len(bits) >= 1 else "Fighter A"
                        if not away:
                            away = "Fighter B"
                    else:
                        home = home or "Fighter A"
                        away = away or "Fighter B"
                opt_id_h = home.lower().replace(" ", "_").replace(".", "")[:24]
                opt_id_a = away.lower().replace(" ", "_").replace(".", "")[:24]
                out.append({
                    "id": "ufc_live_%s" % i,
                    "name": name,
                    "category": "UFC",
                    "options": [
                        {"id": opt_id_h, "name": home, "odds": 1.9},
                        {"id": opt_id_a, "name": away, "odds": 1.95},
                    ],
                })
            return out
    except Exception:
        return []


async def _refresh_sports_live_cache(force: bool = False):
    """Refresh all sports live data from APIs. When force=True, always fetch (for 'Check for events' button)."""
    now = time.time()
    if not force and now - _sports_live_cache["updated_at"] < SPORTS_LIVE_CACHE_TTL:
        return
    football, ufc, boxing, f1_drivers = await asyncio.gather(
        _fetch_football_events(),
        _fetch_ufc_events(),
        _fetch_boxing_events(),
        _fetch_f1_drivers(),
    )
    _sports_live_cache["football"] = football
    _sports_live_cache["ufc"] = ufc
    _sports_live_cache["boxing"] = boxing
    # If football or F1 came back empty, retry sooner (e.g. in 2 min) so transient API failures don't stick for 6h
    retry_soon = (not football) or (not f1_drivers)
    if retry_soon:
        _sports_live_cache["updated_at"] = now - SPORTS_LIVE_CACHE_TTL + 120  # 2 min
    else:
        _sports_live_cache["updated_at"] = now
    # Build F1 templates from driver list (race winner, podium, sprint)
    f1_templates = []
    if f1_drivers:
        opts_race = [d["option"] for d in f1_drivers[:4]]
        if len(opts_race) < 4:
            opts_race.append({"id": "other", "name": "Any Other", "odds": 5.0})
        f1_templates.append({
            "id": "f1_live_race",
            "name": "Grand Prix: Race Winner",
            "category": "Formula 1",
            "options": opts_race,
        })
        d0 = f1_drivers[0] if f1_drivers else None
        if d0:
            f1_templates.append({
                "id": "f1_live_podium",
                "name": "Grand Prix: Podium Finish",
                "category": "Formula 1",
                "options": [
                    {"id": d0["driver_id"] + "_yes", "name": d0["name"] + " - Top 3", "odds": 1.5},
                    {"id": d0["driver_id"] + "_no", "name": d0["name"] + " - No Podium", "odds": 2.6},
                ],
            })
        if len(f1_drivers) >= 2:
            f1_templates.append({
                "id": "f1_live_sprint",
                "name": "Sprint Race Winner",
                "category": "Formula 1",
                "options": [
                    f1_drivers[0]["option"],
                    f1_drivers[1]["option"],
                    {"id": "field", "name": "Rest of Field", "odds": 6.0},
                ],
            })
    _sports_live_cache["f1"] = f1_templates


def _get_all_sports_templates() -> list:
    """Return all templates from live API cache only (no hardcoded events)."""
    return (
        (_sports_live_cache.get("football") or [])
        + (_sports_live_cache.get("ufc") or [])
        + (_sports_live_cache.get("boxing") or [])
        + (_sports_live_cache.get("f1") or [])
    )


def _sports_template_to_response(t):
    """Build template dict for API response with start_time_display."""
    row = {"id": t["id"], "name": t["name"], "category": t["category"], "options": t.get("options") or []}
    st = t.get("start_time")
    if st:
        row["start_time"] = st
        try:
            dt = datetime.fromisoformat(st.replace("Z", "+00:00"))
            row["start_time_display"] = dt.strftime("%d-%m-%Y %H:%M")
        except Exception:
            row["start_time_display"] = st
    return row


@api_router.get("/admin/sports-betting/templates")
async def admin_sports_templates(current_user: dict = Depends(get_current_user)):
    """Admin: list event templates from cache only. No API calls - use POST /refresh to fetch (saves free-tier quota)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    categories = ["Football", "UFC", "Boxing", "Formula 1"]
    by_category = {c: [] for c in categories}
    for t in _get_all_sports_templates():
        by_category.setdefault(t["category"], []).append(_sports_template_to_response(t))
    return {"categories": categories, "templates": by_category}


@api_router.post("/admin/sports-betting/refresh")
async def admin_sports_refresh(current_user: dict = Depends(get_current_user)):
    """Admin: fetch latest events from The Odds API etc. (use when user clicks 'Check for events'). Uses quota."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    await _refresh_sports_live_cache(force=True)
    categories = ["Football", "UFC", "Boxing", "Formula 1"]
    by_category = {c: [] for c in categories}
    for t in _get_all_sports_templates():
        by_category.setdefault(t["category"], []).append(_sports_template_to_response(t))
    return {"categories": categories, "templates": by_category}


@api_router.post("/admin/sports-betting/events")
async def admin_sports_add_event(request: AdminAddSportsEventRequest, current_user: dict = Depends(get_current_user)):
    """Admin: add a live event from a template. Template must be in cache (click 'Check for events' first)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    template_id = (request.template_id or "").strip()
    template = next((t for t in _get_all_sports_templates() if t["id"] == template_id), None)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    now = datetime.now(timezone.utc)
    start_time = template.get("start_time") or (now + timedelta(hours=2)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    ev = {
        "id": str(uuid.uuid4()),
        "name": template["name"],
        "category": template["category"],
        "start_time": start_time,
        "options": [dict(o) for o in template["options"]],
        "is_special": False,
        "status": "open",
    }
    await db.sports_events.insert_one(ev)
    return {"message": f"Added event: {template['name']}", "event_id": ev["id"]}


@api_router.post("/admin/sports-betting/custom-event")
async def admin_sports_add_custom_event(request: AdminAddCustomSportsEventRequest, current_user: dict = Depends(get_current_user)):
    """Admin: create a custom sports event (e.g. when no API games available). Same flow as template events."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    name = (request.name or "").strip()
    category = (request.category or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Event name required")
    valid_categories = ("Football", "UFC", "Boxing", "Formula 1")
    if category not in valid_categories:
        raise HTTPException(status_code=400, detail=f"category must be one of: {', '.join(valid_categories)}")
    opts = list(request.options or [])
    if len(opts) < 2:
        raise HTTPException(status_code=400, detail="At least 2 options required")
    now = datetime.now(timezone.utc)
    start_time = (now + timedelta(hours=2)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    options = []
    for i, o in enumerate(opts):
        opt_name = (o.name or "").strip()
        if not opt_name:
            raise HTTPException(status_code=400, detail=f"Option {i + 1} name required")
        try:
            odds = float(o.odds if o.odds is not None else 2.0)
        except (TypeError, ValueError):
            odds = 2.0
        odds = max(1.01, min(100.0, round(odds, 2)))
        opt_id = (opt_name.lower().replace(" ", "_").replace(".", "")[:24] or f"opt_{i}") + f"_{uuid.uuid4().hex[:6]}"
        options.append({"id": opt_id, "name": opt_name, "odds": odds})
    ev = {
        "id": str(uuid.uuid4()),
        "name": name,
        "category": category,
        "start_time": start_time,
        "options": options,
        "is_special": False,
        "status": "open",
    }
    await db.sports_events.insert_one(ev)
    return {"message": f"Added custom event: {name}", "event_id": ev["id"]}


@api_router.post("/admin/sports-betting/settle")
async def admin_sports_settle(request: SportsSettleEventRequest, current_user: dict = Depends(get_current_user)):
    """Admin: settle an event, mark bets won/lost, and auto-pay winners."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    event_id = (request.event_id or "").strip()
    winning_option_id = (request.winning_option_id or "").strip()
    ev = await db.sports_events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    now = datetime.now(timezone.utc).isoformat()
    await db.sports_events.update_one(
        {"id": event_id},
        {"$set": {"status": "settled", "winning_option_id": winning_option_id}},
    )
    cursor = db.sports_bets.find(
        {"event_id": event_id, "status": "open"},
        {"_id": 0, "id": 1, "user_id": 1, "option_id": 1, "stake": 1, "odds": 1, "event_name": 1, "option_name": 1},
    )
    for b in await cursor.to_list(1000):
        won = b.get("option_id") == winning_option_id
        new_status = "won" if won else "lost"
        await db.sports_bets.update_one({"id": b["id"]}, {"$set": {"status": new_status, "settled_at": now}})
        u = await db.users.find_one({"id": b["user_id"]}, {"_id": 0, "username": 1})
        await log_gambling(b["user_id"], u.get("username") if u else "?", "sports_bet", {"bet_id": b["id"], "event_name": b.get("event_name"), "option_name": b.get("option_name"), "stake": b.get("stake"), "odds": b.get("odds"), "status": new_status, "settled_at": now})
        if won:
            stake = int(b.get("stake") or 0)
            odds = float(b.get("odds") or 1)
            payout = int(stake * odds)
            if payout > 0:
                await db.users.update_one({"id": b["user_id"]}, {"$inc": {"money": payout}})
    return {"message": f"Event {event_id} settled. Winning option: {winning_option_id}. Winners paid out."}


@api_router.post("/admin/sports-betting/cancel-event")
async def admin_sports_cancel_event(request: AdminCancelEventRequest, current_user: dict = Depends(get_current_user)):
    """Admin: cancel an event, refund all open bets on it, and remove it from the open list."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    event_id = (request.event_id or "").strip()
    ev = await db.sports_events.find_one({"id": event_id, "status": "open"}, {"_id": 0, "id": 1})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found or already settled/cancelled")
    now = datetime.now(timezone.utc).isoformat()
    cursor = db.sports_bets.find(
        {"event_id": event_id, "status": "open"},
        {"_id": 0, "id": 1, "user_id": 1, "stake": 1},
    )
    refunded_count = 0
    total_refunded = 0
    for b in await cursor.to_list(1000):
        stake = int(b.get("stake") or 0)
        await db.sports_bets.update_one({"id": b["id"]}, {"$set": {"status": "cancelled", "settled_at": now}})
        if stake > 0:
            await db.users.update_one({"id": b["user_id"]}, {"$inc": {"money": stake}})
        refunded_count += 1
        total_refunded += stake
    await db.sports_events.update_one({"id": event_id}, {"$set": {"status": "cancelled"}})
    return {
        "message": f"Event cancelled. {refunded_count} bet(s) refunded (${total_refunded:,} total).",
        "refunded_count": refunded_count,
        "total_refunded": total_refunded,
    }



# Rank Progress endpoint
@api_router.get("/user/rank-progress")
async def get_rank_progress(current_user: dict = Depends(get_current_user)):
    current_rank_id, current_rank_name = get_rank_info(current_user.get("rank_points", 0))
    
    if current_rank_id >= 11:
        return {
            "current_rank": current_rank_id,
            "current_rank_name": current_rank_name,
            "next_rank": None,
            "next_rank_name": "Max Rank",
            "money_progress": 100,
            "rank_points_progress": 100,
            "money_needed": 0,
            "rank_points_needed": 0,
            "money_current": current_user["money"],
            "rank_points_current": current_user.get("rank_points", 0)
        }
    
    next_rank = RANKS[current_rank_id]
    current_rank_req = RANKS[current_rank_id - 1]
    
    rank_points_progress = 0
    
    if next_rank["required_points"] > current_rank_req["required_points"]:
        points_range = next_rank["required_points"] - current_rank_req["required_points"]
        points_current = current_user.get("rank_points", 0) - current_rank_req["required_points"]
        rank_points_progress = min(100, max(0, (points_current / points_range * 100)))
    
    return {
        "current_rank": current_rank_id,
        "current_rank_name": current_rank_name,
        "next_rank": next_rank["id"],
        "next_rank_name": next_rank["name"],
        "rank_points_progress": rank_points_progress,
        "rank_points_needed": max(0, next_rank["required_points"] - current_user.get("rank_points", 0)),
        "rank_points_current": current_user.get("rank_points", 0)
    }


@api_router.get("/wealth-ranks")
async def get_wealth_ranks_list():
    """Return the full wealth rank ladder (1920s–1930s style). No auth required."""
    return {"wealth_ranks": [{"id": r["id"], "name": r["name"], "min_money": r["min_money"]} for r in WEALTH_RANKS]}


@api_router.get("/user/wealth-progress")
async def get_wealth_progress(current_user: dict = Depends(get_current_user)):
    """Current wealth rank and progress to next tier."""
    money = int(current_user.get("money", 0) or 0)
    wealth_id, wealth_name = get_wealth_rank(money)
    is_max = wealth_id >= WEALTH_RANKS[-1]["id"]
    if is_max:
        return {
            "wealth_rank": wealth_id,
            "wealth_rank_name": wealth_name,
            "money": money,
            "next_rank": None,
            "next_rank_name": None,
            "min_money_next": None,
            "money_needed": 0,
        }
    next_tier = next((r for r in WEALTH_RANKS if r["id"] == wealth_id + 1), None)
    if not next_tier:
        return {"wealth_rank": wealth_id, "wealth_rank_name": wealth_name, "money": money, "next_rank": None, "next_rank_name": None, "min_money_next": None, "money_needed": 0}
    min_next = next_tier["min_money"]
    return {
        "wealth_rank": wealth_id,
        "wealth_rank_name": wealth_name,
        "money": money,
        "next_rank": next_tier["id"],
        "next_rank_name": next_tier["name"],
        "min_money_next": min_next,
        "money_needed": max(0, min_next - money),
    }


# Admin endpoints
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

@api_router.post("/admin/ghost-mode")
async def admin_toggle_ghost_mode(current_user: dict = Depends(get_current_user)):
    """Toggle admin ghost mode so you do not appear in online list or as online on profile (admin only)."""
    if current_user.get("email") not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    new_value = not current_user.get("admin_ghost_mode", False)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"admin_ghost_mode": new_value}}
    )
    return {"admin_ghost_mode": new_value, "message": "Ghost mode " + ("on" if new_value else "off")}

@api_router.post("/admin/act-as-normal")
async def admin_act_as_normal(acting: bool, current_user: dict = Depends(get_current_user)):
    """Toggle acting as normal user (no admin powers) for testing. Only available to real admin emails."""
    if current_user.get("email") not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"admin_acting_as_normal": bool(acting)}}
    )
    return {"admin_acting_as_normal": bool(acting), "message": "Act as normal user " + ("on" if acting else "off")}

@api_router.post("/admin/change-rank")
async def admin_change_rank(target_username: str, new_rank: int, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    if not (1 <= new_rank <= len(RANKS)):
        raise HTTPException(status_code=400, detail=f"new_rank must be 1–{len(RANKS)}")
    
    # Case-insensitive username lookup
    username_pattern = _username_pattern(target_username)
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Rank is derived from rank_points everywhere; set rank_points to this rank's required_points
    rank_def = RANKS[new_rank - 1]
    required_pts = int(rank_def["required_points"])
    old_rp = int(target.get("rank_points") or 0)
    await db.users.update_one(
        {"id": target["id"]},
        {"$set": {"rank": new_rank, "rank_points": required_pts}}
    )
    rp_added = required_pts - old_rp
    if rp_added > 0:
        try:
            await maybe_process_rank_up(target["id"], old_rp, rp_added, target.get("username", ""))
        except Exception as e:
            logging.exception("Rank-up notification (admin set rank): %s", e)
    return {"message": f"Changed {target['username']}'s rank to {rank_def['name']} (rank_points set to {required_pts:,})"}

@api_router.post("/admin/add-points")
async def admin_add_points(target_username: str, points: int, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Case-insensitive username lookup
    username_pattern = _username_pattern(target_username)
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    
    await db.users.update_one(
        {"id": target["id"]},
        {"$inc": {"points": points}}
    )
    
    return {"message": f"Added {points} points to {target_username}"}

@api_router.post("/admin/give-all-points")
async def admin_give_all_points(points: int, current_user: dict = Depends(get_current_user)):
    """Give points to every alive (non-dead, non-NPC) account."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    if points < 1:
        raise HTTPException(status_code=400, detail="Points must be at least 1")
    result = await db.users.update_many(
        {"is_dead": {"$ne": True}, "is_npc": {"$ne": True}, "is_bodyguard": {"$ne": True}},
        {"$inc": {"points": points}}
    )
    return {"message": f"Gave {points} points to {result.modified_count} accounts", "updated": result.modified_count}


@api_router.post("/admin/give-all-money")
async def admin_give_all_money(amount: int, current_user: dict = Depends(get_current_user)):
    """Give money to every alive (non-dead, non-NPC) account."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    if amount < 1:
        raise HTTPException(status_code=400, detail="Amount must be at least 1")
    result = await db.users.update_many(
        {"is_dead": {"$ne": True}, "is_npc": {"$ne": True}, "is_bodyguard": {"$ne": True}},
        {"$inc": {"money": amount}}
    )
    return {"message": f"Gave ${amount:,} to {result.modified_count} accounts", "updated": result.modified_count}


@api_router.post("/admin/give-all-money")
async def admin_give_all_money(amount: int, current_user: dict = Depends(get_current_user)):
    """Give money to every alive (non-dead, non-NPC) account."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    if amount < 1:
        raise HTTPException(status_code=400, detail="Amount must be at least 1")
    result = await db.users.update_many(
        {"is_dead": {"$ne": True}, "is_npc": {"$ne": True}, "is_bodyguard": {"$ne": True}},
        {"$inc": {"money": amount}}
    )
    return {"message": f"Gave ${amount:,} to {result.modified_count} accounts", "updated": result.modified_count}

@api_router.post("/admin/add-car")
async def admin_add_car(target_username: str, car_id: str, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Case-insensitive username lookup
    username_pattern = _username_pattern(target_username)
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    
    car = next((c for c in CARS if c["id"] == car_id), None)
    if not car:
        raise HTTPException(status_code=404, detail="Car not found")
    
    await db.user_cars.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": target["id"],
        "car_id": car_id,
        "car_name": car["name"],
        "acquired_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {"message": f"Added {car['name']} to {target_username}'s garage"}

# ===== SECURITY & ANTI-CHEAT ADMIN ENDPOINTS =====

@api_router.get("/admin/security/summary")
async def admin_security_summary(limit: int = 100, flag_type: str = None, current_user: dict = Depends(get_current_user)):
    """Get summary of security flags."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    summary = await security_module.get_security_summary(db, limit=limit, flag_type=flag_type)
    return summary


@api_router.get("/admin/security/flags")
async def admin_security_flags(
    limit: int = 100,
    flag_type: str = None,
    user_id: str = None,
    resolved: bool = None,
    current_user: dict = Depends(get_current_user)
):
    """Get detailed security flags with filtering options."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {}
    if flag_type:
        query["flag_type"] = flag_type
    if user_id:
        query["user_id"] = user_id
    if resolved is not None:
        query["resolved"] = resolved
    
    flags = await db.security_flags.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"flags": flags, "count": len(flags)}


@api_router.post("/admin/security/flags/{flag_id}/resolve")
async def admin_resolve_security_flag(flag_id: str, current_user: dict = Depends(get_current_user)):
    """Mark a security flag as resolved."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await db.security_flags.update_one(
        {"id": flag_id},
        {"$set": {"resolved": True, "resolved_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Flag not found")
    
    return {"message": "Flag marked as resolved", "flag_id": flag_id}


@api_router.get("/admin/security/rate-limits")
async def admin_get_rate_limits(current_user: dict = Depends(get_current_user)):
    """Get current rate limit configuration (min sec between clicks per endpoint)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    return {
        "rate_limits": security_module.RATE_LIMIT_CONFIG,
        "note": "Min seconds between clicks per endpoint. Rate limits are in-memory; changes apply immediately."
    }


@api_router.post("/admin/security/rate-limits/toggle")
async def admin_toggle_rate_limit(
    endpoint: str,
    enabled: bool,
    current_user: dict = Depends(get_current_user)
):
    """Toggle rate limiting on/off for a specific endpoint."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if endpoint not in security_module.RATE_LIMIT_CONFIG:
        raise HTTPException(status_code=404, detail=f"Endpoint '{endpoint}' not found in rate limit config")
    
    interval, _ = security_module.RATE_LIMIT_CONFIG[endpoint]
    security_module.RATE_LIMIT_CONFIG[endpoint] = (interval, enabled)
    
    return {
        "message": f"Rate limit for '{endpoint}' {'enabled' if enabled else 'disabled'}",
        "endpoint": endpoint,
        "min_interval_sec": interval,
        "enabled": enabled
    }


@api_router.post("/admin/security/rate-limits/update")
async def admin_update_rate_limit(
    endpoint: str,
    min_interval_sec: float,
    current_user: dict = Depends(get_current_user)
):
    """Update the min seconds between clicks for a specific endpoint."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if endpoint not in security_module.RATE_LIMIT_CONFIG:
        raise HTTPException(status_code=404, detail=f"Endpoint '{endpoint}' not found in rate limit config")
    
    if min_interval_sec < 0.1 or min_interval_sec > 60:
        raise HTTPException(status_code=400, detail="Min interval must be between 0.1 and 60 seconds")
    
    _, enabled = security_module.RATE_LIMIT_CONFIG[endpoint]
    security_module.RATE_LIMIT_CONFIG[endpoint] = (min_interval_sec, enabled)
    
    return {
        "message": f"Rate limit for '{endpoint}' updated to {min_interval_sec}s between clicks",
        "endpoint": endpoint,
        "min_interval_sec": min_interval_sec,
        "enabled": enabled
    }


@api_router.post("/admin/security/rate-limits/disable-all")
async def admin_disable_all_rate_limits(current_user: dict = Depends(get_current_user)):
    """Disable rate limiting for ALL endpoints (emergency disable)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    security_module.GLOBAL_RATE_LIMITS_ENABLED = False
    
    count = 0
    for endpoint in security_module.RATE_LIMIT_CONFIG:
        interval, _ = security_module.RATE_LIMIT_CONFIG[endpoint]
        security_module.RATE_LIMIT_CONFIG[endpoint] = (interval, False)
        count += 1
    
    return {
        "message": f"Disabled ALL rate limiting (global toggle OFF + {count} endpoints disabled)",
        "global_enabled": False,
        "count": count
    }


@api_router.post("/admin/security/rate-limits/enable-all")
async def admin_enable_all_rate_limits(current_user: dict = Depends(get_current_user)):
    """Enable rate limiting for ALL endpoints."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    security_module.GLOBAL_RATE_LIMITS_ENABLED = True
    
    count = 0
    for endpoint in security_module.RATE_LIMIT_CONFIG:
        interval, _ = security_module.RATE_LIMIT_CONFIG[endpoint]
        security_module.RATE_LIMIT_CONFIG[endpoint] = (interval, True)
        count += 1
    
    return {
        "message": f"Enabled ALL rate limiting (global toggle ON + {count} endpoints enabled)",
        "global_enabled": True,
        "count": count
    }


@api_router.post("/admin/security/rate-limits/global-toggle")
async def admin_toggle_global_rate_limits(
    enabled: bool,
    current_user: dict = Depends(get_current_user)
):
    """Toggle the global rate limit master switch. When OFF, all rate limits are bypassed."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    security_module.GLOBAL_RATE_LIMITS_ENABLED = enabled
    
    return {
        "message": f"Global rate limits {'ENABLED' if enabled else 'DISABLED'}",
        "global_enabled": enabled
    }


@api_router.post("/admin/security/test-telegram")
async def admin_test_telegram(current_user: dict = Depends(get_current_user)):
    """Send a test alert to Telegram to verify configuration."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if not security_module.TELEGRAM_ENABLED:
        return {
            "success": False,
            "message": "Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env file."
        }
    
    await security_module.send_telegram_alert(
        f"🧪 Test alert from Mafia Game\n\nAdmin: {current_user.get('username', 'Unknown')}\n\nIf you see this, Telegram integration is working!",
        "info"
    )
    await security_module.flush_telegram_alerts()
    
    return {
        "success": True,
        "message": "Test alert sent! Check your Telegram chat."
    }


@api_router.post("/admin/security/clear-user-flags")
async def admin_clear_user_flags(user_id: str, current_user: dict = Depends(get_current_user)):
    """Clear all security flags for a specific user."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    count = await security_module.clear_user_security_flags(db, user_id)
    return {
        "message": f"Cleared {count} flag(s) for user {user_id}",
        "cleared_count": count
    }


@api_router.post("/admin/security/clear-old-flags")
async def admin_clear_old_flags(days: int = 30, current_user: dict = Depends(get_current_user)):
    """Clear security flags older than specified days."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    count = await security_module.clear_old_security_flags(db, days)
    return {
        "message": f"Cleared {count} flag(s) older than {days} days",
        "cleared_count": count,
        "days": days
    }


@api_router.post("/admin/hitlist/reset-npc-timers")
async def admin_reset_hitlist_npc_timers(current_user: dict = Depends(get_current_user)):
    """Reset everyone's hitlist NPC add timers (3-per-3h window). All users can add NPCs again as if the window just started."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    result = await db.users.update_many(
        {},
        {"$set": {"hitlist_npc_add_timestamps": []}}
    )
    return {"message": f"Reset hitlist NPC timers for all users ({result.modified_count} accounts)", "modified_count": result.modified_count}


@api_router.post("/admin/force-online")
async def admin_force_online(current_user: dict = Depends(get_current_user)):
    """
    Force offline (but alive) users to appear online for 1 hour.
    This affects the Users Online list and profile status.
    """
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")

    now = datetime.now(timezone.utc)
    five_min_ago = now - timedelta(minutes=5)
    until = now + timedelta(hours=1)
    until_iso = until.isoformat()

    # Only target offline users (not seen in last 5 min). Preserve any longer existing forced window.
    res = await db.users.update_many(
        {
            "is_dead": {"$ne": True},
            "$and": [
                {
                    "$or": [
                        {"last_seen": {"$lt": five_min_ago.isoformat()}},
                        {"last_seen": None},
                        {"last_seen": {"$exists": False}},
                    ]
                },
                {
                    "$or": [
                        {"forced_online_until": {"$exists": False}},
                        {"forced_online_until": None},
                        {"forced_online_until": {"$lt": until_iso}},
                    ]
                },
            ],
        },
        {"$set": {"forced_online_until": until_iso}},
    )

    return {"message": f"Forced offline users online until {until_iso}", "until": until_iso, "updated": res.modified_count}

@api_router.post("/admin/lock-player")
async def admin_lock_player(target_username: str, lock_minutes: int, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Case-insensitive username lookup
    username_pattern = _username_pattern(target_username)
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    
    jail_until = datetime.now(timezone.utc) + timedelta(minutes=lock_minutes)
    
    await db.users.update_one(
        {"id": target["id"]},
        {"$set": {"in_jail": True, "jail_until": jail_until.isoformat()}}
    )
    
    return {"message": f"Locked {target_username} for {lock_minutes} minutes"}

@api_router.post("/admin/kill-player")
async def admin_kill_player(target_username: str, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Case-insensitive username lookup
    username_pattern = _username_pattern(target_username)
    target = await db.users.find_one({"username": username_pattern}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("is_dead"):
        raise HTTPException(status_code=400, detail="That account is already dead")
    
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"id": target["id"]},
        {"$set": {
            "is_dead": True,
            "dead_at": now_iso,
            "points_at_death": int(target.get("points", 0) or 0),
            "money": 0,
            "health": 0,
        }, "$inc": {"total_deaths": 1}}
    )
    return {"message": f"Killed {target_username}. Account is dead (cannot login); use Dead to Alive to revive."}

@api_router.post("/admin/set-search-time")
async def admin_set_search_time(target_username: str, search_minutes: int, current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    username_pattern = _username_pattern(target_username)
    if not username_pattern:
        raise HTTPException(status_code=404, detail="User not found")
    attacker = await db.users.find_one({"username": username_pattern}, {"_id": 0})
    if not attacker:
        raise HTTPException(status_code=404, detail="User not found")

    # Persist override for future searches
    if int(search_minutes) <= 0:
        await db.users.update_one({"id": attacker["id"]}, {"$unset": {"search_minutes_override": ""}})
        return {"message": f"Cleared {target_username}'s search time override (back to default)"}

    await db.users.update_one({"id": attacker["id"]}, {"$set": {"search_minutes_override": int(search_minutes)}})

    # Also apply to any currently searching attacks for that user
    new_found_time = datetime.now(timezone.utc) + timedelta(minutes=int(search_minutes))
    await db.attacks.update_many(
        {"attacker_id": attacker["id"], "status": "searching"},
        {"$set": {"found_at": new_found_time.isoformat()}}
    )

    return {"message": f"Set {target_username}'s search time to {search_minutes} minutes (persistent)"}


@api_router.post("/admin/set-all-search-time")
async def admin_set_all_search_time(search_minutes: int = 5, current_user: dict = Depends(get_current_user)):
    """Set every user's search timer to the given minutes (e.g. 5). Affects all future searches and any currently searching."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    if search_minutes <= 0:
        raise HTTPException(status_code=400, detail="search_minutes must be positive")
    res = await db.users.update_many(
        {},
        {"$set": {"search_minutes_override": int(search_minutes)}}
    )
    await db.game_config.update_one(
        {"id": "main"},
        {"$set": {"default_search_minutes": int(search_minutes)}},
        upsert=True
    )
    new_found_time = datetime.now(timezone.utc) + timedelta(minutes=int(search_minutes))
    await db.attacks.update_many(
        {"status": "searching"},
        {"$set": {"found_at": new_found_time.isoformat()}}
    )
    return {"message": f"Set all users' search time to {search_minutes} minutes, persistent for everyone including new users ({res.modified_count} users updated)"}


@api_router.post("/admin/clear-all-searches")
async def admin_clear_all_searches(current_user: dict = Depends(get_current_user)):
    """Delete all attack/search documents from db.attacks. Admin only."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    res = await db.attacks.delete_many({})
    return {"message": f"Cleared all searches ({res.deleted_count} deleted)"}


@api_router.get("/admin/check")
async def admin_check(current_user: dict = Depends(get_current_user)):
    is_admin = _is_admin(current_user)
    has_admin_email = (current_user.get("email") or "") in ADMIN_EMAILS
    return {"is_admin": is_admin, "has_admin_email": has_admin_email}


@api_router.get("/admin/activity-log")
async def admin_activity_log(
    limit: int = 100,
    username: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Recent user activity (crimes, forum topics/comments) for monitoring. Admin only."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    limit = min(max(1, limit), 500)
    query = {}
    if username and username.strip():
        uname_pattern = re.compile("^" + re.escape(username.strip()) + "$", re.IGNORECASE)
        query["username"] = uname_pattern
    cursor = db.activity_log.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
    entries = await cursor.to_list(limit)
    return {"entries": entries, "count": len(entries)}


@api_router.get("/admin/gambling-log")
async def admin_gambling_log(
    limit: int = 100,
    username: Optional[str] = None,
    game_type: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Recent gambling activity (dice, blackjack, sports) for anti-cheat. Admin only."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    limit = min(max(1, limit), 500)
    query = {}
    if username and username.strip():
        uname_pattern = re.compile("^" + re.escape(username.strip()) + "$", re.IGNORECASE)
        query["username"] = uname_pattern
    if game_type and game_type.strip():
        query["game_type"] = game_type.strip().lower()
    cursor = db.gambling_log.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
    entries = await cursor.to_list(limit)
    return {"entries": entries, "count": len(entries)}


@api_router.post("/admin/gambling-log/clear")
async def admin_gambling_log_clear(
    days: int = 30,
    current_user: dict = Depends(get_current_user),
):
    """Delete gambling log entries older than the given days. Admin only."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    if days < 1:
        days = 1
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    res = await db.gambling_log.delete_many({"created_at": {"$lt": cutoff}})
    return {"message": f"Cleared {res.deleted_count} gambling log entries older than {days} days", "deleted_count": res.deleted_count}


@api_router.get("/admin/find-duplicates")
async def admin_find_duplicates(username: str = None, current_user: dict = Depends(get_current_user)):
    """Find duplicate or similar usernames in the database. If username provided, search for that; otherwise find all duplicates."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if username:
        # Find users with exact or similar username (case-insensitive)
        pattern = re.compile(f".*{re.escape(username)}.*", re.IGNORECASE)
        users = await db.users.find(
            {"username": pattern},
            {"_id": 0, "id": 1, "username": 1, "email": 1, "total_kills": 1, "money": 1, "rank_points": 1, "current_state": 1, "created_at": 1, "is_dead": 1}
        ).to_list(50)
        return {"query": username, "count": len(users), "users": users}
    
    # Find all usernames that appear more than once (case-insensitive)
    pipeline = [
        {"$group": {"_id": {"$toLower": "$username"}, "count": {"$sum": 1}, "users": {"$push": {"id": "$id", "username": "$username", "email": "$email", "total_kills": "$total_kills", "money": "$money", "created_at": "$created_at"}}}},
        {"$match": {"count": {"$gt": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 20}
    ]
    duplicates = await db.users.aggregate(pipeline).to_list(20)
    return {"duplicates": duplicates}


@api_router.get("/admin/cheat-detection/same-ip")
async def admin_cheat_same_ip(current_user: dict = Depends(get_current_user)):
    """Find accounts that share an IP (registration or login). Admin only."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    users = await db.users.find(
        {"is_dead": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "email": 1, "registration_ip": 1, "login_ips": 1, "last_login_ip": 1, "created_at": 1},
    ).to_list(5000)
    ip_to_users = {}
    for u in users:
        summary = {"id": u["id"], "username": u.get("username"), "email": u.get("email"), "created_at": u.get("created_at")}
        reg_ip = (u.get("registration_ip") or "").strip()
        if reg_ip:
            ip_to_users.setdefault(reg_ip, []).append({**summary, "source": "registration"})
        for lip in (u.get("login_ips") or []):
            lip = (lip or "").strip()
            if lip and lip != reg_ip:
                ip_to_users.setdefault(lip, []).append({**summary, "source": "login"})
    groups = [{"ip": ip, "count": len(accs), "accounts": accs} for ip, accs in ip_to_users.items() if len(accs) >= 2]
    groups.sort(key=lambda g: -g["count"])
    return {"groups": groups[:100], "total_groups": len(groups)}


@api_router.get("/admin/cheat-detection/duplicate-suspects")
async def admin_cheat_duplicate_suspects(
    username: str = Query(None, description="Optional: filter by username contains"),
    current_user: dict = Depends(get_current_user),
):
    """Find potential duplicate accounts: similar usernames, same email domain. Admin only."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    query = {"is_dead": {"$ne": True}}
    if username and username.strip():
        query["username"] = re.compile(re.escape(username.strip()), re.IGNORECASE)
    users = await db.users.find(
        query,
        {"_id": 0, "id": 1, "username": 1, "email": 1, "registration_ip": 1, "created_at": 1},
    ).to_list(2000)
    # Group by email domain (e.g. gmail.com) - multiple accounts same domain can be suspicious
    domain_to_users = {}
    for u in users:
        email = (u.get("email") or "").strip()
        if "@" in email:
            domain = email.split("@")[-1].lower()
            domain_to_users.setdefault(domain, []).append(u)
    domain_groups = [{"domain": d, "count": len(accs), "accounts": accs} for d, accs in domain_to_users.items() if len(accs) >= 2]
    domain_groups.sort(key=lambda g: -g["count"])
    # Similar usernames: strip digits, group by base
    base_to_users = {}
    for u in users:
        uname = (u.get("username") or "").strip()
        base = re.sub(r"\d+", "", uname).lower() or uname.lower()
        if len(base) >= 2:
            base_to_users.setdefault(base, []).append(u)
    name_groups = [{"base": b, "count": len(accs), "accounts": accs} for b, accs in base_to_users.items() if len(accs) >= 2]
    name_groups.sort(key=lambda g: -g["count"])
    return {
        "by_domain": domain_groups[:50],
        "by_similar_username": name_groups[:50],
    }


@api_router.get("/admin/user-details/{user_id}")
async def admin_user_details(user_id: str, current_user: dict = Depends(get_current_user)):
    """Get full details of a user by ID."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Also get their dice ownership
    dice_owned = await db.dice_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(10)
    return {"user": user, "dice_owned": dice_owned}


class WipeConfirmation(BaseModel):
    confirmation_text: str  # Must be exactly "WIPE ALL DATA"

@api_router.post("/admin/wipe-all-users")
async def admin_wipe_all_users(confirm: WipeConfirmation, current_user: dict = Depends(get_current_user)):
    """DANGEROUS: Delete ALL users and related data from the game. Admin only. Requires confirmation."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # SAFETY: Require exact confirmation text to prevent accidental wipes
    if confirm.confirmation_text != "WIPE ALL DATA":
        raise HTTPException(
            status_code=400, 
            detail='Confirmation required. Send {"confirmation_text": "WIPE ALL DATA"} to confirm database wipe.'
        )
    
    # Log the wipe action
    logging.warning(f"🚨 DATABASE WIPE initiated by {current_user['email']} ({current_user['username']})")
    
    deleted = {}
    
    # Delete all user-related collections
    deleted["users"] = (await db.users.delete_many({})).deleted_count
    deleted["family_members"] = (await db.family_members.delete_many({})).deleted_count
    deleted["families"] = (await db.families.delete_many({})).deleted_count
    deleted["family_wars"] = (await db.family_wars.delete_many({})).deleted_count
    deleted["family_war_stats"] = (await db.family_war_stats.delete_many({})).deleted_count
    deleted["family_racket_attacks"] = (await db.family_racket_attacks.delete_many({})).deleted_count
    deleted["bodyguards"] = (await db.bodyguards.delete_many({})).deleted_count
    deleted["bodyguard_invites"] = (await db.bodyguard_invites.delete_many({})).deleted_count
    deleted["user_cars"] = (await db.user_cars.delete_many({})).deleted_count
    deleted["user_properties"] = (await db.user_properties.delete_many({})).deleted_count
    deleted["user_weapons"] = (await db.user_weapons.delete_many({})).deleted_count
    deleted["attacks"] = (await db.attacks.delete_many({})).deleted_count
    deleted["notifications"] = (await db.notifications.delete_many({})).deleted_count
    deleted["extortions"] = (await db.extortions.delete_many({})).deleted_count
    deleted["sports_bets"] = (await db.sports_bets.delete_many({})).deleted_count
    deleted["blackjack_games"] = (await db.blackjack_games.delete_many({})).deleted_count
    deleted["dice_ownership"] = (await db.dice_ownership.delete_many({})).deleted_count
    deleted["dice_buy_back_offers"] = (await db.dice_buy_back_offers.delete_many({})).deleted_count
    deleted["interest_deposits"] = (await db.interest_deposits.delete_many({})).deleted_count
    deleted["password_resets"] = (await db.password_resets.delete_many({})).deleted_count
    deleted["money_transfers"] = (await db.money_transfers.delete_many({})).deleted_count
    deleted["bank_deposits"] = (await db.bank_deposits.delete_many({})).deleted_count
    
    total = sum(deleted.values())
    logging.warning(f"🚨 DATABASE WIPE completed by {current_user['email']}: {total} documents deleted")
    return {"message": f"⚠️ DATABASE WIPED: {total} documents deleted from the game", "details": deleted}


@api_router.post("/admin/delete-user/{user_id}")
async def admin_delete_single_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a single user and all their related data. Admin only."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    deleted = {}
    username = user.get("username", "?")
    
    # Delete user and all related data
    deleted["user"] = (await db.users.delete_one({"id": user_id})).deleted_count
    deleted["family_members"] = (await db.family_members.delete_many({"user_id": user_id})).deleted_count
    deleted["bodyguards"] = (await db.bodyguards.delete_many({"$or": [{"user_id": user_id}, {"bodyguard_user_id": user_id}]})).deleted_count
    deleted["bodyguard_invites"] = (await db.bodyguard_invites.delete_many({"$or": [{"from_user_id": user_id}, {"to_user_id": user_id}]})).deleted_count
    deleted["user_cars"] = (await db.user_cars.delete_many({"user_id": user_id})).deleted_count
    deleted["user_properties"] = (await db.user_properties.delete_many({"user_id": user_id})).deleted_count
    deleted["user_weapons"] = (await db.user_weapons.delete_many({"user_id": user_id})).deleted_count
    deleted["attacks"] = (await db.attacks.delete_many({"$or": [{"attacker_id": user_id}, {"target_id": user_id}]})).deleted_count
    deleted["notifications"] = (await db.notifications.delete_many({"user_id": user_id})).deleted_count
    deleted["extortions"] = (await db.extortions.delete_many({"$or": [{"extorter_id": user_id}, {"target_id": user_id}]})).deleted_count
    deleted["sports_bets"] = (await db.sports_bets.delete_many({"user_id": user_id})).deleted_count
    deleted["blackjack_games"] = (await db.blackjack_games.delete_many({"user_id": user_id})).deleted_count
    deleted["dice_ownership"] = (await db.dice_ownership.update_many({"owner_id": user_id}, {"$set": {"owner_id": None, "owner_username": None}})).modified_count
    deleted["dice_buy_back_offers"] = (await db.dice_buy_back_offers.delete_many({"$or": [{"from_owner_id": user_id}, {"to_user_id": user_id}]})).deleted_count
    deleted["interest_deposits"] = (await db.interest_deposits.delete_many({"user_id": user_id})).deleted_count
    deleted["family_war_stats"] = (await db.family_war_stats.delete_many({"user_id": user_id})).deleted_count
    
    total = sum(deleted.values())
    return {"message": f"Deleted user '{username}' and {total} related documents", "details": deleted}


@api_router.get("/admin/events")
async def admin_get_events(current_user: dict = Depends(get_current_user)):
    """Get current events-enabled flag and all-events-for-testing (admin)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    enabled = await get_events_enabled()
    all_for_testing = await get_all_events_for_testing()
    today_event = get_combined_event() if all_for_testing else (get_active_game_event() if enabled else None)
    return {"events_enabled": enabled, "all_events_for_testing": all_for_testing, "today_event": today_event}


@api_router.post("/admin/events/toggle")
async def admin_toggle_events(request: EventsToggleRequest, current_user: dict = Depends(get_current_user)):
    """Enable or disable daily game events (admin)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    enabled = request.enabled
    await db.game_config.update_one(
        {"id": "main"},
        {"$set": {"events_enabled": bool(enabled)}},
        upsert=True,
    )
    return {"message": "Daily events " + ("enabled" if enabled else "disabled"), "events_enabled": bool(enabled)}


@api_router.post("/admin/events/all-for-testing")
async def admin_all_events_for_testing(request: AllEventsForTestingRequest, current_user: dict = Depends(get_current_user)):
    """Enable or disable 'all events at once' for testing (admin). When on, all event multipliers are combined."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    enabled = request.enabled
    await db.game_config.update_one(
        {"id": "main"},
        {"$set": {"all_events_for_testing": bool(enabled)}},
        upsert=True,
    )
    return {"message": "All events for testing " + ("enabled" if enabled else "disabled"), "all_events_for_testing": bool(enabled)}


SEED_FAMILIES_CONFIG = [
    {"name": "Corleone", "tag": "CORL", "members": ["boss", "underboss", "consigliere", "capo", "soldier"]},
    {"name": "Baranco", "tag": "BARN", "members": ["boss", "underboss", "consigliere", "capo", "soldier"]},
    {"name": "Stracci", "tag": "STRC", "members": ["boss", "underboss", "consigliere", "capo", "soldier"]},
]
# rank_points by role so seeded users have different ranks (boss highest -> soldier lowest)
# Scaled to match RANKS required_points (ranking up 20x harder)
SEED_RANK_POINTS_BY_ROLE = {"boss": 24000, "underboss": 12000, "consigliere": 6000, "capo": 3000, "soldier": 1000}
# racket levels per family (name -> {racket_id: level}). All at least 1 so they can collect.
SEED_RACKETS_BY_FAMILY = {
    "Corleone": {"protection": 2, "gambling": 1, "loansharking": 1, "labour": 1},
    "Baranco": {"protection": 1, "gambling": 2, "loansharking": 1, "labour": 1},
    "Stracci": {"protection": 1, "gambling": 1, "loansharking": 1, "labour": 2},
}
SEED_TREASURY = 75_000  # starting treasury per family
SEED_TEST_PASSWORD = "test1234"


@api_router.post("/admin/seed-families")
async def admin_seed_families(current_user: dict = Depends(get_current_user)):
    """Create 3 families with 5 members each (15 test users). Password for all: test1234."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    password_hash = get_password_hash(SEED_TEST_PASSWORD)
    now = datetime.now(timezone.utc).isoformat()
    created_users = []
    created_families = []
    for fam_cfg in SEED_FAMILIES_CONFIG:
        name, tag = fam_cfg["name"], fam_cfg["tag"]
        existing = await db.families.find_one({"$or": [{"name": name}, {"tag": tag}]})
        if existing:
            # Remove existing seed family so we can re-seed after a wipe
            family_id_old = existing["id"]
            members = await db.family_members.find({"family_id": family_id_old}, {"_id": 0, "user_id": 1}).to_list(100)
            user_ids_old = [m["user_id"] for m in members]
            if user_ids_old:
                await db.bodyguards.delete_many({"user_id": {"$in": user_ids_old}})
                await db.users.delete_many({"is_bodyguard": True, "bodyguard_owner_id": {"$in": user_ids_old}})
            await db.family_members.delete_many({"family_id": family_id_old})
            if user_ids_old:
                await db.users.delete_many({"id": {"$in": user_ids_old}})
            await db.families.delete_one({"id": family_id_old})
        family_id = str(uuid.uuid4())
        user_ids = []
        for i, role in enumerate(fam_cfg["members"]):
            user_id = str(uuid.uuid4())
            base = f"{tag.lower()}_{role}"
            username = f"{base}_{i}"
            email = f"{base}{i}@test.mafia"
            if await db.users.find_one({"$or": [{"email": email}, {"username": username}]}):
                continue
            rank_points = SEED_RANK_POINTS_BY_ROLE.get(role, 0)
            rank_id, _ = get_rank_info(rank_points)
            user_doc = {
                "id": user_id,
                "email": email,
                "username": username,
                "password_hash": password_hash,
                "rank": rank_id,
                "money": 1000.0,
                "points": 0,
                "rank_points": rank_points,
                "bodyguard_slots": 2,
                "bullets": 0,
                "avatar_url": None,
                "jail_busts": 0,
                "jail_bust_attempts": 0,
                "garage_batch_limit": DEFAULT_GARAGE_BATCH_LIMIT,
                "total_crimes": 0,
                "crime_profit": 0,
                "total_gta": 0,
                "total_oc_heists": 0,
                "oc_timer_reduced": False,
                "current_state": "Chicago",
                "swiss_balance": 0,
                "swiss_limit": SWISS_BANK_LIMIT_START,
                "total_kills": 0,
                "total_deaths": 0,
                "in_jail": False,
                "jail_until": None,
                "premium_rank_bar": False,
                "custom_car_name": None,
                "travels_this_hour": 0,
                "travel_reset_time": now,
                "extra_airmiles": 0,
                "health": DEFAULT_HEALTH,
                "armour_level": 0,
                "armour_owned_level_max": 0,
                "equipped_weapon_id": None,
                "kill_inflation": 0.0,
                "kill_inflation_updated_at": now,
                "is_dead": False,
                "dead_at": None,
                "points_at_death": None,
                "retrieval_used": False,
                "last_seen": now,
                "created_at": now,
            }
            await db.users.insert_one(user_doc)
            created_users.append({"username": username, "email": email, "role": role, "family": name})
            user_ids.append((user_id, role, username))
        boss_id = user_ids[0][0] if user_ids else None
        if not boss_id:
            continue
        # Progression: only first racket unlocked; others must be unlocked after previous is maxed
        first_racket_id = FAMILY_RACKETS[0]["id"]
        rackets = {first_racket_id: {"level": 1, "last_collected_at": None}}
        await db.families.insert_one({
            "id": family_id,
            "name": name,
            "tag": tag,
            "boss_id": boss_id,
            "treasury": SEED_TREASURY,
            "created_at": now,
            "rackets": rackets,
        })
        created_families.append({"name": name, "tag": tag})
        for user_id, role, _ in user_ids:
            await db.family_members.insert_one({
                "id": str(uuid.uuid4()),
                "family_id": family_id,
                "user_id": user_id,
                "role": role,
                "joined_at": now,
            })
            await db.users.update_one(
                {"id": user_id},
                {"$set": {"family_id": family_id, "family_role": role}},
            )
        # Give each member 2 robot bodyguards
        for user_id, role, owner_username in user_ids:
            owner = {"id": user_id, "current_state": "Chicago"}
            for slot in range(1, 3):
                try:
                    robot_user_id, robot_username = await _create_robot_bodyguard_user(owner)
                    await db.bodyguards.insert_one({
                        "id": str(uuid.uuid4()),
                        "user_id": user_id,
                        "owner_username": owner_username,
                        "slot_number": slot,
                        "is_robot": True,
                        "robot_name": robot_username,
                        "bodyguard_user_id": robot_user_id,
                        "health": 100,
                        "armour_level": 0,
                        "hired_at": now,
                    })
                except Exception as e:
                    logging.exception("Seed bodyguard for %s slot %s: %s", user_id, slot, e)
    return {
        "message": f"Seeded {len(created_families)} families with {len(created_users)} users (each with 2 robot bodyguards). Password for all: test1234",
        "families": created_families,
        "users": created_users,
    }

@api_router.get("/events/active")
async def get_active_event(current_user: dict = Depends(get_current_user)):
    """Current game-wide daily event when enabled; otherwise null. Frontend uses for prices and banners. When all-events-for-testing is on, returns combined event."""
    enabled = await get_events_enabled()
    event = await get_effective_event() if enabled else None
    return {"event": event, "events_enabled": enabled}


# Flash news: wars, booze prices, daily game event.
@api_router.get("/news/flash")
async def get_flash_news(current_user: dict = Depends(get_current_user)):
    """Recent flash news: wars, booze price changes, etc. For the top-bar ticker."""
    now = datetime.now(timezone.utc)
    now_ts = now.timestamp()
    items = []

    # Daily game event (only when enabled)
    try:
        ev = await get_effective_event()
        if ev.get("id") != "none":
            event_start_iso = datetime.now(timezone.utc).date().isoformat()
            items.append({
                "id": f"event_{ev.get('id', '')}_{event_start_iso}",
                "type": "game_event",
                "message": ev.get("message") or f"Today: {ev.get('name', 'Event')}",
                "at": event_start_iso + "T00:00:00+00:00",
            })
    except Exception:
        pass

    # Booze run: prices rotate every rotation interval. Show "Booze prices just changed!" for the first part of each rotation.
    try:
        interval = get_booze_rotation_interval_seconds()
        rotation_index = get_booze_rotation_index()
        rotation_start_ts = rotation_index * interval
        rotation_start_iso = datetime.fromtimestamp(rotation_start_ts, tz=timezone.utc).isoformat()
        if now_ts - rotation_start_ts < interval:  # within current rotation window
            items.append({
                "id": f"booze_rotation_{rotation_index}",
                "type": "booze_prices",
                "message": "Booze prices just changed! Check Booze Run for new rates.",
                "at": rotation_start_iso,
            })
    except Exception:
        pass

    # Family wars: started and ended
    wars = await db.family_wars.find({}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
    family_ids = set()
    for w in wars:
        family_ids.add(w.get("family_a_id"))
        family_ids.add(w.get("family_b_id"))
    families = await db.families.find({"id": {"$in": list(family_ids)}}, {"_id": 0, "id": 1, "name": 1, "tag": 1}).to_list(50)
    family_map = {f["id"]: f for f in families}
    for w in wars:
        fa = family_map.get(w.get("family_a_id"), {})
        fb = family_map.get(w.get("family_b_id"), {})
        a_name = fa.get("name") or "?"
        b_name = fb.get("name") or "?"
        status = w.get("status")
        ended_at = w.get("ended_at")
        created_at = w.get("created_at") or ""
        if status in ("active", "truce_offered"):
            items.append({
                "id": w.get("id"),
                "type": "war_started",
                "message": f"War: {a_name} vs {b_name}",
                "at": created_at,
            })
        elif ended_at:
            winner_id = w.get("winner_family_id")
            loser_id = w.get("loser_family_id")
            if status == "truce":
                items.append({
                    "id": w.get("id") + "_truce",
                    "type": "war_ended",
                    "message": f"War ended: {a_name} vs {b_name} — truce",
                    "at": ended_at,
                })
            elif winner_id and loser_id:
                winner = family_map.get(winner_id, {})
                loser = family_map.get(loser_id, {})
                wn = winner.get("name") or "?"
                ln = loser.get("name") or "?"
                items.append({
                    "id": w.get("id") + "_end",
                    "type": "war_ended",
                    "message": f"War ended: {wn} defeated {ln}",
                    "at": ended_at,
                })
            else:
                items.append({
                    "id": w.get("id") + "_end",
                    "type": "war_ended",
                    "message": f"War ended: {a_name} vs {b_name}",
                    "at": ended_at,
                })
    # Sort by at desc (most recent first), take 10
    items.sort(key=lambda x: x["at"], reverse=True)
    return {"items": items[:10]}




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


# Payment endpoints (Stripe/emergent removed; routes kept so frontend does not 404)
@api_router.post("/payments/checkout")
async def create_checkout(request: CheckoutRequest, current_user: dict = Depends(get_current_user)):
    raise HTTPException(status_code=503, detail="Payments not available")

@api_router.get("/payments/status/{session_id}")
async def get_payment_status(session_id: str, current_user: dict = Depends(get_current_user)):
    transaction = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if transaction["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Unauthorized")
    if transaction["payment_status"] == "completed":
        return {"status": "completed", "payment_status": "paid", "points_added": transaction["points"]}
    return {"status": "pending", "payment_status": "unknown"}

@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    raise HTTPException(status_code=503, detail="Payments not available")

@api_router.get("/giphy/search")
async def giphy_search(
    q: str = Query(..., min_length=1, max_length=50),
    current_user: dict = Depends(get_current_user),
):
    """Proxy Giphy GIF search. API key is read from backend .env (GIPHY_API_KEY)."""
    api_key = (os.environ.get("GIPHY_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Giphy not configured. Add GIPHY_API_KEY to backend/.env and restart the backend.",
        )
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            "https://api.giphy.com/v1/gifs/search",
            params={
                "api_key": api_key,
                "q": q,
                "limit": 20,
                "rating": "pg-13",
            },
        )
    data = resp.json()
    if data.get("meta", {}).get("status") != 200:
        raise HTTPException(
            status_code=502,
            detail=data.get("meta", {}).get("msg") or "Giphy error",
        )
    return {"data": data.get("data") or []}


# ============ TRAVEL ENDPOINTS ============
# STATES defined at top of file; do not redefine here

# Casino games and max bets (same in every city; exposed for States page). CASINO_GAMES defined after router imports (needs DICE_MAX_BET from routers.dice).

@api_router.get("/states")
async def get_states(current_user: dict = Depends(get_current_user)):
    """List all cities (travel destinations), casino games with max bet, and casino owners per city."""
    # Fetch all casino ownerships
    dice_docs = await db.dice_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1}).to_list(20)
    rlt_docs = await db.roulette_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1}).to_list(20)
    blackjack_docs = await db.blackjack_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1}).to_list(20)
    horseracing_docs = await db.horseracing_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1}).to_list(20)
    
    # Collect all unique owner IDs
    all_docs = dice_docs + rlt_docs + blackjack_docs + horseracing_docs
    owner_ids = list({d["owner_id"] for d in all_docs if d.get("owner_id")})
    users = await db.users.find({"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "username": 1, "money": 1}).to_list(len(owner_ids) or 1)
    user_map = {u["id"]: u for u in users}
    
    # Build ownership maps
    dice_owners = {}
    roulette_owners = {}
    blackjack_owners = {}
    horseracing_owners = {}
    
    for d in dice_docs:
        if not d.get("owner_id"):
            continue
        u = user_map.get(d["owner_id"], {})
        money = int((u.get("money") or 0) or 0)
        _, wealth_rank_name = get_wealth_rank(money)
        dice_max = d.get("max_bet") if d.get("max_bet") is not None else DICE_MAX_BET
        dice_owners[d["city"]] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "max_bet": dice_max, "buy_back_reward": d.get("buy_back_reward")}
    
    for d in rlt_docs:
        if not d.get("owner_id"):
            continue
        u = user_map.get(d["owner_id"], {})
        money = int((u.get("money") or 0) or 0)
        _, wealth_rank_name = get_wealth_rank(money)
        rlt_max = d.get("max_bet") if d.get("max_bet") is not None else ROULETTE_MAX_BET
        roulette_owners[d["city"]] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "max_bet": rlt_max}
    
    for d in blackjack_docs:
        if not d.get("owner_id"):
            continue
        u = user_map.get(d["owner_id"], {})
        money = int((u.get("money") or 0) or 0)
        _, wealth_rank_name = get_wealth_rank(money)
        bj_max = d.get("max_bet") if d.get("max_bet") is not None else BLACKJACK_MAX_BET
        blackjack_owners[d["city"]] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "max_bet": bj_max, "buy_back_reward": d.get("buy_back_reward")}
    
    for d in horseracing_docs:
        if not d.get("owner_id"):
            continue
        u = user_map.get(d["owner_id"], {})
        money = int((u.get("money") or 0) or 0)
        _, wealth_rank_name = get_wealth_rank(money)
        hr_max = d.get("max_bet") if d.get("max_bet") is not None else HORSERACING_MAX_BET
        horseracing_owners[d["city"]] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "max_bet": hr_max}
    
    return {
        "cities": list(STATES), 
        "games": CASINO_GAMES, 
        "dice_owners": dice_owners,
        "roulette_owners": roulette_owners,
        "blackjack_owners": blackjack_owners,
        "horseracing_owners": horseracing_owners
    }


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


@api_router.get("/my-properties")
async def get_my_properties(current_user: dict = Depends(get_current_user)):
    """Return current user's one casino (if any) and one property (if any). Rule: max 1 casino, max 1 property."""
    user_id = current_user["id"]
    casino = await _user_owns_any_casino(user_id)
    property_ = await _user_owns_any_property(user_id)
    return {"casino": casino, "property": property_}


# Crime endpoints -> see routers/crimes.py
# Register modular routers (crimes, gta, jail, attack, etc.)
from routers import crimes, gta, jail, oc, organised_crime, forum, entertainer, bullet_factory, objectives, attack, bank, families, weapons, bodyguards, airport, quicktrade, booze_run, dice, roulette, blackjack, horseracing, notifications, hitlist, properties, store, racket, leaderboard, armour, meta
from routers.objectives import update_objectives_progress  # re-export for server.py callers (e.g. booze sell)
from routers.families import FAMILY_RACKETS  # used by _family_war_check_wipe_and_award and seed
from routers.bodyguards import _create_robot_bodyguard_user  # used by seed
from routers.booze_run import get_booze_rotation_interval_seconds, get_booze_rotation_index  # flash news
CASINO_GAMES = [
    {"id": "blackjack", "name": "Blackjack", "max_bet": BLACKJACK_MAX_BET},
    {"id": "horseracing", "name": "Horse Racing", "max_bet": HORSERACING_MAX_BET},
    {"id": "roulette", "name": "Roulette", "max_bet": ROULETTE_MAX_BET},
    {"id": "dice", "name": "Dice", "max_bet": DICE_MAX_BET},
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
notifications.register(api_router)
hitlist.register(api_router)
properties.register(api_router)
store.register(api_router)
racket.register(api_router)
leaderboard.register(api_router)
armour.register(api_router)
meta.register(api_router)

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
