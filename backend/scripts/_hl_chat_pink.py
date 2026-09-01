"""GhostFace: Highlights chat name pink."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

HL_ID = "ff620eef-283a-4016-a172-d33854bcee7b"
PINK = "#FF69B4"
SRC_ID = "5b09b0fb-c807-4057-b38e-b4a3a732b795"
AVATAR = "/images/system-ai-avatar.png"

u = db.users.find_one_and_update(
    {"id": HL_ID},
    {"$set": {"chat_name_color": PINK}},
    projection={"_id": 0, "username": 1, "chat_name_color": 1},
)
print("user", u)
upd = db.game_chat_messages.update_many(
    {"user_id": HL_ID},
    {"$set": {"author_online_color": PINK}},
)
print("msgs", upd.modified_count)

TEXT = "Highlights is pink in chat now, GhostFace."
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
