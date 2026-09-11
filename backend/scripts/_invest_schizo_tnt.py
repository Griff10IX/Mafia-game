"""Investigate Thor dupe report: Schizophrenic vs TNT."""
from __future__ import annotations

import os
import re
from collections import Counter
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

NAMES = ["Schizophrenic", "TNT", "tnt"]


def find_user(name):
    return db.users.find_one(
        {"username": {"$regex": f"^{re.escape(name)}$", "$options": "i"}},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "is_dead": 1,
            "is_banned": 1,
            "created_at": 1,
            "last_seen": 1,
            "registration_ip": 1,
            "last_login_ip": 1,
            "last_request_ip": 1,
            "known_ips": 1,
            "points": 1,
            "family_id": 1,
            "telegram_chat_id": 1,
        },
    )


def collect_ips(u):
    ips = set()
    for k in ("registration_ip", "last_login_ip", "last_request_ip"):
        if u.get(k):
            ips.add(str(u[k]).strip())
    for x in u.get("known_ips") or []:
        if x:
            ips.add(str(x).strip())
    return ips


print("=== ACCOUNTS ===")
users = []
seen = set()
for n in ["Schizophrenic", "TNT"]:
    u = find_user(n)
    if not u:
        # fuzzy
        fuzzy = list(
            db.users.find(
                {"username": {"$regex": re.escape(n), "$options": "i"}},
                {"_id": 0, "username": 1, "id": 1, "is_dead": 1},
            ).limit(10)
        )
        print(f"{n}: exact miss, fuzzy={fuzzy}")
        continue
    if u["id"] in seen:
        continue
    seen.add(u["id"])
    users.append(u)
    print(
        f"{u['username']} id={u['id']} dead={u.get('is_dead')} banned={u.get('is_banned')} "
        f"pts={u.get('points')} created={u.get('created_at')} last_seen={u.get('last_seen')}"
    )
    print(f"  email={u.get('email')}")
    print(f"  reg={u.get('registration_ip')} last_login={u.get('last_login_ip')} last_req={u.get('last_request_ip')}")
    print(f"  family={u.get('family_id')} tg={u.get('telegram_chat_id')}")

if len(users) < 2:
    # search TNT variants
    print("\n=== TNT-like usernames ===")
    for u in db.users.find(
        {"username": {"$regex": r"^tnt|tnt$", "$options": "i"}},
        {"_id": 0, "username": 1, "id": 1, "is_dead": 1, "email": 1, "registration_ip": 1},
    ).limit(20):
        print(u)

print("\n=== IP OVERLAP ===")
if len(users) >= 2:
    a, b = users[0], users[1]
    ia, ib = collect_ips(a), collect_ips(b)
    print(a["username"], ia)
    print(b["username"], ib)
    print("shared", ia & ib or "NONE")

# attack ips
print("\n=== ATTACK IPS ===")


def attack_ips(uid, limit=3000):
    c = Counter()
    for row in db.attack_attempts.find({"attacker_id": uid}, {"attacker_ip": 1, "ip": 1, "client_ip": 1, "meta": 1}).limit(limit):
        ip = row.get("attacker_ip") or row.get("ip") or row.get("client_ip")
        if not ip and isinstance(row.get("meta"), dict):
            ip = row["meta"].get("ip")
        if ip:
            c[str(ip)] += 1
    return c


if len(users) >= 2:
    ca = attack_ips(users[0]["id"])
    cb = attack_ips(users[1]["id"])
    print(users[0]["username"], ca.most_common(10))
    print(users[1]["username"], cb.most_common(10))
    print("shared attack ips", set(ca) & set(cb) or "NONE")

print("\n=== SAME EMAIL ===")
for u in users:
    em = u.get("email")
    if not em:
        continue
    same = list(db.users.find({"email": em}, {"_id": 0, "username": 1, "is_dead": 1, "id": 1}))
    print(em, [x["username"] for x in same])

print("\n=== POINT TRANSFERS involving Schizophrenic / TNT (all time sample) ===")
uids = [u["id"] for u in users]
unames = [u["username"] for u in users]
# also find who sent Thor 10k points context from report
thor = find_user("Thor")
if thor:
    print("Thor id", thor["id"])

for coll in ("point_transfers", "points_log", "transactions", "economy_log", "notifications"):
    try:
        n = db[coll].estimated_document_count()
        print(f"coll {coll} est={n}")
    except Exception:
        pass

# notifications about points
if thor:
    notes = list(
        db.notifications.find(
            {
                "user_id": thor["id"],
                "$or": [
                    {"body": {"$regex": "10000|10,000|points", "$options": "i"}},
                    {"message": {"$regex": "10000|10,000|points", "$options": "i"}},
                    {"title": {"$regex": "point", "$options": "i"}},
                ],
            },
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(15)
    )
    print(f"Thor point-ish notifications: {len(notes)}")
    for n in notes[:8]:
        print(" ", {k: n.get(k) for k in ("created_at", "title", "body", "message", "category", "from_username") if k in n or n.get(k)})

# admin investigate style: shared last_request across history in request logs?
print("\n=== USERS ON SCHIZO IPS ===")
if users:
    for ip in collect_ips(users[0]):
        others = list(
            db.users.find(
                {
                    "$or": [
                        {"registration_ip": ip},
                        {"last_login_ip": ip},
                        {"last_request_ip": ip},
                    ]
                },
                {"_id": 0, "username": 1, "is_dead": 1, "email": 1},
            ).limit(20)
        )
        print(ip, [(o["username"], o.get("is_dead")) for o in others])

if len(users) >= 2:
    print("\n=== USERS ON TNT IPS ===")
    for ip in collect_ips(users[1]):
        others = list(
            db.users.find(
                {
                    "$or": [
                        {"registration_ip": ip},
                        {"last_login_ip": ip},
                        {"last_request_ip": ip},
                    ]
                },
                {"_id": 0, "username": 1, "is_dead": 1},
            ).limit(20)
        )
        print(ip, [(o["username"], o.get("is_dead")) for o in others])

print("\n=== TELEGRAM / FAMILY LINK ===")
for u in users:
    print(u["username"], "tg", u.get("telegram_chat_id"), "fam", u.get("family_id"))

# dead accounts Thor mentioned receiving points
print("\n=== POINT LEDGER search ===")
for coll in db.list_collection_names():
    if "point" in coll.lower() or "transfer" in coll.lower() or "gift" in coll.lower():
        print(" ", coll)
