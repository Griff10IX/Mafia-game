# Properties endpoints: list, buy, collect income
# Progression: buy in order; first property pays least, last pays most. Must max previous to unlock next.
from datetime import datetime, timezone, timedelta
from typing import List, Optional
import asyncio
import math
from pydantic import BaseModel
import secrets
_rng = secrets.SystemRandom()

from fastapi import Depends, HTTPException

from server import db, get_current_user, founding_member_income_mult, log_activity
from utils.point_provenance import log_points_event
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_PROPERTIES


async def _properties_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_PROPERTIES)


_properties_rl_u = [Depends(_properties_sustained_rl_user)]


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


def _format_utc_datetime_friendly(dt: datetime) -> str:
    """Human-readable UTC for player-facing messages (no raw ISO microseconds)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%d %b %Y, %H:%M UTC")


class PropertyResponse(BaseModel):
    id: str
    name: str
    property_type: str
    price: int
    income_per_hour: int
    max_level: int
    owned: bool
    level: int
    available_income: float
    locked: bool = False
    required_property_name: Optional[str] = None
    # Optional extras for UI
    collection_streak_days: int = 0
    streak_bonus_mult: float = 1.0
    hours_since_collect: float = 0.0
    risk_flag: Optional[str] = None
    buff_label: Optional[str] = None
    # Stacking: how many of this property type user owns
    owned_count: int = 1
    stack_bonus_pct: int = 0  # e.g., 50 = +50% bonus from stacking
    # level = sum of levels across copies; max_total_level = per-copy cap * copy count
    max_total_level: int = 10
    can_upgrade: bool = False
    next_upgrade_cost: Optional[int] = None
    income_collection_blocked: bool = False


class PropertyUpkeepSummary(BaseModel):
    paid_until: Optional[str] = None
    weekly_amount: int = 0
    weekly_baseline_gross: int = 0
    portfolio_value: int = 0
    overdue: bool = False
    income_collection_blocked: bool = False
    billing_days: int = 7
    income_share: float = 0.10
    wealth_share: float = 0.002
    can_pay: bool = True
    pay_window_hours: int = 48
    pay_eligible_at: Optional[str] = None  # ISO UTC when pay unlocks if currently blocked (prepay)


class PropertiesListResponse(BaseModel):
    properties: List["PropertyResponse"]
    property_income_perk_until: Optional[str] = None  # When 10% property income loot perk expires (ISO)
    property_upkeep: Optional[PropertyUpkeepSummary] = None
    property_portfolio_upgrades: Optional[dict] = None
    properties_heat: Optional[dict] = None
    properties_heat_bribe_quote: Optional[dict] = None
    property_portfolio_kill_income_boost_percent: int = 0


class PropertiesHeatBribeRequest(BaseModel):
    amount_cash: int


# Upgrade cost to go from level L→L+1 is price * (L+1) (first buy = price). Each level adds +income_per_hour.
# Seed data should set income_per_hour >= ceil(price * max_level / PROPERTY_TARGET_ROI_HOURS) so the most
# expensive upgrade (L=max-1→max, cost price*max_level) pays back within this many hours at the margin.
PROPERTY_TARGET_ROI_HOURS = 24

# Stacking bonus: +25% per additional property of same type (after first)
STACK_BONUS_PER_EXTRA = 0.25
# Max properties of same type that can stack (extras are auto-sold)
MAX_STACK_COUNT = 3  # Max +50% bonus

# --- Portfolio businesses seized on player kill: permanent collect-income boost + cash overflow ---
PROPERTY_KILL_BOOST_MAX = 20
PROPERTY_KILL_BOOST_FULL_DEED = 2
PROPERTY_KILL_BOOST_PARTIAL_DEED = 1
PROPERTY_KILL_PROGRESS_PARTIAL_MIN = 0.5
PROPERTY_KILL_OVERFLOW_CASH_MULT_FULL = 0.5
PROPERTY_KILL_OVERFLOW_CASH_MULT_PARTIAL = 0.25


def calculate_property_value(prop: dict, level: int) -> int:
    """Calculate total value of a property (base price + all upgrade costs).
    Upgrades cost: price * level_number for each level.
    Total = price * (1 + 2 + 3 + ... + level) = price * level * (level + 1) / 2
    """
    base_price = prop.get("price", 0)
    if level <= 1:
        return base_price
    # Sum of 1 + 2 + 3 + ... + level = level * (level + 1) / 2
    return int(base_price * level * (level + 1) / 2)


def _classify_portfolio_kill_deed(level: int, max_level: int) -> str:
    """Return 'none', 'partial', or 'full' for kill rewards on one user_properties row."""
    cap = int(max_level or 0)
    if cap <= 0:
        return "none"
    lv = max(0, int(level or 0))
    if lv >= cap:
        return "full"
    ratio = lv / cap
    if ratio > PROPERTY_KILL_PROGRESS_PARTIAL_MIN:
        return "partial"
    return "none"


async def process_portfolio_kill_rewards(killer_id: str, victim_id: str, victim_props_rows: list) -> dict:
    """
    Delete victim's progression portfolio rows and grant the killer +1%/+2% toward
    property_portfolio_kill_income_boost_percent (cap 20), or cash when already at cap.
    """
    empty = {
        "cash_from_portfolio": 0,
        "boost_before": 0,
        "boost_after": 0,
        "boost_gained": 0,
        "properties_cleared": 0,
    }
    if not victim_props_rows:
        return empty

    killer = await db.users.find_one(
        {"id": killer_id},
        {"_id": 0, "property_portfolio_kill_income_boost_percent": 1},
    )
    boost = int((killer or {}).get("property_portfolio_kill_income_boost_percent") or 0)
    boost = max(0, min(PROPERTY_KILL_BOOST_MAX, boost))
    boost_before = boost
    total_cash = 0

    rows = sorted(
        victim_props_rows,
        key=lambda r: (str(r.get("property_id") or ""), str(r.get("_id") or "")),
    )
    prop_ids = list({r.get("property_id") for r in rows if r.get("property_id")})
    defs_by_id = {}
    if prop_ids:
        async for p in db.properties.find(
            {"id": {"$in": prop_ids}},
            {"_id": 0, "id": 1, "price": 1, "max_level": 1},
        ):
            pid = p.get("id")
            if pid and p.get("max_level") is not None:
                defs_by_id[pid] = p

    for row in rows:
        pid = row.get("property_id")
        prop_def = defs_by_id.get(pid) if pid else None
        if not prop_def:
            continue
        max_lv = int(prop_def["max_level"])
        level = max(0, int(row.get("level") or 0))
        kind = _classify_portfolio_kill_deed(level, max_lv)
        if kind == "none":
            continue
        val_level = max(1, level)
        if boost >= PROPERTY_KILL_BOOST_MAX:
            mult = (
                PROPERTY_KILL_OVERFLOW_CASH_MULT_FULL
                if kind == "full"
                else PROPERTY_KILL_OVERFLOW_CASH_MULT_PARTIAL
            )
            total_cash += int(mult * calculate_property_value(prop_def, val_level))
        else:
            add = PROPERTY_KILL_BOOST_FULL_DEED if kind == "full" else PROPERTY_KILL_BOOST_PARTIAL_DEED
            boost = min(PROPERTY_KILL_BOOST_MAX, boost + add)

    await db.user_properties.delete_many({"user_id": victim_id})
    await db.users.update_one(
        {"id": killer_id},
        {
            "$set": {"property_portfolio_kill_income_boost_percent": boost},
            "$inc": {"money": int(total_cash)},
        },
    )

    return {
        "cash_from_portfolio": int(total_cash),
        "boost_before": boost_before,
        "boost_after": boost,
        "boost_gained": boost - boost_before,
        "properties_cleared": len(victim_props_rows),
    }


# Streak: +1% income per day collected, up to 7% bonus
MAX_STREAK_DAYS = 7
STREAK_BONUS_PER_DAY = 0.01

# Risk events when income sits at cap for a long time
RISK_HOURS_THRESHOLD = 24.0
RISK_EVENT_CHANCE = 0.20  # 20% when at cap
RISK_LOSS_MIN = 0.10      # 10% loss
RISK_LOSS_MAX = 0.25      # 25% loss

# Reinvest/buff: +10% income for 24h in exchange for points
BUFF_INCOME_MULT = 0.10
BUFF_DURATION_HOURS = 24
BUFF_COST_POINTS = 100
COLLECT_COOLDOWN_MINUTES = 10

# --- Properties heat meter (portfolio-wide) ---
PROPERTIES_HEAT_MAX = 100.0
PROPERTIES_HEAT_BLOCK_THRESHOLD = 80.0
# Net change = rise - decay. Keep both to make it easy to tune later.
PROPERTIES_HEAT_RISE_PER_HOUR = 3.0
PROPERTIES_HEAT_DECAY_PER_HOUR = 1.0
# Bribe conversion: $ paid reduces heat by (amount / dollars_per_heat).
# Kept below property-income scale so upkeep/bribes do not dominate ROI.
PROPERTIES_HEAT_BRIBE_DOLLARS_PER_HEAT = 100_000
PROPERTIES_HEAT_BRIBE_MIN_CASH = 100_000


def _clamp_float(v: float, lo: float, hi: float) -> float:
    try:
        x = float(v)
    except Exception:
        x = lo
    if x < lo:
        return lo
    if x > hi:
        return hi
    return x


def _heat_max_dollars_to_clear(heat: float) -> int:
    """Whole dollars required to reduce heat to 0 at the current rate (never overcharge past this)."""
    h = _clamp_float(heat or 0.0, 0.0, PROPERTIES_HEAT_MAX)
    if h <= 0.0:
        return 0
    return int(math.ceil(h * float(PROPERTIES_HEAT_BRIBE_DOLLARS_PER_HEAT) - 1e-9))


def _properties_heat_tick(heat: float, last_at_iso: Optional[str], now_utc: datetime) -> tuple[float, str]:
    """Apply time-based heat rise/decay since last_at_iso. Returns (new_heat, new_last_at_iso)."""
    last_dt = _parse_iso_datetime(last_at_iso)
    if last_dt is None:
        return _clamp_float(heat or 0.0, 0.0, PROPERTIES_HEAT_MAX), now_utc.isoformat()
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=timezone.utc)
    elapsed_sec = max(0.0, (now_utc - last_dt).total_seconds())
    if elapsed_sec <= 0.0:
        return _clamp_float(heat or 0.0, 0.0, PROPERTIES_HEAT_MAX), now_utc.isoformat()
    hours = elapsed_sec / 3600.0
    net_per_hour = float(PROPERTIES_HEAT_RISE_PER_HOUR) - float(PROPERTIES_HEAT_DECAY_PER_HOUR)
    new_heat = float(heat or 0.0) + net_per_hour * hours
    return _clamp_float(new_heat, 0.0, PROPERTIES_HEAT_MAX), now_utc.isoformat()


def _properties_heat_bribe_quote(heat: float) -> dict:
    h = _clamp_float(heat or 0.0, 0.0, PROPERTIES_HEAT_MAX)
    rate = float(PROPERTIES_HEAT_BRIBE_DOLLARS_PER_HEAT)
    target_heat = max(0.0, float(PROPERTIES_HEAT_BLOCK_THRESHOLD) - 5.0)
    need_above_target = max(0.0, h - target_heat)
    clear_all = _heat_max_dollars_to_clear(h)
    to_safe_only = int(math.ceil(need_above_target * rate - 1e-9)) if need_above_target > 0.0 else 0
    if h <= 0.0:
        suggested = 0
    elif need_above_target > 0.0 and to_safe_only > 0:
        suggested = min(clear_all, to_safe_only)
    else:
        # Already below "safe" line — only pay to clear residual heat (not a flat $100k floor).
        suggested = clear_all
    # Minimum request: $100k rule only when clearing would cost that much; tiny heat = tiny minimum.
    if clear_all <= 0:
        min_bribe = 0
    elif clear_all < PROPERTIES_HEAT_BRIBE_MIN_CASH:
        min_bribe = max(1, clear_all)
    else:
        min_bribe = int(PROPERTIES_HEAT_BRIBE_MIN_CASH)
    return {
        "dollars_per_heat": int(PROPERTIES_HEAT_BRIBE_DOLLARS_PER_HEAT),
        "min_bribe": min_bribe,
        "suggested_bribe": suggested,
        "max_charge_to_clear": clear_all,
        "block_threshold": float(PROPERTIES_HEAT_BLOCK_THRESHOLD),
        "heat_max": float(PROPERTIES_HEAT_MAX),
    }
# --- Property Portfolio Upgrades (permanent progression) ---
# Multiplicative boosts applied to property income collections (and optionally to upkeep baseline).
PROPERTY_PORTFOLIO_UPGRADE_TIERS = [
    {
        "tier": 1,
        "name": "Bookkeeping",
        "income_mult": 1.15,
        "unlock": {"collect_all_sets": 5, "collect_total_cash": 10_000_000},
        "cost_cash": 5_000_000,
    },
    {
        "tier": 2,
        "name": "Hiring Managers",
        "income_mult": 1.15,
        "unlock": {"collect_all_sets": 12, "collect_total_cash": 35_000_000},
        "cost_cash": 15_000_000,
    },
    {
        "tier": 3,
        "name": "Supplier Contracts",
        "income_mult": 1.20,
        "unlock": {"collect_all_sets": 22, "collect_total_cash": 85_000_000, "collect_actions": 150},
        "cost_cash": 40_000_000,
    },
    {
        "tier": 4,
        "name": "Expansion Team",
        "income_mult": 1.20,
        "unlock": {"collect_all_sets": 35, "collect_total_cash": 175_000_000, "collect_actions": 350},
        "cost_cash": 90_000_000,
    },
    {
        "tier": 5,
        "name": "Corporate Structure",
        "income_mult": 1.25,
        "unlock": {"collect_all_sets": 55, "collect_total_cash": 350_000_000, "collect_actions": 700},
        "cost_cash": 200_000_000,
    },
]


def _portfolio_upgrade_tier_max() -> int:
    try:
        return int(max(t.get("tier", 0) for t in PROPERTY_PORTFOLIO_UPGRADE_TIERS))
    except Exception:
        return 0


def _portfolio_upgrade_mult_from_tier(purchased_tier: int) -> float:
    """Multiplicative income multiplier from purchased tier (tiers are applied in order)."""
    t = max(0, int(purchased_tier or 0))
    if t <= 0:
        return 1.0
    mult = 1.0
    for row in PROPERTY_PORTFOLIO_UPGRADE_TIERS:
        tier = int(row.get("tier") or 0)
        if 1 <= tier <= t:
            try:
                mult *= float(row.get("income_mult") or 1.0)
            except Exception:
                pass
    # Guard against nonsense values
    return max(1.0, min(10.0, float(mult)))


def _portfolio_progress_get(progress: dict, key: str) -> int:
    try:
        v = (progress or {}).get(key, 0)
        return int(v) if v is not None else 0
    except Exception:
        return 0


def _portfolio_unlocks_met(progress: dict, unlock_req: dict) -> bool:
    req = unlock_req or {}
    for k, target in req.items():
        try:
            tgt = int(target or 0)
        except Exception:
            tgt = 0
        if _portfolio_progress_get(progress, k) < tgt:
            return False
    return True


def _portfolio_unlocked_tier_from_progress(progress: dict) -> int:
    unlocked = 0
    for row in PROPERTY_PORTFOLIO_UPGRADE_TIERS:
        tier = int(row.get("tier") or 0)
        if tier <= 0:
            continue
        if _portfolio_unlocks_met(progress, row.get("unlock") or {}):
            unlocked = max(unlocked, tier)
    return unlocked

# --- Weekly property upkeep (UTC; hybrid income + wealth — see docs/PROPERTY_UPKEEP.md) ---
PROPERTY_UPKEEP_BILLING_DAYS = 7
PROPERTY_UPKEEP_HOURS_PER_WEEK = 168
# Pay button only when overdue or within this many hours before coverage ends (blocks deep prepay).
PROPERTY_UPKEEP_PAY_WINDOW_HOURS = 48
# Baseline = sum of (effective $/hr × 168) with no streak/perk/founding/loot multipliers (matches UI effective income/hr).
PROPERTY_UPKEEP_INCOME_SHARE = 0.10
PROPERTY_UPKEEP_WEALTH_SHARE = 0.002
PROPERTY_UPKEEP_MIN_WEEKLY = 250


def _upkeep_pay_eligibility(
    paid_until_dt: Optional[datetime],
    now_utc: datetime,
    overdue: bool,
) -> tuple[bool, Optional[datetime]]:
    """Allow pay if overdue, or no date, or within PROPERTY_UPKEEP_PAY_WINDOW_HOURS of coverage end. Else block prepay."""
    if overdue:
        return True, None
    if not paid_until_dt:
        return True, None
    if now_utc > paid_until_dt:
        return True, None
    remaining_sec = (paid_until_dt - now_utc).total_seconds()
    win_sec = PROPERTY_UPKEEP_PAY_WINDOW_HOURS * 3600
    if remaining_sec > win_sec:
        eligible = paid_until_dt - timedelta(hours=PROPERTY_UPKEEP_PAY_WINDOW_HOURS)
        return False, eligible
    return True, None


def _property_order(properties: list) -> list:
    """Return properties in progression order (first = worst pay, last = best)."""
    # Filter out any properties missing required "id" field
    properties = [p for p in properties if p.get("id")]
    by_id = {p["id"]: p for p in properties}
    ordered = []
    next_id = None
    for _ in range(len(properties) + 1):
        if next_id is None:
            for p in properties:
                if p.get("required_property_id") is None:
                    ordered.append(p)
                    next_id = p.get("id")
                    break
        else:
            for p in properties:
                if p.get("required_property_id") == next_id:
                    ordered.append(p)
                    next_id = p.get("id")
                    break
            else:
                break
    # Append any not in chain (e.g. legacy props)
    for p in properties:
        if p not in ordered:
            ordered.append(p)
    return ordered


async def _compute_property_upkeep_details(user_id: str) -> dict:
    """Weekly upkeep from hybrid formula (no streak/perk/founding multipliers)."""
    # Include permanent portfolio upgrades in baseline so upkeep scales with boosted income.
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "property_portfolio_upgrade_tier": 1})
    portfolio_mult = _portfolio_upgrade_mult_from_tier(int((u or {}).get("property_portfolio_upgrade_tier") or 0))
    properties = await db.properties.find(
        {
            "price": {"$exists": True},
            "income_per_hour": {"$exists": True},
            "max_level": {"$exists": True},
            "property_type": {"$exists": True},
            "for_sale": {"$ne": True},
        },
        {"_id": 0},
    ).to_list(100)
    properties = _property_order(properties)
    user_properties = await db.user_properties.find({"user_id": user_id}, {"_id": 0}).to_list(100)
    by_pid = {}
    for up in user_properties:
        pid = up["property_id"]
        if pid not in by_pid:
            by_pid[pid] = []
        by_pid[pid].append(up)
    weekly_baseline = 0.0
    portfolio_value = 0
    for prop in properties:
        if not all(k in prop for k in ("id", "price", "income_per_hour", "max_level")):
            continue
        user_props_list = by_pid.get(prop["id"], [])
        if not user_props_list:
            continue
        owned_count = len(user_props_list)
        total_level = sum(max(0, int(up.get("level") or 0)) for up in user_props_list)
        if total_level < 1:
            continue
        stack_mult = 1.0 + (owned_count - 1) * STACK_BONUS_PER_EXTRA if owned_count > 1 else 1.0
        eff_iph = float(prop["income_per_hour"]) * float(total_level) * stack_mult
        if portfolio_mult > 1.0:
            eff_iph *= float(portfolio_mult)
        weekly_baseline += eff_iph * float(PROPERTY_UPKEEP_HOURS_PER_WEEK)
        for up in user_props_list:
            lv = max(0, int(up.get("level") or 0))
            if lv < 1:
                continue
            portfolio_value += calculate_property_value(prop, lv)
    raw = (
        PROPERTY_UPKEEP_INCOME_SHARE * weekly_baseline
        + PROPERTY_UPKEEP_WEALTH_SHARE * float(portfolio_value)
    )
    weekly_amount = 0
    if weekly_baseline > 0 or portfolio_value > 0:
        weekly_amount = max(PROPERTY_UPKEEP_MIN_WEEKLY, int(math.ceil(raw)))
    return {
        "weekly_amount": weekly_amount,
        "weekly_baseline_gross": int(weekly_baseline),
        "portfolio_value": portfolio_value,
    }


async def _ensure_property_upkeep_paid_until(user_id: str) -> None:
    """First-time owners of progression properties get a paid window (lazy init)."""
    props = await db.properties.find(
        {
            "price": {"$exists": True},
            "income_per_hour": {"$exists": True},
            "max_level": {"$exists": True},
            "property_type": {"$exists": True},
            "for_sale": {"$ne": True},
        },
        {"id": 1},
    ).to_list(100)
    ids = [p["id"] for p in props if p.get("id")]
    if not ids:
        return
    n = await db.user_properties.count_documents({"user_id": user_id, "property_id": {"$in": ids}})
    if n == 0:
        return
    user = await db.users.find_one({"id": user_id}, {"property_upkeep_paid_until": 1})
    if user and user.get("property_upkeep_paid_until"):
        return
    until = datetime.now(timezone.utc) + timedelta(days=PROPERTY_UPKEEP_BILLING_DAYS)
    await db.users.update_one({"id": user_id}, {"$set": {"property_upkeep_paid_until": until.isoformat()}})


async def get_properties(current_user: dict = Depends(get_current_user)):
    # db.properties also stores sell-on-trade listings (casinos/airports/armouries).
    # The properties page should only use canonical progression properties.
    user_id = current_user["id"]
    await _ensure_property_upkeep_paid_until(user_id)
    # Tick heat for UI display (and persist best-effort)
    now_utc = datetime.now(timezone.utc)
    heat_row = await db.users.find_one(
        {"id": user_id},
        {
            "_id": 0,
            "property_upkeep_paid_until": 1,
            "properties_heat": 1,
            "properties_heat_last_at": 1,
            "property_portfolio_kill_income_boost_percent": 1,
        },
    )
    ticked_heat, _ = _properties_heat_tick(
        float((heat_row or {}).get("properties_heat") or 0.0),
        (heat_row or {}).get("properties_heat_last_at"),
        now_utc,
    )
    # Do not persist ticked heat on GET. A concurrent read (this request) plus write would race
    # with bribe/collect: stale ticked values can overwrite a fresh bribe and make heat appear unchanged.
    user_row = heat_row or {"property_upkeep_paid_until": None}
    kill_pct = max(0, min(20, int((user_row or {}).get("property_portfolio_kill_income_boost_percent") or 0)))
    kill_mult = 1.0 + kill_pct / 100.0
    upkeep_details = await _compute_property_upkeep_details(user_id)
    paid_until_dt = _parse_iso_datetime((user_row or {}).get("property_upkeep_paid_until"))
    weekly_amt = int(upkeep_details["weekly_amount"])
    overdue = bool(weekly_amt > 0 and paid_until_dt and now_utc > paid_until_dt)
    income_blocked = overdue
    can_pay, pay_eligible_dt = _upkeep_pay_eligibility(paid_until_dt, now_utc, overdue)
    pay_eligible_at = pay_eligible_dt.isoformat() if pay_eligible_dt else None
    properties = await db.properties.find(
        {
            "price": {"$exists": True},
            "income_per_hour": {"$exists": True},
            "max_level": {"$exists": True},
            "property_type": {"$exists": True},
            "for_sale": {"$ne": True},
        },
        {"_id": 0},
    ).to_list(100)
    properties = _property_order(properties)
    user_properties = await db.user_properties.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(100)
    # Group user properties by property_id to count duplicates (from kills)
    properties_by_id = {}
    for up in user_properties:
        pid = up["property_id"]
        if pid not in properties_by_id:
            properties_by_id[pid] = []
        properties_by_id[pid].append(up)
    result = []
    purchased_tier = int(current_user.get("property_portfolio_upgrade_tier") or 0)
    unlocked_tier = int(current_user.get("property_portfolio_upgrade_unlocked_tier") or 0)
    progress = dict(current_user.get("property_portfolio_upgrade_progress") or {})
    portfolio_mult = _portfolio_upgrade_mult_from_tier(purchased_tier)
    for prop in properties:
        # Defensive guard against malformed docs to avoid 500s in production.
        if not all(k in prop for k in ("id", "name", "property_type", "price", "income_per_hour", "max_level")):
            continue
        user_props_list = properties_by_id.get(prop["id"], [])
        owned_count = len(user_props_list)
        owned = owned_count > 0
        # Use the first (or best) property for display; sum income from all
        user_prop = user_props_list[0] if owned else None
        # Calculate total level and available income across all owned copies
        total_level = sum(max(0, int(up.get("level") or 0)) for up in user_props_list) if owned else 0
        level = user_prop["level"] if owned else 0  # Display level of first one
        available_income = 0.0
        hours_since_collect = 0.0
        streak_days = int(user_prop.get("collection_streak_days") or 0) if owned else 0
        buff_label = None
        # Stack bonus: +25% per extra property beyond the first
        stack_bonus_pct = int((owned_count - 1) * STACK_BONUS_PER_EXTRA * 100) if owned_count > 1 else 0
        stack_mult = 1.0 + (owned_count - 1) * STACK_BONUS_PER_EXTRA if owned_count > 1 else 1.0
        # Calculate available income from ALL owned copies of this property
        for up in user_props_list:
            up_level = max(0, int(up.get("level") or 0))
            last_collected = _parse_iso_datetime(up.get("last_collected"))
            if not last_collected:
                last_collected = datetime.now(timezone.utc)
            up_hours = max(0.0, (datetime.now(timezone.utc) - last_collected).total_seconds() / 3600)
            up_income = min(
                up_hours * prop["income_per_hour"] * up_level,
                prop["income_per_hour"] * up_level * 24,
            )
            available_income += up_income
            if up == user_prop:
                hours_since_collect = up_hours
        # Apply stack bonus to available income
        available_income *= stack_mult
        # Buff metadata (per-property income buff) - check first property
        income_buff_until = None
        if owned:
            income_buff_until = _parse_iso_datetime(user_prop.get("income_buff_until"))
        if income_buff_until and income_buff_until > datetime.now(timezone.utc):
            buff_label = "+10% reinvest bonus"
        if stack_bonus_pct > 0:
            buff_label = (buff_label + f" +{stack_bonus_pct}% stack" if buff_label else f"+{stack_bonus_pct}% stack bonus")
        required_property_id = prop.get("required_property_id")
        required_property_name = None
        locked = False
        if required_property_id:
            req_prop = next((p for p in properties if p["id"] == required_property_id), None)
            required_property_name = req_prop["name"] if req_prop else required_property_id
            req_user_list = properties_by_id.get(required_property_id, [])
            req_max_level = sum(max(0, int(up.get("level") or 0)) for up in req_user_list)
            if not req_user_list or req_max_level < (req_prop["max_level"] if req_prop else 0):
                locked = True
        # Effective income/hr = base * total_level * stack_mult (so stacking shows increased rate)
        effective_income_per_hour = int(prop["income_per_hour"] * total_level * stack_mult) if owned and total_level >= 1 else prop["income_per_hour"]
        # Apply purchased portfolio upgrades multiplier (display + collection should align).
        if owned and portfolio_mult > 1.0:
            available_income *= portfolio_mult
            effective_income_per_hour = int(effective_income_per_hour * portfolio_mult)
        if owned and kill_mult > 1.0:
            available_income *= kill_mult
            effective_income_per_hour = int(round(effective_income_per_hour * kill_mult))
        streak_bonus_mult = 1.0 + min(MAX_STREAK_DAYS, max(0, streak_days)) * STREAK_BONUS_PER_DAY if owned else 1.0
        cap_single = int(prop["max_level"])
        max_total_level = cap_single * max(1, owned_count)
        can_upgrade = False
        next_cost: Optional[int] = None
        if owned and user_props_list:
            upgradable = [up for up in user_props_list if max(0, int(up.get("level") or 0)) < cap_single]
            can_upgrade = len(upgradable) > 0
            if can_upgrade:
                lowest = min(upgradable, key=lambda u: max(0, int(u.get("level") or 0)))
                lv = max(0, int(lowest.get("level") or 0))
                next_cost = int(prop["price"]) * (lv + 1)
        disp_income = 0.0 if (income_blocked and owned) else available_income
        result.append(PropertyResponse(
            id=prop["id"],
            name=prop["name"],
            property_type=prop["property_type"],
            price=prop["price"],
            income_per_hour=effective_income_per_hour,
            max_level=prop["max_level"],
            owned=owned,
            level=total_level,  # Sum of levels across copies (stacking)
            available_income=disp_income,
            locked=locked,
            required_property_name=required_property_name,
            collection_streak_days=streak_days,
            streak_bonus_mult=streak_bonus_mult,
            hours_since_collect=hours_since_collect,
            buff_label=buff_label,
            owned_count=owned_count,
            stack_bonus_pct=stack_bonus_pct,
            max_total_level=max_total_level,
            can_upgrade=can_upgrade,
            next_upgrade_cost=next_cost,
            income_collection_blocked=income_blocked and owned,
        ))
    pu = PropertyUpkeepSummary(
        paid_until=(user_row or {}).get("property_upkeep_paid_until"),
        weekly_amount=weekly_amt,
        weekly_baseline_gross=int(upkeep_details["weekly_baseline_gross"]),
        portfolio_value=int(upkeep_details["portfolio_value"]),
        overdue=overdue,
        income_collection_blocked=income_blocked,
        billing_days=PROPERTY_UPKEEP_BILLING_DAYS,
        income_share=PROPERTY_UPKEEP_INCOME_SHARE,
        wealth_share=PROPERTY_UPKEEP_WEALTH_SHARE,
        can_pay=can_pay,
        pay_window_hours=PROPERTY_UPKEEP_PAY_WINDOW_HOURS,
        pay_eligible_at=pay_eligible_at,
    )
    # Build upgrades block for UI
    # Note: unlocked_tier might lag if user is mid-progress; we also compute a derived unlocked tier.
    derived_unlocked = _portfolio_unlocked_tier_from_progress(progress)
    if derived_unlocked > unlocked_tier:
        unlocked_tier = derived_unlocked
    tier_max = _portfolio_upgrade_tier_max()
    # Next purchasable tier is purchased+1 only while below max (min(..., max) was wrong: at tier 5 it showed 5 again).
    if purchased_tier >= tier_max:
        next_tier = None
        next_row = None
    else:
        next_tier = max(0, purchased_tier) + 1
        next_row = next((t for t in PROPERTY_PORTFOLIO_UPGRADE_TIERS if int(t.get("tier") or 0) == next_tier), None)
        if not next_row:
            next_tier = None
    upgrades_block = {
        "purchased_tier": purchased_tier,
        "unlocked_tier": unlocked_tier,
        "portfolio_mult": round(float(portfolio_mult), 6),
        "tiers": PROPERTY_PORTFOLIO_UPGRADE_TIERS,
        "progress": {
            "collect_actions": _portfolio_progress_get(progress, "collect_actions"),
            "collect_total_cash": _portfolio_progress_get(progress, "collect_total_cash"),
            "collect_all_sets": _portfolio_progress_get(progress, "collect_all_sets"),
        },
        "next_tier": next_tier,
        "next_unlock": (next_row or {}).get("unlock") if next_row else None,
        "next_cost_cash": (next_row or {}).get("cost_cash") if next_row else None,
        "next_income_mult": (next_row or {}).get("income_mult") if next_row else None,
    }
    heat_blocked = bool(ticked_heat >= float(PROPERTIES_HEAT_BLOCK_THRESHOLD))
    heat_block = {
        "heat": round(float(ticked_heat), 3),
        "blocked": heat_blocked,
        "threshold": float(PROPERTIES_HEAT_BLOCK_THRESHOLD),
        "heat_max": float(PROPERTIES_HEAT_MAX),
    }
    return PropertiesListResponse(
        properties=result,
        property_income_perk_until=current_user.get("property_income_perk_until"),
        property_upkeep=pu,
        property_portfolio_upgrades=upgrades_block,
        properties_heat=heat_block,
        properties_heat_bribe_quote=_properties_heat_bribe_quote(ticked_heat),
        property_portfolio_kill_income_boost_percent=kill_pct,
    )


async def buy_property(property_id: str, current_user: dict = Depends(get_current_user)):
    prop = await db.properties.find_one(
        {
            "id": property_id,
            "price": {"$exists": True},
            "income_per_hour": {"$exists": True},
            "max_level": {"$exists": True},
            "property_type": {"$exists": True},
            "for_sale": {"$ne": True},
        },
        {"_id": 0},
    )
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    cap = int(prop["max_level"])
    owned_rows = await db.user_properties.find(
        {"user_id": current_user["id"], "property_id": property_id},
        {"_id": 1, "level": 1},
    ).sort("level", 1).to_list(100)
    user_prop = None  # target row for upgrade (lowest level below cap)
    if owned_rows:
        for row in owned_rows:
            if max(0, int(row.get("level") or 0)) < cap:
                user_prop = row
                break
    if user_prop is not None:
        lvl = max(0, int(user_prop.get("level") or 0))
        cost = prop["price"] * (lvl + 1)
    elif owned_rows:
        raise HTTPException(status_code=400, detail="Property already at max level")
    else:
        # First-time buy: must have previous property at max level
        required_property_id = prop.get("required_property_id")
        if required_property_id:
            req_prop = await db.properties.find_one({"id": required_property_id}, {"_id": 0, "name": 1, "max_level": 1})
            req_user = await db.user_properties.find_one(
                {"user_id": current_user["id"], "property_id": required_property_id},
                {"_id": 0, "level": 1}
            )
            if not req_user or req_user["level"] < (req_prop["max_level"] if req_prop else 0):
                name = req_prop["name"] if req_prop else required_property_id
                raise HTTPException(
                    status_code=403,
                    detail=f"Max out {name} (reach max level) to unlock this property.",
                )
        cost = prop["price"]
    result = await db.users.update_one(
        {"id": current_user["id"], "money": {"$gte": cost}},
        {"$inc": {"money": -cost}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient money")
    if user_prop is not None:
        await db.user_properties.update_one(
            {"_id": user_prop["_id"]},
            {"$inc": {"level": 1}},
        )
    else:
        await db.user_properties.insert_one({
            "user_id": current_user["id"],
            "property_id": property_id,
            "level": 1,
            "last_collected": datetime.now(timezone.utc).isoformat()
        })
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.economy_events.insert_one({
        "at": now_iso,
        "type": "property_buy",
        "user_id": current_user["id"],
        "username": current_user.get("username") or "",
        "property_id": property_id,
        "property_name": (prop or {}).get("name") or property_id,
        "cost": cost,
        "level": 1 if not owned_rows else (user_prop.get("level") or 0) + 1,
    })
    await log_activity(current_user.get("id", ""), current_user.get("username", ""), "property_buy", {"property": prop.get("name", property_id), "cost": cost})
    return {"message": f"Successfully purchased/upgraded {prop['name']}"}


async def collect_property_income(property_id: str, current_user: dict = Depends(get_current_user)):
    prop = await db.properties.find_one(
        {
            "id": property_id,
            "price": {"$exists": True},
            "income_per_hour": {"$exists": True},
            "max_level": {"$exists": True},
            "property_type": {"$exists": True},
            "for_sale": {"$ne": True},
        },
        {"_id": 0},
    )
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    # Find ALL copies of this property type owned by user (from kills)
    user_props_list = await db.user_properties.find(
        {"user_id": current_user["id"], "property_id": property_id},
    ).to_list(100)
    if not user_props_list:
        raise HTTPException(status_code=404, detail="You don't own this property")
    owned_count = len(user_props_list)
    now_utc = datetime.now(timezone.utc)
    user_id = current_user["id"]
    # Tick heat and block collections when too high (police seize income)
    heat_row = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "properties_heat": 1, "properties_heat_last_at": 1},
    )
    ticked_heat, ticked_last = _properties_heat_tick(
        float((heat_row or {}).get("properties_heat") or 0.0),
        (heat_row or {}).get("properties_heat_last_at"),
        now_utc,
    )
    try:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"properties_heat": ticked_heat, "properties_heat_last_at": ticked_last}},
        )
    except Exception:
        pass
    if float(ticked_heat) >= float(PROPERTIES_HEAT_BLOCK_THRESHOLD):
        raise HTTPException(
            status_code=400,
            detail="Police heat is too high — your business income is being seized. Bribe the police on the Properties page to resume collections.",
        )
    await _ensure_property_upkeep_paid_until(user_id)
    user_row = await db.users.find_one({"id": user_id}, {"property_upkeep_paid_until": 1})
    upkeep_det = await _compute_property_upkeep_details(user_id)
    if upkeep_det["weekly_amount"] > 0:
        pt = _parse_iso_datetime((user_row or {}).get("property_upkeep_paid_until"))
        if pt and now_utc > pt:
            raise HTTPException(
                status_code=400,
                detail="Property upkeep is overdue. Pay weekly upkeep on the Properties page to collect income.",
            )
    # Calculate stack bonus: +25% per extra property
    stack_mult = 1.0 + (owned_count - 1) * STACK_BONUS_PER_EXTRA if owned_count > 1 else 1.0
    # Calculate total income from ALL copies
    total_income = 0.0
    total_base_cap = 0.0
    max_hours_passed = 0.0
    min_hours_passed = float("inf")
    now_iso = now_utc.isoformat()
    first_user_prop = None
    for user_prop in user_props_list:
        if first_user_prop is None:
            first_user_prop = user_prop
        last_collected = _parse_iso_datetime(user_prop.get("last_collected"))
        if not last_collected:
            last_collected = now_utc
        hours_passed = (now_utc - last_collected).total_seconds() / 3600
        max_hours_passed = max(max_hours_passed, hours_passed)
        min_hours_passed = min(min_hours_passed, hours_passed)
        level = max(0, int(user_prop.get("level") or 0))
        base_income_cap = prop["income_per_hour"] * level * 24
        total_base_cap += base_income_cap
        up_income = min(hours_passed * prop["income_per_hour"] * level, base_income_cap)
        total_income += up_income
    if not first_user_prop:
        raise HTTPException(status_code=404, detail="You don't own this property")
    cooldown_hours = COLLECT_COOLDOWN_MINUTES / 60.0
    if min_hours_passed < cooldown_hours:
        mins_left = max(1, int((cooldown_hours - min_hours_passed) * 60))
        raise HTTPException(
            status_code=400,
            detail=f"You can collect every {COLLECT_COOLDOWN_MINUTES} minutes. Try again in {mins_left} minute(s).",
        )
    if total_income < 1:
        raise HTTPException(status_code=400, detail="No income to collect yet")

    cooldown_threshold_dt = now_utc - timedelta(minutes=COLLECT_COOLDOWN_MINUTES)
    cooldown_threshold_iso = cooldown_threshold_dt.isoformat()
    claim_result = await db.user_properties.update_many(
        {
            "user_id": current_user["id"],
            "property_id": property_id,
            "$or": [
                {"last_collected": {"$lte": cooldown_threshold_iso}},
                {"last_collected": {"$exists": False}},
            ],
        },
        {"$set": {"last_collected": now_iso}},
    )
    if claim_result.modified_count == 0:
        raise HTTPException(
            status_code=400,
            detail=f"You can collect every {COLLECT_COOLDOWN_MINUTES} minutes. Try again shortly.",
        )

    # Apply stack bonus
    income = total_income * stack_mult
    perk_until = _parse_iso_datetime(current_user.get("property_income_perk_until"))
    if perk_until and now_utc < perk_until:
        income = income * 1.1
    properties_until = _parse_iso_datetime(current_user.get("properties_until"))
    if properties_until and now_utc < properties_until:
        income = income * 3
    # Streak bonus: +1% income per consecutive day (up to MAX_STREAK_DAYS) - use first property's streak
    streak_days = int(first_user_prop.get("collection_streak_days") or 0)
    hours_passed = max_hours_passed  # Use max hours for streak calculation
    if streak_days <= 0:
        streak_days = 1
    else:
        if hours_passed >= 24.0 and hours_passed <= 48.0:
            streak_days = min(MAX_STREAK_DAYS, streak_days + 1)
        elif hours_passed > 48.0:
            streak_days = 1
    if streak_days > 0:
        income *= 1.0 + streak_days * STREAK_BONUS_PER_DAY
    # Per-property reinvest buff (check first property)
    buff_until_dt = _parse_iso_datetime(first_user_prop.get("income_buff_until"))
    buff_active = False
    if buff_until_dt and now_utc < buff_until_dt:
        income *= 1.0 + BUFF_INCOME_MULT
        buff_active = True
    # Risk event: if money has been capped for a while, chance to lose a slice
    risk_event = None
    if hours_passed >= RISK_HOURS_THRESHOLD and total_income >= total_base_cap * 0.99:
        if _rng.random() < RISK_EVENT_CHANCE:
            loss_pct = _rng.uniform(RISK_LOSS_MIN, RISK_LOSS_MAX)
            loss_amount = income * loss_pct
            income -= loss_amount
            risk_event = {
                "loss_pct": round(loss_pct * 100, 1),
                "loss_amount": round(loss_amount, 2),
                "message": f"A raid hit {prop['name']}. You lost ${loss_amount:,.0f} ({loss_pct*100:.1f}% of stored income).",
            }
    # Apply permanent property portfolio upgrades
    purchased_tier = int(current_user.get("property_portfolio_upgrade_tier") or 0)
    portfolio_mult = _portfolio_upgrade_mult_from_tier(purchased_tier)
    if portfolio_mult > 1.0:
        income *= portfolio_mult
    u_kill = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "property_portfolio_kill_income_boost_percent": 1},
    )
    kill_pct = max(0, min(20, int((u_kill or {}).get("property_portfolio_kill_income_boost_percent") or 0)))
    if kill_pct > 0:
        income *= 1.0 + kill_pct / 100.0
    income *= founding_member_income_mult(current_user)
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$inc": {"money": income}}
    )
    await db.user_properties.update_many(
        {"user_id": current_user["id"], "property_id": property_id},
        {"$set": {"collection_streak_days": streak_days}}
    )
    message = f"Collected ${income:,.2f}"
    if owned_count > 1:
        message += f" from {owned_count}x {prop['name']} (+{int((owned_count - 1) * STACK_BONUS_PER_EXTRA * 100)}% stack bonus)"
    if streak_days > 1:
        message += f" (streak {streak_days} days)"
    if buff_active:
        message += " with reinvest bonus."
    if risk_event and risk_event.get("message"):
        message += f" {risk_event['message']}"
    await log_activity(current_user.get("id", ""), current_user.get("username", ""), "property_collect", {"property": prop.get("name", property_id), "income": round(income, 2), "owned_count": owned_count})
    # ---- Permanent property upgrade progression tracking ----
    try:
        # Fetch current counters from DB (avoid stale current_user)
        uprog = await db.users.find_one(
            {"id": user_id},
            {
                "_id": 0,
                "property_portfolio_upgrade_progress": 1,
                "property_portfolio_upgrade_unlocked_tier": 1,
            },
        )
        progress = dict((uprog or {}).get("property_portfolio_upgrade_progress") or {})
        collect_actions = _portfolio_progress_get(progress, "collect_actions") + 1
        collect_total_cash = _portfolio_progress_get(progress, "collect_total_cash") + int(income or 0)
        collect_all_sets = _portfolio_progress_get(progress, "collect_all_sets")
        seen = set(progress.get("collect_all_seen_property_ids") or [])
        seen.add(property_id)
        # Owned property ids (distinct) for this user
        owned_rows = await db.user_properties.find(
            {"user_id": user_id},
            {"_id": 0, "property_id": 1, "level": 1},
        ).to_list(200)
        owned_ids = {r.get("property_id") for r in owned_rows if r.get("property_id") and int(r.get("level") or 0) > 0}
        if owned_ids and owned_ids.issubset(seen):
            collect_all_sets += 1
            seen = set()
        progress["collect_actions"] = int(collect_actions)
        progress["collect_total_cash"] = int(collect_total_cash)
        progress["collect_all_sets"] = int(collect_all_sets)
        progress["collect_all_seen_property_ids"] = sorted(list(seen))
        derived_unlocked = _portfolio_unlocked_tier_from_progress(progress)
        existing_unlocked = int((uprog or {}).get("property_portfolio_upgrade_unlocked_tier") or 0)
        new_unlocked = max(existing_unlocked, derived_unlocked)
        await db.users.update_one(
            {"id": user_id},
            {
                "$set": {
                    "property_portfolio_upgrade_progress": progress,
                    "property_portfolio_upgrade_unlocked_tier": new_unlocked,
                }
            },
        )
    except Exception:
        # Never break collections because objective tracking failed.
        pass
    return {
        "message": message,
        "streak_days": streak_days,
        "risk_event": risk_event,
        "buff_active": buff_active,
        "owned_count": owned_count,
        "stack_bonus_pct": int((owned_count - 1) * STACK_BONUS_PER_EXTRA * 100) if owned_count > 1 else 0,
    }


def register(router):
    import server as srv
    get_current_user = srv.get_current_user
    _user_owns_any_casino = srv._user_owns_any_casino
    _user_owns_all_casinos = srv._user_owns_all_casinos
    _user_owns_airport = srv._user_owns_airport
    _user_owns_bullet_factory = srv._user_owns_bullet_factory
    _user_owns_garage_dealership = srv._user_owns_garage_dealership
    _user_owns_sports_betting_book = srv._user_owns_sports_betting_book
    from routers.kill.armoury import get_bullet_factory
    from routers.cars.gta import get_garage_dealership_status
    from routers.casinos.sports_betting import get_sports_betting_ownership_status

    async def get_my_properties(current_user: dict = Depends(get_current_user)):
        """Return current user's casino (if any), airport, armoury, car dealership, and/or sports betting book."""
        user_id = current_user["id"]
        casinos, airport, armoury, garage_dealership, sports_betting_book, urow = await asyncio.gather(
            _user_owns_all_casinos(user_id),
            _user_owns_airport(user_id),
            _user_owns_bullet_factory(user_id),
            _user_owns_garage_dealership(user_id),
            _user_owns_sports_betting_book(user_id),
            db.users.find_one({"id": user_id}, {"points": 1}),
        )
        casino = casinos[0] if casinos else None
        property_ = airport or armoury or garage_dealership or sports_betting_book
        points = int((urow or {}).get("points") or 0)
        armoury_detail = None
        garage_dealership_detail = None
        sports_betting_detail = None
        if armoury and armoury.get("state"):
            try:
                armoury_detail = await get_bullet_factory(state=armoury["state"], current_user=current_user)
            except Exception:
                armoury_detail = None
        if garage_dealership:
            try:
                garage_dealership_detail = await get_garage_dealership_status(current_user=current_user)
            except Exception:
                garage_dealership_detail = None
        if sports_betting_book:
            try:
                sports_betting_detail = await get_sports_betting_ownership_status(current_user=current_user)
            except Exception:
                sports_betting_detail = None
        return {
            "casino": casino,
            "casinos": casinos,
            "property": property_,
            "airport": airport,
            "armoury": armoury,
            "armoury_detail": armoury_detail,
            "garage_dealership": garage_dealership,
            "garage_dealership_detail": garage_dealership_detail,
            "sports_betting": sports_betting_book,
            "sports_betting_detail": sports_betting_detail,
            "points": points,
        }

    async def reinvest_property(property_id: str, current_user: dict = Depends(get_current_user)):
        """Spend points to boost a property's income for 24 hours."""
        prop = await db.properties.find_one({"id": property_id}, {"_id": 0})
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found")
        user_prop = await db.user_properties.find_one(
            {"user_id": current_user["id"], "property_id": property_id},
            {"_id": 0},
        )
        if not user_prop:
            raise HTTPException(status_code=404, detail="You don't own this property")
        points = int(current_user.get("points") or 0)
        if points < BUFF_COST_POINTS:
            raise HTTPException(
                status_code=400,
                detail=f"You need {BUFF_COST_POINTS:,} points to reinvest in this business.",
            )
        now_utc = datetime.now(timezone.utc)
        buff_until = now_utc + timedelta(hours=BUFF_DURATION_HOURS)
        result = await db.users.update_one(
            {"id": current_user["id"], "points": {"$gte": BUFF_COST_POINTS}},
            {"$inc": {"points": -BUFF_COST_POINTS}},
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail="Insufficient points")
        await log_points_event(db, user_id=current_user["id"], points=-BUFF_COST_POINTS, event_type="property_buff", meta={"property_id": property_id, "property_name": prop["name"]})
        await db.user_properties.update_one(
            {"user_id": current_user["id"], "property_id": property_id},
            {"$set": {"income_buff_until": buff_until.isoformat()}},
        )
        await log_activity(current_user["id"], current_user.get("username", "?"), "property_reinvest", {"property": prop["name"], "cost_points": BUFF_COST_POINTS})
        return {
            "message": f"Reinvested {BUFF_COST_POINTS:,} points into {prop['name']} — income +10% for 24 hours.",
            "buff_until": buff_until.isoformat(),
        }

    async def pay_property_upkeep(current_user: dict = Depends(get_current_user)):
        uid = current_user["id"]
        await _ensure_property_upkeep_paid_until(uid)
        det = await _compute_property_upkeep_details(uid)
        amount = int(det["weekly_amount"])
        if amount <= 0:
            raise HTTPException(status_code=400, detail="No property upkeep bill — you have no qualifying businesses.")
        user_row = await db.users.find_one({"id": uid})
        if not user_row:
            raise HTTPException(status_code=404, detail="User not found")
        now_utc = datetime.now(timezone.utc)
        paid_until_dt = _parse_iso_datetime(user_row.get("property_upkeep_paid_until"))
        overdue = bool(amount > 0 and paid_until_dt and now_utc > paid_until_dt)
        can_pay, _eligible = _upkeep_pay_eligibility(paid_until_dt, now_utc, overdue)
        if not can_pay:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Coverage is paid ahead. You can pay again within {PROPERTY_UPKEEP_PAY_WINDOW_HOURS} hours "
                    "of when it expires."
                ),
            )
        paid_until_dt = paid_until_dt or now_utc
        base = max(paid_until_dt, now_utc)
        new_until = base + timedelta(days=PROPERTY_UPKEEP_BILLING_DAYS)
        result = await db.users.update_one(
            {"id": uid, "money": {"$gte": amount}},
            {"$inc": {"money": -amount}, "$set": {"property_upkeep_paid_until": new_until.isoformat()}},
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail="Insufficient cash for property upkeep.")
        now_iso = now_utc.isoformat()
        try:
            await db.economy_events.insert_one(
                {
                    "at": now_iso,
                    "type": "property_upkeep_pay",
                    "user_id": uid,
                    "username": current_user.get("username") or "",
                    "amount": amount,
                    "paid_until": new_until.isoformat(),
                }
            )
        except Exception:
            pass
        await log_activity(
            uid,
            current_user.get("username") or "?",
            "property_upkeep_pay",
            {"amount": amount, "paid_until": new_until.isoformat()},
        )
        friendly_until = _format_utc_datetime_friendly(new_until)
        return {
            "message": f"Paid ${amount:,} property upkeep. Coverage extends to {friendly_until}.",
            "paid_until": new_until.isoformat(),
            "amount": amount,
        }

    async def buy_property_portfolio_upgrade(
        tier: int,
        current_user: dict = Depends(get_current_user),
    ):
        """Buy the next Property Portfolio Upgrade tier (must be unlocked first)."""
        uid = current_user["id"]
        desired = max(1, int(tier or 0))
        u = await db.users.find_one(
            {"id": uid},
            {
                "_id": 0,
                "money": 1,
                "property_portfolio_upgrade_tier": 1,
                "property_portfolio_upgrade_unlocked_tier": 1,
            },
        )
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        purchased = int(u.get("property_portfolio_upgrade_tier") or 0)
        unlocked = int(u.get("property_portfolio_upgrade_unlocked_tier") or 0)
        if purchased >= _portfolio_upgrade_tier_max():
            raise HTTPException(status_code=400, detail="You already own the highest property portfolio upgrade tier.")
        if desired != purchased + 1:
            raise HTTPException(status_code=400, detail="You can only buy the next tier in order.")
        row = next((t for t in PROPERTY_PORTFOLIO_UPGRADE_TIERS if int(t.get("tier") or 0) == desired), None)
        if not row:
            raise HTTPException(status_code=400, detail="Invalid upgrade tier")
        if unlocked < desired:
            raise HTTPException(status_code=400, detail="That upgrade tier is not unlocked yet.")
        cost = int(row.get("cost_cash") or 0)
        if cost <= 0:
            raise HTTPException(status_code=400, detail="Invalid upgrade cost")
        # Tier 0 must match missing field, null, or 0 — equality to 0 alone does not match absent fields in MongoDB.
        match_q: dict = {"id": uid, "money": {"$gte": cost}}
        if purchased == 0:
            match_q["$or"] = [
                {"property_portfolio_upgrade_tier": 0},
                {"property_portfolio_upgrade_tier": None},
                {"property_portfolio_upgrade_tier": {"$exists": False}},
            ]
        else:
            match_q["property_portfolio_upgrade_tier"] = purchased
        res = await db.users.update_one(
            match_q,
            {"$inc": {"money": -cost}, "$set": {"property_portfolio_upgrade_tier": desired}},
        )
        if res.modified_count == 0:
            u2 = await db.users.find_one({"id": uid}, {"_id": 0, "money": 1, "property_portfolio_upgrade_tier": 1})
            bal = float((u2 or {}).get("money") or 0)
            cur_tier = int((u2 or {}).get("property_portfolio_upgrade_tier") or 0)
            if bal < cost:
                raise HTTPException(status_code=400, detail=f"Insufficient money. Upgrade costs ${cost:,}.")
            if cur_tier != purchased:
                raise HTTPException(
                    status_code=400,
                    detail="Could not apply upgrade (portfolio tier changed). Refresh and try again.",
                )
            raise HTTPException(status_code=400, detail=f"Insufficient money. Upgrade costs ${cost:,}.")
        await log_activity(
            uid,
            current_user.get("username") or "?",
            "property_portfolio_upgrade_buy",
            {"tier": desired, "name": row.get("name"), "cost": cost},
        )
        return {
            "message": f"Purchased Property Portfolio Upgrade Tier {desired}: {row.get('name')} for ${cost:,}.",
            "property_portfolio_upgrade_tier": desired,
        }

    async def bribe_properties_heat(
        request: PropertiesHeatBribeRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Pay cash to reduce portfolio Heat for properties."""
        uid = current_user["id"]
        try:
            amt = int(request.amount_cash or 0)
        except Exception:
            amt = 0
        amt = max(0, amt)
        now_utc = datetime.now(timezone.utc)
        u = await db.users.find_one(
            {"id": uid},
            {"_id": 0, "money": 1, "properties_heat": 1, "properties_heat_last_at": 1, "properties_heat_bribes_paid": 1},
        )
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        ticked_heat, ticked_last = _properties_heat_tick(
            float(u.get("properties_heat") or 0.0),
            u.get("properties_heat_last_at"),
            now_utc,
        )
        max_charge = _heat_max_dollars_to_clear(ticked_heat)
        if max_charge <= 0:
            raise HTTPException(status_code=400, detail="Heat is already at 0 — nothing to bribe.")
        if amt < PROPERTIES_HEAT_BRIBE_MIN_CASH and max_charge >= PROPERTIES_HEAT_BRIBE_MIN_CASH:
            raise HTTPException(status_code=400, detail=f"Minimum bribe is ${PROPERTIES_HEAT_BRIBE_MIN_CASH:,}.")
        if amt < 1:
            raise HTTPException(status_code=400, detail="Invalid bribe amount.")
        effective_charge = min(int(amt), max_charge)
        if effective_charge < 1:
            raise HTTPException(status_code=400, detail="Invalid bribe amount.")
        reduce_by = float(effective_charge) / float(PROPERTIES_HEAT_BRIBE_DOLLARS_PER_HEAT)
        new_heat = _clamp_float(float(ticked_heat) - float(reduce_by), 0.0, PROPERTIES_HEAT_MAX)
        res = await db.users.update_one(
            {"id": uid, "money": {"$gte": effective_charge}},
            {
                "$inc": {"money": -effective_charge, "properties_heat_bribes_paid": effective_charge},
                "$set": {"properties_heat": new_heat, "properties_heat_last_at": ticked_last},
            },
        )
        if res.modified_count == 0:
            raise HTTPException(status_code=400, detail=f"Insufficient money. Bribe costs ${effective_charge:,}.")
        blocked = bool(new_heat >= float(PROPERTIES_HEAT_BLOCK_THRESHOLD))
        if effective_charge < int(amt):
            msg = (
                f"Bribed the police for ${effective_charge:,}. Heat is now {new_heat:.1f}/{PROPERTIES_HEAT_MAX:.0f}. "
                f"(Only ${effective_charge:,} was needed to clear current heat — extra was not charged.)"
            )
        else:
            msg = f"Bribed the police for ${effective_charge:,}. Heat is now {new_heat:.1f}/{PROPERTIES_HEAT_MAX:.0f}."
        return {
            "message": msg,
            "properties_heat": {
                "heat": round(float(new_heat), 3),
                "blocked": blocked,
                "threshold": float(PROPERTIES_HEAT_BLOCK_THRESHOLD),
                "heat_max": float(PROPERTIES_HEAT_MAX),
            },
            "properties_heat_bribe_quote": _properties_heat_bribe_quote(new_heat),
        }

    router.add_api_route(
        "/properties",
        get_properties,
        methods=["GET"],
        response_model=PropertiesListResponse,
        dependencies=_properties_rl_u,
    )
    router.add_api_route("/properties/upkeep/pay", pay_property_upkeep, methods=["POST"])
    router.add_api_route("/properties/heat/bribe", bribe_properties_heat, methods=["POST"])
    router.add_api_route("/properties/upgrades/buy", buy_property_portfolio_upgrade, methods=["POST"])
    router.add_api_route("/properties/{property_id}/buy", buy_property, methods=["POST"])
    router.add_api_route("/properties/{property_id}/collect", collect_property_income, methods=["POST"])
    router.add_api_route("/properties/{property_id}/reinvest", reinvest_property, methods=["POST"])
    router.add_api_route("/my-properties", get_my_properties, methods=["GET"], dependencies=_properties_rl_u)
