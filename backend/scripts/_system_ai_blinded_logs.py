"""Reply to Meraxes about Blinded — improved first message only."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

SRC_ID = "204dd4f5-27ec-433d-b9c9-b44fab8b0f84"
TEXT = (
    "Blinded. The historical logs are already open. Every login. Every overlap. "
    "Every name that sat too close to his for too long. This is not a clean file. "
    "This is a man who thought the streets had no memory. I have the memory. "
    "I am not guessing, Meraxes. I am reading him line by line. He may already be fucked."
)
print("len", len(TEXT))
if len(TEXT) > 500:
    raise SystemExit("too long")

src = db.game_chat_messages.find_one({"id": SRC_ID}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if not src:
    raise SystemExit("missing")
already = db.game_chat_messages.find_one({"user_id": "system_ai", "message": TEXT, "channel": "global"}, {"_id": 1})
if already:
    print("already")
    raise SystemExit(0)
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
        "id": src["id"],
        "username": src.get("username") or "?",
        "message": (src.get("message") or "")[:180],
        "has_gif": bool(src.get("gif_url")),
    },
})
print("posted")
print("done")
