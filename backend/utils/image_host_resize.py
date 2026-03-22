"""Optional max-edge resize for image host (JPEG/PNG/WebP; static GIF)."""
from __future__ import annotations

import logging
from io import BytesIO
from typing import Optional, Tuple

from utils.image_upload_security import CAR_IMAGE_MAX_REMOTE_BYTES, verify_image_magic_bytes

logger = logging.getLogger(__name__)


def _require_pil():
    """Lazy import so the API can start without Pillow; resize paths fail with a clear message."""
    try:
        from PIL import Image

        return Image
    except ImportError as e:
        raise ValueError(
            "Image resize requires Pillow. On the server run: pip install Pillow"
            " (or pip install -r requirements.txt) then restart the backend."
        ) from e

# Longest side (px); keeps aspect ratio. User-selectable presets only.
ALLOWED_MAX_EDGES = frozenset({400, 640, 800, 1024, 1280, 1600, 1920})


def normalize_max_edge(value: Optional[int]) -> Optional[int]:
    if value is None:
        return None
    if value not in ALLOWED_MAX_EDGES:
        raise ValueError(f"max_edge must be one of: {', '.join(map(str, sorted(ALLOWED_MAX_EDGES)))}")
    return value


def apply_max_edge_resize(data: bytes, mime: str, max_edge: int) -> Tuple[bytes, str]:
    """
    If image is larger than max_edge on the longest side, downscale (LANCZOS).
    Returns (bytes, mime) for storage. Animated GIFs are left unchanged.
    """
    if max_edge not in ALLOWED_MAX_EDGES:
        raise ValueError("Invalid max_edge")

    Image = _require_pil()

    try:
        im = Image.open(BytesIO(data))
    except Exception as e:
        logger.warning("image_host resize open failed: %s", e)
        raise ValueError("Could not read image for resizing") from e

    n_frames = getattr(im, "n_frames", 1) or 1
    if mime == "image/gif" and n_frames > 1:
        return data, mime

    try:
        im.load()
    except Exception as e:
        logger.warning("image_host resize load failed: %s", e)
        raise ValueError("Could not decode image for resizing") from e

    w, h = im.size
    if w <= 0 or h <= 0:
        raise ValueError("Invalid image dimensions")
    if max(w, h) <= max_edge:
        return data, mime

    work = im
    if work.mode not in ("RGB", "RGBA"):
        if mime == "image/jpeg":
            work = work.convert("RGB")
        else:
            work = work.convert("RGBA")

    work = work.copy()
    work.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)

    buf = BytesIO()
    out_mime = mime
    if mime == "image/jpeg":
        work.convert("RGB").save(buf, format="JPEG", quality=88, optimize=True)
        out_mime = "image/jpeg"
    elif mime == "image/png":
        work.save(buf, format="PNG", optimize=True)
        out_mime = "image/png"
    elif mime == "image/webp":
        work.save(buf, format="WEBP", quality=85, method=4)
        out_mime = "image/webp"
    elif mime == "image/gif":
        p = work.convert("RGBA").convert("P", palette=Image.ADAPTIVE, colors=256)
        p.save(buf, format="GIF", optimize=True)
        out_mime = "image/gif"
    else:
        return data, mime

    out = buf.getvalue()
    if len(out) > CAR_IMAGE_MAX_REMOTE_BYTES:
        raise ValueError("Resized image still too large; try a smaller max size or upload without resize")

    ok, err = verify_image_magic_bytes(out, out_mime)
    if not ok:
        raise ValueError(err or "Resized image failed validation")

    return out, out_mime


def maybe_resize_for_host(data: bytes, mime: str, max_edge: Optional[int]) -> Tuple[bytes, str, Optional[int]]:
    """
    Apply optional max-edge resize. Returns (bytes, mime, resize_max_edge or None).
    Animated GIFs are never resized; third value is None in that case.
    """
    if max_edge is None:
        return data, mime, None
    max_edge = normalize_max_edge(max_edge)

    Image = _require_pil()

    if mime == "image/gif":
        try:
            im = Image.open(BytesIO(data))
            if getattr(im, "n_frames", 1) > 1:
                return data, mime, None
        except Exception as e:
            logger.warning("image_host resize gif check failed: %s", e)
            raise ValueError("Could not read GIF for resizing") from e

    out, out_mime = apply_max_edge_resize(data, mime, max_edge)
    return out, out_mime, max_edge
