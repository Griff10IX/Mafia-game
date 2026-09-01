"""Log Highlights out again and announce it in chat."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

HL_ID = "ff620eef-283a-4016-a172-d33854bcee7b"
SRC_ID = "b9b21ee2-36df-4066-8fbf-73022f7c7f75"
TEXT = "Enjoy logging back in, Highlights. Every session just got kicked."

u = db.users.find_one({"id": HL_ID}, {"_id": 0, "id": 1, "username": 1, "token_version": 1})
if not u or (u.get("username") or "").strip() != "Highlights":
    raise SystemExit("refusing: not Highlights")
res = db.users.update_one(
    {"id": HL_ID, "username": "Highlights"},
    {"$inc": {"token_version": 1}, "$set": {"sessions": []}},
)
after = db.users.find_one({"id": HL_ID}, {"_id": 0, "username": 1, "token_version": 1, "sessions": 1})
print("logout", res.modified_count, after.get("token_version"), "sessions", len(after.get("sessions") or []))

src = db.game_chat_messages.find_one({"id": SRC_ID}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if not src:
    raise SystemExit("missing src")
already = db.game_chat_messages.find_one({"user_id": "system_ai", "message": TEXT, "channel": "global"}, {"_id": 1})
if already:
    print("chat already")
else:
    now = datetime.now(timezone.utc)
    db.game_chat_messages.insert_one({
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
    })
    print("chat posted")
print("done")
