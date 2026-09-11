"""Charizard profile: wide banner + centered portrait in notepad, avatar set."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

PORTRAIT = "/images/profiles/charizard-portrait.png?v=2"
BANNER = "/images/profiles/charizard-banner.png?v=2"

banner_text = (
    f"[center][img]{BANNER}[/img][/center]\n\n"
    f"[center][img]{PORTRAIT}[/img][/center]\n\n"
    f"[center][color=#ff6a00][b]CHARIZARD[/b][/color][/center]\n"
    f"[center][i]Flame never sleeps.[/i][/center]"
)

r = db.users.update_one(
    {"username": {"$regex": "^Charizard$", "$options": "i"}},
    {
        "$set": {
            "avatar_url": PORTRAIT,
            "profile_banner_image_url": BANNER,
            "profile_banner_text": banner_text,
            "profile_notepad_color": "#1a0f0a",
        }
    },
)
print("ok", r.matched_count, r.modified_count)
print(db.users.find_one(
    {"username": {"$regex": "^Charizard$", "$options": "i"}},
    {"_id": 0, "avatar_url": 1, "profile_banner_text": 1},
))
