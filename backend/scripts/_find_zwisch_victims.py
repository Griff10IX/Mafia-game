"""Find anyone killed BY Zwischenzug using death records."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USER_ID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
USERNAME = "Zwischenzug"

print("=== SEARCHING FOR ZWISCHENZUG'S VICTIMS ===\n")

# Check users killed by him
print("1. Users with killed_by = Zwischenzug:")
victims = list(db.users.find(
    {"$or": [
        {"killed_by": USER_ID},
        {"killed_by": USERNAME},
        {"killed_by_id": USER_ID},
        {"killer_id": USER_ID},
        {"death_by_user_id": USER_ID},
    ]},
    {"username": 1, "is_bodyguard": 1, "owner_id": 1, "is_dead": 1, "death_time": 1, "killed_by": 1}
))
print(f"Found: {len(victims)}")
for v in victims:
    print(f"  {v.get('username')} - BG: {v.get('is_bodyguard', False)} - Owner: {v.get('owner_id', 'N/A')[:8] if v.get('owner_id') else 'N/A'}")

# Check death_logs collection
print("\n2. Death logs where killer = Zwischenzug:")
death_logs = list(db.death_logs.find(
    {"$or": [
        {"killer_id": USER_ID},
        {"killer_username": USERNAME},
        {"attacker_id": USER_ID},
    ]}
))
print(f"Found: {len(death_logs)}")
for d in death_logs[:20]:
    print(f"  Victim: {d.get('victim_username', d.get('username', 'Unknown'))} at {d.get('created_at', d.get('death_time', '?'))}")

# Check combat_logs
print("\n3. Combat logs:")
combat_logs = list(db.combat_logs.find({"attacker_id": USER_ID, "result": "kill"}))
print(f"Found: {len(combat_logs)}")
for c in combat_logs[:10]:
    print(f"  {c.get('target_username', 'Unknown')}")

# Check activity_logs for kills
print("\n4. Activity logs (kill events):")
activity = list(db.activity_logs.find(
    {"user_id": USER_ID, "action": {"$regex": "kill", "$options": "i"}}
).limit(20))
print(f"Found: {len(activity)}")
for a in activity[:10]:
    print(f"  {a.get('action')}: {a.get('details', a.get('target', 'N/A'))}")

# Check notifications sent about being killed by him
print("\n5. Notifications about being killed by Zwischenzug:")
notifs = list(db.notifications.find(
    {"$or": [
        {"message": {"$regex": "Zwischenzug", "$options": "i"}, "type": {"$regex": "kill|death", "$options": "i"}},
        {"data.killer_username": USERNAME},
        {"data.attacker_username": USERNAME},
    ]}
).limit(20))
print(f"Found: {len(notifs)}")
for n in notifs[:10]:
    print(f"  To: {n.get('user_id', 'N/A')[:8]} - {n.get('message', n.get('type', 'N/A'))[:50]}")
