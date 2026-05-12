# Attack endpoints: search, status, list, delete, travel, bullets/calc, inflation, execute, attempts
from typing import Any, Dict, List, Optional, Set, Tuple
from datetime import datetime, timezone, timedelta
import asyncio
import math
import random
import re
import secrets
import time
from urllib.parse import urlparse
import uuid
import os
import sys
import logging
from fastapi import Depends, HTTPException, Request, Query
from jose import JWTError, jwt
from pydantic import BaseModel, field_validator, model_validator
from pymongo import DeleteOne, ReturnDocument, UpdateOne

logger = logging.getLogger(__name__)

_KILL_INFLATION_CACHE_TTL_SEC = 3.0
_kill_inflation_cache: Dict[str, Tuple[float, float]] = {}
_ATTACK_MICRO_COOLDOWN_SEC = 1.0 / 8.0
_ATTACK_MICRO_COOLDOWN_PRUNE_AFTER_SEC = 60.0
_attack_micro_cooldown_seen: Dict[str, float] = {}
_attack_micro_cooldown_lock = asyncio.Lock()
ACCOUNT_LOCKED_ATTACK_BLOCK_DETAIL = "Error, this account has been locked for investigation."

# Background tasks scheduled by _fire_and_forget. Holding strong refs prevents the event loop
# from garbage-collecting them mid-flight (asyncio only weak-refs tasks). Tasks self-remove on done.
_kill_bg_tasks: Set[asyncio.Task] = set()


def _fire_and_forget(coro, *, label: str = "kill_bg") -> None:
    """Run an awaitable in the background without blocking the request response.
    Used for audit logs, notifications, and stats writes that must not slow down the
    /attack/execute response. Any exception is logged but never raised."""
    async def _runner():
        try:
            await coro
        except Exception:
            logger.exception("kill background task failed: %s", label)
    try:
        task = asyncio.create_task(_runner())
        _kill_bg_tasks.add(task)
        task.add_done_callback(_kill_bg_tasks.discard)
    except RuntimeError:
        # No running event loop (shouldn't happen inside a request); swallow the coroutine cleanly.
        try:
            coro.close()
        except Exception:
            pass

# Per-user 1s coalescing cache for GET /attack/list. Key = (attacker_id, ac_state) so a state change
# (e.g. just landed in a new city) invalidates automatically without explicit calls. Search/delete
# also invalidate explicitly so a user clicking Search sees the new row immediately.
_ATTACK_LIST_CACHE_TTL_SEC = 1.0
_ATTACK_LIST_CACHE_MAX = 5000
_attack_list_cache: Dict[Tuple[str, str], Tuple[float, List[dict]]] = {}


def _attack_list_cache_get(attacker_id: str, ac_state: str) -> Optional[List[dict]]:
    cached = _attack_list_cache.get((attacker_id, ac_state))
    if not cached:
        return None
    if cached[0] <= time.monotonic():
        return None
    return cached[1]


def _attack_list_cache_set(attacker_id: str, ac_state: str, items: List[dict]) -> None:
    now = time.monotonic()
    _attack_list_cache[(attacker_id, ac_state)] = (now + _ATTACK_LIST_CACHE_TTL_SEC, items)
    if len(_attack_list_cache) > _ATTACK_LIST_CACHE_MAX:
        for k, (exp, _items) in list(_attack_list_cache.items())[:512]:
            if exp < now:
                _attack_list_cache.pop(k, None)


def _attack_list_cache_invalidate(attacker_id: str) -> None:
    for k in [k for k in _attack_list_cache if k[0] == attacker_id]:
        _attack_list_cache.pop(k, None)

_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend not in sys.path:
    sys.path.insert(0, _backend)
from server import (
    db,
    SECRET_KEY,
    ALGORITHM,
    get_current_user,
    get_current_user_verified,
    apply_passive_health_regen,
    RANKS,
    STATES,
    CARS,
    ARMOUR_BASE_BULLETS,
    MIN_BULLETS_TO_KILL,
    DEFAULT_HEALTH,
    KILL_CASH_PERCENT,
    _is_admin,
    _is_hdo,
    _is_moderator,
    user_has_admin_list_email,
    CAPO_RANK_ID,
    GODFATHER_RANK_ID,
    get_rank_info,
    user_prestige_rank_mult,
    get_effective_event,
    log_respect_earned,
    send_notification,
    send_notification_to_family,
    require_staff_issued_if_staff_capable,
    maybe_process_rank_up,
    maybe_respect_points_drop,
    _find_user_by_username_case_insensitive,
    _apply_kill_inflation_decay,
    _increase_kill_inflation_on_kill,
    _get_active_war_between,
    _get_active_war_for_family,
    _record_war_stats_player_kill,
    _family_war_start,
    _family_war_check_wipe_and_award,
    _user_owns_any_casino,
    _user_owns_any_property,
    log_activity,
    founding_member_income_mult,
)
from utils.game_pass_season_rp import apply_season_rp_mirror_to_update
from utils.hitlist_resolution import resolve_user_hitlist_kill
from utils.kill_search_duration import KILL_SEARCH_RANDOM_MAX_MINUTES, KILL_SEARCH_RANDOM_MIN_MINUTES
from utils.civilian_protection import (
    CIVILIAN_PROTECTION_KILL_BLOCKED_DETAIL,
    is_civilian_protected,
    maybe_revoke_civilian_protection,
)
from routers.money.booze_run import BOOZE_TYPES
from routers.account.objectives import update_objectives_progress
from routers.kill.armoury import (
    LOOT_EXCLUSIVE_WEAPON_ID,
    MASTERY_MAX_BULLET_REDUCTION_PCT,
    _best_weapon_for_user,
    _get_weapon_mastery_pct,
)
from routers.game.families import resolve_family_id
from utils.staff_bot_client_alert import maybe_notify_staff_bot_attack_from_ua, maybe_notify_staff_attack_execute_token_fail
from utils.sustained_page_ratelimit import PAGE_KEY_KILL, check_sustained_page_rl
from utils.attack_turnstile_gate import (
    attack_turnstile_config as load_attack_turnstile_config,
    issue_attack_turnstile_nonce,
    require_attack_turnstile,
)


async def _attack_micro_cooldown(request: Request):
    """Reject attack button spam before any Mongo-backed dependencies run."""
    auth = (request.headers.get("authorization") or "").strip()
    scheme, _, token = auth.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return
    try:
        payload = jwt.decode(token.strip(), SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return
    user_id = payload.get("sub")
    if not user_id:
        return

    now = time.monotonic()
    key = f"{user_id}:attack_buttons"
    async with _attack_micro_cooldown_lock:
        last_seen = _attack_micro_cooldown_seen.get(key)
        if last_seen is not None and now - last_seen < _ATTACK_MICRO_COOLDOWN_SEC:
            raise HTTPException(
                status_code=429,
                headers={"Retry-After": "1"},
                detail={
                    "detail": "Attack requests are too fast — slow down.",
                    "cooldown_seconds": 1,
                    "page_key": PAGE_KEY_KILL,
                },
            )
        _attack_micro_cooldown_seen[key] = now

        cutoff = now - _ATTACK_MICRO_COOLDOWN_PRUNE_AFTER_SEC
        stale_keys = [k for k, seen_at in _attack_micro_cooldown_seen.items() if seen_at < cutoff]
        for stale_key in stale_keys:
            _attack_micro_cooldown_seen.pop(stale_key, None)


async def _kill_sustained_rl_verified(current_user: dict = Depends(get_current_user_verified)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_KILL)


def _bodyguard_owner_slot_dec_update(target: dict, killer_id: str, owner_id: str) -> Dict[str, Any]:
    """Decrement bodyguard_slots; if someone else killed your robot NPC bodyguard, block hiring another for a short window."""
    ops: Dict[str, Any] = {"$inc": {"bodyguard_slots": -1}}
    if (
        target.get("is_npc")
        and target.get("is_bodyguard")
        and killer_id != owner_id
    ):
        from routers.kill.bodyguards import BODYGUARD_ROBOT_KILLED_HIRE_COOLDOWN_SECONDS

        allowed_after = datetime.now(timezone.utc) + timedelta(seconds=BODYGUARD_ROBOT_KILLED_HIRE_COOLDOWN_SECONDS)
        ops["$set"] = {"bodyguard_robot_loss_hire_allowed_after": allowed_after.isoformat()}
    return ops


def _safe_compare_execute_token(stored: str, submitted: Optional[str]) -> bool:
    """Constant-time compare for server-minted execute tokens."""
    a = (stored or "").strip()
    b = (submitted or "").strip()
    if len(a) < 16 or len(a) != len(b):
        return False
    try:
        return secrets.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
    except Exception:
        return False


async def _resolve_attack_row_for_execute(
    attacker_id: str,
    attack_id: Optional[str],
    execute_token: Optional[str],
) -> Optional[dict]:
    """
    Prefer lookup by execute_token (opaque, not a UUID) so POST /attack/execute need not expose attack row id.
    Falls back to attack_id for legacy rows without a token.
    """
    etok = (execute_token or "").strip()
    aid = (attack_id or "").strip()
    if len(etok) >= 16:
        row = await db.attacks.find_one(
            {"attacker_id": attacker_id, "status": "found", "execute_token": etok},
            {"_id": 0},
        )
        if row:
            return row
    if aid:
        return await db.attacks.find_one(
            {"attacker_id": attacker_id, "status": "found", "id": aid},
            {"_id": 0},
        )
    return None


async def _ensure_execute_token(attacker_id: str, attack_id: str) -> Optional[str]:
    """
    Mint a per-attack token when the client can execute (same location as target).
    Lazy scripts that only POST /attack/execute never see this value until they poll list or status.
    Clients may send only this token on execute (no attack UUID in the JSON body).
    """
    base_filter = {"id": attack_id, "attacker_id": attacker_id}
    doc = await db.attacks.find_one(base_filter, {"_id": 0, "execute_token": 1})
    if not doc:
        return None
    t = doc.get("execute_token")
    if isinstance(t, str) and len(t) >= 16:
        return t
    new_t = secrets.token_urlsafe(24)
    updated = await db.attacks.find_one_and_update(
        {
            **base_filter,
            "$or": [
                {"execute_token": {"$exists": False}},
                {"execute_token": None},
                {"execute_token": ""},
            ],
        },
        {"$set": {"execute_token": new_t}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0, "execute_token": 1},
    )
    out = (updated or {}).get("execute_token")
    if isinstance(out, str) and len(out) >= 16:
        return out
    doc2 = await db.attacks.find_one(base_filter, {"_id": 0, "execute_token": 1})
    out2 = (doc2 or {}).get("execute_token")
    return out2 if isinstance(out2, str) and len(out2) >= 16 else new_t


def _parse_iso_datetime(val):
    """Parse datetime from DB string; return None if missing/invalid. Normalize to UTC if naive."""
    if val is None:
        return None
    if hasattr(val, "year"):
        return val.replace(tzinfo=timezone.utc) if val.tzinfo is None else val
    try:
        s = str(val).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return None


async def _get_kill_inflation_cached(user_id: str) -> float:
    """Tiny TTL cache to avoid duplicate inflation recalcs in bursty attack requests."""
    now = time.monotonic()
    cached = _kill_inflation_cache.get(user_id)
    if cached and cached[1] > now:
        return float(cached[0])
    value = float(await _apply_kill_inflation_decay(user_id))
    _kill_inflation_cache[user_id] = (value, now + _KILL_INFLATION_CACHE_TTL_SEC)
    return value


def _hunt_location_when_search_timer_fires(target_user: Optional[dict], attack: dict) -> Optional[str]:
    """City when a hunt becomes FOUND. Robot NPC bodyguards: only their users.current_state (no planned/random)."""
    tu = target_user or {}
    if tu.get("is_npc") and tu.get("is_bodyguard"):
        cs = (tu.get("current_state") or "").strip()
        return cs if cs else None
    return (
        (tu.get("current_state") if tu.get("current_state") in STATES else None)
        or attack.get("planned_location_state")
        or (random.choice(STATES) if STATES else "Chicago")
    )


def _resolved_target_location(attack: dict, target_user: Optional[dict]) -> Optional[str]:
    """For a FOUND hunt, use the target user's current_state when valid. Robot bodyguards: only that field, never planned."""
    if not attack or attack.get("status") != "found":
        return attack.get("location_state") if attack else None
    tu = target_user or {}
    if tu.get("is_npc") and tu.get("is_bodyguard"):
        cs = (tu.get("current_state") or "").strip()
        return cs if cs else None
    live = tu.get("current_state")
    if live and live in STATES:
        return live
    return attack.get("location_state") or attack.get("planned_location_state")


_CLIENT_SIGNAL_DETAIL_MAX = 200
# Optional audit rows for /attack/search (header snapshot + client classification).
ATTACK_CLIENT_AUDIT_COLLECTION = "attack_client_audit"


def _hdr_trim(request: Request, header_name: str, max_len: int) -> Optional[str]:
    v = request.headers.get(header_name) or ""
    if not isinstance(v, str):
        v = str(v)
    v = v.strip()
    if not v:
        return None
    if len(v) > max_len:
        return v[:max_len] + "…"
    return v


def _client_header_snapshot(request: Optional[Request]) -> Dict[str, Any]:
    """Non-secret header bundle for UA-spoof / client forensics (staff-only in player APIs)."""
    if not request:
        return {}
    ref = _hdr_trim(request, "referer", 512) or _hdr_trim(request, "Referer", 512)
    ref_host = None
    if ref:
        try:
            ref_host = (urlparse(ref).hostname or "")[:120] or None
        except Exception:
            ref_host = None
    snap: Dict[str, Any] = {
        "sec_fetch_mode": _hdr_trim(request, "sec-fetch-mode", 40),
        "sec_fetch_site": _hdr_trim(request, "sec-fetch-site", 40),
        "sec_fetch_dest": _hdr_trim(request, "sec-fetch-dest", 40),
        "sec_ch_ua": _hdr_trim(request, "sec-ch-ua", 200),
        "sec_ch_ua_mobile": _hdr_trim(request, "sec-ch-ua-mobile", 24),
        "sec_ch_ua_platform": _hdr_trim(request, "sec-ch-ua-platform", 80),
        "accept": _hdr_trim(request, "accept", 200),
        "accept_language": _hdr_trim(request, "accept-language", 120),
        "origin": _hdr_trim(request, "origin", 160),
        "referer_host": ref_host,
    }
    cfs = _hdr_trim(request, "cf-bot-score", 16) or _hdr_trim(request, "CF-Bot-Score", 16)
    if cfs:
        snap["cf_bot_score"] = cfs
    cvb = _hdr_trim(request, "cf-verified-bot", 12) or _hdr_trim(request, "CF-Verified-Bot", 12)
    if cvb:
        snap["cf_verified_bot"] = cvb
    return {k: v for k, v in snap.items() if v is not None}


def _chrome_major_version(ua: str) -> Optional[int]:
    m = re.search(r"Chrome/(\d+)", ua or "", re.I)
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


def _compute_client_risk_score(meta: Dict[str, Any]) -> int:
    """0–100 soft risk from classification + anomaly flag count (not a ban decision)."""
    score = 0
    if meta.get("attacker_is_bot"):
        score += 62
    sig = meta.get("attacker_client_signal") or ""
    if sig == "suspicious":
        score += 28
    elif sig in ("automation", "script"):
        score += 8
    flags = meta.get("client_anomaly_flags")
    if isinstance(flags, list) and flags:
        score += min(35, len(flags) * 7)
    return min(100, int(score))


def _merge_client_anomaly_flags(meta: Dict[str, Any], *flags: str) -> None:
    existing = meta.get("client_anomaly_flags")
    merged: List[str] = []
    if isinstance(existing, list):
        merged.extend(str(x).strip() for x in existing if str(x or "").strip())
    merged.extend(str(x).strip() for x in flags if str(x or "").strip())
    meta["client_anomaly_flags"] = list(dict.fromkeys(merged))
    meta["client_risk_score"] = _compute_client_risk_score(meta)


def _append_client_signal_detail(meta: Dict[str, Any], *details: str) -> None:
    existing = str(meta.get("attacker_client_signal_detail") or "").strip()
    parts = [x for x in existing.split(",") if x] if existing else []
    parts.extend(str(x).strip() for x in details if str(x or "").strip())
    if parts:
        meta["attacker_client_signal_detail"] = ",".join(list(dict.fromkeys(parts)))[:_CLIENT_SIGNAL_DETAIL_MAX]


def _mark_execute_token_integrity_meta(meta: Dict[str, Any], reason: str) -> None:
    """Token failures are not proof alone, but they are strong enough to stop showing Bot? as "No"."""
    flag = (reason or "execute_token_invalid").strip() or "execute_token_invalid"
    sig = meta.get("attacker_client_signal") or ""
    if sig in ("", "browser"):
        meta["attacker_client_signal"] = "suspicious"
        meta["attacker_is_bot"] = False
    _append_client_signal_detail(meta, flag)
    _merge_client_anomaly_flags(meta, flag)


def _is_automation_ua(user_agent: str) -> bool:
    u = (user_agent or "").lower()
    return any(x in u for x in ("selenium", "webdriver", "headless", "puppeteer", "playwright", "phantom"))


def _is_script_http_client_ua(user_agent: str) -> bool:
    """Non-browser HTTP clients, crawlers, and tooling (includes automation UAs)."""
    if not user_agent or not isinstance(user_agent, str):
        return False
    ua = user_agent.lower()
    if _is_automation_ua(user_agent):
        return True
    if "mafiakillbot" in ua or ("bot" in ua and ("kill" in ua or "attack" in ua)):
        return True
    if any(x in ua for x in ("bot", "crawler", "spider", "scraper", "fetcher", "curl", "wget", "libwww")):
        return True
    if any(x in ua for x in ("python", "requests", "urllib", "aiohttp", "httpx")):
        return True
    if any(x in ua for x in ("axios/", "node/", "node.js", "undici", "got/", "superagent")):
        return True
    if any(x in ua for x in ("java/", "apache-httpclient", "jetty", "java ")):
        return True
    if any(x in ua for x in ("dotnet", ".net", "httpclient", "webrequest")):
        return True
    if any(x in ua for x in ("go-http", "go/", "ruby", "faraday", "php/", "php ", "reqwest", "ureq")):
        return True
    if any(x in ua for x in ("postman", "insomnia", "rest-assured", "swagger")):
        return True
    if "libcurl" in ua:
        return True
    if "scrapy" in ua:
        return True
    if "httpie" in ua:
        return True
    if "powershell" in ua:
        return True
    if "winhttp" in ua:
        return True
    if "rest-client" in ua or "restclient" in ua:
        return True
    if "mechanize" in ua:
        return True
    if "apachebench" in ua or ua.startswith("ab/") or "/ab/" in ua:
        return True
    if "artillery" in ua:
        return True
    if ua.startswith("k6/") or " k6/" in ua:
        return True
    if "restsharp" in ua:
        return True
    if "okhttp" in ua and "mozilla" not in ua:
        return True
    return False


def _automation_label_from_ua(user_agent: str) -> str:
    u = (user_agent or "").lower()
    if any(x in u for x in ("puppeteer",)):
        return "Browser automation (Puppeteer)"
    if any(x in u for x in ("playwright",)):
        return "Browser automation (Playwright)"
    if any(x in u for x in ("selenium", "webdriver")):
        return "Browser automation (Selenium/WebDriver)"
    if "phantom" in u:
        return "Browser automation (PhantomJS)"
    if "headless" in u:
        return "Browser automation (headless)"
    return "Browser automation"


def _script_label_from_ua(user_agent: str) -> Optional[str]:
    """Label for script/HTTP client UAs (not used for pure automation-only branch when a finer automation label exists)."""
    if not user_agent or not isinstance(user_agent, str):
        return None
    ua = user_agent.lower()
    if "mafiakillbot" in ua:
        return "MafiaKillBot (C# / .NET)"
    if "bot" in ua and ("kill" in ua or "attack" in ua):
        return "Custom attack bot"
    if any(x in ua for x in ("python", "requests", "urllib", "aiohttp", "httpx")):
        return "Python"
    if any(x in ua for x in ("axios/", "node/", "node.js", "undici", "got/", "superagent")):
        return "JavaScript / Node.js"
    if any(x in ua for x in ("java/", "apache-httpclient", "jetty")):
        return "Java"
    if "okhttp" in ua and "mozilla" not in ua:
        return "OkHttp (non-browser)"
    if any(x in ua for x in ("dotnet", ".net", "httpclient", "webrequest")):
        return "C# / .NET"
    if any(x in ua for x in ("go-http", "go/")):
        return "Go"
    if "ruby" in ua or "faraday" in ua:
        return "Ruby"
    if "php" in ua:
        return "PHP"
    if any(x in ua for x in ("reqwest", "ureq")):
        return "Rust"
    if any(x in ua for x in ("curl", "wget", "libwww", "libcurl")):
        return "curl / wget / libcurl"
    if any(x in ua for x in ("postman", "insomnia", "rest-assured", "swagger")):
        return "API client (Postman/Insomnia/etc.)"
    if any(x in ua for x in ("scrapy", "mechanize")):
        return "Scraper framework"
    if "httpie" in ua:
        return "HTTPie"
    if "powershell" in ua:
        return "PowerShell"
    if "winhttp" in ua:
        return "WinHTTP"
    if "rest-client" in ua or "restclient" in ua or "restsharp" in ua:
        return "REST client library"
    if "apachebench" in ua or ua.startswith("ab/") or "/ab/" in ua:
        return "Apache Bench"
    if "artillery" in ua or ua.startswith("k6/") or " k6/" in ua:
        return "Load testing tool"
    if any(x in ua for x in ("crawler", "spider", "scraper", "fetcher")):
        return "Crawler / scraper"
    if "bot" in ua:
        return "Bot (generic)"
    return "Script / HTTP client"


def _classify_attack_client(request: Optional[Request]) -> Dict[str, Any]:
    """
    Tiered client classification for staff logs. Staff alerts still use attacker_is_bot True only
    (script + automation). Suspicious uses header/UA heuristics and may false-positive if proxies strip Sec-Fetch-*.

    Env (all optional, default off except built-in chrome_like_no_sec_fetch_mode when UA looks like Chrome):
    - ATTACK_STRICT_SEC_FETCH_SITE=1 — flag Chrome-like UA with empty Sec-Fetch-Site.
    - ATTACK_STRICT_SEC_CH_UA=1 — flag Chrome-like UA missing Sec-CH-UA when Chrome/ major >= ATTACK_STRICT_SEC_CH_UA_MIN_CHROME (default 100).
    - ATTACK_STRICT_ACCEPT_JSON=1 — flag when Accept does not include application/json.
    """
    if not request:
        return {}

    def cap_detail(s: str) -> str:
        return (s or "")[:_CLIENT_SIGNAL_DETAIL_MAX]

    ua_raw = (request.headers.get("user-agent") or "").strip()
    ua_l = ua_raw.lower()
    sec_ch_ua = (request.headers.get("sec-ch-ua") or "").strip().lower()
    sec_ch_mobile = (request.headers.get("sec-ch-ua-mobile") or "").strip().strip('"').lower()
    sec_ch_platform = (request.headers.get("sec-ch-ua-platform") or "").strip().strip('"').lower()

    if ua_raw and _is_automation_ua(ua_raw):
        lab = _automation_label_from_ua(ua_raw)
        return {
            "attacker_client_signal": "automation",
            "attacker_is_bot": True,
            "attacker_bot_label": lab[:120],
            "client_anomaly_flags": ["automation_ua"],
        }
    if ua_raw and _is_script_http_client_ua(ua_raw):
        label = _script_label_from_ua(ua_raw) or "Script / HTTP client"
        return {
            "attacker_client_signal": "script",
            "attacker_is_bot": True,
            "attacker_bot_label": label[:120],
            "client_anomaly_flags": ["script_http_client_ua"],
        }

    reasons: List[str] = []
    if len(ua_raw) < 12:
        reasons.append("empty_or_short_ua")
    else:
        ua_mobile = any(x in ua_l for x in ("iphone", "ipod", "ipad", "android", "mobile"))
        ua_ios = any(x in ua_l for x in ("iphone", "ipod", "ipad"))
        ua_android = "android" in ua_l
        ch_has_chrome = "google chrome" in sec_ch_ua or "chromium" in sec_ch_ua
        ua_is_chrome_family = any(x in ua_l for x in ("chrome/", "crios/", "chromium/", "edg/", "edgios/"))
        if ch_has_chrome and "safari" in ua_l and not ua_is_chrome_family:
            reasons.append("safari_ua_with_chrome_client_hint")
        if ua_mobile and sec_ch_mobile == "?0":
            reasons.append("mobile_ua_with_desktop_ch_mobile_hint")
        if not ua_mobile and sec_ch_mobile == "?1":
            reasons.append("desktop_ua_with_mobile_ch_mobile_hint")
        if ua_ios and sec_ch_platform and sec_ch_platform not in ("ios", "ipados"):
            reasons.append("ios_ua_with_non_ios_client_platform")
        if ua_android and sec_ch_platform and sec_ch_platform != "android":
            reasons.append("android_ua_with_non_android_client_platform")
        if "mozilla" in ua_l and "chrome" in ua_l:
            if not (request.headers.get("sec-fetch-mode") or "").strip():
                reasons.append("chrome_like_no_sec_fetch_mode")
            if os.environ.get("ATTACK_STRICT_SEC_FETCH_SITE", "").strip() == "1":
                if not (request.headers.get("sec-fetch-site") or "").strip():
                    reasons.append("chrome_like_no_sec_fetch_site")
            if os.environ.get("ATTACK_STRICT_SEC_CH_UA", "").strip() == "1":
                try:
                    min_maj = int(os.environ.get("ATTACK_STRICT_SEC_CH_UA_MIN_CHROME", "100") or 100)
                except ValueError:
                    min_maj = 100
                maj = _chrome_major_version(ua_raw)
                if maj is not None and maj >= min_maj:
                    if len((request.headers.get("sec-ch-ua") or "").strip()) < 3:
                        reasons.append("chrome_like_missing_sec_ch_ua")
        if os.environ.get("ATTACK_STRICT_ACCEPT_JSON", "").strip() == "1":
            acc = (request.headers.get("accept") or "").lower()
            if "application/json" not in acc:
                reasons.append("accept_missing_application_json")

    if reasons:
        uniq = list(dict.fromkeys(reasons))
        return {
            "attacker_client_signal": "suspicious",
            "attacker_is_bot": False,
            "attacker_client_signal_detail": cap_detail(",".join(uniq)),
            "client_anomaly_flags": uniq,
        }

    return {
        "attacker_client_signal": "browser",
        "attacker_is_bot": False,
        "client_anomaly_flags": [],
    }


def _request_meta(request: Optional[Request]) -> dict:
    """Build dict for attack attempt logging: UA, IP, client classification, header snapshot, risk score."""
    out: Dict[str, Any] = {}
    if not request:
        return out
    ua_full = (request.headers.get("user-agent") or "").strip()
    if ua_full:
        out["user_agent"] = ua_full[:500]
    out.update(_classify_attack_client(request))
    snap = _client_header_snapshot(request)
    if snap:
        out["client_header_snapshot"] = snap
    out["client_risk_score"] = _compute_client_risk_score(out)
    cf_ip = (request.headers.get("cf-connecting-ip") or "").strip()
    if cf_ip:
        out["client_ip"] = cf_ip[:45]
    else:
        forwarded = (request.headers.get("x-forwarded-for") or "").strip()
        if forwarded:
            out["client_ip"] = forwarded.split(",")[0].strip()[:45]
        elif getattr(request, "client", None) and getattr(request.client, "host", None):
            out["client_ip"] = str(request.client.host)[:45]
    return out


async def _log_attack_error(
    attacker_id: str,
    attacker_username: str,
    player_message: str,
    req: Optional[Request] = None,
    *,
    extra: Optional[Dict[str, Any]] = None,
):
    """Log a failed execute attempt (validation/perm error) so admin sees every click."""
    try:
        meta = _request_meta(req)
        if extra and extra.get("integrity_violation") == "execute_token":
            _mark_execute_token_integrity_meta(meta, str(extra.get("token_failure_reason") or "execute_token_invalid"))
        doc: Dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "attacker_id": attacker_id,
            "attacker_username": attacker_username or "?",
            "outcome": "error",
            "player_message": (player_message or "")[:1000],
            "created_at": datetime.now(timezone.utc),
            **meta,
        }
        if extra:
            for k, v in extra.items():
                if v is not None and k not in doc:
                    doc[k] = v
        await db.attack_attempts.insert_one(doc)
    except Exception:
        pass


async def _insert_attack_attempt_with_fallback(
    primary_doc: Dict[str, Any],
    fallback_doc: Dict[str, Any],
    *,
    context: str,
) -> None:
    """Insert attack attempt row; if rich payload fails, log and insert minimal fallback."""
    try:
        await db.attack_attempts.insert_one(primary_doc)
        return
    except Exception:
        logger.exception("attack_attempts primary insert failed (%s)", context)

    try:
        await db.attack_attempts.insert_one(fallback_doc)
    except Exception:
        logger.exception("attack_attempts fallback insert failed (%s)", context)


async def _notify_target_if_bot_attack(
    target_id: str,
    attacker_username: str,
    outcome: str,
    location_state: Optional[str],
    player_message: str,
    attacker_is_bot: bool,
    *,
    attacker_id: str,
    target_username: str,
    meta: dict,
):
    """If the attacker was detected as a bot UA, notify all staff inboxes (throttled per attacker)."""
    if not attacker_is_bot:
        return
    try:
        await maybe_notify_staff_bot_attack_from_ua(
            attacker_id=attacker_id,
            attacker_username=attacker_username,
            target_id=target_id,
            target_username=target_username,
            outcome=outcome,
            location_state=location_state,
            player_message=player_message,
            meta=meta,
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Vendetta bodyguard-kill recording (inline — avoids cross-module ID mismatches)
# ---------------------------------------------------------------------------
async def _record_vendetta_bg_kill(
    killer_id: str, killer_fid: str, owner_id: str, owner_doc: dict,
    bg_username: str = None, bullets_used: int = 0, bg_hire_cost: int = 0,
    molotovs_used: int = 0,
):
    """
    Record a bodyguard kill into family_war_stats when the two players are in an active war.
    killer_fid   : killer's family_id (from current_user, already in hand)
    owner_doc    : the bodyguard owner's users doc (contains family_id)
    bg_username  : the bodyguard NPC/player's own username
    bullets_used : bullets fired in this attack
    molotovs_used: molotovs consumed in this attack (war feed / UI)
    bg_hire_cost : points paid when the BG was hired (stored in bodyguard doc)
    """
    try:
        # Resolve killer family — use the hint, fall back to fresh DB look-up
        k_fid = killer_fid
        if not k_fid:
            k_fid = await resolve_family_id(killer_id)

        # Resolve owner family — doc first, then DB look-up, then families.boss_id
        o_fid = (owner_doc or {}).get("family_id")
        if not o_fid:
            ou = await db.users.find_one({"id": owner_id}, {"_id": 0, "family_id": 1})
            o_fid = (ou or {}).get("family_id")
        if not o_fid:
            om = await db.family_members.find_one({"user_id": owner_id}, {"_id": 0, "family_id": 1})
            o_fid = (om or {}).get("family_id")
        if not o_fid:
            of_ = await db.families.find_one({"boss_id": owner_id}, {"_id": 0, "id": 1})
            o_fid = (of_ or {}).get("id")

        if not k_fid or not o_fid:
            logger.info("Vendetta BG kill skipped: k_fid=%s o_fid=%s", k_fid, o_fid)
            return
        if k_fid == o_fid:
            logger.info("Vendetta BG kill skipped: same family %s", k_fid)
            return

        # Find war directly between these two families (both orderings)
        war = await db.family_wars.find_one(
            {
                "$or": [
                    {"family_a_id": k_fid, "family_b_id": o_fid},
                    {"family_a_id": o_fid, "family_b_id": k_fid},
                ],
                "status": {"$in": ["active", "truce_offered"]},
            },
            {"_id": 0, "id": 1},
        )
        if not war:
            logger.info("Vendetta BG kill skipped: no war between %s and %s", k_fid, o_fid)
            return

        war_id = war["id"]
        # $set always writes family_id so it is correct even if the doc already existed
        await db.family_war_stats.update_one(
            {"war_id": war_id, "user_id": killer_id},
            {
                "$inc": {"bodyguard_kills": 1},
                "$set": {"family_id": k_fid},
                "$setOnInsert": {"war_id": war_id, "user_id": killer_id, "kills": 0, "deaths": 0, "bodyguards_lost": 0},
            },
            upsert=True,
        )
        await db.family_war_stats.update_one(
            {"war_id": war_id, "user_id": owner_id},
            {
                "$inc": {"bodyguards_lost": 1},
                "$set": {"family_id": o_fid},
                "$setOnInsert": {"war_id": war_id, "user_id": owner_id, "kills": 0, "deaths": 0, "bodyguard_kills": 0},
            },
            upsert=True,
        )
        logger.info("Vendetta BG kill recorded: war=%s killer=%s(%s) owner=%s(%s)", war_id, killer_id, k_fid, owner_id, o_fid)
        # Write to the war kill feed so the War Info tab can display individual events
        try:
            ku = await db.users.find_one({"id": killer_id}, {"_id": 0, "username": 1})
            await db.war_kill_feed.insert_one({
                "id": str(uuid.uuid4()),
                "war_id": war_id,
                "kill_type": "bodyguard",
                "killer_id": killer_id,
                "killer_username": (ku or {}).get("username", "?"),
                "killer_family_id": k_fid,
                "victim_id": owner_id,
                "victim_family_id": o_fid,
                "bg_username": bg_username,            # the bodyguard NPC's own name
                "bg_owner_username": (owner_doc or {}).get("username"),  # who hired/owns the BG
                "bullets_used": int(bullets_used or 0),
                "molotovs_used": int(molotovs_used or 0),
                "bg_hire_cost": int(bg_hire_cost or 0),
                "cash_taken": 0,
                "props_taken": 0,
                "cars_taken": 0,
                "created_at": datetime.now(timezone.utc),
            })
        except Exception as feed_exc:
            logger.exception("War kill feed (BG): %s", feed_exc)
    except Exception as exc:
        logger.exception("Vendetta BG kill error: %s", exc)


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class AttackSearchRequest(BaseModel):
    target_username: str
    note: Optional[str] = None
    captcha_token: Optional[str] = None
    captcha_nonce: Optional[str] = None

class AttackSearchResponse(BaseModel):
    attack_id: str
    status: str
    message: str
    estimated_completion: str

class AttackStatusResponse(BaseModel):
    attack_id: str
    status: str
    target_username: str
    location_state: Optional[str]
    can_travel: bool
    can_attack: bool
    message: str
    execute_token: Optional[str] = None

class AttackIdRequest(BaseModel):
    attack_id: str

class AttackDeleteRequest(BaseModel):
    attack_ids: List[str]

class AttackExecuteRequest(BaseModel):
    # Optional when execute_token is sent (preferred — avoids scrapeable UUID in request body).
    attack_id: Optional[str] = None
    death_message: Optional[str] = None
    make_public: bool = False
    bullets_to_use: Optional[int] = None
    use_molotovs: Optional[bool] = False
    # Issued when GET /attack/list or GET /attack/status shows can_attack; required if the attack row has a token.
    execute_token: Optional[str] = None
    captcha_token: Optional[str] = None
    captcha_nonce: Optional[str] = None

    @model_validator(mode="after")
    def _require_attack_handle(self):
        aid = (self.attack_id or "").strip()
        etok = (self.execute_token or "").strip()
        if len(etok) >= 16 or aid:
            return self
        raise ValueError("Provide execute_token (from My Searches when you can attack) or attack_id")

    @field_validator("bullets_to_use", mode="before")
    @classmethod
    def coerce_bullets_to_use(cls, v):
        if v is None or v == "":
            return None
        if isinstance(v, (int, float)):
            return int(v) if v > 0 else None
        if isinstance(v, str):
            try:
                n = int(v)
                return n if n > 0 else None
            except (ValueError, TypeError):
                return None
        return None

class AttackExecuteResponse(BaseModel):
    success: bool
    message: str
    rewards: Optional[Dict]
    first_bodyguard: Optional[Dict] = None

class BulletCalcRequest(BaseModel):
    target_username: str
    # When true (live preview while typing), return 200 + calc_ok:false instead of 4xx so DevTools stays clean.
    soft_fail: bool = False


class AttackTurnstileNonceRequest(BaseModel):
    action: str

# ---------------------------------------------------------------------------
# Pure helpers (no db)
# ---------------------------------------------------------------------------

def _first_bodyguard_client_payload(
    *,
    display_name: str,
    search_username: Optional[str],
    target_username: str,
) -> Dict:
    """Client-visible bodyguard hint (no slot_number — avoids slot text in toasts/UI). Audit DB rows still store slot."""
    return {
        "display_name": display_name or "bodyguard",
        "search_username": search_username,
        "target_username": target_username,
    }


# Strip from attack_attempts when returning to players (timeline / future APIs).
_PLAYER_ATTACK_ATTEMPT_META_KEYS = frozenset(
    {
        "client_ip",
        "user_agent",
        "attacker_is_bot",
        "attacker_bot_label",
        "attacker_client_signal",
        "attacker_client_signal_detail",
        "client_header_snapshot",
        "client_anomaly_flags",
        "client_risk_score",
        "integrity_violation",
        "attack_id",
        "token_failure_reason",
    }
)


def _strip_attack_attempt_for_player(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in doc.items() if k not in _PLAYER_ATTACK_ATTEMPT_META_KEYS}
    return out


def _json_safe_value(val: Any) -> Any:
    """Recursively convert BSON/datetime for JSON response."""
    if val is None or isinstance(val, (bool, int, float, str)):
        return val
    if hasattr(val, "isoformat"):
        dt = val
        if getattr(dt, "tzinfo", None) is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    if isinstance(val, dict):
        return {str(k): _json_safe_value(v) for k, v in val.items()}
    if isinstance(val, list):
        return [_json_safe_value(x) for x in val]
    return str(val)


def _iso_or_none(val) -> Optional[str]:
    if val is None:
        return None
    if hasattr(val, "isoformat"):
        dt = val
        if getattr(dt, "tzinfo", None) is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    return str(val) if val else None


def _parse_event_sort_key(val) -> datetime:
    if val is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if hasattr(val, "year"):
        dt = val
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    try:
        s = str(val).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return datetime.min.replace(tzinfo=timezone.utc)


# Fields required for /attack/list response + in-loop promotion/expiry (no full attack documents).
_ATTACK_LIST_FIELDS = {
    "_id": 0,
    "id": 1,
    "target_id": 1,
    "target_username": 1,
    "note": 1,
    "status": 1,
    "expires_at": 1,
    "search_started": 1,
    "found_at": 1,
    "location_state": 1,
    "planned_location_state": 1,
    "execute_token": 1,
}


async def _users_map_for_targets(target_ids: List[str]) -> Dict[str, dict]:
    users_map: Dict[str, dict] = {}
    if not target_ids:
        return users_map
    async for u in db.users.find(
        {"id": {"$in": target_ids}},
        {"_id": 0, "id": 1, "is_dead": 1, "is_bodyguard": 1, "is_npc": 1, "current_state": 1},
    ):
        users_map[u["id"]] = u
    return users_map


async def _bgs_by_owner_for_targets(target_ids: List[str]) -> Dict[str, List[dict]]:
    """Bodyguard slot rows for targets that hire guards — parallel-friendly vs users fetch."""
    bgs_by_owner: Dict[str, List[dict]] = {}
    if not target_ids:
        return bgs_by_owner
    _proj = {"_id": 0, "user_id": 1, "bodyguard_user_id": 1, "slot_number": 1, "robot_name": 1}
    for b in await db.bodyguards.find({"user_id": {"$in": target_ids}}, _proj).to_list(500):
        uid = b.get("user_id")
        if uid:
            bgs_by_owner.setdefault(uid, []).append(b)
    return bgs_by_owner


async def _resolve_still_bg_and_owners(bg_target_ids: List[str]) -> Tuple[Set[Any], Dict[str, Dict[str, str]]]:
    """Robot bodyguard row existence + owner username for guard targets."""
    still_bg_tids: Set[Any] = set()
    bg_owner_by_guard_uid: Dict[str, Dict[str, str]] = {}
    if not bg_target_ids:
        return still_bg_tids, bg_owner_by_guard_uid
    async for b in db.bodyguards.find(
        {"bodyguard_user_id": {"$in": bg_target_ids}},
        {"_id": 0, "bodyguard_user_id": 1, "user_id": 1},
    ):
        still_bg_tids.add(b["bodyguard_user_id"])
        gid = b.get("bodyguard_user_id")
        ouid = b.get("user_id")
        if gid and ouid:
            bg_owner_by_guard_uid[str(gid)] = {"owner_id": str(ouid), "owner_username": ""}
    owner_uid_list = list({d["owner_id"] for d in bg_owner_by_guard_uid.values() if d.get("owner_id")})
    owner_username_by_id: Dict[str, str] = {}
    if owner_uid_list:
        async for u in db.users.find({"id": {"$in": owner_uid_list}}, {"_id": 0, "id": 1, "username": 1}):
            owner_username_by_id[str(u["id"])] = str(u.get("username") or "?")
    for gid, d in list(bg_owner_by_guard_uid.items()):
        oid = d.get("owner_id")
        if oid:
            d["owner_username"] = owner_username_by_id.get(oid, "?")
    return still_bg_tids, bg_owner_by_guard_uid


async def _guard_username_map(guard_ids: List[str]) -> Dict[str, dict]:
    guard_users: Dict[str, dict] = {}
    if not guard_ids:
        return guard_users
    async for u in db.users.find(
        {"id": {"$in": guard_ids}},
        {"_id": 0, "id": 1, "username": 1},
    ):
        guard_users[u["id"]] = u
    return guard_users


async def _build_active_attacks_list(attacker_id: str, attacker_current_state: str) -> List[dict]:
    """
    Load active searches/found attacks for attacker; apply same expiry, promotions, and cleanup as GET /attack/list.
    Mutates DB (deletes expired, bulk_write status). Returns client item list.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=24)
    attacks = await db.attacks.find(
        {"attacker_id": attacker_id, "status": {"$in": ["searching", "found"]}},
        _ATTACK_LIST_FIELDS,
    ).sort("search_started", -1).to_list(None)
    if not attacks:
        return []

    target_ids = list({a["target_id"] for a in attacks if a.get("target_id")})
    users_map, bgs_by_owner = await asyncio.gather(
        _users_map_for_targets(target_ids),
        _bgs_by_owner_for_targets(target_ids),
    )

    bg_target_ids = [tid for tid in target_ids if (users_map.get(tid) or {}).get("is_bodyguard")]
    guard_ids = list(
        {
            b["bodyguard_user_id"]
            for rows in bgs_by_owner.values()
            for b in rows
            if b.get("bodyguard_user_id")
        }
    )
    # Independent: guard usernames vs bodyguard hire rows for NPC guards
    (still_bg_tids, bg_owner_by_guard_uid), guard_users = await asyncio.gather(
        _resolve_still_bg_and_owners(bg_target_ids),
        _guard_username_map(guard_ids),
    )

    delete_ids: List[str] = []
    bulk_ops: List[UpdateOne] = []
    # Status-flip ops that ALSO mint a fresh execute_token must be awaited (fire-and-forget would race with /attack/execute).
    urgent_bulk_ops: List[UpdateOne] = []
    token_deferred: List[Tuple[int, str]] = []

    items = []
    ac_state = attacker_current_state or ""
    for attack in attacks:
        exp_dt = _parse_iso_datetime(attack.get("expires_at"))
        if exp_dt is not None and exp_dt <= now:
            delete_ids.append(attack["id"])
            continue
        tid = attack.get("target_id")
        if tid:
            target_user = users_map.get(tid)
            if target_user:
                if target_user.get("is_dead"):
                    delete_ids.append(attack["id"])
                    continue
                if (
                    target_user.get("is_bodyguard")
                    and tid not in still_bg_tids
                    and target_user.get("is_npc")
                ):
                    delete_ids.append(attack["id"])
                    continue
        if not attack.get("expires_at"):
            started_iso = attack.get("search_started") or attack.get("found_at")
            try:
                started = datetime.fromisoformat(started_iso) if started_iso else None
                if started and started.tzinfo is None:
                    started = started.replace(tzinfo=timezone.utc)
            except Exception:
                started = None
            if started and started <= cutoff:
                delete_ids.append(attack["id"])
                continue
            if started:
                exp_iso = (started + timedelta(hours=24)).isoformat()
                bulk_ops.append(
                    UpdateOne(
                        {"id": attack["id"], "attacker_id": attacker_id},
                        {"$set": {"expires_at": exp_iso}},
                    )
                )
                attack["expires_at"] = exp_iso
        if attack["status"] == "searching":
            found_time = _parse_iso_datetime(attack.get("found_at"))
            if found_time is None:
                found_time = now
            if now >= found_time:
                tu = users_map.get(attack.get("target_id") or "")
                new_location = _hunt_location_when_search_timer_fires(tu, attack)
                set_fields = {"status": "found", "location_state": new_location}
                # Token-on-flip: when this attack is going to land in same-location ("can_attack"), mint the
                # execute token in the same write so the next /attack/list reuses it instead of paying for a
                # second round-trip via _ensure_execute_token. This op is awaited (urgent_bulk_ops) so the row
                # is durable before the response surfaces the token to the client.
                flip_token: Optional[str] = None
                if new_location and ac_state and new_location == ac_state and not attack.get("execute_token"):
                    flip_token = secrets.token_urlsafe(24)
                    set_fields["execute_token"] = flip_token
                op = UpdateOne({"id": attack["id"]}, {"$set": set_fields})
                if flip_token:
                    urgent_bulk_ops.append(op)
                    attack["execute_token"] = flip_token
                else:
                    bulk_ops.append(op)
                attack["status"] = "found"
                attack["location_state"] = new_location
        if attack["status"] == "found":
            tu_found = users_map.get(attack.get("target_id") or "") if attack.get("target_id") else None
            eff_loc = _resolved_target_location(attack, tu_found)
            if eff_loc and eff_loc != attack.get("location_state"):
                bulk_ops.append(
                    UpdateOne(
                        {"id": attack["id"]},
                        {"$set": {"location_state": eff_loc}},
                    )
                )
                attack["location_state"] = eff_loc
            elif eff_loc:
                attack["location_state"] = eff_loc
        can_travel = attack["status"] == "found" and attack.get("location_state") and ac_state != attack["location_state"]
        can_attack = attack["status"] == "found" and attack.get("location_state") and ac_state == attack["location_state"]
        msg = "Searching..." if attack["status"] == "searching" else (
            f"Target found in {attack['location_state']}! You are in the same location. Ready to attack!" if can_attack
            else f"Target found in {attack['location_state']}! Travel there to attack."
        )
        tu_row = users_map.get(tid or "") if tid else None
        item = {
            "attack_id": attack["id"],
            "status": attack["status"],
            "target_username": attack.get("target_username") or "?",
            "note": attack.get("note"),
            "location_state": attack.get("location_state") if attack["status"] == "found" else None,
            "search_started": attack.get("search_started"),
            "found_at": attack.get("found_at"),
            "expires_at": attack.get("expires_at"),
            "can_travel": can_travel,
            "can_attack": can_attack,
            "message": msg,
            "target_is_npc": bool((tu_row or {}).get("is_npc")) if tid else False,
            "target_is_robot_bodyguard": bool(tu_row and tu_row.get("is_npc") and tu_row.get("is_bodyguard")),
        }
        if tid:
            tu_bg = users_map.get(tid)
            if tu_bg and tu_bg.get("is_bodyguard"):
                own = bg_owner_by_guard_uid.get(str(tid))
                if own and own.get("owner_id"):
                    item["bodyguard_owner_username"] = own.get("owner_username") or "?"
                    item["bodyguard_is_mine"] = own["owner_id"] == str(attacker_id)
        # Mint execute token only when the attacker can actually strike (same location). Reuse token on row; batch mint.
        if attack["status"] == "found" and can_attack:
            existing_tok = attack.get("execute_token")
            if isinstance(existing_tok, str) and len(existing_tok) >= 16:
                item["execute_token"] = existing_tok
            else:
                token_deferred.append((len(items), attack["id"]))
        if attack["status"] == "found" and tid:
            target_bgs = bgs_by_owner.get(tid) or []
            if target_bgs:
                first_bg = max(target_bgs, key=lambda b: b.get("slot_number", 0))
                search_username = None
                display_name = first_bg.get("robot_name") or "bodyguard"
                if first_bg.get("bodyguard_user_id"):
                    bg_user = guard_users.get(first_bg["bodyguard_user_id"])
                    if bg_user:
                        search_username = bg_user.get("username")
                        if not first_bg.get("robot_name"):
                            display_name = search_username
                item["first_bodyguard"] = _first_bodyguard_client_payload(
                    display_name=display_name,
                    search_username=search_username,
                    target_username=attack.get("target_username") or "?",
                )
                item["bodyguard_count"] = len(target_bgs)
        items.append(item)

    if token_deferred:
        minted = await asyncio.gather(
            *[_ensure_execute_token(attacker_id, aid) for _, aid in token_deferred],
            return_exceptions=True,
        )
        for (idx, _), tok in zip(token_deferred, minted):
            if isinstance(tok, BaseException) or not tok:
                continue
            items[idx]["execute_token"] = tok

    # Token-bearing flips MUST be awaited so /attack/execute can find the token in the row.
    if urgent_bulk_ops:
        try:
            await db.attacks.bulk_write(urgent_bulk_ops, ordered=False)
        except Exception as e:
            logger.warning("attack/list urgent flip writeback failed: %s", e)
    # Fire-and-forget cleanup: response items already reflect the post-cleanup state in memory,
    # so we don't need to await Mongo before returning. Saves 1-2 round-trips on every /attack/list.
    if delete_ids:
        asyncio.create_task(_attack_list_writeback_delete(attacker_id, delete_ids))
    if bulk_ops:
        asyncio.create_task(_attack_list_writeback_bulk(bulk_ops))
    return items


async def _attack_list_writeback_delete(attacker_id: str, ids: List[str]) -> None:
    try:
        await db.attacks.delete_many({"attacker_id": attacker_id, "id": {"$in": ids}})
    except Exception as e:
        logger.warning("attack/list writeback delete failed: %s", e)


async def _attack_list_writeback_bulk(ops: List[UpdateOne]) -> None:
    try:
        await db.attacks.bulk_write(ops, ordered=False)
    except Exception as e:
        logger.warning("attack/list writeback bulk failed: %s", e)


def _bullets_to_kill(
    target_armour_level: int,
    target_rank_id: int,
    attacker_weapon_damage: int,
    attacker_rank_id: int,
    attacker_kill_badges: int = 0,
    victim_kill_badges: int = 0,
) -> int:
    arm = min(max(0, int(target_armour_level or 0)), 6)
    tr = min(max(1, int(target_rank_id or 1)), GODFATHER_RANK_ID)
    ar = min(max(1, int(attacker_rank_id or 1)), GODFATHER_RANK_ID)
    dmg = max(5, int(attacker_weapon_damage or 5))
    base = ARMOUR_BASE_BULLETS.get(arm, MIN_BULLETS_TO_KILL)
    gap = max(0, tr - ar)
    rank_factor = 1.0 + (tr - 1) * 0.20
    gap_factor = 1.0 + gap * 0.60
    weapon_factor = 1.0 + (dmg / 140.0)
    attacker_factor = 1.0 + (ar - 1) * 0.05
    needed_raw = (base * rank_factor * gap_factor) / weapon_factor / attacker_factor
    needed_raw *= max(0.5, 1 - attacker_kill_badges * 0.001)
    needed_raw *= 1 + victim_kill_badges * 0.001
    return max(1, int(math.ceil(needed_raw)))

def _bullets_to_kill_breakdown(
    target_armour_level: int,
    target_rank_id: int,
    attacker_weapon_damage: int,
    attacker_rank_id: int,
    attacker_kill_badges: int = 0,
    victim_kill_badges: int = 0,
) -> dict:
    arm = min(max(0, int(target_armour_level or 0)), 6)
    tr = min(max(1, int(target_rank_id or 1)), GODFATHER_RANK_ID)
    ar = min(max(1, int(attacker_rank_id or 1)), GODFATHER_RANK_ID)
    dmg = max(5, int(attacker_weapon_damage or 5))
    base = ARMOUR_BASE_BULLETS.get(arm, MIN_BULLETS_TO_KILL)
    gap = max(0, tr - ar)
    rank_factor = 1.0 + (tr - 1) * 0.20
    gap_factor = 1.0 + gap * 0.60
    weapon_factor = 1.0 + (dmg / 140.0)
    attacker_factor = 1.0 + (ar - 1) * 0.05
    needed_raw = (base * rank_factor * gap_factor) / weapon_factor / attacker_factor
    needed_raw *= max(0.5, 1 - attacker_kill_badges * 0.001)
    needed_raw *= 1 + victim_kill_badges * 0.001
    needed_before_clamp = int(math.ceil(needed_raw))
    bullets_required = max(1, needed_before_clamp)
    return {
        "base_from_armour": base,
        "rank_factor": round(rank_factor, 3),
        "gap_factor": round(gap_factor, 3),
        "weapon_factor": round(weapon_factor, 3),
        "attacker_factor": round(attacker_factor, 3),
        "rank_gap": gap,
        "needed_raw": needed_raw,
        "needed_before_clamp": needed_before_clamp,
        "bullets_required": bullets_required,
    }


# Attacker has Colt Monitor (weapon_loot) equipped: fewer bullets needed to kill.
LOOT_EXCLUSIVE_WEAPON_ATTACK_BULLET_MULT = 0.75
MAX_BULLETS_TO_KILL = 150_000
ROBOT_BODYGUARD_MAX_BULLETS_TO_KILL = 80_000

_BULLET_CALC_TARGET_PROJECTION = {
    "_id": 0,
    "id": 1,
    "username": 1,
    "is_npc": 1,
    "is_dead": 1,
    "rank_points": 1,
    "armour_level": 1,
    "completed_it_armour_bonus": 1,
    "is_bodyguard": 1,
    "created_at": 1,
    "civilian_protection_revoked_at": 1,
    "prestige_rank_multiplier": 1,
}

_SEARCH_TARGET_PROJECTION = {
    "_id": 0,
    "id": 1,
    "username": 1,
    "email": 1,
    "is_npc": 1,
    "is_bodyguard": 1,
    "is_dead": 1,
    "current_state": 1,
    "civilian_protection_revoked_at": 1,
    "created_at": 1,
}

_ATTACK_STATUS_ROW_PROJECTION = {
    "_id": 0,
    "id": 1,
    "status": 1,
    "target_id": 1,
    "target_username": 1,
    "location_state": 1,
    "planned_location_state": 1,
    "found_at": 1,
    "execute_token": 1,
}


def _apply_bullet_caps(target: dict, bullets_required: int) -> int:
    """Apply global and role-specific bullet caps."""
    capped = min(max(1, int(bullets_required)), MAX_BULLETS_TO_KILL)
    if target.get("is_bodyguard") and target.get("is_npc"):
        capped = min(capped, ROBOT_BODYGUARD_MAX_BULLETS_TO_KILL)
    return capped


async def _exclusive_car_bullet_defense_multiplier(target: dict) -> float:
    """Extra bullets to kill this target: +5% if owner has any exclusive car, +10% if any loot_exclusive (stronger wins).
    Bodyguards use their hire owner's garage (same rule as completed_it armour bonus)."""
    uid = (target.get("id") or "").strip()
    if target.get("is_bodyguard"):
        bg = await db.bodyguards.find_one(
            {"bodyguard_user_id": uid}, {"_id": 0, "user_id": 1}
        )
        uid = ((bg or {}).get("user_id") or "").strip()
    if not uid:
        return 1.0
    rows = await db.user_cars.find({"user_id": uid}, {"_id": 0, "car_id": 1}).to_list(300)
    owned = {r.get("car_id") for r in rows if r.get("car_id")}
    if not owned:
        return 1.0
    has_loot = False
    has_exclusive = False
    for car in CARS:
        cid = car.get("id")
        if not cid or cid not in owned:
            continue
        r = str(car.get("rarity") or "").strip().lower()
        if r == "loot_exclusive":
            has_loot = True
        elif r == "exclusive":
            has_exclusive = True
    if has_loot:
        return 1.10
    if has_exclusive:
        return 1.05
    return 1.0


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------

async def attack_turnstile_config(current_user: dict = Depends(get_current_user_verified)):
    return await load_attack_turnstile_config(db)


async def attack_turnstile_nonce(
    body: AttackTurnstileNonceRequest,
    req: Request,
    current_user: dict = Depends(get_current_user_verified),
):
    meta = _request_meta(req)
    return await issue_attack_turnstile_nonce(
        db,
        current_user=current_user,
        action=(body.action or "").strip().lower(),
        risk_score=int(meta.get("client_risk_score") or 0),
    )


async def search_target(payload: AttackSearchRequest, req: Request, current_user: dict = Depends(get_current_user_verified)):
    meta = _request_meta(req)
    await require_attack_turnstile(
        db,
        request=req,
        current_user=current_user,
        action="search",
        captcha_token=payload.captcha_token,
        captcha_nonce=payload.captcha_nonce,
        risk_score=int(meta.get("client_risk_score") or 0),
    )
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    await db.attacks.delete_many({"attacker_id": current_user["id"], "search_started": {"$lte": cutoff.isoformat()}})
    user_filter = _find_user_by_username_case_insensitive(payload.target_username)
    if not user_filter:
        raise HTTPException(status_code=400, detail="Target username required")
    target = await db.users.find_one(user_filter, _SEARCH_TARGET_PROJECTION)
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    if user_has_admin_list_email(target) or _is_moderator(target):
        raise HTTPException(status_code=404, detail="Target user not found")
    if target.get("is_dead"):
        raise HTTPException(status_code=400, detail="That account is dead and cannot be attacked")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot attack yourself")
    if target.get("is_npc") and not target.get("is_bodyguard"):
        hitlist_npc = await db.hitlist.find_one(
            {"target_id": target["id"], "target_type": "npc", "placer_id": current_user["id"]},
            {"_id": 1}
        )
        if not hitlist_npc:
            raise HTTPException(status_code=400, detail="You can only attack NPCs you added to your hitlist")
    # Protected new accounts lose protection when searching a real player or bodyguard (not hitlist NPC).
    allowed_hitlist_npc_only = target.get("is_npc") and not target.get("is_bodyguard")
    if is_civilian_protected(current_user) and not allowed_hitlist_npc_only:
        await maybe_revoke_civilian_protection(db, current_user["id"], "search_player")
    now = datetime.now(timezone.utc)
    override_minutes = current_user.get("search_minutes_override")
    if override_minutes is not None:
        try:
            override_minutes = int(override_minutes)
        except Exception:
            override_minutes = None
    if override_minutes is None or override_minutes <= 0:
        config = await db.game_config.find_one({"id": "main"}, {"_id": 0, "default_search_minutes": 1})
        default_mins = config and config.get("default_search_minutes")
        if default_mins is not None:
            try:
                override_minutes = int(default_mins)
            except Exception:
                override_minutes = None
    # Multiple concurrent hunts for the same target are allowed; each row has its own timer and attack_id.

    search_duration = (
        int(override_minutes)
        if override_minutes and override_minutes > 0
        else random.randint(KILL_SEARCH_RANDOM_MIN_MINUTES, KILL_SEARCH_RANDOM_MAX_MINUTES)
    )
    found_at = now + timedelta(minutes=search_duration)
    expires_at = now + timedelta(hours=24)
    attack_id = str(uuid.uuid4())
    note = (payload.note or "").strip()
    note = note[:80] if note else None
    if target.get("is_npc") and target.get("is_bodyguard"):
        # Robot bodyguard location always comes from their user doc only (not a random planned city).
        target_state = (target.get("current_state") or "").strip() or None
    else:
        target_state = target.get("current_state") if target.get("current_state") in STATES else random.choice(STATES)
    target_username = (target.get("username") or "").strip() or "?"
    await db.attacks.insert_one({
        "id": attack_id,
        "attacker_id": current_user["id"],
        "attacker_username": current_user.get("username") or "?",
        "target_id": target["id"],
        "target_username": target_username,
        "note": note,
        "status": "searching",
        "search_started": now.isoformat(),
        "found_at": found_at.isoformat(),
        "expires_at": expires_at.isoformat(),
        "planned_location_state": target_state,
        "location_state": None,
        "result": None,
        "rewards": None
    })
    _attack_list_cache_invalidate(current_user["id"])
    try:
        await db[ATTACK_CLIENT_AUDIT_COLLECTION].insert_one(
            {
                "id": str(uuid.uuid4()),
                "event": "attack_search",
                "user_id": current_user["id"],
                "username": current_user.get("username") or "?",
                "target_username": (payload.target_username or "").strip()[:64],
                "attack_id": attack_id,
                "created_at": datetime.now(timezone.utc),
                **meta,
            }
        )
    except Exception:
        pass
    return AttackSearchResponse(
        attack_id=attack_id,
        status="searching",
        message=f"Searching for {payload.target_username}...",
        estimated_completion=found_at.isoformat()
    )

async def get_attack_status(
    current_user: dict = Depends(get_current_user),
    target_username: Optional[str] = Query(None, description="If provided, prefer a FOUND attack for this target (so bot can use existing search)"),
):
    base_filter = {"attacker_id": current_user["id"], "status": {"$in": ["searching", "found", "traveling"]}}
    attack = None
    _attack_sort = [("search_started", -1)]
    if target_username and target_username.strip():
        want = (target_username or "").strip()
        # Prefer FOUND (or traveling) for this target so we use existing search instead of starting a new one
        attack = await db.attacks.find_one(
            {**base_filter, "target_username": {"$regex": f"^{re.escape(want)}$", "$options": "i"}, "status": {"$in": ["found", "traveling"]}},
            _ATTACK_STATUS_ROW_PROJECTION,
            sort=_attack_sort,
        )
        if not attack:
            attack = await db.attacks.find_one(
                {**base_filter, "target_username": {"$regex": f"^{re.escape(want)}$", "$options": "i"}, "status": "searching"},
                _ATTACK_STATUS_ROW_PROJECTION,
                sort=_attack_sort,
            )
    if not attack:
        attack = await db.attacks.find_one(base_filter, _ATTACK_STATUS_ROW_PROJECTION, sort=_attack_sort)
    if not attack:
        raise HTTPException(status_code=404, detail="No active attack")
    # If target is dead or is a bodyguard who was killed (e.g. by someone else), remove this search and return 404
    if attack.get("target_id"):
        target_user = await db.users.find_one({"id": attack["target_id"]}, {"_id": 0, "is_dead": 1, "is_bodyguard": 1})
        if target_user:
            if target_user.get("is_dead"):
                await db.attacks.delete_one({"id": attack["id"], "attacker_id": current_user["id"]})
                raise HTTPException(status_code=404, detail="No active attack")
            if target_user.get("is_bodyguard"):
                still_bg = await db.bodyguards.find_one({"bodyguard_user_id": attack["target_id"]}, {"_id": 1})
                if not still_bg:
                    await db.attacks.delete_one({"id": attack["id"], "attacker_id": current_user["id"]})
                    raise HTTPException(status_code=404, detail="No active attack")
    now = datetime.now(timezone.utc)
    found_time = _parse_iso_datetime(attack.get("found_at"))
    if found_time is None:
        found_time = now
    if attack["status"] == "searching" and now >= found_time:
        target_user = await db.users.find_one(
            {"id": attack["target_id"]},
            {"_id": 0, "current_state": 1, "is_npc": 1, "is_bodyguard": 1},
        )
        new_location = _hunt_location_when_search_timer_fires(target_user, attack)
        await db.attacks.update_one(
            {"id": attack["id"]},
            {"$set": {"status": "found", "location_state": new_location}}
        )
        attack["status"] = "found"
        attack["location_state"] = new_location
    if attack["status"] == "found" and attack.get("target_id"):
        tu_status = await db.users.find_one(
            {"id": attack["target_id"]},
            {"_id": 0, "current_state": 1, "is_npc": 1, "is_bodyguard": 1},
        )
        eff_s = _resolved_target_location(attack, tu_status)
        if eff_s and eff_s != attack.get("location_state"):
            await db.attacks.update_one({"id": attack["id"]}, {"$set": {"location_state": eff_s}})
        if eff_s:
            attack["location_state"] = eff_s
    can_travel = attack["status"] == "found" and attack.get("location_state") and current_user["current_state"] != attack["location_state"]
    can_attack = attack["status"] == "found" and attack.get("location_state") and current_user["current_state"] == attack["location_state"]
    message = ""
    if attack["status"] == "searching":
        message = "Searching..."
    elif attack["status"] == "found":
        message = f"Target found in {attack['location_state']}! You are in the same location. Ready to attack!" if can_attack else f"Target found in {attack['location_state']}! Travel there to attack."
    exec_tok = None
    if attack["status"] == "found" and can_attack:
        et = attack.get("execute_token")
        if isinstance(et, str) and len(et) >= 16:
            exec_tok = et
        else:
            exec_tok = await _ensure_execute_token(current_user["id"], attack["id"])
    return AttackStatusResponse(
        attack_id=attack["id"],
        status=attack["status"],
        target_username=attack.get("target_username") or "?",
        location_state=attack.get("location_state"),
        can_travel=can_travel,
        can_attack=can_attack,
        message=message,
        execute_token=exec_tok,
    )

async def list_attacks(current_user: dict = Depends(get_current_user)):
    attacker_id = current_user["id"]
    ac_state = (current_user.get("current_state") or "")
    cached = _attack_list_cache_get(attacker_id, ac_state)
    if cached is not None:
        # Inflation is already memoized for 3s in _get_kill_inflation_cached; the extra await is cheap.
        inflation = await _get_kill_inflation_cached(attacker_id)
        return {"attacks": cached, "inflation": inflation, "inflation_pct": int(round(inflation * 100))}
    # Run list build and inflation calc concurrently to drop one round-trip from page load.
    items, inflation = await asyncio.gather(
        _build_active_attacks_list(attacker_id, ac_state),
        _get_kill_inflation_cached(attacker_id),
    )
    _attack_list_cache_set(attacker_id, ac_state, items)
    return {"attacks": items, "inflation": inflation, "inflation_pct": int(round(inflation * 100))}

async def delete_attacks(request: AttackDeleteRequest, current_user: dict = Depends(get_current_user_verified)):
    ids = [x for x in (request.attack_ids or []) if isinstance(x, str) and x.strip()]
    ids = list(dict.fromkeys(ids))
    if not ids:
        raise HTTPException(status_code=400, detail="No attack ids provided")
    res = await db.attacks.delete_many({"attacker_id": current_user["id"], "id": {"$in": ids}})
    _attack_list_cache_invalidate(current_user["id"])
    return {"message": f"Deleted {res.deleted_count} search(es)", "deleted": res.deleted_count}

async def travel_to_target(body: AttackIdRequest, req: Request, current_user: dict = Depends(get_current_user_verified)):
    from routers.casinos.blackjack import user_has_blocking_singleplayer_blackjack
    from routers.casinos.mp_blackjack import user_in_active_mp_blackjack_game
    from routers.casinos.video_poker import user_has_active_video_poker_game

    uid = current_user.get("id")
    if await user_has_blocking_singleplayer_blackjack(uid):
        raise HTTPException(
            status_code=400,
            detail="Finish your blackjack hand before traveling.",
        )
    if await user_in_active_mp_blackjack_game(uid):
        raise HTTPException(
            status_code=400,
            detail="Finish or leave your multiplayer blackjack game before traveling.",
        )
    if await user_has_active_video_poker_game(uid):
        raise HTTPException(
            status_code=400,
            detail="Finish your video poker hand before traveling.",
        )
    attack = await db.attacks.find_one(
        {"attacker_id": current_user["id"], "status": "found", "id": body.attack_id},
        {"_id": 0}
    )
    if not attack:
        raise HTTPException(status_code=404, detail="No target found to travel to")
    tu_travel = await db.users.find_one(
        {"id": attack.get("target_id")},
        {"_id": 0, "current_state": 1, "is_npc": 1, "is_bodyguard": 1},
    )
    location_state = _resolved_target_location(attack, tu_travel)
    if not location_state:
        raise HTTPException(status_code=400, detail="Target location unknown")
    from_state = (current_user.get("current_state") or "").strip() or None
    target_un = (attack.get("target_username") or "").strip() or "?"
    tid = attack.get("target_id")
    if from_state:
        travel_msg = f"Traveled from {from_state} to {location_state} pursuing {target_un}."
    else:
        travel_msg = f"Traveled to {location_state} pursuing {target_un}."
    try:
        meta = _request_meta(req)
        await db.attack_attempts.insert_one(
            {
                "id": str(uuid.uuid4()),
                "attacker_id": uid,
                "attacker_username": current_user.get("username") or "?",
                "target_id": tid,
                "target_username": target_un,
                "attack_id": body.attack_id,
                "location_state": location_state,
                "outcome": "travel",
                "player_message": travel_msg,
                "bullets_used": 0,
                "created_at": datetime.now(timezone.utc),
                **meta,
            }
        )
    except Exception:
        pass
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"current_state": location_state}}
    )
    await log_activity(current_user["id"], current_user.get("username", "?"), "attack_travel", {"target_city": location_state})
    return {"message": f"Traveled to {location_state}"}

async def calc_bullets(request: BulletCalcRequest, current_user: dict = Depends(get_current_user_verified)):
    soft = bool(request.soft_fail)

    def _soft_err(detail: str, http_status: int):
        if soft:
            return {"calc_ok": False, "detail": detail}
        raise HTTPException(status_code=http_status, detail=detail)

    user_filter = _find_user_by_username_case_insensitive(request.target_username)
    if not user_filter:
        return _soft_err("Target username required", 400)
    target = await db.users.find_one(user_filter, _BULLET_CALC_TARGET_PROJECTION)
    if not target:
        return _soft_err("Target user not found", 404)
    if not target.get("is_npc") and is_civilian_protected(target):
        return _soft_err(CIVILIAN_PROTECTION_KILL_BLOCKED_DETAIL, 403)
    # Do not apply passive health regen here: preview does not use health for bullets_required, and skipping avoids
    # extra writes on every calc (debounced on the Attack page).
    if target.get("is_dead"):
        return _soft_err("Target is dead", 400)
    attacker_rank_id, attacker_rank_name = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
    target_rank_id, target_rank_name = get_rank_info(target.get("rank_points", 0), user_prestige_rank_mult(target))
    target_armour = int(target.get("armour_level", 0) or 0)
    attacker_kill_badges = victim_kill_badges = 0
    try:
        from routers.game.achievements import get_badge_bonuses

        async def _victim_bb():
            if target.get("is_npc"):
                return {}
            return await get_badge_bonuses(target.get("id") or "")

        inflation, weapon_pair, bb_a, bb_v = await asyncio.gather(
            _get_kill_inflation_cached(current_user["id"]),
            _best_weapon_for_user(current_user["id"], current_user.get("equipped_weapon_id")),
            get_badge_bonuses(current_user.get("id") or ""),
            _victim_bb(),
        )
        best_damage, best_weapon_name = weapon_pair
        attacker_kill_badges = bb_a.get("kills", 0) * bb_a.get("prestige_badge_mult", 1)
        victim_kill_badges = bb_v.get("kills", 0) * bb_v.get("prestige_badge_mult", 1)
    except Exception:
        inflation = await _get_kill_inflation_cached(current_user["id"])
        best_damage, best_weapon_name = await _best_weapon_for_user(current_user["id"], current_user.get("equipped_weapon_id"))
    breakdown = _bullets_to_kill_breakdown(target_armour, target_rank_id, best_damage, attacker_rank_id, attacker_kill_badges, victim_kill_badges)
    bullets_base = int(breakdown["bullets_required"])
    bullets_after_inflation = bullets_base * (1.0 + inflation)
    equipped_id = (current_user.get("equipped_weapon_id") or "").strip() or None
    mastery_pct = await _get_weapon_mastery_pct(current_user["id"], equipped_id) if equipped_id else 0
    discount = (mastery_pct / 100.0) * (MASTERY_MAX_BULLET_REDUCTION_PCT / 100.0)
    bullets_required = int(math.ceil(bullets_after_inflation * (1.0 - discount)))
    mastery_discount_pct = round(discount * 100, 1)
    # "Completed it" perk on target: 2x bullets required to attack them
    # Also applies to bodyguards if their owner has the perk
    target_armour_bonus = bool(target.get("completed_it_armour_bonus"))
    if not target_armour_bonus and target.get("is_bodyguard"):
        bg_owner_doc = await db.bodyguards.find_one({"bodyguard_user_id": target["id"]}, {"_id": 0, "user_id": 1})
        if bg_owner_doc:
            owner_user = await db.users.find_one({"id": bg_owner_doc["user_id"]}, {"_id": 0, "completed_it_armour_bonus": 1})
            target_armour_bonus = bool((owner_user or {}).get("completed_it_armour_bonus"))
    if target_armour_bonus:
        bullets_required = bullets_required * 2
    exclusive_car_bullet_mult = await _exclusive_car_bullet_defense_multiplier(target)
    if exclusive_car_bullet_mult > 1.0:
        bullets_required = int(math.ceil(bullets_required * exclusive_car_bullet_mult))
    loot_exclusive_weapon_bullet_discount = equipped_id == LOOT_EXCLUSIVE_WEAPON_ID
    if loot_exclusive_weapon_bullet_discount:
        bullets_required = max(1, int(round(bullets_required * LOOT_EXCLUSIVE_WEAPON_ATTACK_BULLET_MULT)))
    # "Completed it" perk: 65% fewer bullets needed when attacking
    completed_it_discount = bool(current_user.get("completed_it_bullet_reduction"))
    if completed_it_discount:
        bullets_required = max(1, int(bullets_required * 0.35))
    bullets_required = _apply_bullet_caps(target, bullets_required)
    return {
        "calc_ok": True,
        "target_username": target["username"],
        "target_is_npc": bool(target.get("is_npc")),
        "target_rank": target_rank_id,
        "target_rank_name": target_rank_name,
        "target_armour_level": target_armour,
        "attacker_rank": attacker_rank_id,
        "attacker_rank_name": attacker_rank_name,
        "weapon_name": best_weapon_name,
        "weapon_damage": best_damage,
        "bullets_required": bullets_required,
        "bullets_base": bullets_base,
        "inflation": inflation,
        "inflation_pct": int(round(inflation * 100)),
        "mastery_pct": mastery_pct,
        "mastery_discount_pct": mastery_discount_pct,
        "needed_before_clamp": breakdown["needed_before_clamp"],
        "completed_it_discount": completed_it_discount,
        "target_armour_bonus": target_armour_bonus,
        "exclusive_car_bullet_mult": exclusive_car_bullet_mult,
        "loot_exclusive_weapon_bullet_discount": loot_exclusive_weapon_bullet_discount,
    }

async def get_attack_inflation(current_user: dict = Depends(get_current_user)):
    inflation = await _get_kill_inflation_cached(current_user["id"])
    return {"inflation": inflation, "inflation_pct": int(round(inflation * 100))}

async def execute_attack(request: AttackExecuteRequest, req: Request, current_user: dict = Depends(get_current_user_verified)):
  try:
    meta = _request_meta(req)
    attack = await _resolve_attack_row_for_execute(
        current_user["id"],
        request.attack_id,
        request.execute_token,
    )
    if not attack:
        _fire_and_forget(_log_attack_error(current_user["id"], current_user.get("username"), "No active attack to execute", req), label="log_no_active_attack")
        raise HTTPException(status_code=404, detail="No active attack to execute")
    await require_attack_turnstile(
        db,
        request=req,
        current_user=current_user,
        action="execute",
        captcha_token=request.captcha_token,
        captcha_nonce=request.captcha_nonce,
        risk_score=int(meta.get("client_risk_score") or 0),
    )
    # Parallel: target + attacker location lookups are independent — saves one round trip
    target, attacker_row = await asyncio.gather(
        db.users.find_one({"id": attack["target_id"]}, {"_id": 0}),
        db.users.find_one({"id": current_user["id"]}, {"_id": 0, "current_state": 1}),
    )
    if not target:
        _fire_and_forget(_log_attack_error(current_user["id"], current_user.get("username"), "Target not found", req), label="log_target_not_found")
        raise HTTPException(status_code=404, detail="Target not found")
    if target.get("account_locked"):
        _fire_and_forget(
            _log_attack_error(
                current_user["id"],
                current_user.get("username"),
                ACCOUNT_LOCKED_ATTACK_BLOCK_DETAIL,
                req,
                extra={
                    "integrity_violation": "target_account_locked",
                    "attack_id": attack.get("id"),
                    "target_id": target.get("id"),
                },
            ),
            label="log_target_account_locked",
        )
        raise HTTPException(status_code=403, detail=ACCOUNT_LOCKED_ATTACK_BLOCK_DETAIL)
    target_location = _resolved_target_location(attack, target)
    if not target_location:
        _fire_and_forget(_log_attack_error(current_user["id"], current_user.get("username"), "Target location unknown; cannot attack.", req), label="log_target_location_unknown")
        raise HTTPException(status_code=400, detail="Target location unknown; cannot attack.")
    attack["location_state"] = target_location
    attacker_location = (attacker_row or {}).get("current_state") or ""
    if attacker_location != target_location:
        _fire_and_forget(_log_attack_error(current_user["id"], current_user.get("username"), "You must be in the target's location to attack or bodyguard-check. Travel there first.", req), label="log_wrong_location")
        raise HTTPException(status_code=400, detail="You must be in the target's location to attack or bodyguard-check. Travel there first.")
    stored_tok = attack.get("execute_token")
    if isinstance(stored_tok, str) and len(stored_tok) >= 16:
        if not _safe_compare_execute_token(stored_tok, request.execute_token):
            submitted_tok = (request.execute_token or "").strip()
            token_failure_reason = "execute_token_mismatch" if submitted_tok else "execute_token_missing"
            _fire_and_forget(
                _log_attack_error(
                    current_user["id"],
                    current_user.get("username"),
                    "Execute rejected: invalid or missing session token (anti-bot / scripted client).",
                    req,
                    extra={
                        "integrity_violation": "execute_token",
                        "token_failure_reason": token_failure_reason,
                        "attack_id": attack.get("id"),
                        "target_id": target.get("id"),
                        "target_username": (target.get("username") or "").strip() or "?",
                        "location_state": target_location,
                    },
                ),
                label="log_execute_token_invalid",
            )
            try:
                _tok_meta = _request_meta(req)
                _fire_and_forget(
                    maybe_notify_staff_attack_execute_token_fail(
                        db=db,
                        request=req,
                        attacker_id=str(current_user["id"]),
                        attacker_username=current_user.get("username") or "?",
                        target_id=str(target.get("id") or ""),
                        target_username=(target.get("username") or "").strip() or "?",
                        attack_id=attack.get("id"),
                        location_state=target_location,
                        client_risk_score=_tok_meta.get("client_risk_score"),
                        attacker_client_signal=_tok_meta.get("attacker_client_signal"),
                        client_anomaly_flags=_tok_meta.get("client_anomaly_flags"),
                    ),
                    label="staff_notify_token_fail",
                )
            except Exception:
                pass
            raise HTTPException(
                status_code=400,
                detail=(
                    "Do not use bots or automated tools on attacks. Use the Kill page in a normal browser. "
                    "If you are playing fairly, refresh the page and open My Searches before attacking again. "
                    "A report has been sent to staff."
                ),
            )
    if not target.get("is_npc") and is_civilian_protected(target):
        _fire_and_forget(_log_attack_error(current_user["id"], current_user.get("username"), "Target under civilian protection", req), label="log_civilian_protected")
        raise HTTPException(status_code=403, detail=CIVILIAN_PROTECTION_KILL_BLOCKED_DETAIL)
    if target.get("is_dead"):
        await db.attacks.delete_one({"id": attack["id"], "attacker_id": current_user["id"]})
        _fire_and_forget(_log_attack_error(current_user["id"], current_user.get("username"), "Target is already dead", req), label="log_target_already_dead")
        raise HTTPException(
            status_code=400,
            detail="Target is already dead. This search has been removed — refresh your list and search for another target if needed.",
        )
    if not target.get("is_npc"):
        await apply_passive_health_regen(target["id"], target)
    if user_has_admin_list_email(target) or _is_moderator(target):
        _fire_and_forget(_log_attack_error(current_user["id"], current_user.get("username"), "Target cannot be attacked", req), label="log_target_unattackable")
        raise HTTPException(status_code=403, detail="Target cannot be attacked")
    target_armour = target.get("armour_level", 0)
    attacker_rank_id, _ = get_rank_info(current_user.get("rank_points", 0), user_prestige_rank_mult(current_user))
    target_rank_id, _ = get_rank_info(target.get("rank_points", 0), user_prestige_rank_mult(target))
    attacker_armour = int(current_user.get("armour_level") or 0)
    attacker_bullets = current_user.get("bullets", 0)
    attacker_molotovs = int(current_user.get("molotovs") or 0)
    MOLOTOV_BULLET_EQUIV = 5000
    equipped_weapon_id = (current_user.get("equipped_weapon_id") or "").strip() or None

    # Require an owned and equipped gun before attacking. This avoids \"punch\" attacks
    # and gives clearer feedback when players forget to buy/equip a weapon.
    # Parallel: reads below are independent of each other (each only depends on `target`/current_user, not on prior awaits).
    # Cuts wall-clock under high traffic by removing 5 sequential round-trips.
    from routers.game.achievements import get_badge_bonuses as _get_badge_bonuses
    async def _badge_bonuses_safe(uid: str) -> dict:
        if not uid:
            return {}
        try:
            return (await _get_badge_bonuses(uid)) or {}
        except Exception:
            return {}
    (
        owned_weapons,
        inflation,
        bb_a,
        bb_v,
        exclusive_car_bullet_mult,
        target_bodyguards,
    ) = await asyncio.gather(
        db.user_weapons.find(
            {"user_id": current_user["id"], "quantity": {"$gt": 0}},
            {"_id": 0, "weapon_id": 1},
        ).to_list(100),
        _get_kill_inflation_cached(current_user["id"]),
        _badge_bonuses_safe(current_user.get("id") or ""),
        _badge_bonuses_safe(target.get("id") or "") if not target.get("is_npc") else _badge_bonuses_safe(""),
        _exclusive_car_bullet_defense_multiplier(target),
        db.bodyguards.find(
            {"user_id": target["id"]},
            {"_id": 0, "slot_number": 1, "robot_name": 1, "bodyguard_user_id": 1},
        ).to_list(10),
    )
    attacker_kill_badges = bb_a.get("kills", 0) * bb_a.get("prestige_badge_mult", 1)
    victim_kill_badges = bb_v.get("kills", 0) * bb_v.get("prestige_badge_mult", 1)

    owned_weapon_ids = {w.get("weapon_id") for w in owned_weapons if w.get("weapon_id")}
    if not owned_weapon_ids:
        _fire_and_forget(_log_attack_error(current_user["id"], current_user.get("username"), "You don't own a gun. Visit the armoury or store to buy one before you can attack.", req), label="log_no_gun")
        raise HTTPException(
            status_code=400,
            detail="You don't own a gun. Visit the armoury or store to buy one before you can attack.",
        )
    if not equipped_weapon_id or equipped_weapon_id not in owned_weapon_ids:
        _fire_and_forget(_log_attack_error(current_user["id"], current_user.get("username"), "You need to equip a gun before you can attack.", req), label="log_no_equipped_gun")
        raise HTTPException(
            status_code=400,
            detail="You need to equip a gun before you can attack.",
        )

    # Parallel: best weapon damage + per-weapon mastery; both only need a validated equipped_weapon_id.
    (best_damage, best_weapon_name), mastery_pct = await asyncio.gather(
        _best_weapon_for_user(current_user["id"], equipped_weapon_id),
        _get_weapon_mastery_pct(current_user["id"], equipped_weapon_id),
    )
    bullets_base = _bullets_to_kill(target_armour, target_rank_id, best_damage, attacker_rank_id, attacker_kill_badges, victim_kill_badges)
    discount = (mastery_pct / 100.0) * (MASTERY_MAX_BULLET_REDUCTION_PCT / 100.0)
    bullets_required = int(math.ceil(bullets_base * (1.0 + inflation) * (1.0 - discount)))
    # "Completed it" perk on target: 2x bullets required to attack them
    # Also applies to bodyguards if their owner has the perk
    target_has_armour_bonus = bool(target.get("completed_it_armour_bonus"))
    if not target_has_armour_bonus and target.get("is_bodyguard"):
        bg_owner_doc = await db.bodyguards.find_one({"bodyguard_user_id": target["id"]}, {"_id": 0, "user_id": 1})
        if bg_owner_doc:
            owner_user = await db.users.find_one({"id": bg_owner_doc["user_id"]}, {"_id": 0, "completed_it_armour_bonus": 1})
            target_has_armour_bonus = bool((owner_user or {}).get("completed_it_armour_bonus"))
    if target_has_armour_bonus:
        bullets_required = bullets_required * 2
    if exclusive_car_bullet_mult > 1.0:
        bullets_required = int(math.ceil(bullets_required * exclusive_car_bullet_mult))
    if equipped_weapon_id == LOOT_EXCLUSIVE_WEAPON_ID:
        bullets_required = max(1, int(round(bullets_required * LOOT_EXCLUSIVE_WEAPON_ATTACK_BULLET_MULT)))
    # "Completed it" perk: 65% fewer bullets needed when attacking
    if current_user.get("completed_it_bullet_reduction"):
        bullets_required = max(1, int(bullets_required * 0.35))
    bullets_required = _apply_bullet_caps(target, bullets_required)
    if attacker_bullets <= 0:
        _fire_and_forget(_log_attack_error(current_user["id"], current_user.get("username"), "You need bullets to attack.", req), label="log_no_bullets")
        raise HTTPException(status_code=400, detail="You need bullets to attack.")
    if target_bodyguards:
        first_bg = max(target_bodyguards, key=lambda b: b.get("slot_number", 0))
        display_name = first_bg.get("robot_name") or "bodyguard"
        search_username = None
        if first_bg.get("bodyguard_user_id"):
            bg_user = await db.users.find_one({"id": first_bg["bodyguard_user_id"]}, {"_id": 0, "username": 1})
            if bg_user:
                search_username = bg_user.get("username")
                if not first_bg.get("robot_name"):
                    display_name = search_username
        slot_n = first_bg.get("slot_number")
        target_name = target["username"]
        if search_username:
            msg = f"{target_name} has a bodyguard called {display_name}. You need to kill them first."
            try:
                meta = _request_meta(req)
                attempt_doc = {
                    "id": str(uuid.uuid4()),
                    "attacker_id": current_user["id"],
                    "attacker_username": current_user.get("username") or "?",
                    "target_id": target["id"],
                    "target_username": target_name,
                    "attack_id": attack.get("id"),
                    "location_state": attack.get("location_state"),
                    "outcome": "bodyguard",
                    "player_message": msg,
                    "bullets_used": 0,
                    "first_bodyguard": {"display_name": display_name, "search_username": search_username, "slot_number": slot_n, "target_username": target_name},
                    "created_at": datetime.now(timezone.utc),
                    **meta,
                }
                _fire_and_forget(db.attack_attempts.insert_one(attempt_doc), label="bg_block_attempt_log")
                _fire_and_forget(
                    _notify_target_if_bot_attack(
                        target["id"], current_user.get("username") or "?", "bodyguard",
                        attack.get("location_state"), msg, meta.get("attacker_is_bot", False),
                        attacker_id=str(current_user.get("id") or ""),
                        target_username=target_name,
                        meta=meta,
                    ),
                    label="bg_block_notify_target",
                )
            except Exception:
                pass
            return AttackExecuteResponse(
                success=False,
                message=msg,
                rewards=None,
                first_bodyguard=_first_bodyguard_client_payload(
                    display_name=display_name,
                    search_username=search_username,
                    target_username=target_name,
                ),
            )
        msg = f"{target_name} has a bodyguard. You need to kill them first."
        try:
            meta = _request_meta(req)
            attempt_doc = {
                "id": str(uuid.uuid4()),
                "attacker_id": current_user["id"],
                "attacker_username": current_user.get("username") or "?",
                "target_id": target["id"],
                "target_username": target_name,
                "attack_id": attack.get("id"),
                "location_state": attack.get("location_state"),
                "outcome": "bodyguard",
                "player_message": msg,
                "bullets_used": 0,
                "first_bodyguard": {"display_name": display_name or "bodyguard", "search_username": None, "slot_number": slot_n, "target_username": target_name},
                "created_at": datetime.now(timezone.utc),
                **meta,
            }
            _fire_and_forget(db.attack_attempts.insert_one(attempt_doc), label="bg_block_attempt_log_anon")
            _fire_and_forget(
                _notify_target_if_bot_attack(
                    target["id"], current_user.get("username") or "?", "bodyguard",
                    attack.get("location_state"), msg, meta.get("attacker_is_bot", False),
                    attacker_id=str(current_user.get("id") or ""),
                    target_username=target_name,
                    meta=meta,
                ),
                label="bg_block_notify_target_anon",
            )
        except Exception:
            pass
        return AttackExecuteResponse(
            success=False,
            message=msg,
            rewards=None,
            first_bodyguard=_first_bodyguard_client_payload(
                display_name=display_name or "bodyguard",
                search_username=None,
                target_username=target_name,
            ),
        )
    target_name = target["username"]
    target_health = float(target.get("health", DEFAULT_HEALTH))
    if not request.bullets_to_use or request.bullets_to_use < 1:
        _fire_and_forget(_log_attack_error(current_user["id"], current_user.get("username"), "You must enter how many bullets to use (at least 1).", req), label="log_zero_bullets_to_use")
        raise HTTPException(status_code=400, detail="You must enter how many bullets to use (at least 1).")

    requested_bullets = int(request.bullets_to_use)
    molotovs_used = 0
    bullets_used = 0
    effective_bullets = 0

    if request.use_molotovs and attacker_molotovs > 0:
        # Player-entered value is real bullets to fire. If molotovs are enabled,
        # auto-use only as many molotovs as needed to cover the remaining kill requirement.
        bullets_used = min(requested_bullets, attacker_bullets)
        effective_bullets = bullets_used
        shortfall = max(0, bullets_required - effective_bullets)
        if shortfall > 0:
            molotovs_needed = int(math.ceil(shortfall / MOLOTOV_BULLET_EQUIV))
            molotovs_used = min(attacker_molotovs, molotovs_needed)
            effective_bullets += molotovs_used * MOLOTOV_BULLET_EQUIV
    else:
        bullets_used = min(requested_bullets, attacker_bullets)
        effective_bullets = bullets_used
    attacker_state = ((attacker_location or current_user.get("current_state") or "").strip() or None)
    target_state = ((target.get("current_state") or "").strip() or None)
    weapon_id = (current_user.get("equipped_weapon_id") or "").strip() or None
    health_dealt_pct = min(100.0, (effective_bullets / bullets_required) * 100.0)
    killed = health_dealt_pct >= target_health
    inc_shooter = {"bullets": -bullets_used}
    if molotovs_used > 0:
        inc_shooter["molotovs"] = -molotovs_used
    ammo_filter = {"id": current_user["id"], "bullets": {"$gte": bullets_used}}
    if molotovs_used > 0:
        ammo_filter["molotovs"] = {"$gte": molotovs_used}
    ammo_result = await db.users.update_one(ammo_filter, {"$inc": inc_shooter})
    if ammo_result.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient ammunition")
    attempt_base = {
        "id": str(uuid.uuid4()),
        "attacker_id": current_user["id"],
        "attacker_username": current_user.get("username") or "?",
        "target_id": target["id"],
        "target_username": target_name,
        "attack_id": attack["id"],
        "location_state": attack.get("location_state"),
        "bullets_used": int(bullets_used),
        "molotovs_used": int(molotovs_used),
        "molotovs_available": int(attacker_molotovs),
        "bullets_required": int(bullets_required),
        "bullets_base": int(bullets_base),
        "inflation_pct": int(round(inflation * 100)),
        "target_armour_level": int(target_armour or 0),
        "target_rank_id": int(target_rank_id or 1),
        "attacker_rank_id": int(attacker_rank_id or 1),
        "attacker_armour_level": int(attacker_armour or 0),
        "weapon_id": weapon_id or None,
        "weapon_name": best_weapon_name,
        "weapon_damage": int(best_damage or 0),
        "attacker_state": attacker_state,
        "target_state": target_state,
        "state": attack.get("location_state"),
        "bullets_spent": int(effective_bullets),
        "created_at": datetime.now(timezone.utc),
    }
    if killed:
        death_message = (request.death_message or "").strip()
        make_public = bool(request.make_public)
        await _increase_kill_inflation_on_kill(current_user["id"])
        killer_id = current_user["id"]
        victim_id = target["id"]
        if target.get("is_npc"):
            hitlist_entry = await db.hitlist.find_one_and_delete({"target_id": victim_id, "target_type": "npc"}, projection={"_id": 0, "npc_rewards": 1})
            if hitlist_entry:
                rewards = hitlist_entry.get("npc_rewards") or {}
                hitlist_mult = 1.0
                try:
                    from routers.game.achievements import get_badge_bonuses
                    bb = await get_badge_bonuses(current_user.get("id") or "")
                    hitlist_mult = (1 + bb.get("hitlist_npc", 0) * 0.001) * bb.get("prestige_badge_mult", 1) * founding_member_income_mult(current_user)
                except Exception:
                    hitlist_mult = founding_member_income_mult(current_user)
                rp_added = int((rewards.get("rank_points", 0) or 0) * hitlist_mult)
                raw_bullets = int((rewards.get("bullets", 0) or 0) * hitlist_mult)
                min_bullets = math.ceil(bullets_required * 1.12)  # always profitable: reward >= cost + 12%
                inc = {
                    "money": int((rewards.get("cash", 0) or 0) * hitlist_mult),
                    "rank_points": rp_added,
                    "bullets": max(raw_bullets, min_bullets),
                    "hitlist_npc_kills": 1,
                }
                if target.get("is_bodyguard"):
                    inc["robot_bodyguard_kills"] = 1
                    inc["total_kills"] = 1
                reward_respect = int((rewards.get("respect_points", 0) or 0) * hitlist_mult)
                respect_drop = maybe_respect_points_drop()
                inc["respect_points"] = reward_respect + (respect_drop or 0)
                booze = rewards.get("booze")
                if isinstance(booze, dict) and booze:
                    booze_ids = [b["id"] for b in BOOZE_TYPES]
                    for bid, amt in booze.items():
                        if bid in booze_ids and amt and int(amt) > 0:
                            inc[f"booze_carrying.{bid}"] = int(int(amt) * hitlist_mult)
                            inc[f"booze_carrying_cost.{bid}"] = 0
                # Prestige bonus: boost NPC hitlist kill cash rewards
                from server import get_prestige_bonus as _get_prestige_bonus
                _npc_mult = _get_prestige_bonus(current_user)["npc_mult"]
                inc["money"] = int(inc.get("money", 0) * _npc_mult)
                if inc:
                    rp_before = int(current_user.get("rank_points") or 0)
                    await db.users.update_one({"id": killer_id}, apply_season_rp_mirror_to_update({"$inc": inc}))
                    if inc.get("respect_points"):
                        await log_respect_earned(killer_id, inc["respect_points"], "attack")
                    if rp_added > 0:
                        try:
                            await maybe_process_rank_up(killer_id, rp_before, rp_added, current_user.get("username", ""), user_prestige_rank_mult(current_user))
                        except Exception as e:
                            logging.exception("Rank-up notification (hitlist NPC): %s", e)
                car_id = (rewards.get("car_id") or "").strip()
                if car_id and next((c for c in CARS if c.get("id") == car_id), None):
                    await db.user_cars.insert_one({"id": str(uuid.uuid4()), "user_id": killer_id, "car_id": car_id, "acquired_at": datetime.now(timezone.utc).isoformat()})
                try:
                    await update_objectives_progress(killer_id, "hitlist_npc_kills", 1)
                except Exception:
                    pass
                now_iso = datetime.now(timezone.utc).isoformat()
                await db.users.update_one(
                    {"id": victim_id},
                    {"$set": {"is_dead": True, "dead_at": now_iso, "money": 0, "health": 0, "health_regen_last_at": now_iso}, "$inc": {"total_deaths": 1}},
                )
                await db.attacks.delete_many({"target_id": victim_id})
                try:
                    from routers.money.quicktrade import cancel_offers_on_death
                    await cancel_offers_on_death(victim_id)
                except Exception:
                    pass
                reward_parts = []
                if inc.get("money"): reward_parts.append(f"${inc['money']:,} cash")
                if inc.get("rank_points"): reward_parts.append(f"{inc['rank_points']} RP")
                if inc.get("bullets"): reward_parts.append(f"{inc['bullets']} bullets")
                if inc.get("respect_points"): reward_parts.append(f"{inc['respect_points']} respect")
                if car_id: reward_parts.append("a car")
                if isinstance(booze, dict) and booze: reward_parts.append("booze")
                success_message = f"You killed {target_name}! (NPC) You got: " + ", ".join(reward_parts) + "."
                try:
                    _fire_and_forget(
                        log_activity(
                            killer_id,
                            current_user.get("username") or "?",
                            "hitlist_npc_kill",
                            {"victim_username": target_name, "victim_id": victim_id, "rewards": rewards},
                        ),
                        label="npc_kill_log_activity",
                    )
                except Exception:
                    pass
                _is_npc_bodyguard = bool(target.get("is_bodyguard"))
                _npc_bg_owner_id = None
                _npc_bg_owner_username = None
                if _is_npc_bodyguard:
                    _vas = await db.bodyguards.find(
                        {"bodyguard_user_id": victim_id},
                        {"_id": 0, "user_id": 1},
                    ).to_list(10)
                    if not _vas and target.get("bodyguard_owner_id"):
                        _vas = [{"user_id": target["bodyguard_owner_id"]}]
                    if _vas and _vas[0].get("user_id"):
                        _npc_bg_owner_id = _vas[0]["user_id"]
                        _ou = await db.users.find_one({"id": _npc_bg_owner_id}, {"_id": 0, "username": 1})
                        _npc_bg_owner_username = (_ou or {}).get("username")
                if _is_npc_bodyguard and (_npc_bg_owner_username or "").strip():
                    own_n = str(_npc_bg_owner_username).strip()
                    success_message = success_message.rstrip() + f" They were a bodyguard for {own_n}."
                damage_done = float(target_health)
                try:
                    meta = _request_meta(req)
                    _npc_attempt_extra = {}
                    if _is_npc_bodyguard and _npc_bg_owner_id:
                        _npc_attempt_extra["bodyguard_owner_id"] = _npc_bg_owner_id
                    if _is_npc_bodyguard and _npc_bg_owner_username:
                        _npc_attempt_extra["bodyguard_owner_username"] = _npc_bg_owner_username
                    full_attempt_doc = {
                        **attempt_base,
                        "outcome": "killed",
                        "player_message": success_message,
                        "death_message": death_message or None,
                        "make_public": False,
                        "rewards": rewards,
                        "target_health_before": target_health,
                        "target_health_after": 0.0,
                        "damage_done": damage_done,
                        "is_npc_kill": True,
                        "is_bodyguard_kill": _is_npc_bodyguard,
                        "target_is_npc": True,
                        **_npc_attempt_extra,
                        **meta,
                    }
                    fallback_attempt_doc = {
                        **attempt_base,
                        "outcome": "killed",
                        "player_message": success_message,
                        "target_health_before": target_health,
                        "target_health_after": 0.0,
                        "damage_done": float(target_health),
                        "is_npc_kill": True,
                        "is_bodyguard_kill": _is_npc_bodyguard,
                        "target_is_npc": True,
                    }
                    _fire_and_forget(
                        _insert_attack_attempt_with_fallback(
                            full_attempt_doc,
                            fallback_attempt_doc,
                            context="npc_kill",
                        ),
                        label="npc_kill_attempt_log",
                    )
                except Exception:
                    logger.exception("npc kill attempt logging failed")
                _fire_and_forget(
                    send_notification(killer_id, "Hitlist NPC kill", success_message, "attack", category="attacks"),
                    label="npc_kill_notify_killer",
                )
                # If this NPC was a bodyguard (e.g. robot), do bodyguard cleanup and record vendetta war stats.
                # The whole cleanup loop runs in the background so the killer's response returns immediately;
                # it only affects the bodyguard-owner's view, which they'll see on their next refresh.
                if target.get("is_bodyguard"):
                    _bg_target_snapshot = dict(target)
                    _bg_killer_family = current_user.get("family_id")
                    _bg_killer_username = current_user.get("username") or ""
                    _bg_location_state = attack.get("location_state")
                    _bg_bullets_used = bullets_used
                    _bg_molotovs_used = molotovs_used
                    _bg_target_name = target_name
                    _bg_killer_id = killer_id
                    _bg_victim_id = victim_id

                    async def _npc_bodyguard_cleanup() -> None:
                        victim_as_bodyguard = await db.bodyguards.find({"bodyguard_user_id": _bg_victim_id}, {"_id": 0, "id": 1, "user_id": 1, "hire_cost": 1}).to_list(10)
                        if not victim_as_bodyguard and _bg_target_snapshot.get("bodyguard_owner_id"):
                            victim_as_bodyguard = [{"id": None, "user_id": _bg_target_snapshot["bodyguard_owner_id"], "hire_cost": 0}]
                        owner_ids_bg = list({bg["user_id"] for bg in victim_as_bodyguard if bg.get("user_id")})
                        owner_map_bg: Dict[str, dict] = {}
                        if owner_ids_bg:
                            async for u in db.users.find(
                                {"id": {"$in": owner_ids_bg}},
                                {"_id": 0, "id": 1, "username": 1, "family_id": 1},
                            ):
                                owner_map_bg[u["id"]] = u
                        for bg in victim_as_bodyguard:
                            owner_id = bg["user_id"]
                            owner_doc = owner_map_bg.get(owner_id)
                            bg_hire_cost = int(bg.get("hire_cost") or 0)
                            delete_criteria = {"user_id": owner_id, "bodyguard_user_id": _bg_victim_id}
                            if bg.get("id"):
                                await db.bodyguards.delete_one({"id": bg["id"]})
                            else:
                                await db.bodyguards.delete_one(delete_criteria)
                            await db.users.update_one({"id": owner_id}, _bodyguard_owner_slot_dec_update(_bg_target_snapshot, _bg_killer_id, owner_id))
                            await db.users.update_one({"id": owner_id, "bodyguard_slots": {"$lt": 0}}, {"$set": {"bodyguard_slots": 0}})
                            await _record_vendetta_bg_kill(
                                _bg_killer_id, _bg_killer_family, owner_id, owner_doc,
                                bg_username=_bg_target_name, bullets_used=_bg_bullets_used, bg_hire_cost=bg_hire_cost,
                                molotovs_used=_bg_molotovs_used,
                            )
                            try:
                                await db.hitlist_bodyguard_events.insert_one({
                                    "at": datetime.now(timezone.utc),
                                    "type": "bodyguard_killed",
                                    "owner_id": owner_id,
                                    "owner_username": (owner_doc or {}).get("username") or "",
                                    "guard_user_id": _bg_victim_id,
                                    "guard_username": _bg_target_name,
                                    "killer_id": _bg_killer_id,
                                    "killer_username": _bg_killer_username,
                                    "location_state": _bg_location_state,
                                    "hire_cost": bg_hire_cost,
                                    "bullets_used": int(_bg_bullets_used or 0),
                                })
                            except Exception:
                                logging.exception("hitlist_bodyguard_events bodyguard_killed (npc bg)")
                            remaining = await db.bodyguards.find({"user_id": owner_id}, {"_id": 0, "id": 1, "slot_number": 1}).sort("slot_number", 1).to_list(10)
                            for i, b in enumerate(remaining, 1):
                                if b["slot_number"] != i:
                                    update_criteria = {"id": b["id"]} if b.get("id") else {"user_id": owner_id, "slot_number": b["slot_number"]}
                                    await db.bodyguards.update_one(update_criteria, {"$set": {"slot_number": i}})

                    _fire_and_forget(_npc_bodyguard_cleanup(), label="npc_kill_bg_cleanup")
                return AttackExecuteResponse(success=True, message=success_message, rewards=rewards)
            # Any other is_npc (robot bodyguard, or searchable NPC not on hitlist) uses standard kill flow below
        now_iso = datetime.now(timezone.utc).isoformat()
        killer_family_doc = None
        if current_user.get("family_id"):
            killer_family_doc = await db.families.find_one({"id": current_user["family_id"]}, {"_id": 0, "name": 1})
        death_claim = await db.users.find_one_and_update(
            {"id": victim_id, "is_dead": {"$ne": True}},
            {"$set": {
                "is_dead": True,
                "dead_at": now_iso,
                "money": 0,
                "health": 0,
                "health_regen_last_at": now_iso,
                "death_by_staff": False,
                "killed_by_username": current_user.get("username"),
                "killed_by_user_id": current_user["id"],
                "killed_by_family_name": (killer_family_doc or {}).get("name"),
            }, "$inc": {"total_deaths": 1}},
        )
        if not death_claim:
            raise HTTPException(status_code=400, detail="Target is already dead")
        victim_money = int(death_claim.get("money", 0))
        cash_loot = int(victim_money * KILL_CASH_PERCENT)
        rank_points = 25
        ev = await get_effective_event()
        cash_loot = int(cash_loot * ev.get("kill_cash", 1.0))
        rank_points = int(rank_points * ev.get("rank_points", 1.0))
        victim_cars = await db.user_cars.find({"user_id": victim_id}).to_list(500)
        victim_prop_rows = await db.user_properties.find({"user_id": victim_id}).to_list(100)
        victim_cars_count = len(victim_cars)
        victim_props_count = len(victim_prop_rows)
        exclusive_car_count = 0
        for uc in victim_cars:
            car_info = next((c for c in CARS if c["id"] == uc.get("car_id")), None)
            if car_info and car_info.get("rarity") == "exclusive":
                exclusive_car_count += 1
        prop_id_list = list({up["property_id"] for up in victim_prop_rows if up.get("property_id")})
        prop_docs_by_id = {}
        if prop_id_list:
            async for p in db.properties.find(
                {"id": {"$in": prop_id_list}},
                {"_id": 0, "id": 1, "name": 1},
            ):
                prop_docs_by_id[p["id"]] = p
        prop_name_counts = {}
        for up in victim_prop_rows:
            pid = up.get("property_id")
            p = prop_docs_by_id.get(pid) if pid else None
            if p:
                name = p["name"]
                prop_name_counts[name] = prop_name_counts.get(name, 0) + 1
        prop_names = [f"{count}x {name}" if count > 1 else name for name, count in prop_name_counts.items()]
        killer_doc = await db.users.find_one({"id": killer_id}, {"_id": 0, "rank_points": 1, "username": 1, "prestige_rank_multiplier": 1})
        killer_rp_before = int((killer_doc or {}).get("rank_points") or 0)
        killer_pm = float((killer_doc or {}).get("prestige_rank_multiplier") or 1.0)
        hitlist_reward = await resolve_user_hitlist_kill(
            db,
            killer_id=killer_id,
            killer_username=current_user.get("username") or "?",
            victim_id=victim_id,
            victim_username=target_name,
        )
        kill_inc = {"money": cash_loot, "rank_points": rank_points}
        # Count kills vs real players and robot bodyguards; not vs hitlist NPCs (handled above) or other NPCs.
        if not target.get("is_npc") or target.get("is_bodyguard"):
            kill_inc["total_kills"] = 1
        if target.get("is_bodyguard") and target.get("is_npc"):
            kill_inc["robot_bodyguard_kills"] = 1
        await db.users.update_one({"id": killer_id}, apply_season_rp_mirror_to_update({"$inc": kill_inc}))
        try:
            await maybe_process_rank_up(killer_id, killer_rp_before, rank_points, (killer_doc or {}).get("username", ""), killer_pm)
        except Exception as e:
            logging.exception("Rank-up notification (kill): %s", e)
        # Transfer cars to killer; exclusive + loot-exclusive get a new id so old view-car links are dead
        killer_has_loot_car = await db.user_cars.count_documents({"user_id": killer_id, "car_id": "car21"})
        car_transfer_ops: List[Any] = []
        for uc in victim_cars:
            car_info = next((c for c in CARS if c.get("id") == uc.get("car_id")), None)
            is_loot_exclusive = car_info and car_info.get("rarity") == "loot_exclusive"
            if is_loot_exclusive:
                if killer_has_loot_car >= 1:
                    car_transfer_ops.append(DeleteOne({"_id": uc["_id"]}))
                else:
                    car_transfer_ops.append(
                        UpdateOne(
                            {"_id": uc["_id"]},
                            {
                                "$set": {"user_id": killer_id, "id": str(uuid.uuid4())},
                                "$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""},
                            },
                        )
                    )
                    killer_has_loot_car = 1
                continue
            is_exclusive = car_info and car_info.get("rarity") == "exclusive"
            if is_exclusive:
                car_transfer_ops.append(
                    UpdateOne(
                        {"_id": uc["_id"]},
                        {
                            "$set": {"user_id": killer_id, "id": str(uuid.uuid4())},
                            "$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""},
                        },
                    )
                )
            else:
                car_transfer_ops.append(
                    UpdateOne(
                        {"_id": uc["_id"]},
                        {"$set": {"user_id": killer_id}, "$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""}},
                    )
                )
        if car_transfer_ops:
            await db.user_cars.bulk_write(car_transfer_ops, ordered=False)
        from routers.money.properties import process_portfolio_kill_rewards
        from routers.kill.armoury import TOKEN_CONFIG

        portfolio_summary = await process_portfolio_kill_rewards(killer_id, victim_id, victim_prop_rows)
        cash_pf = int(portfolio_summary.get("cash_from_portfolio") or 0)
        if cash_pf > 0:
            cash_loot += cash_pf
        # On-hand cash not credited to the killer is removed from the economy (not kept for Dead > Alive).
        money_after_loot = 0
        tokens_at_death = {}
        for token_type, cfg in TOKEN_CONFIG.items():
            count_field = cfg["count_field"]
            tokens_at_death[count_field] = int(death_claim.get(count_field, 0) or 0)
        await db.users.update_one(
            {"id": victim_id},
            {"$set": {
                "points_at_death": death_claim.get("points", 0),
                "money_at_death": money_after_loot,
                "tokens_at_death": tokens_at_death,
            }}
        )
        try:
            from routers.game.families import maybe_promote_after_boss_death
            await maybe_promote_after_boss_death(victim_id)
        except Exception as e:
            logging.exception("Promote after boss death: %s", e)
        try:
            from routers.game.families import _invalidate_list_cache
            _invalidate_list_cache()
        except Exception:
            pass
        try:
            from routers.money.quicktrade import cancel_offers_on_death
            await cancel_offers_on_death(victim_id)
        except Exception as e:
            logging.exception("Quick trade offers on death: %s", e)
        # Transfer victim's racing team to killer (if victim had one and killer doesn't)
        try:
            victim_racing = await db.racing_profiles.find_one({"user_id": victim_id}, {"_id": 0, "team_name": 1, "team_color": 1})
            if victim_racing and (victim_racing.get("team_name") or "").strip():
                killer_racing = await db.racing_profiles.find_one({"user_id": killer_id}, {"_id": 0, "team_name": 1})
                if not (killer_racing or {}).get("team_name") or not ((killer_racing.get("team_name") or "").strip()):
                    await db.racing_profiles.update_one({"user_id": victim_id}, {"$unset": {"team_name": "", "team_color": ""}})
                    await db.racing_profiles.update_one(
                        {"user_id": killer_id},
                        {"$set": {"team_name": victim_racing["team_name"], "team_color": victim_racing.get("team_color") or "#e8d020"}, "$setOnInsert": {"user_id": killer_id}},
                        upsert=True,
                    )
                    await send_notification(
                        killer_id,
                        "Racing team taken",
                        f"You took {target_name}'s racing team: {victim_racing['team_name']}. You can now race.",
                        "attack",
                        category="attacks",
                    )
        except Exception as e:
            logging.exception("Racing team transfer on kill: %s", e)
        # Transfer victim's casino ownership to killer (or release if killer already has one)
        killer_owns_casino = await _user_owns_any_casino(killer_id)
        casino_colls = [
            ("dice", db.dice_ownership),
            ("roulette", db.roulette_ownership),
            ("blackjack", db.blackjack_ownership),
            ("horseracing", db.horseracing_ownership),
            ("videopoker", db.videopoker_ownership),
        ]
        killer_username = (current_user.get("username") or "").strip()
        transferred_one = False
        transferred_casino_type = None
        casino_set = {"owner_id": killer_id, "owner_username": killer_username}
        if attacker_rank_id < CAPO_RANK_ID:
            casino_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
        for _game_type, coll in casino_colls:
            if killer_owns_casino:
                await coll.update_many(
                    {"owner_id": victim_id},
                    {"$set": {"owner_id": None, "owner_username": None}},
                )
            elif not transferred_one:
                res = await coll.update_one(
                    {"owner_id": victim_id},
                    {"$set": casino_set},
                )
                if res.modified_count:
                    transferred_one = True
                    transferred_casino_type = _game_type
        if not killer_owns_casino and transferred_one:
            for _game_type, coll in casino_colls:
                await coll.update_many(
                    {"owner_id": victim_id},
                    {"$set": {"owner_id": None, "owner_username": None}},
                )
        # Transfer victim's airport to killer (or release if killer already has a property)
        killer_owns_property = await _user_owns_any_property(killer_id)
        victim_airport = await db.airport_ownership.find_one({"owner_id": victim_id}, {"_id": 0, "state": 1, "slot": 1})
        transferred_airport = False
        if victim_airport:
            if killer_owns_property:
                await db.airport_ownership.update_many(
                    {"owner_id": victim_id},
                    {"$set": {"owner_id": None, "owner_username": None}},
                )
            else:
                airport_set = {"owner_id": killer_id, "owner_username": killer_username}
                if attacker_rank_id < CAPO_RANK_ID:
                    airport_set["below_capo_acquired_at"] = datetime.now(timezone.utc)
                res = await db.airport_ownership.update_one(
                    {"owner_id": victim_id},
                    {"$set": airport_set},
                )
                if res.modified_count:
                    transferred_airport = True
                await db.airport_ownership.update_many(
                    {"owner_id": victim_id},
                    {"$set": {"owner_id": None, "owner_username": None}},
                )
        # Transfer loot-exclusive weapon: victim loses one; killer gains only if they don't have it
        victim_uw = await db.user_weapons.find_one({"user_id": victim_id, "weapon_id": "weapon_loot", "quantity": {"$gte": 1}}, {"_id": 0, "quantity": 1})
        if victim_uw:
            await db.user_weapons.update_one(
                {"user_id": victim_id, "weapon_id": "weapon_loot"},
                {"$inc": {"quantity": -1}},
            )
            killer_has_weapon = await db.user_weapons.find_one({"user_id": killer_id, "weapon_id": "weapon_loot"}, {"_id": 1})
            if not killer_has_weapon:
                await db.user_weapons.update_one(
                    {"user_id": killer_id, "weapon_id": "weapon_loot"},
                    {"$inc": {"quantity": 1}, "$set": {"acquired_at": datetime.now(timezone.utc).isoformat()}},
                    upsert=True,
                )
        # Transfer armour level 6: victim drops to 5; killer gets 6 only if they don't have it
        victim_armour = int(target.get("armour_level") or 0)
        victim_owned_max = int(target.get("armour_owned_level_max") or 0)
        if victim_armour >= 6 or victim_owned_max >= 6:
            await db.users.update_one(
                {"id": victim_id},
                {"$set": {"armour_level": 5, "armour_owned_level_max": 5}},
            )
            killer_doc = await db.users.find_one({"id": killer_id}, {"_id": 0, "armour_level": 1, "armour_owned_level_max": 1})
            k_level = int((killer_doc or {}).get("armour_level") or 0)
            k_owned = int((killer_doc or {}).get("armour_owned_level_max") or 0)
            if k_level < 6 and k_owned < 6:
                await db.users.update_one(
                    {"id": killer_id},
                    {"$set": {"armour_level": 6, "armour_owned_level_max": 6}},
                )
        # Transfer exclusive property (Speakeasy): victim loses; killer gains only if they don't have one
        victim_ep = await db.exclusive_properties.find_one({"owner_id": victim_id}, {"_id": 1})
        if victim_ep:
            killer_ep = await db.exclusive_properties.find_one({"owner_id": killer_id}, {"_id": 1})
            if killer_ep:
                await db.exclusive_properties.update_one(
                    {"owner_id": victim_id},
                    {"$set": {"owner_id": None}},
                )
            else:
                await db.exclusive_properties.update_one(
                    {"owner_id": victim_id},
                    {"$set": {"owner_id": killer_id}},
                )
        # Illegal business: victim loses it; killer gets pending reward (takeover vs liquidate via claim endpoint)
        try:
            victim_biz = await db.illegal_businesses.find_one({"user_id": victim_id}, {"_id": 0})
            if victim_biz:
                biz_id = victim_biz["id"]
                guards_snapshot = await db.illegal_business_guards.find(
                    {"business_id": biz_id}, {"_id": 0}
                ).sort("slot_number", 1).to_list(2000)
                await db.illegal_business_guards.delete_many({"business_id": biz_id})
                await db.illegal_businesses.delete_one({"id": biz_id})
                await send_notification(victim_id, "Illegal business", "You lost your illegal business.", "attack", category="attacks")
                total_spent = int(victim_biz.get("total_spent") or 0)
                from routers.money.illegal_business import _is_moderately_upgraded
                moderately_upgraded = _is_moderately_upgraded(victim_biz)
                business_snapshot = dict(victim_biz)
                killer_doc = await db.users.find_one({"id": killer_id}, {"_id": 0, "pending_illegal_business_rewards": 1})
                pending = list((killer_doc or {}).get("pending_illegal_business_rewards") or [])
                pending.append({
                    "victim_id": victim_id,
                    "victim_username": target_name,
                    "total_spent": total_spent,
                    "moderately_upgraded": moderately_upgraded,
                    "at": now_iso,
                    "has_snapshot": True,
                    "business_snapshot": business_snapshot,
                    "guards_snapshot": guards_snapshot,
                })
                await db.users.update_one({"id": killer_id}, {"$set": {"pending_illegal_business_rewards": pending}})
        except Exception as e:
            logging.exception("Illegal business on kill: %s", e)
        victim_as_bodyguard = await db.bodyguards.find({"bodyguard_user_id": victim_id}, {"_id": 0, "id": 1, "user_id": 1, "hire_cost": 1}).to_list(10)
        if not victim_as_bodyguard and target.get("is_bodyguard") and target.get("bodyguard_owner_id"):
            victim_as_bodyguard = [{"id": None, "user_id": target["bodyguard_owner_id"], "hire_cost": 0}]
        bodyguard_owner_username = None
        bodyguard_owner_id = None
        for bg in victim_as_bodyguard:
            owner_id = bg["user_id"]
            bodyguard_owner_id = owner_id
            owner_doc = await db.users.find_one({"id": owner_id}, {"_id": 0, "username": 1, "family_id": 1})
            if owner_doc:
                bodyguard_owner_username = owner_doc.get("username")
            bg_hire_cost = int(bg.get("hire_cost") or 0)
            delete_criteria = {"user_id": owner_id, "bodyguard_user_id": victim_id}
            # Remove bodyguard slot — human weekly payments are cancelled (no further payouts)
            if bg.get("id"):
                await db.bodyguards.delete_one({"id": bg["id"]})
            else:
                await db.bodyguards.delete_one(delete_criteria)
            await db.users.update_one({"id": owner_id}, _bodyguard_owner_slot_dec_update(target, killer_id, owner_id))
            await db.users.update_one({"id": owner_id, "bodyguard_slots": {"$lt": 0}}, {"$set": {"bodyguard_slots": 0}})
            # Start war BEFORE recording the kill — if this BG kill triggers the war, it won't exist yet otherwise
            killer_fid = current_user.get("family_id") or None
            owner_fid = (owner_doc or {}).get("family_id") or None
            if not owner_fid:
                om = await db.family_members.find_one({"user_id": owner_id}, {"_id": 0, "family_id": 1})
                owner_fid = (om or {}).get("family_id")
            if killer_fid and owner_fid and killer_fid != owner_fid:
                try:
                    await _family_war_start(killer_fid, owner_fid)
                except Exception as e:
                    logging.exception("Family war start on bodyguard kill: %s", e)
            await _record_vendetta_bg_kill(
                killer_id, current_user.get("family_id"), owner_id, owner_doc,
                bg_username=target_name, bullets_used=bullets_used, bg_hire_cost=bg_hire_cost,
            )
            try:
                await db.hitlist_bodyguard_events.insert_one({
                    "at": datetime.now(timezone.utc),
                    "type": "bodyguard_killed",
                    "owner_id": owner_id,
                    "owner_username": (owner_doc or {}).get("username") or "",
                    "guard_user_id": victim_id,
                    "guard_username": target_name,
                    "killer_id": killer_id,
                    "killer_username": current_user.get("username") or "",
                    "location_state": attack.get("location_state"),
                    "hire_cost": bg_hire_cost,
                    "bullets_used": int(bullets_used or 0),
                })
            except Exception:
                logging.exception("hitlist_bodyguard_events bodyguard_killed (player bg)")
            remaining = await db.bodyguards.find({"user_id": owner_id}, {"_id": 0, "id": 1, "slot_number": 1}).sort("slot_number", 1).to_list(10)
            for i, b in enumerate(remaining, 1):
                if b["slot_number"] != i:
                    update_criteria = {"id": b["id"]} if b.get("id") else {"user_id": owner_id, "slot_number": b["slot_number"]}
                    await db.bodyguards.update_one(update_criteria, {"$set": {"slot_number": i}})
        is_victim_bodyguard = bool(target.get("is_bodyguard"))
        is_victim_npc = bool(target.get("is_npc"))
        attempt_base["is_bodyguard_kill"] = is_victim_bodyguard
        attempt_base["target_is_npc"] = is_victim_npc
        if is_victim_bodyguard and bodyguard_owner_username:
            attempt_base["bodyguard_owner_username"] = bodyguard_owner_username
        if is_victim_bodyguard and bodyguard_owner_id:
            attempt_base["bodyguard_owner_id"] = bodyguard_owner_id
        success_message = f"You killed {target_name}! You got ${cash_loot:,}"
        extras = []
        if victim_props_count > 0:
            b_gain = int(portfolio_summary.get("boost_gained") or 0)
            b_after = int(portfolio_summary.get("boost_after") or 0)
            seized_parts = []
            if b_gain > 0:
                seized_parts.append(f"+{b_gain}% business income bonus (now +{b_after}%)")
            if cash_pf > 0:
                seized_parts.append(f"${cash_pf:,} from deeds at your income bonus cap")
            if seized_parts:
                extras.append("Their businesses were seized — " + " · ".join(seized_parts))
            elif prop_names:
                extras.append(
                    f"their {victim_props_count} propert{'y' if victim_props_count == 1 else 'ies'} were seized ({', '.join(prop_names)}) — none qualified for a bonus"
                )
            else:
                extras.append(
                    f"their {victim_props_count} propert{'y' if victim_props_count == 1 else 'ies'} were seized — none qualified for a bonus"
                )
        if victim_cars_count:
            c = f"their {victim_cars_count} car{'s' if victim_cars_count != 1 else ''}"
            if exclusive_car_count:
                c += f" (including {'an' if exclusive_car_count == 1 else exclusive_car_count} exclusive car{'s' if exclusive_car_count != 1 else ''})"
            extras.append(c)
        if transferred_casino_type:
            names = {"dice": "Dice", "roulette": "Roulette", "blackjack": "Blackjack", "horseracing": "Horse Racing", "videopoker": "Video Poker"}
            extras.append(f"their casino table ({names.get(transferred_casino_type, transferred_casino_type)})")
        if transferred_airport:
            extras.append("their airport")
        if extras:
            success_message += ", " + ", ".join(extras) + "."
        else:
            success_message += " and their assets."
        if target.get("is_bodyguard") and (bodyguard_owner_username or "").strip():
            success_message += f" They were a bodyguard for {str(bodyguard_owner_username).strip()}."
        hitlist_reward_parts = []
        if int(hitlist_reward.get("cash") or 0) > 0:
            hitlist_reward_parts.append(f"${int(hitlist_reward['cash']):,}")
        if int(hitlist_reward.get("points") or 0) > 0:
            hitlist_reward_parts.append(f"{int(hitlist_reward['points']):,} points")
        if hitlist_reward_parts:
            success_message += f" Hitlist reward claimed: {' + '.join(hitlist_reward_parts)}."
        if death_message:
            success_message += f' Death message: "{death_message}"'
        if make_public:
            try:
                _fire_and_forget(
                    db.public_kills.insert_one({
                        "id": str(uuid.uuid4()),
                        "killer_id": current_user["id"],
                        "killer_username": current_user.get("username") or "?",
                        "victim_id": victim_id,
                        "victim_username": target_name,
                        "death_message": death_message or None,
                        "bullets_used": bullets_used,
                        "molotovs_used": molotovs_used,
                        "bullets_required": bullets_required,
                        "make_public": True,
                        "created_at": datetime.now(timezone.utc),
                    }),
                    label="public_kill_log",
                )
            except Exception:
                pass
        await db.attacks.delete_many({"target_id": victim_id})

        # ----------------------------------------------------------------
        # Tail of the PvP kill path is pure logging / notifications / stats /
        # witness statements / family-war bookkeeping. The killer's response
        # only depends on (success_message, cash_loot, rank_points, victim_cars_count,
        # victim_props_count, exclusive_car_count) — all already computed above.
        # We run this tail in a background task so the API response returns
        # immediately. Any work that follows just lands in the DB seconds later.
        # ----------------------------------------------------------------
        _kp_killer_id = killer_id
        _kp_victim_id = victim_id
        _kp_target_name = target_name
        _kp_success_message = success_message
        _kp_best_damage = best_damage
        _kp_best_weapon_name = best_weapon_name
        _kp_bullets_used = bullets_used
        _kp_molotovs_used = molotovs_used
        _kp_target_health = target_health
        _kp_death_message = death_message
        _kp_make_public = make_public
        _kp_bullets_required = bullets_required
        _kp_attempt_base = dict(attempt_base)
        _kp_attack = dict(attack)
        _kp_target = dict(target)
        _kp_current_user = dict(current_user)
        _kp_bodyguard_owner_username = bodyguard_owner_username
        _kp_cash_loot = cash_loot
        _kp_rank_points = rank_points
        _kp_victim_cars_count = victim_cars_count
        _kp_victim_props_count = victim_props_count
        _kp_hitlist_reward = dict(hitlist_reward)
        _kp_meta_snapshot = _request_meta(req)
        _kp_has_silencer = bool(current_user.get("has_silencer"))

        async def _player_kill_post_tasks() -> None:
            _kp_killer_username = _kp_current_user.get("username") or "?"
            _fire_and_forget(
                send_notification(_kp_killer_id, "Kill", _kp_success_message, "attack", category="attacks"),
                label="player_kill_notify_killer",
            )
            max_statements = max(0, min(6, 7 - (_kp_best_damage // 20)))
            if _kp_has_silencer:
                max_statements = max(0, max_statements - 2)
            number_to_send = random.randint(1, max_statements) if max_statements >= 1 else 0
            if number_to_send > 0:
                now_w = datetime.now(timezone.utc)
                five_min_ago = now_w - timedelta(minutes=5)
                five_iso = five_min_ago.isoformat()
                now_iso = now_w.isoformat()
                location = _kp_attack.get("location_state") or "Unknown"
                time_str = now_w.strftime("%Y-%m-%d %H:%M UTC")
                if _kp_target.get("is_bodyguard"):
                    owner_un = (_kp_bodyguard_owner_username or "").strip()
                    victim_label = (
                        f"bodyguard {_kp_target_name} (guarding {owner_un})"
                        if owner_un
                        else f"bodyguard {_kp_target_name}"
                    )
                else:
                    victim_label = _kp_target_name
                _ammo_tail = ""
                if (_kp_molotovs_used or 0) > 0 and (_kp_bullets_used or 0) > 0:
                    _ammo_tail = f" Used {_kp_bullets_used:,} bullet{'s' if _kp_bullets_used != 1 else ''} and {_kp_molotovs_used:,} molotov{'s' if _kp_molotovs_used != 1 else ''}."
                elif (_kp_molotovs_used or 0) > 0:
                    _ammo_tail = f" Used {_kp_molotovs_used:,} molotov{'s' if _kp_molotovs_used != 1 else ''}."
                else:
                    _ammo_tail = f" Bullets used: {_kp_bullets_used:,}."
                witness_msg = f"{_kp_killer_username} killed {victim_label}. Weapon: {_kp_best_weapon_name}.{_ammo_tail} Location: {location}. Time: {time_str}."
                all_user_ids = await db.users.find(
                    {
                        "is_dead": {"$ne": True},
                        "is_npc": {"$ne": True},
                        "is_bodyguard": {"$ne": True},
                        "id": {"$ne": _kp_killer_id},
                        "$or": [
                            {"last_seen": {"$gte": five_iso}},
                            {"forced_online_until": {"$gt": now_iso}},
                        ],
                    },
                    {"_id": 0, "id": 1},
                ).to_list(5000)
                recipient_ids = [u["id"] for u in all_user_ids]
                if recipient_ids:
                    to_send = min(number_to_send, len(recipient_ids))
                    for uid in random.sample(recipient_ids, to_send):
                        notif = await send_notification(
                            uid,
                            "Witness statement",
                            witness_msg,
                            "attack",
                            category="attacks",
                            always_deliver=True,
                        )
                        if notif:
                            try:
                                await db.users.update_one(
                                    {"id": uid},
                                    {"$inc": {"witness_statements": 1, "witness_nav_red": 1}},
                                )
                            except Exception:
                                pass
            killer_family_id = await resolve_family_id(_kp_killer_id) or _kp_current_user.get("family_id")
            killer_family_id = str(killer_family_id).strip() if killer_family_id else None
            victim_family_id = await resolve_family_id(_kp_victim_id) or _kp_target.get("family_id")
            victim_family_id = str(victim_family_id).strip() if victim_family_id else None
            if victim_family_id and killer_family_id and killer_family_id != victim_family_id:
                try:
                    await _family_war_start(killer_family_id, victim_family_id)
                except Exception as e:
                    logging.exception("Family war start on kill: %s", e)
            if victim_family_id:
                try:
                    if killer_family_id:
                        war = await _get_active_war_between(killer_family_id, victim_family_id)
                    else:
                        war = await _get_active_war_for_family(victim_family_id)
                    if war and war.get("id"):
                        await _record_war_stats_player_kill(war["id"], _kp_killer_id, killer_family_id, _kp_victim_id, victim_family_id)
                        try:
                            await db.war_kill_feed.insert_one({
                                "id": str(uuid.uuid4()),
                                "war_id": war["id"],
                                "kill_type": "player",
                                "killer_id": _kp_killer_id,
                                "killer_username": _kp_killer_username,
                                "killer_family_id": killer_family_id,
                                "victim_id": _kp_victim_id,
                                "victim_username": _kp_target_name,
                                "victim_family_id": victim_family_id,
                                "bg_username": None,
                                "bg_owner_username": None,
                                "bullets_used": int(_kp_bullets_used or 0),
                                "molotovs_used": int(_kp_molotovs_used or 0),
                                "bg_hire_cost": 0,
                                "cash_taken": _kp_cash_loot,
                                "props_taken": _kp_victim_props_count,
                                "cars_taken": _kp_victim_cars_count,
                                "created_at": datetime.now(timezone.utc),
                            })
                        except Exception as feed_exc:
                            logging.exception("War kill feed (player): %s", feed_exc)
                except Exception as e:
                    logging.exception("War stats record on kill: %s", e)
            if victim_family_id:
                try:
                    killer_name_for_notice = _kp_killer_username if _kp_make_public else "Unknown"
                    await send_notification_to_family(
                        victim_family_id,
                        "💀 Family Member Killed",
                        f"{_kp_target_name} was killed by {killer_name_for_notice}.",
                        "attack",
                    )
                    await _family_war_check_wipe_and_award(victim_family_id, killer_family_id, _kp_killer_id)
                except Exception as e:
                    logging.exception("Family notify/war on kill: %s", e)
            try:
                damage_done = float(_kp_target_health)
                full_attempt_doc = {
                    **_kp_attempt_base,
                    "outcome": "killed",
                    "player_message": _kp_success_message,
                    "death_message": _kp_death_message or None,
                    "make_public": _kp_make_public,
                    "rewards": {
                        "money": _kp_cash_loot,
                        "rank_points": _kp_rank_points,
                        "cars_taken": _kp_victim_cars_count,
                        "properties_taken": _kp_victim_props_count,
                        "hitlist": _kp_hitlist_reward,
                    },
                    "target_health_before": _kp_target_health,
                    "target_health_after": 0.0,
                    "damage_done": damage_done,
                    **_kp_meta_snapshot,
                }
                fallback_attempt_doc = {
                    **_kp_attempt_base,
                    "outcome": "killed",
                    "player_message": _kp_success_message,
                    "target_health_before": _kp_target_health,
                    "target_health_after": 0.0,
                    "damage_done": damage_done,
                }
                await _insert_attack_attempt_with_fallback(
                    full_attempt_doc,
                    fallback_attempt_doc,
                    context="player_kill",
                )
                await _notify_target_if_bot_attack(
                    _kp_attempt_base["target_id"], _kp_killer_username, "killed",
                    _kp_attempt_base.get("location_state"), _kp_success_message, _kp_meta_snapshot.get("attacker_is_bot", False),
                    attacker_id=str(_kp_current_user.get("id") or ""),
                    target_username=_kp_target_name,
                    meta=_kp_meta_snapshot,
                )
            except Exception:
                logger.exception("player kill attempt logging failed")
            try:
                await log_activity(_kp_killer_id, _kp_killer_username, "attack_kill", {
                    "victim": _kp_target_name, "cash_loot": _kp_cash_loot, "rp": _kp_rank_points,
                    "bullets_used": _kp_bullets_used, "molotovs_used": _kp_molotovs_used,
                    "cars_taken": _kp_victim_cars_count, "props_taken": _kp_victim_props_count,
                })
            except Exception:
                logger.exception("player kill log_activity failed")

        _fire_and_forget(_player_kill_post_tasks(), label="player_kill_post_tasks")
        return AttackExecuteResponse(
            success=True,
            message=success_message,
            rewards={
                "money": cash_loot,
                "rank_points": rank_points,
                "cars_taken": victim_cars_count,
                "properties_taken": victim_props_count,
                "exclusive_cars": exclusive_car_count,
                "hitlist": hitlist_reward,
            }
        )
    else:
        damage_done = float(health_dealt_pct)
        dmg_iso = datetime.now(timezone.utc).isoformat()
        # Parallel: damage write and "last attack" status write are independent — saves one round trip
        await asyncio.gather(
            db.users.update_one(
                {"id": target["id"]},
                [{"$set": {
                    "health": {"$max": [0.0, {"$subtract": [{"$ifNull": ["$health", 100.0]}, health_dealt_pct]}]},
                    "health_regen_last_at": dmg_iso,
                }}],
            ),
            db.attacks.update_one(
                {"id": attack["id"]},
                {"$set": {"last_attack_result": "damaged", "last_attack_at": dmg_iso}}
            ),
        )
        new_health = max(0.0, target_health - health_dealt_pct)
        health_pct_str = f"{health_dealt_pct:.1f}" if health_dealt_pct != int(health_dealt_pct) else str(int(health_dealt_pct))
        if molotovs_used > 0:
            fail_message = (
                f'You failed to kill {target_name}. You used {bullets_used:,} bullet{"s" if bullets_used != 1 else ""} '
                f'and {molotovs_used:,} molotov{"s" if molotovs_used != 1 else ""} — they only lost {health_pct_str}% health.'
            )
        else:
            fail_message = f'You failed to kill {target_name}. You used {bullets_used:,} bullets — they only lost {health_pct_str}% health.'
        try:
            _fire_and_forget(
                db.attack_attempts.insert_one({
                    **attempt_base,
                    "outcome": "failed",
                    "player_message": fail_message,
                    "death_message": None,
                    "make_public": False,
                    "rewards": None,
                    "target_health_before": target_health,
                    "target_health_after": new_health,
                    "health_dealt_pct": float(health_dealt_pct),
                    "damage_done": damage_done,
                    "message": fail_message,
                    **_request_meta(req),
                }),
                label="failed_attack_attempt_log",
            )
        except Exception:
            pass
        return AttackExecuteResponse(success=False, message=fail_message, rewards=None)
  except HTTPException:
    raise
  except Exception as e:
    uid = current_user.get("id", "?") if current_user else "?"
    uname = current_user.get("username", "?") if current_user else "?"
    logger.exception(
        "execute_attack UNHANDLED ERROR user=%s (%s) attack_id=%s: %s",
        uname, uid, (getattr(request, "attack_id", None) or "?"), e,
    )
    raise HTTPException(
        status_code=500,
        detail="Attack failed due to a server error. Please report this.",
    )

TIMELINE_ATTEMPT_LIMIT = 280
TIMELINE_ACTIVITY_LIMIT = 55
TIMELINE_ACTIVE_ATTACK_CAP = 20
TIMELINE_KILL_DEDUP_SECONDS = 180


async def get_attack_timeline(
    target_username: Optional[str] = Query(None, description="Staff only: view a specific user's timeline by username"),
    current_user: dict = Depends(get_current_user),
):
    """
    Player-only merged log: full attack_attempts (sanitized), active searches/found rows,
    and activity_log attack_travel / attack_kill. IP and User-Agent are stripped.
    """
    viewer_is_staff = bool(
        _is_admin(current_user)
        or _is_moderator(current_user)
        or _is_hdo(current_user)
        or user_has_admin_list_email(current_user)
    )
    timeline_user = current_user
    if target_username and str(target_username).strip():
        if not viewer_is_staff:
            raise HTTPException(status_code=403, detail="Staff access required")
        require_staff_issued_if_staff_capable(current_user)
        tf = _find_user_by_username_case_insensitive(target_username)
        tu = await db.users.find_one(tf, {"_id": 0, "id": 1, "username": 1, "current_state": 1, "email": 1})
        if not tu:
            raise HTTPException(status_code=404, detail="User not found")
        timeline_user = tu

    uid = timeline_user["id"]
    can_view_debug_payload = viewer_is_staff
    can_view_incoming_timeline = can_view_debug_payload
    attacker_row = await db.users.find_one({"id": uid}, {"_id": 0, "current_state": 1})
    ac_state = (attacker_row or {}).get("current_state") or current_user.get("current_state") or ""
    active_items = await _build_active_attacks_list(uid, ac_state)

    attempts_query = (
        {"$or": [{"attacker_id": uid}, {"target_id": uid}]}
        if can_view_incoming_timeline
        else {"attacker_id": uid}
    )
    raw_attempts = await db.attack_attempts.find(
        attempts_query,
        {"_id": 0},
    ).sort("created_at", -1).to_list(TIMELINE_ATTEMPT_LIMIT)

    killed_signatures: List[tuple] = []
    for d in raw_attempts:
        direction = "outgoing" if d.get("attacker_id") == uid else "incoming"
        if d.get("outcome") == "killed" and direction == "outgoing":
            vn = (d.get("target_username") or "").strip().lower()
            if vn:
                killed_signatures.append((vn, _parse_event_sort_key(d.get("created_at"))))

    events: List[Dict[str, Any]] = []

    for d in raw_attempts:
        doc = dict(d)
        if not doc.get("id"):
            doc["id"] = str(uuid.uuid4())
        direction = "outgoing" if doc.get("attacker_id") == uid else "incoming"
        other = (doc.get("target_username") if direction == "outgoing" else doc.get("attacker_username")) or "?"
        outcome = doc.get("outcome") or "unknown"
        summary = (doc.get("player_message") or outcome or "")[:800]
        mv_am = int(doc.get("molotovs_used") or 0)
        if mv_am > 0:
            summary = f"{summary} · {mv_am:,} molotov{'s' if mv_am != 1 else ''}"
        stripped = _strip_attack_attempt_for_player(doc)
        events.append(
            {
                "id": f"attempt-{doc['id']}",
                "source": "attack_attempt",
                "event_type": outcome,
                "occurred_at": _iso_or_none(doc.get("created_at")),
                "direction": direction,
                "summary": summary,
                "other_username": other,
                **({"payload": _json_safe_value(stripped)} if can_view_debug_payload else {}),
            }
        )

    for it in active_items[:TIMELINE_ACTIVE_ATTACK_CAP]:
        et = "active_found" if it.get("status") == "found" else "active_search"
        ts = it.get("search_started") or it.get("found_at")
        events.append(
            {
                "id": f"active-{it.get('attack_id')}",
                "source": "active_attack",
                "event_type": et,
                "occurred_at": _iso_or_none(ts) or datetime.now(timezone.utc).isoformat(),
                "direction": "outgoing",
                "summary": it.get("message") or (et.replace("_", " ")),
                "other_username": it.get("target_username") or "?",
                **({"payload": _json_safe_value(dict(it))} if can_view_debug_payload else {}),
            }
        )

    act_docs = await db.activity_log.find(
        {"user_id": uid, "action": {"$in": ["attack_travel", "attack_kill"]}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(TIMELINE_ACTIVITY_LIMIT)

    for a in act_docs:
        action = a.get("action") or ""
        det = a.get("details") or {}
        cat = _parse_event_sort_key(a.get("created_at"))
        if action == "attack_kill":
            victim = (det.get("victim") or "").strip().lower()
            dup = False
            if victim:
                for kv, kt in killed_signatures:
                    if kv == victim and abs((cat - kt).total_seconds()) < TIMELINE_KILL_DEDUP_SECONDS:
                        dup = True
                        break
            if dup:
                continue
            cash = det.get("cash_loot")
            bu = det.get("bullets_used")
            mv = det.get("molotovs_used")
            summary = f"Kill logged: {det.get('victim', '?')}"
            if cash is not None:
                summary += f" · ${int(cash):,} loot"
            if bu is not None:
                summary += f" · {int(bu):,} bullets"
            if mv:
                summary += f" · {int(mv):,} molotovs"
        elif action == "attack_travel":
            city = det.get("target_city") or "?"
            summary = f"Traveled to {city}"
        else:
            continue
        events.append(
            {
                "id": f"activity-{a.get('id') or uuid.uuid4().hex}",
                "source": "activity_log",
                "event_type": action,
                "occurred_at": _iso_or_none(a.get("created_at")),
                "direction": "outgoing",
                "summary": summary,
                "other_username": (det.get("victim") if action == "attack_kill" else None) or "—",
                **({"payload": _json_safe_value({"action": action, "details": det})} if can_view_debug_payload else {}),
            }
        )

    events.sort(key=lambda e: _parse_event_sort_key(e.get("occurred_at")), reverse=True)
    return {
        "events": events,
        "subject_username": (timeline_user.get("username") or "").strip() or None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


async def get_attack_attempts(current_user: dict = Depends(get_current_user)):
    """Player attempt history (outgoing always, incoming only if real damage / kill).

    DB-side filter cuts >80% of rows on busy users (bodyguard blocks, validation errors,
    zero-bullet entries) so we transfer ~120 rows max instead of 500. Projection trims
    each doc to fields the UI actually renders.
    """
    uid = current_user["id"]
    # bullets_used > 0 is always required (skip validation/error/bodyguard-block rows).
    # For outgoing: include any row with bullets used.
    # For incoming: only kills, or attempts that actually hit (health_dealt_pct/damage_done > 0).
    base_filter = {"bullets_used": {"$gt": 0}}
    incoming_real_damage = {
        "$or": [
            {"outcome": "killed"},
            {"health_dealt_pct": {"$gt": 0}},
            {"damage_done": {"$gt": 0}},
        ]
    }
    query = {
        **base_filter,
        "$or": [
            {"attacker_id": uid},
            {"$and": [{"target_id": uid}, incoming_real_damage]},
        ],
    }
    projection = {
        "_id": 0,
        "id": 1,
        "attacker_id": 1,
        "target_id": 1,
        "attacker_username": 1,
        "target_username": 1,
        "outcome": 1,
        "bullets_used": 1,
        "molotovs_used": 1,
        "bullets_required": 1,
        "rewards": 1,
        "is_bodyguard_kill": 1,
        "bodyguard_owner_username": 1,
        "death_message": 1,
        "health_dealt_pct": 1,
        "damage_done": 1,
        "created_at": 1,
    }
    docs = await db.attack_attempts.find(query, projection).sort("created_at", -1).to_list(200)
    for d in docs:
        if not d.get("id"):
            d["id"] = str(uuid.uuid4())
        d["direction"] = "outgoing" if d.get("attacker_id") == uid else "incoming"
    return {"attempts": docs}


KILL_FAVORITE_TARGETS_MAX = 80


def _normalize_kill_favorite_username(s: Optional[str]) -> str:
    return (s or "").strip().lower()[:120]


def _sanitize_kill_favorite_list(raw: Any) -> List[str]:
    if not isinstance(raw, list):
        return []
    out: List[str] = []
    seen: Set[str] = set()
    for x in raw:
        n = _normalize_kill_favorite_username(str(x))
        if n and n not in seen:
            seen.add(n)
            out.append(n)
        if len(out) >= KILL_FAVORITE_TARGETS_MAX:
            break
    return out


class KillFavoriteToggleBody(BaseModel):
    target_username: str


async def get_kill_favorites(current_user: dict = Depends(get_current_user)):
    """Starred search targets by username — persists across devices (stored on user doc)."""
    u = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "kill_favorite_targets": 1})
    targets = _sanitize_kill_favorite_list((u or {}).get("kill_favorite_targets"))
    return {"targets": targets}


async def post_kill_favorites_toggle(
    body: KillFavoriteToggleBody,
    current_user: dict = Depends(get_current_user_verified),
):
    target = _normalize_kill_favorite_username(body.target_username)
    if not target:
        raise HTTPException(status_code=400, detail="Username required")
    uid = current_user["id"]
    u = await db.users.find_one({"id": uid}, {"_id": 0, "kill_favorite_targets": 1})
    cur = _sanitize_kill_favorite_list((u or {}).get("kill_favorite_targets"))
    if target in cur:
        nxt = [x for x in cur if x != target]
        favorited = False
    else:
        if len(cur) >= KILL_FAVORITE_TARGETS_MAX:
            raise HTTPException(status_code=400, detail="Favorite list is full")
        nxt = cur + [target]
        favorited = True
    await db.users.update_one({"id": uid}, {"$set": {"kill_favorite_targets": nxt}})
    return {"targets": nxt, "favorited": favorited}


def register(router):
    # Sustained RL only on mutating / costly POSTs. GET list/inflation/timeline were each doing find+update on
    # sustained_page_rl_state; parallel page load (5+ GETs & 10s polling) spammed DB and could trip kill-chain RL on POSTs.
    _kill_rl_v = [Depends(_kill_sustained_rl_verified)]
    _attack_button_rl_v = [Depends(_attack_micro_cooldown), Depends(_kill_sustained_rl_verified)]
    router.add_api_route("/attack/turnstile-config", attack_turnstile_config, methods=["GET"])
    router.add_api_route("/attack/turnstile-nonce", attack_turnstile_nonce, methods=["POST"], dependencies=_kill_rl_v)
    router.add_api_route("/attack/search", search_target, methods=["POST"], response_model=AttackSearchResponse, dependencies=_attack_button_rl_v)
    router.add_api_route("/attack/status", get_attack_status, methods=["GET"], response_model=AttackStatusResponse)
    router.add_api_route("/attack/list", list_attacks, methods=["GET"])
    router.add_api_route("/attack/delete", delete_attacks, methods=["POST"], dependencies=_kill_rl_v)
    router.add_api_route("/attack/travel", travel_to_target, methods=["POST"], dependencies=_kill_rl_v)
    router.add_api_route("/attack/bullets/calc", calc_bullets, methods=["POST"], dependencies=_kill_rl_v)
    router.add_api_route("/attack/inflation", get_attack_inflation, methods=["GET"])
    router.add_api_route("/attack/execute", execute_attack, methods=["POST"], response_model=AttackExecuteResponse, dependencies=_attack_button_rl_v)
    router.add_api_route("/attack/attempts", get_attack_attempts, methods=["GET"])
    router.add_api_route("/attack/timeline", get_attack_timeline, methods=["GET"])
    router.add_api_route("/attack/favorites", get_kill_favorites, methods=["GET"])
    router.add_api_route("/attack/favorites/toggle", post_kill_favorites_toggle, methods=["POST"], dependencies=_kill_rl_v)
