"""Unit tests for Flappy Gangster (Gauntlet) deterministic re-sim."""
import pytest

from utils.gauntlet_sim import (
    MAX_FLAPS,
    mulberry32,
    normalize_flaps,
    seed_to_u32,
    simulate_gauntlet,
)


def test_mulberry32_deterministic():
    a = mulberry32(0xABCDEF01)
    b = mulberry32(0xABCDEF01)
    assert [a() for _ in range(5)] == [b() for _ in range(5)]


def test_seed_to_u32_hex():
    assert seed_to_u32("deadbeefcafebabe") == 0xDEADBEEF


def test_normalize_flaps_ok():
    assert normalize_flaps([1, 4, 9]) == [1, 4, 9]


def test_normalize_flaps_rejects_non_increasing():
    with pytest.raises(ValueError, match="strictly increasing"):
        normalize_flaps([1, 1])
    with pytest.raises(ValueError, match="strictly increasing"):
        normalize_flaps([5, 3])


def test_normalize_flaps_rejects_too_many():
    with pytest.raises(ValueError, match="too many"):
        normalize_flaps(list(range(MAX_FLAPS + 1)))


def test_empty_flaps_dies_low_score():
    """Forged claim with no mid-run flaps cannot earn a high server score."""
    sim = simulate_gauntlet(seed="aabbccddeeff0011", flaps=[], speed="normal", difficulty="normal")
    assert sim["died"] is True
    assert sim["score"] < 5


def test_same_seed_and_flaps_same_score():
    flaps = [12, 28, 44, 60, 76, 92, 110, 128, 146, 164]
    a = simulate_gauntlet(seed="0123456789abcdef", flaps=flaps, speed="normal", difficulty="normal")
    b = simulate_gauntlet(seed="0123456789abcdef", flaps=flaps, speed="normal", difficulty="normal")
    assert a["score"] == b["score"]
    assert a["ticks"] == b["ticks"]
    assert a["died"] == b["died"]


def test_different_seed_changes_pipe_heights():
    a = mulberry32(seed_to_u32("1111111111111111"))
    b = mulberry32(seed_to_u32("2222222222222222"))
    assert [a() for _ in range(3)] != [b() for _ in range(3)]


def test_client_score_ignored_concept_resim_only():
    """Empty flaps => low score regardless of what a client might have claimed."""
    sim = simulate_gauntlet(seed="ffffffffffffffff", flaps=[], speed="fast", difficulty="hard")
    assert sim["score"] == 0 or sim["score"] < 3


# Known-good flap ticks for seed abcdef0123456789 @ crawl/easy (adaptive hover).
_SCORING_FLAPS = [
    25, 65, 111, 156, 201, 247, 292, 338, 383, 445, 491, 536, 560, 604, 649, 694,
    751, 796, 842, 887, 941, 986, 1032, 1077, 1116, 1157, 1203, 1248, 1293, 1331,
    1376, 1422, 1467, 1526, 1571, 1617, 1662, 1686, 1728, 1773, 1819, 1864, 1918, 1963,
]


def test_periodic_flaps_can_score():
    sim = simulate_gauntlet(
        seed="abcdef0123456789",
        flaps=_SCORING_FLAPS,
        speed="crawl",
        difficulty="easy",
        max_ticks=2000,
    )
    assert sim["score"] >= 1
    assert sim["died"] is False


def test_forged_high_client_score_still_resims_low_without_flaps():
    """Network spoof of score is irrelevant — empty flaps cannot invent gates."""
    sim = simulate_gauntlet(seed="0123456789abcdef", flaps=[], speed="normal", difficulty="normal")
    assert sim["score"] < 5
    # Claiming score=50000 would still pay based on this sim score only.
    assert sim["died"] is True
