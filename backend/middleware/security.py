# Anti-cheat and security monitoring system
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List, Tuple
import logging
import os
import re
import time
from collections import defaultdict
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

logger = logging.getLogger(__name__)

# Telegram configuration
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID', '')
TELEGRAM_ENABLED = bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)

# Security thresholds (failed-attack spam only; per-request mutating spam removed in Phase 0)
MAX_FAILED_ATTACKS_PER_MINUTE = 20  # Bot-like failed attack spam

# Page-visit / mutating request RL removed (Phase 0). Kept for admin cheat-config introspection only.
PAGE_SPAM_ENABLED = False
PAGE_SPAM_WINDOW_SEC = 30.0
PAGE_SPAM_MAX_REQUESTS = 130

# Throttle repeated Telegram alerts for the same user (spam burst/request flags)
_SPAM_TELEGRAM_COOLDOWN_SEC = 300
_last_spam_telegram_at: Dict[str, float] = {}

# Exploit detection (off by default - enable in admin panel or here when ready for production)
DETECT_NEGATIVE_BALANCE = False
DETECT_IMPOSSIBLE_GAIN = 50_000_000  # $50M+ gain in single action = exploit (configurable via admin)
DETECT_DUPLICATE_REQUESTS = False
DUPLICATE_REQUEST_WINDOW_MS = 300  # 200-500ms window to reduce false positives from double-clicks

# In-memory tracking for failed-attack spam only
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
# Optional stricter signup/login check: dynamic GetIPIntel score (not ban-list-only). More false positives on mobile.
PROXY_CHECK_AUTH_STRICT = os.environ.get("GETIPINTEL_AUTH_STRICT", "").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
PROXY_CHECK_AUTH_STRICT_THRESHOLD = float(os.environ.get("GETIPINTEL_AUTH_STRICT_THRESHOLD", "0.97") or "0.97")

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


async def is_proxy_or_vpn_auth_strict(ip: str) -> bool:
    """
    Stricter auth-only GetIPIntel check (dynamic probability, not flags=m ban list).
    Enabled when GETIPINTEL_AUTH_STRICT=true and GETIPINTEL_CONTACT_EMAIL is set.
    Catches some residential rotators missed by ban-list-only mode; may false-positive on carrier NAT.
    """
    if not PROXY_CHECK_AUTH_STRICT or not ip or not PROXY_CHECK_CONTACT_EMAIL:
        return False
    if not HTTPX_AVAILABLE:
        return False
    try:
        url = f"http://check.getipintel.net/check.php?ip={ip}&contact={PROXY_CHECK_CONTACT_EMAIL}&format=json"
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url)
        if r.status_code != 200:
            return False
        data = r.json()
        if isinstance(data, dict) and "result" in data:
            try:
                prob = float(data.get("result"))
            except (TypeError, ValueError):
                return False
            return prob >= PROXY_CHECK_AUTH_STRICT_THRESHOLD
        return False
    except Exception as e:
        logger.warning("GetIPIntel strict auth check failed for %s: %s", ip, e)
        return False


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


async def check_request_spam(
    user_id: str,
    username: str,
    db,
    method: str = "",
    path: str = "",
    referer: Optional[str] = None,
) -> bool:
    """Phase 0: mutating-request spam detection removed (no 429 from this layer)."""
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
    """Phase 0: page-visit sliding window removed."""
    return False


async def check_duplicate_request(user_id: str, path: str, params_hash: str, db, username: str) -> bool:
    """Phase 0: duplicate POST window removed from HTTP pipeline (DETECT_DUPLICATE_REQUESTS ignored)."""
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


# ====== Phase 0: per-endpoint rate limiting removed (empty registry) ======
GLOBAL_RATE_LIMITS_ENABLED = False

RATE_LIMIT_CONFIG: Dict[str, Tuple[float, bool]] = {}


def iter_rate_limit_config_sorted() -> List[Tuple[str, Tuple[float, bool]]]:
    """Alphabetical (pattern, (interval, enabled)) for admin tools — same keys as RATE_LIMIT_CONFIG."""
    return sorted(RATE_LIMIT_CONFIG.items(), key=lambda x: x[0])


@dataclass
class EndpointRateLimitOutcome:
    """Legacy shape for callers; Phase 0 always allows."""

    blocked: bool = False
    cooldown_seconds: int = 0
    is_hard_cooldown_response: bool = False


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


async def check_endpoint_rate_limit(
    path: str, user_id: str, username: str, db, *, ignore_global_toggle: bool = False
) -> EndpointRateLimitOutcome:
    """Phase 0: no endpoint throttling (legacy callers may still await this)."""
    _ = path, user_id, username, db, ignore_global_toggle
    return EndpointRateLimitOutcome()


async def security_check_request(request, db, current_user: Dict = None):
    """Phase 0: do not block (IP bans handled in SecurityMiddleware)."""
    return False


async def rate_limit_dependency(request, current_user: Dict, db):
    """Phase 0: no-op for optional Depends() sites."""
    return None


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
