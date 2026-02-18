# Security Admin endpoints: view logs, ban/unban users, security stats
from datetime import datetime, timezone, timedelta
import uuid
from pydantic import BaseModel
from typing import Optional

from fastapi import Depends, HTTPException


class BanUserRequest(BaseModel):
    user_id: str
    username: str
    reason: str
    duration_hours: Optional[int] = None  # None = permanent


class UnbanUserRequest(BaseModel):
    user_id: str


class BanIPRequest(BaseModel):
    ip: str
    reason: str
    duration_hours: Optional[int] = None  # None = permanent


class UnbanIPRequest(BaseModel):
    ip: str


class TestTelegramRequest(BaseModel):
    message: str


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


def register(router):
    """Register security admin routes. Dependencies injected here to avoid circular imports."""
    import server as srv
    from security import send_telegram_alert as _send_telegram, get_security_summary

    db = srv.db
    get_current_user = srv.get_current_user
    ADMIN_EMAILS = srv.ADMIN_EMAILS

    async def get_security_dashboard(current_user: dict = Depends(get_current_user)):
        if current_user.get("email") not in ADMIN_EMAILS:
            raise HTTPException(status_code=403, detail="Admin access required")
        return await get_security_summary(db)

    async def get_security_logs(current_user: dict = Depends(get_current_user)):
        if current_user.get("email") not in ADMIN_EMAILS:
            raise HTTPException(status_code=403, detail="Admin access required")
        logs = await db.security_logs.find({}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
        return {"logs": logs}

    async def get_active_bans(current_user: dict = Depends(get_current_user)):
        if current_user.get("email") not in ADMIN_EMAILS:
            raise HTTPException(status_code=403, detail="Admin access required")
        bans = await db.bans.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"bans": bans}

    async def ban_user_admin(request: BanUserRequest, current_user: dict = Depends(get_current_user)):
        if current_user.get("email") not in ADMIN_EMAILS:
            raise HTTPException(status_code=403, detail="Admin access required")
        await _ban_user_impl(db, request.user_id, request.username, request.reason, request.duration_hours, current_user.get("username", "Admin"))
        duration_str = f"{request.duration_hours}h" if request.duration_hours else "permanent"
        return {"message": f"Banned {request.username} ({duration_str})"}

    async def unban_user_admin(request: UnbanUserRequest, current_user: dict = Depends(get_current_user)):
        if current_user.get("email") not in ADMIN_EMAILS:
            raise HTTPException(status_code=403, detail="Admin access required")
        result = await db.bans.update_many(
            {"user_id": request.user_id, "active": True},
            {"$set": {"active": False, "unbanned_at": datetime.now(timezone.utc).isoformat()}}
        )
        if result.modified_count > 0:
            return {"message": f"Unbanned user (removed {result.modified_count} ban(s))"}
        raise HTTPException(status_code=404, detail="No active ban found for this user")

    async def get_ip_bans(current_user: dict = Depends(get_current_user)):
        if current_user.get("email") not in ADMIN_EMAILS:
            raise HTTPException(status_code=403, detail="Admin access required")
        bans = await db.ip_bans.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"ip_bans": bans}

    async def ban_ip_admin(request: BanIPRequest, current_user: dict = Depends(get_current_user)):
        if current_user.get("email") not in ADMIN_EMAILS:
            raise HTTPException(status_code=403, detail="Admin access required")
        ip = (request.ip or "").strip()
        if not ip:
            raise HTTPException(status_code=400, detail="IP is required")
        now = datetime.now(timezone.utc)
        doc = {
            "ip": ip,
            "reason": request.reason or "Banned by admin",
            "banned_by": current_user.get("username", "Admin"),
            "created_at": now.isoformat(),
            "active": True,
        }
        if request.duration_hours is not None:
            doc["expires_at"] = (now + timedelta(hours=request.duration_hours)).isoformat()
        await db.ip_bans.insert_one(doc)
        duration_str = f"{request.duration_hours}h" if request.duration_hours else "permanent"
        return {"message": f"IP {ip} banned ({duration_str})"}

    async def unban_ip_admin(request: UnbanIPRequest, current_user: dict = Depends(get_current_user)):
        if current_user.get("email") not in ADMIN_EMAILS:
            raise HTTPException(status_code=403, detail="Admin access required")
        ip = (request.ip or "").strip()
        if not ip:
            raise HTTPException(status_code=400, detail="IP is required")
        result = await db.ip_bans.update_many(
            {"ip": ip, "active": True},
            {"$set": {"active": False, "unbanned_at": datetime.now(timezone.utc).isoformat()}}
        )
        if result.modified_count > 0:
            return {"message": f"IP {ip} unbanned (removed {result.modified_count} ban(s))"}
        raise HTTPException(status_code=404, detail="No active ban found for this IP")

    async def clear_security_logs(current_user: dict = Depends(get_current_user)):
        if current_user.get("email") not in ADMIN_EMAILS:
            raise HTTPException(status_code=403, detail="Admin access required")
        result = await db.security_logs.delete_many({})
        return {"message": f"Cleared {result.deleted_count} security log(s)"}

    async def test_telegram(request: TestTelegramRequest, current_user: dict = Depends(get_current_user)):
        if current_user.get("email") not in ADMIN_EMAILS:
            raise HTTPException(status_code=403, detail="Admin access required")
        await _send_telegram(f"Test from {current_user.get('username')}: {request.message}", "info")
        return {"message": "Test message sent to Telegram"}

    router.add_api_route("/admin/security/dashboard", get_security_dashboard, methods=["GET"])
    router.add_api_route("/admin/security/logs", get_security_logs, methods=["GET"])
    router.add_api_route("/admin/security/bans", get_active_bans, methods=["GET"])
    router.add_api_route("/admin/security/ban", ban_user_admin, methods=["POST"])
    router.add_api_route("/admin/security/unban", unban_user_admin, methods=["POST"])
    router.add_api_route("/admin/security/ip-bans", get_ip_bans, methods=["GET"])
    router.add_api_route("/admin/security/ban-ip", ban_ip_admin, methods=["POST"])
    router.add_api_route("/admin/security/unban-ip", unban_ip_admin, methods=["POST"])
    router.add_api_route("/admin/security/clear-logs", clear_security_logs, methods=["POST"])
    router.add_api_route("/admin/security/test-telegram", test_telegram, methods=["POST"])
