from dotenv import load_dotenv
import os
from datetime import datetime, timezone
from pprint import pprint
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc).isoformat()
print("now", now)
print("events total", db.sports_betting_events.count_documents({}))
print("upcoming/open", db.sports_betting_events.count_documents({"status": {"$in": ["open", "upcoming", "scheduled"]}}))
print("by status:")
for s in db.sports_betting_events.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
    print(" ", s)

print("\n=== sample recent events ===")
for e in db.sports_betting_events.find({}, {"_id": 0, "id": 1, "home": 1, "away": 1, "home_team": 1, "away_team": 1, "sport": 1, "league": 1, "commence_time": 1, "status": 1, "odds": 1, "markets": 1, "created_at": 1}).sort("commence_time", -1).limit(8):
    pprint({k: e.get(k) for k in e})

print("\n=== settings keys sports ===")
for s in db.game_settings.find({"$or": [{"key": {"$regex": "sport", "$options": "i"}}, {"id": {"$regex": "sport", "$options": "i"}}]}, {"_id": 0}).limit(30):
    print(s)

print("\n=== env-ish in settings ===")
for k in ("ODDS_API_KEY", "SPORTS_AUTO_BOARD", "sports_auto_board"):
    print(k, os.environ.get(k))
