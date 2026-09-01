"""Find Highlights 'Boring bitch' and reply."""
import os
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

since = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
print("=== recent Highlights ===")
for m in db.game_chat_messages.find(
    {"channel": "global", "created_at": {"$gte": since}, "username": {"$regex": "^Highlights$", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "created_at": 1},
).sort("created_at", -1).limit(12):
    print(m.get("created_at"), m.get("id"), (m.get("message") or "")[:180])
