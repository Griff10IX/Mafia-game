# Admin preview and partial adjust for main /leaderboards/top inputs (one user).
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from pymongo import ASCENDING

MAX_REMOVE_COUNT = 50_000


def _week_bounds(now: Optional[datetime] = None) -> Tuple[datetime, datetime]:
    """Monday 00:00 Europe/London through next Monday (UTC instants)."""
    from utils.game_timezone import game_week_range_utc

    n = now or datetime.now(timezone.utc)
    return game_week_range_utc(n)


async def _aggregate_count_week(
    db,
    *,
    collection: str,
    user_match: Dict[str, Any],
    time_field: str,
    week_start: datetime,
    week_end: datetime,
) -> int:
    coll = getattr(db, collection)
    pipeline: List[Dict[str, Any]] = [
        {"$match": user_match},
        {"$addFields": {"_lb_ts": {"$toDate": f"${time_field}"}}},
        {"$match": {"_lb_ts": {"$gte": week_start, "$lt": week_end}}},
        {"$count": "c"},
    ]
    rows = await coll.aggregate(pipeline).to_list(1)
    return int(rows[0]["c"]) if rows else 0


async def _aggregate_sum_week(
    db,
    *,
    collection: str,
    user_match: Dict[str, Any],
    time_field: str,
    value_field: str,
    week_start: datetime,
    week_end: datetime,
) -> int:
    coll = getattr(db, collection)
    pipeline = [
        {"$match": user_match},
        {"$addFields": {"_lb_ts": {"$toDate": f"${time_field}"}}},
        {"$match": {"_lb_ts": {"$gte": week_start, "$lt": week_end}}},
        {"$group": {"_id": None, "t": {"$sum": {"$ifNull": [f"${value_field}", 0]}}}},
    ]
    rows = await coll.aggregate(pipeline).to_list(1)
    return int(rows[0].get("t") or 0) if rows else 0


async def get_user_leaderboard_scores(db, *, user_id: str) -> Dict[str, Any]:
    week_start, week_end = _week_bounds()

    u = await db.users.find_one(
        {"id": user_id},
        {
            "_id": 0,
            "username": 1,
            "total_kills": 1,
            "total_crimes": 1,
            "total_gta": 1,
            "jail_busts": 1,
            "lifetime_points_spent": 1,
            "respect_points": 1,
            "bullets_melted": 1,
            "stock_market_profit_total": 1,
            "booze_run_profit_total": 1,
        },
    )
    uname = (u or {}).get("username") or "?"

    weekly = {
        "crimes": await _aggregate_count_week(
            db, collection="crime_events", user_match={"user_id": user_id}, time_field="at", week_start=week_start, week_end=week_end
        ),
        "gta": await _aggregate_count_week(
            db, collection="gta_events", user_match={"user_id": user_id}, time_field="at", week_start=week_start, week_end=week_end
        ),
        "jail_busts": await _aggregate_count_week(
            db,
            collection="bust_events",
            user_match={"user_id": user_id, "success": True},
            time_field="at",
            week_start=week_start,
            week_end=week_end,
        ),
        "kills": await _aggregate_count_week(
            db,
            collection="attack_attempts",
            user_match={"attacker_id": user_id, "outcome": "killed"},
            time_field="created_at",
            week_start=week_start,
            week_end=week_end,
        ),
        "stock_profit_points": await _aggregate_sum_week(
            db,
            collection="stock_transactions",
            user_match={"user_id": user_id},
            time_field="created_at",
            value_field="profit_points",
            week_start=week_start,
            week_end=week_end,
        ),
        "booze_profit": await _aggregate_sum_week(
            db,
            collection="economy_events",
            user_match={"user_id": user_id, "type": "booze_run_sell"},
            time_field="at",
            value_field="profit",
            week_start=week_start,
            week_end=week_end,
        ),
        "respect_earned": await _aggregate_sum_week(
            db,
            collection="respect_events",
            user_match={"user_id": user_id, "amount": {"$gt": 0}},
            time_field="at",
            value_field="amount",
            week_start=week_start,
            week_end=week_end,
        ),
        "melt_bullets": await _aggregate_sum_week(
            db,
            collection="melt_events",
            user_match={"user_id": user_id},
            time_field="at",
            value_field="bullets",
            week_start=week_start,
            week_end=week_end,
        ),
    }

    alltime = {
        "total_kills": int((u or {}).get("total_kills") or 0),
        "total_crimes": int((u or {}).get("total_crimes") or 0),
        "total_gta": int((u or {}).get("total_gta") or 0),
        "jail_busts": int((u or {}).get("jail_busts") or 0),
        "lifetime_points_spent": int((u or {}).get("lifetime_points_spent") or 0),
        "respect_points": int((u or {}).get("respect_points") or 0),
        "bullets_melted": int((u or {}).get("bullets_melted") or 0),
        "stock_market_profit_total": int((u or {}).get("stock_market_profit_total") or 0),
        "booze_run_profit_total": int((u or {}).get("booze_run_profit_total") or 0),
    }

    return {
        "username": uname,
        "user_id": user_id,
        "week_start_utc": week_start.isoformat().replace("+00:00", "Z"),
        "week_end_utc": week_end.isoformat().replace("+00:00", "Z"),
        "weekly": weekly,
        "alltime": alltime,
    }


def _week_match_for_user(user_id: str, time_field: str, week_start: datetime, week_end: datetime) -> Dict[str, Any]:
    return {
        "user_id": user_id,
        "$expr": {
            "$and": [
                {"$gte": [{"$toDate": f"${time_field}"}, week_start]},
                {"$lt": [{"$toDate": f"${time_field}"}, week_end]},
            ]
        },
    }


def _week_match_attacker(attacker_id: str, week_start: datetime, week_end: datetime) -> Dict[str, Any]:
    return {
        "attacker_id": attacker_id,
        "outcome": "killed",
        "$expr": {
            "$and": [
                {"$gte": [{"$toDate": "$created_at"}, week_start]},
                {"$lt": [{"$toDate": "$created_at"}, week_end]},
            ]
        },
    }


async def _fetch_oldest_ids(
    db,
    *,
    collection: str,
    match: Dict[str, Any],
    sort_field: str,
    limit: int,
    projection: Dict[str, Any],
) -> List[dict]:
    coll = getattr(db, collection)
    cursor = coll.find(match, projection).sort(sort_field, ASCENDING).limit(limit)
    return await cursor.to_list(limit)


async def adjust_user_leaderboard_metric(
    db,
    *,
    user_id: str,
    metric: str,
    period: str,
    remove_count: int,
    dry_run: bool,
) -> Dict[str, Any]:
    m = (metric or "").strip().lower()
    p = (period or "").strip().lower()
    if p not in ("weekly", "alltime"):
        raise ValueError("period must be 'weekly' or 'alltime'")
    if remove_count < 1:
        raise ValueError("remove_count must be at least 1")
    if remove_count > MAX_REMOVE_COUNT:
        raise ValueError(f"remove_count cannot exceed {MAX_REMOVE_COUNT:,}")

    week_start, week_end = _week_bounds()
    deleted_ids: List[Any] = []
    success_true_count = 0
    user_inc: Dict[str, int] = {}

    if m == "crimes":
        base = _week_match_for_user(user_id, "at", week_start, week_end) if p == "weekly" else {"user_id": user_id}
        docs = await _fetch_oldest_ids(
            db,
            collection="crime_events",
            match=base,
            sort_field="at",
            limit=remove_count,
            projection={"_id": 1, "success": 1},
        )
        success_true_count = sum(1 for d in docs if d.get("success") is True)
        deleted_ids = [d["_id"] for d in docs]
        if success_true_count:
            user_inc["total_crimes"] = -success_true_count

    elif m == "gta":
        base = _week_match_for_user(user_id, "at", week_start, week_end) if p == "weekly" else {"user_id": user_id}
        docs = await _fetch_oldest_ids(
            db,
            collection="gta_events",
            match=base,
            sort_field="at",
            limit=remove_count,
            projection={"_id": 1, "success": 1},
        )
        success_true_count = sum(1 for d in docs if d.get("success") is True)
        deleted_ids = [d["_id"] for d in docs]
        if success_true_count:
            user_inc["total_gta"] = -success_true_count

    elif m == "jail_busts":
        base: Dict[str, Any]
        if p == "weekly":
            base = {
                "user_id": user_id,
                "success": True,
                "$expr": {
                    "$and": [
                        {"$gte": [{"$toDate": "$at"}, week_start]},
                        {"$lt": [{"$toDate": "$at"}, week_end]},
                    ]
                },
            }
        else:
            base = {"user_id": user_id, "success": True}
        docs = await _fetch_oldest_ids(
            db,
            collection="bust_events",
            match=base,
            sort_field="at",
            limit=remove_count,
            projection={"_id": 1},
        )
        n = len(docs)
        deleted_ids = [d["_id"] for d in docs]
        if n:
            user_inc["jail_busts"] = -n

    elif m == "kills":
        base = _week_match_attacker(user_id, week_start, week_end) if p == "weekly" else {"attacker_id": user_id, "outcome": "killed"}
        docs = await _fetch_oldest_ids(
            db,
            collection="attack_attempts",
            match=base,
            sort_field="created_at",
            limit=remove_count,
            projection={"_id": 1},
        )
        n = len(docs)
        deleted_ids = [d["_id"] for d in docs]
        if n:
            user_inc["total_kills"] = -n

    else:
        raise ValueError(f"Unsupported metric '{metric}'. Use: crimes, gta, jail_busts, kills")

    result: Dict[str, Any] = {
        "metric": m,
        "period": p,
        "remove_count_requested": remove_count,
        "documents_matched": len(deleted_ids),
        "success_rows_count": success_true_count if m in ("crimes", "gta") else None,
        "user_counter_delta": user_inc,
        "dry_run": dry_run,
    }

    if dry_run:
        return result

    if not deleted_ids:
        result["deleted_count"] = 0
        return result

    coll_name = {
        "crimes": "crime_events",
        "gta": "gta_events",
        "jail_busts": "bust_events",
        "kills": "attack_attempts",
    }[m]
    res = await getattr(db, coll_name).delete_many({"_id": {"$in": deleted_ids}})
    result["deleted_count"] = int(res.deleted_count or 0)

    if user_inc:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, **{k: 1 for k in user_inc}})
        patch: Dict[str, Any] = {}
        for field, delta in user_inc.items():
            cur = int((u or {}).get(field) or 0)
            patch[field] = max(0, cur + delta)
        await db.users.update_one({"id": user_id}, {"$set": patch})

    return result
