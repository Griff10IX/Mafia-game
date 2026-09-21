"""Count grave_robber_attempts in past 14 days."""
import os
from datetime import datetime, timezone, timedelta
from collections import Counter
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

sample = db.grave_robber_attempts.find_one({}, {"_id": 0})
print("sample_keys", sorted((sample or {}).keys()))
print("sample", {k: sample.get(k) for k in ("created_at", "username", "user_id", "at", "timestamp") if sample and k in sample})

cutoff = datetime.now(timezone.utc) - timedelta(days=14)
# try common time fields
for field in ("created_at", "attempted_at", "at", "timestamp"):
    n = db.grave_robber_attempts.count_documents({field: {"$gte": cutoff}})
    if n:
        print(f"count_by_{field}", n)

n_all = db.grave_robber_attempts.count_documents({})
print("all_time", n_all)

# Prefer created_at
q = {"created_at": {"$gte": cutoff}}
n = db.grave_robber_attempts.count_documents(q)
users = Counter()
for r in db.grave_robber_attempts.find(q, {"_id": 0, "username": 1, "user_id": 1}):
    users[(r.get("username") or r.get("user_id") or "?")] += 1
print("rounds_14d", n)
print("unique", len(users))
for name, c in users.most_common(20):
    print(f"  {name}\t{c}")
