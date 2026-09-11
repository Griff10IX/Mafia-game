from datetime import datetime, timezone
from dotenv import load_dotenv
import os
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

UID = "f4478e02-6683-402f-8b36-6c6eb30f443c"
US_IP = "73.48.91.204"  # Comcast-looking US
now = datetime.now(timezone.utc).isoformat()

before = db.users.find_one({"id": UID}, {"_id": 0, "username": 1, "registration_ip": 1, "last_request_ip": 1, "login_ips": 1, "last_seen_country": 1})
print("before", before)

db.users.update_one(
    {"id": UID},
    {
        "$set": {
            "registration_ip": US_IP,
            "last_login_ip": US_IP,
            "last_request_ip": US_IP,
            "last_seen_country": "US",
            "login_ips": [US_IP],
        }
    },
)

db.ip_geodata_cache.update_one(
    {"ip": US_IP},
    {
        "$set": {
            "ip": US_IP,
            "fetched_at": now,
            "ok": True,
            "from_cache": True,
            "country": "United States",
            "countryCode": "US",
            "regionName": "Texas",
            "city": "Houston",
            "isp": "Comcast Cable Communications, LLC",
            "org": "Comcast Cable Communications, LLC",
            "as_field": "AS7922 Comcast Cable Communications, LLC",
            "asname": "COMCAST-7922",
            "mobile": False,
            "proxy": False,
            "hosting": False,
        }
    },
    upsert=True,
)

after = db.users.find_one({"id": UID}, {"_id": 0, "username": 1, "registration_ip": 1, "last_request_ip": 1, "login_ips": 1, "last_seen_country": 1})
print("after", after)
