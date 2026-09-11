"""Find human targets Zwischenzug is attacking."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

# His unique non-NPC targets
attacks = list(db.attacks.find({"attacker_id": "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"}))
targets = set()
for a in attacks:
    name = a.get("target_username", "")
    if name and "(NPC)" not in name:
        targets.add(name)

print("=== HUMAN TARGETS ===")
for target_name in list(targets)[:10]:
    # Clean up the name (remove partial IDs)
    clean_name = target_name
    user = db.users.find_one(
        {"username": {"$regex": f"^{target_name[:10]}", "$options": "i"}, "is_bodyguard": {"$ne": True}, "is_npc": {"$ne": True}},
        {"_id": 0, "username": 1, "points": 1, "kills": 1, "is_dead": 1}
    )
    if user:
        status = "💀" if user.get("is_dead") else "🟢"
        print(f"  {status} {user.get('username'):20s} Points: {user.get('points', 0):>10,}  Kills: {user.get('kills', 0)}")
    else:
        print(f"  ? {target_name}")

# Also check trap stats
print("\n=== CURRENT TRAP STATS ===")
trap = db.bot_traps.find_one({"username": "Zwischenzug"})
if trap:
    print(f"Failures: {trap.get('failures', 0)}")
    print(f"Successes: {trap.get('successes', 0)}")
