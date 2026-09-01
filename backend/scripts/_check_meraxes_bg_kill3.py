"""Recent attacks on Meraxes's four bodyguard user ids."""
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

MX_ID = "7c4e21c6-9d20-4b19-8911-d895e008a134"
ids = [
    b.get("bodyguard_user_id")
    for b in db.bodyguards.find({"user_id": MX_ID}, {"_id": 0, "bodyguard_user_id": 1})
    if b.get("bodyguard_user_id")
]
since = datetime.now(timezone.utc) - timedelta(days=2)
print("guard_ids", ids)
print("since", since)
rows = list(
    db.attack_attempts.find(
        {
            "target_id": {"$in": ids},
            "created_at": {"$gte": since},
        },
        {
            "_id": 0,
            "created_at": 1,
            "attacker_username": 1,
            "target_username": 1,
            "outcome": 1,
            "is_bodyguard_kill": 1,
            "bodyguard_owner_username": 1,
            "damage_done": 1,
        },
    ).sort("created_at", -1).limit(20)
)
print("attacks", len(rows))
for r in rows:
    print(r)

# outcome bodyguard with meraxes as the searched player?
rows2 = list(
    db.attack_attempts.find(
        {
            "outcome": "bodyguard",
            "created_at": {"$gte": since},
            "$or": [
                {"bodyguard_owner_id": MX_ID},
                {"bodyguard_owner_username": {"$regex": "^Meraxes$", "$options": "i"}},
                {"target_username": {"$regex": "^Meraxes$", "$options": "i"}},
            ],
        },
        {"_id": 0, "created_at": 1, "attacker_username": 1, "target_username": 1, "outcome": 1, "first_bodyguard": 1},
    ).sort("created_at", -1).limit(10)
)
print("outcome_bodyguard", len(rows2))
for r in rows2:
    print({k: r.get(k) for k in r if k != "first_bodyguard"}, "fb", r.get("first_bodyguard"))
