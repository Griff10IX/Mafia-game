"""Cooldown skip voucher credits (store tokens)."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple

COOLDOWN_SKIP_DAILY_CAP = 200  # default per skip type per UTC day
COOLDOWN_SKIP_DAILY_CAPS = {
    "crime": 5_000,  # crime cooldowns are short, so far more skips fit in a day
    "gta": 1_000,
    "properties": 3,  # property collects are big payouts, keep skips scarce
}

# After spending one properties skip credit, all property collects may bypass cooldown
# for this window (so Skip Collect All = 1 token for every business, up to 3×/day).
PROPERTIES_SKIP_SWEEP_SECONDS = 120
PROPERTIES_SKIP_SWEEP_FIELD = "cooldown_skip_properties_sweep_until"


def cooldown_skip_daily_cap(kind: str) -> int:
    return COOLDOWN_SKIP_DAILY_CAPS.get(kind, COOLDOWN_SKIP_DAILY_CAP)

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


def _uses_field(kind: str) -> str:
    return f"cooldown_skip_uses_today_{kind}"


def cooldown_skip_uses_today(user: dict, kind: str) -> int:
    if user.get("cooldown_skip_day") != _utc_today():
        return 0
    return int(user.get(_uses_field(kind)) or 0)


def can_activate_cooldown_skip_token(user: dict, kind: str) -> bool:
    return cooldown_skip_uses_today(user, kind) < cooldown_skip_daily_cap(kind)


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


def _parse_sweep_until(raw) -> Optional[datetime]:
    if not raw:
        return None
    try:
        if isinstance(raw, datetime):
            dt = raw
        else:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def properties_skip_sweep_active(user: dict, now: Optional[datetime] = None) -> bool:
    """True if a recent properties skip still covers all businesses (Skip Collect All)."""
    now = now or datetime.now(timezone.utc)
    until = _parse_sweep_until((user or {}).get(PROPERTIES_SKIP_SWEEP_FIELD))
    return bool(until and until > now)


async def allow_properties_collect_skip(db, user: dict, user_id: str, now: Optional[datetime] = None) -> bool:
    """
    Bypass property collect cooldown once per skip use for ALL businesses briefly.

    - Active sweep → allow (no extra credit / daily use).
    - Else consume one properties credit and open a short sweep window.
    """
    now = now or datetime.now(timezone.utc)
    if properties_skip_sweep_active(user, now):
        return True
    if not has_skip_credit(user, "properties"):
        return False
    if not await consume_skip_credit(db, user_id, "properties"):
        return False
    until = (now + timedelta(seconds=PROPERTIES_SKIP_SWEEP_SECONDS)).isoformat()
    await db.users.update_one(
        {"id": user_id},
        {"$set": {PROPERTIES_SKIP_SWEEP_FIELD: until}},
    )
    return True


def activation_inc_fields(kind: str, user: dict) -> Tuple[dict, dict]:
    """Return ($inc, extra $set) for activating one skip token.

    Daily usage is tracked per skip type (see cooldown_skip_daily_cap). A field may appear in $inc or
    $set but never both (Mongo rejects path conflicts), so on day rollover all per-type
    counters are reset via $set only.
    """
    today = _utc_today()
    inc = {skip_credit_field(kind): 1}
    set_doc = {"cooldown_skip_day": today}
    if user.get("cooldown_skip_day") != today:
        for k in SKIP_CREDIT_FIELDS:
            set_doc[_uses_field(k)] = 1 if k == kind else 0
    else:
        inc[_uses_field(kind)] = 1
    return inc, set_doc
