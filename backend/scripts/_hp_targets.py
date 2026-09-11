"""Check who HP is trying to kill."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

HP_ID = "a20e2b58-95d7-4bf4-8a41-244f620b3298"

print("=== HP'S ACTIVE ATTACK SEARCHES ===\n")

attacks = list(db.attacks.find(
    {"attacker_id": HP_ID},
    {"target_username": 1, "target_id": 1, "status": 1, "search_started": 1, "found_at": 1, "_id": 0}
).sort("search_started", -1).limit(20))

print(f"Total active searches: {len(attacks)}\n")

for a in attacks:
    status = a.get("status", "?")
    target = a.get("target_username", "Unknown")
    found = "✓ FOUND" if status == "found" else f"Searching..."
    print(f"  {target:30s} {found}")

# Check the targets - are they real players or NPCs/bodyguards?
print("\n=== TARGET DETAILS ===")
target_names = list(set(a.get("target_username") for a in attacks if a.get("target_username")))

for name in target_names[:10]:
    target = db.users.find_one(
        {"username": {"$regex": f"^{name[:20]}", "$options": "i"}},
        {"username": 1, "points": 1, "is_bodyguard": 1, "is_npc": 1, "owner_id": 1, "is_dead": 1, "_id": 0}
    )
    if target:
        is_bg = target.get("is_bodyguard", False)
        is_npc = target.get("is_npc", False)
        is_dead = target.get("is_dead", False)
        points = target.get("points", 0)
        
        tag = ""
        if is_bg:
            owner = db.users.find_one({"id": target.get("owner_id")}, {"username": 1})
            owner_name = owner.get("username") if owner else "?"
            tag = f"(BG of {owner_name})"
        elif is_npc:
            tag = "(NPC)"
        elif is_dead:
            tag = "(DEAD)"
        
        print(f"  {target.get('username'):25s} {points:>10,} pts {tag}")
