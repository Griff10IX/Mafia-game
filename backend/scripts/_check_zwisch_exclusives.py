"""Check Zwischenzug for any exclusive items/cars that need returning to loot pool."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USER_ID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
USERNAME = "Zwischenzug"

print("=" * 60)
print(f"EXCLUSIVE ITEM CHECK: {USERNAME}")
print("=" * 60)

# Check inventory
print("\n=== INVENTORY ===")
inventory = list(db.inventory.find({"user_id": USER_ID}))
print(f"Total items: {len(inventory)}")

exclusive_items = []
for item in inventory:
    name = item.get("item_name", item.get("name", "Unknown"))
    rarity = item.get("rarity", "common")
    from_lootbox = item.get("from_lootbox", False)
    quantity = item.get("quantity", 1)
    
    # Check if exclusive/rare/from lootbox
    if rarity in ["exclusive", "legendary", "mythic", "rare", "epic"] or from_lootbox:
        exclusive_items.append(item)
        print(f"  ⭐ {name} x{quantity} (Rarity: {rarity}, Lootbox: {from_lootbox})")
    
if not exclusive_items:
    print("  No exclusive items found")

# Check garage/cars
print("\n=== GARAGE/CARS ===")
cars = list(db.garage.find({"user_id": USER_ID}))
print(f"Total cars: {len(cars)}")

exclusive_cars = []
for car in cars:
    name = car.get("name", car.get("car_name", car.get("model", "Unknown")))
    rarity = car.get("rarity", "common")
    from_lootbox = car.get("from_lootbox", car.get("from_crate", False))
    
    if rarity in ["exclusive", "legendary", "mythic", "rare", "epic"] or from_lootbox:
        exclusive_cars.append(car)
        print(f"  🚗 {name} (Rarity: {rarity}, Lootbox: {from_lootbox})")

if not exclusive_cars:
    print("  No exclusive cars found")

# Check user_items collection
print("\n=== USER_ITEMS COLLECTION ===")
user_items = list(db.user_items.find({"user_id": USER_ID}))
print(f"Total user_items: {len(user_items)}")
for ui in user_items:
    print(f"  {ui.get('item_name', ui.get('name', ui.get('item_id', 'Unknown')))}")

# Check lootbox_items or crate_items
print("\n=== LOOTBOX/CRATE ITEMS ===")
loot_items = list(db.lootbox_items.find({"user_id": USER_ID}))
print(f"Lootbox items: {len(loot_items)}")
for li in loot_items:
    print(f"  {li}")

crate_items = list(db.crate_items.find({"user_id": USER_ID}))
print(f"Crate items: {len(crate_items)}")
for ci in crate_items:
    print(f"  {ci}")

# Check properties
print("\n=== PROPERTIES ===")
# Casinos
casinos = list(db.casinos.find({"owner_id": USER_ID}))
print(f"Casinos owned: {len(casinos)}")
for c in casinos:
    print(f"  🎰 {c.get('name', 'Unknown')} in {c.get('state', c.get('location', 'Unknown'))}")

# Airports
airports = list(db.airports.find({"owner_id": USER_ID}))
print(f"Airports owned: {len(airports)}")
for a in airports:
    print(f"  ✈️ {a.get('name', 'Unknown')} in {a.get('state', a.get('location', 'Unknown'))}")

# Armouries
armouries = list(db.armouries.find({"owner_id": USER_ID}))
print(f"Armouries owned: {len(armouries)}")
for a in armouries:
    print(f"  🔫 {a.get('name', 'Unknown')} in {a.get('state', a.get('location', 'Unknown'))}")

# Check special collections
print("\n=== OTHER SPECIAL ITEMS ===")
# Titles/badges
badges = list(db.user_badges.find({"user_id": USER_ID}))
print(f"Badges: {len(badges)}")
for b in badges:
    print(f"  🏅 {b.get('badge_name', b.get('name', 'Unknown'))}")

# Game pass
user = db.users.find_one({"id": USER_ID})
if user:
    print(f"\nGame Pass: {user.get('has_game_pass', False)}")
    print(f"VIP: {user.get('is_vip', user.get('vip', False))}")
    print(f"Special titles: {user.get('titles', [])}")

print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)
print(f"Exclusive inventory items: {len(exclusive_items)}")
print(f"Exclusive cars: {len(exclusive_cars)}")
print(f"Properties: {len(casinos) + len(airports) + len(armouries)}")
if exclusive_items or exclusive_cars or casinos or airports or armouries:
    print("\n⚠️  Items above should be returned to loot pool!")
else:
    print("\n✓ No exclusive items to return")
