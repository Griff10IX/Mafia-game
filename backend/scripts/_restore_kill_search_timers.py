"""Rebuild find times for the kill searches that were reset by _free_all_kill_search_timers.py.

Only touches rows that genuinely gained time (original find time was still in the future when
the reset ran). Rows whose find time had already passed are left alone.

Original durations were random.randint(135, 165) minutes and were never stored anywhere except
found_at, so the exact roll is unrecoverable. This re-rolls from the same range off the intact
search_started, putting each row back inside the same window it originally had.

Usage:
    python _restore_kill_search_timers.py            # dry run
    python _restore_kill_search_timers.py --apply    # write changes (snapshot saved first)
"""
import datetime
import json
import random
import sys
from pathlib import Path

from pymongo import MongoClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from utils.kill_search_duration import (  # noqa: E402
    KILL_SEARCH_RANDOM_MAX_MINUTES,
    KILL_SEARCH_RANDOM_MIN_MINUTES,
)

APPLY = "--apply" in sys.argv

RUN1 = datetime.datetime(2026, 9, 3, 21, 17, 57, tzinfo=datetime.timezone.utc)
RUN2 = datetime.datetime(2026, 9, 3, 21, 24, 17, tzinfo=datetime.timezone.utc)
STAMPS = ("2026-09-03T21:17:57", "2026-09-03T21:24:17")
SNAPSHOT = Path("/opt/mafia-app/backups/kill_search_restore_snapshot.json")

env = {}
for line in Path("/opt/mafia-app/backend/.env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k] = v.strip().strip('"').strip("'")

db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]


def parse(raw):
    try:
        dt = datetime.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)
    except Exception:
        return None


rows = list(db.attacks.find(
    {"$or": [{"found_at": {"$regex": "^" + s}} for s in STAMPS]},
    {"_id": 0, "id": 1, "status": 1, "search_started": 1, "found_at": 1,
     "location_state": 1, "result": 1, "attacker_id": 1, "target_username": 1,
     "execute_token": 1, "execute_token_bucket": 1},
))

plan = []
for r in rows:
    started = parse(r.get("search_started"))
    if not started:
        continue
    run = RUN2 if str(r.get("found_at", "")).startswith(STAMPS[1]) else RUN1
    # Unaffected: the search would already have completed before the reset ran.
    if started + datetime.timedelta(minutes=KILL_SEARCH_RANDOM_MAX_MINUTES) <= run:
        continue
    if r.get("result"):
        print("SKIP (already acted on):", r["id"], r.get("target_username"))
        continue
    minutes = random.randint(KILL_SEARCH_RANDOM_MIN_MINUTES, KILL_SEARCH_RANDOM_MAX_MINUTES)
    new_found = (started + datetime.timedelta(minutes=minutes)).isoformat()
    plan.append({
        "id": r["id"],
        "target_username": r.get("target_username"),
        "before": {
            "status": r.get("status"),
            "found_at": r.get("found_at"),
            "location_state": r.get("location_state"),
            "execute_token": r.get("execute_token"),
            "execute_token_bucket": r.get("execute_token_bucket"),
        },
        "after": {
            "status": "searching",
            "found_at": new_found,
            "location_state": None,
            "rebuilt_minutes": minutes,
        },
    })

print(f"\nrows stamped by reset: {len(rows)}")
print(f"rows to restore:       {len(plan)}")
print(f"mode:                  {'APPLY' if APPLY else 'DRY RUN'}\n")

for p in plan:
    b, a = p["before"], p["after"]
    print(f"  {b['status']:9s} -> searching | {b['found_at'][:19]} -> {a['found_at'][:19]} "
          f"(+{a['rebuilt_minutes']}m) | {p['target_username']}")

if not APPLY:
    print("\nDry run only. Re-run with --apply to write.")
    raise SystemExit(0)

SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
SNAPSHOT.write_text(json.dumps({
    "saved_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "note": "before/after for _restore_kill_search_timers.py",
    "rows": plan,
}, indent=2))
print(f"\nsnapshot written: {SNAPSHOT}")

changed = 0
for p in plan:
    res = db.attacks.update_one(
        {"id": p["id"]},
        {
            "$set": {
                "status": "searching",
                "found_at": p["after"]["found_at"],
                "location_state": None,
            },
            "$unset": {"execute_token": "", "execute_token_bucket": ""},
        },
    )
    changed += res.modified_count

print(f"restored rows: {changed}")
print("done")
