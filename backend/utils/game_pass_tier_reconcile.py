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
    micro_tier_for_vip_game_pass,
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

    current_micro = micro_tier_for_vip_game_pass(user)
    last_granted = int(user.get("rank_xp_pass_last_granted_micro_tier") or 0)

    cursor_repaired = False
    if last_granted > current_micro:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"rank_xp_pass_last_granted_micro_tier": 0}},
        )
        cursor_repaired = True
        last_granted = 0

    if current_micro <= last_granted:
        return {
            "ok": True,
            "reason": "already_caught_up",
            "tiers_granted": [],
            "current_micro": current_micro,
            "last_granted": last_granted,
        }

    free_cash_last_micro = int(user.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
    grant_season_id = str(user.get("game_pass_season_id") or "").strip() or None

    from routers.kill.armoury import _try_grant_rank_xp_pass_micro_tier

    for t in range(last_granted + 1, current_micro + 1):
        applied = await _try_grant_rank_xp_pass_micro_tier(
            db,
            user_id=user_id,
            micro_tier=t,
            free_cash_last_micro_tier_granted=free_cash_last_micro,
            season_id=grant_season_id,
        )
        if not applied:
            continue

        tiers_granted.append(t)

        if not send_notifications:
            continue

        next_t = t + 1 if t < MAX_MICRO_TIER else None
        if next_t is None:
            next_summary = "Max tier reached"
        else:
            next_rewards = rewards_for_micro_tier(next_t, season_id=grant_season_id)
            next_summary = f"Tier {next_t} rewards: {format_rewards_summary(next_rewards)}"

        received_parts = []
        granted_keys = []
        for reward_key in REWARD_KEY_ORDER:
            amount = int(applied.get(reward_key) or 0)
            if amount <= 0:
                continue
            granted_keys.append(reward_key)
            if reward_key == "money":
                received_parts.append(f"${amount:,} cash")
            elif reward_key in ("bullets", "points", "respect_points"):
                received_parts.append(f"{amount:,} {REWARD_KEY_LABELS.get(reward_key, reward_key)}")
            else:
                received_parts.append(f"{amount:,}x {REWARD_KEY_LABELS.get(reward_key, reward_key)}")
        if received_parts:
            blob = "; ".join(received_parts)
            await send_notification(
                user_id,
                "Game Pass reward",
                f"You received {blob}. Next reward: {next_summary}.",
                "reward",
                tier_micro=t,
                next_tier=next_t,
                reward_keys=granted_keys,
            )

    reason = "granted" if tiers_granted else "no_new_tiers"
    if cursor_repaired:
        reason = "cursor_repaired"

    return {
        "ok": True,
        "reason": reason,
        "tiers_granted": tiers_granted,
        "current_micro": current_micro,
        "last_granted_before": last_granted,
        "cursor_repaired": cursor_repaired,
    }
