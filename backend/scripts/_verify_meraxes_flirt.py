"""Verify Meraxes Private inbox."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]
n = db.notifications.find_one(
    {"id": "36e489b4-ca4a-4089-b00b-f1f1b7de211a"},
    {"_id": 0, "id": 1, "user_id": 1, "title": 1, "created_at": 1, "read": 1, "system_ai": 1},
)
print(n)
u = db.users.find_one({"id": "7c4e21c6-9d20-4b19-8911-d895e008a134"}, {"_id": 0, "username": 1})
print("user", u)
