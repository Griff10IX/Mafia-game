"""Unit tests for Battleships deterministic re-sim."""
import pytest

from utils.battleships_sim import (
    MAX_ACTIONS,
    auto_place_all,
    mulberry32,
    normalize_actions,
    normalize_placements,
    seed_to_u32,
    simulate_battleships,
    validate_settings,
)


def test_mulberry32_deterministic():
    a = mulberry32(0xABCDEF01)
    b = mulberry32(0xABCDEF01)
    assert [a() for _ in range(5)] == [b() for _ in range(5)]


def test_seed_to_u32_hex():
    assert seed_to_u32("deadbeefcafebabe") == 0xDEADBEEF


def test_validate_settings_ok():
    s = validate_settings(difficulty="hard", fleet_size=5)
    assert s["difficulty"] == "hard"
    assert s["fleet_size"] == 5


def test_validate_settings_rejects():
    with pytest.raises(ValueError):
        validate_settings(difficulty="insane", fleet_size=5)
    with pytest.raises(ValueError):
        validate_settings(difficulty="normal", fleet_size=1)


def test_normalize_actions_ok():
    assert normalize_actions([{"t": "shot", "r": 1, "c": 2}, {"t": "salvo"}]) == [
        {"t": "shot", "r": 1, "c": 2},
        {"t": "salvo"},
    ]


def test_normalize_actions_rejects():
    with pytest.raises(ValueError, match="invalid action type"):
        normalize_actions([{"t": "nuke", "r": 0, "c": 0}])
    with pytest.raises(ValueError, match="too many"):
        normalize_actions([{"t": "shot", "r": 0, "c": 0}] * (MAX_ACTIONS + 1))


def test_empty_actions_not_won():
    placements = [
        {"id": "gunboat", "r": 0, "c": 0, "horiz": True},
        {"id": "minelayer", "r": 1, "c": 0, "horiz": True},
    ]
    sim = simulate_battleships(
        seed="aabbccddeeff0011",
        difficulty="easy",
        placements=placements,
        actions=[],
        fleet_size=2,
    )
    assert sim["won"] is False
    assert sim["shots_fired"] == 0


def test_forged_win_without_clear_fails():
    placements = [
        {"id": "gunboat", "r": 0, "c": 0, "horiz": True},
        {"id": "minelayer", "r": 1, "c": 0, "horiz": True},
    ]
    sim = simulate_battleships(
        seed="0123456789abcdef",
        difficulty="easy",
        placements=placements,
        actions=[{"t": "shot", "r": 5, "c": 5}],
        fleet_size=2,
    )
    assert sim["won"] is False


def test_same_seed_same_enemy_fleet():
    placements = [
        {"id": "destroyer", "r": 0, "c": 0, "horiz": True},
        {"id": "gunboat", "r": 2, "c": 0, "horiz": True},
    ]
    ships = normalize_placements(placements, fleet_size=2)
    a = auto_place_all(ships, mulberry32(seed_to_u32("fedcba9876543210")))
    b = auto_place_all(ships, mulberry32(seed_to_u32("fedcba9876543210")))
    a_ships = {(r, c): a[r][c]["ship"] for r in range(10) for c in range(10) if a[r][c]["ship"]}
    b_ships = {(r, c): b[r][c]["ship"] for r in range(10) for c in range(10) if b[r][c]["ship"]}
    assert a_ships == b_ships


def test_perfect_shots_can_win_before_ai():
    seed = "1111222233334444"
    placements = [
        {"id": "carrier", "r": 0, "c": 0, "horiz": True},
        {"id": "battleship", "r": 1, "c": 0, "horiz": True},
        {"id": "destroyer", "r": 2, "c": 0, "horiz": True},
        {"id": "submarine", "r": 3, "c": 0, "horiz": True},
        {"id": "gunboat", "r": 4, "c": 0, "horiz": True},
    ]
    ships = normalize_placements(placements, fleet_size=5)
    ai = auto_place_all(ships, mulberry32(seed_to_u32(seed)))
    targets = [(r, c) for r in range(10) for c in range(10) if ai[r][c]["ship"]]
    assert len(targets) == 5 + 4 + 3 + 3 + 2
    actions = [{"t": "shot", "r": r, "c": c} for r, c in targets]
    sim = simulate_battleships(
        seed=seed,
        difficulty="easy",
        placements=placements,
        actions=actions,
        fleet_size=5,
    )
    assert sim["won"] is True
    assert sim["lost"] is False
    assert sim["shots_fired"] == len(targets)


def test_duplicate_shot_raises():
    placements = [
        {"id": "gunboat", "r": 0, "c": 0, "horiz": True},
        {"id": "minelayer", "r": 1, "c": 0, "horiz": True},
    ]
    with pytest.raises(ValueError, match="already fired"):
        simulate_battleships(
            seed="aaaaaaaaaaaaaaaa",
            difficulty="easy",
            placements=placements,
            actions=[{"t": "shot", "r": 9, "c": 9}, {"t": "shot", "r": 9, "c": 9}],
            fleet_size=2,
        )
