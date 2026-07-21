import unittest

import server  # noqa: F401 - establish normal router import order
from routers.cars import gta


def _pool_for_difficulty(option_difficulty: int):
    max_difficulty = gta._gta_pool_max_car_difficulty(option_difficulty)
    return [
        c
        for c in server.CARS
        if c["min_difficulty"] <= max_difficulty
        and c["rarity"] != "exclusive"
        and c.get("rarity") not in ("loot_exclusive", "vip_exclusive")
        and c.get("id") != "car_custom"
    ]


class GtaDropPoolTests(unittest.TestCase):
    def test_street_parking_pool_includes_uncommon_and_rare(self):
        pool = _pool_for_difficulty(1)
        rarities = {c["rarity"] for c in pool}
        self.assertEqual(rarities, {"common", "uncommon", "rare"})

    def test_higher_difficulty_pools_are_unchanged(self):
        self.assertEqual(gta._gta_pool_max_car_difficulty(2), 2)
        self.assertEqual(gta._gta_pool_max_car_difficulty(3), 3)
        self.assertEqual(gta._gta_pool_max_car_difficulty(4), 4)
        self.assertEqual(gta._gta_pool_max_car_difficulty(5), 5)
        self.assertEqual({c["rarity"] for c in _pool_for_difficulty(2)}, {"common", "uncommon"})

    def test_street_parking_weight_shares(self):
        pool = _pool_for_difficulty(1)
        weights = {
            c["id"]: gta._gta_non_legendary_roll_weight(
                c["rarity"], 0.0, gta.GTA_STREET_PARKING_RARITY_BASE_WEIGHT
            )
            for c in pool
        }
        total = sum(weights.values())
        share_by_rarity = {}
        for c in pool:
            share_by_rarity[c["rarity"]] = share_by_rarity.get(c["rarity"], 0.0) + weights[c["id"]] / total
        self.assertAlmostEqual(share_by_rarity["common"], 0.65, delta=0.01)
        self.assertAlmostEqual(share_by_rarity["uncommon"], 0.265, delta=0.01)
        self.assertAlmostEqual(share_by_rarity["rare"], 0.085, delta=0.01)

    def test_default_weights_unchanged_without_override(self):
        self.assertEqual(gta._gta_non_legendary_roll_weight("common", 0.0), 1.0)
        self.assertEqual(gta._gta_non_legendary_roll_weight("uncommon", 0.0), 0.88)
        self.assertEqual(gta._gta_non_legendary_roll_weight("rare", 0.0), 0.28)

    def test_boost_slope_applies_on_top_of_override(self):
        base = gta._gta_non_legendary_roll_weight(
            "rare", 0.0, gta.GTA_STREET_PARKING_RARITY_BASE_WEIGHT
        )
        boosted = gta._gta_non_legendary_roll_weight(
            "rare", 1.0, gta.GTA_STREET_PARKING_RARITY_BASE_WEIGHT
        )
        self.assertAlmostEqual(boosted - base, gta.GTA_NON_LEGENDARY_RARITY_BOOST_SLOPE["rare"])


class GtaDifficultyRankPointsTests(unittest.TestCase):
    def _rp(self, rarity: str, difficulty: int) -> int:
        rarity_points = {"common": 3, "uncommon": 8, "rare": 18, "ultra_rare": 35, "legendary": 60}
        return int(rarity_points[rarity] * gta.GTA_DIFFICULTY_RANK_POINTS_MULT.get(difficulty, 1.0))

    def test_street_parking_rank_points_unchanged(self):
        self.assertEqual(self._rp("common", 1), 3)
        self.assertEqual(self._rp("rare", 1), 18)

    def test_higher_difficulty_pays_more(self):
        self.assertEqual(self._rp("common", 5), 6)
        self.assertEqual(self._rp("ultra_rare", 4), 61)
        self.assertEqual(self._rp("legendary", 5), 120)

    def test_unknown_difficulty_defaults_to_base(self):
        self.assertEqual(gta.GTA_DIFFICULTY_RANK_POINTS_MULT.get(99, 1.0), 1.0)


if __name__ == "__main__":
    unittest.main()
