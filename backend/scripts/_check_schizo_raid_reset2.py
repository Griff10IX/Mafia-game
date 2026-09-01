import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]
UID = "828d4094-7095-4007-bb4e-9d8c25c7bc8f"

print("store_purchase raid")
for d in db.activity_log.find(
    {"user_id": UID, "action": "store_purchase", "details.item": "raid_reset"},
    {"_id": 0, "created_at": 1, "details": 1},
).sort([("_id", -1)]).limit(5):
    print(d)

print("point buy-raid-reset recent")
for d in db.point_audit_events.find(
    {"user_id": UID, "origin_ref": "buy-raid-reset"},
    {"_id": 0, "created_at": 1, "delta": 1, "context": 1},
).sort([("_id", -1)]).limit(5):
    print(d)
