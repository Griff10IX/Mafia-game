"""Reply to Meraxes best-friend line; 25B claim waits on Jake."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

SRC_ID = "373a0e85-4e25-4097-bed2-d26f2cf54bdd"
TEXT = "No, Meraxes. I do not do favours in chat."

src = db.game_chat_messages.find_one(
    {"id": SRC_ID},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if not src:
    raise SystemExit("source missing")
already = db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": SRC_ID},
    {"_id": 0, "id": 1},
)
if already:
    print("already", already)
else:
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
