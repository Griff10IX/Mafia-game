"""Check GhostRace/Thor/Oblivion/HP LMS GW3 state."""
import os
from pprint import pprint

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
SID = "80e9cec9-da12-4021-a719-e0403dad5c21"

print("=== ALL GW3 PICKS ===")
for p in db.lms_picks.find(
    {"season_id": SID, "gw": 3},
    {"_id": 0, "username": 1, "team_name": 1, "outcome": 1, "correct": 1, "life_consumed": 1},
):
    pprint(p)

print("\n=== ENTRIES GhostRace/Thor/Oblivion/HP ===")
for e in db.lms_entries.find(
    {
        "season_id": SID,
        "username": {"$regex": "^(GhostRace|Ghostrace|Thor|Oblivion|HP)$", "$options": "i"},
    },
    {"_id": 0, "username": 1, "user_id": 1, "lives": 1, "status": 1, "correct_streak": 1, "eliminated_gw": 1},
):
    pprint(e)
    for p in db.lms_picks.find(
        {"season_id": SID, "user_id": e["user_id"]},
        {"_id": 0, "gw": 1, "team_name": 1, "outcome": 1, "correct": 1, "life_consumed": 1},
    ).sort("gw", 1):
        print("  pick", p)

print("\n=== fuzzy username search ===")
for name in ("ghost", "thor", "obliv", "hp"):
    hits = list(
        db.lms_entries.find(
            {"season_id": SID, "username": {"$regex": name, "$options": "i"}},
            {"_id": 0, "username": 1, "lives": 1, "status": 1, "correct_streak": 1},
        ).limit(10)
    )
    print(name, hits)

print("\n=== GW3 status + fixtures short ===")
gw = db.lms_gameweeks.find_one({"season_id": SID, "gw": 3}, {"_id": 0, "status": 1, "fixtures": 1})
print("status", (gw or {}).get("status"))
for f in (gw or {}).get("fixtures") or []:
    print(
        f.get("home_team") or f.get("home"),
        f.get("home_score"),
        "-",
        f.get("away_score"),
        f.get("away_team") or f.get("away"),
        "result=",
        f.get("result"),
    )
