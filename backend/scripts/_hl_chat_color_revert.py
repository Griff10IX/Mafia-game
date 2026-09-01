"""GhostFace: revert Highlights chat colour, no restart. Then disable."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

HL_ID = "ff620eef-283a-4016-a172-d33854bcee7b"
SRC_ID = "5eacfc32-95e2-4dcf-9fb5-1bd85257f9a2"
AVATAR = "/images/system-ai-avatar.png"

u = db.users.update_one({"id": HL_ID}, {"$unset": {"chat_name_color": ""}})
print("unset user", u.modified_count)
m = db.game_chat_messages.update_many(
    {"user_id": HL_ID},
    {"$unset": {"author_online_color": ""}},
)
print("unset msgs", m.modified_count)

TEXT = "Colour is back, GhostFace. No restart this time. I'm off."
src = db.game_chat_messages.find_one({"id": SRC_ID}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if not src:
    raise SystemExit("missing src")
already = db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": SRC_ID}, {"_id": 1})
if already:
    print("chat already")
else:
    now = datetime.now(timezone.utc)
    db.game_chat_messages.insert_one(
        {
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
    )
    print("chat posted")
print("done")
