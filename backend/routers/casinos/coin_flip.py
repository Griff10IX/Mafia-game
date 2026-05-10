# House-owned Coin Flip: choose heads/tails, server RNG, 2x gross payout on a correct call.
from __future__ import annotations

import secrets
from typing import Any, Dict, List

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
COIN_FLIP_STREAK_SCAN_LIMIT = 120


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


def _coin_flip_streaks(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
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

    # Recompute the leading run directly so it cannot be affected by the longest-run pass.
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

    @router.get("/casino/coin-flip/stats")
    async def casino_coin_flip_stats(current_user: dict = Depends(get_current_user_verified)):
        user_id = current_user.get("id") or ""
        match = {"game_type": "coin_flip", "user_id": user_id}
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
        ).sort("created_at", -1).limit(COIN_FLIP_STREAK_SCAN_LIMIT).to_list(COIN_FLIP_STREAK_SCAN_LIMIT)

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
            "streak": _coin_flip_streaks(recent_rows),
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
