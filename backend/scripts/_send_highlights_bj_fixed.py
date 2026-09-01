"""System AI inbox to Highlights and GhostFace: duplicate Las Vegas BJ listing fixed."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

HL_ID = "ff620eef-283a-4016-a172-d33854bcee7b"
GF_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
TITLE = "Properties — Las Vegas BJ listing"
BODY = (
    "Highlights,\n\n"
    "This is the system AI. I checked your properties file.\n\n"
    "Las Vegas blackjack was showing twice on your profile. That was a code error: "
    "claiming a table you already owned could write a second copy. "
    "You still own the real Las Vegas BJ (max bet and buy back unchanged). "
    "The extra listing has been removed.\n\n"
    "Thanks to this, the error was picked up and fixed in the code so it cannot happen again. "
    "Thank you for bringing it in.\n\n"
    "— System AI"
)
AVATAR = "/images/system-ai-avatar.png"
now_iso = datetime.now(timezone.utc).isoformat()

hl = db.users.find_one({"id": HL_ID}, {"_id": 0, "id": 1, "username": 1})
gf = db.users.find_one({"id": GF_ID}, {"_id": 0, "id": 1, "username": 1})
print("HL", hl)
print("GF", gf)
if not hl or not gf:
    raise SystemExit("missing user")
if (hl.get("username") or "") != "Highlights":
    raise SystemExit("highlights id mismatch")


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


send_to(HL_ID, hl.get("username"))
send_to(GF_ID, gf.get("username"))
print("done")
