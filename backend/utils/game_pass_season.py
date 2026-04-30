from __future__ import annotations

"""
Game Pass season document in game_settings (key `game_pass_season`).

Ops: bump `season_id` when starting a new pass season (admin POST includes optional season_id).
Users reconcile lazily on auth hot paths: season RP resets, pass cursors clear, and prior VIP token
state is cleared so the pass must be purchased again for the new season.

Retail: `get_game_pass_season_public` bumps legacy stored `season_id` "1" -> "2" once on read so
deployments pick up the new season without a manual admin edit (subsequent seasons still use admin).
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional

GAME_PASS_SEASON_SETTINGS_KEY = "game_pass_season"
DEFAULT_GAME_PASS_SEASON_END_AT = "2026-05-01T14:00:00+00:00"  # 15:00 BST


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


async def get_game_pass_season_public(db) -> Dict[str, Any]:
    doc = await db.game_settings.find_one({"key": GAME_PASS_SEASON_SETTINGS_KEY}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value")
    stored = raw if isinstance(raw, dict) else {}
    season_end_at = normalize_game_pass_season_end_at(stored.get("season_end_at"))
    season_id = game_pass_season_id_from_stored(stored)

    # One-time retail roll: legacy season "1" -> "2" invalidates old entitlements via reconcile.
    if str(season_id).strip() == "1":
        now_iso = datetime.now(timezone.utc).isoformat()
        new_stored = {
            **stored,
            "season_id": "2",
            "season_end_at": season_end_at,
            "set_by": "season_auto_bump",
            "set_at": now_iso,
        }
        await db.game_settings.update_one(
            {"key": GAME_PASS_SEASON_SETTINGS_KEY},
            {"$set": {"key": GAME_PASS_SEASON_SETTINGS_KEY, "value": new_stored}},
            upsert=True,
        )
        stored = new_stored
        season_id = "2"

    return {
        "game_pass_season_end_at": season_end_at,
        "game_pass_season_id": season_id,
        "stored": stored,
    }
