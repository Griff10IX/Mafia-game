"""Remove the ghost Las Vegas blackjack row and unique-index city."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient
from bson.objectid import ObjectId

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

GHOST = ObjectId("6a9470430f63615f03288039")
keep = db.blackjack_ownership.find_one({"_id": ObjectId("69c80a1fd109359191da59c4")})
ghost = db.blackjack_ownership.find_one({"_id": GHOST})
print("KEEP", keep)
print("GHOST", ghost)
if not keep or not ghost:
    raise SystemExit("expected both Las Vegas rows")
if keep.get("city") != "Las Vegas" or ghost.get("city") != "Las Vegas":
    raise SystemExit("city mismatch")
if keep.get("owner_username") != "Highlights" or ghost.get("owner_username") != "Highlights":
    raise SystemExit("owner mismatch")

r = db.blackjack_ownership.delete_one({"_id": GHOST})
print("deleted", r.deleted_count)

print("\n=== Las Vegas BJ remaining ===")
for d in db.blackjack_ownership.find({"city": "Las Vegas"}):
    print(d)

print("\n=== unique city indexes ===")
for coll_name in ("dice_ownership", "roulette_ownership", "blackjack_ownership", "horseracing_ownership", "videopoker_ownership"):
    coll = db[coll_name]
    info = coll.index_information()
    city_idx = info.get("city_1") or {}
    if city_idx and not city_idx.get("unique"):
        coll.drop_index("city_1")
        print("dropped non-unique city_1 on", coll_name)
    try:
        coll.create_index("city", unique=True)
        print(coll_name, "city unique ok")
    except Exception as e:
        print(coll_name, "unique fail", e)
