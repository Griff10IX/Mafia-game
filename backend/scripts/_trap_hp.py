"""Add bot trap for HP."""
import os
import secrets
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USERNAME = "HP"

# Get user ID
user = db.users.find_one({"username": {"$regex": f"^{USERNAME}$", "$options": "i"}}, {"_id": 0, "id": 1, "username": 1})
if not user:
    print(f"User {USERNAME} not found!")
    exit(1)

user_id = user["id"]
print(f"User: {user.get('username')} ID: {user_id}")

# Generate challenge
challenge_field = f"x_{secrets.token_hex(4)}"
challenge_value = secrets.token_hex(8)

trap_doc = {
    "user_id": user_id,
    "username": user.get("username"),
    "challenge_field": challenge_field,
    "challenge_value": challenge_value,
    "created_at": datetime.now(timezone.utc).isoformat(),
    "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    "failures": 0,
    "successes": 0,
    "active": True,
}

db.bot_traps.update_one(
    {"user_id": user_id},
    {"$set": trap_doc},
    upsert=True,
)

print(f"\n🎯 BOT TRAP ACTIVATED FOR {user.get('username')}")
print(f"Challenge field: {challenge_field}")
print(f"Expires: 1 hour")
print(f"\nIf they're botting, failures will rack up fast.")
print(f"If human, they'll refresh and trap clears (under 10 failures).")
