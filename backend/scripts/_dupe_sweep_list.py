"""Dupe sweep: list suspected linked accounts with proof. Does NOT modkill."""
import os
import re
import sys
from collections import defaultdict, Counter
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
sys.path.insert(0, "/opt/mafia-app/backend")

db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

ADMIN = {e.strip().lower() for e in (os.environ.get("ADMIN_EMAILS") or "").split(",") if e.strip()}
MOD = {e.strip().lower() for e in (os.environ.get("MOD_EMAILS") or os.environ.get("MODERATOR_EMAILS") or "").split(",") if e.strip()}
EXEMPT = {e.strip().lower() for e in (os.environ.get("DUPE_DETECTION_EXEMPT_EMAILS") or "").split(",") if e.strip()}
STAFF_NAMES = {"ghostface", "scoop", "system ai"}

COMMON_DOMAINS = {
    "gmail.com", "googlemail.com", "icloud.com", "me.com", "outlook.com", "hotmail.com",
    "hotmail.co.uk", "live.com", "yahoo.com", "yahoo.co.uk", "protonmail.com", "proton.me",
}

MAX_IP_CLUSTER = 6
MAX_FP_CLUSTER = 6


def _email(u):
    return (u.get("email") or "").strip().lower()


def skip_user(u):
    em = _email(u)
    name = (u.get("username") or "").strip().lower()
    if name in STAFF_NAMES:
        return True
    if em and (em in ADMIN or em in MOD or em in EXEMPT):
        return True
    if u.get("is_moderator"):
        return True
    if u.get("is_npc") or u.get("is_bodyguard"):
        return True
    if (u.get("id") or "") == "system_ai":
        return True
    return False


def collect_ips(u):
    ips = set()
    for k in ("registration_ip", "last_login_ip", "last_request_ip"):
        v = (u.get(k) or "").strip()
        if v:
            ips.add(v)
    for x in u.get("login_ips") or []:
        v = (x or "").strip() if not isinstance(x, dict) else (x.get("ip") or "").strip()
        if v:
            ips.add(v)
    return ips


def ip_roles(u, ip):
    roles = []
    if (u.get("registration_ip") or "").strip() == ip:
        roles.append("registration")
    if (u.get("last_login_ip") or "").strip() == ip:
        roles.append("last_login")
    if (u.get("last_request_ip") or "").strip() == ip:
        roles.append("last_request")
    logins = []
    for x in u.get("login_ips") or []:
        v = (x or "").strip() if not isinstance(x, dict) else (x.get("ip") or "").strip()
        if v:
            logins.append(v)
    if ip in logins:
        roles.append("login_history")
    return roles


proj = {
    "_id": 0,
    "id": 1,
    "username": 1,
    "email": 1,
    "is_dead": 1,
    "is_npc": 1,
    "is_bodyguard": 1,
    "is_moderator": 1,
    "created_at": 1,
    "last_seen": 1,
    "registration_ip": 1,
    "last_login_ip": 1,
    "last_request_ip": 1,
    "login_ips": 1,
    "device_fingerprint": 1,
    "rank_points": 1,
    "referred_by": 1,
}

users = list(
    db.users.find(
        {"is_npc": {"$ne": True}, "id": {"$exists": True, "$nin": ["", None, "system_ai"]}},
        proj,
    )
)
users = [u for u in users if u.get("id") and not skip_user(u)]
alive = [u for u in users if not u.get("is_dead")]
print("users_scanned", len(users), "alive", len(alive))

by_id = {u["id"]: u for u in users}

# --- fingerprint ---
fp_map = defaultdict(list)
for u in users:
    fp = (u.get("device_fingerprint") or "").strip()
    if len(fp) < 8:
        continue
    fp_map[fp].append(u)

# --- IPs ---
ip_map = defaultdict(list)
for u in users:
    for ip in collect_ips(u):
        ip_map[ip].append(u)

# --- similar email ---
email_map = defaultdict(list)
for u in users:
    em = _email(u)
    if "@" not in em:
        continue
    local, domain = em.rsplit("@", 1)
    base = re.sub(r"\d+", "", local.split("+")[0]) or local
    email_map[(base, domain)].append(u)

parent = {}


def find(x):
    parent.setdefault(x, x)
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[rb] = ra


def add_group(rows):
    ids = [u["id"] for u in rows if u.get("id")]
    if len(set(ids)) < 2:
        return
    first = ids[0]
    for b in ids[1:]:
        union(first, b)


# Strong links only — do not chain every 2-account shared IP (family + CGNAT).
for fp, rows in fp_map.items():
    uniq = {u["id"]: u for u in rows}
    if 2 <= len(uniq) <= MAX_FP_CLUSTER:
        add_group(list(uniq.values()))

for ip, rows in ip_map.items():
    uniq = {u["id"]: u for u in rows}
    alive_n = len([u for u in uniq.values() if not u.get("is_dead")])
    if alive_n > MAX_IP_CLUSTER:
        continue
    if alive_n >= 3 or (alive_n >= 1 and len(uniq) >= 3):
        add_group(list(uniq.values()))
    elif alive_n == 2 or (alive_n == 1 and len(uniq) >= 2):
        # same-day registration on this IP = extra signal, safe to union
        days = defaultdict(list)
        for u in uniq.values():
            days[str(u.get("created_at") or "")[:10]].append(u)
        for accs in days.values():
            if len({a["id"] for a in accs}) >= 2:
                add_group(accs)

for (base, domain), rows in email_map.items():
    uniq = {u["id"]: u for u in rows}
    if len(uniq) < 2:
        continue
    if domain not in COMMON_DOMAINS:
        if len(uniq) <= 6:
            add_group(list(uniq.values()))
    elif 2 <= len(uniq) <= 4 and len(base) >= 4:
        add_group(list(uniq.values()))

since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

# IP-2 pairs with money moving between them (family-2 is allowed; transfers are extra proof)
ip2_ids = set()
for ip, rows in ip_map.items():
    uniq = {u["id"]: u for u in rows}
    alive_n = len([u for u in uniq.values() if not u.get("is_dead")])
    if alive_n == 2 and len(uniq) <= MAX_IP_CLUSTER:
        ip2_ids.update(uniq.keys())

if ip2_ids:
    for t in db.money_transfers.find(
        {
            "created_at": {"$gte": since},
            "from_user_id": {"$in": list(ip2_ids)},
            "to_user_id": {"$in": list(ip2_ids)},
        },
        {"_id": 0, "from_user_id": 1, "to_user_id": 1},
    ):
        a, b = t.get("from_user_id"), t.get("to_user_id")
        if a and b and a != b and a in by_id and b in by_id:
            union(a, b)

# Build clusters
clusters = defaultdict(list)
for uid in list(parent):
    clusters[find(uid)].append(uid)


def cluster_report(uids):
    rows = [by_id[i] for i in uids if i in by_id]
    alive_rows = [u for u in rows if not u.get("is_dead")]
    if len(alive_rows) < 2:
        # one alive + dead alt still interesting
        if not (len(alive_rows) == 1 and len(rows) >= 2):
            return None
    fps = Counter((u.get("device_fingerprint") or "").strip() for u in rows if len((u.get("device_fingerprint") or "").strip()) >= 8)
    shared_fps = [fp for fp, c in fps.items() if c >= 2]
    ip_hits = defaultdict(list)
    for u in rows:
        for ip in collect_ips(u):
            ip_hits[ip].append(u["id"])
    shared_ips = {ip: list(dict.fromkeys(ids)) for ip, ids in ip_hits.items() if len(set(ids)) >= 2}
    # drop mega-shared IPs from proof unless fingerprint also shared
    shared_ips_kept = {}
    for ip, ids in shared_ips.items():
        total_alive_on_ip = len({u["id"] for u in ip_map[ip] if not u.get("is_dead")})
        if total_alive_on_ip > MAX_IP_CLUSTER and not shared_fps:
            continue
        shared_ips_kept[ip] = ids

    similar_emails = []
    em_groups = defaultdict(list)
    for u in rows:
        em = _email(u)
        if "@" not in em:
            continue
        local, domain = em.rsplit("@", 1)
        base = re.sub(r"\d+", "", local.split("+")[0]) or local
        em_groups[(base, domain)].append(u)
    for (base, domain), accs in em_groups.items():
        if len({a["id"] for a in accs}) >= 2:
            similar_emails.append((base, domain, [(a.get("username"), _email(a)) for a in accs]))

    same_email = defaultdict(list)
    for u in rows:
        em = _email(u)
        if em:
            same_email[em].append(u.get("username"))
    exact_emails = {e: n for e, n in same_email.items() if len(n) >= 2}

    ids = [u["id"] for u in rows]
    xfers = list(
        db.money_transfers.find(
            {
                "created_at": {"$gte": since},
                "from_user_id": {"$in": ids},
                "to_user_id": {"$in": ids},
            },
            {"_id": 0, "from_username": 1, "to_username": 1, "amount": 1, "created_at": 1},
        ).limit(40)
    )

    evidence = []
    if shared_fps:
        evidence.append("shared_device_fingerprint")
    if exact_emails:
        evidence.append("same_email")
    if similar_emails:
        evidence.append("similar_email")
    if any(len(v) >= 3 for v in shared_ips_kept.values()):
        evidence.append("same_ip_3plus")
    elif shared_ips_kept:
        evidence.append("same_ip")
    if xfers:
        evidence.append("money_transfers")

    # same-day registration on shared IP
    from datetime import datetime as dt

    def day(u):
        c = u.get("created_at") or ""
        return str(c)[:10]

    for ip, ids in shared_ips_kept.items():
        days = defaultdict(list)
        for uid in ids:
            u = by_id.get(uid)
            if u:
                days[day(u)].append(u.get("username"))
        for d, names in days.items():
            if d and len(names) >= 2:
                evidence.append("same_day_reg_ip")
                break

    # Drop weak: only 2 alive, only same_ip, no fp/email/transfers (allowed family)
    ev = set(evidence)
    if ev <= {"same_ip"} and len(alive_rows) == 2 and not shared_fps:
        return None
    if not ev:
        return None

    if shared_fps or exact_emails or ("same_ip_3plus" in ev and similar_emails) or (shared_fps and shared_ips_kept):
        conf = "HIGH"
    elif "same_ip_3plus" in ev or ("same_ip" in ev and ("similar_email" in ev or "money_transfers" in ev or "same_day_reg_ip" in ev)):
        conf = "MEDIUM"
    elif "similar_email" in ev and not shared_ips_kept and not shared_fps:
        conf = "LOW"
        return None  # similar email alone on gmail is too noisy unless we already filtered
    else:
        conf = "MEDIUM"

    return {
        "conf": conf,
        "evidence": sorted(set(evidence)),
        "rows": rows,
        "shared_fps": shared_fps,
        "shared_ips": shared_ips_kept,
        "similar_emails": similar_emails,
        "exact_emails": exact_emails,
        "xfers": xfers,
    }


reports = []
seen = set()
for root, uids in clusters.items():
    key = tuple(sorted(set(uids)))
    if key in seen:
        continue
    seen.add(key)
    r = cluster_report(list(key))
    if r:
        reports.append(r)

reports.sort(key=lambda r: ({"HIGH": 0, "MEDIUM": 1, "LOW": 2}[r["conf"]], -len(r["rows"])))

print("CLUSTERS", len(reports), "HIGH", sum(1 for r in reports if r["conf"] == "HIGH"), "MEDIUM", sum(1 for r in reports if r["conf"] == "MEDIUM"))
print("=" * 72)

for i, r in enumerate(reports, 1):
    print(f"\n### {i}. {r['conf']}  evidence={','.join(r['evidence'])}")
    for u in sorted(r["rows"], key=lambda x: (bool(x.get("is_dead")), (x.get("username") or "").lower())):
        st = "DEAD" if u.get("is_dead") else "ALIVE"
        print(
            f"  - {u.get('username')}  [{st}]  id={u.get('id')}  created={str(u.get('created_at') or '')[:19]}  "
            f"last_seen={str(u.get('last_seen') or '')[:19]}  email={_email(u)}"
        )
    if r["shared_fps"]:
        for fp in r["shared_fps"]:
            print(f"  PROOF fingerprint: {fp[:48]}...")
    for ip, ids in r["shared_ips"].items():
        bits = []
        for uid in ids:
            u = by_id[uid]
            bits.append(f"{u.get('username')}({','.join(ip_roles(u, ip)) or '?'})")
        print(f"  PROOF IP {ip}: " + "; ".join(bits))
    for e, names in r["exact_emails"].items():
        print(f"  PROOF same email {e}: {names}")
    for base, domain, accs in r["similar_emails"]:
        print(f"  PROOF similar email {base}*@{domain}: {accs}")
    if r["xfers"]:
        print(f"  PROOF money_transfers last 30d: {len(r['xfers'])}")
        for t in r["xfers"][:8]:
            print(f"     {t.get('from_username')} -> {t.get('to_username')}  {t.get('amount')}  {str(t.get('created_at') or '')[:19]}")
print("\ndone_no_modkill")
