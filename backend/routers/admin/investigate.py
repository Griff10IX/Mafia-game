# Admin/mod: bot & scripting investigation — aggregated per-user profile and bot-block audit trail.
import asyncio
import logging
import math
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import Depends, HTTPException, Query

logger = logging.getLogger(__name__)

from utils.staff_bot_client_alert import BOT_CLIENT_BLOCK_COLLECTION as BOT_BLOCK_COLLECTION
from utils.ip_enrichment import (
    analyze_login_carrier_shifts,
    get_or_fetch_ip_geodata,
    network_label,
    normalize_ip,
)


def register(router):
    import server as srv

    db = srv.db
    require_admin_or_mod = srv.require_admin_or_mod

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

    def _mean_std(vals: List[float]) -> Tuple[Optional[float], Optional[float]]:
        if len(vals) < 2:
            return (vals[0] if vals else None, None)
        m = sum(vals) / len(vals)
        var = sum((x - m) ** 2 for x in vals) / len(vals)
        return (m, math.sqrt(var))

    @router.get("/admin/investigate/user-profile")
    async def admin_investigate_user_profile(
        user_id: Optional[str] = Query(None, description="Exact user id"),
        username: Optional[str] = Query(None, description="Exact username (case-insensitive)"),
        activity_hours: int = Query(24, ge=1, le=168, description="Window for hourly activity buckets"),
        current_user: dict = Depends(require_admin_or_mod),
    ):
        """
        Single payload for bot/script review: user snapshot, security flags, activity density,
        minigame play timing stats, suspicious login touches, auto-rank telegram link flag.
        Admin or moderator.
        """
        uid = (user_id or "").strip()
        uname = (username or "").strip()
        if not uid and not uname:
            raise HTTPException(status_code=400, detail="Provide user_id or username")
        q = {}
        if uid:
            q["id"] = uid
        else:
            q["username"] = re.compile("^" + re.escape(uname) + "$", re.IGNORECASE)
        proj = {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "registration_ip": 1,
            "last_login_ip": 1,
            "last_request_ip": 1,
            "last_user_agent": 1,
            "device_fingerprint": 1,
            "created_at": 1,
            "referred_by": 1,
            "sessions": 1,
            "is_dead": 1,
            "is_npc": 1,
            "telegram_chat_id": 1,
            "auto_rank_enabled": 1,
        }
        user = await db.users.find_one(q, proj)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        uid = user["id"]
        uname = user.get("username") or ""

        now = datetime.now(timezone.utc)
        since = now - timedelta(hours=activity_hours)
        since_iso = since.isoformat()

        # Security flags (last 30d + summary)
        sec_since = now - timedelta(days=30)
        sec_since_iso = sec_since.isoformat()
        sec_q: Dict[str, Any] = {"user_id": uid}
        sec_flags = (
            await db.security_flags.find(
                sec_q,
                {"_id": 0},
            )
            .sort("created_at", -1)
            .limit(80)
            .to_list(80)
        )
        by_type: Dict[str, int] = {}
        unresolved = 0
        for f in sec_flags:
            ft = f.get("flag_type") or "unknown"
            by_type[ft] = by_type.get(ft, 0) + 1
            if f.get("resolved") is not True:
                unresolved += 1
        created_filter = {
            "$or": [
                {"created_at": {"$gte": sec_since}},
                {"created_at": {"$gte": sec_since_iso}},
            ]
        }
        total_flags_30d = await db.security_flags.count_documents({"user_id": uid, **created_filter})

        # Activity hourly buckets
        act_q = {
            "user_id": uid,
            "$or": [
                {"created_at": {"$gte": since}},
                {"created_at": {"$gte": since_iso}},
            ],
        }
        act_rows = await db.activity_log.find(act_q, {"_id": 0, "created_at": 1}).to_list(8000)
        buckets: Dict[str, int] = {}
        for r in act_rows:
            dt = _parse_ts(r.get("created_at"))
            if not dt or dt < since:
                continue
            key = dt.strftime("%Y-%m-%d %H:00")
            buckets[key] = buckets.get(key, 0) + 1
        activity_total = sum(buckets.values())

        # Minigame plays — inter-arrival stats (chronological last 60 rows)
        plays = (
            await db.minigame_plays.find({"user_id": uid}, {"_id": 0, "game": 1, "played_at": 1, "score": 1, "points": 1})
            .sort("played_at", -1)
            .limit(60)
            .to_list(60)
        )
        plays_chrono = list(reversed(plays))
        deltas: List[float] = []
        for i in range(len(plays_chrono) - 1):
            t0 = _parse_ts(plays_chrono[i].get("played_at"))
            t1 = _parse_ts(plays_chrono[i + 1].get("played_at"))
            if t0 and t1:
                deltas.append(abs((t1 - t0).total_seconds()))
        mean_dt, std_dt = _mean_std(deltas) if deltas else (None, None)

        # Suspicious logins mentioning this account (last 30d)
        susp_cut = (now - timedelta(days=30)).isoformat()
        susp_q = {
            "at": {"$gte": susp_cut},
            "$or": [
                {"user_id": uid},
                {"username": re.compile("^" + re.escape(uname) + "$", re.IGNORECASE)},
                {"login_input": re.compile(re.escape(uname), re.IGNORECASE)},
            ],
        }
        susp_recent = await db.suspicious_logins.find(susp_q, {"_id": 0}).sort("at", -1).limit(25).to_list(25)
        susp_count = await db.suspicious_logins.count_documents(susp_q)

        tg = (user.get("telegram_chat_id") or "").strip()
        auto_rank = {
            "telegram_linked": bool(tg),
            "auto_rank_enabled": user.get("auto_rank_enabled") is True,
        }

        return {
            "user": {
                "id": uid,
                "username": uname,
                "email": user.get("email"),
                "is_dead": user.get("is_dead"),
                "is_npc": user.get("is_npc"),
                "registration_ip": user.get("registration_ip"),
                "last_login_ip": user.get("last_login_ip"),
                "last_request_ip": user.get("last_request_ip"),
                "last_user_agent": user.get("last_user_agent"),
                "device_fingerprint": user.get("device_fingerprint"),
                "created_at": user.get("created_at"),
                "referred_by": user.get("referred_by"),
                "sessions_count": len(user.get("sessions") or []) if isinstance(user.get("sessions"), list) else None,
            },
            "security_flags_recent": sec_flags[:40],
            "security_flags_summary": {
                "total_last_30d": total_flags_30d,
                "in_sample_by_type": by_type,
                "unresolved_in_sample": unresolved,
            },
            "activity": {
                "window_hours": activity_hours,
                "total_actions": activity_total,
                "hourly_buckets": [{"hour": k, "count": v} for k, v in sorted(buckets.items())],
            },
            "minigame_plays_sample": plays[:15],
            "minigame_timing": {
                "plays_analyzed": len(plays),
                "inter_arrival_seconds_mean": mean_dt,
                "inter_arrival_seconds_stddev": std_dt,
                "inter_arrival_samples": len(deltas),
            },
            "suspicious_logins": {"count_30d": susp_count, "recent": susp_recent},
            "auto_rank": auto_rank,
        }

    @router.get("/admin/investigate/bot-blocks")
    async def admin_investigate_bot_blocks(
        user_id: Optional[str] = Query(None),
        limit: int = Query(80, ge=1, le=200),
        current_user: dict = Depends(require_admin_or_mod),
    ):
        """Recent script/bot client block events (TTL collection). Admin or moderator."""
        q: Dict[str, Any] = {}
        uid = (user_id or "").strip()
        if uid:
            q["user_id"] = uid
        cur = db[BOT_BLOCK_COLLECTION].find(q, {"_id": 0}).sort("created_at", -1).limit(limit)
        rows = await cur.to_list(limit)
        return {"events": rows, "count": len(rows)}

    MAX_IP_GEO_LOOKUPS = 40

    _USER_IP_PROJ = {
        "_id": 0,
        "id": 1,
        "username": 1,
        "email": 1,
        "registration_ip": 1,
        "last_login_ip": 1,
        "last_request_ip": 1,
        "login_ips": 1,
        "login_history": 1,
        "sessions": 1,
        "last_user_agent": 1,
        "last_device_type": 1,
        "created_at": 1,
    }

    _USER_ACCESS_PROJ = {
        **_USER_IP_PROJ,
        "device_fingerprint": 1,
        "last_seen": 1,
        "token_version": 1,
        "is_dead": 1,
    }

    _COMPARE_USER_PROJ = {
        **_USER_IP_PROJ,
        "device_fingerprint": 1,
        "family_id": 1,
        "referred_by": 1,
        "is_dead": 1,
    }

    async def _resolve_investigate_user(
        user_id: Optional[str],
        username: Optional[str],
    ) -> Dict[str, Any]:
        uid = (user_id or "").strip()
        uname = (username or "").strip()
        if not uid and not uname:
            raise HTTPException(status_code=400, detail="Provide user_id or username")
        q: Dict[str, Any] = {}
        if uid:
            q["id"] = uid
        else:
            q["username"] = re.compile("^" + re.escape(uname) + "$", re.IGNORECASE)
        user = await db.users.find_one(q, _USER_IP_PROJ)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user

    async def _build_user_ip_check_payload(user: Dict[str, Any]) -> Dict[str, Any]:
        if srv.user_has_dupe_exempt_email(user):
            from utils.synthetic_user_ip_check import build_synthetic_user_ip_check

            return build_synthetic_user_ip_check(user)

        uid = user["id"]
        uname = user.get("username") or ""

        ips_ordered: List[str] = []
        seen_ip: set = set()

        def add_ip(raw: Any) -> None:
            n = normalize_ip(str(raw) if raw is not None else "")
            if not n or n in seen_ip:
                return
            seen_ip.add(n)
            ips_ordered.append(n)

        hist_raw = user.get("login_history")
        if not isinstance(hist_raw, list):
            hist_raw = []

        def _hk(h: Dict[str, Any]) -> datetime:
            return _parse_ts(h.get("at")) or datetime.min.replace(tzinfo=timezone.utc)

        hist_chrono = sorted(
            [h for h in hist_raw if isinstance(h, dict)],
            key=_hk,
        )
        for h in hist_chrono:
            add_ip(h.get("ip"))

        for ip_key in (
            user.get("registration_ip"),
            user.get("last_login_ip"),
            user.get("last_request_ip"),
        ):
            add_ip(ip_key)
        lip = user.get("login_ips")
        if isinstance(lip, list):
            for x in lip:
                add_ip(x)
        for s in user.get("sessions") or []:
            if isinstance(s, dict):
                add_ip(s.get("ip"))

        all_ips = list(seen_ip)
        truncated = False
        lookup_ips = ips_ordered[:]
        if len(lookup_ips) > MAX_IP_GEO_LOOKUPS:
            truncated = True
            lookup_ips = lookup_ips[:MAX_IP_GEO_LOOKUPS]

        geodata_by_ip: Dict[str, Dict[str, Any]] = {}
        for ip_one in lookup_ips:
            geodata_by_ip[ip_one] = await get_or_fetch_ip_geodata(db, ip_one)

        enriched_timeline: List[Dict[str, Any]] = []
        for h in hist_chrono:
            if not isinstance(h, dict):
                continue
            ipn = normalize_ip(h.get("ip"))
            g = geodata_by_ip.get(ipn, {})
            enriched_timeline.append(
                {
                    "at": h.get("at"),
                    "ip": ipn,
                    "source": h.get("source"),
                    "device_type": h.get("device_type"),
                    "ua_short": h.get("ua_short"),
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

        risks = analyze_login_carrier_shifts(hist_chrono, geodata_by_ip)

        from utils.proxy_detection import assess_user_proxy_profile

        proxy_profile = await assess_user_proxy_profile(
            db,
            user,
            max_ip_lookups=min(25, MAX_IP_GEO_LOOKUPS),
            check_getipintel=True,
            include_session_ips=True,
        )
        if proxy_profile.get("likely_proxy_farm"):
            risks.insert(
                0,
                {
                    "level": "warn",
                    "code": "likely_proxy_farm",
                    "detail": (
                        f"Proxy farm score {proxy_profile.get('combined_risk_score')}/100 "
                        f"(worst IP: {proxy_profile.get('worst_ip_verdict')}). "
                        "Use Cheat Detection → Proxy farm investigation for full breakdown."
                    ),
                },
            )

        ip_summary: List[Dict[str, Any]] = []
        for ip_one in sorted(all_ips):
            g = geodata_by_ip.get(ip_one)
            if g is None:
                ip_summary.append(
                    {
                        "ip": ip_one,
                        "lookup": "not_fetched_this_run"
                        if truncated and ip_one not in geodata_by_ip
                        else "missing",
                    }
                )
            else:
                ip_summary.append(
                    {
                        "ip": ip_one,
                        "network": network_label(g),
                        "country": g.get("country"),
                        "countryCode": g.get("countryCode"),
                        "regionName": g.get("regionName"),
                        "city": g.get("city"),
                        "isp": g.get("isp"),
                        "org": g.get("org"),
                        "as_field": g.get("as_field"),
                        "asname": g.get("asname"),
                        "mobile": g.get("mobile"),
                        "hosting": g.get("hosting"),
                        "proxy": g.get("proxy"),
                        "geo_ok": g.get("ok"),
                        "from_cache": g.get("from_cache"),
                        "geo_error": g.get("error"),
                    }
                )

        sessions_out: List[Dict[str, Any]] = []
        for s in (user.get("sessions") or [])[:12]:
            if not isinstance(s, dict):
                continue
            ipn = normalize_ip(s.get("ip"))
            g = geodata_by_ip.get(ipn, {})
            sessions_out.append(
                {
                    "session_id": s.get("id"),
                    "ip": ipn,
                    "device_type": s.get("device_type"),
                    "created_at": s.get("created_at"),
                    "last_used_at": s.get("last_used_at"),
                    "network": network_label(g) if g.get("ok") else None,
                    "mobile": g.get("mobile"),
                }
            )

        session_ips: List[str] = []
        for s in user.get("sessions") or []:
            if isinstance(s, dict):
                sip = normalize_ip(s.get("ip"))
                if sip:
                    session_ips.append(sip)

        return {
            "user": {
                "id": uid,
                "username": uname,
                "email": user.get("email"),
                "created_at": user.get("created_at"),
            },
            "meta": {
                "unique_ip_count": len(all_ips),
                "looked_up_ips": len(lookup_ips),
                "truncated_geo_lookups": truncated,
                "data_source": "ip-api.com (cached 7d in ip_geodata_cache)",
            },
            "last_user_agent": user.get("last_user_agent"),
            "last_device_type": user.get("last_device_type"),
            "login_ips_stored": user.get("login_ips") if isinstance(user.get("login_ips"), list) else [],
            "login_timeline": enriched_timeline,
            "sessions": sessions_out,
            "ip_summary": sorted(ip_summary, key=lambda x: x.get("ip") or ""),
            "risks": risks,
            "proxy_farm_profile": proxy_profile,
            "sources": {
                "registration_ip": normalize_ip(user.get("registration_ip")) or None,
                "last_login_ip": normalize_ip(user.get("last_login_ip")) or None,
                "last_request_ip": normalize_ip(user.get("last_request_ip")) or None,
                "login_ips": [
                    normalize_ip(x) for x in (user.get("login_ips") or []) if normalize_ip(x)
                ],
                "session_ips": session_ips,
                "login_history_entries": len(hist_chrono),
            },
        }

    async def _attack_ips_for_user(uid: str, days: int, limit: int) -> Dict[str, Any]:
        since = datetime.now(timezone.utc) - timedelta(days=int(days))
        since_iso = since.isoformat()
        time_or = {"$or": [{"created_at": {"$gte": since}}, {"created_at": {"$gte": since_iso}}]}
        match_attacker = {"$and": [{"attacker_id": uid}, time_or, {"client_ip": {"$nin": [None, ""]}}]}
        match_target = {"$and": [{"target_id": uid}, time_or, {"client_ip": {"$nin": [None, ""]}}]}

        async def _agg(match: Dict[str, Any], role: str) -> List[Dict[str, Any]]:
            rows = await db.attack_attempts.aggregate(
                [
                    {"$match": match},
                    {
                        "$group": {
                            "_id": "$client_ip",
                            "count": {"$sum": 1},
                            "first_at": {"$min": "$created_at"},
                            "last_at": {"$max": "$created_at"},
                        }
                    },
                    {"$sort": {"count": -1}},
                    {"$limit": int(limit)},
                ]
            ).to_list(int(limit))
            out = []
            for r in rows:
                ipn = normalize_ip(r.get("_id"))
                if not ipn:
                    continue
                out.append(
                    {
                        "ip": ipn,
                        "role": role,
                        "count": int(r.get("count") or 0),
                        "first_at": r.get("first_at"),
                        "last_at": r.get("last_at"),
                    }
                )
            return out

        as_attacker = await _agg(match_attacker, "attacker")
        as_target = await _agg(match_target, "target")
        samples = (
            await db.attack_attempts.find(
                {
                    "$and": [
                        {"$or": [{"attacker_id": uid}, {"target_id": uid}]},
                        time_or,
                        {"client_ip": {"$nin": [None, ""]}},
                    ]
                },
                {
                    "_id": 0,
                    "created_at": 1,
                    "client_ip": 1,
                    "outcome": 1,
                    "attacker_username": 1,
                    "target_username": 1,
                    "attacker_id": 1,
                    "target_id": 1,
                },
            )
            .sort("created_at", -1)
            .limit(25)
            .to_list(25)
        )
        recent = []
        for s in samples:
            ipn = normalize_ip(s.get("client_ip"))
            recent.append(
                {
                    "at": s.get("created_at"),
                    "ip": ipn,
                    "outcome": s.get("outcome"),
                    "role": "attacker" if s.get("attacker_id") == uid else "target",
                    "attacker_username": s.get("attacker_username"),
                    "target_username": s.get("target_username"),
                }
            )
        return {
            "days": int(days),
            "as_attacker": as_attacker,
            "as_target": as_target,
            "recent_samples": recent,
        }

    def _compare_user_snapshot(user: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": user.get("id"),
            "username": user.get("username"),
            "email": user.get("email"),
            "created_at": user.get("created_at"),
            "is_dead": user.get("is_dead"),
            "registration_ip": normalize_ip(user.get("registration_ip")) or None,
            "last_login_ip": normalize_ip(user.get("last_login_ip")) or None,
            "last_request_ip": normalize_ip(user.get("last_request_ip")) or None,
            "last_user_agent": user.get("last_user_agent"),
            "last_device_type": user.get("last_device_type"),
            "device_fingerprint": user.get("device_fingerprint"),
            "sessions_count": len(user.get("sessions") or []) if isinstance(user.get("sessions"), list) else 0,
        }

    def _account_ip_sources(user: Dict[str, Any], attack: Dict[str, Any]) -> Dict[str, set]:
        sources: Dict[str, set] = {}

        def add(raw: Any, source: str) -> None:
            ipn = normalize_ip(str(raw) if raw is not None else "")
            if not ipn:
                return
            sources.setdefault(ipn, set()).add(source)

        add(user.get("registration_ip"), "registration")
        add(user.get("last_login_ip"), "last_login")
        add(user.get("last_request_ip"), "last_request")
        for ip in user.get("login_ips") or []:
            add(ip, "login_ips")
        for h in user.get("login_history") or []:
            if isinstance(h, dict):
                add(h.get("ip"), "login_history")
        for s in user.get("sessions") or []:
            if isinstance(s, dict):
                add(s.get("ip"), "session")
        for block in (attack.get("as_attacker") or []) + (attack.get("as_target") or []):
            add(block.get("ip"), f"attack_{block.get('role') or 'activity'}")
        return sources

    def _session_device_summary(user: Dict[str, Any]) -> Dict[str, set]:
        device_types: set = set()
        ua_values: set = set()
        for s in user.get("sessions") or []:
            if not isinstance(s, dict):
                continue
            dt = (s.get("device_type") or "").strip()
            ua = (s.get("user_agent") or s.get("ua") or "").strip()
            if dt:
                device_types.add(dt)
            if ua:
                ua_values.add(ua[:180])
        last_dt = (user.get("last_device_type") or "").strip()
        last_ua = (user.get("last_user_agent") or "").strip()
        if last_dt:
            device_types.add(last_dt)
        if last_ua:
            ua_values.add(last_ua[:180])
        return {"device_types": device_types, "user_agents": ua_values}

    def _provider_label(g: Dict[str, Any]) -> str:
        return network_label(g) if g.get("ok") else ""

    def _isp_key(g: Dict[str, Any]) -> str:
        isp = (g.get("isp") or "").strip().lower()
        if isp:
            return isp
        org = (g.get("org") or "").strip().lower()
        if org:
            return org
        return _provider_label(g).lower()

    def _asn_key(g: Dict[str, Any]) -> str:
        asn = (g.get("as_field") or "").strip().upper()
        if asn:
            return asn
        asname = (g.get("asname") or "").strip().lower()
        return asname

    def _geodata_row(ipn: str, g: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "ip": ipn,
            "network": network_label(g) if g.get("ok") else None,
            "country": g.get("country"),
            "countryCode": g.get("countryCode"),
            "regionName": g.get("regionName"),
            "city": g.get("city"),
            "isp": g.get("isp"),
            "org": g.get("org"),
            "as_field": g.get("as_field"),
            "asname": g.get("asname"),
            "mobile": g.get("mobile"),
            "hosting": g.get("hosting"),
            "proxy": g.get("proxy"),
            "geo_ok": g.get("ok"),
            "geo_error": g.get("error"),
        }

    def _provider_buckets(
        ip_sources: Dict[str, set],
        geodata_by_ip: Dict[str, Dict[str, Any]],
    ) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
        by_isp: Dict[str, Dict[str, Any]] = {}
        by_asn: Dict[str, Dict[str, Any]] = {}
        for ipn, sources in ip_sources.items():
            g = geodata_by_ip.get(ipn) or {}
            if not g.get("ok"):
                continue
            isp_k = _isp_key(g)
            asn_k = _asn_key(g)
            if isp_k:
                row = by_isp.setdefault(
                    isp_k,
                    {
                        "isp": _provider_label(g),
                        "ips": set(),
                        "sources": set(),
                        "mobile": False,
                        "hosting": False,
                        "proxy": False,
                    },
                )
                row["ips"].add(ipn)
                row["sources"].update(sources)
                row["mobile"] = row["mobile"] or bool(g.get("mobile"))
                row["hosting"] = row["hosting"] or bool(g.get("hosting"))
                row["proxy"] = row["proxy"] or bool(g.get("proxy"))
            if asn_k:
                row = by_asn.setdefault(
                    asn_k,
                    {
                        "as_field": g.get("as_field"),
                        "asname": g.get("asname"),
                        "isp": _provider_label(g),
                        "ips": set(),
                        "sources": set(),
                    },
                )
                row["ips"].add(ipn)
                row["sources"].update(sources)
        return by_isp, by_asn

    def _shared_provider_rows(
        buckets_a: Dict[str, Dict[str, Any]],
        buckets_b: Dict[str, Dict[str, Any]],
        *,
        shared_ip_values: set,
        label_field: str,
    ) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for key in sorted(set(buckets_a.keys()) & set(buckets_b.keys())):
            a = buckets_a[key]
            b = buckets_b[key]
            ips_a = sorted(a["ips"])
            ips_b = sorted(b["ips"])
            overlap = sorted(set(ips_a) & set(ips_b))
            rows.append(
                {
                    label_field: a.get(label_field) or b.get(label_field) or key,
                    "isp": a.get("isp") or b.get("isp"),
                    "as_field": a.get("as_field") or b.get("as_field"),
                    "asname": a.get("asname") or b.get("asname"),
                    "user_a_ips": ips_a,
                    "user_b_ips": ips_b,
                    "shared_exact_ips": overlap,
                    "same_exact_ip": bool(overlap),
                    "user_a_sources": sorted(a.get("sources") or []),
                    "user_b_sources": sorted(b.get("sources") or []),
                    "mobile": bool(a.get("mobile") or b.get("mobile")),
                    "hosting": bool(a.get("hosting") or b.get("hosting")),
                    "proxy": bool(a.get("proxy") or b.get("proxy")),
                    "different_ips_same_provider": not overlap and bool(ips_a and ips_b),
                }
            )
        rows.sort(
            key=lambda r: (
                0 if r.get("same_exact_ip") else 1,
                -(len(r.get("user_a_ips") or []) + len(r.get("user_b_ips") or [])),
                str(r.get("isp") or r.get("asname") or ""),
            )
        )
        return rows

    async def _account_compare_links(
        ua: Dict[str, Any],
        ub: Dict[str, Any],
        uid_a: str,
        uid_b: str,
        *,
        days: int,
        shared_devices: Dict[str, Any],
        registration_shared: bool,
        shared_ip_count: int,
        shared_isp_count: int,
        shared_asn_count: int,
        money_rows: List[Dict[str, Any]],
        points_rows: List[Dict[str, Any]],
        vault_rows: List[Dict[str, Any]],
        car_rows: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        from utils.referral_ids import normalize_referred_by_ids

        links: List[Dict[str, Any]] = []
        un_a = ua.get("username") or "Account A"
        un_b = ub.get("username") or "Account B"
        since = datetime.now(timezone.utc) - timedelta(days=int(days))
        since_iso = since.isoformat()
        time_q = {"$or": [{"created_at": {"$gte": since}}, {"created_at": {"$gte": since_iso}}]}

        fam_a = (ua.get("family_id") or "").strip()
        fam_b = (ub.get("family_id") or "").strip()
        if not fam_a or not fam_b:
            mem_rows = await db.family_members.find(
                {"user_id": {"$in": [uid_a, uid_b]}},
                {"_id": 0, "user_id": 1, "family_id": 1},
            ).to_list(2)
            for m in mem_rows:
                if m.get("user_id") == uid_a:
                    fam_a = fam_a or (m.get("family_id") or "")
                if m.get("user_id") == uid_b:
                    fam_b = fam_b or (m.get("family_id") or "")
        if fam_a and fam_b and fam_a == fam_b:
            fam = await db.families.find_one({"id": fam_a}, {"_id": 0, "name": 1, "tag": 1})
            fam_name = (fam or {}).get("name") or fam_a
            fam_tag = (fam or {}).get("tag") or "?"
            links.append(
                {
                    "severity": "warn",
                    "code": "same_family",
                    "title": "Same family",
                    "detail": f"Both accounts are in {fam_name} [{fam_tag}].",
                    "meta": {"family_id": fam_a, "family_name": fam_name, "family_tag": fam_tag},
                }
            )

        refs_a = normalize_referred_by_ids(ua.get("referred_by"))
        refs_b = normalize_referred_by_ids(ub.get("referred_by"))
        if uid_b in refs_a:
            links.append(
                {
                    "severity": "warn",
                    "code": "referral_b_by_a",
                    "title": "Referral link",
                    "detail": f"{un_b} was referred by {un_a}.",
                }
            )
        if uid_a in refs_b:
            links.append(
                {
                    "severity": "warn",
                    "code": "referral_a_by_b",
                    "title": "Referral link",
                    "detail": f"{un_a} was referred by {un_b}.",
                }
            )

        a_on_b, b_on_a = await asyncio.gather(
            db.attack_attempts.count_documents({"attacker_id": uid_a, "target_id": uid_b, **time_q}),
            db.attack_attempts.count_documents({"attacker_id": uid_b, "target_id": uid_a, **time_q}),
        )
        if a_on_b:
            links.append(
                {
                    "severity": "warn",
                    "code": "attacks_a_on_b",
                    "title": "Kill activity",
                    "detail": f"{un_a} has {a_on_b} attack attempt(s) on {un_b} in the last {days} days.",
                    "meta": {"count": int(a_on_b)},
                }
            )
        if b_on_a:
            links.append(
                {
                    "severity": "warn",
                    "code": "attacks_b_on_a",
                    "title": "Kill activity",
                    "detail": f"{un_b} has {b_on_a} attack attempt(s) on {un_a} in the last {days} days.",
                    "meta": {"count": int(b_on_a)},
                }
            )

        email_a = (ua.get("email") or "").strip().lower()
        email_b = (ub.get("email") or "").strip().lower()
        if email_a and email_b and "@" in email_a and "@" in email_b:
            dom_a = email_a.split("@", 1)[1]
            dom_b = email_b.split("@", 1)[1]
            if dom_a and dom_a == dom_b:
                links.append(
                    {
                        "severity": "info",
                        "code": "same_email_domain",
                        "title": "Same email domain",
                        "detail": f"Both accounts use @{dom_a}. This is weak evidence on its own.",
                    }
                )

        shared_uas = shared_devices.get("shared_user_agents") or []
        if shared_uas:
            links.append(
                {
                    "severity": "warn",
                    "code": "shared_user_agent",
                    "title": "Same browser fingerprint",
                    "detail": f"{len(shared_uas)} exact matching user-agent string(s) across sessions.",
                }
            )

        if registration_shared:
            links.append(
                {
                    "severity": "warn",
                    "code": "shared_registration_ip",
                    "title": "Same registration IP",
                    "detail": "Both accounts registered from the same normalized IP.",
                }
            )

        if shared_ip_count:
            links.append(
                {
                    "severity": "info" if shared_ip_count < 2 else "warn",
                    "code": "shared_ips",
                    "title": "Shared IP addresses",
                    "detail": f"{shared_ip_count} exact IP address(es) overlap between the accounts.",
                }
            )

        if shared_isp_count:
            links.append(
                {
                    "severity": "warn" if shared_isp_count >= 2 else "info",
                    "code": "shared_isp",
                    "title": "Same internet provider (ISP)",
                    "detail": f"{shared_isp_count} shared ISP/network label(s), including cases where the IP differs but the provider matches.",
                }
            )

        if shared_asn_count:
            links.append(
                {
                    "severity": "info",
                    "code": "shared_asn",
                    "title": "Same ASN / carrier network",
                    "detail": f"{shared_asn_count} shared autonomous-system network(s) between the accounts.",
                }
            )

        if money_rows or points_rows:
            links.append(
                {
                    "severity": "warn",
                    "code": "direct_transfers",
                    "title": "Direct cash/points movement",
                    "detail": f"{len(money_rows)} cash and {len(points_rows)} points transfer row(s) between the accounts.",
                }
            )
        if vault_rows:
            links.append(
                {
                    "severity": "warn",
                    "code": "family_vault_between_accounts",
                    "title": "Family vault activity",
                    "detail": f"{len(vault_rows)} family vault row(s) involve both accounts.",
                }
            )
        if car_rows:
            links.append(
                {
                    "severity": "warn",
                    "code": "exclusive_car_between_accounts",
                    "title": "Exclusive car events",
                    "detail": f"{len(car_rows)} exclusive car event(s) between the accounts.",
                }
            )

        return links

    async def _bilateral_rows(
        collection,
        uid_a: str,
        uid_b: str,
        *,
        date_field: str,
        projection: Dict[str, int],
        days: int,
        limit: int,
    ) -> List[Dict[str, Any]]:
        since = datetime.now(timezone.utc) - timedelta(days=int(days))
        since_iso = since.isoformat()
        q = {
            "$and": [
                {
                    "$or": [
                        {"from_user_id": uid_a, "to_user_id": uid_b},
                        {"from_user_id": uid_b, "to_user_id": uid_a},
                    ]
                },
                {"$or": [{date_field: {"$gte": since}}, {date_field: {"$gte": since_iso}}]},
            ]
        }
        return await collection.find(q, projection).sort(date_field, -1).limit(int(limit)).to_list(int(limit))

    async def _family_vault_between_users(uid_a: str, uid_b: str, days: int, limit: int) -> List[Dict[str, Any]]:
        since = datetime.now(timezone.utc) - timedelta(days=int(days))
        since_iso = since.isoformat()
        q = {
            "$and": [
                {
                    "$or": [
                        {"actor_user_id": uid_a, "target_user_id": uid_b},
                        {"actor_user_id": uid_b, "target_user_id": uid_a},
                    ]
                },
                {"$or": [{"at": {"$gte": since}}, {"at": {"$gte": since_iso}}]},
            ]
        }
        return await db.family_vault_transactions.find(q, {"_id": 0}).sort("at", -1).limit(int(limit)).to_list(int(limit))

    async def _exclusive_car_between_users(uid_a: str, uid_b: str, days: int, limit: int) -> List[Dict[str, Any]]:
        since = datetime.now(timezone.utc) - timedelta(days=int(days))
        since_iso = since.isoformat()
        q = {
            "$and": [
                {
                    "$or": [
                        {"from_user_id": uid_a, "to_user_id": uid_b},
                        {"from_user_id": uid_b, "to_user_id": uid_a},
                    ]
                },
                {"$or": [{"at": {"$gte": since}}, {"at": {"$gte": since_iso}}]},
            ]
        }
        return await db.exclusive_car_events.find(q, {"_id": 0}).sort("at", -1).limit(int(limit)).to_list(int(limit))

    @router.get("/admin/investigate/user-ip-check")
    async def admin_investigate_user_ip_check(
        user_id: Optional[str] = Query(None, description="Exact user id"),
        username: Optional[str] = Query(None, description="Exact username (case-insensitive)"),
        current_user: dict = Depends(require_admin_or_mod),
    ):
        """
        Admin/mod: unique sign-in IPs, per-IP ISP/mobile/hosting (ip-api.com, cached 7d), chronological login_history,
        session IPs, and heuristics (e.g. shift between mobile carriers).
        """
        user = await _resolve_investigate_user(user_id, username)
        return await _build_user_ip_check_payload(user)

    @router.get("/admin/investigate/user-ip-history")
    async def admin_investigate_user_ip_history(
        user_id: Optional[str] = Query(None, description="Exact user id"),
        username: Optional[str] = Query(None, description="Exact username (case-insensitive)"),
        attack_days: int = Query(90, ge=1, le=365, description="Window for attack_attempts client_ip aggregates"),
        current_user: dict = Depends(require_admin_or_mod),
    ):
        """Full IP history for a player: sign-in timeline, stored IPs, sessions, attack IPs, proxy heuristics."""
        user = await _resolve_investigate_user(user_id, username)
        payload = await _build_user_ip_check_payload(user)
        uid = payload["user"]["id"]
        attack = await _attack_ips_for_user(uid, attack_days, 40)
        payload["attack_activity"] = attack
        payload["meta"]["attack_days"] = int(attack_days)
        all_unique = {row.get("ip") for row in (payload.get("ip_summary") or []) if row.get("ip")}
        for block in (attack.get("as_attacker") or []) + (attack.get("as_target") or []):
            if block.get("ip"):
                all_unique.add(block["ip"])
        payload["meta"]["unique_ip_count_including_attacks"] = len(all_unique)
        return payload

    @router.get("/admin/investigate/account-compare")
    async def admin_investigate_account_compare(
        user_a: str = Query(..., min_length=1, description="Username or user id for first account"),
        user_b: str = Query(..., min_length=1, description="Username or user id for second account"),
        days: int = Query(90, ge=1, le=365, description="Window for attack and transaction evidence"),
        current_user: dict = Depends(require_admin_or_mod),
    ):
        """Compare two accounts for shared access signals and direct value movement."""
        def _looks_user_id(raw: str) -> bool:
            s = (raw or "").strip()
            compact = s.replace("-", "")
            return bool(
                re.match(r"^[0-9a-fA-F]{24}$", s)
                or re.match(r"^[0-9a-fA-F]{32}$", compact)
                or re.match(r"^[0-9a-fA-F-]{36}$", s)
            )

        async def _resolve_any(raw: str) -> Dict[str, Any]:
            q = (raw or "").strip()
            if _looks_user_id(q):
                user = await db.users.find_one({"id": q}, _COMPARE_USER_PROJ)
            else:
                user = await db.users.find_one(
                    {"username": re.compile("^" + re.escape(q) + "$", re.IGNORECASE)},
                    _COMPARE_USER_PROJ,
                )
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            return user

        ua = await _resolve_any(user_a)
        ub = await _resolve_any(user_b)
        uid_a = ua.get("id")
        uid_b = ub.get("id")
        if not uid_a or not uid_b:
            raise HTTPException(status_code=404, detail="One or both accounts could not be resolved")
        if uid_a == uid_b:
            raise HTTPException(status_code=400, detail="Choose two different accounts")

        attack_a = await _attack_ips_for_user(uid_a, days, 60)
        attack_b = await _attack_ips_for_user(uid_b, days, 60)
        ip_sources_a = _account_ip_sources(ua, attack_a)
        ip_sources_b = _account_ip_sources(ub, attack_b)
        shared_ip_set = set(ip_sources_a.keys()) & set(ip_sources_b.keys())
        shared_ip_values = sorted(shared_ip_set)
        all_ip_values = sorted(set(ip_sources_a.keys()) | set(ip_sources_b.keys()))
        remaining_ips = [ip for ip in all_ip_values if ip not in shared_ip_set]
        lookup_ips = (shared_ip_values + remaining_ips)[:MAX_IP_GEO_LOOKUPS]
        provider_lookup_truncated = len(all_ip_values) > MAX_IP_GEO_LOOKUPS

        geodata_by_ip: Dict[str, Dict[str, Any]] = {}
        for ipn in lookup_ips:
            geodata_by_ip[ipn] = await get_or_fetch_ip_geodata(db, ipn)

        shared_ips: List[Dict[str, Any]] = []
        for ipn in shared_ip_values:
            g = geodata_by_ip.get(ipn) or await get_or_fetch_ip_geodata(db, ipn)
            geodata_by_ip[ipn] = g
            row = _geodata_row(ipn, g)
            row["user_a_sources"] = sorted(ip_sources_a.get(ipn) or [])
            row["user_b_sources"] = sorted(ip_sources_b.get(ipn) or [])
            shared_ips.append(row)

        isp_a, asn_a = _provider_buckets(ip_sources_a, geodata_by_ip)
        isp_b, asn_b = _provider_buckets(ip_sources_b, geodata_by_ip)
        shared_isps = _shared_provider_rows(isp_a, isp_b, shared_ip_values=shared_ip_set, label_field="isp")
        shared_asns = _shared_provider_rows(asn_a, asn_b, shared_ip_values=shared_ip_set, label_field="asname")

        def _serialize_provider_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
            out: List[Dict[str, Any]] = []
            for row in rows:
                item = dict(row)
                out.append(item)
            return out

        shared_network_providers = {
            "shared_isps": _serialize_provider_rows(shared_isps),
            "shared_asns": _serialize_provider_rows(shared_asns),
            "shared_isp_count": len(shared_isps),
            "shared_asn_count": len(shared_asns),
            "unique_ips_a": len(ip_sources_a),
            "unique_ips_b": len(ip_sources_b),
            "lookup_truncated": provider_lookup_truncated,
            "lookups_performed": len(lookup_ips),
        }

        dev_a = _session_device_summary(ua)
        dev_b = _session_device_summary(ub)
        same_fingerprint = bool(ua.get("device_fingerprint") and ua.get("device_fingerprint") == ub.get("device_fingerprint"))
        shared_devices = {
            "same_device_fingerprint": same_fingerprint,
            "device_fingerprint_a": ua.get("device_fingerprint"),
            "device_fingerprint_b": ub.get("device_fingerprint"),
            "shared_device_types": sorted(dev_a["device_types"] & dev_b["device_types"]),
            "shared_user_agents": sorted(dev_a["user_agents"] & dev_b["user_agents"])[:10],
        }

        money_rows = await _bilateral_rows(
            db.money_transfers,
            uid_a,
            uid_b,
            date_field="created_at",
            projection={"_id": 0},
            days=days,
            limit=100,
        )
        points_rows = await _bilateral_rows(
            db.points_transfers,
            uid_a,
            uid_b,
            date_field="created_at",
            projection={"_id": 0},
            days=days,
            limit=100,
        )
        vault_rows = await _family_vault_between_users(uid_a, uid_b, days, 60)
        car_rows = await _exclusive_car_between_users(uid_a, uid_b, days, 60)

        def _sum_amount(rows: List[Dict[str, Any]], field: str = "amount") -> int:
            total = 0
            for row in rows:
                try:
                    total += int(row.get(field) or 0)
                except Exception:
                    pass
            return total

        def _sum_by_direction(rows: List[Dict[str, Any]], field: str = "amount") -> Dict[str, int]:
            a_to_b = 0
            b_to_a = 0
            for row in rows:
                try:
                    amt = int(row.get(field) or 0)
                except Exception:
                    amt = 0
                if row.get("from_user_id") == uid_a and row.get("to_user_id") == uid_b:
                    a_to_b += amt
                elif row.get("from_user_id") == uid_b and row.get("to_user_id") == uid_a:
                    b_to_a += amt
            return {"a_to_b": a_to_b, "b_to_a": b_to_a}

        quicktrade_rows = [r for r in money_rows + points_rows if (r.get("transfer_kind") == "quicktrade" or r.get("qt_anonymize_from") or r.get("qt_anonymize_to"))]
        direct_money = [r for r in money_rows if not r.get("transfer_kind") and not r.get("transfer_type")]
        registration_shared = bool(
            normalize_ip(ua.get("registration_ip"))
            and normalize_ip(ua.get("registration_ip")) == normalize_ip(ub.get("registration_ip"))
        )

        account_links = await _account_compare_links(
            ua,
            ub,
            uid_a,
            uid_b,
            days=days,
            shared_devices=shared_devices,
            registration_shared=registration_shared,
            shared_ip_count=len(shared_ip_values),
            shared_isp_count=len(shared_isps),
            shared_asn_count=len(shared_asns),
            money_rows=money_rows,
            points_rows=points_rows,
            vault_rows=vault_rows,
            car_rows=car_rows,
        )

        findings: List[Dict[str, Any]] = []
        if same_fingerprint:
            findings.append({"severity": "critical", "code": "same_device_fingerprint", "title": "Same device fingerprint", "detail": "Both accounts have the same stored device fingerprint."})
        if quicktrade_rows:
            findings.append({"severity": "warn", "code": "quicktrade_between_accounts", "title": "Quick Trade between accounts", "detail": f"{len(quicktrade_rows)} transfer row(s) look related to Quick Trade movement."})
        for link in account_links:
            if link.get("code") in {"quicktrade_between_accounts", "same_device_fingerprint"}:
                continue
            findings.append(
                {
                    "severity": link.get("severity") or "info",
                    "code": link.get("code"),
                    "title": link.get("title"),
                    "detail": link.get("detail"),
                }
            )

        return {
            "report_type": "account_compare",
            "window_days": int(days),
            "users": {
                "a": _compare_user_snapshot(ua),
                "b": _compare_user_snapshot(ub),
            },
            "shared_ips": shared_ips,
            "shared_ip_count": len(shared_ip_values),
            "shared_ip_truncated": len(shared_ip_values) > MAX_IP_GEO_LOOKUPS,
            "shared_network_providers": shared_network_providers,
            "account_links": account_links,
            "shared_devices": shared_devices,
            "transactions": {
                "money_transfers": money_rows,
                "points_transfers": points_rows,
                "family_vault_transactions": vault_rows,
                "exclusive_car_events": car_rows,
            },
            "summary": {
                "shared_registration_ip": registration_shared,
                "same_device_fingerprint": same_fingerprint,
                "shared_ip_count": len(shared_ip_values),
                "shared_isp_count": len(shared_isps),
                "shared_asn_count": len(shared_asns),
                "account_link_count": len(account_links),
                "money_transfer_count": len(money_rows),
                "points_transfer_count": len(points_rows),
                "direct_cash_transfer_count": len(direct_money),
                "quicktrade_transfer_count": len(quicktrade_rows),
                "cash_moved_total": _sum_amount(money_rows),
                "points_moved_total": _sum_amount(points_rows),
                "cash_by_direction": _sum_by_direction(money_rows),
                "points_by_direction": _sum_by_direction(points_rows),
                "family_vault_row_count": len(vault_rows),
                "exclusive_car_event_count": len(car_rows),
            },
            "findings": findings,
        }

    @router.get("/admin/investigate/account-access-report")
    async def admin_investigate_account_access_report(
        user_id: Optional[str] = Query(None, description="Exact user id"),
        username: Optional[str] = Query(None, description="Exact username (case-insensitive)"),
        attack_days: int = Query(90, ge=1, le=365, description="Window for attack_attempts client_ip aggregates"),
        current_user: dict = Depends(require_admin_or_mod),
    ):
        """
        Compromise / unauthorized-access investigation for staff: IPs, devices, shared-IP accounts,
        fingerprint matches, tagged login timeline, suspicious logins, and recommended actions.
        """
        from utils.account_access_investigation import enrich_account_access_report

        uid = (user_id or "").strip()
        uname = (username or "").strip()
        if not uid and not uname:
            raise HTTPException(status_code=400, detail="Provide user_id or username")
        q: Dict[str, Any] = {}
        if uid:
            q["id"] = uid
        else:
            q["username"] = re.compile("^" + re.escape(uname) + "$", re.IGNORECASE)
        user = await db.users.find_one(q, _USER_ACCESS_PROJ)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        ip_payload = await _build_user_ip_check_payload(user)
        uid = ip_payload["user"]["id"]
        attack = await _attack_ips_for_user(uid, attack_days, 40)
        ip_payload["attack_activity"] = attack
        ip_payload["meta"]["attack_days"] = int(attack_days)
        all_unique = {row.get("ip") for row in (ip_payload.get("ip_summary") or []) if row.get("ip")}
        for block in (attack.get("as_attacker") or []) + (attack.get("as_target") or []):
            if block.get("ip"):
                all_unique.add(block["ip"])
        ip_payload["meta"]["unique_ip_count_including_attacks"] = len(all_unique)

        access = await enrich_account_access_report(db, user, ip_payload, attack_days=attack_days)
        return {
            "report_type": "account_access",
            "ip": ip_payload,
            "access": access,
        }

    @router.get("/admin/investigate/accounts-by-ip")
    async def admin_investigate_accounts_by_ip(
        ip: str = Query(..., min_length=3, description="IPv4/IPv6 to search"),
        limit: int = Query(50, ge=1, le=200),
        attack_limit: int = Query(40, ge=1, le=100),
        current_user: dict = Depends(require_admin_or_mod),
    ):
        """Find accounts linked to an IP (profile fields, login history, sessions) plus recent attack_attempts from that IP."""
        ipn = normalize_ip(ip.strip())
        if not ipn:
            raise HTTPException(status_code=400, detail="Invalid or empty IP")

        user_proj = {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "created_at": 1,
            "is_dead": 1,
            "registration_ip": 1,
            "last_login_ip": 1,
            "last_request_ip": 1,
        }
        q = {
            "$or": [
                {"registration_ip": ipn},
                {"last_login_ip": ipn},
                {"last_request_ip": ipn},
                {"login_ips": ipn},
                {"login_history.ip": ipn},
                {"sessions.ip": ipn},
            ]
        }
        users_raw = await db.users.find(q, user_proj).limit(int(limit)).to_list(int(limit))

        def _roles_for_user(u: Dict[str, Any]) -> List[str]:
            roles: List[str] = []
            if normalize_ip(u.get("registration_ip")) == ipn:
                roles.append("registration")
            if normalize_ip(u.get("last_login_ip")) == ipn:
                roles.append("last_login")
            if normalize_ip(u.get("last_request_ip")) == ipn:
                roles.append("last_request")
            return roles

        accounts = []
        seen_ids: set = set()
        for u in users_raw:
            uid = u.get("id")
            if not uid or uid in seen_ids:
                continue
            seen_ids.add(uid)
            accounts.append(
                {
                    "id": uid,
                    "username": u.get("username"),
                    "email": u.get("email"),
                    "created_at": u.get("created_at"),
                    "is_dead": u.get("is_dead"),
                    "roles": _roles_for_user(u),
                }
            )

        attack_rows = await db.attack_attempts.aggregate(
            [
                {"$match": {"client_ip": ipn}},
                {
                    "$group": {
                        "_id": "$attacker_id",
                        "username": {"$max": "$attacker_username"},
                        "count": {"$sum": 1},
                        "last_at": {"$max": "$created_at"},
                    }
                },
                {"$sort": {"count": -1}},
                {"$limit": int(attack_limit)},
            ]
        ).to_list(int(attack_limit))
        attack_attackers = [
            {
                "attacker_id": r.get("_id"),
                "username": r.get("username"),
                "count": int(r.get("count") or 0),
                "last_at": r.get("last_at"),
            }
            for r in attack_rows
            if r.get("_id")
        ]
        for aa in attack_attackers:
            aid = aa.get("attacker_id")
            if aid and aid not in seen_ids:
                seen_ids.add(aid)
                accounts.append(
                    {
                        "id": aid,
                        "username": aa.get("username"),
                        "email": None,
                        "created_at": None,
                        "is_dead": None,
                        "roles": ["attack_attempts"],
                    }
                )

        g = await get_or_fetch_ip_geodata(db, ipn)
        return {
            "ip": ipn,
            "account_count": len(accounts),
            "accounts": accounts[: int(limit)],
            "attack_attackers": attack_attackers,
            "geo": {
                "network": network_label(g) if g.get("ok") else None,
                "country": g.get("country"),
                "countryCode": g.get("countryCode"),
                "regionName": g.get("regionName"),
                "city": g.get("city"),
                "isp": g.get("isp"),
                "org": g.get("org"),
                "as_field": g.get("as_field"),
                "asname": g.get("asname"),
                "mobile": g.get("mobile"),
                "hosting": g.get("hosting"),
                "proxy": g.get("proxy"),
                "geo_ok": g.get("ok"),
                "geo_error": g.get("error"),
            },
        }

    ATTACK_CLIENT_AUDIT = "attack_client_audit"

    @router.get("/admin/investigate/attack-client-spoof-report")
    async def admin_attack_client_spoof_report(
        hours: int = Query(24, ge=1, le=168),
        current_user: dict = Depends(require_admin_or_mod),
    ):
        """
        Summarize execute_token integrity failures plus client signal / IP / user correlation.
        Optional: counts rows in attack_client_audit (search starts) in the same window.
        Admin or moderator.
        """
        now = datetime.now(timezone.utc)
        since = now - timedelta(hours=hours)
        since_iso = since.isoformat()
        time_or = {"$or": [{"created_at": {"$gte": since}}, {"created_at": {"$gte": since_iso}}]}

        token_q: Dict[str, Any] = {
            "outcome": "error",
            "integrity_violation": "execute_token",
            **time_or,
        }
        token_fail_count = await db.attack_attempts.count_documents(token_q)

        top_ips = await db.attack_attempts.aggregate(
            [
                {"$match": token_q},
                {"$group": {"_id": "$client_ip", "count": {"$sum": 1}}},
                {"$sort": {"count": -1}},
                {"$limit": 25},
            ]
        ).to_list(25)

        top_attackers = await db.attack_attempts.aggregate(
            [
                {"$match": token_q},
                {"$group": {"_id": "$attacker_id", "username": {"$max": "$attacker_username"}, "count": {"$sum": 1}}},
                {"$sort": {"count": -1}},
                {"$limit": 25},
            ]
        ).to_list(25)

        signal_breakdown = await db.attack_attempts.aggregate(
            [
                {"$match": token_q},
                {"$group": {"_id": "$attacker_client_signal", "count": {"$sum": 1}}},
            ]
        ).to_list(12)

        samples = (
            await db.attack_attempts.find(
                token_q,
                {
                    "_id": 0,
                    "id": 1,
                    "created_at": 1,
                    "attacker_id": 1,
                    "attacker_username": 1,
                    "target_username": 1,
                    "client_ip": 1,
                    "attacker_client_signal": 1,
                    "attacker_client_signal_detail": 1,
                    "client_risk_score": 1,
                    "client_anomaly_flags": 1,
                    "token_failure_reason": 1,
                    "player_message": 1,
                },
            )
            .sort("created_at", -1)
            .limit(12)
            .to_list(12)
        )

        audit_q = {"$or": [{"created_at": {"$gte": since}}, {"created_at": {"$gte": since_iso}}]}
        try:
            search_audit_count = await db[ATTACK_CLIENT_AUDIT].count_documents(audit_q)
            high_risk_q = {
                **audit_q,
                "client_risk_score": {"$gte": 35},
            }
            high_risk_search_count = await db[ATTACK_CLIENT_AUDIT].count_documents(high_risk_q)
            high_risk_search_samples = await db[ATTACK_CLIENT_AUDIT].find(
                high_risk_q,
                {
                    "_id": 0,
                    "created_at": 1,
                    "user_id": 1,
                    "username": 1,
                    "target_username": 1,
                    "client_ip": 1,
                    "attacker_client_signal": 1,
                    "client_risk_score": 1,
                    "client_anomaly_flags": 1,
                    "client_header_snapshot": 1,
                },
            ).sort("created_at", -1).limit(12).to_list(12)
        except Exception:
            search_audit_count = None
            high_risk_search_count = None
            high_risk_search_samples = []

        try:
            turnstile_q = {
                "$and": [
                    {"$or": [{"at": {"$gte": since}}, {"at": {"$gte": since_iso}}]},
                    {"path": {"$regex": r"/attack/", "$options": "i"}},
                ]
            }
            attack_turnstile_failures = await db["captcha_turnstile_failures"].count_documents(turnstile_q)
            attack_turnstile_failure_samples = await db["captcha_turnstile_failures"].find(
                turnstile_q,
                {
                    "_id": 0,
                    "at": 1,
                    "user_id": 1,
                    "username": 1,
                    "reason": 1,
                    "path": 1,
                    "ip": 1,
                    "turnstile_error_codes": 1,
                    "detail": 1,
                },
            ).sort("at", -1).limit(12).to_list(12)
        except Exception:
            attack_turnstile_failures = None
            attack_turnstile_failure_samples = []

        return {
            "window_hours": hours,
            "since": since_iso,
            "execute_token_failures": token_fail_count,
            "top_ips": [{"client_ip": (x.get("_id") or "—"), "count": x.get("count", 0)} for x in top_ips],
            "top_attackers": [
                {"attacker_id": x.get("_id"), "username": x.get("username"), "count": x.get("count", 0)}
                for x in top_attackers
            ],
            "client_signal_breakdown_on_token_fails": [
                {"signal": (x.get("_id") or "unknown"), "count": x.get("count", 0)} for x in signal_breakdown
            ],
            "recent_token_fail_samples": samples,
            "attack_search_audit_rows_in_window": search_audit_count,
            "high_risk_attack_search_rows": high_risk_search_count,
            "recent_high_risk_attack_search_samples": high_risk_search_samples,
            "attack_turnstile_failures": attack_turnstile_failures,
            "recent_attack_turnstile_failure_samples": attack_turnstile_failure_samples,
            "note": "Strict header checks are opt-in via ATTACK_STRICT_* env vars in attack router. "
            "attack_client_audit logs each successful /attack/search with client_header_snapshot. "
            "Attack Turnstile failures are also included when the attack gate is enabled.",
        }

    @router.get("/admin/investigate/ip-lookup")
    async def admin_investigate_ip_lookup(
        ip: str = Query(..., description="IPv4/IPv6 to look up"),
        current_user: dict = Depends(require_admin_or_mod),
    ):
        """Admin/mod: ip-api + GetIPIntel + ipapi.is + in-game proxy assessment for one IP."""
        from utils.proxy_detection import build_admin_ip_lookup_report

        try:
            return await build_admin_ip_lookup_report(db, ip)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
