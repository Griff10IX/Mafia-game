"""Confirm LMS pot credit + Highlights death vs settle timing."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

SID = "80e9cec9-da12-4021-a719-e0403dad5c21"
HID = "ff620eef-283a-4016-a172-d33854bcee7b"

# pot ledger
print("=== lms pot rows ===")
for coll in db.list_collection_names():
    if "lms" in coll.lower() and "pot" in coll.lower():
        print("coll", coll)
        for r in db[coll].find({"season_id": SID}, {"_id": 0}):
            print(r)

print("\n=== points events for Highlights (any lms / pot) ===")
for ev in db.points_events.find({"user_id": HID}, {"_id": 0}).sort("created_at", -1).limit(30):
    et = str(ev.get("event_type") or "")
    if "lms" in et.lower() or "pot" in et.lower() or int(ev.get("points") or 0) >= 100000:
        print(ev)

print("\n=== all points_events around settle ===")
for ev in db.points_events.find(
    {"user_id": HID, "created_at": {"$gte": "2026-09-20"}},
    {"_id": 0},
).sort("created_at", -1).limit(20):
    print(ev)

# death timing
u = db.users.find_one({"id": HID}, {"_id": 0, "is_dead": 1, "died_at": 1, "killed_at": 1, "death_time": 1, "points": 1, "username": 1, "email": 1, "current_state": 1})
print("\nuser", u)

# who killed Highlights most recently
print("\n=== recent deaths / kills of Highlights ===")
for coll in ("deaths", "kill_feed", "combat_attempts", "notifications"):
    if coll not in db.list_collection_names():
        continue
    q = {"$or": [
        {"victim_id": HID}, {"target_id": HID}, {"user_id": HID},
        {"victim_username": "Highlights"}, {"target_username": "Highlights"},
        {"username": "Highlights"},
    ]}
    n = db[coll].count_documents(q)
    print(coll, "hits", n)
    if n and coll != "notifications":
        for r in db[coll].find(q, {"_id": 0}).sort([("created_at", -1), ("at", -1), ("timestamp", -1)]).limit(3):
            print(" ", {k: r.get(k) for k in list(r)[:12]})

# entry status
e = db.lms_entries.find_one({"season_id": SID, "user_id": HID}, {"_id": 0})
print("\nentry", e)

# other alive/won entries
print("\nother entries status counts:")
from collections import Counter
c = Counter()
for r in db.lms_entries.find({"season_id": SID}, {"_id": 0, "status": 1, "username": 1}):
    c[r.get("status")] += 1
print(dict(c))
print("won/alive:", list(db.lms_entries.find({"season_id": SID, "status": {"$in": ["alive", "won"]}}, {"_id": 0, "username": 1, "status": 1, "lives": 1})))
