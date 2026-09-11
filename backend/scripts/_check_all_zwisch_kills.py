"""Check ALL kills by Zwischenzug ever - including before trap."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USER_ID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"

print("=== ALL SUCCESSFUL KILLS BY ZWISCHENZUG (EVER) ===")
all_kills = list(db.combat_attempts.find(
    {"attacker_id": USER_ID, "success": True},
    sort=[("created_at", -1)]
))
print(f"Total: {len(all_kills)}")

for kill in all_kills:
    target = kill.get("target_username", "Unknown")
    when = kill.get("created_at", "?")
    print(f"  Killed: {target} at {when}")

# Also check kills collection if different
print("\n=== CHECKING 'kills' COLLECTION ===")
kills_coll = list(db.kills.find({"killer_id": USER_ID}))
print(f"Total in kills collection: {len(kills_coll)}")
for k in kills_coll:
    print(f"  {k.get('victim_username', k.get('target_username', 'Unknown'))}")

# Check attack history for executes
print("\n=== ATTACK EXECUTIONS ===")
attacks = list(db.attacks.find(
    {"attacker_id": USER_ID, "status": {"$in": ["executed", "completed", "killed"]}},
))
print(f"Executed attacks: {len(attacks)}")
for a in attacks:
    print(f"  {a.get('target_username', 'Unknown')} - Status: {a.get('status')}")

# Check user's kill count
user = db.users.find_one({"id": USER_ID})
print(f"\n=== USER RECORD ===")
print(f"kills field: {user.get('kills', 0)}")
print(f"total_kills field: {user.get('total_kills', 0)}")
