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
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from server import db, _username_pattern
from utils.game_pass_admin_inspect import (
    GAME_PASS_USER_PROJECTION,
    classify_purchase_source,
    fetch_game_pass_payment_events,
    fetch_latest_points_game_pass_purchase,
    game_pass_derived_fields,
)
from utils.game_pass_micro_rewards import vip_rewards_after_free_dedupe


def _fmt_dt(v: Any) -> str:
    if not v:
        return "-"
    if hasattr(v, "isoformat"):
        try:
            return v.isoformat()
        except Exception:
            return str(v)
    return str(v)


def _calc_estimated_vip_points_from_granted_tiers(user_row: Dict[str, Any]) -> int:
    """
    Estimate cumulative points from VIP micro tiers already granted (1..last_granted_micro_tier),
    applying the same free-track dedupe helper used at grant time.
    """
    last_granted = int(user_row.get("rank_xp_pass_last_granted_micro_tier") or 0)
    if last_granted <= 0:
        return 0
    free_last = int(user_row.get("rank_xp_pass_free_last_micro_tier_granted") or 0)
    total = 0
    for t in range(1, last_granted + 1):
        rewards = vip_rewards_after_free_dedupe(t, free_last)
        total += int(rewards.get("points") or 0)
    return int(total)


async def _resolve_user(args) -> Optional[Dict[str, Any]]:
    proj = dict(GAME_PASS_USER_PROJECTION)
    proj["points"] = 1
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

    now = datetime.now(timezone.utc)
    uid = str(user.get("id") or "")
    derived = game_pass_derived_fields(user, now_utc=now)
    stripe_events = await fetch_game_pass_payment_events(db, uid, limit=10)
    points_purchase = await fetch_latest_points_game_pass_purchase(db, uid)
    purchase_source = classify_purchase_source(
        stripe_events,
        user,
        has_points_game_pass_ledger=bool(points_purchase),
    )
    estimated_points_awarded = _calc_estimated_vip_points_from_granted_tiers(user)

    print("=== Game Pass Points Diagnostic ===")
    print(f"User: {user.get('username')} ({uid})")
    print(f"Current points balance: {int(user.get('points') or 0):,}")
    print("")
    print("Entitlement state:")
    print(f"  purchase_source: {purchase_source}")
    print(f"  game_pass_status: {derived.get('game_pass_status')}")
    print(f"  vip_reward_window_active: {bool(derived.get('vip_reward_window_active'))}")
    print(f"  unactivated_token_active: {bool(derived.get('unactivated_token_active'))}")
    print(f"  token_expired_unactivated: {bool(derived.get('vip_token_expired_unactivated'))}")
    print("")
    print("Reward cursors:")
    print(f"  current_micro_tier: {int(derived.get('current_micro_tier') or 0)}")
    print(f"  last_granted_micro_tier: {int(user.get('rank_xp_pass_last_granted_micro_tier') or 0)}")
    print(f"  free_last_micro_tier_granted: {int(user.get('rank_xp_pass_free_last_micro_tier_granted') or 0)}")
    print(f"  catch_up_pending: {bool(derived.get('catch_up_pending'))}")
    print("")
    print("Token/expiry fields:")
    print(f"  rank_xp_pass_tokens: {int(user.get('rank_xp_pass_tokens') or 0)}")
    print(f"  rank_xp_pass_rewards_granted: {bool(user.get('rank_xp_pass_rewards_granted'))}")
    print(f"  rank_xp_pass_token_expires_at: {_fmt_dt(user.get('rank_xp_pass_token_expires_at'))}")
    print(f"  rank_xp_pass_bonus_until: {_fmt_dt(user.get('rank_xp_pass_bonus_until'))}")
    print("")
    print("Points attribution:")
    print(f"  estimated_points_awarded_from_granted_tiers: {estimated_points_awarded:,}")
    print(f"  latest_points_game_pass_purchase_event: {_fmt_dt((points_purchase or {}).get('created_at'))}")
    if points_purchase:
        print(f"    purchase_event_points_delta: {int(points_purchase.get('points') or 0):,}")
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
