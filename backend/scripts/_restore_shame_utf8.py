"""Restore Topic of Shame forum body from docs/TOPIC_OF_SHAME.md (UTF-8)."""
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

path = Path("/opt/mafia-app/docs/TOPIC_OF_SHAME.md")
body = path.read_text(encoding="utf-8").strip()
if not body:
    raise SystemExit("missing docs/TOPIC_OF_SHAME.md")

r = db.forum_topics.update_one(
    {"title": {"$regex": r"^topic\s+of\s+shame$", "$options": "i"}},
    {"$set": {"content": body, "updated_at": datetime.now(timezone.utc).isoformat()}},
)
print("matched", r.matched_count, "modified", r.modified_count)
c = db.forum_topics.find_one({"title": "Topic of Shame"}, {"_id": 0, "content": 1})["content"]
print("emdash", c.count("\u2014"), "pound", c.count("\u00a3"), "qqq", c.count("???"))
i = c.find("2026-08-23")
print(repr(c[i : i + 70]))
