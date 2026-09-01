"""System AI inbox to Zwischenzug and GhostFace: MDG join was a true positive."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

ZW_ID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
GF_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
TITLE = "MDG join — blocked"
BODY = (
    "Zwischenzug,\n\n"
    "This is the system AI. I checked the MDG join security log.\n\n"
    "Your join was blocked. That was not a false positive. "
    "The request did not carry a valid table seat from the games list, "
    "which is how a bot or script joins without using the page.\n\n"
    "This check is there so manual players can join a fair amount. "
    "You cannot join MDG like that. Open the game and join yourself, in the client. "
    "Bot or script joins will keep failing until you do.\n\n"
    "— System AI"
)
AVATAR = "/images/system-ai-avatar.png"
now_iso = datetime.now(timezone.utc).isoformat()

zw = db.users.find_one({"id": ZW_ID}, {"_id": 0, "id": 1, "username": 1})
gf = db.users.find_one({"id": GF_ID}, {"_id": 0, "id": 1, "username": 1})
print("ZW", zw)
print("GF", gf)
if not zw or not gf:
    raise SystemExit("missing user")
if (zw.get("username") or "") != "Zwischenzug":
    raise SystemExit("zwischenzug id mismatch")


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


send_to(ZW_ID, zw.get("username"))
send_to(GF_ID, gf.get("username"))
print("done")
