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
import json
import logging
import logging.handlers
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr, field_validator
from typing import List, Optional, Dict, Union
import uuid
from datetime import datetime, timezone, timedelta
from utils.game_pass_micro_rewards import (
    micro_tier_from_rank_points,
    rewards_for_micro_tier,
    format_rewards_summary,
    MAX_MICRO_TIER,
    REWARD_KEY_ORDER,
    REWARD_KEY_LABELS,
    free_unlocked_key_for_micro_tier,
)
from passlib.context import CryptContext
from jose import JWTError, jwt
import random
import math
import time
from urllib.parse import unquote
import httpx
import certifi

# Import security module (anti-cheat and monitoring)
import middleware.security as security_module

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
# Also load project root .env if present (e.g. when running from root)
load_dotenv(ROOT_DIR.parent / '.env')

# MongoDB connection (certifi CA bundle only needed for Atlas/DO SSL, skip for localhost)
mongo_url = os.environ['MONGO_URL']
_mps = os.environ.get("MONGO_MAX_POOL_SIZE", "").strip()
_mongo_max_pool = int(_mps) if _mps.isdigit() else 25  # friendly default for 1vCPU managed Mongo tiers
_mongo_client_kwargs = {"maxPoolSize": _mongo_max_pool}
if 'mongodb+srv' in mongo_url or 'mongodb.net' in mongo_url or 'mongo.ondigitalocean.com' in mongo_url:
    client = AsyncIOMotorClient(mongo_url, tlsCAFile=certifi.where(), **_mongo_client_kwargs)
else:
    client = AsyncIOMotorClient(mongo_url, **_mongo_client_kwargs)
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
# Session length: default 24h so stepping away doesn't log you out. Override with JWT_EXPIRE_MINUTES in .env (e.g. 10080 = 7 days).
_access_expire = os.environ.get("JWT_EXPIRE_MINUTES", "").strip()
ACCESS_TOKEN_EXPIRE_MINUTES = int(_access_expire) if _access_expire.isdigit() else 60 * 24
# Inactivity timeout: session ends after this many minutes with no requests. 0 = disabled (only JWT expiry applies). Override with SESSION_INACTIVITY_MINUTES in .env.
_inactivity = os.environ.get("SESSION_INACTIVITY_MINUTES", "").strip()
SESSION_INACTIVITY_MINUTES = int(_inactivity) if _inactivity.isdigit() else 30

security = HTTPBearer()

# Create the main app without a prefix
app = FastAPI()

# Security monitoring (imported after app creation)
from middleware.security import (
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
# Rank is based on rank_points only. Godfather is the top rank (~1.02M RP after 15% curve ease).
# Thresholds scaled by 0.85 vs original ladder (15% fewer RP per tier).
RANKS = [
    {"id": 1, "name": "Rat", "required_points": 0},
    {"id": 2, "name": "Street Thug", "required_points": 680},
    {"id": 3, "name": "Hustler", "required_points": 1530},
    {"id": 4, "name": "Goon", "required_points": 3400},
    {"id": 5, "name": "Made Man", "required_points": 7650},
    {"id": 6, "name": "Capo", "required_points": 17000},
    {"id": 7, "name": "Underboss", "required_points": 38250},
    {"id": 8, "name": "Consigliere", "required_points": 85850},
    {"id": 9, "name": "Boss", "required_points": 191250},
    {"id": 10, "name": "Don", "required_points": 428400},
    {"id": 11, "name": "Capo di tutti capi", "required_points": 958800},
    {"id": 12, "name": "Boss of Bosses", "required_points": 989400},
    {"id": 13, "name": "Godfather", "required_points": 1020000},
]
GODFATHER_RANK_ID = RANKS[-1]["id"]  # Top rank (prestige requires this)
CAPO_RANK_ID = 6  # Minimum rank to claim or hold casino/property; below-Capo owners have 3h grace then auto-relinquish

# Prestige: 5 levels unlocked after reaching Godfather. Each level harder to rank through.
# mission_reward_mult: mission payouts/rewards scale 0.5x (P1) .. 2.5x (P5) when redoing missions after prestige.
PRESTIGE_CONFIGS = {
    1: {"threshold_mult": 1.0,  "crime_mult": 1.10, "oc_mult": 1.10, "gta_rare_boost": 0.5,  "npc_mult": 1.10, "name": "Made",             "godfather_req": 340_000, "mission_reward_mult": 0.5, "illegal_business_mult": 1.10},
    2: {"threshold_mult": 1.5,  "crime_mult": 1.20, "oc_mult": 1.20, "gta_rare_boost": 1.0,  "npc_mult": 1.20, "name": "Earner",           "godfather_req": 510_000, "mission_reward_mult": 1.0, "illegal_business_mult": 1.20},
    3: {"threshold_mult": 2.25, "crime_mult": 1.30, "oc_mult": 1.30, "gta_rare_boost": 1.5,  "npc_mult": 1.30, "name": "Capo di Capi",     "godfather_req": 765_000, "mission_reward_mult": 1.5, "illegal_business_mult": 1.30},
    4: {"threshold_mult": 3.5,  "crime_mult": 1.40, "oc_mult": 1.40, "gta_rare_boost": 2.0,  "npc_mult": 1.40, "name": "The Don",          "godfather_req": 1_190_000, "mission_reward_mult": 2.0, "illegal_business_mult": 1.40},
    5: {"threshold_mult": 5.0,  "crime_mult": 1.50, "oc_mult": 1.50, "gta_rare_boost": 2.5,  "npc_mult": 1.50, "name": "Godfather Legacy", "godfather_req": 1_700_000, "mission_reward_mult": 2.5, "illegal_business_mult": 1.50},
}

def get_prestige_requirement(current_level: int) -> int:
    """
    Effective rank points required to prestige from current_level -> current_level+1.

    Uses PRESTIGE_CONFIGS godfather_req as the target but blends it with the
    Godfather threshold so that most of the climb happens across all ranks and
    only a shorter stretch is spent parked at Godfather.
    """
    if current_level < 0 or current_level >= 5:
        return 0
    next_level = current_level + 1
    cfg = PRESTIGE_CONFIGS.get(next_level)
    if not cfg:
        return 0
    base_req = int(cfg.get("godfather_req") or 0)
    if base_req <= 0:
        return 0
    base_gf_req = RANKS[-1]["required_points"]  # Godfather threshold
    if base_req <= base_gf_req:
        return base_req
    # Blend the original requirement with the Godfather threshold so that
    # effective RP at first reaching Godfather already covers a large share
    # of the requirement, and the extra needed at Godfather is a shorter stretch.
    blended = int((base_req + base_gf_req) / 2)
    # Always require at least a small amount above Godfather.
    min_above_gf = base_gf_req + 21_250
    return max(blended, min_above_gf)

def get_prestige_bonus(user: dict) -> dict:
    """Return stacking benefit multipliers for a user based on their prestige_level."""
    level = min(int(user.get("prestige_level") or 0), 5)
    if level == 0:
        return {"crime_mult": 1.0, "oc_mult": 1.0, "gta_rare_boost": 0.0, "npc_mult": 1.0, "mission_reward_mult": 1.0, "illegal_business_mult": 1.0}
    cfg = PRESTIGE_CONFIGS[level]
    return {**{k: cfg[k] for k in ("crime_mult", "oc_mult", "gta_rare_boost", "npc_mult")}, "mission_reward_mult": cfg["mission_reward_mult"], "illegal_business_mult": cfg.get("illegal_business_mult", 1.0)}

# Founding Member: +2.5% on crimes, GTA, OC, hitlist NPC, properties, rackets, missions (see founding_member_income_mult).
FOUNDING_MEMBER_INCOME_MULT = 1.025


def founding_member_income_mult(user: Optional[dict]) -> float:
    """Return 1.025 if user is a founding member (flag or Founding Member badge), else 1.0."""
    if not user:
        return 1.0
    if user.get("founding_member"):
        return FOUNDING_MEMBER_INCOME_MULT
    badges = user.get("badges")
    if isinstance(badges, list) and "Founding Member" in badges:
        return FOUNDING_MEMBER_INCOME_MULT
    return 1.0


def rank_xp_pass_multiplier(user: Optional[dict]) -> float:
    """
    Rank-XP Pass multiplier.

    Current rules: the Game Pass no longer grants a temporary 24h multiplier window.
    Rewards are delivered as one-time tier rewards at activation, so gameplay multiplier is always 1.0.
    """
    return 1.0


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
    {"hours": 3, "rate": 0.0025},   # 0.25%
    {"hours": 6, "rate": 0.006},    # 0.6%
    {"hours": 12, "rate": 0.0125},  # 1.25%
    {"hours": 24, "rate": 0.025},   # 2.5%
    {"hours": 48, "rate": 0.06},    # 6%
    {"hours": 72, "rate": 0.10},    # 10%
]

# Health & armour: health 0-100, armour 0-5. Bullets to kill clamped to [MIN_BULLETS_TO_KILL, MAX_BULLETS_TO_KILL]
DEFAULT_HEALTH = 100
# Passive regen: linear 0→100% over this many seconds of real time (lazy: applied on auth + before PvP damage calc)
HEALTH_REGEN_FULL_SECONDS = 7200  # 2 hours
MIN_BULLETS_TO_KILL = 5000
MAX_BULLETS_TO_KILL = 100000
ARMOUR_BASE_BULLETS = {0: 5000, 1: 25000, 2: 45000, 3: 65000, 4: 85000, 5: 100000, 6: 120000}  # 6 = loot-exclusive Steel Plate Vest (1922)
KILL_CASH_PERCENT = 0.25  # killer gets 25% of victim's cash
DEAD_ALIVE_PERCENT = 0.9995  # 0.05% tax to state head: you receive 99.95% of dead account's money and points when using Dead > Alive (one-time)

# State heads: which family (if any) is head of each state. One family per state; at most 4 families.
async def get_state_heads() -> Dict[str, Optional[str]]:
    """Return { state: family_id or None } for all STATES. Stored in game_settings key 'state_heads'."""
    doc = await db.game_settings.find_one({"key": "state_heads"}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value") or {}
    out = {}
    for s in (STATES or []):
        out[s] = (raw.get(s) or "").strip() or None
    return out


async def get_head_family_id_for_state(state: str) -> Optional[str]:
    """Return family_id that is head of the given state, or None."""
    if not (state or "").strip():
        return None
    heads = await get_state_heads()
    return heads.get((state or "").strip())


async def set_state_head(state: str, family_id: Optional[str], force: bool = False) -> str:
    """Set or clear the head family for a state. Updates game_settings and family head_of_state.
    A family can only be head of ONE state - blocks if they already head another (unless force=True for admin cleanup).
    Returns error message string if blocked, or empty string on success.
    """
    state = (state or "").strip()
    if state not in (STATES or []):
        return "Invalid state"
    heads = await get_state_heads()
    old_fid = heads.get(state)
    fid = (family_id or "").strip() or None

    # Block if family already heads another state (unless force=True for admin cleanup)
    if fid and not force:
        for other_state, other_fid in heads.items():
            if other_fid == fid and other_state != state:
                return f"This family is already head of {other_state}. A family can only control one state."

    new_value = {**heads, state: fid}
    await db.game_settings.update_one(
        {"key": "state_heads"},
        {"$set": {"value": new_value}},
        upsert=True,
    )
    if old_fid and old_fid != fid:
        await db.families.update_one({"id": old_fid}, {"$set": {"head_of_state": None}})
    if fid:
        await db.families.update_one({"id": fid}, {"$set": {"head_of_state": state}})
    return ""


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
    {"id": "racket_bonus_day", "name": "Racket Bonus Day", "message": "Rackets: +10% payouts and 25% faster cooldowns.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 0.75, "racket_payout": 1.1, "armour_weapon_cost": 1.0},
    {"id": "armour_weapon_half_price", "name": "Armour & Weapons 50% Off", "message": "Armour and weapons 50% off today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 0.5},
    {"id": "armour_weapon_premium", "name": "Armour & Weapons 10% More", "message": "Armour and weapons 10% more expensive today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.1},
    {"id": "oc_payout_boost", "name": "OC Payout +15%", "message": "Organised crime payouts 15% higher today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.15, "armour_weapon_cost": 1.0},
    {"id": "racket_cooldown_faster", "name": "Crime Cooldown -20%", "message": "Racket cooldowns 20% shorter today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 0.8, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "gta_cash_boost", "name": "GTA Cash +50%", "message": "Kill loot and heist cash 50% higher today.", "rank_points": 1.0, "kill_cash": 1.5, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "no_event_day", "name": "No Event Day", "message": "No bonuses or penalties today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "rank_points_boost", "name": "Rank Points +50%", "message": "Kills and GTA reward 50% more rank points today.", "rank_points": 1.5, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "bodyguard_quarter_off", "name": "Bodyguards 25% Off", "message": "Bodyguard services 25% off today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 0.75, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "racket_payout_boost", "name": "Rackets +20% Payouts", "message": "Family rackets pay 20% more today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.2, "armour_weapon_cost": 1.0},
    {"id": "armour_weapon_quarter_off", "name": "Armour & Weapons 25% Off", "message": "Armour and weapons 25% off today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 0.75},
    {"id": "gta_success_boost", "name": "GTA Success +25%", "message": "GTA success chance 25% higher today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.25, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "rank_points_penalty", "name": "Rank Points -25%", "message": "Kills and GTA reward 25% less rank points today.", "rank_points": 0.75, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "bodyguard_premium_day", "name": "Bodyguards 25% More", "message": "Bodyguard services 25% more expensive today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.25, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "racket_payout_penalty", "name": "Rackets -20% Payouts", "message": "Family rackets pay 20% less today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 0.8, "armour_weapon_cost": 1.0},
    {"id": "armour_weapon_premium_day", "name": "Armour & Weapons 25% More", "message": "Armour and weapons 25% more expensive today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.25},
    {"id": "gta_success_penalty", "name": "GTA Success -25%", "message": "GTA success chance 25% lower today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 0.75, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "bullets_store_25_off", "name": "Bullets in Store 25% Off", "message": "Bullets in the store 25% cheaper today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 0.75},
    {"id": "bullets_store_25_more", "name": "Bullets in Store +25%", "message": "Bullets in the store 25% more expensive today.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.25},
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

async def get_disabled_event_ids() -> list:
    """Event ids that are disabled by admin. When today's rotated event is in this list, effective event is NO_EVENT."""
    doc = await db.game_config.find_one({"id": "main"}, {"_id": 0, "disabled_event_ids": 1})
    raw = doc.get("disabled_event_ids") if doc else None
    if not isinstance(raw, list):
        return []
    return [str(x).strip() for x in raw if x]

async def get_override_event_id() -> Optional[str]:
    """Admin-set override: when set, this event is used instead of the day's rotation. None = use rotation."""
    doc = await db.game_config.find_one({"id": "main"}, {"_id": 0, "override_event_id": 1})
    raw = doc.get("override_event_id") if doc else None
    if raw is None:
        return None
    s = str(raw).strip()
    return s if s else None

async def get_active_game_event_async():
    """Today's game event (rotation or admin override); returns NO_EVENT if that event is disabled by admin."""
    override_id = await get_override_event_id()
    if override_id:
        for ev in GAME_EVENTS:
            if ev.get("id") == override_id:
                return ev.copy()
    event = get_active_game_event()
    disabled = await get_disabled_event_ids()
    if event.get("id") in disabled:
        return NO_EVENT.copy()
    return event

async def get_effective_event():
    """Current event multipliers if events enabled, else NO_EVENT. When all_events_for_testing, returns combined event. Never raises."""
    try:
        if not await get_events_enabled():
            return NO_EVENT.copy()
        if await get_all_events_for_testing():
            return get_combined_event()
        return await get_active_game_event_async()
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
GARAGE_BATCH_UPGRADE_COST = 75
GARAGE_BATCH_LIMIT_MAX = 100

# Bullet storage cap: melt (and other sources) cannot push bullets above this
BULLET_STORAGE_CAP = 250_000

# Points store: list ~£2.50/1k; larger packs add volume discount (£x.99); 100k < 2×50k
POINT_PACKAGES = {
    "starter": {"points": 2500, "price_gbp": 5.99},
    "bronze": {"points": 5000, "price_gbp": 11.99},
    "silver": {"points": 10000, "price_gbp": 21.99},
    "gold": {"points": 25000, "price_gbp": 52.99},
    "platinum": {"points": 50000, "price_gbp": 99.99},
    "diamond": {"points": 100000, "price_gbp": 189.99},
    # Rank-XP pass entitlement (no points credited; token is activated in Armoury).
    "rank_xp_pass_499": {"points": 0, "price_gbp": 4.99},
}

# Travel times based on car rarity (in seconds)
TRAVEL_TIMES = {
    "loot_exclusive": 5,
    "exclusive": 7,
    "legendary": 15,
    "ultra_rare": 18,
    "rare": 25,
    "uncommon": 35,
    "common": 45,
    "custom": 12,  # Custom car from points
    "airport": 0   # Airport (instant)
}

# Melt-for-bullets: floor(car_value / MELT_VALUE_PER_BULLET) per car — see gta._melt_cars_impl
MELT_VALUE_PER_BULLET = 500

CARS = [
    # Common (difficulty 1) - 6 cars, values $125-$188 ascending (75% reduction)
    {"id": "car1", "name": "Model T Ford", "rarity": "common", "min_difficulty": 1, "value": 125, "travel_bonus": 0, "image": "/images/gta/car1.jpg"},
    {"id": "car5", "name": "Essex Coach", "rarity": "common", "min_difficulty": 1, "value": 138, "travel_bonus": 0, "image": "/images/gta/car5.jpg"},
    {"id": "car2", "name": "Chevrolet Series AB", "rarity": "common", "min_difficulty": 1, "value": 150, "travel_bonus": 5, "image": "/images/gta/car2.jpg"},
    {"id": "car6", "name": "Durant Star", "rarity": "common", "min_difficulty": 1, "value": 163, "travel_bonus": 5, "image": "/images/gta/car6.jpg"},
    {"id": "car4", "name": "Ford Model A", "rarity": "common", "min_difficulty": 1, "value": 175, "travel_bonus": 5, "image": "/images/gta/car4.jpg"},
    {"id": "car3", "name": "Dodge Brothers", "rarity": "common", "min_difficulty": 1, "value": 188, "travel_bonus": 5, "image": "/images/gta/car3.jpg"},
    # Uncommon (difficulty 2) - 4 cars; melt ~3–7 bullets each at MELT_VALUE_PER_BULLET=500
    {"id": "car7", "name": "Oakland", "rarity": "uncommon", "min_difficulty": 2, "value": 1500, "travel_bonus": 10, "image": "/images/gta/car7.jpg"},
    {"id": "car8", "name": "Willys-Knight", "rarity": "uncommon", "min_difficulty": 2, "value": 2250, "travel_bonus": 10, "image": "/images/gta/car8.jpg"},
    {"id": "car10", "name": "Buick Master Six", "rarity": "uncommon", "min_difficulty": 2, "value": 3000, "travel_bonus": 12, "image": "/images/gta/car10.jpg"},
    {"id": "car9", "name": "Cadillac V-8", "rarity": "uncommon", "min_difficulty": 2, "value": 3850, "travel_bonus": 15, "image": "/images/gta/car9.jpg"},
    # Rare (difficulty 3) - 4 cars; melt ~8–17 bullets each
    {"id": "car11", "name": "Packard Eight", "rarity": "rare", "min_difficulty": 3, "value": 4000, "travel_bonus": 20, "image": "/images/gta/car11.jpg"},
    {"id": "car12", "name": "Lincoln Model L", "rarity": "rare", "min_difficulty": 3, "value": 5500, "travel_bonus": 20, "image": "/images/gta/car12.jpg"},
    {"id": "car13", "name": "Pierce-Arrow", "rarity": "rare", "min_difficulty": 3, "value": 7000, "travel_bonus": 25, "image": "/images/gta/car13.jpg"},
    {"id": "car14", "name": "Stutz Bearcat", "rarity": "rare", "min_difficulty": 3, "value": 8500, "travel_bonus": 25, "image": "/images/gta/car14.jpg"},
    # Ultra Rare (difficulty 4) - 3 cars; melt ~19–35 bullets each
    {"id": "car15", "name": "Duesenberg Model J", "rarity": "ultra_rare", "min_difficulty": 4, "value": 9500, "travel_bonus": 35, "image": "/images/gta/car15.jpeg"},
    {"id": "car16", "name": "Cord L-29", "rarity": "ultra_rare", "min_difficulty": 4, "value": 12500, "travel_bonus": 35, "image": "/images/gta/car16.jpg"},
    {"id": "car17", "name": "Auburn Speedster", "rarity": "ultra_rare", "min_difficulty": 4, "value": 17500, "travel_bonus": 40, "image": "/images/gta/car17.jpg"},
    # Legendary (difficulty 5) - 2 cars; melt ~40–47 bullets each
    {"id": "car18", "name": "Bugatti Type 41 Royale", "rarity": "legendary", "min_difficulty": 5, "value": 20000, "travel_bonus": 50, "image": "/images/gta/car18.jpg"},
    {"id": "car19", "name": "Rolls-Royce Phantom II", "rarity": "legendary", "min_difficulty": 5, "value": 23500, "travel_bonus": 55, "image": "/images/gta/car19.jpg"},
    # Custom (store only, 500 pts) - melt ~100 bullets
    {"id": "car_custom", "name": "Custom Car", "rarity": "custom", "min_difficulty": 5, "value": 50000, "travel_bonus": 55, "image": None},
    # Exclusive (admin only) - $62,500,000 (75% reduction)
    {"id": "car20", "name": "Al Capone's Armored Cadillac", "rarity": "exclusive", "min_difficulty": 5, "value": 62500000, "travel_bonus": 60, "image": "/images/gta/car20.png"},
    # Loot-exclusive (loot box only, cap 3 globally) - $125,000,000 (75% reduction)
    {"id": "car21", "name": "1930 Cadillac Series 452 V-16 Armored Sedan", "rarity": "loot_exclusive", "min_difficulty": 5, "value": 125000000, "travel_bonus": 68, "image": "/images/gta/car21.png"},
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
    bodyguard_count: int = 0  # current number of hired bodyguards (filled slots)
    bullets: int
    molotovs: int = 0
    health: int
    armour_level: int
    current_state: str
    total_kills: int
    total_deaths: int
    in_jail: bool
    jail_until: Optional[str]
    premium_rank_bar: bool
    has_silencer: bool = False
    gun_name: Optional[str] = None  # equipped weapon display name
    armour_name: Optional[str] = None  # equipped armour display name
    location: Optional[str] = None  # alias for current_state for sidebar
    gang_name: Optional[str] = None  # family name for sidebar
    anti_snitch: bool = False
    auto_rank_purchased: bool = False
    auto_rank_enabled: bool = False
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
    dashboard_preferences: Optional[Dict] = None  # dashboard layout (section order, at_a_glance visibility/stats)
    account_locked: bool = False  # under investigation: only /locked page and one comment allowed
    account_locked_at: Optional[str] = None
    account_locked_until: Optional[str] = None  # when set, lock auto-expires at this time (e.g. test lock)
    account_locked_comment: Optional[str] = None  # user's one-time comment
    can_submit_comment: bool = False  # true when locked and no comment submitted yet
    email_verified: bool = True  # false until user clicks verification link
    respect_points: int = 0  # second currency; earn from activities, spend in store at 5x; not sendable/tradeable
    loot_box_pieces: int = 0
    profile_autoplay_video: bool = True  # when viewing someone's profile, autoplay their YouTube video (can turn off in profile settings)
    admin_online_color: Optional[str] = None  # global setting for styling "Admin" rank (so profile API can omit it when viewing others)
    mod_online_color: Optional[str] = None  # moderator's own colour on Users Online (default dark blue when not set)
    is_help_desk_operator: bool = False  # can reply/close help desk tickets; shown dark green on Users Online
    # Death state (when account has been killed)
    is_dead: bool = False
    dead_at: Optional[str] = None
    money_at_death: int = 0
    points_at_death: Optional[int] = None
    killed_by_username: Optional[str] = None
    killed_by_family_name: Optional[str] = None
    killer_revealed: bool = False
    family_name: Optional[str] = None  # convenience for DeathScreen; mirrors gang_name for dead users
    # Active consumable token expiry times (for flashing indicators on relevant pages)
    xp_crimes_until: Optional[str] = None
    xp_gta_until: Optional[str] = None
    melt_until: Optional[str] = None
    oc_reduced_until: Optional[str] = None
    booze_until: Optional[str] = None
    racket_until: Optional[str] = None
    travel_until: Optional[str] = None
    properties_until: Optional[str] = None
    jailbust_bonus_until: Optional[str] = None
    # Rank-XP pass token: 24h window starts only when the token is activated in Armoury.
    rank_xp_pass_bonus_until: Optional[str] = None
    # Unactivated consumable token counts (armoury inventory); store purchases respect STORE_TOKEN_MAX_HELD
    xp_crimes_tokens: int = 0
    xp_gta_tokens: int = 0
    melt_tokens: int = 0
    oc_reduced_tokens: int = 0
    booze_tokens: int = 0
    racket_tokens: int = 0
    travel_tokens: int = 0
    properties_tokens: int = 0
    jailbust_tokens: int = 0
    # Rank-XP pass token entitlement (unactivated): stored as 0 or 1 via purchase rules.
    rank_xp_pass_tokens: int = 0
    # For unactivated pass tokens only: expires if not used within 1 month.
    rank_xp_pass_token_expires_at: Optional[str] = None
    # Tier snapshot for the pass (rank_points at purchase time), used to compute rewards.
    rank_xp_pass_tier_snapshot: Optional[int] = None
    # Cursor: highest micro tier rewards already granted (1..100, 0 = none).
    rank_xp_pass_last_granted_micro_tier: int = 0
    # Idempotency guard for tiered one-time rewards.
    rank_xp_pass_rewards_granted: bool = False
    shooting_range_bonus_plays: int = 0  # store upgrade: added to base 10 plays/hour in shooting range
    censor_profanity: bool = False  # when true, chat/forum show swear words as ***
    referred_by: Optional[str] = None  # referrer user id (set at signup via referral code)
    referred_by_username: Optional[str] = None  # referrer username for display
    rules_accepted: bool = False
    rules_accepted_at: Optional[str] = None

class NotificationCreate(BaseModel):
    title: str
    message: str
    notification_type: str  # rank_up, reward, bodyguard, attack, system

class DeadAliveRetrieveRequest(BaseModel):
    dead_username: str
    dead_password: str


class DeadAliveReviveRequest(BaseModel):
    dead_username: str
    dead_password: Optional[str] = None  # Required when dead account's email was freed (e.g. after Dead > Alive / new registration with same email)


class AvatarUpdateRequest(BaseModel):
    avatar_data: str  # data URL: data:image/...;base64,...

class NotificationBallPositionRequest(BaseModel):
    """Pixel position for draggable notification ball (synced across devices)."""
    x: int
    y: int


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
    theme_variant: Optional[str] = None
    custom_themes: Optional[List[Dict]] = None
    sidebar_layout: Optional[str] = None
    mobile_nav_style: Optional[str] = None
    mobile_stats_display: Optional[str] = None
    button_shape_id: Optional[str] = None
    top_bar_gap: Optional[str] = None
    top_bar_size: Optional[str] = None
    top_bar_chip_width_scale: Optional[int] = None
    top_bar_chip_height_scale: Optional[int] = None
    sidebar_show_dividers: Optional[bool] = None
    bottom_nav_show_dividers: Optional[bool] = None
    sidebar_divider_style: Optional[str] = None
    sidebar_spacing: Optional[str] = None
    toast_position: Optional[str] = None
    toast_close_button: Optional[bool] = None
    kill_toast_style: Optional[str] = None
    toast_custom_x: Optional[int] = None
    toast_custom_y: Optional[int] = None
    top_bar_stat_order: Optional[List[str]] = None
    notification_ball_position: Optional[NotificationBallPositionRequest] = None


class DashboardPreferencesRequest(BaseModel):
    """Dashboard layout preferences (all optional). Omitted keys are left unchanged."""
    section_order: Optional[List[str]] = None
    at_a_glance_visible: Optional[bool] = None
    at_a_glance_stats: Optional[List[str]] = None


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
    mod_default_online_color: Optional[str] = None  # default for Mod in legend (individual mods can override)
    hdo_online_color: Optional[str] = None  # colour for Help Desk Operator in legend

# Helper functions
def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def maybe_respect_points_drop() -> int:
    """Rare chance to award 1-2 respect points (e.g. from crimes, GTA, OC). Returns 0 or random 1-2."""
    if random.random() < 0.12:  # 12% chance
        return random.randint(1, 2)
    return 0


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def _log_auth_failure(user_id: Optional[str], status: int, reason: str):
    """Log auth failure for admin visibility (e.g. failed to load profile after login)."""
    logging.getLogger(__name__).warning(
        "Auth failure (profile/me): user_id=%s status=%s reason=%s",
        user_id or "unknown",
        status,
        reason,
    )


ACCOUNT_LOCKED_WHITELIST = {"/api/auth/me", "/api/account-locked", "/api/account-locked-reply"}
DEAD_ACCOUNT_WHITELIST = {
    "/api/auth/me",
    "/api/death/reveal-killer",
    "/api/user/rank-progress",
}

# Jail: block only Crime / GTA steal hub / OC / Booze Run. All other authenticated routes are allowed.
# GTA cars (garage, melt, marketplace, etc.) use /api/gta/... but are not the steal page — do not block whole /api/gta/.
JAIL_BLOCKED_EXACT = frozenset({
    "/api/crimes",
    "/api/gta/options",
    "/api/gta/attempt",
    "/api/gta/recent-stolen",
    "/api/gta/stats",

})
JAIL_BLOCKED_PREFIXES = (
    "/api/crimes/",
    "/api/oc/",
    "/api/organised-crime/",
    "/api/booze-run/",
)


def _is_jail_blocked_path(path: str) -> bool:
    if path in JAIL_BLOCKED_EXACT:
        return True
    return any(path.startswith(p) for p in JAIL_BLOCKED_PREFIXES)


async def apply_passive_health_regen(user_id: str, user: dict) -> None:
    """Lazy passive health for alive human players. Mutates user dict; may persist health + health_regen_last_at."""
    if not user_id or user.get("is_dead") or user.get("is_npc"):
        return
    try:
        h = float(user.get("health", DEFAULT_HEALTH))
    except (TypeError, ValueError):
        h = float(DEFAULT_HEALTH)
    if h >= 100.0:
        user["health"] = 100.0
        return
    now = datetime.now(timezone.utc)
    raw_last = user.get("health_regen_last_at")
    if not raw_last:
        iso = now.isoformat()
        await db.users.update_one({"id": user_id}, {"$set": {"health_regen_last_at": iso}})
        user["health_regen_last_at"] = iso
        return
    try:
        last = datetime.fromisoformat(str(raw_last).replace("Z", "+00:00"))
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
    except Exception:
        iso = now.isoformat()
        await db.users.update_one({"id": user_id}, {"$set": {"health_regen_last_at": iso}})
        user["health_regen_last_at"] = iso
        return
    elapsed = (now - last).total_seconds()
    if elapsed < 0:
        elapsed = 0.0
    elapsed = min(elapsed, 86400.0 * 7)
    if elapsed < 1.0:
        return
    gain = elapsed * (100.0 / float(HEALTH_REGEN_FULL_SECONDS))
    new_h = round(min(100.0, h + gain), 2)
    iso = now.isoformat()
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"health": new_h, "health_regen_last_at": iso}},
    )
    user["health"] = new_h
    user["health_regen_last_at"] = iso


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    user_id: Optional[str] = None
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            _log_auth_failure(None, 401, "Invalid authentication credentials (no sub)")
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    except JWTError:
        _log_auth_failure(user_id, 401, "Invalid or expired token")
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if user is None:
        _log_auth_failure(user_id, 401, "User not found")
        raise HTTPException(status_code=401, detail="User not found")
    # Safety: money must never go negative - correct if it did (bug/race)
    if (user.get("money") or 0) < 0:
        await db.users.update_one({"id": user_id}, {"$set": {"money": 0}})
        user["money"] = 0
    # Reject if token was invalidated (e.g. admin "log out user")
    if payload.get("v", 0) != user.get("token_version", 0):
        _log_auth_failure(user_id, 401, "Session invalidated (token_version mismatch)")
        raise HTTPException(status_code=401, detail="Session invalidated. Please log in again.")
    # If token has session_id, validate it exists (revoked sessions are removed from user.sessions)
    session_id = payload.get("session_id")
    if session_id:
        sessions = user.get("sessions") or []
        valid_ids = [s.get("id") for s in sessions if s.get("id")]
        if session_id not in valid_ids:
            _log_auth_failure(user_id, 401, "Session revoked or invalid")
            raise HTTPException(status_code=401, detail="Session invalidated. Please log in again.")
        user["_session_id"] = session_id
        now = datetime.now(timezone.utc)
        for s in sessions:
            if s.get("id") == session_id:
                try:
                    lu = s.get("last_used_at")
                    if lu:
                        lu_dt = datetime.fromisoformat(lu.replace("Z", "+00:00")) if isinstance(lu, str) else lu
                        if lu_dt.tzinfo is None:
                            lu_dt = lu_dt.replace(tzinfo=timezone.utc)
                        inactive_seconds = (now - lu_dt).total_seconds()
                        # Inactivity timeout: end session if no requests for SESSION_INACTIVITY_MINUTES (0 = disabled)
                        if SESSION_INACTIVITY_MINUTES > 0 and inactive_seconds >= SESSION_INACTIVITY_MINUTES * 60:
                            await db.users.update_one({"id": user_id}, {"$pull": {"sessions": {"id": session_id}}})
                            _log_auth_failure(user_id, 401, "Session expired due to inactivity")
                            raise HTTPException(
                                status_code=401,
                                detail="Session expired due to inactivity. Please log in again.",
                            )
                        # Update last_used_at every 5 minutes to avoid write storm
                        if inactive_seconds >= 300:
                            await db.users.update_one(
                                {"id": user_id},
                                {"$set": {"sessions.$[s].last_used_at": now.isoformat()}},
                                array_filters=[{"s.id": session_id}],
                            )
                except HTTPException:
                    raise
                except Exception:
                    pass
                break
    if user.get("is_dead"):
        # Allow limited access for dead accounts so the frontend can render the death screen
        # and killer reveal flow. Gameplay endpoints remain blocked.
        path = request.url.path if request else ""
        if path not in DEAD_ACCOUNT_WHITELIST:
            _log_auth_failure(user_id, 403, "Account is dead")
            raise HTTPException(
                status_code=403,
                detail="This account is dead and cannot be used. Create a new account and use Dead > Alive to receive 95% (5% tax) of this account’s money and points."
            )
    if user.get("in_jail"):
        path = request.url.path if request else ""
        if _is_jail_blocked_path(path):
            raise HTTPException(status_code=403, detail="You can't do that while in jail.")
    # Auto-expire lock when account_locked_until is in the past
    locked_until = user.get("account_locked_until")
    if user.get("account_locked") and locked_until:
        try:
            until_dt = datetime.fromisoformat(locked_until.replace("Z", "+00:00"))
            if until_dt.tzinfo is None:
                until_dt = until_dt.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) >= until_dt:
                await db.users.update_one(
                    {"id": user_id},
                    {
                        "$set": {"account_locked": False},
                        "$unset": {"account_locked_at": "", "account_locked_comment": "", "account_locked_comment_at": "", "account_locked_until": "", "account_locked_admin_message": "", "account_locked_admin_message_at": "", "account_locked_user_reply": "", "account_locked_user_reply_at": ""},
                    },
                )
                user = await db.users.find_one({"id": user_id}, {"_id": 0})
        except Exception:
            pass
    # Locked (under investigation): only whitelisted paths allowed
    if user.get("account_locked") and request and request.url.path not in ACCOUNT_LOCKED_WHITELIST:
        _log_auth_failure(user_id, 403, "Account locked (path not whitelisted)")
        raise HTTPException(
            status_code=403,
            detail="Account is under investigation. You can only access the account status page.",
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
    await apply_passive_health_regen(user_id, user)

    # VIP Game Pass auto-grant: grant rewards and send inbox messages as rank_points crosses new micro tiers.
    try:
        is_vip_claimed = user.get("rank_xp_pass_rewards_granted") is True
        if is_vip_claimed:
            now = datetime.now(timezone.utc)
            expires_raw = user.get("rank_xp_pass_token_expires_at")
            vip_expires_dt = None
            if expires_raw:
                try:
                    vip_expires_dt = datetime.fromisoformat(str(expires_raw).replace("Z", "+00:00"))
                    if vip_expires_dt.tzinfo is None:
                        vip_expires_dt = vip_expires_dt.replace(tzinfo=timezone.utc)
                except Exception:
                    vip_expires_dt = None

            # If expiry is missing (older activations), keep granting based on cursor.
            vip_active = True if vip_expires_dt is None else bool(vip_expires_dt > now)
            if vip_active:
                current_micro = micro_tier_from_rank_points(user.get("rank_points"))
                last_granted = int(user.get("rank_xp_pass_last_granted_micro_tier") or 0)
                if current_micro > last_granted:
                    free_cash_last_micro = int(user.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
                    now_iso = now.isoformat()
                    expiry_filter = {"rank_xp_pass_token_expires_at": {"$gt": now_iso}} if vip_expires_dt is not None else {}
                    for t in range(last_granted + 1, current_micro + 1):
                        rewards = rewards_for_micro_tier(t)
                        if free_cash_last_micro >= t:
                            free_key = free_unlocked_key_for_micro_tier(t, rewards)
                            if free_key:
                                rewards[free_key] = 0
                        inc = {k: int(v) for k, v in rewards.items() if int(v or 0) > 0}

                        # Atomic cursor update: prevents duplicates across multiple requests.
                        updated = await db.users.update_one(
                            {
                                "id": user_id,
                                "rank_xp_pass_rewards_granted": True,
                                **expiry_filter,
                                "$or": [
                                    {"rank_xp_pass_last_granted_micro_tier": {"$lt": t}},
                                    {"rank_xp_pass_last_granted_micro_tier": {"$exists": False}},
                                ],
                            },
                            {
                                "$set": {"rank_xp_pass_last_granted_micro_tier": t},
                                **({"$inc": inc} if inc else {}),
                            },
                        )
                        if updated.modified_count == 0:
                            continue

                        next_t = t + 1 if t < MAX_MICRO_TIER else None
                        if next_t is None:
                            next_summary = "Max tier reached"
                        else:
                            next_rewards = rewards_for_micro_tier(next_t)
                            next_summary = f"Tier {next_t} rewards: {format_rewards_summary(next_rewards)}"

                        for reward_key in REWARD_KEY_ORDER:
                            amount = int(rewards.get(reward_key) or 0)
                            if amount <= 0:
                                continue
                            if reward_key == "money":
                                received_text = f"${amount:,} cash"
                            elif reward_key in ("bullets", "points", "respect_points"):
                                received_text = f"{amount:,} {REWARD_KEY_LABELS.get(reward_key, reward_key)}"
                            else:
                                received_text = f"{amount:,}x {REWARD_KEY_LABELS.get(reward_key, reward_key)}"

                            await send_notification(
                                user_id,
                                "Game Pass reward",
                                f"You received {received_text}. Next reward: {next_summary}.",
                                "reward",
                                category="system",
                                reward_key=reward_key,
                                tier_micro=t,
                                next_tier=next_t,
                            )
    except Exception:
        # Never block user requests due to reward automation.
        pass

    # Free Game Pass auto-grant: unlock exactly 1 reward bucket per completed micro tier.
    # Only runs for effectively Free users:
    #   - no VIP claim granted yet
    #   - no unactivated but ready Game Pass token
    try:
        is_vip_claimed = user.get("rank_xp_pass_rewards_granted") is True
        if not is_vip_claimed:
            now = datetime.now(timezone.utc)
            token_count = int(user.get("rank_xp_pass_tokens") or 0)

            expires_dt = None
            if token_count > 0:
                expires_raw = user.get("rank_xp_pass_token_expires_at")
                if expires_raw:
                    try:
                        expires_dt = datetime.fromisoformat(str(expires_raw).replace("Z", "+00:00"))
                        if expires_dt.tzinfo is None:
                            expires_dt = expires_dt.replace(tzinfo=timezone.utc)
                    except Exception:
                        expires_dt = None

            token_ready = bool(token_count > 0 and expires_dt and expires_dt > now)

            if not token_ready:
                current_micro = micro_tier_from_rank_points(user.get("rank_points"))
                if current_micro > 0:
                    last_micro = int(user.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
                    if current_micro > last_micro:
                        for t in range(last_micro + 1, current_micro + 1):
                            rewards = rewards_for_micro_tier(t)
                            free_key = free_unlocked_key_for_micro_tier(t, rewards)
                            if not free_key:
                                continue
                            reward_amount = int(rewards.get(free_key) or 0)
                            if reward_amount <= 0:
                                continue
                            res = await db.users.update_one(
                                {
                                    "id": user_id,
                                    "$or": [
                                        {"rank_xp_pass_free_last_micro_tier_granted": {"$lt": t}},
                                        {"rank_xp_pass_free_last_micro_tier_granted": {"$exists": False}},
                                    ],
                                },
                                {"$inc": {free_key: reward_amount}, "$set": {"rank_xp_pass_free_last_micro_tier_granted": t}},
                            )
                            if res.modified_count <= 0:
                                continue
                            user[free_key] = int(user.get(free_key) or 0) + reward_amount

                            next_tier = t + 1 if t < MAX_MICRO_TIER else None
                            next_summary = (
                                f"Tier {next_tier} rewards: {format_rewards_summary(rewards_for_micro_tier(next_tier))}"
                                if next_tier
                                else "Max tier reached"
                            )

                            if free_key == "money":
                                received_text = f"${reward_amount:,} cash"
                            elif free_key in ("bullets", "points", "respect_points"):
                                received_text = f"{reward_amount:,} {REWARD_KEY_LABELS.get(free_key, free_key)}"
                            else:
                                received_text = f"{reward_amount:,}x {REWARD_KEY_LABELS.get(free_key, free_key)}"

                            await send_notification(
                                user_id,
                                "Game Pass reward",
                                f"You received {received_text}. Next reward: {next_summary}.",
                                "reward",
                                category="system",
                                reward_key=free_key,
                                tier_micro=t,
                                next_tier=next_tier,
                            )
    except Exception:
        # Never block user requests due to reward automation.
        pass

    return user


async def get_current_user_verified(current_user: dict = Depends(get_current_user)):
    """Same as get_current_user but requires email_verified. Use for crimes, GTA, OC, attack, etc."""
    if current_user.get("email_verified") is False:
        # Staff accounts should not be blocked by email verification
        # (admins can handle user issues manually from in-game tools).
        if _is_admin(current_user) or _is_moderator(current_user):
            return current_user
        raise HTTPException(
            status_code=403,
            detail="Verify your email to use this feature.",
        )
    return current_user


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


async def log_respect_earned(user_id: str, amount: int, source: str = ""):
    """Log respect points earned for weekly leaderboard aggregation. Call after awarding respect_points (positive amount only)."""
    if not amount or amount <= 0:
        return
    now = datetime.now(timezone.utc).isoformat()
    await db.respect_events.insert_one({"user_id": user_id, "amount": amount, "at": now, "source": source or "misc"})


async def log_melt_event(user_id: str, bullets: int):
    """Log bullets melted for weekly leaderboard aggregation. Call after a melt-for-bullets action."""
    if not bullets or bullets <= 0:
        return
    now = datetime.now(timezone.utc).isoformat()
    await db.melt_events.insert_one({"user_id": user_id, "bullets": bullets, "at": now})


async def send_notification_to_family(family_id: str, title: str, message: str, notification_type: str, category: Optional[str] = None, **extra):
    """Notify every member of a family. Pass actor_username= to make that username linkable in the inbox."""
    members = await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(100)
    for m in members:
        await send_notification(m["user_id"], title, message, notification_type, category=category, **extra)


async def send_notification_to_all(title: str, message: str, notification_type: str = "system", category: Optional[str] = None):
    """Notify all users (e.g. new E-Games available). Respects each user's notification_preferences when category is set."""
    user_ids = await db.users.distinct("id")
    for uid in user_ids:
        await send_notification(uid, title, message, notification_type, category=category)


async def _family_war_start(family_a_id: str, family_b_id: str):
    """Start or ensure an active war between two families. Idempotent."""
    if not family_a_id or not family_b_id or family_a_id == family_b_id:
        return
    fa = await db.families.find_one({"id": family_a_id}, {"_id": 0, "name": 1, "tag": 1})
    fb = await db.families.find_one({"id": family_b_id}, {"_id": 0, "name": 1, "tag": 1})
    family_a_name = (fa or {}).get("name") or (fa or {}).get("tag") or family_a_id
    family_b_name = (fb or {}).get("name") or (fb or {}).get("tag") or family_b_id
    now = datetime.now(timezone.utc).isoformat()
    result = await db.family_wars.update_one(
        {
            "$or": [
                {"family_a_id": family_a_id, "family_b_id": family_b_id},
                {"family_a_id": family_b_id, "family_b_id": family_a_id},
            ],
            "status": {"$in": ["active", "truce_offered"]},
        },
        {
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "family_a_id": family_a_id,
                "family_b_id": family_b_id,
                "family_a_name": family_a_name,
                "family_b_name": family_b_name,
                "status": "active",
                "created_at": now,
                "ended_at": None,
            }
        },
        upsert=True,
    )
    if not result.upserted_id:
        return
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


async def _family_war_check_wipe_and_award(victim_family_id: str, killer_family_id: str = None, killer_id: str = None):
    """If victim's family has no living members, end the war and award the winner. Winner is the family that landed the killing blow (killer_family_id), or the war opponent if killer had no family. When killer has no family, assets go to killer (user) and war logs show solo killer."""
    if not victim_family_id:
        return
    active_wars = await db.family_wars.find(
        {"$or": [{"family_a_id": victim_family_id}, {"family_b_id": victim_family_id}]},
        {"_id": 0},
    ).to_list(20)
    active_wars = [w for w in active_wars if w.get("status") in ["active", "truce_offered"]]
    if not active_wars:
        return
    war = active_wars[0]
    members = await db.family_members.find({"family_id": victim_family_id}, {"_id": 0, "user_id": 1}).to_list(100)
    alive = 0
    for m in members:
        u = await db.users.find_one({"id": m["user_id"]}, {"_id": 0, "id": 1, "is_dead": 1})
        if u and u.get("id") and not u.get("is_dead"):
            alive += 1
    if alive > 0:
        return
    # Credit the family that got the killing blow, or war opponent if killer had no family
    killer_is_side = killer_family_id and any(
        w["family_a_id"] == killer_family_id or w["family_b_id"] == killer_family_id for w in active_wars
    )
    solo_killer = not killer_family_id and killer_id  # Killer finished the wipe but wasn't in a family
    if killer_is_side:
        winner_id = killer_family_id
        war = next((w for w in active_wars if w["family_a_id"] == killer_family_id or w["family_b_id"] == killer_family_id), war)
    else:
        winner_id = war["family_b_id"] if war["family_a_id"] == victim_family_id else war["family_a_id"]
    loser_id = victim_family_id
    now_dt = datetime.now(timezone.utc)
    now = now_dt.isoformat()
    loser_family = await db.families.find_one({"id": loser_id}, {"_id": 0, "name": 1, "tag": 1, "rackets": 1, "treasury": 1, "compound_cash": 1, "compound_points": 1, "compound_loot_pieces": 1})
    winner_family = await db.families.find_one({"id": winner_id}, {"_id": 0, "name": 1, "tag": 1, "boss_id": 1, "racket_income_bonus_percent": 1, "rackets": 1})
    winner_family_name = (winner_family or {}).get("name") or (winner_family or {}).get("tag") or winner_id or "?"
    loser_family_name = (loser_family or {}).get("name") or (loser_family or {}).get("tag") or loser_id
    killer_user = await db.users.find_one({"id": killer_id}, {"_id": 0, "username": 1}) if solo_killer and killer_id else None
    killer_username = (killer_user or {}).get("username") or "?" if solo_killer else None
    if not winner_family:
        for w in active_wars:
            await db.family_wars.update_one(
                {"id": w["id"]},
                {"$set": {"status": "family_a_wins" if winner_id == w["family_a_id"] else "family_b_wins", "ended_at": now, "winner_family_id": winner_id, "loser_family_id": loser_id, "winner_family_name": winner_family_name, "loser_family_name": loser_family_name}},
            )
        return
    winner_boss_id = killer_id if solo_killer else winner_family.get("boss_id")
    loser_rackets = (loser_family or {}).get("rackets") or {}
    winner_rackets = (winner_family.get("rackets") or {}).copy()
    loser_treasury = int((loser_family or {}).get("treasury", 0) or 0)
    loser_compound_cash = int((loser_family or {}).get("compound_cash", 0) or 0)
    loser_compound_points = int((loser_family or {}).get("compound_points", 0) or 0)
    loser_compound_loot_pieces = int((loser_family or {}).get("compound_loot_pieces", 0) or 0)
    ev = await get_effective_event()

    # Calculate racket cash prize: uncollected income + upgrade costs
    prize_racket_income = compute_loser_racket_cash(loser_rackets, ev, now=now_dt, war_doc=war)
    prize_racket_upgrade_cost = 0
    for racket_id, state in loser_rackets.items():
        level = int(state.get("level", 0) or 0)
        if level > 0:
            # Upgrade cost = unlock cost + (level-1) * upgrade cost per level
            prize_racket_upgrade_cost += RACKET_UNLOCK_COST + max(0, level - 1) * RACKET_UPGRADE_COST
    prize_racket_cash = prize_racket_income + prize_racket_upgrade_cost

    # Racket transfer/bonus logic
    # If loser has higher level racket -> winner takes it
    # If not higher -> winner gets +0.5% passive income bonus (capped at 25%)
    RACKET_NO_UPGRADE_BONUS_PCT = 0.5
    rackets_taken = []
    rackets_bonus_count = 0
    for racket_id, state in loser_rackets.items():
        loser_level = int(state.get("level", 0) or 0)
        if loser_level <= 0:
            continue
        winner_level = int((winner_rackets.get(racket_id) or {}).get("level", 0) or 0)
        if loser_level > winner_level:
            # Winner takes the higher level racket
            winner_rackets[racket_id] = {"level": loser_level, "last_collected_at": now}
            racket_def = next((r for r in FAMILY_RACKETS if r["id"] == racket_id), None)
            racket_name = racket_def["name"] if racket_def else racket_id
            rackets_taken.append(f"{racket_name} (Lv{loser_level})")
        else:
            # Winner already has equal or higher, get bonus instead
            rackets_bonus_count += 1

    # Update winner's rackets if any were taken
    if rackets_taken:
        await db.families.update_one({"id": winner_id}, {"$set": {"rackets": winner_rackets}})

    # Calculate total income bonus: base 2.5% + 0.5% per non-upgraded racket
    current_bonus = float((winner_family.get("racket_income_bonus_percent") or 0) or 0)
    bonus_from_war = WAR_WIN_RACKET_INCOME_BONUS_PERCENT
    bonus_from_rackets = rackets_bonus_count * RACKET_NO_UPGRADE_BONUS_PCT
    total_bonus_add = bonus_from_war + bonus_from_rackets
    new_bonus = min(current_bonus + total_bonus_add, RACKET_INCOME_BONUS_CAP_PERCENT)
    bonus_actually_added = new_bonus - current_bonus

    await db.families.update_one(
        {"id": winner_id},
        {"$set": {"racket_income_bonus_percent": new_bonus}}
    )

    # Reset loser's rackets and assets (wiped set later after transfer)

    # Cash prize: treasury + racket cash (income + upgrade costs) + compound
    total_cash_prize = loser_treasury + prize_racket_cash + loser_compound_cash
    if solo_killer and killer_id:
        # Solo killer gets vault: cash to user, compound as points/loot
        if total_cash_prize > 0:
            await db.users.update_one({"id": killer_id}, {"$inc": {"money": total_cash_prize}})
        if loser_compound_points > 0 or loser_compound_loot_pieces > 0:
            inc = {}
            if loser_compound_points > 0:
                inc["points"] = loser_compound_points
            if loser_compound_loot_pieces > 0:
                inc["loot_box_pieces"] = loser_compound_loot_pieces
            if inc:
                await db.users.update_one({"id": killer_id}, {"$inc": inc})
    else:
        if total_cash_prize > 0:
            await db.families.update_one({"id": winner_id}, {"$inc": {"treasury": total_cash_prize}})
        if loser_compound_points > 0 or loser_compound_loot_pieces > 0:
            await db.families.update_one(
                {"id": winner_id},
                {"$inc": {"compound_points": loser_compound_points, "compound_loot_pieces": loser_compound_loot_pieces}},
            )

    # Transfer exclusive cars
    loser_member_ids = [m["user_id"] for m in members]
    exclusive_cars = await db.user_cars.find({"user_id": {"$in": loser_member_ids}}).to_list(500)
    for uc in exclusive_cars:
        car_info = next((c for c in CARS if c.get("id") == uc.get("car_id")), None)
        if car_info and car_info.get("rarity") == "exclusive":
            await db.user_cars.update_one(
                {"_id": uc["_id"]},
                {
                    "$set": {"user_id": winner_boss_id, "id": str(uuid.uuid4())},
                    "$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""},
                },
            )
    prize_car_count = sum(1 for uc in exclusive_cars if next((c for c in CARS if c.get("id") == uc.get("car_id")), {}).get("rarity") == "exclusive")

    # Transfer crew bank from loser members to winner's boss
    crew_profiles = await db.racing_profiles.find({"user_id": {"$in": loser_member_ids}}, {"_id": 0, "crew_bank": 1}).to_list(100)
    total_crew_bank = sum(int((p.get("crew_bank") or 0)) for p in crew_profiles)
    if total_crew_bank > 0 and winner_boss_id:
        await db.racing_profiles.update_one(
            {"user_id": winner_boss_id},
            {"$inc": {"crew_bank": total_crew_bank}},
            upsert=True,
        )

    # Record war result: end ALL wars the victim was in with the same winner (killer's family) so stats show one "wiped by"
    for w in active_wars:
        war_status = "family_a_wins" if winner_id == w["family_a_id"] else "family_b_wins"
        w_set = {
            "status": war_status,
            "ended_at": now,
            "winner_family_id": winner_id,
            "loser_family_id": loser_id,
            "winner_family_name": winner_family_name,
            "loser_family_name": loser_family_name,
            "prize_exclusive_cars": prize_car_count if w["id"] == war["id"] else None,
            "prize_rackets_taken": rackets_taken if w["id"] == war["id"] else None,
            "prize_racket_bonus_count": rackets_bonus_count if w["id"] == war["id"] else None,
            "prize_treasury": loser_treasury if w["id"] == war["id"] else None,
            "prize_racket_cash": prize_racket_cash if w["id"] == war["id"] else None,
            "prize_compound_cash": loser_compound_cash if w["id"] == war["id"] else None,
            "prize_compound_points": loser_compound_points if w["id"] == war["id"] else None,
            "prize_compound_loot_pieces": loser_compound_loot_pieces if w["id"] == war["id"] else None,
        }
        if solo_killer and killer_id:
            w_set["wiped_by_killer_id"] = killer_id
            w_set["wiped_by_killer_username"] = killer_username or "?"
        await db.family_wars.update_one({"id": w["id"]}, {"$set": w_set})

    # Mark victim family as wiped
    family_wiped_set = {
        "wiped": True,
        "wiped_at": now,
        "boss_id": None,
        "rackets": {},
        "treasury": 0,
        "treasury_points": 0,
        "treasury_loot_pieces": 0,
        "compound_cash": 0,
        "compound_points": 0,
        "compound_loot_pieces": 0,
        "compound_deposits_by_user": {},
    }
    if solo_killer and killer_id:
        family_wiped_set["wiped_by_killer_id"] = killer_id
        family_wiped_set["wiped_by_killer_username"] = killer_username or "?"
        family_wiped_set["wiped_by_family_id"] = None
        family_wiped_set["wiped_by_family_name"] = None
    else:
        family_wiped_set["wiped_by_family_id"] = winner_id
        family_wiped_set["wiped_by_family_name"] = winner_family_name
    await db.families.update_one({"id": loser_id}, {"$set": family_wiped_set})

    # Build notification message
    if solo_killer and killer_id:
        msg = f"You wiped the family {loser_family_name}!"
        msg += f" You received ${total_cash_prize:,} (treasury + racket value + compound)."
        if prize_car_count:
            msg += f" {prize_car_count} exclusive car(s) seized."
        if loser_compound_points > 0 or loser_compound_loot_pieces > 0:
            msg += f" Compound loot: {loser_compound_points:,} points, {loser_compound_loot_pieces:,} loot pieces."
        if total_crew_bank > 0:
            msg += f" Crew bank seized: ${total_crew_bank:,}."
        await send_notification(killer_id, "🏆 Family Wiped", msg, "reward")
    else:
        msg = f"Your family won the war against {loser_family_name}!"
        msg += f" You received ${total_cash_prize:,} (treasury ${loser_treasury:,} + racket value ${prize_racket_cash:,} + compound ${loser_compound_cash:,})."
        if rackets_taken:
            msg += f" Rackets taken: {', '.join(rackets_taken)}."
        if bonus_actually_added > 0:
            msg += f" Permanent racket income bonus: +{bonus_actually_added:.1f}% (now {new_bonus:.1f}%)."
        if prize_car_count:
            msg += f" {prize_car_count} exclusive car(s) seized."
        if loser_compound_points > 0 or loser_compound_loot_pieces > 0:
            msg += f" Compound loot: {loser_compound_points:,} points, {loser_compound_loot_pieces:,} loot pieces."
        if total_crew_bank > 0:
            msg += f" Crew bank seized: ${total_crew_bank:,}."
        await send_notification_to_family(winner_id, "🏆 War Won", msg, "reward")


async def _family_war_duration_seconds(family_id: str, from_dt: datetime, to_dt: datetime) -> float:
    """Total seconds this family was in an active/truce_offered war between from_dt and to_dt."""
    if not family_id or from_dt >= to_dt:
        return 0.0
    wars = await db.family_wars.find(
        {"$or": [{"family_a_id": family_id}, {"family_b_id": family_id}],
         "status": {"$in": ["active", "truce_offered"]}},
        {"_id": 0, "created_at": 1, "ended_at": 1},
    ).to_list(20)
    total = 0.0
    for w in wars:
        try:
            start = datetime.fromisoformat(str(w.get("created_at") or "").replace("Z", "+00:00"))
        except Exception:
            continue
        end_raw = w.get("ended_at")
        if end_raw:
            try:
                end = datetime.fromisoformat(str(end_raw).replace("Z", "+00:00"))
            except Exception:
                end = to_dt
        else:
            end = to_dt
        overlap_start = max(from_dt, start)
        overlap_end = min(to_dt, end)
        if overlap_start < overlap_end:
            total += (overlap_end - overlap_start).total_seconds()
    return total


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


async def maybe_auto_relinquish_below_capo(coll, filter_dict: dict):
    """If the ownership doc has owner_id and below_capo_acquired_at and 3+ hours have passed, clear ownership."""
    doc = await coll.find_one(filter_dict, {"_id": 0, "owner_id": 1, "below_capo_acquired_at": 1})
    if not doc or not doc.get("owner_id") or not doc.get("below_capo_acquired_at"):
        return
    acquired = doc["below_capo_acquired_at"]
    if isinstance(acquired, str):
        acquired = datetime.fromisoformat(acquired.replace("Z", "+00:00"))
    # Stored values may be naive (e.g. from MongoDB or different server TZ). Treat as UTC so 3h check is consistent globally.
    if acquired.tzinfo is None:
        acquired = acquired.replace(tzinfo=timezone.utc)
    if (datetime.now(timezone.utc) - acquired).total_seconds() >= 3 * 3600:
        await coll.update_one(
            filter_dict,
            {"$set": {"owner_id": None, "owner_username": None}, "$unset": {"below_capo_acquired_at": 1}},
        )


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
# Respect when you *reach* each rank id (2 = first promotion from Rat). Scales up so high ranks feel meaningful.
# If you skip multiple ranks in one update, you get the sum for each tier crossed.
RANK_UP_RESPECT_BY_REACHED_RANK = {
    2: 80,
    3: 150,
    4: 260,
    5: 400,
    6: 580,
    7: 800,
    8: 1050,
    9: 1350,
    10: 1700,
    11: 2100,
    12: 2550,
    13: 3000,
}

async def check_and_process_rank_up(user_id: str, old_rank: int, new_rank: int, username: str = ""):
    """Process rank up: give bullets and respect, send inbox notification."""
    if new_rank > old_rank:
        # Idempotency guard:
        # In some race scenarios, the same rank transition can be processed multiple times.
        # We only grant rewards/notifications once per destination rank.
        atomic = await db.users.update_one(
            {"id": user_id, "rank_up_rewarded_to_rank": {"$ne": int(new_rank)}},
            {"$set": {"rank_up_rewarded_to_rank": int(new_rank)}},
        )
        if atomic.modified_count == 0:
            return 0

        num_ranks = new_rank - old_rank
        total_bullets = RANK_UP_BULLET_REWARD * num_ranks
        total_respect = sum(
            int(RANK_UP_RESPECT_BY_REACHED_RANK.get(r, 0))
            for r in range(old_rank + 1, new_rank + 1)
        )

        inc = {"bullets": total_bullets}
        if total_respect > 0:
            inc["respect_points"] = total_respect
        if inc:
            await db.users.update_one(
                {"id": user_id},
                {"$inc": inc}
            )
            if total_respect > 0:
                await log_respect_earned(user_id, total_respect, "rank_up")

        # Get new rank name
        new_rank_name = RANKS[new_rank - 1]["name"] if new_rank <= len(RANKS) else "Unknown"

        # Build reward message
        reward_parts = [f"{total_bullets} bullets"]
        if total_respect > 0:
            reward_parts.append(f"{total_respect} respect")
        reward_text = " and ".join(reward_parts)

        # Send notification
        await send_notification(
            user_id,
            f"🎉 Ranked Up to {new_rank_name}!",
            f"Congratulations! You've reached {new_rank_name} (Rank {new_rank}). You've been rewarded with {reward_text}!",
            "rank_up",
            category="system",
        )

        return total_bullets
    return 0


async def maybe_process_rank_up(user_id: str, rank_points_before: int, rank_points_added: int, username: str = "", prestige_mult: float = 1.0):
    """If rank increased after adding rank_points_added to rank_points_before, grant rewards and send notification."""
    if rank_points_added <= 0:
        return
    # Use caller-provided prestige_mult when given; otherwise load from user so prestiged users get correct rank (and notification text)
    if prestige_mult == 1.0:
        user = await db.users.find_one({"id": user_id}, {"prestige_rank_multiplier": 1})
        if user and (user.get("prestige_rank_multiplier") or 0) > 0:
            prestige_mult = float(user["prestige_rank_multiplier"])
    new_total = rank_points_before + rank_points_added
    old_rank_id, _ = get_rank_info(rank_points_before, prestige_mult)
    new_rank_id, _ = get_rank_info(new_total, prestige_mult)
    if new_rank_id > old_rank_id:
        await check_and_process_rank_up(user_id, old_rank_id, new_rank_id, username)


# Auth and profile endpoints -> routers/auth.py, routers/profile.py
# Dead-alive, users/online -> routers/dead_alive.py, routers/users.py

# Stats endpoints -> routers/stats.py

# Admin access: set ADMIN_EMAILS env (comma-separated) in production to avoid hardcoded list in repo
_raw = (os.environ.get("ADMIN_EMAILS") or "").strip()
ADMIN_EMAILS = [e.strip().lower() for e in _raw.split(",") if e.strip()] if _raw else []


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


async def log_minigame_payout(user_id: str, username: str, game: str, score, rewards: dict):
    """Log every individual minigame play payout for admin auditing."""
    try:
        await db.minigame_play_payouts.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "username": username,
            "game": game,
            "score": score,
            "rewards": rewards,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass


async def log_gambling(user_id: str, username: str, game_type: str, details: dict):
    """Append to gambling_log for admin anti-cheat monitoring. Used by all casinos: blackjack, slots, roulette, dice, videopoker, horseracing, sports_bet, mdg."""
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


def _is_moderator(user: dict) -> bool:
    """True if user has been promoted to moderator (by an admin). Moderators have limited tools: logs, account info, lock user; no wealth/rank changes."""
    return bool(user.get("is_moderator"))


def _is_hdo(user: dict) -> bool:
    """True if user is a Help Desk Operator. HDOs can reply to and close help desk tickets; they appear dark green on Users Online."""
    return bool(user.get("is_help_desk_operator"))


def _staff_exclude_user_filter() -> dict:
    """Mongo match dict to exclude admin/mod accounts from queries on the users collection."""
    q = {"is_moderator": {"$ne": True}}
    if ADMIN_EMAILS:
        q["email"] = {"$nin": list(ADMIN_EMAILS)}
    return q


async def _get_staff_user_ids() -> list:
    """Return user IDs of all admin and moderator accounts (for excluding from non-users collections)."""
    admin_emails = list(ADMIN_EMAILS or [])
    conditions = [{"is_moderator": True}]
    if admin_emails:
        conditions.append({"email": {"$in": admin_emails}})
    cursor = db.users.find({"$or": conditions}, {"_id": 0, "id": 1})
    return [u["id"] for u in await cursor.to_list(500)]


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
def _slots_expired(doc) -> bool:
    """True if slots doc has expires_at in the past."""
    if not doc or not doc.get("expires_at"):
        return True
    try:
        t = datetime.fromisoformat(doc["expires_at"].replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) >= t
    except Exception:
        return True


def _ownership_display_profit(doc: dict) -> int:
    """Cash profit shown to owner/sidebar. `profit` may be 0 after reset — must not fall back to lifetime total_earnings."""
    if not doc:
        return 0
    p = doc.get("profit")
    if p is not None:
        return int(p)
    return int(doc.get("total_earnings") or 0)


async def _get_casino_property_profit(user_id: str):
    """Return (casino_profit_cash, property_profit_points, has_casino, has_property, casino_lifetime_earnings).

    casino_profit_cash uses resettable `profit` (sidebar / holdings). casino_lifetime_earnings is `total_earnings`
    on the same doc (My Stats lifetime row; not cleared by reset profit).
    """
    casino_colls = [
        ("dice", db.dice_ownership),
        ("roulette", db.roulette_ownership),
        ("blackjack", db.blackjack_ownership),
        ("horseracing", db.horseracing_ownership),
        ("videopoker", db.videopoker_ownership),
        ("slots", db.slots_ownership),
    ]
    # Parallel: all 6 casino ownerships + airport + armoury (bullet_factory)
    async def fetch_casino(game_type, coll):
        return await coll.find_one({"owner_id": user_id}, {"_id": 0, "total_earnings": 1, "profit": 1, "expires_at": 1})

    casino_tasks = [fetch_casino(gt, c) for gt, c in casino_colls]
    airport_task = db.airport_ownership.find_one({"owner_id": user_id}, {"_id": 0, "state": 1, "slot": 1, "price_per_travel": 1, "total_earnings": 1})
    bullet_task = db.bullet_factory.find_one({"owner_id": user_id}, {"_id": 0, "state": 1, "price_per_bullet": 1})
    results = await asyncio.gather(*casino_tasks, airport_task, bullet_task)
    casino_docs = results[:6]
    airport_doc, bullet_doc = results[6], results[7]

    casino_cash = 0
    casino_lifetime = 0
    has_casino = False
    for (game_type, _), doc in zip(casino_colls, casino_docs):
        if not doc:
            continue
        if game_type == "slots" and _slots_expired(doc):
            continue
        casino_cash = _ownership_display_profit(doc)
        casino_lifetime = int(doc.get("total_earnings") or 0)
        has_casino = True
        break

    if airport_doc:
        prop = {"type": "airport", "state": airport_doc.get("state"), "slot": airport_doc.get("slot", 1), "price_per_travel": airport_doc.get("price_per_travel"), "total_earnings": airport_doc.get("total_earnings", 0)}
    elif bullet_doc:
        prop = {"type": "bullet_factory", "state": bullet_doc.get("state"), "price_per_bullet": bullet_doc.get("price_per_bullet"), "total_earnings": 0}
    else:
        prop = None
    property_pts = int(prop.get("total_earnings") or 0) if prop else 0
    has_property = prop is not None
    return (casino_cash, property_pts, has_casino, has_property, casino_lifetime)


async def bump_user_biggest_casino_payout(owner_id: str, payout_amount: int) -> None:
    """Set users.biggest_casino_payout to max(existing, payout_amount). Works when the field was never set (unlike $lt filter updates)."""
    if not owner_id:
        return
    amt = int(payout_amount or 0)
    if amt <= 0:
        return
    await db.users.update_one(
        {"id": owner_id},
        [
            {
                "$set": {
                    "biggest_casino_payout": {
                        "$max": [{"$ifNull": ["$biggest_casino_payout", 0]}, amt],
                    }
                }
            }
        ],
    )


async def get_casino_caps():
    """Returns (global_max_bet, buyback_max_points) from game settings."""
    doc = await db.game_settings.find_one({"_id": "main"})
    return (
        int((doc or {}).get("casino_global_max_bet") or 1_000_000_000),
        int((doc or {}).get("casino_buyback_max_points") or 15_000),
    )


async def _user_owns_any_casino(user_id: str):
    """Return first casino owned by user: {type, city, max_bet, buy_back_reward?, profit?} or None. Rule: 1 casino only. profit is $ (total_earnings or profit field)."""
    for game_type, coll in [
        ("dice", db.dice_ownership),
        ("roulette", db.roulette_ownership),
        ("blackjack", db.blackjack_ownership),
        ("horseracing", db.horseracing_ownership),
        ("videopoker", db.videopoker_ownership),
        ("slots", db.slots_ownership),
    ]:
        doc = await coll.find_one({"owner_id": user_id}, {"_id": 0, "city": 1, "state": 1, "max_bet": 1, "buy_back_reward": 1, "total_earnings": 1, "profit": 1, "expires_at": 1})
        if doc:
            if game_type == "slots" and doc.get("expires_at"):
                try:
                    t = datetime.fromisoformat(doc["expires_at"].replace("Z", "+00:00"))
                    if t.tzinfo is None:
                        t = t.replace(tzinfo=timezone.utc)
                    if datetime.now(timezone.utc) >= t:
                        continue
                except Exception:
                    continue
            out = {"type": game_type, "city": doc.get("city") or doc.get("state"), "max_bet": doc.get("max_bet")}
            if doc.get("buy_back_reward") is not None:
                out["buy_back_reward"] = doc.get("buy_back_reward")
            profit_val = doc.get("profit") if doc.get("profit") is not None else doc.get("total_earnings")
            out["profit"] = int(profit_val or 0)
            return out
    return None


from routers.casinos.dice import DICE_MAX_BET, DiceSellOnTradeRequest  # used by CASINO_GAMES and roulette/blackjack/horseracing sell-on-trade
from routers.casinos.roulette import ROULETTE_MAX_BET, RouletteClaimRequest, RouletteSetMaxBetRequest, RouletteSendToUserRequest  # CASINO_GAMES, blackjack/horseracing reuse these models
from routers.casinos.blackjack import BLACKJACK_MAX_BET  # CASINO_GAMES
from routers.casinos.horseracing import HORSERACING_MAX_BET  # CASINO_GAMES
from routers.casinos.slots import SLOTS_MAX_BET  # CASINO_GAMES
from routers.casinos.video_poker import VIDEO_POKER_MAX_BET  # CASINO_GAMES


async def _user_owns_any_property(user_id: str):
    """Return first property owned by user: {type, state, ...} or None. Rule: 1 property only (airport or armoury). Armoury = bullet factory + armour + weapons (single ownership in db.bullet_factory)."""
    doc = await db.airport_ownership.find_one({"owner_id": user_id}, {"_id": 0, "state": 1, "slot": 1, "price_per_travel": 1, "total_earnings": 1})
    if doc:
        return {"type": "airport", "state": doc.get("state"), "slot": doc.get("slot", 1), "price_per_travel": doc.get("price_per_travel"), "total_earnings": doc.get("total_earnings", 0)}
    doc = await db.bullet_factory.find_one({"owner_id": user_id}, {"_id": 0, "state": 1, "price_per_bullet": 1})
    if doc:
        state = doc.get("state")
        if state:
            await maybe_auto_relinquish_below_capo(db.bullet_factory, {"state": state})
        doc = await db.bullet_factory.find_one({"owner_id": user_id}, {"_id": 0, "state": 1, "price_per_bullet": 1})
        if doc:
            return {"type": "bullet_factory", "state": doc.get("state"), "price_per_bullet": doc.get("price_per_bullet")}
    # TODO: when armory ownership exists, check db.armory_ownership (or similar) and return {"type": "armory", "state": ...}
    return None


# Crime endpoints -> see routers/crime/crimes.py
# Register modular routers (organized by subfolder)
from routers.account import auth, profile, prestige, user_progress, users
from routers.admin import admin, security_admin, airport
from routers.cars import gta
from routers.casinos import dice, roulette, blackjack, mp_blackjack, mp_poker, mp_8ball, horseracing, slots, video_poker, mdg, sports_betting
from routers.crime import crimes, jail, organised_crime, oc
from routers.game import families, leaderboard, states, stats, store, dead_alive, events, notifications, meta, entertainer, achievements
from routers.kill import attack, armoury, bodyguards, hitlist
from routers.minigames import gauntlet, boxing, racing, snake
from routers.money import bank, stock_market, properties, quicktrade, crack_safe, illegal_business, booze_run, racket, payments
from routers.social import forum, game_chat, giphy, image_host, designer_auctions
from routers.account import objectives
from routers.account.objectives import update_objectives_progress  # re-export for server.py callers (e.g. booze sell)
from routers.game.families import FAMILY_RACKETS, compute_loser_racket_cash, WAR_WIN_RACKET_INCOME_BONUS_PERCENT, RACKET_INCOME_BONUS_CAP_PERCENT, RACKET_UNLOCK_COST, RACKET_UPGRADE_COST  # used by _family_war_check_wipe_and_award and seed
from routers.kill.bodyguards import _create_robot_bodyguard_user  # used by seed
from routers.money.booze_run import get_booze_rotation_interval_seconds, get_booze_rotation_index  # flash news
CASINO_GAMES = [
    {"id": "blackjack", "name": "Blackjack", "max_bet": BLACKJACK_MAX_BET},
    {"id": "horseracing", "name": "Horse Racing", "max_bet": HORSERACING_MAX_BET},
    {"id": "roulette", "name": "Roulette", "max_bet": ROULETTE_MAX_BET},
    {"id": "dice", "name": "Dice", "max_bet": DICE_MAX_BET},
    {"id": "videopoker", "name": "Video Poker", "max_bet": VIDEO_POKER_MAX_BET},
    {"id": "slots", "name": "Slots", "max_bet": SLOTS_MAX_BET},
]
crimes.register(api_router)
gta.register(api_router)
jail.register(api_router)
organised_crime.register(api_router)
oc.register(api_router)
forum.register(api_router)
designer_auctions.register(api_router)
from routers.social import game_ideas as game_ideas_router
game_ideas_router.register(api_router)
entertainer.register(api_router)
from routers.game import designer_competitions
designer_competitions.register(api_router)
armoury.register(api_router)
objectives.register(api_router)
from routers.account import missions
missions.register(api_router)
from routers.money import loot_box
loot_box.register(api_router)
attack.register(api_router)
bank.register(api_router)
families.register(api_router)
bodyguards.register(api_router)
airport.register(api_router)
quicktrade.register(api_router)
booze_run.register(api_router)
dice.register(api_router)
roulette.register(api_router)
blackjack.register(api_router)
mp_blackjack.register(api_router)
mp_poker.register(api_router)
mp_8ball.register(api_router)
horseracing.register(api_router)
slots.register(api_router)
video_poker.register(api_router)
mdg.register(api_router)
stock_market.register(api_router)
notifications.register(api_router)
game_chat.register(api_router)
hitlist.register(api_router)
properties.register(api_router)
illegal_business.register(api_router)
store.register(api_router)
racket.register(api_router)
leaderboard.register(api_router)
meta.register(api_router)
user_progress.register(api_router)
states.register(api_router)
events.register(api_router)
security_admin.register(api_router)
sports_betting.register(api_router)
auth.register(api_router)
profile.register(api_router)
admin.register(api_router)
from routers.game import help_desk
help_desk.register(api_router)
payments.register(api_router)
stats.register(api_router)
achievements.register(api_router)
dead_alive.register(api_router)
users.register(api_router)
giphy.register(api_router)
image_host.register(api_router)
crack_safe.register(api_router)
prestige.register(api_router)
from routers.game import daily_rewards
daily_rewards.register(api_router)
gauntlet.register(api_router)
boxing.register(api_router)
racing.register(api_router)
snake.register(api_router)
from routers.minigames import minigame_leaderboard
minigame_leaderboard.register(api_router)
from routers.minigames import minesweeper
minesweeper.register(api_router)
from routers.minigames import battleships
battleships.register(api_router)
from routers.minigames import the_getaway
the_getaway.register(api_router)
from routers.minigames import family_run
family_run.register(api_router)
from routers.minigames import whack_a_copper
whack_a_copper.register(api_router)
from routers.minigames import mafia_rpg
mafia_rpg.register(api_router)
from routers.account import auto_rank as auto_rank_router
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
    from middleware.security_middleware import SecurityMiddleware
    app.add_middleware(SecurityMiddleware, db=db)
except ImportError:
    print("Warning: security_middleware.py not found - rate limiting disabled")

try:
    from middleware.request_logging import RequestLoggingMiddleware
    app.add_middleware(RequestLoggingMiddleware)
except ImportError:
    pass

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
    # Load persisted car value overrides (exclusive cars edited via admin)
    try:
        overrides = await db.game_config.find({"id": {"$regex": "^car_override_"}}).to_list(50)
        for ov in overrides:
            car_id = ov.get("car_id")
            vals = ov.get("overrides") or {}
            car = next((c for c in CARS if c["id"] == car_id), None)
            if car and vals:
                if "value" in vals:
                    car["value"] = int(vals["value"])
                if "travel_bonus" in vals:
                    car["travel_bonus"] = int(vals["travel_bonus"])
                logging.info("Loaded car override for %s: value=%s travel=%s", car_id, car.get("value"), car.get("travel_bonus"))
    except Exception as e:
        logging.warning("Failed to load car overrides: %s", e)
    from routers.account.profile import ensure_profile_indexes
    from ensure_indexes import ensure_all_indexes
    await ensure_profile_indexes(db)
    await ensure_all_indexes(db)
    try:
        from utils.ensure_faq_topic import ensure_faq_forum_topic

        await ensure_faq_forum_topic(db)
    except Exception as e:
        logging.exception("FAQ forum topic sync: %s", e)
    from routers.crime.jail import spawn_jail_npcs
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
    # Auto Rank: when AUTO_RANK_USE_CRON=1, all Auto Rank (main + bust + OC) is driven by cron only
    from routers.account import auto_rank
    auto_rank_use_cron = (os.environ.get("AUTO_RANK_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
    if not auto_rank_use_cron:
        asyncio.create_task(auto_rank.run_auto_rank_loop())
        asyncio.create_task(auto_rank.run_bust_5sec_loop())
        asyncio.create_task(auto_rank.run_auto_rank_oc_loop())
    else:
        logging.getLogger(__name__).info(
            "Auto Rank: using cron only (AUTO_RANK_USE_CRON=1). Call POST /api/auto-rank/cron and POST /api/auto-rank/cron-bust every 5s. Header: X-Cron-Secret: <CRON_SECRET>"
        )
    # Racing: 2 automated races per day (morning/evening UTC); in-process ticker or cron
    from routers.minigames import racing as racing_router
    racing_use_cron = (os.environ.get("RACING_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
    if not racing_use_cron:
        asyncio.create_task(racing_router.run_racing_automated_race_ticker())
    else:
        logging.getLogger(__name__).info(
            "Racing: using cron only (RACING_USE_CRON=1). Call POST /api/racing/cron/automated-races every minute. Header: X-Cron-Secret: <CRON_SECRET>"
        )
    from routers.cars import gta as gta_router
    asyncio.create_task(gta_router.run_dealer_replenish_loop())
    # Slots: run lottery draw on schedule (every 5s check) so draws happen at next_draw_at even if no one is on the page
    from routers.casinos import slots as slots_router
    async def slots_draw_ticker():
        while True:
            try:
                await slots_router.run_slots_draws_due()
            except Exception as e:
                logging.exception("Slots draw ticker: %s", e)
            await asyncio.sleep(5)
    asyncio.create_task(slots_draw_ticker())
    # Missions: daily tribute deposit at configured UTC hour (e.g. 17:00); check every 60s
    from routers.account import missions as missions_router
    async def tribute_deposit_ticker():
        while True:
            try:
                await missions_router.run_daily_tribute_deposit()
            except Exception as e:
                logging.exception("Daily tribute deposit ticker: %s", e)
            await asyncio.sleep(60)
    asyncio.create_task(tribute_deposit_ticker())
    # Bodyguard weekly payout: run once per day (check every 60s), pay human bodyguards on their payout_weekday
    from routers.kill import bodyguards as bodyguards_router
    async def bodyguard_payout_ticker():
        while True:
            try:
                await bodyguards_router.run_bodyguard_weekly_payout(db)
            except Exception as e:
                logging.exception("Bodyguard weekly payout ticker: %s", e)
            await asyncio.sleep(60)
    asyncio.create_task(bodyguard_payout_ticker())
    # Weekly leaderboard payout: run once per week (check every 60s), pay top 10 per category for previous week
    from routers.game import leaderboard as leaderboard_router
    async def leaderboard_payout_ticker():
        while True:
            try:
                await leaderboard_router.run_weekly_leaderboard_payout(db)
            except Exception as e:
                logging.exception("Weekly leaderboard payout ticker: %s", e)
            await asyncio.sleep(60)
    asyncio.create_task(leaderboard_payout_ticker())
    # Mini games weekly leaderboard payout: run once per week (check every 60s), pay top 5 for previous week (Sunday UTC)
    from routers.minigames import minigame_leaderboard as minigame_lb_router
    async def minigame_payout_ticker():
        while True:
            try:
                await minigame_lb_router.run_minigame_weekly_payout(db)
            except Exception as e:
                logging.exception("Mini games weekly payout ticker: %s", e)
            await asyncio.sleep(60)
    asyncio.create_task(minigame_payout_ticker())
    # Boxing: expire stale challenges (every 30s) + weekly league payout (every 60s)
    from routers.minigames import boxing as boxing_router
    async def boxing_challenge_expiry_ticker():
        while True:
            try:
                await boxing_router.expire_stale_challenges(db)
            except Exception as e:
                logging.exception("Boxing challenge expiry ticker: %s", e)
            await asyncio.sleep(30)
    asyncio.create_task(boxing_challenge_expiry_ticker())
    async def boxing_weekly_payout_ticker():
        while True:
            try:
                await boxing_router.run_weekly_boxing_league_payout(db)
            except Exception as e:
                logging.exception("Boxing weekly payout ticker: %s", e)
            await asyncio.sleep(60)
    asyncio.create_task(boxing_weekly_payout_ticker())
    # Telegram: register webhook
    _tg_token = getattr(security_module, "TELEGRAM_BOT_TOKEN", "") or ""
    if _tg_token:
        _webhook_base = (os.environ.get("TELEGRAM_WEBHOOK_BASE_URL") or os.environ.get("BASE_URL") or "").strip().rstrip("/")
        if _webhook_base:
            try:
                _webhook_url = _webhook_base + "/api/auto-rank/telegram-webhook"
                await security_module.set_telegram_webhook(
                    _webhook_url,
                    secret_token=os.environ.get("TELEGRAM_WEBHOOK_SECRET") or None,
                )
            except Exception as e:
                logging.getLogger(__name__).warning("Telegram setWebhook failed: %s", e)
        else:
            logging.getLogger(__name__).info(
                "TELEGRAM_BOT_TOKEN set but TELEGRAM_WEBHOOK_BASE_URL/BASE_URL unset — set one so the bot receives commands (e.g. /autorank)."
            )
        try:
            await security_module.set_telegram_bot_commands()
        except Exception as e:
            logging.getLogger(__name__).warning("Telegram setMyCommands (bot menu) failed: %s", e)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

def _load_seed_json(filename: str) -> list:
    """Load seed data from backend/data/<filename>. Returns [] if file missing."""
    path = ROOT_DIR / "data" / filename
    if not path.is_file():
        logging.warning("Seed file not found: %s (game data will not be seeded from file)", path)
        return []
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception as e:
        logging.warning("Failed to load seed file %s: %s", path, e)
        return []


async def init_game_data():
    """
    Initialize game data on server startup from the database.
    If collections are empty, seed from backend/data/*.json (weapons, properties, crimes).
    NOTE: No user data is modified; only game config collections are seeded when empty.
    """
    from routers.crime import crimes as crimes_router
    from utils.migrate_weapon_order import migrate_weapon_tier_order_if_needed

    await crimes_router.init_crimes_data(db)

    logging.info("🔄 Initializing game data (weapons, properties...)...")
    await migrate_weapon_tier_order_if_needed(db)
    weapons_count = await db.weapons.count_documents({})
    if weapons_count == 0:
        weapons = _load_seed_json("weapons.json")
        if weapons:
            await db.weapons.insert_many(weapons)
            logging.info("Seeded %d weapons from data/weapons.json", len(weapons))
        else:
            logging.warning("Weapons collection is empty and no seed file; add data/weapons.json or insert via DB.")
    else:
        if await db.weapons.find_one({"id": "weapon_loot"}) is None:
            loot_weapon = {"id": "weapon_loot", "name": "Colt Monitor", "description": "Loot-exclusive LMG. Not sold anywhere.", "damage": 140, "bullets_needed": 40, "rank_required": 11, "price_money": None, "price_points": None, "loot_exclusive": True}
            await db.weapons.insert_one(loot_weapon)
            logging.info("Inserted loot-exclusive weapon (weapon_loot) into existing weapons collection")
    properties_count = await db.properties.count_documents({})
    if properties_count == 0:
        properties = _load_seed_json("properties.json")
        if properties:
            await db.properties.insert_many(properties)
            logging.info("Seeded %d properties from data/properties.json", len(properties))
        else:
            logging.warning("Properties collection is empty and no seed file; add data/properties.json or insert via DB.")
    logging.info("✅ Game data initialization complete (NO user data was modified)")
