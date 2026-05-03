# Admin/mod: bot & scripting investigation — aggregated per-user profile and bot-block audit trail.
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
    get_current_user = srv.get_current_user
    _is_admin = srv._is_admin
    _is_moderator = srv._is_moderator

    def _admin_or_mod(user: dict) -> bool:
        return _is_admin(user) or _is_moderator(user)

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
        current_user: dict = Depends(get_current_user),
    ):
        """
        Single payload for bot/script review: user snapshot, security flags, activity density,
        minigame play timing stats, suspicious login touches, auto-rank telegram link flag.
        Admin or moderator.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
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
        current_user: dict = Depends(get_current_user),
    ):
        """Recent script/bot client block events (TTL collection). Admin or moderator."""
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        q: Dict[str, Any] = {}
        uid = (user_id or "").strip()
        if uid:
            q["user_id"] = uid
        cur = db[BOT_BLOCK_COLLECTION].find(q, {"_id": 0}).sort("created_at", -1).limit(limit)
        rows = await cur.to_list(limit)
        return {"events": rows, "count": len(rows)}

    MAX_IP_GEO_LOOKUPS = 40

    @router.get("/admin/investigate/user-ip-check")
    async def admin_investigate_user_ip_check(
        user_id: Optional[str] = Query(None, description="Exact user id"),
        username: Optional[str] = Query(None, description="Exact username (case-insensitive)"),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Admin/mod: unique sign-in IPs, per-IP ISP/mobile/hosting (ip-api.com, cached 7d), chronological login_history,
        session IPs, and heuristics (e.g. shift between mobile carriers).
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
        uid = (user_id or "").strip()
        uname = (username or "").strip()
        if not uid and not uname:
            raise HTTPException(status_code=400, detail="Provide user_id or username")
        q: Dict[str, Any] = {}
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
            "login_ips": 1,
            "login_history": 1,
            "sessions": 1,
            "last_user_agent": 1,
            "last_device_type": 1,
        }
        user = await db.users.find_one(q, proj)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

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

        return {
            "user": {"id": uid, "username": uname},
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
        }

    ATTACK_CLIENT_AUDIT = "attack_client_audit"

    @router.get("/admin/investigate/attack-client-spoof-report")
    async def admin_attack_client_spoof_report(
        hours: int = Query(24, ge=1, le=168),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Summarize execute_token integrity failures plus client signal / IP / user correlation.
        Optional: counts rows in attack_client_audit (search starts) in the same window.
        Admin or moderator.
        """
        if not _admin_or_mod(current_user):
            raise HTTPException(status_code=403, detail="Admin or moderator access required")
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
                    "client_ip": 1,
                    "attacker_client_signal": 1,
                    "client_risk_score": 1,
                    "client_anomaly_flags": 1,
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
        except Exception:
            search_audit_count = None

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
            "note": "Strict header checks are opt-in via ATTACK_STRICT_* env vars in attack router. "
            "attack_client_audit logs each successful /attack/search with client_header_snapshot.",
        }
