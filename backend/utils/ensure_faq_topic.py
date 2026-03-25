"""
Sync forum topic "FAQs" from docs/FORUM_FAQ.md on backend startup (Motor async).

If the markdown file exists next to the deployed app, the topic is created or updated.
If the file is missing (e.g. minimal deploy), existing DB content is left unchanged.
Disable with env FAQ_TOPIC_SYNC=0.
"""
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

FAQ_TITLE = "FAQs"


def _project_paths():
    """backend/utils -> backend -> repo root."""
    backend_dir = Path(__file__).resolve().parent.parent
    project_root = backend_dir.parent
    return (
        project_root / "docs" / "FORUM_FAQ.md",
        project_root / "FORUM_FAQ.md",
    )


def _markdown_bold_to_html(content: str) -> str:
    return re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", content)


def _load_faq_body() -> Optional[str]:
    for path in _project_paths():
        if not path.is_file():
            continue
        try:
            raw = path.read_text(encoding="utf-8").strip()
            if raw:
                return _markdown_bold_to_html(raw)
        except OSError as e:
            logger.warning("ensure_faq_forum_topic: could not read %s: %s", path, e)
    return None


async def ensure_faq_forum_topic(db) -> None:
    if (os.environ.get("FAQ_TOPIC_SYNC") or "").strip().lower() in ("0", "false", "no"):
        logger.info("ensure_faq_forum_topic: skipped (FAQ_TOPIC_SYNC=0)")
        return

    body = _load_faq_body()
    if not body:
        logger.info(
            "ensure_faq_forum_topic: no FORUM_FAQ.md under project root; skipping (forum FAQs unchanged)"
        )
        return

    now = datetime.now(timezone.utc).isoformat()
    existing = await db.forum_topics.find_one({"title": FAQ_TITLE}, {"_id": 1})

    if existing:
        result = await db.forum_topics.update_one(
            {"title": FAQ_TITLE},
            {"$set": {"content": body, "updated_at": now}},
        )
        if result.modified_count:
            logger.info("ensure_faq_forum_topic: updated '%s' from docs/FORUM_FAQ.md", FAQ_TITLE)
        else:
            logger.debug("ensure_faq_forum_topic: '%s' already matches file", FAQ_TITLE)
        return

    user = await db.users.find_one({}, {"_id": 0, "id": 1, "username": 1})
    author_id = user["id"] if user else "system"
    author_username = user.get("username", "Game") if user else "Game"
    doc = {
        "id": str(uuid.uuid4()),
        "title": FAQ_TITLE,
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
    logger.info("ensure_faq_forum_topic: created '%s' from docs/FORUM_FAQ.md", FAQ_TITLE)
