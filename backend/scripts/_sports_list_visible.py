from dotenv import load_dotenv
import os
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
now=datetime.now(timezone.utc)
day0=now.replace(hour=0,minute=0,second=0,microsecond=0)
day1=day0+timedelta(days=5)
print("window", day0, day1)
for ev in db.sports_events.find({"status":"open"},{"_id":0,"start_time":1,"name":1,"category":1,"options":1}).sort("start_time",1):
    st=ev.get("start_time") or ""
    try:
        dt=datetime.fromisoformat(str(st).replace("Z","+00:00"))
        if dt.tzinfo is None: dt=dt.replace(tzinfo=timezone.utc)
    except Exception:
        continue
    if day0<=dt<day1:
        opts=ev.get("options") or []
        print(st, ev.get("category"), ev.get("name"), [(o.get("name"), o.get("odds")) for o in opts[:3]])
