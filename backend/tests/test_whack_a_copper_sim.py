"""Unit tests for Whack-A-Copper deterministic re-sim."""
import pytest

from utils.whack_a_copper_sim import (
    MAX_HITS,
    mulberry32,
    normalize_hits,
    seed_to_u32,
    simulate_whack_a_copper,
    validate_settings,
)


def test_mulberry32_deterministic():
    a = mulberry32(0xABCDEF01)
    b = mulberry32(0xABCDEF01)
    assert [a() for _ in range(5)] == [b() for _ in range(5)]


def test_seed_to_u32_hex():
    assert seed_to_u32("deadbeefcafebabe") == 0xDEADBEEF


def test_validate_settings_ok():
    s = validate_settings(diff="hard", duration=60, grid_size=12, lives_mode=5)
    assert s["diff"] == "hard"
    assert s["duration"] == 60


def test_validate_settings_rejects_bad():
    with pytest.raises(ValueError):
        validate_settings(diff="insane", duration=30, grid_size=9, lives_mode=3)
    with pytest.raises(ValueError):
        validate_settings(diff="medium", duration=45, grid_size=9, lives_mode=3)


def test_normalize_hits_ok():
    assert normalize_hits([{"t_ms": 10, "hole": 0}, {"t_ms": 20, "hole": 2}], grid_size=9) == [
        (10, 0),
        (20, 2),
    ]


def test_normalize_hits_rejects():
    with pytest.raises(ValueError, match="non-decreasing"):
        normalize_hits([{"t_ms": 20, "hole": 0}, {"t_ms": 10, "hole": 1}], grid_size=9)
    with pytest.raises(ValueError, match="out of range"):
        normalize_hits([{"t_ms": 1, "hole": 99}], grid_size=9)
    with pytest.raises(ValueError, match="too many"):
        normalize_hits([{"t_ms": i, "hole": 0} for i in range(MAX_HITS + 1)], grid_size=9)


def test_empty_hits_zero_score():
    sim = simulate_whack_a_copper(
        seed="aabbccddeeff0011",
        hits=[],
        diff="medium",
        duration=20,
        grid_size=9,
        lives_mode=3,
    )
    assert sim["score"] == 0
    assert sim["ended"] is True


def test_same_seed_and_hits_same_score():
    # Dense hits across holes — some will connect depending on waves
    hits = [{"t_ms": t, "hole": (t // 50) % 9} for t in range(400, 8000, 40)]
    a = simulate_whack_a_copper(seed="0123456789abcdef", hits=hits, duration=30, grid_size=9, lives_mode=0)
    b = simulate_whack_a_copper(seed="0123456789abcdef", hits=hits, duration=30, grid_size=9, lives_mode=0)
    assert a["score"] == b["score"]
    assert a["ticks"] == b["ticks"]


def test_forged_score_irrelevant_empty_hits():
    sim = simulate_whack_a_copper(seed="ffffffffffffffff", hits=[], duration=30, grid_size=9, lives_mode=3)
    assert sim["score"] == 0


def test_dense_hits_can_score():
    hits = [{"t_ms": t, "hole": h} for t in range(500, 15000, 30) for h in range(9)]
    # Cap via normalize in simulate — too many hits will raise
    hits = hits[:1500]
    sim = simulate_whack_a_copper(
        seed="abcdef0123456789",
        hits=hits,
        diff="easy",
        duration=30,
        grid_size=9,
        lives_mode=0,
    )
    assert sim["score"] >= 10
