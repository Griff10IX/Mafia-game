"""Prestige rate top-up: +15% → +50% make-good math."""
import math
import unittest

from utils.game_pass_prestige import (
    GAME_PASS_PRESTIGE_BONUS_RATE,
    GAME_PASS_PRESTIGE_LEGACY_BONUS_RATE,
    prestige_bonus_rewards_at_rate,
    prestige_rate_topup_rewards,
    season_vip_reward_totals,
)


class TestPrestigeRateTopup(unittest.TestCase):
    def test_topup_is_difference_of_ceil_rates(self):
        totals = season_vip_reward_totals(None)
        topup = prestige_rate_topup_rewards(None)
        at_new = prestige_bonus_rewards_at_rate(GAME_PASS_PRESTIGE_BONUS_RATE, None, include_extra_loot=False)
        at_old = prestige_bonus_rewards_at_rate(GAME_PASS_PRESTIGE_LEGACY_BONUS_RATE, None, include_extra_loot=False)
        for key, total in totals.items():
            expected = int(math.ceil(total * 0.50)) - int(math.ceil(total * 0.15))
            self.assertEqual(topup.get(key, 0), max(0, expected), key)
            self.assertEqual(at_new.get(key, 0) - at_old.get(key, 0), max(0, expected), key)
        # Flat +500 loot is only on full prestige, not the rate top-up delta.
        expected_loot = int(math.ceil(totals["loot_box_pieces"] * 0.50)) - int(
            math.ceil(totals["loot_box_pieces"] * 0.15)
        )
        self.assertEqual(topup.get("loot_box_pieces", 0), max(0, expected_loot))

    def test_rates(self):
        self.assertEqual(GAME_PASS_PRESTIGE_LEGACY_BONUS_RATE, 0.15)
        self.assertEqual(GAME_PASS_PRESTIGE_BONUS_RATE, 0.50)


if __name__ == "__main__":
    unittest.main()
