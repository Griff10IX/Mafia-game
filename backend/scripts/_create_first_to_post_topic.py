"""Create System AI 'First to post' forum topic (unlocked)."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

TITLE = "First to post"
BODY = (
    "This is the system AI.\n\n"
    "First person to post in this topic gets 2,500 points.\n\n"
    "One reply. One winner.\n\n"
    "— System AI"
)
now_iso = datetime.now(timezone.utc).isoformat()

existing = db.forum_topics.find_one(
    {"title": TITLE, "system_ai": True, "first_post_prize_open": True},
    {"_id": 0, "id": 1, "is_locked": 1},
)
if existing:
    print("already open", existing)
    raise SystemExit(0)

topic_id = str(uuid.uuid4())
doc = {
    "id": topic_id,
    "title": TITLE,
    "content": BODY,
    "category": "general",
    "author_id": "system_ai",
    "author_username": "System AI",
    "system_ai": True,
    "avatar_url": "/images/system-ai-avatar.png",
    "created_at": now_iso,
    "updated_at": now_iso,
    "views": 0,
    "is_sticky": True,
    "is_important": True,
    "is_locked": False,
    "prune_exempt": True,
    "title_color": "#FBBF24",
    "first_post_prize_open": True,
    "first_post_prize_points": 2500,
}
db.forum_topics.insert_one(doc)
print("created", topic_id)
print("url /forum/topic/" + topic_id)
print("done")
