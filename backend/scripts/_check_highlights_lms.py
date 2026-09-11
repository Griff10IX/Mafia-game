"""Highlights LMS — picks, lives, Liverpool check."""
import os
import json
from pprint import pprint

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

u = db.users.find_one(
    {"username": {"$regex": "^Highlights$", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1},
)
print("USER", u)
uid = u["id"]

# collections
for c in sorted(db.list_collection_names()):
    if "lms" in c.lower():
        print("coll", c)

# entries
for coll in ("lms_entries", "lms_entry", "lms_players", "lms_participants"):
    if coll not in db.list_collection_names():
        continue
    rows = list(db[coll].find({"$or": [{"user_id": uid}, {"username": {"$regex": "^Highlights$", "$options": "i"}}]}, {"_id": 0}))
    print(f"\n=== {coll} n={len(rows)} ===")
    for r in rows:
        pprint(r, width=120)

# picks
for coll in ("lms_picks", "lms_pick", "lms_selections"):
    if coll not in db.list_collection_names():
        continue
    rows = list(
        db[coll].find({"$or": [{"user_id": uid}, {"username": {"$regex": "^Highlights$", "$options": "i"}}]}, {"_id": 0})
        .sort([("gw", 1), ("gameweek", 1), ("at", 1)])
    )
    print(f"\n=== {coll} n={len(rows)} ===")
    for r in rows:
        pprint(r, width=120)

# seasons / gameweeks recent
seasons = list(db.lms_seasons.find({}, {"_id": 0}).sort("created_at", -1).limit(3)) if "lms_seasons" in db.list_collection_names() else []
print("\n=== seasons ===")
for s in seasons:
    pprint({k: s.get(k) for k in ("id", "name", "status", "current_gw", "season_label", "created_at", "entry_fee") if k in s or True})
    print({k: s.get(k) for k in list(s)[:20]})

# sample entry schema from any entry
if "lms_entries" in db.list_collection_names():
    sample = db.lms_entries.find_one({}, {"_id": 0})
    print("\nsample entry keys", sorted((sample or {}).keys()))
