# Anti-cheat and security monitoring system
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
import logging
import os
from collections import defaultdict
import asyncio

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

# Exploit detection (not legitimate gameplay limits)
DETECT_NEGATIVE_BALANCE = True  # Should never happen legitimately
DETECT_IMPOSSIBLE_GAIN = 1_000_000_000_000  # $1T+ gain in single action = exploit
DETECT_DUPLICATE_REQUESTS = True  # Same request twice in <100ms = potential exploit

# In-memory rate limiting (per user)
user_request_counts = defaultdict(list)  # user_id -> [timestamp1, timestamp2, ...]
user_action_counts = defaultdict(list)   # user_id -> [timestamp1, timestamp2, ...]
user_failed_attacks = defaultdict(list)  # user_id -> [timestamp1, timestamp2, ...]

# Security flags database structure:
# db.security_flags: {
#   user_id, username, flag_type, reason, details (dict), created_at, resolved (bool)
# }

# Proxy/VPN check (optional): set GETIPINTEL_CONTACT_EMAIL in .env to enable. GetIPIntel free API.
PROXY_CHECK_CONTACT_EMAIL = os.environ.get("GETIPINTEL_CONTACT_EMAIL", "").strip()
PROXY_CHECK_THRESHOLD = 0.99  # Only block if probability >= 0.99 (recommended by GetIPIntel)

# Telegram notification queue (async batch sending)
pending_alerts = []


async def is_proxy_or_vpn(ip: str) -> bool:
    """Return True if IP appears to be proxy/VPN (block registration). Requires GETIPINTEL_CONTACT_EMAIL in env."""
    if not ip or not PROXY_CHECK_CONTACT_EMAIL:
        return False
    if not HTTPX_AVAILABLE:
        return False
    try:
        # API: https://getipintel.net/free-proxy-vpn-tor-detection-api/ (contact required, no URL encoding)
        url = f"http://check.getipintel.net/check.php?ip={ip}&contact={PROXY_CHECK_CONTACT_EMAIL}&format=json"
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url)
        if r.status_code != 200:
            return False
        data = r.json()
        if isinstance(data, dict) and "result" in data:
            prob = float(data.get("result", 0))
            return prob >= PROXY_CHECK_THRESHOLD
        return False
    except Exception as e:
        logger.warning("Proxy check failed for %s: %s", ip, e)
        return False  # Fail open: don't block if API errors


async def send_telegram_alert(message: str, alert_type: str = "warning"):
    """Send alert to Telegram bot. Queues for batch sending."""
    if not TELEGRAM_ENABLED:
        logger.info(f"[SECURITY {alert_type.upper()}] {message}")
        return
    
    emoji = {
        "critical": "🚨",
        "warning": "⚠️",
        "info": "ℹ️",
        "exploit": "💀",
    }.get(alert_type, "⚠️")
    
    formatted = f"{emoji} **{alert_type.upper()}**\n\n{message}\n\n🕐 {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}"
    pending_alerts.append(formatted)


async def flush_telegram_alerts():
    """Send all pending alerts to Telegram (batch). Called periodically or on critical alert."""
    if not pending_alerts or not TELEGRAM_ENABLED:
        return
    
    if not HTTPX_AVAILABLE:
        logger.warning(f"httpx not installed - cannot send {len(pending_alerts)} Telegram alerts. Install with: pip install httpx")
        pending_alerts.clear()
        return
    
    # Take up to 10 alerts at a time
    batch = pending_alerts[:10]
    for _ in range(len(batch)):
        pending_alerts.pop(0)
    
    combined_message = "\n\n---\n\n".join(batch)
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": combined_message[:4000],  # Telegram limit
                    "parse_mode": "Markdown"
                }
            )
    except Exception as e:
        logger.exception(f"Failed to send Telegram alert: {e}")


async def send_telegram_to_chat(chat_id: str, message: str, bot_token: Optional[str] = None) -> bool:
    """Send a message to a specific Telegram chat (e.g. for Auto Rank results). Uses user's bot_token if provided, else global TELEGRAM_BOT_TOKEN."""
    chat_id = (chat_id or "").strip()
    if not chat_id:
        return False
    token = (bot_token or "").strip() or TELEGRAM_BOT_TOKEN
    if not token:
        return False
    if not HTTPX_AVAILABLE:
        logger.warning("httpx not installed - cannot send Telegram to user")
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                "https://api.telegram.org/bot{}/sendMessage".format(token),
                json={
                    "chat_id": chat_id,
                    "text": message[:4000],
                    "parse_mode": "Markdown",
                },
            )
        return True
    except Exception as e:
        logger.exception("Failed to send Telegram to chat %s: %s", chat_id, e)
        return False


async def flag_user_suspicious(db, user_id: str, username: str, flag_type: str, reason: str, details: Dict = None):
    """Flag a user for suspicious activity. Stores in db.security_flags."""
    try:
        flag_id = f"{user_id}_{flag_type}_{datetime.now(timezone.utc).timestamp()}"
        await db.security_flags.insert_one({
            "id": flag_id,
            "user_id": user_id,
            "username": username,
            "flag_type": flag_type,  # rate_limit, impossible_stat, rapid_transfer, exploit_attempt, etc.
            "reason": reason,
            "details": details or {},
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
        else:
            msg = f"**User:** {username}\n**Type:** {flag_type}\n**Reason:** {reason}"
            await send_telegram_alert(msg, "warning")
            
    except Exception as e:
        logger.exception(f"Failed to flag user {username}: {e}")


# Spam detection (not gameplay limits)
async def check_request_spam(user_id: str, username: str, db) -> bool:
    """Detect spam: 10+ requests in 1 second. Returns True if spam detected."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=1)
    
    # Clean old timestamps
    user_request_counts[user_id] = [ts for ts in user_request_counts[user_id] if ts > cutoff]
    user_request_counts[user_id].append(now)
    
    count = len(user_request_counts[user_id])
    if count > MAX_REQUESTS_PER_SECOND:
        await flag_user_suspicious(
            db, user_id, username,
            "request_spam",
            f"Request spam detected: {count} requests in 1 second",
            {"count": count, "threshold": MAX_REQUESTS_PER_SECOND}
        )
        return True
    return False


async def check_duplicate_request(user_id: str, path: str, params_hash: str, db, username: str) -> bool:
    """Detect duplicate requests within 100ms (exploit attempt)."""
    if not DETECT_DUPLICATE_REQUESTS:
        return False
    
    now = datetime.now(timezone.utc)
    key = f"{user_id}_{path}_{params_hash}"
    
    # Check if same request was made in last 100ms
    if key in user_action_counts and user_action_counts[key]:
        last_request = user_action_counts[key][-1]
        if (now - last_request).total_seconds() < 0.1:
            await flag_user_suspicious(
                db, user_id, username,
                "duplicate_request",
                f"Duplicate request within 100ms: {path}",
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


# Background task to flush alerts periodically
async def security_monitor_task(db):
    """Background task that flushes Telegram alerts every 30 seconds."""
    while True:
        try:
            await asyncio.sleep(30)
            await flush_telegram_alerts()
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
GLOBAL_RATE_LIMITS_ENABLED = True

# Rate limit configuration: endpoint_pattern -> (min_interval_seconds, enabled)
# Limit is "minimum seconds between clicks" - e.g. 1.0 = max 1 click/sec, 0.5 = max 2 clicks/sec
RATE_LIMIT_CONFIG = {
    # Format: "endpoint_pattern": (min_interval_sec, enabled)
    # NOTE: Paths must include /api/ prefix to match actual request paths
    
    # Money & economy (protect against rapid exploits)
    "/api/bank/transfer": (6.0, True),
    "/api/bank/interest/deposit": (3.0, True),
    "/api/bank/interest/claim": (3.0, True),
    "/api/bank/swiss/deposit": (2.0, True),
    "/api/bank/swiss/withdraw": (2.0, True),
    
    # Attack system
    "/api/attack/": (1.5, True),
    
    # Crimes (prevent rapid commit spam)
    "/api/crimes/": (1.5, True),
    
    # Hitlist (prevent spam)
    "/api/hitlist/add": (4.0, True),
    "/api/hitlist/buy-off": (3.0, True),
    
    # Store purchases (prevent rapid buying exploits)
    "/api/store/": (2.0, True),
    "/api/weapons/": (1.5, True),
    "/api/armour/": (1.5, True),
    
    # Properties & racket (moderate)
    "/api/properties/": (1.5, False),
    "/api/racket/": (1.5, False),
    
    # Bodyguards (prevent spam invites)
    "/api/bodyguards/": (2.0, True),
    
    # Casino/gambling (prevent rapid betting exploits)
    "/api/casino/dice/": (1.2, True),
    "/api/casino/roulette/": (1.2, True),
    "/api/casino/blackjack/": (1.2, True),
    "/api/casino/horseracing/": (1.2, True),
    "/api/sports-betting/": (1.2, True),
    
    # Travel & Booze Run
    "/api/travel": (3.0, True),
    "/api/booze-run/": (2.0, True),
    
    # Families (raid: 2 per enemy family per 3h enforced in endpoint; min 3s between requests)
    "/api/families/attack-racket": (3.0, True),
    "/api/families/": (1.5, False),
    
    # Notifications (prevent spam)
    "/api/notifications/send": (3.0, True),
    
    # Admin endpoints (no rate limit - admins need full access)
    "/api/admin/": (0.0, False),
    
    # Auth & profile (light limits)
    "/api/auth/login": (3.0, True),
    "/api/auth/register": (6.0, True),
    "/api/auth/me": (0.5, False),  # Frequent polling is OK
    
    # Meta & read-only (light or disabled)
    "/api/meta/": (0.5, False),
    "/api/users/": (0.75, False),
    "/api/leaderboard/": (1.0, False),
}

# Per-endpoint last request time: key -> user_id -> datetime (for min-interval-between-clicks)
endpoint_user_last_request = defaultdict(dict)


def get_rate_limit_for_path(path: str) -> tuple[float, bool, str]:
    """Get (min_interval_seconds, enabled, storage_key) for a given path. Storage key is the pattern so e.g. all /api/crimes/* share one limit."""
    for pattern, (interval, enabled) in RATE_LIMIT_CONFIG.items():
        if pattern.endswith("/"):
            if path.startswith(pattern):
                return (interval, enabled, pattern)
        else:
            if path == pattern:
                return (interval, enabled, pattern)
    return (1.0, False, path)


async def check_endpoint_rate_limit(path: str, user_id: str, username: str, db) -> bool:
    """
    Check if user is clicking too fast (min interval between clicks).
    Returns True if request should be blocked (clicked too soon).
    """
    if not GLOBAL_RATE_LIMITS_ENABLED:
        return False
    
    min_interval_sec, enabled, key = get_rate_limit_for_path(path)
    
    if not enabled or min_interval_sec <= 0:
        return False
    
    now = datetime.now(timezone.utc)
    last = endpoint_user_last_request.get(key, {}).get(user_id)
    
    if last is not None:
        elapsed = (now - last).total_seconds()
        if elapsed < min_interval_sec:
            await flag_user_suspicious(
                db, user_id, username,
                "endpoint_rate_limit",
                f"Too many clicks on {path}: need {min_interval_sec}s between requests (got {elapsed:.2f}s)",
                {"path": path, "min_interval_sec": min_interval_sec, "elapsed_sec": round(elapsed, 2)}
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
    
    flags = await db.security_flags.find(query).sort("created_at", -1).limit(limit).to_list(limit)
    
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
        "rate_limit_config": {path: {"min_interval_sec": interval, "enabled": enabled} for path, (interval, enabled) in RATE_LIMIT_CONFIG.items()}
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
