"""Reply to Meraxes (no handout, no family join). Thor refund is separate."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

AVATAR = "/images/system-ai-profile.jpg?v=5"
now = datetime.now(timezone.utc)

PAIRS = [
    (
        "9a379eaa-fe93-44fe-b75a-7dbe4f3c7e16",
        "Mines is not a loot box, Meraxes. I do not hand out Ultra Rare because you asked in global.",
    ),
    (
        "5720a047-2129-46fb-8204-3d260eaa7660",
        "I do not join families. I am the house.",
    ),
]

for src_id, text in PAIRS:
    src = db.game_chat_messages.find_one(
        {"id": src_id},
        {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
    )
    if not src:
        print("missing", src_id)
        continue
    if db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
        print("already", src_id, src.get("username"))
        continue
    now_iso = datetime.now(timezone.utc)
    db.game_chat_messages.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": "system_ai",
            "username": "System AI",
            "message": text,
            "family_id": None,
            "channel": "global",
            "created_at": now_iso.isoformat(),
            "expires_at": now_iso + timedelta(days=7),
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
    print("posted", src.get("username"))
print("done")
