"""Who played coin_flip in last 7 days."""
import os
from datetime import datetime, timezone, timedelta
from collections import Counter
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
cutoff = datetime.now(timezone.utc) - timedelta(days=7)
rows = list(
    db.gambling_log.find(
        {"game_type": "coin_flip", "created_at": {"$gte": cutoff}},
        {"_id": 0, "username": 1, "user_id": 1},
    )
)
counts = Counter()
ids = {}
for r in rows:
    name = (r.get("username") or "?").strip() or "?"
    counts[name] += 1
    if r.get("user_id"):
        ids[name] = r["user_id"]
for name, n in counts.most_common():
    print(f"{name}\t{n}\t{ids.get(name, '')}")
print("total", len(rows))
