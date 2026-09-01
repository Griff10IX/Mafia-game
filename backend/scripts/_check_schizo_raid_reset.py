"""Live check: Schizophrenic raid reset purchase vs actual reset."""
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

UID = "828d4094-7095-4007-bb4e-9d8c25c7bc8f"
u = db.users.find_one(
    {"id": UID},
    {
        "_id": 0,
        "username": 1,
        "points": 1,
        "raid_reset_day": 1,
        "raid_reset_last_at": 1,
        "illegal_business_raids_today": 1,
        "illegal_business_raids_date": 1,
    },
)
print("user", u)

for coll in ("activity_logs", "activity_log", "user_activity", "store_purchases", "store_points_purchases", "point_events", "respect_events"):
    if coll not in db.list_collection_names():
        continue
    n = db[coll].count_documents({"$or": [{"user_id": UID}, {"userId": UID}]})
    print("coll", coll, "user_docs", n)

print("--- activity ---")
for cname in db.list_collection_names():
    if "activ" in cname.lower() or "store" in cname.lower() or "point" in cname.lower() or "log" in cname.lower():
        hit = list(
            db[cname]
            .find(
                {
                    "$and": [
                        {"$or": [{"user_id": UID}, {"userId": UID}]},
                        {
                            "$or": [
                                {"action": {"$regex": "raid", "$options": "i"}},
                                {"type": {"$regex": "raid", "$options": "i"}},
                                {"event_ref": {"$regex": "raid", "$options": "i"}},
                                {"event_type": {"$regex": "raid", "$options": "i"}},
                                {"details.item": "raid_reset"},
                                {"item": "raid_reset"},
                                {"meta.store_item": "buy-raid-reset"},
                                {"context.store_item": "buy-raid-reset"},
                            ]
                        },
                    ]
                },
                {"_id": 0},
            )
            .sort([("_id", -1)])
            .limit(8)
        )
        if hit:
            print("HITS", cname, hit)

print("now", datetime.now(timezone.utc).isoformat())
