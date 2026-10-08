"""One-time System AI reward when an account completes every mission on the ladder."""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from pymongo import ReturnDocument

from utils.missions_extended import build_missions

logger = logging.getLogger(__name__)

CLAIM_FIELD = "mission_ladder_complete_reward_at"
PRESTIGE_CLAIM_FIELD = "mission_prestige_ladder_complete_reward_at"
PRESTIGE_REWARD_MULT = 2
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


def reward_scaled(mult: int) -> Dict[str, int]:
    return {k: int(v) * int(mult) for k, v in LADDER_REWARD.items()}


def _reward_lines(reward: Dict[str, Any]) -> str:
    return (
        f"- {int(reward['points']):,} points\n"
        f"- {int(reward['loot_box_pieces']):,} loot box pieces\n"
        f"- ${int(reward['money']):,}\n"
        f"- {int(reward['wheel_bonus_free_spins'])} free Wheel of Fortune spins\n"
        f"- {int(reward['robot_bodyguard_hire_tokens'])} free Robot Bodyguard tokens\n"
        f"- {int(reward['bullets']):,} bullets"
    )


def _message(name: str) -> str:
    total = len(_LADDER_IDS)
    return (
        f"{name},\n\n"
        "This is the System AI.\n\n"
        f"Congratulations on completing every single mission on the ladder ({total}/{total}). "
        "Not many make it to the end. You did.\n\n"
        "Your reward is already on your account:\n"
        f"{_reward_lines(LADDER_REWARD)}\n\n"
        "Well earned. Spend it wisely.\n\n"
        "— System AI"
    )


def _prestige_message(name: str, reward: Dict[str, Any]) -> str:
    return (
        f"{name},\n\n"
        "This is the System AI.\n\n"
        "You finished the prestiged mission ladder. "
        "That pays double the reward for completing the first 100 missions.\n\n"
        "Your reward is already on your account:\n"
        f"{_reward_lines(reward)}\n\n"
        "The prestige passives are on as well.\n\n"
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

    return await _pay_bundle(
        db,
        user,
        LADDER_REWARD,
        claim_field=CLAIM_FIELD,
        event_type="system_ai_all_missions_reward",
        origin_ref=f"mission_ladder_complete_reward:{user_id}",
        title="All missions complete",
        message=_message((user.get("username") or "").strip() or "Player"),
        reason="all_missions_complete",
    )


async def maybe_grant_prestige_ladder_complete_reward(db, user_id: str) -> Optional[Dict[str, Any]]:
    """Pay double the first-ladder finish reward once the prestiged ladder is complete."""
    user = await db.users.find_one(
        {"id": user_id},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "is_npc": 1,
            "is_bodyguard": 1,
            "mission_prestige_complete_at": 1,
            PRESTIGE_CLAIM_FIELD: 1,
        },
    )
    if not user or user.get(PRESTIGE_CLAIM_FIELD) or user.get("is_npc") or user.get("is_bodyguard"):
        return None
    if not user.get("mission_prestige_complete_at"):
        return None
    reward = reward_scaled(PRESTIGE_REWARD_MULT)
    name = (user.get("username") or "").strip() or "Player"
    return await _pay_bundle(
        db,
        user,
        reward,
        claim_field=PRESTIGE_CLAIM_FIELD,
        event_type="system_ai_prestige_missions_reward",
        origin_ref=f"mission_prestige_ladder_complete_reward:{user_id}",
        title="Prestige missions complete",
        message=_prestige_message(name, reward),
        reason="prestige_missions_complete",
    )


async def _pay_bundle(
    db,
    user: Dict[str, Any],
    reward: Dict[str, int],
    *,
    claim_field: str,
    event_type: str,
    origin_ref: str,
    title: str,
    message: str,
    reason: str,
) -> Optional[Dict[str, Any]]:
    user_id = user.get("id") or ""
    now_iso = datetime.now(timezone.utc).isoformat()
    inc = {k: (float(v) if k == "money" else v) for k, v in reward.items()}
    before = await db.users.find_one_and_update(
        {"id": user_id, claim_field: {"$exists": False}},
        {"$inc": inc, "$set": {claim_field: now_iso}},
        projection={"_id": 0, "points": 1},
        return_document=ReturnDocument.BEFORE,
    )
    if not before:
        return None

    name = (user.get("username") or "").strip() or "Player"
    pts_before = int(before.get("points") or 0)
    points = int(reward["points"])
    try:
        await db.point_ledger_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "event_type": event_type,
                "user_id": user_id,
                "points": points,
                "lot_id": None,
                "origin_ref": origin_ref,
                "root_purchase_ref": None,
                "meta": {"reason": reason, **{k: v for k, v in reward.items() if k != "points"}},
                "created_at": now_iso,
                "wallet_points_before": pts_before,
                "wallet_points_after": pts_before + points,
                "source": "system_ai",
            }
        )
        await db.notifications.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "title": title,
                "message": message,
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
    logger.info("mission ladder reward %s paid to %s (%s)", reason, name, user_id)
    return dict(reward)
