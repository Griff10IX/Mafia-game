"""Dump FULL user documents for all related accounts."""
import os
import json
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

ACCOUNTS = [
    ("8e61bd9a-bc71-4abb-b490-7fbf7e33283c", "Zwischenzug"),
    ("8554e78f-c388-4cc2-9d47-1e505a1ade18", "Piece"),
    ("e40117ff-096a-46c0-8d1a-851456098a0f", "Weiss"),
]

for user_id, username in ACCOUNTS:
    print(f"\n{'='*60}")
    print(f"FULL DUMP: {username} ({user_id})")
    print(f"{'='*60}")
    
    user = db.users.find_one({"id": user_id})
    if user:
        # Remove _id for cleaner output
        user.pop("_id", None)
        
        # Print all fields
        for key, value in sorted(user.items()):
            # Skip very long fields
            if isinstance(value, str) and len(str(value)) > 200:
                print(f"  {key}: [LONG STRING - {len(value)} chars]")
            elif isinstance(value, list) and len(value) > 10:
                print(f"  {key}: [LIST - {len(value)} items] {value[:3]}...")
            elif isinstance(value, dict) and len(str(value)) > 200:
                print(f"  {key}: [DICT - {len(value)} keys]")
            else:
                print(f"  {key}: {value}")
    else:
        print(f"  USER NOT FOUND")

# Also check any other collections that might have user data
print(f"\n{'='*60}")
print("CHECKING OTHER COLLECTIONS FOR USER DATA")
print(f"{'='*60}")

for user_id, username in ACCOUNTS:
    print(f"\n--- {username} ---")
    
    # Bodyguards owned
    bgs = list(db.users.find({"owner_id": user_id, "is_bodyguard": True}, {"username": 1}))
    if bgs:
        print(f"  Bodyguards owned: {len(bgs)}")
        for bg in bgs[:5]:
            print(f"    - {bg.get('username')}")
    
    # Robots owned
    robots = list(db.users.find({"owner_id": user_id, "is_robot": True}, {"username": 1}))
    if robots:
        print(f"  Robots owned: {len(robots)}")
        for r in robots[:5]:
            print(f"    - {r.get('username')}")
    
    # Family membership
    family = db.families.find_one({"members": {"$elemMatch": {"user_id": user_id}}})
    if family:
        print(f"  Family: {family.get('name')}")
    
    # Bounties placed
    bounties = list(db.bounties.find({"placer_id": user_id}))
    if bounties:
        print(f"  Active bounties placed: {len(bounties)}")
    
    # Bank accounts
    bank = db.bank_accounts.find_one({"user_id": user_id})
    if bank:
        print(f"  Bank account: ${bank.get('balance', 0):,}")
    
    # Stocks/investments  
    stocks = list(db.user_stocks.find({"user_id": user_id}))
    if stocks:
        print(f"  Stocks owned: {len(stocks)}")
        
    # Achievements/honors
    achievements = list(db.achievements.find({"user_id": user_id}))
    if achievements:
        print(f"  Achievements: {len(achievements)}")
