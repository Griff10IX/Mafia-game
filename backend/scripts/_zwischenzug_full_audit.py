"""Full audit of Zwischenzug account for ban action."""
import os
from datetime import datetime, timezone, timedelta
from collections import defaultdict

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USERNAME = "Zwischenzug"

# Get full user record
user = db.users.find_one({"username": USERNAME})
if not user:
    print("User not found!")
    exit(1)

user_id = user["id"]

print("=" * 60)
print(f"FULL AUDIT: {USERNAME}")
print("=" * 60)

print(f"\n=== ACCOUNT INFO ===")
print(f"User ID: {user_id}")
print(f"Username: {user.get('username')}")
print(f"Email: {user.get('email', 'N/A')}")
print(f"Points: {user.get('points', 0):,}")
print(f"Cash: ${user.get('cash', 0):,}")
print(f"Swiss Balance: ${user.get('swiss_balance', 0):,}")
print(f"Crypto: ${user.get('crypto_balance', 0):,}")
print(f"Kills: {user.get('kills', 0)}")
print(f"Deaths: {user.get('deaths', 0)}")
print(f"Created: {user.get('created_at', 'N/A')}")
print(f"Last Login IP: {user.get('last_login_ip', 'N/A')}")
print(f"Registration IP: {user.get('registration_ip', user.get('last_login_ip', 'N/A'))}")

# Get all IPs associated
ips = set()
if user.get('last_login_ip'):
    ips.add(user.get('last_login_ip'))
if user.get('registration_ip'):
    ips.add(user.get('registration_ip'))
if user.get('known_ips'):
    ips.update(user.get('known_ips', []))
print(f"Known IPs: {list(ips)}")

print(f"\n=== BOT TRAP STATS ===")
trap = db.bot_traps.find_one({"user_id": user_id})
if trap:
    print(f"Failures: {trap.get('failures', 0)}")
    print(f"Successes: {trap.get('successes', 0)}")
    print(f"Active since: {trap.get('created_at', 'N/A')}")
else:
    print("No active trap")

print(f"\n=== INVENTORY VALUE ===")
# Check for exclusive items
inventory = list(db.inventory.find({"user_id": user_id}))
exclusive_items = []
total_inv_value = 0
for item in inventory:
    item_name = item.get("item_name", item.get("name", "Unknown"))
    quantity = item.get("quantity", 1)
    value = item.get("value", 0) * quantity
    total_inv_value += value
    # Check if exclusive/rare
    if item.get("rarity") in ["exclusive", "legendary", "mythic"] or item.get("from_lootbox"):
        exclusive_items.append({"name": item_name, "quantity": quantity, "item_id": item.get("item_id"), "rarity": item.get("rarity")})

print(f"Total inventory items: {len(inventory)}")
print(f"Estimated value: ${total_inv_value:,}")
if exclusive_items:
    print(f"Exclusive/rare items ({len(exclusive_items)}):")
    for ei in exclusive_items[:20]:
        print(f"  - {ei['name']} x{ei['quantity']} ({ei.get('rarity', 'special')})")

# Check cars/garage
cars = list(db.garage.find({"user_id": user_id}))
print(f"\n=== GARAGE ===")
print(f"Total vehicles: {len(cars)}")
exclusive_cars = []
for car in cars:
    car_name = car.get("name", car.get("car_name", "Unknown"))
    if car.get("rarity") in ["exclusive", "legendary", "mythic"] or car.get("from_lootbox"):
        exclusive_cars.append({"name": car_name, "car_id": car.get("car_id", car.get("id"))})
        print(f"  EXCLUSIVE: {car_name}")

print(f"\n=== KILL HISTORY (last 7 days) ===")
week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
kills = list(db.combat_attempts.find(
    {"attacker_id": user_id, "created_at": {"$gte": week_ago}, "success": True},
    sort=[("created_at", -1)]
))

print(f"Total kills in last 7 days: {len(kills)}")

# Categorize victims
human_victims = []
bg_victims = defaultdict(list)  # owner_id -> list of BG names killed

for kill in kills:
    target_id = kill.get("target_id")
    target_name = kill.get("target_username", "Unknown")
    
    # Check if target was a bodyguard
    target_user = db.users.find_one({"id": target_id}, {"is_bodyguard": 1, "owner_id": 1, "is_npc": 1, "username": 1})
    
    if target_user:
        if target_user.get("is_bodyguard") and target_user.get("owner_id"):
            owner_id = target_user["owner_id"]
            bg_victims[owner_id].append({
                "bg_name": target_name,
                "killed_at": kill.get("created_at"),
                "kill_id": str(kill.get("_id"))
            })
        elif not target_user.get("is_npc") and not target_user.get("is_bodyguard"):
            human_victims.append({
                "username": target_name,
                "user_id": target_id,
                "killed_at": kill.get("created_at")
            })

print(f"\nHuman players killed: {len(human_victims)}")
for v in human_victims[:10]:
    print(f"  - {v['username']} at {v['killed_at'][:19] if v['killed_at'] else '?'}")

print(f"\nBodyguard owners affected: {len(bg_victims)}")
for owner_id, bgs in bg_victims.items():
    owner = db.users.find_one({"id": owner_id}, {"username": 1})
    owner_name = owner.get("username") if owner else "Unknown"
    print(f"  - {owner_name}: {len(bgs)} bodyguards killed")
    for bg in bgs[:3]:
        print(f"      {bg['bg_name']}")

print(f"\n=== WEALTH SUMMARY FOR REDISTRIBUTION ===")
total_wealth = (
    user.get("cash", 0) +
    user.get("swiss_balance", 0) +
    user.get("crypto_balance", 0)
)
print(f"Total liquid wealth: ${total_wealth:,}")
print(f"Points: {user.get('points', 0):,}")

# Calculate refund per BG owner
print(f"\n=== REFUND CALCULATION ===")
# Assume standard BG cost for refund
BG_REFUND_VALUE = 500000  # Adjust based on actual BG cost
total_bg_refund = 0
refund_list = []
for owner_id, bgs in bg_victims.items():
    owner = db.users.find_one({"id": owner_id}, {"username": 1, "id": 1})
    if owner:
        refund_amount = len(bgs) * BG_REFUND_VALUE
        total_bg_refund += refund_amount
        refund_list.append({
            "owner_id": owner_id,
            "username": owner.get("username"),
            "bg_count": len(bgs),
            "refund": refund_amount
        })
        print(f"  {owner.get('username')}: {len(bgs)} BGs = ${refund_amount:,} refund")

print(f"\nTotal BG refund needed: ${total_bg_refund:,}")

# Points split for human victims
if human_victims:
    points_per_victim = user.get("points", 0) // len(human_victims) if human_victims else 0
    print(f"Points per human victim: {points_per_victim:,}")

# Remaining wealth after refunds to split
remaining = total_wealth - total_bg_refund
if remaining > 0 and human_victims:
    cash_per_victim = remaining // len(human_victims)
    print(f"Remaining cash per human victim: ${cash_per_victim:,}")

print(f"\n=== DATA FOR BAN SCRIPT ===")
print(f"USER_ID = '{user_id}'")
print(f"USERNAME = '{user.get('username')}'")
print(f"IPS_TO_BAN = {list(ips)}")
print(f"POINTS = {user.get('points', 0)}")
print(f"TOTAL_WEALTH = {total_wealth}")
print(f"HUMAN_VICTIMS = {[v['user_id'] for v in human_victims]}")
print(f"BG_OWNER_REFUNDS = {refund_list}")
print(f"EXCLUSIVE_ITEMS = {exclusive_items[:10]}")
print(f"EXCLUSIVE_CARS = {exclusive_cars[:10]}")
