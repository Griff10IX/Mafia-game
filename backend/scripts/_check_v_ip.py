from dotenv import load_dotenv
import os
from pprint import pprint
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

# Find V (exact)
users = list(db.users.find({"username": {"$regex": "^V$", "$options": "i"}}, {"_id": 0, "id": 1, "username": 1, "email": 1, "status": 1, "is_alive": 1, "alive": 1, "dead": 1, "health": 1, "registration_ip": 1, "last_login_ip": 1, "last_ip": 1, "ips": 1, "login_ips": 1, "ip_history": 1, "created_at": 1, "last_login": 1, "killed_by": 1, "killer": 1, "death": 1}))
print("=== users matching ^V$ ===")
for u in users:
    pprint({k: u.get(k) for k in ("id","username","email","status","is_alive","alive","dead","health","registration_ip","last_login_ip","last_ip","created_at","last_login","killed_by")})

# also near matches
print("\n=== usernames starting with V short ===")
for u in db.users.find({"username": {"$regex": "^V.?$", "$options": "i"}}, {"_id":0,"username":1,"id":1,"email":1}).limit(20):
    print(u)
