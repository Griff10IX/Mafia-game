"""Check when HP's found attacks are ready."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient
from datetime import datetime, timezone

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

HP_ID = "a20e2b58-95d7-4bf4-8a41-244f620b3298"
now = datetime.now(timezone.utc)

attacks = list(db.attacks.find({"attacker_id": HP_ID, "status": "found"}))
print("HP Found Attacks:\n")

for a in attacks:
    target = a.get("target_username", "?")
    execute_after = a.get("execute_after")
    
    if execute_after:
        if isinstance(execute_after, str):
            ea = datetime.fromisoformat(execute_after.replace("Z", "+00:00"))
        else:
            ea = execute_after.replace(tzinfo=timezone.utc) if execute_after.tzinfo is None else execute_after
        
        diff = (ea - now).total_seconds()
        if diff > 0:
            mins = int(diff // 60)
            secs = int(diff % 60)
            status = f"Ready in {mins}m {secs}s"
        else:
            status = "🔴 READY NOW!"
    else:
        status = "Unknown"
    
    print(f"{target:30s} {status}")
