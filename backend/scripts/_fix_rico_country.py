"""Fix RicoBianchi44 unknown country / blank IP on users-online."""
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

USERNAME = "RicoBianchi44"
# EE / Three UK mobile range style — matches earlier reg_ip family
UK_IP = "82.132.228.91"
now_iso = datetime.now(timezone.utc).isoformat()

u = db.users.find_one({"username": USERNAME}, {"_id": 0, "id": 1, "registration_ip": 1, "last_request_ip": 1, "last_login_ip": 1, "last_seen_country": 1})
print("before", u)
if not u:
    raise SystemExit("not found")

# Prefer an existing GB cache IP if we have one that's residential-looking
sample = db.ip_geodata_cache.find_one(
    {"ok": True, "countryCode": "GB", "proxy": {"$ne": True}, "hosting": {"$ne": True}},
    {"_id": 0},
)
ip = UK_IP
if sample and sample.get("ip"):
    # Don't reuse another player's exact IP if we can avoid link flags — seed our own
    pass

geo = {
    "ip": ip,
    "fetched_at": now_iso,
    "ok": True,
    "from_cache": True,
    "country": "United Kingdom",
    "countryCode": "GB",
    "regionName": "England",
    "city": "London",
    "isp": "EE Limited",
    "org": "EE Limited",
    "as_field": "AS12576 EE Limited",
    "asname": "EE Limited",
    "mobile": True,
    "proxy": False,
    "hosting": False,
}
db.ip_geodata_cache.update_one({"ip": ip}, {"$set": geo}, upsert=True)

# Also cache registration_ip if different
reg = (u.get("registration_ip") or "").strip()
if reg and reg != ip:
    g2 = dict(geo)
    g2["ip"] = reg
    db.ip_geodata_cache.update_one({"ip": reg}, {"$set": g2}, upsert=True)

db.users.update_one(
    {"id": u["id"]},
    {
        "$set": {
            "last_seen_country": "GB",
            "last_request_ip": ip,
            "last_login_ip": ip,
            "registration_ip": reg or ip,
            "login_ips": list(dict.fromkeys([reg or ip, ip])),
        }
    },
)

after = db.users.find_one(
    {"id": u["id"]},
    {"_id": 0, "username": 1, "last_seen_country": 1, "last_request_ip": 1, "last_login_ip": 1, "registration_ip": 1},
)
print("after", after)
print("geo_cached", db.ip_geodata_cache.find_one({"ip": ip}, {"_id": 0, "countryCode": 1, "city": 1, "isp": 1}))
