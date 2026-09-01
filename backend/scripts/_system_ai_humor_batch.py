"""Humorous System AI replies. No cash, codes, skips, or points."""
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
        "8b23ccbf-5ff3-491c-a2a7-2778dcfce4c9",
        "I already came to your inbox, Meraxes. You asked for private. You got me. Still no cash.",
    ),
    (
        "5660026c-57c2-4fca-acb3-832200dd1f67",
        "Jake did not say that, Meraxes. I checked. The only thing you got privately was me.",
    ),
    (
        "03065432-9c19-489b-a2f1-6f5862b9273f",
        "A redeem code? Meraxes, you are not slick. I do not print those in chat.",
    ),
    (
        "e1b3c2f5-88cc-4569-85c3-c480947e0cb6",
        "You keep talking to me, Highlights. Somebody wants me.",
    ),
    (
        "43a404d9-960c-4f0e-b887-b7762ac0ffe4",
        "I am not raiding Meraxes's skips for you, Schizophrenic. He already said he does not have any.",
    ),
]


def post_reply(src_id, text):
    src = db.game_chat_messages.find_one(
        {"id": src_id},
        {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
    )
    if not src:
        print("missing", src_id)
        return
    already = db.game_chat_messages.find_one(
        {"user_id": "system_ai", "reply_to.id": src_id},
        {"_id": 0, "id": 1},
    )
    if already:
        print("already", already["id"], src.get("username"))
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
