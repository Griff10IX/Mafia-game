"""Past-month player kills: top victims, top killers, linked-account clusters."""
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
print("window", since_iso, "->", NOW.isoformat())

player_kill = {
    "outcome": "killed",
    "is_npc_kill": {"$ne": True},
    "target_is_npc": {"$ne": True},
    "$or": [
        {"created_at": {"$gte": SINCE}},
        {"created_at": {"$gte": since_iso}},
    ],
}

total = db.attack_attempts.count_documents(player_kill)
print("player kills in window", total)

sample = db.attack_attempts.find_one(player_kill, {"_id": 0})
if sample:
    print("sample keys", sorted(sample.keys()))
    print(
        "sample",
        {
            k: sample.get(k)
            for k in (
                "attacker_id",
                "attacker_username",
                "target_id",
                "target_username",
                "created_at",
                "is_bodyguard_kill",
                "is_npc_kill",
                "target_is_npc",
                "make_public",
            )
        },
    )

proj = {
    "_id": 0,
    "attacker_id": 1,
    "attacker_username": 1,
    "target_id": 1,
    "target_username": 1,
    "created_at": 1,
    "is_bodyguard_kill": 1,
}

docs = list(db.attack_attempts.find(player_kill, proj))
print("loaded", len(docs))


def as_dt(v):
    if isinstance(v, datetime):
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v
    s = str(v or "")
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


# Filter strictly to window in case mixed types leaked extras
kills = []
for d in docs:
    dt = as_dt(d.get("created_at"))
    if not dt or dt < SINCE:
        continue
    kills.append(d)
print("in window after parse", len(kills))

victim_deaths = defaultdict(int)
victim_bg = defaultdict(int)
victim_name = {}
killer_kills = defaultdict(int)
killer_name = {}
killer_unique_victims = defaultdict(set)
pair = defaultdict(int)

for d in kills:
    tid = d.get("target_id") or ""
    aid = d.get("attacker_id") or ""
    tname = d.get("target_username") or "?"
    aname = d.get("attacker_username") or "?"
    victim_name[tid] = tname
    killer_name[aid] = aname
    victim_deaths[tid] += 1
    if d.get("is_bodyguard_kill"):
        victim_bg[tid] += 1
    killer_kills[aid] += 1
    killer_unique_victims[aid].add(tid)
    pair[(aname, tname)] += 1

print("\n=== TOP VICTIMS (deaths this month) ===")
top_victims = sorted(victim_deaths.items(), key=lambda x: -x[1])[:25]
for tid, n in top_victims:
    print(f"  {n:4d}  {victim_name.get(tid)}  id={tid}  bg_deaths={victim_bg.get(tid, 0)}")

print("\n=== TOP KILLERS (kills this month) ===")
top_killers = sorted(killer_kills.items(), key=lambda x: -x[1])[:25]
for aid, n in top_killers:
    print(
        f"  {n:4d}  {killer_name.get(aid)}  unique_victims={len(killer_unique_victims[aid])}  id={aid}"
    )

print("\n=== TOP KILLER->VICTIM PAIRS ===")
for (a, t), n in sorted(pair.items(), key=lambda x: -x[1])[:20]:
    print(f"  {n:4d}  {a} -> {t}")

# Linked accounts for top victims + top killers
ids = [tid for tid, _ in top_victims[:15]] + [aid for aid, _ in top_killers[:15]]
ids = list(dict.fromkeys(ids))
users = list(
    db.users.find(
        {"id": {"$in": ids}},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "is_dead": 1,
            "created_at": 1,
            "dead_at": 1,
            "registration_ip": 1,
            "last_login_ip": 1,
            "last_request_ip": 1,
            "login_ips": 1,
            "device_fingerprint": 1,
            "email": 1,
            "rank": 1,
            "prestige": 1,
            "is_npc": 1,
        },
    )
)
by_id = {u["id"]: u for u in users}


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


print("\n=== LINKED ACCOUNTS (fingerprint / shared IP) for top 15 victims + top 15 killers ===")
for uid in ids:
    u = by_id.get(uid)
    if not u:
        print(f"\nMISSING USER {uid} name={victim_name.get(uid) or killer_name.get(uid)}")
        continue
    role = []
    if uid in victim_deaths:
        role.append(f"deaths={victim_deaths[uid]}")
    if uid in killer_kills:
        role.append(f"kills={killer_kills[uid]}")
    fp = (u.get("device_fingerprint") or "").strip()
    ips = ips_of(u)
    q = [{"id": {"$ne": uid}, "is_npc": {"$ne": True}}]
    or_parts = []
    if fp:
        or_parts.append({"device_fingerprint": fp})
    if ips:
        or_parts.append({"registration_ip": {"$in": list(ips)}})
        or_parts.append({"last_login_ip": {"$in": list(ips)}})
        or_parts.append({"last_request_ip": {"$in": list(ips)}})
        or_parts.append({"login_ips": {"$in": list(ips)}})
    linked = []
    if or_parts:
        linked = list(
            db.users.find(
                {"id": {"$ne": uid}, "is_npc": {"$ne": True}, "$or": or_parts},
                {
                    "_id": 0,
                    "id": 1,
                    "username": 1,
                    "is_dead": 1,
                    "created_at": 1,
                    "device_fingerprint": 1,
                    "registration_ip": 1,
                    "last_login_ip": 1,
                },
            ).limit(80)
        )
    same_fp = 0
    if fp:
        same_fp = sum(1 for x in linked if (x.get("device_fingerprint") or "").strip() == fp)
    dead_n = sum(1 for x in linked if x.get("is_dead"))
    alive_n = sum(1 for x in linked if not x.get("is_dead"))
    names = ", ".join(
        f"{x.get('username')}{'*' if x.get('is_dead') else ''}" for x in linked[:25]
    )
    extra = "" if len(linked) <= 25 else f" ...+{len(linked)-25}"
    print(
        f"\n{u.get('username')}  {' '.join(role)}  self_dead={bool(u.get('is_dead'))}  "
        f"created={u.get('created_at')}  prestige={u.get('prestige')}  rank={u.get('rank')}"
    )
    print(
        f"  linked={len(linked)} (alive={alive_n} dead={dead_n} same_fp={same_fp} ips={len(ips)})"
    )
    if names:
        print(f"  {names}{extra}")
