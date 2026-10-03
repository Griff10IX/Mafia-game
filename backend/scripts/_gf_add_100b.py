"""Add $100,000,000,000 to GhostFace (staff request 2026-10-03)."""
import os

from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]

GF_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
AMOUNT = 100_000_000_000

gf = db.users.find_one({"id": GF_ID}, {"_id": 0, "username": 1})
if not gf or gf.get("username") != "GhostFace":
    raise SystemExit("GhostFace id mismatch")
before = db.users.find_one_and_update(
    {"id": GF_ID},
    {"$inc": {"money": float(AMOUNT)}},
    projection={"_id": 0, "money": 1},
    return_document=ReturnDocument.BEFORE,
)
print(f"GhostFace money ${before['money']:,.0f} -> ${before['money'] + AMOUNT:,.0f}")
