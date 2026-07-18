import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import server  # noqa: F401 - establish normal router import order
from routers.game import families
from utils import family_daily_tasks as daily


class FamilyDailyPureTests(unittest.TestCase):
    def test_objective_and_rewards_are_stable(self):
        first = daily.objective_spec("fam-1", "2026-07-18")
        self.assertEqual(first, daily.objective_spec("fam-1", "2026-07-18"))
        self.assertIn(first["objective_type"], daily.OBJECTIVES)
        self.assertIn(len(first["reward_types"]), (2, 3))
        self.assertEqual(len(first["reward_types"]), len(set(first["reward_types"])))

    def test_objective_changes_across_family_or_period(self):
        specs = {
            (
                daily.objective_spec(f"fam-{family}", f"2026-07-{day:02d}")["objective_type"],
                tuple(daily.objective_spec(f"fam-{family}", f"2026-07-{day:02d}")["reward_types"]),
            )
            for family in range(4)
            for day in range(1, 8)
        }
        self.assertGreater(len(specs), 4)

    def test_shared_reward_caps(self):
        chosen = ("cash", "points", "loot")
        totals = {"cash": 0, "points": 0, "loot": 0}
        for completion in range(1, 101):
            amounts = daily.reward_amounts(chosen, completion)
            for key in totals:
                totals[key] += amounts[key]
        self.assertEqual(totals["cash"], 25_000_000)
        self.assertEqual(totals["points"], 50)
        self.assertEqual(totals["loot"], 20)

    def test_unselected_shared_rewards_are_zero(self):
        self.assertEqual(
            daily.reward_amounts(("tokens",), 1),
            {"cash": 0, "points": 0, "loot": 0},
        )

    def test_token_pool_is_bounded_deterministic_and_normal(self):
        qualifiers = [{"user_id": f"u-{i}"} for i in range(20)]
        first = daily._token_allocations("fam", "2026-07-18", qualifiers, 50)
        second = daily._token_allocations("fam", "2026-07-18", list(reversed(qualifiers)), 50)
        self.assertEqual(first, second)
        self.assertLessEqual(sum(sum(grants.values()) for grants in first.values()), 10)
        fields = {field for grants in first.values() for field in grants}
        self.assertTrue(fields.issubset(set(daily.NORMAL_STORE_TOKEN_FIELDS)))
        self.assertNotIn("rank_xp_pass_tokens", fields)
        self.assertNotIn("crew_oc_auto_apply_tokens", fields)

    def test_token_pool_grows_with_qualifying_members(self):
        for qualifier_count in (1, 3, 10, 15):
            qualifiers = [{"user_id": f"u-{i}"} for i in range(qualifier_count)]
            grants = daily._token_allocations("fam", "2026-07-18", qualifiers, 99)
            total = sum(sum(row.values()) for row in grants.values())
            self.assertEqual(total, min(qualifier_count, daily.TOKEN_POOL_MAX_UNITS))

    def test_late_racket_progression_scales_from_two_to_four(self):
        self.assertAlmostEqual(families._racket_progression_multiplier("protection", 1), 2.0)
        self.assertAlmostEqual(families._racket_progression_multiplier("garment_shop", 15), 4.0)
        early, _ = families._racket_income_and_cooldown("protection", 1, {})
        late, _ = families._racket_income_and_cooldown("garment_shop", 15, {})
        self.assertGreater(late, early * 20)

    def test_family_event_multiplier_handles_naive_and_expired_values(self):
        now = datetime(2026, 7, 18, tzinfo=timezone.utc)
        self.assertEqual(
            families._active_family_event_multiplier(
                {"event_active_until": (now + timedelta(hours=1)).replace(tzinfo=None).isoformat()},
                now,
            ),
            1.1,
        )
        self.assertEqual(
            families._active_family_event_multiplier(
                {"event_active_until": (now - timedelta(seconds=1)).isoformat()},
                now,
            ),
            1.0,
        )


class FamilyDailyAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_racket_breakdown_preserves_all_modifiers(self):
        now = datetime(2026, 7, 18, 12, tzinfo=timezone.utc)
        fam = {
            "racket_income_bonus_percent": 10,
            "event_active_until": (now + timedelta(hours=1)).isoformat(),
        }
        actor = {"id": "u1"}
        with (
            patch.object(families, "family_perk_modifiers", AsyncMock(return_value={"racket_bonus_percent": 5})),
            patch.object(families, "_family_war_duration_seconds", AsyncMock(return_value=0)),
            patch.object(families, "founding_member_income_mult", return_value=1.15),
        ):
            result = await families._racket_payout_breakdown(
                "protection",
                1,
                None,
                {"racket_payout": 2.0, "racket_cooldown": 0.5},
                fam,
                "fam",
                now=now,
                actor=actor,
            )
        expected = int(result["income_after_global_event"] * 1.15 * 1.15 * 1.1)
        self.assertEqual(result["final_income"], expected)
        self.assertEqual(result["available_income"], expected)
        self.assertEqual(result["global_event_multiplier"], 2.0)
        self.assertEqual(result["war_win_bonus_percent"], 10)
        self.assertEqual(result["perk_bonus_percent"], 5)
        self.assertEqual(result["founding_member_multiplier"], 1.15)
        self.assertEqual(result["family_event_multiplier"], 1.1)

    async def test_war_pause_keeps_racket_unavailable(self):
        now = datetime(2026, 7, 18, 12, tzinfo=timezone.utc)
        last = now - timedelta(minutes=9)
        with (
            patch.object(families, "family_perk_modifiers", AsyncMock(return_value={})),
            patch.object(families, "_family_war_duration_seconds", AsyncMock(return_value=120)),
        ):
            result = await families._racket_payout_breakdown(
                "protection",
                1,
                last.isoformat(),
                {},
                {},
                "fam",
                now=now,
            )
        self.assertEqual(result["available_income"], 0)
        self.assertEqual(result["war_paused_seconds"], 120)

    async def test_shared_reward_retry_does_not_increment_twice(self):
        event_id = "family-daily:fam:2026-07-18:u1:shared"
        families_collection = SimpleNamespace(
            update_one=AsyncMock(
                side_effect=[
                    SimpleNamespace(modified_count=1),
                    SimpleNamespace(modified_count=0),
                ]
            ),
            find_one=AsyncMock(return_value={"daily_reward_event_ids": [event_id]}),
        )
        reward_events = SimpleNamespace(update_one=AsyncMock())
        fake_db = SimpleNamespace(families=families_collection, family_daily_reward_events=reward_events)
        event = {
            "event_id": event_id,
            "family_id": "fam",
            "period": "2026-07-18",
            "user_id": "u1",
            "username": "One",
            "cash": 1_000_000,
            "points": 2,
            "loot": 1,
        }
        with patch.object(daily, "log_family_vault_tx", AsyncMock()) as vault_log:
            await daily._settle_shared_event(fake_db, event)
            await daily._settle_shared_event(fake_db, event)
        self.assertEqual(vault_log.await_count, 1)
        first_update = families_collection.update_one.await_args_list[0].args[1]
        self.assertEqual(first_update["$inc"]["treasury"], 1_000_000)
        self.assertEqual(first_update["$inc"]["treasury_points"], 2)
        self.assertEqual(first_update["$inc"]["treasury_loot_pieces"], 1)

    async def test_token_settlement_drops_unknown_or_premium_fields(self):
        event_id = "family-daily:fam:2026-07-18:u1:tokens"
        users = SimpleNamespace(
            update_one=AsyncMock(return_value=SimpleNamespace(modified_count=1)),
            find_one=AsyncMock(return_value={"daily_reward_event_ids": [event_id]}),
        )
        rewards = SimpleNamespace(update_one=AsyncMock())
        fake_db = SimpleNamespace(users=users, family_daily_reward_events=rewards)
        await daily._settle_token_event(
            fake_db,
            {
                "event_id": event_id,
                "user_id": "u1",
                "token_grants": {
                    "xp_crimes_tokens": 2,
                    "rank_xp_pass_tokens": 100,
                    "unknown_tokens": 100,
                },
            },
        )
        update = users.update_one.await_args.args[1]
        self.assertEqual(update["$inc"], {"xp_crimes_tokens": 2})

    async def test_invalid_activity_is_ignored_without_database_access(self):
        self.assertIsNone(await daily.record_family_daily_activity(None, "u1", "not-real", 1))
        self.assertIsNone(await daily.record_family_daily_activity(None, "u1", "crime", 0))


if __name__ == "__main__":
    unittest.main()
