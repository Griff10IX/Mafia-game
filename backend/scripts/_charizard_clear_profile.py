"""Clear Charizard profile banner/avatar artwork."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

r = db.users.update_one(
    {"username": {"$regex": "^Charizard$", "$options": "i"}},
    {
        "$unset": {
            "avatar_url": "",
            "profile_banner_image_url": "",
            "profile_banner_text": "",
            "profile_notepad_color": "",
        }
    },
)
print("matched", r.matched_count, "modified", r.modified_count)
print(
    db.users.find_one(
        {"username": {"$regex": "^Charizard$", "$options": "i"}},
        {"_id": 0, "username": 1, "avatar_url": 1, "profile_banner_text": 1, "profile_banner_image_url": 1},
    )
)
