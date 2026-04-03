"""
All-events testing mode: get_combined_event picks one event per conflict group (UTC day),
so opposing multipliers on the same axis do not multiply together.
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


if __name__ == "__main__":
    unittest.main()
