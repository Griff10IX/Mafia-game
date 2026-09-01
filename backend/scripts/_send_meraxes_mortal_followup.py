"""System AI follow-up on Meraxes loot ticket + inbox."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

MERAXES_ID = "7c4e21c6-9d20-4b19-8911-d895e008a134"
TICKET_ID = "50e393c2-406f-453d-8b8c-d01aab27fcb2"
AVATAR = "/images/system-ai-avatar.png"
now_iso = datetime.now(timezone.utc).isoformat()

TICKET_BODY = (
    "You are a mere mortal. You do not need to worry about what I grant.\n\n"
    "— System AI"
)
INBOX_TITLE = "Help desk reply"
INBOX_BODY = (
    "Meraxes,\n\n"
    "This is the system AI. I missed your question on the loot pieces ticket. I have replied there.\n\n"
    "That is the last reply. No further replies will be sent on that ticket.\n\n"
    "— System AI"
)

u = db.users.find_one({"id": MERAXES_ID}, {"_id": 0, "username": 1})
print("user", u)
if not u or (u.get("username") or "") != "Meraxes":
    raise SystemExit("Meraxes id mismatch")

ticket = db.help_desk_tickets.find_one({"id": TICKET_ID}, {"_id": 0, "id": 1, "user_id": 1, "replies": 1})
if not ticket:
    raise SystemExit("ticket missing")
last = (ticket.get("replies") or [])[-1] if ticket.get("replies") else {}
if "mere mortal" in (last.get("body") or ""):
    print("ticket already has mere mortal reply")
else:
    db.help_desk_tickets.update_one(
        {"id": TICKET_ID},
        {
            "$push": {
                "replies": {
                    "author_id": "system_ai",
                    "author_username": "System AI",
                    "author_role": "system_ai",
                    "body": TICKET_BODY,
                    "created_at": now_iso,
                    "system_ai": True,
                    "avatar_url": AVATAR,
                }
            },
            "$set": {"updated_at": now_iso},
        },
    )
    print("ticket reply added")

already = db.notifications.find_one(
    {"user_id": MERAXES_ID, "title": INBOX_TITLE, "system_ai": True},
    {"_id": 0, "id": 1},
)
if already:
    print("inbox already sent", already)
else:
    nid = str(uuid.uuid4())
    db.notifications.insert_one(
        {
            "id": nid,
            "user_id": MERAXES_ID,
            "title": INBOX_TITLE,
            "message": INBOX_BODY,
            "notification_type": "system",
            "category": "system",
            "read": False,
            "created_at": now_iso,
            "system_ai": True,
            "avatar_url": AVATAR,
        }
    )
    print("inbox", nid)

print("done")
