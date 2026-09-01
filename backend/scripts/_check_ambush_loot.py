"""Look up Ambush purchases + ticket for loot-piece goodwill calc."""
import os
from pprint import pprint
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

u = db.users.find_one(
    {"username": {"$regex": "^Ambush$", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "loot_box_pieces": 1, "points": 1},
)
print("USER", u)
uid = u["id"]

print("\n=== tickets ===")
for t in db.help_desk_tickets.find({"user_id": uid}).sort("created_at", -1).limit(5):
    print(t.get("id"), t.get("subject"), t.get("status"), t.get("created_at"))
    print((t.get("body") or "")[:800])
    print("replies", t.get("replies"))
    print("---")

print("\n=== payment_transactions ===")
for p in db.payment_transactions.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).limit(15):
    keys = [
        "session_id", "package_id", "payment_status", "created_at", "points_credited_at",
        "stripe_amount_total_minor", "stripe_currency", "expected_amount_minor",
        "points", "loot_box_pieces", "gbp_store_loot_rate_topup_110_at",
        "gbp_store_loot_pack_rate_1000_per_7_at",
    ]
    print({k: p.get(k) for k in keys if k in p or p.get(k) is not None})

print("\n=== economy/point events around 28 Aug ===")
for coll in ("economy_events", "point_ledger", "points_events", "store_events"):
    if coll not in db.list_collection_names():
        continue
    print("coll", coll)
    sample = db[coll].find_one({"user_id": uid}, {"_id": 0})
    print("sample keys", list(sample.keys()) if sample else None)
