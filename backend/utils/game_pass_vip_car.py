"""VIP Pass Car (car22) grant, ownership, and game-wide stock helpers."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from server import CARS

logger = logging.getLogger(__name__)

GAME_PASS_VIP_CAR_ID = "car22"
VIP_EXCLUSIVE_RARITY = "vip_exclusive"
# Max VIP Pass Cars that may exist across the whole player base (not per account).
VIP_PASS_CAR_PURCHASE_LIMIT_DEFAULT = 5
VIP_PASS_CAR_PURCHASE_LIMIT_MIN = 1
VIP_PASS_CAR_PURCHASE_LIMIT_MAX = 50


def _vip_car_catalog() -> Optional[dict]:
    return next((c for c in CARS if c.get("id") == GAME_PASS_VIP_CAR_ID), None)


def normalize_vip_pass_car_purchase_limit(raw) -> int:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return VIP_PASS_CAR_PURCHASE_LIMIT_DEFAULT
    return max(VIP_PASS_CAR_PURCHASE_LIMIT_MIN, min(n, VIP_PASS_CAR_PURCHASE_LIMIT_MAX))


async def get_vip_pass_car_purchase_limit(db) -> int:
    doc = await db.game_settings.find_one({"_id": "main"}, {"_id": 0, "vip_pass_car_purchase_limit": 1})
    if not doc or doc.get("vip_pass_car_purchase_limit") is None:
        return VIP_PASS_CAR_PURCHASE_LIMIT_DEFAULT
    return normalize_vip_pass_car_purchase_limit(doc.get("vip_pass_car_purchase_limit"))


async def set_vip_pass_car_purchase_limit(db, limit: int) -> int:
    n = normalize_vip_pass_car_purchase_limit(limit)
    await db.game_settings.update_one(
        {"_id": "main"},
        {"$set": {"vip_pass_car_purchase_limit": n}},
        upsert=True,
    )
    return n


async def count_global_vip_pass_cars(db) -> int:
    """How many VIP Pass Cars currently exist in all garages (game-wide stock)."""
    return int(await db.user_cars.count_documents({"car_id": GAME_PASS_VIP_CAR_ID}))


async def get_vip_pass_car_stats(db) -> dict:
    """Live VIP Pass Car inventory + grant-source breakdown."""
    cars_in_game = await count_global_vip_pass_cars(db)
    owner_ids = await db.user_cars.distinct("user_id", {"car_id": GAME_PASS_VIP_CAR_ID})
    owner_accounts = len([x for x in (owner_ids or []) if x])
    game_pass_granted_accounts = int(
        await db.users.count_documents({"game_pass_vip_car_granted": True})
    )
    grant_pipeline = [
        {"$match": {"car_id": GAME_PASS_VIP_CAR_ID}},
        {"$group": {"_id": "$event_type", "count": {"$sum": 1}}},
    ]
    grant_rows = await db.exclusive_car_events.aggregate(grant_pipeline).to_list(100)
    grants_by_type = {
        str(r.get("_id") or "unknown"): int(r.get("count") or 0)
        for r in (grant_rows or [])
        if r.get("_id") is not None
    }
    store_grants = int(grants_by_type.get("store_purchase") or 0)
    game_pass_grants = int(grants_by_type.get("game_pass_tier_100") or 0)
    other_grants = sum(
        v for k, v in grants_by_type.items() if k not in ("store_purchase", "game_pass_tier_100")
    )
    return {
        "cars_in_game": cars_in_game,
        "owner_accounts": owner_accounts,
        "game_pass_granted_accounts": game_pass_granted_accounts,
        "store_purchase_grants": store_grants,
        "game_pass_tier_100_grants": game_pass_grants,
        "other_grants": other_grants,
        "grants_by_type": grants_by_type,
        "purchase_limit": await get_vip_pass_car_purchase_limit(db),
    }


async def count_user_vip_pass_cars(db, user_id: str) -> int:
    if not user_id:
        return 0
    return int(await db.user_cars.count_documents({"user_id": user_id, "car_id": GAME_PASS_VIP_CAR_ID}))


async def user_owns_game_pass_vip_car(db, user_id: str) -> bool:
    return await count_user_vip_pass_cars(db, user_id) > 0


async def _insert_vip_pass_car(
    db,
    *,
    user_id: str,
    username: Optional[str] = None,
    event_type: str = "store_purchase",
    notify: bool = True,
) -> bool:
    car_info = _vip_car_catalog()
    if not car_info:
        logger.error("game_pass_vip_car: car22 missing from CARS catalog")
        return False

    if not username:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
        username = (u or {}).get("username")

    now_iso = datetime.now(timezone.utc).isoformat()
    user_car_id = str(uuid.uuid4())
    try:
        await db.user_cars.insert_one(
            {
                "id": user_car_id,
                "user_id": user_id,
                "car_id": GAME_PASS_VIP_CAR_ID,
                "car_name": car_info.get("name") or "VIP Pass Car",
                "acquired_at": now_iso,
                "damage_percent": 0,
            }
        )
    except Exception:
        logger.exception("game_pass_vip_car insert failed user_id=%s", user_id)
        return False

    try:
        from utils.exclusive_car_events import log_exclusive_car_event

        await log_exclusive_car_event(
            db,
            event_type=event_type,
            car_id=GAME_PASS_VIP_CAR_ID,
            user_car_id=user_car_id,
            to_user_id=user_id,
            to_username=username,
            car_name=car_info.get("name"),
        )
    except Exception:
        logger.exception("game_pass_vip_car event log failed user_id=%s", user_id)

    if notify:
        try:
            from server import send_notification

            await send_notification(
                user_id,
                "VIP Pass Car",
                "You received the VIP Pass Car (8s travel, +50% booze cargo while owned, custom image). Set your picture from Garage.",
                "reward",
            )
        except Exception:
            logger.exception("game_pass_vip_car notification failed user_id=%s", user_id)

    return True


async def grant_vip_pass_car_to_user(
    db,
    *,
    user_id: str,
    username: Optional[str] = None,
    event_type: str = "store_purchase",
    notify: bool = True,
) -> bool:
    """
    Grant one VIP Pass Car if game-wide stock is under the configured limit.
    Returns True if a new car row was inserted.
    """
    if not user_id:
        return False
    limit = await get_vip_pass_car_purchase_limit(db)
    if await count_global_vip_pass_cars(db) >= limit:
        return False
    ok = await _insert_vip_pass_car(
        db,
        user_id=user_id,
        username=username,
        event_type=event_type,
        notify=notify,
    )
    if not ok:
        return False
    # Soft race guard: if concurrent grants pushed over the global limit, roll back this insert.
    if await count_global_vip_pass_cars(db) > limit:
        try:
            newest = await db.user_cars.find_one(
                {"user_id": user_id, "car_id": GAME_PASS_VIP_CAR_ID},
                {"_id": 0, "id": 1},
                sort=[("acquired_at", -1)],
            )
            if newest and newest.get("id"):
                await db.user_cars.delete_one({"id": newest["id"], "user_id": user_id})
        except Exception:
            logger.exception("game_pass_vip_car over-limit rollback failed user_id=%s", user_id)
        return False
    return True


async def grant_game_pass_vip_car_if_eligible(db, *, user_id: str) -> bool:
    """
    Grant one VIP Pass car the first time VIP reaches tier 100 (once per account).
    Still respects the game-wide stock limit. Idempotent via users.game_pass_vip_car_granted.
    """
    if not user_id:
        return False

    user = await db.users.find_one(
        {"id": user_id},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "rank_xp_pass_rewards_granted": 1,
            "game_pass_vip_car_granted": 1,
        },
    )
    if not user or not user.get("rank_xp_pass_rewards_granted"):
        return False
    if user.get("game_pass_vip_car_granted"):
        return False

    limit = await get_vip_pass_car_purchase_limit(db)
    if await count_global_vip_pass_cars(db) >= limit:
        return False

    claim = await db.users.update_one(
        {"id": user_id, "game_pass_vip_car_granted": {"$ne": True}},
        {"$set": {"game_pass_vip_car_granted": True}},
    )
    if claim.modified_count == 0:
        return False

    ok = await grant_vip_pass_car_to_user(
        db,
        user_id=user_id,
        username=user.get("username"),
        event_type="game_pass_tier_100",
        notify=True,
    )
    if not ok:
        await db.users.update_one(
            {"id": user_id, "game_pass_vip_car_granted": True},
            {"$unset": {"game_pass_vip_car_granted": ""}},
        )
    return ok
