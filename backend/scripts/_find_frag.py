"""Find usernames matching Frag."""
import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]
for u in db.users.find(
    {"username": {"$regex": "frag", "$options": "i"}, "is_dead": {"$ne": True}},
    {"_id": 0, "username": 1},
).limit(10):
    print(u.get("username"))
