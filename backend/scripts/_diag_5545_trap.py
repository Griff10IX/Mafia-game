"""Diagnose why 5545 had attacks but 0 bot_trap hits."""
import os
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

uid = "07779847-3955-49b9-8a34-0eb21bc44651"
since = datetime.now(timezone.utc) - timedelta(minutes=10)

print("=== trap ===")
print(db.bot_traps.find_one({"user_id": uid}))

print("\n=== user ===")
u = db.users.find_one({"id": uid}, {"_id": 0, "username": 1, "last_seen": 1, "is_dead": 1})
print(u)

for coll in ("attack_attempts", "combat_attempts", "attacks"):
    try:
        n = db[coll].count_documents({"attacker_id": uid, "created_at": {"$gte": since}})
        print(f"\n{coll} last 10m: {n}")
        rows = list(
            db[coll]
            .find({"attacker_id": uid}, {"_id": 0, "created_at": 1, "outcome": 1, "success": 1, "status": 1, "target_username": 1})
            .sort("created_at", -1)
            .limit(5)
        )
        for r in rows:
            print(" ", r)
    except Exception as e:
        print(f"{coll}: {e}")
