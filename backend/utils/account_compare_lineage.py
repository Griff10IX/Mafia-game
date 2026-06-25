"""Email-lineage discovery and cross-cluster signals for account compare."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Set

from utils.ip_enrichment import normalize_ip
from utils.staff_email_history import _clean_email, is_tomb_email

LINEAGE_USER_PROJ = {
    "_id": 0,
    "id": 1,
    "username": 1,
    "email": 1,
    "email_before_freed": 1,
    "registration_freed_email_from_user_id": 1,
    "email_freed_at": 1,
    "created_at": 1,
    "dead_at": 1,
    "is_dead": 1,
    "device_fingerprint": 1,
    "registration_ip": 1,
    "last_login_ip": 1,
    "last_request_ip": 1,
    "login_ips": 1,
    "login_history": 1,
    "sessions": 1,
}

_MAX_LINEAGE_ACCOUNTS = 15
_MAX_CROSS_MATCHES = 40


def _lineage_emails(user: Dict[str, Any]) -> Set[str]:
    out: Set[str] = set()
    for raw in (user.get("email"), user.get("email_before_freed")):
        em = _clean_email(raw)
        if em:
            out.add(em)
    return out


def _profile_ip_set(user: Dict[str, Any]) -> Set[str]:
    ips: Set[str] = set()

    def add(raw: Any) -> None:
        ipn = normalize_ip(str(raw) if raw is not None else "")
        if ipn:
            ips.add(ipn)

    add(user.get("registration_ip"))
    add(user.get("last_login_ip"))
    add(user.get("last_request_ip"))
    for ip in user.get("login_ips") or []:
        add(ip)
    for h in user.get("login_history") or []:
        if isinstance(h, dict):
            add(h.get("ip"))
    for s in user.get("sessions") or []:
        if isinstance(s, dict):
            add(s.get("ip"))
    return ips


def _relation_label(user: Dict[str, Any], primary: Dict[str, Any], cluster_emails: Set[str]) -> str:
    uid = user.get("id")
    primary_id = primary.get("id")
    if uid == primary_id:
        return "primary"
    freed_from = (user.get("registration_freed_email_from_user_id") or "").strip()
    if freed_from and freed_from == primary_id:
        return "replacement_registration"
    if freed_from:
        return "replacement_registration"
    if user.get("is_dead"):
        if _clean_email(user.get("email_before_freed")) in cluster_emails:
            return "prior_dead_account"
        return "dead_account"
    em = _clean_email(user.get("email"))
    if em and em in cluster_emails:
        return "same_email_chain"
    if _clean_email(user.get("email_before_freed")) in cluster_emails:
        return "prior_email_on_chain"
    return "linked_account"


def lineage_account_snapshot(user: Dict[str, Any], relation: str) -> Dict[str, Any]:
    em = (user.get("email") or "").strip()
    prior = _clean_email(user.get("email_before_freed"))
    return {
        "id": user.get("id"),
        "username": user.get("username"),
        "relation": relation,
        "is_dead": bool(user.get("is_dead")),
        "created_at": user.get("created_at"),
        "dead_at": user.get("dead_at"),
        "email_is_tomb": is_tomb_email(em),
        "has_prior_email": bool(prior),
        "prior_email_hint": "stored" if prior else None,
        "registration_freed_from_user_id": user.get("registration_freed_email_from_user_id"),
        "device_fingerprint": user.get("device_fingerprint"),
        "registration_ip": normalize_ip(user.get("registration_ip")) or None,
        "last_login_ip": normalize_ip(user.get("last_login_ip")) or None,
        "profile_ip_count": len(_profile_ip_set(user)),
    }


async def collect_email_lineage_accounts(
    db,
    seed_user: Dict[str, Any],
    *,
    limit: int = _MAX_LINEAGE_ACCOUNTS,
) -> Dict[str, Any]:
    """Find prior/replacement accounts on the same email chain as seed_user."""
    primary_id = seed_user.get("id")
    if not primary_id:
        return {
            "primary_id": None,
            "primary_username": seed_user.get("username"),
            "email_chain_count": 0,
            "related_accounts": [],
        }

    found: Dict[str, Dict[str, Any]] = {primary_id: seed_user}
    emails = _lineage_emails(seed_user)

    for _ in range(4):
        if len(found) >= limit:
            break
        ids = list(found.keys())
        or_clauses: List[Dict[str, Any]] = []
        if emails:
            email_list = sorted(emails)
            or_clauses.append({"email": {"$in": email_list}})
            or_clauses.append({"email_before_freed": {"$in": email_list}})
        if ids:
            or_clauses.append({"registration_freed_email_from_user_id": {"$in": ids}})
        if not or_clauses:
            break
        q: Dict[str, Any] = {
            "is_npc": {"$ne": True},
            "id": {"$nin": list(found.keys())},
            "$or": or_clauses,
        }
        rows = await db.users.find(q, LINEAGE_USER_PROJ).limit(max(1, limit - len(found))).to_list(limit)
        if not rows:
            break
        for row in rows:
            rid = row.get("id")
            if not rid or rid in found:
                continue
            found[rid] = row
            emails |= _lineage_emails(row)
        if len(rows) == 0:
            break

    related: List[Dict[str, Any]] = []
    for uid, user in found.items():
        rel = _relation_label(user, seed_user, emails)
        snap = lineage_account_snapshot(user, rel)
        snap["is_primary"] = uid == primary_id
        related.append(snap)
    related.sort(key=lambda r: (not r.get("is_primary"), r.get("is_dead"), r.get("created_at") or ""))

    return {
        "primary_id": primary_id,
        "primary_username": seed_user.get("username"),
        "email_chain_count": len(emails),
        "related_accounts": related,
        "prior_account_count": sum(1 for r in related if r.get("id") != primary_id),
    }


def _pair_match(
    user_a: Dict[str, Any],
    user_b: Dict[str, Any],
    *,
    cross: bool,
) -> Optional[Dict[str, Any]]:
    if user_a.get("id") == user_b.get("id"):
        return None
    ips_a = _profile_ip_set(user_a)
    ips_b = _profile_ip_set(user_b)
    shared_ips = sorted(ips_a & ips_b)
    fp_a = (user_a.get("device_fingerprint") or "").strip()
    fp_b = (user_b.get("device_fingerprint") or "").strip()
    same_fp = bool(fp_a and fp_b and fp_a == fp_b)
    if not shared_ips and not same_fp:
        return None
    severity = "critical" if same_fp else ("warn" if shared_ips else "info")
    return {
        "account_a": {
            "id": user_a.get("id"),
            "username": user_a.get("username"),
            "is_dead": bool(user_a.get("is_dead")),
        },
        "account_b": {
            "id": user_b.get("id"),
            "username": user_b.get("username"),
            "is_dead": bool(user_b.get("is_dead")),
        },
        "shared_ips": shared_ips,
        "shared_ip_count": len(shared_ips),
        "same_device_fingerprint": same_fp,
        "cross_lineage": cross,
        "severity": severity,
    }


def _internal_pair_matches(users: List[Dict[str, Any]], *, cross: bool) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for i, ua in enumerate(users):
        for ub in users[i + 1 :]:
            row = _pair_match(ua, ub, cross=cross)
            if row:
                out.append(row)
    return out


def _cross_cluster_matches(users_a: List[Dict[str, Any]], users_b: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for ua in users_a:
        for ub in users_b:
            row = _pair_match(ua, ub, cross=True)
            if row:
                out.append(row)
    out.sort(key=lambda r: (0 if r.get("same_device_fingerprint") else 1, -int(r.get("shared_ip_count") or 0)))
    return out[:_MAX_CROSS_MATCHES]


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


async def _lineage_bilateral_transfers(
    collection,
    ids_a: List[str],
    ids_b: List[str],
    *,
    days: int,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    if not ids_a or not ids_b:
        return []
    since = datetime.now(timezone.utc) - timedelta(days=int(days))
    q = {
        "$or": [
            {"from_user_id": {"$in": ids_a}, "to_user_id": {"$in": ids_b}},
            {"from_user_id": {"$in": ids_b}, "to_user_id": {"$in": ids_a}},
        ],
        "created_at": {"$gte": since},
    }
    rows = await collection.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return rows


async def build_account_compare_lineage(
    db,
    primary_a: Dict[str, Any],
    primary_b: Dict[str, Any],
    *,
    days: int = 90,
    actor: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Discover email-lineage clusters and cross-signals between them."""
    lineage_a = await collect_email_lineage_accounts(db, primary_a)
    lineage_b = await collect_email_lineage_accounts(db, primary_b)

    ids_a = [r.get("id") for r in lineage_a.get("related_accounts") or [] if r.get("id")]
    ids_b = [r.get("id") for r in lineage_b.get("related_accounts") or [] if r.get("id")]
    users_by_id: Dict[str, Dict[str, Any]] = {}
    if ids_a or ids_b:
        all_ids = list(dict.fromkeys(ids_a + ids_b))
        rows = await db.users.find({"id": {"$in": all_ids}}, LINEAGE_USER_PROJ).to_list(len(all_ids) or 1)
        users_by_id = {r["id"]: r for r in rows if r.get("id")}

    users_a = [users_by_id[i] for i in ids_a if i in users_by_id]
    users_b = [users_by_id[i] for i in ids_b if i in users_by_id]

    internal_a = _internal_pair_matches(users_a, cross=False)
    internal_b = _internal_pair_matches(users_b, cross=False)
    cross_matches = _cross_cluster_matches(users_a, users_b)

    money_rows = await _lineage_bilateral_transfers(db.money_transfers, ids_a, ids_b, days=days, limit=40)
    points_rows = await _lineage_bilateral_transfers(db.points_transfers, ids_a, ids_b, days=days, limit=40)

    payload = {
        "lineage": {
            "a": lineage_a,
            "b": lineage_b,
        },
        "lineage_internal_matches": {
            "a": internal_a,
            "b": internal_b,
        },
        "lineage_cross_matches": cross_matches,
        "lineage_transfers": {
            "money_transfers": money_rows,
            "points_transfers": points_rows,
        },
        "lineage_summary": {
            "a_related_count": lineage_a.get("prior_account_count") or 0,
            "b_related_count": lineage_b.get("prior_account_count") or 0,
            "internal_match_count_a": len(internal_a),
            "internal_match_count_b": len(internal_b),
            "cross_match_count": len(cross_matches),
            "cross_shared_ip_pairs": sum(1 for r in cross_matches if int(r.get("shared_ip_count") or 0) > 0),
            "cross_same_fingerprint_pairs": sum(1 for r in cross_matches if r.get("same_device_fingerprint")),
            "lineage_money_transfer_count": len(money_rows),
            "lineage_points_transfer_count": len(points_rows),
        },
    }
    return _sanitize_lineage_for_actor(payload, actor)


def _user_hidden_from_mod(user_ref: Optional[Dict[str, Any]], users_by_id: Dict[str, Dict[str, Any]]) -> bool:
    from utils.staff_mod_protection import account_hidden_from_mod_investigation_links

    if not user_ref:
        return False
    uid = user_ref.get("id")
    full = users_by_id.get(uid) if uid else None
    if full:
        return account_hidden_from_mod_investigation_links(full)
    return account_hidden_from_mod_investigation_links(user_ref)


def _sanitize_lineage_for_actor(payload: Dict[str, Any], actor: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    from utils.staff_mod_protection import actor_has_full_admin_powers, account_hidden_from_mod_investigation_links

    if actor_has_full_admin_powers(actor):
        return payload

    users_by_id: Dict[str, Dict[str, Any]] = {}
    for side in ("a", "b"):
        cluster = (payload.get("lineage") or {}).get(side) or {}
        for acc in cluster.get("related_accounts") or []:
            uid = acc.get("id")
            if uid:
                users_by_id[uid] = acc

    def filter_match_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        kept: List[Dict[str, Any]] = []
        for row in rows or []:
            if _user_hidden_from_mod(row.get("account_a"), users_by_id):
                continue
            if _user_hidden_from_mod(row.get("account_b"), users_by_id):
                continue
            kept.append(row)
        return kept

    out = dict(payload)
    lineage = dict(out.get("lineage") or {})
    for side in ("a", "b"):
        cluster = dict(lineage.get(side) or {})
        related = [
            r for r in (cluster.get("related_accounts") or [])
            if not account_hidden_from_mod_investigation_links(r)
        ]
        cluster["related_accounts"] = related
        cluster["prior_account_count"] = sum(1 for r in related if not r.get("is_primary"))
        lineage[side] = cluster
    out["lineage"] = lineage

    internal = dict(out.get("lineage_internal_matches") or {})
    out["lineage_internal_matches"] = {
        "a": filter_match_rows(internal.get("a") or []),
        "b": filter_match_rows(internal.get("b") or []),
    }
    out["lineage_cross_matches"] = filter_match_rows(out.get("lineage_cross_matches") or [])
    return out
