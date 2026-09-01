"""Trace Zwischenzug exclusive cars: owners, events, melt spikes."""
import os
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]
UID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"

print("=== current owners of exclusive catalog cars ===")
for cid in ("car20", "car21", "car22", "car23", "car24"):
    rows = list(db.user_cars.find({"car_id": cid}, {"_id": 0, "id": 1, "user_id": 1, "acquired_at": 1, "listed_for_sale": 1}))
    print(cid, "count", len(rows))
    for r in rows:
        u = db.users.find_one({"id": r.get("user_id")}, {"_id": 0, "username": 1, "is_npc": 1, "is_admin": 1, "is_moderator": 1, "role": 1})
        print(" ", r.get("id"), "owner", (u or {}).get("username"), r.get("user_id"), "listed", r.get("listed_for_sale"), "acq", r.get("acquired_at"))

print("\n=== exclusive_car_events for car20/car21 today ===")
for r in db.exclusive_car_events.find({"car_id": {"$in": ["car20", "car21"]}}).sort("at", -1).limit(30):
    r.pop("_id", None)
    print(r)

print("\n=== Zwischenzug melt_events last 24h (largest first) ===")
cut = datetime.now(timezone.utc) - timedelta(hours=24)
rows = list(db.melt_events.find({"user_id": UID, "at": {"$gte": cut}}).sort("bullets", -1).limit(15))
print("count last 24h", db.melt_events.count_documents({"user_id": UID, "at": {"$gte": cut}}))
for r in rows:
    print(r.get("at"), "bullets", r.get("bullets"))

print("\n=== all melt_events last 8h chronological ===")
cut8 = datetime.now(timezone.utc) - timedelta(hours=8)
for r in db.melt_events.find({"user_id": UID, "at": {"$gte": cut8}}).sort("at", 1):
    print(r.get("at"), "bullets", r.get("bullets"))

print("\n=== economy_events car-related last 24h ===")
for r in db.economy_events.find(
    {"user_id": UID, "at": {"$gte": cut.isoformat() if False else cut}},
).sort("at", -1).limit(5):
    pass

# try string and datetime
for q in [
    {"user_id": UID, "at": {"$gte": cut.isoformat()}},
    {"user_id": UID, "created_at": {"$gte": cut.isoformat()}},
]:
    n = db.economy_events.count_documents(q)
    print("econ q", q, "n", n)

sample = db.economy_events.find_one({"user_id": UID}, {"_id": 0})
print("sample econ keys", list(sample.keys()) if sample else None, "type", sample.get("type") if sample else None)

print("\n=== economy types today ===")
pipe = [
    {"$match": {"user_id": UID}},
    {"$sort": {"at": -1}},
    {"$limit": 40},
]
for r in db.economy_events.aggregate(pipe):
    r.pop("_id", None)
    t = r.get("type") or r.get("event_type") or r.get("kind")
    if t and any(x in str(t).lower() for x in ("melt", "scrap", "car", "gta", "market", "exclusive")):
        print(r.get("at"), t, r.get("amount") or r.get("profit") or r.get("bullets"), str(r)[:300])

print("\n=== help desk tickets full ===")
for t in db.help_desk_tickets.find({"user_id": UID}).sort("created_at", -1).limit(5):
    t.pop("_id", None)
    print("SUBJECT", t.get("subject"), t.get("status"), t.get("created_at"))
    print("BODY", (t.get("body") or t.get("message") or "")[:2500])
    print("REPLIES", t.get("replies") or t.get("staff_reply") or t.get("messages"))
    print("--- keys", [k for k in t.keys()])

print("\n=== marketplace listings / sales involving him last 24h ===")
for coll_name in ("car_market", "marketplace_cars", "car_listings", "gta_market"):
    if coll_name in db.list_collection_names():
        print("coll", coll_name)

cols = [c for c in db.list_collection_names() if "market" in c.lower() or "listing" in c.lower() or "sale" in c.lower()]
print("market-like collections", cols)
