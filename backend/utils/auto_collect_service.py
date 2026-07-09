"""Auto-collect pass ticker: properties + family rackets when cooldowns allow."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

AUTO_COLLECT_TICKER_SECONDS = 300


async def try_auto_collect_property(db, user_id: str, property_id: str) -> Optional[dict]:
    from routers.money.properties import collect_property_income

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return None
    try:
        return await collect_property_income(property_id, user)
    except HTTPException:
        return None
    except Exception as e:
        logger.debug("auto_collect property %s for %s: %s", property_id, user_id, e)
        return None


async def try_auto_collect_family_racket(db, user_id: str, racket_id: str) -> Optional[dict]:
    from routers.game.families import families_racket_collect

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user or not user.get("family_id"):
        return None
    try:
        return await families_racket_collect(racket_id, user)
    except HTTPException:
        return None
    except Exception as e:
        logger.debug("auto_collect racket %s for %s: %s", racket_id, user_id, e)
        return None


async def run_auto_collect_for_user(db, user_id: str, family_id: Optional[str]) -> Dict[str, Any]:
    """Attempt all eligible property and racket collects for one user."""
    out: Dict[str, Any] = {"properties": [], "rackets": []}
    prop_ids = await db.user_properties.distinct("property_id", {"user_id": user_id})
    for pid in prop_ids:
        res = await try_auto_collect_property(db, user_id, pid)
        if res:
            out["properties"].append({"property_id": pid, "message": res.get("message")})

    if family_id:
        fam = await db.families.find_one({"id": family_id}, {"_id": 0, "rackets": 1})
        rackets = (fam or {}).get("rackets") or {}
        for racket_id, state in rackets.items():
            if int((state or {}).get("level") or 0) <= 0:
                continue
            res = await try_auto_collect_family_racket(db, user_id, racket_id)
            if res:
                out["rackets"].append({"racket_id": racket_id, "amount": res.get("amount")})
    return out


async def run_auto_collect_tick(db) -> Dict[str, Any]:
    from utils.store_item_flags import get_store_item_flags, store_item_enabled

    flags = await get_store_item_flags(db)
    if not store_item_enabled(flags, "auto_collect"):
        return {"users": 0, "skipped": "flag_off"}

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    cursor = db.users.find(
        {
            "auto_collect_until": {"$gt": now_iso},
            "is_dead": {"$ne": True},
        },
        {"_id": 0, "id": 1, "family_id": 1},
    ).limit(250)

    users = await cursor.to_list(250)
    total_props = 0
    total_rackets = 0
    for u in users:
        uid = u.get("id")
        if not uid:
            continue
        try:
            res = await run_auto_collect_for_user(db, uid, u.get("family_id"))
            total_props += len(res.get("properties") or [])
            total_rackets += len(res.get("rackets") or [])
        except Exception as e:
            logger.exception("auto_collect user %s: %s", uid, e)

    return {"users": len(users), "properties_collected": total_props, "rackets_collected": total_rackets}


async def run_auto_collect_ticker(db):
    while True:
        try:
            await run_auto_collect_tick(db)
        except Exception as e:
            logger.exception("Auto-collect ticker: %s", e)
        await asyncio.sleep(AUTO_COLLECT_TICKER_SECONDS)
