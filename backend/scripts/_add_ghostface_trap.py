"""Add test bot trap for GhostFace."""
import os
import secrets
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USERNAME = "GhostFace"

# Get his user ID
user = db.users.find_one({"username": {"$regex": f"^{USERNAME}$", "$options": "i"}}, {"_id": 0, "id": 1, "username": 1})
if not user:
    print(f"User {USERNAME} not found!")
    exit(1)

user_id = user["id"]
print(f"User: {user.get('username')} ID: {user_id}")

# Generate a random challenge
challenge_field = f"x_{secrets.token_hex(4)}"
challenge_value = secrets.token_hex(8)

trap_doc = {
    "user_id": user_id,
    "username": user.get("username"),
    "challenge_field": challenge_field,
    "challenge_value": challenge_value,
    "created_at": datetime.now(timezone.utc).isoformat(),
    "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),  # Only 5 mins for testing
    "failures": 0,
    "successes": 0,
    "active": True,
}

db.bot_traps.update_one(
    {"user_id": user_id},
    {"$set": trap_doc},
    upsert=True,
)

print(f"\n=== TEST TRAP ACTIVATED FOR {user.get('username')} ===")
print(f"Challenge field: {challenge_field}")
print(f"Challenge value: {challenge_value}")
print(f"Expires: 5 minutes")
print(f"\nGo try to attack someone - you should see 'Attack verification failed. Please refresh and try again.'")
print(f"This is what Zwischenzug's bot is seeing (but it keeps retrying instead of stopping).")
