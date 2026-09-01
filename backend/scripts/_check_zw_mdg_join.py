"""How Zwischenzug is in house MDGs despite invalid join token alerts."""
import os
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

UID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
ALERT_GAME = "1bcc98ff-180c-4d3e-b533-f1fae663db73"

print("=== open auto MDGs ===")
games = list(db.mdg_games.find({"status": "open", "is_automated": True}, {"_id": 0}))
print("count", len(games))
for g in games:
    names = [e.get("username") for e in (g.get("entries") or [])]
    zw = next((e for e in (g.get("entries") or []) if e.get("user_id") == UID), None)
    print("game", g.get("id"), "cycle", g.get("cycle_id"), "n", len(names), "names", names)
    print("  zw entry", zw)

print("\n=== alert game_id ===")
ag = db.mdg_games.find_one({"id": ALERT_GAME}, {"_id": 0, "id": 1, "status": 1, "is_automated": 1, "cycle_id": 1, "entries": 1, "created_at": 1})
if not ag:
    print("not found")
else:
    print({k: ag.get(k) for k in ("id", "status", "is_automated", "cycle_id", "created_at")})
    print("zw in it", any(e.get("user_id") == UID for e in (ag.get("entries") or [])))
    print("entries", [e.get("username") for e in (ag.get("entries") or [])])

print("\n=== recent bot_client_block_events for Zwischenzug ===")
cut = (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()
for e in db.bot_client_block_events.find({"user_id": UID}).sort("created_at", -1).limit(15):
    print({
        "id": e.get("id") or e.get("_id"),
        "at": e.get("created_at"),
        "reason": e.get("reason") or e.get("fail_reason") or e.get("source"),
        "game_id": e.get("game_id"),
        "detail": (str(e.get("detail") or e.get("message") or ""))[:200],
        "keys": [k for k in e.keys() if k != "_id"],
    })

print("\n=== activity/gambling around join ===")
for coll in ("gambling_log", "activity_log", "mdg_events"):
    if coll not in db.list_collection_names():
        continue
    print("coll", coll)
    q = {"$or": [{"user_id": UID}, {"username": "Zwischenzug"}]}
    rows = list(db[coll].find(q).sort("created_at", -1).limit(8))
    for r in rows:
        print(" ", {k: r.get(k) for k in ("created_at", "action", "action_type", "game_type", "details") if k in r or True})
        break
    for r in rows:
        d = r.get("details") or r.get("action") or r.get("game_type")
        print(" ", r.get("created_at"), r.get("action") or r.get("game_type"), str(d)[:180])
