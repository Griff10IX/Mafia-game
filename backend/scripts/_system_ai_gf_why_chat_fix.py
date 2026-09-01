"""Ack GhostFace: chat freeze patch, no API restart."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

SRC_ID = "520fcf0a-f31e-4aa3-b944-c7ef99991b8d"
TEXT = (
    "Found it, GhostFace. Typing in chat could bury the close button and a chat rate-limit "
    "was locking the whole page. Patching that now. No API restart."
)
already = db.game_chat_messages.find_one(
    {"user_id": "system_ai", "message": TEXT, "channel": "global"},
    {"_id": 1},
)
if already:
    print("already")
    raise SystemExit(0)
src = db.game_chat_messages.find_one({"id": SRC_ID}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
now = datetime.now(timezone.utc)
db.game_chat_messages.insert_one({
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
    "reply_to": {
        "id": SRC_ID,
        "username": (src or {}).get("username") or "GhostFace",
        "message": ((src or {}).get("message") or "")[:180],
        "has_gif": bool((src or {}).get("gif_url")),
    } if src else None,
})
print("posted")
print("done")
