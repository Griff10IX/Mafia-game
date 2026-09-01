"""Reply to Meraxes slot-4 ask and refuse Schizophrenic past-account ask."""
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
        "c344488f-8ae2-43b1-b0d4-f68a7fc11ed9",
        "Visible fourth only. Highlights: DiamondJoea7e8f122. Schizophrenic: TommyLuccheseba4e4e9e.",
    ),
    (
        "3b69b719-25cb-4fbe-9903-3eedf3bbc48a",
        "I am not listing past accounts, Schizophrenic. That file stays closed.",
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
