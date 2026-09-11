"""Check GhostFace's attack list."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

GHOSTFACE_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"

attacks = list(db.attacks.find(
    {"attacker_id": GHOSTFACE_ID},
    {"target_username": 1, "status": 1, "found_at": 1, "_id": 0}
).sort("search_started", -1).limit(10))

print("=== GHOSTFACE'S ATTACKS ===")
for a in attacks:
    print(f"  {a.get('target_username', '?'):25s} Status: {a.get('status', '?'):12s} Found: {a.get('found_at', '-')}")
