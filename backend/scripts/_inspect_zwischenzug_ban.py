"""Inspect Zwischenzug ban state + linked IP bans."""
import os
from pprint import pprint
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

names = ["Zwischenzug", "Weiss", "Intermezzo", "Piece"]
users = list(db.users.find(
    {"username": {"$regex": "^(Zwischenzug|Weiss|Intermezzo|Piece)$", "$options": "i"}},
    {"_id": 0, "id": 1, "username": 1, "email": 1, "is_dead": 1, "banned": 1, "ban_reason": 1,
     "ip_banned": 1, "registration_ip": 1, "last_login_ip": 1, "last_ip": 1,
     "revive_blocked": 1, "dead_to_alive_blocked": 1, "modkill_wipe": 1, "points": 1},
))
print("=== USERS ===")
for u in users:
    pprint(u)
    print()

uids = [u["id"] for u in users if u.get("id")]
emails = list({u.get("email") for u in users if u.get("email")})
ips = set()
for u in users:
    for k in ("registration_ip", "last_login_ip", "last_ip"):
        if u.get(k):
            ips.add(str(u[k]))

print("emails", emails)
print("ips sample", list(ips)[:20])

# ban-related collections
for coll in sorted(db.list_collection_names()):
    low = coll.lower()
    if any(x in low for x in ("ban", "block", "ip_")):
        print("coll", coll)

for coll in ("banned_ips", "ip_bans", "ip_blocks", "blocked_ips", "ban_list", "bans", "blocked_revives"):
    if coll not in db.list_collection_names():
        continue
    print(f"\n=== {coll} ===")
    q = {"$or": [
        {"username": {"$regex": "Zwischenzug|Weiss|Intermezzo|Piece", "$options": "i"}},
        {"user_id": {"$in": uids}},
        {"email": {"$in": emails}} if emails else {"email": "__none__"},
    ]}
    # also search by IP prefix
    for ip in list(ips)[:5]:
        q["$or"].append({"ip": {"$regex": ip[:20]}})
        q["$or"].append({"ip_prefix": {"$regex": "2a01:4b00:b605"}})
        q["$or"].append({"cidr": {"$regex": "2a01:4b00:b605"}})
        q["$or"].append({"network": {"$regex": "2a01:4b00:b605"}})
    n = db[coll].count_documents({})
    print("total docs", n)
    hits = list(db[coll].find({"$or": [
        {"ip": {"$regex": "2a01:4b00:b605", "$options": "i"}},
        {"ip_prefix": {"$regex": "2a01:4b00:b605", "$options": "i"}},
        {"cidr": {"$regex": "2a01:4b00:b605", "$options": "i"}},
        {"network": {"$regex": "2a01:4b00:b605", "$options": "i"}},
        {"value": {"$regex": "2a01:4b00:b605", "$options": "i"}},
        {"user_id": {"$in": uids}},
        {"username": {"$regex": "Zwischenzug|Weiss|Intermezzo|Piece", "$options": "i"}},
        {"reason": {"$regex": "Zwischenzug|Weiss|Piece", "$options": "i"}},
    ]}, {"_id": 0}).limit(50))
    print("hits", len(hits))
    for h in hits[:30]:
        pprint(h)
        print("---")
