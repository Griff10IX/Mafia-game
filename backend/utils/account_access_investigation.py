"""Staff account-access / possible-compromise investigation helpers."""
from __future__ import annotations

import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Set

from utils.ip_enrichment import normalize_ip


def _parse_ts(s: Any) -> Optional[datetime]:
    if s is None:
        return None
    if isinstance(s, datetime):
        return s if s.tzinfo else s.replace(tzinfo=timezone.utc)
    if isinstance(s, str):
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return None
    return None


def _normalize_ua(ua: str) -> str:
    raw = (ua or "").strip()
    if not raw:
        return ""
    return re.sub(r"/\d+[\d.]*", "", raw)


def _finding(severity: str, code: str, title: str, detail: str, action: Optional[str] = None) -> Dict[str, Any]:
    return {
        "severity": severity,
        "code": code,
        "title": title,
        "detail": detail,
        "suggested_action": action,
    }


async def _accounts_linked_to_ip(
    db,
    ipn: str,
    *,
    exclude_user_id: str,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    if not ipn:
        return []
    q = {
        "id": {"$ne": exclude_user_id},
        "is_npc": {"$ne": True},
        "$or": [
            {"registration_ip": ipn},
            {"last_login_ip": ipn},
            {"last_request_ip": ipn},
            {"login_ips": ipn},
            {"login_history.ip": ipn},
            {"sessions.ip": ipn},
        ],
    }
    proj = {"_id": 0, "id": 1, "username": 1, "email": 1, "created_at": 1, "is_dead": 1, "last_login_ip": 1}
    rows = await db.users.find(q, proj).limit(int(limit)).to_list(int(limit))
    out: List[Dict[str, Any]] = []
    for u in rows:
        roles: List[str] = []
        if normalize_ip(u.get("registration_ip")) == ipn:
            roles.append("registration")
        if normalize_ip(u.get("last_login_ip")) == ipn:
            roles.append("last_login")
        if normalize_ip(u.get("last_request_ip")) == ipn:
            roles.append("last_request")
        out.append(
            {
                "id": u.get("id"),
                "username": u.get("username"),
                "email": u.get("email"),
                "created_at": u.get("created_at"),
                "is_dead": u.get("is_dead"),
                "roles": roles or ["history_or_session"],
            }
        )
    return out


def _aggregate_devices(login_history: List[dict], sessions: List[dict]) -> List[Dict[str, Any]]:
    buckets: Dict[str, Dict[str, Any]] = {}

    def touch(key: str, *, device_type: str, ua_short: str, ip: str, at: Any, source: str) -> None:
        if key not in buckets:
            buckets[key] = {
                "device_key": key,
                "device_type": device_type or "Unknown",
                "ua_short": ua_short or "",
                "login_count": 0,
                "ips": set(),
                "sources": set(),
                "first_at": None,
                "last_at": None,
            }
        b = buckets[key]
        b["login_count"] += 1
        if ip:
            b["ips"].add(ip)
        if source:
            b["sources"].add(source)
        dt = _parse_ts(at)
        if dt:
            if b["first_at"] is None or dt < _parse_ts(b["first_at"]):
                b["first_at"] = at
            if b["last_at"] is None or dt > _parse_ts(b["last_at"]):
                b["last_at"] = at

    for h in login_history:
        if not isinstance(h, dict):
            continue
        dt = (h.get("device_type") or "Unknown").strip()
        ua = (h.get("ua_short") or "").strip()
        key = f"{dt}|{ua}" if ua else dt
        touch(
            key,
            device_type=dt,
            ua_short=ua,
            ip=normalize_ip(h.get("ip")),
            at=h.get("at"),
            source=(h.get("source") or "login"),
        )

    for s in sessions or []:
        if not isinstance(s, dict):
            continue
        dt = (s.get("device_type") or "Unknown").strip()
        key = f"{dt}|session"
        touch(
            key,
            device_type=dt,
            ua_short="(active session)",
            ip=normalize_ip(s.get("ip")),
            at=s.get("last_used_at") or s.get("created_at"),
            source="session",
        )

    out = []
    for b in buckets.values():
        out.append(
            {
                "device_key": b["device_key"],
                "device_type": b["device_type"],
                "ua_short": b["ua_short"],
                "login_count": b["login_count"],
                "ips": sorted(b["ips"]),
                "ip_count": len(b["ips"]),
                "sources": sorted(b["sources"]),
                "first_at": b["first_at"],
                "last_at": b["last_at"],
            }
        )
    out.sort(key=lambda x: (_parse_ts(x.get("last_at")) or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
    return out


def _tag_login_events(
    timeline: List[dict],
    *,
    registration_ip: Optional[str],
    known_ips_early: Set[str],
    ip_sharing_counts: Dict[str, int],
) -> List[Dict[str, Any]]:
    reg = registration_ip or ""
    tagged: List[Dict[str, Any]] = []
    seen_ips: Set[str] = set(known_ips_early)
    for row in timeline or []:
        if not isinstance(row, dict):
            continue
        ipn = normalize_ip(row.get("ip"))
        tags: List[str] = []
        if ipn:
            if reg and ipn == reg:
                tags.append("registration_ip")
            elif ipn not in seen_ips:
                tags.append("new_ip")
            if (ip_sharing_counts.get(ipn) or 0) > 0:
                tags.append("shared_ip")
            if row.get("hosting"):
                tags.append("hosting")
            if row.get("proxy"):
                tags.append("proxy")
            if row.get("mobile"):
                tags.append("mobile")
            seen_ips.add(ipn)
        tagged.append({**row, "tags": tags})
    return tagged


async def enrich_account_access_report(
    db,
    user: Dict[str, Any],
    ip_payload: Dict[str, Any],
    *,
    attack_days: int = 90,
    ip_overlap_limit: int = 12,
    accounts_per_ip_limit: int = 15,
    actor: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Add devices, IP overlap, fingerprint matches, findings, and staff checklist."""
    from utils.staff_mod_protection import filter_investigation_linked_accounts

    uid = user["id"]
    uname = user.get("username") or ""
    now = datetime.now(timezone.utc)

    hist_raw = user.get("login_history") if isinstance(user.get("login_history"), list) else []
    sessions_raw = user.get("sessions") if isinstance(user.get("sessions"), list) else []
    devices = _aggregate_devices(hist_raw, sessions_raw)

    reg_ip = normalize_ip(user.get("registration_ip"))
    all_ips = [row.get("ip") for row in (ip_payload.get("ip_summary") or []) if row.get("ip")]
    unique_ips = []
    seen: Set[str] = set()
    for ip in all_ips:
        n = normalize_ip(ip)
        if n and n not in seen:
            seen.add(n)
            unique_ips.append(n)

    ip_sharing: List[Dict[str, Any]] = []
    ip_sharing_counts: Dict[str, int] = {}
    for ipn in unique_ips[: max(1, int(ip_overlap_limit))]:
        linked = await _accounts_linked_to_ip(
            db, ipn, exclude_user_id=uid, limit=int(accounts_per_ip_limit)
        )
        linked = filter_investigation_linked_accounts(linked, actor)
        alive_others = [a for a in linked if not a.get("is_dead")]
        ip_sharing_counts[ipn] = len(alive_others)
        if linked:
            ip_sharing.append(
                {
                    "ip": ipn,
                    "other_account_count": len(linked),
                    "other_alive_count": len(alive_others),
                    "accounts": linked,
                }
            )
    ip_sharing.sort(key=lambda x: x.get("other_alive_count", 0), reverse=True)

    fp = (user.get("device_fingerprint") or "").strip()
    fingerprint_matches: List[Dict[str, Any]] = []
    if fp:
        fp_rows = await db.users.find(
            {"device_fingerprint": fp, "id": {"$ne": uid}, "is_npc": {"$ne": True}},
            {"_id": 0, "id": 1, "username": 1, "email": 1, "is_dead": 1, "last_login_ip": 1, "created_at": 1},
        ).limit(25).to_list(25)
        fingerprint_matches = [
            {
                "id": r.get("id"),
                "username": r.get("username"),
                "email": r.get("email"),
                "is_dead": r.get("is_dead"),
                "last_login_ip": normalize_ip(r.get("last_login_ip")) or None,
                "created_at": r.get("created_at"),
            }
            for r in fp_rows
        ]
        fingerprint_matches = filter_investigation_linked_accounts(fingerprint_matches, actor)

    ua_norm = _normalize_ua(user.get("last_user_agent") or "")
    ua_matches: List[Dict[str, Any]] = []
    if ua_norm and len(ua_norm) >= 20:
        pattern = re.compile(re.escape(ua_norm[:80]), re.IGNORECASE)
        cursor = db.users.find(
            {"id": {"$ne": uid}, "is_npc": {"$ne": True}, "last_user_agent": pattern},
            {"_id": 0, "id": 1, "username": 1, "is_dead": 1, "last_login_ip": 1},
        ).limit(20)
        ua_matches = await cursor.to_list(20)
        ua_matches = filter_investigation_linked_accounts(ua_matches, actor)

    susp_cut = (now - timedelta(days=30)).isoformat()
    susp_q = {
        "at": {"$gte": susp_cut},
        "$or": [
            {"user_id": uid},
            {"username": re.compile("^" + re.escape(uname) + "$", re.IGNORECASE)},
            {"login_input": re.compile(re.escape(uname), re.IGNORECASE)},
        ],
    }
    suspicious_recent = await db.suspicious_logins.find(susp_q, {"_id": 0}).sort("at", -1).limit(30).to_list(30)
    suspicious_count = await db.suspicious_logins.count_documents(susp_q)

    sec_flags = await db.security_flags.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).limit(25).to_list(25)

    email_clean = (user.get("email") or "").strip().lower()
    lockout = None
    if email_clean:
        lockout = await db.login_lockouts.find_one({"email": email_clean}, {"_id": 0})

    early_ips: Set[str] = set()
    if reg_ip:
        early_ips.add(reg_ip)
    for h in sorted(
        [x for x in hist_raw if isinstance(x, dict)],
        key=lambda x: _parse_ts(x.get("at")) or datetime.min.replace(tzinfo=timezone.utc),
    )[:3]:
        ipn = normalize_ip(h.get("ip"))
        if ipn:
            early_ips.add(ipn)

    tagged_timeline = _tag_login_events(
        ip_payload.get("login_timeline") or [],
        registration_ip=reg_ip,
        known_ips_early=early_ips,
        ip_sharing_counts=ip_sharing_counts,
    )

    findings: List[Dict[str, Any]] = []
    alive_fp_others = [m for m in fingerprint_matches if not m.get("is_dead")]
    if alive_fp_others:
        names = ", ".join(m.get("username") or m.get("id") for m in alive_fp_others[:5])
        findings.append(
            _finding(
                "critical",
                "shared_device_fingerprint",
                "Same device fingerprint as other alive account(s)",
                f"Matches: {names}" + ("…" if len(alive_fp_others) > 5 else ""),
                "Review linked accounts in Cheat Detection; consider force logout + password reset for victim.",
            )
        )

    shared_alive = [row for row in ip_sharing if (row.get("other_alive_count") or 0) > 0]
    if shared_alive:
        top = shared_alive[0]
        findings.append(
            _finding(
                "warn",
                "shared_ip_alive",
                "IP shared with other alive account(s)",
                f"{top.get('ip')} is linked to {top.get('other_alive_count')} other alive account(s).",
                "Open reverse IP below; check for multi-account or account takeover from same network.",
            )
        )

    if suspicious_count > 0:
        findings.append(
            _finding(
                "warn",
                "suspicious_logins",
                f"{suspicious_count} suspicious login touch(es) in 30d",
                "Failed or odd login attempts recorded (wrong password, unknown account on same IP, etc.).",
                "Review suspicious login list below.",
            )
        )

    for risk in ip_payload.get("risks") or []:
        findings.append(
            _finding(
                risk.get("level") or "warn",
                risk.get("code") or "risk",
                (risk.get("code") or "risk").replace("_", " ").title(),
                risk.get("detail") or "",
                None,
            )
        )

    recent_cut = now - timedelta(days=14)
    recent_new_hosting = [
        t
        for t in tagged_timeline
        if _parse_ts(t.get("at")) and _parse_ts(t.get("at")) >= recent_cut and "hosting" in (t.get("tags") or [])
    ]
    if recent_new_hosting:
        findings.append(
            _finding(
                "warn",
                "recent_hosting_login",
                "Recent login from hosting/datacenter IP",
                f"{len(recent_new_hosting)} login event(s) in the last 14 days from hosting-flagged IPs.",
                "Likely VPN, cloud VM, or bot farm — verify with player.",
            )
        )

    recent_new_ips = [
        t
        for t in tagged_timeline
        if _parse_ts(t.get("at")) and _parse_ts(t.get("at")) >= recent_cut and "new_ip" in (t.get("tags") or [])
    ]
    if recent_new_ips and reg_ip:
        findings.append(
            _finding(
                "info",
                "recent_new_ips",
                "New IP(s) seen in last 14 days",
                f"{len(recent_new_ips)} login(s) from IPs not in the first few sign-ins / registration.",
                "Ask the player if they travelled, changed ISP, or used mobile data.",
            )
        )

    last_login = normalize_ip(user.get("last_login_ip"))
    if reg_ip and last_login and last_login != reg_ip:
        findings.append(
            _finding(
                "info",
                "last_login_differs_from_reg",
                "Last login IP ≠ registration IP",
                f"Registered from {reg_ip}; last login from {last_login}.",
                None,
            )
        )

    if lockout and lockout.get("locked_until"):
        lu = _parse_ts(lockout.get("locked_until"))
        if lu and lu > now:
            findings.append(
                _finding(
                    "info",
                    "account_locked",
                    "Account temporarily locked (failed logins)",
                    f"Locked until {lockout.get('locked_until')} ({lockout.get('failed_count')} failed attempts).",
                    "Player may have been targeted with password guessing.",
                )
            )

    device_count = len(devices)
    multi_ip_devices = [d for d in devices if (d.get("ip_count") or 0) >= 3]
    if multi_ip_devices:
        findings.append(
            _finding(
                "info",
                "device_many_ips",
                "One device profile used many IPs",
                f"{len(multi_ip_devices)} device/UA group(s) seen from 3+ IPs — normal for mobile, odd for desktop-only claims.",
                None,
            )
        )

    if not findings:
        findings.append(
            _finding(
                "info",
                "no_major_flags",
                "No major automated flags",
                "Review timeline and devices manually; absence of flags does not prove the account is safe.",
                None,
            )
        )

    staff_checklist = [
        {"id": "confirm_report", "label": "Confirm what the player reports (time, device, location, email change, lost items)."},
        {"id": "compare_timeline", "label": "Compare login timeline + devices to what they say is theirs."},
        {"id": "check_shared", "label": "Check shared IPs and fingerprint matches for alt / takeover links."},
        {"id": "force_logout", "label": "If compromised: Admin → force logout user (bump token_version) and set temporary password."},
        {"id": "secure_email", "label": "Ensure email is theirs; check for phishing / shared password reuse."},
        {"id": "economy_audit", "label": "If items/cash moved: check activity log, trades, attacks, and family transfers."},
    ]

    return {
        "account": {
            "id": uid,
            "username": uname,
            "email": user.get("email"),
            "created_at": user.get("created_at"),
            "is_dead": user.get("is_dead"),
            "last_seen": user.get("last_seen"),
            "token_version": int(user.get("token_version") or 0),
            "registration_ip": reg_ip,
            "last_login_ip": normalize_ip(user.get("last_login_ip")),
            "last_request_ip": normalize_ip(user.get("last_request_ip")),
            "last_device_type": user.get("last_device_type"),
            "last_user_agent": user.get("last_user_agent"),
            "device_fingerprint": fp or None,
        },
        "devices": devices,
        "device_count": device_count,
        "ip_sharing": ip_sharing,
        "fingerprint_matches": fingerprint_matches,
        "ua_fingerprint_matches": [
            {
                "id": m.get("id"),
                "username": m.get("username"),
                "is_dead": m.get("is_dead"),
                "last_login_ip": normalize_ip(m.get("last_login_ip")) or None,
            }
            for m in ua_matches
        ],
        "login_timeline_tagged": tagged_timeline,
        "suspicious_logins": {"count_30d": suspicious_count, "recent": suspicious_recent},
        "security_flags_recent": sec_flags,
        "login_lockout": lockout,
        "findings": findings,
        "staff_checklist": staff_checklist,
        "meta": {
            "generated_at": now.isoformat(),
            "attack_days": int(attack_days),
            "ips_checked_for_sharing": min(len(unique_ips), int(ip_overlap_limit)),
        },
    }
