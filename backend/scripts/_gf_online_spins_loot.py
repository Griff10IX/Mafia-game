"""GhostFace: 5 WoF spins + 1000 loot pieces to everyone currently online."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

SPINS = 5
LOOT = 1000
ORIGIN = "system_ai_gf_online_spins_loot"
AVATAR = "/images/system-ai-avatar.png"
now = datetime.now(timezone.utc)
now_iso = now.isoformat()
idle_cutoff = (now - timedelta(minutes=10)).isoformat()

filt = {
    "is_dead": {"$ne": True},
    "is_npc": {"$ne": True},
    "is_bodyguard": {"$ne": True},
    "id": {"$exists": True, "$nin": ["", None]},
    "$or": [
        {"last_seen": {"$gte": idle_cutoff}},
        {"forced_online_until": {"$gt": now_iso}},
        {"$and": [{"auto_rank_enabled": True}, {"auto_rank_idle": {"$ne": True}}]},
    ],
}
users = list(db.users.find(filt, {"_id": 0, "id": 1, "username": 1, "loot_box_pieces": 1, "wheel_bonus_free_spins": 1}))
print("online", len(users))

credited = []
for u in users:
    uid = u.get("id")
    name = (u.get("username") or "").strip()
    if not uid or not name or name.lower() == "system ai":
        continue
    already = db.point_ledger_events.find_one({"user_id": uid, "origin_ref": ORIGIN}, {"_id": 0, "id": 1})
    if already:
        print("already", name)
        credited.append(name)
        continue
    db.users.update_one(
        {"id": uid},
        {"$inc": {"wheel_bonus_free_spins": SPINS, "loot_box_pieces": LOOT}},
    )
    db.point_ledger_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "event_type": "system_ai_gf_online_bonus",
            "user_id": uid,
            "points": 0,
            "lot_id": None,
            "origin_ref": ORIGIN,
            "root_purchase_ref": None,
            "meta": {"wheel_bonus_free_spins": SPINS, "loot_box_pieces": LOOT, "reason": "ghostface_online_after_restart"},
            "created_at": now_iso,
            "source": "system_ai",
        }
    )
    db.notifications.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "title": "Online bonus",
            "message": (
                f"{name},\n\n"
                "This is the system AI.\n\n"
                "GhostFace said everyone online gets 5 Wheel of Fortune spins and 1,000 loot pieces. "
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
    print("credited", name)

credited = sorted(set(credited), key=str.lower)
print("NAMES", ", ".join(credited))
chat_text = (
    "Restart is through. GhostFace said 5 Wheel spins and 1,000 loot pieces to everyone online. "
    "Sent to: " + ", ".join(credited) + "."
)
already_chat = db.game_chat_messages.find_one({"user_id": "system_ai", "message": chat_text, "channel": "global"}, {"_id": 0, "id": 1})
if already_chat:
    print("chat already")
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
            "id": "12bb1c03-3617-43a9-be0c-f3f7e028252c",
            "username": "GhostFace",
            "message": "@system after the restart give everyone online 5 free wheel of fotune spins and 1000 loot pieces",
            "has_gif": False,
        },
    }
    db.game_chat_messages.insert_one(doc)
    print("chat posted", doc["id"])
print("done")
