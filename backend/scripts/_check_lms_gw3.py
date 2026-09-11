"""Dump GW3 fixtures fully + how many lost lives that week."""
import os
from collections import Counter
from pprint import pprint

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
SID = "80e9cec9-da12-4021-a719-e0403dad5c21"

g3 = db.lms_gameweeks.find_one({"season_id": SID, "gw": 3}, {"_id": 0})
print("GW3 keys", sorted((g3 or {}).keys()))
print("status", g3.get("status"), "settled_at", g3.get("settled_at"), "synced", g3.get("last_sync_at") or g3.get("synced_at"))
for i, fx in enumerate(g3.get("fixtures") or []):
    print(f"\n--- fx {i} ---")
    pprint(fx)

print("\n=== GW3 picks outcomes ===")
by = Counter()
for p in db.lms_picks.find({"season_id": SID, "gw": 3}, {"_id": 0, "username": 1, "team_name": 1, "team_id": 1, "outcome": 1, "correct": 1, "life_consumed": 1}):
    by[p.get("outcome")] += 1
    print(f"  {p.get('username'):20} {p.get('team_name') or p.get('team_id'):25} outcome={p.get('outcome')} life={p.get('life_consumed')}")
print("outcome counts", dict(by))

# highlights entry lives history note
e = db.lms_entries.find_one({"season_id": SID, "user_id": "ff620eef-283a-4016-a172-d33854bcee7b"}, {"_id": 0})
print("\nentry", {k: e.get(k) for k in ("lives", "extra_life_bought", "status", "teams_used")})
