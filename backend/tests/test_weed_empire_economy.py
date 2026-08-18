from utils.weed_empire_catalog import (
    BASE_STREET_PRICE_PER_OZ,
    DAILY_SELL_CAP_USD,
    HOUSES,
    MAX_DEALERS_LEVEL,
    STRAINS,
    STRAIN_BY_ID,
    STASH_SAFE_LEVELS,
    active_light_class,
    curing_minutes,
    dealer_drip_fraction,
    dealers_upgrade_cost,
    grams_to_oz,
    laundry_clean_cap,
    market_price_per_oz,
    stash_grams_total,
    stash_safe_next_spec,
    stash_safe_spec,
    stash_vault_capacity_g,
)
from utils.weed_empire_equipment import (
    EQUIPMENT_CATEGORIES,
    LAUNDRY_CATEGORY_IDS,
    equipment_level_cost,
    is_laundry_category,
)
from utils.weed_empire_exclusive_strains import (
    EXCLUSIVE_GODFATHER_OG,
    exclusive_grams_in_bags,
    take_exclusive_grams_from_bag,
)


def _max_yield_mult() -> float:
    return 1.0 + sum(
        (category.get("stats_per_level") or {}).get("yield_mult", 0) * category["max_level"]
        for category in EQUIPMENT_CATEGORIES
    )


def _best_normal_strain():
    normal = [s for s in STRAINS if not s.get("loot_exclusive") and not s.get("game_pass_strain")]
    return max(
        normal,
        key=lambda strain: strain["yield_g_max"]
        * (strain["base_price_per_oz"] / BASE_STREET_PRICE_PER_OZ),
    )


def test_daily_sell_cap_is_3b():
    assert DAILY_SELL_CAP_USD == 3_000_000_000


def test_typical_starter_harvest_is_worth_at_least_30k():
    strain = STRAIN_BY_ID["white_widow"]
    price = market_price_per_oz(
        strain,
        house_tier=0,
        dealers_level=0,
        sold_today_usd=0,
        heat=5,
    )

    assert price * grams_to_oz(37.4) >= 30_000


def test_fully_maxed_compound_harvest_is_about_1_125b():
    """No exclusives: one full Compound harvest lands near $1.05–1.20B."""
    yield_mult = _max_yield_mult()
    best_strain = _best_normal_strain()
    grams_per_plot = best_strain["yield_g_max"] * yield_mult * 1.05
    price = market_price_per_oz(
        best_strain,
        house_tier=4,
        dealers_level=MAX_DEALERS_LEVEL,
        sold_today_usd=0,
        heat=5,
    )
    full_harvest_value = price * grams_to_oz(grams_per_plot) * 24

    assert 1_050_000_000 <= full_harvest_value <= 1_200_000_000


def test_exclusives_stay_under_or_clip_at_3b_sell_cap():
    """Critical Mass ×1.5 yield + Godfather ×1.5 price cannot print past the $3B sell cap."""
    yield_mult = _max_yield_mult() * 1.5
    best_strain = _best_normal_strain()
    grams_per_plot = best_strain["yield_g_max"] * yield_mult * 1.05
    price = market_price_per_oz(
        best_strain,
        house_tier=4,
        dealers_level=MAX_DEALERS_LEVEL,
        sold_today_usd=0,
        heat=5,
    ) * 1.5
    uncapped_harvest = price * grams_to_oz(grams_per_plot) * 24
    sellable = min(uncapped_harvest, DAILY_SELL_CAP_USD)

    assert uncapped_harvest <= DAILY_SELL_CAP_USD * 1.05
    assert sellable <= DAILY_SELL_CAP_USD


def test_crap_strains_stay_cheap_and_slow():
    ditch = STRAIN_BY_ID["ditch_weed"]
    widow = STRAIN_BY_ID["white_widow"]
    rs11 = STRAIN_BY_ID["rs11"]
    assert ditch["base_grow_hours"] > widow["base_grow_hours"]
    assert ditch["base_price_per_oz"] < widow["base_price_per_oz"]
    assert rs11["min_grow_hours"] >= 4.5
    assert round(rs11["base_price_per_oz"] / 28) >= 6500


def test_laundry_line_caps_and_cost():
    assert laundry_clean_cap({cid: 0 for cid in LAUNDRY_CATEGORY_IDS}) == 50_000_000
    assert laundry_clean_cap({"laundry_shoe_box": 6}) == 90_000_000
    assert laundry_clean_cap({"laundry_offshore": 6}) == 3_000_000_000
    total = 0
    for cid in LAUNDRY_CATEGORY_IDS:
        cat = next(c for c in EQUIPMENT_CATEGORIES if c["id"] == cid)
        start = 2 if cid == "laundry_shoe_box" else 1
        for lvl in range(start, 7):
            total += equipment_level_cost(cat, lvl)
    assert 2_000_000_000 <= total <= 2_300_000_000


def test_house_and_dealer_retune():
    by_id = {h["id"]: h for h in HOUSES}
    assert by_id["suburban"]["cost"] == 5_000_000
    assert by_id["warehouse"]["cost"] == 80_000_000
    assert by_id["compound"]["cost"] == 350_000_000
    dealer_total = sum(dealers_upgrade_cost(lvl) for lvl in range(1, 20))
    assert 350_000_000 <= dealer_total <= 480_000_000


def test_grow_catalog_late_levels_are_expensive():
    grow = [c for c in EQUIPMENT_CATEGORIES if not is_laundry_category(c["id"])]
    total = 0
    for cat in grow:
        for lvl in range(1, int(cat["max_level"]) + 1):
            total += equipment_level_cost(cat, lvl)
    assert 8_000_000_000 <= total <= 14_000_000_000


def test_active_light_class_prefers_better_fixture():
    assert active_light_class({"lights_cfl": 40, "lights_led": 1}) == "led"
    assert active_light_class({"lights_led": 80, "lights_quantum": 1}) == "quantum"
    assert active_light_class({"lights_cfl": 10}) == "cfl"


def test_dealer_progression_deep_levels():
    assert MAX_DEALERS_LEVEL == 20
    assert dealer_drip_fraction(0) == 0.0
    assert 0.06 <= dealer_drip_fraction(1) <= 0.10
    assert dealer_drip_fraction(20) == 0.20
    assert dealers_upgrade_cost(5) > dealers_upgrade_cost(1)
    assert dealers_upgrade_cost(19) > dealers_upgrade_cost(10)


def test_dealer_cut_is_applied_after_network_progression():
    strain = STRAIN_BY_ID["white_widow"]
    direct_price = market_price_per_oz(
        strain,
        house_tier=2,
        dealers_level=3,
        sold_today_usd=0,
        heat=0,
    )
    dealer_price = market_price_per_oz(
        strain,
        house_tier=2,
        dealers_level=3,
        sold_today_usd=0,
        heat=0,
        dealer_cut=0.9,
    )

    assert dealer_price == direct_price * 0.9


def test_curing_scales_from_five_to_twenty_minutes_by_weight():
    assert curing_minutes(0, 0) == 5
    assert curing_minutes(300, 0) == 20
    assert 5 < curing_minutes(33.17, 0) < 7
    assert 5 <= curing_minutes(300, 14) < 20


def test_stash_safe_levels_and_max_cap():
    assert stash_safe_spec(1)["cost"] == 0
    assert stash_safe_spec(1)["cap_g"] == 250
    assert stash_safe_spec(1)["install_hours"] == 0
    assert stash_safe_spec(6)["cap_g"] == 60_000
    assert stash_safe_spec(6)["min_house_tier"] == 4
    paid = sum(int(row["cost"]) for row in STASH_SAFE_LEVELS if int(row["level"]) >= 2)
    assert paid == 6_420_000_000
    cubby = {"stash_safe_level": 0, "stash_vault": {"rs11": 80}}
    assert stash_vault_capacity_g(cubby) == 0
    cubby["stash_safe_level"] = 1
    assert stash_vault_capacity_g(cubby) == 250
    cubby["stash_safe_level"] = 6
    assert stash_vault_capacity_g(cubby) == 60_000
    assert stash_grams_total(cubby["stash_vault"]) == 80
    nxt = stash_safe_next_spec({"stash_safe_level": 1})
    assert nxt["level"] == 2
    assert nxt["cost"] == 120_000_000
    assert stash_safe_next_spec({"stash_safe_level": 6}) is None


def test_exclusive_vault_grams_count_with_open_stash():
    vault, moved = take_exclusive_grams_from_bag(
        {EXCLUSIVE_GODFATHER_OG: 12.5, "rs11": 40},
        [EXCLUSIVE_GODFATHER_OG],
    )
    assert vault == {"rs11": 40}
    assert moved[EXCLUSIVE_GODFATHER_OG] == 12.5
    combined = exclusive_grams_in_bags(
        {"rs11": 10, EXCLUSIVE_GODFATHER_OG: 3},
        {EXCLUSIVE_GODFATHER_OG: 5},
        strain_ids=[EXCLUSIVE_GODFATHER_OG],
    )
    assert combined[EXCLUSIVE_GODFATHER_OG] == 8
