"""Who is actively hunting / attacking 5545."""
from __future__ import annotations

import os
import re
from collections import Counter
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

u = db.users.find_one(
    {"username": {"$regex": "^5545$", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "current_state": 1, "last_seen": 1},
)
print("TARGET:", u)
if not u:
    raise SystemExit(1)
tid = u["id"]
tname = u["username"]

now = datetime.now(timezone.utc)
windows = [("15m", now - timedelta(minutes=15)), ("1h", now - timedelta(hours=1)), ("6h", now - timedelta(hours=6)), ("24h", now - timedelta(hours=24))]

print("\n=== ACTIVE HUNTS (attacks collection status searching/found/traveling) ===")
hunts = list(
    db.attacks.find(
        {
            "target_id": tid,
            "status": {"$in": ["searching", "found", "traveling"]},
        },
        {
            "_id": 0,
            "attacker_id": 1,
            "attacker_username": 1,
            "status": 1,
            "location_state": 1,
            "created_at": 1,
            "found_at": 1,
            "updated_at": 1,
        },
    )
)
# also by username if target_id missing on some rows
hunts2 = list(
    db.attacks.find(
        {
            "target_username": {"$regex": f"^{re.escape(tname)}$", "$options": "i"},
            "status": {"$in": ["searching", "found", "traveling"]},
        },
        {
            "_id": 0,
            "attacker_id": 1,
            "attacker_username": 1,
            "status": 1,
            "location_state": 1,
            "created_at": 1,
            "found_at": 1,
        },
    )
)
seen = set()
all_hunts = []
for h in hunts + hunts2:
    key = (h.get("attacker_id"), h.get("status"), h.get("created_at"))
    if key in seen:
        continue
    seen.add(key)
    all_hunts.append(h)

print(f"count={len(all_hunts)}")
for h in sorted(all_hunts, key=lambda x: str(x.get("created_at") or ""), reverse=True):
    aid = h.get("attacker_id")
    aname = h.get("attacker_username")
    if not aname and aid:
        au = db.users.find_one({"id": aid}, {"_id": 0, "username": 1})
        aname = (au or {}).get("username")
    print(f"  {aname or '?':20} status={h.get('status'):10} loc={h.get('location_state')} created={h.get('created_at')} found_at={h.get('found_at')}")

print("\n=== ATTACK ATTEMPTS ON 5545 ===")
for label, since in windows:
    q = {
        "created_at": {"$gte": since},
        "$or": [
            {"target_id": tid},
            {"target_username": {"$regex": f"^{re.escape(tname)}$", "$options": "i"}},
        ],
    }
    n = db.attack_attempts.count_documents(q)
    by = Counter()
    outcomes = Counter()
    for r in db.attack_attempts.find(q, {"attacker_username": 1, "attacker_id": 1, "outcome": 1}):
        name = r.get("attacker_username")
        if not name and r.get("attacker_id"):
            au = db.users.find_one({"id": r["attacker_id"]}, {"_id": 0, "username": 1})
            name = (au or {}).get("username") or "?"
        by[name or "?"] += 1
        outcomes[r.get("outcome") or "?"] += 1
    print(f"\n{label}: attempts={n} outcomes={dict(outcomes)}")
    for name, c in by.most_common(20):
        print(f"  {c:4d}  {name}")

print("\n=== MOST RECENT ATTEMPTS (20) ===")
rows = list(
    db.attack_attempts.find(
        {
            "$or": [
                {"target_id": tid},
                {"target_username": {"$regex": f"^{re.escape(tname)}$", "$options": "i"}},
            ]
        },
        {"_id": 0, "created_at": 1, "attacker_username": 1, "attacker_id": 1, "outcome": 1, "player_message": 1},
    )
    .sort("created_at", -1)
    .limit(20)
)
for r in rows:
    name = r.get("attacker_username")
    if not name and r.get("attacker_id"):
        au = db.users.find_one({"id": r["attacker_id"]}, {"_id": 0, "username": 1})
        name = (au or {}).get("username")
    print(f"  {r.get('created_at')} {name:20} {r.get('outcome')} {(r.get('player_message') or '')[:60]}")
