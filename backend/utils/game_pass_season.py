from __future__ import annotations

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


async def get_game_pass_season_public(db) -> Dict[str, Any]:
    doc = await db.game_settings.find_one({"key": GAME_PASS_SEASON_SETTINGS_KEY}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value")
    stored = raw if isinstance(raw, dict) else {}
    season_end_at = normalize_game_pass_season_end_at(stored.get("season_end_at"))
    return {
        "game_pass_season_end_at": season_end_at,
        "stored": stored,
    }
