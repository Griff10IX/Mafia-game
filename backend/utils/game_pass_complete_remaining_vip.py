"""
Reusable admin bulk grant: credit all missing VIP Game Pass micro tiers through MAX_MICRO_TIER
for users who already claimed VIP (rank_xp_pass_rewards_granted).

Idempotency: per season_id stamp in game_settings (`complete_remaining_vip_v1` → value.by_season[sid]).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from utils.game_pass_first_vip_completion import (
    aggregate_vip_increment_after_cursor,
    eligible_vip_users_filter,
    first_vip_completion_user_projection,
)
from utils.game_pass_micro_rewards import MAX_MICRO_TIER

COMPLETE_REMAINING_VIP_SETTINGS_KEY = "complete_remaining_vip_v1"
COMPLETE_REMAINING_VIP_CONFIRM_PHRASE = "COMPLETE REMAINING VIP"


async def get_complete_remaining_record(db) -> Dict[str, Any]:
    doc = await db.game_settings.find_one(
        {"key": COMPLETE_REMAINING_VIP_SETTINGS_KEY},
        {"_id": 0, "value": 1},
    )
    raw = (doc or {}).get("value")
    return raw if isinstance(raw, dict) else {}


async def get_season_completion_stamp(db, season_id: str) -> Optional[Dict[str, Any]]:
    rec = await get_complete_remaining_record(db)
    by = rec.get("by_season") if isinstance(rec.get("by_season"), dict) else {}
    stamp = by.get(str(season_id))
    return stamp if isinstance(stamp, dict) else None


async def set_season_completion_stamp(db, season_id: str, value: Dict[str, Any]) -> None:
    rec = await get_complete_remaining_record(db)
    by = dict(rec.get("by_season") or {}) if isinstance(rec.get("by_season"), dict) else {}
    by[str(season_id)] = value
    await db.game_settings.update_one(
        {"key": COMPLETE_REMAINING_VIP_SETTINGS_KEY},
        {
            "$set": {
                "key": COMPLETE_REMAINING_VIP_SETTINGS_KEY,
                "value": {**rec, "by_season": by, "last_season_id": str(season_id)},
            }
        },
        upsert=True,
    )


async def preview_complete_remaining_vip(db, *, season_id: str) -> Dict[str, Any]:
    filt = eligible_vip_users_filter()
    proj = first_vip_completion_user_projection()
    eligible = await db.users.count_documents(filt)
    already_complete = await db.users.count_documents(
        {**filt, "rank_xp_pass_last_granted_micro_tier": {"$gte": MAX_MICRO_TIER}},
    )
    would_grant = await db.users.count_documents(
        {
            **filt,
            "$or": [
                {"rank_xp_pass_last_granted_micro_tier": {"$lt": MAX_MICRO_TIER}},
                {"rank_xp_pass_last_granted_micro_tier": {"$exists": False}},
            ],
        },
    )
    sample: List[str] = []
    cur = (
        db.users.find(
            {
                **filt,
                "$or": [
                    {"rank_xp_pass_last_granted_micro_tier": {"$lt": MAX_MICRO_TIER}},
                    {"rank_xp_pass_last_granted_micro_tier": {"$exists": False}},
                ],
            },
            proj,
        )
        .sort("username", 1)
        .limit(25)
    )
    async for row in cur:
        u = row.get("username")
        if u:
            sample.append(str(u))
    stamp = await get_season_completion_stamp(db, season_id)
    return {
        "season_id": str(season_id),
        "eligible_vip_users": eligible,
        "would_receive_grant": would_grant,
        "already_cursor_complete": already_complete,
        "sample_usernames": sample,
        "season_completion_stamp": stamp,
    }


def aggregate_vip_increment_after_cursor_for_season(
    last_granted: int,
    free_last_micro_tier_granted: int,
    *,
    season_id: Optional[str] = None,
) -> Dict[str, int]:
    """Sum vip_rewards_after_free_dedupe for tiers (last_granted+1)..MAX using season profile."""
    from utils.game_pass_micro_rewards import vip_rewards_after_free_dedupe

    last = int(last_granted or 0)
    free_last = int(free_last_micro_tier_granted or 0)
    total: Dict[str, int] = {}
    for t in range(last + 1, MAX_MICRO_TIER + 1):
        r = vip_rewards_after_free_dedupe(t, free_last, season_id=season_id)
        for k, v in r.items():
            iv = int(v or 0)
            if iv > 0:
                total[k] = total.get(k, 0) + iv
    return total


# Re-export helpers used by admin route
__all__ = [
    "COMPLETE_REMAINING_VIP_CONFIRM_PHRASE",
    "COMPLETE_REMAINING_VIP_SETTINGS_KEY",
    "aggregate_vip_increment_after_cursor",
    "aggregate_vip_increment_after_cursor_for_season",
    "eligible_vip_users_filter",
    "first_vip_completion_user_projection",
    "get_complete_remaining_record",
    "get_season_completion_stamp",
    "preview_complete_remaining_vip",
    "set_season_completion_stamp",
]
