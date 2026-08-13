"""
Create forum topic "Topic of Shame" from docs/TOPIC_OF_SHAME.md if it does not exist.
Run from backend dir: python seeds/update_topic_of_shame.py
Or from repo root: python backend/seeds/update_topic_of_shame.py

Insert-only: never overwrites an existing topic (staff in-game edits stay).
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

TOPIC_TITLE = "Topic of Shame"
SHAME_MD_PATH = PROJECT_ROOT / "docs" / "TOPIC_OF_SHAME.md"
_TITLE_RE = {"$regex": r"^topic\s+of\s+shame$", "$options": "i"}


def _load_shame_content() -> str:
    if SHAME_MD_PATH.exists():
        try:
            content = SHAME_MD_PATH.read_text(encoding="utf-8")
            if content.strip():
                return content.strip()
        except Exception as e:
            raise SystemExit(f"Could not read {SHAME_MD_PATH}: {e}")
    raise SystemExit(f"No Topic of Shame file found at {SHAME_MD_PATH}")


def main():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    client = MongoClient(mongo_url)
    db_name = os.environ.get("MONGO_DB") or os.environ.get("DB_NAME") or "mafia"
    db = client[db_name]

    existing = db.forum_topics.find_one({"title": _TITLE_RE}, {"_id": 1, "id": 1, "title": 1})
    if existing:
        print(
            f"Topic '{existing.get('title') or TOPIC_TITLE}' already exists "
            f"(id={existing.get('id')}). Not overwriting."
        )
        return

    body = _load_shame_content()
    now = datetime.now(timezone.utc).isoformat()
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
        "prune_exempt": True,
    }
    db.forum_topics.insert_one(doc)
    print(
        f"Created '{TOPIC_TITLE}' (id={topic_id}, author={author_username}) "
        f"from {SHAME_MD_PATH.relative_to(PROJECT_ROOT)} at {now}"
    )


if __name__ == "__main__":
    main()
