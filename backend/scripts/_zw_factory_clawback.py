"""Restore Zwischenzug's last-24h factory buys to stock, 6h buy lock, reply to Schizo."""
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

from _system_ai_prank_helpers import db as helpers_db, post

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

ZW_ID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
LOCK_FIELD = "bullet_factory_bot_buy_until"
now = datetime.now(timezone.utc)
since = now - timedelta(hours=24)

zw = db.users.find_one(
    {"id": ZW_ID},
    {"_id": 0, "id": 1, "username": 1, "bullets": 1, LOCK_FIELD: 1},
)
print("zw", zw)
if not zw or (zw.get("username") or "") != "Zwischenzug":
    raise SystemExit("Zwischenzug id mismatch")

rows = list(
    db.activity_log.aggregate(
        [
            {
                "$match": {
                    "user_id": ZW_ID,
                    "action": "armoury_buy_bullets",
                    "created_at": {"$gte": since},
                }
            },
            {
                "$group": {
                    "_id": "$details.state",
                    "bullets": {"$sum": {"$ifNull": ["$details.amount", 0]}},
                    "buys": {"$sum": 1},
                    "cost": {"$sum": {"$ifNull": ["$details.cost", 0]}},
                }
            },
        ]
    )
)
by_state = {r["_id"]: int(r.get("bullets") or 0) for r in rows if r.get("_id")}
total = sum(by_state.values())
print("by_state", by_state, "total", total)
if total <= 0:
    raise SystemExit("no 24h factory buys")

have = int(zw.get("bullets") or 0)
take = min(have, total)
print("have", have, "take", take)

db.users.update_one(
    {"id": ZW_ID, "bullets": {"$gte": take}},
    {
        "$inc": {"bullets": -take, "bullets_purchased_from_armoury": -take},
        "$set": {LOCK_FIELD: (now + timedelta(hours=6)).isoformat()},
    },
)
after = db.users.find_one({"id": ZW_ID}, {"_id": 0, "bullets": 1, LOCK_FIELD: 1})
print("after", after)

for state, n in sorted(by_state.items()):
    res = db.bullet_factory.update_one({"state": state}, {"$inc": {"bullet_stock": n}})
    fresh = db.bullet_factory.find_one({"state": state}, {"_id": 0, "state": 1, "bullet_stock": 1})
    print("restored", state, n, "matched", res.matched_count, "stock", (fresh or {}).get("bullet_stock"))

src = db.game_chat_messages.find_one(
    {"user_id": "828d4094-7095-4007-bb4e-9d8c25c7bc8f", "message": {"$regex": "armoury", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
    sort=[("created_at", -1)],
)
print("reply_to", src)
post(
    "Fixing it. Factory stock's going back. Whoever emptied them is blocked from buying for six hours.",
    reply_to=src,
)
print("done")
