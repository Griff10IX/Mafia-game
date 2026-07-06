"""Entertainer staff fund, daily refill, funded-game ledger, and completion bonus (MDG / MP Poker)."""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone
from typing import Any, Dict, Optional, Tuple

from pymongo import ReturnDocument

_logger = logging.getLogger(__name__)

ENTERTAINER_DAILY_FUND_CASH = 50_000_000
ENTERTAINER_DAILY_FUND_POINTS = 3_000
ENTERTAINER_FUND_CASH_MAX = 100_000_000
ENTERTAINER_FUND_POINTS_MAX = 5_000
ENTERTAINER_COMPLETION_BLOCK = 5
ENTERTAINER_COMPLETION_BONUS_POINTS = 50
ENTERTAINER_COMPLETION_BONUS_DAILY_CAP = 250
ENTERTAINER_ONLINE_COLOR_DEFAULT = "#7c3aed"  # violet; distinct from mod/HDO
# Max points an entertainer may put into one game from the entertainer fund (fee + extra combined for MDG; tournament buy-in for MP Poker points).
ENTERTAINER_MDG_MAX_POINTS_PER_GAME = 1_000
ENTERTAINER_MP_POKER_MAX_POINTS_PER_GAME = 5_000
# Max total reward points (Gbox pool) from entertainer fund per forum Gbox game.
ENTERTAINER_GBOX_MAX_POINTS_PER_GAME = 500

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

ENTERTAINER_BROADCASTS_DAILY_CAP = 5
ENTERTAINER_BROADCAST_MAX_TITLE_LEN = 120
ENTERTAINER_BROADCAST_MAX_MESSAGE_LEN = 500
ENTERTAINER_BROADCAST_FORUM_LINK = "/social/forum?tab=entertainer"
ENTERTAINER_BROADCAST_FORUM_LABEL = "Entertainer Forum"

ENTERTAINER_BROADCAST_TEMPLATES: Dict[str, Dict[str, str]] = {
    "new_e_games": {
        "label": "New E-Games (dice / gbox / hangman)",
        "title": "🎲 New E-Games",
        "message": "Dice, gbox & hangman games are open in the Entertainer Forum — join now!",
    },
    "mdg": {
        "label": "MDG starting",
        "title": "🃏 MDG starting",
        "message": "A Murder Death Genocide game is live in the Entertainer Forum. Head over to join!",
    },
    "mp_poker": {
        "label": "MP Poker table",
        "title": "♠️ MP Poker",
        "message": "An MP Poker table is open in the Entertainer Forum — take a seat!",
    },
    "word_hunt": {
        "label": "Word hunt",
        "title": "🔎 Word hunt",
        "message": "Find the hidden word in the Entertainer Forum for a prize!",
    },
    "forum": {
        "label": "Entertainer Forum (general)",
        "title": "🎪 Entertainer Forum",
        "message": "Check the Entertainer Forum for games and events!",
    },
}

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


def _normalize_entertainer_refill_utc_day(val: Any) -> Optional[str]:
    """UTC calendar day YYYY-MM-DD for idempotency (handles BSON date, datetime, ISO string)."""
    if val is None:
        return None
    if isinstance(val, datetime):
        dt = val
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.date().isoformat()
    if type(val) is date:
        return val.isoformat()
    s = str(val).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return None


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
    """Accrue daily allowance once per UTC day into pending; entertainers collect into the spendable fund in Hub."""
    today = entertainer_utc_today()
    cursor = db.users.find(
        {"is_entertainer": True, "is_dead": {"$ne": True}},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "entertainer_fund_cash": 1,
            "entertainer_fund_points": 1,
            "entertainer_fund_last_refill_utc_date": 1,
        },
    )
    async for u in cursor:
        uid = u.get("id")
        if not uid:
            continue
        last = u.get("entertainer_fund_last_refill_utc_date")
        if _normalize_entertainer_refill_utc_day(last) == today:
            continue
        current_cash = float(u.get("entertainer_fund_cash") or 0.0)
        current_points = int(u.get("entertainer_fund_points") or 0)
        add_cash = int(
            min(
                ENTERTAINER_DAILY_FUND_CASH,
                max(0, int(ENTERTAINER_FUND_CASH_MAX - current_cash)),
            )
        )
        add_points = int(
            min(
                ENTERTAINER_DAILY_FUND_POINTS,
                max(0, int(ENTERTAINER_FUND_POINTS_MAX - current_points)),
            )
        )
        inc_doc: Dict[str, Any] = {
            "entertainer_lifetime_fund_cash_granted": add_cash,
            "entertainer_lifetime_fund_points_granted": add_points,
        }
        if add_cash > 0:
            inc_doc["entertainer_pending_fund_cash"] = float(add_cash)
        if add_points > 0:
            inc_doc["entertainer_pending_fund_points"] = int(add_points)

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
            {"$inc": inc_doc, "$set": {"entertainer_fund_last_refill_utc_date": today}},
        )
        if res.modified_count:
            uname = u.get("username") or "?"
            if add_cash > 0 or add_points > 0:
                try:
                    await send_notification(
                        uid,
                        "Entertainer daily allowance",
                        f"+${add_cash:,.0f} cash and +{add_points:,} fund points are ready in your pending balance (UTC {today}). "
                        "Open Entertainer Hub and tap Collect to move them into your spendable fund (up to fund caps).",
                        "system",
                        category="entertainer",
                    )
                except Exception as e:
                    _logger.warning("Entertainer refill notify failed uid=%s: %s", uid, e)
            _logger.info(
                "Entertainer daily accrual for %s (%s): +$%s, +%s pts pending (caps cash=%s pts=%s)",
                uname,
                uid,
                f"{add_cash:,}",
                f"{add_points:,}",
                f"{ENTERTAINER_FUND_CASH_MAX:,}",
                f"{ENTERTAINER_FUND_POINTS_MAX:,}",
            )


async def collect_entertainer_pending_to_fund(db, entertainer_id: str) -> Dict[str, Any]:
    """Move pending daily allowance into entertainer_fund_* up to caps. Atomic aggregation pipeline."""
    before = await db.users.find_one(
        {"id": entertainer_id, "is_entertainer": True, "is_dead": {"$ne": True}},
        {
            "_id": 0,
            "entertainer_fund_cash": 1,
            "entertainer_fund_points": 1,
            "entertainer_pending_fund_cash": 1,
            "entertainer_pending_fund_points": 1,
        },
    )
    if not before:
        return {"ok": False, "detail": "Entertainer not found"}
    pc0 = float(before.get("entertainer_pending_fund_cash") or 0.0)
    pp0 = int(before.get("entertainer_pending_fund_points") or 0)
    fc0 = float(before.get("entertainer_fund_cash") or 0.0)
    fp0 = int(before.get("entertainer_fund_points") or 0)
    cash_max = float(ENTERTAINER_FUND_CASH_MAX)
    pts_max = int(ENTERTAINER_FUND_POINTS_MAX)
    pipeline = [
        {
            "$set": {
                "_fc": {"$toDouble": {"$ifNull": ["$entertainer_fund_cash", 0]}},
                "_fp": {"$toInt": {"$ifNull": ["$entertainer_fund_points", 0]}},
                "_pc": {"$toDouble": {"$ifNull": ["$entertainer_pending_fund_cash", 0]}},
                "_pp": {"$toInt": {"$ifNull": ["$entertainer_pending_fund_points", 0]}},
            }
        },
        {
            "$set": {
                "_mc": {
                    "$max": [
                        0,
                        {"$min": ["$_pc", {"$subtract": [cash_max, "$_fc"]}]},
                    ]
                },
                "_mp": {
                    "$max": [
                        0,
                        {"$min": ["$_pp", {"$subtract": [pts_max, "$_fp"]}]},
                    ]
                },
            }
        },
        {
            "$set": {
                "entertainer_fund_cash": {"$add": ["$_fc", "$_mc"]},
                "entertainer_fund_points": {"$add": ["$_fp", "$_mp"]},
                "entertainer_pending_fund_cash": {"$subtract": ["$_pc", "$_mc"]},
                "entertainer_pending_fund_points": {"$subtract": ["$_pp", "$_mp"]},
            }
        },
        {"$unset": ["_fc", "_fp", "_pc", "_pp", "_mc", "_mp"]},
    ]
    r = await db.users.update_one(
        {"id": entertainer_id, "is_entertainer": True, "is_dead": {"$ne": True}},
        pipeline,
    )
    if not r.matched_count:
        return {"ok": False, "detail": "Entertainer not found"}
    after = await db.users.find_one(
        {"id": entertainer_id},
        {
            "_id": 0,
            "entertainer_fund_cash": 1,
            "entertainer_fund_points": 1,
            "entertainer_pending_fund_cash": 1,
            "entertainer_pending_fund_points": 1,
        },
    )
    fc1 = float((after or {}).get("entertainer_fund_cash") or 0.0)
    fp1 = int((after or {}).get("entertainer_fund_points") or 0)
    pc1 = float((after or {}).get("entertainer_pending_fund_cash") or 0.0)
    pp1 = int((after or {}).get("entertainer_pending_fund_points") or 0)
    moved_cash = max(0.0, round(fc1 - fc0, 2))
    moved_pts = max(0, fp1 - fp0)
    return {
        "ok": True,
        "moved_cash": moved_cash,
        "moved_points": moved_pts,
        "entertainer_fund_cash": fc1,
        "entertainer_fund_points": fp1,
        "entertainer_pending_fund_cash": pc1,
        "entertainer_pending_fund_points": pp1,
        "had_pending_before": pc0 > 0 or pp0 > 0,
        "nothing_moved": moved_cash <= 0 and moved_pts <= 0,
    }


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


_FUNDED_GAME_OUTCOME_KEYS = frozenset(
    {
        "winner_username",
        "winner_id",
        "total_winnings_points",
        "total_winnings_cash",
        "from_entertainer_fund_points",
        "from_entertainer_fund_cash",
        "mp_poker_subkind",
    }
)


def _sanitize_funded_game_outcome(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Persist only known keys with safe types (callers may pass partial dict)."""
    if not raw:
        return {}
    out: Dict[str, Any] = {}
    for k in _FUNDED_GAME_OUTCOME_KEYS:
        if k not in raw:
            continue
        v = raw[k]
        if v is None:
            continue
        if k in ("total_winnings_points", "from_entertainer_fund_points"):
            out[k] = int(v)
        elif k in ("total_winnings_cash", "from_entertainer_fund_cash"):
            out[k] = float(v)
        elif k == "mp_poker_subkind" and v in ("tournament", "table"):
            out[k] = v
        elif k == "winner_id":
            s = str(v).strip()
            if s:
                out[k] = s
        elif k == "winner_username":
            s = str(v).strip()
            if s:
                out[k] = s
    return out


async def on_funded_game_completed(
    db,
    *,
    ref_id: str,
    source: str,
    send_notification,
    log_points_event,
    outcome: Optional[Dict[str, Any]] = None,
) -> None:
    """Mark ledger row completed (first wins) and grant +50 main points per 5 completions, max 250/day.

    Optional ``outcome`` is merged into the ledger row (winner, total payout, amount seeded from fund).
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    set_doc: Dict[str, Any] = {"completed_at": now_iso, **(_sanitize_funded_game_outcome(outcome))}
    row = await db.entertainer_funded_games.find_one_and_update(
        {"ref_id": ref_id, "source": source, "completed_at": None},
        {"$set": set_doc},
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


async def sync_entertainer_broadcast_utc_day(db, entertainer_id: str, today: str) -> None:
    await db.users.update_one(
        {"id": entertainer_id, "entertainer_broadcasts_day": {"$ne": today}},
        {"$set": {"entertainer_broadcasts_day": today, "entertainer_broadcasts_count": 0}},
    )


def entertainer_broadcast_copy(template: str, *, entertainer_name: str, title: Optional[str], message: Optional[str]) -> tuple:
    """Resolve title/message for a broadcast. Raises ValueError on invalid input."""
    key = (template or "custom").strip().lower()
    ent = (entertainer_name or "Entertainer").strip() or "Entertainer"
    if key == "custom":
        out_title = (title or "").strip()
        out_message = (message or "").strip()
        if not out_title:
            raise ValueError("Title is required for a custom broadcast.")
        if not out_message:
            raise ValueError("Message is required for a custom broadcast.")
    elif key in ENTERTAINER_BROADCAST_TEMPLATES:
        tpl = ENTERTAINER_BROADCAST_TEMPLATES[key]
        out_title = (title or tpl["title"]).strip() or tpl["title"]
        base_msg = (message or tpl["message"]).strip() or tpl["message"]
        out_message = base_msg
    else:
        raise ValueError("Unknown broadcast template.")
    if len(out_title) > ENTERTAINER_BROADCAST_MAX_TITLE_LEN:
        raise ValueError(f"Title must be at most {ENTERTAINER_BROADCAST_MAX_TITLE_LEN} characters.")
    if len(out_message) > ENTERTAINER_BROADCAST_MAX_MESSAGE_LEN:
        raise ValueError(f"Message must be at most {ENTERTAINER_BROADCAST_MAX_MESSAGE_LEN} characters.")
    if f"— {ent}" not in out_message and f"- {ent}" not in out_message:
        suffix = f" — Entertainer {ent}"
        if len(out_message) + len(suffix) <= ENTERTAINER_BROADCAST_MAX_MESSAGE_LEN:
            out_message = out_message + suffix
    return out_title, out_message


async def send_entertainer_game_broadcast(
    db,
    send_notification_to_all,
    *,
    entertainer_id: str,
    entertainer_name: str,
    template: str,
    title: Optional[str] = None,
    message: Optional[str] = None,
) -> dict:
    """Game-wide inbox broadcast (category ent_games). Daily cap per entertainer (UTC)."""
    from utils.profanity import contains_profanity

    today = entertainer_utc_today()
    out_title, out_message = entertainer_broadcast_copy(
        template,
        entertainer_name=entertainer_name,
        title=title,
        message=message,
    )
    if contains_profanity(out_title) or contains_profanity(out_message):
        raise ValueError("Broadcast text is not allowed.")

    await sync_entertainer_broadcast_utc_day(db, entertainer_id, today)
    reserved = await db.users.update_one(
        {
            "id": entertainer_id,
            "entertainer_broadcasts_day": today,
            "entertainer_broadcasts_count": {"$lt": ENTERTAINER_BROADCASTS_DAILY_CAP},
        },
        {"$inc": {"entertainer_broadcasts_count": 1}},
    )
    if reserved.modified_count == 0:
        raise ValueError(
            f"Daily broadcast limit reached ({ENTERTAINER_BROADCASTS_DAILY_CAP} per UTC day)."
        )

    ent_name = (entertainer_name or "?").strip()
    try:
        await send_notification_to_all(
            out_title,
            out_message,
            "system",
            category="ent_games",
            message_link_to=ENTERTAINER_BROADCAST_FORUM_LINK,
            message_link_label=ENTERTAINER_BROADCAST_FORUM_LABEL,
            actor_username=ent_name,
            entertainer_broadcast=True,
        )
    except Exception:
        await db.users.update_one(
            {"id": entertainer_id, "entertainer_broadcasts_day": today},
            {"$inc": {"entertainer_broadcasts_count": -1}},
        )
        raise

    used = await db.users.find_one(
        {"id": entertainer_id},
        {"_id": 0, "entertainer_broadcasts_count": 1},
    )
    count = int((used or {}).get("entertainer_broadcasts_count") or 0)
    return {
        "title": out_title,
        "message": out_message,
        "template": (template or "custom").strip().lower(),
        "broadcasts_used_today": count,
        "broadcasts_remaining_today": max(0, ENTERTAINER_BROADCASTS_DAILY_CAP - count),
    }


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
            "entertainer_pending_fund_cash": 1,
            "entertainer_pending_fund_points": 1,
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
            "entertainer_broadcasts_day": 1,
            "entertainer_broadcasts_count": 1,
        },
    )
    if not u or not u.get("is_entertainer"):
        return {}
    funded_today = await db.entertainer_funded_games.count_documents({"entertainer_id": entertainer_id, "utc_day": today})
    funded_ledger_open = await db.entertainer_funded_games.count_documents(
        {"entertainer_id": entertainer_id, "completed_at": None}
    )
    funded_ledger_completed = await db.entertainer_funded_games.count_documents(
        {"entertainer_id": entertainer_id, "completed_at": {"$ne": None}}
    )
    agg_paid = await db.entertainer_funded_games.aggregate(
        [
            {"$match": {"entertainer_id": entertainer_id, "completed_at": {"$ne": None}}},
            {
                "$group": {
                    "_id": None,
                    "paid_pts": {"$sum": {"$ifNull": ["$total_winnings_points", 0]}},
                    "paid_cash": {"$sum": {"$ifNull": ["$total_winnings_cash", 0.0]}},
                }
            },
        ]
    ).to_list(1)
    paid_row = agg_paid[0] if agg_paid else {}
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
    broadcast_day = u.get("entertainer_broadcasts_day")
    if broadcast_day != today:
        broadcasts_used = 0
    else:
        broadcasts_used = int(u.get("entertainer_broadcasts_count") or 0)
    return {
        "username": u.get("username"),
        "entertainer_fund_cash": float(u.get("entertainer_fund_cash") or 0),
        "entertainer_fund_points": int(u.get("entertainer_fund_points") or 0),
        "entertainer_pending_fund_cash": float(u.get("entertainer_pending_fund_cash") or 0),
        "entertainer_pending_fund_points": int(u.get("entertainer_pending_fund_points") or 0),
        "funded_games_today_count": funded_today,
        "funded_ledger_open_count": int(funded_ledger_open),
        "funded_ledger_completed_count": int(funded_ledger_completed),
        "funded_ledger_paid_out_points_total": int(paid_row.get("paid_pts") or 0),
        "funded_ledger_paid_out_cash_total": float(paid_row.get("paid_cash") or 0.0),
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
        "broadcasts_used_today": broadcasts_used,
        "broadcasts_remaining_today": max(0, ENTERTAINER_BROADCASTS_DAILY_CAP - broadcasts_used),
        "broadcast_daily_cap": ENTERTAINER_BROADCASTS_DAILY_CAP,
        "broadcast_templates": [
            {"id": k, **v}
            for k, v in ENTERTAINER_BROADCAST_TEMPLATES.items()
        ],
    }
