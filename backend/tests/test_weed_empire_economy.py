from utils.weed_empire_catalog import (
    BASE_STREET_PRICE_PER_OZ,
    STRAINS,
    STRAIN_BY_ID,
    grams_to_oz,
    market_price_per_oz,
)
from utils.weed_empire_equipment import EQUIPMENT_CATEGORIES


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


def test_fully_maxed_compound_harvest_approaches_100m_cap():
    yield_mult = 1.0 + sum(
        (category.get("stats_per_level") or {}).get("yield_mult", 0) * category["max_level"]
        for category in EQUIPMENT_CATEGORIES
    )
    best_strain = max(
        STRAINS,
        key=lambda strain: strain["yield_g_max"]
        * (strain["base_price_per_oz"] / BASE_STREET_PRICE_PER_OZ),
    )
    grams_per_plot = best_strain["yield_g_max"] * yield_mult * 1.05
    price = market_price_per_oz(
        best_strain,
        house_tier=4,
        dealers_level=5,
        sold_today_usd=0,
        heat=5,
    )
    full_harvest_value = price * grams_to_oz(grams_per_plot) * 24

    assert 99_000_000 <= full_harvest_value <= 101_000_000


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
