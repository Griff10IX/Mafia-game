"""
One-time admin bulk grant: credit all missing VIP Game Pass micro tiers through MAX_MICRO_TIER
for users who already claimed VIP (rank_xp_pass_rewards_granted).

Idempotency: game_settings key `first_game_pass_vip_completion_v1` after first successful live run.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from utils.game_pass_micro_rewards import MAX_MICRO_TIER

FIRST_GAME_PASS_VIP_COMPLETION_KEY = "first_game_pass_vip_completion_v1"
FIRST_GAME_PASS_CONFIRM_PHRASE = "FIRST GAME PASS COMPLETE"


def eligible_vip_users_filter() -> Dict[str, Any]:
    return {
        "rank_xp_pass_rewards_granted": True,
        "is_dead": {"$ne": True},
        "is_npc": {"$ne": True},
    }


def first_vip_completion_user_projection() -> Dict[str, int]:
    return {
        "_id": 0,
        "id": 1,
        "username": 1,
        "rank_xp_pass_last_granted_micro_tier": 1,
        "rank_xp_pass_free_last_micro_tier_granted": 1,
        "points": 1,
    }


def aggregate_vip_increment_after_cursor(
    last_granted: int,
    free_last_micro_tier_granted: int,
) -> Dict[str, int]:
    """Sum vip_rewards_after_free_dedupe for tiers (last_granted+1)..MAX_MICRO_TIER."""
    from utils.game_pass_micro_rewards import MAX_MICRO_TIER, vip_rewards_after_free_dedupe

    last = int(last_granted or 0)
    free_last = int(free_last_micro_tier_granted or 0)
    total: Dict[str, int] = {}
    for t in range(last + 1, MAX_MICRO_TIER + 1):
        r = vip_rewards_after_free_dedupe(t, free_last)
        for k, v in r.items():
            iv = int(v or 0)
            if iv > 0:
                total[k] = total.get(k, 0) + iv
    return total


async def get_first_vip_completion_record(db) -> Optional[Dict[str, Any]]:
    doc = await db.game_settings.find_one({"key": FIRST_GAME_PASS_VIP_COMPLETION_KEY}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value")
    return raw if isinstance(raw, dict) else None


async def set_first_vip_completion_record(db, value: Dict[str, Any]) -> None:
    await db.game_settings.update_one(
        {"key": FIRST_GAME_PASS_VIP_COMPLETION_KEY},
        {"$set": {"key": FIRST_GAME_PASS_VIP_COMPLETION_KEY, "value": value}},
        upsert=True,
    )


async def preview_first_vip_completion(db) -> Dict[str, Any]:
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
    cur = db.users.find(
        {
            **filt,
            "$or": [
                {"rank_xp_pass_last_granted_micro_tier": {"$lt": MAX_MICRO_TIER}},
                {"rank_xp_pass_last_granted_micro_tier": {"$exists": False}},
            ],
        },
        proj,
    ).sort("username", 1).limit(25)
    async for row in cur:
        u = row.get("username")
        if u:
            sample.append(str(u))
    record = await get_first_vip_completion_record(db)
    return {
        "eligible_vip_users": eligible,
        "would_receive_grant": would_grant,
        "already_cursor_complete": already_complete,
        "sample_usernames": sample,
        "completion_record": record,
    }
