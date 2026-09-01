"""Kick Zwischenzug from open house MDGs (refund fees, no inbox)."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

UID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"


def open_auto_games():
    return list(
        db.mdg_games.find(
            {"status": "open", "is_automated": True},
            {"_id": 0, "id": 1, "house_pot": 1, "fee_money": 1, "pot_money": 1, "pot_points": 1, "entries": 1},
        )
    )


def dump(label):
    print(f"=== {label} ===")
    for g in open_auto_games():
        names = [e.get("username") for e in (g.get("entries") or [])]
        mine = any(e.get("user_id") == UID for e in (g.get("entries") or []))
        print(f"  [{'IN' if mine else 'out'}] {g['id']} house=${float(g.get('house_pot') or 0):,.0f} pot=${float(g.get('pot_money') or 0):,.0f} players={names}")


u = db.users.find_one({"id": UID}, {"_id": 0, "id": 1, "username": 1, "money": 1})
if not u:
    raise SystemExit("Zwischenzug not found")
print("user", u)
dump("before")

kicked = 0
for g in open_auto_games():
    entry = next((e for e in (g.get("entries") or []) if e.get("user_id") == UID), None)
    if not entry:
        continue
    paid_money = float(entry.get("paid_money") or 0)
    paid_pts = int(entry.get("paid_points") or 0)
    gid = g["id"]
    res = db.mdg_games.update_one(
        {"id": gid, "status": "open", "entries.user_id": UID},
        {"$pull": {"entries": {"user_id": UID}}, "$inc": {"pot_money": -paid_money, "pot_points": -paid_pts}},
    )
    if res.modified_count != 1:
        print("  SKIP", gid)
        continue
    if paid_money or paid_pts:
        db.users.update_one({"id": UID}, {"$inc": {"money": paid_money, "points": paid_pts}})
    db.gambling_log.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": UID,
        "username": u.get("username") or "Zwischenzug",
        "game_type": "mdg",
        "details": {
            "action": "staff_kick_refund",
            "game_id": gid,
            "fee_money": paid_money,
            "fee_points": paid_pts,
            "reason": "bot_rejoin_test",
        },
        "created_at": datetime.now(timezone.utc),
    })
    kicked += 1
    print(f"  KICKED {gid} refunded ${paid_money:,.0f}")

print("kicked_count", kicked)
dump("after")
print("join_guard", db.mdg_join_guards.find_one({"user_id": UID}, {"_id": 0, "locked_until": 1, "fails": 1}))
