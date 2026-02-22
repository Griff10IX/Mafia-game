# Leaderboard endpoints: single leaderboard, top N per stat (alive or dead); weekly or all-time
import asyncio
from datetime import datetime, timezone, timedelta
from typing import List
from pydantic import BaseModel

from fastapi import Depends, Query

from server import db, get_current_user


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
    """Aggregate events in collection since week start, then filter by alive/dead and return top N."""
    limit = max(1, min(100, int(limit)))
    now = datetime.now(timezone.utc)
    week_start = _week_start(now)
    week_start_iso = week_start.isoformat()
    match_time = {"$gte": week_start_iso} if time_is_iso else {"$gte": week_start}
    match_stage = {time_field: match_time}
    if extra_match:
        match_stage.update(extra_match)
    pipeline = [
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
    users_map = await db.users.find(
        {"id": {"$in": user_ids}},
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


async def get_leaderboard(current_user: dict = Depends(get_current_user)):
    users = await db.users.find(
        {"is_dead": {"$ne": True}, "is_bodyguard": {"$ne": True}, "is_npc": {"$ne": True}},
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


async def get_top_leaderboards(
    limit: int = Query(10, ge=1, le=100, description="Top N (5, 10, 20, 50, 100)"),
    dead: bool = Query(False, description="If true, show top dead accounts instead of alive"),
    period: str = Query("alltime", description="weekly = this week (Mon UTC), alltime = lifetime stats"),
    current_user: dict = Depends(get_current_user),
):
    """Top N leaderboards per stat (kills, crimes, gta, jail busts). period=weekly or alltime. dead=true for top dead."""
    user_id = current_user["id"]
    if (period or "").lower() == "weekly":
        kills, crimes, gta, jail_busts = await asyncio.gather(
            _top_by_field_weekly("attack_attempts", "attacker_id", "created_at", True, user_id, limit, dead, {"outcome": "killed"}),
            _top_by_field_weekly("crime_events", "user_id", "at", False, user_id, limit, dead),
            _top_by_field_weekly("gta_events", "user_id", "at", False, user_id, limit, dead),
            _top_by_field_weekly("bust_events", "user_id", "at", False, user_id, limit, dead),
        )
    else:
        kills, crimes, gta, jail_busts = await asyncio.gather(
            _top_by_field("total_kills", user_id, limit, dead=dead),
            _top_by_field("total_crimes", user_id, limit, dead=dead),
            _top_by_field("total_gta", user_id, limit, dead=dead),
            _top_by_field("jail_busts", user_id, limit, dead=dead),
        )
    return {"kills": kills, "crimes": crimes, "gta": gta, "jail_busts": jail_busts}


def register(router):
    router.add_api_route("/leaderboard", get_leaderboard, methods=["GET"], response_model=List[LeaderboardEntry])
    router.add_api_route("/leaderboards/top", get_top_leaderboards, methods=["GET"])
