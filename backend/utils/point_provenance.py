import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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
    return inserted


async def mint_store_points_cash_lot_if_missing(
    db,
    *,
    user_id: str,
    purchase_id: str,
    points: int,
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
    return out


async def mint_transfer_in_lots(
    db,
    *,
    to_user_id: str,
    transfer_id: str,
    from_user_id: str,
    slices: List[Dict],
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
