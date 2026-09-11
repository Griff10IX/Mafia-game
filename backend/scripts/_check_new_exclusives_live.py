"""Check loot_new_exclusives_live + ownership caps."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

flag = db.game_settings.find_one({"key": "loot_new_exclusives_live"}, {"_id": 0})
print("flag", flag)

bar = db.user_weapons.count_documents({"weapon_id": "weapon_loot_bar", "quantity": {"$gte": 1}})
arm = db.users.count_documents({"$or": [{"armour_level": {"$gte": 8}}, {"armour_owned_level_max": {"$gte": 8}}]})
pardon = db.commissioners_pardon_ownership.count_documents({"owner_id": {"$exists": True, "$nin": [None, ""]}})
pdoc = db.commissioners_pardon_ownership.find_one({}, {"_id": 0, "owner_id": 1})
owner = None
if pdoc and pdoc.get("owner_id"):
    u = db.users.find_one({"id": pdoc["owner_id"]}, {"_id": 0, "username": 1})
    owner = (u or {}).get("username")
print({"bar": f"{bar}/2", "armour8": f"{arm}/2", "pardon": f"{pardon}/1", "pardon_owner": owner, "live": bool((flag or {}).get("value"))})
