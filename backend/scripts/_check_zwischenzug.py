"""Check Zwischenzug user flags and activity."""
import os
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

u = db.users.find_one(
    {"username": "Zwischenzug"},
    {
        "_id": 0,
        "id": 1,
        "username": 1,
        "bot_flag": 1,
        "rate_limited": 1,
        "suspicious": 1,
        "captcha_required": 1,
        "attack_captcha_required": 1,
        "last_seen": 1,
        "created_at": 1,
        "points": 1,
        "kills": 1,
    },
)
print("User data:", u)

# Count his attacks in last hour
now = datetime.now(timezone.utc)
hour_ago = (now - timedelta(hours=1)).isoformat()
attacks = db.combat_attempts.count_documents({
    "attacker_id": u["id"] if u else None,
    "created_at": {"$gte": hour_ago},
})
print(f"Attacks in last hour: {attacks}")

# Check his recent kill timestamps
recent_kills = list(db.combat_attempts.find(
    {"attacker_id": u["id"] if u else None, "success": True},
    {"_id": 0, "created_at": 1, "target_username": 1},
    sort=[("created_at", -1)],
    limit=10,
))
print("Recent kills:", recent_kills)
