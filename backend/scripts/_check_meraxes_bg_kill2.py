"""Broader check: any recent Meraxes-related bodyguard hits."""
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

MX_ID = "7c4e21c6-9d20-4b19-8911-d895e008a134"
since = datetime.now(timezone.utc) - timedelta(days=3)

# sample one bodyguard kill to see fields
sample = db.attack_attempts.find_one(
    {"is_bodyguard_kill": True},
    {"_id": 0},
    sort=[("created_at", -1)],
)
print("sample_keys", sorted((sample or {}).keys()))
print("sample", {k: (sample or {}).get(k) for k in [
    "created_at", "attacker_username", "defender_username", "success", "result",
    "killed", "is_kill", "outcome", "bodyguard_owner_id", "bodyguard_owner_username",
    "is_bodyguard_kill", "integrity_violation",
]})

print("\n--- meraxes owner ---")
for r in db.attack_attempts.find(
    {"$or": [
        {"bodyguard_owner_id": MX_ID},
        {"bodyguard_owner_username": {"$regex": "^Meraxes$", "$options": "i"}},
    ]},
    {"_id": 0, "created_at": 1, "attacker_username": 1, "defender_username": 1,
     "success": 1, "result": 1, "killed": 1, "is_kill": 1, "bodyguard_owner_username": 1},
).sort("created_at", -1).limit(8):
    print(r)

# his current slot 4 name
bg = db.bodyguards.find_one({"user_id": MX_ID, "slot_number": 4}, {"_id": 0, "bodyguard_user_id": 1, "robot_name": 1})
g = db.users.find_one({"id": (bg or {}).get("bodyguard_user_id")}, {"_id": 0, "username": 1, "is_dead": 1, "dead_at": 1})
print("\nslot4", (bg or {}).get("robot_name"), g)

# empty slots vs filled
bgs = list(db.bodyguards.find({"user_id": MX_ID}, {"_id": 0, "slot_number": 1, "robot_name": 1, "bodyguard_user_id": 1, "is_robot": 1}))
print("slots", [{"slot": b.get("slot_number"), "robot": b.get("robot_name"), "uid": b.get("bodyguard_user_id")} for b in bgs])
