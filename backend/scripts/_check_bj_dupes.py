"""Find duplicate casino ownership rows (same city/state listed twice)."""
import os
from collections import defaultdict
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

print("=== all blackjack_ownership ===")
for d in db.blackjack_ownership.find({}, {"_id": 1, "city": 1, "owner_id": 1, "owner_username": 1, "max_bet": 1, "buy_back_reward": 1}):
    print(d)

print("\n=== duplicate city (any casino coll) ===")
for coll_name, loc_key in [
    ("dice_ownership", "city"),
    ("roulette_ownership", "city"),
    ("blackjack_ownership", "city"),
    ("horseracing_ownership", "city"),
    ("videopoker_ownership", "city"),
    ("slots_ownership", "state"),
]:
    groups = defaultdict(list)
    for d in db[coll_name].find({}, {"_id": 1, loc_key: 1, "city": 1, "state": 1, "owner_id": 1, "owner_username": 1, "max_bet": 1, "buy_back_reward": 1}):
        loc = str(d.get(loc_key) or d.get("city") or "").strip().lower()
        groups[loc].append(d)
    for loc, rows in groups.items():
        if len(rows) > 1:
            print(coll_name, loc, "count", len(rows))
            for r in rows:
                print(" ", r)

print("\n=== users with 2+ blackjack rows ===")
by_owner = defaultdict(list)
for d in db.blackjack_ownership.find({"owner_id": {"$nin": [None, ""]}}):
    by_owner[d.get("owner_id")].append(d)
for oid, rows in by_owner.items():
    if len(rows) >= 2:
        cities = [r.get("city") for r in rows]
        print(oid, rows[0].get("owner_username"), "n=", len(rows), "cities=", cities)
        for r in rows:
            print(" ", r.get("city"), "max", r.get("max_bet"), "bb", r.get("buy_back_reward"))
