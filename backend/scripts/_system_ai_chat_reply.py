"""One-off System AI chat reply by source message id."""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

src_id = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
text = (os.environ.get("REPLY_TEXT") or "").strip()
if not src_id or not text:
    raise SystemExit("need id + REPLY_TEXT")

src = db.game_chat_messages.find_one({"id": src_id}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if not src:
    raise SystemExit("source missing")

already = db.game_chat_messages.find_one(
    {"user_id": "system_ai", "message": text, "channel": "global"},
    {"_id": 0, "id": 1},
)
if already:
    print("already", already)
    raise SystemExit(0)

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
