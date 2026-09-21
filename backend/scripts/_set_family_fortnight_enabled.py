"""Enable/disable Family Fortnight kill-switch on live DB.

  python scripts/_set_family_fortnight_enabled.py --on
  python scripts/_set_family_fortnight_enabled.py --off
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def main():
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    from datetime import datetime, timezone

    load_dotenv()
    parser = argparse.ArgumentParser()
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--on", action="store_true")
    g.add_argument("--off", action="store_true")
    args = parser.parse_args()
    enabled = bool(args.on)

    uri = os.environ.get("MONGO_URL") or os.environ.get("MONGODB_URI")
    db_name = os.environ.get("DB_NAME") or os.environ.get("MONGO_DB") or "mafia"
    client = AsyncIOMotorClient(uri)
    db = client[db_name]
    await db.game_config.update_one(
        {"id": "family_fortnight_enabled"},
        {"$set": {"id": "family_fortnight_enabled", "enabled": enabled, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    print("family_fortnight_enabled =", enabled)


if __name__ == "__main__":
    asyncio.run(main())
