"""Check Highlights LMS status vs is_dead."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

u = db.users.find_one(
    {"username": {"$regex": "^highlights$", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "money": 1},
)
print("user", u)

seasons = list(db.lms_seasons.find({}, {"_id": 0}).sort("created_at", -1).limit(5))
for s in seasons:
    print("season", s.get("id"), s.get("name"), s.get("status"), s.get("winner_username"), s.get("winner_id"))

sid = (seasons[0] or {}).get("id") if seasons else None
if not sid:
    raise SystemExit("no season")

print("using", sid)
entries = list(db.lms_entries.find({"season_id": sid}, {"_id": 0}))
alive = [e for e in entries if str(e.get("status") or "").lower() in ("alive", "active", "standing") or (e.get("lives", 0) > 0 and not e.get("eliminated_gw"))]
print("--- all entries ---")
for e in sorted(entries, key=lambda x: (x.get("username") or "").lower()):
    print(
        e.get("username"),
        "status=", e.get("status"),
        "lives=", e.get("lives"),
        "elim_gw=", e.get("eliminated_gw"),
        "uid=", e.get("user_id"),
    )

# Cross-check dead accounts still alive in LMS
print("--- alive LMS vs users.is_dead ---")
for e in entries:
    st = str(e.get("status") or "").lower()
    if st in ("eliminated", "dead", "fallen", "out"):
        continue
    if int(e.get("lives") or 0) <= 0 and e.get("eliminated_gw"):
        continue
    uu = db.users.find_one({"id": e.get("user_id")}, {"_id": 0, "username": 1, "is_dead": 1})
    print("standing?", e.get("username"), "lms_status", e.get("status"), "lives", e.get("lives"), "user", uu)

# recent gws
for gw in db.lms_gameweeks.find({"season_id": sid}, {"_id": 0, "gw": 1, "status": 1, "settled_at": 1, "alive_after": 1}).sort("gw", 1):
    print("gw", gw)
