"""Per-item rollout flags for new store purchases (default disabled; staff can test)."""
from __future__ import annotations

from typing import Any, Dict, Optional

STORE_ITEM_FLAG_DEFAULTS: Dict[str, bool] = {
    "auto_collect": False,
    "jail_bailout": False,
    "cooldown_skip_crime": False,
    "cooldown_skip_gta": False,
    "cooldown_skip_booze": False,
    "cooldown_skip_properties": False,
    "profile_badge": False,
    "profile_glow_7d": False,
    "profile_glow_permanent": False,
    "family_crest_upgrade": False,
    "crew_oc_insurance": False,
    "family_safe_deposit": False,
    "family_event_token": False,
}

PHASE1_STORE_ITEM_FLAGS = (
    "auto_collect",
    "jail_bailout",
    "cooldown_skip_crime",
    "cooldown_skip_gta",
    "cooldown_skip_booze",
    "cooldown_skip_properties",
)

TOKEN_TYPE_TO_STORE_FLAG: Dict[str, str] = {
    "auto_collect_12h": "auto_collect",
    "auto_collect_24h": "auto_collect",
    "jail_bailout": "jail_bailout",
    "cooldown_skip_crime": "cooldown_skip_crime",
    "cooldown_skip_gta": "cooldown_skip_gta",
    "cooldown_skip_booze": "cooldown_skip_booze",
    "cooldown_skip_properties": "cooldown_skip_properties",
}


def _is_staff(user: Optional[dict]) -> bool:
    """True for admins/mods who may test store items while flags are off."""
    if not user:
        return False
    # Prefer server helpers (admin = ADMIN_EMAILS; mod = DB flag / MOD_EMAILS).
    try:
        import server as srv

        if getattr(srv, "_is_admin", lambda _u: False)(user):
            return True
        if getattr(srv, "_is_moderator", lambda _u: False)(user):
            return True
        if getattr(srv, "user_has_admin_list_email", lambda _u: False)(user):
            return True
    except Exception:
        pass
    return bool(user.get("is_admin") or user.get("is_moderator"))


def normalize_store_item_flags(raw: Any) -> Dict[str, bool]:
    out = dict(STORE_ITEM_FLAG_DEFAULTS)
    if isinstance(raw, dict):
        for k in STORE_ITEM_FLAG_DEFAULTS:
            if k in raw:
                out[k] = bool(raw[k])
    return out


async def get_store_item_flags(db) -> Dict[str, bool]:
    doc = await db.game_settings.find_one({"_id": "main"}, {"_id": 0, "store_item_flags": 1})
    return normalize_store_item_flags((doc or {}).get("store_item_flags"))


def store_item_enabled(flags: Dict[str, bool], item_id: str) -> bool:
    return bool(flags.get(item_id))


def store_item_allowed(flags: Dict[str, bool], item_id: str, user: Optional[dict]) -> bool:
    if store_item_enabled(flags, item_id):
        return True
    return _is_staff(user)


async def require_store_item_allowed(db, item_id: str, user: dict) -> None:
    from fastapi import HTTPException

    flags = await get_store_item_flags(db)
    if not store_item_allowed(flags, item_id, user):
        raise HTTPException(status_code=403, detail="Not available yet")


def store_flag_for_token_type(token_type: str) -> Optional[str]:
    return TOKEN_TYPE_TO_STORE_FLAG.get((token_type or "").strip())
