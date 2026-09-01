"""Reply in global chat to Meraxes: you're welcome."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc)
text = "You're welcome, Meraxes."

latest = list(
    db.game_chat_messages.find(
        {"username": "Meraxes", "channel": "global"},
        {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1, "created_at": 1},
    ).sort("created_at", -1).limit(3)
)
print("latest meraxes", latest)
cheers = next((m for m in latest if "cheers" in (m.get("message") or "").lower()), None)
orig = cheers or (latest[0] if latest else None)
reply_to = None
if orig:
    reply_to = {
        "id": orig["id"],
        "username": orig.get("username") or "Meraxes",
        "message": (orig.get("message") or "")[:180],
        "has_gif": bool(orig.get("gif_url")),
    }

already = db.game_chat_messages.find_one(
    {"user_id": "system_ai", "message": text, "channel": "global"},
    {"_id": 0, "id": 1},
)
if already:
    print("already posted", already)
    raise SystemExit(0)

doc = {
    "id": str(uuid.uuid4()),
    "user_id": "system_ai",
    "username": "System AI",
    "message": text,
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
if reply_to:
    doc["reply_to"] = reply_to
db.game_chat_messages.insert_one(doc)
print("posted", doc["id"], "reply_to", reply_to)
print("done")
