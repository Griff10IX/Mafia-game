"""LMS pot payout / winner details for current season."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

SID = "80e9cec9-da12-4021-a719-e0403dad5c21"
s = db.lms_seasons.find_one({"id": SID}, {"_id": 0})
print("season keys sample:", {k: s.get(k) for k in sorted(s.keys()) if k in (
    "id","name","status","pot","entry_fee","winner_user_ids","winner_usernames","winners","settled_at","settled_reason","pot_paid","payout"
)})
print("full season status fields:")
for k,v in sorted(s.items()):
    if any(x in k.lower() for x in ("win","pot","pay","settle","status","fee","alive")):
        print(f"  {k}={v}")

# payouts collection
for coll in ("lms_payouts", "lms_weekly_payouts", "lms_season_payouts", "points_events"):
    if coll not in db.list_collection_names():
        continue
    n = db[coll].count_documents({"season_id": SID} if coll.startswith("lms") else {"event_type": {"$regex": "lms", "$options": "i"}})
    print(coll, "count", n)
    if coll.startswith("lms"):
        for r in db[coll].find({"season_id": SID}, {"_id": 0}).limit(20):
            print(" ", r)

# points events for Highlights / LMS
HID = "ff620eef-283a-4016-a172-d33854bcee7b"
for ev in db.points_events.find({"user_id": HID, "event_type": {"$regex": "lms", "$options": "i"}}, {"_id": 0}).sort("created_at", -1).limit(10):
    print("points_event", ev)

# when did Highlights die?
acts = list(db.activity_log.find({"user_id": HID, "action": {"$regex": "kill|death|die|modkill", "$options": "i"}}, {"_id": 0, "action": 1, "created_at": 1, "meta": 1}).sort("created_at", -1).limit(5))
print("recent death-ish activity", acts)
u = db.users.find_one({"id": HID}, {"_id": 0, "is_dead": 1, "died_at": 1, "killed_at": 1, "death_at": 1, "username": 1, "points": 1, "original_username": 1})
print("user death fields", u)

# any living alt same email?
email_u = db.users.find_one({"id": HID}, {"_id": 0, "email": 1})
email = (email_u or {}).get("email")
print("email", email)
if email:
    alts = list(db.users.find({"email": email}, {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "points": 1}))
    print("alts", alts)
