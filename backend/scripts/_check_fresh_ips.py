import os
from dotenv import load_dotenv
from pymongo import MongoClient
load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
for name in ("VinceConti37", "SonnyEsposito"):
    u = db.users.find_one({"username": name}, {"_id": 0, "username": 1, "registration_ip": 1})
    print(u)
