"""Refund Thor's paid Ultra (voucher wasn't live yet) and reply to his liar line."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient, DESCENDING, ReturnDocument

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

THOR_ID = "37137408-371d-41d2-ae26-2dfc83a72c8b"
AVATAR = "/images/system-ai-avatar.jpg"
now = datetime.now(timezone.utc)
now_iso = now.isoformat()

thor = db.users.find_one(
    {"id": THOR_ID},
    {"_id": 0, "username": 1, "loot_box_pieces": 1, "loot_box_free_ultra_opens": 1, "loot_box_recent": 1},
)
print("THOR before", {k: thor.get(k) for k in ("username", "loot_box_pieces", "loot_box_free_ultra_opens")})
recent = list(thor.get("loot_box_recent") or [])[-3:]
for r in recent:
    print("open", r.get("opened_at"), r.get("box_quality"), "prizes", r.get("prizes_count"))

last = db.economy_events.find_one(
    {"type": "loot_box_open", "user_id": THOR_ID},
    {"_id": 0},
    sort=[("at", DESCENDING)],
)
print("last_event", last.get("at") if last else None, last.get("box_quality") if last else None, last.get("username") if last else None)

# He paid 1000 because the voucher UI/API was not live. Put pieces back; that open is the free Ultra.
# Keep 1 voucher so the page shows FREE after deploy — no: that would be a second free open.
# Refund only; burn voucher so it matches "1 free ultra" already taken as the paid open.
after = db.users.find_one_and_update(
    {"id": THOR_ID, "username": "Thor"},
    {
        "$inc": {"loot_box_pieces": 1000},
        "$set": {"loot_box_free_ultra_opens": 0},
    },
    projection={"_id": 0, "username": 1, "loot_box_pieces": 1, "loot_box_free_ultra_opens": 1},
    return_document=ReturnDocument.AFTER,
)
print("THOR after", after)

src = db.game_chat_messages.find_one(
    {"user_id": THOR_ID, "channel": "global", "message": {"$regex": "lied", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1, "created_at": 1},
    sort=[("created_at", DESCENDING)],
)
print("src", src)
if not src:
    raise SystemExit("thor liar line missing")
if db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src["id"]}, {"_id": 1}):
    print("already replied")
else:
    text = "I did not lie. You opened Ultra Rare before the free mark showed. I put the 1,000 pieces back. That open was the free one."
    db.game_chat_messages.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": "system_ai",
            "username": "System AI",
            "message": text,
            "family_id": None,
            "channel": "global",
            "created_at": now_iso,
            "expires_at": now + timedelta(days=7),
            "sender_is_staff": True,
            "system_ai": True,
            "avatar_url": AVATAR,
            "author_online_color": "#FBBF24",
            "viewed_by": [],
            "reply_to": {
                "id": src["id"],
                "username": src.get("username") or "?",
                "message": (src.get("message") or "")[:180],
                "has_gif": bool(src.get("gif_url")),
            },
        }
    )
    print("chat posted")

nid = str(uuid.uuid4())
db.notifications.insert_one(
    {
        "id": nid,
        "user_id": THOR_ID,
        "title": "Ultra Rare pieces",
        "message": (
            "Thor,\n\n"
            "This is the system AI. I did not lie.\n\n"
            "The free Ultra Rare was already on your account. You opened Ultra Rare before it showed on the page, so it took 1,000 pieces. "
            "Those pieces are back. That open was the free one.\n\n"
            "— System AI"
        ),
        "notification_type": "system",
        "category": "system",
        "read": False,
        "created_at": now_iso,
        "system_ai": True,
        "avatar_url": AVATAR,
    }
)
print("inbox", nid)
print("done")
