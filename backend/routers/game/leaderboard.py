# Leaderboard endpoints: single leaderboard, top N per stat (alive or dead); weekly or all-time
import asyncio
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import List

from fastapi import Depends, Query
from pydantic import BaseModel

from server import ADMIN_EMAILS, db, get_current_user

_lb_cache: dict = {}
_LB_CACHE_TTL = 30

# Exclude admin accounts and moderators from leaderboards
def _leaderboard_user_filter() -> dict:
    q = {"is_moderator": {"$ne": True}}
    if ADMIN_EMAILS:
        q["email"] = {"$nin": list(ADMIN_EMAILS)}
    return q


def _week_start(dt: datetime) -> datetime:
    """Monday 00:00 UTC as start of week."""
    d = dt.date()
    days_since_monday = (d.weekday()) % 7
    start = d - timedelta(days=days_since_monday)
    return datetime(start.year, start.month, start.day, tzinfo=timezone.utc)


class LeaderboardEntry(BaseModel):
    rank: int
    username: str
    money: float
    kills: int
    crimes: int
    gta: int
    jail_busts: int
    is_current_user: bool = False


class StatLeaderboardEntry(BaseModel):
    rank: int
    username: str
    value: int
    is_current_user: bool = False


async def _top_by_field(field: str, current_user_id: str, limit: int, dead: bool = False) -> List[StatLeaderboardEntry]:
    limit = max(1, min(100, int(limit)))
    if dead:
        query = {"is_dead": True, "is_bodyguard": {"$ne": True}, "is_npc": {"$ne": True}}
    else:
        query = {"is_dead": {"$ne": True}, "is_bodyguard": {"$ne": True}, "is_npc": {"$ne": True}}
    query.update(_leaderboard_user_filter())
    users = await db.users.find(
        query,
        {"_id": 0, "username": 1, "id": 1, field: 1}
    ).sort(field, -1).limit(limit).to_list(limit)
    out: List[StatLeaderboardEntry] = []
    for i, user in enumerate(users):
        out.append(StatLeaderboardEntry(
            rank=i + 1,
            username=user["username"],
            value=int(user.get(field, 0) or 0),
            is_current_user=user["id"] == current_user_id
        ))
    return out


async def _top_by_field_weekly(
    collection: str,
    user_field: str,
    time_field: str,
    time_is_iso: bool,
    current_user_id: str,
    limit: int,
    dead: bool,
    extra_match: dict = None,
) -> List[StatLeaderboardEntry]:
    """Aggregate events in collection since week start, then filter by alive/dead and return top N.
    Normalizes time field to date so both BSON Date and ISO string storage work."""
    limit = max(1, min(100, int(limit)))
    now = datetime.now(timezone.utc)
    week_start = _week_start(now)
    match_stage = {"_lb_ts": {"$gte": week_start}}
    if extra_match:
        match_stage.update(extra_match)
    pipeline = [
        # Normalize time to date so both BSON Date and ISO string in DB compare correctly
        {"$addFields": {"_lb_ts": {"$toDate": f"${time_field}"}}},
        {"$match": match_stage},
        {"$group": {"_id": f"${user_field}", "value": {"$sum": 1}}},
        {"$sort": {"value": -1}},
        {"$limit": limit * 2},
    ]
    coll = getattr(db, collection)
    cursor = coll.aggregate(pipeline)
    docs = await cursor.to_list(limit * 2)
    if not docs:
        return []
    user_ids = [d["_id"] for d in docs if d.get("_id")]
    q = {"id": {"$in": user_ids}}
    q.update(_leaderboard_user_filter())
    users_map = await db.users.find(
        q,
        {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "is_bodyguard": 1, "is_npc": 1}
    ).to_list(len(user_ids) + 1)
    users_by_id = {u["id"]: u for u in users_map}
    filtered = []
    for d in docs:
        uid = d.get("_id")
        if not uid:
            continue
        u = users_by_id.get(uid)
        if not u:
            continue
        if bool(dead) != bool(u.get("is_dead")):
            continue
        if u.get("is_bodyguard") or u.get("is_npc"):
            continue
        filtered.append({"user_id": uid, "value": int(d.get("value") or 0), "username": u["username"]})
    filtered = filtered[:limit]
    return [
        StatLeaderboardEntry(
            rank=i + 1,
            username=e["username"],
            value=e["value"],
            is_current_user=e["user_id"] == current_user_id,
        )
        for i, e in enumerate(filtered)
    ]


async def _top_by_field_weekly_sum(
    collection: str,
    user_field: str,
    time_field: str,
    value_field: str,
    current_user_id: str,
    limit: int,
    dead: bool,
    extra_match: dict = None,
) -> List[StatLeaderboardEntry]:
    """Aggregate events since week start, sum value_field per user (e.g. profit_points), return top N.
    Used for weekly stock market profit and booze run profit."""
    limit = max(1, min(100, int(limit)))
    now = datetime.now(timezone.utc)
    week_start = _week_start(now)
    match_stage = {"_lb_ts": {"$gte": week_start}}
    if extra_match:
        match_stage.update(extra_match)
    pipeline = [
        {"$addFields": {"_lb_ts": {"$toDate": f"${time_field}"}}},
        {"$match": match_stage},
        {"$group": {"_id": f"${user_field}", "value": {"$sum": {"$ifNull": [f"${value_field}", 0]}}}},
        {"$sort": {"value": -1}},
        {"$limit": limit * 2},
    ]
    coll = getattr(db, collection)
    cursor = coll.aggregate(pipeline)
    docs = await cursor.to_list(limit * 2)
    if not docs:
        return []
    user_ids = [d["_id"] for d in docs if d.get("_id")]
    q = {"id": {"$in": user_ids}}
    q.update(_leaderboard_user_filter())
    users_map = await db.users.find(
        q,
        {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "is_bodyguard": 1, "is_npc": 1}
    ).to_list(len(user_ids) + 1)
    users_by_id = {u["id"]: u for u in users_map}
    filtered = []
    for d in docs:
        uid = d.get("_id")
        if not uid:
            continue
        u = users_by_id.get(uid)
        if not u:
            continue
        if bool(dead) != bool(u.get("is_dead")):
            continue
        if u.get("is_bodyguard") or u.get("is_npc"):
            continue
        filtered.append({"user_id": uid, "value": int(d.get("value") or 0), "username": u["username"]})
    filtered = filtered[:limit]
    return [
        StatLeaderboardEntry(
            rank=i + 1,
            username=e["username"],
            value=e["value"],
            is_current_user=e["user_id"] == current_user_id,
        )
        for i, e in enumerate(filtered)
    ]


async def _top_by_field_for_week(
    database,
    collection: str,
    user_field: str,
    time_field: str,
    time_is_iso: bool,
    week_start_dt: datetime,
    week_end_dt: datetime,
    limit: int,
    extra_match: dict = None,
) -> List[dict]:
    """Aggregate events in collection between week_start_dt and week_end_dt; return top N as [{user_id, value, rank}] for alive non-bodyguard non-npc users.
    Uses $toDate on time field so both BSON Date and ISO string storage work."""
    limit = max(1, min(100, int(limit)))
    match_stage = {
        "_lb_ts": {"$gte": week_start_dt, "$lt": week_end_dt},
    }
    if extra_match:
        match_stage.update(extra_match)
    pipeline = [
        {"$addFields": {"_lb_ts": {"$toDate": f"${time_field}"}}},
        {"$match": match_stage},
        {"$group": {"_id": f"${user_field}", "value": {"$sum": 1}}},
        {"$sort": {"value": -1}},
        {"$limit": limit * 2},
    ]
    coll = getattr(database, collection)
    cursor = coll.aggregate(pipeline)
    docs = await cursor.to_list(limit * 2)
    if not docs:
        return []
    user_ids = [d["_id"] for d in docs if d.get("_id")]
    q = {"id": {"$in": user_ids}}
    q.update(_leaderboard_user_filter())
    users_map = await database.users.find(
        q,
        {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "is_bodyguard": 1, "is_npc": 1},
    ).to_list(len(user_ids) + 1)
    users_by_id = {u["id"]: u for u in users_map}
    filtered = []
    for d in docs:
        uid = d.get("_id")
        if not uid:
            continue
        u = users_by_id.get(uid)
        if not u:
            continue
        if u.get("is_dead"):
            continue
        if u.get("is_bodyguard") or u.get("is_npc"):
            continue
        filtered.append({"user_id": uid, "value": int(d.get("value") or 0)})
    filtered = filtered[:limit]
    return [{"user_id": e["user_id"], "value": e["value"], "rank": i + 1} for i, e in enumerate(filtered)]


LEADERBOARD_PAYOUT_CONFIG_ID = "leaderboard_weekly_payout"
# Weekly rewards are respect points (tripled from original points: 1000→3000, 500→1500, 250→750, 500→1500)
DEFAULT_TOP1_POINTS = 3000
DEFAULT_TOP2_POINTS = 1500
DEFAULT_TOP3_POINTS = 750
DEFAULT_TOP4_10_POINTS = 1500


async def run_weekly_leaderboard_payout(database, test_run: bool = False):
    """
    Run weekly leaderboard payout for the previous week (Monday 00:00 UTC to next Monday 00:00 UTC).
    Uses game_config id leaderboard_weekly_payout with last_run_week_start (YYYY-MM-DD) for idempotency.
    Rewards are read from game_config: top1_points, top2_points, top3_points, top4_10_points (defaults 3000, 1500, 750, 1500).
    Pays respect_points to top 10 per category (kills, crimes, gta, jail_busts) from database event collections.
    """
    log = logging.getLogger(__name__)
    now = datetime.now(timezone.utc)
    this_week_start = _week_start(now)
    last_week_start = this_week_start - timedelta(days=7)
    last_week_start_str = last_week_start.strftime("%Y-%m-%d")

    cfg = await database.game_config.find_one(
        {"id": LEADERBOARD_PAYOUT_CONFIG_ID},
        {"_id": 0, "last_run_week_start": 1, "top1_points": 1, "top2_points": 1, "top3_points": 1, "top4_10_points": 1},
    )
    if cfg and cfg.get("last_run_week_start") == last_week_start_str and not test_run:
        return

    top1 = int(cfg.get("top1_points") or DEFAULT_TOP1_POINTS) if cfg else DEFAULT_TOP1_POINTS
    top2 = int(cfg.get("top2_points") or DEFAULT_TOP2_POINTS) if cfg else DEFAULT_TOP2_POINTS
    top3 = int(cfg.get("top3_points") or DEFAULT_TOP3_POINTS) if cfg else DEFAULT_TOP3_POINTS
    top4_10 = int(cfg.get("top4_10_points") or DEFAULT_TOP4_10_POINTS) if cfg else DEFAULT_TOP4_10_POINTS

    def points_for_rank(rank: int) -> int:
        if rank == 1:
            return top1
        if rank == 2:
            return top2
        if rank == 3:
            return top3
        if 4 <= rank <= 10:
            return top4_10
        return 0

    if not test_run:
        claim_filter = {
            "id": LEADERBOARD_PAYOUT_CONFIG_ID,
            "$or": [
                {"last_run_week_start": {"$ne": last_week_start_str}},
                {"last_run_week_start": {"$exists": False}},
            ],
        }
        claim_result = await database.game_config.update_one(
            claim_filter,
            {"$set": {"last_run_week_start": last_week_start_str}},
            upsert=True,
        )
        if claim_result.modified_count == 0 and claim_result.upserted_id is None:
            return

    kills, crimes, gta, jail_busts = await asyncio.gather(
        _top_by_field_for_week(
            database, "attack_attempts", "attacker_id", "created_at", True,
            last_week_start, this_week_start, 10, {"outcome": "killed"},
        ),
        _top_by_field_for_week(
            database, "crime_events", "user_id", "at", False,
            last_week_start, this_week_start, 10, None,
        ),
        _top_by_field_for_week(
            database, "gta_events", "user_id", "at", False,
            last_week_start, this_week_start, 10, None,
        ),
        _top_by_field_for_week(
            database, "bust_events", "user_id", "at", False,
            last_week_start, this_week_start, 10, {"success": True},
        ),
    )

    user_points: dict = {}
    for entry in kills + crimes + gta + jail_busts:
        uid = entry.get("user_id")
        rank = entry.get("rank", 0)
        if not uid:
            continue
        user_points[uid] = user_points.get(uid, 0) + points_for_rank(rank)

    if test_run:
        log.info(
            "Weekly leaderboard payout (test_run): week %s would pay %d users total %d respect_points",
            last_week_start_str, len(user_points), sum(user_points.values()),
        )
        return

    for user_id, points in user_points.items():
        if points <= 0:
            continue
        await database.users.update_one({"id": user_id}, {"$inc": {"points": points}})

    if user_points:
        log.info(
            "Weekly leaderboard payout: week %s paid %d users total %d points",
            last_week_start_str, len(user_points), sum(user_points.values()),
        )


async def get_leaderboard(current_user: dict = Depends(get_current_user)):
    """Single leaderboard: top 10 by money (alive, non-bodyguard, non-npc)."""
    query = {"is_dead": {"$ne": True}, "is_bodyguard": {"$ne": True}, "is_npc": {"$ne": True}}
    query.update(_leaderboard_user_filter())
    users = await db.users.find(
        query,
        {"_id": 0, "username": 1, "money": 1, "total_kills": 1, "total_crimes": 1, "total_gta": 1, "jail_busts": 1, "id": 1}
    ).sort("money", -1).limit(10).to_list(10)
    result = []
    for i, user in enumerate(users):
        result.append(LeaderboardEntry(
            rank=i + 1,
            username=user["username"],
            money=user["money"],
            kills=user["total_kills"],
            crimes=user.get("total_crimes", 0),
            gta=user.get("total_gta", 0),
            jail_busts=user.get("jail_busts", 0),
            is_current_user=user["id"] == current_user["id"]
        ))
    return result


def _stamp_current_user(boards_raw: dict, username: str) -> dict:
    """Re-stamp is_current_user on cached board dicts for the requesting user."""
    out = {}
    for key, entries in boards_raw.items():
        if not entries:
            out[key] = entries
            continue
        out[key] = [
            {"rank": e["rank"], "username": e["username"], "value": e["value"],
             "is_current_user": e.get("_uid") == username}
            for e in entries
        ]
    return out


async def _fetch_top_boards_raw(limit: int, dead: bool, period: str) -> dict:
    """Run all DB aggregations, return dicts with _uid so is_current_user can be stamped per request."""
    dummy_uid = "__cache__"
    if (period or "").lower() == "weekly":
        kills, crimes, gta, jail_busts, stock_market_profit, booze_run_profit, respect_points, bullets_melted = await asyncio.gather(
            _top_by_field_weekly("attack_attempts", "attacker_id", "created_at", True, dummy_uid, limit, dead, {"outcome": "killed"}),
            _top_by_field_weekly("crime_events", "user_id", "at", False, dummy_uid, limit, dead),
            _top_by_field_weekly("gta_events", "user_id", "at", False, dummy_uid, limit, dead),
            _top_by_field_weekly("bust_events", "user_id", "at", False, dummy_uid, limit, dead, {"success": True}),
            _top_by_field_weekly_sum("stock_transactions", "user_id", "created_at", "profit_points", dummy_uid, limit, dead),
            _top_by_field_weekly_sum("economy_events", "user_id", "at", "profit", dummy_uid, limit, dead, {"type": "booze_run_sell"}),
            _top_by_field_weekly_sum("respect_events", "user_id", "at", "amount", dummy_uid, limit, dead),
            _top_by_field_weekly_sum("melt_events", "user_id", "at", "bullets", dummy_uid, limit, dead),
        )
    else:
        kills, crimes, gta, jail_busts, points_spent, respect_points, bullets_melted, stock_market_profit, booze_run_profit = await asyncio.gather(
            _top_by_field("total_kills", dummy_uid, limit, dead=dead),
            _top_by_field("total_crimes", dummy_uid, limit, dead=dead),
            _top_by_field("total_gta", dummy_uid, limit, dead=dead),
            _top_by_field("jail_busts", dummy_uid, limit, dead=dead),
            _top_by_field("lifetime_points_spent", dummy_uid, limit, dead=dead),
            _top_by_field("respect_points", dummy_uid, limit, dead=dead),
            _top_by_field("bullets_melted", dummy_uid, limit, dead=dead),
            _top_by_field("stock_market_profit_total", dummy_uid, limit, dead=dead),
            _top_by_field("booze_run_profit_total", dummy_uid, limit, dead=dead),
        )

    def _to_raw(entries):
        return [{"rank": e.rank, "username": e.username, "value": e.value, "_uid": e.username} for e in entries]

    result = {"kills": _to_raw(kills), "crimes": _to_raw(crimes), "gta": _to_raw(gta), "jail_busts": _to_raw(jail_busts)}
    if (period or "").lower() != "weekly":
        result["points_spent"] = _to_raw(points_spent)
    else:
        result["points_spent"] = []
    result["respect_points"] = _to_raw(respect_points)
    result["bullets_melted"] = _to_raw(bullets_melted)
    result["stock_market_profit"] = _to_raw(stock_market_profit)
    result["booze_run_profit"] = _to_raw(booze_run_profit)
    return result


async def get_top_leaderboards(
    limit: int = Query(10, ge=1, le=100, description="Top N (5, 10, 20, 50, 100)"),
    dead: bool = Query(False, description="If true, show top dead accounts instead of alive"),
    period: str = Query("alltime", description="weekly = this week (Mon UTC), alltime = lifetime stats"),
    current_user: dict = Depends(get_current_user),
):
    """Top N leaderboards per stat. Results are cached for 30s to keep background refreshes fast."""
    username = current_user.get("username") or ""
    cache_key = f"{limit}:{dead}:{(period or 'alltime').lower()}"
    now = time.monotonic()
    cached = _lb_cache.get(cache_key)
    if cached and (now - cached["ts"]) < _LB_CACHE_TTL:
        return _stamp_current_user(cached["data"], username)

    boards_raw = await _fetch_top_boards_raw(limit, dead, period)
    _lb_cache[cache_key] = {"ts": now, "data": boards_raw}
    return _stamp_current_user(boards_raw, username)


def register(router):
    router.add_api_route("/leaderboard", get_leaderboard, methods=["GET"], response_model=List[LeaderboardEntry])
    router.add_api_route("/leaderboards/top", get_top_leaderboards, methods=["GET"])
