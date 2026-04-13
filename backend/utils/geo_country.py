# Best-effort country from reverse-proxy / edge headers (Cloudflare, Vercel, CloudFront, etc.).
from typing import Optional

# Starlette/FastAPI header lookup is case-insensitive; one canonical key per provider is enough.
_COUNTRY_HEADER_KEYS = (
    "cf-ipcountry",
    "x-vercel-ip-country",
    "cloudfront-viewer-country",
    "fastly-client-country",
    "x-appengine-country",
)


def _parse_iso2_country(raw: str) -> Optional[str]:
    if not raw or not isinstance(raw, str):
        return None
    c = raw.strip().upper()
    if len(c) != 2 or not c.isalpha():
        return None
    # Cloudflare (and some edges) use reserved / unknown codes
    if c in ("XX", "T1"):
        return None
    return c


def country_code_from_request_headers(request) -> Optional[str]:
    """Return ISO 3166-1 alpha-2 uppercase or None if unknown / no edge header."""
    if request is None:
        return None
    try:
        h = request.headers
    except Exception:
        return None
    for key in _COUNTRY_HEADER_KEYS:
        parsed = _parse_iso2_country(h.get(key) or "")
        if parsed:
            return parsed
    return None
