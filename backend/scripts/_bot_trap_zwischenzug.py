"""Add dynamic bot trap for Zwischenzug - requires a rotating challenge field."""
import os
import uuid
import secrets
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USERNAME = "Zwischenzug"

# Get his user ID
user = db.users.find_one({"username": USERNAME}, {"_id": 0, "id": 1})
if not user:
    print(f"User {USERNAME} not found!")
    exit(1)

user_id = user["id"]
print(f"User ID: {user_id}")

# Generate a random challenge field name and value
challenge_field = f"x_{secrets.token_hex(4)}"  # e.g., "x_a1b2c3d4"
challenge_value = secrets.token_hex(8)  # Random expected value

# Store in a bot_traps collection
trap_doc = {
    "user_id": user_id,
    "username": USERNAME,
    "challenge_field": challenge_field,
    "challenge_value": challenge_value,
    "created_at": datetime.now(timezone.utc).isoformat(),
    "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    "failures": 0,
    "successes": 0,
    "active": True,
}

# Upsert the trap
db.bot_traps.update_one(
    {"user_id": user_id},
    {"$set": trap_doc},
    upsert=True,
)

print(f"\n=== BOT TRAP ACTIVATED FOR {USERNAME} ===")
print(f"Challenge field: {challenge_field}")
print(f"Challenge value: {challenge_value}")
print(f"Expires: 1 hour")
print(f"\nHis bot must now send: {{\"{challenge_field}\": \"{challenge_value}\"}} in attack requests")
print(f"Without it, attacks will fail with a 400 error.")
print(f"\nA real human would see the challenge in the UI and their client would send it automatically.")

# Verify
trap = db.bot_traps.find_one({"user_id": user_id})
print(f"\nStored trap: {trap}")
