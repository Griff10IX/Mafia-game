#!/usr/bin/env python3
"""
Migration: recompute total_kills for ALL users by counting actual kills
from attack_attempts (player kills + robot bodyguard kills only).
This is the source of truth — no formula guessing needed.
Safe to re-run (overwrites total_kills with the correct count each time).
"""

import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()


async def migrate():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "mafia_game")

    print("Migration: recompute total_kills from attack_attempts")
    print(f"Database: {db_name}\n")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # Get all users
    cursor = db.users.find(
        {},
        {"_id": 0, "id": 1, "username": 1, "total_kills": 1},
    )

    updated = 0
    unchanged = 0
    async for user in cursor:
        uid = user.get("id")
        if not uid:
            continue
        old_total = int(user.get("total_kills") or 0)

        # Count kills from attack_attempts: outcome=killed, target is a real player or robot bodyguard
        actual_kills = await db.attack_attempts.count_documents({
            "attacker_id": uid,
            "outcome": "killed",
            "$or": [
                {"target_is_npc": {"$ne": True}},
                {"is_bodyguard_kill": True},
            ],
        })

        if actual_kills != old_total:
            print(f"  {user.get('username', uid)}: {old_total} -> {actual_kills}")
            updated += 1
        else:
            unchanged += 1

        await db.users.update_one(
            {"id": uid},
            {"$set": {"total_kills": actual_kills, "total_kills_excludes_npc_v1": True}},
        )

    print(f"\nFixed {updated} user(s), {unchanged} already correct.")
    client.close()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(migrate())
