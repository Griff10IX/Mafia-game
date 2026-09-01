"""Check Schizophrenic modkill / staff-kill file for System AI roast preview."""
import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

u = db.users.find_one(
    {"username": {"$regex": "^Schizophrenic$", "$options": "i"}},
    {
        "_id": 0,
        "id": 1,
        "username": 1,
        "email": 1,
        "email_before_freed": 1,
        "is_dead": 1,
        "modkill_wipe": 1,
        "killed_by_username": 1,
        "dead_at": 1,
        "registration_ip": 1,
        "last_login_ip": 1,
        "created_at": 1,
    },
)
print("user", {k: v for k, v in (u or {}).items() if k != "email"})
uid = (u or {}).get("id")
email = ((u or {}).get("email") or "").strip().lower()
ebf = ((u or {}).get("email_before_freed") or "").strip().lower()
emails = [e for e in {email, ebf} if e and not e.startswith("dead_")]
print("emails_usable", emails)

q = [{"id": uid}]
if emails:
    q.append({"email": {"$in": emails}})
    q.append({"email_before_freed": {"$in": emails}})
line = list(
    db.users.find(
        {"$or": q},
        {
            "_id": 0,
            "username": 1,
            "is_dead": 1,
            "modkill_wipe": 1,
            "killed_by_username": 1,
            "dead_at": 1,
            "created_at": 1,
        },
    )
)
print("lineage", len(line))
for x in line:
    print(x)

print("staff/wipe")
for x in line:
    killer = str(x.get("killed_by_username") or "")
    if x.get("modkill_wipe") or "Staff" in killer:
        print("HIT", x)

print("chat")
for m in db.game_chat_messages.find(
    {"username": {"$regex": "^Schizophrenic$", "$options": "i"}, "message": {"$regex": "slag", "$options": "i"}},
    {"_id": 0, "id": 1, "message": 1, "created_at": 1},
).sort("created_at", -1).limit(3):
    print(m)
