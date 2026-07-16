"""Per-mission daily loot box pieces (tribute) helpers and one-time backfill."""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Set

MISSION_LOOT_DAILY_BACKFILL_FLAG = "mission_loot_daily_backfill_v1"
# Credits the bump from 150 → 200 daily ladder total (and ≥1 piece per mission spread).
MISSION_LOOT_DAILY_BACKFILL_V2_FLAG = "mission_loot_daily_backfill_v2_200"


def daily_loot_for_mission(mission: Optional[Dict[str, Any]]) -> int:
    if not mission:
        return 0
    return int(mission.get("reward_tribute_loot_box_pieces_daily") or 0)


def daily_loot_for_completed_ids(completed_ids: Iterable[str], mission_by_id: Dict[str, Dict[str, Any]]) -> int:
    total = 0
    for mid in completed_ids:
        total += daily_loot_for_mission(mission_by_id.get(mid))
    return total


def _completed_mission_ids(user: Dict[str, Any], completed_ids: Optional[Set[str]]) -> Set[str]:
    if completed_ids is not None:
        return {str(x) for x in completed_ids}
    return {
        str(row.get("mission_id"))
        for row in (user.get("mission_completions") or [])
        if row.get("mission_id")
    }


def _legacy_loot_for_completed(
    completed_ids: Set[str],
    mission_by_id: Dict[str, Dict[str, Any]],
) -> int:
    """What v1 backfill credited under the old 150-piece weighted table."""
    from utils.missions_extended import legacy_loot_pieces_daily_by_order

    legacy = legacy_loot_pieces_daily_by_order()
    total = 0
    for mid in completed_ids:
        m = mission_by_id.get(mid)
        if not m:
            continue
        try:
            order = int(m.get("order") or 0)
        except (TypeError, ValueError):
            continue
        if 0 <= order < len(legacy):
            total += int(legacy[order])
    return total


async def ensure_mission_loot_daily_backfill(
    db,
    user: Dict[str, Any],
    *,
    mission_by_id: Dict[str, Dict[str, Any]],
    completed_ids: Optional[Set[str]] = None,
) -> bool:
    """
    One-time tribute_loot_box_pieces credits for mission daily loot table changes.
    - v1: first-time credit of then-current daily loot for completed missions.
    - v2: credit the difference after raising the ladder total 150 → 200 (and re-spreading).
    Returns True if any pieces were credited.
    """
    uid = user.get("id")
    if not uid:
        return False

    ids = _completed_mission_ids(user, completed_ids)
    new_total = daily_loot_for_completed_ids(ids, mission_by_id)
    has_v1 = bool(user.get(MISSION_LOOT_DAILY_BACKFILL_FLAG))
    has_v2 = bool(user.get(MISSION_LOOT_DAILY_BACKFILL_V2_FLAG))

    credit = 0
    set_fields: Dict[str, Any] = {}

    if not has_v1 and not has_v2:
        # Never backfilled: grant full current table once.
        credit = new_total
        set_fields[MISSION_LOOT_DAILY_BACKFILL_FLAG] = True
        set_fields[MISSION_LOOT_DAILY_BACKFILL_V2_FLAG] = True
    elif has_v1 and not has_v2:
        # Already got 150-table credit; top up to 200-table for completed missions.
        old_total = _legacy_loot_for_completed(ids, mission_by_id)
        credit = max(0, new_total - old_total)
        set_fields[MISSION_LOOT_DAILY_BACKFILL_V2_FLAG] = True
    else:
        return False

    op: Dict[str, Any] = {"$set": set_fields}
    if credit > 0:
        op["$inc"] = {"tribute_loot_box_pieces": credit}
    await db.users.update_one({"id": uid}, op)
    return credit > 0
