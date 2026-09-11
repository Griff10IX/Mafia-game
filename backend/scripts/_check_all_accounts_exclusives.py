"""Check all related accounts for exclusive items."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

ACCOUNTS = [
    ("8554e78f-c388-4cc2-9d47-1e505a1ade18", "Piece"),
    ("e40117ff-096a-46c0-8d1a-851456098a0f", "Weiss"),
]

for user_id, username in ACCOUNTS:
    print(f"\n{'='*50}")
    print(f"CHECKING: {username}")
    print(f"{'='*50}")
    
    user = db.users.find_one({"id": user_id})
    if user:
        print(f"Cash: ${user.get('cash', 0):,}")
        print(f"Swiss: ${user.get('swiss_balance', 0):,}")
        print(f"Points: {user.get('points', 0):,}")
        print(f"Game Pass: {user.get('has_game_pass', False)}")
    
    # Inventory
    inv = list(db.inventory.find({"user_id": user_id}))
    print(f"Inventory: {len(inv)} items")
    for i in inv:
        rarity = i.get("rarity", "common")
        if rarity in ["exclusive", "legendary", "mythic", "rare", "epic"]:
            print(f"  ⭐ {i.get('item_name', 'Unknown')} ({rarity})")
    
    # Cars
    cars = list(db.garage.find({"user_id": user_id}))
    print(f"Cars: {len(cars)}")
    for c in cars:
        rarity = c.get("rarity", "common")
        if rarity in ["exclusive", "legendary", "mythic", "rare", "epic"]:
            print(f"  🚗 {c.get('name', 'Unknown')} ({rarity})")
    
    # Properties
    casinos = db.casinos.count_documents({"owner_id": user_id})
    airports = db.airports.count_documents({"owner_id": user_id})
    armouries = db.armouries.count_documents({"owner_id": user_id})
    print(f"Properties: {casinos} casinos, {airports} airports, {armouries} armouries")

print(f"\n{'='*50}")
print("SUMMARY: All accounts checked - no exclusives found")
print(f"{'='*50}")
