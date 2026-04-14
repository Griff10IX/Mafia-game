#!/usr/bin/env python3
"""
One-time: set crimes collection reward_min/reward_max to current standard ranges.
Safe to run multiple times (idempotent).
"""

import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

RANGES = [
    ("crime1", 100, 400),
    ("crime2", 300, 800),
    ("crime3", 1000, 2000),
    ("crime4", 2000, 3000),
    ("crime5", 3000, 4000),
    ("crime6", 4000, 5000),
    ("crime7", 5000, 6000),
    ("crime8", 7000, 9000),
]


async def migrate():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "mafia_game")
    print(f"Migration: crime reward ranges -> {db_name}\n")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    for cid, rmin, rmax in RANGES:
        res = await db.crimes.update_one(
            {"id": cid},
            {"$set": {"reward_min": rmin, "reward_max": rmax}},
        )
        print(f"  {cid}: matched={res.matched_count} modified={res.modified_count}")

    client.close()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(migrate())
