# One rocket for the whole game. The crash point is chosen when the round opens
# and is not sent to the client until the flight is over.
from __future__ import annotations

import asyncio
import logging
import math
import secrets
import time
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
CRASH_ADMIN_ONLY = False
_auth = require_admin_verified if CRASH_ADMIN_ONLY else get_current_user_verified

STATE_ID = "current"
BETTING_SECONDS = 30
# Auto only keeps betting while this page is open. A few missed polls means they left.
AUTO_PAGE_SECONDS = 5
# Same idea for the rocket itself. Hidden tabs poll about every 1.5s, so a few
# missed polls means the page is empty and the 30s cycle should stop.
PRESENCE_SECONDS = 8
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
_tick_lock = asyncio.Lock()
_board_cache: Dict[str, Any] = {"at": 0.0, "cash": [], "points": []}
_BOARD_CACHE_SECONDS = 2.0


def roll_crash_cents() -> int:
    """Roobet's crash point. 1 in 20 flights die at 1.00x. The rest use their 1/x curve."""
    if _rng.randrange(20) == 0:
        return 100
    e = 1 << 52
    h = _rng.randrange(e)
    return (100 * e - h) // (e - h)


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
    await db.crash_presence.create_index("user_id", unique=True)
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


async def _settle_bet(bet: dict, *, won: bool, mult_cents: int, crash_cents: int) -> bool:
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
        return False
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
    return True


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
        if auto >= 101 and auto <= crash_cents and current >= auto:
            await _settle_bet(bet, won=True, mult_cents=auto, crash_cents=crash_cents)


async def _bust_open(state: dict) -> None:
    crash_cents = int(state["crash_cents"])
    bets = await db.crash_bets.find(
        {"round_id": state["round_id"], "status": "open"},
        {"_id": 0},
    ).to_list(400)
    for bet in bets:
        auto = bet.get("auto_cashout_cents")
        if auto is not None and int(auto) >= 101 and int(auto) <= crash_cents:
            await _settle_bet(bet, won=True, mult_cents=int(auto), crash_cents=crash_cents)
        else:
            await _settle_bet(bet, won=False, mult_cents=crash_cents, crash_cents=crash_cents)


def _auto_page_open(doc: dict, now: Optional[datetime] = None) -> bool:
    seen = _parse(doc.get("seen_at"))
    if not seen:
        return False
    now = now or _now()
    return (now - seen).total_seconds() <= AUTO_PAGE_SECONDS


async def _drop_away_autos(now: datetime) -> None:
    cutoff = (now - timedelta(seconds=AUTO_PAGE_SECONDS)).isoformat()
    await db.crash_auto.update_many(
        {
            "enabled": True,
            "$or": [
                {"seen_at": {"$exists": False}},
                {"seen_at": None},
                {"seen_at": {"$lt": cutoff}},
            ],
        },
        {"$set": {"enabled": False}},
    )


async def _note_auto_presence(user_id: str) -> None:
    if not user_id:
        return
    await db.crash_auto.update_one(
        {"user_id": user_id, "enabled": True},
        {"$set": {"seen_at": _now().isoformat()}},
    )


async def _note_presence(user_id: str) -> None:
    if not user_id:
        return
    await db.crash_presence.update_one(
        {"user_id": user_id},
        {"$set": {"seen_at": _now().isoformat()}},
        upsert=True,
    )


async def _ready_autos() -> List[dict]:
    autos = await db.crash_auto.find(
        {"enabled": True},
        {"_id": 0, "enabled": 1, "seen_at": 1, "session_net": 1, "stop_profit": 1, "stop_loss": 1},
    ).to_list(50)
    return [doc for doc in autos if _auto_should_run(doc)]


async def _anyone_here(now: datetime) -> bool:
    """True when a player has the Crash page open, or auto is still allowed to bet."""
    cutoff = (now - timedelta(seconds=PRESENCE_SECONDS)).isoformat()
    watcher = await db.crash_presence.find_one({"seen_at": {"$gte": cutoff}}, {"_id": 1})
    if watcher:
        return True
    return bool(await _ready_autos())


async def _has_open_bets(round_id: Optional[str]) -> bool:
    if not round_id:
        return False
    found = await db.crash_bets.find_one({"round_id": round_id, "status": "open"}, {"_id": 1})
    return bool(found)


def _idle_fields(state: dict) -> dict:
    return {
        "id": STATE_ID,
        "phase": "idle",
        "round_id": None,
        "crash_cents": None,
        "betting_ends_at": None,
        "flight_started_at": None,
        "last_crash_cents": state.get("last_crash_cents"),
        "history": list(state.get("history") or [])[-15:],
    }


async def _try_idle(state: dict) -> dict:
    """Stop an empty round. If a bet landed in the gap, put that round back."""
    round_id = state.get("round_id")
    phase = state.get("phase")
    claimed = await db.crash_state.update_one(
        {"id": STATE_ID, "phase": phase, "round_id": round_id},
        {"$set": _idle_fields(state)},
    )
    fresh = await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0})
    if claimed.modified_count != 1:
        return fresh or state
    if round_id and await _has_open_bets(round_id):
        await db.crash_state.update_one(
            {"id": STATE_ID, "phase": "idle"},
            {"$set": {
                "phase": phase,
                "round_id": round_id,
                "crash_cents": state.get("crash_cents"),
                "betting_ends_at": state.get("betting_ends_at"),
                "flight_started_at": state.get("flight_started_at"),
                "last_crash_cents": state.get("last_crash_cents"),
                "history": list(state.get("history") or [])[-15:],
            }},
        )
        return await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0}) or state
    return fresh or {}


def _auto_should_run(doc: dict) -> bool:
    if not doc or not doc.get("enabled"):
        return False
    if not _auto_page_open(doc):
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


async def _open_betting(now: datetime, last_crash: Optional[int], history: List[int]) -> bool:
    """Open the next 30s window only from idle or a settle. A live round is left alone."""
    round_id = str(uuid.uuid4())
    ends = now + timedelta(seconds=BETTING_SECONDS)
    payload = {
        "id": STATE_ID,
        "round_id": round_id,
        "phase": "betting",
        "crash_cents": roll_crash_cents(),
        "betting_ends_at": ends.isoformat(),
        "flight_started_at": None,
        "last_crash_cents": last_crash,
        "history": (history or [])[-15:],
    }
    claimed = await db.crash_state.update_one(
        {"id": STATE_ID, "phase": {"$in": ["idle", "settling"]}},
        {"$set": payload},
    )
    if claimed.modified_count != 1:
        existing = await db.crash_state.find_one({"id": STATE_ID}, {"_id": 1})
        if existing:
            return False
        try:
            await db.crash_state.insert_one(payload)
        except DuplicateKeyError:
            return False
    await _place_auto_bets(round_id)
    return True


async def _park_until_someone(now: datetime, state: Optional[dict]) -> dict:
    """Watching is not enough. A new 30s window starts when auto is in, or someone places a bet."""
    del now
    if await _ready_autos():
        await _open_betting(_now(), (state or {}).get("last_crash_cents"), list((state or {}).get("history") or []))
        return await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0}) or {}
    if state and state.get("phase") == "idle":
        return state
    if state:
        await db.crash_state.update_one(
            {"id": STATE_ID, "phase": state.get("phase")},
            {"$set": _idle_fields(state)},
        )
    else:
        try:
            await db.crash_state.insert_one(_idle_fields({}))
        except DuplicateKeyError:
            pass
    return await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0}) or {}


async def _leaderboards() -> Dict[str, list]:
    """Polls hit this a few times a second. The board only needs to be a couple of seconds fresh."""
    now = time.monotonic()
    if now - float(_board_cache.get("at") or 0) < _BOARD_CACHE_SECONDS:
        return {"cash": list(_board_cache.get("cash") or []), "points": list(_board_cache.get("points") or [])}
    cash = await _leaderboard("cash")
    points = await _leaderboard("points")
    _board_cache["at"] = now
    _board_cache["cash"] = cash
    _board_cache["points"] = points
    return {"cash": cash, "points": points}


async def tick() -> dict:
    """Advance the round. Only the background loop should call this.
    A cash-out or a state poll must not wait on every other auto cash-out.
    """
    if _tick_lock.locked():
        return await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0}) or {}
    async with _tick_lock:
        return await _tick_locked()


async def _tick_locked() -> dict:
    await _ensure_indexes()
    now = _now()
    await _drop_away_autos(now)
    state = await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0})
    phase = (state or {}).get("phase")
    if phase not in ("betting", "flying"):
        return await _park_until_someone(now, state)

    if not await _has_open_bets(state.get("round_id")) and not await _anyone_here(now):
        return await _try_idle(state)

    if phase == "betting":
        ends = _parse(state.get("betting_ends_at"))
        if ends and now >= ends and not await _has_open_bets(state.get("round_id")):
            return await _try_idle(state)
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

    await _pay_due_autos(state, now)
    started = _parse(state.get("flight_started_at"))
    elapsed = (now - started).total_seconds() if started else 0
    if elapsed >= seconds_until(int(state.get("crash_cents") or 100)):
        return await _crash_now(state, now)
    return await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0}) or state


async def _crash_now(state: dict, now: datetime) -> dict:
    claimed = await db.crash_state.update_one(
        {"id": STATE_ID, "phase": "flying", "round_id": state["round_id"]},
        {"$set": {"phase": "settling"}},
    )
    if claimed.modified_count != 1:
        fresh = await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0})
        return fresh or state
    await _bust_open(state)
    crash_cents = int(state["crash_cents"])
    history = list(state.get("history") or [])
    history.append(crash_cents)
    done = {**state, "last_crash_cents": crash_cents, "history": history}
    if await _ready_autos():
        await _open_betting(now, crash_cents, history)
    else:
        await db.crash_state.update_one(
            {"id": STATE_ID, "phase": "settling", "round_id": state["round_id"]},
            {"$set": _idle_fields(done)},
        )
    return await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0}) or {}


def _public_state(state: dict, user_id: str, bets: List[dict], auto_doc: Optional[dict], boards: Dict[str, list]) -> dict:
    raw_phase = state.get("phase")
    waiting = raw_phase not in ("betting", "flying")
    # Idle stays "betting" so the current Place bet button still starts a round.
    phase = "flying" if raw_phase == "flying" else "betting"
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
        "waiting": waiting,
        "server_now": _now().isoformat(),
        "betting_ends_at": None if waiting else state.get("betting_ends_at"),
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
    """Read the round. The background loop is what advances it.
    Polls used to call tick(), so every open Crash page waited on every auto cash-out.
    """
    user_id = user.get("id") or ""
    await _note_presence(user_id)
    await _note_auto_presence(user_id)
    state = await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0}) or {}
    bets = []
    if state.get("round_id"):
        bets = await db.crash_bets.find(
            {"round_id": state.get("round_id")},
            {"_id": 0},
        ).sort("created_at", 1).to_list(120)
    auto_doc = await db.crash_auto.find_one({"user_id": user_id}, {"_id": 0})
    return _public_state(state, user_id, bets, auto_doc, await _leaderboards())


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
    leave: bool = False

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
        await _note_presence(current_user.get("id") or "")
        state = await tick()
        if state.get("phase") == "idle":
            await _open_betting(_now(), state.get("last_crash_cents"), list(state.get("history") or []))
            state = await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0}) or {}
        if state.get("phase") != "betting":
            raise HTTPException(status_code=400, detail="Betting is closed. Wait for the next rocket.")
        auto_cents = _cashout_cents(body.auto_cashout)
        await _place_bet(current_user, state["round_id"], body.currency, body.stake, auto_cents, from_auto=False)
        return await _view(current_user)

    @router.post("/casino/crash/cashout")
    async def crash_cashout(current_user: dict = Depends(_auth)):
        raise_if_gambling_self_banned(current_user)
        clicked = _now()
        state = await db.crash_state.find_one({"id": STATE_ID}, {"_id": 0})
        if not state or state.get("phase") != "flying":
            raise HTTPException(status_code=400, detail="The rocket is not in the air")
        started = _parse(state.get("flight_started_at"))
        elapsed = (clicked - started).total_seconds() if started else 0
        crash_cents = int(state.get("crash_cents") or 100)
        current = multiplier_cents(elapsed)
        if not started or elapsed >= seconds_until(crash_cents) or current >= crash_cents:
            raise HTTPException(status_code=400, detail="Too late. The rocket crashed.")
        bet = await db.crash_bets.find_one(
            {"round_id": state["round_id"], "user_id": current_user["id"], "status": "open"},
            {"_id": 0},
        )
        if not bet:
            raise HTTPException(status_code=400, detail="You are not in this round")
        settled = await _settle_bet(bet, won=True, mult_cents=current, crash_cents=crash_cents)
        if not settled:
            fresh = await db.crash_bets.find_one(
                {"id": bet["id"]},
                {"_id": 0, "status": 1},
            )
            if not fresh or fresh.get("status") != "cashed":
                raise HTTPException(status_code=400, detail="Too late. The rocket crashed.")
        return await _view(current_user)

    @router.post("/casino/crash/auto")
    async def crash_auto(body: AutoBody, current_user: dict = Depends(_auth)):
        raise_if_gambling_self_banned(current_user)
        user_id = current_user["id"]
        if body.leave:
            await db.crash_auto.update_one({"user_id": user_id}, {"$set": {"enabled": False}})
            return await _view(current_user)
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
        saved = {
            "user_id": user_id,
            "enabled": bool(body.enabled),
            "currency": body.currency,
            "stake": int(body.stake or 0),
            "auto_cashout_cents": auto_cents,
            "stop_profit": max(0, int(body.stop_profit or 0)),
            "stop_loss": max(0, int(body.stop_loss or 0)),
            "session_net": session,
        }
        if body.enabled:
            saved["seen_at"] = _now().isoformat()
        await db.crash_auto.update_one({"user_id": user_id}, {"$set": saved}, upsert=True)
        await _note_presence(user_id)
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
        idle = False
        try:
            state = await tick()
            idle = (state or {}).get("phase") == "idle"
        except Exception:
            logger.exception("crash ticker failed")
        await asyncio.sleep(2.0 if idle else 0.25)


def start_crash_loop() -> None:
    global _loop_started
    if _loop_started:
        return
    _loop_started = True
    asyncio.create_task(run_crash_loop())
