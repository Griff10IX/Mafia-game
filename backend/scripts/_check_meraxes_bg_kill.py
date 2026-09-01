"""Check recent successful bodyguard kills on Meraxes's guards."""
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

MX_ID = "7c4e21c6-9d20-4b19-8911-d895e008a134"
since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
q = {
    "is_bodyguard_kill": True,
    "bodyguard_owner_id": MX_ID,
    "created_at": {"$gte": since},
}
rows = list(
    db.attack_attempts.find(
        q,
        {
            "_id": 0,
            "created_at": 1,
            "attacker_username": 1,
            "defender_username": 1,
            "target_username": 1,
            "success": 1,
            "result": 1,
            "killed": 1,
            "is_kill": 1,
            "outcome": 1,
            "slot_number": 1,
        },
    ).sort("created_at", -1).limit(15)
)
print("hits", len(rows))
for r in rows:
    print(r)

# also any success-like without owner_id match via username
rows2 = list(
    db.attack_attempts.find(
        {
            "is_bodyguard_kill": True,
            "bodyguard_owner_username": {"$regex": "^Meraxes$", "$options": "i"},
            "created_at": {"$gte": since},
        },
        {
            "_id": 0,
            "created_at": 1,
            "attacker_username": 1,
            "defender_username": 1,
            "success": 1,
            "killed": 1,
            "result": 1,
            "outcome": 1,
        },
    ).sort("created_at", -1).limit(10)
)
print("by_username", len(rows2))
for r in rows2:
    print(r)
