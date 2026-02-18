# User progress: rank progress, wealth ranks list, wealth progress
from fastapi import Depends

from server import get_current_user, get_rank_info, get_wealth_rank, RANKS, WEALTH_RANKS, PRESTIGE_CONFIGS


async def get_rank_progress(current_user: dict = Depends(get_current_user)):
    raw_points = int(current_user.get("rank_points", 0) or 0)
    prestige_mult = float(current_user.get("prestige_rank_multiplier") or 1.0)
    prestige_level = int(current_user.get("prestige_level") or 0)

    # Effective rank points account for prestige multiplier (higher prestige = need more points per rank)
    effective_points = int(raw_points / prestige_mult) if prestige_mult > 1.0 else raw_points

    current_rank_id, current_rank_name = get_rank_info(raw_points, prestige_mult)

    if current_rank_id >= 11:
        # At Godfather — show progress toward next prestige requirement so bar matches prestige %
        next_prestige_cfg = PRESTIGE_CONFIGS.get(prestige_level + 1) if prestige_level < 5 else None
        if next_prestige_cfg:
            godfather_req = next_prestige_cfg["godfather_req"]
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
        }

    next_rank = RANKS[current_rank_id]
    current_rank_req = RANKS[current_rank_id - 1]

    # Scale thresholds by prestige multiplier so progress reflects the harder climb
    scaled_current_req = int(current_rank_req["required_points"] * prestige_mult)
    scaled_next_req = int(next_rank["required_points"] * prestige_mult)

    rank_points_progress = 0
    if scaled_next_req > scaled_current_req:
        points_range = scaled_next_req - scaled_current_req
        points_current = raw_points - scaled_current_req
        rank_points_progress = min(100, max(0, (points_current / points_range * 100)))

    return {
        "current_rank": current_rank_id,
        "current_rank_name": current_rank_name,
        "next_rank": next_rank["id"],
        "next_rank_name": next_rank["name"],
        "rank_points_progress": rank_points_progress,
        "rank_points_needed": max(0, scaled_next_req - raw_points),
        "rank_points_current": raw_points,
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
