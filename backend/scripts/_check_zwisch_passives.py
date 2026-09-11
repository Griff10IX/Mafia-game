"""Check Zwischenzug's passive items and exclusive car history."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USER_ID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"

print("=== PASSIVE ITEMS ===")
# Check user_passives collection
passives = list(db.user_passives.find({"user_id": USER_ID}))
print(f"user_passives: {len(passives)}")
for p in passives:
    print(f"  {p}")

# Check passives in user doc
user = db.users.find_one({"id": USER_ID})
print(f"\nloot_reclaimable_passive_ids: {user.get('loot_reclaimable_passive_ids', [])}")
print(f"passive_items: {user.get('passive_items', [])}")
print(f"active_passives: {user.get('active_passives', [])}")

print("\n=== EXCLUSIVE CAR HISTORY ===")
print(f"exclusive_car_loot_last_amount: {user.get('exclusive_car_loot_last_amount')}")
print(f"exclusive_car_loot_last_at: {user.get('exclusive_car_loot_last_at')}")
print(f"exclusive_car_loot_week: {user.get('exclusive_car_loot_week')}")

# Check if there's an exclusive_cars collection
print("\n=== EXCLUSIVE CARS COLLECTION ===")
exc_cars = list(db.exclusive_cars.find({"user_id": USER_ID}))
print(f"exclusive_cars: {len(exc_cars)}")
for c in exc_cars:
    print(f"  {c.get('name', c.get('car_name', 'Unknown'))}")

# Check loot_box_rewards or similar
print("\n=== LOOT HISTORY ===")
loot_rewards = list(db.loot_box_rewards.find({"user_id": USER_ID}).limit(10))
print(f"loot_box_rewards: {len(loot_rewards)}")

# Check cars_won or exclusive_drops
print("\n=== CARS WON / EXCLUSIVE DROPS ===")
cars_won = list(db.cars_won.find({"user_id": USER_ID}))
print(f"cars_won: {len(cars_won)}")

exc_drops = list(db.exclusive_drops.find({"user_id": USER_ID}))
print(f"exclusive_drops: {len(exc_drops)}")

# List all collections that might have user-specific exclusive data
print("\n=== CHECKING ALL RELEVANT COLLECTIONS ===")
for coll_name in db.list_collection_names():
    if any(x in coll_name.lower() for x in ['exclusive', 'passive', 'loot', 'reward', 'prize']):
        count = db[coll_name].count_documents({"user_id": USER_ID})
        if count > 0:
            print(f"  {coll_name}: {count} items")
            items = list(db[coll_name].find({"user_id": USER_ID}).limit(3))
            for i in items:
                i.pop("_id", None)
                print(f"    {i}")
