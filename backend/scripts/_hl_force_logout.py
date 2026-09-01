"""Log Highlights out. No chat."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

HL_ID = "ff620eef-283a-4016-a172-d33854bcee7b"

u = db.users.find_one({"id": HL_ID}, {"_id": 0, "id": 1, "username": 1, "token_version": 1})
print("before", u)
if not u or (u.get("username") or "").strip() != "Highlights":
    raise SystemExit("refusing: not Highlights")
res = db.users.update_one(
    {"id": HL_ID, "username": "Highlights"},
    {"$inc": {"token_version": 1}, "$set": {"sessions": []}},
)
after = db.users.find_one({"id": HL_ID}, {"_id": 0, "username": 1, "token_version": 1, "sessions": 1})
print("modified", res.modified_count)
print("after", {"username": after.get("username"), "token_version": after.get("token_version"), "sessions": len(after.get("sessions") or [])})
print("done")
