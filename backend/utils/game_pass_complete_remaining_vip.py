"""
Reusable admin bulk grant: credit all missing VIP Game Pass micro tiers through MAX_MICRO_TIER
for users who already claimed VIP (rank_xp_pass_rewards_granted).

Idempotency: per season_id stamp in game_settings (`complete_remaining_vip_v1` → value.by_season[sid]).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from utils.game_pass_first_vip_completion import (
    aggregate_vip_increment_after_cursor,
    eligible_incomplete_vip_users_filter,
    eligible_vip_users_filter,
    first_vip_completion_user_projection,
)
from utils.game_pass_micro_rewards import MAX_MICRO_TIER

COMPLETE_REMAINING_VIP_SETTINGS_KEY = "complete_remaining_vip_v1"
COMPLETE_REMAINING_VIP_CONFIRM_PHRASE = "COMPLETE REMAINING VIP"
GHOSTFACE_USERNAME = "GhostFace"


def complete_remaining_vip_users_filter() -> Dict[str, Any]:
    """Season close-out: paid VIP incomplete includes dead; excludes NPCs."""
    return eligible_incomplete_vip_users_filter(include_dead=True)


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
    filt = complete_remaining_vip_users_filter()
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
        .limit(50)
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
        "include_dead": True,
        "season_completion_stamp": stamp,
    }


async def send_ghostface_complete_remaining_preview(
    db,
    *,
    send_notification,
    season_id: str,
    preview: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Inbox GhostFace a PREVIEW of the player close-out message + who/count."""
    data = preview or await preview_complete_remaining_vip(db, season_id=season_id)
    gf = await db.users.find_one(
        {"username": GHOSTFACE_USERNAME},
        {"_id": 0, "id": 1, "username": 1},
    )
    if not gf or not gf.get("id"):
        return {"ok": False, "error": f"{GHOSTFACE_USERNAME} not found"}
    n = int(data.get("would_receive_grant") or 0)
    sample = data.get("sample_usernames") or []
    sample_bit = ", ".join(sample[:25]) if sample else "(none)"
    player_body = (
        f"Season close-out: all remaining VIP Game Pass tier rewards through tier {MAX_MICRO_TIER} "
        f"have been credited (season {season_id})."
    )
    body = (
        f"PREVIEW — Game Pass season complete (not a grant to you).\n\n"
        f"Would credit {n} VIP player(s) for season {season_id} (includes dead).\n"
        f"Sample: {sample_bit}\n\n"
        f"Player message will look like:\n{player_body}"
    )
    await send_notification(
        str(gf["id"]),
        "PREVIEW — Game Pass season complete",
        body,
        "info",
        season_id=str(season_id),
        preview=True,
    )
    return {
        "ok": True,
        "ghostface_user_id": str(gf["id"]),
        "would_receive_grant": n,
        "sample_usernames": sample,
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
    "GHOSTFACE_USERNAME",
    "aggregate_vip_increment_after_cursor",
    "aggregate_vip_increment_after_cursor_for_season",
    "complete_remaining_vip_users_filter",
    "eligible_incomplete_vip_users_filter",
    "eligible_vip_users_filter",
    "first_vip_completion_user_projection",
    "get_complete_remaining_record",
    "get_season_completion_stamp",
    "preview_complete_remaining_vip",
    "send_ghostface_complete_remaining_preview",
    "set_season_completion_stamp",
]
