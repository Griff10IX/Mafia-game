"""
Create or update forum topic "FAQs" from docs/FORUM_FAQ.md.
Run from backend dir: python update_faq_topic.py
Or from repo root: python backend/seeds/update_faq_topic.py

If the topic does not exist, inserts it (same shape as seed_faq_topic.py). Otherwise updates content + updated_at.
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

FAQ_TITLE = "FAQs"
FAQ_MD_PATH = PROJECT_ROOT / "docs" / "FORUM_FAQ.md"
FAQ_MD_PATH_LEGACY = PROJECT_ROOT / "FORUM_FAQ.md"


def _markdown_bold_to_html(content: str) -> str:
    import re
    return re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", content)


def _load_faq_content() -> str:
    for path in (FAQ_MD_PATH, FAQ_MD_PATH_LEGACY):
        if path.exists():
            try:
                content = path.read_text(encoding="utf-8")
                if content.strip():
                    return _markdown_bold_to_html(content.strip())
            except Exception as e:
                print(f"Warning: could not read {path}: {e}")
    raise SystemExit(f"No FAQ file found at {FAQ_MD_PATH} or {FAQ_MD_PATH_LEGACY}")


def main():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    client = MongoClient(mongo_url)
    db_name = os.environ.get("MONGO_DB", "mafia")
    db = client[db_name]

    body = _load_faq_content()
    now = datetime.now(timezone.utc).isoformat()
    result = db.forum_topics.update_one(
        {"title": FAQ_TITLE},
        {"$set": {"content": body, "updated_at": now}},
    )
    if result.matched_count == 0:
        user = db.users.find_one({}, {"_id": 0, "id": 1, "username": 1})
        author_id = user["id"] if user else "system"
        author_username = user.get("username", "Game") if user else "Game"
        topic_id = str(uuid.uuid4())
        doc = {
            "id": topic_id,
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
        db.forum_topics.insert_one(doc)
        loaded = FAQ_MD_PATH if FAQ_MD_PATH.exists() else FAQ_MD_PATH_LEGACY
        print(f"Created '{FAQ_TITLE}' (was missing) from {loaded.relative_to(PROJECT_ROOT)} at {now}")
        return
    if result.modified_count == 0:
        print(f"Topic '{FAQ_TITLE}' found but content unchanged (or same bytes).")
    else:
        src = FAQ_MD_PATH if FAQ_MD_PATH.exists() else FAQ_MD_PATH_LEGACY
        print(f"Updated '{FAQ_TITLE}' from {src.relative_to(PROJECT_ROOT)} at {now}")


if __name__ == "__main__":
    main()
