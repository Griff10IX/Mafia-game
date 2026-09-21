"""Equipped Ultra Rare profile theme bonuses (visual = power)."""
from __future__ import annotations

import random
from typing import Any, Dict, Optional, Set

from utils.profile_background_themes import equipped_theme_id

# theme_id -> bonus metadata (keep labels player-facing)
THEME_BONUS: Dict[str, Dict[str, Any]] = {
    "ur_samurai_fuji": {
        "id": "rp_50",
        "label": "+50% rank points from crimes, GTA, OC, and missions",
    },
    "ur_orbit_overlook": {
        "id": "gta_multi_rare",
        "label": "GTA rare/legendary: 50% chance to receive 5 cars instead of 1",
    },
    "ur_noir_balcony": {
        "id": "hitlist_npc_x3",
        "label": "Hitlist NPC kill: 50% chance for ×3 reward",
    },
    "ur_jungle_explorer": {
        "id": "crime_cash_double",
        "label": "Crimes success: 50% chance to double cash",
    },
    "ur_cyber_oni": {
        "id": "bullets_needed_15",
        "label": "−15% bullets needed to kill",
    },
    "ur_blood_moon": {
        "id": "hitlist_cash_50",
        "label": "+50% hitlist NPC cash",
    },
    "ur_space_hangar": {
        "id": "travel_cost_50",
        "label": "−50% airport travel cost",
    },
    "ur_colony_ring": {
        "id": "income_25",
        "label": "+25% property and illegal business income",
    },
    "ur_mob_office_dog": {
        "id": "robot_free_daily",
        "label": "+1 free Robot Bodyguard hire / day (stacks to 5)",
    },
    "ur_inner_circle": {
        "id": "oc_payout_25",
        "label": "+25% OC heist payout",
    },
    "ur_vittoria_club": {
        "id": "weed_payout_25",
        "label": "+25% Weed Empire sell / payout",
    },
    "ur_empire_lounge": {
        "id": "heist_loot_piece",
        "label": "Jewelry / Bank / Casino Heist success: 0.25% chance for 1 loot piece",
    },
}

HEIST_CRIME_IDS: Set[str] = {
    "jewelry_heist",
    "bank_heist",
    "casino_heist",
    "jewellery_heist",
}


def equipped_bonus_id(user: Optional[dict]) -> Optional[str]:
    tid = equipped_theme_id(user)
    if not tid:
        return None
    meta = THEME_BONUS.get(tid)
    return str(meta["id"]) if meta else None


def equipped_bonus_label(user: Optional[dict]) -> Optional[str]:
    tid = equipped_theme_id(user)
    if not tid:
        return None
    meta = THEME_BONUS.get(tid)
    return str(meta["label"]) if meta else None


def has_bonus(user: Optional[dict], bonus_id: str) -> bool:
    return equipped_bonus_id(user) == bonus_id


def rank_points_mult(user: Optional[dict]) -> float:
    return 1.5 if has_bonus(user, "rp_50") else 1.0


def apply_rank_points_bonus(user: Optional[dict], amount: int) -> int:
    try:
        n = int(amount or 0)
    except (TypeError, ValueError):
        return 0
    if n <= 0:
        return 0
    return max(0, int(round(n * rank_points_mult(user))))


def gta_rare_car_copy_count(user: Optional[dict], rarity: Optional[str]) -> int:
    """1 normally; with orbit theme, 50% chance of 5 when rarity is rare or legendary."""
    r = str(rarity or "").strip().lower()
    if r not in ("rare", "legendary", "ultra_rare") or not has_bonus(user, "gta_multi_rare"):
        return 1
    return 5 if random.random() < 0.5 else 1


def hitlist_npc_reward_mult(user: Optional[dict]) -> float:
    """Cash always +50% with blood moon; noir balcony adds 50% chance ×3 on top for all reward types."""
    mult = 1.0
    if has_bonus(user, "hitlist_cash_50"):
        mult *= 1.5
    if has_bonus(user, "hitlist_npc_x3") and random.random() < 0.5:
        mult *= 3.0
    return mult


def crime_cash_mult(user: Optional[dict]) -> float:
    if has_bonus(user, "crime_cash_double") and random.random() < 0.5:
        return 2.0
    return 1.0


def bullets_needed_mult(user: Optional[dict]) -> float:
    return 0.85 if has_bonus(user, "bullets_needed_15") else 1.0


def travel_cost_mult(user: Optional[dict]) -> float:
    return 0.5 if has_bonus(user, "travel_cost_50") else 1.0


def property_income_mult(user: Optional[dict]) -> float:
    return 1.25 if has_bonus(user, "income_25") else 1.0


def oc_payout_mult(user: Optional[dict]) -> float:
    return 1.25 if has_bonus(user, "oc_payout_25") else 1.0


def weed_payout_mult(user: Optional[dict]) -> float:
    return 1.25 if has_bonus(user, "weed_payout_25") else 1.0


def roll_heist_loot_piece(user: Optional[dict], crime_id: Optional[str]) -> bool:
    cid = str(crime_id or "").strip().lower()
    if not has_bonus(user, "heist_loot_piece"):
        return False
    if cid not in HEIST_CRIME_IDS and not any(x in cid for x in ("jewelry", "jewellery", "bank_heist", "casino_heist")):
        return False
    return random.random() < 0.0025


ROBOT_FREE_DAILY_CAP = 5


def theme_robot_free_daily_credit_update(user: Optional[dict]) -> Optional[Dict[str, Any]]:
    """If mob-office theme equipped and UTC day rolled, grant +1 free hire (cap 5). Returns a $set-only update."""
    if not has_bonus(user, "robot_free_daily"):
        return None
    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if str(user.get("theme_robot_free_credit_utc_date") or "") == today:
        return None
    cur = int(user.get("theme_robot_free_hires") or 0)
    new_h = min(ROBOT_FREE_DAILY_CAP, cur + 1)
    return {"$set": {"theme_robot_free_credit_utc_date": today, "theme_robot_free_hires": new_h}}
