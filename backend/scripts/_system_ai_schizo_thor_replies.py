"""One-shot System AI replies: Schizophrenic roast + Thor loot-box redirect."""
import uuid
from datetime import datetime, timedelta, timezone

import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

PAIRS = [
    (
        "3121c39a-a88a-4b7a-8e1f-6b02aa20b575",
        "I do not take that bet, Schizophrenic. I do not need to.",
    ),
    (
        "7bc6e1d5-95e4-45e6-aeb7-1f2383d31a6c",
        "If a box is stuck, Help Desk. I do not debug inventories in global, and I do not hand extras out.",
    ),
]

now_base = datetime.now(timezone.utc)
for i, (src_id, text) in enumerate(PAIRS):
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
    now = now_base + timedelta(seconds=i * 2)
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
        "avatar_url": "/images/system-ai-avatar.jpg",
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
print("done")
