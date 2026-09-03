"""Lock (or unlock) the Attack page via the game_settings page_locks entry.

Usage:
    python _lock_attack_page.py          # lock
    python _lock_attack_page.py unlock   # unlock
"""
import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

PAGE_LOCKS_KEY = "page_locks"
PATH = "/kill/attack"
MESSAGE = (
    "Attack is temporarily closed while we fix a loading issue. "
    "Search timers have been freed - nothing lost."
)

unlock = len(sys.argv) > 1 and sys.argv[1].lower() == "unlock"

doc = db.game_settings.find_one({"key": PAGE_LOCKS_KEY}, {"_id": 0, "value": 1})
value = (doc.get("value") or {}) if doc else {}
raw = dict(value.get("paths") or {}) if isinstance(value.get("paths"), dict) else {}

# Same normalisation the admin endpoint does: legacy string entries become dicts.
for k, v in list(raw.items()):
    if isinstance(v, str):
        raw[k] = {"message": v, "unlock_at": None}

print("before:", raw)

if unlock:
    raw.pop(PATH, None)
else:
    raw[PATH] = {"message": MESSAGE, "unlock_at": None}

db.game_settings.update_one(
    {"key": PAGE_LOCKS_KEY},
    {"$set": {"value": {"paths": raw}}},
    upsert=True,
)

after = db.game_settings.find_one({"key": PAGE_LOCKS_KEY}, {"_id": 0, "value": 1})
print("after:", (after.get("value") or {}).get("paths"))
print("UNLOCKED" if unlock else "LOCKED", PATH)
