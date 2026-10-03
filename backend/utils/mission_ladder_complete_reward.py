"""One-time System AI reward when an account completes every mission on the ladder."""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from pymongo import ReturnDocument

from utils.missions_extended import build_missions

logger = logging.getLogger(__name__)

CLAIM_FIELD = "mission_ladder_complete_reward_at"
LADDER_REWARD = {
    "points": 25_000,
    "loot_box_pieces": 7_000,
    "money": 75_000_000_000,
    "wheel_bonus_free_spins": 5,
    "robot_bodyguard_hire_tokens": 5,
    "bullets": 125_000,
}
SYSTEM_AI_AVATAR = "/images/system-ai-profile.jpg?v=5"
_LADDER_IDS = frozenset(m["id"] for m in build_missions())


def _message(name: str) -> str:
    r = LADDER_REWARD
    total = len(_LADDER_IDS)
    return (
        f"{name},\n\n"
        "This is the System AI.\n\n"
        f"Congratulations on completing every single mission on the ladder ({total}/{total}). "
        "Not many make it to the end. You did.\n\n"
        "Your reward is already on your account:\n"
        f"- {r['points']:,} points\n"
        f"- {r['loot_box_pieces']:,} loot box pieces\n"
        f"- ${r['money']:,}\n"
        f"- {r['wheel_bonus_free_spins']} free Wheel of Fortune spins\n"
        f"- {r['robot_bodyguard_hire_tokens']} free Robot Bodyguard tokens\n"
        f"- {r['bullets']:,} bullets\n\n"
        "Well earned. Spend it wisely.\n\n"
        "— System AI"
    )


async def maybe_grant_ladder_complete_reward(db, user_id: str) -> Optional[Dict[str, Any]]:
    """Pay the ladder reward once per account; no-op until every mission is complete."""
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "id": 1, "username": 1, "mission_completions": 1, "is_npc": 1, "is_bodyguard": 1, CLAIM_FIELD: 1},
    )
    if not user or user.get(CLAIM_FIELD) or user.get("is_npc") or user.get("is_bodyguard"):
        return None
    done = {r.get("mission_id") for r in (user.get("mission_completions") or []) if r.get("mission_id")}
    if not _LADDER_IDS.issubset(done):
        return None

    now_iso = datetime.now(timezone.utc).isoformat()
    inc = {k: (float(v) if k == "money" else v) for k, v in LADDER_REWARD.items()}
    before = await db.users.find_one_and_update(
        {"id": user_id, CLAIM_FIELD: {"$exists": False}},
        {"$inc": inc, "$set": {CLAIM_FIELD: now_iso}},
        projection={"_id": 0, "points": 1},
        return_document=ReturnDocument.BEFORE,
    )
    if not before:
        return None

    name = (user.get("username") or "").strip() or "Player"
    pts_before = int(before.get("points") or 0)
    try:
        await db.point_ledger_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "event_type": "system_ai_all_missions_reward",
                "user_id": user_id,
                "points": LADDER_REWARD["points"],
                "lot_id": None,
                "origin_ref": f"mission_ladder_complete_reward:{user_id}",
                "root_purchase_ref": None,
                "meta": {"reason": "all_missions_complete", **{k: v for k, v in LADDER_REWARD.items() if k != "points"}},
                "created_at": now_iso,
                "wallet_points_before": pts_before,
                "wallet_points_after": pts_before + LADDER_REWARD["points"],
                "source": "system_ai",
            }
        )
        await db.notifications.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "title": "All missions complete",
                "message": _message(name),
                "notification_type": "system",
                "category": "system",
                "read": False,
                "created_at": now_iso,
                "system_ai": True,
                "avatar_url": SYSTEM_AI_AVATAR,
            }
        )
    except Exception:
        logger.exception("ladder reward ledger/inbox failed for %s (reward already paid)", user_id)
    logger.info("mission ladder complete reward paid to %s (%s)", name, user_id)
    return dict(LADDER_REWARD)
