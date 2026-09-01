"""Re-author Topic of Shame as System AI and refresh the intro line."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

import sys
sys.path.insert(0, "/opt/mafia-app/backend")
from utils.ensure_topic_of_shame import apply_shame_intro, _TITLE_RE
from utils.system_ai_inbox import system_ai_forum_author_fields

topic = db.forum_topics.find_one({"title": _TITLE_RE}, {"_id": 0, "id": 1, "title": 1, "author_id": 1, "author_username": 1, "content": 1})
print("before", {k: topic.get(k) for k in ("id", "title", "author_id", "author_username")} if topic else None)
if not topic:
    raise SystemExit("topic missing")
new_content = apply_shame_intro(topic.get("content") or "")
r = db.forum_topics.update_one(
    {"id": topic["id"]},
    {"$set": {"content": new_content, **system_ai_forum_author_fields()}},
)
print("matched", r.matched_count, "modified", r.modified_count)
after = db.forum_topics.find_one({"id": topic["id"]}, {"_id": 0, "author_id": 1, "author_username": 1, "system_ai": 1, "avatar_url": 1})
print("after", after)
print("intro ok", "Posted by System AI" in new_content)
