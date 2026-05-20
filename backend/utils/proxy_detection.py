"""
Detect paid proxy / VPN services (ProxyRoyal, IPRoyal, residential rotators, etc.)
for signup protection and staff investigation.

Combines: GetIPIntel ban list, ip-api proxy/hosting flags, known provider org/ISP keywords,
and per-user behavioural signals (IP churn, subnet farming).
"""
from __future__ import annotations

import asyncio
import ipaddress
import re
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

from middleware.security import (
    PROXY_CHECK_CONTACT_EMAIL,
    is_proxy_or_vpn,
    is_proxy_or_vpn_auth_strict,
)
from utils.cheat_detection_utils import user_ip_union
from utils.ip_enrichment import get_or_fetch_ip_geodata, normalize_ip
from utils.referral_ids import normalize_referred_by_ids

_LINK_PROJ = {
    "_id": 0,
    "id": 1,
    "username": 1,
    "email": 1,
    "registration_ip": 1,
    "login_ips": 1,
    "last_login_ip": 1,
    "last_request_ip": 1,
    "sessions": 1,
    "device_fingerprint": 1,
    "referred_by": 1,
    "created_at": 1,
    "is_dead": 1,
    "is_npc": 1,
    "points": 1,
    "last_seen_country": 1,
}

# Substrings matched against ISP + org + AS name (lowercase). Tuned for commercial proxy sellers.
# Matched on ISP/org/AS — blocks signup/login immediately when hit (incl. ProxyRoyal infra labels).
PROXY_PROVIDER_KEYWORDS: Tuple[str, ...] = (
    "proxyroyal",
    "proxy royal",
    "proxy-royal",
    "royal proxy",
    "iproyal",
    "ip royal",
    "bright data",
    "luminati",
    "oxylabs",
    "smartproxy",
    "netnut",
    "packetstream",
    "geonode",
    "webshare",
    "soax",
    "rayobyte",
    "marsproxy",
    "922 proxy",
    "922proxy",
    "plainproxies",
    "ipidea",
    "proxy-seller",
    "proxyseller",
    "shifter",
    "storm proxies",
    "highproxies",
    "proxyrack",
    "proxy-cheap",
    "proxycheap",
    "hydraproxy",
    "floppydata",
    "dataimpulse",
    "infatica",
    "massive proxy",
    "residential proxy",
    "rotating proxy",
    "mobile proxy network",
)

# AS/org hints that are often datacenter / proxy backbones (not home ISPs)
HOSTING_OR_PROXY_AS_HINTS: Tuple[str, ...] = (
    "hosting",
    "server",
    "cloud",
    "vps",
    "datacenter",
    "data center",
    "digitalocean",
    "amazon",
    "google cloud",
    "microsoft corporation",
    "m247",
    "quadranet",
    "choopa",
    "psychz",
)


def _geo_text_blob(geo: Dict[str, Any]) -> str:
    parts = [
        geo.get("isp") or "",
        geo.get("org") or "",
        geo.get("asname") or "",
        geo.get("as_field") or "",
    ]
    return " ".join(str(p) for p in parts).lower()


def match_proxy_provider_keywords(text: str) -> List[str]:
    t = (text or "").lower()
    hits = []
    for kw in PROXY_PROVIDER_KEYWORDS:
        if kw in t:
            hits.append(kw)
    return hits


def classify_ip_reputation(
    geo: Dict[str, Any],
    *,
    getipintel_vpn: bool = False,
) -> Dict[str, Any]:
    """
    Score an IP for staff display and signup policy.
    verdict: clean | suspicious | likely_proxy_service
    """
    reasons: List[str] = []
    risk = 0
    if getipintel_vpn:
        risk += 40
        reasons.append("getipintel_vpn_or_proxy_list")
    if geo.get("proxy"):
        risk += 35
        reasons.append("ip_api_proxy_flag")
    if geo.get("hosting"):
        risk += 28
        reasons.append("ip_api_hosting_datacenter")
    blob = _geo_text_blob(geo)
    kw_hits = match_proxy_provider_keywords(blob)
    if kw_hits:
        risk += 32
        reasons.append(f"commercial_proxy_keyword:{kw_hits[0]}")
    for hint in HOSTING_OR_PROXY_AS_HINTS:
        if hint in blob and "hosting" not in reasons:
            risk += 12
            reasons.append(f"infrastructure_hint:{hint}")
            break
    risk = min(100, risk)
    if risk >= 55 or (getipintel_vpn and geo.get("hosting")):
        verdict = "likely_proxy_service"
    elif risk >= 28:
        verdict = "suspicious"
    else:
        verdict = "clean"
    # Staff field name kept; auth uses block_auth (stricter — catches ProxyRoyal labels ip-api misses).
    block_signup = _compute_block_auth(
        verdict=verdict,
        risk=risk,
        getipintel_vpn=getipintel_vpn,
        ip_api_proxy=bool(geo.get("proxy")),
        ip_api_hosting=bool(geo.get("hosting")),
        provider_keywords=kw_hits,
        getipintel_strict=False,
        subnet_alive_accounts=0,
        purpose="signup",
    )
    return {
        "verdict": verdict,
        "risk_score": risk,
        "reasons": reasons,
        "block_signup": block_signup,
        "block_auth": block_signup,
        "provider_keywords": kw_hits,
        "getipintel_vpn": bool(getipintel_vpn),
        "ip_api_proxy": bool(geo.get("proxy")),
        "ip_api_hosting": bool(geo.get("hosting")),
        "isp": (geo.get("isp") or "").strip() or None,
        "org": (geo.get("org") or "").strip() or None,
        "asname": (geo.get("asname") or geo.get("as_field") or "").strip() or None,
        "country_code": (geo.get("countryCode") or geo.get("country") or "").strip() or None,
        "country": (geo.get("country") or "").strip() or None,
        "geo_ok": bool(geo.get("ok")),
    }


def _compute_block_auth(
    *,
    verdict: str,
    risk: int,
    getipintel_vpn: bool,
    ip_api_proxy: bool,
    ip_api_hosting: bool,
    provider_keywords: List[str],
    getipintel_strict: bool,
    subnet_alive_accounts: int,
    purpose: str,
) -> bool:
    """Signup/login gate — stricter than staff-only review thresholds."""
    if getipintel_vpn or getipintel_strict or ip_api_proxy:
        return True
    if provider_keywords:
        return True
    if verdict == "likely_proxy_service":
        return True
    if verdict == "suspicious" and risk >= 36:
        return True
    if ip_api_hosting and (provider_keywords or getipintel_vpn or ip_api_proxy or risk >= 42):
        return True
    if purpose == "signup":
        if subnet_alive_accounts >= 3:
            return True
        if subnet_alive_accounts >= 2 and risk >= 24:
            return True
    else:
        if subnet_alive_accounts >= 4 and risk >= 28:
            return True
        if subnet_alive_accounts >= 3 and risk >= 32:
            return True
    return False


async def count_alive_accounts_on_subnet24(db, ip: str) -> int:
    """Alive non-NPC accounts with any IP in the same IPv4 /24 (proxy rotators)."""
    sn = _ipv4_subnet24(ip)
    if not sn:
        return 0
    prefix = sn.rsplit("/", 1)[0]
    pat = re.compile(r"^" + re.escape(prefix) + r"\.\d{1,3}$")
    try:
        return await db.users.count_documents(
            {
                "is_npc": {"$ne": True},
                "is_dead": {"$ne": True},
                "$or": [
                    {"registration_ip": pat},
                    {"login_ips": pat},
                    {"last_login_ip": pat},
                ],
            }
        )
    except Exception:
        return 0


async def assess_ip_for_auth(
    db,
    ip: str,
    *,
    purpose: str = "signup",
    check_getipintel: bool = True,
) -> Dict[str, Any]:
    """
    IP check for registration and login when block_proxy_vpn_login is enabled.
    Blocks known VPN lists, ip-api proxy/hosting, commercial seller keywords (ProxyRoyal, etc.),
    and dense /24 account clusters typical of rotating residential proxies.
    """
    rep = await assess_ip(db, ip, check_getipintel=check_getipintel)
    ipn = rep.get("ip") or normalize_ip(ip)
    if not ipn:
        rep["block_auth"] = False
        return rep

    strict_vpn = False
    if check_getipintel and PROXY_CHECK_CONTACT_EMAIL:
        try:
            strict_vpn = await is_proxy_or_vpn_auth_strict(ipn)
        except Exception:
            strict_vpn = False
    if strict_vpn:
        rep["getipintel_strict"] = True
        if "getipintel_auth_strict" not in (rep.get("reasons") or []):
            rep.setdefault("reasons", []).append("getipintel_auth_strict")

    subnet_n = await count_alive_accounts_on_subnet24(db, ipn)
    rep["subnet_alive_accounts"] = subnet_n

    block = _compute_block_auth(
        verdict=rep.get("verdict") or "clean",
        risk=int(rep.get("risk_score") or 0),
        getipintel_vpn=bool(rep.get("getipintel_vpn")),
        ip_api_proxy=bool(rep.get("ip_api_proxy")),
        ip_api_hosting=bool(rep.get("ip_api_hosting")),
        provider_keywords=rep.get("provider_keywords") or [],
        getipintel_strict=strict_vpn,
        subnet_alive_accounts=subnet_n,
        purpose=purpose,
    )
    if block and subnet_n >= 2 and not rep.get("provider_keywords"):
        if purpose == "signup" and subnet_n >= 3:
            rep.setdefault("reasons", []).append(f"subnet24_farm:{subnet_n}_accounts")
        elif purpose == "signup" and subnet_n >= 2:
            rep.setdefault("reasons", []).append(f"subnet24_dense:{subnet_n}_accounts")
        elif purpose != "signup" and subnet_n >= 3:
            rep.setdefault("reasons", []).append(f"subnet24_login_farm:{subnet_n}_accounts")

    rep["block_auth"] = block
    rep["block_signup"] = block
    return rep


async def assess_ip(
    db,
    ip: str,
    *,
    check_getipintel: bool = True,
) -> Dict[str, Any]:
    """Full assessment for one IP (cached geodata + optional GetIPIntel)."""
    ipn = normalize_ip(ip)
    if not ipn:
        return {
            "ip": "",
            "verdict": "clean",
            "risk_score": 0,
            "reasons": [],
            "block_signup": False,
            "block_auth": False,
        }
    geo = await get_or_fetch_ip_geodata(db, ipn)
    vpn = False
    if check_getipintel and PROXY_CHECK_CONTACT_EMAIL:
        try:
            vpn = await is_proxy_or_vpn(ipn)
        except Exception:
            vpn = False
    rep = classify_ip_reputation(geo, getipintel_vpn=vpn)
    rep["ip"] = ipn
    rep["from_cache"] = bool(geo.get("from_cache"))
    rep["block_auth"] = rep.get("block_signup")
    return rep


def _ipv4_subnet24(ip: str) -> Optional[str]:
    try:
        addr = ipaddress.ip_address(normalize_ip(ip))
        if addr.version != 4:
            return None
        net = ipaddress.ip_network(f"{addr}/24", strict=False)
        return str(net)
    except ValueError:
        return None


def analyze_user_proxy_behavior(
    user: Dict[str, Any],
    *,
    include_session_ips: bool = True,
) -> Dict[str, Any]:
    """Behavioural farm signals without extra API calls."""
    ips, sources = user_ip_union(user, include_session_ips=include_session_ips)
    subnets: Set[str] = set()
    for ip in ips:
        s = _ipv4_subnet24(ip)
        if s:
            subnets.add(s)
    distinct_ip_count = len(ips)
    distinct_subnet_count = len(subnets)
    flags: List[str] = []
    risk = 0
    if distinct_ip_count >= 6:
        risk += 25
        flags.append("high_ip_churn")
    elif distinct_ip_count >= 4:
        risk += 12
        flags.append("moderate_ip_churn")
    if distinct_subnet_count >= 4 and distinct_ip_count >= 4:
        risk += 20
        flags.append("many_subnets")
    reg = (sources.get("registration") or "").strip()
    if reg and len(ips) >= 3 and reg not in ips[-2:]:
        risk += 10
        flags.append("registration_ip_no_longer_used")
    return {
        "distinct_ip_count": distinct_ip_count,
        "distinct_subnet24_count": distinct_subnet_count,
        "all_ips": ips,
        "behavior_flags": flags,
        "behavior_risk_score": min(40, risk),
    }


def _add_link(links: Dict[str, Set[str]], uid: str, reason: str) -> None:
    if uid:
        links.setdefault(uid, set()).add(reason)


async def discover_linked_account_ids(
    db,
    seed_user: Dict[str, Any],
    *,
    include_session_ips: bool = True,
    max_linked: int = 60,
) -> Dict[str, List[str]]:
    """Return map user_id -> link reasons (shared IP, fingerprint, subnet, referral)."""
    seed_id = str(seed_user.get("id") or "")
    links: Dict[str, Set[str]] = {}
    ips, _ = user_ip_union(seed_user, include_session_ips=include_session_ips)

    for ip in ips:
        if not ip:
            continue
        q = {
            "id": {"$ne": seed_id},
            "is_npc": {"$ne": True},
            "$or": [
                {"registration_ip": ip},
                {"login_ips": ip},
                {"last_login_ip": ip},
                {"last_request_ip": ip},
            ],
        }
        async for u in db.users.find(q, {"_id": 0, "id": 1}).limit(max_linked):
            _add_link(links, u["id"], f"shared_ip:{ip}")

    fp = (seed_user.get("device_fingerprint") or "").strip()
    if fp:
        async for u in db.users.find(
            {"id": {"$ne": seed_id}, "is_npc": {"$ne": True}, "device_fingerprint": fp},
            {"_id": 0, "id": 1},
        ).limit(max_linked):
            _add_link(links, u["id"], "shared_device_fingerprint")

    reg_ip = normalize_ip(seed_user.get("registration_ip") or "")
    sn = _ipv4_subnet24(reg_ip) if reg_ip else None
    if sn:
        prefix = sn.rsplit("/", 1)[0]
        pat = re.compile(r"^" + re.escape(prefix) + r"\.\d{1,3}$")
        async for u in db.users.find(
            {
                "id": {"$ne": seed_id},
                "is_npc": {"$ne": True},
                "$or": [
                    {"registration_ip": pat},
                    {"login_ips": pat},
                    {"last_login_ip": pat},
                ],
            },
            {"_id": 0, "id": 1},
        ).limit(max_linked):
            _add_link(links, u["id"], f"same_subnet24:{sn}")

    for rid in normalize_referred_by_ids(seed_user.get("referred_by")):
        if rid != seed_id:
            _add_link(links, rid, "seed_was_referred_by")

    async for u in db.users.find(
        {
            "id": {"$ne": seed_id},
            "is_npc": {"$ne": True},
            "$or": [{"referred_by": seed_id}, {"referred_by": {"$in": [seed_id]}}],
        },
        {"_id": 0, "id": 1},
    ).limit(max_linked):
        _add_link(links, u["id"], "referred_by_seed")

    if len(links) > max_linked:
        trimmed = dict(list(links.items())[:max_linked])
        return {k: sorted(v) for k, v in trimmed.items()}
    return {k: sorted(v) for k, v in links.items()}


def _country_from_assessment(a: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    cc = (a.get("country_code") or "").strip().upper() or None
    return cc, cc


async def build_ip_country_account_map(
    db,
    seed_user: Dict[str, Any],
    linked_users: List[Dict[str, Any]],
    ip_assessments: List[Dict[str, Any]],
    *,
    include_session_ips: bool = True,
) -> Dict[str, Any]:
    """Group IPs and accounts by country; tie accounts to IPs they share."""
    ip_assess_by_ip = {a.get("ip"): a for a in ip_assessments if a.get("ip")}
    ip_to_accounts: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    def attach_user(u: Dict[str, Any], ip: str, role: str) -> None:
        uid = u.get("id")
        if not uid:
            return
        entry = {
            "id": uid,
            "username": u.get("username"),
            "email": u.get("email"),
            "is_dead": bool(u.get("is_dead")),
            "role_at_ip": role,
        }
        existing_ids = {x["id"] for x in ip_to_accounts[ip]}
        if uid not in existing_ids:
            ip_to_accounts[ip].append(entry)

    seed_id = seed_user.get("id")
    for ip in ip_assess_by_ip:
        attach_user(seed_user, ip, "seed")

    for u in linked_users:
        u_ips, sources = user_ip_union(u, include_session_ips=include_session_ips)
        for ip in u_ips:
            if ip in ip_assess_by_ip or ip in {a.get("ip") for a in ip_assessments}:
                role = "registration" if sources.get("registration") == ip else "login_or_session"
                attach_user(u, ip, role)

    by_ip: List[Dict[str, Any]] = []
    country_accounts: Dict[str, Set[str]] = defaultdict(set)
    country_ips: Dict[str, Set[str]] = defaultdict(set)

    for ip, accs in sorted(ip_to_accounts.items()):
        a = ip_assess_by_ip.get(ip) or {}
        cc, _ = _country_from_assessment(a)
        if not cc and a.get("geo_ok") is False:
            cc = "?"
        cc_key = cc or "?"
        for ac in accs:
            country_accounts[cc_key].add(ac["id"])
        country_ips[cc_key].add(ip)
        by_ip.append(
            {
                "ip": ip,
                "country_code": cc,
                "verdict": a.get("verdict"),
                "risk_score": a.get("risk_score"),
                "isp": a.get("isp"),
                "accounts": accs,
            }
        )

    id_to_user = {seed_user["id"]: seed_user}
    for u in linked_users:
        id_to_user[u["id"]] = u

    by_country: List[Dict[str, Any]] = []
    for cc in sorted(country_accounts.keys()):
        acc_rows = []
        for uid in country_accounts[cc]:
            u = id_to_user.get(uid) or {}
            acc_rows.append(
                {
                    "id": uid,
                    "username": u.get("username"),
                    "email": u.get("email"),
                    "is_dead": bool(u.get("is_dead")),
                    "registration_ip": u.get("registration_ip"),
                }
            )
        by_country.append(
            {
                "country_code": None if cc == "?" else cc,
                "account_count": len(acc_rows),
                "ip_count": len(country_ips[cc]),
                "ips": sorted(country_ips[cc])[:30],
                "accounts": sorted(acc_rows, key=lambda x: (x.get("username") or "").lower()),
            }
        )

    return {"by_ip": by_ip, "by_country": by_country}


async def cluster_points_activity(
    db,
    cluster_ids: List[str],
    *,
    transfer_limit: int = 80,
    ledger_limit: int = 120,
) -> Dict[str, Any]:
    """Points sent/received between accounts in the linked cluster."""
    ids = [str(x) for x in cluster_ids if x]
    if not ids:
        return {
            "transfers": [],
            "per_user": [],
            "totals": {"transfer_count": 0, "points_moved": 0},
        }
    id_set = set(ids)

    transfers = (
        await db.points_transfers.find(
            {
                "from_user_id": {"$in": ids},
                "to_user_id": {"$in": ids},
            },
            {
                "_id": 0,
                "id": 1,
                "from_user_id": 1,
                "from_username": 1,
                "to_user_id": 1,
                "to_username": 1,
                "amount": 1,
                "created_at": 1,
            },
        )
        .sort("created_at", -1)
        .limit(int(transfer_limit))
        .to_list(int(transfer_limit))
    )

    received: Dict[str, int] = defaultdict(int)
    sent: Dict[str, int] = defaultdict(int)
    received_from: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    sent_to: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for t in transfers:
        amt = int(t.get("amount") or 0)
        fid = t.get("from_user_id")
        tid = t.get("to_user_id")
        if fid in id_set:
            sent[fid] += amt
            sent_to[fid][tid] += amt
        if tid in id_set:
            received[tid] += amt
            received_from[tid][fid] += amt

    ledger_rows = (
        await db.point_ledger_events.find(
            {
                "user_id": {"$in": ids},
                "event_type": {"$in": ["transfer_in", "transfer_out"]},
            },
            {"_id": 0, "user_id": 1, "event_type": 1, "points": 1, "created_at": 1, "meta": 1, "origin_ref": 1},
        )
        .sort("created_at", -1)
        .limit(int(ledger_limit))
        .to_list(int(ledger_limit))
    )
    ledger_cluster: List[Dict[str, Any]] = []
    for row in ledger_rows:
        meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
        other = meta.get("to_user_id") or meta.get("from_user_id")
        if other and str(other) in id_set:
            ledger_cluster.append(
                {
                    "user_id": row.get("user_id"),
                    "event_type": row.get("event_type"),
                    "points": int(row.get("points") or 0),
                    "created_at": row.get("created_at"),
                    "counterparty_id": str(other),
                    "transfer_id": row.get("origin_ref"),
                }
            )

    users_brief = await db.users.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "username": 1, "points": 1, "is_dead": 1},
    ).to_list(len(ids))
    uname_by_id = {u["id"]: u.get("username") for u in users_brief}

    per_user: List[Dict[str, Any]] = []
    for uid in ids:
        recv_detail = [
            {
                "from_user_id": fid,
                "from_username": uname_by_id.get(fid),
                "total_points": tot,
            }
            for fid, tot in sorted((received_from.get(uid) or {}).items(), key=lambda x: -x[1])
        ]
        sent_detail = [
            {
                "to_user_id": tid,
                "to_username": uname_by_id.get(tid),
                "total_points": tot,
            }
            for tid, tot in sorted((sent_to.get(uid) or {}).items(), key=lambda x: -x[1])
        ]
        per_user.append(
            {
                "user_id": uid,
                "username": uname_by_id.get(uid),
                "points_received_in_cluster": int(received.get(uid) or 0),
                "points_sent_in_cluster": int(sent.get(uid) or 0),
                "received_from": recv_detail,
                "sent_to": sent_detail,
            }
        )
    per_user.sort(key=lambda x: (-(x.get("points_received_in_cluster") or 0), x.get("username") or ""))

    total_pts = sum(int(t.get("amount") or 0) for t in transfers)
    return {
        "transfers": transfers,
        "ledger_between_cluster": ledger_cluster,
        "per_user": per_user,
        "totals": {
            "transfer_count": len(transfers),
            "points_moved": total_pts,
            "accounts_in_cluster": len(ids),
        },
    }


async def enrich_linked_accounts(
    db,
    seed_user: Dict[str, Any],
    link_map: Dict[str, List[str]],
    ip_assessments: Optional[List[Dict[str, Any]]] = None,
    *,
    include_session_ips: bool = True,
) -> List[Dict[str, Any]]:
    """Load full user rows; registration country from IP assessments when available."""
    if not link_map:
        return []
    assess_by_ip = {a.get("ip"): a for a in (ip_assessments or []) if a.get("ip")}
    ids = list(link_map.keys())
    users = await db.users.find({"id": {"$in": ids}}, _LINK_PROJ).to_list(len(ids))
    out: List[Dict[str, Any]] = []
    for u in users:
        uid = u["id"]
        reg_ip = normalize_ip(u.get("registration_ip") or "")
        reg_cc = (assess_by_ip.get(reg_ip) or {}).get("country_code") or u.get("last_seen_country")
        u_ips, _ = user_ip_union(u, include_session_ips=include_session_ips)
        out.append(
            {
                "id": uid,
                "username": u.get("username"),
                "email": u.get("email"),
                "is_dead": bool(u.get("is_dead")),
                "points": int(u.get("points") or 0),
                "registration_ip": u.get("registration_ip"),
                "registration_country": reg_cc,
                "last_seen_country": u.get("last_seen_country"),
                "created_at": u.get("created_at"),
                "device_fingerprint": (u.get("device_fingerprint") or "")[:24] or None,
                "link_reasons": link_map.get(uid, []),
                "distinct_ip_count": len(u_ips),
                "is_seed": uid == seed_user.get("id"),
            }
        )
    out.sort(key=lambda x: (not x.get("is_seed"), -len(x.get("link_reasons") or []), x.get("username") or ""))
    return out


async def assess_user_proxy_profile(
    db,
    user: Dict[str, Any],
    *,
    max_ip_lookups: int = 25,
    check_getipintel: bool = True,
    include_session_ips: bool = True,
    max_linked: int = 60,
) -> Dict[str, Any]:
    """Per-user report for staff: IPs, countries, all linked accounts, points flows."""
    uid = user.get("id")
    uname = user.get("username")
    behavior = analyze_user_proxy_behavior(user, include_session_ips=include_session_ips)
    ips = behavior["all_ips"][: max(1, int(max_ip_lookups))]
    ip_assessments: List[Dict[str, Any]] = []
    worst_verdict = "clean"
    worst_score = 0
    for ip in ips:
        one = await assess_ip(db, ip, check_getipintel=check_getipintel)
        ip_assessments.append(one)
        if one.get("risk_score", 0) > worst_score:
            worst_score = int(one["risk_score"])
            worst_verdict = one.get("verdict") or "clean"
    reg_ip = normalize_ip(user.get("registration_ip") or "")
    reg_rep = next((a for a in ip_assessments if a.get("ip") == reg_ip), None)
    if reg_ip and not reg_rep:
        reg_rep = await assess_ip(db, reg_ip, check_getipintel=check_getipintel)
        ip_assessments.insert(0, reg_rep)

    link_map = await discover_linked_account_ids(
        db, user, include_session_ips=include_session_ips, max_linked=max_linked
    )
    linked_accounts = await enrich_linked_accounts(
        db, user, link_map, ip_assessments, include_session_ips=include_session_ips
    )
    cluster_ids = [uid] + list(link_map.keys())
    countries_map = await build_ip_country_account_map(
        db, user, linked_accounts, ip_assessments, include_session_ips=include_session_ips
    )
    points_cluster = await cluster_points_activity(db, cluster_ids)

    subnet_peers = [a for a in linked_accounts if any(r.startswith("same_subnet24:") for r in (a.get("link_reasons") or []))]

    combined_risk = min(
        100,
        worst_score
        + int(behavior.get("behavior_risk_score") or 0)
        + (15 if len(linked_accounts) >= 2 else 0)
        + (10 if (points_cluster.get("totals") or {}).get("transfer_count", 0) >= 3 else 0),
    )
    likely_farm = (
        worst_verdict == "likely_proxy_service"
        or (reg_rep and reg_rep.get("block_auth"))
        or (len(linked_accounts) >= 2 and worst_score >= 28)
        or (behavior.get("behavior_flags") and worst_score >= 40)
        or (
            len(linked_accounts) >= 2
            and (points_cluster.get("totals") or {}).get("points_moved", 0) >= 5000
        )
    )
    seed_points_row = next((p for p in points_cluster.get("per_user") or [] if p.get("user_id") == uid), None)
    seed_row = {
        "id": uid,
        "username": uname,
        "email": user.get("email"),
        "is_dead": bool(user.get("is_dead")),
        "points": int(user.get("points") or 0),
        "registration_ip": user.get("registration_ip"),
        "registration_country": (reg_rep or {}).get("country_code"),
        "last_seen_country": user.get("last_seen_country"),
        "created_at": user.get("created_at"),
        "device_fingerprint": (user.get("device_fingerprint") or "")[:24] or None,
        "link_reasons": ["subject"],
        "distinct_ip_count": behavior.get("distinct_ip_count"),
        "is_seed": True,
    }
    linked_display = [seed_row] + linked_accounts
    return {
        "user": {
            "id": uid,
            "username": uname,
            "email": user.get("email"),
            "points": int(user.get("points") or 0),
            "registration_country": (reg_rep or {}).get("country_code"),
        },
        "likely_proxy_farm": likely_farm,
        "combined_risk_score": combined_risk,
        "worst_ip_verdict": worst_verdict,
        "registration_ip_assessment": reg_rep,
        "ip_assessments": ip_assessments,
        "behavior": behavior,
        "countries": countries_map,
        "linked_accounts": linked_display,
        "linked_account_count": len(linked_display),
        "subnet24_peers": subnet_peers[:20],
        "subnet_peer_count": len(subnet_peers),
        "points_in_cluster": points_cluster,
        "seed_points_summary": seed_points_row,
        "getipintel_configured": bool(PROXY_CHECK_CONTACT_EMAIL),
        "note": (
            "Residential rotators (e.g. ProxyRoyal) may look like normal ISPs; combine keyword hits, "
            "GetIPIntel, IP churn, linked accounts, and points sent between cluster members. "
            "Consumer CGNAT can false-positive on shared IP alone."
        ),
    }


async def find_proxy_farm_hotspots(
    db,
    *,
    days: int = 30,
    min_accounts_per_subnet: int = 3,
    limit_subnets: int = 25,
    sample_ips_per_subnet: int = 1,
) -> Dict[str, Any]:
    """Global scan: /24 registration subnets with multiple alive accounts."""
    since = datetime.now(timezone.utc) - timedelta(days=int(days))
    since_iso = since.isoformat()
    users = await db.users.find(
        {
            "is_npc": {"$ne": True},
            "is_dead": {"$ne": True},
            "registration_ip": {"$exists": True, "$nin": [None, ""]},
            "created_at": {"$gte": since_iso},
        },
        {"_id": 0, "id": 1, "username": 1, "registration_ip": 1, "created_at": 1},
    ).to_list(8000)
    subnet_to_users: Dict[str, List[dict]] = {}
    for u in users:
        sn = _ipv4_subnet24(u.get("registration_ip") or "")
        if not sn:
            continue
        subnet_to_users.setdefault(sn, []).append(u)
    hotspots = []
    for sn, accs in subnet_to_users.items():
        if len(accs) < min_accounts_per_subnet:
            continue
        sample_ip = normalize_ip(accs[0].get("registration_ip") or "")
        rep = await assess_ip(db, sample_ip, check_getipintel=True) if sample_ip else {}
        hotspots.append(
            {
                "subnet24": sn,
                "account_count": len(accs),
                "sample_ip": sample_ip,
                "sample_assessment": rep,
                "accounts": accs[:15],
            }
        )
    hotspots.sort(key=lambda h: (-h["account_count"], -(h.get("sample_assessment") or {}).get("risk_score", 0)))
    return {
        "days": int(days),
        "min_accounts_per_subnet": min_accounts_per_subnet,
        "hotspots": hotspots[:limit_subnets],
        "total_hotspots": len(hotspots),
        "users_scanned": len(users),
    }
