#!/bin/bash
cd /opt/mafia-app || exit 1

echo "=== Mongo backups available ==="
ls -la backups/ 2>/dev/null | tail -20
echo

echo "=== replica set / oplog? ==="
mongosh --quiet --eval 'try { const s = rs.status(); print("REPLSET", s.set); } catch(e) { print("NO_REPLSET", e.codeName || e.message); }' 2>/dev/null \
  || mongo --quiet --eval 'try { var s = rs.status(); print("REPLSET " + s.set); } catch(e) { print("NO_REPLSET"); }' 2>/dev/null \
  || echo "no mongo shell"
echo

echo "=== oplog window (if any) ==="
mongosh --quiet --eval '
try {
  const o = db.getSiblingDB("local").oplog.rs;
  const first = o.find().sort({$natural:1}).limit(1).toArray()[0];
  const last  = o.find().sort({$natural:-1}).limit(1).toArray()[0];
  print("oplog_first", first && first.ts && first.ts.getTime ? first.ts.getTime() : JSON.stringify(first && first.ts));
  print("oplog_last",  last  && last.ts  && last.ts.getTime  ? last.ts.getTime()  : JSON.stringify(last && last.ts));
} catch(e) { print("NO_OPLOG", e.codeName || e.message); }
' 2>/dev/null || echo "no oplog access"
echo

echo "=== current state of affected attack rows ==="
backend/venv/bin/python - <<'PY'
import datetime
from collections import Counter
from pathlib import Path
from pymongo import MongoClient

env = {}
for line in Path("backend/.env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k] = v.strip().strip('"').strip("'")

db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]

# The two script runs stamped found_at with these exact-ish timestamps.
STAMPS = ("2026-09-03T21:17:57", "2026-09-03T21:24:17")

touched = list(db.attacks.find(
    {"$or": [{"found_at": {"$regex": "^" + s}} for s in STAMPS]},
    {"_id": 0, "id": 1, "status": 1, "search_started": 1, "found_at": 1,
     "expires_at": 1, "attacker_id": 1, "target_username": 1, "location_state": 1},
))
print("rows_with_my_stamp:", len(touched))
print("status breakdown:", dict(Counter(r.get("status") for r in touched)))

# Can we rebuild original found_at? Need search_started + per-search duration.
missing_started = sum(1 for r in touched if not r.get("search_started"))
print("rows missing search_started:", missing_started)

cfg = db.game_config.find_one({"id": "main"}, {"_id": 0, "default_search_minutes": 1})
print("game_config.default_search_minutes:", cfg and cfg.get("default_search_minutes"))

overrides = Counter()
for r in touched:
    u = db.users.find_one({"id": r.get("attacker_id")}, {"_id": 0, "search_minutes_override": 1})
    overrides[(u or {}).get("search_minutes_override")] += 1
print("attacker search_minutes_override values:", dict(overrides))

# Sample rows
print("\nsample rows:")
for r in touched[:6]:
    print(" ", r.get("status"), "started", r.get("search_started"), "found_at", r.get("found_at"), "->", r.get("target_username"))

# Untouched searching rows for comparison (started after my runs)
other = db.attacks.count_documents({"status": "searching", "found_at": {"$not": {"$regex": "^2026-09-03T21:(17:57|24:17)"}}})
print("\nother searching rows (not stamped by me):", other)
PY
