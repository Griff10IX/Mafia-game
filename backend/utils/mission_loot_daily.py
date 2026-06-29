"""Per-mission daily loot box pieces (tribute) helpers and one-time backfill."""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Set

MISSION_LOOT_DAILY_BACKFILL_FLAG = "mission_loot_daily_backfill_v1"


def daily_loot_for_mission(mission: Optional[Dict[str, Any]]) -> int:
    if not mission:
        return 0
    return int(mission.get("reward_tribute_loot_box_pieces_daily") or 0)


def daily_loot_for_completed_ids(completed_ids: Iterable[str], mission_by_id: Dict[str, Dict[str, Any]]) -> int:
    total = 0
    for mid in completed_ids:
        total += daily_loot_for_mission(mission_by_id.get(mid))
    return total


async def ensure_mission_loot_daily_backfill(
    db,
    user: Dict[str, Any],
    *,
    mission_by_id: Dict[str, Dict[str, Any]],
    completed_ids: Optional[Set[str]] = None,
) -> bool:
    """
    One-time: credit tribute_loot_box_pieces equal to one day's mission loot income
    for all missions the user already completed (matches new per-mission daily table).
    """
    if user.get(MISSION_LOOT_DAILY_BACKFILL_FLAG):
        return False
    uid = user.get("id")
    if not uid:
        return False
    ids = completed_ids
    if ids is None:
        ids = {
            str(row.get("mission_id"))
            for row in (user.get("mission_completions") or [])
            if row.get("mission_id")
        }
    credit = daily_loot_for_completed_ids(ids, mission_by_id)
    update: Dict[str, Any] = {MISSION_LOOT_DAILY_BACKFILL_FLAG: True}
    op: Dict[str, Any] = {"$set": update}
    if credit > 0:
        op["$inc"] = {"tribute_loot_box_pieces": credit}
    await db.users.update_one({"id": uid}, op)
    return credit > 0
