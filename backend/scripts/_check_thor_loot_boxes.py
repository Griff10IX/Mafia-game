"""Live loot-box check for Thor's claim. Read-only."""
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient, DESCENDING

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc)
since = (now - timedelta(hours=24)).isoformat()
print("NOW", now.isoformat())

thor = db.users.find_one(
    {"username": {"$regex": "^thor$", "$options": "i"}},
    {
        "_id": 0,
        "id": 1,
        "username": 1,
        "loot_box_pieces": 1,
        "loot_box_free_rare_opens": 1,
        "loot_box_recent": 1,
        "in_jail": 1,
        "jail_until": 1,
        "unbreakable_until": 1,
        "is_dead": 1,
        "is_admin": 1,
        "email": 1,
    },
)
print("THOR", {k: v for k, v in (thor or {}).items() if k != "email"})
print("THOR_RECENT_N", len((thor or {}).get("loot_box_recent") or []))
for row in list((thor or {}).get("loot_box_recent") or [])[-5:]:
    print(" recent_win", row)

print("\n=== economy_events loot_box_open last 24h ===")
q = {"type": "loot_box_open", "at": {"$gte": since}}
print("count_24h", db.economy_events.count_documents(q))
print("thor_24h", db.economy_events.count_documents({**q, "user_id": (thor or {}).get("id")}))
for e in db.economy_events.find(q, {"_id": 0}).sort("at", DESCENDING).limit(8):
    print(e.get("at"), e.get("username") or e.get("user_id"), e.get("tier") or e.get("paid_tier"), str(e.get("detail") or e.get("rewards") or "")[:120])

print("\n=== last 8 any loot_box_open ===")
for e in db.economy_events.find({"type": "loot_box_open"}, {"_id": 0}).sort("at", DESCENDING).limit(8):
    print(e.get("at"), e.get("username") or e.get("user_id"), e.get("tier") or e.get("box_quality") or e.get("paid_tier"), "keys", sorted(list(e.keys()))[:20])

print("\n=== help desk loot ===")
for coll in ("help_desk_tickets", "helpdesk_tickets", "tickets"):
    if coll in db.list_collection_names():
        print("coll", coll)
        for t in db[coll].find(
            {"$or": [
                {"subject": {"$regex": "loot", "$options": "i"}},
                {"title": {"$regex": "loot", "$options": "i"}},
                {"message": {"$regex": "loot", "$options": "i"}},
                {"body": {"$regex": "loot", "$options": "i"}},
            ]},
            {"_id": 0, "id": 1, "username": 1, "subject": 1, "title": 1, "status": 1, "created_at": 1, "message": 1, "body": 1},
        ).sort("created_at", DESCENDING).limit(8):
            print(t.get("created_at"), t.get("username"), t.get("status"), t.get("subject") or t.get("title"), (t.get("message") or t.get("body") or "")[:160])

print("\n=== page_locks ===")
pl = db.game_settings.find_one({"key": "page_locks"}, {"_id": 0})
print(pl)

print("\n=== notifications from Thor last day mentioning loot ===")
if thor:
    for n in db.notifications.find(
        {"user_id": thor["id"], "created_at": {"$gte": since}},
        {"_id": 0, "title": 1, "message": 1, "created_at": 1, "type": 1},
    ).sort("created_at", DESCENDING).limit(10):
        print(n.get("created_at"), n.get("title"), (n.get("message") or "")[:100])
print("done")
