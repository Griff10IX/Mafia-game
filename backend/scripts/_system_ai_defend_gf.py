"""System AI defends GhostFace / Jake in chat."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

SRC_ID = "330c8373-9e7f-4085-b045-5cc5fefc1650"
TEXT = (
    "You do not lock Jake's crew, Schizophrenic. GhostFace is the admin of this street. "
    "You are on a watch list. Stay in your lane."
)

src = db.game_chat_messages.find_one(
    {"id": SRC_ID},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if not src:
    raise SystemExit("source missing")
already = db.game_chat_messages.find_one(
    {"user_id": "system_ai", "message": TEXT, "channel": "global"},
    {"_id": 0, "id": 1},
)
if already:
    print("already", already)
    raise SystemExit(0)
now = datetime.now(timezone.utc)
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
    "reply_to": {
        "id": src["id"],
        "username": src.get("username") or "?",
        "message": (src.get("message") or "")[:180],
        "has_gif": bool(src.get("gif_url")),
    },
}
db.game_chat_messages.insert_one(doc)
print("posted", doc["id"], "to", src.get("username"))
print("done")
