"""One-off: flip every store item rollout flag to live (staff preview -> everyone).

Run from repo root: python backend/seeds/enable_all_store_item_flags.py
Reads MONGO_URL / DB_NAME from backend/.env. Safe to re-run.
"""
import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, BACKEND_DIR)
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from utils.store_item_flags import STORE_ITEM_FLAG_DEFAULTS  # noqa: E402


def run():
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("Set MONGO_URL and DB_NAME in backend/.env")
        return
    client = MongoClient(mongo_url)
    db = client[db_name]
    doc = db.game_settings.find_one({"_id": "main"}, {"store_item_flags": 1}) or {}
    before = doc.get("store_item_flags") or {}
    print("Before:")
    for k in STORE_ITEM_FLAG_DEFAULTS:
        print(f"  {k}: {before.get(k, False)}")
    update = {f"store_item_flags.{k}": True for k in STORE_ITEM_FLAG_DEFAULTS}
    res = db.game_settings.update_one({"_id": "main"}, {"$set": update}, upsert=True)
    print(f"\nSet {len(update)} flags to live (matched={res.matched_count}, modified={res.modified_count}).")
    after = (db.game_settings.find_one({"_id": "main"}, {"store_item_flags": 1}) or {}).get("store_item_flags") or {}
    print("After:")
    for k in STORE_ITEM_FLAG_DEFAULTS:
        print(f"  {k}: {after.get(k, False)}")
    client.close()


if __name__ == "__main__":
    run()
