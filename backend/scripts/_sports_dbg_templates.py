from dotenv import load_dotenv
import os
from datetime import datetime, timezone, timedelta
from collections import Counter
from pymongo import MongoClient
load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
now = datetime.now(timezone.utc)
day0 = now.replace(hour=0,minute=0,second=0,microsecond=0)
day1 = day0 + timedelta(days=3)
print("window", day0, day1)

# soccer keys from env/default
print("env soccer", os.environ.get("SPORTS_AUTO_BOARD_SOCCER_KEYS"))

cats=Counter(); in_win=0; samples=[]
for t in db.sports_betting_templates.find({},{"_id":0,"name":1,"category":1,"start_time":1,"commence_time":1,"external_sport_key":1,"options":1}):
    cats[t.get("category")] += 1
    st = t.get("start_time") or t.get("commence_time") or ""
    if not st: continue
    try:
        dt=datetime.fromisoformat(str(st).replace("Z","+00:00"))
        if dt.tzinfo is None: dt=dt.replace(tzinfo=timezone.utc)
    except Exception:
        continue
    if day0 <= dt < day1:
        in_win += 1
        if len(samples)<30:
            samples.append((st, t.get("category"), t.get("external_sport_key"), t.get("name"), [(o.get("name"),o.get("odds")) for o in (t.get("options") or [])[:3]]))

print("cats", dict(cats))
print("in window", in_win)
for s in samples:
    print(" ", s)

# also check soonest football templates
print("\nsoonest football:")
rows=[]
for t in db.sports_betting_templates.find({"category":"Football"},{"_id":0,"name":1,"start_time":1,"commence_time":1,"external_sport_key":1}):
    st=t.get("start_time") or t.get("commence_time")
    if not st: continue
    try:
        dt=datetime.fromisoformat(str(st).replace("Z","+00:00"))
        if dt.tzinfo is None: dt=dt.replace(tzinfo=timezone.utc)
    except Exception:
        continue
    if dt>now:
        rows.append((dt,t))
rows.sort(key=lambda x:x[0])
for dt,t in rows[:15]:
    print(dt.isoformat(), t.get("external_sport_key"), t.get("name"))
