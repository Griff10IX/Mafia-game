"""Staff one-off: credit Why with N successful GTAs (cars + RP + cash + events).

Run on live:
  cd /opt/mafia-app/backend
  ./venv/bin/python scripts/credit_why_gtas.py --dry-run
  ./venv/bin/python scripts/credit_why_gtas.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from motor.motor_asyncio import AsyncIOMotorClient

from server import CARS, get_rank_info, user_prestige_rank_mult
from routers.cars.gta import (
    GTA_OPTIONS,
    GTA_DIFFICULTY_RANK_POINTS_MULT,
    GTA_LEGENDARY_STEAL_CHANCE,
    _gta_pool_max_car_difficulty,
    _gta_non_legendary_roll_weight,
)

USERNAME = "Why"
COUNT = 200
RANK_POINTS_MAP = {
    "common": 9,
    "uncommon": 24,
    "rare": 54,
    "ultra_rare": 105,
    "legendary": 180,
}


# Normal GTA loot only — never exclusive / vip / loot_exclusive / custom / anything above legendary.
_ALLOWED_CREDIT_RARITIES = frozenset({"common", "uncommon", "rare", "ultra_rare", "legendary"})


def _pick_car(rng: random.Random, option: dict) -> dict:
    pool_max = _gta_pool_max_car_difficulty(option["difficulty"])
    pool = [
        c
        for c in CARS
        if c["min_difficulty"] <= pool_max
        and (c.get("rarity") or "") in _ALLOWED_CREDIT_RARITIES
        and c.get("id") != "car_custom"
    ]
    if not pool:
        pool = [c for c in CARS if (c.get("rarity") or "") in _ALLOWED_CREDIT_RARITIES and c.get("id") != "car_custom"]
        if not pool:
            raise RuntimeError("no allowed cars in catalog")
    legendary = [c for c in pool if (c.get("rarity") or "") == "legendary"]
    non_legendary = [c for c in pool if (c.get("rarity") or "") != "legendary"]
    if legendary and rng.random() < GTA_LEGENDARY_STEAL_CHANCE:
        return rng.choice(legendary)
    base = non_legendary or pool
    weights = [_gta_non_legendary_roll_weight(c.get("rarity"), 0.0, None) for c in base]
    return rng.choices(base, weights=weights, k=1)[0]


def _rp_for(car: dict, option: dict) -> int:
    base = RANK_POINTS_MAP.get(car.get("rarity") or "common", 3)
    mult = GTA_DIFFICULTY_RANK_POINTS_MULT.get(int(option["difficulty"]), 1.0)
    return max(1, int(base * mult))


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--count", type=int, default=COUNT)
    ap.add_argument("--username", default=USERNAME)
    args = ap.parse_args()
    if not args.apply and not args.dry_run:
        args.dry_run = True

    client = AsyncIOMotorClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=20000)
    db = client[os.environ.get("DB_NAME", "mafia_game")]
    user = await db.users.find_one(
        {"username": {"$regex": f"^{args.username}$", "$options": "i"}},
        {"_id": 0},
    )
    if not user:
        raise SystemExit(f"user not found: {args.username}")
    uid = user["id"]
    rank_id, rank_name = get_rank_info(int(user.get("rank_points") or 0), user_prestige_rank_mult(user))
    unlocked = [o for o in GTA_OPTIONS if rank_id >= o["min_rank"]]
    if not unlocked:
        raise SystemExit(f"no unlocked GTA options for rank {rank_id} ({rank_name})")

    rng = random.Random(f"credit-gta:{uid}:{args.count}")
    now = datetime.now(timezone.utc)
    cars_out = []
    events = []
    total_rp = 0
    total_cash = 0
    rarity_counts: dict[str, int] = {}

    for i in range(args.count):
        opt = unlocked[i % len(unlocked)]
        car = _pick_car(rng, opt)
        rp = _rp_for(car, opt)
        value = int(car.get("value") or 0)
        dmg = rng.randint(15, 77) if rng.random() >= 0.08 else rng.randint(0, 14)
        total_rp += rp
        total_cash += value
        rarity = car.get("rarity") or "common"
        rarity_counts[rarity] = rarity_counts.get(rarity, 0) + 1
        uc_id = str(uuid.uuid4())
        cars_out.append(
            {
                "id": uc_id,
                "user_id": uid,
                "car_id": car["id"],
                "car_name": car["name"],
                "acquired_at": now.isoformat(),
                "damage_percent": dmg,
                "staff_credit_gta": True,
                "staff_credit_reason": "auto_rank_protection_block_compensation",
            }
        )
        events.append(
            {
                "user_id": uid,
                "username": user.get("username") or args.username,
                "at": now,
                "success": True,
                "profit": value,
                "option_id": opt["id"],
                "option_name": opt["name"],
                "car_id": car["id"],
                "car_name": car["name"],
                "car_value": value,
                "jailed": False,
                "jail_seconds": None,
                "via_auto_rank": True,
                "staff_credit": True,
                "staff_credit_reason": "auto_rank_protection_block_compensation",
            }
        )

    print(
        f"user={user.get('username')} id={uid} rank={rank_name}({rank_id}) "
        f"rp_before={user.get('rank_points')} money_before={user.get('money')} "
        f"total_gta_before={user.get('total_gta')}"
    )
    print(f"credit count={args.count} unlocked={[o['name'] for o in unlocked]}")
    print(f"total_rp={total_rp} total_cash={total_cash} rarities={rarity_counts}")
    print(f"sample_cars={[c['car_name'] for c in cars_out[:8]]}")

    if args.dry_run:
        print("DRY RUN — no writes")
        return

    if cars_out:
        await db.user_cars.insert_many(cars_out)
    if events:
        await db.gta_events.insert_many(events)
    await db.users.update_one(
        {"id": uid},
        {
            "$inc": {
                "rank_points": total_rp,
                "money": total_cash,
                "total_gta": args.count,
                "auto_rank_total_gtas": args.count,
            },
            "$set": {
                "staff_gta_credit_at": now.isoformat(),
                "staff_gta_credit_count": args.count,
                "staff_gta_credit_rp": total_rp,
                "staff_gta_credit_cash": total_cash,
                "staff_gta_credit_reason": "auto_rank_protection_block_compensation",
                "tutorial_gta_done": True,
            },
        },
    )
    after = await db.users.find_one(
        {"id": uid},
        {"_id": 0, "username": 1, "rank_points": 1, "money": 1, "total_gta": 1, "auto_rank_total_gtas": 1},
    )
    car_n = await db.user_cars.count_documents({"user_id": uid})
    print("APPLIED", after, "user_cars=", car_n)


if __name__ == "__main__":
    asyncio.run(main())
