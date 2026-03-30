#!/usr/bin/env python3
"""
One-time migration: fix booze_run_profit_total double-count from Auto Rank.

Previously _update_auto_rank_stats_booze also incremented booze_run_profit_total after
_booze_sell_impl had already done so. Correct lifetime total is:

  booze_run_profit_total := max(0, booze_run_profit_total - auto_rank_total_booze_profit)

Sets booze_run_profit_auto_rank_dedup_applied on each updated user so this does not run twice.

Run against a backup/staging first. Usage:

  python backend/migrations/migrate_booze_run_profit_dedup.py
  python backend/migrations/migrate_booze_run_profit_dedup.py --apply
"""

import argparse
import asyncio
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

DEDUP_FLAG = "booze_run_profit_auto_rank_dedup_applied"


async def migrate(*, apply_writes: bool) -> None:
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "mafia_game")

    print("Migration: dedupe booze_run_profit_total (subtract auto_rank_total_booze_profit)")
    dry_run = not apply_writes
    print(f"Database: {db_name}  apply_writes={apply_writes}\n")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    match = {
        "auto_rank_total_booze_profit": {"$gt": 0},
        DEDUP_FLAG: {"$ne": True},
    }
    n = await db.users.count_documents(match)
    print(f"Users with auto_rank_total_booze_profit > 0: {n}")

    if n == 0:
        print("Nothing to do.")
        client.close()
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    pipeline = [
        {
            "$set": {
                "booze_run_profit_total": {
                    "$max": [
                        0,
                        {
                            "$subtract": [
                                {"$ifNull": ["$booze_run_profit_total", 0]},
                                {"$ifNull": ["$auto_rank_total_booze_profit", 0]},
                            ]
                        },
                    ]
                },
                DEDUP_FLAG: True,
                "booze_run_profit_auto_rank_dedup_applied_at": now_iso,
            }
        }
    ]

    if dry_run:
        cur = db.users.aggregate(
            [
                {"$match": match},
                {
                    "$project": {
                        "_id": 0,
                        "id": 1,
                        "username": 1,
                        "before": {"$ifNull": ["$booze_run_profit_total", 0]},
                        "subtract": {"$ifNull": ["$auto_rank_total_booze_profit", 0]},
                        "after": {
                            "$max": [
                                0,
                                {
                                    "$subtract": [
                                        {"$ifNull": ["$booze_run_profit_total", 0]},
                                        {"$ifNull": ["$auto_rank_total_booze_profit", 0]},
                                    ]
                                },
                            ]
                        },
                    }
                },
                {"$limit": 25},
            ]
        )
        rows = await cur.to_list(25)
        print("\nSample (first 25):")
        for r in rows:
            print(
                f"  {r.get('username')!r}  before={r['before']:,}  "
                f"subtract={r['subtract']:,}  after={r['after']:,}"
            )
        print("\nDry run only — no writes. Run without --dry-run to apply.")
        client.close()
        return

    result = await db.users.update_many(match, pipeline)
    print(f"Matched: {result.matched_count}  Modified: {result.modified_count}")
    client.close()
    print("Done.")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument(
        "--apply",
        action="store_true",
        help="Apply DB updates (default is preview only, first 25 users)",
    )
    args = p.parse_args()
    asyncio.run(migrate(apply_writes=args.apply))
