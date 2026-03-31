"""Release soft-launch: optional pre-unlock window (game_settings key `release_soft_launch`).

- `game_pass_unlock_at`: Game Pass / points-economy checkout (aligned with points store going live).
- `pvp_kills_unlock_at`: player vs player kills (defaults to `game_pass_unlock_at` if omitted — legacy single-clock).

While `enabled` and before each respective time, that feature stays off. Hitlist NPCs are unaffected.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

RELEASE_SOFT_LAUNCH_KEY = "release_soft_launch"
DEFAULT_GAME_PASS_UNLOCK_AT = "2026-04-04T17:00:00+00:00"


def _parse_iso_utc(s: Optional[str]) -> Optional[datetime]:
    if not s or not isinstance(s, str):
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


async def get_release_soft_launch_public(db) -> Dict[str, Any]:
    doc = await db.game_settings.find_one({"key": RELEASE_SOFT_LAUNCH_KEY}, {"_id": 0, "value": 1})
    raw = (doc or {}).get("value")
    val: Dict[str, Any] = raw if isinstance(raw, dict) else {}
    enabled = bool(val.get("enabled"))
    game_pass_unlock_at = val.get("game_pass_unlock_at")
    if not isinstance(game_pass_unlock_at, str) or not game_pass_unlock_at.strip():
        game_pass_unlock_at = DEFAULT_GAME_PASS_UNLOCK_AT
    pvp_kills_unlock_at = val.get("pvp_kills_unlock_at")
    if not isinstance(pvp_kills_unlock_at, str) or not pvp_kills_unlock_at.strip():
        pvp_kills_unlock_at = game_pass_unlock_at
    now = datetime.now(timezone.utc)
    gp_dt = _parse_iso_utc(game_pass_unlock_at)
    pvp_dt = _parse_iso_utc(pvp_kills_unlock_at)
    gp_ok = gp_dt is not None and now >= gp_dt
    pvp_ok = pvp_dt is not None and now >= pvp_dt
    game_pass_purchase_locked = enabled and not gp_ok
    pvp_kills_disabled = enabled and not pvp_ok
    return {
        "release_soft_launch_enabled": enabled,
        "pvp_kills_disabled": pvp_kills_disabled,
        "game_pass_purchase_locked": game_pass_purchase_locked,
        "game_pass_unlock_at": game_pass_unlock_at,
        "pvp_kills_unlock_at": pvp_kills_unlock_at,
    }


def game_pass_purchase_locked_detail(state: Dict[str, Any]) -> str:
    unlock = state.get("game_pass_unlock_at") or DEFAULT_GAME_PASS_UNLOCK_AT
    return (
        f"Game Pass is not available for purchase until the points-store unlock time ({unlock} UTC). "
        "This applies while release soft-launch mode is on."
    )


PVP_KILLS_DISABLED_DETAIL = (
    "Player vs player kills are paused until the PvP unlock time. "
    "You can still search for and attack hitlist NPCs."
)


async def soft_launch_blocks_pvp_kill_on_target(db, target: Optional[dict]) -> bool:
    if not target or target.get("is_npc"):
        return False
    state = await get_release_soft_launch_public(db)
    return bool(state.get("pvp_kills_disabled"))
