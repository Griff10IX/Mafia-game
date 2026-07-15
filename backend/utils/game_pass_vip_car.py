"""VIP Game Pass tier-100 exclusive car (car22) grant and ownership helpers."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from server import CARS

logger = logging.getLogger(__name__)

GAME_PASS_VIP_CAR_ID = "car22"
VIP_EXCLUSIVE_RARITY = "vip_exclusive"


def _vip_car_catalog() -> Optional[dict]:
    return next((c for c in CARS if c.get("id") == GAME_PASS_VIP_CAR_ID), None)


async def user_owns_game_pass_vip_car(db, user_id: str) -> bool:
    if not user_id:
        return False
    n = await db.user_cars.count_documents({"user_id": user_id, "car_id": GAME_PASS_VIP_CAR_ID}, limit=1)
    return n > 0


async def grant_vip_pass_car_to_user(
    db,
    *,
    user_id: str,
    username: Optional[str] = None,
    event_type: str = "store_purchase",
    notify: bool = True,
) -> bool:
    """
    Grant VIP Pass Car (car22) once per account.
    Idempotent via user_cars ownership and users.game_pass_vip_car_granted.
    Returns True if a new car row was inserted.
    """
    if not user_id:
        return False
    if await user_owns_game_pass_vip_car(db, user_id):
        return False

    car_info = _vip_car_catalog()
    if not car_info:
        logger.error("game_pass_vip_car: car22 missing from CARS catalog")
        return False

    if not username:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
        username = (u or {}).get("username")

    now_iso = datetime.now(timezone.utc).isoformat()
    user_car_id = str(uuid.uuid4())
    claim = await db.users.update_one(
        {"id": user_id, "game_pass_vip_car_granted": {"$ne": True}},
        {"$set": {"game_pass_vip_car_granted": True}},
    )
    if claim.modified_count == 0:
        if await user_owns_game_pass_vip_car(db, user_id):
            return False
        return False

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
        await db.users.update_one(
            {"id": user_id, "game_pass_vip_car_granted": True},
            {"$unset": {"game_pass_vip_car_granted": ""}},
        )
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


async def grant_game_pass_vip_car_if_eligible(db, *, user_id: str) -> bool:
    """
    Grant one VIP Pass car the first time VIP reaches tier 100 (once per account).
    Idempotent via users.game_pass_vip_car_granted.
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

    return await grant_vip_pass_car_to_user(
        db,
        user_id=user_id,
        username=user.get("username"),
        event_type="game_pass_tier_100",
        notify=True,
    )
