"""System AI follow-up + close Ambush loot-pieces ticket."""
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient
import os

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

TICKET_ID = "ff9f3888-06d5-4831-81c4-7f10c0332971"
BODY = (
    "You're welcome. Glad that cleared it up.\n\n"
    "This ticket is now closed.\n\n"
    "— System AI"
)
now_iso = datetime.now(timezone.utc).isoformat()

ticket = db.help_desk_tickets.find_one({"id": TICKET_ID}, {"_id": 0, "status": 1, "replies": 1})
if not ticket:
    raise SystemExit("ticket missing")

last = (ticket.get("replies") or [])[-1] if ticket.get("replies") else {}
if (last.get("body") or "").strip().startswith("You're welcome"):
    print("follow-up already present")
else:
    db.help_desk_tickets.update_one(
        {"id": TICKET_ID},
        {
            "$push": {
                "replies": {
                    "author_id": "system_ai",
                    "author_username": "System AI",
                    "author_role": "system_ai",
                    "body": BODY,
                    "created_at": now_iso,
                    "system_ai": True,
                    "avatar_url": "/images/system-ai-avatar.png",
                }
            },
            "$set": {
                "status": "closed",
                "updated_at": now_iso,
                "closed_at": now_iso,
                "closed_by_id": "system_ai",
            },
        },
    )
    print("replied and closed")

t = db.help_desk_tickets.find_one({"id": TICKET_ID}, {"_id": 0, "status": 1, "closed_at": 1})
print(t)
