"""Expand top death-clusters to full account lists (alive + older dead)."""
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

dead_users = list(db.users.find(
    {"is_dead": True, "is_npc": {"$ne": True}, "dead_at": {"$gte": since_iso}},
    {
        "_id": 0, "id": 1, "username": 1, "dead_at": 1, "created_at": 1,
        "killed_by_username": 1,
        "registration_ip": 1, "last_login_ip": 1, "last_request_ip": 1,
        "login_ips": 1, "device_fingerprint": 1,
    },
))


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
    return out


# seeds: names from the big clusters
SEED_NAMES = [
    "OneTime", "OneShot", "Action", "TheHumber", "Ohdear", "dale", "xemon",
    "Notthistime", "Kolkata", "reven",
    "Omen", "TNT", "Oblivion", "Dread", "Negan", "Ambush",
    "RedJohn", "Pikachu", "Abyss", "Thor", "Hercules",
    "Chaos", "Bruno", "Schizophrenic",
    "Niez", "Almighty",
    "Zugzwang", "Piece",
    "Highlights", "Mong",
    "JezBentos", "Venus", "BadasDupe", "Lazarus", "Intermezzo", "Holyduck",
    "Thomie", "RayReddington", "Frankie",
]

seeds = list(db.users.find(
    {"username": {"$in": SEED_NAMES}, "is_npc": {"$ne": True}},
    {
        "_id": 0, "id": 1, "username": 1, "is_dead": 1, "dead_at": 1, "created_at": 1,
        "killed_by_username": 1, "rank": 1,
        "registration_ip": 1, "last_login_ip": 1, "last_request_ip": 1,
        "login_ips": 1, "device_fingerprint": 1,
    },
))
print("seeds found", [(u.get("username"), u.get("is_dead")) for u in seeds])

# For each seed, find linked accounts
seen_groups = []
used = set()
for seed in seeds:
    if seed["id"] in used:
        continue
    ips = ips_of(seed)
    fp = (seed.get("device_fingerprint") or "").strip()
    or_parts = []
    if fp:
        or_parts.append({"device_fingerprint": fp})
    if ips:
        or_parts.append({"registration_ip": {"$in": list(ips)}})
        or_parts.append({"last_login_ip": {"$in": list(ips)}})
        or_parts.append({"last_request_ip": {"$in": list(ips)}})
        or_parts.append({"login_ips": {"$in": list(ips)}})
    linked = [seed]
    if or_parts:
        extra = list(db.users.find(
            {"id": {"$ne": seed["id"]}, "is_npc": {"$ne": True}, "$or": or_parts},
            {
                "_id": 0, "id": 1, "username": 1, "is_dead": 1, "dead_at": 1,
                "created_at": 1, "killed_by_username": 1, "rank": 1,
                "device_fingerprint": 1, "registration_ip": 1, "last_login_ip": 1,
            },
        ))
        linked.extend(extra)
    for x in linked:
        used.add(x["id"])
    dead_month = []
    for x in linked:
        da = x.get("dead_at") or ""
        if x.get("is_dead") and str(da) >= since_iso:
            dead_month.append(x)
    seen_groups.append((seed.get("username"), linked, dead_month))

# Deduplicate groups that fully overlap
print("\n=== GROUPS ===")
printed = []
for name, linked, dead_month in sorted(seen_groups, key=lambda t: -len(t[2])):
    key = frozenset(x["id"] for x in linked)
    if any(key == p for p in printed):
        continue
    printed.append(key)
    alive = [x for x in linked if not x.get("is_dead")]
    dead = [x for x in linked if x.get("is_dead")]
    print(f"\nseed {name}  accounts={len(linked)} alive={len(alive)} dead={len(dead)} dead_this_month={len(dead_month)}")
    print("  ALIVE:", ", ".join(x.get("username") or "?" for x in alive) or "(none)")
    rows = sorted(linked, key=lambda x: str(x.get("created_at") or ""))
    for x in rows:
        flag = "DEAD" if x.get("is_dead") else "ALIVE"
        month = ""
        da = str(x.get("dead_at") or "")
        if x.get("is_dead") and da >= since_iso:
            month = " THIS_MONTH"
        print(
            f"    {flag:5} {x.get('username'):16} created={str(x.get('created_at') or '')[:10]}  "
            f"dead={str(x.get('dead_at') or '')[:10]}  by={x.get('killed_by_username') or '-'}{month}"
        )

print("\n=== killer ? dead this month ===")
for u in dead_users:
    if not u.get("killed_by_username"):
        print(u.get("username"), u.get("dead_at"), "created", str(u.get("created_at") or "")[:10])

print("\n=== staff modkill this month ===")
for u in dead_users:
    if "Staff" in str(u.get("killed_by_username") or ""):
        print(u.get("username"), u.get("dead_at"), "created", str(u.get("created_at") or "")[:10])
