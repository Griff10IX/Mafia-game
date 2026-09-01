"""Schizophrenic rejoin after kick + Zwischenzug MDG lock/fails."""
import os
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

SCHIZO = "828d4094-7095-4007-bb4e-9d8c25c7bc8f"
ZW = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
KICK_AT = datetime(2026, 8, 31, 0, 11, 29, tzinfo=timezone.utc)

print("now", datetime.now(timezone.utc).isoformat())

print("\n=== open house games ===")
for g in db.mdg_games.find({"status": "open", "is_automated": True}, {"_id": 0, "id": 1, "house_pot": 1, "fee_money": 1, "pot_money": 1, "entries": 1, "cycle_id": 1}):
    names = [(e.get("username"), e.get("user_id")) for e in (g.get("entries") or [])]
    print(g["id"], "house", int(g.get("house_pot") or 0), "fee", int(g.get("fee_money") or 0), "pot", int(g.get("pot_money") or 0))
    for n, uid in names:
        print("   ", n, uid)

def dump_mdg(uid, label, minutes=180):
    cut = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    print(f"\n=== {label} gambling_log last {minutes}m ===")
    rows = list(db.gambling_log.find({"user_id": uid, "game_type": "mdg", "created_at": {"$gte": cut}}).sort("created_at", 1))
    for r in rows:
        d = r.get("details") or {}
        print(" ", r.get("created_at"), d.get("action"), d.get("game_id"), "fee", d.get("fee_money"), "reason", d.get("reason") or d.get("fail_reason"))

dump_mdg(SCHIZO, "Schizophrenic")
dump_mdg(ZW, "Zwischenzug")

print("\n=== Schizophrenic joins AFTER kick ===")
rows = list(db.gambling_log.find({"user_id": SCHIZO, "game_type": "mdg", "created_at": {"$gte": KICK_AT}}).sort("created_at", 1))
for r in rows:
    d = r.get("details") or {}
    print(" ", r.get("created_at"), d.get("action"), d.get("game_id"))

print("\n=== join_guards ===")
for uid, name in ((SCHIZO, "Schizophrenic"), (ZW, "Zwischenzug")):
    print(name, db.mdg_join_guards.find_one({"user_id": uid}, {"_id": 0}))

print("\n=== Zwischenzug bot_client_block_events last 2h ===")
cut = datetime.now(timezone.utc) - timedelta(hours=2)
# created_at might be datetime or iso
for e in db.bot_client_block_events.find({"user_id": ZW}).sort("_id", -1).limit(12):
    print({
        "id": str(e.get("_id")),
        "at": e.get("created_at") or e.get("at"),
        "reason": e.get("reason") or e.get("fail_reason"),
        "game_id": e.get("game_id"),
        "source": e.get("source"),
        "endpoint": e.get("endpoint") or e.get("endpoint_desc"),
    })

print("\n=== notifications to GhostFace about MDG last 2h (titles) ===")
gf = "36425cb4-3755-4669-b4b5-5d86345991d0"
for n in db.notifications.find({"user_id": gf, "created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()}}).sort("created_at", -1).limit(15):
    print(" ", n.get("created_at"), n.get("title"), (str(n.get("message") or "")[:80]))
