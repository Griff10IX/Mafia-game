# Illegal business (1920s–30s mafia): one per player, Capo+, raid formula, guards/security, missions, killer choice on death
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any, Tuple
import copy
import os
import re
import uuid
import secrets
_rng = secrets.SystemRandom()
import logging
from pydantic import BaseModel

from fastapi import Depends, HTTPException, Query

from server import (
    db,
    get_current_user,
    get_rank_info,
    get_effective_event,
    get_prestige_bonus,
    log_activity,
    log_respect_earned,
    send_notification,
    STATES,
    RANKS,
    CAPO_RANK_ID,
)
from routers.kill.armoury import (
    TOKEN_CONFIG,
    TOKEN_TYPES,
    TOKEN_TYPES_GLOBAL_RANDOM_DROP,
    TOKEN_GLOBAL_DROP_AMOUNT_MAX,
    TOKEN_GLOBAL_DROP_AMOUNT_MIN,
    TOKEN_GLOBAL_DROP_CHANCE,
)
from utils.game_timezone import game_today_date_str
from utils.point_provenance import log_points_event
from utils.booze_intake_gate import booze_intake_blocked
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_ILLEGAL_BUSINESS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
ILLEGAL_BUSINESS_TYPES = [
    {"id": "stolen_goods_fence", "name": "Stolen goods fence", "description": "Buying and selling hot merchandise.", "produces_booze": False},
    {"id": "booze_making", "name": "Booze making", "description": "Still / distillery. Cash and passive booze.", "produces_booze": True},
    {"id": "speakeasy", "name": "Speakeasy", "description": "Hidden bar, entertainment, clientele.", "produces_booze": False},
    {"id": "numbers_racket", "name": "Numbers racket", "description": "Illegal lottery / policy racket.", "produces_booze": False},
    {"id": "protection_racket", "name": "Protection racket", "description": "Protection payments from local businesses.", "produces_booze": False},
]

START_COST_CASH = 12_500  # 75% reduction for beta
START_COST_POINTS = 0
INCOME_PER_HOUR_BASE = 700  # passive till rate; mission income_mult stacks on stored value
INCOME_CAP_HOURS_BASE = 24
BOOZE_PER_HOUR_BASE = 5
BOOZE_CAP_HOURS_BASE = 24
GUARD_SLOTS_INITIAL = 2
SECURITY_LEVEL_INITIAL = 0

# Distillery progression and economy tuning.
DISTILLERY_EQUIPMENT_ORDER = [
    "stills",
    "condensers",
    "mash_tun",
    "barrels",
    "bottling",
    "tunnel",
    "bribe_office",
    "fake_labels",
    "quality_lab",
]
DISTILLERY_EQUIPMENT_MAX_LEVEL = 20
DISTILLERY_BASE_WORKER_CAP = 5
DISTILLERY_MAX_WORKER_CAP = 25
DISTILLERY_LANE_BASE_COST = {
    "stills": 12_000,
    "condensers": 16_000,
    "mash_tun": 20_000,
    "barrels": 24_000,
    "bottling": 30_000,
    "tunnel": 36_000,
    "bribe_office": 42_000,
    "fake_labels": 48_000,
    "quality_lab": 54_000,
}
DISTILLERY_WORKER_ROLES = ("production", "quality", "security", "sales")
DISTILLERY_WORKER_HIRE_COST = 22_000
DISTILLERY_WORKER_MAX_PER_ACTION = 3
DISTILLERY_MAINTENANCE_RECOVER_COST_PER_POINT = 300
DISTILLERY_MAINTENANCE_DECAY_PER_HOUR = 0.5
DISTILLERY_MAINTENANCE_DEGRADE_THRESHOLD = 35.0
DISTILLERY_MAINTENANCE_MELTDOWN_THRESHOLD = 18.0
DISTILLERY_MAINTENANCE_DEGRADE_CHECK_HOURS = 6.0
DISTILLERY_MAINTENANCE_DEGRADE_MAX_PER_TICK = 4
DISTILLERY_MAINTENANCE_DEGRADE_BASE_CHANCE = 0.22
DISTILLERY_MAINTENANCE_DEGRADE_MELTDOWN_BONUS = 0.24
DISTILLERY_HEAT_DECAY_PER_HOUR = 1.35
DISTILLERY_HEAT_THRESHOLDS = {"warm": 25, "hot": 50, "critical": 75}
DISTILLERY_HEAT_GAIN_PER_BOOZE = 0.06
DISTILLERY_HEAT_GAIN_PER_AUTO_SELL = 0.12
DISTILLERY_HEAT_BOOZE_LOSS_THRESHOLDS = {"hot": 55, "critical": 78, "meltdown": 92}
DISTILLERY_ENFORCEMENT_MAX_CHANCE = 0.30
DISTILLERY_ENFORCEMENT_SHUTDOWN_HOURS = (2, 8)
DISTILLERY_ENFORCEMENT_VAULT_LOSS_MIN = 0.05
DISTILLERY_ENFORCEMENT_VAULT_LOSS_MAX = 0.22
DISTILLERY_AUTO_SELL_MARGIN_BASE = 0.85
DISTILLERY_AUTO_SELL_MARGIN_CAP = 1.70
DISTILLERY_BASE_BOOZE_UNIT_VALUE = 900
RACKET_TOKEN_INCOME_MULT = 1.2
BOOZE_TOKEN_DISTILLERY_MULT = 1.1
DISTILLERY_COLLECT_ROI_SAFETY_FLOOR = 1.0
DISTILLERY_MAX_ACTIVE_BATCHES = 8
# Auto-aging won't start a batch below this (avoids spam when reserve is barely below carrying).
DISTILLERY_AUTO_AGING_MIN_BATCH_UNITS = 25
DISTILLERY_AUTO_SELL_MODES = frozenset({"crew", "booze_run"})
try:
    DISTILLERY_AUTOMATION_TICKER_SECONDS = max(15, min(600, int(os.environ.get("DISTILLERY_AUTOMATION_TICKER_SECONDS", "60") or "60")))
except (TypeError, ValueError):
    DISTILLERY_AUTOMATION_TICKER_SECONDS = 60
try:
    DISTILLERY_AUTO_COLLECT_MIN_INTERVAL_SECONDS = max(
        60, min(3600, int(os.environ.get("DISTILLERY_AUTO_COLLECT_MIN_INTERVAL_SECONDS", "240") or "240"))
    )
except (TypeError, ValueError):
    DISTILLERY_AUTO_COLLECT_MIN_INTERVAL_SECONDS = 240
try:
    DISTILLERY_AUTOMATION_MAX_BUSINESSES_PER_TICK = max(
        1, min(500, int(os.environ.get("DISTILLERY_AUTOMATION_MAX_BUSINESSES_PER_TICK", "40") or "40"))
    )
except (TypeError, ValueError):
    DISTILLERY_AUTOMATION_MAX_BUSINESSES_PER_TICK = 40
DISTILLERY_TARGET_12D_TOP_END = 50_000_000
DISTILLERY_TARGET_DAILY_TOP_END = DISTILLERY_TARGET_12D_TOP_END / 12.0
DISTILLERY_TOP_END_HOURS = 12 * 24
DISTILLERY_RISK_ACTION_COOLDOWN_HOURS = 4
DISTILLERY_RISK_ACTION_HEAT_AFTER = 0.0
DISTILLERY_PRICE_SCALE = 0.72
DISTILLERY_MAX_SINGLE_UPGRADE_COST = 120_000_000
DISTILLERY_RISK_ACTION_COSTS = {"cool_off": 900_000, "bribe_crackdown": 3_500_000}
DISTILLERY_AGING_TIERS = {
    "quick": {"hours_min": 0.25, "hours_max": 0.75, "quality_mult": 1.02, "cash_mult": 1.02},
    "standard": {"hours_min": 2.0, "hours_max": 6.0, "quality_mult": 1.05, "cash_mult": 1.08},
    "reserve": {"hours_min": 18.0, "hours_max": 36.0, "quality_mult": 1.12, "cash_mult": 1.22},
    "premium": {"hours_min": 48.0, "hours_max": 96.0, "quality_mult": 1.20, "cash_mult": 1.42},
}
DISTILLERY_SPECIAL_TRACKS = (
    "production",
    "aging",
    "logistics",
    "stealth",
    "labor",
    "black_market",
)
DISTILLERY_SPECIAL_PER_TRACK = 30
DISTILLERY_SPECIAL_TOTAL = len(DISTILLERY_SPECIAL_TRACKS) * DISTILLERY_SPECIAL_PER_TRACK
DISTILLERY_PROGRESS_TOTAL_STEPS = (len(DISTILLERY_EQUIPMENT_ORDER) * DISTILLERY_EQUIPMENT_MAX_LEVEL) + DISTILLERY_SPECIAL_TOTAL
DISTILLERY_SPECIAL_TRACK_BASE_COST = {
    "production": 1_200_000,
    "aging": 1_350_000,
    "logistics": 1_500_000,
    "stealth": 1_650_000,
    "labor": 1_800_000,
    "black_market": 2_200_000,
}

# Security upgrades: buy in order at escalating prices (no mission gates).
SECURITY_UPGRADES = [
    {"id": "reinforced_door", "name": "Reinforced door", "defence_weight": 8},
    {"id": "vault", "name": "Vault / safe", "defence_weight": 12},
    {"id": "lookout", "name": "Lookout", "defence_weight": 10},
    {"id": "bouncers", "name": "Bouncers", "defence_weight": 15},
    {"id": "alarm_wire", "name": "Alarm wire", "defence_weight": 9},
    {"id": "bribed_cop", "name": "Bribed beat cop", "defence_weight": 14},
    {"id": "thompson", "name": "Thompson in the back", "defence_weight": 18},
    {"id": "iron_bars", "name": "Iron bars on windows", "defence_weight": 7},
    {"id": "guard_dog", "name": "Guard dog", "defence_weight": 11},
    {"id": "spotlight", "name": "Spotlight at the door", "defence_weight": 6},
    {"id": "safe_room", "name": "Safe room", "defence_weight": 16},
    {"id": "wire_taps", "name": "Wire taps (early warning)", "defence_weight": 10},
    {"id": "armoured_desk", "name": "Armoured desk", "defence_weight": 8},
    {"id": "back_exit", "name": "Hidden back exit", "defence_weight": 9},
    {"id": "panic_button", "name": "Panic button to the family", "defence_weight": 13},
    # Tier 3–4 (indices 15–34)
    {"id": "reinforced_door_2", "name": "Heavy reinforced door", "defence_weight": 10},
    {"id": "vault_2", "name": "Secondary vault", "defence_weight": 14},
    {"id": "lookout_2", "name": "Rooftop lookout", "defence_weight": 12},
    {"id": "bouncers_2", "name": "Extra bouncers", "defence_weight": 16},
    {"id": "alarm_2", "name": "Perimeter alarm", "defence_weight": 11},
    {"id": "bribed_cop_2", "name": "Second beat cop", "defence_weight": 15},
    {"id": "thompson_2", "name": "Second Thompson", "defence_weight": 19},
    {"id": "iron_bars_2", "name": "Reinforced bars", "defence_weight": 8},
    {"id": "guard_dog_2", "name": "Second guard dog", "defence_weight": 12},
    {"id": "spotlight_2", "name": "Rear spotlight", "defence_weight": 7},
    {"id": "safe_room_2", "name": "Reinforced safe room", "defence_weight": 18},
    {"id": "wire_taps_2", "name": "Extended wire taps", "defence_weight": 11},
    {"id": "armoured_desk_2", "name": "Double armoured desk", "defence_weight": 9},
    {"id": "back_exit_2", "name": "Second back exit", "defence_weight": 10},
    {"id": "panic_button_2", "name": "Backup panic line", "defence_weight": 14},
    {"id": "reinforced_door_3", "name": "Bank-grade door", "defence_weight": 11},
    {"id": "vault_3", "name": "Main vault upgrade", "defence_weight": 15},
    {"id": "lookout_3", "name": "Street lookouts", "defence_weight": 13},
    {"id": "bouncers_3", "name": "Elite bouncers", "defence_weight": 17},
    {"id": "alarm_3", "name": "Full building alarm", "defence_weight": 12},
    {"id": "bribed_cop_3", "name": "Sergeant on payroll", "defence_weight": 16},
    {"id": "thompson_3", "name": "Thompson squad", "defence_weight": 20},
    {"id": "iron_bars_3", "name": "Steel cage", "defence_weight": 9},
    {"id": "guard_dog_3", "name": "K-9 unit", "defence_weight": 13},
    {"id": "spotlight_3", "name": "Full perimeter lights", "defence_weight": 8},
    {"id": "safe_room_3", "name": "Bunker safe room", "defence_weight": 19},
    {"id": "wire_taps_3", "name": "City-wide taps", "defence_weight": 12},
    {"id": "armoured_desk_3", "name": "Vault desk", "defence_weight": 10},
    {"id": "back_exit_3", "name": "Tunnel exit", "defence_weight": 11},
    {"id": "panic_button_3", "name": "Family rapid response", "defence_weight": 15},
    {"id": "reinforced_door_4", "name": "Bunker door", "defence_weight": 12},
    {"id": "vault_4", "name": "Underground vault", "defence_weight": 16},
    {"id": "lookout_4", "name": "24/7 watch", "defence_weight": 14},
    {"id": "bouncers_4", "name": "Armoured bouncers", "defence_weight": 18},
    # Tier 5 (indices 49–79) — supports security_level up to 80 for ibm_100
    {"id": "reinforced_door_5", "name": "Fortress-grade door", "defence_weight": 13},
    {"id": "vault_5", "name": "Deep vault annex", "defence_weight": 17},
    {"id": "lookout_5", "name": "Radio lookout net", "defence_weight": 15},
    {"id": "bouncers_5", "name": "Armed house crew", "defence_weight": 19},
    {"id": "alarm_5", "name": "Silent alarm grid", "defence_weight": 13},
    {"id": "bribed_cop_5", "name": "Precinct friend", "defence_weight": 17},
    {"id": "thompson_5", "name": "Crew Thompsons", "defence_weight": 21},
    {"id": "iron_bars_5", "name": "Steel shutters", "defence_weight": 10},
    {"id": "guard_dog_5", "name": "Patrol dogs", "defence_weight": 14},
    {"id": "spotlight_5", "name": "Generator floodlights", "defence_weight": 9},
    {"id": "safe_room_5", "name": "Command safe room", "defence_weight": 20},
    {"id": "wire_taps_5", "name": "Federal-grade taps", "defence_weight": 13},
    {"id": "armoured_desk_5", "name": "Ballistic counter", "defence_weight": 11},
    {"id": "back_exit_5", "name": "Escape tunnel II", "defence_weight": 12},
    {"id": "panic_button_5", "name": "Syndicate hotline", "defence_weight": 16},
    {"id": "reinforced_door_6", "name": "Blast door", "defence_weight": 14},
    {"id": "vault_6", "name": "Tri-vault system", "defence_weight": 18},
    {"id": "lookout_6", "name": "Block watch network", "defence_weight": 16},
    {"id": "bouncers_6", "name": "Veteran enforcers", "defence_weight": 20},
    {"id": "alarm_6", "name": "City tie-in alarm", "defence_weight": 14},
    {"id": "bribed_cop_6", "name": "Captain on payroll", "defence_weight": 18},
    {"id": "thompson_6", "name": "Gun nest", "defence_weight": 22},
    {"id": "iron_bars_6", "name": "Window cages", "defence_weight": 11},
    {"id": "guard_dog_6", "name": "Attack kennel", "defence_weight": 15},
    {"id": "spotlight_6", "name": "Tower lights", "defence_weight": 10},
    {"id": "safe_room_6", "name": "Sub-basement bunker", "defence_weight": 21},
    {"id": "wire_taps_6", "name": "Switchboard taps", "defence_weight": 14},
    {"id": "armoured_desk_6", "name": "Reinforced office", "defence_weight": 12},
    {"id": "back_exit_6", "name": "Sewer route", "defence_weight": 13},
    {"id": "panic_button_6", "name": "War council line", "defence_weight": 17},
    {"id": "citadel_lock", "name": "Citadel lockdown", "defence_weight": 24},
]
# Cost for security upgrade at index i: base + step * i (gradually higher).
# 75% reduction for beta
SECURITY_UPGRADE_BASE_CASH = 6_250
SECURITY_UPGRADE_STEP_CASH = 5_000
SECURITY_UPGRADE_BASE_POINTS = 0
SECURITY_UPGRADE_STEP_POINTS = 0
SECURITY_UPGRADE_IDS = [u["id"] for u in SECURITY_UPGRADES]
# Original chain length (tier 1–4); extended tier 5+ prices align with ibm_31+ vault rewards (~$1.05M–$6.5M).
SECURITY_UPGRADE_LEGACY_LAST_INDEX = 48


def security_upgrade_cost_cash(idx: int) -> int:
    """Vault cash cost for security upgrade at list index ``idx`` (0-based)."""
    if idx < 0:
        idx = 0
    if idx <= SECURITY_UPGRADE_LEGACY_LAST_INDEX:
        return int(SECURITY_UPGRADE_BASE_CASH + SECURITY_UPGRADE_STEP_CASH * idx)
    ext_i = idx - SECURITY_UPGRADE_LEGACY_LAST_INDEX - 1
    ext_n = len(SECURITY_UPGRADES) - SECURITY_UPGRADE_LEGACY_LAST_INDEX - 1
    if ext_n <= 1:
        return 6_500_000
    # Match extended mission vault scale (ibm_missions_extended ~$1.05M → $6.5M)
    v0 = 1_200_000
    v1 = 6_500_000
    t = ext_i / (ext_n - 1)
    return int(v0 + (v1 - v0) * t)


# Guard hire: cost per slot; armour/weapon 0..base_max + mission unlocks (cap at 20).
# 75% reduction for beta
GUARD_HIRE_COST_CASH = 2_500
GUARD_HIRE_COST_POINTS = 0
GUARD_SLOTS_MAX = 1000
# Cost to add one more guard slot: base * (mult ** (current_slots - GUARD_SLOTS_INITIAL)).
GUARD_SLOT_BASE_CASH = 12_500  # 75% reduction
GUARD_SLOT_BASE_POINTS = 0
GUARD_SLOT_MULT = 1.5
GUARD_ARMOUR_MAX = 20
GUARD_WEAPON_MAX = 20
GUARD_WEAPON_BASE_MAX = 3  # missions add +1 via guard_weapon_max_unlock on business
GUARD_ARMOUR_BASE_MAX = 3  # missions add +1 via guard_armour_max_unlock on business
# Post-hire guard gear upgrade (vault); cost for level L -> L+1
GUARD_UPGRADE_BASE_CASH = 8_000
GUARD_UPGRADE_LEVEL_MULT = 1.38
# Till cap bonus from missions (hours stacked on income_cap_hours)
INCOME_CAP_HOURS_MAX = 168
# Defender meta: flat strength bonus (missions); raid loot taken from this business
DEFENDER_STRENGTH_BONUS_CAP = 400
RAID_INCOMING_LOOT_MULT_MIN = 0.50  # victim: min multiplier on cash lost to raiders

# Raid
RAID_COOLDOWN_HOURS = 12
RAID_DAILY_LIMIT_DEFAULT = 5
RAID_DAILY_LIMIT_MAX = 10
RAID_DAILY_LIMIT = RAID_DAILY_LIMIT_DEFAULT  # backward compat for imports
RAID_LOOT_PERCENT = 0.25  # attacker gets 25% of target's uncollected income (capped)
RAID_VARIANCE = 0.15  # random +/- 15% on strength for drama
DEFENDER_BASE_STRENGTH = 10
ATTACKER_BASE_STRENGTH = 5
GUARD_STRENGTH_PER_LEVEL = 4  # armour_level + weapon_level each contribute
SECURITY_WEIGHT = 1.0  # defence = DEFENDER_BASE + sum(guard_strength) + security_level * weight per upgrade

# Min till to "collect the take"; min vault balance to pocket withdraw (anti-spam)
MIN_IBM_CASH_ACTION = 100

# Collect anti-spam: extras only when at least 1 min accumulated
MIN_COLLECT_HOURS_FOR_EXTRAS = 1 / 60
# Extras (bullets, respect, points, loot pieces) cooldown: once every few hours
RACKET_EXTRAS_COOLDOWN_HOURS = 3

# Death / killer reward
MAX_INCOME_BOOST_PERCENT = 20
INCOME_BOOST_PER_KILL_PERCENT = 2
MODERATELY_UPGRADED_LEVEL = 2
MODERATELY_UPGRADED_SECURITY = 1
# Seized business takeover: one-time bump to stored hourly till rate (distillery/economy use same doc).
KILL_TAKEOVER_INCOME_MULT = 1.05
# Liquidate: pay this many hours of gross till-style income from the snapshot (before killer account buffs).
KILL_REWARD_LIQUIDATION_HOURS = 168


def _illegal_business_passive_score(biz: dict) -> float:
    """Till strength for kill-reward compare: income_per_hour × level multiplier (matches liquidation level_mult)."""
    if not biz:
        return 0.0
    iph = int(biz.get("income_per_hour") or INCOME_PER_HOUR_BASE)
    level = int(biz.get("level") or 1)
    level_mult = 1.0 + 0.04 * max(0, level - 1)
    return float(iph) * level_mult


def _seized_snapshot_stronger_than_current(seized_snapshot: dict, killer_business: Optional[dict]) -> bool:
    """Full takeover when you have no racket, or seized passive score is strictly higher than yours."""
    if not killer_business:
        return True
    return _illegal_business_passive_score(seized_snapshot) > _illegal_business_passive_score(killer_business)


IBM_MISSIONS_CORE = [
    # Tier 1 — Getting Started
    {"id": "ibm_1", "order": 1, "title": "Prove the operation",
     "story": "The Commissioner wants a cut — prove you can run the block.",
     "how_to_complete": "Reach Capo rank and complete 100 crimes in total.",
     "requirements": {"crimes": 100, "rank_id": CAPO_RANK_ID},
     "rewards": {"vault_cash": 5_000, "income_mult": 1.44}},
    {"id": "ibm_2", "order": 2, "title": "Steady income",
     "story": "Show you can keep the lights on.",
     "how_to_complete": "Collect from your business 5 times.",
     "requirements": {"collections": 5},
     "rewards": {"vault_cash": 3_000, "income_mult": 1.38, "guard_slots": 1}},
    {"id": "ibm_3", "order": 3, "title": "Lock the door",
     "story": "Any fool can make money. Smart ones keep it.",
     "how_to_complete": "Install 1 security upgrade.",
     "requirements": {"security_level": 1},
     "rewards": {"vault_cash": 5_000, "income_mult": 1.44}},
    # Tier 2 — Building Up
    {"id": "ibm_4", "order": 4, "title": "Running the block",
     "story": "Work your territory. Own every corner.",
     "how_to_complete": "Complete 200 crimes in your business state.",
     "requirements": {"crimes_in_state": 200},
     "rewards": {"vault_cash": 10_000, "income_mult": 1.48, "guard_weapon_max": 1}},
    {"id": "ibm_5", "order": 5, "title": "Fortified",
     "story": "Five locks on the door. They'll think twice.",
     "how_to_complete": "Install 5 security upgrades.",
     "requirements": {"security_level": 5},
     "rewards": {"vault_cash": 15_000, "income_mult": 1.53, "guard_slots": 1, "xp_gta_tokens": 1}},
    {"id": "ibm_6", "order": 6, "title": "Crime wave",
     "story": "Five hundred jobs and counting. The family notices.",
     "how_to_complete": "Complete 500 crimes in total.",
     "requirements": {"crimes": 500},
     "rewards": {"vault_cash": 15_000, "income_mult": 1.50, "guard_weapon_max": 1, "melt_tokens": 1}},
    # Tier 3 — Established
    {"id": "ibm_7", "order": 7, "title": "Cash flow",
     "story": "The books look good. Real good.",
     "how_to_complete": "Collect from your business 15 times.",
     "requirements": {"collections": 15},
     "rewards": {"vault_cash": 20_000, "income_mult": 1.53, "xp_crimes_tokens": 1, "travel_tokens": 1}},
    {"id": "ibm_8", "order": 8, "title": "Iron curtain",
     "story": "Ten upgrades deep. Fort Knox would be jealous.",
     "how_to_complete": "Install 10 security upgrades.",
     "requirements": {"security_level": 10},
     "rewards": {"vault_cash": 25_000, "income_mult": 1.58, "guard_weapon_max": 1, "oc_reduced_tokens": 1}},
    {"id": "ibm_9", "order": 9, "title": "Territory boss",
     "story": "Seven-fifty in your state. They know your name.",
     "how_to_complete": "Complete 750 crimes in your business state.",
     "requirements": {"crimes_in_state": 750},
     "rewards": {"vault_cash": 30_000, "income_mult": 1.63, "booze_tokens": 1}},
    # Tier 4 — Major Player
    {"id": "ibm_10", "order": 10, "title": "The machine",
     "story": "Thirty collections, fifteen upgrades. Like clockwork.",
     "how_to_complete": "Collect 30 times and install 15 security upgrades.",
     "requirements": {"collections": 30, "security_level": 15},
     "rewards": {"vault_cash": 40_000, "income_mult": 1.63, "properties_tokens": 1}},
    {"id": "ibm_11", "order": 11, "title": "Crime lord",
     "story": "A thousand jobs. You're in the history books.",
     "how_to_complete": "Complete 1,000 crimes in total.",
     "requirements": {"crimes": 1000},
     "rewards": {"vault_cash": 40_000, "income_mult": 1.53, "jailbust_tokens": 1, "xp_gta_tokens": 1}},
    {"id": "ibm_12", "order": 12, "title": "State kingpin",
     "story": "Fifteen hundred crimes in your state. You ARE the law.",
     "how_to_complete": "Complete 1,500 crimes in your business state.",
     "requirements": {"crimes_in_state": 1500},
     "rewards": {"vault_cash": 50_000, "income_mult": 1.73, "xp_crimes_tokens": 1, "melt_tokens": 1}},
    # Tier 5 — Empire
    {"id": "ibm_13", "order": 13, "title": "Maximum security",
     "story": "Twenty-five upgrades. Nobody gets in unless you say so.",
     "how_to_complete": "Install 25 security upgrades.",
     "requirements": {"security_level": 25},
     "rewards": {"vault_cash": 50_000, "guard_weapon_max": 1, "income_mult": 1.53, "booze_tokens": 1}},
    {"id": "ibm_14", "order": 14, "title": "Veteran operator",
     "story": "Fifty collections, two thousand crimes on your turf.",
     "how_to_complete": "Collect 50 times and complete 2,000 crimes in your business state.",
     "requirements": {"collections": 50, "crimes_in_state": 2000},
     "rewards": {"vault_cash": 75_000, "income_mult": 1.73, "jailbust_tokens": 1, "travel_tokens": 1}},
    {"id": "ibm_15", "order": 15, "title": "Empire",
     "story": "You built it from nothing. Now it runs the city.",
     "how_to_complete": "Collect 100 times, complete 5,000 crimes, and install 35 security upgrades.",
     "requirements": {"collections": 100, "crimes": 5000, "security_level": 35},
     "rewards": {"vault_cash": 100_000, "income_mult": 1.85, "auto_rank_2h_tokens": 1, "racket_tokens": 1}},
    # Tier 6–10 — Long haul (segmented activity; IPH bumps via income_per_hour_add toward ~$100M/week passive)
    {"id": "ibm_16", "order": 16, "title": "Street pressure",
     "story": "Word travels. You need boots on the ground and the till ringing.",
     "how_to_complete": "Run 25 collections, 15 raid attempts, and 900 crimes in your business state since your last mission.",
     "requirements": {"collections": 25, "raids_attempted": 15, "crimes_in_state": 900},
     "rewards": {"vault_cash": 125_000, "racket_tokens": 1, "xp_gta_tokens": 1, "melt_tokens": 1, "booze_tokens": 1}},
    {"id": "ibm_17", "order": 17, "title": "Crew and cash out",
     "story": "Hire muscle. Move money out clean. Let them see you're serious.",
     "how_to_complete": "Hire 12 guards, withdraw from the vault 12 times, and reach security level 38.",
     "requirements": {"guards_hired": 12, "vault_withdrawals": 12, "security_level": 38},
     "rewards": {"vault_cash": 140_000, "guard_slots": 1, "oc_reduced_tokens": 1, "travel_tokens": 1, "properties_tokens": 1}},
    {"id": "ibm_18", "order": 18, "title": "Raid captain",
     "story": "Winning hits matter. So does body count on the books.",
     "how_to_complete": "Win 12 raids, commit 9,000 total crimes, and reach Consigliere rank.",
     "requirements": {"raids_won": 12, "crimes": 9000, "rank_id": 8},
     "rewards": {"vault_cash": 155_000, "income_per_hour_add": 3_000, "xp_crimes_tokens": 1, "xp_gta_tokens": 1, "auto_rank_2h_tokens": 1}},
    {"id": "ibm_19", "order": 19, "title": "Expand the roster",
     "story": "More slots, more collections. Own the block one slot at a time.",
     "how_to_complete": "Buy 4 extra guard slots, collect 45 times, and log 1,400 crimes in your state.",
     "requirements": {"guard_slots_bought": 4, "collections": 45, "crimes_in_state": 1400},
     "rewards": {"vault_cash": 170_000, "guard_weapon_max": 1, "jailbust_tokens": 1, "melt_tokens": 1, "racket_tokens": 1}},
    {"id": "ibm_20", "order": 20, "title": "Fortress and favors",
     "story": "Steel, raids, and the occasional inheritance from a dead rival.",
     "how_to_complete": "Security level 42, 50 raid attempts, kill 3 hitlist practice NPCs (The Board / Attack).",
     "requirements": {"security_level": 42, "raids_attempted": 50, "hitlist_npc_kills": 3},
     "rewards": {"vault_cash": 190_000, "income_per_hour_add": 3_000, "jailbust_tokens": 1, "booze_tokens": 1, "properties_tokens": 1}},
    {"id": "ibm_21", "order": 21, "title": "War economy",
     "story": "The ledger never sleeps. Neither do your crews.",
     "how_to_complete": "12,000 total crimes, 25 vault withdrawals, hire 30 guards.",
     "requirements": {"crimes": 12000, "vault_withdrawals": 25, "guards_hired": 30},
     "rewards": {"vault_cash": 210_000, "racket_tokens": 1, "xp_crimes_tokens": 1, "oc_reduced_tokens": 1, "travel_tokens": 1}},
    {"id": "ibm_22", "order": 22, "title": "Boss moves",
     "story": "Underboss was practice. Boss is the show.",
     "how_to_complete": "Reach Boss rank, collect 70 times, win 28 raids.",
     "requirements": {"rank_id": 9, "collections": 70, "raids_won": 28},
     "rewards": {"vault_cash": 235_000, "guard_slots": 1, "income_per_hour_add": 3_000, "xp_gta_tokens": 1, "auto_rank_2h_tokens": 1}},
    {"id": "ibm_23", "order": 23, "title": "Iron and ink",
     "story": "Every upgrade, every score in-state — documented in blood and receipts.",
     "how_to_complete": "Security level 45, 3,000 crimes in your state, 55 collections.",
     "requirements": {"security_level": 45, "crimes_in_state": 3000, "collections": 55},
     "rewards": {"vault_cash": 260_000, "xp_crimes_tokens": 1, "melt_tokens": 1, "booze_tokens": 1, "jailbust_tokens": 1}},
    {"id": "ibm_24", "order": 24, "title": "Siege rhythm",
     "story": "Keep hitting. Keep buying doors. Claim what the dead left behind.",
     "how_to_complete": "90 raid attempts, buy 10 guard slots total (this tier), kill 6 hitlist practice NPCs.",
     "requirements": {"raids_attempted": 90, "guard_slots_bought": 10, "hitlist_npc_kills": 6},
     "rewards": {"vault_cash": 290_000, "income_per_hour_add": 3_000, "jailbust_tokens": 1, "racket_tokens": 1, "properties_tokens": 1}},
    {"id": "ibm_25", "order": 25, "title": "Maximum lockdown",
     "story": "Every inch hardened. Every dollar counted twice.",
     "how_to_complete": "20,000 total crimes, full security (49 upgrades), 50 vault withdrawals.",
     "requirements": {"crimes": 20000, "security_level": 49, "vault_withdrawals": 50},
     "rewards": {"vault_cash": 325_000, "guard_weapon_max": 1, "xp_gta_tokens": 1, "oc_reduced_tokens": 1, "travel_tokens": 1}},
    {"id": "ibm_26", "order": 26, "title": "Don's ledger",
     "story": "You don't ask permission anymore. You set terms.",
     "how_to_complete": "Reach Don rank, 4,500 crimes in your state, win 55 raids.",
     "requirements": {"rank_id": 10, "crimes_in_state": 4500, "raids_won": 55},
     "rewards": {"vault_cash": 375_000, "racket_tokens": 2, "income_per_hour_add": 3_000, "xp_crimes_tokens": 1, "auto_rank_2h_tokens": 1}},
    {"id": "ibm_27", "order": 27, "title": "Perpetual motion",
     "story": "Collect, raid, hire — until the city forgets there was ever a rival.",
     "how_to_complete": "100 collections, 45 guards hired, 120 raid attempts.",
     "requirements": {"collections": 100, "guards_hired": 45, "raids_attempted": 120},
     "rewards": {"vault_cash": 425_000, "melt_tokens": 1, "booze_tokens": 1, "properties_tokens": 1, "jailbust_tokens": 1}},
    {"id": "ibm_28", "order": 28, "title": "Scorched ledgers",
     "story": "Thirty-five thousand crimes. Eight practice targets dropped. A dozen new slots.",
     "how_to_complete": "35,000 total crimes, kill 8 hitlist practice NPCs, buy 14 guard slots this tier.",
     "requirements": {"crimes": 35000, "hitlist_npc_kills": 8, "guard_slots_bought": 14},
     "rewards": {"vault_cash": 500_000, "income_per_hour_add": 3_000, "xp_crimes_tokens": 2, "racket_tokens": 1, "xp_gta_tokens": 1}},
    {"id": "ibm_29", "order": 29, "title": "Capo di tutti capi",
     "story": "Almost nobody gets here. Prove you earned the chair.",
     "how_to_complete": "Reach Capo di tutti capi rank, 110 collections, win 90 raids.",
     "requirements": {"rank_id": 11, "collections": 110, "raids_won": 90},
     "rewards": {"vault_cash": 600_000, "guard_slots": 2, "jailbust_tokens": 1, "income_per_hour_add": 5_000, "travel_tokens": 1, "oc_reduced_tokens": 1}},
    {"id": "ibm_30", "order": 30, "title": "Godfather's racket",
     "story": "The final grind — every lever of the business, pulled until they break or bend.",
     "how_to_complete": "Godfather rank; 55k crimes; 6k in-state; 140 collections; 160 raid attempts; 110 raid wins; 70 hires; 10 hitlist practice NPC kills.",
     "requirements": {
         "rank_id": 13,
         "crimes": 55000,
         "crimes_in_state": 6000,
         "collections": 140,
         "raids_attempted": 160,
         "raids_won": 110,
         "guards_hired": 70,
         "hitlist_npc_kills": 10,
     },
     "rewards": {"vault_cash": 1_000_000, "racket_tokens": 5, "xp_crimes_tokens": 2, "jailbust_tokens": 2, "income_per_hour_add": 6_200,
                 "melt_tokens": 1, "booze_tokens": 1, "properties_tokens": 1, "auto_rank_2h_tokens": 1}},
]

# Populated at EOF after all defs (avoids circular import with server).
ILLEGAL_BUSINESS_MISSIONS: List[Dict[str, Any]] = []

# Mission requirements that count only since baselines were set for this mission id (user.illegal_business_mission_baselines).
IBM_REQUIREMENT_USER_FIELDS = {
    "crimes_in_state": "illegal_business_crimes_in_state",
    "collections": "illegal_business_collections",
    "raids_won": "illegal_business_raids_won",
    "raids_attempted": "illegal_business_raids_attempted",
    "guards_hired": "illegal_business_guards_hired",
    "guard_slots_bought": "illegal_business_guard_slots_bought",
    "vault_withdrawals": "illegal_business_vault_withdrawals",
    "hitlist_npc_kills": "hitlist_npc_kills",
}
IBM_SEGMENT_KEYS = frozenset(IBM_REQUIREMENT_USER_FIELDS.keys())

# Default booze type for booze_making passive output (first BOOZE_TYPES id)
def _default_booze_type_id():
    from routers.money.booze_run import BOOZE_TYPES
    return BOOZE_TYPES[0]["id"] if BOOZE_TYPES else "bathtub_gin"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso_utc(raw: Optional[str], fallback: Optional[datetime] = None) -> datetime:
    dt = fallback or _utc_now()
    if not raw:
        return dt
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return fallback or _utc_now()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _clamp(num: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, num))


def _distillery_special_upgrade_cost(track: str, tier: int) -> int:
    base = int(DISTILLERY_SPECIAL_TRACK_BASE_COST.get(track, 1_200_000))
    cost = int(base * ((1 + 0.18 * max(1, tier)) ** 2.6) * DISTILLERY_PRICE_SCALE)
    return int(_clamp(cost, 10_000, DISTILLERY_MAX_SINGLE_UPGRADE_COST))


def _distillery_special_catalog() -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for track in DISTILLERY_SPECIAL_TRACKS:
        for tier in range(1, DISTILLERY_SPECIAL_PER_TRACK + 1):
            uid = f"{track}_{tier:02d}"
            effects: Dict[str, float] = {}
            if track == "production":
                effects = {"production_bonus": 0.08, "cash_bonus": 0.015}
            elif track == "aging":
                effects = {"quality_bonus": 0.05, "aging_cash_bonus": 0.02}
            elif track == "logistics":
                effects = {"automation_bonus": 0.04, "worker_efficiency": 0.01}
            elif track == "stealth":
                effects = {"heat_control": 0.035, "booze_loss_reduction": 0.01}
            elif track == "labor":
                effects = {"worker_efficiency": 0.03, "maintenance_bonus": 0.012}
            elif track == "black_market":
                effects = {"sale_margin_bonus": 0.025, "cash_bonus": 0.03}
            rows.append(
                {
                    "id": uid,
                    "track": track,
                    "tier": tier,
                    "name": f"{track.replace('_', ' ').title()} Ledger {tier}",
                    "cost": _distillery_special_upgrade_cost(track, tier),
                    "effects": effects,
                }
            )
    return rows


DISTILLERY_SPECIAL_CATALOG = _distillery_special_catalog()
DISTILLERY_SPECIAL_MAP = {row["id"]: row for row in DISTILLERY_SPECIAL_CATALOG}


def _distillery_special_effect_totals(distillery: dict) -> Dict[str, float]:
    unlocked = distillery.get("special_upgrades") or {}
    totals: Dict[str, float] = {
        "production_bonus": 0.0,
        "cash_bonus": 0.0,
        "quality_bonus": 0.0,
        "aging_cash_bonus": 0.0,
        "automation_bonus": 0.0,
        "worker_efficiency": 0.0,
        "heat_control": 0.0,
        "booze_loss_reduction": 0.0,
        "maintenance_bonus": 0.0,
        "sale_margin_bonus": 0.0,
    }
    for uid, enabled in unlocked.items():
        if not enabled:
            continue
        row = DISTILLERY_SPECIAL_MAP.get(uid)
        if not row:
            continue
        for key, val in (row.get("effects") or {}).items():
            totals[key] = float(totals.get(key, 0.0) + float(val))
    return totals


def _distillery_progression_state(distillery: dict) -> Dict[str, Any]:
    equipment = distillery.get("equipment") or {}
    unlocked_special = distillery.get("special_upgrades") or {}
    equipment_steps = 0
    for lane in DISTILLERY_EQUIPMENT_ORDER:
        equipment_steps += int(_clamp(int(equipment.get(lane) or 0), 0, DISTILLERY_EQUIPMENT_MAX_LEVEL))
    special_steps = 0
    for uid, enabled in unlocked_special.items():
        if enabled and uid in DISTILLERY_SPECIAL_MAP:
            special_steps += 1
    total_steps = equipment_steps + special_steps
    progress_pct = (total_steps / DISTILLERY_PROGRESS_TOTAL_STEPS) * 100.0 if DISTILLERY_PROGRESS_TOTAL_STEPS > 0 else 0.0
    return {
        "equipment_steps": equipment_steps,
        "special_steps": special_steps,
        "total_steps": total_steps,
        "max_steps": DISTILLERY_PROGRESS_TOTAL_STEPS,
        "progress_pct": round(progress_pct, 2),
        "near_hard_cap": progress_pct >= 94.0,
    }


def _distillery_apply_maintenance_degradation(distillery: dict, elapsed_hours: float, now: datetime) -> Dict[str, Any]:
    maintenance = float(distillery.get("maintenance") or 0.0)
    if maintenance > DISTILLERY_MAINTENANCE_DEGRADE_THRESHOLD:
        return {"lost_count": 0, "lost_equipment": [], "lost_special": []}
    checks = int(elapsed_hours // DISTILLERY_MAINTENANCE_DEGRADE_CHECK_HOURS)
    checks = max(0, min(DISTILLERY_MAINTENANCE_DEGRADE_MAX_PER_TICK, checks))
    if checks <= 0:
        return {"lost_count": 0, "lost_equipment": [], "lost_special": []}

    equipment = distillery.get("equipment") or {}
    specials = distillery.get("special_upgrades") or {}
    recent_failures = list(distillery.get("recent_failures") or [])
    stats = distillery.get("stats") or {}

    lost_equipment: List[str] = []
    lost_special: List[str] = []
    for _ in range(checks):
        chance = DISTILLERY_MAINTENANCE_DEGRADE_BASE_CHANCE + (
            (DISTILLERY_MAINTENANCE_DEGRADE_THRESHOLD - maintenance) / DISTILLERY_MAINTENANCE_DEGRADE_THRESHOLD
        ) * 0.35
        if maintenance <= DISTILLERY_MAINTENANCE_MELTDOWN_THRESHOLD:
            chance += DISTILLERY_MAINTENANCE_DEGRADE_MELTDOWN_BONUS
        chance = _clamp(chance, 0.08, 0.88)
        if _rng.random() >= chance:
            continue

        equipment_candidates = [lane for lane in DISTILLERY_EQUIPMENT_ORDER if int(equipment.get(lane) or 0) > 0]
        special_candidates = [uid for uid, enabled in specials.items() if enabled and uid in DISTILLERY_SPECIAL_MAP]
        if not equipment_candidates and not special_candidates:
            break

        degrade_equipment = bool(equipment_candidates) and (not special_candidates or _rng.random() < 0.72)
        if degrade_equipment:
            lane = _rng.choice(equipment_candidates)
            equipment[lane] = max(0, int(equipment.get(lane) or 0) - 1)
            lost_equipment.append(lane)
            stats["equipment_levels_lost_to_maintenance"] = int(stats.get("equipment_levels_lost_to_maintenance") or 0) + 1
            recent_failures.append({
                "type": "equipment_degrade",
                "item": lane,
                "at": now.isoformat(),
                "maintenance": round(maintenance, 2),
            })
        else:
            uid = _rng.choice(special_candidates)
            specials[uid] = False
            lost_special.append(uid)
            stats["special_upgrades_lost_to_maintenance"] = int(stats.get("special_upgrades_lost_to_maintenance") or 0) + 1
            recent_failures.append({
                "type": "special_degrade",
                "item": uid,
                "at": now.isoformat(),
                "maintenance": round(maintenance, 2),
            })

    if len(recent_failures) > 20:
        recent_failures = recent_failures[-20:]
    distillery["equipment"] = equipment
    distillery["special_upgrades"] = specials
    distillery["stats"] = stats
    distillery["recent_failures"] = recent_failures
    progression = _distillery_progression_state(distillery)
    distillery["mastery_tier"] = int(progression["total_steps"] // 30)
    return {
        "lost_count": len(lost_equipment) + len(lost_special),
        "lost_equipment": lost_equipment,
        "lost_special": lost_special,
    }


def _distillery_projected_24h_loss_forecast(distillery: dict) -> Dict[str, Any]:
    maintenance_now = float(distillery.get("maintenance") or 0.0)
    specials = distillery.get("special_upgrades") or {}
    equipment = distillery.get("equipment") or {}
    effects = _distillery_special_effect_totals(distillery)
    decay_rate = max(0.05, DISTILLERY_MAINTENANCE_DECAY_PER_HOUR * (1.0 - min(0.65, float(effects.get("maintenance_bonus", 0.0)))))
    check_hours = DISTILLERY_MAINTENANCE_DEGRADE_CHECK_HOURS
    checks = max(1, int(24.0 // check_hours))

    expected_losses = 0.0
    for i in range(checks):
        projected_maintenance = _clamp(maintenance_now - (decay_rate * (i * check_hours)), 0.0, 100.0)
        if projected_maintenance > DISTILLERY_MAINTENANCE_DEGRADE_THRESHOLD:
            continue
        chance = DISTILLERY_MAINTENANCE_DEGRADE_BASE_CHANCE + (
            (DISTILLERY_MAINTENANCE_DEGRADE_THRESHOLD - projected_maintenance) / DISTILLERY_MAINTENANCE_DEGRADE_THRESHOLD
        ) * 0.35
        if projected_maintenance <= DISTILLERY_MAINTENANCE_MELTDOWN_THRESHOLD:
            chance += DISTILLERY_MAINTENANCE_DEGRADE_MELTDOWN_BONUS
        chance = _clamp(chance, 0.08, 0.88)
        expected_losses += chance

    expected_losses = min(float(DISTILLERY_MAINTENANCE_DEGRADE_MAX_PER_TICK), expected_losses)
    expected_equipment_losses = expected_losses * 0.72
    expected_special_losses = expected_losses * 0.28

    equipment_rebuy_samples = []
    for lane in DISTILLERY_EQUIPMENT_ORDER:
        lvl = int(equipment.get(lane) or 0)
        if lvl > 0:
            equipment_rebuy_samples.append(_distillery_upgrade_cost(lane, lvl))
    avg_equipment_rebuy = (
        (sum(equipment_rebuy_samples) / len(equipment_rebuy_samples)) if equipment_rebuy_samples else 0.0
    )

    special_rebuy_samples = []
    for uid, enabled in specials.items():
        if enabled and uid in DISTILLERY_SPECIAL_MAP:
            special_rebuy_samples.append(int(DISTILLERY_SPECIAL_MAP[uid].get("cost") or 0))
    avg_special_rebuy = (
        (sum(special_rebuy_samples) / len(special_rebuy_samples)) if special_rebuy_samples else 0.0
    )

    expected_rebuy_cost = int(
        (expected_equipment_losses * avg_equipment_rebuy) + (expected_special_losses * avg_special_rebuy)
    )

    risk_band = "low"
    if expected_losses >= 0.8:
        risk_band = "moderate"
    if expected_losses >= 1.6:
        risk_band = "high"
    if expected_losses >= 2.4:
        risk_band = "critical"

    return {
        "hours": 24,
        "expected_downgrade_events": round(expected_losses, 2),
        "expected_equipment_losses": round(expected_equipment_losses, 2),
        "expected_special_losses": round(expected_special_losses, 2),
        "expected_rebuy_cost": max(0, expected_rebuy_cost),
        "risk_band": risk_band,
    }


def _distillery_default(now: datetime) -> Dict[str, Any]:
    return {
        "equipment": {lane: 0 for lane in DISTILLERY_EQUIPMENT_ORDER},
        "workers": {role: 0 for role in DISTILLERY_WORKER_ROLES},
        "worker_capacity": DISTILLERY_BASE_WORKER_CAP,
        "worker_hires": 0,
        "maintenance": 100.0,
        "last_maintenance_at": now.isoformat(),
        "heat": 0.0,
        "last_heat_at": now.isoformat(),
        "shutdown_until": None,
        "auto_sell": {
            "enabled": True,
            "mode": "booze_run",
            "booze_id": _default_booze_type_id(),
            "min_inventory": 50,
            "batch_size": 30,
        },
        "auto_aging": {
            "enabled": True,
            "tier": "standard",
            "reserve_units": 0,
            "auto_collect_booze": True,
        },
        "special_upgrades": {},
        "mastery_tier": 0,
        "aging_queue": [],
        "stats": {
            "total_batches_started": 0,
            "total_batches_claimed": 0,
            "total_booze_auto_sold": 0,
            "total_auto_sell_cash": 0,
            "total_booze_run_auto_vault": 0,
            "heat_events_survived": 0,
            "premium_sells": 0,
            "booze_lost_to_heat": 0,
            "booze_lost_events": 0,
            "equipment_levels_lost_to_maintenance": 0,
            "special_upgrades_lost_to_maintenance": 0,
        },
        "risk_actions": {"cool_off": 0, "bribe_crackdown": 0},
        "last_risk_action_at": None,
        "recent_failures": [],
        "last_tick_at": now.isoformat(),
        "last_auto_collect_at": None,
        "automation_baseline_v1": True,
    }


def _distillery_upgrade_cost(lane: str, next_level: int) -> int:
    base = int(DISTILLERY_LANE_BASE_COST.get(lane, 15_000))
    lvl = max(1, int(next_level))
    core = (1 + (0.22 * lvl)) ** 4.5
    high_end_track = lane in {"quality_lab", "bribe_office", "fake_labels"}
    premium = 1.12 if high_end_track else 1.0
    cost = int(base * core * premium * DISTILLERY_PRICE_SCALE)
    return int(_clamp(cost, 5_000, DISTILLERY_MAX_SINGLE_UPGRADE_COST))


def _distillery_worker_capacity(equipment: Dict[str, Any]) -> int:
    office_level = int((equipment or {}).get("bribe_office") or 0)
    cap = DISTILLERY_BASE_WORKER_CAP + office_level * 2
    return int(_clamp(cap, DISTILLERY_BASE_WORKER_CAP, DISTILLERY_MAX_WORKER_CAP))


def _distillery_ensure_state(business: dict, now: Optional[datetime] = None) -> tuple[Optional[dict], bool]:
    ts = now or _utc_now()
    changed = False
    dist = business.get("distillery")
    if not isinstance(dist, dict):
        dist = _distillery_default(ts)
        business["distillery"] = dist
        return dist, True
    equipment = dist.get("equipment")
    if not isinstance(equipment, dict):
        equipment = {}
        dist["equipment"] = equipment
        changed = True
    for lane in DISTILLERY_EQUIPMENT_ORDER:
        if lane not in equipment:
            equipment[lane] = 0
            changed = True
    workers = dist.get("workers")
    if not isinstance(workers, dict):
        workers = {}
        dist["workers"] = workers
        changed = True
    for role in DISTILLERY_WORKER_ROLES:
        if role not in workers:
            workers[role] = 0
            changed = True
    expected_capacity = _distillery_worker_capacity(equipment)
    if int(dist.get("worker_capacity") or 0) != expected_capacity:
        dist["worker_capacity"] = expected_capacity
        changed = True
    if "worker_hires" not in dist:
        dist["worker_hires"] = int(sum(int(workers.get(r) or 0) for r in DISTILLERY_WORKER_ROLES))
        changed = True
    if "maintenance" not in dist:
        dist["maintenance"] = 100.0
        changed = True
    if "last_maintenance_at" not in dist:
        dist["last_maintenance_at"] = ts.isoformat()
        changed = True
    if "heat" not in dist:
        dist["heat"] = 0.0
        changed = True
    if "last_heat_at" not in dist:
        dist["last_heat_at"] = ts.isoformat()
        changed = True
    if "shutdown_until" not in dist:
        dist["shutdown_until"] = None
        changed = True
    auto_sell = dist.get("auto_sell")
    if not isinstance(auto_sell, dict):
        auto_sell = {}
        dist["auto_sell"] = auto_sell
        changed = True
    if "enabled" not in auto_sell:
        auto_sell["enabled"] = True
        changed = True
    if "booze_id" not in auto_sell:
        auto_sell["booze_id"] = _default_booze_type_id()
        changed = True
    if "min_inventory" not in auto_sell:
        auto_sell["min_inventory"] = 50
        changed = True
    if "batch_size" not in auto_sell:
        auto_sell["batch_size"] = 30
        changed = True
    if "mode" not in auto_sell:
        auto_sell["mode"] = "booze_run"
        changed = True
    _asm = str(auto_sell.get("mode") or "booze_run").lower()
    if _asm not in DISTILLERY_AUTO_SELL_MODES:
        auto_sell["mode"] = "booze_run"
        changed = True
    auto_aging = dist.get("auto_aging")
    if not isinstance(auto_aging, dict):
        auto_aging = {
            "enabled": True,
            "tier": "standard",
            "reserve_units": 0,
            "auto_collect_booze": True,
        }
        dist["auto_aging"] = auto_aging
        changed = True
    else:
        if "enabled" not in auto_aging:
            auto_aging["enabled"] = True
            changed = True
        if "tier" not in auto_aging or str(auto_aging.get("tier") or "").lower() not in DISTILLERY_AGING_TIERS:
            auto_aging["tier"] = "standard"
            changed = True
        if "reserve_units" not in auto_aging:
            auto_aging["reserve_units"] = 0
            changed = True
        if "auto_collect_booze" not in auto_aging:
            auto_aging["auto_collect_booze"] = True
            changed = True
    if not dist.get("automation_baseline_v1"):
        dist["automation_baseline_v1"] = True
        auto_aging["enabled"] = True
        changed = True
    if "last_auto_collect_at" not in dist:
        dist["last_auto_collect_at"] = None
        changed = True
    if "allow_vault_for_heat" not in dist:
        dist["allow_vault_for_heat"] = True
        changed = True
    special_upgrades = dist.get("special_upgrades")
    if not isinstance(special_upgrades, dict):
        dist["special_upgrades"] = {}
        changed = True
    if "mastery_tier" not in dist:
        dist["mastery_tier"] = 0
        changed = True
    aging_queue = dist.get("aging_queue")
    if not isinstance(aging_queue, list):
        dist["aging_queue"] = []
        changed = True
    stats = dist.get("stats")
    if not isinstance(stats, dict):
        stats = {}
        dist["stats"] = stats
        changed = True
    for key in (
        "total_batches_started",
        "total_batches_claimed",
        "total_booze_auto_sold",
        "total_auto_sell_cash",
        "total_booze_run_auto_vault",
        "heat_events_survived",
        "premium_sells",
        "booze_lost_to_heat",
        "booze_lost_events",
        "equipment_levels_lost_to_maintenance",
        "special_upgrades_lost_to_maintenance",
    ):
        if key not in stats:
            stats[key] = 0
            changed = True
    legacy_hand = int(stats.get("total_booze_run_auto_hand") or 0)
    if legacy_hand > 0:
        stats["total_booze_run_auto_vault"] = int(stats.get("total_booze_run_auto_vault") or 0) + legacy_hand
        stats.pop("total_booze_run_auto_hand", None)
        changed = True
    risk_actions = dist.get("risk_actions")
    if not isinstance(risk_actions, dict):
        dist["risk_actions"] = {"cool_off": 0, "bribe_crackdown": 0}
        changed = True
    else:
        if "cool_off" not in risk_actions:
            risk_actions["cool_off"] = 0
            changed = True
        if "bribe_crackdown" not in risk_actions:
            risk_actions["bribe_crackdown"] = 0
            changed = True
    if "last_risk_action_at" not in dist:
        dist["last_risk_action_at"] = None
        changed = True
    if not isinstance(dist.get("recent_failures"), list):
        dist["recent_failures"] = []
        changed = True
    prog = _distillery_progression_state(dist)
    expected_mastery = int(prog["total_steps"] // 30)
    if int(dist.get("mastery_tier") or 0) != expected_mastery:
        dist["mastery_tier"] = expected_mastery
        changed = True
    if "last_tick_at" not in dist:
        dist["last_tick_at"] = ts.isoformat()
        changed = True
    if _distillery_forgive_stale_risk_cooldown(dist):
        changed = True
    return dist, changed


def _distillery_forgive_stale_risk_cooldown(distillery: dict) -> bool:
    """Old balance only trimmed heat; if still critical+ on cooldown, allow paying again."""
    heat = float(distillery.get("heat") or 0.0)
    if heat < float(DISTILLERY_HEAT_THRESHOLDS["critical"]):
        return False
    if not distillery.get("last_risk_action_at"):
        return False
    distillery["last_risk_action_at"] = None
    return True


def _distillery_decay_and_status(distillery: dict, now: datetime) -> dict:
    last_tick = _parse_iso_utc(distillery.get("last_tick_at"), now)
    elapsed_hours = max(0.0, (now - last_tick).total_seconds() / 3600.0)
    specials = _distillery_special_effect_totals(distillery)
    maintenance = float(distillery.get("maintenance") or 0.0)
    decay_rate = max(0.05, DISTILLERY_MAINTENANCE_DECAY_PER_HOUR * (1.0 - min(0.65, float(specials.get("maintenance_bonus", 0.0)))))
    maintenance = _clamp(maintenance - (elapsed_hours * decay_rate), 0.0, 100.0)
    shutdown_until = _parse_iso_utc(distillery.get("shutdown_until"), now)
    is_shutdown = bool(distillery.get("shutdown_until")) and now < shutdown_until
    heat = float(distillery.get("heat") or 0.0)
    workers = distillery.get("workers") or {}
    security_workers = int(workers.get("security") or 0)
    heat_decay = DISTILLERY_HEAT_DECAY_PER_HOUR + security_workers * 0.18 + float(specials.get("heat_control", 0.0)) * 0.45
    if is_shutdown:
        # Lay low while closed — extra bleed so enforcement shutdown isn't "stuck hot" for days.
        heat_decay *= 2.35
    heat = _clamp(heat - (elapsed_hours * heat_decay), 0.0, 100.0)
    distillery["maintenance"] = maintenance
    distillery["heat"] = heat
    distillery["last_tick_at"] = now.isoformat()
    distillery["last_heat_at"] = now.isoformat()
    if distillery.get("shutdown_until") and now >= shutdown_until:
        distillery["shutdown_until"] = None
        is_shutdown = False
    maintenance_degradation = _distillery_apply_maintenance_degradation(distillery, elapsed_hours, now)
    return {
        "elapsed_hours": elapsed_hours,
        "maintenance": maintenance,
        "heat": heat,
        "is_shutdown": is_shutdown,
        "shutdown_until": distillery.get("shutdown_until"),
        "maintenance_degradation": maintenance_degradation,
    }


def _distillery_output_modifiers(distillery: dict) -> dict:
    equipment = distillery.get("equipment") or {}
    workers = distillery.get("workers") or {}
    specials = _distillery_special_effect_totals(distillery)
    maintenance = float(distillery.get("maintenance") or 0.0)
    heat = float(distillery.get("heat") or 0.0)
    mastery_tier = int(distillery.get("mastery_tier") or 0)

    worker_eff = 1.0 + float(specials.get("worker_efficiency", 0.0))
    production_mult = 1.0
    production_mult += int(equipment.get("stills") or 0) * 0.14
    production_mult += int(equipment.get("condensers") or 0) * 0.11
    production_mult += int(equipment.get("mash_tun") or 0) * 0.09
    production_mult += int(equipment.get("bottling") or 0) * 0.07
    production_mult += int(workers.get("production") or 0) * 0.03 * worker_eff
    production_mult += float(specials.get("production_bonus", 0.0))
    production_mult += mastery_tier * 0.06

    quality_mult = 1.0
    quality_mult += int(equipment.get("barrels") or 0) * 0.05
    quality_mult += int(equipment.get("quality_lab") or 0) * 0.06
    quality_mult += int(workers.get("quality") or 0) * 0.02 * worker_eff
    quality_mult += float(specials.get("quality_bonus", 0.0))
    quality_mult += float(specials.get("aging_cash_bonus", 0.0))

    maintenance_penalty = 1.0
    if maintenance < 60:
        maintenance_penalty = 1.0 - ((60.0 - maintenance) / 100.0)
    heat_penalty = 1.0
    if heat >= DISTILLERY_HEAT_THRESHOLDS["hot"]:
        heat_penalty -= 0.20
    if heat >= DISTILLERY_HEAT_THRESHOLDS["critical"]:
        heat_penalty -= 0.25
    if heat >= 90:
        heat_penalty -= 0.10

    automation_bonus = float(specials.get("automation_bonus", 0.0))
    automation_mult = 1.0 + min(1.2, automation_bonus)
    cash_mult = 1.0 + int(equipment.get("bribe_office") or 0) * 0.025 + float(specials.get("cash_bonus", 0.0))
    cash_mult += mastery_tier * 0.015

    margin = DISTILLERY_AUTO_SELL_MARGIN_BASE + int(workers.get("sales") or 0) * 0.01 * worker_eff
    margin += int(equipment.get("fake_labels") or 0) * 0.01
    margin += float(specials.get("sale_margin_bonus", 0.0))
    margin = _clamp(margin, DISTILLERY_AUTO_SELL_MARGIN_BASE, DISTILLERY_AUTO_SELL_MARGIN_CAP)
    heat_gain_mult = _clamp(1.0 - (float(specials.get("heat_control", 0.0)) * 0.24), 0.55, 1.0)
    booze_loss_reduction = _clamp(float(specials.get("booze_loss_reduction", 0.0)), 0.0, 0.8)

    return {
        "production_mult": max(DISTILLERY_COLLECT_ROI_SAFETY_FLOOR, production_mult) * automation_mult * _clamp(maintenance_penalty, 0.25, 1.0) * _clamp(heat_penalty, 0.4, 1.0),
        "quality_mult": _clamp(max(1.0, quality_mult), 1.0, 3.2),
        "auto_sell_margin": margin,
        "cash_mult": _clamp(cash_mult, 1.0, 4.5),
        "heat_gain_mult": heat_gain_mult,
        "booze_loss_reduction": booze_loss_reduction,
        "automation_mult": automation_mult,
    }


def _token_until_active(until_raw: Optional[str], now: datetime) -> bool:
    if not until_raw:
        return False
    try:
        until = datetime.fromisoformat(until_raw.replace("Z", "+00:00"))
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        return now < until
    except Exception:
        return False


def _racket_token_income_mult(user: Optional[dict], now: datetime) -> float:
    if user and _token_until_active(user.get("racket_until"), now):
        return RACKET_TOKEN_INCOME_MULT
    return 1.0


def _booze_token_distillery_mult(user: Optional[dict], now: datetime) -> float:
    if user and _token_until_active(user.get("booze_until"), now):
        return BOOZE_TOKEN_DISTILLERY_MULT
    return 1.0


def _distillery_cash_token_mult(user: Optional[dict], now: datetime) -> float:
    return _racket_token_income_mult(user, now) * _booze_token_distillery_mult(user, now)


def _distillery_roi_snapshot(
    distillery: dict,
    business: dict,
    user: Optional[dict] = None,
    now: Optional[datetime] = None,
) -> dict:
    now = now or _utc_now()
    racket_mult = _racket_token_income_mult(user, now)
    booze_mult = _booze_token_distillery_mult(user, now)
    distillery_cash_mult = racket_mult * booze_mult
    equipment = distillery.get("equipment") or {}
    workers = distillery.get("workers") or {}
    worker_cap = int(distillery.get("worker_capacity") or DISTILLERY_BASE_WORKER_CAP)
    bph = int(business.get("booze_per_hour") or BOOZE_PER_HOUR_BASE)
    base_cash_per_hour = float(business.get("income_per_hour") or INCOME_PER_HOUR_BASE)
    mods = _distillery_output_modifiers(distillery)
    effective_booze_per_hour = bph * mods["production_mult"] * booze_mult
    implied_cash_per_hour = (base_cash_per_hour * mods["cash_mult"] * racket_mult) + (
        effective_booze_per_hour
        * DISTILLERY_BASE_BOOZE_UNIT_VALUE
        * mods["auto_sell_margin"]
        * mods["quality_mult"]
        * distillery_cash_mult
    )
    heat = float(distillery.get("heat") or 0.0)
    downside_exposure = 0.0
    if heat >= DISTILLERY_HEAT_BOOZE_LOSS_THRESHOLDS["hot"]:
        downside_exposure += 0.08
    if heat >= DISTILLERY_HEAT_BOOZE_LOSS_THRESHOLDS["critical"]:
        downside_exposure += 0.14
    if heat >= DISTILLERY_HEAT_BOOZE_LOSS_THRESHOLDS["meltdown"]:
        downside_exposure += 0.16
    downside_exposure = _clamp(downside_exposure * (1.0 - float(mods.get("booze_loss_reduction", 0.0))), 0.0, 0.55)
    risk_adjusted_cash_per_hour = implied_cash_per_hour * (1.0 - downside_exposure)

    best_lane = None
    best_hours = None
    for lane in DISTILLERY_EQUIPMENT_ORDER:
        cur = int(equipment.get(lane) or 0)
        if cur >= DISTILLERY_EQUIPMENT_MAX_LEVEL:
            continue
        next_lvl = cur + 1
        cost = _distillery_upgrade_cost(lane, next_lvl)
        rough_delta = max(500.0, risk_adjusted_cash_per_hour * (0.022 + (0.0035 * min(next_lvl, 24))))
        payback_h = round(cost / rough_delta, 2)
        if best_hours is None or payback_h < best_hours:
            best_lane = lane
            best_hours = payback_h

    sales_workers = int(workers.get("sales") or 0)
    worker_payback = None
    if sales_workers < worker_cap:
        worker_gain = max(350.0, effective_booze_per_hour * DISTILLERY_BASE_BOOZE_UNIT_VALUE * 0.04)
        worker_payback = round(DISTILLERY_WORKER_HIRE_COST / worker_gain, 2)

    tier_roi = {}
    for tier_id, tier in DISTILLERY_AGING_TIERS.items():
        base = DISTILLERY_BASE_BOOZE_UNIT_VALUE
        tier_roi[tier_id] = round((base * float(tier["cash_mult"])) / max(1.0, base), 3)

    projected_12d = risk_adjusted_cash_per_hour * DISTILLERY_TOP_END_HOURS
    hard_cap_progress = _clamp(projected_12d / DISTILLERY_TARGET_12D_TOP_END, 0.0, 1.8)

    return {
        "cash_per_hour_estimate": round(implied_cash_per_hour, 2),
        "booze_per_hour_estimate": round(effective_booze_per_hour, 2),
        "risk_adjusted_cash_per_hour_estimate": round(risk_adjusted_cash_per_hour, 2),
        "downside_exposure": round(downside_exposure, 4),
        "next_upgrade_lane": best_lane,
        "next_upgrade_payback_hours": best_hours,
        "worker_payback_hours": worker_payback,
        "aging_tier_roi": tier_roi,
        "projected_12d_income": round(projected_12d, 2),
        "hard_cap_progress": round(hard_cap_progress, 4),
        "target_12d_top_end": DISTILLERY_TARGET_12D_TOP_END,
        "efficiency_score": round((_clamp(float(distillery.get("maintenance") or 0.0), 0.0, 100.0) * 0.42) + ((100.0 - _clamp(float(distillery.get("heat") or 0.0), 0.0, 100.0)) * 0.58), 2),
        "racket_token_active": racket_mult > 1.0,
        "booze_token_active": booze_mult > 1.0,
        "racket_token_income_mult": racket_mult,
        "booze_token_distillery_mult": booze_mult,
    }


def _distillery_heat_label(heat: float) -> str:
    if heat >= DISTILLERY_HEAT_THRESHOLDS["critical"]:
        return "critical"
    if heat >= DISTILLERY_HEAT_THRESHOLDS["hot"]:
        return "hot"
    if heat >= DISTILLERY_HEAT_THRESHOLDS["warm"]:
        return "warm"
    return "low"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _user_rank_id(user: dict) -> int:
    rp = int(user.get("rank_points") or 0)
    mult = float(user.get("prestige_rank_multiplier") or 1.0)
    rid, _ = get_rank_info(rp, mult)
    return rid


def _guard_gear_upgrade_cost(current_level: int) -> int:
    """Vault cost to raise armour or weapon from current_level to current_level+1."""
    lv = max(0, int(current_level))
    return int(GUARD_UPGRADE_BASE_CASH * (GUARD_UPGRADE_LEVEL_MULT**lv))


def _guard_level_caps(business: dict) -> Tuple[int, int]:
    """Max armour_level and weapon_level for hires and upgrades (mission unlocks)."""
    w_unlock = int(business.get("guard_weapon_max_unlock") or 0)
    a_raw = business.get("guard_armour_max_unlock")
    if a_raw is None:
        a_unlock = w_unlock
    else:
        a_unlock = int(a_raw)
    armour_max = min(GUARD_ARMOUR_MAX, GUARD_ARMOUR_BASE_MAX + a_unlock)
    weapon_max = min(GUARD_WEAPON_MAX, GUARD_WEAPON_BASE_MAX + w_unlock)
    return armour_max, weapon_max


def _guard_doc_with_upgrade_costs(business: dict, guard: dict) -> dict:
    armour_max, weapon_max = _guard_level_caps(business)
    al = int(guard.get("armour_level") or 0)
    wl = int(guard.get("weapon_level") or 0)
    row = dict(guard)
    row["next_armour_upgrade_cost"] = None if al >= armour_max else _guard_gear_upgrade_cost(al)
    row["next_weapon_upgrade_cost"] = None if wl >= weapon_max else _guard_gear_upgrade_cost(wl)
    return row


def _business_defender_strength(business: dict, guards: List[dict]) -> float:
    base = DEFENDER_BASE_STRENGTH + float(business.get("defender_strength_bonus") or 0)
    guard_sum = 0
    for g in guards:
        armour = int(g.get("armour_level") or 0)
        weapon = int(g.get("weapon_level") or 0)
        guard_sum += (armour + weapon) * GUARD_STRENGTH_PER_LEVEL
    security_level = int(business.get("security_level") or 0)
    upgrades = business.get("security_upgrades") or []
    if isinstance(upgrades, dict):
        upgrade_count = sum(upgrades.values()) if isinstance(next(iter(upgrades.values()), 0), (int, float)) else len(upgrades)
    else:
        upgrade_count = len(upgrades) if isinstance(upgrades, list) else security_level
    security_value = sum(
        SECURITY_UPGRADES[i].get("defence_weight", 10)
        for i in range(min(upgrade_count, len(SECURITY_UPGRADES)))
    )
    if security_value == 0 and security_level > 0:
        security_value = security_level * 10
    return base + guard_sum + security_value


def _attacker_strength(user: dict) -> float:
    """Use character rank + weapon/armour as raiding crew (plan option B)."""
    base = ATTACKER_BASE_STRENGTH
    rank_id = _user_rank_id(user)
    rank_contrib = rank_id * 6
    armour = int(user.get("armour_level") or 0)
    weapon_contrib = 0
    # Equipped weapon: check user_weapons for equipped or best
    uw = user.get("equipped_weapon_id") or user.get("weapon_id")
    if uw:
        weapon_contrib = 8
    return base + rank_contrib + (armour * 4) + weapon_contrib


def _raid_win_probability(attacker_str: float, defender_str: float) -> float:
    variance = 1.0 + _rng.uniform(-RAID_VARIANCE, RAID_VARIANCE)
    a = attacker_str * variance
    d = max(1.0, defender_str)
    return a / (a + d)


def _effective_raid_daily_limit(user: dict) -> int:
    raw = int(user.get("illegal_business_raid_daily_limit") or RAID_DAILY_LIMIT_DEFAULT)
    return max(RAID_DAILY_LIMIT_DEFAULT, min(RAID_DAILY_LIMIT_MAX, raw))


def _is_moderately_upgraded(business: dict) -> bool:
    level = int(business.get("level") or 1)
    security_level = int(business.get("security_level") or 0)
    upgrades = business.get("security_upgrades") or []
    if isinstance(upgrades, list):
        upgrade_count = len(upgrades)
    elif isinstance(upgrades, dict):
        upgrade_count = sum(1 for v in (upgrades.values() or []) if v)
    else:
        upgrade_count = security_level
    return level >= MODERATELY_UPGRADED_LEVEL and (security_level >= MODERATELY_UPGRADED_SECURITY or upgrade_count >= 1)


async def _kill_reward_liquidation_cash(business_snapshot: dict, killer_user: dict) -> int:
    """Weekly-style cash from seized operation: base till rate x level mult x hours x event x prestige (no killer IBM % buff)."""
    income_per_hour = int(business_snapshot.get("income_per_hour") or INCOME_PER_HOUR_BASE)
    level = int(business_snapshot.get("level") or 1)
    level_mult = 1.0 + 0.04 * max(0, level - 1)
    gross = float(income_per_hour) * level_mult * float(KILL_REWARD_LIQUIDATION_HOURS)
    ev = await get_effective_event()
    prestige = get_prestige_bonus(killer_user)
    mult = float(ev.get("racket_payout", 1.0)) * float(prestige.get("illegal_business_mult", 1.0))
    return max(0, int(round(gross * mult)))


async def _liquidation_preview_for_kill_entry(entry: dict, killer_user: dict) -> int:
    if entry.get("business_snapshot"):
        return await _kill_reward_liquidation_cash(entry["business_snapshot"], killer_user)
    return max(0, int(entry.get("total_spent") or 0))


async def _pending_kill_rewards_with_previews(
    pending: list,
    killer_user: dict,
    killer_business: Optional[dict] = None,
) -> list:
    out = []
    for p in pending:
        row = dict(p)
        row["liquidation_preview"] = await _liquidation_preview_for_kill_entry(p, killer_user)
        snap = p.get("business_snapshot")
        has_snap = bool(p.get("has_snapshot") and snap)
        row["takeover_available"] = bool(
            has_snap and _seized_snapshot_stronger_than_current(snap, killer_business)
        )
        row["absorb_available"] = bool(
            has_snap and killer_business is not None and not _seized_snapshot_stronger_than_current(snap, killer_business)
        )
        row.pop("business_snapshot", None)
        row.pop("guards_snapshot", None)
        out.append(row)
    return out


def _ordered_ibm_missions():
    return sorted(ILLEGAL_BUSINESS_MISSIONS, key=lambda x: x["order"])


def _ibm_mission_after(completed_id: str):
    ordered = _ordered_ibm_missions()
    for i, m in enumerate(ordered):
        if m["id"] == completed_id and i + 1 < len(ordered):
            return ordered[i + 1]
    return None


def _ibm_baselines_map(user: dict) -> Dict[str, Any]:
    return user.get("illegal_business_mission_baselines") or {}


def _ibm_baseline_int(user: dict, mission_id: str, key: str) -> int:
    block = _ibm_baselines_map(user).get(mission_id) or {}
    return int(block.get(key) or 0)


def _ibm_user_counter_raw(user: dict, req_key: str) -> int:
    field = IBM_REQUIREMENT_USER_FIELDS.get(req_key)
    if not field:
        return 0
    return int(user.get(field) or 0)


def _ibm_mission_user_projection() -> Dict[str, int]:
    proj = {"_id": 0, "illegal_business_mission_completions": 1, "illegal_business_mission_baselines": 1}
    for f in IBM_REQUIREMENT_USER_FIELDS.values():
        proj[f] = 1
    proj["total_crimes"] = 1
    proj["rank_points"] = 1
    proj["prestige_rank_multiplier"] = 1
    return proj


def _ibm_requirement_current(
    user: dict,
    business: Optional[dict],
    mission: dict,
    key: str,
    active_guards_count: Optional[int] = None,
) -> int:
    """Progress for one requirement. Segmented keys use illegal_business_mission_baselines for this mission id."""
    if key == "crimes":
        return int(user.get("total_crimes") or 0)
    if key == "rank_id":
        return _user_rank_id(user)
    if key == "security_level":
        if not business:
            return 0
        return len(business.get("security_upgrades") or [])
    if key == "guards_hired":
        raw = _ibm_user_counter_raw(user, key)
        base = _ibm_baseline_int(user, mission["id"], key)
        delta_since_start = max(0, raw - base)
        # Prevent undercount/soft-locks on legacy records by accepting the strongest guard signal.
        active_count = int(active_guards_count or 0)
        slots_count = int((business or {}).get("guard_slots") or 0)
        return max(delta_since_start, active_count, slots_count)
    if key in IBM_SEGMENT_KEYS:
        raw = _ibm_user_counter_raw(user, key)
        base = _ibm_baseline_int(user, mission["id"], key)
        return max(0, raw - base)
    return 0


def _ibm_mission_progress_row(
    user: dict,
    business: Optional[dict],
    mission: dict,
    completed_ids: set,
    active_guards_count: Optional[int] = None,
) -> Dict[str, Any]:
    req = mission.get("requirements") or {}
    cur = {
        key: _ibm_requirement_current(
            user,
            business,
            mission,
            key,
            active_guards_count=active_guards_count,
        )
        for key in req
    }
    return {"mission": mission, "completed": mission["id"] in completed_ids, "current": cur, "target": req}


def _ibm_baseline_snapshot_for_requirements(user: dict, req: Dict[str, Any]) -> Dict[str, int]:
    snap: Dict[str, int] = {}
    for k in req:
        if k in IBM_SEGMENT_KEYS:
            snap[k] = _ibm_user_counter_raw(user, k)
    return snap


async def _ibm_set_baselines_for_next_mission(user_id: str, completed_mission_id: str):
    nxt = _ibm_mission_after(completed_mission_id)
    if not nxt:
        return
    proj = {f: 1 for f in IBM_REQUIREMENT_USER_FIELDS.values()}
    u = await db.users.find_one({"id": user_id}, proj)
    if not u:
        return
    req = nxt.get("requirements") or {}
    snap = _ibm_baseline_snapshot_for_requirements(u, req)
    if not snap:
        return
    await db.users.update_one(
        {"id": user_id},
        {"$set": {f"illegal_business_mission_baselines.{nxt['id']}": snap}},
    )


async def _ibm_ensure_mission_baselines(user_id: str, u: dict) -> None:
    """Backfill baselines for incomplete missions when prior mission is done (e.g. new missions after ibm_15)."""
    baselines = dict(u.get("illegal_business_mission_baselines") or {})
    completions = u.get("illegal_business_mission_completions") or []
    completed_ids = {c.get("mission_id") for c in completions if c.get("mission_id")}
    ordered = _ordered_ibm_missions()
    set_ops: Dict[str, Any] = {}
    for m in ordered:
        mid = m["id"]
        if mid in completed_ids:
            continue
        prev = next((x for x in ordered if x["order"] == m["order"] - 1), None)
        if prev is not None and prev["id"] not in completed_ids:
            continue
        req = m.get("requirements") or {}
        seg_keys = [k for k in req if k in IBM_SEGMENT_KEYS]
        if not seg_keys:
            continue
        block = baselines.get(mid) or {}
        if block and all(k in block for k in seg_keys):
            continue
        if not block:
            new_snap = {k: _ibm_user_counter_raw(u, k) for k in seg_keys}
        else:
            new_snap = {**block}
            for k in seg_keys:
                if k not in new_snap:
                    new_snap[k] = _ibm_user_counter_raw(u, k)
        baselines[mid] = new_snap
        u.setdefault("illegal_business_mission_baselines", {})[mid] = new_snap
        set_ops[f"illegal_business_mission_baselines.{mid}"] = new_snap
    if set_ops:
        await db.users.update_one({"id": user_id}, {"$set": set_ops})


async def _ibm_load_user_with_mission_baselines(user_id: str, base_user: dict) -> dict:
    u = await db.users.find_one({"id": user_id}, _ibm_mission_user_projection())
    if not u:
        return base_user
    await _ibm_ensure_mission_baselines(user_id, u)
    out = dict(base_user)
    for k, v in u.items():
        if k == "_id":
            continue
        out[k] = v
    return out


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class StartBusinessRequest(BaseModel):
    type_id: str
    name: Optional[str] = None


class RaidRequest(BaseModel):
    target_username: str
    state: Optional[str] = None


class ClaimKillRewardRequest(BaseModel):
    victim_id: str
    choice: str  # "takeover" | "liquidate" | "absorb"
    new_name: Optional[str] = None


class HireGuardRequest(BaseModel):
    slot_number: int
    armour_level: int = 0
    weapon_level: int = 0


class GuardGearUpgradeRequest(BaseModel):
    guard_id: str
    upgrade_armour: bool = False
    upgrade_weapon: bool = False


class WithdrawRequest(BaseModel):
    amount: int


class PatchBusinessRequest(BaseModel):
    name: Optional[str] = None


class DistilleryUpgradeEquipmentRequest(BaseModel):
    lane: str


class DistilleryAssignWorkersRequest(BaseModel):
    production: int = 0
    quality: int = 0
    security: int = 0
    sales: int = 0


class DistilleryMaintenanceRequest(BaseModel):
    recover_points: int = 10


class DistilleryAutoSellRequest(BaseModel):
    enabled: bool = False
    mode: Optional[str] = None  # crew | booze_run
    booze_id: Optional[str] = None
    min_inventory: int = 50
    batch_size: int = 30


class DistilleryAutoAgingRequest(BaseModel):
    enabled: bool = False
    tier: str = "standard"
    reserve_units: int = 0
    auto_collect_booze: bool = True


class DistilleryPassiveBoozePausedRequest(BaseModel):
    paused: bool = True


class DistilleryStartAgingRequest(BaseModel):
    tier: str
    quantity: int


class DistilleryClaimBatchRequest(BaseModel):
    batch_id: str


class DistilleryBuySpecialUpgradeRequest(BaseModel):
    upgrade_id: str


class DistilleryRiskActionRequest(BaseModel):
    action: str  # cool_off | bribe_crackdown


class DistilleryHeatVaultSpendRequest(BaseModel):
    """When False, enforcement cannot seize vault cash on collect and Cool Off/Bribe are blocked."""
    allow_vault_for_heat: bool = True


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
async def get_illegal_business_types(current_user: dict = Depends(get_current_user)):
    """Return available business types (for start screen when user has no business)."""
    return {"types": ILLEGAL_BUSINESS_TYPES}


async def _distillery_business_readonly(current_user: dict) -> tuple[dict, dict]:
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    now = _utc_now()
    dist, changed = _distillery_ensure_state(business, now)
    set_updates: Dict[str, Any] = {}
    if business.get("booze_per_hour") is None:
        business["booze_per_hour"] = BOOZE_PER_HOUR_BASE
        set_updates["booze_per_hour"] = BOOZE_PER_HOUR_BASE
    if business.get("booze_cap_hours") is None:
        business["booze_cap_hours"] = BOOZE_CAP_HOURS_BASE
        set_updates["booze_cap_hours"] = BOOZE_CAP_HOURS_BASE
    if not business.get("last_collected_booze_at"):
        business["last_collected_booze_at"] = now.isoformat()
        set_updates["last_collected_booze_at"] = business["last_collected_booze_at"]
    if changed:
        set_updates["distillery"] = dist
    if set_updates:
        await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": set_updates})
    return business, dist


async def _distillery_business_for_user(current_user: dict) -> tuple[dict, dict]:
    business, dist = await _distillery_business_readonly(current_user)
    now = _utc_now()
    _distillery_decay_and_status(dist, now)
    await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": {"distillery": dist}})
    return business, dist


def _distillery_public_payload(
    distillery: dict,
    business: dict,
    user: Optional[dict] = None,
    now: Optional[datetime] = None,
) -> dict:
    now = now or _utc_now()
    roi = _distillery_roi_snapshot(distillery, business, user, now)
    progression = _distillery_progression_state(distillery)
    effects = _distillery_special_effect_totals(distillery)
    loss_forecast_24h = _distillery_projected_24h_loss_forecast(distillery)
    heat = float(distillery.get("heat") or 0.0)
    queue = distillery.get("aging_queue") or []
    now = _utc_now()
    last_risk_at = _parse_iso_utc(distillery.get("last_risk_action_at"), now)
    cooldown_remaining_seconds = 0
    if distillery.get("last_risk_action_at"):
        remaining = (last_risk_at + timedelta(hours=DISTILLERY_RISK_ACTION_COOLDOWN_HOURS) - now).total_seconds()
        cooldown_remaining_seconds = max(0, int(remaining))
    equipment = distillery.get("equipment") or {}
    next_upgrade_costs: Dict[str, Optional[int]] = {}
    for lane in DISTILLERY_EQUIPMENT_ORDER:
        cur = int(equipment.get(lane) or 0)
        next_upgrade_costs[lane] = None if cur >= DISTILLERY_EQUIPMENT_MAX_LEVEL else _distillery_upgrade_cost(lane, cur + 1)
    return {
        "distillery": distillery,
        "heat_level": _distillery_heat_label(heat),
        "roi": roi,
        "loss_forecast_24h": loss_forecast_24h,
        "active_batches": len(queue),
        "best_next_upgrade": roi.get("next_upgrade_lane"),
        "progression": progression,
        "special_effects": effects,
        "risk_cooldown": {
            "last_risk_action_at": distillery.get("last_risk_action_at"),
            "cooldown_hours": DISTILLERY_RISK_ACTION_COOLDOWN_HOURS,
            "cooldown_remaining_seconds": cooldown_remaining_seconds,
        },
        "vault_balance": int(business.get("vault") or 0),
        "pricing": {
            "equipment_next_costs": next_upgrade_costs,
            "worker_hire_cost": DISTILLERY_WORKER_HIRE_COST,
            "maintenance_recover_cost_per_point": DISTILLERY_MAINTENANCE_RECOVER_COST_PER_POINT,
            "worker_max_hires_per_action": DISTILLERY_WORKER_MAX_PER_ACTION,
            "risk_action_costs": {
                "cool_off": int(DISTILLERY_RISK_ACTION_COSTS["cool_off"]),
                "bribe_crackdown": int(DISTILLERY_RISK_ACTION_COSTS["bribe_crackdown"]),
            },
        },
    }


_distillery_catalog_grouped_cache: Optional[Dict[str, List[Dict[str, Any]]]] = None


def _distillery_catalog_grouped_static() -> Dict[str, List[Dict[str, Any]]]:
    global _distillery_catalog_grouped_cache
    if _distillery_catalog_grouped_cache is None:
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for row in DISTILLERY_SPECIAL_CATALOG:
            grouped.setdefault(str(row["track"]), []).append(dict(row))
        for track in grouped:
            grouped[track] = sorted(grouped[track], key=lambda x: int(x["tier"]))
        _distillery_catalog_grouped_cache = grouped
    return _distillery_catalog_grouped_cache


def _distillery_progression_catalog(vault: int, unlocked: Optional[dict]) -> dict:
    unlocked = unlocked or {}
    rows: List[Dict[str, Any]] = []
    for _track, track_rows in _distillery_catalog_grouped_static().items():
        for row in track_rows:
            uid = row["id"]
            purchased = bool(unlocked.get(uid))
            prev_uid = f"{row['track']}_{row['tier'] - 1:02d}" if int(row["tier"]) > 1 else None
            track_unlock_ok = True if not prev_uid else bool(unlocked.get(prev_uid))
            rows.append(
                {
                    **row,
                    "purchased": purchased,
                    "available": (not purchased) and track_unlock_ok,
                    "can_afford": vault >= int(row.get("cost") or 0),
                }
            )
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(str(row["track"]), []).append(row)
    for track in grouped:
        grouped[track] = sorted(grouped[track], key=lambda x: int(x["tier"]))
    return {
        "tracks": grouped,
        "totals": {
            "special_total": DISTILLERY_SPECIAL_TOTAL,
            "special_unlocked": sum(1 for x in rows if x.get("purchased")),
            "progress_total_steps": DISTILLERY_PROGRESS_TOTAL_STEPS,
        },
    }


def _distillery_decay_view(distillery: dict, now: datetime) -> dict:
    view = copy.deepcopy(distillery)
    _distillery_decay_and_status(view, now)
    return view


async def get_illegal_business(
    current_user: dict = Depends(get_current_user),
    missions: str = Query("all"),
    guards: str = Query("full"),
    include_distillery: bool = Query(True),
):
    user_id = current_user["id"]
    business = await db.illegal_businesses.find_one({"user_id": user_id}, {"_id": 0})
    now = datetime.now(timezone.utc)
    today_key = game_today_date_str(now)
    raid_date = current_user.get("illegal_business_raids_date")
    raid_count = int(current_user.get("illegal_business_raids_today") or 0)
    if raid_date != today_key:
        raid_count = 0
    raid_lim = _effective_raid_daily_limit(current_user)
    u_pending = await db.users.find_one({"id": user_id}, {"_id": 0, "pending_illegal_business_rewards": 1})
    pending_raw = list((u_pending or {}).get("pending_illegal_business_rewards") or [])
    if not business:
        if not pending_raw:
            raise HTTPException(status_code=404, detail="You don't have an illegal business.")
        pending_enriched = await _pending_kill_rewards_with_previews(pending_raw, current_user, None)
        return {
            "no_business": True,
            "business": None,
            "pending_take": 0.0,
            "racket_payout_mult": 1.0,
            "guards": [],
            "type_info": {},
            "missions_completed": [],
            "missions": [],
            "pending_kill_rewards": pending_enriched,
            "available_types": ILLEGAL_BUSINESS_TYPES,
            "security_upgrades_list": [],
            "next_guard_slot_cost_cash": None,
            "guard_hire_cost": GUARD_HIRE_COST_CASH,
            "distillery": None,
            "raid_daily_limit": raid_lim,
            "raids_today": raid_count,
        }
    missions_mode = (missions or "all").strip().lower()
    guards_mode = (guards or "full").strip().lower()
    slim_missions = missions_mode == "active"
    slim_guards = guards_mode == "summary"
    distillery_payload = None
    if include_distillery and business.get("type_id") == "booze_making":
        now_utc = _utc_now()
        distillery, changed = _distillery_ensure_state(business, now_utc)
        if distillery:
            view = _distillery_decay_view(distillery, now_utc)
            distillery_payload = _distillery_public_payload(view, business, current_user, now_utc)
        if changed:
            await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": {"distillery": distillery}})
    slots = int(business.get("guard_slots") or GUARD_SLOTS_INITIAL)
    guards: List[dict] = []
    active_guards_count = 0
    if slim_guards:
        if business.get("id"):
            active_guards_count = int(
                await db.illegal_business_guards.count_documents({"business_id": business["id"]})
            )
    else:
        g_limit = min(2000, max(slots + 100, 500))
        guards_raw = await db.illegal_business_guards.find({"business_id": business["id"]}, {"_id": 0}).sort("slot_number", 1).to_list(g_limit)
        guards = [_guard_doc_with_upgrade_costs(business, g) for g in guards_raw]
        active_guards_count = len(guards_raw)
    progress_user = await _ibm_load_user_with_mission_baselines(current_user["id"], current_user)
    completions = progress_user.get("illegal_business_mission_completions") or []
    completed_ids = {c.get("mission_id") for c in completions if c.get("mission_id")}
    pending_rewards = await _pending_kill_rewards_with_previews(pending_raw, current_user, business)
    type_info = next((t for t in ILLEGAL_BUSINESS_TYPES if t["id"] == business.get("type_id")), {})
    ordered_missions = _ordered_ibm_missions()
    missions_total = len(ordered_missions)
    missions_completed_count = len(completed_ids)
    if slim_missions:
        active_row = None
        for m in ordered_missions:
            if m["id"] not in completed_ids:
                active_row = _ibm_mission_progress_row(
                    progress_user,
                    business,
                    m,
                    completed_ids,
                    active_guards_count=active_guards_count,
                )
                break
        missions_progress = [active_row] if active_row else []
    else:
        missions_progress = [
            _ibm_mission_progress_row(
                progress_user,
                business,
                m,
                completed_ids,
                active_guards_count=active_guards_count,
            )
            for m in ordered_missions
        ]
    # Build security upgrades list (no mission locks; cost computed by index)
    security_upgrades_with_lock = []
    for i, u in enumerate(SECURITY_UPGRADES):
        entry = dict(u)
        entry["cost_cash"] = security_upgrade_cost_cash(i)
        entry["locked"] = False
        entry["unlock_mission_title"] = None
        security_upgrades_with_lock.append(entry)
    if slots < GUARD_SLOTS_MAX:
        exp = slots - GUARD_SLOTS_INITIAL
        next_guard_slot_cash = int(GUARD_SLOT_BASE_CASH * (GUARD_SLOT_MULT ** exp))
    else:
        next_guard_slot_cash = None
    pending_take, _ = await _illegal_business_pending_take_and_hours(business, current_user, now)
    ev = await get_effective_event()
    return {
        "no_business": False,
        "business": business,
        "pending_take": round(pending_take, 2),
        "racket_payout_mult": float(ev.get("racket_payout", 1.0)),
        "racket_token_active": _token_until_active(current_user.get("racket_until"), now),
        "racket_token_income_mult": _racket_token_income_mult(current_user, now),
        "booze_token_active": _token_until_active(current_user.get("booze_until"), now),
        "booze_token_distillery_mult": _booze_token_distillery_mult(current_user, now),
        "guards": guards,
        "guards_count": active_guards_count,
        "guard_slots": slots,
        "type_info": type_info,
        "missions_completed": list(completed_ids),
        "missions": missions_progress,
        "missions_total": missions_total,
        "missions_completed_count": missions_completed_count,
        "pending_kill_rewards": pending_rewards,
        "available_types": ILLEGAL_BUSINESS_TYPES,
        "security_upgrades_list": security_upgrades_with_lock,
        "next_guard_slot_cost_cash": next_guard_slot_cash,
        "guard_hire_cost": GUARD_HIRE_COST_CASH,
        "distillery": distillery_payload,
        "raid_daily_limit": raid_lim,
        "raids_today": raid_count,
    }


async def start_illegal_business(req: StartBusinessRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("is_dead"):
        raise HTTPException(status_code=400, detail="You're dead. Retrieve your soul first.")
    rank_id = _user_rank_id(current_user)
    if rank_id < CAPO_RANK_ID:
        raise HTTPException(status_code=403, detail="Only Capo or higher can own an illegal business.")
    existing = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 1})
    if existing:
        raise HTTPException(status_code=400, detail="You already have an illegal business.")
    type_id = (req.type_id or "").strip()
    type_def = next((t for t in ILLEGAL_BUSINESS_TYPES if t["id"] == type_id), None)
    if not type_def:
        raise HTTPException(status_code=400, detail="Invalid business type.")
    state = (current_user.get("current_state") or STATES[0]).strip()
    if state not in STATES:
        state = STATES[0]
    now = datetime.now(timezone.utc)
    business_id = str(uuid.uuid4())
    name = (req.name or type_def["name"] or "The Racket").strip()[:80]
    doc = {
        "id": business_id,
        "user_id": current_user["id"],
        "name": name or type_def["name"],
        "type_id": type_id,
        "state": state,
        "level": 1,
        "income_per_hour": INCOME_PER_HOUR_BASE,
        "income_cap_hours": INCOME_CAP_HOURS_BASE,
        "last_collected_at": now.isoformat(),
        "guard_slots": GUARD_SLOTS_INITIAL,
        "security_level": 0,
        "security_upgrades": [],
        "total_spent": START_COST_CASH,
        "vault": 0,
        "vault_lifetime_earned": 0,
        "created_at": now.isoformat(),
        "customizations": {},
    }
    if type_def.get("produces_booze"):
        doc["booze_per_hour"] = BOOZE_PER_HOUR_BASE
        doc["booze_cap_hours"] = BOOZE_CAP_HOURS_BASE
        doc["last_collected_booze_at"] = now.isoformat()
        doc["distillery"] = _distillery_default(now)
    result = await db.users.update_one(
        {"id": current_user["id"], "money": {"$gte": START_COST_CASH}, "points": {"$gte": START_COST_POINTS}},
        {"$inc": {"money": -START_COST_CASH, "points": -START_COST_POINTS}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail=f"Need ${START_COST_CASH:,} to start.")
    if START_COST_POINTS > 0:
        await log_points_event(db, user_id=current_user["id"], points=-START_COST_POINTS, event_type="illegal_biz_start", meta={"business_id": business_id, "type_id": type_id})
    await db.illegal_businesses.insert_one(doc)
    return {"message": f"You've taken over a joint in {state}.", "business_id": business_id}


_TILL_AFFECTING_BUSINESS_FIELDS = frozenset({"income_per_hour", "income_cap_hours", "level"})


def _illegal_business_effective_income_per_hour(business: dict, user: dict) -> tuple[float, int]:
    income_per_hour = int(business.get("income_per_hour") or INCOME_PER_HOUR_BASE)
    cap_hours = int(business.get("income_cap_hours") or INCOME_CAP_HOURS_BASE)
    level = int(business.get("level") or 1)
    level_mult = 1.0 + 0.04 * max(0, level - 1)
    boost_pct = int(user.get("illegal_business_income_boost_percent") or 0)
    iph_eff = income_per_hour * level_mult * (1.0 + boost_pct / 100.0)
    return iph_eff, cap_hours


def _illegal_business_hours_since_last_collect(business: dict, now: datetime) -> float:
    last_raw = business.get("last_collected_at")
    last = _parse_iso_utc(last_raw, now) if last_raw else now
    return max(0.0, (now - last).total_seconds() / 3600)


def _illegal_business_base_pending_take(business: dict, user: dict, now: datetime) -> float:
    hours = _illegal_business_hours_since_last_collect(business, now)
    iph_eff, cap_hours = _illegal_business_effective_income_per_hour(business, user)
    return min(hours * iph_eff, iph_eff * cap_hours)


def _business_till_fields_changed(business_before: dict, field_updates: dict) -> bool:
    defaults = {
        "income_per_hour": INCOME_PER_HOUR_BASE,
        "income_cap_hours": INCOME_CAP_HOURS_BASE,
        "level": 1,
    }
    for key in _TILL_AFFECTING_BUSINESS_FIELDS:
        if key not in field_updates:
            continue
        before_val = int(business_before.get(key) or defaults[key])
        after_val = int(field_updates.get(key) or defaults[key])
        if before_val != after_val:
            return True
    return False


def _last_collected_at_preserve_base_pending(
    business_after: dict,
    user: dict,
    target_base: float,
    now: datetime,
) -> str:
    iph_eff, cap_hours = _illegal_business_effective_income_per_hour(business_after, user)
    if iph_eff <= 0 or target_base <= 0:
        return now.isoformat()
    max_base = iph_eff * cap_hours
    preserved = min(target_base, max_base)
    accrual_hours = min(preserved / iph_eff, float(cap_hours))
    return (now - timedelta(hours=accrual_hours)).isoformat()


def _reconcile_till_last_collected_after_stat_change(
    business_before: dict,
    field_updates: dict,
    user: dict,
    now: Optional[datetime] = None,
) -> Optional[str]:
    """Adjust last_collected_at so till pending is unchanged after income/cap/level edits."""
    if not _business_till_fields_changed(business_before, field_updates):
        return None
    now = now or datetime.now(timezone.utc)
    target_base = _illegal_business_base_pending_take(business_before, user, now)
    merged_after = {**business_before, **field_updates}
    return _last_collected_at_preserve_base_pending(merged_after, user, target_base, now)


def _illegal_business_pending_take_and_hours_sync(
    business: dict, user: dict, now: datetime
) -> tuple[float, float]:
    hours = _illegal_business_hours_since_last_collect(business, now)
    income = round(_illegal_business_base_pending_take(business, user, now), 2)
    prestige = get_prestige_bonus(user)
    income = round(income * float(prestige.get("illegal_business_mult", 1.0)), 2)
    income = round(income * _racket_token_income_mult(user, now), 2)
    return income, hours


async def _illegal_business_pending_take_and_hours(
    business: dict, current_user: dict, now: datetime
) -> tuple[float, float]:
    """Uncollected till (cash) and hours since last collect, from a business document."""
    return _illegal_business_pending_take_and_hours_sync(business, current_user, now)


async def _restore_illegal_business_collect_time(business_id: str, previous_last_collected_at: Optional[str]) -> None:
    """Undo last_collected_at bump when collect is rejected (timer must keep accruing)."""
    if previous_last_collected_at:
        await db.illegal_businesses.update_one(
            {"id": business_id},
            {"$set": {"last_collected_at": previous_last_collected_at}},
        )
    else:
        await db.illegal_businesses.update_one({"id": business_id}, {"$unset": {"last_collected_at": ""}})


def _distillery_claim_ready_mutate(distillery: dict, now: datetime) -> tuple[int, int]:
    """Remove ready aging batches; credit vault via return total. Mutates distillery in place."""
    queue = list(distillery.get("aging_queue") or [])
    new_queue: List[dict] = []
    vault_add = 0
    claimed = 0
    heat = float(distillery.get("heat") or 0.0)
    stats = distillery.get("stats") or {}
    for batch in queue:
        ready_at = _parse_iso_utc(batch.get("ready_at"), now)
        if now < ready_at:
            new_queue.append(batch)
            continue
        qty = int(batch.get("quantity") or 0)
        cash_mult = float(batch.get("cash_mult") or 1.0)
        quality_mult = float(batch.get("quality_mult") or 1.0)
        cash = int(qty * DISTILLERY_BASE_BOOZE_UNIT_VALUE * cash_mult * quality_mult)
        if heat >= DISTILLERY_HEAT_THRESHOLDS["hot"]:
            cash = int(cash * 0.9)
        vault_add += cash
        claimed += 1
        stats["total_batches_claimed"] = int(stats.get("total_batches_claimed") or 0) + 1
        if (batch.get("tier") or "") == "premium":
            stats["premium_sells"] = int(stats.get("premium_sells") or 0) + 1
    distillery["aging_queue"] = new_queue
    distillery["stats"] = stats
    return claimed, vault_add


async def _distillery_start_aging_batch_persist(
    business_id: str, user_id: str, distillery: dict, tier: str, qty: int
) -> tuple[bool, Optional[str], Optional[str]]:
    """Append one aging batch and deduct booze. Returns (ok, batch_id, ready_at_iso)."""
    now = _utc_now()
    tier_cfg = DISTILLERY_AGING_TIERS[tier]
    aging_hours = _rng.uniform(float(tier_cfg["hours_min"]), float(tier_cfg["hours_max"]))
    finish = now + timedelta(hours=aging_hours)
    batch_id = str(uuid.uuid4())
    booze_id = _default_booze_type_id()
    user_result = await db.users.update_one(
        {"id": user_id, f"booze_carrying.{booze_id}": {"$gte": qty}},
        {"$inc": {f"booze_carrying.{booze_id}": -qty}},
    )
    if user_result.modified_count == 0:
        return False, None, None
    queue = list(distillery.get("aging_queue") or [])
    queue.append(
        {
            "id": batch_id,
            "tier": tier,
            "booze_id": booze_id,
            "quantity": qty,
            "started_at": now.isoformat(),
            "ready_at": finish.isoformat(),
            "quality_mult": float(tier_cfg["quality_mult"]),
            "cash_mult": float(tier_cfg["cash_mult"]),
        }
    )
    distillery["aging_queue"] = queue
    stats = distillery.get("stats") or {}
    stats["total_batches_started"] = int(stats.get("total_batches_started") or 0) + 1
    distillery["stats"] = stats
    await db.illegal_businesses.update_one({"id": business_id}, {"$set": {"distillery": distillery}})
    return True, batch_id, finish.isoformat()


async def _distillery_try_start_one_automation_batch(user_id: str, business_id: str) -> bool:
    """Start one aging batch if auto_aging enabled, queue has room, and carrying exceeds reserve."""
    business = await db.illegal_businesses.find_one({"id": business_id, "user_id": user_id}, {"_id": 0})
    if not business or not business.get("booze_per_hour"):
        return False
    now = _utc_now()
    distillery, _ = _distillery_ensure_state(business, now)
    _distillery_decay_and_status(distillery, now)
    auto_aging = distillery.get("auto_aging") or {}
    if not auto_aging.get("enabled"):
        return False
    tier = str(auto_aging.get("tier") or "standard").lower()
    if tier not in DISTILLERY_AGING_TIERS:
        tier = "standard"
    reserve = max(0, int(auto_aging.get("reserve_units") or 0))
    queue = list(distillery.get("aging_queue") or [])
    if len(queue) >= DISTILLERY_MAX_ACTIVE_BATCHES:
        return False
    booze_id = _default_booze_type_id()
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "booze_carrying": 1})
    carrying = (user or {}).get("booze_carrying") or {}
    have = int(carrying.get(booze_id) or 0)
    qty = have - reserve
    if qty < DISTILLERY_AUTO_AGING_MIN_BATCH_UNITS:
        return False
    ok, _, _ = await _distillery_start_aging_batch_persist(business_id, user_id, distillery, tier, qty)
    return ok


async def distillery_process_automation(user_id: str) -> None:
    """Claim ready aging batches, fill queue from settings, optional throttled racket collect for booze."""
    business = await db.illegal_businesses.find_one({"user_id": user_id}, {"_id": 0})
    if not business or not business.get("booze_per_hour"):
        return
    now = _utc_now()
    user = await db.users.find_one(
        {"id": user_id},
        {
            "_id": 0,
            "id": 1,
            "racket_until": 1,
            "booze_until": 1,
            "in_jail": 1,
            "booze_carrying": 1,
            "passive_booze_paused": 1,
        },
    )
    distillery, _ = _distillery_ensure_state(business, now)
    _distillery_decay_and_status(distillery, now)
    claimed, vault_add = _distillery_claim_ready_mutate(distillery, now)
    set_doc: Dict[str, Any] = {"distillery": distillery}
    inc_doc: Dict[str, int] = {}
    if vault_add > 0:
        vault_add = int(vault_add * _distillery_cash_token_mult(user, now))
        inc_doc["vault"] = vault_add
        inc_doc["vault_lifetime_earned"] = max(0, vault_add)
    if inc_doc:
        await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": set_doc, "$inc": inc_doc})
    else:
        await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": set_doc})
    if booze_intake_blocked(user):
        return
    auto_aging = distillery.get("auto_aging") or {}
    if not auto_aging.get("enabled"):
        return
    while await _distillery_try_start_one_automation_batch(user_id, business["id"]):
        pass
    business = await db.illegal_businesses.find_one({"id": business["id"]}, {"_id": 0})
    if not business:
        return
    distillery = business.get("distillery") or {}
    auto_aging = distillery.get("auto_aging") or {}
    if not auto_aging.get("auto_collect_booze", True):
        return
    last_raw = distillery.get("last_auto_collect_at")
    last_dt = _parse_iso_utc(last_raw, now) if last_raw else None
    if last_dt and (now - last_dt).total_seconds() < DISTILLERY_AUTO_COLLECT_MIN_INTERVAL_SECONDS:
        return
    if not user or user.get("in_jail"):
        return
    try:
        await _collect_illegal_business_impl(user)
    except HTTPException:
        return
    await db.illegal_businesses.update_one(
        {"id": business["id"]},
        {"$set": {"distillery.last_auto_collect_at": now.isoformat()}},
    )


async def run_distillery_automation_ticker():
    """Periodic pass for auto-aging / auto-collect (in-process; disable with DISTILLERY_AUTOMATION_USE_CRON=1)."""
    import asyncio

    await asyncio.sleep(12)
    while True:
        try:
            cursor = db.illegal_businesses.find(
                {"booze_per_hour": {"$gt": 0}, "distillery.auto_aging.enabled": True},
                {"_id": 0, "user_id": 1},
            ).limit(DISTILLERY_AUTOMATION_MAX_BUSINESSES_PER_TICK)
            rows = await cursor.to_list(DISTILLERY_AUTOMATION_MAX_BUSINESSES_PER_TICK)
            for row in rows:
                uid = (row.get("user_id") or "").strip()
                if uid:
                    try:
                        await distillery_process_automation(uid)
                    except Exception as e:
                        logger.exception("distillery_process_automation %s: %s", uid, e)
        except Exception as e:
            logger.exception("run_distillery_automation_ticker: %s", e)
        await asyncio.sleep(DISTILLERY_AUTOMATION_TICKER_SECONDS)


async def _collect_illegal_business_impl(current_user: dict) -> dict:
    now = datetime.now(timezone.utc)
    racket_mult = _racket_token_income_mult(current_user, now)
    booze_mult = _booze_token_distillery_mult(current_user, now)
    distillery_cash_mult = racket_mult * booze_mult
    # Atomically swap last_collected_at — returns the pre-update document so
    # a concurrent request sees the already-advanced timestamp and computes ~0 income.
    business = await db.illegal_businesses.find_one_and_update(
        {"user_id": current_user["id"]},
        {"$set": {"last_collected_at": now.isoformat()}},
        projection={"_id": 0},
    )
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    prev_last = business.get("last_collected_at")
    income, hours = await _illegal_business_pending_take_and_hours(business, current_user, now)
    ev_collect = await get_effective_event()
    income = round(float(income) * float(ev_collect.get("racket_payout", 1.0)), 2)
    if income < 0.01:
        await _restore_illegal_business_collect_time(business["id"], prev_last)
        raise HTTPException(status_code=400, detail="No take to collect yet.")
    if income < MIN_IBM_CASH_ACTION:
        await _restore_illegal_business_collect_time(business["id"], prev_last)
        raise HTTPException(
            status_code=400,
            detail=f"Need at least ${MIN_IBM_CASH_ACTION:,} in the till to collect. Current take: ${income:,.2f}.",
        )
    prestige = get_prestige_bonus(current_user)
    level = int(business.get("level") or 1)
    updates = {}
    security_level = len(business.get("security_upgrades") or []) or int(business.get("security_level") or 0)
    ib_mult = float(prestige.get("illegal_business_mult", 1.0))
    # Extras (bullets, respect, points, loot) only when enough time accumulated and cooldown passed
    last_extras = business.get("last_extras_collected_at")
    extras_cooldown_passed = True
    if last_extras:
        try:
            last_dt = datetime.fromisoformat(last_extras.replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            extras_cooldown_passed = (now - last_dt).total_seconds() >= RACKET_EXTRAS_COOLDOWN_HOURS * 3600
        except Exception:
            pass
    grant_extras = hours >= MIN_COLLECT_HOURS_FOR_EXTRAS and extras_cooldown_passed
    if grant_extras:
        updates["last_extras_collected_at"] = now.isoformat()
    respect_earned = min(100, max(0, int(income * 0.001 * ib_mult))) if grant_extras else 0
    bullets_earned = max(1, int((1 + min(level + security_level, 9)) * ib_mult)) if grant_extras else 0
    points_earned = int((_rng.randint(1, 5) if level >= 3 else 0) * ib_mult) if grant_extras else 0
    loot_pieces_earned = (_rng.randint(1, 2) if _rng.random() < 0.05 else 0) if grant_extras else 0
    inc = {"illegal_business_collections": 1}
    if respect_earned > 0:
        inc["respect_points"] = respect_earned
    if bullets_earned > 0:
        inc["bullets"] = bullets_earned
    if points_earned > 0:
        inc["points"] = points_earned
    if loot_pieces_earned > 0:
        inc["loot_box_pieces"] = loot_pieces_earned
    # Random token drop (1 in 250, 1–3) — same constants as crimes
    if _rng.random() < TOKEN_GLOBAL_DROP_CHANCE:
        token_type = _rng.choice(TOKEN_TYPES_GLOBAL_RANDOM_DROP)
        field = TOKEN_CONFIG[token_type]["count_field"]
        token_amt = _rng.randint(TOKEN_GLOBAL_DROP_AMOUNT_MIN, TOKEN_GLOBAL_DROP_AMOUNT_MAX)
        inc[field] = inc.get(field, 0) + token_amt
    booze_earned = 0
    auto_sold_units = 0
    auto_sell_cash = 0
    carry_inc = 0
    booze_run_vault = 0
    booze_run_jailed = False
    auto_sell_mode = "crew"
    distillery_breakdown = None
    vault_penalty = 0
    if business.get("booze_per_hour"):
        last_booze = business.get("last_collected_booze_at")
        try:
            last_collect_dt = datetime.fromisoformat(prev_last.replace("Z", "+00:00")) if prev_last else now
        except Exception:
            last_collect_dt = now
        if last_collect_dt.tzinfo is None:
            last_collect_dt = last_collect_dt.replace(tzinfo=timezone.utc)
        try:
            last_b = datetime.fromisoformat(last_booze.replace("Z", "+00:00")) if last_booze else last_collect_dt
        except Exception:
            last_b = last_collect_dt
        if last_b.tzinfo is None:
            last_b = last_b.replace(tzinfo=timezone.utc)
        hours_booze = max(0.0, (now - last_b).total_seconds() / 3600)
        bph = int(business.get("booze_per_hour") or BOOZE_PER_HOUR_BASE)
        bcap = int(business.get("booze_cap_hours") or BOOZE_CAP_HOURS_BASE)

        distillery, _ = _distillery_ensure_state(business, now)
        status = _distillery_decay_and_status(distillery, now) if distillery else None
        mods = _distillery_output_modifiers(distillery or {})
        production_mult = float(mods.get("production_mult") or 1.0) * booze_mult

        booze_raw = min(hours_booze * bph * production_mult, (bph * bcap) * production_mult)
        booze_earned = int(max(0, booze_raw)) if not (status and status.get("is_shutdown")) else 0

        default_booze_id = _default_booze_type_id()
        if distillery:
            workers = distillery.get("workers") or {}
            equipment = distillery.get("equipment") or {}
            auto_sell = distillery.get("auto_sell") or {}
            sales_workers = int(workers.get("sales") or 0)
            maintenance_degradation = (status or {}).get("maintenance_degradation") or {}

            if bool(auto_sell.get("enabled")) and sales_workers > 0 and booze_earned > 0:
                auto_sell_mode = str(auto_sell.get("mode") or "crew").lower()
                if auto_sell_mode not in DISTILLERY_AUTO_SELL_MODES:
                    auto_sell_mode = "crew"
                user_carrying = (current_user.get("booze_carrying") or {})
                existing_qty = int(user_carrying.get(default_booze_id) or 0)
                min_inv = max(0, int(auto_sell.get("min_inventory") or 0))
                batch_size = max(1, int(auto_sell.get("batch_size") or 1))
                ready_to_sell = max(0, existing_qty + booze_earned - min_inv)
                worker_cap = sales_workers * batch_size
                auto_sold_units = min(booze_earned, ready_to_sell, worker_cap)
                if auto_sold_units > 0:
                    booze_earned -= auto_sold_units
                    if auto_sell_mode == "crew":
                        auto_sell_cash = int(
                            auto_sold_units
                            * DISTILLERY_BASE_BOOZE_UNIT_VALUE
                            * float(mods.get("auto_sell_margin") or DISTILLERY_AUTO_SELL_MARGIN_BASE)
                            * float(mods.get("quality_mult") or 1.0)
                            * float(mods.get("cash_mult") or 1.0)
                        )
                        stats = distillery.get("stats") or {}
                        stats["total_booze_auto_sold"] = int(stats.get("total_booze_auto_sold") or 0) + auto_sold_units
                        stats["total_auto_sell_cash"] = int(stats.get("total_auto_sell_cash") or 0) + auto_sell_cash
                        distillery["stats"] = stats

            # During shutdown, booze_earned is 0 — do not charge heat from theoretical booze_raw or each collect re-adds heat and masks passive decay.
            booze_raw_for_heat = 0.0 if (status and status.get("is_shutdown")) else float(booze_raw)
            heat_gain = ((booze_raw_for_heat * DISTILLERY_HEAT_GAIN_PER_BOOZE) + (auto_sold_units * DISTILLERY_HEAT_GAIN_PER_AUTO_SELL)) * float(mods.get("heat_gain_mult") or 1.0)
            heat_mitigation = int(workers.get("security") or 0) * 0.35 + int(equipment.get("tunnel") or 0) * 0.25 + int(equipment.get("bribe_office") or 0) * 0.2
            distillery["heat"] = _clamp(float(distillery.get("heat") or 0.0) + max(0.0, heat_gain - heat_mitigation), 0.0, 100.0)

            booze_lost_units = 0
            booze_loss_cash = 0
            heat_now = float(distillery.get("heat") or 0.0)
            if heat_now >= DISTILLERY_HEAT_BOOZE_LOSS_THRESHOLDS["hot"]:
                if heat_now >= DISTILLERY_HEAT_BOOZE_LOSS_THRESHOLDS["meltdown"]:
                    loss_chance = 0.52
                elif heat_now >= DISTILLERY_HEAT_BOOZE_LOSS_THRESHOLDS["critical"]:
                    loss_chance = 0.34
                else:
                    loss_chance = 0.18
                loss_chance = _clamp(loss_chance * (1.0 - float(mods.get("booze_loss_reduction") or 0.0)), 0.02, 0.65)
                if _rng.random() < loss_chance:
                    available_for_loss = auto_sold_units + booze_earned
                    if available_for_loss > 0:
                        base_loss_pct = 0.08 if heat_now < DISTILLERY_HEAT_BOOZE_LOSS_THRESHOLDS["critical"] else 0.18
                        if heat_now >= DISTILLERY_HEAT_BOOZE_LOSS_THRESHOLDS["meltdown"]:
                            base_loss_pct = 0.30
                        base_loss_pct = _clamp(base_loss_pct * (1.0 - float(mods.get("booze_loss_reduction") or 0.0)), 0.03, 0.45)
                        booze_lost_units = min(available_for_loss, max(1, int(round(available_for_loss * base_loss_pct))))
                        reduce_from_auto = min(auto_sold_units, booze_lost_units)
                        auto_sold_units -= reduce_from_auto
                        if reduce_from_auto > 0 and auto_sell_mode == "crew":
                            booze_loss_cash = int(
                                reduce_from_auto
                                * DISTILLERY_BASE_BOOZE_UNIT_VALUE
                                * float(mods.get("auto_sell_margin") or DISTILLERY_AUTO_SELL_MARGIN_BASE)
                                * float(mods.get("quality_mult") or 1.0)
                            )
                            auto_sell_cash = max(0, auto_sell_cash - booze_loss_cash)
                        remaining_loss = booze_lost_units - reduce_from_auto
                        if remaining_loss > 0:
                            booze_earned = max(0, booze_earned - remaining_loss)
                        stats = distillery.get("stats") or {}
                        stats["booze_lost_to_heat"] = int(stats.get("booze_lost_to_heat") or 0) + booze_lost_units
                        stats["booze_lost_events"] = int(stats.get("booze_lost_events") or 0) + 1
                        distillery["stats"] = stats

            if float(distillery.get("heat") or 0.0) >= DISTILLERY_HEAT_THRESHOLDS["critical"] and not (status or {}).get("is_shutdown"):
                over = float(distillery.get("heat") or 0.0) - DISTILLERY_HEAT_THRESHOLDS["critical"]
                chance = _clamp(0.06 + (over / 100.0), 0.06, DISTILLERY_ENFORCEMENT_MAX_CHANCE)
                if _rng.random() < chance:
                    shutdown_hours = _rng.randint(DISTILLERY_ENFORCEMENT_SHUTDOWN_HOURS[0], DISTILLERY_ENFORCEMENT_SHUTDOWN_HOURS[1])
                    distillery["shutdown_until"] = (now + timedelta(hours=shutdown_hours)).isoformat()
                    loss_pct = _clamp(
                        DISTILLERY_ENFORCEMENT_VAULT_LOSS_MIN + (float(distillery.get("heat") or 0.0) / 100.0) * 0.18,
                        DISTILLERY_ENFORCEMENT_VAULT_LOSS_MIN,
                        DISTILLERY_ENFORCEMENT_VAULT_LOSS_MAX,
                    )
                    vault_total_before = int(business.get("vault") or 0) + int(
                        round(float(income) / racket_mult, 2) if racket_mult > 1.0 else float(income)
                    ) + auto_sell_cash
                    vault_penalty = int(max(0, vault_total_before * loss_pct))
                    if distillery.get("allow_vault_for_heat") is False:
                        vault_penalty = 0
                    stats = distillery.get("stats") or {}
                    stats["heat_events_survived"] = int(stats.get("heat_events_survived") or 0) + 1
                    distillery["stats"] = stats

            if auto_sell_cash > 0 and distillery_cash_mult > 1.0:
                auto_sell_cash = int(auto_sell_cash * distillery_cash_mult)

            updates["distillery"] = distillery
            distillery_breakdown = {
                "production_mult": round(float(mods.get("production_mult") or 1.0) * booze_mult, 3),
                "quality_mult": round(float(mods.get("quality_mult") or 1.0), 3),
                "auto_sell_margin": round(float(mods.get("auto_sell_margin") or DISTILLERY_AUTO_SELL_MARGIN_BASE), 3),
                "heat": round(float(distillery.get("heat") or 0.0), 2),
                "heat_level": _distillery_heat_label(float(distillery.get("heat") or 0.0)),
                "shutdown_until": distillery.get("shutdown_until"),
                "auto_sold_units": auto_sold_units,
                "auto_sell_cash": auto_sell_cash,
                "booze_lost_units": booze_lost_units,
                "booze_loss_cash": booze_loss_cash,
                "vault_penalty": vault_penalty,
                "maintenance_degradation": maintenance_degradation,
                "roi": _distillery_roi_snapshot(distillery, business, current_user, now),
                "booze_run_vault": 0,
                "booze_run_jailed": False,
                "racket_token_income_mult": racket_mult,
                "booze_token_distillery_mult": booze_mult,
            }
        carry_inc = booze_earned
        if distillery and auto_sold_units > 0 and auto_sell_mode == "booze_run":
            carry_inc = booze_earned + auto_sold_units
        if carry_inc > 0 and not booze_intake_blocked(current_user):
            updates["last_collected_booze_at"] = now.isoformat()
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": {f"booze_carrying.{default_booze_id}": carry_inc}},
            )
        if (
            distillery
            and auto_sold_units > 0
            and auto_sell_mode == "booze_run"
            and not booze_intake_blocked(current_user)
        ):
            from routers.money.booze_run import _booze_sell_impl

            fresh_user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
            if fresh_user and not fresh_user.get("in_jail"):
                try:
                    sell_out = await _booze_sell_impl(
                        fresh_user,
                        default_booze_id,
                        auto_sold_units,
                        via_distillery_collect=True,
                        illegal_business_id=business["id"],
                        distillery_cash_mult=distillery_cash_mult,
                    )
                except HTTPException:
                    sell_out = {}
                if sell_out.get("caught"):
                    booze_run_jailed = True
                    if distillery_breakdown is not None:
                        distillery_breakdown["booze_run_jailed"] = True
                        distillery_breakdown["booze_run_vault"] = 0
                elif sell_out:
                    booze_run_vault = int(sell_out.get("revenue") or 0)
                    stats = distillery.get("stats") or {}
                    stats["total_booze_auto_sold"] = int(stats.get("total_booze_auto_sold") or 0) + auto_sold_units
                    stats["total_booze_run_auto_vault"] = int(stats.get("total_booze_run_auto_vault") or 0) + booze_run_vault
                    distillery["stats"] = stats
                    updates["distillery"] = distillery
                    if distillery_breakdown is not None:
                        distillery_breakdown["booze_run_vault"] = booze_run_vault
                        distillery_breakdown["booze_run_jailed"] = False
    await db.users.update_one({"id": current_user["id"]}, {"$inc": inc})
    if points_earned > 0:
        await log_points_event(db, user_id=current_user["id"], points=points_earned, event_type="illegal_biz_collect", meta={"business_id": business["id"]})
    if respect_earned > 0:
        await log_respect_earned(current_user["id"], respect_earned, "illegal_business")
    vault_income = int(income) + auto_sell_cash
    vault_delta = vault_income - vault_penalty
    await db.illegal_businesses.update_one(
        {"id": business["id"]},
        {"$set": updates, "$inc": {"vault": vault_delta, "vault_lifetime_earned": max(0, vault_income)}},
    )
    msg = f"The till's been cleared. ${income:,.2f} added to vault."
    if carry_inc > 0:
        msg += f" and {carry_inc} booze."
    if auto_sell_cash > 0:
        msg += f" Workers moved {auto_sold_units} units for ${auto_sell_cash:,}."
    if booze_run_vault > 0:
        msg += f" Runners sold {auto_sold_units} units on the street for ${booze_run_vault:,} (racket vault)."
    if booze_run_jailed:
        msg += " A booze auto-sell run got busted — you're in jail."
    if distillery_breakdown and int(distillery_breakdown.get("booze_lost_units") or 0) > 0:
        msg += f" Heat damaged/confiscated {int(distillery_breakdown.get('booze_lost_units') or 0)} booze."
    if distillery_breakdown and int(((distillery_breakdown.get("maintenance_degradation") or {}).get("lost_count") or 0)) > 0:
        lost = int((distillery_breakdown.get("maintenance_degradation") or {}).get("lost_count") or 0)
        msg += f" Poor maintenance damaged {lost} upgrade tier(s); you need to rebuy them."
    if vault_penalty > 0:
        msg += f" Heat brought enforcement pressure: ${vault_penalty:,} lost and operations cooled off."
    token_earned = {t: inc.get(TOKEN_CONFIG[t]["count_field"], 0) for t in TOKEN_TYPES}
    any_tokens = sum(token_earned.values())
    if respect_earned or bullets_earned or points_earned or loot_pieces_earned or any_tokens:
        extras = []
        if respect_earned: extras.append(f"{respect_earned} respect")
        if bullets_earned: extras.append(f"{bullets_earned} bullets")
        if points_earned: extras.append(f"{points_earned} points")
        if loot_pieces_earned: extras.append(f"{loot_pieces_earned} loot box piece(s)")
        for t in TOKEN_TYPES:
            n = token_earned.get(t, 0)
            if n:
                extras.append(f"{n} {t.replace('_', ' ').title()} token(s)")
        if extras:
            msg += " " + ", ".join(extras) + "."
    return {
        "message": msg,
        "cash": income,
        "booze": carry_inc,
        "auto_sell_cash": auto_sell_cash,
        "auto_sold_units": auto_sold_units,
        "booze_run_vault": booze_run_vault,
        "booze_run_jailed": booze_run_jailed,
        "vault_penalty": vault_penalty,
        "distillery": distillery_breakdown,
        "respect_points": respect_earned,
        "bullets": bullets_earned,
        "points": points_earned,
        "loot_box_pieces": loot_pieces_earned,
        "tokens_earned": token_earned,
    }


async def collect_illegal_business(current_user: dict = Depends(get_current_user)):
    return await _collect_illegal_business_impl(current_user)


async def get_distillery(current_user: dict = Depends(get_current_user)):
    business, distillery = await _distillery_business_readonly(current_user)
    now = _utc_now()
    view = _distillery_decay_view(distillery, now)
    payload = _distillery_public_payload(view, business, current_user, now)
    booze_id = _default_booze_type_id()
    udoc = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "booze_carrying": 1})
    carrying = (udoc or {}).get("booze_carrying") or {}
    payload["booze_units_carrying"] = int(carrying.get(booze_id) or 0)
    return payload


async def get_distillery_page(current_user: dict = Depends(get_current_user)):
    business, distillery = await _distillery_business_readonly(current_user)
    now = _utc_now()
    view = _distillery_decay_view(distillery, now)
    dist_payload = _distillery_public_payload(view, business, current_user, now)
    booze_id = _default_booze_type_id()
    udoc = await db.users.find_one(
        {"id": current_user["id"]},
        {"_id": 0, "booze_carrying": 1, "passive_booze_paused": 1, "auto_rank_enabled": 1},
    )
    carrying = (udoc or {}).get("booze_carrying") or {}
    dist_payload["booze_units_carrying"] = int(carrying.get(booze_id) or 0)
    vault = int(business.get("vault") or 0)
    pending_take, _ = await _illegal_business_pending_take_and_hours(business, current_user, now)
    return {
        "business": {
            "id": business.get("id"),
            "name": business.get("name"),
            "type_id": business.get("type_id"),
            "vault": vault,
            "state": business.get("state"),
        },
        "pending_take": round(pending_take, 2),
        "distillery_state": dist_payload,
        "catalog": _distillery_progression_catalog(vault, view.get("special_upgrades") or {}),
        "passive_booze_paused": bool((udoc or {}).get("passive_booze_paused")),
        "auto_rank_enabled": bool((udoc or {}).get("auto_rank_enabled")),
    }


async def get_distillery_progression_catalog(current_user: dict = Depends(get_current_user)):
    business, distillery = await _distillery_business_readonly(current_user)
    unlocked = distillery.get("special_upgrades") or {}
    vault = int(business.get("vault") or 0)
    return _distillery_progression_catalog(vault, unlocked)


async def distillery_collect(current_user: dict = Depends(get_current_user)):
    payload = await collect_illegal_business(current_user)
    business, distillery = await _distillery_business_for_user(current_user)
    payload["distillery_state"] = _distillery_public_payload(distillery, business, current_user, _utc_now())
    return payload


async def distillery_upgrade_equipment(req: DistilleryUpgradeEquipmentRequest, current_user: dict = Depends(get_current_user)):
    lane = (req.lane or "").strip().lower()
    if lane not in DISTILLERY_EQUIPMENT_ORDER:
        raise HTTPException(status_code=400, detail="Invalid equipment lane.")
    business, distillery = await _distillery_business_for_user(current_user)
    equipment = distillery.get("equipment") or {}
    current_level = int(equipment.get(lane) or 0)
    if current_level >= DISTILLERY_EQUIPMENT_MAX_LEVEL:
        raise HTTPException(status_code=400, detail="That equipment is already maxed.")
    next_level = current_level + 1
    cost = _distillery_upgrade_cost(lane, next_level)
    vault = int(business.get("vault") or 0)
    if vault < cost:
        raise HTTPException(status_code=400, detail=f"Need ${cost:,} in vault. You have ${vault:,}.")

    equipment[lane] = next_level
    distillery["equipment"] = equipment
    distillery["worker_capacity"] = _distillery_worker_capacity(equipment)
    progression = _distillery_progression_state(distillery)
    distillery["mastery_tier"] = int(progression["total_steps"] // 30)
    result = await db.illegal_businesses.update_one(
        {"id": business["id"], "vault": {"$gte": cost}},
        {"$set": {"distillery": distillery}, "$inc": {"vault": -cost, "total_spent": cost}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Upgrade failed. Try again.")
    return {
        "message": f"Installed {lane.replace('_', ' ')} level {next_level}.",
        "cost": cost,
        **_distillery_public_payload(distillery, business, current_user, _utc_now()),
    }


async def distillery_assign_workers(req: DistilleryAssignWorkersRequest, current_user: dict = Depends(get_current_user)):
    business, distillery = await _distillery_business_for_user(current_user)
    assignments = {
        "production": max(0, int(req.production or 0)),
        "quality": max(0, int(req.quality or 0)),
        "security": max(0, int(req.security or 0)),
        "sales": max(0, int(req.sales or 0)),
    }
    total = sum(assignments.values())
    worker_cap = int(distillery.get("worker_capacity") or DISTILLERY_BASE_WORKER_CAP)
    if total > worker_cap:
        raise HTTPException(status_code=400, detail=f"Worker allocation exceeds capacity ({worker_cap}).")
    prev_workers = distillery.get("workers") or {}
    prev_total = sum(int(prev_workers.get(k) or 0) for k in DISTILLERY_WORKER_ROLES)
    hires_needed = max(0, total - prev_total)
    if hires_needed > DISTILLERY_WORKER_MAX_PER_ACTION:
        raise HTTPException(status_code=400, detail=f"You can hire at most {DISTILLERY_WORKER_MAX_PER_ACTION} workers at once.")
    hire_cost = hires_needed * DISTILLERY_WORKER_HIRE_COST
    vault = int(business.get("vault") or 0)
    if hire_cost > 0 and vault < hire_cost:
        raise HTTPException(status_code=400, detail=f"Need ${hire_cost:,} in vault to hire workers.")

    distillery["workers"] = assignments
    distillery["worker_hires"] = int(distillery.get("worker_hires") or 0) + hires_needed
    updates = {"$set": {"distillery": distillery}}
    if hire_cost > 0:
        updates["$inc"] = {"vault": -hire_cost}
    query = {"id": business["id"]}
    if hire_cost > 0:
        query["vault"] = {"$gte": hire_cost}
    result = await db.illegal_businesses.update_one(query, updates)
    if result.modified_count == 0:
        if hire_cost > 0:
            latest = await db.illegal_businesses.find_one({"id": business["id"]}, {"_id": 0, "vault": 1})
            latest_vault = int((latest or {}).get("vault") or 0)
            if latest_vault < hire_cost:
                raise HTTPException(status_code=400, detail=f"Need ${hire_cost:,} in vault to hire workers.")
        raise HTTPException(status_code=400, detail="Unable to assign workers right now.")
    return {
        "message": "Crew assignments updated.",
        "hire_cost": hire_cost,
        **_distillery_public_payload(distillery, business, current_user, _utc_now()),
    }


async def distillery_maintenance(req: DistilleryMaintenanceRequest, current_user: dict = Depends(get_current_user)):
    business, distillery = await _distillery_business_for_user(current_user)
    recover_points = max(1, int(req.recover_points or 0))
    cost = recover_points * DISTILLERY_MAINTENANCE_RECOVER_COST_PER_POINT
    vault = int(business.get("vault") or 0)
    if vault < cost:
        raise HTTPException(status_code=400, detail=f"Need ${cost:,} in vault for maintenance.")
    current_maintenance = float(distillery.get("maintenance") or 0.0)
    distillery["maintenance"] = _clamp(current_maintenance + recover_points, 0.0, 100.0)
    distillery["last_maintenance_at"] = _utc_now().isoformat()
    result = await db.illegal_businesses.update_one(
        {"id": business["id"], "vault": {"$gte": cost}},
        {"$set": {"distillery": distillery}, "$inc": {"vault": -cost}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Maintenance failed. Try again.")
    return {
        "message": "Maintenance crew finished their pass.",
        "cost": cost,
        **_distillery_public_payload(distillery, business, current_user, _utc_now()),
    }


async def distillery_set_auto_sell(req: DistilleryAutoSellRequest, current_user: dict = Depends(get_current_user)):
    business, distillery = await _distillery_business_for_user(current_user)
    booze_id = (req.booze_id or _default_booze_type_id()).strip() or _default_booze_type_id()
    auto_sell = distillery.get("auto_sell") or {}
    auto_sell["enabled"] = bool(req.enabled)
    auto_sell["booze_id"] = booze_id
    auto_sell["min_inventory"] = max(0, int(req.min_inventory or 0))
    auto_sell["batch_size"] = max(1, int(req.batch_size or 1))
    if req.mode is not None:
        m = str(req.mode).strip().lower()
        if m not in DISTILLERY_AUTO_SELL_MODES:
            raise HTTPException(status_code=400, detail="Invalid auto-sell mode (use crew or booze_run).")
        auto_sell["mode"] = m
    distillery["auto_sell"] = auto_sell
    await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": {"distillery": distillery}})
    return {
        "message": "Auto-sell rules updated.",
        **_distillery_public_payload(distillery, business, current_user, _utc_now()),
    }


async def distillery_set_heat_vault_spend(req: DistilleryHeatVaultSpendRequest, current_user: dict = Depends(get_current_user)):
    business, distillery = await _distillery_business_for_user(current_user)
    distillery["allow_vault_for_heat"] = bool(req.allow_vault_for_heat)
    await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": {"distillery": distillery}})
    if req.allow_vault_for_heat:
        msg = "Vault can pay for heat again (enforcement seizures on collect + Cool Off / Bribe)."
    else:
        msg = "Vault will not pay for heat: enforcement will not seize vault cash on collect, and Cool Off / Bribe are disabled until you turn this back on."
    return {"message": msg, **_distillery_public_payload(distillery, business, current_user, _utc_now())}


async def distillery_set_auto_aging(req: DistilleryAutoAgingRequest, current_user: dict = Depends(get_current_user)):
    business, distillery = await _distillery_business_for_user(current_user)
    tier = (req.tier or "standard").strip().lower()
    if tier not in DISTILLERY_AGING_TIERS:
        raise HTTPException(status_code=400, detail="Invalid aging tier.")
    auto_aging = distillery.get("auto_aging") or {}
    auto_aging["enabled"] = bool(req.enabled)
    auto_aging["tier"] = tier
    auto_aging["reserve_units"] = max(0, int(req.reserve_units or 0))
    auto_aging["auto_collect_booze"] = bool(req.auto_collect_booze)
    distillery["auto_aging"] = auto_aging
    await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": {"distillery": distillery}})
    return {
        "message": "Auto-aging rules updated.",
        **_distillery_public_payload(distillery, business, current_user, _utc_now()),
    }


async def distillery_set_passive_booze_paused(req: DistilleryPassiveBoozePausedRequest, current_user: dict = Depends(get_current_user)):
    paused = bool(req.paused)
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"passive_booze_paused": paused}})
    if paused:
        msg = "All booze intake blocked — nothing can add booze to your inventory until you turn this off in Account → Auto Rank."
    else:
        msg = "Booze intake allowed again (distillery, crimes, missions, booze runs, and other sources)."
    return {"message": msg, "passive_booze_paused": paused}


async def distillery_buy_special_upgrade(req: DistilleryBuySpecialUpgradeRequest, current_user: dict = Depends(get_current_user)):
    uid = (req.upgrade_id or "").strip()
    row = DISTILLERY_SPECIAL_MAP.get(uid)
    if not row:
        raise HTTPException(status_code=400, detail="Unknown special upgrade.")
    business, distillery = await _distillery_business_for_user(current_user)
    unlocked = dict(distillery.get("special_upgrades") or {})
    if unlocked.get(uid):
        raise HTTPException(status_code=400, detail="Upgrade already purchased.")
    tier = int(row.get("tier") or 0)
    if tier > 1:
        prev_uid = f"{row['track']}_{tier - 1:02d}"
        if not unlocked.get(prev_uid):
            raise HTTPException(status_code=400, detail="Buy previous tier in this track first.")
    cost = int(row.get("cost") or 0)
    vault = int(business.get("vault") or 0)
    if vault < cost:
        raise HTTPException(status_code=400, detail=f"Need ${cost:,} in vault. You have ${vault:,}.")
    unlocked[uid] = True
    distillery["special_upgrades"] = unlocked
    progression = _distillery_progression_state(distillery)
    distillery["mastery_tier"] = int(progression["total_steps"] // 30)
    result = await db.illegal_businesses.update_one(
        {"id": business["id"], "vault": {"$gte": cost}},
        {"$set": {"distillery": distillery}, "$inc": {"vault": -cost, "total_spent": cost}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Purchase failed. Try again.")
    return {
        "message": f"Purchased {row.get('name')}.",
        "upgrade_id": uid,
        "cost": cost,
        **_distillery_public_payload(distillery, business, current_user, _utc_now()),
    }


async def distillery_risk_action(req: DistilleryRiskActionRequest, current_user: dict = Depends(get_current_user)):
    action = (req.action or "").strip().lower()
    if action not in {"cool_off", "bribe_crackdown"}:
        raise HTTPException(status_code=400, detail="Invalid risk action.")
    action_costs = DISTILLERY_RISK_ACTION_COSTS
    business, distillery = await _distillery_business_for_user(current_user)
    if distillery.get("allow_vault_for_heat") is False:
        raise HTTPException(
            status_code=400,
            detail="Vault spending on heat is turned off. Use the Heat panel toggle to allow it again before Cool Off or Bribe.",
        )
    now = _utc_now()
    last = _parse_iso_utc(distillery.get("last_risk_action_at"), now)
    if distillery.get("last_risk_action_at") and (now - last).total_seconds() < DISTILLERY_RISK_ACTION_COOLDOWN_HOURS * 3600:
        raise HTTPException(status_code=400, detail=f"Risk actions are on cooldown ({DISTILLERY_RISK_ACTION_COOLDOWN_HOURS}h).")
    cost = int(action_costs[action])
    vault = int(business.get("vault") or 0)
    if vault < cost:
        raise HTTPException(status_code=400, detail=f"Need ${cost:,} in vault. You have ${vault:,}.")
    heat = float(distillery.get("heat") or 0.0)
    had_shutdown = bool(distillery.get("shutdown_until"))
    heat_before = heat
    heat = float(DISTILLERY_RISK_ACTION_HEAT_AFTER)
    distillery["heat"] = heat
    distillery["shutdown_until"] = None
    distillery["last_heat_at"] = now.isoformat()
    distillery["last_risk_action_at"] = now.isoformat()
    risk_actions = distillery.get("risk_actions") or {}
    risk_actions[action] = int(risk_actions.get(action) or 0) + 1
    distillery["risk_actions"] = risk_actions
    cutoff = (now - timedelta(hours=DISTILLERY_RISK_ACTION_COOLDOWN_HOURS)).isoformat()
    result = await db.illegal_businesses.update_one(
        {
            "id": business["id"],
            "vault": {"$gte": cost},
            "$or": [
                {"distillery.last_risk_action_at": {"$exists": False}},
                {"distillery.last_risk_action_at": None},
                {"distillery.last_risk_action_at": {"$lte": cutoff}},
            ],
        },
        {"$set": {"distillery": distillery}, "$inc": {"vault": -cost}},
    )
    if result.modified_count == 0:
        latest = await db.illegal_businesses.find_one({"id": business["id"]}, {"_id": 0, "vault": 1, "distillery.last_risk_action_at": 1})
        latest_vault = int((latest or {}).get("vault") or 0)
        latest_last = ((latest or {}).get("distillery") or {}).get("last_risk_action_at")
        if latest_vault < cost:
            raise HTTPException(status_code=400, detail=f"Need ${cost:,} in vault. You have ${latest_vault:,}.")
        last_dt = _parse_iso_utc(latest_last, now)
        if latest_last and (now - last_dt).total_seconds() < DISTILLERY_RISK_ACTION_COOLDOWN_HOURS * 3600:
            raise HTTPException(status_code=400, detail=f"Risk actions are on cooldown ({DISTILLERY_RISK_ACTION_COOLDOWN_HOURS}h).")
        raise HTTPException(status_code=400, detail="Risk action failed.")
    action_label = "Cool Off" if action == "cool_off" else "Bribe"
    msg = f"{action_label} paid (${cost:,}). Heat cleared from {heat_before:.1f} to {heat:.1f}."
    if had_shutdown:
        msg += " Enforcement shutdown lifted — stills are back online."
    return {
        "message": msg,
        "action": action,
        "cost": cost,
        "heat_before": heat_before,
        "heat_after": heat,
        "shutdown_lifted": had_shutdown,
        **_distillery_public_payload(distillery, business, current_user, _utc_now()),
    }


async def distillery_start_aging_batch(req: DistilleryStartAgingRequest, current_user: dict = Depends(get_current_user)):
    business, distillery = await _distillery_business_for_user(current_user)
    tier = (req.tier or "").strip().lower()
    if tier not in DISTILLERY_AGING_TIERS:
        raise HTTPException(status_code=400, detail="Invalid aging tier.")
    qty = max(1, int(req.quantity or 0))
    queue = list(distillery.get("aging_queue") or [])
    if len(queue) >= DISTILLERY_MAX_ACTIVE_BATCHES:
        raise HTTPException(status_code=400, detail="Aging cellars are full.")
    booze_id = _default_booze_type_id()
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "booze_carrying": 1})
    carrying = (user or {}).get("booze_carrying") or {}
    have = int(carrying.get(booze_id) or 0)
    if have < qty:
        raise HTTPException(status_code=400, detail=f"Need {qty} units of booze to age. You have {have}.")
    ok, batch_id, ready_at = await _distillery_start_aging_batch_persist(business["id"], current_user["id"], distillery, tier, qty)
    if not ok or not batch_id:
        raise HTTPException(status_code=400, detail="Could not reserve booze for aging.")
    return {
        "message": f"Batch {batch_id[:8]} started in the {tier} cellar.",
        "batch_id": batch_id,
        "ready_at": ready_at,
        **_distillery_public_payload(distillery, business, current_user, _utc_now()),
    }


async def distillery_claim_aged_batch(req: DistilleryClaimBatchRequest, current_user: dict = Depends(get_current_user)):
    business, distillery = await _distillery_business_for_user(current_user)
    batch_id = (req.batch_id or "").strip()
    if not batch_id:
        raise HTTPException(status_code=400, detail="Batch id required.")
    queue = list(distillery.get("aging_queue") or [])
    idx = next((i for i, row in enumerate(queue) if str(row.get("id")) == batch_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Batch not found.")
    batch = queue[idx]
    now = _utc_now()
    ready_at = _parse_iso_utc(batch.get("ready_at"), now)
    if now < ready_at:
        raise HTTPException(status_code=400, detail="Batch is still aging.")
    qty = int(batch.get("quantity") or 0)
    cash_mult = float(batch.get("cash_mult") or 1.0)
    quality_mult = float(batch.get("quality_mult") or 1.0)
    cash = int(qty * DISTILLERY_BASE_BOOZE_UNIT_VALUE * cash_mult * quality_mult)
    heat = float(distillery.get("heat") or 0.0)
    if heat >= DISTILLERY_HEAT_THRESHOLDS["hot"]:
        cash = int(cash * 0.9)
    cash = int(cash * _distillery_cash_token_mult(current_user, now))
    queue.pop(idx)
    distillery["aging_queue"] = queue
    stats = distillery.get("stats") or {}
    stats["total_batches_claimed"] = int(stats.get("total_batches_claimed") or 0) + 1
    if (batch.get("tier") or "") == "premium":
        stats["premium_sells"] = int(stats.get("premium_sells") or 0) + 1
    distillery["stats"] = stats

    await db.illegal_businesses.update_one(
        {"id": business["id"]},
        {"$set": {"distillery": distillery}, "$inc": {"vault": cash, "vault_lifetime_earned": max(0, cash)}},
    )
    return {
        "message": f"Batch sold for ${cash:,}.",
        "cash": cash,
        **_distillery_public_payload(distillery, business, current_user, _utc_now()),
    }


async def get_illegal_business_missions(current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    active_guards_count = 0
    if business and business.get("id"):
        active_guards_count = int(
            await db.illegal_business_guards.count_documents({"business_id": business["id"]})
        )
    progress_user = await _ibm_load_user_with_mission_baselines(current_user["id"], current_user)
    completions = progress_user.get("illegal_business_mission_completions") or []
    completed_ids = {c.get("mission_id") for c in completions if c.get("mission_id")}
    progress = [
        _ibm_mission_progress_row(
            progress_user,
            business,
            m,
            completed_ids,
            active_guards_count=active_guards_count,
        )
        for m in _ordered_ibm_missions()
    ]
    return {"missions": progress}


async def complete_illegal_business_mission(mission_id: str, current_user: dict = Depends(get_current_user)):
    mission = next((m for m in ILLEGAL_BUSINESS_MISSIONS if m["id"] == mission_id), None)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found.")
    progress_user = await _ibm_load_user_with_mission_baselines(current_user["id"], current_user)
    completions = progress_user.get("illegal_business_mission_completions") or []
    completed_ids = {c.get("mission_id") for c in completions if c.get("mission_id")}
    if mission_id in completed_ids:
        raise HTTPException(status_code=400, detail="Mission already completed.")
    ordered = _ordered_ibm_missions()
    prev_m = next((x for x in ordered if x["order"] == mission["order"] - 1), None)
    if prev_m is not None and prev_m["id"] not in completed_ids:
        raise HTTPException(status_code=400, detail="Complete the previous mission first.")
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You need an illegal business.")
    req = mission.get("requirements") or {}
    active_guards_count = 0
    if business.get("id"):
        active_guards_count = int(
            await db.illegal_business_guards.count_documents({"business_id": business["id"]})
        )
    met = True
    for key, target in req.items():
        cur = _ibm_requirement_current(
            progress_user,
            business,
            mission,
            key,
            active_guards_count=active_guards_count,
        )
        if cur < target:
            met = False
            break
    if not met:
        raise HTTPException(status_code=400, detail="Requirements not met.")
    rewards = mission.get("rewards") or {}
    now = datetime.now(timezone.utc).isoformat()
    user_updates = {"$push": {"illegal_business_mission_completions": {"mission_id": mission_id, "completed_at": now}}}
    for token_type in TOKEN_TYPES_GLOBAL_RANDOM_DROP:
        field = TOKEN_CONFIG[token_type]["count_field"]
        if rewards.get(field):
            user_updates["$inc"] = user_updates.get("$inc") or {}
            user_updates["$inc"][field] = int(rewards[field])
    result = await db.users.update_one(
        {"id": current_user["id"], "illegal_business_mission_completions.mission_id": {"$ne": mission_id}},
        user_updates,
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Mission already completed.")
    await _ibm_set_baselines_for_next_mission(current_user["id"], mission_id)
    if rewards.get("raid_daily_limit_add"):
        add = int(rewards["raid_daily_limit_add"])
        await db.users.update_one(
            {"id": current_user["id"]},
            [
                {
                    "$set": {
                        "illegal_business_raid_daily_limit": {
                            "$min": [
                                RAID_DAILY_LIMIT_MAX,
                                {
                                    "$add": [
                                        {"$ifNull": ["$illegal_business_raid_daily_limit", RAID_DAILY_LIMIT_DEFAULT]},
                                        add,
                                    ]
                                },
                            ]
                        }
                    }
                }
            ],
        )
    update_business_set = {}
    update_business_inc = {}
    if "income_mult" in rewards or "income_per_hour_add" in rewards:
        iph = int(business.get("income_per_hour") or INCOME_PER_HOUR_BASE)
        if "income_mult" in rewards:
            iph = int(iph * float(rewards["income_mult"]))
        if "income_per_hour_add" in rewards:
            iph += int(rewards["income_per_hour_add"])
        update_business_set["income_per_hour"] = max(0, iph)
    if "guard_weapon_max" in rewards:
        update_business_set["guard_weapon_max_unlock"] = int(business.get("guard_weapon_max_unlock") or 0) + 1
    if "guard_armour_max" in rewards:
        cur_a = business.get("guard_armour_max_unlock")
        if cur_a is None:
            cur_a = int(business.get("guard_weapon_max_unlock") or 0)
        else:
            cur_a = int(cur_a)
        update_business_set["guard_armour_max_unlock"] = cur_a + 1
    if rewards.get("guard_slots"):
        update_business_inc["guard_slots"] = int(rewards["guard_slots"])
    if rewards.get("income_cap_hours_add"):
        cur_cap = int(business.get("income_cap_hours") or INCOME_CAP_HOURS_BASE)
        new_cap = cur_cap + int(rewards["income_cap_hours_add"])
        update_business_set["income_cap_hours"] = min(INCOME_CAP_HOURS_MAX, new_cap)
    if rewards.get("defender_strength_bonus_add"):
        cur_b = int(business.get("defender_strength_bonus") or 0)
        new_b = cur_b + int(rewards["defender_strength_bonus_add"])
        update_business_set["defender_strength_bonus"] = min(DEFENDER_STRENGTH_BONUS_CAP, new_b)
    if rewards.get("raid_incoming_loot_mult_sub") is not None:
        cur_m = float(business.get("raid_incoming_loot_mult") or 1.0)
        sub = float(rewards["raid_incoming_loot_mult_sub"])
        update_business_set["raid_incoming_loot_mult"] = max(
            RAID_INCOMING_LOOT_MULT_MIN, round(cur_m - sub, 4)
        )
    if rewards.get("vault_cash"):
        update_business_inc["vault"] = int(rewards["vault_cash"])
        update_business_inc["vault_lifetime_earned"] = int(rewards["vault_cash"])
    biz_update = {}
    if update_business_set:
        reconciled_last = _reconcile_till_last_collected_after_stat_change(
            business, update_business_set, current_user, now=datetime.now(timezone.utc)
        )
        if reconciled_last is not None:
            update_business_set["last_collected_at"] = reconciled_last
        biz_update["$set"] = update_business_set
    if update_business_inc:
        biz_update["$inc"] = update_business_inc
    if biz_update:
        await db.illegal_businesses.update_one({"id": business["id"]}, biz_update)
    return {"message": mission.get("story", "Progress step complete.")}


async def get_illegal_business_guards(current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    slots = int(business.get("guard_slots") or GUARD_SLOTS_INITIAL)
    limit = min(2000, max(slots + 100, 500))
    guards_raw = await db.illegal_business_guards.find({"business_id": business["id"]}, {"_id": 0}).sort("slot_number", 1).to_list(limit)
    guards = [_guard_doc_with_upgrade_costs(business, g) for g in guards_raw]
    return {"guards": guards, "guard_slots": slots}


async def buy_guard_slot(current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    slots = int(business.get("guard_slots") or GUARD_SLOTS_INITIAL)
    if slots >= GUARD_SLOTS_MAX:
        raise HTTPException(status_code=400, detail="Maximum guard slots reached.")
    exp = slots - GUARD_SLOTS_INITIAL
    cost_cash = int(GUARD_SLOT_BASE_CASH * (GUARD_SLOT_MULT ** exp))
    vault = int(business.get("vault") or 0)
    if vault < cost_cash:
        raise HTTPException(status_code=400, detail=f"Need ${cost_cash:,} in vault. You have ${vault:,}.")
    total_spent = int(business.get("total_spent") or 0) + cost_cash
    result = await db.illegal_businesses.update_one(
        {"id": business["id"], "vault": {"$gte": cost_cash}},
        {"$inc": {"guard_slots": 1, "vault": -cost_cash}, "$set": {"total_spent": total_spent}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient vault funds")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"illegal_business_guard_slots_bought": 1}})
    return {"message": "Another slot on the door.", "guard_slots": slots + 1}


async def hire_illegal_business_guard(req: HireGuardRequest, current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    slots = int(business.get("guard_slots") or GUARD_SLOTS_INITIAL)
    existing = await db.illegal_business_guards.find({"business_id": business["id"]}, {"_id": 0}).to_list(slots + 1)
    if len(existing) >= slots:
        raise HTTPException(status_code=400, detail="No guard slots left. Buy another slot to add more guards.")
    slot = req.slot_number
    if slot < 1 or slot > slots:
        raise HTTPException(status_code=400, detail="Invalid slot.")
    if any(g.get("slot_number") == slot for g in existing):
        raise HTTPException(status_code=400, detail="Slot already filled.")
    armour_max, weapon_max = _guard_level_caps(business)
    armour = max(0, min(armour_max, req.armour_level))
    weapon = max(0, min(weapon_max, req.weapon_level))
    cost_cash = GUARD_HIRE_COST_CASH
    vault = int(business.get("vault") or 0)
    if vault < cost_cash:
        raise HTTPException(status_code=400, detail=f"Need ${cost_cash:,} in vault. You have ${vault:,}.")
    guard_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    guard_doc = {
        "id": guard_id,
        "business_id": business["id"],
        "user_id": current_user["id"],
        "slot_number": slot,
        "armour_level": armour,
        "weapon_level": weapon,
        "hired_at": now,
        "hire_cost": cost_cash,
    }
    total_spent = int(business.get("total_spent") or 0) + cost_cash
    result = await db.illegal_businesses.update_one(
        {"id": business["id"], "vault": {"$gte": cost_cash}},
        {"$set": {"total_spent": total_spent}, "$inc": {"vault": -cost_cash}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient vault funds")
    await db.illegal_business_guards.insert_one(guard_doc)
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"illegal_business_guards_hired": 1}})
    return {"message": "Another pair of hands on the door.", "guard_id": guard_id}


async def upgrade_illegal_business_guard_gear(req: GuardGearUpgradeRequest, current_user: dict = Depends(get_current_user)):
    if not req.upgrade_armour and not req.upgrade_weapon:
        raise HTTPException(status_code=400, detail="Choose armour and/or weapon to upgrade.")
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    guard = await db.illegal_business_guards.find_one(
        {"id": req.guard_id, "business_id": business["id"], "user_id": current_user["id"]},
        {"_id": 0},
    )
    if not guard:
        raise HTTPException(status_code=404, detail="Guard not found.")
    armour_max, weapon_max = _guard_level_caps(business)
    armour = int(guard.get("armour_level") or 0)
    weapon = int(guard.get("weapon_level") or 0)
    cost = 0
    new_a, new_w = armour, weapon
    if req.upgrade_armour:
        if armour >= armour_max:
            raise HTTPException(status_code=400, detail="Armour is already at max for your unlocks.")
        cost += _guard_gear_upgrade_cost(armour)
        new_a = armour + 1
    if req.upgrade_weapon:
        if weapon >= weapon_max:
            raise HTTPException(status_code=400, detail="Weapon is already at max for your unlocks.")
        cost += _guard_gear_upgrade_cost(weapon)
        new_w = weapon + 1
    if cost <= 0:
        raise HTTPException(status_code=400, detail="Nothing to upgrade.")
    vault = int(business.get("vault") or 0)
    if vault < cost:
        raise HTTPException(status_code=400, detail=f"Need ${cost:,} in vault. You have ${vault:,}.")
    prev_spent = int(business.get("total_spent") or 0)
    total_spent = prev_spent + cost
    result = await db.illegal_businesses.update_one(
        {"id": business["id"], "vault": {"$gte": cost}},
        {"$inc": {"vault": -cost}, "$set": {"total_spent": total_spent}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient vault funds")
    gresult = await db.illegal_business_guards.update_one(
        {"id": req.guard_id, "business_id": business["id"]},
        {"$set": {"armour_level": new_a, "weapon_level": new_w}},
    )
    if gresult.modified_count == 0:
        await db.illegal_businesses.update_one(
            {"id": business["id"]},
            {"$inc": {"vault": cost}, "$set": {"total_spent": prev_spent}},
        )
        raise HTTPException(status_code=500, detail="Could not update guard; vault charge reverted.")
    return {
        "message": "Gear upgraded.",
        "guard_id": req.guard_id,
        "armour_level": new_a,
        "weapon_level": new_w,
        "cost_cash": cost,
    }


async def upgrade_security(upgrade_id: str, current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    upgrades_done = business.get("security_upgrades") or []
    if not isinstance(upgrades_done, list):
        upgrades_done = list(upgrades_done) if isinstance(upgrades_done, dict) else []
    idx = next((i for i, u in enumerate(SECURITY_UPGRADES) if u["id"] == upgrade_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Upgrade not found.")
    if idx < len(upgrades_done):
        raise HTTPException(status_code=400, detail="Already have this upgrade.")
    if idx > len(upgrades_done):
        raise HTTPException(status_code=400, detail="Unlock previous upgrades first.")
    cost_cash = security_upgrade_cost_cash(idx)
    up_def = SECURITY_UPGRADES[idx]
    vault = int(business.get("vault") or 0)
    if vault < cost_cash:
        raise HTTPException(status_code=400, detail=f"Need ${cost_cash:,} in vault. You have ${vault:,}.")
    new_list = list(upgrades_done) + [upgrade_id]
    total_spent = int(business.get("total_spent") or 0) + cost_cash
    result = await db.illegal_businesses.update_one(
        {"id": business["id"], "vault": {"$gte": cost_cash}},
        {"$set": {"security_upgrades": new_list, "security_level": len(new_list), "total_spent": total_spent},
         "$inc": {"vault": -cost_cash}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient vault funds")
    return {"message": f"{up_def['name']} installed.", "security_level": len(new_list)}


async def withdraw_illegal_business(req: WithdrawRequest, current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    vault = int(business.get("vault") or 0)
    amount = int(req.amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive.")
    if vault < MIN_IBM_CASH_ACTION:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least ${MIN_IBM_CASH_ACTION:,} in the vault to withdraw. Current: ${vault:,}.",
        )
    if amount > vault:
        raise HTTPException(status_code=400, detail=f"Not enough in the vault. Available: ${vault:,}")
    result = await db.illegal_businesses.update_one(
        {"id": business["id"], "vault": {"$gte": amount}},
        {"$inc": {"vault": -amount}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient vault funds")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": amount, "illegal_business_vault_withdrawals": 1}},
    )
    return {"message": f"Pocketed ${amount:,} from the vault.", "withdrawn": amount, "vault_remaining": vault - amount}


async def patch_illegal_business(req: PatchBusinessRequest, current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    updates = {}
    if req.name is not None:
        updates["name"] = (req.name or business.get("name") or "The Racket").strip()[:80]
    if updates:
        await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": updates})
    return {"message": "Updated."}


async def raid_illegal_business(req: RaidRequest, current_user: dict = Depends(get_current_user)):
    safe = re.escape(req.target_username.strip())
    target_user = await db.users.find_one({"username": {"$regex": f"^{safe}$", "$options": "i"}}, {"_id": 0, "id": 1, "username": 1})
    if not target_user:
        raise HTTPException(status_code=404, detail="Target not found.")
    target_id = target_user["id"]
    if target_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="You can't raid yourself.")
    business = await db.illegal_businesses.find_one({"user_id": target_id}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=400, detail="Target has no illegal business.")
    state = (req.state or business.get("state") or "").strip()
    if state and business.get("state") != state:
        raise HTTPException(status_code=400, detail="Target's business is in a different state.")
    # Cooldown: raid_cooldowns: { target_id: last_raid_at }
    cooldowns = current_user.get("illegal_business_raid_cooldowns") or {}
    last = cooldowns.get(target_id)
    if last:
        try:
            last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - last_dt).total_seconds() < RAID_COOLDOWN_HOURS * 3600:
                raise HTTPException(status_code=400, detail=f"Raid cooldown. Try again in {RAID_COOLDOWN_HOURS}h.")
        except Exception:
            pass
    today_key = game_today_date_str()
    now = datetime.now(timezone.utc).isoformat()
    cooldowns_new = dict(cooldowns)
    cooldowns_new[target_id] = now
    claim_result = await db.users.find_one_and_update(
        {
            "id": current_user["id"],
            "$or": [
                {"illegal_business_raids_date": {"$ne": today_key}},
                {
                    "$expr": {
                        "$lt": [
                            {"$ifNull": ["$illegal_business_raids_today", 0]},
                            {
                                "$min": [
                                    RAID_DAILY_LIMIT_MAX,
                                    {
                                        "$max": [
                                            RAID_DAILY_LIMIT_DEFAULT,
                                            {"$ifNull": ["$illegal_business_raid_daily_limit", RAID_DAILY_LIMIT_DEFAULT]},
                                        ]
                                    },
                                ]
                            },
                        ]
                    }
                },
            ],
        },
        [{"$set": {
            "illegal_business_raid_cooldowns": cooldowns_new,
            "illegal_business_raids_date": today_key,
            "illegal_business_raids_today": {
                "$cond": {
                    "if": {"$ne": ["$illegal_business_raids_date", today_key]},
                    "then": 1,
                    "else": {"$add": [{"$ifNull": ["$illegal_business_raids_today", 0]}, 1]},
                }
            },
        }}],
        return_document=False,
    )
    if not claim_result:
        lim = _effective_raid_daily_limit(current_user)
        raise HTTPException(status_code=400, detail=f"Daily raid limit ({lim}) reached.")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"illegal_business_raids_attempted": 1}})
    guards = await db.illegal_business_guards.find({"business_id": business["id"]}, {"_id": 0}).to_list(2000)
    defender_str = _business_defender_strength(business, guards)
    attacker_str = _attacker_strength(current_user)
    win_prob = _raid_win_probability(attacker_str, defender_str)
    won = _rng.random() < win_prob
    attacker_username = current_user.get("username", "?")
    loot_cash = 0
    loot_points = 0
    loot_cash_credited = 0
    if won:
        last_c = business.get("last_collected_at")
        try:
            last_dt = datetime.fromisoformat(last_c.replace("Z", "+00:00")) if last_c else datetime.now(timezone.utc)
        except Exception:
            last_dt = datetime.now(timezone.utc)
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
        hours = max(0.0, (datetime.now(timezone.utc) - last_dt).total_seconds() / 3600)
        iph = int(business.get("income_per_hour") or INCOME_PER_HOUR_BASE)
        cap = int(business.get("income_cap_hours") or INCOME_CAP_HOURS_BASE)
        available = min(hours * iph, iph * cap)
        victim_mult = float(business.get("raid_incoming_loot_mult") or 1.0)
        victim_mult = max(RAID_INCOMING_LOOT_MULT_MIN, min(1.0, victim_mult))
        loot_cash = int(available * RAID_LOOT_PERCENT * victim_mult)
        loot_cash_credited = loot_cash
        if loot_cash > 0:
            ev = await get_effective_event()
            prestige = get_prestige_bonus(current_user)
            loot_cash_credited = int(loot_cash * float(ev.get("racket_payout", 1.0)) * float(prestige.get("illegal_business_mult", 1.0)))
            await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": loot_cash_credited}})
            hours_to_skip = loot_cash / iph if iph else 0
            if hours_to_skip > 0:
                new_last = last_dt + timedelta(hours=hours_to_skip)
                await db.illegal_businesses.update_one(
                    {"id": business["id"]},
                    {"$set": {"last_collected_at": new_last.isoformat()}},
                )
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"illegal_business_raids_won": 1}})
        target_username = target_user.get("username") or "?"
        await send_notification(
            current_user["id"],
            "Raid",
            f"You hit {target_username}'s joint. Took ${loot_cash_credited:,}.",
            "attack",
            category="attacks",
            actor_username=target_username,
        )
        await send_notification(
            target_id,
            "Raid",
            f"Your joint was hit by {attacker_username}. You lost ${loot_cash:,}.",
            "attack",
            category="attacks",
            actor_username=attacker_username,
        )
    else:
        target_username = target_user.get("username") or "?"
        await send_notification(
            current_user["id"],
            "Raid",
            f"You tried to hit {target_username}'s joint. They were ready—you got nothing.",
            "attack",
            category="attacks",
            actor_username=target_username,
        )
        await send_notification(
            target_id,
            "Raid",
            f"Someone tried to hit your joint ({attacker_username}). They were turned away.",
            "attack",
            category="attacks",
            actor_username=attacker_username,
        )
    await log_activity(current_user["id"], current_user.get("username", "?"), "illegal_biz_raid", {
        "target": target_user.get("username"), "success": won, "cash": loot_cash_credited if won else 0,
    })
    return {
        "success": won,
        "loot_cash": loot_cash_credited if won else loot_cash,
        "loot_points": loot_points,
        "message": (
            f"You hit {target_user.get('username') or '?'}'s joint. Took ${loot_cash_credited:,}."
            if won
            else f"You tried to hit {target_user.get('username') or '?'}'s joint. They were ready—you got nothing."
        ),
        "target_username": target_user.get("username"),
    }


async def raid_random_illegal_business(current_user: dict = Depends(get_current_user)):
    """Pick a random eligible target (has business, not self) and run the same raid flow. Cooldown and daily limit apply."""
    # Daily limit check first
    today_key = game_today_date_str()
    raid_count_today = int(current_user.get("illegal_business_raids_today") or 0)
    raid_date = current_user.get("illegal_business_raids_date")
    if raid_date != today_key:
        raid_count_today = 0
    lim_rr = _effective_raid_daily_limit(current_user)
    if raid_count_today >= lim_rr:
        raise HTTPException(status_code=400, detail=f"Daily raid limit ({lim_rr}) reached.")
    # Sample only businesses whose owner still exists with a usable username (avoids orphaned
    # illegal_businesses rows → intermittent "Target not found" on $sample + lookup mismatch).
    me_id = current_user["id"]
    pipeline = [
        {"$match": {"user_id": {"$ne": me_id}}},
        {
            "$lookup": {
                "from": "users",
                "let": {"uid": "$user_id"},
                "pipeline": [
                    {"$match": {"$expr": {"$eq": ["$id", "$$uid"]}}},
                    {
                        "$match": {
                            "$expr": {
                                "$gt": [
                                    {"$strLenCP": {"$trim": {"input": {"$ifNull": ["$username", ""]}}}},
                                    0,
                                ]
                            }
                        }
                    },
                    {"$project": {"_id": 0, "id": 1, "username": 1}},
                ],
                "as": "_raid_owner",
            }
        },
        {"$match": {"_raid_owner.0": {"$exists": True}}},
        {"$sample": {"size": 1}},
    ]
    cursor = db.illegal_businesses.aggregate(pipeline)
    result = await cursor.to_list(1)
    if not result:
        raise HTTPException(status_code=404, detail="No other players with a business to raid.")
    row = result[0]
    owner = row["_raid_owner"][0]
    username = str(owner.get("username") or "").strip()
    if not username:
        raise HTTPException(status_code=404, detail="No other players with a business to raid.")
    req = RaidRequest(target_username=username, state=row.get("state"))
    return await raid_illegal_business(req, current_user)


async def claim_kill_reward(req: ClaimKillRewardRequest, current_user: dict = Depends(get_current_user)):
    choice = (req.choice or "").strip().lower()
    if choice not in ("takeover", "liquidate", "absorb"):
        raise HTTPException(status_code=400, detail="Choice must be 'takeover', 'liquidate', or 'absorb'.")
    killer_id = current_user["id"]
    pending = current_user.get("pending_illegal_business_rewards") or []
    entry = next((p for p in pending if p.get("victim_id") == req.victim_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="No pending reward for this victim.")
    snap = entry.get("business_snapshot")
    killer_biz_live = await db.illegal_businesses.find_one({"user_id": killer_id}, {"_id": 0})
    if choice == "takeover" and not snap:
        raise HTTPException(
            status_code=400,
            detail="This reward is too old to take over (no business snapshot). Liquidate for cash instead.",
        )
    if choice == "takeover":
        # Must use full session user (rank_points + prestige_rank_multiplier); a DB row with only `rank`
        # makes _user_rank_id see 0 RP and wrongly blocks Don+ / prestiged players.
        if _user_rank_id(current_user) < CAPO_RANK_ID:
            raise HTTPException(
                status_code=403,
                detail="Only Capo or higher can take over an illegal business. Liquidate for cash instead.",
            )
        if killer_biz_live and snap and not _seized_snapshot_stronger_than_current(snap, killer_biz_live):
            raise HTTPException(
                status_code=400,
                detail="Their racket isn't stronger than yours on till rate. Use Absorb for +5% on your income/hr plus cash, or liquidate.",
            )
    if choice == "absorb":
        if not snap:
            raise HTTPException(
                status_code=400,
                detail="This reward is too old to absorb (no business snapshot). Liquidate for cash instead.",
            )
        if not killer_biz_live:
            raise HTTPException(
                status_code=400,
                detail="You need an illegal business to absorb into. Take over or liquidate.",
            )
        if _seized_snapshot_stronger_than_current(snap, killer_biz_live):
            raise HTTPException(
                status_code=400,
                detail="Their operation beats yours — use full takeover (Capo+) or liquidate.",
            )
    old_user = await db.users.find_one_and_update(
        {"id": killer_id, "pending_illegal_business_rewards.victim_id": req.victim_id},
        {"$pull": {"pending_illegal_business_rewards": {"victim_id": req.victim_id}}},
    )
    if not old_user:
        raise HTTPException(status_code=404, detail="No pending reward for this victim.")
    reward_entry = next((p for p in old_user.get("pending_illegal_business_rewards", []) if p.get("victim_id") == req.victim_id), None)
    if not reward_entry:
        raise HTTPException(status_code=404, detail="No pending reward for this victim.")
    snap = reward_entry.get("business_snapshot")
    total_spent = int(reward_entry.get("total_spent") or 0)
    if choice == "liquidate":
        if snap:
            cash = await _kill_reward_liquidation_cash(snap, current_user)
        else:
            cash = max(0, total_spent)
        await db.users.update_one(
            {"id": killer_id},
            {"$inc": {"money": cash, "illegal_business_kill_rewards_claimed": 1}},
        )
        return {
            "message": f"Liquidated the operation for ${cash:,}.",
            "cash": cash,
            "business_id": None,
        }
    if choice == "absorb":
        cash = await _kill_reward_liquidation_cash(snap, current_user)
        kb = await db.illegal_businesses.find_one({"user_id": killer_id}, {"_id": 0, "id": 1, "income_per_hour": 1})
        if not kb:
            raise HTTPException(status_code=404, detail="Your illegal business is missing.")
        old_iph = int(kb.get("income_per_hour") or INCOME_PER_HOUR_BASE)
        new_iph = max(INCOME_PER_HOUR_BASE, int(round(old_iph * KILL_TAKEOVER_INCOME_MULT)))
        await db.illegal_businesses.update_one({"id": kb["id"]}, {"$set": {"income_per_hour": new_iph}})
        await db.users.update_one(
            {"id": killer_id},
            {"$inc": {"money": cash, "illegal_business_kill_rewards_claimed": 1}},
        )
        pct = int((KILL_TAKEOVER_INCOME_MULT - 1) * 100)
        return {
            "message": f"You folded their books into yours (+{pct}% /hr on your racket) and took ${cash:,}.",
            "cash": cash,
            "business_id": kb["id"],
            "income_per_hour": new_iph,
        }
    # takeover
    killer_old = await db.illegal_businesses.find_one({"user_id": killer_id}, {"_id": 0, "id": 1})
    if killer_old:
        await db.illegal_business_guards.delete_many({"business_id": killer_old["id"]})
        await db.illegal_businesses.delete_one({"id": killer_old["id"]})
    new_biz_id = str(uuid.uuid4())
    biz_doc = dict(snap)
    biz_doc.pop("_id", None)
    iph = int(biz_doc.get("income_per_hour") or INCOME_PER_HOUR_BASE)
    biz_doc["id"] = new_biz_id
    biz_doc["user_id"] = killer_id
    biz_doc["income_per_hour"] = int(round(iph * KILL_TAKEOVER_INCOME_MULT))
    type_def = next((t for t in ILLEGAL_BUSINESS_TYPES if t["id"] == biz_doc.get("type_id")), {})
    raw_name = (req.new_name or "").strip() if req.new_name is not None else ""
    if raw_name:
        biz_doc["name"] = raw_name[:80]
    elif not (biz_doc.get("name") or "").strip():
        biz_doc["name"] = (type_def.get("name") or "The Racket")[:80]
    await db.illegal_businesses.insert_one(biz_doc)
    for g in reward_entry.get("guards_snapshot") or []:
        gd = {k: v for k, v in dict(g).items() if k != "_id"}
        gd["id"] = str(uuid.uuid4())
        gd["business_id"] = new_biz_id
        gd["user_id"] = killer_id
        await db.illegal_business_guards.insert_one(gd)
    await db.users.update_one({"id": killer_id}, {"$inc": {"illegal_business_kill_rewards_claimed": 1}})
    return {
        "message": f"You took over the operation (+{int((KILL_TAKEOVER_INCOME_MULT - 1) * 100)}% income/hr).",
        "cash": 0,
        "business_id": new_biz_id,
    }


async def _illegal_business_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_ILLEGAL_BUSINESS)


_illegal_business_rl_u = [Depends(_illegal_business_sustained_rl_user)]


def register(router):
    router.add_api_route("/illegal-business/types", get_illegal_business_types, methods=["GET"], dependencies=_illegal_business_rl_u)
    router.add_api_route("/illegal-business", get_illegal_business, methods=["GET"], dependencies=_illegal_business_rl_u)
    router.add_api_route("/illegal-business/start", start_illegal_business, methods=["POST"])
    router.add_api_route("/illegal-business/collect", collect_illegal_business, methods=["POST"])
    router.add_api_route("/illegal-business/distillery", get_distillery, methods=["GET"], dependencies=_illegal_business_rl_u)
    router.add_api_route("/illegal-business/distillery/page", get_distillery_page, methods=["GET"], dependencies=_illegal_business_rl_u)
    router.add_api_route("/illegal-business/distillery/progression-catalog", get_distillery_progression_catalog, methods=["GET"], dependencies=_illegal_business_rl_u)
    router.add_api_route("/illegal-business/distillery/collect", distillery_collect, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/upgrade-equipment", distillery_upgrade_equipment, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/buy-special-upgrade", distillery_buy_special_upgrade, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/assign-workers", distillery_assign_workers, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/maintenance", distillery_maintenance, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/risk-action", distillery_risk_action, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/set-heat-vault-spend", distillery_set_heat_vault_spend, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/set-auto-sell-rules", distillery_set_auto_sell, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/set-auto-aging-rules", distillery_set_auto_aging, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/set-passive-booze-paused", distillery_set_passive_booze_paused, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/start-aging-batch", distillery_start_aging_batch, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/claim-aged-batch", distillery_claim_aged_batch, methods=["POST"])
    router.add_api_route("/illegal-business/missions", get_illegal_business_missions, methods=["GET"])
    router.add_api_route("/illegal-business/missions/{mission_id}/complete", complete_illegal_business_mission, methods=["POST"])
    router.add_api_route("/illegal-business/guards", get_illegal_business_guards, methods=["GET"])
    router.add_api_route("/illegal-business/guards/buy-slot", buy_guard_slot, methods=["POST"])
    router.add_api_route("/illegal-business/guards/hire", hire_illegal_business_guard, methods=["POST"])
    router.add_api_route("/illegal-business/guards/upgrade", upgrade_illegal_business_guard_gear, methods=["POST"])
    router.add_api_route("/illegal-business/security/upgrade/{upgrade_id}", upgrade_security, methods=["POST"])
    router.add_api_route("/illegal-business/withdraw", withdraw_illegal_business, methods=["POST"])
    router.add_api_route("/illegal-business", patch_illegal_business, methods=["PATCH"])
    router.add_api_route("/illegal-business/raid", raid_illegal_business, methods=["POST"])
    router.add_api_route("/illegal-business/raid/random", raid_random_illegal_business, methods=["POST"])
    router.add_api_route("/illegal-business/claim-kill-reward", claim_kill_reward, methods=["POST"])


from utils.ibm_missions_extended import EXTENDED_IBM_MISSIONS

ILLEGAL_BUSINESS_MISSIONS.clear()
ILLEGAL_BUSINESS_MISSIONS.extend(IBM_MISSIONS_CORE)
ILLEGAL_BUSINESS_MISSIONS.extend(EXTENDED_IBM_MISSIONS)


def _ibm_user_completed_ids(user: dict) -> set:
    return {c.get("mission_id") for c in (user.get("illegal_business_mission_completions") or []) if c.get("mission_id")}


def infer_next_ibm_mission_display_index(completed_ids: set) -> int:
    """1-based index of next incomplete IBM mission, or len+1 when all are done."""
    ordered = _ordered_ibm_missions()
    for i, m in enumerate(ordered, start=1):
        if m["id"] not in completed_ids:
            return i
    return len(ordered) + 1


def display_index_for_ibm_mission_id(mid: str) -> Optional[int]:
    for i, m in enumerate(_ordered_ibm_missions(), start=1):
        if m["id"] == mid:
            return i
    return None


async def admin_ibm_payload_for_user(user: dict) -> Dict[str, Any]:
    """Read-only IBM mission ladder summary for staff tools."""
    uid = user.get("id")
    if not uid:
        raise HTTPException(status_code=400, detail="User id required")
    ordered = _ordered_ibm_missions()
    max_display = len(ordered) + 1
    business = await db.illegal_businesses.find_one({"user_id": uid}, {"_id": 0})
    progress_user = await _ibm_load_user_with_mission_baselines(uid, user)
    completed_ids = _ibm_user_completed_ids(progress_user)
    next_idx = infer_next_ibm_mission_display_index(completed_ids)
    completions_out = []
    for row in progress_user.get("illegal_business_mission_completions") or []:
        mid = row.get("mission_id")
        if not mid:
            continue
        completions_out.append(
            {
                "mission_id": mid,
                "display_index": display_index_for_ibm_mission_id(mid),
                "title": next((m.get("title") for m in ordered if m["id"] == mid), mid),
                "completed_at": row.get("completed_at"),
            }
        )
    completions_out.sort(key=lambda x: (x["display_index"] is None, x["display_index"] or 0))
    active = None
    active_guards_count = 0
    if business and business.get("id"):
        active_guards_count = int(
            await db.illegal_business_guards.count_documents({"business_id": business["id"]})
        )
    if 1 <= next_idx <= len(ordered):
        m = ordered[next_idx - 1]
        req = m.get("requirements") or {}
        cur = {
            key: _ibm_requirement_current(
                progress_user,
                business,
                m,
                key,
                active_guards_count=active_guards_count,
            )
            for key in req
        }
        active = {
            "display_index": next_idx,
            "id": m["id"],
            "title": m.get("title"),
            "order": m.get("order"),
            "current": cur,
            "target": req,
        }
    business_summary = None
    distillery_summary = None
    now = datetime.now(timezone.utc)
    if business:
        pending_take, till_hours = await _illegal_business_pending_take_and_hours(business, user, now)
        business_summary = {
            "level": business.get("level"),
            "income_per_hour": int(business.get("income_per_hour") or 0),
            "income_cap_hours": int(business.get("income_cap_hours") or INCOME_CAP_HOURS_BASE),
            "pending_take": round(pending_take, 2),
            "till_hours_accrued": round(till_hours, 2),
            "vault": int(business.get("vault") or 0),
            "guard_slots": int(business.get("guard_slots") or 0),
            "security_level": len(business.get("security_upgrades") or []),
            "active_guards": active_guards_count,
        }
        if business.get("type_id") == "booze_making" and business.get("distillery"):
            distillery_summary = _distillery_progression_state(business["distillery"])
    distillery_detail = None
    if business and business.get("type_id") == "booze_making" and business.get("distillery"):
        distillery_detail = _admin_distillery_detail(business["distillery"])
    total_missions = len(ordered)
    completed_count = len(completed_ids)
    progress_percent = int(round(100 * completed_count / total_missions)) if total_missions else 0
    return {
        "user_id": uid,
        "username": user.get("username"),
        "has_business": bool(business),
        "business_id": (business or {}).get("id"),
        "business_name": (business or {}).get("name"),
        "business_type_id": (business or {}).get("type_id"),
        "business_summary": business_summary,
        "distillery": distillery_summary,
        "distillery_detail": distillery_detail,
        "progress_percent": progress_percent,
        "missions_completed_count": completed_count,
        "missions_total": total_missions,
        "next_mission_display": next_idx,
        "all_missions_complete": next_idx >= max_display,
        "active_mission": active,
        "completions": completions_out,
    }


async def admin_apply_ibm_mission_progress(
    user_id: str,
    next_mission_display: int,
) -> Dict[str, Any]:
    """
    Set IBM ladder so the next mission to complete is `next_mission_display` (1..N),
    or N+1 when all missions should be marked complete. Does not grant mission rewards
    (use in-game completion or manual business edits after restore).
    """
    ordered = _ordered_ibm_missions()
    max_display = len(ordered) + 1
    if next_mission_display < 1 or next_mission_display > max_display:
        raise HTTPException(
            status_code=400,
            detail=f"next_mission_display must be 1-{max_display} ({max_display} = all IBM missions complete)",
        )
    user_before = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user_before:
        raise HTTPException(status_code=404, detail="User not found")
    now_iso = datetime.now(timezone.utc).isoformat()
    if next_mission_display <= len(ordered):
        to_complete = ordered[: next_mission_display - 1]
    else:
        to_complete = ordered[:]
    new_completions = [{"mission_id": m["id"], "completed_at": now_iso} for m in to_complete]
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"illegal_business_mission_completions": new_completions}},
    )
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not fresh:
        raise HTTPException(status_code=404, detail="User not found")
    await _ibm_ensure_mission_baselines(user_id, fresh)
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not fresh:
        raise HTTPException(status_code=404, detail="User not found")
    return await admin_ibm_payload_for_user(fresh)


def _progress_percent_to_mission_indices(progress_percent: int) -> Tuple[int, int]:
    """Return (completed_count, next_mission_display) for 0–100% overall IBM progress."""
    ordered = _ordered_ibm_missions()
    n = len(ordered)
    pct = max(0, min(100, int(progress_percent)))
    if pct >= 100:
        return n, n + 1
    completed = int(n * pct / 100)
    return completed, completed + 1


def _simulate_business_and_user_from_completed_missions(
    completed_missions: List[Dict[str, Any]],
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Approximate business + user fields as if those missions were completed in order (rewards only)."""
    iph = int(INCOME_PER_HOUR_BASE)
    slots = int(GUARD_SLOTS_INITIAL)
    vault = 0
    income_cap = int(INCOME_CAP_HOURS_BASE)
    defender_bonus = 0
    raid_incoming = 1.0
    guard_weapon_unlock = 0
    guard_armour_unlock = 0
    raid_limit = int(RAID_DAILY_LIMIT_DEFAULT)
    max_security_req = 0

    for m in completed_missions:
        req = m.get("requirements") or {}
        if req.get("security_level"):
            max_security_req = max(max_security_req, int(req["security_level"]))
        rewards = m.get("rewards") or {}
        if rewards.get("income_mult"):
            iph = int(iph * float(rewards["income_mult"]))
        if rewards.get("income_per_hour_add"):
            iph += int(rewards["income_per_hour_add"])
        if rewards.get("guard_slots"):
            slots += int(rewards["guard_slots"])
        if rewards.get("vault_cash"):
            vault += int(rewards["vault_cash"])
        if rewards.get("income_cap_hours_add"):
            income_cap = min(INCOME_CAP_HOURS_MAX, income_cap + int(rewards["income_cap_hours_add"]))
        if rewards.get("defender_strength_bonus_add"):
            defender_bonus = min(
                DEFENDER_STRENGTH_BONUS_CAP,
                defender_bonus + int(rewards["defender_strength_bonus_add"]),
            )
        if rewards.get("raid_incoming_loot_mult_sub") is not None:
            raid_incoming = max(
                RAID_INCOMING_LOOT_MULT_MIN,
                round(raid_incoming - float(rewards["raid_incoming_loot_mult_sub"]), 4),
            )
        if rewards.get("guard_weapon_max"):
            guard_weapon_unlock += int(rewards["guard_weapon_max"])
        if rewards.get("guard_armour_max"):
            guard_armour_unlock += int(rewards["guard_armour_max"])
        if rewards.get("raid_daily_limit_add"):
            raid_limit = min(RAID_DAILY_LIMIT_MAX, raid_limit + int(rewards["raid_daily_limit_add"]))

    sec_count = max_security_req
    if completed_missions and sec_count == 0:
        sec_count = min(len(SECURITY_UPGRADES), max(1, len(completed_missions) // 2))
    sec_count = min(len(SECURITY_UPGRADES), max(0, sec_count))
    upgrades = SECURITY_UPGRADE_IDS[:sec_count] if sec_count else []

    slots = min(GUARD_SLOTS_MAX, max(GUARD_SLOTS_INITIAL, slots))
    guards_hired_target = min(slots, max(2, int(slots * 0.65)))

    business_set: Dict[str, Any] = {
        "income_per_hour": max(int(INCOME_PER_HOUR_BASE), iph),
        "guard_slots": slots,
        "security_upgrades": upgrades,
        "security_level": len(upgrades),
        "vault": max(vault, int(vault * 0.15) + 10_000),
        "income_cap_hours": income_cap,
        "defender_strength_bonus": defender_bonus,
        "raid_incoming_loot_mult": raid_incoming,
        "guard_weapon_max_unlock": guard_weapon_unlock,
        "guard_armour_max_unlock": guard_armour_unlock,
    }
    user_set: Dict[str, Any] = {
        "illegal_business_raid_daily_limit": raid_limit,
        "illegal_business_guard_slots_bought": max(0, slots - GUARD_SLOTS_INITIAL),
        "illegal_business_guards_hired": guards_hired_target,
        "illegal_business_collections": 50_000,
        "illegal_business_crimes_in_state": 50_000,
        "illegal_business_raids_won": 50_000,
        "illegal_business_raids_attempted": 50_000,
        "illegal_business_vault_withdrawals": 50_000,
    }
    return business_set, user_set


async def _admin_replace_guards_for_business(
    business: dict,
    user_id: str,
    guard_count: int,
) -> int:
    """Replace all guards with ``guard_count`` hires in slots 1..N. Returns guards created."""
    biz_id = business.get("id")
    if not biz_id:
        return 0
    slots = int(business.get("guard_slots") or GUARD_SLOTS_INITIAL)
    guard_count = max(0, min(guard_count, slots))
    await db.illegal_business_guards.delete_many({"business_id": biz_id})
    if guard_count <= 0:
        return 0
    armour_max, weapon_max = _guard_level_caps(business)
    mid_a = max(0, armour_max // 2)
    mid_w = max(0, weapon_max // 2)
    now = datetime.now(timezone.utc).isoformat()
    for slot in range(1, guard_count + 1):
        await db.illegal_business_guards.insert_one(
            {
                "id": str(uuid.uuid4()),
                "business_id": biz_id,
                "user_id": user_id,
                "slot_number": slot,
                "armour_level": mid_a,
                "weapon_level": mid_w,
                "hired_at": now,
                "hire_cost": 0,
            }
        )
    return guard_count


def _distillery_preset_for_percent(distillery: Optional[dict], progress_percent: int) -> Optional[dict]:
    if not distillery or not isinstance(distillery, dict):
        return distillery
    pct = max(0, min(100, int(progress_percent)))
    if pct <= 0:
        return distillery
    d = dict(distillery)
    equipment = dict(d.get("equipment") or {})
    target_lvl = max(1, int(DISTILLERY_EQUIPMENT_MAX_LEVEL * pct / 100))
    for eq in DISTILLERY_EQUIPMENT_ORDER:
        equipment[eq] = max(int(equipment.get(eq) or 0), target_lvl)
    d["equipment"] = equipment
    d["worker_cap"] = min(
        DISTILLERY_MAX_WORKER_CAP,
        DISTILLERY_BASE_WORKER_CAP + int((DISTILLERY_MAX_WORKER_CAP - DISTILLERY_BASE_WORKER_CAP) * pct / 100),
    )
    workers = dict(d.get("workers") or {})
    per_role = max(1, int(d["worker_cap"] * pct / 100) // len(DISTILLERY_WORKER_ROLES))
    for role in DISTILLERY_WORKER_ROLES:
        workers[role] = max(int(workers.get(role) or 0), per_role)
    d["workers"] = workers
    d["maintenance"] = max(float(d.get("maintenance") or 0), 70.0)
    d["heat"] = min(float(d.get("heat") or 0), 20.0)
    return d


def _admin_racket_snapshot(business: Optional[dict]) -> Optional[Dict[str, Any]]:
    if not business:
        return None
    upgrades = business.get("security_upgrades") or []
    is_booze = business.get("type_id") == "booze_making"
    return {
        "name": business.get("name"),
        "type_id": business.get("type_id"),
        "state": business.get("state"),
        "level": int(business.get("level") or 1),
        "income_per_hour": int(business.get("income_per_hour") or 0),
        "income_cap_hours": int(business.get("income_cap_hours") or INCOME_CAP_HOURS_BASE),
        "booze_per_hour": int(business.get("booze_per_hour") or BOOZE_PER_HOUR_BASE) if is_booze else None,
        "booze_cap_hours": int(business.get("booze_cap_hours") or BOOZE_CAP_HOURS_BASE) if is_booze else None,
        "guard_slots": int(business.get("guard_slots") or GUARD_SLOTS_INITIAL),
        "vault": int(business.get("vault") or 0),
        "security_level": len(upgrades) if upgrades else int(business.get("security_level") or 0),
        "has_distillery": bool(business.get("distillery")) if is_booze else False,
    }


def _admin_distillery_detail(distillery: Optional[dict]) -> Optional[Dict[str, Any]]:
    if not distillery or not isinstance(distillery, dict):
        return None
    equipment = distillery.get("equipment") or {}
    workers = distillery.get("workers") or {}
    prog = _distillery_progression_state(distillery)
    special = distillery.get("special_upgrades") or {}
    special_count = sum(1 for uid, enabled in special.items() if enabled and uid in DISTILLERY_SPECIAL_MAP)
    equipment_levels = {lane: int(equipment.get(lane) or 0) for lane in DISTILLERY_EQUIPMENT_ORDER}
    worker_levels = {role: int(workers.get(role) or 0) for role in DISTILLERY_WORKER_ROLES}
    auto_sell = distillery.get("auto_sell") or {}
    auto_aging = distillery.get("auto_aging") or {}
    return {
        **prog,
        "equipment": equipment_levels,
        "equipment_avg_level": round(
            sum(equipment_levels.values()) / max(1, len(DISTILLERY_EQUIPMENT_ORDER)),
            2,
        ),
        "workers": worker_levels,
        "workers_total": sum(worker_levels.values()),
        "worker_cap": int(distillery.get("worker_cap") or DISTILLERY_BASE_WORKER_CAP),
        "maintenance": round(float(distillery.get("maintenance") or 0), 1),
        "heat": round(float(distillery.get("heat") or 0), 1),
        "auto_sell_enabled": bool(auto_sell.get("enabled")),
        "auto_sell_mode": str(auto_sell.get("mode") or ""),
        "auto_aging_enabled": bool(auto_aging.get("enabled")),
        "special_upgrades_unlocked": special_count,
    }


def _admin_distillery_equipment_diff(before: Optional[dict], after: Optional[dict]) -> List[Dict[str, Any]]:
    b_eq = (before or {}).get("equipment") or {}
    a_eq = (after or {}).get("equipment") or {}
    rows = []
    for lane in DISTILLERY_EQUIPMENT_ORDER:
        b_lvl = int(b_eq.get(lane) or 0)
        a_lvl = int(a_eq.get(lane) or 0)
        if b_lvl != a_lvl:
            rows.append({"lane": lane, "before": b_lvl, "after": a_lvl})
    return rows


def _business_summary_snapshot(
    business: Optional[dict], *, active_guards: int = 0, user: Optional[dict] = None, now: Optional[datetime] = None
) -> Optional[Dict[str, Any]]:
    if not business:
        return None
    upgrades = business.get("security_upgrades") or []
    out: Dict[str, Any] = {
        "type_id": business.get("type_id"),
        "name": business.get("name"),
        "income_per_hour": int(business.get("income_per_hour") or 0),
        "vault": int(business.get("vault") or 0),
        "guard_slots": int(business.get("guard_slots") or GUARD_SLOTS_INITIAL),
        "security_level": len(upgrades) if upgrades else int(business.get("security_level") or 0),
        "active_guards": int(active_guards),
        "income_cap_hours": int(business.get("income_cap_hours") or INCOME_CAP_HOURS_BASE),
        "defender_strength_bonus": int(business.get("defender_strength_bonus") or 0),
        "raid_daily_limit": int((user or {}).get("illegal_business_raid_daily_limit") or RAID_DAILY_LIMIT_DEFAULT),
    }
    if user:
        now_dt = now or datetime.now(timezone.utc)
        pending_take, till_hours = _illegal_business_pending_take_and_hours_sync(business, user, now_dt)
        out["pending_take"] = round(pending_take, 2)
        out["till_hours_accrued"] = round(till_hours, 2)
    return out


def _after_preset_summary(
    business_set: Dict[str, Any],
    *,
    guards_to_place: int,
    user_set: Dict[str, Any],
    type_id: Optional[str],
    distillery_after: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    upgrades = business_set.get("security_upgrades") or []
    upgrade_names = [
        next((u["name"] for u in SECURITY_UPGRADES if u["id"] == uid), uid)
        for uid in upgrades[:5]
    ]
    if len(upgrades) > 5:
        upgrade_names.append(f"… +{len(upgrades) - 5} more")
    out: Dict[str, Any] = {
        "type_id": type_id,
        "income_per_hour": int(business_set.get("income_per_hour") or 0),
        "vault": int(business_set.get("vault") or 0),
        "guard_slots": int(business_set.get("guard_slots") or GUARD_SLOTS_INITIAL),
        "guards_placed": int(guards_to_place),
        "security_level": int(business_set.get("security_level") or 0),
        "security_upgrade_names": upgrade_names,
        "income_cap_hours": int(business_set.get("income_cap_hours") or INCOME_CAP_HOURS_BASE),
        "defender_strength_bonus": int(business_set.get("defender_strength_bonus") or 0),
        "guard_weapon_max_unlock": int(business_set.get("guard_weapon_max_unlock") or 0),
        "guard_armour_max_unlock": int(business_set.get("guard_armour_max_unlock") or 0),
        "raid_incoming_loot_mult": float(business_set.get("raid_incoming_loot_mult") or 1.0),
        "raid_daily_limit": int(user_set.get("illegal_business_raid_daily_limit") or RAID_DAILY_LIMIT_DEFAULT),
        "ibm_counters_boosted": True,
    }
    if distillery_after:
        equipment = distillery_after.get("equipment") or {}
        out["distillery"] = {
            "equipment_avg_level": int(
                sum(int(equipment.get(k) or 0) for k in DISTILLERY_EQUIPMENT_ORDER)
                / max(1, len(DISTILLERY_EQUIPMENT_ORDER))
            ),
            "worker_cap": int(distillery_after.get("worker_cap") or 0),
            "maintenance": float(distillery_after.get("maintenance") or 0),
            "progress_pct": _distillery_progression_state(distillery_after).get("progress_pct"),
        }
    return out


def build_illegal_business_progress_preset_preview(
    *,
    user: dict,
    business: dict,
    progress_percent: int,
    completed_missions: List[Dict[str, Any]],
    completed_count: int,
    next_display: int,
    business_set: Dict[str, Any],
    user_set: Dict[str, Any],
    guards_target: int,
    active_guards: int,
    distillery_progress_percent: Optional[int] = None,
) -> Dict[str, Any]:
    ordered = _ordered_ibm_missions()
    pct = max(0, min(100, int(progress_percent)))
    distillery_pct = max(0, min(100, int(distillery_progress_percent if distillery_progress_percent is not None else pct)))
    last_completed = completed_missions[-1] if completed_missions else None
    next_m = ordered[next_display - 1] if 1 <= next_display <= len(ordered) else None
    distillery_after = None
    if business.get("type_id") == "booze_making" and business.get("distillery"):
        distillery_after = _distillery_preset_for_percent(business.get("distillery"), distillery_pct)
    user_set_copy = dict(user_set)
    user_set_copy["illegal_business_guards_hired"] = guards_target
    current_snap = _business_summary_snapshot(business, active_guards=active_guards, user=user)
    if business.get("type_id") == "booze_making" and business.get("distillery"):
        current_snap = dict(current_snap or {})
        current_snap["distillery"] = _distillery_progression_state(business["distillery"])
    return {
        "progress_percent": pct,
        "distillery_progress_percent": distillery_pct if business.get("type_id") == "booze_making" else None,
        "missions_completed_count": completed_count,
        "missions_total": len(ordered),
        "next_mission_display": next_display,
        "last_completed_mission": (
            {
                "display_index": display_index_for_ibm_mission_id(last_completed["id"]),
                "id": last_completed.get("id"),
                "title": last_completed.get("title"),
            }
            if last_completed
            else None
        ),
        "next_mission": (
            {
                "display_index": next_display,
                "id": next_m.get("id"),
                "title": next_m.get("title"),
            }
            if next_m
            else None
        ),
        "all_missions_complete": next_display > len(ordered),
        "current": current_snap,
        "after": _after_preset_summary(
            business_set,
            guards_to_place=guards_target,
            user_set=user_set_copy,
            type_id=business.get("type_id"),
            distillery_after=distillery_after,
        ),
        "business_upgrades_raw": {**business_set, "guards_to_place": guards_target},
        "user_counters_set": user_set_copy,
    }


async def admin_apply_illegal_business_progress_preset(
    user_id: str,
    progress_percent: int,
    *,
    dry_run: bool = False,
    distillery_progress_percent: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Set IBM ladder + business upgrades to roughly ``progress_percent`` complete (0–100).
    Requires an existing illegal business document (use Crew recovery restore first).
    """
    pct = max(0, min(100, int(progress_percent)))
    distillery_pct = (
        max(0, min(100, int(distillery_progress_percent)))
        if distillery_progress_percent is not None
        else pct
    )
    ordered = _ordered_ibm_missions()
    completed_count, next_display = _progress_percent_to_mission_indices(pct)
    completed_missions = ordered[:completed_count]
    business_set, user_set = _simulate_business_and_user_from_completed_missions(completed_missions)
    guards_target = int(user_set.pop("illegal_business_guards_hired", 0))

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    business = await db.illegal_businesses.find_one({"user_id": user_id}, {"_id": 0})
    if not business:
        raise HTTPException(
            status_code=400,
            detail="No illegal business on this account. Restore from snapshot in Crew recovery first.",
        )

    active_guards = 0
    if business.get("id"):
        active_guards = int(
            await db.illegal_business_guards.count_documents({"business_id": business["id"]})
        )
    now = datetime.now(timezone.utc)
    pending_take, till_hours = await _illegal_business_pending_take_and_hours(business, user, now)
    preview_body = build_illegal_business_progress_preset_preview(
        user=user,
        business=business,
        progress_percent=pct,
        completed_missions=completed_missions,
        completed_count=completed_count,
        next_display=next_display,
        business_set=business_set,
        user_set={**user_set, "illegal_business_guards_hired": guards_target},
        guards_target=guards_target,
        active_guards=active_guards,
        distillery_progress_percent=distillery_pct,
    )
    preview_body["till"] = {
        "pending_take": round(pending_take, 2),
        "hours_accrued": round(till_hours, 2),
        "preserved_on_apply": _business_till_fields_changed(business, business_set),
    }
    if dry_run:
        return {
            "message": f"Preview ~{pct}% IBM progress for {user.get('username') or user_id}",
            "username": user.get("username"),
            "user_id": user_id,
            "dry_run": True,
            "preview": preview_body,
        }

    await admin_apply_ibm_mission_progress(user_id, next_display)
    biz_update = dict(business_set)
    if business.get("type_id") == "booze_making" and business.get("distillery"):
        biz_update["distillery"] = _distillery_preset_for_percent(business.get("distillery"), distillery_pct)
    reconciled_last = _reconcile_till_last_collected_after_stat_change(business, biz_update, user, now)
    if reconciled_last is not None:
        biz_update["last_collected_at"] = reconciled_last
    await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": biz_update})
    await db.users.update_one({"id": user_id}, {"$set": user_set})
    business_after = await db.illegal_businesses.find_one({"user_id": user_id}, {"_id": 0})
    if business_after:
        await _admin_replace_guards_for_business(business_after, user_id, guards_target)

    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not fresh:
        raise HTTPException(status_code=404, detail="User not found")
    out = await admin_ibm_payload_for_user(fresh)
    out["progress_preset_applied"] = preview_body
    out["message"] = f"Set ~{pct}% illegal business progress for {user.get('username') or user_id}"
    return out


async def admin_ensure_booze_illegal_business(
    user_id: str,
    *,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Staff: create booze-making racket + default distillery if missing (no cost to player)."""
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "id": 1, "username": 1, "current_state": 1, "is_dead": 1},
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("is_dead"):
        raise HTTPException(status_code=400, detail="Player is dead — revive first")

    business = await db.illegal_businesses.find_one({"user_id": user_id}, {"_id": 0})
    now = datetime.now(timezone.utc)
    base = {
        "username": user.get("username"),
        "user_id": user_id,
        "created_business": False,
        "added_distillery": False,
        "dry_run": dry_run,
    }

    if business and business.get("type_id") != "booze_making":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Player has a {business.get('type_id') or 'non-booze'} racket — "
                "distillery only applies to booze_making"
            ),
        )

    if business and business.get("distillery"):
        return {**base, "message": "Booze racket and distillery already exist"}

    if not business:
        state = (user.get("current_state") or STATES[0]).strip()
        if state not in STATES:
            state = STATES[0]
        business_id = str(uuid.uuid4())
        doc = {
            "id": business_id,
            "user_id": user_id,
            "name": "Booze making",
            "type_id": "booze_making",
            "state": state,
            "level": 1,
            "income_per_hour": INCOME_PER_HOUR_BASE,
            "income_cap_hours": INCOME_CAP_HOURS_BASE,
            "last_collected_at": now.isoformat(),
            "guard_slots": GUARD_SLOTS_INITIAL,
            "security_level": 0,
            "security_upgrades": [],
            "total_spent": 0,
            "vault": 0,
            "vault_lifetime_earned": 0,
            "created_at": now.isoformat(),
            "customizations": {},
            "booze_per_hour": BOOZE_PER_HOUR_BASE,
            "booze_cap_hours": BOOZE_CAP_HOURS_BASE,
            "last_collected_booze_at": now.isoformat(),
            "distillery": _distillery_default(now),
        }
        if dry_run:
            return {
                **base,
                "would_create_business": True,
                "business_preview": doc,
                "message": f"Would create booze racket + distillery for {user.get('username') or user_id}",
            }
        await db.illegal_businesses.insert_one(doc)
        return {
            **base,
            "created_business": True,
            "business_id": business_id,
            "message": f"Created booze racket + distillery for {user.get('username') or user_id}",
        }

    # booze racket exists but distillery missing
    distillery = _distillery_default(now)
    if dry_run:
        preview = dict(business)
        preview["distillery"] = distillery
        return {
            **base,
            "would_add_distillery": True,
            "business_preview": preview,
            "message": f"Would add distillery to {user.get('username') or user_id}'s booze racket",
        }
    await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": {"distillery": distillery}})
    return {
        **base,
        "added_distillery": True,
        "business_id": business.get("id"),
        "message": f"Added distillery to {user.get('username') or user_id}'s booze racket",
    }


async def admin_apply_distillery_progress(
    user_id: str,
    progress_percent: int,
    *,
    dry_run: bool = False,
    ensure_booze_racket: bool = False,
) -> Dict[str, Any]:
    """Set distillery equipment/workers to roughly ``progress_percent`` complete (0–100). Racket ladder unchanged."""
    pct = max(0, min(100, int(progress_percent)))
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    provision = None
    business_preview = None
    business_before_doc = await db.illegal_businesses.find_one({"user_id": user_id}, {"_id": 0})
    if ensure_booze_racket:
        provision = await admin_ensure_booze_illegal_business(user_id, dry_run=dry_run)
        business_preview = provision.get("business_preview")
        if not dry_run:
            business_before_doc = await db.illegal_businesses.find_one({"user_id": user_id}, {"_id": 0})

    business = business_before_doc
    if not business:
        if ensure_booze_racket and dry_run and business_preview:
            business = business_preview
        else:
            raise HTTPException(status_code=400, detail="No illegal business on this account")
    if business.get("type_id") != "booze_making":
        raise HTTPException(status_code=400, detail="Distillery progress only applies to booze-making rackets")
    distillery = business.get("distillery")
    if not distillery:
        if ensure_booze_racket and dry_run and business_preview:
            distillery = business_preview.get("distillery")
        if not distillery:
            raise HTTPException(status_code=400, detail="No distillery on this business")
    distillery_before_doc = copy.deepcopy(distillery)
    before_prog = _distillery_progression_state(distillery_before_doc)
    before_detail = _admin_distillery_detail(distillery_before_doc)
    updated = _distillery_preset_for_percent(copy.deepcopy(distillery), pct)
    after_prog = _distillery_progression_state(updated or distillery)
    after_detail = _admin_distillery_detail(updated)
    business_after_doc = copy.deepcopy(business)
    business_after_doc["distillery"] = updated
    preview = {
        "progress_percent": pct,
        "before": before_prog,
        "after": after_prog,
        "racket": {
            "before": _admin_racket_snapshot(business_before_doc),
            "after": _admin_racket_snapshot(business_after_doc),
        },
        "distillery_detail": {
            "before": before_detail,
            "after": after_detail,
        },
        "equipment_changes": _admin_distillery_equipment_diff(before_detail, after_detail),
        "provision": (
            {
                "message": provision.get("message"),
                "would_create_business": provision.get("would_create_business"),
                "would_add_distillery": provision.get("would_add_distillery"),
                "created_business": provision.get("created_business"),
                "added_distillery": provision.get("added_distillery"),
            }
            if provision
            else None
        ),
    }
    if dry_run:
        return {
            "dry_run": True,
            "username": user.get("username"),
            "user_id": user_id,
            "preview": preview,
            "message": f"Preview distillery ~{pct}% for {user.get('username') or user_id}",
        }
    await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": {"distillery": updated}})
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not fresh:
        raise HTTPException(status_code=404, detail="User not found")
    out = await admin_ibm_payload_for_user(fresh)
    out["distillery_preset_applied"] = preview
    out["message"] = f"Set distillery progress to ~{pct}% for {user.get('username') or user_id}"
    return out


def _admin_finalize_distillery_after_edit(distillery: dict) -> dict:
    equipment = distillery.get("equipment") or {}
    distillery["worker_capacity"] = _distillery_worker_capacity(equipment)
    progression = _distillery_progression_state(distillery)
    distillery["mastery_tier"] = int(progression["total_steps"] // 30)
    return distillery


def _admin_apply_distillery_upgrades_to_doc(
    distillery: dict,
    *,
    equipment_add: Optional[Dict[str, int]] = None,
    equipment_levels: Optional[Dict[str, int]] = None,
    add_all_equipment: Optional[int] = None,
    unlock_special_ids: Optional[List[str]] = None,
    unlock_special_tracks: Optional[Dict[str, int]] = None,
    unlock_all_special_tier: Optional[int] = None,
    workers: Optional[Dict[str, int]] = None,
    maintenance: Optional[float] = None,
    heat: Optional[float] = None,
) -> tuple:
    """Apply admin upgrade edits. Returns (updated_distillery, change_lines)."""
    changes: List[str] = []
    d = copy.deepcopy(distillery)
    equipment = dict(d.get("equipment") or {lane: 0 for lane in DISTILLERY_EQUIPMENT_ORDER})

    if add_all_equipment is not None:
        n = max(0, int(add_all_equipment))
        if n > 0:
            for lane in DISTILLERY_EQUIPMENT_ORDER:
                old = int(equipment.get(lane) or 0)
                new = int(_clamp(old + n, 0, DISTILLERY_EQUIPMENT_MAX_LEVEL))
                if new != old:
                    equipment[lane] = new
                    changes.append(f"{lane}: {old} → {new}")

    if equipment_add:
        for lane, delta in equipment_add.items():
            lane_key = (lane or "").strip().lower()
            if lane_key not in DISTILLERY_EQUIPMENT_ORDER:
                continue
            old = int(equipment.get(lane_key) or 0)
            new = int(_clamp(old + int(delta), 0, DISTILLERY_EQUIPMENT_MAX_LEVEL))
            if new != old:
                equipment[lane_key] = new
                changes.append(f"{lane_key}: {old} → {new}")

    if equipment_levels:
        for lane, lvl in equipment_levels.items():
            lane_key = (lane or "").strip().lower()
            if lane_key not in DISTILLERY_EQUIPMENT_ORDER:
                continue
            old = int(equipment.get(lane_key) or 0)
            new = int(_clamp(int(lvl), 0, DISTILLERY_EQUIPMENT_MAX_LEVEL))
            if new != old:
                equipment[lane_key] = new
                changes.append(f"{lane_key}: {old} → {new}")

    d["equipment"] = equipment

    unlocked = dict(d.get("special_upgrades") or {})

    def _unlock_special_uid(uid: str) -> None:
        row = DISTILLERY_SPECIAL_MAP.get(uid)
        if not row:
            return
        track = row["track"]
        tier = int(row.get("tier") or 0)
        for t in range(1, tier + 1):
            pre = f"{track}_{t:02d}"
            if not unlocked.get(pre):
                unlocked[pre] = True
                changes.append(f"special {pre}")

    if unlock_special_ids:
        for uid in unlock_special_ids:
            _unlock_special_uid((uid or "").strip())

    if unlock_special_tracks:
        for track, max_tier in unlock_special_tracks.items():
            track_key = (track or "").strip().lower()
            if track_key not in DISTILLERY_SPECIAL_TRACKS:
                continue
            max_t = int(_clamp(int(max_tier), 0, DISTILLERY_SPECIAL_PER_TRACK))
            for t in range(1, max_t + 1):
                _unlock_special_uid(f"{track_key}_{t:02d}")

    if unlock_all_special_tier is not None:
        max_t = int(_clamp(int(unlock_all_special_tier), 0, DISTILLERY_SPECIAL_PER_TRACK))
        for track in DISTILLERY_SPECIAL_TRACKS:
            for t in range(1, max_t + 1):
                _unlock_special_uid(f"{track}_{t:02d}")

    d["special_upgrades"] = unlocked

    if workers:
        w = dict(d.get("workers") or {})
        for role in DISTILLERY_WORKER_ROLES:
            if role in workers:
                w[role] = max(0, int(workers[role]))
        d["workers"] = w
        changes.append("workers updated")

    if maintenance is not None:
        d["maintenance"] = float(_clamp(float(maintenance), 0.0, 100.0))
        changes.append(f"maintenance → {d['maintenance']:.1f}")

    if heat is not None:
        d["heat"] = float(_clamp(float(heat), 0.0, 100.0))
        changes.append(f"heat → {d['heat']:.1f}")

    if changes:
        d = _admin_finalize_distillery_after_edit(d)
    return d, changes


async def admin_apply_distillery_upgrades(
    user_id: str,
    *,
    dry_run: bool = False,
    ensure_booze_racket: bool = False,
    equipment_add: Optional[Dict[str, int]] = None,
    equipment_levels: Optional[Dict[str, int]] = None,
    add_all_equipment: Optional[int] = None,
    unlock_special_ids: Optional[List[str]] = None,
    unlock_special_tracks: Optional[Dict[str, int]] = None,
    unlock_all_special_tier: Optional[int] = None,
    workers: Optional[Dict[str, int]] = None,
    maintenance: Optional[float] = None,
    heat: Optional[float] = None,
) -> Dict[str, Any]:
    """Grant distillery equipment levels and/or special track unlocks (free — no vault cost)."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    provision = None
    business_before_doc = await db.illegal_businesses.find_one({"user_id": user_id}, {"_id": 0})
    if ensure_booze_racket:
        provision = await admin_ensure_booze_illegal_business(user_id, dry_run=dry_run)
        if not dry_run:
            business_before_doc = await db.illegal_businesses.find_one({"user_id": user_id}, {"_id": 0})

    business = business_before_doc
    if not business:
        if ensure_booze_racket and dry_run and provision and provision.get("business_preview"):
            business = provision["business_preview"]
        else:
            raise HTTPException(status_code=400, detail="No illegal business on this account")
    if business.get("type_id") != "booze_making":
        raise HTTPException(status_code=400, detail="Distillery upgrades only apply to booze-making rackets")
    distillery = business.get("distillery")
    if not distillery:
        if ensure_booze_racket and dry_run and provision and provision.get("business_preview"):
            distillery = provision["business_preview"].get("distillery")
        if not distillery:
            raise HTTPException(status_code=400, detail="No distillery on this business")

    before_detail = _admin_distillery_detail(copy.deepcopy(distillery))
    updated, change_lines = _admin_apply_distillery_upgrades_to_doc(
        distillery,
        equipment_add=equipment_add,
        equipment_levels=equipment_levels,
        add_all_equipment=add_all_equipment,
        unlock_special_ids=unlock_special_ids,
        unlock_special_tracks=unlock_special_tracks,
        unlock_all_special_tier=unlock_all_special_tier,
        workers=workers,
        maintenance=maintenance,
        heat=heat,
    )
    after_detail = _admin_distillery_detail(updated)
    after_prog = _distillery_progression_state(updated)
    preview = {
        "before": before_detail,
        "after": after_detail,
        "after_progress": after_prog,
        "equipment_changes": _admin_distillery_equipment_diff(before_detail, after_detail),
        "changes": change_lines,
        "provision": (
            {
                "message": provision.get("message"),
                "would_create_business": provision.get("would_create_business"),
                "would_add_distillery": provision.get("would_add_distillery"),
            }
            if provision
            else None
        ),
    }
    if not change_lines:
        return {
            "dry_run": dry_run,
            "username": user.get("username"),
            "user_id": user_id,
            "preview": preview,
            "message": "No distillery changes requested",
        }
    if dry_run:
        return {
            "dry_run": True,
            "username": user.get("username"),
            "user_id": user_id,
            "preview": preview,
            "message": f"Preview {len(change_lines)} distillery upgrade change(s) for {user.get('username') or user_id}",
        }
    await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": {"distillery": updated}})
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not fresh:
        raise HTTPException(status_code=404, detail="User not found")
    out = await admin_ibm_payload_for_user(fresh)
    out["distillery_upgrades_applied"] = preview
    out["message"] = f"Applied {len(change_lines)} distillery upgrade change(s) for {user.get('username') or user_id}"
    return out
