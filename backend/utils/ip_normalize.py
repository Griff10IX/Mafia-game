"""Canonical IPv4/IPv6 strings for comparisons (IP bans, security).

IPv6 can be written many ways (compressed, leading zeros, brackets, zone).
We always compare using ipaddress canonical str() so bans match live traffic.
"""
from __future__ import annotations

import ipaddress
from typing import Optional


def normalize_ip_string(raw: Optional[str]) -> str:
    """
    Return canonical IP string for MongoDB lookups, or "" if invalid.

    Handles: X-Forwarded-For first hop, [IPv6]:port, zone id (%eth0),
    IPv4:port, quoted strings.
    """
    if not raw or not isinstance(raw, str):
        return ""
    s = raw.strip().strip('"').strip("'")
    if not s:
        return ""
    if "," in s:
        s = s.split(",")[0].strip()
    if s.startswith("[") and "]" in s:
        s = s[1:s.find("]")]
    # IPv4:port (single colon — not IPv6)
    if s.count(":") == 1 and "." in s:
        host, port = s.rsplit(":", 1)
        if port.isdigit():
            s = host
    if "%" in s:
        s = s.split("%", 1)[0]
    try:
        ip_obj = ipaddress.ip_address(s)
        # Normalize IPv4-mapped IPv6 (::ffff:x.x.x.x) to plain IPv4 for storage/display consistency.
        if isinstance(ip_obj, ipaddress.IPv6Address) and ip_obj.ipv4_mapped:
            return str(ip_obj.ipv4_mapped)
        return str(ip_obj)
    except ValueError:
        return ""
