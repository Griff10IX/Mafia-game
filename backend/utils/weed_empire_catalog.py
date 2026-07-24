"""Weed Empire catalogs: houses, strains, equipment ladders, economy constants."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

GRAMS_PER_OZ = 28
OZ_PER_LB = 16
GRAMS_PER_LB = GRAMS_PER_OZ * OZ_PER_LB  # 448
GRAMS_PER_KG = 1000

START_BUSINESS_CASH = 100_000
DAILY_SELL_CAP_USD = 100_000_000
BASE_STREET_PRICE_PER_OZ = 22_500
MIN_CURE_MINUTES = 5.0
MAX_CURE_MINUTES = 20.0
MAX_CURE_BATCH_GRAMS = 300.0

# Soil charge consumed per plant
SOIL_CHARGE_PER_PLANT = 1

HOUSES: List[Dict[str, Any]] = [
    {
        "tier": 0,
        "id": "closet",
        "name": "Closet Grow",
        "plots": 2,
        "cost": 0,
        "max_equip_tier": 3,
        "grow_speed_mult": 1.0,
        "market_mult": 1.0,
        "heat_decay": 0.5,
        "raid_defence": 0,
        "description": "A crap closet with a towel under the door.",
    },
    {
        "tier": 1,
        "id": "basement",
        "name": "Basement Flat",
        "plots": 4,
        "cost": 75_000,
        "max_equip_tier": 8,
        "grow_speed_mult": 1.05,
        "market_mult": 1.35,
        "heat_decay": 0.8,
        "raid_defence": 5,
        "description": "Damp basement with room for a real tent.",
    },
    {
        "tier": 2,
        "id": "suburban",
        "name": "Suburban House",
        "plots": 8,
        "cost": 400_000,
        "max_equip_tier": 12,
        "grow_speed_mult": 1.12,
        "market_mult": 2.0,
        "heat_decay": 1.2,
        "raid_defence": 15,
        "description": "Whole spare rooms for multi-tent grows.",
    },
    {
        "tier": 3,
        "id": "warehouse",
        "name": "Warehouse",
        "plots": 16,
        "cost": 2_500_000,
        "max_equip_tier": 16,
        "grow_speed_mult": 1.2,
        "market_mult": 3.0,
        "heat_decay": 1.6,
        "raid_defence": 30,
        "description": "Industrial racks and serious power.",
    },
    {
        "tier": 4,
        "id": "compound",
        "name": "Compound",
        "plots": 24,
        "cost": 15_000_000,
        "max_equip_tier": 20,
        "grow_speed_mult": 1.3,
        "market_mult": 4.65,
        "heat_decay": 2.0,
        "raid_defence": 50,
        "description": "Fortified empire grounds.",
    },
]

# Real-life style strain names (public common names; no brand claims).
_STRAIN_SEED: List[Tuple[str, str, str, float, Tuple[int, int], float, int, str]] = [
    # id-ish name, display, type, base_hours, yield_g, price_per_oz_mult, unlock_tier, bud_mesh
    ("ditch_weed", "Ditch Weed", "hybrid", 2.5, (8, 14), 0.65, 0, "airy"),
    ("schwag", "Schwag Brick", "indica", 2.0, (10, 16), 0.7, 0, "dense"),
    ("northern_lights", "Northern Lights", "indica", 3.0, (14, 22), 1.0, 0, "dense"),
    ("white_widow", "White Widow", "hybrid", 3.5, (16, 24), 1.05, 0, "frosty"),
    ("skunk_1", "Skunk #1", "hybrid", 3.0, (15, 23), 1.0, 1, "dense"),
    ("blue_dream", "Blue Dream", "hybrid", 4.0, (18, 28), 1.15, 1, "airy"),
    ("sour_diesel", "Sour Diesel", "sativa", 4.5, (16, 26), 1.2, 1, "airy"),
    ("og_kush", "OG Kush", "hybrid", 4.0, (17, 27), 1.25, 1, "dense"),
    ("purple_haze", "Purple Haze", "sativa", 5.0, (14, 22), 1.2, 1, "purple"),
    ("ak47", "AK-47", "hybrid", 3.5, (18, 28), 1.1, 1, "dense"),
    ("hindu_kush", "Hindu Kush", "indica", 3.0, (16, 24), 1.05, 1, "dense"),
    ("afghani", "Afghani", "indica", 2.8, (15, 24), 1.0, 1, "dense"),
    ("jack_herer", "Jack Herer", "sativa", 5.0, (16, 25), 1.3, 2, "airy"),
    ("girl_scout_cookies", "Girl Scout Cookies", "hybrid", 5.0, (18, 28), 1.4, 2, "frosty"),
    ("gelato", "Gelato", "hybrid", 5.5, (17, 27), 1.45, 2, "frosty"),
    ("wedding_cake", "Wedding Cake", "hybrid", 5.5, (18, 28), 1.5, 2, "dense"),
    ("gorilla_glue", "Gorilla Glue", "hybrid", 4.5, (20, 32), 1.35, 2, "frosty"),
    ("pineapple_express", "Pineapple Express", "hybrid", 4.0, (17, 26), 1.25, 2, "airy"),
    ("bubba_kush", "Bubba Kush", "indica", 3.5, (16, 25), 1.2, 2, "dense"),
    ("granddaddy_purple", "Granddaddy Purple", "indica", 4.0, (15, 24), 1.3, 2, "purple"),
    ("amnesia_haze", "Amnesia Haze", "sativa", 6.0, (16, 26), 1.35, 2, "airy"),
    ("super_lemon_haze", "Super Lemon Haze", "sativa", 5.5, (17, 27), 1.4, 2, "airy"),
    ("green_crack", "Green Crack", "sativa", 4.0, (18, 28), 1.2, 2, "airy"),
    ("trainwreck", "Trainwreck", "hybrid", 4.0, (17, 27), 1.15, 2, "dense"),
    ("chemdawg", "Chemdawg", "hybrid", 4.5, (16, 26), 1.3, 2, "frosty"),
    ("durban_poison", "Durban Poison", "sativa", 5.0, (15, 24), 1.25, 2, "airy"),
    ("maui_wowie", "Maui Wowie", "sativa", 5.0, (14, 22), 1.2, 2, "airy"),
    ("lemon_skunk", "Lemon Skunk", "hybrid", 4.0, (16, 25), 1.15, 2, "airy"),
    ("blueberry", "Blueberry", "indica", 4.0, (15, 24), 1.25, 2, "purple"),
    ("strawberry_cough", "Strawberry Cough", "sativa", 5.0, (14, 23), 1.3, 2, "airy"),
    ("zkittlez", "Zkittlez", "indica", 5.5, (16, 25), 1.55, 3, "frosty"),
    ("runtz", "Runtz", "hybrid", 6.0, (17, 27), 1.65, 3, "frosty"),
    ("gelato_41", "Gelato 41", "hybrid", 6.0, (18, 28), 1.7, 3, "frosty"),
    ("do_si_dos", "Do-Si-Dos", "indica", 5.0, (17, 27), 1.5, 3, "dense"),
    ("mimosa", "Mimosa", "hybrid", 5.0, (16, 26), 1.45, 3, "airy"),
    ("sunset_sherbet", "Sunset Sherbet", "hybrid", 5.5, (16, 26), 1.5, 3, "frosty"),
    ("mac1", "MAC-1", "hybrid", 6.0, (18, 28), 1.75, 3, "frosty"),
    ("gmo_cookies", "GMO Cookies", "hybrid", 5.5, (19, 30), 1.6, 3, "dense"),
    ("ice_cream_cake", "Ice Cream Cake", "indica", 5.5, (18, 28), 1.55, 3, "dense"),
    ("purple_punch", "Purple Punch", "indica", 4.5, (16, 25), 1.45, 3, "purple"),
    ("wedding_crasher", "Wedding Crasher", "hybrid", 5.5, (17, 27), 1.5, 3, "frosty"),
    ("cereal_milk", "Cereal Milk", "hybrid", 6.0, (17, 27), 1.7, 3, "frosty"),
    ("london_pound_cake", "London Pound Cake", "hybrid", 6.0, (18, 28), 1.8, 3, "dense"),
    ("apple_fritter", "Apple Fritter", "hybrid", 5.5, (18, 29), 1.65, 3, "frosty"),
    ("permanent_marker", "Permanent Marker", "hybrid", 6.5, (18, 28), 1.85, 3, "frosty"),
    ("jealousy", "Jealousy", "hybrid", 6.0, (17, 27), 1.8, 3, "frosty"),
    ("rs11", "RS-11", "hybrid", 6.5, (18, 28), 1.9, 4, "frosty"),
    ("grape_gas", "Grape Gas", "hybrid", 6.0, (17, 27), 1.75, 4, "purple"),
    ("oreoz", "Oreoz", "indica", 5.5, (18, 28), 1.7, 4, "dense"),
    ("candy_fumez", "Candy Fumez", "hybrid", 6.5, (16, 26), 1.85, 4, "frosty"),
    ("tropicana_cookies", "Tropicana Cookies", "sativa", 6.0, (16, 26), 1.7, 4, "airy"),
    ("garlic_breath", "Garlic Breath", "indica", 5.5, (19, 30), 1.65, 4, "dense"),
    ("peanut_butter_breath", "Peanut Butter Breath", "hybrid", 5.5, (18, 28), 1.7, 4, "dense"),
    ("forbidden_fruit", "Forbidden Fruit", "indica", 5.0, (16, 25), 1.6, 4, "purple"),
    ("larry_og", "Larry OG", "hybrid", 4.5, (17, 27), 1.4, 4, "dense"),
    ("tahoe_og", "Tahoe OG", "hybrid", 4.5, (17, 26), 1.4, 4, "dense"),
    ("sfv_og", "SFV OG", "hybrid", 4.5, (16, 26), 1.35, 4, "dense"),
    ("ghost_og", "Ghost OG", "hybrid", 5.0, (17, 27), 1.5, 4, "frosty"),
    ("headband", "Headband", "hybrid", 5.0, (17, 27), 1.4, 4, "dense"),
    ("chocolope", "Chocolope", "sativa", 5.5, (16, 25), 1.45, 4, "airy"),
    ("tangie", "Tangie", "sativa", 5.0, (15, 24), 1.5, 4, "airy"),
    ("lemon_tree", "Lemon Tree", "hybrid", 5.5, (16, 26), 1.55, 4, "airy"),
    ("papaya", "Papaya", "indica", 4.5, (18, 28), 1.5, 4, "dense"),
    ("guava", "Guava", "hybrid", 5.5, (17, 27), 1.6, 4, "frosty"),
    ("zkittlez_cake", "Zkittlez Cake", "hybrid", 6.0, (17, 27), 1.85, 4, "frosty"),
    ("wedding_gelato", "Wedding Gelato", "hybrid", 6.0, (18, 28), 1.8, 4, "frosty"),
]


def _build_strains() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for sid, name, typ, hours, yld, price_mult, tier, mesh in _STRAIN_SEED:
        out.append(
            {
                "id": sid,
                "name": name,
                "type": typ,
                "base_grow_hours": hours,
                "yield_g_min": yld[0],
                "yield_g_max": yld[1],
                "base_price_per_oz": round(BASE_STREET_PRICE_PER_OZ * price_mult, 2),
                "unlock_house_tier": tier,
                "seed_cost": int(800 + tier * 2_500 + price_mult * 1_200),
                "rarity": "common" if tier <= 1 else ("uncommon" if tier == 2 else ("rare" if tier == 3 else "legendary")),
                "preferred_light": "either" if typ == "hybrid" else ("hps" if typ == "indica" else "led"),
                "bud_mesh_key": mesh,
                "thc_band": f"{16 + tier * 2}-{20 + tier * 3}%",
            }
        )
    return out


STRAINS: List[Dict[str, Any]] = _build_strains()
STRAIN_BY_ID: Dict[str, Dict[str, Any]] = {s["id"]: s for s in STRAINS}

# Equipment catalog lives in weed_empire_equipment (gates, tiers, room_visual).
from utils.weed_empire_equipment import (  # noqa: E402
    EQUIPMENT_BY_ID,
    EQUIPMENT_CATEGORIES,
    apply_grower_xp,
    assert_can_upgrade_equipment,
    equipment_level_cost,
    equipment_shop_entries,
    grower_progress,
    rarity_xp_mult,
    shop_status_for_farm,
    xp_to_next_level,
)

HOUSE_BY_TIER: Dict[int, Dict[str, Any]] = {h["tier"]: h for h in HOUSES}


def unit_to_grams(amount: float, unit: str) -> float:
    u = (unit or "g").strip().lower()
    a = float(amount)
    if u in ("g", "gram", "grams"):
        return a
    if u in ("oz", "ounce", "ounces"):
        return a * GRAMS_PER_OZ
    if u in ("lb", "lbs", "pound", "pounds"):
        return a * GRAMS_PER_LB
    if u in ("kg", "kilo", "kilos", "kilogram", "kilograms"):
        return a * GRAMS_PER_KG
    raise ValueError(f"Unknown unit: {unit}")


def grams_to_oz(grams: float) -> float:
    return float(grams) / GRAMS_PER_OZ


def curing_minutes(grams: float, curing_level: int = 0) -> float:
    """Scale curing from 5–20 minutes by batch weight, then apply equipment."""
    weight = min(1.0, max(0.0, float(grams)) / MAX_CURE_BATCH_GRAMS)
    amount_minutes = MIN_CURE_MINUTES + (MAX_CURE_MINUTES - MIN_CURE_MINUTES) * weight
    reduction = min(0.45, max(0, int(curing_level)) * 0.03)
    return max(MIN_CURE_MINUTES, MIN_CURE_MINUTES + (amount_minutes - MIN_CURE_MINUTES) * (1.0 - reduction))


def market_price_per_oz(
    strain: Dict[str, Any],
    *,
    house_tier: int,
    dealers_level: int,
    sold_today_usd: float,
    heat: float,
    dealer_cut: float = 1.0,
) -> float:
    """Return the progression-scaled sale value for one ounce."""
    house = HOUSE_BY_TIER.get(max(0, int(house_tier)), HOUSE_BY_TIER[0])
    house_mult = float(house.get("market_mult") or 1.0)
    network_mult = 1.0 + min(5, max(0, int(dealers_level))) * 0.2
    demand = max(0.55, 1.0 - (max(0.0, float(sold_today_usd)) / DAILY_SELL_CAP_USD) * 0.35)
    heat_penalty = min(0.45, max(0.0, float(heat)) / 200.0)
    quality_mult = 0.85 + 0.3 * 0.7
    return (
        float(strain.get("base_price_per_oz") or BASE_STREET_PRICE_PER_OZ)
        * demand
        * quality_mult
        * (1.0 - heat_penalty)
        * house_mult
        * network_mult
        * max(0.0, float(dealer_cut))
    )


def active_light_class(equipment_levels: Dict[str, int]) -> str:
    """Best owned light class for glow FX."""
    order = ("quantum", "led", "hps", "cfl")
    best = "cfl"
    best_score = -1
    for cat in EQUIPMENT_CATEGORIES:
        lc = cat.get("light_class")
        if not lc:
            continue
        lvl = int(equipment_levels.get(cat["id"]) or 0)
        if lvl <= 0:
            continue
        score = order.index(lc) if lc in order else 0
        score = score * 100 + lvl
        if score > best_score:
            best_score = score
            best = lc
    return best


def aggregate_stats(equipment_levels: Dict[str, int], house: Dict[str, Any]) -> Dict[str, float]:
    stats = {
        "grow_speed_mult": float(house.get("grow_speed_mult") or 1.0),
        "yield_mult": 1.0,
        "quality_ceiling": 55.0,
        "water_interval_mult": 1.0,
        "feed_efficiency": 1.0,
        "heat_gain_mult": 1.0,
        "odor_stealth": 0.0,
        "power_draw": 0.0,
        "power_capacity": 200.0,
        "raid_defence": float(house.get("raid_defence") or 0),
        "stash_security": 0.0,
        "cleanliness_decay_mult": 1.0,
        "mite_resistance": 0.0,
        "mite_treatment_bonus": 0.0,
    }
    for cat_id, lvl in (equipment_levels or {}).items():
        cat = EQUIPMENT_BY_ID.get(cat_id)
        if not cat:
            continue
        level = max(0, int(lvl or 0))
        if level <= 0:
            continue
        per = cat.get("stats_per_level") or {}
        for k, v in per.items():
            stats[k] = float(stats.get(k) or 0) + float(v) * level
    stats["grow_speed_mult"] = max(0.35, float(stats["grow_speed_mult"]))
    stats["yield_mult"] = max(0.35, float(stats["yield_mult"]))
    stats["quality_ceiling"] = min(100.0, max(20.0, float(stats["quality_ceiling"])))
    return stats
