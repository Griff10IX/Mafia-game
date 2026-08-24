import unittest

from utils.profile_dm_counts import stored_profile_dm_counts


class ProfileDmCountTests(unittest.TestCase):
    def test_stored_counts_none_until_both_fields_exist(self):
        self.assertIsNone(stored_profile_dm_counts(None))
        self.assertIsNone(stored_profile_dm_counts({"id": "u1"}))
        self.assertIsNone(stored_profile_dm_counts({"id": "u1", "profile_dm_sent": 4}))
        self.assertIsNone(stored_profile_dm_counts({"id": "u1", "profile_dm_received": 2}))

    def test_stored_counts_are_received_then_sent(self):
        self.assertEqual(
            stored_profile_dm_counts({"id": "u1", "profile_dm_received": 12, "profile_dm_sent": 7}),
            (12, 7),
        )

    def test_stored_counts_treat_junk_as_zero(self):
        self.assertEqual(
            stored_profile_dm_counts({"id": "u1", "profile_dm_received": None, "profile_dm_sent": "nope"}),
            (0, 0),
        )


if __name__ == "__main__":
    unittest.main()
