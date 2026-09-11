"""Deep search for ALL possible Zwischenzug victims in last 7 days."""
import os
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USER_ID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
USERNAME = "Zwischenzug"
week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

print("=== DEEP SEARCH FOR ZWISCHENZUG VICTIMS (last 7 days) ===\n")

victims = set()

# 1. combat_attempts
print("1. combat_attempts (success=True):")
kills1 = list(db.combat_attempts.find({"attacker_id": USER_ID, "success": True, "created_at": {"$gte": week_ago}}))
print(f"   Found: {len(kills1)}")
for k in kills1:
    victims.add((k.get("target_id"), k.get("target_username")))
    print(f"   - {k.get('target_username')}")

# 2. kills collection
print("\n2. kills collection:")
kills2 = list(db.kills.find({"$or": [{"killer_id": USER_ID}, {"killer_username": USERNAME}], "created_at": {"$gte": week_ago}}))
print(f"   Found: {len(kills2)}")
for k in kills2:
    victims.add((k.get("victim_id"), k.get("victim_username")))
    print(f"   - {k.get('victim_username')}")

# 3. Users with killed_by
print("\n3. Users where killed_by = Zwischenzug:")
kills3 = list(db.users.find({
    "$or": [
        {"killed_by": USER_ID},
        {"killed_by": USERNAME},
        {"killed_by_id": USER_ID},
        {"death_by": USERNAME},
    ],
    "death_time": {"$gte": week_ago}
}, {"username": 1, "id": 1, "is_bodyguard": 1, "owner_id": 1}))
print(f"   Found: {len(kills3)}")
for k in kills3:
    victims.add((k.get("id"), k.get("username")))
    print(f"   - {k.get('username')} (BG: {k.get('is_bodyguard', False)})")

# 4. Death notifications
print("\n4. Kill notifications mentioning Zwischenzug:")
notifs = list(db.notifications.find({
    "created_at": {"$gte": week_ago},
    "$or": [
        {"message": {"$regex": f"killed by.*{USERNAME}", "$options": "i"}},
        {"message": {"$regex": f"{USERNAME}.*killed", "$options": "i"}},
        {"data.killer_username": USERNAME},
    ]
}, {"user_id": 1, "message": 1}).limit(50))
print(f"   Found: {len(notifs)}")
for n in notifs:
    # Get the victim's username
    victim = db.users.find_one({"id": n.get("user_id")}, {"username": 1, "id": 1})
    if victim:
        victims.add((victim.get("id"), victim.get("username")))
        print(f"   - {victim.get('username')}")

# 5. Activity logs
print("\n5. Activity logs (kill actions):")
acts = list(db.activity_logs.find({
    "user_id": USER_ID,
    "action": {"$regex": "kill", "$options": "i"},
    "created_at": {"$gte": week_ago}
}))
print(f"   Found: {len(acts)}")
for a in acts:
    details = a.get("details", {})
    if isinstance(details, dict) and details.get("target_username"):
        victims.add((details.get("target_id"), details.get("target_username")))
        print(f"   - {details.get('target_username')}")

# 6. Check attacks with status=executed/completed
print("\n6. Attacks with executed/completed status:")
attacks = list(db.attacks.find({
    "attacker_id": USER_ID,
    "status": {"$in": ["executed", "completed", "killed", "success"]},
    "$or": [
        {"executed_at": {"$gte": week_ago}},
        {"completed_at": {"$gte": week_ago}},
        {"updated_at": {"$gte": week_ago}},
    ]
}))
print(f"   Found: {len(attacks)}")
for a in attacks:
    victims.add((a.get("target_id"), a.get("target_username")))
    print(f"   - {a.get('target_username')}")

# Summary
print("\n" + "="*50)
print(f"TOTAL UNIQUE VICTIMS: {len(victims)}")
for vid, vname in victims:
    if vname:
        print(f"  - {vname} ({vid})")

if not victims:
    print("\n⚠️  NO VICTIMS FOUND - Bot trap blocked all kills!")
    print("Points cannot be distributed to victims as there are none.")
