"""
Create or update forum topic "Update Log" from docs/UPDATE_LOG.md.
Run from backend dir: python update_update_log_topic.py
Or from repo root: python backend/seeds/update_update_log_topic.py

If the topic does not exist, inserts it. Otherwise updates content + updated_at.
"""
import os
import sys
import uuid
from pathlib import Path
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    from pymongo import MongoClient
except ModuleNotFoundError:
    print("Missing dependency. Install with: pip install pymongo python-dotenv")
    sys.exit(1)

ROOT_DIR = Path(__file__).resolve().parent  # backend/seeds/
BACKEND_DIR = ROOT_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent
load_dotenv(BACKEND_DIR / ".env")

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
from utils.faq_topic_author import resolve_faq_topic_author_sync
from utils.ensure_update_log_topic import parse_update_log_entries

TOPIC_TITLE = "Update Log"
UPDATE_LOG_MD_PATH = PROJECT_ROOT / "docs" / "UPDATE_LOG.md"


def _markdown_bold_to_html(content: str) -> str:
    import re
    return re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", content)


def _load_update_log_content() -> str:
    if UPDATE_LOG_MD_PATH.exists():
        try:
            content = UPDATE_LOG_MD_PATH.read_text(encoding="utf-8")
            if content.strip():
                return _markdown_bold_to_html(content.strip())
        except Exception as e:
            raise SystemExit(f"Could not read {UPDATE_LOG_MD_PATH}: {e}")
    raise SystemExit(f"No update log file found at {UPDATE_LOG_MD_PATH}")


def main():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    client = MongoClient(mongo_url)
    db_name = os.environ.get("MONGO_DB", "mafia")
    db = client[db_name]

    body = _load_update_log_content()
    entries = parse_update_log_entries(body)
    now = datetime.now(timezone.utc).isoformat()
    existing = db.forum_topics.find_one(
        {"title": {"$regex": r"^update\s*log$", "$options": "i"}},
        {"_id": 1, "content": 1},
    )
    set_fields = {
        "title": TOPIC_TITLE,
        "content": body,
        "category": "general",
        "is_locked": True,
        "is_sticky": True,
        "is_important": True,
        "update_log_entries": entries,
    }
    if existing:
        if (existing.get("content") or "") != body:
            set_fields["updated_at"] = now
        result = db.forum_topics.update_one(
            {"_id": existing["_id"]},
            {"$set": set_fields},
        )
    else:
        set_fields["updated_at"] = now
        result = db.forum_topics.update_one(
            {"title": TOPIC_TITLE},
            {"$set": set_fields},
        )
    if result.matched_count == 0:
        author_id, author_username = resolve_faq_topic_author_sync(db)
        topic_id = str(uuid.uuid4())
        doc = {
            "id": topic_id,
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
            "update_log_entries": entries,
        }
        db.forum_topics.insert_one(doc)
        print(f"Created '{TOPIC_TITLE}' (was missing) from docs/UPDATE_LOG.md at {now}")
        return
    if result.modified_count == 0:
        print(f"Topic '{TOPIC_TITLE}' found but content unchanged (or same bytes).")
    else:
        print(f"Updated '{TOPIC_TITLE}' from docs/UPDATE_LOG.md at {now} ({len(entries)} entries)")


if __name__ == "__main__":
    main()
