from dotenv import load_dotenv
import os
from pprint import pprint
from collections import defaultdict
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

NAMES = ["Dup", "Xenon"]

def get_user(name):
    return db.users.find_one(
        {"username": {"$regex": f"^{name}$", "$options": "i"}},
        {"_id": 0},
    )

def collect_ips(u):
    ips = set()
    for k in ("registration_ip", "last_login_ip", "last_request_ip"):
        if u.get(k):
            ips.add(str(u[k]).strip())
    for x in (u.get("login_ips") or []):
        if x:
            ips.add(str(x).strip())
    for x in (u.get("known_ips") or []):
        if x:
            ips.add(str(x).strip())
    return {i for i in ips if i}

users = {}
print("=== ACCOUNTS ===")
for n in NAMES:
    u = get_user(n)
    if not u:
        print(f"NOT FOUND: {n}")
        continue
    users[u["username"]] = u
    print(f"\n{u.get('username')}")
    for k in (
        "id", "email", "is_dead", "is_banned", "points", "rank", "health",
        "created_at", "last_seen", "family_id", "family_name",
        "registration_ip", "last_login_ip", "last_request_ip", "login_ips",
        "last_seen_country", "total_kills",
    ):
        if k in u:
            print(f"  {k}: {u.get(k)}")

print("\n=== IP OVERLAP BETWEEN DUP / XENON ===")
ip_map = {name: collect_ips(u) for name, u in users.items()}
all_ips = set()
for s in ip_map.values():
    all_ips |= s
shared = []
for ip in sorted(all_ips):
    owners = [n for n, s in ip_map.items() if ip in s]
    if len(owners) > 1:
        shared.append((ip, owners))
        print(f"SHARED {ip}: {owners}")
    else:
        print(f"solo {ip}: {owners}")
if not shared:
    print("No shared exact IPs between Dup and Xenon.")

print("\n=== OTHER ACCOUNTS ON THEIR IPS ===")
for name, u in users.items():
    ips = collect_ips(u)
    print(f"\n-- {name} --")
    for ip in sorted(ips):
        hits = list(db.users.find(
            {"$or": [
                {"registration_ip": ip},
                {"last_login_ip": ip},
                {"last_request_ip": ip},
                {"login_ips": ip},
            ]},
            {"_id": 0, "username": 1, "email": 1, "is_dead": 1, "points": 1,
             "created_at": 1, "registration_ip": 1, "last_request_ip": 1},
        ).limit(40))
        print(f"  IP {ip} -> {len(hits)} account(s)")
        for h in hits:
            print(f"    {h.get('username'):20} dead={h.get('is_dead')} pts={h.get('points')} email={h.get('email')} created={h.get('created_at')}")

print("\n=== EMAIL LOCAL-PART / DOMAIN NEAR MATCHES ===")
for name, u in users.items():
    email = (u.get("email") or "").lower()
    local = email.split("@")[0] if "@" in email else ""
    # strip digits for soft match
    base = "".join(c for c in local if c.isalpha())
    print(f"\n{name} email={email} base={base}")
    if len(base) >= 4:
        for h in db.users.find(
            {"email": {"$regex": base[:6], "$options": "i"}},
            {"_id": 0, "username": 1, "email": 1, "is_dead": 1, "points": 1, "created_at": 1},
        ).limit(20):
            print(f"  near: {h}")

print("\n=== RECENT ATTACK CLIENT IPS (if any) ===")
for name, u in users.items():
    uid = u["id"]
    print(f"\n{name}")
    for d in db.attack_client_audit.find({"user_id": uid}, {"client_ip": 1, "created_at": 1, "target_username": 1}).sort("created_at", -1).limit(8):
        print(f"  {d.get('created_at')} {d.get('client_ip')} -> {d.get('target_username')}")
