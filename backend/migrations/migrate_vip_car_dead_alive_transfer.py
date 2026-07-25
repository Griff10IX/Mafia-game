#!/usr/bin/env python3
"""
One-time backfill: move VIP Pass Cars still on dead accounts to the alive recipient
of a prior Dead → Alive retrieve, and send an inbox notification.

Also carries users.game_pass_vip_car_granted from dead → recipient.

Safe to re-run (idempotent): skips when the dead garage has no car22 left.

Usage (from backend/ with .env loaded):
  python migrations/migrate_vip_car_dead_alive_transfer.py
  python migrations/migrate_vip_car_dead_alive_transfer.py --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
load_dotenv(BACKEND_DIR / ".env")
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from utils.game_pass_vip_car import backfill_vip_pass_cars_dead_alive  # noqa: E402


async def migrate(dry_run: bool = False) -> None:
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("MONGO_DB") or os.environ.get("DB_NAME") or "mafia"
    print("Migration: VIP Pass Car Dead -> Alive backfill")
    print(f"Database: {db_name}  dry_run={dry_run}\n")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    result = await backfill_vip_pass_cars_dead_alive(db, dry_run=dry_run)
    for t in result.get("transfers") or []:
        print(
            f"  {t.get('dead_username')} -> {t.get('recipient_username')}: "
            f"{t.get('cars')} car(s), grant_flag={t.get('grant_flag')}"
        )
    for s in result.get("skips") or []:
        print(f"  skip {s.get('dead_username')}: {s.get('reason')}")
    print(
        f"\nDone. dead_with_cars={result.get('dead_with_cars')} "
        f"users={result.get('transferred_users')} cars={result.get('transferred_cars')} "
        f"skipped={result.get('skipped')}"
        + (" (dry-run)" if dry_run else "")
    )
    client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print actions only")
    args = parser.parse_args()
    asyncio.run(migrate(dry_run=args.dry_run))
