import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]
uid = "9499a1ea-bf2e-46fe-a3c0-e9506491b83e"
p = db.payment_transactions.find_one(
    {"user_id": uid, "package_id": "custom", "payment_status": "completed"},
)
p.pop("_id", None)
for k, v in p.items():
    print(k, ":", v)

print("\nnotifications around credit")
for n in db.notifications.find({"user_id": uid, "created_at": {"$gte": "2026-08-28", "$lte": "2026-08-29"}}).sort("created_at", 1):
    print(n.get("created_at"), n.get("title"), (n.get("message") or "")[:220])
