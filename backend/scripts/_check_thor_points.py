"""Check Thor points / auto rank for 5k conversion preview."""
import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

u = db.users.find_one(
    {"id": "37137408-371d-41d2-ae26-2dfc83a72c8b"},
    {
        "_id": 0,
        "username": 1,
        "points": 1,
        "auto_rank_purchased": 1,
        "auto_rank_permanent": 1,
        "auto_rank_enabled": 1,
    },
)
print("user", u)
print("already 5k inbox")
for n in db.notifications.find(
    {"user_id": "37137408-371d-41d2-ae26-2dfc83a72c8b", "title": {"$regex": "auto rank|5,000|5000", "$options": "i"}},
    {"_id": 0, "id": 1, "title": 1, "created_at": 1},
).sort("created_at", -1).limit(5):
    print(n)
print("ledger")
for e in db.point_ledger_events.find(
    {"user_id": "37137408-371d-41d2-ae26-2dfc83a72c8b"},
    {"_id": 0, "event_type": 1, "points": 1, "created_at": 1, "origin_ref": 1},
).sort("created_at", -1).limit(8):
    print(e)
