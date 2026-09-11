"""Kill Zwischenzug's session by invalidating his token."""
import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

# Get Zwischenzug
user = db.users.find_one(
    {"username": {"$regex": "^Zwischenzug$", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "is_banned": 1}
)

if not user:
    print("User not found!")
    exit(1)

uid = user["id"]
print(f"User: {user['username']} (banned: {user.get('is_banned')})")

# Clear any active sessions/tokens
result1 = db.sessions.delete_many({"user_id": uid})
print(f"Deleted {result1.deleted_count} sessions")

result2 = db.refresh_tokens.delete_many({"user_id": uid})
print(f"Deleted {result2.deleted_count} refresh tokens")

# Set token_invalidated_at to force re-auth (which will fail because banned)
result3 = db.users.update_one(
    {"id": uid},
    {"$set": {"token_invalidated_at": datetime.now(timezone.utc).isoformat()}}
)
print(f"Set token_invalidated_at: {result3.modified_count}")

print("\n✓ Zwischenzug's session killed - bot should get 401s now and stop working")
