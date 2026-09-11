"""Reclaim GhostFace BAR / Brewster / Pardon into the loot pool (caps are 1 each)."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

GF = "GhostFace"
BAR = "weapon_loot_bar"

u = db.users.find_one({"username": {"$regex": f"^{GF}$", "$options": "i"}}, {"_id": 0, "id": 1, "username": 1, "armour_level": 1, "armour_owned_level_max": 1, "profile_weapon_id": 1})
print("user", u)
if not u:
    raise SystemExit(1)
uid = u["id"]

bar = db.user_weapons.find_one({"user_id": uid, "weapon_id": BAR, "quantity": {"$gte": 1}})
if bar:
    db.user_weapons.update_one({"user_id": uid, "weapon_id": BAR}, {"$inc": {"quantity": -1}})
    db.users.update_one(
        {"id": uid, "profile_weapon_id": BAR},
        {"$unset": {"profile_weapon_id": "", "profile_show_weapon": ""}},
    )
    print("reclaimed_bar")
else:
    print("no_bar")

owned_max = int(u.get("armour_owned_level_max") or u.get("armour_level") or 0)
if owned_max >= 8:
    db.users.update_one({"id": uid}, {"$set": {"armour_level": 7, "armour_owned_level_max": 7}})
    print("reclaimed_brewster_to_l7")
else:
    print("no_brewster", owned_max)

# Pardon reclaim
p = db.commissioners_pardon_ownership.find_one({})
print("pardon_before", p)
db.commissioners_pardon_ownership.delete_many({})
db.users.update_one(
    {"id": uid},
    {
        "$unset": {
            "has_commissioners_pardon": "",
            "pardon_auto_skip_mission_ids": "",
            "pardon_near_finish_mission_id": "",
        }
    },
)
print("reclaimed_pardon")

bar_n = db.user_weapons.count_documents({"weapon_id": BAR, "quantity": {"$gte": 1}})
arm_n = db.users.count_documents({"$or": [{"armour_level": {"$gte": 8}}, {"armour_owned_level_max": {"$gte": 8}}]})
pardon_n = db.commissioners_pardon_ownership.count_documents({"owner_id": {"$exists": True, "$nin": [None, ""]}})
print("pool", {"bar_claimed": bar_n, "armour8_claimed": arm_n, "pardon_claimed": pardon_n, "caps": "1/1/1"})
flag = db.game_settings.find_one({"key": "loot_new_exclusives_live"}, {"_id": 0})
print("live_flag", flag)
