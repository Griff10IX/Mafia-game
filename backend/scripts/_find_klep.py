from dotenv import load_dotenv
import os
from pprint import pprint
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

for u in db.users.find({"username": {"$regex": "^klep", "$options": "i"}}, {"_id": 0, "id": 1, "username": 1, "email": 1, "registration_ip": 1, "last_login_ip": 1, "last_request_ip": 1, "login_ips": 1, "last_seen_country": 1}):
    pprint(u)
