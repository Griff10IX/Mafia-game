"""Loot-style profile dossier background themes (own + equip separately)."""
from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Canonical dossier banner bitmap — every theme JPEG must be exactly this size.
# CSS: .prof-dossier-theme-bg uses width-fit (100% auto). See
# public/images/profile-themes/README.md and scripts/check_profile_theme_images.py.
THEME_IMAGE_WIDTH = 1024
THEME_IMAGE_HEIGHT = 931
THEME_IMAGE_SIZE = (THEME_IMAGE_WIDTH, THEME_IMAGE_HEIGHT)  # (w, h)

# Admin-only test upload (not in public loot catalog).
CUSTOM_THEME_ID = "admin_custom"
CUSTOM_URL_FIELD = "profile_background_custom_url"
CUSTOM_THEME_NAME = "Admin custom (test)"

# Catalog: hard-to-get themes (loot later). Image paths are public static assets.
# ?v= cache-bust when art is replaced.
# fit: width = natural-aspect banner (default); stretch = fill whole dossier.
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

_SAFE_USER_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,80}$")


def catalog_theme(theme_id: Optional[str]) -> Optional[Dict[str, Any]]:
    tid = (theme_id or "").strip().lower()
    if not tid or tid == CUSTOM_THEME_ID:
        return None
    t = PROFILE_BACKGROUND_THEMES.get(tid)
    if not t:
        return None
    out: Dict[str, Any] = dict(t)
    out["width"] = THEME_IMAGE_WIDTH
    out["height"] = THEME_IMAGE_HEIGHT
    return out


def custom_theme_payload(image_url: Optional[str] = None) -> Dict[str, Any]:
    url = (image_url or "").strip()
    return {
        "id": CUSTOM_THEME_ID,
        "name": CUSTOM_THEME_NAME,
        "image": url,
        "fit": "width",
        "width": THEME_IMAGE_WIDTH,
        "height": THEME_IMAGE_HEIGHT,
        "custom": True,
    }


def custom_image_url(user: Optional[dict]) -> Optional[str]:
    if not user:
        return None
    url = str(user.get(CUSTOM_URL_FIELD) or "").strip()
    return url or None


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


def user_owns_theme(user: Optional[dict], theme_id: Optional[str], *, is_admin: bool = False) -> bool:
    tid = (theme_id or "").strip().lower()
    if not tid:
        return False
    if tid == CUSTOM_THEME_ID:
        return bool(is_admin and custom_image_url(user))
    return tid in owned_theme_ids(user)


def equipped_theme_id(user: Optional[dict]) -> Optional[str]:
    if not user:
        return None
    tid = str(user.get(EQUIPPED_FIELD) or "").strip().lower()
    if not tid:
        return None
    if tid == CUSTOM_THEME_ID:
        return CUSTOM_THEME_ID if custom_image_url(user) else None
    if tid not in PROFILE_BACKGROUND_THEMES:
        return None
    if not user_owns_theme(user, tid):
        return None
    return tid


def resolve_equipped_theme(user: Optional[dict]) -> Optional[Dict[str, Any]]:
    tid = equipped_theme_id(user)
    if not tid:
        return None
    if tid == CUSTOM_THEME_ID:
        return custom_theme_payload(custom_image_url(user))
    return catalog_theme(tid)


def profile_background_public_fields(
    user: Optional[dict],
    *,
    include_owned: bool = False,
    is_admin: bool = False,
) -> Dict[str, Any]:
    """Public dossier fields. Own list only for self (/auth/me or own profile edit)."""
    eq = equipped_theme_id(user)
    theme = resolve_equipped_theme(user)
    out: Dict[str, Any] = {
        "profile_background_theme_id": eq,
        "profile_background_theme": theme,
        # Default on (darken). Owner can disable for true-colour art.
        "profile_theme_scrim": False if user and user.get("profile_theme_scrim") is False else True,
    }
    if include_owned:
        owned = owned_theme_ids(user)
        themes = [catalog_theme(t) for t in owned if catalog_theme(t)]
        if is_admin:
            themes.append(custom_theme_payload(custom_image_url(user)))
            if CUSTOM_THEME_ID not in owned:
                owned = list(owned) + [CUSTOM_THEME_ID]
        out["profile_background_themes_owned"] = owned
        out["profile_background_themes"] = themes
        out["profile_background_theme_can_upload"] = bool(is_admin)
    return out


def normalize_equip_theme_id(raw: Optional[str]) -> Optional[str]:
    """Empty / none / null -> unequip. Else must be a known catalog id or admin_custom."""
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s or s in ("none", "null", "off", "default"):
        return None
    if s == CUSTOM_THEME_ID:
        return CUSTOM_THEME_ID
    if s not in PROFILE_BACKGROUND_THEMES:
        raise ValueError("Unknown profile background theme")
    return s


def custom_theme_upload_dir(root_dir: Path) -> Path:
    return Path(root_dir) / "uploads" / "profile_themes"


def custom_theme_file_path(root_dir: Path, user_id: str) -> Path:
    uid = str(user_id or "").strip()
    if not _SAFE_USER_ID_RE.match(uid):
        raise ValueError("Invalid user id")
    return custom_theme_upload_dir(root_dir) / f"{uid}.jpg"


def encode_theme_jpeg(raw: bytes) -> Tuple[bytes, str]:
    """Validate upload bytes and encode a center cover-crop JPEG at THEME_IMAGE_SIZE.

    No small size cap — admin test uploads are resized down to 1024×931 anyway.
    """
    from PIL import Image

    from utils.image_upload_security import sniff_image_mime, verify_image_magic_bytes

    if not raw:
        raise ValueError("Invalid or empty image file")
    ok, err = verify_image_magic_bytes(raw, None)
    if not ok:
        raise ValueError(err or "Invalid image")
    mime = sniff_image_mime(raw)
    if not mime:
        raise ValueError("Invalid image type")
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception as e:
        raise ValueError("Could not read image") from e
    im = im.convert("RGB")
    tw, th = THEME_IMAGE_WIDTH, THEME_IMAGE_HEIGHT
    sw, sh = im.size
    if sw < 1 or sh < 1:
        raise ValueError("Invalid image dimensions")
    scale = max(tw / sw, th / sh)
    nw = max(tw, int(round(sw * scale)))
    nh = max(th, int(round(sh * scale)))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max(0, (nw - tw) // 2)
    top = max(0, (nh - th) // 2)
    im = im.crop((left, top, left + tw, top + th))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=92, optimize=True)
    return buf.getvalue(), "image/jpeg"
