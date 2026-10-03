"""Read-only: recover models/rarities of the cars Devious melted/scrapped tonight."""
import os
import sys
from collections import Counter
from datetime import datetime

from dotenv import load_dotenv
from pymongo import MongoClient

sys.path.insert(0, "/opt/mafia-app/backend")
load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

UID = "0c439cae-1d4a-4cb7-b5ed-4e3a6d5762cf"
since = datetime(2026, 10, 2, 23, 0)

acts = list(db.activity_log.find(
    {"user_id": UID, "action": {"$in": ["garage_scrap", "garage_melt"]}, "created_at": {"$gte": since}},
    {"_id": 0, "action": 1, "created_at": 1, "details.car_ids": 1},
))
names = [c for c in db.list_collection_names() if any(t in c.lower() for t in ("car", "gta", "garage", "backup", "steal"))]
print("candidate collections", names)

for a in acts:
    ids = a["details"]["car_ids"]
    print("\n==", a["action"], a["created_at"], len(ids), "cars")
    found = {}
    for coll in names:
        for field in ("id", "user_car_id", "car_uid", "user_car_ids"):
            try:
                for d in db[coll].find({field: {"$in": ids}}, {"_id": 0}).limit(len(ids)):
                    key = d.get(field) if isinstance(d.get(field), str) else None
                    if key and key not in found:
                        found[key] = (coll, d.get("car_id") or d.get("model_id"), d.get("rarity"), d.get("car_name") or d.get("name"))
            except Exception:
                pass
    print("recovered", len(found), "of", len(ids))
    colls = Counter(v[0] for v in found.values())
    print("from", dict(colls))
    print("models", Counter((v[1], v[3], v[2]) for v in found.values()).most_common(20))
