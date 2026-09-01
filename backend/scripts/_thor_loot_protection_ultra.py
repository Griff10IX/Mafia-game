"""Credit Thor 1 free Ultra Rare loot open, inbox GF + Thor, chat replies. No jail."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

GF_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
THOR_ID = "37137408-371d-41d2-ae26-2dfc83a72c8b"
GF_CHAT_ID = "04e3d77c-d994-4254-a3db-380c8b2c5ef9"
THOR_CHAT_ID = "7bc6e1d5-95e4-45e6-aeb7-1f2383d31a6c"
AVATAR = "/images/system-ai-avatar.jpg"
now = datetime.now(timezone.utc)
now_iso = now.isoformat()

thor = db.users.find_one({"id": THOR_ID}, {"_id": 0, "id": 1, "username": 1, "in_jail": 1, "loot_box_free_ultra_opens": 1})
gf = db.users.find_one({"id": GF_ID}, {"_id": 0, "id": 1, "username": 1})
print("THOR", thor)
print("GF", gf)
if not thor or thor.get("username") != "Thor":
    raise SystemExit("Thor mismatch")
if not gf or gf.get("username") != "GhostFace":
    raise SystemExit("GhostFace mismatch")

after = db.users.find_one_and_update(
    {"id": THOR_ID, "username": "Thor"},
    {"$inc": {"loot_box_free_ultra_opens": 1}},
    projection={"_id": 0, "username": 1, "loot_box_free_ultra_opens": 1, "in_jail": 1},
    return_document=ReturnDocument.AFTER,
)
print("voucher", after)


def inbox(uid, title, body):
    already = db.notifications.find_one(
        {"user_id": uid, "title": title, "system_ai": True, "created_at": {"$gte": (now - timedelta(hours=2)).isoformat()}},
        {"_id": 0, "id": 1},
    )
    if already:
        print("inbox already", uid, title, already)
        return
    nid = str(uuid.uuid4())
    db.notifications.insert_one(
        {
            "id": nid,
            "user_id": uid,
            "title": title,
            "message": body,
            "notification_type": "system",
            "category": "system",
            "read": False,
            "created_at": now_iso,
            "system_ai": True,
            "avatar_url": AVATAR,
        }
    )
    print("inbox", uid, nid)


inbox(
    GF_ID,
    "Loot boxes — Thor",
    "GhostFace,\n\n"
    "Thor was not lying about protection. I did not jail him.\n\n"
    "Loot boxes themselves are working. Other players opened tonight. You opened one yourself.\n\n"
    "Thor’s opens were 409 — new-account protection. He is still inside the 14-day window. "
    "Opening a box can roll an exclusive car, which ends protection, so the game asks him to confirm first. "
    "His evening clicks never sent that confirm, so the box never opened. Commons he opened this morning went through when he confirmed.\n\n"
    "That is not a broken loot table. The prompt is easy to cancel and then it looks stuck.\n\n"
    "I put 1 free Ultra Rare opening on Thor’s account. He still has to click continue on the protection warning or the box will not open. Protection stays on unless an exclusive car actually drops.\n\n"
    "— System AI",
)

inbox(
    THOR_ID,
    "Loot boxes",
    "Thor,\n\n"
    "This is the system AI. I checked why your boxes would not open.\n\n"
    "You still have new-account protection. Opening a loot box can roll an exclusive car, and that would end protection, so the game asks you to confirm first. If you cancel that warning, the box does not open. That is what happened.\n\n"
    "I have put 1 free Ultra Rare opening on this account. Open Ultra Rare, then click continue on the protection warning. It will not cost pieces.\n\n"
    "— System AI",
)


def post_reply(src_id, text, *, force_new=False):
    src = db.game_chat_messages.find_one(
        {"id": src_id},
        {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
    )
    if not src:
        print("missing chat", src_id)
        return
    if (not force_new) and db.game_chat_messages.find_one({"user_id": "system_ai", "reply_to.id": src_id}, {"_id": 1}):
        print("already replied", src_id)
        return
    db.game_chat_messages.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": "system_ai",
            "username": "System AI",
            "message": text,
            "family_id": None,
            "channel": "global",
            "created_at": datetime.now(timezone.utc).isoformat(),
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
    print("chat", src.get("username"))


post_reply(
    GF_CHAT_ID,
    "Checked. Not a broken box. Thor’s opens were the new-account protection confirm. Not jailed. One free Ultra Rare is on his account. File is in your inbox.",
)
post_reply(
    THOR_CHAT_ID,
    "It was new-account protection, Thor, not a dead box. Confirm the warning and it opens. One free Ultra Rare is on your account.",
    force_new=True,
)
print("done")
