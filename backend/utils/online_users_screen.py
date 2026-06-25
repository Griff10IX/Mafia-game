"""Lightweight dupe / proxy screening for staff live-online roster."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from utils.ip_enrichment import get_or_fetch_ip_geodata, network_label, normalize_ip
from utils.proxy_detection import classify_ip_reputation
from utils.staff_mod_protection import filter_investigation_linked_accounts


def _parse_created_at(raw: Any) -> Optional[datetime]:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _effective_email(user: Optional[Dict[str, Any]]) -> Optional[str]:
    if not user:
        return None
    em = (user.get("email") or "").strip().lower()
    if em.startswith("dead_") and em.endswith("@deleted"):
        em = (user.get("email_before_freed") or "").strip().lower()
    return em if em and "@" in em else None


def _progression_score(user: Dict[str, Any]) -> int:
    return int(user.get("rank_points") or 0) + int(user.get("points") or 0) // 10


def _rank_real_account_candidates(
    subject_id: str,
    subject_raw: Dict[str, Any],
    candidates_by_id: Dict[str, Dict[str, Any]],
    reasons_by_id: Dict[str, List[str]],
    *,
    online_user_ids: Set[str],
) -> List[Dict[str, Any]]:
    """Guess which other online account is the player's main when this row looks like an alt."""
    sub_created = _parse_created_at(subject_raw.get("created_at"))
    sub_prog = _progression_score(subject_raw)
    sub_email = _effective_email(subject_raw)
    ranked: List[Dict[str, Any]] = []

    for cid, cand in candidates_by_id.items():
        if cid == subject_id:
            continue
        if cand.get("is_dead"):
            continue
        if cid not in online_user_ids:
            continue

        reasons = list(dict.fromkeys(reasons_by_id.get(cid) or []))
        reason_blob = " ".join(reasons)
        has_online_overlap = (
            "same_ip_online" in reasons
            or "same_fingerprint_online" in reasons
        )
        if not has_online_overlap:
            continue

        score = 0
        why: List[str] = ["online_now"]
        cand_created = _parse_created_at(cand.get("created_at"))
        cand_prog = _progression_score(cand)
        cand_email = _effective_email(cand)

        score += 50
        if cand_created and sub_created and cand_created < sub_created:
            score += 28
            why.append("older_account")
        elif cand_created and sub_created and cand_created > sub_created:
            score -= 12
        if cand_prog > sub_prog:
            score += 16
            why.append("more_progression")
        if sub_email and cand_email and sub_email == cand_email:
            score += 45
            why.append("same_email")
        if subject_raw.get("registration_freed_email_from_user_id") == cid:
            score += 42
            why.append("replaced_dead_account")

        if "same_ip_online" in reasons:
            score += 34
            why.append("same_ip_online_now")
        if "shared_fingerprint" in reason_blob or "same_fingerprint_online" in reason_blob:
            score += 24
            why.append("same_device")

        confidence = "low"
        if score >= 55:
            confidence = "high"
        elif score >= 35:
            confidence = "medium"

        ranked.append(
            {
                "id": cid,
                "username": cand.get("username"),
                "email": cand_email,
                "is_dead": False,
                "is_online": True,
                "created_at": cand.get("created_at"),
                "rank_points": int(cand.get("rank_points") or 0),
                "points": int(cand.get("points") or 0),
                "link_reasons": reasons,
                "why_likely_real": why,
                "confidence_score": score,
                "confidence": confidence,
            }
        )

    ranked.sort(key=lambda x: (-int(x.get("confidence_score") or 0), x.get("username") or ""))
    return ranked


def _rank_possible_dupes(
    subject_id: str,
    subject_raw: Dict[str, Any],
    candidates_by_id: Dict[str, Dict[str, Any]],
    reasons_by_id: Dict[str, List[str]],
    *,
    online_user_ids: Set[str],
) -> List[Dict[str, Any]]:
    """If this online user looks like the main account, list other online alts on the same IP/device."""
    sub_created = _parse_created_at(subject_raw.get("created_at"))
    sub_prog = _progression_score(subject_raw)
    out: List[Dict[str, Any]] = []
    for cid, cand in candidates_by_id.items():
        if cid == subject_id:
            continue
        if cand.get("is_dead"):
            continue
        if cid not in online_user_ids:
            continue

        reasons = list(dict.fromkeys(reasons_by_id.get(cid) or []))
        if not any(r in reasons for r in ("same_ip_online", "same_fingerprint_online")):
            continue

        score = 0
        why: List[str] = ["online_now"]
        cand_created = _parse_created_at(cand.get("created_at"))
        cand_prog = _progression_score(cand)
        if cand_created and sub_created and cand_created > sub_created:
            score += 28
            why.append("newer_account")
        if cand_prog < sub_prog:
            score += 14
            why.append("less_progression")
        if cand.get("registration_freed_email_from_user_id") == subject_id:
            score += 40
            why.append("registered_after_subject_died")
        if "same_ip_online" in reasons:
            score += 30
            why.append("same_ip_online_now")
        if "shared_fingerprint" in " ".join(reasons) or "same_fingerprint_online" in reasons:
            score += 22
            why.append("same_device")
        if score < 20:
            continue
        confidence = "high" if score >= 50 else "medium" if score >= 30 else "low"
        out.append(
            {
                "id": cid,
                "username": cand.get("username"),
                "is_dead": False,
                "is_online": True,
                "created_at": cand.get("created_at"),
                "link_reasons": reasons,
                "why_likely_dupe": why,
                "confidence_score": score,
                "confidence": confidence,
            }
        )
    out.sort(key=lambda x: (-int(x.get("confidence_score") or 0), x.get("username") or ""))
    return out[:5]


def _severity(
    flags: List[str],
    *,
    linked_alive: int,
    fp_alive: int,
    same_fp_online: int,
) -> str:
    if (
        same_fp_online > 0
        or linked_alive >= 2
        or (linked_alive >= 1 and "likely_proxy" in flags)
        or fp_alive >= 1
    ):
        return "critical"
    if (
        "same_ip_online" in flags
        or "shared_ip_alive" in flags
        or "shared_fingerprint" in flags
        or "likely_proxy" in flags
        or "hosting" in flags
        or "shared_ip_dead_only" in flags
    ):
        return "warn"
    if "suspicious_ip" in flags:
        return "watch"
    return "clean"


def _ip_public_view(geo: Dict[str, Any], rep: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "ip": rep.get("ip") or geo.get("ip"),
        "verdict": rep.get("verdict"),
        "risk_score": rep.get("risk_score"),
        "proxy": bool(geo.get("proxy")),
        "hosting": bool(geo.get("hosting")),
        "mobile": bool(geo.get("mobile")),
        "isp": geo.get("isp"),
        "org": geo.get("org"),
        "country_code": geo.get("countryCode"),
        "city": geo.get("city"),
        "region": geo.get("regionName"),
        "network": network_label(geo) if geo.get("ok") else None,
        "provider_keywords": rep.get("provider_keywords") or [],
        "reasons": rep.get("reasons") or [],
    }


async def _batch_linked_accounts_for_ips(
    db,
    ips: List[str],
    *,
    limit_per_ip: int = 12,
) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {ip: [] for ip in ips}
    proj = {
        "_id": 0,
        "id": 1,
        "username": 1,
        "email": 1,
        "email_before_freed": 1,
        "created_at": 1,
        "is_dead": 1,
        "last_login_ip": 1,
        "registration_ip": 1,
        "last_request_ip": 1,
        "rank_points": 1,
        "points": 1,
        "registration_freed_email_from_user_id": 1,
    }
    for ipn in ips:
        if not ipn:
            continue
        q = {
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
        rows = await db.users.find(q, proj).limit(int(limit_per_ip)).to_list(int(limit_per_ip))
        out[ipn] = rows
    return out


async def _batch_fingerprint_matches(
    db,
    fingerprints: List[str],
    *,
    limit_per_fp: int = 10,
) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {fp: [] for fp in fingerprints}
    proj = {
        "_id": 0,
        "id": 1,
        "username": 1,
        "email": 1,
        "email_before_freed": 1,
        "is_dead": 1,
        "created_at": 1,
        "rank_points": 1,
        "points": 1,
        "registration_freed_email_from_user_id": 1,
    }
    for fp in fingerprints:
        if not fp:
            continue
        rows = await db.users.find(
            {"device_fingerprint": fp, "is_npc": {"$ne": True}},
            proj,
        ).limit(int(limit_per_fp)).to_list(int(limit_per_fp))
        out[fp] = rows
    return out


async def attach_online_screening(
    db,
    users: List[Dict[str, Any]],
    raw_by_id: Dict[str, Dict[str, Any]],
    actor: Optional[Dict[str, Any]],
    *,
    max_ip_lookups: int = 40,
) -> Dict[str, Any]:
    """Add per-row screen payload + summary counts. Uses cached geo only (no GetIPIntel per user)."""
    fp_online: Dict[str, List[str]] = defaultdict(list)
    for row in users:
        uid = row.get("id")
        raw = raw_by_id.get(uid) or {}
        fp = (raw.get("device_fingerprint") or "").strip()
        uname = row.get("username")
        if fp and uname:
            fp_online[fp].append(uname)

    unique_ips: List[str] = []
    seen_ips: Set[str] = set()
    for row in users:
        ipn = normalize_ip(row.get("ip") or "")
        if ipn and ipn not in seen_ips:
            seen_ips.add(ipn)
            unique_ips.append(ipn)
    unique_ips = unique_ips[: max(1, int(max_ip_lookups))]

    geo_by_ip: Dict[str, Dict[str, Any]] = {}
    rep_by_ip: Dict[str, Dict[str, Any]] = {}
    for ipn in unique_ips:
        geo = await get_or_fetch_ip_geodata(db, ipn)
        rep = classify_ip_reputation(geo, getipintel_vpn=False)
        geo_by_ip[ipn] = geo
        rep_by_ip[ipn] = rep

    linked_by_ip = await _batch_linked_accounts_for_ips(db, unique_ips)

    unique_fps: List[str] = []
    seen_fps: Set[str] = set()
    for row in users:
        raw = raw_by_id.get(row.get("id")) or {}
        fp = (raw.get("device_fingerprint") or "").strip()
        if fp and fp not in seen_fps:
            seen_fps.add(fp)
            unique_fps.append(fp)
    fp_rows_by_fp = await _batch_fingerprint_matches(db, unique_fps)

    online_by_ip: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    online_user_ids: Set[str] = set()
    for row in users:
        uid = row.get("id")
        if uid:
            online_user_ids.add(uid)
        ip_row = normalize_ip(row.get("ip") or "")
        if ip_row:
            online_by_ip[ip_row].append(row)

    summary = {"clean": 0, "watch": 0, "warn": 0, "critical": 0, "flagged": 0}

    for row in users:
        uid = row.get("id")
        raw = raw_by_id.get(uid) or {}
        ipn = normalize_ip(row.get("ip") or "")
        flags: List[str] = []

        if int(row.get("same_ip_online_count") or 0) > 0:
            flags.append("same_ip_online")

        rep = rep_by_ip.get(ipn) or {}
        geo = geo_by_ip.get(ipn) or {}
        if rep.get("verdict") == "likely_proxy_service":
            flags.append("likely_proxy")
        elif rep.get("verdict") == "suspicious":
            flags.append("suspicious_ip")
        if geo.get("proxy"):
            flags.append("proxy")
        if geo.get("hosting"):
            flags.append("hosting")

        linked_raw = [a for a in (linked_by_ip.get(ipn) or []) if a.get("id") != uid]
        linked = filter_investigation_linked_accounts(linked_raw, actor)
        linked_alive = [a for a in linked if not a.get("is_dead")]
        if linked_alive:
            flags.append("shared_ip_alive")
        elif linked:
            flags.append("shared_ip_dead_only")

        fp = (raw.get("device_fingerprint") or "").strip()
        fp_rows = [a for a in (fp_rows_by_fp.get(fp) or []) if a.get("id") != uid] if fp else []
        fp_matches = filter_investigation_linked_accounts(fp_rows, actor)
        fp_alive = [a for a in fp_matches if not a.get("is_dead")]
        if fp_matches:
            flags.append("shared_fingerprint")

        same_fp_online = [n for n in fp_online.get(fp, []) if n != row.get("username")] if fp else []
        if same_fp_online:
            flags.append("same_fingerprint_online")

        reg_rep = raw.get("registration_ip_reputation") if isinstance(raw.get("registration_ip_reputation"), dict) else None
        login_rep = raw.get("last_login_ip_reputation") if isinstance(raw.get("last_login_ip_reputation"), dict) else None
        if reg_rep and reg_rep.get("verdict") in ("suspicious", "likely_proxy_service"):
            flags.append("bad_registration_ip")
        if login_rep and login_rep.get("verdict") in ("suspicious", "likely_proxy_service"):
            flags.append("bad_last_login_ip")

        candidates_by_id: Dict[str, Dict[str, Any]] = {}
        reasons_by_id: Dict[str, List[str]] = defaultdict(list)

        def _add_candidate(account: Dict[str, Any], reason: str) -> None:
            aid = account.get("id")
            if not aid or aid == uid:
                return
            if aid not in candidates_by_id:
                candidates_by_id[aid] = account
            reasons_by_id[aid].append(reason)

        for acct in linked:
            _add_candidate(acct, "shared_ip")
        for acct in fp_matches:
            _add_candidate(acct, "shared_fingerprint")
        for other in online_by_ip.get(ipn, []):
            oid = other.get("id")
            if oid and oid != uid:
                oraw = raw_by_id.get(oid) or {}
                _add_candidate(
                    {
                        "id": oid,
                        "username": other.get("username"),
                        "email": oraw.get("email"),
                        "email_before_freed": oraw.get("email_before_freed"),
                        "created_at": oraw.get("created_at"),
                        "is_dead": False,
                        "rank_points": oraw.get("rank_points"),
                        "points": oraw.get("points"),
                        "registration_freed_email_from_user_id": oraw.get("registration_freed_email_from_user_id"),
                    },
                    "same_ip_online",
                )
        for uname in same_fp_online:
            for orow in users:
                if orow.get("username") != uname:
                    continue
                oid = orow.get("id")
                oraw = raw_by_id.get(oid) or {}
                _add_candidate(
                    {
                        "id": oid,
                        "username": uname,
                        "email": oraw.get("email"),
                        "email_before_freed": oraw.get("email_before_freed"),
                        "created_at": oraw.get("created_at"),
                        "is_dead": False,
                        "rank_points": oraw.get("rank_points"),
                        "points": oraw.get("points"),
                        "registration_freed_email_from_user_id": oraw.get("registration_freed_email_from_user_id"),
                    },
                    "same_fingerprint_online",
                )
                break

        likely_real_accounts = _rank_real_account_candidates(
            uid, raw, candidates_by_id, reasons_by_id, online_user_ids=online_user_ids
        )
        top_real = (
            likely_real_accounts[0]
            if likely_real_accounts and int(likely_real_accounts[0].get("confidence_score") or 0) >= 30
            else None
        )
        possible_dupes = _rank_possible_dupes(
            uid, raw, candidates_by_id, reasons_by_id, online_user_ids=online_user_ids
        )

        cluster_role = "unknown"
        if top_real and int(top_real.get("confidence_score") or 0) >= 35:
            sub_created = _parse_created_at(raw.get("created_at"))
            real_created = _parse_created_at(top_real.get("created_at"))
            if sub_created and real_created and sub_created > real_created:
                cluster_role = "possible_alt"
            elif sub_created and real_created and sub_created < real_created:
                cluster_role = "possible_main"
            elif _progression_score(raw) < int(top_real.get("rank_points") or 0) + int(top_real.get("points") or 0) // 10:
                cluster_role = "possible_alt"
            else:
                cluster_role = "possible_main"
        elif possible_dupes:
            cluster_role = "possible_main"

        account_links: List[Dict[str, Any]] = []
        if top_real:
            account_links.append(
                {
                    "role": "likely_real",
                    "username": top_real.get("username"),
                    "id": top_real.get("id"),
                    "confidence": top_real.get("confidence"),
                    "link_reasons": top_real.get("link_reasons"),
                    "why": top_real.get("why_likely_real"),
                }
            )
        for dupe in possible_dupes[:4]:
            account_links.append(
                {
                    "role": "likely_dupe",
                    "username": dupe.get("username"),
                    "id": dupe.get("id"),
                    "confidence": dupe.get("confidence"),
                    "link_reasons": dupe.get("link_reasons"),
                    "why": dupe.get("why_likely_dupe"),
                }
            )

        severity = _severity(
            flags,
            linked_alive=len(linked_alive),
            fp_alive=len(fp_alive),
            same_fp_online=len(same_fp_online),
        )
        summary[severity] = summary.get(severity, 0) + 1
        if severity != "clean":
            summary["flagged"] += 1

        row["screen"] = {
            "severity": severity,
            "flags": flags,
            "current_ip": _ip_public_view(geo, rep) if ipn else None,
            "linked_on_ip": {
                "count": len(linked),
                "alive_count": len(linked_alive),
                "accounts": linked[:8],
            },
            "fingerprint_matches": {
                "count": len(fp_matches),
                "alive_count": len(fp_alive),
                "accounts": fp_matches[:8],
            },
            "same_fingerprint_online": same_fp_online[:8],
            "registration_ip_reputation": reg_rep,
            "last_login_ip_reputation": login_rep,
            "cluster_role": cluster_role,
            "likely_real_account": top_real,
            "likely_real_accounts": likely_real_accounts[:5],
            "possible_dupes": possible_dupes,
            "account_links": account_links,
        }

    return {"users": users, "screen_summary": summary}
