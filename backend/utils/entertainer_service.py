"""Entertainer staff fund, daily refill, funded-game ledger, and completion bonus (MDG / MP Poker)."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from pymongo import ReturnDocument

_logger = logging.getLogger(__name__)

ENTERTAINER_DAILY_FUND_CASH = 50_000_000
ENTERTAINER_DAILY_FUND_POINTS = 3_000
ENTERTAINER_COMPLETION_BLOCK = 5
ENTERTAINER_COMPLETION_BONUS_POINTS = 50
ENTERTAINER_COMPLETION_BONUS_DAILY_CAP = 250
ENTERTAINER_ONLINE_COLOR_DEFAULT = "#7c3aed"  # violet; distinct from mod/HDO

# Skill perks (same mapping as admin add-tokens). Game Pass / rank_xp_pass is intentionally excluded.
ENTERTAINER_PERK_TOKEN_FIELDS = {
    "xp_crimes": "xp_crimes_tokens",
    "xp_gta": "xp_gta_tokens",
    "auto_rank_2h": "auto_rank_2h_tokens",
    "melt": "melt_tokens",
    "oc_reduced": "oc_reduced_tokens",
    "booze": "booze_tokens",
    "racket": "racket_tokens",
    "travel": "travel_tokens",
    "properties": "properties_tokens",
    "jailbust_bonus": "jailbust_tokens",
}
ENTERTAINER_PERKS_DAILY_TOTAL_CAP = 10
ENTERTAINER_PERKS_DAILY_AUTO_RANK_CAP = 2

ENTERTAINER_PERK_LABELS = {
    "xp_crimes": "Crime XP",
    "xp_gta": "GTA XP",
    "auto_rank_2h": "Auto Rank (2h)",
    "melt": "Melt",
    "oc_reduced": "OC Reduced",
    "booze": "Booze",
    "racket": "Racket",
    "travel": "Travel",
    "properties": "Properties",
    "jailbust_bonus": "Jailbust",
}


def entertainer_perk_label(token_type: str) -> str:
    return ENTERTAINER_PERK_LABELS.get(token_type, token_type.replace("_", " ").title())


def entertainer_utc_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _sanitize_hex_color(raw: Optional[str], default: str = ENTERTAINER_ONLINE_COLOR_DEFAULT) -> str:
    s = (raw or "").strip() or default
    if not (s.startswith("#") and len(s) in (4, 7) and all(c in "0123456789AaBbCcDdEeFf" for c in s[1:])):
        return default
    return s


def is_entertainer_user(user: Optional[dict]) -> bool:
    return bool((user or {}).get("is_entertainer"))


async def try_debit_entertainer_fund(db, uid: str, dec_money: float, dec_points: int) -> bool:
    """Debit entertainer segregated fund only. Returns True if applied (including zero debit)."""
    dec_money = max(0.0, float(dec_money or 0))
    dec_points = max(0, int(dec_points or 0))
    if dec_money <= 0 and dec_points <= 0:
        return True
    filt: Dict[str, Any] = {"id": uid, "is_entertainer": True}
    inc: Dict[str, Any] = {}
    if dec_points:
        filt["entertainer_fund_points"] = {"$gte": dec_points}
        inc["entertainer_fund_points"] = -dec_points
    if dec_money:
        filt["entertainer_fund_cash"] = {"$gte": dec_money}
        inc["entertainer_fund_cash"] = -dec_money
    r = await db.users.update_one(filt, {"$inc": inc})
    return r.modified_count == 1


async def insert_funded_game_row(
    db,
    *,
    entertainer_id: str,
    source: str,
    ref_id: str,
    utc_day: Optional[str] = None,
) -> str:
    row_id = str(uuid.uuid4())
    day = utc_day or entertainer_utc_today()
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.entertainer_funded_games.insert_one(
        {
            "id": row_id,
            "entertainer_id": entertainer_id,
            "source": source,
            "ref_id": ref_id,
            "utc_day": day,
            "funded_at": now_iso,
            "completed_at": None,
        }
    )
    return row_id


async def run_entertainer_daily_refills(db, send_notification) -> None:
    """Credit daily fund to all live entertainers once per UTC day each (per-user idempotency)."""
    today = entertainer_utc_today()
    cursor = db.users.find(
        {"is_entertainer": True, "is_dead": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "entertainer_fund_last_refill_utc_date": 1},
    )
    async for u in cursor:
        uid = u.get("id")
        if not uid:
            continue
        last = u.get("entertainer_fund_last_refill_utc_date")
        if last == today:
            continue
        res = await db.users.update_one(
            {
                "id": uid,
                "is_entertainer": True,
                "is_dead": {"$ne": True},
                "$or": [
                    {"entertainer_fund_last_refill_utc_date": {"$exists": False}},
                    {"entertainer_fund_last_refill_utc_date": None},
                    {"entertainer_fund_last_refill_utc_date": {"$ne": today}},
                ],
            },
            {
                "$inc": {
                    "entertainer_fund_cash": ENTERTAINER_DAILY_FUND_CASH,
                    "entertainer_fund_points": ENTERTAINER_DAILY_FUND_POINTS,
                    "entertainer_lifetime_fund_cash_granted": ENTERTAINER_DAILY_FUND_CASH,
                    "entertainer_lifetime_fund_points_granted": ENTERTAINER_DAILY_FUND_POINTS,
                },
                "$set": {"entertainer_fund_last_refill_utc_date": today},
            },
        )
        if res.modified_count:
            uname = u.get("username") or "?"
            try:
                await send_notification(
                    uid,
                    "Entertainer daily fund",
                    f"Your entertainer fund was topped up: +${ENTERTAINER_DAILY_FUND_CASH:,.0f} cash and +{ENTERTAINER_DAILY_FUND_POINTS:,} fund points (UTC day {today}).",
                    "system",
                    category="entertainer",
                )
            except Exception as e:
                _logger.warning("Entertainer refill notify failed uid=%s: %s", uid, e)
            _logger.info("Entertainer daily refill for %s (%s)", uname, uid)


async def _load_entertainer_counters(db, entertainer_id: str) -> dict:
    u = await db.users.find_one(
        {"id": entertainer_id},
        {
            "_id": 0,
            "entertainer_activity_utc_date": 1,
            "entertainer_funded_completions_today": 1,
            "entertainer_completion_bonus_points_today": 1,
        },
    )
    return u or {}


async def _ensure_activity_day(db, entertainer_id: str, today: str) -> Tuple[int, int]:
    """Reset per-day completion counters if UTC day changed. Returns (completions_today, bonus_points_today)."""
    u = await _load_entertainer_counters(db, entertainer_id)
    stored = u.get("entertainer_activity_utc_date")
    completions = int(u.get("entertainer_funded_completions_today") or 0)
    bonus_today = int(u.get("entertainer_completion_bonus_points_today") or 0)
    if stored != today:
        await db.users.update_one(
            {"id": entertainer_id},
            {
                "$set": {
                    "entertainer_activity_utc_date": today,
                    "entertainer_funded_completions_today": 0,
                    "entertainer_completion_bonus_points_today": 0,
                }
            },
        )
        return 0, 0
    return completions, bonus_today


async def on_funded_game_completed(
    db,
    *,
    ref_id: str,
    source: str,
    send_notification,
    log_points_event,
) -> None:
    """Mark ledger row completed (first wins) and grant +50 main points per 5 completions, max 250/day."""
    row = await db.entertainer_funded_games.find_one_and_update(
        {"ref_id": ref_id, "source": source, "completed_at": None},
        {"$set": {"completed_at": datetime.now(timezone.utc).isoformat()}},
        return_document=ReturnDocument.AFTER,
    )
    if not row or not row.get("entertainer_id"):
        return
    doc = row
    eid = doc["entertainer_id"]
    today = entertainer_utc_today()
    completions, bonus_today = await _ensure_activity_day(db, eid, today)
    new_completions = completions + 1
    old_blocks = completions // ENTERTAINER_COMPLETION_BLOCK
    new_blocks = new_completions // ENTERTAINER_COMPLETION_BLOCK
    pay_chunks = new_blocks - old_blocks
    points_to_pay = 0
    if pay_chunks > 0 and bonus_today < ENTERTAINER_COMPLETION_BONUS_DAILY_CAP:
        chunk = min(
            ENTERTAINER_COMPLETION_BONUS_POINTS,
            ENTERTAINER_COMPLETION_BONUS_DAILY_CAP - bonus_today,
        )
        if chunk > 0:
            points_to_pay = chunk

    inc_user: Dict[str, Any] = {"entertainer_funded_completions_today": 1}
    if points_to_pay:
        inc_user["points"] = points_to_pay
        inc_user["entertainer_completion_bonus_points_today"] = points_to_pay
        inc_user["entertainer_lifetime_bonus_points_paid"] = points_to_pay

    uread = await db.users.find_one({"id": eid}, {"_id": 0, "points": 1, "username": 1})
    pts_before = int((uread or {}).get("points") or 0)
    set_fields: Dict[str, Any] = {"entertainer_activity_utc_date": today}
    await db.users.update_one({"id": eid}, {"$inc": inc_user, "$set": set_fields})

    if points_to_pay:
        try:
            await log_points_event(
                db,
                user_id=eid,
                points=points_to_pay,
                event_type="entertainer_completion_bonus",
                event_ref=f"{source}:{ref_id}",
                meta={"source": source, "ref_id": ref_id, "completions_today": new_completions},
                wallet_points_before=pts_before,
                wallet_points_after=pts_before + points_to_pay,
            )
        except Exception as ex:
            _logger.warning("entertainer bonus log_points_event: %s", ex)
        try:
            await send_notification(
                eid,
                "Entertainer completion bonus",
                f"+{points_to_pay} points for funded game milestones (5 per block, max {ENTERTAINER_COMPLETION_BONUS_DAILY_CAP}/day UTC).",
                "reward",
                category="entertainer",
            )
        except Exception as ex:
            _logger.warning("entertainer bonus notify: %s", ex)


def _pipeline_sync_entertainer_perk_day(today: str) -> list:
    """UTC roll: reset perk counters when the calendar day changes."""
    return [
        {
            "$set": {
                "entertainer_perks_day": {
                    "$cond": {
                        "if": {"$eq": ["$entertainer_perks_day", today]},
                        "then": "$entertainer_perks_day",
                        "else": today,
                    }
                },
                "entertainer_perks_units": {
                    "$cond": {
                        "if": {"$eq": ["$entertainer_perks_day", today]},
                        "then": {"$ifNull": ["$entertainer_perks_units", 0]},
                        "else": 0,
                    }
                },
                "entertainer_perks_auto_rank_units": {
                    "$cond": {
                        "if": {"$eq": ["$entertainer_perks_day", today]},
                        "then": {"$ifNull": ["$entertainer_perks_auto_rank_units", 0]},
                        "else": 0,
                    }
                },
            }
        }
    ]


async def sync_entertainer_perk_utc_day(db, entertainer_id: str, today: str) -> None:
    await db.users.update_one({"id": entertainer_id}, _pipeline_sync_entertainer_perk_day(today))


async def grant_entertainer_perk_tokens(
    db,
    *,
    entertainer_id: str,
    target_id: str,
    token_type: str,
    amount: int,
    today: str,
) -> None:
    """
    Grant armoury perk tokens from entertainer quota (UTC day).
    Caps: ENTERTAINER_PERKS_DAILY_TOTAL_CAP units total; ENTERTAINER_PERKS_DAILY_AUTO_RANK_CAP units for auto_rank_2h.
    Raises ValueError with a short message on validation / quota failures.
    """
    if token_type not in ENTERTAINER_PERK_TOKEN_FIELDS:
        raise ValueError("Invalid perk type.")
    if amount < 1:
        raise ValueError("Amount must be at least 1.")
    if amount > ENTERTAINER_PERKS_DAILY_TOTAL_CAP:
        raise ValueError(f"Amount cannot exceed {ENTERTAINER_PERKS_DAILY_TOTAL_CAP} per grant.")
    field = ENTERTAINER_PERK_TOKEN_FIELDS[token_type]
    is_auto_rank = token_type == "auto_rank_2h"
    if is_auto_rank and amount > ENTERTAINER_PERKS_DAILY_AUTO_RANK_CAP:
        raise ValueError(f"You can grant at most {ENTERTAINER_PERKS_DAILY_AUTO_RANK_CAP} Auto Rank tokens per day.")

    await sync_entertainer_perk_utc_day(db, entertainer_id, today)

    filt: Dict[str, Any] = {
        "id": entertainer_id,
        "entertainer_perks_day": today,
        "entertainer_perks_units": {"$lte": ENTERTAINER_PERKS_DAILY_TOTAL_CAP - amount},
    }
    inc_ent: Dict[str, Any] = {"entertainer_perks_units": amount}
    if is_auto_rank:
        filt["entertainer_perks_auto_rank_units"] = {"$lte": ENTERTAINER_PERKS_DAILY_AUTO_RANK_CAP - amount}
        inc_ent["entertainer_perks_auto_rank_units"] = amount

    res_e = await db.users.update_one(filt, {"$inc": inc_ent})
    if res_e.modified_count == 0:
        raise ValueError(
            "Daily perk limit reached (max "
            f"{ENTERTAINER_PERKS_DAILY_TOTAL_CAP} perk tokens/day UTC; "
            f"max {ENTERTAINER_PERKS_DAILY_AUTO_RANK_CAP} Auto Rank 2h tokens/day)."
        )

    rollback_needed = True
    try:
        res_t = await db.users.update_one(
            {"id": target_id, "is_dead": {"$ne": True}},
            {"$inc": {field: amount}},
        )
        if res_t.modified_count == 0:
            raise ValueError("Player not found or is dead.")
        rollback_needed = False
    finally:
        if rollback_needed:
            rb = {"entertainer_perks_units": -amount}
            if is_auto_rank:
                rb["entertainer_perks_auto_rank_units"] = -amount
            await db.users.update_one({"id": entertainer_id}, {"$inc": rb})


async def build_entertainer_dashboard(db, entertainer_id: str) -> Dict[str, Any]:
    today = entertainer_utc_today()
    u = await db.users.find_one(
        {"id": entertainer_id},
        {
            "_id": 0,
            "username": 1,
            "is_entertainer": 1,
            "entertainer_fund_cash": 1,
            "entertainer_fund_points": 1,
            "entertainer_lifetime_bonus_points_paid": 1,
            "entertainer_lifetime_fund_cash_granted": 1,
            "entertainer_lifetime_fund_points_granted": 1,
            "entertainer_fund_last_refill_utc_date": 1,
            "entertainer_funded_completions_today": 1,
            "entertainer_completion_bonus_points_today": 1,
            "entertainer_activity_utc_date": 1,
            "entertainer_perks_day": 1,
            "entertainer_perks_units": 1,
            "entertainer_perks_auto_rank_units": 1,
        },
    )
    if not u or not u.get("is_entertainer"):
        return {}
    funded_today = await db.entertainer_funded_games.count_documents({"entertainer_id": entertainer_id, "utc_day": today})
    recent = (
        await db.entertainer_funded_games.find({"entertainer_id": entertainer_id}, {"_id": 0})
        .sort("funded_at", -1)
        .limit(25)
        .to_list(25)
    )
    perk_day = u.get("entertainer_perks_day")
    if perk_day != today:
        perk_units = 0
        perk_auto_units = 0
    else:
        perk_units = int(u.get("entertainer_perks_units") or 0)
        perk_auto_units = int(u.get("entertainer_perks_auto_rank_units") or 0)
    return {
        "username": u.get("username"),
        "entertainer_fund_cash": float(u.get("entertainer_fund_cash") or 0),
        "entertainer_fund_points": int(u.get("entertainer_fund_points") or 0),
        "funded_games_today_count": funded_today,
        "lifetime_bonus_points_paid": int(u.get("entertainer_lifetime_bonus_points_paid") or 0),
        "lifetime_fund_cash_granted": int(u.get("entertainer_lifetime_fund_cash_granted") or 0),
        "lifetime_fund_points_granted": int(u.get("entertainer_lifetime_fund_points_granted") or 0),
        "last_refill_utc_date": u.get("entertainer_fund_last_refill_utc_date"),
        "funded_completions_today": int(u.get("entertainer_funded_completions_today") or 0),
        "completion_bonus_points_today": int(u.get("entertainer_completion_bonus_points_today") or 0),
        "activity_utc_date": u.get("entertainer_activity_utc_date"),
        "recent_funded_games": recent,
        "perk_tokens_used_today": perk_units,
        "perk_tokens_remaining_today": max(0, ENTERTAINER_PERKS_DAILY_TOTAL_CAP - perk_units),
        "perk_auto_rank_used_today": perk_auto_units,
        "perk_auto_rank_remaining_today": max(0, ENTERTAINER_PERKS_DAILY_AUTO_RANK_CAP - perk_auto_units),
        "perk_token_types": list(ENTERTAINER_PERK_TOKEN_FIELDS.keys()),
    }
