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

FALLBACK_FAQ_CONTENT = """[b]NOTE:[/b] This text is only used if [i]FORUM_FAQ.md[/i] is missing from the project root when you run this seed script. The real FAQ lives in [b]docs/FORUM_FAQ.md[/b] — fix the path and re-seed.

[b]Verified snapshot (still read code / in-game UI for live values):[/b]
• Cities ([b]STATES[/b]): Chicago, New York, Las Vegas, Atlantic City.
• Ranks / RP: see [b]backend/server.py[/b] → [b]RANKS[/b] (13 ranks; Godfather at 1.02M RP).
• Interest bank %: see [b]BANK_INTEREST_OPTIONS[/b] in [b]server.py[/b].
• Personal OC cooldown: 6h → 4h after one-time store purchase ([b]oc.py[/b] / store).
• GTA locations & cooldowns: [b]backend/routers/cars/gta.py[/b] → [b]GTA_OPTIONS[/b].
• Booze: [b]booze_run.py[/b] → [b]BOOZE_TYPES[/b], jail chance 2.5–6.5% per buy/sell, 20s jail.
• Bodyguards: up to 4 slots; robot hire; slot purchases [b]75/150/300/450[/b] pts — [b]bodyguards.py[/b].
• Dead > Alive: ~99.95% of dead account cash/points at death to a new account (password); tokens partial restore — [b]dead_alive.py[/b].
• Mini-game weekly LB: Monday UTC week start, top 5 rewards — [b]minigame_leaderboard.py[/b].

For the full BBCode FAQ, open [b]docs/FORUM_FAQ.md[/b] in the repo.
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
