"""One-shot: grant BAR / Brewster L8 / Commissioner's Pardon to GhostFace for admin testing."""
import asyncio
import os
import sys

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))


async def main():
    url = (os.environ.get("MONGO_URL") or "").strip().strip('"').strip("'")
    name = (os.environ.get("DB_NAME") or "mafia_game").strip().strip('"').strip("'")
    client = AsyncIOMotorClient(url)
    db = client[name]
    u = await db.users.find_one(
        {"username": {"$regex": "^ghostface$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1, "armour_level": 1, "armour_owned_level_max": 1},
    )
    print("user", u)
    if not u:
        return
    uid = u["id"]
    bar = await db.weapons.find_one({"id": "weapon_loot_bar"})
    print("weapon_seed", bool(bar))
    if not bar:
        await db.weapons.insert_one(
            {
                "id": "weapon_loot_bar",
                "name": "Browning Automatic Rifle M1918A2",
                "description": "Loot-exclusive military BAR",
                "damage": 175,
                "bullets_needed": 30,
                "rank_required": 11,
                "price_money": None,
                "price_points": None,
                "loot_exclusive": True,
            }
        )
    from utils.commissioners_pardon import grant_armour_v2, grant_bar, grant_pardon

    print("bar", await grant_bar(db, uid))
    print("armour", await grant_armour_v2(db, uid))
    print("pardon", await grant_pardon(db, uid, run_on_grant=True))
    uw = await db.user_weapons.find_one({"user_id": uid, "weapon_id": "weapon_loot_bar"}, {"_id": 0})
    u2 = await db.users.find_one(
        {"id": uid},
        {"_id": 0, "username": 1, "armour_level": 1, "armour_owned_level_max": 1, "has_commissioners_pardon": 1},
    )
    p = await db.commissioners_pardon_ownership.find_one({}, {"_id": 0})
    print("verify_weapon", uw)
    print("verify_user", u2)
    print("verify_pardon", p)


if __name__ == "__main__":
    asyncio.run(main())
