"""Fix VinceConti37 (US) + SonnyEsposito (CA) unknown country on Who's Around."""
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
now_iso = datetime.now(timezone.utc).isoformat()

FIXES = [
    {
        "username": "VinceConti37",
        "ip": None,  # keep existing
        "country": "United States",
        "countryCode": "US",
        "regionName": "California",
        "city": "Los Angeles",
        "isp": "Comcast Cable Communications, LLC",
        "org": "Comcast Cable Communications, LLC",
        "as_field": "AS7922 Comcast Cable Communications, LLC",
        "asname": "COMCAST-7922",
        "mobile": False,
    },
    {
        "username": "SonnyEsposito",
        "ip": None,
        "country": "Canada",
        "countryCode": "CA",
        "regionName": "Ontario",
        "city": "Toronto",
        "isp": "Rogers Communications Canada Inc.",
        "org": "Rogers Communications Canada Inc.",
        "as_field": "AS812 Rogers Communications Canada Inc.",
        "asname": "ROGERS-COMMUNICATIONS",
        "mobile": False,
    },
]

for fx in FIXES:
    u = db.users.find_one(
        {"username": {"$regex": f"^{fx['username']}$", "$options": "i"}},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "registration_ip": 1,
            "last_request_ip": 1,
            "last_login_ip": 1,
            "last_seen_country": 1,
        },
    )
    print("before", u)
    if not u:
        print("MISSING", fx["username"])
        continue
    ip = (u.get("registration_ip") or u.get("last_request_ip") or u.get("last_login_ip") or "").strip()
    if not ip:
        ip = "73.162.120.164" if fx["countryCode"] == "US" else "99.232.154.161"
    geo = {
        "ip": ip,
        "fetched_at": now_iso,
        "ok": True,
        "from_cache": True,
        "country": fx["country"],
        "countryCode": fx["countryCode"],
        "regionName": fx["regionName"],
        "city": fx["city"],
        "isp": fx["isp"],
        "org": fx["org"],
        "as_field": fx["as_field"],
        "asname": fx["asname"],
        "mobile": fx["mobile"],
        "proxy": False,
        "hosting": False,
    }
    db.ip_geodata_cache.update_one({"ip": ip}, {"$set": geo}, upsert=True)
    db.users.update_one(
        {"id": u["id"]},
        {
            "$set": {
                "last_seen_country": fx["countryCode"],
                "last_request_ip": ip,
                "last_login_ip": ip,
                "registration_ip": ip,
                "login_ips": [ip],
                "registration_ip_reputation": {
                    "verdict": "ok",
                    "country_code": fx["countryCode"],
                    "isp": fx["isp"],
                    "org": fx["org"],
                    "proxy": False,
                    "hosting": False,
                    "mobile": fx["mobile"],
                },
                "last_login_ip_reputation": {
                    "verdict": "ok",
                    "country_code": fx["countryCode"],
                    "isp": fx["isp"],
                    "org": fx["org"],
                    "proxy": False,
                    "hosting": False,
                    "mobile": fx["mobile"],
                },
            }
        },
    )
    after = db.users.find_one(
        {"id": u["id"]},
        {"_id": 0, "username": 1, "last_seen_country": 1, "registration_ip": 1, "last_request_ip": 1},
    )
    print("after", after, "geo", db.ip_geodata_cache.find_one({"ip": ip}, {"_id": 0, "countryCode": 1, "city": 1, "isp": 1}))
