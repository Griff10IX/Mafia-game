"""Look up slot-4 bodyguard visible name only."""
import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

names = [a.strip() for a in sys.argv[1:] if a.strip()]
if not names:
    raise SystemExit("need usernames")

for name in names:
    u = db.users.find_one(
        {"username": {"$regex": f"^{name}$", "$options": "i"}, "is_dead": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1},
    )
    if not u:
        print(name, "NO_USER")
        continue
    bg = db.bodyguards.find_one(
        {"user_id": u["id"], "slot_number": 4},
        {"_id": 0, "slot_number": 1, "bodyguard_username": 1, "robot_name": 1, "bodyguard_user_id": 1, "is_robot": 1},
    )
    vis = None
    if bg:
        vis = (bg.get("bodyguard_username") or "").strip() or None
        if not vis and bg.get("bodyguard_user_id"):
            g = db.users.find_one({"id": bg["bodyguard_user_id"]}, {"_id": 0, "username": 1})
            vis = (g or {}).get("username")
        if not vis:
            vis = (bg.get("robot_name") or "").strip() or None
    print(u.get("username"), "SLOT4", vis or "NONE")
