"""Find successor accounts for Pikachu and Oblivion after they died."""
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

NAMES = ["Pikachu", "Oblivion", "Thor", "Abyss", "RedJohn", "Omen", "Dread", "TNT", "Ambush", "Negan"]


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


def dump_user(label, u):
    if not u:
        print(f"  {label}: MISSING")
        return
    print(
        f"  {label}: {u.get('username')}  dead={bool(u.get('is_dead'))}  "
        f"created={u.get('created_at')}  dead_at={u.get('dead_at')}  "
        f"killed_by={u.get('killed_by_username')}  last_login={u.get('last_login')}  "
        f"id={u.get('id')}  email={(u.get('email') or '')[:40]}  "
        f"fp={(u.get('device_fingerprint') or '')[:16]}"
    )


proj = {
    "_id": 0,
    "id": 1,
    "username": 1,
    "is_dead": 1,
    "created_at": 1,
    "dead_at": 1,
    "killed_by_username": 1,
    "last_login": 1,
    "last_seen": 1,
    "email": 1,
    "email_verified": 1,
    "registration_ip": 1,
    "last_login_ip": 1,
    "last_request_ip": 1,
    "login_ips": 1,
    "device_fingerprint": 1,
    "rank": 1,
}

for name in ("Pikachu", "Oblivion"):
    u = db.users.find_one({"username": {"$regex": f"^{name}$", "$options": "i"}, "is_npc": {"$ne": True}}, proj)
    print("\n====", name, "====")
    dump_user("self", u)
    if not u:
        continue
    ips = ips_of(u)
    fp = (u.get("device_fingerprint") or "").strip()
    email = (u.get("email") or "").strip()
    or_parts = []
    if fp:
        or_parts.append({"device_fingerprint": fp})
    if ips:
        or_parts.append({"registration_ip": {"$in": list(ips)}})
        or_parts.append({"last_login_ip": {"$in": list(ips)}})
        or_parts.append({"last_request_ip": {"$in": list(ips)}})
        or_parts.append({"login_ips": {"$in": list(ips)}})
    if email:
        or_parts.append({"email": email})
    linked = list(
        db.users.find(
            {"id": {"$ne": u["id"]}, "is_npc": {"$ne": True}, "$or": or_parts},
            proj,
        )
    ) if or_parts else []
    print(f"  ips={len(ips)} fp={'yes' if fp else 'no'} email={'yes' if email else 'no'} linked={len(linked)}")
    rows = sorted(linked, key=lambda x: str(x.get("created_at") or ""))
    dead_at = str(u.get("dead_at") or "")
    print("  after death (created >= dead_at):")
    later = [x for x in rows if str(x.get("created_at") or "") >= dead_at]
    if not later:
        print("    (none)")
    for x in later:
        dump_user("    new", x)
    print("  all linked:")
    for x in rows:
        dump_user("    ", x)
    # also: any account created after death sharing ONLY last_request later? already covered
    # users with same email different id
    if email:
        same_email = list(db.users.find({"email": email, "id": {"$ne": u["id"]}}, proj))
        print("  same email others:", [x.get("username") for x in same_email] or "(none)")

# Thor created same day Pikachu died — confirm last activity
print("\n==== alive possibles last activity ===")
for name in ("Thor", "Ambush", "Why", "OneShot", "Crosis"):
    u = db.users.find_one({"username": {"$regex": f"^{name}$", "$options": "i"}}, proj)
    dump_user(name, u)
