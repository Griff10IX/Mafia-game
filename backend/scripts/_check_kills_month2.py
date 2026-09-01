"""Broader death counts: dead_at last month + attack_attempts types + victim clusters."""
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

NOW = datetime.now(timezone.utc)
SINCE = NOW - timedelta(days=31)
since_iso = SINCE.isoformat()
print("window", since_iso)

print("attack_attempts total", db.attack_attempts.estimated_document_count())
print("outcome killed", db.attack_attempts.count_documents({"outcome": "killed"}))
print("killed npc", db.attack_attempts.count_documents({"outcome": "killed", "is_npc_kill": True}))
print("killed target_is_npc", db.attack_attempts.count_documents({"outcome": "killed", "target_is_npc": True}))
print("killed player-ish", db.attack_attempts.count_documents({
    "outcome": "killed",
    "is_npc_kill": {"$ne": True},
    "target_is_npc": {"$ne": True},
}))

# created_at type mix
pipe = [
    {"$match": {"outcome": "killed"}},
    {"$project": {"t": {"$type": "$created_at"}}},
    {"$group": {"_id": "$t", "n": {"$sum": 1}}},
]
print("created_at types", list(db.attack_attempts.aggregate(pipe)))

# newest / oldest killed
newest = db.attack_attempts.find({"outcome": "killed"}).sort("created_at", -1).limit(3)
print("newest killed:")
for d in newest:
    print(" ", d.get("created_at"), d.get("attacker_username"), "->", d.get("target_username"), "npc", d.get("is_npc_kill"), d.get("target_is_npc"))

oldest = db.attack_attempts.find({"outcome": "killed"}).sort("created_at", 1).limit(3)
print("oldest killed:")
for d in oldest:
    print(" ", d.get("created_at"), d.get("attacker_username"), "->", d.get("target_username"))

# dead users this month
dead_q_iso = {"is_dead": True, "is_npc": {"$ne": True}, "dead_at": {"$gte": since_iso}}
dead_q_dt = {"is_dead": True, "is_npc": {"$ne": True}, "dead_at": {"$gte": SINCE}}
print("dead_at iso count", db.users.count_documents(dead_q_iso))
print("dead_at dt count", db.users.count_documents(dead_q_dt))

sample_dead = db.users.find_one({"is_dead": True, "is_npc": {"$ne": True}, "dead_at": {"$exists": True}}, {"_id": 0, "username": 1, "dead_at": 1, "killed_by_username": 1})
print("sample dead", sample_dead)

# type of dead_at
pipe2 = [
    {"$match": {"is_dead": True, "is_npc": {"$ne": True}, "dead_at": {"$exists": True, "$ne": None, "$ne": ""}}},
    {"$project": {"t": {"$type": "$dead_at"}}},
    {"$group": {"_id": "$t", "n": {"$sum": 1}}},
]
print("dead_at types", list(db.users.aggregate(pipe2)))

dead_users = list(db.users.find(
    {"is_dead": True, "is_npc": {"$ne": True}, "dead_at": {"$gte": since_iso}},
    {
        "_id": 0, "id": 1, "username": 1, "dead_at": 1, "created_at": 1,
        "killed_by_username": 1, "killed_by_user_id": 1,
        "registration_ip": 1, "last_login_ip": 1, "last_request_ip": 1,
        "login_ips": 1, "device_fingerprint": 1, "rank": 1,
    },
))
print("dead this month (iso)", len(dead_users))

# if iso got 0, try scanning
if len(dead_users) < 5:
    more = []
    for u in db.users.find(
        {"is_dead": True, "is_npc": {"$ne": True}, "dead_at": {"$exists": True, "$ne": None, "$ne": ""}},
        {
            "_id": 0, "id": 1, "username": 1, "dead_at": 1, "created_at": 1,
            "killed_by_username": 1, "killed_by_user_id": 1,
            "registration_ip": 1, "last_login_ip": 1, "last_request_ip": 1,
            "login_ips": 1, "device_fingerprint": 1, "rank": 1,
        },
    ):
        da = u.get("dead_at")
        if isinstance(da, datetime):
            dt = da if da.tzinfo else da.replace(tzinfo=timezone.utc)
        else:
            try:
                dt = datetime.fromisoformat(str(da).replace("Z", "+00:00"))
            except Exception:
                continue
        if dt >= SINCE:
            more.append(u)
    dead_users = more
    print("dead this month (parsed)", len(dead_users))

print("\n=== currently dead this month by killer ===")
by_killer = defaultdict(int)
for u in dead_users:
    by_killer[u.get("killed_by_username") or "?"] += 1
for k, n in sorted(by_killer.items(), key=lambda x: -x[1])[:20]:
    print(f"  {n:4d}  {k}")


def ips_of(u):
    out = set()
    for k in ("registration_ip", "last_login_ip", "last_request_ip"):
        v = (u.get(k) or "").strip()
        if v:
            out.add(v)
    for x in u.get("login_ips") or []:
        if isinstance(x, str) and x.strip():
            out.add(x.strip())
        elif isinstance(x, dict):
            v = (x.get("ip") or "").strip()
            if v:
                out.add(v)
    return frozenset(out)


# Cluster dead this month by fingerprint then by IP
fp_groups = defaultdict(list)
ip_groups = defaultdict(list)
no_link = []
for u in dead_users:
    fp = (u.get("device_fingerprint") or "").strip()
    ips = ips_of(u)
    if fp:
        fp_groups[fp].append(u)
    elif ips:
        # use first ip as key later union
        ip_groups[next(iter(ips))].append(u)
    else:
        no_link.append(u)

print("\n=== dead-this-month fingerprint groups (2+) ===")
for fp, rows in sorted(fp_groups.items(), key=lambda x: -len(x[1])):
    if len(rows) < 2:
        continue
    names = ", ".join(f"{r.get('username')} (by {r.get('killed_by_username')})" for r in rows)
    print(f"  n={len(rows)}  {names}")

print("\n=== dead-this-month same registration/last IP groups among the dead list ===")
# union by any shared IP among dead_users
parent = {u["id"]: u["id"] for u in dead_users}


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[rb] = ra


ip_to_ids = defaultdict(list)
fp_to_ids = defaultdict(list)
for u in dead_users:
    for ip in ips_of(u):
        ip_to_ids[ip].append(u["id"])
    fp = (u.get("device_fingerprint") or "").strip()
    if fp:
        fp_to_ids[fp].append(u["id"])
for ids in list(ip_to_ids.values()) + list(fp_to_ids.values()):
    for i in ids[1:]:
        union(ids[0], i)

clusters = defaultdict(list)
for u in dead_users:
    clusters[find(u["id"])].append(u)

print("clusters of dead-this-month (size 2+):")
for _, rows in sorted(clusters.items(), key=lambda x: -len(x[1])):
    if len(rows) < 2:
        continue
    names = ", ".join(f"{r.get('username')}*" for r in rows)
    killers = sorted({r.get("killed_by_username") or "?" for r in rows})
    print(f"  n={len(rows)}  killed_by={killers}  {names}")

print("\nsingles", sum(1 for rows in clusters.values() if len(rows) == 1))
print("total dead this month", len(dead_users))
