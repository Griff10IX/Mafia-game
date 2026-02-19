#!/usr/bin/env python3
"""
One-time migration: set email_verified=True for all existing users
so they are not blocked at login after enabling email verification.
Safe to run multiple times (idempotent).
"""

import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()


async def migrate():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "mafia_game")

    print("Migration: set email_verified=True for existing users")
    print(f"Database: {db_name}\n")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # Users who don't have email_verified or have it False
    result = await db.users.update_many(
        {"$or": [{"email_verified": {"$exists": False}}, {"email_verified": False}]},
        {"$set": {"email_verified": True}},
    )
    modified = result.modified_count
    print(f"Updated {modified} user(s).")
    if modified == 0:
        print("(All users already had email_verified=True or no users matched.)")
    client.close()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(migrate())
