"""Meraxes loot-pieces ticket + purchase/topup history."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

MERAXES_ID = "7c4e21c6-9d20-4b19-8911-d895e008a134"
AMBUSH_ID = "9499a1ea-bf2e-46fe-a3c0-e9506491b83e"

print("=== recent loot pieces tickets ===")
for t in db.help_desk_tickets.find({"subject": {"$regex": "loot", "$options": "i"}}).sort("created_at", -1).limit(8):
    print(
        t.get("id"),
        "user=", t.get("username") or t.get("user_username"),
        "uid=", t.get("user_id"),
        "status=", t.get("status"),
        "closed_by=", t.get("closed_by_username"),
        "created=", t.get("created_at"),
        "subj=", t.get("subject"),
    )
    print("BODY:", (t.get("body") or "")[:500])
    for r in (t.get("replies") or []):
        print("  REPLY", r.get("author_username"), r.get("author_role"), (r.get("body") or "")[:300])
    print("---")

for label, uid in (("Meraxes", MERAXES_ID), ("Ambush", AMBUSH_ID)):
    u = db.users.find_one({"id": uid}, {"_id": 0, "username": 1, "loot_box_pieces": 1, "points": 1})
    print(f"\n==== {label} {u} ====")
    for p in db.payment_transactions.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).limit(12):
        keys = [
            "package_id", "payment_status", "created_at", "points_credited_at",
            "stripe_amount_total_minor", "stripe_currency", "expected_amount_minor",
            "points", "loot_box_pieces",
            "gbp_store_loot_rate_topup_110_at",
            "gbp_store_loot_pack_rate_1000_per_7_at",
        ]
        print({k: p.get(k) for k in keys if p.get(k) is not None})

    print("inbox loot/store:")
    for n in db.notifications.find(
        {"user_id": uid, "$or": [
            {"title": {"$regex": "loot|Store|Wheel", "$options": "i"}},
            {"system_ai": True},
        ]},
        {"_id": 0, "title": 1, "created_at": 1, "message": 1, "system_ai": 1},
    ).sort("created_at", -1).limit(8):
        print(" ", n.get("created_at"), n.get("title"), (n.get("message") or "")[:180])
