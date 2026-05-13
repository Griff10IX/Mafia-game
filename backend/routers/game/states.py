# States: cities (travel), casino games, all casino owners per city
import asyncio
import time
from datetime import datetime, timezone
from fastapi import Depends, HTTPException, Body
from pydantic import BaseModel

from server import db, get_current_user, get_wealth_rank, STATES, get_state_heads, set_state_head, effective_public_casino_max_bet


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
from routers.admin.airport import AIRPORT_COST, AIRPORT_PRICE_MIN, AIRPORT_PRICE_MAX
from routers.kill.armoury import _accumulated_bullets
from utils.claim_costs import load_claim_costs
from utils.location_climate import get_location_climate

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


_states_page_cache: dict[str, dict] = {}
_STATES_PAGE_TTL_SEC = 3
_STATES_PAGE_MAX_ENTRIES = 5000


def _invalidate_states_page_cache(user_id: str | None = None):
    if user_id:
        _states_page_cache.pop(user_id, None)
        return
    _states_page_cache.clear()


def _states_cache_get(user_id: str):
    entry = _states_page_cache.get(user_id)
    if not entry:
        return None
    if time.monotonic() > entry["expires_at"]:
        _states_page_cache.pop(user_id, None)
        return None
    return entry["data"]


def _states_cache_set(user_id: str, payload: dict):
    if len(_states_page_cache) >= _STATES_PAGE_MAX_ENTRIES and user_id not in _states_page_cache:
        _states_page_cache.pop(next(iter(_states_page_cache)), None)
    _states_page_cache[user_id] = {"expires_at": time.monotonic() + _STATES_PAGE_TTL_SEC, "data": payload}


async def _state_claim_context(current_user: dict) -> dict:
    family_id = (current_user.get("family_id") or "").strip()
    if not family_id:
        return {"my_role": None, "qualifies_for_state_head": False}
    member_task = db.family_members.find_one(
        {"family_id": family_id, "user_id": current_user["id"]},
        {"_id": 0, "role": 1},
    )
    qualifies_task = family_qualifies_for_state_head(family_id)
    member, qualifies = await asyncio.gather(member_task, qualifies_task)
    role = (member or {}).get("role") or current_user.get("family_role")
    return {
        "my_role": str(role or "").strip().lower() or None,
        "qualifies_for_state_head": bool(qualifies),
    }


async def get_states(current_user: dict = Depends(get_current_user)):
    """List all cities (travel destinations), casino games with max bet, and casino owners per city."""
    user_id = current_user.get("id") or ""
    cached = _states_cache_get(user_id)
    if cached is not None:
        return cached

    states_count = len(STATES or []) or 1
    (
        dice_docs,
        rlt_docs,
        blackjack_docs,
        horseracing_docs,
        videopoker_docs,
        slots_docs,
        bullet_factory_docs,
        airport_docs,
        claim_costs,
        heads_raw,
        claim_context,
    ) = await asyncio.gather(
        db.dice_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1}).to_list(states_count),
        db.roulette_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1}).to_list(states_count),
        db.blackjack_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1}).to_list(states_count),
        db.horseracing_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1}).to_list(states_count),
        db.videopoker_ownership.find({}, {"_id": 0, "city": 1, "owner_id": 1, "max_bet": 1, "buy_back_reward": 1}).to_list(states_count),
        db.slots_ownership.find({}, {"_id": 0, "state": 1, "owner_id": 1, "owner_username": 1, "max_bet": 1, "buy_back_reward": 1, "expires_at": 1, "next_draw_at": 1}).to_list(states_count),
        db.bullet_factory.find({}, {"_id": 0, "state": 1, "owner_id": 1, "owner_username": 1, "last_collected_at": 1, "price_per_bullet": 1, "unowned_price": 1}).to_list(states_count),
        db.airport_ownership.find({"slot": 1}, {"_id": 0, "state": 1, "slot": 1, "owner_username": 1, "price_per_travel": 1}).to_list(states_count),
        load_claim_costs(db),
        get_state_heads(),
        _state_claim_context(current_user),
    )

    all_docs = dice_docs + rlt_docs + blackjack_docs + horseracing_docs + videopoker_docs + slots_docs + bullet_factory_docs
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
        dice_max = effective_public_casino_max_bet(
            d.get("owner_id") if d and d.get("owner_id") else None,
            d.get("max_bet") if d else None,
            default_when_owned_positive=DICE_MAX_BET,
        )
        if d and d.get("owner_id"):
            u = user_map.get(d["owner_id"], {})
            money = int((u.get("money") or 0) or 0)
            _, wealth_rank_name, wealth_rank_color = get_wealth_rank(money)
            dice_owners[st] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "wealth_rank_color": wealth_rank_color, "max_bet": dice_max, "buy_back_reward": d.get("buy_back_reward")}
        else:
            dice_owners[st] = {"username": None, "max_bet": dice_max}

        # Roulette
        d = rlt_docs_by_city.get(st)
        rlt_max = effective_public_casino_max_bet(
            d.get("owner_id") if d and d.get("owner_id") else None,
            d.get("max_bet") if d else None,
            default_when_owned_positive=ROULETTE_MAX_BET,
        )
        if d and d.get("owner_id"):
            u = user_map.get(d["owner_id"], {})
            money = int((u.get("money") or 0) or 0)
            _, wealth_rank_name, wealth_rank_color = get_wealth_rank(money)
            roulette_owners[st] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "wealth_rank_color": wealth_rank_color, "max_bet": rlt_max, "buy_back_reward": d.get("buy_back_reward")}
        else:
            roulette_owners[st] = {"username": None, "max_bet": rlt_max}

        # Blackjack
        d = blackjack_docs_by_city.get(st)
        bj_max = effective_public_casino_max_bet(
            d.get("owner_id") if d and d.get("owner_id") else None,
            d.get("max_bet") if d else None,
            default_when_owned_positive=BLACKJACK_MAX_BET,
        )
        if d and d.get("owner_id"):
            u = user_map.get(d["owner_id"], {})
            money = int((u.get("money") or 0) or 0)
            _, wealth_rank_name, wealth_rank_color = get_wealth_rank(money)
            blackjack_owners[st] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "wealth_rank_color": wealth_rank_color, "max_bet": bj_max, "buy_back_reward": d.get("buy_back_reward")}
        else:
            blackjack_owners[st] = {"username": None, "max_bet": bj_max}

        # Horse Racing
        d = horseracing_docs_by_city.get(st)
        hr_max = effective_public_casino_max_bet(
            d.get("owner_id") if d and d.get("owner_id") else None,
            d.get("max_bet") if d else None,
            default_when_owned_positive=HORSERACING_MAX_BET,
        )
        if d and d.get("owner_id"):
            u = user_map.get(d["owner_id"], {})
            money = int((u.get("money") or 0) or 0)
            _, wealth_rank_name, wealth_rank_color = get_wealth_rank(money)
            horseracing_owners[st] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "wealth_rank_color": wealth_rank_color, "max_bet": hr_max, "buy_back_reward": d.get("buy_back_reward")}
        else:
            horseracing_owners[st] = {"username": None, "max_bet": hr_max}

        # Video Poker
        d = videopoker_docs_by_city.get(st)
        vp_max = effective_public_casino_max_bet(
            d.get("owner_id") if d and d.get("owner_id") else None,
            d.get("max_bet") if d else None,
            default_when_owned_positive=VIDEO_POKER_MAX_BET,
        )
        if d and d.get("owner_id"):
            u = user_map.get(d["owner_id"], {})
            money = int((u.get("money") or 0) or 0)
            _, wealth_rank_name, wealth_rank_color = get_wealth_rank(money)
            videopoker_owners[st] = {"user_id": d["owner_id"], "username": u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "wealth_rank_color": wealth_rank_color, "max_bet": vp_max, "buy_back_reward": d.get("buy_back_reward")}
        else:
            videopoker_owners[st] = {"username": None, "max_bet": vp_max}

    # Slots: one per state; include state-owned (no owner) with next_draw_at
    slots_docs_by_state = {(d.get("state") or "").strip(): d for d in slots_docs if d.get("state")}
    for st in STATES or []:
        doc = slots_docs_by_state.get(st)
        next_draw_at = doc.get("next_draw_at") if doc else None
        slots_owner_for_cap = doc.get("owner_id") if doc and doc.get("owner_id") and not _slots_expired(doc) else None
        slots_max = effective_public_casino_max_bet(
            slots_owner_for_cap,
            doc.get("max_bet") if doc else None,
            default_when_owned_positive=SLOTS_MAX_BET,
        )
        if doc and doc.get("owner_id") and not _slots_expired(doc):
            u = user_map.get(doc["owner_id"], {})
            money = int((u.get("money") or 0) or 0)
            _, wealth_rank_name, wealth_rank_color = get_wealth_rank(money)
            slots_owners[st] = {"user_id": doc["owner_id"], "username": doc.get("owner_username") or u.get("username") or "?", "wealth_rank_name": wealth_rank_name, "wealth_rank_color": wealth_rank_color, "max_bet": slots_max, "buy_back_reward": doc.get("buy_back_reward"), "next_draw_at": next_draw_at}
        else:
            # State-owned or no doc: still include so frontend can show "State owned" and next_draw_at
            slots_owners[st] = {"username": None, "max_bet": slots_max, "next_draw_at": next_draw_at}

    bullet_factories = []
    bullet_docs_by_state = {(d.get("state") or "").strip(): d for d in bullet_factory_docs if d.get("state")}
    for st in STATES or []:
        factory = bullet_docs_by_state.get(st) or {}
        owner_id = factory.get("owner_id")
        owner = user_map.get(owner_id or "", {})
        owner_username = factory.get("owner_username") or (owner.get("username") if owner_id else None)
        price = factory.get("price_per_bullet") if owner_id else factory.get("unowned_price")
        bullet_factories.append({
            "state": st,
            "owner_id": owner_id,
            "owner_username": owner_username or "Unclaimed",
            "accumulated_bullets": _accumulated_bullets(factory),
            "price_per_bullet": price,
        })

    airports = []
    airport_docs_by_state = {(d.get("state") or "").strip(): d for d in airport_docs if d.get("state")}
    for st in STATES or []:
        airport = airport_docs_by_state.get(st) or {}
        raw_price = airport.get("price_per_travel") or AIRPORT_COST
        price = max(AIRPORT_PRICE_MIN, min(int(raw_price), AIRPORT_PRICE_MAX))
        airports.append({
            "state": st,
            "slot": 1,
            "owner_username": airport.get("owner_username") or "Unclaimed",
            "price_per_travel": price,
        })

    # State heads: which family (if any) is head of each state
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

    payload = {
        "cities": list(STATES),
        "games": CASINO_GAMES,
        "dice_owners": dice_owners,
        "roulette_owners": roulette_owners,
        "blackjack_owners": blackjack_owners,
        "horseracing_owners": horseracing_owners,
        "videopoker_owners": videopoker_owners,
        "slots_owners": slots_owners,
        "state_heads": state_heads,
        "bullet_factories": bullet_factories,
        "airports": airports,
        "airport_claim_cost": claim_costs["airport"],
        "user_current_state": current_user.get("current_state"),
        "family_my": claim_context,
        "location_climate": get_location_climate(now_utc),
    }
    _states_cache_set(user_id, payload)
    return payload


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
    _invalidate_states_page_cache()
    return {"ok": True, "state": state, "message": f"Your family is now head of {state}."}


def register(router):
    router.add_api_route("/states", get_states, methods=["GET"])
    router.add_api_route("/states/claim", states_claim, methods=["POST"])
