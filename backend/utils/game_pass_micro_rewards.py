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

MAX_THRESHOLD_RP = 20_000
MAX_MICRO_TIER = 100
MICRO_TIER_STEP_RP = MAX_THRESHOLD_RP / MAX_MICRO_TIER  # 200 RP

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
}

# Baselines at the original 10%-milestones (confirmed).
MICRO_TIER_REWARD_BASELINES = {
    "money": {"baseTier": 10, "baseAmount": 25_000_000},
    "bullets": {"baseTier": 20, "baseAmount": 2_500},
    "xp_crimes_tokens": {"baseTier": 40, "baseAmount": 2},
    "xp_gta_tokens": {"baseTier": 40, "baseAmount": 2},
    "points": {"baseTier": 50, "baseAmount": 50},
    "respect_points": {"baseTier": 60, "baseAmount": 50},
    "melt_tokens": {"baseTier": 70, "baseAmount": 2},
    "jailbust_tokens": {"baseTier": 80, "baseAmount": 2},
    "travel_tokens": {"baseTier": 90, "baseAmount": 1},
    "properties_tokens": {"baseTier": 100, "baseAmount": 1},
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
    """Return the exact reward set for a given micro tier."""
    try:
        t = int(micro_tier or 0)
    except Exception:
        t = 0

    if t < 1:
        return {}

    t = max(1, min(MAX_MICRO_TIER, t))
    out: Dict[str, int] = {}
    for k, cfg in MICRO_TIER_REWARD_BASELINES.items():
        raw = cfg["baseAmount"] * (t / cfg["baseTier"])
        out[k] = int(math.ceil(raw))
    return out


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

