# Best-effort country from reverse-proxy headers (e.g. Cloudflare CF-IPCountry).
from typing import Optional


def country_code_from_request_headers(request) -> Optional[str]:
    """Return ISO 3166-1 alpha-2 uppercase or None if unknown / not behind CF."""
    if request is None:
        return None
    try:
        h = request.headers
    except Exception:
        return None
    for key in ("cf-ipcountry", "CF-IPCountry"):
        raw = h.get(key)
        if not raw or not isinstance(raw, str):
            continue
        c = raw.strip().upper()
        if len(c) != 2 or not c.isalpha():
            continue
        # Cloudflare reserved / unknown
        if c in ("XX", "T1"):
            return None
        return c
    return None
