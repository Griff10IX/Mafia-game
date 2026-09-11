"""Set one of GhostFace's attacks to 'found' for testing."""
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

GHOSTFACE_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"

# Find one of his searching attacks
attack = db.attacks.find_one(
    {"attacker_id": GHOSTFACE_ID, "status": "searching"},
    sort=[("search_started", -1)]
)

if attack:
    # Set it to found
    db.attacks.update_one(
        {"_id": attack["_id"]},
        {"$set": {
            "status": "found",
            "found_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    print(f"Set attack on {attack.get('target_username')} to FOUND")
    print("Now go click KILL USER!")
else:
    print("No searching attacks found for GhostFace")
