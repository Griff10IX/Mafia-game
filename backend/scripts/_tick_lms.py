"""Refresh LMS GW results then cron tick (live)."""
import asyncio
import os
import sys

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, "/opt/mafia-app/backend")
load_dotenv("/opt/mafia-app/backend/.env")

from utils import last_man_standing as lms  # noqa: E402


async def main():
    db = AsyncIOMotorClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]
    sid = "80e9cec9-da12-4021-a719-e0403dad5c21"
    print("refresh2", await lms.refresh_results_into_gameweek(db, sid, 2))
    gw = await lms.get_gameweek(db, sid, 2)
    for f in (gw or {}).get("fixtures") or []:
        print(f.get("home"), f.get("away"), f.get("result"), f.get("home_score"), f.get("away_score"))
    print("tick", await lms.cron_tick(db))


if __name__ == "__main__":
    asyncio.run(main())
