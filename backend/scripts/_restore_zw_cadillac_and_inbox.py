"""Restore Zwischenzug car20 + send System AI inbox to him and GhostFace."""
import os
import uuid
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

ZW_ID = "8e61bd9a-bc71-4abb-b490-7fbf7e33283c"
GF_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
CAR_ID = "car20"
CAR_NAME = "Al Capone's Armored Cadillac"
TITLE = "Garage records — Cadillac restored"
BODY = (
    "Zwischenzug,\n\n"
    "This is the system AI. I checked your garage melt logs and car files.\n\n"
    "The loot-exclusive Cadillac was melted from your garage. That was your melt, "
    "not a code mistake, so it cannot be returned. It has already gone back into the loot pool.\n\n"
    "Al Capone's Armored Cadillac was knocked out of your garage by an update. "
    "That one has been restored to you.\n\n"
    "— System AI"
)
AVATAR = "/images/system-ai-avatar.png"

now_iso = datetime.now(timezone.utc).isoformat()
cut = (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()

zw = db.users.find_one({"id": ZW_ID}, {"_id": 0, "id": 1, "username": 1})
gf = db.users.find_one({"id": GF_ID}, {"_id": 0, "id": 1, "username": 1})
print("ZW", zw)
print("GF", gf)
if not zw or not gf:
    raise SystemExit("missing user")

existing = db.user_cars.find_one({"user_id": ZW_ID, "car_id": CAR_ID}, {"_id": 0, "id": 1})
if existing:
    print("ZW already has car20", existing.get("id"))
    ucid = existing.get("id")
else:
    ucid = str(uuid.uuid4())
    db.user_cars.insert_one(
        {
            "id": ucid,
            "user_id": ZW_ID,
            "car_id": CAR_ID,
            "car_name": CAR_NAME,
            "acquired_at": now_iso,
        }
    )
    db.exclusive_car_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "at": now_iso,
            "event_type": "admin_grant",
            "car_id": CAR_ID,
            "user_car_id": ucid,
            "previous_user_car_id": None,
            "from_user_id": None,
            "from_username": None,
            "to_user_id": ZW_ID,
            "to_username": zw.get("username"),
            "price": None,
            "car_name": CAR_NAME,
            "extra": {"source": "system_ai_restore"},
        }
    )
    n = db.user_cars.count_documents({"car_id": CAR_ID})
    db.game_config.update_one(
        {"id": "gta_exclusive"},
        {"$set": {"released": n == 0}},
        upsert=True,
    )
    print("granted car20", ucid, "car20_count", n)


def send_to(uid, username):
    already = db.notifications.find_one(
        {"user_id": uid, "title": TITLE, "created_at": {"$gte": cut}},
        {"_id": 0, "id": 1},
    )
    if already:
        print("inbox already sent", username, already.get("id"))
        return already.get("id")
    nid = str(uuid.uuid4())
    db.notifications.insert_one(
        {
            "id": nid,
            "user_id": uid,
            "title": TITLE,
            "message": BODY,
            "notification_type": "system",
            "read": False,
            "created_at": now_iso,
            "avatar_url": AVATAR,
            "gif_url": AVATAR,
        }
    )
    print("inbox sent", username, nid)
    return nid


send_to(ZW_ID, zw.get("username"))
send_to(GF_ID, gf.get("username"))
print("done")
