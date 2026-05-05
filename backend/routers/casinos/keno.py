# Casino Keno: always state-owned (house pays). 80 spots, draw 20; server RNG and paytable only.
from __future__ import annotations

import secrets
from typing import Any

from pydantic import BaseModel
from fastapi import Depends, HTTPException

from server import (
    db,
    get_current_user_verified,
    STATES,
    log_gambling,
    get_head_family_id_for_state,
    state_head_casino_treasury_share,
)
from utils.keno_settings import DEFAULT_KENO_MAX_BET, load_keno_max_bet

_rng = secrets.SystemRandom()

KENO_MIN_PICK = 2
KENO_MAX_PICK = 10
# Default when no `game_settings` row; live cap from `load_keno_max_bet`.
KENO_MAX_BET = DEFAULT_KENO_MAX_BET
KENO_BOARD_MIN = 1
KENO_BOARD_MAX = 80
KENO_DRAW_COUNT = 20
# Total haircut on nominal wins (player gets int(nominal * (1 - KENO_TOTAL_HOUSE_EDGE))).
# State head treasury credit uses state_head_casino_treasury_share() (same as other casinos).
KENO_TOTAL_HOUSE_EDGE = 0.0005  # 0.05% — public / player-facing; do not advertise treasury split

# Nominal multipliers (× bet) before house edge. Missing hit counts pay 0.
# Top jackpot capped at 1000× (10/10); other pick counts scaled with similar step-ups toward their row max.
KENO_PAYTABLE: dict[int, dict[int, int]] = {
    2: {2: 8},
    3: {2: 2, 3: 18},
    4: {2: 1, 3: 4, 4: 35},
    5: {3: 2, 4: 7, 5: 90},
    6: {3: 1, 4: 4, 5: 18, 6: 180},
    7: {4: 2, 5: 8, 6: 28, 7: 320},
    8: {5: 4, 6: 12, 7: 38, 8: 220},
    9: {5: 3, 6: 9, 7: 30, 8: 85, 9: 450},
    10: {5: 2, 6: 5, 7: 14, 8: 35, 9: 110, 10: 1000},
}


def _normalize_state(state_raw: str) -> str:
    if not (state_raw or "").strip():
        return STATES[0] if STATES else ""
    s = (state_raw or "").strip()
    for st in STATES or []:
        if st and s.lower() == st.lower():
            return st
    return STATES[0] if STATES else s


def _nominal_multiplier(n_spots: int, hits: int) -> int:
    row = KENO_PAYTABLE.get(n_spots) or {}
    return int(row.get(hits, 0))


def _payout_after_edge(bet: int, n_spots: int, hits: int) -> tuple[int, int]:
    """(payout_to_player, nominal_gross) nominal_gross = bet * mult before edge."""
    mult = _nominal_multiplier(n_spots, hits)
    nominal = bet * mult
    if nominal <= 0:
        return 0, 0
    return max(0, int(nominal * (1.0 - KENO_TOTAL_HOUSE_EDGE))), nominal


def _paytable_for_config() -> dict[str, Any]:
    """Expose multipliers to the client for display only."""
    out: dict[str, Any] = {}
    for n in range(KENO_MIN_PICK, KENO_MAX_PICK + 1):
        row = KENO_PAYTABLE.get(n, {})
        out[str(n)] = {str(k): v for k, v in sorted(row.items())}
    return out


class KenoPlayRequest(BaseModel):
    bet: int
    picks: list[int]


def register(router):
    @router.get("/casino/keno/config")
    async def casino_keno_config(current_user: dict = Depends(get_current_user_verified)):
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        current_state = _normalize_state(raw) if raw else (STATES[0] if STATES else "")
        max_bet = await load_keno_max_bet(db)
        return {
            "states": list(STATES or []),
            "current_state": current_state,
            "min_pick": KENO_MIN_PICK,
            "max_pick": KENO_MAX_PICK,
            "max_bet": max_bet,
            "board_min": KENO_BOARD_MIN,
            "board_max": KENO_BOARD_MAX,
            "draw_count": KENO_DRAW_COUNT,
            "house_edge": KENO_TOTAL_HOUSE_EDGE,
            "paytable": _paytable_for_config(),
            "state_owned": True,
        }

    @router.post("/casino/keno/play")
    async def casino_keno_play(request: KenoPlayRequest, current_user: dict = Depends(get_current_user_verified)):
        """Single round: debit, server draw 20 from 80, credit net win, house skim to state head."""
        raw = (current_user.get("current_state") or (STATES[0] if STATES else "") or "").strip()
        state = _normalize_state(raw) if raw else (STATES[0] if STATES else "")
        if state not in (STATES or []):
            raise HTTPException(status_code=400, detail="Invalid state")

        bet = int(request.bet or 0)
        if bet < 1:
            raise HTTPException(status_code=400, detail="Bet must be at least 1")
        max_bet = await load_keno_max_bet(db)
        if bet > max_bet:
            raise HTTPException(status_code=400, detail=f"Max bet is ${max_bet:,}")

        picks_raw = request.picks or []
        if len(picks_raw) < KENO_MIN_PICK or len(picks_raw) > KENO_MAX_PICK:
            raise HTTPException(
                status_code=400,
                detail=f"Pick between {KENO_MIN_PICK} and {KENO_MAX_PICK} numbers",
            )
        try:
            picks_int = [int(x) for x in picks_raw]
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid picks")
        if len(set(picks_int)) != len(picks_int):
            raise HTTPException(status_code=400, detail="Duplicate picks are not allowed")
        for p in picks_int:
            if p < KENO_BOARD_MIN or p > KENO_BOARD_MAX:
                raise HTTPException(
                    status_code=400,
                    detail=f"Each pick must be between {KENO_BOARD_MIN} and {KENO_BOARD_MAX}",
                )

        picks_sorted = sorted(picks_int)
        n_spots = len(picks_sorted)

        debit_res = await db.users.find_one_and_update(
            {"id": current_user.get("id") or "", "money": {"$gte": bet}},
            {"$inc": {"money": -bet}},
            return_document=False,
        )
        if not debit_res:
            raise HTTPException(status_code=400, detail="Insufficient cash")
        # find_one_and_update returns the document before the update (Motor/PyMongo default).
        user_money_before = int((debit_res.get("money") or 0) or 0)

        pool = list(range(KENO_BOARD_MIN, KENO_BOARD_MAX + 1))
        drawn = sorted(_rng.sample(pool, KENO_DRAW_COUNT))
        pick_set = set(picks_sorted)
        hits = len(pick_set.intersection(drawn))

        payout_full, nominal_gross = _payout_after_edge(bet, n_spots, hits)
        win = payout_full > 0

        head_family_id = await get_head_family_id_for_state(state) if state else None

        if win:
            whole_skim = int(nominal_gross * KENO_TOTAL_HOUSE_EDGE)
            house_cut = state_head_casino_treasury_share(whole_skim) if head_family_id else 0
            if house_cut > 0:
                await db.families.update_one(
                    {"id": head_family_id},
                    {"$inc": {"treasury": house_cut, "state_head_income.keno": house_cut}},
                )
            await db.users.update_one({"id": current_user.get("id") or ""}, {"$inc": {"money": payout_full}})
        else:
            if head_family_id:
                whole_lose = int(bet * KENO_TOTAL_HOUSE_EDGE)
                edge_lose = state_head_casino_treasury_share(whole_lose)
                if edge_lose > 0:
                    await db.families.update_one(
                        {"id": head_family_id},
                        {"$inc": {"treasury": edge_lose, "state_head_income.keno": edge_lose}},
                    )

        new_balance = user_money_before - bet + payout_full

        await log_gambling(
            current_user.get("id") or "",
            current_user.get("username") or "?",
            "keno",
            {
                "state": state,
                "bet": bet,
                "picks": picks_sorted,
                "drawn": drawn,
                "hits": hits,
                "payout": payout_full,
                "nominal_gross": nominal_gross,
                "state_owned": True,
                "house_edge_total": KENO_TOTAL_HOUSE_EDGE,
                "state_head_cut": state_head_casino_treasury_share(int(nominal_gross * KENO_TOTAL_HOUSE_EDGE))
                if win
                else state_head_casino_treasury_share(int(bet * KENO_TOTAL_HOUSE_EDGE)),
            },
        )

        return {
            "picks": picks_sorted,
            "drawn": drawn,
            "hits": hits,
            "bet": bet,
            "payout": payout_full,
            "won": win,
            "new_balance": new_balance,
        }
