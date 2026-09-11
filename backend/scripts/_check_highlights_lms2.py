"""Highlights LMS GW3 Liverpool fixture + life timeline."""
import os
from pprint import pprint

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

SID = "80e9cec9-da12-4021-a719-e0403dad5c21"
uid = "ff620eef-283a-4016-a172-d33854bcee7b"

for gw in (1, 2, 3, 4):
    g = db.lms_gameweeks.find_one({"season_id": SID, "gw": gw}, {"_id": 0})
    print(f"\n=== GW{gw} status={g and g.get('status')} deadline={g and g.get('pick_deadline')} ===")
    if not g:
        continue
    for fx in g.get("fixtures") or []:
        teams = f"{fx.get('home_name') or fx.get('home_team')} vs {fx.get('away_name') or fx.get('away_team')}"
        # show liverpool fixtures and all scores
        hid = str(fx.get("home_id") or fx.get("home_team_id") or "").lower()
        aid = str(fx.get("away_id") or fx.get("away_team_id") or "").lower()
        hname = str(fx.get("home_name") or fx.get("home_team") or "")
        aname = str(fx.get("away_name") or fx.get("away_team") or "")
        if "liverpool" in hid or "liverpool" in aid or "liverpool" in hname.lower() or "liverpool" in aname.lower() or gw in (2, 3):
            print(
                f"  {hname} {fx.get('home_score')} - {fx.get('away_score')} {aname} "
                f"status={fx.get('status')} result={fx.get('result')} "
                f"home_id={fx.get('home_id') or fx.get('home_team_id')} away_id={fx.get('away_id') or fx.get('away_team_id')}"
            )

# point ledger for extra life
print("\n=== ledger LMS / life ===")
for r in db.point_ledger_events.find(
    {"user_id": uid, "$or": [
        {"event_type": {"$regex": "lms", "$options": "i"}},
        {"event_ref": {"$regex": "lms", "$options": "i"}},
        {"meta.type": {"$regex": "lms", "$options": "i"}},
    ]},
    {"_id": 0},
).sort("created_at", 1):
    pprint(r)

# broader
print("\n=== any extra life events ===")
for r in db.point_ledger_events.find(
    {"user_id": uid, "created_at": {"$gte": "2026-08-13"}},
    {"_id": 0, "created_at": 1, "points": 1, "event_type": 1, "event_ref": 1, "meta": 1},
).sort("created_at", 1):
    et = str(r.get("event_type") or "")
    ref = str(r.get("event_ref") or "")
    meta = str(r.get("meta") or "")
    if "lms" in et.lower() or "lms" in ref.lower() or "life" in et.lower() or "lms" in meta.lower():
        pprint(r)

# pick doc full for gw3
print("\n=== GW3 pick raw ===")
pprint(db.lms_picks.find_one({"season_id": SID, "gw": 3, "user_id": uid}, {"_id": 0}))

# how _pick_won works - show liverpool fixture keys from gw3
g3 = db.lms_gameweeks.find_one({"season_id": SID, "gw": 3}, {"_id": 0, "fixtures": 1})
print("\n=== all GW3 fixtures compact ===")
for fx in (g3 or {}).get("fixtures") or []:
    print(
        f"  {fx.get('home_name') or fx.get('home_id')} {fx.get('home_score')}-{fx.get('away_score')} "
        f"{fx.get('away_name') or fx.get('away_id')} status={fx.get('status')}"
    )
