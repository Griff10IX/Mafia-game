"""Read-only: how many kill searches were actually advantaged by the found_at reset."""
import datetime
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

MIN_MIN, MAX_MIN = 135, 165
RUN1 = datetime.datetime(2026, 9, 3, 21, 17, 57, tzinfo=datetime.timezone.utc)
RUN2 = datetime.datetime(2026, 9, 3, 21, 24, 17, tzinfo=datetime.timezone.utc)
STAMPS = ("2026-09-03T21:17:57", "2026-09-03T21:24:17")


def parse(raw):
    if not raw:
        return None
    try:
        dt = datetime.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)
    except Exception:
        return None


rows = list(db.attacks.find(
    {"$or": [{"found_at": {"$regex": "^" + s}} for s in STAMPS]},
    {"_id": 0, "id": 1, "status": 1, "search_started": 1, "found_at": 1,
     "attacker_id": 1, "target_username": 1},
))

buckets = Counter()
affected = []
for r in rows:
    started = parse(r.get("search_started"))
    run = RUN2 if str(r.get("found_at", "")).startswith(STAMPS[1]) else RUN1
    if not started:
        buckets["no_search_started"] += 1
        continue
    earliest = started + datetime.timedelta(minutes=MIN_MIN)   # soonest it could have found
    latest = started + datetime.timedelta(minutes=MAX_MIN)     # latest it could have found
    if latest <= run:
        buckets["already_findable_no_change"] += 1
    elif earliest > run:
        buckets["genuinely_still_searching"] += 1
        affected.append((r, started, earliest, latest))
    else:
        buckets["uncertain_within_random_window"] += 1
        affected.append((r, started, earliest, latest))

print("total stamped rows:", len(rows))
print("status:", dict(Counter(r.get("status") for r in rows)))
print()
for k, v in buckets.most_common():
    print(f"  {k}: {v}")

print("\n=== rows that actually gained time ===")
by_attacker = Counter()
for r, started, earliest, latest in affected:
    u = db.users.find_one({"id": r.get("attacker_id")}, {"_id": 0, "username": 1})
    name = (u or {}).get("username") or r.get("attacker_id")
    by_attacker[name] += 1
for name, n in by_attacker.most_common():
    print(f"  {name}: {n}")

print("\nsample affected rows:")
for r, started, earliest, latest in affected[:10]:
    print(f"  {r.get('status'):9s} started {started.isoformat()} would_find {earliest.strftime('%H:%M')}-{latest.strftime('%H:%M')} -> {r.get('target_username')}")

print("\n=== age spread of all stamped rows ===")
ages = Counter()
for r in rows:
    started = parse(r.get("search_started"))
    if not started:
        continue
    days = (RUN1 - started).days
    if days >= 30:
        ages["30d+"] += 1
    elif days >= 7:
        ages["7-30d"] += 1
    elif days >= 1:
        ages["1-7d"] += 1
    else:
        ages["today"] += 1
for k, v in ages.most_common():
    print(f"  {k}: {v}")
