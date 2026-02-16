# Casino Slots: state-owned (one per state), no user ownership. Config + spin.
from datetime import datetime, timezone
import random
from typing import Optional
from pydantic import BaseModel, field_validator

from fastapi import Depends, HTTPException

from server import db, get_current_user, STATES, log_gambling

# ----- Constants -----
SLOTS_MAX_BET = 5_000_000
SLOTS_HOUSE_EDGE = 0.05  # 5% house edge on wins
# 3-reel slot: symbols with weights (higher = more frequent)
SLOTS_SYMBOLS = [
    {"id": "cherry", "name": "Cherry", "weight": 40, "mult_3": 3},
    {"id": "lemon", "name": "Lemon", "weight": 25, "mult_3": 5},
    {"id": "bar", "name": "Bar", "weight": 15, "mult_3": 20},
    {"id": "bell", "name": "Bell", "weight": 12, "mult_3": 10},
    {"id": "seven", "name": "Seven", "weight": 8, "mult_3": 50},
]
SLOTS_HISTORY_MAX = 20


def _normalize_state(state_raw: str) -> str:
    if not (state_raw or "").strip():
        return STATES[0] if STATES else ""
    s = (state_raw or "").strip()
    for st in STATES or []:
        if st and s.lower() == st.lower():
            return st
    return STATES[0] if STATES else s


def _slots_weighted_symbol():
    total = sum(s["weight"] for s in SLOTS_SYMBOLS)
    r = random.uniform(0, total)
    acc = 0
    for sym in SLOTS_SYMBOLS:
        acc += sym["weight"]
        if r <= acc:
            return sym
    return SLOTS_SYMBOLS[-1]


def _slots_spin() -> tuple:
    """Return (reel1, reel2, reel3) each a symbol dict."""
    return (_slots_weighted_symbol(), _slots_weighted_symbol(), _slots_weighted_symbol())


def _slots_payout(reels: tuple, bet: int) -> int:
    """Payout for 3 reels. Three of a kind pays mult_3 * bet, then house edge applied."""
    a, b, c = reels
    if a["id"] == b["id"] == c["id"]:
        mult = a["mult_3"]
        gross = bet * mult
        return max(0, int(gross * (1.0 - SLOTS_HOUSE_EDGE)))
    return 0


# ----- Models -----
class SlotsSpinRequest(BaseModel):
    bet: int

    @field_validator("bet", mode="before")
    @classmethod
    def coerce_bet(cls, v):
        if v is None:
            return 0
        if isinstance(v, str):
            return int(v.strip() or 0)
        return int(v)


def register(router):
    @router.get("/casino/slots/config")
    async def casino_slots_config(current_user: dict = Depends(get_current_user)):
        """Slots config: state-owned, one per state. max_bet, symbols, current_state, states list."""
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        current_state = _normalize_state(raw) if raw else (STATES[0] if STATES else "")
        return {
            "max_bet": SLOTS_MAX_BET,
            "house_edge": SLOTS_HOUSE_EDGE,
            "symbols": list(SLOTS_SYMBOLS),
            "current_state": current_state,
            "states": list(STATES or []),
            "state_owned": True,
        }

    @router.post("/casino/slots/spin")
    async def casino_slots_spin(request: SlotsSpinRequest, current_user: dict = Depends(get_current_user)):
        """Spin the slots in your current state. State-owned — no ownership, house pays."""
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        state = _normalize_state(raw) if raw else (STATES[0] if STATES else "")
        if state not in (STATES or []):
            raise HTTPException(status_code=400, detail="Invalid state")
        bet = int(request.bet or 0)
        if bet < 1:
            raise HTTPException(status_code=400, detail="Bet must be at least 1")
        if bet > SLOTS_MAX_BET:
            raise HTTPException(status_code=400, detail=f"Max bet is ${SLOTS_MAX_BET:,}")
        user_money = int(current_user.get("money") or 0)
        if user_money < bet:
            raise HTTPException(status_code=400, detail="Insufficient cash")

        reels = _slots_spin()
        payout = _slots_payout(reels, bet)
        new_money = user_money - bet + payout

        await db.users.update_one({"id": current_user["id"]}, {"$set": {"money": new_money}})

        history_entry = {
            "bet": bet,
            "reels": [r["id"] for r in reels],
            "reel_names": [r["name"] for r in reels],
            "payout": payout,
            "won": payout > 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$push": {"slots_history": {"$each": [history_entry], "$position": 0, "$slice": SLOTS_HISTORY_MAX}}},
        )
        await log_gambling(
            current_user["id"],
            current_user.get("username") or "?",
            "slots",
            {"state": state, "bet": bet, "reels": [r["id"] for r in reels], "payout": payout},
        )

        return {
            "reels": [{"id": r["id"], "name": r["name"]} for r in reels],
            "bet": bet,
            "payout": payout,
            "won": payout > 0,
            "new_balance": new_money,
        }

    @router.get("/casino/slots/history")
    async def casino_slots_history(current_user: dict = Depends(get_current_user)):
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "slots_history": 1})
        history = (user.get("slots_history") or [])[:SLOTS_HISTORY_MAX]
        return {"history": list(reversed(history))}
