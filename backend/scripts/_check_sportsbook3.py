from dotenv import load_dotenv
import os
from datetime import datetime, timezone, timedelta
from pprint import pprint
from pymongo import MongoClient
load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
now = datetime.now(timezone.utc)
print("sports_events by status:")
for s in db.sports_events.aggregate([{"$group":{"_id":"$status","n":{"$sum":1}}}]):
    print(s)
print("open count", db.sports_events.count_documents({"status":"open"}))
print("\n=== open events sample (soonest) ===")
for e in db.sports_events.find({"status":"open"},{"_id":0,"name":1,"category":1,"start_time":1,"options":1,"auto_board":1}).sort("start_time",1).limit(15):
    opts = e.get("options") or []
    print(e.get("start_time"), e.get("category"), e.get("name"), [(o.get("name"), o.get("odds")) for o in opts[:4]])

# templates with kickoff today
day0 = now.replace(hour=0,minute=0,second=0,microsecond=0)
day1 = day0 + timedelta(days=1)
print("\nday window", day0, day1)
# check template start times today
n_today=0
samples=[]
for t in db.sports_betting_templates.find({},{"_id":0,"id":1,"name":1,"start_time":1,"commence_time":1,"category":1,"options":1}).limit(5000):
    st = t.get("start_time") or t.get("commence_time") or ""
    if not st: continue
    try:
        raw=st.replace("Z","+00:00") if isinstance(st,str) else st
        dt = datetime.fromisoformat(raw) if isinstance(raw,str) else raw
        if dt.tzinfo is None: dt=dt.replace(tzinfo=timezone.utc)
        if day0 <= dt < day1:
            n_today+=1
            if len(samples)<8:
                samples.append((st,t.get("category"),t.get("name"),[(o.get("name"),o.get("odds")) for o in (t.get("options") or [])[:3]]))
    except Exception:
        pass
print("templates kickoff today UTC:", n_today)
for s in samples: print(" ", s)

# ticker?
print("\nSPORTS_AUTO_BOARD env", os.environ.get("SPORTS_AUTO_BOARD_USE_CRON"), os.environ.get("SPORTS_AUTO_BOARD_TICKER"))
