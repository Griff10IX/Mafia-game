"""Staff/mod boundaries: admin accounts hidden from mod tools, temporary admin-as-mod preview."""
from __future__ import annotations

import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Set

from fastapi import HTTPException

MOD_TARGET_BLOCKED_DETAIL = "This account cannot be reviewed with moderator tools."
ADMIN_MOD_PREVIEW_MINUTES = 30

# Usernames never listed as "other accounts" on shared IPs for non-full-admin investigators.
_STAFF_INVESTIGATION_HIDDEN_USERNAMES = frozenset({"ghostface", "scoop"})
# Targets that receive a London UK decoy IP/geo payload for non-full-admin viewers.
_STAFF_INVESTIGATION_LONDON_DECOY_USERNAMES = frozenset({"raven"})


def _parse_iso_utc(raw: Any) -> Optional[datetime]:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def user_is_admin_account(user: Optional[dict]) -> bool:
    """True if account email is on ADMIN_EMAILS (full admin roster)."""
    if not user:
        return False
    import server as srv

    em = str(user.get("email") or "").strip().lower()
    return bool(em and em in (srv.ADMIN_EMAILS or []))


def admin_mod_preview_active(user: Optional[dict]) -> bool:
    """True while an admin is temporarily previewing moderator-only tools."""
    if not user:
        return False
    if not user_is_admin_account(user):
        return False
    until = _parse_iso_utc(user.get("admin_preview_as_mod_until"))
    if not until:
        return False
    return datetime.now(timezone.utc) < until


def admin_mod_preview_seconds_remaining(user: Optional[dict]) -> Optional[int]:
    if not user:
        return None
    until = _parse_iso_utc(user.get("admin_preview_as_mod_until"))
    if not until:
        return None
    secs = int((until - datetime.now(timezone.utc)).total_seconds())
    return secs if secs > 0 else None


def actor_has_full_admin_powers(actor: Optional[dict]) -> bool:
    """Listed admin with full tool access (not act-as-normal, not mod preview)."""
    if not actor:
        return False
    import server as srv

    if not srv.user_has_admin_list_email(actor):
        return False
    if actor.get("admin_acting_as_normal"):
        return False
    if admin_mod_preview_active(actor):
        return False
    return True


def assert_mod_may_target_user(actor: dict, target: dict) -> None:
    """Mods cannot run investigation/cheat tools against admin accounts."""
    if not user_is_admin_account(target):
        return
    if actor_has_full_admin_powers(actor):
        return
    raise HTTPException(status_code=403, detail=MOD_TARGET_BLOCKED_DETAIL)


def effective_dupe_exempt_emails() -> List[str]:
    """Env DUPE_DETECTION_EXEMPT_EMAILS plus admin emails (never exposed to clients)."""
    import server as srv

    seen: Set[str] = set()
    out: List[str] = []
    for raw in (srv.DUPE_DETECTION_EXEMPT_EMAILS or []) + (srv.ADMIN_EMAILS or []):
        em = str(raw or "").strip().lower()
        if em and em not in seen:
            seen.add(em)
            out.append(em)
    return out


def dupe_exempt_email_nor_clauses() -> List[dict]:
    """$nor subclauses for cheat-detection queries (includes admins silently)."""
    emails = effective_dupe_exempt_emails()
    if not emails:
        return []
    return [{"email": re.compile("^" + re.escape(e) + "$", re.IGNORECASE)} for e in emails]


def user_has_dupe_exempt_email(user: Optional[dict]) -> bool:
    if not user:
        return False
    em = str(user.get("email") or "").strip().lower()
    return bool(em and em in effective_dupe_exempt_emails())


def account_hidden_from_mod_investigation_links(user: Optional[dict]) -> bool:
    """True if this account must not appear in mod shared-IP / fingerprint link lists."""
    if not user:
        return False
    if user_is_admin_account(user) or user_has_dupe_exempt_email(user):
        return True
    uname = str(user.get("username") or "").strip().lower()
    return uname in _STAFF_INVESTIGATION_HIDDEN_USERNAMES


def should_spoof_investigation_ip_for_mods(target: Optional[dict], actor: Optional[dict]) -> bool:
    """Non-full-admin staff see decoy IP/geo instead of real addresses for protected targets."""
    if not target or actor_has_full_admin_powers(actor):
        return False
    if user_has_dupe_exempt_email(target) or user_is_admin_account(target):
        return True
    uname = str(target.get("username") or "").strip().lower()
    return uname in _STAFF_INVESTIGATION_LONDON_DECOY_USERNAMES


def use_london_investigation_decoy(target: Optional[dict]) -> bool:
    uname = str((target or {}).get("username") or "").strip().lower()
    return uname in _STAFF_INVESTIGATION_LONDON_DECOY_USERNAMES


def filter_investigation_linked_accounts(rows: List[dict], actor: Optional[dict]) -> List[dict]:
    if actor_has_full_admin_powers(actor):
        return rows
    return [r for r in rows if not account_hidden_from_mod_investigation_links(r)]


def _account_row(u: dict) -> bool:
    return account_hidden_from_mod_investigation_links(u)


def filter_admin_accounts(users: List[dict], actor: dict) -> List[dict]:
    if actor_has_full_admin_powers(actor):
        return users
    return [u for u in users if not _account_row(u)]


def _strip_accounts_from_group(group: dict, actor: dict) -> Optional[dict]:
    accounts = group.get("accounts")
    if not isinstance(accounts, list):
        return group
    kept = filter_admin_accounts(accounts, actor)
    if len(kept) < 2:
        return None
    out = dict(group)
    out["accounts"] = kept
    out["count"] = len(kept)
    return out


def sanitize_dupe_intel_report_for_actor(report: dict, actor: dict) -> dict:
    """Remove admin accounts from dupe-check output when viewer is not full admin."""
    if actor_has_full_admin_powers(actor):
        return report
    out = dict(report)
    list_keys = (
        "same_ip_groups",
        "same_subnet_groups",
        "same_fingerprint_groups",
        "same_user_agent_groups",
        "by_domain",
        "by_similar_username",
        "by_similar_email",
        "by_same_day_same_ip",
        "by_fuzzy_username",
        "registration_burst_groups",
        "referral_same_ip_groups",
        "heavy_transfer_pairs",
        "prereg_ip_cross_accounts",
        "suspicious_ip_correlations",
        "transfer_ring_groups",
        "overlapping_session_device_groups",
        "automation_cadence_groups",
        "referral_abuse_groups",
        "alive_dead_ip_groups",
        "alive_dead_fingerprint_groups",
    )
    for key in list_keys:
        rows = out.get(key)
        if not isinstance(rows, list):
            continue
        cleaned = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            kept = _strip_accounts_from_group(row, actor)
            if kept:
                cleaned.append(kept)
        out[key] = cleaned
    return out
