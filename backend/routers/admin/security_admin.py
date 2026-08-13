# Security Admin endpoints: view logs, ban/unban users, security stats
from datetime import datetime, timezone, timedelta
import logging
import re
import uuid
from pydantic import BaseModel
from typing import Optional

logger = logging.getLogger(__name__)

from fastapi import Depends, HTTPException, Request

from utils.ip_normalize import normalize_ip_string


class BanUserRequest(BaseModel):
    user_id: str
    username: str
    reason: str
    duration_hours: Optional[int] = None  # None = permanent


class UnbanUserRequest(BaseModel):
    user_id: str


_IP_BAN_UNIT_HOURS = {
    "hours": 1,
    "days": 24,
    "weeks": 168,
    "months": 30 * 24,
    "years": 365 * 24,
}


class BanIPRequest(BaseModel):
    """Ban by username (all known IPs for that account) or by a single IP. Prefer `username` when set."""
    ip: Optional[str] = None
    username: Optional[str] = None
    reason: str = ""
    duration_hours: Optional[int] = None  # None = permanent (legacy; prefer duration_amount + duration_unit)
    duration_amount: Optional[int] = None
    duration_unit: Optional[str] = None  # hours, days, weeks, months, years, permanent


def _resolve_ip_ban_duration(request: BanIPRequest) -> tuple[Optional[int], str]:
    """Return (duration_hours, label). hours is None for a permanent ban."""
    unit = (request.duration_unit or "").strip().lower()
    if unit == "permanent":
        return None, "permanent"
    if unit in _IP_BAN_UNIT_HOURS:
        amount = request.duration_amount
        if amount is None or int(amount) < 1:
            raise HTTPException(status_code=400, detail="Enter how long the IP ban lasts")
        amount = int(amount)
        if amount > 1000:
            raise HTTPException(status_code=400, detail="Duration amount is too large")
        hours = amount * _IP_BAN_UNIT_HOURS[unit]
        noun = unit[:-1] if amount == 1 and unit.endswith("s") else unit
        return hours, f"{amount} {noun}"
    if request.duration_hours is not None:
        hours = int(request.duration_hours)
        if hours < 1:
            raise HTTPException(status_code=400, detail="duration_hours must be at least 1")
        return hours, f"{hours}h"
    return None, "permanent"


class UnbanIPRequest(BaseModel):
    """Unban by canonical IP string, or by username (clears all active IP bans tied to that account ban)."""
    ip: Optional[str] = None
    username: Optional[str] = None


async def _ban_user_impl(db, user_id: str, username: str, reason: str, duration_hours: Optional[int], banned_by: str):
    """Write ban to db.bans. security module has no ban_user; this implements it for the admin router."""
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": uuid.uuid4().hex,
        "user_id": user_id,
        "username": username,
        "reason": reason,
        "banned_by": banned_by,
        "created_at": now,
        "active": True,
    }
    if duration_hours is not None:
        doc["expires_at"] = (datetime.now(timezone.utc) + timedelta(hours=duration_hours)).isoformat()
    await db.bans.insert_one(doc)


async def _deactivate_prior_bans(db, user_id: str) -> None:
    """Close older active ban rows so a new ban can be inserted without duplicate actives."""
    await db.bans.update_many(
        {"user_id": user_id, "active": True},
        {"$set": {"active": False, "superseded_at": datetime.now(timezone.utc).isoformat()}},
    )


def register(router):
    """Register security admin routes. Dependencies injected here to avoid circular imports."""
    import server as srv
    from middleware.security import get_security_summary

    db = srv.db
    require_admin = srv.require_admin

    async def get_security_dashboard(current_user: dict = Depends(require_admin)):
        return await get_security_summary(db)

    async def get_security_logs(current_user: dict = Depends(require_admin)):
        logs = await db.security_logs.find({}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
        return {"logs": logs}

    async def get_active_bans(current_user: dict = Depends(require_admin)):
        bans = await db.bans.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"bans": bans}

    async def ban_user_admin(request: BanUserRequest, current_user: dict = Depends(require_admin)):
        await _ban_user_impl(db, request.user_id, request.username, request.reason, request.duration_hours, current_user.get("username", "Admin"))
        duration_str = f"{request.duration_hours}h" if request.duration_hours else "permanent"
        return {"message": f"Banned {request.username} ({duration_str})"}

    async def unban_user_admin(request: UnbanUserRequest, current_user: dict = Depends(require_admin)):
        result = await db.bans.update_many(
            {"user_id": request.user_id, "active": True},
            {"$set": {"active": False, "unbanned_at": datetime.now(timezone.utc).isoformat()}}
        )
        if result.modified_count > 0:
            return {"message": f"Unbanned user (removed {result.modified_count} ban(s))"}
        raise HTTPException(status_code=404, detail="No active ban found for this user")

    async def get_ip_bans(current_user: dict = Depends(require_admin)):
        bans = await db.ip_bans.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"ip_bans": bans}

    async def ban_ip_admin(request: BanIPRequest, current_user: dict = Depends(require_admin)):
        from utils.cheat_detection_utils import user_ip_union

        uname = (request.username or "").strip()
        raw_ip = (request.ip or "").strip()
        now = datetime.now(timezone.utc)
        raw_reason = (request.reason or "").strip()
        reason = raw_reason or "Banned by admin"
        duration_hours, duration_str = _resolve_ip_ban_duration(request)
        expires_at = (now + timedelta(hours=duration_hours)).isoformat() if duration_hours is not None else None
        banned_by = current_user.get("username", "Admin")

        def _ban_doc(ip_val: str, extra: Optional[dict] = None) -> dict:
            doc = {
                "ip": ip_val,
                "reason": reason,
                "banned_by": banned_by,
                "created_at": now.isoformat(),
                "active": True,
                "duration_label": duration_str,
            }
            if expires_at:
                doc["expires_at"] = expires_at
            if extra:
                doc.update(extra)
            return doc

        if uname:
            pat = srv._username_pattern(uname)
            if not pat:
                raise HTTPException(status_code=400, detail="Username is required")
            user = await db.users.find_one(
                {"username": pat},
                {
                    "_id": 0,
                    "id": 1,
                    "username": 1,
                    "registration_ip": 1,
                    "last_login_ip": 1,
                    "last_request_ip": 1,
                    "login_ips": 1,
                    "sessions": 1,
                },
            )
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            ips_raw, _ = user_ip_union(user, include_session_ips=True)
            ips_norm: list[str] = []
            seen: set[str] = set()
            for raw in ips_raw:
                n = normalize_ip_string(raw)
                if n and n not in seen:
                    seen.add(n)
                    ips_norm.append(n)
            if not ips_norm:
                raise HTTPException(
                    status_code=400,
                    detail="No IP addresses on record for this account (registration, login, sessions).",
                )
            inserted = 0
            skipped = 0
            display_name = user.get("username") or uname
            src: dict = {"source_username": display_name}
            if user.get("id"):
                src["source_user_id"] = user["id"]
            for ip_val in ips_norm:
                existing = await db.ip_bans.find_one({"ip": ip_val, "active": True}, {"_id": 1})
                if existing:
                    skipped += 1
                    continue
                await db.ip_bans.insert_one(_ban_doc(ip_val, src))
                inserted += 1
            from utils.ban_user_wipe import apply_ban_and_invalidate_sessions, wipe_user_for_account_ban

            uid = user["id"]
            await _deactivate_prior_bans(db, uid)
            await _ban_user_impl(db, uid, display_name, reason, duration_hours, banned_by)
            wipe_summary = await wipe_user_for_account_ban(db, uid, preserve_dead=True)
            await apply_ban_and_invalidate_sessions(db, uid)
            try:
                from utils.ensure_topic_of_shame import append_ip_ban_shame_entry

                await append_ip_ban_shame_entry(
                    db,
                    username=display_name,
                    duration_label=duration_str,
                    reason=raw_reason,
                )
            except Exception:
                logger.exception("topic of shame: IP ban entry failed user=%s", display_name)
            msg = (
                f"Banned {inserted} new IP ban(s) for {display_name} ({duration_str})"
                + (f"; {skipped} IP(s) already banned" if skipped else "")
                + ". Account banned, stats/leaderboards cleared, sessions ended (IP ban records unchanged)."
            )
            return {
                "message": msg,
                "banned_ips": ips_norm,
                "inserted": inserted,
                "skipped_already_banned": skipped,
                "username": display_name,
                "account_ban": True,
                "wipe": wipe_summary,
            }

        ip = normalize_ip_string(raw_ip)
        if not ip:
            raise HTTPException(status_code=400, detail="Enter a username or a valid IP address")
        await db.ip_bans.insert_one(_ban_doc(ip))
        return {"message": f"IP {ip} banned ({duration_str})", "banned_ips": [ip], "inserted": 1}

    async def unban_ip_admin(request: UnbanIPRequest, current_user: dict = Depends(require_admin)):
        now_iso = datetime.now(timezone.utc).isoformat()
        set_ban = {"$set": {"active": False, "unbanned_at": now_iso}}

        uname = (request.username or "").strip()
        if uname:
            pat = srv._username_pattern(uname)
            if not pat:
                raise HTTPException(status_code=400, detail="Username is required")
            user = await db.users.find_one(
                {"username": pat},
                {"_id": 0, "id": 1, "username": 1},
            )
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            uid = user["id"]
            display = (user.get("username") or "").strip() or uname
            or_filters = [{"source_user_id": uid}]
            if display:
                esc = re.escape(display)
                or_filters.append({"source_username": {"$regex": f"^{esc}$", "$options": "i"}})
            result = await db.ip_bans.update_many(
                {"active": True, "$or": or_filters},
                set_ban,
            )
            if result.modified_count > 0:
                return {
                    "message": f"Unbanned {result.modified_count} IP ban(s) linked to {display}",
                    "unbanned": result.modified_count,
                }
            raise HTTPException(
                status_code=404,
                detail="No active IP bans found for this user (only bans created via 'ban user IPs' are linked by username).",
            )

        ip = normalize_ip_string(request.ip or "")
        if not ip:
            raise HTTPException(status_code=400, detail="IP is required (or provide username to unban all IPs from a user ban)")

        result = await db.ip_bans.update_many({"ip": ip, "active": True}, set_ban)
        total = int(result.modified_count or 0)

        if total == 0:
            # Legacy rows may store a non-canonical string that still maps to the same address.
            ids = []
            async for doc in db.ip_bans.find({"active": True}, {"_id": 1, "ip": 1}):
                if normalize_ip_string(doc.get("ip")) == ip:
                    ids.append(doc["_id"])
            if ids:
                r2 = await db.ip_bans.update_many({"_id": {"$in": ids}}, set_ban)
                total = int(r2.modified_count or 0)

        if total > 0:
            return {"message": f"IP {ip} unbanned (removed {total} ban(s))", "unbanned": total}
        raise HTTPException(status_code=404, detail="No active ban found for this IP")

    def _client_ip(req: Request) -> str:
        # Cloudflare provides real IP in CF-Connecting-IP
        cf_ip = req.headers.get("cf-connecting-ip")
        if cf_ip:
            n = normalize_ip_string(cf_ip)
            if n:
                return n
        forwarded = req.headers.get("x-forwarded-for")
        if forwarded:
            n = normalize_ip_string(forwarded)
            if n:
                return n
        if req.client:
            return normalize_ip_string(req.client.host or "") or ""
        return ""

    async def test_ip_ban(request: Request, current_user: dict = Depends(require_admin)):
        """Ban the current request's IP for 30 seconds (for testing). Auto-unbans after 30s."""
        client_ip = _client_ip(request)
        if not client_ip:
            raise HTTPException(status_code=400, detail="Could not determine your IP")
        now = datetime.now(timezone.utc)
        expires_at = (now + timedelta(seconds=30)).isoformat()
        doc = {
            "ip": client_ip,
            "reason": "Test ban (auto-unban in 30s)",
            "banned_by": current_user.get("username", "Admin"),
            "created_at": now.isoformat(),
            "active": True,
            "expires_at": expires_at,
        }
        await db.ip_bans.insert_one(doc)
        return {"message": "Your IP is banned for 30 seconds. You will get 403 until then; refresh or wait 30s to be unbanned.", "ip": client_ip}

    async def clear_security_logs(current_user: dict = Depends(require_admin)):
        result = await db.security_logs.delete_many({})
        return {"message": f"Cleared {result.deleted_count} security log(s)"}

    router.add_api_route("/admin/security/dashboard", get_security_dashboard, methods=["GET"])
    router.add_api_route("/admin/security/logs", get_security_logs, methods=["GET"])
    router.add_api_route("/admin/security/bans", get_active_bans, methods=["GET"])
    router.add_api_route("/admin/security/ban", ban_user_admin, methods=["POST"])
    router.add_api_route("/admin/security/unban", unban_user_admin, methods=["POST"])
    router.add_api_route("/admin/security/ip-bans", get_ip_bans, methods=["GET"])
    router.add_api_route("/admin/security/ban-ip", ban_ip_admin, methods=["POST"])
    router.add_api_route("/admin/security/unban-ip", unban_ip_admin, methods=["POST"])
    router.add_api_route("/admin/security/test-ip-ban", test_ip_ban, methods=["POST"])
    router.add_api_route("/admin/security/clear-logs", clear_security_logs, methods=["POST"])
