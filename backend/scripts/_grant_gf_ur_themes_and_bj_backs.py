"""Grant GhostFace (admin) all UR themes + BJ card backs without affecting loot scarcity.

Staff ownership is ignored by theme_player_claimed_live (GhostFace UID always $nin'd).
Card backs have no world cap — ownership is per-player only.
"""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

# Prefer live server env when present; fall back to local backend/.env
for env_path in ("/opt/mafia-app/backend/.env", os.path.join(BACKEND_DIR, ".env")):
    if os.path.isfile(env_path):
        load_dotenv(env_path)
        break

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

# Sync scarcity check: GhostFace must not consume any UR theme slot.
available = []
for tid in UR_LOOT_THEME_IDS:
    n = db.users.count_documents({THEME_OWNED: tid, "id": {"$nin": [UID]}})
    if n < 1:
        available.append(tid)

print(
    "matched",
    r.matched_count,
    "modified",
    r.modified_count,
    "themes",
    len((u or {}).get(THEME_OWNED) or []),
    "backs",
    len((u or {}).get(BJ_OWNED) or []),
    "ur_pool_available",
    len(available),
    "/",
    len(UR_LOOT_THEME_IDS),
    u,
)
sys.exit(0 if r.matched_count and len(available) == len(UR_LOOT_THEME_IDS) else 1)
