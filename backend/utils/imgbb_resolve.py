"""
Resolve ImgBB gallery / short page URLs to direct image URLs (i.ibb.co).

Used when saving profile banner BBCode so [img]https://ibb.co/abc[/img] works:
browsers cannot render gallery HTML as an <img> src.
Only http(s) hosts on an allowlist are fetched (SSRF-safe).
"""
from __future__ import annotations

import logging
import re
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Hosts that serve HTML pages (not direct files) for image uploads
_IMGBB_GALLERY_HOSTS = frozenset(
    {
        "ibb.co",
        "www.ibb.co",
        "imgbb.com",
        "www.imgbb.com",
    }
)

_OG_IMAGE_RE = re.compile(
    r'<meta\s+property=["\']og:image["\']\s+content=["\']([^"\']+)["\']',
    re.IGNORECASE,
)
_OG_IMAGE_RE_ALT = re.compile(
    r'<meta\s+content=["\']([^"\']+)["\']\s+property=["\']og:image["\']',
    re.IGNORECASE,
)
_IMAGE_SRC_RE = re.compile(
    r'<link\s+rel=["\']image_src["\']\s+href=["\']([^"\']+)["\']',
    re.IGNORECASE,
)


def _host_allowed_for_fetch(hostname: str) -> bool:
    h = (hostname or "").lower()
    return h in _IMGBB_GALLERY_HOSTS


def _is_direct_imgbb_cdn(url: str) -> bool:
    try:
        p = urlparse(url.strip())
        if p.scheme not in ("http", "https"):
            return False
        h = (p.hostname or "").lower()
        return h == "i.ibb.co"
    except Exception:
        return False


async def resolve_imgbb_gallery_to_direct(url: str) -> str:
    """
    If url is an ImgBB gallery/short page, return the og:image direct URL.
    Otherwise return url unchanged. On failure, return url unchanged.
    """
    raw = (url or "").strip()
    if not raw or _is_direct_imgbb_cdn(raw):
        return raw
    try:
        p = urlparse(raw)
        if p.scheme not in ("http", "https"):
            return raw
        if not _host_allowed_for_fetch(p.hostname or ""):
            return raw
    except Exception:
        return raw

    try:
        import httpx
    except ImportError:
        logger.warning("httpx not installed; cannot resolve ImgBB gallery URL")
        return raw

    try:
        async with httpx.AsyncClient(
            timeout=10.0,
            follow_redirects=True,
            headers={"User-Agent": "MafiaGame/1.0 (profile image resolver)"},
        ) as client:
            r = await client.get(raw)
            r.raise_for_status()
            ct = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
            if ct.startswith("image/"):
                return str(r.url)

            html = r.text or ""
            m = (
                _OG_IMAGE_RE.search(html)
                or _OG_IMAGE_RE_ALT.search(html)
                or _IMAGE_SRC_RE.search(html)
            )
            if not m:
                return raw
            direct = (m.group(1) or "").strip()
            if not direct.startswith("https://i.ibb.co/") and not direct.startswith("http://i.ibb.co/"):
                # Still use if it looks like a plain https image from ImgBB infrastructure
                dp = urlparse(direct)
                if (dp.hostname or "").lower() != "i.ibb.co":
                    return raw
            return direct
    except Exception as e:
        logger.debug("ImgBB resolve failed for %s: %s", raw, e)
        return raw


_IMG_TAG_RE = re.compile(r"\[img\]([\s\S]*?)\[/img\]", re.IGNORECASE)


async def rewrite_imgbb_urls_in_banner_text(text: str) -> str:
    """Replace ImgBB gallery URLs inside [img]...[/img] with direct i.ibb.co URLs."""
    if not text or "[img]" not in text.lower():
        return text
    matches = list(_IMG_TAG_RE.finditer(text))
    if not matches:
        return text
    new_parts = []
    last = 0
    for m in matches:
        new_parts.append(text[last : m.start()])
        inner = (m.group(1) or "").strip()
        if inner:
            resolved = await resolve_imgbb_gallery_to_direct(inner)
            new_parts.append(f"[img]{resolved}[/img]")
        else:
            new_parts.append(m.group(0))
        last = m.end()
    new_parts.append(text[last:])
    return "".join(new_parts)
