"""Read-only: show revive status / payments for a username (default 'time')."""
import os
import re
import sys
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
name = sys.argv[1] if len(sys.argv) > 1 else "time"
rx = {"$regex": f"^{re.escape(name)}$", "$options": "i"}

USER_FIELDS = {
    "_id": 0, "id": 1, "username": 1, "email": 1, "is_dead": 1, "dead_at": 1,
    "account_locked": 1, "killed_by_username": 1, "points": 1, "created_at": 1,
    "death_by_staff": 1, "retrieval_used": 1, "modkilled": 1, "is_banned": 1,
}

print("=== users matching", name)
users = list(db.users.find({"username": rx}, USER_FIELDS))
for u in users:
    print(u)

ids = [u["id"] for u in users]
emails = sorted({(u.get("email") or "").strip().lower() for u in users if u.get("email")})

if emails:
    print("\n=== all accounts on email(s)", emails)
    for u in db.users.find({"email": {"$in": [re.compile(f"^{re.escape(e)}$", re.I) for e in emails]}}, USER_FIELDS):
        print(u)
    print("\n=== revive_used_by_email")
    for r in db.revive_used_by_email.find({"email": {"$in": emails}}, {"_id": 0}):
        print(r)

print("\n=== revive_payment_intents (reviver or dead target)")
for r in db.revive_payment_intents.find(
    {"$or": [{"reviver_id": {"$in": ids}}, {"dead_user_id": {"$in": ids}},
             {"reviver_username": rx}, {"dead_username": rx},
             *([{"reviver_email": {"$in": emails}}] if emails else [])]},
    {"_id": 0},
).sort("created_at", -1).limit(20):
    print(r)

print("\n=== payment_transactions (revive package or user)")
q = {"$or": [{"user_id": {"$in": ids}}, {"revive_dead_username": rx}, {"metadata.revive_dead_username": rx}]}
for r in db.payment_transactions.find(q, {"_id": 0, "metadata": 0}).sort("created_at", -1).limit(25):
    print(r)

print("\n=== latest 10 dead_alive_revive_10 transactions overall")
for r in db.payment_transactions.find({"package_id": "dead_alive_revive_10"}, {"_id": 0, "metadata": 0}).sort("created_at", -1).limit(10):
    print(r)
