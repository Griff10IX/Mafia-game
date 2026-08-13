import unittest
from datetime import datetime, timezone, timedelta

from utils.last_man_standing import (
    gw1_completeness,
    split_pot,
    slug_team,
    name_norm,
    _picks_locked,
    _pick_won,
    _gw_all_resolved,
    _deadline_from_fixtures,
    entry_prize_ineligible,
    lives_after_wrong_pick,
    entry_lives,
)


class LmsHelpersTests(unittest.TestCase):
    def test_gw1_complete_ten_matches_twenty_teams(self):
        fx = []
        for i in range(10):
            fx.append({
                "home_team_id": f"t{i * 2}",
                "away_team_id": f"t{i * 2 + 1}",
            })
        ok, n_fx, n_teams = gw1_completeness(fx)
        self.assertTrue(ok)
        self.assertEqual(n_fx, 10)
        self.assertEqual(n_teams, 20)

    def test_gw1_incomplete_short_slate(self):
        fx = [{"home_team_id": "a", "away_team_id": "b"}]
        ok, n_fx, n_teams = gw1_completeness(fx)
        self.assertFalse(ok)
        self.assertEqual(n_fx, 1)
        self.assertEqual(n_teams, 2)

    def test_gw1_incomplete_duplicate_teams(self):
        fx = [{"home_team_id": "a", "away_team_id": "b"} for _ in range(10)]
        ok, n_fx, n_teams = gw1_completeness(fx)
        self.assertFalse(ok)
        self.assertEqual(n_fx, 10)
        self.assertEqual(n_teams, 2)

    def test_split_pot_remainder_to_first(self):
        self.assertEqual(split_pot(10, 3), [4, 3, 3])
        self.assertEqual(split_pot(250000, 1), [250000])
        self.assertEqual(split_pot(5, 2), [3, 2])

    def test_slug_and_norm(self):
        self.assertEqual(slug_team("Manchester City FC"), "manchester-city")
        self.assertEqual(name_norm("Man City"), name_norm("mancity"))

    def test_picks_locked_after_deadline(self):
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        self.assertTrue(_picks_locked({"status": "picks_open", "pick_deadline": past}))
        self.assertFalse(_picks_locked({"status": "picks_open", "pick_deadline": future}))
        self.assertTrue(_picks_locked({"status": "locked", "pick_deadline": future}))
        self.assertTrue(_picks_locked({"status": "settled"}))

    def test_pick_won_draw_loss_postpone(self):
        fx = {"home_team_id": "h", "away_team_id": "a", "result": "home"}
        self.assertEqual(_pick_won(fx, "h"), "win")
        self.assertEqual(_pick_won(fx, "a"), "lose")
        self.assertEqual(_pick_won({**fx, "result": "draw"}, "h"), "lose")
        self.assertEqual(_pick_won({**fx, "result": "postponed"}, "h"), "postponed")
        self.assertIsNone(_pick_won({**fx, "result": None}, "h"))

    def test_unresolved_fixtures_block_settle(self):
        self.assertFalse(_gw_all_resolved([{"result": None}, {"result": "home"}]))
        self.assertTrue(_gw_all_resolved([{"result": "home"}, {"result": "postponed"}]))
        self.assertFalse(_gw_all_resolved([]))

    def test_deadline_is_first_kickoff(self):
        fx = [
            {"kickoff": "2026-08-15T17:00:00+00:00"},
            {"kickoff": "2026-08-15T14:00:00+00:00"},
        ]
        self.assertTrue(_deadline_from_fixtures(fx).startswith("2026-08-15T14:00:00"))

    def test_staff_entries_are_prize_ineligible(self):
        self.assertTrue(entry_prize_ineligible({"staff_entry": True, "prize_eligible": False}))
        self.assertTrue(entry_prize_ineligible({"prize_eligible": False}))
        self.assertFalse(entry_prize_ineligible({"staff_entry": False, "prize_eligible": True}))
        self.assertFalse(entry_prize_ineligible({"username": "player"}))

    def test_two_lives_then_out(self):
        left, alive = lives_after_wrong_pick(2)
        self.assertEqual(left, 1)
        self.assertTrue(alive)
        left, alive = lives_after_wrong_pick(1)
        self.assertEqual(left, 0)
        self.assertFalse(alive)
        self.assertEqual(entry_lives({"lives": 3}), 3)
        self.assertEqual(entry_lives({}), 2)

    def test_official_gw1_is_full_slate(self):
        from utils.last_man_standing import official_gw1_2026_fixtures
        fx = official_gw1_2026_fixtures()
        ok, n_fx, n_teams = gw1_completeness(fx)
        self.assertTrue(ok)
        self.assertEqual(n_fx, 10)
        self.assertEqual(n_teams, 20)
        self.assertEqual(fx[0]["home"], "Arsenal")
        self.assertEqual(fx[-1]["away"], "Chelsea")


if __name__ == "__main__":
    unittest.main()
