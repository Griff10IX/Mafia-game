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

from utils.game_pass_vip_car import GAME_PASS_VIP_CAR_ID, transfer_vip_pass_cars_dead_alive  # noqa: E402


async def _latest_retrieve_recipient(db, dead_id: str) -> dict | None:
    row = await db.dead_alive_transfers.find_one(
        {"event_type": "retrieve", "dead_id": dead_id},
        {"_id": 0, "recipient_id": 1, "recipient_username": 1, "dead_username": 1, "created_at": 1},
        sort=[("created_at", -1)],
    )
    return row


async def migrate(dry_run: bool = False) -> None:
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("MONGO_DB") or os.environ.get("DB_NAME") or "mafia"
    print("Migration: VIP Pass Car Dead -> Alive backfill")
    print(f"Database: {db_name}  dry_run={dry_run}\n")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # Dead accounts that still hold VIP cars
    dead_with_cars = await db.user_cars.distinct(
        "user_id",
        {"car_id": GAME_PASS_VIP_CAR_ID},
    )
    if not dead_with_cars:
        print("No VIP Pass Cars in any garage.")
        client.close()
        return

    users = await db.users.find(
        {"id": {"$in": list(dead_with_cars)}, "is_dead": True},
        {"_id": 0, "id": 1, "username": 1, "game_pass_vip_car_granted": 1},
    ).to_list(len(dead_with_cars) + 1)

    print(f"Dead accounts still holding VIP Pass Car(s): {len(users)}")
    transferred_users = 0
    transferred_cars = 0
    skipped = 0

    for dead in users:
        dead_id = dead.get("id")
        if not dead_id:
            continue
        xfer = await _latest_retrieve_recipient(db, dead_id)
        if not xfer or not xfer.get("recipient_id"):
            skipped += 1
            print(f"  skip {dead.get('username') or dead_id}: no retrieve transfer log")
            continue
        recip_id = xfer["recipient_id"]
        recip = await db.users.find_one(
            {"id": recip_id, "is_dead": {"$ne": True}},
            {"_id": 0, "id": 1, "username": 1},
        )
        if not recip:
            skipped += 1
            print(f"  skip {dead.get('username') or dead_id}: recipient missing/dead ({recip_id})")
            continue

        car_count = int(
            await db.user_cars.count_documents({"user_id": dead_id, "car_id": GAME_PASS_VIP_CAR_ID})
        )
        print(
            f"  {dead.get('username')} → {recip.get('username')}: "
            f"{car_count} car(s), grant_flag={bool(dead.get('game_pass_vip_car_granted'))}"
        )
        if dry_run:
            transferred_users += 1
            transferred_cars += car_count
            continue

        result = await transfer_vip_pass_cars_dead_alive(
            db,
            dead_user_id=dead_id,
            recipient_user_id=recip_id,
            dead_username=dead.get("username"),
            recipient_username=recip.get("username"),
            notify=True,
        )
        n = int((result or {}).get("transferred_count") or 0)
        if n > 0:
            transferred_users += 1
            transferred_cars += n
        else:
            skipped += 1

    print(
        f"\nDone. users={transferred_users} cars={transferred_cars} skipped={skipped}"
        + (" (dry-run)" if dry_run else "")
    )
    client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print actions only")
    args = parser.parse_args()
    asyncio.run(migrate(dry_run=args.dry_run))
