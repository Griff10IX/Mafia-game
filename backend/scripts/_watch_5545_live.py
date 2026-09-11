"""Live watch who is attacking 5545 for ~5 minutes."""
from __future__ import annotations

import os
import re
import time
from collections import Counter
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

WATCH_SEC = 5 * 60
POLL = 10

u = db.users.find_one(
    {"username": {"$regex": "^5545$", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "current_state": 1, "is_dead": 1, "last_seen": 1},
)
if not u:
    print("5545 not found")
    raise SystemExit(1)

tid = u["id"]
tname = u["username"]
print(f"=== LIVE WATCH 5545 ({tid}) for {WATCH_SEC}s ===", flush=True)
print(f"start dead={u.get('is_dead')} city={u.get('current_state')} last_seen={u.get('last_seen')}", flush=True)

seen_ids = set()
# seed: ignore attempts older than watch start
watch_start = datetime.now(timezone.utc)
totals = Counter()
outcomes = Counter()
last_by = {}

start = time.time()
tick = 0
while time.time() - start < WATCH_SEC:
    tick += 1
    elapsed = int(time.time() - start)
    since = watch_start - timedelta(seconds=5)

    # fresh target status
    tu = db.users.find_one(
        {"id": tid},
        {"_id": 0, "is_dead": 1, "current_state": 1, "last_seen": 1, "traveling_to": 1, "travel_arrives_at": 1},
    )

    q = {
        "created_at": {"$gte": since},
        "$or": [
            {"target_id": tid},
            {"target_username": {"$regex": f"^{re.escape(tname)}$", "$options": "i"}},
        ],
    }
    # Prefer datetime compare; also iso string fallback not needed if stored as datetime
    new_rows = []
    for r in db.attack_attempts.find(
        q,
        {"_id": 1, "created_at": 1, "attacker_username": 1, "attacker_id": 1, "outcome": 1, "player_message": 1},
    ).sort("created_at", -1).limit(200):
        rid = str(r.get("_id"))
        if rid in seen_ids:
            continue
        # only count during watch
        ca = r.get("created_at")
        if isinstance(ca, datetime):
            ca2 = ca if ca.tzinfo else ca.replace(tzinfo=timezone.utc)
            if ca2 < watch_start:
                continue
        seen_ids.add(rid)
        new_rows.append(r)

    # active hunts snapshot
    hunts = list(
        db.attacks.find(
            {
                "$or": [
                    {"target_id": tid},
                    {"target_username": {"$regex": f"^{re.escape(tname)}$", "$options": "i"}},
                ],
                "status": {"$in": ["searching", "found", "traveling"]},
            },
            {"_id": 0, "attacker_username": 1, "attacker_id": 1, "status": 1, "location_state": 1},
        )
    )
    hunt_lines = []
    for h in hunts:
        an = h.get("attacker_username")
        if not an and h.get("attacker_id"):
            au = db.users.find_one({"id": h["attacker_id"]}, {"_id": 0, "username": 1})
            an = (au or {}).get("username") or "?"
        hunt_lines.append(f"{an}:{h.get('status')}@{h.get('location_state') or '-'}")

    window = Counter()
    for r in new_rows:
        name = r.get("attacker_username")
        if not name and r.get("attacker_id"):
            au = db.users.find_one({"id": r["attacker_id"]}, {"_id": 0, "username": 1})
            name = (au or {}).get("username") or "?"
        window[name] += 1
        totals[name] += 1
        outcomes[r.get("outcome") or "?"] += 1
        last_by[name] = r.get("created_at")

    dead = (tu or {}).get("is_dead")
    city = (tu or {}).get("current_state")
    print(
        f"[{elapsed:3d}s] dead={dead} city={city} new_attempts={len(new_rows)} "
        f"hunts=[{', '.join(hunt_lines) or 'none'}]",
        flush=True,
    )
    if window:
        for name, c in window.most_common():
            print(f"         +{c} {name} (total_watch={totals[name]})", flush=True)
    elif tick % 3 == 1:
        print("         (quiet this poll)", flush=True)

    if dead:
        print("*** 5545 DIED during watch ***", flush=True)
        break

    time.sleep(POLL)

print("\n=== WATCH SUMMARY ===", flush=True)
print(f"attempts during watch: {sum(totals.values())}", flush=True)
print(f"outcomes: {dict(outcomes)}", flush=True)
for name, c in totals.most_common():
    print(f"  {c:4d}  {name}  last={last_by.get(name)}", flush=True)
if not totals:
    print("  nobody landed an attack_attempt on 5545 during the window", flush=True)
tu = db.users.find_one({"id": tid}, {"_id": 0, "is_dead": 1, "current_state": 1, "last_seen": 1})
print(f"end state: {tu}", flush=True)
