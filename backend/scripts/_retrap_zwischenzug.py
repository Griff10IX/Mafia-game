"""Re-trap Zwischenzug with high failure count."""
import os
import secrets
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

user = db.users.find_one({"username": "Zwischenzug"}, {"_id": 0, "id": 1, "username": 1})
if not user:
    print("User not found")
    exit(1)

challenge_field = f"x_{secrets.token_hex(4)}"
challenge_value = secrets.token_hex(8)

trap_doc = {
    "user_id": user["id"],
    "username": user["username"],
    "challenge_field": challenge_field,
    "challenge_value": challenge_value,
    "created_at": datetime.now(timezone.utc).isoformat(),
    "expires_at": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
    "failures": 100,  # Start high so refresh won't clear it
    "successes": 0,
    "active": True,
}

db.bot_traps.update_one(
    {"user_id": user["id"]},
    {"$set": trap_doc},
    upsert=True,
)

print(f"=== ZWISCHENZUG RE-TRAPPED ===")
print(f"Failures start at 100 - refresh won't save him")
print(f"He's stuck until you remove the trap manually")
