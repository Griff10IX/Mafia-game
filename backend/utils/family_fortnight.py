"""Family Fortnight leaderboard: scoring, rotating vices, settle, kill-switch.

Period = two consecutive London game weeks (Mon 00:00 Europe/London → +14d).
Kill-switch: game_config id family_fortnight_enabled { enabled: bool }.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from utils.game_timezone import game_week_start_date_str, game_week_start_utc, utc_now

logger = logging.getLogger(__name__)

CONFIG_ID = "family_fortnight_enabled"
PAYOUT_CONFIG_ID = "family_fortnight_payout"
THEME_ID = "crew_of_the_fortnight"
THEME_IMAGE = "/images/family-themes/crew-of-the-fortnight.jpg"
BADGE_IMAGE = "/images/family-badges/crew-of-the-fortnight.png"
BADGE_LABEL = "Crew of the Fortnight"

# Positive score
SCORE_DAILY_PROGRESS = 1
SCORE_RACKET_COLLECT = 25
SCORE_RACKET_RAID = 40
SCORE_CREW_OC = 150
CASH_PER_SCORE = 100_000  # +1 per $100k
POINTS_PER_SCORE = 10  # +1 per 10 points deposited
MELT_BULLETS_PER_SCORE = 2_000  # +1 per 2k to treasury
CAP_RACKET_COLLECT_DAY = 10
CAP_RACKET_RAID_DAY = 5
CAP_CASH_DEPOSIT_SCORE_DAY = 500
CAP_POINTS_DEPOSIT_SCORE_DAY = 200

# Underperform thresholds
LOW_MELT_BULLETS = 1_000
LOW_DEPOSIT_CASH = 2_500_000_000
LOW_DAILY_PCT = 0.25
JOIN_GRACE_HOURS = 24

# Penalties
PEN_LOW_MELT = 100
PEN_LOW_DEPOSIT = 80
PEN_LOW_DAILY = 80
PEN_NO_RACKET = 50
PEN_NO_OC = 60
PEN_LOW_RAID = 40
PEN_MELT_PCT_ZERO = 150
PEN_MELT_PCT_ZERO_FAM = 75
PEN_WAR_KICK = 200
PEN_WAR_KICK_FAM = 50
PEN_DEAD_WEIGHT = 40
PEN_WAR_LEAVE = 500
PEN_WAR_LEAVE_FAM = 250
PEN_QT_SELL = 2000
PEN_QT_SELL_FAM = 1000

# Payout defaults (fortnight)
DEFAULT_PAYOUTS = {
    1: {"treasury_cash": 75_000_000, "treasury_points": 750, "treasury_loot": 75, "member_pot": 20_000},
    2: {"treasury_cash": 40_000_000, "treasury_points": 400, "treasury_loot": 40, "member_pot": 12_500},
    3: {"treasury_cash": 15_000_000, "treasury_points": 150, "treasury_loot": 15, "member_pot": 5_000},
    "crumb": {"treasury_cash": 3_000_000, "treasury_points": 0, "treasury_loot": 0, "member_pot": 0},
}
RACKET_BUFF_HOURS = 72
RACKET_BUFF_PCT = 10
FLAIR_DAYS = 14
MIN_CONTRIBUTORS = 3
MEMBER_SHARE_MIN_PCT = 0.001  # 0.1%

ALWAYS_ON_VICES = ("war_leave", "qt_sell")

VICE_POOL: Tuple[str, ...] = (
    "low_melt",
    "low_deposit",
    "low_daily",
    "no_racket",
    "no_oc",
    "low_raid",
    "vault_cash",
    "vault_bullets",
    "melt_pct_zero",
    "war_kick",
    "dead_weight_war",
)

VICE_LABELS = {
    "low_melt": "Melt under 1,000 bullets to family = −100",
    "low_deposit": "Deposit under $2.5B cash to vault = −80",
    "low_daily": "Under 25% family daily while others finish = −80",
    "no_racket": "No racket collect while crew has rackets = −50",
    "no_oc": "Miss Crew OC while crew ran one = −60",
    "low_raid": "No racket raid while crew raided 3+ = −40",
    "vault_cash": "Vault cash withdraw costs score",
    "vault_bullets": "Vault bullet withdraw costs score",
    "melt_pct_zero": "Set melt % to 0 = −150",
    "war_kick": "Kick during war = −200",
    "dead_weight_war": "Dead 24h+ in war with 0 kills = −40/day",
    "war_leave": "Leave mid-war = −500",
    "qt_sell": "QT sell crew = −2000",
}

UNDERPERFORM_VICES = frozenset(
    {"low_melt", "low_deposit", "low_daily", "no_racket", "no_oc", "low_raid", "dead_weight_war"}
)
DRAIN_VICES = frozenset({"vault_cash", "vault_bullets", "melt_pct_zero", "war_kick"})


def _utc_day_str(now: Optional[datetime] = None) -> str:
    dt = now or utc_now()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).date().isoformat()


def fortnight_period_id(utc_dt: Optional[datetime] = None) -> str:
    """Two London weeks: pair Mondays aligned to a fixed epoch Monday."""
    week_start = game_week_start_utc(utc_dt)
    epoch = game_week_start_utc(datetime(2024, 1, 1, tzinfo=timezone.utc))
    weeks = int((week_start - epoch).total_seconds() // (7 * 86400))
    pair = weeks - (weeks % 2)
    start_a = epoch + timedelta(days=7 * pair)
    start_b = start_a + timedelta(days=7)
    return f"{start_a.astimezone(timezone.utc).date().isoformat()}_{start_b.astimezone(timezone.utc).date().isoformat()}"


def fortnight_range_utc(utc_dt: Optional[datetime] = None) -> Tuple[datetime, datetime]:
    period_id = fortnight_period_id(utc_dt)
    a_str, b_str = period_id.split("_", 1)
    start = game_week_start_utc(datetime.fromisoformat(a_str).replace(tzinfo=timezone.utc))
    # Ensure we use the Monday of a_str
    start = game_week_start_utc(
        datetime(int(a_str[0:4]), int(a_str[5:7]), int(a_str[8:10]), tzinfo=timezone.utc)
    )
    end = start + timedelta(days=14)
    return start, end


def previous_fortnight_period_id(utc_dt: Optional[datetime] = None) -> str:
    start, _ = fortnight_range_utc(utc_dt)
    return fortnight_period_id(start - timedelta(days=1))


def vice_window_index(utc_dt: Optional[datetime] = None) -> int:
    dt = utc_dt or utc_now()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    hour = dt.astimezone(timezone.utc).hour
    return hour // 8  # 0, 1, 2


def active_vices(utc_dt: Optional[datetime] = None) -> List[str]:
    """Deterministic 2–3 vices for the current 8h UTC window."""
    dt = utc_dt or utc_now()
    day = _utc_day_str(dt)
    win = vice_window_index(dt)
    seed = f"{day}:{win}:family_fortnight_vices".encode("utf-8")
    h = hashlib.sha256(seed).digest()
    # Prefer one underperform + one drain when possible
    under = [v for v in VICE_POOL if v in UNDERPERFORM_VICES]
    drain = [v for v in VICE_POOL if v in DRAIN_VICES]
    picks: List[str] = []
    # pick under
    ui = h[0] % len(under)
    picks.append(under[ui])
    # pick drain
    di = h[1] % len(drain)
    picks.append(drain[di])
    # optional third from remaining
    if h[2] % 2 == 0:
        rest = [v for v in VICE_POOL if v not in picks]
        picks.append(rest[h[3] % len(rest)])
    return picks


def vices_payload(utc_dt: Optional[datetime] = None) -> Dict[str, Any]:
    dt = utc_dt or utc_now()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    win = vice_window_index(dt)
    day = dt.date()
    window_start = datetime(day.year, day.month, day.day, win * 8, 0, 0, tzinfo=timezone.utc)
    window_end = window_start + timedelta(hours=8)
    vices = active_vices(dt)
    return {
        "utc_date": day.isoformat(),
        "window_index": win,
        "starts_at": window_start.isoformat().replace("+00:00", "Z"),
        "ends_at": window_end.isoformat().replace("+00:00", "Z"),
        "vices": [{"id": v, "label": VICE_LABELS.get(v, v)} for v in vices],
        "always_on": [{"id": v, "label": VICE_LABELS.get(v, v)} for v in ALWAYS_ON_VICES],
    }


async def is_enabled(db) -> bool:
    try:
        cfg = await db.game_config.find_one({"id": CONFIG_ID}, {"_id": 0, "enabled": 1})
        return bool(cfg and cfg.get("enabled"))
    except Exception:
        return False


async def ensure_default_config(db) -> None:
    """Create kill-switch doc if missing (default enabled=false)."""
    try:
        await db.game_config.update_one(
            {"id": CONFIG_ID},
            {"$setOnInsert": {"id": CONFIG_ID, "enabled": False, "created_at": utc_now().isoformat()}},
            upsert=True,
        )
        await db.game_config.update_one(
            {"id": PAYOUT_CONFIG_ID},
            {
                "$setOnInsert": {
                    "id": PAYOUT_CONFIG_ID,
                    "payouts": DEFAULT_PAYOUTS,
                    "last_run_period_id": None,
                }
            },
            upsert=True,
        )
        # Member pots live on the stored config after first insert. Keep them on the code defaults.
        await db.game_config.update_one(
            {"id": PAYOUT_CONFIG_ID},
            {
                "$set": {
                    "payouts.1.member_pot": DEFAULT_PAYOUTS[1]["member_pot"],
                    "payouts.2.member_pot": DEFAULT_PAYOUTS[2]["member_pot"],
                    "payouts.3.member_pot": DEFAULT_PAYOUTS[3]["member_pot"],
                }
            },
        )
    except Exception:
        logger.exception("family_fortnight ensure_default_config failed")


def _floor0(n: int) -> int:
    return max(0, int(n))


async def _resolve_family_id(db, user_id: str) -> Optional[str]:
    u = await db.users.find_one({"id": str(user_id)}, {"_id": 0, "family_id": 1})
    fid = (u or {}).get("family_id")
    return str(fid) if fid else None


async def add_score(
    db,
    *,
    family_id: str,
    user_id: str,
    username: str,
    amount: int,
    breakdown_key: str,
    counters: Optional[Dict[str, int]] = None,
    now: Optional[datetime] = None,
) -> None:
    if amount == 0 or not family_id or not user_id:
        return
    if not await is_enabled(db):
        return
    now = now or utc_now()
    period_id = fortnight_period_id(now)
    day = _utc_day_str(now)
    amt = int(amount)
    fam_inc = amt
    # Apply family score with floor via read-modify if negative — use $max after $inc via pipeline if needed.
    # Simple path: $inc then clamp in a second update if score < 0.
    await db.family_fortnight_scores.update_one(
        {"family_id": family_id, "period_id": period_id},
        {
            "$inc": {"score": fam_inc},
            "$set": {"updated_at": now},
            "$addToSet": {"contributor_ids": str(user_id)},
        },
        upsert=True,
    )
    await db.family_fortnight_scores.update_one(
        {"family_id": family_id, "period_id": period_id, "score": {"$lt": 0}},
        {"$set": {"score": 0}},
    )

    mem_set: Dict[str, Any] = {
        "username": username or "?",
        "updated_at": now,
        "last_score_at": now,
    }
    mem_inc: Dict[str, int] = {"score": amt, f"breakdown.{breakdown_key}": amt}
    if counters:
        for k, v in counters.items():
            mem_inc[f"counters.{day}.{k}"] = int(v)
            mem_inc[f"counters_total.{k}"] = int(v)

    await db.family_fortnight_member_scores.update_one(
        {"family_id": family_id, "period_id": period_id, "user_id": str(user_id)},
        {"$inc": mem_inc, "$set": mem_set},
        upsert=True,
    )
    await db.family_fortnight_member_scores.update_one(
        {"family_id": family_id, "period_id": period_id, "user_id": str(user_id), "score": {"$lt": 0}},
        {"$set": {"score": 0}},
    )


async def add_family_only_score(
    db,
    *,
    family_id: str,
    amount: int,
    now: Optional[datetime] = None,
) -> None:
    if amount == 0 or not family_id:
        return
    if not await is_enabled(db):
        return
    now = now or utc_now()
    period_id = fortnight_period_id(now)
    await db.family_fortnight_scores.update_one(
        {"family_id": family_id, "period_id": period_id},
        {"$inc": {"score": int(amount)}, "$set": {"updated_at": now}},
        upsert=True,
    )
    await db.family_fortnight_scores.update_one(
        {"family_id": family_id, "period_id": period_id, "score": {"$lt": 0}},
        {"$set": {"score": 0}},
    )


async def bump_counter_only(
    db,
    *,
    family_id: str,
    user_id: str,
    username: str,
    counters: Dict[str, int],
    now: Optional[datetime] = None,
) -> None:
    """Track day counters without changing score (for underperform settle)."""
    if not family_id or not user_id or not counters:
        return
    if not await is_enabled(db):
        return
    now = now or utc_now()
    period_id = fortnight_period_id(now)
    day = _utc_day_str(now)
    mem_inc = {f"counters.{day}.{k}": int(v) for k, v in counters.items()}
    for k, v in counters.items():
        mem_inc[f"counters_total.{k}"] = int(v)
    await db.family_fortnight_member_scores.update_one(
        {"family_id": family_id, "period_id": period_id, "user_id": str(user_id)},
        {
            "$inc": mem_inc,
            "$set": {"username": username or "?", "updated_at": now},
            "$setOnInsert": {"score": 0, "period_id": period_id, "family_id": family_id},
        },
        upsert=True,
    )


async def _day_cap_remaining(db, family_id: str, user_id: str, period_id: str, day: str, key: str, cap: int) -> int:
    doc = await db.family_fortnight_member_scores.find_one(
        {"family_id": family_id, "period_id": period_id, "user_id": str(user_id)},
        {"_id": 0, f"day_caps.{day}.{key}": 1},
    )
    used = 0
    if doc:
        used = int((((doc.get("day_caps") or {}).get(day) or {}).get(key)) or 0)
    return max(0, cap - used)


async def _inc_day_cap(db, family_id: str, user_id: str, period_id: str, day: str, key: str, n: int) -> None:
    await db.family_fortnight_member_scores.update_one(
        {"family_id": family_id, "period_id": period_id, "user_id": str(user_id)},
        {"$inc": {f"day_caps.{day}.{key}": int(n)}},
        upsert=True,
    )


# --- Public hooks -----------------------------------------------------------------


async def on_daily_progress(
    db, user_id: str, username: str, progress_amount: int, *, now: Optional[datetime] = None
) -> None:
    try:
        if int(progress_amount or 0) <= 0:
            return
        fid = await _resolve_family_id(db, user_id)
        if not fid:
            return
        await add_score(
            db,
            family_id=fid,
            user_id=user_id,
            username=username,
            amount=int(progress_amount) * SCORE_DAILY_PROGRESS,
            breakdown_key="daily",
            counters={"daily_progress": int(progress_amount)},
            now=now,
        )
    except Exception:
        logger.exception("family_fortnight on_daily_progress")


async def on_racket_collect(db, user_id: str, username: str, *, now: Optional[datetime] = None) -> None:
    try:
        fid = await _resolve_family_id(db, user_id)
        if not fid:
            return
        now = now or utc_now()
        period_id = fortnight_period_id(now)
        day = _utc_day_str(now)
        rem = await _day_cap_remaining(db, fid, user_id, period_id, day, "racket_collect", CAP_RACKET_COLLECT_DAY)
        if rem <= 0:
            await bump_counter_only(
                db, family_id=fid, user_id=user_id, username=username, counters={"racket_collect": 1}, now=now
            )
            return
        await _inc_day_cap(db, fid, user_id, period_id, day, "racket_collect", 1)
        await add_score(
            db,
            family_id=fid,
            user_id=user_id,
            username=username,
            amount=SCORE_RACKET_COLLECT,
            breakdown_key="racket_collect",
            counters={"racket_collect": 1},
            now=now,
        )
    except Exception:
        logger.exception("family_fortnight on_racket_collect")


async def on_racket_raid(db, user_id: str, username: str, *, now: Optional[datetime] = None) -> None:
    try:
        fid = await _resolve_family_id(db, user_id)
        if not fid:
            return
        now = now or utc_now()
        period_id = fortnight_period_id(now)
        day = _utc_day_str(now)
        rem = await _day_cap_remaining(db, fid, user_id, period_id, day, "racket_raid", CAP_RACKET_RAID_DAY)
        if rem <= 0:
            await bump_counter_only(
                db, family_id=fid, user_id=user_id, username=username, counters={"racket_raid": 1}, now=now
            )
            return
        await _inc_day_cap(db, fid, user_id, period_id, day, "racket_raid", 1)
        await add_score(
            db,
            family_id=fid,
            user_id=user_id,
            username=username,
            amount=SCORE_RACKET_RAID,
            breakdown_key="racket_raid",
            counters={"racket_raid": 1},
            now=now,
        )
        # family-level raid counter for low_raid vice
        await db.family_fortnight_scores.update_one(
            {"family_id": fid, "period_id": period_id},
            {"$inc": {f"day_raids.{day}": 1}},
            upsert=True,
        )
    except Exception:
        logger.exception("family_fortnight on_racket_raid")


async def on_crew_oc(db, user_id: str, username: str, *, now: Optional[datetime] = None) -> None:
    try:
        fid = await _resolve_family_id(db, user_id)
        if not fid:
            return
        now = now or utc_now()
        period_id = fortnight_period_id(now)
        day = _utc_day_str(now)
        await add_score(
            db,
            family_id=fid,
            user_id=user_id,
            username=username,
            amount=SCORE_CREW_OC,
            breakdown_key="crew_oc",
            counters={"crew_oc": 1},
            now=now,
        )
        await db.family_fortnight_scores.update_one(
            {"family_id": fid, "period_id": period_id},
            {"$inc": {f"day_oc.{day}": 1}},
            upsert=True,
        )
    except Exception:
        logger.exception("family_fortnight on_crew_oc")


async def on_vault_deposit(
    db,
    user_id: str,
    username: str,
    *,
    cash: int = 0,
    points: int = 0,
    now: Optional[datetime] = None,
) -> None:
    try:
        fid = await _resolve_family_id(db, user_id)
        if not fid:
            return
        now = now or utc_now()
        period_id = fortnight_period_id(now)
        day = _utc_day_str(now)
        cash = int(cash or 0)
        points = int(points or 0)
        if cash > 0:
            await bump_counter_only(
                db, family_id=fid, user_id=user_id, username=username, counters={"deposit_cash": cash}, now=now
            )
            raw = cash // CASH_PER_SCORE
            rem = await _day_cap_remaining(
                db, fid, user_id, period_id, day, "deposit_cash_score", CAP_CASH_DEPOSIT_SCORE_DAY
            )
            grant = min(raw, rem)
            if grant > 0:
                await _inc_day_cap(db, fid, user_id, period_id, day, "deposit_cash_score", grant)
                await add_score(
                    db,
                    family_id=fid,
                    user_id=user_id,
                    username=username,
                    amount=grant,
                    breakdown_key="deposit_cash",
                    now=now,
                )
        if points > 0:
            await bump_counter_only(
                db, family_id=fid, user_id=user_id, username=username, counters={"deposit_points": points}, now=now
            )
            raw = points // POINTS_PER_SCORE
            rem = await _day_cap_remaining(
                db, fid, user_id, period_id, day, "deposit_points_score", CAP_POINTS_DEPOSIT_SCORE_DAY
            )
            grant = min(raw, rem)
            if grant > 0:
                await _inc_day_cap(db, fid, user_id, period_id, day, "deposit_points_score", grant)
                await add_score(
                    db,
                    family_id=fid,
                    user_id=user_id,
                    username=username,
                    amount=grant,
                    breakdown_key="deposit_points",
                    now=now,
                )
    except Exception:
        logger.exception("family_fortnight on_vault_deposit")


async def on_vault_withdraw(
    db,
    user_id: str,
    username: str,
    *,
    cash: int = 0,
    bullets: int = 0,
    now: Optional[datetime] = None,
) -> None:
    try:
        if not await is_enabled(db):
            return
        fid = await _resolve_family_id(db, user_id)
        if not fid:
            return
        now = now or utc_now()
        vices = set(active_vices(now))
        period_id = fortnight_period_id(now)
        cash = int(cash or 0)
        bullets = int(bullets or 0)

        # Track withdraws for netting
        if cash > 0:
            await bump_counter_only(
                db, family_id=fid, user_id=user_id, username=username, counters={"withdraw_cash": cash}, now=now
            )
        if bullets > 0:
            await bump_counter_only(
                db,
                family_id=fid,
                user_id=user_id,
                username=username,
                counters={"withdraw_bullets": bullets},
                now=now,
            )

        mem = await db.family_fortnight_member_scores.find_one(
            {"family_id": fid, "period_id": period_id, "user_id": str(user_id)},
            {"_id": 0, "counters_total": 1},
        )
        totals = (mem or {}).get("counters_total") or {}

        if "vault_cash" in vices and cash > 0:
            deposited = int(totals.get("deposit_cash") or 0)
            withdrawn = int(totals.get("withdraw_cash") or 0)
            # Net: only penalize excess withdraw over deposits this period
            net = max(0, withdrawn - deposited)
            # Approximate this withdraw's contribution to net
            prev_withdrawn = withdrawn - cash
            prev_net = max(0, prev_withdrawn - deposited)
            delta_net = max(0, net - prev_net)
            pen = delta_net // CASH_PER_SCORE
            if pen > 0:
                await add_score(
                    db,
                    family_id=fid,
                    user_id=user_id,
                    username=username,
                    amount=-pen,
                    breakdown_key="vault_cash_pen",
                    now=now,
                )
                await add_family_only_score(db, family_id=fid, amount=-(pen // 2), now=now)

        if "vault_bullets" in vices and bullets > 0:
            melted = int(totals.get("melt_to_family") or 0)
            withdrawn_b = int(totals.get("withdraw_bullets") or 0)
            net = max(0, withdrawn_b - melted)
            prev = withdrawn_b - bullets
            prev_net = max(0, prev - melted)
            delta_net = max(0, net - prev_net)
            pen = delta_net // MELT_BULLETS_PER_SCORE
            if pen > 0:
                await add_score(
                    db,
                    family_id=fid,
                    user_id=user_id,
                    username=username,
                    amount=-pen,
                    breakdown_key="vault_bullets_pen",
                    now=now,
                )
                await add_family_only_score(db, family_id=fid, amount=-(pen // 2), now=now)

        # zero_deposit_day style spike if vault_cash active and no deposits
        if "vault_cash" in vices and cash > 0 and int(totals.get("deposit_cash") or 0) <= 0:
            await add_score(
                db,
                family_id=fid,
                user_id=user_id,
                username=username,
                amount=-100,
                breakdown_key="zero_deposit_withdraw",
                now=now,
            )
    except Exception:
        logger.exception("family_fortnight on_vault_withdraw")


async def on_melt_to_family(
    db,
    user_id: str,
    username: str,
    family_id: str,
    bullets: int,
    *,
    now: Optional[datetime] = None,
) -> None:
    try:
        bullets = int(bullets or 0)
        if bullets <= 0 or not family_id:
            return
        now = now or utc_now()
        await bump_counter_only(
            db,
            family_id=family_id,
            user_id=user_id,
            username=username,
            counters={"melt_to_family": bullets},
            now=now,
        )
        score = bullets // MELT_BULLETS_PER_SCORE
        if score > 0:
            await add_score(
                db,
                family_id=family_id,
                user_id=user_id,
                username=username,
                amount=score,
                breakdown_key="melt",
                now=now,
            )
    except Exception:
        logger.exception("family_fortnight on_melt_to_family")


async def on_melt_pct_set(
    db, user_id: str, username: str, family_id: str, new_pct: int, *, intentional: bool = True, now=None
) -> None:
    try:
        if not intentional or int(new_pct) != 0:
            return
        if not await is_enabled(db):
            return
        now = now or utc_now()
        if "melt_pct_zero" not in active_vices(now):
            return
        day = _utc_day_str(now)
        period_id = fortnight_period_id(now)
        # once per day per setter
        key = f"melt_pct_zero.{day}"
        mem = await db.family_fortnight_member_scores.find_one(
            {"family_id": family_id, "period_id": period_id, "user_id": str(user_id)},
            {"_id": 0, "flags": 1},
        )
        if mem and (mem.get("flags") or {}).get(key):
            return
        await db.family_fortnight_member_scores.update_one(
            {"family_id": family_id, "period_id": period_id, "user_id": str(user_id)},
            {"$set": {f"flags.{key}": True, "username": username or "?"}},
            upsert=True,
        )
        await add_score(
            db,
            family_id=family_id,
            user_id=user_id,
            username=username,
            amount=-PEN_MELT_PCT_ZERO,
            breakdown_key="melt_pct_zero",
            now=now,
        )
        await add_family_only_score(db, family_id=family_id, amount=-PEN_MELT_PCT_ZERO_FAM, now=now)
    except Exception:
        logger.exception("family_fortnight on_melt_pct_set")


async def on_war_leave(db, user_id: str, username: str, family_id: str, *, now=None) -> None:
    try:
        now = now or utc_now()
        await add_score(
            db,
            family_id=family_id,
            user_id=user_id,
            username=username,
            amount=-PEN_WAR_LEAVE,
            breakdown_key="war_leave",
            now=now,
        )
        await add_family_only_score(db, family_id=family_id, amount=-PEN_WAR_LEAVE_FAM, now=now)
    except Exception:
        logger.exception("family_fortnight on_war_leave")


async def on_war_kick(db, kicker_id: str, kicker_name: str, family_id: str, *, now=None) -> None:
    try:
        now = now or utc_now()
        if "war_kick" not in active_vices(now):
            return
        await add_score(
            db,
            family_id=family_id,
            user_id=kicker_id,
            username=kicker_name,
            amount=-PEN_WAR_KICK,
            breakdown_key="war_kick",
            now=now,
        )
        await add_family_only_score(db, family_id=family_id, amount=-PEN_WAR_KICK_FAM, now=now)
    except Exception:
        logger.exception("family_fortnight on_war_kick")


async def on_qt_sell(db, user_id: str, username: str, family_id: str, *, now=None) -> None:
    try:
        now = now or utc_now()
        await add_score(
            db,
            family_id=family_id,
            user_id=user_id,
            username=username,
            amount=-PEN_QT_SELL,
            breakdown_key="qt_sell",
            now=now,
        )
        await add_family_only_score(db, family_id=family_id, amount=-PEN_QT_SELL_FAM, now=now)
    except Exception:
        logger.exception("family_fortnight on_qt_sell")


async def mark_login(db, user_id: str, *, now: Optional[datetime] = None) -> None:
    """Record UTC-day login for underperform eligibility."""
    try:
        if not await is_enabled(db):
            return
        fid = await _resolve_family_id(db, user_id)
        if not fid:
            return
        now = now or utc_now()
        day = _utc_day_str(now)
        period_id = fortnight_period_id(now)
        await db.family_fortnight_member_scores.update_one(
            {"family_id": fid, "period_id": period_id, "user_id": str(user_id)},
            {
                "$set": {f"logged_in.{day}": True, "updated_at": now},
                "$setOnInsert": {"score": 0, "username": ""},
            },
            upsert=True,
        )
    except Exception:
        logger.exception("family_fortnight mark_login")


# --- Underperform daily settle ----------------------------------------------------


async def settle_underperform_for_day(db, day: Optional[str] = None) -> None:
    """Apply rotating underperform penalties for a completed UTC day."""
    if not await is_enabled(db):
        return
    now = utc_now()
    # Settle previous UTC day by default
    if day is None:
        day = (now.astimezone(timezone.utc).date() - timedelta(days=1)).isoformat()
    claim_key = f"underperform_{day}"
    claim = await db.game_config.update_one(
        {
            "id": PAYOUT_CONFIG_ID,
            "$or": [
                {f"underperform_settled.{day}": {"$ne": True}},
                {f"underperform_settled.{day}": {"$exists": False}},
            ],
        },
        {"$set": {f"underperform_settled.{day}": True}},
        upsert=True,
    )
    if claim.modified_count == 0 and claim.upserted_id is None:
        return

    # Use vices that were active during that day (any window) — settle if vice appeared in any window
    day_dt = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
    day_vices = set()
    for w in range(3):
        probe = day_dt.replace(hour=w * 8 + 1)
        day_vices.update(active_vices(probe))

    period_id = fortnight_period_id(day_dt + timedelta(hours=12))
    members = await db.family_fortnight_member_scores.find(
        {"period_id": period_id, f"logged_in.{day}": True},
        {"_id": 0},
    ).to_list(5000)

    families_cache: Dict[str, Any] = {}

    for mem in members:
        fid = mem.get("family_id")
        uid = mem.get("user_id")
        uname = mem.get("username") or "?"
        if not fid or not uid:
            continue
        counters = ((mem.get("counters") or {}).get(day)) or {}
        user = await db.users.find_one(
            {"id": uid},
            {"_id": 0, "family_joined_at": 1, "created_at": 1, "is_dead": 1, "family_id": 1},
        )
        joined_at = None
        if user:
            raw = user.get("family_joined_at") or user.get("created_at")
            if isinstance(raw, datetime):
                joined_at = raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
            elif isinstance(raw, str):
                try:
                    joined_at = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                except Exception:
                    joined_at = None
        grace = False
        if joined_at:
            grace = (day_dt + timedelta(days=1) - joined_at) < timedelta(hours=JOIN_GRACE_HOURS)

        if "low_melt" in day_vices and not grace:
            if int(counters.get("melt_to_family") or 0) < LOW_MELT_BULLETS:
                await add_score(
                    db,
                    family_id=fid,
                    user_id=uid,
                    username=uname,
                    amount=-PEN_LOW_MELT,
                    breakdown_key="low_melt",
                    now=now,
                )

        if "low_deposit" in day_vices and not grace:
            if int(counters.get("deposit_cash") or 0) < LOW_DEPOSIT_CASH:
                await add_score(
                    db,
                    family_id=fid,
                    user_id=uid,
                    username=uname,
                    amount=-PEN_LOW_DEPOSIT,
                    breakdown_key="low_deposit",
                    now=now,
                )

        if "low_daily" in day_vices:
            # check family daily completions by others
            obj = await db.family_daily_objectives.find_one(
                {"family_id": fid, "period": day},
                {"_id": 0, "target": 1, "completion_count": 1},
            )
            prog = await db.family_daily_progress.find_one(
                {"family_id": fid, "period": day, "user_id": uid},
                {"_id": 0, "progress": 1, "completed": 1},
            )
            others_done = int((obj or {}).get("completion_count") or 0)
            target = int((obj or {}).get("target") or 1)
            my_prog = int((prog or {}).get("progress") or 0)
            if others_done >= 3 and (my_prog / max(1, target)) < LOW_DAILY_PCT:
                await add_score(
                    db,
                    family_id=fid,
                    user_id=uid,
                    username=uname,
                    amount=-PEN_LOW_DAILY,
                    breakdown_key="low_daily",
                    now=now,
                )

        if "no_racket" in day_vices:
            fam = families_cache.get(fid)
            if fam is None:
                fam = await db.families.find_one({"id": fid}, {"_id": 0, "rackets": 1, "war_id": 1})
                families_cache[fid] = fam or {}
            rackets = (fam or {}).get("rackets") or []
            in_war = bool((fam or {}).get("war_id"))
            if rackets and not in_war and int(counters.get("racket_collect") or 0) <= 0:
                await add_score(
                    db,
                    family_id=fid,
                    user_id=uid,
                    username=uname,
                    amount=-PEN_NO_RACKET,
                    breakdown_key="no_racket",
                    now=now,
                )

        if "no_oc" in day_vices:
            fam_score = await db.family_fortnight_scores.find_one(
                {"family_id": fid, "period_id": period_id},
                {"_id": 0, f"day_oc.{day}": 1},
            )
            fam_oc = int((((fam_score or {}).get("day_oc") or {}).get(day)) or 0)
            if fam_oc >= 1 and int(counters.get("crew_oc") or 0) <= 0:
                await add_score(
                    db,
                    family_id=fid,
                    user_id=uid,
                    username=uname,
                    amount=-PEN_NO_OC,
                    breakdown_key="no_oc",
                    now=now,
                )

        if "low_raid" in day_vices:
            fam_score = await db.family_fortnight_scores.find_one(
                {"family_id": fid, "period_id": period_id},
                {"_id": 0, f"day_raids.{day}": 1},
            )
            fam_raids = int((((fam_score or {}).get("day_raids") or {}).get(day)) or 0)
            if fam_raids >= 3 and int(counters.get("racket_raid") or 0) <= 0:
                await add_score(
                    db,
                    family_id=fid,
                    user_id=uid,
                    username=uname,
                    amount=-PEN_LOW_RAID,
                    breakdown_key="low_raid",
                    now=now,
                )

    # racket_stale — family-level, if vice was in pool... plan had it then replaced with underperform list.
    # Skip racket_stale for v1 pool as listed in final plan (not in VICE_POOL).

    logger.info("family_fortnight underperform settled day=%s", day)


# --- Fortnight settle -------------------------------------------------------------


async def run_fortnight_settle(db, *, test_run: bool = False) -> Optional[Dict[str, Any]]:
    """Pay previous completed fortnight. Idempotent on period_id."""
    await ensure_default_config(db)
    if not await is_enabled(db) and not test_run:
        return None

    now = utc_now()
    period_id = previous_fortnight_period_id(now)

    cfg = await db.game_config.find_one({"id": PAYOUT_CONFIG_ID}, {"_id": 0})
    if cfg and cfg.get("last_run_period_id") == period_id and not test_run:
        return None

    if not test_run:
        claim = await db.game_config.update_one(
            {
                "id": PAYOUT_CONFIG_ID,
                "$or": [
                    {"last_run_period_id": {"$ne": period_id}},
                    {"last_run_period_id": {"$exists": False}},
                    {"last_run_period_id": None},
                ],
            },
            {"$set": {"last_run_period_id": period_id}},
            upsert=True,
        )
        if claim.modified_count == 0 and claim.upserted_id is None:
            return None

    # Already paid audit?
    existing = await db.family_fortnight_payouts.find_one({"period_id": period_id}, {"_id": 1})
    if existing and not test_run:
        return None

    rows = await db.family_fortnight_scores.find({"period_id": period_id}, {"_id": 0}).to_list(500)
    # Enrich unique contributors
    ranked = []
    for r in rows:
        fid = r.get("family_id")
        if not fid:
            continue
        contribs = list(r.get("contributor_ids") or [])
        if not contribs:
            mems = await db.family_fortnight_member_scores.find(
                {"family_id": fid, "period_id": period_id, "score": {"$gt": 0}},
                {"_id": 0, "user_id": 1},
            ).to_list(200)
            contribs = [m["user_id"] for m in mems if m.get("user_id")]
        uniq = len(set(contribs))
        fam = await db.families.find_one({"id": fid}, {"_id": 0, "name": 1, "tag": 1})
        if not fam:
            continue
        ranked.append(
            {
                "family_id": fid,
                "name": fam.get("name") or "?",
                "tag": fam.get("tag") or "",
                "score": int(r.get("score") or 0),
                "unique_contributors": uniq,
                "updated_at": r.get("updated_at"),
            }
        )

    ranked.sort(
        key=lambda x: (
            -x["score"],
            -x["unique_contributors"],
            str(x.get("updated_at") or ""),
        )
    )

    placements = []
    payout_cfg = (cfg or {}).get("payouts") or DEFAULT_PAYOUTS

    async def _pay_rank(rank: int, entry: Dict[str, Any], pot: Dict[str, Any]) -> Dict[str, Any]:
        from utils.family_vault_log import log_family_vault_tx

        fid = entry["family_id"]
        cash = int(pot.get("treasury_cash") or 0)
        pts = int(pot.get("treasury_points") or 0)
        loot = int(pot.get("treasury_loot") or 0)
        member_pot = int(pot.get("member_pot") or 0)

        if cash or pts or loot:
            await db.families.update_one(
                {"id": fid},
                {
                    "$inc": {
                        "treasury": cash,
                        "treasury_points": pts,
                        "treasury_loot_pieces": loot,
                    }
                },
            )
            await log_family_vault_tx(
                db,
                fid,
                "fortnight_payout",
                "system",
                "System",
                cash_delta=cash,
                points_delta=pts,
                loot_delta=loot,
                meta={"period_id": period_id, "rank": rank},
            )

        member_grants = []
        if member_pot > 0 and entry["unique_contributors"] >= MIN_CONTRIBUTORS:
            mems = await db.family_fortnight_member_scores.find(
                {"family_id": fid, "period_id": period_id, "score": {"$gt": 0}},
                {"_id": 0, "user_id": 1, "username": 1, "score": 1},
            ).to_list(500)
            fam_score = max(1, int(entry["score"]) or 1)
            allocated = 0
            for m in mems:
                share = float(m.get("score") or 0) / float(fam_score)
                if share < MEMBER_SHARE_MIN_PCT:
                    continue
                pts_out = int(member_pot * share)
                if pts_out <= 0:
                    continue
                allocated += pts_out
                await db.users.update_one({"id": m["user_id"]}, {"$inc": {"points": pts_out}})
                member_grants.append(
                    {"user_id": m["user_id"], "username": m.get("username"), "points": pts_out, "share": share}
                )
                try:
                    from server import send_notification

                    await send_notification(
                        m["user_id"],
                        "Family Fortnight Reward",
                        f"Your crew finished #{rank} — you received {pts_out:,} points.",
                        "family_fortnight_payout",
                        category="economic",
                    )
                except Exception:
                    pass
            remainder = member_pot - allocated
            if remainder > 0:
                await db.families.update_one({"id": fid}, {"$inc": {"treasury_points": remainder}})

        flair_until = now + timedelta(days=FLAIR_DAYS)
        if rank == 1:
            await db.families.update_one(
                {"id": fid},
                {
                    "$set": {
                        "fortnight_theme_id": THEME_ID,
                        "fortnight_theme_image": THEME_IMAGE,
                        "fortnight_theme_until": flair_until,
                        "fortnight_flair_until": flair_until,
                        "fortnight_racket_buff_pct": RACKET_BUFF_PCT,
                        "fortnight_racket_buff_until": now + timedelta(hours=RACKET_BUFF_HOURS),
                        "crew_of_fortnight_period_id": period_id,
                    }
                },
            )
            # Member badges for ≥1% contributors
            mems = await db.family_fortnight_member_scores.find(
                {"family_id": fid, "period_id": period_id, "score": {"$gt": 0}},
                {"_id": 0, "user_id": 1, "score": 1},
            ).to_list(500)
            fam_score = max(1, int(entry["score"]) or 1)
            for m in mems:
                if float(m.get("score") or 0) / fam_score < 0.01:
                    continue
                await db.users.update_one(
                    {"id": m["user_id"]},
                    {
                        "$set": {
                            "crew_of_fortnight_until": flair_until,
                            "crew_of_fortnight_badge_url": BADGE_IMAGE,
                        },
                        "$addToSet": {"badges": BADGE_LABEL},
                    },
                )
        elif rank in (2, 3):
            await db.families.update_one(
                {"id": fid},
                {"$set": {"fortnight_place": rank, "fortnight_flair_until": flair_until}},
            )
            mems = await db.family_fortnight_member_scores.find(
                {"family_id": fid, "period_id": period_id, "score": {"$gt": 0}},
                {"_id": 0, "user_id": 1, "score": 1},
            ).to_list(500)
            fam_score = max(1, int(entry["score"]) or 1)
            for m in mems:
                if float(m.get("score") or 0) / fam_score < 0.01:
                    continue
                await db.users.update_one(
                    {"id": m["user_id"]},
                    {"$set": {f"fortnight_place_{rank}_until": flair_until}},
                )

        return {
            "family_id": fid,
            "name": entry["name"],
            "rank": rank,
            "score": entry["score"],
            "treasury": {"cash": cash, "points": pts, "loot": loot},
            "member_grants": member_grants,
        }

    eligible = [e for e in ranked if e["unique_contributors"] >= MIN_CONTRIBUTORS and e["score"] > 0]
    # Top 3 need eligibility; crumb 4-10 can be from ranked with score > 0
    for i, entry in enumerate(eligible[:3]):
        rank = i + 1
        pot = payout_cfg.get(str(rank)) or payout_cfg.get(rank) or DEFAULT_PAYOUTS[rank]
        if not test_run:
            placements.append(await _pay_rank(rank, entry, pot))
        else:
            placements.append({"rank": rank, "family_id": entry["family_id"], "score": entry["score"], "test": True})

    crumb_pot = payout_cfg.get("crumb") or DEFAULT_PAYOUTS["crumb"]
    # places 4-10 from full ranked list excluding top3 paid
    paid_ids = {p["family_id"] for p in placements}
    crumb_candidates = [e for e in ranked if e["family_id"] not in paid_ids and e["score"] > 0][:7]
    for i, entry in enumerate(crumb_candidates):
        rank = 4 + i
        if not test_run:
            placements.append(await _pay_rank(rank, entry, crumb_pot))
        else:
            placements.append({"rank": rank, "family_id": entry["family_id"], "score": entry["score"], "test": True})

    doc = {
        "period_id": period_id,
        "paid_at": now,
        "placements": placements,
        "test_run": bool(test_run),
    }
    if not test_run:
        await db.family_fortnight_payouts.insert_one(doc)
    logger.info("family_fortnight settle period=%s placements=%d", period_id, len(placements))
    return doc


async def get_leaderboard(db, *, limit: int = 10) -> Dict[str, Any]:
    period_id = fortnight_period_id()
    start, end = fortnight_range_utc()
    rows = await db.family_fortnight_scores.find({"period_id": period_id}, {"_id": 0}).sort("score", -1).to_list(200)
    out = []
    for r in rows:
        fid = r.get("family_id")
        fam = await db.families.find_one({"id": fid}, {"_id": 0, "name": 1, "tag": 1}) if fid else None
        if not fam:
            continue
        contribs = r.get("contributor_ids") or []
        out.append(
            {
                "family_id": fid,
                "name": fam.get("name"),
                "tag": fam.get("tag"),
                "score": int(r.get("score") or 0),
                "unique_contributors": len(set(contribs)),
            }
        )
    out.sort(key=lambda x: (-x["score"], -x["unique_contributors"]))
    last = await db.family_fortnight_payouts.find_one(sort=[("paid_at", -1)], projection={"_id": 0})
    return {
        "enabled": await is_enabled(db),
        "period_id": period_id,
        "period_start": start.isoformat().replace("+00:00", "Z"),
        "period_end": end.isoformat().replace("+00:00", "Z"),
        "leaderboard": out[:limit],
        "last_payout": last,
        "vices": vices_payload(),
    }


async def get_my_contribution(db, user_id: str) -> Dict[str, Any]:
    period_id = fortnight_period_id()
    fid = await _resolve_family_id(db, user_id)
    if not fid:
        return {"in_family": False, "enabled": await is_enabled(db)}
    fam = await db.family_fortnight_scores.find_one({"family_id": fid, "period_id": period_id}, {"_id": 0})
    mem = await db.family_fortnight_member_scores.find_one(
        {"family_id": fid, "period_id": period_id, "user_id": str(user_id)},
        {"_id": 0},
    )
    fam_score = int((fam or {}).get("score") or 0)
    my_score = int((mem or {}).get("score") or 0)
    share = (my_score / fam_score) if fam_score > 0 else 0.0
    # rank
    better = await db.family_fortnight_scores.count_documents(
        {"period_id": period_id, "score": {"$gt": fam_score}}
    )
    day = _utc_day_str()
    melt_today = int((((mem or {}).get("counters") or {}).get(day) or {}).get("melt_to_family") or 0)
    return {
        "in_family": True,
        "enabled": await is_enabled(db),
        "period_id": period_id,
        "family_id": fid,
        "family_score": fam_score,
        "personal_score": my_score,
        "share": share,
        "rank": int(better) + 1 if fam else None,
        "melt_to_family_today": melt_today,
        "melt_floor": LOW_MELT_BULLETS,
        "breakdown": (mem or {}).get("breakdown") or {},
        "vices": vices_payload(),
    }


async def run_family_fortnight_worker(db) -> None:
    """Background loop: underperform settle + fortnight payout."""
    import asyncio

    await ensure_default_config(db)
    while True:
        try:
            if await is_enabled(db):
                await settle_underperform_for_day(db)
                await run_fortnight_settle(db)
        except Exception:
            logger.exception("family_fortnight worker tick failed")
        await asyncio.sleep(60)
