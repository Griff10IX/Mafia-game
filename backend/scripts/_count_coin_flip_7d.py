"""Count coin_flip plays last 7 days."""
import os
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
cutoff = datetime.now(timezone.utc) - timedelta(days=7)
q = {"game_type": "coin_flip", "created_at": {"$gte": cutoff}}
n = db.gambling_log.count_documents(q)
users = db.gambling_log.distinct("user_id", q)
print("rounds", n, "unique_users", len(users), "since", cutoff.isoformat())
