"""One-off: grant GhostFace 14,000 random non-special garage cars."""
import random
import uuid
from collections import Counter
from datetime import datetime, timezone

from _system_ai_prank_helpers import db, GHOSTFACE_ID

N = 14000
POOL = [
    {"id": "car1", "name": "Model T Ford", "rarity": "common"},
    {"id": "car5", "name": "Essex Coach", "rarity": "common"},
    {"id": "car2", "name": "Chevrolet Series AB", "rarity": "common"},
    {"id": "car6", "name": "Durant Star", "rarity": "common"},
    {"id": "car4", "name": "Ford Model A", "rarity": "common"},
    {"id": "car3", "name": "Dodge Brothers", "rarity": "common"},
    {"id": "car7", "name": "Oakland", "rarity": "uncommon"},
    {"id": "car8", "name": "Willys-Knight", "rarity": "uncommon"},
    {"id": "car10", "name": "Buick Master Six", "rarity": "uncommon"},
    {"id": "car9", "name": "Cadillac V-8", "rarity": "uncommon"},
    {"id": "car11", "name": "Packard Eight", "rarity": "rare"},
    {"id": "car12", "name": "Lincoln Model L", "rarity": "rare"},
    {"id": "car13", "name": "Pierce-Arrow", "rarity": "rare"},
    {"id": "car14", "name": "Stutz Bearcat", "rarity": "rare"},
    {"id": "car15", "name": "Duesenberg Model J", "rarity": "ultra_rare"},
    {"id": "car16", "name": "Cord L-29", "rarity": "ultra_rare"},
    {"id": "car17", "name": "Auburn Speedster", "rarity": "ultra_rare"},
    {"id": "car18", "name": "Bugatti Type 41 Royale", "rarity": "legendary"},
    {"id": "car19", "name": "Rolls-Royce Phantom II", "rarity": "legendary"},
]

u = db.users.find_one({"id": GHOSTFACE_ID}, {"_id": 0, "id": 1, "username": 1})
if not u:
    u = db.users.find_one({"username": "GhostFace"}, {"_id": 0, "id": 1, "username": 1})
if not u:
    raise SystemExit("GhostFace not found")
uid = u["id"]
before = db.user_cars.count_documents({"user_id": uid})
now = datetime.now(timezone.utc).isoformat()
rng = random.SystemRandom()
docs = []
rarities = Counter()
for _ in range(N):
    car = rng.choice(POOL)
    rarities[car["rarity"]] += 1
    docs.append(
        {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "car_id": car["id"],
            "car_name": car["name"],
            "acquired_at": now,
            "damage_percent": 0,
        }
    )

BATCH = 1000
inserted = 0
for i in range(0, len(docs), BATCH):
    res = db.user_cars.insert_many(docs[i : i + BATCH], ordered=False)
    inserted += len(res.inserted_ids)

after = db.user_cars.count_documents({"user_id": uid})
print("user", u.get("username"), uid)
print("granted", inserted, "mix", dict(rarities))
print("garage before", before, "after", after, "delta", after - before)
