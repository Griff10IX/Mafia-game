# Best-effort ISP / mobile / ASN for an IP (admin tooling). Uses ip-api.com free tier — rate-limited; results cached in MongoDB.
import asyncio
import ipaddress
import logging
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 7 * 24 * 3600
# ip-api.com: max ~45 requests/minute per server IP — pause between live fetches when cache misses.
_FETCH_THROTTLE_SEC = 1.4


def normalize_ip(ip: Optional[str]) -> str:
    if not ip or not isinstance(ip, str):
        return ""
    s = ip.strip()
    if s.lower().startswith("::ffff:"):
        s = s[7:]
    return s


async def get_or_fetch_ip_geodata(db, ip: str) -> Dict[str, Any]:
    """
    Return cached or freshly fetched geodata for a public IP.
    Document shape (also stored in ip_geodata_cache): ip, fetched_at, ok, country, countryCode,
    isp, org, as_field, asname, mobile, proxy, hosting, error (optional).
    """
    ipn = normalize_ip(ip)
    if not ipn:
        return {"ip": "", "ok": False, "error": "empty_ip", "fetched_at": datetime.now(timezone.utc).isoformat()}
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    try:
        cached = await db.ip_geodata_cache.find_one({"ip": ipn}, {"_id": 0})
    except Exception:
        cached = None
    if cached and cached.get("fetched_at"):
        try:
            raw = cached["fetched_at"]
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if (now - dt).total_seconds() < CACHE_TTL_SECONDS:
                out = dict(cached)
                out["from_cache"] = True
                return out
        except Exception:
            pass

    data: Dict[str, Any] = {
        "ip": ipn,
        "fetched_at": now_iso,
        "ok": False,
        "from_cache": False,
    }
    try:
        import httpx

        url = (
            f"http://ip-api.com/json/{ipn}"
            "?fields=status,message,country,countryCode,isp,org,as,asname,mobile,proxy,hosting,query"
        )
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                url,
                headers={"User-Agent": "MafiaWarsAdminIPCheck/1.0"},
            )
            r.raise_for_status()
            j = r.json()
    except Exception as e:
        logger.warning("ip-api fetch failed for %s: %s", ipn, e)
        data["error"] = str(e)[:200]
        try:
            await db.ip_geodata_cache.update_one({"ip": ipn}, {"$set": data}, upsert=True)
        except Exception:
            pass
        return data

    if not isinstance(j, dict) or j.get("status") != "success":
        msg = (j or {}).get("message") or "lookup_failed"
        data["error"] = str(msg)[:200]
        try:
            await db.ip_geodata_cache.update_one({"ip": ipn}, {"$set": data}, upsert=True)
        except Exception:
            pass
        return data

    data.update(
        {
            "ok": True,
            "country": j.get("country"),
            "countryCode": j.get("countryCode"),
            "isp": j.get("isp"),
            "org": j.get("org"),
            "as_field": j.get("as"),
            "asname": j.get("asname"),
            "mobile": bool(j.get("mobile")),
            "proxy": bool(j.get("proxy")),
            "hosting": bool(j.get("hosting")),
        }
    )
    data.pop("error", None)
    try:
        await db.ip_geodata_cache.update_one({"ip": ipn}, {"$set": data}, upsert=True)
    except Exception:
        logger.exception("ip_geodata_cache upsert failed ip=%s", ipn)
    await asyncio.sleep(_FETCH_THROTTLE_SEC)
    return data


def is_public_routable_ip(ip: Optional[str]) -> bool:
    """True if IPv4/IPv6 is globally routable (not loopback, private, link-local, etc.)."""
    ipn = normalize_ip(ip or "")
    if not ipn:
        return False
    try:
        return ipaddress.ip_address(ipn).is_global
    except ValueError:
        return False


async def maybe_fill_last_seen_country_for_auto_rank(db, user: dict) -> None:
    """When edge headers never set last_seen_country (typical for auto-rank-only sessions), derive ISO2 from stored IP via ip_geodata cache / ip-api."""
    uid = user.get("id")
    if not uid:
        return
    raw = (user.get("last_seen_country") or "").strip().upper()
    if len(raw) == 2 and raw.isalpha() and raw not in ("XX", "T1"):
        return
    ip = normalize_ip(user.get("last_request_ip") or user.get("last_login_ip") or "")
    if not ip or not is_public_routable_ip(ip):
        return
    g = await get_or_fetch_ip_geodata(db, ip)
    if not g.get("ok"):
        return
    code = (g.get("countryCode") or "").strip().upper()
    if len(code) != 2 or not code.isalpha() or code in ("XX", "T1"):
        return
    try:
        await db.users.update_one({"id": uid}, {"$set": {"last_seen_country": code}})
    except Exception:
        logger.exception("maybe_fill_last_seen_country_for_auto_rank update failed user=%s", uid)


def network_label(g: Dict[str, Any]) -> str:
    """Single string for grouping / display (ISP preferred, else org)."""
    isp = (g.get("isp") or "").strip()
    org = (g.get("org") or "").strip()
    if isp:
        return isp
    if org:
        return org
    return (g.get("asname") or g.get("as_field") or "Unknown")[:120]


def analyze_login_carrier_shifts(
    timeline_chrono: list,
    enriched_by_ip: Dict[str, Dict[str, Any]],
) -> list:
    """
    timeline_chrono: oldest-first list of {ip, at, ...}.
    Returns list of {level, code, detail} — level 'warn' or 'info'.
    """
    risks: list = []
    if len(timeline_chrono) < 2:
        return risks

    def enrich_row(row: Dict[str, Any]) -> Dict[str, Any]:
        ip = normalize_ip(row.get("ip"))
        geo = enriched_by_ip.get(ip) or {}
        return {
            **row,
            "_network": network_label(geo) if geo.get("ok") else "",
            "_mobile": bool(geo.get("mobile")),
            "_hosting": bool(geo.get("hosting")),
            "_proxy": bool(geo.get("proxy")),
        }

    rows = [enrich_row(r) for r in timeline_chrono if normalize_ip(r.get("ip"))]
    mobile_rows = [r for r in rows if r.get("_mobile") and not r.get("_hosting") and r.get("_network")]
    if len(mobile_rows) < 4:
        # Need enough mobile-labelled logins to infer a "usual" carrier
        pass
    else:
        counts = Counter(r["_network"] for r in mobile_rows)
        dominant, dom_n = counts.most_common(1)[0]
        latest = mobile_rows[-1]
        latest_net = latest.get("_network")
        if latest_net and dominant and latest_net != dominant and dom_n >= 3:
            latest_streak = sum(1 for r in mobile_rows[::-1] if r.get("_network") == latest_net)
            if latest_streak <= 2:
                risks.append(
                    {
                        "level": "warn",
                        "code": "mobile_carrier_shift",
                        "detail": (
                            f"Most mobile logins mapped to “{dominant}” ({dom_n} events); "
                            f"most recent mobile login(s) use “{latest_net}”. Possible new device/SIM or account access change — verify with the player."
                        ),
                    }
                )

    # Recent hosting/datacenter after mostly residential/mobile
    hosting_recent = [r for r in rows[-5:] if r.get("_hosting")]
    hosting_older = [r for r in rows[:-5] if r.get("_hosting")]
    if len(rows) >= 6 and hosting_recent and not hosting_older:
        risks.append(
            {
                "level": "info",
                "code": "recent_hosting_ip",
                "detail": "Latest logins include a hosting/datacenter IP with no earlier hosting IPs in this history — could be VPN or server login.",
            }
        )

    distinct_mobile = {r["_network"] for r in mobile_rows if r.get("_network")}
    if len(distinct_mobile) >= 3:
        risks.append(
            {
                "level": "info",
                "code": "many_mobile_networks",
                "detail": f"{len(distinct_mobile)} different mobile ISP labels appear in login history — normal if the player travels or switches SIM; review timeline.",
            }
        )

    proxy_rows = [r for r in rows if r.get("_proxy")]
    if proxy_rows:
        risks.append(
            {
                "level": "warn",
                "code": "ip_api_proxy_flag",
                "detail": f"{len(proxy_rows)} login(s) used an IP flagged as proxy by ip-api — may be VPN or a paid proxy service (e.g. residential rotator).",
            }
        )
    for r in rows[-8:]:
        blob = (r.get("_network") or "").lower()
        from utils.proxy_detection import match_proxy_provider_keywords

        hits = match_proxy_provider_keywords(blob)
        if hits:
            risks.append(
                {
                    "level": "warn",
                    "code": "commercial_proxy_isp",
                    "detail": f"Recent login network matches commercial proxy keywords ({hits[0]}). Review Cheat Detection → Proxy farm report.",
                }
            )
            break

    return risks
