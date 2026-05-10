import logging
from datetime import datetime, timezone
from typing import Any, Dict

from utils.point_provenance import log_points_event

logger = logging.getLogger(__name__)


async def resolve_user_hitlist_kill(
    db,
    *,
    killer_id: str,
    killer_username: str,
    victim_id: str,
    victim_username: str,
) -> Dict[str, Any]:
    """Pay active user bounties for a PvP kill and clear now-unattackable victim contracts."""
    entries = await db.hitlist.find(
        {"target_id": victim_id, "target_type": {"$in": ["user", "bodyguards"]}},
        {
            "_id": 0,
            "id": 1,
            "target_type": 1,
            "reward_type": 1,
            "reward_amount": 1,
            "placer_id": 1,
            "placer_username": 1,
            "hidden": 1,
        },
    ).to_list(200)
    if not entries:
        return {"cash": 0, "points": 0, "paid_count": 0, "cleared_count": 0}

    claimed_entries = []
    for entry in entries:
        entry_id = entry.get("id")
        if entry_id:
            claimed = await db.hitlist.find_one_and_delete(
                {"id": entry_id},
                projection={"_id": 0, "target_type": 1, "reward_type": 1, "reward_amount": 1},
            )
        else:
            claimed = await db.hitlist.find_one_and_delete(
                {
                    "target_id": victim_id,
                    "target_type": entry.get("target_type"),
                    "reward_type": entry.get("reward_type"),
                    "reward_amount": entry.get("reward_amount"),
                },
                projection={"_id": 0, "target_type": 1, "reward_type": 1, "reward_amount": 1},
            )
        if claimed:
            claimed_entries.append(claimed)
    if not claimed_entries:
        return {"cash": 0, "points": 0, "paid_count": 0, "cleared_count": 0}

    user_bounties = [e for e in claimed_entries if e.get("target_type") == "user"]
    reward_cash = sum(int(e.get("reward_amount") or 0) for e in user_bounties if e.get("reward_type") == "cash")
    reward_points = sum(int(e.get("reward_amount") or 0) for e in user_bounties if e.get("reward_type") == "points")

    if reward_cash > 0 or reward_points > 0:
        inc: Dict[str, int] = {}
        if reward_cash > 0:
            inc["money"] = reward_cash
        if reward_points > 0:
            inc["points"] = reward_points
        await db.users.update_one({"id": killer_id}, {"$inc": inc})

    if reward_points > 0:
        await log_points_event(
            db,
            user_id=killer_id,
            points=reward_points,
            event_type="hitlist_kill_reward",
            event_ref=f"victim:{victim_id}",
            meta={"victim_username": victim_username, "bounty_count": len(user_bounties)},
        )

    try:
        await db.hitlist_bodyguard_events.insert_one({
            "at": datetime.now(timezone.utc).isoformat(),
            "type": "hitlist_user_killed",
            "killer_id": killer_id,
            "killer_username": killer_username,
            "target_id": victim_id,
            "target_username": victim_username,
            "reward_cash": reward_cash,
            "reward_points": reward_points,
            "paid_count": len(user_bounties),
            "cleared_count": len(claimed_entries),
        })
    except Exception:
        logger.exception("hitlist user kill event failed")

    return {
        "cash": reward_cash,
        "points": reward_points,
        "paid_count": len(user_bounties),
        "cleared_count": len(claimed_entries),
    }
