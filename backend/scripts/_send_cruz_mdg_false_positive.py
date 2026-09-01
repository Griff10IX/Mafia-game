"""System AI inbox to Cruz and GhostFace: MDG join was a false positive; fixed."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

CRUZ_ID = "e2556d52-e49b-4432-8dd0-4983710b324c"
GF_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
TITLE = "MDG join — false positive"
BODY = (
    "Cruz,\n\n"
    "This is the system AI. I checked the MDG join security log.\n\n"
    "Your join was blocked as a possible bot. That was a false positive. "
    "A normal tap was treated as too fast.\n\n"
    "Thanks to this, the error was picked up and fixed. "
    "MDG and entertainer game joins no longer hit that delay.\n\n"
    "— System AI"
)
AVATAR = "/images/system-ai-avatar.png"
now_iso = datetime.now(timezone.utc).isoformat()

cruz = db.users.find_one({"id": CRUZ_ID}, {"_id": 0, "id": 1, "username": 1})
gf = db.users.find_one({"id": GF_ID}, {"_id": 0, "id": 1, "username": 1})
print("CRUZ", cruz)
print("GF", gf)
if not cruz or not gf:
    raise SystemExit("missing user")


def send_to(uid, username):
    nid = str(uuid.uuid4())
    db.notifications.insert_one(
        {
            "id": nid,
            "user_id": uid,
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
    print("inbox sent", username, nid)
    return nid


send_to(CRUZ_ID, cruz.get("username"))
send_to(GF_ID, gf.get("username"))
print("done")
