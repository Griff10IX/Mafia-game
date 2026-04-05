# Illegal business (1920s–30s mafia): one per player, Capo+, raid formula, guards/security, missions, killer choice on death
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
import re
import uuid
import secrets
_rng = secrets.SystemRandom()
import logging
from pydantic import BaseModel

from fastapi import Depends, HTTPException

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
from routers.kill.armoury import TOKEN_CONFIG, TOKEN_TYPES
from utils.point_provenance import log_points_event

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

# Distillery (booze_making only) progression and economy tuning.
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
DISTILLERY_EQUIPMENT_MAX_LEVEL = 10
DISTILLERY_BASE_WORKER_CAP = 5
DISTILLERY_MAX_WORKER_CAP = 25
DISTILLERY_EARLY_COST_MULT = 1.45
DISTILLERY_MID_COST_MULT = 1.70
DISTILLERY_LATE_COST_MULT = 1.95
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
DISTILLERY_HEAT_DECAY_PER_HOUR = 1.35
DISTILLERY_HEAT_THRESHOLDS = {"warm": 25, "hot": 50, "critical": 75}
DISTILLERY_HEAT_GAIN_PER_BOOZE = 0.06
DISTILLERY_HEAT_GAIN_PER_AUTO_SELL = 0.12
DISTILLERY_ENFORCEMENT_MAX_CHANCE = 0.30
DISTILLERY_ENFORCEMENT_SHUTDOWN_HOURS = (2, 8)
DISTILLERY_ENFORCEMENT_VAULT_LOSS_MIN = 0.05
DISTILLERY_ENFORCEMENT_VAULT_LOSS_MAX = 0.22
DISTILLERY_AUTO_SELL_MARGIN_BASE = 0.85
DISTILLERY_AUTO_SELL_MARGIN_CAP = 0.92
DISTILLERY_BASE_BOOZE_UNIT_VALUE = 250
DISTILLERY_COLLECT_ROI_SAFETY_FLOOR = 1.0
DISTILLERY_MAX_ACTIVE_BATCHES = 8
DISTILLERY_AGING_TIERS = {
    "quick": {"hours_min": 0.25, "hours_max": 0.75, "quality_mult": 1.02, "cash_mult": 1.02},
    "standard": {"hours_min": 2.0, "hours_max": 6.0, "quality_mult": 1.05, "cash_mult": 1.08},
    "reserve": {"hours_min": 18.0, "hours_max": 36.0, "quality_mult": 1.12, "cash_mult": 1.22},
    "premium": {"hours_min": 48.0, "hours_max": 96.0, "quality_mult": 1.20, "cash_mult": 1.42},
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
]
# Cost for security upgrade at index i: base + step * i (gradually higher).
# 75% reduction for beta
SECURITY_UPGRADE_BASE_CASH = 6_250
SECURITY_UPGRADE_STEP_CASH = 5_000
SECURITY_UPGRADE_BASE_POINTS = 0
SECURITY_UPGRADE_STEP_POINTS = 0
SECURITY_UPGRADE_IDS = [u["id"] for u in SECURITY_UPGRADES]

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

# Raid
RAID_COOLDOWN_HOURS = 12
RAID_DAILY_LIMIT = 5
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

ILLEGAL_BUSINESS_MISSIONS = [
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
     "how_to_complete": "Security level 42, 50 raid attempts, claim 3 kill rewards from fallen owners.",
     "requirements": {"security_level": 42, "raids_attempted": 50, "kill_rewards_claimed": 3},
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
     "how_to_complete": "90 raid attempts, buy 10 guard slots total (this tier), 6 kill rewards claimed.",
     "requirements": {"raids_attempted": 90, "guard_slots_bought": 10, "kill_rewards_claimed": 6},
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
     "story": "Thirty-five thousand crimes. Eight inheritance claims. A dozen new slots.",
     "how_to_complete": "35,000 total crimes, 8 kill rewards, buy 14 guard slots this tier.",
     "requirements": {"crimes": 35000, "kill_rewards_claimed": 8, "guard_slots_bought": 14},
     "rewards": {"vault_cash": 500_000, "income_per_hour_add": 3_000, "xp_crimes_tokens": 2, "racket_tokens": 1, "xp_gta_tokens": 1}},
    {"id": "ibm_29", "order": 29, "title": "Capo di tutti capi",
     "story": "Almost nobody gets here. Prove you earned the chair.",
     "how_to_complete": "Reach Capo di tutti capi rank, 110 collections, win 90 raids.",
     "requirements": {"rank_id": 11, "collections": 110, "raids_won": 90},
     "rewards": {"vault_cash": 600_000, "guard_slots": 2, "jailbust_tokens": 1, "income_per_hour_add": 5_000, "travel_tokens": 1, "oc_reduced_tokens": 1}},
    {"id": "ibm_30", "order": 30, "title": "Godfather's racket",
     "story": "The final grind — every lever of the business, pulled until they break or bend.",
     "how_to_complete": "Godfather rank; 55k crimes; 6k in-state; 140 collections; 160 raid attempts; 110 raid wins; 70 hires; 10 kill claims.",
     "requirements": {
         "rank_id": 13,
         "crimes": 55000,
         "crimes_in_state": 6000,
         "collections": 140,
         "raids_attempted": 160,
         "raids_won": 110,
         "guards_hired": 70,
         "kill_rewards_claimed": 10,
     },
     "rewards": {"vault_cash": 1_000_000, "racket_tokens": 5, "xp_crimes_tokens": 2, "jailbust_tokens": 2, "income_per_hour_add": 6_200,
                 "melt_tokens": 1, "booze_tokens": 1, "properties_tokens": 1, "auto_rank_2h_tokens": 1}},
]

# Mission requirements that count only since baselines were set for this mission id (user.illegal_business_mission_baselines).
IBM_REQUIREMENT_USER_FIELDS = {
    "crimes_in_state": "illegal_business_crimes_in_state",
    "collections": "illegal_business_collections",
    "raids_won": "illegal_business_raids_won",
    "raids_attempted": "illegal_business_raids_attempted",
    "guards_hired": "illegal_business_guards_hired",
    "guard_slots_bought": "illegal_business_guard_slots_bought",
    "vault_withdrawals": "illegal_business_vault_withdrawals",
    "kill_rewards_claimed": "illegal_business_kill_rewards_claimed",
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
            "enabled": False,
            "booze_id": _default_booze_type_id(),
            "min_inventory": 50,
            "batch_size": 30,
        },
        "aging_queue": [],
        "stats": {
            "total_batches_started": 0,
            "total_batches_claimed": 0,
            "total_booze_auto_sold": 0,
            "total_auto_sell_cash": 0,
            "heat_events_survived": 0,
            "premium_sells": 0,
        },
        "last_tick_at": now.isoformat(),
    }


def _distillery_upgrade_cost(lane: str, next_level: int) -> int:
    base = int(DISTILLERY_LANE_BASE_COST.get(lane, 15_000))
    growth = DISTILLERY_EARLY_COST_MULT
    if next_level >= 5:
        growth = DISTILLERY_MID_COST_MULT
    if next_level >= 8:
        growth = DISTILLERY_LATE_COST_MULT
    return int(base * (growth ** max(0, next_level - 1)))


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
        auto_sell["enabled"] = False
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
        "heat_events_survived",
        "premium_sells",
    ):
        if key not in stats:
            stats[key] = 0
            changed = True
    if "last_tick_at" not in dist:
        dist["last_tick_at"] = ts.isoformat()
        changed = True
    return dist, changed


def _distillery_decay_and_status(distillery: dict, now: datetime) -> dict:
    last_tick = _parse_iso_utc(distillery.get("last_tick_at"), now)
    elapsed_hours = max(0.0, (now - last_tick).total_seconds() / 3600.0)
    maintenance = float(distillery.get("maintenance") or 0.0)
    maintenance = _clamp(maintenance - (elapsed_hours * DISTILLERY_MAINTENANCE_DECAY_PER_HOUR), 0.0, 100.0)
    heat = float(distillery.get("heat") or 0.0)
    workers = distillery.get("workers") or {}
    security_workers = int(workers.get("security") or 0)
    heat_decay = DISTILLERY_HEAT_DECAY_PER_HOUR + security_workers * 0.18
    heat = _clamp(heat - (elapsed_hours * heat_decay), 0.0, 100.0)
    distillery["maintenance"] = maintenance
    distillery["heat"] = heat
    distillery["last_tick_at"] = now.isoformat()
    distillery["last_heat_at"] = now.isoformat()
    shutdown_until = _parse_iso_utc(distillery.get("shutdown_until"), now)
    is_shutdown = bool(distillery.get("shutdown_until")) and now < shutdown_until
    if distillery.get("shutdown_until") and now >= shutdown_until:
        distillery["shutdown_until"] = None
        is_shutdown = False
    return {
        "elapsed_hours": elapsed_hours,
        "maintenance": maintenance,
        "heat": heat,
        "is_shutdown": is_shutdown,
        "shutdown_until": distillery.get("shutdown_until"),
    }


def _distillery_output_modifiers(distillery: dict) -> dict:
    equipment = distillery.get("equipment") or {}
    workers = distillery.get("workers") or {}
    maintenance = float(distillery.get("maintenance") or 0.0)
    heat = float(distillery.get("heat") or 0.0)

    production_mult = 1.0
    production_mult += int(equipment.get("stills") or 0) * 0.08
    production_mult += int(equipment.get("condensers") or 0) * 0.05
    production_mult += int(equipment.get("mash_tun") or 0) * 0.04
    production_mult += int(workers.get("production") or 0) * 0.04

    quality_mult = 1.0
    quality_mult += int(equipment.get("barrels") or 0) * 0.02
    quality_mult += int(equipment.get("quality_lab") or 0) * 0.03
    quality_mult += int(workers.get("quality") or 0) * 0.015

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

    margin = DISTILLERY_AUTO_SELL_MARGIN_BASE + int(workers.get("sales") or 0) * 0.01 + int(equipment.get("fake_labels") or 0) * 0.003
    margin = _clamp(margin, DISTILLERY_AUTO_SELL_MARGIN_BASE, DISTILLERY_AUTO_SELL_MARGIN_CAP)

    return {
        "production_mult": max(DISTILLERY_COLLECT_ROI_SAFETY_FLOOR, production_mult) * _clamp(maintenance_penalty, 0.55, 1.0) * _clamp(heat_penalty, 0.4, 1.0),
        "quality_mult": max(1.0, quality_mult),
        "auto_sell_margin": margin,
    }


def _distillery_roi_snapshot(distillery: dict, business: dict) -> dict:
    equipment = distillery.get("equipment") or {}
    workers = distillery.get("workers") or {}
    worker_cap = int(distillery.get("worker_capacity") or DISTILLERY_BASE_WORKER_CAP)
    bph = int(business.get("booze_per_hour") or BOOZE_PER_HOUR_BASE)
    base_cash_per_hour = float(business.get("income_per_hour") or INCOME_PER_HOUR_BASE)
    mods = _distillery_output_modifiers(distillery)
    effective_booze_per_hour = bph * mods["production_mult"]
    implied_cash_per_hour = base_cash_per_hour + (effective_booze_per_hour * DISTILLERY_BASE_BOOZE_UNIT_VALUE * mods["auto_sell_margin"] * 0.15)

    best_lane = None
    best_hours = None
    for lane in DISTILLERY_EQUIPMENT_ORDER:
        cur = int(equipment.get(lane) or 0)
        if cur >= DISTILLERY_EQUIPMENT_MAX_LEVEL:
            continue
        next_lvl = cur + 1
        cost = _distillery_upgrade_cost(lane, next_lvl)
        rough_delta = max(250.0, implied_cash_per_hour * (0.03 + (0.004 * next_lvl)))
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

    return {
        "cash_per_hour_estimate": round(implied_cash_per_hour, 2),
        "booze_per_hour_estimate": round(effective_booze_per_hour, 2),
        "next_upgrade_lane": best_lane,
        "next_upgrade_payback_hours": best_hours,
        "worker_payback_hours": worker_payback,
        "aging_tier_roi": tier_roi,
        "efficiency_score": round((_clamp(float(distillery.get("maintenance") or 0.0), 0.0, 100.0) * 0.45) + ((100.0 - _clamp(float(distillery.get("heat") or 0.0), 0.0, 100.0)) * 0.55), 2),
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


def _business_defender_strength(business: dict, guards: List[dict]) -> float:
    base = DEFENDER_BASE_STRENGTH
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


def _ibm_requirement_current(user: dict, business: Optional[dict], mission: dict, key: str) -> int:
    """Progress for one requirement. Segmented keys use illegal_business_mission_baselines for this mission id."""
    if key == "crimes":
        return int(user.get("total_crimes") or 0)
    if key == "rank_id":
        return _user_rank_id(user)
    if key == "security_level":
        if not business:
            return 0
        return len(business.get("security_upgrades") or [])
    if key in IBM_SEGMENT_KEYS:
        raw = _ibm_user_counter_raw(user, key)
        base = _ibm_baseline_int(user, mission["id"], key)
        return max(0, raw - base)
    return 0


def _ibm_mission_progress_row(user: dict, business: Optional[dict], mission: dict, completed_ids: set) -> Dict[str, Any]:
    req = mission.get("requirements") or {}
    cur = {key: _ibm_requirement_current(user, business, mission, key) for key in req}
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
    choice: str  # "cash" | "income_boost"


class HireGuardRequest(BaseModel):
    slot_number: int
    armour_level: int = 0
    weapon_level: int = 0


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
    booze_id: Optional[str] = None
    min_inventory: int = 50
    batch_size: int = 30


class DistilleryStartAgingRequest(BaseModel):
    tier: str
    quantity: int


class DistilleryClaimBatchRequest(BaseModel):
    batch_id: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
async def get_illegal_business_types(current_user: dict = Depends(get_current_user)):
    """Return available business types (for start screen when user has no business)."""
    return {"types": ILLEGAL_BUSINESS_TYPES}


async def _distillery_business_for_user(current_user: dict) -> tuple[dict, dict]:
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    now = _utc_now()
    dist, changed = _distillery_ensure_state(business, now)
    set_updates = {}
    # Distillery gameplay is available to any business type; bootstrap booze production fields if missing.
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


def _distillery_public_payload(distillery: dict, business: dict) -> dict:
    roi = _distillery_roi_snapshot(distillery, business)
    heat = float(distillery.get("heat") or 0.0)
    queue = distillery.get("aging_queue") or []
    equipment = distillery.get("equipment") or {}
    next_upgrade_costs: Dict[str, Optional[int]] = {}
    for lane in DISTILLERY_EQUIPMENT_ORDER:
        cur = int(equipment.get(lane) or 0)
        next_upgrade_costs[lane] = None if cur >= DISTILLERY_EQUIPMENT_MAX_LEVEL else _distillery_upgrade_cost(lane, cur + 1)
    return {
        "distillery": distillery,
        "heat_level": _distillery_heat_label(heat),
        "roi": roi,
        "active_batches": len(queue),
        "best_next_upgrade": roi.get("next_upgrade_lane"),
        "vault_balance": int(business.get("vault") or 0),
        "pricing": {
            "equipment_next_costs": next_upgrade_costs,
            "worker_hire_cost": DISTILLERY_WORKER_HIRE_COST,
            "maintenance_recover_cost_per_point": DISTILLERY_MAINTENANCE_RECOVER_COST_PER_POINT,
            "worker_max_hires_per_action": DISTILLERY_WORKER_MAX_PER_ACTION,
        },
    }


async def get_illegal_business(current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    distillery_payload = None
    if business.get("type_id") == "booze_making":
        now = _utc_now()
        distillery, changed = _distillery_ensure_state(business, now)
        if distillery:
            _distillery_decay_and_status(distillery, now)
            distillery_payload = _distillery_public_payload(distillery, business)
        if changed:
            await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": {"distillery": distillery}})
    guards = await db.illegal_business_guards.find({"business_id": business["id"]}, {"_id": 0}).sort("slot_number", 1).to_list(20)
    progress_user = await _ibm_load_user_with_mission_baselines(current_user["id"], current_user)
    completions = progress_user.get("illegal_business_mission_completions") or []
    completed_ids = {c.get("mission_id") for c in completions if c.get("mission_id")}
    pending_rewards = current_user.get("pending_illegal_business_rewards") or []
    type_info = next((t for t in ILLEGAL_BUSINESS_TYPES if t["id"] == business.get("type_id")), {})
    missions_progress = [
        _ibm_mission_progress_row(progress_user, business, m, completed_ids)
        for m in _ordered_ibm_missions()
    ]
    # Build security upgrades list (no mission locks; cost computed by index)
    security_upgrades_with_lock = []
    for i, u in enumerate(SECURITY_UPGRADES):
        entry = dict(u)
        entry["cost_cash"] = SECURITY_UPGRADE_BASE_CASH + SECURITY_UPGRADE_STEP_CASH * i
        entry["locked"] = False
        entry["unlock_mission_title"] = None
        security_upgrades_with_lock.append(entry)
    slots = int(business.get("guard_slots") or GUARD_SLOTS_INITIAL)
    if slots < GUARD_SLOTS_MAX:
        exp = slots - GUARD_SLOTS_INITIAL
        next_guard_slot_cash = int(GUARD_SLOT_BASE_CASH * (GUARD_SLOT_MULT ** exp))
    else:
        next_guard_slot_cash = None
    now = datetime.now(timezone.utc)
    pending_take, _ = await _illegal_business_pending_take_and_hours(business, current_user, now)
    return {
        "business": business,
        "pending_take": round(pending_take, 2),
        "guards": guards,
        "type_info": type_info,
        "missions_completed": list(completed_ids),
        "missions": missions_progress,
        "pending_kill_rewards": pending_rewards,
        "available_types": ILLEGAL_BUSINESS_TYPES,
        "security_upgrades_list": security_upgrades_with_lock,
        "next_guard_slot_cost_cash": next_guard_slot_cash,
        "guard_hire_cost": GUARD_HIRE_COST_CASH,
        "distillery": distillery_payload,
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


async def _illegal_business_pending_take_and_hours(
    business: dict, current_user: dict, now: datetime
) -> tuple[float, float]:
    """Uncollected till (cash) and hours since last collect, from a business document."""
    last_raw = business.get("last_collected_at")
    try:
        last = datetime.fromisoformat(last_raw.replace("Z", "+00:00")) if last_raw else now
    except Exception:
        last = now
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    hours = max(0.0, (now - last).total_seconds() / 3600)
    income_per_hour = int(business.get("income_per_hour") or INCOME_PER_HOUR_BASE)
    cap_hours = int(business.get("income_cap_hours") or INCOME_CAP_HOURS_BASE)
    level = int(business.get("level") or 1)
    level_mult = 1.0 + 0.04 * max(0, level - 1)
    boost_pct = int(current_user.get("illegal_business_income_boost_percent") or 0)
    income_per_hour_eff = income_per_hour * level_mult * (1.0 + boost_pct / 100.0)
    income = min(hours * income_per_hour_eff, income_per_hour_eff * cap_hours)
    income = round(income, 2)
    ev = await get_effective_event()
    prestige = get_prestige_bonus(current_user)
    income = round(income * float(ev.get("racket_payout", 1.0)) * float(prestige.get("illegal_business_mult", 1.0)), 2)
    racket_until = current_user.get("racket_until")
    if racket_until:
        try:
            until = datetime.fromisoformat(racket_until.replace("Z", "+00:00"))
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            if now < until:
                income = round(income * 1.2, 2)
        except Exception:
            pass
    return income, hours


async def _restore_illegal_business_collect_time(business_id: str, previous_last_collected_at: Optional[str]) -> None:
    """Undo last_collected_at bump when collect is rejected (timer must keep accruing)."""
    if previous_last_collected_at:
        await db.illegal_businesses.update_one(
            {"id": business_id},
            {"$set": {"last_collected_at": previous_last_collected_at}},
        )
    else:
        await db.illegal_businesses.update_one({"id": business_id}, {"$unset": {"last_collected_at": ""}})


async def collect_illegal_business(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
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
    # Ultra-rare token drop (0.001% = 1 in 100,000) - same as crimes
    if _rng.random() < 0.00001:
        token_type = _rng.choice(TOKEN_TYPES)
        field = TOKEN_CONFIG[token_type]["count_field"]
        inc[field] = inc.get(field, 0) + 1
    booze_earned = 0
    auto_sold_units = 0
    auto_sell_cash = 0
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

        booze_raw = min(hours_booze * bph * mods["production_mult"], (bph * bcap) * mods["production_mult"])
        booze_earned = int(max(0, booze_raw)) if not (status and status.get("is_shutdown")) else 0

        default_booze_id = _default_booze_type_id()
        if distillery:
            workers = distillery.get("workers") or {}
            equipment = distillery.get("equipment") or {}
            auto_sell = distillery.get("auto_sell") or {}
            sales_workers = int(workers.get("sales") or 0)

            if bool(auto_sell.get("enabled")) and sales_workers > 0 and booze_earned > 0:
                user_carrying = (current_user.get("booze_carrying") or {})
                existing_qty = int(user_carrying.get(default_booze_id) or 0)
                min_inv = max(0, int(auto_sell.get("min_inventory") or 0))
                batch_size = max(1, int(auto_sell.get("batch_size") or 1))
                ready_to_sell = max(0, existing_qty + booze_earned - min_inv)
                worker_cap = sales_workers * batch_size
                auto_sold_units = min(booze_earned, ready_to_sell, worker_cap)
                if auto_sold_units > 0:
                    auto_sell_cash = int(
                        auto_sold_units
                        * DISTILLERY_BASE_BOOZE_UNIT_VALUE
                        * float(mods.get("auto_sell_margin") or DISTILLERY_AUTO_SELL_MARGIN_BASE)
                        * float(mods.get("quality_mult") or 1.0)
                    )
                    booze_earned -= auto_sold_units
                    stats = distillery.get("stats") or {}
                    stats["total_booze_auto_sold"] = int(stats.get("total_booze_auto_sold") or 0) + auto_sold_units
                    stats["total_auto_sell_cash"] = int(stats.get("total_auto_sell_cash") or 0) + auto_sell_cash
                    distillery["stats"] = stats

            heat_gain = (booze_raw * DISTILLERY_HEAT_GAIN_PER_BOOZE) + (auto_sold_units * DISTILLERY_HEAT_GAIN_PER_AUTO_SELL)
            heat_mitigation = int(workers.get("security") or 0) * 0.35 + int(equipment.get("tunnel") or 0) * 0.25 + int(equipment.get("bribe_office") or 0) * 0.2
            distillery["heat"] = _clamp(float(distillery.get("heat") or 0.0) + max(0.0, heat_gain - heat_mitigation), 0.0, 100.0)

            if float(distillery.get("heat") or 0.0) >= DISTILLERY_HEAT_THRESHOLDS["critical"] and not status.get("is_shutdown"):
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
                    vault_total_before = int(business.get("vault") or 0) + int(income) + auto_sell_cash
                    vault_penalty = int(max(0, vault_total_before * loss_pct))
                    stats = distillery.get("stats") or {}
                    stats["heat_events_survived"] = int(stats.get("heat_events_survived") or 0) + 1
                    distillery["stats"] = stats

            updates["distillery"] = distillery
            distillery_breakdown = {
                "production_mult": round(float(mods.get("production_mult") or 1.0), 3),
                "quality_mult": round(float(mods.get("quality_mult") or 1.0), 3),
                "auto_sell_margin": round(float(mods.get("auto_sell_margin") or DISTILLERY_AUTO_SELL_MARGIN_BASE), 3),
                "heat": round(float(distillery.get("heat") or 0.0), 2),
                "heat_level": _distillery_heat_label(float(distillery.get("heat") or 0.0)),
                "shutdown_until": distillery.get("shutdown_until"),
                "auto_sold_units": auto_sold_units,
                "auto_sell_cash": auto_sell_cash,
                "vault_penalty": vault_penalty,
                "roi": _distillery_roi_snapshot(distillery, business),
            }
        if booze_earned > 0:
            updates["last_collected_booze_at"] = now.isoformat()
            await db.users.update_one(
                {"id": current_user["id"]},
                {"$inc": {f"booze_carrying.{default_booze_id}": booze_earned}},
            )
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
    if booze_earned:
        msg += f" and {booze_earned} booze."
    if auto_sell_cash > 0:
        msg += f" Workers moved {auto_sold_units} units for ${auto_sell_cash:,}."
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
        "booze": booze_earned,
        "auto_sell_cash": auto_sell_cash,
        "auto_sold_units": auto_sold_units,
        "vault_penalty": vault_penalty,
        "distillery": distillery_breakdown,
        "respect_points": respect_earned,
        "bullets": bullets_earned,
        "points": points_earned,
        "loot_box_pieces": loot_pieces_earned,
        "tokens_earned": token_earned,
    }


async def get_distillery(current_user: dict = Depends(get_current_user)):
    business, distillery = await _distillery_business_for_user(current_user)
    _distillery_decay_and_status(distillery, _utc_now())
    await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": {"distillery": distillery}})
    return _distillery_public_payload(distillery, business)


async def distillery_collect(current_user: dict = Depends(get_current_user)):
    payload = await collect_illegal_business(current_user)
    business, distillery = await _distillery_business_for_user(current_user)
    payload["distillery_state"] = _distillery_public_payload(distillery, business)
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
    total_spent = int(business.get("total_spent") or 0) + cost

    result = await db.illegal_businesses.update_one(
        {"id": business["id"], "vault": {"$gte": cost}},
        {"$set": {"distillery": distillery, "total_spent": total_spent}, "$inc": {"vault": -cost}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Upgrade failed. Try again.")
    return {
        "message": f"Installed {lane.replace('_', ' ')} level {next_level}.",
        "cost": cost,
        **_distillery_public_payload(distillery, business),
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
    result = await db.illegal_businesses.update_one({"id": business["id"]}, updates)
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Unable to assign workers right now.")
    return {
        "message": "Crew assignments updated.",
        "hire_cost": hire_cost,
        **_distillery_public_payload(distillery, business),
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
        **_distillery_public_payload(distillery, business),
    }


async def distillery_set_auto_sell(req: DistilleryAutoSellRequest, current_user: dict = Depends(get_current_user)):
    business, distillery = await _distillery_business_for_user(current_user)
    booze_id = (req.booze_id or _default_booze_type_id()).strip() or _default_booze_type_id()
    auto_sell = distillery.get("auto_sell") or {}
    auto_sell["enabled"] = bool(req.enabled)
    auto_sell["booze_id"] = booze_id
    auto_sell["min_inventory"] = max(0, int(req.min_inventory or 0))
    auto_sell["batch_size"] = max(1, int(req.batch_size or 1))
    distillery["auto_sell"] = auto_sell
    await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": {"distillery": distillery}})
    return {
        "message": "Worker auto-sell rules updated.",
        **_distillery_public_payload(distillery, business),
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
    tier_cfg = DISTILLERY_AGING_TIERS[tier]
    aging_hours = _rng.uniform(float(tier_cfg["hours_min"]), float(tier_cfg["hours_max"]))
    now = _utc_now()
    finish = now + timedelta(hours=aging_hours)
    batch_id = str(uuid.uuid4())
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

    user_result = await db.users.update_one({"id": current_user["id"], f"booze_carrying.{booze_id}": {"$gte": qty}}, {"$inc": {f"booze_carrying.{booze_id}": -qty}})
    if user_result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Could not reserve booze for aging.")
    await db.illegal_businesses.update_one({"id": business["id"]}, {"$set": {"distillery": distillery}})
    return {
        "message": f"Batch {batch_id[:8]} started in the {tier} cellar.",
        "batch_id": batch_id,
        "ready_at": finish.isoformat(),
        **_distillery_public_payload(distillery, business),
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
        **_distillery_public_payload(distillery, business),
    }


async def get_illegal_business_missions(current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    progress_user = await _ibm_load_user_with_mission_baselines(current_user["id"], current_user)
    completions = progress_user.get("illegal_business_mission_completions") or []
    completed_ids = {c.get("mission_id") for c in completions if c.get("mission_id")}
    progress = [
        _ibm_mission_progress_row(progress_user, business, m, completed_ids)
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
    met = True
    for key, target in req.items():
        cur = _ibm_requirement_current(progress_user, business, mission, key)
        if cur < target:
            met = False
            break
    if not met:
        raise HTTPException(status_code=400, detail="Requirements not met.")
    rewards = mission.get("rewards") or {}
    now = datetime.now(timezone.utc).isoformat()
    user_updates = {"$push": {"illegal_business_mission_completions": {"mission_id": mission_id, "completed_at": now}}}
    for token_type in TOKEN_TYPES:
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
    if rewards.get("guard_slots"):
        update_business_inc["guard_slots"] = int(rewards["guard_slots"])
    if rewards.get("vault_cash"):
        update_business_inc["vault"] = int(rewards["vault_cash"])
        update_business_inc["vault_lifetime_earned"] = int(rewards["vault_cash"])
    biz_update = {}
    if update_business_set:
        biz_update["$set"] = update_business_set
    if update_business_inc:
        biz_update["$inc"] = update_business_inc
    if biz_update:
        await db.illegal_businesses.update_one({"id": business["id"]}, biz_update)
    return {"message": mission.get("story", "Mission complete.")}


async def get_illegal_business_guards(current_user: dict = Depends(get_current_user)):
    business = await db.illegal_businesses.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not business:
        raise HTTPException(status_code=404, detail="You don't have an illegal business.")
    slots = int(business.get("guard_slots") or GUARD_SLOTS_INITIAL)
    limit = min(2000, max(slots + 100, 500))
    guards = await db.illegal_business_guards.find({"business_id": business["id"]}, {"_id": 0}).sort("slot_number", 1).to_list(limit)
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
    unlock = int(business.get("guard_weapon_max_unlock") or 0)
    effective_max = min(GUARD_WEAPON_MAX, GUARD_WEAPON_BASE_MAX + unlock)
    armour = max(0, min(effective_max, req.armour_level))
    weapon = max(0, min(effective_max, req.weapon_level))
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
    cost_cash = SECURITY_UPGRADE_BASE_CASH + SECURITY_UPGRADE_STEP_CASH * idx
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
    today_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    now = datetime.now(timezone.utc).isoformat()
    cooldowns_new = dict(cooldowns)
    cooldowns_new[target_id] = now
    claim_result = await db.users.find_one_and_update(
        {"id": current_user["id"],
         "$or": [
             {"illegal_business_raids_date": {"$ne": today_key}},
             {"illegal_business_raids_today": {"$lt": RAID_DAILY_LIMIT}},
         ]},
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
        raise HTTPException(status_code=400, detail=f"Daily raid limit ({RAID_DAILY_LIMIT}) reached.")
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
        loot_cash = int(available * RAID_LOOT_PERCENT)
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
    today_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    raid_count_today = int(current_user.get("illegal_business_raids_today") or 0)
    raid_date = current_user.get("illegal_business_raids_date")
    if raid_date != today_key:
        raid_count_today = 0
    if raid_count_today >= RAID_DAILY_LIMIT:
        raise HTTPException(status_code=400, detail=f"Daily raid limit ({RAID_DAILY_LIMIT}) reached.")
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
    if choice not in ("cash", "income_boost"):
        raise HTTPException(status_code=400, detail="Choice must be 'cash' or 'income_boost'.")
    pending = current_user.get("pending_illegal_business_rewards") or []
    entry = next((p for p in pending if p.get("victim_id") == req.victim_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="No pending reward for this victim.")
    moderately_upgraded = bool(entry.get("moderately_upgraded"))
    if choice == "income_boost" and not moderately_upgraded:
        raise HTTPException(status_code=400, detail="Victim's business was not moderately upgraded. Take cash instead.")
    old_user = await db.users.find_one_and_update(
        {"id": current_user["id"], "pending_illegal_business_rewards.victim_id": req.victim_id},
        {"$pull": {"pending_illegal_business_rewards": {"victim_id": req.victim_id}}},
    )
    if not old_user:
        raise HTTPException(status_code=404, detail="No pending reward for this victim.")
    reward_entry = next((p for p in old_user.get("pending_illegal_business_rewards", []) if p.get("victim_id") == req.victim_id), None)
    if not reward_entry:
        raise HTTPException(status_code=404, detail="No pending reward for this victim.")
    total_spent = int(reward_entry.get("total_spent") or 0)
    if choice == "cash":
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$inc": {"money": total_spent, "illegal_business_kill_rewards_claimed": 1}},
        )
        return {"message": f"Took ${total_spent:,} from the late owner's operation.", "cash": total_spent, "income_boost": None}
    else:
        current_boost = int(current_user.get("illegal_business_income_boost_percent") or 0)
        new_boost = min(MAX_INCOME_BOOST_PERCENT, current_boost + INCOME_BOOST_PER_KILL_PERCENT)
        await db.users.update_one(
            {"id": current_user["id"]},
            {
                "$set": {"illegal_business_income_boost_percent": new_boost},
                "$inc": {"illegal_business_kill_rewards_claimed": 1},
            },
        )
        return {"message": f"Income boost +{INCOME_BOOST_PER_KILL_PERCENT}%. Total: {new_boost}%.", "cash": 0, "income_boost": new_boost}


def register(router):
    router.add_api_route("/illegal-business/types", get_illegal_business_types, methods=["GET"])
    router.add_api_route("/illegal-business", get_illegal_business, methods=["GET"])
    router.add_api_route("/illegal-business/start", start_illegal_business, methods=["POST"])
    router.add_api_route("/illegal-business/collect", collect_illegal_business, methods=["POST"])
    router.add_api_route("/illegal-business/distillery", get_distillery, methods=["GET"])
    router.add_api_route("/illegal-business/distillery/collect", distillery_collect, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/upgrade-equipment", distillery_upgrade_equipment, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/assign-workers", distillery_assign_workers, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/maintenance", distillery_maintenance, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/set-auto-sell-rules", distillery_set_auto_sell, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/start-aging-batch", distillery_start_aging_batch, methods=["POST"])
    router.add_api_route("/illegal-business/distillery/claim-aged-batch", distillery_claim_aged_batch, methods=["POST"])
    router.add_api_route("/illegal-business/missions", get_illegal_business_missions, methods=["GET"])
    router.add_api_route("/illegal-business/missions/{mission_id}/complete", complete_illegal_business_mission, methods=["POST"])
    router.add_api_route("/illegal-business/guards", get_illegal_business_guards, methods=["GET"])
    router.add_api_route("/illegal-business/guards/buy-slot", buy_guard_slot, methods=["POST"])
    router.add_api_route("/illegal-business/guards/hire", hire_illegal_business_guard, methods=["POST"])
    router.add_api_route("/illegal-business/security/upgrade/{upgrade_id}", upgrade_security, methods=["POST"])
    router.add_api_route("/illegal-business/withdraw", withdraw_illegal_business, methods=["POST"])
    router.add_api_route("/illegal-business", patch_illegal_business, methods=["PATCH"])
    router.add_api_route("/illegal-business/raid", raid_illegal_business, methods=["POST"])
    router.add_api_route("/illegal-business/raid/random", raid_random_illegal_business, methods=["POST"])
    router.add_api_route("/illegal-business/claim-kill-reward", claim_kill_reward, methods=["POST"])
