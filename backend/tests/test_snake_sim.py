"""Unit tests for Package Run (Snake) deterministic re-sim."""
import pytest

from utils.snake_sim import (
    MAX_DIRS,
    mulberry32,
    normalize_dirs,
    seed_to_u32,
    simulate_snake,
    validate_snake_settings,
)


def test_mulberry32_deterministic():
    a = mulberry32(0xABCDEF01)
    b = mulberry32(0xABCDEF01)
    assert [a() for _ in range(5)] == [b() for _ in range(5)]


def test_seed_to_u32_hex():
    assert seed_to_u32("deadbeefcafebabe") == 0xDEADBEEF


def test_validate_settings_ok():
    s = validate_snake_settings(level="wrap", difficulty="hard")
    assert s["level"] == "wrap"
    assert s["difficulty"] == "hard"
    assert s["wrapWalls"] is True


def test_validate_settings_rejects_bad():
    with pytest.raises(ValueError):
        validate_snake_settings(level="portal", difficulty="medium")
    with pytest.raises(ValueError):
        validate_snake_settings(level="classic", difficulty="nightmare")


def test_normalize_dirs_ok():
    assert normalize_dirs(["RIGHT", "UP", "LEFT", "DOWN"]) == [(1, 0), (0, -1), (-1, 0), (0, 1)]
    assert normalize_dirs([[1, 0], [0, -1]]) == [(1, 0), (0, -1)]


def test_normalize_dirs_rejects():
    with pytest.raises(ValueError, match="invalid dir"):
        normalize_dirs(["FORWARD"])
    with pytest.raises(ValueError, match="too many"):
        normalize_dirs(["RIGHT"] * (MAX_DIRS + 1))


def test_empty_dirs_zero_score():
    sim = simulate_snake(seed="aabbccddeeff0011", dirs=[], level="classic", difficulty="medium")
    assert sim["score"] == 0
    assert sim["ticks"] == 0
    assert sim["dead"] is False


def test_same_seed_and_dirs_same_score():
    # Drive right then weave; deterministic package placements from seed.
    dirs = (["RIGHT"] * 8) + (["UP"] * 4) + (["LEFT"] * 6) + (["DOWN"] * 4) + (["RIGHT"] * 20)
    a = simulate_snake(seed="0123456789abcdef", dirs=dirs, level="classic", difficulty="easy")
    b = simulate_snake(seed="0123456789abcdef", dirs=dirs, level="classic", difficulty="easy")
    assert a["score"] == b["score"]
    assert a["ticks"] == b["ticks"]
    assert a["dead"] == b["dead"]


def test_forged_score_irrelevant_empty_dirs():
    # Claim path ignores client score; empty inputs => 0.
    sim = simulate_snake(seed="ffffffffffffffff", dirs=[], level="classic", difficulty="medium")
    assert sim["score"] == 0


def test_wall_death_classic():
    # Mid start facing right; keep going into the wall.
    dirs = ["RIGHT"] * 30
    sim = simulate_snake(seed="1111111122222222", dirs=dirs, level="classic", difficulty="medium")
    assert sim["dead"] is True
    assert sim["death_reason"] == "wall"


def test_wrap_does_not_wall_on_edge():
    dirs = ["RIGHT"] * 25
    classic = simulate_snake(seed="aaaaaaaaaaaaaaaa", dirs=dirs, level="classic", difficulty="easy")
    wrap = simulate_snake(seed="aaaaaaaaaaaaaaaa", dirs=dirs, level="wrap", difficulty="easy")
    assert classic["death_reason"] == "wall"
    assert wrap["death_reason"] != "wall" or wrap["dead"] is False or wrap["ticks"] > classic["ticks"]
