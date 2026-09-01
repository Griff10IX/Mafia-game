"""See who got the online bonus and whether they were actually last_seen recently."""
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

ORIGIN = "system_ai_gf_online_spins_loot"
now = datetime.now(timezone.utc)
idle_cutoff = (now - timedelta(minutes=10)).isoformat()

ids = [e["user_id"] for e in db.point_ledger_events.find({"origin_ref": ORIGIN}, {"_id": 0, "user_id": 1})]
print("ledger", len(ids), "idle_cutoff", idle_cutoff)
fresh = []
stale = []
for u in db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "username": 1, "last_seen": 1, "auto_rank_enabled": 1, "auto_rank_idle": 1}):
    ls = u.get("last_seen") or ""
    name = u.get("username")
    ar = bool(u.get("auto_rank_enabled"))
    idle = u.get("auto_rank_idle")
    row = (name, ls, ar, idle)
    if ls >= idle_cutoff:
        fresh.append(row)
    else:
        stale.append(row)

print("FRESH", len(fresh))
for r in sorted(fresh, key=lambda x: (x[0] or "").lower()):
    print("  ", r[0], r[1], "ar", r[2], "idle", r[3])
print("STALE", len(stale))
for r in sorted(stale, key=lambda x: (x[0] or "").lower()):
    print("  ", r[0], r[1], "ar", r[2], "idle", r[3])
