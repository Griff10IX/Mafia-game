from datetime import datetime, timedelta, timezone
from _system_ai_prank_helpers import db, find_user, _nice

u = db.users.find_one({"username": "Highlights"}, {"_id": 0})
keys = sorted(k for k in (u or {}) if any(s in k.lower() for s in ("last", "online", "seen", "active", "presence")))
print("activity keys", keys)
for k in keys:
    print(k, (u or {}).get(k))

# claw Ciro
c = db.users.find_one({"username": "CiroTerranova0008011d"}, {"_id": 0, "id": 1, "username": 1, "points": 1})
print("ciro", c)

print("chat last 20 unique")
seen = []
for m in db.game_chat_messages.find({"channel": "global"}, {"username": 1, "user_id": 1, "created_at": 1}).sort("created_at", -1).limit(80):
    uid = m.get("user_id")
    if uid in seen:
        continue
    seen.append(uid)
    if len(seen) > 20:
        break
    print(m.get("created_at"), m.get("username"), uid)
