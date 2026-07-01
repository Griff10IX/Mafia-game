"""One-time: old loot-exclusive armour was level 6; it is now level 7."""

import logging

logger = logging.getLogger(__name__)

_MIGRATION_KEY = "loot_armour_level_6_to_7"


async def migrate_loot_armour_level_6_to_7_if_needed(db) -> None:
    done = await db.game_settings.find_one({"key": _MIGRATION_KEY}, {"_id": 1})
    if done:
        return
    n_owned = 0
    n_equipped = 0
    async for u in db.users.find(
        {"$or": [{"armour_owned_level_max": 6}, {"armour_level": 6}]},
        {"_id": 0, "id": 1, "armour_level": 1, "armour_owned_level_max": 1},
    ):
        updates = {}
        if int(u.get("armour_owned_level_max") or 0) >= 6:
            updates["armour_owned_level_max"] = 7
            n_owned += 1
        if int(u.get("armour_level") or 0) >= 6:
            updates["armour_level"] = 7
            n_equipped += 1
        if updates:
            await db.users.update_one({"id": u["id"]}, {"$set": updates})
    await db.game_settings.update_one(
        {"key": _MIGRATION_KEY},
        {"$set": {"key": _MIGRATION_KEY, "value": True, "users_owned_bumped": n_owned, "users_equipped_bumped": n_equipped}},
        upsert=True,
    )
    if n_owned or n_equipped:
        logger.info("migrate_loot_armour_level_6_to_7: owned_max→7 for %s users, equipped→7 for %s", n_owned, n_equipped)
