"""Verify live BJ duplicate fix: data, unique index, claim code."""
import os
import re
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

print("=== Las Vegas blackjack rows ===")
lv = list(db.blackjack_ownership.find({"city": re.compile("^Las Vegas$", re.I)}))
print("count", len(lv))
for d in lv:
    print(d.get("owner_username"), "max", d.get("max_bet"), "bb", d.get("buy_back_reward"), "id", d.get("_id"))

print("\n=== city unique indexes ===")
for coll_name in ("dice_ownership", "roulette_ownership", "blackjack_ownership", "horseracing_ownership", "videopoker_ownership"):
    info = db[coll_name].index_information()
    city_idx = info.get("city_1") or {}
    print(coll_name, "unique=", bool(city_idx.get("unique")), "keys", city_idx.get("key"))

print("\n=== duplicate cities remaining ===")
from collections import defaultdict
for coll_name in ("dice_ownership", "roulette_ownership", "blackjack_ownership", "horseracing_ownership", "videopoker_ownership"):
    groups = defaultdict(int)
    for d in db[coll_name].find({}, {"city": 1}):
        groups[str(d.get("city") or "").strip().lower()] += 1
    dups = {k: v for k, v in groups.items() if v > 1}
    print(coll_name, dups or "none")

files = [
    "/opt/mafia-app/backend/routers/casinos/blackjack.py",
    "/opt/mafia-app/backend/routers/casinos/dice.py",
    "/opt/mafia-app/backend/routers/casinos/roulette.py",
    "/opt/mafia-app/backend/routers/casinos/horseracing.py",
    "/opt/mafia-app/backend/routers/casinos/video_poker.py",
    "/opt/mafia-app/backend/server.py",
]
print("\n=== claim helper on live ===")
for path in files:
    with open(path, encoding="utf-8") as f:
        txt = f.read()
    print(path.split("/")[-1], "claim_unowned_city_casino" in txt, "already_owned" in txt)

bj = open("/opt/mafia-app/backend/routers/casinos/blackjack.py", encoding="utf-8").read()
print("old claim upsert present", '{"city": stored_city or city, "owner_id": None}' in bj)
