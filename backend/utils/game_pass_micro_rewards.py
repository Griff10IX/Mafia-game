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
# With the band-fixed 1-2 bucket model:
# - `money` only appears on micro tiers 1..10, so we normalize across 1..10.
# - `points` only appears on micro tiers 31..40, so we normalize across 31..40.
_money_active_tiers = range(1, 11)
_points_active_tiers = range(31, 41)
_auto_rank_2h_active_tiers = range(81, 101)

_money_base = _normalize_base_amount_to_total_for_tiers(
    tiers=_money_active_tiers,
    base_tier=_MONEY_BASE_TIER,
    target_total=TARGET_CASH_TOTAL,
    initial_base_amount=_initial_base_amount_for_total(
        tiers=_money_active_tiers,
        base_tier=_MONEY_BASE_TIER,
        target_total=TARGET_CASH_TOTAL,
    ),
)

_points_base = _normalize_base_amount_to_total_for_tiers(
    tiers=_points_active_tiers,
    base_tier=_POINTS_BASE_TIER,
    target_total=TARGET_POINTS_TOTAL,
    initial_base_amount=_initial_base_amount_for_total(
        tiers=_points_active_tiers,
        base_tier=_POINTS_BASE_TIER,
        target_total=TARGET_POINTS_TOTAL,
    ),
)

_auto_rank_2h_base_tier = 100
_auto_rank_2h_base = _normalize_base_amount_to_total_for_tiers(
    tiers=_auto_rank_2h_active_tiers,
    base_tier=_auto_rank_2h_base_tier,
    target_total=TARGET_AUTO_RANK_2H_TOTAL,
    initial_base_amount=_initial_base_amount_for_total(
        tiers=_auto_rank_2h_active_tiers,
        base_tier=_auto_rank_2h_base_tier,
        target_total=TARGET_AUTO_RANK_2H_TOTAL,
    ),
)

MICRO_TIER_REWARD_BASELINES = {
    "money": {"baseTier": _MONEY_BASE_TIER, "baseAmount": _money_base},
    "bullets": {"baseTier": 20, "baseAmount": 2_500},
    "xp_crimes_tokens": {"baseTier": 40, "baseAmount": 2},
    "xp_gta_tokens": {"baseTier": 40, "baseAmount": 2},
    "points": {"baseTier": _POINTS_BASE_TIER, "baseAmount": _points_base},
    "respect_points": {"baseTier": 60, "baseAmount": 50},
    "melt_tokens": {"baseTier": 70, "baseAmount": 2},
    "jailbust_tokens": {"baseTier": 80, "baseAmount": 2},
    "travel_tokens": {"baseTier": 90, "baseAmount": 1},
    "properties_tokens": {"baseTier": 100, "baseAmount": 1},
    "auto_rank_2h_tokens": {"baseTier": _auto_rank_2h_base_tier, "baseAmount": _auto_rank_2h_base},
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


def micro_tier_min_rank_points(micro_tier: int) -> int:
    """Minimum RP needed to reach this micro tier."""
    if micro_tier <= 0:
        return 0
    return int(math.floor(micro_tier * MICRO_TIER_STEP_RP))


def rewards_for_micro_tier(micro_tier: int) -> Dict[str, int]:
    """
    Return the exact reward set for a given micro tier.

    Band-fixed contract (for UI compression):
    - 1..10: cash only
    - 11..20: bullets only
    - 21..30: Crimes + GTA XP tokens (compressed by frontend as one "Auto Rank Perks" line)
    - 31..40: points only
    - 41..50: respect only
    - 51..60: Melt token only
    - 61..70: Jailbust token only
    - 71..80: Travel token only
    - 81..100: Properties token only
    """
    try:
        t = int(micro_tier or 0)
    except Exception:
        t = 0

    if t < 1:
        return {}

    t = max(1, min(MAX_MICRO_TIER, t))
    out: Dict[str, int] = {}

    def _set(key: str) -> None:
        cfg = MICRO_TIER_REWARD_BASELINES[key]
        out[key] = int(math.ceil(cfg["baseAmount"] * (t / cfg["baseTier"])))

    if 1 <= t <= 10:
        _set("money")
        return out
    if 11 <= t <= 20:
        _set("bullets")
        return out
    if 21 <= t <= 30:
        _set("xp_crimes_tokens")
        _set("xp_gta_tokens")
        return out
    if 31 <= t <= 40:
        _set("points")
        return out
    if 41 <= t <= 50:
        _set("respect_points")
        return out
    if 51 <= t <= 60:
        _set("melt_tokens")
        return out
    if 61 <= t <= 70:
        _set("jailbust_tokens")
        return out
    if 71 <= t <= 80:
        _set("travel_tokens")
        return out

    # 81..100
    _set("auto_rank_2h_tokens")
    return out


def next_rewards_for_micro_tier(micro_tier: int) -> Dict[str, int]:
    """Next micro tier reward set."""
    return rewards_for_micro_tier(int(micro_tier or 0) + 1)


def free_unlocked_key_for_micro_tier(micro_tier: int, rewards: Dict[str, int]) -> Optional[str]:
    """
    Deterministic free unlock key helper.

    With band-fixed rewards, free unlock is simply the first non-zero key in `REWARD_KEY_ORDER`.
    """
    if not rewards:
        return None
    for k in REWARD_KEY_ORDER:
        if int(rewards.get(k) or 0) > 0:
            return k
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

