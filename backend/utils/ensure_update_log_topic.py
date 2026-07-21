"""
Sync forum topic "Update Log" from docs/UPDATE_LOG.md on backend startup (Motor async).

If the markdown file exists in the deployed repo, the topic is created or updated.
Disable with env UPDATE_LOG_TOPIC_SYNC=0.

Also stores update_log_entries (id/hash/change_count) so the client can show an unread badge.
"""
import hashlib
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from utils.faq_topic_author import resolve_faq_topic_author_async

logger = logging.getLogger(__name__)

UPDATE_LOG_TITLE = "Update Log"

# [size=1.5][b][color=#2ECC71]2026-07-22 00:25 UTC[/color][/b] — [b]Title here[/b][/size]
_ENTRY_HEADER_RE = re.compile(
    r"\[size=1\.5\]\[b\]\[color=#2ECC71\]([^\[\]]+)\[/color\]\[/b\]\s*—\s*\[b\](.*?)\[/b\]\[/size\]",
    re.IGNORECASE | re.DOTALL,
)


def _update_log_path() -> Path:
    backend_dir = Path(__file__).resolve().parent.parent
    project_root = backend_dir.parent
    return project_root / "docs" / "UPDATE_LOG.md"


def _markdown_bold_to_html(content: str) -> str:
    return re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", content)


def parse_update_log_entries(body: str) -> List[Dict[str, Any]]:
    """Split UPDATE_LOG body into dated sections with content hashes."""
    text = body or ""
    matches = list(_ENTRY_HEADER_RE.finditer(text))
    entries: List[Dict[str, Any]] = []
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        chunk = text[start:end]
        entry_id = (m.group(1) or "").strip()
        title = re.sub(r"\s+", " ", (m.group(2) or "").strip())
        change_count = len(re.findall(r"\[\*\]", chunk))
        digest = hashlib.sha256(chunk.encode("utf-8")).hexdigest()[:16]
        entries.append(
            {
                "id": entry_id,
                "title": title,
                "hash": digest,
                "change_count": max(1, change_count),
            }
        )
    return entries


def unread_update_log_count(
    entries: Optional[List[Dict[str, Any]]],
    seen_hashes: Optional[List[str]],
) -> int:
    """
    Count unread changelog bullets across dated sections whose hash the user has not seen.
    If seen_hashes is None, treat as not initialized (caller should seed) → 0.
    """
    if seen_hashes is None:
        return 0
    seen: Set[str] = {str(h) for h in seen_hashes if h}
    unread = 0
    for e in entries or []:
        h = e.get("hash")
        if h and h not in seen:
            unread += int(e.get("change_count") or 1)
    return unread


def current_update_log_hashes(entries: Optional[List[Dict[str, Any]]]) -> List[str]:
    return [str(e.get("hash")) for e in (entries or []) if e.get("hash")]


def _load_update_log_body() -> Optional[str]:
    path = _update_log_path()
    if not path.is_file():
        return None
    try:
        raw = path.read_text(encoding="utf-8").strip()
        if raw:
            return _markdown_bold_to_html(raw)
    except OSError as e:
        logger.warning("ensure_update_log_topic: could not read %s: %s", path, e)
    return None


async def ensure_update_log_forum_topic(db) -> None:
    if (os.environ.get("UPDATE_LOG_TOPIC_SYNC") or "").strip().lower() in ("0", "false", "no"):
        logger.info("ensure_update_log_forum_topic: skipped (UPDATE_LOG_TOPIC_SYNC=0)")
        return

    body = _load_update_log_body()
    if not body:
        logger.info("ensure_update_log_forum_topic: no docs/UPDATE_LOG.md found; skipping")
        return

    now = datetime.now(timezone.utc).isoformat()
    entries = parse_update_log_entries(body)

    existing = await db.forum_topics.find_one(
        {"title": {"$regex": r"^update\s*log$", "$options": "i"}},
        {"_id": 1, "title": 1, "content": 1},
    )

    if existing:
        payload: Dict[str, Any] = {
            "title": UPDATE_LOG_TITLE,
            "content": body,
            "category": "general",
            "is_locked": True,
            "is_sticky": True,
            "is_important": True,
            "update_log_entries": entries,
        }
        if (existing.get("content") or "") != body:
            payload["updated_at"] = now
        result = await db.forum_topics.update_one(
            {"_id": existing["_id"]},
            {"$set": payload},
        )
        if result.modified_count:
            logger.info("ensure_update_log_forum_topic: updated '%s' from docs/UPDATE_LOG.md", UPDATE_LOG_TITLE)
        else:
            logger.debug("ensure_update_log_forum_topic: '%s' already matches file", UPDATE_LOG_TITLE)
        return

    author_id, author_username = await resolve_faq_topic_author_async(db)
    doc = {
        "id": str(uuid.uuid4()),
        "title": UPDATE_LOG_TITLE,
        "content": body,
        "category": "general",
        "author_id": author_id,
        "author_username": author_username,
        "created_at": now,
        "updated_at": now,
        "views": 0,
        "is_sticky": True,
        "is_important": True,
        "is_locked": True,
        "update_log_entries": entries,
    }
    await db.forum_topics.insert_one(doc)
    logger.info("ensure_update_log_forum_topic: created '%s' from docs/UPDATE_LOG.md", UPDATE_LOG_TITLE)
