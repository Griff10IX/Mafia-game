"""One-shot: grant GhostFace all profile background themes."""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from utils.profile_background_themes import THEME_DISPLAY_ORDER  # noqa: E402

UID = "36425cb4-3755-4669-b4b5-5d86345991d0"
OWNED = list(THEME_DISPLAY_ORDER)
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
u0 = db.users.find_one({"id": UID}, {"_id": 0, "profile_background_theme_id": 1})
equip = (u0 or {}).get("profile_background_theme_id")
if equip not in OWNED:
    equip = "halloween_heist"
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
