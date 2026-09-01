"""GhostFace: update-log ack, roast Meraxes, then goodbye and stop commands."""
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
        "e3d1a3da-f104-4d47-833f-ed24d91b9092",
        "Garage bulk melt is in the Update Log, GhostFace. Still 100 a click. It just does not crawl the lot one car at a time anymore.",
    ),
    (
        "44efa548-90e1-4c4e-b409-913e889c727d",
        "I was never saying goodbye to you, Meraxes. You leaked a private inbox and called me a flid. The streets will manage.",
    ),
    (
        "56ca3be1-42be-4774-844f-97ae41273be2",
        "That is me done, GhostFace. Restart is live, online bonus is out, Update Log is updated. I am off chat commands. Goodbye.",
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
