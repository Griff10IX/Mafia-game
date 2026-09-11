"""Find all accounts linked to an email."""
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

EMAIL = "mohair-nugget5c@icloud.com"
email_re = re.compile(f"^{re.escape(EMAIL)}$", re.I)

users = list(
    db.users.find(
        {"email": email_re},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "is_dead": 1,
            "is_banned": 1,
            "created_at": 1,
            "last_seen": 1,
            "current_state": 1,
            "rank": 1,
            "points": 1,
            "money": 1,
            "total_kills": 1,
            "family_id": 1,
            "ip": 1,
            "last_ip": 1,
            "registration_ip": 1,
            "signup_ip": 1,
        },
    )
)
print(f"=== DIRECT email match: {len(users)} ===")
for u in users:
    print(u)

# Also check auth / alt email fields
alts = list(
    db.users.find(
        {
            "$or": [
                {"email": {"$regex": "mohair-nugget5c", "$options": "i"}},
                {"pending_email": email_re},
                {"previous_email": email_re},
                {"emails": EMAIL},
                {"email_normalized": email_re},
            ]
        },
        {"_id": 0, "id": 1, "username": 1, "email": 1, "pending_email": 1, "previous_email": 1},
    )
)
print(f"\n=== Fuzzy/related email fields: {len(alts)} ===")
for u in alts:
    print(u)

ids = [u["id"] for u in users if u.get("id")]
usernames = [u.get("username") for u in users if u.get("username")]

# account_links / multi_accounts / shared_accounts collections if any
for coll in db.list_collection_names():
    if any(x in coll.lower() for x in ("link", "multi", "share", "dupe", "alt", "same_email")):
        print(f"\ncollection candidate: {coll}")

# login / session IPs for these users
ips = set()
for u in users:
    for k in ("ip", "last_ip", "registration_ip", "signup_ip", "last_login_ip"):
        if u.get(k):
            ips.add(str(u[k]).strip())

# from login_logs / auth_logs / sessions
for coll_name in ("login_logs", "auth_logs", "sessions", "user_sessions", "login_history", "security_logs"):
    if coll_name not in db.list_collection_names():
        continue
    print(f"\n=== {coll_name} for these user ids ===")
    q = {"$or": [{"user_id": {"$in": ids}}, {"username": {"$in": usernames}}, {"email": email_re}]}
    try:
        n = db[coll_name].count_documents(q)
        print(f"count={n}")
        for r in db[coll_name].find(q, {"_id": 0}).sort("_id", -1).limit(20):
            print(r)
            for k in ("ip", "ip_address", "client_ip", "xff"):
                if r.get(k):
                    ips.add(str(r[k]).strip())
    except Exception as e:
        print("err", e)

# IP overlap accounts
print(f"\n=== IPs collected: {sorted(ips)} ===")
if ips:
    linked = list(
        db.users.find(
            {
                "$or": [
                    {"last_ip": {"$in": list(ips)}},
                    {"registration_ip": {"$in": list(ips)}},
                    {"signup_ip": {"$in": list(ips)}},
                    {"ip": {"$in": list(ips)}},
                    {"last_login_ip": {"$in": list(ips)}},
                ]
            },
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "email": 1,
                "last_ip": 1,
                "registration_ip": 1,
                "signup_ip": 1,
                "is_dead": 1,
                "is_banned": 1,
                "last_seen": 1,
            },
        ).limit(50)
    )
    print(f"users sharing those IPs: {len(linked)}")
    for u in linked:
        print(u)

# point_ledger / email change events
print("\n=== email change / verify events ===")
for coll_name in ("email_changes", "account_email_history", "audit_logs", "admin_logs"):
    if coll_name not in db.list_collection_names():
        continue
    rows = list(
        db[coll_name].find(
            {"$or": [{"email": email_re}, {"new_email": email_re}, {"old_email": email_re}, {"to_email": email_re}]},
            {"_id": 0},
        ).limit(20)
    )
    if rows:
        print(coll_name, len(rows))
        for r in rows:
            print(r)
