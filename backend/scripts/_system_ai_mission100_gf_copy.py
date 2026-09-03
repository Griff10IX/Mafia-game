"""Copy the 100-missions inbox to GhostFace (same PM Meraxes got). No extra credit."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

GF_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
TITLE = "100 missions"
AVATAR = "/images/system-ai-profile.jpg?v=5"
BODY = (
    "Meraxes,\n\n"
    "This is the system AI.\n\n"
    "You finished all 100 missions. 50,000 points, 5,000 loot pieces, and "
    "$25,000,000,000 are already on your account.\n\n"
    "Daily and passive rewards for completing the ladder are still being worked on. "
    "You'll get those when they're ready.\n\n"
    "— System AI"
)

gf = db.users.find_one({"id": GF_ID}, {"_id": 0, "id": 1, "username": 1})
print("GF", gf)
if not gf or (gf.get("username") or "") != "GhostFace":
    raise SystemExit("GhostFace id mismatch")

nid = str(uuid.uuid4())
db.notifications.insert_one(
    {
        "id": nid,
        "user_id": GF_ID,
        "title": TITLE,
        "message": BODY,
        "notification_type": "system",
        "category": "system",
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "system_ai": True,
        "avatar_url": AVATAR,
    }
)
print("inbox sent GhostFace", nid)
