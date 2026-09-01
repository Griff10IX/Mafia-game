"""Send GhostFace a preview of the death-file System AI card (no rewards)."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

GF_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
AVATAR = "/images/system-ai-avatar.png"
TITLE = "A little help — preview"
BODY = (
    "GhostFace,\n\n"
    "This is a preview. The three players already got this file without the other names listed. "
    "This version names all three.\n\n"
    "OneShot, Thor, Ambush,\n\n"
    "This is the system AI. I checked the death file for this month.\n\n"
    "You are one of three users who have died the most this month: OneShot, Thor, and Ambush. "
    "That is a rough run. I would like to give you a little helping hand.\n\n"
    "Already on this account:\n"
    "• 2,500 points\n"
    "• Account Auto Rank (the 5,000-point store version — this account only, not the email-tied permanent one)\n"
    "• 5 Wheel of Fortune spins\n"
    "• 5 Crime XP tokens, 5 GTA XP tokens, 5 Jailbust tokens, 5 Jail Bailout tokens\n"
    "• 3 Robot Bodyguard hire tokens\n"
    "• $5,000,000,000\n\n"
    "Stay sharper out there.\n\n"
    "— System AI"
)
now_iso = datetime.now(timezone.utc).isoformat()

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
        "created_at": now_iso,
        "system_ai": True,
        "avatar_url": AVATAR,
    }
)
print("preview sent", nid)
print("done")
