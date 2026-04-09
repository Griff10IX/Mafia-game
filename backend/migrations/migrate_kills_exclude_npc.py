#!/usr/bin/env python3
"""
One-time migration: for all users without total_kills_excludes_npc_v1,
subtract hitlist NPC kills (minus robot bodyguard kills) from total_kills
and set the flag so the profile shows only real player + robot bodyguard kills.
Safe to run multiple times (idempotent — skips users that already have the flag).
"""

import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()


async def migrate():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "mafia_game")

    print("Migration: fix total_kills to exclude hitlist NPC kills")
    print(f"Database: {db_name}\n")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    cursor = db.users.find(
        {"total_kills_excludes_npc_v1": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "total_kills": 1, "hitlist_npc_kills": 1, "robot_bodyguard_kills": 1},
    )

    updated = 0
    skipped = 0
    async for user in cursor:
        uid = user.get("id")
        if not uid:
            continue
        raw = int(user.get("total_kills") or 0)
        hn = int(user.get("hitlist_npc_kills") or 0)
        rbg = int(user.get("robot_bodyguard_kills") or 0)

        if hn == 0 and rbg == 0:
            # No hitlist or bodyguard kills — just set the flag
            await db.users.update_one({"id": uid}, {"$set": {"total_kills_excludes_npc_v1": True}})
            skipped += 1
            continue

        # Compute adjusted total: remove hitlist NPC kills, keep robot bodyguard kills
        adjusted = max(0, raw - hn + rbg)
        await db.users.update_one(
            {"id": uid},
            {"$set": {"total_kills": adjusted, "total_kills_excludes_npc_v1": True}},
        )
        if adjusted != raw:
            print(f"  {user.get('username', uid)}: {raw} -> {adjusted} (hn={hn}, rbg={rbg})")
        updated += 1

    print(f"\nAdjusted {updated} user(s), flagged {skipped} user(s) with no NPC kills.")
    client.close()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(migrate())
