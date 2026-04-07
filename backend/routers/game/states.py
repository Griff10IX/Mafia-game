# States: cities (travel), casino games, all casino owners per city
from datetime import datetime, timezone
from fastapi import Depends, HTTPException, Body
from pydantic import BaseModel

from server import db, get_current_user, get_wealth_rank, STATES, get_state_heads, set_state_head


def _parse_iso_datetime(s):
    """Parse ISO datetime string safely; return timezone-aware datetime or None."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None
from routers.casinos.dice import DICE_MAX_BET
from routers.game.families import resolve_family_id, family_qualifies_for_state_head
from routers.casinos.roulette import ROULETTE_MAX_BET
from routers.casinos.blackjack import BLACKJACK_MAX_BET
from routers.casinos.horseracing import HORSERACING_MAX_BET
from routers.casinos.slots import SLOTS_MAX_BET
from routers.casinos.video_poker import VIDEO_POKER_MAX_BET

CASINO_GAMES = [
    {"id": "blackjack", "name": "Blackjack", "max_bet": BLACKJACK_MAX_BET},
    {"id": "horseracing", "name": "Horse Racing", "max_bet": HORSERACING_MAX_BET},
    {"id": "roulette", "name": "Roulette", "max_bet": ROULETTE_MAX_BET},
    {"id": "dice", "name": "Dice", "max_bet": DICE_MAX_BET},
    {"id": "videopoker", "name": "Video Poker", "max_bet": VIDEO_POKER_MAX_BET},
    {"id": "slots", "name": "Slots", "max_bet": SLOTS_MAX_BET},
]


class StateClaimRequest(BaseModel):
    state: str


async def get_states(current_user: dict = Depends(get_current_user)):
    """List all cities (travel destinations), casino games with max bet, and casino owners per city."""
    dice_docs = await db.dice_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1}).to_list(20)
    rlt_docs = await db.roulette_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1}).to_list(20)
    blackjack_docs = await db.blackjack_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1}).to_list(20)
    horseracing_docs = await db.horseracing_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1}).to_list(20)
    videopoker_docs = await db.videopoker_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1}).to_list(20)
    slots_docs = await db.slots_ownership.find({}, {"_id": 0, "state": 1, "owner_id": 1, "owner_username": 1, "max_bet": 1, "buy_back_reward": 1, "expires_at": 1, "next_draw_at": 1}).to_list(20)

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
        t = _parse_iso_datetime(d.get("expires_at"))
        if not t:
            return True
        return now_utc >= t

    # Build lookup maps for max_bet from ownership docs (including unowned casinos set by admin)
    dice_docs_by_city = {d.get("city"): d for d in dice_docs if d.get("city")}
    rlt_docs_by_city = {d.get("city"): d for d in rlt_docs if d.get("city")}
    blackjack_docs_by_city = {d.get("city"): d for d in blackjack_docs if d.get("city")}
    horseracing_docs_by_city = {d.get("city"): d for d in horseracing_docs if d.get("city")}
    videopoker_docs_by_city = {d.get("city"): d for d in videopoker_docs if d.get("city")}

    # Process all states for each casino type (not just owned ones)
    for st in STATES or []:
        # Dice
        d = dice_docs_by_city.get(st)
        dice_max = d.get("max_bet") if d and d.get("max_bet") is not None else DICE_MAX_BET
        if d and d.get("owner_id"):
            u = user_map.get(d["owner_id"], {})
            money = int((u.get("money") or 0) or 0)
            _, wealth_rank_name, wealth_rank_color = get_wealth_rank(money)
            dice_owners[st] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "wealth_rank_color": wealth_rank_color, "max_bet": dice_max, "buy_back_reward": d.get("buy_back_reward")}
        else:
            dice_owners[st] = {"username": None, "max_bet": dice_max}

        # Roulette
        d = rlt_docs_by_city.get(st)
        rlt_max = d.get("max_bet") if d and d.get("max_bet") is not None else ROULETTE_MAX_BET
        if d and d.get("owner_id"):
            u = user_map.get(d["owner_id"], {})
            money = int((u.get("money") or 0) or 0)
            _, wealth_rank_name, wealth_rank_color = get_wealth_rank(money)
            roulette_owners[st] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "wealth_rank_color": wealth_rank_color, "max_bet": rlt_max, "buy_back_reward": d.get("buy_back_reward")}
        else:
            roulette_owners[st] = {"username": None, "max_bet": rlt_max}

        # Blackjack
        d = blackjack_docs_by_city.get(st)
        bj_max = d.get("max_bet") if d and d.get("max_bet") is not None else BLACKJACK_MAX_BET
        if d and d.get("owner_id"):
            u = user_map.get(d["owner_id"], {})
            money = int((u.get("money") or 0) or 0)
            _, wealth_rank_name, wealth_rank_color = get_wealth_rank(money)
            blackjack_owners[st] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "wealth_rank_color": wealth_rank_color, "max_bet": bj_max, "buy_back_reward": d.get("buy_back_reward")}
        else:
            blackjack_owners[st] = {"username": None, "max_bet": bj_max}

        # Horse Racing
        d = horseracing_docs_by_city.get(st)
        hr_max = d.get("max_bet") if d and d.get("max_bet") is not None else HORSERACING_MAX_BET
        if d and d.get("owner_id"):
            u = user_map.get(d["owner_id"], {})
            money = int((u.get("money") or 0) or 0)
            _, wealth_rank_name, wealth_rank_color = get_wealth_rank(money)
            horseracing_owners[st] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "wealth_rank_color": wealth_rank_color, "max_bet": hr_max, "buy_back_reward": d.get("buy_back_reward")}
        else:
            horseracing_owners[st] = {"username": None, "max_bet": hr_max}

        # Video Poker
        d = videopoker_docs_by_city.get(st)
        vp_max = d.get("max_bet") if d and d.get("max_bet") is not None else VIDEO_POKER_MAX_BET
        if d and d.get("owner_id"):
            u = user_map.get(d["owner_id"], {})
            money = int((u.get("money") or 0) or 0)
            _, wealth_rank_name, wealth_rank_color = get_wealth_rank(money)
            videopoker_owners[st] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "wealth_rank_color": wealth_rank_color, "max_bet": vp_max, "buy_back_reward": d.get("buy_back_reward")}
        else:
            videopoker_owners[st] = {"username": None, "max_bet": vp_max}

    # Slots: one per state; include state-owned (no owner) with next_draw_at
    for st in STATES or []:
        doc = next((d for d in slots_docs if (d.get("state") or "").strip() == st), None)
        next_draw_at = doc.get("next_draw_at") if doc else None
        slots_max = doc.get("max_bet") if doc and doc.get("max_bet") is not None else SLOTS_MAX_BET
        if doc and doc.get("owner_id") and not _slots_expired(doc):
            u = user_map.get(doc["owner_id"], {})
            money = int((u.get("money") or 0) or 0)
            _, wealth_rank_name, wealth_rank_color = get_wealth_rank(money)
            slots_owners[st] = {"user_id": doc["owner_id"], "username": doc.get("owner_username") or u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "wealth_rank_color": wealth_rank_color, "max_bet": slots_max, "buy_back_reward": doc.get("buy_back_reward"), "next_draw_at": next_draw_at}
        else:
            # State-owned or no doc: still include so frontend can show "State owned" and next_draw_at
            slots_owners[st] = {"username": None, "max_bet": slots_max, "next_draw_at": next_draw_at}

    # State heads: which family (if any) is head of each state
    heads_raw = await get_state_heads()
    state_heads = {}
    head_family_ids = [fid for fid in (heads_raw or {}).values() if fid]
    head_families = await db.families.find(
        {"id": {"$in": head_family_ids}},
        {"_id": 0, "id": 1, "name": 1, "tag": 1, "emblem_preset_id": 1, "avatar_url": 1},
    ).to_list(len(head_family_ids) or 1)
    fam_map = {f["id"]: f for f in head_families}
    for st in (STATES or []):
        fid = (heads_raw or {}).get(st)
        if fid and fam_map.get(fid):
            f = fam_map[fid]
            state_heads[st] = {
                "family_id": f["id"],
                "family_name": f.get("name") or "?",
                "family_tag": f.get("tag") or "?",
                "family_emblem_preset_id": f.get("emblem_preset_id"),
                "family_emblem_avatar_url": f.get("avatar_url"),
            }
        else:
            state_heads[st] = None

    return {
        "cities": list(STATES),
        "games": CASINO_GAMES,
        "dice_owners": dice_owners,
        "roulette_owners": roulette_owners,
        "blackjack_owners": blackjack_owners,
        "horseracing_owners": horseracing_owners,
        "videopoker_owners": videopoker_owners,
        "slots_owners": slots_owners,
        "state_heads": state_heads,
    }


async def states_claim(
    current_user: dict = Depends(get_current_user),
    body: StateClaimRequest = Body(...),
):
    """Claim an empty state as head family. Boss only; family boss must have prestige level 1+."""
    state = (body.state or "").strip()
    if state not in (STATES or []):
        raise HTTPException(status_code=400, detail="Invalid state")
    family_id = await resolve_family_id(current_user["id"])
    if not family_id:
        raise HTTPException(status_code=403, detail="You must be in a family to claim a state")
    member = await db.family_members.find_one(
        {"family_id": family_id, "user_id": current_user["id"]},
        {"_id": 0, "role": 1},
    )
    role = (member or {}).get("role") or ""
    if str(role).strip().lower() != "boss":
        raise HTTPException(status_code=403, detail="Only the family boss can claim a state")
    if not await family_qualifies_for_state_head(family_id):
        raise HTTPException(
            status_code=403,
            detail="Your family does not qualify: the family boss must have prestige level 1 or higher.",
        )
    heads = await get_state_heads()
    if heads.get(state):
        raise HTTPException(status_code=400, detail="State already has a head family")
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "head_of_state": 1})
    if (fam or {}).get("head_of_state"):
        raise HTTPException(status_code=400, detail="Your family is already head of a state")
    err = await set_state_head(state, family_id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True, "state": state, "message": f"Your family is now head of {state}."}


def register(router):
    router.add_api_route("/states", get_states, methods=["GET"])
    router.add_api_route("/states/claim", states_claim, methods=["POST"])
