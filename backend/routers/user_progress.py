# User progress: rank progress, wealth ranks list, wealth progress
from fastapi import Depends

from server import get_current_user, get_rank_info, get_wealth_rank, RANKS, WEALTH_RANKS


async def get_rank_progress(current_user: dict = Depends(get_current_user)):
    current_rank_id, current_rank_name = get_rank_info(current_user.get("rank_points", 0))
    if current_rank_id >= 11:
        return {
            "current_rank": current_rank_id,
            "current_rank_name": current_rank_name,
            "next_rank": None,
            "next_rank_name": "Max Rank",
            "money_progress": 100,
            "rank_points_progress": 100,
            "money_needed": 0,
            "rank_points_needed": 0,
            "money_current": current_user["money"],
            "rank_points_current": current_user.get("rank_points", 0),
        }
    next_rank = RANKS[current_rank_id]
    current_rank_req = RANKS[current_rank_id - 1]
    rank_points_progress = 0
    if next_rank["required_points"] > current_rank_req["required_points"]:
        points_range = next_rank["required_points"] - current_rank_req["required_points"]
        points_current = current_user.get("rank_points", 0) - current_rank_req["required_points"]
        rank_points_progress = min(100, max(0, (points_current / points_range * 100)))
    return {
        "current_rank": current_rank_id,
        "current_rank_name": current_rank_name,
        "next_rank": next_rank["id"],
        "next_rank_name": next_rank["name"],
        "rank_points_progress": rank_points_progress,
        "rank_points_needed": max(0, next_rank["required_points"] - current_user.get("rank_points", 0)),
        "rank_points_current": current_user.get("rank_points", 0),
    }


async def get_wealth_ranks_list():
    """Return the full wealth rank ladder. No auth required."""
    return {"wealth_ranks": [{"id": r["id"], "name": r["name"], "min_money": r["min_money"]} for r in WEALTH_RANKS]}


async def get_wealth_progress(current_user: dict = Depends(get_current_user)):
    money = int(current_user.get("money", 0) or 0)
    wealth_id, wealth_name = get_wealth_rank(money)
    is_max = wealth_id >= WEALTH_RANKS[-1]["id"]
    if is_max:
        return {
            "wealth_rank": wealth_id,
            "wealth_rank_name": wealth_name,
            "money": money,
            "next_rank": None,
            "next_rank_name": None,
            "min_money_next": None,
            "money_needed": 0,
        }
    next_tier = next((r for r in WEALTH_RANKS if r["id"] == wealth_id + 1), None)
    if not next_tier:
        return {"wealth_rank": wealth_id, "wealth_rank_name": wealth_name, "money": money, "next_rank": None, "next_rank_name": None, "min_money_next": None, "money_needed": 0}
    min_next = next_tier["min_money"]
    return {
        "wealth_rank": wealth_id,
        "wealth_rank_name": wealth_name,
        "money": money,
        "next_rank": next_tier["id"],
        "next_rank_name": next_tier["name"],
        "min_money_next": min_next,
        "money_needed": max(0, min_next - money),
    }


def register(router):
    router.add_api_route("/user/rank-progress", get_rank_progress, methods=["GET"])
    router.add_api_route("/wealth-ranks", get_wealth_ranks_list, methods=["GET"])
    router.add_api_route("/user/wealth-progress", get_wealth_progress, methods=["GET"])
