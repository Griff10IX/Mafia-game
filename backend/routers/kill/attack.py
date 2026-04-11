# Attack endpoints: search, status, list, delete, travel, bullets/calc, inflation, execute, attempts
from typing import Any, List, Optional, Dict
from datetime import datetime, timezone, timedelta
import math
import random
import re
import secrets
import uuid
import os
import sys
import logging
from fastapi import Depends, HTTPException, Request, Query
from pydantic import BaseModel, field_validator
from pymongo import UpdateOne

logger = logging.getLogger(__name__)

_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend not in sys.path:
    sys.path.insert(0, _backend)
from server import (
    db,
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
    ADMIN_EMAILS,
    _is_admin,
    _is_hdo,
    _is_moderator,
    CAPO_RANK_ID,
    GODFATHER_RANK_ID,
    get_rank_info,
    get_effective_event,
    log_respect_earned,
    send_notification,
    send_notification_to_family,
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
from utils.kill_search_duration import KILL_SEARCH_RANDOM_MAX_MINUTES, KILL_SEARCH_RANDOM_MIN_MINUTES
from utils.release_soft_launch import PVP_KILLS_DISABLED_DETAIL, soft_launch_blocks_pvp_kill_on_target
from utils.civilian_protection import (
    CIVILIAN_PROTECTION_KILL_BLOCKED_DETAIL,
    is_civilian_protected,
    maybe_revoke_civilian_protection,
)
from routers.money.booze_run import BOOZE_TYPES
from routers.account.objectives import update_objectives_progress
from routers.kill.armoury import _best_weapon_for_user, _get_weapon_mastery_pct, MASTERY_MAX_BULLET_REDUCTION_PCT
from routers.game.families import resolve_family_id
from utils.staff_bot_client_alert import maybe_notify_staff_bot_attack_from_ua, maybe_notify_staff_attack_execute_token_fail


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


async def _ensure_execute_token(attacker_id: str, attack_id: str) -> Optional[str]:
    """
    Mint a per-attack token when the client can execute (same location as target).
    Lazy scripts that only POST /attack/execute never see this value until they poll list or status.
    """
    doc = await db.attacks.find_one({"id": attack_id, "attacker_id": attacker_id}, {"_id": 0, "execute_token": 1})
    if not doc:
        return None
    t = doc.get("execute_token")
    if isinstance(t, str) and len(t) >= 16:
        return t
    new_t = secrets.token_urlsafe(24)
    await db.attacks.update_one(
        {"id": attack_id, "attacker_id": attacker_id, "$or": [{"execute_token": {"$exists": False}}, {"execute_token": None}, {"execute_token": ""}]},
        {"$set": {"execute_token": new_t}},
    )
    doc2 = await db.attacks.find_one({"id": attack_id, "attacker_id": attacker_id}, {"_id": 0, "execute_token": 1})
    out = (doc2 or {}).get("execute_token")
    return out if isinstance(out, str) and len(out) >= 16 else new_t


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


_CLIENT_SIGNAL_DETAIL_MAX = 80


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
    """
    if not request:
        return {}
    ua_raw = (request.headers.get("user-agent") or "").strip()
    ua_l = ua_raw.lower()

    def cap_detail(s: str) -> str:
        return (s or "")[:_CLIENT_SIGNAL_DETAIL_MAX]

    if ua_raw and _is_automation_ua(ua_raw):
        lab = _automation_label_from_ua(ua_raw)
        return {
            "attacker_client_signal": "automation",
            "attacker_is_bot": True,
            "attacker_bot_label": lab[:120],
        }
    if ua_raw and _is_script_http_client_ua(ua_raw):
        label = _script_label_from_ua(ua_raw) or "Script / HTTP client"
        return {
            "attacker_client_signal": "script",
            "attacker_is_bot": True,
            "attacker_bot_label": label[:120],
        }

    suspicious_reason: Optional[str] = None
    if len(ua_raw) < 12:
        suspicious_reason = "empty_or_short_ua"
    elif "mozilla" in ua_l and "chrome" in ua_l:
        # Browsers sending credentialed XHR/fetch to API usually include Sec-Fetch-Mode; many spoofed scripts omit it.
        if not request.headers.get("sec-fetch-mode"):
            suspicious_reason = "chrome_like_no_sec_fetch_mode"
    if suspicious_reason:
        return {
            "attacker_client_signal": "suspicious",
            "attacker_is_bot": False,
            "attacker_client_signal_detail": cap_detail(suspicious_reason),
        }

    return {
        "attacker_client_signal": "browser",
        "attacker_is_bot": False,
    }


def _request_meta(request: Optional[Request]) -> dict:
    """Build dict for attack attempt logging: UA, IP, tiered client classification."""
    out: Dict[str, Any] = {}
    if request:
        ua_full = (request.headers.get("user-agent") or "").strip()
        if ua_full:
            out["user_agent"] = ua_full[:500]
        out.update(_classify_attack_client(request))
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
):
    """
    Record a bodyguard kill into family_war_stats when the two players are in an active war.
    killer_fid   : killer's family_id (from current_user, already in hand)
    owner_doc    : the bodyguard owner's users doc (contains family_id)
    bg_username  : the bodyguard NPC/player's own username
    bullets_used : bullets fired in this attack
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
    attack_id: str
    death_message: Optional[str] = None
    make_public: bool = False
    bullets_to_use: Optional[int] = None
    use_molotovs: Optional[bool] = False
    # Issued when GET /attack/list or GET /attack/status shows can_attack; required if the attack row has a token.
    execute_token: Optional[str] = None

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
        "integrity_violation",
        "attack_id",
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


async def _build_active_attacks_list(attacker_id: str, attacker_current_state: str) -> List[dict]:
    """
    Load active searches/found attacks for attacker; apply same expiry, promotions, and cleanup as GET /attack/list.
    Mutates DB (deletes expired, bulk_write status). Returns client item list.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=24)
    attacks = await db.attacks.find(
        {"attacker_id": attacker_id, "status": {"$in": ["searching", "found"]}},
        {"_id": 0},
    ).sort("search_started", -1).to_list(None)
    if not attacks:
        return []

    target_ids = list({a["target_id"] for a in attacks if a.get("target_id")})
    users_map: Dict[str, dict] = {}
    if target_ids:
        async for u in db.users.find(
            {"id": {"$in": target_ids}},
            {"_id": 0, "id": 1, "is_dead": 1, "is_bodyguard": 1, "is_npc": 1, "current_state": 1},
        ):
            users_map[u["id"]] = u

    bg_target_ids = [tid for tid in target_ids if (users_map.get(tid) or {}).get("is_bodyguard")]
    still_bg_tids = set()
    if bg_target_ids:
        async for b in db.bodyguards.find(
            {"bodyguard_user_id": {"$in": bg_target_ids}},
            {"_id": 0, "bodyguard_user_id": 1},
        ):
            still_bg_tids.add(b["bodyguard_user_id"])

    bgs_by_owner: Dict[str, List[dict]] = {}
    if target_ids:
        for b in await db.bodyguards.find({"user_id": {"$in": target_ids}}, {"_id": 0}).to_list(500):
            uid = b.get("user_id")
            if uid:
                bgs_by_owner.setdefault(uid, []).append(b)
    guard_ids = list(
        {
            b["bodyguard_user_id"]
            for rows in bgs_by_owner.values()
            for b in rows
            if b.get("bodyguard_user_id")
        }
    )
    guard_users: Dict[str, dict] = {}
    if guard_ids:
        async for u in db.users.find(
            {"id": {"$in": guard_ids}},
            {"_id": 0, "id": 1, "username": 1},
        ):
            guard_users[u["id"]] = u

    delete_ids: List[str] = []
    bulk_ops: List[UpdateOne] = []

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
                bulk_ops.append(
                    UpdateOne(
                        {"id": attack["id"]},
                        {"$set": {"status": "found", "location_state": new_location}},
                    )
                )
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
            "target_is_npc": bool((users_map.get(tid or "") or {}).get("is_npc")) if tid else False,
        }
        # Mint server-side token as soon as the hunt is "found" (any list refresh). Execute requires it once set,
        # so scripts that only POST /execute without polling list fail. Only return the token to the client when can_attack.
        if attack["status"] == "found":
            tok = await _ensure_execute_token(attacker_id, attack["id"])
            if can_attack and tok:
                item["execute_token"] = tok
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

    if delete_ids:
        await db.attacks.delete_many({"attacker_id": attacker_id, "id": {"$in": delete_ids}})
    if bulk_ops:
        await db.attacks.bulk_write(bulk_ops, ordered=False)
    return items


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

async def search_target(request: AttackSearchRequest, current_user: dict = Depends(get_current_user_verified)):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    await db.attacks.delete_many({"attacker_id": current_user["id"], "search_started": {"$lte": cutoff.isoformat()}})
    user_filter = _find_user_by_username_case_insensitive(request.target_username)
    if not user_filter:
        raise HTTPException(status_code=400, detail="Target username required")
    target = await db.users.find_one(user_filter, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    if target.get("email") in ADMIN_EMAILS:
        raise HTTPException(status_code=404, detail="Target user not found")
    if _is_moderator(target):
        raise HTTPException(status_code=404, detail="Target user not found")
    if target.get("is_dead"):
        raise HTTPException(status_code=400, detail="That account is dead and cannot be attacked")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot attack yourself")
    if await soft_launch_blocks_pvp_kill_on_target(db, target):
        raise HTTPException(status_code=403, detail=PVP_KILLS_DISABLED_DETAIL)
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
    note = (request.note or "").strip()
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
    return AttackSearchResponse(
        attack_id=attack_id,
        status="searching",
        message=f"Searching for {request.target_username}...",
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
            {"_id": 0},
            sort=_attack_sort,
        )
        if not attack:
            attack = await db.attacks.find_one(
                {**base_filter, "target_username": {"$regex": f"^{re.escape(want)}$", "$options": "i"}, "status": "searching"},
                {"_id": 0},
                sort=_attack_sort,
            )
    if not attack:
        attack = await db.attacks.find_one(base_filter, {"_id": 0}, sort=_attack_sort)
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
    if attack["status"] == "found":
        ensured = await _ensure_execute_token(current_user["id"], attack["id"])
        if can_attack:
            exec_tok = ensured
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
    items = await _build_active_attacks_list(attacker_id, ac_state)
    return {"attacks": items}

async def delete_attacks(request: AttackDeleteRequest, current_user: dict = Depends(get_current_user_verified)):
    ids = [x for x in (request.attack_ids or []) if isinstance(x, str) and x.strip()]
    ids = list(dict.fromkeys(ids))
    if not ids:
        raise HTTPException(status_code=400, detail="No attack ids provided")
    res = await db.attacks.delete_many({"attacker_id": current_user["id"], "id": {"$in": ids}})
    return {"message": f"Deleted {res.deleted_count} search(es)", "deleted": res.deleted_count}

async def travel_to_target(request: AttackIdRequest, current_user: dict = Depends(get_current_user_verified)):
    attack = await db.attacks.find_one(
        {"attacker_id": current_user["id"], "status": "found", "id": request.attack_id},
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
    target = await db.users.find_one(user_filter, {"_id": 0})
    if not target:
        return _soft_err("Target user not found", 404)
    if await soft_launch_blocks_pvp_kill_on_target(db, target):
        return _soft_err(PVP_KILLS_DISABLED_DETAIL, 403)
    if not target.get("is_npc") and is_civilian_protected(target):
        return _soft_err(CIVILIAN_PROTECTION_KILL_BLOCKED_DETAIL, 403)
    if not target.get("is_npc"):
        await apply_passive_health_regen(target["id"], target)
    if target.get("is_dead"):
        return _soft_err("Target is dead", 400)
    attacker_rank_id, attacker_rank_name = get_rank_info(current_user.get("rank_points", 0))
    target_rank_id, target_rank_name = get_rank_info(target.get("rank_points", 0))
    target_armour = int(target.get("armour_level", 0) or 0)
    inflation = await _apply_kill_inflation_decay(current_user["id"])
    best_damage, best_weapon_name = await _best_weapon_for_user(current_user["id"], current_user.get("equipped_weapon_id"))
    attacker_kill_badges = victim_kill_badges = 0
    try:
        from routers.game.achievements import get_badge_bonuses
        bb_a = await get_badge_bonuses(current_user.get("id") or "")
        bb_v = await get_badge_bonuses(target.get("id") or "") if not target.get("is_npc") else {}
        attacker_kill_badges = bb_a.get("kills", 0) * bb_a.get("prestige_badge_mult", 1)
        victim_kill_badges = bb_v.get("kills", 0) * bb_v.get("prestige_badge_mult", 1)
    except Exception:
        pass
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
    # "Completed it" perk: 65% fewer bullets needed when attacking
    completed_it_discount = bool(current_user.get("completed_it_bullet_reduction"))
    if completed_it_discount:
        bullets_required = max(1, int(bullets_required * 0.35))
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
    }

async def get_attack_inflation(current_user: dict = Depends(get_current_user)):
    inflation = await _apply_kill_inflation_decay(current_user["id"])
    return {"inflation": inflation, "inflation_pct": int(round(inflation * 100))}

async def execute_attack(request: AttackExecuteRequest, req: Request, current_user: dict = Depends(get_current_user_verified)):
  try:
    attack = await db.attacks.find_one(
        {"attacker_id": current_user["id"], "status": "found", "id": request.attack_id},
        {"_id": 0}
    )
    if not attack:
        await _log_attack_error(current_user["id"], current_user.get("username"), "No active attack to execute", req)
        raise HTTPException(status_code=404, detail="No active attack to execute")
    target = await db.users.find_one({"id": attack["target_id"]}, {"_id": 0})
    if not target:
        await _log_attack_error(current_user["id"], current_user.get("username"), "Target not found", req)
        raise HTTPException(status_code=404, detail="Target not found")
    target_location = _resolved_target_location(attack, target)
    if not target_location:
        await _log_attack_error(current_user["id"], current_user.get("username"), "Target location unknown; cannot attack.", req)
        raise HTTPException(status_code=400, detail="Target location unknown; cannot attack.")
    attack["location_state"] = target_location
    # Re-fetch attacker location from DB so we never use stale state (e.g. after instant travel)
    attacker_row = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "current_state": 1})
    attacker_location = (attacker_row or {}).get("current_state") or ""
    if attacker_location != target_location:
        await _log_attack_error(current_user["id"], current_user.get("username"), "You must be in the target's location to attack or bodyguard-check. Travel there first.", req)
        raise HTTPException(status_code=400, detail="You must be in the target's location to attack or bodyguard-check. Travel there first.")
    stored_tok = attack.get("execute_token")
    if isinstance(stored_tok, str) and len(stored_tok) >= 16:
        if not _safe_compare_execute_token(stored_tok, request.execute_token):
            await _log_attack_error(
                current_user["id"],
                current_user.get("username"),
                "Execute rejected: invalid or missing session token (anti-bot / scripted client).",
                req,
                extra={
                    "integrity_violation": "execute_token",
                    "attack_id": request.attack_id,
                    "location_state": target_location,
                },
            )
            try:
                await maybe_notify_staff_attack_execute_token_fail(
                    db=db,
                    request=req,
                    attacker_id=str(current_user["id"]),
                    attacker_username=current_user.get("username") or "?",
                    target_id=str(target.get("id") or ""),
                    target_username=(target.get("username") or "").strip() or "?",
                    attack_id=request.attack_id,
                    location_state=target_location,
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
    if await soft_launch_blocks_pvp_kill_on_target(db, target):
        await _log_attack_error(current_user["id"], current_user.get("username"), "Release soft-launch PvP block", req)
        raise HTTPException(status_code=403, detail=PVP_KILLS_DISABLED_DETAIL)
    if not target.get("is_npc") and is_civilian_protected(target):
        await _log_attack_error(current_user["id"], current_user.get("username"), "Target under civilian protection", req)
        raise HTTPException(status_code=403, detail=CIVILIAN_PROTECTION_KILL_BLOCKED_DETAIL)
    if target.get("is_dead"):
        await db.attacks.delete_one({"id": request.attack_id, "attacker_id": current_user["id"]})
        await _log_attack_error(current_user["id"], current_user.get("username"), "Target is already dead", req)
        raise HTTPException(
            status_code=400,
            detail="Target is already dead. This search has been removed — refresh your list and search for another target if needed.",
        )
    if not target.get("is_npc"):
        await apply_passive_health_regen(target["id"], target)
    if target.get("email") in ADMIN_EMAILS or _is_moderator(target):
        await _log_attack_error(current_user["id"], current_user.get("username"), "Target cannot be attacked", req)
        raise HTTPException(status_code=403, detail="Target cannot be attacked")
    target_armour = target.get("armour_level", 0)
    attacker_rank_id, _ = get_rank_info(current_user.get("rank_points", 0))
    target_rank_id, _ = get_rank_info(target.get("rank_points", 0))
    attacker_armour = int(current_user.get("armour_level") or 0)
    attacker_bullets = current_user.get("bullets", 0)
    attacker_molotovs = int(current_user.get("molotovs") or 0)
    MOLOTOV_BULLET_EQUIV = 5000
    equipped_weapon_id = (current_user.get("equipped_weapon_id") or "").strip() or None

    # Require an owned and equipped gun before attacking. This avoids \"punch\" attacks
    # and gives clearer feedback when players forget to buy/equip a weapon.
    owned_weapons = await db.user_weapons.find(
        {"user_id": current_user["id"], "quantity": {"$gt": 0}},
        {"_id": 0, "weapon_id": 1},
    ).to_list(100)
    owned_weapon_ids = {w.get("weapon_id") for w in owned_weapons if w.get("weapon_id")}
    if not owned_weapon_ids:
        await _log_attack_error(current_user["id"], current_user.get("username"), "You don't own a gun. Visit the armoury or store to buy one before you can attack.", req)
        raise HTTPException(
            status_code=400,
            detail="You don't own a gun. Visit the armoury or store to buy one before you can attack.",
        )
    if not equipped_weapon_id or equipped_weapon_id not in owned_weapon_ids:
        await _log_attack_error(current_user["id"], current_user.get("username"), "You need to equip a gun before you can attack.", req)
        raise HTTPException(
            status_code=400,
            detail="You need to equip a gun before you can attack.",
        )

    best_damage, best_weapon_name = await _best_weapon_for_user(current_user["id"], equipped_weapon_id)
    inflation = await _apply_kill_inflation_decay(current_user["id"])
    attacker_kill_badges = victim_kill_badges = 0
    try:
        from routers.game.achievements import get_badge_bonuses
        bb_a = await get_badge_bonuses(current_user.get("id") or "")
        bb_v = await get_badge_bonuses(target.get("id") or "") if not target.get("is_npc") else {}
        attacker_kill_badges = bb_a.get("kills", 0) * bb_a.get("prestige_badge_mult", 1)
        victim_kill_badges = bb_v.get("kills", 0) * bb_v.get("prestige_badge_mult", 1)
    except Exception:
        pass
    bullets_base = _bullets_to_kill(target_armour, target_rank_id, best_damage, attacker_rank_id, attacker_kill_badges, victim_kill_badges)
    mastery_pct = await _get_weapon_mastery_pct(current_user["id"], equipped_weapon_id)
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
    exclusive_car_bullet_mult = await _exclusive_car_bullet_defense_multiplier(target)
    if exclusive_car_bullet_mult > 1.0:
        bullets_required = int(math.ceil(bullets_required * exclusive_car_bullet_mult))
    # "Completed it" perk: 65% fewer bullets needed when attacking
    if current_user.get("completed_it_bullet_reduction"):
        bullets_required = max(1, int(bullets_required * 0.35))
    if attacker_bullets <= 0:
        await _log_attack_error(current_user["id"], current_user.get("username"), "You need bullets to attack.", req)
        raise HTTPException(status_code=400, detail="You need bullets to attack.")
    target_bodyguards = await db.bodyguards.find({"user_id": target["id"]}, {"_id": 0}).to_list(10)
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
                await db.attack_attempts.insert_one({
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
                })
                await _notify_target_if_bot_attack(
                    target["id"], current_user.get("username") or "?", "bodyguard",
                    attack.get("location_state"), msg, meta.get("attacker_is_bot", False),
                    attacker_id=str(current_user.get("id") or ""),
                    target_username=target_name,
                    meta=meta,
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
            await db.attack_attempts.insert_one({
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
            })
            await _notify_target_if_bot_attack(
                target["id"], current_user.get("username") or "?", "bodyguard",
                attack.get("location_state"), msg, meta.get("attacker_is_bot", False),
                attacker_id=str(current_user.get("id") or ""),
                target_username=target_name,
                meta=meta,
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
        await _log_attack_error(current_user["id"], current_user.get("username"), "You must enter how many bullets to use (at least 1).", req)
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
                    await db.users.update_one({"id": killer_id}, {"$inc": inc})
                    if inc.get("respect_points"):
                        await log_respect_earned(killer_id, inc["respect_points"], "attack")
                    if rp_added > 0:
                        try:
                            await maybe_process_rank_up(killer_id, rp_before, rp_added, current_user.get("username", ""))
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
                    await log_activity(
                        killer_id,
                        current_user.get("username") or "?",
                        "hitlist_npc_kill",
                        {"victim_username": target_name, "victim_id": victim_id, "rewards": rewards},
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
                damage_done = float(target_health)
                try:
                    meta = _request_meta(req)
                    _npc_attempt_extra = {}
                    if _is_npc_bodyguard and _npc_bg_owner_id:
                        _npc_attempt_extra["bodyguard_owner_id"] = _npc_bg_owner_id
                    if _is_npc_bodyguard and _npc_bg_owner_username:
                        _npc_attempt_extra["bodyguard_owner_username"] = _npc_bg_owner_username
                    await db.attack_attempts.insert_one({
                        **attempt_base,
                        "outcome": "killed",
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
                    })
                except Exception:
                    pass
                await send_notification(killer_id, "Hitlist NPC kill", success_message, "attack", category="attacks")
                # If this NPC was a bodyguard (e.g. robot), do bodyguard cleanup and record vendetta war stats
                if target.get("is_bodyguard"):
                    victim_as_bodyguard = await db.bodyguards.find({"bodyguard_user_id": victim_id}, {"_id": 0, "id": 1, "user_id": 1, "hire_cost": 1}).to_list(10)
                    # Fallback: robot user doc has bodyguard_owner_id if bodyguard collection doc missing
                    if not victim_as_bodyguard and target.get("bodyguard_owner_id"):
                        victim_as_bodyguard = [{"id": None, "user_id": target["bodyguard_owner_id"], "hire_cost": 0}]
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
                        delete_criteria = {"user_id": owner_id, "bodyguard_user_id": victim_id}
                        if bg.get("id"):
                            await db.bodyguards.delete_one({"id": bg["id"]})
                        else:
                            await db.bodyguards.delete_one(delete_criteria)
                        await db.users.update_one({"id": owner_id}, {"$inc": {"bodyguard_slots": -1}})
                        await db.users.update_one({"id": owner_id, "bodyguard_slots": {"$lt": 0}}, {"$set": {"bodyguard_slots": 0}})
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
                            logging.exception("hitlist_bodyguard_events bodyguard_killed (npc bg)")
                        remaining = await db.bodyguards.find({"user_id": owner_id}, {"_id": 0, "id": 1, "slot_number": 1}).sort("slot_number", 1).to_list(10)
                        for i, b in enumerate(remaining, 1):
                            if b["slot_number"] != i:
                                update_criteria = {"id": b["id"]} if b.get("id") else {"user_id": owner_id, "slot_number": b["slot_number"]}
                                await db.bodyguards.update_one(update_criteria, {"$set": {"slot_number": i}})
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
        victim_props = await db.user_properties.find({"user_id": victim_id}, {"_id": 0, "property_id": 1}).to_list(100)
        victim_cars_count = len(victim_cars)
        victim_props_count = len(victim_props)
        exclusive_car_count = 0
        for uc in victim_cars:
            car_info = next((c for c in CARS if c["id"] == uc.get("car_id")), None)
            if car_info and car_info.get("rarity") == "exclusive":
                exclusive_car_count += 1
        prop_id_list = list({up["property_id"] for up in victim_props if up.get("property_id")})
        prop_docs_by_id = {}
        if prop_id_list:
            async for p in db.properties.find(
                {"id": {"$in": prop_id_list}},
                {"_id": 0, "id": 1, "name": 1},
            ):
                prop_docs_by_id[p["id"]] = p
        prop_name_counts = {}
        for up in victim_props:
            pid = up.get("property_id")
            p = prop_docs_by_id.get(pid) if pid else None
            if p:
                name = p["name"]
                prop_name_counts[name] = prop_name_counts.get(name, 0) + 1
        prop_names = [f"{count}x {name}" if count > 1 else name for name, count in prop_name_counts.items()]
        killer_doc = await db.users.find_one({"id": killer_id}, {"_id": 0, "rank_points": 1, "username": 1})
        killer_rp_before = int((killer_doc or {}).get("rank_points") or 0)
        kill_inc = {"money": cash_loot, "rank_points": rank_points}
        # Count kills vs real players and robot bodyguards; not vs hitlist NPCs (handled above) or other NPCs.
        if not target.get("is_npc") or target.get("is_bodyguard"):
            kill_inc["total_kills"] = 1
        if target.get("is_bodyguard") and target.get("is_npc"):
            kill_inc["robot_bodyguard_kills"] = 1
        await db.users.update_one({"id": killer_id}, {"$inc": kill_inc})
        try:
            await maybe_process_rank_up(killer_id, killer_rp_before, rank_points, (killer_doc or {}).get("username", ""))
        except Exception as e:
            logging.exception("Rank-up notification (kill): %s", e)
        # Transfer cars to killer; exclusive + loot-exclusive get a new id so old view-car links are dead
        killer_has_loot_car = await db.user_cars.count_documents({"user_id": killer_id, "car_id": "car21"})
        for uc in victim_cars:
            car_info = next((c for c in CARS if c.get("id") == uc.get("car_id")), None)
            is_loot_exclusive = car_info and car_info.get("rarity") == "loot_exclusive"
            if is_loot_exclusive:
                if killer_has_loot_car >= 1:
                    await db.user_cars.delete_one({"_id": uc["_id"]})
                else:
                    await db.user_cars.update_one(
                        {"_id": uc["_id"]},
                        {
                            "$set": {"user_id": killer_id, "id": str(uuid.uuid4())},
                            "$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""},
                        },
                    )
                    killer_has_loot_car = 1
                continue
            is_exclusive = car_info and car_info.get("rarity") == "exclusive"
            if is_exclusive:
                await db.user_cars.update_one(
                    {"_id": uc["_id"]},
                    {
                        "$set": {"user_id": killer_id, "id": str(uuid.uuid4())},
                        "$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""},
                    },
                )
            else:
                await db.user_cars.update_one(
                    {"_id": uc["_id"]},
                    {"$set": {"user_id": killer_id}, "$unset": {"listed_for_sale": "", "sale_price": "", "listed_at": ""}},
                )
        # Transfer properties with stacking cap - extras auto-sell for cash
        from routers.money.properties import MAX_STACK_COUNT, calculate_property_value
        from routers.kill.armoury import TOKEN_CONFIG
        # Get killer's current property counts
        killer_props = await db.user_properties.find({"user_id": killer_id}, {"_id": 0, "property_id": 1}).to_list(100)
        killer_prop_counts = {}
        for kp in killer_props:
            pid = kp["property_id"]
            killer_prop_counts[pid] = killer_prop_counts.get(pid, 0) + 1
        # Process victim's properties
        auto_sell_cash = 0
        auto_sold_props = []
        for vp in victim_props:
            vpid = vp["property_id"]
            vp_full = await db.user_properties.find_one({"user_id": victim_id, "property_id": vpid})
            if not vp_full:
                continue
            current_count = killer_prop_counts.get(vpid, 0)
            if current_count >= MAX_STACK_COUNT:
                # At cap - auto-sell this property
                prop_def = await db.properties.find_one({"id": vpid}, {"_id": 0, "price": 1, "name": 1})
                if prop_def:
                    level = max(1, int(vp_full.get("level") or 1))
                    sell_value = calculate_property_value(prop_def, level)
                    auto_sell_cash += sell_value
                    auto_sold_props.append(f"{prop_def.get('name', vpid)} (${sell_value:,})")
                # Delete instead of transfer
                await db.user_properties.delete_one({"_id": vp_full["_id"]})
            else:
                # Transfer to killer
                await db.user_properties.update_one({"_id": vp_full["_id"]}, {"$set": {"user_id": killer_id}})
                killer_prop_counts[vpid] = current_count + 1
        # Add auto-sell cash to killer (separate from initial loot since kill_inc already applied)
        if auto_sell_cash > 0:
            await db.users.update_one({"id": killer_id}, {"$inc": {"money": auto_sell_cash}})
            cash_loot += auto_sell_cash  # For message display
        money_after_loot = max(0, victim_money - cash_loot)
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
        # Illegal business: victim loses it; killer gets pending reward (cash or income_boost via claim endpoint)
        try:
            victim_biz = await db.illegal_businesses.find_one({"user_id": victim_id}, {"_id": 0, "id": 1, "total_spent": 1, "level": 1, "security_level": 1, "security_upgrades": 1})
            if victim_biz:
                biz_id = victim_biz["id"]
                await db.illegal_business_guards.delete_many({"business_id": biz_id})
                await db.illegal_businesses.delete_one({"id": biz_id})
                await send_notification(victim_id, "Illegal business", "You lost your illegal business.", "attack", category="attacks")
                total_spent = int(victim_biz.get("total_spent") or 0)
                from routers.money.illegal_business import _is_moderately_upgraded
                moderately_upgraded = _is_moderately_upgraded(victim_biz)
                killer_doc = await db.users.find_one({"id": killer_id}, {"_id": 0, "pending_illegal_business_rewards": 1})
                pending = list((killer_doc or {}).get("pending_illegal_business_rewards") or [])
                pending.append({
                    "victim_id": victim_id,
                    "victim_username": target_name,
                    "total_spent": total_spent,
                    "moderately_upgraded": moderately_upgraded,
                    "at": now_iso,
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
            await db.users.update_one({"id": owner_id}, {"$inc": {"bodyguard_slots": -1}})
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
        transferred_props_count = victim_props_count - len(auto_sold_props)
        if transferred_props_count > 0:
            p = f"their {transferred_props_count} propert{'y' if transferred_props_count == 1 else 'ies'}"
            if prop_names:
                # Filter out auto-sold property names from display
                kept_names = [n for n in prop_names if not any(n in asp for asp in auto_sold_props)]
                if kept_names:
                    p += f" ({', '.join(kept_names)})"
            extras.append(p)
        if auto_sold_props:
            extras.append(f"auto-sold {len(auto_sold_props)} propert{'y' if len(auto_sold_props) == 1 else 'ies'} (at stack cap)")
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
        if death_message:
            success_message += f' Death message: "{death_message}"'
        if make_public:
            try:
                await db.public_kills.insert_one({
                    "id": str(uuid.uuid4()),
                    "killer_id": current_user["id"],
                    "killer_username": current_user.get("username") or "?",
                    "victim_id": victim_id,
                    "victim_username": target_name,
                    "death_message": death_message or None,
                    "bullets_used": bullets_used,
                    "bullets_required": bullets_required,
                    "make_public": True,
                    "created_at": datetime.now(timezone.utc),
                })
            except Exception:
                pass
        await db.attacks.delete_many({"target_id": victim_id})
        await send_notification(killer_id, "Kill", success_message, "attack", category="attacks")
        max_statements = max(0, min(6, 7 - (best_damage // 20)))
        if current_user.get("has_silencer"):
            max_statements = max(0, max_statements - 2)
        # At least one witness notification whenever the cap allows (still 0 when cap is 0, e.g. very high weapon damage).
        number_to_send = random.randint(1, max_statements) if max_statements >= 1 else 0
        if number_to_send > 0:
            now_w = datetime.now(timezone.utc)
            five_min_ago = now_w - timedelta(minutes=5)
            five_iso = five_min_ago.isoformat()
            now_iso = now_w.isoformat()
            location = attack.get("location_state") or "Unknown"
            time_str = now_w.strftime("%Y-%m-%d %H:%M UTC")
            # Human and robot bodyguards both use is_bodyguard on the victim user doc; include who they guarded when known.
            if target.get("is_bodyguard"):
                owner_un = (bodyguard_owner_username or "").strip()
                victim_label = (
                    f"bodyguard {target_name} (guarding {owner_un})"
                    if owner_un
                    else f"bodyguard {target_name}"
                )
            else:
                victim_label = target_name
            witness_msg = f"{current_user.get('username') or 'Someone'} killed {victim_label}. Weapon: {best_weapon_name}. Bullets used: {bullets_used:,}. Location: {location}. Time: {time_str}."
            # Witness statements only go to accounts that are online (same rule as /users/online), not dead/offline.
            all_user_ids = await db.users.find(
                {
                    "is_dead": {"$ne": True},
                    "is_npc": {"$ne": True},
                    "is_bodyguard": {"$ne": True},
                    "id": {"$ne": killer_id},
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
                    await send_notification(uid, "Witness statement", witness_msg, "attack", category="attacks")
                    try:
                        await db.users.update_one(
                            {"id": uid},
                            {"$inc": {"witness_statements": 1, "witness_nav_red": 1}},
                        )
                    except Exception:
                        pass
        killer_family_id = await resolve_family_id(killer_id) or current_user.get("family_id")
        killer_family_id = str(killer_family_id).strip() if killer_family_id else None
        victim_family_id = await resolve_family_id(victim_id) or target.get("family_id")
        victim_family_id = str(victim_family_id).strip() if victim_family_id else None
        # Start vendetta before recording stats so the kill that declares war is counted (was previously after stats).
        if victim_family_id and killer_family_id and killer_family_id != victim_family_id:
            try:
                await _family_war_start(killer_family_id, victim_family_id)
            except Exception as e:
                logging.exception("Family war start on kill: %s", e)
        # Bodyguard war start is done earlier in the bodyguard loop (before recording) so the triggering kill is counted
        if victim_family_id:
            try:
                if killer_family_id:
                    war = await _get_active_war_between(killer_family_id, victim_family_id)
                else:
                    war = await _get_active_war_for_family(victim_family_id)
                if war and war.get("id"):
                    await _record_war_stats_player_kill(war["id"], killer_id, killer_family_id, victim_id, victim_family_id)
                    try:
                        await db.war_kill_feed.insert_one({
                            "id": str(uuid.uuid4()),
                            "war_id": war["id"],
                            "kill_type": "player",
                            "killer_id": killer_id,
                            "killer_username": current_user.get("username", "?"),
                            "killer_family_id": killer_family_id,
                            "victim_id": victim_id,
                            "victim_username": target_name,
                            "victim_family_id": victim_family_id,
                            "bg_username": None,
                            "bg_owner_username": None,
                            "bullets_used": int(bullets_used or 0),
                            "bg_hire_cost": 0,
                            "cash_taken": cash_loot,
                            "props_taken": victim_props_count,
                            "cars_taken": victim_cars_count,
                            "created_at": datetime.now(timezone.utc),
                        })
                    except Exception as feed_exc:
                        logging.exception("War kill feed (player): %s", feed_exc)
            except Exception as e:
                logging.exception("War stats record on kill: %s", e)
        if victim_family_id:
            try:
                killer_name_for_notice = current_user["username"] if make_public else "Unknown"
                await send_notification_to_family(
                    victim_family_id,
                    "💀 Family Member Killed",
                    f"{target_name} was killed by {killer_name_for_notice}.",
                    "attack",
                )
                await _family_war_check_wipe_and_award(victim_family_id, killer_family_id, killer_id)
            except Exception as e:
                logging.exception("Family notify/war on kill: %s", e)
        try:
            damage_done = float(target_health)
            meta = _request_meta(req)
            await db.attack_attempts.insert_one({
                **attempt_base,
                "outcome": "killed",
                "player_message": success_message,
                "death_message": death_message or None,
                "make_public": make_public,
                "rewards": {"money": cash_loot, "rank_points": rank_points, "cars_taken": victim_cars_count, "properties_taken": victim_props_count},
                "target_health_before": target_health,
                "target_health_after": 0.0,
                "damage_done": damage_done,
                **meta,
            })
            await _notify_target_if_bot_attack(
                attempt_base["target_id"], current_user.get("username") or "?", "killed",
                attempt_base.get("location_state"), success_message, meta.get("attacker_is_bot", False),
                attacker_id=str(current_user.get("id") or ""),
                target_username=target_name,
                meta=meta,
            )
        except Exception:
            pass
        await log_activity(killer_id, current_user.get("username", "?"), "attack_kill", {
            "victim": target_name, "cash_loot": cash_loot, "rp": rank_points,
            "bullets_used": bullets_used, "cars_taken": victim_cars_count, "props_taken": victim_props_count,
        })
        return AttackExecuteResponse(
            success=True,
            message=success_message,
            rewards={"money": cash_loot, "rank_points": rank_points, "cars_taken": victim_cars_count, "properties_taken": victim_props_count, "exclusive_cars": exclusive_car_count}
        )
    else:
        damage_done = float(health_dealt_pct)
        dmg_iso = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"id": target["id"]},
            [{"$set": {
                "health": {"$max": [0.0, {"$subtract": [{"$ifNull": ["$health", 100.0]}, health_dealt_pct]}]},
                "health_regen_last_at": dmg_iso,
            }}],
        )
        new_health = max(0.0, target_health - health_dealt_pct)
        await db.attacks.update_one(
            {"id": attack["id"]},
            {"$set": {"last_attack_result": "damaged", "last_attack_at": datetime.now(timezone.utc).isoformat()}}
        )
        health_pct_str = f"{health_dealt_pct:.1f}" if health_dealt_pct != int(health_dealt_pct) else str(int(health_dealt_pct))
        fail_message = f'You failed to kill {target_name}. You used {bullets_used:,} bullets — they only lost {health_pct_str}% health.'
        try:
            await db.attack_attempts.insert_one({
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
            })
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
        uname, uid, getattr(request, "attack_id", "?"), e,
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
        or (current_user.get("email") in ADMIN_EMAILS)
    )
    timeline_user = current_user
    if target_username and str(target_username).strip():
        if not viewer_is_staff:
            raise HTTPException(status_code=403, detail="Staff access required")
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
            summary = f"Kill logged: {det.get('victim', '?')}"
            if cash is not None:
                summary += f" · ${int(cash):,} loot"
            if bu is not None:
                summary += f" · {int(bu):,} bullets"
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
    docs = await db.attack_attempts.find(
        {"$or": [{"attacker_id": current_user["id"]}, {"target_id": current_user["id"]}]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    filtered = []
    for d in docs:
        if not d.get("id"):
            d["id"] = str(uuid.uuid4())
        d["direction"] = "outgoing" if d.get("attacker_id") == current_user["id"] else "incoming"
        if d["direction"] == "incoming":
            outcome = d.get("outcome")
            if outcome in {"bodyguard", "error"}:
                continue
            if outcome != "killed":
                health_dealt_pct = float(d.get("health_dealt_pct") or 0)
                damage_done = float(d.get("damage_done") or 0)
                if health_dealt_pct <= 0 and damage_done <= 0:
                    continue
        # No real combat spend — hide validation/error spam and bodyguard blocks (0 bullets) from history UI
        if int(d.get("bullets_used") or 0) <= 0:
            continue
        filtered.append(d)
    return {"attempts": filtered}


def register(router):
    router.add_api_route("/attack/search", search_target, methods=["POST"], response_model=AttackSearchResponse)
    router.add_api_route("/attack/status", get_attack_status, methods=["GET"], response_model=AttackStatusResponse)
    router.add_api_route("/attack/list", list_attacks, methods=["GET"])
    router.add_api_route("/attack/delete", delete_attacks, methods=["POST"])
    router.add_api_route("/attack/travel", travel_to_target, methods=["POST"])
    router.add_api_route("/attack/bullets/calc", calc_bullets, methods=["POST"])
    router.add_api_route("/attack/inflation", get_attack_inflation, methods=["GET"])
    router.add_api_route("/attack/execute", execute_attack, methods=["POST"], response_model=AttackExecuteResponse)
    router.add_api_route("/attack/attempts", get_attack_attempts, methods=["GET"])
    router.add_api_route("/attack/timeline", get_attack_timeline, methods=["GET"])
