"""Readable “Received X points from …” breakdown for store currency (users.points)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# Ledger event_types that are player→player transfers (counted via points_transfers instead).
_TRANSFER_EVENT_TYPES = frozenset({"transfer_in", "transfer_out"})

# Stripe / pack mints are shown as a single "Store purchase" row from payment_transactions.
_PURCHASE_EVENT_TYPES = frozenset({"mint_purchase", "mint_store_points_cash"})

# Hidden from player-facing breakdown; admin still sees them as features.
_PLAYER_HIDDEN_EVENT_TYPES = frozenset({"legacy_seed"})

_EVENT_LABELS: Dict[str, str] = {
    "mint_purchase": "Store purchase",
    "mint_store_points_cash": "Store purchase (cash)",
    "store_purchase": "Store purchase",
    "store_points_cash_purchase": "Store purchase (cash)",
    "legacy_seed": "Legacy / untracked balance",
    "admin_add_points": "Admin grant",
    "admin_give_all_points": "Admin grant (all players)",
    "admin_grant": "Admin grant",
    "admin_transfer": "Admin transfer",
    "admin_revive_alt_balance_transfer": "Account recovery",
    "admin_revive_alt_spent_refund": "Account recovery refund",
    "admin_cheater_bodyguard_hire_refund": "Bodyguard hire refund",
    "admin_retract_store_spend": "Store spend retract",
    "hdo_ticket_close_reward": "Help Desk reward",
    "first_game_pass_vip_completion": "Game Pass VIP",
    "game_pass_free_grant": "Game Pass",
    "leaderboard_payout_points_correction": "Leaderboard correction",
    "objectives_claim": "Objectives",
    "loot_box": "Loot box",
    "redeem_code": "Redeem code",
    "casino_mdg": "MDG",
    "casino_dice": "Dice",
    "casino_roulette": "Roulette",
    "casino_blackjack": "Blackjack",
    "casino_slots": "Slots",
    "casino_horseracing": "Horse racing",
    "casino_video_poker": "Video poker",
    "casino_sports": "Sports betting",
    "mp_poker": "MP Poker",
    "mp_8ball": "8-Ball",
    "entertainer_payout": "Entertainer payout",
    "entertainer_completion_bonus": "Entertainer bonus",
    "entertainer_mdg_fund": "Entertainer MDG fund",
    "quicktrade_buy": "Quick Trade",
    "quicktrade_sell": "Quick Trade",
    "quicktrade_cancel": "Quick Trade cancel",
    "quicktrade_property": "Quick Trade property",
    "stock_close": "Stock market",
    "illegal_biz_collect": "Illegal business",
    "armoury_claim_profit": "Armoury sales",
    "armoury_sell_armour": "Armoury",
    "bodyguard_pay_credit": "Bodyguard pay",
    "bodyguard_weekly_pay_credit": "Bodyguard weekly pay",
    "family_war_loot": "Family war loot",
    "family_compound_withdraw": "Family compound",
    "family_perk_contribute_in": "Family perk contribution",
    "airport_owner_income": "Airport income",
    "airport_airmiles": "Airmiles",
    "grave_robber_reward": "Grave robber",
    "world_cup_payout": "World Cup",
    "world_cup_pick_correction": "World Cup correction",
    "designer_comp_vote": "Designer competition",
    "referral_weekly": "Referral weekly",
    "hitlist_bounty_claim": "Hitlist bounty",
    "kill_loot": "Kill loot",
}


def label_for_event_type(event_type: Optional[str]) -> str:
    key = (event_type or "").strip()
    if not key:
        return "Unknown"
    if key in _EVENT_LABELS:
        return _EVENT_LABELS[key]
    return key.replace("_", " ").strip().title() or "Unknown"


def _format_received_line(points: int, label: str) -> str:
    return f"Received {int(points):,} points from {label}"


async def build_received_breakdown(
    db,
    user_id: str,
    *,
    for_player: bool = False,
) -> Dict[str, Any]:
    """
    Aggregate store-currency inflows into a readable breakdown.

    - Features: positive point_ledger_events (skips transfer_* and purchase mints)
    - Users: points_transfers received, grouped by sender
    - Purchase: completed payment_transactions total (single row when > 0)
    """
    if not user_id:
        return {
            "received_breakdown": [],
            "lines": [],
            "totals": {"features": 0, "users": 0, "purchases": 0, "all": 0},
        }

    skip_events = set(_TRANSFER_EVENT_TYPES) | set(_PURCHASE_EVENT_TYPES)
    if for_player:
        skip_events |= set(_PLAYER_HIDDEN_EVENT_TYPES)

    ledger_rows = await db.point_ledger_events.aggregate(
        [
            {"$match": {"user_id": user_id, "points": {"$gt": 0}}},
            {"$group": {"_id": "$event_type", "total": {"$sum": "$points"}, "n": {"$sum": 1}}},
            {"$sort": {"total": -1}},
        ]
    ).to_list(500)

    transfer_rows = await db.points_transfers.aggregate(
        [
            {"$match": {"to_user_id": user_id}},
            {
                "$group": {
                    "_id": {
                        "from_user_id": "$from_user_id",
                        "from_username": "$from_username",
                    },
                    "total": {"$sum": "$amount"},
                    "n": {"$sum": 1},
                }
            },
            {"$sort": {"total": -1}},
        ]
    ).to_list(500)

    pay_agg = await db.payment_transactions.aggregate(
        [
            {"$match": {"user_id": user_id, "payment_status": "completed"}},
            {
                "$group": {
                    "_id": None,
                    "total_points": {"$sum": {"$ifNull": ["$points", 0]}},
                    "count": {"$sum": 1},
                }
            },
        ]
    ).to_list(1)
    pay_total = int(pay_agg[0]["total_points"]) if pay_agg else 0
    pay_count = int(pay_agg[0]["count"]) if pay_agg else 0

    breakdown: List[Dict[str, Any]] = []
    features_total = 0
    users_total = 0

    for r in ledger_rows:
        et = r.get("_id")
        if et in skip_events:
            continue
        pts = int(r.get("total") or 0)
        if pts <= 0:
            continue
        label = label_for_event_type(et if isinstance(et, str) else None)
        features_total += pts
        breakdown.append(
            {
                "kind": "feature",
                "key": et,
                "label": label,
                "points": pts,
                "events": int(r.get("n") or 0),
            }
        )

    for r in transfer_rows:
        key = r.get("_id") or {}
        pts = int(r.get("total") or 0)
        if pts <= 0:
            continue
        uname = (key.get("from_username") or "").strip() or "Unknown player"
        users_total += pts
        breakdown.append(
            {
                "kind": "user",
                "key": key.get("from_user_id"),
                "label": uname,
                "points": pts,
                "events": int(r.get("n") or 0),
            }
        )

    if pay_total > 0:
        breakdown.append(
            {
                "kind": "purchase",
                "key": "stripe",
                "label": "Store purchase",
                "points": pay_total,
                "events": pay_count,
            }
        )

    breakdown.sort(key=lambda row: (-int(row.get("points") or 0), str(row.get("label") or "")))
    lines = [_format_received_line(int(row["points"]), str(row["label"])) for row in breakdown]
    purchases_total = pay_total if pay_total > 0 else 0

    return {
        "received_breakdown": breakdown,
        "lines": lines,
        "totals": {
            "features": features_total,
            "users": users_total,
            "purchases": purchases_total,
            "all": features_total + users_total + purchases_total,
        },
    }
