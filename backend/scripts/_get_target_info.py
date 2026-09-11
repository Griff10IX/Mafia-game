"""Get info on MadDogColl target."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

# Search for the target - could be a bodyguard NPC
target = db.users.find_one(
    {"username": {"$regex": "MadDogColl", "$options": "i"}},
    {"_id": 0, "username": 1, "points": 1, "cash": 1, "swiss_balance": 1, "current_state": 1, "is_dead": 1, "kills": 1, "is_bodyguard": 1, "owner_id": 1}
)

if target:
    print("=== TARGET INFO ===")
    print(f"Username: {target.get('username')}")
    print(f"Points: {target.get('points', 0):,}")
    print(f"Cash: ${target.get('cash', 0):,}")
    print(f"Swiss: ${target.get('swiss_balance', 0):,}")
    print(f"Location: {target.get('current_state')}")
    print(f"Dead: {target.get('is_dead')}")
    print(f"Is Bodyguard: {target.get('is_bodyguard')}")
    
    if target.get("is_bodyguard") and target.get("owner_id"):
        owner = db.users.find_one({"id": target["owner_id"]}, {"_id": 0, "username": 1})
        print(f"Owner: {owner.get('username') if owner else 'Unknown'}")
else:
    print("Target not found as user, checking bodyguards...")
    bg = db.users.find_one(
        {"username": {"$regex": "MadDogColl", "$options": "i"}, "is_bodyguard": True},
    )
    if bg:
        print(f"Found bodyguard: {bg.get('username')}")
        owner = db.users.find_one({"id": bg.get("owner_id")}, {"_id": 0, "username": 1})
        print(f"Owner: {owner.get('username') if owner else 'Unknown'}")
    else:
        print("Not found")
