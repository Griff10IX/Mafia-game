# Anti-cheat and security monitoring system
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List, Tuple
import logging
import os
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
except ImportError:
    HTTPX_AVAILABLE = False

logger = logging.getLogger(__name__)

# Telegram configuration
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID', '')
TELEGRAM_ENABLED = bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)

# Security thresholds - FOCUS ON SPAM & EXPLOITS, NOT LEGITIMATE HIGH ACTIVITY
MAX_REQUESTS_PER_SECOND = 10  # Spam detection: 10+ requests per second
MAX_FAILED_ATTACKS_PER_MINUTE = 20  # Bot-like failed attack spam
MAX_SAME_ACTION_PER_SECOND = 3  # Same endpoint hit 3+ times in 1 second = bot

# Burst detection - catches rapid clicking (e.g. autoclickers or macros)
BURST_WINDOW_SECONDS = 0.5  # Time window for burst detection
BURST_MAX_REQUESTS = 10  # Max requests allowed in burst window (10 clicks in 0.5s = 20 clicks/sec)

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
        async with httpx.AsyncClient(timeout=10.0) as client:
            payload = {"chat_id": TELEGRAM_CHAT_ID, "text": combined_message[:4000]}
            if use_markdown:
                payload["parse_mode"] = "Markdown"
            r = await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json=payload,
            )
            if r.status_code == 400:
                payload.pop("parse_mode", None)
                await client.post(
                    f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                    json=payload,
                )
    except Exception as e:
        logger.exception(f"Failed to send Telegram alert: {e}")


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
        async with httpx.AsyncClient(timeout=10.0) as client:
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
        async with httpx.AsyncClient(timeout=15.0) as client:
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
        logger.exception("Failed to set Telegram webhook: %s", e)
        return False


async def get_telegram_webhook_info(bot_token: Optional[str] = None) -> Optional[dict]:
    """Get current webhook URL and pending update count from Telegram (getWebhookInfo). Returns None on failure."""
    token = (bot_token or "").strip() or TELEGRAM_BOT_TOKEN
    if not token or not is_valid_telegram_bot_token(token) or not HTTPX_AVAILABLE:
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
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
        async with httpx.AsyncClient(timeout=10.0) as client:
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
    ("/api/gauntlet/start", "POST", "Flappy Gangster start run"),
    ("/api/gauntlet/claim", "POST", "Flappy Gangster claim"),
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
    title = "Burst spam (rapid-fire)" if flag_type == "burst_spam" else "Request spam (per-second)"
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
    if lp:
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
        elif flag_type in ("request_spam", "burst_spam"):
            if _spam_telegram_in_cooldown(user_id):
                logger.info(
                    "Spam flag recorded for %s (%s); Telegram alert suppressed (cooldown %.0fs)",
                    username, flag_type, _SPAM_TELEGRAM_COOLDOWN_SEC,
                )
            else:
                _mark_spam_telegram_sent(user_id)
                msg = _format_spam_flag_message(username, user_id, flag_type, reason, details)
                await send_telegram_alert(msg, "warning", use_markdown=False)
        else:
            msg = f"**User:** {username}\n**Type:** {flag_type}\n**Reason:** {reason}"
            await send_telegram_alert(msg, "warning")

    except Exception as e:
        logger.exception(f"Failed to flag user {username}: {e}")


# Spam detection (not gameplay limits)
async def check_request_spam(
    user_id: str,
    username: str,
    db,
    method: str = "",
    path: str = "",
    referer: Optional[str] = None,
) -> bool:
    """Detect spam: 10+ requests in 1 second OR burst clicking (10+ in 0.5s). Returns True if spam detected."""
    now = datetime.now(timezone.utc)
    m = (method or "?").upper()[:16]
    p = (path or "")[:400]
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


async def check_duplicate_request(user_id: str, path: str, params_hash: str, db, username: str) -> bool:
    """Detect duplicate requests within configurable window (200-500ms) to reduce false positives from double-clicks."""
    if not DETECT_DUPLICATE_REQUESTS:
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

# Rate limit configuration: endpoint_pattern -> (min_interval_seconds, enabled)
# Limit is "minimum seconds between clicks" - e.g. 1.0 = max 1 click/sec, 0.5 = max 2 clicks/sec
RATE_LIMIT_CONFIG = {
    # Format: "endpoint_pattern": (min_interval_sec, enabled)
    # NOTE: Paths must include /api/ prefix to match actual request paths
    
    # All per-endpoint rate limits are OFF by default.
    # Enable individually or flip GLOBAL_RATE_LIMITS_ENABLED when ready for production.

    # Money & economy
    "/api/bank/transfer": (6.0, False),
    "/api/bank/interest/deposit": (3.0, False),
    "/api/bank/interest/claim": (3.0, False),
    "/api/bank/swiss/deposit": (2.0, False),
    "/api/bank/swiss/withdraw": (2.0, False),
    
    # Attack system
    "/api/attack/": (1.5, False),
    
    # Crimes
    "/api/crimes/": (1.5, False),
    
    # Hitlist
    "/api/hitlist/add": (4.0, False),
    "/api/hitlist/buy-off": (3.0, False),
    
    # Store purchases
    "/api/store/": (2.0, False),
    "/api/weapons/": (1.5, False),
    "/api/armour/": (1.5, False),
    
    # Properties & racket
    "/api/properties/": (1.5, False),
    "/api/racket/": (1.5, False),
    
    # Bodyguards
    "/api/bodyguards/": (0, False),
    
    # Casino/gambling
    "/api/casino/dice/": (1.2, False),
    "/api/casino/roulette/": (1.2, False),
    "/api/casino/blackjack/": (1.2, False),
    "/api/casino/slots/": (1.2, False),
    "/api/casino/videopoker/": (1.2, False),
    "/api/casino/mdg/": (1.5, False),
    "/api/casino/mp-poker/": (1.0, False),
    "/api/casino/mp-blackjack/": (1.0, False),
    "/api/sports-betting/": (1.2, False),
    
    # Minigames & activities
    "/api/loot-box/": (1.5, False),
    "/api/crack-safe/": (2.0, False),
    "/api/jail/bust": (1.5, False),
    "/api/jail/": (1.0, False),
    "/api/gta/": (1.5, False),
    "/api/entertainer/": (1.5, False),
    "/api/gauntlet/": (1.0, False),
    "/api/boxing/": (1.0, False),
    "/api/snake/": (0.5, False),
    "/api/shooting-range/train": (2.0, False),
    "/api/shooting-range/score": (1.0, False),
    "/api/whack-a-copper/": (1.0, False),
    
    # Travel & Booze Run
    "/api/travel": (3.0, False),
    "/api/booze-run/": (2.0, False),
    
    # Families
    "/api/families/attack-racket": (3.0, False),
    "/api/families/": (1.5, False),
    
    # Notifications
    "/api/notifications/send": (3.0, False),
    
    # Admin endpoints
    "/api/admin/": (0.0, False),
    
    # Auth & profile
    "/api/auth/login": (3.0, False),
    "/api/auth/register": (6.0, False),
    "/api/auth/me": (0.5, False),
    
    # Meta & read-only
    "/api/meta/": (0.5, False),
    "/api/users/": (0.75, False),
    "/api/leaderboard/": (1.0, False),
    
    # Daily rewards & misc
    "/api/daily-rewards/": (5.0, False),
    "/api/prestige/": (10.0, False),
    
    # Communication
    "/api/game-chat/": (1.0, False),
    "/api/help-desk/": (3.0, False),
    
    # Economy
    "/api/stock-market/": (2.0, False),
    
    # Activities
    "/api/oc/": (2.0, False),
    "/api/inventory/": (1.5, False),
    "/api/profile/": (2.0, False),
}

# Per-endpoint last request time: key -> user_id -> datetime (for min-interval-between-clicks)
endpoint_user_last_request = defaultdict(dict)


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


async def check_endpoint_rate_limit(path: str, user_id: str, username: str, db) -> bool:
    """
    Check if user is clicking too fast (min interval between clicks).
    Returns True if request should be blocked (clicked too soon).
    Uses DB when available so rate limits apply across workers and restarts.
    """
    if not GLOBAL_RATE_LIMITS_ENABLED:
        return False

    min_interval_sec, enabled, key = get_rate_limit_for_path(path)

    if not enabled or min_interval_sec <= 0:
        return False

    now = datetime.now(timezone.utc)

    # Database-backed rate limit: atomic check-and-set so it works across workers
    if db is not None:
        try:
            cutoff = now - timedelta(seconds=min_interval_sec)
            result = await db.rate_limit_clicks.update_one(
                {
                    "user_id": user_id,
                    "endpoint_key": key,
                    "$or": [
                        {"last_at": {"$exists": False}},
                        {"last_at": None},
                        {"last_at": {"$lte": cutoff}},
                    ],
                },
                {"$set": {"user_id": user_id, "endpoint_key": key, "last_at": now}},
                upsert=True,
            )
            if result.modified_count == 1 or result.upserted_count == 1:
                return False  # allowed
            # Too soon: block and flag
            await flag_user_suspicious(
                db, user_id, username,
                "endpoint_rate_limit",
                f"Too many clicks on {path}: need {min_interval_sec}s between requests",
                {"path": path, "min_interval_sec": min_interval_sec},
            )
            return True
        except Exception as e:
            if getattr(e, "code", None) == 11000:
                # Duplicate key: another worker just inserted; treat as too soon
                await flag_user_suspicious(
                    db, user_id, username,
                    "endpoint_rate_limit",
                    f"Too many clicks on {path}: need {min_interval_sec}s between requests",
                    {"path": path, "min_interval_sec": min_interval_sec},
                )
                return True
            logger.warning("Rate limit DB check failed, falling back to in-memory: %s", e)

    # In-memory fallback (single worker only)
    last = endpoint_user_last_request.get(key, {}).get(user_id)
    if last is not None:
        elapsed = (now - last).total_seconds()
        if elapsed < min_interval_sec:
            await flag_user_suspicious(
                db, user_id, username,
                "endpoint_rate_limit",
                f"Too many clicks on {path}: need {min_interval_sec}s between requests (got {elapsed:.2f}s)",
                {"path": path, "min_interval_sec": min_interval_sec, "elapsed_sec": round(elapsed, 2)},
            )
            return True

    endpoint_user_last_request.setdefault(key, {})[user_id] = now
    return False


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
    if await check_endpoint_rate_limit(path, user_id, username, db):
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
    
    # Check if rate limit exceeded
    if await check_endpoint_rate_limit(path, user_id, username, db):
        raise FastAPIHTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Please slow down."
        )


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
        "rate_limit_config": {path: {"min_interval_ms": round(interval * 1000, 1), "enabled": enabled} for path, (interval, enabled) in RATE_LIMIT_CONFIG.items()}
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
