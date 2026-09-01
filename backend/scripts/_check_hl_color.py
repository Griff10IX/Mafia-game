"""Inspect Highlights chat-colour fields."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

u = db.users.find_one(
    {"id": "ff620eef-283a-4016-a172-d33854bcee7b"},
    {
        "_id": 0,
        "username": 1,
        "is_moderator": 1,
        "is_entertainer": 1,
        "is_help_desk_operator": 1,
        "email": 1,
        "mod_online_color": 1,
        "entertainer_online_color": 1,
        "hdo_online_color": 1,
        "chat_name_color": 1,
        "profile_name_glow_color": 1,
        "profile_cosmetic_active": 1,
    },
)
print(u)
last = db.game_chat_messages.find_one(
    {"user_id": "ff620eef-283a-4016-a172-d33854bcee7b"},
    {"_id": 0, "author_online_color": 1, "message": 1, "created_at": 1},
    sort=[("created_at", -1)],
)
print("last_msg", last)
