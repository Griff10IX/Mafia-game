# Security Admin endpoints: view logs, ban/unban users, security stats
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
from typing import Optional

from fastapi import Depends, HTTPException

# Import dependencies inside register() to avoid circular imports
db = None
get_current_user = None
ADMIN_EMAILS = None
ban_user = None
send_telegram_alert = None
get_security_stats = None


class BanUserRequest(BaseModel):
    user_id: str
    username: str
    reason: str
    duration_hours: Optional[int] = None  # None = permanent


class UnbanUserRequest(BaseModel):
    user_id: str


class TestTelegramRequest(BaseModel):
    message: str


async def get_security_dashboard(current_user: dict = Depends(get_current_user)):
    """Get security stats and recent alerts for admin dashboard"""
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    stats = await get_security_stats(db)
    return stats


async def get_security_logs(current_user: dict = Depends(get_current_user)):
    """Get all security logs (paginated)"""
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    logs = await db.security_logs.find({}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return {"logs": logs}


async def get_active_bans(current_user: dict = Depends(get_current_user)):
    """Get all active bans"""
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    bans = await db.bans.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"bans": bans}


async def ban_user_admin(request: BanUserRequest, current_user: dict = Depends(get_current_user)):
    """Manually ban a user"""
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    await ban_user(
        db,
        request.user_id,
        request.username,
        request.reason,
        request.duration_hours,
        current_user.get("username", "Admin")
    )
    
    duration_str = f"{request.duration_hours}h" if request.duration_hours else "permanent"
    return {"message": f"Banned {request.username} ({duration_str})"}


async def unban_user_admin(request: UnbanUserRequest, current_user: dict = Depends(get_current_user)):
    """Unban a user"""
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await db.bans.update_many(
        {"user_id": request.user_id, "active": True},
        {"$set": {"active": False, "unbanned_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    if result.modified_count > 0:
        return {"message": f"Unbanned user (removed {result.modified_count} ban(s))"}
    else:
        raise HTTPException(status_code=404, detail="No active ban found for this user")


async def clear_security_logs(current_user: dict = Depends(get_current_user)):
    """Clear all security logs (keeping bans)"""
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await db.security_logs.delete_many({})
    return {"message": f"Cleared {result.deleted_count} security log(s)"}


async def test_telegram(request: TestTelegramRequest, current_user: dict = Depends(get_current_user)):
    """Test Telegram integration"""
    if current_user["email"] not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    await send_telegram_alert(f"Test from {current_user.get('username')}: {request.message}", "info")
    return {"message": "Test message sent to Telegram"}


def register(router):
    """Register security admin routes"""
    import server as srv
    from security import ban_user as _ban_user, send_telegram_alert as _send, get_security_stats as _stats
    
    global db, get_current_user, ADMIN_EMAILS, ban_user, send_telegram_alert, get_security_stats
    db = srv.db
    get_current_user = srv.get_current_user
    ADMIN_EMAILS = srv.ADMIN_EMAILS
    ban_user = _ban_user
    send_telegram_alert = _send
    get_security_stats = _stats
    
    router.add_api_route("/admin/security/dashboard", get_security_dashboard, methods=["GET"])
    router.add_api_route("/admin/security/logs", get_security_logs, methods=["GET"])
    router.add_api_route("/admin/security/bans", get_active_bans, methods=["GET"])
    router.add_api_route("/admin/security/ban", ban_user_admin, methods=["POST"])
    router.add_api_route("/admin/security/unban", unban_user_admin, methods=["POST"])
    router.add_api_route("/admin/security/clear-logs", clear_security_logs, methods=["POST"])
    router.add_api_route("/admin/security/test-telegram", test_telegram, methods=["POST"])
