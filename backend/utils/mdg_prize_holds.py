"""MDG admin prize holds: reserve unowned airport / armoury / casino until the game settles."""
from __future__ import annotations

from typing import Any, Optional

MDG_PRIZE_HOLD_OWNER_PREFIX = "mdg:"
MDG_PRIZE_HOLD_DISPLAY_NAME = "MDG Prize"


def mdg_prize_hold_owner_id(game_id: str) -> str:
    return f"{MDG_PRIZE_HOLD_OWNER_PREFIX}{game_id}"


def is_mdg_prize_hold_owner(owner_id: Any) -> bool:
    if owner_id is None:
        return False
    s = str(owner_id).strip()
    return bool(s.startswith(MDG_PRIZE_HOLD_OWNER_PREFIX))


def casino_economy_owner_id(owner_id: Any) -> Optional[str]:
    """Owner id for wagering/payouts. MDG prize holds play as unowned (house bank, min max bet)."""
    if owner_id is None:
        return None
    s = str(owner_id).strip()
    if not s or is_mdg_prize_hold_owner(s):
        return None
    return s


def mongo_unowned_owner_clause() -> dict:
    return {
        "$or": [
            {"owner_id": None},
            {"owner_id": ""},
            {"owner_id": {"$exists": False}},
        ]
    }
