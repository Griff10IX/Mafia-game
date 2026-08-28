import unittest

import server  # noqa: F401 — router import order

from routers.kill.attack import _witness_recipient_query


class WitnessRecipientQueryTests(unittest.TestCase):
    def test_excludes_killer_and_staff_ids(self):
        q = _witness_recipient_query(
            killer_id="killer-1",
            five_iso="t0",
            now_iso="t1",
            staff_match={"is_moderator": {"$ne": True}, "id": {"$nin": ["admin-1", "mod-1"]}},
        )
        self.assertEqual(q["is_moderator"], {"$ne": True})
        self.assertEqual(q["is_npc"], {"$ne": True})
        self.assertEqual(q["is_bodyguard"], {"$ne": True})
        self.assertEqual(q["is_dead"], {"$ne": True})
        self.assertEqual(q["id"]["$nin"], ["admin-1", "mod-1", "killer-1"])

    def test_killer_only_when_no_staff_match(self):
        q = _witness_recipient_query(
            killer_id="killer-1",
            five_iso="t0",
            now_iso="t1",
            staff_match=None,
        )
        self.assertEqual(q["id"]["$nin"], ["killer-1"])
        self.assertEqual(q["is_moderator"], {"$ne": True})


if __name__ == "__main__":
    unittest.main()
