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
    internal_reason: str,
    source: str,
    ip: str = "",
    path: str = "",
    method: str = "",
    user_agent_short: str = "",
    request=None,
    extra: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Persist a script/bot client block for admin investigation (TTL via expires_at). Returns event id.

    Pass either explicit ip/path/method/user_agent_short, or a `request` to derive them.
    """
    try:
        if request is not None:
            if not ip:
                ip = client_ip_from_request(request)
            if not path:
                path = getattr(getattr(request, "url", None), "path", "") or ""
            if not method:
                method = getattr(request, "method", "") or ""
            if not user_agent_short:
                ua = (request.headers.get("user-agent") or "").strip()
                user_agent_short = (ua[:200] + "…") if len(ua) > 200 else ua
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
        if isinstance(extra, dict) and extra:
            doc["extra"] = {str(k)[:64]: str(v)[:256] for k, v in extra.items()}
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
_last_execute_token_telegram_alert: dict[str, float] = {}
_last_bodyguard_hire_code_alert: dict[str, float] = {}
_last_bodyguard_hire_code_telegram_alert: dict[str, float] = {}
_last_travel_code_alert: dict[str, float] = {}
_last_travel_code_telegram_alert: dict[str, float] = {}
_last_attack_search_code_alert: dict[str, float] = {}
_last_attack_search_code_telegram_alert: dict[str, float] = {}
_EXECUTE_TOKEN_ALERT_TTL_SEC = 3600.0


def _execute_token_telegram_cooldown_sec() -> float:
    raw = (os.environ.get("ATTACK_TOKEN_FAIL_TELEGRAM_COOLDOWN_SEC") or "").strip()
    if raw:
        try:
            v = float(raw)
            if v >= 0:
                return min(v, 86400.0)
        except ValueError:
            pass
    return 300.0


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
    inbox_should_send = _last_execute_token_alert.get(key, 0) + _EXECUTE_TOKEN_ALERT_TTL_SEC <= now
    if inbox_should_send:
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
        from middleware.security import flush_telegram_alerts, send_telegram_alert

        tg_cooldown = _execute_token_telegram_cooldown_sec()
        tg_key = f"tgatktok|{aid}"
        if _last_execute_token_telegram_alert.get(tg_key, 0) + tg_cooldown <= now:
            _last_execute_token_telegram_alert[tg_key] = now
            _prune(_last_execute_token_telegram_alert)
            await send_telegram_alert(
                "\n".join([
                    "Attack execute token/code failed",
                    f"Attacker: {attacker_username} (id {aid})",
                    f"Target: {target_username} (id {target_id or '?'})",
                    f"Attack row id: {attack_id}",
                    f"Location: {location_state or '—'}",
                    f"IP: {ip or '—'}",
                    f"UA: {ua_short or '—'}",
                    f"Signal: {attacker_client_signal or '—'}",
                    "Stored in attack logs / attack_attempts for review.",
                ]),
                "warning",
                use_markdown=False,
            )
            await flush_telegram_alerts()
    except Exception:
        logger.exception("execute token fail telegram alert failed")

    if not inbox_should_send:
        return

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


async def maybe_notify_staff_bodyguard_hire_code_fail(
    *,
    db,
    request,
    user_id: str,
    username: str,
    slot: int,
    is_robot: bool,
) -> None:
    """Staff inbox + Telegram when robot bodyguard hire POST fails the rotating hidden code."""
    now = time.monotonic()
    uid = (user_id or "").strip()
    if not uid:
        return

    ip = client_ip_from_request(request)
    ua = (request.headers.get("user-agent") or "").strip()
    ua_short = (ua[:200] + "…") if len(ua) > 200 else ua
    event_id = await record_bot_client_block_event(
        db=db,
        user_id=uid,
        username=username,
        source="bodyguard_hire_code_fail",
        internal_reason="invalid_or_missing_bodyguard_hire_code",
        request=request,
        extra={
            "slot": slot,
            "is_robot": bool(is_robot),
            "path": str(getattr(request, "url", "")),
        },
    )

    lines = [
        "— Bodyguard hire: invalid / missing hidden code (anti-bot) —",
        "The client POSTed /bodyguards/hire without the current rotating hire code.",
        "Legitimate clients receive this code from GET /bodyguards; scripts often skip that step.",
        f"User: {username or '?'} (id {uid})",
        f"Slot requested: {slot}",
        f"Robot bodyguard: {'yes' if is_robot else 'no'}",
        f"IP: {ip or '—'}",
        f"User-Agent: {ua_short or '—'}",
    ]
    if event_id:
        lines.append(f"Persisted event id (Mongo bot_client_block_events): {event_id}")
    lines.append("— Request metadata —")
    lines.extend(_request_intel_lines(request))
    acc = await _account_intel_lines(db, uid)
    if acc:
        lines.append("— Account —")
        lines.extend(acc)

    try:
        from middleware.security import flush_telegram_alerts, send_telegram_alert

        tg_cooldown = _execute_token_telegram_cooldown_sec()
        tg_key = f"tgbghire|{uid}"
        if _last_bodyguard_hire_code_telegram_alert.get(tg_key, 0) + tg_cooldown <= now:
            _last_bodyguard_hire_code_telegram_alert[tg_key] = now
            _prune(_last_bodyguard_hire_code_telegram_alert)
            await send_telegram_alert(
                "\n".join([
                    "Bodyguard hire hidden code failed",
                    f"User: {username or '?'} (id {uid})",
                    f"Slot: {slot}",
                    f"Robot: {'yes' if is_robot else 'no'}",
                    f"IP: {ip or '—'}",
                    f"UA: {ua_short or '—'}",
                    f"Stored event id: {event_id or '—'}",
                ]),
                "warning",
                use_markdown=False,
            )
            await flush_telegram_alerts()
    except Exception:
        logger.exception("bodyguard hire code fail telegram alert failed")

    key = f"bghire|{uid}"
    if _last_bodyguard_hire_code_alert.get(key, 0) + _EXECUTE_TOKEN_ALERT_TTL_SEC > now:
        return
    _last_bodyguard_hire_code_alert[key] = now
    _prune(_last_bodyguard_hire_code_alert)

    try:
        from server import _get_admin_user_ids, _get_staff_user_ids, send_notification

        mode = (os.environ.get("BOT_BLOCK_ALERT_RECIPIENTS") or "staff").strip().lower()
        if mode == "admins":
            recipient_ids = await _get_admin_user_ids()
            if not recipient_ids:
                recipient_ids = await _get_staff_user_ids()
        else:
            recipient_ids = await _get_staff_user_ids()

        title = "Security: bodyguard hire hidden code failed"
        msg = "\n".join(lines)
        extra = {"staff_alert_kind": "bodyguard_hire_code_fail"}
        if event_id:
            extra["staff_alert_event_id"] = event_id
        for rid in recipient_ids:
            try:
                await send_notification(rid, title, msg, "staff_bot_client", **extra)
            except Exception as e:
                logger.warning("staff bodyguard-hire-code notify %s: %s", rid, e)
    except Exception:
        logger.exception("maybe_notify_staff_bodyguard_hire_code_fail failed")


_last_ent_join_alert: dict[str, float] = {}
_last_ent_join_telegram_alert: dict[str, float] = {}


async def maybe_notify_staff_ent_join_token_fail(
    *,
    db,
    request,
    user_id: str,
    username: str,
    game_id: str,
    reason: str,
    context_label: str = "E-Game",
    endpoint_desc: str = "/forum/entertainer/games/{id}/join",
    source: str = "ent_join_token_fail",
) -> None:
    """Staff inbox + Telegram when a game join fails the anti-bot join token.
    Used for entertainer E-Game joins and (via context_label/source) MDG house-game joins.

    reason: missing | invalid | expired | too_fresh
    """
    now = time.monotonic()
    uid = (user_id or "").strip()
    if not uid:
        return

    ip = client_ip_from_request(request)
    ua = (request.headers.get("user-agent") or "").strip()
    ua_short = (ua[:200] + "…") if len(ua) > 200 else ua
    event_id = await record_bot_client_block_event(
        db=db,
        user_id=uid,
        username=username,
        source=source,
        internal_reason=f"{source}_{reason}",
        request=request,
        extra={
            "game_id": game_id,
            "reason": reason,
            "path": str(getattr(request, "url", "")),
        },
    )

    lines = [
        f"— {context_label} join: invalid / missing join token (anti-bot) —",
        f"The client POSTed {endpoint_desc} without a valid join_token "
        f"(failure: {reason}).",
        "Legitimate clients receive this token from the games list and need a human-speed delay before joining; "
        "scripts that fetch-then-join instantly fail.",
        f"User: {username or '?'} (id {uid})",
        f"Game id: {game_id or '?'}",
        f"IP: {ip or '—'}",
        f"User-Agent: {ua_short or '—'}",
    ]
    if event_id:
        lines.append(f"Persisted event id (Mongo bot_client_block_events): {event_id}")
    lines.append("— Request metadata —")
    lines.extend(_request_intel_lines(request))
    acc = await _account_intel_lines(db, uid)
    if acc:
        lines.append("— Account —")
        lines.extend(acc)

    try:
        from middleware.security import flush_telegram_alerts, send_telegram_alert

        tg_cooldown = _execute_token_telegram_cooldown_sec()
        tg_key = f"tgentjoin|{source}|{uid}"
        if _last_ent_join_telegram_alert.get(tg_key, 0) + tg_cooldown <= now:
            _last_ent_join_telegram_alert[tg_key] = now
            _prune(_last_ent_join_telegram_alert)
            await send_telegram_alert(
                "\n".join([
                    f"{context_label} join token failed (possible bot)",
                    f"User: {username or '?'} (id {uid})",
                    f"Game: {game_id or '?'}",
                    f"Failure: {reason}",
                    f"IP: {ip or '—'}",
                    f"UA: {ua_short or '—'}",
                    f"Stored event id: {event_id or '—'}",
                ]),
                "warning",
                use_markdown=False,
            )
            await flush_telegram_alerts()
    except Exception:
        logger.exception("join token fail telegram alert failed")

    key = f"entjoin|{source}|{uid}"
    if _last_ent_join_alert.get(key, 0) + _EXECUTE_TOKEN_ALERT_TTL_SEC > now:
        return
    _last_ent_join_alert[key] = now
    _prune(_last_ent_join_alert)

    try:
        from server import _get_admin_user_ids, _get_staff_user_ids, send_notification

        mode = (os.environ.get("BOT_BLOCK_ALERT_RECIPIENTS") or "staff").strip().lower()
        if mode == "admins":
            recipient_ids = await _get_admin_user_ids()
            if not recipient_ids:
                recipient_ids = await _get_staff_user_ids()
        else:
            recipient_ids = await _get_staff_user_ids()

        title = f"Security: {context_label} join token failed (possible bot)"
        msg = "\n".join(lines)
        extra = {"staff_alert_kind": source}
        if event_id:
            extra["staff_alert_event_id"] = event_id
        for rid in recipient_ids:
            try:
                await send_notification(rid, title, msg, "staff_bot_client", **extra)
            except Exception as e:
                logger.warning("staff join-token notify %s: %s", rid, e)
    except Exception:
        logger.exception("maybe_notify_staff_ent_join_token_fail failed")


async def maybe_notify_staff_travel_code_fail(
    *,
    db,
    request,
    user_id: str,
    username: str,
    destination: str,
    travel_method: str,
    airport_slot: Optional[int] = None,
    source: str = "travel",
) -> None:
    """Staff inbox + Telegram when car/airport travel POST fails the rotating hidden code."""
    now = time.monotonic()
    uid = (user_id or "").strip()
    if not uid:
        return

    ip = client_ip_from_request(request)
    ua = (request.headers.get("user-agent") or "").strip()
    ua_short = (ua[:200] + "…") if len(ua) > 200 else ua
    event_id = await record_bot_client_block_event(
        db=db,
        user_id=uid,
        username=username,
        source="travel_code_fail",
        internal_reason="invalid_or_missing_travel_code",
        request=request,
        extra={
            "destination": destination,
            "travel_method": travel_method,
            "airport_slot": airport_slot,
            "path": str(getattr(request, "url", "")),
            "source": source,
        },
    )

    lines = [
        "— Travel: invalid / missing hidden code (anti-bot) —",
        "The client POSTed travel without the current rotating travel code.",
        "Legitimate clients receive this code from GET /travel/info; scripts often skip that step.",
        f"User: {username or '?'} (id {uid})",
        f"Destination: {destination or '—'}",
        f"Method: {travel_method or '—'}",
        f"Airport slot: {airport_slot if airport_slot is not None else '—'}",
        f"IP: {ip or '—'}",
        f"User-Agent: {ua_short or '—'}",
    ]
    if event_id:
        lines.append(f"Persisted event id (Mongo bot_client_block_events): {event_id}")
    lines.append("— Request metadata —")
    lines.extend(_request_intel_lines(request))
    acc = await _account_intel_lines(db, uid)
    if acc:
        lines.append("— Account —")
        lines.extend(acc)

    try:
        from middleware.security import flush_telegram_alerts, send_telegram_alert

        tg_cooldown = _execute_token_telegram_cooldown_sec()
        tg_key = f"tgtravel|{uid}"
        if _last_travel_code_telegram_alert.get(tg_key, 0) + tg_cooldown <= now:
            _last_travel_code_telegram_alert[tg_key] = now
            _prune(_last_travel_code_telegram_alert)
            await send_telegram_alert(
                "\n".join([
                    "Travel hidden code failed",
                    f"User: {username or '?'} (id {uid})",
                    f"Destination: {destination or '—'}",
                    f"Method: {travel_method or '—'}",
                    f"IP: {ip or '—'}",
                    f"UA: {ua_short or '—'}",
                    f"Stored event id: {event_id or '—'}",
                ]),
                "warning",
                use_markdown=False,
            )
            await flush_telegram_alerts()
    except Exception:
        logger.exception("travel code fail telegram alert failed")

    key = f"travel|{uid}"
    if _last_travel_code_alert.get(key, 0) + _EXECUTE_TOKEN_ALERT_TTL_SEC > now:
        return
    _last_travel_code_alert[key] = now
    _prune(_last_travel_code_alert)

    try:
        from server import _get_admin_user_ids, _get_staff_user_ids, send_notification

        mode = (os.environ.get("BOT_BLOCK_ALERT_RECIPIENTS") or "staff").strip().lower()
        if mode == "admins":
            recipient_ids = await _get_admin_user_ids()
            if not recipient_ids:
                recipient_ids = await _get_staff_user_ids()
        else:
            recipient_ids = await _get_staff_user_ids()

        title = "Security: travel hidden code failed"
        msg = "\n".join(lines)
        extra = {"staff_alert_kind": "travel_code_fail"}
        if event_id:
            extra["staff_alert_event_id"] = event_id
        for rid in recipient_ids:
            try:
                await send_notification(rid, title, msg, "staff_bot_client", **extra)
            except Exception as e:
                logger.warning("staff travel-code notify %s: %s", rid, e)
    except Exception:
        logger.exception("maybe_notify_staff_travel_code_fail failed")


async def maybe_notify_staff_attack_search_code_fail(
    *,
    db,
    request,
    user_id: str,
    username: str,
    target_username: str = "",
) -> None:
    """Staff inbox + Telegram when POST /attack/search fails the rotating hidden search code."""
    now = time.monotonic()
    uid = (user_id or "").strip()
    if not uid:
        return

    ip = client_ip_from_request(request)
    ua = (request.headers.get("user-agent") or "").strip()
    ua_short = (ua[:200] + "…") if len(ua) > 200 else ua
    event_id = await record_bot_client_block_event(
        db=db,
        user_id=uid,
        username=username,
        source="attack_search_code_fail",
        internal_reason="invalid_or_missing_attack_search_code",
        request=request,
        extra={
            "target_username": (target_username or "")[:64],
            "path": str(getattr(request, "url", "")),
        },
    )

    lines = [
        "— Attack search: invalid / missing hidden code (anti-bot) —",
        "The client POSTed /attack/search without the current rotating search code.",
        "Legitimate clients receive this code from GET /attack/list; scripts often skip that step.",
        f"User: {username or '?'} (id {uid})",
        f"Target: {target_username or '—'}",
        f"IP: {ip or '—'}",
        f"User-Agent: {ua_short or '—'}",
    ]
    if event_id:
        lines.append(f"Persisted event id (Mongo bot_client_block_events): {event_id}")
    lines.append("— Request metadata —")
    lines.extend(_request_intel_lines(request))
    acc = await _account_intel_lines(db, uid)
    if acc:
        lines.append("— Account —")
        lines.extend(acc)

    try:
        from middleware.security import flush_telegram_alerts, send_telegram_alert

        tg_cooldown = _execute_token_telegram_cooldown_sec()
        tg_key = f"tgatksearch|{uid}"
        if _last_attack_search_code_telegram_alert.get(tg_key, 0) + tg_cooldown <= now:
            _last_attack_search_code_telegram_alert[tg_key] = now
            _prune(_last_attack_search_code_telegram_alert)
            await send_telegram_alert(
                "\n".join([
                    "Attack search hidden code failed",
                    f"User: {username or '?'} (id {uid})",
                    f"Target: {target_username or '—'}",
                    f"IP: {ip or '—'}",
                    f"UA: {ua_short or '—'}",
                    f"Stored event id: {event_id or '—'}",
                ]),
                "warning",
                use_markdown=False,
            )
            await flush_telegram_alerts()
    except Exception:
        logger.exception("attack search code fail telegram alert failed")

    key = f"atksearch|{uid}"
    if _last_attack_search_code_alert.get(key, 0) + _EXECUTE_TOKEN_ALERT_TTL_SEC > now:
        return
    _last_attack_search_code_alert[key] = now
    _prune(_last_attack_search_code_alert)

    try:
        from server import _get_admin_user_ids, _get_staff_user_ids, send_notification

        mode = (os.environ.get("BOT_BLOCK_ALERT_RECIPIENTS") or "staff").strip().lower()
        if mode == "admins":
            recipient_ids = await _get_admin_user_ids()
            if not recipient_ids:
                recipient_ids = await _get_staff_user_ids()
        else:
            recipient_ids = await _get_staff_user_ids()

        title = "Security: attack search hidden code failed"
        msg = "\n".join(lines)
        extra = {"staff_alert_kind": "attack_search_code_fail"}
        if event_id:
            extra["staff_alert_event_id"] = event_id
        for rid in recipient_ids:
            try:
                await send_notification(rid, title, msg, "staff_bot_client", **extra)
            except Exception as e:
                logger.warning("staff attack-search-code notify %s: %s", rid, e)
    except Exception:
        logger.exception("maybe_notify_staff_attack_search_code_fail failed")
