"""Unlock Highlights after GhostFace said so."""
import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

HL_ID = "ff620eef-283a-4016-a172-d33854bcee7b"
hl = db.users.find_one({"id": HL_ID}, {"_id": 0, "id": 1, "username": 1, "email": 1, "account_locked": 1, "account_locked_until": 1})
print("before", hl)
if not hl or (hl.get("username") or "") != "Highlights":
    raise SystemExit("Highlights mismatch")

r = db.users.update_one(
    {"id": HL_ID, "username": "Highlights"},
    {
        "$set": {"account_locked": False},
        "$unset": {
            "account_locked_at": "",
            "account_locked_comment": "",
            "account_locked_comment_at": "",
            "account_locked_until": "",
            "account_locked_admin_message": "",
            "account_locked_admin_message_at": "",
            "account_locked_user_reply": "",
            "account_locked_user_reply_at": "",
        },
    },
)
email_clean = (hl.get("email") or "").strip().lower()
if email_clean:
    db.login_lockouts.delete_one({"email": email_clean})
after = db.users.find_one(
    {"id": HL_ID},
    {"_id": 0, "username": 1, "account_locked": 1, "account_locked_until": 1},
)
print("modified", r.modified_count)
print("after", after)
print("done")
