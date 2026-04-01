"""Archive messages before hard-delete so admins can review deleted content."""

from datetime import datetime, timezone
from typing import Optional

from server import db


async def archive_message(
    *,
    source: str,
    doc: dict,
    deleted_by_id: Optional[str] = None,
    deleted_by_username: Optional[str] = None,
    reason: Optional[str] = None,
):
    """
    Save a copy of a message document before it is hard-deleted.

    source: "forum_comment", "forum_topic", "game_chat", "notification"
    doc:    the full document being deleted (will be stored as-is under "original")
    """
    if not doc:
        return
    user_id = doc.get("author_id") or doc.get("user_id") or doc.get("sender_id") or ""
    username = doc.get("author_username") or doc.get("username") or doc.get("sender_username") or ""
    content = doc.get("content") or doc.get("message") or doc.get("title") or ""

    await db.deleted_messages_archive.insert_one({
        "source": source,
        "user_id": user_id,
        "username": username,
        "content_preview": str(content)[:500],
        "deleted_at": datetime.now(timezone.utc).isoformat(),
        "deleted_by_id": deleted_by_id,
        "deleted_by_username": deleted_by_username,
        "reason": reason,
        "original": {k: v for k, v in doc.items() if k != "_id"},
    })


async def archive_many(
    *,
    source: str,
    docs: list,
    deleted_by_id: Optional[str] = None,
    deleted_by_username: Optional[str] = None,
    reason: Optional[str] = None,
):
    """Bulk archive multiple documents."""
    if not docs:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    records = []
    for doc in docs:
        user_id = doc.get("author_id") or doc.get("user_id") or doc.get("sender_id") or ""
        username = doc.get("author_username") or doc.get("username") or doc.get("sender_username") or ""
        content = doc.get("content") or doc.get("message") or doc.get("title") or ""
        records.append({
            "source": source,
            "user_id": user_id,
            "username": username,
            "content_preview": str(content)[:500],
            "deleted_at": now_iso,
            "deleted_by_id": deleted_by_id,
            "deleted_by_username": deleted_by_username,
            "reason": reason,
            "original": {k: v for k, v in doc.items() if k != "_id"},
        })
    if records:
        await db.deleted_messages_archive.insert_many(records)
