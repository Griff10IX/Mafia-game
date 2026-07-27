"""Weed Empire equipment ladders, unlock gates, and shop status helpers."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


def _cat(
    id: str,
    name: str,
    group: str,
    *,
    max_level: int,
    base_cost: int,
    cost_growth: float = 1.28,
    min_house_tier: int = 0,
    min_grower_level: int = 1,
    requires: Optional[Dict[str, int]] = None,
    tier: str = "starter",
    icon: str = "gear",
    room_visual: str = "generic",
    description: str = "",
    stats_per_level: Optional[Dict[str, float]] = None,
    light_class: Optional[str] = None,
    consumable_stock_key: Optional[str] = None,
    bag_units: Optional[int] = None,
) -> Dict[str, Any]:
    row: Dict[str, Any] = {
        "id": id,
        "name": name,
        "group": group,
        "max_level": max_level,
        "base_cost": base_cost,
        "cost_growth": cost_growth,
        "min_house_tier": min_house_tier,
        "min_grower_level": min_grower_level,
        "requires": requires,
        "tier": tier,
        "icon": icon,
        "room_visual": room_visual,
        "description": description,
        "stats_per_level": stats_per_level or {},
    }
    if light_class:
        row["light_class"] = light_class
    if consumable_stock_key:
        row["consumable_stock_key"] = consumable_stock_key
        row["bag_units"] = bag_units or 4
    return row


EQUIPMENT_CATEGORIES: List[Dict[str, Any]] = [
    # --- medium ---
    _cat(
        "soil_conventional", "Conventional Soil", "medium",
        max_level=70, base_cost=500, cost_growth=1.32,
        min_grower_level=1, tier="starter", icon="soil", room_visual="soil",
        consumable_stock_key="soil_conventional", bag_units=5,
        stats_per_level={"yield_mult": 0.01, "quality_ceiling": 0.375},
        description="Cheap bags → amended living soil.",
    ),
    _cat(
        "soil_organic", "Organic Soil", "medium",
        max_level=70, base_cost=1_200, cost_growth=1.36,
        min_house_tier=0, min_grower_level=3,
        requires={"category_id": "soil_conventional", "min_level": 3},
        tier="mid", icon="soil_organic", room_visual="soil",
        consumable_stock_key="soil_organic", bag_units=4,
        stats_per_level={"yield_mult": 0.0063, "quality_ceiling": 0.75, "grow_speed_mult": -0.0013},
        description="Compost, castings, mycorrhizae — quality king.",
    ),
    _cat(
        "coco_medium", "Coco Coir", "medium",
        max_level=70, base_cost=2_000, cost_growth=1.34,
        min_house_tier=1, min_grower_level=4,
        requires={"category_id": "soil_conventional", "min_level": 2},
        tier="mid", icon="coco", room_visual="soil",
        consumable_stock_key="coco", bag_units=4,
        stats_per_level={"yield_mult": 0.0088, "grow_speed_mult": 0.0037, "quality_ceiling": 0.3},
        description="Coco bags and slabs.",
    ),
    # --- lighting ---
    _cat(
        "lights_cfl", "CFL / Junk LED", "lighting",
        max_level=50, base_cost=400, cost_growth=1.29,
        min_grower_level=1, tier="starter", icon="bulb", room_visual="light_cfl",
        light_class="cfl",
        stats_per_level={"grow_speed_mult": 0.005, "yield_mult": 0.005, "quality_ceiling": 0.125, "heat_gain_mult": 0.0025, "power_draw": 8},
        description="Starter closet bulbs.",
    ),
    _cat(
        "lights_led", "Full-Spectrum LED", "lighting",
        max_level=90, base_cost=3_500, cost_growth=1.32,
        min_house_tier=1, min_grower_level=3,
        requires={"category_id": "lights_cfl", "min_level": 4},
        tier="mid", icon="led", room_visual="light_led",
        light_class="led",
        stats_per_level={"grow_speed_mult": 0.0088, "yield_mult": 0.01, "quality_ceiling": 0.5, "heat_gain_mult": 0.002, "power_draw": 16},
        description="Efficient modern boards and bars.",
    ),
    _cat(
        "lights_hps", "HPS / MH", "lighting",
        max_level=90, base_cost=2_800, cost_growth=1.31,
        min_house_tier=1, min_grower_level=4,
        requires={"category_id": "lights_cfl", "min_level": 4},
        tier="mid", icon="hps", room_visual="light_hps",
        light_class="hps",
        stats_per_level={"grow_speed_mult": 0.0075, "yield_mult": 0.0138, "quality_ceiling": 0.3, "heat_gain_mult": 0.01, "power_draw": 32},
        description="Classic fireball — yield push, more heat.",
    ),
    _cat(
        "lights_quantum", "Quantum / CMH Boards", "lighting",
        max_level=70, base_cost=12_000, cost_growth=1.34,
        min_house_tier=3, min_grower_level=12,
        requires={"category_id": "lights_led", "min_level": 10},
        tier="endgame", icon="quantum", room_visual="light_quantum",
        light_class="quantum",
        stats_per_level={"grow_speed_mult": 0.0112, "yield_mult": 0.0125, "quality_ceiling": 0.625, "heat_gain_mult": 0.0037, "power_draw": 22},
        description="Endgame hybrid lighting.",
    ),
    _cat(
        "light_timers", "Light Timers & Controllers", "lighting",
        max_level=70, base_cost=800, cost_growth=1.3,
        min_grower_level=2, tier="starter", icon="timer", room_visual="timer",
        stats_per_level={"grow_speed_mult": 0.0037, "quality_ceiling": 0.2},
        description="18/6 → 12/12 auto → sunrise dimming.",
    ),
    _cat(
        "light_movers", "Light Movers / Rails", "lighting",
        max_level=60, base_cost=2_200, cost_growth=1.34,
        min_house_tier=1, min_grower_level=5,
        requires={"category_id": "lights_led", "min_level": 3},
        tier="mid", icon="rail", room_visual="light_mover",
        stats_per_level={"yield_mult": 0.0075, "grow_speed_mult": 0.0025},
        description="Sweep the canopy for even coverage.",
    ),
    # --- structure ---
    _cat(
        "tents", "Grow Tents & Racks", "structure",
        max_level=90, base_cost=1_500, cost_growth=1.34,
        min_grower_level=1, tier="starter", icon="tent", room_visual="tent",
        stats_per_level={"yield_mult": 0.005, "quality_ceiling": 0.15, "odor_stealth": 0.125},
        description="Tents → multi-tent → vertical racks.",
    ),
    _cat(
        "mylar", "Reflective Lining", "structure",
        max_level=60, base_cost=600, cost_growth=1.29,
        min_grower_level=2,
        requires={"category_id": "tents", "min_level": 1},
        tier="starter", icon="mylar", room_visual="mylar",
        stats_per_level={"yield_mult": 0.0037, "grow_speed_mult": 0.0025},
        description="Mylar and diamond film.",
    ),
    _cat(
        "blackout_seals", "Blackout / Light-Leak Seals", "structure",
        max_level=50, base_cost=900, cost_growth=1.3,
        min_grower_level=3,
        requires={"category_id": "tents", "min_level": 2},
        tier="mid", icon="seal", room_visual="blackout",
        stats_per_level={"heat_gain_mult": -0.0037, "odor_stealth": 0.2},
        description="Kill light leaks and cut bust risk.",
    ),
    # --- containers ---
    _cat(
        "pots", "Pots & Containers", "containers",
        max_level=70, base_cost=300, cost_growth=1.28,
        min_grower_level=1, tier="starter", icon="pot", room_visual="pot",
        stats_per_level={"yield_mult": 0.005, "quality_ceiling": 0.125},
        description="Plastic → fabric → air pots.",
    ),
    _cat(
        "hydro_system", "Hydro System", "containers",
        max_level=74, base_cost=5_000, cost_growth=1.36,
        min_house_tier=2, min_grower_level=8,
        requires={"category_id": "pots", "min_level": 5},
        tier="premium", icon="hydro", room_visual="hydro",
        stats_per_level={"yield_mult": 0.0112, "grow_speed_mult": 0.0075, "quality_ceiling": 0.25},
        description="DWC / RDWC / NFT.",
    ),
    # --- water ---
    _cat(
        "irrigation", "Irrigation", "water",
        max_level=70, base_cost=900, cost_growth=1.31,
        min_grower_level=1, tier="starter", icon="drip", room_visual="irrigation",
        stats_per_level={"water_interval_mult": 0.01, "feed_efficiency": 0.0075},
        description="Hand → drip → auto. Lv 5 auto-water; Lv 8 auto-feeders.",
    ),
    _cat(
        "reservoirs", "Reservoirs & RO", "water",
        max_level=70, base_cost=1_100, cost_growth=1.32,
        min_house_tier=1, min_grower_level=4,
        requires={"category_id": "irrigation", "min_level": 3},
        tier="mid", icon="tank", room_visual="reservoir",
        stats_per_level={"feed_efficiency": 0.0088, "quality_ceiling": 0.2},
        description="Bigger sealed reservoirs and RO water.",
    ),
    _cat(
        "dosing_pump", "pH / TDS Dosing Pump", "water",
        max_level=60, base_cost=2_500, cost_growth=1.34,
        min_house_tier=1, min_grower_level=6,
        requires={"category_id": "meters", "min_level": 3},
        tier="premium", icon="pump", room_visual="dosing",
        stats_per_level={"feed_efficiency": 0.0125, "quality_ceiling": 0.3},
        description="Auto-dose after meters unlock.",
    ),
    # --- nutrients ---
    _cat(
        "nutes_base", "Base Nutrients", "nutrients",
        max_level=90, base_cost=700, cost_growth=1.3,
        min_grower_level=1, tier="starter", icon="nute", room_visual="nutes",
        stats_per_level={"yield_mult": 0.0075, "feed_efficiency": 0.005, "quality_ceiling": 0.175},
        description="Veg/bloom base lines.",
    ),
    _cat(
        "nutes_organic", "Organic Nutrients", "nutrients",
        max_level=70, base_cost=1_400, cost_growth=1.33,
        min_grower_level=3,
        requires={"category_id": "soil_organic", "min_level": 1},
        tier="mid", icon="nute_organic", room_visual="nutes",
        stats_per_level={"yield_mult": 0.005, "quality_ceiling": 0.55},
        description="Pairs with organic soil.",
    ),
    _cat(
        "nutes_boosters", "Bloom Boosters & Additives", "nutrients",
        max_level=74, base_cost=1_000, cost_growth=1.31,
        min_house_tier=1, min_grower_level=4,
        requires={"category_id": "nutes_base", "min_level": 4},
        tier="mid", icon="booster", room_visual="nutes",
        stats_per_level={"yield_mult": 0.0088, "quality_ceiling": 0.25},
        description="PK, cal-mag, silica, enzymes.",
    ),
    # --- climate ---
    _cat(
        "vent_exhaust", "Exhaust Fans", "climate",
        max_level=74, base_cost=1_200, cost_growth=1.32,
        min_grower_level=2,
        requires={"category_id": "tents", "min_level": 1},
        tier="starter", icon="fan", room_visual="exhaust",
        stats_per_level={"heat_gain_mult": -0.0063, "grow_speed_mult": 0.0025},
        description="CFM upgrades.",
    ),
    _cat(
        "carbon_filter", "Carbon Filters", "climate",
        max_level=70, base_cost=1_500, cost_growth=1.33,
        min_grower_level=3,
        requires={"category_id": "vent_exhaust", "min_level": 2},
        tier="mid", icon="filter", room_visual="carbon_filter",
        stats_per_level={"odor_stealth": 0.5, "heat_gain_mult": -0.0025},
        description="Odor stealth.",
    ),
    _cat(
        "osc_fans", "Oscillating Fans", "climate",
        max_level=60, base_cost=400, cost_growth=1.26,
        min_grower_level=2, tier="starter", icon="osc_fan", room_visual="osc_fan",
        stats_per_level={"quality_ceiling": 0.15, "grow_speed_mult": 0.002},
        description="Airflow across canopy.",
    ),
    _cat(
        "climate_control", "Temp / RH Controllers", "climate",
        max_level=70, base_cost=2_200, cost_growth=1.34,
        min_house_tier=1, min_grower_level=5,
        requires={"category_id": "osc_fans", "min_level": 2},
        tier="mid", icon="climate", room_visual="climate",
        stats_per_level={"quality_ceiling": 0.375, "grow_speed_mult": 0.005, "heat_gain_mult": -0.005},
        description="AC, dehumidifier, VPD targets.",
    ),
    _cat(
        "dehumidifier", "Dedicated Dehumidifier", "climate",
        max_level=60, base_cost=1_800, cost_growth=1.32,
        min_house_tier=1, min_grower_level=5,
        requires={"category_id": "climate_control", "min_level": 2},
        tier="mid", icon="dehum", room_visual="dehumidifier",
        stats_per_level={"quality_ceiling": 0.3, "heat_gain_mult": -0.0025},
        description="Keep flower RH in check.",
    ),
    _cat(
        "co2", "CO₂ System", "climate",
        max_level=70, base_cost=8_000, cost_growth=1.37,
        min_house_tier=3, min_grower_level=10,
        requires={"category_id": "climate_control", "min_level": 5},
        tier="endgame", icon="co2", room_visual="co2",
        stats_per_level={"yield_mult": 0.0125, "grow_speed_mult": 0.01},
        description="Tanks, regulators, controllers.",
    ),
    _cat(
        "odor_gel", "Odor Gel / Scent Blockers", "climate",
        max_level=50, base_cost=700, cost_growth=1.29,
        min_grower_level=3, tier="mid", icon="gel", room_visual="odor_gel",
        stats_per_level={"odor_stealth": 0.375},
        description="Stacks with carbon filters.",
    ),
    # --- monitoring / plantwork / harvest ---
    _cat(
        "meters", "Meters & Sensors", "monitoring",
        max_level=70, base_cost=900, cost_growth=1.3,
        min_grower_level=2, tier="starter", icon="meter", room_visual="meters",
        stats_per_level={"quality_ceiling": 0.45, "feed_efficiency": 0.0063},
        description="pH, TDS, VPD, smart sensors.",
    ),
    _cat(
        "training", "Training & Trellis", "plantwork",
        max_level=60, base_cost=350, cost_growth=1.26,
        min_grower_level=2, tier="starter", icon="trellis", room_visual="trellis",
        stats_per_level={"yield_mult": 0.0063, "quality_ceiling": 0.1},
        description="LST clips, netting, stakes.",
    ),
    _cat(
        "clone_station", "Clone / Seedling Station", "plantwork",
        max_level=60, base_cost=1_600, cost_growth=1.32,
        min_grower_level=4,
        requires={"category_id": "tents", "min_level": 2},
        tier="mid", icon="clone", room_visual="clone",
        stats_per_level={"grow_speed_mult": 0.01, "quality_ceiling": 0.125},
        description="Faster early stages.",
    ),
    _cat(
        "pest_ipm", "Pest Control / IPM", "plantwork",
        max_level=70, base_cost=1_100, cost_growth=1.31,
        min_grower_level=3, tier="mid", icon="pest", room_visual="pest",
        stats_per_level={
            "quality_ceiling": 0.375,
            "yield_mult": 0.0025,
            "cleanliness_decay_mult": -0.01,
            "mite_resistance": 0.015,
            "mite_treatment_bonus": 1.2,
        },
        description="Slows room decay, resists spider mites, and improves treatment.",
    ),
    _cat(
        "trimmers", "Trimmers", "harvest",
        max_level=70, base_cost=800, cost_growth=1.31,
        min_grower_level=2, tier="starter", icon="scissors", room_visual="trimmer",
        stats_per_level={"yield_mult": 0.0025, "quality_ceiling": 0.225},
        description="Scissors → speed trimmer.",
    ),
    _cat(
        "trim_bin", "Trim Bin / Pollen Catcher", "harvest",
        max_level=50, base_cost=1_200, cost_growth=1.3,
        min_grower_level=4,
        requires={"category_id": "trimmers", "min_level": 2},
        tier="mid", icon="bin", room_visual="trim_bin",
        stats_per_level={"yield_mult": 0.005},
        description="Salvage trim into extra grams.",
    ),
    _cat(
        "curing", "Drying & Curing", "harvest",
        max_level=70, base_cost=1_000, cost_growth=1.32,
        min_grower_level=2, tier="starter", icon="jar", room_visual="curing",
        stats_per_level={"quality_ceiling": 0.5},
        description="Racks, jars, humidity packs.",
    ),
    # --- power / security ---
    _cat(
        "electrical", "Electrical / Power", "power",
        max_level=70, base_cost=1_800, cost_growth=1.33,
        min_house_tier=1, min_grower_level=4, tier="mid", icon="power", room_visual="electrical",
        stats_per_level={"power_capacity": 40, "quality_ceiling": 0.075},
        description="Circuits, timers, UPS.",
    ),
    _cat(
        "generator", "Generator / Backup Power", "power",
        max_level=60, base_cost=4_000, cost_growth=1.36,
        min_house_tier=2, min_grower_level=7,
        requires={"category_id": "electrical", "min_level": 3},
        tier="premium", icon="generator", room_visual="generator",
        stats_per_level={"quality_ceiling": 0.25, "power_capacity": 60},
        description="Cuts outage quality hits.",
    ),
    _cat(
        "security", "Security", "security",
        max_level=90, base_cost=2_500, cost_growth=1.34,
        min_grower_level=2, tier="starter", icon="cam", room_visual="security",
        stats_per_level={"raid_defence": 1.2, "stash_security": 0.8},
        description="Locks → cameras → dogs → muscle.",
    ),
    _cat(
        "stash_containers", "Stash Containers", "security",
        max_level=60, base_cost=1_200, cost_growth=1.32,
        min_grower_level=3, tier="mid", icon="stash", room_visual="stash",
        stats_per_level={"stash_security": 1.6, "odor_stealth": 0.125},
        description="Vacuum seal and hidden totes.",
    ),

    # --- expansion lighting ---
    _cat(
        "lights_uv", "UV Supplemental Bars", "lighting",
        max_level=70, base_cost=4_500, cost_growth=1.32,
        min_house_tier=2, min_grower_level=8,
        requires={"category_id": "lights_led", "min_level": 8},
        tier="premium", icon="led", room_visual="light_led",
        light_class="led",
        stats_per_level={"yield_mult": 0.012, "quality_ceiling": 0.6, "power_draw": 15},
        description="UV-A/B bars for resin push.",
    ),
    _cat(
        "lights_bar_led", "Samsung-Style LED Bars", "lighting",
        max_level=80, base_cost=5_500, cost_growth=1.33,
        min_house_tier=2, min_grower_level=6,
        requires={"category_id": "lights_led", "min_level": 5},
        tier="premium", icon="led", room_visual="light_led",
        light_class="led",
        stats_per_level={"grow_speed_mult": 0.01, "yield_mult": 0.011, "quality_ceiling": 0.5, "power_draw": 18},
        description="Dense bar arrays for even canopy.",
    ),
    _cat(
        "canopy_sensors", "Canopy PAR Sensors", "lighting",
        max_level=60, base_cost=2_800, cost_growth=1.3,
        min_house_tier=1, min_grower_level=5,
        requires={"category_id": "meters", "min_level": 4},
        tier="mid", icon="meter", room_visual="meters",
        stats_per_level={"quality_ceiling": 0.55, "yield_mult": 0.006},
        description="Map PPFD and auto-dim hotspots.",
    ),
    # --- expansion climate ---
    _cat(
        "scrubber_mk2", "Odor Scrubber Mk2", "climate",
        max_level=65, base_cost=3_200, cost_growth=1.31,
        min_house_tier=2, min_grower_level=7,
        requires={"category_id": "carbon_filter", "min_level": 6},
        tier="premium", icon="filter", room_visual="carbon_filter",
        stats_per_level={"odor_stealth": 0.7, "heat_gain_mult": -0.004},
        description="Industrial multi-stage scrubbing.",
    ),
    _cat(
        "ac_split", "Split AC Units", "climate",
        max_level=75, base_cost=6_000, cost_growth=1.34,
        min_house_tier=2, min_grower_level=8,
        requires={"category_id": "climate_control", "min_level": 6},
        tier="premium", icon="climate", room_visual="climate",
        stats_per_level={"heat_gain_mult": -0.008, "quality_ceiling": 0.4, "grow_speed_mult": 0.006},
        description="Dedicated cool for sealed rooms.",
    ),
    _cat(
        "intake_silencer", "Silenced Intake", "climate",
        max_level=55, base_cost=1_900, cost_growth=1.29,
        min_grower_level=4,
        requires={"category_id": "vent_exhaust", "min_level": 4},
        tier="mid", icon="fan", room_visual="exhaust",
        stats_per_level={"odor_stealth": 0.35, "heat_gain_mult": -0.003},
        description="Quiet fresh-air path.",
    ),
    # --- expansion plantwork / harvest ---
    _cat(
        "auto_trimmer", "Auto Trimmer Drum", "harvest",
        max_level=65, base_cost=4_000, cost_growth=1.32,
        min_house_tier=2, min_grower_level=6,
        requires={"category_id": "trimmers", "min_level": 5},
        tier="premium", icon="scissors", room_visual="trimmer",
        stats_per_level={"yield_mult": 0.008, "quality_ceiling": 0.25},
        description="Batch trim without wrecking heads.",
    ),
    _cat(
        "soil_sensors", "Soil Moisture Probes", "plantwork",
        max_level=60, base_cost=1_500, cost_growth=1.28,
        min_grower_level=3,
        requires={"category_id": "meters", "min_level": 2},
        tier="mid", icon="meter", room_visual="meters",
        stats_per_level={"feed_efficiency": 0.012, "quality_ceiling": 0.35},
        description="Stop over/under watering.",
    ),
    _cat(
        "trellis_pro", "Commercial Trellis Net", "plantwork",
        max_level=70, base_cost=900, cost_growth=1.27,
        min_grower_level=4,
        requires={"category_id": "training", "min_level": 4},
        tier="mid", icon="trellis", room_visual="trellis",
        stats_per_level={"yield_mult": 0.009, "quality_ceiling": 0.2},
        description="Multi-layer SCROG for racks.",
    ),
    _cat(
        "dry_room", "Dedicated Dry Room", "harvest",
        max_level=60, base_cost=5_500, cost_growth=1.33,
        min_house_tier=2, min_grower_level=7,
        requires={"category_id": "curing", "min_level": 6},
        tier="premium", icon="jar", room_visual="curing",
        stats_per_level={"quality_ceiling": 0.7},
        description="Climate-controlled hang dry.",
    ),
    # --- expansion power / security ---
    _cat(
        "solar_array", "Off-Grid Solar Array", "power",
        max_level=55, base_cost=8_000, cost_growth=1.35,
        min_house_tier=3, min_grower_level=10,
        requires={"category_id": "electrical", "min_level": 8},
        tier="endgame", icon="power", room_visual="electrical",
        stats_per_level={"power_capacity": 45, "heat_gain_mult": -0.002},
        description="Cut grid heat and meter risk.",
    ),
    _cat(
        "ups_rack", "UPS Battery Rack", "power",
        max_level=60, base_cost=3_500, cost_growth=1.31,
        min_house_tier=1, min_grower_level=5,
        requires={"category_id": "electrical", "min_level": 3},
        tier="mid", icon="power", room_visual="electrical",
        stats_per_level={"power_capacity": 30, "quality_ceiling": 0.2},
        description="Ride through brownouts.",
    ),
    _cat(
        "vault_locks", "Vault Door & Locks", "security",
        max_level=80, base_cost=4_200, cost_growth=1.32,
        min_house_tier=2, min_grower_level=5,
        requires={"category_id": "security", "min_level": 6},
        tier="premium", icon="cam", room_visual="security",
        stats_per_level={"raid_defence": 1.2, "stash_security": 1.0},
        description="Hardened stash room.",
    ),
    _cat(
        "motion_grid", "Motion Sensor Grid", "security",
        max_level=65, base_cost=2_200, cost_growth=1.3,
        min_grower_level=4,
        requires={"category_id": "security", "min_level": 3},
        tier="mid", icon="cam", room_visual="security",
        stats_per_level={"raid_defence": 0.9},
        description="Early warning on raiders.",
    ),
    _cat(
        "guard_dogs", "Yard Dogs", "security",
        max_level=50, base_cost=6_500, cost_growth=1.34,
        min_house_tier=3, min_grower_level=9,
        requires={"category_id": "security", "min_level": 10},
        tier="endgame", icon="cam", room_visual="security",
        stats_per_level={"raid_defence": 1.5, "stash_security": 0.5},
        description="Loud, loyal, expensive.",
    ),
    _cat(
        "faraday", "RF / Bug Sweep Kit", "security",
        max_level=45, base_cost=3_800, cost_growth=1.31,
        min_house_tier=2, min_grower_level=8,
        requires={"category_id": "security", "min_level": 5},
        tier="premium", icon="cam", room_visual="security",
        stats_per_level={"raid_defence": 0.6, "odor_stealth": 0.2},
        description="Sweep for transmitters.",
    ),
    _cat(
        "nutrient_chiller", "Reservoir Chiller", "water",
        max_level=55, base_cost=2_600, cost_growth=1.3,
        min_house_tier=1, min_grower_level=6,
        requires={"category_id": "reservoirs", "min_level": 4},
        tier="mid", icon="tank", room_visual="reservoir",
        stats_per_level={"feed_efficiency": 0.01, "quality_ceiling": 0.3},
        description="Keep root-zone cool.",
    ),
    _cat(
        "aero_cloner", "Aeroponic Cloner", "plantwork",
        max_level=60, base_cost=3_000, cost_growth=1.31,
        min_house_tier=1, min_grower_level=5,
        requires={"category_id": "clone_station", "min_level": 4},
        tier="premium", icon="clone", room_visual="clone",
        stats_per_level={"grow_speed_mult": 0.012, "quality_ceiling": 0.25},
        description="Faster, cleaner starts.",
    ),
    _cat(
        "co2_generator", "CO2 Generator", "climate",
        max_level=60, base_cost=7_500, cost_growth=1.34,
        min_house_tier=3, min_grower_level=11,
        requires={"category_id": "co2", "min_level": 4},
        tier="endgame", icon="co2", room_visual="co2",
        stats_per_level={"yield_mult": 0.014, "grow_speed_mult": 0.01},
        description="Burner or tankless enrichment.",
    ),
    _cat(
        "sealed_room", "Sealed Room Kit", "structure",
        max_level=65, base_cost=4_800, cost_growth=1.32,
        min_house_tier=2, min_grower_level=7,
        requires={"category_id": "blackout_seals", "min_level": 4},
        tier="premium", icon="tent", room_visual="tent",
        stats_per_level={"odor_stealth": 0.4, "heat_gain_mult": -0.005, "quality_ceiling": 0.3},
        description="True sealed environment.",
    ),
]

EQUIPMENT_BY_ID: Dict[str, Dict[str, Any]] = {c["id"]: c for c in EQUIPMENT_CATEGORIES}


def equipment_level_cost(cat: Dict[str, Any], level: int) -> int:
    """Business-cash cost for buying/reaching this level.

    Early levels stay exponential and affordable; deep levels (15–100) use a
    softer curve so maxing the catalog lands in the hundreds of millions, not
    astronomical pure-exponential blowups.
    """
    base = max(1.0, float(cat.get("base_cost") or 1))
    growth = min(1.28, max(1.05, float(cat.get("cost_growth") or 1.2)))
    lvl = max(1, int(level))
    early_cap = 12
    if lvl <= early_cap:
        return max(1, int(round(base * (growth ** (lvl - 1)))))
    early_cost = base * (growth ** (early_cap - 1))
    # Soft growth ~1.04–1.08 depending on catalog growth.
    soft = 1.0 + max(0.038, (growth - 1.0) * 0.16)
    return max(1, int(round(early_cost * (soft ** (lvl - early_cap)))))


def xp_to_next_level(level: int) -> int:
    lvl = max(1, int(level))
    return int(round(100 * (lvl ** 1.35)))


def rarity_xp_mult(rarity: str) -> float:
    return {"common": 1.0, "uncommon": 1.25, "rare": 1.6, "legendary": 2.2}.get(
        (rarity or "common").lower(), 1.0
    )


def apply_grower_xp(farm: Dict[str, Any], amount: int) -> Tuple[Dict[str, Any], bool, int]:
    """Add XP; return (fields_to_set, leveled_up, new_level)."""
    xp = int(farm.get("grower_xp") or 0) + max(0, int(amount))
    level = max(1, int(farm.get("grower_level") or 1))
    leveled = False
    while xp >= xp_to_next_level(level):
        xp -= xp_to_next_level(level)
        level += 1
        leveled = True
    return {"grower_xp": xp, "grower_level": level}, leveled, level


def grower_progress(farm: Dict[str, Any]) -> Dict[str, Any]:
    level = max(1, int(farm.get("grower_level") or 1))
    xp = int(farm.get("grower_xp") or 0)
    need = xp_to_next_level(level)
    return {
        "grower_level": level,
        "grower_xp": xp,
        "grower_xp_to_next": need,
        "grower_xp_pct": round(min(100.0, (xp / need) * 100.0), 1) if need else 100.0,
    }


def equipment_unlock_state(
    cat: Dict[str, Any],
    *,
    owned_level: int,
    house_tier: int,
    grower_level: int,
    equipment_levels: Dict[str, int],
    house_max_equip_tier: int,
) -> Dict[str, Any]:
    """Compute lock / upgrade availability for one category."""
    owned = max(0, int(owned_level or 0))
    max_level = int(cat["max_level"])
    nxt = owned + 1
    reasons: List[str] = []

    # Category unlock (for buying level 1)
    if owned <= 0:
        if grower_level < int(cat.get("min_grower_level") or 1):
            reasons.append(f"Reach Grower Lv {cat['min_grower_level']}")
        if house_tier < int(cat.get("min_house_tier") or 0):
            reasons.append(f"Need house tier {cat['min_house_tier']}+")
        req = cat.get("requires")
        if isinstance(req, dict) and req.get("category_id"):
            need_id = str(req["category_id"])
            need_lvl = int(req.get("min_level") or 1)
            have = int(equipment_levels.get(need_id) or 0)
            if have < need_lvl:
                other = EQUIPMENT_BY_ID.get(need_id) or {}
                reasons.append(f"Need {(other.get('name') or need_id)} Lv {need_lvl}")

    locked = owned <= 0 and bool(reasons)
    can_upgrade = False
    lock_reason = "; ".join(reasons) if reasons else None
    next_cost = None

    if owned >= max_level:
        lock_reason = lock_reason or "MAX"
    elif nxt > house_max_equip_tier:
        lock_reason = f"Upgrade house for gear Lv {nxt}+"
    elif locked:
        pass
    else:
        # Already owned: only house equip tier caps further levels
        can_upgrade = True
        next_cost = equipment_level_cost(cat, nxt)

    if owned <= 0 and not locked:
        can_upgrade = True
        next_cost = equipment_level_cost(cat, 1)

    return {
        "category_id": cat["id"],
        "name": cat["name"],
        "group": cat["group"],
        "description": cat.get("description"),
        "tier": cat.get("tier") or "starter",
        "icon": cat.get("icon") or "gear",
        "room_visual": cat.get("room_visual") or "generic",
        "max_level": max_level,
        "owned_level": owned,
        "min_grower_level": int(cat.get("min_grower_level") or 1),
        "min_house_tier": int(cat.get("min_house_tier") or 0),
        "requires": cat.get("requires"),
        "stats_per_level": cat.get("stats_per_level") or {},
        "light_class": cat.get("light_class"),
        "consumable_stock_key": cat.get("consumable_stock_key"),
        "locked": locked,
        "lock_reason": lock_reason,
        "can_upgrade": can_upgrade and owned < max_level and nxt <= house_max_equip_tier,
        "next_cost": next_cost if (can_upgrade and owned < max_level and nxt <= house_max_equip_tier) else None,
        "maxed": owned >= max_level,
    }


def shop_status_for_farm(
    farm: Dict[str, Any],
    *,
    house_tier: int,
    house_max_equip_tier: int,
    equipment_levels: Dict[str, int],
) -> List[Dict[str, Any]]:
    grower_level = max(1, int(farm.get("grower_level") or 1))
    rebuy_raw = farm.get("equipment_rebuy") if isinstance(farm.get("equipment_rebuy"), dict) else {}
    out: List[Dict[str, Any]] = []
    for cat in EQUIPMENT_CATEGORIES:
        owned = int(equipment_levels.get(cat["id"]) or 0)
        st = equipment_unlock_state(
            cat,
            owned_level=owned,
            house_tier=house_tier,
            grower_level=grower_level,
            equipment_levels=equipment_levels,
            house_max_equip_tier=house_max_equip_tier,
        )
        try:
            pending = int(rebuy_raw.get(cat["id"]) or 0)
        except (TypeError, ValueError):
            pending = 0
        # Raided gear: not installed, but level is saved — pay a rebuy fee to restore it
        if owned <= 0 and pending > 0:
            rebuy_cost = equipment_level_cost(cat, 1)
            house_ok = pending <= int(house_max_equip_tier)
            tier_ok = house_tier >= int(cat.get("min_house_tier") or 0)
            can_rebuy = house_ok and tier_ok
            reason = None
            if not tier_ok:
                reason = f"Need house tier {cat.get('min_house_tier')}+"
            elif not house_ok:
                reason = f"Upgrade house for gear Lv {pending}+"
            st.update(
                {
                    "needs_rebuy": True,
                    "rebuy_level": pending,
                    "locked": False,
                    "lock_reason": reason,
                    "can_upgrade": can_rebuy,
                    "next_cost": rebuy_cost if can_rebuy else None,
                    "maxed": False,
                    "action_label": f"Rebuy Lv {pending}",
                }
            )
        else:
            st["needs_rebuy"] = False
            st["rebuy_level"] = 0
            st["action_label"] = None
        out.append(st)
    return out


def equipment_shop_entries() -> List[Dict[str, Any]]:
    """Legacy flat level rows (kept for catalog counts)."""
    rows: List[Dict[str, Any]] = []
    for cat in EQUIPMENT_CATEGORIES:
        for lvl in range(1, int(cat["max_level"]) + 1):
            rows.append(
                {
                    "category_id": cat["id"],
                    "name": cat["name"],
                    "group": cat["group"],
                    "level": lvl,
                    "cost": equipment_level_cost(cat, lvl),
                    "min_house_tier": cat["min_house_tier"],
                    "min_grower_level": cat.get("min_grower_level", 1),
                    "light_class": cat.get("light_class"),
                    "description": cat.get("description"),
                    "stats_per_level": cat.get("stats_per_level") or {},
                    "tier": cat.get("tier"),
                    "icon": cat.get("icon"),
                }
            )
    return rows


def assert_can_upgrade_equipment(
    cat: Dict[str, Any],
    *,
    owned_level: int,
    house_tier: int,
    grower_level: int,
    equipment_levels: Dict[str, int],
    house_max_equip_tier: int,
) -> int:
    """Return next level or raise ValueError with reason."""
    st = equipment_unlock_state(
        cat,
        owned_level=owned_level,
        house_tier=house_tier,
        grower_level=grower_level,
        equipment_levels=equipment_levels,
        house_max_equip_tier=house_max_equip_tier,
    )
    if st["maxed"]:
        raise ValueError("Already max level")
    if st["locked"] or not st["can_upgrade"]:
        raise ValueError(st.get("lock_reason") or "Locked")
    return int(owned_level or 0) + 1
