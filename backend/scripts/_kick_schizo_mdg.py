"""Kick Schizophrenic from open house MDGs (refund fees, no inbox) and watch for auto-rejoin."""
import os
import time
import uuid
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

NAME = "Schizophrenic"
WATCH_SECONDS = 120
POLL_EVERY = 5


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def find_user():
    u = db.users.find_one(
        {"username": {"$regex": f"^{NAME}$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1, "money": 1, "points": 1},
    )
    if not u:
        raise SystemExit(f"user not found: {NAME}")
    return u


def open_auto_games():
    return list(
        db.mdg_games.find(
            {"status": "open", "is_automated": True},
            {"_id": 0, "id": 1, "cycle_id": 1, "house_pot": 1, "fee_money": 1, "pot_money": 1, "pot_points": 1, "entries": 1, "auto_roll_deadline": 1},
        )
    )


def dump_games(uid, label):
    print(f"=== {label} ===")
    games = open_auto_games()
    in_ids = []
    for g in games:
        names = [e.get("username") for e in (g.get("entries") or [])]
        mine = next((e for e in (g.get("entries") or []) if e.get("user_id") == uid), None)
        flag = "IN" if mine else "out"
        print(
            f"  [{flag}] {g.get('id')} house=${float(g.get('house_pot') or 0):,.0f} "
            f"fee=${float(g.get('fee_money') or 0):,.0f} pot=${float(g.get('pot_money') or 0):,.0f} "
            f"players={names}"
        )
        if mine:
            in_ids.append(g["id"])
    print(f"  in {len(in_ids)}/{len(games)} tables")
    return games, in_ids


def recent_joins(uid, minutes=180):
    cut = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    rows = list(
        db.gambling_log.find(
            {"user_id": uid, "game_type": "mdg", "created_at": {"$gte": cut}},
            {"_id": 0, "created_at": 1, "details": 1},
        ).sort("created_at", -1).limit(30)
    )
    print(f"=== mdg gambling_log last {minutes}m ({len(rows)}) ===")
    for r in rows:
        d = r.get("details") or {}
        print(" ", r.get("created_at"), d.get("action"), d.get("game_id"), "fee", d.get("fee_money"))


def kick(uid, username):
    games = open_auto_games()
    kicked = []
    for g in games:
        entry = next((e for e in (g.get("entries") or []) if e.get("user_id") == uid), None)
        if not entry:
            continue
        paid_money = float(entry.get("paid_money") or 0)
        paid_pts = int(entry.get("paid_points") or 0)
        gid = g["id"]
        res = db.mdg_games.update_one(
            {"id": gid, "status": "open", "entries.user_id": uid},
            {
                "$pull": {"entries": {"user_id": uid}},
                "$inc": {"pot_money": -paid_money, "pot_points": -paid_pts},
            },
        )
        if res.modified_count != 1:
            print("  SKIP could not pull", gid)
            continue
        if paid_money or paid_pts:
            db.users.update_one({"id": uid}, {"$inc": {"money": paid_money, "points": paid_pts}})
        db.gambling_log.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "username": username,
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
        kicked.append({"game_id": gid, "refund_money": paid_money, "refund_points": paid_pts, "house_pot": g.get("house_pot")})
        print(f"  KICKED {gid} refunded ${paid_money:,.0f}")
    return kicked


def watch(uid, kicked_ids):
    print(f"=== watching {WATCH_SECONDS}s for rejoin ===")
    deadline = time.time() + WATCH_SECONDS
    seen = set()
    while time.time() < deadline:
        games = open_auto_games()
        now_in = []
        for g in games:
            if any(e.get("user_id") == uid for e in (g.get("entries") or [])):
                now_in.append(g["id"])
        new = [gid for gid in now_in if gid not in seen]
        if new:
            for gid in new:
                g = next((x for x in games if x["id"] == gid), None)
                names = [e.get("username") for e in ((g or {}).get("entries") or [])]
                was_kicked = gid in kicked_ids
                print(f"  REJOIN {now_iso()} game={gid} kicked_table={was_kicked} players={names}")
            seen.update(new)
        left = int(deadline - time.time())
        print(f"  t+{WATCH_SECONDS - left}s in={len(now_in)} {now_in or '-'} remaining={left}s")
        time.sleep(POLL_EVERY)
    print("=== watch done ===")
    dump_games(uid, "after watch")
    cut = datetime.now(timezone.utc) - timedelta(minutes=10)
    rows = list(
        db.gambling_log.find(
            {"user_id": uid, "game_type": "mdg", "created_at": {"$gte": cut}},
            {"_id": 0, "created_at": 1, "details": 1},
        ).sort("created_at", -1).limit(20)
    )
    print("=== mdg log last 10m ===")
    for r in rows:
        d = r.get("details") or {}
        print(" ", r.get("created_at"), d.get("action"), d.get("game_id"))
    guard = db.mdg_join_guards.find_one({"user_id": uid}, {"_id": 0})
    print("join_guard", guard)


u = find_user()
uid = u["id"]
print("user", u)
recent_joins(uid)
dump_games(uid, "before kick")
kicked = kick(uid, u.get("username") or NAME)
print("kicked_count", len(kicked))
dump_games(uid, "after kick")
watch(uid, {k["game_id"] for k in kicked})
