"""Move First to post into regular topics (not sticky/important)."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]
tid = "8a7c8f53-4ec3-44a6-9325-3f0ec4d0f344"
r = db.forum_topics.update_one(
    {"id": tid},
    {"$set": {"is_sticky": False, "is_important": False}},
)
t = db.forum_topics.find_one(
    {"id": tid},
    {"_id": 0, "title": 1, "is_sticky": 1, "is_important": 1, "is_locked": 1, "first_post_prize_open": 1},
)
print("modified", r.modified_count)
print(t)
print("comments", db.forum_comments.count_documents({"topic_id": tid}))
