# Deterministic synthetic /admin/investigate/user-ip-check payload for dupe-exempt emails.
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

from utils.ip_enrichment import analyze_login_carrier_shifts, network_label

_SALT = b"dupe_exempt_ip_decoy_v1"

_DECOY_ISPS = [
    ("Comcast Cable Communications, LLC", "AS7922 Comcast Cable Communications, LLC"),
    ("Charter Communications Inc", "AS20115 Charter Communications"),
    ("Cox Communications Inc.", "AS22773 Cox Communications Inc."),
    ("AT&T Enterprises LLC", "AS7018 AT&T Enterprises LLC"),
    ("Verizon Business", "AS701 Verizon Business"),
]

_UA_SAMPLES = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
]


def _octet(h: bytes, i: int, lo: int = 1, hi: int = 254) -> int:
    return lo + (int(h[i % len(h)]) % (hi - lo + 1))


def _synthetic_ipv4_pair(h: bytes) -> tuple:
    """Two distinct public-looking IPv4s from digest (avoid 10/172.16/192.168)."""
    a1, a2, a3, a4 = _octet(h, 0, 73, 99), _octet(h, 1), _octet(h, 2), _octet(h, 3)
    b1, b2, b3, b4 = a1, _octet(h, 4), _octet(h, 5), _octet(h, 6) ^ 7
    if b4 < 1 or b4 > 254:
        b4 = _octet(h, 7)
    ip_a = f"{a1}.{a2}.{a3}.{a4}"
    ip_b = f"{b1}.{b2}.{b3}.{b4}"
    if ip_a == ip_b:
        ip_b = f"{a1}.{a2}.{a3}.{(a4 % 200) + 25}"
    return ip_a, ip_b


def _geo_block(ip: str, isp: str, org: str, country_code: str) -> Dict[str, Any]:
    now_iso = datetime.now(timezone.utc).isoformat()
    country = "United States" if country_code == "US" else "Canada" if country_code == "CA" else "United Kingdom"
    return {
        "ip": ip,
        "fetched_at": now_iso,
        "ok": True,
        "from_cache": True,
        "country": country,
        "countryCode": country_code,
        "isp": isp,
        "org": org,
        "as_field": org.split()[0][:32] if org else None,
        "asname": org[:120] if org else None,
        "mobile": False,
        "proxy": False,
        "hosting": False,
    }


def build_synthetic_user_ip_check(user: Dict[str, Any]) -> Dict[str, Any]:
    """Mirror admin_investigate_user_ip-check success shape; deterministic from user id."""
    uid = str(user.get("id") or "")
    uname = user.get("username") or ""
    h = hashlib.sha256(_SALT + uid.encode("utf-8")).digest()

    ip_a, ip_b = _synthetic_ipv4_pair(h)
    isp_idx = int(h[15]) % len(_DECOY_ISPS)
    isp, org = _DECOY_ISPS[isp_idx]
    cc = ["US", "US", "CA", "GB"][int(h[16]) % 4]

    geodata_by_ip: Dict[str, Dict[str, Any]] = {
        ip_a: _geo_block(ip_a, isp, org, cc),
        ip_b: _geo_block(ip_b, isp, org, cc),
    }

    now = datetime.now(timezone.utc)
    hist_chrono: List[Dict[str, Any]] = []
    for i, days_ago in enumerate((21, 14, 9, 5, 2, 0)):
        at = (now - timedelta(days=days_ago, hours=int(h[i + 1]) % 12)).isoformat()
        ip_use = ip_a if i != 2 else ip_b
        hist_chrono.append(
            {
                "at": at,
                "ip": ip_use,
                "source": "login",
                "device_type": "Desktop",
                "ua_short": "Chrome/Win64",
            }
        )

    enriched_timeline: List[Dict[str, Any]] = []
    for hrow in hist_chrono:
        g = geodata_by_ip.get(hrow["ip"], {})
        enriched_timeline.append(
            {
                "at": hrow.get("at"),
                "ip": hrow.get("ip"),
                "source": hrow.get("source"),
                "device_type": hrow.get("device_type"),
                "ua_short": hrow.get("ua_short"),
                "countryCode": g.get("countryCode"),
                "isp": g.get("isp"),
                "org": g.get("org"),
                "mobile": g.get("mobile"),
                "hosting": g.get("hosting"),
                "proxy": g.get("proxy"),
                "geo_ok": g.get("ok"),
                "geo_error": g.get("error"),
            }
        )

    ip_summary: List[Dict[str, Any]] = []
    for ip_one in sorted(geodata_by_ip.keys()):
        g = geodata_by_ip[ip_one]
        ip_summary.append(
            {
                "ip": ip_one,
                "network": network_label(g),
                "countryCode": g.get("countryCode"),
                "isp": g.get("isp"),
                "org": g.get("org"),
                "mobile": g.get("mobile"),
                "hosting": g.get("hosting"),
                "proxy": g.get("proxy"),
                "geo_ok": g.get("ok"),
                "from_cache": g.get("from_cache"),
                "geo_error": g.get("error"),
            }
        )

    sess_created = (now - timedelta(days=6)).isoformat()
    sess_last = (now - timedelta(hours=3)).isoformat()
    sessions_out = [
        {
            "session_id": f"syn-{h[20]:02x}{h[21]:02x}{h[22]:02x}",
            "ip": ip_a,
            "device_type": "Desktop",
            "created_at": sess_created,
            "last_used_at": sess_last,
            "network": network_label(geodata_by_ip[ip_a]),
            "mobile": False,
        }
    ]

    risks = analyze_login_carrier_shifts(hist_chrono, geodata_by_ip)
    ua = _UA_SAMPLES[int(h[14]) % len(_UA_SAMPLES)]

    return {
        "user": {"id": uid, "username": uname},
        "meta": {
            "unique_ip_count": 2,
            "looked_up_ips": 2,
            "truncated_geo_lookups": False,
            "data_source": "ip-api.com (cached 7d in ip_geodata_cache)",
        },
        "last_user_agent": ua,
        "last_device_type": "Desktop",
        "login_ips_stored": [ip_a, ip_b],
        "login_timeline": enriched_timeline,
        "sessions": sessions_out,
        "ip_summary": sorted(ip_summary, key=lambda x: x.get("ip") or ""),
        "risks": risks,
    }
