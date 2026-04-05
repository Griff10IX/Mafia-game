"""
Sync forum topic "Update Log" from docs/UPDATE_LOG.md on backend startup (Motor async).

If the markdown file exists in the deployed repo, the topic is created or updated.
Disable with env UPDATE_LOG_TOPIC_SYNC=0.
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

UPDATE_LOG_TITLE = "Update Log"


def _update_log_path() -> Path:
    backend_dir = Path(__file__).resolve().parent.parent
    project_root = backend_dir.parent
    return project_root / "docs" / "UPDATE_LOG.md"


def _markdown_bold_to_html(content: str) -> str:
    return re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", content)


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

    existing = await db.forum_topics.find_one(
        {"title": {"$regex": r"^update\s*log$", "$options": "i"}},
        {"_id": 1, "title": 1},
    )

    if existing:
        result = await db.forum_topics.update_one(
            {"_id": existing["_id"]},
            {"$set": {"title": UPDATE_LOG_TITLE, "content": body, "updated_at": now, "category": "general", "is_locked": True}},
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
    }
    await db.forum_topics.insert_one(doc)
    logger.info("ensure_update_log_forum_topic: created '%s' from docs/UPDATE_LOG.md", UPDATE_LOG_TITLE)

