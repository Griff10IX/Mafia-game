"""Grave robber attempts by player past 14 days."""
import os
from datetime import datetime, timezone, timedelta
from collections import Counter
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
cutoff = datetime.now(timezone.utc) - timedelta(days=14)
q = {"attempted_at": {"$gte": cutoff}}
counts = Counter()
for r in db.grave_robber_attempts.find(q, {"_id": 0, "username": 1}):
    counts[(r.get("username") or "?").strip() or "?"] += 1
print("total", sum(counts.values()), "players", len(counts))
for name, n in counts.most_common():
    print(f"{name}\t{n}")
