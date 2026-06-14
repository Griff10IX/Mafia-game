"""Global sports betting book ownership (10% of weekly house profit when the book is net positive)."""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

SPORTS_BETTING_OWNERSHIP_ID = "main"
SPORTS_BETTING_CLAIM_COST_POINTS = 10_000
SPORTS_BETTING_OWNER_PROFIT_SHARE = 0.10
SPORTS_BETTING_STACK_CONFLICT_HOURS = 3


def sports_betting_week_key(dt: Optional[datetime] = None) -> str:
    """UTC ISO week key (Monday-based), e.g. 2026-W23."""
    dt = dt or datetime.now(timezone.utc)
    iso = dt.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def sports_betting_house_delta(*, won: bool, stake: int, payout: int) -> int:
    """House P/L for one settled bet: +stake on loss, stake - payout on win."""
    st = int(stake or 0)
    if not won:
        return st
    return st - int(payout or 0)


def sports_betting_owner_share_for_profit(house_profit: int) -> int:
    hp = int(house_profit or 0)
    if hp <= 0:
        return 0
    return int(hp * SPORTS_BETTING_OWNER_PROFIT_SHARE)


async def get_sports_betting_ownership(db) -> Dict[str, Any]:
    doc = await db.sports_betting_ownership.find_one({"id": SPORTS_BETTING_OWNERSHIP_ID}, {"_id": 0})
    if doc:
        return doc
    doc = {
        "id": SPORTS_BETTING_OWNERSHIP_ID,
        "owner_id": None,
        "owner_username": None,
        "owner_pending_profit": 0,
    }
    await db.sports_betting_ownership.insert_one(dict(doc))
    return doc


async def credit_sports_betting_profit(db, amount: int) -> None:
    amt = int(amount or 0)
    if amt <= 0:
        return
    await get_sports_betting_ownership(db)
    await db.sports_betting_ownership.update_one(
        {"id": SPORTS_BETTING_OWNERSHIP_ID},
        {"$inc": {"owner_pending_profit": amt}},
    )


async def debit_sports_betting_profit_clawback(db, amount: int) -> None:
    """Reduce pending profit when weekly house profit drops (floor at 0)."""
    amt = int(amount or 0)
    if amt <= 0:
        return
    doc = await db.sports_betting_ownership.find_one(
        {"id": SPORTS_BETTING_OWNERSHIP_ID},
        {"_id": 0, "owner_pending_profit": 1},
    )
    pending = int((doc or {}).get("owner_pending_profit") or 0)
    if pending <= 0:
        return
    debit = min(pending, amt)
    await db.sports_betting_ownership.update_one(
        {"id": SPORTS_BETTING_OWNERSHIP_ID, "owner_pending_profit": {"$gte": debit}},
        {"$inc": {"owner_pending_profit": -debit}},
    )


async def _sync_sports_betting_owner_week_share(db, week_key: str) -> None:
    ownership = await get_sports_betting_ownership(db)
    if not ownership.get("owner_id"):
        return
    week_doc = await db.sports_betting_weekly.find_one({"week_key": week_key}, {"_id": 0})
    if not week_doc:
        return
    house_profit = int(week_doc.get("house_profit") or 0)
    credited = int(week_doc.get("owner_share_credited") or 0)
    target = sports_betting_owner_share_for_profit(house_profit)
    delta = target - credited
    if delta == 0:
        return
    res = await db.sports_betting_weekly.update_one(
        {"week_key": week_key, "owner_share_credited": credited},
        {"$set": {"owner_share_credited": target}},
    )
    if res.modified_count == 0:
        return
    if delta > 0:
        await credit_sports_betting_profit(db, delta)
    else:
        await debit_sports_betting_profit_clawback(db, -delta)


async def record_sports_betting_house_settlement(db, house_delta: int) -> None:
    """Track weekly house P/L and credit owner 10% while the week is net positive."""
    delta = int(house_delta or 0)
    if delta == 0:
        return
    week_key = sports_betting_week_key()
    await db.sports_betting_weekly.update_one(
        {"week_key": week_key},
        {"$inc": {"house_profit": delta}, "$setOnInsert": {"owner_share_credited": 0}},
        upsert=True,
    )
    await _sync_sports_betting_owner_week_share(db, week_key)


async def user_owns_sports_betting_book(db, user_id: str) -> Optional[Dict[str, Any]]:
    uid = (user_id or "").strip()
    if not uid:
        return None
    doc = await db.sports_betting_ownership.find_one({"owner_id": uid}, {"_id": 0, "owner_pending_profit": 1})
    if not doc:
        return None
    return {
        "type": "sports_betting",
        "owner_pending_profit": int(doc.get("owner_pending_profit") or 0),
    }


async def cancel_sports_betting_quicktrade_listings(db) -> int:
    res = await db.properties.delete_many({"for_sale": True, "type": "sports_betting"})
    return int(res.deleted_count or 0)


def _parse_utc_datetime(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


async def maybe_auto_relinquish_sports_betting_stack_conflict(db) -> bool:
    from server import _user_owns_any_property

    doc = await db.sports_betting_ownership.find_one(
        {"id": SPORTS_BETTING_OWNERSHIP_ID},
        {"_id": 0, "owner_id": 1, "owner_username": 1, "stack_conflict_acquired_at": 1, "owner_pending_profit": 1},
    )
    if not doc or not doc.get("owner_id") or not doc.get("stack_conflict_acquired_at"):
        return False
    owner_id = doc.get("owner_id")
    if not await _user_owns_any_property(owner_id):
        await db.sports_betting_ownership.update_one(
            {"id": SPORTS_BETTING_OWNERSHIP_ID},
            {"$unset": {"stack_conflict_acquired_at": ""}},
        )
        return False
    acquired = _parse_utc_datetime(doc.get("stack_conflict_acquired_at"))
    if not acquired:
        return False
    if (datetime.now(timezone.utc) - acquired).total_seconds() < SPORTS_BETTING_STACK_CONFLICT_HOURS * 3600:
        return False
    pending = int(doc.get("owner_pending_profit") or 0)
    if pending > 0:
        await db.users.update_one({"id": owner_id}, {"$inc": {"money": pending}})
        try:
            from routers.money.bank import _invalidate_overview_cache

            _invalidate_overview_cache(owner_id)
        except Exception:
            pass
    await cancel_sports_betting_quicktrade_listings(db)
    await db.sports_betting_ownership.update_one(
        {"id": SPORTS_BETTING_OWNERSHIP_ID},
        {
            "$set": {
                "owner_id": None,
                "owner_username": None,
                "owner_pending_profit": 0,
            },
            "$unset": {"stack_conflict_acquired_at": "", "below_capo_acquired_at": ""},
        },
    )
    return True


def sports_betting_stack_conflict_status(ownership: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    acquired = _parse_utc_datetime((ownership or {}).get("stack_conflict_acquired_at"))
    if not acquired:
        return None
    deadline = acquired.timestamp() + SPORTS_BETTING_STACK_CONFLICT_HOURS * 3600
    remaining = max(0, int(deadline - datetime.now(timezone.utc).timestamp()))
    return {
        "hours_limit": SPORTS_BETTING_STACK_CONFLICT_HOURS,
        "deadline_iso": datetime.fromtimestamp(deadline, tz=timezone.utc).isoformat(),
        "seconds_remaining": remaining,
    }


async def get_sports_betting_weekly_stats(db, week_key: Optional[str] = None) -> Dict[str, Any]:
    wk = week_key or sports_betting_week_key()
    doc = await db.sports_betting_weekly.find_one({"week_key": wk}, {"_id": 0})
    house_profit = int((doc or {}).get("house_profit") or 0)
    owner_share = sports_betting_owner_share_for_profit(house_profit)
    return {
        "week_key": wk,
        "house_profit": house_profit,
        "owner_share": owner_share,
    }
