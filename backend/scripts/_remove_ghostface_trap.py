"""Remove GhostFace trap."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

result = db.bot_traps.delete_one({"username": "GhostFace"})
print(f"GhostFace trap removed: {result.deleted_count} deleted")
print("You can attack normally now!")
