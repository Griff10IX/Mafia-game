"""Quick checks for Game Pass Season 6 totals + spread."""
from utils.game_pass_micro_rewards import (
    TARGET_CASH_TOTAL_V6,
    TARGET_LOOT_PIECES_TOTAL_V6,
    TARGET_MISSION_SKIP_TOTAL_V6,
    TARGET_POINTS_TOTAL_V6,
    rewards_for_micro_tier,
    verify_season_payout_spread,
)


def test_v6_totals_and_spread():
    r = verify_season_payout_spread("6")
    assert r["ok"], r.get("offenders")
    assert r["totals"]["money"] == TARGET_CASH_TOTAL_V6
    assert abs(r["totals"]["points"] - TARGET_POINTS_TOTAL_V6) <= 2
    loot = sum(int(rewards_for_micro_tier(t, "6").get("loot_box_pieces") or 0) for t in range(1, 101))
    assert abs(loot - TARGET_LOOT_PIECES_TOTAL_V6) <= 5
    ms = sum(int(rewards_for_micro_tier(t, "6").get("mission_skip_tokens") or 0) for t in range(1, 101))
    assert ms == TARGET_MISSION_SKIP_TOTAL_V6
    # Two consecutive tiers cannot dump most of the points budget.
    vals = [int(rewards_for_micro_tier(t, "6").get("points") or 0) for t in range(1, 101)]
    max_pair = max(vals[i] + vals[i + 1] for i in range(99))
    assert max_pair < TARGET_POINTS_TOTAL_V6 * 0.15
