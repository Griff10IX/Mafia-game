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
from typing import Any, List, Optional, Dict, Union
import uuid
from datetime import datetime, timezone, timedelta
from utils.ban_user_wipe import user_has_active_account_ban
from utils.ip_ban_check import raise_http_if_ip_banned, client_ip_from_request
from utils.geo_country import country_code_from_request_headers
from utils.game_pass_micro_rewards import (
    micro_tier_from_rank_points,
    rewards_for_micro_tier,
    format_rewards_summary,
    MAX_MICRO_TIER,
    REWARD_KEY_LABELS,
    free_unlocked_key_for_micro_tier,
)
from utils.game_pass_tier_reconcile import grant_missing_vip_micro_tier_rewards
from utils.analytics_events import log_analytics_event
from utils.point_provenance import log_points_event
from utils.staff_access_audit import path_requires_staff_issued_jwt
from utils.family_vault_log import log_family_vault_tx
from utils.jwt_env import require_jwt_secret_key
from passlib.context import CryptContext
from jose import JWTError, jwt
from jose.exceptions import ExpiredSignatureError
import random
import secrets
import math
import time
from urllib.parse import unquote
import httpx
import certifi

# Import security module (anti-cheat and monitoring)
import middleware.security as security_module

ROOT_DIR = Path(__file__).parent
# override=True: values in backend/.env win over empty or stale vars from systemd/docker (common Turnstile/JWT issue)
load_dotenv(ROOT_DIR / '.env', override=True)
# Also load project root .env if present (e.g. when running from root); do not override keys already set from backend/.env
load_dotenv(ROOT_DIR.parent / '.env', override=False)

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

SECRET_KEY = require_jwt_secret_key()
ALGORITHM = "HS256"
# Session length: default 7d. Override with JWT_EXPIRE_MINUTES in .env (minutes; e.g. 43200 = 30 days).
_access_expire = os.environ.get("JWT_EXPIRE_MINUTES", "").strip()
ACCESS_TOKEN_EXPIRE_MINUTES = int(_access_expire) if _access_expire.isdigit() else 60 * 24 * 7
# Inactivity timeout: session ends after this many minutes with no requests. 0 = disabled (only JWT expiry applies). Override with SESSION_INACTIVITY_MINUTES in .env.
_inactivity = os.environ.get("SESSION_INACTIVITY_MINUTES", "").strip()
SESSION_INACTIVITY_MINUTES = int(_inactivity) if _inactivity.isdigit() else 60 * 24 * 7  # default 7d; matches JWT default so idle timeout is not stricter than token

security = HTTPBearer()

# Create the main app without a prefix
app = FastAPI()

# Security monitoring (imported after app creation)
from middleware.security import (
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
from utils.config import STATES  # noqa: E402 — single source of truth for travel/cities
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
    # Don→Godfather split evenly (~197.2k per promotion); avoids tiny 30k sprints after a 530k cliff.
    {"id": 11, "name": "Capo di tutti capi", "required_points": 625600},
    {"id": 12, "name": "Boss of Bosses", "required_points": 822800},
    {"id": 13, "name": "Godfather", "required_points": 1020000},
]
GODFATHER_RANK_ID = RANKS[-1]["id"]  # Top rank (prestige requires this)
CAPO_RANK_ID = 6  # Minimum rank to claim or hold casino/property; below-Capo owners have 3h grace then auto-relinquish

# Prestige: 5 levels after Godfather. Rank ladder uses the same RANKS shape; every tier scales by the same
# factor so prestige gate and Capo (etc.) stay in lockstep (e.g. 2× gate ⇒ 2× each tier vs prestige 0).
# prestige_rank_multiplier = get_rank_threshold_mult(prestige_level), synced on the user doc.
# mission_reward_mult: mission payout multiplier at each prestige level (applies when claiming rewards).
PRESTIGE_CONFIGS = {
    1: {"crime_mult": 1.10, "oc_mult": 1.10, "gta_rare_boost": 0.5,  "npc_mult": 1.10, "name": "Made",             "mission_reward_mult": 0.5, "illegal_business_mult": 1.10},
    2: {"crime_mult": 1.20, "oc_mult": 1.20, "gta_rare_boost": 1.0,  "npc_mult": 1.20, "name": "Earner",           "mission_reward_mult": 1.0, "illegal_business_mult": 1.20},
    3: {"crime_mult": 1.30, "oc_mult": 1.30, "gta_rare_boost": 1.5,  "npc_mult": 1.30, "name": "Capo di Capi",     "mission_reward_mult": 1.5, "illegal_business_mult": 1.30},
    4: {"crime_mult": 1.40, "oc_mult": 1.40, "gta_rare_boost": 2.0,  "npc_mult": 1.40, "name": "The Don",          "mission_reward_mult": 2.0, "illegal_business_mult": 1.40},
    5: {"crime_mult": 1.50, "oc_mult": 1.50, "gta_rare_boost": 2.5,  "npc_mult": 1.50, "name": "Godfather Legacy", "mission_reward_mult": 2.5, "illegal_business_mult": 1.50},
}


def get_prestige_gate_multiplier(prestige_level: int) -> float:
    """Scale for this prestige's climb: next prestige gate is this × Godfather base."""
    pl = int(prestige_level or 0)
    # Medium-easier balance: keep P1 baseline, then flatten the rest of the old 2/3/4/5 ladder.
    if pl <= 0:
        return 1.0
    if pl == 1:
        return 1.4
    if pl == 2:
        return 2.1
    if pl == 3:
        return 2.8
    return 3.5


def get_rank_threshold_mult(prestige_level: int) -> float:
    """Same factor applied to every RANKS tier for the current prestige cycle."""
    pl = int(prestige_level or 0)
    # At prestige 0, street ladder stays baseline.
    if pl <= 0:
        return 1.0
    return float(get_prestige_gate_multiplier(pl))


def get_prestige_requirement(current_level: int) -> int:
    """
    Raw rank_points required to prestige from current_level -> current_level+1.

    Gate = get_prestige_gate_multiplier(current_level) × Godfather base.
    Street tiers use the same ratio via get_rank_threshold_mult(prestige_level) so Capo etc. scale in lockstep.
    """
    if current_level < 0 or current_level >= 5:
        return 0
    step = int(RANKS[-1]["required_points"])
    return int(step * float(get_prestige_gate_multiplier(current_level)))

def get_prestige_bonus(user: dict) -> dict:
    """Return stacking benefit multipliers for a user based on their prestige_level."""
    level = min(int(user.get("prestige_level") or 0), 5)
    if level == 0:
        return {"crime_mult": 1.0, "oc_mult": 1.0, "gta_rare_boost": 0.0, "npc_mult": 1.0, "mission_reward_mult": 1.0, "illegal_business_mult": 1.0}
    cfg = PRESTIGE_CONFIGS[level]
    return {**{k: cfg[k] for k in ("crime_mult", "oc_mult", "gta_rare_boost", "npc_mult")}, "mission_reward_mult": cfg["mission_reward_mult"], "illegal_business_mult": cfg.get("illegal_business_mult", 1.0)}

# Founding Member: +15% on crimes, GTA, OC, hitlist NPC, properties, rackets, missions (see founding_member_income_mult).
FOUNDING_MEMBER_INCOME_MULT = 1.15


def founding_member_income_mult(user: Optional[dict]) -> float:
    """Return 1.15 if user is a founding member (flag or Founding Member badge), else 1.0."""
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


# Wealth ranks: based on cash on hand (ordered by min_money ascending). "color" is hex for UI (dark-theme readable).
WEALTH_RANKS = [
    {"id": 1, "name": "Broke", "min_money": 0, "color": "#64748b"},
    {"id": 2, "name": "Bum", "min_money": 1, "color": "#78716c"},
    {"id": 3, "name": "Very Poor", "min_money": 50_000, "color": "#94a3b8"},
    {"id": 4, "name": "Poor", "min_money": 200_000, "color": "#cbd5e1"},
    {"id": 5, "name": "Rich", "min_money": 500_000, "color": "#fcd34d"},
    {"id": 6, "name": "Millionaire", "min_money": 1_000_000, "color": "#fbbf24"},
    {"id": 7, "name": "Extremely Rich", "min_money": 2_000_000, "color": "#f59e0b"},
    {"id": 8, "name": "Fat Cat", "min_money": 5_000_000, "color": "#84cc16"},
    {"id": 9, "name": "Multi Millionaire", "min_money": 10_000_000, "color": "#65a30d"},
    {"id": 10, "name": "Big Hitter", "min_money": 25_000_000, "color": "#4ade80"},
    {"id": 11, "name": "Power Broker", "min_money": 50_000_000, "color": "#22c55e"},
    {"id": 12, "name": "Centimillionaire", "min_money": 100_000_000, "color": "#10b981"},
    {"id": 13, "name": "Quarter Billionaire", "min_money": 250_000_000, "color": "#14b8a6"},
    {"id": 14, "name": "Tycoon", "min_money": 500_000_000, "color": "#2dd4bf"},
    {"id": 15, "name": "Billionaire", "min_money": 1_000_000_000, "color": "#06b6d4"},
    {"id": 16, "name": "Double Billionaire", "min_money": 2_000_000_000, "color": "#0ea5e9"},
    {"id": 17, "name": "Five-Billion Magnate", "min_money": 5_000_000_000, "color": "#38bdf8"},
    {"id": 18, "name": "Multi Billionaire", "min_money": 10_000_000_000, "color": "#60a5fa"},
    {"id": 19, "name": "Ultra Billionaire", "min_money": 50_000_000_000, "color": "#818cf8"},
    {"id": 20, "name": "Mega Billionaire", "min_money": 100_000_000_000, "color": "#a78bfa"},
    {"id": 21, "name": "Quarter Trillionaire", "min_money": 250_000_000_000, "color": "#c084fc"},
    {"id": 22, "name": "Half Trillionaire", "min_money": 500_000_000_000, "color": "#e879f9"},
    {"id": 23, "name": "Trillionaire", "min_money": 1_000_000_000_000, "color": "#f472b6"},
    {"id": 24, "name": "Double Trillionaire", "min_money": 2_000_000_000_000, "color": "#fb7185"},
    {"id": 25, "name": "Grand Trillionaire", "min_money": 5_000_000_000_000, "color": "#fcd34d"},
    {"id": 26, "name": "Multi Trillionaire", "min_money": 10_000_000_000_000, "color": "#fef08a"},
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

# Health & armour: health 0-100, armour 0-7. Bullets to kill clamped to [MIN_BULLETS_TO_KILL, MAX_BULLETS_TO_KILL]
DEFAULT_HEALTH = 100
# Passive regen: linear 0→100% over this many seconds of real time (lazy: applied on auth + before PvP damage calc)
HEALTH_REGEN_FULL_SECONDS = 7200  # 2 hours
MIN_BULLETS_TO_KILL = 5000
MAX_BULLETS_TO_KILL = 100000
# Base bullets before rank/weapon/gap factors; high tiers tuned down (was up to 120k @ 7).
MAX_ARMOUR_LEVEL = 7
LOOT_EXCLUSIVE_ARMOUR_LEVEL = 7
ARMOUR_BASE_BULLETS = {0: 5000, 1: 14000, 2: 25000, 3: 36000, 4: 47000, 5: 55000, 6: 60000, 7: 66000}
# Level 6: Points Store only (not armoury factory stock). Requires owning level 5 first.
ARMOUR_POINT_STORE_TIER = {
    "level": 6,
    "name": "Elite Composite Battledress",
    "description": "Top-tier composite plating — sold only in the Points Store.",
    "cost_points": 500,
}
# weapon11: Points Store only (not armoury stock). Requires owning weapon10 first.
WEAPON_POINT_STORE_TIER = {
    "id": "weapon11",
    "name": "Engraved Lewis Gun",
    "description": "Masterwork light machine gun — sold only in the Points Store.",
    "damage": 130,
    "bullets_needed": 45,
    "rank_required": 11,
    "cost_points": 1000,
}
KILL_CASH_PERCENT = 0.75  # killer gets 75% of victim's cash
# Dead > Alive retrieve: cash uses DEAD_ALIVE_PERCENT (state head tax on money); points use DEAD_ALIVE_POINTS_PERCENT.
DEAD_ALIVE_PERCENT = 0.9995  # cash: 0.05% tax to state head — recipient gets 99.95% of money_at_death
DEAD_ALIVE_POINTS_PERCENT = 1.0  # points: 100% of points_at_death to recipient (no points tax)

def canonical_state_name(state: str) -> str:
    """Map arbitrary casing/spacing to a STATES entry, or return stripped input."""
    s = (state or "").strip()
    if not s:
        return ""
    for st in (STATES or []):
        if st and s.lower() == st.lower():
            return st
    return s


# State heads: which family (if any) is head of each state. One family per state; at most 4 families.
async def get_state_heads() -> Dict[str, Optional[str]]:
    """Return { state: family_id or None } for all STATES. Stored in game_settings key 'state_heads'."""
    doc = await db.game_settings.find_one({"key": "state_heads"}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value") or {}
    raw_by_lower = {
        str(k).strip().lower(): (v or "").strip() or None
        for k, v in raw.items()
        if str(k).strip()
    }
    out = {}
    for s in (STATES or []):
        out[s] = raw_by_lower.get(s.lower()) or None
    active_fids = [fid for fid in out.values() if fid]
    if active_fids:
        wiped_ids = {
            f["id"]
            async for f in db.families.find({"id": {"$in": active_fids}, "wiped": True}, {"_id": 0, "id": 1})
        }
        if wiped_ids:
            repaired = False
            for st in out:
                if out[st] in wiped_ids:
                    out[st] = None
                    repaired = True
            if repaired:
                await db.game_settings.update_one(
                    {"key": "state_heads"},
                    {"$set": {"value": out}},
                    upsert=True,
                )
                for wid in wiped_ids:
                    await db.families.update_one({"id": wid}, {"$set": {"head_of_state": None}})
    return out


async def get_head_family_id_for_state(state: str) -> Optional[str]:
    """Return family_id that is head of the given state, or None."""
    key = canonical_state_name(state)
    if not key or key not in (STATES or []):
        return None
    heads = await get_state_heads()
    fid = heads.get(key)
    if fid:
        fam = await db.families.find_one({"id": fid}, {"_id": 0, "wiped": 1})
        if fam and not fam.get("wiped"):
            return fid
    # state_heads map can desync from families.head_of_state (legacy rows / casing); repair on read.
    fam = await db.families.find_one(
        {
            "head_of_state": {"$regex": f"^{re.escape(key)}$", "$options": "i"},
            "wiped": {"$ne": True},
        },
        {"_id": 0, "id": 1},
    )
    if not fam:
        return None
    fid = fam["id"]
    if heads.get(key) != fid:
        await set_state_head(key, fid, force=True)
    return fid


def state_head_casino_treasury_share(whole_edge_cash: int) -> int:
    """Server-only: portion of the computed casino skim credited to state head treasury.

    Player payouts and owner-side deductions still use full advertised house-edge math; only the
    treasury / state_head_income increment is reduced (remainder is an economic sink). Do not
    expose this split in public APIs or copy.
    """
    if whole_edge_cash <= 0:
        return 0
    return whole_edge_cash // 2


async def set_state_head(state: str, family_id: Optional[str], force: bool = False) -> str:
    """Set or clear the head family for a state. Updates game_settings and family head_of_state.
    A family can only be head of ONE state - blocks if they already head another (unless force=True for admin cleanup).
    Returns error message string if blocked, or empty string on success.
    """
    state = canonical_state_name(state)
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


async def clear_or_transfer_state_head_on_wipe(loser_family_id: str, winner_id: Optional[str] = None) -> None:
    """Clear wiped family's state head, or transfer / offer takeover to the war winner."""
    if not loser_family_id:
        return
    loser_fam = await db.families.find_one({"id": loser_family_id}, {"_id": 0, "head_of_state": 1})
    head_state = ((loser_fam or {}).get("head_of_state") or "").strip()
    if not head_state:
        heads = await get_state_heads()
        for st, fid in heads.items():
            if fid == loser_family_id:
                head_state = st
                break
    if not head_state:
        return
    winner_id = (winner_id or "").strip() or None
    if winner_id:
        winner_fam = await db.families.find_one({"id": winner_id}, {"_id": 0, "head_of_state": 1, "wiped": 1})
        if not winner_fam or winner_fam.get("wiped"):
            winner_id = None
        else:
            winner_current_state = ((winner_fam or {}).get("head_of_state") or "").strip()
            if winner_current_state:
                await db.families.update_one(
                    {"id": winner_id},
                    {
                        "$set": {
                            "pending_state_takeover": head_state,
                            "pending_state_takeover_at": datetime.now(timezone.utc).isoformat(),
                        }
                    },
                )
                await set_state_head(head_state, None)
                return
    if winner_id:
        await set_state_head(head_state, winner_id)
    else:
        await set_state_head(head_state, None)


# Game-wide events. Positive-only random auto-rotation (1-2 events, 1-24h random duration).
# racket_cooldown: <1 = faster; racket_payout: >1 = extra %; armour_weapon_cost: <1 = cheaper
# Full legacy list kept for backward compat (DB records reference old ids).
GAME_EVENTS = [
    {"id": "double_rank", "name": "Double Rank Points", "message": "Double rank points! Kills and GTA reward 2x rank.", "rank_points": 2.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "double_cash", "name": "Double Cash Rewards", "message": "Double cash rewards! Kill loot is 2x.", "rank_points": 1.0, "kill_cash": 2.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "gta_double_chance", "name": "2x GTA Success Chance", "message": "2x GTA success chance! Better odds on heists.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 2.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "bodyguard_half_price", "name": "Bodyguards 50% Off", "message": "Bodyguards 50% off! Slots, hire, and armour upgrades.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 0.5, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "bodyguard_premium", "name": "Bodyguards 10% More", "message": "Bodyguard services 10% more expensive.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.1, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "racket_extra_payout", "name": "Rackets +10% Payouts", "message": "Family rackets pay 10% more.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.1, "armour_weapon_cost": 1.0},
    {"id": "racket_reduced_payout", "name": "Rackets -10% Payouts", "message": "Family rackets pay 10% less.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 0.9, "armour_weapon_cost": 1.0},
    {"id": "racket_faster_cooldown", "name": "Rackets 50% Faster", "message": "Racket cooldowns are half as long.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 0.5, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "racket_bonus_day", "name": "Racket Bonus Day", "message": "Rackets: +10% payouts and 25% faster cooldowns.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 0.75, "racket_payout": 1.1, "armour_weapon_cost": 1.0},
    {"id": "armour_weapon_half_price", "name": "Armour & Weapons 50% Off", "message": "Armour and weapons 50% off.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 0.5},
    {"id": "armour_weapon_premium", "name": "Armour & Weapons 10% More", "message": "Armour and weapons 10% more expensive.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.1},
    {"id": "oc_payout_boost", "name": "OC Payout +15%", "message": "Organised crime payouts 15% higher.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.15, "armour_weapon_cost": 1.0},
    {"id": "racket_cooldown_faster", "name": "Crime Cooldown -20%", "message": "Racket cooldowns 20% shorter.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 0.8, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "gta_cash_boost", "name": "GTA Cash +50%", "message": "Kill loot and heist cash 50% higher.", "rank_points": 1.0, "kill_cash": 1.5, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "no_event_day", "name": "No Event Day", "message": "No bonuses or penalties.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "rank_points_boost", "name": "Rank Points +50%", "message": "Kills and GTA reward 50% more rank points.", "rank_points": 1.5, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "bodyguard_quarter_off", "name": "Bodyguards 25% Off", "message": "Bodyguard services 25% off.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 0.75, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "racket_payout_boost", "name": "Rackets +20% Payouts", "message": "Family rackets pay 20% more.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.2, "armour_weapon_cost": 1.0},
    {"id": "armour_weapon_quarter_off", "name": "Armour & Weapons 25% Off", "message": "Armour and weapons 25% off.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 0.75},
    {"id": "gta_success_boost", "name": "GTA Success +25%", "message": "GTA success chance 25% higher.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.25, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "rank_points_penalty", "name": "Rank Points -25%", "message": "Kills and GTA reward 25% less rank points.", "rank_points": 0.75, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "bodyguard_premium_day", "name": "Bodyguards 25% More", "message": "Bodyguard services 25% more expensive.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.25, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "racket_payout_penalty", "name": "Rackets -20% Payouts", "message": "Family rackets pay 20% less.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 0.8, "armour_weapon_cost": 1.0},
    {"id": "armour_weapon_premium_day", "name": "Armour & Weapons 25% More", "message": "Armour and weapons 25% more expensive.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.25},
    {"id": "gta_success_penalty", "name": "GTA Success -25%", "message": "GTA success chance 25% lower.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 0.75, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0},
    {"id": "bullets_store_25_off", "name": "Bullets in Store 25% Off", "message": "Bullets in the store 25% cheaper.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 0.75},
    {"id": "bullets_store_25_more", "name": "Bullets in Store +25%", "message": "Bullets in the store 25% more expensive.", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.25},
]
NO_EVENT = {"id": "none", "name": "No event", "message": "", "rank_points": 1.0, "kill_cash": 1.0, "gta_success": 1.0, "bodyguard_cost": 1.0, "racket_cooldown": 1.0, "racket_payout": 1.0, "armour_weapon_cost": 1.0}

MULTIPLIER_KEYS = ["rank_points", "kill_cash", "gta_success", "bodyguard_cost", "racket_cooldown", "racket_payout", "armour_weapon_cost"]

GAME_EVENTS_BY_ID = {ev["id"]: ev for ev in GAME_EVENTS}

_NEGATIVE_EVENT_IDS = {
    "bodyguard_premium", "bodyguard_premium_day",
    "racket_reduced_payout", "racket_payout_penalty",
    "armour_weapon_premium", "armour_weapon_premium_day", "bullets_store_25_more",
    "rank_points_penalty", "gta_success_penalty",
    "no_event_day",
}
POSITIVE_GAME_EVENTS = [ev for ev in GAME_EVENTS if ev["id"] not in _NEGATIVE_EVENT_IDS]
POSITIVE_GAME_EVENTS_BY_ID = {ev["id"]: ev for ev in POSITIVE_GAME_EVENTS}

# Groups of events that modify the same multiplier — never pick two from the same group.
POSITIVE_EVENT_CONFLICT_GROUPS = [
    ["double_rank", "rank_points_boost"],
    ["double_cash", "gta_cash_boost"],
    ["gta_double_chance", "gta_success_boost"],
    ["bodyguard_half_price", "bodyguard_quarter_off"],
    ["racket_extra_payout", "racket_faster_cooldown", "racket_bonus_day", "racket_cooldown_faster", "racket_payout_boost", "oc_payout_boost"],
    ["armour_weapon_half_price", "armour_weapon_quarter_off", "bullets_store_25_off"],
]

_POSITIVE_EVENT_ID_TO_GROUP: dict = {}
for _gi, _grp in enumerate(POSITIVE_EVENT_CONFLICT_GROUPS):
    for _eid in _grp:
        _POSITIVE_EVENT_ID_TO_GROUP[_eid] = _gi

RANDOM_EVENT_MIN_HOURS = 1.0
RANDOM_EVENT_MAX_HOURS = 24.0


def _build_combined_event(event_ids: List[str]) -> dict:
    """Multiply multipliers from the given event ids into one resolved event dict."""
    combined = {k: NO_EVENT[k] for k in NO_EVENT}
    combined["id"] = "random_auto"
    labels: List[str] = []
    for eid in event_ids:
        ev = GAME_EVENTS_BY_ID.get(eid)
        if not ev:
            continue
        labels.append(ev.get("name") or eid)
        for key in MULTIPLIER_KEYS:
            combined[key] = float(combined.get(key, 1.0)) * float(ev.get(key, 1.0))
    combined["name"] = " + ".join(labels) if labels else "No event"
    combined["message"] = "; ".join(ev.get("message", "") for eid2 in event_ids for ev in [GAME_EVENTS_BY_ID.get(eid2)] if ev) if labels else ""
    return combined


def roll_random_events() -> tuple:
    """Pick 1 or 2 non-conflicting positive events and a random duration (1-24h).
    Returns (event_ids, duration_hours)."""
    pool = list(POSITIVE_GAME_EVENTS)
    first = secrets.choice(pool)
    picked = [first["id"]]
    count = secrets.choice([1, 2])
    if count == 2:
        first_group = _POSITIVE_EVENT_ID_TO_GROUP.get(first["id"])
        candidates = [ev for ev in pool if ev["id"] != first["id"] and _POSITIVE_EVENT_ID_TO_GROUP.get(ev["id"]) != first_group]
        if candidates:
            picked.append(secrets.choice(candidates)["id"])
    duration_hours = round(random.uniform(RANDOM_EVENT_MIN_HOURS, RANDOM_EVENT_MAX_HOURS), 2)
    return picked, duration_hours


async def get_or_rotate_random_events() -> dict:
    """Return the currently active random events (auto-rotating on expiry).
    Returns dict with keys: event (combined multiplier dict), event_ids, expires_at, duration_hours."""
    now = datetime.now(timezone.utc)
    doc = await db.game_config.find_one(
        {"id": "main"},
        {"_id": 0, "random_events_active_ids": 1, "random_events_expires_at": 1, "random_events_duration_hours": 1},
    )
    if doc:
        raw_expires = doc.get("random_events_expires_at")
        if raw_expires:
            if isinstance(raw_expires, str):
                try:
                    expires_dt = datetime.fromisoformat(raw_expires.replace("Z", "+00:00"))
                    if expires_dt.tzinfo is None:
                        expires_dt = expires_dt.replace(tzinfo=timezone.utc)
                except Exception:
                    expires_dt = None
            elif isinstance(raw_expires, datetime):
                expires_dt = raw_expires if raw_expires.tzinfo else raw_expires.replace(tzinfo=timezone.utc)
            else:
                expires_dt = None
            ids = doc.get("random_events_active_ids") or []
            if expires_dt and expires_dt > now and ids:
                valid_ids = [eid for eid in ids if eid in GAME_EVENTS_BY_ID]
                if valid_ids:
                    return {
                        "event": _build_combined_event(valid_ids),
                        "event_ids": valid_ids,
                        "expires_at": expires_dt.isoformat(),
                        "duration_hours": float(doc.get("random_events_duration_hours") or 0),
                    }
    event_ids, duration_hours = roll_random_events()
    expires_at = now + timedelta(hours=duration_hours)
    await db.game_config.update_one(
        {"id": "main"},
        {"$set": {
            "random_events_active_ids": event_ids,
            "random_events_expires_at": expires_at.isoformat(),
            "random_events_duration_hours": duration_hours,
        }},
        upsert=True,
    )
    return {
        "event": _build_combined_event(event_ids),
        "event_ids": event_ids,
        "expires_at": expires_at.isoformat(),
        "duration_hours": duration_hours,
    }


async def force_rotate_random_events() -> dict:
    """Admin: immediately roll new random events regardless of current expiry."""
    now = datetime.now(timezone.utc)
    event_ids, duration_hours = roll_random_events()
    expires_at = now + timedelta(hours=duration_hours)
    await db.game_config.update_one(
        {"id": "main"},
        {"$set": {
            "random_events_active_ids": event_ids,
            "random_events_expires_at": expires_at.isoformat(),
            "random_events_duration_hours": duration_hours,
        }},
        upsert=True,
    )
    return {
        "event": _build_combined_event(event_ids),
        "event_ids": event_ids,
        "expires_at": expires_at.isoformat(),
        "duration_hours": duration_hours,
    }


async def get_events_enabled() -> bool:
    """Whether game events are enabled (admin can disable). Default True if not set."""
    doc = await db.game_config.find_one({"id": "main"}, {"_id": 0, "events_enabled": 1})
    if doc is None:
        return True
    return bool(doc.get("events_enabled", True))


async def get_effective_event():
    """Current event multipliers if events enabled, else NO_EVENT. Auto-rotates random events. Never raises."""
    try:
        if not await get_events_enabled():
            return NO_EVENT.copy()
        result = await get_or_rotate_random_events()
        return result["event"]
    except Exception:
        return NO_EVENT.copy()


async def get_effective_event_full():
    """Like get_effective_event but returns the full rotation info (event_ids, expires_at, duration_hours)."""
    try:
        if not await get_events_enabled():
            return {"event": NO_EVENT.copy(), "event_ids": [], "expires_at": None, "duration_hours": 0}
        return await get_or_rotate_random_events()
    except Exception:
        return {"event": NO_EVENT.copy(), "event_ids": [], "expires_at": None, "duration_hours": 0}


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
    "mini": {"points": 1000, "price_gbp": 2.49},
    "starter": {"points": 2500, "price_gbp": 5.99},
    "bronze": {"points": 5000, "price_gbp": 11.99},
    "silver": {"points": 10000, "price_gbp": 21.99},
    "gold": {"points": 25000, "price_gbp": 52.99},
    "platinum": {"points": 50000, "price_gbp": 99.99},
    "diamond": {"points": 100000, "price_gbp": 189.99},
    "elite": {"points": 150000, "price_gbp": 274.99},
    "legend": {"points": 200000, "price_gbp": 349.99},
    # Rank-XP pass entitlement (no points credited; token is activated in Armoury).
    "rank_xp_pass_499": {"points": 0, "price_gbp": 9.99},
    # Permanent Auto Rank (email-tied entitlement; no points credited).
    "auto_rank_permanent_2000": {"points": 0, "price_gbp": 15.00},
    # Dead > Alive revive (no points credited; fulfills revive swap after payment).
    "dead_alive_revive_10": {"points": 0, "price_gbp": 10.00},
    # Game Pass prestige (no points pack; +15% VIP season totals then reset track).
    "game_pass_prestige_10": {"points": 0, "price_gbp": 10.00},
}

# Travel times based on car rarity (in seconds)
TRAVEL_TIMES = {
    "loot_exclusive": 5,
    "exclusive": 7,
    "vip_exclusive": 8,
    "legendary": 15,
    "ultra_rare": 18,
    "rare": 25,
    "uncommon": 35,
    "common": 45,
    "custom": 12,  # Custom car from points
    "airport": 0   # Airport (instant); set > 0 for timed flights (family -1s perk applies to this value)
}

# Melt-for-bullets: catalog value × (100 − damage)% (damage-immune cars unchanged); melt_value = that × NUM // DEN; bullets = melt_value // MELT_VALUE_PER_BULLET — see gta._melt_cars_impl
MELT_VALUE_PER_BULLET = 385
MELT_BULLETS_VALUE_MULT_NUM = 165  # ~35% above prior 122 (122 × 1.35 ≈ 165)
MELT_BULLETS_VALUE_MULT_DEN = 100

# Base car cash values (GTA sell, scrap, melt, dealer, etc.). Non-exclusive tiers + custom: ×1.25 on prior table (rounded). exclusive + loot_exclusive: unchanged.
CARS = [
    # Common (difficulty 1) - 6 cars
    {"id": "car1", "name": "Model T Ford", "rarity": "common", "min_difficulty": 1, "value": 225, "travel_bonus": 0, "image": "/images/gta/car1.jpg"},
    {"id": "car5", "name": "Essex Coach", "rarity": "common", "min_difficulty": 1, "value": 249, "travel_bonus": 0, "image": "/images/gta/car5.jpg"},
    {"id": "car2", "name": "Chevrolet Series AB", "rarity": "common", "min_difficulty": 1, "value": 269, "travel_bonus": 5, "image": "/images/gta/car2.jpg"},
    {"id": "car6", "name": "Durant Star", "rarity": "common", "min_difficulty": 1, "value": 292, "travel_bonus": 5, "image": "/images/gta/car6.jpg"},
    {"id": "car4", "name": "Ford Model A", "rarity": "common", "min_difficulty": 1, "value": 314, "travel_bonus": 5, "image": "/images/gta/car4.jpg"},
    {"id": "car3", "name": "Dodge Brothers", "rarity": "common", "min_difficulty": 1, "value": 338, "travel_bonus": 5, "image": "/images/gta/car3.jpg"},
    # Uncommon (difficulty 2) - 4 cars; melt scales with MELT_VALUE_PER_BULLET
    {"id": "car7", "name": "Oakland", "rarity": "uncommon", "min_difficulty": 2, "value": 2695, "travel_bonus": 10, "image": "/images/gta/car7.jpg"},
    {"id": "car8", "name": "Willys-Knight", "rarity": "uncommon", "min_difficulty": 2, "value": 4044, "travel_bonus": 10, "image": "/images/gta/car8.jpg"},
    {"id": "car10", "name": "Buick Master Six", "rarity": "uncommon", "min_difficulty": 2, "value": 5390, "travel_bonus": 12, "image": "/images/gta/car10.jpg"},
    {"id": "car9", "name": "Cadillac V-8", "rarity": "uncommon", "min_difficulty": 2, "value": 6919, "travel_bonus": 15, "image": "/images/gta/car9.jpg"},
    # Rare (difficulty 3) - 4 cars
    {"id": "car11", "name": "Packard Eight", "rarity": "rare", "min_difficulty": 3, "value": 7188, "travel_bonus": 20, "image": "/images/gta/car11.jpg"},
    {"id": "car12", "name": "Lincoln Model L", "rarity": "rare", "min_difficulty": 3, "value": 9882, "travel_bonus": 20, "image": "/images/gta/car12.jpg"},
    {"id": "car13", "name": "Pierce-Arrow", "rarity": "rare", "min_difficulty": 3, "value": 12578, "travel_bonus": 25, "image": "/images/gta/car13.jpg"},
    {"id": "car14", "name": "Stutz Bearcat", "rarity": "rare", "min_difficulty": 3, "value": 15274, "travel_bonus": 25, "image": "/images/gta/car14.jpg"},
    # Ultra Rare (difficulty 4) - 3 cars
    {"id": "car15", "name": "Duesenberg Model J", "rarity": "ultra_rare", "min_difficulty": 4, "value": 17070, "travel_bonus": 35, "image": "/images/gta/car15.jpeg"},
    {"id": "car16", "name": "Cord L-29", "rarity": "ultra_rare", "min_difficulty": 4, "value": 22461, "travel_bonus": 35, "image": "/images/gta/car16.jpg"},
    {"id": "car17", "name": "Auburn Speedster", "rarity": "ultra_rare", "min_difficulty": 4, "value": 31445, "travel_bonus": 40, "image": "/images/gta/car17.jpg"},
    # Legendary (difficulty 5) - 2 cars
    {"id": "car18", "name": "Bugatti Type 41 Royale", "rarity": "legendary", "min_difficulty": 5, "value": 35938, "travel_bonus": 50, "image": "/images/gta/car18.jpg"},
    {"id": "car19", "name": "Rolls-Royce Phantom II", "rarity": "legendary", "min_difficulty": 5, "value": 42226, "travel_bonus": 55, "image": "/images/gta/car19.jpg"},
    # Custom (store only, 500 pts)
    {"id": "car_custom", "name": "Custom Car", "rarity": "custom", "min_difficulty": 5, "value": 71875, "travel_bonus": 55, "image": None},
    # Exclusive (admin only)
    {"id": "car20", "name": "Al Capone's Armored Cadillac", "rarity": "exclusive", "min_difficulty": 5, "value": 71875000, "travel_bonus": 60, "image": "/images/gta/car20.png"},
    # Loot-exclusive (loot box only; global caps per type in loot_box.py)
    {"id": "car21", "name": "1930 Cadillac Series 452 V-16 Armored Sedan", "rarity": "loot_exclusive", "min_difficulty": 5, "value": 143750000, "travel_bonus": 68, "image": "/images/gta/car21.png"},
    # VIP Game Pass tier 100 (once per account; custom image; survives death)
    {"id": "car22", "name": "VIP Pass Car", "rarity": "vip_exclusive", "min_difficulty": 5, "value": 71875, "travel_bonus": 55, "image": None},
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
    wealth_rank_color: str = "#64748b"
    wealth_rank_range: str = "$0"
    money: float
    points: int
    rank_points: int
    prestige_level: int = 0
    bodyguard_slots: int
    bodyguard_count: int = 0  # current number of hired bodyguards (filled slots)
    bullets: int
    molotovs: int = 0
    witness_statements: int = 0  # tradable; minted when receiving kill witness notifications
    witness_nav_red: int = 0  # unread new witness inbox lines; cleared when opening Witness statements page
    witness_nav_green: int = 0  # other players' listings created since last Witness page visit (market reminder)
    health: int
    armour_level: int
    armour_owned_level_max: int = 0
    owns_weapon10: bool = False
    owns_weapon11: bool = False
    owns_vip_pass_car: bool = False
    vip_pass_car_count: int = 0
    vip_pass_car_in_game: int = 0  # store-limited stock currently in garages (excludes Game Pass free)
    vip_pass_car_purchase_limit: int = 5  # max store copies across whole player base
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
    founding_member: bool = False
    auto_rank_purchased: bool = False
    auto_rank_permanent: bool = False
    auto_rank_email_entitlement: bool = False  # Stripe/admin email-tied permanent Auto Rank
    auto_rank_trial: bool = False  # True during founding/token trial; Store hides permanent Auto Rank only when purchased and not trial
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
    admin_preview_as_mod: bool = False
    admin_preview_as_mod_seconds_remaining: Optional[int] = None
    casino_profit: int = 0  # $ from owned casino table
    property_profit: int = 0  # points from owned property (e.g. airport)
    has_casino_or_property: bool = False  # true if user owns a casino or property (airport, bullet factory, armory) — for menu visibility
    theme_preferences: Optional[Dict] = None  # legacy single bucket; PC/mobile use theme_preferences_pc / theme_preferences_mobile
    theme_preferences_pc: Optional[Dict] = None
    theme_preferences_mobile: Optional[Dict] = None
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
    hdo_online_color: Optional[str] = None  # hex colour on Users Online (HDO picks own; default when unset)
    is_entertainer: bool = False  # staff: MDG/MP Poker fund; own online colour; not attack-immune
    entertainer_online_color: Optional[str] = None  # hex colour on Users Online (like mod_online_color)
    entertainer_fund_cash: float = 0.0  # segregated fund for sponsoring MDG / MP Poker only
    entertainer_fund_points: int = 0
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
    # Unactivated consumable token counts (armoury inventory)
    xp_crimes_tokens: int = 0
    xp_gta_tokens: int = 0
    melt_tokens: int = 0
    oc_reduced_tokens: int = 0
    booze_tokens: int = 0
    racket_tokens: int = 0
    travel_tokens: int = 0
    properties_tokens: int = 0
    jailbust_tokens: int = 0
    auto_collect_12h_tokens: int = 0
    auto_collect_24h_tokens: int = 0
    jail_bailout_tokens: int = 0
    cooldown_skip_crime_tokens: int = 0
    cooldown_skip_gta_tokens: int = 0
    cooldown_skip_booze_tokens: int = 0
    cooldown_skip_properties_tokens: int = 0
    auto_collect_until: Optional[str] = None
    custom_profile_badge: bool = False
    custom_profile_badge_url: Optional[str] = None
    profile_cosmetic_active: bool = False
    profile_name_glow_color: Optional[str] = None
    profile_border_style: Optional[str] = None
    profile_cosmetic_until: Optional[str] = None
    profile_cosmetic_permanent: bool = False
    crew_oc_auto_apply_tokens: int = 0
    crew_oc_auto_apply_until: Optional[str] = None
    crew_oc_auto_apply_max_fee: Optional[int] = None
    # Rank-XP pass token entitlement (unactivated): stored as 0 or 1 via purchase rules.
    rank_xp_pass_tokens: int = 0
    # For unactivated pass tokens only: expires if not used within 1 month.
    rank_xp_pass_token_expires_at: Optional[str] = None
    # Active VIP: season RP at activation (max with pending snapshot). Unactivated purchase: pending = season RP at purchase.
    rank_xp_pass_tier_snapshot: Optional[int] = None
    # Unactivated token: season RP at purchase time (activation uses max with live season RP).
    rank_xp_pass_pending_tier_snapshot: Optional[int] = None
    # Cursor: highest micro tier rewards already granted (1..100, 0 = none).
    rank_xp_pass_last_granted_micro_tier: int = 0
    # Season-isolated Game Pass progress (mirrors positive rank_points gains; reconciled on season_id change).
    game_pass_season_id: Optional[str] = None
    rank_xp_pass_season_rp: int = 0
    # Current season id from game_settings (for UI; user.game_pass_season_id is last reconciled marker).
    game_pass_current_season_id: str = "1"
    # RP banked on prestige while VIP pass active; added to rank_points for pass tier math only.
    rank_xp_pass_prestige_carry_rp: int = 0
    # Idempotency guard for tiered one-time rewards.
    rank_xp_pass_rewards_granted: bool = False
    # Times this account paid for Game Pass prestige (£10 reset + 15% bonus).
    game_pass_prestige_count: int = 0
    shooting_range_bonus_plays: int = 0  # store upgrade: added to base 10 plays/hour in shooting range
    hitlist_npc_bonus_slots: int = 0  # store upgrade: +1 NPC slot per 3h window (max +3)
    robot_bg_auto_search_until: Optional[str] = None
    robot_bg_auto_search_active: bool = False
    bodyguard_find_time_until: Optional[str] = None
    bodyguard_find_time_active: bool = False
    slow_kill_inflation_until: Optional[str] = None
    slow_kill_inflation_active: bool = False
    slow_bodyguard_hire_inflation_until: Optional[str] = None
    slow_bodyguard_hire_inflation_active: bool = False
    censor_profanity: bool = False  # when true, chat/forum show swear words as ***
    referred_by: Optional[str] = None  # first referrer id (legacy); see referred_by_ids for full list
    referred_by_username: Optional[str] = None  # comma-separated referrer usernames for display
    referred_by_ids: List[str] = Field(default_factory=list)  # all referrer user ids
    # Lifetime totals you earned as a referrer (same fields as GET /account/referral earnings)
    referral_earnings_crime: int = 0
    referral_earnings_oc: int = 0
    referral_earnings_booze: int = 0
    referral_earnings_garage_scrap: int = 0
    referral_earnings_melt_bullets: int = 0
    referral_earnings_weekly_points: int = 0
    rules_accepted: bool = False
    rules_accepted_at: Optional[str] = None
    tutorial_status: Optional[str] = None  # pending | in_progress | completed | skipped
    tutorial_step: Optional[str] = None
    tutorial_crime_done: bool = False
    tutorial_gta_done: bool = False
    tutorial_theme_done: bool = False
    tutorial_rewards_granted: bool = False
    tutorial_ineligible_reason: Optional[str] = None
    loot_box_free_rare_opens: int = 0

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


class CustomBadgeUpdateRequest(BaseModel):
    """Custom profile badge image (data URL). Empty string clears the image."""
    badge_data: str = ""


class NotificationBallPositionRequest(BaseModel):
    """Pixel position for draggable notification ball (synced across devices)."""
    x: int
    y: int


class ThemePreferencesRequest(BaseModel):
    """Theme preferences (all optional). Omitted keys are left unchanged; send full object to replace."""
    theme_platform: Optional[str] = None  # "pc" | "mobile" — which bucket to update; omitted defaults to pc (back-compat)
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


# EventsToggleRequest, RandomMultiEventBundleRequest -> routers/admin.py
# CheckoutRequest -> routers/payments.py

class CustomCarImageUpdate(BaseModel):
    image_url: Optional[str] = None  # URL for picture; empty or null to clear


class ActivityCountryShare(BaseModel):
    """Share of accounts in an activity cohort by last known proxy country (CF-IPCountry)."""
    code: str = ""  # ISO 3166-1 alpha-2; empty = unknown / not captured yet
    count: int = 0
    pct: float = 0.0


class OnlineUsersResponse(BaseModel):
    total_online: int
    users: List[Dict]
    admin_online_color: Optional[str] = None
    mod_default_online_color: Optional[str] = None  # default for Mod in legend (individual mods can override)
    hdo_online_color: Optional[str] = None  # colour for Help Desk Operator in legend
    # Activity snapshots: last_seen in window OR non-idle auto-rank OR forced online now (same ghost/bodyguard rules as /users/online)
    active_last_hour: int = 0
    active_last_day: int = 0
    active_last_week: int = 0
    # Country mix (from last_seen_country on user docs; populated when requests include CF-IPCountry)
    countries_roster: List[ActivityCountryShare] = Field(default_factory=list)
    countries_hour: List[ActivityCountryShare] = Field(default_factory=list)
    countries_day: List[ActivityCountryShare] = Field(default_factory=list)
    countries_week: List[ActivityCountryShare] = Field(default_factory=list)

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
    "/api/gta/playable-count",
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
            raise HTTPException(
                status_code=401,
                detail="Your session is no longer valid. Please log in again.",
            )
    except ExpiredSignatureError:
        # Wall-clock JWT expiry (JWT_EXPIRE_MINUTES) — usually after stepping away / no requests.
        _log_auth_failure(user_id, 401, "JWT expired")
        raise HTTPException(
            status_code=401,
            detail="Your session expired due to inactivity or the login time limit. Please log in again.",
        )
    except JWTError:
        _log_auth_failure(user_id, 401, "Invalid or expired token")
        raise HTTPException(
            status_code=401,
            detail="Your session expired or is no longer valid. Please log in again.",
        )

    # Before user load / account_locked whitelist: IP ban must win over "investigation" locked messaging.
    await raise_http_if_ip_banned(db, request)

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    # Staff capabilities (_is_admin / _is_moderator) are derived from this document on every request, not from JWT claims
    # (beyond sub/session), so tampering with localStorage or browser devtools cannot grant admin/mod API access.
    if user is None:
        _log_auth_failure(user_id, 401, "User not found")
        raise HTTPException(status_code=401, detail="User not found")
    if await user_has_active_account_ban(db, user_id):
        _log_auth_failure(user_id, 403, "Account banned")
        raise HTTPException(status_code=403, detail="This account has been banned from the game.")
    # Safety: money must never go negative - correct if it did (bug/race)
    if (user.get("money") or 0) < 0:
        await db.users.update_one({"id": user_id}, {"$set": {"money": 0}})
        user["money"] = 0
    try:
        from utils.game_pass_season_rp import reconcile_user_game_pass_season_if_stale_after_load

        if await reconcile_user_game_pass_season_if_stale_after_load(db, user):
            user = await db.users.find_one({"id": user_id}, {"_id": 0})
            if user is None:
                _log_auth_failure(user_id, 401, "User not found")
                raise HTTPException(status_code=401, detail="User not found")
    except HTTPException:
        raise
    except Exception:
        pass
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
        # Stripe Checkout is an external redirect: the browser makes no requests to our API while the
        # user pays. Inactivity would otherwise revoke the session mid-flow and the SPA treats 401 as logout.
        path_for_session = (request.url.path or "") if request else ""
        stripe_return_no_inactivity = path_for_session.startswith("/api/payments/status/") or path_for_session.startswith(
            "/api/payments/mark-checkout-cancelled/"
        )
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
                            if stripe_return_no_inactivity:
                                await db.users.update_one(
                                    {"id": user_id},
                                    {"$set": {"sessions.$[s].last_used_at": now.isoformat()}},
                                    array_filters=[{"s.id": session_id}],
                                )
                            else:
                                await db.users.update_one({"id": user_id}, {"$pull": {"sessions": {"id": session_id}}})
                                _log_auth_failure(user_id, 401, "Session expired due to inactivity")
                                raise HTTPException(
                                    status_code=401,
                                    detail="Your session expired due to inactivity. Please log in again.",
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
    # Car travel arrival: real players only. Robot bodyguards cannot move — drop stale travel fields only.
    arrives_at = user.get("travel_arrives_at")
    if arrives_at:
        if user.get("is_npc") and user.get("is_bodyguard"):
            try:
                await db.users.update_one(
                    {"id": user_id},
                    {"$unset": {"traveling_to": "", "travel_arrives_at": ""}},
                )
                user = await db.users.find_one({"id": user_id}, {"_id": 0})
            except Exception:
                pass
        else:
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
        await grant_missing_vip_micro_tier_rewards(
            db,
            user_id,
            user,
            send_notifications=True,
            ignore_token_expiry=False,
        )
    except Exception:
        # Never block user requests due to reward automation.
        pass

    # Free Game Pass auto-grant: unlock exactly 1 reward bucket at each completed 10-tier band
    # (micro tiers 10, 20, … 100) — 10 free payouts total, matching the UI band cards.
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
                grant_season_id = str(user.get("game_pass_season_id") or "").strip() or None
                current_micro = micro_tier_from_rank_points(int(user.get("rank_xp_pass_season_rp") or 0))
                if current_micro > 0:
                    last_micro = int(user.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
                    if current_micro > last_micro:
                        for t in range(last_micro + 1, current_micro + 1):
                            rewards = rewards_for_micro_tier(t, season_id=grant_season_id)
                            free_key = free_unlocked_key_for_micro_tier(t, rewards, season_id=grant_season_id)
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
                            if free_key == "points":
                                asyncio.create_task(log_points_event(db, user_id=user_id, points=reward_amount,
                                    event_type="game_pass_free_grant", event_ref=f"tier:{t}"))

                            next_tier = t + 1 if t < MAX_MICRO_TIER else None
                            next_summary = (
                                f"Tier {next_tier} rewards: {format_rewards_summary(rewards_for_micro_tier(next_tier, season_id=grant_season_id))}"
                                if next_tier
                                else "Max tier reached"
                            )

                            if free_key == "money":
                                received_text = f"${reward_amount:,} cash"
                            elif free_key in ("bullets", "points", "respect_points", "molotovs"):
                                received_text = f"{reward_amount:,} {REWARD_KEY_LABELS.get(free_key, free_key)}"
                            else:
                                received_text = f"{reward_amount:,}x {REWARD_KEY_LABELS.get(free_key, free_key)}"

                            await send_notification(
                                user_id,
                                "Free Game Pass tier reward",
                                f"You received {received_text} as a free Game Pass tier reward (no Game Pass purchase required). Next reward: {next_summary}.",
                                "reward",
                                reward_key=free_key,
                                tier_micro=t,
                                next_tier=next_tier,
                            )
    except Exception:
        # Never block user requests due to reward automation.
        pass

    # Profile online/idle uses last_seen, but historically only GET /auth/me bumped it. Gameplay endpoints
    # (jail bust, casino, etc.) authenticate here without hitting /auth/me → players looked "offline" while
    # stats changed. Refresh at most once per 5 minutes per request burst; skip /auth/me (handler sets it).
    if request and not user.get("is_dead") and not user.get("is_npc") and not user.get("is_bodyguard"):
        try:
            if (request.url.path or "") != "/auth/me":
                now_ts = datetime.now(timezone.utc)
                five_ago = now_ts - timedelta(minutes=5)
                ls_raw = user.get("last_seen")
                bump = True
                if ls_raw:
                    try:
                        ls_dt = datetime.fromisoformat(str(ls_raw).replace("Z", "+00:00"))
                        if ls_dt.tzinfo is None:
                            ls_dt = ls_dt.replace(tzinfo=timezone.utc)
                        bump = ls_dt < five_ago
                    except Exception:
                        bump = True
                if bump:
                    now_iso = now_ts.isoformat()
                    spa_path = (request.headers.get("x-current-path") or "").strip() or None
                    client_ip = client_ip_from_request(request) or None
                    update = {"last_seen": now_iso}
                    if spa_path is not None:
                        update["last_path"] = spa_path[:500]
                    elif request.url.path:
                        update["last_path"] = (request.url.path or "")[:500]
                    if client_ip:
                        update["last_request_ip"] = client_ip
                    cc = country_code_from_request_headers(request)
                    if cc:
                        update["last_seen_country"] = cc
                    await db.users.update_one({"id": user_id}, {"$set": update})
                    user["last_seen"] = now_iso
                    if "last_path" in update:
                        user["last_path"] = update["last_path"]
                    if "last_request_ip" in update:
                        user["last_request_ip"] = update["last_request_ip"]
                    try:
                        from utils.referral_weekly_points import (
                            process_referral_weekly_points,
                            record_referral_activity_day,
                        )

                        if await record_referral_activity_day(db, user_id, user=user):
                            await process_referral_weekly_points(db, user_id)
                    except Exception:
                        pass
        except Exception:
            pass

    # Keep prestige_rank_multiplier aligned with PRESTIGE_CONFIGS for the user's prestige_level (fixes stale DB values after balance changes).
    try:
        _pl = int(user.get("prestige_level") or 0)
        _expected_m = get_rank_threshold_mult(_pl)
        _stored_m = float(user.get("prestige_rank_multiplier") or 1.0)
        if abs(_stored_m - _expected_m) > 1e-9:
            await db.users.update_one({"id": user_id}, {"$set": {"prestige_rank_multiplier": _expected_m}})
            user["prestige_rank_multiplier"] = _expected_m
    except Exception:
        pass

    staff_issued = bool(payload.get("staff_issued"))
    user["_jwt_staff_issued"] = staff_issued
    if request:
        req_path = (request.url.path or "").split("?")[0].rstrip("/") or ""
        if path_requires_staff_issued_jwt(req_path):
            staff_capable = user_has_admin_list_email(user) or _is_moderator(user)
            if staff_capable and not staff_issued:
                raise HTTPException(
                    status_code=403,
                    detail=STAFF_LOGIN_REQUIRED_DETAIL,
                )

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


async def send_notification(
    user_id: str,
    title: str,
    message: str,
    notification_type: str,
    category: Optional[str] = None,
    *,
    always_deliver: bool = False,
    **extra,
):
    """Send a notification to user's inbox. If category is set and always_deliver is False, notification_preferences may mute it."""
    if category and not always_deliver:
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


def _fmt_money_casino_seizure(n: int) -> str:
    return f"${int(n):,}"


async def notify_casino_seizure(
    *,
    former_owner_id: str,
    former_owner_username: Optional[str],
    winner_user_id: str,
    winner_username: str,
    venue_label: str,
    location_label: str,
    full_payout_to_winner: int,
    actual_payout_to_winner: int,
    shortfall: Optional[int] = None,
    buy_back_points: int = 0,
) -> None:
    """
    Inbox both parties when a casino changes hands because the owner could not cover the full win.
    Inbox uses whitespace-pre-wrap; newlines render in the client.
    """
    oid = (former_owner_id or "").strip()
    wid = (winner_user_id or "").strip()
    v = (venue_label or "casino").strip()
    loc = (location_label or "").strip() or "unknown"
    win_name = (winner_username or "").strip() or "A player"
    prev_name = (former_owner_username or "").strip() or "the previous owner"
    full_amt = max(0, int(full_payout_to_winner))
    paid_amt = max(0, int(actual_payout_to_winner))
    sf = int(shortfall) if shortfall is not None else max(0, full_amt - paid_amt)
    bb = max(0, int(buy_back_points or 0))

    loser_body = (
        f"You no longer own the {v} in {loc}.\n\n"
        f"{win_name} won a payout your bankroll could not fully cover.\n\n"
        f"• Full payout owed on that result: {_fmt_money_casino_seizure(full_amt)}\n"
        f"• Amount the winner actually received: {_fmt_money_casino_seizure(paid_amt)}\n"
        f"• Shortfall (uncovered): {_fmt_money_casino_seizure(sf)}\n\n"
        f"Ownership has transferred to {win_name}."
    )
    if bb > 0:
        loser_body += (
            f"\n\nYou had set a buy-back reward of {bb:,} points. "
            "The new owner may get a timed inbox offer to sell the casino back to you."
        )

    winner_body = (
        f"You now own the {v} in {loc}.\n\n"
        f"You seized it from {prev_name} by winning more than their bankroll could pay.\n\n"
        f"• Full payout owed on that win: {_fmt_money_casino_seizure(full_amt)}\n"
        f"• You were paid: {_fmt_money_casino_seizure(paid_amt)}\n"
        f"• Uncovered shortfall (triggered the seizure): {_fmt_money_casino_seizure(sf)}\n\n"
        "Fund the bankroll — the next big win you cannot cover can cost you the property."
    )
    if bb > 0:
        winner_body += (
            f"\n\n{prev_name} may try to buy it back with up to {bb:,} points — watch for a timed inbox offer."
        )

    if oid:
        await send_notification(oid, "Casino seized — you lost ownership", loser_body, "system")
    if wid and wid != oid:
        await send_notification(wid, "Casino seized — you now own it", winner_body, "system")


async def log_respect_earned(user_id: str, amount: int, source: str = ""):
    """Log respect points earned for weekly leaderboard aggregation. Call after awarding respect_points (positive amount only)."""
    if not amount or amount <= 0:
        return
    now = datetime.now(timezone.utc)
    await db.respect_events.insert_one({"user_id": user_id, "amount": amount, "at": now, "source": source or "misc"})


async def log_respect_delta(user_id: str, delta: int, source: str = ""):
    """Log any non-zero respect change for weekly leaderboard and lifetime objectives (positive earn or negative correction)."""
    if not delta:
        return
    now = datetime.now(timezone.utc)
    await db.respect_events.insert_one({"user_id": user_id, "amount": delta, "at": now, "source": source or "misc"})


async def log_melt_event(user_id: str, bullets: int):
    """Log bullets melted for weekly leaderboard aggregation. Call after a melt-for-bullets action."""
    if not bullets or bullets <= 0:
        return
    now = datetime.now(timezone.utc)
    await db.melt_events.insert_one({"user_id": user_id, "bullets": bullets, "at": now})


async def send_notification_to_family(family_id: str, title: str, message: str, notification_type: str, category: Optional[str] = None, **extra):
    """Notify every member of a family. Pass actor_username= to make that username linkable in the inbox."""
    members = await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(100)
    for m in members:
        await send_notification(m["user_id"], title, message, notification_type, category=category, **extra)


async def send_notification_to_all(title: str, message: str, notification_type: str = "system", category: Optional[str] = None, **extra):
    """Notify all users (e.g. new E-Games available). Respects each user's notification_preferences when category is set.

    Uses batched insert_many while streaming users — avoids O(users) sequential find_one+insert_one round trips
    (which caused sharp load spikes when auto E-Games were created).
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    batch: list = []
    batch_size = 500
    async for user in db.users.find({}, {"_id": 0, "id": 1, "notification_preferences": 1}):
        uid = user.get("id")
        if not uid:
            continue
        if category:
            prefs = (user.get("notification_preferences") or {})
            if prefs.get(category) is False:
                continue
        batch.append(
            {
                "id": str(uuid.uuid4()),
                "user_id": uid,
                "title": title,
                "message": message,
                "notification_type": notification_type,
                "read": False,
                "created_at": now_iso,
                **extra,
            }
        )
        if len(batch) >= batch_size:
            await db.notifications.insert_many(batch, ordered=False)
            batch.clear()
    if batch:
        await db.notifications.insert_many(batch, ordered=False)


async def maybe_daily_event_inbox_reminder() -> None:
    """Once per UTC calendar day: send inbox summary to all users when daily events are on and effective event is not NO_EVENT."""
    today = datetime.now(timezone.utc).date().isoformat()
    # Do not use upsert: if "main" exists but was already processed today, the filter
    # matches zero docs; upsert would try to insert another {id: "main"} → E11000 duplicate key.
    result = await db.game_config.update_one(
        {
            "id": "main",
            "$or": [
                {"last_daily_event_inbox_processed_utc_date": {"$exists": False}},
                {"last_daily_event_inbox_processed_utc_date": {"$lt": today}},
            ],
        },
        {"$set": {"last_daily_event_inbox_processed_utc_date": today}},
    )
    if result.modified_count == 0:
        return  # already processed today, another worker won the race, or no main config doc
    if not await get_events_enabled():
        return
    ev = await get_effective_event()
    if (ev or {}).get("id") == "none":
        return
    title = "Daily event"
    message = ((ev or {}).get("message") or "").strip() or f"Today: {(ev or {}).get('name', 'Event')}"
    await send_notification_to_all(title, message, notification_type="system", category="system")


async def _family_war_start(family_a_id: str, family_b_id: str):
    """Start or ensure an active war between two families. Idempotent."""
    if not family_a_id or not family_b_id or family_a_id == family_b_id:
        return
    fa = await db.families.find_one({"id": family_a_id, "wiped": {"$ne": True}}, {"_id": 0, "name": 1, "tag": 1})
    fb = await db.families.find_one({"id": family_b_id, "wiped": {"$ne": True}}, {"_id": 0, "name": 1, "tag": 1})
    if not fa or not fb:
        return
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
    try:
        from routers.game.families import remove_family_quicktrade_listings_for_war_families

        await remove_family_quicktrade_listings_for_war_families(family_a_id, family_b_id)
    except Exception:
        logging.exception("remove_family_quicktrade_listings_for_war_families failed")
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
    members = await db.family_members.find(
        {"family_id": victim_family_id},
        {"_id": 0, "id": 1, "family_id": 1, "user_id": 1, "role": 1, "joined_at": 1},
    ).to_list(100)
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
    winner_family = await db.families.find_one(
        {"id": winner_id, "wiped": {"$ne": True}},
        {"_id": 0, "name": 1, "tag": 1, "boss_id": 1, "racket_income_bonus_percent": 1, "rackets": 1},
    )
    winner_family_name = (winner_family or {}).get("name") or (winner_family or {}).get("tag") or winner_id or "?"
    loser_family_name = (loser_family or {}).get("name") or (loser_family or {}).get("tag") or loser_id
    killer_user = await db.users.find_one({"id": killer_id}, {"_id": 0, "username": 1}) if solo_killer and killer_id else None
    killer_username = (killer_user or {}).get("username") or "?" if solo_killer else None
    from routers.game.families import claim_family_wipe

    claimed_family = await claim_family_wipe(
        loser_id,
        wiped_at=now,
        member_rows=members,
    )
    if not claimed_family:
        return
    loser_family = claimed_family
    if not winner_family:
        await clear_or_transfer_state_head_on_wipe(loser_id, winner_id)
        await db.families.update_one(
            {"id": loser_id},
            {
                "$set": {
                    "wiped": True,
                    "wiped_at": now,
                    "wipe_settlement_completed_at": now,
                    "boss_id": None,
                    "head_of_state": None,
                },
                "$unset": {"pending_state_takeover": "", "pending_state_takeover_at": ""},
            },
        )
        for w in active_wars:
            await db.family_wars.update_one(
                {"id": w["id"]},
                {"$set": {"status": "family_a_wins" if winner_id == w["family_a_id"] else "family_b_wins", "ended_at": now, "winner_family_id": winner_id, "loser_family_id": loser_id, "winner_family_name": winner_family_name, "loser_family_name": loser_family_name}},
            )
        return
    winner_boss_id = killer_id if (solo_killer or (killer_id and killer_is_side)) else winner_family.get("boss_id")
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
                if loser_compound_points > 0:
                    await log_points_event(db, user_id=killer_id, points=loser_compound_points, event_type="family_war_loot",
                                           event_ref=f"loser:{loser_id}", meta={"loser_family": loser_family_name})
    else:
        if total_cash_prize > 0:
            await db.families.update_one({"id": winner_id}, {"$inc": {"treasury": total_cash_prize}})
            await log_family_vault_tx(
                db,
                winner_id,
                "war_prize_in",
                "",
                "War spoils",
                cash_delta=total_cash_prize,
                meta={
                    "loser_family_id": loser_id,
                    "loser_family_name": loser_family_name,
                    "loser_treasury": loser_treasury,
                    "prize_racket_cash": prize_racket_cash,
                    "source": "war_kill_resolution",
                },
            )
        if loser_compound_points > 0 or loser_compound_loot_pieces > 0:
            await db.families.update_one(
                {"id": winner_id},
                {"$inc": {"compound_points": loser_compound_points, "compound_loot_pieces": loser_compound_loot_pieces}},
            )

    # Transfer exclusive + loot-exclusive cars from wiped family to the killing blow player (or boss if unknown)
    loser_member_ids = [m["user_id"] for m in members]
    exclusive_cars = await db.user_cars.find({"user_id": {"$in": loser_member_ids}}).to_list(500)
    winner_boss = await db.users.find_one({"id": winner_boss_id}, {"_id": 0, "username": 1}) if winner_boss_id else None
    winner_boss_name = (winner_boss or {}).get("username") or "?"
    prize_car_count = 0
    for uc in exclusive_cars:
        car_info = next((c for c in CARS if c.get("id") == uc.get("car_id")), None)
        rarity = (car_info or {}).get("rarity")
        if rarity not in ("exclusive", "loot_exclusive") or not winner_boss_id:
            continue
        if rarity == "loot_exclusive":
            existing = await db.user_cars.find_one({"user_id": winner_boss_id, "car_id": "car21"}, {"_id": 1})
            if existing and existing.get("_id") != uc.get("_id"):
                await db.user_cars.delete_one({"_id": existing["_id"]})
        new_id = str(uuid.uuid4())
        prev_owner = await db.users.find_one({"id": uc.get("user_id")}, {"_id": 0, "username": 1})
        await db.user_cars.update_one(
            {"_id": uc["_id"]},
            {
                "$set": {"user_id": winner_boss_id, "id": new_id},
                "$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""},
            },
        )
        from utils.exclusive_car_events import log_exclusive_car_event

        await log_exclusive_car_event(
            db,
            event_type="war_family_wipe",
            car_id=uc.get("car_id"),
            user_car_id=new_id,
            previous_user_car_id=uc.get("id"),
            from_user_id=uc.get("user_id"),
            from_username=(prev_owner or {}).get("username"),
            to_user_id=winner_boss_id,
            to_username=winner_boss_name,
            car_name=car_info.get("name"),
            extra={"loser_family_id": loser_id, "winner_family_id": winner_id, "rarity": rarity},
        )
        prize_car_count += 1

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

    await clear_or_transfer_state_head_on_wipe(loser_id, winner_id if not solo_killer else winner_id)

    # Mark victim family as wiped
    family_wiped_set = {
        "wiped": True,
        "wiped_at": now,
        "wipe_settlement_completed_at": now,
        "boss_id": None,
        "head_of_state": None,
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
    await db.families.update_one({"id": loser_id}, {"$set": family_wiped_set, "$unset": {"pending_state_takeover": "", "pending_state_takeover_at": ""}})

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

def user_prestige_rank_mult(user: Optional[dict]) -> float:
    """prestige_rank_multiplier from user doc (synced from PRESTIGE_CONFIGS); safe default 1.0."""
    if not user:
        return 1.0
    try:
        return float(user.get("prestige_rank_multiplier") or 1.0)
    except (TypeError, ValueError):
        return 1.0


def get_rank_info(rank_points: int, prestige_mult: float = 1.0):
    """Street rank from raw rank_points vs RANKS, with each tier threshold scaled by prestige_mult."""
    try:
        rp = int(rank_points)
    except (TypeError, ValueError):
        rp = 0
    try:
        m = float(prestige_mult) if prestige_mult is not None else 1.0
    except (TypeError, ValueError):
        m = 1.0
    if m < 1e-12:
        m = 1.0
    for i in range(len(RANKS) - 1, -1, -1):
        need = int(RANKS[i]["required_points"] * m)
        if rp >= need:
            return RANKS[i]["id"], RANKS[i]["name"]
    return 1, RANKS[0]["name"]


def effective_player_kill_count(user: Optional[Dict]) -> int:
    """Kills that count toward player stats: real players + robot bodyguards.
    Hitlist NPCs (non-bodyguard) do not count; see migrate_kills_exclude_npc.py.

    v1: total_kills is the canonical count from migration / live increments; if it ever
    lags robot_bodyguard_kills, take the max so bodyguard kills still display.

    Legacy: total_kills may have mixed semantics; adjust with hitlist_npc_kills and
    robot_bodyguard_kills (same as pre-v1 behaviour)."""
    if not user:
        return 0
    try:
        raw = int(user.get("total_kills") or 0)
    except (TypeError, ValueError):
        raw = 0
    try:
        hn = int(user.get("hitlist_npc_kills") or 0)
    except (TypeError, ValueError):
        hn = 0
    try:
        rbg = int(user.get("robot_bodyguard_kills") or 0)
    except (TypeError, ValueError):
        rbg = 0
    if user.get("total_kills_excludes_npc_v1"):
        return max(0, raw, rbg)
    return max(0, raw - hn + rbg)


def mongodb_effective_kill_count_expr() -> dict:
    """Same rules as effective_player_kill_count (for $expr / honours ranking)."""
    raw_e = {"$ifNull": ["$total_kills", 0]}
    hn_e = {"$ifNull": ["$hitlist_npc_kills", 0]}
    rbg_e = {"$ifNull": ["$robot_bodyguard_kills", 0]}
    return {
        "$cond": [
            {"$eq": [{"$ifNull": ["$total_kills_excludes_npc_v1", False]}, True]},
            {"$max": [0, {"$max": [raw_e, rbg_e]}]},
            {"$max": [0, {"$add": [{"$subtract": [raw_e, hn_e]}, rbg_e]}]},
        ]
    }


# Floor for owner-set max bet across casino routers (matches set-max-bet handlers).
CASINO_MIN_OWNER_MAX_BET = 50_000


def effective_public_casino_max_bet(owner_id, stored_max_bet, *, default_when_owned_positive: int) -> int:
    """
    No owner: public play is capped at CASINO_MIN_OWNER_MAX_BET only (no one backs larger limits).
    Owned: preserve explicit max_bet, including 0 after a buy-back; missing/invalid legacy rows use default.
    """
    oid = owner_id
    if oid is None or oid == "":
        return int(CASINO_MIN_OWNER_MAX_BET)
    if stored_max_bet is None:
        return int(default_when_owned_positive)
    try:
        raw = int(stored_max_bet)
    except (TypeError, ValueError):
        return int(default_when_owned_positive)
    return max(0, int(raw))


async def maybe_auto_relinquish_below_capo(coll, filter_dict: dict, *, reset_casino_max_bet: bool = False):
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
        set_doc = {"owner_id": None, "owner_username": None}
        if reset_casino_max_bet:
            set_doc["max_bet"] = CASINO_MIN_OWNER_MAX_BET
        await coll.update_one(
            filter_dict,
            {"$set": set_doc, "$unset": {"below_capo_acquired_at": 1}},
        )


def casino_ownership_write_below_capo_ops(owner_set: dict, *, new_owner_rank_id: int) -> dict:
    """Mongo update for assigning casino ownership: below-Capo gets a fresh timer; Capo+ clears stale below_capo_acquired_at."""
    s = dict(owner_set)
    if new_owner_rank_id < CAPO_RANK_ID:
        s["below_capo_acquired_at"] = datetime.now(timezone.utc)
        return {"$set": s}
    return {"$set": s, "$unset": {"below_capo_acquired_at": ""}}


def get_wealth_rank(money: int | float) -> tuple[int, str, str]:
    """Get wealth rank based on cash on hand. Returns (id, name, color_hex)."""
    m = int(money) if money is not None else 0
    for i in range(len(WEALTH_RANKS) - 1, -1, -1):
        if m >= WEALTH_RANKS[i]["min_money"]:
            r = WEALTH_RANKS[i]
            return r["id"], r["name"], r.get("color", "#64748b")
    r0 = WEALTH_RANKS[0]
    return r0["id"], r0["name"], r0.get("color", "#64748b")


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
        reward_parts = [f"{total_bullets:,} bullets"]
        if total_respect > 0:
            reward_parts.append(f"{total_respect:,} respect")
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


async def maybe_process_rank_up(user_id: str, rank_points_before, rank_points_added, username: str = "", prestige_mult: float = 1.0):
    """If rank increased after adding rank_points_added to rank_points_before, grant rewards and send notification."""
    try:
        rank_points_added = float(rank_points_added)
        rank_points_before = float(rank_points_before)
    except (TypeError, ValueError):
        return
    if rank_points_added <= 0:
        return
    new_total = rank_points_before + rank_points_added
    # Scale thresholds from prestige_level, not prestige_rank_multiplier alone. Denormalized multiplier
    # can stay stale on users who never hit get_current_user() sync (e.g. Auto Rank background runs),
    # which made prestiged players' computed rank not advance here → no rank-up inbox message.
    try:
        row = await db.users.find_one({"id": user_id}, {"prestige_level": 1})
        pl = int((row or {}).get("prestige_level") or 0)
        pm = float(get_rank_threshold_mult(pl))
    except Exception:
        try:
            pm = float(prestige_mult) if prestige_mult is not None else 1.0
        except (TypeError, ValueError):
            pm = 1.0
    if pm < 1e-12:
        pm = 1.0
    old_rank_id, _ = get_rank_info(int(rank_points_before), pm)
    new_rank_id, _ = get_rank_info(int(new_total), pm)
    if new_rank_id > old_rank_id:
        await check_and_process_rank_up(user_id, old_rank_id, new_rank_id, username)


# Auth and profile endpoints -> routers/auth.py, routers/profile.py
# Dead-alive, users/online -> routers/dead_alive.py, routers/users.py

# Stats endpoints -> routers/stats.py

# Admin access: set ADMIN_EMAILS env (comma-separated) in production to avoid hardcoded list in repo
_raw = (os.environ.get("ADMIN_EMAILS") or "").strip()
ADMIN_EMAILS = [e.strip().lower() for e in _raw.split(",") if e.strip()] if _raw else []

# Moderator emails (same shape as ADMIN_EMAILS): grants moderator API/UI powers by email without DB is_moderator.
# MODERATOR_EMAILS is an accepted alias for MOD_EMAILS.
_raw_mod = (os.environ.get("MOD_EMAILS") or os.environ.get("MODERATOR_EMAILS") or "").strip()
MOD_EMAILS = [e.strip().lower() for e in _raw_mod.split(",") if e.strip()] if _raw_mod else []

# Emails excluded from admin cheat-detection batch queries and shown synthetic IP-check data (comma-separated, lowercased).
_dupe_exempt_raw = (os.environ.get("DUPE_DETECTION_EXEMPT_EMAILS") or "").strip()
DUPE_DETECTION_EXEMPT_EMAILS = (
    [e.strip().lower() for e in _dupe_exempt_raw.split(",") if e.strip()] if _dupe_exempt_raw else []
)


def _dupe_exempt_email_nor_clauses() -> List[dict]:
    from utils.staff_mod_protection import dupe_exempt_email_nor_clauses as _clauses

    return _clauses()


def user_has_dupe_exempt_email(user: Optional[dict]) -> bool:
    from utils.staff_mod_protection import user_has_dupe_exempt_email as _has

    return _has(user)


def cheat_detection_users_match(extra: Optional[dict] = None) -> dict:
    """Alive non-NPC users, excluding DUPE_DETECTION_EXEMPT_EMAILS — for admin/mod cheat batch endpoints."""
    base = {"is_dead": {"$ne": True}, "is_npc": {"$ne": True}}
    parts: List[dict] = [base]
    nor_clauses = _dupe_exempt_email_nor_clauses()
    if nor_clauses:
        parts.append({"$nor": nor_clauses})
    if extra:
        parts.append(extra)
    if len(parts) == 1:
        return parts[0]
    return {"$and": parts}


def cheat_detection_aggregate_first_match() -> dict:
    """First $match for admin find-duplicates pipeline (legacy: alive filter not applied here)."""
    nor_clauses = _dupe_exempt_email_nor_clauses()
    base = {"is_npc": {"$ne": True}}
    if not nor_clauses:
        return base
    return {"$and": [base, {"$nor": nor_clauses}]}


def cheat_detection_find_duplicates_username_match(username_regex) -> dict:
    """Username contains search on find-duplicates, excluding dupe-exempt emails."""
    nor_clauses = _dupe_exempt_email_nor_clauses()
    parts: List[dict] = [{"username": username_regex, "is_npc": {"$ne": True}}]
    if nor_clauses:
        parts.append({"$nor": nor_clauses})
    if len(parts) == 1:
        return parts[0]
    return {"$and": parts}


async def log_activity(user_id: str, username: str, action: str, details: dict):
    """Append to activity_log for admin monitoring (crimes, forum, etc.)."""
    try:
        now = datetime.now(timezone.utc)
        await db.activity_log.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "username": username,
            "action": action,
            "details": details,
            "created_at": now,
        })
        a = (action or "").strip().lower()
        domain = "other"
        value = 1.0
        if a.startswith("booze_") or "booze" in a:
            domain = "booze_run"
            value = float((details or {}).get("profit") or (details or {}).get("cash") or 1)
        elif a.startswith("crime") or a.startswith("oc_") or a.startswith("gta") or "jail" in a:
            domain = "crime_suite"
            value = float((details or {}).get("profit") or (details or {}).get("cash") or 1)
        elif a.startswith("minigame_") or "minigame" in a:
            domain = "minigames"
            value = float((details or {}).get("score") or 1)
        elif a.startswith("attack") or a.startswith("family_") or "racket" in a or "war" in a:
            domain = "combat_family"
        elif a.startswith("store_") or "token" in a or "buy_" in a:
            domain = "store"
            value = float((details or {}).get("points_spent") or (details or {}).get("cost") or 1)
        elif "transfer" in a or "economy" in a or "bank" in a:
            domain = "economy"
            value = float((details or {}).get("amount") or (details or {}).get("profit") or 1)
        await log_analytics_event(
            db,
            user_id=user_id,
            username=username,
            domain=domain,
            metric=(a or "activity")[:64],
            value=value,
            tags={"source": "activity_log"},
            created_at=now,
        )
    except Exception:
        pass


async def log_minigame_payout(user_id: str, username: str, game: str, score, rewards: dict):
    """Log every individual minigame play payout for admin auditing."""
    try:
        now = datetime.now(timezone.utc)
        await db.minigame_play_payouts.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "username": username,
            "game": game,
            "score": score,
            "rewards": rewards,
            "created_at": now,
        })
        reward_total = float(
            (rewards or {}).get("money", 0)
            + (rewards or {}).get("respect_points", 0)
            + (rewards or {}).get("bullets", 0)
            + (rewards or {}).get("loot_box_pieces", 0)
        )
        await log_analytics_event(
            db,
            user_id=user_id,
            username=username,
            domain="minigames",
            metric=f"payout_{(game or 'unknown')[:40]}",
            value=reward_total if reward_total > 0 else 1,
            tags={"game": game, "source": "minigame_play_payouts"},
            created_at=now,
        )
    except Exception:
        pass


async def log_gambling(user_id: str, username: str, game_type: str, details: dict):
    """Append to gambling_log for admin anti-cheat monitoring. Used by all casinos: blackjack, slots, roulette, dice, videopoker, horseracing, sports_bet, mdg."""
    try:
        now = datetime.now(timezone.utc)
        await db.gambling_log.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "username": username,
            "game_type": game_type,
            "details": details,
            "created_at": now,
        })
        stake = float(
            (details or {}).get("stake")
            or (details or {}).get("bet")
            or (details or {}).get("buy_in")
            or 0
        )
        payout = float((details or {}).get("payout") or (details or {}).get("winnings") or 0)
        profit = payout - stake
        await log_analytics_event(
            db,
            user_id=user_id,
            username=username,
            domain="casino",
            metric=f"play_{(game_type or 'unknown')[:40]}",
            value=profit if profit != 0 else 1,
            tags={"game_type": game_type, "stake": stake, "payout": payout},
            created_at=now,
        )
    except Exception:
        pass


async def resolve_gambling_log_buy_back(offer_id: str, outcome: str, points_credited: int) -> None:
    """Patch gambling_log row created on casino seizure win (details.buy_back_offer_id) when player accepts/rejects buy-back."""
    if not offer_id:
        return
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.gambling_log.update_one(
            {"details.buy_back_offer_id": offer_id},
            {
                "$set": {
                    "details.buy_back_outcome": outcome,
                    "details.buy_back_points_credited": int(points_credited or 0),
                    "details.buy_back_resolved_at": now_iso,
                }
            },
        )
    except Exception:
        pass


def _is_admin(user: dict) -> bool:
    """True if user has admin email and is not currently acting as normal user or mod preview."""
    em = str(user.get("email") or "").strip().lower()
    if user.get("admin_acting_as_normal", False):
        return False
    try:
        from utils.staff_mod_protection import admin_mod_preview_active

        if admin_mod_preview_active(user):
            return False
    except Exception:
        pass
    return bool(em and em in ADMIN_EMAILS)


def user_has_mod_list_email(user: Optional[dict]) -> bool:
    """True if user's email is listed in MOD_EMAILS / MODERATOR_EMAILS (env; compare case-insensitive)."""
    if not user:
        return False
    em = str(user.get("email") or "").strip().lower()
    return bool(em and em in (MOD_EMAILS or []))


def _is_moderator(user: dict) -> bool:
    """True if user is promoted in DB, MOD_EMAILS, or an admin in temporary mod-preview mode."""
    try:
        from utils.staff_mod_protection import admin_mod_preview_active

        if admin_mod_preview_active(user) and user_has_admin_list_email(user):
            return True
    except Exception:
        pass
    return bool(user.get("is_moderator")) or user_has_mod_list_email(user)


def _is_hdo(user: dict) -> bool:
    """True if user is a Help Desk Operator. HDOs can reply to and close help desk tickets; they appear dark green on Users Online."""
    return bool(user.get("is_help_desk_operator"))


def _is_entertainer(user: dict) -> bool:
    """True if user is an Entertainer (sponsor fund for MDG / MP Poker; badge on Users Online)."""
    return bool(user.get("is_entertainer"))


def _admin_or_mod(user: dict) -> bool:
    """True if full admin (listed email, not act-as-normal) or moderator (DB flag or MOD_EMAILS)."""
    return _is_admin(user) or _is_moderator(user)


STAFF_LOGIN_REQUIRED_DETAIL = (
    "Staff login required. Sign out and use the staff entrance (staff login) to use admin or moderator tools."
)


def require_staff_issued_if_staff_capable(user: dict) -> None:
    """403 unless JWT from staff login when user is admin-listed or a moderator (DB / MOD_EMAILS).

    Covers tool routes whose URL is not under /api/.../admin/... (path-based gating in get_current_user).
    Also invoked from require_admin* for defense in depth.
    """
    if user_has_admin_list_email(user) or _is_moderator(user):
        if not user.get("_jwt_staff_issued"):
            raise HTTPException(status_code=403, detail=STAFF_LOGIN_REQUIRED_DETAIL)


async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency: 403 unless _is_admin (not available to act-as-normal or non-listed users)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    require_staff_issued_if_staff_capable(current_user)
    return current_user


async def require_admin_or_mod(current_user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency: 403 unless admin or moderator."""
    if not _admin_or_mod(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    require_staff_issued_if_staff_capable(current_user)
    return current_user


async def require_admin_verified(current_user: dict = Depends(get_current_user_verified)) -> dict:
    """403 unless _is_admin; chains email-verified user (same rules as get_current_user_verified)."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    require_staff_issued_if_staff_capable(current_user)
    return current_user


async def require_admin_or_mod_verified(current_user: dict = Depends(get_current_user_verified)) -> dict:
    """403 unless admin or moderator; chains email-verified user."""
    if not _admin_or_mod(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    require_staff_issued_if_staff_capable(current_user)
    return current_user


def _staff_exclude_user_filter() -> dict:
    """Mongo match dict to exclude admin/mod accounts from queries on the users collection.

    Used by profile honours, /leaderboards/top, stats, etc. Admin emails must match case-insensitively
    (same as _is_admin / lottery); raw $nin missed mixed-case emails in the DB.
    """
    q: dict = {"is_moderator": {"$ne": True}}
    staff_emails = sorted(
        {
            e.strip().lower()
            for e in list(ADMIN_EMAILS or []) + list(MOD_EMAILS or [])
            if e and str(e).strip()
        }
    )
    if staff_emails:
        q["$nor"] = [{"email": re.compile("^" + re.escape(e) + "$", re.IGNORECASE)} for e in staff_emails]
    return q


def alive_real_player_wallet_match() -> dict:
    """Alive, non-NPC users excluding staff — same segment as ``/stats/overview`` wallet portion of ``game_capital.total_cash``."""
    return {"is_npc": {"$ne": True}, "is_dead": {"$ne": True}, **_staff_exclude_user_filter()}


def user_has_admin_list_email(user: dict) -> bool:
    """True if user's email matches ADMIN_EMAILS (env list is lowercased; compare case-insensitive)."""
    em = str(user.get("email") or "").strip().lower()
    return bool(em and em in (ADMIN_EMAILS or []))


def _user_excluded_from_stat_leaderboards(user: dict) -> bool:
    """True if this account is excluded from /leaderboards/top and stat honours (mods + ADMIN_EMAILS)."""
    return _is_moderator(user) or user_has_admin_list_email(user)


def expand_user_ids_for_mongo_nin(raw_ids) -> list:
    """Dedupe user ids and add int/str variants so ``$nin`` matches ``users.id`` whether stored as string or int."""
    out: list = []
    seen = set()

    def _push(x):
        if x is None or x in seen:
            return
        seen.add(x)
        out.append(x)

    for uid in raw_ids or []:
        _push(uid)
        if isinstance(uid, str) and uid.strip().lstrip("-").isdigit():
            try:
                _push(int(uid.strip(), 10))
            except ValueError:
                pass
        elif isinstance(uid, (int, float)) and not isinstance(uid, bool):
            try:
                _push(str(int(uid)))
            except (ValueError, TypeError, OverflowError):
                pass
    return out


async def _get_mod_env_user_ids(database=None) -> list:
    """User IDs for accounts whose email is in MOD_EMAILS (env), excluding DB flag handling."""
    dd = db if database is None else database
    mod_emails = [e.strip().lower() for e in (MOD_EMAILS or []) if e and str(e).strip()]
    if not mod_emails:
        return []
    or_clauses = [{"email": re.compile("^" + re.escape(e) + "$", re.IGNORECASE)} for e in mod_emails]
    cursor = dd.users.find({"$or": or_clauses}, {"_id": 0, "id": 1})
    return [u["id"] for u in await cursor.to_list(200)]


async def _get_staff_user_ids(database=None) -> list:
    """Return user IDs of all admin and moderator accounts (for excluding from non-users collections)."""
    d = db if database is None else database
    mod_ids = [u["id"] for u in await d.users.find({"is_moderator": True}, {"_id": 0, "id": 1}).to_list(500)]
    admin_ids = await _get_admin_user_ids(d)
    mod_env_ids = await _get_mod_env_user_ids(d)
    out: list = []
    seen = set()
    for uid in mod_ids + admin_ids + mod_env_ids:
        if uid and uid not in seen:
            seen.add(uid)
            out.append(uid)
    return out


async def honours_stat_excluded_user_ids(database=None) -> list:
    """User ids excluded from profile honour rank counts and public stat boards (mods + MOD_EMAILS + ADMIN_EMAILS).

    Includes BSON type variants so ``$nin`` cannot miss staff rows when ``users.id`` is int vs str.
    """
    d = db if database is None else database
    raw = await _get_staff_user_ids(d)
    return expand_user_ids_for_mongo_nin(raw)


async def stat_leaderboard_users_match(*, dead: bool, database=None) -> dict:
    """Single Mongo match dict for public stat leaderboards and profile honours (same player pool)."""
    d = db if database is None else database
    if dead:
        m: dict = {"is_dead": True, "is_bodyguard": {"$ne": True}, "is_npc": {"$ne": True}}
    else:
        m = {"is_dead": {"$ne": True}, "is_bodyguard": {"$ne": True}, "is_npc": {"$ne": True}}
    m.update(_staff_exclude_user_filter())
    ex = await honours_stat_excluded_user_ids(d)
    if ex:
        m["id"] = {"$nin": ex}
    return m


async def _get_admin_user_ids(database=None) -> list:
    """Return user IDs for accounts in ADMIN_EMAILS (game admins only)."""
    d = db if database is None else database
    admin_emails = [e.strip().lower() for e in (ADMIN_EMAILS or []) if e and str(e).strip()]
    if not admin_emails:
        return []
    or_clauses = [{"email": re.compile("^" + re.escape(e) + "$", re.IGNORECASE)} for e in admin_emails]
    cursor = d.users.find({"$or": or_clauses}, {"_id": 0, "id": 1})
    return [u["id"] for u in await cursor.to_list(200)]


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


def _parse_kill_inflation_updated_at(val, *, now: datetime) -> Optional[datetime]:
    """Parse kill_inflation_updated_at from ISO string or BSON datetime."""
    if val is None or val == "":
        return None
    if hasattr(val, "year"):
        dt = val
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    try:
        s = str(val).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return None


async def _last_successful_kill_at(user_id: str, *, now: datetime) -> Optional[datetime]:
    """Most recent player/NPC kill by this attacker (attack_attempts)."""
    row = await db.attack_attempts.find_one(
        {"attacker_id": user_id, "outcome": "killed"},
        {"_id": 0, "created_at": 1},
        sort=[("created_at", -1)],
    )
    if not row:
        return None
    dt = _parse_kill_inflation_updated_at(row.get("created_at"), now=now)
    if dt and dt > now:
        return now
    return dt


async def _apply_kill_inflation_decay(user_id: str) -> float:
    """
    Inflation system:
    - Each kill increases inflation by ~2–4% (handled elsewhere).
    - If no kills happen, inflation decays by ~3–6% per hour.
    - Decay is applied lazily when attack endpoints (or /auth/me) run.
    - No upper limit.
    """
    now = datetime.now(timezone.utc)
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "kill_inflation": 1, "kill_inflation_updated_at": 1})
    if not user:
        return 0.0

    inflation = float(user.get("kill_inflation", 0.0) or 0.0)
    if inflation <= 0:
        if user.get("kill_inflation_updated_at") is None:
            await db.users.update_one(
                {"id": user_id},
                {"$set": {"kill_inflation": 0.0, "kill_inflation_updated_at": now.isoformat()}},
            )
        return 0.0

    updated_at = _parse_kill_inflation_updated_at(user.get("kill_inflation_updated_at"), now=now)
    if updated_at is None:
        updated_at = now - timedelta(days=30)
    elif updated_at > now:
        updated_at = now

    hours = int((now - updated_at).total_seconds() // 3600)

    # Heal stuck inflation: an old bug reset kill_inflation_updated_at to "now" without decaying.
    last_kill_at = await _last_successful_kill_at(user_id, now=now)
    if (
        last_kill_at
        and inflation > 1.0
        and hours < 1
        and (now - last_kill_at).total_seconds() >= 3 * 86400
    ):
        hours = int((now - last_kill_at).total_seconds() // 3600)

    if hours <= 0:
        return inflation

    hours = min(hours, 24 * 90)

    new_inflation = inflation
    for _ in range(hours):
        new_inflation = max(0.0, new_inflation - random.uniform(0.03, 0.06))

    new_ts = now.isoformat()
    if abs(new_inflation - inflation) > 1e-9:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"kill_inflation": new_inflation, "kill_inflation_updated_at": new_ts}},
        )
    return new_inflation

async def _increase_kill_inflation_on_kill(user_id: str) -> float:
    """Increase inflation by ~2–4% on a successful kill (half rate with Slow Kill Inflation perk)."""
    now = datetime.now(timezone.utc)
    inc = random.uniform(0.02, 0.04)
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "kill_inflation": 1, "slow_kill_inflation_until": 1},
    )
    until_raw = (user or {}).get("slow_kill_inflation_until")
    if until_raw:
        try:
            until_dt = datetime.fromisoformat(str(until_raw).replace("Z", "+00:00"))
            if until_dt.tzinfo is None:
                until_dt = until_dt.replace(tzinfo=timezone.utc)
            if until_dt > now:
                inc *= 0.5
        except (ValueError, TypeError):
            pass
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
    ]
    if SLOTS_FEATURE_ENABLED:
        casino_colls.append(("slots", db.slots_ownership))
    # Parallel: all 6 casino ownerships + airport + armoury (bullet_factory)
    async def fetch_casino(game_type, coll):
        return await coll.find_one({"owner_id": user_id}, {"_id": 0, "total_earnings": 1, "profit": 1, "expires_at": 1})

    casino_tasks = [fetch_casino(gt, c) for gt, c in casino_colls]
    airport_task = db.airport_ownership.find_one({"owner_id": user_id}, {"_id": 0, "state": 1, "slot": 1, "price_per_travel": 1, "total_earnings": 1})
    bullet_task = db.bullet_factory.find_one({"owner_id": user_id}, {"_id": 0, "state": 1, "price_per_bullet": 1, "owner_pending_profit_points": 1})
    results = await asyncio.gather(*casino_tasks, airport_task, bullet_task)
    n_casino = len(casino_colls)
    casino_docs = results[:n_casino]
    airport_doc, bullet_doc = results[n_casino], results[n_casino + 1]

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

    airport_points = int((airport_doc or {}).get("total_earnings") or 0)
    armoury_points = int((bullet_doc or {}).get("owner_pending_profit_points") or 0)
    if airport_doc:
        prop = {"type": "airport", "state": airport_doc.get("state"), "slot": airport_doc.get("slot", 1), "price_per_travel": airport_doc.get("price_per_travel"), "total_earnings": airport_doc.get("total_earnings", 0)}
    elif bullet_doc:
        prop = {"type": "bullet_factory", "state": bullet_doc.get("state"), "price_per_bullet": bullet_doc.get("price_per_bullet"), "total_earnings": armoury_points}
    else:
        prop = None
    property_pts = airport_points + armoury_points
    has_property = bool(airport_doc or bullet_doc)
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


async def assert_casino_buy_back_within_points_balance(user_id: str, amount: int) -> None:
    """Legacy check: full buy-back amount vs balance. Prefer adjust_casino_buy_back_escrow for real holds."""
    if amount <= 0:
        return
    row = await db.users.find_one({"id": user_id}, {"points": 1})
    balance = int((row or {}).get("points") or 0)
    if amount > balance:
        raise HTTPException(
            status_code=400,
            detail=f"Buy-back reward cannot exceed your points balance ({balance:,}).",
        )


async def adjust_casino_buy_back_escrow(
    user_id: str,
    old_held: int,
    new_held: int,
    *,
    event_type: str,
    meta: Dict[str, Any],
) -> None:
    """
    Move points in/out of the owner's wallet for casino buy-back escrow.
    old_held / new_held come from ownership doc buy_back_points_held (0 if missing).
    """
    if not user_id:
        return
    old_a = max(0, int(old_held or 0))
    new_a = max(0, int(new_held or 0))
    delta = new_a - old_a
    if delta == 0:
        return
    if delta > 0:
        res = await db.users.find_one_and_update(
            {"id": user_id, "points": {"$gte": delta}},
            {"$inc": {"points": -delta}},
        )
        if not res:
            raise HTTPException(
                status_code=400,
                detail=f"You need {delta:,} more points to increase buy-back (those points are held until you lower buy-back, lose the casino, or the buy-back offer is resolved).",
            )
        bal_before = int(res.get("points") or 0)
        bal_after = bal_before - delta
        await log_points_event(
            db,
            user_id=user_id,
            points=-delta,
            event_type=event_type,
            event_ref="buyback_hold",
            meta={
                "action": "buyback_hold",
                **meta,
                "from_held": old_a,
                "to_held": new_a,
                "wallet_balance_before": bal_before,
                "wallet_balance_after": bal_after,
            },
        )
    else:
        refund = -delta
        u0 = await db.users.find_one({"id": user_id}, {"points": 1})
        bal_before = int((u0 or {}).get("points") or 0)
        await db.users.update_one({"id": user_id}, {"$inc": {"points": refund}})
        bal_after = bal_before + refund
        await log_points_event(
            db,
            user_id=user_id,
            points=refund,
            event_type=event_type,
            event_ref="buyback_release",
            meta={
                "action": "buyback_release",
                **meta,
                "from_held": old_a,
                "to_held": new_a,
                "wallet_balance_before": bal_before,
                "wallet_balance_after": bal_after,
            },
        )


async def refund_casino_buy_back_escrow_points(
    user_id: str,
    amount: int,
    *,
    event_type: str,
    meta: Dict[str, Any],
) -> None:
    pts = max(0, int(amount or 0))
    if not user_id or pts <= 0:
        return
    u0 = await db.users.find_one({"id": user_id}, {"points": 1})
    bal_before = int((u0 or {}).get("points") or 0)
    await db.users.update_one({"id": user_id}, {"$inc": {"points": pts}})
    bal_after = bal_before + pts
    await log_points_event(
        db,
        user_id=user_id,
        points=pts,
        event_type=event_type,
        event_ref="buyback_refund",
        meta={
            "action": "buyback_refund",
            **meta,
            "amount": pts,
            "wallet_balance_before": bal_before,
            "wallet_balance_after": bal_after,
        },
    )


async def log_casino_buyback_credit_points(
    user_id: str,
    points_offered: int,
    event_type: str,
    offer_id: str,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    """After wallet credit for accepting a prior owner's buy-back, log with wallet before/after (caller must have applied $inc already)."""
    pts = int(points_offered or 0)
    if not user_id or pts <= 0:
        return
    u = await db.users.find_one({"id": user_id}, {"points": 1})
    bal_after = int((u or {}).get("points") or 0)
    bal_before = bal_after - pts
    m = dict(meta or {})
    m.setdefault("offer_id", offer_id)
    m["action"] = "buyback_credit"
    m["wallet_balance_before"] = bal_before
    m["wallet_balance_after"] = bal_after
    await log_points_event(
        db,
        user_id=user_id,
        points=pts,
        event_type=event_type,
        event_ref=f"buyback:{offer_id}",
        meta=m,
    )


async def refund_and_delete_buy_back_offers_matching(
    collection_name: str,
    match: Dict[str, Any],
    *,
    points_event_type: str,
    meta_base: Dict[str, Any],
) -> int:
    """Refund escrow to each offer's from_owner_id, then delete those offers. Returns number of offers removed."""
    coll = db[collection_name]
    offers = await coll.find(match, {"_id": 0, "id": 1, "from_owner_id": 1, "points_offered": 1}).to_list(500)
    for off in offers:
        await refund_casino_buy_back_escrow_points(
            str(off.get("from_owner_id") or ""),
            int(off.get("points_offered") or 0),
            event_type=points_event_type,
            meta={**meta_base, "offer_id": off.get("id")},
        )
    ids = [o["id"] for o in offers if o.get("id")]
    if ids:
        await coll.delete_many({"id": {"$in": ids}})
    return len(offers)


def _assert_casino_has_no_buy_back_escrow(ownership_doc: Optional[Dict[str, Any]], *, detail: str) -> None:
    r = int((ownership_doc or {}).get("buy_back_reward") or 0)
    h = int((ownership_doc or {}).get("buy_back_points_held") or 0)
    if r > 0 or h > 0:
        raise HTTPException(status_code=400, detail=detail)


def assert_casino_clear_of_buy_back_for_listing(ownership_doc: Optional[Dict[str, Any]]) -> None:
    """Casino Quick Trade listings require buy-back cleared so held points are released first."""
    _assert_casino_has_no_buy_back_escrow(
        ownership_doc,
        detail="Remove buy-back before listing this casino on Quick Trade (releases your held points).",
    )


def assert_casino_clear_of_buy_back_for_relinquish(ownership_doc: Optional[Dict[str, Any]]) -> None:
    """Relinquish is blocked until buy-back is cleared (owner must release held points first)."""
    _assert_casino_has_no_buy_back_escrow(
        ownership_doc,
        detail="Remove buy-back before relinquishing this casino (releases your held points).",
    )


async def _iter_user_casino_summaries(user_id: str):
    """Yield each owned casino summary (dice → … → slots order). Used for one-casino rule checks and listing."""
    if not user_id:
        return
    for game_type, coll in [
        ("dice", db.dice_ownership),
        ("roulette", db.roulette_ownership),
        ("blackjack", db.blackjack_ownership),
        ("horseracing", db.horseracing_ownership),
        ("videopoker", db.videopoker_ownership),
        *([("slots", db.slots_ownership)] if SLOTS_FEATURE_ENABLED else []),
    ]:
        doc = await coll.find_one({"owner_id": user_id}, {"_id": 0, "city": 1, "state": 1, "max_bet": 1, "buy_back_reward": 1, "total_earnings": 1, "profit": 1, "expires_at": 1, "odds_preset": 1})
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
            out: Dict[str, Any] = {"type": game_type, "city": doc.get("city") or doc.get("state"), "max_bet": doc.get("max_bet")}
            if game_type == "videopoker":
                raw_odds = str((doc.get("odds_preset") or "tight")).strip().lower()
                out["odds_preset"] = raw_odds if raw_odds in ("tight", "normal", "increased", "enhanced") else "tight"
            if doc.get("buy_back_reward") is not None:
                out["buy_back_reward"] = doc.get("buy_back_reward")
            profit_val = doc.get("profit") if doc.get("profit") is not None else doc.get("total_earnings")
            out["profit"] = int(profit_val or 0)
            yield out


async def _user_owns_all_casinos(user_id: str) -> List[Dict[str, Any]]:
    """All casino rows owned by this user (normally 0 or 1; duplicates are a bug / legacy edge case)."""
    return [out async for out in _iter_user_casino_summaries(user_id)]


async def _user_owns_any_casino(user_id: str):
    """Return first casino owned by user: {type, city, max_bet, buy_back_reward?, profit?} or None. Rule: 1 casino only. profit is $ (total_earnings or profit field)."""
    async for out in _iter_user_casino_summaries(user_id):
        return out
    return None


def raise_if_dead_casino_transfer_target(target: Optional[dict]) -> None:
    """Dead characters cannot receive casino ownership (venue would be unusable / stuck)."""
    if target and target.get("is_dead"):
        raise HTTPException(status_code=400, detail="That player is dead and cannot receive a casino.")


from routers.casinos.dice import DICE_MAX_BET, DiceSellOnTradeRequest  # used by CASINO_GAMES and roulette/blackjack/horseracing sell-on-trade
from routers.casinos.roulette import ROULETTE_MAX_BET, RouletteClaimRequest, RouletteSetMaxBetRequest, RouletteSendToUserRequest  # CASINO_GAMES, blackjack/horseracing reuse these models
from routers.casinos.blackjack import BLACKJACK_MAX_BET  # CASINO_GAMES
from routers.casinos.horseracing import HORSERACING_MAX_BET  # CASINO_GAMES
from routers.casinos.slots import SLOTS_MAX_BET, SLOTS_FEATURE_ENABLED  # CASINO_GAMES
from routers.casinos.video_poker import VIDEO_POKER_MAX_BET  # CASINO_GAMES


async def _user_owns_airport(user_id: str):
    """Return airport slot owned by user or None. Max one airport (any state) per account for claim rules."""
    doc = await db.airport_ownership.find_one({"owner_id": user_id}, {"_id": 0, "state": 1, "slot": 1, "price_per_travel": 1, "total_earnings": 1})
    if doc:
        return {
            "type": "airport",
            "state": doc.get("state"),
            "slot": doc.get("slot", 1),
            "price_per_travel": doc.get("price_per_travel"),
            "total_earnings": doc.get("total_earnings", 0),
        }
    return None


async def _user_owns_bullet_factory(user_id: str):
    """Return bullet factory (armoury) owned by user or None. Max one armoury per account."""
    doc = await db.bullet_factory.find_one({"owner_id": user_id}, {"_id": 0, "state": 1, "price_per_bullet": 1, "owner_pending_profit_points": 1})
    if doc:
        state = doc.get("state")
        if state:
            await maybe_auto_relinquish_below_capo(db.bullet_factory, {"state": state})
        doc = await db.bullet_factory.find_one({"owner_id": user_id}, {"_id": 0, "state": 1, "price_per_bullet": 1, "owner_pending_profit_points": 1})
        if doc:
            return {
                "type": "bullet_factory",
                "state": doc.get("state"),
                "price_per_bullet": doc.get("price_per_bullet"),
                "total_earnings": int(doc.get("owner_pending_profit_points") or 0),
            }
    return None


async def _user_owns_garage_dealership(user_id: str):
    """Return global car dealership owned by user or None. Max one per account."""
    from utils.garage_dealership import user_owns_garage_dealership
    return await user_owns_garage_dealership(db, user_id)


async def _user_owns_sports_betting_book(user_id: str):
    """Return global sports betting book owned by user or None. Max one per account."""
    from utils.sports_betting_ownership import user_owns_sports_betting_book
    return await user_owns_sports_betting_book(db, user_id)


async def _user_owns_any_property(user_id: str):
    """Return one owned major property for legacy callers: airport first, else armoury. Users may hold both."""
    air = await _user_owns_airport(user_id)
    if air:
        return air
    return await _user_owns_bullet_factory(user_id)


# Crime endpoints -> see routers/crime/crimes.py
# Register modular routers (organized by subfolder)
from routers.account import auth, profile, prestige, user_progress, users
from routers.admin import admin, security_admin, airport, investigate
from routers.cars import gta
from routers.casinos import dice, roulette, blackjack, mp_blackjack, mp_poker, mp_8ball, horseracing, slots, keno, coin_flip, video_poker, mdg, sports_betting
from routers.crime import crimes, jail, organised_crime, oc
from routers.game import families, leaderboard, states, stats, store, dead_alive, events, notifications, meta, entertainer, entertainer_staff, achievements
from routers.kill import attack, armoury, bodyguards, hitlist, witness_statements
from routers.minigames import gauntlet, boxing, racing, snake
from routers.money import bank, stock_market, properties, quicktrade, crack_safe, illegal_business, booze_run, racket, payments, lottery, grave_robber
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
]
if SLOTS_FEATURE_ENABLED:
    CASINO_GAMES.append({"id": "slots", "name": "Slots", "max_bet": SLOTS_MAX_BET})
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
entertainer_staff.register(api_router)
from routers.game import designer_competitions
designer_competitions.register(api_router)
armoury.register(api_router)
objectives.register(api_router)
from routers.account import missions
missions.register(api_router)
from routers.account import tutorial as tutorial_router
tutorial_router.register(api_router)
from routers.money import loot_box
loot_box.register(api_router)
attack.register(api_router)
witness_statements.register(api_router)
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
if SLOTS_FEATURE_ENABLED:
    slots.register(api_router)
keno.register(api_router)
coin_flip.register(api_router)
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
lottery.register(api_router)
grave_robber.register(api_router)
leaderboard.register(api_router)
meta.register(api_router)
user_progress.register(api_router)
states.register(api_router)
events.register(api_router)
security_admin.register(api_router)
investigate.register(api_router)
sports_betting.register(api_router)
from routers.game import world_cup
world_cup.register(api_router)
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

# Minigame routes: same browser-like UA / Sec-Fetch checks as auth (register before SecurityMiddleware so IP/spam runs outer)
try:
    from middleware.minigame_client_middleware import MinigameClientGuardMiddleware

    app.add_middleware(MinigameClientGuardMiddleware, db=db)
except ImportError:
    print("Warning: minigame_client_middleware.py not found - minigame client guard disabled")

# Import security middleware
try:
    from middleware.security_middleware import SecurityMiddleware
    app.add_middleware(SecurityMiddleware, db=db)
except ImportError:
    print("Warning: security_middleware.py not found - rate limiting disabled")

_request_logging_middleware_installed = False
try:
    from middleware.request_logging import RequestLoggingMiddleware

    app.add_middleware(RequestLoggingMiddleware)
    _request_logging_middleware_installed = True
except ImportError:
    pass

try:
    from middleware.staff_access_audit import StaffAccessAuditMiddleware

    app.add_middleware(StaffAccessAuditMiddleware)
except ImportError:
    print("Warning: staff_access_audit middleware not found")

try:
    from middleware.admin_tool_access_log import AdminToolAccessLogMiddleware

    app.add_middleware(AdminToolAccessLogMiddleware)
except ImportError:
    print("Warning: admin_tool_access_log middleware not found")

try:
    from middleware.staff_portal_guard import StaffPortalGuardMiddleware

    app.add_middleware(StaffPortalGuardMiddleware)
except ImportError:
    print("Warning: staff_portal_guard middleware not found")

# Read once for startup: dedupe uvicorn access vs RequestLoggingMiddleware
_REQ_LOG_ENABLED = (os.environ.get("REQUEST_LOGGING_ENABLED") or "1").strip().lower() in ("1", "true", "yes")
_UVICORN_ACCESS_LOG_ENABLED = (os.environ.get("UVICORN_ACCESS_LOG") or "").strip().lower() in ("1", "true", "yes")


def _dedupe_uvicorn_access_log():
    """Drop uvicorn's default access line when our compact RequestLoggingMiddleware is on."""
    if not _request_logging_middleware_installed or not _REQ_LOG_ENABLED or _UVICORN_ACCESS_LOG_ENABLED:
        return
    acc = logging.getLogger("uvicorn.access")
    acc.setLevel(logging.WARNING)
    acc.disabled = True

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
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
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
# httpx/httpcore log every request URL at INFO — Telegram URLs embed the bot token
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)
_dedupe_uvicorn_access_log()

@app.on_event("startup")
async def startup_db():
    # After uvicorn attaches loggers: avoid double line per request (middleware + uvicorn.access).
    _dedupe_uvicorn_access_log()
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
    try:
        from routers.money import booze_run as _booze_run_mod

        await _booze_run_mod.load_booze_globals_from_db()
    except Exception as e:
        logging.warning("Failed to load booze listed-price globals: %s", e)
    from routers.account.profile import ensure_profile_indexes
    from ensure_indexes import ensure_all_indexes
    await ensure_profile_indexes(db)
    await ensure_all_indexes(db)
    try:
        migrated_memorials = await families.migrate_wiped_family_memorials()
        if migrated_memorials:
            logging.info("Frozen %s legacy family memorial roster(s)", migrated_memorials)
    except Exception as e:
        logging.warning("Family memorial migration failed: %s", e)
    asyncio.create_task(families.run_family_wipe_cleanup_ticker())
    try:
        from utils.tutorial import ensure_tutorial_indexes, TUTORIAL_STATUS_SKIPPED

        await ensure_tutorial_indexes(db)
        # Existing accounts without tutorial fields: do not force the new-player tutorial.
        await db.users.update_many(
            {"tutorial_status": {"$exists": False}},
            {"$set": {"tutorial_status": TUTORIAL_STATUS_SKIPPED}},
        )
    except Exception as e:
        logging.warning("Tutorial indexes/migration failed: %s", e)
    try:
        from routers.casinos.sports_betting import ensure_sports_bet_max_total_open_stake_setting

        await ensure_sports_bet_max_total_open_stake_setting()
    except Exception as e:
        logging.warning("Failed to sync sports bet open stake cap: %s", e)
    try:
        from utils.ensure_faq_topic import ensure_faq_forum_topic

        await ensure_faq_forum_topic(db)
    except Exception as e:
        logging.exception("FAQ forum topic sync: %s", e)
    try:
        from utils.ensure_update_log_topic import ensure_update_log_forum_topic

        await ensure_update_log_forum_topic(db)
    except Exception as e:
        logging.exception("Update Log forum topic sync: %s", e)
    try:
        from utils.ensure_how_to_topic import ensure_how_to_forum_topic

        await ensure_how_to_forum_topic(db)
    except Exception as e:
        logging.exception("How To forum topic sync: %s", e)
    from routers.crime.jail import spawn_jail_npcs
    asyncio.create_task(spawn_jail_npcs())
    # Start security monitoring background task
    asyncio.create_task(security_module.security_monitor_task(db))
    from utils.presence_simulator import run_presence_simulator_loop
    asyncio.create_task(run_presence_simulator_loop())

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
    # Automated MDG: 3 house-vs-player games every 3 hours
    from routers.casinos import mdg as mdg_mod
    asyncio.create_task(mdg_mod.run_automated_mdg_ticker())
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
    # Distillery auto-aging ticker (non-Auto-Rank users with auto_aging.enabled)
    distillery_automation_use_cron = (os.environ.get("DISTILLERY_AUTOMATION_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
    if not distillery_automation_use_cron:
        from routers.money import illegal_business as illegal_business_mod

        asyncio.create_task(illegal_business_mod.run_distillery_automation_ticker())
    else:
        logging.getLogger(__name__).info(
            "Distillery automation: ticker disabled (DISTILLERY_AUTOMATION_USE_CRON=1). Schedule a worker to call distillery_process_automation per user or add a cron route."
        )
    robot_bg_auto_search_use_cron = (os.environ.get("ROBOT_BG_AUTO_SEARCH_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
    if not robot_bg_auto_search_use_cron:
        from utils.robot_bg_auto_search import run_robot_bg_auto_search_ticker

        asyncio.create_task(run_robot_bg_auto_search_ticker(db))
    else:
        logging.getLogger(__name__).info(
            "Robot bodyguard auto-search: using cron only (ROBOT_BG_AUTO_SEARCH_USE_CRON=1). Call POST /api/attack/cron/robot-bg-auto-search every ~15m. Header: X-Cron-Secret: <CRON_SECRET>"
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
    # Sports betting auto-settle: in-process ticker (kickoff + delay) vs external cron only
    sports_settle_use_cron = (os.environ.get("SPORTS_AUTO_SETTLE_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
    # Default ON so old open bets get settled automatically without extra setup.
    # Set SPORTS_AUTO_SETTLE_TICKER=0 to disable when needed.
    _sports_settle_ticker_raw = (os.environ.get("SPORTS_AUTO_SETTLE_TICKER") or "").strip().lower()
    sports_settle_ticker = _sports_settle_ticker_raw not in ("0", "false", "no", "off")
    if sports_settle_use_cron:
        logging.getLogger(__name__).info(
            "Sports auto-settle: ticker disabled (SPORTS_AUTO_SETTLE_USE_CRON=1). Use POST /api/sports-betting/cron/auto-settle on a schedule."
        )
    elif sports_settle_ticker:
        from routers.casinos import sports_betting as sports_betting_mod

        asyncio.create_task(sports_betting_mod.run_sports_auto_settle_ticker())
        logging.getLogger(__name__).info(
            "Sports auto-settle: in-process ticker enabled (default ON; set SPORTS_AUTO_SETTLE_TICKER=0 to disable). Multi-worker: each worker runs a ticker — use one worker or cron-only mode."
        )
    # Sports betting auto-board: add upcoming events from saved templates (MongoDB by default; see SPORTS_AUTO_BOARD_TEMPLATE_SOURCE)
    sports_auto_board_use_cron = (os.environ.get("SPORTS_AUTO_BOARD_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
    _sports_auto_board_ticker_raw = (os.environ.get("SPORTS_AUTO_BOARD_TICKER") or "").strip().lower()
    sports_auto_board_ticker = _sports_auto_board_ticker_raw not in ("0", "false", "no", "off")
    if sports_auto_board_use_cron:
        logging.getLogger(__name__).info(
            "Sports auto-board: ticker disabled (SPORTS_AUTO_BOARD_USE_CRON=1). Use POST /api/sports-betting/cron/auto-board on a schedule."
        )
    elif sports_auto_board_ticker:
        from routers.casinos import sports_betting as sports_betting_mod

        asyncio.create_task(sports_betting_mod.run_sports_auto_board_ticker())
        logging.getLogger(__name__).info(
            "Sports auto-board: in-process ticker enabled (default ON; set SPORTS_AUTO_BOARD_TICKER=0 to disable). Default: DB templates every 2h, no Odds refresh on that path. Multi-worker: prefer cron-only."
        )
    # World Cup: auto-settle + fixture sync tickers (optional; cron recommended for production)
    wc_settle_use_cron = (os.environ.get("WORLD_CUP_AUTO_SETTLE_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
    _wc_settle_ticker_raw = (os.environ.get("WORLD_CUP_AUTO_SETTLE_TICKER") or "").strip().lower()
    wc_settle_ticker = _wc_settle_ticker_raw in ("1", "true", "yes")
    if wc_settle_use_cron:
        logging.getLogger(__name__).info(
            "World Cup auto-settle: ticker disabled (WORLD_CUP_AUTO_SETTLE_USE_CRON=1). Use POST /api/world-cup/cron/auto-settle on a schedule."
        )
    elif wc_settle_ticker:
        from routers.game import world_cup as world_cup_mod

        asyncio.create_task(world_cup_mod.run_world_cup_auto_settle_ticker())
        logging.getLogger(__name__).info("World Cup auto-settle: in-process ticker enabled.")
    wc_sync_use_cron = (os.environ.get("WORLD_CUP_SYNC_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
    _wc_sync_ticker_raw = (os.environ.get("WORLD_CUP_SYNC_TICKER") or "").strip().lower()
    wc_sync_ticker = _wc_sync_ticker_raw in ("1", "true", "yes")
    if wc_sync_use_cron:
        logging.getLogger(__name__).info(
            "World Cup fixture sync: ticker disabled (WORLD_CUP_SYNC_USE_CRON=1). Use POST /api/world-cup/cron/sync-fixtures daily."
        )
    elif wc_sync_ticker:
        from routers.game import world_cup as world_cup_mod

        asyncio.create_task(world_cup_mod.run_world_cup_sync_ticker())
        logging.getLogger(__name__).info("World Cup fixture sync: in-process ticker enabled.")
    wc_draft_use_cron = (os.environ.get("WORLD_CUP_AUTO_DRAFT_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
    _wc_draft_ticker_raw = (os.environ.get("WORLD_CUP_AUTO_DRAFT_TICKER") or "").strip().lower()
    wc_draft_ticker = _wc_draft_ticker_raw in ("1", "true", "yes")
    if wc_draft_use_cron:
        logging.getLogger(__name__).info(
            "World Cup auto-draft: ticker disabled (WORLD_CUP_AUTO_DRAFT_USE_CRON=1). Use POST /api/world-cup/cron/auto-draft every ~15 min."
        )
    elif wc_draft_ticker:
        from routers.game import world_cup as world_cup_mod

        asyncio.create_task(world_cup_mod.run_world_cup_auto_draft_ticker())
        logging.getLogger(__name__).info("World Cup auto-draft: in-process ticker enabled (24h before first match).")
    # Crew OC store-token auto-apply: bounded ticker vs cron-only (multi-worker safe)
    crew_oc_auto_apply_use_cron = (os.environ.get("CREW_OC_AUTO_APPLY_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
    _crew_oc_auto_apply_ticker_raw = (os.environ.get("CREW_OC_AUTO_APPLY_TICKER") or "").strip().lower()
    crew_oc_auto_apply_ticker_on = _crew_oc_auto_apply_ticker_raw not in ("0", "false", "no", "off")
    if crew_oc_auto_apply_use_cron:
        logging.getLogger(__name__).info(
            "Crew OC auto-apply: ticker disabled (CREW_OC_AUTO_APPLY_USE_CRON=1). Schedule POST /api/families/cron/crew-oc-auto-apply ~every 60s. Header: X-Cron-Secret."
        )
    elif crew_oc_auto_apply_ticker_on:
        asyncio.create_task(families.run_crew_oc_auto_apply_ticker())
        logging.getLogger(__name__).info(
            "Crew OC auto-apply: in-process ticker enabled (~60s+jitter; CREW_OC_AUTO_APPLY_TICKER=0 to disable). Multi-worker: prefer cron-only."
        )
    # Family perk: auto-commit Crew OC after forum ad (bounded ticker vs cron-only)
    crew_oc_auto_commit_use_cron = (os.environ.get("CREW_OC_AUTO_COMMIT_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
    _crew_oc_auto_commit_ticker_raw = (os.environ.get("CREW_OC_AUTO_COMMIT_TICKER") or "").strip().lower()
    crew_oc_auto_commit_ticker_on = _crew_oc_auto_commit_ticker_raw not in ("0", "false", "no", "off")
    if crew_oc_auto_commit_use_cron:
        logging.getLogger(__name__).info(
            "Crew OC auto-commit: ticker disabled (CREW_OC_AUTO_COMMIT_USE_CRON=1). Schedule POST /api/families/cron/crew-oc-auto-commit ~every 60s. Header: X-Cron-Secret."
        )
    elif crew_oc_auto_commit_ticker_on:
        asyncio.create_task(families.run_crew_oc_auto_commit_ticker())
        logging.getLogger(__name__).info(
            "Crew OC auto-commit: in-process ticker enabled (~60s+jitter; CREW_OC_AUTO_COMMIT_TICKER=0 to disable). Multi-worker: prefer cron-only."
        )
    # Family vault hourly bullets (airport + armoury high command): credits ``treasury_bullets``, not cash
    family_tb_hourly_use_cron = (os.environ.get("FAMILY_TREASURY_BULLETS_HOURLY_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
    _family_tb_hourly_ticker_raw = (os.environ.get("FAMILY_TREASURY_BULLETS_HOURLY_TICKER") or "").strip().lower()
    family_tb_hourly_ticker_on = _family_tb_hourly_ticker_raw not in ("0", "false", "no", "off")
    if family_tb_hourly_use_cron:
        logging.getLogger(__name__).info(
            "Family vault hourly bullets: ticker disabled (FAMILY_TREASURY_BULLETS_HOURLY_USE_CRON=1). Schedule POST /api/families/cron/treasury-bullets-hourly each UTC hour with X-Cron-Secret."
        )
    elif family_tb_hourly_ticker_on:
        asyncio.create_task(families.run_family_treasury_bullets_hourly_ticker())
        logging.getLogger(__name__).info(
            "Family vault hourly bullets: in-process ticker enabled (~60s+jitter; FAMILY_TREASURY_BULLETS_HOURLY_USE_CRON=1 or FAMILY_TREASURY_BULLETS_HOURLY_TICKER=0 for external cron only). Multi-worker: prefer cron-only."
        )
    from routers.cars import gta as gta_router
    asyncio.create_task(gta_router.run_dealer_replenish_loop())
    asyncio.create_task(gta_router.run_dealer_auto_stock_loop())
    if SLOTS_FEATURE_ENABLED:
        # Slots: run ownership draw check every 60s so draws happen at next_draw_at even if no one is on the page (3h boundaries; 1m delay is fine)
        from routers.casinos import slots as slots_router
        async def slots_draw_ticker():
            while True:
                try:
                    await slots_router.run_slots_draws_due()
                except Exception as e:
                    logging.exception("Slots draw ticker: %s", e)
                await asyncio.sleep(60)
        asyncio.create_task(slots_draw_ticker())
    # City lottery (Wed/Sun UTC): poll so draws run at closes_at without relying on external cron
    lottery_draw_use_cron = (os.environ.get("LOTTERY_DRAW_USE_CRON") or "").strip().lower() in ("1", "true", "yes")
    _lottery_draw_ticker_raw = (os.environ.get("LOTTERY_DRAW_TICKER") or "").strip().lower()
    lottery_draw_ticker_on = _lottery_draw_ticker_raw not in ("0", "false", "no", "off")
    if lottery_draw_use_cron:
        logging.getLogger(__name__).info(
            "City lottery: ticker disabled (LOTTERY_DRAW_USE_CRON=1). Schedule POST /api/lottery/draw-cron with header X-Cron-Secret."
        )
    elif lottery_draw_ticker_on:
        async def city_lottery_draw_ticker():
            while True:
                try:
                    await lottery.lottery_draw_cron(True)
                except Exception as e:
                    logging.exception("City lottery draw ticker: %s", e)
                await asyncio.sleep(30)
        asyncio.create_task(city_lottery_draw_ticker())
        logging.getLogger(__name__).info(
            "City lottery: in-process draw ticker enabled (every 30s; LOTTERY_DRAW_USE_CRON=1 or LOTTERY_DRAW_TICKER=0 for external cron only). Multi-worker: prefer one worker or cron-only."
        )
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
    from utils.entertainer_service import run_entertainer_daily_refills

    async def entertainer_refill_ticker():
        while True:
            try:
                await run_entertainer_daily_refills(db, send_notification)
            except Exception as e:
                logging.exception("Entertainer daily refill ticker: %s", e)
            await asyncio.sleep(60)

    asyncio.create_task(entertainer_refill_ticker())
    from utils.auto_collect_service import run_auto_collect_ticker

    asyncio.create_task(run_auto_collect_ticker(db))
    async def daily_event_inbox_ticker():
        while True:
            try:
                await maybe_daily_event_inbox_reminder()
            except Exception as e:
                logging.exception("Daily event inbox ticker: %s", e)
            await asyncio.sleep(60)
    asyncio.create_task(daily_event_inbox_ticker())
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
    from utils.migrate_armour_level7 import migrate_loot_armour_level_6_to_7_if_needed

    await migrate_loot_armour_level_6_to_7_if_needed(db)
    weapons_count = await db.weapons.count_documents({})
    if weapons_count == 0:
        weapons = _load_seed_json("weapons.json")
        if weapons:
            await db.weapons.insert_many(weapons)
            logging.info("Seeded %d weapons from data/weapons.json", len(weapons))
        else:
            logging.warning("Weapons collection is empty and no seed file; add data/weapons.json or insert via DB.")
    else:
        if await db.weapons.find_one({"id": "weapon11"}) is None:
            store_weapon = {
                "id": WEAPON_POINT_STORE_TIER["id"],
                "name": WEAPON_POINT_STORE_TIER["name"],
                "description": WEAPON_POINT_STORE_TIER["description"],
                "damage": WEAPON_POINT_STORE_TIER["damage"],
                "bullets_needed": WEAPON_POINT_STORE_TIER["bullets_needed"],
                "rank_required": WEAPON_POINT_STORE_TIER["rank_required"],
                "price_money": None,
                "price_points": None,
                "store_exclusive": True,
            }
            await db.weapons.insert_one(store_weapon)
            logging.info("Inserted Points Store weapon (weapon11) into existing weapons collection")
        if await db.weapons.find_one({"id": "weapon_loot"}) is None:
            loot_weapon = {"id": "weapon_loot", "name": "Colt Monitor", "description": "Loot-exclusive LMG. Not sold anywhere.", "damage": 140, "bullets_needed": 40, "rank_required": 11, "price_money": None, "price_points": None, "loot_exclusive": True}
            await db.weapons.insert_one(loot_weapon)
            logging.info("Inserted loot-exclusive weapon (weapon_loot) into existing weapons collection")
    properties_count = await db.properties.count_documents({})
    seed_properties = _load_seed_json("properties.json")
    if properties_count == 0:
        if seed_properties:
            await db.properties.insert_many(seed_properties)
            logging.info("Seeded %d properties from data/properties.json", len(seed_properties))
        else:
            logging.warning("Properties collection is empty and no seed file; add data/properties.json or insert via DB.")
    elif seed_properties:
        # Keep progression property economy in sync with data/properties.json (price, income, levels).
        # Skips trade listings (for_sale) and any doc missing canonical fields.
        synced = 0
        for p in seed_properties:
            pid = p.get("id")
            if not pid or not isinstance(p, dict):
                continue
            fields = {
                k: p[k]
                for k in ("name", "property_type", "price", "income_per_hour", "max_level", "required_property_id")
                if k in p
            }
            if len(fields) < 5:
                continue
            res = await db.properties.update_one(
                {
                    "id": pid,
                    "for_sale": {"$ne": True},
                    "price": {"$exists": True},
                    "income_per_hour": {"$exists": True},
                    "max_level": {"$exists": True},
                },
                {"$set": fields},
            )
            if res.modified_count:
                synced += 1
        if synced:
            logging.info("Synced %d progression properties from data/properties.json", synced)
    logging.info("✅ Game data initialization complete (NO user data was modified)")
