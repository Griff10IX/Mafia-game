"""Read-only: what attacks / bodyguard kills happened while search timers were freed."""
import datetime
import json
from collections import Counter
from pathlib import Path

from pymongo import MongoClient

env = {}
for line in Path("/opt/mafia-app/backend/.env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k] = v.strip().strip('"').strip("'")

db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]

FREED_AT = "2026-09-03T21:17:57"
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat()

print("window:", FREED_AT, "->", NOW)
print()

print("=== attack_attempts field sample ===")
one = db.attack_attempts.find_one({"created_at": {"$gte": FREED_AT}}, {"_id": 0})
if one:
    print(json.dumps({k: str(v)[:90] for k, v in one.items()}, indent=2)[:2200])
else:
    # try other timestamp fields
    one = db.attack_attempts.find_one({}, {"_id": 0}, sort=[("_id", -1)])
    print("no created_at match; latest doc keys:", sorted((one or {}).keys()))
print()

for field in ("created_at", "occurred_at", "timestamp"):
    n = db.attack_attempts.count_documents({field: {"$gte": FREED_AT}})
    print(f"attack_attempts with {field} >= freed: {n}")
print()

rows = list(db.attack_attempts.find(
    {"created_at": {"$gte": FREED_AT}},
    {"_id": 0, "created_at": 1, "outcome": 1, "attacker_username": 1,
     "target_username": 1, "target_is_bodyguard": 1, "target_is_robot": 1,
     "attack_id": 1, "target_id": 1, "attacker_id": 1, "bullets_used": 1},
).sort("created_at", 1))

print(f"=== {len(rows)} attempts in window ===")
print("outcomes:", dict(Counter(r.get("outcome") for r in rows)))
print()
for r in rows:
    print(f"  {str(r.get('created_at'))[11:19]} {str(r.get('outcome')):10s} "
          f"{str(r.get('attacker_username')):18s} -> {str(r.get('target_username')):28s} "
          f"bg={r.get('target_is_bodyguard')} robot={r.get('target_is_robot')}")

print()
print("=== bodyguards deleted-ish check: current counts by owner (top 15) ===")
agg = list(db.bodyguards.aggregate([
    {"$group": {"_id": "$user_id", "n": {"$sum": 1}}},
    {"$sort": {"n": -1}},
    {"$limit": 15},
]))
for a in agg:
    u = db.users.find_one({"id": a["_id"]}, {"_id": 0, "username": 1})
    print(f"  {(u or {}).get('username') or a['_id']}: {a['n']}")

print()
print("=== kill-ish logs in window (other collections) ===")
for coll in ("kills", "kill_log", "combat_timeline", "activity_log", "notifications"):
    try:
        n = db[coll].count_documents({"created_at": {"$gte": FREED_AT}})
        print(f"  {coll}: {n}")
    except Exception as e:
        print(f"  {coll}: err {e}")
