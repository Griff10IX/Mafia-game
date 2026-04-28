#!/usr/bin/env python3
"""
Support tool: inspect why a user may think Game Pass points/rewards were not credited.

Usage examples:
  python backend/scripts/check_game_pass_points.py --username someUser
  python backend/scripts/check_game_pass_points.py --user-id 12345
"""

from __future__ import annotations

import argparse
import asyncio
from typing import Any, Dict, Optional

from server import db, _username_pattern
from utils.game_pass_points_diagnostic import (
    build_game_pass_points_diagnostic,
    game_pass_points_projection,
)


def _fmt_dt(v: Any) -> str:
    if not v:
        return "-"
    if hasattr(v, "isoformat"):
        try:
            return v.isoformat()
        except Exception:
            return str(v)
    return str(v)


async def _resolve_user(args) -> Optional[Dict[str, Any]]:
    proj = game_pass_points_projection()
    if args.user_id:
        return await db.users.find_one({"id": str(args.user_id)}, proj)
    if args.username:
        return await db.users.find_one({"username": _username_pattern(args.username)}, proj)
    return None


async def _run(args) -> int:
    user = await _resolve_user(args)
    if not user:
        print("User not found.")
        return 1

    diagnostic = await build_game_pass_points_diagnostic(db, user)
    user_info = diagnostic.get("user") or {}
    entitlement_state = diagnostic.get("entitlement_state") or {}
    reward_cursors = diagnostic.get("reward_cursors") or {}
    token_fields = diagnostic.get("token_expiry_fields") or {}
    points_attribution = diagnostic.get("points_attribution") or {}
    points_purchase = diagnostic.get("latest_points_game_pass_purchase_ledger_event")
    stripe_events = diagnostic.get("recent_stripe_game_pass_events") or []
    uid = str(user_info.get("id") or "")

    print("=== Game Pass Points Diagnostic ===")
    print(f"User: {user.get('username')} ({uid})")
    print(f"Current points balance: {int(user_info.get('points_balance') or 0):,}")
    print("")
    print("Entitlement state:")
    print(f"  purchase_source: {entitlement_state.get('purchase_source')}")
    print(f"  game_pass_status: {entitlement_state.get('game_pass_status')}")
    print(f"  vip_reward_window_active: {bool(entitlement_state.get('vip_reward_window_active'))}")
    print(f"  unactivated_token_active: {bool(entitlement_state.get('unactivated_token_active'))}")
    print(f"  token_expired_unactivated: {bool(entitlement_state.get('token_expired_unactivated'))}")
    print("")
    print("Reward cursors:")
    print(f"  current_micro_tier: {int(reward_cursors.get('current_micro_tier') or 0)}")
    print(f"  last_granted_micro_tier: {int(reward_cursors.get('last_granted_micro_tier') or 0)}")
    print(f"  free_last_micro_tier_granted: {int(reward_cursors.get('free_last_micro_tier_granted') or 0)}")
    print(f"  catch_up_pending: {bool(reward_cursors.get('catch_up_pending'))}")
    print("")
    print("Token/expiry fields:")
    print(f"  rank_xp_pass_tokens: {int(token_fields.get('rank_xp_pass_tokens') or 0)}")
    print(f"  rank_xp_pass_rewards_granted: {bool(token_fields.get('rank_xp_pass_rewards_granted'))}")
    print(f"  rank_xp_pass_token_expires_at: {_fmt_dt(token_fields.get('rank_xp_pass_token_expires_at'))}")
    print(f"  rank_xp_pass_bonus_until: {_fmt_dt(token_fields.get('rank_xp_pass_bonus_until'))}")
    print("")
    print("Points attribution:")
    print(f"  estimated_points_awarded_from_granted_tiers: {int(points_attribution.get('estimated_points_awarded_from_granted_tiers') or 0):,}")
    print(f"  latest_points_game_pass_purchase_event: {_fmt_dt(points_attribution.get('latest_points_game_pass_purchase_event_at'))}")
    if points_purchase:
        print(f"    purchase_event_points_delta: {int(points_attribution.get('latest_points_game_pass_purchase_points_delta') or 0):,}")
    print("")
    print("Recent Stripe Game Pass events:")
    if not stripe_events:
        print("  (none)")
    else:
        for i, ev in enumerate(stripe_events, start=1):
            print(
                f"  {i}. entitled_at={_fmt_dt(ev.get('pass_entitled_at'))} "
                f"credited_at={_fmt_dt(ev.get('points_credited_at'))} "
                f"created_at={_fmt_dt(ev.get('created_at'))} "
                f"status={ev.get('payment_status')}"
            )
    print("")
    print("Tip: If catch_up_pending=true with rewards_granted=true, run GP tier reconcile/admin grant flow.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Check Game Pass points/reward credit status for a user")
    parser.add_argument("--username", type=str, default="", help="Target username")
    parser.add_argument("--user-id", type=str, default="", help="Target user id")
    args = parser.parse_args()
    if not args.username and not args.user_id:
        parser.error("Provide --username or --user-id")
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
