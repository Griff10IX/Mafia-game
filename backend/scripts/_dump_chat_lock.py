"""Dump recent global chat + Highlights lock state."""
import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

hl = db.users.find_one(
    {"id": "ff620eef-283a-4016-a172-d33854bcee7b"},
    {"_id": 0, "username": 1, "account_locked": 1, "account_locked_until": 1, "account_locked_at": 1},
)
print("LOCK", hl)

print("=== recent ===")
for m in db.game_chat_messages.find(
    {"channel": "global"},
    {"_id": 0, "id": 1, "user_id": 1, "username": 1, "message": 1, "created_at": 1},
).sort("created_at", -1).limit(25):
    print(m.get("created_at"), "|", m.get("username"), "|", (m.get("message") or "").replace("\n", " ")[:140], "|", m.get("id"))
