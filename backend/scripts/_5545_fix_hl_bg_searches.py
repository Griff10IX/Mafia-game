"""Fix Highlights BG searches on 5545: note + backdate to hire times."""
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

ATTACKER_ID = "07779847-3955-49b9-8a34-0eb21bc44651"
NOTE = "Bodyguard for: Highlights"

# Exact hire times from hitlist_bodyguard_events
FIXES = {
    "JoeMasseriafcfa0406": datetime(2026, 9, 5, 1, 29, 57, 804000, tzinfo=timezone.utc),
    "DutchSchultzdddfa3ed": datetime(2026, 9, 5, 1, 30, 9, 40000, tzinfo=timezone.utc),
}


def parse_iso(v):
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str):
        return datetime.fromisoformat(v.replace("Z", "+00:00"))
    return None


for uname, hire_at in FIXES.items():
    row = db.attacks.find_one(
        {
            "attacker_id": ATTACKER_ID,
            "target_username": uname,
            "status": {"$in": ["searching", "found", "traveling"]},
        }
    )
    if not row:
        print(f"MISS {uname}")
        continue
    started = parse_iso(row.get("search_started"))
    found = parse_iso(row.get("found_at"))
    if not started or not found:
        print(f"BAD times {uname}")
        continue
    duration = found - started
    new_found = hire_at + duration
    new_expires = hire_at + timedelta(hours=24)
    upd = {
        "note": NOTE,
        "search_started": hire_at.isoformat(),
        "found_at": new_found.isoformat(),
        "expires_at": new_expires.isoformat(),
    }
    db.attacks.update_one({"id": row["id"]}, {"$set": upd, "$unset": {"search_source": ""}})
    print(f"OK {uname}")
    print(f"  was started={row.get('search_started')} found={row.get('found_at')} note={row.get('note')}")
    print(f"  now started={upd['search_started']} found={upd['found_at']} note={NOTE}")
    print(f"  duration kept={duration}")

# bust list cache if collection exists / or via in-process — process restart not needed;
# attack list uses in-memory cache keyed by attacker; clear via a tiny touch if possible.
# Best-effort: delete any attack_list_cache docs if present
try:
    n = db.attack_list_cache.delete_many({"attacker_id": ATTACKER_ID}).deleted_count
    print(f"cache_docs_cleared={n}")
except Exception as e:
    print("cache skip", e)

# verify
for uname in FIXES:
    r = db.attacks.find_one(
        {"attacker_id": ATTACKER_ID, "target_username": uname, "status": "searching"},
        {"_id": 0, "note": 1, "search_started": 1, "found_at": 1, "expires_at": 1},
    )
    print("VERIFY", uname, r)
