"""Quick 5545 BG / hunt snapshot."""
import os
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

u = db.users.find_one(
    {"username": {"$regex": "^5545$", "$options": "i"}},
    {
        "_id": 0,
        "id": 1,
        "username": 1,
        "current_state": 1,
        "is_dead": 1,
        "bodyguard_slots": 1,
        "traveling_to": 1,
        "travel_arrives_at": 1,
    },
)
print("USER", u)
tid = u["id"]
bgs = list(
    db.bodyguards.find(
        {"user_id": tid},
        {"_id": 0, "slot_number": 1, "is_robot": 1, "robot_name": 1, "bodyguard_user_id": 1},
    ).sort("slot_number", 1)
)
print("BGS", bgs)
hunts = list(
    db.attacks.find(
        {"target_id": tid, "status": {"$in": ["searching", "found", "traveling"]}},
        {"_id": 0, "attacker_username": 1, "attacker_id": 1, "status": 1, "location_state": 1},
    )
)
print("HUNTS", hunts)
for h in hunts:
    aid = h.get("attacker_id")
    if aid:
        au = db.users.find_one({"id": aid}, {"_id": 0, "username": 1, "current_state": 1})
        print("  attacker", au)
since = datetime.now(timezone.utc) - timedelta(seconds=30)
atts = list(
    db.attack_attempts.find(
        {"target_id": tid, "created_at": {"$gte": since}},
        {"_id": 0, "created_at": 1, "attacker_username": 1, "outcome": 1},
    )
    .sort("created_at", -1)
    .limit(15)
)
print("RECENT30s", atts)
