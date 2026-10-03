"""Goodwill: credit Devious +100 uncommon cars scrapped (disputed 23:33 melt, 2026-10-02)."""
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

UID = "0c439cae-1d4a-4cb7-b5ed-4e3a6d5762cf"
CREDIT = 100
MARK = "goodwill_uncommon_scrap_credit_2026_10_03"

if db.activity_log.find_one({"user_id": UID, "action": "admin_goodwill", "details.ref": MARK}):
    raise SystemExit("already credited")

before = db.users.find_one_and_update(
    {"id": UID},
    {"$inc": {"uncommon_cars_scrapped": CREDIT}},
    projection={"_id": 0, "username": 1, "uncommon_cars_scrapped": 1},
    return_document=ReturnDocument.BEFORE,
)
db.activity_log.insert_one(
    {
        "id": str(uuid.uuid4()),
        "user_id": UID,
        "username": before.get("username"),
        "action": "admin_goodwill",
        "details": {"ref": MARK, "uncommon_cars_scrapped": CREDIT, "reason": "disputed melt did not count toward mission"},
        "created_at": datetime.now(timezone.utc),
    }
)
print(before.get("username"), before.get("uncommon_cars_scrapped"), "->", int(before.get("uncommon_cars_scrapped") or 0) + CREDIT)
