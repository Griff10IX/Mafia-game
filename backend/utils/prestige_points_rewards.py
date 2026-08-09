"""Store points granted when reaching each account prestige level."""
from __future__ import annotations

import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)

# Points awarded the first time a player reaches each prestige level.
PRESTIGE_POINTS_REWARDS = {
    1: 2_000,
    2: 4_000,
    3: 6_000,
    4: 8_000,
    5: 10_000,
}

PRESTIGE_POINTS_PAID_THROUGH_FIELD = "prestige_points_reward_paid_through"


def points_reward_for_prestige_level(level: int) -> int:
    return int(PRESTIGE_POINTS_REWARDS.get(int(level or 0), 0) or 0)


def total_prestige_points_for_levels(*, from_level_exclusive: int, to_level_inclusive: int) -> int:
    """Sum rewards for levels (from_level_exclusive + 1) .. to_level_inclusive."""
    start = max(1, int(from_level_exclusive or 0) + 1)
    end = min(5, int(to_level_inclusive or 0))
    if end < start:
        return 0
    return sum(points_reward_for_prestige_level(lvl) for lvl in range(start, end + 1))


async def grant_pending_prestige_points_rewards(
    db,
    user: Dict[str, Any],
    *,
    send_notification=None,
    reason: str = "prestige",
) -> Dict[str, Any]:
    """
    Grant any unpaid prestige point rewards up to the user's current prestige_level.
    Idempotent via prestige_points_reward_paid_through. Skips dead accounts.
    """
    uid = str((user or {}).get("id") or "").strip()
    if not uid:
        return {"granted": 0, "points": 0, "skipped": "no_user"}
    if user.get("is_dead"):
        return {"granted": 0, "points": 0, "skipped": "dead"}

    # Prefer fresh DB row so activate / backfill stay accurate.
    fresh = await db.users.find_one(
        {"id": uid},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "is_dead": 1,
            "points": 1,
            "prestige_level": 1,
            PRESTIGE_POINTS_PAID_THROUGH_FIELD: 1,
        },
    )
    if not fresh:
        return {"granted": 0, "points": 0, "skipped": "not_found"}
    if fresh.get("is_dead"):
        return {"granted": 0, "points": 0, "skipped": "dead"}

    level = min(5, max(0, int(fresh.get("prestige_level") or 0)))
    paid = max(0, int(fresh.get(PRESTIGE_POINTS_PAID_THROUGH_FIELD) or 0))
    if level <= 0:
        return {"granted": 0, "points": 0, "skipped": "no_prestige"}
    if paid >= level:
        return {"granted": 0, "points": 0, "skipped": "already_paid"}

    points = total_prestige_points_for_levels(from_level_exclusive=paid, to_level_inclusive=level)
    if points <= 0:
        await db.users.update_one(
            {"id": uid},
            {"$set": {PRESTIGE_POINTS_PAID_THROUGH_FIELD: level}},
        )
        return {"granted": 0, "points": 0, "skipped": "zero"}

    before_points = int(fresh.get("points") or 0)
    res = await db.users.update_one(
        {
            "id": uid,
            "is_dead": {"$ne": True},
            "prestige_level": {"$gte": level},
            "$or": [
                {PRESTIGE_POINTS_PAID_THROUGH_FIELD: {"$exists": False}},
                {PRESTIGE_POINTS_PAID_THROUGH_FIELD: None},
                {PRESTIGE_POINTS_PAID_THROUGH_FIELD: {"$lt": level}},
            ],
        },
        {
            "$inc": {"points": points},
            "$set": {PRESTIGE_POINTS_PAID_THROUGH_FIELD: level},
        },
    )
    if res.modified_count <= 0:
        return {"granted": 0, "points": 0, "skipped": "race_or_already_paid"}

    after_points = before_points + points
    levels_from = paid + 1
    try:
        from utils.point_provenance import log_points_event

        await log_points_event(
            db,
            user_id=uid,
            points=points,
            event_type="prestige_level_points",
            event_ref=f"prestige_points:{uid}:{levels_from}-{level}",
            source="prestige",
            wallet_points_before=before_points,
            wallet_points_after=after_points,
            meta={
                "reason": reason,
                "from_paid_through": paid,
                "to_level": level,
                "levels_from": levels_from,
                "levels_to": level,
                "rewards": {
                    str(lvl): points_reward_for_prestige_level(lvl)
                    for lvl in range(levels_from, level + 1)
                },
            },
        )
    except Exception:
        logger.exception("prestige points provenance failed user_id=%s", uid)

    if send_notification and reason == "backfill":
        try:
            levels_label = (
                f"Prestige {paid + 1}"
                if paid + 1 == level
                else f"Prestige {paid + 1}–{level}"
            )
            await send_notification(
                uid,
                "Prestige points reward",
                f"You received {points:,} points for {levels_label} (retroactive reward).",
                "reward",
            )
        except Exception:
            logger.exception("prestige points backfill notify failed user_id=%s", uid)

    return {
        "granted": 1,
        "points": points,
        "from_paid_through": paid,
        "to_level": level,
        "username": fresh.get("username"),
    }


async def backfill_alive_prestige_points_rewards(db, *, send_notification=None) -> Dict[str, Any]:
    """Grant unpaid prestige point rewards to all living prestiged accounts."""
    cursor = db.users.find(
        {
            "is_dead": {"$ne": True},
            "prestige_level": {"$gte": 1},
            "$or": [
                {PRESTIGE_POINTS_PAID_THROUGH_FIELD: {"$exists": False}},
                {PRESTIGE_POINTS_PAID_THROUGH_FIELD: None},
                {"$expr": {"$lt": [f"${PRESTIGE_POINTS_PAID_THROUGH_FIELD}", "$prestige_level"]}},
            ],
        },
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "prestige_level": 1,
            "is_dead": 1,
            PRESTIGE_POINTS_PAID_THROUGH_FIELD: 1,
        },
    )
    users = await cursor.to_list(20_000)
    granted_users = 0
    total_points = 0
    for u in users:
        out = await grant_pending_prestige_points_rewards(
            db, u, send_notification=send_notification, reason="backfill"
        )
        if int(out.get("granted") or 0) > 0:
            granted_users += 1
            total_points += int(out.get("points") or 0)
    return {
        "candidates": len(users),
        "granted_users": granted_users,
        "total_points": total_points,
    }
