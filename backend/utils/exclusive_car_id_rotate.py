"""Weekly UUID rotation for exclusive / loot-exclusive garage instances.

Owner, catalog car_id, and listing flags stay the same. Only user_cars.id changes
(the /cars/view?id= value). Runs once per UTC ISO week for every matching car,
including ones that have never been viewed. VIP Pass cars are not rotated.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from utils.exclusive_car_events import log_exclusive_car_event

logger = logging.getLogger(__name__)

ROTATE_RARITIES = frozenset({"exclusive", "loot_exclusive"})
SETTINGS_ID = "exclusive_car_id_rotate"


def exclusive_car_id_rotate_week(dt: Optional[datetime] = None) -> str:
    """UTC ISO week key (Monday-based), e.g. 2026-W35."""
    dt = dt or datetime.now(timezone.utc)
    iso = dt.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def rotate_catalog_car_ids(cars: Optional[list] = None) -> List[str]:
    if cars is None:
        from server import CARS

        cars = CARS
    return [c["id"] for c in (cars or []) if c.get("id") and c.get("rarity") in ROTATE_RARITIES]


async def _remap_profile_pins(db, owner_id: str, old_id: str, new_id: str) -> None:
    if not owner_id or not old_id or not new_id or old_id == new_id:
        return
    await db.users.update_one(
        {"id": owner_id, "profile_featured_car_id": old_id},
        {"$set": {"profile_featured_car_id": new_id}},
    )
    await db.users.update_one(
        {"id": owner_id, "profile_car_ids": old_id},
        {"$set": {"profile_car_ids.$": new_id}},
    )


async def _rotate_one(db, uc: dict, week: str, catalog_names: Dict[str, str]) -> bool:
    if uc.get("_id") is None:
        return False
    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    filt = {"_id": uc["_id"], "id_rotate_week": {"$ne": week}}
    patch = {"$set": {"id": new_id, "id_rotate_week": week, "id_rotated_at": now}}
    try:
        before = await db.user_cars.find_one_and_update(
            filt, patch, return_document=ReturnDocument.BEFORE
        )
    except DuplicateKeyError:
        new_id = str(uuid.uuid4())
        patch = {"$set": {"id": new_id, "id_rotate_week": week, "id_rotated_at": now}}
        before = await db.user_cars.find_one_and_update(
            filt, patch, return_document=ReturnDocument.BEFORE
        )
    if not before:
        return False
    old_id = str(before.get("id") or "")
    owner_id = str(before.get("user_id") or "")
    await _remap_profile_pins(db, owner_id, old_id, new_id)
    car_id = before.get("car_id")
    await log_exclusive_car_event(
        db,
        event_type="weekly_id_rotate",
        car_id=car_id,
        user_car_id=new_id,
        previous_user_car_id=old_id,
        from_user_id=owner_id or None,
        to_user_id=owner_id or None,
        car_name=before.get("car_name") or catalog_names.get(car_id),
        extra={"week": week, "owner_unchanged": True},
    )
    return True


async def rotate_exclusive_car_ids_if_due(db) -> Dict[str, Any]:
    """Rotate every exclusive / loot-exclusive instance id once this ISO week.

    Cars granted after this week's run keep their id until the next Monday UTC.
    Per-car id_rotate_week makes a crashed/retried run safe; the week stamp is
    written only after the scan so leftovers still rotate on the next tick.
    """
    week = exclusive_car_id_rotate_week()
    stamp = await db.game_settings.find_one({"_id": SETTINGS_ID}, {"_id": 0, "week": 1})
    if stamp and stamp.get("week") == week:
        return {"week": week, "rotated": 0, "skipped": True}

    catalog_ids = rotate_catalog_car_ids()
    if not catalog_ids:
        await db.game_settings.update_one(
            {"_id": SETTINGS_ID},
            {"$set": {"week": week, "last_rotated_count": 0, "finished_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        return {"week": week, "rotated": 0, "skipped": True}

    from server import CARS

    catalog_names = {c["id"]: c.get("name") or c["id"] for c in CARS if c.get("id")}
    rotated = 0
    failed = False
    cursor = db.user_cars.find(
        {"car_id": {"$in": catalog_ids}, "id_rotate_week": {"$ne": week}},
        {"_id": 1, "id": 1, "user_id": 1, "car_id": 1, "car_name": 1},
    )
    async for uc in cursor:
        try:
            if await _rotate_one(db, uc, week, catalog_names):
                rotated += 1
        except Exception:
            failed = True
            logger.exception("Exclusive car id rotate failed _id=%s", uc.get("_id"))

    if failed:
        logger.warning("Exclusive car id rotate incomplete week=%s rotated=%s — will retry", week, rotated)
        return {"week": week, "rotated": rotated, "skipped": False, "incomplete": True}

    await db.game_settings.update_one(
        {"_id": SETTINGS_ID},
        {
            "$set": {
                "week": week,
                "last_rotated_count": rotated,
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }
        },
        upsert=True,
    )
    logger.info("Exclusive/loot exclusive car ids rotated: %s week=%s", rotated, week)
    return {"week": week, "rotated": rotated, "skipped": False}


async def run_exclusive_car_id_rotate_loop():
    import server as srv

    await asyncio.sleep(75)
    while True:
        try:
            await rotate_exclusive_car_ids_if_due(srv.db)
        except Exception:
            logger.exception("Exclusive car id rotate loop")
        await asyncio.sleep(60)
