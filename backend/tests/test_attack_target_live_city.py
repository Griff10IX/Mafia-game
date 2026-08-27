"""Hunt list uses live city, including travel that has already landed."""
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch

import server  # noqa: F401 — router import order

from routers.kill import attack as attack_mod


def _iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


class TestAttackTargetLiveCity(unittest.TestCase):
    def setUp(self):
        self.states = ["New York", "Chicago"]
        self.patcher = patch.object(attack_mod, "STATES", self.states)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()

    def test_still_in_origin_while_in_transit(self):
        now = datetime.now(timezone.utc)
        tu = {
            "current_state": "New York",
            "traveling_to": "Chicago",
            "travel_arrives_at": _iso(now + timedelta(seconds=8)),
        }
        self.assertEqual(attack_mod._live_player_city(tu), "New York")
        self.assertEqual(attack_mod._in_transit_destination(tu), "Chicago")

    def test_landed_travel_even_if_current_state_stale(self):
        now = datetime.now(timezone.utc)
        tu = {
            "current_state": "New York",
            "traveling_to": "Chicago",
            "travel_arrives_at": _iso(now - timedelta(seconds=2)),
        }
        self.assertEqual(attack_mod._live_player_city(tu), "Chicago")
        self.assertIsNone(attack_mod._in_transit_destination(tu))

    def test_found_row_follows_live_city(self):
        now = datetime.now(timezone.utc)
        attack = {"status": "found", "location_state": "New York"}
        tu = {
            "current_state": "New York",
            "traveling_to": "Chicago",
            "travel_arrives_at": _iso(now - timedelta(seconds=1)),
        }
        self.assertEqual(attack_mod._resolved_target_location(attack, tu), "Chicago")

    def test_robot_bodyguard_ignores_travel_fields(self):
        now = datetime.now(timezone.utc)
        tu = {
            "is_npc": True,
            "is_bodyguard": True,
            "current_state": "New York",
            "traveling_to": "Chicago",
            "travel_arrives_at": _iso(now - timedelta(seconds=1)),
        }
        self.assertEqual(attack_mod._live_player_city(tu), "New York")
        self.assertIsNone(attack_mod._in_transit_destination(tu))


if __name__ == "__main__":
    unittest.main()
