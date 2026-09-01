# Casino Video Poker (Jacks or Better): config, ownership, claim, relinquish, set-max-bet, set-buy-back, send-to-user, sell-on-trade, deal, draw, game, history, buy-back
from datetime import datetime, timezone, timedelta
import logging
import re
import secrets
_rng = secrets.SystemRandom()
import time
import uuid
from collections import Counter
from typing import Any, Optional
from pydantic import BaseModel, field_validator
from bson.objectid import ObjectId

from fastapi import Depends, HTTPException, Request

from utils.claim_costs import load_claim_costs
from utils.point_provenance import log_points_event
from utils.mdg_prize_holds import (
    MDG_PRIZE_HOLD_DISPLAY_NAME,
    casino_economy_owner_id,
    is_mdg_prize_hold_owner,
)
from utils.civilian_protection import (
    cleanup_expired_buyback_offers_for_user,
    maybe_revoke_civilian_protection,
    raise_if_civilian_protected_asset_recipient,
    require_protection_revoke_confirm,
    shorten_civilian_protection_for_casino_claim,
)

from server import (
    db,
    get_current_user,
    get_current_user_verified,
    STATES,
    get_rank_info,
    user_prestige_rank_mult,
    CAPO_RANK_ID,
    casino_ownership_write_below_capo_ops,
    maybe_auto_relinquish_below_capo,
    CASINO_MIN_OWNER_MAX_BET,
    effective_public_casino_max_bet,
    _user_owns_any_casino,
    raise_if_single_casino_claim_blocked,
    raise_if_city_casino_already_owned,
    claim_unowned_city_casino,
    raise_if_single_casino_receive_blocked,
    raise_if_dead_casino_transfer_target,
    _username_pattern,
    log_gambling,
    resolve_gambling_log_buy_back,
    get_head_family_id_for_state,
    state_head_casino_treasury_share,
    get_casino_caps,
    adjust_casino_buy_back_escrow,
    refund_casino_buy_back_escrow_points,
    refund_and_delete_buy_back_offers_matching,
    log_casino_buyback_credit_points,
    assert_casino_clear_of_buy_back_for_listing,
    assert_casino_clear_of_buy_back_for_relinquish,
    _ownership_display_profit,
    bump_user_biggest_casino_payout,
    get_wealth_rank,
    get_wealth_rank_range,
    notify_casino_seizure,
    send_notification,
)
from routers.casinos.roulette import RouletteClaimRequest, RouletteSetMaxBetRequest, RouletteSendToUserRequest
from routers.casinos.dice import DiceSellOnTradeRequest
from utils.quicktrade_casino_cleanup import (
    cancel_quicktrade_casino_listings_by_locations,
    ensure_no_duplicate_casino_quicktrade_listing,
)
from utils.casino_page_rl import casinos_sustained_rl_dependencies
from utils.gambling_self_ban import raise_if_gambling_self_banned

_casinos_rl_u = casinos_sustained_rl_dependencies(db, get_current_user)

logger = logging.getLogger(__name__)

# ----- Constants -----
VIDEO_POKER_MAX_BET = 50_000_000
VIDEO_POKER_DEFAULT_MAX_BET = 50_000_000
VIDEO_POKER_ABSOLUTE_MAX_BET = 500_000_000
# Video poker claim cost: utils.claim_costs (key video_poker)
VIDEO_POKER_HISTORY_MAX = 10
VIDEO_POKER_HOUSE_EDGE = 0.0005  # 0.05% of profit to house (state head when no owner), like dice
# Secret owner favor (like roulette): advertised deal/draw looks fair; ~7% of would-be paying
# draws are silently re-drawn to a non-paying hand. Never changes held cards; never exposed in API.
VIDEO_POKER_SECRET_MISS_CHANCE = 0.07

SUITS = ["H", "D", "C", "S"]
VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
VALUE_RANK = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14}

# Payout multipliers: cash credited on draw = round(bet * multiplier); stake already taken on deal.
# Values match real Jacks-or-Better machine pays (total return of the bet):
#   jacks_or_better=1 → stake returned (net 0), two_pair=2, … royal 250–800.
# Presets: tight=8/5, normal=9/6 full-pay, increased=9/7, enhanced=10/7.
# Deal is fair; draw has a small secret miss rate (VIDEO_POKER_SECRET_MISS_CHANCE).
VIDEO_POKER_DEFAULT_ODDS_PRESET = "tight"
VIDEO_POKER_ODDS_PRESET_LABELS = {
    "tight": "Tight payouts",
    "normal": "Normal payouts",
    "increased": "Increased payouts",
    "enhanced": "Enhanced payouts",
}
VIDEO_POKER_PAY_PRESETS: dict[str, dict[str, float]] = {
    # 8/5 JoB — real-life house-positive (~97% RTP with optimal play before secret miss)
    "tight": {
        "royal_flush": 250,
        "straight_flush": 50,
        "four_of_a_kind": 25,
        "full_house": 8,
        "flush": 5,
        "straight": 4,
        "three_of_a_kind": 3,
        "two_pair": 2,
        "jacks_or_better": 1,
    },
    # 9/6 full-pay (~99.5% before miss)
    "normal": {
        "royal_flush": 800,
        "straight_flush": 50,
        "four_of_a_kind": 25,
        "full_house": 9,
        "flush": 6,
        "straight": 4,
        "three_of_a_kind": 3,
        "two_pair": 2,
        "jacks_or_better": 1,
    },
    # 9/7
    "increased": {
        "royal_flush": 800,
        "straight_flush": 50,
        "four_of_a_kind": 25,
        "full_house": 9,
        "flush": 7,
        "straight": 4,
        "three_of_a_kind": 3,
        "two_pair": 2,
        "jacks_or_better": 1,
    },
    # 10/7
    "enhanced": {
        "royal_flush": 800,
        "straight_flush": 50,
        "four_of_a_kind": 25,
        "full_house": 10,
        "flush": 7,
        "straight": 4,
        "three_of_a_kind": 3,
        "two_pair": 2,
        "jacks_or_better": 1,
    },
}
# Back-compat alias for imports / admin tooling
PAY_TABLE = VIDEO_POKER_PAY_PRESETS[VIDEO_POKER_DEFAULT_ODDS_PRESET]


def _vp_sample_cards(deck: list, count: int) -> tuple[list, list]:
    candidate_deck = list(deck)
    _rng.shuffle(candidate_deck)
    hand = [candidate_deck.pop() for _ in range(min(count, len(candidate_deck)))]
    return hand, candidate_deck


def _vp_deal_initial_hand(deck: list, preset: str, pay_table: dict[str, float]) -> list:
    """Deal 5 cards fairly from a shuffled deck (preset affects payouts only, not deal odds)."""
    hand, remaining = _vp_sample_cards(deck, 5)
    deck[:] = remaining
    return hand


def _vp_hand_pays(hand: list, pay_table: dict[str, float]) -> bool:
    """True if this hand would credit any payout under the active pay table."""
    _key, _name, multiplier = _evaluate_hand(hand, pay_table)
    return float(multiplier or 0) > 0


def _vp_draw_once(hand: list, swap_indices: list[int], deck: list) -> tuple[list, list]:
    """Fair draw of replacements. Returns (new_hand, remaining_deck) without mutating inputs."""
    candidate_deck = list(deck)
    _rng.shuffle(candidate_deck)
    new_hand = list(hand)
    for i in swap_indices:
        if candidate_deck:
            new_hand[i] = candidate_deck.pop()
    return new_hand, candidate_deck


def _vp_draw_biased_hand(hand: list, held_idx: set[int], deck: list, preset: str, pay_table: dict[str, float]) -> list:
    """Draw replacements, then secretly void ~7% of would-be paying results (owner favor).

    Held cards never change. Client only sees a normal non-paying hand — same pattern as
    dice/roulette secret miss. If every card is held (nothing drawn), no void is possible.
    """
    swap_indices = [i for i in range(5) if i not in held_idx]
    if not swap_indices:
        return hand

    new_hand, remaining = _vp_draw_once(hand, swap_indices, deck)
    if not _vp_hand_pays(new_hand, pay_table) or _rng.random() >= VIDEO_POKER_SECRET_MISS_CHANCE:
        deck[:] = remaining
        return new_hand

    # Secret void: re-draw replacements until the hand does not pay (looks like a fair bust).
    for _ in range(48):
        alt_hand, alt_remaining = _vp_draw_once(hand, swap_indices, deck)
        if not _vp_hand_pays(alt_hand, pay_table):
            deck[:] = alt_remaining
            return alt_hand

    # Could not find a non-paying draw — keep the original fair result (rare).
    deck[:] = remaining
    return new_hand


HAND_NAMES = {
    "royal_flush": "Royal Flush",
    "straight_flush": "Straight Flush",
    "four_of_a_kind": "Four of a Kind",
    "full_house": "Full House",
    "flush": "Flush",
    "straight": "Straight",
    "three_of_a_kind": "Three of a Kind",
    "two_pair": "Two Pair",
    "jacks_or_better": "Jacks or Better",
    "nothing": "Nothing",
}

def _normalize_odds_preset(raw: Any) -> str:
    if raw is None:
        return VIDEO_POKER_DEFAULT_ODDS_PRESET
    s = str(raw).strip().lower()
    if s in VIDEO_POKER_PAY_PRESETS:
        return s
    return VIDEO_POKER_DEFAULT_ODDS_PRESET


def _pay_table_for_preset(preset: str) -> dict[str, float]:
    raw = VIDEO_POKER_PAY_PRESETS.get(
        _normalize_odds_preset(preset), VIDEO_POKER_PAY_PRESETS[VIDEO_POKER_DEFAULT_ODDS_PRESET]
    )
    return dict(raw)


def _effective_odds_preset(doc: Optional[dict]) -> str:
    if not doc:
        return VIDEO_POKER_DEFAULT_ODDS_PRESET
    return _normalize_odds_preset(doc.get("odds_preset"))


def _payout_for_multiplier(bet: int, mult: float) -> int:
    """Cash credited on draw: honest round(bet * multiplier)."""
    m = float(mult or 0)
    if m <= 0:
        return 0
    return max(0, int(round(int(bet) * m)))


def _pay_tables_for_api() -> dict[str, dict[str, float]]:
    return {k: dict(v) for k, v in VIDEO_POKER_PAY_PRESETS.items()}


# ----- Models -----
class VideoPokerDealRequest(BaseModel):
    bet: int

    @field_validator("bet", mode="before")
    @classmethod
    def coerce_bet(cls, v):
        if v is None:
            return 0
        if isinstance(v, str):
            return int(v.strip() or 0)
        return int(v)


class VideoPokerDrawRequest(BaseModel):
    holds: list  # list of 0-based indices to hold (e.g. [0, 2, 4])


class VideoPokerSetBuyBackRequest(BaseModel):
    city: str
    amount: int


class VideoPokerBuyBackAcceptRequest(BaseModel):
    offer_id: str


class VideoPokerBuyBackRejectRequest(BaseModel):
    offer_id: str


class VideoPokerSetOddsPresetRequest(BaseModel):
    city: str
    odds_preset: str


# ----- Per-user cache for GET /casino/videopoker/ownership -----
_ownership_cache: dict = {}
_OWNERSHIP_TTL_SEC = 10
_OWNERSHIP_MAX_ENTRIES = 5000


def _invalidate_ownership_cache(user_id: str):
    _ownership_cache.pop(user_id, None)


def _normalize_city(city_raw: str) -> str:
    if not city_raw:
        return ""
    city_lower = city_raw.strip().lower()
    for state in STATES:
        if state.lower() == city_lower:
            return state
    return ""


async def _get_ownership_doc(city: str):
    if not city:
        return city, None
    norm = _normalize_city(city) or city
    if norm:
        await maybe_auto_relinquish_below_capo(db.videopoker_ownership, {"city": norm}, reset_casino_max_bet=True)
    pattern = re.compile(f"^{re.escape(city)}$", re.IGNORECASE)
    doc = await db.videopoker_ownership.find_one({"city": pattern})
    if doc:
        return doc.get("city", city), doc
    return city, None


def _make_deck():
    return [{"suit": s, "value": v} for s in SUITS for v in VALUES]


def _evaluate_hand(hand, pay_table: dict[str, float]):
    """Evaluate a 5-card poker hand. Returns (hand_rank_key, display_name, multiplier)."""
    values = [c["value"] for c in hand]
    suits = [c["suit"] for c in hand]
    nums = sorted([VALUE_RANK[v] for v in values])

    counts = Counter(nums)
    count_vals = sorted(counts.values(), reverse=True)

    is_flush = len(set(suits)) == 1
    is_straight = False
    if len(set(nums)) == 5:
        if nums[-1] - nums[0] == 4:
            is_straight = True
        elif nums == [2, 3, 4, 5, 14]:
            is_straight = True

    if is_flush and is_straight:
        if set(nums) == {10, 11, 12, 13, 14}:
            key = "royal_flush"
        else:
            key = "straight_flush"
    elif count_vals == [4, 1]:
        key = "four_of_a_kind"
    elif count_vals == [3, 2]:
        key = "full_house"
    elif is_flush:
        key = "flush"
    elif is_straight:
        key = "straight"
    elif count_vals == [3, 1, 1]:
        key = "three_of_a_kind"
    elif count_vals == [2, 2, 1]:
        key = "two_pair"
    elif count_vals == [2, 1, 1, 1]:
        pair_value = [v for v, c in counts.items() if c == 2][0]
        if pair_value >= 11:
            key = "jacks_or_better"
        else:
            key = "nothing"
    else:
        key = "nothing"

    multiplier = float(pay_table.get(key, 0) or 0)
    return key, HAND_NAMES.get(key, key), multiplier


async def _settle_and_save_history(
    user_id: str,
    username: str,
    city: str,
    bet: int,
    hand_key: str,
    hand_name: str,
    payout: int,
    hand: list,
    gambling_extra: dict | None = None,
    odds_preset: str | None = None,
):
    await db.videopoker_games.delete_many({"user_id": user_id})
    history_entry = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "bet": bet,
        "hand_key": hand_key,
        "hand_name": hand_name,
        "payout": payout,
        "hand": hand,
    }
    if odds_preset:
        history_entry["odds_preset"] = odds_preset
    await db.users.update_one(
        {"id": user_id},
        {"$push": {"videopoker_history": {"$each": [history_entry], "$position": 0, "$slice": VIDEO_POKER_HISTORY_MAX}}}
    )
    log_details = {"city": city, "bet": bet, "hand_key": hand_key, "hand_name": hand_name, "payout": payout}
    if odds_preset:
        log_details["odds_preset"] = odds_preset
    if gambling_extra:
        log_details = {**log_details, **gambling_extra}
    await log_gambling(user_id, username or "?", "videopoker", log_details)


async def user_has_active_video_poker_game(user_id) -> bool:
    """True if the user has an unfinished video poker hand."""
    if not user_id:
        return False
    candidates = [user_id, str(user_id)]
    if isinstance(user_id, str) and user_id.isdigit():
        try:
            candidates.append(int(user_id))
        except ValueError:
            pass
    uniq = list(dict.fromkeys(candidates))
    game = await db.videopoker_games.find_one(
        {"user_id": {"$in": uniq}},
        {"_id": 1},
    )
    return game is not None


def register(router):
    @router.get("/casino/videopoker/config", dependencies=_casinos_rl_u)
    async def casino_videopoker_config(current_user: dict = Depends(get_current_user_verified)):
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city(raw) if raw else (STATES[0] if STATES else "")
        _, doc = await _get_ownership_doc(city) if city else (None, None)
        raw_oid = doc.get("owner_id") if doc else None
        oid = (str(raw_oid).strip() or None) if raw_oid is not None else None
        max_bet = effective_public_casino_max_bet(
            oid,
            doc.get("max_bet") if doc else None,
            default_when_owned_positive=VIDEO_POKER_DEFAULT_MAX_BET,
        )
        cc = await load_claim_costs(db)
        preset = _effective_odds_preset(doc)
        return {
            "max_bet": max_bet,
            "claim_cost": cc["video_poker"],
            "house_edge": VIDEO_POKER_HOUSE_EDGE,
            "odds_preset": preset,
            "odds_preset_label": VIDEO_POKER_ODDS_PRESET_LABELS.get(preset, preset.title()),
            "odds_preset_options": [{"id": k, "label": v} for k, v in VIDEO_POKER_ODDS_PRESET_LABELS.items()],
            "pay_table": _pay_table_for_preset(preset),
            "pay_table_presets": _pay_tables_for_api(),
            "hand_names": HAND_NAMES,
        }

    @router.get("/casino/videopoker/ownership", dependencies=_casinos_rl_u)
    async def casino_videopoker_ownership(current_user: dict = Depends(get_current_user_verified)):
        """Current city's video poker ownership: owner, is_owner, claim_cost, max_bet, buy_back_reward, buy_back_offer."""
        user_id = current_user.get("id") or ""
        now_ts = time.time()
        entry = _ownership_cache.get(user_id)
        if entry and (now_ts - entry["ts"]) < _OWNERSHIP_TTL_SEC:
            return entry["data"]
        now = datetime.now(timezone.utc)
        await cleanup_expired_buyback_offers_for_user(db, "videopoker_buy_back_offers", user_id, now.isoformat(), "casino_video_poker")
        raw = (current_user.get("current_state") or "").strip()
        city = _normalize_city(raw) if raw else (STATES[0] if STATES else "Chicago")
        display_city = city or raw or "Chicago"
        stored_city, doc = await _get_ownership_doc(city)
        cc = await load_claim_costs(db)
        if not doc:
            out = {
                "current_city": display_city,
                "owner_id": None,
                "owner_name": None,
                "owner_wealth_rank_name": None,
                "owner_wealth_rank_color": None,
                "owner_wealth_rank_range": None,
                "is_owner": False,
                "is_unclaimed": True,
                "claim_cost": cc["video_poker"],
                "max_bet": effective_public_casino_max_bet(None, None, default_when_owned_positive=VIDEO_POKER_DEFAULT_MAX_BET),
                "buy_back_reward": None,
                "buy_back_offer": None,
                "odds_preset": VIDEO_POKER_DEFAULT_ODDS_PRESET,
                "odds_preset_label": VIDEO_POKER_ODDS_PRESET_LABELS[VIDEO_POKER_DEFAULT_ODDS_PRESET],
            }
            if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
                _ownership_cache[user_id] = {"ts": now_ts, "data": out}
            return out
        owner_id = doc.get("owner_id")
        owner_name = None
        owner_wealth_rank_name = None
        owner_wealth_rank_color = None
        owner_wealth_rank_range = None
        if is_mdg_prize_hold_owner(owner_id):
            owner_name = MDG_PRIZE_HOLD_DISPLAY_NAME
        elif owner_id:
            u = await db.users.find_one({"id": owner_id}, {"username": 1, "money": 1})
            owner_name = u.get("username") if u else None
            if u:
                _, owner_wealth_rank_name, owner_wealth_rank_color = get_wealth_rank(int((u.get("money") or 0) or 0))
                owner_wealth_rank_range = get_wealth_rank_range(int((u.get("money") or 0) or 0))
        is_owner = (not is_mdg_prize_hold_owner(owner_id)) and (owner_id == current_user.get("id") or "")
        oid = (str(owner_id).strip() or None) if owner_id is not None else None
        max_bet = effective_public_casino_max_bet(oid, doc.get("max_bet"), default_when_owned_positive=VIDEO_POKER_DEFAULT_MAX_BET)
        total_earnings = doc.get("total_earnings", 0)
        profit = _ownership_display_profit(doc)
        buy_back_reward = doc.get("buy_back_reward")
        # Check for active buyback offer for this user
        active_offer = await db.videopoker_buy_back_offers.find_one(
            {"to_user_id": user_id},
            {"_id": 0, "id": 1, "points_offered": 1, "amount_shortfall": 1, "owner_paid": 1, "expires_at": 1}
        )
        buy_back_offer = None
        if active_offer:
            try:
                exp_dt = datetime.fromisoformat((active_offer.get("expires_at") or "").replace("Z", "+00:00"))
                if exp_dt > now:
                    buy_back_offer = {
                        "offer_id": active_offer["id"],
                        "points_offered": int(active_offer.get("points_offered") or 0),
                        "amount_shortfall": int(active_offer.get("amount_shortfall") or 0),
                        "owner_paid": int(active_offer.get("owner_paid") or 0),
                        "expires_at": active_offer.get("expires_at"),
                    }
            except Exception:
                pass
        eff_preset = _effective_odds_preset(doc)
        out = {
            "current_city": display_city,
            "owner_id": owner_id,
            "owner_name": owner_name,
            "owner_wealth_rank_name": owner_wealth_rank_name,
            "owner_wealth_rank_color": owner_wealth_rank_color,
            "owner_wealth_rank_range": owner_wealth_rank_range,
            "is_owner": is_owner,
            "is_unclaimed": owner_id is None,
            "claim_cost": cc["video_poker"],
            "max_bet": max_bet,
            "buy_back_reward": buy_back_reward,
            "total_earnings": total_earnings if is_owner else None,
            "profit": profit if is_owner else None,
            "buy_back_offer": buy_back_offer,
            "odds_preset": eff_preset,
            "odds_preset_label": VIDEO_POKER_ODDS_PRESET_LABELS.get(eff_preset, eff_preset.title()),
        }
        if is_owner:
            _, buyback_cap = await get_casino_caps()
            row_pts = await db.users.find_one({"id": user_id}, {"points": 1})
            pts = int((row_pts or {}).get("points") or 0)
            out["buy_back_server_cap"] = buyback_cap
            out["buy_back_effective_max"] = max(0, min(buyback_cap, pts))
        if len(_ownership_cache) < _OWNERSHIP_MAX_ENTRIES:
            _ownership_cache[user_id] = {"ts": now_ts, "data": out}
        return out

    @router.post("/casino/videopoker/claim")
    async def casino_videopoker_claim(
        request: RouletteClaimRequest,
        req: Request,
        current_user: dict = Depends(get_current_user_verified),
    ):
        rank_id, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
        prestige_level = int(current_user.get("prestige_level") or 0)
        if rank_id < CAPO_RANK_ID and prestige_level < 1:
            raise HTTPException(status_code=403, detail="You must be rank Capo or higher to claim a casino. Reach Capo to hold one.")
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        await raise_if_single_casino_claim_blocked(current_user, game_type="videopoker", city=city)
        stored_city, doc = await _get_ownership_doc(city)
        raise_if_city_casino_already_owned(doc, current_user, already_owned_detail="This table already has an owner")
        cc = await load_claim_costs(db)
        claim_cost = cc["video_poker"]
        debit_result = await db.users.find_one_and_update(
            {"id": current_user.get("id") or "", "money": {"$gte": claim_cost}},
            {"$inc": {"money": -claim_cost}},
        )
        if not debit_result:
            raise HTTPException(status_code=400, detail=f"You need ${claim_cost:,} to claim")
        claimed = await claim_unowned_city_casino(
            db.videopoker_ownership,
            city=city,
            stored_city=stored_city,
            set_fields={
                "owner_id": current_user.get("id") or "",
                "owner_username": current_user.get("username") or "",
                "max_bet": VIDEO_POKER_DEFAULT_MAX_BET,
                "buy_back_reward": 0,
                "buy_back_points_held": 0,
                "odds_preset": VIDEO_POKER_DEFAULT_ODDS_PRESET,
            },
        )
        if not claimed:
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": claim_cost}})
            raise HTTPException(status_code=400, detail="This table already has an owner")
        await shorten_civilian_protection_for_casino_claim(db, current_user.get("id") or "")
        await cancel_quicktrade_casino_listings_by_locations("casino_videopoker", stored_city or city, city)
        return {"message": f"You now own the video poker table in {city}!"}

    @router.post("/casino/videopoker/relinquish")
    async def casino_videopoker_relinquish(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        assert_casino_clear_of_buy_back_for_relinquish(doc)
        loc = stored_city or city
        await refund_and_delete_buy_back_offers_matching(
            "videopoker_buy_back_offers",
            {"city": loc},
            points_event_type="casino_video_poker",
            meta_base={"city": loc, "reason": "relinquish_table"},
        )
        held = int((doc or {}).get("buy_back_points_held") or 0)
        await refund_casino_buy_back_escrow_points(
            current_user.get("id") or "",
            held,
            event_type="casino_video_poker",
            meta={"city": loc, "reason": "relinquish"},
        )
        await db.videopoker_ownership.update_one(
            {"city": loc},
            {
                "$set": {
                    "owner_id": None,
                    "owner_username": None,
                    "max_bet": CASINO_MIN_OWNER_MAX_BET,
                    "buy_back_reward": 0,
                    "buy_back_points_held": 0,
                }
            },
        )
        await cancel_quicktrade_casino_listings_by_locations("casino_videopoker", loc, city)
        return {"message": "Ownership relinquished."}

    @router.post("/casino/videopoker/reset-profit")
    async def casino_videopoker_reset_profit(request: RouletteClaimRequest, current_user: dict = Depends(get_current_user_verified)):
        """Reset profit counter to zero (owner only)."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        await db.videopoker_ownership.update_one({"city": stored_city or city}, {"$set": {"profit": 0}})
        return {"message": "Profit reset to zero."}

    @router.post("/casino/videopoker/set-max-bet")
    async def casino_videopoker_set_max_bet(request: RouletteSetMaxBetRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        global_cap, _ = await get_casino_caps()
        new_max = max(50_000, min(request.max_bet, global_cap))
        await db.videopoker_ownership.update_one({"city": stored_city or city}, {"$set": {"max_bet": new_max}})
        return {"message": f"Max bet set to ${new_max:,}"}

    @router.post("/casino/videopoker/set-odds-preset")
    async def casino_videopoker_set_odds_preset(
        request: VideoPokerSetOddsPresetRequest, current_user: dict = Depends(get_current_user_verified)
    ):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        raw = (request.odds_preset or "").strip().lower()
        if raw not in VIDEO_POKER_PAY_PRESETS:
            raise HTTPException(status_code=400, detail="Invalid pay table preset. Use tight, normal, increased, or enhanced.")
        preset = raw
        await db.videopoker_ownership.update_one({"city": stored_city or city}, {"$set": {"odds_preset": preset}})
        return {
            "message": f"Pay table set to {VIDEO_POKER_ODDS_PRESET_LABELS.get(preset, preset)}.",
            "odds_preset": preset,
            "odds_preset_label": VIDEO_POKER_ODDS_PRESET_LABELS.get(preset, preset.title()),
        }

    @router.post("/casino/videopoker/set-buy-back-reward")
    async def casino_videopoker_set_buy_back_reward(request: VideoPokerSetBuyBackRequest, current_user: dict = Depends(get_current_user_verified)):
        """Set buy-back reward (points) offered when you cannot pay a win (owner only)."""
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        _, buyback_cap = await get_casino_caps()
        requested = int(request.amount)
        amount = max(0, min(requested, buyback_cap))
        old_held = int((doc or {}).get("buy_back_points_held") or 0)
        await adjust_casino_buy_back_escrow(
            current_user["id"],
            old_held,
            amount,
            event_type="casino_video_poker",
            meta={"city": stored_city or city},
        )
        await db.videopoker_ownership.update_one(
            {"city": stored_city or city},
            {"$set": {"buy_back_reward": amount, "buy_back_points_held": amount}},
        )
        msg = "Buy-back reward updated."
        if requested > buyback_cap:
            msg = f"Saved {amount:,} points (server max buy-back is {buyback_cap:,})."
        return {"message": msg, "buy_back_reward": amount}

    @router.post("/casino/videopoker/buy-back/accept")
    async def casino_videopoker_buy_back_accept(request: VideoPokerBuyBackAcceptRequest, current_user: dict = Depends(get_current_user_verified)):
        """Accept a buy-back offer: receive points and transfer ownership back to previous owner."""
        offer = await db.videopoker_buy_back_offers.find_one_and_delete({"id": request.offer_id}, projection={"_id": 0})
        if not offer:
            raise HTTPException(status_code=404, detail="Offer not found or already claimed")
        if offer.get("to_user_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="Not your offer")
        expires = offer.get("expires_at")
        if expires:
            try:
                if datetime.fromisoformat(expires.replace("Z", "+00:00")) < datetime.now(timezone.utc):
                    raise HTTPException(status_code=400, detail="Offer expired")
            except Exception:
                pass
        city = offer.get("city")
        from_owner_id = offer.get("from_owner_id")
        points_offered = int(offer.get("points_offered") or 0)
        if not city or not from_owner_id:
            raise HTTPException(status_code=400, detail="Invalid offer")
        from_user = await db.users.find_one({"id": from_owner_id}, {"_id": 0, "points": 1, "username": 1})
        if not from_user:
            raise HTTPException(status_code=400, detail="Previous owner not found")
        await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"points": points_offered}})
        await log_casino_buyback_credit_points(
            current_user.get("id") or "",
            points_offered,
            "casino_video_poker",
            request.offer_id,
            {"city": city},
        )
        await db.videopoker_ownership.update_one(
            {"city": city},
            {
                "$set": {"owner_id": from_owner_id, "owner_username": from_user.get("username"), "max_bet": 0, "buy_back_reward": 0, "buy_back_points_held": 0},
                "$unset": {"below_capo_acquired_at": ""},
            },
        )
        cnorm = _normalize_city(str(city or "").strip()) if city else ""
        await cancel_quicktrade_casino_listings_by_locations("casino_videopoker", city, cnorm or None)
        _invalidate_ownership_cache(current_user.get("id") or "")
        _invalidate_ownership_cache(from_owner_id)
        await resolve_gambling_log_buy_back(request.offer_id, "accepted", points_offered)
        return {"message": "Accepted. You received the points and the table was returned to the previous owner."}

    @router.post("/casino/videopoker/buy-back/reject")
    async def casino_videopoker_buy_back_reject(
        request: VideoPokerBuyBackRejectRequest,
        req: Request,
        current_user: dict = Depends(get_current_user_verified),
    ):
        """Reject a buy-back offer: keep ownership."""
        require_protection_revoke_confirm(current_user, reason="casino_buyback_reject", request=req)
        offer = await db.videopoker_buy_back_offers.find_one({"id": request.offer_id}, {"_id": 0, "to_user_id": 1, "from_owner_id": 1, "points_offered": 1, "city": 1})
        if not offer or offer.get("to_user_id") != current_user.get("id") or "":
            raise HTTPException(status_code=404, detail="Offer not found")
        await db.videopoker_buy_back_offers.delete_one({"id": request.offer_id})
        await refund_casino_buy_back_escrow_points(
            str(offer.get("from_owner_id") or ""),
            int(offer.get("points_offered") or 0),
            event_type="casino_video_poker",
            meta={"city": offer.get("city"), "offer_id": request.offer_id, "reason": "reject"},
        )
        _invalidate_ownership_cache(current_user.get("id") or "")
        await resolve_gambling_log_buy_back(request.offer_id, "rejected", 0)
        await maybe_revoke_civilian_protection(db, current_user.get("id") or "", "casino_buyback_reject")
        return {"message": "Rejected. You keep the table."}

    @router.post("/casino/videopoker/send-to-user")
    async def casino_videopoker_send_to_user(request: RouletteSendToUserRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        target_username_pattern = _username_pattern(request.target_username.strip())
        target = await db.users.find_one({"username": target_username_pattern}, {"_id": 0, "id": 1, "username": 1, "rank_points": 1, "is_dead": 1})
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        raise_if_dead_casino_transfer_target(target)
        await raise_if_civilian_protected_asset_recipient(db, target.get("id"))
        await raise_if_single_casino_receive_blocked(target)
        held = int((doc or {}).get("buy_back_points_held") or 0)
        await refund_casino_buy_back_escrow_points(
            current_user.get("id") or "",
            held,
            event_type="casino_video_poker",
            meta={"city": stored_city or city, "reason": "send_to_user"},
        )
        await refund_and_delete_buy_back_offers_matching(
            "videopoker_buy_back_offers",
            {"city": stored_city or city},
            points_event_type="casino_video_poker",
            meta_base={"city": stored_city or city, "reason": "send_to_user"},
        )
        send_set = {
            "owner_id": target.get("id") or "",
            "owner_username": target.get("username"),
            "max_bet": CASINO_MIN_OWNER_MAX_BET,
            "buy_back_reward": 0,
            "buy_back_points_held": 0,
        }
        tgt_rank = get_rank_info(target.get("rank_points", 0), user_prestige_rank_mult(target))[0]
        await db.videopoker_ownership.update_one(
            {"city": stored_city or city},
            casino_ownership_write_below_capo_ops(send_set, new_owner_rank_id=tgt_rank),
        )
        await cancel_quicktrade_casino_listings_by_locations("casino_videopoker", stored_city or city, city)
        _invalidate_ownership_cache(target.get("id") or "")
        await maybe_revoke_civilian_protection(db, target.get("id") or "", "received_casino_transfer")
        loc = stored_city or city
        sender_name = (current_user.get("username") or "").strip() or "?"
        await send_notification(
            target.get("id") or "",
            "Casino transferred",
            f"{sender_name} sent you the video poker table in {loc}.",
            "reward",
        )
        return {"message": "Ownership transferred."}

    @router.post("/casino/videopoker/sell-on-trade")
    async def casino_videopoker_sell_on_trade(request: DiceSellOnTradeRequest, current_user: dict = Depends(get_current_user_verified)):
        _invalidate_ownership_cache(current_user.get("id") or "")
        city = _normalize_city((request.city or "").strip())
        if not city or city not in STATES:
            raise HTTPException(status_code=400, detail="Invalid city")
        if request.points <= 0:
            raise HTTPException(status_code=400, detail="Points must be positive")
        stored_city, doc = await _get_ownership_doc(city)
        if not doc or doc.get("owner_id") != current_user.get("id") or "":
            raise HTTPException(status_code=403, detail="You do not own this table")
        assert_casino_clear_of_buy_back_for_listing(doc)
        await ensure_no_duplicate_casino_quicktrade_listing(
            "casino_videopoker", city, current_user.get("id") or ""
        )
        listing_id = ObjectId()
        casino_property = {
            "_id": listing_id,
            "id": str(listing_id),
            "type": "casino_videopoker",
            "location": city,
            "name": f"Video Poker Table ({city})",
            "owner_id": current_user.get("id") or "",
            "owner_username": current_user.get("username", "Unknown"),
            "for_sale": True,
            "sale_price": request.points,
            "created_at": datetime.now(timezone.utc),
        }
        await db.properties.insert_one(casino_property)
        return {"message": f"Video Poker table listed for {request.points:,} points on Quick Trade"}

    @router.get("/casino/videopoker/game", dependencies=_casinos_rl_u)
    async def casino_videopoker_game(current_user: dict = Depends(get_current_user_verified)):
        """Get the current active game (if any) for page refresh."""
        game = await db.videopoker_games.find_one({"user_id": current_user.get("id") or ""}, {"_id": 0, "deck": 0})
        if not game:
            return {"active": False}
        odds_preset = _normalize_odds_preset(game.get("odds_preset") or VIDEO_POKER_DEFAULT_ODDS_PRESET)
        pay_table = _pay_table_for_preset(odds_preset)
        hand = game.get("hand") or []
        gk, gname, gmult = _evaluate_hand(hand, pay_table)
        return {
            "active": True,
            "bet": game.get("bet"),
            "hand": hand,
            "status": game.get("status", "deal"),
            "odds_preset": odds_preset,
            "hand_key": gk,
            "hand_name": gname,
            "multiplier": gmult,
        }

    @router.post("/casino/videopoker/deal")
    async def casino_videopoker_deal(request: VideoPokerDealRequest, current_user: dict = Depends(get_current_user_verified)):
        raise_if_gambling_self_banned(current_user)
        _invalidate_ownership_cache(current_user.get("id") or "")
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        city = _normalize_city(raw) if raw else (STATES[0] if STATES else "")
        if not city:
            raise HTTPException(status_code=400, detail="No current city")
        stored_city, doc = await _get_ownership_doc(city)
        raw_owner = doc.get("owner_id") if doc else None
        owner_id = casino_economy_owner_id(raw_owner)
        oid = (str(raw_owner).strip() or None) if raw_owner is not None else None
        max_bet = effective_public_casino_max_bet(
            oid,
            doc.get("max_bet") if doc else None,
            default_when_owned_positive=VIDEO_POKER_DEFAULT_MAX_BET,
        )
        if owner_id and owner_id == current_user.get("id"):
            raise HTTPException(status_code=400, detail="You cannot play at your own table")
        bet = max(0, int(request.bet))
        if bet <= 0:
            raise HTTPException(status_code=400, detail="Bet must be positive")
        if bet > max_bet:
            raise HTTPException(status_code=400, detail=f"Bet exceeds max ${max_bet:,}")
        debit_res = await db.users.find_one_and_update(
            {"id": current_user.get("id") or "", "money": {"$gte": bet}},
            {"$inc": {"money": -bet}},
        )
        if not debit_res:
            raise HTTPException(status_code=400, detail="Not enough money")
        existing = await db.videopoker_games.find_one({"user_id": current_user.get("id") or ""})
        if existing:
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": bet}})
            raise HTTPException(status_code=400, detail="Finish your current game first")
        odds_preset = _effective_odds_preset(doc)
        pay_table = _pay_table_for_preset(odds_preset)
        deck = _make_deck()
        hand = _vp_deal_initial_hand(deck, odds_preset, pay_table)
        if owner_id:
            await db.users.update_one({"id": owner_id}, {"$inc": {"money": bet}})
        await db.videopoker_games.insert_one({
            "user_id": current_user.get("id") or "",
            "city": stored_city or city,
            "bet": bet,
            "hand": hand,
            "deck": deck,
            "status": "deal",
            "owner_id": owner_id,
            "odds_preset": odds_preset,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        dk, dname, dmult = _evaluate_hand(hand, pay_table)
        return {
            "status": "deal",
            "bet": bet,
            "hand": hand,
            "odds_preset": odds_preset,
            "hand_key": dk,
            "hand_name": dname,
            "multiplier": dmult,
        }

    @router.post("/casino/videopoker/draw")
    async def casino_videopoker_draw(request: VideoPokerDrawRequest, current_user: dict = Depends(get_current_user_verified)):
        raise_if_gambling_self_banned(current_user)
        _invalidate_ownership_cache(current_user.get("id") or "")
        game = await db.videopoker_games.find_one_and_delete(
            {"user_id": current_user.get("id") or "", "status": "deal"}
        )
        if not game:
            raise HTTPException(status_code=400, detail="No active game or already settled")
        deck = list(game.get("deck") or [])
        hand = list(game.get("hand") or [])
        bet = game.get("bet", 0)
        owner_id = game.get("owner_id")
        city = str(game.get("city") or "").strip()
        # Match claim/reset/dice: ownership rows use the canonical city string from DB; never $inc on a filter that misses.
        stored_own_city, _ = await _get_ownership_doc(city)
        ownership_city = (stored_own_city or city).strip() or city
        odds_preset = game.get("odds_preset") or VIDEO_POKER_DEFAULT_ODDS_PRESET
        odds_preset = _normalize_odds_preset(odds_preset)
        pay_table = _pay_table_for_preset(odds_preset)

        holds = set()
        for h in (request.holds or []):
            try:
                idx = int(h)
            except (TypeError, ValueError):
                continue
            if 0 <= idx <= 4:
                holds.add(idx)

        hand = _vp_draw_biased_hand(hand, holds, deck, odds_preset, pay_table)
        hand_key, _, multiplier = _evaluate_hand(hand, pay_table)
        hand_name = HAND_NAMES.get(hand_key, hand_key)
        payout = _payout_for_multiplier(bet, multiplier)
        payout_full_vp = 0
        gambling_extra = None
        ownership_transferred = False
        buy_back_offer = None
        actual_payout = 0
        shortfall = 0
        points_offered = 0

        user = await db.users.find_one({"id": current_user.get("id") or ""})
        if payout == 0:
            head_family_id = await get_head_family_id_for_state(city) if city else None
            if owner_id:
                if head_family_id:
                    edge_lose = int(bet * VIDEO_POKER_HOUSE_EDGE)
                    if edge_lose > 0:
                        el_tr = state_head_casino_treasury_share(edge_lose)
                        if el_tr > 0:
                            await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": el_tr, "state_head_income.videopoker": el_tr}})
                    await db.users.update_one({"id": owner_id}, {"$inc": {"money": -edge_lose}})
                    net = max(0, bet - edge_lose)
                    _vp_own_res = await db.videopoker_ownership.update_one(
                        {"city": ownership_city}, {"$inc": {"total_earnings": net, "profit": net}}
                    )
                    if owner_id and _vp_own_res.matched_count == 0:
                        logger.warning(
                            "videopoker draw: ownership P/L update missed (loss+edge) city=%r ownership_city=%r owner_id=%s",
                            city,
                            ownership_city,
                            owner_id,
                        )
                    _invalidate_ownership_cache(owner_id)
                else:
                    _vp_own_res = await db.videopoker_ownership.update_one(
                        {"city": ownership_city}, {"$inc": {"total_earnings": bet, "profit": bet}}
                    )
                    if owner_id and _vp_own_res.matched_count == 0:
                        logger.warning(
                            "videopoker draw: ownership P/L update missed (loss no edge) city=%r ownership_city=%r owner_id=%s",
                            city,
                            ownership_city,
                            owner_id,
                        )
                    _invalidate_ownership_cache(owner_id)
            elif head_family_id:
                edge_lose = int(bet * VIDEO_POKER_HOUSE_EDGE)
                if edge_lose > 0:
                    el_tr = state_head_casino_treasury_share(edge_lose)
                    if el_tr > 0:
                        await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": el_tr, "state_head_income.videopoker": el_tr}})
        elif payout == bet:
            if owner_id:
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": -bet}})
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": payout}})
        else:
            profit_portion = payout - bet
            payout_full_vp = payout
            if owner_id:
                owner_doc = await db.videopoker_ownership.find_one({"city": city}, {"_id": 0, "buy_back_reward": 1})
                points_offered = int((owner_doc or {}).get("buy_back_reward") or 0)
                owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "money": 1, "username": 1})
                owner_money = int(((owner or {}).get("money") or 0) or 0)
                owner_username = (owner or {}).get("username")
                actual_payout = min(payout, owner_money)
                shortfall = payout - actual_payout
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": actual_payout}})
                await db.users.update_one({"id": owner_id}, {"$inc": {"money": -actual_payout, "total_casino_payouts": actual_payout}})
                # Track biggest payout for owner
                await bump_user_biggest_casino_payout(owner_id, actual_payout)
                vp_net = bet - actual_payout
                _vp_own_res = await db.videopoker_ownership.update_one(
                    {"city": ownership_city}, {"$inc": {"profit": vp_net, "total_earnings": vp_net}}
                )
                if _vp_own_res.matched_count == 0:
                    logger.warning(
                        "videopoker draw: ownership P/L update missed (payout) city=%r ownership_city=%r owner_id=%s vp_net=%s",
                        city,
                        ownership_city,
                        owner_id,
                        vp_net,
                    )
                _invalidate_ownership_cache(owner_id)
                payout = actual_payout
                if shortfall > 0:
                    ownership_transferred = True
                    vp_owner_set = {
                        "owner_id": current_user.get("id") or "",
                        "owner_username": current_user.get("username") or "",
                        "buy_back_reward": 0,
                        "buy_back_points_held": 0,
                    }
                    seiz_rank = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))[0]
                    await db.videopoker_ownership.update_one(
                        {"city": ownership_city},
                        casino_ownership_write_below_capo_ops(vp_owner_set, new_owner_rank_id=seiz_rank),
                    )
                    vp_norm = _normalize_city(str(city or "").strip()) if city else ""
                    await cancel_quicktrade_casino_listings_by_locations("casino_videopoker", city, vp_norm or None)
                    # Track casino won/lost stats
                    await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"casinos_seized": 1}})
                    await db.users.update_one({"id": owner_id}, {"$inc": {"casinos_lost": 1}})
                    await notify_casino_seizure(
                        former_owner_id=owner_id,
                        former_owner_username=owner_username,
                        winner_user_id=current_user.get("id") or "",
                        winner_username=current_user.get("username") or "?",
                        venue_label="video poker",
                        location_label=city,
                        full_payout_to_winner=payout_full_vp,
                        actual_payout_to_winner=actual_payout,
                        shortfall=shortfall,
                        buy_back_points=points_offered,
                    )
                    if points_offered <= 0:
                        head_family_id = await get_head_family_id_for_state(city) if city else None
                        if head_family_id:
                            edge_lose = int(bet * VIDEO_POKER_HOUSE_EDGE)
                            if edge_lose > 0:
                                el_tr = state_head_casino_treasury_share(edge_lose)
                                if el_tr > 0:
                                    await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": el_tr, "state_head_income.videopoker": el_tr}})
                    else:
                        # Create buyback offer
                        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
                        offer_id = str(uuid.uuid4())
                        buy_back_doc = {
                            "id": offer_id,
                            "city": city,
                            "from_owner_id": owner_id,
                            "from_owner_username": owner_username,
                            "to_user_id": current_user.get("id") or "",
                            "to_username": current_user.get("username"),
                            "points_offered": points_offered,
                            "amount_shortfall": shortfall,
                            "owner_paid": actual_payout,
                            "expires_at": expires_at,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }
                        await db.videopoker_buy_back_offers.insert_one(buy_back_doc)
                        buy_back_offer = {"offer_id": offer_id, "points_offered": points_offered, "amount_shortfall": shortfall, "owner_paid": actual_payout, "expires_at": expires_at}
            else:
                head_family_id = await get_head_family_id_for_state(city) if city else None
                if head_family_id and profit_portion > 0:
                    edge = int(profit_portion * VIDEO_POKER_HOUSE_EDGE)
                    if edge > 0:
                        edge_tc = state_head_casino_treasury_share(edge)
                        if edge_tc > 0:
                            await db.families.update_one({"id": head_family_id}, {"$inc": {"treasury": edge_tc, "state_head_income.videopoker": edge_tc}})
                    payout = bet + profit_portion - edge
                await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": payout}})

        updated_user = await db.users.find_one({"id": current_user.get("id") or ""})
        new_balance = (updated_user.get("money", 0) or 0)

        if payout_full_vp > bet and owner_id:
            gambling_extra = {
                "payout": payout_full_vp,
                "actual_payout": actual_payout,
                "shortfall": shortfall,
                "ownership_transferred": ownership_transferred,
            }
            if ownership_transferred:
                if buy_back_offer and buy_back_offer.get("offer_id"):
                    gambling_extra["buy_back_offer_id"] = buy_back_offer["offer_id"]
                    gambling_extra["buy_back_points_offered"] = points_offered
                    gambling_extra["buy_back_outcome"] = "pending"
                else:
                    gambling_extra["buy_back_points_offered"] = 0
                    gambling_extra["buy_back_outcome"] = "not_offered"

        await _settle_and_save_history(
            current_user.get("id") or "",
            current_user.get("username"),
            city,
            bet,
            hand_key,
            hand_name,
            payout,
            hand,
            gambling_extra,
            odds_preset=odds_preset,
        )

        result = {
            "status": "done",
            "bet": bet,
            "hand": hand,
            "hand_key": hand_key,
            "hand_name": hand_name,
            "multiplier": multiplier,
            "payout": payout,
            "new_balance": new_balance,
            "shortfall": shortfall,
            "odds_preset": odds_preset,
        }
        # Add buyback info if ownership was transferred
        if owner_id and payout > bet and shortfall > 0:
            result["ownership_transferred"] = ownership_transferred
            result["buy_back_offer"] = buy_back_offer
        return result

    @router.get("/casino/videopoker/history", dependencies=_casinos_rl_u)
    async def casino_videopoker_history(current_user: dict = Depends(get_current_user_verified)):
        user = await db.users.find_one({"id": current_user.get("id") or ""}, {"_id": 0, "videopoker_history": 1})
        history = (user.get("videopoker_history") or [])[:VIDEO_POKER_HISTORY_MAX]
        return {"history": history}
