"""Reject obvious automation and weakly-spoofed browser clients on public auth routes.

Layers:
- Known library / tool User-Agent substrings
- Minimal "browser-like" UA shape (length + parentheses; real browsers are verbose)
- Sec-Fetch-* headers (modern browsers send at least one on fetch/XHR; many script clients omit them)

All are coarse heuristics — trivial to spoof together — but they catch lazy bots and mistyped scripts.
Disable via main game_settings: block_script_user_agent_login = false (auth + minigames),
or block_script_user_agent_game_actions = false (crimes, GTA, jail, OC, bodyguards, attack, booze-run).
Optional stricter Sec-Fetch / Accept for game-action writes when main game_settings game_actions_client_strict = true.
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
    "node-fetch/",
    "axios/",
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


def _header_ci(headers: Mapping[str, str], name: str) -> str:
    for k, v in headers.items():
        if k.lower() == name.lower():
            return (v or "").strip().lower()
    return ""


_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def game_action_strict_headers_blocked(
    headers: Mapping[str, str],
    *,
    method: str,
    settings: dict | None,
) -> Tuple[bool, str]:
    """
    Extra checks for game-action API writes when main game_settings game_actions_client_strict is True.
    Default False when missing.
    """
    if not settings or not bool(settings.get("game_actions_client_strict", False)):
        return False, ""
    m = (method or "").upper()
    if m not in _MUTATING_METHODS:
        return False, ""

    mode = _header_ci(headers, "sec-fetch-mode")
    dest = _header_ci(headers, "sec-fetch-dest")
    site = _header_ci(headers, "sec-fetch-site")
    accept = ""
    for k, v in headers.items():
        if k.lower() == "accept":
            accept = v or ""
            break

    if mode:
        if mode not in ("cors", "same-origin"):
            return True, "strict_sec_fetch_mode"
    else:
        return True, "strict_sec_fetch_mode"

    if dest:
        if dest != "empty":
            return True, "strict_sec_fetch_dest"
    else:
        if mode == "cors" and site == "same-origin":
            pass
        elif mode == "same-origin" and site in ("same-origin", "same-site"):
            pass
        else:
            return True, "strict_sec_fetch_dest"

    if site == "cross-site":
        return True, "strict_sec_fetch_site"

    if "application/json" not in (accept or "").lower():
        return True, "strict_accept"

    return False, ""
