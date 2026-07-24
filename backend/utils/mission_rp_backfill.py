"""One-time rank-points top-up after mission RP tier table change."""
from __future__ import annotations

from typing import Any, Dict, Iterable, Optional, Set

from utils.missions_extended import (
    PREVIOUS_REWARD_POINTS_BY_ORDER,
    reward_points_for_order,
)

MISSION_RP_BACKFILL_FLAG = "mission_rp_backfill_tiered_v1"


def _completed_mission_ids(user: Dict[str, Any], completed_ids: Optional[Set[str]]) -> Set[str]:
    if completed_ids is not None:
        return {str(x) for x in completed_ids}
    return {
        str(row.get("mission_id"))
        for row in (user.get("mission_completions") or [])
        if row.get("mission_id")
    }


def compute_mission_rp_backfill_credit(
    user: Dict[str, Any],
    *,
    mission_by_id: Dict[str, Dict[str, Any]],
    mult: float,
    completed_ids: Optional[Iterable[str]] = None,
) -> int:
    """
    Remaining RP (new − old, never negative) for already-completed missions,
    scaled with the same int(delta * mult) rule as live mission claims.
    """
    ids = _completed_mission_ids(
        user,
        {str(x) for x in completed_ids} if completed_ids is not None else None,
    )
    m = float(mult) if mult is not None else 1.0
    total = 0
    for mid in ids:
        mission = mission_by_id.get(mid)
        if not mission:
            continue
        try:
            order = int(mission.get("order") or 0)
        except (TypeError, ValueError):
            continue
        if order < 0 or order >= len(PREVIOUS_REWARD_POINTS_BY_ORDER):
            continue
        old_rp = int(PREVIOUS_REWARD_POINTS_BY_ORDER[order])
        new_rp = int(reward_points_for_order(order))
        total += int(max(0, new_rp - old_rp) * m)
    return total
