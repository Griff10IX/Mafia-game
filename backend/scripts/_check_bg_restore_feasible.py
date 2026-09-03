"""Read-only: can the bodyguards killed after the timer reset be restored?"""
import datetime
import json
from pathlib import Path

from pymongo import MongoClient

env = {}
for line in Path("/opt/mafia-app/backend/.env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k] = v.strip().strip('"').strip("'")

db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]

FREED = datetime.datetime(2026, 9, 3, 21, 17, 57, tzinfo=datetime.timezone.utc)


def parse(raw):
    if isinstance(raw, datetime.datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=datetime.timezone.utc)
    try:
        d = datetime.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)
    except Exception:
        return None


print("=== sample live bodyguards doc ===")
sample = db.bodyguards.find_one({}, {"_id": 0})
print(json.dumps({k: str(v)[:70] for k, v in (sample or {}).items()}, indent=2))
print()

print("=== hitlist_bodyguard_events since freed ===")
events = []
for e in db.hitlist_bodyguard_events.find({}, {"_id": 0}).sort("_id", -1).limit(400):
    dt = parse(e.get("at"))
    if dt and dt >= FREED:
        events.append((dt, e))
events.sort()
print(f"{len(events)} events")
for dt, e in events:
    print(f"  {dt.strftime('%H:%M:%S')} {e.get('type')} owner={e.get('owner_username')} guard={e.get('guard_username')} guard_id={e.get('guard_user_id')}")
print()

print("=== do the killed bodyguard accounts still exist? ===")
for dt, e in events:
    if e.get("type") != "bodyguard_killed":
        continue
    gid = e.get("guard_user_id")
    if not gid:
        continue
    u = db.users.find_one(
        {"id": gid},
        {"_id": 0, "username": 1, "is_dead": 1, "is_bodyguard": 1, "health": 1,
         "bodyguard_owner_id": 1, "died_at": 1},
    )
    bg = db.bodyguards.find_one({"bodyguard_user_id": gid}, {"_id": 0, "id": 1, "user_id": 1})
    print(f"  {str(e.get('guard_username')):26s} user_doc={'YES' if u else 'NO':3s} "
          f"is_dead={(u or {}).get('is_dead')} bg_row={'YES' if bg else 'NO'}")
print()

print("=== owner bodyguard_slots vs actual rows ===")
owners = {e.get("owner_id") for _, e in events if e.get("owner_id")}
for oid in owners:
    u = db.users.find_one({"id": oid}, {"_id": 0, "username": 1, "bodyguard_slots": 1})
    n = db.bodyguards.count_documents({"user_id": oid})
    print(f"  {(u or {}).get('username'):16s} slots={(u or {}).get('bodyguard_slots')} actual_rows={n}")
