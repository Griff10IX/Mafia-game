from __future__ import annotations

"""
Game Pass season document in game_settings (key `game_pass_season`).

Ops: bump `season_id` when starting a new pass season (admin POST includes optional season_id).
Users reconcile lazily on auth hot paths: `rank_xp_pass_season_rp` resets to 0 and pass cursors clear.
Prestige affects lifetime rank only unless you add a dedicated season carry field later.
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
    return {
        "game_pass_season_end_at": season_end_at,
        "game_pass_season_id": season_id,
        "stored": stored,
    }
