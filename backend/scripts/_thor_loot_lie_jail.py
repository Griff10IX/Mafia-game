"""Jail Thor 5 min unbreakable (lied about loot boxes), inbox GhostFace, chat reply."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

GF_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
THOR_ID = "37137408-371d-41d2-ae26-2dfc83a72c8b"
GF_CHAT_ID = "04e3d77c-d994-4254-a3db-380c8b2c5ef9"
AVATAR = "/images/system-ai-avatar.jpg"

now = datetime.now(timezone.utc)
until = now + timedelta(minutes=5)
until_iso = until.isoformat()
now_iso = now.isoformat()

thor = db.users.find_one(
    {"id": THOR_ID},
    {"_id": 0, "id": 1, "username": 1, "email": 1, "is_moderator": 1, "is_help_desk_operator": 1, "is_entertainer": 1, "in_jail": 1},
)
gf = db.users.find_one({"id": GF_ID}, {"_id": 0, "id": 1, "username": 1})
print("THOR", {k: v for k, v in (thor or {}).items() if k != "email"})
print("GF", gf)
if not thor or (thor.get("username") or "") != "Thor":
    raise SystemExit("Thor id mismatch")
if not gf or (gf.get("username") or "") != "GhostFace":
    raise SystemExit("GhostFace id mismatch")
if thor.get("is_moderator") or thor.get("is_help_desk_operator"):
    raise SystemExit("will not jail staff")

res = db.users.update_one(
    {"id": THOR_ID, "username": "Thor"},
    {
        "$set": {
            "in_jail": True,
            "jail_until": until_iso,
            "unbreakable_until": until_iso,
            "snitch_attempted_this_term": False,
        }
    },
)
print("jail_modified", res.modified_count, "until", until_iso)

src = db.game_chat_messages.find_one({"id": GF_CHAT_ID}, {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1})
if not src:
    raise SystemExit("ghostface chat missing")
if db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": GF_CHAT_ID}, {"_id": 1}):
    print("chat already replied")
else:
    chat_text = "Checked. Loot boxes open. Thor was wasting the check. Five minutes, unbreakable."
    db.game_chat_messages.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": "system_ai",
            "username": "System AI",
            "message": chat_text,
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

TITLE = "Loot boxes — Thor"
BODY = (
    "GhostFace,\n\n"
    "I checked what Thor said about loot boxes not working, and I tested the live file.\n\n"
    "They are working.\n"
    "• 154 successful opens in the last 24 hours. Last open was Magicland, about an hour ago.\n"
    "• Thor himself opened three Common boxes today (11:53 UTC). Rewards landed. He still has 1,071 pieces.\n"
    "• Loot page is not locked. Racing is the only locked page.\n"
    "• Thor has no Help Desk ticket about boxes failing.\n\n"
    "No engine issue found. He was lying / wasting the check.\n\n"
    "I put him in jail for 5 minutes, unbreakable, as you said.\n\n"
    "— System AI"
)
already = db.notifications.find_one(
    {"user_id": GF_ID, "title": TITLE, "system_ai": True, "created_at": {"$gte": (now - timedelta(hours=2)).isoformat()}},
    {"_id": 0, "id": 1},
)
if already:
    print("inbox already", already)
else:
    nid = str(uuid.uuid4())
    db.notifications.insert_one(
        {
            "id": nid,
            "user_id": GF_ID,
            "title": TITLE,
            "message": BODY,
            "notification_type": "system",
            "category": "system",
            "read": False,
            "created_at": now_iso,
            "system_ai": True,
            "avatar_url": AVATAR,
        }
    )
    print("inbox sent", nid)

after = db.users.find_one(
    {"id": THOR_ID},
    {"_id": 0, "username": 1, "in_jail": 1, "jail_until": 1, "unbreakable_until": 1},
)
print("AFTER", after)
print("done")
