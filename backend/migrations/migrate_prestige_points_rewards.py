#!/usr/bin/env python3
"""
Grant unpaid prestige store-point rewards to living prestiged accounts.

P1 2,000 · P2 4,000 · P3 6,000 · P4 8,000 · P5 10,000
Idempotent via users.prestige_points_reward_paid_through.
Dead accounts are skipped.

Safe to re-run. Also runs once automatically on API startup.
"""

import asyncio
import os
import sys

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

# Allow `python migrations/migrate_prestige_points_rewards.py` from backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def migrate():
    from utils.prestige_points_rewards import backfill_alive_prestige_points_rewards

    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "mafia_game")

    print("Migration: prestige points rewards for alive prestiged users")
    print(f"Database: {db_name}\n")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    async def _notify(user_id, title, message, ntype="reward", **_kwargs):
        try:
            from datetime import datetime, timezone
            import uuid

            await db.notifications.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "title": title,
                    "message": message,
                    "type": ntype,
                    "category": "reward",
                    "read": False,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )
        except Exception as e:
            print(f"  notify failed for {user_id}: {e}")

    result = await backfill_alive_prestige_points_rewards(db, send_notification=_notify)
    print(
        f"Done. candidates={result.get('candidates')} "
        f"granted_users={result.get('granted_users')} "
        f"total_points={result.get('total_points')}"
    )
    client.close()


if __name__ == "__main__":
    asyncio.run(migrate())
