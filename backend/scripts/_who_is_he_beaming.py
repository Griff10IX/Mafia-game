"""Find out who Zwischenzug is trying to attack."""
import os
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

# Get his user ID
user = db.users.find_one({"username": "Zwischenzug"}, {"_id": 0, "id": 1})
user_id = user["id"] if user else None

print("=== WHO IS ZWISCHENZUG TRYING TO KILL? ===\n")

# Check his active attack searches
active_attacks = list(db.attacks.find(
    {"attacker_id": user_id},
    {"_id": 0, "target_username": 1, "target_id": 1, "status": 1, "search_started": 1, "found_at": 1},
    sort=[("search_started", -1)],
    limit=20,
))

print(f"Active/Recent attack searches ({len(active_attacks)}):")
for a in active_attacks:
    print(f"  Target: {a.get('target_username', 'Unknown'):20s} Status: {a.get('status', '?'):12s} Started: {a.get('search_started', '?')[:19]}")

# Get unique targets
targets = list(set(a.get("target_username") for a in active_attacks if a.get("target_username")))
print(f"\nUnique targets: {targets}")

# Check his recent kills (if any succeeded before trap)
now = datetime.now(timezone.utc)
hour_ago = (now - timedelta(hours=24)).isoformat()
recent_kills = list(db.combat_attempts.find(
    {"attacker_id": user_id, "created_at": {"$gte": hour_ago}},
    {"_id": 0, "target_username": 1, "success": 1, "created_at": 1},
    sort=[("created_at", -1)],
    limit=20,
))

print(f"\n=== RECENT COMBAT ATTEMPTS (last 24h) ===")
print(f"Total attempts: {len(recent_kills)}")
for k in recent_kills[:10]:
    result = "✅ KILLED" if k.get("success") else "❌ Failed"
    print(f"  {k.get('target_username', 'Unknown'):20s} {result} at {k.get('created_at', '?')[:19]}")

# Who he killed successfully
successful = [k for k in recent_kills if k.get("success")]
print(f"\nSuccessful kills: {len(successful)}")
if successful:
    victims = list(set(k.get("target_username") for k in successful))
    print(f"Victims: {victims}")

# Check the target users - are they valuable?
print(f"\n=== TARGET ANALYSIS ===")
for target_name in targets[:5]:
    target = db.users.find_one(
        {"username": {"$regex": f"^{target_name}$", "$options": "i"}},
        {"_id": 0, "username": 1, "points": 1, "kills": 1, "cash": 1, "current_state": 1, "is_dead": 1}
    )
    if target:
        status = "💀 DEAD" if target.get("is_dead") else f"📍 {target.get('current_state', '?')}"
        print(f"  {target.get('username'):20s} Points: {target.get('points', 0):>10,} Cash: ${target.get('cash', 0):>15,} {status}")
