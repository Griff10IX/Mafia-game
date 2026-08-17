from utils.weed_empire_catalog import (
    BASE_STREET_PRICE_PER_OZ,
    DAILY_SELL_CAP_USD,
    MAX_DEALERS_LEVEL,
    STRAINS,
    STRAIN_BY_ID,
    active_light_class,
    curing_minutes,
    dealer_drip_fraction,
    dealers_upgrade_cost,
    grams_to_oz,
    market_price_per_oz,
)
from utils.weed_empire_equipment import EQUIPMENT_CATEGORIES


def _max_yield_mult() -> float:
    return 1.0 + sum(
        (category.get("stats_per_level") or {}).get("yield_mult", 0) * category["max_level"]
        for category in EQUIPMENT_CATEGORIES
    )


def _best_normal_strain():
    normal = [s for s in STRAINS if not s.get("loot_exclusive")]
    return max(
        normal,
        key=lambda strain: strain["yield_g_max"]
        * (strain["base_price_per_oz"] / BASE_STREET_PRICE_PER_OZ),
    )


def test_daily_sell_cap_is_250m():
    assert DAILY_SELL_CAP_USD == 250_000_000


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


def test_fully_maxed_compound_harvest_approaches_250m_cap():
    """No exclusives: one full Compound harvest lands near the $200–250M band."""
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

    assert 200_000_000 <= full_harvest_value <= 260_000_000


def test_exclusives_cannot_break_daily_sell_cap():
    """Critical Mass ×1.5 yield + Godfather ×1.5 price still sell-capped at $250M."""
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

    assert uncapped_harvest > DAILY_SELL_CAP_USD
    assert sellable == DAILY_SELL_CAP_USD


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
