"""Dupe pairs only. Sequential death->new account (or two alive). Does NOT modkill."""
import os
from collections import defaultdict
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

ADMIN = {e.strip().lower() for e in (os.environ.get("ADMIN_EMAILS") or "").split(",") if e.strip()}
MOD = {e.strip().lower() for e in (os.environ.get("MOD_EMAILS") or os.environ.get("MODERATOR_EMAILS") or "").split(",") if e.strip()}
EXEMPT = {e.strip().lower() for e in (os.environ.get("DUPE_DETECTION_EXEMPT_EMAILS") or "").split(",") if e.strip()}
STAFF_NAMES = {"ghostface", "scoop", "system ai"}
MAX_IP = 12  # serial chains can be bigger than 6
GAP_SEC = 15 * 60


def _email(u):
    return (u.get("email") or "").strip().lower()


def skip_user(u):
    em = _email(u)
    name = (u.get("username") or "").strip().lower()
    if name in STAFF_NAMES:
        return True
    if em and (em in ADMIN or em in MOD or em in EXEMPT):
        return True
    if u.get("is_moderator") or u.get("is_npc") or u.get("is_bodyguard"):
        return True
    if (u.get("id") or "") == "system_ai":
        return True
    return False


def parse_dt(raw):
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def collect_ips(u):
    ips = set()
    for k in ("registration_ip", "last_login_ip", "last_request_ip"):
        v = (u.get(k) or "").strip()
        if v and v not in ("127.0.0.1", "::1", "unknown", "0.0.0.0"):
            ips.add(v)
    for x in u.get("login_ips") or []:
        v = (x or "").strip() if not isinstance(x, dict) else (x.get("ip") or "").strip()
        if v and v not in ("127.0.0.1", "::1", "unknown", "0.0.0.0"):
            ips.add(v)
    return ips


proj = {
    "_id": 0, "id": 1, "username": 1, "email": 1, "is_dead": 1, "is_npc": 1,
    "is_bodyguard": 1, "is_moderator": 1, "created_at": 1, "last_seen": 1,
    "registration_ip": 1, "last_login_ip": 1, "last_request_ip": 1, "login_ips": 1,
}
users = [
    u for u in db.users.find({"is_npc": {"$ne": True}, "id": {"$exists": True, "$nin": ["", None, "system_ai"]}}, proj)
    if u.get("id") and not skip_user(u)
]

ip_map = defaultdict(list)
for u in users:
    for ip in collect_ips(u):
        ip_map[ip].append(u)

seen_pairs = set()
pairs = []

for ip, rows in ip_map.items():
    uniq = {u["id"]: u for u in rows}
    if len(uniq) < 2 or len(uniq) > MAX_IP:
        continue
    accs = list(uniq.values())
    for i, a in enumerate(accs):
        a_seen = parse_dt(a.get("last_seen"))
        a_created = parse_dt(a.get("created_at"))
        for b in accs[i + 1 :]:
            b_seen = parse_dt(b.get("last_seen"))
            b_created = parse_dt(b.get("created_at"))
            if not a_created or not b_created:
                continue
            # sequential: older last_seen close to newer created
            cand = None
            if a_seen and b_created and a_created <= b_created:
                gap = (b_created - a_seen).total_seconds()
                if 0 <= gap <= GAP_SEC:
                    cand = (a, b, gap, "sequential")
            if b_seen and a_created and b_created <= a_created:
                gap = (a_created - b_seen).total_seconds()
                if 0 <= gap <= GAP_SEC:
                    cand = (b, a, gap, "sequential")
            # both alive, same registration IP
            a_reg = (a.get("registration_ip") or "").strip()
            b_reg = (b.get("registration_ip") or "").strip()
            if (
                not a.get("is_dead")
                and not b.get("is_dead")
                and a_reg
                and a_reg == b_reg == ip
            ):
                key = tuple(sorted([a["id"], b["id"]]))
                if key not in seen_pairs:
                    seen_pairs.add(key)
                    pairs.append(
                        {
                            "kind": "both_alive_same_reg_ip",
                            "a": a,
                            "b": b,
                            "gap": None,
                            "ip": ip,
                        }
                    )
                continue
            if not cand:
                continue
            old, new, gap, kind = cand
            key = tuple(sorted([old["id"], new["id"]]))
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            pairs.append({"kind": kind, "a": old, "b": new, "gap": gap, "ip": ip})


def uname(u):
    st = "DEAD" if u.get("is_dead") else "ALIVE"
    return f"{u.get('username')} [{st}]"


pairs.sort(key=lambda p: (p["kind"] != "sequential", p["gap"] if p["gap"] is not None else 99999, (p["a"].get("username") or "").lower()))

print("PAIR_COUNT", len(pairs))
print("=" * 72)
for i, p in enumerate(pairs, 1):
    a, b = p["a"], p["b"]
    if p["kind"] == "sequential":
        gap = int(p["gap"])
        print(f"{i}. {uname(a)}  ->  {uname(b)}")
        print(f"     gap {gap}s  shared IP {p['ip']}")
        print(f"     {a.get('username')} last_seen {str(a.get('last_seen') or '')[:19]}")
        print(f"     {b.get('username')} created   {str(b.get('created_at') or '')[:19]}")
    else:
        print(f"{i}. {uname(a)}  <->  {uname(b)}")
        print(f"     both alive, same registration IP {p['ip']}")
print("done_no_modkill")
