"""Lifetime profile DM sent/received totals (not current inbox row counts)."""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

PROFILE_DM_SENT_FIELD = "profile_dm_sent"
PROFILE_DM_RECEIVED_FIELD = "profile_dm_received"
_DM_TYPES = ("user_message", "user_message_sent")


def _int_count(v: Any) -> int:
    try:
        return max(0, int(v or 0))
    except (TypeError, ValueError):
        return 0


def stored_profile_dm_counts(user: Optional[Dict[str, Any]]) -> Optional[Tuple[int, int]]:
    """Return (received, sent) when both lifetime fields exist; else None (needs backfill)."""
    if not user:
        return None
    if PROFILE_DM_SENT_FIELD not in user or PROFILE_DM_RECEIVED_FIELD not in user:
        return None
    return _int_count(user.get(PROFILE_DM_RECEIVED_FIELD)), _int_count(user.get(PROFILE_DM_SENT_FIELD))


async def count_dm_from_store(db, user_id: str) -> Tuple[int, int]:
    """Best-effort (received, sent) from remaining inbox rows plus deleted-message archive."""
    uid = (user_id or "").strip()
    received, sent = 0, 0
    if not uid:
        return 0, 0
    pipeline = [
        {"$match": {"user_id": uid, "notification_type": {"$in": list(_DM_TYPES)}}},
        {"$group": {"_id": "$notification_type", "n": {"$sum": 1}}},
    ]
    async for doc in db.notifications.aggregate(pipeline):
        tid = doc.get("_id")
        n = _int_count(doc.get("n"))
        if tid == "user_message":
            received = n
        elif tid == "user_message_sent":
            sent = n
    arch_pipe = [
        {
            "$match": {
                "source": "notification",
                "original.user_id": uid,
                "original.notification_type": {"$in": list(_DM_TYPES)},
            }
        },
        {"$group": {"_id": "$original.notification_type", "n": {"$sum": 1}}},
    ]
    try:
        async for doc in db.deleted_messages_archive.aggregate(arch_pipe):
            tid = doc.get("_id")
            n = _int_count(doc.get("n"))
            if tid == "user_message":
                received += n
            elif tid == "user_message_sent":
                sent += n
    except Exception:
        pass
    return received, sent


async def resolve_profile_dm_counts(db, user: Optional[Dict[str, Any]]) -> Tuple[int, int]:
    """(received, sent) for profile/hover. Backfills once onto the user doc."""
    stored = stored_profile_dm_counts(user)
    if stored is not None:
        return stored
    uid = str((user or {}).get("id") or "").strip()
    if not uid:
        return 0, 0
    received, sent = await count_dm_from_store(db, uid)
    # $max so a send that already $inc'd is not overwritten by a lower leftover inbox count.
    await db.users.update_one(
        {"id": uid},
        {"$max": {PROFILE_DM_RECEIVED_FIELD: received, PROFILE_DM_SENT_FIELD: sent}},
    )
    prev_r, prev_s = _int_count((user or {}).get(PROFILE_DM_RECEIVED_FIELD)), _int_count(
        (user or {}).get(PROFILE_DM_SENT_FIELD)
    )
    return max(prev_r, received), max(prev_s, sent)


async def bump_profile_dm_sent(db, sender_id: str) -> None:
    uid = (sender_id or "").strip()
    if not uid:
        return
    await db.users.update_one({"id": uid}, {"$inc": {PROFILE_DM_SENT_FIELD: 1}})


async def bump_profile_dm_received(db, recipient_id: str) -> None:
    uid = (recipient_id or "").strip()
    if not uid:
        return
    await db.users.update_one({"id": uid}, {"$inc": {PROFILE_DM_RECEIVED_FIELD: 1}})
