import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional

from pymongo import ReturnDocument


POINT_AUDIT_SCHEMA_VERSION = 1
POINT_AUDIT_COLLECTION = "point_audit_events"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_party(party: Optional[Mapping[str, Any]]) -> Optional[Dict[str, Any]]:
    if party is None:
        return None
    return {
        "id": party.get("id") or party.get("user_id"),
        "username": party.get("username"),
        "type": party.get("type") or "user",
    }


def _logical_event_key(
    user_id: str,
    delta: int,
    origin_ref: Optional[str],
) -> Optional[str]:
    """Stable key shared by FIFO/mint helpers and their legacy log call."""
    if not origin_ref:
        return None
    return f"points:{user_id}:{origin_ref}:{int(delta)}"


def _source_for_event(event_type: str, meta: Optional[Mapping[str, Any]] = None) -> str:
    explicit = str((meta or {}).get("source") or "").strip()
    if explicit:
        return explicit
    value = str(event_type or "").lower()
    for prefix, source in (
        ("admin_", "admin"),
        ("quicktrade_", "quicktrade"),
        ("casino_", "casino"),
        ("store_", "store"),
        ("spend_store", "store"),
        ("transfer_", "p2p"),
        ("stock_", "stock_market"),
        ("game_pass", "game_pass"),
        ("objective", "objectives"),
        ("loot", "loot"),
        ("family", "family"),
        ("attack", "combat"),
        ("clawback", "payments"),
        ("mint_purchase", "payments"),
    ):
        if value.startswith(prefix):
            return source
    return value.split("_", 1)[0] or "legacy"


async def record_points_audit_event(
    db,
    *,
    user_id: str,
    delta: int,
    source: str,
    event_type: str,
    username: Optional[str] = None,
    wallet_points_before: Optional[int] = None,
    wallet_points_after: Optional[int] = None,
    correlation_id: Optional[str] = None,
    transaction_id: Optional[str] = None,
    origin: Optional[str] = None,
    origin_ref: Optional[str] = None,
    actor: Optional[Mapping[str, Any]] = None,
    counterparty: Optional[Mapping[str, Any]] = None,
    context: Optional[Mapping[str, Any]] = None,
    meta: Optional[Mapping[str, Any]] = None,
    normalized_event_key: Optional[str] = None,
    created_at: Optional[datetime] = None,
    session=None,
) -> Dict[str, Any]:
    """Record one staff-facing logical points event.

    This is deliberately separate from ``point_ledger_events``: FIFO provenance
    can emit several lot rows for one logical wallet change and must retain its
    existing shape and behavior.
    """
    if not user_id:
        raise ValueError("user_id is required")
    signed_delta = int(delta)
    if signed_delta == 0:
        raise ValueError("delta must be non-zero")
    if not source or not event_type:
        raise ValueError("source and event_type are required")

    before = int(wallet_points_before) if wallet_points_before is not None else None
    after = int(wallet_points_after) if wallet_points_after is not None else None
    if (before is None) != (after is None):
        raise ValueError("wallet_points_before and wallet_points_after must be supplied together")
    if before is not None and after - before != signed_delta:
        raise ValueError("wallet points before/after do not match delta")

    if username is None:
        lookup_kwargs = {"session": session} if session is not None else {}
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1}, **lookup_kwargs)
        username = (user or {}).get("username")

    event_id = str(uuid.uuid4())
    normalized_correlation_id = correlation_id or transaction_id or event_id
    actor_doc = _clean_party(actor)
    counterparty_doc = _clean_party(counterparty)
    doc: Dict[str, Any] = {
        "id": event_id,
        "transaction_id": transaction_id or normalized_correlation_id,
        "correlation_id": normalized_correlation_id,
        "user_id": user_id,
        "username": username,
        "delta": signed_delta,
        "wallet_points_before": before,
        "wallet_points_after": after,
        "source": source,
        "event_type": event_type,
        "origin": origin,
        "origin_ref": origin_ref,
        "actor": actor_doc,
        "actor_id": (actor_doc or {}).get("id"),
        "counterparty": counterparty_doc,
        "counterparty_id": (counterparty_doc or {}).get("id"),
        "context": dict(context or {}),
        "meta": dict(meta or {}),
        "created_at": created_at or datetime.now(timezone.utc),
        "schema_version": POINT_AUDIT_SCHEMA_VERSION,
    }
    if normalized_event_key:
        doc["normalized_event_key"] = normalized_event_key
    insert_kwargs = {"session": session} if session is not None else {}
    collection = getattr(db, POINT_AUDIT_COLLECTION)
    if normalized_event_key:
        result = await collection.update_one(
            {"normalized_event_key": normalized_event_key},
            {"$setOnInsert": doc},
            upsert=True,
            **insert_kwargs,
        )
        if not getattr(result, "upserted_id", None):
            existing = await collection.find_one(
                {"normalized_event_key": normalized_event_key},
                {"_id": 0},
                **insert_kwargs,
            )
            return existing or doc
    else:
        await collection.insert_one(doc, **insert_kwargs)
    return doc


async def apply_points_delta_with_audit(
    db,
    *,
    user_id: str,
    delta: int,
    source: str,
    event_type: str,
    user_filter: Optional[Mapping[str, Any]] = None,
    correlation_id: Optional[str] = None,
    transaction_id: Optional[str] = None,
    origin: Optional[str] = None,
    origin_ref: Optional[str] = None,
    actor: Optional[Mapping[str, Any]] = None,
    counterparty: Optional[Mapping[str, Any]] = None,
    context: Optional[Mapping[str, Any]] = None,
    meta: Optional[Mapping[str, Any]] = None,
    session=None,
) -> Optional[Dict[str, Any]]:
    """Atomically apply a simple wallet delta and record its exact before/after.

    Returns ``None`` when the user or additional condition did not match.
    Pass a MongoDB session/transaction when the mutation and audit insert must
    commit together; without one, only the wallet delta itself is atomic.
    """
    signed_delta = int(delta)
    if signed_delta == 0:
        raise ValueError("delta must be non-zero")
    query: Dict[str, Any] = dict(user_filter or {})
    if "id" in query and query["id"] != user_id:
        raise ValueError("user_filter cannot target a different user")
    query["id"] = user_id
    update_kwargs: Dict[str, Any] = {
        "projection": {"_id": 0, "id": 1, "username": 1, "points": 1},
        "return_document": ReturnDocument.BEFORE,
    }
    if session is not None:
        update_kwargs["session"] = session
    user_before = await db.users.find_one_and_update(
        query,
        {"$inc": {"points": signed_delta}},
        **update_kwargs,
    )
    if not user_before:
        return None

    before = int(user_before.get("points") or 0)
    after = before + signed_delta
    event = await record_points_audit_event(
        db,
        user_id=user_id,
        username=user_before.get("username"),
        delta=signed_delta,
        wallet_points_before=before,
        wallet_points_after=after,
        source=source,
        event_type=event_type,
        correlation_id=correlation_id,
        transaction_id=transaction_id,
        origin=origin,
        origin_ref=origin_ref,
        actor=actor,
        counterparty=counterparty,
        context=context,
        meta=meta,
        session=session,
    )
    return {
        "user_id": user_id,
        "username": user_before.get("username"),
        "wallet_points_before": before,
        "wallet_points_after": after,
        "delta": signed_delta,
        "audit_event": event,
    }


async def log_points_event(
    db,
    *,
    user_id: str,
    points: int,
    event_type: str,
    event_ref: Optional[str] = None,
    meta: Optional[Dict] = None,
    wallet_points_before: Optional[int] = None,
    wallet_points_after: Optional[int] = None,
    source: Optional[str] = None,
    correlation_id: Optional[str] = None,
    actor: Optional[Mapping[str, Any]] = None,
    counterparty: Optional[Mapping[str, Any]] = None,
    context: Optional[Mapping[str, Any]] = None,
    record_normalized: bool = True,
    infer_wallet_after: bool = True,
):
    """Lightweight audit log for any point change that doesn't need FIFO lot tracking."""
    if not user_id or points == 0:
        return
    doc: Dict = {
        "id": str(uuid.uuid4()),
        "event_type": event_type,
        "user_id": user_id,
        "points": int(points),
        "lot_id": None,
        "origin_ref": event_ref,
        "root_purchase_ref": None,
        "meta": meta or {},
        "created_at": _now_iso(),
    }
    if wallet_points_before is not None:
        doc["wallet_points_before"] = int(wallet_points_before)
    if wallet_points_after is not None:
        doc["wallet_points_after"] = int(wallet_points_after)
    await db.point_ledger_events.insert_one(doc)
    if not record_normalized:
        return doc

    before = wallet_points_before
    after = wallet_points_after
    provided_snapshot = before is not None or after is not None
    # Some legacy non-wallet ledgers (notably entertainer funds) deliberately
    # supplied equal snapshots for a non-zero delta. Preserve the legacy row,
    # but do not misrepresent those values as wallet snapshots.
    snapshot_usable = (
        before is not None
        and after is not None
        and int(after) - int(before) == int(points)
    )
    if not snapshot_usable:
        before = None
        after = None
    inferred_username = None
    # Only infer when the caller omitted both snapshots. If they supplied a
    # non-wallet or mismatched snapshot pair, leave balances unknown.
    if before is None and after is None and infer_wallet_after and not provided_snapshot:
        # Active callers overwhelmingly log immediately after the wallet mutation.
        # Capture that resulting wallet and derive the exact pre-change value. Flows
        # that log a non-wallet fund or log before a later aggregate mutation opt out.
        wallet = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "username": 1, "points": 1},
        )
        if wallet and wallet.get("points") is not None:
            inferred_username = wallet.get("username")
            after = int(wallet.get("points") or 0)
            before = after - int(points)
    normalized_context = dict(meta or {})
    normalized_context.update(dict(context or {}))
    await record_points_audit_event(
        db,
        user_id=user_id,
        username=inferred_username,
        delta=int(points),
        source=source or _source_for_event(event_type, meta),
        event_type=event_type,
        wallet_points_before=before,
        wallet_points_after=after,
        correlation_id=correlation_id or event_ref,
        origin="legacy_log_points_event",
        origin_ref=event_ref,
        actor=actor,
        counterparty=counterparty,
        context=normalized_context,
        meta=meta,
        normalized_event_key=_logical_event_key(user_id, int(points), event_ref),
    )
    return doc


async def ensure_user_legacy_seed_lot(db, user_id: str, balance: Optional[int] = None) -> int:
    """Ensure lot coverage exists for existing balances (legacy users). Returns added amount."""
    if not user_id:
        return 0
    if balance is None:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "points": 1})
        balance = int((u or {}).get("points") or 0)
    if balance <= 0:
        return 0
    pipeline = [
        {"$match": {"owner_user_id": user_id, "remaining_points": {"$gt": 0}}},
        {"$group": {"_id": None, "total": {"$sum": "$remaining_points"}}},
    ]
    rows = await db.point_lots.aggregate(pipeline).to_list(1)
    covered = int(rows[0]["total"]) if rows else 0
    missing = max(0, int(balance) - covered)
    if missing <= 0:
        return 0
    now_iso = _now_iso()
    lot_id = str(uuid.uuid4())
    await db.point_lots.insert_one(
        {
            "id": lot_id,
            "owner_user_id": user_id,
            "origin_type": "legacy_seed",
            "origin_ref": f"legacy:{user_id}:{now_iso}",
            "remaining_points": missing,
            "root_purchase_ref": None,
            "parent_lot_id": None,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
    )
    await db.point_ledger_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "event_type": "legacy_seed",
            "user_id": user_id,
            "points": missing,
            "lot_id": lot_id,
            "origin_ref": f"legacy:{user_id}",
            "root_purchase_ref": None,
            "meta": {"reason": "backfill_coverage"},
            "created_at": now_iso,
        }
    )
    return missing


async def mint_purchase_lot_if_missing(
    db,
    *,
    user_id: str,
    session_id: str,
    package_id: str,
    points: int,
) -> bool:
    """Idempotent mint for paid store points. Returns True only when newly minted."""
    if not user_id or not session_id or points <= 0:
        return False
    now_iso = _now_iso()
    lot_id = f"purchase:{session_id}"
    doc = {
        "id": lot_id,
        "owner_user_id": user_id,
        "origin_type": "purchase",
        "origin_ref": session_id,
        "remaining_points": int(points),
        "root_purchase_ref": session_id,
        "parent_lot_id": None,
        "package_id": package_id,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    res = await db.point_lots.update_one({"id": lot_id}, {"$setOnInsert": doc}, upsert=True)
    inserted = bool(getattr(res, "upserted_id", None))
    if inserted:
        await db.point_ledger_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "event_type": "mint_purchase",
                "user_id": user_id,
                "points": int(points),
                "lot_id": lot_id,
                "origin_ref": session_id,
                "root_purchase_ref": session_id,
                "meta": {"package_id": package_id},
                "created_at": now_iso,
            }
        )
        await record_points_audit_event(
            db,
            user_id=user_id,
            delta=int(points),
            source="payments",
            event_type="mint_purchase",
            correlation_id=session_id,
            origin="mint_purchase_lot_if_missing",
            origin_ref=session_id,
            context={"package_id": package_id},
            normalized_event_key=_logical_event_key(user_id, int(points), session_id),
        )
    return inserted


async def mint_store_points_cash_lot_if_missing(
    db,
    *,
    user_id: str,
    purchase_id: str,
    points: int,
    wallet_points_before: Optional[int] = None,
    wallet_points_after: Optional[int] = None,
    context: Optional[Mapping[str, Any]] = None,
) -> bool:
    """Idempotent mint for store cash → points purchases."""
    if not user_id or not purchase_id or points <= 0:
        return False
    now_iso = _now_iso()
    lot_id = f"store_points_cash:{purchase_id}"
    doc = {
        "id": lot_id,
        "owner_user_id": user_id,
        "origin_type": "store_points_cash",
        "origin_ref": purchase_id,
        "remaining_points": int(points),
        "root_purchase_ref": purchase_id,
        "parent_lot_id": None,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    res = await db.point_lots.update_one({"id": lot_id}, {"$setOnInsert": doc}, upsert=True)
    inserted = bool(getattr(res, "upserted_id", None))
    if inserted:
        await db.point_ledger_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "event_type": "mint_store_points_cash",
                "user_id": user_id,
                "points": int(points),
                "lot_id": lot_id,
                "origin_ref": purchase_id,
                "root_purchase_ref": purchase_id,
                "meta": {"source": "store_points_cash"},
                "created_at": now_iso,
            }
        )
        await record_points_audit_event(
            db,
            user_id=user_id,
            delta=int(points),
            source="store",
            event_type="store_points_cash_purchase",
            wallet_points_before=wallet_points_before,
            wallet_points_after=wallet_points_after,
            correlation_id=purchase_id,
            origin="mint_store_points_cash_lot_if_missing",
            origin_ref=purchase_id,
            context={"purchase_kind": "points_cash", **dict(context or {})},
            normalized_event_key=_logical_event_key(user_id, int(points), purchase_id),
        )
    return inserted


async def consume_points_fifo(
    db,
    *,
    user_id: str,
    points: int,
    event_type: str,
    event_ref: Optional[str] = None,
    meta: Optional[Dict] = None,
    assume_balance_already_decremented_by: int = 0,
    source: Optional[str] = None,
    correlation_id: Optional[str] = None,
    actor: Optional[Mapping[str, Any]] = None,
    counterparty: Optional[Mapping[str, Any]] = None,
    context: Optional[Mapping[str, Any]] = None,
    wallet_points_before: Optional[int] = None,
    wallet_points_after: Optional[int] = None,
) -> List[Dict]:
    """Consume points from oldest lots. Returns slices with ancestry for downstream transfer/clawback.

    If ``users.points`` was already decreased by this same ``points`` amount before this call
    (e.g. atomic transfer/store deduct), pass ``assume_balance_already_decremented_by=points`` so
    legacy lot seeding uses the pre-deduct ledger total. Otherwise seeding sees only the reduced
    balance and can leave lots under-covered, causing partial FIFO consumption and integrity failures.
    """
    amount = int(points or 0)
    if amount <= 0 or not user_id:
        return []
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "points": 1})
    db_bal = int((user or {}).get("points") or 0)
    extra = max(0, int(assume_balance_already_decremented_by or 0))
    seed_balance = db_bal + extra
    await ensure_user_legacy_seed_lot(db, user_id, seed_balance)
    cursor = db.point_lots.find(
        {"owner_user_id": user_id, "remaining_points": {"$gt": 0}},
        {"_id": 0, "id": 1, "remaining_points": 1, "root_purchase_ref": 1, "origin_ref": 1},
    ).sort([("created_at", 1), ("id", 1)])
    lots = await cursor.to_list(5000)
    remaining = amount
    out: List[Dict] = []
    now_iso = _now_iso()
    for lot in lots:
        if remaining <= 0:
            break
        available = int(lot.get("remaining_points") or 0)
        if available <= 0:
            continue
        take = min(available, remaining)
        await db.point_lots.update_one(
            {"id": lot["id"], "remaining_points": {"$gte": take}},
            {"$inc": {"remaining_points": -take}, "$set": {"updated_at": now_iso}},
        )
        await db.point_ledger_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "event_type": event_type,
                "user_id": user_id,
                "points": -take,
                "lot_id": lot["id"],
                "origin_ref": event_ref,
                "root_purchase_ref": lot.get("root_purchase_ref"),
                "meta": meta or {},
                "created_at": now_iso,
            }
        )
        out.append(
            {
                "from_lot_id": lot["id"],
                "amount": take,
                "root_purchase_ref": lot.get("root_purchase_ref"),
                "origin_ref": lot.get("origin_ref"),
            }
        )
        remaining -= take
    consumed = amount - remaining
    if consumed > 0:
        if (
            wallet_points_before is not None
            and wallet_points_after is not None
            and int(wallet_points_after) - int(wallet_points_before) == -consumed
        ):
            before = int(wallet_points_before)
            after = int(wallet_points_after)
        else:
            before = db_bal + extra if extra else db_bal
            after = before - consumed
        normalized_context = dict(meta or {})
        normalized_context.update(dict(context or {}))
        await record_points_audit_event(
            db,
            user_id=user_id,
            delta=-consumed,
            source=source or _source_for_event(event_type, meta),
            event_type=event_type,
            wallet_points_before=before,
            wallet_points_after=after,
            correlation_id=correlation_id or event_ref,
            origin="consume_points_fifo",
            origin_ref=event_ref,
            actor=actor,
            counterparty=counterparty,
            context=normalized_context,
            meta=meta,
            normalized_event_key=_logical_event_key(user_id, -consumed, event_ref),
        )
    return out


async def mint_transfer_in_lots(
    db,
    *,
    to_user_id: str,
    transfer_id: str,
    from_user_id: str,
    slices: List[Dict],
    from_username: Optional[str] = None,
    to_username: Optional[str] = None,
    wallet_points_before: Optional[int] = None,
    wallet_points_after: Optional[int] = None,
) -> int:
    if not to_user_id or not slices:
        return 0
    now_iso = _now_iso()
    total = 0
    for sl in slices:
        amt = int(sl.get("amount") or 0)
        if amt <= 0:
            continue
        total += amt
        lot_id = str(uuid.uuid4())
        await db.point_lots.insert_one(
            {
                "id": lot_id,
                "owner_user_id": to_user_id,
                "origin_type": "transfer_in",
                "origin_ref": transfer_id,
                "remaining_points": amt,
                "root_purchase_ref": sl.get("root_purchase_ref"),
                "parent_lot_id": sl.get("from_lot_id"),
                "created_at": now_iso,
                "updated_at": now_iso,
            }
        )
        await db.point_ledger_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "event_type": "transfer_in",
                "user_id": to_user_id,
                "points": amt,
                "lot_id": lot_id,
                "origin_ref": transfer_id,
                "root_purchase_ref": sl.get("root_purchase_ref"),
                "meta": {"from_user_id": from_user_id},
                "created_at": now_iso,
            }
        )
    if total > 0:
        await record_points_audit_event(
            db,
            user_id=to_user_id,
            username=to_username,
            delta=total,
            source="p2p",
            event_type="transfer_in",
            wallet_points_before=wallet_points_before,
            wallet_points_after=wallet_points_after,
            correlation_id=transfer_id,
            origin="mint_transfer_in_lots",
            origin_ref=transfer_id,
            counterparty={"id": from_user_id, "username": from_username},
            context={
                "from_user_id": from_user_id,
                "from_username": from_username,
                "to_user_id": to_user_id,
                "to_username": to_username,
                "direction": "in",
                "transfer_id": transfer_id,
            },
            normalized_event_key=_logical_event_key(to_user_id, total, transfer_id),
        )
    return total


async def chargeback_preview(db, payment_session_id: str) -> Dict:
    if not payment_session_id:
        return {"requested": 0, "eligible_remaining": 0, "reclaimed": 0, "unrecoverable": 0, "owners": []}
    txn = await db.payment_transactions.find_one({"session_id": payment_session_id}, {"_id": 0, "points": 1})
    requested = int((txn or {}).get("points") or 0)
    pipeline = [
        {"$match": {"root_purchase_ref": payment_session_id, "remaining_points": {"$gt": 0}}},
        {"$group": {"_id": "$owner_user_id", "remaining": {"$sum": "$remaining_points"}}},
        {"$sort": {"remaining": -1}},
    ]
    owners = await db.point_lots.aggregate(pipeline).to_list(10000)
    total = sum(int(x.get("remaining") or 0) for x in owners)
    clawback_events = await db.point_ledger_events.aggregate(
        [
            {
                "$match": {
                    "root_purchase_ref": payment_session_id,
                    "event_type": "clawback",
                    "points": {"$lt": 0},
                }
            },
            {"$group": {"_id": None, "sum_abs": {"$sum": {"$abs": "$points"}}}},
        ]
    ).to_list(1)
    reclaimed_total = int((clawback_events[0].get("sum_abs") if clawback_events else 0) or 0)
    unrecoverable_total = max(0, requested - reclaimed_total)
    return {
        "requested": requested,
        "eligible_remaining": total,
        "reclaimed": reclaimed_total,
        "unrecoverable": unrecoverable_total,
        "owners": [{"user_id": x["_id"], "remaining": int(x.get("remaining") or 0)} for x in owners],
    }


async def execute_chargeback_best_effort(
    db,
    *,
    payment_session_id: str,
    admin_user_id: str,
    admin_username: str,
) -> Dict:
    preview = await chargeback_preview(db, payment_session_id)
    requested = int(preview.get("requested") or 0)
    if requested <= 0:
        return {"requested": 0, "reclaimed": 0, "unrecoverable": 0, "owners": []}
    remaining_to_reclaim = requested
    reclaimed = 0
    owner_results = []
    for owner in preview.get("owners") or []:
        if remaining_to_reclaim <= 0:
            break
        uid = owner["user_id"]
        eligible = int(owner.get("remaining") or 0)
        if eligible <= 0:
            continue
        u = await db.users.find_one({"id": uid}, {"_id": 0, "points": 1})
        bal = int((u or {}).get("points") or 0)
        reclaim = min(eligible, bal, remaining_to_reclaim)
        if reclaim <= 0:
            owner_results.append({"user_id": uid, "reclaimed": 0, "eligible": eligible, "balance": bal})
            continue
        await db.users.update_one({"id": uid, "points": {"$gte": reclaim}}, {"$inc": {"points": -reclaim}})
        slices = await consume_points_fifo(
            db,
            user_id=uid,
            points=reclaim,
            event_type="clawback",
            event_ref=payment_session_id,
            meta={"admin_user_id": admin_user_id, "admin_username": admin_username},
            assume_balance_already_decremented_by=reclaim,
        )
        actual = sum(int(s.get("amount") or 0) for s in slices)
        reclaimed += actual
        remaining_to_reclaim -= actual
        owner_results.append({"user_id": uid, "reclaimed": actual, "eligible": eligible, "balance": bal})
    unrecoverable = max(0, requested - reclaimed)
    now_iso = _now_iso()
    await db.point_ledger_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "event_type": "clawback_summary",
            "user_id": admin_user_id,
            "points": -reclaimed,
            "lot_id": None,
            "origin_ref": payment_session_id,
            "root_purchase_ref": payment_session_id,
            "meta": {
                "admin_username": admin_username,
                "requested": requested,
                "reclaimed": reclaimed,
                "unrecoverable": unrecoverable,
                "owners": owner_results,
            },
            "created_at": now_iso,
        }
    )
    return {
        "requested": requested,
        "reclaimed": reclaimed,
        "unrecoverable": unrecoverable,
        "owners": owner_results,
    }
