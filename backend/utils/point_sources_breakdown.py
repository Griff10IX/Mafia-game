"""Readable store-currency (users.points) received/sent breakdowns — aggregates + per-tx detail."""
from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# Ledger event_types that are player→player transfers (counted via points_transfers instead).
_TRANSFER_EVENT_TYPES = frozenset({"transfer_in", "transfer_out"})

# Stripe / pack mints are shown as a single "Store purchase" row from payment_transactions.
_PURCHASE_EVENT_TYPES = frozenset({"mint_purchase", "mint_store_points_cash"})

# Hidden from player-facing breakdown; admin still sees them as features.
_PLAYER_HIDDEN_EVENT_TYPES = frozenset({"legacy_seed"})

_DEFAULT_TX_LIMIT = 150
_DEFAULT_AUDIT_LIMIT = 50
_MAX_AUDIT_LIMIT = 200

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


def parse_audit_datetime(value: Optional[str], *, end_of_day: bool = False) -> Optional[datetime]:
    """Parse an API date/datetime into an aware UTC datetime."""
    raw = str(value or "").strip()
    if not raw:
        return None
    date_only = bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw))
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"Invalid ISO date/datetime: {raw}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)
    if date_only and end_of_day:
        parsed = parsed.replace(hour=23, minute=59, second=59, microsecond=999999)
    return parsed


def encode_audit_cursor(created_at: Any, event_id: Any) -> Optional[str]:
    if not created_at or not event_id:
        return None
    payload = json.dumps({"t": _iso(created_at), "id": str(event_id)}, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_audit_cursor(cursor: Optional[str]) -> Optional[Tuple[datetime, str]]:
    raw = str(cursor or "").strip()
    if not raw:
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode("utf-8"))
        created = parse_audit_datetime(payload.get("t"))
        event_id = str(payload.get("id") or "")
        if created is None or not event_id:
            raise ValueError
        return created, event_id
    except Exception as exc:
        raise ValueError("Invalid audit cursor") from exc


def _int_or_none(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items() if k != "_id"}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _party_name(party: Any, fallback: str = "unknown player") -> str:
    if isinstance(party, dict):
        return str(party.get("username") or party.get("id") or fallback)
    return fallback


def _context_value(event: Dict[str, Any], *keys: str) -> Any:
    for container_name in ("context", "meta"):
        container = event.get(container_name)
        if not isinstance(container, dict):
            continue
        for key in keys:
            value = container.get(key)
            if value is not None and value != "":
                return value
    return None


def _balance_words(before: Optional[int], after: Optional[int]) -> str:
    if before is None or after is None:
        return "Unknown (legacy record)"
    return f"balance {before:,} → {after:,}"


def build_audit_narrative(event: Dict[str, Any], enrichment: Optional[Dict[str, Any]] = None) -> str:
    """Build concrete staff-readable wording without inventing missing values."""
    enrichment = enrichment or {}
    delta = _int_or_none(event.get("delta")) or 0
    before = _int_or_none(event.get("wallet_points_before"))
    after = _int_or_none(event.get("wallet_points_after"))
    source = str(event.get("source") or "legacy").lower()
    event_type = str(event.get("event_type") or "unknown")
    counterparty = event.get("counterparty")
    transfer = enrichment.get("points_transfer") if isinstance(enrichment.get("points_transfer"), dict) else {}

    if source == "p2p" or event_type in _TRANSFER_EVENT_TYPES:
        sender = str(
            transfer.get("from_username")
            or _context_value(event, "from_username")
            or (_party_name(counterparty) if delta > 0 else event.get("username"))
            or "unknown sender"
        )
        recipient = str(
            transfer.get("to_username")
            or _context_value(event, "to_username")
            or (event.get("username") if delta > 0 else _party_name(counterparty))
            or "unknown recipient"
        )
        # Example: "Highlights sent Venus 50,000 points; balance 50,000 → 100,000."
        return f"{sender} sent {abs(delta):,} points to {recipient}; {_balance_words(before, after)}."

    if source == "quicktrade" or event_type.startswith("quicktrade_"):
        role = "buyer" if delta > 0 else "seller"
        other = _party_name(counterparty)
        cash = _context_value(event, "cost_cash", "cost", "cash", "money", "cash_paid", "cash_received")
        consideration = f"${int(cash):,} cash" if _int_or_none(cash) is not None else "unknown legacy consideration"
        self_name = event.get("username") or event.get("user_id") or "unknown player"
        if event_type == "quicktrade_create":
            listed = _int_or_none(_context_value(event, "listed_points")) or abs(delta)
            fee = _int_or_none(_context_value(event, "fee"))
            fee_words = f" (fee {fee:,})" if fee is not None else ""
            return (
                f"Quick Trade: {self_name} listed {listed:,} points for sale{fee_words} "
                f"asking {consideration}; {_balance_words(before, after)}."
            )
        if delta > 0:
            action = f"{self_name} bought {abs(delta):,} points from {other}"
        else:
            action = f"{self_name} sold/committed {abs(delta):,} points"
            if other != "unknown player":
                action += f" to {other}"
        return f"Quick Trade ({role}): {action} for {consideration}; {_balance_words(before, after)}."

    if event_type == "casino_mdg" or source in {"mdg", "casino_mdg"} or (
        source == "casino" and "mdg" in str(_context_value(event, "game_id") or event.get("origin_ref") or "").lower()
    ):
        game = enrichment.get("mdg_game") if isinstance(enrichment.get("mdg_game"), dict) else {}
        opponents = _context_value(event, "opponents")
        if not isinstance(opponents, list):
            opponents = game.get("entries") if isinstance(game.get("entries"), list) else []
        opponent_names = [
            str(p.get("username") or p.get("id"))
            for p in opponents
            if isinstance(p, dict)
            and str(p.get("id") or p.get("user_id") or "") != str(event.get("user_id") or "")
            and (p.get("username") or p.get("id"))
        ]
        versus = ", ".join(dict.fromkeys(opponent_names)) or "unknown opponent(s)"
        stake = _int_or_none(_context_value(event, "stake_points", "fee_points"))
        payout = _int_or_none(_context_value(event, "payout_points", "pot_points"))
        result = str(_context_value(event, "result", "action") or ("won" if delta > 0 else "stake paid"))
        pieces = [f"MDG vs {versus}", f"result {result}"]
        pieces.append(f"stake {stake:,} points" if stake is not None else "stake unknown")
        if payout is not None:
            pieces.append(f"payout {payout:,} points")
        elif delta > 0:
            pieces.append(f"payout {abs(delta):,} points")
        return "; ".join(pieces) + f"; {_balance_words(before, after)}."

    label = label_for_event_type(event_type)
    direction = "credited" if delta > 0 else "debited"
    ref = str(event.get("origin_ref") or event.get("transaction_id") or "")
    ref_words = f" (reference {ref})" if ref else ""
    return f"{label}: {direction} {abs(delta):,} points{ref_words}; {_balance_words(before, after)}."


def audit_anomaly_flags(
    event: Dict[str, Any],
    *,
    duplicate_key: bool = False,
    duplicate_reference: bool = False,
    chain_gap: bool = False,
) -> List[str]:
    flags: List[str] = []
    delta = _int_or_none(event.get("delta"))
    before = _int_or_none(event.get("wallet_points_before"))
    after = _int_or_none(event.get("wallet_points_after"))
    if before is None or after is None:
        flags.append("incomplete_snapshot")
    elif delta is None or before + delta != after:
        flags.append("before_delta_mismatch")
    if (before is not None and before < 0) or (after is not None and after < 0):
        flags.append("negative_balance")
    if chain_gap:
        flags.append("balance_chain_gap")
    if duplicate_key:
        flags.append("duplicate_normalized_event_key")
    if duplicate_reference:
        flags.append("duplicate_reference")
    return flags


def _audit_row(
    event: Dict[str, Any],
    enrichment: Dict[str, Any],
    *,
    duplicate_key: bool,
    duplicate_reference: bool,
    chain_gap: bool,
    linked_legs: List[Dict[str, Any]],
) -> Dict[str, Any]:
    before = _int_or_none(event.get("wallet_points_before"))
    after = _int_or_none(event.get("wallet_points_after"))
    flags = audit_anomaly_flags(
        event,
        duplicate_key=duplicate_key,
        duplicate_reference=duplicate_reference,
        chain_gap=chain_gap,
    )
    unknown_fields = []
    if before is None:
        unknown_fields.append("wallet_points_before")
    if after is None:
        unknown_fields.append("wallet_points_after")
    legacy = not event.get("schema_version") or str(event.get("origin") or "").startswith("legacy")
    return {
        "id": str(event.get("id") or event.get("_id") or ""),
        "time": _iso(event.get("created_at")),
        "synthetic": bool(event.get("_synthetic")),
        "transaction_id": event.get("transaction_id"),
        "correlation_id": event.get("correlation_id"),
        "source": event.get("source") or "legacy",
        "event_type": event.get("event_type") or "unknown",
        "delta": _int_or_none(event.get("delta")) or 0,
        "wallet_points_before": before,
        "wallet_points_after": after,
        "balance_known": before is not None and after is not None,
        "actor": _json_safe(event.get("actor")),
        "counterparty": _json_safe(event.get("counterparty")),
        "context": _json_safe(event.get("context") or {}),
        "meta": _json_safe(event.get("meta") or {}),
        "origin": {"name": event.get("origin"), "ref": event.get("origin_ref")},
        "schema_version": event.get("schema_version"),
        "normalized_event_key": event.get("normalized_event_key"),
        "narrative": build_audit_narrative(event, enrichment),
        "incomplete": bool(unknown_fields),
        "legacy": legacy,
        "unknown_fields": unknown_fields,
        "anomaly_flags": flags,
        "suspicious": bool(flags),
        "linked_legs": _json_safe(linked_legs),
        "historical_enrichment": _json_safe(enrichment),
    }


async def _duplicate_values(db, user_id: str, field: str) -> set:
    try:
        rows = await db.point_audit_events.aggregate(
            [
                {"$match": {"user_id": user_id, field: {"$nin": [None, ""]}}},
                {"$group": {"_id": f"${field}", "count": {"$sum": 1}}},
                {"$match": {"count": {"$gt": 1}}},
                {"$limit": 1000},
            ]
        ).to_list(1000)
        return {str(row.get("_id")) for row in rows if row.get("_id") not in (None, "")}
    except Exception:
        return set()


async def _safe_find(db, collection: str, query: dict, projection: dict, limit: int = 500) -> List[dict]:
    try:
        return await db[collection].find(query, projection).limit(limit).to_list(limit)
    except Exception:
        return []


def _candidate_refs(events: List[dict]) -> List[str]:
    refs: List[str] = []
    for event in events:
        for key in ("origin_ref", "transaction_id", "correlation_id", "normalized_event_key"):
            value = event.get(key)
            if value:
                refs.append(str(value))
        for container_name in ("context", "meta"):
            container = event.get(container_name)
            if not isinstance(container, dict):
                continue
            for key in ("offer_id", "game_id", "purchase_id", "session_id", "transaction_id"):
                if container.get(key):
                    refs.append(str(container[key]))
    return list(dict.fromkeys(refs))[:1000]


def _ref_matches(event: dict, candidate: dict) -> bool:
    event_refs = set(_candidate_refs([event]))
    candidate_refs = {
        str(candidate.get(key))
        for key in (
            "id",
            "origin_ref",
            "event_ref",
            "session_id",
            "store_event_ref",
            "points_correlation_id",
            "game_id",
        )
        if candidate.get(key) not in (None, "")
    }
    return bool(event_refs & candidate_refs)


async def _load_audit_enrichment(db, user_id: str, events: List[dict]) -> Dict[str, Dict[str, Any]]:
    refs = _candidate_refs(events)
    if not refs:
        return {str(event.get("id") or ""): {} for event in events}

    game_ids = list(
        dict.fromkeys(
            str(_context_value(event, "game_id") or "").strip()
            or str(event.get("correlation_id") or "").strip()
            for event in events
            if event.get("event_type") == "casino_mdg"
            or str(event.get("source") or "").lower() in {"mdg", "casino"}
        )
    )
    game_ids = [value.split(":", 1)[-1] for value in game_ids if value]
    common_projection = {"_id": 0}
    transfers_coro = _safe_find(
        db,
        "points_transfers",
        {
            "$and": [
                {"$or": [{"from_user_id": user_id}, {"to_user_id": user_id}]},
                {"$or": [{"id": {"$in": refs}}, {"transaction_id": {"$in": refs}}]},
            ]
        },
        common_projection,
    )
    trades_coro = _safe_find(
        db,
        "trade_events",
        {
            "$and": [
                {"$or": [{"user_id": user_id}, {"buyer_id": user_id}, {"seller_id": user_id}]},
                {"$or": [{"id": {"$in": refs}}, {"offer_id": {"$in": refs}}]},
            ]
        },
        common_projection,
    )
    games_coro = _safe_find(db, "mdg_games", {"id": {"$in": game_ids + refs}}, common_projection, 300)
    store_coro = _safe_find(
        db,
        "store_points_purchase_logs",
        {
            "user_id": user_id,
            "$or": [{"id": {"$in": refs}}, {"store_event_ref": {"$in": refs}}],
        },
        common_projection,
    )
    payments_coro = _safe_find(
        db,
        "payment_transactions",
        {
            "user_id": user_id,
            "$or": [
                {"session_id": {"$in": refs}},
                {"id": {"$in": refs}},
                {"transaction_id": {"$in": refs}},
            ],
        },
        common_projection,
    )
    ledger_coro = _safe_find(
        db,
        "point_ledger_events",
        {
            "user_id": user_id,
            "$or": [{"id": {"$in": refs}}, {"origin_ref": {"$in": refs}}, {"event_ref": {"$in": refs}}],
        },
        common_projection,
        1000,
    )
    transfers, trades, games, stores, payments, ledgers = await __import__("asyncio").gather(
        transfers_coro, trades_coro, games_coro, store_coro, payments_coro, ledger_coro
    )

    result: Dict[str, Dict[str, Any]] = {}
    for event in events:
        event_id = str(event.get("id") or event.get("_id") or "")
        enriched: Dict[str, Any] = {}
        for label, candidates in (
            ("points_transfer", transfers),
            ("quicktrade_event", trades),
            ("store_log", stores),
            ("payment_transaction", payments),
        ):
            match = next((candidate for candidate in candidates if _ref_matches(event, candidate)), None)
            if match:
                enriched[label] = match
        matching_ledgers = [candidate for candidate in ledgers if _ref_matches(event, candidate)]
        if matching_ledgers:
            enriched["point_ledger_events"] = matching_ledgers[:20]
        game_id = str(_context_value(event, "game_id") or event.get("correlation_id") or "")
        game_id = game_id.split(":", 1)[-1]
        game = next((candidate for candidate in games if str(candidate.get("id") or "") == game_id), None)
        if game:
            enriched["mdg_game"] = game
        result[event_id] = enriched
    return result


def _synthetic_base(
    *,
    row_id: Any,
    user_id: str,
    username: Any,
    delta: Any,
    source: str,
    event_type: str,
    created_at: Any,
    origin: str,
    origin_ref: Any = None,
    before: Any = None,
    after: Any = None,
    actor: Any = None,
    counterparty: Any = None,
    context: Any = None,
    meta: Any = None,
) -> dict:
    ref = str(origin_ref or row_id or "")
    return {
        "id": f"synthetic:{origin}:{row_id}",
        "transaction_id": ref or None,
        "correlation_id": ref or None,
        "user_id": user_id,
        "username": username,
        "delta": _int_or_none(delta) or 0,
        "wallet_points_before": _int_or_none(before),
        "wallet_points_after": _int_or_none(after),
        "source": source,
        "event_type": event_type,
        "origin": f"legacy:{origin}",
        "origin_ref": ref or None,
        "actor": actor,
        "counterparty": counterparty,
        "context": dict(context or {}),
        "meta": dict(meta or {}),
        "created_at": created_at,
        "schema_version": None,
        "_synthetic": True,
    }


def synthetic_points_transfer_events(user_id: str, documents: List[dict]) -> List[dict]:
    events: List[dict] = []
    for index, doc in enumerate(documents):
        amount = _int_or_none(doc.get("amount"))
        if not amount or amount <= 0:
            continue
        is_in = str(doc.get("to_user_id") or "") == user_id
        is_out = str(doc.get("from_user_id") or "") == user_id
        if not is_in and not is_out:
            continue
        is_quicktrade = (
            "qt_anonymize_from" in doc
            or "qt_anonymize_to" in doc
            or doc.get("transfer_kind") == "quicktrade"
        )
        before = doc.get("recipient_points_before") if is_in else doc.get("sender_points_before")
        after = doc.get("recipient_points_after") if is_in else doc.get("sender_points_after")
        other = {
            "id": doc.get("from_user_id") if is_in else doc.get("to_user_id"),
            "username": doc.get("from_username") if is_in else doc.get("to_username"),
            "type": "user",
        }
        events.append(
            _synthetic_base(
                row_id=doc.get("id") or f"{index}:{_iso(doc.get('created_at'))}",
                user_id=user_id,
                username=doc.get("to_username") if is_in else doc.get("from_username"),
                delta=amount if is_in else -amount,
                source="quicktrade" if is_quicktrade else "p2p",
                event_type=("quicktrade_buy" if is_in else "quicktrade_sell")
                if is_quicktrade
                else ("transfer_in" if is_in else "transfer_out"),
                created_at=doc.get("created_at"),
                origin="points_transfers",
                origin_ref=doc.get("id"),
                before=before,
                after=after,
                counterparty=other,
                context={
                    "from_user_id": doc.get("from_user_id"),
                    "from_username": doc.get("from_username"),
                    "to_user_id": doc.get("to_user_id"),
                    "to_username": doc.get("to_username"),
                },
                meta={"historical_collection": "points_transfers"},
            )
        )
    return events


def _legacy_source(event_type: Any, meta: Any = None) -> str:
    value = str(event_type or "").lower()
    explicit = str((meta or {}).get("source") or "").strip() if isinstance(meta, dict) else ""
    if explicit:
        return explicit
    if value.startswith("transfer_"):
        return "p2p"
    if value.startswith("quicktrade_"):
        return "quicktrade"
    if value.startswith("casino_"):
        return "casino"
    if value.startswith(("store_", "spend_store")):
        return "store"
    if value.startswith(("mint_purchase", "clawback")):
        return "payments"
    return value.split("_", 1)[0] or "legacy"


def synthetic_point_ledger_events(user_id: str, documents: List[dict]) -> List[dict]:
    """Collapse FIFO lot slices sharing one logical reference into one legacy row."""
    grouped: Dict[Tuple[str, str], List[dict]] = {}
    for index, doc in enumerate(documents):
        if str(doc.get("user_id") or "") != user_id:
            continue
        points = _int_or_none(doc.get("points"))
        if not points:
            continue
        ref = str(doc.get("origin_ref") or doc.get("event_ref") or "")
        key = (str(doc.get("event_type") or "legacy"), ref or f"row:{doc.get('id') or index}")
        grouped.setdefault(key, []).append(doc)

    events: List[dict] = []
    for (event_type, group_ref), rows in grouped.items():
        delta = sum(_int_or_none(row.get("points")) or 0 for row in rows)
        if not delta:
            continue
        first = rows[0]
        before_values = {_int_or_none(row.get("wallet_points_before")) for row in rows}
        after_values = {_int_or_none(row.get("wallet_points_after")) for row in rows}
        before = next(iter(before_values)) if len(before_values) == 1 else None
        after = next(iter(after_values)) if len(after_values) == 1 else None
        if before is None or after is None or after - before != delta:
            before = after = None
        meta = first.get("meta") if isinstance(first.get("meta"), dict) else {}
        ref = str(first.get("origin_ref") or first.get("event_ref") or "")
        events.append(
            _synthetic_base(
                row_id=ref or first.get("id") or group_ref,
                user_id=user_id,
                username=first.get("username"),
                delta=delta,
                source=_legacy_source(event_type, meta),
                event_type=event_type,
                created_at=max((row.get("created_at") for row in rows), key=_row_ts),
                origin="point_ledger_events",
                origin_ref=ref or first.get("id"),
                before=before,
                after=after,
                context=meta,
                meta={
                    **meta,
                    "historical_collection": "point_ledger_events",
                    "ledger_rows_collapsed": len(rows),
                },
            )
        )
    return events


def _synthetic_payment_events(user_id: str, documents: List[dict]) -> List[dict]:
    events = []
    for index, doc in enumerate(documents):
        points = _int_or_none(doc.get("points"))
        if not points or points <= 0:
            continue
        ref = doc.get("session_id") or doc.get("transaction_id") or doc.get("id")
        events.append(
            _synthetic_base(
                row_id=ref or index,
                user_id=user_id,
                username=doc.get("username"),
                delta=points,
                source="payments",
                event_type="mint_purchase",
                created_at=doc.get("points_credited_at") or doc.get("created_at"),
                origin="payment_transactions",
                origin_ref=ref,
                before=doc.get("wallet_points_before")
                if doc.get("wallet_points_before") is not None
                else doc.get("points_before"),
                after=doc.get("wallet_points_after")
                if doc.get("wallet_points_after") is not None
                else doc.get("points_after"),
                context={"package_id": doc.get("package_id"), "payment_status": doc.get("payment_status")},
                meta={"historical_collection": "payment_transactions"},
            )
        )
    return events


def _synthetic_store_events(user_id: str, documents: List[dict]) -> List[dict]:
    events = []
    for index, doc in enumerate(documents):
        points = _int_or_none(doc.get("points_spent") or doc.get("cost_points"))
        if not points or points <= 0:
            continue
        events.append(
            _synthetic_base(
                row_id=doc.get("id") or index,
                user_id=user_id,
                username=doc.get("username"),
                delta=-points,
                source="store",
                event_type="spend_store",
                created_at=doc.get("created_at"),
                origin="store_points_purchase_logs",
                origin_ref=doc.get("store_event_ref") or doc.get("id"),
                before=doc.get("points_before"),
                after=doc.get("points_after"),
                context={
                    "store_item": doc.get("store_event_ref"),
                    "item_label": doc.get("item_label"),
                    "cost_points": points,
                    **(doc.get("extra") if isinstance(doc.get("extra"), dict) else {}),
                },
                meta={"historical_collection": "store_points_purchase_logs"},
            )
        )
    return events


def _synthetic_store_cash_events(user_id: str, documents: List[dict]) -> List[dict]:
    events = []
    for index, doc in enumerate(documents):
        if doc.get("purchase_kind") not in (None, "points_cash"):
            continue
        points = _int_or_none(doc.get("points"))
        if not points or points <= 0:
            continue
        events.append(
            _synthetic_base(
                row_id=doc.get("id") or index,
                user_id=user_id,
                username=doc.get("username"),
                delta=points,
                source="store",
                event_type="store_points_cash_purchase",
                created_at=doc.get("created_at"),
                origin="store_cash_purchase_logs",
                origin_ref=doc.get("id"),
                before=doc.get("points_before"),
                after=doc.get("points_after"),
                context={
                    "purchase_kind": "points_cash",
                    "cash_cost": doc.get("cash_cost"),
                    "price_per_point": doc.get("price_per_point"),
                    "item_label": doc.get("item_label"),
                },
                meta={"historical_collection": "store_cash_purchase_logs"},
            )
        )
    return events


def _synthetic_mdg_events(user_id: str, documents: List[dict]) -> List[dict]:
    events = []
    for index, doc in enumerate(documents):
        details = doc.get("details") if isinstance(doc.get("details"), dict) else {}
        action = str(details.get("action") or "").lower()
        if str(doc.get("game_type") or "").lower() != "mdg":
            continue
        if action in {"create", "join"}:
            delta = -(_int_or_none(details.get("fee_points")) or 0)
        elif action in {"payout", "winner_payout"}:
            delta = _int_or_none(details.get("pot_points") or details.get("payout_points")) or 0
        elif action in {"refund", "join_refund"}:
            delta = _int_or_none(details.get("refund_points") or details.get("fee_points")) or 0
        else:
            delta = _int_or_none(details.get("points_delta")) or 0
        if not delta:
            continue
        game_id = details.get("game_id")
        events.append(
            _synthetic_base(
                row_id=doc.get("id") or index,
                user_id=user_id,
                username=doc.get("username"),
                delta=delta,
                source="casino",
                event_type="casino_mdg",
                created_at=doc.get("created_at"),
                origin="gambling_log",
                origin_ref=f"{action}:{game_id}" if game_id else doc.get("id"),
                context={**details, "result": "won" if delta > 0 and action == "payout" else action},
                meta={"historical_collection": "gambling_log", **details},
            )
        )
    return events


def _synthetic_trade_events(user_id: str, documents: List[dict]) -> List[dict]:
    events = []
    for index, doc in enumerate(documents):
        event_type = str(doc.get("type") or "")
        points = _int_or_none(doc.get("original_points") or doc.get("points")) or 0
        participants: List[Tuple[int, Any, Any, str]] = []
        if event_type == "sell_offer_created" and str(doc.get("user_id") or "") == user_id:
            participants.append((-points, doc.get("username"), None, "quicktrade_create"))
        elif event_type == "sell_offer_cancelled" and str(doc.get("user_id") or "") == user_id:
            participants.append((points, doc.get("username"), None, "quicktrade_cancel"))
        elif event_type == "sell_offer_accepted" and str(doc.get("buyer_id") or "") == user_id:
            participants.append(
                (points, doc.get("buyer_username"), {"id": doc.get("seller_id"), "username": doc.get("seller_username")}, "quicktrade_buy")
            )
        elif event_type == "buy_offer_accepted":
            if str(doc.get("seller_id") or "") == user_id:
                participants.append(
                    (-points, doc.get("seller_username"), {"id": doc.get("buyer_id"), "username": doc.get("buyer_username")}, "quicktrade_sell")
                )
            elif str(doc.get("buyer_id") or "") == user_id:
                participants.append(
                    (points, doc.get("buyer_username"), {"id": doc.get("seller_id"), "username": doc.get("seller_username")}, "quicktrade_buy")
                )
        for delta, username, other, normalized_type in participants:
            if not delta:
                continue
            events.append(
                _synthetic_base(
                    row_id=f"{doc.get('id') or index}:{user_id}",
                    user_id=user_id,
                    username=username,
                    delta=delta,
                    source="quicktrade",
                    event_type=normalized_type,
                    created_at=doc.get("at") or doc.get("created_at"),
                    origin="trade_events",
                    origin_ref=doc.get("id"),
                    counterparty=other,
                    context={"offer_id": doc.get("id"), "cost_cash": doc.get("money"), "legacy_type": event_type},
                    meta={"historical_collection": "trade_events"},
                )
            )
    return events


def _dedupe_event_keys(event: dict) -> set:
    delta = _int_or_none(event.get("delta")) or 0
    user_id = str(event.get("user_id") or "")
    refs = {
        str(event.get(key))
        for key in ("origin_ref", "transaction_id", "correlation_id")
        if event.get(key) not in (None, "")
    }
    keys = {f"ref:{user_id}:{ref}:{delta}" for ref in refs}
    if event.get("normalized_event_key"):
        keys.add(f"normalized:{event['normalized_event_key']}")
    for ref in refs:
        keys.add(f"normalized:points:{user_id}:{ref}:{delta}")
    return keys


def _matches_audit_filters(
    event: dict,
    *,
    date_from: Optional[datetime],
    date_to: Optional[datetime],
    source: Optional[str],
    direction: Optional[str],
    counterparty: Optional[str],
    reference_text: Optional[str],
    incomplete_only: bool,
    suspicious_only: bool,
) -> bool:
    timestamp = _row_ts(event.get("created_at"))
    if date_from and timestamp < date_from.timestamp():
        return False
    if date_to and timestamp > date_to.timestamp():
        return False
    if source and str(event.get("source") or "").lower() != source.strip().lower():
        return False
    delta = _int_or_none(event.get("delta")) or 0
    if direction == "inflow" and delta <= 0:
        return False
    if direction == "outflow" and delta >= 0:
        return False
    if counterparty:
        needle = counterparty.strip().lower()
        party = event.get("counterparty") if isinstance(event.get("counterparty"), dict) else {}
        party_text = " ".join(str(party.get(key) or "") for key in ("id", "username")).lower()
        context_text = json.dumps(_json_safe(event.get("context") or {}), sort_keys=True).lower()
        if needle not in party_text and needle not in context_text:
            return False
    if reference_text:
        needle = reference_text.strip().lower()
        searchable = {
            "transaction_id": event.get("transaction_id"),
            "correlation_id": event.get("correlation_id"),
            "origin_ref": event.get("origin_ref"),
            "normalized_event_key": event.get("normalized_event_key"),
            "context": event.get("context"),
            "meta": event.get("meta"),
        }
        if needle not in json.dumps(_json_safe(searchable), sort_keys=True).lower():
            return False
    flags = audit_anomaly_flags(event)
    if incomplete_only and "incomplete_snapshot" not in flags:
        return False
    if suspicious_only and not flags:
        return False
    return True


async def _history_find(
    db,
    collection: str,
    query: dict,
    time_field: str,
    limit: int,
    *,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    before: Optional[datetime] = None,
) -> List[dict]:
    try:
        upper = min((value for value in (date_to, before) if value is not None), default=None)
        if date_from or upper:
            datetime_range: Dict[str, Any] = {}
            string_range: Dict[str, Any] = {}
            if date_from:
                datetime_range["$gte"] = date_from
                string_range["$gte"] = date_from.isoformat()
            if upper:
                # Include equal timestamps; the final opaque cursor comparison
                # resolves deterministic ID ties after all sources are merged.
                datetime_range["$lte"] = upper
                string_range["$lte"] = upper.isoformat()
            query = {
                "$and": [
                    query,
                    {"$or": [{time_field: datetime_range}, {time_field: string_range}]},
                ]
            }
        return await db[collection].find(query, {"_id": 0}).sort(time_field, -1).limit(limit).to_list(limit)
    except Exception:
        return []


async def build_detailed_points_audit(
    db,
    user_id: str,
    *,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    source: Optional[str] = None,
    direction: Optional[str] = None,
    counterparty: Optional[str] = None,
    reference_text: Optional[str] = None,
    incomplete_only: bool = False,
    suspicious_only: bool = False,
    limit: int = _DEFAULT_AUDIT_LIMIT,
    offset: int = 0,
    cursor: Optional[str] = None,
) -> Dict[str, Any]:
    """Merge canonical events with bounded best-effort historical synthetic rows."""
    cap = max(1, min(_MAX_AUDIT_LIMIT, int(limit or _DEFAULT_AUDIT_LIMIT)))
    safe_offset = max(0, min(100000, int(offset or 0)))
    cursor_value = decode_audit_cursor(cursor)
    scan_limit = max(500, min(5000, safe_offset + cap + 1))
    duplicate_keys, duplicate_refs = await __import__("asyncio").gather(
        _duplicate_values(db, user_id, "normalized_event_key"),
        _duplicate_values(db, user_id, "origin_ref"),
    )
    history_window = {
        "date_from": date_from,
        "date_to": date_to,
        "before": cursor_value[0] if cursor_value else None,
    }
    canonical_query: dict = {"user_id": user_id}
    if source:
        canonical_query["source"] = {"$regex": f"^{re.escape(source.strip())}$", "$options": "i"}
    canonical_coro = _history_find(
        db, "point_audit_events", canonical_query, "created_at", scan_limit, **history_window
    )
    transfers_coro = _history_find(
        db,
        "points_transfers",
        {"$or": [{"from_user_id": user_id}, {"to_user_id": user_id}]},
        "created_at",
        scan_limit,
        **history_window,
    )
    ledger_coro = _history_find(
        db, "point_ledger_events", {"user_id": user_id}, "created_at", scan_limit, **history_window
    )
    payments_coro = _history_find(
        db,
        "payment_transactions",
        {"user_id": user_id, "payment_status": "completed"},
        "created_at",
        scan_limit,
        **history_window,
    )
    gambling_coro = _history_find(
        db,
        "gambling_log",
        {"user_id": user_id, "game_type": "mdg"},
        "created_at",
        scan_limit,
        **history_window,
    )
    trades_coro = _history_find(
        db,
        "trade_events",
        {"$or": [{"user_id": user_id}, {"seller_id": user_id}, {"buyer_id": user_id}]},
        "at",
        scan_limit,
        **history_window,
    )
    stores_coro = _history_find(
        db,
        "store_points_purchase_logs",
        {"user_id": user_id},
        "created_at",
        scan_limit,
        **history_window,
    )
    store_cash_coro = _history_find(
        db,
        "store_cash_purchase_logs",
        {"user_id": user_id, "purchase_kind": "points_cash"},
        "created_at",
        scan_limit,
        **history_window,
    )
    canonical, transfers, ledger, payments, gambling, trades, stores, store_cash = await __import__("asyncio").gather(
        canonical_coro,
        transfers_coro,
        ledger_coro,
        payments_coro,
        gambling_coro,
        trades_coro,
        stores_coro,
        store_cash_coro,
    )

    candidates: List[dict] = list(canonical)
    candidates.extend(synthetic_points_transfer_events(user_id, transfers))
    candidates.extend(synthetic_point_ledger_events(user_id, ledger))
    candidates.extend(_synthetic_payment_events(user_id, payments))
    candidates.extend(_synthetic_mdg_events(user_id, gambling))
    candidates.extend(_synthetic_trade_events(user_id, trades))
    candidates.extend(_synthetic_store_events(user_id, stores))
    candidates.extend(_synthetic_store_cash_events(user_id, store_cash))

    # Canonical rows win. Historical collections are ordered above by reliability;
    # exact user/reference/delta matches collapse without guessing fuzzy equivalence.
    deduped: List[dict] = []
    seen_keys: set = set()
    seen_ids: set = set()
    semantic_times: Dict[Tuple[str, str, int], List[float]] = {}
    for event in candidates:
        event_id = str(event.get("id") or "")
        keys = _dedupe_event_keys(event)
        semantic_key = (
            str(event.get("source") or ""),
            str(event.get("event_type") or ""),
            _int_or_none(event.get("delta")) or 0,
        )
        event_ts = _row_ts(event.get("created_at"))
        # Some old Quick Trade rows predate correlation IDs. For those only,
        # collapse an otherwise identical leg logged within the same operation.
        fuzzy_duplicate = bool(
            event.get("_synthetic")
            and event.get("origin") == "legacy:trade_events"
            and any(abs(event_ts - seen_ts) <= 5.0 for seen_ts in semantic_times.get(semantic_key, []))
        )
        if event_id and event_id in seen_ids:
            continue
        if (keys and keys & seen_keys) or fuzzy_duplicate:
            continue
        deduped.append(event)
        if event_id:
            seen_ids.add(event_id)
        seen_keys.update(keys)
        if event_ts:
            semantic_times.setdefault(semantic_key, []).append(event_ts)

    filtered = [
        event
        for event in deduped
        if _matches_audit_filters(
            event,
            date_from=date_from,
            date_to=date_to,
            source=source,
            direction=direction,
            counterparty=counterparty,
            reference_text=reference_text,
            incomplete_only=incomplete_only,
            suspicious_only=False,
        )
    ]
    filtered.sort(key=lambda event: (_row_ts(event.get("created_at")), str(event.get("id") or "")), reverse=True)
    chain_candidates_are_contiguous = not any(
        (source, direction, counterparty, reference_text, incomplete_only)
    )
    if chain_candidates_are_contiguous:
        for index, event in enumerate(filtered[:-1]):
            newer_before = _int_or_none(event.get("wallet_points_before"))
            older_after = _int_or_none(filtered[index + 1].get("wallet_points_after"))
            if newer_before is not None and older_after is not None and older_after != newer_before:
                event["_computed_chain_gap"] = True
    if suspicious_only:
        filtered = [
            event
            for event in filtered
            if audit_anomaly_flags(event)
            or event.get("_computed_chain_gap")
            or (
                event.get("normalized_event_key")
                and str(event.get("normalized_event_key")) in duplicate_keys
            )
            or (event.get("origin_ref") and str(event.get("origin_ref")) in duplicate_refs)
        ]
    if cursor_value:
        cursor_time, cursor_id = cursor_value
        cursor_ts = cursor_time.timestamp()
        filtered = [
            event
            for event in filtered
            if (_row_ts(event.get("created_at")), str(event.get("id") or "")) < (cursor_ts, cursor_id)
        ]
        page_start = 0
    else:
        page_start = safe_offset
    page_slice = filtered[page_start : page_start + cap + 1]
    has_more = len(page_slice) > cap
    page_events = page_slice[:cap]
    enrichment = await _load_audit_enrichment(db, user_id, page_events)

    correlations = list(
        dict.fromkeys(
            str(event.get("correlation_id") or event.get("transaction_id") or "")
            for event in page_events
            if event.get("correlation_id") or event.get("transaction_id")
        )
    )
    linked: Dict[str, List[dict]] = {}
    if correlations:
        try:
            legs = await db.point_audit_events.find(
                {
                    "correlation_id": {"$in": correlations},
                    "user_id": {"$ne": user_id},
                },
                {
                    "_id": 0,
                    "id": 1,
                    "user_id": 1,
                    "username": 1,
                    "delta": 1,
                    "wallet_points_before": 1,
                    "wallet_points_after": 1,
                    "source": 1,
                    "event_type": 1,
                    "correlation_id": 1,
                    "created_at": 1,
                },
            ).limit(1000).to_list(1000)
            for leg in legs:
                linked.setdefault(str(leg.get("correlation_id") or ""), []).append(leg)
        except Exception:
            linked = {}

    rows: List[Dict[str, Any]] = []
    anomaly_counts: Dict[str, int] = {}
    chain_is_contiguous = not any(
        (source, direction, counterparty, reference_text, incomplete_only, suspicious_only)
    )
    for index, event in enumerate(page_events):
        chain_gap = bool(event.get("_computed_chain_gap"))
        if chain_is_contiguous and index + 1 < len(page_events):
            newer = event
            older = page_events[index + 1]
            newer_before = _int_or_none(newer.get("wallet_points_before"))
            older_after = _int_or_none(older.get("wallet_points_after"))
            chain_gap = newer_before is not None and older_after is not None and older_after != newer_before
        event_id = str(event.get("id") or "")
        correlation = str(event.get("correlation_id") or event.get("transaction_id") or "")
        row = _audit_row(
            event,
            enrichment.get(event_id, {}),
            duplicate_key=bool(
                event.get("normalized_event_key")
                and str(event.get("normalized_event_key")) in duplicate_keys
            ),
            duplicate_reference=bool(event.get("origin_ref") and str(event.get("origin_ref")) in duplicate_refs),
            chain_gap=chain_gap,
            linked_legs=linked.get(correlation, []),
        )
        for flag in row["anomaly_flags"]:
            anomaly_counts[flag] = anomaly_counts.get(flag, 0) + 1
        rows.append(row)

    last_event = page_events[-1] if page_events and has_more else None
    next_cursor = (
        encode_audit_cursor(last_event.get("created_at"), last_event.get("id")) if last_event else None
    )
    return {
        "items": rows,
        "pagination": {
            "limit": cap,
            "offset": None if cursor_value else safe_offset,
            "cursor": cursor or None,
            "next_cursor": next_cursor,
            "has_more": has_more,
            "returned": len(rows),
            "order": "created_at_desc,id_desc",
        },
        "filters": {
            "date_from": _iso(date_from) if date_from else None,
            "date_to": _iso(date_to) if date_to else None,
            "source": source or None,
            "direction": direction or None,
            "counterparty": counterparty or None,
            "reference_text": reference_text or None,
            "incomplete_only": bool(incomplete_only),
            "suspicious_only": bool(suspicious_only),
        },
        "anomaly_summary": anomaly_counts,
        "canonical_collection": "point_audit_events",
        "historical_synthetic": {
            "enabled": True,
            "scan_limit_per_collection": scan_limit,
            "collections": [
                "points_transfers",
                "point_ledger_events",
                "payment_transactions",
                "gambling_log",
                "trade_events",
                "store_points_purchase_logs",
                "store_cash_purchase_logs",
            ],
        },
    }


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
