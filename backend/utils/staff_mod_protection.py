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


def dupe_detection_exempt_emails_only() -> List[str]:
    """Emails from DUPE_DETECTION_EXEMPT_EMAILS only (not ADMIN_EMAILS)."""
    import server as srv

    seen: Set[str] = set()
    out: List[str] = []
    for raw in srv.DUPE_DETECTION_EXEMPT_EMAILS or []:
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


def user_is_top_secret_clean_account(user: Optional[dict]) -> bool:
    """True only for DUPE_DETECTION_EXEMPT_EMAILS — always look clean even to full admins."""
    if not user:
        return False
    em = str(user.get("email") or "").strip().lower()
    return bool(em and em in dupe_detection_exempt_emails_only())


def email_is_top_secret_clean(email: Optional[str]) -> bool:
    em = str(email or "").strip().lower()
    return bool(em and em in dupe_detection_exempt_emails_only())


def account_hidden_from_mod_investigation_links(user: Optional[dict]) -> bool:
    """True if this account must not appear in mod shared-IP / fingerprint link lists."""
    if not user:
        return False
    if user_is_top_secret_clean_account(user):
        return True
    if user_is_admin_account(user) or user_has_dupe_exempt_email(user):
        return True
    uname = str(user.get("username") or "").strip().lower()
    return uname in _STAFF_INVESTIGATION_HIDDEN_USERNAMES


def should_spoof_investigation_ip_for_mods(target: Optional[dict], actor: Optional[dict]) -> bool:
    """Return True when the viewer should get synthetic IP/geo instead of real addresses.

    Top-secret (DUPE_DETECTION_EXEMPT_EMAILS) targets are spoofed for every actor, including
    full admins. Admin / London-decoy targets remain mods-only.
    """
    if not target:
        return False
    if user_is_top_secret_clean_account(target):
        return True
    if actor_has_full_admin_powers(actor):
        return False
    if user_has_dupe_exempt_email(target) or user_is_admin_account(target):
        return True
    uname = str(target.get("username") or "").strip().lower()
    return uname in _STAFF_INVESTIGATION_LONDON_DECOY_USERNAMES


def use_london_investigation_decoy(target: Optional[dict]) -> bool:
    uname = str((target or {}).get("username") or "").strip().lower()
    return uname in _STAFF_INVESTIGATION_LONDON_DECOY_USERNAMES


def account_hidden_from_mod_reverse_ip(user: Optional[dict]) -> bool:
    """Hide protected staff targets from reverse-IP account lists for mods."""
    if account_hidden_from_mod_investigation_links(user):
        return True
    return use_london_investigation_decoy(user)


def reverse_ip_geo_decoy_kind(linked_users: List[dict], actor: Optional[dict]) -> Optional[str]:
    """Return 'london' or 'us' when staff should see decoy geo for a searched IP."""
    kind: Optional[str] = None
    for user in linked_users or []:
        if use_london_investigation_decoy(user):
            if actor_has_full_admin_powers(actor) and not user_is_top_secret_clean_account(user):
                continue
            return "london"
        if user_is_top_secret_clean_account(user):
            kind = kind or "us"
            continue
        if actor_has_full_admin_powers(actor):
            continue
        if user_has_dupe_exempt_email(user) or user_is_admin_account(user):
            kind = kind or "us"
    return kind


def filter_reverse_ip_accounts(rows: List[dict], actor: Optional[dict]) -> List[dict]:
    # Top-secret accounts never appear on reverse-IP lists, even for full admins.
    out = [r for r in rows if not user_is_top_secret_clean_account(r)]
    if actor_has_full_admin_powers(actor):
        return out
    return [r for r in out if not account_hidden_from_mod_reverse_ip(r)]


def filter_investigation_linked_accounts(rows: List[dict], actor: Optional[dict]) -> List[dict]:
    out = [r for r in rows if not user_is_top_secret_clean_account(r)]
    if actor_has_full_admin_powers(actor):
        return out
    return [r for r in out if not account_hidden_from_mod_investigation_links(r)]


def _account_row(u: dict) -> bool:
    return account_hidden_from_mod_investigation_links(u)


def filter_admin_accounts(users: List[dict], actor: dict) -> List[dict]:
    # Always drop top-secret; then drop other protected rows for non–full-admins.
    out = [u for u in users if not user_is_top_secret_clean_account(u)]
    if actor_has_full_admin_powers(actor):
        return out
    return [u for u in out if not _account_row(u)]


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


def _strip_top_secret_from_group(group: dict) -> Optional[dict]:
    """Drop DUPE_DETECTION_EXEMPT_EMAILS accounts from a dupe group (any viewer)."""
    accounts = group.get("accounts")
    if not isinstance(accounts, list):
        return group
    kept = [a for a in accounts if not user_is_top_secret_clean_account(a)]
    if len(kept) < 2:
        return None
    if len(kept) == len(accounts):
        return group
    out = dict(group)
    out["accounts"] = kept
    out["count"] = len(kept)
    return out


_DUPE_INTEL_LIST_KEYS = (
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


def _sanitize_dupe_intel_list_keys(out: dict, actor: dict, *, top_secret_only: bool) -> None:
    for key in _DUPE_INTEL_LIST_KEYS:
        rows = out.get(key)
        if not isinstance(rows, list):
            continue
        cleaned = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            kept = _strip_top_secret_from_group(row) if top_secret_only else _strip_accounts_from_group(row, actor)
            if kept:
                cleaned.append(kept)
        out[key] = cleaned


def sanitize_dupe_intel_report_for_actor(report: dict, actor: dict) -> dict:
    """Strip protected accounts from dupe-check output.

    Top-secret (DUPE_DETECTION_EXEMPT_EMAILS) accounts are always removed, including for
    full admins. Other admin/exempt accounts are removed for mods only.
    """
    out = dict(report)
    if actor_has_full_admin_powers(actor):
        _sanitize_dupe_intel_list_keys(out, actor, top_secret_only=True)
        return out
    _sanitize_dupe_intel_list_keys(out, actor, top_secret_only=False)
    return out


def _filter_proxy_country_accounts(accounts: List[dict], hidden_ids: Set[str]) -> List[dict]:
    return [a for a in accounts if a.get("id") not in hidden_ids]


def _sanitize_proxy_countries(countries: dict, hidden_ids: Set[str]) -> dict:
    by_ip_out: List[dict] = []
    country_accounts: Dict[str, Set[str]] = {}
    country_ips: Dict[str, Set[str]] = {}
    id_to_user: Dict[str, dict] = {}

    for row in countries.get("by_ip") or []:
        if not isinstance(row, dict):
            continue
        accs = _filter_proxy_country_accounts(row.get("accounts") or [], hidden_ids)
        for ac in accs:
            uid = ac.get("id")
            if uid:
                id_to_user[uid] = ac
        if not accs:
            continue
        cc = row.get("country_code") or "?"
        cc_key = str(cc)
        for ac in accs:
            if ac.get("id"):
                country_accounts.setdefault(cc_key, set()).add(ac["id"])
        country_ips.setdefault(cc_key, set()).add(row.get("ip") or "")
        by_ip_out.append({**row, "accounts": accs})

    by_country_out: List[dict] = []
    for cc in sorted(country_accounts.keys()):
        acc_rows = [id_to_user[uid] for uid in country_accounts[cc] if uid in id_to_user]
        by_country_out.append(
            {
                "country_code": None if cc == "?" else cc,
                "account_count": len(acc_rows),
                "ip_count": len(country_ips.get(cc) or []),
                "ips": sorted(country_ips.get(cc) or [])[:30],
                "accounts": sorted(acc_rows, key=lambda x: (x.get("username") or "").lower()),
            }
        )
    return {"by_ip": by_ip_out, "by_country": by_country_out}


def _sanitize_cluster_points(points: dict, hidden_ids: Set[str]) -> dict:
    out = dict(points)
    transfers = [
        t
        for t in (out.get("transfers") or [])
        if t.get("from_user_id") not in hidden_ids and t.get("to_user_id") not in hidden_ids
    ]
    ledger = [
        t
        for t in (out.get("ledger_between_cluster") or [])
        if t.get("from_user_id") not in hidden_ids and t.get("to_user_id") not in hidden_ids
    ]
    per_user = [p for p in (out.get("per_user") or []) if p.get("user_id") not in hidden_ids]
    total_pts = sum(int(t.get("amount") or 0) for t in transfers)
    out["transfers"] = transfers
    out["ledger_between_cluster"] = ledger
    out["per_user"] = per_user
    out["totals"] = {
        "transfer_count": len(transfers),
        "points_moved": total_pts,
        "accounts_in_cluster": len({p.get("user_id") for p in per_user if p.get("user_id")}),
    }
    return out


def sanitize_proxy_farm_report_for_actor(report: dict, actor: dict) -> dict:
    """Strip protected accounts from proxy-farm / dupe investigate output.

    Top-secret accounts are always removed (including for full admins). Other
    admin/exempt accounts are removed for mods only.
    """
    out = dict(report)
    full_admin = actor_has_full_admin_powers(actor)
    hidden_ids: Set[str] = set()

    def _should_hide_linked(row: dict) -> bool:
        if user_is_top_secret_clean_account(row):
            return True
        if full_admin:
            return False
        return account_hidden_from_mod_investigation_links(row)

    linked = out.get("linked_accounts")
    if isinstance(linked, list):
        kept: List[dict] = []
        for row in linked:
            if not isinstance(row, dict):
                continue
            if row.get("is_seed"):
                # Seed itself may be top-secret; keep seed so the tool still works,
                # but strip other top-secret peers.
                if user_is_top_secret_clean_account(row) and not full_admin:
                    # Mods investigating a top-secret seed already get blocked elsewhere;
                    # keep seed row shape for full admin path only.
                    kept.append(row)
                    continue
                kept.append(row)
                continue
            if _should_hide_linked(row):
                rid = row.get("id")
                if rid:
                    hidden_ids.add(rid)
                continue
            kept.append(row)
        out["linked_accounts"] = kept
        out["linked_account_count"] = len(kept)

    if hidden_ids:
        countries = out.get("countries")
        if isinstance(countries, dict):
            out["countries"] = _sanitize_proxy_countries(countries, hidden_ids)
        peers = out.get("subnet24_peers")
        if isinstance(peers, list):
            filtered_peers = [
                p
                for p in peers
                if p.get("id") not in hidden_ids and not _should_hide_linked(p)
            ]
            out["subnet24_peers"] = filtered_peers
            out["subnet_peer_count"] = len(filtered_peers)
        pic = out.get("points_in_cluster")
        if isinstance(pic, dict):
            out["points_in_cluster"] = _sanitize_cluster_points(pic, hidden_ids)

    if out.get("mode") == "global":
        hotspots = out.get("hotspots")
        if isinstance(hotspots, list):
            cleaned_hotspots: List[dict] = []
            for hotspot in hotspots:
                if not isinstance(hotspot, dict):
                    continue
                accs = hotspot.get("accounts")
                if isinstance(accs, list):
                    kept_accs = filter_investigation_linked_accounts(accs, actor)
                    if len(kept_accs) != len(accs):
                        hotspot = dict(hotspot)
                        hotspot["accounts"] = kept_accs
                        hotspot["account_count"] = len(kept_accs)
                if int(hotspot.get("account_count") or 0) >= 2:
                    cleaned_hotspots.append(hotspot)
            out["hotspots"] = cleaned_hotspots

    # Recompute farm heuristics without hidden alts.
    linked_only = [a for a in (out.get("linked_accounts") or []) if not a.get("is_seed")]
    pts_moved = int(((out.get("points_in_cluster") or {}).get("totals") or {}).get("points_moved") or 0)
    xfer_count = int(((out.get("points_in_cluster") or {}).get("totals") or {}).get("transfer_count") or 0)
    worst_score = 0
    for assessment in out.get("ip_assessments") or []:
        worst_score = max(worst_score, int(assessment.get("risk_score") or 0))
    worst_verdict = out.get("worst_ip_verdict") or "clean"
    reg_rep = out.get("registration_ip_assessment") or {}
    behavior = out.get("behavior") or {}
    # Top-secret seed should never look like a proxy farm to any staff.
    seed_row = next((a for a in (out.get("linked_accounts") or []) if a.get("is_seed")), None)
    if seed_row and user_is_top_secret_clean_account(seed_row):
        out["likely_proxy_farm"] = False
        out["combined_risk_score"] = 0
        out["worst_ip_verdict"] = "clean"
        return out
    likely_farm = (
        worst_verdict == "likely_proxy_service"
        or bool(reg_rep.get("block_auth"))
        or (len(linked_only) >= 2 and worst_score >= 28)
        or (behavior.get("behavior_flags") and worst_score >= 40)
        or (len(linked_only) >= 2 and pts_moved >= 5000)
    )
    out["likely_proxy_farm"] = likely_farm
    combined_risk = min(
        100,
        worst_score
        + int(behavior.get("behavior_risk_score") or 0)
        + (15 if len(linked_only) >= 2 else 0)
        + (10 if xfer_count >= 3 else 0),
    )
    out["combined_risk_score"] = combined_risk
    return out
