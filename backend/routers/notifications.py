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
    _username_pattern,
)

# ----- Constants -----
INBOX_RETENTION_DAYS = 7  # Notifications older than this are deleted when inbox is loaded
DEFAULT_NOTIFICATION_PREFS = {"ent_games": True, "oc_invites": True, "attacks": True, "system": True, "messages": True}

# ----- Models -----
class NotificationPreferencesRequest(BaseModel):
    """Optional; only include keys you want to update. True = receive, False = mute."""
    ent_games: Optional[bool] = None
    oc_invites: Optional[bool] = None
    attacks: Optional[bool] = None
    system: Optional[bool] = None
    messages: Optional[bool] = None


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
            {"id": current_user["id"]},
            {"$set": {"notification_preferences": new_prefs}}
        )
        return {"message": "Preferences updated", "notification_preferences": new_prefs}

    @router.get("/notifications")
    async def get_notifications(current_user: dict = Depends(get_current_user)):
        user_id = current_user["id"]
        # Delete notifications older than 7 days (inbox retention)
        cutoff = (datetime.now(timezone.utc) - timedelta(days=INBOX_RETENTION_DAYS)).isoformat()
        await db.notifications.delete_many({"user_id": user_id, "created_at": {"$lt": cutoff}})
        _list_cache.pop(user_id, None)
        now_ts = time.time()
        entry = _list_cache.get(user_id)
        if entry and (now_ts - entry["ts"]) < _LIST_TTL_SEC:
            return entry["data"]
        notifications = await db.notifications.find(
            {"user_id": user_id},
            {"_id": 0}
        ).sort("created_at", -1).to_list(50)
        unread_count = await db.notifications.count_documents({"user_id": user_id, "read": False})
        out = {"notifications": notifications, "unread_count": unread_count}
        if len(_list_cache) < _LIST_MAX_ENTRIES:
            _list_cache[user_id] = {"ts": now_ts, "data": out}
        return out

    @router.post("/notifications/{notification_id}/read")
    async def mark_notification_read(notification_id: str, current_user: dict = Depends(get_current_user)):
        _invalidate_list_cache(current_user["id"])
        await db.notifications.update_one(
            {"id": notification_id, "user_id": current_user["id"]},
            {"$set": {"read": True}}
        )
        return {"message": "Notification marked as read"}

    @router.post("/notifications/read-all")
    async def mark_all_notifications_read(current_user: dict = Depends(get_current_user)):
        _invalidate_list_cache(current_user["id"])
        await db.notifications.update_many(
            {"user_id": current_user["id"], "read": False},
            {"$set": {"read": True}}
        )
        return {"message": "All notifications marked as read"}

    @router.delete("/notifications/{notification_id}")
    async def delete_notification(notification_id: str, current_user: dict = Depends(get_current_user)):
        _invalidate_list_cache(current_user["id"])
        result = await db.notifications.delete_one(
            {"id": notification_id, "user_id": current_user["id"]}
        )
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Notification not found")
        return {"message": "Message deleted"}

    @router.delete("/notifications")
    async def delete_all_notifications(current_user: dict = Depends(get_current_user)):
        _invalidate_list_cache(current_user["id"])
        result = await db.notifications.delete_many({"user_id": current_user["id"]})
        return {"message": "All messages deleted", "deleted_count": result.deleted_count}

    @router.post("/notifications/send")
    async def send_message_to_user(request: SendMessageRequest, current_user: dict = Depends(get_current_user)):
        """Send a direct message to another user. Message can include emojis; optional gif_url is shown as an image."""
        _invalidate_list_cache(current_user["id"])
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
            {"_id": 0, "id": 1, "username": 1}
        )
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        message = (request.message or "").strip()
        if not message and not (request.gif_url or "").strip():
            raise HTTPException(status_code=400, detail="Message or GIF is required")
        message = message or "(GIF)"
        gif_url = (request.gif_url or "").strip()
        if gif_url and not (gif_url.startswith("http://") or gif_url.startswith("https://")):
            raise HTTPException(status_code=400, detail="GIF URL must start with http:// or https://")
        sender_username = current_user.get("username") or "?"
        title = f"Message from {sender_username}"
        extra = {"sender_id": current_user["id"], "sender_username": sender_username}
        if gif_url:
            extra["gif_url"] = gif_url
        await send_notification(target["id"], title, message, "user_message", category="messages", **extra)
        sent_copy = {
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "sender_id": current_user["id"],
            "sender_username": sender_username,
            "recipient_id": target["id"],
            "recipient_username": target["username"],
            "title": f"To {target['username']}",
            "message": message,
            "notification_type": "user_message_sent",
            "read": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if gif_url:
            sent_copy["gif_url"] = gif_url
        await db.notifications.insert_one(sent_copy)
        _invalidate_list_cache(target["id"])
        return {"message": f"Message sent to {target['username']}"}

    @router.get("/notifications/thread/{other_user_id}")
    async def get_thread(other_user_id: str, current_user: dict = Depends(get_current_user)):
        """Get conversation thread with another user (for Telegram-style chat)."""
        me = current_user["id"]
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
