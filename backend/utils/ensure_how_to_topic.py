"""
Sync forum topic "How To" from docs/FORUM_HOW_TO.md on backend startup (Motor async).

If the markdown file exists next to the deployed app, the topic is created or updated.
If the file is missing (e.g. minimal deploy), existing DB content is left unchanged.
Disable with env HOW_TO_TOPIC_SYNC=0.
"""
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from utils.faq_topic_author import resolve_faq_topic_author_async

logger = logging.getLogger(__name__)

HOW_TO_TITLE = "How To"


def _how_to_path() -> Path:
    backend_dir = Path(__file__).resolve().parent.parent
    project_root = backend_dir.parent
    return project_root / "docs" / "FORUM_HOW_TO.md"


def _markdown_bold_to_html(content: str) -> str:
    return re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", content)


def _load_how_to_body() -> Optional[str]:
    path = _how_to_path()
    if not path.is_file():
        return None
    try:
        raw = path.read_text(encoding="utf-8").strip()
        if raw:
            return _markdown_bold_to_html(raw)
    except OSError as e:
        logger.warning("ensure_how_to_forum_topic: could not read %s: %s", path, e)
    return None


async def ensure_how_to_forum_topic(db) -> None:
    if (os.environ.get("HOW_TO_TOPIC_SYNC") or "").strip().lower() in ("0", "false", "no"):
        logger.info("ensure_how_to_forum_topic: skipped (HOW_TO_TOPIC_SYNC=0)")
        return

    body = _load_how_to_body()
    if not body:
        logger.info("ensure_how_to_forum_topic: no docs/FORUM_HOW_TO.md found; skipping")
        return

    now = datetime.now(timezone.utc).isoformat()
    existing = await db.forum_topics.find_one({"title": HOW_TO_TITLE}, {"_id": 1})

    if existing:
        result = await db.forum_topics.update_one(
            {"title": HOW_TO_TITLE},
            {"$set": {"content": body, "updated_at": now}},
        )
        if result.modified_count:
            logger.info("ensure_how_to_forum_topic: updated '%s' from docs/FORUM_HOW_TO.md", HOW_TO_TITLE)
        else:
            logger.debug("ensure_how_to_forum_topic: '%s' already matches file", HOW_TO_TITLE)
        return

    author_id, author_username = await resolve_faq_topic_author_async(db)
    doc = {
        "id": str(uuid.uuid4()),
        "title": HOW_TO_TITLE,
        "content": body,
        "category": "general",
        "author_id": author_id,
        "author_username": author_username,
        "created_at": now,
        "updated_at": now,
        "views": 0,
        "is_sticky": True,
        "is_important": True,
        "is_locked": False,
    }
    await db.forum_topics.insert_one(doc)
    logger.info("ensure_how_to_forum_topic: created '%s' from docs/FORUM_HOW_TO.md", HOW_TO_TITLE)
