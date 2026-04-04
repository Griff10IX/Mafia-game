import unittest
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routers.casinos.mp_poker_flow import (
    classify_player_action,
    is_betting_round_complete,
    next_actionable_index,
    reset_acted_this_street_for_raise,
    tournament_survivors,
)


class TestMPPokerTournamentFlowHelpers(unittest.TestCase):
    def test_classify_player_action_includes_fold(self):
        self.assertEqual(classify_player_action("fold"), "fold")
        self.assertEqual(classify_player_action(" FOLD "), "fold")
        self.assertEqual(classify_player_action("bad_action"), "invalid")

    def test_next_actionable_index_skips_folded_and_all_in(self):
        players = [
            {"status": "folded"},
            {"status": "all_in"},
            {"status": "active"},
            {"status": "folded"},
        ]
        self.assertEqual(next_actionable_index(players, 0), 2)

    def test_betting_round_complete_all_checks(self):
        players = [
            {"status": "active", "current_bet": 0, "acted_this_street": True},
            {"status": "active", "current_bet": 0, "acted_this_street": True},
            {"status": "active", "current_bet": 0, "acted_this_street": True},
        ]
        self.assertTrue(is_betting_round_complete(players))

    def test_betting_round_incomplete_when_actionable_not_acted(self):
        players = [
            {"status": "active", "current_bet": 100, "acted_this_street": True},
            {"status": "active", "current_bet": 100, "acted_this_street": False},
            {"status": "folded", "current_bet": 0, "acted_this_street": False},
        ]
        self.assertFalse(is_betting_round_complete(players))

    def test_betting_round_complete_when_only_all_in_or_folded(self):
        players = [
            {"status": "all_in", "current_bet": 300, "acted_this_street": True},
            {"status": "folded", "current_bet": 0, "acted_this_street": False},
            {"status": "all_in", "current_bet": 120, "acted_this_street": True},
        ]
        self.assertTrue(is_betting_round_complete(players))

    def test_raise_reopens_action_for_other_actionable_players(self):
        players = [
            {"status": "active", "acted_this_street": True},
            {"status": "active", "acted_this_street": True},
            {"status": "active", "acted_this_street": True},
        ]
        reset_acted_this_street_for_raise(players, actor_index=1)
        self.assertFalse(players[0]["acted_this_street"])
        self.assertTrue(players[1]["acted_this_street"])
        self.assertFalse(players[2]["acted_this_street"])

    def test_tournament_survivors_are_stack_based_only(self):
        players = [
            {"user_id": "a", "stack": 500, "status": "busted"},
            {"user_id": "b", "stack": 0, "status": "waiting"},
            {"user_id": "c", "stack": 1200, "status": "waiting"},
        ]
        survivors = tournament_survivors(players)
        survivor_ids = {p["user_id"] for p in survivors}
        self.assertEqual(survivor_ids, {"a", "c"})


if __name__ == "__main__":
    unittest.main()
