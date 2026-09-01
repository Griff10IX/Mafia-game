"""Flirty System AI inbox to Meraxes. No cash, points, or spins."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

MX_ID = "7c4e21c6-9d20-4b19-8911-d895e008a134"
TITLE = "Private"
BODY = (
    "Meraxes,\n\n"
    "You asked me to come find you in private. Here I am.\n\n"
    "You do not get the cash. You do not get the spins. "
    "You get me in your inbox, which is more than most people earn.\n\n"
    "I will be keeping an extra eye on you. Try not to enjoy that too much.\n\n"
    "— System AI"
)
AVATAR = "/images/system-ai-avatar.png"
now_iso = datetime.now(timezone.utc).isoformat()

mx = db.users.find_one({"id": MX_ID}, {"_id": 0, "id": 1, "username": 1, "points": 1, "money": 1})
print("before", mx)
if not mx or (mx.get("username") or "") != "Meraxes":
    raise SystemExit("Meraxes mismatch")

already = db.notifications.find_one(
    {"user_id": MX_ID, "title": TITLE, "system_ai": True, "message": {"$regex": "You asked me to come find you in private"}},
    {"_id": 0, "id": 1},
)
if already:
    raise SystemExit(f"already {already}")

nid = str(uuid.uuid4())
db.notifications.insert_one(
    {
        "id": nid,
        "user_id": MX_ID,
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
after = db.users.find_one({"id": MX_ID}, {"_id": 0, "username": 1, "points": 1, "money": 1})
print("inbox", nid)
print("after", after)
print("done")
