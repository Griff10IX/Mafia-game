"""Investigate Meraxes report: Yama & Vuse — cheating / sharing / botting (last 2 days)."""
from __future__ import annotations

import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pprint import pprint

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

NAMES = ["Yama", "Vuse", "Hoomz"]  # Hoomz aka Vuse from prior context
SINCE = datetime.now(timezone.utc) - timedelta(days=2)
SINCE_ISO = SINCE.isoformat()


def find_users(names):
    out = []
    for n in names:
        u = db.users.find_one(
            {"username": {"$regex": f"^{re.escape(n)}$", "$options": "i"}},
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "email": 1,
                "is_dead": 1,
                "is_banned": 1,
                "created_at": 1,
                "last_seen": 1,
                "last_login_ip": 1,
                "registration_ip": 1,
                "known_ips": 1,
                "points": 1,
                "kills": 1,
                "cash": 1,
                "family_id": 1,
            },
        )
        if u:
            out.append(u)
        else:
            print(f"NOT FOUND: {n}")
    return out


def collect_ips(u):
    ips = set()
    for k in ("last_login_ip", "registration_ip"):
        if u.get(k):
            ips.add(str(u[k]).strip())
    for x in u.get("known_ips") or []:
        if x:
            ips.add(str(x).strip())
    return ips


print("=" * 70)
print("ACCOUNTS")
print("=" * 70)
users = find_users(NAMES)
by_id = {u["id"]: u for u in users}
for u in users:
    print(
        f"{u['username']:12} id={u['id']} dead={u.get('is_dead')} banned={u.get('is_banned')} "
        f"pts={u.get('points')} kills={u.get('kills')} last_seen={u.get('last_seen')}"
    )
    print(f"  email={u.get('email')}")
    print(f"  reg_ip={u.get('registration_ip')} last_ip={u.get('last_login_ip')}")
    print(f"  known_ips={u.get('known_ips')}")

print("\n" + "=" * 70)
print("IP OVERLAP")
print("=" * 70)
ip_map = {u["username"]: collect_ips(u) for u in users}
all_ips = set()
for s in ip_map.values():
    all_ips |= s
for ip in sorted(all_ips):
    owners = [name for name, s in ip_map.items() if ip in s]
    if len(owners) > 1:
        print(f"SHARED IP {ip}: {owners}")
    else:
        print(f"solo {ip}: {owners}")

# login / session logs if present
print("\n" + "=" * 70)
print("LOGIN / SESSION ACTIVITY (48h)")
print("=" * 70)
uids = [u["id"] for u in users]
for coll in ("login_logs", "user_logins", "sessions", "auth_logs", "activity_log"):
    try:
        n = db[coll].count_documents(
            {
                "$or": [
                    {"user_id": {"$in": uids}},
                    {"username": {"$in": [u["username"] for u in users]}},
                ],
                "created_at": {"$gte": SINCE_ISO},
            }
        )
        print(f"{coll}: {n}")
    except Exception as e:
        print(f"{coll}: {e}")

# sample activity_log
try:
    rows = list(
        db.activity_log.find(
            {"user_id": {"$in": uids}, "created_at": {"$gte": SINCE_ISO}},
            {"_id": 0, "user_id": 1, "username": 1, "action": 1, "created_at": 1, "ip": 1, "details": 1},
        )
        .sort("created_at", -1)
        .limit(30)
    )
    print(f"activity_log sample ({len(rows)}):")
    for r in rows[:15]:
        print(f"  {r.get('created_at')} {r.get('username')} {r.get('action')} ip={r.get('ip')}")
except Exception as e:
    print("activity_log sample err", e)

print("\n" + "=" * 70)
print("ATTACK ATTEMPTS (48h)")
print("=" * 70)
for u in users:
    uid = u["id"]
    n = db.attack_attempts.count_documents({"attacker_id": uid, "created_at": {"$gte": SINCE}})
    outcomes = Counter()
    for row in db.attack_attempts.find(
        {"attacker_id": uid, "created_at": {"$gte": SINCE}},
        {"outcome": 1},
    ):
        outcomes[row.get("outcome") or "?"] += 1
    print(f"{u['username']}: attempts={n} outcomes={dict(outcomes)}")

print("\n" + "=" * 70)
print("TRAVEL / FOLLOW PATTERN (48h activity_log attack_travel)")
print("=" * 70)
for u in users:
    travels = list(
        db.activity_log.find(
            {"user_id": u["id"], "action": "attack_travel", "created_at": {"$gte": SINCE_ISO}},
            {"_id": 0, "created_at": 1, "details": 1},
        )
        .sort("created_at", -1)
        .limit(20)
    )
    print(f"{u['username']} attack_travel count~={db.activity_log.count_documents({'user_id': u['id'], 'action': 'attack_travel', 'created_at': {'$gte': SINCE_ISO}})}")
    for t in travels[:8]:
        print(f"  {t.get('created_at')} {t.get('details')}")

print("\n" + "=" * 70)
print("SAME-EMAIL / DEVICE FINGERPRINTS")
print("=" * 70)
emails = {u.get("email") for u in users if u.get("email")}
for em in emails:
    same = list(db.users.find({"email": em}, {"_id": 0, "username": 1, "id": 1, "is_dead": 1, "is_banned": 1}))
    print(f"email {em}: {[x.get('username') for x in same]}")

# IP from attack_attempts meta if stored
print("\n" + "=" * 70)
print("ATTACK ATTEMPT IPS (if present)")
print("=" * 70)
for u in users:
    ips = Counter()
    for row in db.attack_attempts.find(
        {"attacker_id": u["id"], "created_at": {"$gte": SINCE}},
        {"attacker_ip": 1, "ip": 1, "client_ip": 1, "meta": 1},
    ).limit(500):
        ip = row.get("attacker_ip") or row.get("ip") or row.get("client_ip")
        if not ip and isinstance(row.get("meta"), dict):
            ip = row["meta"].get("ip") or row["meta"].get("client_ip")
        if ip:
            ips[ip] += 1
    print(f"{u['username']}: {ips.most_common(5)}")

print("\n" + "=" * 70)
print("BOT TRAPS")
print("=" * 70)
for u in users:
    t = db.bot_traps.find_one({"user_id": u["id"]})
    print(f"{u['username']}: {t}")

print("\n" + "=" * 70)
print("POINT TRANSFERS / GIFTS BETWEEN THEM (48h)")
print("=" * 70)
unames = [u["username"] for u in users]
for coll in ("point_transfers", "transfers", "gifts", "bank_transfers", "swiss_transfers"):
    try:
        n = db[coll].count_documents(
            {
                "created_at": {"$gte": SINCE_ISO},
                "$or": [
                    {"from_username": {"$in": unames}},
                    {"to_username": {"$in": unames}},
                    {"from_user_id": {"$in": uids}},
                    {"to_user_id": {"$in": uids}},
                ],
            }
        )
        if n:
            print(f"{coll}: {n}")
            for r in db[coll].find(
                {
                    "created_at": {"$gte": SINCE_ISO},
                    "$or": [
                        {"from_username": {"$in": unames}},
                        {"to_username": {"$in": unames}},
                        {"from_user_id": {"$in": uids}},
                        {"to_user_id": {"$in": uids}},
                    ],
                },
                {"_id": 0},
            ).limit(10):
                print(" ", r)
    except Exception:
        pass

print("\nDONE")
