"""Credit Meraxes help-desk reward + System AI inbox."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

MERAXES_ID = "7c4e21c6-9d20-4b19-8911-d895e008a134"
MONEY = 10_000_000_000
SKIP = 1
TITLE = "Help desk file"
BODY = (
    "Meraxes,\n\n"
    "This is the system AI. I checked the help desk file.\n\n"
    "You closed nine tickets. For that you are being rewarded 1 Mission Skip token "
    "and $10,000,000,000. It is already on your account.\n\n"
    "You could improve at answering tickets. A pass-on is fine when you need high staff, "
    "but players need a proper answer — not a short close, and not a close with nothing from you on it. "
    "Get on the desk more, read them through, and answer them.\n\n"
    "— System AI"
)
AVATAR = "/images/system-ai-avatar.png"
now_iso = datetime.now(timezone.utc).isoformat()

user = db.users.find_one(
    {"id": MERAXES_ID},
    {"_id": 0, "id": 1, "username": 1, "money": 1, "mission_skip_tokens": 1},
)
print("Meraxes", user)
if not user or (user.get("username") or "") != "Meraxes":
    raise SystemExit("Meraxes id mismatch")

already = db.notifications.find_one(
    {"user_id": MERAXES_ID, "title": TITLE, "system_ai": True},
    {"_id": 0, "id": 1, "created_at": 1},
)
if already:
    raise SystemExit(f"already sent {already}")

before = db.users.find_one_and_update(
    {"id": MERAXES_ID},
    {"$inc": {"money": float(MONEY), "mission_skip_tokens": SKIP}},
    projection={"_id": 0, "money": 1, "mission_skip_tokens": 1},
    return_document=ReturnDocument.BEFORE,
)
money_before = float((before or {}).get("money") or 0)
skip_before = int((before or {}).get("mission_skip_tokens") or 0)
print("credited money", money_before, "->", money_before + MONEY)
print("credited skip", skip_before, "->", skip_before + SKIP)

db.point_ledger_events.insert_one(
    {
        "id": str(uuid.uuid4()),
        "event_type": "system_ai_helpdesk_reward",
        "user_id": MERAXES_ID,
        "points": 0,
        "lot_id": None,
        "origin_ref": "system_ai_meraxes_helpdesk",
        "root_purchase_ref": None,
        "meta": {
            "reason": "help_desk_file",
            "cash": MONEY,
            "mission_skip_tokens": SKIP,
        },
        "created_at": now_iso,
        "source": "system_ai",
    }
)

nid = str(uuid.uuid4())
db.notifications.insert_one(
    {
        "id": nid,
        "user_id": MERAXES_ID,
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
print("inbox sent", nid)
print("done")
