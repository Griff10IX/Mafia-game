import ast
import sys
import unittest
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from utils.point_provenance import (  # noqa: E402
    POINT_AUDIT_SCHEMA_VERSION,
    apply_points_delta_with_audit,
    log_points_event,
    record_points_audit_event,
)
from utils.point_sources_breakdown import (  # noqa: E402
    audit_anomaly_flags,
    build_audit_narrative,
    build_detailed_points_audit,
    decode_audit_cursor,
    encode_audit_cursor,
    parse_audit_datetime,
)


class _InsertCollection:
    def __init__(self):
        self.documents = []

    async def insert_one(self, document, **kwargs):
        self.documents.append(document)

    async def update_one(self, query, update, upsert=False, **kwargs):
        for document in self.documents:
            if all(document.get(key) == value for key, value in query.items()):
                return type("_Result", (), {"upserted_id": None})()
        document = dict(update.get("$setOnInsert") or {})
        self.documents.append(document)
        return type("_Result", (), {"upserted_id": document.get("id")})()

    async def find_one(self, query, projection=None, **kwargs):
        for document in self.documents:
            if all(document.get(key) == value for key, value in query.items()):
                return dict(document)
        return None


class _UsersCollection:
    def __init__(self, user):
        self.user = dict(user) if user else None

    async def find_one(self, query, projection=None, **kwargs):
        if self.user and self.user.get("id") == query.get("id"):
            return dict(self.user)
        return None

    async def find_one_and_update(self, query, update, **kwargs):
        if not self.user or self.user.get("id") != query.get("id"):
            return None
        points_condition = query.get("points")
        if isinstance(points_condition, dict) and "$gte" in points_condition:
            if self.user["points"] < points_condition["$gte"]:
                return None
        before = dict(self.user)
        self.user["points"] += update["$inc"]["points"]
        return before


class _Db:
    def __init__(self, user=None):
        self.users = _UsersCollection(user)
        self.point_audit_events = _InsertCollection()
        self.point_ledger_events = _InsertCollection()


class TestPointAuditHelpers(unittest.IsolatedAsyncioTestCase):
    async def test_records_normalized_logical_event_without_fifo_side_effect(self):
        db = _Db({"id": "u1", "username": "Jake", "points": 125})
        event = await record_points_audit_event(
            db,
            user_id="u1",
            username="Jake",
            delta=25,
            wallet_points_before=100,
            wallet_points_after=125,
            source="admin",
            event_type="manual_grant",
            transaction_id="txn-1",
            origin="staff_tool",
            origin_ref="ticket-9",
            actor={"id": "staff-1", "username": "Mod"},
            counterparty={"id": "u2", "username": "Other"},
            context={"reason": "appeal"},
            meta={"ip": "127.0.0.1"},
        )

        self.assertEqual(event["correlation_id"], "txn-1")
        self.assertEqual(event["transaction_id"], "txn-1")
        self.assertEqual(event["delta"], 25)
        self.assertEqual(event["wallet_points_before"], 100)
        self.assertEqual(event["wallet_points_after"], 125)
        self.assertEqual(event["counterparty_id"], "u2")
        self.assertEqual(event["schema_version"], POINT_AUDIT_SCHEMA_VERSION)
        self.assertEqual(len(db.point_audit_events.documents), 1)
        self.assertEqual(db.point_ledger_events.documents, [])

    async def test_rejects_inexact_before_after(self):
        db = _Db({"id": "u1", "username": "Jake", "points": 125})
        with self.assertRaises(ValueError):
            await record_points_audit_event(
                db,
                user_id="u1",
                delta=25,
                wallet_points_before=100,
                wallet_points_after=124,
                source="test",
                event_type="bad_math",
            )

    async def test_atomic_delta_records_exact_returned_balance(self):
        db = _Db({"id": "u1", "username": "Jake", "points": 100})
        result = await apply_points_delta_with_audit(
            db,
            user_id="u1",
            delta=-30,
            user_filter={"points": {"$gte": 30}},
            source="store",
            event_type="purchase",
            correlation_id="order-1",
            origin_ref="sku-1",
        )

        self.assertEqual(db.users.user["points"], 70)
        self.assertEqual(result["wallet_points_before"], 100)
        self.assertEqual(result["wallet_points_after"], 70)
        self.assertEqual(result["audit_event"]["delta"], -30)

    async def test_failed_condition_does_not_record_event(self):
        db = _Db({"id": "u1", "username": "Jake", "points": 20})
        result = await apply_points_delta_with_audit(
            db,
            user_id="u1",
            delta=-30,
            user_filter={"points": {"$gte": 30}},
            source="store",
            event_type="purchase",
        )

        self.assertIsNone(result)
        self.assertEqual(db.users.user["points"], 20)
        self.assertEqual(db.point_audit_events.documents, [])

    async def test_legacy_log_bridges_once_with_exact_snapshot(self):
        db = _Db({"id": "u1", "username": "Jake", "points": 70})
        kwargs = {
            "user_id": "u1",
            "points": -30,
            "event_type": "spend_store",
            "event_ref": "order-1",
            "meta": {"source": "store", "item": "silencer"},
            "wallet_points_before": 100,
            "wallet_points_after": 70,
        }

        await log_points_event(db, **kwargs)
        await log_points_event(db, **kwargs)

        self.assertEqual(len(db.point_ledger_events.documents), 2)
        self.assertEqual(len(db.point_audit_events.documents), 1)
        event = db.point_audit_events.documents[0]
        self.assertEqual(event["source"], "store")
        self.assertEqual(event["wallet_points_before"], 100)
        self.assertEqual(event["wallet_points_after"], 70)

    async def test_legacy_inconsistent_snapshot_is_not_claimed_as_wallet_exact(self):
        db = _Db({"id": "u1", "username": "Jake", "points": 100})
        await log_points_event(
            db,
            user_id="u1",
            points=-20,
            event_type="entertainer_mdg_fund",
            event_ref="create:g1",
            wallet_points_before=100,
            wallet_points_after=100,
        )

        event = db.point_audit_events.documents[0]
        self.assertIsNone(event["wallet_points_before"])
        self.assertIsNone(event["wallet_points_after"])


class TestDetailedPointAuditPresentation(unittest.TestCase):
    def test_p2p_narrative_names_both_players_and_balance(self):
        narrative = build_audit_narrative(
            {
                "user_id": "recipient",
                "username": "Bob",
                "source": "p2p",
                "event_type": "transfer_in",
                "delta": 25,
                "wallet_points_before": 100,
                "wallet_points_after": 125,
                "counterparty": {"id": "sender", "username": "Alice"},
            }
        )
        self.assertIn("Alice sent 25 points to Bob", narrative)
        self.assertIn("100 → 125", narrative)

    def test_prestige_level_points_narrative(self):
        from utils.point_sources_breakdown import label_for_event_type

        self.assertEqual(label_for_event_type("prestige_level_points"), "Prestige level reward")
        narrative = build_audit_narrative(
            {
                "username": "Venus",
                "source": "prestige",
                "event_type": "prestige_level_points",
                "delta": 6000,
                "wallet_points_before": 1000,
                "wallet_points_after": 7000,
                "context": {
                    "levels_from": 1,
                    "levels_to": 2,
                    "reason": "backfill",
                },
            }
        )
        self.assertIn("Prestige level reward", narrative)
        self.assertIn("6,000 points", narrative)
        self.assertIn("P1–P2", narrative)
        self.assertIn("backfill", narrative)
        self.assertIn("1,000 → 7,000", narrative)

    def test_quicktrade_and_mdg_narratives_label_unknowns(self):
        quicktrade = build_audit_narrative(
            {
                "user_id": "buyer",
                "username": "Buyer",
                "source": "quicktrade",
                "event_type": "quicktrade_buy",
                "delta": 500,
                "counterparty": {"username": "Seller"},
                "context": {"cost_cash": 1000000},
            }
        )
        self.assertIn("Buyer", quicktrade)
        self.assertIn("Seller", quicktrade)
        self.assertIn("$1,000,000 cash", quicktrade)
        self.assertIn("Unknown (legacy record)", quicktrade)

        mdg = build_audit_narrative(
            {
                "user_id": "winner",
                "source": "casino",
                "event_type": "casino_mdg",
                "delta": 300,
                "wallet_points_before": 50,
                "wallet_points_after": 350,
                "context": {
                    "result": "won",
                    "stake_points": 100,
                    "payout_points": 300,
                    "opponents": [{"id": "other", "username": "Rival"}],
                },
            }
        )
        self.assertIn("MDG vs Rival", mdg)
        self.assertIn("stake 100 points", mdg)
        self.assertIn("payout 300 points", mdg)

    def test_anomalies_cover_math_negative_chain_duplicates_and_incomplete(self):
        flags = audit_anomaly_flags(
            {
                "delta": -20,
                "wallet_points_before": 10,
                "wallet_points_after": -5,
            },
            duplicate_key=True,
            duplicate_reference=True,
            chain_gap=True,
        )
        self.assertEqual(
            set(flags),
            {
                "before_delta_mismatch",
                "negative_balance",
                "balance_chain_gap",
                "duplicate_normalized_event_key",
                "duplicate_reference",
            },
        )
        self.assertEqual(
            audit_anomaly_flags({"delta": 10, "wallet_points_before": None, "wallet_points_after": None}),
            ["incomplete_snapshot"],
        )

    def test_cursor_round_trip_and_date_end_of_day(self):
        created = parse_audit_datetime("2026-08-08T22:15:00Z")
        cursor = encode_audit_cursor(created, "event-9")
        decoded_time, decoded_id = decode_audit_cursor(cursor)
        self.assertEqual(decoded_time, created)
        self.assertEqual(decoded_id, "event-9")
        self.assertEqual(parse_audit_datetime("2026-08-08", end_of_day=True).hour, 23)
        with self.assertRaises(ValueError):
            decode_audit_cursor("not-a-valid-cursor")


class _AuditCursor:
    def __init__(self, documents):
        self.documents = [dict(document) for document in documents]
        self._limit = None

    def sort(self, *args):
        return self

    def skip(self, amount):
        self.documents = self.documents[amount:]
        return self

    def limit(self, amount):
        self._limit = amount
        return self

    async def to_list(self, amount):
        limit = min(amount, self._limit) if self._limit is not None else amount
        return [dict(document) for document in self.documents[:limit]]


class _AuditHistoryCollection:
    def __init__(self, documents=None):
        self.documents = list(documents or [])

    def find(self, query, projection=None):
        return _AuditCursor(self.documents)

    def aggregate(self, pipeline):
        return _AuditCursor([])


class _HistoricalAuditDb:
    def __init__(self):
        self.collections = {
            "point_audit_events": _AuditHistoryCollection([]),
            "points_transfers": _AuditHistoryCollection(
                [
                    {
                        "id": "transfer-old",
                        "from_user_id": "sender",
                        "from_username": "Alice",
                        "to_user_id": "target",
                        "to_username": "Bob",
                        "amount": 40,
                        "sender_points_before": 90,
                        "sender_points_after": 50,
                        "recipient_points_before": 10,
                        "recipient_points_after": 50,
                        "created_at": "2025-01-02T12:00:00+00:00",
                    }
                ]
            ),
            "point_ledger_events": _AuditHistoryCollection(
                [
                    {
                        "id": "ledger-old",
                        "user_id": "target",
                        "event_type": "objectives_claim",
                        "points": 15,
                        "origin_ref": "objective-old",
                        "meta": {"objective": "legacy"},
                        "created_at": "2025-01-01T12:00:00+00:00",
                    }
                ]
            ),
        }
        for name in (
            "payment_transactions",
            "gambling_log",
            "trade_events",
            "store_points_purchase_logs",
            "mdg_games",
        ):
            self.collections.setdefault(name, _AuditHistoryCollection([]))

    def __getitem__(self, name):
        return self.collections.setdefault(name, _AuditHistoryCollection([]))

    def __getattr__(self, name):
        return self[name]


class TestHistoricalDetailedPointAudit(unittest.IsolatedAsyncioTestCase):
    async def test_old_transfer_and_ledger_appear_without_canonical_events(self):
        result = await build_detailed_points_audit(_HistoricalAuditDb(), "target", limit=20)
        items = result["items"]

        self.assertEqual(len(items), 2)
        by_origin = {item["origin"]["name"]: item for item in items}
        transfer = by_origin["legacy:points_transfers"]
        self.assertEqual(transfer["delta"], 40)
        self.assertEqual(transfer["wallet_points_before"], 10)
        self.assertEqual(transfer["wallet_points_after"], 50)
        self.assertTrue(transfer["synthetic"])
        self.assertTrue(transfer["legacy"])
        self.assertFalse(transfer["incomplete"])
        self.assertIn("Alice sent 40 points to Bob", transfer["narrative"])

        ledger = by_origin["legacy:point_ledger_events"]
        self.assertEqual(ledger["delta"], 15)
        self.assertTrue(ledger["synthetic"])
        self.assertTrue(ledger["legacy"])
        self.assertTrue(ledger["incomplete"])
        self.assertEqual(
            ledger["unknown_fields"],
            ["wallet_points_before", "wallet_points_after"],
        )
        self.assertIn("Unknown (legacy record)", ledger["narrative"])


class TestFlowAuditNarrativesAndCorrelation(unittest.TestCase):
    """Representative Venus-style narratives across primary point flows."""

    def test_p2p_admin_store_quicktrade_mdg_shapes(self):
        p2p = build_audit_narrative(
            {
                "username": "Venus",
                "source": "p2p",
                "event_type": "transfer_in",
                "delta": 50000,
                "wallet_points_before": 50000,
                "wallet_points_after": 100000,
                "counterparty": {"username": "Highlights"},
                "context": {"from_username": "Highlights", "to_username": "Venus"},
            }
        )
        self.assertEqual(
            p2p,
            "Highlights sent 50,000 points to Venus; balance 50,000 → 100,000.",
        )

        admin = build_audit_narrative(
            {
                "username": "Venus",
                "source": "admin",
                "event_type": "admin_add_points",
                "delta": 1000,
                "wallet_points_before": 100000,
                "wallet_points_after": 101000,
                "origin_ref": "admin:staff-1",
                "transaction_id": "corr-admin",
            }
        )
        self.assertIn("Admin grant", admin)
        self.assertIn("1,000 points", admin)
        self.assertIn("100,000 → 101,000", admin)

        store = build_audit_narrative(
            {
                "username": "Venus",
                "source": "store",
                "event_type": "spend_store",
                "delta": -250,
                "wallet_points_before": 101000,
                "wallet_points_after": 100750,
                "origin_ref": "buy-silencer",
                "context": {"store_item": "buy-silencer"},
            }
        )
        self.assertIn("Store spend", store)
        self.assertIn("debited 250 points", store)
        self.assertIn("buy-silencer", store)

        qt = build_audit_narrative(
            {
                "username": "Venus",
                "source": "quicktrade",
                "event_type": "quicktrade_buy",
                "delta": 10000,
                "wallet_points_before": 90000,
                "wallet_points_after": 100000,
                "counterparty": {"username": "GhostFace"},
                "context": {
                    "cost_cash": 500000000,
                    "seller_username": "GhostFace",
                    "buyer_username": "Venus",
                },
                "correlation_id": "qt-offer-1",
            }
        )
        self.assertIn("Venus bought 10,000 points from GhostFace", qt)
        self.assertIn("$500,000,000 cash", qt)
        self.assertIn("90,000 → 100,000", qt)

        mdg = build_audit_narrative(
            {
                "username": "Venus",
                "user_id": "venus",
                "source": "casino_mdg",
                "event_type": "casino_mdg",
                "delta": 20000,
                "wallet_points_before": 100000,
                "wallet_points_after": 120000,
                "context": {
                    "result": "won",
                    "stake_points": 10000,
                    "payout_points": 20000,
                    "opponents": [{"id": "gf", "username": "GhostFace"}],
                    "game_id": "mdg-9",
                },
                "correlation_id": "mdg-9",
            }
        )
        self.assertIn("MDG vs GhostFace", mdg)
        self.assertIn("stake 10,000 points", mdg)
        self.assertIn("payout 20,000 points", mdg)
        self.assertIn("100,000 → 120,000", mdg)

    def test_linked_correlation_id_shared_by_transfer_legs(self):
        correlation = "xfer-venus-1"
        sender = {
            "source": "p2p",
            "event_type": "transfer_out",
            "delta": -50000,
            "correlation_id": correlation,
            "username": "Highlights",
            "counterparty": {"username": "Venus"},
            "context": {"from_username": "Highlights", "to_username": "Venus"},
            "wallet_points_before": 150000,
            "wallet_points_after": 100000,
        }
        recipient = {
            "source": "p2p",
            "event_type": "transfer_in",
            "delta": 50000,
            "correlation_id": correlation,
            "username": "Venus",
            "counterparty": {"username": "Highlights"},
            "context": {"from_username": "Highlights", "to_username": "Venus"},
            "wallet_points_before": 50000,
            "wallet_points_after": 100000,
        }
        self.assertEqual(sender["correlation_id"], recipient["correlation_id"])
        self.assertIn("Highlights sent 50,000 points to Venus", build_audit_narrative(sender))
        self.assertIn("Highlights sent 50,000 points to Venus", build_audit_narrative(recipient))


# Migration baseline for later Detailed Points Audit todos. New direct users.points
# mutation locations fail this test; existing locations remain visible until callers
# are migrated to the utility and removed from this temporary allowlist.
TEMPORARY_DIRECT_POINTS_MUTATION_ALLOWLIST = {
    "routers/admin/admin.py",
    "routers/admin/airport.py",
    "routers/cars/gta.py",
    "routers/casinos/blackjack.py",
    "routers/casinos/dice.py",
    "routers/casinos/horseracing.py",
    "routers/casinos/mdg.py",
    "routers/casinos/mp_8ball.py",
    "routers/casinos/mp_poker.py",
    "routers/casinos/roulette.py",
    "routers/casinos/slots.py",
    "routers/casinos/sports_betting.py",
    "routers/casinos/video_poker.py",
    "routers/crime/jail.py",
    "routers/crime/oc.py",
    "routers/account/objectives.py",
    "routers/game/designer_competitions.py",
    "routers/game/dead_alive.py",
    "routers/game/families.py",
    "routers/game/store.py",
    "routers/kill/attack.py",
    "routers/kill/armoury.py",
    "routers/kill/bodyguards.py",
    "routers/kill/hitlist.py",
    "routers/kill/hitman.py",
    "routers/money/booze_run.py",
    "routers/money/illegal_business.py",
    "routers/money/properties.py",
    "routers/money/quicktrade.py",
    "routers/money/stock_market.py",
    "server.py",
    "utils/entertainer_service.py",
    "utils/point_provenance.py",
    "utils/referral_weekly_points.py",
    "utils/server_backup.py",
}


def _is_users_collection(node):
    if isinstance(node, ast.Attribute):
        return node.attr == "users"
    if isinstance(node, ast.Subscript):
        key = node.slice
        return isinstance(key, ast.Constant) and key.value == "users"
    return False


def _direct_points_mutation_files():
    mutation_methods = {
        "update_one",
        "update_many",
        "find_one_and_update",
        "replace_one",
        "bulk_write",
    }
    found = set()
    for path in BACKEND.rglob("*.py"):
        if "tests" in path.parts:
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                continue
            if node.func.attr not in mutation_methods or not _is_users_collection(node.func.value):
                continue
            positional_start = 0 if node.func.attr == "bulk_write" else 1
            update_nodes = list(node.args[positional_start:]) + [
                kw.value
                for kw in node.keywords
                if kw.arg in {"update", "replacement", "requests", "operations"}
            ]
            if any(
                isinstance(child, ast.Constant) and child.value == "points"
                for update_node in update_nodes
                for child in ast.walk(update_node)
            ):
                found.add(path.relative_to(BACKEND).as_posix())
    return found


class TestDirectPointsMutationGuard(unittest.TestCase):
    def test_no_new_direct_users_points_mutation_locations(self):
        unexpected = _direct_points_mutation_files() - TEMPORARY_DIRECT_POINTS_MUTATION_ALLOWLIST
        self.assertEqual(
            unexpected,
            set(),
            "New direct users.points mutations must use point_provenance helpers "
            "or be explicitly reviewed into the temporary migration baseline.",
        )


if __name__ == "__main__":
    unittest.main()
