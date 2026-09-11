"""Check bot trap stats."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

t = db.bot_traps.find_one({"username": "Zwischenzug"})
if t:
    print(f"=== BOT TRAP STATS FOR Zwischenzug ===")
    print(f"Failures: {t.get('failures', 0)}")
    print(f"Successes: {t.get('successes', 0)}")
    print(f"Active: {t.get('active')}")
    if t.get('failures', 0) > 0 and t.get('successes', 0) == 0:
        print(f"\n🤖 100% FAILURE RATE = CONFIRMED BOT")
        print(f"   A human would have stopped or refreshed after first failure")
else:
    print("No trap found")
