"""
Per-player permanent Game Pass weed strains (VIP micro-tier rewards).

Stored on users.game_pass_weed_strain_ids (not unique loot exclusives).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

GP_SOUR_DIESEL = "gp_sour_diesel"
GP_GIRL_SCOUT_COOKIES = "gp_girl_scout_cookies"
GP_PURPLE_PUNCH = "gp_purple_punch"
GP_WEDDING_CAKE = "gp_wedding_cake"
GP_GORILLA_GLUE = "gp_gorilla_glue"

GAME_PASS_STRAIN_IDS: tuple = (
    GP_SOUR_DIESEL,
    GP_GIRL_SCOUT_COOKIES,
    GP_PURPLE_PUNCH,
    GP_WEDDING_CAKE,
    GP_GORILLA_GLUE,
)

# VIP micro-tier → strain id (v4 profile only)
GAME_PASS_STRAIN_BY_TIER: Dict[int, str] = {
    20: GP_SOUR_DIESEL,
    28: GP_GIRL_SCOUT_COOKIES,
    35: GP_PURPLE_PUNCH,
    42: GP_WEDDING_CAKE,
    50: GP_GORILLA_GLUE,
}

GAME_PASS_STRAIN_BUFFS: Dict[str, Dict[str, Any]] = {
    GP_SOUR_DIESEL: {
        "label": "+5% ranking (RP) while owned",
        "kind": "rank_points",
    },
    GP_GIRL_SCOUT_COOKIES: {
        "label": "−5% raid success vs you while planted",
        "kind": "raid_defence_planted",
    },
    GP_PURPLE_PUNCH: {
        "label": "Lose only 50% of cash / stash / curing on heat bust",
        "kind": "bust_soft",
    },
    GP_WEDDING_CAKE: {
        "label": "+25% daily withdraw with active VIP; +15% permanent after",
        "kind": "withdraw_cap",
    },
    GP_GORILLA_GLUE: {
        "label": "−10% Weed Empire upgrade costs",
        "kind": "upgrade_discount",
    },
}

# Catalog seed: id, name, type, hours, yield_range, price_mult, bud_mesh
GAME_PASS_STRAIN_SEED: List[tuple] = [
    (GP_SOUR_DIESEL, "Sour Diesel", "sativa", 5.0, (20, 30), 2.2, "airy"),
    (GP_GIRL_SCOUT_COOKIES, "Girl Scout Cookies", "hybrid", 4.5, (22, 34), 2.3, "frosty"),
    (GP_PURPLE_PUNCH, "Purple Punch", "indica", 4.0, (24, 36), 2.25, "dense"),
    (GP_WEDDING_CAKE, "Wedding Cake", "hybrid", 5.0, (22, 32), 2.35, "frosty"),
    (GP_GORILLA_GLUE, "Gorilla Glue #4", "hybrid", 5.5, (26, 38), 2.4, "dense"),
]

GP_RANK_POINTS_BONUS_MULT = 1.05
GP_RAID_SUCCESS_MULT_WHEN_PLANTED = 0.95
GP_UPGRADE_COST_MULT = 0.90
GP_WITHDRAW_MULT_PERMANENT = 1.15
GP_WITHDRAW_MULT_ACTIVE_VIP = 1.25


def is_game_pass_strain_id(strain_id: Optional[str]) -> bool:
    return bool(strain_id) and str(strain_id) in GAME_PASS_STRAIN_IDS


def game_pass_strain_display_name(strain_id: str) -> str:
    for sid, name, *_rest in GAME_PASS_STRAIN_SEED:
        if sid == strain_id:
            return name
    return str(strain_id).replace("gp_", "").replace("_", " ").title()


def owned_game_pass_strain_ids(user: Optional[dict]) -> Set[str]:
    raw = (user or {}).get("game_pass_weed_strain_ids")
    if not isinstance(raw, list):
        return set()
    return {str(x) for x in raw if x and str(x) in GAME_PASS_STRAIN_IDS}


def user_owns_game_pass_strain(user: Optional[dict], strain_id: str) -> bool:
    return strain_id in owned_game_pass_strain_ids(user)


def game_pass_strain_for_micro_tier(micro_tier: int, *, profile_key: str) -> Optional[str]:
    if profile_key != "v4":
        return None
    try:
        t = int(micro_tier or 0)
    except (TypeError, ValueError):
        return None
    return GAME_PASS_STRAIN_BY_TIER.get(t)


async def grant_game_pass_strain(db, user_id: str, strain_id: str) -> bool:
    """Permanently unlock a Game Pass strain for the player. Idempotent."""
    if not user_id or not is_game_pass_strain_id(strain_id):
        return False
    res = await db.users.update_one(
        {"id": user_id},
        {"$addToSet": {"game_pass_weed_strain_ids": strain_id}},
    )
    return int(res.modified_count or 0) > 0 or int(res.matched_count or 0) > 0


def scale_rank_points_for_game_pass_strain(base_rp: int, user: Optional[dict]) -> int:
    """+5% RP while Sour Diesel is owned."""
    try:
        rp = int(base_rp or 0)
    except (TypeError, ValueError):
        return 0
    if rp <= 0 or not user_owns_game_pass_strain(user, GP_SOUR_DIESEL):
        return rp
    return int(round(rp * GP_RANK_POINTS_BONUS_MULT))


def farm_has_strain_planted(farm: Optional[dict], strain_id: str) -> bool:
    if not farm or not strain_id:
        return False
    for p in farm.get("plots") or []:
        if not isinstance(p, dict):
            continue
        if str(p.get("strain_id") or "") != strain_id:
            continue
        state = str(p.get("state") or "")
        if state in ("growing", "ready", "flowering", "vegetative") or p.get("planted_at"):
            if state not in ("empty", ""):
                return True
    return False


def game_pass_buffs_public(owned_ids: Set[str], *, active_vip: bool = False) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for sid in GAME_PASS_STRAIN_IDS:
        if sid not in (owned_ids or set()):
            continue
        buff = GAME_PASS_STRAIN_BUFFS.get(sid) or {}
        label = buff.get("label") or ""
        if sid == GP_WEDDING_CAKE:
            label = (
                "+25% daily withdraw (active VIP)"
                if active_vip
                else "+15% daily withdraw (permanent)"
            )
        out.append(
            {
                "strain_id": sid,
                "name": game_pass_strain_display_name(sid),
                "buff_label": label,
                "buff_kind": buff.get("kind") or "",
                "active": True,
                "game_pass": True,
            }
        )
    return out
