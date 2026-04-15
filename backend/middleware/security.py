# Anti-cheat and security monitoring system
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List, Tuple
import logging
import math
import os
import random
import re
import time
from collections import defaultdict, Counter
from urllib.parse import urlparse
import asyncio

# Telegram bot token format: 8-10 digits, colon, ~35 alphanumeric chars. Reject BotFather message paste.
_TELEGRAM_TOKEN_RE = re.compile(r"^[0-9]{8,10}:[a-zA-Z0-9_-]{30,40}$")


def is_valid_telegram_bot_token(token: str) -> bool:
    """Return True if token looks like a valid Telegram bot token. Rejects BotFather message paste."""
    if not token or not isinstance(token, str):
        return False
    t = token.strip()
    if len(t) > 55 or "\n" in t or "  " in t:
        return False
    if "Done" in t or "Congratulations" in t or "t.me/" in t:
        return False
    return bool(_TELEGRAM_TOKEN_RE.match(t))

# Optional httpx import for Telegram alerts
try:
    import httpx
    HTTPX_AVAILABLE = True
    # api.telegram.org can be slow; short defaults caused noisy ReadTimeout spam in logs.
    TELEGRAM_BOT_API_TIMEOUT = httpx.Timeout(45.0, connect=20.0, read=45.0, write=20.0)
except ImportError:
    HTTPX_AVAILABLE = False
    TELEGRAM_BOT_API_TIMEOUT = None  # unused

from pymongo.errors import DuplicateKeyError

logger = logging.getLogger(__name__)

# Telegram configuration
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID', '')
TELEGRAM_ENABLED = bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)

# Security thresholds - FOCUS ON SPAM & EXPLOITS, NOT LEGITIMATE HIGH ACTIVITY
MAX_REQUESTS_PER_SECOND = 20  # Spam detection: more than this many mutating requests in 1s
MAX_FAILED_ATTACKS_PER_MINUTE = 20  # Bot-like failed attack spam
MAX_SAME_ACTION_PER_SECOND = 3  # Same endpoint hit 3+ times in 1 second = bot

# Burst detection - catches rapid clicking (e.g. autoclickers or macros)
BURST_WINDOW_SECONDS = 0.5  # Time window for burst detection
BURST_MAX_REQUESTS = 20  # Max mutating requests in burst window (>= this in 0.5s triggers burst_spam)

# Cap per-user request/burst log length (must exceed thresholds above; avoids unbounded memory)
_SPAM_LOG_MAX = 50

# Page-visit spam: (user_id, SPA path from X-Current-Path) sliding window; counts GETs too (polling).
_page_spam_en_raw = (os.environ.get("PAGE_SPAM_ENABLED") or "1").strip().lower()
PAGE_SPAM_ENABLED = _page_spam_en_raw in ("1", "true", "yes", "")
_page_ws_raw = (os.environ.get("PAGE_SPAM_WINDOW_SEC") or "").strip()
PAGE_SPAM_WINDOW_SEC = float(_page_ws_raw) if _page_ws_raw else 30.0
_page_max_raw = (os.environ.get("PAGE_SPAM_MAX_REQUESTS") or "").strip()
PAGE_SPAM_MAX_REQUESTS = int(_page_max_raw) if _page_max_raw.isdigit() else 100
user_page_request_counts: Dict[Tuple[str, str], List[datetime]] = defaultdict(list)


def _page_spam_deque_cap() -> int:
    """Max timestamps kept per (user, spa_path); scales when admin raises PAGE_SPAM_MAX_REQUESTS."""
    return max(PAGE_SPAM_MAX_REQUESTS + 50, 150)

# Throttle repeated Telegram alerts for the same user (spam burst/request flags)
_SPAM_TELEGRAM_COOLDOWN_SEC = 300
_last_spam_telegram_at: Dict[str, float] = {}

# Exploit detection (off by default - enable in admin panel or here when ready for production)
DETECT_NEGATIVE_BALANCE = False
DETECT_IMPOSSIBLE_GAIN = 50_000_000  # $50M+ gain in single action = exploit (configurable via admin)
DETECT_DUPLICATE_REQUESTS = False
DUPLICATE_REQUEST_WINDOW_MS = 300  # 200-500ms window to reduce false positives from double-clicks

# In-memory rate limiting (per user)
user_request_counts = defaultdict(list)  # user_id -> [timestamp1, timestamp2, ...]
user_burst_counts = defaultdict(list)    # user_id -> [timestamp1, timestamp2, ...] for burst detection
user_action_counts = defaultdict(list)   # user_id -> [timestamp1, timestamp2, ...]
user_failed_attacks = defaultdict(list)  # user_id -> [timestamp1, timestamp2, ...]

# Security flags database structure:
# db.security_flags: {
#   user_id, username, flag_type, reason, details (dict), created_at, resolved (bool)
# }

# Proxy/VPN check (optional): set GETIPINTEL_CONTACT_EMAIL in .env to enable. GetIPIntel free API.
# flags=m = dynamic ban list only: only block IPs on known proxy/VPN lists (0 or 1). Reduces false positives
# so mobile/carrier IPs are not blocked; only explicit proxy/VPN IPs get result 1.
PROXY_CHECK_CONTACT_EMAIL = os.environ.get("GETIPINTEL_CONTACT_EMAIL", "").strip()
PROXY_CHECK_THRESHOLD = 0.99  # When not using flags=m; with flags=m we block only when result == 1

# Telegram notification queue (async batch sending)
pending_alerts = []


async def get_ip_info(ip: str) -> dict:
    """Look up ISP / org / AS / country for an IP via ip-api.com (free, no key needed)."""
    if not ip or not HTTPX_AVAILABLE:
        return {}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"http://ip-api.com/json/{ip}?fields=status,isp,org,as,country,city,proxy,hosting")
        if r.status_code != 200:
            return {}
        data = r.json()
        if data.get("status") == "success":
            return {
                "isp": data.get("isp", ""),
                "org": data.get("org", ""),
                "as": data.get("as", ""),
                "country": data.get("country", ""),
                "city": data.get("city", ""),
                "proxy": data.get("proxy", False),
                "hosting": data.get("hosting", False),
            }
    except Exception:
        pass
    return {}


async def is_proxy_or_vpn(ip: str) -> bool:
    """Return True if IP appears to be proxy/VPN (block registration). Requires GETIPINTEL_CONTACT_EMAIL in env.
    Uses flags=m so only IPs on known proxy/VPN ban lists are blocked; mobile/carrier IPs are allowed."""
    if not ip or not PROXY_CHECK_CONTACT_EMAIL:
        return False
    if not HTTPX_AVAILABLE:
        return False
    try:
        # flags=m = dynamic ban list only: returns 0 or 1. Only known proxy/VPN IPs return 1.
        # Avoids false positives for mobile/carrier IPs that can score high in full dynamic checks.
        url = f"http://check.getipintel.net/check.php?ip={ip}&contact={PROXY_CHECK_CONTACT_EMAIL}&format=json&flags=m"
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url)
        if r.status_code != 200:
            return False
        data = r.json()
        if isinstance(data, dict) and "result" in data:
            raw = data.get("result")
            try:
                prob = float(raw)
            except (TypeError, ValueError):
                return False
            # With flags=m, result is 0 or 1. Block only when 1 (on proxy/VPN list). Threshold still applies.
            return prob >= PROXY_CHECK_THRESHOLD
        return False
    except Exception as e:
        logger.warning("Proxy check failed for %s: %s", ip, e)
        return False  # Fail open: don't block if API errors


async def send_telegram_alert(message: str, alert_type: str = "warning", use_markdown: bool = True):
    """Send alert to Telegram bot. Queues for batch sending. use_markdown=False avoids broken parsing from paths/usernames."""
    if not TELEGRAM_ENABLED:
        logger.info(f"[SECURITY {alert_type.upper()}] {message}")
        return

    emoji = {
        "critical": "🚨",
        "warning": "⚠️",
        "info": "ℹ️",
        "exploit": "💀",
    }.get(alert_type, "⚠️")

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    if use_markdown:
        formatted = f"{emoji} **{alert_type.upper()}**\n\n{message}\n\n🕐 {ts}"
    else:
        formatted = f"{emoji} {alert_type.upper()}\n\n{message}\n\n🕐 {ts}"
    pending_alerts.append((formatted, use_markdown))


async def flush_telegram_alerts():
    """Send all pending alerts to Telegram (batch). Called periodically or on critical alert."""
    if not pending_alerts or not TELEGRAM_ENABLED:
        return
    if not is_valid_telegram_bot_token(TELEGRAM_BOT_TOKEN):
        logger.warning("TELEGRAM_BOT_TOKEN invalid (check format: digits:alphanumeric, not BotFather message)")
        pending_alerts.clear()
        return
    if not HTTPX_AVAILABLE:
        logger.warning(f"httpx not installed - cannot send {len(pending_alerts)} Telegram alerts. Install with: pip install httpx")
        pending_alerts.clear()
        return
    batch = pending_alerts[:10]
    for _ in range(len(batch)):
        pending_alerts.pop(0)
    texts = [b[0] if isinstance(b, tuple) else b for b in batch]
    use_md_flags = [b[1] if isinstance(b, tuple) else True for b in batch]
    combined_message = "\n\n────────\n\n".join(texts)
    use_markdown = all(use_md_flags)
    try:
        async with httpx.AsyncClient(timeout=TELEGRAM_BOT_API_TIMEOUT) as client:
            url = "https://api.telegram.org/bot{}/sendMessage".format(TELEGRAM_BOT_TOKEN)
            payload = {"chat_id": TELEGRAM_CHAT_ID, "text": combined_message[:4000]}
            if use_markdown:
                payload["parse_mode"] = "Markdown"
            r = await client.post(url, json=payload)
            err_body = r.text or ""
            err_l = err_body.lower()
            if r.status_code == 400 and ("chat not found" in err_l or "chat_id is empty" in err_l):
                logger.warning(
                    "Telegram security alerts: TELEGRAM_CHAT_ID is wrong or the bot cannot reach that chat. "
                    "For DMs send /start to the bot; for groups add the bot and use the group id from @RawDataBot. API: %s",
                    err_body[:200],
                )
                return
            if r.status_code == 400:
                payload.pop("parse_mode", None)
                r = await client.post(url, json=payload)
                err_body = r.text or ""
            if r.status_code != 200:
                logger.warning("Telegram alert send failed: %s %s", r.status_code, err_body[:200])
    except Exception as e:
        if HTTPX_AVAILABLE and isinstance(e, httpx.TimeoutException):
            logger.warning("Telegram alert batch timed out (%s)", type(e).__name__)
            return
        logger.exception("Failed to send Telegram alert: %s", e)


async def send_telegram_to_chat(chat_id: str, message: str, bot_token: Optional[str] = None, username: Optional[str] = None) -> bool:
    """Send a message to a specific Telegram chat (e.g. for Auto Rank results). Uses user's bot_token if provided, else global TELEGRAM_BOT_TOKEN. username is optional, for logging when send fails."""
    chat_id = (chat_id or "").strip()
    if not chat_id:
        return False
    token = (bot_token or "").strip() or TELEGRAM_BOT_TOKEN
    if not token or not is_valid_telegram_bot_token(token):
        return False
    if not HTTPX_AVAILABLE:
        logger.warning("httpx not installed - cannot send Telegram to user")
        return False
    try:
        async with httpx.AsyncClient(timeout=TELEGRAM_BOT_API_TIMEOUT) as client:
            payload = {"chat_id": chat_id, "text": message[:4000], "parse_mode": "Markdown"}
            r = await client.post(
                "https://api.telegram.org/bot{}/sendMessage".format(token),
                json=payload,
            )
            if r.status_code == 400:
                txt = (r.text or "").lower()
                if "chat not found" in txt or "user is deactivated" in txt:
                    user_part = f" user={username}" if username else ""
                    logger.info("Telegram chat %s%s: %s (user may need to /start the bot or fix chat_id)", chat_id, user_part, r.text[:120])
                    return False
                payload.pop("parse_mode", None)
                r = await client.post(
                    "https://api.telegram.org/bot{}/sendMessage".format(token),
                    json=payload,
                )
            if r.status_code != 200:
                user_part = f" user={username}" if username else ""
                logger.warning("Telegram sendMessage failed%s: %s %s", user_part, r.status_code, r.text[:200])
                return False
        return True
    except Exception as e:
        if HTTPX_AVAILABLE and isinstance(e, httpx.TimeoutException):
            user_part = f" user={username}" if username else ""
            logger.warning("Telegram API timeout sending to chat %s%s (%s)", chat_id, user_part, type(e).__name__)
            return False
        logger.exception("Failed to send Telegram to chat %s: %s", chat_id, e)
        return False


# Auto Rank Telegram menu: shown when user taps / or Menu in chat with the bot
TELEGRAM_BOT_COMMANDS = [
    {"command": "start", "description": "Welcome & how to link Auto Rank"},
    {"command": "autorank", "description": "Auto Rank summary (stats & toggles)"},
    {"command": "summary", "description": "Auto Rank summary"},
    {"command": "enable", "description": "Enable: all, crimes, gta, bust, oc, booze"},
    {"command": "disable", "description": "Disable: all, crimes, gta, bust, oc, booze"},
]


async def set_telegram_webhook(webhook_url: str, secret_token: Optional[str] = None, bot_token: Optional[str] = None) -> bool:
    """Register webhook URL with Telegram so the bot receives updates (messages, /commands). Uses TELEGRAM_BOT_TOKEN if bot_token not provided."""
    url = (webhook_url or "").strip().rstrip("/")
    if not url:
        return False
    token = (bot_token or "").strip() or TELEGRAM_BOT_TOKEN
    if not token or not is_valid_telegram_bot_token(token):
        return False
    if not HTTPX_AVAILABLE:
        logger.warning("httpx not installed - cannot set Telegram webhook")
        return False
    try:
        payload = {"url": url}
        if secret_token:
            payload["secret_token"] = (secret_token or "").strip()[:256]
        async with httpx.AsyncClient(timeout=TELEGRAM_BOT_API_TIMEOUT) as client:
            r = await client.post(
                "https://api.telegram.org/bot{}/setWebhook".format(token),
                json=payload,
            )
        if r.status_code != 200:
            logger.warning("Telegram setWebhook failed: %s %s", r.status_code, r.text)
            return False
        logger.info("Telegram webhook set to %s", url)
        return True
    except Exception as e:
        if HTTPX_AVAILABLE and isinstance(e, httpx.TimeoutException):
            logger.warning("Telegram setWebhook timed out (%s)", type(e).__name__)
            return False
        logger.exception("Failed to set Telegram webhook: %s", e)
        return False


async def get_telegram_webhook_info(bot_token: Optional[str] = None) -> Optional[dict]:
    """Get current webhook URL and pending update count from Telegram (getWebhookInfo). Returns None on failure."""
    token = (bot_token or "").strip() or TELEGRAM_BOT_TOKEN
    if not token or not is_valid_telegram_bot_token(token) or not HTTPX_AVAILABLE:
        return None
    try:
        async with httpx.AsyncClient(timeout=TELEGRAM_BOT_API_TIMEOUT) as client:
            r = await client.get("https://api.telegram.org/bot{}/getWebhookInfo".format(token))
        if r.status_code != 200:
            return {"error": r.text, "status_code": r.status_code}
        data = r.json()
        if not data.get("ok"):
            return {"error": data.get("description", "unknown"), "ok": False}
        return {
            "url": data.get("result", {}).get("url") or "",
            "pending_update_count": data.get("result", {}).get("pending_update_count", 0),
            "has_custom_certificate": data.get("result", {}).get("has_custom_certificate", False),
        }
    except Exception as e:
        if HTTPX_AVAILABLE and isinstance(e, httpx.TimeoutException):
            logger.warning("Telegram getWebhookInfo timed out (%s)", type(e).__name__)
            return None
        logger.exception("Failed to get Telegram webhook info: %s", e)
        return None


async def set_telegram_bot_commands(bot_token: Optional[str] = None) -> bool:
    """Register bot command menu with Telegram (setMyCommands) so /commands appear in the app menu. Uses TELEGRAM_BOT_TOKEN if bot_token not provided."""
    token = (bot_token or "").strip() or TELEGRAM_BOT_TOKEN
    if not token or not is_valid_telegram_bot_token(token):
        return False
    if not HTTPX_AVAILABLE:
        logger.warning("httpx not installed - cannot set Telegram bot commands")
        return False
    try:
        async with httpx.AsyncClient(timeout=TELEGRAM_BOT_API_TIMEOUT) as client:
            r = await client.post(
                "https://api.telegram.org/bot{}/setMyCommands".format(token),
                json={"commands": TELEGRAM_BOT_COMMANDS},
            )
        if r.status_code != 200:
            logger.warning("Telegram setMyCommands failed: %s %s", r.status_code, r.text)
            return False
        logger.info("Telegram bot commands menu set successfully")
        return True
    except Exception as e:
        if HTTPX_AVAILABLE and isinstance(e, httpx.TimeoutException):
            logger.warning("Telegram setMyCommands timed out (%s)", type(e).__name__)
            return False
        logger.exception("Failed to set Telegram bot commands: %s", e)
        return False


def _summarize_spam_paths(entries: List[Tuple], max_lines: int = 8) -> str:
    if not entries:
        return "  (no path detail)"
    keys = [f"{m} {p}" for _, m, p, _ in entries]
    c = Counter(keys)
    lines = [f"  {n}×  {k}" for k, n in c.most_common(max_lines)]
    if len(c) > max_lines:
        lines.append(f"  … +{len(c) - max_lines} other endpoint(s)")
    return "\n".join(lines)


# (path_prefix, method or None for any, human label) — sorted longest-first for matching
_SPAM_ACTIVITY_RULES_RAW: List[Tuple[str, Optional[str], str]] = [
    ("/api/bank/interest/deposit", "POST", "Bank interest deposit"),
    ("/api/bank/interest/claim", "POST", "Bank interest claim"),
    ("/api/bank/swiss/deposit", "POST", "Swiss bank deposit"),
    ("/api/bank/swiss/withdraw", "POST", "Swiss bank withdraw"),
    ("/api/bank/transfer", "POST", "Bank transfer"),
    ("/api/bank/overview", "GET", "Bank overview"),
    ("/api/bank/meta", "GET", "Bank meta"),
    ("/api/gauntlet/leaderboard", "GET", "Flappy Gangster leaderboard"),
    ("/api/gauntlet/me", "GET", "Flappy Gangster profile"),
    ("/api/gauntlet/start", "POST", "Flappy Gangster start run"),
    ("/api/gauntlet/claim", "POST", "Flappy Gangster claim"),
    ("/api/minigames/run-session/start", "POST", "Mini game run session start"),
    ("/api/auth/me", "GET", "Auth session check"),
    ("/api/auth/login", "POST", "Login"),
    ("/api/auth/register", "POST", "Registration"),
]
SPAM_ACTIVITY_RULES: List[Tuple[str, Optional[str], str]] = sorted(
    _SPAM_ACTIVITY_RULES_RAW, key=lambda r: len(r[0]), reverse=True
)

# First URL segment after /api/ → human name (fallback when no SPAM_ACTIVITY_RULES match).
API_SEGMENT_LABELS: Dict[str, str] = {
    "achievements": "Achievements",
    "admin": "Admin",
    "airport": "Airport / travel",
    "armour": "Armoury",
    "attack": "Attacks",
    "auth": "Auth",
    "auto-rank": "Auto Rank",
    "bank": "Bank",
    "battleships": "Battleships",
    "blackjack": "Blackjack",
    "bodyguards": "Bodyguards",
    "booze-run": "Booze run",
    "boxing": "Boxing",
    "bullet-factory": "Bullet factory",
    "crack-safe": "Crack the safe",
    "crimes": "Crimes",
    "daily-rewards": "Daily rewards",
    "dead-alive": "Dead or alive",
    "dice": "Dice",
    "events": "Events",
    "families": "Families",
    "family-run": "Family run",
    "forum": "Forum",
    "game-chat": "Game chat",
    "giphy": "Giphy",
    "gta": "GTA / cars",
    "help-desk": "Help desk",
    "hitlist": "Hitlist",
    "horseracing": "Horse racing",
    "illegal-business": "Illegal business",
    "inventory": "Inventory / consumables",
    "jail": "Jail",
    "leaderboard": "Leaderboard",
    "loot-box": "Loot box",
    "mdg": "Mafia dice game",
    "meta": "Meta / app config",
    "minesweeper": "Minesweeper",
    "minigames": "Mini games leaderboard",
    "missions": "Missions",
    "mp-blackjack": "Multiplayer blackjack",
    "mp-poker": "Multiplayer poker",
    "my-properties": "My properties",
    "news": "News",
    "notifications": "Notifications",
    "npcs": "NPCs",
    "objectives": "Objectives",
    "oc": "Organised crime (OC)",
    "organised-crime": "Organised crime (heists)",
    "payments": "Payments",
    "prestige": "Prestige",
    "profile": "Profile",
    "properties": "Properties",
    "racket": "Racket",
    "racing": "Racing / garage",
    "roulette": "Roulette",
    "shooting-range": "Shooting range",
    "slots": "Slots",
    "snake": "Snake",
    "sports-betting": "Sports betting",
    "stats": "Stats",
    "stock-market": "Stock market",
    "store": "Store",
    "the-getaway": "The Getaway",
    "trade": "Quick trade",
    "user": "User / rank progress",
    "users": "Users",
    "video-poker": "Video poker",
    "wealth-ranks": "Wealth ranks",
    "weapons": "Weapons",
    "whack-a-copper": "Whack-a-copper",
    "gauntlet": "Flappy Gangster",
}

# Longer prefixes where the first segment alone is misleading (sorted with segment rows by length desc).
API_AREA_PREFIX_EXTRA: List[Tuple[str, str]] = [
    ("/api/families/compound/", "Family compound"),
    ("/api/families/crew-oc/", "Crew organised crime"),
    ("/api/families/rackets/", "Family rackets"),
    ("/api/families/war/", "Family war"),
    ("/api/racing/races/", "Circuit races"),
    ("/api/racing/bets/", "Racing bets"),
    ("/api/forum/designer/", "Designer competitions"),
    ("/api/forum/entertainer/", "Entertainer"),
    ("/api/admin/game-ideas/", "Game ideas (admin)"),
    ("/api/admin/security/", "Security admin"),
    ("/api/store/buy-bullets", "Armoury (buy bullets)"),
    ("/api/admin/add-bullets", "Admin — add bullets"),
]

_API_LABEL_PREFIX_CACHE: Optional[List[Tuple[str, str]]] = None


def _build_api_label_prefix_rows() -> List[Tuple[str, str]]:
    rows: List[Tuple[str, str]] = []
    rows.extend(API_AREA_PREFIX_EXTRA)
    for seg, lab in API_SEGMENT_LABELS.items():
        rows.append((f"/api/{seg}/", lab))
        rows.append((f"/api/{seg}", lab))
    rows.sort(key=lambda x: len(x[0]), reverse=True)
    return rows


def _get_api_label_prefix_rows() -> List[Tuple[str, str]]:
    global _API_LABEL_PREFIX_CACHE
    if _API_LABEL_PREFIX_CACHE is None:
        _API_LABEL_PREFIX_CACHE = _build_api_label_prefix_rows()
    return _API_LABEL_PREFIX_CACHE


def _normalize_spam_path(path: str) -> str:
    if not path:
        return ""
    p = path.split("?", 1)[0].strip()
    if not p.startswith("/"):
        p = "/" + p
    return p.lower()


def _describe_api_activity(method: str, path: str) -> str:
    p = _normalize_spam_path(path)
    m = (method or "?").upper()[:16]
    if not p:
        return f"API {m} (no path)"
    for prefix, rule_method, label in SPAM_ACTIVITY_RULES:
        if not p.startswith(prefix):
            continue
        if rule_method is not None and m != rule_method.upper():
            continue
        return label
    if p.startswith("/api/"):
        for prefix, lab in _get_api_label_prefix_rows():
            if p.startswith(prefix):
                return f"{lab} — {m}"
    short = path.split("?", 1)[0].strip()
    if len(short) > 140:
        short = short[:137] + "..."
    return f"API {m} {short}"


def _spam_activity_extras(entries: List[Tuple], flag_type: str, max_lines: int = 10) -> Dict[str, str]:
    """Human-readable activity breakdown; primary line if one label is >=50% of window."""
    if not entries:
        return {}
    labels = [_describe_api_activity(m, p) for _, m, p, _ in entries]
    c = Counter(labels)
    n = len(labels)
    lines = [f"  {cnt}×  {lab}" for lab, cnt in c.most_common(max_lines)]
    if len(c) > max_lines:
        lines.append(f"  … +{len(c) - max_lines} other kind(s)")
    out: Dict[str, str] = {"activity_breakdown": "\n".join(lines)}
    top_lab, top_n = c.most_common(1)[0]
    if n and top_n / n >= 0.5:
        out["primary_activity"] = (
            f"Rapid-fire on: {top_lab}" if flag_type == "burst_spam" else f"Spamming: {top_lab}"
        )
    return out


def _api_area_hint(path: str) -> str:
    p = _normalize_spam_path(path)
    if not p.startswith("/api/"):
        return ""
    for prefix, label in _get_api_label_prefix_rows():
        if p.startswith(prefix):
            return f"Likely feature: {label}"
    return "Likely feature: API (unknown route prefix)"


def _referer_page_hint(referer: str) -> str:
    r = (referer or "").strip()
    if not r:
        return "Browser page: not sent (direct API / missing Referer header)"
    try:
        p = urlparse(r)
        host = (p.netloc or "")[:80]
        path = (p.path or "/")[:140]
        q = ("?" + p.query[:100]) if p.query else ""
        return f"Browser page: {host}{path}{q}"
    except Exception:
        return f"Browser page: {r[:160]}"


def _format_spam_flag_message(username: str, user_id: str, flag_type: str, reason: str, details: Dict) -> str:
    if flag_type == "burst_spam":
        title = "Burst spam (rapid-fire)"
    elif flag_type == "page_visit_spam":
        title = "Page visit spam (sustained same-route traffic)"
    else:
        title = "Request spam (per-second)"
    lines = [
        title,
        f"User: {username}",
        f"User ID: {user_id}",
    ]
    pa = details.get("primary_activity")
    if pa:
        lines.append("")
        lines.append(pa)
    lines += ["", reason]
    ab = details.get("activity_breakdown")
    if ab:
        lines += ["", "What they were doing:", ab]
    lm, lp = details.get("last_method"), details.get("last_path")
    spa = details.get("spa_path")
    if spa and flag_type == "page_visit_spam":
        lines += ["", "SPA path (X-Current-Path):", f"  {spa}", f"Last API: {lm} {details.get('api_path', '')}"]
    elif lp:
        lines += ["", "Request that tripped it:", f"  {lm} {lp}"]
    ps = details.get("path_summary")
    if ps:
        lines += ["", "All calls in this window:", ps]
    rh = details.get("referer_hint")
    if rh:
        lines += ["", rh]
    ah = details.get("api_area_hint")
    if ah:
        lines += ["", ah]
    return "\n".join(lines)


def _spam_telegram_in_cooldown(user_id: str) -> bool:
    return (time.time() - _last_spam_telegram_at.get(user_id, 0)) < _SPAM_TELEGRAM_COOLDOWN_SEC


def _mark_spam_telegram_sent(user_id: str) -> None:
    _last_spam_telegram_at[user_id] = time.time()


async def flag_user_suspicious(db, user_id: str, username: str, flag_type: str, reason: str, details: Dict = None):
    """Flag a user for suspicious activity. Stores in db.security_flags."""
    try:
        details = details or {}
        flag_id = f"{user_id}_{flag_type}_{datetime.now(timezone.utc).timestamp()}"
        await db.security_flags.insert_one({
            "id": flag_id,
            "user_id": user_id,
            "username": username,
            "flag_type": flag_type,  # rate_limit, impossible_stat, rapid_transfer, exploit_attempt, etc.
            "reason": reason,
            "details": details,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "resolved": False,
        })

        # Send immediate alert for critical flags
        if flag_type in ("exploit_attempt", "impossible_stat"):
            msg = f"**User:** {username} (ID: {user_id[:8]}...)\n**Type:** {flag_type}\n**Reason:** {reason}"
            if details:
                msg += f"\n**Details:** {str(details)[:200]}"
            await send_telegram_alert(msg, "exploit")
            await flush_telegram_alerts()  # Send immediately
        elif flag_type in ("request_spam", "burst_spam", "page_visit_spam"):
            if _spam_telegram_in_cooldown(user_id):
                logger.info(
                    "Spam flag recorded for %s (%s); Telegram alert suppressed (cooldown %.0fs)",
                    username, flag_type, _SPAM_TELEGRAM_COOLDOWN_SEC,
                )
            else:
                _mark_spam_telegram_sent(user_id)
                msg = _format_spam_flag_message(username, user_id, flag_type, reason, details)
                await send_telegram_alert(msg, "warning", use_markdown=False)
        elif flag_type == "endpoint_rate_limit_hard":
            if _spam_telegram_in_cooldown(user_id):
                logger.info(
                    "endpoint_rate_limit_hard for %s; Telegram suppressed (cooldown %.0fs)",
                    username,
                    _SPAM_TELEGRAM_COOLDOWN_SEC,
                )
            else:
                _mark_spam_telegram_sent(user_id)
                await send_telegram_alert(
                    f"Sustained endpoint rate abuse\nUser: {username} (ID: {user_id[:12]}...)\n{reason}",
                    "warning",
                    use_markdown=False,
                )
        else:
            msg = f"**User:** {username}\n**Type:** {flag_type}\n**Reason:** {reason}"
            await send_telegram_alert(msg, "warning")

    except Exception as e:
        logger.exception(f"Failed to flag user {username}: {e}")


def _is_auto_rank_control_path(path: str) -> bool:
    """User-facing Auto Rank prefs/start/stop; do not count toward spam/duplicate (cron uses no JWT)."""
    p = (path or "")[:400]
    if not p.startswith("/api"):
        p = "/api" + p if p.startswith("/") else "/api/" + p
    return p.startswith("/api/auto-rank/")


def _normalize_spa_path_from_header(raw: Optional[str]) -> str:
    """Normalize X-Current-Path for page-spam keying (strip, collapse slashes, cap length)."""
    s = (raw or "").strip()
    if not s:
        return "/"
    while "//" in s:
        s = s.replace("//", "/")
    if not s.startswith("/"):
        s = "/" + s
    return s[:500]


# Spam detection (not gameplay limits)
async def check_request_spam(
    user_id: str,
    username: str,
    db,
    method: str = "",
    path: str = "",
    referer: Optional[str] = None,
) -> bool:
    """Detect spam: more than MAX_REQUESTS_PER_SECOND mutating requests in 1s OR burst (>= BURST_MAX_REQUESTS in 0.5s). GET/HEAD/OPTIONS skipped."""
    now = datetime.now(timezone.utc)
    m = (method or "?").upper()[:16]
    if m in ("GET", "HEAD", "OPTIONS"):
        return False
    p = (path or "")[:400]
    if _is_auto_rank_control_path(p):
        return False
    ref = (referer or "").strip()[:500]
    entry: Tuple[datetime, str, str, str] = (now, m, p, ref)

    # Check 1: Standard spam detection (10+ requests in 1 second)
    cutoff_1s = now - timedelta(seconds=1)
    rq = user_request_counts[user_id]
    rq[:] = [e for e in rq if e[0] > cutoff_1s]
    rq.append(entry)
    if len(rq) > _SPAM_LOG_MAX:
        del rq[: len(rq) - _SPAM_LOG_MAX]

    count_1s = len(rq)
    if count_1s > MAX_REQUESTS_PER_SECOND:
        win = list(rq)
        details = {
            "count": count_1s,
            "threshold": MAX_REQUESTS_PER_SECOND,
            "window_sec": 1,
            "last_method": m,
            "last_path": p,
            "path_summary": _summarize_spam_paths(win),
            "referer_hint": _referer_page_hint(ref),
            "api_area_hint": _api_area_hint(p),
        }
        details.update(_spam_activity_extras(win, "request_spam"))
        await flag_user_suspicious(
            db, user_id, username,
            "request_spam",
            f"{count_1s} API calls in 1 second (limit {MAX_REQUESTS_PER_SECOND}).",
            details,
        )
        return True

    # Check 2: Burst detection (rapid clicking - catches autoclickers/macros)
    cutoff_burst = now - timedelta(seconds=BURST_WINDOW_SECONDS)
    bq = user_burst_counts[user_id]
    bq[:] = [e for e in bq if e[0] > cutoff_burst]
    bq.append(entry)
    if len(bq) > _SPAM_LOG_MAX:
        del bq[: len(bq) - _SPAM_LOG_MAX]

    count_burst = len(bq)
    if count_burst >= BURST_MAX_REQUESTS:
        bwin = list(bq)
        bdetails = {
            "count": count_burst,
            "threshold": BURST_MAX_REQUESTS,
            "window_sec": BURST_WINDOW_SECONDS,
            "last_method": m,
            "last_path": p,
            "path_summary": _summarize_spam_paths(bwin),
            "referer_hint": _referer_page_hint(ref),
            "api_area_hint": _api_area_hint(p),
        }
        bdetails.update(_spam_activity_extras(bwin, "burst_spam"))
        await flag_user_suspicious(
            db, user_id, username,
            "burst_spam",
            f"{count_burst} API calls in {BURST_WINDOW_SECONDS}s burst (limit {BURST_MAX_REQUESTS}).",
            bdetails,
        )
        return True

    return False


async def check_page_request_spam(
    user_id: str,
    username: str,
    db,
    *,
    api_path: str,
    spa_path_header: Optional[str],
    method: str,
    referer: Optional[str] = None,
) -> bool:
    """Too many authenticated requests (including GET) for same SPA route within sliding window → 429 cooldown."""
    if not PAGE_SPAM_ENABLED:
        return False
    m = (method or "").upper()[:16]
    if m in ("HEAD", "OPTIONS"):
        return False
    ap = (api_path or "")[:400]
    if _is_auto_rank_control_path(ap):
        return False
    spa = _normalize_spa_path_from_header(spa_path_header)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=PAGE_SPAM_WINDOW_SEC)
    key = (user_id, spa)
    dq = user_page_request_counts[key]
    dq[:] = [t for t in dq if t > cutoff]
    dq.append(now)
    cap = _page_spam_deque_cap()
    if len(dq) > cap:
        del dq[: len(dq) - cap]
    count = len(dq)
    if count > PAGE_SPAM_MAX_REQUESTS:
        ref = (referer or "").strip()[:500]
        details = {
            "count": count,
            "threshold": PAGE_SPAM_MAX_REQUESTS,
            "window_sec": PAGE_SPAM_WINDOW_SEC,
            "spa_path": spa,
            "last_method": m,
            "api_path": ap,
            "referer_hint": _referer_page_hint(ref),
            "api_area_hint": _api_area_hint(ap),
        }
        await flag_user_suspicious(
            db,
            user_id,
            username,
            "page_visit_spam",
            f"{count} requests in {PAGE_SPAM_WINDOW_SEC}s on same page (limit {PAGE_SPAM_MAX_REQUESTS}).",
            details,
        )
        return True
    return False


async def check_duplicate_request(user_id: str, path: str, params_hash: str, db, username: str) -> bool:
    """Detect duplicate requests within configurable window (200-500ms) to reduce false positives from double-clicks."""
    if not DETECT_DUPLICATE_REQUESTS:
        return False
    if _is_auto_rank_control_path(path):
        return False

    window_sec = DUPLICATE_REQUEST_WINDOW_MS / 1000.0
    now = datetime.now(timezone.utc)
    key = f"{user_id}_{path}_{params_hash}"

    # Check if same request was made within the window
    if key in user_action_counts and user_action_counts[key]:
        last_request = user_action_counts[key][-1]
        if (now - last_request).total_seconds() < window_sec:
            await flag_user_suspicious(
                db, user_id, username,
                "duplicate_request",
                f"Duplicate request within {DUPLICATE_REQUEST_WINDOW_MS}ms: {path}",
                {"path": path, "interval_ms": int((now - last_request).total_seconds() * 1000)}
            )
            return True

    # Clean old timestamps (keep only last 2 seconds)
    cutoff = now - timedelta(seconds=2)
    user_action_counts[key] = [ts for ts in user_action_counts.get(key, []) if ts > cutoff]
    user_action_counts[key].append(now)

    return False


async def check_failed_attack_spam(user_id: str, username: str, db) -> bool:
    """Detect spam failed attacks (bot-like behavior)."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=1)
    
    user_failed_attacks[user_id] = [ts for ts in user_failed_attacks[user_id] if ts > cutoff]
    user_failed_attacks[user_id].append(now)
    
    count = len(user_failed_attacks[user_id])
    if count > MAX_FAILED_ATTACKS_PER_MINUTE:
        await flag_user_suspicious(
            db, user_id, username,
            "attack_spam",
            f"Failed attack spam: {count} failed in 1 minute",
            {"count": count}
        )
        return True
    return False


# Background task to flush alerts and periodic exploit checks
async def security_monitor_task(db):
    """Background task: flush Telegram alerts every 30s; periodic negative balance check every 5 min when enabled."""
    cycle = 0
    while True:
        try:
            await asyncio.sleep(30)
            cycle += 1
            await flush_telegram_alerts()
            # Every ~5 min, run periodic negative balance check when enabled
            if cycle >= 10 and DETECT_NEGATIVE_BALANCE:
                cycle = 0
                try:
                    neg_users = await db.users.find(
                        {"money": {"$lt": 0}},
                        {"_id": 0, "id": 1, "username": 1, "money": 1}
                    ).limit(50).to_list(50)
                    for u in neg_users:
                        await check_negative_balance(db, u.get("id", ""), u.get("username", "Unknown"))
                except Exception as e:
                    logger.warning("Periodic negative balance check failed: %s", e)
        except Exception as e:
            logger.exception(f"Security monitor task error: {e}")


# Input validation helpers
def sanitize_username(username: str) -> str:
    """Sanitize username to prevent injection attacks."""
    if not username:
        return ""
    # Only allow alphanumeric, underscore, hyphen, space
    import re
    return re.sub(r'[^a-zA-Z0-9_\- ]', '', username)[:30]


def validate_positive_int(value: Any, field_name: str, max_value: int = None) -> int:
    """Validate and return positive integer, raise ValueError if invalid."""
    try:
        val = int(value)
        if val < 0:
            raise ValueError(f"{field_name} cannot be negative")
        if max_value and val > max_value:
            raise ValueError(f"{field_name} exceeds maximum ({max_value:,})")
        return val
    except (TypeError, ValueError) as e:
        raise ValueError(f"Invalid {field_name}: {e}")


# ====== CONFIGURABLE RATE LIMITING PER ENDPOINT (SPEED / CLICKS) ======

# GLOBAL TOGGLE - When False, ALL rate limits are bypassed regardless of per-endpoint settings
GLOBAL_RATE_LIMITS_ENABLED = False

# Token bucket + strict inter-arrival sustain + hard cooldown (endpoint RL; see security_middleware).
# docs/RATE_LIMITS.md
ENDPOINT_RL_BURST_TOKENS = 35
ENDPOINT_RL_SUSTAIN_WINDOW_SEC = 30
ENDPOINT_RL_SUSTAIN_MIN_SPAN_SEC = 26
ENDPOINT_RL_SUSTAIN_MIN_COUNT = 100
ENDPOINT_RL_HARD_COOLDOWN_MIN_SEC = 15
ENDPOINT_RL_HARD_COOLDOWN_MAX_SEC = 30
ENDPOINT_RL_DB_ATTEMPTS = 5

# Rate limit configuration: endpoint_pattern -> (min_interval_seconds, enabled)
# Default interval 0.3s (300ms) for all patterns when enabled; toggles stay False until admin enables.
RATE_LIMIT_CONFIG = {
    # Format: "endpoint_pattern": (min_interval_sec, enabled)
    # NOTE: Paths must include /api/ prefix to match actual request paths

    # Entertainer forum games — synthetic paths (handlers pass these to check_endpoint_rate_limit only).
    # Enabled + ignore_global_toggle so limits apply even when GLOBAL_RATE_LIMITS_ENABLED is false (same idea as jail bust).
    "/api/forum-entertainer-rl/join": (1.5, True),
    "/api/forum-entertainer-rl/guess": (0.4, True),
    "/api/forum-entertainer-rl/roll": (1.2, True),
    "/api/forum-entertainer-rl/find-word-claim": (2.0, True),

    # Money & economy
    "/api/bank/transfer": (0.3, False),
    "/api/bank/interest/deposit": (0.3, False),
    "/api/bank/interest/claim": (0.3, False),
    "/api/bank/swiss/deposit": (0.3, False),
    "/api/bank/swiss/withdraw": (0.3, False),

    # Attack system
    "/api/attack/": (0.3, False),

    # Crimes
    "/api/crimes/": (0.3, False),

    # Hitlist (all mutating paths under /api/hitlist/)
    "/api/hitlist/": (0.3, False),

    # Store purchases
    "/api/store/": (0.3, False),
    "/api/weapons/": (0.3, False),
    "/api/armour/": (0.3, False),

    # Properties & racket
    "/api/properties/": (0.3, False),
    "/api/racket/": (0.3, False),

    # Bodyguards
    "/api/bodyguards/": (0.3, False),

    # Casino/gambling
    "/api/casino/dice/": (0.3, False),
    "/api/casino/roulette/": (0.3, False),
    "/api/casino/blackjack/": (0.3, False),
    "/api/casino/slots/": (0.3, False),
    "/api/casino/videopoker/": (0.3, False),
    "/api/casino/mdg/": (0.3, False),
    "/api/casino/mp-poker/": (0.3, False),
    "/api/casino/mp-blackjack/": (0.3, False),
    "/api/casino/horseracing/": (0.3, False),
    "/api/casino/mp-8ball/": (0.3, False),
    "/api/sports-betting/": (0.3, False),

    # Minigames & activities
    "/api/loot-box/": (0.3, False),
    "/api/crack-safe/": (0.3, False),
    # Jail: exact paths before /api/jail/ prefix so list/bust have their own admin toggles.
    "/api/jail/players": (0.3, False),  # GET list; route calls check_endpoint_rate_limit like bust
    "/api/jail/bust": (0.3, False),  # off by default; jail route calls RL when admin enables this row
    "/api/jail/": (0.3, False),
    "/api/gta/": (0.3, False),
    "/api/entertainer/": (0.3, False),
    "/api/gauntlet/": (0.3, False),
    "/api/minigames/run-session/start": (0.3, False),
    "/api/minigames/": (0.3, False),
    "/api/boxing/": (0.3, False),
    "/api/snake/": (0.3, False),
    "/api/shooting-range/train": (0.3, False),
    "/api/shooting-range/score": (0.3, False),
    "/api/whack-a-copper/": (0.3, False),

    # Travel & Booze Run (/api/travel exact + /api/travel/* e.g. buy-airmiles)
    "/api/travel": (0.3, False),
    "/api/travel/": (0.3, False),
    "/api/booze-run/": (0.3, False),

    # Families (POST /api/families create is exact path, no trailing slash)
    "/api/families/attack-racket": (0.3, False),
    "/api/families/": (0.3, False),
    "/api/families": (0.3, False),

    # Notifications (bulk DELETE /api/notifications + subpaths)
    "/api/notifications": (0.3, False),
    "/api/notifications/": (0.3, False),

    # Admin endpoints
    "/api/admin/": (0.3, False),

    # Auth & profile
    "/api/auth/login": (0.3, False),
    "/api/auth/register": (0.3, False),
    "/api/auth/me": (0.3, False),
    # Auth router: redeem, locked flow, civilian protection (not under /api/auth/)
    "/api/account/": (0.3, False),
    "/api/account-locked": (0.3, False),
    "/api/account-locked-reply": (0.3, False),

    # Meta & read-only
    "/api/meta/": (0.3, False),
    "/api/users/": (0.3, False),
    "/api/leaderboard/": (0.3, False),

    # Daily rewards & misc
    "/api/daily-rewards/": (0.3, False),
    "/api/prestige/": (0.3, False),

    # Communication
    "/api/game-chat/": (0.3, False),
    "/api/help-desk/": (0.3, False),

    # Economy
    "/api/stock-market/": (0.3, False),

    # Activities
    "/api/oc/": (0.3, False),
    "/api/organised-crime/": (0.3, False),
    "/api/inventory/": (0.3, False),
    "/api/profile/": (0.3, False),

    # Racing, trading, missions, forum (incl. designer auctions & competitions)
    "/api/racing/": (0.3, False),
    "/api/trade/": (0.3, False),
    "/api/illegal-business/": (0.3, False),
    "/api/illegal-business": (0.3, False),
    "/api/lottery/": (0.3, False),
    "/api/forum/": (0.3, False),
    "/api/bullet-factory/": (0.3, False),
    "/api/airports/": (0.3, False),
    "/api/grave-robber/": (0.3, False),
    "/api/witness-statements/": (0.3, False),
    "/api/missions/": (0.3, False),
    "/api/objectives/": (0.3, False),
    "/api/payments/": (0.3, False),
    "/api/webhook/": (0.3, False),
    "/api/family-run/": (0.3, False),
    "/api/auto-rank/": (0.3, False),
    "/api/states/": (0.3, False),
    "/api/stats/": (0.3, False),
    "/api/death/": (0.3, False),
    "/api/dead-alive/": (0.3, False),
    "/api/image-host/": (0.3, False),
    "/api/minesweeper/": (0.3, False),
    "/api/battleships/": (0.3, False),
    "/api/the-getaway/": (0.3, False),
    "/api/mafia-rpg/": (0.3, False),
}

# Keys allowed through check_endpoint_rate_limit(..., ignore_global_toggle=True) when GLOBAL_RATE_LIMITS_ENABLED is false.
_RL_FORCE_KEYS_WHEN_GLOBAL_RATE_LIMITS_OFF = frozenset(
    {
        "/api/jail/players",
        "/api/jail/bust",
        "/api/forum-entertainer-rl/join",
        "/api/forum-entertainer-rl/guess",
        "/api/forum-entertainer-rl/roll",
        "/api/forum-entertainer-rl/find-word-claim",
    }
)


def iter_rate_limit_config_sorted() -> List[Tuple[str, Tuple[float, bool]]]:
    """Alphabetical (pattern, (interval, enabled)) for admin tools — same keys as RATE_LIMIT_CONFIG."""
    return sorted(RATE_LIMIT_CONFIG.items(), key=lambda x: x[0])


# In-memory token bucket when DB path fails: (user_id, endpoint_key) -> {"tokens": float, "last_refill": datetime}
endpoint_rl_bucket_memory: Dict[tuple, dict] = {}


@dataclass
class EndpointRateLimitOutcome:
    """Endpoint RL: blocked + cooldown_seconds. Only hard lockout (rate_limit_hard_until) returns blocked=True."""

    blocked: bool = False
    cooldown_seconds: int = 0
    is_hard_cooldown_response: bool = False


def _coerce_utc_dt(val: Any) -> Optional[datetime]:
    if val is None:
        return None
    if isinstance(val, datetime):
        if val.tzinfo is None:
            return val.replace(tzinfo=timezone.utc)
        return val.astimezone(timezone.utc)
    try:
        dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def get_rate_limit_for_path(path: str) -> tuple[float, bool, str]:
    """Get (min_interval_seconds, enabled, storage_key) for a given path. Storage key is the pattern so e.g. all /api/crimes/* share one limit."""
    # Normalize: config uses /api/ prefix; some proxies or mounts may expose path without it
    path_to_match = path if path.startswith("/api") else ("/api" + path if path.startswith("/") else "/api/" + path)
    for pattern, (interval, enabled) in RATE_LIMIT_CONFIG.items():
        if pattern.endswith("/"):
            if path_to_match.startswith(pattern):
                return (interval, enabled, pattern)
        else:
            if path_to_match == pattern:
                return (interval, enabled, pattern)
    return (1.0, False, path)


async def _endpoint_rl_memory_consume(
    db,
    user_id: str,
    username: str,
    path: str,
    key: str,
    min_interval_sec: float,
    now: datetime,
) -> EndpointRateLimitOutcome:
    """In-memory token bucket + inter-arrival metering. Empty bucket does not 429; sustain violations still feed hard lockout."""
    mem_key = (user_id, key)
    cap = float(ENDPOINT_RL_BURST_TOKENS)
    st = endpoint_rl_bucket_memory.get(mem_key)
    if not st:
        endpoint_rl_bucket_memory[mem_key] = {"tokens": cap - 1.0, "last_refill": now, "last_arrival_at": now}
        return EndpointRateLimitOutcome()
    prev = st.get("last_arrival_at")
    if prev and getattr(prev, "tzinfo", None) is None:
        prev = prev.replace(tzinfo=timezone.utc)
    if prev and min_interval_sec > 0 and (now - prev).total_seconds() < min_interval_sec and db is not None:
        armed = await _endpoint_rl_record_violation_and_maybe_arm_hard(db, user_id, username, path, key, now)
        if armed:
            st["last_arrival_at"] = now
            urow = await db.users.find_one({"id": user_id}, {"rate_limit_hard_until": 1})
            hu = _coerce_utc_dt((urow or {}).get("rate_limit_hard_until"))
            if hu and now < hu:
                cd = max(1, int(math.ceil((hu - now).total_seconds())))
                return EndpointRateLimitOutcome(blocked=True, cooldown_seconds=cd, is_hard_cooldown_response=True)
    last_refill = st["last_refill"]
    if getattr(last_refill, "tzinfo", None) is None:
        last_refill = last_refill.replace(tzinfo=timezone.utc)
    tokens = float(st.get("tokens", cap))
    elapsed = (now - last_refill).total_seconds()
    if min_interval_sec > 0:
        tokens = min(cap, tokens + elapsed / min_interval_sec)
    else:
        tokens = cap
    if tokens >= 1.0:
        st["tokens"] = tokens - 1.0
        st["last_refill"] = now
        st["last_arrival_at"] = now
        return EndpointRateLimitOutcome()
    st["last_arrival_at"] = now
    if db is not None:
        urow = await db.users.find_one({"id": user_id}, {"rate_limit_hard_until": 1})
        hu = _coerce_utc_dt((urow or {}).get("rate_limit_hard_until"))
        if hu and now < hu:
            cd = max(1, int(math.ceil((hu - now).total_seconds())))
            return EndpointRateLimitOutcome(blocked=True, cooldown_seconds=cd, is_hard_cooldown_response=True)
    return EndpointRateLimitOutcome()


async def _endpoint_rl_record_violation_and_maybe_arm_hard(
    db, user_id: str, username: str, path: str, key: str, now: datetime
) -> bool:
    """Record a sub-interval (too-fast) hit; return True if a new hard cooldown was applied."""
    if db is None:
        return False
    try:
        await db.endpoint_rl_violations.insert_one({"user_id": user_id, "at": now})
    except Exception as e:
        logger.warning("endpoint_rl_violations insert: %s", e)
        return False
    cutoff = now - timedelta(seconds=ENDPOINT_RL_SUSTAIN_WINDOW_SEC)
    q = {"user_id": user_id, "at": {"$gte": cutoff}}
    try:
        vcount = await db.endpoint_rl_violations.count_documents(q)
    except Exception as e:
        logger.warning("endpoint_rl_violations count: %s", e)
        return False
    if vcount < ENDPOINT_RL_SUSTAIN_MIN_COUNT:
        return False
    try:
        first_doc = await db.endpoint_rl_violations.find_one(q, sort=[("at", 1)])
        last_doc = await db.endpoint_rl_violations.find_one(q, sort=[("at", -1)])
    except Exception as e:
        logger.warning("endpoint_rl_violations first/last: %s", e)
        return False
    if not first_doc or not last_doc:
        return False
    first_at = _coerce_utc_dt(first_doc.get("at")) or now
    last_at = _coerce_utc_dt(last_doc.get("at")) or now
    span = (last_at - first_at).total_seconds()
    if span < ENDPOINT_RL_SUSTAIN_MIN_SPAN_SEC:
        return False
    try:
        u = await db.users.find_one({"id": user_id}, {"rate_limit_hard_until": 1})
        hu = _coerce_utc_dt((u or {}).get("rate_limit_hard_until"))
        if hu and now < hu:
            return False
    except Exception:
        pass
    secs = random.randint(ENDPOINT_RL_HARD_COOLDOWN_MIN_SEC, ENDPOINT_RL_HARD_COOLDOWN_MAX_SEC)
    until = now + timedelta(seconds=secs)
    try:
        await db.users.update_one({"id": user_id}, {"$set": {"rate_limit_hard_until": until.isoformat()}})
        await flag_user_suspicious(
            db,
            user_id,
            username,
            "endpoint_rate_limit_hard",
            (
                f"Sustained endpoint rate abuse ({vcount} hits in {ENDPOINT_RL_SUSTAIN_WINDOW_SEC}s, "
                f"span {span:.0f}s): hard cooldown {secs}s on {path}"
            ),
            {"path": path, "endpoint_key": key, "cooldown_seconds": secs, "violation_count": vcount},
        )
    except Exception as e:
        logger.warning("arm hard endpoint RL: %s", e)
        return False
    return True


async def _endpoint_rl_consume_db(
    db, user_id: str, username: str, path: str, key: str, min_interval_sec: float, now: datetime
) -> EndpointRateLimitOutcome:
    cap = float(ENDPOINT_RL_BURST_TOKENS)
    for _attempt in range(ENDPOINT_RL_DB_ATTEMPTS):
        doc = await db.rate_limit_clicks.find_one({"user_id": user_id, "endpoint_key": key})
        if doc is None:
            try:
                await db.rate_limit_clicks.insert_one(
                    {
                        "user_id": user_id,
                        "endpoint_key": key,
                        "last_at": now,
                        "last_refill": now,
                        "last_arrival_at": now,
                        "tokens": cap - 1.0,
                    }
                )
                return EndpointRateLimitOutcome()
            except DuplicateKeyError:
                continue

        prev = _coerce_utc_dt(doc.get("last_arrival_at")) or _coerce_utc_dt(doc.get("last_at"))
        if prev and min_interval_sec > 0 and (now - prev).total_seconds() < min_interval_sec:
            armed = await _endpoint_rl_record_violation_and_maybe_arm_hard(db, user_id, username, path, key, now)
            if armed:
                await db.rate_limit_clicks.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"last_arrival_at": now, "last_at": now, "user_id": user_id, "endpoint_key": key}},
                )
                urow = await db.users.find_one({"id": user_id}, {"rate_limit_hard_until": 1})
                hu = _coerce_utc_dt((urow or {}).get("rate_limit_hard_until"))
                if hu and now < hu:
                    cd = max(1, int(math.ceil((hu - now).total_seconds())))
                    return EndpointRateLimitOutcome(blocked=True, cooldown_seconds=cd, is_hard_cooldown_response=True)

        last_refill = _coerce_utc_dt(doc.get("last_refill")) or _coerce_utc_dt(doc.get("last_at")) or now
        if doc.get("tokens") is None:
            tokens = cap
        else:
            tokens = float(doc["tokens"])
        elapsed = (now - last_refill).total_seconds()
        if min_interval_sec > 0:
            tokens = min(cap, tokens + elapsed / min_interval_sec)
        else:
            tokens = cap
        if tokens >= 1.0:
            new_tokens = tokens - 1.0
            res = await db.rate_limit_clicks.update_one(
                {"_id": doc["_id"]},
                {
                    "$set": {
                        "tokens": new_tokens,
                        "last_refill": now,
                        "last_at": now,
                        "last_arrival_at": now,
                        "user_id": user_id,
                        "endpoint_key": key,
                    }
                },
            )
            if res.modified_count == 1:
                return EndpointRateLimitOutcome()
            continue

        await db.rate_limit_clicks.update_one(
            {"_id": doc["_id"]},
            {"$set": {"last_arrival_at": now, "last_at": now, "user_id": user_id, "endpoint_key": key}},
        )
        urow = await db.users.find_one({"id": user_id}, {"rate_limit_hard_until": 1})
        hu = _coerce_utc_dt((urow or {}).get("rate_limit_hard_until"))
        if hu and now < hu:
            cd = max(1, int(math.ceil((hu - now).total_seconds())))
            return EndpointRateLimitOutcome(blocked=True, cooldown_seconds=cd, is_hard_cooldown_response=True)
        return EndpointRateLimitOutcome()

    return await _endpoint_rl_memory_consume(db, user_id, username, path, key, min_interval_sec, now)


async def check_endpoint_rate_limit(
    path: str, user_id: str, username: str, db, *, ignore_global_toggle: bool = False
) -> EndpointRateLimitOutcome:
    """
    Per-endpoint token-bucket metering (DB-backed). Sub-interval arrivals feed sustain violations.
    Empty bucket allows the request; only active hard lockout (rate_limit_hard_until) returns HTTP block from this layer.
    When ignore_global_toggle is True, selected patterns may still rate-limit while GLOBAL_RATE_LIMITS_ENABLED is off (jail bust, entertainer forum game actions).
    """
    min_interval_sec, enabled, key = get_rate_limit_for_path(path)
    if not enabled or min_interval_sec <= 0:
        return EndpointRateLimitOutcome()
    if not GLOBAL_RATE_LIMITS_ENABLED:
        if not (ignore_global_toggle and key in _RL_FORCE_KEYS_WHEN_GLOBAL_RATE_LIMITS_OFF):
            return EndpointRateLimitOutcome()

    now = datetime.now(timezone.utc)

    if db is not None:
        try:
            urow = await db.users.find_one({"id": user_id}, {"rate_limit_hard_until": 1})
            hu = _coerce_utc_dt((urow or {}).get("rate_limit_hard_until"))
            if hu and now < hu:
                cd = max(1, int(math.ceil((hu - now).total_seconds())))
                return EndpointRateLimitOutcome(blocked=True, cooldown_seconds=cd, is_hard_cooldown_response=True)
            if hu and now >= hu:
                await db.users.update_one({"id": user_id}, {"$unset": {"rate_limit_hard_until": ""}})
        except Exception as e:
            logger.warning("rate_limit_hard_until check: %s", e)

    if db is not None:
        try:
            return await _endpoint_rl_consume_db(db, user_id, username, path, key, min_interval_sec, now)
        except Exception as e:
            logger.warning("Rate limit DB check failed, falling back to in-memory: %s", e)

    return await _endpoint_rl_memory_consume(db, user_id, username, path, key, min_interval_sec, now)


# Middleware helper for FastAPI
async def security_check_request(request, db, current_user: Dict = None):
    """
    Main security check for incoming requests.
    Call this from middleware or route dependencies.
    Returns True if request should be blocked.
    """
    if not current_user:
        return False  # Skip checks for unauthenticated requests
    
    user_id = current_user.get("id")
    username = current_user.get("username", "Unknown")
    path = request.url.path
    
    # Check endpoint-specific rate limit
    rl = await check_endpoint_rate_limit(path, user_id, username, db)
    if rl.blocked:
        return True  # Block request
    
    return False  # Allow request


# FastAPI dependency for rate limiting
from fastapi import HTTPException as FastAPIHTTPException

async def rate_limit_dependency(request, current_user: Dict, db):
    """
    FastAPI dependency that enforces rate limiting.
    Add this to any endpoint with: Depends(rate_limit_dependency)
    
    Usage example:
    @app.get("/some-endpoint")
    async def my_endpoint(
        current_user: dict = Depends(get_current_user),
        _rate_limit: None = Depends(rate_limit_dependency)
    ):
        # Your endpoint code here
    """
    user_id = current_user.get("id")
    username = current_user.get("username", "Unknown")
    path = request.url.path
    
    rl = await check_endpoint_rate_limit(path, user_id, username, db)
    if rl.blocked:
        detail = f"Too many repeated rate limits. Please wait {rl.cooldown_seconds} seconds."
        raise FastAPIHTTPException(status_code=429, detail=detail)


# ============================================================================
# ADMIN DASHBOARD & REPORTING
# ============================================================================

async def get_security_summary(db, limit: int = 100, flag_type: str = None) -> dict:
    """
    Get recent security flags for admin dashboard.
    
    Args:
        db: Database connection
        limit: Max number of flags to return
        flag_type: Optional filter by type (e.g., "exploit_negative_balance", "request_spam")
    """
    query = {}
    if flag_type:
        query["flag_type"] = flag_type
    
    flags = await db.security_flags.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    
    # Count by type
    type_counts = {}
    for flag in flags:
        ftype = flag.get("flag_type", "unknown")
        type_counts[ftype] = type_counts.get(ftype, 0) + 1
    
    # Count unique users flagged
    unique_users = len(set(f.get("user_id") for f in flags if f.get("user_id")))
    
    # Group by user
    user_flags = {}
    for flag in flags:
        uid = flag.get("user_id")
        if uid:
            if uid not in user_flags:
                user_flags[uid] = {
                    "user_id": uid,
                    "username": flag.get("username"),
                    "flag_count": 0,
                    "flag_types": set()
                }
            user_flags[uid]["flag_count"] += 1
            user_flags[uid]["flag_types"].add(flag.get("flag_type"))
    
    # Convert sets to lists for JSON serialization
    top_offenders = sorted(
        [
            {**u, "flag_types": list(u["flag_types"])}
            for u in user_flags.values()
        ],
        key=lambda x: x["flag_count"],
        reverse=True
    )[:10]
    
    return {
        "total_flags": len(flags),
        "unique_users_flagged": unique_users,
        "by_type": type_counts,
        "top_offenders": top_offenders,
        "recent_flags": flags,
        "telegram_enabled": TELEGRAM_ENABLED,
        "telegram_configured": bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID),
        "rate_limit_config": {
            path: {"min_interval_ms": round(interval * 1000, 1), "enabled": enabled}
            for path, (interval, enabled) in iter_rate_limit_config_sorted()
        },
        "rate_limit_pattern_count": len(RATE_LIMIT_CONFIG),
    }


async def clear_user_security_flags(db, user_id: str) -> int:
    """Clear all security flags for a specific user (admin action)."""
    result = await db.security_flags.delete_many({"user_id": user_id})
    return result.deleted_count


async def clear_old_security_flags(db, days: int = 30) -> int:
    """Clear security flags older than specified days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result = await db.security_flags.delete_many({
        "created_at": {"$lt": cutoff.isoformat()}
    })
    return result.deleted_count


# ============================================================================
# EXPLOIT DETECTION (not gameplay limits)
# ============================================================================

async def check_negative_balance(db, user_id: str, username: str):
    """Check if user has negative money (should be impossible) - THIS IS AN EXPLOIT."""
    if not DETECT_NEGATIVE_BALANCE:
        return
    
    user = await db.users.find_one({"_id": user_id}, {"_id": 0, "money": 1})
    if user and user.get("money", 0) < 0:
        await flag_user_suspicious(
            db, user_id, username,
            "exploit_negative_balance",
            f"EXPLOIT: Negative balance ${user['money']:,}",
            {"money": user["money"]}
        )
        await flush_telegram_alerts()  # Send immediately


async def check_impossible_wealth_gain(db, user_id: str, username: str, previous_money: int, new_money: int, source: str = "unknown"):
    """
    Detect IMPOSSIBLE wealth gains (exploits, not legitimate high gameplay).
    Only flags gains over $1T in single action which should never happen legitimately.
    """
    gain = new_money - previous_money
    
    # Only flag impossible gains (exploits), not legitimate high earnings
    if gain > DETECT_IMPOSSIBLE_GAIN:
        await flag_user_suspicious(
            db, user_id, username,
            "exploit_impossible_gain",
            f"EXPLOIT: Impossible wealth gain ${gain:,} from {source}",
            {"previous": previous_money, "new": new_money, "gain": gain, "source": source}
        )
        await flush_telegram_alerts()  # Send immediately
