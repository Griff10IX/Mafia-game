"""Investigate Highlights report: Vuse kill-page botting."""
from __future__ import annotations

import os
from collections import Counter
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

VUSE = "8da33080-23f3-410e-87df-d22c147409e9"
HIGHLIGHTS = None
h = db.users.find_one({"username": {"$regex": "^Highlights$", "$options": "i"}}, {"_id": 0, "id": 1, "username": 1})
HIGHLIGHTS = h["id"] if h else None
print("Highlights", h)

SINCE = datetime.now(timezone.utc) - timedelta(days=3)
DAY = datetime.now(timezone.utc) - timedelta(hours=36)

u = db.users.find_one(
    {"id": VUSE},
    {"_id": 0, "username": 1, "created_at": 1, "last_seen": 1, "last_path": 1, "last_request_ip": 1, "is_dead": 1, "points": 1},
)
print("Vuse", u)

print("\n=== ATTACK ATTEMPTS ===")
for label, since in (("36h", DAY), ("3d", SINCE)):
    n = db.attack_attempts.count_documents({"attacker_id": VUSE, "created_at": {"$gte": since}})
    outcomes = Counter()
    targets = Counter()
    for r in db.attack_attempts.find({"attacker_id": VUSE, "created_at": {"$gte": since}}, {"outcome": 1, "target_username": 1}):
        outcomes[r.get("outcome") or "?"] += 1
        targets[r.get("target_username") or "?"] += 1
    print(f"{label}: n={n} outcomes={dict(outcomes)}")
    print(f"  top targets: {targets.most_common(8)}")

print("\n=== TIMING (last 120 attempts) ===")
times = [
    r["created_at"]
    for r in db.attack_attempts.find({"attacker_id": VUSE}, {"created_at": 1}).sort("created_at", -1).limit(120)
]
times = sorted(t for t in times if isinstance(t, datetime))
gaps = [(b - a).total_seconds() for a, b in zip(times, times[1:])]
if gaps:
    gs = sorted(gaps)
    print(
        f"n={len(gaps)} median={gs[len(gs)//2]:.2f}s min={min(gaps):.2f}s "
        f"<0.5s={sum(1 for g in gaps if g < 0.5)} <1s={sum(1 for g in gaps if g < 1)} "
        f"<2s={sum(1 for g in gaps if g < 2)} <5s={sum(1 for g in gaps if g < 5)}"
    )

print("\n=== VS HIGHLIGHTS specifically ===")
if HIGHLIGHTS:
    n = db.attack_attempts.count_documents(
        {"attacker_id": VUSE, "target_username": {"$regex": "^Highlights$", "$options": "i"}, "created_at": {"$gte": SINCE}}
    )
    print(f"attempts on Highlights (3d): {n}")
    rows = list(
        db.attack_attempts.find(
            {"attacker_id": VUSE, "target_username": {"$regex": "^Highlights$", "$options": "i"}, "created_at": {"$gte": SINCE}},
            {"_id": 0, "created_at": 1, "outcome": 1, "attacker_ip": 1},
        )
        .sort("created_at", -1)
        .limit(15)
    )
    for r in rows:
        print(" ", r)

print("\n=== BURST: max attempts in any 60s window (sample last 500) ===")
times = [
    r["created_at"]
    for r in db.attack_attempts.find({"attacker_id": VUSE}, {"created_at": 1}).sort("created_at", -1).limit(500)
]
times = sorted(t for t in times if isinstance(t, datetime))
best = 0
best_t = None
j = 0
for i, t in enumerate(times):
    while j < len(times) and (times[j] - t).total_seconds() <= 60:
        j += 1
    w = j - i
    if w > best:
        best = w
        best_t = t
print(f"max in 60s: {best} starting {best_t}")

print("\n=== IPS ===")
ips = Counter()
for r in db.attack_attempts.find({"attacker_id": VUSE, "created_at": {"$gte": SINCE}}, {"attacker_ip": 1}):
    if r.get("attacker_ip"):
        ips[r["attacker_ip"]] += 1
print(ips.most_common(5))

print("\n=== JOURNAL hint: request rate (optional skip) ===")
print("bot_trap:", db.bot_traps.find_one({"user_id": VUSE}))
