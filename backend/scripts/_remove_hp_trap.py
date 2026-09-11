"""Remove bot trap for HP."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

HP_ID = "a20e2b58-95d7-4bf4-8a41-244f620b3298"
result = db.bot_traps.delete_one({"user_id": HP_ID})
print(f"HP trap removed: {result.deleted_count}")
