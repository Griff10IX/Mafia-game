"""Season 5 Game Pass profile + per-season prestige reset."""
import math
import unittest

from utils.game_pass_complete_remaining_vip import aggregate_vip_increment_after_cursor_for_season
from utils.game_pass_micro_rewards import (
    MAX_MICRO_TIER,
    TARGET_CASH_TOTAL,
    TARGET_CASH_TOTAL_V5,
    TARGET_LOOT_PIECES_TOTAL,
    TARGET_LOOT_PIECES_TOTAL_V5,
    TARGET_MISSION_SKIP_TOTAL_V5,
    TARGET_POINTS_TOTAL,
    TARGET_POINTS_TOTAL_V5,
    TARGET_ROBOT_HIRE_TOTAL_V5,
    rewards_for_micro_tier,
    season_reward_profile_key,
    vip_rewards_after_free_dedupe,
)
from utils.game_pass_prestige import GAME_PASS_PRESTIGE_BONUS_RATE, prestige_bonus_rewards, season_vip_reward_totals
from utils.game_pass_season_rp import _reconcile_set_fields
from utils.game_pass_weed_strains import GAME_PASS_STRAIN_BY_TIER, game_pass_strain_for_micro_tier


def _sum_track(season_id: str, key: str) -> int:
    total = 0
    for t in range(1, MAX_MICRO_TIER + 1):
        total += int(rewards_for_micro_tier(t, season_id=season_id).get(key) or 0)
    return total


class TestGamePassSeason5(unittest.TestCase):
    def test_profile_keys(self):
        self.assertEqual(season_reward_profile_key("4"), "v4")
        self.assertEqual(season_reward_profile_key("5"), "v5")
        self.assertEqual(season_reward_profile_key("6"), "v5")

    def test_season_4_unchanged(self):
        self.assertEqual(season_vip_reward_totals("4")["points"], TARGET_POINTS_TOTAL)
        self.assertEqual(season_vip_reward_totals("4")["money"], TARGET_CASH_TOTAL)
        self.assertEqual(season_vip_reward_totals("4")["loot_box_pieces"], TARGET_LOOT_PIECES_TOTAL)
        self.assertNotIn("mission_skip_tokens", season_vip_reward_totals("4"))
        self.assertEqual(game_pass_strain_for_micro_tier(20, profile_key="v4"), GAME_PASS_STRAIN_BY_TIER[20])

    def test_season_5_totals(self):
        totals = season_vip_reward_totals("5")
        self.assertEqual(totals["points"], TARGET_POINTS_TOTAL_V5)
        self.assertEqual(totals["money"], TARGET_CASH_TOTAL_V5)
        self.assertEqual(totals["loot_box_pieces"], TARGET_LOOT_PIECES_TOTAL_V5)
        self.assertEqual(totals["mission_skip_tokens"], TARGET_MISSION_SKIP_TOTAL_V5)
        self.assertEqual(totals["robot_bodyguard_hire_tokens"], TARGET_ROBOT_HIRE_TOTAL_V5)
        self.assertEqual(_sum_track("5", "mission_skip_tokens"), TARGET_MISSION_SKIP_TOTAL_V5)
        self.assertEqual(_sum_track("5", "robot_bodyguard_hire_tokens"), TARGET_ROBOT_HIRE_TOTAL_V5)
        self.assertIsNone(game_pass_strain_for_micro_tier(20, profile_key="v5"))
        self.assertIsNone(game_pass_strain_for_micro_tier(50, profile_key="v5"))

    def test_season_5_prestige_is_half_plus_loot(self):
        bonus = prestige_bonus_rewards("5")
        self.assertEqual(bonus["points"], int(math.ceil(TARGET_POINTS_TOTAL_V5 * GAME_PASS_PRESTIGE_BONUS_RATE)))
        self.assertEqual(bonus["money"], int(math.ceil(TARGET_CASH_TOTAL_V5 * GAME_PASS_PRESTIGE_BONUS_RATE)))
        self.assertEqual(
            bonus["loot_box_pieces"],
            int(math.ceil(TARGET_LOOT_PIECES_TOTAL_V5 * GAME_PASS_PRESTIGE_BONUS_RATE)) + 500,
        )
        self.assertEqual(bonus["mission_skip_tokens"], int(math.ceil(TARGET_MISSION_SKIP_TOTAL_V5 * 0.50)))
        self.assertEqual(bonus["robot_bodyguard_hire_tokens"], int(math.ceil(TARGET_ROBOT_HIRE_TOTAL_V5 * 0.50)))

    def test_reconcile_resets_prestige_per_season(self):
        fields = _reconcile_set_fields("5")
        self.assertEqual(fields["game_pass_prestige_count"], 0)
        self.assertEqual(fields["game_pass_prestige_pending"], 0)
        self.assertFalse(fields["rank_xp_pass_rewards_granted"])

    def test_closeout_incomplete_vip_uses_season_4_not_5(self):
        """Mock: VIP at tier 37, free track also at 37 — remaining payout is v4, no S5 tokens."""
        last = 37
        free_last = 37
        remaining = aggregate_vip_increment_after_cursor_for_season(
            last, free_last, season_id="4"
        )
        remaining_v5 = aggregate_vip_increment_after_cursor_for_season(
            last, free_last, season_id="5"
        )
        self.assertGreater(int(remaining.get("money") or 0), 0)
        self.assertGreater(int(remaining.get("points") or 0), 0)
        self.assertNotIn("mission_skip_tokens", remaining)
        self.assertNotIn("robot_bodyguard_hire_tokens", remaining)
        self.assertEqual(int(remaining_v5.get("mission_skip_tokens") or 0), 4)
        self.assertGreater(int(remaining_v5.get("money") or 0), int(remaining.get("money") or 0))
        missing_strains = [
            GAME_PASS_STRAIN_BY_TIER[t]
            for t in GAME_PASS_STRAIN_BY_TIER
            if t > last
        ]
        self.assertEqual(missing_strains, ["gp_wedding_cake", "gp_gorilla_glue"])

    def test_free_track_dedupe_does_not_double_pay(self):
        """Mock: if the free bucket for a 10% milestone was already granted, VIP remaining zeros it."""
        t = 40
        full = rewards_for_micro_tier(t, season_id="4")
        deduped = vip_rewards_after_free_dedupe(t, free_cash_last_micro_tier_granted=40, season_id="4")
        zeroed = [k for k, v in deduped.items() if int(full.get(k) or 0) > 0 and int(v or 0) == 0]
        self.assertTrue(zeroed, "expected at least one free-track bucket to be deducted")
        untouched = vip_rewards_after_free_dedupe(t, free_cash_last_micro_tier_granted=39, season_id="4")
        self.assertEqual(untouched.get("points"), full.get("points"))
        self.assertEqual(untouched.get("money"), full.get("money"))

    def test_already_complete_vip_gets_nothing(self):
        remaining = aggregate_vip_increment_after_cursor_for_season(
            MAX_MICRO_TIER, MAX_MICRO_TIER, season_id="4"
        )
        self.assertEqual(remaining, {})

    def test_season_4_prestige_not_inflated_by_v5(self):
        s4 = prestige_bonus_rewards("4")
        s5 = prestige_bonus_rewards("5")
        self.assertEqual(s4["points"], 15_000)
        self.assertEqual(s4["money"], 2_500_000_000)
        self.assertEqual(s5["points"], 19_000)
        self.assertEqual(s5["money"], 5_000_000_000)
        self.assertNotIn("mission_skip_tokens", s4)
        self.assertEqual(s5["mission_skip_tokens"], 3)
        self.assertEqual(s5["robot_bodyguard_hire_tokens"], 5)


if __name__ == "__main__":
    unittest.main()
