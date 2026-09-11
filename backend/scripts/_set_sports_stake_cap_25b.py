"""Set live sports_bet_max_total_open_stake to $25B."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
CAP = 25_000_000_000
before = db.game_settings.find_one({"key": "sports_bet_max_total_open_stake"}, {"_id": 0})
print("before", before)
db.game_settings.update_one(
    {"key": "sports_bet_max_total_open_stake"},
    {"$set": {"key": "sports_bet_max_total_open_stake", "value": CAP}},
    upsert=True,
)
print("after", db.game_settings.find_one({"key": "sports_bet_max_total_open_stake"}, {"_id": 0}))
