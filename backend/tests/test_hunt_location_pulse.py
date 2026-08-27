"""Kill-page hunter pulse bumps when a found target moves."""
import unittest

from utils import hunt_location_pulse as pulse


class TestHuntLocationPulse(unittest.TestCase):
    def setUp(self):
        pulse._rev.clear()
        pulse._patches.clear()
        pulse._seq = 0

    def test_snapshot_unchanged_until_store(self):
        snap = pulse.hunter_pulse_snapshot("hunter1", 0)
        self.assertFalse(snap["changed"])
        self.assertEqual(snap["rev"], 0)

    def test_snapshot_returns_rows_then_quiet(self):
        pulse._store_hunter_patches(
            {
                "hunter1": [
                    {"attack_id": "a1", "location_state": "Chicago", "traveling_to": None},
                ]
            }
        )
        snap = pulse.hunter_pulse_snapshot("hunter1", 0)
        self.assertTrue(snap["changed"])
        self.assertEqual(snap["rows"][0]["location_state"], "Chicago")
        quiet = pulse.hunter_pulse_snapshot("hunter1", snap["rev"])
        self.assertFalse(quiet["changed"])
        self.assertEqual(quiet["rows"], [])


if __name__ == "__main__":
    unittest.main()
