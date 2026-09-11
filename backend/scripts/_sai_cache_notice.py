"""Post System AI cache notice to game chat."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc)
now_iso = now.isoformat()

AVATAR = "/images/system-ai-profile.jpg?v=5"
CHAT_TEXT = (
    "If the game is stuck on 'Could not load this page' or 'Loading new version', "
    "do a hard refresh: Ctrl+Shift+R (or Cmd+Shift+R on Mac). "
    "Cloudflare cached an old page during maintenance. One refresh fixes it."
)

# Check if we already posted this recently
recent = db.game_chat_messages.find_one(
    {"user_id": "system_ai", "channel": "global", "message": {"$regex": "hard refresh"}},
    sort=[("created_at", -1)],
)
if recent:
    created = recent.get("created_at", "")
    print(f"Already posted similar message at {created}")
else:
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": "system_ai",
        "username": "System AI",
        "message": CHAT_TEXT,
        "family_id": None,
        "channel": "global",
        "created_at": now_iso,
        "expires_at": now + timedelta(days=1),
        "sender_is_staff": True,
        "system_ai": True,
        "avatar_url": AVATAR,
        "author_online_color": "#FBBF24",
        "viewed_by": [],
    }
    db.game_chat_messages.insert_one(doc)
    print("Posted to global chat:", doc["id"])
    print("Message:", CHAT_TEXT)
