"""Deeper Schizophrenic/TNT: points to Thor, /16, fingerprint."""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

SCHIZO = "828d4094-7095-4007-bb4e-9d8c25c7bc8f"
TNT = "5bd4e12d-2919-44c3-bf29-dbdd522b6fea"
THOR = "37137408-371d-41d2-ae26-2dfc83a72c8b"

print("=== points_transfers involving Schizo / TNT / Thor ===")
for qlabel, q in [
    ("from schizo", {"from_user_id": SCHIZO}),
    ("to schizo", {"to_user_id": SCHIZO}),
    ("from tnt", {"from_user_id": TNT}),
    ("to tnt", {"to_user_id": TNT}),
    ("to thor", {"to_user_id": THOR}),
    ("from thor", {"from_user_id": THOR}),
    ("amount 10000 any of them", {
        "amount": {"$in": [10000, 10000.0]},
        "$or": [
            {"from_user_id": {"$in": [SCHIZO, TNT, THOR]}},
            {"to_user_id": {"$in": [SCHIZO, TNT, THOR]}},
            {"from_username": {"$regex": "schizo|tnt|thor", "$options": "i"}},
            {"to_username": {"$regex": "schizo|tnt|thor", "$options": "i"}},
        ],
    }),
]:
    rows = list(db.points_transfers.find(q, {"_id": 0}).sort("created_at", -1).limit(15))
    print(f"\n{qlabel}: {len(rows)}")
    for r in rows[:10]:
        print(" ", {k: r.get(k) for k in (
            "created_at", "from_username", "to_username", "from_user_id", "to_user_id",
            "amount", "points", "reason", "note",
        ) if r.get(k) is not None})

print("\n=== point_ledger_events sample ===")
sample = db.point_ledger_events.find_one({}, {"_id": 0})
print("keys", sorted((sample or {}).keys())[:40])
for uid, name in ((SCHIZO, "Schizo"), (TNT, "TNT"), (THOR, "Thor")):
    n = db.point_ledger_events.count_documents({"user_id": uid})
    print(f"{name} ledger events: {n}")
    rows = list(
        db.point_ledger_events.find(
            {"user_id": uid, "$or": [{"delta": 10000}, {"amount": 10000}, {"points": 10000}]},
            {"_id": 0},
        ).sort("created_at", -1).limit(5)
    )
    for r in rows:
        print(" ", r)

print("\n=== money_transfers ===")
for q in [
    {"from_user_id": {"$in": [SCHIZO, TNT]}},
    {"to_user_id": {"$in": [SCHIZO, TNT, THOR]}},
]:
    for r in db.money_transfers.find(q, {"_id": 0}).sort("created_at", -1).limit(8):
        print(r)

print("\n=== Thor dead accounts that got points (search notifications 10,000) ===")
notes = list(
    db.notifications.find(
        {"user_id": THOR, "message": {"$regex": "10,?000"}},
        {"_id": 0, "created_at": 1, "title": 1, "message": 1},
    ).sort("created_at", -1).limit(20)
)
for n in notes:
    print(n)

# Search all notifications mentioning funding / gifted points from Schizo text
print("\n=== notifications with 'Schizophrenic' + points near Thor ===")
for n in db.notifications.find(
    {
        "user_id": THOR,
        "message": {"$regex": "Schizophrenic|points", "$options": "i"},
        "created_at": {"$gte": "2026-08-01"},
    },
    {"_id": 0, "created_at": 1, "title": 1, "message": 1},
).sort("created_at", -1).limit(30):
    msg = n.get("message") or ""
    if "point" in msg.lower() or "Schizophrenic" in msg:
        if "E-Game" in (n.get("title") or ""):
            continue
        print(n)

print("\n=== store / gift logs ===")
for coll in ("point_audit_events", "dead_alive_transfers", "store_points_cash_logs"):
    for r in db[coll].find(
        {
            "$or": [
                {"user_id": {"$in": [SCHIZO, TNT, THOR]}},
                {"from_user_id": {"$in": [SCHIZO, TNT, THOR]}},
                {"to_user_id": {"$in": [SCHIZO, TNT, THOR]}},
                {"username": {"$regex": "^(Schizophrenic|TNT|Thor)$", "$options": "i"}},
            ]
        },
        {"_id": 0},
    ).sort("created_at", -1).limit(5):
        print(coll, r)

print("\n=== EE 82.132 accounts (weak carrier overlap note) ===")
# Count how common 82.132 is
print("users last_request 82.132:", db.users.count_documents({"last_request_ip": {"$regex": "^82\\.132\\."}}))

print("\n=== TNT original email before dead wipe? ===")
# check backups / banned / username history
for coll in ("users_backup", "deleted_users", "username_history", "account_wipes"):
    try:
        n = db[coll].count_documents({"$or": [{"id": TNT}, {"username": "TNT"}]})
        print(coll, n)
        if n:
            print(db[coll].find_one({"$or": [{"id": TNT}, {"username": "TNT"}]}, {"_id": 0, "email": 1, "username": 1, "registration_ip": 1}))
    except Exception as e:
        print(coll, e)

# Bruno link to Schizo
print("\n=== Bruno (shared IPv6 with Schizo) ===")
bruno = db.users.find_one({"username": "Bruno"}, {"_id": 0, "id": 1, "email": 1, "registration_ip": 1, "last_request_ip": 1, "is_dead": 1, "created_at": 1})
print(bruno)

# Ambush on TNT IP - known separate?
print("\n=== Ambush on TNT IP ===")
amb = db.users.find_one({"username": "Ambush"}, {"_id": 0, "id": 1, "last_request_ip": 1, "registration_ip": 1, "email": 1})
print(amb)
