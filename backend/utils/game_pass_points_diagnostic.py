from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from utils.game_pass_admin_inspect import (
    GAME_PASS_USER_PROJECTION,
    classify_purchase_source,
    fetch_game_pass_payment_events,
    fetch_latest_points_game_pass_purchase,
    game_pass_derived_fields,
)
from utils.game_pass_micro_rewards import vip_rewards_after_free_dedupe


def calc_estimated_vip_points_from_granted_tiers(user_row: Dict[str, Any]) -> int:
    """Estimate cumulative VIP points from already-granted micro tiers."""
    last_granted = int(user_row.get("rank_xp_pass_last_granted_micro_tier") or 0)
    if last_granted <= 0:
        return 0
    free_last = int(user_row.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
    total = 0
    for tier in range(1, last_granted + 1):
        rewards = vip_rewards_after_free_dedupe(tier, free_last)
        total += int(rewards.get("points") or 0)
    return int(total)


async def build_game_pass_points_diagnostic(db, user_row: Dict[str, Any]) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    uid = str(user_row.get("id") or "")
    derived = game_pass_derived_fields(user_row, now_utc=now)
    stripe_events = await fetch_game_pass_payment_events(db, uid, limit=10)
    points_purchase = await fetch_latest_points_game_pass_purchase(db, uid)
    purchase_source = classify_purchase_source(
        stripe_events,
        user_row,
        has_points_game_pass_ledger=bool(points_purchase),
    )
    estimated_points_awarded = calc_estimated_vip_points_from_granted_tiers(user_row)
    return {
        "user": {
            "id": uid,
            "username": user_row.get("username"),
            "points_balance": int(user_row.get("points") or 0),
        },
        "entitlement_state": {
            "purchase_source": purchase_source,
            "game_pass_status": derived.get("game_pass_status"),
            "vip_reward_window_active": bool(derived.get("vip_reward_window_active")),
            "unactivated_token_active": bool(derived.get("unactivated_token_active")),
            "token_expired_unactivated": bool(derived.get("vip_token_expired_unactivated")),
        },
        "reward_cursors": {
            "current_micro_tier": int(derived.get("current_micro_tier") or 0),
            "last_granted_micro_tier": int(user_row.get("rank_xp_pass_last_granted_micro_tier") or 0),
            "free_last_micro_tier_granted": int(user_row.get("rank_xp_pass_free_last_micro_tier_granted") or 0),
            "catch_up_pending": bool(derived.get("catch_up_pending")),
        },
        "token_expiry_fields": {
            "rank_xp_pass_tokens": int(user_row.get("rank_xp_pass_tokens") or 0),
            "rank_xp_pass_rewards_granted": bool(user_row.get("rank_xp_pass_rewards_granted")),
            "rank_xp_pass_token_expires_at": user_row.get("rank_xp_pass_token_expires_at"),
            "rank_xp_pass_bonus_until": user_row.get("rank_xp_pass_bonus_until"),
        },
        "points_attribution": {
            "estimated_points_awarded_from_granted_tiers": estimated_points_awarded,
            "latest_points_game_pass_purchase_event_at": (points_purchase or {}).get("created_at"),
            "latest_points_game_pass_purchase_points_delta": int((points_purchase or {}).get("points") or 0),
        },
        "latest_points_game_pass_purchase_ledger_event": points_purchase,
        "recent_stripe_game_pass_events": stripe_events,
    }


def game_pass_points_projection() -> Dict[str, int]:
    proj = dict(GAME_PASS_USER_PROJECTION)
    proj["points"] = 1
    return proj
