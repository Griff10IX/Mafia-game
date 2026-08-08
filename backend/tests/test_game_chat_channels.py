"""Focused unit tests for shared mentions and game-chat channel isolation."""
import asyncio
from types import SimpleNamespace

import server  # Load router registration in the application's normal import order.

from routers.social.game_chat import (
    _channel_message_query,
    _mention_recipient_allowed,
    _safe_message_payload,
)
from utils.mentions import extract_mention_usernames, resolve_usernames_to_ids


def test_mentions_are_unique_case_insensitively():
    assert extract_mention_usernames(
        "Hi @Alice, @bob and again @ALICE; invalid @name-with-tail."
    ) == ["Alice", "bob", "name"]


def test_shared_resolver_returns_case_insensitive_id_map():
    class Cursor:
        async def to_list(self, _length):
            return [{"id": "user-1", "username": "Alice"}]

    users = SimpleNamespace(find=lambda _query, _projection: Cursor())
    fake_db = SimpleNamespace(users=users)
    result = asyncio.run(resolve_usernames_to_ids(fake_db, ["Alice", "ALICE"]))
    assert result == {"alice": "user-1"}


def test_global_query_includes_legacy_but_not_family_channel():
    query = _channel_message_query(
        "global",
        blocked_user_ids=["blocked-id"],
        created_since="2026-08-01T00:00:00+00:00",
    )
    channel_clause = query["$and"][0]["$or"]
    assert {"channel": "global"} in channel_clause
    assert {"channel": {"$exists": False}} in channel_clause
    assert {"channel": "family"} not in channel_clause
    assert {"user_id": {"$nin": ["blocked-id"]}} in query["$and"]


def test_family_query_requires_exact_family_and_channel():
    query = _channel_message_query("family", family_id="family-123")
    assert query == {
        "$and": [
            {"channel": "family"},
            {"family_id": "family-123"},
        ]
    }


def test_safe_payload_derives_sender_and_ownership_without_internal_ids():
    payload = _safe_message_payload(
        {
            "id": "message-1",
            "user_id": "user-1",
            "family_id": "family-secret",
            "username": "Alice",
            "message": "hello",
            "created_at": "2026-08-08T12:00:00+00:00",
        },
        "user-1",
    )
    assert payload["sender_id"] == "user-1"
    assert payload["is_own"] is True
    assert payload["channel"] == "global"
    assert "user_id" not in payload
    assert "family_id" not in payload


def test_mention_recipient_rules_cover_self_dead_blocks_and_family():
    base = {"id": "recipient", "family_id": "family-1"}
    assert _mention_recipient_allowed(
        base,
        sender_id="sender",
        channel="global",
        family_id=None,
    )
    assert not _mention_recipient_allowed(
        {**base, "id": "sender"},
        sender_id="sender",
        channel="global",
        family_id=None,
    )
    assert not _mention_recipient_allowed(
        {**base, "is_dead": True},
        sender_id="sender",
        channel="global",
        family_id=None,
    )
    assert not _mention_recipient_allowed(
        {**base, "game_chat_blocked_user_ids": ["sender"]},
        sender_id="sender",
        channel="global",
        family_id=None,
    )
    assert _mention_recipient_allowed(
        base,
        sender_id="sender",
        channel="family",
        family_id="family-1",
    )
    assert not _mention_recipient_allowed(
        base,
        sender_id="sender",
        channel="family",
        family_id="family-2",
    )
