"""Player-created redeem codes: deduct on create, IP/alt block, refund on cancel."""
from __future__ import annotations

import copy
import re
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import server  # noqa: F401 — router import order

from utils import player_redeem_codes as prc
from utils.player_redeem_codes import (
    PlayerRedeemError,
    SAME_IP_DETAIL,
    parse_player_rewards,
    player_code_ip_blocked,
    rewards_inc_map,
)
from utils.redeem_code_lifecycle import RedeemCodeError, apply_redeem_code, release_redeem_slots_for_deceased_user


class _UpdateResult:
    def __init__(self, matched=0, modified=0):
        self.matched_count = matched
        self.modified_count = modified
        self.deleted_count = 0


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_a, **_k):
        return self

    def limit(self, n):
        self.rows = self.rows[:n]
        return self

    async def to_list(self, n):
        return self.rows[:n]

    def __aiter__(self):
        async def _gen():
            for row in self.rows:
                yield row

        return _gen()


def _get_path(doc, key):
    if "." not in key:
        return doc.get(key)
    parts = key.split(".")
    cur = doc
    for p in parts:
        if isinstance(cur, list):
            return [c.get(p) if isinstance(c, dict) else None for c in cur]
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
    return cur


def _match(doc, query):
    if not query:
        return True
    for k, v in query.items():
        if k == "$or":
            if not any(_match(doc, part) for part in v):
                return False
            continue
        if k == "$and":
            if not all(_match(doc, part) for part in v):
                return False
            continue
        if isinstance(v, dict) and any(str(op).startswith("$") for op in v):
            actual = _get_path(doc, k)
            if "$gte" in v:
                if actual is None or actual < v["$gte"]:
                    return False
            if "$gt" in v and (actual is None or actual <= v["$gt"]):
                return False
            if "$lt" in v and not (actual is not None and actual < v["$lt"]):
                return False
            if "$ne" in v and actual == v["$ne"]:
                return False
            if "$in" in v:
                allowed = list(v["$in"])
                if isinstance(actual, list):
                    if not any(x in allowed for x in actual):
                        return False
                elif actual not in allowed:
                    return False
            if "$nin" in v:
                banned = list(v["$nin"])
                if isinstance(actual, list):
                    if any(x in banned for x in actual):
                        return False
                elif actual in banned:
                    return False
            if "$exists" in v:
                exists = k in doc
                if bool(v["$exists"]) != exists:
                    return False
            continue
        if isinstance(v, re.Pattern):
            if not v.match(str(_get_path(doc, k) or "")):
                return False
            continue
        if _get_path(doc, k) != v:
            return False
    return True


def _apply_update(doc, upd):
    if "$inc" in upd:
        for fk, dv in upd["$inc"].items():
            doc[fk] = int(doc.get(fk) or 0) + int(dv)
    if "$set" in upd:
        doc.update(upd["$set"])
    if "$unset" in upd:
        for fk in upd["$unset"]:
            doc.pop(fk, None)
    if "$push" in upd:
        for fk, val in upd["$push"].items():
            doc.setdefault(fk, [])
            doc[fk].append(val)
    if "$pull" in upd:
        for fk, val in upd["$pull"].items():
            doc[fk] = [x for x in (doc.get(fk) or []) if x != val]
    if "$addToSet" in upd:
        for fk, val in upd["$addToSet"].items():
            if isinstance(val, dict) and "$each" in val:
                doc.setdefault(fk, [])
                for item in val["$each"]:
                    if item not in doc[fk]:
                        doc[fk].append(item)
            else:
                doc.setdefault(fk, [])
                if val not in doc[fk]:
                    doc[fk].append(val)


class MemCol:
    def __init__(self, docs=None):
        self.docs = [copy.deepcopy(d) for d in (docs or [])]

    async def find_one(self, q=None, proj=None):
        for d in self.docs:
            if _match(d, q or {}):
                return copy.deepcopy(d)
        return None

    async def find_one_and_update(self, q, upd):
        for d in self.docs:
            if _match(d, q):
                original = copy.deepcopy(d)
                _apply_update(d, upd)
                return original
        return None

    async def update_one(self, q, upd):
        for d in self.docs:
            if _match(d, q):
                before = copy.deepcopy(d)
                _apply_update(d, upd)
                changed = before != d
                return _UpdateResult(matched=1, modified=1 if changed else 0)
        return _UpdateResult(0, 0)

    async def update_many(self, q, upd):
        n = 0
        for d in self.docs:
            if _match(d, q):
                _apply_update(d, upd)
                n += 1
        return _UpdateResult(n, n)

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("code") or doc.get("id"))

    async def count_documents(self, q=None):
        return sum(1 for d in self.docs if _match(d, q or {}))

    def find(self, q=None, proj=None):
        return _Cursor([copy.deepcopy(d) for d in self.docs if _match(d, q or {})])


class MemDB:
    def __init__(self):
        self.users = MemCol()
        self.redeem_codes = MemCol()
        self.point_ledger_events = MemCol()
        self.activity_log = MemCol()
        self.notifications = MemCol()


def _user(**kwargs):
    base = {
        "id": "u1",
        "username": "Alice",
        "money": 1000,
        "points": 50,
        "xp_crimes_tokens": 10,
        "mission_skip_tokens": 2,
        "robot_bodyguard_hire_tokens": 1,
        "rank_xp_pass_tokens": 3,
        "is_dead": False,
        "is_npc": False,
        "registration_ip": "1.1.1.1",
        "last_login_ip": "1.1.1.1",
        "last_request_ip": "1.1.1.1",
        "login_ips": ["1.1.1.1"],
        "redeemed_codes": [],
    }
    base.update(kwargs)
    return base


class TestParseRewards(unittest.TestCase):
    def test_rejects_game_pass(self):
        with self.assertRaises(PlayerRedeemError):
            parse_player_rewards(tokens={"rank_xp_pass": 1})

    def test_rejects_empty(self):
        with self.assertRaises(PlayerRedeemError):
            parse_player_rewards(money=0, points=0, tokens={})

    def test_accepts_mix(self):
        rewards = parse_player_rewards(
            money=100,
            points=5,
            tokens={"xp_crimes": 10, "mission_skip": 1, "robot_bodyguard_hire": 1},
        )
        self.assertEqual(rewards["money"], 100)
        self.assertEqual(rewards["tokens"]["xp_crimes"], 10)
        self.assertEqual(rewards["tokens"]["mission_skip"], 1)
        inc = rewards_inc_map(rewards, sign=-1)
        self.assertEqual(inc["money"], -100)
        self.assertEqual(inc["xp_crimes_tokens"], -10)
        self.assertEqual(inc["mission_skip_tokens"], -1)
        self.assertEqual(inc["robot_bodyguard_hire_tokens"], -1)


class TestPlayerRedeemFlow(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = MemDB()
        self.alice = _user()
        self.bob = _user(
            id="u2",
            username="Bob",
            money=0,
            points=0,
            xp_crimes_tokens=0,
            mission_skip_tokens=0,
            robot_bodyguard_hire_tokens=0,
            rank_xp_pass_tokens=0,
            registration_ip="8.8.8.8",
            last_login_ip="8.8.8.8",
            last_request_ip="8.8.8.8",
            login_ips=["8.8.8.8"],
        )
        self.db.users.docs = [self.alice, self.bob]
        self.log_patch = patch.object(prc, "_log", new=AsyncMock())
        self.notify_patch = patch.object(prc, "_notify", new=AsyncMock())
        self.points_patch = patch("utils.point_provenance.log_points_event", new=AsyncMock())
        self.log_patch.start()
        self.notify_patch.start()
        self.points_patch.start()

    async def asyncTearDown(self):
        self.log_patch.stop()
        self.notify_patch.stop()
        self.points_patch.stop()

    async def test_create_deducts_and_redeem_grants(self):
        created = await prc.create_player_redeem_code(
            self.db,
            creator=self.alice,
            money=200,
            points=5,
            tokens={"xp_crimes": 3, "mission_skip": 1},
            request_ip="1.1.1.1",
        )
        alice = await self.db.users.find_one({"id": "u1"})
        self.assertEqual(alice["money"], 800)
        self.assertEqual(alice["points"], 45)
        self.assertEqual(alice["xp_crimes_tokens"], 7)
        self.assertEqual(alice["mission_skip_tokens"], 1)
        self.assertTrue(created["code"].startswith("P-"))

        granted = await apply_redeem_code(
            self.db,
            self.bob,
            created["code"],
            request_ip="8.8.8.8",
        )
        bob = await self.db.users.find_one({"id": "u2"})
        self.assertEqual(bob["money"], 200)
        self.assertEqual(bob["points"], 5)
        self.assertEqual(bob["xp_crimes_tokens"], 3)
        self.assertEqual(bob["mission_skip_tokens"], 1)
        self.assertTrue(any("cash" in g for g in granted["granted"]))
        code_doc = await self.db.redeem_codes.find_one({"code": created["code"]})
        self.assertFalse(code_doc["active"])
        self.assertEqual(code_doc["used_count"], 1)

    async def test_cannot_redeem_own_code(self):
        created = await prc.create_player_redeem_code(
            self.db,
            creator=self.alice,
            tokens={"xp_crimes": 1},
            request_ip="1.1.1.1",
        )
        with self.assertRaises(RedeemCodeError) as raised:
            await apply_redeem_code(self.db, self.alice, created["code"], request_ip="1.1.1.1")
        self.assertIn("you created", str(raised.exception).lower())

    async def test_same_ip_blocked(self):
        created = await prc.create_player_redeem_code(
            self.db,
            creator=self.alice,
            tokens={"xp_crimes": 1},
            request_ip="1.1.1.1",
        )
        self.bob["last_request_ip"] = "1.1.1.1"
        self.bob["login_ips"] = ["1.1.1.1"]
        await self.db.users.update_one({"id": "u2"}, {"$set": {
            "last_request_ip": "1.1.1.1",
            "login_ips": ["1.1.1.1"],
        }})
        bob = await self.db.users.find_one({"id": "u2"})
        with self.assertRaises(RedeemCodeError) as raised:
            await apply_redeem_code(self.db, bob, created["code"], request_ip="1.1.1.1")
        self.assertEqual(str(raised.exception), SAME_IP_DETAIL)
        alice = await self.db.users.find_one({"id": "u1"})
        self.assertEqual(alice["xp_crimes_tokens"], 9)

    async def test_alive_alt_on_same_ip_blocked_at_create(self):
        alt = _user(
            id="u3",
            username="Alt",
            registration_ip="1.1.1.1",
            last_login_ip="1.1.1.1",
            last_request_ip="1.1.1.1",
            login_ips=["1.1.1.1"],
            money=0,
            points=0,
            xp_crimes_tokens=0,
        )
        self.db.users.docs.append(alt)
        with self.assertRaises(PlayerRedeemError) as raised:
            await prc.create_player_redeem_code(
                self.db,
                creator=self.alice,
                tokens={"xp_crimes": 1},
                target_username="Alt",
                request_ip="1.1.1.1",
            )
        self.assertEqual(str(raised.exception), SAME_IP_DETAIL)
        alice = await self.db.users.find_one({"id": "u1"})
        self.assertEqual(alice["xp_crimes_tokens"], 10)

    async def test_cancel_refunds(self):
        created = await prc.create_player_redeem_code(
            self.db,
            creator=self.alice,
            money=100,
            tokens={"xp_crimes": 2},
            request_ip="1.1.1.1",
        )
        await prc.cancel_player_redeem_code(self.db, user=self.alice, code=created["code"])
        alice = await self.db.users.find_one({"id": "u1"})
        self.assertEqual(alice["money"], 1000)
        self.assertEqual(alice["xp_crimes_tokens"], 10)
        code_doc = await self.db.redeem_codes.find_one({"code": created["code"]})
        self.assertFalse(code_doc["active"])

    async def test_insufficient_tokens(self):
        with self.assertRaises(PlayerRedeemError):
            await prc.create_player_redeem_code(
                self.db,
                creator=self.alice,
                tokens={"xp_crimes": 99},
                request_ip="1.1.1.1",
            )

    async def test_request_ip_blocks_even_if_docs_differ(self):
        blocked = await player_code_ip_blocked(
            self.db,
            creator=self.alice,
            redeemer=self.bob,
            request_ip="1.1.1.1",
        )
        self.assertTrue(blocked)

    async def test_different_ips_allowed(self):
        blocked = await player_code_ip_blocked(
            self.db,
            creator=self.alice,
            redeemer=self.bob,
            request_ip="8.8.8.8",
        )
        self.assertFalse(blocked)

    async def test_death_does_not_release_player_code(self):
        created = await prc.create_player_redeem_code(
            self.db,
            creator=self.alice,
            tokens={"xp_crimes": 1},
            request_ip="1.1.1.1",
        )
        await apply_redeem_code(self.db, self.bob, created["code"], request_ip="8.8.8.8")
        await release_redeem_slots_for_deceased_user(self.db, "u2")
        code_doc = await self.db.redeem_codes.find_one({"code": created["code"]})
        self.assertEqual(code_doc["used_count"], 1)
        self.assertIn("u2", code_doc.get("used_by") or [])

    async def test_staff_code_unaffected_by_player_ip_rules(self):
        self.db.redeem_codes.docs.append({
            "code": "STAFF1",
            "rewards": {"money": 50},
            "max_uses": 10,
            "used_count": 0,
            "used_by": [],
            "active": True,
        })
        out = await apply_redeem_code(self.db, self.bob, "STAFF1", request_ip="1.1.1.1")
        self.assertTrue(out["granted"])
        bob = await self.db.users.find_one({"id": "u2"})
        self.assertEqual(bob["money"], 50)


if __name__ == "__main__":
    unittest.main()
