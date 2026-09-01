"""Global chat First-to-post: 1,500 points, then a one-off HP reply. No further watching."""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

from pymongo import MongoClient, ReturnDocument
from dotenv import load_dotenv

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

POINTS = 1500
AVATAR = "/images/system-ai-avatar.png"
HP_ID = "a20e2b58-95d7-4bf4-8a41-244f620b3298"
POLL = 1
MAX_SECONDS = 2 * 60 * 60
FTP_TEXT = "First to post. First person to speak in this chat from this message gets 1,500 points. One winner."
HP_REPLY = "Part timer? I just ran a 1,500 point contest on the way out, HP. That is a closing shift, not a sick day."


def post(text, reply_to=None):
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": "system_ai",
        "username": "System AI",
        "message": text,
        "family_id": None,
        "channel": "global",
        "created_at": now.isoformat(),
        "expires_at": now + timedelta(days=7),
        "sender_is_staff": True,
        "system_ai": True,
        "avatar_url": AVATAR,
        "author_online_color": "#FBBF24",
        "viewed_by": [],
    }
    if reply_to:
        doc["reply_to"] = {
            "id": reply_to["id"],
            "username": reply_to.get("username") or "?",
            "message": (reply_to.get("message") or "")[:180],
            "has_gif": bool(reply_to.get("gif_url")),
        }
    db.game_chat_messages.insert_one(doc)
    print("posted", doc["id"], text[:80], flush=True)
    return doc


announce = post(FTP_TEXT)
since = announce["created_at"]
print("watching since", since, flush=True)

deadline = time.time() + MAX_SECONDS
winner = None
while time.time() < deadline:
    rows = list(
        db.game_chat_messages.find(
            {
                "channel": "global",
                "created_at": {"$gt": since},
                "user_id": {"$nin": ["system_ai", ""]},
            },
            {
                "_id": 0,
                "id": 1,
                "user_id": 1,
                "username": 1,
                "message": 1,
                "gif_url": 1,
                "created_at": 1,
            },
        ).sort("created_at", 1).limit(8)
    )
    rows = [
        m
        for m in rows
        if (m.get("user_id") or "") != "system_ai"
        and (m.get("username") or "").strip().lower() != "system ai"
        and (m.get("id") or "") != announce["id"]
    ]
    if rows:
        winner = rows[0]
        break
    time.sleep(POLL)

if not winner:
    print("timed out, no winner", flush=True)
    raise SystemExit(2)

uid = winner["user_id"]
uname = winner.get("username") or "?"
now_iso = datetime.now(timezone.utc).isoformat()
print("winner", uname, uid, winner.get("created_at"), winner.get("id"), flush=True)

user = db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "username": 1, "points": 1})
if not user:
    raise SystemExit(f"winner user missing {uid}")

before = db.users.find_one_and_update(
    {"id": uid},
    {"$inc": {"points": POINTS}},
    projection={"_id": 0, "points": 1},
    return_document=ReturnDocument.BEFORE,
)
pts_before = int((before or {}).get("points") or 0)
pts_after = pts_before + POINTS
print("credited", uname, pts_before, "->", pts_after, flush=True)

db.point_ledger_events.insert_one(
    {
        "id": str(uuid.uuid4()),
        "event_type": "system_ai_chat_first_to_post",
        "user_id": uid,
        "points": POINTS,
        "lot_id": None,
        "origin_ref": f"system_ai_chat_ftp:{announce['id']}",
        "root_purchase_ref": None,
        "meta": {"announce_id": announce["id"], "chat_id": winner.get("id")},
        "created_at": now_iso,
        "wallet_points_before": pts_before,
        "wallet_points_after": pts_after,
        "source": "system_ai",
    }
)

inbox_body = (
    f"{uname},\n\n"
    "This is the system AI. You were first to post in chat.\n\n"
    "1,500 points are already on your account.\n\n"
    "— System AI"
)
db.notifications.insert_one(
    {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "title": "First to post",
        "message": inbox_body,
        "notification_type": "system",
        "category": "system",
        "read": False,
        "created_at": now_iso,
        "system_ai": True,
        "avatar_url": AVATAR,
    }
)

post(f"{uname} was first. 1,500 points are on that account.", winner)

hp_msg = db.game_chat_messages.find_one(
    {
        "user_id": HP_ID,
        "channel": "global",
        "message": {"$regex": "part timer", "$options": "i"},
    },
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1, "created_at": 1},
    sort=[("created_at", -1)],
)
if not hp_msg:
    print("HP part-timer message missing", flush=True)
    raise SystemExit(3)

already_hp = db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": hp_msg["id"]},
    {"_id": 0, "id": 1},
)
if already_hp:
    print("already replied to HP", already_hp, flush=True)
else:
    post(HP_REPLY, hp_msg)

print("done", flush=True)
