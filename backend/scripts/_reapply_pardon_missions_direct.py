"""Directly re-apply pardon on-grant mission effects (avoid admin staff unlock)."""
import asyncio
import os
import sys

sys.path.insert(0, "/opt/mafia-app/backend")

from dotenv import load_dotenv

load_dotenv("/opt/mafia-app/backend/.env")

# Import missions first to avoid circular init issues
import routers.account.missions  # noqa: F401
from motor.motor_asyncio import AsyncIOMotorClient
from utils.commissioners_pardon import _apply_pardon_on_grant_missions, get_pardon_doc


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
    u = await db.users.find_one(
        {"username": {"$regex": "^ghostface$", "$options": "i"}},
        {"_id": 0},
    )
    print("user", u.get("username"), "completed", len(u.get("mission_completions") or []))
    print("pardon_doc", await get_pardon_doc(db))
    print("before_skips", len(u.get("pardon_auto_skip_mission_ids") or []), "near", u.get("pardon_near_finish_mission_id"))

    meta = await _apply_pardon_on_grant_missions(db, u)
    print("mission_meta", meta)

    u2 = await db.users.find_one(
        {"id": u["id"]},
        {
            "_id": 0,
            "mission_completions": 1,
            "pardon_auto_skip_mission_ids": 1,
            "pardon_near_finish_mission_id": 1,
            "has_commissioners_pardon": 1,
        },
    )
    print(
        "after",
        {
            "completed": len(u2.get("mission_completions") or []),
            "skips": len(u2.get("pardon_auto_skip_mission_ids") or []),
            "skip_sample": (u2.get("pardon_auto_skip_mission_ids") or [])[:10],
            "near": u2.get("pardon_near_finish_mission_id"),
        },
    )


if __name__ == "__main__":
    asyncio.run(main())
