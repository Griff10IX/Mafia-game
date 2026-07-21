# Families: list, create, join, leave, kick, roles, treasury, rackets, crew OC, war stats/truce/history
from datetime import datetime, timezone, timedelta
import asyncio
import hashlib
import logging
import secrets
_rng = secrets.SystemRandom()
import time
import uuid
import os
import sys
from typing import Optional, Dict, List, Any
from collections import defaultdict

logger = logging.getLogger(__name__)

# Caching: config is static; list and my have short TTL, invalidated on mutations
_config_cache: Optional[dict] = None
_list_cache: Optional[tuple] = None  # (payload, expires_at)
_list_cache_ttl_sec = 20
_my_cache: Dict[str, tuple] = {}  # user_id -> (payload, expires_at)
_my_cache_ttl_sec = 10
_my_cache_max_entries = 2000

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import Depends, HTTPException, Body, Header, Query
from pydantic import BaseModel
from bson.objectid import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from utils.game_timezone import game_week_range_utc
from utils.notepad_color import notepad_color_for_api_response, normalize_notepad_color_for_set
from utils.point_provenance import log_points_event
from utils.game_pass_season_rp import apply_season_rp_mirror_to_update, rank_points_in_update
from utils.family_vault_log import log_family_vault_tx
from utils.family_perks import (
    PERK_IDS,
    clean_family_perks,
    utc_calendar_month_end,
    perk_catalog_prices,
    FAMILY_PERK_COST_CREW_OC,
    FAMILY_PERK_COST_MELT,
    FAMILY_PERK_COST_GTA,
    FAMILY_PERK_COST_HITLIST,
    FAMILY_PERK_COST_RACKET,
    FAMILY_PERK_COST_BOOZE_STEP,
    FAMILY_PERK_CREW_OC_HOURS_OFF,
    FAMILY_PERK_MELT_SECONDS_OFF,
    FAMILY_PERK_GTA_SECONDS_OFF,
    FAMILY_PERK_HITLIST_NPC_SLOTS,
    FAMILY_PERK_RACKET_BONUS_PERCENT,
    FAMILY_PERK_BOOZE_STEP_AMOUNT,
    FAMILY_PERK_BOOZE_BONUS_CAP,
    FAMILY_PERK_COST_CREW_OC_AUTO_COMMIT,
    FAMILY_PERK_CREW_OC_AUTO_COMMIT_DAYS,
    family_perk_modifiers,
)
from utils.civilian_protection import maybe_revoke_civilian_protection
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_FAMILIES

from server import (
    db,
    get_current_user,
    get_current_user_verified,
    get_effective_event,
    log_activity,
    log_respect_earned,
    RANKS,
    send_notification,
    send_notification_to_family,
    maybe_process_rank_up,
    user_prestige_rank_mult,
    set_state_head,
    clear_or_transfer_state_head_on_wipe,
    get_head_family_id_for_state,
    canonical_state_name,
    _get_active_war_between,
    _get_active_war_for_family,
    _family_in_active_war,
    _family_war_duration_seconds,
    _family_war_start,
    _record_war_stats_bodyguard_kill,  # kept for potential direct use
    founding_member_income_mult,
    _is_admin,
)


async def _families_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_FAMILIES)


_families_rl_u = [Depends(_families_sustained_rl_user)]

# ============ Constants ============
MAX_FAMILIES = 6
# Admin-seeded / tool-created families set player_cap_exempt=True so they do not count toward this cap.
FAMILY_LIST_QUERY_LIMIT = 500  # list view: player crews + exempt crews
FAMILY_CREATE_COST = 75_000_000  # $75M to create a family
FAMILY_ROLES = ["boss", "underboss", "consigliere", "capo", "soldier", "associate"]
FAMILY_ROLE_LIMITS = {"boss": 1, "underboss": 1, "consigliere": 1, "capo": 4, "soldier": 15, "associate": 30}
FAMILY_ROLE_ORDER = {"boss": 0, "underboss": 1, "consigliere": 2, "capo": 3, "soldier": 4, "associate": 5}
FAMILY_WAR_RECRUITMENT_WINDOW_HOURS = 24
WAR_RAT_BADGE_UNSET = {"war_rat_badge_until": "", "war_rat_family_id": "", "war_rat_war_ids": ""}
ACTIVE_FAMILY_FILTER = {
    "wiped": {"$ne": True},
    "provisioning": {"$ne": True},
}

# High command (chain of command top 3) + legacy "don" role stored on some crews
TOP3_FAMILY_ROLES = ("boss", "don", "underboss", "consigliere")
AIRPORT_CREW_PERK_NONE = "none"
AIRPORT_CREW_PERK_TRAVEL_TIME = "travel_time"
AIRPORT_CREW_PERK_POINTS_DISCOUNT = "points_discount"
AIRPORT_CREW_PERK_VALUES = frozenset(
    {AIRPORT_CREW_PERK_NONE, AIRPORT_CREW_PERK_TRAVEL_TIME, AIRPORT_CREW_PERK_POINTS_DISCOUNT}
)

# Crew emblem: each active family claims a unique key (preset id or SHA-256 of custom image bytes).
FAMILY_EMBLEM_PRESETS_PUBLIC = [
    {"id": "skull_bones", "label": "Skull & bones"},
    {"id": "wolf_strike", "label": "Wolf strike"},
    {"id": "rose_thorn", "label": "Rose thorn"},
    {"id": "dagger_drop", "label": "Dagger drop"},
    {"id": "crown_sigil", "label": "Crown sigil"},
    {"id": "fist_city", "label": "Fist of the city"},
    {"id": "star_north", "label": "North star"},
    {"id": "ace_spade", "label": "Ace of spades"},
    {"id": "serpent_coil", "label": "Serpent coil"},
    {"id": "hourglass", "label": "Hourglass oath"},
    {"id": "crosshairs", "label": "Crosshairs"},
    {"id": "mask_void", "label": "Venetian mask"},
    {"id": "omerta_shield", "label": "Omerta shield"},
    {"id": "blood_lock", "label": "Blood lock"},
    {"id": "skeleton_key", "label": "Skeleton key"},
    {"id": "black_diamond", "label": "Black diamond"},
    {"id": "vendetta_flame", "label": "Vendetta flame"},
    {"id": "headhunter", "label": "Headhunter"},
    {"id": "dirty_cash", "label": "Dirty cash"},
    {"id": "old_world", "label": "Old world"},
    {"id": "getaway", "label": "Getaway"},
    {"id": "powder_keg", "label": "Powder keg"},
    {"id": "watcher", "label": "The watcher"},
    {"id": "grave_cross", "label": "Grave cross"},
    {"id": "coin_ring", "label": "Coin ring"},
    {"id": "tax_collector", "label": "Tax collector"},
    {"id": "front_business", "label": "Front business"},
    {"id": "safehouse", "label": "Safehouse"},
    {"id": "loaded_dice", "label": "Loaded dice"},
    {"id": "tribute", "label": "Tribute"},
    {"id": "racket_iron", "label": "Racket iron"},
    {"id": "night_veil", "label": "Night veil"},
    {"id": "throne_claim", "label": "Throne claim"},
    {"id": "silent_contract", "label": "Silent contract"},
    {"id": "war_crest", "label": "War crest"},
    {"id": "empire_mark", "label": "Empire mark"},
    {"id": "don_regalia", "label": "Don regalia"},
    {"id": "crossed_tommy", "label": "Crossed tommy guns"},
    {"id": "honor_and_blood", "label": "Honor and blood"},
    {"id": "black_hand", "label": "Black hand"},
    {"id": "golden_omerta", "label": "Golden omerta"},
    {"id": "la_famiglia", "label": "La famiglia"},
    {"id": "midnight_syndicate", "label": "Midnight syndicate"},
    {"id": "vault_dynasty", "label": "Vault dynasty"},
    {"id": "iron_rose", "label": "Iron rose"},
    {"id": "boss_throne", "label": "Boss throne"},
]
FAMILY_EMBLEM_PRESETS_PREMIUM = [
    {"id": "premium_gilded_crest", "label": "Gilded crest"},
    {"id": "premium_obsidian_seal", "label": "Obsidian seal"},
    {"id": "premium_blood_oath", "label": "Blood oath banner"},
    {"id": "premium_imperial_eagle", "label": "Imperial eagle"},
    {"id": "premium_vault_crown", "label": "Vault crown"},
]
FAMILY_EMBLEM_PRESET_IDS = frozenset(p["id"] for p in FAMILY_EMBLEM_PRESETS_PUBLIC)
FAMILY_EMBLEM_PREMIUM_PRESET_IDS = frozenset(p["id"] for p in FAMILY_EMBLEM_PRESETS_PREMIUM)
FAMILY_SAFE_DEPOSIT_DEFAULT_CAP = 0
# Personal safe cash cap per member by owned tier (1-3). Derived from tiers at read time so
# cap raises apply to families that already bought tiers (stored safe_deposit_cap is legacy).
FAMILY_SAFE_DEPOSIT_TIER_CAPS = (250_000_000, 500_000_000, 1_000_000_000)


def family_safe_deposit_cap(fam: Optional[dict]) -> int:
    tiers = int((fam or {}).get("safe_deposit_tiers") or 0)
    if tiers <= 0:
        # Legacy: some families have a stored cap without tiers recorded.
        return int((fam or {}).get("safe_deposit_cap") or 0)
    return FAMILY_SAFE_DEPOSIT_TIER_CAPS[min(tiers, len(FAMILY_SAFE_DEPOSIT_TIER_CAPS)) - 1]


def _valid_emblem_preset_for_family(preset: str, fam: Optional[dict]) -> bool:
    if preset in FAMILY_EMBLEM_PRESET_IDS:
        return True
    if preset in FAMILY_EMBLEM_PREMIUM_PRESET_IDS and (fam or {}).get("premium_crest_unlocked"):
        return True
    return False

# Per-crew garage melt contribution (user doc); reset when leaving/kick/join — not global bullets_melted
def _family_melt_stats_reset_fields() -> dict:
    """Values to clear per-crew garage melt contribution on the user (not global bullets_melted)."""
    return {
        "family_bullets_melted": 0,
        "family_melt_reward_money_earned": 0,
        "family_melt_reward_hits": 0,
    }


# Racket progression: extended levels for longer crew grind.
# At full upgrade (all 9 rackets around level 15), hourly active collections land around multi-million/day treasury flow.
RACKET_BASE_COOLDOWN_HOURS = 10 / 60  # 10 minutes
FAMILY_RACKETS = [
    {"id": "protection", "name": "Protection Racket", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 620, "description": "Extortion from businesses"},
    {"id": "gambling", "name": "Gambling Operation", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 850, "description": "Numbers & bookmaking"},
    {"id": "loansharking", "name": "Loan Sharking", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 1080, "description": "High-interest loans"},
    {"id": "labour", "name": "Labour Racketeering", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 1310, "description": "Union kickbacks"},
    {"id": "distillery", "name": "Distillery", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 1540, "description": "Bootleg liquor production"},
    {"id": "warehouse", "name": "Warehouse", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 1780, "description": "Storage and distribution"},
    {"id": "restaurant_bar", "name": "Restaurant & Bar", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 2000, "description": "Front and steady income"},
    {"id": "funeral_home", "name": "Funeral Home", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 2240, "description": "Respectable front"},
    {"id": "garment_shop", "name": "Garment Shop", "cooldown_hours": RACKET_BASE_COOLDOWN_HOURS, "base_income": 2470, "description": "Garment district operations"},
]
RACKET_UPGRADE_COST = 12_500  # 75% reduction
RACKET_UNLOCK_COST = 25_000  # 75% reduction
RACKET_MAX_LEVEL = 15
# One daily treasury bullet payout per racket, paid on first collect of the UTC day.
# With all rackets maxed, this is roughly ~100 bullets/day total.
RACKET_DAILY_BULLETS_PER_LEVEL = 0.75
FAMILY_RACKET_BASE_INCOME_MULT = 1.5
FAMILY_RACKET_ATTACK_BASE_SUCCESS = 0.70
FAMILY_RACKET_ATTACK_LEVEL_PENALTY = 0.10
FAMILY_RACKET_ATTACK_MIN_SUCCESS = 0.10
FAMILY_RACKET_ATTACK_MAX_SUCCESS = 0.90
FAMILY_RACKET_ATTACK_REVENUE_PCT = 0.25  # legacy; raids use till theft
FAMILY_RACKET_ATTACK_TILL_TAKE_PCT = 0.40
FAMILY_RACKET_OFFENCE_SUCCESS_PER_POINT = 0.02
FAMILY_RACKET_DEFENCE_SUCCESS_PER_POINT = 0.02
FAMILY_RACKET_OFFENCE_TAKE_BONUS_PER_POINT = 0.01
FAMILY_RACKET_ATTACK_MAX_PER_CREW = 2
FAMILY_RACKET_ATTACK_CREW_WINDOW_HOURS = 3

FAMILY_RACKET_DEFENCE_UPGRADES = [
    {"id": "reinforced_door", "name": "Reinforced door", "cost": 50_000, "defence_weight": 8},
    {"id": "lookout", "name": "Lookout", "cost": 75_000, "defence_weight": 10},
    {"id": "bouncers", "name": "Bouncers", "cost": 100_000, "defence_weight": 12},
    {"id": "alarm_wire", "name": "Alarm wire", "cost": 125_000, "defence_weight": 9},
    {"id": "thompson", "name": "Thompson crew", "cost": 175_000, "defence_weight": 14},
    {"id": "guard_dog", "name": "Guard dog", "cost": 200_000, "defence_weight": 11},
    {"id": "safe_room", "name": "Safe room", "cost": 275_000, "defence_weight": 16},
    {"id": "bribed_cop", "name": "Bribed beat cop", "cost": 350_000, "defence_weight": 13},
    {"id": "iron_bars", "name": "Iron bars", "cost": 425_000, "defence_weight": 10},
    {"id": "vault_safe", "name": "Vault / safe", "cost": 500_000, "defence_weight": 18},
]
FAMILY_RACKET_OFFENCE_UPGRADES = [
    {"id": "crew_driver", "name": "Getaway driver", "cost": 100_000, "offence_weight": 8},
    {"id": "inside_man", "name": "Inside man", "cost": 150_000, "offence_weight": 10},
    {"id": "muscle", "name": "Muscle squad", "cost": 200_000, "offence_weight": 12},
    {"id": "sawed_off", "name": "Sawed-off crew", "cost": 275_000, "offence_weight": 11},
    {"id": "tommy_crew", "name": "Tommy gunners", "cost": 350_000, "offence_weight": 14},
    {"id": "wire_taps", "name": "Wire taps", "cost": 425_000, "offence_weight": 9},
    {"id": "safe_cracker", "name": "Safe cracker", "cost": 500_000, "offence_weight": 13},
    {"id": "wheelman", "name": "Wheelman network", "cost": 575_000, "offence_weight": 10},
    {"id": "enforcer", "name": "Head enforcer", "cost": 650_000, "offence_weight": 15},
    {"id": "war_council", "name": "War council", "cost": 750_000, "offence_weight": 16},
]
_FAMILY_RACKET_DEFENCE_BY_ID = {x["id"]: x for x in FAMILY_RACKET_DEFENCE_UPGRADES}
_FAMILY_RACKET_OFFENCE_BY_ID = {x["id"]: x for x in FAMILY_RACKET_OFFENCE_UPGRADES}

CREW_OC_COOLDOWN_HOURS = 8
CREW_OC_COOLDOWN_HOURS_REDUCED = 6
CREW_OC_COMMIT_ROLES = ("boss", "underboss", "capo", "don")

# Casino game types that contribute to state head income (and have gambling_log entries with city/state)
STATE_HEAD_CASINO_GAMES = ["dice", "roulette", "blackjack", "horseracing", "videopoker"]
from routers.casinos.slots import SLOTS_FEATURE_ENABLED as _SLOTS_FEATURE_ENABLED
if _SLOTS_FEATURE_ENABLED:
    STATE_HEAD_CASINO_GAMES.append("slots")


async def count_families_toward_player_cap() -> int:
    """Crews that count toward MAX_FAMILIES for player creation (admin tools set player_cap_exempt)."""
    return await db.families.count_documents({
        "wiped": {"$ne": True},
        "player_cap_exempt": {"$ne": True},
    })


async def _state_head_casino_week_stats(state_name: str):
    """Aggregate gambling_log for the current week (Monday 00:00 Europe/London) in the given state. Returns { game_type: { wins, losses } }."""
    state = canonical_state_name(state_name)
    if not state:
        return {}
    now = datetime.now(timezone.utc)
    week_start, week_end = game_week_range_utc(now)
    week_start_iso = week_start.isoformat().replace("+00:00", "Z")
    week_end_iso = week_end.isoformat().replace("+00:00", "Z")
    result = {gt: {"wins": 0, "losses": 0} for gt in STATE_HEAD_CASINO_GAMES}

    def _is_win(game_type: str, details: dict) -> bool:
        if game_type == "dice":
            return bool(details.get("win"))
        if game_type == "roulette":
            return bool(details.get("win"))
        if game_type == "blackjack":
            return details.get("result") in ("win", "dealer_bust")
        if game_type == "horseracing":
            return bool(details.get("won"))
        if game_type == "slots":
            return bool(details.get("won")) or (int(details.get("payout") or 0) > 0)
        if game_type == "videopoker":
            return (int(details.get("payout") or 0) > int(details.get("bet") or 0))
        return False

    def _in_state(game_type: str, details: dict) -> bool:
        city = canonical_state_name(details.get("city") or "")
        st = canonical_state_name(details.get("state") or "")
        return city == state or st == state

    try:
        cursor = db.gambling_log.find(
            {"created_at": {"$gte": week_start_iso, "$lt": week_end_iso}, "game_type": {"$in": STATE_HEAD_CASINO_GAMES}},
            {"_id": 0, "game_type": 1, "details": 1},
        )
        async for entry in cursor:
            gt = (entry.get("game_type") or "").strip()
            details = entry.get("details") or {}
            if gt not in result or not _in_state(gt, details):
                continue
            if _is_win(gt, details):
                result[gt]["wins"] += 1
            else:
                result[gt]["losses"] += 1
    except Exception:
        pass
    return result
CREW_OC_REWARD_RP = 500
CREW_OC_REWARD_RP_PER_PARTICIPANT = 50  # every participant adds this to everyone's RP payout
CREW_OC_REWARD_CASH = 500_000
CREW_OC_REWARD_BULLETS = 500
CREW_OC_REWARD_POINTS_MIN = 5
CREW_OC_REWARD_POINTS_MAX = 25  # rolled per crew member on commit
CREW_OC_REWARD_BOOZE = 10
CREW_OC_TREASURY_LUMP = 500_000


async def _crew_oc_committer_user_ids(family_id: str) -> List[str]:
    """User ids allowed to commit Crew OC (Don / Underboss / Capo), including families.boss_id fallback."""
    rows = await db.family_members.find(
        {"family_id": family_id, "role": {"$in": list(CREW_OC_COMMIT_ROLES)}},
        {"_id": 0, "user_id": 1},
    ).to_list(20)
    ids = {str(r["user_id"]) for r in rows if r.get("user_id")}
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "boss_id": 1})
    bid = _uid_str((fam or {}).get("boss_id"))
    if bid:
        ids.add(bid)
    return list(ids)


async def _crew_oc_effective_cooldown_info(family_id: str, actor_user_id: Optional[str] = None) -> Dict[str, Any]:
    """Crew OC cooldown after store timer (any committer holds upgrade) + active family crew_oc perk."""
    leader_ids = await _crew_oc_committer_user_ids(family_id)
    timer_holder_ids: set = set()
    if leader_ids:
        timer_rows = await db.users.find(
            {"id": {"$in": leader_ids}, "crew_oc_timer_reduced": True, "is_dead": {"$ne": True}},
            {"_id": 0, "id": 1},
        ).to_list(10)
        timer_holder_ids = {str(u["id"]) for u in timer_rows if u.get("id")}
    has_store_timer = bool(timer_holder_ids)
    actor_has_timer = bool(actor_user_id and str(actor_user_id) in timer_holder_ids)
    mods = await family_perk_modifiers(db, family_id)
    perk_off = int(mods.get("crew_oc_hours_off") or 0)
    base_hours = CREW_OC_COOLDOWN_HOURS_REDUCED if has_store_timer else CREW_OC_COOLDOWN_HOURS
    hours = max(1, base_hours - perk_off) if perk_off > 0 else base_hours
    return {
        "hours": hours,
        "base_hours": base_hours,
        "perk_hours_off": perk_off,
        "has_store_timer": has_store_timer,
        "actor_has_timer": actor_has_timer,
    }

FAMILY_RACKET_RAID_SUCCESS_MESSAGES = [
    "Raid successful! Took ${amount:,} from {family_name}'s {racket_name}.",
    "Clean score. ${amount:,} from {family_name}'s racket.",
    "You hit their {racket_name}. ${amount:,} to your treasury.",
    "Raid successful. ${amount:,} from {family_name}.",
    "The take: ${amount:,} from {family_name}'s {racket_name}.",
    "No heat. ${amount:,} from their {racket_name}.",
    "Done. ${amount:,} taken from {family_name}.",
    "Smooth run. ${amount:,} from {family_name}'s racket.",
    "Score. ${amount:,} from {family_name}'s {racket_name}.",
    "Raid paid off. ${amount:,}.",
]
FAMILY_RACKET_RAID_FAIL_MESSAGES = [
    "Raid failed.",
    "No dice. {family_name}'s {racket_name} held.",
    "They were ready. Raid failed.",
    "The crew at {family_name} pushed back. No take.",
    "Raid blown. {family_name}'s racket didn't give.",
    "Wrong move. Raid failed.",
    "Their muscle held the line. No score.",
    "Raid failed. {family_name} was buttoned up.",
    "No score. Try again when the heat's off.",
    "The raid didn't stick. No payout.",
]

FAMILY_RACKET_COLLECT_SUCCESS_MESSAGES = [
    "Collected ${income:,}", "Your cut: ${income:,}", "Racket paid out. ${income:,} to the family.",
    "Collected ${income:,} from the racket.", "The take: ${income:,}.", "Payout collected. ${income:,}.",
    "${income:,} in the bag.", "Racket income: ${income:,}.", "Collected ${income:,}. Clean.", "Your share: ${income:,}.",
]

FAMILY_MELT_TREASURY_PCT_MAX = 50
FAMILY_MELT_REWARD_THRESHOLD_STEP = 1000
FAMILY_MELT_REWARD_THRESHOLD_MAX = 5_000_000
FAMILY_MELT_REWARD_MONEY_MAX = 5_000_000_000


# ============ Request models ============
class FamilyCreateRequest(BaseModel):
    name: str
    tag: str
    emblem_preset_id: Optional[str] = None
    emblem_custom_data: Optional[str] = None  # data URL; mutually exclusive with emblem_preset_id


class FamilyJoinRequest(BaseModel):
    family_id: str


class FamilyApplyRequest(BaseModel):
    family_id: str


class FamilyJoinSettingsRequest(BaseModel):
    join_mode: Optional[str] = None   # "open" | "approval"
    join_auto_accept: Optional[str] = None   # "none" | "all" | "rank_min"
    join_auto_accept_rank_min: Optional[int] = None   # rank id; used when join_auto_accept == "rank_min"


class FamilyMeltRewardTier(BaseModel):
    threshold_bullets: int
    reward_money: int


class FamilyMeltSettingsRequest(BaseModel):
    melt_treasury_pct: Optional[int] = None
    melt_reward_tiers: Optional[List[FamilyMeltRewardTier]] = None


class FamilyJoinApplicationActionRequest(BaseModel):
    pass  # path param application_id


class FamilyKickRequest(BaseModel):
    user_id: str


class FamilySellOnTradeRequest(BaseModel):
    points: int


class FamilyRoleRequest(BaseModel):
    user_id: str
    role: str


class FamilyDepositRequest(BaseModel):
    amount: int = 0
    bullets: int = 0


class FamilyWithdrawRequest(BaseModel):
    amount: int = 0
    bullets: int = 0


class FamilyGiveBulletsRequest(BaseModel):
    user_id: str
    bullets: int


class FamilyGiveLootRequest(BaseModel):
    user_id: str
    loot_pieces: int


class CompoundDepositRequest(BaseModel):
    cash: int = 0
    points: int = 0
    loot_pieces: int = 0


class CompoundWithdrawRequest(BaseModel):
    cash: int = 0
    points: int = 0
    loot_pieces: int = 0


class CompoundReturnToMemberRequest(BaseModel):
    user_id: str


class FamilyPerksPurchaseRequest(BaseModel):
    perk_id: str
    booze_steps: int = 1


class FamilyPerksContributeRequest(BaseModel):
    points: int


FAMILY_PERK_CONTRIBUTE_POINTS_MAX = 250_000


class CompoundClaimForFamilyRequest(BaseModel):
    user_id: str


class FamilyAttackRacketRequest(BaseModel):
    family_id: str
    racket_id: str


class FamilyRacketBuyDefenceRequest(BaseModel):
    upgrade_id: str


class FamilyRacketBuyOffenceRequest(BaseModel):
    upgrade_id: str


class FamilyCrewOCSetFeeRequest(BaseModel):
    fee: int


class FamilyCrewOCSetAutoAcceptRequest(BaseModel):
    auto_accept: bool


class FamilyCrewOCApplyRequest(BaseModel):
    family_id: str


class FamilyProfileTextRequest(BaseModel):
    profile_text: Optional[str] = None
    notepad_color: Optional[str] = None


class FamilyAvatarRequest(BaseModel):
    avatar_data: Optional[str] = None  # custom emblem data URL
    preset_id: Optional[str] = None  # one of FAMILY_EMBLEM_PRESET_IDS
    clear: bool = False  # remove emblem (preset and custom)


class WarTruceRequest(BaseModel):
    war_id: str


class FamilyAirportCrewPerkRequest(BaseModel):
    airport_crew_perk: str  # none | travel_time | points_discount


# ============ Helpers ============
def _racket_income_and_cooldown(racket_id: str, level: int, ev: dict):
    r = next((x for x in FAMILY_RACKETS if x["id"] == racket_id), None)
    if not r or level <= 0:
        return 0, 0
    racket_index = next((i for i, row in enumerate(FAMILY_RACKETS) if row["id"] == racket_id), 0)
    max_position = max(1, len(FAMILY_RACKETS) * RACKET_MAX_LEVEL - 1)
    position = racket_index * RACKET_MAX_LEVEL + max(0, min(RACKET_MAX_LEVEL, int(level)) - 1)
    progression_mult = 2.0 + (2.0 * position / max_position)
    base_income = r["base_income"] * level * FAMILY_RACKET_BASE_INCOME_MULT * progression_mult
    cooldown = r["cooldown_hours"]
    payout_mult = ev.get("racket_payout", 1.0)
    cooldown_mult = ev.get("racket_cooldown", 1.0)
    return int(base_income * payout_mult), cooldown * cooldown_mult


def _racket_progression_multiplier(racket_id: str, level: int) -> float:
    if level <= 0:
        return 0.0
    racket_index = next((i for i, row in enumerate(FAMILY_RACKETS) if row["id"] == racket_id), 0)
    max_position = max(1, len(FAMILY_RACKETS) * RACKET_MAX_LEVEL - 1)
    position = racket_index * RACKET_MAX_LEVEL + max(0, min(RACKET_MAX_LEVEL, int(level)) - 1)
    return 2.0 + (2.0 * position / max_position)


def _active_family_event_multiplier(fam: dict, now: datetime) -> float:
    raw = (fam or {}).get("event_active_until")
    if not raw:
        return 1.0
    try:
        until = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        return 1.1 if until > now else 1.0
    except Exception:
        return 1.0


async def _racket_payout_breakdown(
    racket_id: str,
    level: int,
    last_collected_at: Optional[str],
    ev: dict,
    fam: dict,
    family_id: str,
    *,
    now: Optional[datetime] = None,
    actor: Optional[dict] = None,
) -> Dict[str, Any]:
    """Single source of truth for previews, collections, raid tills and auto-collect."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    income_after_global_event, cooldown_h = _racket_income_and_cooldown(racket_id, level, ev)
    war_seconds = 0.0
    if last_collected_at and family_id:
        try:
            last_dt = datetime.fromisoformat(str(last_collected_at).replace("Z", "+00:00"))
            war_seconds = await _family_war_duration_seconds(family_id, last_dt, now)
        except Exception:
            pass
    available = _racket_available_income(
        racket_id,
        level,
        last_collected_at,
        ev,
        now=now,
        war_duration_seconds=war_seconds,
    )
    war_bonus_pct = float((fam.get("racket_income_bonus_percent") or 0) or 0)
    perk_mods = await family_perk_modifiers(db, family_id)
    perk_bonus_pct = float(perk_mods.get("racket_bonus_percent") or 0)
    family_bonus_mult = 1.0 + (war_bonus_pct + perk_bonus_pct) / 100.0
    founding_mult = founding_member_income_mult(actor) if actor else 1.0
    family_event_mult = _active_family_event_multiplier(fam, now)
    final_income = int(income_after_global_event * family_bonus_mult * founding_mult * family_event_mult)
    return {
        "base_income": int(
            next((r["base_income"] for r in FAMILY_RACKETS if r["id"] == racket_id), 0)
            * max(0, level)
            * FAMILY_RACKET_BASE_INCOME_MULT
        ),
        "progression_multiplier": round(_racket_progression_multiplier(racket_id, level), 6),
        "global_event_multiplier": float(ev.get("racket_payout", 1.0) or 1.0),
        "income_after_global_event": income_after_global_event,
        "war_win_bonus_percent": war_bonus_pct,
        "perk_bonus_percent": perk_bonus_pct,
        "founding_member_multiplier": founding_mult,
        "family_event_multiplier": family_event_mult,
        "final_income": final_income,
        "available_income": final_income if available > 0 else 0,
        "cooldown_hours": cooldown_h,
        "war_paused_seconds": int(war_seconds),
    }


def _racket_defence_weight(upgrade_ids: Optional[List[str]]) -> int:
    total = 0
    for uid in upgrade_ids or []:
        row = _FAMILY_RACKET_DEFENCE_BY_ID.get(str(uid))
        if row:
            total += int(row.get("defence_weight") or 0)
    return total


def _racket_offence_weight(upgrade_ids: Optional[List[str]]) -> int:
    total = 0
    for uid in upgrade_ids or []:
        row = _FAMILY_RACKET_OFFENCE_BY_ID.get(str(uid))
        if row:
            total += int(row.get("offence_weight") or 0)
    return total


def _compute_racket_raid_success(level: int, offence_weight: int, defence_weight: int) -> float:
    base = FAMILY_RACKET_ATTACK_BASE_SUCCESS - level * FAMILY_RACKET_ATTACK_LEVEL_PENALTY
    offence_bonus = offence_weight * FAMILY_RACKET_OFFENCE_SUCCESS_PER_POINT
    defence_penalty = defence_weight * FAMILY_RACKET_DEFENCE_SUCCESS_PER_POINT
    return max(
        FAMILY_RACKET_ATTACK_MIN_SUCCESS,
        min(FAMILY_RACKET_ATTACK_MAX_SUCCESS, base + offence_bonus - defence_penalty),
    )


def _compute_racket_raid_take_mult(offence_weight: int) -> float:
    return 1.0 + offence_weight * FAMILY_RACKET_OFFENCE_TAKE_BONUS_PER_POINT


async def _racket_effective_till_amount(
    racket_id: str,
    level: int,
    last_collected_at: Optional[str],
    ev: dict,
    fam: dict,
    family_id: str,
    now=None,
) -> int:
    """Uncollected till using the shared payout rules (no collector-specific founding bonus)."""
    if now is None:
        now = datetime.now(timezone.utc)
    breakdown = await _racket_payout_breakdown(
        racket_id,
        level,
        last_collected_at,
        ev,
        fam,
        family_id,
        now=now,
    )
    return int(breakdown["available_income"])


# When a family wins a war (enemy wiped), winner gets this % extra on all racket income (passive, permanent stack).
WAR_WIN_RACKET_INCOME_BONUS_PERCENT = 2.5
# Cap: bonus from war wins cannot exceed this (anything after 25% is not added).
RACKET_INCOME_BONUS_CAP_PERCENT = 25.0


def _racket_available_income(racket_id: str, level: int, last_collected_at: Optional[str], ev: dict, now=None, war_duration_seconds: float = 0):
    """Income that would be collected now if the racket is off cooldown; 0 if on cooldown. war_duration_seconds extends the cooldown (rackets don't produce during war)."""
    if level <= 0:
        return 0
    income, cooldown_h = _racket_income_and_cooldown(racket_id, level, ev)
    if cooldown_h <= 0:
        return income
    if not last_collected_at:
        return income
    try:
        last_dt = datetime.fromisoformat(str(last_collected_at).replace("Z", "+00:00"))
        if now is None:
            now = datetime.now(timezone.utc)
        effective_cooldown_end = last_dt + timedelta(hours=cooldown_h) + timedelta(seconds=war_duration_seconds)
        if effective_cooldown_end <= now:
            return income
    except Exception:
        return income
    return 0


def compute_loser_racket_cash(rackets: dict, ev: dict, now=None, war_doc: Optional[dict] = None):
    """Sum of uncollected (available) income from all rackets. Used when awarding war winner. If war_doc provided, exclude war period (rackets don't produce during war)."""
    if now is None:
        now = datetime.now(timezone.utc)
    if war_doc:
        try:
            war_start = datetime.fromisoformat(str(war_doc.get("created_at") or "").replace("Z", "+00:00"))
        except Exception:
            war_start = None
        war_end_raw = war_doc.get("ended_at")
        war_end = now
        if war_end_raw:
            try:
                war_end = datetime.fromisoformat(str(war_end_raw).replace("Z", "+00:00"))
            except Exception:
                pass
    total = 0
    for racket_id, state in (rackets or {}).items():
        level = state.get("level", 0)
        if level <= 0:
            continue
        last_at = state.get("last_collected_at")
        racket_war_sec = 0.0
        if war_doc and war_start and last_at:
            try:
                last_dt = datetime.fromisoformat(str(last_at).replace("Z", "+00:00"))
                overlap_start = max(last_dt, war_start)
                overlap_end = min(now, war_end)
                if overlap_start < overlap_end:
                    racket_war_sec = (overlap_end - overlap_start).total_seconds()
            except Exception:
                pass
        total += _racket_available_income(racket_id, level, last_at, ev, now=now, war_duration_seconds=racket_war_sec)
    return total


async def compute_loser_racket_cash_effective(
    fam: dict,
    family_id: str,
    ev: dict,
    *,
    now: Optional[datetime] = None,
) -> int:
    """Wipe-transfer till value through the same modifiers used by raid previews."""
    now = now or datetime.now(timezone.utc)
    total = 0
    for racket_id, state in ((fam or {}).get("rackets") or {}).items():
        level = int((state or {}).get("level") or 0)
        if level <= 0:
            continue
        breakdown = await _racket_payout_breakdown(
            racket_id,
            level,
            (state or {}).get("last_collected_at"),
            ev,
            fam,
            family_id,
            now=now,
        )
        total += int(breakdown["available_income"])
    return total


def _racket_previous_id(racket_id: str):
    ids = [x["id"] for x in FAMILY_RACKETS]
    if racket_id not in ids:
        return None
    i = ids.index(racket_id)
    return ids[i - 1] if i > 0 else None


async def cleanup_dead_families():
    """Mark families where all members are dead as wiped (soft-delete); transfer assets to war winners.
    Returns True if any family was marked as wiped (caller should invalidate list cache)."""
    families = [
        family
        async for family in db.families.find(ACTIVE_FAMILY_FILTER, {"_id": 0})
    ]
    if not families:
        return False
    family_ids = [f["id"] for f in families]
    all_members = [
        member
        async for member in db.family_members.find(
            {"family_id": {"$in": family_ids}},
            {"_id": 0, "id": 1, "family_id": 1, "user_id": 1, "role": 1, "joined_at": 1},
        )
    ]
    members_by_family: dict = defaultdict(list)
    user_ids = set()
    for m in all_members:
        fid = m.get("family_id")
        uid = m.get("user_id")
        if fid and uid:
            members_by_family[fid].append(m)
            user_ids.add(uid)
    alive_by_user_id: dict = {}
    if user_ids:
        async for u in db.users.find(
            {"id": {"$in": list(user_ids)}},
            {"_id": 0, "id": 1, "is_dead": 1},
        ):
            uid = u.get("id")
            if uid:
                alive_by_user_id[uid] = not u.get("is_dead", False)
    marked_any = False
    for fam in families:
        family_id = fam["id"]
        members = members_by_family.get(family_id, [])
        living_count = sum(1 for m in members if alive_by_user_id.get(m["user_id"]))
        if living_count == 0:
            active_wars = await db.family_wars.find({
                "$or": [{"family_a_id": family_id}, {"family_b_id": family_id}],
                "status": {"$in": ["active", "truce_offered"]}
            }, {"_id": 0}).to_list(10)
            now_dt = datetime.now(timezone.utc)
            now = now_dt.isoformat()
            rackets = fam.get("rackets") or {}
            treasury = int(fam.get("treasury", 0) or 0)
            compound_cash = int(fam.get("compound_cash", 0) or 0)
            compound_points = int(fam.get("compound_points", 0) or 0)
            compound_loot_pieces = int(fam.get("compound_loot_pieces", 0) or 0)
            ev = await get_effective_event()
            prize_racket_cash = await compute_loser_racket_cash_effective(
                fam,
                family_id,
                ev,
                now=now_dt,
            )
            total_cash_prize = treasury + prize_racket_cash + compound_cash
            claimed_fam = await claim_family_wipe(
                family_id,
                wiped_at=now,
                member_rows=members,
            )
            if not claimed_fam:
                continue
            fam = claimed_fam
            assets_transferred = False
            winner_id = None
            winner_family_name = None
            winner_fam_doc = None
            # If all wars already ended (e.g. by kill path), get winner from most recent ended war
            if not active_wars:
                ended = await db.family_wars.find_one(
                    {"$or": [{"family_a_id": family_id}, {"family_b_id": family_id}], "status": {"$in": ["family_a_wins", "family_b_wins"]}},
                    {"_id": 0, "winner_family_id": 1, "winner_family_name": 1},
                    sort=[("ended_at", -1)],
                )
                if ended:
                    winner_id = ended.get("winner_family_id")
                    winner_family_name = (ended.get("winner_family_name") or "?").strip() or "?"
                    if winner_id:
                        winner_fam_doc = await db.families.find_one(
                            {"id": winner_id, **ACTIVE_FAMILY_FILTER},
                            {"_id": 0, "name": 1, "tag": 1},
                        )
                        if winner_fam_doc:
                            winner_family_name = (winner_fam_doc.get("name") or winner_fam_doc.get("tag") or winner_id).strip() or winner_id
            for active_war in active_wars:
                winner_id = active_war["family_b_id"] if active_war["family_a_id"] == family_id else active_war["family_a_id"]
                loser_id = family_id
                war_status = "family_a_wins" if winner_id == active_war["family_a_id"] else "family_b_wins"
                prize_treasury = 0
                prize_racket_cash_record = 0
                if not assets_transferred:
                    total_crew_bank = 0
                    winner_fam = await db.families.find_one(
                        {"id": winner_id, **ACTIVE_FAMILY_FILTER},
                        {"_id": 0, "treasury": 1, "racket_income_bonus_percent": 1, "boss_id": 1},
                    )
                    if winner_fam is not None:
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
                                    "loser_family_id": family_id,
                                    "loser_family_name": fam.get("name") or fam.get("tag"),
                                    "loser_treasury": treasury,
                                    "prize_racket_cash": prize_racket_cash,
                                },
                            )
                            prize_treasury = treasury
                            prize_racket_cash_record = prize_racket_cash
                        if compound_points > 0 or compound_loot_pieces > 0:
                            await db.families.update_one(
                                {"id": winner_id},
                                {"$inc": {"compound_points": compound_points, "compound_loot_pieces": compound_loot_pieces}},
                            )
                        current_bonus = float((winner_fam.get("racket_income_bonus_percent") or 0) or 0)
                        new_bonus = min(current_bonus + WAR_WIN_RACKET_INCOME_BONUS_PERCENT, RACKET_INCOME_BONUS_CAP_PERCENT)
                        await db.families.update_one(
                            {"id": winner_id},
                            {"$set": {"racket_income_bonus_percent": new_bonus}}
                        )
                        # Transfer crew bank from loser members to winner's boss
                        loser_member_ids = [m["user_id"] for m in members]
                        crew_profiles = await db.racing_profiles.find({"user_id": {"$in": loser_member_ids}}, {"_id": 0, "crew_bank": 1}).to_list(100)
                        total_crew_bank = sum(int((p.get("crew_bank") or 0)) for p in crew_profiles)
                        winner_boss_id = winner_fam.get("boss_id")
                        if total_crew_bank > 0 and winner_boss_id:
                            await db.racing_profiles.update_one(
                                {"user_id": winner_boss_id},
                                {"$inc": {"crew_bank": total_crew_bank}},
                                upsert=True,
                            )
                    msg = (
                        f"The enemy family {fam['name']} has been destroyed! You received ${total_cash_prize:,} (their treasury + racket cash + compound) and a permanent +{WAR_WIN_RACKET_INCOME_BONUS_PERCENT}% on all your racket income."
                    )
                    if total_crew_bank > 0:
                        msg += f" Crew bank seized: ${total_crew_bank:,}."
                    await send_notification_to_family(winner_id, "🏆 WAR VICTORY!", msg, "system")
                    assets_transferred = True
                winner_fam_doc = await db.families.find_one(
                    {"id": winner_id, **ACTIVE_FAMILY_FILTER},
                    {"_id": 0, "name": 1, "tag": 1},
                )
                winner_family_name = (winner_fam_doc or {}).get("name") or (winner_fam_doc or {}).get("tag") or winner_id
                loser_family_name = fam.get("name") or fam.get("tag") or loser_id
                await db.family_wars.update_one(
                    {"id": active_war["id"]},
                    {"$set": {
                        "status": war_status,
                        "winner_family_id": winner_id,
                        "loser_family_id": loser_id,
                        "winner_family_name": winner_family_name,
                        "loser_family_name": loser_family_name,
                        "ended_at": now,
                        "prize_rackets": None,
                        "prize_treasury": prize_treasury,
                        "prize_racket_cash": prize_racket_cash_record,
                        "prize_compound_cash": compound_cash,
                        "prize_compound_points": compound_points,
                        "prize_compound_loot_pieces": compound_loot_pieces,
                    }}
                )
            await clear_or_transfer_state_head_on_wipe(family_id, winner_id)
            # Keep family_members so wiped crew profile can show "In Memoriam" (all dead members)
            # Soft-delete: mark as wiped so crew profile still viewable (e.g. /game/family/:id)
            winner_name = (winner_fam_doc or {}).get("name") or (winner_fam_doc or {}).get("tag") or (winner_id or "?")
            await db.families.update_one(
                {"id": family_id},
                {
                    "$set": {
                        "wiped": True,
                        "wiped_at": now,
                        "wipe_settlement_completed_at": now,
                        "wiped_by_family_id": winner_id,
                        "wiped_by_family_name": winner_family_name,
                        "boss_id": None,
                        "head_of_state": None,
                        "rackets": {},
                        "treasury": 0,
                        "treasury_bullets": 0,
                        "treasury_points": 0,
                        "treasury_loot_pieces": 0,
                        "melt_treasury_pct": 0,
                        "melt_reward_tiers": [],
                        "compound_cash": 0,
                        "compound_points": 0,
                        "compound_loot_pieces": 0,
                        "compound_deposits_by_user": {},
                    },
                    "$unset": {"emblem_key": ""},
                },
            )
            marked_any = True

    return marked_any


async def run_family_wipe_cleanup_ticker() -> None:
    """Finalize dead-family wipes outside request/GET traffic."""
    while True:
        try:
            await cleanup_dead_families()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Family wipe cleanup ticker failed")
        await asyncio.sleep(30)


_family_raid_locks: Dict[tuple, asyncio.Lock] = {}
_family_raid_locks_guard = asyncio.Lock()


async def _get_family_raid_lock(attacker_family_id: str, target_family_id: str) -> asyncio.Lock:
    key = (attacker_family_id, target_family_id)
    async with _family_raid_locks_guard:
        if key not in _family_raid_locks:
            _family_raid_locks[key] = asyncio.Lock()
        return _family_raid_locks[key]


# ============ Vendetta / war stats helpers ============
def _norm_fid(fid):
    """Return a stripped non-empty string or None."""
    if fid is None:
        return None
    s = str(fid).strip()
    return s if s else None


async def _family_exists(family_id) -> bool:
    """True if an active families document exists for this id."""
    fid = _norm_fid(family_id)
    if not fid:
        return False
    return bool(await db.families.find_one({"id": fid, **ACTIVE_FAMILY_FILTER}, {"_id": 1}))


async def _active_family(family_id: Any, projection: Optional[dict] = None) -> Optional[dict]:
    """Load one live family. Historical memorials are deliberately excluded."""
    fid = _norm_fid(family_id)
    if not fid:
        return None
    return await db.families.find_one(
        {"id": fid, **ACTIVE_FAMILY_FILTER},
        projection or {"_id": 0},
    )


async def _build_memorial_roster(family_id: str, member_rows: Optional[list] = None) -> list:
    """Create the immutable roster embedded in a wiped family memorial."""
    rows = member_rows
    if rows is None:
        rows = await db.family_members.find(
            {"family_id": family_id},
            {"_id": 0},
        ).sort([("joined_at", 1), ("id", 1)]).to_list(500)
    user_map = await _users_map_by_ids(
        [r.get("user_id") for r in rows if r.get("user_id")],
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "rank": 1,
            "is_dead": 1,
            "dead_at": 1,
        },
    )
    snapshot = []
    seen = set()
    for row in rows:
        uid = _uid_str(row.get("user_id"))
        if not uid or uid in seen:
            continue
        seen.add(uid)
        user = user_map.get(uid) or {}
        role = str(row.get("role") or "associate").strip().lower()
        snapshot.append(
            {
                "user_id": uid,
                "username": (user.get("username") or "?").strip() or "?",
                "role": "boss" if role == "don" else role,
                "rank": int(user.get("rank") or 1),
                "is_dead": bool(user.get("is_dead")),
                "dead_at": user.get("dead_at"),
                "joined_at": row.get("joined_at"),
            }
        )
    return snapshot


async def claim_family_wipe(
    family_id: str,
    *,
    wiped_at: str,
    member_rows: Optional[list] = None,
) -> Optional[dict]:
    """Atomically claim wipe settlement, freeze its roster, and detach live identities.

    The returned document is the pre-wipe family state used to calculate settlement.
    A duplicate wipe path receives ``None`` and must not award assets again.
    """
    fid = _norm_fid(family_id)
    if not fid:
        return None
    memorial_roster = await _build_memorial_roster(fid, member_rows)
    claimed = await db.families.find_one_and_update(
        {"id": fid, **ACTIVE_FAMILY_FILTER},
        {
            "$set": {
                "wiped": True,
                "wiped_at": wiped_at,
                "wipe_settlement_started_at": wiped_at,
                "memorial_roster": memorial_roster,
            }
        },
        projection={"_id": 0},
        return_document=ReturnDocument.BEFORE,
    )
    if not claimed:
        return None
    member_ids = [r["user_id"] for r in memorial_roster if r.get("user_id")]
    if member_ids:
        for uid in member_ids:
            await db.users.update_one(
                {**_user_id_filter_for_users_collection(uid), "family_id": fid},
                {
                    "$set": {
                        "family_id": None,
                        "family_role": None,
                        **_family_melt_stats_reset_fields(),
                    }
                },
            )
            _invalidate_my_cache(uid)
    await db.family_members.delete_many({"family_id": fid})
    await db.family_join_applications.delete_many({"family_id": fid})
    await db.family_crew_oc_applications.delete_many({"family_id": fid})
    await db.properties.delete_many({"type": "family", "family_id": fid})
    _invalidate_list_cache()
    _invalidate_quicktrade_property_cache()
    return claimed


async def migrate_wiped_family_memorials() -> int:
    """Freeze legacy wiped rosters and remove their rows from live membership."""
    migrated = 0
    cursor = db.families.find(
        {"wiped": True, "memorial_roster": {"$exists": False}},
        {"_id": 0, "id": 1},
    )
    async for family in cursor:
        fid = _norm_fid(family.get("id"))
        if not fid:
            continue
        rows = await db.family_members.find({"family_id": fid}, {"_id": 0}).to_list(500)
        snapshot = await _build_memorial_roster(fid, rows)
        result = await db.families.update_one(
            {"id": fid, "wiped": True, "memorial_roster": {"$exists": False}},
            {"$set": {"memorial_roster": snapshot}},
        )
        if not result.modified_count:
            continue
        ids = [r["user_id"] for r in snapshot if r.get("user_id")]
        if ids:
            for uid in ids:
                await db.users.update_one(
                    {**_user_id_filter_for_users_collection(uid), "family_id": fid},
                    {
                        "$set": {
                            "family_id": None,
                            "family_role": None,
                            **_family_melt_stats_reset_fields(),
                        }
                    },
                )
                _invalidate_my_cache(uid)
        await db.family_members.delete_many({"family_id": fid})
        migrated += 1
    if migrated:
        _invalidate_list_cache()
    return migrated


async def resolve_family_id(user_id: str):
    """Resolve a user's family_id: users.family_id → family_members → families.boss_id.

    Verifies the family document still exists so a stale users.family_id does not
    block roster/boss fallbacks (common after wipe/delete or admin reassignment).
    """
    if not user_id:
        return None
    variants = _user_id_variants_for_family_members(user_id)
    u = await db.users.find_one(_user_id_filter_for_users_collection(user_id), {"_id": 0, "family_id": 1})
    fid = _norm_fid((u or {}).get("family_id"))
    if fid and await _family_exists(fid):
        return fid
    if variants:
        active_rows = await db.families.find(
            ACTIVE_FAMILY_FILTER,
            {"_id": 0, "id": 1},
        ).to_list(FAMILY_LIST_QUERY_LIMIT)
        active_ids = sorted(
            {_norm_fid(row.get("id")) for row in active_rows if _norm_fid(row.get("id"))}
        )
        m = await db.family_members.find_one(
            {"user_id": {"$in": variants}, "family_id": {"$in": active_ids}},
            {"_id": 0, "family_id": 1},
            sort=[("joined_at", -1), ("id", 1)],
        ) if active_ids else None
        fid = _norm_fid((m or {}).get("family_id"))
        if fid:
            return fid
        fam = await db.families.find_one(
            {"boss_id": {"$in": variants}, **ACTIVE_FAMILY_FILTER},
            {"_id": 0, "id": 1},
            sort=[("created_at", -1), ("id", 1)],
        )
        return _norm_fid((fam or {}).get("id"))
    return None


async def _batch_resolve_family_ids(user_ids: list) -> dict:
    """Map user_id -> family id (same rules as resolve_family_id, batched)."""
    out: dict = {}
    if not user_ids:
        return out
    user_ids = list(dict.fromkeys([u for u in user_ids if u]))
    active_docs = await db.families.find(ACTIVE_FAMILY_FILTER, {"_id": 0, "id": 1}).to_list(FAMILY_LIST_QUERY_LIMIT)
    active_ids = {_norm_fid(f.get("id")) for f in active_docs if _norm_fid(f.get("id"))}
    udocs = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "family_id": 1}).to_list(len(user_ids))
    seen = {u.get("id") for u in udocs}
    need_member = []
    for u in udocs:
        uid = u.get("id")
        if not uid:
            continue
        fid = _norm_fid(u.get("family_id"))
        if fid in active_ids:
            out[uid] = fid
        else:
            need_member.append(uid)
    for uid in user_ids:
        if uid not in seen:
            need_member.append(uid)
    need_member = list(dict.fromkeys([u for u in need_member if u not in out]))
    if need_member:
        mdocs = await db.family_members.find(
            {"user_id": {"$in": need_member}, "family_id": {"$in": list(active_ids)}},
            {"_id": 0, "user_id": 1, "family_id": 1, "joined_at": 1, "id": 1},
        ).sort([("joined_at", -1), ("id", 1)]).to_list(500)
        mby = {}
        for m in mdocs:
            mby.setdefault(m.get("user_id"), m)
        need_boss = []
        for uid in need_member:
            if uid in out:
                continue
            m = mby.get(uid)
            fid = _norm_fid((m or {}).get("family_id")) if m else None
            if fid in active_ids:
                out[uid] = fid
            else:
                need_boss.append(uid)
    else:
        need_boss = []
    if need_boss:
        fdocs = await db.families.find(
            {"boss_id": {"$in": need_boss}, **ACTIVE_FAMILY_FILTER},
            {"_id": 0, "id": 1, "boss_id": 1, "created_at": 1},
        ).sort([("created_at", -1), ("id", 1)]).to_list(50)
        for f in fdocs:
            bid = f.get("boss_id")
            if bid and bid not in out:
                out[bid] = _norm_fid(f.get("id"))
    return out


def _uid_str(uid) -> Optional[str]:
    """Normalize user ids for Mongo lookups (family_members.user_id vs users.id type mismatches)."""
    if uid is None:
        return None
    s = str(uid).strip()
    return s or None


def _user_id_variants_for_family_members(user_id: Any) -> list:
    """String/int variants for family_members.user_id (Mongo matches type strictly)."""
    out = []
    if user_id is None:
        return out
    s = _uid_str(user_id)
    if s:
        out.append(s)
    if isinstance(user_id, int):
        out.append(user_id)
    elif isinstance(user_id, str) and user_id.isdigit():
        try:
            out.append(int(user_id))
        except ValueError:
            pass
    return list(dict.fromkeys(out))


def _user_id_filter_for_users_collection(user_id: Any) -> dict:
    """Match users.id whether stored as string or int (Mongo matches type strictly)."""
    variants = _user_id_variants_for_family_members(user_id)
    if not variants:
        return {"id": "__no_such_user__"}
    if len(variants) == 1:
        return {"id": variants[0]}
    return {"id": {"$in": variants}}


async def _delete_family_memberships_for_user(user_id: Any) -> None:
    """Remove all family_members rows for this user (stale/orphan cleanup)."""
    variants = _user_id_variants_for_family_members(user_id)
    if not variants:
        return
    await db.family_members.delete_many({"user_id": {"$in": variants}})


def _user_belongs_on_family_roster(u: Optional[dict], family_id: str) -> bool:
    """True if this user should appear on the family's live roster (matches manual leave/kick clearing users.family_id)."""
    if not u:
        return False
    return _norm_fid(u.get("family_id")) == _norm_fid(family_id)


async def _include_family_roster_member(
    u: Optional[dict],
    family_id: str,
    member_user_id: Any,
) -> tuple[bool, Optional[dict], int]:
    """
    Decide whether a family_members row belongs on the live roster.

    Source of truth for "is in this crew" is the membership row. If users.family_id is
    null/stale/points at a deleted family, heal it. Only delete the membership row when
    the user clearly belongs to a different existing family (left/joined elsewhere).

    Returns (include, user_doc, deleted_membership_count).
    """
    if not u:
        return False, None, 0
    fid_crew = _norm_fid(family_id)
    if not fid_crew:
        return False, u, 0
    fid_user = _norm_fid(u.get("family_id"))
    if fid_user == fid_crew:
        return True, u, 0

    deleted = 0
    if fid_user and await _family_exists(fid_user):
        v = _user_id_variants_for_family_members(member_user_id)
        if v:
            r = await db.family_members.delete_many({"family_id": family_id, "user_id": {"$in": v}})
            deleted = int(r.deleted_count or 0)
        return False, u, deleted

    # Null family_id or pointer to a missing/wiped family — heal toward this membership.
    role = None
    variants = _user_id_variants_for_family_members(member_user_id)
    if variants:
        mrow = await db.family_members.find_one(
            {"family_id": family_id, "user_id": {"$in": variants}},
            {"_id": 0, "role": 1},
        )
        role = str((mrow or {}).get("role") or "").strip().lower() or None
        if role == "don":
            role = "boss"
    set_doc = {"family_id": fid_crew}
    if role:
        set_doc["family_role"] = role
    await db.users.update_one(_user_id_filter_for_users_collection(member_user_id), {"$set": set_doc})
    u = {**u, **set_doc}
    return True, u, 0


async def _users_map_by_ids(user_ids: list, projection: Optional[dict] = None) -> dict:
    """Return dict id -> user doc for non-empty unique ids (keys are normalized string ids)."""
    if not user_ids:
        return {}
    uids = list(dict.fromkeys([s for u in user_ids if (s := _uid_str(u))]))
    proj = projection or {
        "_id": 0,
        "id": 1,
        "username": 1,
        "rank": 1,
        "family_id": 1,
        "is_dead": 1,
        "dead_at": 1,
        "bullets_melted": 1,
        "family_bullets_melted": 1,
        "family_melt_reward_money_earned": 1,
        "family_melt_reward_hits": 1,
    }
    # Match users.id whether stored as string or legacy int (Mongo $in is strict on type)
    or_clauses = []
    seen = set()
    for uid in uids:
        or_clauses.append({"id": uid})
        seen.add(uid)
        if uid.isdigit():
            try:
                n = int(uid)
                key = f"int:{n}"
                if key not in seen:
                    seen.add(key)
                    or_clauses.append({"id": n})
            except ValueError:
                pass
    docs = await db.users.find({"$or": or_clauses}, proj).to_list(max(500, len(or_clauses) + 50)) if or_clauses else []
    out = {}
    for d in docs:
        k = _uid_str(d.get("id"))
        if k:
            out[k] = d
    return out


def _owner_id_or_clauses_for_uids(uids: list) -> list:
    """Mongo $or clauses for owner_id matching string/int user ids."""
    or_clauses = []
    seen = set()
    for uid in uids:
        s = _uid_str(uid)
        if not s:
            continue
        or_clauses.append({"owner_id": s})
        seen.add(s)
        if s.isdigit():
            try:
                n = int(s)
                key = f"int:{n}"
                if key not in seen:
                    seen.add(key)
                    or_clauses.append({"owner_id": n})
            except ValueError:
                pass
    return or_clauses


async def top3_user_ids(family_id: str) -> List[str]:
    """User ids for boss/don, underboss, consigliere in this family (plus families.boss_id as Don fallback)."""
    if not (family_id or "").strip():
        return []
    members = await db.family_members.find(
        {"family_id": family_id, "role": {"$in": list(TOP3_FAMILY_ROLES)}},
        {"_id": 0, "user_id": 1},
    ).to_list(20)
    out: List[str] = []
    seen = set()
    for m in members:
        uid = _uid_str(m.get("user_id"))
        if uid and uid not in seen:
            seen.add(uid)
            out.append(uid)
    # Don may own airport/armoury while missing or mis-keyed on family_members; bonuses + cron use this list.
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "boss_id": 1})
    bid = _uid_str((fam or {}).get("boss_id"))
    if bid and bid not in seen:
        seen.add(bid)
        out.append(bid)
    return out


async def any_top3_owns_airport(family_id: str) -> bool:
    uids = await top3_user_ids(family_id)
    oc = _owner_id_or_clauses_for_uids(uids)
    if not oc:
        return False
    doc = await db.airport_ownership.find_one({"$or": oc}, {"_id": 1})
    return doc is not None


async def any_top3_owns_bullet_factory(family_id: str) -> bool:
    uids = await top3_user_ids(family_id)
    oc = _owner_id_or_clauses_for_uids(uids)
    if not oc:
        return False
    doc = await db.bullet_factory.find_one({"$or": oc}, {"_id": 1})
    return doc is not None


# Casinos: collection name -> display label (ownership docs use owner_id, city, state)
CASINO_OWNERSHIP_COLLECTIONS = (
    ("Dice", "dice_ownership"),
    ("Roulette", "roulette_ownership"),
    ("Blackjack", "blackjack_ownership"),
    *([("Slots", "slots_ownership")] if _SLOTS_FEATURE_ENABLED else []),
    ("Video Poker", "videopoker_ownership"),
    ("Horse Racing", "horseracing_ownership"),
)


async def all_family_member_uids(family_id: str, fam_doc: Optional[dict] = None) -> List[str]:
    """All living member user ids (family_members + boss_id if missing from list)."""
    if not (family_id or "").strip():
        return []
    members = await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(200)
    out: List[str] = []
    seen = set()
    for m in members:
        uid = _uid_str(m.get("user_id"))
        if uid and uid not in seen:
            seen.add(uid)
            out.append(uid)
    bid = _uid_str((fam_doc or {}).get("boss_id"))
    if not bid and fam_doc is None:
        fam = await db.families.find_one({"id": family_id}, {"_id": 0, "boss_id": 1})
        bid = _uid_str((fam or {}).get("boss_id"))
    if bid and bid not in seen:
        out.append(bid)
    return out


async def family_property_holdings_summary(family_id: str, fam_doc: dict) -> dict:
    """Properties owned by any crew member: airports, armouries, casinos."""
    uids = await all_family_member_uids(family_id, fam_doc)
    oc = _owner_id_or_clauses_for_uids(uids)
    airports: List[dict] = []
    armouries: List[dict] = []
    casinos: List[dict] = []
    if not oc:
        return {"airports": airports, "armouries": armouries, "casinos": casinos}
    q = {"$or": oc}
    async for doc in db.airport_ownership.find(q, {"_id": 0, "state": 1, "slot": 1, "owner_username": 1}):
        airports.append({
            "state": doc.get("state"),
            "slot": doc.get("slot"),
            "owner_username": (doc.get("owner_username") or "—").strip() or "—",
        })
    async for doc in db.bullet_factory.find(q, {"_id": 0, "state": 1, "owner_username": 1, "owner_id": 1}):
        if not doc.get("owner_id"):
            continue
        armouries.append({
            "state": doc.get("state"),
            "owner_username": (doc.get("owner_username") or "—").strip() or "—",
        })
    for label, coll in CASINO_OWNERSHIP_COLLECTIONS:
        try:
            if coll == "slots_ownership":
                # One active slots row per owner; ignore expired; if DB has duplicates, keep latest expires_at
                from routers.casinos.slots import _is_slots_ownership_expired

                best_by_owner: Dict[str, dict] = {}
                async for doc in db[coll].find(
                    q,
                    {"_id": 0, "city": 1, "state": 1, "owner_username": 1, "owner_id": 1, "expires_at": 1},
                ):
                    if doc.get("owner_id") is None:
                        continue
                    if _is_slots_ownership_expired(doc):
                        continue
                    oid = str(doc.get("owner_id"))
                    prev = best_by_owner.get(oid)
                    if prev is None or (doc.get("expires_at") or "") > (prev.get("expires_at") or ""):
                        best_by_owner[oid] = doc
                for doc in best_by_owner.values():
                    city = (doc.get("city") or doc.get("state") or "—")
                    casinos.append({
                        "game": label,
                        "city": str(city).strip() or "—",
                        "state": doc.get("state"),
                        "owner_username": (doc.get("owner_username") or "—").strip() or "—",
                    })
                continue
            async for doc in db[coll].find(q, {"_id": 0, "city": 1, "state": 1, "owner_username": 1, "owner_id": 1}):
                if doc.get("owner_id") is None:
                    continue
                city = (doc.get("city") or doc.get("state") or "—")
                casinos.append({
                    "game": label,
                    "city": str(city).strip() or "—",
                    "state": doc.get("state"),
                    "owner_username": (doc.get("owner_username") or "—").strip() or "—",
                })
        except Exception:
            logger.exception("family_property_holdings_summary casino %s", coll)
    return {"airports": airports, "armouries": armouries, "casinos": casinos}


async def family_crew_bonuses_summary(family_id: str, fam_doc: dict) -> dict:
    """Vault + travel perks tied to high command properties (public-safe copy)."""
    perk = (fam_doc.get("airport_crew_perk") or AIRPORT_CREW_PERK_NONE)
    top_uids_list = await top3_user_ids(family_id)
    top_cmd = frozenset(top_uids_list)
    oc_top = _owner_id_or_clauses_for_uids(top_uids_list)
    top3_air = bool(oc_top) and (await db.airport_ownership.find_one({"$or": oc_top}, {"_id": 1})) is not None
    top3_bf = bool(oc_top) and (await db.bullet_factory.find_one({"$or": oc_top}, {"_id": 1})) is not None
    n_hourly_sources = int(bool(top3_air)) + int(bool(top3_bf))
    treasury_hourly_active = n_hourly_sources > 0
    perk_active = perk in (AIRPORT_CREW_PERK_TRAVEL_TIME, AIRPORT_CREW_PERK_POINTS_DISCOUNT) and top3_air
    pts_pct = 0
    travel_red_s = 0
    if perk_active:
        if perk == AIRPORT_CREW_PERK_POINTS_DISCOUNT:
            pts_pct = 10
        else:
            travel_red_s = 1
    bonus_warnings: List[str] = []
    all_member_uids = await all_family_member_uids(family_id, fam_doc)
    oc_all = _owner_id_or_clauses_for_uids(all_member_uids)
    if oc_all:
        warned_bf: set[str] = set()
        async for doc in db.bullet_factory.find({"$or": oc_all}, {"_id": 0, "state": 1, "owner_id": 1}):
            oid = _uid_str(doc.get("owner_id"))
            if not oid or oid in top_cmd:
                continue
            st = (doc.get("state") or "?").strip() or "?"
            key = f"bf:{st}:{oid}"
            if key in warned_bf:
                continue
            warned_bf.add(key)
            bonus_warnings.append(
                f"Armoury ({st}) is owned by a crew member who is not Don, Underboss, or Consigliere — "
                "that location does not add the hourly vault bullet bonus. Transfer the armoury or promote them to high command."
            )
        warned_ap: set[str] = set()
        async for doc in db.airport_ownership.find({"$or": oc_all}, {"_id": 0, "state": 1, "slot": 1, "owner_id": 1}):
            oid = _uid_str(doc.get("owner_id"))
            if not oid or oid in top_cmd:
                continue
            st = (doc.get("state") or "?").strip() or "?"
            slot = doc.get("slot")
            slot_label = ""
            if slot is not None:
                try:
                    slot_label = f" #{int(slot)}"
                except (TypeError, ValueError):
                    slot_label = f" ({slot})"
            key = f"ap:{st}:{slot!s}:{oid}"
            if key in warned_ap:
                continue
            warned_ap.add(key)
            bonus_warnings.append(
                f"Airport ({st}{slot_label}) is owned by a crew member who is not Don, Underboss, or Consigliere — "
                "that slot does not add the hourly vault bullet bonus or activate the Don airport crew perk until high command holds it."
            )
    lines: List[str] = []
    _tb_suffix = " Credited each UTC hour to the crew bullet treasury (Vault tab), not vault cash."
    if treasury_hourly_active:
        if top3_air and top3_bf:
            lines.append(
                "Family bullet treasury earns 100–200 random bullets per hour from the crew airport and another 100–200 per hour from the crew armoury "
                "when Don, Underboss, or Consigliere owns each (both bonuses stack)."
                + _tb_suffix
            )
        elif top3_air:
            lines.append(
                "Family bullet treasury earns 100–200 random bullets per hour while Don, Underboss, or Consigliere owns the crew airport."
                + _tb_suffix
            )
        else:
            lines.append(
                "Family bullet treasury earns 100–200 random bullets per hour while Don, Underboss, or Consigliere owns the crew armoury."
                + _tb_suffix
            )
    if perk_active:
        if pts_pct:
            lines.append("Airport crew: 10% off airport points for all members (Don's perk, high command owns the airport).")
        else:
            lines.append("Airport crew: -1 second airport travel time for all members when flights use a timer (Don's perk).")
    elif perk != AIRPORT_CREW_PERK_NONE and not top3_air:
        lines.append("Airport crew perk is selected but inactive until Don, Underboss, or Consigliere owns an airport.")
    return {
        "treasury_bullets_hourly": {
            "active": treasury_hourly_active,
            "min": 100 * n_hourly_sources,
            "max": 200 * n_hourly_sources,
            "label": "Hourly vault bullets",
        },
        "airport_crew_perk": {
            "selected": perk,
            "active": perk_active,
            "points_discount_percent": pts_pct,
            "travel_time_reduction_seconds": travel_red_s,
        },
        "major_property_conflict": False,
        "bonus_warnings": bonus_warnings,
        "summary_lines": lines,
    }


async def family_airport_crew_perk_context(current_user: dict) -> dict:
    """
    Airport crew perk for travel UI/charges: −1s travel OR 10% points off for all members when
    high command owns an airport and family has chosen a perk (exclusive perk modes).
    Returns: family_airport_points_discount (bool), family_airport_travel_reduction_seconds (int).
    """
    uid = current_user.get("id")
    if uid is None:
        return {"family_airport_points_discount": False, "family_airport_travel_reduction_seconds": 0}
    fid = await resolve_family_id(str(uid))
    if not fid:
        return {"family_airport_points_discount": False, "family_airport_travel_reduction_seconds": 0}
    fam = await db.families.find_one({"id": fid}, {"_id": 0, "airport_crew_perk": 1, "boss_id": 1})
    perk = (fam or {}).get("airport_crew_perk") or AIRPORT_CREW_PERK_NONE
    if perk not in (AIRPORT_CREW_PERK_TRAVEL_TIME, AIRPORT_CREW_PERK_POINTS_DISCOUNT):
        return {"family_airport_points_discount": False, "family_airport_travel_reduction_seconds": 0}
    if not await any_top3_owns_airport(fid):
        return {"family_airport_points_discount": False, "family_airport_travel_reduction_seconds": 0}
    if perk == AIRPORT_CREW_PERK_POINTS_DISCOUNT:
        return {"family_airport_points_discount": True, "family_airport_travel_reduction_seconds": 0}
    return {"family_airport_points_discount": False, "family_airport_travel_reduction_seconds": 1}


_cron_secret_cached: Optional[str] = None


def _cron_secret() -> str:
    global _cron_secret_cached
    if _cron_secret_cached is None:
        _cron_secret_cached = (os.environ.get("CRON_SECRET") or "").strip()
    return _cron_secret_cached


async def verify_cron_secret_families(x_cron_secret: Optional[str] = Header(None, alias="X-Cron-Secret")):
    sec = _cron_secret()
    if not sec:
        raise HTTPException(status_code=503, detail="Cron not configured (CRON_SECRET unset)")
    if (x_cron_secret or "").strip() != sec:
        raise HTTPException(status_code=403, detail="Invalid cron secret")


async def run_family_treasury_bullets_hourly_tick() -> dict:
    """Credit each qualifying family once per UTC hour bucket into ``treasury_bullets`` (not cash ``treasury``).
    Safe to call every ~60s; idempotent per family per hour via ``last_treasury_bullet_hour_utc``."""
    now = datetime.now(timezone.utc)
    hour_bucket = now.strftime("%Y-%m-%dT%H")
    families = await db.families.find(
        {"wiped": {"$ne": True}},
        {"_id": 0, "id": 1},
    ).to_list(FAMILY_LIST_QUERY_LIMIT)
    credited = 0
    for fam in families:
        fid = fam.get("id")
        if not fid:
            continue
        top3_air = await any_top3_owns_airport(fid)
        top3_bf = await any_top3_owns_bullet_factory(fid)
        if not top3_air and not top3_bf:
            continue
        amount = 0
        if top3_air:
            amount += _rng.randint(100, 200)
        if top3_bf:
            amount += _rng.randint(100, 200)
        if amount <= 0:
            continue
        res = await db.families.update_one(
            {
                "id": fid,
                "wiped": {"$ne": True},
                "$or": [
                    {"last_treasury_bullet_hour_utc": {"$ne": hour_bucket}},
                    {"last_treasury_bullet_hour_utc": None},
                    {"last_treasury_bullet_hour_utc": {"$exists": False}},
                ],
            },
            {"$inc": {"treasury_bullets": amount}, "$set": {"last_treasury_bullet_hour_utc": hour_bucket}},
        )
        if res.modified_count:
            credited += 1
            await log_family_vault_tx(
                db,
                fid,
                "hourly_bullets_bonus",
                "",
                "System",
                bullets_delta=amount,
                meta={"hour_utc": hour_bucket, "airport": top3_air, "armoury": top3_bf},
            )
    return {"ok": True, "hour_utc": hour_bucket, "families_credited": credited}


async def families_cron_treasury_bullets_hourly(_: None = Depends(verify_cron_secret_families)):
    """Hourly: high command airport and/or armoury each grant 100–200 treasury bullets (stacked when both)."""
    return await run_family_treasury_bullets_hourly_tick()


async def run_family_treasury_bullets_hourly_ticker():
    """Background loop (~60s + jitter). Prefer cron-only in multi-worker (FAMILY_TREASURY_BULLETS_HOURLY_USE_CRON=1)."""
    while True:
        try:
            await run_family_treasury_bullets_hourly_tick()
        except Exception:
            logger.exception("family treasury bullets hourly ticker tick failed")
        await asyncio.sleep(60 + _rng.random() * 15)


async def families_set_airport_crew_perk(
    request: FamilyAirportCrewPerkRequest,
    current_user: dict = Depends(get_current_user),
):
    perk = (request.airport_crew_perk or "").strip().lower()
    if perk not in AIRPORT_CREW_PERK_VALUES:
        raise HTTPException(status_code=400, detail="Invalid airport_crew_perk")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    role = (current_user.get("family_role") or "").strip().lower()
    if role not in ("boss", "don"):
        raise HTTPException(status_code=403, detail="Only the Don can set the airport crew perk")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.families.update_one(
        {"id": family_id},
        {"$set": {"airport_crew_perk": perk, "airport_crew_perk_set_at": now_iso}},
    )
    _invalidate_my_cache(current_user["id"])
    _invalidate_list_cache()
    try:
        from routers.admin.airport import invalidate_travel_info_cache_for_family

        await invalidate_travel_info_cache_for_family(family_id)
    except Exception:
        logger.exception("invalidate_travel_info_cache_for_family failed")
    return {"ok": True, "airport_crew_perk": perk, "airport_crew_perk_set_at": now_iso}


async def family_qualifies_for_state_head(family_id: str) -> bool:
    """True if the family's boss has prestige_level >= 1."""
    if not (family_id or "").strip():
        return False
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "boss_id": 1})
    if not fam or not (fam.get("boss_id") or "").strip():
        return False
    boss = await db.users.find_one(
        {"id": fam["boss_id"], "is_dead": {"$ne": True}},
        {"_id": 0, "prestige_level": 1},
    )
    if not boss:
        return False
    return int(boss.get("prestige_level") or 0) >= 1


# Promotion order when boss dies: next in line becomes boss, others shift up
PROMOTION_ORDER = ["underboss", "consigliere", "capo", "soldier", "associate"]
ASSIGNMENT_SEQUENCE = ["boss", "underboss", "consigliere"] + ["capo"] * 4 + ["soldier"] * 15 + ["associate"] * 30


async def maybe_promote_after_boss_death(dead_user_id: str) -> None:
    """If dead_user_id was the boss of a family, promote the next in line (underboss -> boss, etc.)."""
    fam = await db.families.find_one({"boss_id": dead_user_id}, {"_id": 0, "id": 1, "name": 1})
    if not fam:
        return
    family_id = fam["id"]
    members = await db.family_members.find(
        {"family_id": family_id},
        {"_id": 0, "user_id": 1, "role": 1},
    ).to_list(100)
    if not members:
        return
    member_by_uid = {m["user_id"]: m for m in members}
    alive_user_ids = [
        m["user_id"]
        for m in members
        if m["user_id"] != dead_user_id
    ]
    if not alive_user_ids:
        return
    alive_users = await db.users.find(
        {"id": {"$in": alive_user_ids}, "is_dead": {"$ne": True}},
        {"_id": 0, "id": 1},
    ).to_list(len(alive_user_ids))
    alive_ids = {u["id"] for u in alive_users}
    alive_members = [m for m in members if m["user_id"] in alive_ids]
    if not alive_members:
        return
    # Sort by role seniority (underboss first, then consigliere, capo, soldier, associate)
    def sort_key(m):
        role = (m.get("role") or "").strip().lower()
        return (PROMOTION_ORDER.index(role) if role in PROMOTION_ORDER else 99, m["user_id"])
    alive_members.sort(key=sort_key)
    # Assign roles in order: first -> boss, second -> underboss, third -> consigliere, then capos, soldiers, associates
    role_assignments = []
    for i, m in enumerate(alive_members):
        role_assignments.append((m["user_id"], ASSIGNMENT_SEQUENCE[i] if i < len(ASSIGNMENT_SEQUENCE) else "associate"))
    new_boss_id = role_assignments[0][0]
    await db.families.update_one({"id": family_id}, {"$set": {"boss_id": new_boss_id}})
    for user_id, new_role in role_assignments:
        await db.family_members.update_one(
            {"family_id": family_id, "user_id": user_id},
            {"$set": {"role": new_role}},
        )
        await db.users.update_one({"id": user_id}, {"$set": {"family_role": new_role}})
        _invalidate_my_cache(user_id)
    _list_cache = None
    logger.info("Family %s: promoted %s to boss after previous boss died.", family_id, new_boss_id)


# ============ Cache helpers ============
def _invalidate_list_cache():
    global _list_cache
    _list_cache = None


def _invalidate_my_cache(user_id: str):
    _my_cache.pop(user_id, None)


# ============ Routes ============
async def families_list(current_user: dict = Depends(get_current_user)):
    # No in-memory cache: multi-worker setups would show stale data (e.g. deleted families) until TTL
    cursor = db.families.find(
        ACTIVE_FAMILY_FILTER,
        {
            "_id": 0, "id": 1, "name": 1, "tag": 1, "treasury": 1, "join_mode": 1, "crew_oc_cooldown_until": 1,
            "emblem_preset_id": 1, "avatar_url": 1,
        },
    )
    fams = await cursor.to_list(FAMILY_LIST_QUERY_LIMIT)
    out = []
    if fams:
        family_ids = [f["id"] for f in fams]
        # Batched queries: avoid 1 + N families + N*M users round-trips (was killing small Mongo tiers)
        all_members = await db.family_members.find(
            {"family_id": {"$in": family_ids}},
            {"_id": 0, "family_id": 1, "user_id": 1},
        ).to_list(max(5000, FAMILY_LIST_QUERY_LIMIT * 40))
        members_by_family: dict = defaultdict(list)
        user_ids = set()
        for m in all_members:
            fid = m.get("family_id")
            uid = m.get("user_id")
            if fid and uid:
                members_by_family[fid].append(uid)
                user_ids.add(uid)
        alive_by_user_id: dict = {}
        if user_ids:
            users_by_id = await _users_map_by_ids(
                list(user_ids),
                projection={"_id": 0, "id": 1, "is_dead": 1},
            )
            for uid_s, u in users_by_id.items():
                alive_by_user_id[uid_s] = not u.get("is_dead", False)
        for f in fams:
            fid = f["id"]
            living_count = sum(
                1
                for uid in members_by_family.get(fid, ())
                if alive_by_user_id.get(_uid_str(uid))
            )
            if living_count > 0:
                out.append({
                    "id": fid, "name": f["name"], "tag": f["tag"],
                    "member_count": living_count, "treasury": f.get("treasury", 0),
                    "at_war": False,
                    "join_mode": f.get("join_mode") or "open",
                    "crew_oc_cooldown_until": f.get("crew_oc_cooldown_until"),
                    "emblem_preset_id": f.get("emblem_preset_id"),
                    "avatar_url": f.get("avatar_url"),
                })
    # Tag families that are currently in an active war
    active_wars = await db.family_wars.find(
        {"status": {"$in": ["active", "truce_offered"]}},
        {"_id": 0, "family_a_id": 1, "family_b_id": 1},
    ).to_list(50)
    at_war_fids = set()
    for w in active_wars:
        a = _norm_fid(w.get("family_a_id"))
        b = _norm_fid(w.get("family_b_id"))
        if a:
            at_war_fids.add(a)
        if b:
            at_war_fids.add(b)
    for f in out:
        fid = _norm_fid(f.get("id"))
        if fid and fid in at_war_fids:
            f["at_war"] = True
    return out


async def families_config(current_user: dict = Depends(get_current_user)):
    global _config_cache
    if _config_cache is None:
        _config_cache = {
            "family_create_cost": FAMILY_CREATE_COST,
            "roles": FAMILY_ROLES,
            "ranks": RANKS,
            "racket_max_level": RACKET_MAX_LEVEL,
            "rackets": FAMILY_RACKETS,
            "racket_upgrade_cost": RACKET_UPGRADE_COST,
            "racket_unlock_cost": RACKET_UNLOCK_COST,
            "family_melt_treasury_pct_max": FAMILY_MELT_TREASURY_PCT_MAX,
            "family_melt_reward_threshold_step": FAMILY_MELT_REWARD_THRESHOLD_STEP,
        }
    toward_cap = await count_families_toward_player_cap()
    return {
        **_config_cache,
        "max_families": MAX_FAMILIES,
        "player_cap_families_count": toward_cap,
        "emblem_presets": FAMILY_EMBLEM_PRESETS_PUBLIC,
    }


async def families_my(current_user: dict = Depends(get_current_user)):
    uid = current_user["id"]
    now_ts = time.monotonic()
    entry = _my_cache.get(uid)
    if entry is not None and entry[1] > now_ts:
        return entry[0]
    family_id, ctx_role = await _current_family_context(current_user)
    if not family_id:
        return {"family": None, "members": [], "rackets": [], "my_role": None, "quicktrade_family_listing_id": None}
    # Heal stale token family_id so later requests match live membership
    if _norm_fid(current_user.get("family_id")) != family_id:
        heal_set = {"family_id": family_id}
        if ctx_role:
            heal_set["family_role"] = ctx_role
        await db.users.update_one(
            _user_id_filter_for_users_collection(uid),
            {"$set": heal_set},
        )
        current_user["family_id"] = family_id
        if ctx_role:
            current_user["family_role"] = ctx_role
    fam = await _active_family(family_id)
    if not fam:
        await db.users.update_one(
            _user_id_filter_for_users_collection(current_user["id"]),
            {"$set": {"family_id": None, "family_role": None, **_family_melt_stats_reset_fields()}},
        )
        return {"family": None, "members": [], "rackets": [], "my_role": None, "quicktrade_family_listing_id": None}
    members_docs = await db.family_members.find({"family_id": family_id}, {"_id": 0}).to_list(200)
    my_role = ctx_role or current_user.get("family_role")
    my_member = next(
        (m for m in members_docs if _uid_str(m.get("user_id")) == _uid_str(current_user["id"])),
        None,
    )
    if my_member and my_member.get("role"):
        my_role = str(my_member["role"]).strip().lower() or my_role
        if my_role == "don":
            my_role = "boss"
        if my_role and current_user.get("family_role") != my_role:
            await db.users.update_one(
                _user_id_filter_for_users_collection(current_user["id"]),
                {"$set": {"family_role": my_role}},
            )
    if my_role:
        my_role = str(my_role).strip().lower()
        if my_role == "don":
            my_role = "boss"
    ev = await get_effective_event()
    member_uids = [m["user_id"] for m in members_docs if m.get("user_id")]
    users_by_id = await _users_map_by_ids(member_uids)
    members = []
    fallen = []
    stale_member_rows_removed = 0
    for m in members_docs:
        u = users_by_id.get(_uid_str(m["user_id"]))
        include, u, deleted = await _include_family_roster_member(u, family_id, m.get("user_id"))
        stale_member_rows_removed += deleted
        if not include:
            continue
        rank_name = "—"
        if u:
            rid = u.get("rank", 1)
            rn = next((x["name"] for x in RANKS if x.get("id") == rid), str(rid))
            rank_name = rn
        entry = {
            "user_id": m["user_id"],
            "username": (u or {}).get("username", "?"),
            "role": str(m.get("role", "")).strip().lower() or "associate",
            "rank_name": rank_name,
            "bullets_melted": int((u or {}).get("bullets_melted") or 0),
            "family_bullets_melted": int((u or {}).get("family_bullets_melted") or 0),
            "family_melt_reward_money_earned": int((u or {}).get("family_melt_reward_money_earned") or 0),
            "family_melt_reward_hits": int((u or {}).get("family_melt_reward_hits") or 0),
        }
        if (u or {}).get("is_dead"):
            entry["dead_at"] = (u or {}).get("dead_at")
            fallen.append(entry)
        else:
            members.append(entry)
    if stale_member_rows_removed:
        _invalidate_list_cache()
    rackets_raw = fam.get("rackets") or {}
    staff_debug = _is_admin(current_user)
    racket_bonus_pct = float((fam.get("racket_income_bonus_percent") or 0) or 0)
    rpm = await family_perk_modifiers(db, family_id)
    perk_racket_pct = float(rpm.get("racket_bonus_percent") or 0)
    total_bonus_pct = racket_bonus_pct + perk_racket_pct
    offence_upgrades = list(fam.get("racket_offence_upgrades") or [])
    offence_weight = _racket_offence_weight(offence_upgrades)
    rackets = []
    now = datetime.now(timezone.utc)
    racket_ids_ordered = [x["id"] for x in FAMILY_RACKETS]
    for idx, r in enumerate(FAMILY_RACKETS):
        try:
            rid = r["id"]
            state = rackets_raw.get(rid) or {}
            level = int(state.get("level", 0) or 0)
            locked = level <= 0
            prev_id = racket_ids_ordered[idx - 1] if idx > 0 else None
            required_racket_name = None
            can_unlock = False
            if locked and prev_id:
                required_racket_name = next((x["name"] for x in FAMILY_RACKETS if x["id"] == prev_id), prev_id)
                prev_level = int((rackets_raw.get(prev_id) or {}).get("level", 0) or 0)
                can_unlock = prev_level >= RACKET_MAX_LEVEL
            elif locked and idx == 0:
                can_unlock = True
            last_at = state.get("last_collected_at")
            payout_breakdown = await _racket_payout_breakdown(
                rid,
                level,
                last_at,
                ev,
                fam,
                family_id,
                now=now,
                actor=current_user,
            )
            income_per = int(payout_breakdown["income_after_global_event"])
            cooldown_h = float(payout_breakdown["cooldown_hours"])
            effective_income = int(payout_breakdown["final_income"])
            till_available = int(payout_breakdown["available_income"]) if level > 0 else 0
            till_at_risk = till_available if till_available > 0 else 0
            defence_upgrades = list(state.get("defence_upgrades") or [])
            defence_weight = _racket_defence_weight(defence_upgrades)
            next_collect_at = None
            if last_at and level > 0 and cooldown_h > 0:
                try:
                    last_dt = datetime.fromisoformat(str(last_at).replace("Z", "+00:00"))
                    war_sec = await _family_war_duration_seconds(family_id, last_dt, now)
                    next_dt = last_dt + timedelta(hours=cooldown_h) + timedelta(seconds=war_sec)
                    next_collect_at = next_dt.isoformat() if next_dt > now else None
                except Exception:
                    next_collect_at = None
            if next_collect_at is None and level > 0:
                next_collect_at = now.isoformat()
            rackets.append({
                "id": rid, "name": r["name"], "description": r.get("description", ""),
                "level": level, "locked": locked, "required_racket_name": required_racket_name, "can_unlock": can_unlock,
                "unlock_cost": RACKET_UNLOCK_COST if locked else None,
                "cooldown_hours": r["cooldown_hours"], "effective_cooldown_hours": cooldown_h,
                "income_per_collect": income_per, "effective_income_per_collect": effective_income,
                "payout_breakdown": payout_breakdown,
                "till_available": till_available, "till_at_risk": till_at_risk,
                "defence_upgrades": defence_upgrades, "defence_weight": defence_weight,
                "next_collect_at": next_collect_at,
                "debug_last_collected_at": last_at if staff_debug else None,
                "debug_next_collect_at": next_collect_at if staff_debug else None,
            })
        except Exception:
            continue
    crew_oc_applications = []
    if family_id:
        app_cursor = db.family_crew_oc_applications.find({"family_id": family_id}, {"_id": 0}).sort("created_at", -1)
        crew_oc_applications = await app_cursor.to_list(50)
    qualifies_for_state_head = await family_qualifies_for_state_head(family_id)
    vault_and_rackets_locked = await _family_in_active_war(family_id)
    compound_cash = int((fam.get("compound_cash") or 0) or 0)
    compound_points = int((fam.get("compound_points") or 0) or 0)
    compound_loot_pieces = int((fam.get("compound_loot_pieces") or 0) or 0)
    compound_deposits_by_user = fam.get("compound_deposits_by_user") or {}
    my_compound = compound_deposits_by_user.get(current_user["id"]) or {}
    my_compound_cash = int((my_compound.get("cash") or 0) or 0)
    my_compound_points = int((my_compound.get("points") or 0) or 0)
    my_compound_loot_pieces = int((my_compound.get("loot_pieces") or 0) or 0)
    my_compound_cars = 0
    compound_cars = fam.get("compound_cars") or []
    for car in compound_cars:
        if car.get("deposited_by_user_id") == current_user["id"]:
            my_compound_cars += 1
    returning_raw = []
    if my_role and my_role in ("boss", "underboss", "consigliere"):
        roster_uids = {_uid_str(e["user_id"]) for e in members + fallen if e.get("user_id")}
        for uid, attrib in compound_deposits_by_user.items():
            if _uid_str(uid) in roster_uids:
                ac = int((attrib.get("cash") or 0) or 0)
                ap = int((attrib.get("points") or 0) or 0)
                al = int((attrib.get("loot_pieces") or 0) or 0)
                cars_count = sum(1 for c in compound_cars if c.get("deposited_by_user_id") == uid)
                if ac > 0 or ap > 0 or al > 0 or cars_count > 0:
                    returning_raw.append({
                        "user_id": uid,
                        "compound_cash": ac, "compound_points": ap, "compound_loot_pieces": al,
                        "compound_cars": cars_count,
                    })
    returning_members_with_balance = []
    if returning_raw:
        rb_map = await _users_map_by_ids([r["user_id"] for r in returning_raw], {"_id": 0, "id": 1, "username": 1})
        for r in returning_raw:
            u = rb_map.get(_uid_str(r["user_id"]))
            returning_members_with_balance.append({
                **r,
                "username": (u or {}).get("username", "?"),
            })
    join_applications = []
    if my_role and my_role in ("boss", "underboss"):
        join_apps = await db.family_join_applications.find(
            {"family_id": family_id, "status": "pending"},
            {"_id": 0, "id": 1, "user_id": 1, "username": 1, "rank": 1, "applied_at": 1},
        ).sort("applied_at", 1).to_list(100)
        ja_uids = [a["user_id"] for a in join_apps if a.get("user_id")]
        ja_users = await _users_map_by_ids(ja_uids, {"_id": 0, "id": 1, "username": 1, "rank": 1})
        for a in join_apps:
            u = ja_users.get(_uid_str(a["user_id"]))
            if u:
                a["username"] = u.get("username") or a.get("username") or "?"
                a["rank"] = u.get("rank", 1)
            a["rank_name"] = next((x["name"] for x in RANKS if x.get("id") == a.get("rank", 1)), str(a.get("rank", 1)))
            join_applications.append(a)
    state_head_casino_week_stats = {}
    head_of_state = fam.get("head_of_state")
    if head_of_state:
        state_head_casino_week_stats = await _state_head_casino_week_stats(head_of_state)

    try:
        _ph = await family_property_holdings_summary(family_id, fam)
        _cb = await family_crew_bonuses_summary(family_id, fam)
    except Exception:
        logger.exception("families_my property_holdings / crew_bonuses")
        _ph = {"airports": [], "armouries": [], "casinos": []}
        _cb = {
            "treasury_bullets_hourly": {"active": False, "min": 100, "max": 200, "label": "Hourly vault bullets"},
            "airport_crew_perk": {
                "selected": AIRPORT_CREW_PERK_NONE,
                "active": False,
                "points_discount_percent": 0,
                "travel_time_reduction_seconds": 0,
            },
            "major_property_conflict": False,
            "bonus_warnings": [],
            "summary_lines": [],
        }

    quicktrade_family_listing_id = None
    if my_role == "boss" and not fam.get("wiped"):
        _qt_row = await db.properties.find_one(
            {"for_sale": True, "type": "family", "family_id": family_id},
            {"_id": 1},
        )
        if _qt_row and _qt_row.get("_id") is not None:
            quicktrade_family_listing_id = str(_qt_row["_id"])

    crew_oc_cd = await _crew_oc_effective_cooldown_info(family_id, uid)

    payload = {
        "family": {
            "id": fam["id"], "name": fam["name"], "tag": fam["tag"],
            "treasury": fam.get("treasury", 0),
            "treasury_bullets": int(fam.get("treasury_bullets") or 0),
            "treasury_points": int(fam.get("treasury_points") or 0),
            "treasury_loot_pieces": int(fam.get("treasury_loot_pieces") or 0),
            "safe_deposit_cap": family_safe_deposit_cap(fam),
            "safe_deposit_tiers": int(fam.get("safe_deposit_tiers") or 0),
            "melt_treasury_pct": int(fam.get("melt_treasury_pct") or 0),
            "melt_reward_tiers": fam.get("melt_reward_tiers") or [],
            "crew_oc_cooldown_until": fam.get("crew_oc_cooldown_until"),
            "crew_oc_join_fee": int(fam.get("crew_oc_join_fee") or 0),
            "crew_oc_auto_accept": bool(fam.get("crew_oc_auto_accept")),
            "crew_oc_forum_topic_id": fam.get("crew_oc_forum_topic_id") if fam.get("crew_oc_forum_topic_id") and await db.forum_topics.find_one({"id": fam["crew_oc_forum_topic_id"]}, {"_id": 1}) else None,
            "profile_text": (fam.get("profile_text") or "").strip() or None,
            "profile_notepad_color": notepad_color_for_api_response(fam.get("profile_notepad_color")),
            "avatar_url": fam.get("avatar_url"),
            "emblem_preset_id": fam.get("emblem_preset_id"),
            "premium_crest_unlocked": bool(fam.get("premium_crest_unlocked")),
            "racket_income_bonus_percent": float((fam.get("racket_income_bonus_percent") or 0) or 0),
            "head_of_state": head_of_state,
            "head_of_state_relinquished": bool(fam.get("head_of_state_relinquished")),
            "state_head_income": fam.get("state_head_income") or {},
            "pending_state_takeover": fam.get("pending_state_takeover"),
            "pending_state_takeover_at": fam.get("pending_state_takeover_at"),
            "compound_cash": compound_cash, "compound_points": compound_points, "compound_loot_pieces": compound_loot_pieces,
            "join_mode": fam.get("join_mode") or "open",
            "join_auto_accept": fam.get("join_auto_accept") or "none",
            "join_auto_accept_rank_min": fam.get("join_auto_accept_rank_min"),
            "airport_crew_perk": (fam.get("airport_crew_perk") or AIRPORT_CREW_PERK_NONE),
            "airport_crew_perk_set_at": fam.get("airport_crew_perk_set_at"),
            "property_holdings": _ph,
            "crew_bonuses": _cb,
            "family_perks": clean_family_perks(fam.get("family_perks"), datetime.now(timezone.utc)),
        },
        "my_safe_deposit": {
            "cash": int(((fam.get("safe_deposits_by_user") or {}).get(uid) or {}).get("cash") or 0),
            "bullets": int(((fam.get("safe_deposits_by_user") or {}).get(uid) or {}).get("bullets") or 0),
        },
        "members": members, "fallen": fallen, "rackets": rackets, "my_role": my_role,
        "racket_offence_upgrades": offence_upgrades,
        "racket_offence_weight": offence_weight,
        "vault_and_rackets_locked": vault_and_rackets_locked,
        "qualifies_for_state_head": qualifies_for_state_head,
        "crew_oc_committer_has_timer": crew_oc_cd["actor_has_timer"],
        "crew_oc_family_has_timer": crew_oc_cd["has_store_timer"],
        "crew_oc_effective_cooldown_hours": crew_oc_cd["hours"],
        "crew_oc_perk_hours_off": crew_oc_cd["perk_hours_off"],
        "crew_oc_applications": crew_oc_applications,
        "join_applications": join_applications,
        "compound_cars": compound_cars,
        "my_compound_cash": my_compound_cash, "my_compound_points": my_compound_points,
        "my_compound_loot_pieces": my_compound_loot_pieces, "my_compound_cars": my_compound_cars,
        "returning_members_with_balance": returning_members_with_balance,
        "state_head_casino_week_stats": state_head_casino_week_stats,
        "quicktrade_family_listing_id": quicktrade_family_listing_id,
    }
    if len(_my_cache) >= _my_cache_max_entries:
        _my_cache.clear()
    _my_cache[uid] = (payload, now_ts + _my_cache_ttl_sec)
    return payload


async def families_lookup(tag: Optional[str] = None, id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    lookup_id = (id and str(id).strip()) or None
    tag_clean = (tag and str(tag).strip()) or None
    if not lookup_id and not tag_clean:
        raise HTTPException(status_code=400, detail="tag or id required")
    if lookup_id:
        fam = await db.families.find_one({"id": lookup_id}, {"_id": 0})
    else:
        fam = await db.families.find_one(
            {"tag": tag_clean.upper(), **ACTIVE_FAMILY_FILTER},
            {"_id": 0},
            sort=[("created_at", -1), ("id", 1)],
        )
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    if fam.get("wiped"):
        memorial_members = []
        memorial_fallen = []
        for row in fam.get("memorial_roster") or []:
            rank_id = int(row.get("rank") or 1)
            entry = {
                "user_id": row.get("user_id"),
                "username": row.get("username") or "?",
                "role": row.get("role") or "associate",
                "rank_name": next((x["name"] for x in RANKS if x.get("id") == rank_id), str(rank_id)),
                "dead_at": row.get("dead_at"),
            }
            if row.get("is_dead"):
                memorial_fallen.append(entry)
            else:
                memorial_members.append(entry)
        return {
            "id": fam["id"],
            "name": fam.get("name") or "?",
            "tag": fam.get("tag") or "?",
            "treasury": 0,
            "treasury_bullets": 0,
            "head_of_state": None,
            "profile_text": (fam.get("profile_text") or "").strip() or None,
            "profile_notepad_color": notepad_color_for_api_response(fam.get("profile_notepad_color")),
            "avatar_url": fam.get("avatar_url"),
            "emblem_preset_id": fam.get("emblem_preset_id"),
            "member_count": 0,
            "members": memorial_members,
            "fallen": memorial_fallen,
            "rackets": [],
            "my_role": None,
            "crew_oc_crew": [],
            "wiped": True,
            "wiped_at": fam.get("wiped_at"),
            "wiped_by_family_id": fam.get("wiped_by_family_id"),
            "wiped_by_family_name": (fam.get("wiped_by_family_name") or "").strip() or None,
            "wiped_by_killer_id": fam.get("wiped_by_killer_id"),
            "wiped_by_killer_username": (fam.get("wiped_by_killer_username") or "").strip() or None,
        }
    members_docs = await db.family_members.find({"family_id": fam["id"]}, {"_id": 0}).to_list(200)
    lookup_uids = [m["user_id"] for m in members_docs if m.get("user_id")]
    bid = _uid_str(fam.get("boss_id"))
    if bid and all(_uid_str(x) != bid for x in lookup_uids):
        lookup_uids.append(bid)
    users_by_id = await _users_map_by_ids(lookup_uids)
    members = []
    fallen = []
    stale_member_rows_removed = 0
    bid_norm = _uid_str(fam.get("boss_id"))
    for m in members_docs:
        uid_s = _uid_str(m["user_id"])
        u = users_by_id.get(uid_s) if uid_s else None
        role_norm = str(m.get("role", "")).strip().lower() or "associate"
        if role_norm == "don":
            role_norm = "boss"
        # Boss row must show the real Don: prefer families.boss_id if member row is stale or lookup missed
        if role_norm == "boss" and bid_norm and (not u or uid_s != bid_norm):
            u = users_by_id.get(bid_norm) or u
        rank_name = "—"
        if u and RANKS:
            rank_name = next((x["name"] for x in RANKS if x.get("id") == u.get("rank", 1)), str(u.get("rank", 1)))
        uname = ((u.get("username") if u else None) or "").strip() or "?"
        # Last resort: direct DB load for Don if map still missed (corrupt member user_id, etc.)
        if uname == "?" and role_norm == "boss" and bid_norm:
            or_c = [{"id": bid_norm}]
            if bid_norm.isdigit():
                try:
                    or_c.append({"id": int(bid_norm)})
                except ValueError:
                    pass
            bu = await db.users.find_one(
                {"$or": or_c},
                {"_id": 0, "username": 1, "rank": 1, "is_dead": 1, "dead_at": 1, "family_id": 1},
            )
            if bu:
                u = bu
                if RANKS:
                    rank_name = next((x["name"] for x in RANKS if x.get("id") == u.get("rank", 1)), str(u.get("rank", 1)))
                uname = ((u.get("username") if u else None) or "").strip() or "?"
        include, u, deleted = await _include_family_roster_member(u, fam["id"], m.get("user_id"))
        stale_member_rows_removed += deleted
        if not include:
            continue
        if u:
            uname = ((u.get("username") if u else None) or "").strip() or uname
            if RANKS:
                rank_name = next((x["name"] for x in RANKS if x.get("id") == u.get("rank", 1)), str(u.get("rank", 1)))
        entry = {
            "user_id": m["user_id"],
            "username": uname,
            "role": role_norm,
            "rank_name": rank_name,
            "bullets_melted": int((u or {}).get("bullets_melted") or 0),
            "family_bullets_melted": int((u or {}).get("family_bullets_melted") or 0),
            "family_melt_reward_money_earned": int((u or {}).get("family_melt_reward_money_earned") or 0),
            "family_melt_reward_hits": int((u or {}).get("family_melt_reward_hits") or 0),
        }
        if (u or {}).get("is_dead"):
            entry["dead_at"] = (u or {}).get("dead_at")
            fallen.append(entry)
        else:
            members.append(entry)
    if stale_member_rows_removed:
        _invalidate_list_cache()
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
    crew_oc_join_fee = int(fam.get("crew_oc_join_fee") or 0)
    crew_oc_cooldown_until = fam.get("crew_oc_cooldown_until")
    crew_oc_forum_topic_id = fam.get("crew_oc_forum_topic_id")
    if crew_oc_forum_topic_id:
        topic_exists = await db.forum_topics.find_one({"id": crew_oc_forum_topic_id}, {"_id": 1})
        if not topic_exists:
            crew_oc_forum_topic_id = None
            await db.families.update_one({"id": fam["id"]}, {"$unset": {"crew_oc_forum_topic_id": ""}})
    crew_oc_application = None
    app = await db.family_crew_oc_applications.find_one(
        {"family_id": fam["id"], "user_id": current_user["id"]},
        {"_id": 0, "status": 1, "amount_paid": 1},
    )
    if app:
        crew_oc_application = {"status": app.get("status"), "amount_paid": int(app.get("amount_paid") or 0)}
    accepted_apps = await db.family_crew_oc_applications.find(
        {"family_id": fam["id"], "status": "accepted"},
        {"_id": 0, "username": 1},
    ).to_list(50)
    crew_oc_crew = [{"username": m["username"], "is_family_member": True} for m in members]
    crew_oc_crew += [{"username": a.get("username") or "?", "is_family_member": False} for a in accepted_apps]
    out = {
        "id": fam["id"], "name": fam["name"], "tag": fam["tag"], "treasury": fam.get("treasury", 0),
        "treasury_bullets": int(fam.get("treasury_bullets") or 0),
        "head_of_state": fam.get("head_of_state"),
        "profile_text": (fam.get("profile_text") or "").strip() or None,
        "profile_notepad_color": notepad_color_for_api_response(fam.get("profile_notepad_color")),
        "avatar_url": fam.get("avatar_url"),
        "emblem_preset_id": fam.get("emblem_preset_id"),
        "premium_crest_unlocked": bool(fam.get("premium_crest_unlocked")),
        "member_count": len(members), "members": members, "fallen": fallen, "rackets": rackets, "my_role": my_role,
        "crew_oc_join_fee": crew_oc_join_fee, "crew_oc_cooldown_until": crew_oc_cooldown_until,
        "crew_oc_forum_topic_id": crew_oc_forum_topic_id,
        "crew_oc_application": crew_oc_application, "crew_oc_crew": crew_oc_crew,
        "join_mode": fam.get("join_mode") or "open",
        "melt_treasury_pct": int(fam.get("melt_treasury_pct") or 0),
        "melt_reward_tiers": fam.get("melt_reward_tiers") or [],
        "airport_crew_perk": (fam.get("airport_crew_perk") or AIRPORT_CREW_PERK_NONE),
        "airport_crew_perk_set_at": fam.get("airport_crew_perk_set_at"),
    }
    try:
        out["property_holdings"] = await family_property_holdings_summary(fam["id"], fam)
        out["crew_bonuses"] = await family_crew_bonuses_summary(fam["id"], fam)
    except Exception:
        logger.exception("families_lookup property_holdings / crew_bonuses")
        out["property_holdings"] = {"airports": [], "armouries": [], "casinos": []}
        out["crew_bonuses"] = {
            "treasury_bullets_hourly": {"active": False, "min": 100, "max": 200, "label": "Hourly vault bullets"},
            "airport_crew_perk": {
                "selected": AIRPORT_CREW_PERK_NONE,
                "active": False,
                "points_discount_percent": 0,
                "travel_time_reduction_seconds": 0,
            },
            "major_property_conflict": False,
            "bonus_warnings": [],
            "summary_lines": [],
        }
    if fam.get("wiped"):
        out["wiped"] = True
        out["wiped_at"] = fam.get("wiped_at")
        out["wiped_by_family_id"] = fam.get("wiped_by_family_id")
        out["wiped_by_family_name"] = (fam.get("wiped_by_family_name") or "").strip() or None
        out["wiped_by_killer_id"] = fam.get("wiped_by_killer_id")
        out["wiped_by_killer_username"] = (fam.get("wiped_by_killer_username") or "").strip() or None
    return out


async def families_create(request: FamilyCreateRequest, current_user: dict = Depends(get_current_user)):
    if await resolve_family_id(current_user.get("id")):
        raise HTTPException(status_code=400, detail="Already in a family")
    is_admin = _is_admin(current_user)
    name = (request.name or "").strip()[:30]
    tag = (request.tag or "").strip().upper().replace(" ", "")[:4]
    if len(name) < 2 or len(tag) < 2:
        raise HTTPException(status_code=400, detail="Name and tag must be at least 2 characters")
    if not is_admin and await count_families_toward_player_cap() >= MAX_FAMILIES:
        raise HTTPException(status_code=400, detail="Maximum number of families reached")
    if await db.families.find_one({"wiped": {"$ne": True}, "$or": [{"name": name}, {"tag": tag}]}):
        raise HTTPException(status_code=400, detail="Name or tag already taken")
    raw_preset = (request.emblem_preset_id or "").strip() or None
    raw_custom = (request.emblem_custom_data or "").strip() or None
    if raw_preset and raw_custom:
        raise HTTPException(status_code=400, detail="Use either a preset emblem or a custom image, not both")
    emblem_preset_id = None
    emblem_key = None
    avatar_url_set = None
    if raw_preset:
        if raw_preset not in FAMILY_EMBLEM_PRESET_IDS:
            raise HTTPException(status_code=400, detail="Invalid emblem preset")
        ek = f"p:{raw_preset}"
        if await _family_emblem_key_taken(ek, None):
            raise HTTPException(status_code=400, detail="Another crew already uses this emblem")
        emblem_preset_id = raw_preset
        emblem_key = ek
    elif raw_custom:
        if len(raw_custom) > FAMILY_AVATAR_MAX_BYTES:
            raise HTTPException(status_code=400, detail="Emblem image too large (max ~1.2MB).")
        is_valid, err_msg = _validate_family_avatar(raw_custom)
        if not is_valid:
            raise HTTPException(status_code=400, detail=err_msg)
        ek = _family_emblem_custom_key_from_data_url(raw_custom)
        if not ek:
            raise HTTPException(status_code=400, detail="Invalid custom emblem")
        if await _family_emblem_key_taken(ek, None):
            raise HTTPException(status_code=400, detail="Another crew already uses this image as their emblem")
        avatar_url_set = raw_custom
        emblem_key = ek
    family_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    first_racket_id = FAMILY_RACKETS[0]["id"]
    fam_doc = {
        "id": family_id, "name": name, "tag": tag, "boss_id": current_user["id"],
        "provisioning": True,
        "treasury": 0, "treasury_bullets": 0, "treasury_points": 0, "treasury_loot_pieces": 0, "created_at": now,
        "rackets": {first_racket_id: {"level": 1, "last_collected_at": None}},
        "compound_cash": 0, "compound_points": 0, "compound_loot_pieces": 0,
        "compound_deposits_by_user": {},
        "join_mode": "open",
        "join_auto_accept": "none",
        "join_auto_accept_rank_min": None,
        "melt_treasury_pct": 0,
        "melt_reward_tiers": [],
        "airport_crew_perk": AIRPORT_CREW_PERK_NONE,
    }
    if is_admin:
        fam_doc["player_cap_exempt"] = True
    if emblem_preset_id:
        fam_doc["emblem_preset_id"] = emblem_preset_id
    if avatar_url_set:
        fam_doc["avatar_url"] = avatar_url_set
    if emblem_key:
        fam_doc["emblem_key"] = emblem_key
    try:
        await db.families.insert_one(fam_doc)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="That active family name, tag, or emblem was just taken. Choose another.",
        )
    await _delete_family_memberships_for_user(current_user["id"])
    await db.family_members.insert_one({
        "id": str(uuid.uuid4()), "family_id": family_id, "user_id": current_user["id"],
        "role": "boss", "joined_at": now,
    })
    melt_reset = _family_melt_stats_reset_fields()
    uid_filter = _user_id_filter_for_users_collection(current_user["id"])
    if is_admin:
        result = await db.users.update_one(
            uid_filter,
            {
                "$set": {"family_id": family_id, "family_role": "boss", **melt_reset},
                "$unset": WAR_RAT_BADGE_UNSET,
            },
        )
    else:
        result = await db.users.update_one(
            {**uid_filter, "money": {"$gte": FAMILY_CREATE_COST}},
            {
                "$set": {"family_id": family_id, "family_role": "boss", **melt_reset},
                "$inc": {"money": -FAMILY_CREATE_COST},
                "$unset": WAR_RAT_BADGE_UNSET,
            },
        )
    if result.modified_count == 0:
        await db.families.delete_one({"id": family_id})
        await db.family_members.delete_one({"family_id": family_id, "user_id": current_user["id"]})
        raise HTTPException(
            status_code=400,
            detail=(
                "Could not assign family to your account."
                if is_admin
                else f"You need ${FAMILY_CREATE_COST:,} to create a family."
            ),
        )
    await db.families.update_one(
        {"id": family_id, "provisioning": True},
        {"$set": {"provisioning": False}},
    )
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])
    await maybe_revoke_civilian_protection(db, current_user["id"], "crew_create")
    return {"message": "Family created", "family_id": family_id}


async def _family_war_recruitment_open(family_id: str) -> bool:
    """True if new members may join: not at war, or still within 24h of earliest active war's created_at."""
    if not family_id:
        return False
    wars = await db.family_wars.find(
        {
            "$or": [{"family_a_id": family_id}, {"family_b_id": family_id}],
            "status": {"$in": ["active", "truce_offered"]},
        },
        {"_id": 0, "created_at": 1},
    ).sort("created_at", 1).to_list(20)
    if not wars:
        return True
    ca = wars[0].get("created_at")
    if not ca:
        return False
    try:
        start = datetime.fromisoformat(str(ca).replace("Z", "+00:00"))
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
    except Exception:
        return False
    now = datetime.now(timezone.utc)
    return now < start + timedelta(hours=FAMILY_WAR_RECRUITMENT_WINDOW_HOURS)


async def _add_member_to_family(family_id: str, user_id: str) -> None:
    if not await _family_war_recruitment_open(family_id):
        raise HTTPException(status_code=403, detail="family_war_recruitment_closed")
    now = datetime.now(timezone.utc).isoformat()
    await _delete_family_memberships_for_user(user_id)
    await db.family_members.insert_one({
        "id": str(uuid.uuid4()), "family_id": family_id, "user_id": user_id,
        "role": "associate", "joined_at": now,
    })
    await db.users.update_one(
        _user_id_filter_for_users_collection(user_id),
        {
            "$set": {"family_id": family_id, "family_role": "associate", **_family_melt_stats_reset_fields()},
            "$unset": WAR_RAT_BADGE_UNSET,
        },
    )
    await maybe_revoke_civilian_protection(db, user_id, "crew_join")


async def _resolve_family_id(identifier: str):
    """Resolve family by id or by tag. Returns (fam_doc, family_id) or (None, None)."""
    if not identifier or not str(identifier).strip():
        return None, None
    ident = str(identifier).strip()
    fam = await db.families.find_one(
        {"id": ident, **ACTIVE_FAMILY_FILTER},
        {"_id": 0, "id": 1, "join_mode": 1, "join_auto_accept": 1, "join_auto_accept_rank_min": 1},
    )
    if fam:
        return fam, fam["id"]
    tag_clean = ident.upper().replace(" ", "")[:4]
    if tag_clean:
        fam = await db.families.find_one(
            {"tag": tag_clean, **ACTIVE_FAMILY_FILTER},
            {"_id": 0, "id": 1, "join_mode": 1, "join_auto_accept": 1, "join_auto_accept_rank_min": 1},
            sort=[("created_at", -1), ("id", 1)],
        )
        if fam:
            return fam, fam["id"]
    return None, None


async def families_join(request: FamilyJoinRequest, current_user: dict = Depends(get_current_user)):
    if await resolve_family_id(current_user.get("id")):
        raise HTTPException(status_code=400, detail="Already in a family")
    fam, family_id = await _resolve_family_id(request.family_id)
    if not fam or not family_id:
        raise HTTPException(status_code=404, detail="Family not found")
    if fam.get("join_mode") == "approval":
        raise HTTPException(status_code=400, detail="This family requires approval. Apply to join instead.")
    count = await db.family_members.count_documents({"family_id": family_id})
    if count >= sum(FAMILY_ROLE_LIMITS.values()):
        raise HTTPException(status_code=400, detail="Family is full")
    await _add_member_to_family(family_id, current_user["id"])
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])
    return {"message": "Joined family"}


async def families_apply(request: FamilyApplyRequest, current_user: dict = Depends(get_current_user)):
    """Apply to join a family when join_mode is approval. May auto-accept if family settings allow."""
    if await resolve_family_id(current_user.get("id")):
        raise HTTPException(status_code=400, detail="Already in a family")
    fam, family_id = await _resolve_family_id(request.family_id)
    if not fam or not family_id:
        raise HTTPException(status_code=404, detail="Family not found")
    if fam.get("join_mode") != "approval":
        raise HTTPException(status_code=400, detail="This family accepts direct join. Use Join instead.")
    count = await db.family_members.count_documents({"family_id": family_id})
    if count >= sum(FAMILY_ROLE_LIMITS.values()):
        raise HTTPException(status_code=400, detail="Family is full")
    existing = await db.family_join_applications.find_one(
        {"family_id": family_id, "user_id": current_user["id"], "status": "pending"},
        {"_id": 0, "id": 1},
    )
    if existing:
        raise HTTPException(status_code=400, detail="You already have a pending application")
    auto = (fam.get("join_auto_accept") or "none").strip().lower()
    rank_min = fam.get("join_auto_accept_rank_min")
    applicant_rank = int(current_user.get("rank") or 1)
    auto_accept = False
    if auto == "all":
        auto_accept = True
    elif auto == "rank_min" and rank_min is not None and applicant_rank >= int(rank_min):
        auto_accept = True
    if auto_accept:
        await _add_member_to_family(family_id, current_user["id"])
        _invalidate_list_cache()
        _invalidate_my_cache(current_user["id"])
        return {"message": "Joined family", "auto_accepted": True}
    now = datetime.now(timezone.utc).isoformat()
    app_id = str(uuid.uuid4())
    await db.family_join_applications.insert_one({
        "id": app_id, "family_id": family_id, "user_id": current_user["id"],
        "username": current_user.get("username") or "?",
        "rank": applicant_rank,
        "applied_at": now, "status": "pending",
    })
    await maybe_revoke_civilian_protection(db, current_user["id"], "crew_apply")
    return {"message": "Application submitted", "application_id": app_id}


async def families_join_applications_list(current_user: dict = Depends(get_current_user)):
    """List pending join applications for the current user's family. Boss/Underboss only."""
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Don or Underboss can view applications")
    cursor = db.family_join_applications.find(
        {"family_id": family_id, "status": "pending"},
        {"_id": 0, "id": 1, "user_id": 1, "username": 1, "rank": 1, "applied_at": 1},
    ).sort("applied_at", 1)
    apps = await cursor.to_list(100)
    app_uids = [a["user_id"] for a in apps if a.get("user_id")]
    app_users = await _users_map_by_ids(app_uids, {"_id": 0, "id": 1, "username": 1, "rank": 1})
    for a in apps:
        u = app_users.get(_uid_str(a["user_id"]))
        if u:
            a["username"] = u.get("username") or a.get("username") or "?"
            a["rank"] = u.get("rank", 1)
        a["rank_name"] = next((x["name"] for x in RANKS if x.get("id") == a.get("rank", 1)), str(a.get("rank", 1)))
    return {"applications": apps}


async def families_join_application_accept(application_id: str, current_user: dict = Depends(get_current_user)):
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Don or Underboss can accept applications")
    app = await db.family_join_applications.find_one({"id": application_id, "family_id": family_id, "status": "pending"}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found or already processed")
    count = await db.family_members.count_documents({"family_id": family_id})
    if count >= sum(FAMILY_ROLE_LIMITS.values()):
        await db.family_join_applications.update_one({"id": application_id}, {"$set": {"status": "denied"}})
        raise HTTPException(status_code=400, detail="Family is full")
    user_id = app["user_id"]
    if await db.family_members.find_one({"family_id": family_id, "user_id": user_id}):
        await db.family_join_applications.update_one({"id": application_id}, {"$set": {"status": "denied"}})
        raise HTTPException(status_code=400, detail="User is already a member")
    await _add_member_to_family(family_id, user_id)
    await db.family_join_applications.update_one({"id": application_id}, {"$set": {"status": "accepted"}})
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(user_id)
    return {"message": "Application accepted"}


async def families_join_application_deny(application_id: str, current_user: dict = Depends(get_current_user)):
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Don or Underboss can deny applications")
    res = await db.family_join_applications.update_one(
        {"id": application_id, "family_id": family_id, "status": "pending"},
        {"$set": {"status": "denied"}},
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=404, detail="Application not found or already processed")
    return {"message": "Application denied"}


async def families_join_settings(request: FamilyJoinSettingsRequest, current_user: dict = Depends(get_current_user)):
    """Update family join mode and auto-accept settings. Boss only."""
    if current_user.get("family_role") != "boss":
        raise HTTPException(status_code=403, detail="Only Don can change join settings")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    updates = {}
    if request.join_mode is not None:
        if request.join_mode not in ("open", "approval"):
            raise HTTPException(status_code=400, detail="join_mode must be 'open' or 'approval'")
        updates["join_mode"] = request.join_mode
    if request.join_auto_accept is not None:
        if request.join_auto_accept not in ("none", "all", "rank_min"):
            raise HTTPException(status_code=400, detail="join_auto_accept must be 'none', 'all', or 'rank_min'")
        updates["join_auto_accept"] = request.join_auto_accept
    if request.join_auto_accept_rank_min is not None:
        updates["join_auto_accept_rank_min"] = request.join_auto_accept_rank_min
    if not updates:
        return {"message": "No changes"}
    await db.families.update_one({"id": family_id}, {"$set": updates})
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])
    return {"message": "Join settings updated"}


def _normalize_melt_reward_tiers(tiers_raw: list) -> list:
    normalized = []
    for t in tiers_raw or []:
        threshold = int((t or {}).get("threshold_bullets") or 0)
        reward = int((t or {}).get("reward_money") or 0)
        if threshold < FAMILY_MELT_REWARD_THRESHOLD_STEP or threshold > FAMILY_MELT_REWARD_THRESHOLD_MAX:
            raise HTTPException(
                status_code=400,
                detail=f"Tier threshold must be between {FAMILY_MELT_REWARD_THRESHOLD_STEP:,} and {FAMILY_MELT_REWARD_THRESHOLD_MAX:,}",
            )
        if threshold % FAMILY_MELT_REWARD_THRESHOLD_STEP != 0:
            raise HTTPException(
                status_code=400,
                detail=f"Tier threshold must be in {FAMILY_MELT_REWARD_THRESHOLD_STEP:,} bullet steps",
            )
        if reward <= 0 or reward > FAMILY_MELT_REWARD_MONEY_MAX:
            raise HTTPException(
                status_code=400,
                detail=f"Tier reward must be between $1 and ${FAMILY_MELT_REWARD_MONEY_MAX:,}",
            )
        normalized.append({"threshold_bullets": threshold, "reward_money": reward})
    deduped = {}
    for t in normalized:
        deduped[t["threshold_bullets"]] = t["reward_money"]
    return [
        {"threshold_bullets": thr, "reward_money": deduped[thr]}
        for thr in sorted(deduped.keys())
    ]


async def families_melt_settings(request: FamilyMeltSettingsRequest, current_user: dict = Depends(get_current_user)):
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    role = (current_user.get("family_role") or "").lower()
    if role not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Only Don, Underboss, or Consigliere can change melt settings")
    updates = {}
    if request.melt_treasury_pct is not None:
        pct = int(request.melt_treasury_pct)
        if pct < 0 or pct > FAMILY_MELT_TREASURY_PCT_MAX:
            raise HTTPException(status_code=400, detail=f"melt_treasury_pct must be between 0 and {FAMILY_MELT_TREASURY_PCT_MAX}")
        updates["melt_treasury_pct"] = pct
    if request.melt_reward_tiers is not None:
        updates["melt_reward_tiers"] = _normalize_melt_reward_tiers([t.model_dump() for t in request.melt_reward_tiers])
    if not updates:
        return {"message": "No changes"}
    await db.families.update_one({"id": family_id}, {"$set": updates})
    _invalidate_my_cache(current_user["id"])
    return {"message": "Melt settings updated", **updates}


RETRIBUTION_CHANCE = 0.5  # 50% chance family sends a hitman when you leave
RETRIBUTION_MAX_HEALTH_LOSS_PCT = 0.5  # Lose up to 50% of current health (you don't die)
MIN_HEALTH_PCT = 1  # Health can never drop below 1% (e.g. if user leaves multiple families in a row)


async def families_leave(current_user: dict = Depends(get_current_user)):
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "boss_id": 1})
    if fam and fam.get("boss_id") == current_user["id"]:
        raise HTTPException(status_code=400, detail="Boss must transfer leadership or dissolve family first")
    active_wars_on_leave = await db.family_wars.find(
        {"$or": [{"family_a_id": family_id}, {"family_b_id": family_id}], "status": {"$in": ["active", "truce_offered"]}},
        {"_id": 0, "id": 1},
    ).to_list(10)
    in_war = bool(active_wars_on_leave)
    variants = _user_id_variants_for_family_members(current_user["id"])
    if variants:
        await db.family_members.delete_many({"family_id": family_id, "user_id": {"$in": variants}})
    leave_set = {"family_id": None, "family_role": None, **_family_melt_stats_reset_fields()}
    if in_war:
        leave_set["war_rat_family_id"] = family_id
        leave_set["war_rat_war_ids"] = [w["id"] for w in active_wars_on_leave if w.get("id")]
        leave_set["war_rat_badge_until"] = (
            datetime.now(timezone.utc) + timedelta(hours=FAMILY_WAR_RECRUITMENT_WINDOW_HOURS)
        ).isoformat()
    await db.users.update_one(
        _user_id_filter_for_users_collection(current_user["id"]),
        {"$set": leave_set},
    )
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])

    # 50% chance of retribution: family sends a hitman; you get shot and lose up to 50% health (you don't die)
    if _rng.random() < RETRIBUTION_CHANCE:
        user_doc = await db.users.find_one(_user_id_filter_for_users_collection(current_user["id"]), {"_id": 0, "health": 1})
        health = max(0, min(100, float(user_doc.get("health") or 100)))
        loss_pct = _rng.uniform(0, RETRIBUTION_MAX_HEALTH_LOSS_PCT)
        damage = health * loss_pct
        new_health = max(MIN_HEALTH_PCT, health - damage)
        retrib_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            _user_id_filter_for_users_collection(current_user["id"]),
            {"$set": {"health": new_health, "health_regen_last_at": retrib_iso}},
        )
        _invalidate_my_cache(current_user["id"])
        return {
            "message": "Left family. The family sent a hitman—you were shot and lost health. You survived.",
            "retribution": True,
            "health_lost_pct": round(loss_pct * 100, 1),
            "health_now": round(new_health, 1),
        }
    return {"message": "Left family"}


async def families_kick(request: FamilyKickRequest, current_user: dict = Depends(get_current_user)):
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if current_user.get("family_role") not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Boss or Underboss can kick")
    if request.user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot kick yourself")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": request.user_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.get("role") == "boss":
        raise HTTPException(status_code=400, detail="Cannot kick the Boss")
    variants = _user_id_variants_for_family_members(request.user_id)
    if variants:
        await db.family_members.delete_many({"family_id": family_id, "user_id": {"$in": variants}})
    await db.users.update_one(
        _user_id_filter_for_users_collection(request.user_id),
        {"$set": {"family_id": None, "family_role": None, **_family_melt_stats_reset_fields()}},
    )
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(request.user_id)
    return {"message": "Member kicked"}


def _invalidate_quicktrade_property_cache() -> None:
    try:
        from routers.money import quicktrade as _qt

        _qt._invalidate_trade_caches()
    except Exception:
        logger.exception("invalidate quicktrade caches from families")


async def remove_family_quicktrade_listings_for_war_families(family_a_id: str, family_b_id: str) -> None:
    """When a war starts, remove Quick Trade listings for both crews (cannot sell while at war)."""
    ids = list(dict.fromkeys([x for x in (family_a_id, family_b_id) if x and str(x).strip()]))
    if not ids:
        return
    res = await db.properties.delete_many({"for_sale": True, "type": "family", "family_id": {"$in": ids}})
    deleted_count = int(res.deleted_count or 0)
    member_ids: set = set()
    async for row in db.family_members.find({"family_id": {"$in": ids}}, {"_id": 0, "user_id": 1}):
        uid = row.get("user_id")
        if uid is None:
            continue
        member_ids.add(str(uid).strip())
        for v in _user_id_variants_for_family_members(uid):
            member_ids.add(str(v).strip())
    member_ids = {x for x in member_ids if x}
    if member_ids:
        prop_types = [
            "garage_dealership",
            "sports_betting",
            "airport",
            "bullet_factory",
            "casino_dice",
            "casino_rlt",
            "casino_blackjack",
            "casino_horseracing",
            "casino_videopoker",
        ]
        prop_res = await db.properties.delete_many(
            {"for_sale": True, "type": {"$in": prop_types}, "owner_id": {"$in": list(member_ids)}},
        )
        deleted_count += int(prop_res.deleted_count or 0)
    if deleted_count:
        _invalidate_quicktrade_property_cache()
        _invalidate_list_cache()
        for fid in ids:
            fam = await db.families.find_one({"id": fid}, {"_id": 0, "boss_id": 1})
            bid = (fam or {}).get("boss_id")
            if bid:
                _invalidate_my_cache(bid)


async def validate_family_quicktrade_buy(prop: dict, buyer_doc: dict) -> None:
    """Raises HTTPException if this family Quick Trade listing cannot be purchased."""
    fid = (prop.get("family_id") or "").strip()
    if not fid:
        raise HTTPException(status_code=400, detail="Invalid family listing")
    if buyer_doc.get("family_id"):
        raise HTTPException(status_code=400, detail="Leave your current family before buying a crew on Quick Trade.")
    fam = await db.families.find_one({"id": fid}, {"_id": 0, "boss_id": 1, "wiped": 1})
    if not fam or fam.get("wiped"):
        raise HTTPException(status_code=400, detail="This crew is no longer available.")
    if _uid_str(fam.get("boss_id")) != _uid_str(prop.get("owner_id")):
        raise HTTPException(status_code=400, detail="This listing is no longer valid.")
    if await _family_in_active_war(fid):
        raise HTTPException(status_code=400, detail="This crew is at war and cannot be purchased on Quick Trade right now.")


async def complete_family_quicktrade_sale(
    *,
    family_id: str,
    seller_id: str,
    buyer_id: str,
    buyer_username: str,
) -> None:
    """Transfer Don to buyer; seller leaves crew. Members and treasury stay on the family doc."""
    fid = (family_id or "").strip()
    if not fid:
        raise HTTPException(status_code=400, detail="Invalid family")
    fam = await db.families.find_one({"id": fid}, {"_id": 0, "boss_id": 1, "wiped": 1})
    if not fam or fam.get("wiped"):
        raise HTTPException(status_code=400, detail="This crew is no longer available.")
    if _uid_str(fam.get("boss_id")) != _uid_str(seller_id):
        raise HTTPException(status_code=400, detail="This listing is no longer valid.")
    if await _family_in_active_war(fid):
        raise HTTPException(status_code=400, detail="This crew is at war and cannot be transferred on Quick Trade right now.")
    melt_reset = _family_melt_stats_reset_fields()
    s_var = _user_id_variants_for_family_members(seller_id)
    if s_var:
        await db.family_members.delete_many({"family_id": fid, "user_id": {"$in": s_var}})
    await db.users.update_one(
        _user_id_filter_for_users_collection(seller_id),
        {"$set": {"family_id": None, "family_role": None, **melt_reset}},
    )
    await _delete_family_memberships_for_user(buyer_id)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.family_members.insert_one(
        {
            "id": str(uuid.uuid4()),
            "family_id": fid,
            "user_id": buyer_id,
            "role": "boss",
            "joined_at": now_iso,
        }
    )
    await db.users.update_one(
        _user_id_filter_for_users_collection(buyer_id),
        {
            "$set": {"family_id": fid, "family_role": "boss", **melt_reset},
            "$unset": WAR_RAT_BADGE_UNSET,
        },
    )
    await db.families.update_one({"id": fid}, {"$set": {"boss_id": buyer_id}})
    _invalidate_list_cache()
    _invalidate_my_cache(seller_id)
    _invalidate_my_cache(buyer_id)


async def families_sell_on_trade(
    request: FamilySellOnTradeRequest,
    current_user: dict = Depends(get_current_user_verified),
):
    """List the crew on Quick Trade for points (Don only, not during war)."""
    pts = int(request.points or 0)
    if pts <= 0:
        raise HTTPException(status_code=400, detail="Points must be positive")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="You are not in a family")
    my_role = (current_user.get("family_role") or "").strip().lower()
    if my_role != "boss":
        raise HTTPException(status_code=403, detail="Only the Don can list the family on Quick Trade")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "boss_id": 1, "wiped": 1})
    if not fam or fam.get("wiped"):
        raise HTTPException(status_code=400, detail="Family not found")
    if _uid_str(fam.get("boss_id")) != _uid_str(current_user["id"]):
        raise HTTPException(status_code=403, detail="Only the sitting Don can list the crew")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=400, detail="You cannot list your family on Quick Trade during a war")
    existing = await db.properties.find_one(
        {"for_sale": True, "type": "family", "family_id": family_id},
        {"_id": 1},
    )
    if existing:
        raise HTTPException(status_code=400, detail="This family is already listed on Quick Trade. Cancel the listing first.")
    tag = (fam.get("tag") or "").strip() or "?"
    name = (fam.get("name") or "").strip() or "Crew"
    listing_id = ObjectId()
    await db.properties.insert_one(
        {
            "_id": listing_id,
            "id": str(listing_id),
            "type": "family",
            "family_id": family_id,
            "location": tag,
            "name": f"Family: [{tag}] {name}",
            "owner_id": current_user["id"],
            "owner_username": current_user.get("username", "Unknown"),
            "for_sale": True,
            "sale_price": pts,
            "created_at": datetime.now(timezone.utc),
        }
    )
    _invalidate_quicktrade_property_cache()
    _invalidate_my_cache(current_user["id"])
    await log_activity(
        current_user["id"],
        current_user.get("username") or "?",
        "family_quicktrade_list",
        {"family_id": family_id, "points": pts},
    )
    return {"message": f"Crew listed for {pts:,} points on Quick Trade", "listing_id": str(listing_id)}


async def families_assign_role(request: FamilyRoleRequest, current_user: dict = Depends(get_current_user)):
    my_role = (current_user.get("family_role") or "").strip().lower()
    if my_role not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Boss or Underboss can assign roles")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if request.role not in FAMILY_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    # Only the Don can transfer leadership (assign boss)
    if request.role == "boss" and my_role != "boss":
        raise HTTPException(status_code=400, detail="Only the Don can transfer leadership")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": request.user_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    target_user = await db.users.find_one(
        _user_id_filter_for_users_collection(request.user_id),
        {"_id": 0, "id": 1, "family_id": 1, "is_dead": 1},
    )
    include, target_user, _deleted = await _include_family_roster_member(target_user, family_id, request.user_id)
    if not include or not target_user:
        raise HTTPException(status_code=404, detail="Member not found")
    if target_user.get("is_dead"):
        raise HTTPException(status_code=400, detail="Cannot assign roles to dead members")
    target_role = (member.get("role") or "").strip().lower()
    # Underboss can only manage capo / soldier / associate ranks (not Don, Underboss, or Consigliere)
    if my_role == "underboss":
        if request.role in ("boss", "underboss", "consigliere"):
            raise HTTPException(status_code=403, detail="Only the Don can assign that rank")
        if target_role in ("boss", "underboss", "consigliere"):
            raise HTTPException(status_code=403, detail="Only the Don can change that member's rank")
    members_for_count = await db.family_members.find(
        {"family_id": family_id},
        {"_id": 0, "user_id": 1, "role": 1},
    ).to_list(200)
    users_by_id = await _users_map_by_ids(
        [m.get("user_id") for m in members_for_count if m.get("user_id")],
        {"_id": 0, "id": 1, "family_id": 1, "is_dead": 1},
    )
    by_role = defaultdict(int)
    for m in members_for_count:
        u = users_by_id.get(_uid_str(m.get("user_id")))
        include_u, u, _ = await _include_family_roster_member(u, family_id, m.get("user_id"))
        if not include_u or not u or u.get("is_dead"):
            continue
        role = (m.get("role") or "").strip().lower()
        if role:
            by_role[role] += 1
    limit = FAMILY_ROLE_LIMITS.get(request.role, 0)
    # Allow leadership transfer even though boss limit is 1 (the boss role is moved, not added).
    if request.role != "boss" and limit and (by_role.get(request.role) or 0) >= limit and member.get("role") != request.role:
        raise HTTPException(status_code=400, detail=f"Role {request.role} limit reached")
    await db.family_members.update_one({"family_id": family_id, "user_id": request.user_id}, {"$set": {"role": request.role}})
    await db.users.update_one({"id": request.user_id}, {"$set": {"family_role": request.role}})
    if request.role == "boss":
        await db.families.update_one({"id": family_id}, {"$set": {"boss_id": request.user_id}})
        await db.family_members.update_one({"family_id": family_id, "user_id": current_user["id"]}, {"$set": {"role": "underboss"}})
        await db.users.update_one({"id": current_user["id"]}, {"$set": {"family_role": "underboss"}})
        qdel = await db.properties.delete_many({"for_sale": True, "type": "family", "family_id": family_id})
        if qdel.deleted_count:
            _invalidate_quicktrade_property_cache()
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(request.user_id)
    return {"message": "Role updated"}


async def families_deposit(request: FamilyDepositRequest, current_user: dict = Depends(get_current_user)):
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Vault is locked until the family war is over")
    amount = int(request.amount or 0)
    bullets = int(request.bullets or 0)
    if amount < 0 or bullets < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if amount == 0 and bullets == 0:
        raise HTTPException(status_code=400, detail="Specify cash and/or bullets")
    user_filter = {"id": current_user["id"]}
    if amount > 0:
        user_filter["money"] = {"$gte": amount}
    if bullets > 0:
        user_filter["bullets"] = {"$gte": bullets}
    result = await db.users.find_one_and_update(
        user_filter,
        {"$inc": {"money": -amount, "bullets": -bullets}},
        return_document=False,
    )
    if not result:
        raise HTTPException(status_code=400, detail="Not enough cash or bullets")
    await db.families.update_one({"id": family_id}, {"$inc": {"treasury": amount, "treasury_bullets": bullets}})
    await log_family_vault_tx(
        db,
        family_id,
        "deposit",
        current_user["id"],
        current_user.get("username") or "?",
        cash_delta=amount,
        bullets_delta=bullets,
    )
    _invalidate_my_cache(current_user["id"])
    await log_activity(current_user["id"], current_user.get("username", "?"), "family_deposit", {"cash": amount, "bullets": bullets})
    return {"message": "Deposited to treasury"}


async def families_withdraw(request: FamilyWithdrawRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Vault is locked until the family war is over")
    amount = int(request.amount or 0)
    bullets = int(request.bullets or 0)
    if amount < 0 or bullets < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if amount == 0 and bullets == 0:
        raise HTTPException(status_code=400, detail="Specify cash and/or bullets")
    family_filter = {"id": family_id}
    if amount > 0:
        family_filter["treasury"] = {"$gte": amount}
    if bullets > 0:
        family_filter["treasury_bullets"] = {"$gte": bullets}
    result = await db.families.find_one_and_update(
        family_filter,
        {"$inc": {"treasury": -amount, "treasury_bullets": -bullets}},
        return_document=False,
    )
    if not result:
        raise HTTPException(status_code=400, detail="Not enough treasury cash or bullets")
    await db.users.update_one({"id": current_user["id"]}, {"$inc": {"money": amount, "bullets": bullets}})
    await log_family_vault_tx(
        db,
        family_id,
        "withdraw",
        current_user["id"],
        current_user.get("username") or "?",
        cash_delta=-amount,
        bullets_delta=-bullets,
    )
    _invalidate_my_cache(current_user["id"])
    await log_activity(current_user["id"], current_user.get("username", "?"), "family_withdraw", {"cash": amount, "bullets": bullets})
    return {"message": "Withdrew from treasury"}


async def families_give_bullets(request: FamilyGiveBulletsRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Vault is locked until the family war is over")
    target_id = str(request.user_id or "").strip()
    bullets = int(request.bullets or 0)
    if not target_id:
        raise HTTPException(status_code=400, detail="Target member is required")
    if bullets <= 0:
        raise HTTPException(status_code=400, detail="Invalid bullet amount")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": target_id}, {"_id": 0, "user_id": 1})
    if not member:
        raise HTTPException(status_code=404, detail="Target is not in your family")
    target_user = await db.users.find_one({"id": target_id}, {"_id": 0, "is_dead": 1})
    if not target_user or target_user.get("is_dead"):
        raise HTTPException(status_code=400, detail="Target member must be alive")
    debited = await db.families.update_one(
        {"id": family_id, "treasury_bullets": {"$gte": bullets}},
        {"$inc": {"treasury_bullets": -bullets}},
    )
    if debited.modified_count == 0:
        raise HTTPException(status_code=400, detail="Not enough family bullets")
    await db.users.update_one({"id": target_id}, {"$inc": {"bullets": bullets}})
    tu = await db.users.find_one({"id": target_id}, {"_id": 0, "username": 1})
    await log_family_vault_tx(
        db,
        family_id,
        "give_bullets",
        current_user["id"],
        current_user.get("username") or "?",
        bullets_delta=-bullets,
        target_user_id=target_id,
        target_username=(tu or {}).get("username") or "?",
    )
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(target_id)
    return {"message": f"Gave {bullets:,} bullets to family member"}


async def families_split_all_bullets(current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Vault is locked until the family war is over")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury_bullets": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    total_bullets = int(fam.get("treasury_bullets") or 0)
    if total_bullets <= 0:
        raise HTTPException(status_code=400, detail="No bullets in family vault")
    members = await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(200)
    member_ids = [str(m.get("user_id") or "").strip() for m in members if (m.get("user_id") or "").strip()]
    if not member_ids:
        raise HTTPException(status_code=400, detail="No family members found")
    living = await db.users.find(
        {"id": {"$in": member_ids}, "is_dead": {"$ne": True}},
        {"_id": 0, "id": 1},
    ).to_list(200)
    living_ids = sorted({str(u.get("id") or "").strip() for u in living if (u.get("id") or "").strip()})
    if not living_ids:
        raise HTTPException(status_code=400, detail="No living family members")
    n_live = len(living_ids)
    if total_bullets < n_live:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least {n_live:,} bullets to split among {n_live} living members (at least one each)",
        )
    each = total_bullets // n_live
    remainder = total_bullets % n_live
    distribution = {}
    for idx, uid in enumerate(living_ids):
        give = each + (1 if idx < remainder else 0)
        if give > 0:
            distribution[uid] = give
    to_distribute = sum(distribution.values())
    debited = await db.families.update_one(
        {"id": family_id, "treasury_bullets": {"$gte": to_distribute}},
        {"$inc": {"treasury_bullets": -to_distribute}},
    )
    if debited.modified_count == 0:
        raise HTTPException(status_code=409, detail="Vault changed, please try again")
    for uid, amt in distribution.items():
        await db.users.update_one({"id": uid}, {"$inc": {"bullets": amt}})
        _invalidate_my_cache(uid)
    await log_family_vault_tx(
        db,
        family_id,
        "split_bullets",
        current_user["id"],
        current_user.get("username") or "?",
        bullets_delta=-to_distribute,
        meta={"member_count": len(distribution), "total_split": to_distribute},
    )
    _invalidate_my_cache(current_user["id"])
    return {
        "message": f"Split {to_distribute:,} bullets across {len(distribution)} living members",
        "total_split": to_distribute,
        "member_count": len(distribution),
        "each_base": each,
        "remainder_distributed": remainder,
    }


async def families_give_loot(request: FamilyGiveLootRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Vault is locked until the family war is over")
    target_id = str(request.user_id or "").strip()
    loot = int(request.loot_pieces or 0)
    if not target_id:
        raise HTTPException(status_code=400, detail="Target member is required")
    if loot <= 0:
        raise HTTPException(status_code=400, detail="Invalid loot amount")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": target_id}, {"_id": 0, "user_id": 1})
    if not member:
        raise HTTPException(status_code=404, detail="Target is not in your family")
    target_user = await db.users.find_one({"id": target_id}, {"_id": 0, "is_dead": 1})
    if not target_user or target_user.get("is_dead"):
        raise HTTPException(status_code=400, detail="Target member must be alive")
    debited = await db.families.update_one(
        {"id": family_id, "treasury_loot_pieces": {"$gte": loot}},
        {"$inc": {"treasury_loot_pieces": -loot}},
    )
    if debited.modified_count == 0:
        raise HTTPException(status_code=400, detail="Not enough loot pieces in family vault")
    await db.users.update_one({"id": target_id}, {"$inc": {"loot_box_pieces": loot}})
    tu = await db.users.find_one({"id": target_id}, {"_id": 0, "username": 1})
    await log_family_vault_tx(
        db,
        family_id,
        "give_loot",
        current_user["id"],
        current_user.get("username") or "?",
        loot_delta=-loot,
        target_user_id=target_id,
        target_username=(tu or {}).get("username") or "?",
    )
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(target_id)
    return {"message": f"Gave {loot:,} loot pieces to family member"}


async def families_split_all_loot(current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Vault is locked until the family war is over")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury_loot_pieces": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    total_loot = int(fam.get("treasury_loot_pieces") or 0)
    if total_loot <= 0:
        raise HTTPException(status_code=400, detail="No loot pieces in family vault")
    members = await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(200)
    member_ids = [str(m.get("user_id") or "").strip() for m in members if (m.get("user_id") or "").strip()]
    if not member_ids:
        raise HTTPException(status_code=400, detail="No family members found")
    living = await db.users.find(
        {"id": {"$in": member_ids}, "is_dead": {"$ne": True}},
        {"_id": 0, "id": 1},
    ).to_list(200)
    living_ids = sorted({str(u.get("id") or "").strip() for u in living if (u.get("id") or "").strip()})
    if not living_ids:
        raise HTTPException(status_code=400, detail="No living family members")
    n_live = len(living_ids)
    if total_loot < n_live:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least {n_live:,} loot pieces to split among {n_live} living members (at least one each)",
        )
    each = total_loot // n_live
    remainder = total_loot % n_live
    distribution = {}
    for idx, uid in enumerate(living_ids):
        give = each + (1 if idx < remainder else 0)
        if give > 0:
            distribution[uid] = give
    to_distribute = sum(distribution.values())
    debited = await db.families.update_one(
        {"id": family_id, "treasury_loot_pieces": {"$gte": to_distribute}},
        {"$inc": {"treasury_loot_pieces": -to_distribute}},
    )
    if debited.modified_count == 0:
        raise HTTPException(status_code=409, detail="Vault changed, please try again")
    for uid, amt in distribution.items():
        await db.users.update_one({"id": uid}, {"$inc": {"loot_box_pieces": amt}})
        _invalidate_my_cache(uid)
    await log_family_vault_tx(
        db,
        family_id,
        "split_loot",
        current_user["id"],
        current_user.get("username") or "?",
        loot_delta=-to_distribute,
        meta={"member_count": len(distribution), "total_split": to_distribute},
    )
    _invalidate_my_cache(current_user["id"])
    return {
        "message": f"Split {to_distribute:,} loot pieces across {len(distribution)} living members",
        "total_split": to_distribute,
        "member_count": len(distribution),
        "each_base": each,
        "remainder_distributed": remainder,
    }


async def families_vault_transactions(
    limit: int = Query(50, ge=1, le=100),
    skip: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    q = {"family_id": family_id}
    total = await db.family_vault_transactions.count_documents(q)
    cursor = db.family_vault_transactions.find(q, {"_id": 0}).sort("at", -1).skip(skip).limit(limit)
    txs = await cursor.to_list(length=limit)
    return {"transactions": txs, "total": total, "limit": limit, "skip": skip}


async def families_compound_deposit(request: CompoundDepositRequest, current_user: dict = Depends(get_current_user)):
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Compound is locked until the family war is over")
    cash = int(request.cash or 0)
    points = int(request.points or 0)
    loot_pieces = int(request.loot_pieces or 0)
    if cash < 0 or points < 0 or loot_pieces < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if cash == 0 and points == 0 and loot_pieces == 0:
        raise HTTPException(status_code=400, detail="Specify at least one amount to deposit")
    uid = current_user["id"]
    user_filter = {"id": uid}
    if cash > 0:
        user_filter["money"] = {"$gte": cash}
    if points > 0:
        user_filter["points"] = {"$gte": points}
    if loot_pieces > 0:
        user_filter["loot_box_pieces"] = {"$gte": loot_pieces}
    result = await db.users.update_one(
        user_filter,
        {"$inc": {"money": -cash, "points": -points, "loot_box_pieces": -loot_pieces}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient resources for deposit")
    if points > 0:
        await log_points_event(db, user_id=uid, points=-points, event_type="family_compound_deposit", meta={"family_id": family_id})
    inc_fields = {"compound_cash": cash, "compound_points": points, "compound_loot_pieces": loot_pieces}
    if cash > 0:
        inc_fields[f"compound_deposits_by_user.{uid}.cash"] = cash
    if points > 0:
        inc_fields[f"compound_deposits_by_user.{uid}.points"] = points
    if loot_pieces > 0:
        inc_fields[f"compound_deposits_by_user.{uid}.loot_pieces"] = loot_pieces
    await db.families.update_one({"id": family_id}, {"$inc": inc_fields})
    _invalidate_my_cache(current_user["id"])
    return {"message": "Deposited to compound"}


async def families_compound_withdraw(request: CompoundWithdrawRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Compound is locked until the family war is over")
    cash = int(request.cash or 0)
    points = int(request.points or 0)
    loot_pieces = int(request.loot_pieces or 0)
    if cash < 0 or points < 0 or loot_pieces < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if cash == 0 and points == 0 and loot_pieces == 0:
        raise HTTPException(status_code=400, detail="Specify at least one amount to withdraw")
    fam = await db.families.find_one(
        {"id": family_id},
        {"_id": 0, "compound_cash": 1, "compound_points": 1, "compound_loot_pieces": 1, "compound_deposits_by_user": 1},
    )
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    total_cash = int((fam.get("compound_cash") or 0) or 0)
    total_points = int((fam.get("compound_points") or 0) or 0)
    total_loot = int((fam.get("compound_loot_pieces") or 0) or 0)
    if total_cash < cash or total_points < points or total_loot < loot_pieces:
        raise HTTPException(status_code=400, detail="Not enough in compound")
    uid = current_user["id"]
    by_user = fam.get("compound_deposits_by_user") or {}
    my_deposits = dict((by_user.get(uid) or {}))
    my_cash = int(my_deposits.get("cash") or 0)
    my_points = int(my_deposits.get("points") or 0)
    my_loot = int(my_deposits.get("loot_pieces") or 0)
    cash_take = min(cash, total_cash, my_cash)
    points_take = min(points, total_points, my_points)
    loot_take = min(loot_pieces, total_loot, my_loot)
    if cash_take == 0 and points_take == 0 and loot_take == 0:
        raise HTTPException(status_code=400, detail="Nothing to withdraw from your share")
    my_deposits["cash"] = my_cash - cash_take
    my_deposits["points"] = my_points - points_take
    my_deposits["loot_pieces"] = my_loot - loot_take
    withdraw_filter = {"id": family_id}
    if cash_take > 0:
        withdraw_filter["compound_cash"] = {"$gte": cash_take}
    if points_take > 0:
        withdraw_filter["compound_points"] = {"$gte": points_take}
    if loot_take > 0:
        withdraw_filter["compound_loot_pieces"] = {"$gte": loot_take}
    updates = {
        "$inc": {"compound_cash": -cash_take, "compound_points": -points_take, "compound_loot_pieces": -loot_take},
        "$set": {f"compound_deposits_by_user.{uid}": my_deposits},
    }
    withdraw_result = await db.families.update_one(withdraw_filter, updates)
    if withdraw_result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Not enough in compound (may have been withdrawn concurrently)")
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": cash_take, "points": points_take, "loot_box_pieces": loot_take}},
    )
    if points_take > 0:
        await log_points_event(db, user_id=current_user["id"], points=points_take, event_type="family_compound_withdraw", meta={"family_id": family_id})
    _invalidate_my_cache(current_user["id"])
    return {"message": "Withdrew from compound"}


async def families_compound_return_to_member(request: CompoundReturnToMemberRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    target_id = (request.user_id or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="user_id required")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": target_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    fam = await db.families.find_one(
        {"id": family_id},
        {"_id": 0, "compound_cash": 1, "compound_points": 1, "compound_loot_pieces": 1, "compound_deposits_by_user": 1, "compound_cars": 1},
    )
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    by_user = fam.get("compound_deposits_by_user") or {}
    attrib = by_user.get(target_id) or {}
    ac = int((attrib.get("cash") or 0) or 0)
    ap = int((attrib.get("points") or 0) or 0)
    al = int((attrib.get("loot_pieces") or 0) or 0)
    if ac == 0 and ap == 0 and al == 0:
        raise HTTPException(status_code=400, detail="Member has no compound share to return")
    total_cash = int((fam.get("compound_cash") or 0) or 0)
    total_points = int((fam.get("compound_points") or 0) or 0)
    total_loot = int((fam.get("compound_loot_pieces") or 0) or 0)
    if ac > total_cash or ap > total_points or al > total_loot:
        raise HTTPException(status_code=400, detail="Compound totals inconsistent")
    updates = {
        "$inc": {"compound_cash": -ac, "compound_points": -ap, "compound_loot_pieces": -al},
        "$unset": {f"compound_deposits_by_user.{target_id}": ""},
    }
    await db.families.update_one({"id": family_id}, updates)
    await db.users.update_one(
        {"id": target_id},
        {"$inc": {"money": ac, "points": ap, "loot_box_pieces": al}},
    )
    fam_name = fam.get("name") or fam.get("tag") or "Your family"
    officer = current_user.get("username") or "An officer"
    parts = []
    if ac > 0:
        parts.append(f"${ac:,}")
    if ap > 0:
        parts.append(f"{ap:,} pts")
    if al > 0:
        parts.append(f"{al:,} loot pieces")
    summary = ", ".join(parts) if parts else "your share"
    await send_notification(
        target_id,
        "Family Compound – Share returned",
        f"Your compound share has been returned to you by {officer}: {summary}.",
        "reward",
    )
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(target_id)
    return {"message": "Returned compound share to member"}


async def families_compound_claim_for_family(request: CompoundClaimForFamilyRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    target_id = (request.user_id or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="user_id required")
    member = await db.family_members.find_one({"family_id": family_id, "user_id": target_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    fam = await db.families.find_one(
        {"id": family_id},
        {"_id": 0, "compound_cash": 1, "compound_points": 1, "compound_loot_pieces": 1, "compound_deposits_by_user": 1, "compound_cars": 1},
    )
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    by_user = fam.get("compound_deposits_by_user") or {}
    attrib = by_user.get(target_id) or {}
    ac = int((attrib.get("cash") or 0) or 0)
    ap = int((attrib.get("points") or 0) or 0)
    al = int((attrib.get("loot_pieces") or 0) or 0)
    if ac == 0 and ap == 0 and al == 0:
        raise HTTPException(status_code=400, detail="Member has no compound share to claim")
    total_cash = int((fam.get("compound_cash") or 0) or 0)
    total_points = int((fam.get("compound_points") or 0) or 0)
    total_loot = int((fam.get("compound_loot_pieces") or 0) or 0)
    if ac > total_cash or ap > total_points or al > total_loot:
        raise HTTPException(status_code=400, detail="Compound totals inconsistent")
    updates = {
        "$inc": {
            "compound_cash": -ac,
            "compound_points": -ap,
            "compound_loot_pieces": -al,
            "treasury": ac,
            "treasury_points": ap,
            "treasury_loot_pieces": al,
        },
        "$unset": {f"compound_deposits_by_user.{target_id}": ""},
    }
    await db.families.update_one({"id": family_id}, updates)
    tgt_u = await db.users.find_one({"id": target_id}, {"_id": 0, "username": 1})
    await log_family_vault_tx(
        db,
        family_id,
        "compound_to_vault",
        current_user["id"],
        current_user.get("username") or "?",
        cash_delta=ac,
        points_delta=ap,
        loot_delta=al,
        target_user_id=target_id,
        target_username=(tgt_u or {}).get("username") or "?",
    )
    fam_name = fam.get("name") or fam.get("tag") or "The family"
    officer = current_user.get("username") or "An officer"
    parts = []
    if ac > 0:
        parts.append(f"${ac:,}")
    if ap > 0:
        parts.append(f"{ap:,} pts")
    if al > 0:
        parts.append(f"{al:,} loot pieces")
    summary = ", ".join(parts) if parts else "your share"
    await send_notification(
        target_id,
        "Family Compound – Share claimed for vault",
        f"Your compound share was claimed for the family vault by {officer}: {summary}. It is now in {fam_name}'s vault.",
        "system",
    )
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(target_id)
    return {"message": "Claimed compound share for the family"}


async def families_perks_state(current_user: dict = Depends(get_current_user)):
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "boss_id": 1, "family_perks": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    now = datetime.now(timezone.utc)
    perks = clean_family_perks(fam.get("family_perks"), now)
    boss_id = _uid_str(fam.get("boss_id"))
    boss_username = None
    if boss_id:
        bu = await db.users.find_one({"id": boss_id}, {"_id": 0, "username": 1})
        boss_username = (bu or {}).get("username")
    me_pts = await db.users.find_one({"id": current_user.get("id")}, {"_id": 0, "points": 1})
    my_points = int((me_pts or {}).get("points") or 0)
    contrib_cursor = db.family_vault_transactions.find(
        {"family_id": family_id, "kind": "family_perk_contribute"},
        {"_id": 0, "at": 1, "actor_username": 1, "target_username": 1, "meta": 1},
    ).sort("at", -1).limit(80)
    contrib_rows = await contrib_cursor.to_list(length=80)
    contribution_log = []
    for r in contrib_rows:
        meta = r.get("meta") or {}
        contribution_log.append(
            {
                "at": r.get("at"),
                "from_username": (r.get("actor_username") or "?").strip() or "?",
                "to_username": (r.get("target_username") or "?").strip() or "?",
                "points": int(meta.get("points") or 0),
            }
        )
    return {
        "catalog": perk_catalog_prices(),
        "family_perks": perks,
        "boss_id": boss_id,
        "boss_username": boss_username,
        "month_ends_at": utc_calendar_month_end(now).isoformat(),
        "my_points": my_points,
        "contribution_log": contribution_log,
    }


async def families_perks_purchase(request: FamilyPerksPurchaseRequest, current_user: dict = Depends(get_current_user)):
    family_id, _role = await _current_family_context(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Family perks are locked until the war is over")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "boss_id": 1, "family_perks": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    boss_id = _uid_str(fam.get("boss_id"))
    uid = _uid_str(current_user.get("id"))
    if not boss_id or uid != boss_id:
        raise HTTPException(status_code=403, detail="Only the Don can purchase family perks")
    perk_id = (request.perk_id or "").strip().lower()
    if perk_id == "crew_oc_insurance":
        from utils.store_item_flags import require_store_item_allowed

        await require_store_item_allowed(db, "crew_oc_insurance", current_user)
    if perk_id not in PERK_IDS:
        raise HTTPException(status_code=400, detail="Invalid perk")
    now = datetime.now(timezone.utc)
    valid_iso = utc_calendar_month_end(now).isoformat()
    perks = clean_family_perks(fam.get("family_perks"), now)

    cost = 0
    new_perks = dict(perks)

    if perk_id == "crew_oc":
        cost = FAMILY_PERK_COST_CREW_OC
        if new_perks.get("crew_oc"):
            raise HTTPException(status_code=400, detail="This perk is already active this month")
        new_perks["crew_oc"] = {"valid_until": valid_iso, "hours_off": FAMILY_PERK_CREW_OC_HOURS_OFF}
    elif perk_id == "crew_oc_auto_commit":
        cost = FAMILY_PERK_COST_CREW_OC_AUTO_COMMIT
        if new_perks.get("crew_oc_auto_commit"):
            raise HTTPException(status_code=400, detail="This perk is already active")
        vu = (now + timedelta(days=FAMILY_PERK_CREW_OC_AUTO_COMMIT_DAYS)).isoformat()
        new_perks["crew_oc_auto_commit"] = {"valid_until": vu}
        valid_iso = vu
    elif perk_id == "crew_oc_insurance":
        from utils.family_perks import FAMILY_PERK_COST_CREW_OC_INSURANCE

        cost = FAMILY_PERK_COST_CREW_OC_INSURANCE
        if new_perks.get("crew_oc_insurance"):
            raise HTTPException(status_code=400, detail="Crew OC insurance is already active this month")
        new_perks["crew_oc_insurance"] = {"valid_until": valid_iso}
    elif perk_id == "melt":
        cost = FAMILY_PERK_COST_MELT
        if new_perks.get("melt"):
            raise HTTPException(status_code=400, detail="This perk is already active this month")
        new_perks["melt"] = {"valid_until": valid_iso, "seconds_off": FAMILY_PERK_MELT_SECONDS_OFF}
    elif perk_id == "gta":
        cost = FAMILY_PERK_COST_GTA
        if new_perks.get("gta"):
            raise HTTPException(status_code=400, detail="This perk is already active this month")
        new_perks["gta"] = {"valid_until": valid_iso, "seconds_off": FAMILY_PERK_GTA_SECONDS_OFF}
    elif perk_id == "hitlist":
        cost = FAMILY_PERK_COST_HITLIST
        if new_perks.get("hitlist"):
            raise HTTPException(status_code=400, detail="This perk is already active this month")
        new_perks["hitlist"] = {"valid_until": valid_iso, "npc_bonus_slots": FAMILY_PERK_HITLIST_NPC_SLOTS}
    elif perk_id == "racket":
        cost = FAMILY_PERK_COST_RACKET
        if new_perks.get("racket"):
            raise HTTPException(status_code=400, detail="This perk is already active this month")
        new_perks["racket"] = {"valid_until": valid_iso, "bonus_percent": FAMILY_PERK_RACKET_BONUS_PERCENT}
    elif perk_id == "booze":
        steps = max(1, int(request.booze_steps or 1))
        steps = min(steps, 40)
        b_row = new_perks.get("booze") or {}
        current_cargo = int(b_row.get("cargo_bonus") or 0)
        room = max(0, FAMILY_PERK_BOOZE_BONUS_CAP - current_cargo)
        max_steps = room // FAMILY_PERK_BOOZE_STEP_AMOUNT
        if max_steps <= 0:
            raise HTTPException(status_code=400, detail="Booze cargo bonus is already at the monthly cap (+300)")
        steps = min(steps, max_steps)
        cost = FAMILY_PERK_COST_BOOZE_STEP * steps
        new_cargo = min(FAMILY_PERK_BOOZE_BONUS_CAP, current_cargo + steps * FAMILY_PERK_BOOZE_STEP_AMOUNT)
        new_perks["booze"] = {"valid_until": valid_iso, "cargo_bonus": new_cargo}

    if cost <= 0:
        raise HTTPException(status_code=400, detail="Invalid purchase")

    boss_before = await db.users.find_one({"id": boss_id}, {"_id": 0, "points": 1})
    pts_before = int((boss_before or {}).get("points") or 0)
    if pts_before < cost:
        raise HTTPException(status_code=400, detail="Not enough points")

    boss_after = await db.users.find_one_and_update(
        {"id": boss_id, "points": {"$gte": cost}},
        {"$inc": {"points": -cost}},
        return_document=ReturnDocument.AFTER,
    )
    if not boss_after:
        raise HTTPException(status_code=400, detail="Not enough points")

    try:
        await db.families.update_one({"id": family_id}, {"$set": {"family_perks": new_perks}})
    except Exception:
        await db.users.update_one({"id": boss_id}, {"$inc": {"points": cost}})
        raise

    if perk_id == "crew_oc_auto_commit":
        await schedule_crew_oc_auto_commit_for_family(family_id)

    pts_after = int(boss_after.get("points") or 0)
    await log_points_event(
        db,
        user_id=boss_id,
        points=-cost,
        event_type="family_perk_purchase",
        meta={"family_id": family_id, "perk_id": perk_id},
        wallet_points_before=pts_before,
        wallet_points_after=pts_after,
    )
    await log_family_vault_tx(
        db,
        family_id,
        "family_perk_purchase",
        boss_id,
        current_user.get("username") or "?",
        meta={"perk_id": perk_id, "points_cost": cost, "valid_until": valid_iso},
    )
    await log_activity(boss_id, current_user.get("username", "?"), "family_perk_purchase", {"family_id": family_id, "perk_id": perk_id, "cost": cost})
    _invalidate_list_cache()
    _invalidate_my_cache(boss_id)
    return {
        "message": "Perk purchased",
        "family_perks": new_perks,
        "points_spent": cost,
        "points_remaining": pts_after,
    }


async def families_perks_contribute(request: FamilyPerksContributeRequest, current_user: dict = Depends(get_current_user)):
    amt = int(request.points or 0)
    if amt < 1:
        raise HTTPException(status_code=400, detail="Enter at least 1 point")
    if amt > FAMILY_PERK_CONTRIBUTE_POINTS_MAX:
        raise HTTPException(status_code=400, detail="Amount too large")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Contributions are locked until the war is over")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "boss_id": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    boss_id = _uid_str(fam.get("boss_id"))
    uid = _uid_str(current_user.get("id"))
    if not boss_id:
        raise HTTPException(status_code=400, detail="Family has no Don")
    if uid == boss_id:
        raise HTTPException(status_code=400, detail="Members contribute points to the Don — you are the Don")

    src_before = await db.users.find_one({"id": uid}, {"_id": 0, "points": 1})
    sb = int((src_before or {}).get("points") or 0)
    if sb < amt:
        raise HTTPException(status_code=400, detail="Not enough points")

    src_after = await db.users.find_one_and_update(
        {"id": uid, "points": {"$gte": amt}},
        {"$inc": {"points": -amt}},
        return_document=ReturnDocument.AFTER,
    )
    if not src_after:
        raise HTTPException(status_code=400, detail="Not enough points")

    boss_after = await db.users.find_one_and_update(
        {"id": boss_id},
        {"$inc": {"points": amt}},
        return_document=ReturnDocument.AFTER,
    )
    if not boss_after:
        await db.users.update_one({"id": uid}, {"$inc": {"points": amt}})
        raise HTTPException(status_code=500, detail="Transfer failed; try again")

    await log_points_event(
        db,
        user_id=uid,
        points=-amt,
        event_type="family_perk_contribute_out",
        meta={"family_id": family_id, "to_user_id": boss_id},
        wallet_points_before=sb,
        wallet_points_after=int(src_after.get("points") or 0),
    )
    await log_points_event(
        db,
        user_id=boss_id,
        points=amt,
        event_type="family_perk_contribute_in",
        meta={"family_id": family_id, "from_user_id": uid},
        wallet_points_after=int(boss_after.get("points") or 0),
    )
    _bu = await db.users.find_one({"id": boss_id}, {"username": 1})
    bn = (_bu or {}).get("username") or "?"
    await log_family_vault_tx(
        db,
        family_id,
        "family_perk_contribute",
        uid,
        current_user.get("username") or "?",
        target_user_id=boss_id,
        target_username=bn,
        meta={"points": amt},
    )
    await log_activity(uid, current_user.get("username", "?"), "family_perk_contribute", {"family_id": family_id, "amount": amt})
    _invalidate_list_cache()
    _invalidate_my_cache(uid)
    _invalidate_my_cache(boss_id)
    return {"message": f"Sent {amt:,} points to the Don", "points": amt}


async def families_crew_oc_set_fee(request: FamilyCrewOCSetFeeRequest, current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can set Crew OC fee")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fee = int(request.fee or 0)
    if fee < 0:
        raise HTTPException(status_code=400, detail="Fee cannot be negative")
    await db.families.update_one({"id": family_id}, {"$set": {"crew_oc_join_fee": fee}})
    _invalidate_my_cache(current_user["id"])
    return {"message": "Crew OC join fee updated.", "fee": fee}


async def families_crew_oc_set_auto_accept(request: FamilyCrewOCSetAutoAcceptRequest, current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can set Crew OC auto-accept")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    auto_accept = bool(request.auto_accept)
    await db.families.update_one({"id": family_id}, {"$set": {"crew_oc_auto_accept": auto_accept}})
    _invalidate_my_cache(current_user["id"])
    return {"message": "Crew OC auto-accept updated.", "auto_accept": auto_accept}


FAMILY_PROFILE_TEXT_MAX_LENGTH = 10000


def _family_emblem_custom_key_from_data_url(data_url: str) -> Optional[str]:
    """Stable uniqueness key for a custom emblem (SHA-256 of raw image bytes)."""
    import base64
    import re

    match = re.match(r"^data:(image/[a-zA-Z0-9+-]+);base64,(.+)$", data_url or "")
    if not match:
        return None
    try:
        raw = base64.b64decode(match.group(2))
    except Exception:
        return None
    if not raw:
        return None
    return "c:" + hashlib.sha256(raw).hexdigest()


async def _family_emblem_key_taken(emblem_key: str, exclude_family_id: Optional[str]) -> bool:
    if not emblem_key:
        return False
    q: Dict[str, Any] = {"wiped": {"$ne": True}, "emblem_key": emblem_key}
    if exclude_family_id:
        q["id"] = {"$ne": exclude_family_id}
    doc = await db.families.find_one(q, {"_id": 1})
    return doc is not None


async def families_update_profile_text(request: FamilyProfileTextRequest, current_user: dict = Depends(get_current_user)):
    """Update your family's profile text and/or notepad background colour (hex). Only Boss, Underboss, or Capo."""
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can edit family profile")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    updates = {}
    if request.profile_text is not None:
        raw = (request.profile_text or "").strip() or None
        if raw is not None and len(raw) > FAMILY_PROFILE_TEXT_MAX_LENGTH:
            raise HTTPException(status_code=400, detail=f"Profile text cannot exceed {FAMILY_PROFILE_TEXT_MAX_LENGTH} characters")
        updates["profile_text"] = raw if raw else ""
    if request.notepad_color is not None:
        updates["profile_notepad_color"] = normalize_notepad_color_for_set(request.notepad_color)
    if not updates:
        doc = await db.families.find_one({"id": family_id}, {"_id": 0, "profile_text": 1, "profile_notepad_color": 1})
        return {
            "message": "No profile changes",
            "profile_text": (doc.get("profile_text") or "").strip() or None,
            "profile_notepad_color": notepad_color_for_api_response(doc.get("profile_notepad_color")),
        }
    await db.families.update_one({"id": family_id}, {"$set": updates})
    _invalidate_my_cache(current_user["id"])
    _invalidate_list_cache()
    doc = await db.families.find_one({"id": family_id}, {"_id": 0, "profile_text": 1, "profile_notepad_color": 1})
    return {
        "message": "Family profile updated.",
        "profile_text": (doc.get("profile_text") or "").strip() or None,
        "profile_notepad_color": notepad_color_for_api_response(doc.get("profile_notepad_color")),
    }


FAMILY_AVATAR_MAX_BYTES = int(1.2 * 1024 * 1024)  # same cap as user avatar data URL
FAMILY_AVATAR_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


def _validate_family_avatar(data_url: str) -> tuple[bool, str]:
    """
    Validate family avatar data URL for security.
    Returns (is_valid, error_message).
    """
    import base64
    import re

    if not data_url:
        return False, "No data provided"

    if not data_url.startswith("data:image/"):
        return False, "Avatar must be an image data URL"

    # Parse: data:image/TYPE;base64,DATA
    match = re.match(r"^data:(image/[a-zA-Z0-9+-]+);base64,(.+)$", data_url)
    if not match:
        return False, "Invalid data URL format. Must be base64 encoded."

    mime_type = match.group(1).lower()
    base64_data = match.group(2)

    # Block SVG (can contain JavaScript/XSS)
    if "svg" in mime_type:
        return False, "SVG images are not allowed for security reasons"

    if mime_type not in FAMILY_AVATAR_ALLOWED_TYPES:
        return False, "Invalid image type. Allowed: JPEG, PNG, GIF, WEBP"

    # Validate base64 characters
    if not re.match(r"^[A-Za-z0-9+/=]+$", base64_data):
        return False, "Invalid base64 encoding"

    try:
        decoded = base64.b64decode(base64_data)
    except Exception:
        return False, "Failed to decode base64 data"

    # Verify magic bytes
    magic_bytes = {
        "image/jpeg": [b"\xff\xd8\xff"],
        "image/png": [b"\x89PNG\r\n\x1a\n"],
        "image/gif": [b"GIF87a", b"GIF89a"],
        "image/webp": [b"RIFF"],
    }

    valid_magic = False
    for magic in magic_bytes.get(mime_type, []):
        if decoded.startswith(magic):
            valid_magic = True
            break

    if not valid_magic:
        return False, "Image data does not match declared type"

    if mime_type == "image/webp" and b"WEBP" not in decoded[:12]:
        return False, "Invalid WEBP image data"

    return True, ""


async def families_update_avatar(request: FamilyAvatarRequest, current_user: dict = Depends(get_current_user)):
    """Set crew emblem: preset_id, custom avatar_data (data URL), or clear. Each emblem is unique across active crews."""
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can set family emblem")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")

    preset = (request.preset_id or "").strip() or None
    avatar = (request.avatar_data or "").strip() or None
    clear = bool(request.clear)

    if clear and (preset or avatar):
        raise HTTPException(status_code=400, detail="Cannot combine clear with preset or custom image")
    if preset and avatar:
        raise HTTPException(status_code=400, detail="Choose either a preset emblem or a custom image")

    if clear:
        await db.families.update_one(
            {"id": family_id},
            {"$unset": {"avatar_url": "", "emblem_preset_id": "", "emblem_key": ""}},
        )
        _invalidate_my_cache(current_user.get("id") or "")
        _invalidate_list_cache()
        return {"message": "Family emblem removed.", "avatar_url": None, "emblem_preset_id": None}

    if preset:
        fam = await db.families.find_one({"id": family_id}, {"_id": 0, "premium_crest_unlocked": 1})
        if not _valid_emblem_preset_for_family(preset, fam):
            raise HTTPException(status_code=400, detail="Invalid emblem preset")
        ek = f"p:{preset}"
        if await _family_emblem_key_taken(ek, family_id):
            raise HTTPException(status_code=400, detail="Another crew already uses this emblem")
        await db.families.update_one(
            {"id": family_id},
            {"$set": {"emblem_preset_id": preset, "emblem_key": ek}, "$unset": {"avatar_url": ""}},
        )
        _invalidate_my_cache(current_user.get("id") or "")
        _invalidate_list_cache()
        return {"message": "Family emblem updated.", "avatar_url": None, "emblem_preset_id": preset}

    if avatar:
        if len(avatar) > FAMILY_AVATAR_MAX_BYTES:
            raise HTTPException(status_code=400, detail="Image too large. Use a smaller image (max ~1.2MB).")
        is_valid, error_msg = _validate_family_avatar(avatar)
        if not is_valid:
            raise HTTPException(status_code=400, detail=error_msg)
        ek = _family_emblem_custom_key_from_data_url(avatar)
        if not ek:
            raise HTTPException(status_code=400, detail="Invalid custom emblem")
        if await _family_emblem_key_taken(ek, family_id):
            raise HTTPException(status_code=400, detail="Another crew already uses this image as their emblem")
        await db.families.update_one(
            {"id": family_id},
            {"$set": {"avatar_url": avatar, "emblem_key": ek}, "$unset": {"emblem_preset_id": ""}},
        )
        _invalidate_my_cache(current_user.get("id") or "")
        _invalidate_list_cache()
        return {"message": "Family emblem updated.", "avatar_url": avatar, "emblem_preset_id": None}

    doc = await db.families.find_one({"id": family_id}, {"_id": 0, "avatar_url": 1, "emblem_preset_id": 1})
    return {
        "message": "No emblem changes",
        "avatar_url": (doc or {}).get("avatar_url"),
        "emblem_preset_id": (doc or {}).get("emblem_preset_id"),
    }


CREW_OC_TOPIC_WINDOW_MINUTES = 10  # Can create Crew OC topic only when OC is available or within this many mins before

# Store token ticker: eligible if OC available now OR within this many minutes before cooldown ends (not forum advertise window).
CREW_OC_AUTO_APPLY_PRE_AVAILABLE_MINUTES = 60
CREW_OC_AUTO_APPLY_MAX_USERS_PER_TICK = 40
CREW_OC_AUTO_APPLY_MAX_FAMILIES_PER_USER = 25
CREW_OC_AUTO_APPLY_MAX_APPLIES_PER_TICK = 40

CREW_OC_AUTO_COMMIT_DELAY_MINUTES = 10
CREW_OC_AUTO_COMMIT_MAX_FAMILIES_PER_TICK = 25


def _crew_oc_parse_dt_utc(val) -> Optional[datetime]:
    if not val:
        return None
    try:
        dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _crew_oc_family_is_auto_apply_eligible(fam_doc: dict, now_utc: datetime) -> bool:
    raw = fam_doc.get("crew_oc_cooldown_until")
    if not raw:
        return True
    cd = _crew_oc_parse_dt_utc(raw)
    if not cd:
        return True
    if now_utc >= cd:
        return True
    pre = cd - timedelta(minutes=CREW_OC_AUTO_APPLY_PRE_AVAILABLE_MINUTES)
    return now_utc >= pre


def _crew_oc_advertisement_window_allows(fam_doc: dict) -> bool:
    """True when a Crew OC forum ad may be posted (same rule as manual advertise / forum crew_oc create)."""
    raw = fam_doc.get("crew_oc_cooldown_until")
    if not raw:
        return True
    until = _crew_oc_parse_dt_utc(raw)
    if not until:
        return True
    now = datetime.now(timezone.utc)
    window_start = until - timedelta(minutes=CREW_OC_TOPIC_WINDOW_MINUTES)
    return now >= window_start


async def _crew_oc_insert_crew_oc_forum_ad(
    family_id: str,
    *,
    author_id: str,
    author_username: str,
    fam_name: Optional[str],
    fam_tag: Optional[str],
    content_extra: str = "",
) -> str:
    """Create the standard Crew OC forum ad (deletes prior ads for this family). Returns topic id."""
    from routers.social.forum import _delete_all_crew_oc_topics_for_family, _prune_forum_topics_for_category

    fid = (family_id or "").strip()
    topic_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    name = (fam_name or "?").strip() or "?"
    tag = (fam_tag or "?").strip() or "?"
    title = f"Crew OC: {name} [{tag}]"
    body = (
        f"Apply here to join {name} [{tag}] for their next Crew OC run. Set your join fee in Families → Crew OC."
        + (content_extra or "")
    )
    doc = {
        "id": topic_id,
        "title": title,
        "content": body,
        "category": "crew_oc",
        "crew_oc_family_id": fid,
        "author_id": author_id,
        "author_username": author_username or "?",
        "created_at": now_iso,
        "updated_at": now_iso,
        "views": 0,
        "is_sticky": False,
        "is_important": False,
        "is_locked": False,
    }
    await _delete_all_crew_oc_topics_for_family(fid)
    await db.forum_topics.insert_one(doc)
    await db.families.update_one({"id": fid}, {"$set": {"crew_oc_forum_topic_id": topic_id}})
    await _prune_forum_topics_for_category("crew_oc")
    await log_activity(
        author_id,
        author_username or "?",
        "forum_topic",
        {"topic_id": topic_id, "title": title, "crew_oc_auto_ad": bool((content_extra or "").strip())},
    )
    return topic_id


async def schedule_crew_oc_auto_commit_for_family(family_id: str) -> None:
    """When ``crew_oc_auto_commit`` is active: ensure a Crew OC forum ad exists (post automatically if allowed), then set auto-commit due time."""
    fid = (family_id or "").strip()
    if not fid:
        return
    now = datetime.now(timezone.utc)
    fam = await db.families.find_one(
        {"id": fid, **ACTIVE_FAMILY_FILTER},
        {"_id": 0, "family_perks": 1, "crew_oc_forum_topic_id": 1, "crew_oc_cooldown_until": 1, "name": 1, "tag": 1, "boss_id": 1},
    )
    if not fam:
        return
    unset_sched = {"$unset": {"crew_oc_auto_commit_due_at": "", "crew_oc_auto_commit_topic_id": ""}}
    perks = clean_family_perks(fam.get("family_perks"), now)
    if not perks.get("crew_oc_auto_commit"):
        await db.families.update_one({"id": fid}, unset_sched)
        return
    tid = (fam.get("crew_oc_forum_topic_id") or "").strip()
    topic = await db.forum_topics.find_one({"id": tid}, {"_id": 0, "created_at": 1}) if tid else None
    if not topic:
        if not _crew_oc_advertisement_window_allows(fam):
            await db.families.update_one({"id": fid}, unset_sched)
            return
        boss_id = _uid_str(fam.get("boss_id"))
        boss = await db.users.find_one({"id": boss_id}, {"_id": 0, "id": 1, "username": 1}) if boss_id else None
        if not boss:
            await db.families.update_one({"id": fid}, unset_sched)
            return
        extra = "\n\n[color=#888888](Posted automatically — family has Auto-commit Crew OC active.)[/color]"
        tid = await _crew_oc_insert_crew_oc_forum_ad(
            fid,
            author_id=boss["id"],
            author_username=boss.get("username") or "?",
            fam_name=fam.get("name"),
            fam_tag=fam.get("tag"),
            content_extra=extra,
        )
        _invalidate_my_cache(boss["id"])
        topic = await db.forum_topics.find_one({"id": tid}, {"_id": 0, "created_at": 1})
    if not topic:
        await db.families.update_one({"id": fid}, unset_sched)
        return
    t0 = _crew_oc_parse_dt_utc(topic.get("created_at")) or now
    base_due = t0 + timedelta(minutes=CREW_OC_AUTO_COMMIT_DELAY_MINUTES)
    cd = _crew_oc_parse_dt_utc(fam.get("crew_oc_cooldown_until"))
    due = max(base_due, cd) if cd and cd > base_due else base_due
    if due < now:
        due = now
    await db.families.update_one(
        {"id": fid},
        {"$set": {"crew_oc_auto_commit_due_at": due.isoformat(), "crew_oc_auto_commit_topic_id": tid}},
    )


async def _crew_oc_apply_user_to_family(
    db,
    uid: str,
    username: str,
    user_family_id: Optional[str],
    money: int,
    family_id: str,
    *,
    max_join_fee_cap: Optional[int] = None,
) -> Dict[str, Any]:
    """Apply current user to another family's Crew OC (shared by HTTP + auto-apply ticker)."""
    family_id = (family_id or "").strip()
    if not family_id:
        return {"ok": False, "reason": "bad_family_id"}
    if user_family_id and user_family_id == family_id:
        return {"ok": False, "reason": "same_family"}
    fam = await db.families.find_one(
        {"id": family_id},
        {"_id": 0, "name": 1, "tag": 1, "crew_oc_join_fee": 1, "crew_oc_auto_accept": 1, "wiped": 1},
    )
    if not fam or fam.get("wiped"):
        return {"ok": False, "reason": "family_not_found"}
    fee = int(fam.get("crew_oc_join_fee") or 0)
    if max_join_fee_cap is not None and fee > int(max_join_fee_cap):
        return {"ok": False, "reason": "fee_above_cap"}
    auto_accept = bool(fam.get("crew_oc_auto_accept"))
    existing = await db.family_crew_oc_applications.find_one({"family_id": family_id, "user_id": uid}, {"_id": 0, "status": 1})
    if existing:
        status = (existing.get("status") or "").strip().lower()
        if status in ("pending", "accepted"):
            return {"ok": False, "reason": "already_applied", "status": existing.get("status")}
        await db.family_crew_oc_applications.delete_one({"family_id": family_id, "user_id": uid})
    now = datetime.now(timezone.utc).isoformat()
    application_id = str(uuid.uuid4())
    if fee > 0:
        if money < fee:
            return {"ok": False, "reason": "insufficient_cash", "fee": fee}
        await db.users.update_one({"id": uid}, {"$inc": {"money": -fee}})
        await db.families.update_one({"id": family_id}, {"$inc": {"treasury": fee}})
        await log_family_vault_tx(
            db,
            family_id,
            "crew_oc_join_fee",
            uid,
            username,
            cash_delta=fee,
            meta={"crew_oc_application": True},
        )
        st = "accepted" if auto_accept else "pending"
        await db.family_crew_oc_applications.insert_one({
            "id": application_id, "family_id": family_id, "user_id": uid,
            "username": username, "status": st, "amount_paid": fee, "created_at": now,
        })
        fam_name = (fam.get("name") or fam.get("tag") or "the family").strip()
        if auto_accept:
            await send_notification(uid, "Crew OC – You're in", f"You paid ${fee:,} and joined {fam_name} Crew OC for their next run.", "reward", category="crew_oc")
            await send_notification_to_family(family_id, "Crew OC – New crew member", f'{username} paid ${fee:,} and joined your Crew OC for the next run.', "reward", category="oc_invites", actor_username=username)
            _invalidate_my_cache(uid)
            return {"ok": True, "status": "accepted", "amount_paid": fee}
        await send_notification_to_family(family_id, "Crew OC application", f'{username} applied to your Crew OC (paid ${fee:,}). Accept or reject in Families → Crew OC.', "system", category="oc_invites", actor_username=username)
        _invalidate_my_cache(uid)
        return {"ok": True, "status": "pending", "amount_paid": fee}
    st0 = "accepted" if auto_accept else "pending"
    await db.family_crew_oc_applications.insert_one({
        "id": application_id, "family_id": family_id, "user_id": uid,
        "username": username, "status": st0, "amount_paid": 0, "created_at": now,
    })
    fam_name = (fam.get("name") or fam.get("tag") or "the family").strip()
    if auto_accept:
        await send_notification(uid, "Crew OC – You're in", f"You applied and joined {fam_name} Crew OC for their next run.", "reward", category="crew_oc")
        await send_notification_to_family(family_id, "Crew OC – New crew member", f'{username} applied and joined your Crew OC for the next run.', "reward", category="oc_invites", actor_username=username)
        _invalidate_my_cache(uid)
        return {"ok": True, "status": "accepted", "amount_paid": 0}
    await send_notification_to_family(family_id, "Crew OC application", f'{username} applied to your Crew OC. Accept or reject in Families → Crew OC.', "system", category="oc_invites", actor_username=username)
    _invalidate_my_cache(uid)
    return {"ok": True, "status": "pending", "amount_paid": 0}


async def run_crew_oc_auto_apply_tick_once(db) -> Dict[str, Any]:
    """One bounded pass: active token users × capped families; sequential; no large gather."""
    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()
    applies = 0
    capped = False
    cursor = db.users.find(
        {
            "crew_oc_auto_apply_until": {"$gt": now_iso},
            "crew_oc_auto_apply_max_fee": {"$gte": 0},
        },
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "family_id": 1,
            "money": 1,
            "crew_oc_auto_apply_max_fee": 1,
        },
    ).sort("crew_oc_auto_apply_until", 1).limit(CREW_OC_AUTO_APPLY_MAX_USERS_PER_TICK)
    users = await cursor.to_list(CREW_OC_AUTO_APPLY_MAX_USERS_PER_TICK)
    for u in users:
        try:
            uid = u.get("id")
            if not uid:
                continue
            raw_cap = u.get("crew_oc_auto_apply_max_fee")
            cap_val = int(raw_cap) if raw_cap is not None else 0
            my_fam = u.get("family_id")
            money = int(u.get("money") or 0)
            username = (u.get("username") or "?").strip() or "?"
            fam_q: Dict[str, Any] = {"wiped": {"$ne": True}, "crew_oc_join_fee": {"$lte": cap_val}}
            if my_fam:
                fam_q["id"] = {"$ne": my_fam}
            candidates = await db.families.find(
                fam_q,
                {"_id": 0, "id": 1, "crew_oc_join_fee": 1, "crew_oc_cooldown_until": 1},
            ).sort("crew_oc_join_fee", 1).limit(CREW_OC_AUTO_APPLY_MAX_FAMILIES_PER_USER).to_list(CREW_OC_AUTO_APPLY_MAX_FAMILIES_PER_USER)
            for fam in candidates:
                if applies >= CREW_OC_AUTO_APPLY_MAX_APPLIES_PER_TICK:
                    capped = True
                    return {"ok": True, "users_scanned": len(users), "applies": applies, "capped": capped}
                if not _crew_oc_family_is_auto_apply_eligible(fam, now_utc):
                    continue
                fid = fam.get("id")
                if not fid:
                    continue
                res = await _crew_oc_apply_user_to_family(
                    db,
                    str(uid),
                    username,
                    my_fam,
                    money,
                    str(fid),
                    max_join_fee_cap=cap_val,
                )
                if not res.get("ok"):
                    continue
                applies += 1
                try:
                    from utils.token_perk_stats import bump_token_perk_stats
                    await bump_token_perk_stats(db, str(uid), "crew_oc_auto_3h", applies=1)
                except Exception:
                    pass
                fresh = await db.users.find_one({"id": uid}, {"_id": 0, "money": 1})
                money = int((fresh or {}).get("money") or 0)
        except Exception:
            logger.warning("crew_oc_auto_apply tick user=%s", u.get("id"), exc_info=True)
        await asyncio.sleep(0)
    return {"ok": True, "users_scanned": len(users), "applies": applies, "capped": capped}


async def run_crew_oc_auto_apply_ticker():
    """Background loop (~60s + jitter). Prefer cron-only in multi-worker (CREW_OC_AUTO_APPLY_USE_CRON=1)."""
    while True:
        try:
            await run_crew_oc_auto_apply_tick_once(db)
        except Exception:
            logger.exception("crew_oc_auto_apply ticker tick failed")
        await asyncio.sleep(60 + _rng.random() * 15)


async def families_cron_crew_oc_auto_apply(_: None = Depends(verify_cron_secret_families)):
    """One bounded auto-apply pass. Schedule every 60s when CREW_OC_AUTO_APPLY_USE_CRON=1. Header: X-Cron-Secret."""
    return await run_crew_oc_auto_apply_tick_once(db)


async def run_crew_oc_auto_commit_tick_once(db) -> Dict[str, Any]:
    """Families with due ``crew_oc_auto_commit_due_at``: commit OC using Boss as actor (store timer on Boss)."""
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    cursor = db.families.find(
        {"crew_oc_auto_commit_due_at": {"$lte": now_iso}, **ACTIVE_FAMILY_FILTER},
        {"_id": 0, "id": 1},
    ).sort("crew_oc_auto_commit_due_at", 1).limit(CREW_OC_AUTO_COMMIT_MAX_FAMILIES_PER_TICK)
    rows = await cursor.to_list(CREW_OC_AUTO_COMMIT_MAX_FAMILIES_PER_TICK)
    committed = 0
    for row in rows:
        fid = row.get("id")
        if not fid:
            continue
        try:
            if await _family_in_active_war(fid):
                continue
            fam = await db.families.find_one(
                {"id": fid, **ACTIVE_FAMILY_FILTER},
                {"_id": 0, "boss_id": 1, "family_perks": 1, "crew_oc_forum_topic_id": 1, "crew_oc_auto_commit_topic_id": 1},
            )
            if not fam:
                await db.families.update_one({"id": fid}, {"$unset": {"crew_oc_auto_commit_due_at": "", "crew_oc_auto_commit_topic_id": ""}})
                continue
            perks = clean_family_perks(fam.get("family_perks"), now)
            if not perks.get("crew_oc_auto_commit"):
                await db.families.update_one({"id": fid}, {"$unset": {"crew_oc_auto_commit_due_at": "", "crew_oc_auto_commit_topic_id": ""}})
                continue
            if fam.get("crew_oc_auto_commit_topic_id") != fam.get("crew_oc_forum_topic_id"):
                await db.families.update_one({"id": fid}, {"$unset": {"crew_oc_auto_commit_due_at": "", "crew_oc_auto_commit_topic_id": ""}})
                continue
            boss_id = _uid_str(fam.get("boss_id"))
            if not boss_id:
                logger.warning("crew_oc_auto_commit: family %s has no boss_id", fid)
                await db.families.update_one({"id": fid}, {"$unset": {"crew_oc_auto_commit_due_at": "", "crew_oc_auto_commit_topic_id": ""}})
                continue
            boss = await db.users.find_one(
                {"id": boss_id},
                {"_id": 0, "id": 1, "username": 1, "crew_oc_timer_reduced": 1, "is_dead": 1},
            )
            if not boss or boss.get("is_dead"):
                logger.warning("crew_oc_auto_commit: boss missing or dead family=%s boss_id=%s", fid, boss_id)
                await db.families.update_one({"id": fid}, {"$unset": {"crew_oc_auto_commit_due_at": "", "crew_oc_auto_commit_topic_id": ""}})
                continue
            res = await _execute_crew_oc_commit(fid, boss, meta_extra={"crew_oc_auto_commit": True})
            if res.get("ok"):
                committed += 1
            else:
                await db.families.update_one({"id": fid}, {"$unset": {"crew_oc_auto_commit_due_at": "", "crew_oc_auto_commit_topic_id": ""}})
                detail = res.get("detail") or res.get("reason") or "commit failed"
                await send_notification(
                    boss_id,
                    "Crew OC auto-commit skipped",
                    f"Scheduled automatic OC commit did not run: {detail}. Commit manually from Families → Crew OC when ready.",
                    "system",
                    category="crew_oc",
                )
        except Exception:
            logger.warning("crew_oc_auto_commit tick family=%s", fid, exc_info=True)
        await asyncio.sleep(0)
    pickup = 0
    try:
        pickup_cursor = db.families.find(
            {
                "wiped": {"$ne": True},
                "family_perks.crew_oc_auto_commit": {"$exists": True},
                "$or": [
                    {"crew_oc_auto_commit_due_at": {"$exists": False}},
                    {"crew_oc_auto_commit_due_at": None},
                    {"crew_oc_auto_commit_due_at": ""},
                ],
            },
            {"_id": 0, "id": 1},
        ).limit(40)
        for prow in await pickup_cursor.to_list(40):
            pid = prow.get("id")
            if not pid:
                continue
            fam_p = await db.families.find_one(
                {"id": pid},
                {"_id": 0, "family_perks": 1, "crew_oc_forum_topic_id": 1, "crew_oc_cooldown_until": 1, "name": 1, "tag": 1, "boss_id": 1, "wiped": 1},
            )
            if not fam_p or fam_p.get("wiped"):
                continue
            perks_p = clean_family_perks(fam_p.get("family_perks"), now)
            if not perks_p.get("crew_oc_auto_commit"):
                continue
            if not _crew_oc_advertisement_window_allows(fam_p):
                continue
            await schedule_crew_oc_auto_commit_for_family(pid)
            pickup += 1
    except Exception:
        logger.exception("crew_oc_auto_commit pickup pass")
    return {"ok": True, "families_scanned": len(rows), "committed": committed, "pickup_scheduled": pickup}


async def run_crew_oc_auto_commit_ticker():
    """Background loop (~60s + jitter). Prefer cron-only in multi-worker (CREW_OC_AUTO_COMMIT_USE_CRON=1)."""
    while True:
        try:
            await run_crew_oc_auto_commit_tick_once(db)
        except Exception:
            logger.exception("crew_oc_auto_commit ticker tick failed")
        await asyncio.sleep(60 + _rng.random() * 15)


async def families_cron_crew_oc_auto_commit(_: None = Depends(verify_cron_secret_families)):
    """One bounded Crew OC auto-commit pass. Schedule ~60s when CREW_OC_AUTO_COMMIT_USE_CRON=1. Header: X-Cron-Secret."""
    return await run_crew_oc_auto_commit_tick_once(db)


async def families_crew_oc_advertise(current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can advertise Crew OC")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one(
        {"id": family_id, **ACTIVE_FAMILY_FILTER},
        {"_id": 0, "name": 1, "tag": 1, "crew_oc_forum_topic_id": 1, "crew_oc_cooldown_until": 1},
    )
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    if not _crew_oc_advertisement_window_allows(fam):
        raise HTTPException(
            status_code=400,
            detail=f"You can only create a Crew OC topic when your Crew OC is available or up to {CREW_OC_TOPIC_WINDOW_MINUTES} minutes before it becomes available.",
        )
    topic_id = await _crew_oc_insert_crew_oc_forum_ad(
        family_id,
        author_id=current_user["id"],
        author_username=current_user.get("username") or "?",
        fam_name=fam.get("name"),
        fam_tag=fam.get("tag"),
        content_extra="",
    )
    title = f"Crew OC: {fam.get('name')} [{fam.get('tag')}]"
    await schedule_crew_oc_auto_commit_for_family(family_id)
    _invalidate_my_cache(current_user["id"])
    return {"message": "Crew OC topic created.", "topic_id": topic_id, "title": title}


async def families_crew_oc_apply(request: FamilyCrewOCApplyRequest, current_user: dict = Depends(get_current_user)):
    family_id = (request.family_id or "").strip()
    if not family_id:
        raise HTTPException(status_code=400, detail="family_id required")
    uid = current_user["id"]
    uname = current_user.get("username") or "?"
    money = int(current_user.get("money") or 0)
    res = await _crew_oc_apply_user_to_family(
        db,
        uid,
        uname,
        current_user.get("family_id"),
        money,
        family_id,
        max_join_fee_cap=None,
    )
    if res.get("ok"):
        ap = int(res.get("amount_paid") or 0)
        st = res.get("status") or "pending"
        if st == "accepted" and ap > 0:
            return {"message": "You paid and joined the crew. You'll get rewards when they commit.", "status": "accepted", "amount_paid": ap}
        if st == "accepted":
            return {"message": "You joined the crew. You'll get rewards when they commit.", "status": "accepted"}
        if ap > 0:
            return {"message": "Application sent. The family will accept or reject.", "status": "pending", "amount_paid": ap}
        return {"message": "Application sent. The family will accept or reject.", "status": "pending"}
    reason = res.get("reason") or "unknown"
    if reason == "same_family":
        raise HTTPException(status_code=400, detail="You are already in this family")
    if reason == "family_not_found":
        raise HTTPException(status_code=404, detail="Family not found")
    if reason == "already_applied":
        raise HTTPException(status_code=400, detail=f"You already applied (status: {res.get('status')})")
    if reason == "insufficient_cash":
        fee = int(res.get("fee") or 0)
        raise HTTPException(status_code=400, detail=f"Join fee is ${fee:,}. You need ${fee - money:,} more cash.")
    if reason == "bad_family_id":
        raise HTTPException(status_code=400, detail="family_id required")
    raise HTTPException(status_code=400, detail="Could not apply to this family's Crew OC.")


async def families_crew_oc_applications(current_user: dict = Depends(get_current_user)):
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    role = (current_user.get("family_role") or "").strip().lower()
    apps = await db.family_crew_oc_applications.find({"family_id": family_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"applications": apps, "can_manage": role in ("boss", "underboss", "capo")}


async def families_crew_oc_accept(application_id: str, current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    app = await db.family_crew_oc_applications.find_one({"id": application_id, "family_id": family_id}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Application already processed")
    await db.family_crew_oc_applications.update_one({"id": application_id}, {"$set": {"status": "accepted"}})
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "name": 1, "tag": 1})
    fam_name = (fam or {}).get("name") or (fam or {}).get("tag") or "the family"
    await send_notification(app["user_id"], "Crew OC – Accepted", f"Your application to join {fam_name} Crew OC was accepted. You'll get rewards when they commit.", "reward", category="crew_oc")
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(app["user_id"])
    return {"message": "Application accepted."}


async def families_crew_oc_reject(application_id: str, current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    app = await db.family_crew_oc_applications.find_one({"id": application_id, "family_id": family_id}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Application already processed")
    await db.family_crew_oc_applications.update_one({"id": application_id}, {"$set": {"status": "rejected"}})
    amount_paid = int(app.get("amount_paid") or 0)
    refunded = 0
    if amount_paid > 0:
        refund_result = await db.families.find_one_and_update(
            {"id": family_id, "treasury": {"$gte": amount_paid}},
            {"$inc": {"treasury": -amount_paid}},
            return_document=False,
        )
        if refund_result:
            await db.users.update_one({"id": app["user_id"]}, {"$inc": {"money": amount_paid}})
            refunded = amount_paid
            ru = await db.users.find_one({"id": app["user_id"]}, {"_id": 0, "username": 1})
            await log_family_vault_tx(
                db,
                family_id,
                "crew_oc_refund",
                current_user["id"],
                current_user.get("username") or "?",
                cash_delta=-refunded,
                target_user_id=app["user_id"],
                target_username=(ru or {}).get("username") or "?",
                meta={"reason": "application_rejected"},
            )
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(app["user_id"])
    return {"message": "Application rejected." + (f" ${refunded:,} refunded." if refunded > 0 else " (Treasury insufficient for refund)" if amount_paid > 0 else "")}


async def families_crew_oc_kick(application_id: str, current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    app = await db.family_crew_oc_applications.find_one({"id": application_id, "family_id": family_id}, {"_id": 0})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("status") != "accepted":
        raise HTTPException(status_code=400, detail="Can only kick accepted crew members")
    await db.family_crew_oc_applications.update_one({"id": application_id}, {"$set": {"status": "kicked"}})
    amount_paid = int(app.get("amount_paid") or 0)
    refunded = 0
    if amount_paid > 0:
        refund_result = await db.families.find_one_and_update(
            {"id": family_id, "treasury": {"$gte": amount_paid}},
            {"$inc": {"treasury": -amount_paid}},
            return_document=False,
        )
        if refund_result:
            await db.users.update_one({"id": app["user_id"]}, {"$inc": {"money": amount_paid}})
            refunded = amount_paid
            ru = await db.users.find_one({"id": app["user_id"]}, {"_id": 0, "username": 1})
            await log_family_vault_tx(
                db,
                family_id,
                "crew_oc_refund",
                current_user["id"],
                current_user.get("username") or "?",
                cash_delta=-refunded,
                target_user_id=app["user_id"],
                target_username=(ru or {}).get("username") or "?",
                meta={"reason": "crew_oc_kick"},
            )
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "name": 1, "tag": 1})
    fam_name = (fam or {}).get("name") or (fam or {}).get("tag") or "the family"
    await send_notification(app["user_id"], "Crew OC – Kicked", f"You were removed from {fam_name} Crew OC." + (f" ${refunded:,} has been refunded." if refunded > 0 else ""), "system", category="crew_oc")
    _invalidate_my_cache(current_user["id"])
    _invalidate_my_cache(app["user_id"])
    return {"message": "Crew member kicked." + (f" ${refunded:,} refunded." if refunded > 0 else " (Treasury insufficient for refund)" if amount_paid > 0 else "")}


async def _execute_crew_oc_commit(
    family_id: str,
    actor_user_doc: dict,
    *,
    meta_extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Run Crew OC commit rewards and cooldown. ``actor_user_doc`` is used for vault log and store timer (Boss doc for auto-commit)."""
    aid = actor_user_doc.get("id")
    if not (family_id and aid):
        return {"ok": False, "reason": "bad_args", "detail": "Missing family or actor"}
    fam = await db.families.find_one(
        {"id": family_id},
        {"_id": 0, "name": 1, "tag": 1, "treasury": 1, "crew_oc_cooldown_until": 1, "crew_oc_forum_topic_id": 1},
    )
    if not fam:
        return {"ok": False, "reason": "not_found", "detail": "Family not found"}
    now = datetime.now(timezone.utc)
    cooldown_until = fam.get("crew_oc_cooldown_until")
    if cooldown_until:
        try:
            until = datetime.fromisoformat(str(cooldown_until).replace("Z", "+00:00"))
            if until > now:
                secs = int((until - now).total_seconds())
                return {"ok": False, "reason": "cooldown", "detail": f"Crew OC on cooldown. Try again in {secs}s"}
        except Exception:
            pass
    cd_info = await _crew_oc_effective_cooldown_info(family_id, aid)
    cooldown_hours = int(cd_info["hours"])
    new_cooldown_until = now + timedelta(hours=cooldown_hours)
    members = await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(100)
    member_ids = [m["user_id"] for m in members]
    accepted = await db.family_crew_oc_applications.find({"family_id": family_id, "status": "accepted"}, {"_id": 0, "user_id": 1}).to_list(50)
    accepted_ids = [a["user_id"] for a in accepted]
    roster_ids = list(dict.fromkeys(member_ids + accepted_ids))
    living = await db.users.find({"id": {"$in": roster_ids}, "is_dead": {"$ne": True}}, {"_id": 0, "id": 1, "rank_points": 1, "username": 1, "prestige_rank_multiplier": 1, "total_oc_heists": 1, "rank_xp_pass_rewards_granted": 1, "rank_xp_pass_token_expires_at": 1}).to_list(100)
    living_ids = [u["id"] for u in living]
    if not living_ids:
        return {"ok": False, "reason": "no_crew", "detail": "No living crew members"}
    fam_name = (fam.get("name") or fam.get("tag") or "Crew").strip() or "Crew"
    # Bigger crews pay better: +50 RP per participating member, for everyone.
    participant_rp_bonus = CREW_OC_REWARD_RP_PER_PARTICIPANT * len(living_ids)
    rp_reward = CREW_OC_REWARD_RP + participant_rp_bonus
    for u in living:
        uid = u["id"]
        rp_before = int(u.get("rank_points") or 0)
        oc_heists_before = int(u.get("total_oc_heists") or 0)
        respect_roll = _rng.randint(CREW_OC_REWARD_POINTS_MIN, CREW_OC_REWARD_POINTS_MAX)
        crew_oc_update = apply_season_rp_mirror_to_update(
            {
                "$inc": {
                    "rank_points": rp_reward,
                    "money": CREW_OC_REWARD_CASH,
                    "bullets": CREW_OC_REWARD_BULLETS,
                    "respect_points": respect_roll,
                    "booze": CREW_OC_REWARD_BOOZE,
                    "total_oc_heists": 1,
                }
            },
            user=u,
        )
        rp_awarded = rank_points_in_update(crew_oc_update)
        await db.users.update_one({"id": uid}, crew_oc_update)
        try:
            from routers.game.achievements import maybe_log_oc_heist_badge_tiers
            await maybe_log_oc_heist_badge_tiers(uid, oc_heists_before, username=u.get("username"))
        except Exception:
            pass
        if respect_roll:
            await log_respect_earned(uid, respect_roll, "crew_oc")
        try:
            await maybe_process_rank_up(uid, rp_before, rp_awarded, u.get("username", ""), user_prestige_rank_mult(u))
        except Exception:
            logging.exception("Rank-up notification (Crew OC)")
        await send_notification(
            uid,
            "Crew OC committed",
            f"{fam_name} committed the Organised Crime. You received +{rp_awarded} RP (incl. +{participant_rp_bonus} crew bonus for {len(living_ids)} participants), +${CREW_OC_REWARD_CASH:,} cash, +{CREW_OC_REWARD_BULLETS} bullets, +{respect_roll} respect points, +{CREW_OC_REWARD_BOOZE} booze. Family Treasury +${CREW_OC_TREASURY_LUMP:,}.",
            "reward",
            category="crew_oc",
        )
    await db.families.update_one(
        {"id": family_id},
        {
            "$inc": {"treasury": CREW_OC_TREASURY_LUMP},
            "$set": {"crew_oc_cooldown_until": new_cooldown_until.isoformat()},
            "$unset": {
                "crew_oc_forum_topic_id": "",
                "crew_oc_auto_commit_due_at": "",
                "crew_oc_auto_commit_topic_id": "",
            },
        },
    )
    meta = {
        "crew_oc_cooldown_until": new_cooldown_until.isoformat(),
        "cooldown_hours": cooldown_hours,
        "crew_oc_has_store_timer": cd_info["has_store_timer"],
        "crew_oc_perk_hours_off": cd_info["perk_hours_off"],
    }
    if meta_extra:
        meta.update(meta_extra)
    await log_family_vault_tx(
        db,
        family_id,
        "crew_oc_commit",
        aid,
        (actor_user_doc.get("username") or "?").strip() or "?",
        cash_delta=CREW_OC_TREASURY_LUMP,
        meta=meta,
    )
    await db.family_crew_oc_applications.delete_many({"family_id": family_id})
    topic_id = fam.get("crew_oc_forum_topic_id")
    if topic_id:
        await db.forum_topics.update_one({"id": topic_id}, {"$set": {"is_locked": True}})
    _invalidate_my_cache(aid)
    return {
        "ok": True,
        "crew_oc_cooldown_until": new_cooldown_until.isoformat(),
        "cooldown_hours": cooldown_hours,
    }


async def families_crew_oc_commit(current_user: dict = Depends(get_current_user)):
    if (current_user.get("family_role") or "").strip().lower() not in ("boss", "underboss", "capo"):
        raise HTTPException(status_code=403, detail="Only Boss, Underboss, or Capo can commit Crew OC")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    await db.families.update_one(
        {"id": family_id},
        {"$unset": {"crew_oc_auto_commit_due_at": "", "crew_oc_auto_commit_topic_id": ""}},
    )
    res = await _execute_crew_oc_commit(family_id, current_user)
    if not res.get("ok"):
        d = res.get("detail") or res.get("reason") or "Could not commit Crew OC"
        code = 404 if res.get("reason") == "not_found" else 400
        raise HTTPException(status_code=code, detail=d)
    return {
        "message": "Crew OC committed. All crew rewarded.",
        "crew_oc_cooldown_until": res["crew_oc_cooldown_until"],
        "cooldown_hours": res["cooldown_hours"],
    }


async def families_racket_collect(racket_id: str, current_user: dict = Depends(get_current_user)):
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    fam = await db.families.find_one(
        {"id": family_id, **ACTIVE_FAMILY_FILTER},
        {"_id": 0, "treasury": 1, "rackets": 1, "racket_income_bonus_percent": 1, "event_active_until": 1},
    )
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
    last_at = state.get("last_collected_at")
    now = datetime.now(timezone.utc)
    payout_breakdown = await _racket_payout_breakdown(
        racket_id,
        level,
        last_at,
        ev,
        fam,
        family_id,
        now=now,
        actor=current_user,
    )
    income_final = int(payout_breakdown["final_income"])
    cooldown_h = float(payout_breakdown["cooldown_hours"])
    today_utc = now.date().isoformat()
    last_bullet_payout_day = str(state.get("last_bullet_payout_day") or "")
    bullets_bonus = 0
    if level > 0 and last_bullet_payout_day != today_utc:
        bullets_bonus = max(1, int(round(level * RACKET_DAILY_BULLETS_PER_LEVEL)))
    if last_at:
        try:
            last_dt = datetime.fromisoformat(last_at.replace("Z", "+00:00"))
            war_sec = await _family_war_duration_seconds(family_id, last_dt, now)
            effective_cooldown_end = last_dt + timedelta(hours=cooldown_h) + timedelta(seconds=war_sec)
            if effective_cooldown_end > now:
                secs = max(1, int((effective_cooldown_end - now).total_seconds()))
                hrs = secs // 3600
                mins = (secs % 3600) // 60
                if hrs > 0:
                    detail = f"Racket on cooldown. Try again in {hrs}h {mins}m."
                else:
                    detail = f"Racket on cooldown. Try again in {mins}m."
                raise HTTPException(status_code=400, detail=detail)
        except HTTPException:
            raise
        except Exception:
            pass
    now_iso = now.isoformat()
    next_state = {**state, "level": level, "last_collected_at": now_iso}
    if bullets_bonus > 0:
        next_state["last_bullet_payout_day"] = today_utc
    rackets[racket_id] = next_state
    filter_cond: dict = {"id": family_id, **ACTIVE_FAMILY_FILTER}
    if last_at:
        filter_cond[f"rackets.{racket_id}.last_collected_at"] = last_at
    else:
        # Unlocks store last_collected_at: null (field exists). {"$exists": false} does not match null → update never ran.
        lc_key = f"rackets.{racket_id}.last_collected_at"
        filter_cond["$or"] = [{lc_key: {"$exists": False}}, {lc_key: None}]
    collect_result = await db.families.update_one(
        filter_cond,
        {
            "$set": {"rackets": rackets},
            "$inc": {"treasury": income_final, "treasury_bullets": bullets_bonus},
        },
    )
    if collect_result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Racket on cooldown. Another collection likely just happened.")
    await log_family_vault_tx(
        db,
        family_id,
        "racket_collect",
        current_user["id"],
        current_user.get("username") or "?",
        cash_delta=income_final,
        bullets_delta=bullets_bonus,
        meta={"racket_id": racket_id, "payout_breakdown": payout_breakdown},
    )
    try:
        from utils.family_daily_tasks import record_family_daily_activity

        await record_family_daily_activity(
            db,
            current_user["id"],
            "racket_collect",
            source_id=f"racket-collect:{family_id}:{racket_id}:{now_iso}",
            now=now,
        )
    except Exception:
        logger.exception("Family daily racket progress failed user_id=%s", current_user.get("id"))
    msg = _rng.choice(FAMILY_RACKET_COLLECT_SUCCESS_MESSAGES).format(income=income_final)
    if bullets_bonus > 0:
        msg = f"{msg} +{bullets_bonus} bullets."
    _invalidate_my_cache(current_user["id"])
    return {
        "message": msg,
        "amount": income_final,
        "bullets": bullets_bonus,
        "payout_breakdown": payout_breakdown,
    }


async def _family_daily_payload(current_user: dict) -> dict:
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in an active family")
    from utils.family_daily_tasks import get_today_family_objective

    payload = await get_today_family_objective(db, family_id, current_user["id"])
    if not payload:
        raise HTTPException(status_code=404, detail="Active family not found")
    return payload


async def families_daily_objective(current_user: dict = Depends(get_current_user)):
    return await _family_daily_payload(current_user)


async def families_daily_progress(current_user: dict = Depends(get_current_user)):
    payload = await _family_daily_payload(current_user)
    return {
        "family_id": payload["family_id"],
        "period": payload["period"],
        "objective_type": payload["objective_type"],
        "target": payload["target"],
        "my_progress": payload["my_progress"],
        "my_completed": payload["my_completed"],
        "my_eligible": payload["my_eligible"],
        "completion_count": payload["completion_count"],
        "eligible_count": payload["eligible_count"],
    }


async def families_daily_contributors(current_user: dict = Depends(get_current_user)):
    payload = await _family_daily_payload(current_user)
    return {
        "family_id": payload["family_id"],
        "period": payload["period"],
        "contributors": payload["contributors"],
    }


class FamilySafeDepositBody(BaseModel):
    cash: int = 0
    bullets: int = 0


async def families_safe_deposit_deposit(body: FamilySafeDepositBody, current_user: dict = Depends(get_current_user)):
    from utils.store_item_flags import require_store_item_allowed

    await require_store_item_allowed(db, "family_safe_deposit", current_user)
    family_id, _role = await _current_family_context(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    cash = max(0, int(body.cash or 0))
    bullets = max(0, int(body.bullets or 0))
    if cash <= 0 and bullets <= 0:
        raise HTTPException(status_code=400, detail="Deposit amount required")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "safe_deposit_cap": 1, "safe_deposit_tiers": 1, "safe_deposits_by_user": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    cap = family_safe_deposit_cap(fam)
    if cap <= 0:
        raise HTTPException(status_code=400, detail="Family safe deposit not unlocked — buy a tier from the Points Store")
    uid = current_user["id"]
    deposits = dict(fam.get("safe_deposits_by_user") or {})
    row = dict(deposits.get(uid) or {})
    cur_cash = int(row.get("cash") or 0)
    cur_bullets = int(row.get("bullets") or 0)
    if cur_cash + cash > cap:
        raise HTTPException(status_code=400, detail=f"Safe deposit cash cap is ${cap:,} per member")
    user_filt = {"id": uid}
    if cash:
        user_filt["money"] = {"$gte": cash}
    if bullets:
        user_filt["bullets"] = {"$gte": bullets}
    inc_user = {}
    if cash:
        inc_user["money"] = -cash
    if bullets:
        inc_user["bullets"] = -bullets
    if inc_user:
        ur = await db.users.update_one(user_filt, {"$inc": inc_user})
        if ur.modified_count == 0:
            raise HTTPException(status_code=400, detail="Insufficient cash or bullets")
    row["cash"] = cur_cash + cash
    row["bullets"] = cur_bullets + bullets
    row["updated_at"] = datetime.now(timezone.utc).isoformat()
    deposits[uid] = row
    await db.families.update_one({"id": family_id}, {"$set": {f"safe_deposits_by_user.{uid}": row}})
    await log_family_vault_tx(
        db, family_id, "safe_deposit_deposit", uid, current_user.get("username") or "?",
        cash_delta=cash, bullets_delta=bullets, meta={},
    )
    return {"message": "Deposited to your family safe.", "safe_deposit": row, "cap": cap}


async def families_safe_deposit_withdraw(body: FamilySafeDepositBody, current_user: dict = Depends(get_current_user)):
    from utils.store_item_flags import require_store_item_allowed

    await require_store_item_allowed(db, "family_safe_deposit", current_user)
    family_id, _role = await _current_family_context(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    cash = max(0, int(body.cash or 0))
    bullets = max(0, int(body.bullets or 0))
    if cash <= 0 and bullets <= 0:
        raise HTTPException(status_code=400, detail="Withdraw amount required")
    uid = current_user["id"]
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "safe_deposits_by_user": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    deposits = dict(fam.get("safe_deposits_by_user") or {})
    row = dict(deposits.get(uid) or {})
    cur_cash = int(row.get("cash") or 0)
    cur_bullets = int(row.get("bullets") or 0)
    if cash > cur_cash or bullets > cur_bullets:
        raise HTTPException(status_code=400, detail="Insufficient safe deposit balance")
    row["cash"] = cur_cash - cash
    row["bullets"] = cur_bullets - bullets
    row["updated_at"] = datetime.now(timezone.utc).isoformat()
    deposits[uid] = row
    await db.families.update_one({"id": family_id}, {"$set": {f"safe_deposits_by_user.{uid}": row}})
    inc_user = {}
    if cash:
        inc_user["money"] = cash
    if bullets:
        inc_user["bullets"] = bullets
    if inc_user:
        await db.users.update_one({"id": uid}, {"$inc": inc_user})
    await log_family_vault_tx(
        db, family_id, "safe_deposit_withdraw", uid, current_user.get("username") or "?",
        cash_delta=-cash, bullets_delta=-bullets, meta={},
    )
    return {"message": "Withdrawn from your family safe.", "safe_deposit": row}


async def families_racket_unlock(racket_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Rackets are locked until the family war is over")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1, "rackets": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    if racket_id not in [x["id"] for x in FAMILY_RACKETS]:
        raise HTTPException(status_code=404, detail="Racket not found")
    rackets = (fam.get("rackets") or {}).copy()
    state = rackets.get(racket_id) or {}
    level = state.get("level", 0)
    if level >= 1:
        raise HTTPException(status_code=400, detail="Racket already unlocked")
    prev_id = _racket_previous_id(racket_id)
    if prev_id:
        prev_level = (rackets.get(prev_id) or {}).get("level", 0)
        if prev_level < RACKET_MAX_LEVEL:
            prev_name = next((r["name"] for r in FAMILY_RACKETS if r["id"] == prev_id), prev_id)
            raise HTTPException(status_code=400, detail=f"Fully upgrade {prev_name} (level {RACKET_MAX_LEVEL}) before unlocking this racket")
    treasury = int((fam.get("treasury") or 0) or 0)
    if treasury < RACKET_UNLOCK_COST:
        raise HTTPException(status_code=400, detail=f"Not enough treasury (need ${RACKET_UNLOCK_COST:,})")
    rackets[racket_id] = {"level": 1, "last_collected_at": None}
    result = await db.families.update_one(
        {"id": family_id, "treasury": {"$gte": RACKET_UNLOCK_COST}},
        {"$set": {"rackets": rackets}, "$inc": {"treasury": -RACKET_UNLOCK_COST}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Not enough treasury (balance may have changed)")
    await log_family_vault_tx(
        db,
        family_id,
        "racket_unlock",
        current_user["id"],
        current_user.get("username") or "?",
        cash_delta=-RACKET_UNLOCK_COST,
        meta={"racket_id": racket_id},
    )
    _invalidate_my_cache(current_user["id"])
    return {"message": "Racket unlocked"}


async def families_racket_upgrade(racket_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Rackets are locked until the family war is over")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1, "rackets": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    if racket_id not in [x["id"] for x in FAMILY_RACKETS]:
        raise HTTPException(status_code=404, detail="Racket not found")
    rackets = (fam.get("rackets") or {}).copy()
    state = rackets.get(racket_id) or {}
    level = state.get("level", 0)
    if level <= 0:
        raise HTTPException(status_code=400, detail="Unlock this racket first (previous racket must be fully upgraded)")
    if level >= RACKET_MAX_LEVEL:
        raise HTTPException(status_code=400, detail="Racket already max level")
    treasury = int((fam.get("treasury") or 0) or 0)
    if treasury < RACKET_UPGRADE_COST:
        raise HTTPException(status_code=400, detail="Not enough treasury")
    rackets[racket_id] = {**state, "level": level + 1, "last_collected_at": state.get("last_collected_at")}
    result = await db.families.update_one(
        {"id": family_id, "treasury": {"$gte": RACKET_UPGRADE_COST}},
        {"$set": {"rackets": rackets}, "$inc": {"treasury": -RACKET_UPGRADE_COST}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Not enough treasury (balance may have changed)")
    await log_family_vault_tx(
        db,
        family_id,
        "racket_upgrade",
        current_user["id"],
        current_user.get("username") or "?",
        cash_delta=-RACKET_UPGRADE_COST,
        meta={"racket_id": racket_id, "new_level": level + 1},
    )
    _invalidate_my_cache(current_user["id"])
    return {"message": f"Upgraded to level {level + 1}"}


async def families_racket_armory_catalog(current_user: dict = Depends(get_current_user)):
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        return {"defence_catalog": FAMILY_RACKET_DEFENCE_UPGRADES, "offence_catalog": FAMILY_RACKET_OFFENCE_UPGRADES, "rackets": {}, "offence_upgrades": [], "offence_weight": 0}
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "rackets": 1, "racket_offence_upgrades": 1})
    rackets_raw = (fam or {}).get("rackets") or {}
    offence_upgrades = list((fam or {}).get("racket_offence_upgrades") or [])
    racket_owned = {}
    for rid in [x["id"] for x in FAMILY_RACKETS]:
        state = rackets_raw.get(rid) or {}
        owned = list(state.get("defence_upgrades") or [])
        racket_owned[rid] = {
            "defence_upgrades": owned,
            "defence_weight": _racket_defence_weight(owned),
            "level": int(state.get("level") or 0),
        }
    return {
        "defence_catalog": FAMILY_RACKET_DEFENCE_UPGRADES,
        "offence_catalog": FAMILY_RACKET_OFFENCE_UPGRADES,
        "rackets": racket_owned,
        "offence_upgrades": offence_upgrades,
        "offence_weight": _racket_offence_weight(offence_upgrades),
    }


async def families_racket_buy_defence(racket_id: str, request: FamilyRacketBuyDefenceRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Rackets are locked until the family war is over")
    upgrade = _FAMILY_RACKET_DEFENCE_BY_ID.get(request.upgrade_id)
    if not upgrade:
        raise HTTPException(status_code=404, detail="Defence upgrade not found")
    if racket_id not in [x["id"] for x in FAMILY_RACKETS]:
        raise HTTPException(status_code=404, detail="Racket not found")
    cost = int(upgrade.get("cost") or 0)
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1, "rackets": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    rackets = (fam.get("rackets") or {}).copy()
    state = rackets.get(racket_id) or {}
    level = int(state.get("level") or 0)
    if level <= 0:
        raise HTTPException(status_code=400, detail="Unlock this racket first")
    owned = list(state.get("defence_upgrades") or [])
    if request.upgrade_id in owned:
        raise HTTPException(status_code=400, detail="Already owned")
    treasury = int((fam.get("treasury") or 0) or 0)
    if treasury < cost:
        raise HTTPException(status_code=400, detail=f"Not enough treasury (need ${cost:,})")
    owned.append(request.upgrade_id)
    rackets[racket_id] = {**state, "defence_upgrades": owned}
    result = await db.families.update_one(
        {"id": family_id, "treasury": {"$gte": cost}},
        {"$set": {"rackets": rackets}, "$inc": {"treasury": -cost}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Not enough treasury (balance may have changed)")
    await log_family_vault_tx(
        db,
        family_id,
        "racket_defence_buy",
        current_user["id"],
        current_user.get("username") or "?",
        cash_delta=-cost,
        meta={"racket_id": racket_id, "upgrade_id": request.upgrade_id, "upgrade_name": upgrade.get("name")},
    )
    _invalidate_my_cache(current_user["id"])
    return {"message": f"Installed {upgrade.get('name')} on racket", "defence_weight": _racket_defence_weight(owned)}


async def families_racket_buy_offence(request: FamilyRacketBuyOffenceRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("family_role") not in ("boss", "underboss", "consigliere"):
        raise HTTPException(status_code=403, detail="Insufficient role")
    family_id = await _live_family_id_for_user(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(family_id):
        raise HTTPException(status_code=403, detail="Rackets are locked until the family war is over")
    upgrade = _FAMILY_RACKET_OFFENCE_BY_ID.get(request.upgrade_id)
    if not upgrade:
        raise HTTPException(status_code=404, detail="Offence upgrade not found")
    cost = int(upgrade.get("cost") or 0)
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "treasury": 1, "racket_offence_upgrades": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    owned = list(fam.get("racket_offence_upgrades") or [])
    if request.upgrade_id in owned:
        raise HTTPException(status_code=400, detail="Already owned")
    treasury = int((fam.get("treasury") or 0) or 0)
    if treasury < cost:
        raise HTTPException(status_code=400, detail=f"Not enough treasury (need ${cost:,})")
    owned.append(request.upgrade_id)
    result = await db.families.update_one(
        {"id": family_id, "treasury": {"$gte": cost}},
        {"$set": {"racket_offence_upgrades": owned}, "$inc": {"treasury": -cost}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Not enough treasury (balance may have changed)")
    await log_family_vault_tx(
        db,
        family_id,
        "racket_offence_buy",
        current_user["id"],
        current_user.get("username") or "?",
        cash_delta=-cost,
        meta={"upgrade_id": request.upgrade_id, "upgrade_name": upgrade.get("name")},
    )
    _invalidate_my_cache(current_user["id"])
    return {"message": f"Crew armory: {upgrade.get('name')} purchased", "offence_weight": _racket_offence_weight(owned)}


async def families_racket_attack_targets(debug: bool = False, current_user: dict = Depends(get_current_user)):
    my_family_id = await _live_family_id_for_user(current_user)
    if not my_family_id:
        return {"targets": []}
    atk_fam = await db.families.find_one({"id": my_family_id}, {"_id": 0, "racket_offence_upgrades": 1})
    offence_weight = _racket_offence_weight((atk_fam or {}).get("racket_offence_upgrades"))
    offence_take_mult = _compute_racket_raid_take_mult(offence_weight)
    all_other = await db.families.find(
        {"id": {"$ne": my_family_id}, **ACTIVE_FAMILY_FILTER},
        {"_id": 0, "id": 1, "name": 1, "tag": 1, "treasury": 1, "rackets": 1, "racket_income_bonus_percent": 1, "event_active_until": 1},
    ).to_list(50)
    ev = await get_effective_event()
    now = datetime.now(timezone.utc)
    targets = []
    for fam in all_other:
        rackets = fam.get("rackets") or {}
        racket_list = []
        for rid, state in rackets.items():
            lv = state.get("level", 0)
            if lv < 1:
                continue
            r_def = next((x for x in FAMILY_RACKETS if x["id"] == rid), None)
            last_at = state.get("last_collected_at")
            till_at_risk = await _racket_effective_till_amount(rid, lv, last_at, ev, fam, fam["id"], now=now)
            defence_upgrades = list(state.get("defence_upgrades") or [])
            defence_weight = _racket_defence_weight(defence_upgrades)
            success_chance = _compute_racket_raid_success(lv, offence_weight, defence_weight)
            success_chance_pct = int(round(success_chance * 100))
            potential_take = int(till_at_risk * FAMILY_RACKET_ATTACK_TILL_TAKE_PCT * offence_take_mult) if till_at_risk > 0 else 0
            racket_list.append({
                "racket_id": rid,
                "racket_name": r_def["name"] if r_def else rid,
                "level": lv,
                "till_at_risk": till_at_risk,
                "defence_weight": defence_weight,
                "defence_count": len(defence_upgrades),
                "potential_take": potential_take,
                "success_chance_pct": success_chance_pct,
                "offence_weight": offence_weight,
            })
        if racket_list:
            window_start = datetime.now(timezone.utc) - timedelta(hours=FAMILY_RACKET_ATTACK_CREW_WINDOW_HOURS)
            window_start_iso = window_start.isoformat()
            raids_on_crew = await db.family_racket_attacks.count_documents({"attacker_family_id": my_family_id, "target_family_id": fam["id"], "last_at": {"$gte": window_start_iso}})
            raids_used = min(raids_on_crew, FAMILY_RACKET_ATTACK_MAX_PER_CREW)
            raids_remaining = max(0, FAMILY_RACKET_ATTACK_MAX_PER_CREW - raids_used)
            next_raid_at = None
            if raids_remaining == 0 and raids_on_crew > 0:
                oldest = await db.family_racket_attacks.find(
                    {"attacker_family_id": my_family_id, "target_family_id": fam["id"], "last_at": {"$gte": window_start_iso}},
                    {"_id": 0, "last_at": 1},
                ).sort("last_at", 1).limit(1).to_list(1)
                if oldest:
                    la_raw = oldest[0].get("last_at")
                    if la_raw is not None:
                        la_s = str(la_raw).replace("Z", "+00:00")
                        try:
                            la_dt = datetime.fromisoformat(la_s)
                            if la_dt.tzinfo is None:
                                la_dt = la_dt.replace(tzinfo=timezone.utc)
                            next_raid_at = (la_dt + timedelta(hours=FAMILY_RACKET_ATTACK_CREW_WINDOW_HOURS)).isoformat()
                        except (ValueError, TypeError):
                            next_raid_at = None
            targets.append(
                {
                    "family_id": fam["id"],
                    "family_name": fam["name"],
                    "family_tag": fam["tag"],
                    "treasury": fam.get("treasury", 0),
                    "rackets": racket_list,
                    "raids_used": raids_used,
                    "raids_remaining": raids_remaining,
                    "next_raid_at": next_raid_at,
                    "offence_weight": offence_weight,
                }
            )
    return {"targets": targets, "offence_weight": offence_weight}


async def families_attack_racket(request: FamilyAttackRacketRequest, current_user: dict = Depends(get_current_user)):
    my_family_id = await _live_family_id_for_user(current_user)
    if not my_family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if await _family_in_active_war(my_family_id):
        raise HTTPException(status_code=403, detail="Racket raids are locked during family war")
    if await _family_in_active_war(request.family_id):
        raise HTTPException(status_code=403, detail="Target crew is at war — rackets are locked")
    target_fam = await db.families.find_one(
        {"id": request.family_id, **ACTIVE_FAMILY_FILTER},
        {"_id": 0, "name": 1, "tag": 1, "treasury": 1, "rackets": 1, "racket_income_bonus_percent": 1, "event_active_until": 1},
    )
    if not target_fam or request.family_id == my_family_id:
        raise HTTPException(status_code=404, detail="Family not found")
    state = (target_fam.get("rackets") or {}).get(request.racket_id) or {}
    level = state.get("level", 0)
    if level < 1:
        raise HTTPException(status_code=400, detail="Racket not active")
    lock = await _get_family_raid_lock(my_family_id, request.family_id)
    async with lock:
        window_start = datetime.now(timezone.utc) - timedelta(hours=FAMILY_RACKET_ATTACK_CREW_WINDOW_HOURS)
        raids_on_crew = await db.family_racket_attacks.count_documents({"attacker_family_id": my_family_id, "target_family_id": request.family_id, "last_at": {"$gte": window_start.isoformat()}})
        if raids_on_crew >= FAMILY_RACKET_ATTACK_MAX_PER_CREW:
            raise HTTPException(status_code=400, detail="Only 2 raids per family every 3 hours. You've used your raids on this crew.")
        target_fam = await db.families.find_one(
            {"id": request.family_id, **ACTIVE_FAMILY_FILTER},
            {"_id": 0, "name": 1, "tag": 1, "treasury": 1, "rackets": 1, "racket_income_bonus_percent": 1, "event_active_until": 1},
        )
        if not target_fam:
            raise HTTPException(status_code=404, detail="Family not found")
        state = (target_fam.get("rackets") or {}).get(request.racket_id) or {}
        level = int(state.get("level") or 0)
        if level < 1:
            raise HTTPException(status_code=400, detail="Racket not active")
        last_at = state.get("last_collected_at")
        atk_fam = await db.families.find_one({"id": my_family_id, **ACTIVE_FAMILY_FILTER}, {"_id": 0, "name": 1, "tag": 1, "racket_offence_upgrades": 1})
        offence_weight = _racket_offence_weight((atk_fam or {}).get("racket_offence_upgrades"))
        defence_upgrades = list(state.get("defence_upgrades") or [])
        defence_weight = _racket_defence_weight(defence_upgrades)
        ev = await get_effective_event()
        now = datetime.now(timezone.utc)
        till_at_risk = await _racket_effective_till_amount(request.racket_id, level, last_at, ev, target_fam, request.family_id, now=now)
        take_mult = _compute_racket_raid_take_mult(offence_weight)
        take = int(till_at_risk * FAMILY_RACKET_ATTACK_TILL_TAKE_PCT * take_mult) if till_at_risk > 0 else 0
        success_chance = _compute_racket_raid_success(level, offence_weight, defence_weight)
        success = _rng.random() < success_chance
        now_iso = now.isoformat()
        await db.family_racket_attacks.insert_one({"attacker_family_id": my_family_id, "target_family_id": request.family_id, "target_racket_id": request.racket_id, "last_at": now_iso})
        r_def = next((x for x in FAMILY_RACKETS if x["id"] == request.racket_id), None)
        racket_name = r_def["name"] if r_def else request.racket_id
        family_name = target_fam.get("name") or "Enemy"
        atk_label = (atk_fam or {}).get("name") or (atk_fam or {}).get("tag") or my_family_id
        destroyed_id = None
        destroyed_name = None
        actual = 0
        if success:
            new_defence = list(defence_upgrades)
            if new_defence:
                destroyed_id = _rng.choice(new_defence)
                new_defence = [x for x in new_defence if x != destroyed_id]
                destroyed_row = _FAMILY_RACKET_DEFENCE_BY_ID.get(destroyed_id)
                destroyed_name = (destroyed_row or {}).get("name") or destroyed_id
            new_state = {**state, "last_collected_at": now_iso, "defence_upgrades": new_defence}
            filter_cond: dict = {"id": request.family_id}
            lc_key = f"rackets.{request.racket_id}.last_collected_at"
            if last_at:
                filter_cond[lc_key] = last_at
            else:
                filter_cond["$or"] = [{lc_key: {"$exists": False}}, {lc_key: None}]
            victim_result = await db.families.update_one(filter_cond, {"$set": {f"rackets.{request.racket_id}": new_state}})
            if victim_result.modified_count > 0:
                actual = take if take > 0 else 0
                if actual > 0:
                    await db.families.update_one({"id": my_family_id}, {"$inc": {"treasury": actual}})
                    await log_family_vault_tx(
                        db,
                        request.family_id,
                        "racket_till_lost",
                        current_user["id"],
                        current_user.get("username") or "?",
                        cash_delta=-actual,
                        meta={
                            "attacker_family_id": my_family_id,
                            "attacker_family_name": atk_label,
                            "racket_id": request.racket_id,
                            "racket_name": racket_name,
                            "till_stolen": actual,
                        },
                    )
                    await log_family_vault_tx(
                        db,
                        my_family_id,
                        "racket_raid_won",
                        current_user["id"],
                        current_user.get("username") or "?",
                        cash_delta=actual,
                        meta={
                            "target_family_id": request.family_id,
                            "target_family_name": family_name,
                            "racket_id": request.racket_id,
                            "racket_name": racket_name,
                            "till_stolen": actual,
                            "defence_destroyed": destroyed_name,
                        },
                    )
                if destroyed_id:
                    await log_family_vault_tx(
                        db,
                        request.family_id,
                        "racket_defence_destroyed",
                        current_user["id"],
                        current_user.get("username") or "?",
                        cash_delta=0,
                        meta={
                            "attacker_family_id": my_family_id,
                            "attacker_family_name": atk_label,
                            "racket_id": request.racket_id,
                            "racket_name": racket_name,
                            "upgrade_id": destroyed_id,
                            "upgrade_name": destroyed_name,
                        },
                    )
            else:
                actual = 0
                destroyed_id = None
                destroyed_name = None
        if success:
            msg = _rng.choice(FAMILY_RACKET_RAID_SUCCESS_MESSAGES).format(amount=actual, family_name=family_name, racket_name=racket_name)
            if destroyed_name:
                msg = f"{msg} Destroyed their {destroyed_name}."
            _invalidate_list_cache()
            _invalidate_my_cache(current_user["id"])
            return {
                "success": True,
                "message": msg,
                "amount": actual,
                "till_stolen": actual,
                "defence_destroyed": destroyed_name,
                "success_chance_pct": int(round(success_chance * 100)),
            }
        fail_msg = _rng.choice(FAMILY_RACKET_RAID_FAIL_MESSAGES).format(family_name=family_name, racket_name=racket_name)
        return {
            "success": False,
            "message": fail_msg,
            "amount": 0,
            "success_chance_pct": int(round(success_chance * 100)),
        }


async def _current_family_context(current_user: dict) -> tuple[Optional[str], Optional[str]]:
    """Resolve current family and role from token first, then live roster membership."""
    uid = current_user.get("id")
    family_id = _norm_fid(current_user.get("family_id"))
    if family_id and not await _family_exists(family_id):
        await db.users.update_one(
            _user_id_filter_for_users_collection(uid),
            {"$set": {"family_id": None, "family_role": None}},
        )
        current_user["family_id"] = None
        current_user["family_role"] = None
        _invalidate_my_cache(str(uid or ""))
        family_id = None
    if not family_id and uid:
        family_id = _norm_fid(await resolve_family_id(uid))
    role = (current_user.get("family_role") or "").strip().lower() or None
    if role == "don":
        role = "boss"
    if family_id and uid and (not role or _norm_fid(current_user.get("family_id")) != family_id):
        variants = _user_id_variants_for_family_members(uid)
        member = await db.family_members.find_one(
            {"family_id": family_id, "user_id": {"$in": variants}},
            {"_id": 0, "role": 1},
        ) if variants else None
        role = ((member or {}).get("role") or role or "").strip().lower() or None
        if role == "don":
            role = "boss"
        if role not in ("boss", "underboss") and variants:
            fam = await db.families.find_one({"id": family_id}, {"_id": 0, "boss_id": 1})
            bid = _uid_str((fam or {}).get("boss_id"))
            if bid and any(_uid_str(v) == bid for v in variants):
                role = "boss"
    return family_id, role


async def _live_family_id_for_user(current_user: dict) -> Optional[str]:
    """Return only live membership, clearing a stale memorial pointer."""
    family_id, _role = await _current_family_context(current_user)
    return family_id


async def families_war(current_user: dict = Depends(get_current_user)):
    """Lightweight: list active wars for current user's family (e.g. for sidebar badge)."""
    my_family_id, _role = await _current_family_context(current_user)
    if not my_family_id:
        return {"wars": []}
    wars = await db.family_wars.find(
        {"$or": [{"family_a_id": my_family_id}, {"family_b_id": my_family_id}], "status": {"$in": ["active", "truce_offered"]}},
        {"_id": 0, "id": 1, "status": 1}
    ).to_list(10)
    return {"wars": [{"id": w["id"], "status": w.get("status", "active")} for w in wars]}


async def families_war_stats(current_user: dict = Depends(get_current_user)):
    my_family_id, _role = await _current_family_context(current_user)
    if not my_family_id:
        return {"wars": []}

    wars = await db.family_wars.find(
        {"$or": [{"family_a_id": my_family_id}, {"family_b_id": my_family_id}], "status": {"$in": ["active", "truce_offered"]}},
        {"_id": 0},
    ).to_list(10)
    if not wars:
        return {"wars": []}

    war_ids = [w["id"] for w in wars]
    war_meta = []
    other_ids_set = set()
    for w in wars:
        war_fid_a = _norm_fid(w["family_a_id"])
        war_fid_b = _norm_fid(w["family_b_id"])
        other_id = war_fid_b if war_fid_a == my_family_id else war_fid_a
        war_meta.append((w, war_fid_a, war_fid_b, other_id))
        if other_id:
            other_ids_set.add(other_id)

    other_fams = {}
    if other_ids_set:
        async for f in db.families.find({"id": {"$in": list(other_ids_set)}}, {"_id": 0, "id": 1, "name": 1, "tag": 1}):
            if f.get("id"):
                other_fams[f["id"]] = f

    all_stats = await db.family_war_stats.find({"war_id": {"$in": war_ids}}, {"_id": 0}).to_list(5000)
    stats_by_war: dict = defaultdict(list)
    for s in all_stats:
        wid = s.get("war_id")
        if wid:
            stats_by_war[wid].append(s)

    need_resolve_uids = set()
    all_uids = set()
    all_fids = set()
    for (w, war_fid_a, war_fid_b, _other_id) in war_meta:
        for s in stats_by_war.get(w["id"], []):
            uid = s.get("user_id")
            if not uid:
                continue
            all_uids.add(uid)
            fid = _norm_fid(s.get("family_id"))
            if fid in (war_fid_a, war_fid_b):
                all_fids.add(fid)
            else:
                need_resolve_uids.add(uid)

    resolve_map = await _batch_resolve_family_ids(list(need_resolve_uids))
    for _uid, rfid in resolve_map.items():
        if rfid:
            all_fids.add(rfid)

    user_map = {}
    if all_uids:
        async for u in db.users.find({"id": {"$in": list(all_uids)}}, {"_id": 0, "id": 1, "username": 1}):
            if u.get("id"):
                user_map[u["id"]] = u

    fam_map = {}
    if all_fids:
        async for f in db.families.find({"id": {"$in": list(all_fids)}}, {"_id": 0, "id": 1, "name": 1, "tag": 1}):
            if f.get("id"):
                fam_map[f["id"]] = f

    out = []
    for (w, war_fid_a, war_fid_b, other_id) in war_meta:
        other_fam = other_fams.get(other_id, {})
        other_name = (other_fam or {}).get("name", "?")
        other_tag = (other_fam or {}).get("tag", "?")

        by_user: dict = {}
        for s in stats_by_war.get(w["id"], []):
            uid = s.get("user_id")
            if not uid:
                continue
            u = user_map.get(uid, {})
            fid = _norm_fid(s.get("family_id"))
            if fid not in (war_fid_a, war_fid_b):
                fid = resolve_map.get(uid) or fid
            fam_doc = fam_map.get(fid) if fid else None
            by_user[uid] = {
                **s,
                "family_id": fid,
                "family_name": (fam_doc or {}).get("name", "?"),
                "family_tag": (fam_doc or {}).get("tag", "?"),
                "username": u.get("username", "?"),
                "impact": (s.get("kills") or 0) + (s.get("bodyguard_kills") or 0),
            }

        all_entries = list(by_user.values())

        def _totals(fid):
            members = [e for e in all_entries if _norm_fid(e.get("family_id")) == fid]
            return {
                "kills": sum(e.get("kills") or 0 for e in members),
                "deaths": sum(e.get("deaths") or 0 for e in members),
                "bodyguard_kills": sum(e.get("bodyguard_kills") or 0 for e in members),
                "bodyguards_lost": sum(e.get("bodyguards_lost") or 0 for e in members),
            }

        my_totals = _totals(my_family_id)
        other_totals = _totals(other_id)

        top_bg = sorted(all_entries, key=lambda x: (-(x.get("bodyguard_kills") or 0), x.get("username", "")))[:10]
        top_lost = sorted(all_entries, key=lambda x: (-(x.get("bodyguards_lost") or 0), x.get("username", "")))[:10]
        top_killers = sorted(all_entries, key=lambda x: (-(x.get("kills") or 0), x.get("username", "")))[:10]
        mvp = sorted(all_entries, key=lambda x: (-(x.get("impact") or 0), x.get("username", "")))[:10]

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
                "truce_offered_at": w.get("truce_offered_at"),
                "truce_cooldown_until": w.get("truce_cooldown_until"),
                "truce_timeout_minutes": 30,
            },
            "stats": {
                "my_family_totals": my_totals,
                "other_family_totals": other_totals,
                "top_bodyguard_killers": top_bg,
                "top_bodyguards_lost": top_lost,
                "top_killers": top_killers,
                "mvp": mvp,
            },
        })
    return {"wars": out}


TRUCE_OFFER_TIMEOUT_MINUTES = 30
TRUCE_COOLDOWN_HOURS = 24


async def _check_and_expire_truce(war: dict) -> dict | None:
    """Check if a truce offer has expired. If so, reset to active and set cooldown. Returns updated war or None."""
    if war.get("status") != "truce_offered":
        return None
    offered_at = war.get("truce_offered_at")
    if not offered_at:
        return None
    try:
        offered_dt = datetime.fromisoformat(offered_at.replace("Z", "+00:00"))
    except Exception:
        return None
    now = datetime.now(timezone.utc)
    if now > offered_dt + timedelta(minutes=TRUCE_OFFER_TIMEOUT_MINUTES):
        cooldown_until = (now + timedelta(hours=TRUCE_COOLDOWN_HOURS)).isoformat()
        await db.family_wars.update_one(
            {"id": war["id"], "status": "truce_offered"},
            {"$set": {"status": "active", "truce_cooldown_until": cooldown_until}, "$unset": {"truce_offered_by_family_id": "", "truce_offered_at": ""}},
        )
        return await db.family_wars.find_one({"id": war["id"]}, {"_id": 0})
    return None


async def families_war_truce_offer(request: WarTruceRequest, current_user: dict = Depends(get_current_user)):
    family_id, family_role = await _current_family_context(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if family_role not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Boss or Underboss can offer truce")
    war = await db.family_wars.find_one({"id": request.war_id}, {"_id": 0})
    if not war or war.get("status") not in ("active", "truce_offered"):
        raise HTTPException(status_code=404, detail="War not found or not active")
    if family_id not in (war["family_a_id"], war["family_b_id"]):
        raise HTTPException(status_code=403, detail="Not your war")
    expired = await _check_and_expire_truce(war)
    if expired:
        war = expired
    if war.get("status") == "truce_offered":
        if war.get("truce_offered_by_family_id") == family_id:
            return {"message": "Truce already offered"}
        raise HTTPException(status_code=400, detail="A truce offer is already pending from the other side")
    cooldown_until = war.get("truce_cooldown_until")
    if cooldown_until:
        try:
            cooldown_dt = datetime.fromisoformat(cooldown_until.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) < cooldown_dt:
                remaining = cooldown_dt - datetime.now(timezone.utc)
                hours_left = int(remaining.total_seconds() // 3600)
                mins_left = int((remaining.total_seconds() % 3600) // 60)
                raise HTTPException(status_code=400, detail=f"Truce on cooldown. Try again in {hours_left}h {mins_left}m.")
        except HTTPException:
            raise
        except Exception:
            pass
    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db.family_wars.update_one(
        {"id": request.war_id, "status": "active"},
        {"$set": {"status": "truce_offered", "truce_offered_by_family_id": family_id, "truce_offered_at": now_iso}},
    )
    if result.modified_count == 0:
        return {"message": "Truce already offered or war ended"}
    await send_notification_to_family(war["family_a_id"] if war["family_b_id"] == family_id else war["family_b_id"], "Truce offered", f"The enemy family has offered a truce. Boss or Underboss has {TRUCE_OFFER_TIMEOUT_MINUTES} minutes to accept.", "system")
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])
    return {"message": "Truce offered"}


async def families_war_truce_accept(request: WarTruceRequest, current_user: dict = Depends(get_current_user)):
    family_id, family_role = await _current_family_context(current_user)
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    if family_role not in ("boss", "underboss"):
        raise HTTPException(status_code=403, detail="Only Boss or Underboss can accept truce")
    war = await db.family_wars.find_one({"id": request.war_id}, {"_id": 0})
    if not war or war.get("status") != "truce_offered":
        raise HTTPException(status_code=404, detail="War not found or no truce offered")
    if family_id not in (war["family_a_id"], war["family_b_id"]):
        raise HTTPException(status_code=403, detail="Not your war")
    if war.get("truce_offered_by_family_id") == family_id:
        raise HTTPException(status_code=400, detail="You offered the truce; the other side must accept")
    expired = await _check_and_expire_truce(war)
    if expired:
        raise HTTPException(status_code=400, detail="Truce offer has expired. A new truce cannot be offered for 24 hours.")
    now = datetime.now(timezone.utc).isoformat()
    result = await db.family_wars.update_one(
        {"id": request.war_id, "status": "truce_offered"},
        {"$set": {"status": "truce", "ended_at": now}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="War already ended or truce withdrawn")
    await send_notification_to_family(war["family_a_id"], "🤝 Truce accepted", "The war has ended by truce.", "system")
    await send_notification_to_family(war["family_b_id"], "🤝 Truce accepted", "The war has ended by truce.", "system")
    _invalidate_list_cache()
    _invalidate_my_cache(current_user["id"])
    return {"message": "Truce accepted. War ended."}


async def families_wars_history(current_user: dict = Depends(get_current_user)):
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
        loser_id = w.get("loser_family_id")
        winner_fam = family_map.get(winner_id, {}) if winner_id else {}
        # Use names stored on the war document when family was defeated (so we keep the name even if family later deleted)
        family_a_name = fa.get("name") or (w.get("winner_family_name") if w.get("family_a_id") == winner_id else w.get("loser_family_name") if w.get("family_a_id") == loser_id else None) or "?"
        family_b_name = fb.get("name") or (w.get("winner_family_name") if w.get("family_b_id") == winner_id else w.get("loser_family_name") if w.get("family_b_id") == loser_id else None) or "?"
        family_a_tag = fa.get("tag") or "?"
        family_b_tag = fb.get("tag") or "?"
        winner_family_name = winner_fam.get("name") or w.get("winner_family_name") or "?"
        out.append({"id": w["id"], "family_a_id": w["family_a_id"], "family_b_id": w["family_b_id"], "family_a_name": family_a_name, "family_a_tag": family_a_tag, "family_b_name": family_b_name, "family_b_tag": family_b_tag, "status": w.get("status", "active"), "winner_family_id": winner_id, "winner_family_name": winner_family_name, "ended_at": w.get("ended_at"), "prize_exclusive_cars": w.get("prize_exclusive_cars"), "prize_rackets": w.get("prize_rackets") or []})
    return {"wars": out}


async def families_dashboard(current_user: dict = Depends(get_current_user)):
    """Single round-trip for family page wave-1 data (list, my crew, config, war history, events)."""
    from routers.game.events import get_active_event

    families, my_family, config, history, events = await asyncio.gather(
        families_list(current_user),
        families_my(current_user),
        families_config(current_user),
        families_wars_history(current_user),
        get_active_event(current_user),
    )
    return {
        "families": families,
        "my_family": my_family,
        "config": config,
        "war_history": history.get("wars") or [],
        "event": events.get("event"),
        "events_enabled": bool(events.get("events_enabled")),
    }


async def admin_debug_war_stats(current_user: dict = Depends(get_current_user)):
    """Admin: return raw family_war_stats and family_wars for debugging vendetta BG kill issues."""
    from server import _is_admin
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    wars = await db.family_wars.find({"status": {"$in": ["active", "truce_offered"]}}, {"_id": 0}).to_list(20)
    war_ids = [w["id"] for w in wars]
    fam_ids = set()
    for w in wars:
        if w.get("family_a_id"):
            fam_ids.add(w["family_a_id"])
        if w.get("family_b_id"):
            fam_ids.add(w["family_b_id"])
    fam_map = {}
    if fam_ids:
        async for f in db.families.find({"id": {"$in": list(fam_ids)}}, {"_id": 0, "id": 1, "name": 1}):
            if f.get("id"):
                fam_map[f["id"]] = f
    all_stats = await db.family_war_stats.find({"war_id": {"$in": war_ids}}, {"_id": 0}).to_list(2000)
    stats_by_war: dict = defaultdict(list)
    for s in all_stats:
        wid = s.get("war_id")
        if wid:
            stats_by_war[wid].append(s)
    result = []
    for w in wars:
        wid = w["id"]
        stats = stats_by_war.get(wid, [])
        fa = fam_map.get(w.get("family_a_id"), {})
        fb = fam_map.get(w.get("family_b_id"), {})
        result.append({
            "war_id": wid,
            "family_a": w.get("family_a_id"), "family_a_name": fa.get("name"),
            "family_b": w.get("family_b_id"), "family_b_name": fb.get("name"),
            "status": w.get("status"),
            "stat_count": len(stats),
            "stats": stats,
        })
    return {"wars": result}


async def admin_force_truce_family_war(
    war_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Admin: end an active or truce-pending war immediately (same outcome as players accepting a truce)."""
    from server import _is_admin

    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    wid = (war_id or "").strip()
    if not wid:
        raise HTTPException(status_code=400, detail="war_id required")
    war = await db.family_wars.find_one({"id": wid}, {"_id": 0})
    if not war:
        raise HTTPException(status_code=404, detail="War not found")
    st = war.get("status")
    if st not in ("active", "truce_offered"):
        raise HTTPException(status_code=400, detail="War is not active (already ended)")
    now = datetime.now(timezone.utc).isoformat()
    result = await db.family_wars.update_one(
        {"id": wid, "status": {"$in": ["active", "truce_offered"]}},
        {
            "$set": {"status": "truce", "ended_at": now},
            "$unset": {"truce_offered_by_family_id": "", "truce_offered_at": ""},
        },
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="War already ended or was updated")
    fa = war.get("family_a_id")
    fb = war.get("family_b_id")
    msg = "A game administrator ended your family war by truce. Vault and rackets are unlocked."
    if fa:
        await send_notification_to_family(fa, "🤝 War ended (staff)", msg, "system")
    if fb:
        await send_notification_to_family(fb, "🤝 War ended (staff)", msg, "system")
    _invalidate_list_cache()
    fam_ids = [x for x in (fa, fb) if x]
    if fam_ids:
        member_rows = await db.family_members.find(
            {"family_id": {"$in": fam_ids}},
            {"_id": 0, "user_id": 1},
        ).to_list(600)
        for m in member_rows:
            uid = m.get("user_id")
            if uid:
                _invalidate_my_cache(str(uid))
    _invalidate_my_cache(current_user.get("id") or "")
    await log_activity(
        current_user.get("id") or "",
        current_user.get("username") or "?",
        "admin_family_war_force_truce",
        {"war_id": wid, "family_a_id": fa, "family_b_id": fb, "previous_status": st},
    )
    return {"message": "War ended by admin truce.", "war_id": wid}


async def families_war_feed(war_id: str, current_user: dict = Depends(get_current_user)):
    """Return the kill-event feed for a specific war plus aggregated totals. Public to all authenticated users."""
    war = await db.family_wars.find_one({"id": war_id}, {"_id": 0, "family_a_id": 1, "family_b_id": 1, "status": 1})
    if not war:
        raise HTTPException(status_code=404, detail="War not found")

    docs = await db.war_kill_feed.find({"war_id": war_id}, {"_id": 0}).sort("created_at", -1).to_list(200)

    # Resolve any missing usernames from DB
    uid_set = set()
    for d in docs:
        if not d.get("killer_username") or d.get("killer_username") == "?":
            uid_set.add(d.get("killer_id"))
        if not d.get("victim_username") or d.get("victim_username") == "?":
            uid_set.add(d.get("victim_id"))
    uid_set.discard(None)
    if uid_set:
        users = await db.users.find({"id": {"$in": list(uid_set)}}, {"_id": 0, "id": 1, "username": 1}).to_list(200)
        umap = {u["id"]: u.get("username", "?") for u in users}
        for d in docs:
            if not d.get("killer_username") or d.get("killer_username") == "?":
                d["killer_username"] = umap.get(d.get("killer_id"), "?")
            if not d.get("victim_username") or d.get("victim_username") == "?":
                d["victim_username"] = umap.get(d.get("victim_id"), "?")

    # Aggregate bullets used and bodyguard points spent per family
    war_over = war.get("status") not in ("active", "truce_offered")
    fid_a = _norm_fid(war["family_a_id"])
    fid_b = _norm_fid(war["family_b_id"])
    totals: dict = {
        fid_a: {"bullets_used": 0, "molotovs_used": 0, "bg_points_spent": 0},
        fid_b: {"bullets_used": 0, "molotovs_used": 0, "bg_points_spent": 0},
    }
    for d in docs:
        fid = _norm_fid(d.get("killer_family_id"))
        if fid in totals:
            totals[fid]["bullets_used"] += int(d.get("bullets_used") or 0)
            totals[fid]["molotovs_used"] += int(d.get("molotovs_used") or 0)
        # bg_hire_cost is charged to the VICTIM family (they paid for the BG)
        victim_fid = _norm_fid(d.get("victim_family_id"))
        if victim_fid in totals:
            totals[victim_fid]["bg_points_spent"] += int(d.get("bg_hire_cost") or 0)

    my_family_id = current_user.get("family_id")
    my_fid = _norm_fid(my_family_id) if my_family_id else fid_a
    other_fid = fid_b if my_fid == fid_a else fid_a

    return {
        "feed": docs,
        "war_over": war_over,
        "my_totals": totals.get(my_fid, {"bullets_used": 0, "molotovs_used": 0, "bg_points_spent": 0}),
        "other_totals": totals.get(other_fid, {"bullets_used": 0, "molotovs_used": 0, "bg_points_spent": 0}),
        "family_a_id": fid_a,
        "family_b_id": fid_b,
    }


async def families_war_public_stats(war_id: str, current_user: dict = Depends(get_current_user)):
    """Public per-player stats for any war, readable by all authenticated users."""
    war = await db.family_wars.find_one({"id": war_id}, {"_id": 0})
    if not war:
        raise HTTPException(status_code=404, detail="War not found")

    fid_a = _norm_fid(war["family_a_id"])
    fid_b = _norm_fid(war["family_b_id"])
    fam_a = await db.families.find_one({"id": fid_a}, {"_id": 0, "name": 1, "tag": 1}) or {}
    fam_b = await db.families.find_one({"id": fid_b}, {"_id": 0, "name": 1, "tag": 1}) or {}
    winner_id = _norm_fid(war.get("winner_family_id"))
    loser_id = _norm_fid(war.get("loser_family_id"))
    family_a_name = fam_a.get("name") or (war.get("winner_family_name") if fid_a == winner_id else war.get("loser_family_name") if fid_a == loser_id else None) or "?"
    family_b_name = fam_b.get("name") or (war.get("winner_family_name") if fid_b == winner_id else war.get("loser_family_name") if fid_b == loser_id else None) or "?"
    family_a_tag = fam_a.get("tag") or "?"
    family_b_tag = fam_b.get("tag") or "?"

    stats_docs = await db.family_war_stats.find({"war_id": war_id}, {"_id": 0}).to_list(500)
    by_user: dict = {}
    for s in stats_docs:
        uid = s.get("user_id")
        if not uid:
            continue
        u = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1})
        fid = _norm_fid(s.get("family_id"))
        if fid not in (fid_a, fid_b):
            fid = await resolve_family_id(uid)
        fam_doc = await db.families.find_one({"id": fid}, {"_id": 0, "name": 1, "tag": 1}) if fid else None
        by_user[uid] = {
            **s,
            "family_id": fid,
            "family_name": (fam_doc or {}).get("name", "?"),
            "family_tag": (fam_doc or {}).get("tag", "?"),
            "username": (u or {}).get("username", "?"),
            "impact": (s.get("kills") or 0) + (s.get("bodyguard_kills") or 0),
        }

    all_entries = list(by_user.values())

    def _totals(fid):
        members = [e for e in all_entries if _norm_fid(e.get("family_id")) == fid]
        return {
            "kills": sum(e.get("kills") or 0 for e in members),
            "deaths": sum(e.get("deaths") or 0 for e in members),
            "bodyguard_kills": sum(e.get("bodyguard_kills") or 0 for e in members),
            "bodyguards_lost": sum(e.get("bodyguards_lost") or 0 for e in members),
        }

    return {
        "war": {
            "id": war["id"],
            "family_a_id": fid_a,
            "family_a_name": family_a_name,
            "family_a_tag": family_a_tag,
            "family_b_id": fid_b,
            "family_b_name": family_b_name,
            "family_b_tag": family_b_tag,
            "status": war.get("status"),
            "ended_at": war.get("ended_at"),
            "winner_family_id": war.get("winner_family_id"),
        },
        "family_a_totals": _totals(fid_a),
        "family_b_totals": _totals(fid_b),
        "all_players": all_entries,
    }


# ─────────────────────────────────────────────────────────────────────────────
# State Takeover (when your family conquers a state but you already head one)
# ─────────────────────────────────────────────────────────────────────────────

async def state_takeover_accept(current_user: dict = Depends(get_current_user)):
    """Accept a pending state takeover offer. Your old state becomes unclaimed, you take the new one."""
    member = await db.family_members.find_one({"user_id": current_user["id"]}, {"_id": 0, "family_id": 1, "role": 1})
    if not member:
        raise HTTPException(status_code=400, detail="You are not in a family")
    _mr = str(member.get("role") or "").strip().lower()
    if _mr not in ("boss", "don", "underboss"):
        raise HTTPException(status_code=403, detail="Only the Don or Underboss can accept state takeovers")

    family_id = member["family_id"]
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "pending_state_takeover": 1, "head_of_state": 1, "name": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")

    pending_state = (fam.get("pending_state_takeover") or "").strip()
    if not pending_state:
        raise HTTPException(status_code=400, detail="No pending state takeover offer")

    current_state = (fam.get("head_of_state") or "").strip()

    # Clear our current state first
    if current_state:
        await set_state_head(current_state, None)

    # Take the new state (use force=True since we just cleared our old state)
    err = await set_state_head(pending_state, family_id, force=True)
    if err:
        raise HTTPException(status_code=400, detail=err)

    # Clear the pending offer
    await db.families.update_one(
        {"id": family_id},
        {"$unset": {"pending_state_takeover": "", "pending_state_takeover_at": ""}}
    )

    return {
        "message": f"Takeover accepted! Your family now controls {pending_state}. {current_state} is now unclaimed.",
        "new_state": pending_state,
        "old_state_released": current_state,
    }


async def relinquish_head_of_state(current_user: dict = Depends(get_current_user)):
    """Voluntarily release this state's head-of-state slot. One use per family (flag on family doc)."""
    member = await db.family_members.find_one({"user_id": current_user["id"]}, {"_id": 0, "family_id": 1, "role": 1})
    if not member:
        raise HTTPException(status_code=400, detail="You are not in a family")
    _mr = str(member.get("role") or "").strip().lower()
    if _mr not in ("boss", "don", "underboss"):
        raise HTTPException(status_code=403, detail="Only the Don or Underboss can relinquish head of state")

    family_id = member["family_id"]
    fam = await db.families.find_one(
        {"id": family_id},
        {"_id": 0, "head_of_state": 1, "head_of_state_relinquished": 1, "name": 1},
    )
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    if fam.get("head_of_state_relinquished"):
        raise HTTPException(
            status_code=400,
            detail="This family has already used relinquish head of state.",
        )

    state = (fam.get("head_of_state") or "").strip()
    if not state:
        raise HTTPException(status_code=400, detail="Your family is not head of any state.")

    head_fid = await get_head_family_id_for_state(state)
    if head_fid != family_id:
        await db.families.update_one({"id": family_id}, {"$set": {"head_of_state": None}})
        raise HTTPException(
            status_code=400,
            detail="State assignment mismatch. Your family's head-of-state flag was cleared; refresh the page.",
        )

    err = await set_state_head(state, None)
    if err:
        raise HTTPException(status_code=400, detail=err)

    await db.families.update_one(
        {"id": family_id, "head_of_state_relinquished": {"$ne": True}},
        {"$set": {"head_of_state_relinquished": True}},
    )

    mems = await db.family_members.find({"family_id": family_id}, {"_id": 0, "user_id": 1}).to_list(200)
    for m in mems:
        uid = m.get("user_id")
        if uid is not None:
            _invalidate_my_cache(str(uid))
    _invalidate_list_cache()

    await log_activity(
        current_user["id"],
        current_user.get("username") or "?",
        "family_relinquish_head_of_state",
        {"family_id": family_id, "state": state},
    )

    return {
        "message": f"Your family is no longer Head of {state}. The state is unclaimed.",
        "released_state": state,
    }


async def state_takeover_reject(current_user: dict = Depends(get_current_user)):
    """Reject a pending state takeover offer. The conquered state remains unclaimed."""
    member = await db.family_members.find_one({"user_id": current_user["id"]}, {"_id": 0, "family_id": 1, "role": 1})
    if not member:
        raise HTTPException(status_code=400, detail="You are not in a family")
    _mr = str(member.get("role") or "").strip().lower()
    if _mr not in ("boss", "don", "underboss"):
        raise HTTPException(status_code=403, detail="Only the Don or Underboss can reject state takeovers")

    family_id = member["family_id"]
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "pending_state_takeover": 1, "head_of_state": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")

    pending_state = (fam.get("pending_state_takeover") or "").strip()
    if not pending_state:
        raise HTTPException(status_code=400, detail="No pending state takeover offer")

    current_state = (fam.get("head_of_state") or "").strip()

    # Clear the pending offer - the conquered state stays unclaimed
    await db.families.update_one(
        {"id": family_id},
        {"$unset": {"pending_state_takeover": "", "pending_state_takeover_at": ""}}
    )

    return {
        "message": f"Takeover rejected. {pending_state} remains unclaimed. You keep control of {current_state}.",
        "rejected_state": pending_state,
        "kept_state": current_state,
    }


def register(router):
    router.add_api_route("/admin/debug/war-stats", admin_debug_war_stats, methods=["GET"])
    router.add_api_route("/admin/families/war/{war_id}/force-truce", admin_force_truce_family_war, methods=["POST"])
    router.add_api_route("/families", families_list, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families/config", families_config, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families/my", families_my, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families/dashboard", families_dashboard, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families/lookup", families_lookup, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families", families_create, methods=["POST"])
    router.add_api_route("/families/join", families_join, methods=["POST"])
    router.add_api_route("/families/apply", families_apply, methods=["POST"])
    router.add_api_route(
        "/families/join-applications",
        families_join_applications_list,
        methods=["GET"],
        dependencies=_families_rl_u,
    )
    router.add_api_route("/families/join-applications/{application_id}/accept", families_join_application_accept, methods=["POST"])
    router.add_api_route("/families/join-applications/{application_id}/deny", families_join_application_deny, methods=["POST"])
    router.add_api_route("/families/join-settings", families_join_settings, methods=["PATCH"])
    router.add_api_route("/families/melt-settings", families_melt_settings, methods=["PATCH"])
    router.add_api_route("/families/sell-on-trade", families_sell_on_trade, methods=["POST"])
    router.add_api_route("/families/leave", families_leave, methods=["POST"])
    router.add_api_route("/families/kick", families_kick, methods=["POST"])
    router.add_api_route("/families/assign-role", families_assign_role, methods=["POST"])
    router.add_api_route("/families/deposit", families_deposit, methods=["POST"])
    router.add_api_route("/families/perks", families_perks_state, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families/perks/purchase", families_perks_purchase, methods=["POST"])
    router.add_api_route("/families/perks/contribute", families_perks_contribute, methods=["POST"])
    router.add_api_route("/families/withdraw", families_withdraw, methods=["POST"])
    router.add_api_route(
        "/families/vault-transactions",
        families_vault_transactions,
        methods=["GET"],
        dependencies=_families_rl_u,
    )
    router.add_api_route("/families/bullets/give", families_give_bullets, methods=["POST"])
    router.add_api_route("/families/bullets/split-all", families_split_all_bullets, methods=["POST"])
    router.add_api_route("/families/loot/give", families_give_loot, methods=["POST"])
    router.add_api_route("/families/loot/split-all", families_split_all_loot, methods=["POST"])
    router.add_api_route("/families/compound/deposit", families_compound_deposit, methods=["POST"])
    router.add_api_route("/families/compound/withdraw", families_compound_withdraw, methods=["POST"])
    router.add_api_route("/families/compound/return-to-member", families_compound_return_to_member, methods=["POST"])
    router.add_api_route("/families/compound/claim-for-family", families_compound_claim_for_family, methods=["POST"])
    router.add_api_route("/families/crew-oc/set-fee", families_crew_oc_set_fee, methods=["POST"])
    router.add_api_route("/families/crew-oc/set-auto-accept", families_crew_oc_set_auto_accept, methods=["POST"])
    router.add_api_route("/families/profile-text", families_update_profile_text, methods=["PATCH"])
    router.add_api_route("/families/avatar", families_update_avatar, methods=["PATCH"])
    router.add_api_route("/families/crew-oc/advertise", families_crew_oc_advertise, methods=["POST"])
    router.add_api_route("/families/crew-oc/apply", families_crew_oc_apply, methods=["POST"])
    router.add_api_route(
        "/families/crew-oc/applications",
        families_crew_oc_applications,
        methods=["GET"],
        dependencies=_families_rl_u,
    )
    router.add_api_route("/families/crew-oc/applications/{application_id}/accept", families_crew_oc_accept, methods=["POST"])
    router.add_api_route("/families/crew-oc/applications/{application_id}/reject", families_crew_oc_reject, methods=["POST"])
    router.add_api_route("/families/crew-oc/applications/{application_id}/kick", families_crew_oc_kick, methods=["POST"])
    router.add_api_route("/families/crew-oc/commit", families_crew_oc_commit, methods=["POST"])
    router.add_api_route("/families/safe-deposit/deposit", families_safe_deposit_deposit, methods=["POST"])
    router.add_api_route("/families/safe-deposit/withdraw", families_safe_deposit_withdraw, methods=["POST"])
    router.add_api_route("/families/daily-objective", families_daily_objective, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families/daily-objective/progress", families_daily_progress, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families/daily-objective/contributors", families_daily_contributors, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families/rackets/{racket_id}/collect", families_racket_collect, methods=["POST"])
    router.add_api_route("/families/rackets/{racket_id}/unlock", families_racket_unlock, methods=["POST"])
    router.add_api_route("/families/rackets/{racket_id}/upgrade", families_racket_upgrade, methods=["POST"])
    router.add_api_route("/families/rackets/armory-catalog", families_racket_armory_catalog, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families/rackets/{racket_id}/buy-defence", families_racket_buy_defence, methods=["POST"])
    router.add_api_route("/families/rackets/buy-offence", families_racket_buy_offence, methods=["POST"])
    router.add_api_route(
        "/families/racket-attack-targets",
        families_racket_attack_targets,
        methods=["GET"],
        dependencies=_families_rl_u,
    )
    router.add_api_route("/families/attack-racket", families_attack_racket, methods=["POST"])
    router.add_api_route("/families/war", families_war, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families/war/stats", families_war_stats, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families/war/{war_id}/feed", families_war_feed, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families/war/{war_id}/stats", families_war_public_stats, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families/war/truce/offer", families_war_truce_offer, methods=["POST"])
    router.add_api_route("/families/war/truce/accept", families_war_truce_accept, methods=["POST"])
    router.add_api_route("/families/wars/history", families_wars_history, methods=["GET"], dependencies=_families_rl_u)
    router.add_api_route("/families/state-takeover/accept", state_takeover_accept, methods=["POST"])
    router.add_api_route("/families/state-takeover/reject", state_takeover_reject, methods=["POST"])
    router.add_api_route("/families/head-of-state/relinquish", relinquish_head_of_state, methods=["POST"])
    router.add_api_route("/families/cron/treasury-bullets-hourly", families_cron_treasury_bullets_hourly, methods=["POST"])
    router.add_api_route("/families/cron/crew-oc-auto-apply", families_cron_crew_oc_auto_apply, methods=["POST"])
    router.add_api_route("/families/cron/crew-oc-auto-commit", families_cron_crew_oc_auto_commit, methods=["POST"])
    router.add_api_route("/families/airport-crew-perk", families_set_airport_crew_perk, methods=["PATCH"])
