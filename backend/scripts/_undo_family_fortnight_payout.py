"""Undo the latest family fortnight payout (or a specific period_id).

Usage (from backend/ with venv):
  python scripts/_undo_family_fortnight_payout.py
  python scripts/_undo_family_fortnight_payout.py --period-id 2026-09-01_2026-09-08
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

    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--period-id", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    uri = os.environ.get("MONGO_URL") or os.environ.get("MONGODB_URI")
    db_name = os.environ.get("DB_NAME") or os.environ.get("MONGO_DB") or "mafia"
    client = AsyncIOMotorClient(uri)
    db = client[db_name]

    q = {"period_id": args.period_id} if args.period_id else {}
    doc = await db.family_fortnight_payouts.find_one(q, sort=[("paid_at", -1)])
    if not doc:
        print("No payout doc found")
        return
    period_id = doc.get("period_id")
    print("Undoing period", period_id, "placements", len(doc.get("placements") or []))
    if args.dry_run:
        return

    for p in doc.get("placements") or []:
        fid = p.get("family_id")
        treas = p.get("treasury") or {}
        cash = int(treas.get("cash") or 0)
        pts = int(treas.get("points") or 0)
        loot = int(treas.get("loot") or 0)
        if fid and (cash or pts or loot):
            await db.families.update_one(
                {"id": fid},
                {"$inc": {"treasury": -cash, "treasury_points": -pts, "treasury_loot_pieces": -loot}},
            )
        for g in p.get("member_grants") or []:
            uid = g.get("user_id")
            pts_g = int(g.get("points") or 0)
            if uid and pts_g:
                await db.users.update_one({"id": uid}, {"$inc": {"points": -pts_g}})
        if int(p.get("rank") or 0) == 1 and fid:
            await db.families.update_one(
                {"id": fid},
                {
                    "$unset": {
                        "fortnight_theme_id": "",
                        "fortnight_theme_image": "",
                        "fortnight_theme_until": "",
                        "fortnight_flair_until": "",
                        "fortnight_racket_buff_pct": "",
                        "fortnight_racket_buff_until": "",
                        "crew_of_fortnight_period_id": "",
                    }
                },
            )
            for g in p.get("member_grants") or []:
                uid = g.get("user_id")
                if not uid:
                    continue
                await db.users.update_one(
                    {"id": uid},
                    {
                        "$unset": {
                            "crew_of_fortnight_until": "",
                            "crew_of_fortnight_badge_url": "",
                        },
                        "$pull": {"badges": "Crew of the Fortnight"},
                    },
                )

    await db.family_fortnight_payouts.delete_one({"_id": doc["_id"]})
    await db.game_config.update_one(
        {"id": "family_fortnight_payout", "last_run_period_id": period_id},
        {"$unset": {"last_run_period_id": ""}},
    )
    print("DONE undo", period_id)


if __name__ == "__main__":
    asyncio.run(main())
