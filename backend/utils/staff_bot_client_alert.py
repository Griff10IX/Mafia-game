"""Staff inbox alerts when bot/script clients are blocked or bot-like UAs attack.

Uses lazy imports of server.* inside async functions to avoid circular imports with middleware.

Env:
  BOT_BLOCK_ALERT_RECIPIENTS=staff|admins  — "staff" (default) = admins + moderators; "admins" = ADMIN_EMAILS only.
  BOT_BLOCK_STAFF_INBOX_COOLDOWN_SEC — min seconds between inbox alerts for the same user/IP + source (default 14400 = 4h).
    Every block is still written to bot_client_block_events; only the inbox ping is throttled.
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

BOT_CLIENT_BLOCK_COLLECTION = "bot_client_block_events"
_BOT_BLOCK_RETENTION_DAYS = 90

def _staff_inbox_cooldown_sec() -> float:
    raw = (os.environ.get("BOT_BLOCK_STAFF_INBOX_COOLDOWN_SEC") or "").strip()
    if raw:
        try:
            v = float(raw)
            if v >= 60.0:
                return min(v, 86400.0 * 7)
        except ValueError:
            pass
    return 14400.0  # 4h default — one inbox ping per actor per guard source; avoids spam across many endpoints


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


async def record_bot_client_block_event(
    *,
    db,
    user_id: Optional[str],
    username: str,
    ip: str,
    path: str,
    method: str,
    internal_reason: str,
    source: str,
    user_agent_short: str,
) -> Optional[str]:
    """Persist a script/bot client block for admin investigation (TTL via expires_at). Returns event id."""
    try:
        now = datetime.now(timezone.utc)
        expires = now + timedelta(days=_BOT_BLOCK_RETENTION_DAYS)
        eid = uuid.uuid4().hex
        doc = {
            "id": eid,
            "user_id": user_id or None,
            "username": (username or "")[:64],
            "ip": (ip or "")[:64],
            "path": (path or "")[:256],
            "method": (method or "")[:16],
            "reason": (internal_reason or "")[:256],
            "source": (source or "")[:64],
            "user_agent_short": (user_agent_short or "")[:300],
            "created_at": now.isoformat(),
            "expires_at": expires,
        }
        await db[BOT_CLIENT_BLOCK_COLLECTION].insert_one(doc)
        return eid
    except Exception:
        logger.exception("record_bot_client_block_event failed")
        return None


def _header_first(request, *names: str) -> str:
    h = request.headers
    for n in names:
        v = h.get(n) or h.get(n.lower())
        if v:
            return str(v).strip()
    return ""


def _request_intel_lines(request) -> List[str]:
    """Non-secret request metadata for staff inbox (helps distinguish browser vs script)."""
    lines: List[str] = []
    lines.append(f"Time (UTC): {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}")
    referer = _header_first(request, "referer", "Referer")
    if referer:
        lines.append(f"Referer: {referer[:450]}{'…' if len(referer) > 450 else ''}")
    origin = _header_first(request, "origin", "Origin")
    if origin:
        lines.append(f"Origin: {origin[:320]}")
    xf = _header_first(request, "x-forwarded-for", "X-Forwarded-For")
    if xf:
        lines.append(f"X-Forwarded-For (full): {xf[:400]}")
    for label, keys in (
        ("CF-Connecting-IP", ("cf-connecting-ip", "CF-Connecting-IP")),
        ("CF-IPCountry", ("cf-ipcountry", "CF-IPCountry")),
        ("CF-Ray", ("cf-ray", "CF-Ray")),
    ):
        v = _header_first(request, *keys)
        if v:
            lines.append(f"{label}: {v[:200]}")
    for sec in ("sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user"):
        v = _header_first(request, sec, sec.title())
        if v:
            lines.append(f"{sec}: {v}")
    lang = _header_first(request, "accept-language", "Accept-Language")
    if lang:
        lines.append(f"Accept-Language: {lang[:160]}")
    accept = _header_first(request, "accept", "Accept")
    if accept:
        lines.append(f"Accept: {accept[:200]}{'…' if len(accept) > 200 else ''}")
    return lines


async def _account_intel_lines(db, user_id: Optional[str]) -> List[str]:
    """Account context for identified sessions (staff inbox)."""
    if not user_id:
        return []
    try:
        u = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "email": 1, "created_at": 1, "last_seen": 1, "is_moderator": 1, "is_help_desk_operator": 1},
        )
        if not u:
            return ["Account: no user row for token sub (revoked user?)"]
        out: List[str] = []
        em = (u.get("email") or "").strip() or "—"
        out.append(f"Account email: {em}")
        if u.get("created_at"):
            out.append(f"Account created: {u.get('created_at')}")
        if u.get("last_seen"):
            out.append(f"Last seen: {u.get('last_seen')}")
        roles = []
        if u.get("is_moderator"):
            roles.append("moderator")
        if u.get("is_help_desk_operator"):
            roles.append("HDO")
        if roles:
            out.append(f"Staff roles on account: {', '.join(roles)}")
        return out
    except Exception:
        logger.exception("_account_intel_lines failed")
        return []


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

    event_id = await record_bot_client_block_event(
        db=db,
        user_id=user_id,
        username=username,
        ip=ip,
        path=path,
        method=method,
        internal_reason=internal_reason,
        source=source,
        user_agent_short=ua_short,
    )

    # Inbox dedup: one notification per (guard source × user id or IP) per cooldown window.
    # Path/reason omitted so rapid hits across /crimes/*, /gta, etc. do not flood staff (Mongo logs all rows).
    ident = user_id or f"ip:{ip or 'unknown'}"
    inbox_key = f"inbox|{source}|{ident}"
    cooldown = _staff_inbox_cooldown_sec()
    if _last_blocked.get(inbox_key, 0) + cooldown > now:
        return
    _last_blocked[inbox_key] = now
    _prune(_last_blocked)

    if user_id:
        user_line = f"User: {user_id} ({username or 'username unknown'})"
    else:
        user_line = "User: not identified (no valid session in Authorization)"

    lines = [
        "— Bot / script client blocked (gameplay or minigame guard) —",
        "Inbox alerts are throttled so staff are not spammed; every block is still stored in Mongo (collection bot_client_block_events).",
        f"Source: {source.replace('_', ' ')}",
        f"Block reason (internal): {internal_reason}",
        f"HTTP: {method} {path}",
        user_line,
        f"Client IP (normalized): {ip or '—'}",
        f"User-Agent: {ua_short or '—'}",
    ]
    if event_id:
        lines.append(f"Persisted event id (Mongo bot_client_block_events): {event_id}")
    lines.append("— Request metadata —")
    lines.extend(_request_intel_lines(request))
    acc = await _account_intel_lines(db, user_id)
    if acc:
        lines.append("— Account —")
        lines.extend(acc)
    cn = (context_note or "").strip()
    if cn:
        lines.append("— Note —")
        lines.append(cn)

    # Parallel to auth_login's "Login attempt (identifier): Moss" — who is attempting to bot (from session).
    if source == "auth_gameplay":
        lines.append("— Session —")
        if username:
            lines.append(f"Gameplay attempt (username): {username}")
        elif user_id:
            lines.append(f"Gameplay attempt (username): unknown (user id {user_id})")
        else:
            lines.append("Gameplay attempt (username): not identified (no Bearer token in Authorization)")
    elif source == "auth_minigames":
        lines.append("— Session —")
        if username:
            lines.append(f"Minigame attempt (username): {username}")
        elif user_id:
            lines.append(f"Minigame attempt (username): unknown (user id {user_id})")
        else:
            lines.append("Minigame attempt (username): not identified (no Bearer token in Authorization)")

    try:
        from server import _get_admin_user_ids, _get_staff_user_ids, send_notification

        mode = (os.environ.get("BOT_BLOCK_ALERT_RECIPIENTS") or "staff").strip().lower()
        if mode == "admins":
            recipient_ids = await _get_admin_user_ids()
            if not recipient_ids:
                recipient_ids = await _get_staff_user_ids()
        else:
            recipient_ids = await _get_staff_user_ids()

        title = "Security: bot / script client blocked"
        msg = "\n".join(lines)
        extra = {"staff_alert_kind": "bot_client_block"}
        if event_id:
            extra["staff_alert_event_id"] = event_id
        for uid in recipient_ids:
            try:
                await send_notification(uid, title, msg, "staff_bot_client", **extra)
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


_last_execute_token_alert: dict[str, float] = {}
_EXECUTE_TOKEN_ALERT_TTL_SEC = 3600.0


async def maybe_notify_staff_attack_execute_token_fail(
    *,
    db,
    request,
    attacker_id: str,
    attacker_username: str,
    target_id: str,
    target_username: str,
    attack_id: str,
    location_state: Optional[str] = None,
    client_risk_score: Optional[int] = None,
    attacker_client_signal: Optional[str] = None,
    client_anomaly_flags: Optional[List[str]] = None,
) -> None:
    """Staff inbox when execute fails anti-bot session token (throttled per attacker)."""
    now = time.monotonic()
    aid = (attacker_id or "").strip()
    if not aid:
        return
    key = f"atktok|{aid}"
    if _last_execute_token_alert.get(key, 0) + _EXECUTE_TOKEN_ALERT_TTL_SEC > now:
        return
    _last_execute_token_alert[key] = now
    _prune(_last_execute_token_alert)

    ip = client_ip_from_request(request)
    ua = (request.headers.get("user-agent") or "").strip()
    ua_short = (ua[:200] + "…") if len(ua) > 200 else ua
    loc = f" · location {location_state}" if location_state else ""
    lines = [
        "— Attack execute: invalid / missing session token (anti-bot) —",
        "The client POSTed /attack/execute without a valid execute_token (or with a stale one).",
        "Legitimate players should refresh My Searches; scripts often skip that step.",
        f"Attacker: {attacker_username} (id {aid})",
        f"Target: {target_username} (id {target_id or '?'}){loc}",
        f"Attack row id: {attack_id}",
        f"IP: {ip or '—'}",
        f"User-Agent: {ua_short or '—'}",
    ]
    if client_risk_score is not None:
        lines.append(f"Client risk score (soft): {int(client_risk_score)}")
    if attacker_client_signal:
        lines.append(f"Client signal: {attacker_client_signal}")
    if isinstance(client_anomaly_flags, list) and client_anomaly_flags:
        lines.append(f"Anomaly flags: {', '.join(str(x) for x in client_anomaly_flags[:20])}")
    lines.append("— Request metadata —")
    lines.extend(_request_intel_lines(request))
    acc = await _account_intel_lines(db, aid)
    if acc:
        lines.append("— Account —")
        lines.extend(acc)

    try:
        from server import _get_admin_user_ids, _get_staff_user_ids, send_notification

        mode = (os.environ.get("BOT_BLOCK_ALERT_RECIPIENTS") or "staff").strip().lower()
        if mode == "admins":
            recipient_ids = await _get_admin_user_ids()
            if not recipient_ids:
                recipient_ids = await _get_staff_user_ids()
        else:
            recipient_ids = await _get_staff_user_ids()

        title = "Security: attack session token failed (possible bot)"
        msg = "\n".join(lines)
        extra = {"staff_alert_kind": "attack_execute_token_fail"}
        for uid in recipient_ids:
            try:
                await send_notification(uid, title, msg, "staff_bot_client", **extra)
            except Exception as e:
                logger.warning("staff execute-token notify %s: %s", uid, e)
    except Exception:
        logger.exception("maybe_notify_staff_attack_execute_token_fail failed")
