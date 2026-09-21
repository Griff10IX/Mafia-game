"""Count coin_flip plays in gambling_log for the past 3 months."""
import os
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc)
cutoff = now - timedelta(days=90)
# Also exact calendar-ish 3 months
cutoff_3m = now.replace(month=now.month - 3) if now.month > 3 else now.replace(year=now.year - 1, month=now.month + 9)

q90 = {"game_type": "coin_flip", "created_at": {"$gte": cutoff}}
# created_at may be string ISO — check a sample
sample = db.gambling_log.find_one({"game_type": "coin_flip"}, {"_id": 0, "created_at": 1})
print("sample_created_at", sample, type((sample or {}).get("created_at")))

n90 = db.gambling_log.count_documents(q90)
# string compare if ISO strings
cutoff_iso = cutoff.isoformat()
n90_str = db.gambling_log.count_documents({"game_type": "coin_flip", "created_at": {"$gte": cutoff_iso}})

# unique users 90d
users = db.gambling_log.distinct("user_id", {"game_type": "coin_flip", "created_at": {"$gte": cutoff}})
users_str = db.gambling_log.distinct("user_id", {"game_type": "coin_flip", "created_at": {"$gte": cutoff_iso}})

# monthly breakdown via aggregate - try datetime then string
from collections import Counter
pipeline = [
    {"$match": {"game_type": "coin_flip", "created_at": {"$gte": cutoff_iso}}},
    {"$group": {"_id": {"$substr": [{"$toString": "$created_at"}, 0, 7]}, "n": {"$sum": 1}}},
    {"$sort": {"_id": 1}},
]
by_month = list(db.gambling_log.aggregate(pipeline))

total_all = db.gambling_log.count_documents({"game_type": "coin_flip"})
print("now", now.isoformat())
print("cutoff_90d", cutoff.isoformat())
print("count_datetime_gte", n90)
print("count_iso_string_gte", n90_str)
print("unique_users_dt", len(users), "unique_users_str", len(users_str))
print("by_month", by_month)
print("all_time", total_all)
