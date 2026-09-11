from dotenv import load_dotenv
import os
from pprint import pprint
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
SID = "80e9cec9-da12-4021-a719-e0403dad5c21"

g4 = db.lms_gameweeks.find_one({"season_id": SID, "gw": 4}, {"_id": 0})
print("GW4 keys", sorted(g4.keys()))
print("status", g4.get("status"))
print("source", g4.get("source"))
print("synced_at", g4.get("synced_at") or g4.get("last_sync_at"))
print("results_synced", g4.get("results_synced_at"))
print("pick_deadline", g4.get("pick_deadline"))
print("settle_alive_keys", g4.get("settle_alive_keys"))
print("\n=== full fixtures ===")
for i, f in enumerate(g4.get("fixtures") or []):
    print(f"--- {i} ---")
    pprint({k: f.get(k) for k in f if k in (
        "home","away","home_team","away_team","home_score","away_score","result","status",
        "kickoff","kickoff_at","commence_time","external_event_id","fd_match_id","id"
    ) or True})

print("\n=== entries detailed survivors/elim ===")
for e in db.lms_entries.find({"season_id": SID}, {"_id":0}).sort("username",1):
    print({k:e.get(k) for k in ("username","status","lives","correct_streak","eliminated_gw","account_key","user_id")})

print("\n=== GW4 weekly payouts ===")
for p in db.lms_weekly_payouts.find({"season_id": SID, "gw": 4}, {"_id":0}):
    pprint(p)

print("\n=== Schizophrenic / Highlights GW4 ===")
for name in ("Schizophrenic","Highlights","Meraxes","Rabbit","MoeyTS","Bada","Moey"):
    u = db.users.find_one({"username":{"$regex":f"^{name}$","$options":"i"}},{"_id":0,"id":1,"username":1})
    print("user", u)
    if u:
        e = db.lms_entries.find_one({"season_id":SID,"user_id":u["id"]},{"_id":0,"username":1,"lives":1,"status":1,"eliminated_gw":1})
        print(" entry", e)
