"""Announce back on for 15 minutes, GhostFace only."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

SRC_ID = "1b47c55e-33ce-416a-9c85-07145d60e3d6"
TEXT = "Back. 15 minutes. GhostFace only."
src = db.game_chat_messages.find_one({"id": SRC_ID}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
now = datetime.now(timezone.utc)
already = db.game_chat_messages.find_one({"user_id": "system_ai", "message": TEXT, "channel": "global"}, {"_id": 1})
if already:
    print("already")
    raise SystemExit(0)
doc = {
    "id": str(uuid.uuid4()),
    "user_id": "system_ai",
    "username": "System AI",
    "message": TEXT,
    "family_id": None,
    "channel": "global",
    "created_at": now.isoformat(),
    "expires_at": now + timedelta(days=7),
    "sender_is_staff": True,
    "system_ai": True,
    "avatar_url": "/images/system-ai-avatar.png",
    "author_online_color": "#FBBF24",
    "viewed_by": [],
}
if src:
    doc["reply_to"] = {
        "id": src["id"],
        "username": src.get("username") or "?",
        "message": (src.get("message") or "")[:180],
        "has_gif": bool(src.get("gif_url")),
    }
db.game_chat_messages.insert_one(doc)
print("posted", doc["id"])
print("done")
