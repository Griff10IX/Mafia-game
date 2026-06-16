"""Global sports betting book ownership (10% of weekly house profit when the book is net positive)."""
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

SPORTS_BETTING_OWNERSHIP_ID = "main"
SPORTS_BETTING_CLAIM_COST_POINTS = 10_000
from utils.global_property_owner_shares import (  # noqa: E402
    DEFAULT_GLOBAL_PROPERTY_OWNER_SHARES,
    sports_betting_owner_share_for_profit,
)

SPORTS_BETTING_OWNER_PROFIT_SHARE = (
    DEFAULT_GLOBAL_PROPERTY_OWNER_SHARES["sports_betting_owner_profit_share_pct"] / 100.0
)
SPORTS_BETTING_STACK_CONFLICT_HOURS = 3
SPORTS_BETTING_COLLECT_HOUR_UTC = 22  # 10 PM UTC every Sunday


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


async def aggregate_sports_house_profit_since(
    db,
    cutoff: datetime,
    *,
    staff_user_ids: Optional[List[str]] = None,
) -> Dict[str, int]:
    """Settled sports book house P/L since cutoff (excludes staff bets). Uses DB aggregation."""
    cutoff_dt = cutoff if cutoff.tzinfo else cutoff.replace(tzinfo=timezone.utc)
    try:
        return await _aggregate_sports_house_profit_since(db, cutoff_dt, staff_user_ids=staff_user_ids)
    except Exception:
        logging.exception("aggregate_sports_house_profit_since aggregation failed; using cursor fallback")
        return await _fallback_sports_house_profit_since(db, cutoff_dt, staff_user_ids=staff_user_ids)


async def _aggregate_sports_house_profit_since(
    db,
    cutoff: datetime,
    *,
    staff_user_ids: Optional[List[str]] = None,
) -> Dict[str, int]:
    match: Dict[str, Any] = {"status": {"$in": ["won", "lost"]}}
    if staff_user_ids:
        match["user_id"] = {"$nin": list(staff_user_ids)}
    pipeline = [
        {"$match": match},
        {"$addFields": {"_settled": {"$ifNull": ["$settled_at", "$created_at"]}}},
        {
            "$match": {
                "$expr": {
                    "$and": [
                        {"$ne": ["$_settled", None]},
                        {
                            "$gte": [
                                {
                                    "$convert": {
                                        "input": "$_settled",
                                        "to": "date",
                                        "onError": None,
                                        "onNull": None,
                                    }
                                },
                                cutoff,
                            ]
                        },
                    ]
                }
            }
        },
        {
            "$group": {
                "_id": None,
                "settled_bets_count": {"$sum": 1},
                "house_profit": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$status", "lost"]},
                            {"$ifNull": ["$stake", 0]},
                            {
                                "$subtract": [
                                    {"$ifNull": ["$stake", 0]},
                                    {
                                        "$multiply": [
                                            {"$ifNull": ["$stake", 0]},
                                            {"$ifNull": ["$odds", 1]},
                                        ]
                                    },
                                ]
                            },
                        ]
                    }
                },
            }
        },
    ]
    rows = await db.sports_bets.aggregate(pipeline).to_list(1)
    if not rows:
        return {"settled_bets_count": 0, "house_profit": 0}
    row = rows[0]
    return {
        "settled_bets_count": int(row.get("settled_bets_count") or 0),
        "house_profit": int(row.get("house_profit") or 0),
    }


async def _fallback_sports_house_profit_since(
    db,
    cutoff: datetime,
    *,
    staff_user_ids: Optional[List[str]] = None,
) -> Dict[str, int]:
    from routers.casinos.sports_betting import _sports_bet_datetime

    match: Dict[str, Any] = {"status": {"$in": ["won", "lost"]}}
    if staff_user_ids:
        match["user_id"] = {"$nin": list(staff_user_ids)}
    period_house = 0
    period_settled = 0
    cursor = db.sports_bets.find(
        match,
        {"_id": 0, "status": 1, "stake": 1, "odds": 1, "settled_at": 1, "created_at": 1},
    )
    async for bet in cursor:
        settled_at = _sports_bet_datetime(bet.get("settled_at")) or _sports_bet_datetime(bet.get("created_at"))
        if settled_at is None or settled_at < cutoff:
            continue
        period_settled += 1
        stake = int(bet.get("stake") or 0)
        try:
            odds = float(bet.get("odds") or 1)
        except (TypeError, ValueError):
            odds = 1.0
        won = (bet.get("status") or "") == "won"
        payout = int(stake * odds) if won else 0
        period_house += sports_betting_house_delta(won=won, stake=stake, payout=payout)
    return {"settled_bets_count": period_settled, "house_profit": period_house}


def _sunday_date_for(dt: datetime) -> datetime.date:
    days_since_sunday = (dt.weekday() + 1) % 7
    return (dt - timedelta(days=days_since_sunday)).date()


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


def sports_betting_collect_window_start(now: Optional[datetime] = None) -> datetime:
    """Most recent Sunday 10:00 PM UTC at or before now (start of the current collect period)."""
    now = now or datetime.now(timezone.utc)
    sunday = _sunday_date_for(now)
    window_start = datetime(
        sunday.year,
        sunday.month,
        sunday.day,
        SPORTS_BETTING_COLLECT_HOUR_UTC,
        0,
        0,
        tzinfo=timezone.utc,
    )
    if now < window_start:
        window_start -= timedelta(days=7)
    return window_start


def sports_betting_next_collect_opens_at(now: Optional[datetime] = None) -> datetime:
    """Next Sunday 10:00 PM UTC when collection opens."""
    now = now or datetime.now(timezone.utc)
    sunday = _sunday_date_for(now)
    this_sunday = datetime(
        sunday.year,
        sunday.month,
        sunday.day,
        SPORTS_BETTING_COLLECT_HOUR_UTC,
        0,
        0,
        tzinfo=timezone.utc,
    )
    if now < this_sunday:
        return this_sunday
    return this_sunday + timedelta(days=7)


def sports_betting_collect_availability(ownership: Dict[str, Any], now: Optional[datetime] = None) -> Dict[str, Any]:
    """Whether the owner may collect pending profit (once per week after Sunday 10 PM UTC)."""
    now = now or datetime.now(timezone.utc)
    window_start = sports_betting_collect_window_start(now)
    next_opens = sports_betting_next_collect_opens_at(now)
    pending = int((ownership or {}).get("owner_pending_profit") or 0)
    last_collected = _parse_utc_datetime((ownership or {}).get("last_collected_at"))
    in_window = now >= window_start
    already_collected = bool(last_collected and last_collected >= window_start)
    can_collect = in_window and not already_collected and pending > 0

    if not in_window:
        blocked_reason = "Collection opens Sunday 10:00 PM UTC."
    elif already_collected:
        blocked_reason = "Already collected this week. Next collection Sunday 10:00 PM UTC."
    elif pending <= 0:
        blocked_reason = "No profit to collect yet."
    else:
        blocked_reason = None

    waiting_for_window = not in_window or already_collected
    return {
        "can_collect": can_collect,
        "collect_blocked_reason": blocked_reason,
        "collect_window_open": in_window and not already_collected,
        "next_collect_opens_at": next_opens.isoformat(),
        "seconds_until_collect_opens": max(0, int((next_opens - now).total_seconds())) if waiting_for_window else 0,
        "last_collected_at": last_collected.isoformat() if last_collected else None,
    }


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
    from utils.global_property_owner_shares import load_global_property_owner_shares

    ownership = await get_sports_betting_ownership(db)
    if not ownership.get("owner_id"):
        return
    shares = await load_global_property_owner_shares(db)
    week_doc = await db.sports_betting_weekly.find_one({"week_key": week_key}, {"_id": 0})
    if not week_doc:
        return
    house_profit = int(week_doc.get("house_profit") or 0)
    credited = int(week_doc.get("owner_share_credited") or 0)
    target = sports_betting_owner_share_for_profit(house_profit, shares)
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
    from utils.global_property_owner_shares import load_global_property_owner_shares

    wk = week_key or sports_betting_week_key()
    doc = await db.sports_betting_weekly.find_one({"week_key": wk}, {"_id": 0})
    house_profit = int((doc or {}).get("house_profit") or 0)
    shares = await load_global_property_owner_shares(db)
    owner_share = sports_betting_owner_share_for_profit(house_profit, shares)
    return {
        "week_key": wk,
        "house_profit": house_profit,
        "owner_share": owner_share,
    }
