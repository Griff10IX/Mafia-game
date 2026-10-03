"""Read-only: Devious garage, catalog rarity vs stored rarity (does the UI mislabel uncommons?)."""
import os
import sys
from collections import Counter

sys.path.insert(0, "/opt/mafia-app/backend")
os.chdir("/opt/mafia-app/backend")
import server  # noqa: F401
from server import CARS
from pymongo import MongoClient

db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
UID = "0c439cae-1d4a-4cb7-b5ed-4e3a6d5762cf"
by_id = {c["id"]: c for c in CARS}
print("catalog uncommon:", [(c["id"], c["name"], c["value"]) for c in CARS if c.get("rarity") == "uncommon"])

cat = Counter()
mismatch = Counter()
for d in db.user_cars.find({"user_id": UID}, {"_id": 0, "car_id": 1, "rarity": 1}):
    info = by_id.get(str(d.get("car_id")))
    cr = (info or {}).get("rarity", "?")
    cat[(cr, (info or {}).get("name", d.get("car_id")))] += 1
    if d.get("rarity") and d.get("rarity") != cr:
        mismatch[(d.get("car_id"), d.get("rarity"), cr)] += 1
print("garage now:", sorted(cat.items(), key=lambda x: -x[1])[:15])
print("stored-vs-catalog mismatches:", mismatch.most_common(10))
