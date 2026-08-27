"""Email-linked dead accounts for Dead > Alive My Accounts."""
import unittest

import server  # noqa: F401

from routers.game.dead_alive import dead_account_linked_by_email, estate_retrievable


class TestDeadAccountEmailLink(unittest.TestCase):
    def test_live_email_match(self):
        self.assertTrue(
            dead_account_linked_by_email(
                "a@x.com",
                {"email": "A@x.com", "email_before_freed": None},
            )
        )

    def test_email_before_freed_match(self):
        self.assertTrue(
            dead_account_linked_by_email(
                "a@x.com",
                {"email": "dead_abc@deleted", "email_before_freed": "a@x.com"},
            )
        )

    def test_other_email_rejected(self):
        self.assertFalse(
            dead_account_linked_by_email(
                "a@x.com",
                {"email": "dead_abc@deleted", "email_before_freed": "b@x.com"},
            )
        )

    def test_tombstone_current_email_rejected(self):
        self.assertFalse(
            dead_account_linked_by_email(
                "dead_abc@deleted",
                {"email": "dead_abc@deleted"},
            )
        )


class TestEstateRetrievable(unittest.TestCase):
    def test_unclaimed_uses_wallet_points_and_money_at_death(self):
        out = estate_retrievable(
            {
                "retrieval_used": False,
                "points": 18656,
                "money_at_death": 100000,
                "swiss_balance": 50,
            },
            cash_percent=0.9995,
        )
        self.assertEqual(out["points"], 18656)
        self.assertEqual(out["cash"], 99950)
        self.assertEqual(out["cash_before_tithe"], 100000)
        self.assertEqual(out["swiss"], 50)
        self.assertTrue(out["can_retrieve"])

    def test_already_claimed_only_leftover_wallet_and_swiss(self):
        out = estate_retrievable(
            {
                "retrieval_used": True,
                "points": 500,
                "money_at_death": 100000,
                "swiss_balance": 20,
                "swiss_retrieval_used": False,
            }
        )
        self.assertEqual(out["points"], 500)
        self.assertEqual(out["cash"], 0)
        self.assertEqual(out["swiss"], 20)
        self.assertTrue(out["can_retrieve"])

    def test_empty_after_claim(self):
        out = estate_retrievable(
            {
                "retrieval_used": True,
                "points": 0,
                "money_at_death": 999,
                "swiss_balance": 0,
                "swiss_retrieval_used": True,
            }
        )
        self.assertFalse(out["can_retrieve"])


if __name__ == "__main__":
    unittest.main()
