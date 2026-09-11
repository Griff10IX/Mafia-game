"""Set loot_new_exclusives_live = true."""
import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

now = datetime.now(timezone.utc).isoformat()
db.game_settings.update_one(
    {"key": "loot_new_exclusives_live"},
    {"$set": {"value": True, "updated_at": now}},
    upsert=True,
)
flag = db.game_settings.find_one({"key": "loot_new_exclusives_live"}, {"_id": 0})
bar = db.user_weapons.count_documents({"weapon_id": "weapon_loot_bar", "quantity": {"$gte": 1}})
arm = db.users.count_documents({"$or": [{"armour_level": {"$gte": 8}}, {"armour_owned_level_max": {"$gte": 8}}]})
pardon = db.commissioners_pardon_ownership.count_documents({"owner_id": {"$exists": True, "$nin": [None, ""]}})
print("flag", flag)
print("pool_left", {"bar": max(0, 2 - bar), "armour8": max(0, 2 - arm), "pardon": max(0, 1 - pardon)})
