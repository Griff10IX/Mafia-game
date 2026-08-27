"""Admin grouping of leftover dead-account estates onto living players."""
import unittest

import server  # noqa: F401 — router import order

from utils.dead_estate_audit import (
    build_dead_estate_clusters,
    leftover_mongo_filter,
    pick_alive_for_dead,
    serialize_dead_estate,
)


class TestSerializeDeadEstate(unittest.TestCase):
    def test_points_cash_swiss(self):
        row = serialize_dead_estate(
            {
                "id": "d1",
                "username": "Avant",
                "is_dead": True,
                "points": 18656,
                "money_at_death": 100000,
                "swiss_balance": 50,
                "email": "a@x.com",
            },
            cash_percent=0.9995,
        )
        self.assertEqual(row["points"], 18656)
        self.assertEqual(row["cash"], 99950)
        self.assertEqual(row["swiss"], 50)
        self.assertEqual(row["email"], "a@x.com")

    def test_empty_skipped(self):
        self.assertIsNone(
            serialize_dead_estate(
                {
                    "id": "d1",
                    "username": "Empty",
                    "is_dead": True,
                    "points": 0,
                    "money_at_death": 10,
                    "retrieval_used": True,
                    "swiss_balance": 0,
                }
            )
        )


class TestPickAlive(unittest.TestCase):
    def test_same_email(self):
        dead = {"id": "d1", "email": "dead_x@deleted", "email_before_freed": "a@x.com", "registration_ip": "1.1.1.1"}
        live = {"id": "a1", "username": "Hazey", "email": "a@x.com", "created_at": "2026-08-26"}
        picked, reason = pick_alive_for_dead(dead, [live], set())
        self.assertEqual(picked["id"], "a1")
        self.assertEqual(reason, "same_email")

    def test_replacement_registration(self):
        dead = {"id": "d1", "email": "dead_x@deleted"}
        live = {"id": "a1", "username": "Hazey", "email": "b@x.com", "registration_freed_email_from_user_id": "d1"}
        picked, reason = pick_alive_for_dead(dead, [live], set())
        self.assertEqual(reason, "replacement_registration")
        self.assertEqual(picked["id"], "a1")

    def test_ip_after_death(self):
        dead = {
            "id": "k",
            "username": "K",
            "email": "old@x.com",
            "registration_ip": "2001:db8::1",
            "dead_at": "2026-04-08T00:00:00+00:00",
        }
        live = {
            "id": "h",
            "username": "Hazey",
            "email": "new@x.com",
            "registration_ip": "2001:db8::1",
            "created_at": "2026-08-26T00:00:00+00:00",
        }
        picked, reason = pick_alive_for_dead(dead, [live], set())
        self.assertEqual(picked["username"], "Hazey")
        self.assertEqual(reason, "registration_ip_after_death")

    def test_noisy_ip_skipped(self):
        dead = {
            "id": "k",
            "registration_ip": "9.9.9.9",
            "dead_at": "2026-01-01",
        }
        live = {
            "id": "h",
            "username": "Hazey",
            "email": "new@x.com",
            "registration_ip": "9.9.9.9",
            "created_at": "2026-08-26",
        }
        picked, reason = pick_alive_for_dead(dead, [live], {"9.9.9.9"})
        self.assertIsNone(picked)
        self.assertIsNone(reason)


class TestBuildClusters(unittest.TestCase):
    def test_groups_same_player(self):
        deads = [
            {
                "id": "d1",
                "username": "Avant",
                "is_dead": True,
                "email": "a@x.com",
                "points": 100,
                "money_at_death": 0,
                "swiss_balance": 0,
                "dead_at": "2026-08-01",
            },
            {
                "id": "d2",
                "username": "K",
                "is_dead": True,
                "email": "k@y.com",
                "registration_ip": "1.2.3.4",
                "dead_at": "2026-04-01",
                "points": 50,
                "money_at_death": 0,
                "swiss_balance": 25,
            },
        ]
        lives = [
            {
                "id": "h",
                "username": "Hazey",
                "email": "a@x.com",
                "registration_ip": "1.2.3.4",
                "created_at": "2026-08-26",
            }
        ]
        out = build_dead_estate_clusters(deads, lives)
        self.assertEqual(out["summary"]["player_count"], 1)
        self.assertEqual(out["summary"]["points"], 150)
        self.assertEqual(out["summary"]["swiss"], 25)
        names = {d["username"] for d in out["clusters"][0]["dead_accounts"]}
        self.assertEqual(names, {"Avant", "K"})
        self.assertEqual(out["clusters"][0]["current"]["username"], "Hazey")
        self.assertEqual(out["unlinked"], [])

    def test_unlinked_when_no_alive(self):
        deads = [
            {
                "id": "d1",
                "username": "Lone",
                "is_dead": True,
                "points": 10,
                "money_at_death": 0,
                "swiss_balance": 0,
            }
        ]
        out = build_dead_estate_clusters(deads, [])
        self.assertEqual(out["summary"]["player_count"], 0)
        self.assertEqual(out["unlinked"][0]["username"], "Lone")

    def test_noisy_ip_does_not_merge_strangers(self):
        deads = [
            {
                "id": "d1",
                "username": "DeadVpn",
                "is_dead": True,
                "registration_ip": "8.8.8.8",
                "dead_at": "2026-01-01",
                "points": 9,
                "money_at_death": 0,
                "swiss_balance": 0,
            }
        ]
        lives = [
            {"id": f"a{i}", "username": f"Live{i}", "email": f"{i}@z.com", "registration_ip": "8.8.8.8", "created_at": "2026-06-01"}
            for i in range(5)
        ]
        out = build_dead_estate_clusters(deads, lives)
        self.assertEqual(out["clusters"], [])
        self.assertEqual(out["unlinked"][0]["username"], "DeadVpn")


class TestLeftoverFilter(unittest.TestCase):
    def test_matches_points_or_swiss_or_cash(self):
        q = leftover_mongo_filter()
        self.assertTrue(q["is_dead"])
        self.assertEqual(len(q["$or"]), 3)


if __name__ == "__main__":
    unittest.main()
