"""
Create or update forum topic "How To" from docs/FORUM_HOW_TO.md.
Run from backend dir: python update_how_to_topic.py
Or from repo root: python backend/seeds/update_how_to_topic.py

If the topic does not exist, inserts it (same shape as update_faq_topic.py). Otherwise updates content + updated_at.
"""
import os
import sys
import uuid
from pathlib import Path
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    from pymongo import MongoClient
except ModuleNotFoundError as e:
    print("Missing dependency. Install with: pip install pymongo python-dotenv")
    sys.exit(1)

ROOT_DIR = Path(__file__).resolve().parent  # backend/seeds/
BACKEND_DIR = ROOT_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent
load_dotenv(BACKEND_DIR / ".env")

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
from utils.faq_topic_author import resolve_faq_topic_author_sync

HOW_TO_TITLE = "How To"
HOW_TO_MD_PATH = PROJECT_ROOT / "docs" / "FORUM_HOW_TO.md"


def _markdown_bold_to_html(content: str) -> str:
    import re
    return re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", content)


def _load_how_to_content() -> str:
    if HOW_TO_MD_PATH.exists():
        try:
            content = HOW_TO_MD_PATH.read_text(encoding="utf-8")
            if content.strip():
                return _markdown_bold_to_html(content.strip())
        except Exception as e:
            print(f"Warning: could not read {HOW_TO_MD_PATH}: {e}")
    raise SystemExit(f"No How To file found at {HOW_TO_MD_PATH}")


def main():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    client = MongoClient(mongo_url)
    db_name = os.environ.get("MONGO_DB", "mafia")
    db = client[db_name]

    body = _load_how_to_content()
    now = datetime.now(timezone.utc).isoformat()
    result = db.forum_topics.update_one(
        {"title": HOW_TO_TITLE},
        {"$set": {"content": body, "updated_at": now}},
    )
    if result.matched_count == 0:
        author_id, author_username = resolve_faq_topic_author_sync(db)
        topic_id = str(uuid.uuid4())
        doc = {
            "id": topic_id,
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
        db.forum_topics.insert_one(doc)
        print(f"Created '{HOW_TO_TITLE}' (was missing) from {HOW_TO_MD_PATH.relative_to(PROJECT_ROOT)} at {now}")
        return
    if result.modified_count == 0:
        print(f"Topic '{HOW_TO_TITLE}' found but content unchanged (or same bytes).")
    else:
        print(f"Updated '{HOW_TO_TITLE}' from {HOW_TO_MD_PATH.relative_to(PROJECT_ROOT)} at {now}")


if __name__ == "__main__":
    main()
