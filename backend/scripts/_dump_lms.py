"""Dump live LMS season/gameweek status."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

print("LMS_TICKER", os.environ.get("LMS_TICKER"))
print("LMS_USE_CRON", os.environ.get("LMS_USE_CRON"))
print("FD_TOKEN", "yes" if (os.environ.get("FOOTBALL_DATA_ORG_TOKEN") or "").strip() else "no")
print("ODDS_KEY", "yes" if (os.environ.get("THE_ODDS_API_KEY") or "").strip() else "no")

for s in db.lms_seasons.find({}, {"_id": 0, "id": 1, "name": 1, "status": 1, "current_gameweek": 1, "gw1_complete": 1, "pot": 1, "entry_count": 1}):
    print("SEASON", s)
    sid = s["id"]
    for gw in db.lms_gameweeks.find({"season_id": sid}, {"_id": 0, "gw": 1, "status": 1, "pick_deadline": 1, "source": 1, "synced_at": 1, "results_synced_at": 1, "fixtures": 1}).sort("gw", 1):
        fx = gw.get("fixtures") or []
        results = {}
        ids = []
        for f in fx:
            r = f.get("result") or "none"
            results[r] = results.get(r, 0) + 1
            ids.append((f.get("home"), f.get("away"), f.get("result"), f.get("external_event_id"), f.get("home_score"), f.get("away_score")))
        print("  GW", gw.get("gw"), "status", gw.get("status"), "deadline", gw.get("pick_deadline"), "src", gw.get("source"), "fx", len(fx), "results", results)
        if int(gw.get("gw") or 0) <= 3:
            for row in ids:
                print("   ", row)
