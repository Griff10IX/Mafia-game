# One rocket for the whole game. The crash point is chosen when the round opens
# and is not sent to the client until the flight is over.
from __future__ import annotations

import asyncio
import logging
import math
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, field_validator
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from server import db, get_current_user_verified, log_gambling, require_admin_verified
from utils.gambling_self_ban import raise_if_gambling_self_banned

logger = logging.getLogger(__name__)
_rng = secrets.SystemRandom()

# Admin-only while CRASH_ADMIN_ONLY is true (must match CRASH_ADMIN_ONLY in src/config/gameFeatures.js).
CRASH_ADMIN_ONLY = True
_auth = require_admin_verified if CRASH_ADMIN_ONLY else get_current_user_verified

STATE_ID = "current"
BETTING_SECONDS = 10
GROWTH = 0.09
CASH_MAX_BET = 2_000_000_000
CASH_PAYOUT_CAP = 500_000_000_000
POINTS_MAX_BET = 500
POINTS_PAYOUT_CAP = 50_000
CURRENCIES = {
    "cash": {"field": "money", "max_bet": CASH_MAX_BET, "payout_cap": CASH_PAYOUT_CAP},
    "points": {"field": "points", "max_bet": POINTS_MAX_BET, "payout_cap": POINTS_PAYOUT_CAP},
}

_indexes_ready = False
_loop_started = False


def roll_crash_cents() -> int:
    """About 55% of flights reach 2.00x. Above that, a normal crash tail."""
    u = _rng.random()
    if u < 0.04:
        return 100
    if u < 0.45:
        t = (u - 0.04) / 0.41
        value = 1.01 + 0.98 * (t ** 0.55)
        return max(101, min(199, int(round(value * 100))))
    q = (u - 0.45) / 0.55
    if q < 0.03:
        return 200
    s = max((1.0 - q) / 0.97, 1e-6)
    cents = int(math.floor((2.0 / s) * 100))
    return max(200, min(cents, 1_000_000))


def multiplier_cents(elapsed: float) -> int:
    if elapsed <= 0:
        return 100
    return max(100, int(round(math.exp(GROWTH * elapsed) * 100)))


def seconds_until(crash_cents: int) -> float:
    mult = max(1.0, int(crash_cents) / 100.0)
    if mult <= 1.0001:
        return 0.0
    return math.log(mult) / GROWTH


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _payout(currency: str, stake: int, mult_cents: int) -> int:
    cap = int(CURRENCIES[currency]["payout_cap"])
    raw = (int(stake) * int(mult_cents)) // 100
    return max(0, min(cap, raw))


async def _ensure_indexes() -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    await db.crash_state.create_index("id", unique=True)
    await db.crash_bets.create_index([("round_id", 1), ("user_id", 1)], unique=True)
    await db.crash_bets.create_index([("round_id", 1), ("status", 1)])
    await db.crash_leaders.create_index([("user_id", 1), ("currency", 1)], unique=True)
    await db.crash_leaders.create_index([("currency", 1), ("net", -1)])
    await db.crash_auto.create_index("user_id", unique=True)
    _indexes_ready = True


async def _leaderboard(currency: str) -> List[dict]:
    rows = await db.crash_leaders.find(
        {"currency": currency},
        {"_id": 0, "username": 1, "net": 1, "biggest_payout": 1},
    ).sort("net", -1).limit(20).to_list(20)
    out = []
    for row in rows:
        out.append({
            "username": row.get("username") or "?",
            "net": int(row.get("net") or 0),
            "biggest_payout": int(row.get("biggest_payout") or 0),
        })
    return out


async def _record_result(user_id: str, username: str, currency: str, stake: int, payout: int) -> None:
    """Net is profit. A cash-out adds the profit. A bust subtracts the stake."""
    profit = int(payout) - int(stake)
    await db.crash_leaders.update_one(
        {"user_id": user_id, "currency": currency},
        {
            "$inc": {"net": profit},
            "$max": {"biggest_payout": int(payout)},
            "$set": {"username": username},
        },
        upsert=True,
    )


async def _touch_auto_session(user_id: str, profit: int) -> None:
    doc = await db.crash_auto.find_one({"user_id": user_id}, {"_id": 0})
    if not doc or not doc.get("enabled"):
        return
    session = int(doc.get("session_net") or 0) + int(profit)
    stop_profit = int(doc.get("stop_profit") or 0)
    stop_loss = int(doc.get("stop_loss") or 0)
    enabled = True
    if stop_profit > 0 and session >= stop_profit:
        enabled = False
    if stop_loss > 0 and session <= -stop_loss:
        enabled = False
    await db.crash_auto.update_one(
        {"user_id": user_id},
        {"$set": {"session_net": session, "enabled": enabled}},
    )


async def _settle_bet(bet: dict, *, won: bool, mult_cents: int, crash_cents: int) -> None:
    payout = _payout(bet["currency"], int(bet["stake"]), mult_cents) if won else 0
    status = "cashed" if won else "lost"
    updated = await db.crash_bets.find_one_and_update(
        {"id": bet["id"], "status": "open"},
        {"$set": {
            "status": status,
            "cashout_cents": int(mult_cents) if won else None,
            "payout": payout,
        }},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        return
    user_id = updated["user_id"]
    if won and payout:
        field = CURRENCIES[updated["currency"]]["field"]
        await db.users.update_one({"id": user_id}, {"$inc": {field: payout}})
    await _record_result(user_id, updated.get("username") or "?", updated["currency"], int(updated["stake"]), payout)
    if updated.get("from_auto"):
        await _touch_auto_session(user_id, payout - int(updated["stake"]))
    try:
        await log_gambling(user_id, updated.get("username") or "?", "crash", {
            "currency": updated["currency"],
            "bet": int(updated["stake"]),
            "payout": payout,
            "won": won,
            "multiplier": (int(mult_cents) / 100.0) if won else 0,
            "crash": int(crash_cents) / 100.0,
        })
    except Exception:
        logger.exception("crash log failed")


async def _pay_due_autos(state: dict, now: datetime) -> None:
    if state.get("phase") != "flying":
        return
    started = _parse(state.get("flight_started_at"))
    if not started:
        return
    current = multiplier_cents((now - started).total_seconds())
    crash_cents = int(state["crash_cents"])
    bets = await db.crash_bets.find(
        {"round_id": state["round_id"], "status": "open", "auto_cashout_cents": {"$ne": None}},
        {"_id": 0},
    ).to_list(400)
    for bet in bets:
        auto = int(bet.get("auto_cashout_cents") or 0)
        if auto >= 101 and auto < crash_cents and current >= auto:
            await _settle_bet(bet, won=True, mult_cents=auto, crash_cents=crash_cents)


async def _bust_open(state: dict) -> None:
    crash_cents = int(state["crash_cents"])
    bets = await db.crash_bets.find(
        {"round_id": state["round_id"], "status": "open"},
        {"_id": 0},
    ).to_list(400)
    for bet in bets:
        auto = bet.get("auto_cashout_cents")
        if auto is not None and int(auto) >= 101 and int(auto) < crash_cents:
            await _settle_bet(bet, won=True, mult_cents=int(auto), crash_cents=crash_cents)
        else:
            await _settle_bet(bet, won=False, mult_cents=crash_cents, crash_cents=crash_cents)


def _auto_should_run(doc: dict) -> bool:
    if not doc or not doc.get("enabled"):
        return False
    session = int(doc.get("session_net") or 0)
    stop_profit = int(doc.get("stop_profit") or 0)
    stop_loss = int(doc.get("stop_loss") or 0)
    if stop_profit > 0 and session >= stop_profit:
        return False
    if stop_loss > 0 and session <= -stop_loss:
        return False
    return True


async def _place_bet(
    user: dict,
    round_id: str,
    currency: str,
    stake: int,
    auto_cashout_cents: Optional[int],
    *,
    from_auto: bool,
) -> dict:
    spec = CURRENCIES[currency]
    if stake < 1 or stake > int(spec["max_bet"]):
        raise HTTPException(status_code=400, detail=f"Bet must be between 1 and {int(spec['max_bet']):,}")
    user_id = user["id"]
    existing = await db.crash_bets.find_one({"round_id": round_id, "user_id": user_id}, {"_id": 1})
    if existing:
        raise HTTPException(status_code=400, detail="You already have a bet on this rocket")
    field = spec["field"]
    taken = await db.users.update_one(
        {"id": user_id, field: {"$gte": stake}},
        {"$inc": {field: -stake}},
    )
    if taken.modified_count != 1:
        raise HTTPException(status_code=400, detail="Not enough cash" if currency == "cash" else "Not enough points")
    doc = {
        "id": str(uuid.uuid4()),
        "round_id": round_id,
        "user_id": user_id,
        "username": user.get("username") or "?",
        "currency": currency,
        "stake": stake,
        "auto_cashout_cents": auto_cashout_cents,
        "from_auto": from_auto,
        "status": "open",
        "cashout_cents": None,
        "payout": 0,
        "created_at": _now().isoformat(),
    }
    try:
        await db.crash_bets.insert_one(doc)
    except DuplicateKeyError:
        await db.users.update_one({"id": user_id}, {"$inc": {field: stake}})
        raise HTTPException(status_code=400, detail="You already have a bet on this rocket")
    return doc


async def _place_auto_bets(round_id: str) -> None:
    autos = await db.crash_auto.find({"enabled": True}, {"_id": 0}).to_list(500)
    for doc in autos:
        if not _auto_should_run(doc):
            continue
        user = await db.users.find_one({"id": doc.get("user_id")}, {"_id": 0})
        if not user:
            continue
        try:
            raise_if_gambling_self_banned(user)
        except HTTPException:
            continue
        currency = doc.get("currency") if doc.get("currency") in CURRENCIES else "cash"
        try:
            await _place_bet(
                user,
                round_id,
                currency,
                int(doc.get("stake") or 0),
                int(doc["auto_cashout_cents"]) if doc.get("auto_cashout_cents") else None,
                from_auto=True,
            )
        except HTTPException:
            continue
        except Exception:
            logger.exception("crash auto bet failed for %s", doc.get("user_id"))


async def _open_betting(now: datetime, last_crash: Optional[int], history: List[int]) -> None:
    round_id = str(uuid.uuid4())
    ends = now + timedelta(seconds=BETTING_SECONDS)
    await db.crash_state.update_one(
        {"id": STATE_ID},
        {"$set": {
            "id": STATE_ID,
            "round_id": round_id,
            "phase": "betting",
            "crash_cents": roll_crash_cents(),
            "betting_ends_at": ends.isoformat(),
            "flight_started_at": None,
            "last_crash_cents": last_crash,
            "history": (history or [])[-15:],
        }},
        upsert=True,
    )
    await _place_auto_bets(round_id)


async def tick() -> dict:
    await _ensure_indexes()
    now = _now()
    state = await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0})
    if not state:
        await _open_betting(now, None, [])
        return await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0}) or {}

    phase = state.get("phase")
    if phase == "betting":
        ends = _parse(state.get("betting_ends_at"))
        if ends and now >= ends:
            claimed = await db.crash_state.update_one(
                {"id": STATE_ID, "phase": "betting", "round_id": state["round_id"]},
                {"$set": {"phase": "flying", "flight_started_at": now.isoformat()}},
            )
            if claimed.modified_count:
                state = await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0}) or state
                if int(state.get("crash_cents") or 100) <= 100:
                    return await _crash_now(state, now)
                return state
        return await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0}) or state

    if phase == "flying":
        await _pay_due_autos(state, now)
        started = _parse(state.get("flight_started_at"))
        elapsed = (now - started).total_seconds() if started else 0
        if elapsed >= seconds_until(int(state.get("crash_cents") or 100)):
            return await _crash_now(state, now)
        return await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0}) or state

    return state


async def _crash_now(state: dict, now: datetime) -> dict:
    claimed = await db.crash_state.update_one(
        {"id": STATE_ID, "phase": "flying", "round_id": state["round_id"]},
        {"$set": {"phase": "settling"}},
    )
    if claimed.modified_count != 1:
        fresh = await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0})
        if fresh and fresh.get("phase") == "flying":
            return await tick()
        return fresh or state
    await _bust_open(state)
    crash_cents = int(state["crash_cents"])
    history = list(state.get("history") or [])
    history.append(crash_cents)
    await _open_betting(now, crash_cents, history)
    return await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0}) or {}


def _public_state(state: dict, user_id: str, bets: List[dict], auto_doc: Optional[dict], boards: Dict[str, list]) -> dict:
    phase = "betting" if state.get("phase") != "flying" else "flying"
    started = _parse(state.get("flight_started_at")) if phase == "flying" else None
    current = multiplier_cents((_now() - started).total_seconds()) if started else 100
    public_bets = []
    mine = None
    for bet in bets:
        row = {
            "username": bet.get("username") or "?",
            "currency": bet.get("currency"),
            "stake": int(bet.get("stake") or 0),
            "status": bet.get("status"),
            "cashout_cents": bet.get("cashout_cents"),
            "payout": int(bet.get("payout") or 0),
            "mine": bet.get("user_id") == user_id,
        }
        public_bets.append(row)
        if row["mine"]:
            mine = row
    auto = None
    if auto_doc:
        auto = {
            "enabled": bool(auto_doc.get("enabled")),
            "currency": auto_doc.get("currency") or "cash",
            "stake": int(auto_doc.get("stake") or 0),
            "auto_cashout": (int(auto_doc["auto_cashout_cents"]) / 100.0) if auto_doc.get("auto_cashout_cents") else None,
            "stop_profit": int(auto_doc.get("stop_profit") or 0),
            "stop_loss": int(auto_doc.get("stop_loss") or 0),
            "session_net": int(auto_doc.get("session_net") or 0),
        }
    return {
        "round_id": state.get("round_id"),
        "phase": phase,
        "server_now": _now().isoformat(),
        "betting_ends_at": state.get("betting_ends_at"),
        "flight_started_at": state.get("flight_started_at") if phase == "flying" else None,
        "multiplier_cents": current if phase == "flying" else 100,
        "growth": GROWTH,
        "last_crash_cents": state.get("last_crash_cents"),
        "history": [int(x) for x in (state.get("history") or [])],
        "bets": public_bets,
        "my_bet": mine,
        "auto": auto,
        "leaderboard": boards,
        "limits": {
            "cash": {"max_bet": CASH_MAX_BET, "payout_cap": CASH_PAYOUT_CAP},
            "points": {"max_bet": POINTS_MAX_BET, "payout_cap": POINTS_PAYOUT_CAP},
        },
        "betting_seconds": BETTING_SECONDS,
    }


async def _view(user: dict) -> dict:
    state = await tick()
    user_id = user.get("id") or ""
    bets = await db.crash_bets.find(
        {"round_id": state.get("round_id")},
        {"_id": 0},
    ).sort("created_at", 1).to_list(120)
    auto_doc = await db.crash_auto.find_one({"user_id": user_id}, {"_id": 0})
    boards = {
        "cash": await _leaderboard("cash"),
        "points": await _leaderboard("points"),
    }
    return _public_state(state, user_id, bets, auto_doc, boards)


def _cashout_cents(raw: Optional[float]) -> Optional[int]:
    if raw is None:
        return None
    cents = int(round(float(raw) * 100))
    if cents < 101:
        raise HTTPException(status_code=400, detail="Auto cash out must be at least 1.01x")
    return cents


class BetBody(BaseModel):
    model_config = ConfigDict(strict=True)
    stake: int
    currency: str = "cash"
    auto_cashout: Optional[float] = None

    @field_validator("stake")
    @classmethod
    def stake_int(cls, v):
        if isinstance(v, bool) or not isinstance(v, int):
            raise ValueError("Stake must be a whole number")
        return v

    @field_validator("currency")
    @classmethod
    def currency_ok(cls, v):
        key = str(v or "cash").strip().lower()
        if key not in CURRENCIES:
            raise ValueError("Choose cash or points")
        return key


class AutoBody(BaseModel):
    model_config = ConfigDict(strict=True)
    enabled: bool
    stake: int = 0
    currency: str = "cash"
    auto_cashout: Optional[float] = None
    stop_profit: int = 0
    stop_loss: int = 0

    @field_validator("currency")
    @classmethod
    def currency_ok(cls, v):
        key = str(v or "cash").strip().lower()
        if key not in CURRENCIES:
            raise ValueError("Choose cash or points")
        return key


def register(router):
    @router.get("/casino/crash/state")
    async def crash_state(current_user: dict = Depends(_auth)):
        raise_if_gambling_self_banned(current_user)
        return await _view(current_user)

    @router.post("/casino/crash/bet")
    async def crash_bet(body: BetBody, current_user: dict = Depends(_auth)):
        raise_if_gambling_self_banned(current_user)
        state = await tick()
        if state.get("phase") != "betting":
            raise HTTPException(status_code=400, detail="Betting is closed. Wait for the next rocket.")
        auto_cents = _cashout_cents(body.auto_cashout)
        await _place_bet(current_user, state["round_id"], body.currency, body.stake, auto_cents, from_auto=False)
        return await _view(current_user)

    @router.post("/casino/crash/cashout")
    async def crash_cashout(current_user: dict = Depends(_auth)):
        raise_if_gambling_self_banned(current_user)
        state = await tick()
        if state.get("phase") != "flying":
            raise HTTPException(status_code=400, detail="The rocket is not in the air")
        started = _parse(state.get("flight_started_at"))
        elapsed = (_now() - started).total_seconds() if started else 0
        current = multiplier_cents(elapsed)
        crash_cents = int(state["crash_cents"])
        if current >= crash_cents:
            raise HTTPException(status_code=400, detail="Too late. The rocket crashed.")
        bet = await db.crash_bets.find_one(
            {"round_id": state["round_id"], "user_id": current_user["id"], "status": "open"},
            {"_id": 0},
        )
        if not bet:
            raise HTTPException(status_code=400, detail="You are not in this round")
        await _settle_bet(bet, won=True, mult_cents=current, crash_cents=crash_cents)
        return await _view(current_user)

    @router.post("/casino/crash/auto")
    async def crash_auto(body: AutoBody, current_user: dict = Depends(_auth)):
        raise_if_gambling_self_banned(current_user)
        user_id = current_user["id"]
        auto_cents = _cashout_cents(body.auto_cashout) if body.enabled and body.auto_cashout else (
            _cashout_cents(body.auto_cashout) if body.auto_cashout else None
        )
        if body.enabled:
            spec = CURRENCIES[body.currency]
            if body.stake < 1 or body.stake > int(spec["max_bet"]):
                raise HTTPException(status_code=400, detail=f"Bet must be between 1 and {int(spec['max_bet']):,}")
        prev = await db.crash_auto.find_one({"user_id": user_id}, {"_id": 0, "session_net": 1, "enabled": 1})
        session = 0 if not prev or not prev.get("enabled") else int(prev.get("session_net") or 0)
        if body.enabled and (not prev or not prev.get("enabled")):
            session = 0
        await db.crash_auto.update_one(
            {"user_id": user_id},
            {"$set": {
                "user_id": user_id,
                "enabled": bool(body.enabled),
                "currency": body.currency,
                "stake": int(body.stake or 0),
                "auto_cashout_cents": auto_cents,
                "stop_profit": max(0, int(body.stop_profit or 0)),
                "stop_loss": max(0, int(body.stop_loss or 0)),
                "session_net": session,
            }},
            upsert=True,
        )
        state = await tick()
        if body.enabled and state.get("phase") == "betting":
            try:
                await _place_bet(
                    current_user,
                    state["round_id"],
                    body.currency,
                    int(body.stake),
                    auto_cents,
                    from_auto=True,
                )
            except HTTPException:
                pass
        return await _view(current_user)


async def run_crash_loop() -> None:
    while True:
        try:
            await tick()
        except Exception:
            logger.exception("crash ticker failed")
        await asyncio.sleep(0.25)


def start_crash_loop() -> None:
    global _loop_started
    if _loop_started:
        return
    _loop_started = True
    asyncio.create_task(run_crash_loop())
