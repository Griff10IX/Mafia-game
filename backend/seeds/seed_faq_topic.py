"""
Seed script: creates a "FAQs" forum topic from FORUM_FAQ.md (or fallback text).
Run from backend dir: python seed_faq_topic.py
Reads docs/FORUM_FAQ.md from project root (or legacy FORUM_FAQ.md at root). Author: FAQ_TOPIC_USERNAME, FAQ_TOPIC_AUTHOR_ID, or ADMIN_EMAILS (see utils/faq_topic_author.py).
Skips if a topic with title "FAQs" already exists.
To refresh an existing topic from disk, use update_faq_topic.py in this folder.
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

ROOT_DIR = Path(__file__).parent  # backend/seeds/
BACKEND_DIR = ROOT_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent  # repo root (where FORUM_FAQ.md lives)
load_dotenv(BACKEND_DIR / ".env")

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
from utils.faq_topic_author import resolve_faq_topic_author_sync

FAQ_TITLE = "FAQs"
# Primary: docs/FORUM_FAQ.md; fallback: repo root FORUM_FAQ.md
FAQ_MD_PATH = PROJECT_ROOT / "docs" / "FORUM_FAQ.md"
FAQ_MD_PATH_LEGACY = PROJECT_ROOT / "FORUM_FAQ.md"

FALLBACK_FAQ_CONTENT = """[b]NOTE (operators):[/b] Used only if [i]docs/FORUM_FAQ.md[/i] is missing when seeding. Restore that file and re-run the FAQ update.

[b]Short snapshot[/b] — players should rely on in-game screens for live numbers:
• Cities: Chicago, New York, Las Vegas, Atlantic City.
• Ranks: 13 ranks; Godfather at about 1.02M rank points.
• Interest bank: current terms on the bank screen.
• Personal OC cooldown: [b]6h[/b], or [b]4h[/b] after a one-time Point Store purchase.
• GTA: locations, cooldowns, and rates shown in-game.
• Booze: jail chance about 2.5–6.5% per buy/sell when caught; short jail.
• Bodyguards: up to 4 slots; robot hire; slot purchases [b]75 / 150 / 300 / 450[/b] pts.
• Dead > Alive: about [b]99.95%[/b] of dead account cash/points at death to a new account (password); token restore rules on the in-game pages.
• Mini-game weekly leaderboard: Monday [b]00:00 UTC[/b] week start; top [b]5[/b] earn rewards (see leaderboard).
"""


def _markdown_bold_to_html(content: str) -> str:
    """Convert **bold** to <strong>bold</strong> so forum HTML renderer shows bold correctly."""
    import re
    return re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", content)


def _load_faq_content() -> str:
    """Load FAQ body from docs/FORUM_FAQ.md (or legacy root FORUM_FAQ.md) if present."""
    for path in (FAQ_MD_PATH, FAQ_MD_PATH_LEGACY):
        if path.exists():
            try:
                content = path.read_text(encoding="utf-8")
                if content.strip():
                    return _markdown_bold_to_html(content.strip())
            except Exception as e:
                print(f"Warning: could not read {path}: {e}. Trying next path or fallback.")
    return _markdown_bold_to_html(FALLBACK_FAQ_CONTENT.strip())


def main():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    client = MongoClient(mongo_url)
    db_name = os.environ.get("MONGO_DB", "mafia")
    db = client[db_name]

    existing = db.forum_topics.find_one({"title": FAQ_TITLE})
    if existing:
        print(f"Topic '{FAQ_TITLE}' already exists. Skipping.")
        return

    author_id, author_username = resolve_faq_topic_author_sync(db)

    topic_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    faq_content = _load_faq_content()
    doc = {
        "id": topic_id,
        "title": FAQ_TITLE,
        "content": faq_content,
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
    source = str(loaded.relative_to(PROJECT_ROOT)) if loaded.exists() else "fallback text"
    print(f"Created forum topic '{FAQ_TITLE}' (id={topic_id}, author={author_username}, content from {source}, sticky & important).")


if __name__ == "__main__":
    main()
