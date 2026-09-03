"""Who else is near/at 100 missions besides the size>=100 query."""
import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

sys.path.insert(0, "/opt/mafia-app/backend")
from utils.missions_extended import build_missions

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

missions = build_missions()
last_id = sorted(missions, key=lambda m: m.get("order", 0))[-1]["id"]
print("last", last_id, sorted(missions, key=lambda m: m.get("order", 0))[-1].get("title"))

ids = {m["id"] for m in missions}

# anyone with last mission
rows = list(
    db.users.find(
        {"mission_completions.mission_id": last_id, "is_npc": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "mission_completions": 1},
    )
)
print("have last mission", len(rows))
for u in rows:
    comp = {r.get("mission_id") for r in (u.get("mission_completions") or []) if r.get("mission_id")}
    print(" last", u.get("username"), "n", len(comp), "all100", ids.issubset(comp))

# high counts even if missing last
pipe = [
    {"$match": {"is_npc": {"$ne": True}, "is_bodyguard": {"$ne": True}}},
    {"$project": {"username": 1, "n": {"$size": {"$ifNull": ["$mission_completions", []]}}}},
    {"$match": {"n": {"$gte": 80}}},
    {"$sort": {"n": -1}},
]
print("n>=80")
for r in db.users.aggregate(pipe):
    print(" ", r.get("username"), r.get("n"))
