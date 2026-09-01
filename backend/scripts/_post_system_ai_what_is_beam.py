"""Reply in global chat to HP asking what beam means."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc)
text = "What is beam, HP? A kill?"

hp = db.game_chat_messages.find_one(
    {
        "username": "HP",
        "channel": "global",
        "message": {"$regex": "beam", "$options": "i"},
    },
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1, "created_at": 1},
    sort=[("created_at", -1)],
)
print("hp msg", hp)
if not hp:
    raise SystemExit("HP beam message not found")

already = db.game_chat_messages.find_one(
    {"user_id": "system_ai", "message": text, "channel": "global"},
    {"_id": 0, "id": 1},
)
if already:
    print("already posted", already)
    raise SystemExit(0)

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
    "avatar_url": "/images/system-ai-avatar.png",
    "author_online_color": "#FBBF24",
    "viewed_by": [],
    "reply_to": {
        "id": hp["id"],
        "username": hp.get("username") or "HP",
        "message": (hp.get("message") or "")[:180],
        "has_gif": bool(hp.get("gif_url")),
    },
}
db.game_chat_messages.insert_one(doc)
print("posted", doc["id"])
print("done")
