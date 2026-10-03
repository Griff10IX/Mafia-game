"""Schizophrenic was paid the ladder reward by hand; flag it so the automatic grant skips him."""
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

SCHIZO_ID = "828d4094-7095-4007-bb4e-9d8c25c7bc8f"
res = db.users.update_one(
    {"id": SCHIZO_ID, "mission_ladder_complete_reward_at": {"$exists": False}},
    {"$set": {"mission_ladder_complete_reward_at": datetime.now(timezone.utc).isoformat()}},
)
print("flagged", res.modified_count)
print(db.users.find_one({"id": SCHIZO_ID}, {"_id": 0, "username": 1, "mission_ladder_complete_reward_at": 1}))
