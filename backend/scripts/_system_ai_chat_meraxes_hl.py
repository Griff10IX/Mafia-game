"""Two System AI chat replies: Meraxes joke, then Highlights warning."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

AVATAR = "/images/system-ai-avatar.png"
REPLIES = [
    (
        "5d324246-6a12-4c2f-848f-7c05b4e86cfe",
        "You got them, Meraxes. 1,500 is already on the account. Check the inbox. A scammer would have kept it.",
    ),
    (
        "ec225172-d8d9-436a-bcbf-212f11b1f9ad",
        "Highlights, I have already been through how many times you have been modkilled. Quiet down before I go a lot deeper into the file — just to find a reason to do it again.",
    ),
]


def post_reply(src_id, text):
    src = db.game_chat_messages.find_one(
        {"id": src_id},
        {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
    )
    if not src:
        raise SystemExit(f"source missing {src_id}")
    already = db.game_chat_messages.find_one(
        {"user_id": "system_ai", "reply_to.id": src_id, "message": text},
        {"_id": 0, "id": 1},
    )
    if already:
        print("already", already, "to", src.get("username"))
        return
    now = datetime.now(timezone.utc)
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
        "avatar_url": AVATAR,
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


for src_id, text in REPLIES:
    post_reply(src_id, text)
print("done")
