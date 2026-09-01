"""Print slot-4 owner username + guard user username only."""
import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

for name in ("Highlights", "Schizophrenic"):
    u = db.users.find_one({"username": {"$regex": f"^{name}$", "$options": "i"}}, {"_id": 0, "id": 1, "username": 1})
    bg = db.bodyguards.find_one({"user_id": u["id"], "slot_number": 4}, {"_id": 0})
    gid = (bg or {}).get("bodyguard_user_id")
    g = db.users.find_one({"id": gid}, {"_id": 0, "username": 1}) if gid else None
    print(u["username"], "slot4_username", (g or {}).get("username"), "robot_name", (bg or {}).get("robot_name"), "bg_username", (bg or {}).get("bodyguard_username"))
