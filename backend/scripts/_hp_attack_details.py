"""Check HP's found attack details."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient
import json
from datetime import datetime, timezone

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

HP_ID = "a20e2b58-95d7-4bf4-8a41-244f620b3298"
now = datetime.now(timezone.utc)

attacks = list(db.attacks.find({"attacker_id": HP_ID, "status": "found"}))

print(f"HP Found Attacks: {len(attacks)}\n")

for a in attacks:
    a["_id"] = str(a["_id"])
    target = a.get("target_username", "?")
    found_at = a.get("found_at")
    
    # Check for any time-related field
    time_field = None
    for f in ["execute_after", "can_execute_at", "ready_at", "found_at"]:
        if a.get(f):
            time_field = f
            break
    
    print(f"\n=== {target} ===")
    print(f"Found at: {found_at}")
    
    # Print all fields
    for k, v in a.items():
        if k not in ["_id", "attacker_id", "target_id", "target_username"]:
            print(f"  {k}: {v}")
