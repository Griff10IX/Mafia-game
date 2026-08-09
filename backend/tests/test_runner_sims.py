"""Unit tests for Family Run / Getaway deterministic re-sims."""
import pytest

from utils.family_run_sim import (
    MAX_INPUTS as FR_MAX_INPUTS,
    mulberry32 as fr_mulberry,
    normalize_inputs as fr_normalize,
    seed_to_u32 as fr_seed,
    simulate_family_run,
)
from utils.getaway_sim import (
    MAX_INPUTS as GW_MAX_INPUTS,
    mulberry32 as gw_mulberry,
    normalize_inputs as gw_normalize,
    seed_to_u32 as gw_seed,
    simulate_getaway,
    validate_preset,
)


def test_family_mulberry_deterministic():
    a = fr_mulberry(0xABCDEF01)
    b = fr_mulberry(0xABCDEF01)
    assert [a() for _ in range(5)] == [b() for _ in range(5)]


def test_family_seed_hex():
    assert fr_seed("deadbeefcafebabe") == 0xDEADBEEF


def test_family_normalize_inputs():
    assert fr_normalize([{"f": 1, "a": "L"}, ["2", "jump"]]) == [(1, "L"), (2, "J")]


def test_family_normalize_rejects():
    with pytest.raises(ValueError):
        fr_normalize([{"f": 0, "a": "X"}])
    with pytest.raises(ValueError):
        fr_normalize([{"f": 0, "a": "L"}] * (FR_MAX_INPUTS + 1))


def test_family_empty_inputs_zeroish():
    sim = simulate_family_run(seed="aabbccddeeff0011", inputs=[], ticks=10)
    assert sim["score"] >= 0
    assert sim["frames"] == 10


def test_family_same_seed_same_score():
    inputs = [{"f": i, "a": "L" if i % 4 == 0 else "R" if i % 4 == 1 else "J" if i % 4 == 2 else "S"} for i in range(0, 80, 3)]
    a = simulate_family_run(seed="0123456789abcdef", inputs=inputs, ticks=200)
    b = simulate_family_run(seed="0123456789abcdef", inputs=inputs, ticks=200)
    assert a["score"] == b["score"]
    assert a["coins"] == b["coins"]
    assert a["frames"] == b["frames"]


def test_family_forged_score_irrelevant():
    sim = simulate_family_run(seed="ffffffffffffffff", inputs=[], ticks=5)
    assert sim["score"] < 1000


def test_getaway_preset_ok():
    assert validate_preset("fast")["id"] == "fast"


def test_getaway_preset_rejects():
    with pytest.raises(ValueError):
        validate_preset("insane")


def test_getaway_normalize():
    assert gw_normalize([{"f": 3, "a": "slide"}]) == [(3, "S")]


def test_getaway_empty_ticks():
    sim = simulate_getaway(seed="1111222233334444", inputs=[], preset_id="normal", ticks=30)
    assert sim["distance"] >= 0
    assert sim["frames"] == 30


def test_getaway_same_seed_same_distance():
    inputs = [{"f": i, "a": "L" if i % 2 == 0 else "R"} for i in range(0, 40, 2)]
    a = simulate_getaway(seed="fedcba9876543210", inputs=inputs, preset_id="relaxed", ticks=120)
    b = simulate_getaway(seed="fedcba9876543210", inputs=inputs, preset_id="relaxed", ticks=120)
    assert a["distance"] == b["distance"]
    assert a["coins"] == b["coins"]


def test_getaway_forged_score_irrelevant():
    sim = simulate_getaway(seed="aaaaaaaaaaaaaaaa", inputs=[], preset_id="normal", ticks=20)
    assert sim["distance"] < 500
