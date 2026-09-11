"""Oblivion bridge: Matt emails + TNT IP."""
from __future__ import annotations

import os
import re
from collections import Counter

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

print("=== emails matching matt/fenlon ===")
for u in db.users.find(
    {"email": {"$regex": "matt|fenlon", "$options": "i"}},
    {"_id": 0, "username": 1, "email": 1, "is_dead": 1, "registration_ip": 1, "id": 1, "created_at": 1},
).limit(30):
    print(u)

OB = "399d8bf9-8ff6-4825-8ee1-d3998d9ba4f4"  # Bruno was this - wait Oblivion
ob = db.users.find_one({"username": "Oblivion"}, {"_id": 0})
print("\nOblivion full ids", ob.get("id") if ob else None)
OID = ob["id"] if ob else None
SCHIZO = "828d4094-7095-4007-bb4e-9d8c25c7bc8f"
TNT = "5bd4e12d-2919-44c3-bf29-dbdd522b6fea"
BRUNO = "399d8bf9-8ff6-4825-8ee1-d3998d9ba4f4"

print("\n=== Bruno email ===")
print(db.users.find_one({"id": BRUNO}, {"_id": 0, "username": 1, "email": 1, "registration_ip": 1, "last_request_ip": 1}))

print("\n=== attack IPs Oblivion ===")
if OID:
    c = Counter()
    for row in db.attack_attempts.find({"attacker_id": OID}, {"attacker_ip": 1}).limit(2000):
        if row.get("attacker_ip"):
            c[row["attacker_ip"]] += 1
    print(c.most_common(10))

    # shared with schizo / tnt
    sc = Counter()
    for row in db.attack_attempts.find({"attacker_id": SCHIZO}, {"attacker_ip": 1}).limit(3000):
        if row.get("attacker_ip"):
            sc[row["attacker_ip"]] += 1
    tc = Counter()
    for row in db.attack_attempts.find({"attacker_id": TNT}, {"attacker_ip": 1}).limit(2000):
        if row.get("attacker_ip"):
            tc[row["attacker_ip"]] += 1
    print("Oblivion & Schizo shared", set(c) & set(sc) or "NONE")
    print("Oblivion & TNT shared", set(c) & set(tc) or "NONE")
    print("Schizo & TNT shared", set(sc) & set(tc) or "NONE")

print("\n=== points Oblivion <-> Schizo/TNT ===")
if OID:
    for r in db.points_transfers.find(
        {
            "$or": [
                {"from_user_id": OID, "to_user_id": {"$in": [SCHIZO, TNT]}},
                {"to_user_id": OID, "from_user_id": {"$in": [SCHIZO, TNT]}},
            ]
        },
        {"_id": 0, "created_at": 1, "from_username": 1, "to_username": 1, "amount": 1},
    ).sort("created_at", -1).limit(20):
        print(r)

print("\n=== verdict helpers: same /64 schizo+bruno ===")
# already know same ipv6 prefix 2a02:c7c:a643:a100
print("Schizo+Bruno share 2a02:c7c:a643:a100 — likely same household/person")
print("TNT never on that IPv6; TNT only 82.132 EE mobile")
print("Schizo sometimes on 82.132.222 — same carrier class as TNT but not same IP")
