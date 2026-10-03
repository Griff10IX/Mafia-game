# House-owned Chicken Cross. Admin-only while CHICKEN_CROSS_ADMIN_ONLY is true.
# The losing lane is rolled when the stake is taken and is never sent to the client.
from __future__ import annotations

import secrets
import uuid
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

CHICKEN_CROSS_ADMIN_ONLY = False
CHICKEN_CROSS_MAX_BET = 2_000_000_000
CHICKEN_CROSS_PAYOUT_CAP = 250_000_000_000
CHICKEN_CROSS_STREAK_SCAN_LIMIT = 120
# 98% RTP. Multipliers are floored so a cash-out is never worth more than the fair value.
_RTP = Fraction(98, 100)

DIFFICULTY_SPECS: Dict[str, Dict[str, Any]] = {
    "easy": {"label": "Easy", "survive_num": 92, "survive_den": 100},
    "medium": {"label": "Medium", "survive_num": 84, "survive_den": 100},
    "hard": {"label": "Hard", "survive_num": 73, "survive_den": 100},
    "expert": {"label": "Expert", "survive_num": 58, "survive_den": 100},
}


def _build_multiplier_tables() -> Dict[str, tuple]:
    """No fixed road length: lanes run until even a $1 stake would pass the payout cap."""
    tables: Dict[str, tuple] = {}
    for key, spec in DIFFICULTY_SPECS.items():
        reached = Fraction(1)
        survival = Fraction(int(spec["survive_num"]), int(spec["survive_den"]))
        cents_rows: List[int] = []
        while True:
            reached *= survival
            cents = int((_RTP / reached) * 100)
            if Fraction(cents, 100) * reached > _RTP:
                raise RuntimeError(f"Chicken Cross multiplier exceeds RTP for {key}")
            cents_rows.append(cents)
            if cents // 100 > CHICKEN_CROSS_PAYOUT_CAP:
                break
        tables[key] = tuple(cents_rows)
    return tables


MULTIPLIER_CENTS = _build_multiplier_tables()
_auth = require_admin_verified if CHICKEN_CROSS_ADMIN_ONLY else get_current_user_verified


def _multiplier_cents(difficulty: str, lane: int) -> int:
    rows = MULTIPLIER_CENTS[difficulty]
    if lane < 1 or lane > len(rows):
        return 0
    return int(rows[lane - 1])


def _payout(bet: int, cents: int) -> int:
    if bet < 1 or cents < 1:
        return 0
    return min(CHICKEN_CROSS_PAYOUT_CAP, (int(bet) * int(cents)) // 100)


def _mult_string(cents: int) -> str:
    cents = max(0, int(cents))
    return f"{cents // 100}.{cents % 100:02d}"


def _offered_lanes(difficulty: str, bet: int) -> List[Dict[str, Any]]:
    rows = []
    for lane, cents in enumerate(MULTIPLIER_CENTS[difficulty], start=1):
        payout = _payout(bet, cents)
        rows.append({
            "lane": lane,
            "multiplier_cents": int(cents),
            "multiplier": _mult_string(cents),
            "payout": payout,
        })
        # The lane that reaches the cap pays exactly the cap and ends the road.
        if payout >= CHICKEN_CROSS_PAYOUT_CAP:
            break
    return rows


def _roll_death_lane(difficulty: str) -> int:
    spec = DIFFICULTY_SPECS[difficulty]
    num = int(spec["survive_num"])
    den = int(spec["survive_den"])
    lanes = len(MULTIPLIER_CENTS[difficulty])
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
    offered = _offered_lanes(difficulty, bet)
    cents = _multiplier_cents(difficulty, lane) if lane else 0
    cashout = _payout(bet, cents) if lane else 0
    last_lane = offered[-1]["lane"] if offered else 0
    return {
        "id": doc.get("id"),
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


def _config_payload(user: dict) -> Dict[str, Any]:
    difficulties = []
    for key, spec in DIFFICULTY_SPECS.items():
        lanes = []
        for lane, cents in enumerate(MULTIPLIER_CENTS[key], start=1):
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


async def _read_balance(user_id: str) -> int:
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "money": 1})
    if not user:
        return 0
    try:
        return int(user.get("money") or 0)
    except (TypeError, ValueError):
        return 0


async def _credit_once(user_id: str, session_id: str, amount: int) -> None:
    amount = max(0, min(CHICKEN_CROSS_PAYOUT_CAP, int(amount)))
    update: Dict[str, Any] = {"$set": {"chicken_cross_settlement_id": session_id}}
    if amount:
        update["$inc"] = {"money": amount}
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
            "multiplier_cents": _multiplier_cents(str(doc.get("difficulty") or ""), lane) if lane else 0,
            "result": result,
            "won": bool(won),
            "void": bool(void),
            "payout": int(payout),
            "net": 0 if void else (int(payout) - bet),
            "state_owned": True,
            "max_bet": CHICKEN_CROSS_MAX_BET,
            "payout_cap": CHICKEN_CROSS_PAYOUT_CAP,
        },
    )


async def _finish(doc: dict, *, won: bool, payout: int, void: bool, result: str, lane: Optional[int] = None) -> Dict[str, Any]:
    sid = str(doc.get("id") or "")
    user_id = str(doc.get("user_id") or "")
    if lane is not None and int(lane) != int(doc.get("lane") or 0):
        await db.chicken_cross_games.update_one({"id": sid}, {"$set": {"lane": int(lane)}})
        doc = {**doc, "lane": int(lane)}
    await _credit_once(user_id, sid, int(payout))
    await _log_once(doc, won=won, payout=payout, void=void, result=result)
    await db.chicken_cross_games.delete_one({"id": sid})
    bet = int(doc.get("bet") or 0)
    cents = _multiplier_cents(str(doc.get("difficulty") or ""), int(doc.get("lane") or 0))
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
            "new_balance": await _read_balance(user_id),
        },
    }


async def _take_stake(user_id: str, session_id: str, bet: int) -> bool:
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "chicken_cross_debit_id": 1})
    if user and user.get("chicken_cross_debit_id") == session_id:
        return True
    res = await db.users.find_one_and_update(
        {"id": user_id, "money": {"$gte": bet}, "chicken_cross_debit_id": {"$ne": session_id}},
        {"$inc": {"money": -bet}, "$set": {"chicken_cross_debit_id": session_id}},
    )
    return bool(res)


async def _apply_step(doc: dict) -> Dict[str, Any]:
    difficulty = str(doc.get("difficulty") or "")
    bet = int(doc.get("bet") or 0)
    lane = int(doc.get("lane") or 0)
    next_lane = lane + 1
    offered = _offered_lanes(difficulty, bet)
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
    cents = _multiplier_cents(difficulty, next_lane)
    if next_lane >= last_lane:
        payout = _payout(bet, cents)
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
        payout = _payout(int(doc.get("bet") or 0), _multiplier_cents(str(doc.get("difficulty") or ""), int(doc.get("lane") or 0)))
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
        return _config_payload(current_user)

    @router.get("/casino/chicken-cross/stats")
    async def casino_chicken_cross_stats(current_user: dict = Depends(_auth)):
        user_id = current_user.get("id") or ""
        match = {"game_type": "chicken_cross", "user_id": user_id, "details.void": {"$ne": True}}
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
        if bet < 1:
            raise HTTPException(status_code=400, detail="Bet must be at least 1")
        if bet > CHICKEN_CROSS_MAX_BET:
            raise HTTPException(status_code=400, detail=f"Max bet is ${CHICKEN_CROSS_MAX_BET:,}")
        difficulty = request.difficulty
        if not _offered_lanes(difficulty, bet):
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
            "bet": bet,
            "lane": 0,
            "multiplier_cents": 0,
            "death_lane": _roll_death_lane(difficulty),
        }
        try:
            await db.chicken_cross_games.insert_one(doc)
        except DuplicateKeyError:
            raise HTTPException(status_code=400, detail="You already have a round in progress")
        funded = await _take_stake(user_id, session_id, bet)
        if not funded:
            await db.chicken_cross_games.delete_one({"id": session_id, "status": "funding"})
            raise HTTPException(status_code=400, detail="Insufficient cash")
        await db.chicken_cross_games.update_one({"id": session_id, "status": "funding"}, {"$set": {"status": "active"}})
        fresh = await db.chicken_cross_games.find_one({"id": session_id}, {"_id": 0, "death_lane": 0})
        if not fresh:
            raise HTTPException(status_code=400, detail="Could not start the round")
        return {
            "active": True,
            "result": "started",
            "game": _public_game(fresh),
            "new_balance": await _read_balance(user_id),
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
        payout = _payout(int(preview.get("bet") or 0), _multiplier_cents(str(preview.get("difficulty") or ""), int(preview.get("lane") or 0)))
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
