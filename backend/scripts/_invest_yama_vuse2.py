"""Deeper Yama vs Vuse: shared IPs all-time, concurrent activity, BG replace, timing."""
from __future__ import annotations

import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

YAMA = "b71ceb68-54f9-44f4-8077-7380a38be072"
VUSE = "8da33080-23f3-410e-87df-d22c147409e9"
SINCE = datetime.now(timezone.utc) - timedelta(days=2)


def ips_from_attempts(uid, since=None, limit=5000):
    q = {"attacker_id": uid}
    if since is not None:
        q["created_at"] = {"$gte": since}
    ips = Counter()
    for row in db.attack_attempts.find(q, {"attacker_ip": 1, "ip": 1, "client_ip": 1, "meta": 1}).limit(limit):
        ip = row.get("attacker_ip") or row.get("ip") or row.get("client_ip")
        if not ip and isinstance(row.get("meta"), dict):
            ip = row["meta"].get("ip") or row["meta"].get("client_ip")
        if ip:
            ips[str(ip).strip()] += 1
    return ips


print("=== ALL-TIME ATTACK IPS (top 15 each) ===")
yi = ips_from_attempts(YAMA, since=None)
vi = ips_from_attempts(VUSE, since=None)
print("Yama:", yi.most_common(15))
print("Vuse:", vi.most_common(15))
shared = set(yi) & set(vi)
print("SHARED exact IPs:", shared or "NONE")

# /24 and IPv6 /64 rough
def v4_net(ip):
    parts = ip.split(".")
    if len(parts) == 4:
        return ".".join(parts[:3]) + ".0/24"
    return None


def v6_net(ip):
    if ":" in ip:
        return ":".join(ip.split(":")[:4]) + "::/64"
    return None


yn = {v4_net(i) or v6_net(i) for i in yi}
vn = {v4_net(i) or v6_net(i) for i in vi}
yn.discard(None)
vn.discard(None)
print("SHARED /24 or /64:", (yn & vn) or "NONE")

print("\n=== CONCURRENT MINUTES (both attacking same UTC minute, 48h) ===")
yama_mins = set()
vuse_mins = set()
for row in db.attack_attempts.find({"attacker_id": YAMA, "created_at": {"$gte": SINCE}}, {"created_at": 1}):
    t = row.get("created_at")
    if isinstance(t, datetime):
        yama_mins.add(t.replace(second=0, microsecond=0))
for row in db.attack_attempts.find({"attacker_id": VUSE, "created_at": {"$gte": SINCE}}, {"created_at": 1}):
    t = row.get("created_at")
    if isinstance(t, datetime):
        vuse_mins.add(t.replace(second=0, microsecond=0))
overlap = sorted(yama_mins & vuse_mins)
print(f"Yama active minutes={len(yama_mins)} Vuse={len(vuse_mins)} overlap={len(overlap)}")
for m in overlap[:20]:
    print(" ", m.isoformat())

print("\n=== SAMPLE TIMING GAPS VUSE (bot regularity) ===")
times = [
    r["created_at"]
    for r in db.attack_attempts.find({"attacker_id": VUSE, "created_at": {"$gte": SINCE}}, {"created_at": 1})
    .sort("created_at", -1)
    .limit(80)
]
times = [t for t in times if isinstance(t, datetime)]
times.sort()
gaps = []
for a, b in zip(times, times[1:]):
    gaps.append((b - a).total_seconds())
if gaps:
    gaps_sorted = sorted(gaps)
    print(f"n={len(gaps)} median={gaps_sorted[len(gaps_sorted)//2]:.2f}s "
          f"p10={gaps_sorted[max(0,len(gaps_sorted)//10)]:.2f}s "
          f"p90={gaps_sorted[min(len(gaps_sorted)-1, 9*len(gaps_sorted)//10)]:.2f}s "
          f"min={min(gaps):.2f}s max={max(gaps):.2f}s")
    # count sub-2s
    print(f"gaps <1s: {sum(1 for g in gaps if g < 1)} <2s: {sum(1 for g in gaps if g < 2)} <5s: {sum(1 for g in gaps if g < 5)}")

print("\n=== SAMPLE TIMING GAPS YAMA ===")
times = [
    r["created_at"]
    for r in db.attack_attempts.find({"attacker_id": YAMA, "created_at": {"$gte": SINCE}}, {"created_at": 1})
    .sort("created_at", -1)
    .limit(80)
]
times = [t for t in times if isinstance(t, datetime)]
times.sort()
gaps = [(b - a).total_seconds() for a, b in zip(times, times[1:])]
if gaps:
    gaps_sorted = sorted(gaps)
    print(f"n={len(gaps)} median={gaps_sorted[len(gaps_sorted)//2]:.2f}s min={min(gaps):.2f}s "
          f"<2s={sum(1 for g in gaps if g < 2)}")

print("\n=== BODYGUARD REPLACES / HIRES (48h) ===")
for uid, name in ((YAMA, "Yama"), (VUSE, "Vuse")):
    for coll in ("bodyguard_logs", "bodyguards", "bg_replacements", "activity_log"):
        try:
            if coll == "activity_log":
                q = {
                    "user_id": uid,
                    "created_at": {"$gte": SINCE.isoformat()},
                    "action": {"$regex": "bodyguard|bg_|replace", "$options": "i"},
                }
            else:
                q = {
                    "$or": [{"user_id": uid}, {"owner_id": uid}],
                    "created_at": {"$gte": SINCE},
                }
            n = db[coll].count_documents(q)
            if n:
                print(f"{name} {coll}: {n}")
        except Exception:
            pass

# bodyguard hire endpoints often log in attack_attempts or a bodyguards collection history
for name, uid in (("Yama", YAMA), ("Vuse", VUSE)):
    hired = list(
        db.bodyguards.find({"owner_id": uid}, {"_id": 0, "username": 1, "created_at": 1, "is_dead": 1, "slot": 1})
        .sort("created_at", -1)
        .limit(10)
    )
    print(f"{name} current/recent bodyguards docs: {len(hired)}")
    for h in hired[:5]:
        print(" ", h)

print("\n=== FAMILY / LINKED ===")
for uid, name in ((YAMA, "Yama"), (VUSE, "Vuse")):
    u = db.users.find_one({"id": uid}, {"_id": 0, "family_id": 1, "family_name": 1, "username": 1})
    print(name, u)

print("\n=== WHO THEY ATTACKED MOST (48h) ===")
for uid, name in ((YAMA, "Yama"), (VUSE, "Vuse")):
    c = Counter()
    for r in db.attack_attempts.find({"attacker_id": uid, "created_at": {"$gte": SINCE}}, {"target_username": 1}):
        c[r.get("target_username") or "?"] += 1
    print(name, c.most_common(10))

print("\n=== LAST_SEEN / PATH overlap ===")
for uid, name in ((YAMA, "Yama"), (VUSE, "Vuse")):
    u = db.users.find_one(
        {"id": uid},
        {"_id": 0, "last_seen": 1, "last_path": 1, "last_request_ip": 1, "last_seen_country": 1},
    )
    print(name, u)

# Check users sharing Vuse's IP
print("\n=== OTHER ACCOUNTS ON VUSE IP 80.3.110.208 ===")
ip = "80.3.110.208"
others = list(
    db.users.find(
        {
            "$or": [
                {"registration_ip": ip},
                {"last_login_ip": ip},
                {"last_request_ip": ip},
                {"known_ips": ip},
            ]
        },
        {"_id": 0, "username": 1, "id": 1, "is_dead": 1, "email": 1, "created_at": 1},
    ).limit(30)
)
for o in others:
    print(" ", o)

print("\n=== OTHER ACCOUNTS ON YAMA nets ===")
for ip in ("154.14.223.134", "154.14.219.134", "86.163.196.227"):
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
        ).limit(15)
    )
    print(ip, others)
