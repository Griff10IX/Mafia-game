# Cheat detection utilities: shared logic for dupe check and duplicate suspects
import re
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Dict, List, Tuple, Any, Optional, Set
import ipaddress

# Common email domains: exclude from domain-based dupe grouping (too many unrelated users)
COMMON_EMAIL_DOMAINS = frozenset({
    "gmail.com", "googlemail.com", "google.com",
    "icloud.com", "me.com", "mac.com",
    "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "live.co.uk", "msn.com",
    "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de",
    "aol.com", "protonmail.com", "proton.me", "mail.com",
    "ymail.com", "mail.ru", "yandex.com", "yandex.ru",
})


def _email_local_base(local: str) -> str:
    """Normalize email local part: lowercase, strip +suffix, remove digits for grouping."""
    s = (local or "").split("+")[0].strip().lower()
    return re.sub(r"\d+", "", s) or s


def group_by_domain(users: List[dict], exclude_common_domains: bool = True) -> List[dict]:
    """Group users by email domain. Returns groups with at least 2 accounts.
    When exclude_common_domains=True, skips gmail.com, icloud.com, outlook.com, etc. (too many unrelated users)."""
    domain_to_users: Dict[str, List[dict]] = {}
    for u in users:
        email = (u.get("email") or "").strip()
        if "@" in email:
            domain = email.split("@")[-1].lower()
            domain_to_users.setdefault(domain, []).append(u)
    groups = [{"domain": d, "count": len(accs), "accounts": accs} for d, accs in domain_to_users.items() if len(accs) >= 2]
    if exclude_common_domains:
        groups = [g for g in groups if g["domain"] not in COMMON_EMAIL_DOMAINS]
    groups.sort(key=lambda g: -g["count"])
    return groups


def group_by_similar_username_strip_digits(users: List[dict]) -> List[dict]:
    """Group users by username with digits stripped (e.g. user1, user2 -> user)."""
    base_to_users: Dict[str, List[dict]] = {}
    for u in users:
        uname = (u.get("username") or "").strip()
        base = re.sub(r"\d+", "", uname).lower() or uname.lower()
        if len(base) >= 2:
            base_to_users.setdefault(base, []).append(u)
    groups = [{"base": b, "count": len(accs), "accounts": accs} for b, accs in base_to_users.items() if len(accs) >= 2]
    groups.sort(key=lambda g: -g["count"])
    return groups


def _username_similarity(a: str, b: str) -> float:
    """Return similarity ratio 0-1 using SequenceMatcher."""
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def group_by_fuzzy_username(users: List[dict], min_ratio: float = 0.8) -> List[dict]:
    """Group users by fuzzy username similarity (e.g. Player123 vs Player124)."""
    usernames = [(u.get("username") or "").strip() for u in users]
    # Build groups: users with similar usernames
    groups: List[dict] = []
    used = set()  # user_id -> avoid adding to multiple groups

    for i, u in enumerate(users):
        uid = u.get("id")
        if uid in used:
            continue
        uname = usernames[i]
        if len(uname) < 2:
            continue
        cluster = [u]
        used.add(uid)
        for j, u2 in enumerate(users):
            if i >= j or u2.get("id") in used:
                continue
            uname2 = usernames[j]
            if len(uname2) < 2:
                continue
            if _username_similarity(uname, uname2) >= min_ratio:
                cluster.append(u2)
                used.add(u2.get("id"))
        if len(cluster) >= 2:
            groups.append({
                "base": uname[:30],
                "count": len(cluster),
                "accounts": cluster,
                "similarity_type": "fuzzy",
            })
    groups.sort(key=lambda g: -g["count"])
    return groups


def group_by_similar_email(users: List[dict]) -> List[dict]:
    """Group users by similar email (local base + domain)."""
    similar_email_to_users: Dict[Tuple[str, str], List[dict]] = {}
    for u in users:
        email = (u.get("email") or "").strip()
        if "@" in email:
            local, domain = email.rsplit("@", 1)
            domain = domain.lower()
            key = (_email_local_base(local), domain)
            similar_email_to_users.setdefault(key, []).append(u)
    groups = [
        {"local_base": k[0], "domain": k[1], "count": len(accs), "accounts": accs}
        for k, accs in similar_email_to_users.items()
        if len(accs) >= 2
    ]
    groups.sort(key=lambda g: -g["count"])
    return groups


def user_ip_union(u: dict, include_session_ips: bool = False) -> Tuple[List[str], Dict[str, Any]]:
    """Union of IPs for a user: registration, login history, last request/login, optional JWT session IPs."""
    reg = (u.get("registration_ip") or "").strip()
    last_login = (u.get("last_login_ip") or "").strip()
    last_req = (u.get("last_request_ip") or "").strip()
    logins = [(x or "").strip() for x in (u.get("login_ips") or []) if (x or "").strip()]
    ips: Set[str] = set()
    if reg:
        ips.add(reg)
    if last_login:
        ips.add(last_login)
    if last_req:
        ips.add(last_req)
    ips.update(logins)
    session_ips: List[str] = []
    if include_session_ips:
        for s in u.get("sessions") or []:
            if not isinstance(s, dict):
                continue
            sip = (s.get("ip") or "").strip()
            if sip:
                ips.add(sip)
                session_ips.append(sip)
    sources: Dict[str, Any] = {
        "registration": reg or None,
        "login_ips": logins,
        "last_login_ip": last_login or None,
        "last_request_ip": last_req or None,
    }
    if include_session_ips:
        sources["session_ips"] = session_ips
    return sorted(ips), sources


def _parse_user_created_at(u: dict) -> Optional[datetime]:
    c = u.get("created_at")
    if isinstance(c, datetime):
        return c if c.tzinfo else c.replace(tzinfo=timezone.utc)
    if isinstance(c, str) and c.strip():
        try:
            return datetime.fromisoformat(c.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def group_by_registration_ip_burst(users: List[dict], max_hours: float = 2.0) -> List[dict]:
    """Multiple registrations from the same registration_ip within a fixed time window (bucketed by max_hours)."""
    if max_hours <= 0:
        max_hours = 2.0
    span_sec = int(max_hours * 3600)
    key_to_users: Dict[Tuple[str, int], List[dict]] = {}
    for u in users:
        reg_ip = (u.get("registration_ip") or "").strip()
        if not reg_ip:
            continue
        dt = _parse_user_created_at(u)
        if not dt:
            continue
        b = int(dt.timestamp() // span_sec)
        key = (reg_ip, b)
        key_to_users.setdefault(key, []).append(u)
    groups = []
    for (reg_ip, b), accs in key_to_users.items():
        if len(accs) < 2:
            continue
        groups.append({
            "registration_ip": reg_ip,
            "time_bucket": b,
            "count": len(accs),
            "accounts": accs,
        })
    groups.sort(key=lambda g: (-g["count"], g["registration_ip"]))
    return groups


def group_by_referral_same_ip(users: List[dict]) -> List[dict]:
    """Living accounts sharing a referrer + registration_ip (≥2 accounts). Supports referred_by string or list."""
    from utils.referral_ids import normalize_referred_by_ids

    key_to_users: Dict[Tuple[Any, str], List[dict]] = {}
    for u in users:
        reg_ip = (u.get("registration_ip") or "").strip()
        if not reg_ip:
            continue
        for ref in normalize_referred_by_ids(u.get("referred_by")):
            key = (ref, reg_ip)
            key_to_users.setdefault(key, []).append(u)
    groups = []
    for (ref_id, reg_ip), accs in key_to_users.items():
        if len(accs) < 2:
            continue
        groups.append({
            "referred_by": ref_id,
            "registration_ip": reg_ip,
            "count": len(accs),
            "accounts": accs,
        })
    groups.sort(key=lambda g: -g["count"])
    return groups


def group_by_same_day_same_ip(users: List[dict]) -> List[dict]:
    """Group users by registration IP + created_at day."""
    same_day_ip_to_users: Dict[Tuple[str, str], List[dict]] = {}
    for u in users:
        reg_ip = (u.get("registration_ip") or "").strip()
        created = u.get("created_at") or ""
        if reg_ip and created:
            day = created[:10] if isinstance(created, str) else (created.isoformat()[:10] if hasattr(created, "isoformat") else "")
            if day:
                same_day_ip_to_users.setdefault((reg_ip, day), []).append(u)
    groups = [
        {"registration_ip": k[0], "created_day": k[1], "count": len(accs), "accounts": accs}
        for k, accs in same_day_ip_to_users.items()
        if len(accs) >= 2
    ]
    groups.sort(key=lambda g: -g["count"])
    return groups


def _ip_to_subnet(ip_str: str) -> Optional[str]:
    """Return /24 subnet for IPv4, or None for invalid/private."""
    try:
        ip = ipaddress.ip_address(ip_str.strip())
        if ip.version != 4:
            return None
        # Get /24 network
        network = ipaddress.ip_network(f"{ip_str}/24", strict=False)
        return str(network.network_address)
    except Exception:
        return None


def group_by_same_subnet(users: List[dict], min_accounts: int = 2, include_session_ips: bool = False) -> List[dict]:
    """Group users by /24 IPv4 subnet (e.g. 192.168.1.x). Lower risk than exact IP."""
    subnet_to_accounts: Dict[str, Dict[str, dict]] = {}  # subnet -> {user_id: summary}
    for u in users:
        ips, _ = user_ip_union(u, include_session_ips=include_session_ips)
        uid = u.get("id")
        if not uid:
            continue
        summary = {
            "id": uid,
            "username": u.get("username"),
            "email": u.get("email"),
            "created_at": u.get("created_at"),
            "all_ips": ips,
        }
        for ip in ips:
            subnet = _ip_to_subnet(ip)
            if subnet:
                subnet_to_accounts.setdefault(subnet, {})[uid] = summary

    groups = []
    for subnet, by_user in subnet_to_accounts.items():
        if len(by_user) < min_accounts:
            continue
        groups.append({
            "subnet": subnet,
            "count": len(by_user),
            "accounts": list(by_user.values()),
            "risk": "medium",
            "risk_score": 50,
        })
    groups.sort(key=lambda g: (-g["count"], -g["risk_score"]))
    return groups


def compute_dupe_risk_score(
    group_type: str,
    count: int,
    has_registration_ip: bool = False,
    has_vpn: bool = False,
    has_same_device: bool = False,
) -> int:
    """
    Compute risk score 0-100 for a dupe group.
    group_type: same_ip, same_subnet, same_ua, domain, similar_username, similar_email, same_day_ip,
    dead_ip_overlap, dead_fingerprint_overlap, suspicious_ip, registration_burst, referral_same_ip,
    heavy_transfers, prereg_ip_cross, security_flag_user, password_reset_heavy.
    """
    base = 0
    if group_type == "same_ip":
        base = 85 if has_registration_ip else 70
    elif group_type == "same_subnet":
        base = 55
    elif group_type == "same_ua":
        base = 65 if has_same_device else 55
    elif group_type == "same_day_ip":
        base = 75
    elif group_type == "domain":
        base = 45
    elif group_type == "similar_username":
        base = 40
    elif group_type == "similar_email":
        base = 50
    elif group_type == "dead_ip_overlap":
        base = 82
    elif group_type == "dead_fingerprint_overlap":
        base = 78
    elif group_type == "suspicious_ip":
        base = 62
    elif group_type == "registration_burst":
        base = 74
    elif group_type == "referral_same_ip":
        base = 72
    elif group_type == "heavy_transfers":
        base = 66
    elif group_type == "prereg_ip_cross":
        base = 56
    elif group_type == "security_flag_user":
        base = 42
    elif group_type == "password_reset_heavy":
        base = 36
    else:
        base = 30

    # Bonus for more accounts
    if count >= 10:
        base = min(100, base + 15)
    elif count >= 5:
        base = min(100, base + 10)
    elif count >= 3:
        base = min(100, base + 5)

    if has_vpn:
        base = min(100, base + 10)

    return min(100, base)
