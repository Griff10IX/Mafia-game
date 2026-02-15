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

# Telegram notification queue (async batch sending)
pending_alerts = []


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


# ====== CONFIGURABLE RATE LIMITING PER ENDPOINT ======

# Rate limit configuration: endpoint_pattern -> (requests_per_minute, enabled)
# You can enable/disable rate limiting per endpoint here
RATE_LIMIT_CONFIG = {
    # Format: "endpoint_pattern": (max_requests_per_minute, enabled)
    # NOTE: Paths must include /api/ prefix to match actual request paths
    
    # Money & economy (protect against rapid exploits)
    "/api/bank/transfer": (10, True),
    "/api/bank/interest/deposit": (20, True),
    "/api/bank/interest/claim": (20, True),
    "/api/bank/swiss/deposit": (30, True),
    "/api/bank/swiss/withdraw": (30, True),
    
    # Attack system
    "/api/attack/": (40, True),
    
    # Hitlist (prevent spam)
    "/api/hitlist/add": (15, True),
    "/api/hitlist/buy-off": (20, True),
    
    # Store purchases (prevent rapid buying exploits)
    "/api/store/": (30, True),
    "/api/weapons/": (40, True),
    "/api/armour/": (40, True),
    
    # Properties & racket (moderate)
    "/api/properties/": (40, False),  # Disabled by default
    "/api/racket/": (40, False),      # Disabled by default
    
    # Bodyguards (prevent spam invites)
    "/api/bodyguards/": (30, True),
    
    # Casino/gambling (prevent rapid betting exploits)
    "/api/casino/dice/": (50, True),
    "/api/casino/roulette/": (50, True),
    "/api/casino/blackjack/": (50, True),
    "/api/casino/horseracing/": (50, True),
    "/api/sports-betting/": (50, True),
    
    # Travel & Booze Run
    "/api/travel": (20, True),
    "/api/booze-run/": (30, True),
    
    # Families
    "/api/families/": (40, False),  # Disabled by default
    
    # Notifications (prevent spam)
    "/api/notifications/send": (20, True),
    
    # Admin endpoints (no rate limit - admins need full access)
    "/api/admin/": (1000, False),
    
    # Auth & profile (light limits)
    "/api/auth/login": (20, True),
    "/api/auth/register": (10, True),
    "/api/auth/me": (120, False),  # Frequent polling is OK
    
    # Meta & read-only (light or disabled)
    "/api/meta/": (120, False),
    "/api/users/": (80, False),
    "/api/leaderboard/": (60, False),
}

# Per-endpoint rate tracking: {endpoint: {user_id: [timestamps]}}
endpoint_user_requests = defaultdict(lambda: defaultdict(list))


def get_rate_limit_for_path(path: str) -> tuple[int, bool]:
    """Get (max_requests_per_minute, enabled) for a given path."""
    # Check exact matches first, then prefixes
    for pattern, (limit, enabled) in RATE_LIMIT_CONFIG.items():
        if pattern.endswith("/"):
            # Prefix match
            if path.startswith(pattern):
                return (limit, enabled)
        else:
            # Exact match
            if path == pattern:
                return (limit, enabled)
    
    # Default: 60 requests per minute, disabled
    return (60, False)


async def check_endpoint_rate_limit(path: str, user_id: str, username: str, db) -> bool:
    """
    Check if user exceeded rate limit for specific endpoint.
    Returns True if limit exceeded and user should be blocked.
    """
    max_rpm, enabled = get_rate_limit_for_path(path)
    
    if not enabled:
        return False  # Rate limiting disabled for this endpoint
    
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=1)
    
    # Clean old timestamps for this endpoint/user combo
    key = f"{path}"
    endpoint_user_requests[key][user_id] = [
        ts for ts in endpoint_user_requests[key][user_id] if ts > cutoff
    ]
    endpoint_user_requests[key][user_id].append(now)
    
    count = len(endpoint_user_requests[key][user_id])
    
    if count > max_rpm:
        await flag_user_suspicious(
            db, user_id, username,
            "endpoint_rate_limit",
            f"Rate limit exceeded on {path}: {count}/{max_rpm} per minute",
            {"path": path, "count": count, "limit": max_rpm}
        )
        return True
    
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
        "rate_limit_config": {path: {"limit": limit, "enabled": enabled} for path, (limit, enabled) in RATE_LIMIT_CONFIG.items()}
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
