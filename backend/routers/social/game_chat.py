# Game chat: whole-game chat with family-only toggle and block list
from datetime import datetime, timezone, timedelta
import uuid
import logging
from typing import Optional, List

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, field_validator

from server import db, get_current_user, send_notification, ADMIN_EMAILS, _is_admin, _is_moderator
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_GAME_CHAT

logger = logging.getLogger(__name__)

# ----- Constants -----
GAME_CHAT_MAX_MESSAGE_LEN = 500
GAME_CHAT_RETENTION_DAYS = 7
GAME_CHAT_DEFAULT_LIMIT = 10
GAME_CHAT_MAX_LIMIT = 10
GAME_CHAT_BLOCKED_MAX = 200
GAME_CHAT_RATE_LIMIT_COUNT = 5
GAME_CHAT_RATE_LIMIT_WINDOW_SEC = 30


# ----- Models -----
class SendMessageRequest(BaseModel):
    message: Optional[str] = ""
    gif_url: Optional[str] = None

    @field_validator("message")
    @classmethod
    def trim_and_limit(cls, v):
        if v is None:
            return ""
        s = str(v).strip()
        if len(s) > GAME_CHAT_MAX_MESSAGE_LEN:
            raise ValueError(f"Message must be at most {GAME_CHAT_MAX_MESSAGE_LEN} characters")
        return s

    @field_validator("gif_url")
    @classmethod
    def validate_gif_url(cls, v):
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        s = str(v).strip()
        if len(s) > 500:
            raise ValueError("GIF URL too long")
        return s


class GameChatPrefsRequest(BaseModel):
    family_only: Optional[bool] = None
    blocked_user_ids: Optional[List[str]] = None


async def _get_staff_user_ids():
    """User IDs of admins and moderators (for spam alerts)."""
    admin_emails = set(ADMIN_EMAILS or [])
    cursor = db.users.find(
        {"$or": [{"email": {"$in": list(admin_emails)}}, {"is_moderator": True}]},
        {"_id": 0, "id": 1},
    )
    return [u["id"] for u in await cursor.to_list(500)]


async def _notify_staff_game_chat_spam(spammer_user_id: str, spammer_username: str):
    """Send inbox notification to all admins/mods and create or update a single help desk ticket per spammer."""
    staff_ids = await _get_staff_user_ids()
    title = "Game chat spam"
    message = f"User {spammer_username} exceeded the rate limit (5 messages per 30 seconds). Consider muting them from game chat via Admin or their profile."
    for uid in staff_ids:
        try:
            await send_notification(uid, title, message, "system", category="system")
        except Exception as e:
            logger.warning("Game chat spam notify staff %s: %s", uid, e)
    try:
        now = datetime.now(timezone.utc).isoformat()
        subject = f"Game chat spam: {spammer_username}"
        existing = await db.help_desk_tickets.find_one(
            {"user_id": spammer_user_id, "subject": subject, "status": "open"},
            {"_id": 1, "id": 1},
        )
        if existing:
            reply = {
                "author_id": "",
                "author_username": "System",
                "author_role": "system",
                "body": f"Rate limit exceeded again at {now}. Consider muting from game chat via Admin or profile.",
                "created_at": now,
            }
            await db.help_desk_tickets.update_one(
                {"id": existing["id"]},
                {"$push": {"replies": reply}, "$set": {"updated_at": now}},
            )
        else:
            ticket = {
                "id": str(uuid.uuid4()),
                "user_id": spammer_user_id,
                "username": spammer_username,
                "subject": subject,
                "body": "Automated report: This user exceeded the rate limit (5 messages per 30 seconds). Consider muting from game chat via Admin or profile.",
                "status": "open",
                "created_at": now,
                "updated_at": now,
                "replies": [],
                "closed_at": None,
                "closed_by_id": None,
            }
            await db.help_desk_tickets.insert_one(ticket)
    except Exception as e:
        logger.warning("Game chat spam help desk ticket: %s", e)


def _is_user_muted_from_game_chat(user: dict) -> bool:
    """True if user is muted from game chat (permanent or until a future time)."""
    if user.get("game_chat_muted") is True:
        return True
    until = user.get("game_chat_muted_until")
    if not until:
        return False
    try:
        dt = datetime.fromisoformat(str(until).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) < dt
    except Exception:
        return False


async def _game_chat_sustained_rl_user(current_user: dict = Depends(get_current_user)):
    await check_sustained_page_rl(db, current_user.get("id") or "", PAGE_KEY_GAME_CHAT)


_game_chat_rl_u = [Depends(_game_chat_sustained_rl_user)]


def register(router):
    @router.get("/game-chat/messages", dependencies=_game_chat_rl_u)
    async def get_game_chat_messages(
        limit: int = Query(GAME_CHAT_DEFAULT_LIMIT, ge=1, le=GAME_CHAT_MAX_LIMIT),
        before_id: Optional[str] = Query(None),
        current_user: dict = Depends(get_current_user),
    ):
        """List recent game chat messages. Respects viewer's family_only and blocked_user_ids."""
        user_id = current_user["id"]
        family_only = current_user.get("game_chat_family_only") is True
        blocked = set(current_user.get("game_chat_blocked_user_ids") or [])

        query = {}
        if family_only:
            my_family = (current_user.get("family_id") or "").strip()
            if not my_family:
                return {"messages": [], "has_more": False}
            query["family_id"] = my_family
        if blocked:
            query["user_id"] = {"$nin": list(blocked)}

        sort = [("created_at", -1)]
        cursor = db.game_chat_messages.find(query, {"_id": 0}).sort(sort)
        if before_id:
            doc = await db.game_chat_messages.find_one({"id": before_id}, {"_id": 0, "created_at": 1})
            if doc:
                cursor = db.game_chat_messages.find({**query, "created_at": {"$lt": doc["created_at"]}}, {"_id": 0}).sort(sort)
        messages = await cursor.limit(limit + 1).to_list(limit + 1)
        has_more = len(messages) > limit
        if has_more:
            messages = messages[:limit]
        # Do not expose internal user_ids or family_ids in the public game chat payload
        for m in messages:
            m.pop("user_id", None)
            m.pop("family_id", None)
        messages.reverse()
        return {"messages": messages, "has_more": has_more}

    @router.post("/game-chat/send")
    async def send_game_chat_message(
        body: SendMessageRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Post a message to game chat. Send message (text), gif_url, or both. At least one required. Rate limit: 5 per 30s. Muted users cannot post."""
        if not body.gif_url and not (body.message or "").strip():
            raise HTTPException(status_code=400, detail="Message or GIF required")

        user_id = current_user["id"]
        username = (current_user.get("username") or "").strip() or "Unknown"
        family_id = (current_user.get("family_id") or "").strip() or None

        if _is_user_muted_from_game_chat(current_user):
            raise HTTPException(
                status_code=403,
                detail="You are muted from game chat. Contact staff if you think this is a mistake.",
            )

        # Rate limit: 5 messages per 30 seconds
        window_start = (datetime.now(timezone.utc) - timedelta(seconds=GAME_CHAT_RATE_LIMIT_WINDOW_SEC)).isoformat()
        recent_count = await db.game_chat_messages.count_documents(
            {"user_id": user_id, "created_at": {"$gte": window_start}}
        )
        if recent_count >= GAME_CHAT_RATE_LIMIT_COUNT:
            await _notify_staff_game_chat_spam(user_id, username)
            raise HTTPException(
                status_code=429,
                detail="Slow down — you can send 5 messages per 30 seconds. Staff have been notified.",
            )

        display_message = (body.message or "").strip() or ("(GIF)" if body.gif_url else "")
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "username": username,
            "message": display_message,
            "family_id": family_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if body.gif_url:
            doc["gif_url"] = body.gif_url.strip()
        await db.game_chat_messages.insert_one(doc)
        # Response to clients: exclude internal _id (added by insert_one), user_id, family_id
        safe_doc = {k: v for k, v in doc.items() if k not in ("_id", "user_id", "family_id")}
        return {"message": safe_doc}

    @router.get("/game-chat/prefs", dependencies=_game_chat_rl_u)
    async def get_game_chat_prefs(current_user: dict = Depends(get_current_user)):
        """Get current user's game chat preferences (family_only, blocked_user_ids)."""
        blocked_ids = current_user.get("game_chat_blocked_user_ids") or []
        block_list_with_names = []
        if blocked_ids:
            users = await db.users.find(
                {"id": {"$in": blocked_ids}},
                {"_id": 0, "id": 1, "username": 1},
            ).to_list(len(blocked_ids))
            id_to_name = {u["id"]: (u.get("username") or "?") for u in users}
            block_list_with_names = [{"user_id": uid, "username": id_to_name.get(uid, "?")} for uid in blocked_ids]
        return {
            "family_only": current_user.get("game_chat_family_only") is True,
            "blocked_user_ids": blocked_ids,
            "block_list_with_names": block_list_with_names,
            "in_family": bool((current_user.get("family_id") or "").strip()),
            "muted": _is_user_muted_from_game_chat(current_user),
            "muted_until": current_user.get("game_chat_muted_until"),
        }

    @router.patch("/game-chat/prefs")
    async def update_game_chat_prefs(
        body: GameChatPrefsRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Update game chat preferences. family_only only applies if user is in a family."""
        updates = {}
        if body.family_only is not None:
            updates["game_chat_family_only"] = body.family_only
        if body.blocked_user_ids is not None:
            blocked = [str(x).strip() for x in body.blocked_user_ids if x and str(x).strip()]
            blocked = list(dict.fromkeys(blocked))[:GAME_CHAT_BLOCKED_MAX]
            updates["game_chat_blocked_user_ids"] = blocked
        if not updates:
            return {"message": "No preferences to update", "family_only": current_user.get("game_chat_family_only"), "blocked_user_ids": current_user.get("game_chat_blocked_user_ids") or []}
        await db.users.update_one({"id": current_user["id"]}, {"$set": updates})
        return {
            "message": "Preferences updated",
            "family_only": updates.get("game_chat_family_only", current_user.get("game_chat_family_only")),
            "blocked_user_ids": updates.get("game_chat_blocked_user_ids", current_user.get("game_chat_blocked_user_ids") or []),
        }

    @router.post("/game-chat/block/{target_user_id}")
    async def block_user_game_chat(
        target_user_id: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Add a user to your game chat block list (you won't see their messages)."""
        target = (target_user_id or "").strip()
        if not target or target == current_user["id"]:
            raise HTTPException(status_code=400, detail="Invalid user to block")
        blocked = list(current_user.get("game_chat_blocked_user_ids") or [])
        if target in blocked:
            return {"message": "Already blocked", "blocked_user_ids": blocked}
        blocked.append(target)
        blocked = blocked[:GAME_CHAT_BLOCKED_MAX]
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"game_chat_blocked_user_ids": blocked}},
        )
        return {"message": "User blocked", "blocked_user_ids": blocked}

    @router.delete("/game-chat/block/{target_user_id}")
    async def unblock_user_game_chat(
        target_user_id: str,
        current_user: dict = Depends(get_current_user),
    ):
        """Remove a user from your game chat block list."""
        target = (target_user_id or "").strip()
        if not target:
            raise HTTPException(status_code=400, detail="Invalid user")
        blocked = list(current_user.get("game_chat_blocked_user_ids") or [])
        if target not in blocked:
            return {"message": "User was not blocked", "blocked_user_ids": blocked}
        blocked = [x for x in blocked if x != target]
        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": {"game_chat_blocked_user_ids": blocked}},
        )
        return {"message": "User unblocked", "blocked_user_ids": blocked}

    @router.delete("/game-chat/messages")
    async def clear_game_chat(current_user: dict = Depends(get_current_user)):
        """Delete all game chat messages. Admin or moderator only."""
        if not _is_admin(current_user) and not _is_moderator(current_user):
            raise HTTPException(
                status_code=403,
                detail="Only admins and moderators can clear game chat.",
            )
        from utils.deleted_messages_archive import archive_many
        docs = await db.game_chat_messages.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
        if docs:
            await archive_many(source="game_chat", docs=docs, deleted_by_id=current_user.get("id"), deleted_by_username=current_user.get("username"), reason="chat_cleared")
        result = await db.game_chat_messages.delete_many({})
        return {"message": "Game chat cleared", "deleted_count": result.deleted_count}
