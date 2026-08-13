"""
Create forum topic "Topic of Shame" from docs/TOPIC_OF_SHAME.md on backend startup (Motor async).

Insert-only: if the topic already exists, leave it unchanged so in-game staff edits survive deploys.
Disable with env TOPIC_OF_SHAME_SYNC=0.
"""
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from utils.faq_topic_author import resolve_faq_topic_author_async

logger = logging.getLogger(__name__)

TOPIC_TITLE = "Topic of Shame"
_TITLE_RE = {"$regex": r"^topic\s+of\s+shame$", "$options": "i"}


def _shame_path() -> Path:
    backend_dir = Path(__file__).resolve().parent.parent
    project_root = backend_dir.parent
    return project_root / "docs" / "TOPIC_OF_SHAME.md"


def _load_shame_body() -> Optional[str]:
    path = _shame_path()
    if not path.is_file():
        return None
    try:
        raw = path.read_text(encoding="utf-8").strip()
        return raw or None
    except OSError as e:
        logger.warning("ensure_topic_of_shame: could not read %s: %s", path, e)
        return None


async def ensure_topic_of_shame_forum_topic(db) -> None:
    if (os.environ.get("TOPIC_OF_SHAME_SYNC") or "").strip().lower() in ("0", "false", "no"):
        logger.info("ensure_topic_of_shame: skipped (TOPIC_OF_SHAME_SYNC=0)")
        return

    existing = await db.forum_topics.find_one({"title": _TITLE_RE}, {"_id": 1, "id": 1})
    if existing:
        logger.debug("ensure_topic_of_shame: '%s' already exists; not overwriting", TOPIC_TITLE)
        return

    body = _load_shame_body()
    if not body:
        logger.info("ensure_topic_of_shame: no docs/TOPIC_OF_SHAME.md found; skipping")
        return

    now = datetime.now(timezone.utc).isoformat()
    author_id, author_username = await resolve_faq_topic_author_async(db)
    doc = {
        "id": str(uuid.uuid4()),
        "title": TOPIC_TITLE,
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
        "prune_exempt": True,
    }
    await db.forum_topics.insert_one(doc)
    logger.info("ensure_topic_of_shame: created '%s' from docs/TOPIC_OF_SHAME.md", TOPIC_TITLE)
