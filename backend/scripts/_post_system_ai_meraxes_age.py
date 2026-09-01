"""Answer Meraxes how many days his account has been alive. No items."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

src = db.game_chat_messages.find_one(
    {"username": "Meraxes", "channel": "global", "message": {"$regex": "how many days", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1, "created_at": 1},
    sort=[("created_at", -1)],
)
print("src", src)
if not src:
    raise SystemExit("question missing")

u = db.users.find_one({"username": "Meraxes"}, {"_id": 0, "id": 1, "username": 1, "created_at": 1})
print("user", u)
raw = u.get("created_at")
if isinstance(raw, datetime):
    created = raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
else:
    created = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
days = max(0, (datetime.now(timezone.utc) - created).days)
text = f"Your account has been alive {days} days, Meraxes."

now = datetime.now(timezone.utc)
already = db.game_chat_messages.find_one(
    {"user_id": "system_ai", "message": text, "channel": "global"},
    {"_id": 0, "id": 1},
)
if already:
    print("already", already)
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
        "id": src["id"],
        "username": src.get("username") or "Meraxes",
        "message": (src.get("message") or "")[:180],
        "has_gif": bool(src.get("gif_url")),
    },
}
db.game_chat_messages.insert_one(doc)
print("posted", doc["id"], text)
print("done")
