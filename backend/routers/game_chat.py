# Game chat: whole-game chat with family-only toggle and block list
from datetime import datetime, timezone, timedelta
import uuid
from typing import Optional, List

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, field_validator

from server import db, get_current_user

# ----- Constants -----
GAME_CHAT_MAX_MESSAGE_LEN = 500
GAME_CHAT_RETENTION_DAYS = 7
GAME_CHAT_DEFAULT_LIMIT = 50
GAME_CHAT_MAX_LIMIT = 100
GAME_CHAT_BLOCKED_MAX = 200


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


def register(router):
    @router.get("/game-chat/messages")
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
        messages.reverse()
        return {"messages": messages, "has_more": has_more}

    @router.post("/game-chat/send")
    async def send_game_chat_message(
        body: SendMessageRequest,
        current_user: dict = Depends(get_current_user),
    ):
        """Post a message to game chat. Send message (text), gif_url, or both. At least one required."""
        if not body.gif_url and not (body.message or "").strip():
            raise HTTPException(status_code=400, detail="Message or GIF required")
        user_id = current_user["id"]
        username = (current_user.get("username") or "").strip() or "Unknown"
        family_id = (current_user.get("family_id") or "").strip() or None

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
        del doc["_id"]
        return {"message": doc}

    @router.get("/game-chat/prefs")
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
