"""Get bodyguard owner."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

# Find all bodyguards with MadDogColl in name
bgs = list(db.users.find(
    {"username": {"$regex": "MadDogColl", "$options": "i"}, "is_bodyguard": True},
    {"_id": 0, "username": 1, "owner_id": 1, "current_state": 1}
))

print(f"Found {len(bgs)} MadDogColl bodyguards:")
owners_seen = set()
for bg in bgs[:5]:
    owner_id = bg.get("owner_id")
    if owner_id and owner_id not in owners_seen:
        owners_seen.add(owner_id)
        owner = db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1, "points": 1})
        if owner:
            print(f"  Bodyguard {bg.get('username')} protects: {owner.get('username')} ({owner.get('points', 0):,} points)")

# Summary
print(f"\n=== ZWISCHENZUG IS TRYING TO KILL BODYGUARDS OF: ===")
for owner_id in owners_seen:
    owner = db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1, "points": 1, "kills": 1})
    if owner:
        print(f"  {owner.get('username'):20s} - {owner.get('points', 0):,} points, {owner.get('kills', 0)} kills")
