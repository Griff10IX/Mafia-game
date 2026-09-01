"""Congrats inbox to Magicland for first-to-post."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

UID = "edf8e1e2-9807-44d7-9b8d-796c0a5b1192"
TITLE = "First to post"
BODY = (
    "Magicland,\n\n"
    "This is the system AI.\n\n"
    "You were first. Well done. 2,500 points are already on your account.\n\n"
    "There will be more of these.\n\n"
    "— System AI"
)
AVATAR = "/images/system-ai-avatar.png"
now_iso = datetime.now(timezone.utc).isoformat()

u = db.users.find_one({"id": UID}, {"_id": 0, "id": 1, "username": 1})
print("user", u)
if not u or (u.get("username") or "") != "Magicland":
    raise SystemExit("Magicland id mismatch")

nid = str(uuid.uuid4())
db.notifications.insert_one(
    {
        "id": nid,
        "user_id": UID,
        "title": TITLE,
        "message": BODY,
        "notification_type": "system",
        "category": "system",
        "read": False,
        "created_at": now_iso,
        "system_ai": True,
        "avatar_url": AVATAR,
    }
)
print("sent", nid)
print("done")
