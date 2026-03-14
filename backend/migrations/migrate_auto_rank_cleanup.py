#!/usr/bin/env python3
"""
One-time migration: for users who never purchased Auto Rank (auto_rank_purchased is not True),
set auto_rank_enabled to False and unset related fields so they don't run or show as enabled.
Safe to run multiple times (idempotent).
"""

import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

# Fields to unset (stats + scheduling) for users who didn't purchase
UNSET_FIELDS = [
    "auto_rank_stats_since",
    "auto_rank_total_busts",
    "auto_rank_total_crimes",
    "auto_rank_total_gtas",
    "auto_rank_total_cash",
    "auto_rank_best_cars",
    "auto_rank_total_booze_runs",
    "auto_rank_total_booze_profit",
    "auto_rank_next_run_at",
    "auto_rank_last_crimes_gta_at",
    "auto_rank_oc_retry_at",
]


async def migrate():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "mafia_game")

    print("Migration: disable Auto Rank and clean fields for users who never purchased")
    print(f"Database: {db_name}\n")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # Users who have not purchased (field missing or not True)
    query = {"auto_rank_purchased": {"$ne": True}}

    count = await db.users.count_documents(query)
    print(f"Found {count} user(s) without auto_rank_purchased=True.")

    if count == 0:
        print("Nothing to do.")
        client.close()
        print("Done.")
        return

    # Set enabled and sub-options to False, unset stats/scheduling fields
    set_op = {
        "auto_rank_enabled": False,
        "auto_rank_crimes": False,
        "auto_rank_gta": False,
        "auto_rank_bust_every_5_sec": False,
        "auto_rank_oc": False,
        "auto_rank_booze": False,
    }
    unset_op = {f: "" for f in UNSET_FIELDS}

    result = await db.users.update_many(
        query,
        {"$set": set_op, "$unset": unset_op},
    )
    modified = result.modified_count
    print(f"Updated {modified} user(s).")
    client.close()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(migrate())
