"""Grant GhostFace (admin) all UR themes + BJ card backs without affecting loot scarcity.

Staff ownership is ignored by theme_player_claimed_live / car exclusive filters.
"""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from utils.blackjack_card_backs import ALL_BACK_IDS, OWNED_FIELD as BJ_OWNED  # noqa: E402
from utils.profile_background_themes import (  # noqa: E402
    OWNED_FIELD as THEME_OWNED,
    THEME_DISPLAY_ORDER,
    UR_LOOT_THEME_IDS,
)

UID = "36425cb4-3755-4669-b4b5-5d86345991d0"
OWNED_THEMES = list(dict.fromkeys(list(THEME_DISPLAY_ORDER) + list(UR_LOOT_THEME_IDS)))
OWNED_BACKS = list(ALL_BACK_IDS)

db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
u0 = db.users.find_one({"id": UID}, {"_id": 0, "username": 1, "profile_background_theme_id": 1})
equip = (u0 or {}).get("profile_background_theme_id")
if equip not in OWNED_THEMES:
    equip = "ur_samurai_fuji" if "ur_samurai_fuji" in OWNED_THEMES else (OWNED_THEMES[0] if OWNED_THEMES else None)

r = db.users.update_one(
    {"id": UID},
    {
        "$set": {
            THEME_OWNED: OWNED_THEMES,
            "profile_background_theme_id": equip,
            BJ_OWNED: OWNED_BACKS,
            # Do not force BJ equip — Settings tab can choose.
        }
    },
)
u = db.users.find_one(
    {"id": UID},
    {
        "_id": 0,
        "username": 1,
        "profile_background_theme_id": 1,
        THEME_OWNED: 1,
        BJ_OWNED: 1,
        "blackjack_card_back_id": 1,
    },
)
print(
    "matched",
    r.matched_count,
    "modified",
    r.modified_count,
    "themes",
    len((u or {}).get(THEME_OWNED) or []),
    "backs",
    len((u or {}).get(BJ_OWNED) or []),
    u,
)
sys.exit(0 if r.matched_count else 1)
