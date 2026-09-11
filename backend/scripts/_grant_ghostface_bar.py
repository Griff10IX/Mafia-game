"""Grant weapon_loot_bar to GhostFace (admin). Force if cap already filled by a player."""
import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

BAR = "weapon_loot_bar"
gf = db.users.find_one(
    {"username": {"$regex": "^ghostface$", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1},
)
print("admin", gf)
uid = gf["id"]

owners = list(
    db.user_weapons.find(
        {"weapon_id": BAR, "quantity": {"$gte": 1}},
        {"_id": 0, "user_id": 1, "quantity": 1},
    )
)
for o in owners:
    u = db.users.find_one({"id": o["user_id"]}, {"_id": 0, "username": 1})
    print("owner", (u or {}).get("username"), o)

mine = db.user_weapons.find_one({"user_id": uid, "weapon_id": BAR})
if mine and int(mine.get("quantity") or 0) >= 1:
    print("already_has", mine)
else:
    now = datetime.now(timezone.utc).isoformat()
    db.user_weapons.update_one(
        {"user_id": uid, "weapon_id": BAR},
        {"$inc": {"quantity": 1}, "$set": {"acquired_at": now, "admin_grant": True}},
        upsert=True,
    )
    print("granted")

after = db.user_weapons.find_one({"user_id": uid, "weapon_id": BAR}, {"_id": 0})
print("ghostface_weapon", after)
print(
    "live_count",
    db.user_weapons.count_documents({"weapon_id": BAR, "quantity": {"$gte": 1}}),
)
