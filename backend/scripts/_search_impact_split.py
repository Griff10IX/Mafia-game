"""Read-only: split the stamped rows by affected/unaffected, status, and whether acted on."""
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
    try:
        d = datetime.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)
    except Exception:
        return None


rows = list(db.attacks.find(
    {"$or": [{"found_at": {"$regex": "^" + s}} for s in STAMPS]},
    {"_id": 0, "id": 1, "status": 1, "search_started": 1, "found_at": 1,
     "location_state": 1, "result": 1},
))

counts = Counter()
for r in rows:
    started = parse(r.get("search_started"))
    run = RUN2 if str(r.get("found_at", "")).startswith(STAMPS[1]) else RUN1
    if not started:
        counts[("no_started", r.get("status"), False)] += 1
        continue
    group = "unaffected" if started + datetime.timedelta(minutes=MAX_MIN) <= run else "affected"
    counts[(group, r.get("status"), bool(r.get("result")))] += 1

print(f"{'group':12s} {'status':10s} {'acted_on':9s} count")
for (group, status, acted), n in sorted(counts.items()):
    print(f"{group:12s} {str(status):10s} {str(acted):9s} {n}")
