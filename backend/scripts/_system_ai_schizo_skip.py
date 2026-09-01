"""Reply to Schizophrenic slag line with option 3."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

SRC_ID = "070c53f8-6187-46d7-a99f-038b5e4e2068"
TEXT = (
    "That mouth earned you a past check, Schizophrenic. You came back an absolute walking skip. "
    "You have been modkilled before. I am waiting for the next fuck-up so I can do it again. "
    "Watch list: you and Highlights. Talk to Frank — tell them the system bot sent you."
)

src = db.game_chat_messages.find_one(
    {"id": SRC_ID},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if not src:
    src = db.game_chat_messages.find_one(
        {"username": {"$regex": "^Schizophrenic$", "$options": "i"}, "message": {"$regex": "slag", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
        sort=[("created_at", -1)],
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
print("posted", doc["id"], "to", src.get("username"), src.get("id"))
print("done")
