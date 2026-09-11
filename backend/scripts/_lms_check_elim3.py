from dotenv import load_dotenv
import os
from pymongo import MongoClient
from pprint import pprint
load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
SID = "80e9cec9-da12-4021-a719-e0403dad5c21"

# all out entries with eliminated_gw=3
print("=== eliminated_gw=3 ===")
for e in db.lms_entries.find({"season_id": SID, "eliminated_gw": 3}, {"_id": 0, "username": 1, "lives": 1, "status": 1, "correct_streak": 1, "eliminated_gw": 1, "updated_at": 1, "last_outcome": 1}):
    pprint(e)
    picks = list(db.lms_picks.find({"season_id": SID, "user_id": e.get("user_id") if "user_id" in e else None}, {"_id":0,"gw":1,"team_name":1,"outcome":1}))
    # re-fetch with username
    ent = db.lms_entries.find_one({"season_id": SID, "username": e["username"]}, {"_id":0,"user_id":1})
    picks = list(db.lms_picks.find({"season_id": SID, "user_id": ent["user_id"]}, {"_id":0,"gw":1,"team_name":1,"outcome":1,"correct":1,"life_consumed":1}).sort("gw",1))
    print("  picks", picks)

print("\n=== alive entries ===")
for e in db.lms_entries.find({"season_id": SID, "status": "alive"}, {"_id":0,"username":1,"lives":1,"correct_streak":1}).sort("username",1):
    print(e)

print("\n=== Ghost* users ===")
for u in db.users.find({"username": {"$regex": "^ghost", "$options":"i"}}, {"_id":0,"username":1,"id":1}).limit(20):
    print(u)
    ent = db.lms_entries.find_one({"season_id": SID, "user_id": u.get("id")}, {"_id":0,"username":1,"lives":1,"status":1,"eliminated_gw":1,"correct_streak":1})
    print("  entry", ent)

print("\n=== audits / ledger around gw3 for Thor Oblivion HP ===")
for name in ("Thor","Oblivion","HP","GhostRace","Ghostrace","GhostFace"):
    for coll in ("lms_audits","lms_events","lms_weekly_payouts","ledger"):
        if coll not in db.list_collection_names():
            continue
        n = db[coll].count_documents({"$or":[{"username":name},{"username":{"$regex":f"^{name}$","$options":"i"}}]})
        if n:
            print(coll, name, n)
            for d in db[coll].find({"$or":[{"username":name},{"username":{"$regex":f"^{name}$","$options":"i"}}]},{"_id":0}).limit(5):
                pprint(d)
