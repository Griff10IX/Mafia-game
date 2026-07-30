"""Readable store-currency (users.points) received/sent breakdowns — aggregates + per-tx detail."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

# Ledger event_types that are player→player transfers (counted via points_transfers instead).
_TRANSFER_EVENT_TYPES = frozenset({"transfer_in", "transfer_out"})

# Stripe / pack mints are shown as a single "Store purchase" row from payment_transactions.
_PURCHASE_EVENT_TYPES = frozenset({"mint_purchase", "mint_store_points_cash"})

# Hidden from player-facing breakdown; admin still sees them as features.
_PLAYER_HIDDEN_EVENT_TYPES = frozenset({"legacy_seed"})

_DEFAULT_TX_LIMIT = 150

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
    "game_pass_complete_remaining_vip": "Game Pass VIP",
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
    "dead_alive_retrieve": "Dead Alive Retrieve",
    "spend_store": "Store spend",
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


def _format_sent_line(points: int, label: str) -> str:
    return f"Sent {int(points):,} points to {label}"


def _iso(created: Any) -> str:
    if created is None:
        return ""
    if isinstance(created, datetime):
        try:
            return created.isoformat()
        except Exception:
            return str(created)
    return str(created)


def _row_ts(created: Any) -> float:
    if created is None:
        return 0.0
    if isinstance(created, datetime):
        try:
            return created.timestamp()
        except Exception:
            return 0.0
    if isinstance(created, str):
        try:
            return datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0.0
    return 0.0


def _parse_mdg_ref(origin_ref: str, meta: Dict[str, Any]) -> Tuple[str, str]:
    """Return (action, game_id) from ledger origin_ref / meta."""
    ref = (origin_ref or "").strip()
    act = ""
    gid = str(meta.get("game_id") or "").strip()
    if ":" in ref:
        prefix, rest = ref.split(":", 1)
        act = prefix.strip().lower()
        if not gid:
            gid = rest.strip()
    meta_act = str(meta.get("action") or "").strip().lower()
    if meta_act:
        if meta_act in ("winner_payout", "payout"):
            act = "payout"
        elif meta_act in ("join_fee", "join"):
            act = "join"
        elif meta_act in ("create_fee", "create"):
            act = "create"
        elif meta_act in ("join_refund", "refund"):
            act = "refund"
        elif not act:
            act = meta_act
    if act == "winner_payout":
        act = "payout"
    return act, gid


def _mdg_opponent_line(viewer_id: str, game: Dict[str, Any]) -> str:
    entries = game.get("entries") if isinstance(game.get("entries"), list) else []
    names: List[str] = []
    for e in entries:
        if not isinstance(e, dict):
            continue
        eid = str(e.get("user_id") or e.get("id") or "")
        uname = (e.get("username") or "").strip()
        if not uname:
            continue
        if eid and eid == viewer_id:
            continue
        names.append(uname)
    # Dedupe preserve order
    seen = set()
    out = []
    for n in names:
        k = n.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(n)
    if not out:
        host = (game.get("created_by_username") or "").strip()
        if host:
            return f"host {host}"
        return "unknown lobby"
    if len(out) <= 6:
        return "vs " + ", ".join(out)
    return "vs " + ", ".join(out[:6]) + f" (+{len(out) - 6} more)"


def _mdg_detail_line(viewer_id: str, act: str, game: Dict[str, Any], pts: int) -> str:
    gid = str(game.get("id") or "")[:8] or "?"
    host = (game.get("created_by_username") or "?").strip() or "?"
    winner = (game.get("winner_username") or "").strip()
    opponents = _mdg_opponent_line(viewer_id, game)
    if act == "payout":
        return f"MDG win …{gid} (host {host}) · {opponents} · +{abs(pts):,} pts"
    if act == "join":
        result = ""
        if winner:
            result = f" · winner {winner}"
        return f"MDG join …{gid} (host {host}) · {opponents} · −{abs(pts):,} pts{result}"
    if act == "create":
        return f"MDG create …{gid} · {opponents} · −{abs(pts):,} pts"
    if act == "refund":
        return f"MDG refund …{gid} (host {host}) · +{abs(pts):,} pts"
    return f"MDG {act or 'event'} …{gid} · {opponents} · {pts:+,} pts"


def _balance_suffix(before: Any, after: Any) -> str:
    if before is None and after is None:
        return ""
    b = "—" if before is None else f"{int(before):,}"
    a = "—" if after is None else f"{int(after):,}"
    return f" · balance {b} → {a}"


async def _load_mdg_games(db, game_ids: List[str]) -> Dict[str, dict]:
    ids = [g for g in dict.fromkeys(game_ids) if g][:300]
    if not ids:
        return {}
    docs = await db.mdg_games.find(
        {"id": {"$in": ids}},
        {
            "_id": 0,
            "id": 1,
            "created_by_username": 1,
            "winner_id": 1,
            "winner_username": 1,
            "status": 1,
            "entries": 1,
            "max_players": 1,
            "pot_points": 1,
        },
    ).to_list(300)
    return {str(g.get("id")): g for g in docs if g.get("id")}


async def build_transaction_entries(
    db,
    user_id: str,
    *,
    for_player: bool = False,
    limit: int = _DEFAULT_TX_LIMIT,
) -> Dict[str, Any]:
    """Per-event received/sent rows with MDG lobby context and wallet before/after when logged.

    Older events without wallet snapshots still appear (simple label only). Received and sent
    are queried separately so heavy spenders still see recent inflows (and vice versa).
    """
    if not user_id:
        return {"received_transactions": [], "sent_transactions": [], "tx_limit": limit}

    cap = max(20, min(500, int(limit or _DEFAULT_TX_LIMIT)))
    skip_events = set(_TRANSFER_EVENT_TYPES) | set(_PURCHASE_EVENT_TYPES)
    if for_player:
        skip_events |= set(_PLAYER_HIDDEN_EVENT_TYPES)
    skip_list = list(skip_events)

    projection = {
        "_id": 0,
        "id": 1,
        "event_type": 1,
        "points": 1,
        "origin_ref": 1,
        "event_ref": 1,
        "meta": 1,
        "created_at": 1,
        "wallet_points_before": 1,
        "wallet_points_after": 1,
    }

    # Separate queries so a flood of spends cannot wipe recent receives from the window.
    ledger_in, ledger_out, transfers = await _gather_ledger_and_transfers(
        db, user_id, skip_list=skip_list, projection=projection, cap=cap
    )
    ledger = list(ledger_in) + list(ledger_out)

    mdg_ids: List[str] = []
    for doc in ledger:
        if str(doc.get("event_type") or "") != "casino_mdg":
            continue
        meta = doc.get("meta") if isinstance(doc.get("meta"), dict) else {}
        _, gid = _parse_mdg_ref(str(doc.get("origin_ref") or doc.get("event_ref") or ""), meta)
        if gid:
            mdg_ids.append(gid)
    try:
        games = await _load_mdg_games(db, mdg_ids)
    except Exception:
        games = {}

    received: List[Dict[str, Any]] = []
    sent: List[Dict[str, Any]] = []

    for doc in ledger:
        try:
            pts = int(doc.get("points") or 0)
        except (TypeError, ValueError):
            continue
        if pts == 0:
            continue
        et = str(doc.get("event_type") or "")
        label = label_for_event_type(et)
        meta = doc.get("meta") if isinstance(doc.get("meta"), dict) else {}
        before = doc.get("wallet_points_before")
        after = doc.get("wallet_points_after")
        # Default: same simple wording as the aggregate totals (works for all legacy rows).
        detail = label
        if et == "casino_mdg":
            act, gid = _parse_mdg_ref(str(doc.get("origin_ref") or doc.get("event_ref") or ""), meta)
            game = games.get(gid)
            if game:
                detail = _mdg_detail_line(user_id, act, game, pts)
            elif act:
                detail = f"MDG {act}"
        elif meta.get("action"):
            detail = f"{label} · {meta.get('action')}"
            if meta.get("to_username"):
                detail += f" · {meta.get('to_username')}"
            elif meta.get("from_username"):
                detail += f" · {meta.get('from_username')}"
        elif doc.get("origin_ref") or doc.get("event_ref"):
            ref = str(doc.get("origin_ref") or doc.get("event_ref") or "")
            # Keep short refs (store buy ids); skip ugly UUIDs-only noise for legacy clutter.
            if len(ref) <= 64:
                detail = f"{label} · {ref}"

        direction = "in" if pts > 0 else "out"
        verb = "Received" if pts > 0 else "Sent"
        line = f"{verb} {abs(pts):,} points · {detail}{_balance_suffix(before, after)}"
        row = {
            "id": doc.get("id"),
            "direction": direction,
            "kind": "feature",
            "event_type": et,
            "label": label,
            "points": abs(pts),
            "points_signed": pts,
            "detail": detail,
            "line": line,
            "created_at": _iso(doc.get("created_at")),
            "created_ts": _row_ts(doc.get("created_at")),
            "wallet_points_before": before,
            "wallet_points_after": after,
            "meta": {
                "action": meta.get("action"),
                "game_id": meta.get("game_id"),
                "origin_ref": doc.get("origin_ref") or doc.get("event_ref"),
            },
        }
        (received if pts > 0 else sent).append(row)

    for doc in transfers:
        try:
            amt = int(doc.get("amount") or 0)
        except (TypeError, ValueError):
            continue
        if amt <= 0:
            continue
        is_in = doc.get("to_user_id") == user_id
        other = ((doc.get("from_username") if is_in else doc.get("to_username")) or "?").strip() or "?"
        before = doc.get("recipient_points_before") if is_in else doc.get("sender_points_before")
        after = doc.get("recipient_points_after") if is_in else doc.get("sender_points_after")
        detail = f"player transfer · {'from' if is_in else 'to'} {other}"
        verb = "Received" if is_in else "Sent"
        line = f"{verb} {amt:,} points · {detail}{_balance_suffix(before, after)}"
        row = {
            "id": doc.get("id"),
            "direction": "in" if is_in else "out",
            "kind": "user",
            "event_type": "points_transfer",
            "label": other,
            "points": amt,
            "points_signed": amt if is_in else -amt,
            "detail": detail,
            "line": line,
            "created_at": _iso(doc.get("created_at")),
            "created_ts": _row_ts(doc.get("created_at")),
            "wallet_points_before": before,
            "wallet_points_after": after,
            "meta": {
                "from_username": doc.get("from_username"),
                "to_username": doc.get("to_username"),
            },
        }
        (received if is_in else sent).append(row)

    received.sort(key=lambda r: float(r.get("created_ts") or 0), reverse=True)
    sent.sort(key=lambda r: float(r.get("created_ts") or 0), reverse=True)
    for rows in (received, sent):
        for r in rows:
            r.pop("created_ts", None)

    return {
        "received_transactions": received[:cap],
        "sent_transactions": sent[:cap],
        "tx_limit": cap,
    }


async def _gather_ledger_and_transfers(db, user_id: str, *, skip_list: List[str], projection: dict, cap: int):
    import asyncio

    ledger_in_coro = (
        db.point_ledger_events.find(
            {"user_id": user_id, "points": {"$gt": 0}, "event_type": {"$nin": skip_list}},
            projection,
        )
        .sort("created_at", -1)
        .limit(cap)
        .to_list(cap)
    )
    ledger_out_coro = (
        db.point_ledger_events.find(
            {"user_id": user_id, "points": {"$lt": 0}, "event_type": {"$nin": skip_list}},
            projection,
        )
        .sort("created_at", -1)
        .limit(cap)
        .to_list(cap)
    )
    transfers_coro = (
        db.points_transfers.find(
            {"$or": [{"to_user_id": user_id}, {"from_user_id": user_id}]},
            {
                "_id": 0,
                "id": 1,
                "from_user_id": 1,
                "from_username": 1,
                "to_user_id": 1,
                "to_username": 1,
                "amount": 1,
                "created_at": 1,
                "sender_points_before": 1,
                "sender_points_after": 1,
                "recipient_points_before": 1,
                "recipient_points_after": 1,
            },
        )
        .sort("created_at", -1)
        .limit(cap)
        .to_list(cap)
    )
    return await asyncio.gather(ledger_in_coro, ledger_out_coro, transfers_coro)


async def build_received_breakdown(
    db,
    user_id: str,
    *,
    for_player: bool = False,
    include_transactions: bool = True,
    tx_limit: int = _DEFAULT_TX_LIMIT,
) -> Dict[str, Any]:
    """
    Aggregate store-currency inflows/outflows + optional per-tx detail.

    - Features: point_ledger_events (skips transfer_* and purchase mints)
    - Users: points_transfers grouped by counterparty
    - Purchase: completed payment_transactions total (received only)
    """
    empty = {
        "received_breakdown": [],
        "lines": [],
        "totals": {"features": 0, "users": 0, "purchases": 0, "all": 0},
        "sent_breakdown": [],
        "sent_lines": [],
        "sent_totals": {"features": 0, "users": 0, "all": 0},
        "received_transactions": [],
        "sent_transactions": [],
        "tx_limit": tx_limit,
    }
    if not user_id:
        return empty

    skip_events = set(_TRANSFER_EVENT_TYPES) | set(_PURCHASE_EVENT_TYPES)
    if for_player:
        skip_events |= set(_PLAYER_HIDDEN_EVENT_TYPES)

    ledger_in = await db.point_ledger_events.aggregate(
        [
            {"$match": {"user_id": user_id, "points": {"$gt": 0}}},
            {"$group": {"_id": "$event_type", "total": {"$sum": "$points"}, "n": {"$sum": 1}}},
            {"$sort": {"total": -1}},
        ]
    ).to_list(500)

    ledger_out = await db.point_ledger_events.aggregate(
        [
            {"$match": {"user_id": user_id, "points": {"$lt": 0}}},
            {"$group": {"_id": "$event_type", "total": {"$sum": "$points"}, "n": {"$sum": 1}}},
            {"$sort": {"total": 1}},
        ]
    ).to_list(500)

    transfer_in = await db.points_transfers.aggregate(
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

    transfer_out = await db.points_transfers.aggregate(
        [
            {"$match": {"from_user_id": user_id}},
            {
                "$group": {
                    "_id": {
                        "to_user_id": "$to_user_id",
                        "to_username": "$to_username",
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

    received: List[Dict[str, Any]] = []
    features_in = 0
    users_in = 0

    for r in ledger_in:
        et = r.get("_id")
        if et in skip_events:
            continue
        pts = int(r.get("total") or 0)
        if pts <= 0:
            continue
        label = label_for_event_type(et if isinstance(et, str) else None)
        features_in += pts
        received.append(
            {
                "kind": "feature",
                "key": et,
                "label": label,
                "points": pts,
                "events": int(r.get("n") or 0),
            }
        )

    for r in transfer_in:
        key = r.get("_id") or {}
        pts = int(r.get("total") or 0)
        if pts <= 0:
            continue
        uname = (key.get("from_username") or "").strip() or "Unknown player"
        users_in += pts
        received.append(
            {
                "kind": "user",
                "key": key.get("from_user_id"),
                "label": uname,
                "points": pts,
                "events": int(r.get("n") or 0),
            }
        )

    if pay_total > 0:
        received.append(
            {
                "kind": "purchase",
                "key": "stripe",
                "label": "Store purchase",
                "points": pay_total,
                "events": pay_count,
            }
        )

    received.sort(key=lambda row: (-int(row.get("points") or 0), str(row.get("label") or "")))
    lines = [_format_received_line(int(row["points"]), str(row["label"])) for row in received]

    sent: List[Dict[str, Any]] = []
    features_out = 0
    users_out = 0

    for r in ledger_out:
        et = r.get("_id")
        if et in skip_events:
            continue
        pts = abs(int(r.get("total") or 0))
        if pts <= 0:
            continue
        label = label_for_event_type(et if isinstance(et, str) else None)
        features_out += pts
        sent.append(
            {
                "kind": "feature",
                "key": et,
                "label": label,
                "points": pts,
                "events": int(r.get("n") or 0),
            }
        )

    for r in transfer_out:
        key = r.get("_id") or {}
        pts = int(r.get("total") or 0)
        if pts <= 0:
            continue
        uname = (key.get("to_username") or "").strip() or "Unknown player"
        users_out += pts
        sent.append(
            {
                "kind": "user",
                "key": key.get("to_user_id"),
                "label": uname,
                "points": pts,
                "events": int(r.get("n") or 0),
            }
        )

    sent.sort(key=lambda row: (-int(row.get("points") or 0), str(row.get("label") or "")))
    sent_lines = [_format_sent_line(int(row["points"]), str(row["label"])) for row in sent]

    out: Dict[str, Any] = {
        "received_breakdown": received,
        "lines": lines,
        "totals": {
            "features": features_in,
            "users": users_in,
            "purchases": pay_total if pay_total > 0 else 0,
            "all": features_in + users_in + (pay_total if pay_total > 0 else 0),
        },
        "sent_breakdown": sent,
        "sent_lines": sent_lines,
        "sent_totals": {
            "features": features_out,
            "users": users_out,
            "all": features_out + users_out,
        },
        "received_transactions": [],
        "sent_transactions": [],
        "tx_limit": tx_limit,
    }

    if include_transactions:
        try:
            tx = await build_transaction_entries(db, user_id, for_player=for_player, limit=tx_limit)
            out.update(tx)
        except Exception:
            # Aggregates above still work; per-tx is best-effort (legacy rows / MDG lookup).
            out["received_transactions"] = []
            out["sent_transactions"] = []
            out["tx_error"] = True

    return out
