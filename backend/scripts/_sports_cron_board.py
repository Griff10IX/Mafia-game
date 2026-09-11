from dotenv import load_dotenv
import os
from datetime import datetime, timezone, timedelta
from pprint import pprint
import httpx
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
secret = (os.environ.get("CRON_SECRET") or "").strip()
print("cron secret len", len(secret))

with httpx.Client(timeout=180.0) as client:
    r = client.post(
        "http://127.0.0.1:8000/api/sports-betting/cron/auto-board",
        headers={"X-Cron-Secret": secret},
    )
    print("status", r.status_code)
    print(r.text[:1200])

now = datetime.now(timezone.utc)
day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
day1 = day0 + timedelta(days=3)
print("open total", db.sports_events.count_documents({"status": "open"}))
vis = 0
for ev in db.sports_events.find({"status": "open"}, {"_id": 0, "start_time": 1, "name": 1, "category": 1, "options": 1}).sort("start_time", 1):
    st = ev.get("start_time") or ""
    try:
        dt = datetime.fromisoformat(str(st).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except Exception:
        continue
    if not (day0 <= dt < day1):
        continue
    vis += 1
    if vis <= 25:
        opts = ev.get("options") or []
        print("VISIBLE", st, ev.get("category"), ev.get("name"), [(o.get("name"), o.get("odds")) for o in opts[:3]])
print("visible", vis)
