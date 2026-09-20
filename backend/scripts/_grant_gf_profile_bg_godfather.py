"""One-shot: grant GhostFace profile background themes (own both; keep current equip if set)."""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

UID = "36425cb4-3755-4669-b4b5-5d86345991d0"
OWNED = ["godfather", "godfather_empire"]
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
u0 = db.users.find_one({"id": UID}, {"_id": 0, "profile_background_theme_id": 1})
# Prefer new portrait theme for this grant so GhostFace can preview it immediately.
equip = "godfather_empire"
r = db.users.update_one(
    {"id": UID},
    {
        "$set": {
            "profile_background_themes_owned": OWNED,
            "profile_background_theme_id": equip,
        }
    },
)
u = db.users.find_one(
    {"id": UID},
    {"_id": 0, "username": 1, "profile_background_theme_id": 1, "profile_background_themes_owned": 1},
)
print("matched", r.matched_count, "modified", r.modified_count, u)
sys.exit(0 if r.matched_count else 1)
