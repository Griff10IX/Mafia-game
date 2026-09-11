"""Inspect 5545 attack notes + fix Highlights BG rows."""
import os
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
tid = "07779847-3955-49b9-8a34-0eb21bc44651"

rows = list(
    db.attacks.find(
        {"attacker_id": tid, "status": {"$in": ["searching", "found", "traveling"]}},
        {"_id": 0, "id": 1, "target_username": 1, "note": 1, "status": 1, "search_started": 1, "found_at": 1, "expires_at": 1, "search_source": 1},
    ).sort("search_started", -1)
)
print("=== ACTIVE NOTES ===")
for r in rows:
    print(r.get("note"), "|", r.get("target_username"), "| started", r.get("search_started"), "| found", r.get("found_at"), "| src", r.get("search_source"))
