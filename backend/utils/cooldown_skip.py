"""Cooldown skip voucher credits (store tokens)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Tuple

COOLDOWN_SKIP_DAILY_CAP = 5

SKIP_CREDIT_FIELDS = {
    "crime": "cooldown_skip_crime_credits",
    "gta": "cooldown_skip_gta_credits",
    "booze": "cooldown_skip_booze_credits",
    "properties": "cooldown_skip_properties_credits",
}

TOKEN_TYPE_TO_SKIP_KIND = {
    "cooldown_skip_crime": "crime",
    "cooldown_skip_gta": "gta",
    "cooldown_skip_booze": "booze",
    "cooldown_skip_properties": "properties",
}


def _utc_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def cooldown_skip_uses_today(user: dict) -> int:
    if user.get("cooldown_skip_day") != _utc_today():
        return 0
    return int(user.get("cooldown_skip_uses_today") or 0)


def can_activate_cooldown_skip_token(user: dict) -> bool:
    return cooldown_skip_uses_today(user) < COOLDOWN_SKIP_DAILY_CAP


def skip_credit_field(kind: str) -> str:
    return SKIP_CREDIT_FIELDS[kind]


def has_skip_credit(user: dict, kind: str) -> bool:
    return int(user.get(skip_credit_field(kind)) or 0) > 0


async def consume_skip_credit(db, user_id: str, kind: str) -> bool:
    field = skip_credit_field(kind)
    r = await db.users.update_one(
        {"id": user_id, field: {"$gt": 0}},
        {"$inc": {field: -1}},
    )
    return r.modified_count == 1


def activation_inc_fields(kind: str, user: dict) -> Tuple[dict, dict]:
    """Return ($inc, extra $set) for activating one skip token.

    A field may appear in $inc or $set but never both (Mongo rejects path conflicts),
    so on day rollover the counter is reset via $set only.
    """
    today = _utc_today()
    inc = {skip_credit_field(kind): 1}
    set_doc = {"cooldown_skip_day": today}
    if user.get("cooldown_skip_day") != today:
        set_doc["cooldown_skip_uses_today"] = 1
    else:
        inc["cooldown_skip_uses_today"] = 1
    return inc, set_doc
