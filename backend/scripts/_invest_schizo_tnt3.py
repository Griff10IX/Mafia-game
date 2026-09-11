"""Find Thor's 10k points claim — which account got funded."""
from __future__ import annotations

import os
from collections import Counter

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

SCHIZO = "828d4094-7095-4007-bb4e-9d8c25c7bc8f"
THOR = "37137408-371d-41d2-ae26-2dfc83a72c8b"

# Thor email / IP for dead alts
thor = db.users.find_one({"id": THOR}, {"_id": 0, "email": 1, "registration_ip": 1, "last_request_ip": 1})
print("Thor", thor)

# accounts that ever received exactly 10000 from Schizo
rows = list(
    db.points_transfers.find(
        {"from_user_id": SCHIZO, "amount": {"$in": [10000, 9950, 10000.0]}},
        {"_id": 0},
    ).sort("created_at", -1).limit(40)
)
print(f"Schizo sends of ~10k: {len(rows)}")
for r in rows:
    print(r.get("created_at"), "->", r.get("to_username"), r.get("amount"))

# any Schizo -> Thor*
rows = list(
    db.points_transfers.find(
        {
            "from_user_id": SCHIZO,
            "to_username": {"$regex": "thor", "$options": "i"},
        },
        {"_id": 0},
    )
)
print(f"\nSchizo -> Thor*: {len(rows)}")
for r in rows:
    print(r)

# TNT total sent to Schizo
tot = 0
c = 0
for r in db.points_transfers.find({"from_user_id": "5bd4e12d-2919-44c3-bf29-dbdd522b6fea", "to_user_id": SCHIZO}):
    tot += int(r.get("amount") or 0)
    c += 1
print(f"\nTNT -> Schizo transfers: count={c} total_points={tot}")

# reverse Schizo -> TNT
tot2 = 0
c2 = 0
for r in db.points_transfers.find({"from_user_id": SCHIZO, "to_user_id": "5bd4e12d-2919-44c3-bf29-dbdd522b6fea"}):
    tot2 += int(r.get("amount") or 0)
    c2 += 1
print(f"Schizo -> TNT: count={c2} total={tot2}")

# Concurrent last_seen style: did they ever attack same minute?
from datetime import datetime, timedelta, timezone

# lifetime brief
print("\nCreated: Schizo Aug4, TNT Aug15, TNT dead Aug25")
print("Overlap living window: Aug15-Aug25")

# same device cookies / fingerprints if any
for coll in ("device_fingerprints", "client_fingerprints", "user_devices", "login_fingerprints"):
    try:
        n = db[coll].count_documents({})
        print(coll, n)
    except Exception:
        pass

# Oblivion on TNT reg IP - check
ob = db.users.find_one({"username": "Oblivion"}, {"_id": 0, "email": 1, "is_dead": 1, "registration_ip": 1, "created_at": 1})
print("Oblivion", ob)
