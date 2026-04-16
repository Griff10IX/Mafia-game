# User progress: rank progress, wealth ranks list, wealth progress
from fastapi import Depends

from server import (
    db,
    get_current_user,
    get_rank_info,
    get_wealth_rank,
    RANKS,
    WEALTH_RANKS,
    get_prestige_requirement,
    GODFATHER_RANK_ID,
)
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_RANKING


async def _ranking_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_RANKING)


_ranking_rl_u = [Depends(_ranking_sustained_rl_user)]


async def get_rank_progress(current_user: dict = Depends(get_current_user)):
    raw_points = int(current_user.get("rank_points", 0) or 0)
    prestige_level = int(current_user.get("prestige_level") or 0)
    mult = float(current_user.get("prestige_rank_multiplier") or 1.0)

    effective_points = raw_points

    current_rank_id, current_rank_name = get_rank_info(raw_points, mult)

    if current_rank_id >= GODFATHER_RANK_ID:
        # At Godfather — show progress toward next prestige requirement so bar matches prestige %
        next_req = get_prestige_requirement(prestige_level) if prestige_level < 5 else 0
        if next_req:
            godfather_req = next_req
            progress = min(100, (effective_points / godfather_req) * 100) if godfather_req > 0 else 100
            needed = max(0, godfather_req - effective_points)
            return {
                "current_rank": current_rank_id,
                "current_rank_name": current_rank_name,
                "next_rank": None,
                "next_rank_name": "Max Rank",
                "money_progress": 100,
                "rank_points_progress": progress,
                "money_needed": 0,
                "rank_points_needed": needed,
                "money_current": current_user["money"],
                "rank_points_current": effective_points,
            }
        progress = 100
        return {
            "current_rank": current_rank_id,
            "current_rank_name": current_rank_name,
            "next_rank": None,
            "next_rank_name": "Max Rank",
            "money_progress": 100,
            "rank_points_progress": progress,
            "money_needed": 0,
            "rank_points_needed": 0,
            "money_current": current_user["money"],
            "rank_points_current": raw_points,
            "progress_kind": "max",
        }

    next_rank = RANKS[current_rank_id]
    current_rank_req = RANKS[current_rank_id - 1]

    tier_floor = int(current_rank_req["required_points"] * mult)
    tier_ceiling = int(next_rank["required_points"] * mult)

    rank_points_progress = 0
    if tier_ceiling > tier_floor:
        points_range = tier_ceiling - tier_floor
        points_current = raw_points - tier_floor
        rank_points_progress = min(100, max(0, (points_current / points_range * 100)))

    return {
        "current_rank": current_rank_id,
        "current_rank_name": current_rank_name,
        "next_rank": next_rank["id"],
        "next_rank_name": next_rank["name"],
        "rank_points_progress": rank_points_progress,
        "rank_points_needed": max(0, tier_ceiling - raw_points),
        "rank_points_current": raw_points,
        "progress_kind": "street",
    }


async def get_wealth_ranks_list():
    """Return the full wealth rank ladder. No auth required."""
    return {
        "wealth_ranks": [
            {"id": r["id"], "name": r["name"], "min_money": r["min_money"], "color": r.get("color", "#64748b")}
            for r in WEALTH_RANKS
        ]
    }


async def get_wealth_progress(current_user: dict = Depends(get_current_user)):
    money = int(current_user.get("money", 0) or 0)
    wealth_id, wealth_name, wealth_color = get_wealth_rank(money)
    is_max = wealth_id >= WEALTH_RANKS[-1]["id"]
    if is_max:
        return {
            "wealth_rank": wealth_id,
            "wealth_rank_name": wealth_name,
            "wealth_rank_color": wealth_color,
            "money": money,
            "next_rank": None,
            "next_rank_name": None,
            "min_money_next": None,
            "money_needed": 0,
        }
    next_tier = next((r for r in WEALTH_RANKS if r["id"] == wealth_id + 1), None)
    if not next_tier:
        return {
            "wealth_rank": wealth_id,
            "wealth_rank_name": wealth_name,
            "wealth_rank_color": wealth_color,
            "money": money,
            "next_rank": None,
            "next_rank_name": None,
            "min_money_next": None,
            "money_needed": 0,
        }
    min_next = next_tier["min_money"]
    return {
        "wealth_rank": wealth_id,
        "wealth_rank_name": wealth_name,
        "wealth_rank_color": wealth_color,
        "money": money,
        "next_rank": next_tier["id"],
        "next_rank_name": next_tier["name"],
        "min_money_next": min_next,
        "money_needed": max(0, min_next - money),
    }


def register(router):
    router.add_api_route(
        "/user/rank-progress",
        get_rank_progress,
        methods=["GET"],
        dependencies=_ranking_rl_u,
    )
    router.add_api_route("/wealth-ranks", get_wealth_ranks_list, methods=["GET"])
    router.add_api_route("/user/wealth-progress", get_wealth_progress, methods=["GET"])
