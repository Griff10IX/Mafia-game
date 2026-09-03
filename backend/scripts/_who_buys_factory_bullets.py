"""Who is buying factory/armoury bullets. Live DB."""
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc)
windows = [("6h", timedelta(hours=6)), ("24h", timedelta(hours=24)), ("7d", timedelta(days=7))]

print("now", now.isoformat())
print("\n=== armoury stock ===")
for d in db.bullet_factory.find({}, {"_id": 0, "state": 1, "owner_id": 1, "bullets": 1, "stock": 1, "bullet_stock": 1, "price_per_bullet": 1}):
    oid = d.get("owner_id")
    owner = None
    if oid:
        u = db.users.find_one({"id": oid}, {"_id": 0, "username": 1})
        owner = (u or {}).get("username")
    print(d.get("state"), "owner", owner, "doc keys sample", {k: d.get(k) for k in ("bullets", "stock", "bullet_stock", "price_per_bullet") if k in d})

for label, delta in windows:
    since = now - delta
    print(f"\n=== armoury_buy_bullets {label} ===")
    pipe = [
        {"$match": {"action": "armoury_buy_bullets", "created_at": {"$gte": since}}},
        {
            "$group": {
                "_id": {"uid": "$user_id", "username": "$username"},
                "buys": {"$sum": 1},
                "bullets": {"$sum": {"$ifNull": ["$details.amount", 0]}},
                "cost": {"$sum": {"$ifNull": ["$details.cost", 0]}},
            }
        },
        {"$sort": {"bullets": -1}},
        {"$limit": 20},
    ]
    rows = list(db.activity_log.aggregate(pipe))
    print("buyers", len(rows))
    for r in rows:
        k = r.get("_id") or {}
        print(
            f"  {k.get('username')} {str(k.get('uid') or '')[:8]}  buys={r.get('buys')}  bullets={int(r.get('bullets') or 0):,}  cost={int(r.get('cost') or 0):,}"
        )

    by_state = list(
        db.activity_log.aggregate(
            [
                {"$match": {"action": "armoury_buy_bullets", "created_at": {"$gte": since}}},
                {
                    "$group": {
                        "_id": "$details.state",
                        "buys": {"$sum": 1},
                        "bullets": {"$sum": {"$ifNull": ["$details.amount", 0]}},
                    }
                },
                {"$sort": {"bullets": -1}},
            ]
        )
    )
    print("by state")
    for r in by_state:
        print(f"  {r.get('_id')}  buys={r.get('buys')}  bullets={int(r.get('bullets') or 0):,}")

print("\n=== newest 15 buys ===")
for a in db.activity_log.find({"action": "armoury_buy_bullets"}).sort("created_at", -1).limit(15):
    d = a.get("details") or {}
    print(a.get("created_at"), "|", a.get("username"), "|", d.get("amount"), "in", d.get("state"), "cost", d.get("cost"))

print("done")
