from dotenv import load_dotenv
import os
from pprint import pprint
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
SID = "80e9cec9-da12-4021-a719-e0403dad5c21"

print("=== SEASON ===")
s = db.lms_seasons.find_one({"id": SID}, {"_id": 0})
if not s:
    s = db.lms_seasons.find_one({}, {"_id": 0}, sort=[("created_at", -1)])
    SID = s.get("id") if s else SID
    print("using season", SID)
pprint({k: s.get(k) for k in ("id","name","status","current_gameweek","pot","entry_count","gw1_complete") if s})

print("\n=== GAMEWEEKS ===")
for gw in db.lms_gameweeks.find({"season_id": SID}, {"_id": 0, "gw": 1, "status": 1, "settled_at": 1, "pick_deadline": 1, "alive_after": 1, "eliminated": 1, "settle_started_at": 1}).sort("gw", 1):
    print(gw)

print("\n=== GW3 fixtures short ===")
g3 = db.lms_gameweeks.find_one({"season_id": SID, "gw": 3}, {"_id": 0, "status": 1, "fixtures": 1, "settled_at": 1})
print("status", (g3 or {}).get("status"), "settled_at", (g3 or {}).get("settled_at"))
for f in (g3 or {}).get("fixtures") or []:
    print(" ", f.get("home_team") or f.get("home"), f.get("home_score"), "-", f.get("away_score"), f.get("away_team") or f.get("away"), "result=", f.get("result"), "status=", f.get("status"))

print("\n=== GW4 fixtures short ===")
g4 = db.lms_gameweeks.find_one({"season_id": SID, "gw": 4}, {"_id": 0, "status": 1, "fixtures": 1, "settled_at": 1, "pick_deadline": 1})
print("status", (g4 or {}).get("status"), "settled_at", (g4 or {}).get("settled_at"), "deadline", (g4 or {}).get("pick_deadline"))
for f in (g4 or {}).get("fixtures") or []:
    print(" ", f.get("home_team") or f.get("home"), f.get("home_score"), "-", f.get("away_score"), f.get("away_team") or f.get("away"), "result=", f.get("result"), "status=", f.get("status"))

print("\n=== ALL ENTRIES ===")
for e in db.lms_entries.find({"season_id": SID}, {"_id": 0, "username": 1, "lives": 1, "status": 1, "correct_streak": 1, "eliminated_gw": 1}).sort("username", 1):
    print(e)

print("\n=== GW3 picks ===")
for p in db.lms_picks.find({"season_id": SID, "gw": 3}, {"_id": 0, "username": 1, "team_name": 1, "outcome": 1, "correct": 1, "life_consumed": 1}):
    print(p)

print("\n=== GW4 picks ===")
for p in db.lms_picks.find({"season_id": SID, "gw": 4}, {"_id": 0, "username": 1, "team_name": 1, "outcome": 1, "correct": 1, "life_consumed": 1}):
    print(p)

print("\n=== eliminated_gw=4 ===")
for e in db.lms_entries.find({"season_id": SID, "eliminated_gw": 4}, {"_id": 0, "username": 1, "lives": 1, "status": 1, "user_id": 1}):
    print(e)
    picks = list(db.lms_picks.find({"season_id": SID, "user_id": e["user_id"]}, {"_id": 0, "gw": 1, "team_name": 1, "outcome": 1, "life_consumed": 1}).sort("gw", 1))
    print("  picks", picks)
