# Notifications/inbox: list, mark read, delete, send message, thread. Profile notification preferences.
from datetime import datetime, timezone, timedelta
import uuid
import time
from typing import Optional
from pydantic import BaseModel

from fastapi import Depends, HTTPException

from server import (
    db,
    get_current_user,
    send_notification,
    send_notification_to_all,
    _username_pattern,
    ADMIN_EMAILS,
    _is_admin,
    _is_moderator,
    user_has_admin_list_email,
)
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_NOTIFICATIONS

# ----- Constants -----
# Read items: removed 5 days after marked read (read_at). Keeps inbox DB lean.
READ_NOTIFICATION_RETENTION_DAYS = 5
# Unread items: removed if still unread after this many days (prevents abandoned inbox bloat)
UNREAD_NOTIFICATION_RETENTION_DAYS = 60
DEFAULT_NOTIFICATION_PREFS = {
    "ent_games": True,
    "oc_invites": True,
    "attacks": True,
    "system": True,
    "quicktrade": True,
    "messages": True,
    "forum_topic_reply": True,
    "forum_comment_reply": True,
    "forum_mention": True,
    "designer_comp": True,
}

# ----- Models -----
class NotificationPreferencesRequest(BaseModel):
    """Optional; only include keys you want to update. True = receive, False = mute."""
    ent_games: Optional[bool] = None
    oc_invites: Optional[bool] = None
    attacks: Optional[bool] = None
    system: Optional[bool] = None
    quicktrade: Optional[bool] = None
    messages: Optional[bool] = None
    forum_topic_reply: Optional[bool] = None
    forum_comment_reply: Optional[bool] = None
    forum_mention: Optional[bool] = None
    designer_comp: Optional[bool] = None


class SendMessageRequest(BaseModel):
    """Send a direct message to another user (inbox). Supports text, emojis, and optional GIF URL."""
    target_username: str
    message: str
    gif_url: Optional[str] = None


# ----- Per-user cache for GET /notifications -----
_list_cache: dict = {}
_LIST_TTL_SEC = 5
_LIST_MAX_ENTRIES = 5000


def _invalidate_list_cache(user_id: str):
    _list_cache.pop(user_id, None)


def invalidate_notifications_list_cache_for_user(user_id: str):
    """Call after admin (or tooling) mutates another user's notifications so GET /notifications is fresh."""
    _invalidate_list_cache(user_id or "")


async def _notifications_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_NOTIFICATIONS)


_notifications_rl_u = [Depends(_notifications_sustained_rl_user)]


def register(router):
    @router.get("/profile/preferences")
    async def get_profile_preferences(current_user: dict = Depends(get_current_user)):
        """Get current user's notification preferences (for profile settings)."""
        prefs = current_user.get("notification_preferences") or {}
        out = {k: prefs.get(k, v) for k, v in DEFAULT_NOTIFICATION_PREFS.items()}
        return {"notification_preferences": out}

    @router.patch("/profile/preferences")
    async def update_profile_preferences(request: NotificationPreferencesRequest, current_user: dict = Depends(get_current_user)):
        """Update notification preferences. Only provided keys are updated."""
        updates = {k: v for k, v in request.model_dump().items() if v is not None}
        if not updates:
            return {"message": "No preferences to update", "notification_preferences": current_user.get("notification_preferences") or DEFAULT_NOTIFICATION_PREFS}
        new_prefs = {**(current_user.get("notification_preferences") or DEFAULT_NOTIFICATION_PREFS), **updates}
        await db.users.update_one(
            {"id": current_user.get("id") or ""},
            {"$set": {"notification_preferences": new_prefs}}
        )
        return {"message": "Preferences updated", "notification_preferences": new_prefs}

    @router.get("/notifications", dependencies=_notifications_rl_u)
    async def get_notifications(current_user: dict = Depends(get_current_user)):
        user_id = current_user.get("id") or ""
        now_utc = datetime.now(timezone.utc)
        cut_read = (now_utc - timedelta(days=READ_NOTIFICATION_RETENTION_DAYS)).isoformat()
        cut_unread = (now_utc - timedelta(days=UNREAD_NOTIFICATION_RETENTION_DAYS)).isoformat()
        await db.notifications.delete_many(
            {
                "user_id": user_id,
                "$or": [
                    {
                        "read": True,
                        "$or": [
                            {"read_at": {"$lt": cut_read}},
                            {"read_at": {"$exists": False}, "created_at": {"$lt": cut_read}},
                        ],
                    },
                    {
                        "read": {"$ne": True},
                        "created_at": {"$lt": cut_unread},
                    },
                ],
            }
        )
        _list_cache.pop(user_id, None)
        retention_meta = {
            "read_retention_days": READ_NOTIFICATION_RETENTION_DAYS,
            "unread_retention_days": UNREAD_NOTIFICATION_RETENTION_DAYS,
        }
        now_ts = time.time()
        entry = _list_cache.get(user_id)
        if entry and (now_ts - entry["ts"]) < _LIST_TTL_SEC:
            return {**entry["data"], **retention_meta}
        agg = await db.notifications.aggregate(
            [
                {"$match": {"user_id": user_id}},
                {
                    "$facet": {
                        "notifications": [
                            {"$sort": {"created_at": -1}},
                            {"$limit": 50},
                        ],
                        "unread": [
                            {"$match": {"read": False}},
                            {"$count": "n"},
                        ],
                    }
                },
            ]
        ).to_list(length=1)
        row = agg[0] if agg else {}
        notifications = list(row.get("notifications") or [])
        for doc in notifications:
            doc.pop("_id", None)
        ur = row.get("unread") or []
        unread_count = int(ur[0].get("n", 0)) if ur else 0
        out = {"notifications": notifications, "unread_count": unread_count, **retention_meta}
        if len(_list_cache) < _LIST_MAX_ENTRIES:
            _list_cache[user_id] = {"ts": now_ts, "data": out}
        return out

    @router.get("/notifications/sent", dependencies=_notifications_rl_u)
    async def get_sent_messages(current_user: dict = Depends(get_current_user)):
        """Return sent direct messages for the current user."""
        user_id = current_user.get("id") or ""
        sent = await db.notifications.find(
            {"user_id": user_id, "notification_type": "user_message_sent"},
            {"_id": 0}
        ).sort("created_at", -1).to_list(50)
        return {"sent_messages": sent}

    @router.post("/notifications/{notification_id}/read")
    async def mark_notification_read(notification_id: str, current_user: dict = Depends(get_current_user)):
        _invalidate_list_cache(current_user.get("id") or "")
        uid = current_user.get("id") or ""
        now_iso = datetime.now(timezone.utc).isoformat()
        res = await db.notifications.update_one(
            {"id": notification_id, "user_id": uid, "read": False},
            {"$set": {"read": True, "read_at": now_iso}},
        )
        if res.modified_count == 0:
            await db.notifications.update_one(
                {"id": notification_id, "user_id": uid},
                {"$set": {"read": True}},
            )
        return {"message": "Notification marked as read"}

    @router.post("/notifications/read-all")
    async def mark_all_notifications_read(current_user: dict = Depends(get_current_user)):
        _invalidate_list_cache(current_user.get("id") or "")
        await db.notifications.update_many(
            {"user_id": current_user.get("id") or "", "read": False},
            {"$set": {"read": True}}
        )
        return {"message": "All notifications marked as read"}

    @router.delete("/notifications/{notification_id}")
    async def delete_notification(notification_id: str, current_user: dict = Depends(get_current_user)):
        _invalidate_list_cache(current_user.get("id") or "")
        doc = await db.notifications.find_one({"id": notification_id, "user_id": current_user.get("id") or ""}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Notification not found")
        from utils.deleted_messages_archive import archive_message
        await archive_message(source="notification", doc=doc, deleted_by_id=current_user.get("id"), deleted_by_username=current_user.get("username"))
        await db.notifications.delete_one({"id": notification_id, "user_id": current_user.get("id") or ""})
        return {"message": "Message deleted"}

    @router.delete("/notifications")
    async def delete_all_notifications(current_user: dict = Depends(get_current_user)):
        _invalidate_list_cache(current_user.get("id") or "")
        from utils.deleted_messages_archive import archive_many
        docs = await db.notifications.find({"user_id": current_user.get("id") or ""}, {"_id": 0}).sort("created_at", -1).to_list(200)
        if docs:
            await archive_many(source="notification", docs=docs, deleted_by_id=current_user.get("id"), deleted_by_username=current_user.get("username"))
        result = await db.notifications.delete_many({"user_id": current_user.get("id") or ""})
        return {"message": "All messages deleted", "deleted_count": result.deleted_count}

    @router.post("/notifications/send")
    async def send_message_to_user(request: SendMessageRequest, current_user: dict = Depends(get_current_user)):
        """Send a direct message to another user. Message can include emojis; optional gif_url is shown as an image."""
        _invalidate_list_cache(current_user.get("id") or "")
        target_username = (request.target_username or "").strip()
        if not target_username:
            raise HTTPException(status_code=400, detail="Enter a username")
        if (target_username or "").lower() == (current_user.get("username") or "").lower():
            raise HTTPException(status_code=400, detail="You cannot message yourself")
        target_username_pattern = _username_pattern(target_username)
        if not target_username_pattern:
            raise HTTPException(status_code=404, detail="User not found")
        target = await db.users.find_one(
            {"username": target_username_pattern},
            {"_id": 0, "id": 1, "username": 1, "email": 1, "is_moderator": 1}
        )
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Check if target is an admin or moderator - normal users cannot message them directly
        target_is_staff = user_has_admin_list_email(target) or _is_moderator(target)
        sender_is_staff = _is_admin(current_user) or _is_moderator(current_user)
        
        if target_is_staff and not sender_is_staff:
            # Check if sender has been approved to message this admin/mod
            approval = await db.admin_message_permissions.find_one({
                "user_id": current_user.get("id") or "",
                "$or": [
                    {"admin_id": target["id"]},
                    {"admin_id": "all"}
                ]
            })
            if not approval:
                raise HTTPException(
                    status_code=403, 
                    detail="You cannot message staff directly. Please submit a Help Desk ticket to request permission."
                )
        
        message = (request.message or "").strip()
        if not message and not (request.gif_url or "").strip():
            raise HTTPException(status_code=400, detail="Message or GIF is required")
        message = message or "(GIF)"
        gif_url = (request.gif_url or "").strip()
        if gif_url and not (gif_url.startswith("http://") or gif_url.startswith("https://")):
            raise HTTPException(status_code=400, detail="GIF URL must start with http:// or https://")
        sender_username = current_user.get("username") or "?"
        title = f"Message from {sender_username}"
        extra = {"sender_id": current_user.get("id") or "", "sender_username": sender_username}
        if gif_url:
            extra["gif_url"] = gif_url
        await send_notification(target["id"], title, message, "user_message", category="messages", **extra)
        _sent_at = datetime.now(timezone.utc).isoformat()
        sent_copy = {
            "id": str(uuid.uuid4()),
            "user_id": current_user.get("id") or "",
            "sender_id": current_user.get("id") or "",
            "sender_username": sender_username,
            "recipient_id": target["id"],
            "recipient_username": target["username"],
            "title": f"To {target['username']}",
            "message": message,
            "notification_type": "user_message_sent",
            "read": True,
            "read_at": _sent_at,
            "created_at": _sent_at,
        }
        if gif_url:
            sent_copy["gif_url"] = gif_url
        await db.notifications.insert_one(sent_copy)
        _invalidate_list_cache(target["id"])
        return {"message": f"Message sent to {target['username']}"}

    class AdminBroadcastRequest(BaseModel):
        title: str
        message: str

    @router.post("/notifications/admin/broadcast")
    async def admin_broadcast_system_message(request: AdminBroadcastRequest, current_user: dict = Depends(get_current_user)):
        """Admin: send a system notification to all users (respects notification preferences for 'system')."""
        if (current_user.get("email") or "") not in (ADMIN_EMAILS or []):
            raise HTTPException(status_code=403, detail="Admin access required")
        title = (request.title or "").strip() or "System message"
        message = (request.message or "").strip()
        if not message:
            raise HTTPException(status_code=400, detail="Message is required")
        await send_notification_to_all(title, message, notification_type="system", category="system")
        return {"message": "System message sent to all users"}

    @router.get("/notifications/thread/{other_user_id}", dependencies=_notifications_rl_u)
    async def get_thread(other_user_id: str, current_user: dict = Depends(get_current_user)):
        """Get conversation thread with another user (for Telegram-style chat)."""
        me = current_user.get("id") or ""
        from_them = await db.notifications.find(
            {
                "user_id": me,
                "sender_id": other_user_id,
                "notification_type": "user_message",
            },
            {"_id": 0, "id": 1, "message": 1, "created_at": 1, "sender_username": 1, "gif_url": 1},
        ).sort("created_at", 1).to_list(100)
        from_me = await db.notifications.find(
            {
                "user_id": me,
                "recipient_id": other_user_id,
                "notification_type": "user_message_sent",
            },
            {"_id": 0, "id": 1, "message": 1, "created_at": 1, "sender_username": 1, "gif_url": 1},
        ).sort("created_at", 1).to_list(100)
        for m in from_them:
            m["from_me"] = False
        for m in from_me:
            m["from_me"] = True
        thread = sorted(from_them + from_me, key=lambda x: x["created_at"])
        other_username = None
        for m in from_them:
            if m.get("sender_username"):
                other_username = m["sender_username"]
                break
        if not other_username:
            other_doc = await db.users.find_one({"id": other_user_id}, {"_id": 0, "username": 1})
            other_username = (other_doc or {}).get("username") or "User"
        return {"thread": thread, "other_user_id": other_user_id, "other_username": other_username}
