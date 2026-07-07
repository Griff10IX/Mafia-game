"""Entertainer staff fund, daily refill, funded-game ledger, and completion bonus (MDG / MP Poker)."""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone
from typing import Any, Dict, Optional, Tuple

from pymongo import ReturnDocument

_logger = logging.getLogger(__name__)

ENTERTAINER_DAILY_FUND_CASH = 500_000_000
ENTERTAINER_DAILY_FUND_POINTS = 10_000
ENTERTAINER_FUND_CASH_MAX = 1_000_000_000
ENTERTAINER_FUND_POINTS_MAX = 20_000
ENTERTAINER_COMPLETION_BONUS_POINTS = 100
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
    """Accrue daily allowance once per UTC day into pending; entertainers collect into the spendable fund in Hub.

    The full daily amount always accrues to pending (stacks across days). Fund caps are only
    enforced when collecting pending into the spendable fund — capping accrual by spendable-fund
    room here silently zeroed pay for anyone at the fund cap (points cap is hit after 2 collects).
    """
    today = entertainer_utc_today()
    cursor = db.users.find(
        {"is_entertainer": True, "is_dead": {"$ne": True}},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
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
        add_cash = int(ENTERTAINER_DAILY_FUND_CASH)
        add_points = int(ENTERTAINER_DAILY_FUND_POINTS)
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


async def _collect_pending_completion_bonus_to_wallet(db, entertainer_id: str) -> Dict[str, Any]:
    """Move pending completion bonus into main wallet points."""
    before = await db.users.find_one(
        {"id": entertainer_id, "is_entertainer": True, "is_dead": {"$ne": True}},
        {"_id": 0, "points": 1, "entertainer_pending_completion_bonus_points": 1},
    )
    if not before:
        return {"moved": 0, "remaining": 0}
    pending0 = int(before.get("entertainer_pending_completion_bonus_points") or 0)
    if pending0 <= 0:
        return {"moved": 0, "remaining": 0}
    pts_before = int(before.get("points") or 0)
    after = await db.users.find_one_and_update(
        {"id": entertainer_id, "entertainer_pending_completion_bonus_points": {"$gt": 0}},
        [
            {
                "$set": {
                    "_m": {"$toInt": {"$ifNull": ["$entertainer_pending_completion_bonus_points", 0]}},
                    "_p": {"$toInt": {"$ifNull": ["$points", 0]}},
                }
            },
            {
                "$set": {
                    "points": {"$add": ["$_p", "$_m"]},
                    "entertainer_pending_completion_bonus_points": 0,
                }
            },
            {"$unset": ["_m", "_p"]},
        ],
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0, "points": 1, "entertainer_pending_completion_bonus_points": 1},
    )
    if not after:
        return {"moved": 0, "remaining": pending0}
    moved = max(0, int(after.get("points") or 0) - pts_before)
    remaining = int(after.get("entertainer_pending_completion_bonus_points") or 0)
    if moved > 0:
        try:
            from utils.point_provenance import log_points_event

            await log_points_event(
                db,
                user_id=entertainer_id,
                points=moved,
                event_type="entertainer_completion_bonus",
                event_ref="collect_pending",
                meta={"source": "collect_pending"},
                wallet_points_before=pts_before,
                wallet_points_after=pts_before + moved,
            )
        except Exception as ex:
            _logger.warning("entertainer completion bonus collect log_points_event: %s", ex)
    return {"moved": moved, "remaining": remaining}


async def collect_entertainer_pending_to_fund(db, entertainer_id: str) -> Dict[str, Any]:
    """Move pending daily allowance into entertainer_fund_* (up to caps) and completion bonus into wallet."""
    before = await db.users.find_one(
        {"id": entertainer_id, "is_entertainer": True, "is_dead": {"$ne": True}},
        {
            "_id": 0,
            "entertainer_fund_cash": 1,
            "entertainer_fund_points": 1,
            "entertainer_pending_fund_cash": 1,
            "entertainer_pending_fund_points": 1,
            "entertainer_pending_completion_bonus_points": 1,
        },
    )
    if not before:
        return {"ok": False, "detail": "Entertainer not found"}
    pc0 = float(before.get("entertainer_pending_fund_cash") or 0.0)
    pp0 = int(before.get("entertainer_pending_fund_points") or 0)
    bonus_pending0 = int(before.get("entertainer_pending_completion_bonus_points") or 0)
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
    bonus_out = await _collect_pending_completion_bonus_to_wallet(db, entertainer_id)
    moved_wallet_pts = int(bonus_out.get("moved") or 0)
    bonus_pending1 = int(bonus_out.get("remaining") or 0)
    return {
        "ok": True,
        "moved_cash": moved_cash,
        "moved_points": moved_pts,
        "moved_wallet_points": moved_wallet_pts,
        "entertainer_fund_cash": fc1,
        "entertainer_fund_points": fp1,
        "entertainer_pending_fund_cash": pc1,
        "entertainer_pending_fund_points": pp1,
        "entertainer_pending_completion_bonus_points": bonus_pending1,
        "had_pending_before": pc0 > 0 or pp0 > 0 or bonus_pending0 > 0,
        "nothing_moved": moved_cash <= 0 and moved_pts <= 0 and moved_wallet_pts <= 0,
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


def _forum_funded_game_source(game_type: str) -> str:
    gt = (game_type or "dice").strip().lower()
    if gt in ("dice", "gbox", "hangman"):
        return f"forum_{gt}"
    return "forum_game"


def _completion_bonus_unpaid_clause() -> Dict[str, Any]:
    return {
        "$or": [
            {"completion_bonus_points": {"$exists": False}},
            {"completion_bonus_points": None},
        ]
    }


async def _credit_entertainer_completion_bonus(
    db,
    entertainer_id: str,
    points: int,
    *,
    bump_today_counters: bool,
) -> None:
    if points <= 0:
        return
    inc_user: Dict[str, Any] = {
        "entertainer_pending_completion_bonus_points": points,
        "entertainer_lifetime_bonus_points_paid": points,
    }
    if bump_today_counters:
        today = entertainer_utc_today()
        inc_user["entertainer_funded_completions_today"] = 1
        inc_user["entertainer_completion_bonus_points_today"] = points
        await db.users.update_one(
            {"id": entertainer_id},
            {"$inc": inc_user, "$set": {"entertainer_activity_utc_date": today}},
        )
    else:
        await db.users.update_one({"id": entertainer_id}, {"$inc": inc_user})


async def _mark_ledger_completion_bonus_paid(db, row_id: str, points: int) -> bool:
    now_iso = datetime.now(timezone.utc).isoformat()
    r = await db.entertainer_funded_games.update_one(
        {"id": row_id, **_completion_bonus_unpaid_clause()},
        {"$set": {"completion_bonus_points": points, "completion_bonus_at": now_iso}},
    )
    return r.modified_count == 1


async def _ledger_row_prior_bonus_points(db, row: Dict[str, Any]) -> int:
    """Points already logged for this funded game (prevents double-pay on backfill)."""
    eid = row.get("entertainer_id")
    source = row.get("source")
    ref_id = row.get("ref_id")
    if not eid or not source or not ref_id:
        return 0
    origin_ref = f"{source}:{ref_id}"
    ev = await db.point_ledger_events.find_one(
        {
            "user_id": eid,
            "event_type": "entertainer_completion_bonus",
            "origin_ref": origin_ref,
        },
        {"_id": 0, "points": 1},
    )
    if ev:
        return max(0, int(ev.get("points") or 0))
    ev2 = await db.point_ledger_events.find_one(
        {
            "user_id": eid,
            "event_type": "entertainer_completion_bonus",
            "meta.source": source,
            "meta.ref_id": str(ref_id),
        },
        {"_id": 0, "points": 1},
    )
    return max(0, int((ev2 or {}).get("points") or 0))


async def _pay_completion_bonus_for_ledger_row(
    db,
    row: Dict[str, Any],
    *,
    bump_today_counters: bool,
    dry_run: bool = False,
) -> int:
    """Idempotent payout for one completed ledger row. Returns points that would be / were accrued."""
    if not row.get("completed_at") or not row.get("entertainer_id"):
        return 0
    if row.get("completion_bonus_points") is not None:
        return 0

    target = ENTERTAINER_COMPLETION_BONUS_POINTS
    already = await _ledger_row_prior_bonus_points(db, row)
    points = max(0, target - already)
    if points <= 0:
        if not dry_run:
            await db.entertainer_funded_games.update_one(
                {"id": row["id"], **_completion_bonus_unpaid_clause()},
                {
                    "$set": {
                        "completion_bonus_points": max(already, target),
                        "completion_bonus_at": datetime.now(timezone.utc).isoformat(),
                    }
                },
            )
        return 0

    if dry_run:
        return points
    if not await _mark_ledger_completion_bonus_paid(db, row["id"], target):
        return 0
    await _credit_entertainer_completion_bonus(
        db,
        row["entertainer_id"],
        points,
        bump_today_counters=bump_today_counters,
    )
    return points


async def _sync_missing_ledger_rows_for_entertainer(db, entertainer_id: str, *, dry_run: bool) -> int:
    """Create or complete ledger rows for funded games that finished before tracking was wired."""
    created = 0

    async def _upsert_row(*, source: str, ref_id: str, funded_at: str, completed_at: str, utc_day: str) -> None:
        nonlocal created
        existing = await db.entertainer_funded_games.find_one(
            {"ref_id": ref_id, "source": source},
            {"_id": 0, "id": 1, "completed_at": 1},
        )
        if existing:
            if not existing.get("completed_at") and completed_at and not dry_run:
                await db.entertainer_funded_games.update_one(
                    {"id": existing["id"], "completed_at": None},
                    {"$set": {"completed_at": completed_at}},
                )
            return
        created += 1
        if dry_run:
            return
        await db.entertainer_funded_games.insert_one(
            {
                "id": str(uuid.uuid4()),
                "entertainer_id": entertainer_id,
                "source": source,
                "ref_id": ref_id,
                "utc_day": utc_day,
                "funded_at": funded_at,
                "completed_at": completed_at,
            }
        )

    async for game in db.entertainer_games.find(
        {"creator_id": entertainer_id, "entertainer_funded": True, "status": "completed"},
        {"_id": 0, "id": 1, "game_type": 1, "created_at": 1, "completed_at": 1},
    ):
        gid = str(game.get("id") or "").strip()
        if not gid:
            continue
        completed_at = (game.get("completed_at") or "").strip() or datetime.now(timezone.utc).isoformat()
        await _upsert_row(
            source=_forum_funded_game_source(game.get("game_type")),
            ref_id=gid,
            funded_at=(game.get("created_at") or completed_at),
            completed_at=completed_at,
            utc_day=completed_at[:10] if len(completed_at) >= 10 else entertainer_utc_today(),
        )

    async for game in db.mdg_games.find(
        {"created_by": entertainer_id, "entertainer_funded": True, "status": "completed"},
        {"_id": 0, "id": 1, "created_at": 1, "rolled_at": 1},
    ):
        gid = str(game.get("id") or "").strip()
        if not gid:
            continue
        completed_at = (game.get("rolled_at") or game.get("created_at") or "").strip() or datetime.now(timezone.utc).isoformat()
        await _upsert_row(
            source="mdg",
            ref_id=gid,
            funded_at=(game.get("created_at") or completed_at),
            completed_at=completed_at,
            utc_day=completed_at[:10] if len(completed_at) >= 10 else entertainer_utc_today(),
        )

    async for game in db.mp_poker_games.find(
        {
            "creator_id": entertainer_id,
            "entertainer_funded": True,
            "$or": [{"status": "completed"}, {"tournament_status": "completed"}],
        },
        {"_id": 0, "id": 1, "created_at": 1, "completed_at": 1},
    ):
        gid = str(game.get("id") or "").strip()
        if not gid:
            continue
        completed_at = (game.get("completed_at") or game.get("created_at") or "").strip() or datetime.now(timezone.utc).isoformat()
        await _upsert_row(
            source="mp_poker",
            ref_id=gid,
            funded_at=(game.get("created_at") or completed_at),
            completed_at=completed_at,
            utc_day=completed_at[:10] if len(completed_at) >= 10 else entertainer_utc_today(),
        )

    return created


async def backfill_entertainer_completion_bonuses(
    db,
    *,
    entertainer_id: Optional[str] = None,
    send_notification=None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Pay missed completion bonuses for finished sponsored games (idempotent per ledger row)."""
    rows_created = 0
    if entertainer_id:
        rows_created = await _sync_missing_ledger_rows_for_entertainer(
            db, entertainer_id, dry_run=dry_run
        )
    else:
        async for u in db.users.find({"is_entertainer": True, "is_dead": {"$ne": True}}, {"_id": 0, "id": 1}):
            uid = u.get("id")
            if uid:
                rows_created += await _sync_missing_ledger_rows_for_entertainer(db, uid, dry_run=dry_run)

    filt: Dict[str, Any] = {
        "completed_at": {"$ne": None},
        **_completion_bonus_unpaid_clause(),
    }
    if entertainer_id:
        filt["entertainer_id"] = entertainer_id

    rows_paid = 0
    points_by_entertainer: Dict[str, int] = {}
    async for row in db.entertainer_funded_games.find(filt, {"_id": 0}):
        pts = await _pay_completion_bonus_for_ledger_row(
            db,
            row,
            bump_today_counters=False,
            dry_run=dry_run,
        )
        if pts <= 0:
            continue
        rows_paid += 1
        eid = row.get("entertainer_id")
        if eid:
            points_by_entertainer[eid] = points_by_entertainer.get(eid, 0) + pts

    if not dry_run and send_notification:
        for eid, total_pts in points_by_entertainer.items():
            if total_pts <= 0:
                continue
            try:
                await send_notification(
                    eid,
                    "Entertainer completion bonus (backfill)",
                    (
                        f"+{total_pts:,} completion bonus added to pending for past sponsored games — "
                        "collect in Entertainer Hub."
                    ),
                    "reward",
                    category="entertainer",
                )
            except Exception as ex:
                _logger.warning("entertainer completion backfill notify uid=%s: %s", eid, ex)

    points_total = sum(points_by_entertainer.values())
    return {
        "ok": True,
        "dry_run": dry_run,
        "entertainer_id": entertainer_id,
        "rows_created": rows_created,
        "rows_paid": rows_paid,
        "points_total": points_total,
        "entertainers_credited": len(points_by_entertainer),
        "by_entertainer": points_by_entertainer,
    }


async def on_funded_game_completed(
    db,
    *,
    ref_id: str,
    source: str,
    send_notification,
    log_points_event,
    outcome: Optional[Dict[str, Any]] = None,
) -> None:
    """Mark ledger row completed (first wins) and accrue +100 pending pts per completion.

    Pending completion bonus is collected in the Entertainer Hub (main wallet). Optional ``outcome`` is
    merged into the ledger row (winner, total payout, amount seeded from fund).
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
    completions, _bonus_today = await _ensure_activity_day(db, eid, today)
    points_to_accrue = ENTERTAINER_COMPLETION_BONUS_POINTS

    if not await _mark_ledger_completion_bonus_paid(db, doc["id"], points_to_accrue):
        return

    await _credit_entertainer_completion_bonus(
        db,
        eid,
        points_to_accrue,
        bump_today_counters=True,
    )

    try:
        await send_notification(
            eid,
            "Entertainer completion bonus",
            (
                f"+{points_to_accrue} completion bonus pending — collect in Entertainer Hub "
                f"(sponsored game #{completions + 1} today UTC)."
            ),
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
            "entertainer_pending_completion_bonus_points": 1,
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
    activity_day = u.get("entertainer_activity_utc_date")
    if activity_day != today:
        funded_completions_today = 0
        completion_bonus_today = 0
    else:
        funded_completions_today = int(u.get("entertainer_funded_completions_today") or 0)
        completion_bonus_today = int(u.get("entertainer_completion_bonus_points_today") or 0)
    return {
        "username": u.get("username"),
        "entertainer_fund_cash": float(u.get("entertainer_fund_cash") or 0),
        "entertainer_fund_points": int(u.get("entertainer_fund_points") or 0),
        "entertainer_pending_fund_cash": float(u.get("entertainer_pending_fund_cash") or 0),
        "entertainer_pending_fund_points": int(u.get("entertainer_pending_fund_points") or 0),
        "entertainer_pending_completion_bonus_points": int(
            u.get("entertainer_pending_completion_bonus_points") or 0
        ),
        "completion_bonus_per_game": ENTERTAINER_COMPLETION_BONUS_POINTS,
        "funded_games_today_count": funded_today,
        "funded_ledger_open_count": int(funded_ledger_open),
        "funded_ledger_completed_count": int(funded_ledger_completed),
        "funded_ledger_paid_out_points_total": int(paid_row.get("paid_pts") or 0),
        "funded_ledger_paid_out_cash_total": float(paid_row.get("paid_cash") or 0.0),
        "lifetime_bonus_points_paid": int(u.get("entertainer_lifetime_bonus_points_paid") or 0),
        "lifetime_fund_cash_granted": int(u.get("entertainer_lifetime_fund_cash_granted") or 0),
        "lifetime_fund_points_granted": int(u.get("entertainer_lifetime_fund_points_granted") or 0),
        "last_refill_utc_date": u.get("entertainer_fund_last_refill_utc_date"),
        "funded_completions_today": funded_completions_today,
        "completion_bonus_points_today": completion_bonus_today,
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


def _empty_ledger_admin_stats() -> Dict[str, Any]:
    return {
        "ledger_open_count": 0,
        "ledger_completed_count": 0,
        "ledger_total_count": 0,
        "completion_bonus_paid_games": 0,
        "completion_bonus_unpaid_games": 0,
        "completion_bonus_accrued_points": 0,
        "ledger_paid_out_points": 0,
        "ledger_paid_out_cash": 0.0,
        "ledger_seed_points": 0,
        "ledger_seed_cash": 0.0,
    }


def _ledger_admin_stats_from_group(row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not row:
        return _empty_ledger_admin_stats()
    return {
        "ledger_open_count": int(row.get("open_count") or 0),
        "ledger_completed_count": int(row.get("completed_count") or 0),
        "ledger_total_count": int(row.get("total_count") or 0),
        "completion_bonus_paid_games": int(row.get("bonus_paid_games") or 0),
        "completion_bonus_unpaid_games": int(row.get("bonus_unpaid_games") or 0),
        "completion_bonus_accrued_points": int(row.get("bonus_accrued_points") or 0),
        "ledger_paid_out_points": int(row.get("paid_out_points") or 0),
        "ledger_paid_out_cash": float(row.get("paid_out_cash") or 0.0),
        "ledger_seed_points": int(row.get("seed_points") or 0),
        "ledger_seed_cash": float(row.get("seed_cash") or 0.0),
    }


def _entertainer_admin_row_from_user(
    u: Dict[str, Any],
    ledger_stats: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    lg = _ledger_admin_stats_from_group(ledger_stats)
    fund_cash = float(u.get("entertainer_fund_cash") or 0)
    fund_pts = int(u.get("entertainer_fund_points") or 0)
    pending_cash = float(u.get("entertainer_pending_fund_cash") or 0)
    pending_fund_pts = int(u.get("entertainer_pending_fund_points") or 0)
    pending_bonus = int(u.get("entertainer_pending_completion_bonus_points") or 0)
    lifetime_bonus = int(u.get("entertainer_lifetime_bonus_points_paid") or 0)
    lifetime_cash_granted = int(u.get("entertainer_lifetime_fund_cash_granted") or 0)
    lifetime_pts_granted = int(u.get("entertainer_lifetime_fund_points_granted") or 0)
    unpaid_games = int(lg["completion_bonus_unpaid_games"])
    unpaid_pts = unpaid_games * ENTERTAINER_COMPLETION_BONUS_POINTS
    bonus_collected_est = max(0, lifetime_bonus - pending_bonus)
    fund_cash_spent_est = max(0.0, lifetime_cash_granted - pending_cash - fund_cash)
    fund_pts_spent_est = max(0, lifetime_pts_granted - pending_fund_pts - fund_pts)
    return {
        "id": u.get("id"),
        "username": u.get("username"),
        "email": u.get("email"),
        "is_dead": bool(u.get("is_dead")),
        "wallet_points": int(u.get("points") or 0),
        "entertainer_fund_cash": fund_cash,
        "entertainer_fund_points": fund_pts,
        "entertainer_pending_fund_cash": pending_cash,
        "entertainer_pending_fund_points": pending_fund_pts,
        "entertainer_pending_completion_bonus_points": pending_bonus,
        "lifetime_bonus_points_accrued": lifetime_bonus,
        "lifetime_bonus_points_collected_estimate": bonus_collected_est,
        "lifetime_fund_cash_granted": lifetime_cash_granted,
        "lifetime_fund_points_granted": lifetime_pts_granted,
        "fund_cash_spent_estimate": round(fund_cash_spent_est, 2),
        "fund_points_spent_estimate": fund_pts_spent_est,
        "last_refill_utc_date": u.get("entertainer_fund_last_refill_utc_date"),
        "completion_bonus_per_game": ENTERTAINER_COMPLETION_BONUS_POINTS,
        "completion_bonus_unpaid_games": unpaid_games,
        "completion_bonus_unpaid_points": unpaid_pts,
        "pending_total_points": pending_fund_pts + pending_bonus,
        **lg,
    }


async def _aggregate_ledger_admin_stats(db, entertainer_ids: list) -> Dict[str, Dict[str, Any]]:
    if not entertainer_ids:
        return {}
    pipeline = [
        {"$match": {"entertainer_id": {"$in": entertainer_ids}}},
        {
            "$group": {
                "_id": "$entertainer_id",
                "total_count": {"$sum": 1},
                "open_count": {
                    "$sum": {
                        "$cond": [
                            {"$in": [{"$ifNull": ["$completed_at", None]}, [None, ""]]},
                            1,
                            0,
                        ]
                    }
                },
                "completed_count": {
                    "$sum": {
                        "$cond": [
                            {"$and": [
                                {"$ne": [{"$ifNull": ["$completed_at", None]}, None]},
                                {"$ne": ["$completed_at", ""]},
                            ]},
                            1,
                            0,
                        ]
                    }
                },
                "bonus_paid_games": {
                    "$sum": {
                        "$cond": [
                            {"$gt": [{"$ifNull": ["$completion_bonus_points", -1]}, 0]},
                            1,
                            0,
                        ]
                    }
                },
                "bonus_unpaid_games": {
                    "$sum": {
                        "$cond": [
                            {
                                "$and": [
                                    {"$ne": [{"$ifNull": ["$completed_at", None]}, None]},
                                    {"$ne": ["$completed_at", ""]},
                                    {
                                        "$in": [
                                            {"$ifNull": ["$completion_bonus_points", "__unset__"]},
                                            ["__unset__", None],
                                        ]
                                    },
                                ]
                            },
                            1,
                            0,
                        ]
                    }
                },
                "bonus_accrued_points": {"$sum": {"$ifNull": ["$completion_bonus_points", 0]}},
                "paid_out_points": {"$sum": {"$ifNull": ["$total_winnings_points", 0]}},
                "paid_out_cash": {"$sum": {"$ifNull": ["$total_winnings_cash", 0.0]}},
                "seed_points": {"$sum": {"$ifNull": ["$from_entertainer_fund_points", 0]}},
                "seed_cash": {"$sum": {"$ifNull": ["$from_entertainer_fund_cash", 0.0]}},
            }
        },
    ]
    rows = await db.entertainer_funded_games.aggregate(pipeline).to_list(len(entertainer_ids) + 1)
    return {str(r["_id"]): r for r in rows if r.get("_id")}


async def build_entertainer_admin_summary(db, entertainer_id: str) -> Dict[str, Any]:
    """Full admin snapshot for one entertainer (dashboard + balances + owed)."""
    dash = await build_entertainer_dashboard(db, entertainer_id)
    if not dash:
        return {}
    u = await db.users.find_one(
        {"id": entertainer_id},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "is_dead": 1,
            "points": 1,
            "entertainer_fund_cash": 1,
            "entertainer_fund_points": 1,
            "entertainer_pending_fund_cash": 1,
            "entertainer_pending_fund_points": 1,
            "entertainer_pending_completion_bonus_points": 1,
            "entertainer_lifetime_bonus_points_paid": 1,
            "entertainer_lifetime_fund_cash_granted": 1,
            "entertainer_lifetime_fund_points_granted": 1,
            "entertainer_fund_last_refill_utc_date": 1,
        },
    )
    if not u:
        return dash
    ledger_map = await _aggregate_ledger_admin_stats(db, [entertainer_id])
    summary = _entertainer_admin_row_from_user(u, ledger_map.get(entertainer_id))
    return {**dash, **summary}


async def build_entertainers_admin_overview(db) -> Dict[str, Any]:
    """All entertainers: earned, owed, saved (pending), spendable fund, ledger stats."""
    users = await db.users.find(
        {"is_entertainer": True},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "is_dead": 1,
            "points": 1,
            "entertainer_fund_cash": 1,
            "entertainer_fund_points": 1,
            "entertainer_pending_fund_cash": 1,
            "entertainer_pending_fund_points": 1,
            "entertainer_pending_completion_bonus_points": 1,
            "entertainer_lifetime_bonus_points_paid": 1,
            "entertainer_lifetime_fund_cash_granted": 1,
            "entertainer_lifetime_fund_points_granted": 1,
            "entertainer_fund_last_refill_utc_date": 1,
        },
    ).sort("username", 1).to_list(500)
    ids = [u["id"] for u in users if u.get("id")]
    ledger_map = await _aggregate_ledger_admin_stats(db, ids)
    rows = []
    totals = {
        "entertainer_count": 0,
        "alive_count": 0,
        "wallet_points": 0,
        "entertainer_fund_cash": 0.0,
        "entertainer_fund_points": 0,
        "entertainer_pending_fund_cash": 0.0,
        "entertainer_pending_fund_points": 0,
        "entertainer_pending_completion_bonus_points": 0,
        "pending_total_points": 0,
        "lifetime_bonus_points_accrued": 0,
        "lifetime_bonus_points_collected_estimate": 0,
        "lifetime_fund_cash_granted": 0,
        "lifetime_fund_points_granted": 0,
        "fund_cash_spent_estimate": 0.0,
        "fund_points_spent_estimate": 0,
        "ledger_open_count": 0,
        "ledger_completed_count": 0,
        "completion_bonus_unpaid_games": 0,
        "completion_bonus_unpaid_points": 0,
        "completion_bonus_accrued_points": 0,
        "ledger_paid_out_points": 0,
        "ledger_paid_out_cash": 0.0,
        "ledger_seed_points": 0,
        "ledger_seed_cash": 0.0,
    }
    for u in users:
        uid = u.get("id")
        if not uid:
            continue
        row = _entertainer_admin_row_from_user(u, ledger_map.get(uid))
        rows.append(row)
        totals["entertainer_count"] += 1
        if not row.get("is_dead"):
            totals["alive_count"] += 1
        for key in (
            "wallet_points",
            "entertainer_fund_points",
            "entertainer_pending_fund_points",
            "entertainer_pending_completion_bonus_points",
            "pending_total_points",
            "lifetime_bonus_points_accrued",
            "lifetime_bonus_points_collected_estimate",
            "lifetime_fund_cash_granted",
            "lifetime_fund_points_granted",
            "fund_points_spent_estimate",
            "ledger_open_count",
            "ledger_completed_count",
            "completion_bonus_unpaid_games",
            "completion_bonus_unpaid_points",
            "completion_bonus_accrued_points",
            "ledger_paid_out_points",
            "ledger_seed_points",
        ):
            totals[key] += int(row.get(key) or 0)
        for key in (
            "entertainer_fund_cash",
            "entertainer_pending_fund_cash",
            "fund_cash_spent_estimate",
            "ledger_paid_out_cash",
            "ledger_seed_cash",
        ):
            totals[key] += float(row.get(key) or 0.0)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "daily_allowance": {
            "cash": ENTERTAINER_DAILY_FUND_CASH,
            "points": ENTERTAINER_DAILY_FUND_POINTS,
            "fund_cash_cap": ENTERTAINER_FUND_CASH_MAX,
            "fund_points_cap": ENTERTAINER_FUND_POINTS_MAX,
        },
        "completion_bonus_per_game": ENTERTAINER_COMPLETION_BONUS_POINTS,
        "totals": totals,
        "entertainers": rows,
    }
