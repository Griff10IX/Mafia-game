"""Get Zwischenzug's user ID."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

u = db.users.find_one({"username": {"$regex": "^Zwischenzug$", "$options": "i"}}, {"id": 1, "username": 1})
print(f"Username: {u.get('username')}")
print(f"ID: {u.get('id')}")
