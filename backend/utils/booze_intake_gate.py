"""Block all booze added to carrying when the user has paused intake (Account → Auto Rank)."""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

BOOZE_INTAKE_BLOCKED_DETAIL = (
    "All booze intake is blocked on your account. Turn off "
    "'Block all booze intake' in Account → Auto Rank to receive booze again."
)


def booze_intake_blocked(user: Optional[dict]) -> bool:
    return bool((user or {}).get("passive_booze_paused"))


def raise_if_booze_intake_blocked(user: dict) -> None:
    if booze_intake_blocked(user):
        raise HTTPException(status_code=400, detail=BOOZE_INTAKE_BLOCKED_DETAIL)
