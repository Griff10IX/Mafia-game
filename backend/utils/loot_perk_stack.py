"""Shared 24h loot-style perk stacking (loot box + Game Pass tier grants)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict

PERK_DURATION_HOURS = 24
GTA_RARE_DROP_PERK_ATTEMPTS = 100


def stacked_perk_until(merged_set: Dict[str, Any], user: dict, field_name: str, now: datetime) -> str:
    """Return new expiry ISO for a time-based perk, stacking on existing if still active."""
    base_iso = merged_set.get(field_name) or user.get(field_name)
    if not base_iso:
        return (now + timedelta(hours=PERK_DURATION_HOURS)).isoformat()
    try:
        until = datetime.fromisoformat(str(base_iso).replace("Z", "+00:00"))
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        if until > now:
            return (until + timedelta(hours=PERK_DURATION_HOURS)).isoformat()
    except Exception:
        pass
    return (now + timedelta(hours=PERK_DURATION_HOURS)).isoformat()


_PERK_UNTIL_FIELD = {
    "property_income_10": "property_income_perk_until",
    "rp_10": "rp_perk_until",
    "jail_bust_10": "jail_bust_payout_perk_until",
    "airport_cost": "airport_cost_perk_until",
}


def apply_loot_style_perk_to_merged_set(
    merged_set: Dict[str, Any],
    user: dict,
    perk_type: str,
    *,
    now: datetime | None = None,
) -> None:
    """Mutate merged_set with $set values for one loot-style perk (stacking time perks or GTA attempts)."""
    now = now or datetime.now(timezone.utc)
    if perk_type == "gta_rare_100":
        prev = int(merged_set.get("gta_rare_drop_perk_attempts_remaining") or user.get("gta_rare_drop_perk_attempts_remaining") or 0)
        merged_set["gta_rare_drop_perk_attempts_remaining"] = prev + GTA_RARE_DROP_PERK_ATTEMPTS
        return
    field = _PERK_UNTIL_FIELD.get(perk_type)
    if field:
        merged_set[field] = stacked_perk_until(merged_set, user, field, now)
