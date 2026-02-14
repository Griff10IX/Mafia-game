# States: cities (travel), casino games, dice owners per city
from fastapi import Depends

from server import db, get_current_user, get_wealth_rank, STATES, DICE_MAX_BET, CASINO_GAMES


async def get_states(current_user: dict = Depends(get_current_user)):
    """List all cities (travel destinations), casino games with max bet, and dice owners per city."""
    dice_docs = await db.dice_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1}).to_list(20)
    owner_ids = list({d["owner_id"] for d in dice_docs if d.get("owner_id")})
    users = await db.users.find({"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "username": 1, "money": 1}).to_list(len(owner_ids) or 1)
    user_map = {u["id"]: u for u in users}
    dice_owners = {}
    for d in dice_docs:
        if not d.get("owner_id"):
            continue
        u = user_map.get(d["owner_id"], {})
        money = int((u.get("money") or 0) or 0)
        _, wealth_rank_name = get_wealth_rank(money)
        dice_max = d.get("max_bet") if d.get("max_bet") is not None else DICE_MAX_BET
        dice_owners[d["city"]] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "max_bet": dice_max}
    return {"cities": list(STATES), "games": CASINO_GAMES, "dice_owners": dice_owners}


def register(router):
    router.add_api_route("/states", get_states, methods=["GET"])
