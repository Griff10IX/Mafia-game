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

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

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


@app.get("/")
def root():
    """Root route so the service URL returns something instead of 404."""
    return {"message": "Mafia API", "docs": "/docs", "api": "/api"}


# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Constants
STATES = ["Chicago", "New York", "Las Vegas", "Atlantic City"]
RANKS = [
    {"id": 1, "name": "Street Thug", "required_money": 0, "required_points": 0},
    {"id": 2, "name": "Hustler", "required_money": 10000, "required_points": 50},
    {"id": 3, "name": "Goon", "required_money": 50000, "required_points": 150},
    {"id": 4, "name": "Made Man", "required_money": 200000, "required_points": 300},
    {"id": 5, "name": "Capo", "required_money": 500000, "required_points": 600},
    {"id": 6, "name": "Underboss", "required_money": 1000000, "required_points": 1200},
    {"id": 7, "name": "Consigliere", "required_money": 2500000, "required_points": 2500},
    {"id": 8, "name": "Boss", "required_money": 5000000, "required_points": 5000},
    {"id": 9, "name": "Don", "required_money": 10000000, "required_points": 10000},
    {"id": 10, "name": "Godfather", "required_money": 25000000, "required_points": 20000},
    {"id": 11, "name": "The Commission", "required_money": 50000000, "required_points": 50000}
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

BODYGUARD_SLOT_COSTS = [100, 200, 300, 400]

# Bodyguard armour upgrades (points). armour_level: 0..5
BODYGUARD_ARMOUR_UPGRADE_COSTS = {0: 50, 1: 100, 2: 200, 3: 400, 4: 800}

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

# Dice game (casino): sides 2–1000, chosen 1–sides, house edge 5% so multiplier = sides * 0.95
DICE_SIDES_MIN = 2
DICE_SIDES_MAX = 1000
DICE_HOUSE_EDGE = 0.05  # 5% house edge
DICE_MAX_BET = 5_000_000

# Roulette (European, single 0). Red pockets per standard layout.
ROULETTE_RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
ROULETTE_MAX_BET = 50_000_000

# Blackjack (game state in db.blackjack_games so it works across workers)
BLACKJACK_MAX_BET = 50_000_000

# Horse Racing: id, name, odds (e.g. 2 = 2:1 payout). Lower odds = favourite, higher win probability.
HORSERACING_MAX_BET = 10_000_000
HORSERACING_HOUSE_EDGE = 0.05
HORSERACING_HORSES = [
    {"id": 1, "name": "Thunder Bolt", "odds": 2},
    {"id": 2, "name": "Midnight Runner", "odds": 3},
    {"id": 3, "name": "Golden Star", "odds": 4},
    {"id": 4, "name": "Shadow Fox", "odds": 5},
    {"id": 5, "name": "Storm Chaser", "odds": 6},
    {"id": 6, "name": "Dark Horse", "odds": 8},
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

# GTA Options and Cars - Cooldowns: min 30s (easiest), best option 3-4 min (legendary). Unlock by rank.
GTA_OPTIONS = [
    {"id": "easy", "name": "Street Parking", "success_rate": 0.85, "jail_time": 10, "difficulty": 1, "cooldown": 30, "min_rank": 3},
    {"id": "medium", "name": "Residential Area", "success_rate": 0.65, "jail_time": 20, "difficulty": 2, "cooldown": 90, "min_rank": 4},
    {"id": "hard", "name": "Downtown District", "success_rate": 0.45, "jail_time": 35, "difficulty": 3, "cooldown": 150, "min_rank": 5},
    {"id": "expert", "name": "Luxury Garage", "success_rate": 0.30, "jail_time": 50, "difficulty": 4, "cooldown": 210, "min_rank": 6},
    {"id": "legendary", "name": "Private Estate", "success_rate": 0.18, "jail_time": 60, "difficulty": 5, "cooldown": 240, "min_rank": 7}
]

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

AIRPORT_COST = 10  # Points per airport travel
MAX_TRAVELS_PER_HOUR = 15
EXTRA_AIRMILES_COST = 25  # Points for 5 extra travels

CARS = [
    # Common (difficulty 1) - 6 cars
    {"id": "car1", "name": "Model T Ford", "rarity": "common", "min_difficulty": 1, "value": 500, "travel_bonus": 0, "image": None},
    {"id": "car2", "name": "Chevrolet Series AB", "rarity": "common", "min_difficulty": 1, "value": 600, "travel_bonus": 5, "image": "https://images.unsplash.com/photo-1563831816793-3d32d7cc07d3?auto=format&fit=crop&w=600&q=80"},
    {"id": "car3", "name": "Dodge Brothers", "rarity": "common", "min_difficulty": 1, "value": 700, "travel_bonus": 5, "image": "https://images.unsplash.com/photo-1577423704717-d48ffcb561e3?auto=format&fit=crop&w=600&q=80"},
    {"id": "car4", "name": "Ford Model A", "rarity": "common", "min_difficulty": 1, "value": 650, "travel_bonus": 5, "image": "https://images.unsplash.com/photo-1747401648939-41e148128f8b?auto=format&fit=crop&w=600&q=80"},
    {"id": "car5", "name": "Essex Coach", "rarity": "common", "min_difficulty": 1, "value": 550, "travel_bonus": 0, "image": None},
    {"id": "car6", "name": "Durant Star", "rarity": "common", "min_difficulty": 1, "value": 600, "travel_bonus": 5, "image": "https://images.unsplash.com/photo-1563831816793-3d32d7cc07d3?auto=format&fit=crop&w=600&q=80"},
    
    # Uncommon (difficulty 2) - 4 cars
    {"id": "car7", "name": "Oakland", "rarity": "uncommon", "min_difficulty": 2, "value": 1200, "travel_bonus": 10, "image": "https://images.unsplash.com/photo-1747401648939-41e148128f8b?auto=format&fit=crop&w=600&q=80"},
    {"id": "car8", "name": "Willys-Knight", "rarity": "uncommon", "min_difficulty": 2, "value": 1500, "travel_bonus": 10, "image": "https://images.unsplash.com/photo-1577423704717-d48ffcb561e3?auto=format&fit=crop&w=600&q=80"},
    {"id": "car9", "name": "Cadillac V-8", "rarity": "uncommon", "min_difficulty": 2, "value": 2000, "travel_bonus": 15, "image": "https://images.unsplash.com/photo-1563831816793-3d32d7cc07d3?auto=format&fit=crop&w=600&q=80"},
    {"id": "car10", "name": "Buick Master Six", "rarity": "uncommon", "min_difficulty": 2, "value": 1800, "travel_bonus": 12, "image": "https://images.unsplash.com/photo-1552072805-2a9039d00e57?auto=format&fit=crop&w=600&q=80"},
    
    # Rare (difficulty 3) - 4 cars
    {"id": "car11", "name": "Packard Eight", "rarity": "rare", "min_difficulty": 3, "value": 3500, "travel_bonus": 20, "image": "https://images.unsplash.com/photo-1577423704717-d48ffcb561e3?auto=format&fit=crop&w=600&q=80"},
    {"id": "car12", "name": "Lincoln Model L", "rarity": "rare", "min_difficulty": 3, "value": 4000, "travel_bonus": 20, "image": "https://images.unsplash.com/photo-1563831816793-3d32d7cc07d3?auto=format&fit=crop&w=600&q=80"},
    {"id": "car13", "name": "Pierce-Arrow", "rarity": "rare", "min_difficulty": 3, "value": 5000, "travel_bonus": 25, "image": "https://images.unsplash.com/photo-1747401648939-41e148128f8b?auto=format&fit=crop&w=600&q=80"},
    {"id": "car14", "name": "Stutz Bearcat", "rarity": "rare", "min_difficulty": 3, "value": 5500, "travel_bonus": 25, "image": "https://images.unsplash.com/photo-1552072805-2a9039d00e57?auto=format&fit=crop&w=600&q=80"},
    
    # Ultra Rare (difficulty 4) - 3 cars
    {"id": "car15", "name": "Duesenberg Model J", "rarity": "ultra_rare", "min_difficulty": 4, "value": 10000, "travel_bonus": 35, "image": "https://images.unsplash.com/photo-1563831816793-3d32d7cc07d3?auto=format&fit=crop&w=600&q=80"},
    {"id": "car16", "name": "Cord L-29", "rarity": "ultra_rare", "min_difficulty": 4, "value": 12000, "travel_bonus": 35, "image": "https://images.unsplash.com/photo-1577423704717-d48ffcb561e3?auto=format&fit=crop&w=600&q=80"},
    {"id": "car17", "name": "Auburn Speedster", "rarity": "ultra_rare", "min_difficulty": 4, "value": 15000, "travel_bonus": 40, "image": "https://images.unsplash.com/photo-1747401648939-41e148128f8b?auto=format&fit=crop&w=600&q=80"},
    
    # Legendary (difficulty 5) - 2 cars
    {"id": "car18", "name": "Bugatti Type 41 Royale", "rarity": "legendary", "min_difficulty": 5, "value": 25000, "travel_bonus": 50, "image": "https://images.unsplash.com/photo-1552072805-2a9039d00e57?auto=format&fit=crop&w=600&q=80"},
    {"id": "car19", "name": "Rolls-Royce Phantom II", "rarity": "legendary", "min_difficulty": 5, "value": 30000, "travel_bonus": 55, "image": "https://images.unsplash.com/photo-1563831816793-3d32d7cc07d3?auto=format&fit=crop&w=600&q=80"},
    
    # Custom (store only) - just below exclusive
    {"id": "car_custom", "name": "Custom Car", "rarity": "custom", "min_difficulty": 5, "value": 40000, "travel_bonus": 55, "image": None},

    # Exclusive (admin only)
    {"id": "car20", "name": "Al Capone's Armored Cadillac", "rarity": "exclusive", "min_difficulty": 5, "value": 50000, "travel_bonus": 60, "image": "https://images.unsplash.com/photo-1577423704717-d48ffcb561e3?auto=format&fit=crop&w=600&q=80"}
]

# Models
class UserRegister(BaseModel):
    email: EmailStr
    username: str
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

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
    custom_car_name: Optional[str]
    travels_this_hour: int
    extra_airmiles: int
    garage_batch_limit: int
    total_crimes: int
    crime_profit: int
    created_at: str
    swiss_balance: int = 0
    swiss_limit: int = SWISS_BANK_LIMIT_START

# Notification/Inbox models
class NotificationCreate(BaseModel):
    title: str
    message: str
    notification_type: str  # rank_up, reward, bodyguard, attack, system

class BodyguardInviteRequest(BaseModel):
    target_username: str
    payment_amount: int
    payment_type: str  # points or money
    duration_hours: int

class BodyguardHireRequest(BaseModel):
    slot: int
    is_robot: bool

class AdminBodyguardsGenerateRequest(BaseModel):
    target_username: str
    count: int = 1  # 1..4
    replace_existing: bool = True

class TravelRequest(BaseModel):
    destination: str
    travel_method: str  # car_id or "airport"

class CustomCarPurchase(BaseModel):
    car_name: str

class BoozeBuyRequest(BaseModel):
    booze_id: str
    amount: int

class BoozeSellRequest(BaseModel):
    booze_id: str
    amount: int

class NPCToggleRequest(BaseModel):
    enabled: bool
    count: int

class DeadAliveRetrieveRequest(BaseModel):
    dead_username: str
    dead_password: str

class AvatarUpdateRequest(BaseModel):
    avatar_data: str  # data URL: data:image/...;base64,...

class BankInterestDepositRequest(BaseModel):
    amount: int
    duration_hours: int

class BankDepositClaimRequest(BaseModel):
    deposit_id: str

class BankSwissMoveRequest(BaseModel):
    amount: int

class MoneyTransferRequest(BaseModel):
    to_username: str
    amount: int

class DiceBetRequest(BaseModel):
    stake: int
    sides: int  # 2..1000
    chosen_number: int  # 1..sides


class DiceClaimRequest(BaseModel):
    city: str


class DiceSetMaxBetRequest(BaseModel):
    city: str
    max_bet: int


class DiceSetBuyBackRequest(BaseModel):
    city: str
    amount: int


class DiceSendToUserRequest(BaseModel):
    city: str
    target_username: str


class DiceBuyBackActionRequest(BaseModel):
    offer_id: str


class RouletteBetItem(BaseModel):
    type: str  # straight, red, black, even, odd, low, high, dozen, column
    selection: Optional[Union[int, str]] = None  # number 0-36 for straight; 1|2|3 for dozen/column; "red"|"black" etc.
    amount: int


class RouletteSpinRequest(BaseModel):
    bets: list


class RouletteClaimRequest(BaseModel):
    city: str


class RouletteSetMaxBetRequest(BaseModel):
    city: str
    max_bet: int


class RouletteSendToUserRequest(BaseModel):
    city: str
    target_username: str


class HorseRacingBetRequest(BaseModel):
    horse_id: int
    bet: int


class BlackjackStartRequest(BaseModel):
    bet: int

    @field_validator("bet", mode="before")
    @classmethod
    def coerce_bet(cls, v):
        if v is None:
            return 0
        if isinstance(v, str):
            return int(v.strip() or 0)
        return int(v)


class CrimeResponse(BaseModel):
    id: str
    name: str
    description: str
    min_rank: int
    reward_min: int
    reward_max: int
    cooldown_minutes: float
    crime_type: str
    can_commit: bool
    next_available: Optional[str]

class CommitCrimeResponse(BaseModel):
    success: bool
    message: str
    reward: Optional[int]
    next_available: str

class WeaponResponse(BaseModel):
    id: str
    name: str
    description: str
    damage: int
    bullets_needed: int
    rank_required: int
    price_money: Optional[int]
    price_points: Optional[int]
    effective_price_money: Optional[int] = None
    effective_price_points: Optional[int] = None
    owned: bool
    quantity: int
    equipped: bool = False

class WeaponBuyRequest(BaseModel):
    currency: str  # "money" or "points"

class WeaponEquipRequest(BaseModel):
    weapon_id: str

class PropertyResponse(BaseModel):
    id: str
    name: str
    property_type: str
    price: int
    income_per_hour: int
    max_level: int
    owned: bool
    level: int
    available_income: float

class BodyguardResponse(BaseModel):
    slot_number: int
    is_robot: bool
    bodyguard_username: Optional[str]
    bodyguard_rank_name: Optional[str] = None
    armour_level: int = 0
    hired_at: Optional[str]

# ============ MAFIA FAMILIES (1920s-30s structure) ============
MAX_FAMILIES = 10
FAMILY_ROLES = ["boss", "underboss", "consigliere", "capo", "soldier", "associate"]
FAMILY_ROLE_LIMITS = {"boss": 1, "underboss": 1, "consigliere": 1, "capo": 4, "soldier": 15, "associate": 30}
FAMILY_ROLE_ORDER = {"boss": 0, "underboss": 1, "consigliere": 2, "capo": 3, "soldier": 4, "associate": 5}
# Rackets: 1920s-30s family businesses. Cooldown hours, base income per level.
FAMILY_RACKETS = [
    {"id": "protection", "name": "Protection Racket", "cooldown_hours": 6, "base_income": 5000, "description": "Extortion from businesses"},
    {"id": "gambling", "name": "Gambling Operation", "cooldown_hours": 12, "base_income": 8000, "description": "Numbers & bookmaking"},
    {"id": "loansharking", "name": "Loan Sharking", "cooldown_hours": 24, "base_income": 12000, "description": "High-interest loans"},
    {"id": "labour", "name": "Labour Racketeering", "cooldown_hours": 8, "base_income": 6000, "description": "Union kickbacks"},
    {"id": "distillery", "name": "Distillery", "cooldown_hours": 10, "base_income": 6500, "description": "Bootleg liquor production"},
    {"id": "warehouse", "name": "Warehouse", "cooldown_hours": 8, "base_income": 5000, "description": "Storage and distribution"},
    {"id": "restaurant_bar", "name": "Restaurant & Bar", "cooldown_hours": 6, "base_income": 5500, "description": "Front and steady income"},
    {"id": "funeral_home", "name": "Funeral Home", "cooldown_hours": 12, "base_income": 7000, "description": "Respectable front"},
    {"id": "garment_shop", "name": "Garment Shop", "cooldown_hours": 9, "base_income": 6000, "description": "Garment district operations"},
]
RACKET_UPGRADE_COST = 50_000
RACKET_MAX_LEVEL = 5
FAMILY_RACKET_ATTACK_BASE_SUCCESS = 0.70
FAMILY_RACKET_ATTACK_LEVEL_PENALTY = 0.10
FAMILY_RACKET_ATTACK_MIN_SUCCESS = 0.10
FAMILY_RACKET_ATTACK_REVENUE_PCT = 0.25
FAMILY_RACKET_ATTACK_COOLDOWN_HOURS = 2

class FamilyCreateRequest(BaseModel):
    name: str
    tag: str

class FamilyJoinRequest(BaseModel):
    family_id: str

class FamilyKickRequest(BaseModel):
    user_id: str

class FamilyRoleRequest(BaseModel):
    user_id: str
    role: str

class FamilyDepositRequest(BaseModel):
    amount: int

class FamilyWithdrawRequest(BaseModel):
    amount: int


class FamilyAttackRacketRequest(BaseModel):
    family_id: str
    racket_id: str


class SportsBetPlaceRequest(BaseModel):
    event_id: str
    option_id: str
    stake: int


class SportsBetCancelRequest(BaseModel):
    bet_id: str


class AttackSearchRequest(BaseModel):
    target_username: str
    note: Optional[str] = None

class AttackSearchResponse(BaseModel):
    attack_id: str
    status: str
    message: str
    estimated_completion: str

class AttackStatusResponse(BaseModel):
    attack_id: str
    status: str
    target_username: str
    location_state: Optional[str]
    can_travel: bool
    can_attack: bool
    message: str

class AttackIdRequest(BaseModel):
    attack_id: str

class AttackDeleteRequest(BaseModel):
    attack_ids: List[str]

class AttackExecuteRequest(BaseModel):
    attack_id: str
    death_message: Optional[str] = None
    make_public: bool = False
    bullets_to_use: Optional[int] = None

    @field_validator("bullets_to_use", mode="before")
    @classmethod
    def coerce_bullets_to_use(cls, v):
        """Treat empty, zero, or invalid as None so we use default (as many as needed)."""
        if v is None or v == "":
            return None
        if isinstance(v, (int, float)):
            return int(v) if v > 0 else None
        if isinstance(v, str):
            try:
                n = int(v)
                return n if n > 0 else None
            except (ValueError, TypeError):
                return None
        return None

class AttackExecuteResponse(BaseModel):
    success: bool
    message: str
    rewards: Optional[Dict]
    first_bodyguard: Optional[Dict] = None  # { display_name, search_username } when target has bodyguards


class WarTruceRequest(BaseModel):
    war_id: str


class DicePlayRequest(BaseModel):
    stake: int
    sides: int
    chosen_number: int


class DiceClaimRequest(BaseModel):
    city: str


class DiceSetMaxBetRequest(BaseModel):
    city: str
    max_bet: int


class DiceSetBuyBackRequest(BaseModel):
    city: str
    amount: int


class DiceBuyBackAcceptRequest(BaseModel):
    offer_id: str


class DiceBuyBackRejectRequest(BaseModel):
    offer_id: str


class DiceSendToUserRequest(BaseModel):
    city: str
    target_username: str


class EventsToggleRequest(BaseModel):
    enabled: bool

class AllEventsForTestingRequest(BaseModel):
    enabled: bool

class CheckoutRequest(BaseModel):
    package_id: str
    origin_url: str

class LeaderboardEntry(BaseModel):
    rank: int
    username: str
    money: float
    kills: int
    crimes: int
    gta: int
    jail_busts: int
    is_current_user: bool = False

class StatLeaderboardEntry(BaseModel):
    rank: int
    username: str
    value: int
    is_current_user: bool = False

class GTAAttemptRequest(BaseModel):
    option_id: str

class GTAMeltRequest(BaseModel):
    car_ids: List[str]
    action: str  # "bullets" or "cash"


class CustomCarImageUpdate(BaseModel):
    image_url: Optional[str] = None  # URL for picture; empty or null to clear


class GTAAttemptResponse(BaseModel):
    success: bool
    message: str
    car: Optional[Dict]
    jailed: bool
    jail_until: Optional[str]
    rank_points_earned: int

class ArmourBuyRequest(BaseModel):
    level: int  # 1-5

class BulletCalcRequest(BaseModel):
    target_username: str

class BustOutRequest(BaseModel):
    target_username: str

class ProtectionRacketRequest(BaseModel):
    target_username: str
    property_id: str

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
    return user

async def send_notification(user_id: str, title: str, message: str, notification_type: str):
    """Send a notification to user's inbox"""
    notification = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "title": title,
        "message": message,
        "notification_type": notification_type,
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.notifications.insert_one(notification)
    return notification


async def send_notification_to_family(family_id: str, title: str, message: str, notification_type: str):
    """Notify every member of a family."""
    members = await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(100)
    for m in members:
        await send_notification(m["user_id"], title, message, notification_type)


async def _family_war_start(family_a_id: str, family_b_id: str):
    """Start or ensure an active war between two families. Idempotent."""
    if not family_a_id or not family_b_id or family_a_id == family_b_id:
        return
    existing = await db.family_wars.find_one({
        "$or": [
            {"family_a_id": family_a_id, "family_b_id": family_b_id},
            {"family_a_id": family_b_id, "family_b_id": family_a_id},
        ],
        "status": "active",
    })
    if existing:
        return
    now = datetime.now(timezone.utc).isoformat()
    await db.family_wars.insert_one({
        "id": str(uuid.uuid4()),
        "family_a_id": family_a_id,
        "family_b_id": family_b_id,
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
    loser_family = await db.families.find_one({"id": loser_id}, {"_id": 0})
    winner_family = await db.families.find_one({"id": winner_id}, {"_id": 0})
    if not winner_family:
        await db.family_wars.update_one(
            {"id": war["id"]},
            {"$set": {"status": "family_a_wins" if winner_id == war["family_a_id"] else "family_b_wins", "ended_at": now, "winner_family_id": winner_id, "loser_family_id": loser_id}},
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

# Bullet rewards per rank
RANK_BULLET_REWARDS = {
    2: 50,    # Hustler
    3: 100,   # Goon
    4: 200,   # Made Man
    5: 350,   # Capo
    6: 500,   # Underboss
    7: 750,   # Consigliere
    8: 1000,  # Boss
    9: 1500,  # Don
    10: 2000, # Godfather
    11: 3000  # The Commission
}

async def check_and_process_rank_up(user_id: str, old_rank: int, new_rank: int, username: str = ""):
    """Process rank up rewards (bullets) and send notification"""
    if new_rank > old_rank:
        total_bullets = 0
        for rank in range(old_rank + 1, new_rank + 1):
            total_bullets += RANK_BULLET_REWARDS.get(rank, 0)
        
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
            "rank_up"
        )
        
        return total_bullets
    return 0

# Auth endpoints
@api_router.post("/auth/register")
async def register(user_data: UserRegister):
    try:
        existing = await db.users.find_one({"$or": [{"email": user_data.email}, {"username": user_data.username}]}, {"_id": 0})
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
            "email": str(user_data.email),
            "username": str(user_data.username),
            "password_hash": get_password_hash(user_data.password),
            "rank": 1,
            "money": 1000.0,
            "points": 0,
            "rank_points": 0,
            "bodyguard_slots": 0,
            "bullets": 0,
            "avatar_url": None,
            "jail_busts": 0,
            "garage_batch_limit": DEFAULT_GARAGE_BATCH_LIMIT,
            "total_crimes": 0,
            "crime_profit": 0,
            "total_gta": 0,
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
            "created_at": datetime.now(timezone.utc).isoformat()
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
async def login(user_data: UserLogin):
    user = await db.users.find_one({"email": user_data.email}, {"_id": 0})
    if not user or not verify_password(user_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("is_dead"):
        raise HTTPException(
            status_code=403,
            detail="This account is dead and cannot be used. Create a new account. You may retrieve a portion of your points via Dead > Alive."
        )
    token = create_access_token({"sub": user["id"]})
    return {"token": token, "user": {k: v for k, v in user.items() if k not in ("password_hash", "is_dead", "dead_at", "points_at_death", "retrieval_used")}}

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    # Update last_seen
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"last_seen": datetime.now(timezone.utc).isoformat()}}
    )
    
    rank_id, rank_name = get_rank_info(current_user.get("rank_points", 0))
    wealth_id, wealth_name = get_wealth_rank(current_user.get("money", 0))
    wealth_range = get_wealth_rank_range(current_user.get("money", 0))
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
        custom_car_name=current_user.get("custom_car_name"),
        travels_this_hour=current_user.get("travels_this_hour", 0),
        extra_airmiles=current_user.get("extra_airmiles", 0),
        garage_batch_limit=current_user.get("garage_batch_limit", DEFAULT_GARAGE_BATCH_LIMIT),
        total_crimes=current_user.get("total_crimes", 0),
        crime_profit=int(current_user.get("crime_profit", 0) or 0),
        created_at=current_user["created_at"],
        swiss_balance=int(current_user.get("swiss_balance", 0) or 0),
        swiss_limit=int(current_user.get("swiss_limit", SWISS_BANK_LIMIT_START) or SWISS_BANK_LIMIT_START),
    )

@api_router.get("/users/{username}/profile")
async def get_user_profile(username: str, current_user: dict = Depends(get_current_user)):
    """View a user's profile (requires auth)."""
    user = await db.users.find_one({"username": username}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    rank_id, rank_name = get_rank_info(user.get("rank_points", 0))
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
    wealth_range = get_wealth_rank_range(user.get("money", 0))
    return {
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
    }

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

@api_router.post("/dead-alive/retrieve")
async def dead_alive_retrieve(request: DeadAliveRetrieveRequest, current_user: dict = Depends(get_current_user)):
    """Retrieve a % of points from a dead account into your current account. One-time per dead account."""
    dead_user = await db.users.find_one({"username": request.dead_username}, {"_id": 0})
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
        rank_id, rank_name = get_rank_info(user.get("rank_points", 0))
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
    }

@api_router.get("/meta/ranks")
async def get_meta_ranks(current_user: dict = Depends(get_current_user)):
    return {"ranks": [{"id": int(r["id"]), "name": r["name"]} for r in RANKS]}

@api_router.get("/meta/cars")
async def get_meta_cars(current_user: dict = Depends(get_current_user)):
    return {"cars": [{"id": c["id"], "name": c["name"], "rarity": c.get("rarity")} for c in CARS]}

def _interest_option(duration_hours: int) -> dict | None:
    try:
        h = int(duration_hours)
    except Exception:
        return None
    return next((o for o in BANK_INTEREST_OPTIONS if int(o.get("hours", 0) or 0) == h), None)

@api_router.get("/bank/meta")
async def bank_meta(current_user: dict = Depends(get_current_user)):
    return {
        "swiss_limit_start": SWISS_BANK_LIMIT_START,
        "interest_options": BANK_INTEREST_OPTIONS,
    }

@api_router.get("/bank/overview")
async def bank_overview(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1, "swiss_balance": 1, "swiss_limit": 1})
    money = int(user.get("money", 0) or 0) if user else 0
    swiss_balance = int((user or {}).get("swiss_balance", 0) or 0)
    swiss_limit = int((user or {}).get("swiss_limit", SWISS_BANK_LIMIT_START) or SWISS_BANK_LIMIT_START)

    deposits = await db.bank_deposits.find(
        {"user_id": current_user["id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    for d in deposits:
        d["matured"] = bool(d.get("matures_at") and datetime.fromisoformat(d["matures_at"]) <= now)

    transfers = await db.money_transfers.find(
        {"$or": [{"from_user_id": current_user["id"]}, {"to_user_id": current_user["id"]}]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    for t in transfers:
        t["direction"] = "sent" if t.get("from_user_id") == current_user["id"] else "received"

    return {
        "cash_on_hand": money,
        "swiss_balance": swiss_balance,
        "swiss_limit": swiss_limit,
        "deposits": deposits,
        "transfers": transfers,
    }

@api_router.post("/bank/interest/deposit")
async def bank_interest_deposit(request: BankInterestDepositRequest, current_user: dict = Depends(get_current_user)):
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    opt = _interest_option(request.duration_hours)
    if not opt:
        raise HTTPException(status_code=400, detail="Invalid duration")
    rate = float(opt["rate"])
    hours = int(opt["hours"])

    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    money = int(user.get("money", 0) or 0) if user else 0
    if amount > money:
        raise HTTPException(status_code=400, detail="Insufficient cash on hand")

    now = datetime.now(timezone.utc)
    matures = now + timedelta(hours=hours)
    interest = int(round(amount * rate))

    deposit_id = str(uuid.uuid4())
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -amount}})
    await db.bank_deposits.insert_one({
        "id": deposit_id,
        "user_id": current_user["id"],
        "principal": int(amount),
        "duration_hours": hours,
        "interest_rate": rate,
        "interest_amount": int(interest),
        "created_at": now.isoformat(),
        "matures_at": matures.isoformat(),
        "claimed_at": None,
    })
    return {"message": f"Deposited ${amount:,} for {hours}h", "deposit_id": deposit_id, "interest": interest, "matures_at": matures.isoformat()}

@api_router.post("/bank/interest/claim")
async def bank_interest_claim(request: BankDepositClaimRequest, current_user: dict = Depends(get_current_user)):
    dep = await db.bank_deposits.find_one({"id": request.deposit_id, "user_id": current_user["id"]}, {"_id": 0})
    if not dep:
        raise HTTPException(status_code=404, detail="Deposit not found")
    if dep.get("claimed_at"):
        raise HTTPException(status_code=400, detail="Deposit already claimed")

    now = datetime.now(timezone.utc)
    matures_at = dep.get("matures_at")
    if not matures_at:
        raise HTTPException(status_code=400, detail="Deposit missing maturity time")
    try:
        mat = datetime.fromisoformat(matures_at)
        if mat.tzinfo is None:
            mat = mat.replace(tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid maturity time")
    if now < mat:
        raise HTTPException(status_code=400, detail="Deposit has not matured yet")

    principal = int(dep.get("principal", 0) or 0)
    interest = int(dep.get("interest_amount", 0) or 0)
    total = principal + interest

    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": total}})
    await db.bank_deposits.update_one({"id": dep["id"]}, {"$set": {"claimed_at": now.isoformat()}})
    return {"message": f"Claimed ${total:,} (${principal:,} + ${interest:,} interest)", "total": total}

@api_router.post("/bank/swiss/deposit")
async def bank_swiss_deposit(request: BankSwissMoveRequest, current_user: dict = Depends(get_current_user)):
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1, "swiss_balance": 1, "swiss_limit": 1})
    money = int(user.get("money", 0) or 0) if user else 0
    swiss_balance = int(user.get("swiss_balance", 0) or 0) if user else 0
    swiss_limit = int(user.get("swiss_limit", SWISS_BANK_LIMIT_START) or SWISS_BANK_LIMIT_START) if user else SWISS_BANK_LIMIT_START
    if amount > money:
        raise HTTPException(status_code=400, detail="Insufficient cash on hand")
    if swiss_balance + amount > swiss_limit:
        raise HTTPException(status_code=400, detail=f"Swiss bank limit is ${swiss_limit:,}")

    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": -amount, "swiss_balance": amount}}
    )
    return {"message": f"Deposited ${amount:,} into Swiss Bank"}

@api_router.post("/bank/swiss/withdraw")
async def bank_swiss_withdraw(request: BankSwissMoveRequest, current_user: dict = Depends(get_current_user)):
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "swiss_balance": 1})
    swiss_balance = int(user.get("swiss_balance", 0) or 0) if user else 0
    if amount > swiss_balance:
        raise HTTPException(status_code=400, detail="Insufficient Swiss balance")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": amount, "swiss_balance": -amount}}
    )
    return {"message": f"Withdrew ${amount:,} from Swiss Bank"}

@api_router.post("/bank/transfer")
async def bank_transfer(request: MoneyTransferRequest, current_user: dict = Depends(get_current_user)):
    to_username = (request.to_username or "").strip()
    if not to_username:
        raise HTTPException(status_code=400, detail="Recipient username required")
    if to_username == current_user["username"]:
        raise HTTPException(status_code=400, detail="Cannot send money to yourself")
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    recipient = await db.users.find_one({"username": to_username}, {"_id": 0})
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    if recipient.get("is_dead"):
        raise HTTPException(status_code=400, detail="Recipient is dead")

    sender = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "money": 1})
    money = int(sender.get("money", 0) or 0) if sender else 0
    if amount > money:
        raise HTTPException(status_code=400, detail="Insufficient cash on hand")

    now = datetime.now(timezone.utc).isoformat()
    transfer_id = str(uuid.uuid4())
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -amount}})
    await db.users.update_one({"id": recipient["id"]}, {"$inc": {"money": amount}})
    await db.money_transfers.insert_one({
        "id": transfer_id,
        "from_user_id": current_user["id"],
        "from_username": current_user["username"],
        "to_user_id": recipient["id"],
        "to_username": recipient["username"],
        "amount": int(amount),
        "created_at": now,
    })
    return {"message": f"Sent ${amount:,} to {recipient['username']}"}


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
    if current_user.get("email") not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin only")
    categories = ["Football", "UFC", "Boxing", "Formula 1"]
    by_category = {c: [] for c in categories}
    for t in _get_all_sports_templates():
        by_category.setdefault(t["category"], []).append(_sports_template_to_response(t))
    return {"categories": categories, "templates": by_category}


@api_router.post("/admin/sports-betting/refresh")
async def admin_sports_refresh(current_user: dict = Depends(get_current_user)):
    """Admin: fetch latest events from The Odds API etc. (use when user clicks 'Check for events'). Uses quota."""
    if current_user.get("email") not in ADMIN_EMAILS:
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
    if current_user.get("email") not in ADMIN_EMAILS:
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


@api_router.post("/admin/sports-betting/settle")
async def admin_sports_settle(request: SportsSettleEventRequest, current_user: dict = Depends(get_current_user)):
    """Admin: settle an event, mark bets won/lost, and auto-pay winners."""
    if current_user.get("email") not in ADMIN_EMAILS:
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
        {"_id": 0, "id": 1, "user_id": 1, "option_id": 1, "stake": 1, "odds": 1},
    )
    for b in await cursor.to_list(1000):
        won = b.get("option_id") == winning_option_id
        new_status = "won" if won else "lost"
        await db.sports_bets.update_one({"id": b["id"]}, {"$set": {"status": new_status, "settled_at": now}})
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
    if current_user.get("email") not in ADMIN_EMAILS:
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


# Points Store endpoints
@api_router.post("/store/buy-rank-bar")
async def buy_premium_rank_bar(current_user: dict = Depends(get_current_user)):
    if current_user.get("premium_rank_bar", False):
        raise HTTPException(status_code=400, detail="You already own the premium rank bar")
    
    cost = 50
    if current_user["points"] < cost:
        raise HTTPException(status_code=400, detail="Insufficient points")
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -cost}, "$set": {"premium_rank_bar": True}}
    )
    
    return {"message": "Premium rank bar purchased!", "cost": cost}

@api_router.post("/store/upgrade-garage-batch")
async def upgrade_garage_batch_limit(current_user: dict = Depends(get_current_user)):
    """Increase garage melt/scrap batch limit using points."""
    current_limit = current_user.get("garage_batch_limit", DEFAULT_GARAGE_BATCH_LIMIT)
    if current_limit >= GARAGE_BATCH_LIMIT_MAX:
        raise HTTPException(status_code=400, detail="Garage batch limit already maxed")
    if current_user["points"] < GARAGE_BATCH_UPGRADE_COST:
        raise HTTPException(status_code=400, detail="Insufficient points")

    new_limit = min(GARAGE_BATCH_LIMIT_MAX, current_limit + GARAGE_BATCH_UPGRADE_INCREMENT)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -GARAGE_BATCH_UPGRADE_COST}, "$set": {"garage_batch_limit": new_limit}}
    )
    return {"message": f"Garage batch limit upgraded to {new_limit}", "new_limit": new_limit, "cost": GARAGE_BATCH_UPGRADE_COST}

# GTA endpoints - global cooldown (one attempt blocks all options until it expires), options unlock by rank
@api_router.get("/armour/options")
async def get_armour_options(current_user: dict = Depends(get_current_user)):
    """List available armour sets and affordability. Costs and affordability use event multiplier when set."""
    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    equipped_level = int(current_user.get("armour_level", 0) or 0)
    owned_max = int(current_user.get("armour_owned_level_max", equipped_level) or 0)
    money = float(current_user.get("money", 0) or 0)
    points = int(current_user.get("points", 0) or 0)

    rows = []
    for s in ARMOUR_SETS:
        cost_money = s.get("cost_money")
        cost_points = s.get("cost_points")
        effective_money = int(cost_money * mult) if cost_money is not None else None
        effective_points = int(cost_points * mult) if cost_points is not None else None
        affordable = True
        if effective_money is not None and money < effective_money:
            affordable = False
        if effective_points is not None and points < effective_points:
            affordable = False
        rows.append({
            "level": s["level"],
            "name": s["name"],
            "description": s["description"],
            "cost_money": cost_money,
            "cost_points": cost_points,
            "effective_cost_money": effective_money,
            "effective_cost_points": effective_points,
            "owned": owned_max >= s["level"],
            "equipped": equipped_level == s["level"],
            "affordable": affordable,
        })

    return {
        "current_level": equipped_level,
        "owned_max": owned_max,
        "options": rows
    }

@api_router.post("/armour/buy")
async def buy_armour(request: ArmourBuyRequest, current_user: dict = Depends(get_current_user)):
    """Buy and equip an armour tier. Cost uses event multiplier when set."""
    level = int(request.level or 0)
    if level < 1 or level > 5:
        raise HTTPException(status_code=400, detail="Invalid armour level")

    equipped_level = int(current_user.get("armour_level", 0) or 0)
    owned_max = int(current_user.get("armour_owned_level_max", equipped_level) or 0)
    if level <= owned_max:
        raise HTTPException(status_code=400, detail="You already own this armour tier")

    armour = next((a for a in ARMOUR_SETS if a["level"] == level), None)
    if not armour:
        raise HTTPException(status_code=404, detail="Armour not found")

    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    updates = {"$set": {"armour_level": level, "armour_owned_level_max": max(owned_max, level)}}
    if armour.get("cost_money") is not None:
        cost = int(armour["cost_money"] * mult)
        if current_user.get("money", 0) < cost:
            raise HTTPException(status_code=400, detail="Insufficient cash")
        updates["$inc"] = {"money": -cost}
    elif armour.get("cost_points") is not None:
        cost = int(armour["cost_points"] * mult)
        if current_user.get("points", 0) < cost:
            raise HTTPException(status_code=400, detail="Insufficient points")
        updates["$inc"] = {"points": -cost}
    else:
        raise HTTPException(status_code=500, detail="Armour cost misconfigured")

    await db.users.update_one({"id": current_user["id"]}, updates)
    return {
        "message": f"Purchased {armour['name']} (Armour Lv.{level})",
        "new_level": level
    }

@api_router.post("/armour/equip")
async def equip_armour(request: ArmourBuyRequest, current_user: dict = Depends(get_current_user)):
    """Equip an owned armour tier (or 0 to unequip)."""
    level = int(request.level or 0)
    if level < 0 or level > 5:
        raise HTTPException(status_code=400, detail="Invalid armour level")

    equipped_level = int(current_user.get("armour_level", 0) or 0)
    owned_max = int(current_user.get("armour_owned_level_max", equipped_level) or 0)
    if level != 0 and level > owned_max:
        raise HTTPException(status_code=400, detail="You do not own this armour tier")

    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"armour_level": level}}
    )
    return {"message": "Armour equipped" if level else "Armour unequipped", "equipped_level": level}

@api_router.post("/armour/unequip")
async def unequip_armour(current_user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"armour_level": 0}}
    )
    return {"message": "Armour unequipped", "equipped_level": 0}

@api_router.post("/armour/sell")
async def sell_armour(current_user: dict = Depends(get_current_user)):
    """Sell your highest owned armour tier for 50% of its base purchase price."""
    owned_max = int(current_user.get("armour_owned_level_max", 0) or 0)
    if owned_max < 1:
        raise HTTPException(status_code=400, detail="You have no armour to sell")
    armour = next((a for a in ARMOUR_SETS if a["level"] == owned_max), None)
    if not armour:
        raise HTTPException(status_code=404, detail="Armour tier not found")
    # Refund 50% of base cost (no event multiplier)
    refund_money = int(armour["cost_money"] * 0.5) if armour.get("cost_money") is not None else None
    refund_points = int(armour["cost_points"] * 0.5) if armour.get("cost_points") is not None else None
    new_owned_max = owned_max - 1
    equipped = int(current_user.get("armour_level", 0) or 0)
    updates = {"$set": {"armour_owned_level_max": new_owned_max}}
    if equipped == owned_max:
        updates["$set"]["armour_level"] = new_owned_max if new_owned_max > 0 else 0
    if refund_money is not None:
        updates["$inc"] = {"money": refund_money}
    elif refund_points is not None:
        updates["$inc"] = {"points": refund_points}
    await db.users.update_one({"id": current_user["id"]}, updates)
    msg = f"Sold {armour['name']} for "
    msg += f"${refund_money:,}" if refund_money is not None else f"{refund_points} points"
    return {"message": msg + " (50% of purchase price).", "refund_money": refund_money, "refund_points": refund_points}

# Admin endpoints
ADMIN_EMAILS = ["admin@mafia.com", "boss@mafia.com", "jakeg_lfc2016@icloud.com"]

@api_router.post("/admin/change-rank")
async def admin_change_rank(target_username: str, new_rank: int, current_user: dict = Depends(get_current_user)):
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    target = await db.users.find_one({"username": target_username}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    
    await db.users.update_one(
        {"id": target["id"]},
        {"$set": {"rank": new_rank}}
    )
    
    return {"message": f"Changed {target_username}'s rank to {new_rank}"}

@api_router.post("/admin/add-points")
async def admin_add_points(target_username: str, points: int, current_user: dict = Depends(get_current_user)):
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    target = await db.users.find_one({"username": target_username}, {"_id": 0})
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
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    if points < 1:
        raise HTTPException(status_code=400, detail="Points must be at least 1")
    result = await db.users.update_many(
        {"is_dead": {"$ne": True}, "is_npc": {"$ne": True}, "is_bodyguard": {"$ne": True}},
        {"$inc": {"points": points}}
    )
    return {"message": f"Gave {points} points to {result.modified_count} accounts", "updated": result.modified_count}

@api_router.post("/admin/add-bullets")
async def admin_add_bullets(target_username: str, bullets: int, current_user: dict = Depends(get_current_user)):
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")

    if bullets <= 0:
        raise HTTPException(status_code=400, detail="Bullets must be greater than 0")

    target = await db.users.find_one({"username": target_username}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    await db.users.update_one(
        {"id": target["id"]},
        {"$inc": {"bullets": int(bullets)}}
    )

    return {"message": f"Added {int(bullets):,} bullets to {target_username}"}

@api_router.post("/admin/add-car")
async def admin_add_car(target_username: str, car_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    target = await db.users.find_one({"username": target_username}, {"_id": 0})
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

@api_router.post("/admin/bodyguards/clear")
async def admin_clear_bodyguards(target_username: str, current_user: dict = Depends(get_current_user)):
    """Delete all bodyguard slots for a user (testing)."""
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    target = await db.users.find_one({"username": target_username}, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Remove bodyguard records
    res_bg = await db.bodyguards.delete_many({"user_id": target["id"]})

    # Remove robot bodyguard user docs owned by this user (keeps real human users safe)
    res_robots = await db.users.delete_many({"is_bodyguard": True, "bodyguard_owner_id": target["id"]})

    return {
        "message": f"Cleared bodyguards for {target_username} (removed {res_bg.deleted_count} bodyguard record(s), {res_robots.deleted_count} robot user(s))",
        "deleted_bodyguards": res_bg.deleted_count,
        "deleted_robot_users": res_robots.deleted_count,
    }

@api_router.post("/admin/bodyguards/generate")
async def admin_generate_bodyguards(request: AdminBodyguardsGenerateRequest, current_user: dict = Depends(get_current_user)):
    """Generate 1–4 robot bodyguards for a user (testing)."""
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")

    target_username = (request.target_username or "").strip()
    if not target_username:
        raise HTTPException(status_code=400, detail="Target username required")
    count = int(request.count or 1)
    if count < 1 or count > 4:
        raise HTTPException(status_code=400, detail="Count must be between 1 and 4")

    target = await db.users.find_one({"username": target_username}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if request.replace_existing:
        await db.bodyguards.delete_many({"user_id": target["id"]})
        await db.users.delete_many({"is_bodyguard": True, "bodyguard_owner_id": target["id"]})

    # Ensure enough slots exist
    desired_slots = max(int(target.get("bodyguard_slots", 0) or 0), count)
    desired_slots = min(4, desired_slots)
    if desired_slots != int(target.get("bodyguard_slots", 0) or 0):
        await db.users.update_one({"id": target["id"]}, {"$set": {"bodyguard_slots": desired_slots}})

    # Fill slots 1..count
    created = 0
    for slot in range(1, count + 1):
        exists = await db.bodyguards.find_one({"user_id": target["id"], "slot_number": slot}, {"_id": 0, "id": 1})
        if exists:
            continue
        robot_user_id, robot_username = await _create_robot_bodyguard_user(target)
        await db.bodyguards.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": target["id"],
            "slot_number": slot,
            "is_robot": True,
            "robot_name": robot_username,
            "bodyguard_user_id": robot_user_id,
            "health": 100,
            "armour_level": 0,
            "hired_at": datetime.now(timezone.utc).isoformat()
        })
        created += 1

    return {"message": f"Generated {created} robot bodyguard(s) for {target_username}", "created": created, "count_requested": count}

@api_router.post("/admin/force-online")
async def admin_force_online(current_user: dict = Depends(get_current_user)):
    """
    Force offline (but alive) users to appear online for 1 hour.
    This affects the Users Online list and profile status.
    """
    if current_user["email"] not in ADMIN_EMAILS:
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
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    target = await db.users.find_one({"username": target_username}, {"_id": 0})
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
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    target = await db.users.find_one({"username": target_username}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    
    penalty = int(target["money"] * 0.2)
    
    await db.users.update_one(
        {"id": target["id"]},
        {"$inc": {"money": -penalty, "total_deaths": 1}}
    )
    
    return {"message": f"Killed {target_username}, took ${penalty:,}"}

@api_router.post("/admin/set-search-time")
async def admin_set_search_time(target_username: str, search_minutes: int, current_user: dict = Depends(get_current_user)):
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    attacker = await db.users.find_one({"username": target_username}, {"_id": 0})
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
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    if search_minutes <= 0:
        raise HTTPException(status_code=400, detail="search_minutes must be positive")
    res = await db.users.update_many(
        {},
        {"$set": {"search_minutes_override": int(search_minutes)}}
    )
    new_found_time = datetime.now(timezone.utc) + timedelta(minutes=int(search_minutes))
    await db.attacks.update_many(
        {"status": "searching"},
        {"$set": {"found_at": new_found_time.isoformat()}}
    )
    return {"message": f"Set all users' search time to {search_minutes} minutes ({res.modified_count} users updated)"}


@api_router.get("/admin/check")
async def admin_check(current_user: dict = Depends(get_current_user)):
    is_admin = current_user["email"] in ADMIN_EMAILS
    return {"is_admin": is_admin}


@api_router.get("/admin/find-duplicates")
async def admin_find_duplicates(username: str = None, current_user: dict = Depends(get_current_user)):
    """Find duplicate or similar usernames in the database. If username provided, search for that; otherwise find all duplicates."""
    if current_user["email"] not in ADMIN_EMAILS:
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


@api_router.get("/admin/user-details/{user_id}")
async def admin_user_details(user_id: str, current_user: dict = Depends(get_current_user)):
    """Get full details of a user by ID."""
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Also get their dice ownership
    dice_owned = await db.dice_ownership.find({"owner_id": user_id}, {"_id": 0}).to_list(10)
    return {"user": user, "dice_owned": dice_owned}


@api_router.post("/admin/wipe-all-users")
async def admin_wipe_all_users(current_user: dict = Depends(get_current_user)):
    """DANGEROUS: Delete ALL users and related data from the game. Admin only."""
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    
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
    
    total = sum(deleted.values())
    return {"message": f"Wiped {total} documents from the game", "details": deleted}


@api_router.post("/admin/delete-user/{user_id}")
async def admin_delete_single_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a single user and all their related data. Admin only."""
    if current_user["email"] not in ADMIN_EMAILS:
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
    deleted["dice_ownership"] = (await db.dice_ownership.update_many({"owner_id": user_id}, {"$set": {"owner_id": None}})).modified_count
    deleted["dice_buy_back_offers"] = (await db.dice_buy_back_offers.delete_many({"$or": [{"from_owner_id": user_id}, {"to_user_id": user_id}]})).deleted_count
    deleted["interest_deposits"] = (await db.interest_deposits.delete_many({"user_id": user_id})).deleted_count
    deleted["family_war_stats"] = (await db.family_war_stats.delete_many({"user_id": user_id})).deleted_count
    
    total = sum(deleted.values())
    return {"message": f"Deleted user '{username}' and {total} related documents", "details": deleted}


@api_router.get("/admin/events")
async def admin_get_events(current_user: dict = Depends(get_current_user)):
    """Get current events-enabled flag and all-events-for-testing (admin)."""
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    enabled = await get_events_enabled()
    all_for_testing = await get_all_events_for_testing()
    today_event = get_combined_event() if all_for_testing else (get_active_game_event() if enabled else None)
    return {"events_enabled": enabled, "all_events_for_testing": all_for_testing, "today_event": today_event}


@api_router.post("/admin/events/toggle")
async def admin_toggle_events(request: EventsToggleRequest, current_user: dict = Depends(get_current_user)):
    """Enable or disable daily game events (admin)."""
    if current_user["email"] not in ADMIN_EMAILS:
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
    if current_user["email"] not in ADMIN_EMAILS:
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
SEED_RANK_POINTS_BY_ROLE = {"boss": 1200, "underboss": 600, "consigliere": 300, "capo": 150, "soldier": 50}
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
    if current_user["email"] not in ADMIN_EMAILS:
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
                "garage_batch_limit": DEFAULT_GARAGE_BATCH_LIMIT,
                "total_crimes": 0,
                "crime_profit": 0,
                "total_gta": 0,
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
            user_ids.append((user_id, role))
        boss_id = user_ids[0][0] if user_ids else None
        if not boss_id:
            continue
        seed_rackets = SEED_RACKETS_BY_FAMILY.get(name, {})
        rackets = {}
        for r in FAMILY_RACKETS:
            level = seed_rackets.get(r["id"], 1)  # default 1 so every family has every racket
            rackets[r["id"]] = {"level": max(1, level), "last_collected_at": None}
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
        for user_id, role in user_ids:
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
        for user_id, role in user_ids:
            owner = {"id": user_id, "current_state": "Chicago"}
            for slot in range(1, 3):
                try:
                    robot_user_id, robot_username = await _create_robot_bodyguard_user(owner)
                    await db.bodyguards.insert_one({
                        "id": str(uuid.uuid4()),
                        "user_id": user_id,
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

# Protection Racket endpoints
# Property attack: success chance falls as defender's property level (upgrades) increases. Take % of revenue.
PROPERTY_ATTACK_BASE_SUCCESS = 0.70
PROPERTY_ATTACK_LEVEL_PENALTY = 0.10  # per defender level
PROPERTY_ATTACK_MIN_SUCCESS = 0.10
PROPERTY_ATTACK_REVENUE_PCT = 0.25  # 25% of revenue (12h worth)
PROPERTY_ATTACK_HOURS = 12


@api_router.post("/racket/extort")
async def extort_property(request: ProtectionRacketRequest, current_user: dict = Depends(get_current_user)):
    target = await db.users.find_one({"username": request.target_username}, {"_id": 0, "money": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    if target.get("is_dead"):
        raise HTTPException(status_code=400, detail="Target is dead")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot attack your own properties")
    
    target_property = await db.user_properties.find_one(
        {"user_id": target["id"], "property_id": request.property_id},
        {"_id": 0}
    )
    if not target_property:
        raise HTTPException(status_code=404, detail="Target doesn't own this property")
    
    prop = await db.properties.find_one({"id": request.property_id}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    
    last_extortion = await db.extortions.find_one(
        {"extorter_id": current_user["id"], "target_id": target["id"], "property_id": request.property_id},
        {"_id": 0}
    )
    if last_extortion:
        cooldown_time = datetime.fromisoformat(last_extortion["timestamp"]) + timedelta(hours=2)
        if cooldown_time > datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Must wait 2 hours between attacks on the same property")
    
    defender_level = target_property.get("level", 1)
    success_chance = max(PROPERTY_ATTACK_MIN_SUCCESS, PROPERTY_ATTACK_BASE_SUCCESS - defender_level * PROPERTY_ATTACK_LEVEL_PENALTY)
    success = random.random() < success_chance
    
    if success:
        revenue_12h = prop["income_per_hour"] * defender_level * PROPERTY_ATTACK_HOURS
        extortion_amount = int(revenue_12h * PROPERTY_ATTACK_REVENUE_PCT)
        extortion_amount = max(1, extortion_amount)
        target_money = int(target.get("money", 0) or 0)
        if target_money < extortion_amount:
            extortion_amount = target_money
        rank_points = 10
        if extortion_amount > 0:
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": {"money": extortion_amount, "rank_points": rank_points}}
            )
            await db.users.update_one(
                {"id": target["id"]},
                {"$inc": {"money": -extortion_amount}}
            )
        await db.extortions.update_one(
            {"extorter_id": current_user["id"], "target_id": target["id"], "property_id": request.property_id},
            {"$set": {"timestamp": datetime.now(timezone.utc).isoformat(), "amount": extortion_amount}},
            upsert=True
        )
        return {
            "success": True,
            "message": f"Raid successful! You took ${extortion_amount:,} ({PROPERTY_ATTACK_REVENUE_PCT*100:.0f}% of revenue) from {target['username']}'s {prop['name']}.",
            "amount": extortion_amount,
            "rank_points_earned": rank_points,
        }
    return {
        "success": False,
        "message": f"Raid failed. {prop['name']} is well defended (level {defender_level}). Try again later.",
        "amount": 0,
        "rank_points_earned": 0,
    }

@api_router.get("/racket/targets")
async def get_racket_targets(current_user: dict = Depends(get_current_user)):
    users_with_properties = await db.user_properties.distinct("user_id")
    alive = {u["id"] for u in await db.users.find({"id": {"$in": users_with_properties}, "is_dead": {"$ne": True}}, {"_id": 0, "id": 1}).to_list(100)}
    targets = []
    for user_id in users_with_properties:
        if user_id == current_user["id"] or user_id not in alive:
            continue
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1, "current_state": 1})
        if not user:
            continue
        properties = await db.user_properties.find({"user_id": user_id}, {"_id": 0}).to_list(100)
        property_details = []
        for up in properties:
            prop = await db.properties.find_one({"id": up["property_id"]}, {"_id": 0})
            if prop:
                level = up.get("level", 1)
                revenue_12h = prop["income_per_hour"] * level * PROPERTY_ATTACK_HOURS
                potential_take = int(revenue_12h * PROPERTY_ATTACK_REVENUE_PCT)
                success_chance = max(PROPERTY_ATTACK_MIN_SUCCESS, PROPERTY_ATTACK_BASE_SUCCESS - level * PROPERTY_ATTACK_LEVEL_PENALTY)
                property_details.append({
                    "property_id": up["property_id"],
                    "property_name": prop["name"],
                    "level": level,
                    "potential_take": potential_take,
                    "success_chance_pct": int(round(success_chance * 100)),
                })
        if property_details:
            targets.append({
                "username": user["username"],
                "location": user.get("current_state") or "—",
                "properties": property_details,
            })
    return {"targets": targets[:25]}

# Crime endpoints -> see routers/crimes.py

# Weapons endpoints
@api_router.get("/weapons", response_model=List[WeaponResponse])
async def get_weapons(current_user: dict = Depends(get_current_user)):
    weapons = await db.weapons.find({}, {"_id": 0}).to_list(100)
    user_weapons = await db.user_weapons.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(100)
    
    weapons_map = {uw["weapon_id"]: uw["quantity"] for uw in user_weapons}
    equipped_weapon_id = current_user.get("equipped_weapon_id")
    if equipped_weapon_id and weapons_map.get(equipped_weapon_id, 0) <= 0:
        # Clear invalid equipped weapon (no longer owned)
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"equipped_weapon_id": None}}
        )
        equipped_weapon_id = None
    
    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    result = []
    for weapon in weapons:
        quantity = weapons_map.get(weapon["id"], 0)
        pm = weapon.get("price_money")
        pp = weapon.get("price_points")
        result.append(WeaponResponse(
            id=weapon["id"],
            name=weapon["name"],
            description=weapon["description"],
            damage=weapon["damage"],
            bullets_needed=weapon["bullets_needed"],
            rank_required=weapon["rank_required"],
            price_money=pm,
            price_points=pp,
            effective_price_money=int(pm * mult) if pm is not None else None,
            effective_price_points=int(pp * mult) if pp is not None else None,
            owned=quantity > 0,
            quantity=quantity,
            equipped=(quantity > 0 and equipped_weapon_id == weapon["id"])
        ))
    
    return result

@api_router.post("/weapons/equip")
async def equip_weapon(request: WeaponEquipRequest, current_user: dict = Depends(get_current_user)):
    weapon_id = (request.weapon_id or "").strip()
    if not weapon_id:
        raise HTTPException(status_code=400, detail="Weapon id required")

    owned = await db.user_weapons.find_one(
        {"user_id": current_user["id"], "weapon_id": weapon_id, "quantity": {"$gt": 0}},
        {"_id": 0}
    )
    if not owned:
        raise HTTPException(status_code=400, detail="You do not own this weapon")

    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"equipped_weapon_id": weapon_id}}
    )
    return {"message": "Weapon equipped"}

@api_router.post("/weapons/unequip")
async def unequip_weapon(current_user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"equipped_weapon_id": None}}
    )
    return {"message": "Weapon unequipped"}

@api_router.post("/weapons/{weapon_id}/buy")
async def buy_weapon(weapon_id: str, request: WeaponBuyRequest, current_user: dict = Depends(get_current_user)):
    weapon = await db.weapons.find_one({"id": weapon_id}, {"_id": 0})
    if not weapon:
        raise HTTPException(status_code=404, detail="Weapon not found")

    ev = await get_effective_event()
    mult = ev.get("armour_weapon_cost", 1.0)
    currency = (request.currency or "").strip().lower()
    if currency not in ("money", "points"):
        raise HTTPException(status_code=400, detail="Invalid currency")
    
    if currency == "money":
        if weapon.get("price_money") is None:
            raise HTTPException(status_code=400, detail="This weapon can only be bought with points")
        cost = int(weapon["price_money"] * mult)
        if current_user["money"] < cost:
            raise HTTPException(status_code=400, detail="Insufficient money")
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"money": -cost}}
        )
    elif currency == "points":
        if weapon.get("price_points") is None:
            raise HTTPException(status_code=400, detail="This weapon can only be bought with money")
        cost = int(weapon["price_points"] * mult)
        if current_user["points"] < cost:
            raise HTTPException(status_code=400, detail="Insufficient points")
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"points": -cost}}
        )
    
    await db.user_weapons.update_one(
        {"user_id": current_user["id"], "weapon_id": weapon_id},
        {"$inc": {"quantity": 1}, "$set": {"acquired_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    
    return {"message": f"Successfully purchased {weapon['name']}"}

@api_router.post("/weapons/{weapon_id}/sell")
async def sell_weapon(weapon_id: str, current_user: dict = Depends(get_current_user)):
    """Sell one unit of a weapon for 50% of its base purchase price. Refunds money or points (same as list price type)."""
    weapon = await db.weapons.find_one({"id": weapon_id}, {"_id": 0})
    if not weapon:
        raise HTTPException(status_code=404, detail="Weapon not found")
    uw = await db.user_weapons.find_one({"user_id": current_user["id"], "weapon_id": weapon_id}, {"_id": 0, "quantity": 1})
    quantity = (uw or {}).get("quantity", 0) or 0
    if quantity < 1:
        raise HTTPException(status_code=400, detail="You do not own this weapon")
    # 50% of base price; refund in money if weapon has price_money else points
    refund_money = None
    refund_points = None
    if weapon.get("price_money") is not None:
        refund_money = int(weapon["price_money"] * 0.5)
    if weapon.get("price_points") is not None:
        refund_points = int(weapon["price_points"] * 0.5)
    if refund_money is None and refund_points is None:
        raise HTTPException(status_code=400, detail="Weapon has no sell value")
    # Prefer refunding money if both exist
    if refund_money is not None:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": refund_money}})
        refund_points = None
    else:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": refund_points}})
    new_qty = quantity - 1
    if new_qty <= 0:
        await db.user_weapons.delete_one({"user_id": current_user["id"], "weapon_id": weapon_id})
        if current_user.get("equipped_weapon_id") == weapon_id:
            await db.users.update_one({"id": current_user["id"]}, {"$set": {"equipped_weapon_id": None}})
    else:
        await db.user_weapons.update_one(
            {"user_id": current_user["id"], "weapon_id": weapon_id},
            {"$inc": {"quantity": -1}}
        )
    msg = f"Sold 1× {weapon['name']} for "
    msg += f"${refund_money:,}" if refund_money is not None else f"{refund_points} points"
    return {"message": msg + " (50% of purchase price).", "refund_money": refund_money, "refund_points": refund_points}

# Properties endpoints
@api_router.get("/properties", response_model=List[PropertyResponse])
async def get_properties(current_user: dict = Depends(get_current_user)):
    properties = await db.properties.find({}, {"_id": 0}).to_list(100)
    user_properties = await db.user_properties.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(100)
    
    properties_map = {up["property_id"]: up for up in user_properties}
    
    result = []
    for prop in properties:
        user_prop = properties_map.get(prop["id"])
        owned = user_prop is not None
        level = user_prop["level"] if owned else 0
        
        available_income = 0
        if owned and "last_collected" in user_prop:
            last_collected = datetime.fromisoformat(user_prop["last_collected"])
            hours_passed = (datetime.now(timezone.utc) - last_collected).total_seconds() / 3600
            available_income = min(hours_passed * prop["income_per_hour"] * level, prop["income_per_hour"] * level * 24)
        
        result.append(PropertyResponse(
            id=prop["id"],
            name=prop["name"],
            property_type=prop["property_type"],
            price=prop["price"],
            income_per_hour=prop["income_per_hour"],
            max_level=prop["max_level"],
            owned=owned,
            level=level,
            available_income=available_income
        ))
    
    return result

@api_router.post("/properties/{property_id}/buy")
async def buy_property(property_id: str, current_user: dict = Depends(get_current_user)):
    prop = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    
    user_prop = await db.user_properties.find_one(
        {"user_id": current_user["id"], "property_id": property_id},
        {"_id": 0}
    )
    
    if user_prop:
        if user_prop["level"] >= prop["max_level"]:
            raise HTTPException(status_code=400, detail="Property already at max level")
        cost = prop["price"] * (user_prop["level"] + 1)
    else:
        cost = prop["price"]
    
    if current_user["money"] < cost:
        raise HTTPException(status_code=400, detail="Insufficient money")
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": -cost}}
    )
    
    if user_prop:
        await db.user_properties.update_one(
            {"user_id": current_user["id"], "property_id": property_id},
            {"$inc": {"level": 1}}
        )
    else:
        await db.user_properties.insert_one({
            "user_id": current_user["id"],
            "property_id": property_id,
            "level": 1,
            "last_collected": datetime.now(timezone.utc).isoformat()
        })
    
    return {"message": f"Successfully purchased/upgraded {prop['name']}"}

@api_router.post("/properties/{property_id}/collect")
async def collect_property_income(property_id: str, current_user: dict = Depends(get_current_user)):
    prop = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    
    user_prop = await db.user_properties.find_one(
        {"user_id": current_user["id"], "property_id": property_id},
        {"_id": 0}
    )
    
    if not user_prop:
        raise HTTPException(status_code=404, detail="You don't own this property")
    
    last_collected = datetime.fromisoformat(user_prop["last_collected"])
    hours_passed = (datetime.now(timezone.utc) - last_collected).total_seconds() / 3600
    income = min(hours_passed * prop["income_per_hour"] * user_prop["level"], prop["income_per_hour"] * user_prop["level"] * 24)
    
    if income < 1:
        raise HTTPException(status_code=400, detail="No income to collect yet")
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": income}}
    )
    
    await db.user_properties.update_one(
        {"user_id": current_user["id"], "property_id": property_id},
        {"$set": {"last_collected": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"message": f"Collected ${income:,.2f}"}

# Bodyguards endpoints
def _camelize(name: str) -> str:
    parts = []
    for ch in (name or ""):
        if ch.isalnum() or ch == " ":
            parts.append(ch)
    cleaned = "".join(parts)
    tokens = [t for t in cleaned.replace("_", " ").split(" ") if t]
    return "".join(t[:1].upper() + t[1:] for t in tokens)

async def _create_robot_bodyguard_user(owner_user: dict) -> tuple[str, str]:
    """Create a unique robot user record. Returns (user_id, username)."""
    robot_names = ["Iron Tony", "Steel Sal", "Chrome Carlo", "Titanium Vito", "Metal Marco", "Copper Carmine", "Bronze Bruno", "Alloy Angelo"]
    base = _camelize(random.choice(robot_names))

    # Random rank (based on existing ranks)
    rank = random.choice(RANKS)
    rank_points = random.randint(int(rank["required_points"]), int(rank["required_points"]) + 500)

    # Ensure unique username
    username = None
    for _ in range(80):
        suffix = random.randint(100000, 9999999)
        candidate = f"{base}{suffix}"
        exists = await db.users.find_one({"username": candidate}, {"_id": 0, "id": 1})
        if not exists:
            username = candidate
            break
    if not username:
        raise HTTPException(status_code=500, detail="Failed to generate unique robot name")

    robot_user_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    robot_doc = {
        "id": robot_user_id,
        "email": f"{username.lower()}@robot.mafia",
        "username": username,
        "password_hash": get_password_hash(str(uuid.uuid4())),
        "rank": int(rank["id"]),
        "money": 0.0,
        "points": 0,
        "rank_points": int(rank_points),
        "bodyguard_slots": 0,
        "bullets": 0,
        "avatar_url": None,
        "jail_busts": 0,
        "garage_batch_limit": DEFAULT_GARAGE_BATCH_LIMIT,
        "total_crimes": 0,
        "crime_profit": 0,
        "total_gta": 0,
        "current_state": owner_user.get("current_state", "Chicago"),
        "total_kills": 0,
        "total_deaths": 0,
        "in_jail": False,
        "jail_until": None,
        "premium_rank_bar": False,
        "custom_car_name": None,
        "travels_this_hour": 0,
        "travel_reset_time": now_iso,
        "extra_airmiles": 0,
        "health": DEFAULT_HEALTH,
        "armour_level": 0,
        "armour_owned_level_max": 0,
        "equipped_weapon_id": None,
        "kill_inflation": 0.0,
        "kill_inflation_updated_at": now_iso,
        "is_dead": False,
        "dead_at": None,
        "points_at_death": None,
        "retrieval_used": False,
        "last_seen": now_iso,
        "created_at": now_iso,
        "is_npc": True,
        "is_bodyguard": True,
        "bodyguard_owner_id": owner_user["id"],
    }
    await db.users.insert_one(robot_doc)
    return robot_user_id, username

@api_router.get("/bodyguards", response_model=List[BodyguardResponse])
async def get_bodyguards(current_user: dict = Depends(get_current_user)):
    bodyguards = await db.bodyguards.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(10)
    
    result = []
    for i in range(4):
        bg = next((b for b in bodyguards if b["slot_number"] == i + 1), None)
        if bg:
            username = None
            rank_name = None
            if not bg["is_robot"] and bg.get("bodyguard_user_id"):
                bg_user = await db.users.find_one(
                    {"id": bg["bodyguard_user_id"]},
                    {"_id": 0, "username": 1, "rank_points": 1}
                )
                username = bg_user["username"] if bg_user else "Unknown"
                if bg_user:
                    _, rank_name = get_rank_info(int(bg_user.get("rank_points", 0) or 0))
            elif bg["is_robot"]:
                # Prefer user doc username if we created a real robot user
                if bg.get("bodyguard_user_id"):
                    bg_user = await db.users.find_one(
                        {"id": bg["bodyguard_user_id"]},
                        {"_id": 0, "username": 1, "rank_points": 1}
                    )
                    username = bg_user["username"] if bg_user else None
                    if bg_user:
                        _, rank_name = get_rank_info(int(bg_user.get("rank_points", 0) or 0))
                username = username or bg.get("robot_name") or f"Robot Guard #{i + 1}"
            
            result.append(BodyguardResponse(
                slot_number=i + 1,
                is_robot=bg["is_robot"],
                bodyguard_username=username,
                bodyguard_rank_name=rank_name,
                armour_level=int(bg.get("armour_level", 0) or 0),
                hired_at=bg["hired_at"]
            ))
        else:
            result.append(BodyguardResponse(
                slot_number=i + 1,
                is_robot=False,
                bodyguard_username=None,
                bodyguard_rank_name=None,
                armour_level=0,
                hired_at=None
            ))
    
    return result

@api_router.post("/bodyguards/armour/upgrade")
async def upgrade_bodyguard_armour(slot: int, current_user: dict = Depends(get_current_user)):
    """Upgrade a bodyguard's armour level (0..5). Applies to robot or human bodyguards."""
    if slot < 1 or slot > 4:
        raise HTTPException(status_code=400, detail="Invalid slot")
    bg = await db.bodyguards.find_one({"user_id": current_user["id"], "slot_number": slot}, {"_id": 0})
    if not bg or not bg.get("bodyguard_user_id"):
        raise HTTPException(status_code=404, detail="No bodyguard in that slot")

    cur_level = int(bg.get("armour_level", 0) or 0)
    if cur_level >= 5:
        raise HTTPException(status_code=400, detail="Bodyguard armour is already maxed")

    ev = await get_effective_event()
    cost = int(BODYGUARD_ARMOUR_UPGRADE_COSTS.get(cur_level, 0) * ev.get("bodyguard_cost", 1.0))
    if cost <= 0:
        raise HTTPException(status_code=400, detail="Invalid armour upgrade cost")
    if int(current_user.get("points", 0) or 0) < cost:
        raise HTTPException(status_code=400, detail="Insufficient points")

    new_level = cur_level + 1
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": -cost}})
    await db.bodyguards.update_one(
        {"user_id": current_user["id"], "slot_number": slot},
        {"$set": {"armour_level": new_level}}
    )
    # Keep the bodyguard user doc armour in sync (affects bullets-to-kill)
    await db.users.update_one({"id": bg["bodyguard_user_id"]}, {"$set": {"armour_level": new_level}})

    return {"message": f"Upgraded bodyguard armour to level {new_level} for {cost} points", "armour_level": new_level, "cost": cost}

@api_router.post("/bodyguards/slot/buy")
async def buy_bodyguard_slot(current_user: dict = Depends(get_current_user)):
    if current_user["bodyguard_slots"] >= 4:
        raise HTTPException(status_code=400, detail="All bodyguard slots already purchased")
    
    ev = await get_effective_event()
    cost = int(BODYGUARD_SLOT_COSTS[current_user["bodyguard_slots"]] * ev.get("bodyguard_cost", 1.0))
    if current_user["points"] < cost:
        raise HTTPException(status_code=400, detail="Insufficient points")
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -cost, "bodyguard_slots": 1}}
    )
    
    return {"message": f"Bodyguard slot purchased for {cost} points"}

@api_router.post("/bodyguards/hire")
async def hire_bodyguard(request: BodyguardHireRequest, current_user: dict = Depends(get_current_user)):
    slot = request.slot
    is_robot = request.is_robot
    if slot < 1 or slot > current_user["bodyguard_slots"]:
        raise HTTPException(status_code=400, detail="Invalid bodyguard slot")
    
    existing = await db.bodyguards.find_one(
        {"user_id": current_user["id"], "slot_number": slot},
        {"_id": 0}
    )
    
    if existing:
        raise HTTPException(status_code=400, detail="Slot already occupied")
    
    ev = await get_effective_event()
    base_cost = BODYGUARD_SLOT_COSTS[slot - 1]
    cost = int(base_cost * 1.5) if is_robot else base_cost
    cost = int(cost * ev.get("bodyguard_cost", 1.0))
    
    if current_user["points"] < cost:
        raise HTTPException(status_code=400, detail="Insufficient points")
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -cost}}
    )
    
    robot_name = None
    robot_user_id = None
    if is_robot:
        robot_user_id, robot_name = await _create_robot_bodyguard_user(current_user)
    
    bodyguard_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "slot_number": slot,
        "is_robot": is_robot,
        "robot_name": robot_name,
        "bodyguard_user_id": robot_user_id if is_robot else None,
        "health": 100,
        "armour_level": 0,
        "hired_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.bodyguards.insert_one(bodyguard_doc)
    
    # Send notification
    await send_notification(
        current_user["id"],
        "🛡️ Bodyguard Hired",
        f"You've hired {robot_name if is_robot else 'a human bodyguard slot'} for {cost} points.",
        "bodyguard"
    )
    
    return {"message": f"{'Robot bodyguard ' + robot_name if is_robot else 'Human bodyguard slot'} hired for {cost} points", "bodyguard_name": robot_name}


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

    # Booze run: prices rotate every BOOZE_ROTATION_HOURS. Show "Booze prices just changed!" for the first 3h of each rotation.
    try:
        rotation_index = _booze_rotation_index()
        rotation_start_ts = rotation_index * BOOZE_ROTATION_HOURS * 3600
        rotation_start_iso = datetime.fromtimestamp(rotation_start_ts, tz=timezone.utc).isoformat()
        if now_ts - rotation_start_ts < BOOZE_ROTATION_HOURS * 3600:  # within current rotation window
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




# Attack endpoints
@api_router.post("/attack/search", response_model=AttackSearchResponse)
async def search_target(request: AttackSearchRequest, current_user: dict = Depends(get_current_user)):
    # Prune expired searches (24h)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    await db.attacks.delete_many({"attacker_id": current_user["id"], "search_started": {"$lte": cutoff.isoformat()}})

    target = await db.users.find_one({"username": request.target_username}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    if target.get("is_dead"):
        raise HTTPException(status_code=400, detail="That account is dead and cannot be attacked")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot attack yourself")

    # Allow multiple concurrent attacks, but prevent duplicates for the same target
    existing_attack_for_target = await db.attacks.find_one(
        {"attacker_id": current_user["id"], "target_id": target["id"], "status": {"$in": ["searching", "found"]}},
        {"_id": 0}
    )
    if existing_attack_for_target:
        raise HTTPException(status_code=400, detail="You already have an active search/attack for this target")
    
    now = datetime.now(timezone.utc)
    override_minutes = current_user.get("search_minutes_override")
    if override_minutes is not None:
        try:
            override_minutes = int(override_minutes)
        except Exception:
            override_minutes = None
    search_duration = int(override_minutes) if override_minutes and override_minutes > 0 else random.randint(120, 180)
    found_at = now + timedelta(minutes=search_duration)
    expires_at = now + timedelta(hours=24)
    
    attack_id = str(uuid.uuid4())
    note = (request.note or "").strip()
    note = note[:80] if note else None
    await db.attacks.insert_one({
        "id": attack_id,
        "attacker_id": current_user["id"],
        "target_id": target["id"],
        "target_username": target["username"],
        "note": note,
        "status": "searching",
        "search_started": now.isoformat(),
        "found_at": found_at.isoformat(),
        "expires_at": expires_at.isoformat(),
        # Don't reveal location until found
        "planned_location_state": random.choice(STATES),
        "location_state": None,
        "result": None,
        "rewards": None
    })
    
    return AttackSearchResponse(
        attack_id=attack_id,
        status="searching",
        message=f"Searching for {request.target_username}...",
        estimated_completion=found_at.isoformat()
    )

@api_router.get("/attack/status", response_model=AttackStatusResponse)
async def get_attack_status(current_user: dict = Depends(get_current_user)):
    attack = await db.attacks.find_one(
        {"attacker_id": current_user["id"], "status": {"$in": ["searching", "found", "traveling"]}},
        {"_id": 0}
    )
    
    if not attack:
        raise HTTPException(status_code=404, detail="No active attack")
    
    now = datetime.now(timezone.utc)
    found_time = datetime.fromisoformat(attack["found_at"])
    
    if attack["status"] == "searching" and now >= found_time:
        new_location = attack.get("location_state") or attack.get("planned_location_state") or random.choice(STATES)
        await db.attacks.update_one(
            {"id": attack["id"]},
            {"$set": {"status": "found", "location_state": new_location}}
        )
        attack["status"] = "found"
        attack["location_state"] = new_location
    
    can_travel = attack["status"] == "found" and attack.get("location_state") and current_user["current_state"] != attack["location_state"]
    can_attack = attack["status"] == "found" and attack.get("location_state") and current_user["current_state"] == attack["location_state"]
    
    message = ""
    if attack["status"] == "searching":
        message = "Searching..."
    elif attack["status"] == "found":
        if can_attack:
            message = f"Target found in {attack['location_state']}! You are in the same location. Ready to attack!"
        else:
            message = f"Target found in {attack['location_state']}! Travel there to attack."
    
    return AttackStatusResponse(
        attack_id=attack["id"],
        status=attack["status"],
        target_username=attack["target_username"],
        location_state=attack.get("location_state"),
        can_travel=can_travel,
        can_attack=can_attack,
        message=message
    )

@api_router.get("/attack/list")
async def list_attacks(current_user: dict = Depends(get_current_user)):
    """List all active attacks for the current user (searching/found)."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=24)

    # Prune expired searches (new docs have expires_at, legacy fallback uses search_started)
    await db.attacks.delete_many({"attacker_id": current_user["id"], "expires_at": {"$lte": now.isoformat()}})

    attacks = await db.attacks.find(
        {"attacker_id": current_user["id"], "status": {"$in": ["searching", "found"]}},
        {"_id": 0}
    ).sort("search_started", -1).to_list(50)
    items = []
    for attack in attacks:
        # Legacy expiry fallback (no expires_at)
        if not attack.get("expires_at"):
            started_iso = attack.get("search_started") or attack.get("found_at")
            try:
                started = datetime.fromisoformat(started_iso) if started_iso else None
                if started and started.tzinfo is None:
                    started = started.replace(tzinfo=timezone.utc)
            except Exception:
                started = None
            if started and started <= cutoff:
                await db.attacks.delete_one({"id": attack["id"], "attacker_id": current_user["id"]})
                continue
            if started:
                await db.attacks.update_one(
                    {"id": attack["id"], "attacker_id": current_user["id"]},
                    {"$set": {"expires_at": (started + timedelta(hours=24)).isoformat()}}
                )

        if attack["status"] == "searching":
            found_time = datetime.fromisoformat(attack["found_at"])
            if now >= found_time:
                new_location = attack.get("location_state") or attack.get("planned_location_state") or random.choice(STATES)
                await db.attacks.update_one({"id": attack["id"]}, {"$set": {"status": "found", "location_state": new_location}})
                attack["status"] = "found"
                attack["location_state"] = new_location

        can_travel = attack["status"] == "found" and attack.get("location_state") and current_user["current_state"] != attack["location_state"]
        can_attack = attack["status"] == "found" and attack.get("location_state") and current_user["current_state"] == attack["location_state"]

        if attack["status"] == "searching":
            msg = "Searching..."
        else:
            msg = (
                f"Target found in {attack['location_state']}! You are in the same location. Ready to attack!"
                if can_attack
                else f"Target found in {attack['location_state']}! Travel there to attack."
            )

        item = {
            "attack_id": attack["id"],
            "status": attack["status"],
            "target_username": attack["target_username"],
            "note": attack.get("note"),
            # Never reveal location while searching (older records may still have it populated)
            "location_state": attack.get("location_state") if attack["status"] == "found" else None,
            "search_started": attack.get("search_started"),
            "found_at": attack.get("found_at"),
            "expires_at": attack.get("expires_at"),
            "can_travel": can_travel,
            "can_attack": can_attack,
            "message": msg
        }
        # For found attacks, include first bodyguard so UI can show "has bodyguard X, kill them first" + search link
        if attack["status"] == "found" and attack.get("target_id"):
            target_bgs = await db.bodyguards.find({"user_id": attack["target_id"]}, {"_id": 0}).to_list(10)
            if target_bgs:
                first_bg = target_bgs[0]
                search_username = None
                display_name = first_bg.get("robot_name") or "bodyguard"
                if first_bg.get("bodyguard_user_id"):
                    bg_user = await db.users.find_one({"id": first_bg["bodyguard_user_id"]}, {"_id": 0, "username": 1})
                    if bg_user:
                        search_username = bg_user.get("username")
                        if not first_bg.get("robot_name"):
                            display_name = search_username
                if search_username:
                    item["first_bodyguard"] = {"display_name": display_name, "search_username": search_username}
                    item["bodyguard_count"] = len(target_bgs)
        items.append(item)

    return {"attacks": items}

@api_router.post("/attack/delete")
async def delete_attacks(request: AttackDeleteRequest, current_user: dict = Depends(get_current_user)):
    ids = [x for x in (request.attack_ids or []) if isinstance(x, str) and x.strip()]
    ids = list(dict.fromkeys(ids))  # dedupe
    if not ids:
        raise HTTPException(status_code=400, detail="No attack ids provided")

    res = await db.attacks.delete_many({"attacker_id": current_user["id"], "id": {"$in": ids}})
    return {"message": f"Deleted {res.deleted_count} search(es)", "deleted": res.deleted_count}

@api_router.post("/attack/travel")
async def travel_to_target(request: AttackIdRequest, current_user: dict = Depends(get_current_user)):
    attack = await db.attacks.find_one(
        {"attacker_id": current_user["id"], "status": "found", "id": request.attack_id},
        {"_id": 0}
    )
    
    if not attack:
        raise HTTPException(status_code=404, detail="No target found to travel to")
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"current_state": attack["location_state"]}}
    )
    
    return {"message": f"Traveled to {attack['location_state']}"}

async def _best_weapon_for_user(user_id: str, equipped_weapon_id: str | None = None) -> tuple[int, str]:
    """
    Return (damage, weapon_name) for combat.
    If equipped_weapon_id is provided and owned, use it; otherwise fall back to best owned.
    """
    user_weapons = await db.user_weapons.find({"user_id": user_id, "quantity": {"$gt": 0}}, {"_id": 0}).to_list(100)
    weapons_list = await db.weapons.find({}, {"_id": 0, "id": 1, "damage": 1, "name": 1}).to_list(200)

    owned_ids = {uw.get("weapon_id") for uw in user_weapons}
    if equipped_weapon_id and equipped_weapon_id in owned_ids:
        w = next((x for x in weapons_list if x.get("id") == equipped_weapon_id), None)
        if w:
            return int(w.get("damage", 5) or 5), (w.get("name") or "Weapon")

    best_damage = 5
    best_name = "Brass Knuckles"
    for uw in user_weapons:
        w = next((x for x in weapons_list if x.get("id") == uw.get("weapon_id")), None)
        dmg = int(w.get("damage", 0) or 0) if w else 0
        if dmg > best_damage:
            best_damage = dmg
            best_name = w.get("name") or best_name
    return best_damage, best_name

def _bullets_to_kill(
    target_armour_level: int,
    target_rank_id: int,
    attacker_weapon_damage: int,
    attacker_rank_id: int,
) -> int:
    """
    Bullets required to kill target (clamped 5k–100k).

    Design goals:
    - Higher target rank => more bullets needed.
    - Higher armour => more bullets needed.
    - Higher attacker weapon/rank => fewer bullets needed.
    - Big rank gaps still stay expensive (e.g. Goon vs Godfather >= 30k+ even with best weapon).
    """
    arm = min(max(0, int(target_armour_level or 0)), 5)
    tr = min(max(1, int(target_rank_id or 1)), 11)
    ar = min(max(1, int(attacker_rank_id or 1)), 11)
    dmg = max(5, int(attacker_weapon_damage or 5))

    base = ARMOUR_BASE_BULLETS.get(arm, MIN_BULLETS_TO_KILL)

    # Defender scaling (rank + rank gap)
    gap = max(0, tr - ar)
    rank_factor = 1.0 + (tr - 1) * 0.20          # up to 3.0x at rank 11
    gap_factor = 1.0 + gap * 0.60                # big gaps hurt a lot

    # Attacker reductions (weapon + rank)
    weapon_factor = 1.0 + (dmg / 140.0)          # best weapon ~1.85x
    attacker_factor = 1.0 + (ar - 1) * 0.05      # rank 11 ~1.5x

    needed_raw = (base * rank_factor * gap_factor) / weapon_factor / attacker_factor

    needed_i = int(math.ceil(needed_raw))
    # No artificial floor and no max cap (per request).
    return max(1, needed_i)

def _bullets_to_kill_breakdown(
    target_armour_level: int,
    target_rank_id: int,
    attacker_weapon_damage: int,
    attacker_rank_id: int,
) -> dict:
    """Same logic as _bullets_to_kill, but returns a breakdown for UI/debug."""
    arm = min(max(0, int(target_armour_level or 0)), 5)
    tr = min(max(1, int(target_rank_id or 1)), 11)
    ar = min(max(1, int(attacker_rank_id or 1)), 11)
    dmg = max(5, int(attacker_weapon_damage or 5))

    base = ARMOUR_BASE_BULLETS.get(arm, MIN_BULLETS_TO_KILL)
    gap = max(0, tr - ar)
    rank_factor = 1.0 + (tr - 1) * 0.20
    gap_factor = 1.0 + gap * 0.60
    weapon_factor = 1.0 + (dmg / 140.0)
    attacker_factor = 1.0 + (ar - 1) * 0.05

    needed_raw = (base * rank_factor * gap_factor) / weapon_factor / attacker_factor
    needed_before_clamp = int(math.ceil(needed_raw))
    bullets_required = max(1, needed_before_clamp)

    return {
        "base_from_armour": base,
        "rank_factor": round(rank_factor, 3),
        "gap_factor": round(gap_factor, 3),
        "weapon_factor": round(weapon_factor, 3),
        "attacker_factor": round(attacker_factor, 3),
        "rank_gap": gap,
        "needed_raw": needed_raw,
        "needed_before_clamp": needed_before_clamp,
        "bullets_required": bullets_required,
    }

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


@api_router.post("/attack/bullets/calc")
async def calc_bullets(request: BulletCalcRequest, current_user: dict = Depends(get_current_user)):
    """Bullet calculator helper for UI (does not spend bullets)."""
    target_username = (request.target_username or "").strip()
    if not target_username:
        raise HTTPException(status_code=400, detail="Target username required")

    target = await db.users.find_one({"username": target_username}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    if target.get("is_dead"):
        raise HTTPException(status_code=400, detail="Target is dead")

    attacker_rank_id, attacker_rank_name = get_rank_info(current_user.get("rank_points", 0))
    target_rank_id, target_rank_name = get_rank_info(target.get("rank_points", 0))
    target_armour = int(target.get("armour_level", 0) or 0)

    inflation = await _apply_kill_inflation_decay(current_user["id"])
    best_damage, best_weapon_name = await _best_weapon_for_user(
        current_user["id"],
        current_user.get("equipped_weapon_id")
    )

    breakdown = _bullets_to_kill_breakdown(target_armour, target_rank_id, best_damage, attacker_rank_id)
    bullets_base = int(breakdown["bullets_required"])
    bullets_required = int(math.ceil(bullets_base * (1.0 + inflation)))

    return {
        "target_username": target["username"],
        "target_rank": target_rank_id,
        "target_rank_name": target_rank_name,
        "target_armour_level": target_armour,
        "attacker_rank": attacker_rank_id,
        "attacker_rank_name": attacker_rank_name,
        "weapon_name": best_weapon_name,
        "weapon_damage": best_damage,
        "bullets_required": bullets_required,
        "bullets_base": bullets_base,
        "inflation": inflation,
        "inflation_pct": int(round(inflation * 100)),
        "needed_before_clamp": breakdown["needed_before_clamp"],
    }

@api_router.get("/attack/inflation")
async def get_attack_inflation(current_user: dict = Depends(get_current_user)):
    """Get current inflation % (decayed)."""
    inflation = await _apply_kill_inflation_decay(current_user["id"])
    return {
        "inflation": inflation,
        "inflation_pct": int(round(inflation * 100)),
    }


@api_router.post("/attack/execute", response_model=AttackExecuteResponse)
async def execute_attack(request: AttackExecuteRequest, current_user: dict = Depends(get_current_user)):
    attack = await db.attacks.find_one(
        {"attacker_id": current_user["id"], "status": "found", "id": request.attack_id},
        {"_id": 0}
    )
    
    if not attack:
        raise HTTPException(status_code=404, detail="No active attack to execute")
    
    if current_user["current_state"] != attack["location_state"]:
        raise HTTPException(status_code=400, detail="You must travel to the target's location first")
    
    target = await db.users.find_one({"id": attack["target_id"]}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    if target.get("is_dead"):
        raise HTTPException(status_code=400, detail="Target is already dead")
    
    target_armour = target.get("armour_level", 0)
    attacker_rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
    target_rank_id, _ = get_rank_info(target.get("rank_points", 0))
    attacker_bullets = current_user.get("bullets", 0)
    
    # Best weapon attacker has (by damage)
    best_damage, _ = await _best_weapon_for_user(
        current_user["id"],
        current_user.get("equipped_weapon_id")
    )
    inflation = await _apply_kill_inflation_decay(current_user["id"])
    bullets_base = _bullets_to_kill(target_armour, target_rank_id, best_damage, attacker_rank_id)
    bullets_required = int(math.ceil(bullets_base * (1.0 + inflation)))
    
    if attacker_bullets <= 0:
        raise HTTPException(status_code=400, detail="You need bullets to attack.")

    # If target has bodyguards, do not execute — tell frontend to show message and offer search for bodyguard
    target_bodyguards = await db.bodyguards.find({"user_id": target["id"]}, {"_id": 0}).to_list(10)
    if target_bodyguards:
        first_bg = target_bodyguards[0]
        display_name = first_bg.get("robot_name") or "bodyguard"
        search_username = None
        if first_bg.get("bodyguard_user_id"):
            bg_user = await db.users.find_one({"id": first_bg["bodyguard_user_id"]}, {"_id": 0, "username": 1})
            if bg_user:
                search_username = bg_user.get("username")
                if not first_bg.get("robot_name"):
                    display_name = search_username
        if search_username:
            target_name = target["username"]
            return AttackExecuteResponse(
                success=False,
                message=f"{target_name} has a bodyguard called {display_name}. You need to kill them first.",
                rewards=None,
                first_bodyguard={"display_name": display_name, "search_username": search_username},
            )
        # fallback if no linked user
        target_name = target["username"]
        return AttackExecuteResponse(
            success=False,
            message=f"{target_name} has a bodyguard. You need to kill them first.",
            rewards=None,
        )
    
    target_name = target["username"]
    target_health = float(target.get("health", DEFAULT_HEALTH))
    # If player specified how many bullets to use, cap it to what they have
    if request.bullets_to_use and request.bullets_to_use > 0:
        bullets_used = min(request.bullets_to_use, attacker_bullets, bullets_required)
    else:
        bullets_used = min(attacker_bullets, bullets_required)
    health_dealt_pct = (bullets_used / bullets_required) * 100.0
    killed = health_dealt_pct >= target_health
    
    # Spend bullets used
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"bullets": -bullets_used}}
    )

    # Record the attempt (success/fail) for history page
    attempt_base = {
        "id": str(uuid.uuid4()),
        "attacker_id": current_user["id"],
        "attacker_username": current_user["username"],
        "target_id": target["id"],
        "target_username": target_name,
        "attack_id": attack["id"],
        "location_state": attack.get("location_state"),
        "bullets_used": int(bullets_used),
        "bullets_required": int(bullets_required),
        "bullets_base": int(bullets_base),
        "inflation_pct": int(round(inflation * 100)),
        "target_armour_level": int(target_armour or 0),
        "target_rank_id": int(target_rank_id or 1),
        "attacker_rank_id": int(attacker_rank_id or 1),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    if killed:
        death_message = (request.death_message or "").strip()
        make_public = bool(request.make_public)

        # Increase inflation on successful kill
        await _increase_kill_inflation_on_kill(current_user["id"])
        killer_id = current_user["id"]
        victim_id = target["id"]
        victim_money = int(target.get("money", 0))
        cash_loot = int(victim_money * KILL_CASH_PERCENT)
        rank_points = 25
        ev = await get_effective_event()
        cash_loot = int(cash_loot * ev.get("kill_cash", 1.0))
        rank_points = int(rank_points * ev.get("rank_points", 1.0))
        
        victim_cars = await db.user_cars.find({"user_id": victim_id}, {"_id": 0, "car_id": 1}).to_list(500)
        victim_props = await db.user_properties.find({"user_id": victim_id}, {"_id": 0, "property_id": 1}).to_list(100)
        victim_cars_count = len(victim_cars)
        victim_props_count = len(victim_props)
        
        exclusive_car_count = 0
        for uc in victim_cars:
            car_info = next((c for c in CARS if c["id"] == uc["car_id"]), None)
            if car_info and car_info.get("rarity") == "exclusive":
                exclusive_car_count += 1
        
        prop_names = []
        for up in victim_props:
            p = await db.properties.find_one({"id": up["property_id"]}, {"_id": 0, "name": 1})
            if p:
                prop_names.append(p["name"])
        
        await db.users.update_one(
            {"id": killer_id},
            {"$inc": {"money": cash_loot, "total_kills": 1, "rank_points": rank_points}}
        )
        await db.user_cars.update_many({"user_id": victim_id}, {"$set": {"user_id": killer_id}})
        await db.user_properties.update_many({"user_id": victim_id}, {"$set": {"user_id": killer_id}})
        
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"id": victim_id},
            {"$set": {
                "is_dead": True,
                "dead_at": now_iso,
                "points_at_death": target.get("points", 0),
                "money": 0,
                "health": 0
            }, "$inc": {"total_deaths": 1}}
        )
        # If the victim was someone's bodyguard, remove them and the owner permanently loses that slot
        victim_as_bodyguard = await db.bodyguards.find({"bodyguard_user_id": victim_id}, {"_id": 0, "id": 1, "user_id": 1}).to_list(10)
        bodyguard_owner_username = None
        for bg in victim_as_bodyguard:
            owner_id = bg["user_id"]
            # Lookup owner username for attempt history
            owner_doc = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1, "family_id": 1})
            if owner_doc:
                bodyguard_owner_username = owner_doc.get("username")
            await db.bodyguards.delete_one({"id": bg["id"]})
            await db.users.update_one({"id": owner_id}, {"$inc": {"bodyguard_slots": -1}})
            await db.users.update_one({"id": owner_id, "bodyguard_slots": {"$lt": 0}}, {"$set": {"bodyguard_slots": 0}})
            # Record war stats for bodyguard kill
            try:
                owner_family_id = (owner_doc or {}).get("family_id")
                if owner_family_id and killer_family_id:
                    bg_war = await _get_active_war_between(killer_family_id, owner_family_id)
                    if bg_war and bg_war.get("id"):
                        await _record_war_stats_bodyguard_kill(bg_war["id"], killer_id, killer_family_id, owner_id, owner_family_id)
            except Exception as e:
                logging.exception("War stats bodyguard kill: %s", e)
            # Renumber owner's remaining bodyguards so slot_numbers are 1..n
            remaining = await db.bodyguards.find({"user_id": owner_id}, {"_id": 0, "id": 1, "slot_number": 1}).sort("slot_number", 1).to_list(10)
            for i, b in enumerate(remaining, 1):
                if b["slot_number"] != i:
                    await db.bodyguards.update_one({"id": b["id"]}, {"$set": {"slot_number": i}})
        # Store bodyguard info in attempt_base for history
        is_victim_bodyguard = bool(target.get("is_bodyguard"))
        attempt_base["is_bodyguard_kill"] = is_victim_bodyguard
        if is_victim_bodyguard and bodyguard_owner_username:
            attempt_base["bodyguard_owner_username"] = bodyguard_owner_username

        success_message = f"You killed {target_name}! You got ${cash_loot:,}"
        extras = []
        if victim_props_count:
            p = f"their {victim_props_count} propert{'y' if victim_props_count == 1 else 'ies'}"
            if prop_names:
                p += f" ({', '.join(prop_names)})"
            extras.append(p)
        if victim_cars_count:
            c = f"their {victim_cars_count} car{'s' if victim_cars_count != 1 else ''}"
            if exclusive_car_count:
                c += f" (including {'an' if exclusive_car_count == 1 else exclusive_car_count} exclusive car{'s' if exclusive_car_count != 1 else ''})"
            extras.append(c)
        if extras:
            success_message += ", " + ", ".join(extras) + "."
        else:
            success_message += " and their assets."

        if death_message:
            success_message += f' Death message: "{death_message}"'

        if make_public:
            try:
                await db.public_kills.insert_one({
                    "id": str(uuid.uuid4()),
                    "killer_id": current_user["id"],
                    "killer_username": current_user["username"],
                    "victim_id": victim_id,
                    "victim_username": target_name,
                    "death_message": death_message or None,
                    "bullets_used": bullets_used,
                    "bullets_required": bullets_required,
                    "make_public": True,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception:
                pass
        
        await db.attacks.update_one(
            {"id": attack["id"]},
            {"$set": {
                "status": "completed",
                "result": "success",
                "rewards": {
                    "money": cash_loot,
                    "rank_points": rank_points,
                    "cars_taken": victim_cars_count,
                    "properties_taken": victim_props_count,
                    "exclusive_cars": exclusive_car_count
                }
            }}
        )
        await send_notification(killer_id, "Kill", success_message, "attack")

        victim_family_id = target.get("family_id")
        killer_family_id = current_user.get("family_id")
        # Record war stats first: use the war between killer's and victim's family so it shows in killer's modal
        if victim_family_id:
            try:
                if killer_family_id:
                    war = await _get_active_war_between(killer_family_id, victim_family_id)
                else:
                    war = await _get_active_war_for_family(victim_family_id)
                if war and war.get("id"):
                    await _record_war_stats_player_kill(war["id"], killer_id, killer_family_id, victim_id, victim_family_id)
            except Exception as e:
                logging.exception("War stats record on kill: %s", e)
        # Notifications, war start, wipe check — don't fail the request if these error
        if victim_family_id:
            try:
                await send_notification_to_family(
                    victim_family_id,
                    "💀 Family Member Killed",
                    f"{target_name} was killed by {current_user['username']}.",
                    "attack",
                )
                target_role = (target.get("family_role") or "").lower()
                if target_role in ("boss", "underboss", "consigliere"):
                    if killer_family_id:
                        await _family_war_start(killer_family_id, victim_family_id)
                await _family_war_check_wipe_and_award(victim_family_id)
            except Exception as e:
                logging.exception("Family notify/war on kill: %s", e)

        try:
            await db.attack_attempts.insert_one({
                **attempt_base,
                "outcome": "killed",
                "death_message": death_message or None,
                "make_public": make_public,
                "rewards": {"money": cash_loot, "rank_points": rank_points, "cars_taken": victim_cars_count, "properties_taken": victim_props_count},
                "target_health_before": target_health,
                "target_health_after": 0.0,
            })
        except Exception:
            pass
        
        return AttackExecuteResponse(
            success=True,
            message=success_message,
            rewards={"money": cash_loot, "rank_points": rank_points, "cars_taken": victim_cars_count, "properties_taken": victim_props_count, "exclusive_cars": exclusive_car_count}
        )
    else:
        new_health = max(0.0, target_health - health_dealt_pct)
        await db.users.update_one(
            {"id": target["id"]},
            {"$set": {"health": new_health}}
        )
        await db.attacks.update_one(
            {"id": attack["id"]},
            {"$set": {"status": "failed", "result": "failed"}}
        )
        health_pct_str = f"{health_dealt_pct:.1f}" if health_dealt_pct != int(health_dealt_pct) else str(int(health_dealt_pct))
        fail_message = f'You failed to kill {target_name}. You used {bullets_used:,} bullets — they only lost {health_pct_str}% health.'

        try:
            await db.attack_attempts.insert_one({
                **attempt_base,
                "outcome": "failed",
                "death_message": None,
                "make_public": False,
                "rewards": None,
                "target_health_before": target_health,
                "target_health_after": new_health,
                "health_dealt_pct": float(health_dealt_pct),
                "message": fail_message,
            })
        except Exception:
            pass

        return AttackExecuteResponse(
            success=False,
            message=fail_message,
            rewards=None
        )

@api_router.get("/attack/attempts")
async def get_attack_attempts(current_user: dict = Depends(get_current_user)):
    """History of attack attempts involving current user."""
    docs = await db.attack_attempts.find(
        {"$or": [{"attacker_id": current_user["id"]}, {"target_id": current_user["id"]}]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    # Add a direction field for UI and resolve bodyguard owner for older records
    for d in docs:
        d["direction"] = "outgoing" if d.get("attacker_id") == current_user["id"] else "incoming"
        # For older records missing bodyguard info, check if target was a bodyguard
        if d.get("is_bodyguard_kill") and not d.get("bodyguard_owner_username"):
            target_user = await db.users.find_one({"id": d.get("target_id")}, {"_id": 0, "is_bodyguard": 1, "bodyguard_owner_id": 1})
            if target_user and target_user.get("bodyguard_owner_id"):
                owner = await db.users.find_one({"id": target_user["bodyguard_owner_id"]}, {"_id": 0, "username": 1})
                if owner:
                    d["bodyguard_owner_username"] = owner.get("username")
    return {"attempts": docs}

# Leaderboard endpoints
@api_router.get("/leaderboard", response_model=List[LeaderboardEntry])
async def get_leaderboard(current_user: dict = Depends(get_current_user)):
    users = await db.users.find(
        {"is_dead": {"$ne": True}},
        {"_id": 0, "username": 1, "money": 1, "total_kills": 1, "total_crimes": 1, "total_gta": 1, "jail_busts": 1, "id": 1}
    ).sort("money", -1).limit(10).to_list(10)
    
    result = []
    for i, user in enumerate(users):
        result.append(LeaderboardEntry(
            rank=i + 1,
            username=user["username"],
            money=user["money"],
            kills=user["total_kills"],
            crimes=user.get("total_crimes", 0),
            gta=user.get("total_gta", 0),
            jail_busts=user.get("jail_busts", 0),
            is_current_user=user["id"] == current_user["id"]
        ))
    
    return result

async def _top_by_field(field: str, current_user_id: str, limit: int) -> List[StatLeaderboardEntry]:
    limit = max(1, min(100, int(limit)))
    users = await db.users.find(
        {"is_dead": {"$ne": True}},
        {"_id": 0, "username": 1, "id": 1, field: 1}
    ).sort(field, -1).limit(limit).to_list(limit)
    out: List[StatLeaderboardEntry] = []
    for i, user in enumerate(users):
        out.append(StatLeaderboardEntry(
            rank=i + 1,
            username=user["username"],
            value=int(user.get(field, 0) or 0),
            is_current_user=user["id"] == current_user_id
        ))
    return out


@api_router.get("/leaderboards/top")
async def get_top_leaderboards(
    limit: int = Query(10, ge=1, le=100, description="Top N (5, 10, 20, 50, 100)"),
    current_user: dict = Depends(get_current_user),
):
    """Top N leaderboards per stat (kills, crimes, gta, jail busts). Limit 1-100."""
    user_id = current_user["id"]
    kills, crimes, gta, jail_busts = await asyncio.gather(
        _top_by_field("total_kills", user_id, limit),
        _top_by_field("total_crimes", user_id, limit),
        _top_by_field("total_gta", user_id, limit),
        _top_by_field("jail_busts", user_id, limit),
    )
    return {"kills": kills, "crimes": crimes, "gta": gta, "jail_busts": jail_busts}

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

# ============ NOTIFICATION/INBOX ENDPOINTS ============

@api_router.get("/notifications")
async def get_notifications(current_user: dict = Depends(get_current_user)):
    notifications = await db.notifications.find(
        {"user_id": current_user["id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    
    unread_count = await db.notifications.count_documents({"user_id": current_user["id"], "read": False})
    
    return {"notifications": notifications, "unread_count": unread_count}

@api_router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, current_user: dict = Depends(get_current_user)):
    await db.notifications.update_one(
        {"id": notification_id, "user_id": current_user["id"]},
        {"$set": {"read": True}}
    )
    return {"message": "Notification marked as read"}

@api_router.post("/notifications/read-all")
async def mark_all_notifications_read(current_user: dict = Depends(get_current_user)):
    await db.notifications.update_many(
        {"user_id": current_user["id"], "read": False},
        {"$set": {"read": True}}
    )
    return {"message": "All notifications marked as read"}

# ============ BOOZE RUN (Supply Run / Prohibition) ============
# 6 historically accurate prohibition-era booze types. Prices rotate every 3 hours per location.
BOOZE_ROTATION_HOURS = 3
BOOZE_TYPES = [
    {"id": "bathtub_gin", "name": "Bathtub Gin"},
    {"id": "moonshine", "name": "Moonshine"},
    {"id": "rum_runners", "name": "Rum Runner's Rum"},
    {"id": "speakeasy_whiskey", "name": "Speakeasy Whiskey"},
    {"id": "needle_beer", "name": "Needle Beer"},
    {"id": "jamaica_ginger", "name": "Jamaica Ginger"},
]
# Base capacity (units) by rank index 1..11. Upgrade available on points store.
BOOZE_CAPACITY_BY_RANK = [50, 75, 100, 150, 200, 280, 360, 450, 550, 700, 900]
BOOZE_CAPACITY_UPGRADE_COST = 30  # points per +50 capacity
BOOZE_CAPACITY_UPGRADE_AMOUNT = 50
BOOZE_RUN_HISTORY_MAX = 10
BOOZE_RUN_CAUGHT_CHANCE = 1.0   # 100% for testing; set to 0.05 for production
BOOZE_RUN_JAIL_SECONDS = 20     # seconds in jail when caught


def _booze_rotation_index():
    """Current 3-hour window index (same for all users)."""
    return int(datetime.now(timezone.utc).timestamp() // (BOOZE_ROTATION_HOURS * 3600))


def _booze_rotation_ends_at():
    """ISO timestamp when current rotation ends."""
    idx = _booze_rotation_index()
    end_ts = (idx + 1) * BOOZE_ROTATION_HOURS * 3600
    return datetime.fromtimestamp(end_ts, tz=timezone.utc).isoformat()


def _booze_prices_for_rotation():
    """Per (location_index, booze_index): (buy_price, sell_price). Deterministic from rotation."""
    idx = _booze_rotation_index()
    n_locs = 4  # len(STATES) - avoid forward ref
    n_booze = len(BOOZE_TYPES)
    out = {}
    for loc_i in range(n_locs):
        for booze_i in range(n_booze):
            # Deterministic: no random module
            base = 200 + (loc_i * 100) + (booze_i * 80) + (idx % 17) * 20
            spread = 150 + (idx + loc_i + booze_i) % 200
            buy = min(2000, max(100, base))
            sell = buy + spread
            out[(loc_i, booze_i)] = (buy, sell)
    return out


# ============ TRAVEL ENDPOINTS ============

STATES = ["Chicago", "New York", "Los Angeles", "Miami"]

# Casino games and max bets (same in every city; exposed for States page)
CASINO_GAMES = [
    {"id": "blackjack", "name": "Blackjack", "max_bet": BLACKJACK_MAX_BET},
    {"id": "horseracing", "name": "Horse Racing", "max_bet": HORSERACING_MAX_BET},
    {"id": "roulette", "name": "Roulette", "max_bet": ROULETTE_MAX_BET},
    {"id": "dice", "name": "Dice", "max_bet": DICE_MAX_BET},
]

@api_router.get("/states")
async def get_states(current_user: dict = Depends(get_current_user)):
    """List all cities (travel destinations), casino games with max bet, and dice owners per city."""
    dice_docs = await db.dice_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1}).to_list(20)
    owner_ids = list({d["owner_id"] for d in dice_docs if d.get("owner_id")})
    users = await db.users.find({"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "username": 1, "money": 1}).to_list(len(owner_ids) or 1)
    user_map = {u["id"]: u for u in users}
    dice_owners = {}
    for d in dice_docs:
        if not d.get("owner_id"):
            continue
        u = user_map.get(d["owner_id"], {})
        money = int((u.get("money") or 0) or 0)
        _, wealth_rank_name = get_wealth_rank(money)
        dice_max = d.get("max_bet") if d.get("max_bet") is not None else DICE_MAX_BET
        dice_owners[d["city"]] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "max_bet": dice_max}
    return {"cities": list(STATES), "games": CASINO_GAMES, "dice_owners": dice_owners}


# ============ Casino Dice Game API ============
DICE_CLAIM_COST_POINTS = 0  # cost in points to claim a dice table (0 = free)

def _normalize_city_for_dice(city_raw: str) -> str:
    """Return city normalized to one of STATES (case-insensitive match), or first state if no match."""
    if not (city_raw or "").strip():
        return STATES[0] if STATES else ""
    c = (city_raw or "").strip()
    for s in (STATES or []):
        if s and c.lower() == s.lower():
            return s
    return STATES[0] if STATES else c


@api_router.get("/casino/dice/config")
async def casino_dice_config(current_user: dict = Depends(get_current_user)):
    """Dice game config: sides range and default max bet."""
    return {
        "sides_min": DICE_SIDES_MIN,
        "sides_max": DICE_SIDES_MAX,
        "max_bet": DICE_MAX_BET,
    }


async def _get_dice_ownership_doc(city: str):
    """Get dice ownership doc for a city (case-insensitive match). Returns (normalized_city, doc)."""
    if not city:
        return None, None
    pattern = re.compile(f"^{re.escape(city)}$", re.IGNORECASE)
    doc = await db.dice_ownership.find_one({"city": pattern}, {"_id": 0})
    if doc:
        return doc.get("city") or city, doc
    # Also try exact match with normalized city
    norm = _normalize_city_for_dice(city)
    doc = await db.dice_ownership.find_one({"city": norm}, {"_id": 0})
    if doc:
        return norm, doc
    return norm, None


@api_router.get("/casino/dice/ownership")
async def casino_dice_ownership(current_user: dict = Depends(get_current_user)):
    """Current city's dice ownership and effective max_bet (owner's or default)."""
    raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
    city = _normalize_city_for_dice(raw) if raw else (STATES[0] if STATES else "")
    if not city:
        return {"current_city": None, "owner": None, "is_owner": False, "max_bet": DICE_MAX_BET, "buy_back_reward": None}
    _, doc = await _get_dice_ownership_doc(city)
    if not doc:
        return {"current_city": city, "owner": None, "is_owner": False, "max_bet": DICE_MAX_BET, "buy_back_reward": None}
    owner_id = doc.get("owner_id")
    max_bet = doc.get("max_bet")
    if max_bet is None:
        max_bet = DICE_MAX_BET
    buy_back_reward = doc.get("buy_back_reward")
    is_owner = current_user["id"] == owner_id
    owner = None
    if owner_id:
        u = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1, "money": 1})
        if u:
            _, wealth_rank_name = get_wealth_rank(int((u.get("money") or 0) or 0))
            owner = {"user_id": owner_id, "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name}
    return {
        "current_city": city,
        "owner": owner,
        "is_owner": is_owner,
        "max_bet": max_bet,
        "buy_back_reward": buy_back_reward,
    }


@api_router.post("/casino/dice/play")
async def casino_dice_play(request: DicePlayRequest, current_user: dict = Depends(get_current_user)):
    """Place a dice bet. Win if roll == chosen_number; payout = stake * sides * (1 - house_edge)."""
    raw_city = (current_user.get("current_state") or STATES[0] if STATES else "").strip()
    city = _normalize_city_for_dice(raw_city) if raw_city else (STATES[0] if STATES else "")
    if not city:
        raise HTTPException(status_code=400, detail="No current city")
    stake = max(0, int(request.stake))
    sides = max(DICE_SIDES_MIN, min(DICE_SIDES_MAX, int(request.sides)))
    chosen = max(1, min(sides, int(request.chosen_number)))
    if stake <= 0:
        raise HTTPException(status_code=400, detail="Stake must be positive")
    stored_city, doc = await _get_dice_ownership_doc(city)
    db_city = stored_city or city  # city key to use for updates
    max_bet = DICE_MAX_BET
    owner_id = None
    if doc:
        max_bet = doc.get("max_bet") if doc.get("max_bet") is not None else DICE_MAX_BET
        owner_id = doc.get("owner_id")
    if stake > max_bet:
        raise HTTPException(status_code=400, detail=f"Stake exceeds max bet ({max_bet})")
    player_money = int((current_user.get("money") or 0) or 0)
    if player_money < stake:
        raise HTTPException(status_code=400, detail="Not enough cash")
    payout_full = int(stake * sides * (1 - DICE_HOUSE_EDGE))
    roll = random.randint(1, sides)
    win = roll == chosen
    if not win:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -stake}})
        if owner_id:
            await db.users.update_one({"id": owner_id}, {"$inc": {"money": stake}})
        return {"roll": roll, "win": False, "payout": 0, "actual_payout": 0, "owner_paid": 0, "shortfall": 0, "ownership_transferred": False, "buy_back_offer": None}
    if not owner_id:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": payout_full - stake}})
        return {"roll": roll, "win": True, "payout": payout_full, "actual_payout": payout_full, "owner_paid": 0, "shortfall": 0, "ownership_transferred": False, "buy_back_offer": None}
    owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1})
    owner_money = int((owner.get("money") or 0) or 0)
    actual_payout = min(payout_full, owner_money)
    shortfall = payout_full - actual_payout
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": actual_payout - stake}})
    await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_payout}})
    ownership_transferred = False
    buy_back_offer = None
    if shortfall > 0:
        ownership_transferred = True
        await db.dice_ownership.update_one({"city": db_city}, {"$set": {"owner_id": current_user["id"]}})
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
        offer_id = str(uuid.uuid4())
        buy_back_doc = {
            "id": offer_id,
            "city": db_city,
            "from_owner_id": owner_id,
            "to_user_id": current_user["id"],
            "points_offered": 0,
            "amount_shortfall": shortfall,
            "owner_paid": actual_payout,
            "expires_at": expires_at,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        points_offered = int((doc or {}).get("buy_back_reward") or 0)
        buy_back_doc["points_offered"] = points_offered
        await db.dice_buy_back_offers.insert_one(buy_back_doc)
        buy_back_offer = {"offer_id": offer_id, "points_offered": points_offered, "amount_shortfall": shortfall, "owner_paid": actual_payout, "expires_at": expires_at}
    else:
        await db.users.update_one({"id": owner_id}, {"$inc": {"money": stake}})
    return {"roll": roll, "win": True, "payout": payout_full, "actual_payout": actual_payout, "owner_paid": actual_payout, "shortfall": shortfall, "ownership_transferred": ownership_transferred, "buy_back_offer": buy_back_offer}


@api_router.post("/casino/dice/claim")
async def casino_dice_claim(request: DiceClaimRequest, current_user: dict = Depends(get_current_user)):
    """Claim ownership of the dice table in a city (cost in points)."""
    city = _normalize_city_for_dice((request.city or "").strip())
    if not city or city not in STATES:
        raise HTTPException(status_code=400, detail="Invalid city")
    user_city = _normalize_city_for_dice((current_user.get("current_state") or "").strip())
    if user_city != city:
        raise HTTPException(status_code=400, detail="You must be in this city to claim the dice table")
    stored_city, existing = await _get_dice_ownership_doc(city)
    if existing and existing.get("owner_id"):
        raise HTTPException(status_code=400, detail="This table is already owned")
    points = int((current_user.get("points") or 0) or 0)
    if points < DICE_CLAIM_COST_POINTS:
        raise HTTPException(status_code=400, detail="Not enough points to claim")
    await db.dice_ownership.update_one(
        {"city": city},
        {"$set": {"owner_id": current_user["id"], "max_bet": DICE_MAX_BET, "buy_back_reward": 0}},
        upsert=True,
    )
    if DICE_CLAIM_COST_POINTS > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": -DICE_CLAIM_COST_POINTS}})
    return {"message": "You now own the dice table here."}


@api_router.post("/casino/dice/relinquish")
async def casino_dice_relinquish(request: DiceClaimRequest, current_user: dict = Depends(get_current_user)):
    """Relinquish ownership of the dice table in a city."""
    city = _normalize_city_for_dice((request.city or "").strip())
    if not city or city not in STATES:
        raise HTTPException(status_code=400, detail="Invalid city")
    stored_city, doc = await _get_dice_ownership_doc(city)
    if not doc or doc.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this table")
    await db.dice_ownership.update_one({"city": stored_city or city}, {"$set": {"owner_id": None}})
    return {"message": "You have relinquished the dice table."}


@api_router.post("/casino/dice/set-max-bet")
async def casino_dice_set_max_bet(request: DiceSetMaxBetRequest, current_user: dict = Depends(get_current_user)):
    """Set max bet for your dice table (owner only)."""
    city = _normalize_city_for_dice((request.city or "").strip())
    if not city or city not in STATES:
        raise HTTPException(status_code=400, detail="Invalid city")
    stored_city, doc = await _get_dice_ownership_doc(city)
    if not doc or doc.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this table")
    max_bet = max(0, int(request.max_bet))
    await db.dice_ownership.update_one({"city": stored_city or city}, {"$set": {"max_bet": max_bet}})
    return {"message": "Max bet updated."}


@api_router.post("/casino/dice/set-buy-back-reward")
async def casino_dice_set_buy_back_reward(request: DiceSetBuyBackRequest, current_user: dict = Depends(get_current_user)):
    """Set buy-back reward (points) offered when you cannot pay a win (owner only)."""
    city = _normalize_city_for_dice((request.city or "").strip())
    if not city or city not in STATES:
        raise HTTPException(status_code=400, detail="Invalid city")
    stored_city, doc = await _get_dice_ownership_doc(city)
    if not doc or doc.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this table")
    amount = max(0, int(request.amount))
    await db.dice_ownership.update_one({"city": stored_city or city}, {"$set": {"buy_back_reward": amount}})
    return {"message": "Buy-back reward updated."}


@api_router.post("/casino/dice/buy-back/accept")
async def casino_dice_buy_back_accept(request: DiceBuyBackAcceptRequest, current_user: dict = Depends(get_current_user)):
    """Accept a buy-back offer: receive points and transfer ownership back to previous owner."""
    offer = await db.dice_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0})
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    if offer.get("to_user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not your offer")
    expires = offer.get("expires_at")
    if expires:
        try:
            if datetime.fromisoformat(expires.replace("Z", "+00:00")) < datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="Offer expired")
        except Exception:
            pass
    city = offer.get("city")
    from_owner_id = offer.get("from_owner_id")
    points_offered = int(offer.get("points_offered") or 0)
    if not city or not from_owner_id:
        raise HTTPException(status_code=400, detail="Invalid offer")
    from_user = await db.users.find_one({"id": from_owner_id}, {"_id": 0, "points": 1})
    from_points = int((from_user.get("points") or 0) or 0)
    if from_points < points_offered:
        raise HTTPException(status_code=400, detail="Previous owner does not have enough points")
    await db.users.update_one({"id": from_owner_id}, {"$inc": {"points": -points_offered}})
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": points_offered}})
    await db.dice_ownership.update_one({"city": city}, {"$set": {"owner_id": from_owner_id}})
    await db.dice_buy_back_offers.delete_one({"id": request.offer_id})
    return {"message": "Accepted. You received the points and the table was returned to the previous owner."}


@api_router.post("/casino/dice/buy-back/reject")
async def casino_dice_buy_back_reject(request: DiceBuyBackRejectRequest, current_user: dict = Depends(get_current_user)):
    """Reject a buy-back offer: keep ownership."""
    offer = await db.dice_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0, "to_user_id": 1})
    if not offer or offer.get("to_user_id") != current_user["id"]:
        raise HTTPException(status_code=404, detail="Offer not found")
    await db.dice_buy_back_offers.delete_one({"id": request.offer_id})
    return {"message": "Rejected. You keep the casino."}


@api_router.post("/casino/dice/send-to-user")
async def casino_dice_send_to_user(request: DiceSendToUserRequest, current_user: dict = Depends(get_current_user)):
    """Transfer dice table ownership to another user (owner only)."""
    city = _normalize_city_for_dice((request.city or "").strip())
    if not city or city not in STATES:
        raise HTTPException(status_code=400, detail="Invalid city")
    stored_city, doc = await _get_dice_ownership_doc(city)
    if not doc or doc.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this table")
    target = await db.users.find_one({"username": request.target_username.strip()}, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.dice_ownership.update_one({"city": stored_city or city}, {"$set": {"owner_id": target["id"]}})
    return {"message": "Ownership transferred."}


# ─────────────────────────────────────────────────────────────
# ROULETTE CASINO API
# ─────────────────────────────────────────────────────────────

# Roulette ownership constants
ROULETTE_CLAIM_COST = 500_000_000  # 500M to claim
ROULETTE_HOUSE_EDGE = 0.027  # 2.7% house edge goes to owner
ROULETTE_DEFAULT_MAX_BET = 50_000_000
ROULETTE_ABSOLUTE_MAX_BET = 500_000_000


def _normalize_city_for_roulette(city_raw: str) -> str:
    """Normalize city name for roulette ownership (case-insensitive)."""
    if not city_raw:
        return ""
    city_lower = city_raw.strip().lower()
    for state in STATES:
        if state.lower() == city_lower:
            return state
    return ""


async def _get_roulette_ownership_doc(city: str):
    """Get roulette ownership doc by city (case-insensitive). Returns (stored_city, doc)."""
    city_pattern = re.compile(f"^{re.escape(city)}$", re.IGNORECASE)
    doc = await db.roulette_ownership.find_one({"city": city_pattern})
    if doc:
        return doc.get("city", city), doc
    return city, None


def _roulette_check_bet_win(bet_type: str, selection, result: int) -> bool:
    """Check if a single roulette bet wins given the result number."""
    if result == 0:
        # 0 only wins straight bets on 0
        return bet_type == "straight" and int(selection) == 0
    
    if bet_type == "straight":
        return int(selection) == result
    elif bet_type == "red":
        return result in ROULETTE_RED
    elif bet_type == "black":
        return result not in ROULETTE_RED and result != 0
    elif bet_type == "even":
        return result % 2 == 0
    elif bet_type == "odd":
        return result % 2 == 1
    elif bet_type == "low":
        return 1 <= result <= 18
    elif bet_type == "high":
        return 19 <= result <= 36
    elif bet_type == "dozen":
        sel = int(selection)
        if sel == 1:
            return 1 <= result <= 12
        elif sel == 2:
            return 13 <= result <= 24
        elif sel == 3:
            return 25 <= result <= 36
    elif bet_type == "column":
        sel = int(selection)
        # Column 1: 1,4,7,10,...,34; Column 2: 2,5,8,...,35; Column 3: 3,6,9,...,36
        return result % 3 == (sel % 3)
    return False


def _roulette_get_multiplier(bet_type: str) -> int:
    """Returns the payout multiplier (includes stake) for a bet type."""
    if bet_type == "straight":
        return 36  # 35:1 + 1 stake
    elif bet_type in ("dozen", "column"):
        return 3   # 2:1 + 1 stake
    else:
        return 2   # 1:1 + 1 stake (red, black, even, odd, low, high)


@api_router.get("/casino/roulette/config")
async def casino_roulette_config(current_user: dict = Depends(get_current_user)):
    """Return roulette configuration (max bet)."""
    return {
        "max_bet": ROULETTE_MAX_BET,
        "claim_cost": ROULETTE_CLAIM_COST,
        "house_edge_percent": ROULETTE_HOUSE_EDGE * 100
    }


@api_router.get("/casino/roulette/ownership")
async def casino_roulette_ownership(current_user: dict = Depends(get_current_user)):
    """Get roulette ownership for player's current city."""
    raw = (current_user.get("current_state") or "").strip()
    if not raw:
        raw = STATES[0] if STATES else "Chicago"
    city = _normalize_city_for_roulette(raw)
    if not city:
        # If normalization fails, use the raw value for display and the first state for lookup
        city = STATES[0] if STATES else "Chicago"
    display_city = city or raw or "Chicago"
    
    stored_city, doc = await _get_roulette_ownership_doc(city)
    if not doc:
        return {
            "current_city": display_city,
            "owner_id": None,
            "owner_name": None,
            "is_owner": False,
            "is_unclaimed": True,
            "claim_cost": ROULETTE_CLAIM_COST,
            "max_bet": ROULETTE_DEFAULT_MAX_BET
        }
    
    owner_id = doc.get("owner_id")
    owner_name = None
    if owner_id:
        owner = await db.users.find_one({"id": owner_id}, {"username": 1})
        owner_name = owner.get("username") if owner else None
    
    is_owner = owner_id == current_user["id"]
    max_bet = doc.get("max_bet", ROULETTE_DEFAULT_MAX_BET)
    total_earnings = doc.get("total_earnings", 0)
    
    return {
        "current_city": display_city,
        "owner_id": owner_id,
        "owner_name": owner_name,
        "is_owner": is_owner,
        "is_unclaimed": owner_id is None,
        "claim_cost": ROULETTE_CLAIM_COST,
        "max_bet": max_bet,
        "total_earnings": total_earnings if is_owner else None
    }


@api_router.post("/casino/roulette/claim")
async def casino_roulette_claim(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user)):
    """Claim ownership of an unclaimed roulette table."""
    city = _normalize_city_for_roulette((request.city or "").strip())
    if not city or city not in STATES:
        raise HTTPException(status_code=400, detail="Invalid city")
    
    stored_city, doc = await _get_roulette_ownership_doc(city)
    if doc and doc.get("owner_id"):
        raise HTTPException(status_code=400, detail="This table already has an owner")
    
    user = await db.users.find_one({"id": current_user["id"]})
    if not user or user.get("money", 0) < ROULETTE_CLAIM_COST:
        raise HTTPException(status_code=400, detail=f"You need ${ROULETTE_CLAIM_COST:,} to claim")
    
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -ROULETTE_CLAIM_COST}})
    
    await db.roulette_ownership.update_one(
        {"city": stored_city or city},
        {"$set": {"owner_id": current_user["id"], "max_bet": ROULETTE_DEFAULT_MAX_BET, "total_earnings": 0}},
        upsert=True
    )
    
    return {"message": f"You now own the roulette table in {city}!"}


@api_router.post("/casino/roulette/relinquish")
async def casino_roulette_relinquish(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user)):
    """Give up ownership of a roulette table."""
    city = _normalize_city_for_roulette((request.city or "").strip())
    if not city or city not in STATES:
        raise HTTPException(status_code=400, detail="Invalid city")
    
    stored_city, doc = await _get_roulette_ownership_doc(city)
    if not doc or doc.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this table")
    
    await db.roulette_ownership.update_one({"city": stored_city or city}, {"$set": {"owner_id": None}})
    return {"message": "Ownership relinquished."}


@api_router.post("/casino/roulette/set-max-bet")
async def casino_roulette_set_max_bet(request: RouletteSetMaxBetRequest, current_user: dict = Depends(get_current_user)):
    """Set the max bet for your roulette table."""
    city = _normalize_city_for_roulette((request.city or "").strip())
    if not city or city not in STATES:
        raise HTTPException(status_code=400, detail="Invalid city")
    
    stored_city, doc = await _get_roulette_ownership_doc(city)
    if not doc or doc.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this table")
    
    new_max = max(1_000_000, min(request.max_bet, ROULETTE_ABSOLUTE_MAX_BET))
    await db.roulette_ownership.update_one({"city": stored_city or city}, {"$set": {"max_bet": new_max}})
    return {"message": f"Max bet set to ${new_max:,}"}


@api_router.post("/casino/roulette/send-to-user")
async def casino_roulette_send_to_user(request: RouletteSendToUserRequest, current_user: dict = Depends(get_current_user)):
    """Transfer roulette table ownership to another user."""
    city = _normalize_city_for_roulette((request.city or "").strip())
    if not city or city not in STATES:
        raise HTTPException(status_code=400, detail="Invalid city")
    
    stored_city, doc = await _get_roulette_ownership_doc(city)
    if not doc or doc.get("owner_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this table")
    
    target = await db.users.find_one({"username": request.target_username.strip()}, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    
    await db.roulette_ownership.update_one({"city": stored_city or city}, {"$set": {"owner_id": target["id"]}})
    return {"message": "Ownership transferred."}


@api_router.post("/casino/roulette/spin")
async def casino_roulette_spin(request: RouletteSpinRequest, current_user: dict = Depends(get_current_user)):
    """Spin the roulette wheel with the provided bets."""
    bets = request.bets or []
    if not bets:
        raise HTTPException(status_code=400, detail="No bets provided")
    
    # Get ownership info for max bet and owner cut
    city = _normalize_city_for_roulette(current_user.get("current_state", ""))
    stored_city, ownership_doc = await _get_roulette_ownership_doc(city) if city else (city, None)
    
    owner_id = ownership_doc.get("owner_id") if ownership_doc else None
    max_bet = ownership_doc.get("max_bet", ROULETTE_DEFAULT_MAX_BET) if ownership_doc else ROULETTE_DEFAULT_MAX_BET
    
    # Owner cannot gamble at their own table
    if owner_id and owner_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="You cannot gamble at your own roulette table")
    
    # Validate and sum bets
    total_stake = 0
    validated_bets = []
    for b in bets:
        bet_type = b.get("type", "").lower()
        selection = b.get("selection")
        amount = int(b.get("amount", 0))
        
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Bet amount must be positive")
        
        if bet_type == "straight":
            sel_int = int(selection)
            if not (0 <= sel_int <= 36):
                raise HTTPException(status_code=400, detail=f"Invalid straight bet: {selection}")
            selection = sel_int
        elif bet_type in ("dozen", "column"):
            sel_int = int(selection)
            if sel_int not in (1, 2, 3):
                raise HTTPException(status_code=400, detail=f"Invalid {bet_type} selection: {selection}")
            selection = sel_int
        elif bet_type not in ("red", "black", "even", "odd", "low", "high"):
            raise HTTPException(status_code=400, detail=f"Unknown bet type: {bet_type}")
        
        total_stake += amount
        validated_bets.append({"type": bet_type, "selection": selection, "amount": amount})
    
    if total_stake > max_bet:
        raise HTTPException(status_code=400, detail=f"Total bet exceeds max of ${max_bet:,}")
    
    # Check user has enough money
    user = await db.users.find_one({"id": current_user["id"]})
    if not user or user.get("money", 0) < total_stake:
        raise HTTPException(status_code=400, detail="Not enough money")
    
    # Deduct stake
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -total_stake}})
    
    # Spin the wheel (0-36)
    result = random.randint(0, 36)
    
    # Calculate winnings
    total_payout = 0
    for bet in validated_bets:
        if _roulette_check_bet_win(bet["type"], bet["selection"], result):
            multiplier = _roulette_get_multiplier(bet["type"])
            total_payout += bet["amount"] * multiplier
    
    # Credit winnings
    if total_payout > 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": total_payout}})
    
    # Pay owner the house edge on total stake (2.7%)
    owner_cut = 0
    if owner_id:
        owner_cut = int(total_stake * ROULETTE_HOUSE_EDGE)
        if owner_cut > 0:
            await db.users.update_one({"id": owner_id}, {"$inc": {"money": owner_cut}})
            await db.roulette_ownership.update_one(
                {"city": stored_city or city},
                {"$inc": {"total_earnings": owner_cut}}
            )
    
    win = total_payout > 0
    
    return {
        "result": result,
        "win": win,
        "total_payout": total_payout,
        "total_stake": total_stake,
        "owner_cut": owner_cut
    }


@api_router.get("/travel/info")
async def get_travel_info(current_user: dict = Depends(get_current_user)):
    # Reset travels if hour has passed
    reset_time = current_user.get("travel_reset_time")
    if reset_time:
        reset_dt = datetime.fromisoformat(reset_time.replace('Z', '+00:00'))
        if datetime.now(timezone.utc) - reset_dt > timedelta(hours=1):
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$set": {"travels_this_hour": 0, "travel_reset_time": datetime.now(timezone.utc).isoformat()}}
            )
            current_user["travels_this_hour"] = 0
    
    # Get user's cars (include _id for documents that don't have "id" yet)
    user_cars = await db.user_cars.find({"user_id": current_user["id"]}).to_list(50)
    
    cars_with_travel_times = []
    for uc in user_cars:
        car_info = next((c for c in CARS if c["id"] == uc["car_id"]), None)
        if car_info:
            travel_time = TRAVEL_TIMES.get(car_info["rarity"], 45)
            user_car_id = uc.get("id") or str(uc["_id"])
            name = car_info["name"]
            image = car_info.get("image", "")
            if uc.get("car_id") == "car_custom":
                if uc.get("custom_name"):
                    name = uc["custom_name"]
                if uc.get("custom_image_url"):
                    image = uc["custom_image_url"]
            cars_with_travel_times.append({
                "user_car_id": user_car_id,
                "car_id": car_info["id"],
                "name": name,
                "rarity": car_info["rarity"],
                "travel_time": travel_time,
                "image": image
            })
    
    # Custom car: use first from garage (so image and name come from garage)
    custom_car = None
    first_custom = next((uc for uc in user_cars if uc.get("car_id") == "car_custom"), None)
    if first_custom:
        custom_car = {
            "name": first_custom.get("custom_name") or "Custom Car",
            "travel_time": TRAVEL_TIMES["custom"],
            "image": first_custom.get("custom_image_url") or ""
        }
    
    max_travels = MAX_TRAVELS_PER_HOUR + current_user.get("extra_airmiles", 0)
    
    current_state = current_user.get("current_state", STATES[0])
    carrying_booze = _booze_user_carrying_total(current_user.get("booze_carrying") or {}) > 0
    return {
        "current_location": current_state,
        "destinations": [s for s in STATES if s != current_state],
        "travels_this_hour": current_user.get("travels_this_hour", 0),
        "max_travels": max_travels,
        "airport_cost": AIRPORT_COST,
        "airport_time": TRAVEL_TIMES["airport"],
        "extra_airmiles_cost": EXTRA_AIRMILES_COST,
        "cars": cars_with_travel_times,
        "custom_car": custom_car,
        "user_points": current_user.get("points", 0),
        "carrying_booze": carrying_booze,
    }

@api_router.post("/travel")
async def travel(request: TravelRequest, current_user: dict = Depends(get_current_user)):
    if request.destination not in STATES:
        raise HTTPException(status_code=400, detail="Invalid destination")
    
    if request.destination == current_user["current_state"]:
        raise HTTPException(status_code=400, detail="Already at this location")
    
    # Check travel limit
    max_travels = MAX_TRAVELS_PER_HOUR + current_user.get("extra_airmiles", 0)
    if current_user.get("travels_this_hour", 0) >= max_travels:
        raise HTTPException(status_code=400, detail="Travel limit reached. Buy extra airmiles or wait.")
    
    travel_time = 45  # Default
    method_name = "Walking"
    
    if request.travel_method == "airport":
        if _booze_user_carrying_total(current_user.get("booze_carrying") or {}) > 0:
            raise HTTPException(status_code=400, detail="Cannot use airport while carrying booze. Use a car.")
        if current_user["points"] < AIRPORT_COST:
            raise HTTPException(status_code=400, detail="Insufficient points for airport")
        travel_time = TRAVEL_TIMES["airport"]
        method_name = "Airport"
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"points": -AIRPORT_COST}}
        )
    elif request.travel_method == "custom":
        first_custom = await db.user_cars.find_one(
            {"user_id": current_user["id"], "car_id": "car_custom"},
            sort=[("acquired_at", 1)]
        )
        if not first_custom:
            raise HTTPException(status_code=400, detail="You don't own a custom car")
        travel_time = TRAVEL_TIMES["custom"]
        method_name = first_custom.get("custom_name") or "Custom Car"
    else:
        # It's a car ID (or MongoDB _id for older docs without "id")
        user_car = await db.user_cars.find_one(
            {"id": request.travel_method, "user_id": current_user["id"]},
            {"_id": 0}
        )
        if not user_car:
            try:
                user_car = await db.user_cars.find_one(
                    {"_id": ObjectId(request.travel_method), "user_id": current_user["id"]},
                    {"_id": 0}
                )
            except Exception:
                user_car = None
        if not user_car:
            raise HTTPException(status_code=400, detail="Car not found")
        
        car_info = next((c for c in CARS if c["id"] == user_car["car_id"]), None)
        if car_info:
            travel_time = TRAVEL_TIMES.get(car_info["rarity"], 45)
            method_name = car_info["name"]
    
    # Update location and increment travel count
    await db.users.update_one(
        {"id": current_user["id"]},
        {
            "$set": {"current_state": request.destination},
            "$inc": {"travels_this_hour": 1}
        }
    )
    
    return {
        "message": f"Traveling to {request.destination} via {method_name}",
        "travel_time": travel_time,
        "destination": request.destination
    }

@api_router.post("/travel/buy-airmiles")
async def buy_extra_airmiles(current_user: dict = Depends(get_current_user)):
    if current_user["points"] < EXTRA_AIRMILES_COST:
        raise HTTPException(status_code=400, detail="Insufficient points")
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -EXTRA_AIRMILES_COST, "extra_airmiles": 5}}
    )
    
    return {"message": f"Purchased 5 extra airmiles for {EXTRA_AIRMILES_COST} points"}


# ============ BOOZE RUN ENDPOINTS ============

def _booze_user_capacity(current_user: dict) -> int:
    rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
    base = BOOZE_CAPACITY_BY_RANK[min(rank_id, len(BOOZE_CAPACITY_BY_RANK)) - 1]
    bonus = current_user.get("booze_capacity_bonus", 0)
    return base + bonus


def _booze_user_carrying_total(carrying: dict) -> int:
    return sum(int(v) for v in (carrying or {}).values())


@api_router.get("/booze-run/config")
async def booze_run_config(current_user: dict = Depends(get_current_user)):
    """Booze run config: locations, types, prices at current location, rotation end, carrying, capacity."""
    current_state = current_user.get("current_state", STATES[0])
    loc_index = STATES.index(current_state) if current_state in STATES else 0
    prices_map = _booze_prices_for_rotation()
    carrying = current_user.get("booze_carrying") or {}
    capacity = _booze_user_capacity(current_user)
    # Prices at current location only (front can show "buy here / sell here")
    prices_at_location = []
    for i, bt in enumerate(BOOZE_TYPES):
        buy_p, sell_p = prices_map.get((loc_index, i), (300, 450))
        prices_at_location.append({
            "booze_id": bt["id"],
            "name": bt["name"],
            "buy_price": buy_p,
            "sell_price": sell_p,
            "carrying": int(carrying.get(bt["id"], 0)),
        })
    # All locations' buy/sell for "route" awareness (optional - so user can see where to buy/sell)
    all_prices = {}
    for loc_i, state in enumerate(STATES):
        all_prices[state] = [
            {"booze_id": BOOZE_TYPES[b]["id"], "name": BOOZE_TYPES[b]["name"], "buy_price": prices_map.get((loc_i, b), (300, 450))[0], "sell_price": prices_map.get((loc_i, b), (300, 450))[1]}
            for b in range(len(BOOZE_TYPES))
        ]
    # Profit today (reset at UTC midnight; we show 0 if date changed, reset stored on next sell)
    today_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    profit_today = current_user.get("booze_profit_today", 0)
    profit_today_date = current_user.get("booze_profit_today_date")
    if profit_today_date != today_utc:
        profit_today = 0
    profit_total = current_user.get("booze_profit_total", 0)
    runs_count = current_user.get("booze_runs_count", 0)
    history = (current_user.get("booze_run_history") or [])[:BOOZE_RUN_HISTORY_MAX]

    return {
        "locations": list(STATES),
        "booze_types": list(BOOZE_TYPES),
        "current_location": current_state,
        "prices_at_location": prices_at_location,
        "all_prices_by_location": all_prices,
        "carrying": carrying,
        "capacity": capacity,
        "carrying_total": _booze_user_carrying_total(carrying),
        "rotation_ends_at": _booze_rotation_ends_at(),
        "rotation_hours": BOOZE_ROTATION_HOURS,
        "profit_today": profit_today,
        "profit_total": profit_total,
        "runs_count": runs_count,
        "history": history,
    }


def _booze_user_in_jail(user: dict) -> bool:
    """True if user is currently in jail (jail_until in future)."""
    if not user.get("in_jail"):
        return False
    jail_until_iso = user.get("jail_until")
    if not jail_until_iso:
        return False
    jail_until = datetime.fromisoformat(jail_until_iso.replace("Z", "+00:00"))
    if jail_until.tzinfo is None:
        jail_until = jail_until.replace(tzinfo=timezone.utc)
    return jail_until > datetime.now(timezone.utc)


@api_router.post("/booze-run/buy")
async def booze_run_buy(request: BoozeBuyRequest, current_user: dict = Depends(get_current_user)):
    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if _booze_user_in_jail(current_user):
        raise HTTPException(status_code=400, detail="You are in jail!")
    booze_ids = [b["id"] for b in BOOZE_TYPES]
    if request.booze_id not in booze_ids:
        raise HTTPException(status_code=400, detail="Invalid booze type")
    current_state = current_user.get("current_state", STATES[0])
    loc_index = STATES.index(current_state) if current_state in STATES else 0
    booze_index = booze_ids.index(request.booze_id)
    prices_map = _booze_prices_for_rotation()
    buy_price, _ = prices_map.get((loc_index, booze_index), (300, 450))
    cost = buy_price * request.amount
    if current_user.get("money", 0) < cost:
        raise HTTPException(status_code=400, detail="Insufficient money")
    carrying = dict(current_user.get("booze_carrying") or {})
    carrying_cost = dict(current_user.get("booze_carrying_cost") or {})
    capacity = _booze_user_capacity(current_user)
    current_carry = _booze_user_carrying_total(carrying)
    if current_carry + request.amount > capacity:
        raise HTTPException(status_code=400, detail=f"Over capacity (max {capacity} units)")
    # Roll for caught by prohibition agents (before any purchase)
    if random.random() < BOOZE_RUN_CAUGHT_CHANCE:
        jail_until = datetime.now(timezone.utc) + timedelta(seconds=BOOZE_RUN_JAIL_SECONDS)
        await db.users.update_one(
            {"id": current_user["id"]},
            {
                "$set": {"in_jail": True, "jail_until": jail_until.isoformat()},
                "$unset": {"booze_carrying": "", "booze_carrying_cost": ""},
            },
        )
        return {
            "message": "Busted! Prohibition agents got you. You're going to jail.",
            "caught": True,
            "jail_until": jail_until.isoformat(),
            "jail_seconds": BOOZE_RUN_JAIL_SECONDS,
        }
    booze_name = BOOZE_TYPES[booze_index]["name"]
    history_entry = {
        "at": datetime.now(timezone.utc).isoformat(),
        "action": "buy",
        "booze_name": booze_name,
        "amount": request.amount,
        "unit_price": buy_price,
        "total": cost,
        "location": current_state,
    }
    await db.users.update_one(
        {"id": current_user["id"]},
        {
            "$inc": {"money": -cost, f"booze_carrying.{request.booze_id}": request.amount, f"booze_carrying_cost.{request.booze_id}": cost},
            "$push": {"booze_run_history": {"$each": [history_entry], "$position": 0, "$slice": BOOZE_RUN_HISTORY_MAX}},
        }
    )
    new_carrying = carrying.get(request.booze_id, 0) + request.amount
    return {"message": f"Purchased {request.amount} {booze_name}", "new_carrying": new_carrying, "spent": cost}


@api_router.post("/booze-run/sell")
async def booze_run_sell(request: BoozeSellRequest, current_user: dict = Depends(get_current_user)):
    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if _booze_user_in_jail(current_user):
        raise HTTPException(status_code=400, detail="You are in jail!")
    booze_ids = [b["id"] for b in BOOZE_TYPES]
    if request.booze_id not in booze_ids:
        raise HTTPException(status_code=400, detail="Invalid booze type")
    current_state = current_user.get("current_state", STATES[0])
    loc_index = STATES.index(current_state) if current_state in STATES else 0
    booze_index = booze_ids.index(request.booze_id)
    prices_map = _booze_prices_for_rotation()
    _, sell_price = prices_map.get((loc_index, booze_index), (300, 450))
    carrying = dict(current_user.get("booze_carrying") or {})
    carrying_cost = dict(current_user.get("booze_carrying_cost") or {})
    have = int(carrying.get(request.booze_id, 0))
    if have < request.amount:
        raise HTTPException(status_code=400, detail=f"Only carrying {have} units")
    # Roll for caught by prohibition agents (before any sell)
    if random.random() < BOOZE_RUN_CAUGHT_CHANCE:
        jail_until = datetime.now(timezone.utc) + timedelta(seconds=BOOZE_RUN_JAIL_SECONDS)
        await db.users.update_one(
            {"id": current_user["id"]},
            {
                "$set": {"in_jail": True, "jail_until": jail_until.isoformat()},
                "$unset": {"booze_carrying": "", "booze_carrying_cost": ""},
            },
        )
        return {
            "message": "Busted! Prohibition agents got you. You're going to jail.",
            "caught": True,
            "jail_until": jail_until.isoformat(),
            "jail_seconds": BOOZE_RUN_JAIL_SECONDS,
        }
    revenue = sell_price * request.amount
    total_cost_stored = int(carrying_cost.get(request.booze_id, 0))
    cost_of_sold = (total_cost_stored * request.amount // have) if have else 0
    profit = revenue - cost_of_sold
    new_val = have - request.amount
    new_cost = total_cost_stored - cost_of_sold
    booze_name = BOOZE_TYPES[booze_index]["name"]
    today_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    profit_today = current_user.get("booze_profit_today", 0)
    profit_today_date = current_user.get("booze_profit_today_date")
    if profit_today_date != today_utc:
        profit_today = 0
    new_profit_today = profit_today + profit
    new_profit_total = current_user.get("booze_profit_total", 0) + profit
    history_entry = {
        "at": datetime.now(timezone.utc).isoformat(),
        "action": "sell",
        "booze_name": booze_name,
        "amount": request.amount,
        "unit_price": sell_price,
        "total": revenue,
        "profit": profit,
        "location": current_state,
    }
    updates = {
        "$inc": {
            "money": revenue,
            "booze_profit_today": profit,
            "booze_profit_total": profit,
            "booze_runs_count": 1,
        },
        "$set": {"booze_profit_today_date": today_utc},
        "$push": {"booze_run_history": {"$each": [history_entry], "$position": 0, "$slice": BOOZE_RUN_HISTORY_MAX}},
    }
    if new_val == 0:
        updates["$unset"] = {f"booze_carrying.{request.booze_id}": "", f"booze_carrying_cost.{request.booze_id}": ""}
    else:
        updates["$inc"][f"booze_carrying.{request.booze_id}"] = -request.amount
        updates["$inc"][f"booze_carrying_cost.{request.booze_id}"] = -cost_of_sold
    await db.users.update_one({"id": current_user["id"]}, updates)
    return {"message": f"Sold {request.amount} {booze_name}", "revenue": revenue, "profit": profit, "new_carrying": new_val}


@api_router.post("/store/buy-booze-capacity")
async def buy_booze_capacity(current_user: dict = Depends(get_current_user)):
    """Spend points to increase booze carry capacity (+50 units)."""
    if current_user["points"] < BOOZE_CAPACITY_UPGRADE_COST:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -BOOZE_CAPACITY_UPGRADE_COST, "booze_capacity_bonus": BOOZE_CAPACITY_UPGRADE_AMOUNT}}
    )
    new_capacity = _booze_user_capacity({**current_user, "booze_capacity_bonus": current_user.get("booze_capacity_bonus", 0) + BOOZE_CAPACITY_UPGRADE_AMOUNT})
    return {"message": f"+{BOOZE_CAPACITY_UPGRADE_AMOUNT} booze capacity for {BOOZE_CAPACITY_UPGRADE_COST} points", "new_capacity": new_capacity}


BULLET_PACKS = {
    5000: 500,
    10000: 1000,
    50000: 5000,
    100000: 10000,
}

@api_router.post("/store/buy-bullets")
async def store_buy_bullets(bullets: int, current_user: dict = Depends(get_current_user)):
    """Buy bullets with points."""
    cost = BULLET_PACKS.get(bullets)
    if cost is None:
        raise HTTPException(status_code=400, detail=f"Invalid bullet pack. Choose from: {', '.join(str(k) for k in BULLET_PACKS)}")
    if current_user["points"] < cost:
        raise HTTPException(status_code=400, detail=f"Insufficient points. Need {cost}, have {current_user['points']}")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -cost, "bullets": bullets}}
    )
    return {"message": f"Bought {bullets:,} bullets for {cost} points", "bullets": bullets, "cost": cost}

@api_router.post("/store/buy-custom-car")
async def buy_custom_car(request: CustomCarPurchase, current_user: dict = Depends(get_current_user)):
    CUSTOM_CAR_COST = 500  # Points
    # Allow multiple custom cars; no "already own" check
    
    if current_user["points"] < CUSTOM_CAR_COST:
        raise HTTPException(status_code=400, detail="Insufficient points")
    
    if not request.car_name or len(request.car_name) < 2 or len(request.car_name) > 30:
        raise HTTPException(status_code=400, detail="Car name must be 2-30 characters")
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"points": -CUSTOM_CAR_COST}}
    )
    # Keep custom_car_name for backward compat (last bought); travel uses first from garage
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"custom_car_name": request.car_name}}
    )
    # Also add to garage as a car entity (supports custom_image_url for picture)
    await db.user_cars.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "car_id": "car_custom",
        "custom_name": request.car_name,
        "custom_image_url": None,
        "acquired_at": datetime.now(timezone.utc).isoformat(),
    })
    
    await send_notification(
        current_user["id"],
        "🚗 Custom Car Purchased",
        f"You've purchased a custom car named '{request.car_name}' for {CUSTOM_CAR_COST} points!",
        "reward"
    )
    
    return {"message": f"Custom car '{request.car_name}' purchased for {CUSTOM_CAR_COST} points"}

# ============ BODYGUARD INVITE SYSTEM ============

@api_router.post("/bodyguards/invite")
async def invite_bodyguard(request: BodyguardInviteRequest, current_user: dict = Depends(get_current_user)):
    target = await db.users.find_one({"username": request.target_username}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot invite yourself")
    
    # Check if user has available slots
    bodyguards = await db.bodyguards.find({"user_id": current_user["id"]}).to_list(10)
    filled_slots = len([b for b in bodyguards if b.get("bodyguard_user_id") or b.get("is_robot")])
    if filled_slots >= current_user["bodyguard_slots"]:
        raise HTTPException(status_code=400, detail="No available bodyguard slots")
    
    # Check if already has pending invite to this user
    existing = await db.bodyguard_invites.find_one({
        "inviter_id": current_user["id"],
        "invitee_id": target["id"],
        "status": "pending"
    })
    if existing:
        raise HTTPException(status_code=400, detail="Already have pending invite to this user")
    
    invite_id = str(uuid.uuid4())
    await db.bodyguard_invites.insert_one({
        "id": invite_id,
        "inviter_id": current_user["id"],
        "inviter_username": current_user["username"],
        "invitee_id": target["id"],
        "invitee_username": target["username"],
        "payment_amount": request.payment_amount,
        "payment_type": request.payment_type,
        "duration_hours": request.duration_hours,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    # Notify invitee
    await send_notification(
        target["id"],
        "🛡️ Bodyguard Offer",
        f"{current_user['username']} wants to hire you as a bodyguard for {request.payment_amount} {request.payment_type}/hour for {request.duration_hours} hours.",
        "bodyguard"
    )
    
    return {"message": f"Bodyguard invite sent to {target['username']}"}

@api_router.get("/bodyguards/invites")
async def get_bodyguard_invites(current_user: dict = Depends(get_current_user)):
    # Invites sent by user
    sent = await db.bodyguard_invites.find(
        {"inviter_id": current_user["id"], "status": "pending"},
        {"_id": 0}
    ).to_list(20)
    
    # Invites received by user
    received = await db.bodyguard_invites.find(
        {"invitee_id": current_user["id"], "status": "pending"},
        {"_id": 0}
    ).to_list(20)
    
    return {"sent": sent, "received": received}

@api_router.post("/bodyguards/invites/{invite_id}/accept")
async def accept_bodyguard_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    invite = await db.bodyguard_invites.find_one({"id": invite_id, "invitee_id": current_user["id"], "status": "pending"}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    
    # Find an empty slot for the inviter
    inviter = await db.users.find_one({"id": invite["inviter_id"]}, {"_id": 0})
    if not inviter:
        raise HTTPException(status_code=400, detail="Inviter no longer exists")
    
    bodyguards = await db.bodyguards.find({"user_id": inviter["id"]}).to_list(10)
    empty_slot = None
    for i in range(1, inviter["bodyguard_slots"] + 1):
        slot_bg = next((b for b in bodyguards if b["slot_number"] == i), None)
        if not slot_bg or (not slot_bg.get("bodyguard_user_id") and not slot_bg.get("is_robot")):
            empty_slot = i
            break
    
    if not empty_slot:
        raise HTTPException(status_code=400, detail="Inviter has no available slots")
    
    # Create bodyguard entry
    end_time = datetime.now(timezone.utc) + timedelta(hours=invite["duration_hours"])
    
    await db.bodyguards.update_one(
        {"user_id": inviter["id"], "slot_number": empty_slot},
        {"$set": {
            "bodyguard_user_id": current_user["id"],
            "is_robot": False,
            "payment_amount": invite["payment_amount"],
            "payment_type": invite["payment_type"],
            "payment_due": datetime.now(timezone.utc).isoformat(),
            "contract_end": end_time.isoformat(),
            "hired_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    
    # Update invite status
    await db.bodyguard_invites.update_one(
        {"id": invite_id},
        {"$set": {"status": "accepted"}}
    )
    
    # Notify inviter
    await send_notification(
        inviter["id"],
        "🛡️ Bodyguard Accepted",
        f"{current_user['username']} has accepted your bodyguard offer!",
        "bodyguard"
    )
    
    return {"message": f"You are now {inviter['username']}'s bodyguard"}

@api_router.post("/bodyguards/invites/{invite_id}/decline")
async def decline_bodyguard_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.bodyguard_invites.update_one(
        {"id": invite_id, "invitee_id": current_user["id"], "status": "pending"},
        {"$set": {"status": "declined"}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Invite not found")
    
    return {"message": "Invite declined"}

# ============ Families & Family War API ============

async def cleanup_dead_families():
    """Remove families where all members are dead or don't exist. Transfer assets to war winners."""
    families = await db.families.find({}, {"_id": 0}).to_list(50)
    
    for fam in families:
        family_id = fam["id"]
        members = await db.family_members.find({"family_id": family_id}, {"_id": 0}).to_list(100)
        
        living_count = 0
        for m in members:
            # Include 'id' in projection to ensure we get a non-empty dict when user exists
            user = await db.users.find_one({"id": m["user_id"]}, {"_id": 0, "id": 1, "is_dead": 1})
            if user and user.get("id") and not user.get("is_dead", False):
                living_count += 1
        
        if living_count == 0:
            # All members dead or non-existent - find ALL active/truce_offered wars
            active_wars = await db.family_wars.find({
                "$or": [{"family_a_id": family_id}, {"family_b_id": family_id}],
                "status": {"$in": ["active", "truce_offered"]}
            }, {"_id": 0}).to_list(10)
            
            now = datetime.now(timezone.utc).isoformat()
            rackets = fam.get("rackets") or {}
            treasury = fam.get("treasury", 0)
            
            # Process all active wars - transfer assets to first winner
            assets_transferred = False
            for active_war in active_wars:
                # Determine winner (the other family)
                winner_id = active_war["family_b_id"] if active_war["family_a_id"] == family_id else active_war["family_a_id"]
                loser_id = family_id
                
                # Use correct war status format (family_a_wins or family_b_wins)
                war_status = "family_a_wins" if winner_id == active_war["family_a_id"] else "family_b_wins"
                
                # Transfer assets only once (to first war's winner)
                prize_rackets_list = []
                prize_treasury = 0
                if not assets_transferred:
                    # Transfer rackets to winner
                    if rackets:
                        winner_fam = await db.families.find_one({"id": winner_id}, {"_id": 0, "rackets": 1, "boss_id": 1})
                        winner_rackets = (winner_fam or {}).get("rackets") or {}
                        
                        for racket_id, state in rackets.items():
                            level = state.get("level", 0)
                            if level > 0:
                                existing = winner_rackets.get(racket_id, {}).get("level", 0)
                                if level > existing:
                                    winner_rackets[racket_id] = {"level": level, "last_collected_at": None}
                                    racket_def = next((r for r in FAMILY_RACKETS if r["id"] == racket_id), None)
                                    prize_rackets_list.append({
                                        "racket_id": racket_id,
                                        "name": racket_def["name"] if racket_def else racket_id,
                                        "level": level
                                    })
                        
                        await db.families.update_one({"id": winner_id}, {"$set": {"rackets": winner_rackets}})
                    
                    # Transfer treasury to winner
                    if treasury > 0:
                        await db.families.update_one({"id": winner_id}, {"$inc": {"treasury": treasury}})
                        prize_treasury = treasury
                    
                    # Notify winner
                    await send_notification_to_family(
                        winner_id,
                        "🏆 WAR VICTORY!",
                        f"The enemy family {fam['name']} has been destroyed! You've captured their rackets and ${treasury:,} from their treasury.",
                        "system"
                    )
                    
                    assets_transferred = True
                
                # Mark war as won
                await db.family_wars.update_one(
                    {"id": active_war["id"]},
                    {"$set": {
                        "status": war_status,
                        "winner_family_id": winner_id,
                        "loser_family_id": loser_id,
                        "ended_at": now,
                        "prize_rackets": prize_rackets_list if prize_rackets_list else None,
                        "prize_treasury": prize_treasury
                    }}
                )
            
            # Delete the family and its members
            await db.family_members.delete_many({"family_id": family_id})
            await db.families.delete_one({"id": family_id})


@api_router.get("/families")
async def families_list(current_user: dict = Depends(get_current_user)):
    """List all families (id, name, tag, member_count, treasury). Only shows families with living members."""
    # Run cleanup first
    await cleanup_dead_families()
    
    cursor = db.families.find({}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "treasury": 1})
    fams = await cursor.to_list(MAX_FAMILIES * 2)
    out = []
    for f in fams:
        # Count only living members
        members = await db.family_members.find({"family_id": f["id"]}, {"_id": 0, "user_id": 1}).to_list(100)
        living_count = 0
        for m in members:
            # Include 'id' in projection to ensure we get a non-empty dict when user exists
            user = await db.users.find_one({"id": m["user_id"]}, {"_id": 0, "id": 1, "is_dead": 1})
            if user and user.get("id") and not user.get("is_dead", False):
                living_count += 1
        
        if living_count > 0:  # Only include families with living members
            out.append({
                "id": f["id"],
                "name": f["name"],
                "tag": f["tag"],
                "member_count": living_count,
                "treasury": f.get("treasury", 0),
            })
    return out


@api_router.get("/families/config")
async def families_config(current_user: dict = Depends(get_current_user)):
    """Config for families UI: max_families, roles, racket_max_level."""
    return {
        "max_families": MAX_FAMILIES,
        "roles": FAMILY_ROLES,
        "racket_max_level": RACKET_MAX_LEVEL,
        "rackets": FAMILY_RACKETS,
        "racket_upgrade_cost": RACKET_UPGRADE_COST,
    }


def _racket_income_and_cooldown(racket_id: str, level: int, ev: dict):
    """Income per collect and cooldown hours for a racket (with event modifiers)."""
    r = next((x for x in FAMILY_RACKETS if x["id"] == racket_id), None)
    if not r or level <= 0:
        return 0, 0
    base_income = r["base_income"] * level
    cooldown = r["cooldown_hours"]
    payout_mult = ev.get("racket_payout", 1.0)
    cooldown_mult = ev.get("racket_cooldown", 1.0)
    return int(base_income * payout_mult), cooldown * cooldown_mult


@api_router.get("/families/my")
async def families_my(current_user: dict = Depends(get_current_user)):
    """Current user's family with members, rackets, my_role."""
    family_id = current_user.get("family_id")
    if not family_id:
        return {"family": None, "members": [], "rackets": [], "my_role": None}
    fam = await db.families.find_one({"id": family_id}, {"_id": 0})
    if not fam:
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_id": None, "family_role": None}})
        return {"family": None, "members": [], "rackets": [], "my_role": None}
    members_cursor = db.family_members.find({"family_id": family_id}, {"_id": 0})
    members_docs = await members_cursor.to_list(100)
    # Derive my_role from family_members if user's family_role is missing (e.g. old account or seed)
    my_role = current_user.get("family_role")
    my_member = next((m for m in members_docs if m["user_id"] == current_user["id"]), None)
    if my_member and my_member.get("role"):
        my_role = str(my_member["role"]).strip().lower() or my_role
        if my_role and current_user.get("family_role") != my_role:
            await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_role": my_role}})
    if my_role:
        my_role = str(my_role).strip().lower()
    ev = await get_effective_event()
    members = []
    for m in members_docs:
        u = await db.users.find_one({"id": m["user_id"]}, {"_id": 0, "username": 1, "rank": 1})
        rank_name = "—"
        if u:
            rid = u.get("rank", 1)
            rn = next((x["name"] for x in RANKS if x.get("id") == rid), str(rid))
            rank_name = rn
        members.append({
            "user_id": m["user_id"],
            "username": (u or {}).get("username", "?"),
            "role": str(m.get("role", "")).strip().lower() or "associate",
            "rank_name": rank_name,
        })
    rackets_raw = fam.get("rackets") or {}
    rackets = []
    now = datetime.now(timezone.utc)
    for r in FAMILY_RACKETS:
        try:
            rid = r["id"]
            state = rackets_raw.get(rid) or {}
            level = int(state.get("level", 0) or 0)
            last_at = state.get("last_collected_at")
            income_per, cooldown_h = _racket_income_and_cooldown(rid, level, ev)
            next_collect_at = None
            if last_at and level > 0 and cooldown_h > 0:
                try:
                    last_dt = datetime.fromisoformat(str(last_at).replace("Z", "+00:00"))
                    next_dt = last_dt + timedelta(hours=cooldown_h)
                    next_collect_at = next_dt.isoformat() if next_dt > now else None
                except Exception:
                    next_collect_at = None
            if next_collect_at is None and level > 0:
                next_collect_at = now.isoformat()
            rackets.append({
                "id": rid,
                "name": r["name"],
                "description": r.get("description", ""),
                "level": level,
                "cooldown_hours": r["cooldown_hours"],
                "effective_cooldown_hours": cooldown_h,
                "income_per_collect": income_per,
                "effective_income_per_collect": income_per,
                "next_collect_at": next_collect_at,
            })
        except Exception:
            continue
    return {
        "family": {"id": fam["id"], "name": fam["name"], "tag": fam["tag"], "treasury": fam.get("treasury", 0)},
        "members": members,
        "rackets": rackets,
        "my_role": my_role,
    }


@api_router.get("/families/lookup")
async def families_lookup(tag: str = None, current_user: dict = Depends(get_current_user)):
    """Get one family by tag (for profile page)."""
    if not tag or not str(tag).strip():
        raise HTTPException(status_code=400, detail="tag required")
    tag = str(tag).strip().upper()
    fam = await db.families.find_one({"$or": [{"tag": tag}, {"id": tag}]}, {"_id": 0})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    members_docs = await db.family_members.find({"family_id": fam["id"]}, {"_id": 0}).to_list(100)
    members = []
    for m in members_docs:
        u = await db.users.find_one({"id": m["user_id"]}, {"_id": 0, "username": 1, "rank": 1})
        rank_name = "—"
        if u and RANKS:
            rank_name = next((x["name"] for x in RANKS if x.get("id") == u.get("rank", 1)), str(u.get("rank", 1)))
        members.append({"user_id": m["user_id"], "username": (u or {}).get("username", "?"), "role": m["role"], "rank_name": rank_name})
    rackets_raw = fam.get("rackets") or {}
    rackets = []
    for r in FAMILY_RACKETS:
        state = rackets_raw.get(r["id"]) or {}
        level = state.get("level", 0)
        if level > 0:
            rackets.append({"id": r["id"], "name": r["name"], "level": level})
    my_role = None
    if current_user.get("family_id") == fam["id"]:
        my_role = current_user.get("family_role")
    return {
        "id": fam["id"], "name": fam["name"], "tag": fam["tag"], "treasury": fam.get("treasury", 0),
        "member_count": len(members), "members": members, "rackets": rackets, "my_role": my_role,
    }


@api_router.post("/families")
async def families_create(request: FamilyCreateRequest, current_user: dict = Depends(get_current_user)):
    """Create a new family. User becomes Boss."""
    if current_user.get("family_id"):
        raise HTTPException(status_code=400, detail="Already in a family")
    name = (request.name or "").strip()[:30]
    tag = (request.tag or "").strip().upper().replace(" ", "")[:4]
    if len(name) < 2 or len(tag) < 2:
        raise HTTPException(status_code=400, detail="Name and tag must be at least 2 characters")
    count = await db.families.count_documents({})
    if count >= MAX_FAMILIES:
        raise HTTPException(status_code=400, detail="Maximum number of families reached")
    if await db.families.find_one({"$or": [{"name": name}, {"tag": tag}]}):
        raise HTTPException(status_code=400, detail="Name or tag already taken")
    family_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    await db.families.insert_one({
        "id": family_id,
        "name": name,
        "tag": tag,
        "boss_id": current_user["id"],
        "treasury": 0,
        "created_at": now,
        "rackets": {},
    })
    await db.family_members.insert_one({
        "id": str(uuid.uuid4()),
        "family_id": family_id,
        "user_id": current_user["id"],
        "role": "boss",
        "joined_at": now,
    })
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"family_id": family_id, "family_role": "boss"}},
    )
    return {"message": "Family created", "family_id": family_id}


@api_router.post("/families/join")
async def families_join(request: FamilyJoinRequest, current_user: dict = Depends(get_current_user)):
    """Join a family as Associate."""
    if current_user.get("family_id"):
        raise HTTPException(status_code=400, detail="Already in a family")
    fam = await db.families.find_one({"id": request.family_id}, {"_id": 0})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    count = await db.family_members.count_documents({"family_id": request.family_id})
    if count >= sum(FAMILY_ROLE_LIMITS.values()):
        raise HTTPException(status_code=400, detail="Family is full")
    now = datetime.now(timezone.utc).isoformat()
    await db.family_members.insert_one({
        "id": str(uuid.uuid4()),
        "family_id": request.family_id,
        "user_id": current_user["id"],
        "role": "associate",
        "joined_at": now,
    })
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"family_id": request.family_id, "family_role": "associate"}},
    )
    return {"message": "Joined family"}


@api_router.post("/families/leave")
async def families_leave(current_user: dict = Depends(get_current_user)):
    """Leave current family."""
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "boss_id": 1})
    if fam and fam.get("boss_id") == current_user["id"]:
        raise HTTPException(status_code=400, detail="Boss must transfer leadership or dissolve family first")
    await db.family_members.delete_one({"family_id": family_id, "user_id": current_user["id"]})
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_id": None, "family_role": None}})
    return {"message": "Left family"}


@api_router.post("/families/kick")
async def families_kick(request: FamilyKickRequest, current_user: dict = Depends(get_current_user)):
    """Kick a member (Boss/Underboss)."""
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    role = current_user.get("family_role")
    if role not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Boss or Underboss can kick")
    if request.user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot kick yourself")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": request.user_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.get("role") == "boss":
        raise HTTPException(status_code=400, detail="Cannot kick the Boss")
    await db.family_members.delete_one({"family_id": family_id, "user_id": request.user_id})
    await db.users.update_one({"id": request.user_id}, {"$set": {"family_id": None, "family_role": None}})
    return {"message": "Member kicked"}


@api_router.post("/families/assign-role")
async def families_assign_role(request: FamilyRoleRequest, current_user: dict = Depends(get_current_user)):
    """Assign role (Boss only)."""
    if current_user.get("family_role") != "boss":
        raise HTTPException(status_code=403, detail="Only Boss can assign roles")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if request.role not in FAMILY_ROLES or request.role == "boss":
        raise HTTPException(status_code=400, detail="Invalid role")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": request.user_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    counts = await db.family_members.aggregate([
        {"$match": {"family_id": family_id}},
        {"$group": {"_id": "$role", "c": {"$sum": 1}}},
    ]).to_list(20)
    by_role = {x["_id"]: x["c"] for x in counts}
    limit = FAMILY_ROLE_LIMITS.get(request.role, 0)
    if limit and (by_role.get(request.role) or 0) >= limit and member.get("role") != request.role:
        raise HTTPException(status_code=400, detail=f"Role {request.role} limit reached")
    await db.family_members.update_one({"family_id": family_id, "user_id": request.user_id}, {"$set": {"role": request.role}})
    await db.users.update_one({"id": request.user_id}, {"$set": {"family_role": request.role}})
    if request.role == "boss":
        await db.families.update_one({"id": family_id}, {"$set": {"boss_id": request.user_id}})
        await db.family_members.update_one({"family_id": family_id, "user_id": current_user["id"]}, {"$set": {"role": "underboss"}})
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_role": "underboss"}})
    return {"message": "Role updated"}


@api_router.post("/families/deposit")
async def families_deposit(request: FamilyDepositRequest, current_user: dict = Depends(get_current_user)):
    """Deposit cash into family treasury."""
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Invalid amount")
    money = int(current_user.get("money", 0) or 0)
    if money < amount:
        raise HTTPException(status_code=400, detail="Not enough cash")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": -amount}})
    await db.families.update_one({"id": family_id}, {"$inc": {"treasury": amount}})
    return {"message": "Deposited to treasury"}


@api_router.post("/families/withdraw")
async def families_withdraw(request: FamilyWithdrawRequest, current_user: dict = Depends(get_current_user)):
    """Withdraw from treasury (Boss/Underboss/Consigliere)."""
    role = current_user.get("family_role")
    if role not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    amount = int(request.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Invalid amount")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1})
    treasury = int((fam or {}).get("treasury", 0) or 0)
    if treasury < amount:
        raise HTTPException(status_code=400, detail="Not enough treasury")
    await db.families.update_one({"id": family_id}, {"$inc": {"treasury": -amount}})
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": amount}})
    return {"message": "Withdrew from treasury"}


@api_router.post("/families/rackets/{racket_id}/collect")
async def families_racket_collect(racket_id: str, current_user: dict = Depends(get_current_user)):
    """Collect racket income (on cooldown)."""
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1, "rackets": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    rackets = (fam.get("rackets") or {}).copy()
    state = rackets.get(racket_id) or {}
    level = state.get("level", 0)
    if level <= 0:
        raise HTTPException(status_code=400, detail="Racket not active")
    r_def = next((x for x in FAMILY_RACKETS if x["id"] == racket_id), None)
    if not r_def:
        raise HTTPException(status_code=404, detail="Racket not found")
    ev = await get_effective_event()
    income, cooldown_h = _racket_income_and_cooldown(racket_id, level, ev)
    last_at = state.get("last_collected_at")
    now = datetime.now(timezone.utc)
    if last_at:
        try:
            last_dt = datetime.fromisoformat(last_at.replace("Z", "+00:00"))
            if (last_dt + timedelta(hours=cooldown_h)) > now:
                raise HTTPException(status_code=400, detail="Racket on cooldown")
        except HTTPException:
            raise
        except Exception:
            pass
    now_iso = now.isoformat()
    rackets[racket_id] = {**state, "level": level, "last_collected_at": now_iso}
    await db.families.update_one({"id": family_id}, {"$set": {"rackets": rackets}, "$inc": {"treasury": income}})
    return {"message": f"Collected ${income:,}", "amount": income}


@api_router.post("/families/rackets/{racket_id}/upgrade")
async def families_racket_upgrade(racket_id: str, current_user: dict = Depends(get_current_user)):
    """Upgrade racket level (cost from treasury). Boss/Underboss/Consigliere."""
    role = current_user.get("family_role")
    if role not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1, "rackets": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    if racket_id not in [x["id"] for x in FAMILY_RACKETS]:
        raise HTTPException(status_code=404, detail="Racket not found")
    rackets = (fam.get("rackets") or {}).copy()
    state = rackets.get(racket_id) or {}
    level = state.get("level", 0)
    if level >= RACKET_MAX_LEVEL:
        raise HTTPException(status_code=400, detail="Racket already max level")
    treasury = int((fam.get("treasury") or 0) or 0)
    if treasury < RACKET_UPGRADE_COST:
        raise HTTPException(status_code=400, detail="Not enough treasury")
    rackets[racket_id] = {**state, "level": level + 1, "last_collected_at": state.get("last_collected_at")}
    await db.families.update_one({"id": family_id}, {"$set": {"rackets": rackets}, "$inc": {"treasury": -RACKET_UPGRADE_COST}})
    return {"message": f"Upgraded to level {level + 1}"}


@api_router.get("/families/racket-attack-targets")
async def families_racket_attack_targets(debug: bool = False, current_user: dict = Depends(get_current_user)):
    """List other families with at least one racket at level 1+, for raid UI."""
    my_family_id = current_user.get("family_id")
    if not my_family_id:
        return {"targets": []}
    cursor = db.families.find({"id": {"$ne": my_family_id}}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "treasury": 1, "rackets": 1})
    all_other = await cursor.to_list(50)
    ev = await get_effective_event()
    targets = []
    for fam in all_other:
        rackets = fam.get("rackets") or {}
        racket_list = []
        for rid, state in rackets.items():
            lv = state.get("level", 0)
            if lv < 1:
                continue
            r_def = next((x for x in FAMILY_RACKETS if x["id"] == rid), None)
            income, cooldown_h = _racket_income_and_cooldown(rid, lv, ev)
            potential_take = int(income * FAMILY_RACKET_ATTACK_REVENUE_PCT)
            success_chance = max(FAMILY_RACKET_ATTACK_MIN_SUCCESS, FAMILY_RACKET_ATTACK_BASE_SUCCESS - lv * FAMILY_RACKET_ATTACK_LEVEL_PENALTY)
            success_chance_pct = int(round(success_chance * 100))
            racket_list.append({
                "racket_id": rid,
                "racket_name": r_def["name"] if r_def else rid,
                "level": lv,
                "potential_take": potential_take,
                "success_chance_pct": success_chance_pct,
            })
        if racket_list:
            targets.append({
                "family_id": fam["id"],
                "family_name": fam["name"],
                "family_tag": fam["tag"],
                "treasury": fam.get("treasury", 0),
                "rackets": racket_list,
            })
    return {"targets": targets}


@api_router.post("/families/attack-racket")
async def families_attack_racket(request: FamilyAttackRacketRequest, current_user: dict = Depends(get_current_user)):
    """Raid an enemy family racket. 2h cooldown per target racket."""
    my_family_id = current_user.get("family_id")
    if not my_family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    target_fam = await db.families.find_one({"id": request.family_id}, {"_id": 0, "name": 1, "tag": 1, "treasury": 1, "rackets": 1})
    if not target_fam or request.family_id == my_family_id:
        raise HTTPException(status_code=404, detail="Family not found")
    state = (target_fam.get("rackets") or {}).get(request.racket_id) or {}
    level = state.get("level", 0)
    if level < 1:
        raise HTTPException(status_code=400, detail="Racket not active")
    cooldown_end = datetime.now(timezone.utc) - timedelta(hours=FAMILY_RACKET_ATTACK_COOLDOWN_HOURS)
    last = await db.family_racket_attacks.find_one({
        "attacker_family_id": my_family_id,
        "target_family_id": request.family_id,
        "target_racket_id": request.racket_id,
    }, {"_id": 0, "last_at": 1})
    if last and last.get("last_at"):
        try:
            last_dt = datetime.fromisoformat(last["last_at"].replace("Z", "+00:00"))
            if last_dt > cooldown_end:
                raise HTTPException(status_code=400, detail="Racket attack on cooldown (2h)")
        except HTTPException:
            raise
    ev = await get_effective_event()
    income_per, _ = _racket_income_and_cooldown(request.racket_id, level, ev)
    take = int(income_per * FAMILY_RACKET_ATTACK_REVENUE_PCT)
    success_chance = max(FAMILY_RACKET_ATTACK_MIN_SUCCESS, FAMILY_RACKET_ATTACK_BASE_SUCCESS - level * FAMILY_RACKET_ATTACK_LEVEL_PENALTY)
    success = random.random() < success_chance
    now_iso = datetime.now(timezone.utc).isoformat()
    if success and take > 0:
        treasury = int((target_fam.get("treasury") or 0) or 0)
        actual = min(take, treasury)
        if actual > 0:
            await db.families.update_one({"id": request.family_id}, {"$inc": {"treasury": -actual}})
            await db.families.update_one({"id": my_family_id}, {"$inc": {"treasury": actual}})
        await db.family_racket_attacks.update_one(
            {"attacker_family_id": my_family_id, "target_family_id": request.family_id, "target_racket_id": request.racket_id},
            {"$set": {"last_at": now_iso}},
            upsert=True,
        )
        return {"success": True, "message": f"Raid successful! Took ${actual:,}.", "amount": actual}
    await db.family_racket_attacks.update_one(
        {"attacker_family_id": my_family_id, "target_family_id": request.family_id, "target_racket_id": request.racket_id},
        {"$set": {"last_at": now_iso}},
        upsert=True,
    )
    return {"success": False, "message": "Raid failed.", "amount": 0}


@api_router.get("/families/war/stats")
async def families_war_stats(current_user: dict = Depends(get_current_user)):
    """Active wars for my family with per-war stats."""
    my_family_id = current_user.get("family_id")
    if not my_family_id:
        return {"wars": []}
    wars = await db.family_wars.find({
        "$or": [{"family_a_id": my_family_id}, {"family_b_id": my_family_id}],
        "status": {"$in": ["active", "truce_offered"]},
    }, {"_id": 0}).to_list(10)
    ev = await get_effective_event()
    out = []
    for w in wars:
        other_id = w["family_b_id"] if w["family_a_id"] == my_family_id else w["family_a_id"]
        other_fam = await db.families.find_one({"id": other_id}, {"_id": 0, "name": 1, "tag": 1})
        other_name = (other_fam or {}).get("name", "?")
        other_tag = (other_fam or {}).get("tag", "?")
        stats_docs = await db.family_war_stats.find({"war_id": w["id"]}, {"_id": 0}).to_list(200)
        by_user = {s["user_id"]: s for s in stats_docs}
        usernames = {}
        for uid in by_user:
            u = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1, "family_id": 1})
            usernames[uid] = (u or {}).get("username", "?")
            fid = (u or {}).get("family_id")
            if fid:
                f = await db.families.find_one({"id": fid}, {"_id": 0, "name": 1, "tag": 1})
            else:
                f = None
            by_user[uid]["family_name"] = (f or {}).get("name", "?")
            by_user[uid]["family_tag"] = (f or {}).get("tag", "?")
            by_user[uid]["username"] = usernames[uid]
        top_bg = sorted(by_user.values(), key=lambda x: (-(x.get("bodyguard_kills") or 0), x.get("username", "")))[:10]
        top_lost = sorted(by_user.values(), key=lambda x: (-(x.get("bodyguards_lost") or 0), x.get("username", "")))[:10]
        mvp = sorted(by_user.values(), key=lambda x: (-((x.get("kills") or 0) + (x.get("bodyguard_kills") or 0)), x.get("username", "")))[:10]
        for i, e in enumerate(mvp):
            e["impact"] = (e.get("kills") or 0) + (e.get("bodyguard_kills") or 0)
        out.append({
            "war": {
                "id": w["id"],
                "family_a_id": w["family_a_id"],
                "family_b_id": w["family_b_id"],
                "status": w["status"],
                "other_family_id": other_id,
                "other_family_name": other_name,
                "other_family_tag": other_tag,
                "truce_offered_by_family_id": w.get("truce_offered_by_family_id"),
            },
            "stats": {
                "top_bodyguard_killers": top_bg,
                "top_bodyguards_lost": top_lost,
                "mvp": mvp,
            },
        })
    return {"wars": out}


@api_router.post("/families/war/truce/offer")
async def families_war_truce_offer(request: WarTruceRequest, current_user: dict = Depends(get_current_user)):
    """Offer truce (Boss/Underboss)."""
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Boss or Underboss can offer truce")
    war = await db.family_wars.find_one({"id": request.war_id}, {"_id": 0})
    if not war or war.get("status") != "active":
        raise HTTPException(status_code=404, detail="War not found or not active")
    if family_id not in (war["family_a_id"], war["family_b_id"]):
        raise HTTPException(status_code=403, detail="Not your war")
    await db.family_wars.update_one(
        {"id": request.war_id},
        {"$set": {"status": "truce_offered", "truce_offered_by_family_id": family_id}},
    )
    await send_notification_to_family(
        war["family_a_id"] if war["family_b_id"] == family_id else war["family_b_id"],
        "Truce offered",
        "The enemy family has offered a truce. Boss or Underboss can accept.",
        "system",
    )
    return {"message": "Truce offered"}


@api_router.post("/families/war/truce/accept")
async def families_war_truce_accept(request: WarTruceRequest, current_user: dict = Depends(get_current_user)):
    """Accept truce (Boss/Underboss of other family)."""
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Boss or Underboss can accept truce")
    war = await db.family_wars.find_one({"id": request.war_id}, {"_id": 0})
    if not war or war.get("status") != "truce_offered":
        raise HTTPException(status_code=404, detail="War not found or no truce offered")
    if family_id not in (war["family_a_id"], war["family_b_id"]):
        raise HTTPException(status_code=403, detail="Not your war")
    if war.get("truce_offered_by_family_id") == family_id:
        raise HTTPException(status_code=400, detail="You offered the truce; the other side must accept")
    now = datetime.now(timezone.utc).isoformat()
    await db.family_wars.update_one(
        {"id": request.war_id},
        {"$set": {"status": "truce", "ended_at": now}},
    )
    return {"message": "Truce accepted. War ended."}


@api_router.get("/families/wars/history")
async def families_wars_history(current_user: dict = Depends(get_current_user)):
    """Last 10 family wars with names and result."""
    wars = await db.family_wars.find({}, {"_id": 0}).sort("created_at", -1).limit(10).to_list(10)
    family_ids = set()
    for w in wars:
        family_ids.add(w.get("family_a_id"))
        family_ids.add(w.get("family_b_id"))
    family_map = {}
    if family_ids:
        for f in await db.families.find({"id": {"$in": list(family_ids)}}, {"_id": 0, "id": 1, "name": 1, "tag": 1}).to_list(20):
            family_map[f["id"]] = f
    out = []
    for w in wars:
        fa = family_map.get(w.get("family_a_id"), {})
        fb = family_map.get(w.get("family_b_id"), {})
        winner_id = w.get("winner_family_id")
        winner_fam = family_map.get(winner_id, {}) if winner_id else {}
        out.append({
            "id": w["id"],
            "family_a_id": w["family_a_id"],
            "family_b_id": w["family_b_id"],
            "family_a_name": fa.get("name", "?"),
            "family_a_tag": fa.get("tag", "?"),
            "family_b_name": fb.get("name", "?"),
            "family_b_tag": fb.get("tag", "?"),
            "status": w.get("status", "active"),
            "winner_family_id": winner_id,
            "winner_family_name": winner_fam.get("name", "?"),
            "ended_at": w.get("ended_at"),
            "prize_exclusive_cars": w.get("prize_exclusive_cars"),
            "prize_rackets": w.get("prize_rackets") or [],
        })
    return {"wars": out}

# Crime endpoints -> see routers/crimes.py
# Register modular routers (crimes, gta, jail)
from routers import crimes, gta, jail
crimes.register(api_router)
gta.register(api_router)
jail.register(api_router)

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
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_db():
    await init_game_data()
    from routers.jail import spawn_jail_npcs
    asyncio.create_task(spawn_jail_npcs())

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

async def init_game_data():
    # Update crimes with new cooldowns (seconds instead of minutes for faster gameplay)
    await db.crimes.delete_many({})
    crimes = [
        {"id": "crime1", "name": "Pickpocket", "description": "Steal from unsuspecting citizens - quick cash", "min_rank": 1, "reward_min": 50, "reward_max": 200, "cooldown_seconds": 15, "cooldown_minutes": 0.25, "crime_type": "petty"},
        {"id": "crime2", "name": "Mug a Pedestrian", "description": "Rob someone on the street", "min_rank": 1, "reward_min": 100, "reward_max": 400, "cooldown_seconds": 30, "cooldown_minutes": 0.5, "crime_type": "petty"},
        {"id": "crime3", "name": "Bootlegging", "description": "Smuggle illegal alcohol", "min_rank": 2, "reward_min": 500, "reward_max": 1500, "cooldown_seconds": 120, "cooldown_minutes": 2, "crime_type": "medium"},
        {"id": "crime4", "name": "Armed Robbery", "description": "Rob a local store at gunpoint", "min_rank": 3, "reward_min": 2000, "reward_max": 5000, "cooldown_seconds": 300, "cooldown_minutes": 5, "crime_type": "medium"},
        {"id": "crime5", "name": "Extortion", "description": "Shake down local businesses", "min_rank": 4, "reward_min": 5000, "reward_max": 12000, "cooldown_seconds": 600, "cooldown_minutes": 10, "crime_type": "medium"},
        {"id": "crime6", "name": "Jewelry Heist", "description": "Rob a jewelry store", "min_rank": 5, "reward_min": 10000, "reward_max": 25000, "cooldown_seconds": 900, "cooldown_minutes": 15, "crime_type": "major"},
        {"id": "crime7", "name": "Bank Heist", "description": "Rob a bank vault - high risk, high reward", "min_rank": 7, "reward_min": 50000, "reward_max": 150000, "cooldown_seconds": 1800, "cooldown_minutes": 30, "crime_type": "major"},
        {"id": "crime8", "name": "Casino Heist", "description": "Rob a casino - the big score", "min_rank": 9, "reward_min": 200000, "reward_max": 500000, "cooldown_seconds": 3600, "cooldown_minutes": 60, "crime_type": "major"}
    ]
    await db.crimes.insert_many(crimes)
    
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
        properties = [
            {"id": "prop1", "name": "Speakeasy", "property_type": "casino", "price": 5000, "income_per_hour": 100, "max_level": 10},
            {"id": "prop2", "name": "Bullet Factory", "property_type": "factory", "price": 20000, "income_per_hour": 500, "max_level": 5},
            {"id": "prop3", "name": "Underground Casino", "property_type": "casino", "price": 50000, "income_per_hour": 1000, "max_level": 8},
            {"id": "prop4", "name": "Luxury Casino", "property_type": "casino", "price": 200000, "income_per_hour": 5000, "max_level": 5}
        ]
        await db.properties.insert_many(properties)
