# Strip user rows that feed /leaderboards/top weekly (and optional all-time event history).
from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, Optional

from utils.game_timezone import game_week_start_utc


def _week_start_dt() -> datetime:
    return game_week_start_utc(datetime.now(timezone.utc))


def _expr_time_gte(time_field: str, week_start: datetime) -> dict:
    return {"$gte": [{"$toDate": f"${time_field}"}, week_start]}


async def _aggregate_sum(db, collection: str, match: dict, field: str) -> int:
    coll = getattr(db, collection)
    pipe = [{"$match": match}, {"$group": {"_id": None, "t": {"$sum": {"$ifNull": [f"${field}", 0]}}}}]
    rows = await coll.aggregate(pipe).to_list(1)
    if not rows:
        return 0
    return int(rows[0].get("t") or 0)


async def strip_user_main_leaderboard_inputs(
    db,
    *,
    user_id: str,
    scope: str,
    respect_events: bool,
    melt_events: bool,
    stock_profit_rows: bool,
    booze_run_events: bool,
    kills: bool,
    crimes: bool,
    gta: bool,
    jail_busts: bool,
) -> Dict[str, object]:
    """
    scope: 'current' = Mon 00:00 UK week only (matches in-game weekly boards); 'all' = entire history for selected categories.
    stock_profit_rows: zeros profit_points on matching stock_transactions and adjusts users.stock_market_profit_total.
    booze_run_events: zeros profit on matching economy_events (type booze_run_sell) and adjusts users.booze_run_profit_total.
    """
    ws = (scope or "current").strip().lower()
    if ws not in ("current", "all"):
        raise ValueError("scope must be 'current' or 'all'")

    week_start: Optional[datetime] = _week_start_dt() if ws == "current" else None
    deleted: Dict[str, int] = {}
    adjusted: Dict[str, int] = {}

    async def del_time_or_all(coll_name: str, base: dict, time_field: str) -> int:
        coll = getattr(db, coll_name)
        if week_start is None:
            res = await coll.delete_many(base)
            return int(res.deleted_count or 0)
        m = {**base, "$expr": _expr_time_gte(time_field, week_start)}
        res = await coll.delete_many(m)
        return int(res.deleted_count or 0)

    if respect_events:
        n = await del_time_or_all("respect_events", {"user_id": user_id}, "at")
        deleted["respect_events"] = n

    if melt_events:
        n = await del_time_or_all("melt_events", {"user_id": user_id}, "at")
        deleted["melt_events"] = n

    if crimes:
        n = await del_time_or_all("crime_events", {"user_id": user_id}, "at")
        deleted["crime_events"] = n

    if gta:
        n = await del_time_or_all("gta_events", {"user_id": user_id}, "at")
        deleted["gta_events"] = n

    if jail_busts:
        n = await del_time_or_all("bust_events", {"user_id": user_id, "success": True}, "at")
        deleted["bust_events"] = n

    if kills:
        n = await del_time_or_all(
            "attack_attempts",
            {"attacker_id": user_id, "outcome": "killed"},
            "created_at",
        )
        deleted["attack_attempts_kills"] = n

    if stock_profit_rows:
        if week_start is None:
            match = {"user_id": user_id}
        else:
            match = {
                "user_id": user_id,
                "$expr": _expr_time_gte("created_at", week_start),
            }
        total_pts = await _aggregate_sum(db, "stock_transactions", match, "profit_points")
        if total_pts:
            res = await db.stock_transactions.update_many(match, {"$set": {"profit_points": 0}})
            adjusted["stock_transactions_zeroed"] = int(res.modified_count or 0)
            await db.users.update_one({"id": user_id}, {"$inc": {"stock_market_profit_total": -total_pts}})
            adjusted["stock_market_profit_total_delta"] = -total_pts
        else:
            adjusted["stock_transactions_zeroed"] = 0
            adjusted["stock_market_profit_total_delta"] = 0

    if booze_run_events:
        base = {"user_id": user_id, "type": "booze_run_sell"}
        if week_start is None:
            match = base
        else:
            match = {**base, "$expr": _expr_time_gte("at", week_start)}
        total_profit = await _aggregate_sum(db, "economy_events", match, "profit")
        if total_profit:
            res = await db.economy_events.update_many(match, {"$set": {"profit": 0}})
            adjusted["economy_events_booze_zeroed"] = int(res.modified_count or 0)
            await db.users.update_one({"id": user_id}, {"$inc": {"booze_run_profit_total": -total_profit}})
            adjusted["booze_run_profit_total_delta"] = -total_profit
        else:
            adjusted["economy_events_booze_zeroed"] = 0
            adjusted["booze_run_profit_total_delta"] = 0

    return {
        "scope": ws,
        "week_start_utc": week_start.isoformat().replace("+00:00", "Z") if week_start else None,
        "deleted_counts": deleted,
        "adjusted": adjusted,
    }
