# House-owned Chicken Cross. Admin-only while CHICKEN_CROSS_ADMIN_ONLY is true.
# The losing lane is rolled when the stake is taken and is never sent to the client.
from __future__ import annotations

import logging
import secrets
import time
import uuid
from datetime import datetime, timezone
from fractions import Fraction
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, field_validator
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from server import (
    STATES,
    db,
    get_current_user_verified,
    log_gambling,
    require_admin_verified,
)
from utils.gambling_self_ban import raise_if_gambling_self_banned

_rng = secrets.SystemRandom()
logger = logging.getLogger(__name__)

CHICKEN_CROSS_ADMIN_ONLY = False
CHICKEN_CROSS_MAX_BET = 2_000_000_000
CHICKEN_CROSS_PAYOUT_CAP = 250_000_000_000
CHICKEN_CROSS_POINTS_MAX_BET = 500
CHICKEN_CROSS_POINTS_PAYOUT_CAP = 50_000
CHICKEN_CROSS_STREAK_SCAN_LIMIT = 120
CURRENCIES: Dict[str, Dict[str, Any]] = {
    "cash": {"field": "money", "max_bet": CHICKEN_CROSS_MAX_BET, "payout_cap": CHICKEN_CROSS_PAYOUT_CAP},
    "points": {"field": "points", "max_bet": CHICKEN_CROSS_POINTS_MAX_BET, "payout_cap": CHICKEN_CROSS_POINTS_PAYOUT_CAP},
}
DIFFICULTY_SPECS: Dict[str, Dict[str, Any]] = {
    "easy": {"label": "Easy", "survive_num": 90, "survive_den": 100, "lanes": 50},
    "medium": {"label": "Medium", "survive_num": 83, "survive_den": 100, "lanes": 25},
    "hard": {"label": "Hard", "survive_num": 71, "survive_den": 100, "lanes": 20},
    # pay_num prices the multipliers; survive_num is the real per-hop roll.
    "expert": {"label": "Expert", "survive_num": 52, "survive_den": 100, "pay_num": 52, "lanes": 15},
}

# Odds follow total player cash: "boost" below the low mark, back to "normal" at the high mark.
# Between the marks the current profile is kept so it does not flip back and forth.
# Multipliers are floored so a cash-out is never worth more than the profile's RTP.
ODDS_PROFILES: Dict[str, Dict[str, Any]] = {
    "normal": {"rtp": Fraction(98, 100), "survive_bonus": {}},
    "boost": {"rtp": Fraction(99, 100), "survive_bonus": {}},
}
DEFAULT_PROFILE = "normal"
ECONOMY_BOOST_BELOW = 700_000_000_000
ECONOMY_NORMAL_AT = 2_000_000_000_000
ECONOMY_CHECK_SECONDS = 60
ODDS_CONFIG_ID = "chicken_cross_dynamic_odds"


def _survive_num(difficulty: str, profile: str) -> int:
    spec = DIFFICULTY_SPECS[difficulty]
    bonus = int((ODDS_PROFILES[profile]["survive_bonus"] or {}).get(difficulty, 0))
    return int(spec["survive_num"]) + bonus


def _build_multiplier_tables(profile: str) -> Dict[str, tuple]:
    """Each road has a fixed lane count; big stakes end earlier when a lane reaches the payout cap."""
    rtp = ODDS_PROFILES[profile]["rtp"]
    tables: Dict[str, tuple] = {}
    for key, spec in DIFFICULTY_SPECS.items():
        reached = Fraction(1)
        pay_num = int(spec.get("pay_num", spec["survive_num"]))
        if pay_num < _survive_num(key, profile):
            raise RuntimeError(f"Chicken Cross pay odds would beat the real odds for {key} ({profile})")
        survival = Fraction(pay_num, int(spec["survive_den"]))
        cents_rows: List[int] = []
        while True:
            reached *= survival
            cents = int((rtp / reached) * 100)
            if Fraction(cents, 100) * reached > rtp:
                raise RuntimeError(f"Chicken Cross multiplier exceeds RTP for {key} ({profile})")
            cents_rows.append(cents)
            if len(cents_rows) >= int(spec["lanes"]) or cents // 100 > CHICKEN_CROSS_PAYOUT_CAP:
                break
        tables[key] = tuple(cents_rows)
    return tables


MULTIPLIER_CENTS_BY_PROFILE = {p: _build_multiplier_tables(p) for p in ODDS_PROFILES}
_auth = require_admin_verified if CHICKEN_CROSS_ADMIN_ONLY else get_current_user_verified
_odds_cache: Dict[str, Any] = {"profile": None, "checked_at": 0.0}


def _doc_profile(doc: dict) -> str:
    profile = str((doc or {}).get("odds_profile") or DEFAULT_PROFILE)
    return profile if profile in ODDS_PROFILES else DEFAULT_PROFILE


async def _total_player_cash() -> int:
    rows = await db.users.aggregate([
        {"$match": {"is_dead": {"$ne": True}, "is_npc": {"$ne": True}, "is_bodyguard": {"$ne": True}}},
        {"$group": {"_id": None, "money": {"$sum": {"$toDouble": {"$ifNull": ["$money", 0]}}}}},
    ]).to_list(1)
    return int((rows[0] if rows else {}).get("money") or 0)


async def _current_odds_profile() -> str:
    now = time.monotonic()
    cached = _odds_cache.get("profile")
    if cached and now - float(_odds_cache.get("checked_at") or 0) < ECONOMY_CHECK_SECONDS:
        return cached
    cfg = await db.game_config.find_one({"id": ODDS_CONFIG_ID}, {"_id": 0}) or {}
    profile = str(cfg.get("profile") or DEFAULT_PROFILE)
    if profile not in ODDS_PROFILES:
        profile = DEFAULT_PROFILE
    try:
        cash = await _total_player_cash()
        new_profile = profile
        if cash < ECONOMY_BOOST_BELOW:
            new_profile = "boost"
        elif cash >= ECONOMY_NORMAL_AT:
            new_profile = "normal"
        if new_profile != profile or cfg.get("profile") is None:
            await db.game_config.update_one(
                {"id": ODDS_CONFIG_ID},
                {"$set": {"id": ODDS_CONFIG_ID, "profile": new_profile, "total_cash": cash,
                          "changed_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True,
            )
        profile = new_profile
    except Exception:
        logger.exception("Chicken Cross economy check failed")
    _odds_cache["profile"] = profile
    _odds_cache["checked_at"] = now
    return profile


def _multiplier_cents(difficulty: str, lane: int, profile: str = DEFAULT_PROFILE) -> int:
    rows = MULTIPLIER_CENTS_BY_PROFILE[profile][difficulty]
    if lane < 1 or lane > len(rows):
        return 0
    return int(rows[lane - 1])


def _doc_currency(doc: dict) -> str:
    currency = str((doc or {}).get("currency") or "cash")
    return currency if currency in CURRENCIES else "cash"


def _doc_cap(doc: dict) -> int:
    return int(CURRENCIES[_doc_currency(doc)]["payout_cap"])


def _payout(bet: int, cents: int, cap: int = CHICKEN_CROSS_PAYOUT_CAP) -> int:
    if bet < 1 or cents < 1:
        return 0
    return min(int(cap), (int(bet) * int(cents)) // 100)


def _mult_string(cents: int) -> str:
    cents = max(0, int(cents))
    return f"{cents // 100}.{cents % 100:02d}"


def _offered_lanes(
    difficulty: str, bet: int, profile: str = DEFAULT_PROFILE, cap: int = CHICKEN_CROSS_PAYOUT_CAP
) -> List[Dict[str, Any]]:
    rows = []
    for lane, cents in enumerate(MULTIPLIER_CENTS_BY_PROFILE[profile][difficulty], start=1):
        payout = _payout(bet, cents, cap)
        rows.append({
            "lane": lane,
            "multiplier_cents": int(cents),
            "multiplier": _mult_string(cents),
            "payout": payout,
        })
        # The lane that reaches the cap pays exactly the cap and ends the road.
        if payout >= cap:
            break
    return rows


def _roll_death_lane(difficulty: str, profile: str = DEFAULT_PROFILE) -> int:
    spec = DIFFICULTY_SPECS[difficulty]
    num = _survive_num(difficulty, profile)
    den = int(spec["survive_den"])
    lanes = len(MULTIPLIER_CENTS_BY_PROFILE[profile][difficulty])
    for lane in range(1, lanes + 1):
        if _rng.randrange(den) >= num:
            return lane
    return lanes + 1


def _current_state(user: dict) -> str:
    raw = (user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
    if not raw:
        return STATES[0] if STATES else ""
    for st in STATES or []:
        if st and raw.lower() == st.lower():
            return st
    return STATES[0] if STATES else raw


def _public_game(doc: dict) -> Dict[str, Any]:
    difficulty = str(doc.get("difficulty") or "easy")
    bet = int(doc.get("bet") or 0)
    lane = int(doc.get("lane") or 0)
    profile = _doc_profile(doc)
    cap = _doc_cap(doc)
    offered = _offered_lanes(difficulty, bet, profile, cap)
    cents = _multiplier_cents(difficulty, lane, profile) if lane else 0
    cashout = _payout(bet, cents, cap) if lane else 0
    last_lane = offered[-1]["lane"] if offered else 0
    return {
        "id": doc.get("id"),
        "currency": _doc_currency(doc),
        "payout_cap": cap,
        "difficulty": difficulty,
        "bet": bet,
        "lane": lane,
        "multiplier_cents": cents,
        "multiplier": _mult_string(cents) if lane else "0.00",
        "cashout": cashout,
        "can_void": lane == 0,
        "can_cashout": lane >= 1 and cashout > 0,
        "can_step": lane < last_lane,
        "offered_lanes": offered,
    }


def _config_payload(user: dict, profile: str) -> Dict[str, Any]:
    difficulties = []
    for key, spec in DIFFICULTY_SPECS.items():
        lanes = []
        for lane, cents in enumerate(MULTIPLIER_CENTS_BY_PROFILE[profile][key], start=1):
            lanes.append({
                "lane": lane,
                "multiplier_cents": int(cents),
                "multiplier": _mult_string(cents),
            })
        difficulties.append({
            "id": key,
            "label": spec["label"],
            "lanes": lanes,
        })
    return {
        "admin_only": CHICKEN_CROSS_ADMIN_ONLY,
        "current_state": _current_state(user),
        "max_bet": CHICKEN_CROSS_MAX_BET,
        "payout_cap": CHICKEN_CROSS_PAYOUT_CAP,
        "currencies": {
            key: {"max_bet": int(c["max_bet"]), "payout_cap": int(c["payout_cap"])}
            for key, c in CURRENCIES.items()
        },
        "state_owned": True,
        "difficulties": difficulties,
    }


def _streaks(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not rows:
        return {
            "current_type": None,
            "current_count": 0,
            "longest_win_run": 0,
            "longest_loss_run": 0,
            "scanned": 0,
        }
    current_type = "wins" if bool(((rows[0] or {}).get("details") or {}).get("won")) else "losses"
    longest_win_run = 0
    longest_loss_run = 0
    run_type = None
    run_count = 0
    for row in rows:
        won = bool(((row or {}).get("details") or {}).get("won"))
        typ = "wins" if won else "losses"
        if typ == run_type:
            run_count += 1
        else:
            run_type = typ
            run_count = 1
        if typ == "wins":
            longest_win_run = max(longest_win_run, run_count)
        else:
            longest_loss_run = max(longest_loss_run, run_count)
    leading_count = 0
    for row in rows:
        typ = "wins" if bool(((row or {}).get("details") or {}).get("won")) else "losses"
        if typ != current_type:
            break
        leading_count += 1
    return {
        "current_type": current_type,
        "current_count": leading_count,
        "longest_win_run": longest_win_run,
        "longest_loss_run": longest_loss_run,
        "scanned": len(rows),
    }


async def _read_balance(user_id: str, field: str = "money") -> int:
    user = await db.users.find_one({"id": user_id}, {"_id": 0, field: 1})
    if not user:
        return 0
    try:
        return int(user.get(field) or 0)
    except (TypeError, ValueError):
        return 0


async def _credit_once(user_id: str, session_id: str, amount: int, currency: str = "cash") -> None:
    spec = CURRENCIES[currency]
    amount = max(0, min(int(spec["payout_cap"]), int(amount)))
    update: Dict[str, Any] = {"$set": {"chicken_cross_settlement_id": session_id}}
    if amount:
        update["$inc"] = {spec["field"]: amount}
    res = await db.users.update_one(
        {"id": user_id, "chicken_cross_settlement_id": {"$ne": session_id}},
        update,
    )
    if res.matched_count:
        return
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "chicken_cross_settlement_id": 1})
    if user and user.get("chicken_cross_settlement_id") == session_id:
        return
    raise HTTPException(status_code=500, detail="Could not settle the round")


async def _log_once(doc: dict, *, won: bool, payout: int, void: bool, result: str) -> None:
    sid = str(doc.get("id") or "")
    marked = await db.chicken_cross_games.find_one_and_update(
        {"id": sid, "logged": {"$ne": True}},
        {"$set": {"logged": True}},
        return_document=ReturnDocument.BEFORE,
    )
    if not marked:
        return
    bet = int(doc.get("bet") or 0)
    lane = int(doc.get("lane") or 0)
    await log_gambling(
        str(doc.get("user_id") or ""),
        str(doc.get("username") or "?"),
        "chicken_cross",
        {
            "session_id": sid,
            "state": doc.get("state") or "",
            "difficulty": doc.get("difficulty"),
            "bet": bet,
            "lane": lane,
            "multiplier_cents": _multiplier_cents(str(doc.get("difficulty") or ""), lane, _doc_profile(doc)) if lane else 0,
            "result": result,
            "won": bool(won),
            "void": bool(void),
            "payout": int(payout),
            "net": 0 if void else (int(payout) - bet),
            "state_owned": True,
            "currency": _doc_currency(doc),
            "max_bet": int(CURRENCIES[_doc_currency(doc)]["max_bet"]),
            "payout_cap": _doc_cap(doc),
        },
    )


async def _finish(doc: dict, *, won: bool, payout: int, void: bool, result: str, lane: Optional[int] = None) -> Dict[str, Any]:
    sid = str(doc.get("id") or "")
    user_id = str(doc.get("user_id") or "")
    if lane is not None and int(lane) != int(doc.get("lane") or 0):
        await db.chicken_cross_games.update_one({"id": sid}, {"$set": {"lane": int(lane)}})
        doc = {**doc, "lane": int(lane)}
    await _credit_once(user_id, sid, int(payout), _doc_currency(doc))
    await _log_once(doc, won=won, payout=payout, void=void, result=result)
    await db.chicken_cross_games.delete_one({"id": sid})
    bet = int(doc.get("bet") or 0)
    cents = _multiplier_cents(str(doc.get("difficulty") or ""), int(doc.get("lane") or 0), _doc_profile(doc))
    return {
        "active": False,
        "settled": {
            "result": result,
            "won": bool(won) and not void,
            "void": bool(void),
            "bet": bet,
            "lane": int(doc.get("lane") or 0),
            "multiplier": _mult_string(cents) if int(doc.get("lane") or 0) else "0.00",
            "payout": int(payout),
            "net": 0 if void else int(payout) - bet,
            "currency": _doc_currency(doc),
            "new_balance": await _read_balance(user_id),
            "new_points": await _read_balance(user_id, "points"),
        },
    }


async def _take_stake(user_id: str, session_id: str, bet: int, currency: str = "cash") -> bool:
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "chicken_cross_debit_id": 1})
    if user and user.get("chicken_cross_debit_id") == session_id:
        return True
    field = CURRENCIES[currency]["field"]
    res = await db.users.find_one_and_update(
        {"id": user_id, field: {"$gte": bet}, "chicken_cross_debit_id": {"$ne": session_id}},
        {"$inc": {field: -bet}, "$set": {"chicken_cross_debit_id": session_id}},
    )
    return bool(res)


async def _apply_step(doc: dict) -> Dict[str, Any]:
    difficulty = str(doc.get("difficulty") or "")
    bet = int(doc.get("bet") or 0)
    lane = int(doc.get("lane") or 0)
    next_lane = lane + 1
    profile = _doc_profile(doc)
    cap = _doc_cap(doc)
    offered = _offered_lanes(difficulty, bet, profile, cap)
    last_lane = offered[-1]["lane"] if offered else 0
    sid = str(doc.get("id") or "")
    if next_lane > last_lane:
        await db.chicken_cross_games.update_one(
            {"id": sid, "status": "settling", "settle_kind": "step"},
            {"$set": {"status": "active"}, "$unset": {"settle_kind": ""}},
        )
        fresh = await db.chicken_cross_games.find_one({"id": sid}, {"_id": 0, "death_lane": 0})
        if not fresh:
            raise HTTPException(status_code=400, detail="No active round")
        return {"active": True, "result": "blocked", "game": _public_game(fresh), "new_balance": await _read_balance(str(doc.get("user_id") or ""))}
    if next_lane >= int(doc.get("death_lane") or 0):
        doomed = {**doc, "lane": next_lane}
        await db.chicken_cross_games.update_one(
            {"id": sid, "status": "settling"},
            {"$set": {"lane": next_lane, "settle_result": "hit", "settle_payout": 0}},
        )
        return await _finish(doomed, won=False, payout=0, void=False, result="hit", lane=next_lane)
    cents = _multiplier_cents(difficulty, next_lane, profile)
    if next_lane >= last_lane:
        payout = _payout(bet, cents, cap)
        await db.chicken_cross_games.update_one(
            {"id": sid, "status": "settling", "settle_kind": "step"},
            {"$set": {
                "lane": next_lane,
                "multiplier_cents": cents,
                "settle_kind": "cashout",
                "settle_result": "cashout",
                "settle_payout": payout,
            }},
        )
        return await _finish({**doc, "lane": next_lane}, won=True, payout=payout, void=False, result="cashout")
    await db.chicken_cross_games.update_one(
        {"id": sid, "status": "settling", "settle_kind": "step"},
        {
            "$set": {"status": "active", "lane": next_lane, "multiplier_cents": cents},
            "$unset": {"settle_kind": ""},
        },
    )
    fresh = await db.chicken_cross_games.find_one({"id": sid}, {"_id": 0, "death_lane": 0})
    if not fresh:
        raise HTTPException(status_code=400, detail="No active round")
    return {"active": True, "result": "safe", "game": _public_game(fresh), "new_balance": await _read_balance(str(doc.get("user_id") or ""))}


async def _recover(doc: dict) -> Optional[dict]:
    """Finish a half-applied round. Returns the active session, or None when it is over."""
    status = str(doc.get("status") or "")
    sid = str(doc.get("id") or "")
    user_id = str(doc.get("user_id") or "")
    if status == "funding":
        bet = int(doc.get("bet") or 0)
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "chicken_cross_debit_id": 1})
        if user and user.get("chicken_cross_debit_id") == sid and bet >= 1:
            await db.chicken_cross_games.update_one({"id": sid, "status": "funding"}, {"$set": {"status": "active"}})
            fresh = await db.chicken_cross_games.find_one({"id": sid}, {"_id": 0})
            return fresh
        await db.chicken_cross_games.delete_one({"id": sid, "status": "funding"})
        return None
    if status == "settling":
        kind = str(doc.get("settle_kind") or "")
        if kind == "step" and not doc.get("settle_result"):
            outcome = await _apply_step(doc)
            if outcome.get("active"):
                fresh = await db.chicken_cross_games.find_one({"id": sid}, {"_id": 0})
                return fresh
            return None
        if kind == "void":
            await _finish(doc, won=False, payout=int(doc.get("bet") or 0), void=True, result="void")
            return None
        if str(doc.get("settle_result") or "") == "hit" or kind == "step":
            lane = int(doc.get("lane") or 0)
            await _finish({**doc, "lane": lane}, won=False, payout=0, void=False, result="hit", lane=lane)
            return None
        payout = _payout(int(doc.get("bet") or 0), _multiplier_cents(str(doc.get("difficulty") or ""), int(doc.get("lane") or 0), _doc_profile(doc)), _doc_cap(doc))
        await _finish(doc, won=True, payout=payout, void=False, result="cashout")
        return None
    if status == "active":
        return doc
    await db.chicken_cross_games.delete_one({"id": sid})
    return None


async def _ready_session(user: dict) -> Optional[dict]:
    user_id = str(user.get("id") or "")
    doc = await db.chicken_cross_games.find_one({"user_id": user_id})
    if not doc:
        return None
    return await _recover(doc)


class ChickenCrossStartRequest(BaseModel):
    model_config = ConfigDict(strict=True)
    bet: int
    difficulty: str
    currency: str = "cash"

    @field_validator("currency")
    @classmethod
    def currency_known(cls, v):
        key = str(v or "cash").strip().lower()
        if key not in CURRENCIES:
            raise ValueError("Choose cash or points")
        return key

    @field_validator("bet")
    @classmethod
    def bet_is_int(cls, v):
        if isinstance(v, bool) or not isinstance(v, int):
            raise ValueError("Bet must be a whole number")
        return v

    @field_validator("difficulty")
    @classmethod
    def difficulty_known(cls, v):
        key = str(v or "").strip().lower()
        if key not in DIFFICULTY_SPECS:
            raise ValueError("Choose a difficulty")
        return key


def register(router):
    @router.get("/casino/chicken-cross/config")
    async def casino_chicken_cross_config(current_user: dict = Depends(_auth)):
        return _config_payload(current_user, await _current_odds_profile())

    @router.get("/casino/chicken-cross/stats")
    async def casino_chicken_cross_stats(currency: str = "cash", current_user: dict = Depends(_auth)):
        user_id = current_user.get("id") or ""
        match: Dict[str, Any] = {"game_type": "chicken_cross", "user_id": user_id, "details.void": {"$ne": True}}
        if str(currency).strip().lower() == "points":
            match["details.currency"] = "points"
        else:
            match["details.currency"] = {"$ne": "points"}
        bet_expr: Dict[str, Any] = {"$convert": {"input": "$details.bet", "to": "double", "onError": 0.0, "onNull": 0.0}}
        payout_expr: Dict[str, Any] = {"$convert": {"input": "$details.payout", "to": "double", "onError": 0.0, "onNull": 0.0}}
        won_expr: Dict[str, Any] = {"$eq": ["$details.won", True]}
        agg = await db.gambling_log.aggregate(
            [
                {"$match": match},
                {
                    "$group": {
                        "_id": None,
                        "rounds": {"$sum": 1},
                        "wins": {"$sum": {"$cond": [won_expr, 1, 0]}},
                        "total_wagered": {"$sum": bet_expr},
                        "total_paid": {"$sum": payout_expr},
                        "biggest_win": {"$max": payout_expr},
                    }
                },
                {"$project": {"_id": 0, "rounds": 1, "wins": 1, "total_wagered": 1, "total_paid": 1, "biggest_win": 1}},
            ]
        ).to_list(1)
        row = (agg[0] if agg else {}) or {}
        rounds = int(row.get("rounds") or 0)
        wins = int(row.get("wins") or 0)
        losses = max(0, rounds - wins)
        total_wagered = float(row.get("total_wagered") or 0)
        total_paid = float(row.get("total_paid") or 0)
        net_profit = total_paid - total_wagered
        win_rate = (100.0 * wins / rounds) if rounds else 0.0
        recent_rows = await db.gambling_log.find(
            match,
            {"_id": 0, "details.won": 1, "created_at": 1},
        ).sort("created_at", -1).limit(CHICKEN_CROSS_STREAK_SCAN_LIMIT).to_list(CHICKEN_CROSS_STREAK_SCAN_LIMIT)
        return {
            "rounds": rounds,
            "wins": wins,
            "losses": losses,
            "total_wagered": total_wagered,
            "total_paid": total_paid,
            "net_profit": net_profit,
            "in_profit": net_profit >= 0,
            "biggest_win": float(row.get("biggest_win") or 0),
            "win_rate": round(win_rate, 2),
            "streak": _streaks(recent_rows),
        }

    @router.get("/casino/chicken-cross/game")
    async def casino_chicken_cross_game(current_user: dict = Depends(_auth)):
        doc = await _ready_session(current_user)
        if not doc:
            return {"active": False, "game": None}
        return {"active": True, "game": _public_game(doc)}

    @router.post("/casino/chicken-cross/start")
    async def casino_chicken_cross_start(request: ChickenCrossStartRequest, current_user: dict = Depends(_auth)):
        raise_if_gambling_self_banned(current_user)
        bet = int(request.bet)
        currency = request.currency
        spec = CURRENCIES[currency]
        if bet < 1:
            raise HTTPException(status_code=400, detail="Bet must be at least 1")
        if bet > int(spec["max_bet"]):
            limit = f"{int(spec['max_bet']):,} points" if currency == "points" else f"${int(spec['max_bet']):,}"
            raise HTTPException(status_code=400, detail=f"Max bet is {limit}")
        difficulty = request.difficulty
        profile = await _current_odds_profile()
        if not _offered_lanes(difficulty, bet, profile, int(spec["payout_cap"])):
            raise HTTPException(status_code=400, detail="That stake is too high for this difficulty")
        user_id = str(current_user.get("id") or "")
        existing = await _ready_session(current_user)
        if existing:
            raise HTTPException(status_code=400, detail="You already have a round in progress")
        session_id = str(uuid.uuid4())
        doc = {
            "id": session_id,
            "user_id": user_id,
            "username": current_user.get("username") or "?",
            "status": "funding",
            "state": _current_state(current_user),
            "difficulty": difficulty,
            "currency": currency,
            "bet": bet,
            "lane": 0,
            "multiplier_cents": 0,
            "odds_profile": profile,
            "death_lane": _roll_death_lane(difficulty, profile),
        }
        try:
            await db.chicken_cross_games.insert_one(doc)
        except DuplicateKeyError:
            raise HTTPException(status_code=400, detail="You already have a round in progress")
        funded = await _take_stake(user_id, session_id, bet, currency)
        if not funded:
            await db.chicken_cross_games.delete_one({"id": session_id, "status": "funding"})
            raise HTTPException(status_code=400, detail="Insufficient points" if currency == "points" else "Insufficient cash")
        await db.chicken_cross_games.update_one({"id": session_id, "status": "funding"}, {"$set": {"status": "active"}})
        fresh = await db.chicken_cross_games.find_one({"id": session_id}, {"_id": 0, "death_lane": 0})
        if not fresh:
            raise HTTPException(status_code=400, detail="Could not start the round")
        return {
            "active": True,
            "result": "started",
            "game": _public_game(fresh),
            "new_balance": await _read_balance(user_id),
            "new_points": await _read_balance(user_id, "points"),
        }

    @router.post("/casino/chicken-cross/step")
    async def casino_chicken_cross_step(current_user: dict = Depends(_auth)):
        raise_if_gambling_self_banned(current_user)
        user_id = str(current_user.get("id") or "")
        await _ready_session(current_user)
        doc = await db.chicken_cross_games.find_one_and_update(
            {"user_id": user_id, "status": "active"},
            {"$set": {"status": "settling", "settle_kind": "step"}},
            return_document=ReturnDocument.AFTER,
        )
        if not doc:
            raise HTTPException(status_code=400, detail="No active round")
        outcome = await _apply_step(doc)
        if outcome.get("result") == "blocked":
            raise HTTPException(status_code=400, detail="Cash out to finish")
        return outcome

    @router.post("/casino/chicken-cross/cashout")
    async def casino_chicken_cross_cashout(current_user: dict = Depends(_auth)):
        raise_if_gambling_self_banned(current_user)
        user_id = str(current_user.get("id") or "")
        await _ready_session(current_user)
        preview = await db.chicken_cross_games.find_one({"user_id": user_id, "status": "active"})
        if not preview or int(preview.get("lane") or 0) < 1:
            raise HTTPException(status_code=400, detail="Cross a lane before cashing out")
        payout = _payout(int(preview.get("bet") or 0), _multiplier_cents(str(preview.get("difficulty") or ""), int(preview.get("lane") or 0), _doc_profile(preview)), _doc_cap(preview))
        if payout < 1:
            raise HTTPException(status_code=400, detail="Nothing to cash out")
        doc = await db.chicken_cross_games.find_one_and_update(
            {"id": preview.get("id"), "status": "active", "lane": int(preview.get("lane") or 0)},
            {"$set": {"status": "settling", "settle_kind": "cashout", "settle_result": "cashout", "settle_payout": payout}},
            return_document=ReturnDocument.AFTER,
        )
        if not doc:
            raise HTTPException(status_code=400, detail="Round is busy")
        return await _finish(doc, won=True, payout=payout, void=False, result="cashout")

    @router.post("/casino/chicken-cross/void")
    async def casino_chicken_cross_void(current_user: dict = Depends(_auth)):
        raise_if_gambling_self_banned(current_user)
        user_id = str(current_user.get("id") or "")
        await _ready_session(current_user)
        preview = await db.chicken_cross_games.find_one({"user_id": user_id, "status": "active", "lane": 0})
        if not preview:
            raise HTTPException(status_code=400, detail="The chicken has already left the sidewalk")
        bet = int(preview.get("bet") or 0)
        doc = await db.chicken_cross_games.find_one_and_update(
            {"id": preview.get("id"), "status": "active", "lane": 0},
            {"$set": {"status": "settling", "settle_kind": "void", "settle_result": "void", "settle_payout": bet}},
            return_document=ReturnDocument.AFTER,
        )
        if not doc:
            raise HTTPException(status_code=400, detail="Round is busy")
        return await _finish(doc, won=False, payout=bet, void=True, result="void")
