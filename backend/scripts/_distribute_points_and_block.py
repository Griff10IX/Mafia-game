"""Distribute Zwischenzug's points to victims and block revive."""
import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USER_ID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
USERNAME = "Zwischenzug"
POINTS_TO_DISTRIBUTE = 359637

now = datetime.now(timezone.utc)
now_iso = now.isoformat()

# Victims found
VICTIMS = [
    ("a58598e4-9bc1-49bc-b8a6-2b3007a7fcda", "Crosis"),
    ("ccabedb7-e6bd-4b7c-bd59-d0d7053f80c2", "Rabbit"),
    ("ff620eef-283a-4016-a172-d33854bcee7b", "Highlights"),
    ("8b633f4f-b687-45be-a558-f554365fbb9e", "xemon"),
    ("5033f343-bc65-40c4-ab5c-683edef57820", "stle88"),
]

points_each = POINTS_TO_DISTRIBUTE // len(VICTIMS)
remainder = POINTS_TO_DISTRIBUTE % len(VICTIMS)

print("=" * 50)
print("DISTRIBUTING POINTS TO VICTIMS")
print("=" * 50)
print(f"Total points: {POINTS_TO_DISTRIBUTE:,}")
print(f"Victims: {len(VICTIMS)}")
print(f"Points each: {points_each:,}")
print(f"Remainder: {remainder}")
print()

distributions = []

for i, (victim_id, victim_name) in enumerate(VICTIMS):
    # Give first victim the remainder
    pts = points_each + (remainder if i == 0 else 0)
    
    # Get current points
    victim = db.users.find_one({"id": victim_id}, {"points": 1, "username": 1})
    if victim:
        old_points = victim.get("points", 0)
        new_points = old_points + pts
        
        # Update victim's points
        db.users.update_one(
            {"id": victim_id},
            {"$inc": {"points": pts}}
        )
        
        distributions.append({
            "username": victim.get("username", victim_name),
            "points_given": pts,
            "old_points": old_points,
            "new_points": new_points,
        })
        
        print(f"✓ {victim.get('username', victim_name)}: {old_points:,} + {pts:,} = {new_points:,} points")
    else:
        print(f"✗ {victim_name}: User not found!")

print()
print("=" * 50)
print("BLOCKING DEAD > ALIVE REVIVE")
print("=" * 50)

# Block the account from being revived
db.users.update_one(
    {"id": USER_ID},
    {"$set": {
        "revive_blocked": True,
        "revive_blocked_reason": "Permanent ban - botting and ban evasion (previously Piece)",
        "revive_blocked_at": now_iso,
        "dead_to_alive_blocked": True,
    }}
)
print(f"✓ Zwischenzug blocked from Dead > Alive revive")

# Also add to a blocked revives collection if it exists
db.blocked_revives.update_one(
    {"user_id": USER_ID},
    {"$set": {
        "user_id": USER_ID,
        "username": USERNAME,
        "reason": "Permanent ban - botting and ban evasion",
        "blocked_at": now_iso,
        "blocked_by": "System AI",
    }},
    upsert=True
)

print()
print("=" * 50)
print("SUMMARY FOR TOPIC OF SHAME UPDATE")
print("=" * 50)
print(f"Points distributed: {POINTS_TO_DISTRIBUTE:,}")
print("Recipients:")
for d in distributions:
    print(f"  - {d['username']}: +{d['points_given']:,} points")
print(f"Revive blocked: Yes")
