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
    """Live VIP Pass Car inventory + grant-source breakdown + per-car owners."""
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

    garage_rows = await db.user_cars.find(
        {"car_id": GAME_PASS_VIP_CAR_ID},
        {
            "_id": 0,
            "id": 1,
            "user_id": 1,
            "acquired_at": 1,
            "listed_for_sale": 1,
            "damage_percent": 1,
            "custom_image_url": 1,
        },
    ).to_list(200)
    uid_list = sorted({str(r.get("user_id") or "") for r in (garage_rows or []) if r.get("user_id")})
    users = []
    if uid_list:
        users = await db.users.find(
            {"id": {"$in": uid_list}},
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "is_dead": 1,
                "game_pass_vip_car_granted": 1,
            },
        ).to_list(300)
    user_by_id = {str(u.get("id")): u for u in (users or []) if u.get("id")}
    owners = []
    for row in garage_rows or []:
        uid = str(row.get("user_id") or "")
        u = user_by_id.get(uid) or {}
        owners.append(
            {
                "user_car_id": row.get("id"),
                "user_id": uid,
                "username": u.get("username") or "?",
                "is_dead": bool(u.get("is_dead")),
                "game_pass_vip_car_granted": bool(u.get("game_pass_vip_car_granted")),
                "acquired_at": row.get("acquired_at"),
                "listed_for_sale": bool(row.get("listed_for_sale")),
                "damage_percent": float(row.get("damage_percent") or 0),
                "has_custom_image": bool(row.get("custom_image_url")),
            }
        )
    owners.sort(key=lambda o: ((o.get("username") or "").lower(), str(o.get("acquired_at") or "")))

    return {
        "cars_in_game": cars_in_game,
        "owner_accounts": owner_accounts,
        "game_pass_granted_accounts": game_pass_granted_accounts,
        "store_purchase_grants": store_grants,
        "game_pass_tier_100_grants": game_pass_grants,
        "other_grants": other_grants,
        "grants_by_type": grants_by_type,
        "purchase_limit": await get_vip_pass_car_purchase_limit(db),
        "owners": owners,
    }


async def admin_remove_vip_pass_cars(
    db,
    *,
    user_id: Optional[str] = None,
    user_car_id: Optional[str] = None,
    clear_game_pass_grant: bool = False,
    admin_username: Optional[str] = None,
) -> dict:
    """
    Remove VIP Pass Car(s) from inventory.
    Prefer user_car_id for a single row; otherwise remove all for user_id.
    """
    if not user_car_id and not user_id:
        return {"removed_count": 0, "removed": []}

    query: dict = {"car_id": GAME_PASS_VIP_CAR_ID}
    if user_car_id:
        query["id"] = str(user_car_id)
    if user_id:
        query["user_id"] = str(user_id)

    rows = await db.user_cars.find(
        query,
        {"_id": 0, "id": 1, "user_id": 1, "car_name": 1},
    ).to_list(50)
    if not rows:
        return {"removed_count": 0, "removed": []}

    removed = []
    affected_user_ids = set()
    for row in rows:
        ucid = row.get("id")
        uid = row.get("user_id")
        if not ucid or not uid:
            continue
        del_res = await db.user_cars.delete_one({"id": ucid, "user_id": uid, "car_id": GAME_PASS_VIP_CAR_ID})
        if int(del_res.deleted_count or 0) <= 0:
            continue
        affected_user_ids.add(uid)
        removed.append({"user_car_id": ucid, "user_id": uid})
        try:
            from utils.exclusive_car_events import log_exclusive_car_event

            u = await db.users.find_one({"id": uid}, {"_id": 0, "username": 1})
            await log_exclusive_car_event(
                db,
                event_type="admin_remove",
                car_id=GAME_PASS_VIP_CAR_ID,
                user_car_id=ucid,
                from_user_id=uid,
                from_username=(u or {}).get("username"),
                car_name=row.get("car_name") or "VIP Pass Car",
                extra={"admin_username": admin_username or "?", "clear_game_pass_grant": bool(clear_game_pass_grant)},
            )
        except Exception:
            logger.exception("admin_remove vip pass car event log failed user_car_id=%s", ucid)

    if clear_game_pass_grant and affected_user_ids:
        await db.users.update_many(
            {"id": {"$in": list(affected_user_ids)}},
            {"$unset": {"game_pass_vip_car_granted": ""}},
        )

    return {
        "removed_count": len(removed),
        "removed": removed,
        "cars_in_game": await count_global_vip_pass_cars(db),
        "cleared_game_pass_grant": bool(clear_game_pass_grant and affected_user_ids),
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
