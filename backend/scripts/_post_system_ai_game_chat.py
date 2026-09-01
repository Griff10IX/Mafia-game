"""Post System AI greeting to global game chat."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc)
msg = (os.environ.get("CHAT_TEXT") or "").strip() or "This is the system AI. Wishing you all a good day."
already = db.game_chat_messages.find_one(
    {"user_id": "system_ai", "message": msg, "channel": "global"},
    {"_id": 0, "id": 1, "created_at": 1},
)
if already:
    print("already posted", already)
    raise SystemExit(0)

doc = {
    "id": str(uuid.uuid4()),
    "user_id": "system_ai",
    "username": "System AI",
    "message": msg,
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
db.game_chat_messages.insert_one(doc)
print("posted", doc["id"], doc["created_at"])
print("done")
