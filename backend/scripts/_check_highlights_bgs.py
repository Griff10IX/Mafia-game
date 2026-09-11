"""Highlights bodyguard hire / replace / kill snapshot."""
import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

u = db.users.find_one(
    {"username": {"$regex": "^Highlights$", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "bodyguard_slots": 1, "points": 1, "robot_bodyguard_hire_tokens": 1},
)
print("USER", u)
if not u:
    raise SystemExit(1)
uid = u["id"]

bgs = list(db.bodyguards.find({"user_id": uid}, {"_id": 0, "slot_number": 1, "is_robot": 1, "robot_name": 1, "hired_at": 1, "hire_cost": 1, "hired_with_token": 1}).sort("slot_number", 1))
print("\n=== CURRENT BGs ===")
for b in bgs:
    print(b)
print(f"filled={len(bgs)} slots={u.get('bodyguard_slots')}")

now = datetime.now(timezone.utc)
windows = [("6h", now - timedelta(hours=6)), ("24h", now - timedelta(hours=24)), ("7d", now - timedelta(days=7)), ("30d", now - timedelta(days=30))]

print("\n=== HITLIST EVENTS (hire/kill/replace) ===")
types_of_interest = ["bodyguard_hired", "bodyguard_killed", "admin_robot_bodyguards_replaced", "bodyguard_slot_bought"]
for label, since in windows:
    q = {"owner_id": uid, "type": {"$in": types_of_interest}, "at": {"$gte": since}}
    # also try naive
    n = db.hitlist_bodyguard_events.count_documents(q)
    if n == 0:
        q2 = dict(q)
        q2["at"] = {"$gte": since.replace(tzinfo=None)}
        n = db.hitlist_bodyguard_events.count_documents(q2)
        q = q2
    by = Counter()
    for r in db.hitlist_bodyguard_events.find(q, {"type": 1, "is_robot": 1}):
        t = r.get("type")
        if r.get("is_robot") is True and t == "bodyguard_hired":
            by["bodyguard_hired_robot"] += 1
        elif r.get("is_robot") is False and t == "bodyguard_hired":
            by["bodyguard_hired_human"] += 1
        else:
            by[t] += 1
    print(f"{label}: {dict(by)} total={n}")

print("\n=== LAST 40 HIRE EVENTS ===")
hires = list(db.hitlist_bodyguard_events.find(
    {"owner_id": uid, "type": "bodyguard_hired"},
    {"_id": 0, "at": 1, "slot": 1, "is_robot": 1, "hire_cost": 1, "listed_cost": 1, "used_hire_token": 1,
     "bodyguard_username": 1, "guard_user_id": 1, "inflation_level_before": 1, "staff_topup": 1},
).sort("at", -1).limit(40))
for h in hires:
    print(h)

print("\n=== LAST 20 KILLS OF HIS BGs ===")
kills = list(db.hitlist_bodyguard_events.find(
    {"owner_id": uid, "type": "bodyguard_killed"},
    {"_id": 0, "at": 1, "slot": 1, "guard_username": 1, "killer_username": 1, "is_robot": 1, "hire_cost": 1},
).sort("at", -1).limit(20))
for k in kills:
    print(k)

print("\n=== REPLACE EVENTS ===")
reps = list(db.hitlist_bodyguard_events.find(
    {"owner_id": uid, "type": "admin_robot_bodyguards_replaced"},
    {"_id": 0},
).sort("at", -1).limit(10))
print("count", len(reps))
for r in reps:
    print({k: r.get(k) for k in ("at", "count", "admin_username", "new_usernames", "previous")})

print("\n=== POINT LEDGER bodyguard_hire (last 30) ===")
led = list(db.point_ledger_events.find(
    {"user_id": uid, "event_type": "bodyguard_hire"},
    {"_id": 0, "created_at": 1, "points": 1, "meta": 1, "event_ref": 1},
).sort("created_at", -1).limit(30))
for L in led:
    print(L)

# Detect bulk clusters: hires within 2 min of each other
print("\n=== BULK CLUSTERS (hires within 120s) ===")
all_hires = list(db.hitlist_bodyguard_events.find(
    {"owner_id": uid, "type": "bodyguard_hired", "is_robot": True},
    {"_id": 0, "at": 1, "slot": 1, "hire_cost": 1, "bodyguard_username": 1, "used_hire_token": 1},
).sort("at", -1).limit(80))

def as_dt(v):
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str):
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None

cluster = []
clusters = []
for h in reversed(all_hires):  # oldest first among recent
    t = as_dt(h.get("at"))
    if not t:
        continue
    if not cluster:
        cluster = [h]
        continue
    prev = as_dt(cluster[-1].get("at"))
    if prev and (t - prev).total_seconds() <= 120:
        cluster.append(h)
    else:
        if len(cluster) >= 2:
            clusters.append(cluster)
        cluster = [h]
if len(cluster) >= 2:
    clusters.append(cluster)

# show last 8 clusters
for c in clusters[-8:]:
    ts = [as_dt(x.get("at")) for x in c]
    costs = [int(x.get("hire_cost") or 0) for x in c]
    print(f"  n={len(c)} from={ts[0]} to={ts[-1]} costs={costs} total={sum(costs)} names={[x.get('bodyguard_username') for x in c]}")
