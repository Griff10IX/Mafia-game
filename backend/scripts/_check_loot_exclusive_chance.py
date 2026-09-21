"""Print live loot exclusive_chance for themes."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
# Match loot_box _get_loot_rarity_config lookup
for name in ("loot_box_rarity", "loot_rarity", "loot_box_rarity_config"):
    d = db.game_settings.find_one({"key": name}, {"_id": 0}) or db.game_settings.find_one({"id": name}, {"_id": 0})
    if d:
        print("found", name, d)

# Broad scan
rows = list(db.game_settings.find({}, {"_id": 0}))
for r in rows:
    s = str(r).lower()
    if "exclusive" in s or "loot" in s and "rarity" in s:
        print("row", r)
print("done", len(rows), "settings")
