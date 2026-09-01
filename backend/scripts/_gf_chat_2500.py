"""Credit 2500 points to everyone who posted in global chat in the last 3 hours. GhostFace command."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

POINTS = 2500
AVATAR = "/images/system-ai-avatar.png"
now = datetime.now(timezone.utc)
now_iso = now.isoformat()
since = now - timedelta(hours=3)
since_iso = since.isoformat()

posters = {}
for m in db.game_chat_messages.find(
    {
        "channel": "global",
        "created_at": {"$gte": since_iso},
        "user_id": {"$nin": ["system_ai", "", None]},
    },
    {"_id": 0, "user_id": 1, "username": 1},
):
    uid = m.get("user_id")
    if not uid or uid == "system_ai":
        continue
    if (m.get("username") or "").strip().lower() == "system ai":
        continue
    posters[uid] = m.get("username") or posters.get(uid) or "?"

print("since", since_iso)
print("unique_posters", len(posters))

credited = []
for uid, uname in posters.items():
    user = db.users.find_one(
        {"id": uid, "is_npc": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "points": 1, "is_npc": 1},
    )
    if not user:
        print("skip missing/npc", uid, uname)
        continue
    already = db.point_ledger_events.find_one(
        {"user_id": uid, "origin_ref": "system_ai_gf_chat_3h_2500"},
        {"_id": 0, "id": 1},
    )
    if already:
        print("already", user.get("username"))
        credited.append(user.get("username") or uname)
        continue
    before = db.users.find_one_and_update(
        {"id": uid, "is_npc": {"$ne": True}},
        {"$inc": {"points": POINTS}},
        projection={"_id": 0, "points": 1, "username": 1},
        return_document=ReturnDocument.BEFORE,
    )
    if not before:
        print("no update", uid)
        continue
    pts_before = int((before or {}).get("points") or 0)
    pts_after = pts_before + POINTS
    name = user.get("username") or uname
    db.point_ledger_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "event_type": "system_ai_gf_chat_bonus",
            "user_id": uid,
            "points": POINTS,
            "lot_id": None,
            "origin_ref": "system_ai_gf_chat_3h_2500",
            "root_purchase_ref": None,
            "meta": {"reason": "ghostface_chat_last_3h"},
            "created_at": now_iso,
            "wallet_points_before": pts_before,
            "wallet_points_after": pts_after,
            "source": "system_ai",
        }
    )
    db.notifications.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "title": "Chat bonus",
            "message": (
                f"{name},\n\n"
                "This is the system AI.\n\n"
                "GhostFace said to send 2,500 points to everyone who posted in chat in the last 3 hours. "
                "They are already on your account.\n\n"
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
    credited.append(name)
    print("credited", name, pts_before, "->", pts_after)

credited = sorted(set(credited), key=str.lower)
print("NAMES", ", ".join(credited))

chat_text = (
    "GhostFace said 2,500 points to everyone who posted in the last 3 hours. "
    "Sent to: " + ", ".join(credited) + "."
)
already_chat = db.game_chat_messages.find_one(
    {"user_id": "system_ai", "message": chat_text, "channel": "global"},
    {"_id": 0, "id": 1},
)
if already_chat:
    print("chat already", already_chat)
else:
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": "system_ai",
        "username": "System AI",
        "message": chat_text,
        "family_id": None,
        "channel": "global",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "sender_is_staff": True,
        "system_ai": True,
        "avatar_url": AVATAR,
        "author_online_color": "#FBBF24",
        "viewed_by": [],
        "reply_to": {
            "id": "104efacb-7472-440b-8d65-3d0b068d3201",
            "username": "GhostFace",
            "message": "@system Send everyone who posted in this chat in the last 3 hours 2,500 points; show the notifications here",
            "has_gif": False,
        },
    }
    db.game_chat_messages.insert_one(doc)
    print("chat posted", doc["id"])
print("done")
