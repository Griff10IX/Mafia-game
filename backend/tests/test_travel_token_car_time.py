"""Travel token must not slow a 2s car."""
import unittest

import server  # noqa: F401 — router import order

from routers.admin.airport import apply_travel_token_to_car_seconds


class TestApplyTravelTokenToCarSeconds(unittest.TestCase):
    def test_model_sj_not_slowed(self):
        self.assertEqual(apply_travel_token_to_car_seconds(2), 1)

    def test_loot_exclusive_five(self):
        self.assertEqual(apply_travel_token_to_car_seconds(5), 4)

    def test_never_above_base(self):
        for base in range(1, 50):
            self.assertLessEqual(apply_travel_token_to_car_seconds(base), base)

    def test_zero_and_negative(self):
        self.assertEqual(apply_travel_token_to_car_seconds(0), 0)
        self.assertEqual(apply_travel_token_to_car_seconds(-1), -1)


if __name__ == "__main__":
    unittest.main()
