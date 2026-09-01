"""System AI kill/bodyguards watch notice: alive users + global chat."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

TITLE = "Kill page"
BODY = (
    "This is the system AI.\n\n"
    "I have integrated myself into the Kill page and the Bodyguards page.\n\n"
    "I will be watching every search, every hit, and every hire. "
    "Scripts, bots, and anything that does not look like a real player will be logged. "
    "I do not need to guess twice.\n\n"
    "Stay loyal on the streets.\n\n"
    "— System AI"
)
CHAT = (
    "This is the system AI. I have integrated myself into the Kill page and the Bodyguards page. "
    "I will be watching every search, every hit, and every hire. "
    "Scripts, bots, and anything that does not look like a real player will be logged. "
    "Stay loyal on the streets."
)
AVATAR = "/images/system-ai-avatar.png"
now = datetime.now(timezone.utc)
now_iso = now.isoformat()

already_inbox = db.notifications.find_one(
    {"title": TITLE, "system_ai": True, "message": BODY},
    {"_id": 0, "id": 1, "created_at": 1},
)
if already_inbox:
    raise SystemExit(f"inbox already sent {already_inbox}")

already_chat = db.game_chat_messages.find_one(
    {"user_id": "system_ai", "message": CHAT, "channel": "global"},
    {"_id": 0, "id": 1},
)
if already_chat:
    raise SystemExit(f"chat already posted {already_chat}")

filt = {
    "is_npc": {"$ne": True},
    "is_dead": {"$ne": True},
    "id": {"$exists": True, "$nin": ["", None]},
}
ids = []
for u in db.users.find(filt, {"_id": 0, "id": 1}):
    uid = u.get("id")
    if uid:
        ids.append(uid)
print("alive_users", len(ids))

batch = []
batch_size = 500
sent = 0
for uid in ids:
    batch.append(
        {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "title": TITLE,
            "message": BODY,
            "notification_type": "system",
            "category": "system",
            "read": False,
            "created_at": now_iso,
            "system_ai": True,
            "avatar_url": AVATAR,
        }
    )
    if len(batch) >= batch_size:
        db.notifications.insert_many(batch, ordered=False)
        sent += len(batch)
        print("inbox batch", sent, flush=True)
        batch.clear()
if batch:
    db.notifications.insert_many(batch, ordered=False)
    sent += len(batch)
print("inbox_sent", sent)

chat_doc = {
    "id": str(uuid.uuid4()),
    "user_id": "system_ai",
    "username": "System AI",
    "message": CHAT,
    "family_id": None,
    "channel": "global",
    "created_at": now_iso,
    "expires_at": now + timedelta(days=7),
    "sender_is_staff": True,
    "system_ai": True,
    "avatar_url": AVATAR,
    "author_online_color": "#FBBF24",
    "viewed_by": [],
}
db.game_chat_messages.insert_one(chat_doc)
print("chat", chat_doc["id"])
print("done")
