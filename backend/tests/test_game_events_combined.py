"""
Conflict groups: get_combined_event picks one event per group (UTC day) for tests.
Admin random bundle: roll_random_multi_event_bundle picks 1, 2, or all groups with one event each.
"""
import unittest


class TestGameEventsCombined(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import server
        cls.server = server

    def test_combined_event_id_and_keys(self):
        s = self.server
        c = s.get_combined_event()
        self.assertEqual(c["id"], "all_testing_resolved")
        for k in s.MULTIPLIER_KEYS:
            self.assertIn(k, c)

    def test_bodyguard_cost_is_one_discrete_value(self):
        s = self.server
        c = s.get_combined_event()
        group = s.GAME_EVENT_CONFLICT_GROUPS[3]
        allowed = {float(s.GAME_EVENTS_BY_ID[eid]["bodyguard_cost"]) for eid in group}
        self.assertIn(float(c["bodyguard_cost"]), allowed)

    def test_racket_row_matches_single_event(self):
        s = self.server
        c = s.get_combined_event()
        group = s.GAME_EVENT_CONFLICT_GROUPS[4]
        pairs = {
            (
                float(s.GAME_EVENTS_BY_ID[eid]["racket_payout"]),
                float(s.GAME_EVENTS_BY_ID[eid]["racket_cooldown"]),
            )
            for eid in group
        }
        got = (float(c["racket_payout"]), float(c["racket_cooldown"]))
        self.assertIn(got, pairs, "racket payout/cooldown must come from one picked event")

    def test_not_product_of_all_bodyguard_events(self):
        """Old bug: multiplying every bodyguard multiplier together."""
        s = self.server
        c = s.get_combined_event()
        absurd = 1.0
        for eid in [
            "bodyguard_half_price",
            "bodyguard_premium",
            "bodyguard_quarter_off",
            "bodyguard_premium_day",
        ]:
            absurd *= float(s.GAME_EVENTS_BY_ID[eid]["bodyguard_cost"])
        self.assertNotAlmostEqual(c["bodyguard_cost"], absurd, places=6)

    def test_roll_bundle_one_event_per_conflict_group(self):
        s = self.server
        for _ in range(50):
            ids = s.roll_random_multi_event_bundle()
            gis = [s._event_id_to_group_index(eid) for eid in ids]
            self.assertEqual(len(gis), len(set(gis)), "duplicate conflict group in roll")
            self.assertIn(len(ids), {1, 2, len(s.GAME_EVENT_CONFLICT_GROUPS)})

    def test_build_resolved_id_matches_combined_for_full_six(self):
        s = self.server
        c = s.get_combined_event()
        picked = []
        days = s._utc_days_since_game_events_epoch()
        for gi, group in enumerate(s.GAME_EVENT_CONFLICT_GROUPS):
            idx = (days + gi * 31) % len(group)
            picked.append(group[idx])
        b = s.build_resolved_event_from_event_ids(picked)
        for k in s.MULTIPLIER_KEYS:
            self.assertAlmostEqual(float(c[k]), float(b[k]), places=6)


if __name__ == "__main__":
    unittest.main()
