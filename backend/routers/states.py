# States: cities (travel), casino games, all casino owners per city
from datetime import datetime, timezone
from fastapi import Depends

from server import db, get_current_user, get_wealth_rank, STATES
from routers.dice import DICE_MAX_BET
from routers.roulette import ROULETTE_MAX_BET
from routers.blackjack import BLACKJACK_MAX_BET
from routers.horseracing import HORSERACING_MAX_BET
from routers.slots import SLOTS_MAX_BET
from routers.video_poker import VIDEO_POKER_MAX_BET

CASINO_GAMES = [
    {"id": "blackjack", "name": "Blackjack", "max_bet": BLACKJACK_MAX_BET},
    {"id": "horseracing", "name": "Horse Racing", "max_bet": HORSERACING_MAX_BET},
    {"id": "roulette", "name": "Roulette", "max_bet": ROULETTE_MAX_BET},
    {"id": "dice", "name": "Dice", "max_bet": DICE_MAX_BET},
    {"id": "videopoker", "name": "Video Poker", "max_bet": VIDEO_POKER_MAX_BET},
    {"id": "slots", "name": "Slots", "max_bet": SLOTS_MAX_BET},
]


async def get_states(current_user: dict = Depends(get_current_user)):
    """List all cities (travel destinations), casino games with max bet, and casino owners per city."""
    dice_docs = await db.dice_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1}).to_list(20)
    rlt_docs = await db.roulette_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1}).to_list(20)
    blackjack_docs = await db.blackjack_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1}).to_list(20)
    horseracing_docs = await db.horseracing_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1}).to_list(20)
    videopoker_docs = await db.videopoker_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1}).to_list(20)
    slots_docs = await db.slots_ownership.find({}, {"_id": 0, "state": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1, "expires_at": 1}).to_list(20)

    all_docs = dice_docs + rlt_docs + blackjack_docs + horseracing_docs + videopoker_docs + slots_docs
    owner_ids = list({d["owner_id"] for d in all_docs if d.get("owner_id")})
    users = await db.users.find({"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "username": 1, "money": 1}).to_list(len(owner_ids) or 1)
    user_map = {u["id"]: u for u in users}

    dice_owners = {}
    roulette_owners = {}
    blackjack_owners = {}
    horseracing_owners = {}
    videopoker_owners = {}
    slots_owners = {}

    now_utc = datetime.now(timezone.utc)
    def _slots_expired(d):
        if not d or not d.get("expires_at"):
            return True
        try:
            t = datetime.fromisoformat(d["expires_at"].replace("Z", "+00:00"))
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            return now_utc >= t
        except Exception:
            return True

    for d in dice_docs:
        if not d.get("owner_id"):
            continue
        u = user_map.get(d["owner_id"], {})
        money = int((u.get("money") or 0) or 0)
        _, wealth_rank_name = get_wealth_rank(money)
        dice_max = d.get("max_bet") if d.get("max_bet") is not None else DICE_MAX_BET
        dice_owners[d["city"]] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "max_bet": dice_max, "buy_back_reward": d.get("buy_back_reward")}

    for d in rlt_docs:
        if not d.get("owner_id"):
            continue
        u = user_map.get(d["owner_id"], {})
        money = int((u.get("money") or 0) or 0)
        _, wealth_rank_name = get_wealth_rank(money)
        rlt_max = d.get("max_bet") if d.get("max_bet") is not None else ROULETTE_MAX_BET
        roulette_owners[d["city"]] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "max_bet": rlt_max}

    for d in blackjack_docs:
        if not d.get("owner_id"):
            continue
        u = user_map.get(d["owner_id"], {})
        money = int((u.get("money") or 0) or 0)
        _, wealth_rank_name = get_wealth_rank(money)
        bj_max = d.get("max_bet") if d.get("max_bet") is not None else BLACKJACK_MAX_BET
        blackjack_owners[d["city"]] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "max_bet": bj_max, "buy_back_reward": d.get("buy_back_reward")}

    for d in horseracing_docs:
        if not d.get("owner_id"):
            continue
        u = user_map.get(d["owner_id"], {})
        money = int((u.get("money") or 0) or 0)
        _, wealth_rank_name = get_wealth_rank(money)
        hr_max = d.get("max_bet") if d.get("max_bet") is not None else HORSERACING_MAX_BET
        horseracing_owners[d["city"]] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "max_bet": hr_max}

    for d in videopoker_docs:
        if not d.get("owner_id"):
            continue
        u = user_map.get(d["owner_id"], {})
        money = int((u.get("money") or 0) or 0)
        _, wealth_rank_name = get_wealth_rank(money)
        vp_max = d.get("max_bet") if d.get("max_bet") is not None else VIDEO_POKER_MAX_BET
        videopoker_owners[d["city"]] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "max_bet": vp_max}

    for d in slots_docs:
        if not d.get("owner_id") or _slots_expired(d):
            continue
        st = d.get("state")
        if not st:
            continue
        u = user_map.get(d["owner_id"], {})
        money = int((u.get("money") or 0) or 0)
        _, wealth_rank_name = get_wealth_rank(money)
        slots_max = d.get("max_bet") if d.get("max_bet") is not None else SLOTS_MAX_BET
        slots_owners[st] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "max_bet": slots_max, "buy_back_reward": d.get("buy_back_reward")}

    return {
        "cities": list(STATES),
        "games": CASINO_GAMES,
        "dice_owners": dice_owners,
        "roulette_owners": roulette_owners,
        "blackjack_owners": blackjack_owners,
        "horseracing_owners": horseracing_owners,
        "videopoker_owners": videopoker_owners,
        "slots_owners": slots_owners,
    }


def register(router):
    router.add_api_route("/states", get_states, methods=["GET"])
