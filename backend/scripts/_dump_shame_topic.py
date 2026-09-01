"""Dump live Topic of Shame content for parser debug."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]
t = db.forum_topics.find_one(
    {"title": {"$regex": "shame", "$options": "i"}},
    {"_id": 0, "title": 1, "content": 1},
)
if not t:
    rows = list(db.forum_topics.find({"title": {"$regex": "shame", "$options": "i"}}, {"_id": 0, "title": 1}).limit(10))
    print("no topic", rows)
    raise SystemExit
print("title", repr(t.get("title")))
c = (t or {}).get("content") or ""
print("len", len(c))
print("hr_count", c.lower().count("[hr]"))
print("quote_count", c.lower().count("[quote]"))
print("list_count", c.lower().count("[*]"))
print("emdash", c.count("—"), "hyphen-sep", " — " in c or " - " in c)
print("--- first 1200 ---")
print(c[:1200])
print("--- around first date ---")
i = c.find("2026")
print(repr(c[max(0, i - 80) : i + 220]) if i >= 0 else "no date")
print("--- taken ---")
j = c.find("Taken")
print(c[j : j + 280] if j >= 0 else "no taken")
print("question_marks", c.count("?"))
print("pound", c.count("£"), "pound_q", "??10" in c)
