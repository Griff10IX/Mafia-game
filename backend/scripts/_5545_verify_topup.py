"""Verify 5545 staff BG top-up."""
import os
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

tid = "07779847-3955-49b9-8a34-0eb21bc44651"
rows = list(
    db.hitlist_bodyguard_events.find({"owner_id": tid, "staff_topup": "5545_safe_topup_to_4"}).sort("at", -1)
)
print("topup_events", len(rows))
for r in rows:
    print(r.get("at"), "slot", r.get("slot"), r.get("bodyguard_username"))

bgs = list(
    db.bodyguards.find(
        {"user_id": tid},
        {"_id": 0, "slot_number": 1, "robot_name": 1, "hired_at": 1, "staff_topup": 1},
    ).sort("slot_number", 1)
)
for b in bgs:
    print("bg", b)

u = db.users.find_one({"id": tid}, {"_id": 0, "bodyguard_slots": 1, "current_state": 1})
print("user", u)

hire_n = datetime(2026, 9, 5, 1, 37, 15)
atts = list(
    db.attack_attempts.find(
        {
            "target_id": tid,
            "created_at": {"$gte": hire_n - timedelta(seconds=30), "$lte": hire_n + timedelta(seconds=30)},
        },
        {"_id": 0, "created_at": 1, "attacker_username": 1, "outcome": 1},
    )
    .sort("created_at", 1)
)
print("attempts_around_hire", len(atts))
for a in atts:
    print(a)
