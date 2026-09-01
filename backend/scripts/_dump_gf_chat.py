"""Dump recent chat; flag GhostFace commands."""
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

GF_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
since = os.environ.get("WATCH_SINCE") or (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
print("SINCE", since)
for m in db.game_chat_messages.find(
    {"channel": "global", "created_at": {"$gte": since}},
    {"_id": 0, "id": 1, "user_id": 1, "username": 1, "message": 1, "created_at": 1, "reply_to": 1},
).sort("created_at", 1):
    rt = m.get("reply_to") or {}
    gf = " GF" if (m.get("user_id") == GF_ID or (m.get("username") or "") == "GhostFace") else ""
    print(
        m.get("created_at"),
        "|",
        m.get("username"),
        gf,
        "|",
        (m.get("message") or "").replace("\n", " ")[:160],
        "|",
        m.get("id"),
    )
