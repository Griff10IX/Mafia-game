"""List ACTIVE ip_bans / bans / banned_ips for Zwischenzug lineage."""
import os
from pprint import pprint
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

PREFIX = "2a01:4b00:b605:6000"
UIDS = [
    "8e61bd9a-bc71-4abb-b490-7fbf7e33283c",  # Zwischenzug
    "8554e78f-c388-4cc2-9d47-1e505a1ade18",  # Piece
    "e40117ff-096a-46c0-8d1a-851456098a0f",  # Weiss
    "73928cc3-cfc0-4032-a6f9-67fba5c214b8",  # Intermezzo
]

print("=== banned_ips ALL ===")
for r in db.banned_ips.find({}, {"_id": 0}):
    pprint(r)

print("\n=== ip_bans ACTIVE matching prefix/uids ===")
q = {
    "active": True,
    "$or": [
        {"ip": {"$regex": f"^{PREFIX.replace(':', ':')}", "$options": "i"}},
        {"ip": PREFIX},
        {"source_user_id": {"$in": UIDS}},
        {"source_username": {"$regex": "Zwischenzug|Weiss|Intermezzo|^Piece$", "$options": "i"}},
        {"reason": {"$regex": "Zwischenzug|Weiss|Piece", "$options": "i"}},
    ],
}
hits = list(db.ip_bans.find(q, {"_id": 0}))
print("count", len(hits))
for h in hits:
    pprint(h)
    print("---")

print("\n=== bans ACTIVE for uids ===")
for r in db.bans.find({"user_id": {"$in": UIDS}, "active": True}, {"_id": 0}):
    pprint(r)

print("\n=== users banned flag ===")
for u in db.users.find({"id": {"$in": UIDS}}, {"_id": 0, "username": 1, "banned": 1, "ban_reason": 1, "account_locked": 1, "is_banned": 1}):
    pprint(u)
