"""Walk email-free chain for mohair-nugget5c@icloud.com."""
import os
import re

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

EMAIL = "mohair-nugget5c@icloud.com"

# Anyone with email_before_freed matching
freed = list(
    db.users.find(
        {"email_before_freed": {"$regex": f"^{re.escape(EMAIL)}$", "$options": "i"}},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "email_before_freed": 1,
            "email_freed_at": 1,
            "is_dead": 1,
            "created_at": 1,
            "last_seen": 1,
            "registration_freed_email_from_user_id": 1,
            "registration_ip": 1,
            "last_request_ip": 1,
            "last_login_ip": 1,
        },
    )
)
print("=== accounts that FREED this email (dead recycle) ===")
for u in freed:
    print(u)

# Current holder
holder = db.users.find_one(
    {"email": {"$regex": f"^{re.escape(EMAIL)}$", "$options": "i"}},
    {
        "_id": 0,
        "id": 1,
        "username": 1,
        "email": 1,
        "is_dead": 1,
        "created_at": 1,
        "last_seen": 1,
        "registration_freed_email_from_user_id": 1,
        "registration_ip": 1,
        "last_request_ip": 1,
    },
)
print("\n=== CURRENT holder ===")
print(holder)

# Walk registration_freed_email_from_user_id chain
print("\n=== CHAIN (who freed email for whom) ===")
seen = set()
cur = holder
while cur:
    uid = cur.get("id")
    if uid in seen:
        break
    seen.add(uid)
    prev_id = cur.get("registration_freed_email_from_user_id")
    print(
        f"  {cur.get('username')} ({uid}) email={cur.get('email')} "
        f"before_freed={cur.get('email_before_freed')} "
        f"freed_from={prev_id} dead={cur.get('is_dead')} created={cur.get('created_at')}"
    )
    if not prev_id:
        break
    cur = db.users.find_one(
        {"id": prev_id},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "email_before_freed": 1,
            "is_dead": 1,
            "created_at": 1,
            "registration_freed_email_from_user_id": 1,
            "email_freed_at": 1,
            "last_seen": 1,
            "registration_ip": 1,
            "last_request_ip": 1,
        },
    )
    if cur:
        print(f"    <- previous: {cur}")

# Also search email_before_freed contains mohair anywhere + original chain root fdb24033
root = db.users.find_one(
    {"id": "fdb24033-70a4-40d1-a0f2-8629a23e3efb"},
    {
        "_id": 0,
        "id": 1,
        "username": 1,
        "email": 1,
        "email_before_freed": 1,
        "is_dead": 1,
        "created_at": 1,
        "last_seen": 1,
        "registration_freed_email_from_user_id": 1,
        "registration_ip": 1,
        "last_request_ip": 1,
    },
)
print("\n=== Magicland's previous (fdb24033) ===")
print(root)

# Summary table: all accounts ever associated
print("\n=== SUMMARY: all accounts ever tied to this email ===")
rows = []
# current
if holder:
    rows.append(("current_email", holder))
for u in freed:
    rows.append(("email_before_freed", u))
# walk full chain usernames
for label, u in rows:
    print(
        f"  [{label}] {u.get('username'):20} id={u.get('id')} dead={u.get('is_dead')} "
        f"created={u.get('created_at')} email_now={u.get('email')}"
    )

# If root had same email before freed
if root and (root.get("email_before_freed") or "").lower().find("mohair") >= 0:
    print("root also had mohair email")
elif root:
    print(f"root email_before_freed={root.get('email_before_freed')} current={root.get('email')}")
