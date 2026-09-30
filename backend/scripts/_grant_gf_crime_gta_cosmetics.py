"""Grant GhostFace all Crimes/GTA cosmetic themes + BJ backs (1 sellable copy each).

Sync pymongo (same pattern as _grant_gf_ur_themes_and_bj_backs.py).
Does not touch UR loot scarcity. Re-run adds another inventory copy of each.
"""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

for env_path in ("/opt/mafia-app/backend/.env", os.path.join(BACKEND_DIR, ".env")):
    if os.path.isfile(env_path):
        load_dotenv(env_path)
        break

from utils.blackjack_card_backs import (  # noqa: E402
    CRIME_GTA_COSMETIC_BACK_IDS,
    OWNED_FIELD as BJ_OWNED,
)
from utils.crime_gta_cosmetics import (  # noqa: E402
    BACK_INVENTORY_FIELD,
    THEME_INVENTORY_FIELD,
)
from utils.profile_background_themes import (  # noqa: E402
    CRIME_GTA_COSMETIC_THEME_IDS,
    OWNED_FIELD as THEME_OWNED,
)

UID = "36425cb4-3755-4669-b4b5-5d86345991d0"


def main() -> int:
    db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
    u0 = db.users.find_one({"id": UID}, {"_id": 0, "username": 1})
    if not u0:
        print("GhostFace user not found", UID)
        return 1

    theme_inc = {f"{THEME_INVENTORY_FIELD}.{tid}": 1 for tid in CRIME_GTA_COSMETIC_THEME_IDS}
    back_inc = {f"{BACK_INVENTORY_FIELD}.{bid}": 1 for bid in CRIME_GTA_COSMETIC_BACK_IDS}
    r = db.users.update_one(
        {"id": UID},
        {
            "$addToSet": {
                THEME_OWNED: {"$each": list(CRIME_GTA_COSMETIC_THEME_IDS)},
                BJ_OWNED: {"$each": list(CRIME_GTA_COSMETIC_BACK_IDS)},
            },
            "$inc": {**theme_inc, **back_inc},
        },
    )
    u = db.users.find_one(
        {"id": UID},
        {
            "_id": 0,
            "username": 1,
            THEME_OWNED: 1,
            BJ_OWNED: 1,
            THEME_INVENTORY_FIELD: 1,
            BACK_INVENTORY_FIELD: 1,
        },
    )
    t_inv = (u or {}).get(THEME_INVENTORY_FIELD) or {}
    b_inv = (u or {}).get(BACK_INVENTORY_FIELD) or {}
    print(
        "matched",
        r.matched_count,
        "modified",
        r.modified_count,
        "user",
        (u or {}).get("username"),
        "themes_owned",
        len((u or {}).get(THEME_OWNED) or []),
        "backs_owned",
        len((u or {}).get(BJ_OWNED) or []),
        "theme_inv",
        len([k for k, v in t_inv.items() if int(v or 0) > 0]),
        "back_inv",
        len([k for k, v in b_inv.items() if int(v or 0) > 0]),
        "granted_themes",
        len(CRIME_GTA_COSMETIC_THEME_IDS),
        "granted_backs",
        len(CRIME_GTA_COSMETIC_BACK_IDS),
    )
    return 0 if r.matched_count else 1


if __name__ == "__main__":
    raise SystemExit(main())
