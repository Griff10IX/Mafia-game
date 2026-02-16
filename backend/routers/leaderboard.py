# Leaderboard endpoints: single leaderboard, top N per stat (alive or dead)
import asyncio
from typing import List
from pydantic import BaseModel

from fastapi import Depends, Query

from server import db, get_current_user


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
    current_user: dict = Depends(get_current_user),
):
    """Top N leaderboards per stat (kills, crimes, gta, jail busts). Limit 1-100. Use dead=true for top dead accounts."""
    user_id = current_user["id"]
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
