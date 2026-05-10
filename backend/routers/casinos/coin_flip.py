# House-owned Coin Flip: choose heads/tails, server RNG, 2x gross payout on a correct call.
from __future__ import annotations

import secrets
from typing import Any

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from server import (
    STATES,
    db,
    get_current_user_verified,
    log_gambling,
)

_rng = secrets.SystemRandom()

COIN_FLIP_MAX_BET = 5_000_000
COIN_FLIP_CHOICES = ("heads", "tails")


class CoinFlipPlayRequest(BaseModel):
    bet: int
    choice: str


def _normalize_choice(raw: Any) -> str:
    choice = str(raw or "").strip().lower()
    if choice == "tales":
        choice = "tails"
    if choice not in COIN_FLIP_CHOICES:
        raise HTTPException(status_code=400, detail="Choose heads or tails")
    return choice


def _current_state(user: dict) -> str:
    raw = (user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
    if not raw:
        return STATES[0] if STATES else ""
    for st in STATES or []:
        if st and raw.lower() == st.lower():
            return st
    return STATES[0] if STATES else raw


def register(router):
    @router.get("/casino/coin-flip/config")
    async def casino_coin_flip_config(current_user: dict = Depends(get_current_user_verified)):
        return {
            "current_state": _current_state(current_user),
            "max_bet": COIN_FLIP_MAX_BET,
            "choices": list(COIN_FLIP_CHOICES),
            "payout_multiplier": 2,
            "state_owned": True,
        }

    @router.post("/casino/coin-flip/play")
    async def casino_coin_flip_play(request: CoinFlipPlayRequest, current_user: dict = Depends(get_current_user_verified)):
        state = _current_state(current_user)
        bet = int(request.bet or 0)
        if bet < 1:
            raise HTTPException(status_code=400, detail="Bet must be at least 1")
        if bet > COIN_FLIP_MAX_BET:
            raise HTTPException(status_code=400, detail=f"Max bet is ${COIN_FLIP_MAX_BET:,}")

        choice = _normalize_choice(request.choice)
        debit_res = await db.users.find_one_and_update(
            {"id": current_user.get("id") or "", "money": {"$gte": bet}},
            {"$inc": {"money": -bet}},
            return_document=False,
        )
        if not debit_res:
            raise HTTPException(status_code=400, detail="Insufficient cash")

        user_money_before = int((debit_res.get("money") or 0) or 0)
        result = COIN_FLIP_CHOICES[_rng.randrange(2)]
        won = choice == result
        payout = bet * 2 if won else 0
        net = payout - bet

        if payout > 0:
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": payout}})

        new_balance = user_money_before - bet + payout
        await log_gambling(
            current_user.get("id") or "",
            current_user.get("username") or "?",
            "coin_flip",
            {
                "state": state,
                "bet": bet,
                "choice": choice,
                "result": result,
                "won": won,
                "payout": payout,
                "net": net,
                "state_owned": True,
                "max_bet": COIN_FLIP_MAX_BET,
            },
        )

        return {
            "choice": choice,
            "result": result,
            "won": won,
            "bet": bet,
            "payout": payout,
            "net": net,
            "new_balance": new_balance,
        }
