"""Check GhostFace trap and re-add if expired."""
import os
import secrets
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

# Check current trap
t = db.bot_traps.find_one({"username": "GhostFace"})
print("Current trap:", t)

# Re-add fresh trap
user = db.users.find_one({"username": {"$regex": "^GhostFace$", "$options": "i"}}, {"_id": 0, "id": 1, "username": 1})
if user:
    challenge_field = f"x_{secrets.token_hex(4)}"
    challenge_value = secrets.token_hex(8)
    
    trap_doc = {
        "user_id": user["id"],
        "username": user.get("username"),
        "challenge_field": challenge_field,
        "challenge_value": challenge_value,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
        "failures": 0,
        "successes": 0,
        "active": True,
    }
    
    db.bot_traps.update_one(
        {"user_id": user["id"]},
        {"$set": trap_doc},
        upsert=True,
    )
    
    print(f"\n=== FRESH TRAP ACTIVATED ===")
    print(f"Field: {challenge_field}")
    print(f"Value: {challenge_value}")
    print(f"Go click KILL USER now!")
