# Game chat: whole-game chat with family-only toggle and block list
from datetime import datetime, timezone, timedelta
import re
import uuid
import logging
import time
from typing import Optional, List, Literal

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, field_validator

from server import db, get_current_user, send_notification, ADMIN_EMAILS, MOD_EMAILS, _is_admin, _is_moderator, require_staff_issued_if_staff_capable
from utils.mentions import extract_mention_usernames, resolve_usernames_to_users
from utils.sustained_page_ratelimit import check_sustained_page_rl, PAGE_KEY_GAME_CHAT

logger = logging.getLogger(__name__)

# ----- Constants -----
GAME_CHAT_MAX_MESSAGE_LEN = 500
GAME_CHAT_RETENTION_DAYS = 7
GAME_CHAT_DEFAULT_LIMIT = 10
GAME_CHAT_MAX_LIMIT = 50
GAME_CHAT_BLOCKED_MAX = 200
GAME_CHAT_RATE_LIMIT_COUNT = 5
GAME_CHAT_RATE_LIMIT_WINDOW_SEC = 30
ADMIN_ONLINE_COLOR = "#a78bfa"
MOD_ONLINE_COLOR = "#1e3a5f"
HDO_ONLINE_COLOR = "#166534"
ENTERTAINER_ONLINE_COLOR = "#7c3aed"
_role_color_cache = {"expires_at": 0.0, "admin": ADMIN_ONLINE_COLOR, "mod": MOD_ONLINE_COLOR}


# ----- Models -----
class SendMessageRequest(BaseModel):
    message: Optional[str] = ""
    gif_url: Optional[str] = None
    channel: Literal["global", "family"] = "global"

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


async def _role_default_colors() -> tuple[str, str]:
    now = time.monotonic()
    if now < _role_color_cache["expires_at"]:
        return _role_color_cache["admin"], _role_color_cache["mod"]
    docs = await db.game_settings.find(
        {"key": {"$in": ["admin_online_color", "mod_default_online_color"]}},
        {"_id": 0, "key": 1, "value": 1},
    ).to_list(2)
    values = {doc.get("key"): doc.get("value") for doc in docs}
    admin = values.get("admin_online_color") or ADMIN_ONLINE_COLOR
    mod = values.get("mod_default_online_color") or MOD_ONLINE_COLOR
    _role_color_cache.update({
        "expires_at": now + 60,
        "admin": admin.strip() if isinstance(admin, str) and admin.strip() else ADMIN_ONLINE_COLOR,
        "mod": mod.strip() if isinstance(mod, str) and mod.strip() else MOD_ONLINE_COLOR,
    })
    return _role_color_cache["admin"], _role_color_cache["mod"]


def _author_online_color_from_defaults(user: dict, admin_default: str, mod_default: str) -> Optional[str]:
    if _is_admin(user):
        return admin_default
    if _is_moderator(user):
        custom = (user.get("mod_online_color") or "").strip()
        return custom or mod_default
    if user.get("is_entertainer"):
        return (user.get("entertainer_online_color") or "").strip() or ENTERTAINER_ONLINE_COLOR
    if user.get("is_help_desk_operator"):
        return (user.get("hdo_online_color") or "").strip() or HDO_ONLINE_COLOR
    return None


async def _author_online_color(user: dict) -> Optional[str]:
    """Match the role colour used by the Users Online roster."""
    admin_default, mod_default = await _role_default_colors()
    return _author_online_color_from_defaults(user, admin_default, mod_default)


async def _backfill_author_colors(messages: list[dict]) -> None:
    """Colour retained messages created before role colours were stored."""
    missing_ids = {message.get("user_id") for message in messages if message.get("user_id") and not message.get("author_online_color")}
    if not missing_ids:
        return
    users = await db.users.find(
        {"id": {"$in": list(missing_ids)}},
        {
            "_id": 0, "id": 1, "email": 1, "is_moderator": 1,
            "is_entertainer": 1, "is_help_desk_operator": 1,
            "mod_online_color": 1, "entertainer_online_color": 1, "hdo_online_color": 1,
        },
    ).to_list(len(missing_ids))
    admin_default, mod_default = await _role_default_colors()
    colors = {
        user["id"]: _author_online_color_from_defaults(user, admin_default, mod_default)
        for user in users
    }
    for message in messages:
        color = colors.get(message.get("user_id"))
        if color:
            message["author_online_color"] = color


async def _get_staff_user_ids():
    """User IDs of admins and moderators (for spam alerts)."""
    or_clauses: list = [{"is_moderator": True}]
    for e in (ADMIN_EMAILS or []):
        if e:
            or_clauses.append({"email": re.compile("^" + re.escape(e) + "$", re.IGNORECASE)})
    for e in (MOD_EMAILS or []):
        if e:
            or_clauses.append({"email": re.compile("^" + re.escape(e) + "$", re.IGNORECASE)})
    cursor = db.users.find({"$or": or_clauses}, {"_id": 0, "id": 1})
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


async def _active_family_id_for_chat(user: dict) -> Optional[str]:
    """Return a live family id; memorial ids cannot power family chat."""
    family_id = (user.get("family_id") or "").strip()
    if not family_id:
        return None
    family = await db.families.find_one(
        {"id": family_id, "wiped": {"$ne": True}, "provisioning": {"$ne": True}},
        {"_id": 1},
    )
    if family:
        return family_id
    await db.users.update_one(
        {"id": user["id"], "family_id": family_id},
        {"$set": {"family_id": None, "family_role": None}},
    )
    user["family_id"] = None
    user["family_role"] = None
    return None


def _channel_message_query(
    channel: str,
    *,
    family_id: Optional[str] = None,
    blocked_user_ids=None,
    created_before: Optional[str] = None,
    created_since: Optional[str] = None,
) -> dict:
    """Build the channel-safe chat query; channel-less legacy rows are global."""
    clauses = []
    if channel == "family":
        clauses.append({"channel": "family"})
        clauses.append({"family_id": family_id})
    else:
        clauses.append(
            {
                "$or": [
                    {"channel": "global"},
                    {"channel": {"$exists": False}},
                    {"channel": None},
                ]
            }
        )
    blocked = [uid for uid in (blocked_user_ids or []) if uid]
    if blocked:
        clauses.append({"user_id": {"$nin": blocked}})
    created_range = {}
    if created_since:
        created_range["$gte"] = created_since
    if created_before:
        created_range["$lt"] = created_before
    if created_range:
        clauses.append({"created_at": created_range})
    return {"$and": clauses} if len(clauses) > 1 else clauses[0]


def _safe_message_payload(doc: dict, current_user_id: str) -> dict:
    """Return the stable public chat shape without internal ownership/family fields."""
    payload = {
        "id": doc.get("id"),
        "sender_id": doc.get("user_id"),
        "username": doc.get("username") or "Unknown",
        "message": doc.get("message") or "",
        "channel": doc.get("channel") if doc.get("channel") in ("global", "family") else "global",
        "created_at": doc.get("created_at"),
        "is_own": bool(doc.get("user_id") and doc.get("user_id") == current_user_id),
    }
    if doc.get("author_online_color"):
        payload["author_online_color"] = doc["author_online_color"]
    if doc.get("gif_url"):
        payload["gif_url"] = doc["gif_url"]
    return payload


def _mention_recipient_allowed(
    recipient: dict,
    *,
    sender_id: str,
    channel: str,
    family_id: Optional[str],
) -> bool:
    """Apply self/death/block/family rules before delivering a chat mention."""
    recipient_id = recipient.get("id")
    if not recipient_id or recipient_id == sender_id or recipient.get("is_dead") is True:
        return False
    if sender_id in (recipient.get("game_chat_blocked_user_ids") or []):
        return False
    if channel == "family" and recipient.get("family_id") != family_id:
        return False
    return True


async def _notify_game_chat_mentions(doc: dict, channel: str, family_id: Optional[str]) -> None:
    mention_names = extract_mention_usernames(doc.get("message") or "")
    if not mention_names:
        return
    sender_id = doc.get("user_id")
    recipients = await resolve_usernames_to_users(
        db,
        mention_names,
        projection={
            "is_dead": 1,
            "family_id": 1,
            "game_chat_blocked_user_ids": 1,
        },
    )
    for mentioned_name in mention_names:
        recipient = recipients.get(mentioned_name.lower())
        if not recipient:
            continue
        if not _mention_recipient_allowed(
            recipient,
            sender_id=sender_id,
            channel=channel,
            family_id=family_id,
        ):
            continue
        recipient_id = recipient["id"]
        try:
            await send_notification(
                recipient_id,
                "Mentioned in game chat",
                f'{doc.get("username") or "Someone"} mentioned you in {channel} chat. Open chat',
                "game_chat_mention",
                category="game_chat_mention",
                actor_username=doc.get("username") or "Unknown",
                message_link_to=f'/account/dashboard?gameChat={channel}&gameChatMessage={doc.get("id")}',
                message_link_label="Open chat",
                game_chat_channel=channel,
                game_chat_message_id=doc.get("id"),
            )
        except Exception as exc:
            logger.warning("Game chat mention notification to %s: %s", recipient_id, exc)


def register(router):
    @router.get("/game-chat/messages", dependencies=_game_chat_rl_u)
    async def get_game_chat_messages(
        channel: Literal["global", "family"] = Query("global"),
        limit: int = Query(GAME_CHAT_DEFAULT_LIMIT, ge=1, le=GAME_CHAT_MAX_LIMIT),
        before_id: Optional[str] = Query(None),
        current_user: dict = Depends(get_current_user),
    ):
        """List recent messages in one explicit channel, excluding blocked senders."""
        user_id = current_user["id"]
        blocked = set(current_user.get("game_chat_blocked_user_ids") or [])
        my_family = None
        if channel == "family":
            my_family = await _active_family_id_for_chat(current_user)
            if not my_family:
                raise HTTPException(status_code=403, detail="You must be in a live family to use family chat")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=GAME_CHAT_RETENTION_DAYS)).isoformat()
        query = _channel_message_query(
            channel,
            family_id=my_family,
            blocked_user_ids=blocked,
            created_since=cutoff,
        )

        sort = [("created_at", -1)]
        cursor = db.game_chat_messages.find(query, {"_id": 0}).sort(sort)
        if before_id:
            doc = await db.game_chat_messages.find_one(
                {"$and": [{"id": before_id}, query]},
                {"_id": 0, "created_at": 1},
            )
            if doc:
                page_query = _channel_message_query(
                    channel,
                    family_id=my_family,
                    blocked_user_ids=blocked,
                    created_since=cutoff,
                    created_before=doc["created_at"],
                )
                cursor = db.game_chat_messages.find(page_query, {"_id": 0}).sort(sort)
        messages = await cursor.limit(limit + 1).to_list(limit + 1)
        has_more = len(messages) > limit
        if has_more:
            messages = messages[:limit]
        await _backfill_author_colors(messages)
        messages = [_safe_message_payload(message, user_id) for message in messages]
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
        family_id = None
        if body.channel == "family":
            family_id = await _active_family_id_for_chat(current_user)
            if not family_id:
                raise HTTPException(status_code=403, detail="You must be in a live family to use family chat")

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
        now = datetime.now(timezone.utc)
        author_online_color = await _author_online_color(current_user)
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "username": username,
            "message": display_message,
            "family_id": family_id,
            "channel": body.channel,
            "created_at": now.isoformat(),
            "expires_at": now + timedelta(days=GAME_CHAT_RETENTION_DAYS),
        }
        if author_online_color:
            doc["author_online_color"] = author_online_color
        if body.gif_url:
            doc["gif_url"] = body.gif_url.strip()
        await db.game_chat_messages.insert_one(doc)
        return {"message": _safe_message_payload(doc, user_id)}

    @router.get("/game-chat/prefs", dependencies=_game_chat_rl_u)
    async def get_game_chat_prefs(current_user: dict = Depends(get_current_user)):
        """Get current user's game chat preferences (family_only, blocked_user_ids)."""
        active_family_id = await _active_family_id_for_chat(current_user)
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
            "in_family": bool(active_family_id),
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
        require_staff_issued_if_staff_capable(current_user)
        from utils.deleted_messages_archive import archive_many
        docs = await db.game_chat_messages.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
        if docs:
            await archive_many(source="game_chat", docs=docs, deleted_by_id=current_user.get("id"), deleted_by_username=current_user.get("username"), reason="chat_cleared")
        result = await db.game_chat_messages.delete_many({})
        return {"message": "Game chat cleared", "deleted_count": result.deleted_count}
