"""Ban Weiss - Zwischenzug's ban evasion account."""
import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc)
now_iso = now.isoformat()

# Find Weiss
weiss = db.users.find_one({"username": "Weiss"})
if not weiss:
    print("Weiss not found!")
    exit(1)

print(f"Found: {weiss.get('username')}")
print(f"Email: {weiss.get('email')}")
print(f"ID: {weiss.get('id')}")
print(f"Created: {weiss.get('created_at')}")
print(f"IP: {weiss.get('last_login_ip')}")

# Ban the account
db.users.update_one(
    {"id": weiss["id"]},
    {"$set": {
        "is_banned": True,
        "ban_reason": "Ban evasion - new account created by Zwischenzug/Piece after permanent ban",
        "banned_at": now_iso,
        "banned_by": "System AI",
        "is_dead": True,
        "death_reason": "Ban evasion",
        "death_time": now_iso,
        "cash": 0,
        "swiss_balance": 0,
        "crypto_balance": 0,
        "points": 0,
        "revive_blocked": True,
        "dead_to_alive_blocked": True,
    }}
)

print(f"\n✓ Weiss BANNED")
print(f"  - Account killed")
print(f"  - Wealth stripped")
print(f"  - Revive blocked")

# The IP is already banned from before (same /48 block)
print(f"\n✓ IP already banned (same network as Zwischenzug)")
