# Loot box: player-chosen paid tier (50 / 100 / 500 / 1000 pieces). Per-prize effective reward tier (jackpots on common/uncommon).
# Global caps per prize: 10k points, $250M cash. Max one car prize per open, unique car_id per open.
import logging
import secrets
_rng = secrets.SystemRandom()
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any, Tuple

from fastapi import Depends, HTTPException, Body, Query
from pydantic import BaseModel

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import (
    db,
    get_current_user,
    log_activity,
    send_notification,
    _is_admin,
    require_admin,
    _username_pattern,
    CARS,
    ARMOUR_BASE_BULLETS,
    LOOT_EXCLUSIVE_ARMOUR_LEVEL,
)
from routers.kill.armoury import _invalidate_weapons_cache, TOKEN_CONFIG, TOKEN_TYPES
from utils.point_provenance import log_points_event
from utils.civilian_protection import maybe_revoke_civilian_protection
from utils.speakeasy_rewards import (
    SPEAKEASY_DAILY_BULLETS,
    SPEAKEASY_DAILY_CASH,
    SPEAKEASY_COOLDOWN_HOURS,
)
from utils.game_pass_season_rp import apply_season_rp_mirror_to_update, rank_points_in_update
from utils.loot_perk_stack import stacked_perk_until as _stacked_perk_until, GTA_RARE_DROP_PERK_ATTEMPTS
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_LOOT_BOX

logger = logging.getLogger(__name__)

LOOT_BOX_PIECES_PER_OPEN = 100  # legacy default; opens use LOOT_BOX_OPEN_COST_BY_TIER
LOOT_BOX_OPEN_COST_BY_TIER: Dict[str, int] = {
    "common": 50,
    "uncommon": 100,
    "rare": 500,
    "ultra_rare": 1000,
}
LOOT_MAX_POINTS = 10_000
LOOT_MAX_CASH = 250_000_000
# Secret jackpot on points prizes — do not expose chance in public reward info / UI.
LOOT_POINTS_HIGH_ROLL_CHANCE = 0.15
LOOT_POINTS_HIGH_FLOOR = 3_000
PAID_LOOT_TIERS = ("common", "uncommon", "rare", "ultra_rare")
REWARD_TIER_RANK = {"common": 0, "uncommon": 1, "rare": 2, "ultra_rare": 3}
# Per-prize effective tier weights when paid tier is common or uncommon (must sum ~1).
LOOT_REWARD_TIER_WEIGHTS: Dict[str, Dict[str, float]] = {
    "common": {"common": 0.78, "uncommon": 0.18, "rare": 0.035, "ultra_rare": 0.005},
    "uncommon": {"common": 0.12, "uncommon": 0.72, "rare": 0.13, "ultra_rare": 0.03},
}
EXCLUSIVE_CHANCE = 0.1
# Game-wide max loot-exclusive claims per type (car remains 1; weapon, armour, Speakeasy allow one extra each).
EXCLUSIVE_CAP_BY_TYPE: Dict[str, int] = {
    "weapon": 2,
    "car": 1,
    "armour": 2,
    "property": 2,
}
LOOT_EXCLUSIVE_WEAPON_ID = "weapon_loot"
LOOT_EXCLUSIVE_CAR_ID = "car21"
LOOT_EXCLUSIVE_ARMOUR_LEVEL = 7
ARMOUR_LEVEL_7_NAME = "Steel Plate Bulletproof Vest (1922)"
# Back-compat alias (old code referenced level 6 loot name)
ARMOUR_LEVEL_6_NAME = ARMOUR_LEVEL_7_NAME

GAME_SETTINGS_LOOT_COUNTS_KEY = "loot_exclusive_counts"
GAME_SETTINGS_LOOT_RARITY_KEY = "loot_box_rarity"

# Default rarity config (admin can override via game_settings)
DEFAULT_RARITY_CONFIG = {
    "exclusive_chance": 0.1,
    "common_pct": 55,
    "uncommon_pct": 32,
    "rare_pct": 13,
}
# Box quality: how many prizes (1-2, 1-3, or 1-5). Weights: common 55%, uncommon 32%, rare 13%
BOX_QUALITY_ROLL = [
    ("common", 0.55, (1, 2)),
    ("uncommon", 0.32, (1, 3)),
    ("rare", 0.13, (1, 5)),
]

STANDARD_CAR_RARITIES = ("common", "uncommon", "rare", "ultra_rare")
STANDARD_REWARD_WEIGHTS = [
    ("points", 1),
    ("rank_points", 1),
    ("cash", 1),
    ("cars", 1),
    ("bullets", 1),
    ("loot_pieces", 1),
    ("perk", 1),
    ("tokens", 1),
]
STANDARD_PRIZE_LABELS = {
    "points": "Points",
    "rank_points": "Rank points",
    "cash": "Cash",
    "cars": "Cars",
    "bullets": "Bullets",
    "loot_pieces": "Loot box pieces",
    "perk": "Time-limited perk",
    "tokens": "Bonus token",
}
# Prize count range per rolled box tier (same as _roll_box_quality_from_config).
BOX_TIER_PRIZE_COUNTS: Dict[str, Tuple[int, int]] = {
    "common": (1, 2),
    "uncommon": (1, 3),
    "rare": (2, 5),
    "ultra_rare": (3, 6),
}
# Standard prize types always included on paid tier opens (in addition to random slots).
GUARANTEED_STANDARD_TYPES_BY_TIER: Dict[str, Tuple[str, ...]] = {
    "ultra_rare": ("cash", "points"),
}
# Pass tokens are purchasable/entitled only; do not allow them as random loot box prizes.
LOOT_BOX_TOKEN_TYPES = [t for t in TOKEN_TYPES if t != "rank_xp_pass"]
PERK_TYPES = [
    "property_income_10",
    "rp_10",
    "jail_bust_10",
    "airport_cost",
    "gta_rare_100",
]
PERK_LABELS = {
    "property_income_10": "10% property income for 24h",
    "rp_10": "10% extra RP for 24h",
    "jail_bust_10": "10% jail bust payout for 24h",
    "airport_cost": "Reduced airport cost for 24h",
    "gta_rare_100": "Increased GTA rare drop for 100 attempts",
}


def _exclusive_cap(typ: str) -> int:
    return int(EXCLUSIVE_CAP_BY_TYPE.get(str(typ), 1))


async def _get_claimed_counts():
    doc = await db.game_settings.find_one({"key": GAME_SETTINGS_LOOT_COUNTS_KEY}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value") or {}
    return {
        "weapon": min(_exclusive_cap("weapon"), int(raw.get("weapon") or 0)),
        "car": min(_exclusive_cap("car"), int(raw.get("car") or 0)),
        "armour": min(_exclusive_cap("armour"), int(raw.get("armour") or 0)),
        "property": min(_exclusive_cap("property"), int(raw.get("property") or 0)),
    }


async def _increment_claimed_count(typ: str):
    # Only $inc the subpath; do not $setOnInsert "value" in the same update (MongoDB path conflict).
    # On upsert, the new doc gets key from filter and value.{typ} from $inc (missing keys treated as 0).
    await db.game_settings.update_one(
        {"key": GAME_SETTINGS_LOOT_COUNTS_KEY},
        {"$inc": {f"value.{typ}": 1}},
        upsert=True,
    )


async def _get_loot_rarity_config() -> Dict[str, Any]:
    """Return current loot box rarity config (exclusive_chance 0-1, common_pct, uncommon_pct, rare_pct). Uses defaults if not set."""
    doc = await db.game_settings.find_one({"key": GAME_SETTINGS_LOOT_RARITY_KEY}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value") or {}
    def pct(key: str, default: int) -> float:
        try:
            v = raw.get(key)
            return max(0, min(100, float(v))) / 100.0 if v is not None else default / 100.0
        except (TypeError, ValueError):
            return default / 100.0
    def chance(key: str, default: float) -> float:
        try:
            v = raw.get(key)
            return max(0.0, min(1.0, float(v))) if v is not None else default
        except (TypeError, ValueError):
            return default
    return {
        "exclusive_chance": chance("exclusive_chance", DEFAULT_RARITY_CONFIG["exclusive_chance"]),
        "common_pct": int(round((raw.get("common_pct") if raw.get("common_pct") is not None else DEFAULT_RARITY_CONFIG["common_pct"]) or 0)),
        "uncommon_pct": int(round((raw.get("uncommon_pct") if raw.get("uncommon_pct") is not None else DEFAULT_RARITY_CONFIG["uncommon_pct"]) or 0)),
        "rare_pct": int(round((raw.get("rare_pct") if raw.get("rare_pct") is not None else DEFAULT_RARITY_CONFIG["rare_pct"]) or 0)),
    }


async def _set_loot_rarity_config(config: Dict[str, Any]) -> None:
    """Persist loot box rarity config to game_settings."""
    value = {
        "exclusive_chance": max(0.0, min(1.0, float(config.get("exclusive_chance", DEFAULT_RARITY_CONFIG["exclusive_chance"])))),
        "common_pct": max(0, min(100, int(config.get("common_pct", DEFAULT_RARITY_CONFIG["common_pct"])))),
        "uncommon_pct": max(0, min(100, int(config.get("uncommon_pct", DEFAULT_RARITY_CONFIG["uncommon_pct"])))),
        "rare_pct": max(0, min(100, int(config.get("rare_pct", DEFAULT_RARITY_CONFIG["rare_pct"])))),
    }
    await db.game_settings.update_one(
        {"key": GAME_SETTINGS_LOOT_RARITY_KEY},
        {"$set": {"value": value}},
        upsert=True,
    )


async def _user_has_loot_exclusive_weapon(user_id: str) -> bool:
    uw = await db.user_weapons.find_one({"user_id": user_id, "weapon_id": LOOT_EXCLUSIVE_WEAPON_ID, "quantity": {"$gte": 1}}, {"_id": 1})
    return uw is not None


async def _user_has_loot_exclusive_car(user_id: str) -> bool:
    uc = await db.user_cars.find_one({"user_id": user_id, "car_id": LOOT_EXCLUSIVE_CAR_ID}, {"_id": 1})
    return uc is not None


async def _user_has_armour_6(user_id: str) -> bool:
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "armour_level": 1, "armour_owned_level_max": 1})
    if not u:
        return False
    return int(u.get("armour_level") or 0) >= LOOT_EXCLUSIVE_ARMOUR_LEVEL or int(u.get("armour_owned_level_max") or 0) >= LOOT_EXCLUSIVE_ARMOUR_LEVEL


async def _user_has_exclusive_property(user_id: str) -> bool:
    doc = await db.exclusive_properties.find_one({"owner_id": user_id}, {"_id": 1})
    return doc is not None


class LootBoxOpenRequest(BaseModel):
    tier: Optional[str] = None


class LootBoxRarityAdminUpdate(BaseModel):
    """Admin-only: set loot box rarity (percent 0–100). exclusive_chance_pct = chance per prize for exclusive (e.g. 10 = 10%)."""
    exclusive_chance_pct: Optional[float] = None
    common_pct: Optional[int] = None
    uncommon_pct: Optional[int] = None
    rare_pct: Optional[int] = None


class SpeakeasyGiftRequest(BaseModel):
    """Admin-only: transfer your Speakeasy exclusive property to another player."""
    target_username: str


def _active_rewards_from_user(user: dict) -> List[Dict[str, Any]]:
    """Build list of currently active loot perks (can stack). Each has type for page filtering."""
    now = datetime.now(timezone.utc)
    active = []
    # Time-based perks
    for key, perk_type, label in [
        ("property_income_perk_until", "property_income_10", PERK_LABELS["property_income_10"]),
        ("rp_perk_until", "rp_10", PERK_LABELS["rp_10"]),
        ("jail_bust_payout_perk_until", "jail_bust_10", PERK_LABELS["jail_bust_10"]),
        ("airport_cost_perk_until", "airport_cost", PERK_LABELS["airport_cost"]),
    ]:
        until_iso = user.get(key)
        if not until_iso:
            continue
        try:
            until = datetime.fromisoformat(until_iso.replace("Z", "+00:00"))
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            if now < until:
                active.append({"type": perk_type, "name": label, "expires_at": until_iso})
        except Exception:
            pass
    # Attempts-based perk
    attempts = int(user.get("gta_rare_drop_perk_attempts_remaining") or 0)
    if attempts > 0:
        active.append({
            "type": "gta_rare_100",
            "name": PERK_LABELS["gta_rare_100"],
            "attempts_remaining": attempts,
        })
    return active


async def get_loot_box_status(current_user: dict = Depends(get_current_user)):
    pieces = int(current_user.get("loot_box_pieces") or 0)
    claimed = await _get_claimed_counts()
    active_rewards = _active_rewards_from_user(current_user)
    last_10_wins = list(current_user.get("loot_box_recent") or [])[-10:]
    last_10_wins.reverse()  # newest first for display
    rarity = await _get_loot_rarity_config()
    return {
        "loot_box_pieces": pieces,
        "loot_box_free_rare_opens": int(current_user.get("loot_box_free_rare_opens") or 0),
        "open_cost_by_tier": dict(LOOT_BOX_OPEN_COST_BY_TIER),
        "claimed_counts": claimed,
        "exclusive_caps": {
            "weapon": _exclusive_cap("weapon"),
            "car": _exclusive_cap("car"),
            "armour": _exclusive_cap("armour"),
            "property": _exclusive_cap("property"),
        },
        "active_rewards": active_rewards,
        "last_10_wins": last_10_wins,
        "reward_info": _loot_public_reward_info(),
        "loot_rarity_odds": {
            "exclusive_chance_pct": round(float(rarity.get("exclusive_chance") or 0) * 100, 1),
            "common_box_pct": int(rarity.get("common_pct") or 0),
            "uncommon_box_pct": int(rarity.get("uncommon_pct") or 0),
            "rare_box_pct": int(rarity.get("rare_pct") or 0),
        },
    }


async def get_loot_box_rarity_admin(current_user: dict = Depends(require_admin)):
    """Admin only: return current loot box rarity config for the admin UI (exclusive % and box quality %)."""
    config = await _get_loot_rarity_config()
    return {
        "exclusive_chance_pct": round(config["exclusive_chance"] * 100, 2),
        "common_pct": config["common_pct"],
        "uncommon_pct": config["uncommon_pct"],
        "rare_pct": config["rare_pct"],
    }


async def set_loot_box_rarity_admin(
    body: LootBoxRarityAdminUpdate,
    current_user: dict = Depends(require_admin),
):
    """Admin only: update loot box rarity (percent 0–100). exclusive_chance_pct = chance per prize for exclusive (e.g. 10 = 10%)."""
    config = await _get_loot_rarity_config()
    if body.exclusive_chance_pct is not None:
        x = float(body.exclusive_chance_pct)
        config["exclusive_chance"] = 1.0 if x >= 100 else max(0.0, min(100.0, x)) / 100.0
    if body.common_pct is not None:
        config["common_pct"] = max(0, min(100, int(body.common_pct)))
    if body.uncommon_pct is not None:
        config["uncommon_pct"] = max(0, min(100, int(body.uncommon_pct)))
    if body.rare_pct is not None:
        config["rare_pct"] = max(0, min(100, int(body.rare_pct)))
    await _set_loot_rarity_config(config)
    return {
        "message": "Loot box rarity updated",
        "exclusive_chance_pct": round(config["exclusive_chance"] * 100, 2),
        "common_pct": config["common_pct"],
        "uncommon_pct": config["uncommon_pct"],
        "rare_pct": config["rare_pct"],
    }


def _roll_box_quality_from_config(config: Dict[str, Any]) -> Tuple[str, int]:
    """Roll box quality from config (common_pct, uncommon_pct, rare_pct). Returns (quality_name, num_prizes). Prizes: common 1-2, uncommon 1-3, rare 1-5."""
    c = config.get("common_pct") or 0
    u = config.get("uncommon_pct") or 0
    r = config.get("rare_pct") or 0
    total = c + u + r
    if total <= 0:
        c, u, r = 55, 32, 13
        total = 100
    probs = [(c / total, (1, 2)), (u / total, (1, 3)), (r / total, (1, 5))]
    names = ["common", "uncommon", "rare"]
    roll = _rng.random()
    acc = 0.0
    for i, (p, (lo, hi)) in enumerate(probs):
        acc += p
        if roll <= acc:
            return (names[i], _rng.randint(lo, hi))
    return ("rare", _rng.randint(1, 5))


def _normalize_reward_tier(name: Any) -> str:
    q = str(name or "common").strip().lower()
    if q not in PAID_LOOT_TIERS:
        return "common"
    return q


def _normalize_box_quality(name: Any) -> str:
    return _normalize_reward_tier(name)


def _normalize_paid_tier(name: Any) -> Optional[str]:
    raw = str(name or "").strip().lower()
    if raw in ("", "standard"):
        return None
    if raw not in PAID_LOOT_TIERS:
        return None
    return raw


def _clamp_loot_points(amount: int) -> int:
    return max(1, min(int(amount), LOOT_MAX_POINTS))


def _clamp_loot_cash(amount: int) -> int:
    return max(1, min(int(amount), LOOT_MAX_CASH))


def _tier_rank(tier: str) -> int:
    return int(REWARD_TIER_RANK.get(_normalize_reward_tier(tier), 0))


def _roll_effective_reward_tier(paid_tier: str, *, force_rare_plus: bool = False) -> str:
    if force_rare_plus:
        return "ultra_rare" if _rng.random() < 0.6 else "rare"
    paid = _normalize_reward_tier(paid_tier)
    if paid in ("rare", "ultra_rare"):
        return paid
    weights = LOOT_REWARD_TIER_WEIGHTS.get(paid) or LOOT_REWARD_TIER_WEIGHTS["common"]
    roll = _rng.random()
    acc = 0.0
    for tier_name in PAID_LOOT_TIERS:
        p = float(weights.get(tier_name) or 0)
        acc += p
        if roll <= acc:
            return tier_name
    return paid


def _guaranteed_standard_types(paid_tier: str) -> Tuple[str, ...]:
    return GUARANTEED_STANDARD_TYPES_BY_TIER.get(_normalize_reward_tier(paid_tier), ())


def _guaranteed_slot_types(num_prizes: int, paid_tier: str) -> Dict[int, str]:
    """Reserve random slots for tier-guaranteed standard prize types (exclusives cannot occupy them)."""
    guaranteed = _guaranteed_standard_types(paid_tier)
    if not guaranteed:
        return {}
    indices = list(range(num_prizes))
    _rng.shuffle(indices)
    return {indices[i]: guaranteed[i] for i in range(len(guaranteed))}


def _rare_plus_prize_indices(num_prizes: int, paid_tier: str) -> set:
    """Two prize slots must use rare or ultra_rare effective tier on rare/ultra paid opens."""
    paid = _normalize_reward_tier(paid_tier)
    if paid not in ("rare", "ultra_rare") or num_prizes < 2:
        return set()
    indices = list(range(num_prizes))
    _rng.shuffle(indices)
    return {indices[0], indices[1]}


def _paid_tier_prize_count(paid_tier: str) -> int:
    lo, hi = BOX_TIER_PRIZE_COUNTS.get(_normalize_reward_tier(paid_tier), (1, 2))
    return _rng.randint(int(lo), int(hi))


def _loot_token_amount_range(box_quality: str) -> Tuple[int, int]:
    """Min/max token count rolled for a standard token prize (matches _loot_token_amount)."""
    q = _normalize_reward_tier(box_quality)
    if q == "common":
        return (1, 1)
    if q == "ultra_rare":
        return (2, 2)
    return (1, 2)


def _loot_public_reward_info() -> Dict[str, Any]:
    """Static ranges + lists for Loot Box UI (must match open_loot_box / _loot_tier_profile)."""
    standard_prizes = [{"id": k, "label": STANDARD_PRIZE_LABELS.get(k, k)} for k, _ in STANDARD_REWARD_WEIGHTS]
    token_types = []
    for tt in LOOT_BOX_TOKEN_TYPES:
        token_types.append({"id": tt, "label": str(tt).replace("_", " ")})
    exclusives = [
        {"id": "weapon", "label": "Exclusive weapon", "cap_global": _exclusive_cap("weapon")},
        {"id": "car", "label": "Exclusive vehicle", "cap_global": _exclusive_cap("car")},
        {"id": "armour", "label": f"Exclusive armour ({ARMOUR_LEVEL_7_NAME})", "cap_global": _exclusive_cap("armour")},
        {"id": "property", "label": "Speakeasy (exclusive property)", "cap_global": _exclusive_cap("property")},
    ]
    tiers: Dict[str, Any] = {}
    for q in PAID_LOOT_TIERS:
        t = _loot_tier_profile(q)
        mix = list(t["points_mix"])
        pts_lo = int(t.get("points_min") or min(mix))
        # Show full possible band (incl. secret high rolls) without revealing odds.
        pts_hi = max(int(t["points_max"]), LOOT_MAX_POINTS)
        c0, c1 = t["cash"]
        r0, r1 = t["rank_points"]
        b0, b1 = t["bullets"]
        l0, l1 = t["loot_pieces"]
        cc_lo, cc_hi = t["car_count"]
        t_lo, t_hi = _loot_token_amount_range(q)
        excl = t.get("perk_exclude") or frozenset()
        perk_labels = [PERK_LABELS[p] for p in PERK_TYPES if p not in excl]
        guaranteed = list(_guaranteed_standard_types(q))
        tiers[q] = {
            "prize_count": list(BOX_TIER_PRIZE_COUNTS[q]),
            "guaranteed_standard_types": guaranteed,
            "cash": [int(c0), int(c1)],
            "points": [pts_lo, pts_hi],
            "rank_points": [int(r0), int(r1)],
            "bullets": [int(b0), int(b1)],
            "loot_pieces": [int(l0), int(l1)],
            "tokens": {"amount": [t_lo, t_hi], "types": token_types},
            "cars": {"count": [1, 1], "rarities": [str(x).replace("_", " ") for x in t["car_rarities"]]},
            "perks": perk_labels,
        }
    jackpot_tiers: Dict[str, Any] = {}
    for paid in ("common", "uncommon"):
        w = LOOT_REWARD_TIER_WEIGHTS.get(paid) or {}
        jackpot_tiers[paid] = {
            k: round(float(v) * 100, 2)
            for k, v in w.items()
            if k != paid and float(v) > 0
        }
    return {
        "pieces_per_open": LOOT_BOX_PIECES_PER_OPEN,
        "open_cost_by_tier": dict(LOOT_BOX_OPEN_COST_BY_TIER),
        "max_points_per_prize": LOOT_MAX_POINTS,
        "max_cash_per_prize": LOOT_MAX_CASH,
        "rare_plus_minimum": 2,
        "jackpot_tier_weights_pct": jackpot_tiers,
        "standard_prize_types": standard_prizes,
        "standard_note": "Each prize is one random type (no duplicate type in one open). At most one car per open.",
        "exclusives": exclusives,
        "exclusive_note": (
            f"Global caps (all players): weapon {_exclusive_cap('weapon')}, car {_exclusive_cap('car')}, "
            f"armour {_exclusive_cap('armour')}, Speakeasy {_exclusive_cap('property')}. "
            "If a type is full or you already own that exclusive, the roll tries another exclusive or becomes a standard prize."
        ),
        "tiers": tiers,
    }


def _loot_tier_profile(box_quality: str) -> Dict[str, Any]:
    """Reward bands and car filters keyed by rolled box_quality (not car data rarity)."""
    q = _normalize_box_quality(box_quality)
    tiers: Dict[str, Dict[str, Any]] = {
        "common": {
            "cash": (25_000, 5_000_000),
            "rank_points": (20, 800),
            "bullets": (100, 8_000),
            "loot_pieces": (2, 30),
            "car_rarities": ("common",),
            "car_count": (1, 2),
            "points_min": 150,
            "points_mix": (150, 300, 500),
            "points_max": 500,
            "perk_exclude": frozenset({"gta_rare_100"}),
        },
        "uncommon": {
            "cash": (250_000, 40_000_000),
            "rank_points": (200, 2_500),
            "bullets": (2_000, 40_000),
            "loot_pieces": (8, 55),
            "car_rarities": ("common", "uncommon"),
            "car_count": (1, 3),
            "points_min": 400,
            "points_mix": (400, 900, 1_400),
            "points_max": 1_500,
            "perk_exclude": frozenset(),
        },
        "rare": {
            "cash": (10_000_000, LOOT_MAX_CASH),
            "rank_points": (800, 5_000),
            "bullets": (15_000, 100_000),
            "loot_pieces": (20, 95),
            "car_rarities": ("uncommon", "rare", "ultra_rare"),
            "car_count": (1, 1),
            "points_min": 800,
            "points_mix": (1_000, 1_800, 2_500),
            "points_max": 2_999,
            "perk_exclude": frozenset(),
        },
        "ultra_rare": {
            "cash": (50_000_000, LOOT_MAX_CASH),
            "rank_points": (2_000, 8_000),
            "bullets": (40_000, 150_000),
            "loot_pieces": (40, 120),
            "car_rarities": ("ultra_rare",),
            "car_count": (1, 1),
            "points_min": 1_200,
            "points_mix": (1_500, 2_200, 2_800),
            "points_max": 2_999,
            "perk_exclude": frozenset(),
        },
    }
    return tiers[q]


def _loot_build_car_pool(car_rarities: Tuple[str, ...]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for c in CARS or []:
        if c.get("id") in (LOOT_EXCLUSIVE_CAR_ID, "car_custom"):
            continue
        if c.get("rarity") == "loot_exclusive":
            continue
        r = str(c.get("rarity") or "common")
        if r in car_rarities:
            out.append(c)
    return out


def _loot_car_pool(car_rarities: Tuple[str, ...]) -> List[Dict[str, Any]]:
    pool = _loot_build_car_pool(car_rarities)
    if pool:
        return pool
    return _loot_build_car_pool(STANDARD_CAR_RARITIES)


def _loot_pick_car(
    pool: List[Dict[str, Any]],
    effective_tier: str,
    exclude_ids: Optional[set] = None,
) -> Optional[Dict[str, Any]]:
    exclude_ids = exclude_ids or set()
    filtered = [c for c in pool if c.get("id") not in exclude_ids]
    if not filtered:
        return None
    eff = _normalize_reward_tier(effective_tier)
    if eff in ("rare", "ultra_rare"):
        wmap = {"common": 1, "uncommon": 2, "rare": 5, "ultra_rare": 8}
        weights = [wmap.get(str(c.get("rarity") or "common"), 1) for c in filtered]
        return _rng.choices(filtered, weights=weights, k=1)[0]
    return _rng.choice(filtered)


def _loot_roll_points(tier: Dict[str, Any]) -> int:
    """Standard band stays under LOOT_POINTS_HIGH_FLOOR; secret high-roll chance for 3000+."""
    mix = list(tier["points_mix"])
    lo = int(tier.get("points_min") or min(mix))
    standard_hi = min(int(tier["points_max"]), LOOT_POINTS_HIGH_FLOOR - 1)
    if standard_hi < lo:
        standard_hi = lo

    if _rng.random() < LOOT_POINTS_HIGH_ROLL_CHANCE:
        amount = int(_rng.randint(LOOT_POINTS_HIGH_FLOOR, LOOT_MAX_POINTS))
    elif _rng.random() < 0.62:
        amount = min(int(_rng.choice(mix)), standard_hi)
    else:
        amount = int(_rng.randint(lo, standard_hi))
    return _clamp_loot_points(amount)


def _loot_token_amount(box_quality: str) -> int:
    q = _normalize_reward_tier(box_quality)
    if q == "common":
        return 1
    if q == "uncommon":
        return 2 if _rng.random() < 0.38 else 1
    if q == "ultra_rare":
        return 2
    return 2 if _rng.random() < 0.58 else 1


async def open_loot_box(
    body: LootBoxOpenRequest = Body(default=LootBoxOpenRequest()),
    current_user: dict = Depends(get_current_user),
):
    paid_tier = _normalize_paid_tier(body.tier if body else None)
    if not paid_tier:
        raise HTTPException(
            status_code=400,
            detail="Choose a box tier: common (50 pieces), uncommon (100), rare (500), or ultra_rare (1000).",
        )
    cost = int(LOOT_BOX_OPEN_COST_BY_TIER.get(paid_tier, LOOT_BOX_PIECES_PER_OPEN))
    user_id = current_user["id"]
    raw_pieces = current_user.get("loot_box_pieces")
    logger.info(
        "Loot box open attempt user_id=%s tier=%s cost=%s loot_box_pieces=%s (type=%s)",
        user_id,
        paid_tier,
        cost,
        raw_pieces,
        type(raw_pieces).__name__,
    )
    is_admin_test = _is_admin(current_user)
    used_free_rare = False
    if (
        not is_admin_test
        and paid_tier == "rare"
        and int(current_user.get("loot_box_free_rare_opens") or 0) > 0
    ):
        free_res = await db.users.find_one_and_update(
            {"id": user_id, "loot_box_free_rare_opens": {"$gte": 1}},
            {"$inc": {"loot_box_free_rare_opens": -1}},
            projection={"_id": 0, "id": 1, "loot_box_pieces": 1, "loot_box_free_rare_opens": 1},
            return_document=True,
        )
        if free_res:
            used_free_rare = True
            new_pieces = int(free_res.get("loot_box_pieces") or 0)
            res = free_res
    if used_free_rare:
        pass
    elif is_admin_test:
        res = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "loot_box_pieces": 1})
        new_pieces = int(res.get("loot_box_pieces") or 0) if res else 0
    else:
        try:
            res = await db.users.find_one_and_update(
                {
                    "id": user_id,
                    "$expr": {
                        "$gte": [
                            {"$convert": {"input": "$loot_box_pieces", "to": "long", "onError": 0, "onNull": 0}},
                            cost,
                        ]
                    },
                },
                [
                    {
                        "$set": {
                            "loot_box_pieces": {
                                "$max": [
                                    0,
                                    {
                                        "$subtract": [
                                            {"$convert": {"input": "$loot_box_pieces", "to": "long", "onError": 0, "onNull": 0}},
                                            cost,
                                        ]
                                    },
                                ]
                            }
                        }
                    }
                ],
                projection={"_id": 0, "id": 1, "loot_box_pieces": 1},
                return_document=True,
            )
        except Exception as e:
            logger.exception("Loot box open (find_one_and_update) user_id=%s: %s", user_id, e)
            raise HTTPException(
                status_code=400,
                detail=f"Not enough loot box pieces (need {cost}) or deduct failed.",
            )
        if not res:
            logger.warning(
                "Loot box open: no document updated for user_id=%s (pieces may be < %s or wrong type)",
                user_id,
                cost,
            )
            raise HTTPException(status_code=400, detail=f"Not enough loot box pieces (need {cost})")
        new_pieces = int(res.get("loot_box_pieces") or 0)

    try:
        rarity_config = await _get_loot_rarity_config()
        box_quality = paid_tier
        num_prizes = _paid_tier_prize_count(paid_tier)
        guaranteed = _guaranteed_standard_types(paid_tier)
        num_prizes = max(num_prizes, len(guaranteed))
        guaranteed_slot_types = _guaranteed_slot_types(num_prizes, paid_tier)
        rare_plus_slots = _rare_plus_prize_indices(num_prizes, paid_tier)
        rewards: List[Dict[str, Any]] = []
        merged_inc: Dict[str, int] = {}
        merged_set: Dict[str, Any] = {}
        now = datetime.now(timezone.utc)
        cars_given_ids: set = set()
        cars_prize_granted = False

        exclusive_chance = float(rarity_config.get("exclusive_chance") or EXCLUSIVE_CHANCE)
        exclusive_chance = min(1.0, max(0.0, exclusive_chance))
        chosen_standard_types: set = set()
        for prize_idx in range(num_prizes):
            claimed = await _get_claimed_counts()
            forced_standard = guaranteed_slot_types.get(prize_idx)
            if forced_standard is None:
                roll = _rng.random()
                if roll < exclusive_chance:
                    available = []
                    if claimed["weapon"] < _exclusive_cap("weapon") and not await _user_has_loot_exclusive_weapon(user_id):
                        available.append("weapon")
                    if claimed["car"] < _exclusive_cap("car") and not await _user_has_loot_exclusive_car(user_id):
                        available.append("car")
                    if claimed["armour"] < _exclusive_cap("armour") and not await _user_has_armour_6(user_id):
                        available.append("armour")
                    if claimed["property"] < _exclusive_cap("property") and not await _user_has_exclusive_property(user_id):
                        available.append("property")
                    # Admin at 100% exclusive: if nothing available (cap or already have), still grant an exclusive for testing (skip property if user already has one to avoid duplicate key)
                    if is_admin_test and exclusive_chance >= 1.0 and not available:
                        available = ["weapon", "car", "armour"]
                        if not await _user_has_exclusive_property(user_id):
                            available.append("property")
                    if available:
                        typ = _rng.choice(available)
                        if typ == "weapon":
                            await db.user_weapons.update_one(
                                {"user_id": user_id, "weapon_id": LOOT_EXCLUSIVE_WEAPON_ID},
                                {"$inc": {"quantity": 1}, "$set": {"acquired_at": now.isoformat()}},
                                upsert=True,
                            )
                            await _increment_claimed_count("weapon")
                            _invalidate_weapons_cache(user_id)
                            w = await db.weapons.find_one({"id": LOOT_EXCLUSIVE_WEAPON_ID}, {"_id": 0, "name": 1})
                            name = (w or {}).get("name") or "Colt Monitor"
                            new_claimed = await _get_claimed_counts()
                            if new_claimed["weapon"] >= _exclusive_cap("weapon"):
                                await send_notification(user_id, "Loot box", f"The last exclusive weapon ({name}) has been claimed!", "system")
                            rewards.append({
                                "type": "weapon",
                                "name": name,
                                "id": LOOT_EXCLUSIVE_WEAPON_ID,
                                "rarity": "loot_exclusive",
                                "reward_tier": "loot_exclusive",
                            })
                            continue
                        if typ == "car":
                            car_info = next((c for c in CARS if c.get("id") == LOOT_EXCLUSIVE_CAR_ID), None)
                            car_name = (car_info.get("name") if car_info else None) or "1930 Cadillac Series 452 V-16 Armored Sedan"
                            loot_car_uc_id = str(uuid.uuid4())
                            await db.user_cars.insert_one({
                                "id": loot_car_uc_id,
                                "user_id": user_id,
                                "car_id": LOOT_EXCLUSIVE_CAR_ID,
                                "car_name": car_name,
                                "acquired_at": now.isoformat(),
                                "damage_percent": 0,
                                "rarity": "loot_exclusive",
                                "value": int((car_info or {}).get("value") or 0),
                                "min_rank": int((car_info or {}).get("min_rank") or 1),
                                "min_difficulty": int((car_info or {}).get("min_difficulty") or 1),
                                "travel_bonus": int((car_info or {}).get("travel_bonus") or 0),
                                "image": str((car_info or {}).get("image") or ""),
                            })
                            from utils.exclusive_car_events import log_exclusive_car_event

                            await log_exclusive_car_event(
                                db,
                                event_type="loot_box",
                                car_id=LOOT_EXCLUSIVE_CAR_ID,
                                user_car_id=loot_car_uc_id,
                                to_user_id=user_id,
                                to_username=current_user.get("username") if current_user else "",
                                car_name=car_name,
                            )
                            await _increment_claimed_count("car")
                            new_claimed = await _get_claimed_counts()
                            if new_claimed["car"] >= _exclusive_cap("car"):
                                await send_notification(user_id, "Loot box", f"The last exclusive car ({car_name}) has been claimed!", "system")
                            cars_given_ids.add(LOOT_EXCLUSIVE_CAR_ID)
                            cars_prize_granted = True
                            rewards.append({
                                "type": "car",
                                "name": car_name,
                                "id": LOOT_EXCLUSIVE_CAR_ID,
                                "rarity": "loot_exclusive",
                                "reward_tier": "loot_exclusive",
                            })
                            await maybe_revoke_civilian_protection(db, user_id, "exclusive_car")
                            continue
                        if typ == "armour":
                            await db.users.update_one(
                                {"id": user_id},
                                {"$set": {"armour_level": LOOT_EXCLUSIVE_ARMOUR_LEVEL, "armour_owned_level_max": LOOT_EXCLUSIVE_ARMOUR_LEVEL}},
                            )
                            await _increment_claimed_count("armour")
                            new_claimed = await _get_claimed_counts()
                            if new_claimed["armour"] >= _exclusive_cap("armour"):
                                await send_notification(user_id, "Loot box", f"The last exclusive armour ({ARMOUR_LEVEL_7_NAME}) has been claimed!", "system")
                            rewards.append({
                                "type": "armour",
                                "name": ARMOUR_LEVEL_7_NAME,
                                "level": LOOT_EXCLUSIVE_ARMOUR_LEVEL,
                                "rarity": "loot_exclusive",
                                "reward_tier": "loot_exclusive",
                            })
                            continue
                        if typ == "property":
                            await db.exclusive_properties.insert_one({
                                "id": str(uuid.uuid4()),
                                "type": "speakeasy",
                                "owner_id": user_id,
                                "claimed_at": now.isoformat(),
                            })
                            await _increment_claimed_count("property")
                            new_claimed = await _get_claimed_counts()
                            if new_claimed["property"] >= _exclusive_cap("property"):
                                await send_notification(user_id, "Loot box", "The last Speakeasy has been claimed!", "system")
                            rewards.append({
                                "type": "property",
                                "name": "Speakeasy",
                                "rarity": "loot_exclusive",
                                "reward_tier": "loot_exclusive",
                            })
                            await maybe_revoke_civilian_protection(db, user_id, "received_property_transfer")
                            continue

            force_rare_plus = prize_idx in rare_plus_slots
            reward_tier = _roll_effective_reward_tier(paid_tier, force_rare_plus=force_rare_plus)
            tier = _loot_tier_profile(reward_tier)

            if forced_standard is not None:
                chosen = forced_standard
            else:
                available = [
                    (name, w)
                    for name, w in STANDARD_REWARD_WEIGHTS
                    if name not in chosen_standard_types and not (name == "cars" and cars_prize_granted)
                ]
                if not available:
                    available = [
                        (name, w)
                        for name, w in STANDARD_REWARD_WEIGHTS
                        if not (name == "cars" and cars_prize_granted)
                    ]
                if not available:
                    available = list(STANDARD_REWARD_WEIGHTS)
                weights = [w for _, w in available]
                total_w = sum(weights)
                r = _rng.random() * total_w
                acc = 0
                chosen = available[0][0]
                for name, w in available:
                    acc += w
                    if r <= acc:
                        chosen = name
                        break
            chosen_standard_types.add(chosen)

            def _append_standard(payload: Dict[str, Any]) -> None:
                payload["rarity"] = reward_tier
                payload["reward_tier"] = reward_tier
                rewards.append(payload)

            if chosen == "points":
                amount = _loot_roll_points(tier)
                merged_inc["points"] = merged_inc.get("points", 0) + amount
                _append_standard({"type": "points", "amount": amount})
            elif chosen == "rank_points":
                rp_lo, rp_hi = tier["rank_points"]
                amount = _rng.randint(int(rp_lo), int(rp_hi))
                merged_inc["rank_points"] = merged_inc.get("rank_points", 0) + amount
                _append_standard({"type": "rank_points", "amount": amount})
            elif chosen == "cash":
                c_lo, c_hi = tier["cash"]
                amount = _clamp_loot_cash(_rng.randint(int(c_lo), int(c_hi)))
                merged_inc["money"] = merged_inc.get("money", 0) + amount
                _append_standard({"type": "cash", "amount": amount})
            elif chosen == "cars":
                pool = _loot_car_pool(tuple(tier["car_rarities"]))
                car = _loot_pick_car(pool, reward_tier, cars_given_ids) if pool else None
                if not car:
                    c_lo, c_hi = tier["cash"]
                    amount = _clamp_loot_cash(_rng.randint(int(c_lo), int(c_hi)))
                    merged_inc["money"] = merged_inc.get("money", 0) + amount
                    _append_standard({"type": "cash", "amount": amount})
                else:
                    cars_given_ids.add(car["id"])
                    cars_prize_granted = True
                    await db.user_cars.insert_one({
                        "id": str(uuid.uuid4()),
                        "user_id": user_id,
                        "car_id": car["id"],
                        "car_name": car.get("name", car["id"]),
                        "acquired_at": now.isoformat(),
                        "damage_percent": _rng.randint(0, 30),
                        "rarity": car.get("rarity") or "common",
                        "value": int(car.get("value") or 0),
                        "min_rank": int(car.get("min_rank") or 1),
                        "min_difficulty": int(car.get("min_difficulty") or 1),
                        "travel_bonus": int(car.get("travel_bonus") or 0),
                        "image": str(car.get("image") or ""),
                    })
                    items = [{"name": car.get("name", car["id"]), "rarity": car.get("rarity", "common"), "car_id": car["id"]}]
                    _append_standard({"type": "cars", "count": 1, "items": items})
            elif chosen == "bullets":
                b_lo, b_hi = tier["bullets"]
                amount = _rng.randint(int(b_lo), int(b_hi))
                merged_inc["bullets"] = merged_inc.get("bullets", 0) + amount
                _append_standard({"type": "bullets", "amount": amount})
            elif chosen == "loot_pieces":
                lp_lo, lp_hi = tier["loot_pieces"]
                amount = _rng.randint(int(lp_lo), int(lp_hi))
                merged_inc["loot_box_pieces"] = merged_inc.get("loot_box_pieces", 0) + amount
                _append_standard({"type": "loot_pieces", "amount": amount})
            elif chosen == "tokens":
                amt = _loot_token_amount(reward_tier)
                token_type = _rng.choice(LOOT_BOX_TOKEN_TYPES)
                field = TOKEN_CONFIG[token_type]["count_field"]
                merged_inc[field] = merged_inc.get(field, 0) + amt
                _append_standard({"type": "token", "token_type": token_type, "amount": amt})
            else:
                excl = tier.get("perk_exclude") or frozenset()
                perk_pool = [p for p in PERK_TYPES if p not in excl]
                if not perk_pool:
                    perk_pool = list(PERK_TYPES)
                perk = _rng.choice(perk_pool)
                if perk == "property_income_10":
                    merged_set["property_income_perk_until"] = _stacked_perk_until(merged_set, current_user, "property_income_perk_until", now)
                elif perk == "rp_10":
                    merged_set["rp_perk_until"] = _stacked_perk_until(merged_set, current_user, "rp_perk_until", now)
                elif perk == "jail_bust_10":
                    merged_set["jail_bust_payout_perk_until"] = _stacked_perk_until(merged_set, current_user, "jail_bust_payout_perk_until", now)
                elif perk == "airport_cost":
                    merged_set["airport_cost_perk_until"] = _stacked_perk_until(merged_set, current_user, "airport_cost_perk_until", now)
                else:
                    merged_inc["gta_rare_drop_perk_attempts_remaining"] = merged_inc.get("gta_rare_drop_perk_attempts_remaining", 0) + GTA_RARE_DROP_PERK_ATTEMPTS
                _append_standard({
                    "type": "perk",
                    "name": PERK_LABELS.get(perk, perk),
                })

        if merged_inc or merged_set:
            update = {}
            if merged_inc:
                update["$inc"] = merged_inc
            if merged_set:
                update["$set"] = merged_set
            loot_update = apply_season_rp_mirror_to_update(update, user=current_user)
            await db.users.update_one({"id": user_id}, loot_update)
            if merged_inc.get("points", 0) > 0:
                await log_points_event(db, user_id=user_id, points=merged_inc["points"], event_type="loot_box", meta={"box_quality": box_quality, "prizes_count": len(rewards)})

        # Append to last-10 wins (newest at end; frontend can reverse for display)
        win_entry = {
            "opened_at": now.isoformat(),
            "box_quality": box_quality,
            "prizes_count": len(rewards),
            "rewards": rewards,
        }
        await db.users.update_one(
            {"id": user_id},
            {"$push": {"loot_box_recent": {"$each": [win_entry], "$slice": -10}}},
        )
        await db.economy_events.insert_one({
            "at": now.isoformat(),
            "type": "loot_box_open",
            "user_id": user_id,
            "username": current_user.get("username") if current_user else "",
            "box_quality": box_quality,
            "prizes_count": len(rewards),
            "reward_types": [r.get("type") for r in rewards if r.get("type")],
            "rewards": rewards,
        })

        await log_activity(user_id, current_user.get("username", "?"), "loot_box_open", {
            "quality": box_quality, "prizes": len(rewards),
            "types": [r.get("type") for r in rewards if r.get("type")],
        })
        piece_grant = int(merged_inc.get("loot_box_pieces", 0))
        return {
            "rewards": rewards,
            "box_quality": box_quality,
            "paid_tier": paid_tier,
            "pieces_spent": 0 if used_free_rare else cost,
            "used_free_rare_open": used_free_rare,
            "guaranteed_rare_plus": 2 if paid_tier in ("rare", "ultra_rare") else 0,
            "prizes_count": len(rewards),
            "new_pieces": new_pieces + piece_grant,
            "claimed_counts": await _get_claimed_counts(),
        }
    except HTTPException:
        if used_free_rare:
            try:
                await db.users.update_one(
                    {"id": user_id},
                    {"$inc": {"loot_box_free_rare_opens": 1}},
                )
            except Exception:
                logger.exception("Failed to refund free rare open user_id=%s", user_id)
        raise
    except Exception as e:
        if used_free_rare:
            try:
                await db.users.update_one(
                    {"id": user_id},
                    {"$inc": {"loot_box_free_rare_opens": 1}},
                )
            except Exception:
                logger.exception("Failed to refund free rare open user_id=%s", user_id)
        logger.exception("Loot box open (rewards) user_id=%s: %s", user_id, e)
        raise HTTPException(
            status_code=500,
            detail="Loot box open failed. Please try again.",
        )


async def collect_speakeasy(current_user: dict = Depends(get_current_user)):
    """Collect daily Speakeasy perk if user owns an exclusive property (Speakeasy). Once per 24h."""
    user_id = current_user["id"]
    now = datetime.now(timezone.utc)
    cooldown_threshold = (now - timedelta(hours=SPEAKEASY_COOLDOWN_HOURS)).isoformat()
    ep = await db.exclusive_properties.find_one_and_update(
        {"owner_id": user_id, "type": "speakeasy",
         "$or": [
             {"last_speakeasy_collected_at": {"$exists": False}},
             {"last_speakeasy_collected_at": None},
             {"last_speakeasy_collected_at": {"$lte": cooldown_threshold}},
         ]},
        {"$set": {"last_speakeasy_collected_at": now.isoformat()}},
    )
    if not ep:
        owns = await db.exclusive_properties.find_one(
            {"owner_id": user_id, "type": "speakeasy"}, {"_id": 1}
        )
        if not owns:
            raise HTTPException(status_code=400, detail="You do not own a Speakeasy")
        raise HTTPException(status_code=400, detail="Speakeasy daily collection is on cooldown (once per 24 hours)")
    await db.users.update_one(
        {"id": user_id},
        {"$inc": {"money": SPEAKEASY_DAILY_CASH, "bullets": SPEAKEASY_DAILY_BULLETS}},
    )
    await log_activity(user_id, current_user.get("username", "?"), "speakeasy_collect", {"cash": SPEAKEASY_DAILY_CASH, "bullets": SPEAKEASY_DAILY_BULLETS})
    return {
        "message": f"Collected ${SPEAKEASY_DAILY_CASH:,} and {SPEAKEASY_DAILY_BULLETS} bullets from your Speakeasy.",
        "cash": SPEAKEASY_DAILY_CASH,
        "bullets": SPEAKEASY_DAILY_BULLETS,
    }


async def gift_speakeasy(body: SpeakeasyGiftRequest, current_user: dict = Depends(get_current_user)):
    """Admin-only: transfer the current user's Speakeasy (exclusive_properties) to another player by username."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Only admins can gift a Speakeasy.")
    admin_id = current_user["id"]
    raw_un = (body.target_username or "").strip()
    if not raw_un:
        raise HTTPException(status_code=400, detail="Enter the recipient's in-game username.")
    pat = _username_pattern(raw_un)
    if not pat:
        raise HTTPException(status_code=400, detail="Invalid username.")
    recipient = await db.users.find_one({"username": pat}, {"_id": 0, "id": 1, "username": 1})
    if not recipient:
        raise HTTPException(status_code=404, detail="No player found with that username.")
    rid = recipient["id"]
    if rid == admin_id:
        raise HTTPException(status_code=400, detail="You cannot gift the Speakeasy to yourself.")
    taken = await db.exclusive_properties.find_one({"owner_id": rid, "type": "speakeasy"}, {"_id": 1})
    if taken:
        raise HTTPException(status_code=400, detail="That player already owns a Speakeasy.")
    res = await db.exclusive_properties.update_one(
        {"owner_id": admin_id, "type": "speakeasy"},
        {"$set": {"owner_id": rid}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=400, detail="You do not own a Speakeasy to gift.")
    if res.modified_count == 0:
        raise HTTPException(status_code=400, detail="Could not transfer Speakeasy.")
    r_display = recipient.get("username") or raw_un
    admin_name = current_user.get("username", "?")
    await log_activity(
        admin_id,
        admin_name,
        "speakeasy_admin_gift",
        {"to_user_id": rid, "to_username": r_display},
    )
    await send_notification(
        rid,
        "Loot box",
        f"{admin_name} gifted you the Speakeasy (loot exclusive). Collect daily cash and bullets from My Inventory.",
        "system",
    )
    await maybe_revoke_civilian_protection(db, rid, "received_property_transfer")
    return {"message": f"Speakeasy transferred to {r_display}.", "recipient_username": r_display}


async def admin_loot_box_opens_list(
    username: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    skip: int = Query(0, ge=0, le=100_000),
    current_user: dict = Depends(require_admin),
):
    """Admin only: paginated loot box opens from economy_events (newest first). Optional username filter."""
    q: Dict[str, Any] = {"type": "loot_box_open"}
    raw_un = (username or "").strip()
    if raw_un:
        pat = _username_pattern(raw_un)
        if not pat:
            raise HTTPException(status_code=400, detail="Invalid username")
        user = await db.users.find_one({"username": pat}, {"_id": 0, "id": 1})
        if not user:
            return {"opens": [], "total": 0, "limit": limit, "skip": skip}
        q["user_id"] = user["id"]
    total = await db.economy_events.count_documents(q)
    cursor = (
        db.economy_events.find(q, {"_id": 0})
        .sort("at", -1)
        .skip(skip)
        .limit(limit)
    )
    opens = await cursor.to_list(length=limit)
    return {"opens": opens, "total": total, "limit": limit, "skip": skip}


async def _loot_box_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_LOOT_BOX)


_loot_box_rl_u = [Depends(_loot_box_sustained_rl_user)]


def register(router):
    router.add_api_route("/loot-box/status", get_loot_box_status, methods=["GET"], dependencies=_loot_box_rl_u)
    router.add_api_route("/loot-box/open", open_loot_box, methods=["POST"])
    router.add_api_route("/loot-box/speakeasy/collect", collect_speakeasy, methods=["POST"])
    router.add_api_route("/loot-box/speakeasy/gift", gift_speakeasy, methods=["POST"])
    router.add_api_route("/loot-box/admin/rarity", get_loot_box_rarity_admin, methods=["GET"])
    router.add_api_route("/loot-box/admin/rarity", set_loot_box_rarity_admin, methods=["POST"])
    router.add_api_route("/loot-box/admin/opens", admin_loot_box_opens_list, methods=["GET"])
