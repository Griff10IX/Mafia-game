"""Deeper link check for mohair-nugget5c@icloud.com / Yama."""
import os
import re
from collections import Counter

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

EMAIL = "mohair-nugget5c@icloud.com"
yama = db.users.find_one({"email": {"$regex": f"^{re.escape(EMAIL)}$", "$options": "i"}})
print("YAMA keys sample:", sorted([k for k in (yama or {}) if "ip" in k.lower() or "email" in k.lower() or "finger" in k.lower() or "device" in k.lower() or "cf_" in k.lower()]))

uid = yama["id"]
# full identity fields
proj = {k: 1 for k in yama if any(x in k.lower() for x in ("ip", "email", "finger", "device", "agent", "cf_", "dead_password", "prev"))}
proj["_id"] = 0
proj.update({"id": 1, "username": 1, "is_dead": 1, "created_at": 1, "last_seen": 1})
print("yama identity:", {k: yama.get(k) for k in sorted(proj) if k != "_id"})

# How Magicland matched
magic = db.users.find_one({"username": "Magicland"}, {"_id": 0})
print("\nMagicland ip fields:")
for k, v in sorted((magic or {}).items()):
    if "ip" in k.lower() or "email" in k.lower():
        print(f"  {k}={v}")

# Any user who ever had this email (dead rename pattern)
dead_email_hits = list(
    db.users.find(
        {"$or": [
            {"email": {"$regex": "mohair-nugget5c", "$options": "i"}},
            {"original_email": {"$regex": "mohair-nugget5c", "$options": "i"}},
            {"previous_emails": {"$regex": "mohair-nugget5c", "$options": "i"}},
            {"email_before_death": {"$regex": "mohair-nugget5c", "$options": "i"}},
        ]},
        {"_id": 0, "id": 1, "username": 1, "email": 1, "is_dead": 1, "created_at": 1},
    )
)
print("\nemail string hits:", dead_email_hits)

# preregistrations
pre = list(db.preregistrations.find({"email": {"$regex": "mohair-nugget5c", "$options": "i"}}, {"_id": 0}))
print("prereg:", pre)

# Check last_request_ip / registration and expand
ips = set()
for k in ("registration_ip", "last_request_ip", "last_ip", "signup_ip", "ip"):
    v = yama.get(k)
    if v:
        ips.add(str(v).strip())

# login attempts collection
for coll in db.list_collection_names():
    if "login" in coll.lower() or "session" in coll.lower() or "request_ip" in coll.lower():
        print("coll:", coll)

# Find users with same last_request_ip as Yama
lrip = yama.get("last_request_ip") or yama.get("last_ip")
rip = yama.get("registration_ip")
print(f"\nYama registration_ip={rip} last_request_ip={yama.get('last_request_ip')}")

for label, ip in [("reg", rip), ("last", yama.get("last_request_ip"))]:
    if not ip:
        continue
    same = list(
        db.users.find(
            {"$or": [
                {"registration_ip": ip},
                {"last_request_ip": ip},
                {"last_ip": ip},
            ]},
            {"_id": 0, "username": 1, "email": 1, "id": 1, "is_dead": 1, "is_banned": 1,
             "registration_ip": 1, "last_request_ip": 1, "created_at": 1, "last_seen": 1, "family_id": 1},
        )
    )
    print(f"\n=== same {label} IP {ip}: {len(same)} ===")
    for u in same:
        print(f"  {u.get('username'):20} dead={u.get('is_dead')} ban={u.get('is_banned')} email={u.get('email')} reg={u.get('registration_ip')} last={u.get('last_request_ip')} created={u.get('created_at')} seen={u.get('last_seen')}")

# fingerprint if present
fp = yama.get("device_fingerprint") or yama.get("fingerprint") or yama.get("cf_fingerprint")
print("\nfingerprint field:", fp)
for fk in ("device_fingerprint", "fingerprint", "visitor_id", "cf_bot_score"):
    if yama.get(fk):
        samefp = list(db.users.find({fk: yama[fk]}, {"_id": 0, "username": 1, "email": 1, "is_dead": 1}))
        print(f"same {fk}:", samefp)

# admin linked accounts / multi account reports
for coll in ("account_links", "linked_accounts", "multi_accounts", "duplicate_accounts", "staff_links"):
    if coll in db.list_collection_names():
        rows = list(db[coll].find({"$or": [{"user_id": uid}, {"email": EMAIL}]}, {"_id": 0}).limit(20))
        print(coll, rows)

# family mates for context only
fam = yama.get("family_id")
if fam:
    mates = list(db.users.find({"family_id": fam}, {"_id": 0, "username": 1, "email": 1, "is_dead": 1}))
    print(f"\nfamily_id={fam} members ({len(mates)}):")
    for m in mates:
        print(f"  {m.get('username')} email={m.get('email')} dead={m.get('is_dead')}")
