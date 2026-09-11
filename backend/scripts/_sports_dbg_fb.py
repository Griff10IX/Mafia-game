from dotenv import load_dotenv
import os
from datetime import datetime, timezone
from pymongo import MongoClient
load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

# recently saved templates
print("=== latest saved_at football ===")
for t in db.sports_betting_templates.find({"category":"Football"},{"_id":0,"name":1,"start_time":1,"saved_at":1,"external_sport_key":1}).sort("saved_at",-1).limit(10):
    print(t.get("saved_at"), t.get("start_time"), t.get("external_sport_key"), t.get("name"))

print("\n=== football with start_time >= 2026-09-10 ===")
n=0
for t in db.sports_betting_templates.find({"category":"Football","start_time":{"$gte":"2026-09-10"}},{"_id":0,"name":1,"start_time":1,"external_sport_key":1,"options":1}).sort("start_time",1).limit(20):
    n+=1
    print(t.get("start_time"), t.get("external_sport_key"), t.get("name"), [(o.get("name"),o.get("odds")) for o in (t.get("options") or [])[:3]])
print("count shown", n)

print("\n=== odds cache keys ===")
for c in db.sports_odds_api_cache.find({},{"_id":0,"key":1,"sport":1,"fetched_at":1,"n":1}).sort("fetched_at",-1).limit(15):
    print(c)
