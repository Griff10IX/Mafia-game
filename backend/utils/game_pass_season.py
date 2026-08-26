from __future__ import annotations

"""
Game Pass season document in game_settings (key `game_pass_season`).

Ops: bump `season_id` when starting a new pass season (admin POST includes optional season_id).
Users reconcile lazily on auth hot paths: season RP resets, pass cursors clear, and prior VIP token
state is cleared so the pass must be purchased again for the new season.

When `season_end_at` passes, `get_game_pass_season_public` auto-rolls to the next season_id and
extends `season_end_at` to 00:00 UK on the 1st of the following calendar month. Purchases reopen
until the final 7-day window before the new end.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

GAME_PASS_SEASON_SETTINGS_KEY = "game_pass_season"
FORCE_VIP_SEASON_4_SEPT_2026_KEY = "game_pass_force_season_4_sept_2026_v1"
TARGET_VIP_SEASON_ID = "4"
UK_TZ = ZoneInfo("Europe/London")


def uk_midnight_first_of_month(year: int, month: int) -> datetime:
    """00:00 UK on the 1st of the given month, returned as UTC-aware datetime."""
    local = datetime(year, month, 1, 0, 0, 0, tzinfo=UK_TZ)
    return local.astimezone(timezone.utc)


def _default_season_end_dt() -> datetime:
    """Fallback when DB unset — 1 Sep 2026 00:00 UK (new VIP season boundary)."""
    return uk_midnight_first_of_month(2026, 9)


DEFAULT_GAME_PASS_SEASON_END_AT = _default_season_end_dt().isoformat()


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


def _migrate_legacy_season_end_to_uk_midnight(dt: datetime) -> datetime:
    """
    Convert legacy boundaries stored as 14:00 UTC (15:00 BST) on the 1st
    to 00:00 UK on that calendar month.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if dt.day == 1 and dt.hour == 14 and dt.minute == 0 and dt.second == 0:
        uk = dt.astimezone(UK_TZ)
        return uk_midnight_first_of_month(uk.year, uk.month)
    return dt


def normalize_game_pass_season_end_at(v: Any) -> str:
    """
    Normalize season end to 00:00 UK on the 1st of the target month (UTC stored).
    """
    dt = _parse_iso_utc(v)
    if not dt:
        return DEFAULT_GAME_PASS_SEASON_END_AT
    dt = _migrate_legacy_season_end_to_uk_midnight(dt)
    uk = dt.astimezone(UK_TZ)
    dt = uk_midnight_first_of_month(uk.year, uk.month)
    return dt.isoformat()


def next_season_end_uk_midnight(current_end_utc: datetime) -> datetime:
    """Following calendar month, 00:00 UK on the 1st."""
    if current_end_utc.tzinfo is None:
        current_end_utc = current_end_utc.replace(tzinfo=timezone.utc)
    uk = current_end_utc.astimezone(UK_TZ)
    y, m = uk.year, uk.month + 1
    if m > 12:
        y += 1
        m = 1
    return uk_midnight_first_of_month(y, m)


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


async def _maybe_fixup_stored_season_end(db, stored: Dict[str, Any]) -> Dict[str, Any]:
    """One-time/read-path fix: snap stored end to UK midnight and migrate legacy 15:00 BST."""
    raw = stored.get("season_end_at")
    fixed = normalize_game_pass_season_end_at(raw)
    if str(raw or "").strip() == fixed:
        return stored
    now = datetime.now(timezone.utc)
    new_stored = {
        **stored,
        "season_end_at": fixed,
        "set_by": "season_end_uk_midnight_fixup",
        "set_at": now.isoformat(),
        "previous_season_end_at": str(raw or ""),
    }
    await _persist_game_pass_season(db, new_stored)
    return new_stored


async def _apply_season_rollover_if_due(db, stored: Dict[str, Any]) -> Dict[str, Any]:
    """When global season end has passed, bump season_id and schedule the next month."""
    now = datetime.now(timezone.utc)
    season_end_at = normalize_game_pass_season_end_at(stored.get("season_end_at"))
    season_end_dt = _parse_iso_utc(season_end_at)
    if not season_end_dt or now < season_end_dt:
        return stored

    season_id = game_pass_season_id_from_stored(stored)
    next_id = _next_season_id(season_id)
    new_end = next_season_end_uk_midnight(season_end_dt)
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
    try:
        from utils.game_pass_season_rp import reconcile_all_stale_game_pass_users

        cleared = await reconcile_all_stale_game_pass_users(db)
        new_stored = {**new_stored, "players_reconciled_on_rollover": cleared}
        await _persist_game_pass_season(db, new_stored)
    except Exception:
        pass
    return new_stored


async def maybe_force_vip_season_4_sept_2026_once(db) -> Optional[Dict[str, Any]]:
    """
    One-shot ops: put season 4 live through 1 Sep 2026 00:00 UK and clear prior VIP
    so everyone must repurchase (even if season_id was already 4 with old end/VIP still on).
    """
    doc = await db.game_settings.find_one(
        {"key": FORCE_VIP_SEASON_4_SEPT_2026_KEY},
        {"_id": 0, "value": 1},
    )
    raw = (doc or {}).get("value")
    if isinstance(raw, dict) and raw.get("done_at"):
        return None

    prev_doc = await db.game_settings.find_one(
        {"key": GAME_PASS_SEASON_SETTINGS_KEY},
        {"_id": 0, "value": 1},
    )
    prev_raw = (prev_doc or {}).get("value")
    prev_val = prev_raw if isinstance(prev_raw, dict) else {}
    prev_sid = str(prev_val.get("season_id") or "").strip() or None
    try:
        if prev_sid and int(prev_sid) > int(TARGET_VIP_SEASON_ID):
            return None
    except ValueError:
        pass

    now = datetime.now(timezone.utc)
    prev_end = str(prev_val.get("season_end_at") or "")

    new_end = uk_midnight_first_of_month(2026, 9).isoformat()
    new_stored = {
        "season_id": TARGET_VIP_SEASON_ID,
        "season_end_at": new_end,
        "set_by": "force_season_4_sept_2026_v1",
        "set_at": now.isoformat(),
        "previous_season_id": prev_sid,
        "previous_season_end_at": prev_end,
    }
    await _persist_game_pass_season(db, new_stored)

    from utils.game_pass_season_rp import force_reconcile_all_users_to_season

    # Force wipe even when players already have game_pass_season_id == "4"
    # (partial cutover left VIP claimed with old Aug end).
    players_reconciled = await force_reconcile_all_users_to_season(db, TARGET_VIP_SEASON_ID)
    stamp = {
        "done_at": now.isoformat(),
        "set_by": "force_season_4_sept_2026_v1",
        "season_id": TARGET_VIP_SEASON_ID,
        "season_end_at": new_end,
        "players_reconciled": players_reconciled,
        "previous_season_id": prev_sid,
        "previous_season_end_at": prev_end,
    }
    await db.game_settings.update_one(
        {"key": FORCE_VIP_SEASON_4_SEPT_2026_KEY},
        {"$set": {"key": FORCE_VIP_SEASON_4_SEPT_2026_KEY, "value": stamp}},
        upsert=True,
    )
    return stamp


async def get_game_pass_season_public(db) -> Dict[str, Any]:
    try:
        await maybe_force_vip_season_4_sept_2026_once(db)
    except Exception:
        pass

    doc = await db.game_settings.find_one({"key": GAME_PASS_SEASON_SETTINGS_KEY}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value")
    stored = raw if isinstance(raw, dict) else {}
    stored = await _maybe_fixup_stored_season_end(db, stored)
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

    try:
        from utils.game_pass_weed_strains import maybe_revoke_premature_game_pass_strains_once

        await maybe_revoke_premature_game_pass_strains_once(db)
    except Exception:
        pass

    return {
        "game_pass_season_end_at": season_end_at,
        "game_pass_season_id": season_id,
        "stored": stored,
    }
