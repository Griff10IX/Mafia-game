"""Staff inbox alerts when bot/script clients are blocked or bot-like UAs attack.

Uses lazy imports of server.* inside async functions to avoid circular imports with middleware.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_ALERT_TTL_BLOCKED_SEC = 900.0
_ALERT_TTL_ATTACK_BOT_SEC = 3600.0
_last_blocked: dict[str, float] = {}
_last_attack_bot: dict[str, float] = {}
_MAX_TRACK = 3000


def _prune(d: dict) -> None:
    if len(d) > _MAX_TRACK:
        d.clear()


def client_ip_from_request(request) -> str:
    from utils.ip_normalize import normalize_ip_string

    h = request.headers
    for key in ("cf-connecting-ip", "CF-Connecting-IP"):
        raw = h.get(key)
        if raw:
            ip = normalize_ip_string(raw)
            if ip:
                return ip
    xf = h.get("x-forwarded-for") or h.get("X-Forwarded-For")
    if xf:
        ip = normalize_ip_string(xf.split(",")[0])
        if ip:
            return ip
    if request.client and request.client.host:
        return normalize_ip_string(request.client.host) or ""
    return ""


def decode_bearer_sub(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    auth = authorization.strip()
    if not auth.lower().startswith("bearer "):
        return None
    token = auth[7:].strip()
    if not token:
        return None
    try:
        from jose import jwt
        from server import ALGORITHM, SECRET_KEY

        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        return str(sub).strip() if sub else None
    except Exception:
        return None


async def maybe_notify_staff_bot_client_blocked(
    *,
    db,
    request,
    internal_reason: str,
    source: str,
    context_note: str = "",
) -> None:
    """Notify admins/mods (inbox) when a request is blocked for script-like client headers.

    Use source labels like auth_login, auth_minigames, auth_gameplay (underscores become spaces in the message).

    For auth_minigames / auth_gameplay, appends a line like login's "Login attempt (identifier): Moss":
    "Minigame attempt (username): …" / "Gameplay attempt (username): …" when Bearer resolves to a user.
    """
    now = time.monotonic()
    ip = client_ip_from_request(request)
    path = request.url.path
    method = request.method
    ua = (request.headers.get("user-agent") or "").strip()
    ua_short = (ua[:200] + "…") if len(ua) > 200 else ua

    user_id = decode_bearer_sub(request.headers.get("authorization"))
    username = ""
    if user_id:
        try:
            u = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
            if u:
                username = (u.get("username") or "").strip()[:48]
        except Exception:
            pass

    ident = user_id or f"ip:{ip or 'unknown'}"
    key = f"blk|{source}|{ident}|{internal_reason}"
    if _last_blocked.get(key, 0) + _ALERT_TTL_BLOCKED_SEC > now:
        return
    _last_blocked[key] = now
    _prune(_last_blocked)

    if user_id:
        user_line = f"User: {user_id} ({username or 'username unknown'})"
    else:
        user_line = "User: not identified (no valid session in Authorization)"

    lines = [
        f"Script/bot-style client blocked ({source.replace('_', ' ')}).",
        f"Reason: {internal_reason}",
        f"{method} {path}",
        user_line,
        f"IP: {ip or '—'}",
        f"User-Agent: {ua_short or '—'}",
    ]
    cn = (context_note or "").strip()
    if cn:
        lines.append(cn)

    # Parallel to auth_login's "Login attempt (identifier): Moss" — who is attempting to bot (from session).
    if source == "auth_gameplay":
        if username:
            lines.append(f"Gameplay attempt (username): {username}")
        elif user_id:
            lines.append(f"Gameplay attempt (username): unknown (user id {user_id})")
        else:
            lines.append("Gameplay attempt (username): not identified (no Bearer token in Authorization)")
    elif source == "auth_minigames":
        if username:
            lines.append(f"Minigame attempt (username): {username}")
        elif user_id:
            lines.append(f"Minigame attempt (username): unknown (user id {user_id})")
        else:
            lines.append("Minigame attempt (username): not identified (no Bearer token in Authorization)")

    try:
        from server import _get_staff_user_ids, send_notification

        staff_ids = await _get_staff_user_ids()
        title = "Bot / script client blocked"
        msg = "\n".join(lines)
        for uid in staff_ids:
            try:
                await send_notification(uid, title, msg, "staff_bot_client")
            except Exception as e:
                logger.warning("staff bot block notify %s: %s", uid, e)
    except Exception:
        logger.exception("maybe_notify_staff_bot_client_blocked failed")


async def maybe_notify_staff_bot_attack_from_ua(
    *,
    attacker_id: str,
    attacker_username: str,
    target_id: str,
    target_username: str,
    outcome: str,
    location_state: Optional[str],
    player_message: str,
    meta: Dict[str, Any],
) -> None:
    """Notify staff when an attack is performed with a bot-like User-Agent (throttled per attacker)."""
    now = time.monotonic()
    aid = (attacker_id or "").strip()
    if not aid:
        return
    key = f"atkbot|{aid}"
    if _last_attack_bot.get(key, 0) + _ALERT_TTL_ATTACK_BOT > now:
        return
    _last_attack_bot[key] = now
    _prune(_last_attack_bot)

    loc = f" in {location_state}" if location_state else ""
    bot_label = (meta.get("attacker_bot_label") or "").strip()
    ip = (meta.get("client_ip") or "").strip()
    ua = (meta.get("user_agent") or "").strip()
    ua_short = (ua[:200] + "…") if len(ua) > 200 else ua
    lines = [
        f"Attack with bot-like User-Agent (outcome: {outcome}).",
        f"Attacker: {attacker_username} (id {aid})",
        f"Target: {target_username} (id {target_id}){loc}",
    ]
    if bot_label:
        lines.append(f"Bot type: {bot_label}")
    if ip:
        lines.append(f"IP: {ip}")
    if ua_short:
        lines.append(f"User-Agent: {ua_short}")
    lines.append(f"Summary: {(player_message or '')[:220]}")

    try:
        from server import _get_staff_user_ids, send_notification

        staff_ids = await _get_staff_user_ids()
        title = "Bot User-Agent on attack"
        msg = "\n".join(lines)
        for uid in staff_ids:
            try:
                await send_notification(uid, title, msg, "staff_bot_client")
            except Exception as e:
                logger.warning("staff bot attack notify %s: %s", uid, e)
    except Exception:
        logger.exception("maybe_notify_staff_bot_attack_from_ua failed")
