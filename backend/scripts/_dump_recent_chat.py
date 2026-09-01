"""Dump recent global chat + unanswered System AI-directed lines."""
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

since = os.environ.get("WATCH_SINCE") or (datetime.now(timezone.utc) - timedelta(minutes=8)).isoformat()
print("SINCE", since)


def addressed(msg):
    if (msg.get("user_id") or "") == "system_ai":
        return False
    if (msg.get("username") or "").strip().lower() == "system ai":
        return False
    body = (msg.get("message") or "").lower()
    rt = msg.get("reply_to") or {}
    if (rt.get("username") or "").strip().lower() == "system ai":
        return True
    compact = body.replace(" ", "")
    if "system ai" in body or "@systemai" in compact or "@system" in compact:
        return True
    return False


print("=== recent ===")
for m in db.game_chat_messages.find(
    {"channel": "global", "created_at": {"$gte": since}},
    {"_id": 0, "id": 1, "user_id": 1, "username": 1, "message": 1, "created_at": 1, "reply_to": 1},
).sort("created_at", 1):
    rt = m.get("reply_to") or {}
    flag = " AI" if addressed(m) else ""
    replied = ""
    if addressed(m):
        if db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": m.get("id")}, {"_id": 1}):
            replied = " REPLIED"
    print(
        m.get("created_at"),
        "|",
        m.get("username"),
        flag + replied,
        "|",
        (m.get("message") or "").replace("\n", " ")[:140],
        "| rt",
        rt.get("username") or "",
        "|",
        m.get("id"),
    )
