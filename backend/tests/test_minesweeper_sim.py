"""Unit tests for Minesweeper deterministic re-sim."""
import pytest

from utils.minesweeper_sim import (
    MAX_CLICKS,
    mulberry32,
    normalize_clicks,
    place_mines,
    seed_to_u32,
    simulate_minesweeper,
    validate_difficulty,
)


def test_mulberry32_deterministic():
    a = mulberry32(0xABCDEF01)
    b = mulberry32(0xABCDEF01)
    assert [a() for _ in range(5)] == [b() for _ in range(5)]


def test_seed_to_u32_hex():
    assert seed_to_u32("deadbeefcafebabe") == 0xDEADBEEF


def test_validate_difficulty_ok():
    s = validate_difficulty("capo")
    assert s["rows"] == 16 and s["cols"] == 16 and s["mines"] == 40


def test_validate_difficulty_rejects():
    with pytest.raises(ValueError):
        validate_difficulty("hard")


def test_normalize_clicks_ok():
    assert normalize_clicks([{"r": 1, "c": 2}, [3, 4]], rows=9, cols=9) == [(1, 2), (3, 4)]


def test_normalize_clicks_rejects():
    with pytest.raises(ValueError, match="out of range"):
        normalize_clicks([{"r": 99, "c": 0}], rows=9, cols=9)
    with pytest.raises(ValueError, match="too many"):
        normalize_clicks([{"r": 0, "c": 0}] * (MAX_CLICKS + 1), rows=9, cols=9)


def test_empty_clicks_not_won():
    sim = simulate_minesweeper(seed="aabbccddeeff0011", difficulty="snitch", clicks=[])
    assert sim["won"] is False
    assert sim["clicks_used"] == 0


def test_forged_win_without_clear_fails():
    # Single click cannot clear a full snitch board.
    sim = simulate_minesweeper(
        seed="0123456789abcdef",
        difficulty="snitch",
        clicks=[{"r": 4, "c": 4}],
        first_r=4,
        first_c=4,
    )
    assert sim["won"] is False
    assert sim["dead"] is False


def test_first_click_mismatch_raises():
    with pytest.raises(ValueError, match="First click"):
        simulate_minesweeper(
            seed="0123456789abcdef",
            difficulty="snitch",
            clicks=[{"r": 0, "c": 0}],
            first_r=1,
            first_c=1,
        )


def test_same_seed_and_clicks_same_outcome():
    seed = "fedcba9876543210"
    first = {"r": 2, "c": 2}
    rng = mulberry32(seed_to_u32(seed))
    board = place_mines(rows=9, cols=9, mine_count=10, safe_r=2, safe_c=2, rng=rng)
    clicks = [first] + [{"r": r, "c": c} for r in range(9) for c in range(9) if not board[r][c]["mine"] and not (r == 2 and c == 2)]
    a = simulate_minesweeper(seed=seed, difficulty="snitch", clicks=clicks, first_r=2, first_c=2)
    b = simulate_minesweeper(seed=seed, difficulty="snitch", clicks=clicks, first_r=2, first_c=2)
    assert a == b
    assert a["won"] is True
    assert a["dead"] is False


def test_mine_click_marks_dead():
    seed = "1111222233334444"
    first = (4, 4)
    rng = mulberry32(seed_to_u32(seed))
    board = place_mines(rows=9, cols=9, mine_count=10, safe_r=4, safe_c=4, rng=rng)
    mine_cell = next((r, c) for r in range(9) for c in range(9) if board[r][c]["mine"])
    sim = simulate_minesweeper(
        seed=seed,
        difficulty="snitch",
        clicks=[{"r": first[0], "c": first[1]}, {"r": mine_cell[0], "c": mine_cell[1]}],
        first_r=first[0],
        first_c=first[1],
    )
    assert sim["dead"] is True
    assert sim["won"] is False
