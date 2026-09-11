"""Dump recent help-desk tickets from 5545 (+ trap / attack context)."""
import os
from datetime import datetime, timezone, timedelta
from pprint import pprint

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USERNAME = "5545"
user = db.users.find_one(
    {"username": {"$regex": f"^{USERNAME}$", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "is_banned": 1, "last_seen": 1},
)
print("USER:", user)
if not user:
    raise SystemExit(1)
uid = user["id"]

print("\n=== TRAP ===")
print(db.bot_traps.find_one({"user_id": uid}))

print("\n=== HELP DESK TICKETS (newest first) ===")
tickets = list(
    db.help_desk_tickets.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).limit(8)
)
if not tickets:
    # fallback by username fields
    tickets = list(
        db.help_desk_tickets.find(
            {"$or": [{"username": user["username"]}, {"author_username": user["username"]}]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(8)
    )
print(f"count_shown={len(tickets)}")
for t in tickets:
    print("-" * 60)
    print(f"id={t.get('id')} status={t.get('status')} subject={t.get('subject')!r}")
    print(f"created={t.get('created_at')} updated={t.get('updated_at')}")
    body = t.get("body") or t.get("message") or t.get("content") or ""
    print(f"body:\n{body}")
    replies = t.get("replies") or []
    print(f"replies={len(replies)}")
    for r in replies[-6:]:
        print(
            f"  [{r.get('created_at')}] {r.get('author_username') or r.get('username')}: "
            f"{(r.get('body') or r.get('message') or r.get('content') or '')[:500]}"
        )

# Also any very new open tickets mentioning 5545 / attack verification
print("\n=== OPEN TICKETS LAST 2H (any user, attack/verify keywords) ===")
since = datetime.now(timezone.utc) - timedelta(hours=2)
q = {
    "created_at": {"$gte": since.isoformat()},
    "$or": [
        {"subject": {"$regex": "attack|verif|refresh|bot|kill|5545", "$options": "i"}},
        {"body": {"$regex": "attack|verif|refresh|bot|kill", "$options": "i"}},
        {"message": {"$regex": "attack|verif|refresh|bot|kill", "$options": "i"}},
    ],
}
try:
    recent = list(db.help_desk_tickets.find(q, {"_id": 0}).sort("created_at", -1).limit(10))
except Exception:
    recent = list(db.help_desk_tickets.find({}, {"_id": 0}).sort("created_at", -1).limit(15))
for t in recent:
    print(
        f"- {t.get('created_at')} user={t.get('username') or t.get('user_id')} "
        f"status={t.get('status')} subject={t.get('subject')!r}"
    )

print("\n=== ATTACK ATTEMPTS LAST 30M ===")
since_dt = datetime.now(timezone.utc) - timedelta(minutes=30)
n = db.attack_attempts.count_documents({"attacker_id": uid, "created_at": {"$gte": since_dt}})
print("attack_attempts:", n)
outcomes = {}
for row in db.attack_attempts.find({"attacker_id": uid, "created_at": {"$gte": since_dt}}, {"outcome": 1}):
    o = row.get("outcome") or "?"
    outcomes[o] = outcomes.get(o, 0) + 1
print("outcomes:", outcomes)

print("\n=== SAMPLE FIELDS FROM ONE TICKET DOC ===")
one = db.help_desk_tickets.find_one({}, {"_id": 0})
if one:
    print(sorted(one.keys()))
