"""Profile cosmetic store items (badge, glow, border)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

CUSTOM_PROFILE_BADGE = "Custom Profile Badge"
CUSTOM_PROFILE_BADGE_COST_POINTS = 750
PROFILE_GLOW_7D_COST_POINTS = 120
PROFILE_GLOW_PERMANENT_COST_POINTS = 800
# Small badge icon (data URL length); keep well under avatar limits.
CUSTOM_BADGE_MAX_DATA_URL_BYTES = int(0.35 * 1024 * 1024)

# Keep ids/colors in sync with src/constants/profileGlowPresets.js
PROFILE_GLOW_PRESETS = (
    {"id": "violet", "color": "#a78bfa", "border": "violet"},
    {"id": "purple", "color": "#c084fc", "border": "purple"},
    {"id": "fuchsia", "color": "#e879f9", "border": "fuchsia"},
    {"id": "pink", "color": "#f472b6", "border": "pink"},
    {"id": "rose", "color": "#fb7185", "border": "rose"},
    {"id": "red", "color": "#f87171", "border": "red"},
    {"id": "blood", "color": "#dc2626", "border": "blood"},
    {"id": "orange", "color": "#fb923c", "border": "orange"},
    {"id": "copper", "color": "#d97706", "border": "copper"},
    {"id": "gold", "color": "#fbbf24", "border": "gold"},
    {"id": "yellow", "color": "#facc15", "border": "yellow"},
    {"id": "lime", "color": "#a3e635", "border": "lime"},
    {"id": "green", "color": "#4ade80", "border": "green"},
    {"id": "emerald", "color": "#34d399", "border": "emerald"},
    {"id": "teal", "color": "#2dd4bf", "border": "teal"},
    {"id": "cyan", "color": "#22d3ee", "border": "cyan"},
    {"id": "sky", "color": "#38bdf8", "border": "sky"},
    {"id": "blue", "color": "#60a5fa", "border": "blue"},
    {"id": "indigo", "color": "#818cf8", "border": "indigo"},
    {"id": "silver", "color": "#d1d5db", "border": "silver"},
    {"id": "steel", "color": "#94a3b8", "border": "steel"},
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def user_has_custom_profile_badge(user: Optional[dict]) -> bool:
    if not user:
        return False
    if user.get("custom_profile_badge"):
        return True
    badges = user.get("badges")
    return isinstance(badges, list) and CUSTOM_PROFILE_BADGE in badges


def custom_profile_badge_image_url(user: Optional[dict]) -> Optional[str]:
    if not user_has_custom_profile_badge(user):
        return None
    url = (user.get("custom_profile_badge_url") or "").strip()
    return url or None


def profile_cosmetic_active(user: Optional[dict]) -> bool:
    if not user:
        return False
    if user.get("profile_cosmetic_permanent"):
        return True
    until = user.get("profile_cosmetic_until")
    if not until:
        return False
    try:
        dt = datetime.fromisoformat(str(until).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt > _now()
    except Exception:
        return False


def profile_cosmetic_public_fields(user: Optional[dict]) -> Dict[str, Any]:
    active = profile_cosmetic_active(user)
    has_badge = user_has_custom_profile_badge(user)
    return {
        "custom_profile_badge": has_badge,
        "custom_profile_badge_url": custom_profile_badge_image_url(user),
        "profile_cosmetic_active": active,
        "profile_name_glow_color": (user.get("profile_name_glow_color") or None) if active else None,
        "profile_border_style": (user.get("profile_border_style") or None) if active else None,
        "profile_cosmetic_until": user.get("profile_cosmetic_until") if not user.get("profile_cosmetic_permanent") else None,
        "profile_cosmetic_permanent": bool(user.get("profile_cosmetic_permanent")),
    }


def custom_profile_badge_strip_on_death_set() -> dict:
    return {"custom_profile_badge": False, "custom_profile_badge_url": None}


def custom_profile_badge_strip_on_death_pull() -> dict:
    return {"badges": CUSTOM_PROFILE_BADGE}


def sanitize_glow_preset(preset_id: Optional[str]) -> dict:
    pid = (preset_id or "violet").strip().lower()
    for p in PROFILE_GLOW_PRESETS:
        if p["id"] == pid:
            return p
    return PROFILE_GLOW_PRESETS[0]
