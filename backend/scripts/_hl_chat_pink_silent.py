"""Set Highlights chat name pink. No chat, no restart."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

HL_ID = "ff620eef-283a-4016-a172-d33854bcee7b"
PINK = "#FF10F0"

u = db.users.find_one_and_update(
    {"id": HL_ID},
    {"$set": {"chat_name_color": PINK}},
    projection={"_id": 0, "username": 1, "chat_name_color": 1},
)
print("user", u)
upd = db.game_chat_messages.update_many(
    {"user_id": HL_ID},
    {"$set": {"author_online_color": PINK}},
)
print("msgs_matched", upd.matched_count, "modified", upd.modified_count)
check = db.users.find_one({"id": HL_ID}, {"_id": 0, "username": 1, "chat_name_color": 1})
print("confirm", check)
print("done")
