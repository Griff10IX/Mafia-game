"""Add Highlights' slot 3+4 robots to 5545's active attack searches."""
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path("/opt/mafia-app/backend")
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(str(BACKEND_DIR / ".env"))

ATTACKER = "5545"
TARGETS = [
    "JoeMasseriafcfa0406",
    "DutchSchultzdddfa3ed",
]


async def main():
    from server import db
    from routers.kill.attack import insert_attack_search_row, _attack_list_cache_invalidate

    attacker = await db.users.find_one(
        {"username": {"$regex": f"^{ATTACKER}$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "search_minutes_override": 1},
    )
    if not attacker:
        raise SystemExit("5545 not found")
    if attacker.get("is_dead"):
        raise SystemExit("5545 is dead")

    active = await db.attacks.count_documents(
        {"attacker_id": attacker["id"], "status": {"$in": ["searching", "found", "traveling"]}}
    )
    print(f"attacker={attacker.get('username')} id={attacker['id']} active_searches={active}")

    for uname in TARGETS:
        target = await db.users.find_one(
            {"username": {"$regex": f"^{uname}$", "$options": "i"}},
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "is_npc": 1,
                "is_bodyguard": 1,
                "is_dead": 1,
                "current_state": 1,
                "bodyguard_owner_id": 1,
            },
        )
        if not target:
            print(f"  MISS {uname}")
            continue
        bg = await db.bodyguards.find_one(
            {"bodyguard_user_id": target["id"]},
            {"_id": 0, "user_id": 1, "slot_number": 1, "robot_name": 1},
        )
        print(
            f"  target={target.get('username')} id={target['id']} "
            f"dead={target.get('is_dead')} bg={bg} city={target.get('current_state')}"
        )

        existing = await db.attacks.find_one(
            {
                "attacker_id": attacker["id"],
                "target_id": target["id"],
                "status": {"$in": ["searching", "found", "traveling"]},
            },
            {"_id": 0, "id": 1, "status": 1, "found_at": 1, "search_started": 1},
        )
        if existing:
            print(f"  SKIP already active: {existing}")
            continue

        row = await insert_attack_search_row(
            db,
            attacker=attacker,
            target=target,
            note="staff: Highlights BG",
            source="staff_script",
            raise_on_cap=True,
        )
        print(f"  ADDED {row}")

    _attack_list_cache_invalidate(attacker["id"])
    final = (
        await db.attacks.find(
            {
                "attacker_id": attacker["id"],
                "target_username": {"$in": TARGETS},
                "status": {"$in": ["searching", "found", "traveling"]},
            },
            {"_id": 0, "id": 1, "target_username": 1, "status": 1, "found_at": 1, "search_started": 1, "note": 1},
        )
        .sort("search_started", -1)
        .to_list(10)
    )
    print("FINAL:")
    for f in final:
        print(f"  {f}")


asyncio.run(main())
