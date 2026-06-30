from __future__ import annotations

"""
Game Pass season document in game_settings (key `game_pass_season`).

Ops: bump `season_id` when starting a new pass season (admin POST includes optional season_id).
Users reconcile lazily on auth hot paths: season RP resets, pass cursors clear, and prior VIP token
state is cleared so the pass must be purchased again for the new season.

When `season_end_at` passes, `get_game_pass_season_public` auto-rolls to the next season_id and
extends `season_end_at` by one calendar month (same wall-clock time). Purchases reopen until the
final 7-day window before the new end.
"""

import calendar
from datetime import datetime, timezone
from typing import Any, Dict, Optional

GAME_PASS_SEASON_SETTINGS_KEY = "game_pass_season"
# Fallback when DB unset (season #2 end — 15:00 BST)
DEFAULT_GAME_PASS_SEASON_END_AT = "2026-07-01T14:00:00+00:00"


def _parse_iso_utc(v: Any) -> Optional[datetime]:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _add_calendar_months(dt: datetime, months: int = 1) -> datetime:
    """Add calendar months in UTC (e.g. Jun 1 -> Jul 1)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    y = dt.year + (dt.month - 1 + months) // 12
    m = (dt.month - 1 + months) % 12 + 1
    last_day = calendar.monthrange(y, m)[1]
    d = min(dt.day, last_day)
    return dt.replace(year=y, month=m, day=d)


def normalize_game_pass_season_end_at(v: Any) -> str:
    dt = _parse_iso_utc(v)
    if not dt:
        return DEFAULT_GAME_PASS_SEASON_END_AT
    return dt.isoformat()


def game_pass_season_id_from_stored(stored: Dict[str, Any]) -> str:
    """Monotonic/string id; bump in admin when starting a new pass season."""
    raw = stored.get("season_id")
    if raw is None or raw == "":
        return "1"
    return str(raw)


def _next_season_id(current: str) -> str:
    s = str(current or "").strip() or "1"
    try:
        return str(int(s) + 1)
    except ValueError:
        return f"{s}_next"


async def _persist_game_pass_season(db, stored: Dict[str, Any]) -> None:
    await db.game_settings.update_one(
        {"key": GAME_PASS_SEASON_SETTINGS_KEY},
        {"$set": {"key": GAME_PASS_SEASON_SETTINGS_KEY, "value": stored}},
        upsert=True,
    )


async def _apply_season_rollover_if_due(db, stored: Dict[str, Any]) -> Dict[str, Any]:
    """When global season end has passed, bump season_id and schedule the next month."""
    now = datetime.now(timezone.utc)
    season_end_at = normalize_game_pass_season_end_at(stored.get("season_end_at"))
    season_end_dt = _parse_iso_utc(season_end_at)
    if not season_end_dt or now < season_end_dt:
        return stored

    season_id = game_pass_season_id_from_stored(stored)
    next_id = _next_season_id(season_id)
    new_end = _add_calendar_months(season_end_dt, 1)
    new_stored = {
        **stored,
        "season_id": next_id,
        "season_end_at": new_end.isoformat(),
        "set_by": "season_auto_rollover",
        "set_at": now.isoformat(),
        "previous_season_id": season_id,
        "previous_season_end_at": season_end_at,
    }
    await _persist_game_pass_season(db, new_stored)
    return new_stored


async def get_game_pass_season_public(db) -> Dict[str, Any]:
    doc = await db.game_settings.find_one({"key": GAME_PASS_SEASON_SETTINGS_KEY}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value")
    stored = raw if isinstance(raw, dict) else {}
    season_end_at = normalize_game_pass_season_end_at(stored.get("season_end_at"))
    season_id = game_pass_season_id_from_stored(stored)
    now = datetime.now(timezone.utc)
    season_end_dt = _parse_iso_utc(season_end_at)

    # One-time retail roll: legacy season "1" -> "2" while season #1 is still active.
    if str(season_id).strip() == "1" and season_end_dt and now < season_end_dt:
        now_iso = now.isoformat()
        new_stored = {
            **stored,
            "season_id": "2",
            "season_end_at": season_end_at,
            "set_by": "season_auto_bump",
            "set_at": now_iso,
        }
        await _persist_game_pass_season(db, new_stored)
        stored = new_stored
        season_id = "2"
        season_end_at = normalize_game_pass_season_end_at(stored.get("season_end_at"))

    stored = await _apply_season_rollover_if_due(db, stored)
    season_id = game_pass_season_id_from_stored(stored)
    season_end_at = normalize_game_pass_season_end_at(stored.get("season_end_at"))

    return {
        "game_pass_season_end_at": season_end_at,
        "game_pass_season_id": season_id,
        "stored": stored,
    }
