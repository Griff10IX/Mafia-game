"""Loot-style profile dossier background themes (own + equip separately)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# Catalog: hard-to-get themes (loot later). Image paths are public static assets.
# ?v= cache-bust when art is replaced.
# fit: width = natural-aspect banner (default); stretch = fill whole dossier.
# All theme bitmaps are dossier-banner aspect (~1024x931) so width-fit matches Orbit.
_THEME_ASSET_V = "20260921c"
PROFILE_BACKGROUND_THEMES: Dict[str, Dict[str, str]] = {
    "godfather": {
        "id": "godfather",
        "name": "Godfather 1 — Legacy",
        "image": f"/images/profile-themes/godfather-v2.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
    },
    "godfather_empire": {
        "id": "godfather_empire",
        "name": "Godfather 2 — Empire",
        "image": f"/images/profile-themes/godfather-empire-v2.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
    },
    "halloween_heist": {
        "id": "halloween_heist",
        "name": "Halloween Heist",
        "image": f"/images/profile-themes/halloween-heist-v2.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
    },
    "ronin_fuji": {
        "id": "ronin_fuji",
        "name": "Ronin Fuji",
        "image": f"/images/profile-themes/ronin-fuji-v2.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
    },
    "london_snow": {
        "id": "london_snow",
        "name": "London Snow",
        "image": f"/images/profile-themes/london-snow-v2.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
    },
    "orbit_overlook": {
        "id": "orbit_overlook",
        "name": "Orbit Overlook",
        "image": f"/images/profile-themes/orbit-overlook-v2.jpg?v={_THEME_ASSET_V}",
        "fit": "width",
    },
}

OWNED_FIELD = "profile_background_themes_owned"
EQUIPPED_FIELD = "profile_background_theme_id"

# Stable edit-profile order when granting / listing.
THEME_DISPLAY_ORDER = tuple(PROFILE_BACKGROUND_THEMES.keys())


def catalog_theme(theme_id: Optional[str]) -> Optional[Dict[str, str]]:
    tid = (theme_id or "").strip().lower()
    if not tid:
        return None
    t = PROFILE_BACKGROUND_THEMES.get(tid)
    return dict(t) if t else None


def owned_theme_ids(user: Optional[dict]) -> List[str]:
    if not user:
        return []
    raw = user.get(OWNED_FIELD) or []
    if not isinstance(raw, list):
        return []
    seen = set()
    collected: List[str] = []
    for x in raw:
        tid = str(x or "").strip().lower()
        if not tid or tid in seen or tid not in PROFILE_BACKGROUND_THEMES:
            continue
        seen.add(tid)
        collected.append(tid)
    # Prefer catalog order for the Profile themes picker.
    ordered = [tid for tid in THEME_DISPLAY_ORDER if tid in seen]
    for tid in collected:
        if tid not in ordered:
            ordered.append(tid)
    return ordered


def user_owns_theme(user: Optional[dict], theme_id: Optional[str]) -> bool:
    tid = (theme_id or "").strip().lower()
    return bool(tid) and tid in owned_theme_ids(user)


def equipped_theme_id(user: Optional[dict]) -> Optional[str]:
    if not user:
        return None
    tid = str(user.get(EQUIPPED_FIELD) or "").strip().lower()
    if not tid or tid not in PROFILE_BACKGROUND_THEMES:
        return None
    if not user_owns_theme(user, tid):
        return None
    return tid


def profile_background_public_fields(user: Optional[dict], *, include_owned: bool = False) -> Dict[str, Any]:
    """Public dossier fields. Own list only for self (/auth/me or own profile edit)."""
    eq = equipped_theme_id(user)
    theme = catalog_theme(eq) if eq else None
    out: Dict[str, Any] = {
        "profile_background_theme_id": eq,
        "profile_background_theme": theme,
    }
    if include_owned:
        owned = owned_theme_ids(user)
        out["profile_background_themes_owned"] = owned
        out["profile_background_themes"] = [catalog_theme(t) for t in owned if catalog_theme(t)]
    return out


def normalize_equip_theme_id(raw: Optional[str]) -> Optional[str]:
    """Empty / none / null -> unequip. Else must be a known catalog id."""
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s or s in ("none", "null", "off", "default"):
        return None
    if s not in PROFILE_BACKGROUND_THEMES:
        raise ValueError("Unknown profile background theme")
    return s
