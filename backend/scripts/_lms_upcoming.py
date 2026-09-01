import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]
r = db.lms_gameweeks.update_many(
    {"season_id": "80e9cec9-da12-4021-a719-e0403dad5c21", "gw": {"$gt": 3}, "status": "picks_open"},
    {"$set": {"status": "upcoming"}},
)
print("upcoming", r.modified_count)
for gw in db.lms_gameweeks.find({"season_id": "80e9cec9-da12-4021-a719-e0403dad5c21"}, {"_id": 0, "gw": 1, "status": 1}).sort("gw", 1):
    print(gw)
