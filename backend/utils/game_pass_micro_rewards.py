"""
Game Pass micro-tier reward model.

Micro tiers:
  - 1..100 represent progress percent 1%..100% of MAX_THRESHOLD_RP.
  - Rewards are granted for an exact micro tier (not cumulative).

Scaling:
  - For each reward type: amount = ceil(baseAmount * w(tier, baseTier))
  - w(t, b) = (t / b) * (t / 100)^(gamma - 1) so early tiers are lighter and late tiers carry more
    of each key's budget (gamma=1 restores linear t/b scaling).
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Dict, Optional

MAX_THRESHOLD_RP = 1_000_000
MAX_MICRO_TIER = 100
MICRO_TIER_STEP_RP = MAX_THRESHOLD_RP / MAX_MICRO_TIER  # 10,000 RP

# >1 shifts payout mass toward high micro tiers while preserving per-key totals (see _reward_weight).
REWARD_TIER_PROGRESS_GAMMA = 1.45


def _tier_progress_multiplier(t: int) -> float:
    if REWARD_TIER_PROGRESS_GAMMA <= 1.0:
        return 1.0
    tt = max(1, min(MAX_MICRO_TIER, int(t)))
    return (tt / float(MAX_MICRO_TIER)) ** (REWARD_TIER_PROGRESS_GAMMA - 1.0)


def _reward_weight(t: int, base_tier: int) -> float:
    return (int(t) / float(base_tier)) * _tier_progress_multiplier(int(t))


# Reward key order and labels used for inbox summaries.
REWARD_KEY_ORDER = [
    "money",
    "bullets",
    "xp_crimes_tokens",
    "xp_gta_tokens",
    "points",
    "respect_points",
    "loot_box_pieces",
    "melt_tokens",
    "jailbust_tokens",
    "travel_tokens",
    "properties_tokens",
    "auto_rank_2h_tokens",
]

REWARD_KEY_LABELS = {
    "money": "cash",
    "bullets": "bullets",
    "xp_crimes_tokens": "Crimes XP Token",
    "xp_gta_tokens": "GTA XP Token",
    "points": "points",
    "respect_points": "respect",
    "melt_tokens": "Melt Token",
    "jailbust_tokens": "Jailbust Token",
    "travel_tokens": "Travel Token",
    "properties_tokens": "Properties Token",
    "auto_rank_2h_tokens": "Auto Rank (2h) Token",
    "loot_box_pieces": "loot box pieces",
}

# Targets (season VIP totals — keep in sync with src/pages/Game/GamePass.js)
TARGET_CASH_TOTAL = 1_000_000_000
TARGET_POINTS_TOTAL = 15_000
TARGET_BULLETS_TOTAL = 250_000
TARGET_AUTO_RANK_2H_TOTAL = 75

_MONEY_BASE_TIER = 10
_POINTS_BASE_TIER = 50


def _normalize_base_amount_to_total(*, base_tier: int, target_total: int, initial_base_amount: float) -> float:
    """
    Find a baseAmount such that:
      sum_{t=1..100} ceil(baseAmount * w(t, base_tier)) ~= target_total

    Uses a small iterative scaling to converge (since ceil makes it piecewise).
    """
    base = float(initial_base_amount or 0.0)
    if base <= 0:
        base = 1.0

    weights = [_reward_weight(t, base_tier) for t in range(1, MAX_MICRO_TIER + 1)]
    for _ in range(8):
        s = sum(int(math.ceil(base * w)) for w in weights)
        if s <= 0:
            return base
        base *= float(target_total) / float(s)
    return base


def _normalize_base_amount_to_total_for_tiers(*, tiers: range, base_tier: int, target_total: int, initial_base_amount: float) -> float:
    """
    Find a baseAmount such that:
      sum_{t in tiers} ceil(baseAmount * w(t, base_tier)) ~= target_total
    """
    base = float(initial_base_amount or 0.0)
    if base <= 0:
        base = 1.0

    tiers_list = [int(t) for t in tiers]
    if not tiers_list:
        return base

    weights = [_reward_weight(t, base_tier) for t in tiers_list]
    for _ in range(8):
        s = sum(int(math.ceil(base * w)) for w in weights)
        if s <= 0:
            return base
        base *= float(target_total) / float(s)
    return base


def _initial_base_amount_for_total(*, tiers: range, base_tier: int, target_total: int) -> float:
    denom = sum(_reward_weight(int(t), base_tier) for t in tiers) if tiers else 0.0
    if denom <= 0:
        return 1.0
    return float(target_total) / denom


# Baselines (v4):
# - Each micro tier: rotating primary + loot_box_pieces + rotating pool token (see _ROT_PRIM_KEYS / _ROT_TOKEN_KEYS).
# - Normalization keeps totals near: cash, bullets, points, loot pieces, XP tokens, random tokens, auto-rank 2h.

TARGET_RANDOM_TOKENS_TOTAL = 250
TARGET_LOOT_PIECES_TOTAL = 500
TARGET_XP_CRIMES_TOKENS_TOTAL = 150
TARGET_XP_GTA_TOKENS_TOTAL = 150

# Token keys that represent the "random token pool" in this implementation.
_RANDOM_TOKEN_KEYS = ["melt_tokens", "jailbust_tokens", "travel_tokens", "properties_tokens"]

# Deterministic seed for free-track unlock pick (string->int matches frontend fnv1a32).
_SEED_FREE = "game_pass_micro_rewards:free:v4"

# v4 layout: every micro tier grants three buckets — rotating primary, loot pieces every tier,
# and rotating random token — so loot + melt/jailbust/travel/properties appear across all 100 tiers.
_ROT_PRIM_KEYS = ("money", "bullets", "xp_crimes_tokens", "xp_gta_tokens", "points")
_ROT_TOKEN_KEYS = ("melt_tokens", "jailbust_tokens", "travel_tokens", "properties_tokens")

# Category pool for MICRO_TIER_REWARD_BASELINES init (auto_rank_2h_tokens is guaranteed separately).
_SELECTABLE_KEYS = [
    "money",
    "bullets",
    "xp_crimes_tokens",
    "xp_gta_tokens",
    "points",
    "loot_box_pieces",
    *_RANDOM_TOKEN_KEYS,
]

_BASE_TIER_BY_KEY = {
    "money": _MONEY_BASE_TIER,
    "bullets": 20,
    "xp_crimes_tokens": 40,
    "xp_gta_tokens": 40,
    "points": _POINTS_BASE_TIER,
    "loot_box_pieces": 55,
    "melt_tokens": 70,
    "jailbust_tokens": 80,
    "travel_tokens": 90,
    "properties_tokens": 100,
    "auto_rank_2h_tokens": 100,
}

# For keys not included in the target normalization, we keep a fixed baseAmount.
_FIXED_BASE_AMOUNT_BY_KEY: dict[str, float] = {}


def _fnv1a_32(s: str) -> int:
    """Stable 32-bit FNV-1a hash (matches the frontend implementation)."""
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch) & 0xFF
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def _mulberry32(seed: int):
    """Deterministic PRNG float generator (matches frontend mulberry32)."""
    a = seed & 0xFFFFFFFF

    def _rand():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = (t ^ (t >> 15)) * (t | 1)
        t &= 0xFFFFFFFF
        t ^= t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)
        t &= 0xFFFFFFFF
        return t / 4294967296  # 0..1

    return _rand


def _distribute_total(total: int, keys: list[str]) -> dict[str, int]:
    """Split `total` across keys as evenly as possible (stable order)."""
    n = max(1, len(keys))
    base = total // n
    rem = total % n
    out: dict[str, int] = {}
    for i, k in enumerate(keys):
        out[k] = base + (1 if i < rem else 0)
    return out


_target_random_by_key = _distribute_total(TARGET_RANDOM_TOKENS_TOTAL, _RANDOM_TOKEN_KEYS)
_TARGET_TOTAL_BY_KEY = {
    "money": TARGET_CASH_TOTAL,
    "bullets": TARGET_BULLETS_TOTAL,
    "points": TARGET_POINTS_TOTAL,
    "loot_box_pieces": TARGET_LOOT_PIECES_TOTAL,
    "xp_crimes_tokens": TARGET_XP_CRIMES_TOKENS_TOTAL,
    "xp_gta_tokens": TARGET_XP_GTA_TOKENS_TOTAL,
    **_target_random_by_key,
}


_SELECTED_KEYS_BY_TIER: dict[int, list[str]] = {}
_FREE_UNLOCKED_KEY_BY_TIER: dict[int, str | None] = {}

_BASE_AMOUNT_BY_KEY: dict[str, float] = {}

# Precompute deterministic selections + normalization baseAmount.
_tiers_assigned_by_key: dict[str, list[int]] = {k: [] for k in _TARGET_TOTAL_BY_KEY.keys()}

for t in range(1, MAX_MICRO_TIER + 1):
    prim = _ROT_PRIM_KEYS[(t - 1) % len(_ROT_PRIM_KEYS)]
    tok = _ROT_TOKEN_KEYS[(t - 1) % len(_ROT_TOKEN_KEYS)]
    chosen = [prim, "loot_box_pieces", tok]
    _SELECTED_KEYS_BY_TIER[t] = chosen

    free_rng = _mulberry32(_fnv1a_32(f"{_SEED_FREE}:{t}"))
    _FREE_UNLOCKED_KEY_BY_TIER[t] = chosen[int(math.floor(free_rng() * len(chosen)))]

    for k in _TARGET_TOTAL_BY_KEY.keys():
        if k in chosen:
            _tiers_assigned_by_key[k].append(t)


for k, assigned_tiers in _tiers_assigned_by_key.items():
    if not assigned_tiers:
        # No tiers selected for this key; keep baseAmount minimal.
        _BASE_AMOUNT_BY_KEY[k] = 1.0
        continue
    base_tier = _BASE_TIER_BY_KEY.get(k)
    if base_tier is None:
        _BASE_AMOUNT_BY_KEY[k] = 1.0
        continue
    initial_guess = _initial_base_amount_for_total(
        tiers=range(min(assigned_tiers), max(assigned_tiers) + 1),
        base_tier=base_tier,
        target_total=_TARGET_TOTAL_BY_KEY[k],
    )
    # Normalize using the exact assigned tier list (not a range).
    initial_guess = float(_TARGET_TOTAL_BY_KEY[k]) / sum((t / float(base_tier)) for t in assigned_tiers) if assigned_tiers else 1.0
    _BASE_AMOUNT_BY_KEY[k] = _normalize_base_amount_to_total_for_tiers(
        tiers=assigned_tiers,
        base_tier=base_tier,
        target_total=_TARGET_TOTAL_BY_KEY[k],
        initial_base_amount=initial_guess,
    )


# --- Guaranteed auto_rank_2h_tokens: appears in every tier, scaled low→high. ---
_AUTO_RANK_BASE_TIER = _BASE_TIER_BY_KEY["auto_rank_2h_tokens"]  # 100
_auto_rank_initial = float(TARGET_AUTO_RANK_2H_TOTAL) / sum(
    (t / float(_AUTO_RANK_BASE_TIER)) for t in range(1, MAX_MICRO_TIER + 1)
) if MAX_MICRO_TIER else 1.0
_AUTO_RANK_BASE_AMOUNT = _normalize_base_amount_to_total_for_tiers(
    tiers=list(range(1, MAX_MICRO_TIER + 1)),
    base_tier=_AUTO_RANK_BASE_TIER,
    target_total=TARGET_AUTO_RANK_2H_TOTAL,
    initial_base_amount=_auto_rank_initial,
)

# Baselines used at runtime to compute reward amounts.
MICRO_TIER_REWARD_BASELINES = {}
for key in _SELECTABLE_KEYS:
    base_tier = _BASE_TIER_BY_KEY[key]
    if key in _FIXED_BASE_AMOUNT_BY_KEY:
        base_amount = _FIXED_BASE_AMOUNT_BY_KEY[key]
    else:
        base_amount = _BASE_AMOUNT_BY_KEY.get(key, 1.0)
    MICRO_TIER_REWARD_BASELINES[key] = {"baseTier": base_tier, "baseAmount": base_amount}
MICRO_TIER_REWARD_BASELINES["auto_rank_2h_tokens"] = {
    "baseTier": _AUTO_RANK_BASE_TIER,
    "baseAmount": _AUTO_RANK_BASE_AMOUNT,
}


def micro_tier_from_rank_points(rank_points: Optional[int | float]) -> int:
    """Convert a rank_points snapshot into micro tier (0..100)."""
    try:
        rp = int(rank_points or 0)
    except Exception:
        rp = 0

    if rp < MICRO_TIER_STEP_RP:
        return 0

    tier = int(math.floor((rp / MAX_THRESHOLD_RP) * 100))
    return max(0, min(MAX_MICRO_TIER, tier))


def vip_game_pass_entitlement_active(user: dict, *, now_utc: Optional[datetime] = None) -> bool:
    """True if user claimed VIP Game Pass and token is not expired (missing/invalid expiry treated as active)."""
    if user.get("rank_xp_pass_rewards_granted") is not True:
        return False
    now = now_utc or datetime.now(timezone.utc)
    expires_raw = user.get("rank_xp_pass_token_expires_at")
    if not expires_raw:
        return True
    try:
        dt = datetime.fromisoformat(str(expires_raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except Exception:
        return True
    return bool(dt > now)


def rank_points_for_game_pass_season(user: dict) -> int:
    """Season-isolated RP that drives Game Pass micro tiers (mirrors positive rank XP gains)."""
    try:
        return max(0, int(user.get("rank_xp_pass_season_rp") or 0))
    except Exception:
        return 0


def rank_points_for_vip_game_pass(user: dict) -> int:
    """Deprecated name: pass tiers use season RP only (prestige carry no longer applies to pass bar)."""
    return rank_points_for_game_pass_season(user)


def micro_tier_for_game_pass_season(user: dict) -> int:
    return micro_tier_from_rank_points(rank_points_for_game_pass_season(user))


def micro_tier_for_vip_game_pass(user: dict) -> int:
    return micro_tier_for_game_pass_season(user)


_PERK_ROTATION = ("rp_10", "property_income_10", "jail_bust_10", "airport_cost")
_GAME_PASS_PERK_BY_TIER: dict[int, list[str]] = {}
for _t in range(1, MAX_MICRO_TIER + 1):
    if _t > 0 and _t % 25 == 0:
        _GAME_PASS_PERK_BY_TIER[_t] = [_PERK_ROTATION[(_t // 25 - 1) % len(_PERK_ROTATION)]]
    else:
        _GAME_PASS_PERK_BY_TIER[_t] = []


def perks_for_micro_tier(micro_tier: int) -> list[str]:
    """24h-style loot perks granted at select VIP tiers (deterministic)."""
    try:
        t = int(micro_tier or 0)
    except Exception:
        t = 0
    if t < 1 or t > MAX_MICRO_TIER:
        return []
    return list(_GAME_PASS_PERK_BY_TIER.get(t, []))


def micro_tier_min_rank_points(micro_tier: int) -> int:
    """Minimum RP needed to reach this micro tier."""
    if micro_tier <= 0:
        return 0
    return int(math.floor(micro_tier * MICRO_TIER_STEP_RP))


def rewards_for_micro_tier(micro_tier: int) -> Dict[str, int]:
    """
    Return the exact reward set for a given micro tier.

    Deterministic v4 contract:
    - Three buckets per tier: rotating primary, loot_box_pieces, rotating pool token (+ auto_rank every tier).
    - Amounts use normalized baseAmount scalars so season totals stay near configured targets.
    """
    try:
        t = int(micro_tier or 0)
    except Exception:
        t = 0

    if t < 1:
        return {}

    t = max(1, min(MAX_MICRO_TIER, t))
    selected_keys = _SELECTED_KEYS_BY_TIER.get(t) or []
    out: Dict[str, int] = {}
    for key in selected_keys:
        cfg = MICRO_TIER_REWARD_BASELINES[key]
        out[key] = int(math.ceil(cfg["baseAmount"] * _reward_weight(t, cfg["baseTier"])))
    # Guaranteed auto_rank_2h_tokens bonus in every tier.
    ar_cfg = MICRO_TIER_REWARD_BASELINES["auto_rank_2h_tokens"]
    ar_amt = int(math.ceil(ar_cfg["baseAmount"] * _reward_weight(t, ar_cfg["baseTier"])))
    if ar_amt > 0:
        out["auto_rank_2h_tokens"] = ar_amt
    return out


def next_rewards_for_micro_tier(micro_tier: int) -> Dict[str, int]:
    """Next micro tier reward set."""
    return rewards_for_micro_tier(int(micro_tier or 0) + 1)


def free_unlocked_key_for_micro_tier(micro_tier: int, rewards: Dict[str, int]) -> Optional[str]:
    """
    Deterministic free unlock key helper.

    Free unlock chooses deterministically one of the keys selected for this micro tier.
    """
    try:
        t = int(micro_tier or 0)
    except Exception:
        return None
    chosen = _FREE_UNLOCKED_KEY_BY_TIER.get(t)
    if not chosen:
        return None
    # Safety: only return keys that are present in the provided reward dict.
    if int(rewards.get(chosen) or 0) > 0:
        return chosen
    return None


def vip_rewards_after_free_dedupe(micro_tier: int, free_cash_last_micro_tier_granted: int) -> Dict[str, int]:
    """
    VIP payout for a micro tier after optionally zeroing the bucket already granted by
    the free Game Pass track for that tier (avoid double-paying the same bucket).

    If zeroing that bucket would remove *all* rewards (e.g. tier 1 is only xp_gta_tokens
    and the free track already granted it), skip suppression so VIP still credits the tier
    instead of advancing the cursor with an empty $inc.
    """
    try:
        t = int(micro_tier or 0)
    except Exception:
        t = 0
    if t < 1:
        return {}

    r = dict(rewards_for_micro_tier(t))
    if int(free_cash_last_micro_tier_granted or 0) < t:
        return r

    # Free track only auto-grants at band ends (10, 20, … 100), not every micro tier.
    if t % 10 != 0:
        return r

    fk = free_unlocked_key_for_micro_tier(t, r)
    if not fk:
        return r

    trial = dict(r)
    trial[fk] = 0
    if not any(int(v or 0) > 0 for v in trial.values()):
        return r

    r[fk] = 0
    return r


def _format_amount(amount: int) -> str:
    return f"{int(amount):,}"


def format_rewards_summary(rewards: Dict[str, int], *, include_zero: bool = False) -> str:
    """Format a full reward set summary for inbox notifications."""
    parts = []
    for k in REWARD_KEY_ORDER:
        amt = int(rewards.get(k) or 0)
        if amt <= 0 and not include_zero:
            continue
        label = REWARD_KEY_LABELS.get(k, k)
        if k == "money":
            parts.append(f"${_format_amount(amt)} cash")
        elif k in ("bullets", "points", "respect_points"):
            # points/respect labels are already in REWARD_KEY_LABELS
            parts.append(f"{_format_amount(amt)} {label}")
        elif k == "loot_box_pieces":
            parts.append(f"{_format_amount(amt)} {label}")
        else:
            parts.append(f"{_format_amount(amt)}x {label}")
    return ", ".join(parts)

