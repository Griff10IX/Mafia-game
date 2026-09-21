"""Who has parchment-like theme / check GhostFace theme + glow."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

for name in ("GhostFace", "Highlights"):
    u = db.users.find_one(
        {"username": {"$regex": f"^{name}$", "$options": "i"}},
        {"_id": 0, "username": 1, "profile_background_theme_id": 1, "profile_background_theme": 1,
         "profile_cosmetic_active": 1, "profile_name_glow_color": 1, "profile_border_style": 1,
         "profile_notepad_color": 1, "profile_background_custom_url": 1},
    )
    print(name, u)
