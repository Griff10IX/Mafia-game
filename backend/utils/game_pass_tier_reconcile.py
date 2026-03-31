"""
VIP Game Pass: grant missing micro-tier rewards (same rules as server middleware).

Used by server.py on each authenticated request and by admin reconcile endpoint.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from utils.game_pass_micro_rewards import (
    MAX_MICRO_TIER,
    REWARD_KEY_LABELS,
    REWARD_KEY_ORDER,
    format_rewards_summary,
    free_unlocked_key_for_micro_tier,
    micro_tier_from_rank_points,
    rewards_for_micro_tier,
)


async def grant_missing_vip_micro_tier_rewards(
    db,
    user_id: str,
    user: dict,
    *,
    send_notifications: bool = True,
    ignore_token_expiry: bool = False,
) -> Dict[str, Any]:
    """
    Grant VIP tier rewards for tiers (last_granted+1)..current_micro.

    - not_vip_claimed: user never activated Game Pass (rewards_granted != True)
    - vip_token_expired_or_inactive: token expiry passed (unless ignore_token_expiry)
    - already_caught_up: last_granted >= current_micro
    """
    from server import send_notification  # lazy import avoids circular load

    tiers_granted: List[int] = []
    if user.get("rank_xp_pass_rewards_granted") is not True:
        return {"ok": False, "reason": "not_vip_claimed", "tiers_granted": []}

    now = datetime.now(timezone.utc)
    expires_raw = user.get("rank_xp_pass_token_expires_at")
    vip_expires_dt = None
    if expires_raw:
        try:
            vip_expires_dt = datetime.fromisoformat(str(expires_raw).replace("Z", "+00:00"))
            if vip_expires_dt.tzinfo is None:
                vip_expires_dt = vip_expires_dt.replace(tzinfo=timezone.utc)
        except Exception:
            vip_expires_dt = None

    vip_active = True if vip_expires_dt is None else bool(vip_expires_dt > now)
    if not ignore_token_expiry and not vip_active:
        return {"ok": False, "reason": "vip_token_expired_or_inactive", "tiers_granted": []}

    current_micro = micro_tier_from_rank_points(user.get("rank_points"))
    last_granted = int(user.get("rank_xp_pass_last_granted_micro_tier") or 0)
    if current_micro <= last_granted:
        return {
            "ok": True,
            "reason": "already_caught_up",
            "tiers_granted": [],
            "current_micro": current_micro,
            "last_granted": last_granted,
        }

    free_cash_last_micro = int(user.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
    now_iso = now.isoformat()
    if ignore_token_expiry or vip_expires_dt is None:
        expiry_filter: Dict[str, Any] = {}
    else:
        expiry_filter = {"rank_xp_pass_token_expires_at": {"$gt": now_iso}}

    for t in range(last_granted + 1, current_micro + 1):
        rewards = rewards_for_micro_tier(t)
        if free_cash_last_micro >= t:
            free_key = free_unlocked_key_for_micro_tier(t, rewards)
            if free_key:
                rewards[free_key] = 0
        inc = {k: int(v) for k, v in rewards.items() if int(v or 0) > 0}

        updated = await db.users.update_one(
            {
                "id": user_id,
                "rank_xp_pass_rewards_granted": True,
                **expiry_filter,
                "$or": [
                    {"rank_xp_pass_last_granted_micro_tier": {"$lt": t}},
                    {"rank_xp_pass_last_granted_micro_tier": {"$exists": False}},
                ],
            },
            {
                "$set": {"rank_xp_pass_last_granted_micro_tier": t},
                **({"$inc": inc} if inc else {}),
            },
        )
        if updated.modified_count == 0:
            continue

        tiers_granted.append(t)

        if not send_notifications:
            continue

        next_t = t + 1 if t < MAX_MICRO_TIER else None
        if next_t is None:
            next_summary = "Max tier reached"
        else:
            next_rewards = rewards_for_micro_tier(next_t)
            next_summary = f"Tier {next_t} rewards: {format_rewards_summary(next_rewards)}"

        for reward_key in REWARD_KEY_ORDER:
            amount = int(rewards.get(reward_key) or 0)
            if amount <= 0:
                continue
            if reward_key == "money":
                received_text = f"${amount:,} cash"
            elif reward_key in ("bullets", "points", "respect_points"):
                received_text = f"{amount:,} {REWARD_KEY_LABELS.get(reward_key, reward_key)}"
            else:
                received_text = f"{amount:,}x {REWARD_KEY_LABELS.get(reward_key, reward_key)}"

            await send_notification(
                user_id,
                "Game Pass reward",
                f"You received {received_text}. Next reward: {next_summary}.",
                "reward",
                category="system",
                reward_key=reward_key,
                tier_micro=t,
                next_tier=next_t,
            )

    return {
        "ok": True,
        "reason": "granted" if tiers_granted else "no_new_tiers",
        "tiers_granted": tiers_granted,
        "current_micro": current_micro,
        "last_granted_before": last_granted,
    }
