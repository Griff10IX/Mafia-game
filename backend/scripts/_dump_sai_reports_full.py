"""Dump full open System AI reports for reply drafting."""
import os
from pprint import pprint

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

for r in db.system_ai_reports.find({"status": "open"}, {"_id": 0}).sort("created_at", -1):
    print("=" * 60)
    for k in (
        "id", "username", "category", "subject", "body", "details", "message",
        "target_username", "reported_username", "accused", "created_at", "status",
    ):
        if k in r and r[k] is not None:
            print(f"{k}: {r[k]}")
    extras = {k: v for k, v in r.items() if k not in {
        "id", "username", "category", "subject", "body", "details", "message",
        "target_username", "reported_username", "accused", "created_at", "status", "replies",
    }}
    if extras:
        print("other:", sorted(extras.keys()))
        if "reported_user" in extras or "target" in extras:
            pprint({k: extras[k] for k in extras if k in ("reported_user", "target", "meta")})
