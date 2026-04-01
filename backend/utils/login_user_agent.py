"""Reject obvious automation and weakly-spoofed browser clients on public auth routes.

Layers:
- Known library / tool User-Agent substrings
- Minimal "browser-like" UA shape (length + parentheses; real browsers are verbose)
- Sec-Fetch-* headers (modern browsers send at least one on fetch/XHR; many script clients omit them)

All are coarse heuristics — trivial to spoof together — but they catch lazy bots and mistyped scripts.
Disable via main game_settings: block_script_user_agent_login = false (auth + minigames),
or block_script_user_agent_game_actions = false (crimes, GTA, jail, OC, bodyguards, attack, booze-run).
"""
from __future__ import annotations

from typing import Mapping, Tuple

# Lowercase substrings; keep conservative to avoid blocking real mobile WebViews.
_BLOCKED_MARKERS: Tuple[str, ...] = (
    "curl/",
    "wget/",
    "python-requests",
    "aiohttp/",
    "httpx/",
    "urllib3/",
    "go-http-client/",
    "libwww-perl",
    "postmanruntime",
    "insomnia/",
    "http.rb/",
    "scrapy/",
    "mechanize",
    "phantomjs",
    "headlesschrome",
    "selenium",
    "puppeteer",
    "playwright",
    "nikto",
    "sqlmap",
    "masscan",
    "nuclei",
)


def login_user_agent_blocked(ua: str) -> Tuple[bool, str]:
    """
    Returns (blocked, internal_reason) for logging only — do not expose reason to clients.
    """
    raw = (ua or "").strip()
    if not raw:
        return True, "empty_user_agent"
    lower = raw.lower()
    for m in _BLOCKED_MARKERS:
        if m in lower:
            return True, f"marker:{m}"
    return False, ""


def _user_agent_browser_like_shape(ua: str) -> bool:
    """True if UA looks like a full browser string (not a one-line fake)."""
    raw = (ua or "").strip()
    if len(raw) < 35:
        return False
    # Real browser UAs almost always include a parenthetical platform token.
    if "(" not in raw or ")" not in raw:
        return False
    return True


def _has_sec_fetch_header(headers: Mapping[str, str]) -> bool:
    for key in headers.keys():
        if key.lower().startswith("sec-fetch-"):
            return True
    return False


def auth_client_headers_blocked(
    headers: Mapping[str, str],
    settings: dict | None,
    setting_key: str = "block_script_user_agent_login",
) -> Tuple[bool, str]:
    """
    Combined checks for /auth/login (non-staff), /auth/register, /auth/preregister, minigames, core game APIs, etc.

    settings keys on main doc: block_script_user_agent_login, block_script_user_agent_game_actions (default True when missing).
    Returns (blocked, internal_reason) for logging only.
    """
    enabled = bool(settings.get(setting_key, True)) if settings else True
    if not enabled:
        return False, ""

    ua = (headers.get("user-agent") or "").strip()

    blocked, reason = login_user_agent_blocked(ua)
    if blocked:
        return True, reason

    if not _user_agent_browser_like_shape(ua):
        return True, "ua_shape_not_browser_like"

    if not _has_sec_fetch_header(headers):
        return True, "missing_sec_fetch_headers"

    return False, ""
