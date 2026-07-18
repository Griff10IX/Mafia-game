import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

import server  # noqa: F401 - establish the application's normal router import order
from routers.game import families


class _Cursor:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def to_list(self, _length):
        return self.rows


class _Collection:
    def __init__(self, *, find_one=None, find=None):
        self.find_one = AsyncMock(return_value=find_one)
        self.find = unittest.mock.Mock(return_value=_Cursor(find))


class _DB:
    pass


class FamilyIdentityLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_scalar_resolution_rejects_wiped_user_pointer(self):
        fake = _DB()
        fake.users = _Collection(find_one={"family_id": "memorial"})
        fake.family_members = _Collection(find_one=None)
        fake.families = _Collection(find_one=None)

        with patch.object(families, "db", fake):
            self.assertIsNone(await families.resolve_family_id("user-1"))

        active_check = fake.families.find_one.await_args_list[0].args[0]
        self.assertEqual(
            active_check,
            {
                "id": "memorial",
                "wiped": {"$ne": True},
                "provisioning": {"$ne": True},
            },
        )

    async def test_exact_wiped_lookup_uses_snapshot_without_live_roster(self):
        memorial = {
            "id": "family-old",
            "name": "Old Crew",
            "tag": "OLD",
            "wiped": True,
            "wiped_at": "2026-01-01T00:00:00+00:00",
            "memorial_roster": [
                {
                    "user_id": "u1",
                    "username": "Fallen",
                    "role": "boss",
                    "rank": 1,
                    "is_dead": True,
                    "dead_at": "2026-01-01T00:00:00+00:00",
                }
            ],
        }
        fake = _DB()
        fake.families = _Collection(find_one=memorial)
        fake.family_members = _Collection()

        with patch.object(families, "db", fake):
            result = await families.families_lookup(id="family-old", current_user={"id": "viewer"})

        self.assertTrue(result["wiped"])
        self.assertEqual(result["members"], [])
        self.assertEqual(result["fallen"][0]["username"], "Fallen")
        fake.family_members.find_one.assert_not_awaited()

    async def test_legacy_tag_lookup_is_active_only(self):
        fake = _DB()
        fake.families = _Collection(find_one=None)

        with patch.object(families, "db", fake):
            with self.assertRaises(HTTPException) as raised:
                await families.families_lookup(tag="old", current_user={"id": "viewer"})

        self.assertEqual(raised.exception.status_code, 404)
        query = fake.families.find_one.await_args.args[0]
        self.assertEqual(
            query,
            {
                "tag": "OLD",
                "wiped": {"$ne": True},
                "provisioning": {"$ne": True},
            },
        )
        self.assertNotIn("$or", query)

    async def test_concurrent_wipe_claim_allows_only_one_settlement(self):
        original = {"id": "family-old", "name": "Old Crew", "wiped": False}
        fake = _DB()
        fake.families = SimpleNamespace(
            find_one_and_update=AsyncMock(side_effect=[original, None]),
        )
        fake.users = SimpleNamespace(update_one=AsyncMock())
        fake.family_members = SimpleNamespace(delete_many=AsyncMock())
        fake.family_join_applications = SimpleNamespace(delete_many=AsyncMock())
        fake.family_crew_oc_applications = SimpleNamespace(delete_many=AsyncMock())
        fake.properties = SimpleNamespace(delete_many=AsyncMock())

        with (
            patch.object(families, "db", fake),
            patch.object(families, "_build_memorial_roster", AsyncMock(return_value=[])),
        ):
            results = await asyncio.gather(
                families.claim_family_wipe("family-old", wiped_at="2026-01-01T00:00:00+00:00"),
                families.claim_family_wipe("family-old", wiped_at="2026-01-01T00:00:00+00:00"),
            )

        self.assertEqual(sum(result is not None for result in results), 1)
        fake.family_members.delete_many.assert_awaited_once_with({"family_id": "family-old"})
        fake.properties.delete_many.assert_awaited_once()
