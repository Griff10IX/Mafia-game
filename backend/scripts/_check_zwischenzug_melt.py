"""Live check: Zwischenzug exclusive/loot-exclusive melt prefs + recent melts."""
import os
import sys
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pymongo import MongoClient

sys.path.insert(0, "/opt/mafia-app/backend")
load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

CATALOG = {
    "car20": ("exclusive", "Al Capone's Armored Cadillac"),
    "car21": ("loot_exclusive", "1930 Cadillac Series 452 V-16 Armored Sedan"),
    "car22": ("vip_exclusive", "VIP pass car"),
    "car23": ("loot_exclusive", "Duesenberg Model SJ"),
    "car24": ("loot_exclusive", "Mercedes-Benz 540K"),
}

u = db.users.find_one(
    {"username": {"$regex": "^Zwischenzug$", "$options": "i"}},
    {
        "_id": 0,
        "id": 1,
        "username": 1,
        "auto_rank_enabled": 1,
        "auto_rank_permanent": 1,
        "auto_rank_email_entitlement": 1,
        "auto_rank_purchased": 1,
        "auto_rank_melt": 1,
        "auto_rank_scrap": 1,
        "auto_rank_melt_action_ids": 1,
        "auto_rank_melt_rarity_ids": 1,
        "auto_rank_scrap_rarity_ids": 1,
        "auto_rank_gta": 1,
        "family_id": 1,
        "is_dead": 1,
        "health": 1,
        "role": 1,
        "is_admin": 1,
        "is_moderator": 1,
    },
)
print("USER", u)
uid = u["id"]

print("\n=== GARAGE exclusive-tier ===")
cars = list(db.user_cars.find({"user_id": uid}, {"_id": 0, "id": 1, "car_id": 1, "listed_for_sale": 1, "created_at": 1}))
print("total cars", len(cars))
for c in cars:
    cid = c.get("car_id")
    if cid in CATALOG:
        rar, name = CATALOG[cid]
        print(" ", rar, name, cid, "ucid", c.get("id"), "listed", c.get("listed_for_sale"), "created", c.get("created_at"))

print("\n=== counts by catalog id ===")
from collections import Counter
print(Counter(c.get("car_id") for c in cars if c.get("car_id") in CATALOG))

print("\n=== exclusive_car_events involving him (last 40) ===")
rows = list(
    db.exclusive_car_events.find(
        {"$or": [{"from_user_id": uid}, {"to_user_id": uid}, {"user_id": uid}]},
        {"_id": 0},
    ).sort("at", -1).limit(40)
)
print("count", len(rows))
for r in rows:
    print(r.get("at"), r.get("event_type"), r.get("car_id"), r.get("car_name"), r.get("from_username"), r.get("to_username"), r.get("extra"))

print("\n=== melted/scraped from him ===")
for r in db.exclusive_car_events.find(
    {"from_user_id": uid, "event_type": {"$in": ["melted", "scraped"]}},
    {"_id": 0},
).sort("at", -1).limit(20):
    print(r)

print("\n=== help desk last 10 ===")
for t in db.help_desk_tickets.find(
    {"user_id": uid},
    {"_id": 0, "id": 1, "subject": 1, "status": 1, "created_at": 1, "body": 1},
).sort("created_at", -1).limit(8):
    print(t.get("created_at"), t.get("status"), t.get("subject"))
    print((t.get("body") or "")[:2000])
    print("---")

print("\n=== notifications last 2d exclusive/melt ===")
cut = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
for n in db.notifications.find(
    {"user_id": uid, "created_at": {"$gte": cut}},
    {"_id": 0, "title": 1, "message": 1, "created_at": 1, "notification_type": 1},
).sort("created_at", -1).limit(25):
    msg = (n.get("message") or "")[:180]
    if any(x in (n.get("title") or "").lower() + msg.lower() for x in ("melt", "exclusive", "cadillac", "loot", "540", "duesenberg")):
        print(n.get("created_at"), n.get("title"), msg)

print("\n=== family war? ===")
fid = u.get("family_id")
if fid:
    fam = db.families.find_one({"id": fid}, {"_id": 0, "name": 1, "in_war": 1, "war_id": 1, "at_war": 1})
    print("family", fam)
    war = db.family_wars.find_one({"$or": [{"family_a_id": fid}, {"family_b_id": fid}, {"a_id": fid}, {"b_id": fid}], "status": {"$in": ["active", "ongoing"]}}, {"_id": 0, "id": 1, "status": 1, "started_at": 1})
    print("active war", war)
