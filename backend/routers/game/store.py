# Store endpoints: rank bar, silencer, OC timer, garage batch, booze capacity, bullets, custom car, send points
import logging
from datetime import date, datetime, timezone
from typing import Optional
import uuid

logger = logging.getLogger(__name__)
from pydantic import BaseModel, field_validator

from fastapi import Depends, HTTPException, Query, Request

from utils.game_timezone import game_today_date_str
from utils.profanity import contains_profanity


def _normalize_store_pay_with(pay_with: str) -> str:
    v = (str(pay_with or "auto")).strip().lower()
    if v in ("points", "respect", "auto"):
        return v
    raise HTTPException(status_code=400, detail="pay_with must be 'points' or 'respect'")


def _store_respect_cost_for_points(k: int) -> int:
    """Respect spent to cover k 'points' of store price using respect (+35% vs old 5*k: ceil(6.75*k))."""
    k = int(k)
    if k <= 0:
        return 0
    return (k * 27 + 3) // 4


def _store_max_points_coverable_by_respect(respect_balance: int, points_cost: int) -> int:
    """Largest k in [0, points_cost] with _store_respect_cost_for_points(k) <= respect_balance."""
    r = int(respect_balance)
    p = int(points_cost)
    if r <= 0 or p <= 0:
        return 0
    return min(p, (4 * r) // 27)


def _store_cost_inc(current_user: dict, points_cost: int, pay_with: str = "auto"):
    """Return (cost_used, $inc dict, $gte filter dict) for atomic store purchases.
    Uses respect first at ceil(6.75 respect per point of price) vs old 5:1, then points for the remainder.
    Returns (None, None, None) if insufficient funds."""
    mode = _normalize_store_pay_with(pay_with)
    respect_balance = int(current_user.get("respect_points") or 0)
    points_balance = int(current_user.get("points") or 0)
    if mode == "points":
        if points_balance < points_cost:
            return None, None, None
        respect_decrement = 0
        points_decrement = points_cost
    elif mode == "respect":
        respect_decrement = _store_respect_cost_for_points(points_cost)
        if respect_balance < respect_decrement:
            return None, None, None
        points_decrement = 0
    else:
        use_respect_equiv = _store_max_points_coverable_by_respect(respect_balance, points_cost)
        respect_decrement = _store_respect_cost_for_points(use_respect_equiv)
        points_decrement = points_cost - use_respect_equiv
        if points_balance < points_decrement:
            return None, None, None
    inc = {}
    gte = {}
    if respect_decrement > 0:
        inc["respect_points"] = -respect_decrement
        inc["lifetime_respect_points_spent"] = respect_decrement
        gte["respect_points"] = {"$gte": respect_decrement}
    if points_decrement > 0:
        inc["points"] = -points_decrement
        inc["lifetime_points_spent"] = points_decrement
        gte["points"] = {"$gte": points_decrement}
    return points_cost, inc, gte


from server import (
    db,
    get_current_user,
    get_current_user_verified,
    log_activity,
    log_respect_delta,
    send_notification,
    _username_pattern,
    require_admin,
    DEFAULT_GARAGE_BATCH_LIMIT,
    GARAGE_BATCH_UPGRADE_COST,
    GARAGE_BATCH_UPGRADE_INCREMENT,
    GARAGE_BATCH_LIMIT_MAX,
)
from routers.money.booze_run import (
    _booze_user_capacity,
    _invalidate_config_cache as _invalidate_booze_config_cache,
    BOOZE_CAPACITY_UPGRADE_COST,
    BOOZE_CAPACITY_UPGRADE_AMOUNT,
    BOOZE_CAPACITY_BONUS_MAX,
)
from routers.admin.airport import _invalidate_travel_info_cache
from utils.point_provenance import (
    consume_points_fifo,
    log_points_event,
    mint_store_points_cash_lot_if_missing,
    mint_transfer_in_lots,
)
from utils.store_points_cash import (
    POINTS_CASH_MIN_PRESTIGE_LEVEL,
    POINTS_CASH_MIN_PRICE_PER_POINT,
    POINTS_CASH_MONTHLY_LIMIT,
    STORE_POINTS_CASH_EMAIL_MONTHLY,
    STORE_POINTS_CASH_IP_MONTHLY,
    points_cash_prestige_eligible,
    cap_allowance_summary,
    client_ip_from_request,
    increment_email_cap,
    increment_ip_cap,
    record_store_cash_purchase,
    rollback_cap,
    verified_email_for_user,
)
from utils.store_purchase_audit import record_store_points_purchase_log
from utils.store_qt_cash_price import QT_CASH_AVG_SELL_OFFER_COUNT, qt_cash_price_per_point
from utils.game_timezone import game_month_start_date_str
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_STORE
from utils.transfer_display import redact_quicktrade_party_names
from utils.founding_member import (
    FOUNDING_MEMBER_BADGE,
    FOUNDING_MEMBER_COST_POINTS,
    FOUNDING_MEMBER_STORE_REF,
    user_has_founding_member,
)
from utils.store_item_flags import (
    get_store_item_flags,
    normalize_store_item_flags,
    store_flag_for_token_type,
    require_store_item_allowed,
    PHASE1_STORE_ITEM_FLAGS,
    STORE_ITEM_FLAG_DEFAULTS,
)
from utils.profile_cosmetics import (
    CUSTOM_PROFILE_BADGE,
    CUSTOM_PROFILE_BADGE_COST_POINTS,
    PROFILE_GLOW_7D_COST_POINTS,
    PROFILE_GLOW_PERMANENT_COST_POINTS,
    PROFILE_GLOW_PRESETS,
    sanitize_glow_preset,
    user_has_custom_profile_badge,
    profile_cosmetic_active,
)

FAMILY_CREST_UPGRADE_COST_POINTS = 1500
FAMILY_SAFE_DEPOSIT_TIER_COST_POINTS = 600
FAMILY_SAFE_DEPOSIT_CAP_PER_TIER = 50_000_000
FAMILY_SAFE_DEPOSIT_MAX_TIERS = 3
FAMILY_EVENT_TOKEN_COST_POINTS = 250
FAMILY_EVENT_DURATION_DAYS = 3
FAMILY_EVENT_COOLDOWN_DAYS = 7


async def _store_points_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_STORE)


_store_points_rl_u = [Depends(_store_points_sustained_rl_user)]

# Store-only constants
SILENCER_COST_POINTS = 150
ANTI_SNITCH_COST_POINTS = 120
OC_TIMER_COST_POINTS = 300
CREW_OC_TIMER_COST_POINTS = 350  # Family Crew OC: 6h cooldown instead of 8h
AUTO_RANK_COST_POINTS = 5000  # Auto Rank: auto-commit crimes + GTAs, results to Telegram
ROBOT_BG_AUTO_SEARCH_COST_POINTS = 10_000  # 30-day auto-search for owned robot bodyguards on Attack page
ARMOUR_POINT_STORE_COST_POINTS = 500  # Elite Composite Battledress (armour level 6)
WEAPON_POINT_STORE_COST_POINTS = 1000  # Engraved Lewis Gun (weapon11)
# Per 2h token: 8 tokens cost the same points as permanent unlock but only stack 16h — not a cheap bypass
AUTO_RANK_2H_TOKEN_STORE_POINTS = (AUTO_RANK_COST_POINTS + 7) // 8
# Crew OC auto-apply (3h): same points price as jailbust_bonus (store parity).
CREW_OC_AUTO_3H_TOKEN_STORE_POINTS = 48
BULLET_PACKS = {5000: 100, 10000: 175, 50000: 775, 100000: 1525}  # 5k→100, 10k→175, +75 per 5k
CUSTOM_BULLETS_MAX = 250_000


def _bullet_cost(bullets: int) -> int:
    """Cost in points for any bullets 1–CUSTOM_BULLETS_MAX. Linear scaling: ~0.02 pts/bullet below 5k, 0.015 pts/bullet above 5k."""
    if bullets < 1 or bullets > CUSTOM_BULLETS_MAX:
        raise ValueError(f"Bullets must be 1–{CUSTOM_BULLETS_MAX:,}")
    if bullets < 5000:
        return max(1, int(bullets * 0.02))
    import math
    return 100 + math.ceil((bullets - 5000) * 75 / 5000)
CUSTOM_CAR_COST = 500
BUY_HEALTH_COST_POINTS = 15
FULL_HEALTH = 100


async def _record_store_points_spend(
    current_user: dict,
    inc: dict,
    event_ref: str,
    *,
    cost_used: int = 0,
    extra: Optional[dict] = None,
):
    """FIFO point lots for store + respect_events row when part of price was paid in respect (admin audit)."""
    user_id = current_user["id"]
    spend_points = max(0, int(-(inc or {}).get("points", 0)))
    if spend_points > 0:
        try:
            await consume_points_fifo(
                db,
                user_id=user_id,
                points=spend_points,
                event_type="spend_store",
                event_ref=event_ref,
                meta={"source": "store"},
                assume_balance_already_decremented_by=spend_points,
            )
        except Exception:
            logger.exception("point provenance spend failed user_id=%s event_ref=%s", user_id, event_ref)
    rp_delta = int((inc or {}).get("respect_points") or 0)
    if rp_delta < 0:
        try:
            await log_respect_delta(user_id, rp_delta, f"store:{event_ref}")
        except Exception:
            logger.exception("respect audit log failed user_id=%s event_ref=%s", user_id, event_ref)
    try:
        await record_store_points_purchase_log(
            db,
            current_user,
            event_ref,
            inc,
            cost_points=int(cost_used or 0),
            extra=extra,
        )
    except Exception:
        logger.exception("store points purchase audit log failed user_id=%s event_ref=%s", user_id, event_ref)


async def _rollback_transfer_out_slices(sender_id: str, transfer_id: str, slices: list):
    """Best-effort rollback when transfer provenance fails after sender deduction."""
    if not sender_id or not slices:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    for sl in slices:
        lot_id = sl.get("from_lot_id")
        amt = int(sl.get("amount") or 0)
        if not lot_id or amt <= 0:
            continue
        await db.point_lots.update_one(
            {"id": lot_id},
            {"$inc": {"remaining_points": amt}, "$set": {"updated_at": now_iso}},
        )
        await db.point_ledger_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "event_type": "transfer_out_rollback",
                "user_id": sender_id,
                "points": amt,
                "lot_id": lot_id,
                "origin_ref": transfer_id,
                "root_purchase_ref": sl.get("root_purchase_ref"),
                "meta": {"reason": "mint_transfer_in_failed"},
                "created_at": now_iso,
            }
        )


class CustomCarPurchase(BaseModel):
    car_name: str


class SendPointsRequest(BaseModel):
    to_username: str
    amount: int

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v):
        if v is None or v < 1:
            raise ValueError("Amount must be at least 1")
        return v


# Consumable tokens — prices above typical safe/loot EV; must match armoury.TOKEN_CONFIG keys
TOKEN_STORE_UNIT_PRICE_POINTS = {
    "xp_crimes": 42,
    "xp_gta": 42,
    "melt": 42,
    "oc_reduced": 42,
    "booze": 42,
    "racket": 42,
    "properties": 48,
    "travel": 55,
    "jailbust_bonus": 48,
    "auto_rank_2h": AUTO_RANK_2H_TOKEN_STORE_POINTS,
    "crew_oc_auto_3h": CREW_OC_AUTO_3H_TOKEN_STORE_POINTS,
    "auto_collect_12h": 85,
    "auto_collect_24h": 150,
    "jail_bailout": 25,
    "cooldown_skip_crime": 35,
    "cooldown_skip_gta": 35,
    "cooldown_skip_booze": 35,
    "cooldown_skip_properties": 35,
}
# Store-only count tokens (not activated via Armoury)
STORE_COUNT_ONLY_TOKEN_FIELDS = {
    "jail_bailout": "jail_bailout_tokens",
}
# bundle_id -> points cost, { count_field: amount }
TOKEN_STORE_BUNDLES = {
    "grinder": (75, {"xp_crimes_tokens": 1, "xp_gta_tokens": 1}),
    "racket_runner": (78, {"racket_tokens": 1, "booze_tokens": 1}),
    "builder": (100, {"travel_tokens": 1, "properties_tokens": 1}),
}
TOKEN_SELECTABLE_BUNDLE_SIZE = 10
TOKEN_SELECTABLE_BUNDLE_DISCOUNT_PCT = 20
TOKEN_SELECTABLE_BUNDLE_DISALLOWED = frozenset({"rank_xp_pass", "crew_oc_auto_3h"})
SHOOTING_RANGE_BONUS_STEP = 2
SHOOTING_RANGE_BONUS_COST_POINTS = 85
SHOOTING_RANGE_BONUS_CAP = 10  # must match armoury.SHOOTING_RANGE_BONUS_STORE_MAX
HITLIST_NPC_BONUS_SLOTS_BASE = 3
HITLIST_NPC_BONUS_SLOTS_CAP = 3  # +3 -> max 6 practice NPCs on board at once


def _hitlist_npc_bonus_slot_cost(next_bonus_slot: int) -> int:
    """Cost for next store slot: +1st bonus=100, +2nd=200, +3rd=300."""
    return max(1, int(next_bonus_slot) * 100)


class BuyStoreTokenBody(BaseModel):
    token_type: str
    amount: int = 1

    @field_validator("amount")
    @classmethod
    def amount_ok(cls, v):
        if v is None or v < 1 or v > 3:
            raise ValueError("amount must be 1–3")
        return v


class ProfileGlowPurchaseBody(BaseModel):
    preset_id: str = "violet"


class BuyStoreTokenBundleBody(BaseModel):
    bundle_id: str


class BuyStoreSelectableTokenBundleBody(BaseModel):
    selections: dict[str, int]


class BuyPointsCashBody(BaseModel):
    points: int

    @field_validator("points")
    @classmethod
    def points_ok(cls, v):
        if v is None or int(v) < 1:
            raise ValueError("points must be at least 1")
        return int(v)


def _normalize_selectable_bundle_entries(selections: dict) -> dict[str, int]:
    if not isinstance(selections, dict):
        raise HTTPException(status_code=400, detail="selections must be an object of token_type: quantity")
    out: dict[str, int] = {}
    for raw_tt, raw_qty in selections.items():
        tt = str(raw_tt or "").strip()
        if not tt:
            continue
        try:
            qty = int(raw_qty)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid quantity for {tt}")
        if qty <= 0:
            continue
        out[tt] = out.get(tt, 0) + qty
    return out


def _validate_selectable_bundle_purchase(current_user: dict, selections: dict, token_config: dict) -> tuple[list[dict], int, int]:
    norm = _normalize_selectable_bundle_entries(selections)
    total_qty = sum(norm.values())
    if total_qty != TOKEN_SELECTABLE_BUNDLE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Selectable bundle must contain exactly {TOKEN_SELECTABLE_BUNDLE_SIZE} tokens.",
        )
    if not norm:
        raise HTTPException(status_code=400, detail="No tokens selected")
    entries: list[dict] = []
    subtotal_pts = 0
    for tt, qty in norm.items():
        if tt in TOKEN_SELECTABLE_BUNDLE_DISALLOWED:
            raise HTTPException(status_code=400, detail=f"{tt} cannot be included in selectable bundles")
        if tt not in token_config:
            raise HTTPException(status_code=400, detail=f"Invalid token_type: {tt}")
        if tt not in TOKEN_STORE_UNIT_PRICE_POINTS:
            raise HTTPException(status_code=400, detail=f"This token type is not sold in the store: {tt}")
        cfg = token_config[tt]
        cf = cfg["count_field"]
        unit = int(TOKEN_STORE_UNIT_PRICE_POINTS[tt])
        subtotal_pts += unit * qty
        entries.append({"token_type": tt, "count_field": cf, "qty": qty, "unit_price": unit})
    discount_pts = (subtotal_pts * TOKEN_SELECTABLE_BUNDLE_DISCOUNT_PCT) // 100
    final_cost_pts = max(1, subtotal_pts - discount_pts)
    return entries, subtotal_pts, final_cost_pts


async def buy_premium_rank_bar(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("premium_rank_bar", False):
        raise HTTPException(status_code=400, detail="You already own the premium rank bar")
    cost = 50
    cost_used, inc, gte_filter = _store_cost_inc(current_user, cost, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc, "$set": {"premium_rank_bar": True}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(current_user, inc, "buy-rank-bar", cost_used=cost_used)
    await log_activity(current_user["id"], current_user.get("username", "?"), "store_purchase", {"item": "premium_rank_bar", "cost": cost_used})
    return {"message": "Premium rank bar purchased!", "cost": cost_used}


async def buy_silencer(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("has_silencer", False):
        raise HTTPException(status_code=400, detail="You already own a silencer")
    cost_used, inc, gte_filter = _store_cost_inc(current_user, SILENCER_COST_POINTS, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    owned = await db.user_weapons.find_one({"user_id": current_user["id"], "quantity": {"$gt": 0}}, {"_id": 0})
    if not owned:
        raise HTTPException(status_code=400, detail="You need at least one weapon to use a silencer")
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc, "$set": {"has_silencer": True}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(current_user, inc, "buy-silencer", cost_used=cost_used)
    return {"message": "Silencer purchased! Fewer witness statements will go out when you kill.", "cost": cost_used}


async def buy_anti_snitch(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    """Purchase Anti Snitch: you cannot be snitched on by other players in jail."""
    if current_user.get("anti_snitch", False):
        raise HTTPException(status_code=400, detail="You already have Anti Snitch")
    cost_used, inc, gte_filter = _store_cost_inc(current_user, ANTI_SNITCH_COST_POINTS, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc, "$set": {"anti_snitch": True}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(current_user, inc, "buy-anti-snitch", cost_used=cost_used)
    return {"message": "Anti Snitch purchased! You cannot be snitched on.", "cost": cost_used}


async def buy_oc_timer(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("oc_timer_reduced", False):
        raise HTTPException(status_code=400, detail="You already have the reduced OC timer (4h)")
    cost_used, inc, gte_filter = _store_cost_inc(current_user, OC_TIMER_COST_POINTS, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc, "$set": {"oc_timer_reduced": True}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(current_user, inc, "buy-oc-timer", cost_used=cost_used)
    return {"message": "OC timer reduced! Heist cooldown is now 4 hours.", "cost": cost_used}


async def buy_crew_oc_timer(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    """Crew OC (family): when you commit, cooldown is 6h instead of 8h."""
    if current_user.get("crew_oc_timer_reduced", False):
        raise HTTPException(status_code=400, detail="You already have the Crew OC timer (6h)")
    cost_used, inc, gte_filter = _store_cost_inc(current_user, CREW_OC_TIMER_COST_POINTS, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc, "$set": {"crew_oc_timer_reduced": True}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(current_user, inc, "buy-crew-oc-timer", cost_used=cost_used)
    return {"message": "Crew OC timer purchased! When your crew commits, cooldown is 6h instead of 8h (5h with the family −1h perk). Applies while any Don, Underboss, or Capo who can commit holds this upgrade.", "cost": cost_used}


async def upgrade_garage_batch_limit(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    current_limit = current_user.get("garage_batch_limit", DEFAULT_GARAGE_BATCH_LIMIT)
    if current_limit >= GARAGE_BATCH_LIMIT_MAX:
        raise HTTPException(status_code=400, detail="Garage batch limit already maxed")
    cost_used, inc, gte_filter = _store_cost_inc(current_user, GARAGE_BATCH_UPGRADE_COST, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    new_limit = min(GARAGE_BATCH_LIMIT_MAX, current_limit + GARAGE_BATCH_UPGRADE_INCREMENT)
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc, "$set": {"garage_batch_limit": new_limit}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(current_user, inc, "upgrade-garage-batch", cost_used=cost_used)
    return {"message": f"Garage batch limit upgraded to {new_limit}", "new_limit": new_limit, "cost": cost_used}


async def buy_booze_capacity(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    current_bonus = min(current_user.get("booze_capacity_bonus", 0), BOOZE_CAPACITY_BONUS_MAX)
    if current_bonus >= BOOZE_CAPACITY_BONUS_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"Booze capacity bonus is already at the maximum ({BOOZE_CAPACITY_BONUS_MAX})",
        )
    cost_used, inc, gte_filter = _store_cost_inc(current_user, BOOZE_CAPACITY_UPGRADE_COST, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    add_bonus = min(BOOZE_CAPACITY_UPGRADE_AMOUNT, BOOZE_CAPACITY_BONUS_MAX - current_bonus)
    inc["booze_capacity_bonus"] = add_bonus
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(current_user, inc, "buy-booze-capacity", cost_used=cost_used)
    from routers.money.booze_run import _booze_vip_pass_car_owned
    fam_extra = 0
    vip_car = await _booze_vip_pass_car_owned(db, current_user.get("id") or "")
    new_capacity = _booze_user_capacity(
        {**current_user, "booze_capacity_bonus": current_bonus + add_bonus},
        family_cargo_bonus=fam_extra,
        vip_pass_car_owned=vip_car,
    )
    _invalidate_booze_config_cache(current_user["id"])
    return {"message": f"+{add_bonus} booze capacity for {cost_used} points", "new_capacity": new_capacity, "capacity_bonus": current_bonus + add_bonus, "capacity_bonus_max": BOOZE_CAPACITY_BONUS_MAX}


async def store_buy_bullets(
    bullets: int = Query(..., ge=1, le=CUSTOM_BULLETS_MAX),
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    cost = BULLET_PACKS.get(bullets)
    if cost is None:
        if bullets < 1 or bullets > CUSTOM_BULLETS_MAX:
            raise HTTPException(status_code=400, detail=f"Bullets must be 1–{CUSTOM_BULLETS_MAX:,}")
        try:
            cost = _bullet_cost(bullets)
        except ValueError as e:
            logger.exception("store_buy_bullets validation error: %s", e)
            raise HTTPException(status_code=400, detail="Invalid bullet quantity.")
    cost_used, inc, gte_filter = _store_cost_inc(current_user, cost, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    inc["bullets"] = bullets
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(current_user, inc, "buy-bullets", cost_used=cost_used, extra={"bullets": bullets})
    return {"message": f"Bought {bullets:,} bullets for {cost_used} points", "bullets": bullets, "cost": cost_used}


async def buy_auto_rank(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    """Purchase Auto Rank; user enables it themselves on the Auto Rank page. Telegram is optional (for notifications)."""
    if current_user.get("auto_rank_permanent") or (current_user.get("auto_rank_purchased", False) and not current_user.get("auto_rank_trial")):
        raise HTTPException(status_code=400, detail="You already purchased Auto Rank")
    cost_used, inc, gte_filter = _store_cost_inc(current_user, AUTO_RANK_COST_POINTS, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc, "$set": {"auto_rank_purchased": True, "auto_rank_permanent": True, "auto_rank_trial": False}, "$unset": {"auto_rank_trial_until": ""}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(current_user, inc, "buy-auto-rank", cost_used=cost_used)
    try:
        from routers.account.auto_rank import wake_auto_rank_if_idle

        await wake_auto_rank_if_idle(db, current_user["id"])
    except Exception:
        pass
    return {
        "message": "Auto Rank purchased! Go to Auto Rank to enable it and choose which activities to run.",
        "cost": cost_used,
    }


async def buy_founding_member(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    """Founding Member badge (+2.5% core payouts). Account-only — lost on death."""
    if user_has_founding_member(current_user):
        raise HTTPException(status_code=400, detail="You already have the Founding Member badge")
    cost_used, inc, gte_filter = _store_cost_inc(current_user, FOUNDING_MEMBER_COST_POINTS, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    result = await db.users.update_one(
        {"id": current_user["id"], "founding_member": {"$ne": True}, **gte_filter},
        {"$inc": inc, "$set": {"founding_member": True}, "$addToSet": {"badges": FOUNDING_MEMBER_BADGE}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points or you already own this upgrade")
    await _record_store_points_spend(current_user, inc, FOUNDING_MEMBER_STORE_REF, cost_used=cost_used)
    return {
        "message": "Founding Member badge purchased! +2.5% on crimes, GTA, OC, hitlist NPCs, properties, rackets, and missions.",
        "cost": cost_used,
        "founding_member": True,
    }


async def buy_custom_profile_badge(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    await require_store_item_allowed(db, "profile_badge", current_user)
    if user_has_custom_profile_badge(current_user):
        raise HTTPException(status_code=400, detail="You already have the custom profile badge")
    cost_used, inc, gte_filter = _store_cost_inc(current_user, CUSTOM_PROFILE_BADGE_COST_POINTS, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    result = await db.users.update_one(
        {"id": current_user["id"], "custom_profile_badge": {"$ne": True}, **gte_filter},
        {"$inc": inc, "$set": {"custom_profile_badge": True}, "$addToSet": {"badges": CUSTOM_PROFILE_BADGE}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points or you already own this")
    await _record_store_points_spend(current_user, inc, "buy-custom-profile-badge", cost_used=cost_used)
    return {"message": "Custom profile badge purchased! Account-only — lost on death.", "cost": cost_used}


async def buy_profile_glow_7d(
    body: ProfileGlowPurchaseBody,
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    from datetime import timedelta

    await require_store_item_allowed(db, "profile_glow_7d", current_user)
    preset = sanitize_glow_preset(body.preset_id)
    cost_used, inc, gte_filter = _store_cost_inc(current_user, PROFILE_GLOW_7D_COST_POINTS, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    now = datetime.now(timezone.utc)
    existing = current_user.get("profile_cosmetic_until")
    base = now
    if existing and not current_user.get("profile_cosmetic_permanent"):
        try:
            ex = datetime.fromisoformat(str(existing).replace("Z", "+00:00"))
            if ex.tzinfo is None:
                ex = ex.replace(tzinfo=timezone.utc)
            if ex > now:
                base = ex
        except Exception:
            pass
    new_until = (base + timedelta(days=7)).isoformat()
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {
            "$inc": inc,
            "$set": {
                "profile_name_glow_color": preset["color"],
                "profile_border_style": preset["border"],
                "profile_cosmetic_until": new_until,
                "profile_cosmetic_permanent": False,
            },
        },
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(
        current_user, inc, "buy-profile-glow-7d", cost_used=cost_used, extra={"preset_id": preset["id"]},
    )
    return {"message": "Profile glow + border active for 7 days.", "cost": cost_used, "until": new_until}


async def buy_profile_glow_permanent(
    body: ProfileGlowPurchaseBody,
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    await require_store_item_allowed(db, "profile_glow_permanent", current_user)
    if current_user.get("profile_cosmetic_permanent"):
        raise HTTPException(status_code=400, detail="You already have permanent profile cosmetics")
    preset = sanitize_glow_preset(body.preset_id)
    cost_used, inc, gte_filter = _store_cost_inc(current_user, PROFILE_GLOW_PERMANENT_COST_POINTS, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    result = await db.users.update_one(
        {"id": current_user["id"], "profile_cosmetic_permanent": {"$ne": True}, **gte_filter},
        {
            "$inc": inc,
            "$set": {
                "profile_name_glow_color": preset["color"],
                "profile_border_style": preset["border"],
                "profile_cosmetic_permanent": True,
            },
            "$unset": {"profile_cosmetic_until": ""},
        },
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points or already owned")
    await _record_store_points_spend(
        current_user, inc, "buy-profile-glow-permanent", cost_used=cost_used, extra={"preset_id": preset["id"]},
    )
    return {"message": "Permanent profile glow + border purchased!", "cost": cost_used}


def _family_don_guard(current_user: dict) -> str:
    role = (current_user.get("family_role") or "").strip().lower()
    if role not in ("boss", "underboss", "don"):
        raise HTTPException(status_code=403, detail="Only the Don or Underboss can purchase family store items")
    family_id = current_user.get("family_id")
    if not family_id:
        raise HTTPException(status_code=400, detail="Not in a family")
    return family_id


async def buy_family_crest_upgrade(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    await require_store_item_allowed(db, "family_crest_upgrade", current_user)
    family_id = _family_don_guard(current_user)
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "premium_crest_unlocked": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    if fam.get("premium_crest_unlocked"):
        raise HTTPException(status_code=400, detail="Premium crests already unlocked for your family")
    cost_used, inc, gte_filter = _store_cost_inc(current_user, FAMILY_CREST_UPGRADE_COST_POINTS, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    user_result = await db.users.update_one({"id": current_user["id"], **gte_filter}, {"$inc": inc})
    if user_result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    fam_result = await db.families.update_one(
        {"id": family_id, "premium_crest_unlocked": {"$ne": True}},
        {"$set": {"premium_crest_unlocked": True}},
    )
    if fam_result.modified_count == 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": cost_used, "lifetime_points_spent": -inc.get("lifetime_points_spent", 0)}})
        raise HTTPException(status_code=400, detail="Premium crests already unlocked")
    await _record_store_points_spend(current_user, inc, "buy-family-crest-upgrade", cost_used=cost_used)
    return {"message": "Premium family crest presets unlocked for your crew!", "cost": cost_used}


async def buy_family_safe_deposit_tier(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    await require_store_item_allowed(db, "family_safe_deposit", current_user)
    family_id = _family_don_guard(current_user)
    fam = await db.families.find_one({"id": family_id}, {"_id": 0, "safe_deposit_tiers": 1})
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    tiers = int(fam.get("safe_deposit_tiers") or 0)
    if tiers >= FAMILY_SAFE_DEPOSIT_MAX_TIERS:
        raise HTTPException(status_code=400, detail=f"Safe deposit already at max ({FAMILY_SAFE_DEPOSIT_MAX_TIERS} tiers)")
    cost_used, inc, gte_filter = _store_cost_inc(current_user, FAMILY_SAFE_DEPOSIT_TIER_COST_POINTS, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    user_result = await db.users.update_one({"id": current_user["id"], **gte_filter}, {"$inc": inc})
    if user_result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    new_tiers = tiers + 1
    new_cap = new_tiers * FAMILY_SAFE_DEPOSIT_CAP_PER_TIER
    fam_result = await db.families.update_one(
        {"id": family_id, "$or": [{"safe_deposit_tiers": {"$lt": FAMILY_SAFE_DEPOSIT_MAX_TIERS}}, {"safe_deposit_tiers": {"$exists": False}}]},
        {"$set": {"safe_deposit_tiers": new_tiers, "safe_deposit_cap": new_cap}},
    )
    if fam_result.modified_count == 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": cost_used}})
        raise HTTPException(status_code=400, detail="Safe deposit tier purchase failed")
    await _record_store_points_spend(current_user, inc, "buy-family-safe-deposit-tier", cost_used=cost_used, extra={"tier": new_tiers})
    return {"message": f"Safe deposit cap increased to ${new_cap:,} per member.", "cost": cost_used, "safe_deposit_cap": new_cap}


async def buy_family_event_token(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    from datetime import timedelta

    await require_store_item_allowed(db, "family_event_token", current_user)
    family_id = _family_don_guard(current_user)
    fam = await db.families.find_one(
        {"id": family_id},
        {"_id": 0, "event_active_until": 1, "event_token_last_at": 1},
    )
    if not fam:
        raise HTTPException(status_code=404, detail="Family not found")
    now = datetime.now(timezone.utc)
    last_at = fam.get("event_token_last_at")
    if last_at:
        try:
            last_dt = datetime.fromisoformat(str(last_at).replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            if (now - last_dt).total_seconds() < FAMILY_EVENT_COOLDOWN_DAYS * 86400:
                raise HTTPException(status_code=400, detail=f"Family events can be started once every {FAMILY_EVENT_COOLDOWN_DAYS} days")
        except HTTPException:
            raise
        except Exception:
            pass
    cost_used, inc, gte_filter = _store_cost_inc(current_user, FAMILY_EVENT_TOKEN_COST_POINTS, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    event_until = (now + timedelta(days=FAMILY_EVENT_DURATION_DAYS)).isoformat()
    user_result = await db.users.update_one({"id": current_user["id"], **gte_filter}, {"$inc": inc})
    if user_result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    fam_result = await db.families.update_one(
        {"id": family_id},
        {"$set": {"event_active_until": event_until, "event_type": "bonus_day", "event_token_last_at": now.isoformat()}},
    )
    if fam_result.modified_count == 0:
        await db.users.update_one({"id": current_user["id"]}, {"$inc": {"points": cost_used}})
        raise HTTPException(status_code=400, detail="Failed to activate family event")
    await _record_store_points_spend(current_user, inc, "buy-family-event-token", cost_used=cost_used, extra={"until": event_until})
    return {"message": f"Family bonus day active for {FAMILY_EVENT_DURATION_DAYS} days (+10% racket income).", "cost": cost_used, "event_active_until": event_until}


async def buy_robot_bg_auto_search(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    """30-day subscription: auto-maintain Attack searches for your hired robot bodyguards."""
    from utils.robot_bg_auto_search import (
        ROBOT_BG_AUTO_SEARCH_COST,
        extend_robot_bg_auto_search_until,
        maybe_auto_search_robots_for_user,
        robot_bg_auto_search_active,
    )

    if robot_bg_auto_search_active(current_user):
        until = (current_user.get("robot_bg_auto_search_until") or "").strip()
        raise HTTPException(
            status_code=400,
            detail=f"Robot auto-search is already active{f' until {until}' if until else ''}. Buy again after it expires.",
        )

    cost_used, inc, gte_filter = _store_cost_inc(current_user, ROBOT_BG_AUTO_SEARCH_COST, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    new_until = extend_robot_bg_auto_search_until(current_user.get("robot_bg_auto_search_until"))
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc, "$set": {"robot_bg_auto_search_until": new_until}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(
        current_user,
        inc,
        "buy-robot-bg-auto-search",
        cost_used=cost_used,
        extra={"robot_bg_auto_search_until": new_until},
    )
    await log_activity(
        current_user["id"],
        current_user.get("username") or "?",
        "store_purchase",
        {"item": "robot_bg_auto_search", "cost": cost_used, "until": new_until},
    )
    owner = {**current_user, "robot_bg_auto_search_until": new_until}
    seed = await maybe_auto_search_robots_for_user(db, owner)
    return {
        "message": "Robot bodyguard auto-search active for 30 days. Missing robot searches were started on your Attack list.",
        "cost": cost_used,
        "robot_bg_auto_search_until": new_until,
        "seed_summary": seed,
    }


async def buy_weapon_point_store_tier(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    """Purchase weapon11 (Engraved Lewis Gun) from the Points Store. Requires weapon10 owned."""
    from server import WEAPON_POINT_STORE_TIER

    tier = WEAPON_POINT_STORE_TIER
    weapon_id = str(tier["id"])
    cost = int(tier["cost_points"])
    owned = await db.user_weapons.find_one(
        {"user_id": current_user["id"], "weapon_id": weapon_id, "quantity": {"$gte": 1}},
        {"_id": 1},
    )
    if owned:
        raise HTTPException(status_code=400, detail="You already own this weapon")
    has_prev = await db.user_weapons.find_one(
        {"user_id": current_user["id"], "weapon_id": "weapon10", "quantity": {"$gte": 1}},
        {"_id": 1},
    )
    if not has_prev:
        raise HTTPException(
            status_code=400,
            detail=f"You must own Chicago Typewriter Premium (weapon10) before buying {tier['name']}.",
        )
    cost_used, inc, gte_filter = _store_cost_inc(current_user, cost, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.user_weapons.update_one(
        {"user_id": current_user["id"], "weapon_id": weapon_id},
        {"$inc": {"quantity": 1}, "$set": {"acquired_at": now_iso}},
        upsert=True,
    )
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"equipped_weapon_id": weapon_id}},
    )
    try:
        from routers.kill.armoury import _invalidate_weapons_cache
        _invalidate_weapons_cache(current_user["id"])
    except Exception:
        pass
    await _record_store_points_spend(
        current_user, inc, "buy-weapon-point-store", cost_used=cost_used, extra={"weapon_id": weapon_id},
    )
    await log_activity(
        current_user["id"],
        current_user.get("username") or "?",
        "store_purchase",
        {"item": "weapon_point_store_tier", "weapon_id": weapon_id, "cost": cost_used},
    )
    return {
        "message": f"Purchased and equipped {tier['name']}.",
        "cost": cost_used,
        "weapon_id": weapon_id,
    }


async def buy_armour_point_store_tier(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    """Purchase armour level 6 (Elite Composite Battledress) from the Points Store. Requires level 5 owned."""
    from server import ARMOUR_POINT_STORE_TIER

    tier = ARMOUR_POINT_STORE_TIER
    level = int(tier["level"])
    cost = int(tier["cost_points"])
    owned_max = int(current_user.get("armour_owned_level_max") or 0)
    if owned_max >= level:
        raise HTTPException(status_code=400, detail="You already own this armour tier")
    if owned_max < level - 1:
        raise HTTPException(
            status_code=400,
            detail=f"You must own armour level {level - 1} (Custom Armored Suit) before buying {tier['name']}.",
        )
    cost_used, inc, gte_filter = _store_cost_inc(current_user, cost, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {
            "$inc": inc,
            "$set": {
                "armour_owned_level_max": level,
                "armour_level": level,
            },
        },
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(
        current_user, inc, "buy-armour-point-store", cost_used=cost_used, extra={"armour_level": level},
    )
    await log_activity(
        current_user["id"],
        current_user.get("username") or "?",
        "store_purchase",
        {"item": "armour_point_store_tier", "level": level, "cost": cost_used},
    )
    return {
        "message": f"Purchased and equipped {tier['name']} (Armour Lv.{level}).",
        "cost": cost_used,
        "armour_level": level,
        "armour_owned_level_max": level,
    }


async def buy_health(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    """Restore health to 100% for 15 points (or 102 respect if paid fully with respect)."""
    current_health = float(current_user.get("health", FULL_HEALTH))
    if current_health >= FULL_HEALTH:
        raise HTTPException(status_code=400, detail="You already have full health")
    cost_used, inc, gte_filter = _store_cost_inc(current_user, BUY_HEALTH_COST_POINTS, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc, "$set": {"health": FULL_HEALTH, "health_regen_last_at": now_iso}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(current_user, inc, "buy-health", cost_used=cost_used)
    return {"message": "Full health restored!", "health": FULL_HEALTH, "cost": cost_used}


async def buy_custom_car(
    request: CustomCarPurchase,
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    if not request.car_name or len(request.car_name) < 2 or len(request.car_name) > 30:
        raise HTTPException(status_code=400, detail="Car name must be 2-30 characters")
    additions = await db.profanity_additions.distinct("word")
    extra = frozenset(additions) if additions else None
    if contains_profanity(request.car_name, extra_words=extra):
        raise HTTPException(status_code=400, detail="Custom car name contains disallowed language.")
    cost_used, inc, gte_filter = _store_cost_inc(current_user, CUSTOM_CAR_COST, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc, "$set": {"custom_car_name": request.car_name}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(
        current_user, inc, "buy-custom-car", cost_used=cost_used, extra={"car_name": request.car_name},
    )
    await db.user_cars.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "car_id": "car_custom",
        "custom_name": request.car_name,
        "custom_image_url": None,
        "acquired_at": datetime.now(timezone.utc).isoformat(),
        "damage_percent": 0,  # Custom cars never have damage
    })
    _invalidate_travel_info_cache(current_user["id"])
    await send_notification(
        current_user["id"],
        "🚗 Custom Car Purchased",
        f"You've purchased a custom car named '{request.car_name}' for {cost_used} points!",
        "reward"
    )
    return {"message": f"Custom car '{request.car_name}' purchased for {cost_used} points"}


async def send_points(request: SendPointsRequest, current_user: dict = Depends(get_current_user_verified)):
    """Send points to another player. Logged in points_transfers (last 10 visible to user, 500 to admin)."""
    to_username = (str(request.to_username) if request.to_username is not None else "").strip()
    if not to_username:
        raise HTTPException(status_code=400, detail="Enter a valid username")
    amount = int(request.amount)
    if amount < 1:
        raise HTTPException(status_code=400, detail="Amount must be at least 1")
    sender_id = current_user["id"]
    sender_username = (current_user.get("username") or "").strip() or "?"
    my_points = int(current_user.get("points") or 0)
    if my_points < amount:
        raise HTTPException(status_code=400, detail=f"Insufficient points (have {my_points:,})")
    pattern = _username_pattern(to_username)
    if pattern is None:
        raise HTTPException(status_code=400, detail="Enter a valid username")
    recipient = await db.users.find_one({"username": pattern}, {"_id": 0, "id": 1, "username": 1, "is_dead": 1})
    if not recipient:
        raise HTTPException(status_code=404, detail="User not found")
    if recipient.get("is_dead"):
        raise HTTPException(status_code=400, detail="Cannot send points to a dead account")
    if recipient["id"] == sender_id:
        raise HTTPException(status_code=400, detail="You cannot send points to yourself")
    # Atomic deduct: only succeeds if sender still has enough points
    deduct = await db.users.update_one(
        {"id": sender_id, "points": {"$gte": amount}},
        {"$inc": {"points": -amount}},
    )
    if deduct.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    recipient_username = (recipient.get("username") or "").strip() or "?"
    now = datetime.now(timezone.utc).isoformat()
    transfer_id = str(uuid.uuid4())
    slices = []
    try:
        slices = await consume_points_fifo(
            db,
            user_id=sender_id,
            points=amount,
            event_type="transfer_out",
            event_ref=transfer_id,
            meta={"to_user_id": recipient["id"], "to_username": recipient_username},
            assume_balance_already_decremented_by=amount,
        )
    except Exception:
        logger.exception("point provenance transfer_out failed transfer_id=%s", transfer_id)
        await db.users.update_one({"id": sender_id}, {"$inc": {"points": amount}})
        raise HTTPException(status_code=500, detail="Transfer failed. No points were sent; please retry.")
    consumed_total = sum(int(s.get("amount") or 0) for s in slices)
    if consumed_total != amount:
        logger.error(
            "point provenance transfer_out mismatch transfer_id=%s sender=%s amount=%s consumed=%s",
            transfer_id,
            sender_id,
            amount,
            consumed_total,
        )
        if consumed_total > 0:
            try:
                await _rollback_transfer_out_slices(sender_id, transfer_id, slices)
            except Exception:
                logger.exception("point provenance rollback failed transfer_id=%s", transfer_id)
        await db.users.update_one({"id": sender_id}, {"$inc": {"points": amount}})
        raise HTTPException(status_code=500, detail="Transfer failed integrity check. No points were sent.")
    await db.users.update_one({"id": recipient["id"]}, {"$inc": {"points": amount}})
    try:
        await mint_transfer_in_lots(
            db,
            to_user_id=recipient["id"],
            transfer_id=transfer_id,
            from_user_id=sender_id,
            slices=slices,
        )
    except Exception:
        logger.exception("point provenance transfer_in failed transfer_id=%s", transfer_id)
        await db.users.update_one({"id": recipient["id"]}, {"$inc": {"points": -amount}})
        await db.users.update_one({"id": sender_id}, {"$inc": {"points": amount}})
        try:
            await _rollback_transfer_out_slices(sender_id, transfer_id, slices)
        except Exception:
            logger.exception("point provenance rollback failed transfer_id=%s", transfer_id)
        raise HTTPException(status_code=500, detail="Transfer failed. No points were sent; please retry.")
    sender_u = await db.users.find_one({"id": sender_id}, {"_id": 0, "points": 1})
    recipient_u = await db.users.find_one({"id": recipient["id"]}, {"_id": 0, "points": 1})
    sender_pts_after = int((sender_u or {}).get("points") or 0)
    recipient_pts_after = int((recipient_u or {}).get("points") or 0)
    sender_pts_before = sender_pts_after + int(amount)
    recipient_pts_before = recipient_pts_after - int(amount)
    await db.points_transfers.insert_one({
        "id": transfer_id,
        "from_user_id": sender_id,
        "from_username": sender_username,
        "to_user_id": recipient["id"],
        "to_username": recipient_username,
        "amount": amount,
        "created_at": now,
        "sender_points_before": sender_pts_before,
        "sender_points_after": sender_pts_after,
        "recipient_points_before": recipient_pts_before,
        "recipient_points_after": recipient_pts_after,
    })
    await send_notification(
        recipient["id"],
        "Points received",
        f"{sender_username} sent you {amount:,} points.",
        "reward",
    )
    return {
        "message": f"Sent {amount:,} points to {recipient_username}",
        "transfer_id": transfer_id,
        "amount": amount,
        "to_username": recipient_username,
    }


async def get_my_points_transfers(current_user: dict = Depends(get_current_user)):
    """Last 10 points transfers where current user is sender or recipient."""
    uid = current_user["id"]
    cursor = db.points_transfers.find(
        {"$or": [{"from_user_id": uid}, {"to_user_id": uid}]},
        {"_id": 0, "id": 1, "from_user_id": 1, "from_username": 1, "to_user_id": 1, "to_username": 1, "amount": 1, "created_at": 1, "qt_anonymize_from": 1, "qt_anonymize_to": 1},
    ).sort("created_at", -1).limit(10)
    items = await cursor.to_list(10)
    out = []
    for t in items:
        r = redact_quicktrade_party_names(t, uid)
        out.append({
            "id": r.get("id"),
            "from_username": r.get("from_username"),
            "to_username": r.get("to_username"),
            "amount": r.get("amount"),
            "created_at": r.get("created_at"),
        })
    return {"transfers": out}


async def admin_points_transfers(
    limit: int = Query(500, ge=1, le=1000),
    current_user: dict = Depends(require_admin),
):
    """Admin: last N points transfers (default 500)."""
    cursor = db.points_transfers.find(
        {},
        {"_id": 0, "id": 1, "from_user_id": 1, "from_username": 1, "to_user_id": 1, "to_username": 1, "amount": 1, "created_at": 1},
    ).sort("created_at", -1).limit(limit)
    items = await cursor.to_list(limit)
    return {"transfers": items, "count": len(items)}


async def get_store_item_flags_public():
    flags = await get_store_item_flags(db)
    return {"flags": flags}


async def buy_store_token(
    body: BuyStoreTokenBody,
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    from routers.kill.armoury import TOKEN_CONFIG, TOKEN_TYPES

    tt = (body.token_type or "").strip()
    if tt in STORE_COUNT_ONLY_TOKEN_FIELDS:
        if tt not in TOKEN_STORE_UNIT_PRICE_POINTS:
            raise HTTPException(status_code=400, detail="This token type is not sold in the store")
        flag = store_flag_for_token_type(tt)
        if flag:
            await require_store_item_allowed(db, flag, current_user)
        amt = int(body.amount)
        cf = STORE_COUNT_ONLY_TOKEN_FIELDS[tt]
        unit = TOKEN_STORE_UNIT_PRICE_POINTS[tt]
        total_cost = unit * amt
        cost_used, inc, gte_filter = _store_cost_inc(current_user, total_cost, pay_with)
        if not cost_used:
            raise HTTPException(status_code=400, detail="Insufficient points")
        inc[cf] = inc.get(cf, 0) + amt
        filt = {"id": current_user["id"], **gte_filter}
        result = await db.users.update_one(filt, {"$inc": inc})
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail="Purchase failed. Try again.")
        await _record_store_points_spend(
            current_user, inc, f"buy-token:{tt}", cost_used=cost_used, extra={"amount": amt, "token_type": tt},
        )
        await log_activity(current_user["id"], current_user.get("username", "?"), "store_purchase", {"item": f"token:{tt}", "amount": amt, "cost": cost_used})
        return {"message": f"+{amt} {tt.replace('_', ' ')} token(s) for {cost_used} points", "cost": cost_used, "token_type": tt, "amount": amt}

    if tt not in TOKEN_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid token_type. Use one of: {list(TOKEN_TYPES)}")
    if tt not in TOKEN_STORE_UNIT_PRICE_POINTS:
        raise HTTPException(status_code=400, detail="This token type is not sold in the store")
    flag = store_flag_for_token_type(tt)
    if flag:
        await require_store_item_allowed(db, flag, current_user)
    amt = int(body.amount)
    cfg = TOKEN_CONFIG[tt]
    cf = cfg["count_field"]
    unit = TOKEN_STORE_UNIT_PRICE_POINTS[tt]
    total_cost = unit * amt
    cost_used, inc, gte_filter = _store_cost_inc(current_user, total_cost, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    inc[cf] = inc.get(cf, 0) + amt
    _pts = inc.get("lifetime_points_spent", 0)
    _rsp = inc.get("lifetime_respect_points_spent", 0)
    if _pts > 0:
        inc["token_points_spent"] = _pts
    if _rsp > 0:
        inc["token_respect_spent"] = _rsp
    filt = {
        "id": current_user["id"],
        **gte_filter,
    }
    result = await db.users.update_one(filt, {"$inc": inc})
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Purchase failed. Try again.")
    await _record_store_points_spend(
        current_user, inc, f"buy-token:{tt}", cost_used=cost_used, extra={"amount": amt, "token_type": tt},
    )
    await log_activity(current_user["id"], current_user.get("username", "?"), "store_purchase", {"item": f"token:{tt}", "amount": amt, "cost": cost_used})
    return {"message": f"+{amt} {tt.replace('_', ' ')} token(s) for {cost_used} points", "cost": cost_used, "token_type": tt, "amount": amt}


async def buy_store_token_bundle(
    body: BuyStoreTokenBundleBody,
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    bid = (body.bundle_id or "").strip()
    if bid not in TOKEN_STORE_BUNDLES:
        raise HTTPException(status_code=400, detail=f"Unknown bundle. Options: {list(TOKEN_STORE_BUNDLES.keys())}")
    cost, field_inc = TOKEN_STORE_BUNDLES[bid]
    cost_used, inc, gte_filter = _store_cost_inc(current_user, cost, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    for field, add in field_inc.items():
        inc[field] = inc.get(field, 0) + add
    _pts = inc.get("lifetime_points_spent", 0)
    _rsp = inc.get("lifetime_respect_points_spent", 0)
    if _pts > 0:
        inc["token_points_spent"] = _pts
    if _rsp > 0:
        inc["token_respect_spent"] = _rsp
    filt = {
        "id": current_user["id"],
        **gte_filter,
    }
    result = await db.users.update_one(filt, {"$inc": inc})
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Purchase failed. Try again.")
    await _record_store_points_spend(
        current_user, inc, f"buy-token-bundle:{bid}", cost_used=cost_used, extra={"bundle_id": bid},
    )
    return {"message": f"Bundle '{bid}' purchased for {cost_used} points", "cost": cost_used, "bundle_id": bid}


async def buy_store_token_selectable_bundle(
    body: BuyStoreSelectableTokenBundleBody,
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    from routers.kill.armoury import TOKEN_CONFIG

    entries, subtotal_pts, final_cost_pts = _validate_selectable_bundle_purchase(
        current_user, body.selections or {}, TOKEN_CONFIG
    )
    cost_used, inc, gte_filter = _store_cost_inc(current_user, final_cost_pts, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    for e in entries:
        field = e["count_field"]
        qty = int(e["qty"])
        inc[field] = inc.get(field, 0) + qty
    _pts = inc.get("lifetime_points_spent", 0)
    _rsp = inc.get("lifetime_respect_points_spent", 0)
    if _pts > 0:
        inc["token_points_spent"] = _pts
    if _rsp > 0:
        inc["token_respect_spent"] = _rsp
    filt = {
        "id": current_user["id"],
        **gte_filter,
    }
    result = await db.users.update_one(filt, {"$inc": inc})
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Purchase failed. Try again.")
    selected = [{"token_type": e["token_type"], "amount": int(e["qty"])} for e in entries]
    await _record_store_points_spend(
        current_user,
        inc,
        "buy-token-selectable-bundle",
        cost_used=cost_used,
        extra={"selected_tokens": selected},
    )
    return {
        "message": f"Selectable bundle purchased for {cost_used} points",
        "cost": cost_used,
        "bundle_size": TOKEN_SELECTABLE_BUNDLE_SIZE,
        "discount_percent": TOKEN_SELECTABLE_BUNDLE_DISCOUNT_PCT,
        "subtotal_points": subtotal_pts,
        "discount_points": subtotal_pts - final_cost_pts,
        "selected_tokens": selected,
    }


async def buy_shooting_range_bonus(
    current_user: dict = Depends(get_current_user),
):
    """+2 max shooting range plays per 2h window (stacking), up to +10 from store (20 per 2h total with base 10)."""
    cur = int(current_user.get("shooting_range_bonus_plays") or 0)
    if cur >= SHOOTING_RANGE_BONUS_CAP:
        raise HTTPException(status_code=400, detail="Shooting range bonus plays are already maxed")
    add = min(SHOOTING_RANGE_BONUS_STEP, SHOOTING_RANGE_BONUS_CAP - cur)
    cost_used, inc, gte_filter = _store_cost_inc(current_user, SHOOTING_RANGE_BONUS_COST_POINTS)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    inc["shooting_range_bonus_plays"] = inc.get("shooting_range_bonus_plays", 0) + add
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(current_user, inc, "buy-shooting-range-bonus", cost_used=cost_used, extra={"bonus_plays_added": add})
    new_bonus = cur + add
    base = 10  # SHOOTING_RANGE_MAX_PLAYS_PER_HOUR in armoury
    return {
        "message": f"+{add} plays for shooting range ({base + new_bonus} per 2h cap). Cost {cost_used} points.",
        "cost": cost_used,
        "shooting_range_bonus_plays": new_bonus,
        "shooting_range_hourly_limit": base + new_bonus,
    }


async def buy_hitlist_npc_bonus_slot(
    pay_with: str = Query("auto"),
    current_user: dict = Depends(get_current_user),
):
    """Increase max practice hitlist NPCs on the board at once by +1. Base 3; store can raise to 6."""
    cur_bonus = int(current_user.get("hitlist_npc_bonus_slots") or 0)
    if cur_bonus >= HITLIST_NPC_BONUS_SLOTS_CAP:
        raise HTTPException(status_code=400, detail="Hitlist NPC practice target cap is already maxed")
    next_bonus_slot = cur_bonus + 1
    cost = _hitlist_npc_bonus_slot_cost(next_bonus_slot)
    cost_used, inc, gte_filter = _store_cost_inc(current_user, cost, pay_with)
    if not cost_used:
        raise HTTPException(status_code=400, detail="Insufficient points")
    inc["hitlist_npc_bonus_slots"] = inc.get("hitlist_npc_bonus_slots", 0) + 1
    result = await db.users.update_one(
        {"id": current_user["id"], **gte_filter},
        {"$inc": inc},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient points")
    await _record_store_points_spend(
        current_user, inc, "buy-hitlist-npc-bonus-slot", cost_used=cost_used, extra={"bonus_slot": next_bonus_slot},
    )
    new_bonus = cur_bonus + 1
    new_limit = HITLIST_NPC_BONUS_SLOTS_BASE + new_bonus
    return {
        "message": f"Practice target cap increased to {new_limit} on The Board at once. Cost {cost_used} points.",
        "cost": cost_used,
        "hitlist_npc_bonus_slots": new_bonus,
        "hitlist_npc_window_limit": new_limit,
    }


TOKEN_CASH_DAILY_LIMIT = 25
# Store token cash buys: never below this $/point; if <3 valid QT sell offers, use this floor only.
TOKEN_CASH_MIN_PRICE_PER_POINT = 150_000


async def _get_cash_price_per_point() -> tuple:
    """Token cash buys — QT pricing with $150k/pt floor."""
    return await qt_cash_price_per_point(db, min_price_per_point=TOKEN_CASH_MIN_PRICE_PER_POINT)


async def _get_points_cash_price_per_point() -> tuple:
    """Points cash buys — QT pricing with $550k/pt floor."""
    return await qt_cash_price_per_point(db, min_price_per_point=POINTS_CASH_MIN_PRICE_PER_POINT)


def _points_cash_cost(points: int, price_per_point: float) -> int:
    return int(round(int(points) * float(price_per_point)))


async def _points_cash_cap_context(request: Request, current_user: dict) -> dict:
    email = verified_email_for_user(current_user)
    client_ip = client_ip_from_request(request)
    month_key = game_month_start_date_str()
    caps = await cap_allowance_summary(db, client_ip=client_ip or "", email=email or "", month_key=month_key)
    return {
        "email": email,
        "client_ip": client_ip,
        "month_key": month_key,
        "caps": caps,
    }


def _normalize_token_cash_purchase_date_key(raw) -> str | None:
    """Match token_cash_purchases_date to a London calendar day YYYY-MM-DD (handles str / datetime / BSON)."""
    if raw is None:
        return None
    if isinstance(raw, datetime):
        dt = raw if raw.tzinfo is not None else raw.replace(tzinfo=timezone.utc)
        return game_today_date_str(dt)
    if isinstance(raw, date):
        return raw.isoformat()
    if isinstance(raw, str):
        s = raw.strip().replace("Z", "+00:00")
        if len(s) >= 10 and s[4] == "-" and s[7] == "-":
            if len(s) == 10:
                return s[:10]
            try:
                dt = datetime.fromisoformat(s)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return game_today_date_str(dt)
            except ValueError:
                return s[:10]
    return None


def _cash_purchases_today(user: dict) -> int:
    """Return how many cash token units bought today (London calendar day; same as token_cash_purchases_date)."""
    today = game_today_date_str()
    prev = _normalize_token_cash_purchase_date_key(user.get("token_cash_purchases_date"))
    if prev != today:
        return 0
    return int(user.get("token_cash_purchases_today") or 0)


async def get_token_cash_price(current_user: dict = Depends(get_current_user)):
    available, price_per_point, offers_in_avg = await _get_cash_price_per_point()
    used = _cash_purchases_today(current_user)
    return {
        "available": available,
        "price_per_point": round(price_per_point, 2) if available else 0,
        "offer_count": offers_in_avg,
        "min_price_per_point": TOKEN_CASH_MIN_PRICE_PER_POINT,
        "used_qt_average": offers_in_avg >= QT_CASH_AVG_SELL_OFFER_COUNT,
        "cash_purchases_today": used,
        "cash_purchases_limit": TOKEN_CASH_DAILY_LIMIT,
    }


async def buy_store_token_cash(
    body: BuyStoreTokenBody,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    from routers.kill.armoury import TOKEN_CONFIG, TOKEN_TYPES

    tt = (body.token_type or "").strip()
    if tt in STORE_COUNT_ONLY_TOKEN_FIELDS:
        if tt not in TOKEN_STORE_UNIT_PRICE_POINTS:
            raise HTTPException(status_code=400, detail="This token type is not sold in the store")
        flag = store_flag_for_token_type(tt)
        if flag:
            await require_store_item_allowed(db, flag, current_user)
        amt = int(body.amount)
        cf = STORE_COUNT_ONLY_TOKEN_FIELDS[tt]
        used = _cash_purchases_today(current_user)
        if used + amt > TOKEN_CASH_DAILY_LIMIT:
            raise HTTPException(
                status_code=400,
                detail=f"Daily cash purchase limit reached ({TOKEN_CASH_DAILY_LIMIT}/day; {used} used today).",
            )
        _available, price_per_point, offers_in_avg = await _get_cash_price_per_point()
        if price_per_point <= 0:
            raise HTTPException(status_code=400, detail="Cash price unavailable. Try again.")
        unit_pts = TOKEN_STORE_UNIT_PRICE_POINTS[tt]
        cash_cost = round(unit_pts * amt * price_per_point)
        if cash_cost <= 0:
            raise HTTPException(status_code=400, detail="Calculated cash cost is invalid.")
        money_balance = float(current_user.get("money") or 0)
        if money_balance < cash_cost:
            raise HTTPException(status_code=400, detail=f"Insufficient cash. Need ${cash_cost:,.0f}, have ${money_balance:,.0f}.")
        today = game_today_date_str()
        prev_key = _normalize_token_cash_purchase_date_key(current_user.get("token_cash_purchases_date"))
        new_day = prev_key != today
        filt = {"id": current_user["id"], "money": {"$gte": cash_cost}}
        inc = {"money": -cash_cost, cf: amt, "token_cash_spent": cash_cost}
        set_doc = {"token_cash_purchases_date": today}
        if new_day:
            set_doc["token_cash_purchases_today"] = amt
        else:
            inc["token_cash_purchases_today"] = amt
        result = await db.users.update_one(filt, {"$inc": inc, "$set": set_doc})
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail="Purchase failed. Try again.")
        await log_activity(current_user["id"], current_user.get("username", "?"), "store_purchase", {"item": f"token-cash:{tt}", "amount": amt, "cash_cost": cash_cost})
        return {"message": f"+{amt} {tt.replace('_', ' ')} token(s) for ${cash_cost:,.0f}", "cash_cost": cash_cost, "token_type": tt, "amount": amt}

    if tt not in TOKEN_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid token_type. Use one of: {list(TOKEN_TYPES)}")
    if tt not in TOKEN_STORE_UNIT_PRICE_POINTS:
        raise HTTPException(status_code=400, detail="This token type is not sold in the store")
    flag = store_flag_for_token_type(tt)
    if flag:
        await require_store_item_allowed(db, flag, current_user)

    amt = int(body.amount)
    cfg = TOKEN_CONFIG[tt]
    cf = cfg["count_field"]

    used = _cash_purchases_today(current_user)
    if used + amt > TOKEN_CASH_DAILY_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"Daily cash purchase limit reached ({TOKEN_CASH_DAILY_LIMIT}/day; {used} used today).",
        )

    _available, price_per_point, offers_in_avg = await _get_cash_price_per_point()
    if price_per_point <= 0:
        raise HTTPException(status_code=400, detail="Cash price unavailable. Try again.")

    unit_pts = TOKEN_STORE_UNIT_PRICE_POINTS[tt]
    cash_cost = round(unit_pts * amt * price_per_point)
    if cash_cost <= 0:
        raise HTTPException(status_code=400, detail="Calculated cash cost is invalid.")

    money_balance = float(current_user.get("money") or 0)
    if money_balance < cash_cost:
        raise HTTPException(status_code=400, detail=f"Insufficient cash. Need ${cash_cost:,.0f}, have ${money_balance:,.0f}.")

    today = game_today_date_str()
    prev_key = _normalize_token_cash_purchase_date_key(current_user.get("token_cash_purchases_date"))
    new_day = prev_key != today
    filt = {
        "id": current_user["id"],
        "money": {"$gte": cash_cost},
    }
    inc = {"money": -cash_cost, cf: amt, "token_cash_spent": cash_cost}
    set_doc = {"token_cash_purchases_date": today}
    if new_day:
        set_doc["token_cash_purchases_today"] = amt
    else:
        inc["token_cash_purchases_today"] = amt
    result = await db.users.update_one(filt, {"$inc": inc, "$set": set_doc})
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Purchase failed. Try again.")

    await log_activity(
        current_user["id"], current_user.get("username", "?"), "store_purchase",
        {"item": f"token-cash:{tt}", "amount": amt, "cash_cost": cash_cost, "price_per_point": round(price_per_point, 2)},
    )
    purchase_id = str(uuid.uuid4())
    try:
        await record_store_cash_purchase(
            db,
            purchase_id=purchase_id,
            purchase_kind="token_cash",
            user=current_user,
            cash_cost=cash_cost,
            price_per_point=price_per_point,
            money_before=money_balance,
            money_after=money_balance - cash_cost,
            client_ip=client_ip_from_request(request),
            email=verified_email_for_user(current_user),
            qt_offers_used=offers_in_avg,
            used_qt_average=offers_in_avg >= QT_CASH_AVG_SELL_OFFER_COUNT,
            points_equivalent=unit_pts * amt,
            token_type=tt,
            amount=amt,
            token_cash_day_before=used,
            token_cash_day_after=used + amt,
        )
    except Exception:
        logger.exception("store token cash audit log failed purchase_id=%s", purchase_id)
    return {
        "message": f"+{amt} {tt.replace('_', ' ')} token(s) for ${cash_cost:,.0f}",
        "cost_cash": cash_cost,
        "token_type": tt,
        "amount": amt,
        "cash_purchases_today": used + amt,
    }


async def buy_store_token_bundle_cash(
    body: BuyStoreTokenBundleBody,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    bid = (body.bundle_id or "").strip()
    if bid not in TOKEN_STORE_BUNDLES:
        raise HTTPException(status_code=400, detail=f"Unknown bundle. Options: {list(TOKEN_STORE_BUNDLES.keys())}")

    cost_pts, field_inc = TOKEN_STORE_BUNDLES[bid]

    used = _cash_purchases_today(current_user)
    if used + 1 > TOKEN_CASH_DAILY_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"Daily cash purchase limit reached ({TOKEN_CASH_DAILY_LIMIT}/day; {used} used today).",
        )

    _available, price_per_point, offers_in_avg = await _get_cash_price_per_point()
    if price_per_point <= 0:
        raise HTTPException(status_code=400, detail="Cash price unavailable. Try again.")

    cash_cost = round(cost_pts * price_per_point)
    if cash_cost <= 0:
        raise HTTPException(status_code=400, detail="Calculated cash cost is invalid.")

    money_balance = float(current_user.get("money") or 0)
    if money_balance < cash_cost:
        raise HTTPException(status_code=400, detail=f"Insufficient cash. Need ${cash_cost:,.0f}, have ${money_balance:,.0f}.")

    today = game_today_date_str()
    prev_key = _normalize_token_cash_purchase_date_key(current_user.get("token_cash_purchases_date"))
    new_day = prev_key != today
    inc = {"money": -cash_cost, "token_cash_spent": cash_cost}
    gte = {"money": {"$gte": cash_cost}}
    for field, add in field_inc.items():
        inc[field] = inc.get(field, 0) + add
    if not new_day:
        inc["token_cash_purchases_today"] = 1
    filt = {"id": current_user["id"], **gte}
    set_doc = {"token_cash_purchases_date": today}
    if new_day:
        set_doc["token_cash_purchases_today"] = 1
    result = await db.users.update_one(filt, {"$inc": inc, "$set": set_doc})
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Purchase failed. Try again.")

    await log_activity(
        current_user["id"], current_user.get("username", "?"), "store_purchase",
        {"item": f"token-bundle-cash:{bid}", "cash_cost": cash_cost, "price_per_point": round(price_per_point, 2)},
    )
    purchase_id = str(uuid.uuid4())
    try:
        await record_store_cash_purchase(
            db,
            purchase_id=purchase_id,
            purchase_kind="token_bundle_cash",
            user=current_user,
            cash_cost=cash_cost,
            price_per_point=price_per_point,
            money_before=money_balance,
            money_after=money_balance - cash_cost,
            client_ip=client_ip_from_request(request),
            email=verified_email_for_user(current_user),
            qt_offers_used=offers_in_avg,
            used_qt_average=offers_in_avg >= QT_CASH_AVG_SELL_OFFER_COUNT,
            points_equivalent=cost_pts,
            bundle_id=bid,
            token_cash_day_before=used,
            token_cash_day_after=used + 1,
        )
    except Exception:
        logger.exception("store token bundle cash audit log failed purchase_id=%s", purchase_id)
    return {
        "message": f"Bundle '{bid}' purchased for ${cash_cost:,.0f}",
        "cost_cash": cash_cost,
        "bundle_id": bid,
        "cash_purchases_today": used + 1,
    }


async def buy_store_token_selectable_bundle_cash(
    body: BuyStoreSelectableTokenBundleBody,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    from routers.kill.armoury import TOKEN_CONFIG

    entries, subtotal_pts, final_cost_pts = _validate_selectable_bundle_purchase(
        current_user, body.selections or {}, TOKEN_CONFIG
    )
    units_selected = sum(int(e["qty"]) for e in entries)
    used = _cash_purchases_today(current_user)
    if used + units_selected > TOKEN_CASH_DAILY_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"Daily cash purchase limit reached ({TOKEN_CASH_DAILY_LIMIT}/day; {used} used today).",
        )
    _available, price_per_point, offers_in_avg = await _get_cash_price_per_point()
    if price_per_point <= 0:
        raise HTTPException(status_code=400, detail="Cash price unavailable. Try again.")
    cash_cost = round(final_cost_pts * price_per_point)
    if cash_cost <= 0:
        raise HTTPException(status_code=400, detail="Calculated cash cost is invalid.")
    money_balance = float(current_user.get("money") or 0)
    if money_balance < cash_cost:
        raise HTTPException(status_code=400, detail=f"Insufficient cash. Need ${cash_cost:,.0f}, have ${money_balance:,.0f}.")
    today = game_today_date_str()
    prev_key = _normalize_token_cash_purchase_date_key(current_user.get("token_cash_purchases_date"))
    new_day = prev_key != today
    inc = {"money": -cash_cost, "token_cash_spent": cash_cost}
    for e in entries:
        field = e["count_field"]
        qty = int(e["qty"])
        inc[field] = inc.get(field, 0) + qty
    if not new_day:
        inc["token_cash_purchases_today"] = units_selected
    filt = {
        "id": current_user["id"],
        "money": {"$gte": cash_cost},
    }
    set_doc = {"token_cash_purchases_date": today}
    if new_day:
        set_doc["token_cash_purchases_today"] = units_selected
    result = await db.users.update_one(filt, {"$inc": inc, "$set": set_doc})
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Purchase failed. Try again.")
    selected = [{"token_type": e["token_type"], "amount": int(e["qty"])} for e in entries]
    purchase_id = str(uuid.uuid4())
    try:
        await record_store_cash_purchase(
            db,
            purchase_id=purchase_id,
            purchase_kind="token_selectable_bundle_cash",
            user=current_user,
            cash_cost=cash_cost,
            price_per_point=price_per_point,
            money_before=money_balance,
            money_after=money_balance - cash_cost,
            client_ip=client_ip_from_request(request),
            email=verified_email_for_user(current_user),
            qt_offers_used=offers_in_avg,
            used_qt_average=offers_in_avg >= QT_CASH_AVG_SELL_OFFER_COUNT,
            points_equivalent=final_cost_pts,
            selected_tokens=selected,
            token_cash_day_before=used,
            token_cash_day_after=used + units_selected,
        )
    except Exception:
        logger.exception("store selectable bundle cash audit log failed purchase_id=%s", purchase_id)
    await log_activity(
        current_user["id"], current_user.get("username", "?"), "store_purchase",
        {
            "item": "token-selectable-bundle-cash",
            "cash_cost": cash_cost,
            "price_per_point": round(price_per_point, 2),
            "selected_tokens": selected,
            "purchase_id": purchase_id,
        },
    )
    return {
        "message": f"Selectable bundle purchased for ${cash_cost:,.0f}",
        "cost_cash": cash_cost,
        "bundle_size": TOKEN_SELECTABLE_BUNDLE_SIZE,
        "discount_percent": TOKEN_SELECTABLE_BUNDLE_DISCOUNT_PCT,
        "subtotal_points": subtotal_pts,
        "discount_points": subtotal_pts - final_cost_pts,
        "selected_tokens": selected,
        "cash_purchases_today": used + units_selected,
    }


async def get_points_cash_price(
    request: Request,
    current_user: dict = Depends(get_current_user_verified),
):
    available, price_per_point, offers_in_avg = await _get_points_cash_price_per_point()
    ctx = await _points_cash_cap_context(request, current_user)
    caps = ctx["caps"]
    prestige_level = int(current_user.get("prestige_level") or 0)
    prestige_eligible = points_cash_prestige_eligible(current_user)
    return {
        "available": available,
        "price_per_point": round(price_per_point, 2) if available else 0,
        "offer_count": offers_in_avg,
        "min_price_per_point": POINTS_CASH_MIN_PRICE_PER_POINT,
        "used_qt_average": offers_in_avg >= QT_CASH_AVG_SELL_OFFER_COUNT,
        "month_key": caps["month_key"],
        "monthly_limit": caps["monthly_limit"],
        "ip_spent": caps["ip_spent"],
        "ip_remaining": caps["ip_remaining"],
        "email_spent": caps["email_spent"],
        "email_remaining": caps["email_remaining"],
        "effective_remaining": caps["effective_remaining"],
        "email_verified": True,
        "prestige_level": prestige_level,
        "min_prestige_level": POINTS_CASH_MIN_PRESTIGE_LEVEL,
        "prestige_eligible": prestige_eligible,
    }


async def get_points_cash_quote(
    request: Request,
    points: int = Query(..., ge=1),
    current_user: dict = Depends(get_current_user_verified),
):
    _available, price_per_point, offers_in_avg = await _get_points_cash_price_per_point()
    if price_per_point <= 0:
        raise HTTPException(status_code=400, detail="Cash price unavailable. Try again.")
    cash_cost = _points_cash_cost(points, price_per_point)
    if cash_cost <= 0:
        raise HTTPException(status_code=400, detail="Calculated cash cost is invalid.")
    ctx = await _points_cash_cap_context(request, current_user)
    caps = ctx["caps"]
    money_balance = float(current_user.get("money") or 0)
    fits_ip = cash_cost <= caps["ip_remaining"]
    fits_email = cash_cost <= caps["email_remaining"]
    fits_caps = fits_ip and fits_email
    sufficient_cash = money_balance >= cash_cost
    prestige_eligible = points_cash_prestige_eligible(current_user)
    return {
        "points": int(points),
        "price_per_point": round(price_per_point, 2),
        "cash_cost": cash_cost,
        "offer_count": offers_in_avg,
        "used_qt_average": offers_in_avg >= QT_CASH_AVG_SELL_OFFER_COUNT,
        "min_price_per_point": POINTS_CASH_MIN_PRICE_PER_POINT,
        "month_key": caps["month_key"],
        "monthly_limit": caps["monthly_limit"],
        "ip_spent": caps["ip_spent"],
        "ip_remaining": caps["ip_remaining"],
        "email_spent": caps["email_spent"],
        "email_remaining": caps["email_remaining"],
        "effective_remaining": caps["effective_remaining"],
        "fits_ip_cap": fits_ip,
        "fits_email_cap": fits_email,
        "fits_caps": fits_caps,
        "sufficient_cash": sufficient_cash,
        "prestige_level": int(current_user.get("prestige_level") or 0),
        "min_prestige_level": POINTS_CASH_MIN_PRESTIGE_LEVEL,
        "prestige_eligible": prestige_eligible,
        "can_buy": prestige_eligible and fits_caps and sufficient_cash,
        "money_balance": money_balance,
    }


async def buy_store_points_cash(
    body: BuyPointsCashBody,
    request: Request,
    current_user: dict = Depends(get_current_user_verified),
):
    points = int(body.points)
    if not points_cash_prestige_eligible(current_user):
        raise HTTPException(
            status_code=403,
            detail=f"Prestige {POINTS_CASH_MIN_PRESTIGE_LEVEL}+ required to buy points with cash.",
        )
    email = verified_email_for_user(current_user)
    if not email:
        raise HTTPException(status_code=403, detail="Verified email required for cash point purchases.")
    client_ip = client_ip_from_request(request)
    if not client_ip:
        raise HTTPException(status_code=400, detail="Could not determine client IP. Try again from a normal connection.")

    _available, price_per_point, offers_in_avg = await _get_points_cash_price_per_point()
    if price_per_point <= 0:
        raise HTTPException(status_code=400, detail="Cash price unavailable. Try again.")
    cash_cost = _points_cash_cost(points, price_per_point)
    if cash_cost <= 0:
        raise HTTPException(status_code=400, detail="Calculated cash cost is invalid.")

    month_key = game_month_start_date_str()
    ip_ok, ip_spent_before = await increment_ip_cap(db, client_ip=client_ip, month_key=month_key, cash_cost=cash_cost)
    if not ip_ok:
        raise HTTPException(
            status_code=400,
            detail=f"Monthly IP cash purchase limit reached (${POINTS_CASH_MONTHLY_LIMIT:,.0f}/month; ${ip_spent_before:,.0f} used this month).",
        )
    email_ok, email_spent_before = await increment_email_cap(db, email=email, month_key=month_key, cash_cost=cash_cost)
    if not email_ok:
        await rollback_cap(
            db,
            collection=STORE_POINTS_CASH_IP_MONTHLY,
            key_name="ip",
            key_value=client_ip,
            month_key=month_key,
            cash_cost=cash_cost,
        )
        raise HTTPException(
            status_code=400,
            detail=f"Monthly email cash purchase limit reached (${POINTS_CASH_MONTHLY_LIMIT:,.0f}/month; ${email_spent_before:,.0f} used this month).",
        )

    money_before = float(current_user.get("money") or 0)
    points_before = int(current_user.get("points") or 0)
    if money_before < cash_cost:
        await rollback_cap(
            db,
            collection=STORE_POINTS_CASH_IP_MONTHLY,
            key_name="ip",
            key_value=client_ip,
            month_key=month_key,
            cash_cost=cash_cost,
        )
        await rollback_cap(
            db,
            collection=STORE_POINTS_CASH_EMAIL_MONTHLY,
            key_name="email",
            key_value=email,
            month_key=month_key,
            cash_cost=cash_cost,
        )
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient cash. Need ${cash_cost:,.0f}, have ${money_before:,.0f}.",
        )

    purchase_id = str(uuid.uuid4())
    result = await db.users.update_one(
        {"id": current_user["id"], "money": {"$gte": cash_cost}},
        {"$inc": {"money": -cash_cost, "points": points, "store_points_cash_spent": cash_cost}},
    )
    if result.modified_count == 0:
        await rollback_cap(
            db,
            collection=STORE_POINTS_CASH_IP_MONTHLY,
            key_name="ip",
            key_value=client_ip,
            month_key=month_key,
            cash_cost=cash_cost,
        )
        await rollback_cap(
            db,
            collection=STORE_POINTS_CASH_EMAIL_MONTHLY,
            key_name="email",
            key_value=email,
            month_key=month_key,
            cash_cost=cash_cost,
        )
        raise HTTPException(status_code=400, detail="Purchase failed. Try again.")

    money_after = money_before - cash_cost
    points_after = points_before + points
    ip_spent_after = ip_spent_before + cash_cost
    email_spent_after = email_spent_before + cash_cost

    try:
        await mint_store_points_cash_lot_if_missing(
            db,
            user_id=current_user["id"],
            purchase_id=purchase_id,
            points=points,
        )
    except Exception:
        logger.exception("store points cash lot mint failed purchase_id=%s", purchase_id)

    try:
        await log_points_event(
            db,
            user_id=current_user["id"],
            points=points,
            event_type="store_points_cash_purchase",
            event_ref=purchase_id,
            meta={
                "cash_cost": cash_cost,
                "price_per_point": round(price_per_point, 2),
                "client_ip": client_ip,
                "email": email,
            },
            wallet_points_before=points_before,
            wallet_points_after=points_after,
        )
    except Exception:
        logger.exception("store points cash ledger log failed purchase_id=%s", purchase_id)

    await log_activity(
        current_user["id"],
        current_user.get("username", "?"),
        "store_purchase",
        {
            "item": "points-cash",
            "points": points,
            "cash_cost": cash_cost,
            "price_per_point": round(price_per_point, 2),
            "purchase_id": purchase_id,
        },
    )

    try:
        await record_store_cash_purchase(
            db,
            purchase_id=purchase_id,
            purchase_kind="points_cash",
            user=current_user,
            cash_cost=cash_cost,
            price_per_point=price_per_point,
            money_before=money_before,
            money_after=money_after,
            client_ip=client_ip,
            email=email,
            qt_offers_used=offers_in_avg,
            used_qt_average=offers_in_avg >= QT_CASH_AVG_SELL_OFFER_COUNT,
            points=points,
            points_before=points_before,
            points_after=points_after,
            points_equivalent=points,
            month_key=month_key,
            ip_month_spent_before=ip_spent_before,
            ip_month_spent_after=ip_spent_after,
            email_month_spent_before=email_spent_before,
            email_month_spent_after=email_spent_after,
        )
    except Exception:
        logger.exception("store points cash audit log failed purchase_id=%s", purchase_id)

    return {
        "message": f"+{points:,} points for ${cash_cost:,.0f}",
        "points": points,
        "cost_cash": cash_cost,
        "price_per_point": round(price_per_point, 2),
        "purchase_id": purchase_id,
        "ip_spent": ip_spent_after,
        "email_spent": email_spent_after,
        "monthly_limit": POINTS_CASH_MONTHLY_LIMIT,
    }


def register(router):
    router.add_api_route(
        "/store/points-cash-price",
        get_points_cash_price,
        methods=["GET"],
        dependencies=_store_points_rl_u,
    )
    router.add_api_route(
        "/store/points-cash-quote",
        get_points_cash_quote,
        methods=["GET"],
        dependencies=_store_points_rl_u,
    )
    router.add_api_route(
        "/store/buy-points-cash",
        buy_store_points_cash,
        methods=["POST"],
        dependencies=_store_points_rl_u,
    )
    router.add_api_route(
        "/store/token-cash-price",
        get_token_cash_price,
        methods=["GET"],
        dependencies=_store_points_rl_u,
    )
    router.add_api_route("/store/buy-token-cash", buy_store_token_cash, methods=["POST"])
    router.add_api_route("/store/buy-token-bundle-cash", buy_store_token_bundle_cash, methods=["POST"])
    router.add_api_route("/store/buy-token-selectable-bundle-cash", buy_store_token_selectable_bundle_cash, methods=["POST"])
    router.add_api_route("/store/buy-rank-bar", buy_premium_rank_bar, methods=["POST"])
    router.add_api_route("/store/buy-auto-rank", buy_auto_rank, methods=["POST"])
    router.add_api_route("/store/item-flags", get_store_item_flags_public, methods=["GET"])
    router.add_api_route("/store/buy-founding-member", buy_founding_member, methods=["POST"])
    router.add_api_route("/store/buy-custom-profile-badge", buy_custom_profile_badge, methods=["POST"])
    router.add_api_route("/store/buy-profile-glow-7d", buy_profile_glow_7d, methods=["POST"])
    router.add_api_route("/store/buy-profile-glow-permanent", buy_profile_glow_permanent, methods=["POST"])
    router.add_api_route("/store/buy-family-crest-upgrade", buy_family_crest_upgrade, methods=["POST"])
    router.add_api_route("/store/buy-family-safe-deposit-tier", buy_family_safe_deposit_tier, methods=["POST"])
    router.add_api_route("/store/buy-family-event-token", buy_family_event_token, methods=["POST"])
    router.add_api_route("/store/buy-robot-bg-auto-search", buy_robot_bg_auto_search, methods=["POST"])
    router.add_api_route("/store/buy-armour-tier-6", buy_armour_point_store_tier, methods=["POST"])
    router.add_api_route("/store/buy-weapon11", buy_weapon_point_store_tier, methods=["POST"])
    router.add_api_route("/store/buy-silencer", buy_silencer, methods=["POST"])
    router.add_api_route("/store/buy-anti-snitch", buy_anti_snitch, methods=["POST"])
    router.add_api_route("/store/buy-oc-timer", buy_oc_timer, methods=["POST"])
    router.add_api_route("/store/buy-crew-oc-timer", buy_crew_oc_timer, methods=["POST"])
    router.add_api_route("/store/upgrade-garage-batch", upgrade_garage_batch_limit, methods=["POST"])
    router.add_api_route("/store/buy-booze-capacity", buy_booze_capacity, methods=["POST"])
    router.add_api_route("/store/buy-bullets", store_buy_bullets, methods=["POST"])
    router.add_api_route("/store/buy-health", buy_health, methods=["POST"])
    router.add_api_route("/store/buy-custom-car", buy_custom_car, methods=["POST"])
    router.add_api_route("/store/buy-token", buy_store_token, methods=["POST"])
    router.add_api_route("/store/buy-token-bundle", buy_store_token_bundle, methods=["POST"])
    router.add_api_route("/store/buy-token-selectable-bundle", buy_store_token_selectable_bundle, methods=["POST"])
    router.add_api_route("/store/buy-shooting-range-bonus", buy_shooting_range_bonus, methods=["POST"])
    router.add_api_route("/store/buy-hitlist-npc-bonus-slot", buy_hitlist_npc_bonus_slot, methods=["POST"])
    router.add_api_route("/store/send-points", send_points, methods=["POST"])
    router.add_api_route(
        "/store/points-transfers",
        get_my_points_transfers,
        methods=["GET"],
        dependencies=_store_points_rl_u,
    )
    router.add_api_route("/store/points-transfers/admin", admin_points_transfers, methods=["GET"])
