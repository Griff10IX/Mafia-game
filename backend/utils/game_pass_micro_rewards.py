"""
Game Pass micro-tier reward model.

Micro tiers:
  - 1..100 represent progress percent 1%..100% of MAX_THRESHOLD_RP.
  - Rewards are granted for an exact micro tier (not cumulative).

Scaling:
  - For each reward type: amount = ceil(baseAmount * (tier / baseTier))
"""

from __future__ import annotations

import math
from typing import Dict, Optional

MAX_THRESHOLD_RP = 400_000
MAX_MICRO_TIER = 100
MICRO_TIER_STEP_RP = MAX_THRESHOLD_RP / MAX_MICRO_TIER  # 4,000 RP

# Reward key order and labels used for inbox summaries.
REWARD_KEY_ORDER = [
    "money",
    "bullets",
    "xp_crimes_tokens",
    "xp_gta_tokens",
    "points",
    "respect_points",
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
}

# Targets (your request)
TARGET_CASH_TOTAL = 50_000_000
TARGET_POINTS_TOTAL = 6_000
TARGET_BULLETS_TOTAL = 250_000
TARGET_AUTO_RANK_2H_TOTAL = 50

_MONEY_BASE_TIER = 10
_POINTS_BASE_TIER = 50


def _normalize_base_amount_to_total(*, base_tier: int, target_total: int, initial_base_amount: float) -> float:
    """
    Find a baseAmount such that:
      sum_{t=1..100} ceil(baseAmount * (t / base_tier)) ~= target_total

    Uses a small iterative scaling to converge (since ceil makes it piecewise).
    """
    base = float(initial_base_amount or 0.0)
    if base <= 0:
        base = 1.0

    weights = [(t / float(base_tier)) for t in range(1, MAX_MICRO_TIER + 1)]
    for _ in range(8):
        s = sum(int(math.ceil(base * w)) for w in weights)
        if s <= 0:
            return base
        base *= float(target_total) / float(s)
    return base


def _normalize_base_amount_to_total_for_tiers(*, tiers: range, base_tier: int, target_total: int, initial_base_amount: float) -> float:
    """
    Find a baseAmount such that:
      sum_{t in tiers} ceil(baseAmount * (t / base_tier)) ~= target_total
    """
    base = float(initial_base_amount or 0.0)
    if base <= 0:
        base = 1.0

    tiers_list = [int(t) for t in tiers]
    if not tiers_list:
        return base

    weights = [(t / float(base_tier)) for t in tiers_list]
    for _ in range(8):
        s = sum(int(math.ceil(base * w)) for w in weights)
        if s <= 0:
            return base
        base *= float(target_total) / float(s)
    return base


def _initial_base_amount_for_total(*, tiers: range, base_tier: int, target_total: int) -> float:
    denom = sum((t / float(base_tier)) for t in tiers) if tiers else 0.0
    if denom <= 0:
        return 1.0
    return float(target_total) / denom


# Baselines:
# Deterministic weighted random bucket selection:
# - Each micro tier selects 1 bucket 70% of the time, or 2 distinct buckets 30% of the time.
# - Rewards are deterministically chosen so all users see the same preview.
# - Then we normalize (linear scaling + ceil) so totals for the key targets land close to:
#     cash ~50,000,000, points ~6,000, bullets ~250,000, random tokens ~250, auto-rank 2h tokens ~50.

TARGET_RANDOM_TOKENS_TOTAL = 250

# Token keys that represent the "random token pool" in this implementation.
_RANDOM_TOKEN_KEYS = ["melt_tokens", "jailbust_tokens", "travel_tokens", "properties_tokens"]

# Deterministic seeds (string->int is stable across backend/frontend via fnv1a_32).
_SEED_CATEGORY = "game_pass_micro_rewards:category:v2"
_SEED_FREE = "game_pass_micro_rewards:free:v2"

TWO_BUCKET_CHANCE = 0.30

# Category pool for selection (respect_points excluded; not part of the 1–2 reward bucket contract).
_SELECTABLE_KEYS = [
    "money",
    "bullets",
    "xp_crimes_tokens",
    "xp_gta_tokens",
    "points",
    *_RANDOM_TOKEN_KEYS,
    "auto_rank_2h_tokens",
]

# Weights are tuned so cash isn't overwhelming early, and variety appears inside the same 1-10 band.
# Final totals for normalized keys are enforced by baseAmount normalization.
_CATEGORY_WEIGHTS = {
    "money": 60,
    "bullets": 20,
    "xp_crimes_tokens": 10,
    "xp_gta_tokens": 10,
    "points": 12,
    "melt_tokens": 2,
    "jailbust_tokens": 2,
    "travel_tokens": 2,
    "properties_tokens": 2,
    "auto_rank_2h_tokens": 2,
}

_BASE_TIER_BY_KEY = {
    "money": _MONEY_BASE_TIER,
    "bullets": 20,
    "xp_crimes_tokens": 40,
    "xp_gta_tokens": 40,
    "points": _POINTS_BASE_TIER,
    "melt_tokens": 70,
    "jailbust_tokens": 80,
    "travel_tokens": 90,
    "properties_tokens": 100,
    "auto_rank_2h_tokens": 100,
}

# For keys not included in the target normalization, we keep a fixed baseAmount.
_FIXED_BASE_AMOUNT_BY_KEY = {
    "xp_crimes_tokens": 2,
    "xp_gta_tokens": 2,
}


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


def _weighted_pick(rng, keys, weights_by_key):
    total = 0.0
    for k in keys:
        total += float(weights_by_key.get(k) or 0.0)
    if total <= 0:
        return None
    u = rng() * total
    acc = 0.0
    for k in keys:
        w = float(weights_by_key.get(k) or 0.0)
        acc += w
        if u < acc:
            return k
    return keys[-1] if keys else None


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
    "auto_rank_2h_tokens": TARGET_AUTO_RANK_2H_TOTAL,
    **_target_random_by_key,
}


_SELECTED_KEYS_BY_TIER: dict[int, list[str]] = {}
_FREE_UNLOCKED_KEY_BY_TIER: dict[int, str | None] = {}

_BASE_AMOUNT_BY_KEY: dict[str, float] = {}

# Precompute deterministic selections + normalization baseAmount.
_tiers_assigned_by_key: dict[str, list[int]] = {k: [] for k in _TARGET_TOTAL_BY_KEY.keys()}

for t in range(1, MAX_MICRO_TIER + 1):
    rng = _mulberry32(_fnv1a_32(f"{_SEED_CATEGORY}:{t}"))
    want_two = rng() < TWO_BUCKET_CHANCE
    remaining_keys = list(_SELECTABLE_KEYS)
    chosen: list[str] = []

    n_buckets = 2 if want_two else 1
    for _ in range(n_buckets):
        k = _weighted_pick(rng, remaining_keys, _CATEGORY_WEIGHTS)
        if not k:
            break
        chosen.append(k)
        remaining_keys = [x for x in remaining_keys if x != k]

    # Ensure 1..2 distinct keys.
    if not chosen:
        chosen = ["money"]
    chosen = chosen[:2]
    _SELECTED_KEYS_BY_TIER[t] = chosen

    free_rng = _mulberry32(_fnv1a_32(f"{_SEED_FREE}:{t}"))
    free_key = chosen[int(math.floor(free_rng() * len(chosen)))] if chosen else None
    _FREE_UNLOCKED_KEY_BY_TIER[t] = free_key

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


# Baselines used at runtime to compute reward amounts.
MICRO_TIER_REWARD_BASELINES = {}
for key in _SELECTABLE_KEYS:
    base_tier = _BASE_TIER_BY_KEY[key]
    if key in _FIXED_BASE_AMOUNT_BY_KEY:
        base_amount = _FIXED_BASE_AMOUNT_BY_KEY[key]
    else:
        base_amount = _BASE_AMOUNT_BY_KEY.get(key, 1.0)
    MICRO_TIER_REWARD_BASELINES[key] = {"baseTier": base_tier, "baseAmount": base_amount}


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


def micro_tier_min_rank_points(micro_tier: int) -> int:
    """Minimum RP needed to reach this micro tier."""
    if micro_tier <= 0:
        return 0
    return int(math.floor(micro_tier * MICRO_TIER_STEP_RP))


def rewards_for_micro_tier(micro_tier: int) -> Dict[str, int]:
    """
    Return the exact reward set for a given micro tier.

    Deterministic weighted contract:
    - Each micro tier gets 1 or 2 distinct reward keys chosen deterministically.
    - Amounts are derived from normalized baseAmount scalars so totals land close to targets.
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
        out[key] = int(math.ceil(cfg["baseAmount"] * (t / cfg["baseTier"])))
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
        else:
            parts.append(f"{_format_amount(amt)}x {label}")
    return ", ".join(parts)

